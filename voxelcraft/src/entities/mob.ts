/** Living mobs: physics, health, knockback, AI goal selection and box-model animation. */
import * as THREE from 'three';
import type { BlockSource } from './physics.ts';
import { aabbIntersects, boxesIn, isFluidAt, sweep, type AABB } from './physics.ts';
import { buildModel, type BuiltModel, type ModelDef } from './boxModel.ts';
import type { ItemStack } from '../items/inventory.ts';
import { blocks } from '../blocks/registry.ts';

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
  model: ModelDef;
  /** Which model parts swing as limbs, arms and the head. */
  animation: 'biped' | 'quadruped' | 'creeper' | 'spider' | 'chicken';
}

export interface MobWorld extends BlockSource {
  isDay(): boolean;
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
  skyDarken(): number;
  playerPos(): THREE.Vector3;
  playerEye(): THREE.Vector3;
  playerBox(): AABB;
  playerTargetable(): boolean;
  /** Deal damage to the player from a mob. */
  hurtPlayer(amount: number, from: THREE.Vector3): void;
  /** Spawn an arrow flying from `from` toward `to`. */
  shootArrow(from: THREE.Vector3, to: THREE.Vector3, velocity: number, damage: number): void;
  explode(x: number, y: number, z: number, power: number, source: Mob): void;
  lineOfSight(from: THREE.Vector3, to: THREE.Vector3): boolean;
  time: number;
  rng: () => number;
}

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

let nextId = 1;

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
  target: 'player' | null = null;
  attackCooldown = 0;
  lastHurtBy: 'player' | 'other' | null = null;
  lastHurtTime = -1000;
  /** Mob-specific state (creeper swelling, sheep wool...). */
  extra: Record<string, number | boolean | string> = {};
  readonly goals: Goal[];
  private active: Goal | null = null;
  readonly model: BuiltModel;
  private readonly tmp = new THREE.Vector3();
  /** Persistent mobs never despawn (named, bred, passive). */
  persistent: boolean;

  constructor(readonly def: MobStats, goals: Goal[], base: string, x: number, y: number, z: number) {
    this.health = def.health;
    this.goals = goals;
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    this.model = buildModel(def.model, base);
    this.model.group.position.copy(this.pos);
    this.persistent = def.disposition === 'passive';
  }

  get width(): number {
    return this.def.width;
  }

  get height(): number {
    return this.def.height;
  }

  aabb(pos = this.pos): AABB {
    const h = this.def.width / 2;
    return { minX: pos.x - h, minY: pos.y, minZ: pos.z - h, maxX: pos.x + h, maxY: pos.y + this.def.height, maxZ: pos.z + h };
  }

  eyePos(out = new THREE.Vector3()): THREE.Vector3 {
    return out.set(this.pos.x, this.pos.y + this.def.eyeHeight, this.pos.z);
  }

  /** Damage from any source; returns false when invulnerable. */
  hurt(amount: number, from: THREE.Vector3 | null, by: 'player' | 'other', knockback = 0.4): boolean {
    if (this.dead || this.invulnerable > 0) return false;
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
    this.selectGoal(w);
    this.active?.tick(this, w);
    this.moveTick(w);
    this.animateTick();
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
    const attr = this.def.speed;
    let accel = 0;
    let dirX = 0;
    let dirZ = 0;
    if (this.moveTarget) {
      const dx = this.moveTarget.x - this.pos.x;
      const dz = this.moveTarget.z - this.pos.z;
      const dist = Math.hypot(dx, dz);
      if (dist < 0.3 || --this.moveTimeout <= 0) this.moveTarget = null;
      else {
        dirX = dx / dist;
        dirZ = dz / dist;
        this.yaw = Math.atan2(-dirX, -dirZ);
        accel = attr * attr * 2.2 * this.moveSpeed * (this.onGround ? 1 : 0.2);
        if (this.inWater) accel *= 0.5;
      }
    }
    this.vel.x += dirX * accel;
    this.vel.z += dirZ * accel;
    if (this.inWater) {
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
    if (this.horizontalCollision && this.moveTarget) {
      if (this.def.climbs) this.vel.y = 0.2;
      else if (this.onGround) this.vel.y = 0.42;
    }
    if (!this.inWater) {
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

  /** Updates the Three.js model for rendering. */
  render(alpha: number, light: number): void {
    const g = this.model.group;
    g.position.copy(this.prev).lerp(this.pos, alpha);
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
    }
    // death fall-over
    const fall = this.dead ? Math.min(1, (this.deathTime + alpha) / 20) : 0;
    g.rotation.z = fall * (Math.PI / 2);
    if (fall > 0) g.position.y -= fall * 0.0;
    // brightness and hurt flash
    const bright = light;
    const r = this.hurtTime > 0 || this.dead ? 1 : bright;
    for (const m of this.model.materials) m.color.setRGB(r, this.hurtTime > 0 || this.dead ? bright * 0.5 : bright, this.hurtTime > 0 || this.dead ? bright * 0.5 : bright);
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
