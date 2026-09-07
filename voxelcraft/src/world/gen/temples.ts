/**
 * The structures vanilla lays out block by block in code rather than from a template: the desert
 * pyramid with its hidden treasure room, the jungle temple with its traps, and the swamp hut.
 *
 * Each is written straight into the chunk being generated, clipped to its columns, so a temple that
 * straddles four chunks comes out the same however they are visited. Anything random inside a piece
 * is hashed from the block's position for the same reason.
 */
import { blocks } from '../../blocks/registry.ts';
import { hashPos } from '../../core/rng.ts';
import type { BlockAccess } from './features.ts';
import { rotate, rotateState, type ClipBox } from './structures.ts';

export type TempleKind = 'desert_pyramid' | 'jungle_temple' | 'swamp_hut';

/** Footprint and height of each temple, as vanilla sizes its piece. */
export const TEMPLE_SIZE: Record<TempleKind, [number, number, number]> = {
  desert_pyramid: [21, 15, 21],
  jungle_temple: [12, 10, 15],
  swamp_hut: [7, 7, 9],
};

/** How far below its floor a temple digs, so the ground can be prepared for it. */
export const TEMPLE_DEPTH: Record<TempleKind, number> = { desert_pyramid: 15, jungle_temple: 4, swamp_hut: 6 };

const st = (id: string) => blocks.defaultState(id);
const stairs = (id: string, facing: string, half = 'bottom') => blocks.stateWith(id, { facing, half, shape: 'straight', waterlogged: 'false' });

const AIR = blocks.AIR;
const CAVE_AIR = blocks.has('cave_air') ? st('cave_air') : AIR;

export interface TempleSite {
  world: BlockAccess;
  clip: ClipBox;
  /** World corner the piece's local (0,0,0) sits at. */
  x: number;
  y: number;
  z: number;
  rotation: number;
  seed: number;
  kind: TempleKind;
  onLoot?: (x: number, y: number, z: number, table: string) => void;
  /** Mobs the temple comes with, such as the hut's witch and her cat. */
  onEntity?: (x: number, y: number, z: number, mob: string) => void;
}

/** Local position to world, turned with the piece. */
function world(s: TempleSite, lx: number, lz: number): [number, number] {
  const [w, , d] = TEMPLE_SIZE[s.kind];
  const [rx, rz] = rotate(lx, lz, w, d, s.rotation);
  return [s.x + rx, s.z + rz];
}

function put(s: TempleSite, lx: number, ly: number, lz: number, state: number): void {
  const [x, z] = world(s, lx, lz);
  if (x < s.clip.x0 || x > s.clip.x1 || z < s.clip.z0 || z > s.clip.z1) return;
  s.world.set(x, s.y + ly, z, state === AIR ? AIR : rotateState(state, s.rotation));
}

function get(s: TempleSite, lx: number, ly: number, lz: number): number {
  const [x, z] = world(s, lx, lz);
  return s.world.get(x, s.y + ly, z);
}

/** Vanilla's `generateBox`: every block of the box, or only its shell when `hollow`. */
function box(s: TempleSite, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: number, hollow = false): void {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        if (hollow && x !== x0 && x !== x1 && y !== y0 && y !== y1 && z !== z0 && z !== z1) continue;
        put(s, x, y, z, state);
      }
}

/** Fills a column downwards until it hits something solid, which is how a piece meets the ground. */
function columnDown(s: TempleSite, lx: number, ly: number, lz: number, state: number, limit = 24): void {
  for (let i = 0; i < limit; i++) {
    const cur = get(s, lx, ly - i, lz);
    if (cur !== AIR && cur !== CAVE_AIR && blocks.stateOpaque[cur]) break;
    put(s, lx, ly - i, lz, state);
  }
}

const chance = (s: TempleSite, lx: number, ly: number, lz: number, p: number) => hashPos(s.seed, lx, ly, lz) < p;

/** Places a chest and tells the caller which table fills it. */
function chest(s: TempleSite, lx: number, ly: number, lz: number, table: string, facing = 'north'): void {
  const [x, z] = world(s, lx, lz);
  if (x < s.clip.x0 || x > s.clip.x1 || z < s.clip.z0 || z > s.clip.z1) return;
  s.world.set(x, s.y + ly, z, rotateState(blocks.stateWith('chest', { facing, type: 'single', waterlogged: 'false' }), s.rotation));
  s.onLoot?.(x, s.y + ly, z, table);
}

