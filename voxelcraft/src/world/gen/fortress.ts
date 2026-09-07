/**
 * Nether fortresses, built the way vanilla's `NetherFortressPieces` builds them: a bridge crossing
 * to start with, then a walk of bridges, corridors, stairs and rooms growing out of it, all of
 * nether brick, with the blaze spawner and the nether wart the fortress is worth the trip for.
 *
 * The walk happens once per start and is cached; a piece's blocks are then written per chunk, so a
 * corridor comes out the same however its chunks are visited. The plan is ours — vanilla's own is a
 * weighted piece table with connection rules and no data behind it — but every piece is one of
 * vanilla's, made of what vanilla makes it of.
 */
import { blocks } from '../../blocks/registry.ts';
import { Rng, hashPos } from '../../core/rng.ts';
import type { BlockAccess } from './features.ts';
import type { ClipBox } from './structures.ts';

export interface FortressBox { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number }

export type FortressPieceType = 'bridge' | 'crossing' | 'corridor' | 'stairs' | 'wart_room' | 'blaze_room' | 'end';

export interface FortressPiece {
  type: FortressPieceType;
  box: FortressBox;
  /** Direction the piece runs: 0 north, 1 east, 2 south, 3 west. */
  dir: number;
  /** Seed for the piece's own decisions, hashed with each block position. */
  seed: number;
}

/** The height vanilla starts a fortress's bridges at. */
export const FORTRESS_Y = 64;
/** How far from its start the walk may wander, and how deep it may go. */
const MAX_DEPTH = 14;
const MAX_DISTANCE = 96;

const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

const st = (id: string) => blocks.defaultState(id);
const BRICK = st('nether_bricks');
const FENCE = st('nether_brick_fence');
const AIR = blocks.AIR;
const SOUL_SAND = st('soul_sand');
const WART = st('nether_wart');
const SPAWNER = st('spawner');
const LAVA = st('lava');
const stairs = (facing: string, half = 'bottom') => blocks.stateWith('nether_brick_stairs', { facing, half, shape: 'straight', waterlogged: 'false' });

const overlaps = (a: FortressBox, b: FortressBox): boolean =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;

/** A box `length` long running in `dir` from a doorway, `width` wide and `height` tall. */
function ahead(x: number, y: number, z: number, dir: number, width: number, height: number, length: number): FortressBox {
  const half = (width - 1) / 2;
  const [dx, dz] = DIRS[dir];
  if (dz !== 0) {
    const z0 = dz < 0 ? z - length + 1 : z;
    return { x0: x - half, x1: x + half, y0: y, y1: y + height - 1, z0, z1: z0 + length - 1 };
  }
  const x0 = dx < 0 ? x - length + 1 : x;
  return { x0, x1: x0 + length - 1, y0: y, y1: y + height - 1, z0: z - half, z1: z + half };
}

/**
 * The pieces of one fortress. Vanilla grows its from a crossing outward, choosing pieces from a
 * weighted table and refusing any that would overlap; this does the same with vanilla's own pieces.
 */
