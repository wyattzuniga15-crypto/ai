/**
 * Ocean monuments: the 58x23x58 prismarine block that sits on the floor of a deep ocean, with its
 * wings, its rooms, the sponges growing in one of them, the treasure sealed in dark prismarine and
 * the three elder guardians that keep it.
 *
 * Vanilla lays this out in `OceanMonumentPieces`, fitting rooms into a grid of eight-block cells
 * and choosing among a dozen room templates it writes block by block. The size, the height, the
 * materials, the lantern-lit pillars, the sponge room, the eight gold blocks and the guardians are
 * all vanilla's; the room plan itself is ours, laid on the same grid, because vanilla's fitter is a
 * thousand lines of Java with no data behind it to read.
 */
import { blocks } from '../../blocks/registry.ts';
import { hashPos } from '../../core/rng.ts';
import type { BlockAccess } from './features.ts';
import type { ClipBox } from './structures.ts';

const st = (id: string) => blocks.defaultState(id);

/** Footprint and height, as vanilla sizes the building. */
export const MONUMENT_SIZE: [number, number, number] = [58, 23, 58];
/** The y vanilla starts the building at, which puts its roof just under the sea. */
export const MONUMENT_Y = 39;
/** Rooms sit on vanilla's eight-block grid. */
const CELL = 8;
/** The core is five cells square, centred in the shell. */
const CORE = 5;
const CORE_ORIGIN = (58 - CORE * CELL) / 2; // 9

export interface MonumentSite {
  world: BlockAccess;
  clip: ClipBox;
  /** World corner the building's local (0,0,0) sits at. */
  x: number;
  y: number;
  z: number;
  seed: number;
  onEntity?: (x: number, y: number, z: number, mob: string) => void;
}

function put(s: MonumentSite, lx: number, ly: number, lz: number, state: number): void {
  const x = s.x + lx, z = s.z + lz;
  if (x < s.clip.x0 || x > s.clip.x1 || z < s.clip.z0 || z > s.clip.z1) return;
  s.world.set(x, s.y + ly, z, state);
}

function box(s: MonumentSite, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number, state: number, hollow = false): void {
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        if (hollow && x !== x0 && x !== x1 && y !== y0 && y !== y1 && z !== z0 && z !== z1) continue;
        put(s, x, y, z, state);
      }
}

/** Mobs are placed once, by the chunk that owns the block they stand on. */
function entity(s: MonumentSite, lx: number, ly: number, lz: number, mob: string): void {
  const x = s.x + lx, z = s.z + lz;
  if (x < s.clip.x0 || x > s.clip.x1 || z < s.clip.z0 || z > s.clip.z1) return;
  s.onEntity?.(x + 0.5, s.y + ly, z + 0.5, mob);
}

const chance = (s: MonumentSite, lx: number, ly: number, lz: number, p: number) => hashPos(s.seed, lx, ly, lz) < p;

/**
 * The whole building. Vanilla drowns its own box first and then carves the rooms out, which is what
 * this does: the shell is filled solid with prismarine and the rooms are cut back out of it, so
 * anything the terrain left behind is buried rather than left hanging.
 */
