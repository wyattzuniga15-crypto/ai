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
import type { StructureBundle } from '../world/protocol.ts';
import { buildStructureSets, structureStart, type StructureSet } from '../world/gen/structures.ts';
import { WorldGenerator, type StructureSpot } from '../world/gen/generator.ts';
import { Player } from '../entities/player.ts';
import { ItemEntity } from '../entities/itemEntity.ts';
import { blocks, type BlockDef } from '../blocks/registry.ts';
import { collisionBoxes } from '../blocks/collision.ts';
import { breakTicks, canHarvest } from '../blocks/mining.ts';
import { blockDrops, blockXp, chestLoot, fishingLoot } from '../items/loot.ts';
import { effectsOf, potionColor } from '../items/potions.ts';
import { items } from '../items/registry.ts';
import type { ItemStack } from '../items/inventory.ts';
import { Hud, xpForLevel } from '../ui/hud.ts';
import { Chat } from '../ui/chat.ts';
import { ItemIcons } from '../ui/icons.ts';
import type { Menus } from '../ui/menus.ts';
import { biomes } from '../world/biomes.ts';
import { MC_VERSION } from './constants.ts';
import { ContainerScreen, type ScreenDef } from '../ui/screens/container.ts';
import { brewingScreen, chestScreen, craftingTableScreen, dispenserScreen, furnaceScreen, hopperScreen, inventoryScreen, makeGrid, type CraftingGrid, horseScreen } from '../ui/screens/screens.ts';
import { containerKind, createBlockEntity, type BrewingEntity, type ContainerEntity, type FurnaceEntity, type HiveEntity, type SpawnerEntity } from '../blocks/blockEntity.ts';
import { tickFurnace } from '../blocks/furnace.ts';
import { tickBrewing } from '../blocks/brewing.ts';
import { cloneStack, type Slot } from '../items/inventory.ts';
import { Simulation } from '../world/simulation.ts';
import { applyBoneMeal, behaviorFor, type BlockWorld } from '../blocks/behaviors.ts';
import { BlockMeshFactory } from '../render/blockMesh.ts';
import { FallingBlockEntity } from '../entities/fallingBlock.ts';
import { PrimedTnt } from '../entities/primedTnt.ts';
import { FishingBobber, bobberMesh } from '../entities/bobber.ts';
import { CART_BLOCKS, CART_ITEMS, Minecart, cartKindFor, minecartMesh, type CartKind } from '../entities/minecart.ts';
import { FACING_OFFSET } from '../world/piston.ts';
import { containerAt, hopperStates, insertOne, tickHopper, type HopperWorld } from '../world/hopper.ts';
import { hooksFor, updateRun } from '../world/tripwire.ts';
import { isPowered, targetStrength } from '../world/redstone.ts';
import { Rng } from './rng.ts';
import { WATER_DELAY, LAVA_DELAY } from '../world/fluids.ts';
import { EntityManager, type ManagerHost } from '../entities/manager.ts';
import { type Mob } from '../entities/mob.ts';
import { entityDrops } from '../items/loot.ts';
import { explode, exposure, explosionDamage } from '../world/explosion.ts';
import { mobStats, CAT_FOODS, CHESTED_EQUINES, EQUINE_TYPES, HORSE_FOODS, villagerTypeFor } from '../entities/mobTypes.ts';
import { buildOffers, levelFor, professionForBlock, professionName, type Offer } from '../entities/villagers.ts';
import { tradingScreen, type Merchant } from '../ui/screens/trading.ts';
import type { AABB } from '../entities/physics.ts';
import { XpOrb, splitXp } from '../entities/xpOrb.ts';
import { AudioEngine, blockSoundGroup } from '../audio/audio.ts';
import { anvilScreen, enchantingScreen, grindstoneScreen, stateOf, type EnchantHost } from '../ui/screens/enchanting.ts';
import { smithingScreen, stonecutterScreen } from '../ui/screens/workstations.ts';
import { ParticleSystem } from '../render/particles.ts';
import { tintColor } from '../world/mesher.ts';
import { mobFireAssets, type Mob as MobType } from '../entities/mob.ts';
import { WOLF_FOODS, isBreedingFood } from '../entities/mobTypes.ts';
import { DYE_COLORS } from '../ui/specialIcons.ts';
import { countBookshelves } from '../items/enchanting.ts';
import { attachRecipeBook, recipeBookButton } from '../ui/screens/recipeBook.ts';
import { PlayerPreview } from '../ui/playerPreview.ts';
import { SignRenderer, isSignBlock } from '../blocks/signs.ts';
import { ChestRenderer, chestModel, chestStates, isChestBlock } from '../blocks/chests.ts';
import { BlockEntityRenderer, drawnStates } from '../blocks/blockEntityRender.ts';
import { compost, composterLevel, composterState } from '../blocks/composter.ts';
import { openSignEditor } from '../ui/signEditor.ts';
import type { SignEntity } from '../blocks/blockEntity.ts';

