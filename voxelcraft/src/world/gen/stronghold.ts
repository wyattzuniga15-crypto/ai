/**
 * Strongholds, after vanilla's `StrongholdPieces`: a spiral staircase down into a warren of stone
 * brick corridors, turns, crossings, prison cells, a library and, at the end of one branch, the
 * portal room with its end portal frame and silverfish spawner.
 *
 * The walk is worked out once per stronghold and cached by the generator, then each chunk writes the
 * part of it that falls in its own columns, so nothing depends on the order chunks are visited.
 */
import { blocks } from '../../blocks/registry.ts';
import { Rng, hashPos } from '../../core/rng.ts';
import type { BlockAccess } from './features.ts';
import { rotateState, type ClipBox } from './structures.ts';

export type RoomType =
  | 'start' | 'corridor' | 'turn_left' | 'turn_right' | 'room' | 'stairs' | 'crossing'
  | 'chest_corridor' | 'prison' | 'library' | 'portal_room';

export interface StrongholdPiece {
  type: RoomType;
  /** World position of the piece's local (0,0,0), its back-left corner. */
  x: number;
  y: number;
  z: number;
  /** The world direction the piece runs: 0 north, 1 east, 2 south, 3 west. */
  dir: number;
  seed: number;
  /** Room crossings and libraries come in variants. */
  variant: number;
  box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
}

/** Forward vectors for the four directions. */
const DIRS: [number, number][] = [[0, -1], [1, 0], [0, 1], [-1, 0]];

/** Width, height and depth of each room, as vanilla sizes them. */
const SIZE: Record<RoomType, [number, number, number]> = {
  start: [5, 11, 5],
  corridor: [5, 5, 7],
  turn_left: [5, 5, 5],
  turn_right: [5, 5, 5],
  room: [11, 7, 11],
  stairs: [5, 11, 8],
  crossing: [10, 9, 11],
  chest_corridor: [5, 5, 7],
  prison: [9, 5, 11],
  library: [14, 11, 15],
  portal_room: [11, 8, 16],
};

const st = (id: string) => blocks.defaultState(id);
const stairsState = (id: string, facing: string, half = 'bottom') => blocks.stateWith(id, { facing, half, shape: 'straight', waterlogged: 'false' });

const AIR = blocks.AIR;
const CAVE_AIR = blocks.has('cave_air') ? st('cave_air') : AIR;
const BRICKS = st('stone_bricks');
const MOSSY = st('mossy_stone_bricks');
const CRACKED = st('cracked_stone_bricks');
const INFESTED = blocks.has('infested_stone_bricks') ? st('infested_stone_bricks') : BRICKS;

/** World position of a piece's local coordinate: x runs to its right, z ahead of it. */
function worldOf(p: StrongholdPiece, lx: number, ly: number, lz: number): [number, number, number] {
  const [fx, fz] = DIRS[p.dir];
  const [rx, rz] = DIRS[(p.dir + 1) & 3];
  return [p.x + lx * rx + lz * fx, p.y + ly, p.z + lx * rz + lz * fz];
}

function boxOf(type: RoomType, x: number, y: number, z: number, dir: number): StrongholdPiece['box'] {
  const [w, h, d] = SIZE[type];
  const piece = { type, x, y, z, dir, seed: 0, variant: 0 } as StrongholdPiece;
  const corners = [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]].map(([lx, lz]) => worldOf(piece, lx, 0, lz));
  return {
    x0: Math.min(...corners.map((c) => c[0])), x1: Math.max(...corners.map((c) => c[0])),
    y0: y, y1: y + h - 1,
    z0: Math.min(...corners.map((c) => c[2])), z1: Math.max(...corners.map((c) => c[2])),
  };
}

const overlaps = (a: StrongholdPiece['box'], b: StrongholdPiece['box']): boolean =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;

// -------------------------------------------------------------------------------------------
// The walk
// -------------------------------------------------------------------------------------------

