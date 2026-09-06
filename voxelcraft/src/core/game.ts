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

type State = 'loading' | 'playing' | 'paused' | 'chat' | 'dead';

const REPLACEABLE = new Set(['plant', 'fluid', 'fire', 'snow_layer', 'air']);

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
    const dirty: { cx: number; cz: number; blocks: Uint16Array; biomes: Uint8Array }[] = [];
    for (const c of this.world.chunks.values()) {
      if (c.modified) {
        dirty.push({ cx: c.cx, cz: c.cz, blocks: c.blocks, biomes: c.biomes });
        this.world.markSaved(c);
      }
    }
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
    if (this.state === 'playing' || this.state === 'chat' || this.state === 'dead') this.time++;
    if (this.state !== 'playing' && this.state !== 'chat') {
      this.player.prevPos.copy(this.player.pos);
      return;
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
    if (p.inLava) this.damage(4, true);
    // void
    if (p.pos.y < WORLD_MIN_Y - 4) this.damage(4, true);
    // drowning
    const eye = p.pos.clone();
    eye.y += p.eyeHeight;
    const eyeState = this.world.getBlock(Math.floor(eye.x), Math.floor(eye.y), Math.floor(eye.z));
    const submerged = eyeState !== 0 && blocks.blockOf(eyeState).id === 'water';
    if (submerged) {
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
    p.health = Math.max(0, p.health - amount);
    p.hurtTime = 10;
    if (p.health <= 0) {
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
    for (let i = 1; i <= 9; i++) if (this.input.wasPressed(`hotbar${i}` as 'hotbar1')) inv.selected = i - 1;
    const wheel = this.input.consumeWheel();
    if (wheel !== 0) inv.selected = (((inv.selected + wheel) % 9) + 9) % 9;
    if (this.input.wasPressed('drop')) {
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
    if (this.input.wasPressed('swapHands')) {
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
    // mining
    if (this.input.isMouseDown(0) && t && !p.dead) {
      if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z || this.breaking.state !== t.state) {
        const ticks = breakTicks(t.state, p.heldItem(), { onGround: p.onGround, inWater: p.inWater, creative: p.gamemode === 'creative' });
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
    // placing / using
    if (this.input.isMouseDown(2) && this.useCooldown === 0 && t && !p.dead) {
      if (this.placeBlock(t)) this.useCooldown = 4;
      else this.useCooldown = 4;
    }
    // pick block (creative)
    if (this.input.clicked(1) && t && p.gamemode === 'creative') {
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

  breakBlock(x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    if (state === 0) return;
    const def = blocks.blockOf(state);
    if (def.hardness < 0 && this.player.gamemode !== 'creative') return;
    const p = this.player;
    const held = p.heldItem();
    if (p.gamemode === 'survival') {
      if (canHarvest(state, held)) {
        for (const drop of blockDrops(state, held)) this.dropStack(drop, x + 0.5, y + 0.5, z + 0.5, true);
      }
      if (held && items.byId.get(held.id)?.durability && def.hardness > 0) p.inventory.damageSelected(1);
      p.exhaustion += 0.005;
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
    // slab merging
    if (def.behavior === 'slab' && targetDef.id === def.id) {
      const type = blocks.prop(t.state, 'type');
      if ((type === 'bottom' && t.face === 1) || (type === 'top' && t.face === 0)) {
        this.world.setBlock(x, y, z, blocks.stateWith(def, { type: 'double', waterlogged: 'false' }));
        if (p.gamemode === 'survival') p.inventory.consumeSelected();
        return true;
      }
    }
    if (REPLACEABLE.has(targetDef.behavior) && targetDef.behavior !== 'air') {
      replacing = true;
    } else {
      const n = FACE_NORMALS[t.face];
      x += n[0];
      y += n[1];
      z += n[2];
    }
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return false;
    const existing = this.world.getBlock(x, y, z);
    if (!replacing && existing !== 0 && !REPLACEABLE.has(blocks.blockOf(existing).behavior)) return false;
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
    if (blocks.prop(state, 'half') === 'lower') {
      const upper = blocks.withProp(state, 'half', 'upper');
      if (this.world.getBlock(x, y + 1, z) === 0) this.world.setBlock(x, y + 1, z, upper);
    }
    if (p.gamemode === 'survival') p.inventory.consumeSelected();
    p.exhaustion += 0.005;
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
    if (def.behavior === 'bed') return null; // beds need two blocks and sleeping – next phase
    return blocks.stateWith(def, props);
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
      if (this.input.wasPressed('inventory')) this.hud.showToast('Inventory screen: next checklist item');
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
      `Entities: ${this.itemEntities.length} items`,
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
      case 'xp': {
        const n = Number(args[0] ?? 1);
        this.addXp(n);
        say(`Gave ${n} experience`);
        break;
      }
      case 'help':
        say('Commands: /gamemode /time /tp /give /clear /seed /kill /heal /spawnpoint /setblock /xp /weather /locate');
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
