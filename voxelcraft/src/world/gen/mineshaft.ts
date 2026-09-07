/**
 * Abandoned mineshafts, built the way vanilla's `MineshaftPieces` builds them: a room, then a walk
 * of corridors, crossings and stairs branching out of it up to eight pieces deep and 80 blocks from
 * the start.
 *
 * The walk happens once per start and is cached by the generator; the blocks of a piece are then
 * written per chunk, so every decision inside a piece is hashed from the block's own position
 * rather than drawn in order. That way a corridor looks the same however its chunks are visited.
 */
import { blocks } from '../../blocks/registry.ts';
import { Rng, hashPos } from '../../core/rng.ts';
import type { BlockAccess } from './features.ts';
import type { ClipBox } from './structures.ts';

export type ShaftKind = 'normal' | 'mesa';
export interface ShaftBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

export interface ShaftPiece {
  type: 'room' | 'corridor' | 'crossing' | 'stairs';
  box: ShaftBox;
  /** Direction the piece runs: 0 north, 1 east, 2 south, 3 west. */
  dir: number;
  /** Seed for the piece's own decisions, hashed together with each block position. */
  seed: number;
  /** Corridors: how many five-block sections, and what they carry. */
  sections?: number;
  rails?: boolean;
  spider?: boolean;
  /** Crossings: the tall kind with a second floor. */
  twoFloors?: boolean;
  /** Rooms: the openings their corridors leave in the wall. */
  entrances?: ShaftBox[];
}

/** North, east, south, west, as the piece walk uses them. */
const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const st = (id: string) => blocks.defaultState(id);

interface Palette { planks: number; fence: number }
const palettes: Record<ShaftKind, Palette> = {
  normal: { planks: st('oak_planks'), fence: st('oak_fence') },
  mesa: { planks: st('dark_oak_planks'), fence: st('dark_oak_fence') },
};

// cave air is what vanilla carves its shafts out of, so light and mobs treat them as cave, not sky
const CAVE_AIR = blocks.has('cave_air') ? st('cave_air') : blocks.AIR;
const COBWEB = st('cobweb');
const DIRT = st('dirt');
const RAIL_NS = blocks.stateWith('rail', { shape: 'north_south' });
const RAIL_EW = blocks.stateWith('rail', { shape: 'east_west' });
const SPAWNER = st('spawner');

const spanX = (b: ShaftBox) => b.x1 - b.x0 + 1;
const spanY = (b: ShaftBox) => b.y1 - b.y0 + 1;
const spanZ = (b: ShaftBox) => b.z1 - b.z0 + 1;

const overlaps = (a: ShaftBox, b: ShaftBox): boolean =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;

// -------------------------------------------------------------------------------------------
// The piece walk
// -------------------------------------------------------------------------------------------

/** A corridor of `sections` five-block runs, three wide and three tall, leaving (x,y,z). */
function corridorBox(x: number, y: number, z: number, dir: number, sections: number): ShaftBox {
  const len = sections * 5 - 1;
  return dir === 0 ? { x0: x, y0: y, z0: z - len, x1: x + 2, y1: y + 2, z1: z }
    : dir === 2 ? { x0: x, y0: y, z0: z, x1: x + 2, y1: y + 2, z1: z + len }
    : dir === 3 ? { x0: x - len, y0: y, z0: z, x1: x, y1: y + 2, z1: z + 2 }
    : { x0: x, y0: y, z0: z, x1: x + len, y1: y + 2, z1: z + 2 };
}

function crossingBox(x: number, y: number, z: number, dir: number, rng: Rng): { box: ShaftBox; twoFloors: boolean } {
  const twoFloors = rng.int(4) === 0;
  const h = twoFloors ? 6 : 2;
  const box = dir === 0 ? { x0: x - 1, y0: y, z0: z - 4, x1: x + 3, y1: y + h, z1: z }
    : dir === 2 ? { x0: x - 1, y0: y, z0: z, x1: x + 3, y1: y + h, z1: z + 4 }
    : dir === 3 ? { x0: x - 4, y0: y, z0: z - 1, x1: x, y1: y + h, z1: z + 3 }
    : { x0: x, y0: y, z0: z - 1, x1: x + 4, y1: y + h, z1: z + 3 };
  return { box, twoFloors };
}

