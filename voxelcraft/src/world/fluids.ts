/**
 * Water and lava flow (vanilla rules): sources, flowing levels 1-7, falling columns, slope
 * preference, infinite water, lava/water interactions. Runs on the main thread through the
 * simulation's scheduled ticks.
 */
import { blocks, type BlockDef } from '../blocks/registry.ts';

export interface FluidWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, state: number): void;
  /** Break a block with drops (plants swept away by water). */
  breakBlock(x: number, y: number, z: number): void;
  schedule(x: number, y: number, z: number, delay: number): void;
}

const WATER = blocks.get('water');
const LAVA = blocks.get('lava');
const H: [number, number][] = [[0, -1], [0, 1], [-1, 0], [1, 0]];

export const WATER_DELAY = 5;
export const LAVA_DELAY = 30;

const DESTROYED_BY_FLUID = new Set(['plant', 'crop', 'sapling', 'torch', 'snow_layer', 'fire', 'redstone', 'growing', 'coral', 'carpet', 'pressure_plate', 'button', 'sign', 'banner', 'head', 'candle']);

export function fluidLevel(state: number): number {
  return Number(blocks.prop(state, 'level') ?? 0);
}

/** Amount 8 (source / falling) .. 1 (thinnest). */
export function fluidAmount(state: number): number {
  const level = fluidLevel(state);
  return level >= 8 ? 8 : 8 - level;
}

export function isFluidOf(state: number, def: BlockDef): boolean {
  return state !== 0 && blocks.stateBlock[state] === blocks.stateBlock[def.default];
}

function fluidState(def: BlockDef, level: number): number {
  return blocks.stateWith(def, { level: String(level) });
}

/** Whether a fluid can move into this cell (air, thinner same fluid, or destroyable decoration). */
function flowable(state: number, def: BlockDef): 'air' | 'fluid' | 'destroy' | false {
  if (state === 0) return 'air';
  const b = blocks.blockOf(state);
  if (b.behavior === 'air') return 'air';
  if (isFluidOf(state, def)) return fluidLevel(state) === 0 ? false : 'fluid';
  if (b.behavior === 'fluid') return false; // the other fluid: handled by interactions
  if (DESTROYED_BY_FLUID.has(b.behavior) && !blocks.prop(state, 'waterlogged')) return 'destroy';
  return false;
}

function solidForFluid(state: number): boolean {
  if (state === 0) return false;
  const b = blocks.blockOf(state);
  return b.behavior !== 'fluid' && !DESTROYED_BY_FLUID.has(b.behavior) && b.behavior !== 'air';
}