export function assembleFortress(seed: number, x: number, z: number): FortressPiece[] {
  const rng = new Rng(seed);
  const pieces: FortressPiece[] = [];
  const startDir = rng.int(4);
  const start: FortressPiece = {
    type: 'crossing',
    box: { x0: x - 2, x1: x + 2, y0: FORTRESS_Y, y1: FORTRESS_Y + 6, z0: z - 2, z1: z + 2 },
    dir: startDir,
    seed: rng.int(0x7fffffff),
  };
  pieces.push(start);
  /** Each open end: where the next piece would start, and which way it faces. */
  const ends: { x: number; y: number; z: number; dir: number; depth: number }[] = [];
  for (let d = 0; d < 4; d++) ends.push({ x, y: FORTRESS_Y, z, dir: d, depth: 0 });

  while (ends.length) {
    const end = ends.shift()!;
    if (end.depth >= MAX_DEPTH) continue;
    if (Math.abs(end.x - x) > MAX_DISTANCE || Math.abs(end.z - z) > MAX_DISTANCE) continue;
    const [dx, dz] = DIRS[end.dir];
    // step out of the piece we are leaving before building the next one
    const fx = end.x + dx * 3;
    const fz = end.z + dz * 3;
    const roll = rng.next();
    let type: FortressPieceType;
    if (end.depth >= MAX_DEPTH - 2) type = 'end';
    else if (roll < 0.32) type = 'bridge';
    else if (roll < 0.5) type = 'corridor';
    else if (roll < 0.66) type = 'crossing';
    else if (roll < 0.78) type = 'stairs';
    else if (roll < 0.88) type = 'wart_room';
    else if (roll < 0.94) type = 'blaze_room';
    else type = 'end';
    const geometry: Record<FortressPieceType, [number, number, number]> = {
      bridge: [5, 6, 12],
      corridor: [5, 6, 10],
      crossing: [5, 7, 5],
      stairs: [5, 11, 8],
      wart_room: [9, 8, 9],
      blaze_room: [9, 8, 9],
      end: [5, 6, 4],
    };
    const [w, h, len] = geometry[type];
    const y = type === 'stairs' ? end.y : end.y;
    const box = ahead(fx, y, fz, end.dir, w, h, len);
    if (pieces.some((p) => overlaps(p.box, box))) continue;
    const piece: FortressPiece = { type, box, dir: end.dir, seed: rng.int(0x7fffffff) };
    pieces.push(piece);
    // where this piece leaves the walk: straight on, and to the sides from a crossing
    const farX = end.dir === 1 ? box.x1 : end.dir === 3 ? box.x0 : (box.x0 + box.x1) >> 1;
    const farZ = end.dir === 2 ? box.z1 : end.dir === 0 ? box.z0 : (box.z0 + box.z1) >> 1;
    const nextY = type === 'stairs' ? y + 5 : y;
    if (type !== 'end') ends.push({ x: farX, y: nextY, z: farZ, dir: end.dir, depth: end.depth + 1 });
    if (type === 'crossing') {
      const cx = (box.x0 + box.x1) >> 1;
      const cz = (box.z0 + box.z1) >> 1;
      for (const side of [(end.dir + 1) % 4, (end.dir + 3) % 4]) {
        if (rng.next() < 0.6) ends.push({ x: cx, y, z: cz, dir: side, depth: end.depth + 1 });
      }
    }
    if (pieces.length > 60) break;
  }
  return pieces;
}

interface Ctx {
  world: BlockAccess;
  clip: ClipBox;
  seed: number;
}

function put(c: Ctx, x: number, y: number, z: number, state: number): void {
  if (x < c.clip.x0 || x > c.clip.x1 || z < c.clip.z0 || z > c.clip.z1) return;
  c.world.set(x, y, z, state);
}

function fill(c: Ctx, b: FortressBox, state: number): void {
  for (let x = Math.max(b.x0, c.clip.x0); x <= Math.min(b.x1, c.clip.x1); x++)
    for (let z = Math.max(b.z0, c.clip.z0); z <= Math.min(b.z1, c.clip.z1); z++)
      for (let y = b.y0; y <= b.y1; y++) put(c, x, y, z, state);
}

/** A shell of brick with the inside hollowed out: what every corridor and room is. */
function room(c: Ctx, b: FortressBox): void {
  fill(c, b, BRICK);
  fill(c, { x0: b.x0 + 1, x1: b.x1 - 1, y0: b.y0 + 1, y1: b.y1 - 1, z0: b.z0 + 1, z1: b.z1 - 1 }, AIR);
}

/** Columns of brick dropped from a bridge until they hit something, as vanilla supports its spans. */
function support(c: Ctx, x: number, y: number, z: number): void {
  if (x < c.clip.x0 || x > c.clip.x1 || z < c.clip.z0 || z > c.clip.z1) return;
  for (let cy = y; cy > 1; cy--) {
    const cur = c.world.get(x, cy, z);
    if (cur !== AIR && cur !== LAVA) break;
    c.world.set(x, cy, z, BRICK);
  }
}