export function buildMonument(s: MonumentSite): void {
  const PRISMARINE = st('prismarine');
  const BRICKS = st('prismarine_bricks');
  const DARK = st('dark_prismarine');
  const LANTERN = st('sea_lantern');
  const WATER = st('water');
  const [w, h, d] = MONUMENT_SIZE;

  // the base slab the whole thing stands on, then the stepped mass above it
  box(s, 0, 0, 0, w - 1, 1, d - 1, PRISMARINE);
  box(s, 1, 2, 1, w - 2, 9, d - 2, PRISMARINE);
  box(s, 7, 10, 7, w - 8, 15, d - 8, PRISMARINE);
  box(s, 21, 16, 21, 36, 21, 36, PRISMARINE);

  // vanilla's brick facing: the outer courses and the corner pillars are bricks, not plain
  for (const [y0, y1, inset] of [[2, 9, 1], [10, 15, 7], [16, 21, 21]] as [number, number, number][]) {
    box(s, inset, y0, inset, w - 1 - inset, y1, d - 1 - inset, BRICKS, true);
    for (const [px, pz] of [[inset, inset], [inset, d - 1 - inset], [w - 1 - inset, inset], [w - 1 - inset, d - 1 - inset]] as [number, number][]) {
      box(s, px, y0, pz, px, y1, pz, DARK);
      put(s, px, y1, pz, LANTERN);
    }
  }
  // lanterns set into the outer wall the way vanilla lights its face
  for (let i = 6; i < w - 6; i += 6) {
    for (const y of [4, 8]) {
      put(s, i, y, 1, LANTERN);
      put(s, i, y, d - 2, LANTERN);
      put(s, 1, y, i, LANTERN);
      put(s, w - 2, y, i, LANTERN);
    }
  }

  // the rooms: five cells square, cut out of the mass and joined by doorways
  const roomY = 3;
  const roomTop = roomY + 4;
  for (let cx = 0; cx < CORE; cx++)
    for (let cz = 0; cz < CORE; cz++) {
      const x0 = CORE_ORIGIN + cx * CELL, z0 = CORE_ORIGIN + cz * CELL;
      box(s, x0 + 1, roomY, z0 + 1, x0 + CELL - 1, roomTop, z0 + CELL - 1, WATER);
      // a lantern in the ceiling of some rooms, as vanilla lights its rooms unevenly
      if (chance(s, cx, 0, cz, 0.4)) put(s, x0 + CELL / 2, roomTop + 1, z0 + CELL / 2, LANTERN);
      // doorways through to the next room along, east and south
      if (cx < CORE - 1) box(s, x0 + CELL, roomY, z0 + 3, x0 + CELL, roomY + 2, z0 + 5, WATER);
      if (cz < CORE - 1) box(s, x0 + 3, roomY, z0 + CELL, x0 + 5, roomY + 2, z0 + CELL, WATER);
      // and a stair well up into the floor above, in one room of each row
      if (cx === cz) box(s, x0 + 3, roomTop, z0 + 3, x0 + 5, 10, z0 + 5, WATER);
    }

  // the upper floor: one long hall over the middle of the core
  box(s, 17, 11, 17, 40, 14, 40, WATER);
  for (let i = 20; i <= 37; i += 6) for (let j = 20; j <= 37; j += 6) {
    box(s, i, 11, j, i, 14, j, BRICKS);
    put(s, i, 14, j, LANTERN);
  }

  // the entrance: vanilla cuts a way in on one side and lines it with dark prismarine
  box(s, 26, 2, 0, 31, 6, 9, WATER);
  box(s, 25, 1, 0, 25, 7, 9, DARK);
  box(s, 32, 1, 0, 32, 7, 9, DARK);
  box(s, 25, 7, 0, 32, 7, 9, DARK);
  box(s, 26, 2, 9, 31, 6, CORE_ORIGIN + 1, WATER); // through into the rooms

  // the wings, one each side, each with an elder guardian in it
  for (const wing of [4, 44]) {
    box(s, wing, 3, 22, wing + 9, 8, 35, WATER);
    box(s, wing - 1, 2, 21, wing + 10, 9, 36, BRICKS, true);
    box(s, wing + 2, 3, 24, wing + 2, 8, 24, DARK);
    put(s, wing + 4, 8, 28, LANTERN);
    // a way through from the wing into the core
    box(s, wing < 29 ? wing + 10 : CORE_ORIGIN + CORE * CELL, 4, 28, wing < 29 ? CORE_ORIGIN : wing - 1, 6, 30, WATER);
    entity(s, wing + 4, 5, 28, 'elder_guardian');
  }

  // the top room, and the third elder guardian in it
  box(s, 24, 17, 24, 33, 20, 33, WATER);
  box(s, 28, 21, 28, 29, 21, 29, LANTERN);
  entity(s, 28, 18, 28, 'elder_guardian');

  // the treasure: vanilla seals eight blocks of gold inside dark prismarine under the top room
  box(s, 25, 11, 25, 32, 16, 32, DARK);
  box(s, 27, 12, 27, 30, 14, 30, WATER);
  box(s, 28, 13, 28, 29, 13, 29, st('gold_block'));
  box(s, 28, 12, 28, 29, 12, 29, st('gold_block'));

  // the sponge room: one of the outer rooms is grown over with wet sponge
  const sx = CORE_ORIGIN + CELL, sz = CORE_ORIGIN;
  for (let x = sx + 1; x < sx + CELL; x++)
    for (let z = sz + 1; z < sz + CELL; z++)
      for (let y = roomY; y <= roomTop; y++)
        if (chance(s, x, y, z, 0.22)) put(s, x, y, z, st('wet_sponge'));

  // guardians patrolling inside, on vanilla's two-to-four-a-room spawn
  for (let cx = 0; cx < CORE; cx++)
    for (let cz = 0; cz < CORE; cz++)
      if (chance(s, cx, 9, cz, 0.5))
        entity(s, CORE_ORIGIN + cx * CELL + 4, roomY + 1, CORE_ORIGIN + cz * CELL + 4, 'guardian');

  // everything the building did not fill is water, so no air pocket is left under the sea
  for (let x = 0; x < w; x++)
    for (let z = 0; z < d; z++)
      for (let y = 0; y < h; y++) {
        const wx = s.x + x, wz = s.z + z;
        if (wx < s.clip.x0 || wx > s.clip.x1 || wz < s.clip.z0 || wz > s.clip.z1) continue;
        if (s.world.get(wx, s.y + y, wz) === blocks.AIR) s.world.set(wx, s.y + y, wz, WATER);
      }
}
