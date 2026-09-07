/**
 * End cities. Vanilla stacks these from twenty templates in code rather than through a template
 * pool, by a little grammar: a house tower with one, two or three floors, a thin tower rising out
 * of its roof, bridges reaching off the tower to more house towers or to a fat tower, and one ship
 * moored at the end of a bridge. This is that grammar, with vanilla's own offsets.
 *
 * Every piece is placed relative to the one before it, in that piece's turned frame, so the whole
 * city turns with the rotation its start rolled.
 */
import type { Rng } from '../../core/rng.ts';

/** The templates, at vanilla's sizes. */
const SIZE: Record<string, [number, number, number]> = {
  base_floor: [10, 4, 10],
  base_roof: [12, 2, 12],
  bridge_end: [5, 6, 2],
  bridge_gentle_stairs: [5, 7, 8],
  bridge_piece: [5, 6, 4],
  bridge_steep_stairs: [5, 7, 4],
  fat_tower_base: [13, 4, 13],
  fat_tower_middle: [13, 8, 13],
  fat_tower_top: [17, 6, 17],
  second_floor_1: [12, 8, 12],
  second_floor_2: [12, 8, 12],
  second_roof: [14, 2, 14],
  ship: [13, 24, 29],
  third_floor_1: [14, 8, 14],
  third_floor_2: [14, 8, 14],
  third_roof: [16, 2, 16],
  tower_base: [7, 7, 7],
  tower_floor: [7, 4, 7],
  tower_piece: [7, 4, 7],
  tower_top: [9, 5, 9],
};

/** One placed template: where its turned footprint starts, and the quarter-turns it has taken. */
export interface CityPiece {
  name: string;
  /** World corner the template's turned footprint begins at, which is what the stamper wants. */
  x: number;
  y: number;
  z: number;
  rotation: number;
  box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
}

/** A piece while the city is being built: it also remembers the anchor the next one hangs off. */
interface Node extends CityPiece {
  /** The anchor vanilla measures the next piece's offset from, which is not the box's corner. */
  px: number;
  py: number;
  pz: number;
  /** Which run of the grammar laid this piece, so a run may overlap only itself. */
  gen: number;
}

/** How an offset given in a piece's own frame lands in the world, once that piece has turned. */
function turn(rot: number, x: number, z: number): [number, number] {
  switch (rot & 3) {
    case 1: return [-z, x];
    case 2: return [-x, -z];
    case 3: return [z, -x];
    default: return [x, z];
  }
}

interface Env {
  list: Node[];
  rng: Rng;
  /** A city gets one ship at most, and only if a bridge rolls it. */
  ship: boolean;
  /** The height a bridge hands to the house tower it ends at. */
  y: number;
}

/**
 * Lays one template against the one before it. The offset is read in the previous piece's own
 * frame; the box is worked out from the piece's own rotation, which is what makes the footprint
 * of a turned piece run backwards from its anchor.
 */
function addPiece(env: Env, prev: Node | null, rot: number, px: number, py: number, pz: number, name: string): Node {
  const [w, h, d] = SIZE[name];
  const sx = w - 1;
  const sy = h - 1;
  const sz = d - 1;
  let ax = px;
  let ay = py;
  let az = pz;
  if (prev) {
    const [dx, dz] = turn(prev.rotation, px, pz);
    ax = prev.px + dx;
    ay = prev.py + py;
    az = prev.pz + dz;
  }
  const box = { x0: ax, y0: ay, z0: az, x1: ax, y1: ay + sy, z1: az };
  if ((rot & 3) === 0) {
    box.x1 += sx;
    box.z1 += sz;
  } else if ((rot & 3) === 1) {
    box.x0 -= sz;
    box.z1 += sx;
  } else if ((rot & 3) === 2) {
    box.x0 -= sx;
    box.z0 -= sz;
  } else {
    box.x1 += sz;
    box.z0 -= sx;
  }
  const node: Node = { name, x: box.x0, y: box.y0, z: box.z0, rotation: rot & 3, box, px: ax, py: ay, pz: az, gen: 0 };
  env.list.push(node);
  return node;
}

const overlaps = (a: Node['box'], b: Node['box']): boolean =>
  a.x1 >= b.x0 && a.x0 <= b.x1 && a.y1 >= b.y0 && a.y0 <= b.y1 && a.z1 >= b.z0 && a.z0 <= b.z1;

type Section = (env: Env, current: Node, depth: number) => boolean;

/**
 * Runs one section of the grammar off `current`. Everything it lays goes into a list of its own
 * first: a run that ends up sitting in a piece some other run laid is thrown away whole, which is
 * what keeps a city's bridges from growing through its towers.
 */
function section(gen: Section, env: Env, current: Node, depth: number): boolean {
  if (depth > 8) return false;
  const local: Node[] = [];
  const inner: Env = { ...env, list: local };
  if (!gen(inner, current, depth)) return false;
  env.ship = inner.ship;
  const id = 1 + env.rng.int(0x7ffffffe);
  for (const p of local) {
    p.gen = id;
    for (const q of env.list) {
      if (!overlaps(p.box, q.box)) continue;
      // a run may run into the piece it grew out of, but never into anybody else's
      if (current.gen !== q.gen) return false;
      break;
    }
  }
  env.list.push(...local);
  return true;
}

