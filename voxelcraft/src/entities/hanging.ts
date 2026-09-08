/**
 * The things that hang on a wall: paintings and item frames. Both attach to the face of a solid
 * block, take the room vanilla's own rules give them, and come off when the wall behind them goes.
 * A painting's size and where it sits on the block it was hung from are Mojang's: the picture grows
 * counter-clockwise and upward from the block that was clicked, and an even side pushes the middle
 * of it half a block that way.
 */
import * as THREE from 'three';
import paintingsJson from '../../data/paintings.json';

const textures = new Map<string, THREE.Texture>();

/** A picture off `textures/painting/`, which is its own folder rather than an entity one. */
export function paintingTexture(base: string, file: string): THREE.Texture {
  const key = `${base}${file}`;
  let tex = textures.get(key);
  if (!tex) {
    tex = new THREE.TextureLoader().load(`${base}textures/painting/${file}`);
    tex.magFilter = THREE.NearestFilter;
    tex.minFilter = THREE.NearestFilter;
    tex.colorSpace = THREE.SRGBColorSpace;
    textures.set(key, tex);
  }
  return tex;
}

export interface PaintingVariant {
  id: string;
  name: string;
  author: string;
  width: number;
  height: number;
  /** Vanilla's `placeable` tag: the four elemental pictures are only ever given by a command. */
  placeable: boolean;
}

export const PAINTINGS: PaintingVariant[] = paintingsJson as PaintingVariant[];
export const PAINTING_BY_ID = new Map(PAINTINGS.map((p) => [p.id, p]));

/** The four walls a picture can hang on, and the two more an item frame takes. */
export type Facing = 'north' | 'south' | 'west' | 'east' | 'up' | 'down';
export const WALL_FACINGS: Facing[] = ['north', 'south', 'west', 'east'];

/** Which way each facing points, in blocks. */
export const FACING_VEC: Record<Facing, [number, number, number]> = {
  north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};

/** Vanilla's counter-clockwise turn, which is the way a picture grows sideways. */
export const COUNTER_CLOCKWISE: Record<string, [number, number, number]> = {
  north: [-1, 0, 0], west: [0, 0, 1], south: [1, 0, 0], east: [0, 0, -1],
};

/** Where the run of blocks a picture covers starts, relative to the one that was clicked. */
export function hangingStart(size: number): number {
  // Java truncates toward zero here, so a one- or two-wide picture starts on the block itself
  return Math.trunc((size - 1) / -2) + 0;
}

/** How far the middle of the picture sits from the middle of that block: half a block on an even side. */
export function hangingOffset(size: number): number {
  return size % 2 === 0 ? 0.5 : 0;
}

/**
 * Vanilla's choice: of every picture that will hang there, keep the largest by area and take one of
 * those at random. Returns null when not even a one-by-one fits.
 */
export function choosePainting(fits: (v: PaintingVariant) => boolean, rng: () => number): PaintingVariant | null {
  const room = PAINTINGS.filter((p) => p.placeable && fits(p));
  if (!room.length) return null;
  const biggest = Math.max(...room.map((p) => p.width * p.height));
  const best = room.filter((p) => p.width * p.height === biggest);
  return best[Math.min(best.length - 1, Math.floor(rng() * best.length))];
}

/** The blocks a picture of this size covers, as offsets from the one it was hung on. */
export function hangingCells(width: number, height: number, facing: Facing): [number, number, number][] {
  const ccw = COUNTER_CLOCKWISE[facing];
  if (!ccw) return [[0, 0, 0]];
  const x0 = hangingStart(width);
  const y0 = hangingStart(height);
  const out: [number, number, number][] = [];
  for (let k = 0; k < width; k++) {
    for (let l = 0; l < height; l++) out.push([ccw[0] * (k + x0), l + y0, ccw[2] * (k + x0)]);
  }
  return out;
}

/** How far off the wall vanilla stands a hanging thing. */
export const HANGING_DEPTH = 0.46875;
/** The eight turns an item in a frame takes, and how far each one is. */
export const FRAME_ROTATIONS = 8;

export type HangingKind = 'painting' | 'item_frame' | 'glow_item_frame';