export function tickFluid(w: FluidWorld, x: number, y: number, z: number, state: number): void {
  const def = blocks.blockOf(state);
  const isWater = def.id === 'water';
  const other = isWater ? LAVA : WATER;
  const delay = isWater ? WATER_DELAY : LAVA_DELAY;
  const dropOff = isWater ? 1 : 2;
  const level = fluidLevel(state);

  // lava / water interactions
  if (!isWater) {
    let touchesWater = isFluidOf(w.getBlock(x, y + 1, z), other);
    for (const [dx, dz] of H) if (isFluidOf(w.getBlock(x + dx, y, z + dz), other)) touchesWater = true;
    if (touchesWater) {
      w.setBlock(x, y, z, blocks.defaultState(level === 0 ? 'obsidian' : 'cobblestone'));
      return;
    }
  } else {
    for (const [dx, dz] of [...H, [0, 0]] as [number, number][]) {
      const n = dx === 0 && dz === 0 ? w.getBlock(x, y - 1, z) : w.getBlock(x + dx, y, z + dz);
      if (isFluidOf(n, other)) {
        const nx = dx === 0 && dz === 0 ? x : x + dx;
        const ny = dx === 0 && dz === 0 ? y - 1 : y;
        const nz = dx === 0 && dz === 0 ? z : z + dz;
        w.setBlock(nx, ny, nz, blocks.defaultState(fluidLevel(n) === 0 ? 'obsidian' : 'cobblestone'));
      }
    }
  }

  // 1. re-evaluate this block from its neighbours (flowing blocks drain when their feed is gone)
  if (level !== 0) {
    const above = w.getBlock(x, y + 1, z);
    let best = 0; // strongest neighbour amount
    let sources = 0;
    for (const [dx, dz] of H) {
      const n = w.getBlock(x + dx, y, z + dz);
      if (!isFluidOf(n, def)) continue;
      const amount = fluidAmount(n);
      if (amount > best) best = amount;
      if (fluidLevel(n) === 0) sources++;
    }
    let newState: number;
    const below = w.getBlock(x, y - 1, z);
    if (isWater && sources >= 2 && (solidForFluid(below) || (isFluidOf(below, def) && fluidLevel(below) === 0))) {
      newState = fluidState(def, 0);
    } else if (isFluidOf(above, def)) {
      newState = fluidState(def, 8);
    } else {
      const amount = best - dropOff;
      newState = amount <= 0 ? 0 : fluidState(def, 8 - amount);
    }
    if (newState !== state) {
      w.setBlock(x, y, z, newState);
      if (newState === 0) {
        for (const [dx, dz] of H) if (isFluidOf(w.getBlock(x + dx, y, z + dz), def)) w.schedule(x + dx, y, z + dz, delay);
        if (isFluidOf(w.getBlock(x, y - 1, z), def)) w.schedule(x, y - 1, z, delay);
        return;
      }
      state = newState;
    }
  }
  const amount = fluidAmount(state);

  // 2. flow down
  const below = w.getBlock(x, y - 1, z);
  const belowFlow = flowable(below, def);
  if (belowFlow) {
    if (belowFlow === 'destroy') w.breakBlock(x, y - 1, z);
    if (!(belowFlow === 'fluid' && fluidLevel(below) >= 8)) {
      w.setBlock(x, y - 1, z, fluidState(def, 8));
      w.schedule(x, y - 1, z, delay);
    }
    if (belowFlow !== 'fluid' || fluidLevel(below) !== 8) return;
  }
  // 3. spread sideways when resting on something (or when the column below is full)
  const spreadAmount = amount - dropOff;
  if (spreadAmount <= 0) return;
  if (!isWater && spreadAmount < 2) return;
  const dirs = preferredDirections(w, x, y, z, def);
  for (const [dx, dz] of dirs) {
    const nx = x + dx;
    const nz = z + dz;
    const n = w.getBlock(nx, y, nz);
    const f = flowable(n, def);
    if (!f) continue;
    if (f === 'fluid' && fluidAmount(n) >= spreadAmount) continue;
    if (f === 'destroy') w.breakBlock(nx, y, nz);
    w.setBlock(nx, y, nz, fluidState(def, 8 - spreadAmount));
    w.schedule(nx, y, nz, delay);
  }
}

/** Directions that lead to a drop within four blocks get the flow; otherwise all four. */
function preferredDirections(w: FluidWorld, x: number, y: number, z: number, def: BlockDef): [number, number][] {
  let bestDist = Infinity;
  const dist: number[] = [];
  H.forEach(([dx, dz], i) => {
    const nx = x + dx;
    const nz = z + dz;
    const n = w.getBlock(nx, y, nz);
    if (!flowable(n, def) || (isFluidOf(n, def) && fluidLevel(n) === 0)) {
      dist[i] = Infinity;
      return;
    }
    dist[i] = dropDistance(w, nx, y, nz, def, 1, [-dx, -dz]);
    if (dist[i] < bestDist) bestDist = dist[i];
  });
  if (bestDist === Infinity) return H.filter((_, i) => dist[i] !== Infinity || true);
  return H.filter((_, i) => dist[i] === bestDist);
}

function dropDistance(w: FluidWorld, x: number, y: number, z: number, def: BlockDef, depth: number, from: number[]): number {
  const below = w.getBlock(x, y - 1, z);
  if (flowable(below, def) && !(isFluidOf(below, def) && fluidLevel(below) === 0)) return depth;
  if (depth >= 4) return Infinity;
  let best = Infinity;
  for (const [dx, dz] of H) {
    if (dx === from[0] && dz === from[1]) continue;
    const n = w.getBlock(x + dx, y, z + dz);
    if (!flowable(n, def) || (isFluidOf(n, def) && fluidLevel(n) === 0)) continue;
    const d = dropDistance(w, x + dx, y, z + dz, def, depth + 1, [-dx, -dz]);
    if (d < best) best = d;
  }
  return best;
}
