/**
 * Decoration features: trees and small vegetation. Features may write into neighbouring chunks,
 * so they go through a BlockAccess rather than a single ChunkData.
 */
import { blocks } from '../../blocks/registry.ts';
import type { Rng } from '../../core/rng.ts';

export interface BlockAccess {
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, state: number): void;
}

const st = (id: string) => blocks.defaultState(id);
const AIR = blocks.AIR;

const isReplaceable = (s: number): boolean => {
  if (s === AIR) return true;
  const b = blocks.blockOf(s).behavior;
  return b === 'leaves' || b === 'plant' || b === 'air';
};

function log(kind: string, axis = 'y'): number {
  return blocks.stateWith(`${kind}_log`, { axis });
}

function leaves(kind: string): number {
  return blocks.stateWith(`${kind}_leaves`, { persistent: 'false', distance: '7' });
}

function canGrow(w: BlockAccess, x: number, y: number, z: number, height: number, radius: number): boolean {
  const below = blocks.blockOf(w.get(x, y - 1, z)).id;
  if (!['grass_block', 'dirt', 'podzol', 'coarse_dirt', 'rooted_dirt', 'moss_block', 'mud', 'sand', 'red_sand', 'snow_block', 'mycelium', 'farmland'].includes(below)) return false;
  for (let dy = 0; dy < height; dy++) {
    const r = dy < 2 ? 0 : radius;
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (!isReplaceable(w.get(x + dx, y + dy, z + dz))) return false;
      }
  }
  return true;
}

function placeLeafBlob(w: BlockAccess, x: number, y: number, z: number, radius: number, leaf: number, rng: Rng, corners = true): void {
  for (let dx = -radius; dx <= radius; dx++)
    for (let dz = -radius; dz <= radius; dz++) {
      if (Math.abs(dx) === radius && Math.abs(dz) === radius && (!corners || rng.chance(0.5))) continue;
      if (w.get(x + dx, y, z + dz) === AIR) w.set(x + dx, y, z + dz, leaf);
    }
}

export function placeOak(w: BlockAccess, rng: Rng, x: number, y: number, z: number, kind = 'oak'): boolean {
  const height = rng.range(4, 6);
  if (!canGrow(w, x, y, z, height + 1, 2)) return false;
  const trunk = log(kind);
  const leaf = leaves(kind);
  for (let i = 0; i < height; i++) w.set(x, y + i, z, trunk);
  placeLeafBlob(w, x, y + height - 3, z, 2, leaf, rng);
  placeLeafBlob(w, x, y + height - 2, z, 2, leaf, rng);
  placeLeafBlob(w, x, y + height - 1, z, 1, leaf, rng, false);
  placeLeafBlob(w, x, y + height, z, 1, leaf, rng, false);
  for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (w.get(x + dx, y + height, z + dz) === AIR && rng.chance(0.5)) w.set(x + dx, y + height, z + dz, leaf);
  w.set(x, y + height, z, leaf);
  return true;
}

export function placeFancyOak(w: BlockAccess, rng: Rng, x: number, y: number, z: number): boolean {
  const height = rng.range(7, 10);
  if (!canGrow(w, x, y, z, height + 1, 3)) return false;
  const trunk = log('oak');
  const leaf = leaves('oak');
  for (let i = 0; i < height; i++) w.set(x, y + i, z, trunk);
  const branches = rng.range(3, 5);
  for (let b = 0; b < branches; b++) {
    const by = y + rng.range(3, height - 1);
    let bx = x;
    let bz = z;
    const len = rng.range(1, 3);
    const dx = rng.range(-1, 1);
    const dz = rng.range(-1, 1);
    for (let i = 0; i < len; i++) {
      bx += dx;
      bz += dz;
      if (w.get(bx, by + i, bz) === AIR) w.set(bx, by + i, bz, trunk);
    }
    for (let dy = -1; dy <= 1; dy++) placeLeafBlob(w, bx, by + len + dy, bz, dy === 0 ? 2 : 1, leaf, rng);
  }
  for (let dy = -2; dy <= 1; dy++) placeLeafBlob(w, x, y + height + dy, z, dy === 1 ? 1 : 2, leaf, rng);
  return true;
}

