/** Living mobs: physics, health, knockback, AI goal selection and box-model animation. */
import * as THREE from 'three';
import type { BlockSource } from './physics.ts';
import { aabbIntersects, boxesIn, isFluidAt, sweep, type AABB } from './physics.ts';
import { buildModel, entityTexture, type BuiltModel, type ModelDef } from './boxModel.ts';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { GlowOutline } from '../render/glow.ts';
import { DYE_COLORS } from '../ui/specialIcons.ts';
import type { ItemStack } from '../items/inventory.ts';
import { blocks } from '../blocks/registry.ts';
import { CAT_COLLAR_LAYER, HORSE_ARMOR_LAYER, HORSE_MARKING_LAYER, VILLAGER_LEVEL_LAYER, VILLAGER_PROFESSION_LAYER, VILLAGER_TYPE_LAYER, beeTexture, catTexture, villagerBadgeTexture, villagerProfessionTexture, villagerTypeTexture, villagerWearsBrim, horseArmorPoints, horseArmorTexture, horseCoatTexture, horseMarkingTexture } from './mobTypes.ts';

export interface MobStats {
  id: string;
  name: string;
  width: number;
  height: number;
  health: number;
  damage: number;
  /** Vanilla movement speed attribute. */
  speed: number;
  xp: number;
  disposition: 'hostile' | 'neutral' | 'passive';
  followRange: number;
  eyeHeight: number;
  /** Loot table key in data/loot/entities.json. */
  loot: string;
  burnsInSun?: boolean;
  climbs?: boolean;
  flapping?: boolean;
  /** Fish: swim freely in water, suffocate and flop on land, never float up. */
  aquatic?: boolean;
  /** Phantoms: no gravity, fly toward 3D move targets. */
  flying?: boolean;
  /** Nether mobs: lava and fire do nothing to them. */
  fireproof?: boolean;
  /** Striders: lava carries them rather than swallowing them. */
  walksOnLava?: boolean;
  model: ModelDef;
  /** Which model parts swing as limbs, arms and the head. */
  animation: 'biped' | 'quadruped' | 'creeper' | 'spider' | 'chicken' | 'slime' | 'fish' | 'bat' | 'squid' | 'rabbit' | 'silverfish' | 'breeze' | 'warden' | 'phantom' | 'horse' | 'bee' | 'illager' | 'vex' | 'guardian' | 'blaze' | 'ghast' | 'strider' | 'wither' | 'crystal' | 'dragon' | 'shulker';
  /** Render scale of the box model (slime sizes, wither skeleton 1.2, cave spider 0.7). */
  scale?: number;
}

export interface MobWorld extends BlockSource {
  isDay(): boolean;
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  skyDarken(): number;
  playerPos(): THREE.Vector3;
  playerEye(): THREE.Vector3;
  playerBox(): AABB;
  playerLookDir(): THREE.Vector3;
  playerTargetable(): boolean;
  /** Whether the player is invisible, which shortens how far a mob can see them. */
  playerInvisible?(): boolean;
  /** Whether the player is wearing gold, which piglins take as a sign to leave them be. */
  playerWearsGold?(): boolean;
  /** Status effect applied to the player by a mob attack or arrow. */
  addPlayerEffect(id: string, ticks: number, amplifier?: number): void;
  /** Sets the player on fire (burning zombies pass their flames on). */
  ignitePlayer(ticks: number): void;
  playerHasEffect(id: string): boolean;
  /** Item id the player is holding, for goals that follow food (vanilla TemptGoal). */
  playerHolding(): string | null;
  /** Whether a jukebox within `range` is spinning a record, which is what a parrot dances to. */
  recordNear?(x: number, y: number, z: number, range: number): boolean;
  /** Nearest block matching any of `ids` (bees looking for flowers or their hive). */
  findBlock?(x: number, y: number, z: number, range: number, ids: string[]): { x: number; y: number; z: number; block: string } | null;
  /** A bee carrying nectar reached its hive: stores it and returns whether the bee went inside. */
  enterHive?(m: Mob, x: number, y: number, z: number): boolean;
  /** Nearest job site block a villager can claim, optionally restricted to one profession. */
  findJobSite?(x: number, y: number, z: number, range: number, profession: string | null): { x: number; y: number; z: number; block: string } | null;
  /** Called when a villager reaches its job site: takes the profession or restocks. */
  claimJobSite?(m: Mob, block: string): void;
  playerHealth(): number;
  /** Witch splash potion: applies `effect` to the player within four blocks of where it lands. */
  throwPotion(from: THREE.Vector3, to: THREE.Vector3, effect: ArrowEffect, color: number): void;
  /** Living mobs within `range` blocks of a point. */
  mobsNear(x: number, y: number, z: number, range: number): Mob[];
  spawnMob(type: string, x: number, y: number, z: number, baby: boolean): Mob | null;
  dropItem(id: string, count: number, x: number, y: number, z: number): void;
  giveXp(amount: number, x: number, y: number, z: number): void;
  emitParticles(kind: 'heart' | 'poof' | 'angry' | 'happy', x: number, y: number, z: number, count: number, w: number, h: number): void;
  setBlock(x: number, y: number, z: number, state: number): void;
  playSound(name: string, x: number, y: number, z: number, pitch?: number): void;
  /** Deal damage to the player from a mob. */
  hurtPlayer(amount: number, from: THREE.Vector3, source?: Mob): void;
  /** The mob that last hurt the player and the one the player last attacked (tamed wolves defend). */
  playerAttacker(): Mob | null;
  playerVictim(): Mob | null;
  /** Spawn an arrow flying from `from` toward `to`. */
  shootArrow(from: THREE.Vector3, to: THREE.Vector3, velocity: number, damage: number, effect?: ArrowEffect): void;
  explode(x: number, y: number, z: number, power: number, source: Mob): void;
  lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean;
  time: number;
  rng: () => number;
}

export interface ArrowEffect { id: string; ticks: number; amplifier?: number }

export interface Goal {
  /** Whether the goal wants to run this tick. */
  canUse(m: Mob, w: MobWorld): boolean;
  /** Whether a running goal should keep running. */
  canContinue?(m: Mob, w: MobWorld): boolean;
  start?(m: Mob, w: MobWorld): void;
  tick(m: Mob, w: MobWorld): void;
  stop?(m: Mob, w: MobWorld): void;
  /** Exclusive resource: goals sharing a resource don't run together. */
  flags: number;
}

export const FLAG_MOVE = 1;
export const FLAG_LOOK = 2;
export const FLAG_TARGET = 4;

export interface MobSave {
  type: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  health: number;
  age: number;
  extra?: Record<string, unknown>;
  /** Present for dropped item stacks saved alongside mobs. */
  item?: { id: string; count: number; damage?: number; enchantments?: Record<string, number>; name?: string };
}

/**
 * Ridden mounts map their speed attribute onto vanilla's ground speed. Velocity settles at
 * `accel × f / (1 − f)` with the 0.546 ground friction below, so this factor turns the 0.1125–0.3375
 * attribute range into 4.8–14.5 blocks per second, exactly the range vanilla horses cover.
 */
const RIDDEN_ACCEL = 1.79;

let nextId = 1;

/** Chunk material and fire tile ids used to draw burning mobs; set once by the game. */
/** How long a guardian charges its beam before it lands: vanilla's attack duration. */
export const guardianAttackTicks = (elder: boolean): number => (elder ? 60 : 80);

/** How long a shulker's lid takes to slide open or shut. */
export const SHULKER_OPEN_TICKS = 20;

