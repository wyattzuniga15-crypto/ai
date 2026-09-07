/**
 * Minecarts. Vanilla's `AbstractMinecart.moveAlongTrack` snaps a cart to the line of the rail under
 * it, lets slopes pull it and powered rails push it, and rubs its speed away everywhere else. This
 * is that, at the level of detail the rest of the game is written to.
 */
import * as THREE from 'three';
import { blocks } from '../blocks/registry.ts';
import type { Slot } from '../items/inventory.ts';
import { boxGeometry, entityTexture, type BoxDef } from './boxModel.ts';

export type CartKind = 'minecart' | 'chest_minecart' | 'furnace_minecart' | 'tnt_minecart' | 'hopper_minecart';

export interface CartWorld {
  getBlock(x: number, y: number, z: number): number;
}

/** Vanilla's speeds: a cart tops out at 0.4 blocks a tick, and a powered rail adds this much. */
const MAX_SPEED = 0.4;
const PUSH = 0.06;
const FRICTION = 0.997;
const SLOPE_PULL = 0.0078125;
/** The nudge a powered rail gives a cart that is standing still against a block. */
const START_PUSH = 0.02;

/** The two ends a rail shape joins, as unit steps in x and z. */
const SHAPE_ENDS: Record<string, [[number, number], [number, number]]> = {
  north_south: [[0, -1], [0, 1]],
  east_west: [[-1, 0], [1, 0]],
  ascending_north: [[0, -1], [0, 1]],
  ascending_south: [[0, -1], [0, 1]],
  ascending_east: [[-1, 0], [1, 0]],
  ascending_west: [[-1, 0], [1, 0]],
  north_east: [[0, -1], [1, 0]],
  north_west: [[0, -1], [-1, 0]],
  south_east: [[0, 1], [1, 0]],
  south_west: [[0, 1], [-1, 0]],
};

/** Which way a slope climbs, so the cart is pulled the other way. */
const ASCENDING: Record<string, [number, number]> = {
  ascending_north: [0, -1], ascending_south: [0, 1], ascending_east: [1, 0], ascending_west: [-1, 0],
};

const idOf = (state: number) => (state === 0 ? 'air' : blocks.blockOf(state).id);
const isRailId = (id: string) => id === 'rail' || id === 'powered_rail' || id === 'detector_rail' || id === 'activator_rail';

export class Minecart {
  readonly pos = new THREE.Vector3();
  readonly prev = new THREE.Vector3();
  readonly vel = new THREE.Vector3();
  yaw = 0;
  dead = false;
  /** Chest carts carry an inventory of their own. */
  items: Slot[] | null = null;
  /** Set while a player is riding. */
  ridden = false;
  /** A TNT cart lights when it runs over an activator rail. */
  fuse = -1;

  constructor(readonly kind: CartKind, x: number, y: number, z: number, readonly mesh: THREE.Object3D) {
    this.pos.set(x, y, z);
    this.prev.copy(this.pos);
    if (kind === 'chest_minecart' || kind === 'hopper_minecart') this.items = new Array(kind === 'hopper_minecart' ? 5 : 27).fill(null);
    mesh.position.copy(this.pos);
  }

  /** The rail the cart is standing on, or null when it has run off the end of the track. */
  private railAt(w: CartWorld): { x: number; y: number; z: number; shape: string; id: string } | null {
    const bx = Math.floor(this.pos.x);
    const bz = Math.floor(this.pos.z);
    for (const by of [Math.floor(this.pos.y), Math.floor(this.pos.y) - 1]) {
      const state = w.getBlock(bx, by, bz);
      const id = idOf(state);
      if (!isRailId(id)) continue;
      return { x: bx, y: by, z: bz, shape: blocks.prop(state, 'shape') ?? 'north_south', id };
    }
    return null;
  }

