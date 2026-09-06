/**
 * Game session: wires the renderer, world, player, HUD and input together, runs the fixed-step
 * simulation, and implements block interaction (mining with vanilla break times, placement with
 * state selection, drops), survival stats, the day cycle, commands and saving.
 */
import * as THREE from 'three';
import { BLOCK_REACH, DAY_LENGTH, SEA_LEVEL, WORLD_MAX_Y, WORLD_MIN_Y } from './constants.ts';
import { GameLoop } from './loop.ts';
import { Input } from './input.ts';
import type { Options, SaveManager, WorldMeta } from './save.ts';
import { GameRenderer } from '../render/renderer.ts';
import { createChunkMaterials, type ChunkUniforms } from '../render/chunkMaterial.ts';
import { Sky } from '../render/sky.ts';
import { applyMipLimit, type LoadedAtlas } from '../render/atlas.ts';
import { AtlasIndex } from '../render/atlasIndex.ts';
import { World, FACE_NORMALS, type RaycastHit } from '../world/world.ts';
import { ModelBaker, type ModelsJson } from '../world/models.ts';
import { Player } from '../entities/player.ts';
import { ItemEntity } from '../entities/itemEntity.ts';
import { blocks, type BlockDef } from '../blocks/registry.ts';
import { collisionBoxes } from '../blocks/collision.ts';
import { breakTicks, canHarvest } from '../blocks/mining.ts';
import { blockDrops } from '../items/loot.ts';
import { items } from '../items/registry.ts';
import type { ItemStack } from '../items/inventory.ts';
import { Hud, xpForLevel } from '../ui/hud.ts';
import { Chat } from '../ui/chat.ts';
import { ItemIcons } from '../ui/icons.ts';
import type { Menus } from '../ui/menus.ts';
import { biomes } from '../world/biomes.ts';
import { MC_VERSION } from './constants.ts';
import { ContainerScreen, type ScreenDef } from '../ui/screens/container.ts';
import { chestScreen, craftingTableScreen, dispenserScreen, furnaceScreen, hopperScreen, inventoryScreen, makeGrid, type CraftingGrid } from '../ui/screens/screens.ts';
import { containerKind, createBlockEntity, type ContainerEntity, type FurnaceEntity } from '../blocks/blockEntity.ts';
import { tickFurnace } from '../blocks/furnace.ts';
import type { Slot } from '../items/inventory.ts';
import { Simulation } from '../world/simulation.ts';
import { applyBoneMeal, behaviorFor, type BlockWorld } from '../blocks/behaviors.ts';
import { BlockMeshFactory } from '../render/blockMesh.ts';
import { FallingBlockEntity } from '../entities/fallingBlock.ts';
import { Rng } from './rng.ts';
import { WATER_DELAY, LAVA_DELAY } from '../world/fluids.ts';
import { EntityManager, type ManagerHost } from '../entities/manager.ts';
import { type Mob } from '../entities/mob.ts';
import { entityDrops } from '../items/loot.ts';
import { explode, exposure, explosionDamage } from '../world/explosion.ts';
import { mobStats } from '../entities/mobTypes.ts';
import type { AABB } from '../entities/physics.ts';

export interface GameAssets {
  blocks: LoadedAtlas;
  items: LoadedAtlas;
  models: ModelsJson;
}

export interface GameOptions {
  container: HTMLElement;
  assets: GameAssets;
  save: SaveManager;
  meta: WorldMeta;
  options: Options;
  menus: Menus;
}

type State = 'loading' | 'playing' | 'paused' | 'chat' | 'dead' | 'gui';

const isReplaceable = (def: BlockDef): boolean => !!def.replaceable || def.behavior === 'air';

export class Game {
  readonly renderer: GameRenderer;
  readonly world: World;
  readonly player = new Player();
  readonly input: Input;
  readonly loop: GameLoop;
  readonly sky: Sky;
  readonly hud: Hud;
  readonly chat: Chat;
  readonly icons: ItemIcons;
  readonly baker: ModelBaker;
  readonly uniforms: ChunkUniforms;
  readonly itemEntities: ItemEntity[] = [];
  readonly meta: WorldMeta;
  time: number;
  tickCount = 0;
  state: State = 'loading';
  private options: Options;
  private readonly save: SaveManager;
  private readonly menus: Menus;
  private readonly outline: THREE.LineSegments;
  private readonly crack: THREE.Mesh;
  private target: RaycastHit | null = null;
  private breaking: { x: number; y: number; z: number; state: number; progress: number; ticks: number } | null = null;
  private useCooldown = 0;
  private autosaveTimer = 0;
  private lastSaveAt = 0;
  private readonly tmpDir = new THREE.Vector3();
  private readonly tmpEye = new THREE.Vector3();
  private readonly crackTiles: number[] = [];
  private lastCrackStage = -1;
  private unloadHandler = () => void this.saveAll();
  thirdPerson = 0;
  screen: ContainerScreen | null = null;
  private screenCleanup: (() => void) | null = null;
  private screenTicks = 0;
  readonly simulation: Simulation;
  readonly blockMeshes: BlockMeshFactory;
  readonly fallingBlocks: FallingBlockEntity[] = [];
  private eating: { ticks: number; total: number; id: string } | null = null;
  private sleeping = 0;
  entities!: EntityManager;
  private attackTicks = 100;
  private readonly animalChunks: Set<string>;