/** One hanging thing in the world: where it is, what it is, and what it is holding. */
export class Hanging {
  readonly group = new THREE.Group();
  dead = false;
  /** The block it is nailed to. */
  readonly wall = new THREE.Vector3();
  /** Which of a frame's eight turns the item inside is at. */
  rotation = 0;
  /** What a frame is holding. */
  item: import('../items/inventory.ts').ItemStack | null = null;
  private itemMesh: THREE.Object3D | null = null;

  constructor(readonly kind: HangingKind, readonly facing: Facing, x: number, y: number, z: number, readonly variant: PaintingVariant | null) {
    this.wall.set(x, y, z);
  }

  get width(): number {
    return this.variant?.width ?? 1;
  }

  get height(): number {
    return this.variant?.height ?? 1;
  }

  /** The middle of the thing in world space, off the face of the wall it is on. */
  center(): THREE.Vector3 {
    const f = FACING_VEC[this.facing];
    const ccw = COUNTER_CLOCKWISE[this.facing] ?? [0, 0, 0];
    const dx = hangingOffset(this.width);
    const dy = hangingOffset(this.height);
    return new THREE.Vector3(
      this.wall.x + 0.5 + f[0] * (0.5 + HANGING_DEPTH) + ccw[0] * dx,
      this.wall.y + 0.5 + f[1] * (0.5 + HANGING_DEPTH) + dy,
      this.wall.z + 0.5 + f[2] * (0.5 + HANGING_DEPTH) + ccw[2] * dx,
    );
  }

  /** The box a click has to land in to hit it. */
  aabb(): { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number } {
    const c = this.center();
    const flat = this.facing === 'up' || this.facing === 'down';
    const alongX = flat || this.facing === 'north' || this.facing === 'south';
    const hx = (alongX ? this.width : 0.1) / 2;
    const hz = (alongX ? 0.1 : this.width) / 2;
    const hy = (flat ? 0.1 : this.height) / 2;
    return { minX: c.x - hx, minY: c.y - hy, minZ: c.z - hz, maxX: c.x + hx, maxY: c.y + hy, maxZ: c.z + hz };
  }

  /** The item id this comes back as when it is knocked off the wall. */
  get itemId(): string {
    return this.kind === 'painting' ? 'painting' : this.kind;
  }

  /** Turns the group to face the way it hangs. */
  orient(): void {
    const yaw = this.facing === 'south' ? 0 : this.facing === 'west' ? Math.PI / 2 : this.facing === 'north' ? Math.PI : this.facing === 'east' ? -Math.PI / 2 : 0;
    this.group.rotation.set(0, yaw, 0);
    if (this.facing === 'up') this.group.rotation.x = -Math.PI / 2;
    if (this.facing === 'down') this.group.rotation.x = Math.PI / 2;
    this.group.position.copy(this.center());
  }

  /** Builds the picture: the painted front and the wooden back and edges vanilla shows behind it. */
  buildPainting(base: string): void {
    const v = this.variant;
    if (!v) return;
    const front = paintingTexture(base, `${v.id}.png`);
    const back = paintingTexture(base, 'back.png').clone();
    back.needsUpdate = true;
    back.wrapS = back.wrapT = THREE.RepeatWrapping;
    back.repeat.set(v.width, v.height);
    const face = new THREE.Mesh(new THREE.PlaneGeometry(v.width, v.height), new THREE.MeshBasicMaterial({ map: front, transparent: true, alphaTest: 0.1 }));
    face.position.z = 1 / 32;
    const body = new THREE.Mesh(new THREE.BoxGeometry(v.width, v.height, 1 / 16), new THREE.MeshBasicMaterial({ map: back }));
    this.group.add(body, face);
  }

  /** Hangs the item a frame is holding in the middle of it, turned to whichever of the eight it is at. */
  setItem(mesh: THREE.Object3D | null): void {
    if (this.itemMesh) {
      this.group.remove(this.itemMesh);
      this.itemMesh = null;
    }
    if (!mesh) return;
    this.itemMesh = mesh;
    this.group.add(mesh);
    this.turnItem();
  }

  turnItem(): void {
    if (!this.itemMesh) return;
    this.itemMesh.position.set(0, 0, 1 / 32);
    this.itemMesh.rotation.z = (-this.rotation * Math.PI * 2) / FRAME_ROTATIONS;
  }

  hasItem(): boolean {
    return !!this.itemMesh;
  }
}