export interface GameAssets {
  blocks: LoadedAtlas;
  items: LoadedAtlas;
  models: ModelsJson;
  /** Vanilla structure templates; empty when `npm run structures` has not been run. */
  structures?: StructureBundle;
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

/** Vanilla's lightmap never reaches black: about 0.03 at Moody, lifted further by the brightness slider. */
const lightFloor = (gamma: number): number => 0.03 + gamma * 0.1;

/** Synthesized sound to play when a mob dies; variants reuse their base mob's voice. */
const MOB_DEATH_SOUNDS: Record<string, string> = {
  creeper: 'hurt', spider: 'hurt', cave_spider: 'hurt', husk: 'zombie', drowned: 'zombie', stray: 'skeleton', wither_skeleton: 'skeleton',
  slime: 'slime', slime_medium: 'slime', slime_big: 'slime', enderman: 'enderman', wolf: 'wolf', cod: 'splash', salmon: 'splash', witch: 'witch', phantom: 'phantom',
  horse: 'horse', donkey: 'donkey', mule: 'donkey', cat: 'cat', ocelot: 'cat',
};
const SLIME_SPLIT: Record<string, string> = { slime_big: 'slime_medium', slime_medium: 'slime' };

/** How far above a cart its rider sits, matching vanilla's minecart passenger offset. */
const RIDE_HEIGHT = 0.06;

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
  /** The mob the player is riding, its jump charge and the buck timer for untamed horses. */
  private mount: Mob | null = null;
  private jumpCharge = 0;
  private buckTimer = 0;
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
  /** TNT that has been lit and is counting down. */
  readonly primedTnt: PrimedTnt[] = [];
  /** Minecarts on the rails, and the one the player is sitting in. */
  readonly minecarts: Minecart[] = [];
  private cart: Minecart | null = null;
  /** Detector rails a cart has crossed, with the tick it last saw one, so the pulse can be held. */
  private readonly detectorsOn = new Map<string, number>();
  /** Tripwire strings something is standing in, and the ones that were still held last tick. */
  private readonly tripwiresOn = new Map<string, number>();
  private tripwiresChanged = new Set<string>();
  /** Pressure plates currently held down, and the tick the last thing stood on them. */
  private readonly platesDown = new Map<string, number>();
  private eating: { ticks: number; total: number; id: string } | null = null;
  private sleeping = 0;
  entities!: EntityManager;
  readonly xpOrbs: XpOrb[] = [];
  readonly audio = new AudioEngine();
  readonly signs: SignRenderer;
  /** The bobber on the water, while a rod is cast. */
  private bobber: FishingBobber | null = null;
  private bobberLine: THREE.Line | null = null;
  /** Chests are drawn as block entities, the way vanilla draws them. */
  private readonly chests: ChestRenderer;
  /** Beds, banners, shulker boxes, skulls and the conduit, which vanilla also draws itself. */
  private readonly blockEntities: BlockEntityRenderer;
  /** Every one of those in the loaded world. */
  private readonly drawnBlocks = new Set<string>();
  /** Every chest in the loaded world, so their meshes can be kept in step. */
  private readonly chestBlocks = new Set<string>();
  readonly particles: ParticleSystem;
  private lastAttacker: MobType | null = null;
  private lastVictim: MobType | null = null;
  private readonly blockAtlas: LoadedAtlas;
  private enchantSeed = (Math.random() * 0xffffffff) >>> 0;
  private signEditorClose: (() => void) | null = null;
  private stepDistance = 0;
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
    this.blockAtlas = opts.assets.blocks;
    this.structureBundle = opts.assets.structures;
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
      structures: opts.assets.structures,
      atlas: { width: atlasIndex.width, height: atlasIndex.height, tiles: atlasIndex.tiles },
      loadChunk: (cx, cz) => this.save.loadChunk(this.meta.id, cx, cz),
      genWorkers: opts.options.genWorkers,
    });
    this.input = new Input(this.renderer.canvas);
    this.input.setBindings(opts.options.bindings);
    this.blockMeshes = new BlockMeshFactory(this.baker, opts.assets.blocks);
    this.particles = new ParticleSystem(this.renderer.scene, opts.assets.blocks, (x, y, z) => {
      const st = this.world.getBlock(x, y, z);
      return st !== 0 && blocks.blockOf(st).solid;
    });
    mobFireAssets.material = mats.solid;
    this.uniforms.gamma.value = opts.options.gamma;
    this.uniforms.ambient.value = lightFloor(opts.options.gamma);
    mobFireAssets.tiles = [atlasIndex.tile('block/fire_0'), atlasIndex.tile('block/fire_1')];
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
      igniteTnt: (x, y, z) => this.igniteTnt(x, y, z),
      playNote: (x, y, z) => this.playNote(x, y, z),
      dispense: (x, y, z) => this.dispense(x, y, z),
    };
    this.simulation = new Simulation(blockWorld, () => this.world.chunks.values());
    this.world.onBlockChanged = (x, y, z, o, n) => {
      this.simulation.onBlockChanged(x, y, z, o, n);
      this.chestChanged(x, y, z, o, n);
    };
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
      playerLookDir: () => this.player.lookDirection(),
      playerTargetable: () => !this.player.dead && this.player.gamemode === 'survival',
      hurtPlayer: (amount, from, source) => {
        this.hurtByMob(amount, from);
        if (source) this.lastAttacker = source;
      },
      playerAttacker: () => (this.lastAttacker && !this.lastAttacker.dead && !this.lastAttacker.removed ? this.lastAttacker : null),
      playerVictim: () => (this.lastVictim && !this.lastVictim.dead && !this.lastVictim.removed ? this.lastVictim : null),
      addPlayerEffect: (id, ticks, amplifier = 0) => {
        if (this.player.gamemode === 'survival') this.player.effects.add(id, ticks, amplifier);
      },
      playSound: (name, x, y, z, pitch = 1) => this.audio.play(name, { x, y, z, pitch }),
      playerHolding: () => this.player.heldItem()?.id ?? null,
      findJobSite: (x, y, z, range, profession) => this.findJobSite(x, y, z, range, profession),
      findBlock: (x, y, z, range, ids) => this.findBlockNear(x, y, z, range, ids),
      enterHive: (m, x, y, z) => this.beeEntersHive(m, x, y, z),
      claimJobSite: (m, block) => this.claimJobSite(m, block),
      playerHasEffect: (id) => !!this.player.effects.get(id),
      playerHealth: () => this.player.health,
      throwPotion: (from, to, effect, color) => this.throwPotion(from, to, effect, color),
      ignitePlayer: (ticks) => {
        if (this.player.gamemode === 'survival') this.player.fireTicks = Math.max(this.player.fireTicks, ticks);
      },
      mobsNear: (x, y, z, range) => this.entities.mobsNear(x, y, z, range),
      spawnMob: (type, x, y, z, baby) => this.entities.spawn(type, x, y, z, rng.next() * Math.PI * 2, baby),
      dropItem: (id, count, x, y, z) => { this.dropStack({ id, count }, x, y + 0.3, z, true); },
      giveXp: (amount, x, y, z) => this.spawnXp(amount, x, y + 0.5, z),
      emitParticles: (kind, x, y, z, count, w, hh) => {
        if (kind === 'heart') this.particles.hearts(x, y, z, count, Math.random, w, hh);
        else if (kind === 'poof') this.particles.poof(x, y, z, count, Math.random, w, hh);
        else if (kind === 'happy') for (let i = 0; i < count; i++) this.particles.spawnSprite('happy', x + (Math.random() - 0.5) * w, y + Math.random() * hh, z + (Math.random() - 0.5) * w, 0, 0.02, 0, 20, 0.3);
        else for (let i = 0; i < count; i++) this.particles.spawnSprite('angry', x + (Math.random() - 0.5) * w, y + Math.random() * hh, z + (Math.random() - 0.5) * w, 0, 0.02, 0, 20, 0.3);
      },
      setBlock: (x, y, z, state) => this.world.setBlock(x, y, z, state),
      seed: opts.meta.seed,
      shootArrow: (from, to, v, d, effect) => {
        const arrow = this.entities.shootArrow(from, to, v, d);
        arrow.effect = effect;
        this.audio.play('bow', { x: from.x, y: from.y, z: from.z });
      },
      explode: (x, y, z, power, source) => this.explodeAt(x, y, z, power, source),
      lineOfSight: (a, b) => this.lineOfSight(a, b),
      get time() { return game.time; },
      rng: () => rng.next(),
      isChunkLoaded: (cx, cz) => !!this.world.getChunk(cx, cz),
      loadedChunkCount: () => this.world.chunks.size,
      onMobDeath: (m) => this.onMobDeath(m),
      getBiome: (x, z) => this.world.getBiome(x, z),
      topBlock: (x, z) => this.world.topBlock(x, z),
      arrowHitBlock: (x, y, z, point) => this.hitTarget(x, y, z, point),
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
      const mobs = this.serializeChunkEntities(c.cx, c.cz);
      for (const m of this.entities.mobs.slice()) if ((Math.floor(m.pos.x) >> 4) === c.cx && (Math.floor(m.pos.z) >> 4) === c.cz) this.entities.remove(m);
      for (let i = this.itemEntities.length - 1; i >= 0; i--) {
        const e = this.itemEntities[i];
        if ((Math.floor(e.pos.x) >> 4) === c.cx && (Math.floor(e.pos.z) >> 4) === c.cz) {
          this.renderer.scene.remove(e.sprite);
          this.itemEntities.splice(i, 1);
        }
      }
      for (let i = this.minecarts.length - 1; i >= 0; i--) {
        const cart = this.minecarts[i];
        if (cart === this.cart || (Math.floor(cart.pos.x) >> 4) !== c.cx || (Math.floor(cart.pos.z) >> 4) !== c.cz) continue;
        this.renderer.scene.remove(cart.mesh);
        this.minecarts.splice(i, 1);
      }
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
    this.signs = new SignRenderer(this.renderer.scene, import.meta.env.BASE_URL);
    this.chests = new ChestRenderer(this.renderer.scene, import.meta.env.BASE_URL);
    this.blockEntities = new BlockEntityRenderer(this.renderer.scene, import.meta.env.BASE_URL);
    this.audio.setVolume(opts.options.volume);
    const unlock = () => this.audio.unlock();
    this.renderer.canvas.addEventListener('mousedown', unlock);
    window.addEventListener('keydown', unlock);
    this.entities.onRestoreItem = (s) => {
      if (s.item) this.dropStack({ ...s.item }, s.x, s.y, s.z, false).pickupDelay = 0;
    };
    this.entities.onRestoreCart = (s) => {
      const kind = cartKindFor(s.type);
      if (!kind) return;
      const cart = this.spawnCart(kind, s.x, s.y, s.z);
      cart.yaw = s.yaw;
      const saved = (s.extra as { items?: Slot[] | null } | undefined)?.items;
      if (cart.items && Array.isArray(saved)) for (let i = 0; i < cart.items.length; i++) cart.items[i] = saved[i] ?? null;
    };
    window.addEventListener('beforeunload', this.unloadHandler);
  }

  // ---------------------------------------------------------------------------------------------
  // Lifecycle
  // ---------------------------------------------------------------------------------------------
  async start(progress: (text: string, p: number) => void): Promise<void> {
    const meta = this.meta;
    await Promise.all([this.icons.preload(), this.particles.preload(import.meta.env.BASE_URL)]);
    this.hud.setFireStrip(...this.fireStrip());
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
    this.signEditorClose?.();
    this.signs.clear();
    this.chests.prune(new Set());
    this.chestBlocks.clear();
    this.blockEntities.prune(new Set());
    this.drawnBlocks.clear();
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
    this.input.setBindings(o.bindings);
    this.renderer.setFov(o.fov);
    if (o.renderDistance !== this.world.renderDistance) {
      this.world.setRenderDistance(o.renderDistance);
      this.world.update(this.player.pos.x, this.player.pos.z);
    }
    this.uniforms.gamma.value = o.gamma;
    this.uniforms.ambient.value = lightFloor(o.gamma);
    this.audio.setVolume(o.volume);
  }

  async saveAll(): Promise<void> {
    const dirty: { cx: number; cz: number; blocks: Uint16Array; biomes: Uint8Array; entities: string | null; mobs: string | null }[] = [];
    const mobChunks = new Set<string>();
    for (const m of this.entities.mobs) if (!m.dead) mobChunks.add(`${Math.floor(m.pos.x) >> 4},${Math.floor(m.pos.z) >> 4}`);
    for (const e of this.itemEntities) if (!e.dead) mobChunks.add(`${Math.floor(e.pos.x) >> 4},${Math.floor(e.pos.z) >> 4}`);
    for (const c of this.minecarts) if (!c.dead) mobChunks.add(`${Math.floor(c.pos.x) >> 4},${Math.floor(c.pos.z) >> 4}`);
    for (const c of this.world.chunks.values()) {
      const key = `${c.cx},${c.cz}`;
      if (c.modified || mobChunks.has(key)) {
        const mobs = this.serializeChunkEntities(c.cx, c.cz);
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
    this.tickPrimedTnt();
    this.tickPressurePlates();
    this.tickTripwires();
    this.tickMinecarts();
    this.tickBobber();
    this.tickEffects();
    this.attackTicks++;
    this.rideTick();
    this.entities.tick(this.player.dead ? null : this.player.aabb());
    if (this.mount) this.seatPlayer();
    this.particles.tick();
    for (let i = this.xpOrbs.length - 1; i >= 0; i--) {
      const orb = this.xpOrbs[i];
      const got = orb.tick(this.world, this.player.dead ? null : this.player.pos);
      if (got > 0) {
        this.addXp(got);
        this.audio.play('orb', { pitch: 0.8 + Math.random() * 0.4 });
      }
      if (orb.dead) {
        this.renderer.scene.remove(orb.sprite);
        this.xpOrbs.splice(i, 1);
      }
    }
    this.tickSounds();
    if (this.tickCount % 20 === 0) {
      this.syncSigns();
      this.syncChests();
    }
    if (this.player.gamemode !== 'creative' || true) this.entities.hostileSpawnTick(pcx, pcz, Math.min(6, this.world.renderDistance));
    if (this.player.gamemode === 'survival') this.player.timeSinceRest++;
    this.entities.phantomSpawnTick(this.player.timeSinceRest, !this.isDay());
    this.entities.traderSpawnTick(this.isDay());
    this.entities.patrolSpawnTick(Math.floor(this.time / DAY_LENGTH));
    if (this.tickCount % 100 === 0) this.entities.traderDespawnTick();
    if (this.sleeping > 0 && --this.sleeping === 0) {
      const day = Math.floor(this.time / DAY_LENGTH);
      this.time = (day + 1) * DAY_LENGTH;
      this.chat.addLine('Good morning!', '#5f5');
      this.player.timeSinceRest = 0;
    }
    this.world.flush();
    if (this.screen) {
      this.screen.tick();
      if (++this.screenTicks % 5 === 0) this.screen.refresh();
    }
    const p = this.player;
    if (this.state === 'playing') this.handleHotbarKeys();
    p.tick(this.input, this.world, this.tickCount);
    if (this.cart) this.seatCart();
    this.trampleFarmland();
    this.survivalTick();
    if (this.state === 'playing') this.interactionTick();
    for (const e of this.itemEntities) {
      e.tick(this.world);
      this.hopperPickup(e);
      if (!e.dead && e.pickupDelay === 0 && !p.dead) {
        const d = e.pos.distanceTo(p.pos.clone().add(new THREE.Vector3(0, 0.9, 0)));
        if (d < 1.6) {
          const left = p.inventory.add(e.stack);
          if (left < e.stack.count) this.audio.play('pop', { pitch: 0.9 + Math.random() * 0.4, volume: 0.5 });
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
    const fireRes = !!p.effects.get('fire_resistance');
    if (p.inLava) {
      if (!fireRes) this.damage(4, true);
      p.fireTicks = Math.max(p.fireTicks, 300);
    }
    const feetId = blocks.idOf(this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y), Math.floor(p.pos.z)));
    if (feetId === 'fire' || feetId === 'soul_fire') {
      p.fireTicks = Math.max(p.fireTicks, 160);
      if (this.tickCount % 20 === 0 && !fireRes) this.damage(1, true);
    }
    if (p.inWater) p.fireTicks = 0;
    if (p.fireTicks > 0) {
      p.fireTicks--;
      if (p.fireTicks % 20 === 0 && !fireRes) this.damage(1, true);
    }
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
    this.audio.play(p.health <= 0 ? 'death' : 'hurt', { pitch: 0.9 + Math.random() * 0.2 });
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
    const e = new ItemEntity(stack, x, y, z, this.icons.forStack(stack), !!def?.block);
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
    if (this.input.tickPressed('attack') && !p.dead) {
      const eye = p.eyePosition(1, this.tmpEye);
      const dir = p.lookDirection(this.tmpDir);
      const hit = this.entities.raycast(eye, dir, 3);
      if (hit && (!t || hit.distance < t.distance)) {
        this.attackMob(hit.mob);
        this.breaking = null;
        this.useCooldown = 5;
        return;
      }
      const cart = this.cartUnderCursor();
      if (cart && cart !== this.cart && (!t || cart.pos.distanceTo(eye) < t.distance)) {
        this.breakCart(cart);
        this.breaking = null;
        this.useCooldown = 5;
        return;
      }
    }
    // mining
    if (this.input.isDown('attack') && t && !p.dead) {
      if (!this.breaking || this.breaking.x !== t.x || this.breaking.y !== t.y || this.breaking.z !== t.z || this.breaking.state !== t.state) {
        const ticks = breakTicks(t.state, p.heldItem(), { onGround: p.onGround, inWater: p.inWater, creative: p.gamemode === 'creative', haste: p.effects.level('haste'), miningFatigue: p.effects.level('mining_fatigue') });
        this.breaking = { x: t.x, y: t.y, z: t.z, state: t.state, progress: 0, ticks };
      }
      const b = this.breaking;
      if (b.ticks > 0 && this.tickCount % 2 === 0) this.blockParticles(t.x, t.y, t.z, t.state, blocks.blockOf(t.state), t.face);
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
    // right-clicking a mob (feeding, shearing, milking) comes before block use like vanilla
    if (this.input.tickPressed('use') && !p.dead && this.useCooldown === 0) {
      const eye = p.eyePosition(1, this.tmpEye);
      const dir = p.lookDirection(this.tmpDir);
      const hit = this.entities.raycast(eye, dir, 3);
      if (hit && (!t || hit.distance < t.distance) && this.interactMob(hit.mob)) {
        this.eating = null;
        this.useCooldown = 4;
        return;
      }
      const cart = this.cartUnderCursor();
      if (cart && cart !== this.cart && !cartKindFor(p.heldItem()?.id ?? '')) {
        this.useMinecart(cart);
        this.eating = null;
        this.useCooldown = 4;
        return;
      }
    }
    const held = p.heldItem();
    const heldDef = held ? items.byId.get(held.id) : undefined;
    const drinking = held?.id === 'potion';
    if (this.input.isDown('use') && !p.dead && (drinking || (heldDef?.food && this.canEat(heldDef)))) {
      if (!this.eating || this.eating.id !== held!.id) this.eating = { ticks: 0, total: drinking ? 32 : heldDef!.food!.eatTicks ?? 32, id: held!.id };
      if (++this.eating.ticks >= this.eating.total) {
        if (drinking) this.drinkPotion(held!);
        else this.eat(heldDef!);
        this.eating = null;
        this.useCooldown = 8;
      }
    } else {
      this.eating = null;
      if (this.input.tickPressed('use') && t && !p.dead && !p.sneaking && this.useBlock(t)) {
        this.useCooldown = 4;
      } else if (this.input.isDown('use') && this.useCooldown === 0 && !p.dead) {
        if (t) {
          const def = blocks.blockOf(t.state);
          const interactive = !p.sneaking && (def.behavior === 'container' || def.behavior === 'workstation' || !!behaviorFor(def)?.onUse);
          if (!interactive) this.useItem(t);
        } else this.useItem(null);
        this.useCooldown = 4;
      }
    }
    // pick block (creative)
    if (this.input.tickPressed('pick') && t && p.gamemode === 'creative') {
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
    this.blockParticles(x, y, z, state, def, null);
    const p = this.player;
    const held = byWorld ? null : p.heldItem();
    const entity = this.world.getBlockEntity(x, y, z);
    // a shulker box with anything inside always drops as one item carrying its contents (vanilla copy_components)
    const keepsContents = containerKind(def.id) === 'shulker_box' && entity && 'items' in entity && entity.items.some(Boolean);
    if (keepsContents) {
      this.dropStack({ id: def.id, count: 1, contents: entity.items.map((s) => (s ? cloneStack(s) : null)) }, x + 0.5, y + 0.5, z + 0.5, true);
      if (!byWorld && p.gamemode === 'survival') p.exhaustion += 0.005;
    } else if (byWorld) {
      for (const drop of blockDrops(state, null)) this.dropStack(drop, x + 0.5, y + 0.5, z + 0.5, true);
    } else if (p.gamemode === 'survival') {
      if (canHarvest(state, held)) {
        for (const drop of blockDrops(state, held)) this.dropStack(drop, x + 0.5, y + 0.5, z + 0.5, true);
      }
      // ores and spawners give experience to whoever mines them, unless silk touch took the block
      const xp = blockXp(def.id, held);
      if (xp > 0) this.spawnXp(xp, x + 0.5, y + 0.5, z + 0.5);
      if (held && items.byId.get(held.id)?.durability && def.hardness > 0) p.inventory.damageSelected(1);
      p.exhaustion += 0.005;
    }
    // containers spill their contents (ender chests keep theirs with the player)
    if (entity) {
      if ('items' in entity && !keepsContents) for (const s of entity.items) if (s) this.dropStack(s, x + 0.5, y + 0.5, z + 0.5, true);
      if (entity.type === 'sign') this.signs.remove(x, y, z);
      this.world.setBlockEntity(x, y, z, null);
      if (def.id === 'chest' || def.id === 'trapped_chest') this.unpairChest(x, y, z, state);
    }
    // remove the other half of two-block plants / doors
    const half = blocks.prop(state, 'half');
    if (half === 'lower' && this.world.getBlock(x, y + 1, z) !== 0 && blocks.stateBlock[this.world.getBlock(x, y + 1, z)] === blocks.stateBlock[state]) this.world.setBlock(x, y + 1, z, 0);
    if (half === 'upper' && blocks.stateBlock[this.world.getBlock(x, y - 1, z)] === blocks.stateBlock[state]) this.world.setBlock(x, y - 1, z, 0);
    if (!byWorld) this.audio.play(`dig_${blockSoundGroup(def.id, def.tool, def.behavior)}`, { x: x + 0.5, y: y + 0.5, z: z + 0.5, pitch: 0.8 });
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
    this.audio.play(`dig_${blockSoundGroup(def.id, def.tool, def.behavior)}`, { x: x + 0.5, y: y + 0.5, z: z + 0.5, pitch: 1.0 });
    const entity = createBlockEntity(def.id);
    if (entity && 'items' in entity) {
      const carried = p.heldItem()?.contents;
      if (carried) entity.items = carried.map((s) => (s ? cloneStack(s) : null));
    }
    if (entity) this.world.setBlockEntity(x, y, z, entity);
    if (def.id === 'chest' || def.id === 'trapped_chest') this.pairChest(x, y, z, state);
    if (entity?.type === 'sign') this.editSign(x, y, z, entity);
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
    if (isSignBlock(id) && !id.endsWith('_wall_sign')) {
      if (t.face === 0) return null;
      if (t.face >= 2) {
        const wall = id.replace(/_sign$/, '_wall_sign');
        if (blocks.has(wall)) return blocks.stateWith(wall, { facing: faceName, waterlogged: props.waterlogged ?? 'false' });
      }
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
      if (e.type === 'beehive') {
        this.tickHive(x, y, z, e as HiveEntity);
        return;
      }
      if (e.type === 'spawner') {
        this.tickSpawner(x, y, z, e as SpawnerEntity);
        return;
      }
      if (e.type === 'brewing_stand') {
        const brewer = e as BrewingEntity;
        if (tickBrewing(brewer)) {
          this.world.markModifiedAt(x, z);
          const st = this.world.getBlock(x, y, z);
          // the stand shows which of its three arms has a bottle on it
          if (st !== 0 && blocks.blockOf(st).id === 'brewing_stand') {
            let next = st;
            for (let i = 0; i < 3; i++) next = blocks.withProp(next, `has_bottle_${i}`, brewer.items[i] ? 'true' : 'false');
            if (next !== st) this.world.setBlock(x, y, z, next);
          }
        }
        return;
      }
      if (e.type === 'hopper') {
        tickHopper(this.hopperWorld(), x, y, z, e as ContainerEntity, isPowered(this.simulationWorld(), x, y, z));
        return;
      }
      if (e.type !== 'furnace' && e.type !== 'blast_furnace' && e.type !== 'smoker') return;
      const r = tickFurnace(e as FurnaceEntity);
      if (r.changed) this.world.markModifiedAt(x, z);
      if (r.litChanged) {
        const st = this.world.getBlock(x, y, z);
        if (st && blocks.blockOf(st).id === e.type) this.world.setBlock(x, y, z, blocks.withProp(st, 'lit', (e as FurnaceEntity).burnTime > 0 ? 'true' : 'false'));
      }
    });
  }

  /** The world as a hopper sees it: blocks, the containers in them, and a die to roll. */
  private hopperWorld(): HopperWorld {
    return {
      getBlock: (x, y, z) => this.world.getBlock(x, y, z),
      setBlock: (x, y, z, state) => this.world.setBlock(x, y, z, state),
      getBlockEntity: (x, y, z) => this.world.getBlockEntity(x, y, z) ?? null,
      setBlockEntity: (x, y, z, e) => this.world.setBlockEntity(x, y, z, e),
      markModified: (x, z) => this.world.markModifiedAt(x, z),
      random: () => Math.random(),
    };
  }

  /** Items lying on a hopper are drawn into it, which is how a collection floor is built. */
  private hopperPickup(e: ItemEntity): void {
    if (e.dead || e.pickupDelay > 0) return;
    const x = Math.floor(e.pos.x);
    const z = Math.floor(e.pos.z);
    const base = Math.floor(e.pos.y);
    // an item resting in the funnel counts as much as one lying on top of it
    for (const y of [base, base - 1, Math.floor(e.pos.y - 0.1)]) {
      const at = this.world.getBlock(x, y, z);
      if (at === 0 || blocks.blockOf(at).id !== 'hopper') continue;
      const entity = this.world.getBlockEntity(x, y, z) as ContainerEntity | null;
      if (!entity || entity.type !== 'hopper') continue;
      while (e.stack.count > 0 && insertOne({ entity, kind: 'hopper' }, e.stack, 'up')) e.stack.count--;
      if (e.stack.count <= 0) e.dead = true;
      this.world.markModifiedAt(x, z);
      return;
    }
  }

  /** Structure sets built from the fetched templates, used by `/locate`. */
  private get structureSets(): StructureSet[] {
    if (!this.builtStructureSets) {
      const bundle = this.structureBundle;
      this.builtStructureSets = bundle ? buildStructureSets(bundle.index, bundle.templates, bundle.pools) : [];
    }
    return this.builtStructureSets;
  }
  private builtStructureSets: StructureSet[] | null = null;
  private structureBundle: StructureBundle | undefined;

  /** A generator for biome queries away from the loaded chunks (used by `/locate`). */
  private get locateGenerator(): WorldGenerator {
    if (!this.locateGen) this.locateGen = new WorldGenerator(this.meta.seed);
    return this.locateGen;
  }
  private locateGen: WorldGenerator | null = null;

  /** Searches outward for the nearest region whose structure start is in a matching biome. */
  private locateStructure(set: StructureSet): { x: number; z: number } | null {
    const cx = Math.floor(this.player.pos.x) >> 4;
    const cz = Math.floor(this.player.pos.z) >> 4;
    // strongholds are not on a grid: the nearest of the ring positions is the answer
    if (set.placement === 'stronghold') {
      let best: { x: number; z: number } | null = null;
      let closest = Infinity;
      for (const ring of this.locateGenerator.strongholdRings(set)) {
        const d = (ring.cx - cx) ** 2 + (ring.cz - cz) ** 2;
        if (d < closest) {
          closest = d;
          best = { x: ring.cx * 16 + 2, z: ring.cz * 16 + 2 };
        }
      }
      return best;
    }
    const region = { x: Math.floor(cx / set.spacing), z: Math.floor(cz / set.spacing) };
    for (let r = 0; r <= 8; r++)
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
          const start = structureStart(this.meta.seed, set, region.x + dx, region.z + dz);
          const x = start.cx * 16 + 8;
          const z = start.cz * 16 + 8;
          // the search runs far past the loaded chunks, so ask the generator rather than the world
          if (set.biomeSet.has(biomes[this.locateGenerator.columnInfo(x, z).biome]?.id ?? '')) return { x, z };
        }
    return null;
  }

  /**
   * First look at a freshly generated chunk: bee nests come with three bees, and a pillager outpost
   * (spotted by the banners on its tower) comes with the pillagers that man it.
   */
  private populateStructures(cx: number, cz: number): void {
    let outpost: { x: number; y: number; z: number } | null = null;
    const beds: { x: number; y: number; z: number }[] = [];
    let paths = 0;
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        const wx = cx * 16 + x, wz = cz * 16 + z;
        const top = this.world.topBlock(wx, wz);
        if (top < 0) continue;
        // markers sit near the surface, so a short scan under the heightmap is enough
        for (let y = top; y > top - 28 && y > 0; y--) {
          const state = this.world.getBlock(wx, y, wz);
          if (!state) continue;
          const id = blocks.blockOf(state).id;
          if (id === 'bee_nest') this.populateBeeNest(wx, y, wz);
          else if (id === 'white_wall_banner' && !outpost) outpost = { x: wx, y, z: wz };
          else if (id === 'dirt_path') paths++;
          else if (id.endsWith('_bed') && blocks.prop(state, 'part') === 'head') beds.push({ x: wx, y, z: wz });
        }
      }
    if (outpost) this.populateOutpost(outpost.x, outpost.y, outpost.z);
    // a bed beside village paths means a villager sleeps there; igloo beds stand alone
    if (paths > 8) this.populateVillage(cx, cz, beds);
  }

  /**
   * Gives the block entities a structure asked for: chests filled from the vanilla loot table each
   * one carries, and spawners turning the mob their piece put there.
   */
  private applyStructureSpots(c: { pendingSpots: string | null }): void {
    if (!c.pendingSpots) return;
    let spots: StructureSpot[] = [];
    try {
      spots = JSON.parse(c.pendingSpots) as StructureSpot[];
    } catch {
      spots = [];
    }
    c.pendingSpots = null;
    for (const spot of spots) {
      if (spot.entity) {
        // mobs a structure comes with: the witch in her hut, and the black cat vanilla gives her
        const m = this.entities.spawn(spot.entity, spot.x + 0.5, spot.y, spot.z + 0.5, Math.random() * Math.PI * 2);
        if (m) {
          m.persistent = true;
          if (spot.entity === 'cat') m.extra.variant = 'all_black';
        }
        continue;
      }
      const state = this.world.getBlock(spot.x, spot.y, spot.z);
      if (!state) continue;
      const id = blocks.blockOf(state).id;
      if (this.world.getBlockEntity(spot.x, spot.y, spot.z)) continue;
      if (spot.mob) {
        // a trial chamber's spawner is a different block, but it turns a mob the same way
        if (id !== 'spawner' && id !== 'trial_spawner') continue;
        const spawner = createBlockEntity('spawner') as SpawnerEntity | null;
        if (!spawner) continue;
        spawner.mob = spot.mob;
        this.world.setBlockEntity(spot.x, spot.y, spot.z, spawner);
        this.world.markModifiedAt(spot.x, spot.z);
        continue;
      }
      if (!spot.table || !containerKind(id)) continue;
      const entity = createBlockEntity(id) as ContainerEntity | null;
      if (!entity) continue;
      // vanilla scatters the rolled stacks through the container
      for (const stack of chestLoot(spot.table, Math.random)) {
        for (let tries = 0; tries < 12; tries++) {
          const slot = Math.floor(Math.random() * entity.items.length);
          if (!entity.items[slot]) {
            entity.items[slot] = stack;
            break;
          }
        }
      }
      this.world.setBlockEntity(spot.x, spot.y, spot.z, entity);
      this.world.markModifiedAt(spot.x, spot.z);
    }
  }

  /** Vanilla puts a villager per bed in a village, and a cat or two around the houses. */
  private populateVillage(cx: number, cz: number, beds: { x: number; y: number; z: number }[]): void {
    const biome = biomes[this.world.getBiome(cx * 16 + 8, cz * 16 + 8)]?.id ?? 'plains';
    for (const bed of beds) {
      const top = this.world.topBlock(bed.x, bed.z);
      const m = this.entities.spawn('villager', bed.x + 0.5, Math.max(bed.y, top) + 1, bed.z + 0.5, Math.random() * Math.PI * 2);
      if (m) {
        m.extra.villagerType = villagerTypeFor(biome);
        m.extra.home = `${bed.x},${bed.y},${bed.z}`;
        m.persistent = true;
      }
    }
    if (beds.length && Math.random() < 0.5) {
      const bed = beds[Math.floor(Math.random() * beds.length)];
      const cat = this.entities.spawn('cat', bed.x + 1.5, bed.y + 1, bed.z + 0.5, Math.random() * Math.PI * 2);
      if (cat) cat.persistent = true;
    }
  }

  /** Every generated bee nest comes with three bees, as vanilla's nests do. */
  private populateBeeNest(wx: number, y: number, wz: number): void {
    for (let i = 0; i < 3; i++) {
      const spot = this.freeSpotNear(wx, y, wz);
      if (!spot) break;
      const bee = this.entities.spawn('bee', spot.x + (Math.random() - 0.5), spot.y + 0.2, spot.z + (Math.random() - 0.5), Math.random() * Math.PI * 2);
      if (bee) {
        bee.extra.hiveX = wx;
        bee.extra.hiveY = y;
        bee.extra.hiveZ = wz;
        bee.persistent = true;
      }
    }
  }

  /** Vanilla mans an outpost with pillagers, one of them a captain under the banner. */
  private populateOutpost(x: number, y: number, z: number): void {
    for (let i = 0; i < 4; i++) {
      const px = x + Math.floor(Math.random() * 9) - 4;
      const pz = z + Math.floor(Math.random() * 9) - 4;
      const top = this.world.topBlock(px, pz);
      if (top < 0) continue;
      const m = this.entities.spawn('pillager', px + 0.5, top + 1, pz + 0.5, Math.random() * Math.PI * 2);
      if (m) {
        m.persistent = true;
        m.extra.patrol = true;
        if (i === 0) m.extra.captain = true;
      }
    }
  }

  /**
   * Vanilla's `BaseSpawner`: a spawner runs only while a player is within sixteen blocks, then tries
   * four times to put a mob in the nine-by-three-by-nine box around it, stopping once six of them
   * are already there, and waits ten to forty seconds before the next batch.
   */
  private tickSpawner(x: number, y: number, z: number, e: SpawnerEntity): void {
    if (!e.mob) return;
    const p = this.player.pos;
    if (Math.abs(p.x - x) > 16 || Math.abs(p.y - y) > 16 || Math.abs(p.z - z) > 16) return;
    if (--e.delay > 0) return;
    e.delay = 200 + Math.floor(Math.random() * 600);
    this.world.markModifiedAt(x, z);
    this.entities.spawnerBurst(x, y, z, e.mob);
  }

  /**
   * Harvesting a hive: shears cut three honeycombs out of a full hive and a glass bottle fills with
   * honey. Vanilla angers the bees inside unless a campfire is burning under the hive.
   */
  /** Drinking a bottle: its effects go on the player and the glass comes back. */
  private drinkPotion(stack: ItemStack): void {
    const p = this.player;
    for (const e of effectsOf(stack)) {
      if (e.effect === 'instant_health') p.health = Math.min(20, p.health + 4 * (e.amplifier + 1));
      else if (e.effect === 'instant_damage') this.damage(3 * (e.amplifier + 1));
      else p.effects.add(e.effect, e.duration, e.amplifier);
    }
    this.audio.play('burp', { volume: 0.5, pitch: 1.1 });
    if (p.gamemode === 'creative') return;
    p.inventory.consumeSelected();
    if (p.inventory.add({ id: 'glass_bottle', count: 1 }) > 0) this.dropStack({ id: 'glass_bottle', count: 1 }, p.pos.x, p.pos.y + 1, p.pos.z, true);
  }

  /** A splash or lingering bottle, thrown the way vanilla lobs one. */
  private throwSplashPotion(stack: ItemStack): void {
    const p = this.player;
    const eye = p.eyePosition(1, this.tmpEye);
    const dir = p.lookDirection(this.tmpDir);
    const to = eye.clone().addScaledVector(dir, 8).add(new THREE.Vector3(0, -2, 0));
    const effects = effectsOf(stack);
    const lingering = stack.id === 'lingering_potion';
    this.throwPotionStack(eye.clone().addScaledVector(dir, 0.3), to, effects, potionColor(stack), lingering);
    if (p.gamemode !== 'creative') p.inventory.consumeSelected();
    this.useCooldown = 8;
  }

  /** Fills a glass bottle from the water the player is looking at. */
  private fillBottle(): void {
    const p = this.player;
    const eye = p.eyePosition(1, this.tmpEye);
    const dir = p.lookDirection(this.tmpDir);
    const hit = this.world.raycast(eye, dir, BLOCK_REACH, true);
    if (!hit || blocks.blockOf(hit.state).id !== 'water') return;
    this.audio.play('splash', { x: hit.x, y: hit.y, z: hit.z, volume: 0.5 });
    if (p.gamemode === 'creative') return;
    p.inventory.consumeSelected();
    const bottle: ItemStack = { id: 'potion', count: 1, potion: 'water' };
    if (p.inventory.add(bottle) > 0) this.dropStack(bottle, p.pos.x, p.pos.y + 1, p.pos.z, true);
  }

  /** The rod: the first use casts, the second reels in whatever is on the line. */
  private useRod(): void {
    if (this.bobber) {
      this.reelIn();
      return;
    }
    const p = this.player;
    const eye = p.eyePosition(1, this.tmpEye);
    const dir = p.lookDirection(this.tmpDir).clone();
    const lure = p.heldItem()?.enchantments?.lure ?? 0;
    const bobber = new FishingBobber(eye.x, eye.y - 0.1, eye.z, dir, lure, bobberMesh(import.meta.env.BASE_URL));
    this.bobber = bobber;
    this.renderer.scene.add(bobber.mesh);
    const geometry = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    this.bobberLine = new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: 0x000000 }));
    this.renderer.scene.add(this.bobberLine);
    this.audio.play('bow', { volume: 0.4, pitch: 1.4 });
  }

  /**
   * Reeling in. A bite on the line is a catch: vanilla rolls its fishing table, weighted by luck of
   * the sea and needing open water for treasure, throws the catch to the player and gives a little
   * experience for it.
   */
  private reelIn(): void {
    const bobber = this.bobber;
    if (!bobber) return;
    const p = this.player;
    const held = p.heldItem();
    if (bobber.biting) {
      const luck = (held?.enchantments?.luck_of_the_sea ?? 0) + p.effects.level('luck') - p.effects.level('bad_luck');
      const open = bobber.openWater(this.world);
      for (const stack of fishingLoot(luck, open)) {
        const e = this.dropStack(stack, bobber.pos.x, bobber.pos.y + 0.2, bobber.pos.z, false);
        // vanilla throws the catch to whoever reeled it in
        const to = new THREE.Vector3(p.pos.x - bobber.pos.x, p.pos.y + 0.5 - bobber.pos.y, p.pos.z - bobber.pos.z);
        e.vel.copy(to).multiplyScalar(0.1);
        e.vel.y += Math.sqrt(Math.max(0, to.length())) * 0.08;
        e.pickupDelay = 0;
        e.thrown = 20;
      }
      this.spawnXp(1 + Math.floor(Math.random() * 6), p.pos.x, p.pos.y + 0.5, p.pos.z);
      if (p.gamemode !== 'creative' && held?.id === 'fishing_rod') p.inventory.damageSelected(1);
      this.audio.play('pop', { pitch: 1.2 });
    }
    this.removeBobber();
  }

  private removeBobber(): void {
    if (this.bobber) this.renderer.scene.remove(this.bobber.mesh);
    if (this.bobberLine) {
      this.renderer.scene.remove(this.bobberLine);
      this.bobberLine.geometry.dispose();
      (this.bobberLine.material as THREE.Material).dispose();
    }
    this.bobber = null;
    this.bobberLine = null;
  }

  /** The line is dropped when the rod is put away, the player dies, or it lands too far off. */
  private tickBobber(): void {
    const bobber = this.bobber;
    if (!bobber) return;
    bobber.tick(this.world);
    const p = this.player;
    const held = p.heldItem();
    if (p.dead || held?.id !== 'fishing_rod' || bobber.pos.distanceTo(p.pos) > 32 || bobber.pos.y < WORLD_MIN_Y) {
      this.removeBobber();
      return;
    }
    // a bite pulls the bobber under and throws up a trail of bubbles, as vanilla shows it
    if (bobber.biting && this.tickCount % 2 === 0) {
      this.particles.spawnSprite('smoke', bobber.pos.x, bobber.pos.y + 0.1, bobber.pos.z, 0, 0.01, 0, 12, 0.12);
    }
  }

  /** The string from the rod in the player's hand out to the bobber. */
  private updateBobberLine(alpha: number): void {
    const line = this.bobberLine;
    const bobber = this.bobber;
    if (!line || !bobber) return;
    const eye = this.player.eyePosition(alpha, this.tmpEye);
    const dir = this.player.lookDirection(this.tmpDir);
    const side = new THREE.Vector3(-dir.z, 0, dir.x).normalize();
    const from = eye.clone().addScaledVector(dir, 0.4).addScaledVector(side, 0.35).setY(eye.y - 0.25);
    const to = bobber.mesh.position;
    line.geometry.setFromPoints([from, to]);
    line.geometry.computeBoundingSphere();
  }

  /** A hoe on soil: vanilla's tillables, each turning into what it turns into. */
  private tillSoil(t: RaycastHit): boolean {
    const id = blocks.idOf(t.state);
    const above = this.world.getBlock(t.x, t.y + 1, t.z);
    const clear = above === 0 || blocks.blockOf(above).replaceable === true;
    let into: string | null = null;
    let drop: string | null = null;
    if (id === 'rooted_dirt') {
      into = 'dirt';
      drop = 'hanging_roots';
    } else if (id === 'coarse_dirt') into = 'dirt';
    else if ((id === 'dirt' || id === 'grass_block' || id === 'dirt_path') && clear) into = 'farmland';
    if (!into) return false;
    this.world.setBlock(t.x, t.y, t.z, blocks.defaultState(into));
    if (drop) this.dropStack({ id: drop, count: 1 }, t.x + 0.5, t.y + 1, t.z + 0.5, true);
    if (this.player.gamemode !== 'creative') this.player.inventory.damageSelected(1);
    this.audio.play('dig_gravel', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 });
    return true;
  }

  /** Landing on farmland from a height turns it back to dirt, as vanilla tramples a field. */
  private trampleFarmland(): void {
    const p = this.player;
    if (p.landed <= 0.5 || p.gamemode === 'spectator') return;
    const x = Math.floor(p.pos.x);
    const y = Math.floor(p.pos.y - 0.1);
    const z = Math.floor(p.pos.z);
    const state = this.world.getBlock(x, y, z);
    if (state === 0 || blocks.idOf(state) !== 'farmland') return;
    if (Math.random() >= p.landed - 0.5) return;
    this.world.setBlock(x, y, z, blocks.defaultState('dirt'));
    const above = this.world.getBlock(x, y + 1, z);
    if (above !== 0 && blocks.blockOf(above).behavior === 'crop') this.breakBlock(x, y + 1, z);
  }

  /**
   * A composter: what the player is holding goes in, on vanilla's odds, and a ready one hands its
   * bone meal back and starts again.
   */
  private useComposter(t: RaycastHit): boolean {
    const p = this.player;
    const level = composterLevel(t.state);
    const at = { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 };
    if (level >= 8) {
      this.dropStack({ id: 'bone_meal', count: 1 }, at.x, at.y + 0.4, at.z, true);
      this.world.setBlock(t.x, t.y, t.z, composterState(0));
      this.audio.play('pop', { ...at, pitch: 0.8 });
      return true;
    }
    const held = p.heldItem();
    if (!held) return false;
    const result = compost(t.state, held.id, Math.random());
    if (!result) return false;
    if (p.gamemode !== 'creative') p.inventory.consumeSelected();
    this.audio.play('click', { ...at, pitch: result.filled ? 1.2 : 0.8 });
    if (!result.filled) return true;
    this.world.setBlock(t.x, t.y, t.z, result.state);
    for (let i = 0; i < 8; i++) {
      this.particles.spawnSprite('happy', at.x + (Math.random() - 0.5) * 0.6, t.y + 0.2 + composterLevel(result.state) * 0.09, at.z + (Math.random() - 0.5) * 0.6, 0, 0.01, 0, 20, 0.2);
    }
    // the seventh load ripens a moment later, as vanilla schedules it
    if (composterLevel(result.state) === 7) this.simulation.schedule(t.x, t.y, t.z, 20, this.tickCount);
    return true;
  }

  private useHive(t: RaycastHit, id: string): boolean {
    const held = this.player.heldItem();
    if (!held || (held.id !== 'shears' && held.id !== 'glass_bottle')) return false;
    const level = Number(blocks.prop(t.state, 'honey_level') ?? '0');
    if (level < 5) return false;
    const survival = this.player.gamemode === 'survival';
    if (held.id === 'shears') {
      this.dropStack({ id: 'honeycomb', count: 3 }, t.x + 0.5, t.y + 0.5, t.z + 0.5, true);
      if (survival) this.player.inventory.damageSelected(1);
      this.audio.play('shear', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 });
    } else {
      if (survival) this.player.inventory.consumeSelected();
      if (this.player.inventory.add({ id: 'honey_bottle', count: 1 }) > 0) this.dropStack({ id: 'honey_bottle', count: 1 }, this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, true);
      this.audio.play('bottle_fill', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 });
    }
    this.world.setBlock(t.x, t.y, t.z, blocks.withProp(t.state, 'honey_level', '0'));
    this.world.markModifiedAt(t.x, t.z);
    if (!this.campfireUnder(t.x, t.y, t.z)) this.angerBees(t.x, t.y, t.z, id);
    return true;
  }

  /** A lit campfire within five blocks below a hive calms the bees (vanilla's smoke rule). */
  private campfireUnder(x: number, y: number, z: number): boolean {
    for (let dy = 1; dy <= 5; dy++) {
      const state = this.world.getBlock(x, y - dy, z);
      if (!state) continue;
      const def = blocks.blockOf(state);
      if (def.id.endsWith('campfire')) return blocks.prop(state, 'lit') !== 'false';
      if (def.solid) return false;
    }
    return false;
  }

  /** Sends the hive's bees after the player, releasing the ones still inside. */
  private angerBees(x: number, y: number, z: number, id: string): void {
    const e = this.world.getBlockEntity(x, y, z) as HiveEntity | null;
    if (e && e.type === 'beehive') {
      for (let i = e.bees.length - 1; i >= 0; i--) {
        const spot = this.freeSpotNear(x, y, z);
        if (!spot) break;
        const bee = this.entities.spawn('bee', spot.x, spot.y, spot.z, Math.random() * Math.PI * 2);
        if (bee) {
          bee.extra.hiveX = x;
          bee.extra.hiveY = y;
          bee.extra.hiveZ = z;
          bee.target = 'player';
        }
        e.bees.splice(i, 1);
        e.nectar.splice(i, 1);
      }
      this.world.markModifiedAt(x, z);
    }
    for (const m of this.entities.mobsNear(x, y, z, 16)) if (m.def.id === 'bee') m.target = 'player';
    void id;
  }

  /**
   * Bee nests and hives: a bee that went in with nectar raises the honey level when it comes back
   * out, and the hive drips honey particles once it is full (vanilla honey_level 5).
   */
  private tickHive(x: number, y: number, z: number, e: HiveEntity): void {
    if (!e.bees.length) return;
    const night = !this.isDay();
    for (let i = e.bees.length - 1; i >= 0; i--) {
      e.bees[i]++;
      // vanilla keeps a bee inside for 600 ticks, or 2400 when it carried nectar home
      if (e.bees[i] < (e.nectar[i] ? 2400 : 600) || night) continue;
      const state = this.world.getBlock(x, y, z);
      if (!state) {
        e.bees.splice(i, 1);
        e.nectar.splice(i, 1);
        continue;
      }
      if (e.nectar[i]) {
        const level = Number(blocks.prop(state, 'honey_level') ?? '0');
        if (level < 5) this.world.setBlock(x, y, z, blocks.withProp(state, 'honey_level', String(level + 1)));
      }
      const spot = this.freeSpotNear(x, y, z);
      if (!spot) continue;
      const bee = this.entities.spawn('bee', spot.x, spot.y, spot.z, Math.random() * Math.PI * 2);
      if (bee) {
        bee.extra.hiveX = x;
        bee.extra.hiveY = y;
        bee.extra.hiveZ = z;
        bee.persistent = true;
      }
      e.bees.splice(i, 1);
      e.nectar.splice(i, 1);
      this.world.markModifiedAt(x, z);
    }
  }

  /** An air block beside a hive for a bee to appear in. */
  private freeSpotNear(x: number, y: number, z: number): { x: number; y: number; z: number } | null {
    for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, 1, 0], [0, -1, 0]] as const) {
      if (this.world.getBlock(x + dx, y + dy, z + dz) === 0) return { x: x + dx + 0.5, y: y + dy, z: z + dz + 0.5 };
    }
    return null;
  }

  /** A bee reaching its hive goes inside; the hive remembers whether it brought nectar. */
  private beeEntersHive(m: Mob, x: number, y: number, z: number): boolean {
    const state = this.world.getBlock(x, y, z);
    const id = state ? blocks.blockOf(state).id : '';
    if (id !== 'beehive' && id !== 'bee_nest') return false;
    const e = this.world.getBlockEntity(x, y, z) as HiveEntity | null;
    if (!e || e.type !== 'beehive' || e.bees.length >= 3) return false;
    e.bees.push(0);
    e.nectar.push(m.extra.nectar === true);
    this.world.markModifiedAt(x, z);
    this.entities.remove(m);
    return true;
  }

  /** Nearest block matching any of `ids` around a point, searched outward from the centre. */
  private findBlockNear(x: number, y: number, z: number, range: number, ids: string[]): { x: number; y: number; z: number; block: string } | null {
    const want = new Set(ids);
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    let best: { x: number; y: number; z: number; block: string } | null = null;
    let bestDist = Infinity;
    for (let dy = -4; dy <= 4; dy++)
      for (let dx = -range; dx <= range; dx++)
        for (let dz = -range; dz <= range; dz++) {
          const state = this.world.getBlock(bx + dx, by + dy, bz + dz);
          if (!state) continue;
          const id = blocks.blockOf(state).id;
          if (!want.has(id)) continue;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestDist) {
            bestDist = d;
            best = { x: bx + dx, y: by + dy, z: bz + dz, block: id };
          }
        }
    return best;
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
    if (behavior?.onUse && behavior.onUse({ w: this.simulationWorld(), x: t.x, y: t.y, z: t.z, state: t.state, def })) {
      if (def.behavior === 'door' || def.behavior === 'trapdoor' || def.behavior === 'fence_gate') this.audio.play('door', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 });
      else if (def.behavior === 'button' || def.id === 'lever') this.audio.play('click', { x: t.x + 0.5, y: t.y + 0.5, z: t.z + 0.5 });
      return true;
    }
    if (def.id === 'beehive' || def.id === 'bee_nest') {
      if (this.useHive(t, def.id)) return true;
    }
    if (def.id === 'crafting_table') {
      const grid = makeGrid(3, 3);
      const screen = craftingTableScreen(inv, grid);
      let book: ReturnType<typeof attachRecipeBook> | null = null;
      screen.overlay = (root) => {
        if (!book) {
          book = attachRecipeBook(root, { icons: this.icons, inventory: inv, grid, guiScale: this.options.guiScale, refresh: () => this.screen?.refresh() }, 3);
          recipeBookButton(root, 5, 35, this.options.guiScale, () => book?.toggle());
        }
      };
      this.openScreen(screen, () => {
        book?.destroy();
        this.returnGrid(grid);
      });
      return true;
    }
    if (def.id === 'ender_chest') {
      this.openScreen(chestScreen(inv, p.enderChest, 3, 'Ender Chest'), () => this.chests.setOpen(null));
      this.chests.setOpen(`${t.x},${t.y},${t.z}`);
      return true;
    }
    if (def.id === 'composter') return this.useComposter(t);
    if (def.id === 'brewing_stand') {
      let entity = this.world.getBlockEntity(t.x, t.y, t.z) as BrewingEntity | undefined;
      if (!entity || entity.type !== 'brewing_stand') {
        entity = createBlockEntity('brewing_stand') as BrewingEntity;
        this.world.setBlockEntity(t.x, t.y, t.z, entity);
      }
      const screen = brewingScreen(inv, entity, mark);
      screen.onChange = mark;
      this.openScreen(screen);
      return true;
    }
    if (def.id === 'enchanting_table') {
      const shelves = countBookshelves((x, y, z) => blocks.idOf(this.world.getBlock(x, y, z)), t.x, t.y, t.z);
      const seedRef = { seed: this.enchantSeed };
      const screen = enchantingScreen(this.enchantHost(), shelves, seedRef);
      this.openScreen(screen, () => {
        this.enchantSeed = seedRef.seed;
        (screen as ScreenDef & { cleanup?: () => void }).cleanup?.();
        this.returnSlots(stateOf(screen));
      });
      return true;
    }
    if (def.id === 'anvil' || def.id === 'chipped_anvil' || def.id === 'damaged_anvil') {
      const screen = anvilScreen(this.enchantHost());
      this.openScreen(screen, () => this.returnSlots(stateOf(screen)));
      return true;
    }
    if (def.id === 'grindstone') {
      const screen = grindstoneScreen(this.enchantHost(), new Rng((Math.random() * 1e9) >>> 0));
      this.openScreen(screen, () => this.returnSlots(stateOf(screen)));
      return true;
    }
    if (def.id === 'stonecutter') {
      const screen = stonecutterScreen({ ...this.enchantHost(), icons: this.icons, refresh: () => this.screen?.refresh() });
      this.openScreen(screen, () => this.returnSlots(stateOf(screen)));
      return true;
    }
    if (def.id === 'smithing_table') {
      const screen = smithingScreen({ ...this.enchantHost(), icons: this.icons, refresh: () => this.screen?.refresh() });
      this.openScreen(screen, () => this.returnSlots(stateOf(screen)));
      return true;
    }
    if (isSignBlock(def.id)) {
      const entity = this.world.getBlockEntity(t.x, t.y, t.z) as SignEntity | undefined;
      if (entity?.type === 'sign') this.editSign(t.x, t.y, t.z, entity, this.signSide(def.id, t.state, t.x, t.z));
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
        const screen = furnaceScreen(inv, entity as FurnaceEntity, (n) => this.spawnXp(n, p.pos.x, p.pos.y + 1, p.pos.z));
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
        this.openScreen(screen, () => this.chests.setOpen(null));
        this.chests.setOpen(`${t.x},${t.y},${t.z}`);
        return true;
      }
      const title = def.name;
      const screen = c.type === 'hopper' ? hopperScreen(inv, c.items, mark) : c.type === 'dispenser' || c.type === 'dropper' ? dispenserScreen(inv, c.items, title, mark) : chestScreen(inv, c.items, 3, c.type === 'shulker_box' ? 'Shulker Box' : title, mark, c.type === 'shulker_box' ? (s) => !s.id.endsWith('shulker_box') : undefined);
      screen.onChange = mark;
      this.openScreen(screen, isChestBlock(def.id) ? () => this.chests.setOpen(null) : undefined);
      if (isChestBlock(def.id)) this.chests.setOpen(`${t.x},${t.y},${t.z}`);
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
    const kind = cartKindFor(held.id);
    if (kind && t) {
      // vanilla places the cart on the rail itself, not on the face that was clicked
      if (this.placeMinecart(kind, t.x, t.y, t.z) && p.gamemode === 'survival') p.inventory.consumeSelected();
      return;
    }
    if (def.behavior === 'fishing_rod') {
      this.useRod();
      return;
    }
    if (def.behavior === 'potion' && held.id !== 'potion') {
      this.throwSplashPotion(held);
      return;
    }
    if (def.behavior === 'bottle') {
      this.fillBottle();
      return;
    }
    if (def.behavior === 'hoe' && t && this.tillSoil(t)) return;
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
    this.audio.play('burp', { volume: 0.6 });
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

  /** Lights a block of TNT: the block goes and a primed one takes its place, fuse burning. */
  igniteTnt(x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    if (state === 0 || blocks.blockOf(state).id !== 'tnt') return;
    this.world.setBlock(x, y, z, 0);
    const e = new PrimedTnt(x + 0.5, y, z + 0.5, this.blockMeshes.mesh(state));
    this.primedTnt.push(e);
    this.renderer.scene.add(e.mesh);
    this.audio.play('fuse', { x, y, z });
  }

  /** A note block sounds the pitch its state carries, two octaves over twenty-five steps. */
  playNote(x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    if (state === 0) return;
    const note = Number(blocks.prop(state, 'note') ?? '0');
    this.audio.play('note', { x, y, z, pitch: 2 ** ((note - 12) / 12) });
  }

  /**
   * Pressure plates: vanilla checks what is standing on a plate every tick and holds it down for
   * twenty ticks after the last thing steps off. Wooden plates count entities, stone ones only take
   * players and mobs, and the weighted plates scale with how much is on them.
   */
  private tickPressurePlates(): void {
    const pressed = new Set<string>();
    const feet = (x: number, y: number, z: number): void => {
      const bx = Math.floor(x);
      const by = Math.floor(y + 0.01);
      const bz = Math.floor(z);
      for (const py of [by, by - 1]) {
        const state = this.world.getBlock(bx, py, bz);
        if (state === 0 || !blocks.blockOf(state).id.endsWith('_pressure_plate')) continue;
        pressed.add(`${bx},${py},${bz}`);
        break;
      }
    };
    if (!this.player.dead) feet(this.player.pos.x, this.player.pos.y, this.player.pos.z);
    for (const m of this.entities.mobs) if (!m.dead) feet(m.pos.x, m.pos.y, m.pos.z);
    for (const e of this.itemEntities) feet(e.pos.x, e.pos.y, e.pos.z);

    for (const key of pressed) {
      this.platesDown.set(key, this.tickCount);
      const [x, y, z] = key.split(',').map(Number);
      const state = this.world.getBlock(x, y, z);
      if (blocks.prop(state, 'powered') === 'true' || blocks.prop(state, 'power') === '15') continue;
      this.world.setBlock(x, y, z, this.plateState(state, true));
    }
    // and let go of the ones nothing is standing on any more
    for (const [key, when] of this.platesDown) {
      if (pressed.has(key) || this.tickCount - when < 20) continue;
      this.platesDown.delete(key);
      const [x, y, z] = key.split(',').map(Number);
      const state = this.world.getBlock(x, y, z);
      if (state === 0 || !blocks.blockOf(state).id.endsWith('_pressure_plate')) continue;
      this.world.setBlock(x, y, z, this.plateState(state, false));
    }
  }

  /**
   * Tripwire: anything standing in a string powers the whole run, hooks included, and vanilla lets
   * the signal go again half a second after the last thing steps off.
   */
  private tickTripwires(): void {
    const touched = new Set<string>();
    const cross = (x: number, y: number, z: number, height: number): void => {
      const bx = Math.floor(x);
      const bz = Math.floor(z);
      for (let by = Math.floor(y); by <= Math.floor(y + height); by++) {
        const state = this.world.getBlock(bx, by, bz);
        if (state !== 0 && blocks.blockOf(state).id === 'tripwire') touched.add(`${bx},${by},${bz}`);
      }
    };
    if (!this.player.dead) cross(this.player.pos.x, this.player.pos.y, this.player.pos.z, this.player.sneaking ? 1.5 : 1.8);
    for (const m of this.entities.mobs) if (!m.dead) cross(m.pos.x, m.pos.y, m.pos.z, m.height);
    for (const e of this.itemEntities) cross(e.pos.x, e.pos.y, e.pos.z, 0.25);
    for (const c of this.minecarts) cross(c.pos.x, c.pos.y, c.pos.z, 0.7);

    for (const key of touched) this.tripwiresOn.set(key, this.tickCount);
    const held = new Set<string>();
    for (const [key, when] of this.tripwiresOn) {
      if (!touched.has(key) && this.tickCount - when >= 10) this.tripwiresOn.delete(key);
      else held.add(key);
    }
    // rewrite every run a change touches, which is what carries the signal to the hooks
    const runs = new Set<string>();
    for (const key of new Set([...touched, ...this.tripwiresChanged])) {
      const [x, y, z] = key.split(',').map(Number);
      for (const [hx, hy, hz] of hooksFor(this.world, x, y, z)) runs.add(`${hx},${hy},${hz}`);
    }
    this.tripwiresChanged = new Set(held);
    for (const key of runs) {
      const [x, y, z] = key.split(',').map(Number);
      updateRun(this.world, x, y, z, ([px, py, pz]) => held.has(`${px},${py},${pz}`));
    }
  }

  /**
   * An arrow in a target block: vanilla reads how near the middle of the face it struck and holds
   * that signal for a second before letting it go.
   */
  private hitTarget(x: number, y: number, z: number, point: THREE.Vector3): void {
    const state = this.world.getBlock(x, y, z);
    if (state === 0 || blocks.blockOf(state).id !== 'target') return;
    const power = targetStrength(x, y, z, point.x, point.y, point.z);
    this.world.setBlock(x, y, z, blocks.withProp(state, 'power', String(power)));
    this.simulation.schedule(x, y, z, 20, this.tickCount);
    this.audio.play('click', { x, y, z, pitch: 0.5 + power / 15 });
  }

  /** A plate's pressed state, whichever of the two ways its block counts its load. */
  private plateState(state: number, down: boolean): number {
    if (blocks.prop(state, 'power') !== undefined) return blocks.withProp(state, 'power', down ? '15' : '0');
    return blocks.withProp(state, 'powered', down ? 'true' : 'false');
  }

  /**
   * A dispenser fires the first item it can, a dropper simply drops one. Vanilla has a behaviour per
   * item; ours shoots what can be shot, lights what can be lit, and throws the rest out in front.
   */
  dispense(x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    if (state === 0) return;
    const def = blocks.blockOf(state);
    if (def.id !== 'dispenser' && def.id !== 'dropper') return;
    const entity = this.world.getBlockEntity(x, y, z) as ContainerEntity | null;
    if (!entity || !('items' in entity)) return;
    const slots = entity.items.map((s, i) => [s, i] as const).filter(([s]) => s && s.count > 0);
    if (!slots.length) {
      this.audio.play('click', { x, y, z, pitch: 0.8 });
      return;
    }
    const [stack, slot] = slots[Math.floor(Math.random() * slots.length)];
    const facing = blocks.prop(state, 'facing') ?? 'up';
    const [dx, dy, dz] = FACING_OFFSET[facing];
    const from = new THREE.Vector3(x + 0.5 + dx * 0.7, y + 0.5 + dy * 0.7, z + 0.5 + dz * 0.7);
    const take = (): void => {
      stack!.count--;
      if (stack!.count <= 0) entity.items[slot] = null;
      this.world.markModifiedAt(x, z);
    };
    // a dropper only ever drops; a dispenser uses what it can
    if (def.id === 'dispenser') {
      if (stack!.id === 'arrow' || stack!.id === 'spectral_arrow' || stack!.id === 'tipped_arrow') {
        take();
        this.entities.shootArrow(from, from.clone().add(new THREE.Vector3(dx, dy, dz).multiplyScalar(8)), 1.6, 6, true);
        this.audio.play('bow', { x, y, z });
        return;
      }
      if (stack!.id === 'flint_and_steel') {
        const at = this.world.getBlock(x + dx, y + dy, z + dz);
        if (blocks.blockOf(at).id === 'tnt') this.igniteTnt(x + dx, y + dy, z + dz);
        else if (at === 0) this.world.setBlock(x + dx, y + dy, z + dz, blocks.defaultState('fire'));
        this.audio.play('fizz', { x, y, z });
        take();
        return;
      }
      if (stack!.id === 'tnt') {
        take();
        this.world.setBlock(x + dx, y + dy, z + dz, blocks.defaultState('tnt'));
        this.igniteTnt(x + dx, y + dy, z + dz);
        return;
      }
    }
    take();
    const dropped = this.dropStack({ id: stack!.id, count: 1, ...(stack!.enchantments ? { enchantments: stack!.enchantments } : {}) }, from.x, from.y, from.z, true);
    if (dropped) dropped.vel.set(dx * 0.3, dy * 0.3 + 0.1, dz * 0.3);
    this.audio.play('click', { x, y, z });
  }

  /**
   * Minecarts roll along their rails; the one being ridden takes a little push from the keys, as
   * vanilla lets a rider nudge a cart along, and carries the player with it.
   */
  private tickMinecarts(): void {
    for (let i = this.minecarts.length - 1; i >= 0; i--) {
      const cart = this.minecarts[i];
      let push = 0;
      if (cart === this.cart) {
        const forward = (this.input.isDown('forward') ? 1 : 0) - (this.input.isDown('back') ? 1 : 0);
        if (forward !== 0) {
          const look = this.player.lookDirection(this.tmpDir);
          const along = look.x * cart.vel.x + look.z * cart.vel.z;
          const heading = Math.abs(cart.vel.x) + Math.abs(cart.vel.z) > 0.01 ? Math.sign(along) : Math.sign(look.z * -1 || look.x);
          push = 0.008 * forward * (heading || 1);
        }
      }
      cart.tick(this.world, push);
      if (cart.kind === 'hopper_minecart') this.tickHopperCart(cart);
      if (cart.fuse === 0) {
        cart.dead = true;
        this.explodeAt(cart.pos.x, cart.pos.y + 0.5, cart.pos.z, 4, null);
      }
      if (cart.pos.y < WORLD_MIN_Y) cart.dead = true;
      if (cart.dead) {
        if (this.cart === cart) this.leaveCart();
        this.renderer.scene.remove(cart.mesh);
        this.minecarts.splice(i, 1);
        continue;
      }
    }
    // vanilla dismounts a rider on the sneak key, the same way it steps off a horse
    if (this.cart && (this.input.tickPressed('sneak') || this.player.dead)) this.leaveCart();
    this.tickDetectorRails();
  }

  /**
   * A detector rail powers up under a cart and, as in vanilla, holds the signal for a second
   * afterwards, so a cart at full speed still gives a usable pulse.
   */
  private tickDetectorRails(): void {
    const on = new Set<string>();
    for (const cart of this.minecarts) {
      const bx = Math.floor(cart.pos.x);
      const bz = Math.floor(cart.pos.z);
      for (const by of [Math.floor(cart.pos.y), Math.floor(cart.pos.y) - 1]) {
        const state = this.world.getBlock(bx, by, bz);
        if (state === 0 || blocks.blockOf(state).id !== 'detector_rail') continue;
        on.add(`${bx},${by},${bz}`);
        break;
      }
    }
    const isDetector = (x: number, y: number, z: number): number => {
      const state = this.world.getBlock(x, y, z);
      return state !== 0 && blocks.blockOf(state).id === 'detector_rail' ? state : 0;
    };
    for (const key of on) {
      this.detectorsOn.set(key, this.tickCount);
      const [x, y, z] = key.split(',').map(Number);
      const state = isDetector(x, y, z);
      if (!state || blocks.prop(state, 'powered') === 'true') continue;
      this.world.setBlock(x, y, z, blocks.withProp(state, 'powered', 'true'));
    }
    for (const [key, when] of this.detectorsOn) {
      if (on.has(key) || this.tickCount - when < 20) continue;
      this.detectorsOn.delete(key);
      const [x, y, z] = key.split(',').map(Number);
      const state = isDetector(x, y, z);
      if (!state) continue;
      this.world.setBlock(x, y, z, blocks.withProp(state, 'powered', 'false'));
    }
  }

  /** Seats the rider in their cart after the player has ticked, so the ride interpolates smoothly. */
  private seatCart(): void {
    const cart = this.cart;
    if (!cart) return;
    const p = this.player;
    p.prevPos.set(cart.prev.x, cart.prev.y + RIDE_HEIGHT, cart.prev.z);
    p.pos.set(cart.pos.x, cart.pos.y + RIDE_HEIGHT, cart.pos.z);
    p.vel.set(0, 0, 0);
    p.onGround = true;
    p.fallDistance = 0;
  }

  /**
   * A hopper cart sweeps up the items it rolls over and drops them into whatever container it is
   * running over, which is how vanilla empties a mine onto a chest line.
   */
  private tickHopperCart(cart: Minecart): void {
    const slots = cart.items;
    if (!slots) return;
    for (const e of this.itemEntities) {
      if (e.dead || e.pickupDelay > 0) continue;
      if (Math.abs(e.pos.x - cart.pos.x) > 0.9 || Math.abs(e.pos.z - cart.pos.z) > 0.9 || Math.abs(e.pos.y - cart.pos.y) > 1) continue;
      while (e.stack.count > 0 && insertOne({ entity: { type: 'hopper', items: slots }, kind: 'hopper' }, e.stack, 'up')) e.stack.count--;
      if (e.stack.count <= 0) e.dead = true;
    }
    if (this.tickCount % 8 !== 0) return;
    const x = Math.floor(cart.pos.x);
    const y = Math.floor(cart.pos.y) - 1;
    const z = Math.floor(cart.pos.z);
    const target = containerAt(this.hopperWorld(), x, y, z);
    if (!target) return;
    const slot = slots.findIndex((s) => s && s.count > 0);
    if (slot < 0) return;
    const stack = slots[slot]!;
    if (!insertOne(target, stack, 'up')) return;
    if (--stack.count <= 0) slots[slot] = null;
    this.world.markModifiedAt(x, z);
  }

  /** Puts a cart into the world at an exact position, which is what placing and loading both need. */
  spawnCart(kind: CartKind, x: number, y: number, z: number): Minecart {
    const carried = CART_BLOCKS[kind];
    let contents: THREE.Object3D | null = null;
    if (carried === 'chest') {
      // a chest has no block model of its own, so the cart carries the block entity's chest, moved
      // off its centre so it sits in the cart like any other block
      contents = new THREE.Group();
      const model = chestModel(import.meta.env.BASE_URL);
      model.position.set(0.5, 0, 0.5);
      contents.add(model);
    } else if (carried) contents = this.blockMeshes.mesh(blocks.defaultState(carried));
    const cart = new Minecart(kind, x, y, z, minecartMesh(import.meta.env.BASE_URL, contents));
    this.minecarts.push(cart);
    this.renderer.scene.add(cart.mesh);
    return cart;
  }

  /** Puts a cart on the rail the player clicked, which is how a minecart item is used. */
  placeMinecart(kind: CartKind, x: number, y: number, z: number): boolean {
    const state = this.world.getBlock(x, y, z);
    if (state === 0 || !blocks.blockOf(state).id.endsWith('rail')) return false;
    this.spawnCart(kind, x + 0.5, y + 0.1, z + 0.5);
    this.audio.play('click', { x, y, z });
    return true;
  }

  /** The cart the player is looking at, within reach. */
  private cartUnderCursor(): Minecart | null {
    const eye = this.player.eyePosition(1, this.tmpEye);
    const dir = this.player.lookDirection(this.tmpDir);
    let best: Minecart | null = null;
    let bestDist = BLOCK_REACH;
    for (const cart of this.minecarts) {
      const to = cart.pos.clone().add(new THREE.Vector3(0, 0.35, 0)).sub(eye);
      const along = to.dot(dir);
      if (along <= 0 || along > bestDist) continue;
      if (to.clone().addScaledVector(dir, -along).length() > 0.8) continue;
      best = cart;
      bestDist = along;
    }
    return best;
  }

  /** Sits the player in a cart, or opens the chest one. */
  private useMinecart(cart: Minecart): void {
    if (cart.items) {
      this.openCartChest(cart);
      return;
    }
    if (this.mount) this.dismount();
    if (this.cart && this.cart !== cart) this.leaveCart();
    this.cart = cart;
    cart.ridden = true;
    this.player.riding = true;
    this.seatCart();
  }

  /** A chest or hopper cart carries its own inventory, shown in the matching screen. */
  private openCartChest(cart: Minecart): void {
    const contents = cart.items;
    if (!contents) return;
    const inv = this.player.inventory;
    const screen = cart.kind === 'hopper_minecart'
      ? hopperScreen(inv, contents)
      : chestScreen(inv, contents, 3, 'Minecart with Chest');
    this.openScreen(screen);
  }

  /** Steps out of the cart, putting the player back beside it. */
  private leaveCart(): void {
    const cart = this.cart;
    if (!cart) return;
    cart.ridden = false;
    this.cart = null;
    const p = this.player;
    p.riding = false;
    p.vel.set(0, 0, 0);
    for (const [dx, dz] of [[0.9, 0], [-0.9, 0], [0, 0.9], [0, -0.9], [0, 0]]) {
      const x = cart.pos.x + dx;
      const z = cart.pos.z + dz;
      if (p.fitsAt(this.world, x, cart.pos.y + 0.2, z)) {
        p.teleport(x, cart.pos.y + 0.2, z);
        return;
      }
    }
    p.teleport(cart.pos.x, cart.pos.y + 0.6, cart.pos.z);
  }

  /** Breaking a cart: it drops its item and everything it was carrying, as vanilla does. */
  private breakCart(cart: Minecart): void {
    cart.dead = true;
    if (this.player.gamemode !== 'creative') {
      this.dropStack({ id: CART_ITEMS[cart.kind], count: 1 }, cart.pos.x, cart.pos.y + 0.3, cart.pos.z, true);
      for (const slot of cart.items ?? []) if (slot) this.dropStack(cloneStack(slot), cart.pos.x, cart.pos.y + 0.3, cart.pos.z, true);
    }
    this.audio.play('click', { x: cart.pos.x, y: cart.pos.y, z: cart.pos.z });
  }

  private tickPrimedTnt(): void {
    for (let i = this.primedTnt.length - 1; i >= 0; i--) {
      const e = this.primedTnt[i];
      e.tick(this.world);
      if (!e.dead) continue;
      this.renderer.scene.remove(e.mesh);
      this.primedTnt.splice(i, 1);
      this.explodeAt(e.pos.x, e.pos.y + 0.5, e.pos.z, 4, null);
    }
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
  /** Mobs plus dropped items inside a chunk, for saving. */
  private serializeChunkEntities(cx: number, cz: number): import('../entities/mob.ts').MobSave[] {
    const list = this.entities.serializeChunk(cx, cz);
    for (const e of this.itemEntities) {
      if (e.dead || (Math.floor(e.pos.x) >> 4) !== cx || (Math.floor(e.pos.z) >> 4) !== cz) continue;
      list.push({ type: 'item', x: e.pos.x, y: e.pos.y, z: e.pos.z, yaw: 0, health: 0, age: e.age, item: { ...e.stack } });
    }
    for (const cart of this.minecarts) {
      if (cart.dead || (Math.floor(cart.pos.x) >> 4) !== cx || (Math.floor(cart.pos.z) >> 4) !== cz) continue;
      list.push({ type: cart.kind, x: cart.pos.x, y: cart.pos.y, z: cart.pos.z, yaw: cart.yaw, health: 0, age: 0, extra: { items: cart.items ?? null } });
    }
    return list;
  }

  private onChunkLoaded(cx: number, cz: number): void {
    const c = this.world.getChunk(cx, cz);
    if (!c) return;
    this.sweepChests(cx, cz);
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
      this.populateStructures(cx, cz);
    }
    this.applyStructureSpots(c);
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
  private potionTexture: THREE.Texture | null = null;

  /**
   * A bottle the player threw: everything within four blocks of the burst takes the potion, weaker
   * the further off it was, which is how vanilla splashes one.
   */
  private throwPotionStack(from: THREE.Vector3, to: THREE.Vector3, effects: { effect: string; duration: number; amplifier: number }[], color: number, lingering: boolean): void {
    if (!this.potionTexture) {
      this.potionTexture = new THREE.TextureLoader().load(this.icons.icon('splash_potion'));
      this.potionTexture.magFilter = THREE.NearestFilter;
      this.potionTexture.minFilter = THREE.NearestFilter;
      this.potionTexture.colorSpace = THREE.SRGBColorSpace;
    }
    const arrow = this.entities.shootArrow(from, to, 0.75, 0, true);
    arrow.asPotion(this.potionTexture, color, (pos) => {
      this.particles.poof(pos.x, pos.y, pos.z, lingering ? 30 : 14, Math.random, lingering ? 2 : 1, 0.5);
      this.audio.play('dig_glass', { x: pos.x, y: pos.y, z: pos.z, pitch: 1.2, volume: 0.6 });
      const reach = lingering ? 3 : 4;
      for (const m of this.entities.mobs) {
        if (m.dead) continue;
        const d = Math.hypot(m.pos.x - pos.x, m.pos.y + m.height / 2 - pos.y, m.pos.z - pos.z);
        if (d > reach) continue;
        const factor = 1 - d / reach;
        // mobs feel the instant effects; the lasting ones need status effects they do not carry yet
        for (const e of effects) {
          if (e.effect === 'instant_damage') m.hurt(Math.max(1, Math.round(6 * (e.amplifier + 1) * factor)), this.player.pos, 'player', 0);
          else if (e.effect === 'instant_health') m.health = Math.min(m.maxHealth, m.health + Math.round(4 * (e.amplifier + 1) * factor));
        }
      }
      const p = this.player;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.y + 1 - pos.y, p.pos.z - pos.z);
      if (d > reach || p.dead) return;
      const factor = 1 - d / reach;
      for (const e of effects) {
        if (e.effect === 'instant_damage') this.damage(Math.max(1, Math.round(3 * (e.amplifier + 1) * factor)));
        else if (e.effect === 'instant_health') p.health = Math.min(20, p.health + Math.round(4 * (e.amplifier + 1) * factor));
        else p.effects.add(e.effect, Math.round(e.duration * factor + 0.5), e.amplifier);
      }
    });
    this.audio.play('bow', { x: from.x, y: from.y, z: from.z, pitch: 0.6 });
  }

  /** Witch splash potion: a thrown bottle that applies its effect to the player within four blocks of the burst. */
  private throwPotion(from: THREE.Vector3, to: THREE.Vector3, effect: { id: string; ticks: number; amplifier?: number }, color: number): void {
    if (!this.potionTexture) {
      this.potionTexture = new THREE.TextureLoader().load(this.icons.icon('splash_potion'));
      this.potionTexture.magFilter = THREE.NearestFilter;
      this.potionTexture.minFilter = THREE.NearestFilter;
      this.potionTexture.colorSpace = THREE.SRGBColorSpace;
    }
    const arrow = this.entities.shootArrow(from, to, 0.75, 0);
    arrow.asPotion(this.potionTexture, color, (pos) => {
      this.particles.poof(pos.x, pos.y, pos.z, 12, Math.random, 1, 0.5);
      this.audio.play('dig_glass', { x: pos.x, y: pos.y, z: pos.z, pitch: 1.2, volume: 0.6 });
      const p = this.player;
      if (p.gamemode !== 'survival' || p.dead) return;
      const d = Math.hypot(p.pos.x - pos.x, p.pos.y + 1 - pos.y, p.pos.z - pos.z);
      if (d > 4) return;
      const factor = 1 - d / 4;
      if (effect.id === 'instant_damage') this.damage(Math.max(1, Math.round(6 * factor)));
      else if (effect.id === 'instant_health') this.player.health = Math.min(20, this.player.health + Math.round(4 * factor));
      else p.effects.add(effect.id, Math.round(effect.ticks * factor + 0.5), effect.amplifier ?? 0);
    });
    this.audio.play('bow', { x: from.x, y: from.y, z: from.z, pitch: 0.6 });
  }

  /** Block crumbs: a full 4×4×4 burst on break (face null) or one crack particle at the hit face. */
  private blockParticles(x: number, y: number, z: number, state: number, def: BlockDef, face: number | null): void {
    const model = this.baker.modelFor(state, 0);
    if (!model.quads.length) return;
    const q = model.quads[Math.floor(Math.random() * model.quads.length)];
    const tint = tintColor(def, state, q.tint, this.world.getBiome(x, z));
    if (face === null) this.particles.spawnBlockBreak(x, y, z, q.tile, tint, Math.random);
    else this.particles.spawnCrack(x, y, z, face, q.tile, tint, Math.random);
  }

  /** Fire frames cut from the atlas as a vertical strip for the first-person burning overlay. */
  private fireStrip(): [string, number] {
    const atlas = this.blockAtlas;
    const tile = atlas.index.tiles[atlas.index.tile('block/fire_0')];
    const frames = tile.frames && tile.frames.length ? tile.frames : [[tile.x, tile.y] as [number, number]];
    const canvas = document.createElement('canvas');
    canvas.width = tile.w;
    canvas.height = tile.h * frames.length;
    const g = canvas.getContext('2d')!;
    frames.forEach(([fx, fy], i) => {
      const img = new ImageData(new Uint8ClampedArray(tile.w * tile.h * 4), tile.w, tile.h);
      for (let yy = 0; yy < tile.h; yy++) {
        const src = ((fy + yy) * atlas.width + fx) * 4;
        img.data.set(atlas.pixels.subarray(src, src + tile.w * 4), yy * tile.w * 4);
      }
      g.putImageData(img, 0, i * tile.h);
    });
    return [canvas.toDataURL(), frames.length];
  }

  brightnessAt(x: number, y: number, z: number): number {
    const curve = (l: number) => l / (4 - 3 * l);
    const sky = curve(this.world.getSkyLight(x, y, z) / 15) * this.sky.dayLight;
    const blk = curve(this.world.getBlockLight(x, y, z) / 15);
    let b = Math.max(sky, blk);
    const gamma = this.uniforms.gamma.value as number;
    b = b + (1 - Math.pow(1 - b, 2) - b) * gamma * 0.6;
    const floor = lightFloor(gamma);
    b = floor + b * (1 - floor);
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
    if (mob.def.id !== 'wolf' || mob.extra.tamed !== true) this.lastVictim = mob;
    const mid = mob.pos.y + mob.height / 2;
    if (crit) this.particles.crits(mob.pos.x, mid, mob.pos.z, 8, Math.random, 'crit');
    if (damage > 2) this.particles.crits(mob.pos.x, mid, mob.pos.z, Math.floor(damage * 0.5), Math.random, 'damage');
    this.audio.play(crit ? 'anvil' : 'hurt', { x: mob.pos.x, y: mob.pos.y, z: mob.pos.z, pitch: crit ? 1.5 : 1.2, volume: 0.6 });
    if (held && def?.durability && (def.behavior === 'sword' || def.behavior === 'axe' || def.behavior === 'pickaxe' || def.behavior === 'shovel' || def.behavior === 'hoe')) p.inventory.damageSelected(def.behavior === 'sword' ? 1 : 2);
    p.exhaustion += 0.1;
    if (p.gamemode === 'survival') this.hud.showToast('');
  }

  /** Vanilla wolf handling: bones tame (1 in 3), meat heals, dye recolours the collar, anything else toggles sitting. */
  private interactWolf(m: MobType, held: ItemStack | null, survival: boolean, at: { x: number; y: number; z: number }): boolean {
    const tamed = m.extra.tamed === true;
    if (!tamed) {
      if (held?.id !== 'bone' || m.isBaby) return false;
      if (survival) this.player.inventory.consumeSelected();
      if (Math.random() < 1 / 3) {
        m.extra.tamed = true;
        m.extra.sitting = true;
        m.extra.collar = 'red';
        m.maxHealth = 40;
        m.health = 40;
        m.target = null;
        this.particles.hearts(m.pos.x, at.y, m.pos.z, 7, Math.random, m.width, 0.5);
        this.audio.play('wolf', { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 1.3 });
      } else this.particles.poof(m.pos.x, at.y, m.pos.z, 7, Math.random, m.width, 0.5);
      return true;
    }
    const dye = held && held.id.endsWith('_dye') ? held.id.slice(0, -4) : null;
    if (dye && DYE_COLORS[dye] !== undefined && m.extra.collar !== dye) {
      m.extra.collar = dye;
      if (survival) this.player.inventory.consumeSelected();
      return true;
    }
    if (held && WOLF_FOODS.includes(held.id) && m.health < m.maxHealth) {
      const def = items.byId.get(held.id);
      m.health = Math.min(m.maxHealth, m.health + (def?.food?.nutrition ?? 2));
      if (survival) this.player.inventory.consumeSelected();
      this.audio.play('eat', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
      return true;
    }
    if (held && WOLF_FOODS.includes(held.id)) return false; // full health: fall through to breeding
    m.extra.sitting = m.extra.sitting !== true;
    m.moveTarget = null;
    return true;
  }

  /**
   * Cats and ocelots: raw fish tames a cat one time in three and slowly wins an ocelot's trust
   * (vanilla stopped letting ocelots be tamed in 1.14). Tamed cats sit, and dye recolours the collar.
   */
  private interactCat(m: MobType, held: ItemStack | null, survival: boolean, at: { x: number; y: number; z: number }): boolean {
    const ocelot = m.def.id === 'ocelot';
    const tamed = m.extra.tamed === true;
    const fish = held && CAT_FOODS.includes(held.id);
    if (!tamed && fish) {
      if (survival) this.player.inventory.consumeSelected();
      if (ocelot) {
        const trust = (typeof m.extra.trust === 'number' ? m.extra.trust : 0) + 1;
        m.extra.trust = trust;
        if (trust >= 2 && Math.random() < 1 / 3) {
          m.extra.trusting = true;
          m.persistent = true;
          this.particles.hearts(m.pos.x, at.y, m.pos.z, 7, Math.random, m.width, 0.5);
          this.chat.addLine('The ocelot trusts you', '#aaa');
        } else this.particles.poof(m.pos.x, at.y, m.pos.z, 7, Math.random, m.width, 0.5);
      } else if (Math.random() < 1 / 3) {
        m.extra.tamed = true;
        m.extra.sitting = true;
        m.extra.collar = 'red';
        m.persistent = true;
        this.particles.hearts(m.pos.x, at.y, m.pos.z, 7, Math.random, m.width, 0.5);
        this.audio.play('cat', { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 1.3 });
      } else this.particles.poof(m.pos.x, at.y, m.pos.z, 7, Math.random, m.width, 0.5);
      return true;
    }
    if (!tamed) return false;
    const dye = held && held.id.endsWith('_dye') ? held.id.slice(0, -4) : null;
    if (dye && DYE_COLORS[dye] !== undefined && m.extra.collar !== dye) {
      m.extra.collar = dye;
      if (survival) this.player.inventory.consumeSelected();
      return true;
    }
    if (fish && m.health < m.maxHealth) {
      m.health = Math.min(m.maxHealth, m.health + (items.byId.get(held!.id)?.food?.nutrition ?? 2));
      if (survival) this.player.inventory.consumeSelected();
      this.audio.play('eat', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
      return true;
    }
    if (fish) return false; // full health: fall through to breeding
    m.extra.sitting = m.extra.sitting !== true;
    m.moveTarget = null;
    this.audio.play('cat', { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 0.9 + Math.random() * 0.3 });
    return true;
  }

  /** Vanilla animal interactions: breeding food, shears on sheep, buckets on cows. */
  // ---------------------------------------------------------------------------------------------
  // Riding
  // ---------------------------------------------------------------------------------------------

  /** Where a rider sits: vanilla puts the player just above the mount's back. */
  private seatHeight(m: Mob): number {
    return m.height * 0.75 + (m.def.animation === 'horse' ? 0.05 : 0);
  }

  /** Puts the player in the saddle after the mount has moved. */
  private seatPlayer(): void {
    const m = this.mount;
    if (!m) return;
    const p = this.player;
    p.pos.set(m.pos.x, m.pos.y + this.seatHeight(m), m.pos.z);
    p.vel.set(0, 0, 0);
    p.onGround = m.onGround;
    p.fallDistance = 0;
  }

  mountMob(m: Mob): void {
    this.dismount(false);
    this.mount = m;
    m.ridden = true;
    m.control = { forward: 0, strafe: 0, jump: 0 };
    this.player.riding = true;
    this.jumpCharge = 0;
    // an untamed horse throws the player off after a moment
    this.buckTimer = m.extra.tamed === true ? 0 : 20 + Math.floor(Math.random() * 40);
    this.seatPlayer();
  }

  /** Steps off the mount, placing the player beside it. */
  dismount(place = true): void {
    const m = this.mount;
    if (!m) return;
    m.ridden = false;
    m.control = null;
    this.mount = null;
    this.jumpCharge = 0;
    this.player.riding = false;
    if (place) {
      const p = this.player;
      const side = new THREE.Vector3(Math.cos(m.yaw), 0, -Math.sin(m.yaw));
      for (const d of [1, -1, 0]) {
        const x = m.pos.x + side.x * (m.width / 2 + 0.6) * d;
        const z = m.pos.z + side.z * (m.width / 2 + 0.6) * d;
        if (p.fitsAt(this.world, x, m.pos.y, z)) {
          p.teleport(x, m.pos.y, z);
          return;
        }
      }
      p.teleport(m.pos.x, m.pos.y + 0.2, m.pos.z);
    }
  }

  /** Rider input: steering, the charged jump and being bucked off an untamed horse. */
  private rideTick(): void {
    const m = this.mount;
    if (!m) return;
    const p = this.player;
    if (m.dead || m.removed || p.dead || this.state !== 'playing') {
      this.dismount();
      return;
    }
    if (this.input.tickPressed('sneak')) {
      this.dismount();
      return;
    }
    if (this.buckTimer > 0 && --this.buckTimer === 0) {
      this.buckHorse(m);
      return;
    }
    const saddled = m.extra.saddle === true;
    const control = m.control ?? (m.control = { forward: 0, strafe: 0, jump: 0 });
    m.yaw = p.yaw;
    m.headYaw = p.yaw;
    m.headPitch = 0;
    // a saddle is what makes a horse steerable; bareback it just carries the player
    control.forward = saddled ? (this.input.isDown('forward') ? 1 : 0) - (this.input.isDown('back') ? 1 : 0) : 0;
    control.strafe = saddled ? (this.input.isDown('left') ? 1 : 0) - (this.input.isDown('right') ? 1 : 0) : 0;
    const jumpStrength = typeof m.extra.jumpAttr === 'number' ? m.extra.jumpAttr : 0;
    if (saddled && jumpStrength > 0) {
      if (this.input.isDown('jump')) {
        this.jumpCharge = Math.min(1, this.jumpCharge + 0.05); // full power after one second
      } else if (this.jumpCharge > 0) {
        if (m.onGround) {
          control.jump = jumpStrength * this.jumpCharge;
          this.audio.play('horse_jump', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
        }
        this.jumpCharge = 0;
      }
    } else if (saddled && this.input.isDown('jump') && m.onGround) {
      control.jump = 0.42;
    }
  }

  /** Vanilla taming: being thrown raises the horse's temper until it accepts the player. */
  private buckHorse(m: Mob): void {
    const temper = (typeof m.extra.temper === 'number' ? m.extra.temper : 0) + Math.floor(Math.random() * 20) + 5;
    m.extra.temper = Math.min(100, temper);
    this.dismount();
    m.vel.y = 0.4;
    if (m.extra.temper >= 100) {
      this.tameHorse(m);
    } else {
      for (let i = 0; i < 7; i++) this.particles.spawnSprite('angry', m.pos.x + (Math.random() - 0.5) * m.width, m.pos.y + m.height + Math.random() * 0.5, m.pos.z + (Math.random() - 0.5) * m.width, 0, 0.02, 0, 20, 0.3);
      this.audio.play('horse_angry', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
    }
  }

  private tameHorse(m: Mob): void {
    m.extra.tamed = true;
    m.extra.temper = 100;
    m.persistent = true;
    this.particles.hearts(m.pos.x, m.pos.y + m.height, m.pos.z, 7, Math.random, m.width, 0.5);
    this.audio.play('horse_ambient', { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 1.2 });
    this.chat.addLine(`${m.def.name} tamed`, '#aaa');
  }

  /** The saddle, armour and chest slots a horse carries, created on first use. */
  private equineSlots(m: Mob): { equip: Slot[]; chest: Slot[] | null } {
    const store = (m.extra as unknown as { equip?: Slot[]; chestItems?: Slot[] });
    if (!store.equip) store.equip = [null, null];
    if (m.extra.chest === true && !store.chestItems) store.chestItems = new Array(15).fill(null);
    return { equip: store.equip, chest: m.extra.chest === true ? store.chestItems! : null };
  }

  private openHorseScreen(m: Mob): void {
    const { equip, chest } = this.equineSlots(m);
    const sync = () => {
      m.extra.saddle = equip[0]?.id === 'saddle';
      m.extra.armor = equip[1]?.id ?? '';
      if (equip[1]) this.audio.play('saddle', { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 0.8 });
    };
    this.openScreen(horseScreen(this.player.inventory, m.def.name, equip, chest, m.def.id === 'horse', sync), sync);
  }

  private interactMob(m: MobType): boolean {
    const p = this.player;
    const held = p.heldItem();
    if (m.dead) return false;
    const survival = p.gamemode === 'survival';
    const at = { x: m.pos.x, y: m.pos.y + m.height, z: m.pos.z };
    if (m.def.id === 'wolf' && this.interactWolf(m, held, survival, at)) return true;
    if (EQUINE_TYPES.includes(m.def.id) && this.interactEquine(m, held, survival, at)) return true;
    if ((m.def.id === 'cat' || m.def.id === 'ocelot') && this.interactCat(m, held, survival, at)) return true;
    if (m.def.id === 'villager' || m.def.id === 'wandering_trader') {
      if (m.isBaby) return false;
      this.openTradeScreen(m);
      return true;
    }
    if (!held) return false;
    if (held.id === 'shears' && m.def.id === 'sheep' && !m.isBaby && m.extra.sheared !== true) {
      m.extra.sheared = true;
      const n = 1 + Math.floor(Math.random() * 3);
      this.dropStack({ id: `${String(m.extra.color ?? 'white')}_wool`, count: n }, m.pos.x, at.y, m.pos.z, true);
      if (survival) p.inventory.damageSelected(1);
      this.audio.play('shear', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
      return true;
    }
    if (held.id === 'bucket' && m.def.id === 'cow' && !m.isBaby) {
      if (held.count === 1) {
        held.id = 'milk_bucket';
        p.inventory.version++;
      } else if (survival) {
        held.count--;
        p.inventory.version++;
        if (p.inventory.add({ id: 'milk_bucket', count: 1 }) > 0) this.dropStack({ id: 'milk_bucket', count: 1 }, p.pos.x, p.pos.y + 1, p.pos.z, true);
      }
      this.audio.play('cow', { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 1.2 });
      return true;
    }
    if (isBreedingFood(m.def.id, held.id)) {
      if (m.isBaby) {
        // vanilla: feeding a baby knocks 10% off the remaining growth time
        const grow = typeof m.extra.grow === 'number' ? m.extra.grow : 24000;
        m.extra.grow = Math.max(1, grow - Math.max(1, Math.floor(grow * 0.1)));
      } else {
        const love = typeof m.extra.love === 'number' ? m.extra.love : 0;
        const cooldown = typeof m.extra.cooldown === 'number' ? m.extra.cooldown : 0;
        if (love > 0 || cooldown > 0) return false;
        m.extra.love = 600;
      }
      if (survival) p.inventory.consumeSelected();
      this.particles.hearts(m.pos.x, at.y, m.pos.z, 7, Math.random, m.width, 0.5);
      this.audio.play('eat', { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 1.1 });
      return true;
    }
    return false;
  }

  /** Nearest unclaimed job site block for a villager, or the one matching its profession. */
  private findJobSite(x: number, y: number, z: number, range: number, profession: string | null): { x: number; y: number; z: number; block: string } | null {
    let best: { x: number; y: number; z: number; block: string } | null = null;
    let bestDist = Infinity;
    const bx = Math.floor(x), by = Math.floor(y), bz = Math.floor(z);
    for (let dy = -3; dy <= 3; dy++)
      for (let dx = -range; dx <= range; dx++)
        for (let dz = -range; dz <= range; dz++) {
          const state = this.world.getBlock(bx + dx, by + dy, bz + dz);
          if (state === 0) continue;
          const id = blocks.blockOf(state).id;
          const job = professionForBlock(id);
          if (!job || (profession && job !== profession)) continue;
          const d = dx * dx + dy * dy + dz * dz;
          if (d < bestDist) {
            bestDist = d;
            best = { x: bx + dx, y: by + dy, z: bz + dz, block: id };
          }
        }
    return best;
  }

  /** A villager standing at a job site takes that profession, or restocks the trades it has used. */
  private claimJobSite(m: Mob, block: string): void {
    const job = professionForBlock(block);
    if (!job) return;
    if (!m.extra.profession || m.extra.profession === 'none') {
      m.extra.profession = job;
      m.extra.level = 1;
      m.extra.tradeXp = 0;
      m.persistent = true;
      this.particles.spawnSprite('happy', m.pos.x, m.pos.y + m.height, m.pos.z, 0, 0.05, 0, 20, 0.4);
      this.audio.play('villager', { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 1.2 });
      return;
    }
    if (m.extra.restock === true) {
      const offers = (m.extra as unknown as { offers?: Offer[] }).offers ?? [];
      for (const o of offers) {
        o.uses = 0;
        o.demand = Math.max(0, o.demand - 1); // demand decays when the villager restocks
      }
      m.extra.restock = false;
      this.particles.spawnSprite('happy', m.pos.x, m.pos.y + m.height, m.pos.z, 0, 0.05, 0, 20, 0.4);
    }
  }

  /**
   * Villager trading: the offers a villager knows come from its profession and level, and every
   * completed trade earns it experience toward the next tier and eventually empties its stock.
   */
  private openTradeScreen(m: Mob): void {
    const profession = m.def.id === 'wandering_trader' ? 'wandering_trader' : String(m.extra.profession ?? 'none');
    if (profession === 'none' || profession === 'nitwit') {
      this.hud.showToast(`${m.def.name} has nothing to trade`);
      return;
    }
    const offers = this.villagerOffers(m, profession);
    if (!offers.length) return;
    const merchant: Merchant = {
      name: m.def.id === 'wandering_trader' ? 'Wandering Trader' : professionName(profession),
      offers,
      level: m.def.id === 'wandering_trader' ? 0 : (typeof m.extra.level === 'number' ? m.extra.level : 1),
      xp: typeof m.extra.tradeXp === 'number' ? m.extra.tradeXp : 0,
      levelled: false,
      onTrade: (offer) => {
        this.tradeDone(m, offer, merchant);
      },
    };
    const screen = tradingScreen(this.player.inventory, { ...this.enchantHost(), icons: this.icons, refresh: () => this.screen?.refresh() }, merchant);
    m.extra.trading = true;
    this.audio.play('villager', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
    this.openScreen(screen, () => {
      // whatever the player left in the payment slots comes back, as vanilla does on close
      for (const st of screen.state.slots) {
        if (!st) continue;
        const left = this.player.inventory.add(st);
        if (left > 0) this.dropStack({ ...st, count: left }, this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, true);
      }
      screen.state.slots = [null, null];
      this.saveOffers(m, merchant.offers);
      m.extra.trading = false;
    });
  }

  /** Offers a villager knows, generated once per profession and level and then kept in `extra`. */
  private villagerOffers(m: Mob, profession: string): Offer[] {
    const level = m.def.id === 'wandering_trader' ? 1 : (typeof m.extra.level === 'number' ? m.extra.level : 1);
    const stored = (m.extra as unknown as { offers?: Offer[]; offersFor?: string }).offersFor;
    const store = m.extra as unknown as { offers?: Offer[]; offersFor?: string };
    if (stored === `${profession}:${level}` && store.offers?.length) return store.offers;
    const offers = buildOffers(profession, level, Math.random);
    store.offers = offers;
    store.offersFor = `${profession}:${level}`;
    return offers;
  }

  private saveOffers(m: Mob, offers: Offer[]): void {
    (m.extra as unknown as { offers?: Offer[] }).offers = offers;
  }

  /** Books a completed trade: villager experience, player experience and a level-up when earned. */
  private tradeDone(m: Mob, offer: Offer, merchant: Merchant): void {
    this.spawnXp(3 + Math.floor(Math.random() * 4), m.pos.x, m.pos.y + 1, m.pos.z);
    if (m.def.id === 'wandering_trader') return;
    const xp = (typeof m.extra.tradeXp === 'number' ? m.extra.tradeXp : 0) + offer.xp;
    m.extra.tradeXp = xp;
    merchant.xp = xp;
    const level = Math.min(5, levelFor(xp));
    if (level > (typeof m.extra.level === 'number' ? m.extra.level : 1)) {
      m.extra.level = level;
      merchant.level = level;
      merchant.levelled = true;
      // a new tier means new offers on top of the ones the villager already knows
      const extra = buildOffers(String(m.extra.profession), level, Math.random).slice(merchant.offers.length);
      merchant.offers.push(...extra);
      this.saveOffers(m, merchant.offers);
      (m.extra as unknown as { offersFor?: string }).offersFor = `${String(m.extra.profession)}:${level}`;
      this.particles.spawnSprite('happy', m.pos.x, m.pos.y + m.height, m.pos.z, 0, 0.05, 0, 20, 0.4);
      this.audio.play('level_up', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
    }
    if (offer.uses >= offer.maxUses) m.extra.restock = true;
    m.persistent = true;
  }

  /**
   * Vanilla horse handling: feeding (healing, growth and temper), saddling, chests on donkeys and
   * mules, the inventory on sneak, and mounting, which tames an untamed horse over several tries.
   */
  private interactEquine(m: Mob, held: ItemStack | null, survival: boolean, at: { x: number; y: number; z: number }): boolean {
    const p = this.player;
    const tamed = m.extra.tamed === true;
    const food = held ? HORSE_FOODS[held.id] : undefined;
    if (food && (m.health < m.maxHealth || m.isBaby || (!tamed && food.temper > 0) || (food.breeds && tamed))) {
      const hurt = m.health < m.maxHealth;
      m.health = Math.min(m.maxHealth, m.health + food.heal);
      if (m.isBaby) {
        const grow = typeof m.extra.grow === 'number' ? m.extra.grow : 24000;
        m.extra.grow = Math.max(1, grow - food.grow * 10);
      }
      let loved = false;
      if (!tamed && food.temper > 0) {
        const temper = Math.min(100, (typeof m.extra.temper === 'number' ? m.extra.temper : 0) + food.temper);
        m.extra.temper = temper;
        if (temper >= 100) this.tameHorse(m);
      } else if (tamed && food.breeds && !m.isBaby) {
        const love = typeof m.extra.love === 'number' ? m.extra.love : 0;
        const cooldown = typeof m.extra.cooldown === 'number' ? m.extra.cooldown : 0;
        if (love <= 0 && cooldown <= 0) {
          m.extra.love = 600;
          loved = true;
        }
      }
      if (survival) p.inventory.consumeSelected();
      if (loved || hurt) this.particles.hearts(m.pos.x, at.y, m.pos.z, 7, Math.random, m.width, 0.5);
      this.audio.play('horse_eat', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
      return true;
    }
    if (!tamed) {
      this.mountMob(m);
      return true;
    }
    if (held?.id === 'saddle' && m.extra.saddle !== true) {
      const { equip } = this.equineSlots(m);
      equip[0] = { id: 'saddle', count: 1 };
      m.extra.saddle = true;
      if (survival) p.inventory.consumeSelected();
      this.audio.play('saddle', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
      return true;
    }
    if (held?.id === 'chest' && CHESTED_EQUINES.includes(m.def.id) && m.extra.chest !== true) {
      m.extra.chest = true;
      this.equineSlots(m);
      if (survival) p.inventory.consumeSelected();
      this.audio.play('chest', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
      return true;
    }
    if (p.sneaking) {
      this.openHorseScreen(m);
      return true;
    }
    this.mountMob(m);
    return true;
  }

  private onMobDeath(m: Mob): void {
    const byPlayer = m.lastHurtBy === 'player';
    const looting = byPlayer ? this.player.heldItem()?.enchantments?.looting ?? 0 : 0;
    for (const d of entityDrops(m.def.loot, byPlayer, looting, m.fireTicks > 0)) this.dropStack(d, m.pos.x, m.pos.y + 0.5, m.pos.z, true);
    if (m.def.id === 'sheep' && m.extra.sheared !== true && !m.isBaby) for (const d of entityDrops(`sheep/${String(m.extra.color ?? 'white')}`, byPlayer, looting)) this.dropStack(d, m.pos.x, m.pos.y + 0.5, m.pos.z, true);
    // a dying mount drops everything it was carrying
    const carried = m.extra as unknown as { equip?: (ItemStack | null)[]; chestItems?: (ItemStack | null)[] };
    for (const st of [...(carried.equip ?? []), ...(carried.chestItems ?? [])]) if (st) this.dropStack(st, m.pos.x, m.pos.y + 0.5, m.pos.z, true);
    if (m.extra.chest === true) this.dropStack({ id: 'chest', count: 1 }, m.pos.x, m.pos.y + 0.5, m.pos.z, true);
    // killing a patrol captain leaves the player marked with Bad Omen (raids come with villages)
    if (byPlayer && m.extra.captain === true) {
      this.player.effects.add('bad_omen', 120000, 0);
      this.hud.showToast('Bad Omen');
    }
    if (byPlayer && m.def.xp > 0) this.spawnXp(m.def.xp, m.pos.x, m.pos.y + 0.5, m.pos.z);
    this.audio.play(MOB_DEATH_SOUNDS[m.def.id] ?? m.def.id, { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 0.7 });
    this.particles.poof(m.pos.x, m.pos.y, m.pos.z, 20, Math.random, m.def.width, m.def.height);
    // slimes split into two to four of the next size down
    const smaller = SLIME_SPLIT[m.def.id];
    if (smaller) {
      const n = 2 + Math.floor(Math.random() * 3);
      for (let i = 0; i < n; i++) {
        const a = (i / n) * Math.PI * 2;
        const child = this.entities.spawn(smaller, m.pos.x + Math.cos(a) * m.def.width * 0.35, m.pos.y + 0.5, m.pos.z + Math.sin(a) * m.def.width * 0.35, a);
        if (child) {
          child.vel.set(Math.cos(a) * 0.2, 0.3, Math.sin(a) * 0.2);
          if (byPlayer) child.target = 'player';
        }
      }
    }
  }

  spawnXp(amount: number, x: number, y: number, z: number): void {
    for (const v of splitXp(amount)) {
      const orb = new XpOrb(import.meta.env.BASE_URL, v, x, y, z);
      this.xpOrbs.push(orb);
      this.renderer.scene.add(orb.sprite);
    }
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
    this.audio.play('explosion', { x, y, z, volume: 2 });
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

  private enchantHost(): EnchantHost & { giveXp: (n: number) => void } {
    const p = this.player;
    return {
      inventory: p.inventory,
      level: () => p.xpLevel,
      spendLevels: (n) => {
        p.xpLevel = Math.max(0, p.xpLevel - n);
      },
      creative: () => p.gamemode === 'creative',
      guiScale: this.options.guiScale,
      playSound: (name) => this.audio.play(name),
      giveXp: (n) => this.spawnXp(n, p.pos.x, p.pos.y + 1, p.pos.z),
    };
  }

  /** Returns any items left in a workstation's own slots when it closes. */
  private returnSlots(state: Record<string, Slot> | undefined): void {
    if (!state) return;
    for (const [k, v] of Object.entries(state)) {
      if (!v || typeof v !== 'object' || !('id' in v)) continue;
      const left = this.player.inventory.add(v);
      if (left > 0) this.dropStack({ ...v, count: left }, this.player.pos.x, this.player.pos.y + 1, this.player.pos.z, true);
      state[k] = null;
    }
  }

  /** Vanilla `SignBlock.isFacingFrontText`: a standing sign is edited on the side the player stands on. */
  private signSide(id: string, state: number, x: number, z: number): 'front' | 'back' {
    if (id.endsWith('_wall_sign')) return 'front';
    const a = (Number(blocks.prop(state, 'rotation') ?? 0) * Math.PI) / 8;
    const dx = this.player.pos.x - (x + 0.5);
    const dz = this.player.pos.z - (z + 0.5);
    return dx * -Math.sin(a) + dz * Math.cos(a) >= 0 ? 'front' : 'back';
  }

  private editSign(x: number, y: number, z: number, entity: SignEntity, side: 'front' | 'back' = 'front'): void {
    if (this.state !== 'playing') return;
    this.state = 'gui';
    this.input.enabled = false;
    this.input.exitLock();
    const container = this.renderer.canvas.parentElement ?? document.body;
    const current = side === 'front' ? entity.lines : entity.backLines ?? ['', '', '', ''];
    this.signEditorClose = openSignEditor(container, current, (lines) => {
      if (side === 'front') entity.lines = lines;
      else entity.backLines = lines;
      this.world.markModifiedAt(x, z);
      const st = this.world.getBlock(x, y, z);
      if (st !== 0 && isSignBlock(blocks.idOf(st))) this.signs.update(x, y, z, st, entity);
      this.signEditorClose = null;
      this.input.endFrame();
      this.input.endTick();
      if (this.state === 'gui') {
        this.state = 'playing';
        this.input.enabled = true;
        this.input.requestLock();
      }
    });
  }

  /** Keeps sign meshes in step with loaded sign block entities. */
  /**
   * Sweeps a freshly loaded chunk for the blocks the game has to know about itself: chests, which
   * vanilla draws with a renderer of their own, and hoppers, which need a block entity to tick.
   */
  private sweepChests(cx: number, cz: number): void {
    const c = this.world.getChunk(cx, cz);
    if (!c) return;
    const { blocks: data } = c;
    for (let i = 0; i < data.length; i++) {
      const state = data[i];
      if (!chestStates[state] && !hopperStates[state] && !drawnStates[state]) continue;
      const x = cx * 16 + (i & 15);
      const z = cz * 16 + ((i >> 4) & 15);
      const y = (i >> 8) + WORLD_MIN_Y;
      if (chestStates[state]) this.chestBlocks.add(`${x},${y},${z}`);
      else if (drawnStates[state]) this.drawnBlocks.add(`${x},${y},${z}`);
      else this.ensureHopper(x, y, z);
    }
  }

  /** A hopper only moves items once it has a block entity, so one is made as soon as it appears. */
  private ensureHopper(x: number, y: number, z: number): void {
    if (this.world.getBlockEntity(x, y, z)) return;
    const entity = createBlockEntity('hopper');
    if (entity) this.world.setBlockEntity(x, y, z, entity);
  }

  /** Keeps the chest list right as blocks come and go. */
  private chestChanged(x: number, y: number, z: number, oldState: number, newState: number): void {
    if (hopperStates[newState]) this.ensureHopper(x, y, z);
    if (drawnStates[newState] || drawnStates[oldState]) {
      const key = `${x},${y},${z}`;
      if (drawnStates[newState]) {
        this.drawnBlocks.add(key);
        this.blockEntities.update(x, y, z, newState);
      } else {
        this.drawnBlocks.delete(key);
        this.blockEntities.remove(x, y, z);
      }
    }
    const was = chestStates[oldState] === 1;
    const is = chestStates[newState] === 1;
    if (!was && !is) return;
    const key = `${x},${y},${z}`;
    if (is) {
      this.chestBlocks.add(key);
      this.chests.update(x, y, z, newState);
    } else {
      this.chestBlocks.delete(key);
      this.chests.remove(x, y, z);
    }
  }

  /** Rebuilds the chest meshes near the player, dropping the ones that have gone. */
  private syncChests(): void {
    const seen = new Set<string>();
    for (const key of this.chestBlocks) {
      const [x, y, z] = key.split(',').map(Number);
      const state = this.world.getBlock(x, y, z);
      if (state === 0 || !isChestBlock(blocks.idOf(state))) {
        this.chestBlocks.delete(key);
        continue;
      }
      // an unloaded chunk takes its chests with it; loading it again sweeps them back up
      if (!this.world.getChunk(x >> 4, z >> 4)) {
        this.chestBlocks.delete(key);
        continue;
      }
      seen.add(key);
      this.chests.update(x, y, z, state);
    }
    this.chests.prune(seen);

    const drawn = new Set<string>();
    for (const key of this.drawnBlocks) {
      const [x, y, z] = key.split(',').map(Number);
      const state = this.world.getBlock(x, y, z);
      if (!this.world.getChunk(x >> 4, z >> 4) || !drawnStates[state]) {
        this.drawnBlocks.delete(key);
        continue;
      }
      drawn.add(key);
      this.blockEntities.update(x, y, z, state);
    }
    this.blockEntities.prune(drawn);
  }

  private syncSigns(): void {
    const seen = new Set<string>();
    this.world.forEachBlockEntity((x, y, z, e) => {
      if (e.type !== 'sign') return;
      const st = this.world.getBlock(x, y, z);
      if (st === 0 || !isSignBlock(blocks.idOf(st))) return;
      seen.add(`${x},${y},${z}`);
      this.signs.update(x, y, z, st, e);
    });
    this.signs.prune(seen);
  }

  openInventory(): void {
    const grid = makeGrid(2, 2);
    const def = inventoryScreen(this.player.inventory, grid);
    let preview: PlayerPreview | null = null;
    let book: ReturnType<typeof attachRecipeBook> | null = null;
    def.overlay = (root) => {
      const s = this.options.guiScale;
      if (!preview) {
        preview = new PlayerPreview(import.meta.env.BASE_URL, 49 * s, 70 * s);
        preview.canvas.style.cssText = `position:absolute;left:${26 * s}px;top:${8 * s}px;width:${49 * s}px;height:${70 * s}px;pointer-events:none;`;
        root.append(preview.canvas);
        book = attachRecipeBook(root, { icons: this.icons, inventory: this.player.inventory, grid, guiScale: s, refresh: () => this.screen?.refresh() }, 2);
        recipeBookButton(root, 104, 61, s, () => book?.toggle());
      }
    };
    this.openScreen(def, () => {
      preview?.destroy();
      book?.destroy();
      this.returnGrid(grid);
    });
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
    if (def.texture.includes('generic_54') || def.texture.includes('shulker') || def.texture.includes('hopper')) this.audio.play('chest', { volume: 0.6 });
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
    // the key that closed the screen (Escape / E) must not also pause or reopen
    this.input.endFrame();
    this.input.endTick();
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
      // vanilla: the inventory key opens the mount's inventory while riding one
      if (this.input.wasPressed('inventory')) {
        if (this.mount && EQUINE_TYPES.includes(this.mount.def.id) && this.mount.extra.tamed === true) this.openHorseScreen(this.mount);
        else this.openInventory();
      }
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
    for (const e of this.primedTnt) e.updateMesh(alpha);
    for (const e of this.minecarts) e.updateMesh(alpha);
    this.chests.animate();
    this.blockEntities.animate(this.tickCount + partialTime / 50);
    this.bobber?.updateMesh(alpha);
    this.updateBobberLine(alpha);
    mobFireAssets.viewYaw = this.player.yaw;
    this.entities.render(alpha, (x, y, z) => this.brightnessAt(x, y, z));
    this.particles.render(alpha, this.renderer.canvas.height, (x, y, z) => this.brightnessAt(x, y, z));
    for (const orb of this.xpOrbs) orb.render(alpha, partialTime / 20);
    this.audio.listener = { x: eye.x, y: eye.y, z: eye.z };
    this.world.flush();
    this.renderer.render();
    const mountJump = this.mount && this.mount.extra.saddle === true && typeof this.mount.extra.jumpAttr === 'number' ? this.jumpCharge : null;
    this.hud.setJumpCharge(mountJump);
    this.hud.update(p, this.debugText(eyeBlock), dt);
    this.hud.setOnFire(p.fireTicks > 0 && p.gamemode === 'survival' && !p.dead, this.tickCount);
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
      case 'locate': {
        const wanted = args[0]?.replace(/^minecraft:/, '');
        const sets = this.structureSets;
        if (!sets.length) return err('No structures loaded — run `npm run structures`');
        const set = sets.find((x) => x.name === wanted);
        if (!set) return err(`Usage: /locate <${sets.map((x) => x.name).join('|')}>`);
        const found = this.locateStructure(set);
        if (!found) return err(`Could not find a ${set.name} nearby`);
        const dist = Math.round(Math.hypot(found.x - p.pos.x, found.z - p.pos.z));
        say(`Nearest ${set.name} is at ${found.x}, ~${found.z} (${dist} blocks away)`);
        break;
      }
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
        if (!mobStats(type)) return err(`Unknown or unsupported mob '${type}' (try zombie, husk, drowned, skeleton, stray, wither_skeleton, creeper, spider, cave_spider, slime, slime_medium, slime_big, enderman, witch, phantom, wolf, cod, salmon, cow, pig, sheep, chicken)`);
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
    let leveled = false;
    while (p.xp >= xpForLevel(p.xpLevel)) {
      p.xp -= xpForLevel(p.xpLevel);
      p.xpLevel++;
      leveled = true;
    }
    if (leveled && p.xpLevel % 5 === 0) this.audio.play('levelup');
  }

  /** Footsteps, ambient mob noises, creeper fuses. */
  private tickSounds(): void {
    const p = this.player;
    if (p.onGround && !p.dead) {
      const moved = Math.hypot(p.pos.x - p.prevPos.x, p.pos.z - p.prevPos.z);
      this.stepDistance += moved;
      if (this.stepDistance > (p.sprinting ? 1.6 : 1.4) && moved > 0.01) {
        this.stepDistance = 0;
        const below = this.world.getBlock(Math.floor(p.pos.x), Math.floor(p.pos.y - 0.1), Math.floor(p.pos.z));
        if (below !== 0) {
          const d = blocks.blockOf(below);
          this.audio.play('step', { pitch: 0.9 + Math.random() * 0.2, volume: 0.6 + (blockSoundGroup(d.id, d.tool, d.behavior) === 'grass' ? 0 : 0.2) });
        }
      }
    }
    if (this.eating && this.eating.ticks % 6 === 1) this.audio.play('eat', { pitch: 0.9 + Math.random() * 0.2, volume: 0.5 });
    for (const m of this.entities.mobs) {
      if (m.dead) continue;
      if (m.hurtTime === 9) this.audio.play(m.def.disposition === 'passive' ? m.def.id : 'hurt', { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 1.1 });
      if (m === this.mount && m.onGround && this.tickCount % 12 === 0 && Math.hypot(m.vel.x, m.vel.z) > 0.12) this.audio.play('horse_gallop', { x: m.pos.x, y: m.pos.y, z: m.pos.z, volume: 0.5 });
      const swell = Number(m.extra.swell ?? 0);
      if (m.def.id === 'creeper' && swell === 1) this.audio.play('creeper_hiss', { x: m.pos.x, y: m.pos.y, z: m.pos.z });
      if (Math.random() < 1 / 200 && m.distanceTo(p.pos) < 16) {
        const ambient: Record<string, string> = { zombie: 'zombie', husk: 'zombie', drowned: 'zombie', skeleton: 'skeleton', stray: 'skeleton', wither_skeleton: 'skeleton', spider: 'spider', cave_spider: 'spider', cow: 'cow', pig: 'pig', sheep: 'sheep', chicken: 'chicken', slime: 'slime', slime_medium: 'slime', slime_big: 'slime', enderman: 'enderman', wolf: 'wolf', witch: 'witch', phantom: 'phantom', horse: 'horse_ambient', donkey: 'donkey', mule: 'donkey', cat: 'cat', ocelot: 'cat' };
        const snd = ambient[m.def.id];
        if (snd) this.audio.play(snd, { x: m.pos.x, y: m.pos.y, z: m.pos.z, pitch: 0.9 + Math.random() * 0.2 });
      }
    }
  }
}