// -------------------------------------------------------------------------------------------
// Desert pyramid
// -------------------------------------------------------------------------------------------

/**
 * Vanilla's `DesertPyramidPiece`: a 21-block stepped pyramid of sandstone with two towers on its
 * front, the orange and blue pattern on the walls, and a treasure room eleven blocks under the floor
 * with four chests and a slab of TNT under a pressure plate.
 */
function desertPyramid(s: TempleSite): void {
  const SAND = st('sandstone');
  const CUT = st('cut_sandstone');
  const CHISELED = st('chiseled_sandstone');
  const ORANGE = st('orange_terracotta');
  const BLUE = st('blue_terracotta');

  // the slab the pyramid stands on, and the steps up to its point
  box(s, 0, -4, 0, 20, 0, 20, SAND);
  for (let i = 1; i <= 9; i++) {
    box(s, i, i, i, 20 - i, i, 20 - i, SAND);
    box(s, i + 1, i, i + 1, 19 - i, i, 19 - i, AIR);
  }
  // and it is carried down to whatever ground it landed on
  for (let x = 0; x < 21; x++) for (let z = 0; z < 21; z++) columnDown(s, x, -5, z, SAND);

  // the two towers either side of the entrance
  for (const tower of [0, 16]) {
    box(s, tower, 1, 0, tower + 4, 9, 4, SAND);
    box(s, tower + 1, 10, 1, tower + 3, 10, 3, SAND);
    box(s, tower + 1, 1, 1, tower + 3, 9, 3, AIR);
    // the little crown on top
    for (const [dx, dz] of [[1, 0], [3, 0], [1, 4], [3, 4], [0, 1], [0, 3], [4, 1], [4, 3]]) put(s, tower + dx, 10, dz, SAND);
    put(s, tower + 2, 10, 2, CHISELED);
  }

  // the front wall, its doorway and the pattern beside it
  box(s, 5, 1, 0, 15, 4, 0, SAND);
  box(s, 9, 1, 0, 11, 3, 0, AIR);
  box(s, 8, 1, 1, 12, 3, 2, AIR);
  put(s, 10, 4, 0, CHISELED);
  for (const x of [9, 11]) {
    put(s, x, 4, 0, ORANGE);
    put(s, x, 5, 0, BLUE);
  }
  put(s, 10, 5, 0, ORANGE);

  // the hall inside, and the marked floor over the treasure room
  box(s, 5, 1, 1, 15, 3, 15, AIR);
  box(s, 5, 0, 1, 15, 0, 15, SAND);
  box(s, 9, 0, 9, 11, 0, 11, ORANGE);
  put(s, 10, 0, 10, BLUE);
  for (const [dx, dz] of [[9, 9], [11, 9], [9, 11], [11, 11]]) put(s, dx, 0, dz, CUT);

  // the treasure room: a block of sandstone with the room cut out of it, the charge under its
  // floor, and a chest in each of the four walls
  box(s, 7, -13, 7, 13, -7, 13, SAND);
  box(s, 9, -12, 9, 11, -12, 11, st('tnt'));
  box(s, 8, -11, 8, 12, -11, 12, SAND);
  box(s, 8, -10, 8, 12, -8, 12, AIR);
  put(s, 10, -11, 10, CUT);
  put(s, 10, -10, 10, st('stone_pressure_plate'));
  for (const [cx, cz, facing] of [[10, 8, 'south'], [8, 10, 'east'], [12, 10, 'west'], [10, 12, 'north']] as [number, number, string][])
    chest(s, cx, -10, cz, 'chests/desert_pyramid', facing);
  // the way down is solid: a player has to dig through the marked floor to find any of it
  box(s, 10, -7, 10, 10, -1, 10, SAND);

  // sand blown over the top edges, so it does not look freshly cut
  for (let x = 0; x < 21; x++)
    for (let z = 0; z < 21; z++) {
      if (!chance(s, x, 11, z, 0.15)) continue;
      for (let y = 11; y > 0; y--) {
        if (get(s, x, y, z) !== AIR) break;
        if (get(s, x, y - 1, z) === SAND) {
          put(s, x, y, z, st('sand'));
          break;
        }
      }
    }
}

