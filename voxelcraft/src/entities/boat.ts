/**
 * Boats and rafts. Vanilla's `Boat` floats on the water it is standing in, is steered by turning
 * rather than strafing, and slides to a stop on land. The model is read straight off the texture
 * net vanilla ships: a 28×16×3 floor with four walls around it and two paddles over the sides.
 */
import * as THREE from 'three';
import { blocks } from '../blocks/registry.ts';
import type { Slot } from '../items/inventory.ts';
import { buildModel, type BuiltModel, type ModelDef } from './boxModel.ts';

export type BoatKind = 'boat' | 'chest_boat';

/** The item id a boat of this wood and kind is: a bamboo one is a raft, everything else a boat. */
export function boatItemId(wood: string, chest: boolean): string {
  const raft = wood === 'bamboo';
  return `${wood}${chest ? '_chest' : ''}${raft ? '_raft' : '_boat'}`;
}

/** The wood and kind an item id names, or null when it is not a boat at all. */
export function boatItem(id: string): { wood: string; chest: boolean } | null {
  const m = /^([a-z_]+?)(_chest)?_(boat|raft)$/.exec(id);
  if (!m || !BOAT_WOODS.includes(m[1])) return null;
  return { wood: m[1], chest: !!m[2] };
}

/** The woods a boat can be made of, and the raft that is not a wood at all. */
export const BOAT_WOODS = ['oak', 'spruce', 'birch', 'jungle', 'acacia', 'cherry', 'dark_oak', 'pale_oak', 'mangrove', 'bamboo'];

/** How fast a boat may go, how hard a paddle pushes it and how quickly it rubs to a stop. */
export const BOAT_MAX_SPEED = 0.4;
export const BOAT_PADDLE_PUSH = 0.04;
export const BOAT_BACK_PUSH = 0.005;
export const BOAT_TURN = 1;
export const BOAT_WATER_FRICTION = 0.9;
export const BOAT_LAND_FRICTION = 0.5;
/** Where the oars rest, how far they lift and how far they sweep, from vanilla's own animation. */
export const PADDLE_REST = -0.65;
export const PADDLE_LIFT = 0.35;
export const PADDLE_SWEEP = Math.PI / 4;

/** How far above the water's surface a boat rides, and how hard it is pushed back up into it. */
export const BOAT_FLOAT = 0.35;
export const BOAT_BUOYANCY = 0.04;

export interface BoatWorld {
  getBlock(x: number, y: number, z: number): number;
}

const isWater = (w: BoatWorld, x: number, y: number, z: number): boolean => {
  const s = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return s !== 0 && blocks.blockOf(s).id === 'water';
};

const isSolid = (w: BoatWorld, x: number, y: number, z: number): boolean => {
  const s = w.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  return s !== 0 && blocks.blockOf(s).solid;
};

/** The boat's five planks and two paddles, in the layout its own texture is cut for. */
export function boatModel(wood: string, chest: boolean): ModelDef {
  const paddle = (uv: number): { uv: [number, number]; box: [number, number, number, number, number, number] }[] => [
    { uv: [62, uv], box: [-1, 0, -5, 2, 2, 18] },
    { uv: [62, uv], box: [-1, -3, 8, 1, 6, 7] },
  ];
  return {
    texture: `${chest ? 'chest_boat' : 'boat'}/${wood}.png`, texW: 128, texH: chest ? 128 : 64,
    parts: [
      { name: 'bottom', pivot: [0, 21, 1], rotation: [-Math.PI / 2, 0, 0], boxes: [{ uv: [0, 0], box: [-14, -9, -3, 28, 16, 3] }] },
      { name: 'back', pivot: [-15, 22, 4], rotation: [0, Math.PI / 2, 0], boxes: [{ uv: [0, 19], box: [-13, -7, -1, 18, 6, 2] }] },
      { name: 'front', pivot: [15, 22, 0], rotation: [0, -Math.PI / 2, 0], boxes: [{ uv: [0, 27], box: [-8, -7, -1, 16, 6, 2] }] },
      { name: 'right', pivot: [0, 22, -9], rotation: [0, -Math.PI, 0], boxes: [{ uv: [0, 35], box: [-14, -7, -1, 28, 6, 2] }] },
      { name: 'left', pivot: [0, 22, 9], boxes: [{ uv: [0, 43], box: [-14, -7, -1, 28, 6, 2] }] },
      { name: 'left_paddle', pivot: [3, 13, 9], boxes: paddle(0) },
      { name: 'right_paddle', pivot: [3, 13, -9], rotation: [0, -Math.PI, 0], boxes: paddle(20) },
      // the chest a chest boat carries, drawn where vanilla sits it in the hull
      // the chest a chest boat carries: a base, a lid on it and the latch, cut from the same sheet
      ...(chest ? [{
        name: 'chest', pivot: [0, 22, 0] as [number, number, number],
        boxes: [
          { uv: [0, 76] as [number, number], box: [-6, -8, -6, 12, 8, 12] as [number, number, number, number, number, number] },
          { uv: [0, 59] as [number, number], box: [-6, -13, -6, 12, 5, 12] as [number, number, number, number, number, number] },
          { uv: [0, 59] as [number, number], box: [-1, -12, -7, 2, 4, 1] as [number, number, number, number, number, number] },
        ],
      }] : []),
    ],
  };
}

