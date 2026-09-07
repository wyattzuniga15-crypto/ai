/** First-person player: vanilla movement constants, survival stats, inventory. */
import * as THREE from 'three';
import { PLAYER_EYE_HEIGHT, PLAYER_HEIGHT, PLAYER_SNEAK_EYE_HEIGHT, PLAYER_SNEAK_HEIGHT, PLAYER_WIDTH } from '../core/constants.ts';
import type { Input } from '../core/input.ts';
import { Inventory, cloneStack, type Slot } from '../items/inventory.ts';
import { items } from '../items/registry.ts';
import { blocks } from '../blocks/registry.ts';
import { aabbIntersects, boxesIn, hasGroundBelow, isFluidAt, sweep, type AABB, type BlockSource } from './physics.ts';
import { EffectSet, speedMultiplier, type ActiveEffect } from './effects.ts';

export type GameMode = 'survival' | 'creative' | 'spectator';

export interface PlayerSave {
  timeSinceRest?: number;
  x: number; y: number; z: number; yaw: number; pitch: number;
  health: number; food: number; saturation: number; xp: number; xpLevel: number;
  gamemode: GameMode; flying: boolean; selected: number;
  inventory: ReturnType<Inventory['serialize']>;
  spawn?: [number, number, number];
  enderChest?: Slot[];
  effects?: ActiveEffect[];
}

export class Player {
  readonly pos = new THREE.Vector3();
  readonly prevPos = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  pitch = 0;
  onGround = false;
  sneaking = false;
  sprinting = false;
  flying = false;
  inWater = false;
  inLava = false;
  gamemode: GameMode = 'survival';
  health = 20;
  food = 20;
  saturation = 5;
  exhaustion = 0;
  air = 300;
  xp = 0;
  xpLevel = 0;
  fallDistance = 0;
  /** Ticks left burning (vanilla: 1 damage per 20 ticks, water puts it out). */
  fireTicks = 0;
  /** Ticks since the player last slept (vanilla TIME_SINCE_REST, drives phantom spawns). */
  timeSinceRest = 0;
  readonly inventory = new Inventory();
  /** Ender chest contents travel with the player. */
  enderChest: Slot[] = new Array(27).fill(null);
  readonly effects = new EffectSet();
  onLadder = false;
  /** Absorption hearts from effects. */
  absorption = 0;
  eyeHeight = PLAYER_EYE_HEIGHT;
  private eyeTarget = PLAYER_EYE_HEIGHT;
  private lastJumpPress = -1;
  private jumpCooldown = 0;
  private sprintDoubleTap = -1;
  spawn: [number, number, number] = [0, 80, 0];
  /** Set by the game when the player takes damage etc. */
  hurtTime = 0;
  dead = false;

  get width(): number {
    return PLAYER_WIDTH;
  }

  get height(): number {
    return this.sneaking && this.onGround ? PLAYER_SNEAK_HEIGHT : PLAYER_HEIGHT;
  }

  aabb(pos = this.pos): AABB {
    const h = this.width / 2;
    return { minX: pos.x - h, minY: pos.y, minZ: pos.z - h, maxX: pos.x + h, maxY: pos.y + this.height, maxZ: pos.z + h };
  }

  eyePosition(alpha: number, out = new THREE.Vector3()): THREE.Vector3 {
    out.copy(this.prevPos).lerp(this.pos, alpha);
    out.y += this.eyeHeight;
    return out;
  }

  lookDirection(out = new THREE.Vector3()): THREE.Vector3 {
    const cp = Math.cos(this.pitch);
    return out.set(-Math.sin(this.yaw) * cp, Math.sin(this.pitch), -Math.cos(this.yaw) * cp).normalize();
  }

