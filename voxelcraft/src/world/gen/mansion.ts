/**
 * Woodland mansions. Vanilla lays these out on a grid of eight-block cells and fills the cells from
 * its own room templates (`woodland_mansion/*`), which is what this does: a rectangle of rooms two
 * storeys tall, walled and windowed round the outside, roofed over, with the grand entrance in the
 * middle of one side.
 *
 * The floor plan itself is ours rather than vanilla's — its `MansionGrid` grows an irregular blob of
 * rooms and this grows a rectangle — but every block placed comes from Mojang's own templates.
 */
import { Rng } from '../../core/rng.ts';
import type { StructureSet } from './structures.ts';

/** One template placed on the grid: which piece, where its corner sits, and how it is turned. */
export interface MansionPiece { key: string; x: number; y: number; z: number; rotation: number }

/** Mansion cells are eight blocks square; a room fills seven of those, leaving the walls between. */
export const CELL = 8;
/** Cells across and deep. Vanilla's grid is eleven wide but its rooms never fill all of it. */
export const GRID = 7;
/** Height of each storey: the ground floor rooms are eight tall, the upper ones eleven. */
const FLOOR_HEIGHT = [0, 8];

const ROOMS_LOWER = ['1x1_a1', '1x1_a2', '1x1_a3', '1x1_a4', '1x1_a5', '1x1_as1', '1x1_as2', '1x1_as3', '1x1_as4'];
const ROOMS_UPPER = ['1x1_b1', '1x1_b2', '1x1_b3', '1x1_b4', '1x1_b5'];
const BIG_LOWER = ['2x2_a1', '2x2_a2', '2x2_a3', '2x2_a4'];
const BIG_UPPER = ['2x2_b1', '2x2_b2', '2x2_b3', '2x2_b4', '2x2_b5'];
const WIDE_LOWER = ['1x2_a1', '1x2_a2', '1x2_a3', '1x2_a4', '1x2_a5', '1x2_a6', '1x2_a7', '1x2_a8', '1x2_a9', '1x2_b1', '1x2_b2', '1x2_b3', '1x2_b4', '1x2_b5'];
const WIDE_UPPER = ['1x2_c1', '1x2_c2', '1x2_c3', '1x2_c4', '1x2_d1', '1x2_d2', '1x2_d3', '1x2_d4', '1x2_d5'];
const STAIRS = ['1x2_c_stairs', '1x2_d_stairs'];

const pick = (rng: Rng, list: string[]): string => list[rng.int(list.length)];

/**
 * Lays a mansion out: two floors of rooms in a grid, the outer wall round each floor, the roof over
 * the top, and the entrance hall cut into the south side.
 */
export function assembleMansion(set: StructureSet, seed: number, x: number, y: number, z: number): MansionPiece[] {
  const rng = new Rng(seed);
  const out: MansionPiece[] = [];
  const has = (key: string) => set.byKey.has(`woodland_mansion_${key}`);
  const put = (key: string, px: number, py: number, pz: number, rotation: number): void => {
    if (has(key)) out.push({ key: `woodland_mansion_${key}`, x: px, y: py, z: pz, rotation });
  };

  // the entrance takes the middle three cells of the south side, so no room is placed over it
  const entranceCell = Math.floor(GRID / 2) - 1;
  const taken = new Set<string>();
  for (let i = 0; i < 3; i++) taken.add(`${entranceCell + i},${GRID - 1}`);
  taken.add(`${entranceCell + 1},${GRID - 2}`);

  for (const [floor, base] of FLOOR_HEIGHT.entries()) {
    const rooms = floor === 0 ? ROOMS_LOWER : ROOMS_UPPER;
    const wide = floor === 0 ? WIDE_LOWER : WIDE_UPPER;
    const big = floor === 0 ? BIG_LOWER : BIG_UPPER;
    const filled = new Set<string>(floor === 0 ? taken : []);
    const py = y + base;

    // the rooms themselves, laid biggest first so a hall has room before the small rooms fill in
    for (let cz = 0; cz < GRID; cz++)
      for (let cx = 0; cx < GRID; cx++) {
        if (filled.has(`${cx},${cz}`)) continue;
        const px = x + cx * CELL + 1;
        const pz = z + cz * CELL + 1;
        // a two-by-two hall, a room running two cells deep, or a single room
        if (cx + 1 < GRID && cz + 1 < GRID && !filled.has(`${cx + 1},${cz}`) && !filled.has(`${cx},${cz + 1}`)
          && !filled.has(`${cx + 1},${cz + 1}`) && rng.next() < 0.18) {
          put(pick(rng, big), px, py, pz, 0);
          for (const [dx, dz] of [[0, 0], [1, 0], [0, 1], [1, 1]]) filled.add(`${cx + dx},${cz + dz}`);
          continue;
        }
        if (cz + 1 < GRID && !filled.has(`${cx},${cz + 1}`) && rng.next() < 0.35) {
          // one storey in ten takes the staircase between the floors instead of a room
          const key = floor === 1 && rng.next() < 0.15 ? pick(rng, STAIRS) : pick(rng, wide);
          put(key, px, py, pz, 0);
          filled.add(`${cx},${cz}`);
          filled.add(`${cx},${cz + 1}`);
          continue;
        }
        put(pick(rng, rooms), px, py, pz, 0);
        filled.add(`${cx},${cz}`);
      }

    // the outside wall: a run of flats and windows along each side, with a corner piece at each end
    const wall = () => (rng.next() < 0.4 ? 'wall_window' : 'wall_flat');
    for (let c = 0; c < GRID; c++) {
      put(wall(), x + c * CELL + 1, py, z - 1, 0);
      put(wall(), x + c * CELL + 1, py, z + GRID * CELL - 1, 2);
      put(wall(), x - 1, py, z + c * CELL + 1, 3);
      put(wall(), x + GRID * CELL - 1, py, z + c * CELL + 1, 1);
    }
    for (const [cx, cz, rot] of [[0, 0, 0], [GRID * CELL - 2, 0, 1], [GRID * CELL - 2, GRID * CELL - 2, 2], [0, GRID * CELL - 2, 3]] as [number, number, number][])
      put('wall_corner', x + cx - 1, py, z + cz - 1, rot);
  }

  // the roof over every cell, edged with its corner and front pieces
  const roofY = y + 19;
  for (let cz = 0; cz < GRID; cz++)
    for (let cx = 0; cx < GRID; cx++) put('roof', x + cx * CELL, roofY, z + cz * CELL, 0);
  for (const [cx, cz, rot] of [[0, 0, 0], [GRID - 1, 0, 1], [GRID - 1, GRID - 1, 2], [0, GRID - 1, 3]] as [number, number, number][])
    put('roof_corner', x + cx * CELL, roofY + 1, z + cz * CELL, rot);

  // and the entrance hall, facing south out of the middle of that side
  put('entrance', x + entranceCell * CELL, y, z + (GRID - 2) * CELL, 0);
  return out;
}
