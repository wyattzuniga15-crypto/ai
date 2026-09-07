/** Owns mobs and arrows: ticking, rendering, spawning, per-chunk persistence and hit tests. */
import * as THREE from 'three';
import { Mob, type MobSave, type MobWorld } from './mob.ts';
import { Arrow } from './arrow.ts';
import { ANIMAL_TYPES, CAT_VARIANTS, EQUINE_TYPES, HORSE_COATS, LLAMA_COATS, MOB_SPECS, PARROT_COLORS, axolotlColor, frogVariantFor, initEquine, isSlimeChunk, mobStats, pandaGene, phantomSpawnChance, pickHostile, rabbitVariantFor, randomSheepColor, wolfVariantFor } from './mobTypes.ts';
import { aabbIntersects, type AABB } from './physics.ts';
import { chunkKey } from '../world/chunk.ts';
import { blocks } from '../blocks/registry.ts';
import { SEA_LEVEL, WORLD_MIN_Y } from '../core/constants.ts';
import { biomes } from '../world/biomes.ts';

export interface ManagerHost extends MobWorld {
  scene: THREE.Scene;
  base: string;
  /** How bright the moon is tonight, which swamp slimes wait for. */
  moonBrightness?(): number;
  /** World seed (slime chunks). */
  seed: number;
  isChunkLoaded(cx: number, cz: number): boolean;
  loadedChunkCount(): number;
  /** Called when a mob dies: drops and XP. */
  onMobDeath(mob: Mob): void;
  getBiome(x: number, z: number): number;
  topBlock(x: number, z: number): number;
  /** Told where an arrow stuck, so the game can wake a target block. */
  arrowHitBlock?: (x: number, y: number, z: number, point: THREE.Vector3) => void;
  arrowHitMob?: (box: AABB, damage: number, fire: number, knockback: number, effects: { id: string; ticks: number; amplifier?: number }[], pierced?: unknown[]) => boolean;
  /** Bakes one block state into a mesh, which is how a mooshroom comes by its mushrooms. */
  blockMesh?: (state: number) => THREE.Object3D;
}

/**
 * Where a mooshroom's three mushrooms stand, in blocks out from the animal's feet and degrees of
 * turn: two on its back and one behind its head, as vanilla's MushroomCowRenderer arranges them.
 */
const MOOSHROOM_MUSHROOMS: [number, number, number, number][] = [
  [0.17, 1.3, 0.3, -48],
  [-0.18, 1.3, -0.05, 42],
  [0.02, 1.32, -0.4, 12],
];

/** Biomes whose animal groups can be horse or donkey herds (vanilla plains and savannas). */
const HORSE_BIOMES = new Set(['plains', 'sunflower_plains', 'savanna', 'savanna_plateau', 'windswept_savanna']);

/** Where vanilla puts foxes, and which of them wear the white coat. */
const FOX_BIOMES = new Set(['taiga', 'old_growth_pine_taiga', 'old_growth_spruce_taiga', 'snowy_taiga', 'grove']);
const SNOW_FOX_BIOMES = new Set(['snowy_taiga', 'grove']);

/** Where vanilla puts the rest of the overworld's animals. */
const PANDA_BIOMES = new Set(['bamboo_jungle', 'jungle']);
const BEAR_BIOMES = new Set(['snowy_plains', 'snowy_taiga', 'snowy_slopes', 'frozen_peaks', 'ice_spikes', 'frozen_river', 'grove']);
const LLAMA_BIOMES = new Set(['savanna', 'savanna_plateau', 'windswept_savanna', 'windswept_hills', 'windswept_forest', 'windswept_gravelly_hills']);
const RABBIT_BIOMES = new Set(['desert', 'flower_forest', 'taiga', 'snowy_taiga', 'snowy_plains', 'ice_spikes', 'grove', 'meadow', 'badlands', 'wooded_badlands', 'eroded_badlands']);
const PARROT_BIOMES = new Set(['jungle', 'sparse_jungle', 'bamboo_jungle']);
const FROG_BIOMES = new Set(['swamp', 'mangrove_swamp']);
const CAMEL_BIOMES = new Set(['desert']);
const ARMADILLO_BIOMES = new Set(['savanna', 'savanna_plateau', 'windswept_savanna', 'badlands', 'wooded_badlands', 'eroded_badlands']);

/** Vanilla's goat biomes: the peaks and the slopes under them. */
const GOAT_BIOMES = new Set(['frozen_peaks', 'jagged_peaks', 'stony_peaks', 'snowy_slopes', 'windswept_hills', 'meadow']);

/** Beaches warm enough for turtles, which vanilla keeps to the plain and the stony ones. */
const TURTLE_BIOMES = new Set(['beach']);