  /** Horizontal facing direction index: 2 north, 3 south, 4 west, 5 east. */
  horizontalFacing(): number {
    const yaw = ((this.yaw % (Math.PI * 2)) + Math.PI * 2) % (Math.PI * 2);
    const deg = (yaw * 180) / Math.PI;
    if (deg >= 315 || deg < 45) return 2; // looking -z
    if (deg < 135) return 4; // -x
    if (deg < 225) return 3; // +z
    return 5;
  }

  teleport(x: number, y: number, z: number): void {
    this.pos.set(x, y, z);
    this.prevPos.copy(this.pos);
    this.vel.set(0, 0, 0);
    this.fallDistance = 0;
  }

  /** True while the player is a passenger on a mob. */
  riding = false;

  /** Whether the player's box fits at a position (used when stepping off a mount). */
  fitsAt(world: BlockSource, x: number, y: number, z: number): boolean {
    const h = PLAYER_WIDTH / 2;
    const box: AABB = { minX: x - h, minY: y, minZ: z - h, maxX: x + h, maxY: y + PLAYER_HEIGHT, maxZ: z + h };
    for (const b of boxesIn(world, box)) if (aabbIntersects(box, b)) return false;
    return true;
  }

  applyMouse(dx: number, dy: number, sensitivity: number): void {
    const s = sensitivity * 0.0022;
    this.yaw -= dx * s;
    this.pitch -= dy * s;
    const lim = Math.PI / 2 - 0.0001;
    if (this.pitch > lim) this.pitch = lim;
    if (this.pitch < -lim) this.pitch = -lim;
  }