function stairsBox(x: number, y: number, z: number, dir: number): ShaftBox {
  return dir === 0 ? { x0: x, y0: y - 5, z0: z - 8, x1: x + 2, y1: y + 2, z1: z }
    : dir === 2 ? { x0: x, y0: y - 5, z0: z, x1: x + 2, y1: y + 2, z1: z + 8 }
    : dir === 3 ? { x0: x - 8, y0: y - 5, z0: z, x1: x, y1: y + 2, z1: z + 2 }
    : { x0: x, y0: y - 5, z0: z, x1: x + 8, y1: y + 2, z1: z + 2 };
}

interface Walk {
  pieces: ShaftPiece[];
  rng: Rng;
  origin: ShaftBox;
}

/**
 * Vanilla's `createRandomShaftPiece`: mostly corridors, one crossing in five, stairs now and then.
 * `depth` is the depth of the piece this one hangs off; the walk stops nine pieces out.
 */
function addPiece(w: Walk, x: number, y: number, z: number, dir: number, depth: number): ShaftPiece | null {
  if (depth > 8) return null;
  // the walk is kept near the room it started from, so a chunk knows which starts can reach it
  if (Math.abs(x - w.origin.x0) > 80 || Math.abs(z - w.origin.z0) > 80) return null;
  const free = (box: ShaftBox) => !w.pieces.some((p) => overlaps(p.box, box));
  const roll = w.rng.int(100);
  let piece: ShaftPiece | null = null;
  if (roll >= 80) {
    const { box, twoFloors } = crossingBox(x, y, z, dir, w.rng);
    if (free(box)) piece = { type: 'crossing', box, dir, twoFloors, seed: w.rng.int(0x7fffffff) };
  } else if (roll >= 70) {
    const box = stairsBox(x, y, z, dir);
    if (free(box)) piece = { type: 'stairs', box, dir, seed: w.rng.int(0x7fffffff) };
  } else {
    // vanilla shortens a corridor a section at a time until it fits beside what is already there
    const seed = w.rng.int(0x7fffffff);
    const rails = w.rng.next() < 0.5;
    const spider = w.rng.next() < 0.1;
    for (let sections = w.rng.int(3) + 2; sections > 0; sections--) {
      const box = corridorBox(x, y, z, dir, sections);
      if (!free(box)) continue;
      piece = { type: 'corridor', box, dir, sections, seed, rails, spider };
      break;
    }
  }
  if (!piece) return null;
  w.pieces.push(piece);
  addChildren(w, piece, depth + 1);
  return piece;
}

