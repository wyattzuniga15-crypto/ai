/** Collision boxes per block state, from data/collision.json (vanilla voxel shapes). */
import collisionJson from '../../data/collision.json';
import { blocks } from './registry.ts';

const shapes = (collisionJson as { shapes: Record<string, number[][]> }).shapes;
const FULL: number[][] = [[0, 0, 0, 1, 1, 1]];
const EMPTY: number[][] = [];
const cache = new Map<number, number[][]>();

/**
 * Boxes (x1,y1,z1,x2,y2,z2 in block units) a state collides with. With `forSelection` fluids and
 * non-solid decorations still return their outline box so they can be targeted.
 */
export function collisionBoxes(state: number, forSelection = false): number[][] {
  const key = state * 2 + (forSelection ? 1 : 0);
  const cached = cache.get(key);
  if (cached) return cached;
  const def = blocks.blockOf(state);
  let boxes: number[][];
  if (def.behavior === 'air') boxes = EMPTY;
  else if (def.behavior === 'fluid') boxes = forSelection ? FULL : EMPTY;
  else if (def.shape === undefined) boxes = def.solid ? FULL : forSelection ? FULL : EMPTY;
  else {
    const id = typeof def.shape === 'number' ? def.shape : def.shape[state - def.min];
    const s = shapes[String(id)];
    boxes = s && s.length ? s : forSelection ? FULL : EMPTY;
    if (boxes.length === 0 && forSelection) boxes = FULL;
  }
  cache.set(key, boxes);
  return boxes;
}

export function isCollidable(state: number): boolean {
  return collisionBoxes(state).length > 0;
}