  /** One 50 ms simulation step. */
  tick(input: Input, world: BlockSource, tickCount: number): void {
    this.prevPos.copy(this.pos);
    if (this.dead) return;
    if (this.riding) {
      // the mount owns the movement; the game seats the player after it has moved
      this.sprinting = false;
      this.sneaking = false;
      this.flying = false;
      this.vel.set(0, 0, 0);
      this.fallDistance = 0;
      this.eyeHeight += (PLAYER_EYE_HEIGHT - this.eyeHeight) * 0.5;
      return;
    }
    const forward = (input.isDown('forward') ? 1 : 0) - (input.isDown('back') ? 1 : 0);
    const strafe = (input.isDown('left') ? 1 : 0) - (input.isDown('right') ? 1 : 0);
    const jump = input.isDown('jump');
    const sneakKey = input.isDown('sneak');
    const creative = this.gamemode === 'creative' || this.gamemode === 'spectator';

    // fly toggle: double-tap jump in creative
    if (input.tickPressed('jump')) {
      if (creative && tickCount - this.lastJumpPress < 7 && tickCount - this.lastJumpPress > 0) {
        this.flying = !this.flying;
        this.lastJumpPress = -100;
      } else this.lastJumpPress = tickCount;
    }
    if (!creative) this.flying = false;

    // sprint: hold key or double-tap forward
    if (input.tickPressed('forward')) {
      if (tickCount - this.sprintDoubleTap < 7 && tickCount - this.sprintDoubleTap > 0) this.sprinting = true;
      this.sprintDoubleTap = tickCount;
    }
    if (input.isDown('sprint') && forward > 0 && (this.food > 6 || creative)) this.sprinting = true;
    if (forward <= 0 || (this.food <= 6 && !creative) || this.sneaking) this.sprinting = false;

    const wasSneaking = this.sneaking;
    this.sneaking = sneakKey && !this.flying;
    if (wasSneaking && !this.sneaking) {
      // stand up only when there is head room
      const tall = this.aabb();
      tall.maxY = tall.minY + PLAYER_HEIGHT;
      for (const b of boxesIn(world, tall)) if (aabbIntersects(tall, b)) { this.sneaking = true; break; }
    }
    this.eyeTarget = this.sneaking ? PLAYER_SNEAK_EYE_HEIGHT : PLAYER_EYE_HEIGHT;
    this.eyeHeight += (this.eyeTarget - this.eyeHeight) * 0.5;

    const feet = this.pos;
    this.inWater = isFluidAt(world, feet.x, feet.y + 0.4, feet.z, 'water') || isFluidAt(world, feet.x, feet.y + 1.2, feet.z, 'water');
    this.inLava = isFluidAt(world, feet.x, feet.y + 0.4, feet.z, 'lava');
    const eyeInWater = isFluidAt(world, feet.x, feet.y + this.eyeHeight, feet.z, 'water');
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    const climbAt = (y: number) => {
      const s = world.getBlock(Math.floor(feet.x), Math.floor(y), Math.floor(feet.z));
      return s !== 0 && blocks.blockOf(s).behavior === 'climbable';
    };
    this.onLadder = climbAt(feet.y + 0.1) || climbAt(feet.y + 1.0);

    // movement input relative to yaw
    let mx = strafe;
    let mz = forward;
    const len = Math.hypot(mx, mz);
    if (len > 1) {
      mx /= len;
      mz /= len;
    }
    const sin = Math.sin(this.yaw);
    const cos = Math.cos(this.yaw);
    // forward is -z at yaw 0; strafe left is -x
    const wx = -mx * cos - mz * sin;
    const wz = mx * sin - mz * cos;

    if (this.flying) {
      const speed = (this.sprinting ? 0.1 : 0.05) * 1.0;
      this.vel.x += wx * speed;
      this.vel.z += wz * speed;
      if (jump) this.vel.y += speed * 3;
      if (sneakKey) this.vel.y -= speed * 3;
      this.vel.y *= 0.6;
      this.move(world, 0);
      this.vel.x *= 0.91;
      this.vel.z *= 0.91;
      if (this.onGround && !jump) this.flying = false;
      this.fallDistance = 0;
      return;
    }

    if (this.inWater || this.inLava) {
      const speed = 0.02 * (this.sprinting ? 1.3 : 1);
      this.vel.x += wx * speed;
      this.vel.z += wz * speed;
      if (jump) this.vel.y += 0.04;
      this.move(world, 0);
      this.vel.x *= 0.8;
      this.vel.z *= 0.8;
      this.vel.y *= 0.8;
      this.vel.y -= 0.02;
      if (this.onGround && jump && !eyeInWater) this.vel.y = 0.3;
      this.fallDistance = 0;
      return;
    }

    let speed = this.onGround ? 0.1 : 0.02;
    if (this.sprinting) speed *= 1.3;
    if (this.sneaking) speed *= 0.3;
    speed *= speedMultiplier(this.effects);
    if (this.onGround) {
      const friction = 0.6 * 0.91; // default block slipperiness
      speed = speed * (0.16277136 / (friction * friction * friction));
    }
    this.vel.x += wx * speed;
    this.vel.z += wz * speed;
    if (this.onLadder) {
      // ladders: slow slide, climb when pushing into them or jumping, hold still while sneaking
      if (this.vel.y < -0.15) this.vel.y = -0.15;
      if (forward !== 0 || strafe !== 0 || jump) this.vel.y = 0.2;
      else if (this.sneaking) this.vel.y = 0;
      this.fallDistance = 0;
    }
    if (jump && this.onGround && this.jumpCooldown === 0) {
      this.vel.y = 0.42 + 0.1 * this.effects.level('jump_boost');
      if (this.sprinting) {
        this.vel.x += -sin * 0.2;
        this.vel.z += -cos * 0.2;
      }
      this.jumpCooldown = 10;
      this.exhaustion += this.sprinting ? 0.2 : 0.05;
    }
    const wasOnGround = this.onGround;
    this.move(world, this.onGround ? 0.6 : 0);
    if (this.onGround && !wasOnGround) {
      // landing
      this.landed = this.fallDistance;
      this.fallDistance = 0;
    } else if (!this.onGround) {
      if (this.vel.y < 0) this.fallDistance -= this.vel.y;
    } else this.fallDistance = 0;
    this.vel.y -= 0.08;
    this.vel.y *= 0.98;
    const friction = this.onGround ? 0.6 * 0.91 : 0.91;
    this.vel.x *= friction;
    this.vel.z *= friction;
    if (Math.abs(this.vel.x) < 0.003) this.vel.x = 0;
    if (Math.abs(this.vel.z) < 0.003) this.vel.z = 0;
    if (Math.abs(this.vel.y) < 0.003) this.vel.y = 0;
    if (this.sprinting && this.onGround) this.exhaustion += 0.1 * Math.hypot(this.vel.x, this.vel.z);
  }