/** Where a piece sends its own branches, following vanilla's `addChildren` for each kind. */
function addChildren(w: Walk, piece: ShaftPiece, depth: number): void {
  const b = piece.box;
  if (piece.type === 'corridor') {
    // the corridor carries on ahead, or turns to one side
    const turn = w.rng.int(4);
    const ahead = piece.dir;
    const y = b.y0 - 1 + w.rng.int(3);
    if (turn <= 1) {
      const x = ahead === 3 ? b.x0 - 1 : ahead === 1 ? b.x1 + 1 : b.x0;
      const z = ahead === 0 ? b.z0 - 1 : ahead === 2 ? b.z1 + 1 : b.z0;
      addPiece(w, x, y, z, ahead, depth);
    } else {
      const side = turn === 2 ? (ahead + 3) & 3 : (ahead + 1) & 3;
      const x = side === 3 ? b.x0 - 1 : side === 1 ? b.x1 + 1 : b.x0;
      const z = side === 0 ? b.z0 - 1 : side === 2 ? b.z1 + 1 : b.z0;
      addPiece(w, x, y, z, side, depth);
    }
    // and side passages every five blocks along it
    if (depth < 8) {
      const along = (piece.dir & 1) === 1 ? spanX(b) : spanZ(b);
      for (let d = 3; d + 3 <= along; d += 5) {
        const roll = w.rng.int(5);
        if (roll > 1) continue;
        if ((piece.dir & 1) === 1) {
          const x = b.x0 + d;
          addPiece(w, x, b.y0, roll === 0 ? b.z0 - 1 : b.z1 + 1, roll === 0 ? 0 : 2, depth + 1);
        } else {
          const z = b.z0 + d;
          addPiece(w, roll === 0 ? b.x0 - 1 : b.x1 + 1, b.y0, z, roll === 0 ? 3 : 1, depth + 1);
        }
      }
    }
    return;
  }
  if (piece.type === 'crossing') {
    // a crossing opens on the three sides it did not come from
    const back = (piece.dir + 2) & 3;
    for (const dir of [0, 1, 2, 3]) {
      if (dir === back) continue;
      const x = dir === 3 ? b.x0 - 1 : dir === 1 ? b.x1 + 1 : b.x0 + 1;
      const z = dir === 0 ? b.z0 - 1 : dir === 2 ? b.z1 + 1 : b.z0 + 1;
      addPiece(w, x, b.y0, z, dir, depth + 1);
      if (piece.twoFloors) addPiece(w, x, b.y0 + 3 + 1, z, dir, depth + 1);
    }
    return;
  }
  if (piece.type === 'stairs') {
    // stairs carry on at the level they reach
    const [dx, dz] = DIRS[piece.dir];
    const x = dx < 0 ? b.x0 - 1 : dx > 0 ? b.x1 + 1 : b.x0;
    const z = dz < 0 ? b.z0 - 1 : dz > 0 ? b.z1 + 1 : b.z0;
    addPiece(w, x, b.y0, z, piece.dir, depth + 1);
  }
}

/**
 * Builds a mineshaft: the room, then everything the walk reaches from it. The whole thing is then
 * moved down so its top sits at `topY`, which is how vanilla puts a mineshaft under the surface.
 */
export function assembleMineshaft(seed: number, cx: number, cz: number, topY: number): ShaftPiece[] {
  const rng = new Rng(seed);
  const x = cx * 16 + 2;
  const z = cz * 16 + 2;
  const room: ShaftPiece = {
    type: 'room',
    box: { x0: x, y0: 50, z0: z, x1: x + 7 + rng.int(6), y1: 54 + rng.int(6), z1: z + 7 + rng.int(6) },
    dir: 0,
    seed: rng.int(0x7fffffff),
    entrances: [],
  };
  const w: Walk = { pieces: [room], rng, origin: room.box };

  // corridors leave the room's four walls, spaced along each one
  const headroom = Math.max(1, spanY(room.box) - 4);
  const wall = (dir: number): void => {
    const along = (dir & 1) === 1 ? spanZ(room.box) : spanX(room.box);
    let d = 0;
    while (d < along) {
      d += rng.int(along);
      if (d + 3 > along) break;
      const y = room.box.y0 + rng.int(headroom) + 1;
      const px = dir === 3 ? room.box.x0 - 1 : dir === 1 ? room.box.x1 + 1 : room.box.x0 + d;
      const pz = dir === 0 ? room.box.z0 - 1 : dir === 2 ? room.box.z1 + 1 : room.box.z0 + d;
      const piece = addPiece(w, px, y, pz, dir, 0);
      if (piece) {
        const b = piece.box;
        room.entrances!.push(dir === 0 ? { x0: b.x0, y0: b.y0, z0: room.box.z0, x1: b.x1, y1: b.y1, z1: room.box.z0 + 1 }
          : dir === 2 ? { x0: b.x0, y0: b.y0, z0: room.box.z1 - 1, x1: b.x1, y1: b.y1, z1: room.box.z1 }
          : dir === 3 ? { x0: room.box.x0, y0: b.y0, z0: b.z0, x1: room.box.x0 + 1, y1: b.y1, z1: b.z1 }
          : { x0: room.box.x1 - 1, y0: b.y0, z0: b.z0, x1: room.box.x1, y1: b.y1, z1: b.z1 });
      }
      d += 4;
    }
  };
  for (const dir of [0, 2, 3, 1]) wall(dir);

  // drop the whole shaft to where it belongs underground
  let highest = -Infinity;
  for (const p of w.pieces) highest = Math.max(highest, p.box.y1);
  const shift = topY - highest;
  for (const p of w.pieces) {
    p.box.y0 += shift;
    p.box.y1 += shift;
    for (const e of p.entrances ?? []) { e.y0 += shift; e.y1 += shift; }
  }
  return w.pieces;
}