export class EntityManager {
  readonly mobs: Mob[] = [];
  readonly arrows: Arrow[] = [];
  /** Mobs serialized for chunks that were unloaded, keyed by chunk key. */
  readonly stashed = new Map<string, MobSave[]>();
  hostileCapBase = 70;
  passiveCap = 10;
  private phantomTimer = 1200;
  private traderTimer = 6000;
  private patrolTimer = 6000;

  constructor(private readonly host: ManagerHost) {}

  spawn(type: string, x: number, y: number, z: number, yaw = 0, baby = false): Mob | null {
    const stats = mobStats(type);
    if (!stats) return null;
    const m = new Mob(stats, MOB_SPECS[type].goals(), this.host.base, x, y, z);
    m.yaw = m.bodyYaw = m.headYaw = yaw;
    if (baby) {
      m.extra.baby = true;
      m.extra.grow = 24000;
    }
    if (type === 'sheep') m.extra.color = randomSheepColor(this.host.rng);
    if (type === 'mooshroom') this.dressMooshroom(m);
    if (type === 'snow_golem') this.dressSnowGolem(m);
    if (type === 'cat') m.extra.variant = CAT_VARIANTS[Math.floor(this.host.rng() * CAT_VARIANTS.length)];
    if (type === 'rabbit') m.extra.variant = rabbitVariantFor(biomes[this.host.getBiome(Math.floor(x), Math.floor(z))]?.id ?? 'plains', this.host.rng);
    if (type === 'panda') m.extra.gene = pandaGene(this.host.rng);
    if (type === 'llama') m.extra.coat = LLAMA_COATS[Math.floor(this.host.rng() * LLAMA_COATS.length)];
    if (type === 'axolotl') m.extra.color = axolotlColor(this.host.rng);
    if (type === 'parrot') m.extra.color = PARROT_COLORS[Math.floor(this.host.rng() * PARROT_COLORS.length)];
    if (EQUINE_TYPES.includes(type)) initEquine(m, this.host.rng);
    this.mobs.push(m);
    this.host.scene.add(m.model.group);
    return m;
  }

  /**
   * One batch out of a monster spawner, as vanilla's `BaseSpawner` rolls it: four attempts inside a
   * nine-by-three-by-nine box, each needing room and a floor, and none at all once six of the mob
   * are already in that box.
   */
  spawnerBurst(x: number, y: number, z: number, type: string): void {
    const h = this.host;
    const stats = mobStats(type);
    if (!stats) return;
    const near = this.mobs.filter((m) => !m.dead && m.def.id === type
      && Math.abs(m.pos.x - x) <= 4.5 && Math.abs(m.pos.y - y) <= 2 && Math.abs(m.pos.z - z) <= 4.5);
    if (near.length >= 6) return;
    for (let i = 0; i < 4; i++) {
      const px = x + 0.5 + (h.rng() - h.rng()) * 4;
      const py = y + Math.floor(h.rng() * 3) - 1;
      const pz = z + 0.5 + (h.rng() - h.rng()) * 4;
      const floor = h.getBlock(Math.floor(px), py - 1, Math.floor(pz));
      // a spawner ignores the light level, but its mobs still need somewhere to stand
      if (!floor || !blocks.stateOpaque[floor]) continue;
      if (!Mob.fits(h, stats, px, py, pz)) continue;
      this.spawn(type, px, py, pz, h.rng() * Math.PI * 2);
    }
  }

  mobsNear(x: number, y: number, z: number, range: number): Mob[] {
    const out: Mob[] = [];
    for (const m of this.mobs) if (!m.dead && Math.abs(m.pos.x - x) <= range && Math.abs(m.pos.y - y) <= range && Math.abs(m.pos.z - z) <= range) out.push(m);
    return out;
  }

  remove(m: Mob): void {
    const i = this.mobs.indexOf(m);
    if (i >= 0) this.mobs.splice(i, 1);
    this.host.scene.remove(m.model.group);
    m.destroy();
  }

  shootArrow(from: THREE.Vector3, to: THREE.Vector3, velocity: number, damage: number, fromPlayer = false): Arrow {
    const dir = to.clone().sub(from);
    const dist = Math.hypot(dir.x, dir.z);
    // Vanilla's arc compensation (AbstractSkeleton.performRangedAttack) is tuned for a bow's 1.6
    // launch speed; scaling it by the speed ratio keeps a faster crossbow bolt on the same line.
    dir.y += dist * 0.2 * (1.6 / velocity);
    const a = new Arrow(this.host.base, from, dir, velocity, damage, fromPlayer);
    a.onHitBlock = (x, y, z, point) => this.host.arrowHitBlock?.(x, y, z, point);
    this.arrows.push(a);
    this.host.scene.add(a.mesh);
    return a;
  }

  count(disposition: 'hostile' | 'passive' | 'neutral'): number {
    let n = 0;
    for (const m of this.mobs) if (m.def.disposition === disposition && !m.dead) n++;
    return n;
  }