  /** Fall distance at the moment of the last landing, consumed by the game for fall damage. */
  landed = 0;

  private move(world: BlockSource, stepHeight: number): void {
    const box = this.aabb();
    let dx = this.vel.x;
    let dz = this.vel.z;
    // sneaking keeps the player from walking off edges
    if (this.sneaking && this.onGround) {
      const probeX: AABB = { ...box, minX: box.minX + dx, maxX: box.maxX + dx };
      if (!hasGroundBelow(world, probeX)) {
        dx = 0;
        this.vel.x = 0;
      }
      const probeZ: AABB = { ...box, minX: box.minX + dx, maxX: box.maxX + dx, minZ: box.minZ + dz, maxZ: box.maxZ + dz };
      if (!hasGroundBelow(world, probeZ)) {
        dz = 0;
        this.vel.z = 0;
      }
    }
    const r = sweep(world, box, dx, this.vel.y, dz, stepHeight);
    this.pos.set((box.minX + box.maxX) / 2, box.minY, (box.minZ + box.maxZ) / 2);
    this.onGround = r.onGround === 1 || (r.hitY && this.vel.y < 0);
    if (r.hitY) this.vel.y = 0;
    if (r.hitX) this.vel.x = 0;
    if (r.hitZ) this.vel.z = 0;
    if (r.hitX || r.hitZ) this.sprinting = this.sprinting && !(r.hitX && r.hitZ);
  }

  /** Whether a block placed at the given boxes would intersect the player. */
  intersectsBoxes(boxes: number[][]): boolean {
    const a = this.aabb();
    for (const b of boxes) if (aabbIntersects(a, b)) return true;
    return false;
  }

  heldItem() {
    return this.inventory.hotbar[this.inventory.selected];
  }

  serialize(): PlayerSave {
    return {
      x: this.pos.x, y: this.pos.y, z: this.pos.z, yaw: this.yaw, pitch: this.pitch,
      health: this.health, food: this.food, saturation: this.saturation, xp: this.xp, xpLevel: this.xpLevel,
      gamemode: this.gamemode, flying: this.flying, selected: this.inventory.selected,
      inventory: this.inventory.serialize(), spawn: this.spawn,
      timeSinceRest: this.timeSinceRest,
      enderChest: this.enderChest.map((s) => (s ? cloneStack(s) : null)),
      effects: this.effects.serialize(),
    };
  }

  restore(s: PlayerSave): void {
    this.teleport(s.x, s.y, s.z);
    this.yaw = s.yaw;
    this.pitch = s.pitch;
    this.health = s.health;
    this.food = s.food;
    this.saturation = s.saturation;
    this.xp = s.xp ?? 0;
    this.xpLevel = s.xpLevel ?? 0;
    this.gamemode = s.gamemode;
    this.flying = s.flying;
    this.inventory.selected = s.selected;
    this.inventory.restore(s.inventory);
    this.timeSinceRest = s.timeSinceRest ?? 0;
    if (s.spawn) this.spawn = s.spawn;
    if (s.enderChest) this.enderChest = Array.from({ length: 27 }, (_, i) => (s.enderChest![i] && items.has(s.enderChest![i]!.id) ? cloneStack(s.enderChest![i]!) : null));
    this.effects.restore(s.effects);
    this.dead = this.health <= 0;
  }
}

export { blocks as _blocks };