// -------------------------------------------------------------------------------------------
// Writing the blocks
// -------------------------------------------------------------------------------------------

interface Ctx {
  world: BlockAccess;
  clip: ClipBox;
  seed: number;
  palette: Palette;
}

const inClip = (c: Ctx, x: number, z: number) => x >= c.clip.x0 && x <= c.clip.x1 && z >= c.clip.z0 && z <= c.clip.z1;
const chance = (c: Ctx, x: number, y: number, z: number, p: number) => hashPos(c.seed, x, y, z) < p;

function set(c: Ctx, x: number, y: number, z: number, state: number): void {
  if (inClip(c, x, z)) c.world.set(x, y, z, state);
}

/** Vanilla's `generateBox`: shell in one block, interior in another, optionally only where solid. */
function fill(c: Ctx, b: ShaftBox, edge: number, inside: number, existingOnly = false): void {
  for (let x = Math.max(b.x0, c.clip.x0); x <= Math.min(b.x1, c.clip.x1); x++)
    for (let z = Math.max(b.z0, c.clip.z0); z <= Math.min(b.z1, c.clip.z1); z++)
      for (let y = b.y0; y <= b.y1; y++) {
        if (existingOnly && c.world.get(x, y, z) === blocks.AIR) continue;
        const shell = x === b.x0 || x === b.x1 || y === b.y0 || y === b.y1 || z === b.z0 || z === b.z1;
        c.world.set(x, y, z, shell ? edge : inside);
      }
}

/** Clears a box to cave air, leaving a share of the blocks where they are (vanilla's maybe-boxes). */
function clearSome(c: Ctx, b: ShaftBox, keep: number): void {
  for (let x = Math.max(b.x0, c.clip.x0); x <= Math.min(b.x1, c.clip.x1); x++)
    for (let z = Math.max(b.z0, c.clip.z0); z <= Math.min(b.z1, c.clip.z1); z++)
      for (let y = b.y0; y <= b.y1; y++) if (!chance(c, x, y, z, keep)) c.world.set(x, y, z, CAVE_AIR);
}

/** Fence posts either side with a beam across, and the odd torch on it, every five blocks. */
function support(c: Ctx, x: number, y: number, z: number, axis: 'x' | 'z'): void {
  const side = (n: number): [number, number] => (axis === 'z' ? [x + n, z] : [x, z + n]);
  for (const n of [-1, 1]) {
    const [px, pz] = side(n);
    // only hold the roof up where there is a roof to hold
    if (c.world.get(px, y + 3, pz) === blocks.AIR) continue;
    set(c, px, y, pz, c.palette.fence);
    set(c, px, y + 1, pz, c.palette.fence);
  }
  for (let n = -1; n <= 1; n++) {
    const [px, pz] = side(n);
    set(c, px, y + 2, pz, c.palette.planks);
  }
  if (chance(c, x, y, z, 0.1)) set(c, x, y + 1, z, blocks.AIR); // the odd broken support
}

/** Planks bridge the gaps a cave leaves under a corridor floor. */
function floorUnder(c: Ctx, b: ShaftBox, y: number): void {
  for (let x = Math.max(b.x0, c.clip.x0); x <= Math.min(b.x1, c.clip.x1); x++)
    for (let z = Math.max(b.z0, c.clip.z0); z <= Math.min(b.z1, c.clip.z1); z++) {
      const below = c.world.get(x, y, z);
      if (below !== blocks.AIR && below !== CAVE_AIR) continue;
      if (chance(c, x, y, z, 0.2)) continue; // vanilla leaves some of the floor missing
      c.world.set(x, y, z, c.palette.planks);
    }
}

const solid = (state: number): boolean => state !== blocks.AIR && state !== CAVE_AIR && !!blocks.stateOpaque[state];

