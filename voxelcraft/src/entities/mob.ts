/** Living mobs: physics, health, knockback, AI goal selection and box-model animation. */
import * as THREE from 'three';
import type { BlockSource } from './physics.ts';
import { aabbIntersects, boxesIn, isFluidAt, sweep, type AABB } from './physics.ts';
import { buildModel, entityTexture, type BuiltModel, type ModelDef } from './boxModel.ts';
import { DYE_COLORS } from '../ui/specialIcons.ts';
import type { ItemStack } from '../items/inventory.ts';
import { blocks } from '../blocks/registry.ts';
import { CAT_COLLAR_LAYER, HORSE_ARMOR_LAYER, HORSE_MARKING_LAYER, catTexture, horseArmorPoints, horseArmorTexture, horseCoatTexture, horseMarkingTexture } from './mobTypes.ts';

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
  model: ModelDef;
  /** Which model parts swing as limbs, arms and the head. */
  animation: 'biped' | 'quadruped' | 'creeper' | 'spider' | 'chicken' | 'slime' | 'fish' | 'phantom' | 'horse';
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
  /** Status effect applied to the player by a mob attack or arrow. */
  addPlayerEffect(id: string, ticks: number, amplifier?: number): void;
  /** Sets the player on fire (burning zombies pass their flames on). */
  ignitePlayer(ticks: number): void;
  playerHasEffect(id: string): boolean;
  /** Item id the player is holding, for goals that follow food (vanilla TemptGoal). */
  playerHolding(): string | null;
  playerHealth(): number;
  /** Witch splash potion: applies `effect` to the player within four blocks of where it lands. */
  throwPotion(from: THREE.Vector3, to: THREE.Vector3, effect: ArrowEffect, color: number): void;
  /** Living mobs within `range` blocks of a point. */
  mobsNear(x: number, y: number, z: number, range: number): Mob[];
  spawnMob(type: string, x: number, y: number, z: number, baby: boolean): Mob | null;
  dropItem(id: string, count: number, x: number, y: number, z: number): void;
  giveXp(amount: number, x: number, y: number, z: number): void;
  emitParticles(kind: 'heart' | 'poof' | 'angry', x: number, y: number, z: number, count: number, w: number, h: number): void;
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
  private woolMaterials: THREE.MeshBasicMaterial[] | null = null;
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
  hurt(amount: number, from: THREE.Vector3 | null, by: 'player' | 'other', knockback = 0.4): boolean {
    if (this.dead || this.invulnerable > 0) return false;
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
    if (this.dead) {
      if (++this.deathTime >= 20) this.removed = true;
      this.vel.set(0, 0, 0);
      this.applyGravityOnly(w);
      return;
    }
    this.inWater = isFluidAt(w, this.pos.x, this.pos.y + 0.2, this.pos.z, 'water');
    // sunlight
    if (this.def.burnsInSun && w.isDay() && !this.inWater && w.getSkyLight(Math.floor(this.pos.x), Math.floor(this.pos.y + this.def.eyeHeight), Math.floor(this.pos.z)) >= 15 && w.rng() < 0.8) this.fireTicks = Math.max(this.fireTicks, 160);
    if (this.fireTicks > 0) {
      this.fireTicks--;
      if (this.inWater) this.fireTicks = 0;
      else if (this.fireTicks % 20 === 0) this.hurt(1, null, 'other', 0);
      if (this.dead) return;
    }
    // lava
    if (isFluidAt(w, this.pos.x, this.pos.y + 0.2, this.pos.z, 'lava')) {
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
        accel = attr * attr * 2.2 * this.moveSpeed * (this.onGround || this.def.flying || (this.def.aquatic && this.inWater) ? 1 : 0.2);
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
    if (this.fireMesh) {
      this.fireMesh.parent?.remove(this.fireMesh);
      this.fireMesh.geometry.dispose();
      this.fireMesh = null;
    }
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