  tick(playerBox: AABB | null): void {
    const h = this.host;
    const p = h.playerPos();
    for (let i = this.mobs.length - 1; i >= 0; i--) {
      const m = this.mobs[i];
      const cx = Math.floor(m.pos.x) >> 4;
      const cz = Math.floor(m.pos.z) >> 4;
      if (!h.isChunkLoaded(cx, cz)) {
        // chunk went away: stash for later
        const key = chunkKey(cx, cz);
        const list = this.stashed.get(key) ?? [];
        list.push(m.save());
        this.stashed.set(key, list);
        this.remove(m);
        continue;
      }
      m.tick(h);
      // deaths can happen between ticks (player attacks, arrows), so check the flag rather than a snapshot
      if (m.dead && !m.deathHandled) {
        m.deathHandled = true;
        h.onMobDeath(m);
      }
      if (m.removed) {
        this.remove(m);
        continue;
      }
      // despawning (hostiles only)
      if (!m.persistent) {
        const d = m.distanceTo(p);
        if (d > 128) this.remove(m);
        else if (d > 32 && h.rng() < 1 / 800) this.remove(m);
      }
      // void
      if (m.pos.y < WORLD_MIN_Y - 10) this.remove(m);
    }
    for (let i = this.arrows.length - 1; i >= 0; i--) {
      const a = this.arrows[i];
      a.tick(h, playerBox, (amount, from) => {
        h.hurtPlayer(amount, from);
        for (const e of a.effects) h.addPlayerEffect(e.id, e.ticks, e.amplifier ?? 0);
      }, a.fromPlayer && h.arrowHitMob ? (box) => h.arrowHitMob!(box, Math.max(1, Math.ceil(a.damage * Math.max(1, a.vel.length()))), a.fire, a.knockback, a.effects, a.pierced) : undefined);
      if (a.removed) {
        h.scene.remove(a.mesh);
        this.arrows.splice(i, 1);
      }
    }
  }

  render(alpha: number, brightnessAt: (x: number, y: number, z: number) => number): void {
    for (const m of this.mobs) m.render(alpha, brightnessAt(Math.floor(m.pos.x), Math.floor(m.pos.y + m.def.eyeHeight), Math.floor(m.pos.z)));
    for (const a of this.arrows) a.render(alpha);
  }

  /** Nearest mob hit by a ray within maxDist. */
  raycast(origin: THREE.Vector3, dir: THREE.Vector3, maxDist: number): { mob: Mob; distance: number } | null {
    let best: { mob: Mob; distance: number } | null = null;
    for (const m of this.mobs) {
      if (m.dead) continue;
      const b = m.aabb();
      const t = rayBox(origin, dir, b);
      if (t !== null && t <= maxDist && (!best || t < best.distance)) best = { mob: m, distance: t };
    }
    return best;
  }

  mobsIntersecting(box: AABB): Mob[] {
    return this.mobs.filter((m) => !m.dead && aabbIntersects(m.aabb(), [box.minX, box.minY, box.minZ, box.maxX, box.maxY, box.maxZ]));
  }

  // ---------------------------------------------------------------------------------------------
  // Persistence
  // ---------------------------------------------------------------------------------------------
  serializeChunk(cx: number, cz: number): MobSave[] {
    const out: MobSave[] = [];
    for (const m of this.mobs) if (!m.dead && (Math.floor(m.pos.x) >> 4) === cx && (Math.floor(m.pos.z) >> 4) === cz) out.push(m.save());
    const stashed = this.stashed.get(chunkKey(cx, cz));
    if (stashed) out.push(...stashed);
    return out;
  }

  /** Called for saved entries that are items rather than mobs. */
  onRestoreItem: ((s: MobSave) => void) | null = null;
  /** Called for saved minecarts, which the game keeps outside the mob list. */
  onRestoreCart: ((s: MobSave) => void) | null = null;

