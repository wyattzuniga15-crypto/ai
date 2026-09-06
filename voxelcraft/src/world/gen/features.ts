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
    case 'mangrove': return placeOak(w, rng, x, y, z, 'mangrove');
    default: return placeOak(w, rng, x, y, z);
  }
}

/** Two-block-tall plants use lower/upper halves. */
export function placeTallPlant(w: BlockAccess, id: string, x: number, y: number, z: number): boolean {
  if (w.get(x, y, z) !== AIR || w.get(x, y + 1, z) !== AIR) return false;
  w.set(x, y, z, blocks.stateWith(id, { half: 'lower' }));
  w.set(x, y + 1, z, blocks.stateWith(id, { half: 'upper' }));
  return true;
}