export function placeBirch(w: BlockAccess, rng: Rng, x: number, y: number, z: number, tall = false): boolean {
  const height = tall ? rng.range(7, 9) : rng.range(5, 7);
  if (!canGrow(w, x, y, z, height + 1, 2)) return false;
  const trunk = log('birch');
  const leaf = leaves('birch');
  for (let i = 0; i < height; i++) w.set(x, y + i, z, trunk);
  placeLeafBlob(w, x, y + height - 3, z, 2, leaf, rng);
  placeLeafBlob(w, x, y + height - 2, z, 2, leaf, rng);
  placeLeafBlob(w, x, y + height - 1, z, 1, leaf, rng, false);
  placeLeafBlob(w, x, y + height, z, 1, leaf, rng, false);
  w.set(x, y + height, z, leaf);
  return true;
}

export function placeSpruce(w: BlockAccess, rng: Rng, x: number, y: number, z: number, pine = false): boolean {
  const height = pine ? rng.range(8, 12) : rng.range(6, 9);
  if (!canGrow(w, x, y, z, height + 2, 2)) return false;
  const trunk = log('spruce');
  const leaf = leaves('spruce');
  for (let i = 0; i < height; i++) w.set(x, y + i, z, trunk);
  const start = pine ? height - 4 : rng.range(1, 2);
  let radius = 0;
  for (let dy = height + 1; dy >= start; dy--) {
    placeLeafBlob(w, x, y + dy, z, radius, leaf, rng, radius > 1);
    radius = dy === height + 1 ? 1 : radius >= 2 ? (rng.chance(0.5) ? 1 : 2) : radius + 1;
    if (radius > 2) radius = 2;
  }
  return true;
}

export function placeAcacia(w: BlockAccess, rng: Rng, x: number, y: number, z: number): boolean {
  const height = rng.range(4, 6);
  if (!canGrow(w, x, y, z, height + 2, 3)) return false;
  const trunk = log('acacia');
  const leaf = leaves('acacia');
  for (let i = 0; i < height - 2; i++) w.set(x, y + i, z, trunk);
  let bx = x;
  let bz = z;
  const dx = rng.range(-1, 1);
  const dz = rng.range(-1, 1);
  for (let i = height - 2; i < height; i++) {
    bx += dx;
    bz += dz;
    w.set(bx, y + i, bz, trunk);
  }
  placeLeafBlob(w, bx, y + height, bz, 3, leaf, rng);
  placeLeafBlob(w, bx, y + height + 1, bz, 2, leaf, rng, false);
  // second, lower canopy
  const ox = x - dx;
  const oz = z - dz;
  w.set(ox, y + height - 2, oz, trunk);
  placeLeafBlob(w, ox, y + height - 1, oz, 2, leaf, rng);
  placeLeafBlob(w, ox, y + height, oz, 1, leaf, rng, false);
  return true;
}

export function placeJungle(w: BlockAccess, rng: Rng, x: number, y: number, z: number, mega = false): boolean {
  const height = mega ? rng.range(12, 20) : rng.range(6, 11);
  if (!canGrow(w, x, y, z, height + 2, 2)) return false;
  const trunk = log('jungle');
  const leaf = leaves('jungle');
  const size = mega ? 2 : 1;
  for (let i = 0; i < height; i++) for (let ox = 0; ox < size; ox++) for (let oz = 0; oz < size; oz++) w.set(x + ox, y + i, z + oz, trunk);
  const cx = mega ? x + 0.5 : x;
  const cz = mega ? z + 0.5 : z;
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy === 1 ? 1 : mega ? 3 : 2;
    for (let dx = -r - 1; dx <= r + 1; dx++)
      for (let dz = -r - 1; dz <= r + 1; dz++) {
        const px = Math.floor(cx + dx);
        const pz = Math.floor(cz + dz);
        if (Math.hypot(px + 0.5 - cx - 0.5, pz + 0.5 - cz - 0.5) > r + 0.5) continue;
        if (w.get(px, y + height + dy, pz) === AIR) w.set(px, y + height + dy, pz, leaf);
      }
  }
  return true;
}