/** Where a room sends its own passages: the local doorway and which way the next room runs. */
const EXITS: Record<RoomType, { x: number; y: number; z: number; turn: number }[]> = {
  // the spiral staircase leaves at the bottom, running on
  start: [{ x: 1, y: 0, z: 5, turn: 0 }],
  corridor: [{ x: 1, y: 0, z: 7, turn: 0 }],
  turn_left: [{ x: -1, y: 0, z: 1, turn: 3 }],
  turn_right: [{ x: 5, y: 0, z: 1, turn: 1 }],
  room: [{ x: 4, y: 0, z: 11, turn: 0 }, { x: -1, y: 0, z: 4, turn: 3 }, { x: 11, y: 0, z: 4, turn: 1 }],
  stairs: [{ x: 1, y: -4, z: 8, turn: 0 }],
  crossing: [{ x: 3, y: 0, z: 11, turn: 0 }, { x: -1, y: 0, z: 3, turn: 3 }, { x: 10, y: 0, z: 3, turn: 1 }, { x: 3, y: 4, z: 11, turn: 0 }],
  chest_corridor: [{ x: 1, y: 0, z: 7, turn: 0 }],
  prison: [{ x: 1, y: 0, z: 11, turn: 0 }],
  library: [],
  portal_room: [],
};

/** Vanilla's weights, roughly: corridors and turns are common, libraries and rooms rare. */
const WEIGHTS: [RoomType, number][] = [
  ['corridor', 20], ['prison', 5], ['turn_left', 20], ['turn_right', 20],
  ['room', 10], ['stairs', 15], ['crossing', 5], ['chest_corridor', 5], ['library', 10],
];

interface Walk {
  pieces: StrongholdPiece[];
  rng: Rng;
  portal: boolean;
  libraries: number;
}

/** Where a child that leaves through an exit starts, and which way it runs. */
function childStart(parent: StrongholdPiece, exit: { x: number; y: number; z: number; turn: number }): { x: number; y: number; z: number; dir: number } {
  const dir = (parent.dir + exit.turn) & 3;
  // the doorway is on the parent's face; the child's own back-left corner sits one block beyond it,
  // offset so its doorway (local x 1 or 2) lines up with the parent's
  const [wx, wy, wz] = worldOf(parent, exit.x, exit.y, exit.z);
  const [rx, rz] = DIRS[(dir + 1) & 3];
  return { x: wx - rx, y: wy, z: wz - rz, dir };
}

function addRoom(w: Walk, type: RoomType, x: number, y: number, z: number, dir: number, depth: number): StrongholdPiece | null {
  const box = boxOf(type, x, y, z, dir);
  if (box.y0 < -50 || box.y1 > 120) return null;
  // the warren is kept inside 80 blocks of the staircase, so a chunk knows which starts reach it
  if (w.pieces.length && (Math.abs(box.x0 - w.pieces[0].x) > 80 || Math.abs(box.z0 - w.pieces[0].z) > 80)) return null;
  if (w.pieces.some((p) => overlaps(p.box, box))) return null;
  const piece: StrongholdPiece = { type, x, y, z, dir, seed: w.rng.int(0x7fffffff), variant: w.rng.int(3), box };
  w.pieces.push(piece);
  if (type === 'portal_room') w.portal = true;
  if (type === 'library') w.libraries++;
  grow(w, piece, depth + 1);
  return piece;
}

/**
 * Picks what comes next. Vanilla keeps one portal room and at most a couple of libraries per
 * stronghold and lets everything else fall out of the weights, and the portal room only turns up
 * once the walk is a few rooms deep.
 */
function nextRoom(w: Walk, depth: number, forced = true): RoomType {
  if (forced && !w.portal && depth >= 5) return 'portal_room';
  const allowed = WEIGHTS.filter(([type]) => !(type === 'library' && (w.libraries >= 2 || depth < 3)));
  let total = 0;
  for (const [, weight] of allowed) total += weight;
  let r = w.rng.next() * total;
  for (const [type, weight] of allowed) {
    r -= weight;
    if (r <= 0) return type;
  }
  return 'corridor';
}

function grow(w: Walk, piece: StrongholdPiece, depth: number): void {
  // vanilla stops a branch fifty rooms out; ours is held in by the 80-block cap long before that
  if (depth > 30 || w.pieces.length > 60) return;
  for (const exit of EXITS[piece.type]) {
    // a stronghold branches, but not out of every door it has
    if (depth > 2 && w.rng.next() < 0.15) continue;
    const start = childStart(piece, exit);
    for (let attempt = 0; attempt < 4; attempt++) {
      // the portal room is tried first where one is due, then something smaller that may still fit
      const type = nextRoom(w, depth, attempt === 0);
      if (addRoom(w, type, start.x, start.y, start.z, start.dir, depth)) break;
    }
  }
}

/**
 * Builds a stronghold: the spiral staircase, then everything the walk reaches from it. The whole
 * thing is put underground, and if the walk never found room for the portal room it is retried, the
 * way vanilla retries until its own walk places one.
 */