  constructor(opts: GameOptions) {
    this.meta = opts.meta;
    this.save = opts.save;
    this.options = opts.options;
    this.menus = opts.menus;
    this.time = opts.meta.time ?? 1000;
    this.renderer = new GameRenderer(opts.container, opts.options.fov);
    const mats = createChunkMaterials(opts.assets.blocks);
    this.uniforms = mats.uniforms;
    applyMipLimit(this.renderer.renderer, opts.assets.blocks.texture, 4);
    this.sky = new Sky(import.meta.env.BASE_URL);
    this.renderer.scene.add(this.sky.group);
    const atlasIndex = new AtlasIndex({ width: opts.assets.blocks.index.width, height: opts.assets.blocks.index.height, tiles: opts.assets.blocks.index.tiles });
    this.baker = new ModelBaker(opts.assets.models, atlasIndex);
    this.icons = new ItemIcons(opts.assets.blocks, opts.assets.items, this.baker);
    this.world = new World({
      seed: opts.meta.seed,
      renderDistance: opts.options.renderDistance,
      scene: this.renderer.scene,
      solidMaterial: mats.solid,
      translucentMaterial: mats.translucent,
      models: opts.assets.models,
      atlas: { width: atlasIndex.width, height: atlasIndex.height, tiles: atlasIndex.tiles },
      loadChunk: (cx, cz) => this.save.loadChunk(this.meta.id, cx, cz),
    });
    this.input = new Input(this.renderer.canvas);
    this.blockMeshes = new BlockMeshFactory(this.baker, opts.assets.blocks);
    const rng = new Rng((Date.now() ^ opts.meta.seed) >>> 0);
    const blockWorld: BlockWorld = {
      rng,
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      setBlock: (x, y, z, state) => { this.world.setBlock(x, y, z, state); },
      breakBlock: (x, y, z) => this.breakBlock(x, y, z, true),
      schedule: (x, y, z, delay) => this.simulation.schedule(x, y, z, delay, this.tickCount),
      getLight: (x, y, z) => this.world.getLight(x, y, z, this.skyDarken()),
      getSkyLight: (x, y, z) => this.world.getSkyLight(x, y, z),
      startFalling: (x, y, z, state) => this.startFalling(x, y, z, state),
      isDay: () => this.isDay(),
      message: (text) => this.chat.addLine(text, '#fa5'),
      sleep: (x, y, z) => this.sleepInBed(x, y, z),
      addXp: (n) => this.addXp(n),
      feed: (n, sat) => this.feed(n, sat),
      dropItem: (id, count, x, y, z) => { this.dropStack({ id, count }, x, y, z, true); },
    };
    this.simulation = new Simulation(blockWorld, () => this.world.chunks.values());
    this.world.onBlockChanged = (x, y, z, o, n) => this.simulation.onBlockChanged(x, y, z, o, n);
    this.animalChunks = new Set(opts.meta.animalChunks ?? []);
    const game = this;
    const host: ManagerHost = {
      scene: this.renderer.scene,
      base: import.meta.env.BASE_URL,
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      isDay: () => this.isDay(),
      getSkyLight: (x, y, z) => this.world.getSkyLight(x, y, z),
      getBlockLight: (x, y, z) => this.world.getBlockLight(x, y, z),
      skyDarken: () => this.skyDarken(),
      playerPos: () => this.player.pos,
      playerEye: () => this.player.eyePosition(1),
      playerBox: () => this.player.aabb(),
      playerTargetable: () => !this.player.dead && this.player.gamemode === 'survival',
      hurtPlayer: (amount, from) => this.hurtByMob(amount, from),
      shootArrow: (from, to, v, d) => this.entities.shootArrow(from, to, v, d),
      explode: (x, y, z, power, source) => this.explodeAt(x, y, z, power, source),
      lineOfSight: (a, b) => this.lineOfSight(a, b),
      get time() { return game.time; },
      rng: () => rng.next(),
      isChunkLoaded: (cx, cz) => !!this.world.getChunk(cx, cz),
      loadedChunkCount: () => this.world.chunks.size,
      onMobDeath: (m) => this.onMobDeath(m),
      getBiome: (x, z) => this.world.getBiome(x, z),
      topBlock: (x, z) => this.world.topBlock(x, z),
      arrowHitMob: (box, damage) => {
        const hit = this.entities.mobsIntersecting(box)[0];
        if (!hit) return false;
        hit.hurt(damage, this.player.pos, 'player', 0.3);
        return true;
      },
    };
    this.entities = new EntityManager(host);
    this.world.onChunkLoaded = (cx, cz) => this.onChunkLoaded(cx, cz);
    this.world.onChunkUnloaded = (c) => {
      const mobs = this.entities.serializeChunk(c.cx, c.cz);
      for (const m of this.entities.mobs.slice()) if ((Math.floor(m.pos.x) >> 4) === c.cx && (Math.floor(m.pos.z) >> 4) === c.cz) this.entities.remove(m);
      if (mobs.length) void this.save.saveChunks(this.meta.id, [{ cx: c.cx, cz: c.cz, blocks: c.blocks, biomes: c.biomes, entities: this.world.serializeEntities(c), mobs: JSON.stringify(mobs) }]);
    };
    this.hud = new Hud(opts.container, this.icons);
    this.chat = new Chat(opts.container);
    this.chat.onSubmit = (t) => this.handleChat(t);
    this.chat.onClose = () => {
      if (this.state === 'chat') {
        this.state = 'playing';
        this.input.enabled = true;
        this.input.requestLock();
      }
    };
    // selection outline
    this.outline = new THREE.LineSegments(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthTest: true }));
    this.outline.visible = false;
    this.outline.renderOrder = 20;
    this.renderer.scene.add(this.outline);
    // crack overlay
    for (let i = 0; i < 10; i++) this.crackTiles.push(opts.assets.blocks.index.tile(`block/destroy_stage_${i}`));
    const crackGeo = new THREE.BoxGeometry(1.004, 1.004, 1.004);
    const crackMat = new THREE.MeshBasicMaterial({ map: opts.assets.blocks.texture, transparent: true, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, alphaTest: 0.05 });
    this.crack = new THREE.Mesh(crackGeo, crackMat);
    this.crack.visible = false;
    this.crack.renderOrder = 15;
    this.renderer.scene.add(this.crack);
    this.player.gamemode = opts.meta.gamemode;
    this.tickAtlas = opts.assets.blocks.tick;
    this.loop = new GameLoop(() => this.tick(), (a, dt) => this.render(a, dt));
    this.input.onLockChange = (locked) => {
      if (!locked && this.state === 'playing') this.pause();
    };
    window.addEventListener('beforeunload', this.unloadHandler);
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------
  async start(progress: (text: string, p: number) => void): Promise<void> {
    const meta = this.meta;
    if (meta.player) {
      this.player.restore(meta.player);
    } else {
      this.player.teleport(0.5, 200, 0.5);
      this.player.yaw = 0;
    }
    this.world.update(this.player.pos.x, this.player.pos.z);
    // wait for the chunks around the player
    const need = 1;
    const pcx = Math.floor(this.player.pos.x) >> 4;
    const pcz = Math.floor(this.player.pos.z) >> 4;
    const total = (need * 2 + 1) ** 2;
    await new Promise<void>((resolve) => {
      const check = () => {
        let n = 0;
        for (let dz = -need; dz <= need; dz++) for (let dx = -need; dx <= need; dx++) if (this.world.getChunk(pcx + dx, pcz + dz)) n++;
        progress('Building terrain...', n / total);
        if (n === total) resolve();
        else setTimeout(check, 50);
      };
      check();
    });
    if (!meta.player) this.findSpawn();
    this.state = 'playing';
    this.input.enabled = true;
    this.loop.start();
    this.lastSaveAt = performance.now();
    this.input.requestLock();
    this.chat.addLine(`Welcome to Voxelcraft (Minecraft ${MC_VERSION} rules). Seed: ${this.meta.seedText || this.meta.seed}`, '#ff5');
  }

  private findSpawn(): void {
    // walk outward from 0,0 to find a dry surface column
    for (let r = 0; r < 64; r++) {
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const x = dx;
          const z = dz;
          if (!this.world.isLoaded(x, z)) continue;
          const top = this.world.topBlock(x, z);
          if (top < SEA_LEVEL - 1) continue;
          const s = this.world.getBlock(x, top, z);
          const def = blocks.blockOf(s);
          if (def.behavior === 'fluid' || def.behavior === 'leaves' || def.behavior === 'log') continue;
          const y = top + 1;
          if (this.world.getBlock(x, y, z) !== 0 || this.world.getBlock(x, y + 1, z) !== 0) continue;
          this.player.teleport(x + 0.5, y, z + 0.5);
          this.player.spawn = [x + 0.5, y, z + 0.5];
          return;
        }
    }
    const top = this.world.topBlock(0, 0);
    this.player.teleport(0.5, top + 1, 0.5);
    this.player.spawn = [0.5, top + 1, 0.5];
  }

  pause(): void {
    if (this.state !== 'playing') return;
    this.state = 'paused';
    this.input.enabled = false;
    this.input.exitLock();
    this.menus.showPause();
    void this.saveAll();
  }

  resume(): void {
    if (this.state !== 'paused') return;
    this.menus.hide();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
  }

  respawn(): void {
    this.player.health = 20;
    this.player.food = 20;
    this.player.saturation = 5;
    this.player.dead = false;
    this.player.fallDistance = 0;
    const [x, y, z] = this.player.spawn;
    this.player.teleport(x, y, z);
    this.menus.hide();
    this.state = 'playing';
    this.input.enabled = true;
    this.input.requestLock();
  }

  async quit(): Promise<void> {
    this.closeScreen();
    this.loop.stop();
    window.removeEventListener('beforeunload', this.unloadHandler);
    await this.saveAll();
    this.input.exitLock();
    this.world.dispose();
    this.hud.root.remove();
    this.chat.root.remove();
    this.renderer.renderer.dispose();
    this.renderer.canvas.remove();
  }

  applyOptions(o: Options): void {
    this.options = o;
    this.renderer.setFov(o.fov);
    if (o.renderDistance !== this.world.renderDistance) {
      this.world.setRenderDistance(o.renderDistance);
      this.world.update(this.player.pos.x, this.player.pos.z);
    }
    this.uniforms.gamma.value = o.gamma;
  }

  async saveAll(): Promise<void> {
    const dirty: { cx: number; cz: number; blocks: Uint16Array; biomes: Uint8Array; entities: string | null; mobs: string | null }[] = [];
    const mobChunks = new Set<string>();
    for (const m of this.entities.mobs) if (!m.dead) mobChunks.add(`${Math.floor(m.pos.x) >> 4},${Math.floor(m.pos.z) >> 4}`);
    for (const c of this.world.chunks.values()) {
      const key = `${c.cx},${c.cz}`;
      if (c.modified || mobChunks.has(key)) {
        const mobs = this.entities.serializeChunk(c.cx, c.cz);
        dirty.push({ cx: c.cx, cz: c.cz, blocks: c.blocks, biomes: c.biomes, entities: this.world.serializeEntities(c), mobs: mobs.length ? JSON.stringify(mobs) : null });
        this.world.markSaved(c);
      }
    }
    this.meta.animalChunks = [...this.animalChunks];
    this.meta.time = this.time;
    this.meta.lastPlayed = Date.now();
    this.meta.player = this.player.serialize();
    this.meta.gamemode = this.player.gamemode === 'creative' ? 'creative' : 'survival';
    try {
      await Promise.all([this.save.saveChunks(this.meta.id, dirty), this.save.saveWorld(this.meta)]);
    } catch (e) {
      console.error('save failed', e);
    }
    this.lastSaveAt = performance.now();
  }

  // ---------------------------------------------------------------------------------------------
  // Simulation
  // ---------------------------------------------------------------------------------------------
  private tick(): void {
    this.tickCount++;
    if (this.state === 'playing' || this.state === 'chat' || this.state === 'dead' || this.state === 'gui') this.time++;
    if (this.state !== 'playing' && this.state !== 'chat' && this.state !== 'gui') {
      this.player.prevPos.copy(this.player.pos);
      return;
    }
    this.tickBlockEntities();
    const pcx = Math.floor(this.player.pos.x) >> 4;
    const pcz = Math.floor(this.player.pos.z) >> 4;
    this.simulation.tick(this.tickCount, pcx, pcz);
    this.tickFallingBlocks();
    this.tickEffects();
    this.attackTicks++;
    this.entities.tick(this.player.dead ? null : this.player.aabb());
    if (this.player.gamemode !== 'creative' || true) this.entities.hostileSpawnTick(pcx, pcz, Math.min(6, this.world.renderDistance));
    if (this.sleeping > 0 && --this.sleeping === 0) {
      const day = Math.floor(this.time / DAY_LENGTH);
      this.time = (day + 1) * DAY_LENGTH;
      this.chat.addLine('Good morning!', '#5f5');
    }
    this.world.flush();
    if (this.screen) {
      this.screen.tick();
      if (++this.screenTicks % 5 === 0) this.screen.refresh();
    }
    const p = this.player;
    if (this.state === 'playing') this.handleHotbarKeys();
    p.tick(this.input, this.world, this.tickCount);
    this.survivalTick();
    if (this.state === 'playing') this.interactionTick();
    for (const e of this.itemEntities) {
      e.tick(this.world);
      if (!e.dead && e.pickupDelay === 0 && !p.dead) {
        const d = e.pos.distanceTo(p.pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
        if (d < 1.6) {
          const left = p.inventory.add(e.stack);
          if (left === 0) e.dead = true;
          else e.stack.count = left;
        }
      }
    }
    for (let i = this.itemEntities.length - 1; i >= 0; i--) {
      if (this.itemEntities[i].dead) {
        this.renderer.scene.remove(this.itemEntities[i].sprite);
        this.itemEntities.splice(i, 1);
      }
    }
    if (p.hurtTime > 0) p.hurtTime--;
    if (this.useCooldown > 0) this.useCooldown--;
    if (++this.autosaveTimer >= 20 * 60) {
      this.autosaveTimer = 0;
      void this.saveAll();
    }
    this.input.endTick();
  }

  private survivalTick(): void {
    const p = this.player;
    if (p.gamemode !== 'survival' || p.dead) return;
    // fall damage
    if (p.landed > 0) {
      const dmg = Math.floor(p.landed - 3);
      p.landed = 0;
      if (dmg > 0 && !p.inWater) this.damage(dmg);
    }
    if (p.inLava && !p.effects.get('fire_resistance')) this.damage(4, true);
    // void
    if (p.pos.y < WORLD_MIN_Y - 4) this.damage(4, true);
    // drowning
    const eye = p.pos.clone();
    eye.y += p.eyeHeight;
    const eyeState = this.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const submerged = eyeState !== 0 && blocks.blockOf(eyeState).id === 'water';
    if (submerged && !p.effects.get('water_breathing')) {
      p.air--;
      if (p.air <= -20) {
        p.air = 0;
        this.damage(2, true);
      }
    } else p.air = Math.min(300, p.air + 4);
    // hunger and regeneration
    if (p.exhaustion >= 4) {
      p.exhaustion -= 4;
      if (p.saturation > 0) p.saturation = Math.max(0, p.saturation - 1);
      else p.food = Math.max(0, p.food - 1);
    }
    if (p.food >= 18 && p.health < 20 && this.tickCount % 80 === 0) {
      p.health = Math.min(20, p.health + 1);
      p.exhaustion += 6;
    }
    if (p.food <= 0 && this.tickCount % 80 === 0 && p.health > 10) this.damage(1, true);
  }

  damage(amount: number, ignoreCooldown = false): void {
    const p = this.player;
    if (p.gamemode !== 'survival' || p.dead) return;
    if (!ignoreCooldown && p.hurtTime > 0) return;
    const resistance = p.effects.level('resistance');
    if (resistance) amount = Math.max(0, amount * (1 - 0.2 * resistance));
    p.health = Math.max(0, p.health - amount);
    p.hurtTime = 10;
    if (p.health <= 0) {
      this.closeScreen();
      p.dead = true;
      this.state = 'dead';
      this.input.enabled = false;
      this.input.exitLock();
      this.menus.showDeath();
      // drop inventory
      for (let i = 0; i < 36; i++) {
        const s = p.inventory.slots[i];
        if (s) this.dropStack(s, p.pos.x, p.pos.y + 1, p.pos.z, true);
        p.inventory.slots[i] = null;
      }
      p.inventory.version++;
    }
  }

  private handleHotbarKeys(): void {
    const inv = this.player.inventory;
    for (let i = 1; i <= 9; i++) if (this.input.tickPressed(`hotbar${i}` as 'hotbar1')) inv.selected = i - 1;
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) inv.selected = (((inv.selected + wheel) % 9) + 9) % 9;
    if (this.input.tickPressed('drop')) {
      const s = inv.selectedStack;
      if (s) {
        const n = this.input.isDown('sprint') ? s.count : 1;
        const thrown = { ...s, count: n };
        s.count -= n;
        if (s.count <= 0) inv.slots[inv.selected] = null;
        inv.version++;
        const eye = this.player.eyePosition(1);
        const dir = this.player.lookDirection();
        const e = this.dropStack(thrown, eye.x, eye.y - 0.3, eye.z, false);
        e.vel.copy(dir).multiplyScalar(0.3);
        e.vel.y += 0.1;
        e.pickupDelay = 40;
      }
    }
    if (this.input.tickPressed('swapHands')) {
      const s = inv.selectedStack;
      inv.slots[inv.selected] = inv.offhand;
      inv.offhand = s;
      inv.version++;
    }
  }

  dropStack(stack: ItemStack, x: number, y: number, z: number, scatter: boolean): ItemEntity {
    const def = items.byId.get(stack.id);
    const e = new ItemEntity(stack, x, y, z, this.icons.icon(stack.id), !!def?.block);
    if (scatter) {
      e.vel.set((Math.random() - 0.5) * 0.2, 0.2, (Math.random() - 0.5) * 0.2);
    }
    this.itemEntities.push(e);
    this.renderer.scene.add(e.sprite);
    return e;
  }

  // ---------------------------------------------------------------------------------------------
  // Interaction
  // ---------------------------------------------------------------------------------------------
  private updateTarget(): void {
    const p = this.player;
    const eye = p.eyePosition(1, this.tmpEye);
    const dir = p.lookDirection(this.tmpDir);
    const reach = p.gamemode === 'creative' ? 5 : BLOCK_REACH;
    this.target = this.world.raycast(eye, dir, reach, false);
  }

  private interactionTick(): void {
    this.updateTarget();
    const p = this.player;
    const t = this.target;
    // attacking mobs takes precedence over mining
    if (this.input.tickClicked(0) && !p.dead) {
      const eye = p.eyePosition(1, this.tmpEye);
      const dir = p.lookDirection(this.tmpDir);
      const hit = this.entities.raycast(eye, dir, 3);
      if (hit && (!t || hit.distance < t.distance)) {
        this.attackMob(hit.mob);
        this.breaking = null;
        this.useCooldown = 5;
        return;
      }
    }
    // mining
    if (this.input.isMouseDown(0) && t && !p.dead) {
      if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z || this.breaking.state !== t.state) {
        const ticks = breakTicks(t.state, p.heldItem(), { onGround: p.onGround, inWater: p.inWater, creative: p.gamemode === 'creative', haste: p.effects.level('haste'), miningFatigue: p.effects.level('mining_fatigue') });
        this.breaking = { x: t.x, y: t.y, z: t.z, state: t.state, progress: 0, ticks };
      }
      const b = this.breaking;
      if (b.ticks === 0) {
        this.breakBlock(b.x, b.y, b.z);
        this.breaking = null;
        this.useCooldown = 5;
      } else if (b.ticks !== Infinity) {
        b.progress += 1 / b.ticks;
        if (b.progress >= 1) {
          this.breakBlock(b.x, b.y, b.z);
          this.breaking = null;
          this.useCooldown = 5;
        }
      }
    } else {
      this.breaking = null;
    }
    // using: interactive blocks first (unless sneaking), then the held item, then placing
    const held = p.heldItem();
    const heldDef = held ? items.byId.get(held.id) : undefined;
    if (this.input.isMouseDown(2) && !p.dead && heldDef?.food && this.canEat(heldDef)) {
      if (!this.eating || this.eating.id !== held!.id) this.eating = { ticks: 0, total: heldDef.food.eatTicks ?? 32, id: held!.id };
      if (++this.eating.ticks >= this.eating.total) {
        this.eat(heldDef);
        this.eating = null;
        this.useCooldown = 8;
      }
    } else {
      this.eating = null;
      if (this.input.tickClicked(2) && t && !p.dead && !p.sneaking && this.useBlock(t)) {
        this.useCooldown = 4;
      } else if (this.input.isMouseDown(2) && this.useCooldown === 0 && !p.dead) {
        if (t) {
          const def = blocks.blockOf(t.state);
          const interactive = !p.sneaking && (def.behavior === 'container' || def.behavior === 'workstation' || !!behaviorFor(def)?.onUse);
          if (!interactive) this.useItem(t);
        } else this.useItem(null);
        this.useCooldown = 4;
      }
    }
    // pick block (creative)
    if (this.input.tickClicked(1) && t && p.gamemode === 'creative') {
      const def = blocks.blockOf(t.state);
      const item = items.byBlock.get(def.id) ?? items.byId.get(def.id);
      if (item) {
        const inv = p.inventory;
        const existing = inv.slots.findIndex((s, i) => i < 9 && s?.id === item.id);
        if (existing >= 0) inv.selected = existing;
        else {
          inv.slots[inv.selected] = { id: item.id, count: 1 };
          inv.version++;
        }
      }
    }
  }

  /** Breaks a block: drops (unless creative or `byWorld` with no harvest tool), block entity cleanup. */
  breakBlock(x: number, y: number, z: number, byWorld = false): void {
    const state = this.world.getBlock(x, y, z);
    if (state === 0) return;
    const def = blocks.blockOf(state);
    if (def.behavior === 'fluid' || def.behavior === 'air') {
      this.world.setBlock(x, y, z, 0);
      return;
    }
    if (def.hardness < 0 && this.player.gamemode !== 'creative' && !byWorld) return;
    const p = this.player;
    const held = byWorld ? null : p.heldItem();
    if (byWorld) {
      for (const drop of blockDrops(state, null)) this.dropStack(drop, x + 0.5, y + 0.5, z + 0.5, true);
    } else if (p.gamemode === 'survival') {
      if (canHarvest(state, held)) {
        for (const drop of blockDrops(state, held)) this.dropStack(drop, x + 0.5, y + 0.5, z + 0.5, true);
      }
      if (held && items.byId.get(held.id)?.durability && def.hardness > 0) p.inventory.damageSelected(1);
      p.exhaustion += 0.005;
    }
    // containers spill their contents (ender chests keep theirs with the player)
    const entity = this.world.getBlockEntity(x, y, z);
    if (entity) {
      for (const s of entity.items) if (s) this.dropStack(s, x + 0.5, y + 0.5, z + 0.5, true);
      this.world.setBlockEntity(x, y, z, null);
      if (def.id === 'chest' || def.id === 'trapped_chest') this.unpairChest(x, y, z, state);
    }
    // remove the other half of two-block plants / doors
    const half = blocks.prop(state, 'half');
    if (half === 'lower' && this.world.getBlock(x, y + 1, z) !== 0 && blocks.stateBlock[this.world.getBlock(x, y + 1, z)] === blocks.stateBlock[state]) this.world.setBlock(x, y + 1, z, 0);
    if (half === 'upper' && blocks.stateBlock[this.world.getBlock(x, y - 1, z)] === blocks.stateBlock[state]) this.world.setBlock(x, y - 1, z, 0);
    this.world.setBlock(x, y, z, 0);
    // let unsupported decorations above fall off
    const above = this.world.getBlock(x, y + 1, z);
    if (above !== 0) {
      const ad = blocks.blockOf(above);
      if (ad.behavior === 'plant' || ad.behavior === 'crop' || ad.behavior === 'sapling' || ad.behavior === 'snow_layer' || ad.behavior === 'growing') {
        this.breakBlock(x, y + 1, z);
      }
    }
  }

  private placeBlock(t: RaycastHit): boolean {
    const p = this.player;
    const held = p.heldItem();
    if (!held) return false;
    const item = items.byId.get(held.id);
    if (!item?.block || !blocks.has(item.block)) return false;
    const def = blocks.get(item.block);
    const targetDef = blocks.blockOf(t.state);
    let x = t.x;
    let y = t.y;
    let z = t.z;
    let replacing = false;
    // snow layers stack up to 8
    if (def.id === 'snow' && targetDef.id === 'snow') {
      const layers = Number(blocks.prop(t.state, 'layers') ?? 1);
      if (layers < 8) {
        this.world.setBlock(t.x, t.y, t.z, blocks.withProp(t.state, 'layers', String(layers + 1)));
        if (p.gamemode === 'survival') p.inventory.consumeSelected();
        return true;
      }
    }
    // slab merging
    if (def.behavior === 'slab' && targetDef.id === def.id) {
      const type = blocks.prop(t.state, 'type');
      if ((type === 'bottom' && t.face === 1) || (type === 'top' && t.face === 0)) {
        this.world.setBlock(x, y, z, blocks.stateWith(def, { type: 'double', waterlogged: 'false' }));
        if (p.gamemode === 'survival') p.inventory.consumeSelected();
        return true;
      }
    }
    if (isReplaceable(targetDef) && targetDef.behavior !== 'air') {
      replacing = true;
    } else {
      const n = FACE_NORMALS[t.face];
      x += n[0];
      y += n[1];
      z += n[2];
    }
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return false;
    const existing = this.world.getBlock(x, y, z);
    if (!replacing && existing !== 0 && !isReplaceable(blocks.blockOf(existing))) return false;
    if (def.behavior === 'bed') return this.placeBed(def, x, y, z);
    const state = this.placementState(def, t, existing);
    if (state === null) return false;
    // don't place inside the player
    const boxes = collisionBoxes(state).map((b) => [x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
    if (p.intersectsBoxes(boxes)) return false;
    for (const e of this.itemEntities) if (boxes.some((b) => e.pos.x > b[0] - 0.2 && e.pos.x < b[3] + 0.2 && e.pos.y > b[1] - 0.3 && e.pos.y < b[4] && e.pos.z > b[2] - 0.2 && e.pos.z < b[5] + 0.2)) e.vel.y = 0.2;
    // support requirements for plants
    if (def.behavior === 'plant' || def.behavior === 'sapling' || def.behavior === 'crop') {
      const below = this.world.getBlock(x, y - 1, z);
      if (below === 0 || !blocks.blockOf(below).solid) return false;
    }
    this.world.setBlock(x, y, z, state);
    const entity = createBlockEntity(def.id);
    if (entity) this.world.setBlockEntity(x, y, z, entity);
    if (def.id === 'chest' || def.id === 'trapped_chest') this.pairChest(x, y, z, state);
    if (blocks.prop(state, 'half') === 'lower') {
      const upper = blocks.withProp(state, 'half', 'upper');
      if (this.world.getBlock(x, y + 1, z) === 0) this.world.setBlock(x, y + 1, z, upper);
    }
    if (p.gamemode === 'survival') p.inventory.consumeSelected();
    p.exhaustion += 0.005;
    return true;
  }

  private placeBed(def: BlockDef, x: number, y: number, z: number): boolean {
    const p = this.player;
    const facing = ['', '', 'north', 'south', 'west', 'east'][p.horizontalFacing()];
    const dir: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
    const [dx, dz] = dir[facing];
    const hx = x + dx;
    const hz = z + dz;
    const head = this.world.getBlock(hx, y, hz);
    if (head !== 0 && !isReplaceable(blocks.blockOf(head))) return false;
    const foot = blocks.stateWith(def, { facing, part: 'foot', occupied: 'false' });
    const headState = blocks.stateWith(def, { facing, part: 'head', occupied: 'false' });
    const boxes = [[x, y, z, x + 1, y + 0.5625, z + 1], [hx, y, hz, hx + 1, y + 0.5625, hz + 1]];
    if (p.intersectsBoxes(boxes)) return false;
    this.world.setBlock(x, y, z, foot);
    this.world.setBlock(hx, y, hz, headState);
    if (p.gamemode === 'survival') p.inventory.consumeSelected();
    return true;
  }

  /** Chooses block state properties from the placement context (axis, facing, half, slab type...). */
  private placementState(def: BlockDef, t: RaycastHit, existing: number): number | null {
    const props: Record<string, string> = {};
    const names = new Set(def.states.map((s) => s.name));
    const faceName = ['down', 'up', 'north', 'south', 'west', 'east'][t.face];
    const p = this.player;
    const playerFacing = ['', '', 'north', 'south', 'west', 'east'][p.horizontalFacing()];
    const opposite: Record<string, string> = { north: 'south', south: 'north', west: 'east', east: 'west', up: 'down', down: 'up' };
    const local = t.point.y - t.y;
    const hitTop = t.face === 1 || (t.face >= 2 && local > 0.5);
    let id = def.id;
    // torches, lanterns and similar wall variants
    if ((id === 'torch' || id === 'soul_torch' || id === 'redstone_torch' || id === 'copper_torch') && t.face >= 2 && blocks.has(`wall_${id}`.replace('wall_redstone_torch', 'redstone_wall_torch').replace('wall_soul_torch', 'soul_wall_torch').replace('wall_copper_torch', 'copper_wall_torch'))) {
      id = id === 'torch' ? 'wall_torch' : id === 'soul_torch' ? 'soul_wall_torch' : id === 'redstone_torch' ? 'redstone_wall_torch' : 'copper_wall_torch';
      return blocks.stateWith(id, { facing: faceName });
    }
    if (def.behavior === 'torch' && t.face === 0) return null;
    if (id === 'ladder') {
      if (t.face < 2) return null;
      return blocks.stateWith(def, { facing: faceName, waterlogged: 'false' });
    }
    if (names.has('hanging')) props.hanging = t.face === 0 ? 'true' : 'false';
    if (names.has('axis')) props.axis = t.face < 2 ? 'y' : t.face < 4 ? 'z' : 'x';
    if (names.has('facing')) {
      const values = def.states.find((s) => s.name === 'facing')!.values;
      if (def.behavior === 'stairs' || def.behavior === 'fence_gate' || def.behavior === 'door' || def.behavior === 'bed' || def.behavior === 'trapdoor') props.facing = playerFacing;
      else if (def.behavior === 'button' || id === 'lever' || def.behavior === 'trapdoor') props.facing = t.face >= 2 ? faceName : playerFacing;
      else if (values.includes('up') && values.length === 6 && (id.includes('piston') || id === 'observer' || id === 'dispenser' || id === 'dropper' || id === 'hopper' || id === 'barrel' || id === 'end_rod' || id === 'lightning_rod')) {
        // six-way blocks face away from the player (observers/pistons face the player's look direction)
        const pitch = p.pitch;
        const vertical = Math.abs(pitch) > Math.PI / 3;
        const away = vertical ? (pitch > 0 ? 'up' : 'down') : opposite[playerFacing];
        props.facing = id === 'observer' || id.includes('piston') ? (vertical ? (pitch > 0 ? 'up' : 'down') : playerFacing) : id === 'hopper' ? (t.face >= 2 ? opposite[faceName] : 'down') : away;
      } else props.facing = opposite[playerFacing] ?? values[0];
    }
    if (names.has('half') && def.behavior === 'stairs') props.half = hitTop && t.face !== 1 ? 'top' : t.face === 0 ? 'top' : 'bottom';
    if (names.has('half') && def.behavior === 'trapdoor') props.half = hitTop && t.face !== 1 ? 'top' : t.face === 0 ? 'top' : 'bottom';
    if (names.has('type') && def.behavior === 'slab') props.type = t.face === 0 ? 'top' : t.face === 1 ? 'bottom' : local > 0.5 ? 'top' : 'bottom';
    if (names.has('face')) props.face = t.face === 1 ? 'floor' : t.face === 0 ? 'ceiling' : 'wall';
    if (names.has('persistent')) props.persistent = 'true';
    if (names.has('waterlogged')) props.waterlogged = existing !== 0 && blocks.blockOf(existing).id === 'water' ? 'true' : 'false';
    if (names.has('rotation')) {
      const yaw = ((-p.yaw / (Math.PI * 2)) * 16 + 8) % 16;
      props.rotation = String(Math.round(((yaw % 16) + 16) % 16) % 16);
    }
    if (names.has('half') && def.behavior === 'door') props.half = 'lower';
    return blocks.stateWith(def, props);
  }

  // ---------------------------------------------------------------------------------------------
  // Block entities, chests and GUI screens
  // ---------------------------------------------------------------------------------------------
  private tickBlockEntities(): void {
    this.world.forEachBlockEntity((x, y, z, e) => {
      if (e.type !== 'furnace' && e.type !== 'blast_furnace' && e.type !== 'smoker') return;
      const r = tickFurnace(e as FurnaceEntity);
      if (r.changed) this.world.markModifiedAt(x, z);
      if (r.litChanged) {
        const st = this.world.getBlock(x, y, z);
        if (st && blocks.blockOf(st).id === e.type) this.world.setBlock(x, y, z, blocks.withProp(st, 'lit', (e as FurnaceEntity).burnTime > 0 ? 'true' : 'false'));
      }
    });
  }

  private static readonly CLOCKWISE: Record<string, [number, number, string]> = { north: [1, 0, 'east'], east: [0, 1, 'south'], south: [-1, 0, 'west'], west: [0, -1, 'north'] };
  private static readonly COUNTER: Record<string, [number, number, string]> = { north: [-1, 0, 'west'], west: [0, 1, 'south'], south: [1, 0, 'east'], east: [0, -1, 'north'] };

  /** Joins a freshly placed chest with a single neighbour of the same facing (vanilla double chest). */
  private pairChest(x: number, y: number, z: number, state: number): void {
    const def = blocks.blockOf(state);
    const facing = blocks.prop(state, 'facing') ?? 'north';
    for (const [side, type, partnerType] of [['cw', 'left', 'right'], ['ccw', 'right', 'left']] as const) {
      const [dx, dz] = (side === 'cw' ? Game.CLOCKWISE : Game.COUNTER)[facing];
      const ns = this.world.getBlock(x + dx, y, z + dz);
      if (!ns || blocks.blockOf(ns).id !== def.id) continue;
      if (blocks.prop(ns, 'facing') !== facing || blocks.prop(ns, 'type') !== 'single') continue;
      this.world.setBlock(x, y, z, blocks.withProp(state, 'type', type));
      this.world.setBlock(x + dx, y, z + dz, blocks.withProp(ns, 'type', partnerType));
      return;
    }
  }

  private chestPartner(x: number, y: number, z: number, state: number): [number, number, number] | null {
    const type = blocks.prop(state, 'type');
    const facing = blocks.prop(state, 'facing') ?? 'north';
    if (type !== 'left' && type !== 'right') return null;
    const [dx, dz] = (type === 'left' ? Game.CLOCKWISE : Game.COUNTER)[facing];
    return [x + dx, y, z + dz];
  }

  private unpairChest(x: number, y: number, z: number, state: number): void {
    const partner = this.chestPartner(x, y, z, state);
    if (!partner) return;
    const ps = this.world.getBlock(...partner);
    if (ps && blocks.blockOf(ps).id === blocks.blockOf(state).id) this.world.setBlock(partner[0], partner[1], partner[2], blocks.withProp(ps, 'type', 'single'));
  }

  /** Right-click on a block with a GUI or behavior. Returns true when handled. */
  private useBlock(t: RaycastHit): boolean {
    const def = blocks.blockOf(t.state);
    const p = this.player;
    const inv = p.inventory;
    const mark = () => this.world.markModifiedAt(t.x, t.z);
    const behavior = behaviorFor(def);
    if (behavior?.onUse && behavior.onUse({ w: this.simulationWorld(), x: t.x, y: t.y, z: t.z, state: t.state, def })) return true;
    if (def.id === 'crafting_table') {
      const grid = makeGrid(3, 3);
      this.openScreen(craftingTableScreen(inv, grid), () => this.returnGrid(grid));
      return true;
    }
    if (def.id === 'ender_chest') {
      this.openScreen(chestScreen(inv, p.enderChest, 3, 'Ender Chest'));
      return true;
    }
    if (def.behavior === 'workstation') {
      this.hud.showToast(`${def.name}: coming in a later phase`);
      return true;
    }
    const kind = containerKind(def.id);
    if (kind || def.id === 'furnace' || def.id === 'blast_furnace' || def.id === 'smoker') {
      let entity = this.world.getBlockEntity(t.x, t.y, t.z);
      if (!entity) {
        entity = createBlockEntity(def.id)!;
        this.world.setBlockEntity(t.x, t.y, t.z, entity);
      }
      if (entity.type === 'furnace' || entity.type === 'blast_furnace' || entity.type === 'smoker') {
        const screen = furnaceScreen(inv, entity as FurnaceEntity, (n) => this.addXp(n));
        screen.onChange = mark;
        this.openScreen(screen);
        return true;
      }
      const c = entity as ContainerEntity;
      if ((def.id === 'chest' || def.id === 'trapped_chest') && this.chestPartner(t.x, t.y, t.z, t.state)) {
        const partner = this.chestPartner(t.x, t.y, t.z, t.state)!;
        let other = this.world.getBlockEntity(...partner) as ContainerEntity | undefined;
        if (!other) {
          other = createBlockEntity(def.id) as ContainerEntity;
          this.world.setBlockEntity(partner[0], partner[1], partner[2], other);
        }
        const left = blocks.prop(t.state, 'type') === 'left' ? c : other;
        const right = left === c ? other : c;
        const merged: Slot[] = [...left.items, ...right.items];
        const sync = () => {
          left.items = merged.slice(0, 27);
          right.items = merged.slice(27);
          mark();
          this.world.markModifiedAt(partner[0], partner[2]);
        };
        const screen = chestScreen(inv, merged, 6, 'Large Chest', sync);
        screen.onChange = sync;
        this.openScreen(screen);
        return true;
      }
      const title = def.name;
      const screen = c.type === 'hopper' ? hopperScreen(inv, c.items, mark) : c.type === 'dispenser' || c.type === 'dropper' ? dispenserScreen(inv, c.items, title, mark) : chestScreen(inv, c.items, 3, c.type === 'shulker_box' ? 'Shulker Box' : title, mark);
      screen.onChange = mark;
      this.openScreen(screen);
      return true;
    }
    return false;
  }

  private simulationWorld(): BlockWorld {
    return (this.simulation as unknown as { w: BlockWorld }).w;
  }

  skyDarken(): number {
    return Math.round(((1 - this.sky.dayLight) / 0.73) * 11);
  }

  isDay(): boolean {
    const t = this.time % DAY_LENGTH;
    return t < 12542 || t > 23459;
  }

  /** Right-click with an item on a block (or into the air). */
  private useItem(t: RaycastHit | null): void {
    const p = this.player;
    const held = p.heldItem();
    if (!held) return;
    const def = items.byId.get(held.id);
    if (!def) return;
    if (def.behavior === 'bucket') {
      this.useBucket(held.id);
      return;
    }
    if (held.id === 'bone_meal' && t) {
      if (applyBoneMeal(this.simulationWorld(), t.x, t.y, t.z, t.state)) {
        if (p.gamemode === 'survival') p.inventory.consumeSelected();
      }
      return;
    }
    if (t) this.placeBlock(t);
  }

  private useBucket(id: string): void {
    const p = this.player;
    const eye = p.eyePosition(1, this.tmpEye);
    const dir = p.lookDirection(this.tmpDir);
    if (id === 'bucket') {
      const hit = this.world.raycast(eye, dir, BLOCK_REACH, true);
      if (!hit) return;
      const def = blocks.blockOf(hit.state);
      if (def.behavior !== 'fluid' || blocks.prop(hit.state, 'level') !== '0') return;
      this.world.setBlock(hit.x, hit.y, hit.z, 0);
      const filled = def.id === 'water' ? 'water_bucket' : 'lava_bucket';
      if (p.gamemode === 'survival') {
        p.inventory.consumeSelected();
        if (p.inventory.add({ id: filled, count: 1 }) > 0) this.dropStack({ id: filled, count: 1 }, p.pos.x, p.pos.y + 1, p.pos.z, true);
      }
      return;
    }
    const fluid = id === 'water_bucket' ? 'water' : id === 'lava_bucket' ? 'lava' : id === 'powder_snow_bucket' ? 'powder_snow' : null;
    if (!fluid) return;
    const hit = this.world.raycast(eye, dir, BLOCK_REACH, false);
    if (!hit) return;
    const targetDef = blocks.blockOf(hit.state);
    let x = hit.x, y = hit.y, z = hit.z;
    if (!isReplaceable(targetDef)) {
      const n = FACE_NORMALS[hit.face];
      x += n[0];
      y += n[1];
      z += n[2];
    }
    const existing = this.world.getBlock(x, y, z);
    if (existing !== 0 && !isReplaceable(blocks.blockOf(existing))) return;
    this.world.setBlock(x, y, z, blocks.defaultState(fluid));
    if (fluid !== 'powder_snow') this.simulation.schedule(x, y, z, fluid === 'water' ? WATER_DELAY : LAVA_DELAY, this.tickCount);
    if (p.gamemode === 'survival') {
      p.inventory.consumeSelected();
      if (p.inventory.add({ id: 'bucket', count: 1 }) > 0) this.dropStack({ id: 'bucket', count: 1 }, p.pos.x, p.pos.y + 1, p.pos.z, true);
    }
  }

  private canEat(def: { food?: { alwaysEdible?: boolean } }): boolean {
    const p = this.player;
    return p.gamemode === 'creative' || p.food < 20 || !!def.food?.alwaysEdible;
  }

  private eat(def: { id: string; food?: { nutrition: number; saturation: number; effects?: { effect: string; duration: number; amplifier?: number; chance?: number }[]; container?: string } }): void {
    const p = this.player;
    const f = def.food!;
    this.feed(f.nutrition, f.saturation);
    for (const e of f.effects ?? []) if (e.chance === undefined || Math.random() < e.chance) p.effects.add(e.effect, e.duration, e.amplifier ?? 0);
    if (def.id === 'milk_bucket') p.effects.clear();
    if (def.id === 'honey_bottle') p.effects.remove('poison');
    if (p.gamemode !== 'creative') {
      p.inventory.consumeSelected();
      if (f.container && p.inventory.add({ id: f.container, count: 1 }) > 0) this.dropStack({ id: f.container, count: 1 }, p.pos.x, p.pos.y + 1, p.pos.z, true);
    }
  }

  feed(nutrition: number, saturation: number): void {
    const p = this.player;
    p.food = Math.min(20, p.food + nutrition);
    p.saturation = Math.min(p.food, p.saturation + saturation);
  }

  private tickEffects(): void {
    const p = this.player;
    if (p.dead) return;
    p.effects.tick();
    for (const e of p.effects.active.values()) {
      const lvl = e.amplifier + 1;
      switch (e.id) {
        case 'regeneration':
          if (this.tickCount % Math.max(1, 50 >> e.amplifier) === 0 && p.health < 20) p.health = Math.min(20, p.health + 1);
          break;
        case 'poison':
          if (this.tickCount % Math.max(1, 25 >> e.amplifier) === 0 && p.health > 1) this.damage(1, true);
          break;
        case 'wither':
          if (this.tickCount % Math.max(1, 40 >> e.amplifier) === 0) this.damage(1, true);
          break;
        case 'hunger':
          p.exhaustion += 0.005 * lvl;
          break;
        case 'saturation':
          this.feed(lvl, 2 * lvl);
          p.effects.remove('saturation');
          break;
        case 'instant_health':
          p.health = Math.min(20, p.health + 4 * 2 ** e.amplifier);
          p.effects.remove('instant_health');
          break;
        case 'instant_damage':
          this.damage(6 * 2 ** e.amplifier, true);
          p.effects.remove('instant_damage');
          break;
      }
    }
    this.uniforms.gamma.value = Math.max(this.options.gamma, p.effects.level('night_vision') ? 1 : 0);
  }

  private startFalling(x: number, y: number, z: number, state: number): void {
    this.world.setBlock(x, y, z, 0);
    const e = new FallingBlockEntity(state, x, y, z, this.blockMeshes.mesh(state));
    this.fallingBlocks.push(e);
    this.renderer.scene.add(e.mesh);
  }

  private tickFallingBlocks(): void {
    for (let i = this.fallingBlocks.length - 1; i >= 0; i--) {
      const e = this.fallingBlocks[i];
      e.tick(this.world);
      if (!e.dead) continue;
      this.renderer.scene.remove(e.mesh);
      this.fallingBlocks.splice(i, 1);
      if (e.landed) {
        const cur = this.world.getBlock(e.landed.x, e.landed.y, e.landed.z);
        if (cur === 0 || isReplaceable(blocks.blockOf(cur))) this.world.setBlock(e.landed.x, e.landed.y, e.landed.z, e.state);
        else for (const d of blockDrops(e.state, null)) this.dropStack(d, e.pos.x + 0.5, e.pos.y, e.pos.z + 0.5, true);
      }
    }
  }

  private sleepInBed(x: number, y: number, z: number): void {
    const p = this.player;
    p.spawn = [x + 0.5, y + 0.6, z + 0.5];
    if (this.isDay()) {
      this.chat.addLine('You can only sleep at night', '#fa5');
      return;
    }
    if (this.sleeping) return;
    this.chat.addLine('Sleeping... (spawn point set)', '#5f5');
    this.sleeping = 40;
  }

  // ---------------------------------------------------------------------------------------------
  // Mobs and combat
  // ---------------------------------------------------------------------------------------------
  private onChunkLoaded(cx: number, cz: number): void {
    const c = this.world.getChunk(cx, cz);
    if (!c) return;
    let saved: import('../entities/mob.ts').MobSave[] | null = null;
    if (c.pendingMobs) {
      try {
        saved = JSON.parse(c.pendingMobs) as import('../entities/mob.ts').MobSave[];
      } catch {
        saved = null;
      }
      c.pendingMobs = null;
    }
    this.entities.restoreChunk(cx, cz, saved);
    const key = `${cx},${cz}`;
    if (!this.animalChunks.has(key)) {
      this.animalChunks.add(key);
      this.entities.spawnAnimalsInChunk(cx, cz);
    }
  }

  private lineOfSight(a: THREE.Vector3, b: THREE.Vector3): boolean {
    const dir = b.clone().sub(a);
    const dist = dir.length();
    if (dist < 1e-3) return true;
    dir.divideScalar(dist);
    const hit = this.world.raycast(a, dir, dist, false);
    return !hit || hit.distance >= dist - 0.01 || !blocks.stateOpaque[hit.state];
  }

  /** Light-curve brightness at a block position for entity rendering. */
  brightnessAt(x: number, y: number, z: number): number {
    const curve = (l: number) => l / (4 - 3 * l);
    const sky = curve(this.world.getSkyLight(x, y, z) / 15) * this.sky.dayLight;
    const blk = curve(this.world.getBlockLight(x, y, z) / 15);
    let b = Math.max(sky, blk);
    const gamma = this.uniforms.gamma.value as number;
    b = b + (1 - Math.pow(1 - b, 2) - b) * gamma * 0.6;
    return Math.max(0.05, b);
  }

  private armorReduction(damage: number): number {
    const p = this.player;
    let armor = 0;
    let toughness = 0;
    for (const s of p.inventory.armor) {
      if (!s) continue;
      const def = items.byId.get(s.id);
      if (def?.armor) {
        armor += def.armor.points;
        toughness += def.armor.toughness;
      }
    }
    if (armor === 0) return damage;
    const reduction = Math.min(20, Math.max(armor / 5, armor - damage / (2 + toughness / 4))) / 25;
    return damage * (1 - reduction);
  }

  private damageArmor(): void {
    const p = this.player;
    for (let i = 0; i < 4; i++) {
      const s = p.inventory.armor[i];
      if (!s) continue;
      const def = items.byId.get(s.id);
      if (!def?.durability) continue;
      s.damage = (s.damage ?? 0) + 1;
      if (s.damage >= def.durability) p.inventory.armor[i] = null;
    }
    p.inventory.version++;
  }

  hurtByMob(amount: number, from: THREE.Vector3): void {
    const p = this.player;
    if (p.gamemode !== 'survival' || p.dead || p.hurtTime > 0) return;
    const reduced = this.armorReduction(amount);
    this.damage(reduced);
    this.damageArmor();
    // knockback
    const dx = p.pos.x - from.x;
    const dz = p.pos.z - from.z;
    const len = Math.hypot(dx, dz) || 1;
    p.vel.x += (dx / len) * 0.4;
    p.vel.z += (dz / len) * 0.4;
    p.vel.y = Math.max(p.vel.y, 0.36);
    p.exhaustion += 0.1;
  }

  private attackMob(mob: Mob): void {
    const p = this.player;
    const held = p.heldItem();
    const def = held ? items.byId.get(held.id) : undefined;
    let damage = def?.attack?.damage ?? 1;
    const speed = def?.attack?.speed ?? 4;
    const cooldownTicks = 20 / speed;
    const progress = Math.min(1, this.attackTicks / cooldownTicks);
    this.attackTicks = 0;
    const sharpness = held?.enchantments?.sharpness ?? 0;
    if (sharpness) damage += 0.5 * (sharpness - 1) + 1;
    damage *= 0.2 + progress * progress * 0.8;
    let knockback = 0.4;
    if (p.sprinting) knockback += 0.5;
    knockback += 0.5 * (held?.enchantments?.knockback ?? 0);
    const crit = progress > 0.9 && !p.onGround && p.vel.y < 0 && !p.inWater && !p.sprinting;
    if (crit) damage *= 1.5;
    if (progress > 0.9) mob.hurt(damage, p.pos, 'player', knockback);
    else mob.hurt(damage, p.pos, 'player', 0.2);
    if (held && def?.durability && (def.behavior === 'sword' || def.behavior === 'axe' || def.behavior === 'pickaxe' || def.behavior === 'shovel' || def.behavior === 'hoe')) p.inventory.damageSelected(def.behavior === 'sword' ? 1 : 2);
    p.exhaustion += 0.1;
    if (p.gamemode === 'survival') this.hud.showToast('');
  }

  private onMobDeath(m: Mob): void {
    const byPlayer = m.lastHurtBy === 'player';
    const looting = byPlayer ? this.player.heldItem()?.enchantments?.looting ?? 0 : 0;
    for (const d of entityDrops(m.def.loot, byPlayer, looting, m.fireTicks > 0)) this.dropStack(d, m.pos.x, m.pos.y + 0.5, m.pos.z, true);
    if (byPlayer && m.def.xp > 0) this.addXp(m.def.xp);
  }

  explodeAt(x: number, y: number, z: number, power: number, source: Mob | null): void {
    const p = this.player;
    const w = {
      getBlock: (bx: number, by: number, bz: number) => this.world.getBlock(bx, by, bz),
      destroyBlock: (bx: number, by: number, bz: number, drop: boolean) => {
        const state = this.world.getBlock(bx, by, bz);
        if (state === 0) return;
        if (drop) this.breakBlock(bx, by, bz, true);
        else this.world.setBlock(bx, by, bz, 0);
      },
    };
    explode(w, x, y, z, power);
    const centre = new THREE.Vector3(x, y, z);
    const hurt = (box: AABB, mid: THREE.Vector3, apply: (n: number, from: THREE.Vector3) => void) => {
      const dist = mid.distanceTo(centre);
      if (dist > power * 2) return;
      const dmg = explosionDamage(power, dist, exposure(w, x, y, z, box));
      if (dmg > 0) apply(dmg, centre);
    };
    if (!p.dead) hurt(p.aabb(), p.pos.clone().add(new THREE.Vector3(0, p.height / 2, 0)), (n, from) => {
      if (p.gamemode !== 'survival') return;
      this.damage(this.armorReduction(n), true);
      const dir = p.pos.clone().sub(from).normalize();
      p.vel.add(dir.multiplyScalar(0.8));
    });
    for (const m of this.entities.mobs) {
      if (m === source || m.dead) continue;
      hurt(m.aabb(), m.pos.clone().add(new THREE.Vector3(0, m.height / 2, 0)), (n, from) => m.hurt(n, from, 'other', 0.6));
    }
    this.hud.showToast('');
  }

  openInventory(): void {
    const grid = makeGrid(2, 2);
    this.openScreen(inventoryScreen(this.player.inventory, grid), () => this.returnGrid(grid));
  }

  private returnGrid(grid: CraftingGrid): void {
    for (const s of grid.cells) {
      if (!s) continue;
      const left = this.player.inventory.add(s);
      if (left > 0) this.dropStack({ ...s, count: left }, this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, true);
    }
    grid.cells.fill(null);
  }

  openScreen(def: ScreenDef, cleanup?: () => void): void {
    if (this.state !== 'playing') return;
    this.closeScreen();
    this.state = 'gui';
    this.input.enabled = false;
    this.input.exitLock();
    const host = {
      icons: this.icons,
      guiScale: this.options.guiScale,
      drop: (stack: ItemStack) => {
        const eye = this.player.eyePosition(1);
        const dir = this.player.lookDirection();
        const e = this.dropStack(stack, eye.x, eye.y - 0.3, eye.z, false);
        e.vel.copy(dir).multiplyScalar(0.3);
        e.pickupDelay = 40;
      },
      creative: this.player.gamemode === 'creative',
      advancedTooltips: this.hud.showDebug,
    };
    this.screen = new ContainerScreen(def, host, this.renderer.canvas.parentElement ?? document.body);
    this.screen.onClose = () => this.closeScreen();
    this.screenCleanup = cleanup ?? null;
  }

  closeScreen(): void {
    if (!this.screen) return;
    const screen = this.screen;
    this.screen = null;
    screen.releaseCursor((s) => this.player.inventory.add(s));
    screen.destroy();
    this.screenCleanup?.();
    this.screenCleanup = null;
    if (this.state === 'gui') {
      this.state = 'playing';
      this.input.enabled = true;
      this.input.requestLock();
    }
  }

  // ---------------------------------------------------------------------------------------------
  // Rendering
  // ---------------------------------------------------------------------------------------------
  private render(alpha: number, dt: number): void {
    const p = this.player;
    if (this.state === 'playing') {
      const m = this.input.consumeMouse();
      p.applyMouse(m.dx, m.dy, this.options.sensitivity);
      if (this.input.wasPressed('pause')) this.pause();
      if (this.input.wasPressed('chat')) this.openChat('');
      else if (this.input.wasPressed('command')) this.openChat('/');
      if (this.input.wasPressed('debug')) this.hud.showDebug = !this.hud.showDebug;
      if (this.input.wasPressed('perspective')) this.thirdPerson = (this.thirdPerson + 1) % 3;
      if (this.input.wasPressed('inventory')) this.openInventory();
    } else if (this.state === 'chat') {
      this.input.consumeMouse();
    } else {
      this.input.consumeMouse();
    }
    // camera
    const eye = p.eyePosition(alpha, this.tmpEye);
    const cam = this.renderer.camera;
    cam.rotation.set(p.pitch, p.yaw, 0);
    if (this.thirdPerson === 0) cam.position.copy(eye);
    else {
      const dir = p.lookDirection(this.tmpDir);
      const back = this.thirdPerson === 1 ? -4 : 4;
      const hit = this.world.raycast(eye, dir.clone().multiplyScalar(Math.sign(back)), 4, false);
      const dist = hit ? Math.max(0.3, hit.distance - 0.3) : 4;
      cam.position.copy(eye).addScaledVector(dir, Math.sign(back) * dist);
      if (this.thirdPerson === 2) cam.rotation.set(-p.pitch, p.yaw + Math.PI, 0);
    }
    // world streaming and sky
    this.world.update(p.pos.x, p.pos.z);
    const partialTime = this.time + alpha;
    this.sky.update(partialTime, cam.position);
    this.renderer.scene.background = this.sky.skyColor;
    this.uniforms.dayLight.value = this.sky.dayLight;
    const eyeState = this.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const eyeBlock = eyeState !== 0 ? blocks.blockOf(eyeState).id : '';
    const rd = this.world.renderDistance * 16;
    if (eyeBlock === 'water') {
      this.uniforms.fogColor.value.setRGB(0.02, 0.1, 0.35);
      this.uniforms.fogNear.value = 2;
      this.uniforms.fogFar.value = 24;
      (this.renderer.scene.background as THREE.Color).setRGB(0.02, 0.1, 0.35);
    } else if (eyeBlock === 'lava') {
      this.uniforms.fogColor.value.setRGB(0.6, 0.15, 0);
      this.uniforms.fogNear.value = 0.2;
      this.uniforms.fogFar.value = 2;
    } else {
      this.uniforms.fogColor.value.copy(this.sky.fogColor);
      this.uniforms.fogNear.value = Math.max(8, rd * 0.7);
      this.uniforms.fogFar.value = Math.max(16, rd - 2);
    }
    this.hud.setUnderwater(eyeBlock === 'water');
    this.hud.setInLava(eyeBlock === 'lava');
    if (this.tickCount % 1 === 0) this.tickAnimations(dt);
    // selection outline and cracks
    if (this.state === 'playing') this.updateTarget();
    this.updateOutline();
    for (const e of this.itemEntities) e.updateSprite(alpha, partialTime / 20);
    for (const e of this.fallingBlocks) e.updateMesh(alpha);
    this.entities.render(alpha, (x, y, z) => this.brightnessAt(x, y, z));
    this.world.flush();
    this.renderer.render();
    this.hud.update(p, this.debugText(eyeBlock), dt);
    this.input.endFrame();
  }

  private animAcc = 0;
  private tickAnimations(dt: number): void {
    this.animAcc += dt;
    while (this.animAcc >= 0.05) {
      this.animAcc -= 0.05;
      this.tickAtlas?.();
    }
  }

  tickAtlas: (() => void) | null = null;

  private updateOutline(): void {
    const t = this.target;
    if (!t || this.state !== 'playing') {
      this.outline.visible = false;
      this.crack.visible = false;
      return;
    }
    const boxes = collisionBoxes(t.state, true);
    const pos: number[] = [];
    for (const b of boxes) {
      const [x1, y1, z1, x2, y2, z2] = [b[0] - 0.002, b[1] - 0.002, b[2] - 0.002, b[3] + 0.002, b[4] + 0.002, b[5] + 0.002];
      const c = [[x1, y1, z1], [x2, y1, z1], [x2, y1, z2], [x1, y1, z2], [x1, y2, z1], [x2, y2, z1], [x2, y2, z2], [x1, y2, z2]];
      const e = [[0, 1], [1, 2], [2, 3], [3, 0], [4, 5], [5, 6], [6, 7], [7, 4], [0, 4], [1, 5], [2, 6], [3, 7]];
      for (const [a, b2] of e) pos.push(...c[a], ...c[b2]);
    }
    this.outline.geometry.dispose();
    this.outline.geometry = new THREE.BufferGeometry();
    this.outline.geometry.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
    this.outline.position.set(t.x, t.y, t.z);
    this.outline.visible = true;
    const b = this.breaking;
    if (b && b.ticks > 0 && b.ticks !== Infinity) {
      const stage = Math.min(9, Math.floor(b.progress * 10));
      if (stage !== this.lastCrackStage) {
        this.lastCrackStage = stage;
        this.setCrackStage(stage);
      }
      this.crack.position.set(b.x + 0.5, b.y + 0.5, b.z + 0.5);
      this.crack.visible = true;
    } else this.crack.visible = false;
  }

  private setCrackStage(stage: number): void {
    const tileId = this.crackTiles[stage];
    const geo = this.crack.geometry as THREE.BoxGeometry;
    const atlas = (this.uniforms.atlas.value as THREE.DataTexture).image as { width: number; height: number };
    const index = this.baker.atlas.tiles[tileId];
    const uv = geo.getAttribute('uv') as THREE.BufferAttribute;
    // BoxGeometry uvs are 0..1 per face; remap them into the crack tile's atlas rectangle
    const tmpl = new THREE.BoxGeometry(1, 1, 1).getAttribute('uv') as THREE.BufferAttribute;
    for (let i = 0; i < uv.count; i++) {
      const u = tmpl.getX(i);
      const v = tmpl.getY(i);
      uv.setXY(i, (index.x + u * index.w) / atlas.width, 1 - (index.y + (1 - v) * index.h) / atlas.height);
    }
    uv.needsUpdate = true;
  }

  private debugText(eyeBlock: string): string {
    const p = this.player;
    const x = Math.floor(p.pos.x);
    const y = Math.floor(p.pos.y);
    const z = Math.floor(p.pos.z);
    const facing = ['down', 'up', 'north (-z)', 'south (+z)', 'west (-x)', 'east (+x)'][p.horizontalFacing()];
    const biome = biomes[this.world.getBiome(x, z)]?.id ?? '?';
    const t = this.target;
    const day = Math.floor(this.time / DAY_LENGTH);
    const tod = this.time % DAY_LENGTH;
    const lines = [
      `Voxelcraft 0.1 (${MC_VERSION} rules) ${this.loop.fps} fps`,
      `XYZ: ${p.pos.x.toFixed(3)} / ${p.pos.y.toFixed(3)} / ${p.pos.z.toFixed(3)}`,
      `Block: ${x} ${y} ${z}  Chunk: ${x & 15} ${(y - WORLD_MIN_Y) & 15} ${z & 15} in ${x >> 4} ${(y - WORLD_MIN_Y) >> 4} ${z >> 4}`,
      `Facing: ${facing} (yaw ${((p.yaw * 180) / Math.PI).toFixed(1)} pitch ${((p.pitch * 180) / Math.PI).toFixed(1)})`,
      `Light: sky ${this.world.getSkyLight(x, y, z)} block ${this.world.getBlockLight(x, y, z)}  Biome: ${biome}`,
      `Day ${day}, time ${tod} (${Math.floor((tod / 1000 + 6) % 24).toString().padStart(2, '0')}:${Math.floor(((tod % 1000) / 1000) * 60).toString().padStart(2, '0')})`,
      `Chunks: ${this.world.chunks.size} loaded, ${this.world.stats.chunks} in worker, ${this.world.stats.pending} sections pending`,
      `Mode: ${p.gamemode}${p.flying ? ' (flying)' : ''}${p.sprinting ? ' sprinting' : ''}${p.sneaking ? ' sneaking' : ''}  onGround ${p.onGround}  eye in: ${eyeBlock || 'air'}`,
      `Entities: ${this.entities.mobs.length} mobs (${this.entities.count('hostile')} hostile), ${this.entities.arrows.length} arrows, ${this.itemEntities.length} items, ${this.fallingBlocks.length} falling`,
    ];
    if (t) {
      const def = blocks.blockOf(t.state);
      const props = blocks.props(t.state);
      lines.push('', `Targeted Block: ${t.x}, ${t.y}, ${t.z}`, `${def.id} (state ${t.state})`, ...Object.entries(props).map(([k, v]) => `${k}: ${v}`));
      const held = p.heldItem();
      lines.push(`break time: ${breakTicks(t.state, held, { onGround: p.onGround, inWater: p.inWater, creative: p.gamemode === 'creative' })} ticks, harvest ${canHarvest(t.state, held)}`);
    }
    return lines.join('\n');
  }

  // ---------------------------------------------------------------------------------------------
  // Chat and commands
  // ---------------------------------------------------------------------------------------------
  private openChat(initial: string): void {
    this.state = 'chat';
    this.input.enabled = false;
    this.input.exitLock();
    this.chat.show(initial);
  }

  private handleChat(text: string): void {
    if (!text.startsWith('/')) {
      this.chat.addLine(`<Player> ${text}`);
      return;
    }
    const [cmd, ...args] = text.slice(1).split(/\s+/);
    const p = this.player;
    const say = (s: string, color = '#fff') => this.chat.addLine(s, color);
    const err = (s: string) => say(s, '#f55');
    const num = (s: string, rel: number) => (s.startsWith('~') ? rel + (s.length > 1 ? Number(s.slice(1)) : 0) : Number(s));
    switch (cmd) {
      case 'gamemode': {
        const m = args[0];
        const mode = m === 'creative' || m === 'c' || m === '1' ? 'creative' : m === 'survival' || m === 's' || m === '0' ? 'survival' : m === 'spectator' || m === 'sp' || m === '3' ? 'spectator' : null;
        if (!mode) return err('Usage: /gamemode <survival|creative|spectator>');
        p.gamemode = mode;
        if (mode !== 'creative') p.flying = false;
        say(`Set own game mode to ${mode[0].toUpperCase() + mode.slice(1)} Mode`);
        break;
      }
      case 'time': {
        const presets: Record<string, number> = { day: 1000, noon: 6000, night: 13000, midnight: 18000, sunrise: 23000, sunset: 12000 };
        if (args[0] === 'set') {
          const v = presets[args[1]] ?? Number(args[1]);
          if (Number.isNaN(v)) return err('Usage: /time set <day|noon|night|midnight|ticks>');
          const day = Math.floor(this.time / DAY_LENGTH);
          this.time = day * DAY_LENGTH + v;
          say(`Set the time to ${v}`);
        } else if (args[0] === 'add') {
          const v = Number(args[1]);
          if (Number.isNaN(v)) return err('Usage: /time add <ticks>');
          this.time += v;
          say(`Added ${v} to the time`);
        } else if (args[0] === 'query') say(`The time is ${this.time % DAY_LENGTH} (day ${Math.floor(this.time / DAY_LENGTH)})`);
        else err('Usage: /time <set|add|query> ...');
        break;
      }
      case 'tp': case 'teleport': {
        if (args.length < 3) return err('Usage: /tp <x> <y> <z>');
        const x = num(args[0], p.pos.x);
        const y = num(args[1], p.pos.y);
        const z = num(args[2], p.pos.z);
        if ([x, y, z].some((v) => Number.isNaN(v))) return err('Invalid coordinates');
        p.teleport(x, y, z);
        say(`Teleported Player to ${x.toFixed(2)}, ${y.toFixed(2)}, ${z.toFixed(2)}`);
        break;
      }
      case 'give': {
        let id = args[0];
        let count = Number(args[1] ?? 1);
        if (id === '@s' || id === '@p' || id === 'Player') {
          id = args[1];
          count = Number(args[2] ?? 1);
        }
        if (!id) return err('Usage: /give <item> [count]');
        id = id.replace(/^minecraft:/, '');
        if (!items.has(id)) return err(`Unknown item '${id}'`);
        if (!Number.isFinite(count) || count < 1) count = 1;
        const left = p.inventory.add({ id, count });
        say(`Gave ${count - left} [${items.get(id).name}] to Player`);
        break;
      }
      case 'clear':
        p.inventory.clear();
        say('Cleared inventory');
        break;
      case 'seed':
        say(`Seed: [${this.meta.seed}]${this.meta.seedText ? ` ("${this.meta.seedText}")` : ''}`, '#5f5');
        break;
      case 'kill':
        this.damage(1000, true);
        break;
      case 'heal':
        p.health = 20;
        p.food = 20;
        p.saturation = 5;
        say('Healed');
        break;
      case 'spawnpoint':
        p.spawn = [p.pos.x, p.pos.y, p.pos.z];
        say('Set spawn point');
        break;
      case 'weather':
        say('Weather is not implemented yet (Phase 3)', '#fa5');
        break;
      case 'locate':
        say('Structures are not generated yet (Phase 3)', '#fa5');
        break;
      case 'setblock': {
        if (args.length < 4) return err('Usage: /setblock <x> <y> <z> <block>');
        const x = Math.floor(num(args[0], p.pos.x));
        const y = Math.floor(num(args[1], p.pos.y));
        const z = Math.floor(num(args[2], p.pos.z));
        const id = args[3].replace(/^minecraft:/, '');
        if (!blocks.has(id)) return err(`Unknown block '${id}'`);
        this.world.setBlock(x, y, z, blocks.defaultState(id));
        say(`Changed the block at ${x}, ${y}, ${z}`);
        break;
      }
      case 'effect': {
        if (args[0] === 'clear') {
          p.effects.clear();
          say('Removed every effect');
          break;
        }
        const id = (args[0] === 'give' ? args[2] ?? args[1] : args[0])?.replace(/^minecraft:/, '');
        const rest = args[0] === 'give' ? args.slice(3) : args.slice(1);
        if (!id) return err('Usage: /effect give @s <effect> [seconds] [amplifier]');
        const seconds = Number(rest[0] ?? 30);
        const amp = Number(rest[1] ?? 0);
        p.effects.add(id, seconds * 20, amp);
        say(`Applied effect ${id} to Player`);
        break;
      }
      case 'summon': {
        const type = (args[0] ?? '').replace(/^minecraft:/, '');
        if (!mobStats(type)) return err(`Unknown or unsupported mob '${type}' (try zombie, skeleton, creeper, spider, cow, pig, sheep, chicken)`);
        const dir = p.lookDirection();
        const x = args[1] ? num(args[1], p.pos.x) : p.pos.x + dir.x * 3;
        const y = args[2] ? num(args[2], p.pos.y) : p.pos.y;
        const z = args[3] ? num(args[3], p.pos.z) : p.pos.z + dir.z * 3;
        const m = this.entities.spawn(type, x, y, z, p.yaw + Math.PI);
        say(m ? `Summoned new ${m.def.name}` : 'Could not summon');
        break;
      }
      case 'butcher':
        for (const m of this.entities.mobs.slice()) this.entities.remove(m);
        say('Removed all mobs');
        break;
      case 'xp': {
        const n = Number(args[0] ?? 1);
        this.addXp(n);
        say(`Gave ${n} experience`);
        break;
      }
      case 'help':
        say('Commands: /gamemode /time /tp /give /clear /seed /kill /heal /spawnpoint /setblock /xp /effect /summon /butcher /weather /locate');
        break;
      default:
        err(`Unknown command '${cmd}'. Try /help`);
    }
  }

  addXp(n: number): void {
    const p = this.player;
    p.xp += n;
    while (p.xp >= xpForLevel(p.xpLevel)) {
      p.xp -= xpForLevel(p.xpLevel);
      p.xpLevel++;
    }
  }
}