// -------------------------------------------------------------------------------------------
// Jungle temple
// -------------------------------------------------------------------------------------------

/**
 * Vanilla's `JunglePyramidPiece`: cobblestone under the vines, a staircase down to the puzzle room
 * with its two levers, and the corridor whose tripwire fires dispensers at whoever walks it.
 */
function jungleTemple(s: TempleSite): void {
  const COBBLE = st('cobblestone');
  const MOSSY = st('mossy_cobblestone');
  const CHISELED = st('chiseled_stone_bricks');

  const stone = (lx: number, ly: number, lz: number) => (chance(s, lx, ly, lz, 0.4) ? MOSSY : COBBLE);
  // the block is cobble weathered to mossy in patches, which is what gives the temple its look
  const weathered = (x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, hollow = false) => {
    for (let x = x0; x <= x1; x++)
      for (let y = y0; y <= y1; y++)
        for (let z = z0; z <= z1; z++) {
          if (hollow && x !== x0 && x !== x1 && y !== y0 && y !== y1 && z !== z0 && z !== z1) continue;
          put(s, x, y, z, stone(x, y, z));
        }
  };

  // the block of the temple, hollowed into its rooms
  weathered(0, -4, 0, 11, 0, 14);
  weathered(0, 1, 0, 11, 9, 14, true);
  box(s, 2, 1, 2, 9, 2, 2, AIR);
  box(s, 2, 1, 12, 9, 2, 12, AIR);
  box(s, 1, 1, 1, 10, 3, 13, AIR);
  weathered(1, 4, 1, 10, 4, 13);
  box(s, 2, 5, 2, 9, 8, 12, AIR);
  for (let x = 0; x < 12; x++) for (let z = 0; z < 15; z++) columnDown(s, x, -5, z, COBBLE);

  // the doorway, the steps up to the roof and the crenellations along it
  box(s, 5, 1, 0, 6, 3, 0, AIR);
  for (const x of [1, 5, 6, 10]) put(s, x, 4, 0, CHISELED);
  for (let x = 0; x < 12; x += 2) {
    put(s, x, 9, 0, stone(x, 9, 0));
    put(s, x, 9, 14, stone(x, 9, 14));
  }
  for (let z = 0; z < 15; z += 2) {
    put(s, 0, 9, z, stone(0, 9, z));
    put(s, 11, 9, z, stone(11, 9, z));
  }
  // the stairs from the entrance up to the top room
  for (let i = 0; i < 4; i++) {
    put(s, 4 + i, 1 + i, 5, stairs('cobblestone_stairs', 'east'));
    put(s, 4 + i, 1 + i, 6, stairs('cobblestone_stairs', 'east'));
  }

  // the staircase down to the puzzle room
  box(s, 8, -3, 11, 9, 0, 12, AIR);
  for (let i = 0; i < 4; i++) put(s, 9, -i, 11 - i, stairs('cobblestone_stairs', 'south'));
  box(s, 2, -3, 2, 9, -1, 10, AIR);
  weathered(1, -4, 1, 10, -4, 13);

  // the puzzle at the west end: the levers, the redstone behind them, the piston door they open,
  // and the chest it hides
  put(s, 1, -3, 3, blocks.stateWith('lever', { face: 'wall', facing: 'east', powered: 'false' }));
  put(s, 1, -3, 5, blocks.stateWith('lever', { face: 'wall', facing: 'east', powered: 'false' }));
  put(s, 1, -2, 4, st('redstone_wire'));
  put(s, 2, -3, 4, blocks.stateWith('sticky_piston', { facing: 'east', extended: 'false' }));
  put(s, 3, -3, 4, AIR);
  chest(s, 3, -3, 4, 'chests/jungle_temple', 'east');

  // and the trap at the other end: a corridor watched by two dispensers of arrows, with the
  // tripwire strung across it between its hooks
  box(s, 2, -3, 9, 8, -2, 9, AIR);
  for (const dz of [8, 9]) {
    put(s, 1, -3, dz, blocks.stateWith('dispenser', { facing: 'east', triggered: 'false' }));
    const [wx, wz] = world(s, 1, dz);
    if (wx >= s.clip.x0 && wx <= s.clip.x1 && wz >= s.clip.z0 && wz <= s.clip.z1) s.onLoot?.(wx, s.y - 3, wz, 'chests/jungle_temple_dispenser');
  }
  put(s, 2, -3, 9, blocks.stateWith('tripwire_hook', { attached: 'true', facing: 'east', powered: 'false' }));
  for (let x = 3; x <= 6; x++) put(s, x, -3, 9, blocks.stateWith('tripwire', { attached: 'true', disarmed: 'false', powered: 'false' }));
  put(s, 7, -3, 9, blocks.stateWith('tripwire_hook', { attached: 'true', facing: 'west', powered: 'false' }));
  chest(s, 8, -3, 9, 'chests/jungle_temple', 'west');

  // vines hang down the outside, as they do on every jungle temple
  for (let y = 1; y <= 8; y++)
    for (const [x, z, side] of [[0, 3, 'east'], [0, 8, 'east'], [11, 3, 'west'], [11, 8, 'west'], [4, 0, 'south'], [7, 14, 'north']] as [number, number, string][]) {
      if (!chance(s, x, y, z, 0.6)) continue;
      if (get(s, x, y, z) !== AIR) continue;
      put(s, x, y, z, blocks.stateWith('vine', { [side]: 'true', up: 'false', north: 'false', east: 'false', south: 'false', west: 'false' } as Record<string, string>));
    }
}