  restoreChunk(cx: number, cz: number, saved: MobSave[] | null): void {
    const key = chunkKey(cx, cz);
    const list = [...(saved ?? []), ...(this.stashed.get(key) ?? [])];
    this.stashed.delete(key);
    for (const s of list) {
      if (s.type === 'item') {
        this.onRestoreItem?.(s);
        continue;
      }
      if (s.type === 'minecart' || s.type.endsWith('_minecart')) {
        this.onRestoreCart?.(s);
        continue;
      }
      const m = this.spawn(s.type, s.x, s.y, s.z, s.yaw);
      m?.restore(s);
      if (m && s.type === 'mooshroom') this.dressMooshroom(m);
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Spawning
  // ---------------------------------------------------------------------------------------------
  /** Initial animal groups for a freshly generated chunk (vanilla: 10% of chunks, groups of 4). */
  spawnAnimalsInChunk(cx: number, cz: number): void {
    const h = this.host;
    if (h.rng() > 0.1) return;
    const x = cx * 16 + Math.floor(h.rng() * 16);
    const z = cz * 16 + Math.floor(h.rng() * 16);
    const biome = biomes[h.getBiome(x, z)];
    if (!biome) return;
    if (biome.category === 'ocean' || biome.category === 'river') {
      const cold = biome.id.includes('cold') || biome.id.includes('frozen');
      // vanilla's ocean lists: fish everywhere, squid with them, and dolphins where it is not frozen
      const roll = h.rng();
      if (roll < 0.4) this.spawnFishSchool(x, z, biome.category === 'river' || cold ? 'salmon' : 'cod');
      else if (roll < 0.8 || cold || biome.category === 'river') this.spawnFishSchool(x, z, 'squid');
      else this.spawnFishSchool(x, z, 'dolphin');
      return;
    }
    // mushroom fields are the one biome that spawns nothing but mooshrooms, on their mycelium
    if (biome.category === 'mushroom') {
      this.spawnMooshroomHerd(x, z);
      return;
    }
    if (biome.surface.top !== 'grass_block') return;
    // vanilla's beaches carry turtles instead of the usual herd
    if (TURTLE_BIOMES.has(biome.id)) {
      this.spawnTurtles(x, z);
      return;
    }
    const wolfVariant = wolfVariantFor(biome.id);
    const fox = FOX_BIOMES.has(biome.id) && h.rng() < 0.5;
    const goat = GOAT_BIOMES.has(biome.id) && h.rng() < 0.5;
    const panda = PANDA_BIOMES.has(biome.id) && h.rng() < (biome.id === 'bamboo_jungle' ? 0.6 : 0.15);
    const bear = BEAR_BIOMES.has(biome.id) && h.rng() < 0.4;
    const llama = LLAMA_BIOMES.has(biome.id) && h.rng() < 0.35;
    const rabbit = RABBIT_BIOMES.has(biome.id) && h.rng() < 0.4;
    const parrot = PARROT_BIOMES.has(biome.id) && h.rng() < 0.4;
    const frog = FROG_BIOMES.has(biome.id) && h.rng() < 0.6;
    const camel = CAMEL_BIOMES.has(biome.id) && h.rng() < 0.25;
    const armadillo = ARMADILLO_BIOMES.has(biome.id) && h.rng() < 0.4;
    // vanilla spawns ocelots only in the jungles, in pairs
    const ocelot = biome.category === 'jungle' && h.rng() < 0.25;
    // vanilla plains and savannas spawn herds of horses, and one in five of those is a donkey
    const equine = HORSE_BIOMES.has(biome.id) && h.rng() < 0.4;
    const type = camel ? 'camel' : armadillo ? 'armadillo' : parrot ? 'parrot' : frog ? 'frog' : panda ? 'panda' : bear ? 'polar_bear' : llama ? 'llama' : rabbit ? 'rabbit' : fox ? 'fox' : goat ? 'goat' : ocelot ? 'ocelot' : equine ? (h.rng() < 0.2 ? 'donkey' : 'horse') : wolfVariant && h.rng() < 1 / 6 ? 'wolf' : ANIMAL_TYPES[Math.floor(h.rng() * ANIMAL_TYPES.length)];
    const stats = mobStats(type)!;
    // horse herds share one coat like vanilla's group spawn
    const herdCoat = HORSE_COATS[Math.floor(h.rng() * HORSE_COATS.length)];
    // a llama herd shares a coat the way a horse herd shares one
    const herdCoatLlama = LLAMA_COATS[Math.floor(h.rng() * LLAMA_COATS.length)];
    const want = camel ? 1 + Math.floor(h.rng() * 2) : armadillo ? 2 + Math.floor(h.rng() * 3) : parrot ? 1 + Math.floor(h.rng() * 2) : frog ? 2 + Math.floor(h.rng() * 4) : ocelot ? 2 : fox ? 2 + Math.floor(h.rng() * 3) : goat ? 2 + Math.floor(h.rng() * 2) : bear ? 1 + Math.floor(h.rng() * 2) : llama ? 4 + Math.floor(h.rng() * 3) : rabbit ? 2 + Math.floor(h.rng() * 3) : equine ? 2 + Math.floor(h.rng() * 5) : 4;
    let spawned = 0;
    for (let i = 0; i < 12 && spawned < want; i++) {
      const px = x + Math.floor(h.rng() * 7) - 3 + 0.5;
      const pz = z + Math.floor(h.rng() * 7) - 3 + 0.5;
      const top = h.topBlock(Math.floor(px), Math.floor(pz));
      const ground = h.getBlock(Math.floor(px), top, Math.floor(pz));
      if (ground === 0 || blocks.blockOf(ground).id !== 'grass_block') continue;
      if (h.getSkyLight(Math.floor(px), top + 1, Math.floor(pz)) < 9) continue;
      if (!Mob.fits(h, stats, px, top + 1, pz)) continue;
      const m = this.spawn(type, px, top + 1, pz, h.rng() * Math.PI * 2, h.rng() < 0.05); // vanilla: 5% of a group spawns as babies
      if (m && type === 'wolf') m.extra.variant = wolfVariant!;
      if (m && type === 'horse') m.extra.coat = herdCoat;
      if (m && type === 'fox' && SNOW_FOX_BIOMES.has(biome.id)) m.extra.variant = 'snow';
      if (m && type === 'rabbit') m.extra.variant = rabbitVariantFor(biome.id, h.rng);
      if (m && type === 'panda') m.extra.gene = pandaGene(h.rng);
      if (m && type === 'llama') m.extra.coat = herdCoatLlama;
      if (m && type === 'parrot') m.extra.color = PARROT_COLORS[Math.floor(h.rng() * PARROT_COLORS.length)];
      if (m && type === 'frog') m.extra.variant = frogVariantFor(biome.temperature);
      spawned++;
    }
  }

  /** Turtles on the sand, each remembering the beach it came from so it can lay there. */
  private spawnTurtles(x: number, z: number): void {
    const h = this.host;
    const stats = mobStats('turtle')!;
    const want = 2 + Math.floor(h.rng() * 4);
    let spawned = 0;
    for (let i = 0; i < 16 && spawned < want; i++) {
      const px = x + Math.floor(h.rng() * 9) - 4 + 0.5;
      const pz = z + Math.floor(h.rng() * 9) - 4 + 0.5;
      const top = h.topBlock(Math.floor(px), Math.floor(pz));
      const ground = h.getBlock(Math.floor(px), top, Math.floor(pz));
      if (ground === 0 || blocks.blockOf(ground).id !== 'sand') continue;
      if (!Mob.fits(h, stats, px, top + 1, pz)) continue;
      const m = this.spawn('turtle', px, top + 1, pz, h.rng() * Math.PI * 2, h.rng() < 0.05);
      // it remembers this beach, which is where it will come back to lay
      if (m) m.extra.home = { x: Math.floor(px), z: Math.floor(pz) } as never;
      spawned++;
    }
  }

  /**
   * Vanilla's mushroom island spawner: mooshrooms in groups of four to eight, on mycelium, wherever
   * the sky reaches. They are the only mob the biome spawns.
   */
  private spawnMooshroomHerd(x: number, z: number): void {
    const h = this.host;
    const stats = mobStats('mooshroom')!;
    const want = 4 + Math.floor(h.rng() * 5);
    let spawned = 0;
    for (let i = 0; i < 20 && spawned < want; i++) {
      const px = x + Math.floor(h.rng() * 9) - 4 + 0.5;
      const pz = z + Math.floor(h.rng() * 9) - 4 + 0.5;
      const top = h.topBlock(Math.floor(px), Math.floor(pz));
      const ground = h.getBlock(Math.floor(px), top, Math.floor(pz));
      if (ground === 0 || blocks.blockOf(ground).id !== 'mycelium') continue;
      if (h.getSkyLight(Math.floor(px), top + 1, Math.floor(pz)) < 9) continue;
      if (!Mob.fits(h, stats, px, top + 1, pz)) continue;
      this.spawn('mooshroom', px, top + 1, pz, h.rng() * Math.PI * 2, h.rng() < 0.05);
      spawned++;
    }
  }

  /**
   * The carved pumpkin a snow golem wears. Vanilla renders it as a block on the head at five
   * eighths scale, which is what makes it sit like a hat rather than a helmet.
   */
  dressSnowGolem(m: Mob): void {
    const make = this.host.blockMesh;
    if (!make) return;
    const pivot = new THREE.Group();
    // the head part is in model units, so the block has to be scaled back up out of the 1/16
    pivot.position.set(0, 4, 0);
    pivot.scale.setScalar(16 * 0.625);
    const mesh = make(blocks.defaultState('carved_pumpkin'));
    mesh.position.set(-0.5, -0.5, -0.5);
    pivot.add(mesh);
    m.setDecoration(pivot, 'head');
  }

  /** Hangs the three mushrooms a grown mooshroom carries off its model, in the colour it wears. */
  dressMooshroom(m: Mob): void {
    const make = this.host.blockMesh;
    if (!make) return;
    const state = blocks.defaultState(m.extra.variant === 'brown' ? 'brown_mushroom' : 'red_mushroom');
    const group = new THREE.Group();
    for (const [mx, my, mz, deg] of MOOSHROOM_MUSHROOMS) {
      const pivot = new THREE.Group();
      pivot.position.set(mx, my, mz);
      pivot.rotation.y = (deg * Math.PI) / 180;
      const mesh = make(state);
      // a block model is built out from its corner, so it has to come back half a block to centre
      mesh.position.set(-0.5, 0, -0.5);
      pivot.add(mesh);
      group.add(pivot);
    }
    m.setDecoration(group);
  }

  /** Schools of whatever swims here: cod and salmon, squid, or a pod of dolphins. */
  private spawnFishSchool(x: number, z: number, type: 'cod' | 'salmon' | 'squid' | 'dolphin'): void {
    const h = this.host;
    const stats = mobStats(type)!;
    // vanilla's group sizes: fish come in schools, squid in twos and threes, dolphins in small pods
    const want = type === 'dolphin' ? 3 + Math.floor(h.rng() * 3) : type === 'squid' ? 2 + Math.floor(h.rng() * 3) : 3 + Math.floor(h.rng() * 4);
    let spawned = 0;
    for (let i = 0; i < 16 && spawned < want; i++) {
      const px = x + Math.floor(h.rng() * 9) - 4 + 0.5;
      const pz = z + Math.floor(h.rng() * 9) - 4 + 0.5;
      const top = h.topBlock(Math.floor(px), Math.floor(pz));
      const py = top - Math.floor(h.rng() * 6);
      const at = h.getBlock(Math.floor(px), py, Math.floor(pz));
      if (at === 0 || blocks.blockOf(at).id !== 'water') continue;
      if (!Mob.fits(h, stats, px, py, pz)) continue;
      this.spawn(type, px, py + 0.2, pz, h.rng() * Math.PI * 2);
      spawned++;
    }
  }

  /**
   * Vanilla PhantomSpawner: every 60–120 s at night, a player who has not slept for three days may
   * get one to three phantoms 20–35 blocks overhead when the sky is visible above them.
   */
  phantomSpawnTick(timeSinceRest: number, night: boolean): void {
    if (--this.phantomTimer > 0) return;
    const h = this.host;
    this.phantomTimer = 1200 + Math.floor(h.rng() * 1200);
    if (!night || !h.playerTargetable()) return;
    if (h.rng() >= phantomSpawnChance(timeSinceRest)) return;
    const p = h.playerPos();
    if (p.y < 63 || h.getSkyLight(Math.floor(p.x), Math.floor(p.y) + 1, Math.floor(p.z)) < 15) return;
    if (this.mobs.filter((m) => m.def.id === 'phantom' && !m.dead).length >= 6) return;
    const n = 1 + Math.floor(h.rng() * 3);
    for (let i = 0; i < n; i++) {
      const x = p.x + (h.rng() * 2 - 1) * 10;
      const z = p.z + (h.rng() * 2 - 1) * 10;
      const y = p.y + 20 + h.rng() * 15;
      if (h.getBlock(Math.floor(x), Math.floor(y), Math.floor(z)) !== 0) continue;
      this.spawn('phantom', x, y, z, h.rng() * Math.PI * 2);
    }
  }

  /**
   * Wandering trader spawns: vanilla rolls for one about every twenty minutes and it stays for a
   * day before wandering off, which is how a player without a village still gets trades.
   */
  /** Wandering traders leave again after their timer runs out, unless the player is trading. */
  traderDespawnTick(): void {
    for (const m of this.mobs) {
      if (m.def.id !== 'wandering_trader' || m.dead || m.extra.trading === true) continue;
      const limit = typeof m.extra.despawnAt === 'number' ? m.extra.despawnAt : 48000;
      if (m.age > limit) {
        this.host.emitParticles?.('poof', m.pos.x, m.pos.y + 1, m.pos.z, 12, m.width, m.height);
        this.remove(m);
      }
    }
  }

  traderSpawnTick(day: boolean): void {
    if (--this.traderTimer > 0) return;
    const h = this.host;
    this.traderTimer = 24000; // one in-game day between attempts
    if (!day || !h.playerTargetable()) return;
    if (h.rng() > 0.4) return; // vanilla's spawn chance climbs from 2.5%; ours is one roll a day
    if (this.mobs.some((m) => m.def.id === 'wandering_trader' && !m.dead)) return;
    const p = h.playerPos();
    const stats = mobStats('wandering_trader')!;
    for (let i = 0; i < 24; i++) {
      const x = Math.floor(p.x) + Math.floor((h.rng() * 2 - 1) * 24) + 0.5;
      const z = Math.floor(p.z) + Math.floor((h.rng() * 2 - 1) * 24) + 0.5;
      const top = h.topBlock(Math.floor(x), Math.floor(z));
      if (top < 0 || h.getSkyLight(Math.floor(x), top + 1, Math.floor(z)) < 8) continue;
      if (!Mob.fits(h, stats, x, top + 1, z)) continue;
      const m = this.spawn('wandering_trader', x, top + 1, z, h.rng() * Math.PI * 2);
      if (m) {
        m.persistent = true;
        m.extra.despawnAt = 48000; // wanders off after a couple of days, like vanilla's timer
        // vanilla brings two llamas along on leads, which is what carries the trader's goods
        for (const dx of [-1.5, 1.5]) {
          const llama = this.spawn('trader_llama', x + dx, top + 1, z, h.rng() * Math.PI * 2);
          if (llama) {
            llama.persistent = true;
            llama.extra.chest = true;
            llama.extra.trader = true;
          }
        }
      }
      return;
    }
  }

  /**
   * Pillager patrols: vanilla rolls one about every ten minutes from the fifth day on and drops a
   * band of pillagers 24 to 48 blocks from the player, one of them a captain.
   */
  patrolSpawnTick(day: number): void {
    if (--this.patrolTimer > 0) return;
    const h = this.host;
    this.patrolTimer = 12000;
    if (day < 5 || !h.playerTargetable()) return;
    if (h.rng() > 0.2) return;
    if (this.mobs.filter((m) => m.extra.patrol === true && !m.dead).length > 0) return;
    const p = h.playerPos();
    const stats = mobStats('pillager')!;
    const angle = h.rng() * Math.PI * 2;
    const dist = 24 + h.rng() * 24;
    const cx = Math.floor(p.x + Math.cos(angle) * dist);
    const cz = Math.floor(p.z + Math.sin(angle) * dist);
    const size = 2 + Math.floor(h.rng() * 4);
    let spawned = 0;
    for (let i = 0; i < 24 && spawned < size; i++) {
      const x = cx + Math.floor((h.rng() * 2 - 1) * 5) + 0.5;
      const z = cz + Math.floor((h.rng() * 2 - 1) * 5) + 0.5;
      const top = h.topBlock(Math.floor(x), Math.floor(z));
      if (top < 0 || !Mob.fits(h, stats, x, top + 1, z)) continue;
      // vanilla mixes in vindicators as the raid waves grow; a patrol is pillagers plus a captain
      const m = this.spawn(spawned === 0 ? 'pillager' : h.rng() < 0.2 ? 'vindicator' : 'pillager', x, top + 1, z, h.rng() * Math.PI * 2);
      if (m) {
        m.extra.patrol = true;
        m.persistent = true;
        if (spawned === 0) m.extra.captain = true;
      }
      spawned++;
    }
  }

  /**
   * Vanilla's ambient and underground water spawns, one attempt a tick: bats in the dark below sea
   * level, and glow squid in whatever water lies deeper still.
   */
  ambientSpawnTick(playerCx: number, playerCz: number, radius: number): void {
    const h = this.host;
    const cap = Math.max(2, Math.round((15 * h.loadedChunkCount()) / 289));
    const cx = playerCx + Math.floor(h.rng() * (radius * 2 + 1)) - radius;
    const cz = playerCz + Math.floor(h.rng() * (radius * 2 + 1)) - radius;
    if (!h.isChunkLoaded(cx, cz)) return;
    const x = cx * 16 + Math.floor(h.rng() * 16);
    const z = cz * 16 + Math.floor(h.rng() * 16);
    const top = h.topBlock(x, z);
    if (top < WORLD_MIN_Y) return;
    // vanilla turns half the bat attempts away before it looks at anything else
    const glow = h.rng() < 0.5;
    // vanilla's axolotls share the underground water with the glow squid, over a bed of clay
    const axolotl = glow && h.rng() < 0.4;
    const type = axolotl ? 'axolotl' : glow ? 'glow_squid' : 'bat';
    if (this.mobs.filter((m) => !m.dead && m.def.id === type).length >= cap) return;
    const ceiling = glow ? 30 : Math.min(top, SEA_LEVEL - 1);
    if (ceiling <= WORLD_MIN_Y + 2) return;
    const stats = mobStats(type)!;
    const p = h.playerPos();
    const want = glow ? 2 + Math.floor(h.rng() * 3) : 3 + Math.floor(h.rng() * 6);
    let spawned = 0;
    for (let i = 0; i < want * 3 && spawned < want; i++) {
      const px = x + Math.floor(h.rng() * 9) - 4 + 0.5;
      const pz = z + Math.floor(h.rng() * 9) - 4 + 0.5;
      const py = WORLD_MIN_Y + 2 + Math.floor(h.rng() * (ceiling - WORLD_MIN_Y - 2));
      if (Math.hypot(px - p.x, py - p.y, pz - p.z) < 24) continue;
      const at = h.getBlock(Math.floor(px), py, Math.floor(pz));
      const water = at !== 0 && blocks.blockOf(at).id === 'water';
      if (glow) {
        // glow squid want water with more water over it, out of the sun
        if (!water || h.getSkyLight(Math.floor(px), py, Math.floor(pz)) > 0) continue;
        // vanilla's axolotls want a lush cave, which here means clay under the water they are in
        if (axolotl) {
          let clay = false;
          for (let d = 1; d <= 5 && !clay; d++) clay = blocks.blockOf(h.getBlock(Math.floor(px), py - d, Math.floor(pz))).id === 'clay';
          if (!clay) continue;
        }
      } else {
        if (at !== 0) continue;
        if (h.getBlock(Math.floor(px), py - 1, Math.floor(pz)) === 0 && h.rng() < 0.5) continue;
        if (Math.max(h.getBlockLight(Math.floor(px), py, Math.floor(pz)), h.getSkyLight(Math.floor(px), py, Math.floor(pz))) > Math.floor(h.rng() * 4)) continue;
      }
      if (!Mob.fits(h, stats, px, py, pz)) continue;
      this.spawn(type, px, py, pz, h.rng() * Math.PI * 2);
      spawned++;
    }
  }

  /** One hostile spawn attempt per tick near the player (vanilla light rules, 24-block minimum). */
  hostileSpawnTick(playerCx: number, playerCz: number, radius: number): void {
    const h = this.host;
    const cap = Math.max(4, Math.round((this.hostileCapBase * h.loadedChunkCount()) / 289));
    if (this.count('hostile') + this.count('neutral') >= cap) return;
    const cx = playerCx + Math.floor(h.rng() * (radius * 2 + 1)) - radius;
    const cz = playerCz + Math.floor(h.rng() * (radius * 2 + 1)) - radius;
    if (!h.isChunkLoaded(cx, cz)) return;
    const x = cx * 16 + Math.floor(h.rng() * 16);
    const z = cz * 16 + Math.floor(h.rng() * 16);
    const top = h.topBlock(x, z);
    if (top < WORLD_MIN_Y) return;
    const y = WORLD_MIN_Y + 1 + Math.floor(h.rng() * (top + 2 - WORLD_MIN_Y));
    const biome = biomes[h.getBiome(x, z)];
    const centre = h.getBlock(x, y, z);
    // drowned spawn inside water in ocean and river biomes; everything else needs air on solid ground
    const inWater = centre !== 0 && blocks.blockOf(centre).id === 'water';
    if (inWater && biome?.category !== 'ocean' && biome?.category !== 'river') return;
    const nether = biome?.dimension === 'nether';
    const type = inWater && !nether ? 'drowned' : pickHostile(h.rng, biome, y, isSlimeChunk(cx, cz, h.seed), h.moonBrightness?.() ?? 1);
    const stats = mobStats(type)!;
    const packSize = type === 'creeper' || type === 'enderman' ? 1 : 1 + Math.floor(h.rng() * 4);
    const p = h.playerPos();
    let spawned = 0;
    for (let i = 0; i < packSize * 3 && spawned < packSize; i++) {
      const px = x + Math.floor(h.rng() * 9) - 4 + 0.5;
      const pz = z + Math.floor(h.rng() * 9) - 4 + 0.5;
      const py = y;
      if (Math.hypot(px - p.x, py - p.y, pz - p.z) < 24) continue;
      const below = h.getBlock(Math.floor(px), py - 1, Math.floor(pz));
      if (below === 0) continue;
      const at = h.getBlock(Math.floor(px), py, Math.floor(pz));
      const above = h.getBlock(Math.floor(px), py + 1, Math.floor(pz));
      const isWater = (s: number) => s !== 0 && blocks.blockOf(s).id === 'water';
      const isLava = (s: number) => s !== 0 && blocks.blockOf(s).id === 'lava';
      if (inWater) {
        if (!isWater(at) || (above !== 0 && !isWater(above))) continue;
      } else if (type === 'strider') {
        // striders come up out of the lava they live on
        if (!isLava(below) || at !== 0 || above !== 0) continue;
      } else {
        if (!blocks.blockOf(below).solid || blocks.blockOf(below).behavior === 'fluid') continue;
        if (at !== 0 || above !== 0) continue;
      }
      const bx = Math.floor(px);
      const bz = Math.floor(pz);
      // vanilla's nether mobs come out whatever the light is; everything else needs the dark
      if (!nether) {
        if (h.getBlockLight(bx, py, bz) > 0) continue;
        const raw = Math.max(h.getBlockLight(bx, py, bz), h.getSkyLight(bx, py, bz) - h.skyDarken());
        if (raw > Math.floor(h.rng() * 8)) continue;
      }
      if (!Mob.fits(h, stats, px, py, pz)) continue;
      this.spawn(type, px, py, pz, h.rng() * Math.PI * 2);
      spawned++;
    }
  }
}

function rayBox(o: THREE.Vector3, d: THREE.Vector3, b: AABB): number | null {
  let tmin = -Infinity;
  let tmax = Infinity;
  const axes: [number, number, number, number][] = [[o.x, d.x, b.minX, b.maxX], [o.y, d.y, b.minY, b.maxY], [o.z, d.z, b.minZ, b.maxZ]];
  for (const [oo, dd, lo, hi] of axes) {
    if (Math.abs(dd) < 1e-9) {
      if (oo < lo || oo > hi) return null;
      continue;
    }
    let t1 = (lo - oo) / dd;
    let t2 = (hi - oo) / dd;
    if (t1 > t2) [t1, t2] = [t2, t1];
    tmin = Math.max(tmin, t1);
    tmax = Math.min(tmax, t2);
    if (tmin > tmax) return null;
  }
  if (tmax < 0) return null;
  return Math.max(0, tmin);
}