export function placeDarkOak(w: BlockAccess, rng: Rng, x: number, y: number, z: number, kind = 'dark_oak'): boolean {
  const height = rng.range(6, 8);
  if (!canGrow(w, x, y, z, height + 1, 3)) return false;
  const trunk = log(kind);
  const leaf = leaves(kind);
  for (let i = 0; i < height; i++) for (let ox = 0; ox < 2; ox++) for (let oz = 0; oz < 2; oz++) w.set(x + ox, y + i, z + oz, trunk);
  for (let dy = -2; dy <= 1; dy++) {
    const r = dy === 1 ? 1 : 3;
    for (let dx = -r; dx <= r + 1; dx++)
      for (let dz = -r; dz <= r + 1; dz++) {
        if ((dx === -r || dx === r + 1) && (dz === -r || dz === r + 1)) continue;
        if (w.get(x + dx, y + height + dy, z + dz) === AIR) w.set(x + dx, y + height + dy, z + dz, leaf);
      }
  }
  return true;
}

export function placeCherry(w: BlockAccess, rng: Rng, x: number, y: number, z: number): boolean {
  const height = rng.range(4, 6);
  if (!canGrow(w, x, y, z, height + 3, 4)) return false;
  const trunk = log('cherry');
  const leaf = leaves('cherry');
  for (let i = 0; i < height; i++) w.set(x, y + i, z, trunk);
  const branches = rng.range(2, 3);
  for (let b = 0; b < branches; b++) {
    const dx = rng.range(-1, 1) || 1;
    const dz = rng.range(-1, 1);
    let bx = x;
    let bz = z;
    for (let i = 0; i < 3; i++) {
      bx += dx;
      bz += dz;
      w.set(bx, y + height - 1 + i, bz, log('cherry', dx !== 0 ? 'x' : 'z'));
    }
    for (let dy = -1; dy <= 1; dy++) placeLeafBlob(w, bx, y + height + 2 + dy, bz, dy === 0 ? 3 : 2, leaf, rng);
  }
  return true;
}

export function placeMegaSpruce(w: BlockAccess, rng: Rng, x: number, y: number, z: number): boolean {
  const height = rng.range(14, 22);
  if (!canGrow(w, x, y, z, height + 2, 4)) return false;
  const trunk = log('spruce');
  const leaf = leaves('spruce');
  for (let i = 0; i < height; i++) for (let ox = 0; ox < 2; ox++) for (let oz = 0; oz < 2; oz++) w.set(x + ox, y + i, z + oz, trunk);
  let radius = 0;
  for (let dy = height + 1; dy >= height - 10; dy--) {
    for (let dx = -radius; dx <= radius + 1; dx++)
      for (let dz = -radius; dz <= radius + 1; dz++) {
        if ((dx === -radius || dx === radius + 1) && (dz === -radius || dz === radius + 1) && radius > 0) continue;
        if (w.get(x + dx, y + dy, z + dz) === AIR) w.set(x + dx, y + dy, z + dz, leaf);
      }
    radius = dy === height + 1 ? 1 : radius >= 3 ? 1 : radius + 1;
  }
  // podzol patch
  for (let dx = -3; dx <= 4; dx++)
    for (let dz = -3; dz <= 4; dz++) {
      if (rng.chance(0.4)) continue;
      const gy = y - 1;
      if (blocks.blockOf(w.get(x + dx, gy, z + dz)).id === 'grass_block' && w.get(x + dx, gy + 1, z + dz) === AIR) w.set(x + dx, gy, z + dz, st('podzol'));
    }
  return true;
}

/** Mangrove: trunk on stilt roots that reach down into mud or water, wide canopy, hanging propagules. */
export function placeMangrove(w: BlockAccess, rng: Rng, x: number, y: number, z: number): boolean {
  const water = st('water');
  const mud = st('mud');
  const base = y + rng.range(1, 2);
  const height = rng.range(4, 7);
  for (let i = 0; i < height + 2; i++) if (!isReplaceable(w.get(x, base + i, z)) && w.get(x, base + i, z) !== water) return false;
  const roots = st('mangrove_roots');
  const wetRoots = blocks.stateWith('mangrove_roots', { waterlogged: 'true' });
  const legs = rng.pick([[[1, 0], [-1, 0], [0, 1], [0, -1]], [[1, 0], [-1, 1], [0, -1]], [[1, 1], [-1, 0], [0, -1], [-1, -1], [1, -1]]]);
  for (const [dx, dz] of legs) {
    for (let yy = base; yy >= y - 3; yy--) {
      const cur = w.get(x + dx, yy, z + dz);
      if (cur === mud) {
        w.set(x + dx, yy, z + dz, st('muddy_mangrove_roots'));
        break;
      }
      if (cur === water) w.set(x + dx, yy, z + dz, wetRoots);
      else if (isReplaceable(cur)) w.set(x + dx, yy, z + dz, roots);
      else break;
    }
  }
  for (let yy = y - 1; yy < base; yy++) {
    const cur = w.get(x, yy, z);
    if (cur === water) w.set(x, yy, z, wetRoots);
    else if (isReplaceable(cur)) w.set(x, yy, z, roots);
  }
  for (let i = 0; i < height; i++) w.set(x, base + i, z, log('mangrove'));
  const top = base + height - 1;
  const leaf = leaves('mangrove');
  placeLeafBlob(w, x, top - 1, z, 3, leaf, rng, false);
  placeLeafBlob(w, x, top, z, 2, leaf, rng, false);
  placeLeafBlob(w, x, top + 1, z, 1, leaf, rng, true);
  // propagules dangle from the underside of the canopy
  for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
    const ly = top - 1;
    if (w.get(x + dx, ly, z + dz) !== leaf || w.get(x + dx, ly - 1, z + dz) !== AIR || !rng.chance(0.12)) continue;
    w.set(x + dx, ly - 1, z + dz, blocks.stateWith('mangrove_propagule', { age: '4', hanging: 'true', stage: '0', waterlogged: 'false' }));
  }
  return true;
}