/** Writes one piece into the chunk being generated. */
export function fillFortressPiece(
  piece: FortressPiece,
  world: BlockAccess,
  clip: ClipBox,
  onLoot?: (x: number, y: number, z: number, table: string) => void,
  onSpawner?: (x: number, y: number, z: number, mob: string) => void,
  onEntity?: (x: number, y: number, z: number, mob: string) => void,
): void {
  const c: Ctx = { world, clip, seed: piece.seed };
  const b = piece.box;
  const alongZ = piece.dir === 0 || piece.dir === 2;
  // vanilla keeps a fortress stocked with wither skeletons and zombified piglins; ours puts a few
  // in as it builds, and the blaze spawner keeps the blazes coming
  const mx = (b.x0 + b.x1) >> 1;
  const mz = (b.z0 + b.z1) >> 1;
  if ((piece.type === 'corridor' || piece.type === 'crossing') && mx >= clip.x0 && mx <= clip.x1 && mz >= clip.z0 && mz <= clip.z1) {
    const roll = hashPos(piece.seed, mx, b.y0, mz);
    if (roll < 0.5) onEntity?.(mx + 0.5, b.y0 + 1, mz + 0.5, 'wither_skeleton');
    else if (roll < 0.7) onEntity?.(mx + 0.5, b.y0 + 1, mz + 0.5, 'zombified_piglin');
  }
  switch (piece.type) {
    case 'bridge': {
      // vanilla's bridge: a five-wide deck with a fenced rail and columns down to the ground
      fill(c, { ...b, y1: b.y0 }, BRICK);
      fill(c, { ...b, y0: b.y0 + 1, y1: b.y1 }, AIR);
      const railA = alongZ ? { ...b, x0: b.x0, x1: b.x0, y0: b.y0 + 1, y1: b.y0 + 1 } : { ...b, z0: b.z0, z1: b.z0, y0: b.y0 + 1, y1: b.y0 + 1 };
      const railB = alongZ ? { ...b, x0: b.x1, x1: b.x1, y0: b.y0 + 1, y1: b.y0 + 1 } : { ...b, z0: b.z1, z1: b.z1, y0: b.y0 + 1, y1: b.y0 + 1 };
      fill(c, railA, FENCE);
      fill(c, railB, FENCE);
      // the pillars, every four blocks along the span
      for (let i = 0; i <= (alongZ ? b.z1 - b.z0 : b.x1 - b.x0); i += 4) {
        const px = alongZ ? b.x0 : b.x0 + i;
        const pz = alongZ ? b.z0 + i : b.z0;
        support(c, px, b.y0 - 1, pz);
        support(c, alongZ ? b.x1 : px, alongZ ? pz : b.z1, alongZ ? pz : b.z1);
      }
      break;
    }
    case 'corridor': {
      room(c, b);
      // windows in the walls, which is what makes a fortress corridor look out over the lava
      for (let i = 2; i < (alongZ ? b.z1 - b.z0 : b.x1 - b.x0) - 1; i += 3) {
        const y = b.y0 + 2;
        if (alongZ) {
          put(c, b.x0, y, b.z0 + i, FENCE);
          put(c, b.x1, y, b.z0 + i, FENCE);
        } else {
          put(c, b.x0 + i, y, b.z0, FENCE);
          put(c, b.x0 + i, y, b.z1, FENCE);
        }
      }
      break;
    }
    case 'crossing': {
      room(c, b);
      // a crossing is open on all four sides
      fill(c, { x0: b.x0, x1: b.x0, y0: b.y0 + 1, y1: b.y0 + 3, z0: b.z0 + 1, z1: b.z1 - 1 }, AIR);
      fill(c, { x0: b.x1, x1: b.x1, y0: b.y0 + 1, y1: b.y0 + 3, z0: b.z0 + 1, z1: b.z1 - 1 }, AIR);
      fill(c, { x0: b.x0 + 1, x1: b.x1 - 1, y0: b.y0 + 1, y1: b.y0 + 3, z0: b.z0, z1: b.z0 }, AIR);
      fill(c, { x0: b.x0 + 1, x1: b.x1 - 1, y0: b.y0 + 1, y1: b.y0 + 3, z0: b.z1, z1: b.z1 }, AIR);
      break;
    }
    case 'stairs': {
      room(c, b);
      // the steps themselves, climbing the length of the piece
      const steps = alongZ ? b.z1 - b.z0 : b.x1 - b.x0;
      const facing = ['south', 'west', 'north', 'east'][piece.dir];
      for (let i = 0; i <= steps; i++) {
        const y = b.y0 + 1 + Math.min(b.y1 - b.y0 - 2, i);
        const px = alongZ ? 0 : (piece.dir === 1 ? i : steps - i);
        const pz = alongZ ? (piece.dir === 2 ? i : steps - i) : 0;
        for (let w = 1; w < (alongZ ? b.x1 - b.x0 : b.z1 - b.z0); w++) {
          const x = alongZ ? b.x0 + w : b.x0 + px;
          const z = alongZ ? b.z0 + pz : b.z0 + w;
          put(c, x, y, z, stairs(facing));
          put(c, x, y - 1, z, BRICK);
          for (let cy = y + 1; cy <= y + 3; cy++) put(c, x, cy, z, AIR);
        }
      }
      break;
    }
    case 'wart_room': {
      room(c, b);
      // vanilla's wart room: soul sand beds either side of a walkway, and a chest at the back
      const mid = (b.z0 + b.z1) >> 1;
      for (let x = b.x0 + 2; x <= b.x1 - 2; x++)
        for (let z = b.z0 + 2; z <= b.z1 - 2; z++) {
          if (z === mid) continue;
          put(c, x, b.y0 + 1, z, SOUL_SAND);
          if (hashPos(piece.seed, x, b.y0, z) < 0.75) put(c, x, b.y0 + 2, z, WART);
        }
      const chest = blocks.stateWith('chest', { facing: 'north', type: 'single', waterlogged: 'false' });
      const cxp = (b.x0 + b.x1) >> 1;
      put(c, cxp, b.y0 + 1, b.z1 - 1, chest);
      if (cxp >= clip.x0 && cxp <= clip.x1 && b.z1 - 1 >= clip.z0 && b.z1 - 1 <= clip.z1) onLoot?.(cxp, b.y0 + 1, b.z1 - 1, 'chests/nether_bridge');
      break;
    }
    case 'blaze_room': {
      room(c, b);
      // the spawner stands on a low platform in the middle, as vanilla's does
      const cxp = (b.x0 + b.x1) >> 1;
      const czp = (b.z0 + b.z1) >> 1;
      fill(c, { x0: cxp - 1, x1: cxp + 1, y0: b.y0 + 1, y1: b.y0 + 1, z0: czp - 1, z1: czp + 1 }, BRICK);
      for (const [sx, sz] of [[cxp - 2, czp], [cxp + 2, czp], [cxp, czp - 2], [cxp, czp + 2]]) put(c, sx, b.y0 + 2, sz, FENCE);
      put(c, cxp, b.y0 + 2, czp, SPAWNER);
      if (cxp >= clip.x0 && cxp <= clip.x1 && czp >= clip.z0 && czp <= clip.z1) onSpawner?.(cxp, b.y0 + 2, czp, 'blaze');
      break;
    }
    case 'end': {
      // a small tower closing off the walk
      room(c, b);
      fill(c, { ...b, y0: b.y1, y1: b.y1 }, BRICK);
      for (let x = b.x0; x <= b.x1; x += 2) for (let z = b.z0; z <= b.z1; z += 2) put(c, x, b.y1 + 1, z, FENCE);
      break;
    }
  }
}