/** The thin tower that rises out of a house tower's roof, with its bridges and its cap. */
const growTower: Section = (env, current, depth) => {
  const rot = current.rotation;
  const x = 3 + env.rng.int(2);
  const z = 3 + env.rng.int(2);
  let base = addPiece(env, current, rot, x, -3, z, 'tower_base');
  base = addPiece(env, base, rot, 0, 7, 0, 'tower_piece');
  let landing: Node | null = env.rng.int(3) === 0 ? base : null;
  const floors = 1 + env.rng.int(3);
  for (let i = 0; i < floors; i++) {
    base = addPiece(env, base, rot, 0, 4, 0, 'tower_piece');
    if (i < floors - 1 && env.rng.int(2) === 1) landing = base;
  }
  if (landing) {
    // vanilla hangs a bridge off any of the four sides, each with its own turn and offset
    const sides: [number, number, number, number][] = [[0, 1, -1, 0], [1, 6, -1, 1], [3, 0, -1, 5], [2, 5, -1, 6]];
    for (const [turns, bx, by, bz] of sides) {
      if (env.rng.int(2) === 0) continue;
      const bridge = addPiece(env, landing, (rot + turns) & 3, bx, by, bz, 'bridge_end');
      section(growBridge, env, bridge, depth + 1);
    }
  } else if (depth !== 7) {
    return section(growFatTower, env, base, depth + 1);
  }
  addPiece(env, base, rot, -1, 4, -1, 'tower_top');
  return true;
};

/** A bridge: straight runs and stairs, ending at another house tower or at the ship. */
const growBridge: Section = (env, current, depth) => {
  const rot = current.rotation;
  const spans = 1 + env.rng.int(4);
  let base = addPiece(env, current, rot, 0, 0, -4, 'bridge_piece');
  base.gen = -1;
  let y = 0;
  for (let i = 0; i < spans; i++) {
    if (env.rng.int(2) === 1) {
      base = addPiece(env, base, rot, 0, y, -4, 'bridge_piece');
      y = 0;
      continue;
    }
    base = env.rng.int(2) === 1
      ? addPiece(env, base, rot, 0, y, -4, 'bridge_steep_stairs')
      : addPiece(env, base, rot, 0, y, -8, 'bridge_gentle_stairs');
    y = 4;
  }
  if (!env.ship && env.rng.int(Math.max(1, 10 - depth)) === 0) {
    const sx = -8 + env.rng.int(8);
    const sz = -70 + env.rng.int(10);
    base = addPiece(env, base, rot, sx, y, sz, 'ship');
    env.ship = true;
  } else {
    env.y = y + 1;
    if (!section(growHouseTower, env, base, depth + 1)) return false;
  }
  base = addPiece(env, base, (rot + 2) & 3, 4, y, 0, 'bridge_end');
  base.gen = -1;
  return true;
};

/** A house tower: one, two or three floors under a roof, with a thin tower on top of the tall ones. */
const growHouseTower: Section = (env, current, depth) => {
  if (depth > 8) return false;
  const rot = current.rotation;
  let base = addPiece(env, current, rot, -3, env.y, -11, 'base_floor');
  const floors = env.rng.int(3);
  if (floors === 0) {
    addPiece(env, base, rot, -1, 4, -1, 'base_roof');
    return true;
  }
  base = addPiece(env, base, rot, -1, 0, -1, 'second_floor_2');
  if (floors === 1) {
    base = addPiece(env, base, rot, -1, 8, -1, 'second_roof');
  } else {
    base = addPiece(env, base, rot, -1, 4, -1, 'third_floor_2');
    base = addPiece(env, base, rot, -1, 8, -1, 'third_roof');
  }
  section(growTower, env, base, depth + 1);
  return true;
};

/** The fat tower a thin tower can end in, with bridges off each of its middle floors. */
const growFatTower: Section = (env, current, depth) => {
  const rot = current.rotation;
  let base = addPiece(env, current, rot, -3, 4, -3, 'fat_tower_base');
  base = addPiece(env, base, rot, 0, 4, 0, 'fat_tower_middle');
  const sides: [number, number, number, number][] = [[0, 4, -1, 0], [1, 12, -1, 4], [3, 0, -1, 8], [2, 8, -1, 12]];
  for (let j = 0; j < 2 && env.rng.int(3) !== 0; j++) {
    base = addPiece(env, base, rot, 0, 8, 0, 'fat_tower_middle');
    for (const [turns, bx, by, bz] of sides) {
      if (env.rng.int(2) === 0) continue;
      const bridge = addPiece(env, base, (rot + turns) & 3, bx, by, bz, 'bridge_end');
      section(growBridge, env, bridge, depth + 1);
    }
  }
  addPiece(env, base, rot, -2, 8, -2, 'fat_tower_top');
  return true;
};

/**
 * Assembles a city standing at `(x, y, z)`: the base tower with its three floors, and whatever the
 * grammar grows out of its roof.
 */
export function assembleEndCity(rng: Rng, x: number, y: number, z: number): CityPiece[] {
  const env: Env = { list: [], rng, ship: false, y: 0 };
  const rot = rng.int(4);
  let base = addPiece(env, null, rot, x, y, z, 'base_floor');
  base = addPiece(env, base, rot, -1, 0, -1, 'second_floor_1');
  base = addPiece(env, base, rot, -1, 4, -1, 'third_floor_1');
  base = addPiece(env, base, rot, -1, 8, -1, 'third_roof');
  section(growTower, env, base, 1);
  return env.list.map(({ name, x: px, y: py, z: pz, rotation, box }) => ({ name, x: px, y: py, z: pz, rotation, box }));
}
