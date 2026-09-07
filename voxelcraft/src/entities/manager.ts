/** Owns mobs and arrows: ticking, rendering, spawning, per-chunk persistence and hit tests. */
import * as THREE from 'three';
import { Mob, type MobSave, type MobWorld } from './mob.ts';
import { Arrow } from './arrow.ts';
import { ANIMAL_TYPES, CAT_VARIANTS, EQUINE_TYPES, HORSE_COATS, MOB_SPECS, initEquine, isSlimeChunk, mobStats, phantomSpawnChance, pickHostile, randomSheepColor, wolfVariantFor } from './mobTypes.ts';
import { aabbIntersects, type AABB } from './physics.ts';
import { chunkKey } from '../world/chunk.ts';
import { blocks } from '../blocks/registry.ts';
import { WORLD_MIN_Y } from '../core/constants.ts';
import { biomes } from '../world/biomes.ts';

export interface ManagerHost extends MobWorld {
  scene: THREE.Scene;
  base: string;
  /** World seed (slime chunks). */
  seed: number;
  isChunkLoaded(cx: number, cz: number): boolean;
  loadedChunkCount(): number;
  /** Called when a mob dies: drops and XP. */
  onMobDeath(mob: Mob): void;
  getBiome(x: number, z: number): number;
  topBlock(x: number, z: number): number;
  arrowHitMob?: (box: AABB, damage: number) => boolean;
}

/** Biomes whose animal groups can be horse or donkey herds (vanilla plains and savannas). */
const HORSE_BIOMES = new Set(['plains', 'sunflower_plains', 'savanna', 'savanna_plateau', 'windswept_savanna']);

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
    if (type === 'cat') m.extra.variant = CAT_VARIANTS[Math.floor(this.host.rng() * CAT_VARIANTS.length)];
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
        if (a.effect) h.addPlayerEffect(a.effect.id, a.effect.ticks, a.effect.amplifier ?? 0);
      }, a.fromPlayer && h.arrowHitMob ? (box) => h.arrowHitMob!(box, Math.max(1, Math.ceil(a.damage * Math.max(1, a.vel.length())))) : undefined);
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
      this.spawnFishSchool(x, z, biome.category === 'river' || biome.id.includes('cold') || biome.id.includes('frozen') ? 'salmon' : 'cod');
      return;
    }
    if (biome.surface.top !== 'grass_block' || biome.category === 'mushroom') return;
    const wolfVariant = wolfVariantFor(biome.id);
    // vanilla spawns ocelots only in the jungles, in pairs
    const ocelot = biome.category === 'jungle' && h.rng() < 0.25;
    // vanilla plains and savannas spawn herds of horses, and one in five of those is a donkey
    const equine = HORSE_BIOMES.has(biome.id) && h.rng() < 0.4;
    const type = ocelot ? 'ocelot' : equine ? (h.rng() < 0.2 ? 'donkey' : 'horse') : wolfVariant && h.rng() < 1 / 6 ? 'wolf' : ANIMAL_TYPES[Math.floor(h.rng() * ANIMAL_TYPES.length)];
    const stats = mobStats(type)!;
    // horse herds share one coat like vanilla's group spawn
    const herdCoat = HORSE_COATS[Math.floor(h.rng() * HORSE_COATS.length)];
    const want = ocelot ? 2 : equine ? 2 + Math.floor(h.rng() * 5) : 4;
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
      spawned++;
    }
  }

  /** Cod and salmon schools in ocean and river water. */
  private spawnFishSchool(x: number, z: number, type: 'cod' | 'salmon'): void {
    const h = this.host;
    const stats = mobStats(type)!;
    const want = 3 + Math.floor(h.rng() * 4);
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
    const type = inWater ? 'drowned' : pickHostile(h.rng, biome, y, isSlimeChunk(cx, cz, h.seed));
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
      if (inWater) {
        if (!isWater(at) || (above !== 0 && !isWater(above))) continue;
      } else {
        if (!blocks.blockOf(below).solid || blocks.blockOf(below).behavior === 'fluid') continue;
        if (at !== 0 || above !== 0) continue;
      }
      const bx = Math.floor(px);
      const bz = Math.floor(pz);
      if (h.getBlockLight(bx, py, bz) > 0) continue;
      const raw = Math.max(h.getBlockLight(bx, py, bz), h.getSkyLight(bx, py, bz) - h.skyDarken());
      if (raw > Math.floor(h.rng() * 8)) continue;
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