/** How far that lid has slid, nought to one, which is what the model is drawn from. */
export const shulkerOpen = (m: Mob): number =>
  Math.max(0, Math.min(1, (typeof m.extra.open === 'number' ? m.extra.open : 0) / SHULKER_OPEN_TICKS));

export const mobFireAssets: { material: THREE.Material | null; tiles: [number, number]; viewYaw: number } = { material: null, tiles: [0, 0], viewYaw: 0 };

/** Camera-facing fire quads stacked over an entity's height (vanilla EntityRenderDispatcher.renderFlame). */
function fireGeometry(width: number, height: number): THREE.BufferGeometry {
  const w = width * 1.4;
  const pos: number[] = [], uv: number[] = [], tile: number[] = [], color: number[] = [], light: number[] = [], idx: number[] = [];
  let v = 0;
  for (let k = 0; k * 1 < height; k++) {
    const y0 = k, y1 = Math.min(height, k + 1);
    const t = mobFireAssets.tiles[k % 2];
    pos.push(-w / 2, y0, 0, w / 2, y0, 0, w / 2, y1, 0, -w / 2, y1, 0);
    uv.push(0, 1, 1, 1, 1, 1 - (y1 - y0), 0, 1 - (y1 - y0));
    for (let i = 0; i < 4; i++) { tile.push(t); color.push(1, 1, 1, 1); light.push(15, 15); }
    idx.push(v, v + 1, v + 2, v, v + 2, v + 3);
    v += 4;
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('tile', new THREE.Float32BufferAttribute(tile, 1));
  g.setAttribute('color', new THREE.Float32BufferAttribute(color, 4));
  g.setAttribute('light', new THREE.Float32BufferAttribute(light, 2));
  g.setIndex(idx);
  return g;
}

export class Mob {
  readonly id = nextId++;
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  bodyYaw = 0;
  headYaw = 0;
  headPitch = 0;
  prevBodyYaw = 0;
  onGround = false;
  inWater = false;
  horizontalCollision = false;
  health: number;
  hurtTime = 0;
  invulnerable = 0;
  deathTime = 0;
  dead = false;
  /** Set once the manager has handled drops and XP for this death. */
  deathHandled = false;
  removed = false;
  age = 0;
  fireTicks = 0;
  /** Distance walked, drives limb animation. */
  limbSwing = 0;
  limbAmount = 0;
  /** Movement target set by goals. */
  moveTarget: THREE.Vector3 | null = null;
  moveSpeed = 1;
  moveTimeout = 0;
  lookTarget: THREE.Vector3 | null = null;
  target: 'player' | Mob | null = null;
  /** Tamed wolves get 40; everything else keeps its stats' health. */
  maxHealth: number;
  attackCooldown = 0;
  lastHurtBy: 'player' | 'other' | null = null;
  lastHurtTime = -1000;
  /** Mob-specific state (creeper swelling, sheep wool...). */
  extra: Record<string, number | boolean | string> = {};
  /** Status effects on the mob: what a splash potion leaves behind. */
  readonly effects = new Map<string, { ticks: number; amplifier: number }>();
  /** Set while the player rides this mob: goals stop and `control` drives movement. */
  ridden = false;
  /** Steering from the rider: forward/strafe in −1..1, and a jump impulse for the next tick. */
  control: { forward: number; strafe: number; jump: number } | null = null;
  readonly goals: Goal[];
  private active: Goal | null = null;
  readonly model: BuiltModel;
  private readonly tmp = new THREE.Vector3();
  /** Persistent mobs never despawn (named, bred, passive). */
  persistent: boolean;
  private fireMesh: THREE.Mesh | null = null;
  private beamMesh: THREE.Mesh | null = null;
  /** Built the first time the mob glows, then just hidden and shown. */
  private outline: GlowOutline | null = null;
  private woolMaterials: THREE.MeshBasicMaterial[] | null = null;
  private decoration: THREE.Object3D | null = null;
  private readonly base: string;

  constructor(readonly def: MobStats, goals: Goal[], base: string, x: number, y: number, z: number) {
    this.health = def.health;
    this.maxHealth = def.health;
    this.goals = goals;
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    this.base = base;
    this.model = buildModel(def.model, base);
    if (def.scale) this.model.group.scale.setScalar(def.scale);
    this.model.group.position.copy(this.pos);
    this.persistent = def.disposition === 'passive' && !def.aquatic;
  }

  /** Babies are half size (vanilla AgeableMob scale 0.5). */
  get isBaby(): boolean {
    return this.extra.baby === true;
  }

  get width(): number {
    return this.def.width * (this.isBaby ? 0.5 : 1);
  }

  get height(): number {
    return this.def.height * (this.isBaby ? 0.5 : 1);
  }

  aabb(pos = this.pos): AABB {
    const h = this.width / 2;
    return { minX: pos.x - h, minY: pos.y, minZ: pos.z - h, maxX: pos.x + h, maxY: pos.y + this.height, maxZ: pos.z + h };
  }

  eyePos(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.def.eyeHeight, this.pos.z);
  }

  /** Damage from any source; returns false when invulnerable. */
  /** Puts an effect on the mob, keeping whichever of the two is stronger, as vanilla does. */
  addEffect(id: string, ticks: number, amplifier = 0): void {
    const has = this.effects.get(id);
    if (has && (has.amplifier > amplifier || (has.amplifier === amplifier && has.ticks > ticks))) return;
    this.effects.set(id, { ticks, amplifier });
  }

  effectLevel(id: string): number {
    const e = this.effects.get(id);
    return e ? e.amplifier + 1 : 0;
  }

  /** Runs the effects down, doing the damage and healing they do. */
  private tickEffects(): void {
    if (!this.effects.size) return;
    for (const [id, e] of this.effects) {
      if (--e.ticks <= 0) {
        this.effects.delete(id);
        continue;
      }
      if (id === 'poison' && this.age % Math.max(1, 25 >> e.amplifier) === 0 && this.health > 1) this.hurt(1, null, 'other', 0);
      else if (id === 'wither' && this.age % Math.max(1, 40 >> e.amplifier) === 0) this.hurt(1, null, 'other', 0);
      else if (id === 'regeneration' && this.age % Math.max(1, 50 >> e.amplifier) === 0) this.health = Math.min(this.maxHealth, this.health + 1);
    }
  }

  hurt(amount: number, from: THREE.Vector3 | null, by: 'player' | 'other', knockback = 0.4): boolean {
    if (this.dead || this.invulnerable > 0) return false;
    // vanilla armours the Wither below half health and never lets it be knocked about
    if (this.def.id === 'wither') {
      if (this.health <= this.maxHealth / 2) amount /= 2;
      knockback = 0;
    }
    // and nothing touches the dragon while a crystal is still healing it
    if (this.def.id === 'ender_dragon') {
      if (typeof this.extra.crystals === 'number' && this.extra.crystals > 0) return false;
      knockback = 0;
    }
    // a shulker with its lid shut is armoured the way vanilla armours it, and never knocked about
    if (this.def.id === 'shulker') {
      if (shulkerOpen(this) < 0.5) amount *= 1 - 20 / 25;
      knockback = 0;
    }
    // horse armour soaks damage with vanilla's armour formula (4% per point)
    const points = typeof this.extra.armor === 'string' ? horseArmorPoints(this.extra.armor) : 0;
    if (points > 0) amount *= 1 - Math.min(20, points) / 25;
    this.health -= amount;
    this.invulnerable = 10;
    this.hurtTime = 10;
    this.lastHurtBy = by;
    this.lastHurtTime = this.age;
    if (from && knockback > 0) {
      const dx = this.pos.x - from.x;
      const dz = this.pos.z - from.z;
      const len = Math.hypot(dx, dz) || 1;
      this.vel.x += (dx / len) * knockback;
      this.vel.z += (dz / len) * knockback;
      this.vel.y = Math.min(0.4, this.vel.y + knockback);
    }
    if (this.health <= 0) {
      this.dead = true;
      this.deathTime = 0;
    }
    return true;
  }

  tick(w: MobWorld): void {
    this.prev.copy(this.pos);
    this.prevBodyYaw = this.bodyYaw;
    this.age++;
    if (this.invulnerable > 0) this.invulnerable--;
    if (this.hurtTime > 0) this.hurtTime--;
    if (this.attackCooldown > 0) this.attackCooldown--;
    // the dragon renews a crystal's healing beam every tick it draws on it, so letting it run down
    // here is what makes the link vanish the moment the dragon dies or flies out of reach
    if (this.def.animation === 'crystal' && typeof this.extra.beam === 'number' && this.extra.beam > 0) this.extra.beam--;
    this.tickEffects();
    if (this.dead) {
      if (++this.deathTime >= 20) this.removed = true;
      this.vel.set(0, 0, 0);
      this.applyGravityOnly(w);
      return;
    }
    this.inWater = isFluidAt(w, this.pos.x, this.pos.y + 0.2, this.pos.z, 'water');
    // sunlight
    if (this.def.burnsInSun && w.isDay() && !this.inWater && w.getSkyLight(Math.floor(this.pos.x), Math.floor(this.pos.y + this.def.eyeHeight), Math.floor(this.pos.z)) >= 15 && w.rng() < 0.8) this.fireTicks = Math.max(this.fireTicks, 160);
    if (this.def.fireproof) this.fireTicks = 0; // the Nether's own take no harm from either
    if (this.fireTicks > 0) {
      this.fireTicks--;
      if (this.inWater) this.fireTicks = 0;
      else if (this.fireTicks % 20 === 0) this.hurt(1, null, 'other', 0);
      if (this.dead) return;
    }
    // lava
    if (!this.def.fireproof && isFluidAt(w, this.pos.x, this.pos.y + 0.2, this.pos.z, 'lava')) {
      this.hurt(4, null, 'other', 0);
      this.fireTicks = 300;
      if (this.dead) return;
    }
    if (this.def.aquatic && !this.inWater && this.age % 20 === 0) this.hurt(1, null, 'other', 0);
    if (this.dead) return;
    this.ageTick(w);
    if (this.ridden) {
      this.moveTarget = null;
      this.lookTarget = null;
    } else {
      this.selectGoal(w);
      this.active?.tick(this, w);
    }
    this.moveTick(w);
    this.animateTick();
  }

  /** Growing up, love and breeding cooldowns, chicken eggs (all kept in `extra` so saves carry them). */
  private ageTick(w: MobWorld): void {
    const e = this.extra;
    if (e.baby === true) {
      const grow = typeof e.grow === 'number' ? e.grow - 1 : 24000;
      if (grow <= 0) {
        delete e.baby;
        delete e.grow;
      } else e.grow = grow;
    }
    if (typeof e.love === 'number' && e.love > 0) {
      e.love--;
      if (this.age % 8 === 0) w.emitParticles('heart', this.pos.x, this.pos.y + this.height, this.pos.z, 1, this.width, 0.5);
    }
    if (typeof e.cooldown === 'number' && e.cooldown > 0) e.cooldown--;
    if (this.def.id === 'chicken' && e.baby !== true) {
      const egg = typeof e.egg === 'number' ? e.egg - 1 : 6000 + Math.floor(w.rng() * 6000);
      if (egg <= 0) {
        w.dropItem('egg', 1, this.pos.x, this.pos.y, this.pos.z);
        w.playSound('pop', this.pos.x, this.pos.y, this.pos.z);
        e.egg = 6000 + Math.floor(w.rng() * 6000);
      } else e.egg = egg;
    }
  }

  private selectGoal(w: MobWorld): void {
    const a = this.active;
    const keep = a ? (a.canContinue ? a.canContinue(this, w) : a.canUse(this, w)) : false;
    if (a && keep) {
      // a higher priority goal may interrupt
      for (const g of this.goals) {
        if (g === a) break;
        if (g.canUse(this, w)) {
          a.stop?.(this, w);
          this.active = g;
          g.start?.(this, w);
          return;
        }
      }
      return;
    }
    this.active?.stop?.(this, w);
    this.active = null;
    for (const g of this.goals) {
      if (g.canUse(this, w)) {
        this.active = g;
        g.start?.(this, w);
        return;
      }
    }
  }

  /** Moves toward `moveTarget` with vanilla-like acceleration, friction, gravity and auto-jump. */
  private moveTick(w: MobWorld): void {
    const attr = typeof this.extra.speedAttr === 'number' ? this.extra.speedAttr : this.def.speed;
    let accel = 0;
    let dirX = 0;
    let dirZ = 0;
    if (this.control) {
      // steered by a rider: vanilla mounts move at their own speed attribute in the rider's facing
      const c = this.control;
      const len = Math.hypot(c.forward, c.strafe);
      if (len > 0.001) {
        const sin = Math.sin(this.yaw);
        const cos = Math.cos(this.yaw);
        dirX = (-c.strafe * cos - c.forward * sin) / Math.max(1, len);
        dirZ = (c.strafe * sin - c.forward * cos) / Math.max(1, len);
        accel = attr * RIDDEN_ACCEL * (this.onGround ? 1 : 0.2);
        if (this.inWater) accel *= 0.5;
      }
      if (c.jump > 0 && this.onGround) {
        this.vel.y = c.jump;
        this.onGround = false;
      }
      c.jump = 0;
      this.bodyYaw = this.yaw;
    } else if (this.moveTarget) {
      const dx = this.moveTarget.x - this.pos.x;
      const dz = this.moveTarget.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3 || --this.moveTimeout <= 0) this.moveTarget = null;
      else {
        dirX = dx / dist;
        dirZ = dz / dist;
        this.yaw = Math.atan2(-dirX, -dirZ);
        const potion = (1 + 0.2 * this.effectLevel('speed')) * (1 - 0.15 * this.effectLevel('slowness'));
        accel = attr * attr * 2.2 * this.moveSpeed * potion * (this.onGround || this.def.flying || (this.def.aquatic && this.inWater) ? 1 : 0.2);
        if (this.inWater) accel *= 0.5;
      }
    }
    this.vel.x += dirX * accel;
    this.vel.z += dirZ * accel;
    if (this.def.flying) {
      // steer in three dimensions, drift when idle
      if (this.moveTarget) this.vel.y += Math.max(-0.05, Math.min(0.05, (this.moveTarget.y - this.pos.y) * 0.05));
      this.vel.multiplyScalar(0.91);
    } else if (this.def.aquatic) {
      if (this.inWater) {
        if (this.moveTarget) this.vel.y += Math.max(-0.03, Math.min(0.03, (this.moveTarget.y - this.pos.y) * 0.1));
        this.vel.multiplyScalar(0.9);
      } else if (this.onGround && w.rng() < 0.1) {
        // flopping on land
        this.vel.y = 0.3;
        this.vel.x += (w.rng() - 0.5) * 0.2;
        this.vel.z += (w.rng() - 0.5) * 0.2;
      }
    } else if (this.inWater) {
      if (this.moveTarget || w.rng() < 0.8) this.vel.y += 0.04;
      this.vel.multiplyScalar(0.8);
      this.vel.y -= 0.02;
    } else if (this.def.flapping && this.vel.y < -0.1 && !this.onGround) {
      this.vel.y = -0.1;
    }
    // striders walk on their lava sea rather than sinking into it, as vanilla lets them
    if (this.def.walksOnLava && isFluidAt(w, this.pos.x, this.pos.y + 0.1, this.pos.z, 'lava')) {
      const surface = Math.floor(this.pos.y + 0.1) + 1;
      this.pos.y = surface;
      this.vel.y = Math.max(0, this.vel.y);
      this.onGround = true;
    }
    const box = this.aabb();
    const before = { x: this.pos.x, z: this.pos.z };
    const r = sweep(w, box, this.vel.x, this.vel.y, this.vel.z, 0);
    this.pos.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
    this.onGround = r.onGround === 1 || (r.hitY && this.vel.y < 0);
    this.horizontalCollision = r.hitX || r.hitZ;
    if (r.hitY) this.vel.y = 0;
    if (r.hitX) this.vel.x = 0;
    if (r.hitZ) this.vel.z = 0;
    // auto-jump over one-block steps, spiders climb
    if (this.horizontalCollision && this.moveTarget && !this.def.flying) {
      if (this.def.climbs) this.vel.y = 0.2;
      else if (this.onGround) this.vel.y = 0.42;
    }
    if (!this.inWater && !this.def.flying) {
      this.vel.y -= 0.08;
      this.vel.y *= 0.98;
      const friction = this.onGround ? 0.6 * 0.91 : 0.91;
      this.vel.x *= friction;
      this.vel.z *= friction;
    }
    // body yaw follows movement
    const moved = Math.hypot(this.pos.x - before.x, this.pos.z - before.z);
    this.limbAmount += (Math.min(1, moved * 4) - this.limbAmount) * 0.4;
    this.limbSwing += this.limbAmount;
    if (moved > 0.01) this.bodyYaw = this.yaw;
    // head looks at the look target or straight ahead
    if (this.lookTarget) {
      const dx = this.lookTarget.x - this.pos.x;
      const dz = this.lookTarget.z - this.pos.z;
      const dy = this.lookTarget.y - (this.pos.y + this.def.eyeHeight);
      const targetYaw = Math.atan2(-dx, -dz);
      this.headYaw = targetYaw;
      this.headPitch = Math.atan2(dy, Math.hypot(dx, dz));
      if (!this.moveTarget) {
        // turn the body toward the look direction when standing still
        let d = ((targetYaw - this.bodyYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
        d = Math.max(-0.15, Math.min(0.15, d));
        this.bodyYaw += d;
      }
    } else {
      this.headYaw = this.bodyYaw;
      this.headPitch *= 0.8;
    }
    // keep the head within 75 degrees of the body
    let diff = ((this.headYaw - this.bodyYaw + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
    const lim = (75 * Math.PI) / 180;
    if (diff > lim) this.bodyYaw = this.headYaw - lim;
    else if (diff < -lim) this.bodyYaw = this.headYaw + lim;
    diff = 0;
  }

  private applyGravityOnly(w: MobWorld): void {
    const box = this.aabb();
    const r = sweep(w, box, 0, -0.08, 0, 0);
    this.pos.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
    void r;
  }

  private animateTick(): void {}

  /** Whether the mob's box would collide with blocks at a position (used by spawning and pathing). */
  static fits(w: BlockSource, def: MobStats, x: number, y: number, z: number): boolean {
    const h = def.width / 2;
    const box: AABB = { minX: x - h, minY: y, minZ: z - h, maxX: x + h, maxY: y + def.height, maxZ: z + h };
    for (const b of boxesIn(w, box)) if (aabbIntersects(box, b)) return false;
    return true;
  }

  /** Swaps the main model texture (wolf tame/angry skins). */
  /**
   * Extra geometry hung off the model in world units, which is how a mooshroom wears its mushrooms:
   * the game builds it, since only the game can bake a block model, and the mob carries it about.
   */
  setDecoration(obj: THREE.Object3D | null, part?: string): void {
    if (this.decoration) this.decoration.parent?.remove(this.decoration);
    this.decoration = obj;
    // a decoration hung off a part rides that part: a snow golem's pumpkin turns with its head
    if (obj) (part ? this.model.parts.get(part) ?? this.model.group : this.model.group).add(obj);
  }

  setTexture(path: string): void {
    if (this.currentTexture === path) return;
    this.currentTexture = path;
    const tex = entityTexture(this.base, path);
    const main = this.model.materials[0];
    if (main) {
      main.map = tex;
      main.needsUpdate = true;
    }
  }
  private currentTexture: string | null = null;

  /** Swaps one of the model's skin layers (markings, armour) by the texture it was built with. */
  setLayerTexture(layer: string, path: string): void {
    if (this.layerPaths.get(layer) === path) return;
    this.layerPaths.set(layer, path);
    const mat = this.model.layers.get(layer);
    if (mat) {
      mat.map = entityTexture(this.base, path);
      mat.needsUpdate = true;
    }
  }
  private readonly layerPaths = new Map<string, string>();

  /** Removes render objects that live outside the model group. */
  destroy(): void {
    if (this.decoration) {
      this.decoration.parent?.remove(this.decoration);
      this.decoration = null;
    }
    if (this.fireMesh) {
      this.fireMesh.parent?.remove(this.fireMesh);
      this.fireMesh.geometry.dispose();
      this.fireMesh = null;
    }
    if (this.outline) {
      this.outline.dispose();
      this.outline = null;
    }
    if (this.beamMesh) {
      this.beamMesh.parent?.remove(this.beamMesh);
      this.beamMesh.geometry.dispose();
      this.beamMesh = null;
    }
  }

  /**
   * Beams drawn between two points: the guardian's, which grows out of its eye and snaps wide just
   * before it lands, and the end crystal's, which links it to whatever it is healing. Both are the
   * same shape in vanilla, a quad down the axis with its texture scrolling along it.
   */
  private renderBeam(): void {
    const crystal = this.def.animation === 'crystal';
    const charging = typeof this.extra.beam === 'number' ? this.extra.beam : 0;
    if (!charging || this.dead) {
      if (this.beamMesh) this.beamMesh.visible = false;
      return;
    }
    const target = new THREE.Vector3(Number(this.extra.beamX), Number(this.extra.beamY), Number(this.extra.beamZ));
    if (!Number.isFinite(target.x)) return;
    if (!this.beamMesh) {
      // two quads crossed down the beam's axis, so it reads as a beam from any side rather than
      // vanishing edge-on the way a single billboard would
      const a = new THREE.PlaneGeometry(1, 1);
      const b = new THREE.PlaneGeometry(1, 1);
      b.rotateY(Math.PI / 2);
      const geo = mergeGeometries([a, b]);
      geo.translate(0, 0.5, 0); // grows from the eye toward the target
      const tex = entityTexture(this.base, crystal ? 'end_crystal/end_crystal_beam.png' : 'guardian_beam.png');
      tex.wrapT = THREE.RepeatWrapping;
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending });
      this.beamMesh = new THREE.Mesh(geo, mat);
      this.beamMesh.frustumCulled = false;
      this.model.group.parent?.add(this.beamMesh);
    }
    // the guardian's beam leaves its eye; the crystal's leaves the spinning core over its base
    const eye = crystal ? this.pos.clone().setY(this.pos.y + 1.3) : this.eyePos();
    const full = guardianAttackTicks(this.def.id === 'elder_guardian');
    const progress = charging / full;
    const length = eye.distanceTo(target);
    this.beamMesh.visible = true;
    this.beamMesh.position.copy(eye);
    // point the quad down the beam, and roll it to face the camera as vanilla's billboard does
    this.beamMesh.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), target.clone().sub(eye).normalize());
    this.beamMesh.scale.set(crystal ? 0.4 : progress > 0.9 ? 0.35 : 0.05 + progress * 0.1, length, 1);
    const mat = this.beamMesh.material as THREE.MeshBasicMaterial;
    if (mat.map) {
      mat.map.repeat.set(1, Math.max(1, length));
      mat.map.offset.y = -(this.age % 20) / 20;
    }
    mat.opacity = crystal ? 0.8 : progress > 0.9 ? 1 : 0.6;
  }

  /** Draws the glowing outline while the effect lasts, and only builds it the first time. */
  private renderGlow(): void {
    const glowing = this.effectLevel('glowing') > 0 && !this.removed;
    if (!glowing) {
      this.outline?.setVisible(false);
      return;
    }
    if (!this.outline) this.outline = new GlowOutline(this.model);
    this.outline.setVisible(true);
  }

  private renderFire(): void {
    const g = this.model.group;
    const burning = this.fireTicks > 0 && !this.dead && !!mobFireAssets.material;
    if (!burning) {
      if (this.fireMesh) this.fireMesh.visible = false;
      return;
    }
    if (!this.fireMesh) {
      this.fireMesh = new THREE.Mesh(fireGeometry(this.def.width, this.def.height), mobFireAssets.material!);
      this.fireMesh.frustumCulled = false;
      g.parent?.add(this.fireMesh);
    }
    this.fireMesh.visible = true;
    this.fireMesh.position.copy(g.position);
    this.fireMesh.rotation.y = mobFireAssets.viewYaw;
  }

  /** Updates the Three.js model for rendering. */
  render(alpha: number, light: number): void {
    const g = this.model.group;
    g.position.copy(this.prev).lerp(this.pos, alpha);
    this.renderFire();
    this.renderGlow();
    if (this.def.animation === 'guardian' || this.def.animation === 'crystal') this.renderBeam();
    const baby = this.isBaby;
    g.scale.setScalar((this.def.scale ?? 1) * (baby ? 0.5 : 1));
    const headPart = this.model.parts.get('head');
    if (headPart) headPart.scale.setScalar(baby ? 2 : 1); // vanilla babies keep a full-size head
    if (this.def.id === 'sheep') {
      const sheared = this.extra.sheared === true;
      for (const [name, part] of this.model.parts) if (name.startsWith('wool')) part.visible = !sheared;
    }
    let by = this.prevBodyYaw + shortAngle(this.prevBodyYaw, this.bodyYaw) * alpha;
    g.rotation.y = by;
    const parts = this.model.parts;
    const head = parts.get('head');
    if (head) {
      head.rotation.y = -shortAngle(by, this.headYaw);
      head.rotation.x = -this.headPitch;
    }
    const swing = this.limbSwing + this.limbAmount * alpha;
    const amt = this.limbAmount;
    const legA = Math.cos(swing * 0.6662) * 1.4 * amt;
    const legB = Math.cos(swing * 0.6662 + Math.PI) * 1.4 * amt;
    const set = (name: string, x: number, y = 0, z = 0) => {
      const p = parts.get(name);
      if (p) p.rotation.set(-x, -y, z);
    };
    switch (this.def.animation) {
      case 'biped': {
        set('right_leg', legA);
        set('left_leg', legB);
        if (this.def.id === 'zombie' || this.def.id === 'husk' || this.def.id === 'drowned') {
          const raise = -Math.PI / 2 + Math.sin(this.age * 0.067) * 0.05;
          set('right_arm', raise, -0.1);
          set('left_arm', raise, 0.1);
        } else {
          set('right_arm', Math.cos(swing * 0.6662 + Math.PI) * 2 * amt * 0.5);
          set('left_arm', Math.cos(swing * 0.6662) * 2 * amt * 0.5);
        }
        break;
      }
      case 'quadruped':
        set('right_hind_leg', legA);
        set('left_hind_leg', legB);
        set('right_front_leg', legB);
        set('left_front_leg', legA);
        break;
      case 'creeper':
        set('leg0', legA);
        set('leg1', legB);
        set('leg2', legB);
        set('leg3', legA);
        break;
      case 'spider': {
        const w1 = Math.cos(swing * 0.6662 * 2 + 0) * 0.4 * amt;
        const w2 = Math.cos(swing * 0.6662 * 2 + Math.PI) * 0.4 * amt;
        const w3 = Math.cos(swing * 0.6662 * 2 + Math.PI / 2) * 0.4 * amt;
        const w4 = Math.cos(swing * 0.6662 * 2 + (Math.PI * 3) / 2) * 0.4 * amt;
        const z1 = Math.abs(Math.sin(swing * 0.6662 + 0)) * 0.4 * amt;
        const z2 = Math.abs(Math.sin(swing * 0.6662 + Math.PI)) * 0.4 * amt;
        const z3 = Math.abs(Math.sin(swing * 0.6662 + Math.PI / 2)) * 0.4 * amt;
        const z4 = Math.abs(Math.sin(swing * 0.6662 + (Math.PI * 3) / 2)) * 0.4 * amt;
        const base = [[-0.7854, 0.7854], [-0.5236, 0.5236], [0.5236, -0.5236], [0.7854, -0.7854]];
        const wig = [[w1, z1], [w2, z2], [w3, z3], [w4, z4]];
        for (let i = 0; i < 4; i++) {
          const zr = base[i][0];
          const yr = base[i][1];
          const [wv, zv] = wig[i];
          const rp = parts.get(`right_leg${i}`);
          const lp = parts.get(`left_leg${i}`);
          if (rp) rp.rotation.set(0, -(yr + wv), -(zr - zv) + Math.PI / 4 * 0);
          if (lp) lp.rotation.set(0, -(-yr - wv), (zr - zv) - Math.PI / 4 * 0);
          if (rp) rp.rotation.z = -(-zr + zv) * -1;
          if (lp) lp.rotation.z = (zr - zv) * -1;
        }
        break;
      }
      case 'chicken': {
        set('right_leg', legA);
        set('left_leg', legB);
        const flap = this.onGround ? 0 : Math.sin(this.age * 0.6) * 0.8;
        const rw = parts.get('right_wing');
        const lw = parts.get('left_wing');
        if (rw) rw.rotation.z = -flap;
        if (lw) lw.rotation.z = flap;
        break;
      }
      case 'slime': {
        // stretch while airborne, squash on landing (vanilla squish factor, simplified)
        const stretch = this.onGround ? 1 - Math.min(0.25, this.limbAmount) : 1 + Math.min(0.5, Math.abs(this.vel.y) * 1.2);
        const side = 1 / Math.sqrt(stretch);
        for (const p of parts.values()) p.scale.set(side, stretch, side);
        break;
      }
      case 'fish': {
        const t = this.inWater ? Math.sin(this.age * 0.6 + alpha) * 0.3 : Math.sin(this.age * 1.5) * 0.6;
        const tail = parts.get('tail_fin') ?? parts.get('body_back');
        if (tail) tail.rotation.y = t;
        g.rotation.z = this.inWater || this.onGround === false ? 0 : Math.PI / 2; // fish lie on their side on land
        break;
      }
      case 'bat': {
        // vanilla folds a resting bat up against the ceiling and beats its wings when it flies
        const resting = this.extra.resting === true;
        g.rotation.z = resting ? Math.PI : 0;
        // vanilla's beat: a quarter turn either way, with the tips following at half
        const beat = resting ? 0.15 : Math.cos((this.age + alpha) * 0.74) * Math.PI * 0.25;
        const rw = parts.get('right_wing'), lw = parts.get('left_wing');
        const rt = parts.get('right_wing_tip'), lt = parts.get('left_wing_tip');
        if (rw) rw.rotation.y = beat;
        if (lw) lw.rotation.y = -beat;
        if (rt) rt.rotation.y = beat * 0.5;
        if (lt) lt.rotation.y = -beat;
        break;
      }
      case 'squid': {
        // the bell tips forward as it swims and the tentacles curl behind it
        const swim = Math.sin((this.age + alpha) * 0.12);
        g.rotation.x = swim * 0.25;
        for (let i = 1; i <= 8; i++) {
          const t = parts.get(`tentacle${i}`);
          if (t) t.rotation.x = 0.35 + swim * 0.5;
        }
        break;
      }
      case 'warden': {
        // vanilla's warden walks with its arms hanging and its tendrils flicking at what it hears
        set('right_leg', legA * 0.8);
        set('left_leg', legB * 0.8);
        set('right_arm', Math.cos(swing * 0.6662 + Math.PI) * amt);
        set('left_arm', Math.cos(swing * 0.6662) * amt);
        const anger = typeof this.extra.anger === 'number' ? this.extra.anger : 0;
        const flick = Math.sin((this.age + alpha) * (anger > 0 ? 0.4 : 0.08)) * (anger > 0 ? 0.5 : 0.12);
        const rt = parts.get('right_tendril'), lt = parts.get('left_tendril');
        if (rt) rt.rotation.z = flick;
        if (lt) lt.rotation.z = -flick;
        break;
      }
      case 'breeze': {
        // the rods spin under the head, faster while it is hunting
        const rods = parts.get('rods');
        if (rods) rods.rotation.y = (this.age + alpha) * (this.target ? 0.35 : 0.12);
        break;
      }
      case 'silverfish': {
        // vanilla ripples a silverfish's segments along its length as it scuttles
        let i = 0;
        for (const [name, part] of parts) {
          if (!name.startsWith('body_part') && !name.startsWith('section')) continue;
          part.rotation.y = Math.cos((this.age + alpha) * 0.9 + i) * 0.4 * amt;
          i++;
        }
        break;
      }
      case 'rabbit': {
        // vanilla's rabbit gathers itself and springs rather than walking: the haunches tuck up and
        // the front legs reach out over the hop
        const hop = amt > 0.01 ? (Math.sin(swing * 0.5) + 1) / 2 : 0;
        set('right_hind_leg', -hop * 1.3);
        set('left_hind_leg', -hop * 1.3);
        set('right_front_leg', -hop * 1.6);
        set('left_front_leg', -hop * 1.6);
        const head = parts.get('head');
        if (head) head.rotation.x = -this.headPitch - hop * 0.2;
        break;
      }
      case 'horse': {
        // vanilla equine gait: the diagonal pairs swing together, faster than a walking cow
        const gallop = Math.min(1, amt * 1.4);
        set('right_hind_leg', legA * 0.8 * gallop);
        set('left_hind_leg', legB * 0.8 * gallop);
        set('right_front_leg', legB * 0.8 * gallop);
        set('left_front_leg', legA * 0.8 * gallop);
        const base = this.model.basePose;
        const tail = parts.get('tail');
        const tailBase = base.get('tail');
        if (tail && tailBase) {
          tail.rotation.x = tailBase.x;
          tail.rotation.y = Math.cos(swing * 0.6662) * 0.3 * amt; // the tail swishes as it moves
        }
        // the head assembly keeps its rest tilt and adds the look angles on top
        const headBase = base.get('head');
        if (head && headBase) {
          head.rotation.x = headBase.x - this.headPitch * 0.6;
          head.rotation.y = -shortAngle(by, this.headYaw) * 0.6;
          if (baby) head.scale.setScalar(1.5); // foals keep a slightly oversized head, not a doubled one
        }
        const saddled = this.extra.saddle === true;
        for (const n of ['saddle', 'head_saddle', 'left_bit', 'right_bit', 'left_rein', 'right_rein']) {
          const p = parts.get(n);
          if (p) p.visible = saddled;
        }
        const chested = this.extra.chest === true;
        for (const n of ['left_bag', 'right_bag']) {
          const p = parts.get(n);
          if (p) p.visible = chested;
        }
        break;
      }
      case 'illager': {
        set('right_leg', legA);
        set('left_leg', legB);
        const crossed = this.target === null && this.extra.casting === undefined;
        const arms = parts.get('arms');
        const right = parts.get('right_arm');
        const left = parts.get('left_arm');
        if (arms) arms.visible = crossed;
        if (right) right.visible = !crossed;
        if (left) left.visible = !crossed;
        const casting = typeof this.extra.casting === 'number' && this.extra.casting > 0;
        if (casting) {
          // vanilla's spellcasting pose: both arms raised and spread
          set('right_arm', -Math.PI * 0.6, 0, -0.6);
          set('left_arm', -Math.PI * 0.6, 0, 0.6);
        } else if (this.extra.aiming === 1) {
          // aiming a crossbow: both arms forward
          set('right_arm', -Math.PI / 2 + this.headPitch, -0.2);
          set('left_arm', -Math.PI / 2 + this.headPitch, 0.2);
        } else if (!crossed) {
          set('right_arm', Math.cos(swing * 0.6662 + Math.PI) * 2 * amt * 0.5);
          set('left_arm', Math.cos(swing * 0.6662) * 2 * amt * 0.5);
        }
        break;
      }
      case 'vex': {
        // wings beat constantly; the arms hang forward with the vex's little sword
        const beat = Math.sin((this.age + alpha) * 0.9) * 0.5;
        const lw = parts.get('left_wing');
        const rw = parts.get('right_wing');
        if (lw) lw.rotation.y = -0.5 - beat;
        if (rw) rw.rotation.y = 0.5 + beat;
        set('right_arm', -Math.PI / 2, -0.2);
        set('left_arm', -Math.PI / 2, 0.2);
        break;
      }
      case 'bee': {
        // the wings beat far faster than the body moves; a resting bee folds them
        const flying = !this.onGround || !!this.moveTarget;
        const beat = flying ? Math.sin((this.age + alpha) * 2.1) * 0.6 : 0;
        const rw = parts.get('right_wing');
        const lw = parts.get('left_wing');
        const rb = this.model.basePose.get('right_wing');
        const lb = this.model.basePose.get('left_wing');
        if (rw && rb) rw.rotation.set(rb.x, rb.y, rb.z + beat);
        if (lw && lb) lw.rotation.set(lb.x, lb.y, lb.z - beat);
        for (const n of ['leg_front', 'leg_mid', 'leg_back']) {
          const leg = parts.get(n);
          if (leg) leg.rotation.x = flying ? -0.6 : 0;
        }
        this.setTexture(beeTexture(this.target !== null, this.extra.nectar === true));
        break;
      }
      case 'guardian': {
        // the tail waves as the guardian swims, the spikes come out while the beam charges, and
        // the eye slides across the front of the body to watch what it is aiming at
        const swim = this.inWater ? 1 : 0;
        const wave = Math.sin((this.age + alpha) * 0.15) * (0.15 + amt * 0.5) * swim;
        const t0 = parts.get('tail0'), t1 = parts.get('tail1'), t2 = parts.get('tail2');
        if (t0) t0.rotation.y = wave;
        if (t1) t1.rotation.y = wave * 1.4;
        if (t2) t2.rotation.y = wave * 1.8;
        const charge = typeof this.extra.beam === 'number' ? Math.min(1, this.extra.beam / 20) : 0;
        // vanilla flares the spikes as the beam charges; they keep their ring and only reach further
        for (const [name, part] of parts) if (name.startsWith('spike')) part.scale.set(1, 1 + charge * 0.6, 1);
        const eye = parts.get('eye');
        if (eye && this.lookTarget) {
          const dx = this.lookTarget.x - this.pos.x;
          const dz = this.lookTarget.z - this.pos.z;
          const local = Math.atan2(-dx, -dz) - by;
          eye.position.x = Math.max(-0.28, Math.min(0.28, Math.sin(local) * 0.35));
          eye.position.y = Math.max(-0.2, Math.min(0.2, (this.lookTarget.y - (this.pos.y + this.def.eyeHeight)) * 0.06));
        } else if (eye) {
          eye.position.set(0, 0, 0);
        }
        break;
      }
      case 'blaze': {
        // vanilla turns three rings of rods about the blaze at radius nine, seven and five
        const t = (this.age + alpha) * 0.1;
        for (let i = 0; i < 12; i++) {
          const rod = parts.get(`rod${i}`);
          if (!rod) continue;
          const ring = Math.floor(i / 4);
          const radius = [9, 7, 5][ring];
          const speed = [-0.1, 0.03, -0.05][ring];
          const height = [-2, 2, 11][ring];
          const angle = (ring === 1 ? Math.PI / 4 : ring === 2 ? 0.4712 : 0) + i + (this.age + alpha) * Math.PI * speed;
          rod.position.set(-Math.cos(angle) * radius, -(height + Math.cos(i * 2 + t * 2.5)), Math.sin(angle) * radius);
        }
        break;
      }
      case 'ghast': {
        // the tentacles sway under the body, each on its own beat
        for (let i = 0; i < 9; i++) {
          const arm = parts.get(`tentacle${i}`);
          if (arm) arm.rotation.x = 0.2 * Math.sin((this.age + alpha) * 0.3 + i) + 0.4;
        }
        break;
      }
      case 'strider': {
        // long legs striding, and the body rocking with them
        set('right_leg', legA * 1.2);
        set('left_leg', legB * 1.2);
        const body = parts.get('body');
        if (body) body.rotation.z = Math.cos(swing * 0.6662) * 0.08 * amt;
        break;
      }
      case 'shulker': {
        // the lid slides up over the head, and vanilla turns it as it goes
        const open = shulkerOpen(this);
        const lid = parts.get('lid');
        const head = parts.get('head');
        if (lid) {
          lid.position.y = open * 0.5;
          lid.rotation.y = open * Math.PI * 0.5;
        }
        if (head) head.visible = open > 0.05;
        break;
      }
      case 'crystal': {
        // vanilla spins the cage and bobs it over the base
        const t = (this.age + alpha) * 0.05;
        for (const name of ['glass', 'core']) {
          const part = parts.get(name);
          if (!part) continue;
          part.rotation.y = t * (name === 'core' ? -1.5 : 1);
          part.position.y = -Math.sin(t * 1.6) * 2 - 2;
          if (name === 'core') part.rotation.x = t * 0.8;
        }
        break;
      }
      case 'dragon': {
        // the wings beat, the neck and tail sway, and the legs tuck up in flight
        const beat = Math.sin((this.age + alpha) * 0.15);
        const wing = parts.get('left_wing'), wingR = parts.get('right_wing');
        const tipL = parts.get('left_wing_tip'), tipR = parts.get('right_wing_tip');
        // the wings hold out level and beat around that, as vanilla's do
        if (wing) wing.rotation.z = beat * 0.25;
        if (wingR) wingR.rotation.z = -beat * 0.25;
        if (tipL) tipL.rotation.z = -0.15 + beat * 0.3;
        if (tipR) tipR.rotation.z = 0.15 - beat * 0.3;
        const sway = Math.sin((this.age + alpha) * 0.08) * 0.1;
        const neck = parts.get('neck'), headPart2 = parts.get('head');
        if (neck) neck.rotation.x = sway - 0.1;
        if (headPart2) headPart2.rotation.x = sway * 1.5;
        const jaw = parts.get('jaw');
        if (jaw) jaw.rotation.x = -(Math.sin((this.age + alpha) * 0.05) * 0.1 + 0.1);
        for (const [name, part] of parts) {
          if (!name.endsWith('_leg') && !name.endsWith('_leg_tip')) continue;
          part.rotation.x = name.includes('hind') ? -0.6 : -0.4;
        }
        break;
      }
      case 'phantom': {
        const flap = Math.cos((this.age + alpha) * 0.13);
        const lb = parts.get('left_wing_base'), lt = parts.get('left_wing_tip'), rb = parts.get('right_wing_base'), rt = parts.get('right_wing_tip');
        if (lb) lb.rotation.z = 0.1 + flap * 0.2;
        if (lt) lt.rotation.z = 0.1 + flap * 0.3;
        if (rb) rb.rotation.z = -(0.1 + flap * 0.2);
        if (rt) rt.rotation.z = -(0.1 + flap * 0.3);
        break;
      }
    }
    if (this.def.animation === 'horse') {
      if (typeof this.extra.coat === 'string') this.setTexture(horseCoatTexture(this.extra.coat));
      const marking = horseMarkingTexture(String(this.extra.marking ?? 'none'));
      for (const [name, part] of this.model.parts) if (name.endsWith('_marking')) part.visible = marking !== null;
      if (marking) this.setLayerTexture(HORSE_MARKING_LAYER, marking);
      const armor = String(this.extra.armor ?? '');
      const armorTex = horseArmorTexture(armor);
      for (const [name, part] of this.model.parts) if (name.endsWith('_armor')) part.visible = armorTex !== null;
      if (armorTex) this.setLayerTexture(HORSE_ARMOR_LAYER, armorTex);
    }
    if (this.def.id === 'villager') {
      const type = villagerTypeTexture(String(this.extra.villagerType ?? 'plains'));
      this.setLayerTexture(VILLAGER_TYPE_LAYER, type);
      const profession = String(this.extra.profession ?? 'none');
      const job = villagerProfessionTexture(profession);
      const level = typeof this.extra.level === 'number' ? this.extra.level : 1;
      const badge = profession !== 'none' && profession !== 'nitwit' ? villagerBadgeTexture(level) : null;
      for (const [name, part] of this.model.parts) {
        if (name.startsWith('brim')) continue;
        if (name.endsWith('_type')) part.visible = true;
        else if (name.endsWith('_job')) part.visible = job !== null;
        else if (name.endsWith('_badge')) part.visible = badge !== null;
      }
      // only the profession skin paints a brimmed hat, so only that layer's brim is drawn
      const brim = villagerWearsBrim(profession);
      for (const name of ['brim', 'brim_type', 'brim_job', 'brim_badge']) {
        const part = this.model.parts.get(name);
        if (part) part.visible = brim && name === 'brim_job';
      }
      if (job) this.setLayerTexture(VILLAGER_PROFESSION_LAYER, job);
      if (badge) this.setLayerTexture(VILLAGER_LEVEL_LAYER, badge);
    }
    if (this.def.id === 'mooshroom') {
      // lightning turns a red mooshroom brown and back; vanilla leaves calves bare
      this.setTexture(this.extra.variant === 'brown' ? 'cow/brown_mooshroom.png' : 'cow/red_mooshroom.png');
      if (this.decoration) this.decoration.visible = !baby;
    }
    if (this.def.id === 'panda') {
      // vanilla's genes each have a skin of their own, and the laziest one lies on its back
      const gene = String(this.extra.gene ?? 'normal');
      this.setTexture(`panda/${gene === 'normal' ? 'panda' : `${gene}_panda`}.png`);
      if (this.extra.lying === true) g.rotation.z = Math.PI / 2;
    }
    if (this.def.id === 'llama') {
      this.setTexture(`llama/${String(this.extra.coat ?? 'creamy')}.png`);
      for (const name of ['chest_left', 'chest_right']) {
        const part = parts.get(name);
        if (part) part.visible = this.extra.chest === true;
      }
    }
    if (this.def.id === 'rabbit') this.setTexture(`rabbit/${String(this.extra.variant ?? 'brown')}.png`);
    if (this.def.id === 'axolotl') {
      this.setTexture(`axolotl/axolotl_${String(this.extra.color ?? 'lucy')}.png`);
      // vanilla rolls a playing-dead axolotl onto its back
      if (typeof this.extra.playDead === 'number' && this.extra.playDead > 0) g.rotation.z = Math.PI;
    }
    if (this.def.id === 'frog') this.setTexture(`frog/${String(this.extra.variant ?? 'temperate')}_frog.png`);
    if (this.def.id === 'creaking' && this.extra.frozen === true) {
      // frozen, it holds whatever pose it was caught in: no swing, no sway
      for (const [name, base] of this.model.basePose) {
        const part = parts.get(name);
        if (part) part.rotation.copy(base);
      }
    }
    if (this.def.id === 'armadillo') {
      // rolled up it is a ball and nothing else, which is how vanilla draws it
      const rolled = this.extra.rolled === true;
      for (const [name, part] of parts) part.visible = name === 'body_rolled_up' ? rolled : !rolled;
    }
    if (this.def.id === 'camel' && this.extra.sitting === true) {
      // a sitting camel folds its legs under it and drops its body onto them
      g.position.y -= 0.5;
      set('right_front_leg', 1.5);
      set('left_front_leg', 1.5);
      set('right_hind_leg', -1.5);
      set('left_hind_leg', -1.5);
    }
    if (this.def.id === 'parrot') {
      this.setTexture(`parrot/parrot_${String(this.extra.color ?? 'red_blue')}.png`);
      if (this.extra.dancing === true) {
        // vanilla bobs a dancing parrot from foot to foot rather than moving it anywhere
        const bob = Math.sin((this.age + alpha) * 0.4);
        g.position.y += Math.abs(bob) * 0.12;
        g.rotation.z = bob * 0.25;
      }
    }
    if (this.def.id === 'fox') {
      // vanilla curls a sleeping fox onto its side and gives it a skin with its eyes shut
      const snow = this.extra.variant === 'snow';
      const asleep = this.extra.sleeping === true;
      this.setTexture(`fox/${snow ? 'snow_fox' : 'fox'}${asleep ? '_sleep' : ''}.png`);
      if (asleep) {
        g.rotation.z = Math.PI / 2;
        set('right_hind_leg', 0);
        set('left_hind_leg', 0);
        set('right_front_leg', 0);
        set('left_front_leg', 0);
      }
    }
    if (this.def.id === 'goat') {
      // a charging goat drops its head, which is what a ram looks like coming at you
      const head = parts.get('head');
      if (head) head.rotation.x = this.extra.ramming === true ? 0.6 : head.rotation.x;
    }
    if (this.def.id === 'turtle') {
      const belly = parts.get('eggbelly');
      if (belly) belly.visible = this.extra.hasEgg === true;
    }
    if (this.def.id === 'cat') {
      this.setTexture(catTexture(String(this.extra.variant ?? 'tabby')));
      const collar = parts.get('collar');
      if (collar) collar.visible = this.extra.tamed === true;
      if (this.extra.tamed === true && this.extra.sitting === true) {
        // vanilla sitting cat: hind legs folded forward, front legs upright, tail curled
        set('right_hind_leg', 1.4);
        set('left_hind_leg', 1.4);
        set('right_front_leg', -0.2);
        set('left_front_leg', -0.2);
      }
    }
    if (this.def.id === 'wolf') {
      const tamed = this.extra.tamed === true;
      const angry = this.target !== null && !tamed;
      const variant = String(this.extra.variant ?? 'pale');
      const baseName = variant === 'pale' ? 'wolf/wolf' : `wolf/wolf_${variant}`;
      this.setTexture(`${baseName}${tamed ? '_tame' : angry ? '_angry' : ''}.png`);
      const collar = parts.get('collar');
      if (collar) collar.visible = tamed;
      if (tamed && this.extra.sitting === true) {
        // vanilla sitting pose: body upright, hind legs folded, front legs straight down
        set('body', Math.PI / 2 - 0.9);
        set('right_hind_leg', 1.3);
        set('left_hind_leg', 1.3);
        set('right_front_leg', -0.35);
        set('left_front_leg', -0.35);
      }
    }
    // death fall-over
    const fall = this.dead ? Math.min(1, (this.deathTime + alpha) / 20) : 0;
    g.rotation.z = fall * (Math.PI / 2);
    if (fall > 0) g.position.y -= fall * 0.0;
    // brightness and hurt flash; sheep wool is tinted with the dye colour
    const bright = light;
    const flash = this.hurtTime > 0 || this.dead;
    if (!this.woolMaterials && (this.def.id === 'sheep' || this.def.id === 'wolf' || this.def.id === 'cat')) {
      const layer = entityTexture(this.base, this.def.id === 'sheep' ? 'sheep/sheep_wool.png' : this.def.id === 'cat' ? CAT_COLLAR_LAYER : 'wolf/wolf_collar.png');
      this.woolMaterials = this.model.materials.filter((m) => m.map === layer);
    }
    const dye = this.def.id === 'sheep' ? DYE_COLORS[String(this.extra.color ?? 'white')] ?? 0xffffff : this.def.id === 'wolf' || this.def.id === 'cat' ? DYE_COLORS[String(this.extra.collar ?? 'red')] ?? 0xff0000 : 0xffffff;
    for (const m of this.model.materials) {
      const tinted = this.woolMaterials?.includes(m);
      const tr = tinted ? ((dye >> 16) & 255) / 255 : 1, tg = tinted ? ((dye >> 8) & 255) / 255 : 1, tb = tinted ? (dye & 255) / 255 : 1;
      m.color.setRGB((flash ? 1 : bright) * tr, (flash ? bright * 0.5 : bright) * tg, (flash ? bright * 0.5 : bright) * tb);
    }
  }

  distanceTo(v: THREE.Vector3): number {
    return this.tmp.set(this.pos.x, this.pos.y + this.def.height / 2, this.pos.z).distanceTo(v);
  }

  save(): MobSave {
    return { type: this.def.id, x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, health: this.health, age: this.age, extra: this.extra };
  }

  restore(s: MobSave): void {
    this.yaw = this.bodyYaw = this.headYaw = s.yaw;
    this.health = s.health;
    this.age = s.age;
    if (s.extra) this.extra = s.extra as Record<string, number | boolean | string>;
  }
}

/** Signed shortest angle from a to b. */
export function shortAngle(a: number, b: number): number {
  return ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI;
}

export { blocks as _blocks };