export function assembleStronghold(seed: number, cx: number, cz: number, topY: number): StrongholdPiece[] {
  let best: StrongholdPiece[] = [];
  for (let attempt = 0; attempt < 8; attempt++) {
    const w: Walk = { pieces: [], rng: new Rng(seed + attempt * 7919), portal: false, libraries: 0 };
    const dir = w.rng.int(4);
    addRoom(w, 'start', cx * 16 + 2, topY - 10, cz * 16 + 2, dir, 0);
    // a walk that never found room for the portal room gets it hung off whatever door is still free
    if (!w.portal) fitPortalRoom(w);
    if (w.portal && w.pieces.length > 8) return w.pieces;
    if (w.pieces.length > best.length) best = w.pieces;
  }
  return best;
}

/** Last resort: try every unused doorway in the warren, furthest room first, for the portal room. */
function fitPortalRoom(w: Walk): void {
  for (let i = w.pieces.length - 1; i >= 0 && !w.portal; i--) {
    const piece = w.pieces[i];
    for (const exit of EXITS[piece.type]) {
      const start = childStart(piece, exit);
      if (addRoom(w, 'portal_room', start.x, start.y, start.z, start.dir, 20)) break;
    }
  }
}

// -------------------------------------------------------------------------------------------
// Writing the blocks
// -------------------------------------------------------------------------------------------

interface Ctx {
  piece: StrongholdPiece;
  world: BlockAccess;
  clip: ClipBox;
  onLoot?: (x: number, y: number, z: number, table: string) => void;
  onSpawner?: (x: number, y: number, z: number, mob: string) => void;
}

function put(c: Ctx, lx: number, ly: number, lz: number, state: number): void {
  const [x, y, z] = worldOf(c.piece, lx, ly, lz);
  if (x < c.clip.x0 || x > c.clip.x1 || z < c.clip.z0 || z > c.clip.z1) return;
  c.world.set(x, y, z, state === AIR || state === CAVE_AIR ? state : rotateState(state, (c.piece.dir + 2) & 3));
}

function get(c: Ctx, lx: number, ly: number, lz: number): number {
  const [x, y, z] = worldOf(c.piece, lx, ly, lz);
  return c.world.get(x, y, z);
}

/**
 * The wall of a stronghold is stone brick weathered into mossy, cracked and infested patches, in
 * vanilla's own proportions (`SMOOTH_STONE_SELECTOR`: half plain, a fifth each mossy and cracked).
 */
function wallBlock(c: Ctx, lx: number, ly: number, lz: number): number {
  const r = hashPos(c.piece.seed, lx, ly, lz);
  if (r < 0.2) return MOSSY;
  if (r < 0.4) return CRACKED;
  if (r < 0.45) return INFESTED;
  return BRICKS;
}

/** A hollow room: weathered brick shell with air inside. */
function shell(c: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): void {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const edge = x === x0 || x === x1 || y === y0 || y === y1 || z === z0 || z === z1;
        put(c, x, y, z, edge ? wallBlock(c, x, y, z) : CAVE_AIR);
      }
}

function fill(c: Ctx, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: number): void {
  for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) for (let z = z0; z <= z1; z++) put(c, x, y, z, state);
}

/** Cuts a doorway through a wall, with vanilla's iron bars or plain opening. */
function doorway(c: Ctx, lx: number, ly: number, lz: number): void {
  fill(c, lx, ly, lz, lx + 1, ly + 2, lz, CAVE_AIR);
}

function chest(c: Ctx, lx: number, ly: number, lz: number, table: string): void {
  const [x, y, z] = worldOf(c.piece, lx, ly, lz);
  if (x < c.clip.x0 || x > c.clip.x1 || z < c.clip.z0 || z > c.clip.z1) return;
  c.world.set(x, y, z, rotateState(blocks.stateWith('chest', { facing: 'south', type: 'single', waterlogged: 'false' }), (c.piece.dir + 2) & 3));
  c.onLoot?.(x, y, z, table);
}