// -------------------------------------------------------------------------------------------
// Swamp hut
// -------------------------------------------------------------------------------------------

/** Vanilla's `SwampHutPiece`: the witch's hut on its stilts, with the cauldron and crafting table. */
function swampHut(s: TempleSite): void {
  const PLANKS = st('spruce_planks');
  const LOG = blocks.stateWith('spruce_log', { axis: 'y' });
  const FENCE = st('spruce_fence');

  // the floor, walls and roof of the hut
  box(s, 1, 1, 1, 5, 1, 7, PLANKS);
  box(s, 1, 4, 2, 5, 4, 7, PLANKS);
  box(s, 2, 1, 0, 4, 1, 0, PLANKS);
  box(s, 1, 2, 1, 5, 3, 7, AIR);
  box(s, 1, 2, 1, 1, 3, 7, PLANKS);
  box(s, 5, 2, 1, 5, 3, 7, PLANKS);
  box(s, 2, 2, 7, 4, 3, 7, PLANKS);
  box(s, 2, 2, 1, 4, 3, 1, PLANKS);
  box(s, 2, 2, 2, 4, 3, 6, AIR);
  put(s, 2, 2, 1, AIR); // the doorway
  put(s, 2, 3, 1, AIR);
  // the roof overhangs on stairs, the way the hut's eaves do
  for (let x = 0; x <= 6; x++) {
    put(s, x, 4, 1, stairs('spruce_stairs', 'north'));
    put(s, x, 4, 8, stairs('spruce_stairs', 'south'));
  }
  for (let z = 2; z <= 7; z++) {
    put(s, 0, 4, z, stairs('spruce_stairs', 'west'));
    put(s, 6, 4, z, stairs('spruce_stairs', 'east'));
  }

  // what the witch keeps indoors
  put(s, 1, 2, 2, st('cauldron'));
  put(s, 3, 2, 6, st('crafting_table'));
  put(s, 4, 2, 2, st('red_mushroom'));
  put(s, 1, 3, 4, FENCE);
  put(s, 5, 3, 4, FENCE);
  put(s, 1, 2, 5, st('potted_red_mushroom'));

  // the stilts it stands on, driven down into the swamp
  for (const [x, z] of [[1, 1], [5, 1], [1, 7], [5, 7]] as [number, number][]) columnDown(s, x, 0, z, LOG, 12);

  // the witch lives here, and vanilla gives her a black cat
  const [wx, wz] = world(s, 3, 4);
  if (wx >= s.clip.x0 && wx <= s.clip.x1 && wz >= s.clip.z0 && wz <= s.clip.z1) {
    s.onEntity?.(wx, s.y + 2, wz, 'witch');
    s.onEntity?.(wx, s.y + 2, wz, 'cat');
  }
}

/** Writes one temple into the chunk the site is clipped to. */
export function buildTemple(s: TempleSite): void {
  if (s.kind === 'desert_pyramid') desertPyramid(s);
  else if (s.kind === 'jungle_temple') jungleTemple(s);
  else swampHut(s);
}
