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

/** How long vanilla takes to freeze someone solid in powder snow. */
export const FREEZE_TICKS = 140;

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
  /** True while the player is inside powder snow, which they sink through and freeze in. */
  inPowderSnow = false;
  /** Ticks of freezing built up in powder snow; vanilla starts hurting at a hundred and forty. */
  frozenTicks = 0;
  /** True while the elytra is carrying the player, which is a movement mode of its own. */
  gliding = false;
  /** Ticks spent gliding since the last time the elytra was charged for its wear. */
  glideTicks = 0;
  /** Speed lost running into something while gliding, which the game turns into damage. */
  kinetic = 0;
  /** Ticks left of a firework's push, and the direction it was lit in. */
  boostTicks = 0;
  inWater = false;
  inLava = false;
  /** Whether the last move ran into something sideways; a swimmer uses it to climb out. */
  horizontalCollision = false;
  gamemode: GameMode = 'survival';
  health = 20;
  /** Twenty, plus four a level of health boost. */
  maxHealth = 20;
  /** Multipliers the worn gear sets: depth strider, swift sneak and soul speed. */
  waterSpeed = 1;
  sneakSpeed = 1;
  soulSpeed = 1;
  /** Extra ticks of breath from respiration, and whether mining underwater is unhindered. */
  extraBreath = 0;
  aquaAffinity = false;
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
    // powder snow: a walker sinks into it and freezes, unless they are wearing leather
    const snowAt = (y: number) => {
      const s = world.getBlock(Math.floor(feet.x), Math.floor(y), Math.floor(feet.z));
      return s !== 0 && blocks.blockOf(s).id === 'powder_snow';
    };
    this.inPowderSnow = snowAt(feet.y + 0.4) || snowAt(feet.y + 1.2);
    if (this.inPowderSnow) this.fireTicks = 0;
    // vanilla freezes over two and a half minutes in it, and thaws twice as fast out of it
    if (this.inPowderSnow && !this.wearsLeather()) this.frozenTicks = Math.min(FREEZE_TICKS + 40, this.frozenTicks + 1);
    else this.frozenTicks = Math.max(0, this.frozenTicks - 2);
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

    // vanilla starts a glide on a jump press in the air and ends it on landing, in water, or when
    // there is nothing left of the elytra to fly with
    if (input.tickPressed('jump') && !this.onGround && !this.flying && !this.gliding && !this.inWater && !this.inLava && this.canGlide()) {
      this.gliding = true;
      this.glideTicks = 0;
    }
    if (this.gliding && (this.onGround || this.inWater || this.inLava || this.flying || !this.canGlide())) this.gliding = false;
    if (this.gliding) {
      this.glide(world);
      return;
    }

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
      // depth strider both pushes harder and lets the water drag less, as vanilla speeds a swimmer
      const speed = 0.02 * (this.sprinting ? 1.3 : 1) * this.waterSpeed;
      const drag = 0.8 + (this.waterSpeed - 1) * 0.06;
      this.vel.x += wx * speed;
      this.vel.z += wz * speed;
      if (jump) this.vel.y += 0.04;
      const yBefore = this.pos.y;
      this.move(world, 0);
      this.vel.x *= Math.min(0.95, drag);
      this.vel.z *= Math.min(0.95, drag);
      this.vel.y *= 0.8;
      this.vel.y -= 0.02;
      // vanilla's way out of a fluid: a swimmer pressed against a ledge is lifted at 0.3 as long as
      // the box would clear 0.6 above where this tick started, which is what carries the player onto
      // the bank. Without it the only way up was a jump from the bottom, so deep water was a trap.
      const clears = this.fitsAt(world, this.pos.x + this.vel.x, yBefore + 0.6 + this.vel.y, this.pos.z + this.vel.z);
      if (this.horizontalCollision && clears) this.vel.y = 0.3;
      else if (this.onGround && jump && !eyeInWater) this.vel.y = 0.3;
      this.fallDistance = 0;
      return;
    }

    let speed = this.onGround ? 0.1 : 0.02;
    if (this.inPowderSnow) speed *= 0.4; // wading through it is slow going
    if (this.sprinting) speed *= 1.3;
    if (this.sneaking) speed *= 0.3 * this.sneakSpeed;
    speed *= speedMultiplier(this.effects) * this.soulSpeed;
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
    const yBefore = this.pos.y;
    this.move(world, this.onGround ? 0.6 : 0);
    // the drop is measured off the ground actually covered, and the tick that lands still fell:
    // counting the velocity instead threw away that last part and left every fall a block short
    const dropped = Math.max(0, yBefore - this.pos.y);
    if (this.onGround && !wasOnGround) {
      this.landed = this.fallDistance + dropped;
      this.fallDistance = 0;
    } else if (!this.onGround) {
      this.fallDistance += dropped;
      if (this.effects.level('slow_falling') > 0) this.fallDistance = 0; // vanilla cancels the fall outright
    } else this.fallDistance = 0;
    // slow falling swaps vanilla's gravity for 0.01 while the player is on the way down
    const slowFalling = this.effects.level('slow_falling') > 0 && this.vel.y <= 0;
    this.vel.y -= slowFalling ? 0.01 : 0.08;
    this.vel.y *= 0.98;
    // powder snow catches a fall: vanilla lets nobody drop through it faster than this
    if (this.inPowderSnow) {
      if (this.vel.y < -0.15) this.vel.y = -0.15;
      this.fallDistance = 0;
    }
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

  /**
   * Vanilla lets leather boots carry a walker over powder snow, and sneaking drop them into it.
   * Nothing else in the game treats the block as solid, so the footing is put on here, for the one
   * who is walking, by handing the collision a solid block where the snow is.
   */
  private snowFooting(world: BlockSource): BlockSource {
    if (this.sneaking || this.inventory.armor[0]?.id !== 'leather_boots') return world;
    const solid = blocks.defaultState('snow_block');
    return {
      getBlock: (x: number, y: number, z: number) => {
        const s = world.getBlock(x, y, z);
        return s !== 0 && blocks.blockOf(s).id === 'powder_snow' ? solid : s;
      },
    };
  }

  /** Any leather armour keeps the cold out, which is vanilla's rule for freezing. */
  wearsLeather(): boolean {
    return this.inventory.armor.some((s) => s?.id.startsWith('leather_'));
  }

  /** Whether there is an elytra on the player's back with any wear left in it. */
  canGlide(): boolean {
    const chest = this.inventory.armor[2];
    if (!chest || chest.id !== 'elytra') return false;
    const def = items.byId.get('elytra');
    return !def?.durability || (chest.damage ?? 0) < def.durability - 1;
  }

  /**
   * Vanilla's fall flying, transcribed: gravity is cut by how flat the wings are held, a dive is
   * turned back into forward speed, pulling up trades speed for height, and the whole thing is
   * pulled gently toward wherever the player is looking.
   */
  private glide(world: BlockSource): void {
    this.glideTicks++;
    const look = this.lookDirection();
    const flat = Math.hypot(look.x, look.z);
    const speed = Math.hypot(this.vel.x, this.vel.z);
    const v = this.vel;
    // how much of gravity the wings hold up, from the pitch they are held at
    let lift = Math.cos(this.pitch);
    lift = lift * lift * Math.min(1, look.length() / 0.4);
    v.y += 0.08 * (-1 + lift * 0.75);
    if (v.y < 0 && flat > 0) {
      // a dive turns falling into speed along the line of sight
      const d = v.y * -0.1 * lift;
      v.x += (look.x * d) / flat;
      v.y += d;
      v.z += (look.z * d) / flat;
    }
    if (this.pitch > 0 && flat > 0) {
      // and pulling up trades that speed back for height
      const d = speed * Math.sin(this.pitch) * 0.04;
      v.x -= (look.x * d) / flat;
      v.y += d * 3.2;
      v.z -= (look.z * d) / flat;
    }
    if (flat > 0) {
      v.x += ((look.x / flat) * speed - v.x) * 0.1;
      v.z += ((look.z / flat) * speed - v.z) * 0.1;
    }
    // a lit firework pushes along the line of sight for as long as it burns
    if (this.boostTicks > 0) {
      this.boostTicks--;
      v.x += look.x * 0.1 + (look.x * 1.5 - v.x) * 0.5;
      v.y += look.y * 0.1 + (look.y * 1.5 - v.y) * 0.5;
      v.z += look.z * 0.1 + (look.z * 1.5 - v.z) * 0.5;
    }
    v.x *= 0.99;
    v.y *= 0.98;
    v.z *= 0.99;
    const before = Math.hypot(v.x, v.z);
    this.move(world, 0);
    // running into something at speed hurts, as vanilla's kinetic damage does
    const after = Math.hypot(this.vel.x, this.vel.z);
    if (before - after > 0.3) this.kinetic = Math.max(this.kinetic, (before - after) * 10 - 3);
    this.fallDistance = 0;
  }

  private move(source: BlockSource, stepHeight: number): void {
    const world = this.snowFooting(source);
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
    this.horizontalCollision = r.hitX || r.hitZ;
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