export class Boat {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  prevYaw = 0;
  /** How fast it is turning, which vanilla carries between ticks so a turn eases in and out. */
  turn = 0;
  dead = false;
  ridden = false;
  /** Chest boats carry an inventory of their own. */
  items: Slot[] | null = null;
  /** Steering, set by the game while somebody is aboard. */
  control: { forward: number; turn: number } | null = null;
  /** Where the paddles are in their stroke, so they turn while the boat is being rowed. */
  paddle = 0;
  readonly model: BuiltModel;

  constructor(readonly kind: BoatKind, readonly wood: string, x: number, y: number, z: number, base: string) {
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    if (kind === 'chest_boat') this.items = new Array(27).fill(null);
    this.model = buildModel(boatModel(wood, kind === 'chest_boat'), base);
    this.model.group.position.copy(this.pos);
  }

  get mesh(): THREE.Object3D {
    return this.model.group;
  }

  /** Vanilla's box: a boat is a wide, shallow thing. */
  aabb(): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } {
    return {
      minX: this.pos.x - 0.6875, minY: this.pos.y, minZ: this.pos.z - 0.6875,
      maxX: this.pos.x + 0.6875, maxY: this.pos.y + 0.5625, maxZ: this.pos.z + 0.6875,
    };
  }

  tick(w: BoatWorld): void {
    this.prev.copy(this.pos);
    this.prevYaw = this.yaw;
    const floating = isWater(w, this.pos.x, this.pos.y + 0.1, this.pos.z);
    // a boat rides with its floor just under the surface, and is pushed back up when it sinks
    if (floating) {
      this.vel.y += BOAT_BUOYANCY;
      if (!isWater(w, this.pos.x, this.pos.y + BOAT_FLOAT, this.pos.z)) this.vel.y = Math.min(this.vel.y, 0);
      this.vel.y *= 0.7;
    } else {
      this.vel.y -= 0.04;
    }
    const c = this.control;
    if (c) {
      // vanilla steers a boat by turning it, and only then pushing it the way it points
      this.turn += c.turn * BOAT_TURN;
      this.yaw += (this.turn * Math.PI) / 180;
      const push = (c.forward > 0 ? BOAT_PADDLE_PUSH : 0) - (c.forward < 0 ? BOAT_BACK_PUSH : 0);
      if (push !== 0) {
        this.vel.x += -Math.sin(this.yaw) * push;
        this.vel.z += -Math.cos(this.yaw) * push;
      }
      if (c.forward !== 0 || c.turn !== 0) this.paddle += 0.4;
    }
    this.turn *= 0.7;
    const friction = floating ? BOAT_WATER_FRICTION : BOAT_LAND_FRICTION;
    this.vel.x *= friction;
    this.vel.z *= friction;
    const speed = Math.hypot(this.vel.x, this.vel.z);
    if (speed > BOAT_MAX_SPEED) {
      this.vel.x *= BOAT_MAX_SPEED / speed;
      this.vel.z *= BOAT_MAX_SPEED / speed;
    }
    // a boat stops dead against a wall rather than climbing it
    const nx = this.pos.x + this.vel.x;
    const nz = this.pos.z + this.vel.z;
    if (isSolid(w, nx, this.pos.y + 0.3, this.pos.z)) this.vel.x = 0;
    if (isSolid(w, this.pos.x, this.pos.y + 0.3, nz)) this.vel.z = 0;
    this.pos.x += this.vel.x;
    this.pos.z += this.vel.z;
    const ny = this.pos.y + this.vel.y;
    if (this.vel.y < 0 && isSolid(w, this.pos.x, ny, this.pos.z)) {
      this.pos.y = Math.floor(ny) + 1;
      this.vel.y = 0;
    } else {
      this.pos.y = ny;
    }
  }

  render(alpha: number): void {
    const g = this.model.group;
    g.position.set(
      this.prev.x + (this.pos.x - this.prev.x) * alpha,
      this.prev.y + (this.pos.y - this.prev.y) * alpha,
      this.prev.z + (this.pos.z - this.prev.z) * alpha,
    );
    // the model is built lying along x the way vanilla draws it, so the nose is turned to the front
    g.rotation.y = this.prevYaw + (this.yaw - this.prevYaw) * alpha - Math.PI / 2;
    // vanilla rests the oars between a radian and a third of one below level, and sweeps them
    const left = this.model.parts.get('left_paddle');
    const right = this.model.parts.get('right_paddle');
    const drop = PADDLE_REST + Math.sin(this.paddle) * PADDLE_LIFT;
    const sweep = Math.sin(this.paddle * 0.5) * PADDLE_SWEEP;
    if (left) {
      left.rotation.x = drop;
      left.rotation.y = sweep;
    }
    if (right) {
      right.rotation.x = drop;
      right.rotation.y = Math.PI - sweep;
    }
  }
}
