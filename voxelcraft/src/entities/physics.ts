/** Axis-aligned bounding box collision against world blocks (vanilla-style axis-by-axis sweep). */
import { blocks } from '../blocks/registry.ts';
import { collisionBoxes } from '../blocks/collision.ts';

export interface AABB {
  minX: number;
  minY: number;
  minZ: number;
  maxX: number;
  maxY: number;
  maxZ: number;
}

export interface BlockSource {
  getBlock(x: number, y: number, z: number): number;
}

export interface MoveResult {
  dx: number;
  dy: number;
  dz: number;
  onGround: number;
  hitX: boolean;
  hitZ: boolean;
  hitY: boolean;
}

const EPS = 1e-7;

/** World-space collision boxes overlapping the region. */
export function boxesIn(world: BlockSource, r: AABB, out: number[][] = []): number[][] {
  const x0 = Math.floor(r.minX - 1);
  const x1 = Math.floor(r.maxX + 1);
  const y0 = Math.floor(r.minY - 1);
  const y1 = Math.floor(r.maxY + 1);
  const z0 = Math.floor(r.minZ - 1);
  const z1 = Math.floor(r.maxZ + 1);
  for (let x = x0; x <= x1; x++)
    for (let y = y0; y <= y1; y++)
      for (let z = z0; z <= z1; z++) {
        const s = world.getBlock(x, y, z);
        if (s === 0) continue;
        for (const b of collisionBoxes(s)) out.push([x + b[0], y + b[1], z + b[2], x + b[3], y + b[4], z + b[5]]);
      }
  return out;
}

export function aabbIntersects(a: AABB, b: number[]): boolean {
  return a.minX < b[3] && a.maxX > b[0] && a.minY < b[4] && a.maxY > b[1] && a.minZ < b[5] && a.maxZ > b[2];
}

/** Moves `box` by (dx,dy,dz) resolving collisions; mutates box and returns the actual displacement. */
export function sweep(world: BlockSource, box: AABB, dx: number, dy: number, dz: number, stepHeight = 0): MoveResult {
  const region: AABB = {
    minX: Math.min(box.minX, box.minX + dx), maxX: Math.max(box.maxX, box.maxX + dx),
    minY: Math.min(box.minY, box.minY + dy) - stepHeight, maxY: Math.max(box.maxY, box.maxY + dy) + stepHeight,
    minZ: Math.min(box.minZ, box.minZ + dz), maxZ: Math.max(box.maxZ, box.maxZ + dz),
  };
  const boxes = boxesIn(world, region);
  const ox = dx, oy = dy, oz = dz;
  const start = { ...box };
  const r = moveAxes(box, boxes, dx, dy, dz);
  // auto-step: retry from the start with a lift when blocked horizontally on the ground
  if (stepHeight > 0 && (r.hitX || r.hitZ) && (r.onGround || oy <= 0)) {
    const test = { ...start };
    const up = moveAxes(test, boxes, 0, stepHeight, 0);
    const h = moveAxes(test, boxes, ox, 0, oz);
    const down = moveAxes(test, boxes, 0, -stepHeight, 0);
    const before = r.dx * r.dx + r.dz * r.dz;
    const after = h.dx * h.dx + h.dz * h.dz;
    if (after > before + EPS && down.hitY) {
      Object.assign(box, test);
      return { dx: h.dx, dy: up.dy + down.dy, dz: h.dz, onGround: 1, hitX: h.hitX, hitZ: h.hitZ, hitY: true };
    }
  }
  return r;
}

function moveAxes(box: AABB, boxes: number[][], dx: number, dy: number, dz: number): MoveResult {
  const res: MoveResult = { dx: 0, dy: 0, dz: 0, onGround: 0, hitX: false, hitZ: false, hitY: false };
  // Y
  let d = dy;
  for (const b of boxes) {
    if (box.maxX <= b[0] + EPS || box.minX >= b[3] - EPS || box.maxZ <= b[2] + EPS || box.minZ >= b[5] - EPS) continue;
    if (d > 0 && box.maxY <= b[1] + EPS) d = Math.min(d, b[1] - box.maxY);
    else if (d < 0 && box.minY >= b[4] - EPS) d = Math.max(d, b[4] - box.minY);
  }
  if (Math.abs(d - dy) > EPS) {
    res.hitY = true;
    if (dy < 0) res.onGround = 1;
  }
  box.minY += d;
  box.maxY += d;
  res.dy = d;
  // X
  d = dx;
  for (const b of boxes) {
    if (box.maxY <= b[1] + EPS || box.minY >= b[4] - EPS || box.maxZ <= b[2] + EPS || box.minZ >= b[5] - EPS) continue;
    if (d > 0 && box.maxX <= b[0] + EPS) d = Math.min(d, b[0] - box.maxX);
    else if (d < 0 && box.minX >= b[3] - EPS) d = Math.max(d, b[3] - box.minX);
  }
  if (Math.abs(d - dx) > EPS) res.hitX = true;
  box.minX += d;
  box.maxX += d;
  res.dx = d;
  // Z
  d = dz;
  for (const b of boxes) {
    if (box.maxY <= b[1] + EPS || box.minY >= b[4] - EPS || box.maxX <= b[0] + EPS || box.minX >= b[3] - EPS) continue;
    if (d > 0 && box.maxZ <= b[2] + EPS) d = Math.min(d, b[2] - box.maxZ);
    else if (d < 0 && box.minZ >= b[5] - EPS) d = Math.max(d, b[5] - box.minZ);
  }
  if (Math.abs(d - dz) > EPS) res.hitZ = true;
  box.minZ += d;
  box.maxZ += d;
  res.dz = d;
  return res;
}

/** True when any collision box is directly under the box (within 1e-3). */
export function hasGroundBelow(world: BlockSource, box: AABB): boolean {
  const probe: AABB = { ...box, minY: box.minY - 0.01, maxY: box.minY };
  for (const b of boxesIn(world, probe)) if (aabbIntersects(probe, b)) return true;
  return false;
}

export function isFluidAt(world: BlockSource, x: number, y: number, z: number, id?: string): boolean {
  const s = world.getBlock(Math.floor(x), Math.floor(y), Math.floor(z));
  if (s === 0) return false;
  const d = blocks.blockOf(s);
  return d.behavior === 'fluid' && (!id || d.id === id);
}