/** Writes one room of a stronghold, clipped to the chunk being generated. */
export function fillStrongholdPiece(
  piece: StrongholdPiece,
  world: BlockAccess,
  clip: ClipBox,
  onLoot?: (x: number, y: number, z: number, table: string) => void,
  onSpawner?: (x: number, y: number, z: number, mob: string) => void,
): void {
  const c: Ctx = { piece, world, clip, onLoot, onSpawner };
  const [w, h, d] = SIZE[piece.type];
  switch (piece.type) {
    case 'start': {
      // the spiral staircase every stronghold starts from
      shell(c, 0, 0, 0, w - 1, h - 1, d - 1);
      fill(c, 1, 1, 1, 3, h - 2, 3, CAVE_AIR);
      for (let i = 0; i < h - 2; i++) {
        // the steps wind round the middle pillar
        const ring: [number, number][] = [[1, 1], [1, 2], [1, 3], [2, 3], [3, 3], [3, 2], [3, 1], [2, 1]];
        const [sx, sz] = ring[i % ring.length];
        put(c, sx, i + 1, sz, BRICKS);
      }
      put(c, 2, 1, 2, BRICKS);
      doorway(c, 1, 1, d - 1);
      break;
    }
    case 'corridor':
    case 'chest_corridor': {
      shell(c, 0, 0, 0, w - 1, h - 1, d - 1);
      doorway(c, 1, 1, 0);
      doorway(c, 1, 1, d - 1);
      if (piece.type === 'chest_corridor') {
        // vanilla walls a chest into an alcove halfway down the corridor
        fill(c, 3, 1, 3, 3, 2, 3, CAVE_AIR);
        chest(c, 3, 1, 3, 'chests/stronghold_corridor');
      }
      break;
    }
    case 'turn_left':
    case 'turn_right': {
      shell(c, 0, 0, 0, w - 1, h - 1, d - 1);
      doorway(c, 1, 1, 0);
      if (piece.type === 'turn_left') fill(c, 0, 1, 1, 0, 3, 2, CAVE_AIR);
      else fill(c, w - 1, 1, 1, w - 1, 3, 2, CAVE_AIR);
      break;
    }
    case 'room': {
      shell(c, 0, 0, 0, w - 1, h - 1, d - 1);
      doorway(c, 4, 1, 0);
      doorway(c, 4, 1, d - 1);
      fill(c, 0, 1, 4, 0, 3, 5, CAVE_AIR);
      fill(c, w - 1, 1, 4, w - 1, 3, 5, CAVE_AIR);
      // vanilla's three room variants: a pillar, a fountain of water, or a double stack of chests
      if (piece.variant === 0) {
        fill(c, 5, 1, 5, 5, h - 2, 5, BRICKS);
        for (const [dx, dz] of [[4, 5], [6, 5], [5, 4], [5, 6]] as [number, number][]) put(c, dx, 1, dz, st('torch'));
      } else if (piece.variant === 1) {
        fill(c, 4, 1, 4, 6, 1, 6, BRICKS);
        fill(c, 5, 1, 5, 5, 1, 5, st('water'));
        for (const [dx, dz] of [[4, 4], [6, 4], [4, 6], [6, 6]] as [number, number][]) put(c, dx, 2, dz, st('stone_brick_wall'));
      } else {
        fill(c, 5, 1, 5, 5, 3, 5, BRICKS);
        chest(c, 5, 4, 5, 'chests/stronghold_crossing');
      }
      break;
    }
    case 'stairs': {
      // a straight flight down, four blocks over its length
      shell(c, 0, -4, 0, w - 1, h - 5, d - 1);
      doorway(c, 1, 1, 0);
      for (let i = 0; i < d; i++) {
        const step = Math.min(4, Math.floor((i * 5) / d));
        fill(c, 1, 1 - step, i, 3, 3 - step, i, CAVE_AIR);
        fill(c, 1, -step, i, 3, -step, i, BRICKS);
        if (i > 0) put(c, 2, 1 - step, i, stairsState('stone_brick_stairs', 'south'));
      }
      doorway(c, 1, -3, d - 1);
      break;
    }
    case 'crossing': {
      shell(c, 0, 0, 0, w - 1, h - 1, d - 1);
      doorway(c, 3, 1, 0);
      doorway(c, 3, 1, d - 1);
      fill(c, 0, 1, 3, 0, 3, 4, CAVE_AIR);
      fill(c, w - 1, 1, 3, w - 1, 3, 4, CAVE_AIR);
      // the upper floor of the five-way, reached by the steps in its corner
      fill(c, 1, 4, 1, w - 2, 4, d - 2, BRICKS);
      fill(c, 1, 5, 1, w - 2, h - 2, d - 2, CAVE_AIR);
      for (let i = 0; i < 4; i++) put(c, 1 + i, 1 + i, 1, stairsState('stone_brick_stairs', 'east'));
      doorway(c, 3, 5, d - 1);
      break;
    }
    case 'prison': {
      shell(c, 0, 0, 0, w - 1, h - 1, d - 1);
      doorway(c, 1, 1, 0);
      doorway(c, 1, 1, d - 1);
      // three cells behind iron bars down one side of the hall
      fill(c, 4, 1, 1, 4, 3, d - 2, st('iron_bars'));
      for (const z of [2, 5, 8]) fill(c, 4, 1, z, 4, 2, z, CAVE_AIR);
      fill(c, 5, 1, 1, w - 2, 3, d - 2, CAVE_AIR);
      for (const z of [3, 6]) fill(c, 5, 1, z, w - 2, 3, z, BRICKS);
      break;
    }
    case 'library': {
      shell(c, 0, 0, 0, w - 1, h - 1, d - 1);
      doorway(c, 1, 1, 0);
      // shelves round the walls, in two tiers like vanilla's tall library
      for (const y of [1, 5]) {
        for (let x = 1; x < w - 1; x++)
          for (const z of [1, d - 2]) {
            if (x % 4 === 0) continue;
            fill(c, x, y, z, x, y + 2, z, st('bookshelf'));
          }
        for (let z = 2; z < d - 2; z++)
          for (const x of [1, w - 2]) {
            if (z % 4 === 0) continue;
            fill(c, x, y, z, x, y + 2, z, st('bookshelf'));
          }
      }
      // the upper floor, its railing and the ladder up to it
      fill(c, 1, 4, 1, w - 2, 4, d - 2, st('oak_planks'));
      fill(c, 3, 4, 3, w - 4, 4, d - 4, CAVE_AIR);
      for (let y = 1; y <= 4; y++) put(c, w - 2, y, 1, st('ladder'));
      // cobwebs in the corners and a chest of the library's own table
      for (const [x, z] of [[2, 2], [w - 3, 2], [2, d - 3], [w - 3, d - 3]] as [number, number][])
        if (hashPos(piece.seed, x, 3, z) < 0.5) put(c, x, 3, z, st('cobweb'));
      chest(c, 3, 1, d - 3, 'chests/stronghold_library');
      if (piece.variant === 0) chest(c, w - 4, 5, d - 3, 'chests/stronghold_library');
      break;
    }
    case 'portal_room': {
      shell(c, 0, 0, 0, w - 1, h - 1, d - 1);
      doorway(c, 4, 1, 0);
      // the hall, and the pool of lava the portal is set over
      fill(c, 1, 1, 1, w - 2, h - 2, d - 2, CAVE_AIR);
      fill(c, 3, 0, 9, 7, 0, 13, st('lava'));
      // the frame: twelve blocks in a ring, each with vanilla's one-in-ten chance of an eye already in
      const frames: [number, number, string][] = [];
      for (const x of [4, 5, 6]) {
        frames.push([x, 9, 'south']);
        frames.push([x, 13, 'north']);
      }
      for (const z of [10, 11, 12]) {
        frames.push([3, z, 'east']);
        frames.push([7, z, 'west']);
      }
      for (const [fx, fz, facing] of frames) {
        const eye = hashPos(piece.seed, fx, 1, fz) < 0.1;
        put(c, fx, 0, fz, BRICKS);
        put(c, fx, 1, fz, blocks.stateWith('end_portal_frame', { facing, eye: eye ? 'true' : 'false' }));
      }
      // the three-by-three the portal opens in looks straight down onto the lava
      fill(c, 4, 1, 10, 6, 1, 12, CAVE_AIR);
      // the stairs up to the frame, and the pillars either side of them
      for (let i = 0; i < 3; i++) put(c, 5, 1, 6 + i, stairsState('stone_brick_stairs', 'south'));
      for (const x of [3, 7]) fill(c, x, 1, 7, x, 3, 7, BRICKS);
      // and the silverfish spawner that guards the way in
      put(c, 5, 2, 5, st('spawner'));
      const [sx, sy, sz] = worldOf(piece, 5, 2, 5);
      if (sx >= clip.x0 && sx <= clip.x1 && sz >= clip.z0 && sz <= clip.z1) onSpawner?.(sx, sy, sz, 'silverfish');
      break;
    }
  }
  // every room needs a floor to stand on where a cave has eaten the ground away under it
  if (piece.type !== 'stairs') {
    for (let x = 0; x < w; x++)
      for (let z = 0; z < d; z++) {
        const below = get(c, x, 0, z);
        if (below === AIR || below === CAVE_AIR) put(c, x, 0, z, wallBlock(c, x, 0, z));
      }
  }
  void h;
}