/** Writes one piece of a mineshaft, clipped to the chunk being generated. */
export function fillShaftPiece(
  piece: ShaftPiece,
  kind: ShaftKind,
  world: BlockAccess,
  clip: ClipBox,
  onLoot?: (x: number, y: number, z: number, table: string) => void,
): void {
  const c: Ctx = { world, clip, seed: piece.seed, palette: palettes[kind] };
  const b = piece.box;
  if (piece.type === 'room') {
    fill(c, { ...b, y1: b.y0 }, DIRT, DIRT);
    fill(c, { ...b, y0: b.y0 + 1, y1: Math.min(b.y0 + 3, b.y1) }, CAVE_AIR, CAVE_AIR);
    for (const e of piece.entrances ?? []) fill(c, { ...e, y0: e.y1 - 2 }, CAVE_AIR, CAVE_AIR);
    // the ceiling is a dome, which is what makes a mineshaft room look hollowed out
    const cx = (b.x0 + b.x1) / 2;
    const cz = (b.z0 + b.z1) / 2;
    const rx = spanX(b) / 2;
    const rz = spanZ(b) / 2;
    const ry = b.y1 - (b.y0 + 4) + 1;
    for (let x = Math.max(b.x0, clip.x0); x <= Math.min(b.x1, clip.x1); x++)
      for (let z = Math.max(b.z0, clip.z0); z <= Math.min(b.z1, clip.z1); z++)
        for (let y = b.y0 + 4; y <= b.y1; y++) {
          const dx = (x - cx) / rx;
          const dz = (z - cz) / rz;
          const dy = (y - (b.y0 + 4)) / Math.max(1, ry);
          if (dx * dx + dz * dz + dy * dy <= 1.05) world.set(x, y, z, CAVE_AIR);
        }
    return;
  }
  if (piece.type === 'stairs') {
    // a flight down five blocks over eight, three wide, with a landing at either end
    const along = (piece.dir & 1) === 1 ? spanX(b) : spanZ(b);
    // the piece leaves its parent at the top, so the descent runs away from where it started
    const downhill = piece.dir === 1 || piece.dir === 2;
    for (let i = 0; i < along; i++) {
      const step = Math.min(5, Math.round((5 * (downhill ? i : along - 1 - i)) / (along - 1)));
      const floor = b.y1 - 2 - step;
      const seg = (piece.dir & 1) === 1
        ? { x0: b.x0 + i, y0: floor, z0: b.z0, x1: b.x0 + i, y1: floor + 2, z1: b.z1 }
        : { x0: b.x0, y0: floor, z0: b.z0 + i, x1: b.x1, y1: floor + 2, z1: b.z0 + i };
      fill(c, seg, CAVE_AIR, CAVE_AIR);
      // the steps themselves: planks under the walking line so the flight can be climbed
      const px = (piece.dir & 1) === 1 ? b.x0 + i : b.x0 + 1;
      const pz = (piece.dir & 1) === 1 ? b.z0 + 1 : b.z0 + i;
      if (c.world.get(px, floor - 1, pz) === blocks.AIR) set(c, px, floor - 1, pz, c.palette.planks);
    }
    return;
  }
  if (piece.type === 'crossing') {
    const floorTop = piece.twoFloors ? b.y0 + 2 : b.y1;
    fill(c, { x0: b.x0 + 1, y0: b.y0, z0: b.z0, x1: b.x1 - 1, y1: floorTop, z1: b.z1 }, CAVE_AIR, CAVE_AIR);
    fill(c, { x0: b.x0, y0: b.y0, z0: b.z0 + 1, x1: b.x1, y1: floorTop, z1: b.z1 - 1 }, CAVE_AIR, CAVE_AIR);
    if (piece.twoFloors) {
      fill(c, { x0: b.x0 + 1, y0: b.y1 - 2, z0: b.z0, x1: b.x1 - 1, y1: b.y1, z1: b.z1 }, CAVE_AIR, CAVE_AIR);
      fill(c, { x0: b.x0, y0: b.y1 - 2, z0: b.z0 + 1, x1: b.x1, y1: b.y1, z1: b.z1 - 1 }, CAVE_AIR, CAVE_AIR);
      fill(c, { x0: b.x0 + 1, y0: b.y0 + 3, z0: b.z0 + 1, x1: b.x1 - 1, y1: b.y0 + 3, z1: b.z1 - 1 }, CAVE_AIR, CAVE_AIR);
    }
    // a pillar in each corner holds the junction up
    for (const [px, pz] of [[b.x0 + 1, b.z0 + 1], [b.x0 + 1, b.z1 - 1], [b.x1 - 1, b.z0 + 1], [b.x1 - 1, b.z1 - 1]])
      for (let y = b.y0; y <= b.y1; y++) set(c, px, y, pz, c.palette.planks);
    floorUnder(c, { ...b, y0: b.y0 - 1, y1: b.y0 - 1 }, b.y0 - 1);
    return;
  }

  // corridor
  const axis: 'x' | 'z' = (piece.dir & 1) === 1 ? 'x' : 'z';
  const long = axis === 'x' ? spanX(b) : spanZ(b);
  fill(c, { ...b, y1: b.y0 + 1 }, CAVE_AIR, CAVE_AIR);
  clearSome(c, { ...b, y0: b.y1, y1: b.y1 }, 0.2); // the roof is only mostly cut away
  if (piece.spider) {
    for (let x = Math.max(b.x0, clip.x0); x <= Math.min(b.x1, clip.x1); x++)
      for (let z = Math.max(b.z0, clip.z0); z <= Math.min(b.z1, clip.z1); z++)
        for (let y = b.y0; y <= b.y0 + 1; y++) if (chance(c, x, y, z, 0.4)) world.set(x, y, z, COBWEB);
  }
  // supports every five blocks, with cobwebs and the odd chest beside them
  const midA = axis === 'x' ? b.z0 + 1 : b.x0 + 1;
  for (let i = 2; i < long; i += 5) {
    const sx = axis === 'x' ? b.x0 + i : midA;
    const sz = axis === 'x' ? midA : b.z0 + i;
    support(c, sx, b.y0, sz, axis);
    for (const [ox, oz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
      const wx = sx + (axis === 'x' ? oz : ox);
      const wz = sz + (axis === 'x' ? ox : oz);
      if (chance(c, wx, b.y1, wz, 0.1)) set(c, wx, b.y1, wz, COBWEB);
    }
    // vanilla hides a chest minecart in about one section in fifty; we set the chest on the floor
    for (const [dx, dz] of [[0, -1], [0, 1]]) {
      const px = sx + (axis === 'x' ? dz : dx);
      const pz = sz + (axis === 'x' ? dx : dz);
      if (!chance(c, px, b.y0, pz, 0.02)) continue;
      if (!inClip(c, px, pz) || !solid(world.get(px, b.y0 - 1, pz))) continue;
      world.set(px, b.y0, pz, blocks.stateWith('chest', { facing: axis === 'x' ? 'north' : 'east', type: 'single', waterlogged: 'false' }));
      onLoot?.(px, b.y0, pz, 'chests/abandoned_mineshaft');
    }
    // a spider corridor holds one cave spider spawner
    if (piece.spider && i === 2) {
      const px = axis === 'x' ? b.x0 + 2 : midA;
      const pz = axis === 'x' ? midA : b.z0 + 2;
      set(c, px, b.y0, pz, SPAWNER);
    }
  }
  floorUnder(c, { ...b, y0: b.y0 - 1, y1: b.y0 - 1 }, b.y0 - 1);
  if (piece.rails) {
    const rail = axis === 'x' ? RAIL_EW : RAIL_NS;
    for (let i = 0; i < long; i++) {
      const px = axis === 'x' ? b.x0 + i : midA;
      const pz = axis === 'x' ? midA : b.z0 + i;
      if (!inClip(c, px, pz) || !solid(world.get(px, b.y0 - 1, pz))) continue;
      if (chance(c, px, b.y0, pz, 0.25)) continue; // rails run in broken stretches
      world.set(px, b.y0, pz, rail);
    }
  }
}