/** Azalea tree: oak trunk on rooted dirt with an azalea canopy, grown above lush caves. */
export function placeAzalea(w: BlockAccess, rng: Rng, x: number, y: number, z: number): boolean {
  const height = rng.range(4, 5);
  if (!canGrow(w, x, y, z, height, 2)) return false;
  w.set(x, y - 1, z, st('rooted_dirt'));
  if (w.get(x, y - 2, z) === AIR) w.set(x, y - 2, z, st('hanging_roots'));
  for (let i = 0; i < height; i++) w.set(x, y + i, z, log('oak'));
  const top = y + height - 1;
  const leaf = st('azalea_leaves');
  const flowering = st('flowering_azalea_leaves');
  const blob = (cy: number, r: number, corners: boolean) => {
    for (let dx = -r; dx <= r; dx++) for (let dz = -r; dz <= r; dz++) {
      if (!corners && Math.abs(dx) === r && Math.abs(dz) === r) continue;
      if (isReplaceable(w.get(x + dx, cy, z + dz))) w.set(x + dx, cy, z + dz, rng.chance(0.25) ? flowering : leaf);
    }
  };
  blob(top - 1, 2, false);
  blob(top, 2, false);
  blob(top + 1, 1, true);
  if (isReplaceable(w.get(x, top + 2, z))) w.set(x, top + 2, z, leaf);
  return true;
}

/**
 * Huge mushrooms, as vanilla's `HugeRedMushroomFeature` and `HugeBrownMushroomFeature` grow them: a
 * stem of `mushroom_stem` with its ends open, and a cap whose six booleans say which of its faces
 * wear the cap skin. A red cap is a dome three blocks deep with its corners cut away; a brown one is
 * a single flat disc with only its four corners missing.
 */
export function placeHugeMushroom(w: BlockAccess, rng: Rng, x: number, y: number, z: number, red: boolean): boolean {
  // vanilla AbstractHugeMushroomFeature.getTreeHeight: 4-6 tall, and one in twelve grows twice that
  let height = rng.int(3) + 4;
  if (rng.int(12) === 0) height *= 2;
  const radius = red ? 2 : 3;
  if (!canGrow(w, x, y, z, height + 1, radius)) return false;
  const cap = red ? 'red_mushroom_block' : 'brown_mushroom_block';
  const capAt = (dx: number, dz: number, up: boolean) =>
    blocks.stateWith(cap, {
      up: String(up), down: 'false',
      west: String(dx < 0), east: String(dx > 0), north: String(dz < 0), south: String(dz > 0),
    });
  const stem = blocks.stateWith('mushroom_stem', { up: 'false', down: 'false', north: 'true', south: 'true', east: 'true', west: 'true' });
  for (let dy = 0; dy < height; dy++) if (isReplaceable(w.get(x, y + dy, z))) w.set(x, y + dy, z, stem);
  if (red) {
    // the dome: its lowest three rings ring the stem, and the top one is closed over it
    for (let dy = height - 3; dy <= height; dy++) {
      const r = dy < height ? radius : radius - 1;
      for (let dx = -r; dx <= r; dx++)
        for (let dz = -r; dz <= r; dz++) {
          const edgeX = dx === -r || dx === r;
          const edgeZ = dz === -r || dz === r;
          // the ring's corners are cut away; the closed top is laid whole
          if (dy < height && edgeX === edgeZ) continue;
          if (isReplaceable(w.get(x + dx, y + dy, z + dz))) w.set(x + dx, y + dy, z + dz, capAt(dx, dz, dy >= height - 1));
        }
    }
  } else {
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++) {
        if ((dx === -radius || dx === radius) && (dz === -radius || dz === radius)) continue;
        if (isReplaceable(w.get(x + dx, y + height, z + dz))) {
          w.set(x + dx, y + height, z + dz, blocks.stateWith(cap, {
            up: 'true', down: 'false',
            west: String(dx === -radius), east: String(dx === radius), north: String(dz === -radius), south: String(dz === radius),
          }));
        }
      }
  }
  return true;
}