  tick(w: CartWorld, push = 0): void {
    this.prev.copy(this.pos);
    const rail = this.railAt(w);
    if (!rail) {
      // off the track it simply falls, and drags to a stop on the ground
      this.vel.y -= 0.04;
      this.vel.x *= 0.95;
      this.vel.z *= 0.95;
      const below = w.getBlock(Math.floor(this.pos.x), Math.floor(this.pos.y - 0.1), Math.floor(this.pos.z));
      if (below !== 0 && blocks.blockOf(below).solid && this.vel.y < 0) {
        this.vel.y = 0;
        this.pos.y = Math.floor(this.pos.y - 0.1) + 1;
      }
      this.pos.add(this.vel);
      this.updateYaw();
      return;
    }

    const ends = SHAPE_ENDS[rail.shape] ?? SHAPE_ENDS.north_south;
    // the line the rail runs along, taken from the two ends it joins
    const axis = new THREE.Vector3(ends[1][0] - ends[0][0], 0, ends[1][1] - ends[0][1]).normalize();
    let speed = this.vel.x * axis.x + this.vel.z * axis.z;

    // a powered rail pushes a moving cart along and stops a still one; a slope pulls it downhill
    if (rail.id === 'powered_rail') {
      const state = w.getBlock(rail.x, rail.y, rail.z);
      if (blocks.prop(state, 'powered') === 'true') {
        if (Math.abs(speed) > 0.01) speed += Math.sign(speed) * PUSH;
        else {
          // vanilla starts a still cart by shoving it away from a solid block at one end of the rail
          const solid = (e: [number, number]) => {
            const at = w.getBlock(rail.x + e[0], rail.y, rail.z + e[1]);
            return at !== 0 && blocks.blockOf(at).solid;
          };
          if (solid(ends[0]) && !solid(ends[1])) speed = START_PUSH;
          else if (solid(ends[1]) && !solid(ends[0])) speed = -START_PUSH;
        }
      } else speed *= 0.5;
    }
    const slope = ASCENDING[rail.shape];
    if (slope) {
      const downhill = -(slope[0] * axis.x + slope[1] * axis.z);
      speed += downhill * SLOPE_PULL * 8;
    }
    speed += push;
    speed *= FRICTION;
    if (Math.abs(speed) > MAX_SPEED) speed = Math.sign(speed) * MAX_SPEED;
    if (Math.abs(speed) < 0.001) speed = 0;

    // move along the rail, keeping to the middle of it and climbing where it rises
    const next = new THREE.Vector3(this.pos.x + axis.x * speed, this.pos.y, this.pos.z + axis.z * speed);
    const centreX = rail.x + 0.5;
    const centreZ = rail.z + 0.5;
    if (axis.x === 0) next.x = centreX;
    if (axis.z === 0) next.z = centreZ;
    next.y = rail.y + (slope ? Math.max(0, Math.min(1, ((next.x - rail.x) * slope[0] + (next.z - rail.z) * slope[1]))) : 0) + 0.1;
    this.pos.copy(next);
    this.vel.set(axis.x * speed, 0, axis.z * speed);
    this.updateYaw();

    if (rail.id === 'activator_rail' && this.kind === 'tnt_minecart' && this.fuse < 0
      && blocks.prop(w.getBlock(rail.x, rail.y, rail.z), 'powered') === 'true') this.fuse = 80;
    if (this.fuse > 0) this.fuse--;
  }

  private updateYaw(): void {
    if (Math.abs(this.vel.x) + Math.abs(this.vel.z) > 0.001) this.yaw = Math.atan2(-this.vel.x, -this.vel.z);
  }

  updateMesh(alpha: number): void {
    this.mesh.position.copy(this.prev).lerp(this.pos, alpha);
    this.mesh.rotation.y = this.yaw;
  }
}

/** The item a cart drops when it is broken, and the item that places one. */
export const CART_ITEMS: Record<CartKind, string> = {
  minecart: 'minecart',
  chest_minecart: 'chest_minecart',
  furnace_minecart: 'furnace_minecart',
  tnt_minecart: 'tnt_minecart',
  hopper_minecart: 'hopper_minecart',
};

export const cartKindFor = (itemId: string): CartKind | null =>
  (Object.keys(CART_ITEMS) as CartKind[]).find((k) => CART_ITEMS[k] === itemId) ?? null;


/** The block a loaded cart carries, which vanilla draws sitting inside it. */
export const CART_BLOCKS: Partial<Record<CartKind, string>> = {
  chest_minecart: 'chest',
  furnace_minecart: 'furnace',
  tnt_minecart: 'tnt',
  hopper_minecart: 'hopper',
};

/**
 * The cart itself: vanilla's five boxes, a floor and four walls, on the minecart texture, with the
 * block a loaded cart carries set into it at three quarters size the way vanilla renders it.
 */
export function minecartMesh(base: string, contents?: THREE.Object3D | null): THREE.Group {
  const material = new THREE.MeshBasicMaterial({ map: entityTexture(base, 'minecart.png'), transparent: true, alphaTest: 0.1, side: THREE.DoubleSide });
  const body = new THREE.Group();
  const add = (def: BoxDef, pos: [number, number, number], rot: [number, number, number]): void => {
    const mesh = new THREE.Mesh(boxGeometry(def, 64, 32), material);
    mesh.position.set(pos[0], pos[1], pos[2]);
    mesh.rotation.set(rot[0], rot[1], rot[2]);
    body.add(mesh);
  };
  const wall: BoxDef = { uv: [0, 0], box: [-8, -9, -1, 16, 8, 2] };
  add({ uv: [0, 10], box: [-10, -8, -1, 20, 16, 2] }, [0, -4, 0], [Math.PI / 2, 0, 0]);
  add(wall, [9, -4, 0], [0, -Math.PI / 2, 0]);
  add(wall, [-9, -4, 0], [0, Math.PI / 2, 0]);
  add(wall, [0, -4, -7], [0, Math.PI, 0]);
  add(wall, [0, -4, 7], [0, 0, 0]);
  body.scale.setScalar(1 / 16);
  const group = new THREE.Group();
  group.add(body);
  if (contents) {
    contents.scale.setScalar(0.75);
    contents.position.set(-0.375, 0.06, -0.375);
    group.add(contents);
  }
  return group;
}
