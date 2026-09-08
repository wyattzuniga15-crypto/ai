/**
 * The dried ghast: a block bartered off a piglin or made from eight ghast tears round a lump of
 * soul sand, which soaks up water. In it, its hydration climbs a step every five minutes, and a
 * step past the last one it splits open and a ghastling comes out. Out of water it dries back down
 * at the same rate, so a block left on land goes nowhere.
 */
import { blocks } from './registry.ts';

/** Ticks a step takes: four of them from bone dry to a ghastling, which is vanilla's twenty minutes. */
export const HYDRATION_STEP = 6000;
export const MAX_HYDRATION = 3;

export function hydrationOf(state: number): number {
  return Number(blocks.prop(state, 'hydration') ?? 0);
}

export function withHydration(state: number, level: number): number {
  return blocks.withProp(state, 'hydration', String(Math.max(0, Math.min(MAX_HYDRATION, level))));
}

/** Whether the block is standing in water, which is the only thing that makes it soak. */
export function inWater(state: number, around: (dx: number, dy: number, dz: number) => string): boolean {
  if (blocks.prop(state, 'waterlogged') === 'true') return true;
  // vanilla counts a block with water against any of its sides, not only one it has drunk in
  for (const [dx, dy, dz] of [[0, 1, 0], [0, -1, 0], [1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1]] as [number, number, number][]) {
    if (around(dx, dy, dz) === 'water') return true;
  }
  return false;
}

export type DriedGhastStep = { hydration: number; soak: number; hatch: boolean; changed: boolean };

/**
 * One tick of the block. `soak` counts the ticks spent at the hydration it is showing; lifting the
 * block out of the water, or dropping it back in, starts that count again, the way vanilla puts a
 * fresh tick on the schedule whenever the state under it changes. A full step either moves the
 * level or, at the top and still wet, splits the block open.
 */
export function hydrationTick(hydration: number, soak: number, wet: boolean, wasWet: boolean): DriedGhastStep {
  if (wet !== wasWet) return { hydration, soak: 0, hatch: false, changed: false };
  const next = soak + 1;
  if (next < HYDRATION_STEP) return { hydration, soak: next, hatch: false, changed: false };
  if (wet) {
    if (hydration >= MAX_HYDRATION) return { hydration, soak: 0, hatch: true, changed: true };
    return { hydration: hydration + 1, soak: 0, hatch: false, changed: true };
  }
  // a block left on dry land is done drying once it is back to nothing
  if (hydration <= 0) return { hydration, soak: 0, hatch: false, changed: false };
  return { hydration: hydration - 1, soak: 0, hatch: false, changed: true };
}