export function placeTree(w: BlockAccess, rng: Rng, type: string, x: number, y: number, z: number): boolean {
  switch (type) {
    case 'oak': return placeOak(w, rng, x, y, z);
    case 'swamp_oak': return placeOak(w, rng, x, y, z);
    case 'fancy_oak': return placeFancyOak(w, rng, x, y, z);
    case 'birch': return placeBirch(w, rng, x, y, z);
    case 'tall_birch': return placeBirch(w, rng, x, y, z, true);
    case 'spruce': return placeSpruce(w, rng, x, y, z);
    case 'pine': return placeSpruce(w, rng, x, y, z, true);
    case 'mega_spruce': case 'mega_pine': return placeMegaSpruce(w, rng, x, y, z);
    case 'acacia': return placeAcacia(w, rng, x, y, z);
    case 'jungle': return placeJungle(w, rng, x, y, z);
    case 'jungle_bush': return placeOak(w, rng, x, y, z, 'jungle');
    case 'mega_jungle': return placeJungle(w, rng, x, y, z, true);
    case 'dark_oak': return placeDarkOak(w, rng, x, y, z);
    case 'pale_oak': return placeDarkOak(w, rng, x, y, z, 'pale_oak');
    case 'cherry': return placeCherry(w, rng, x, y, z);
    case 'mangrove': return placeMangrove(w, rng, x, y, z);
    case 'azalea': return placeAzalea(w, rng, x, y, z);
    case 'huge_red_mushroom': return placeHugeMushroom(w, rng, x, y, z, true);
    case 'huge_brown_mushroom': return placeHugeMushroom(w, rng, x, y, z, false);
    default: return placeOak(w, rng, x, y, z);
  }
}

/**
 * Vanilla bee nest: hangs on the side of a trunk just under the leaves, facing outward, and starts
 * with three bees inside. Returns the position so the caller can create the hive's block entity.
 */
export function placeBeeNest(w: BlockAccess, rng: Rng, x: number, y: number, z: number): { x: number; y: number; z: number } | null {
  // find the highest log of the trunk we just placed
  let top = y;
  for (let dy = 0; dy < 12; dy++) {
    const id = blocks.idOf(w.get(x, y + dy, z));
    if (!id.endsWith('_log') && !id.endsWith('_wood')) break;
    top = y + dy;
  }
  if (top === y && !blocks.idOf(w.get(x, y, z)).endsWith('_log')) return null;
  const sides: [number, number, string][] = [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']];
  const start = rng.int(4);
  for (let i = 0; i < 4; i++) {
    const [dx, dz, facing] = sides[(start + i) % 4];
    const nx = x + dx, nz = z + dz, ny = top;
    if (w.get(nx, ny, nz) !== AIR) continue;
    if (w.get(nx, ny - 1, nz) !== AIR) continue; // vanilla hangs the nest with air below it
    w.set(nx, ny, nz, blocks.stateWith('bee_nest', { facing, honey_level: '0' }));
    return { x: nx, y: ny, z: nz };
  }
  return null;
}

/** Two-block-tall plants use lower/upper halves. */
export function placeTallPlant(w: BlockAccess, id: string, x: number, y: number, z: number): boolean {
  if (w.get(x, y, z) !== AIR || w.get(x, y + 1, z) !== AIR) return false;
  w.set(x, y, z, blocks.stateWith(id, { half: 'lower' }));
  w.set(x, y + 1, z, blocks.stateWith(id, { half: 'upper' }));
  return true;
}
