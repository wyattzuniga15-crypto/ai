/**
 * Pistons. Vanilla resolves what a piston can shove with `PistonStructureResolver`: up to twelve
 * blocks in a line, anything soft in the way broken, anything anchored refusing to move at all.
 * This does the same, and moves the blocks in one step rather than animating them over two ticks.
 */
import { blocks } from '../blocks/registry.ts';

export interface PistonWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, state: number): void;
  /** Break a block with its drops, which is what happens to a torch in the way. */
  breakBlock(x: number, y: number, z: number): void;
}

/** How far a piston can push, as vanilla limits it. */
export const PUSH_LIMIT = 12;

export const FACING_OFFSET: Record<string, [number, number, number]> = {
  north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};

/** Blocks that stay where they are however hard they are shoved. */
const ANCHORED = new Set(['obsidian', 'crying_obsidian', 'bedrock', 'reinforced_deepslate', 'respawn_anchor', 'barrier', 'end_portal_frame', 'end_portal', 'end_gateway', 'spawner', 'trial_spawner', 'vault', 'jigsaw', 'structure_block', 'moving_piston']);

/** Blocks a piston simply breaks: the same soft things a flood sweeps away. */
const SOFT = new Set(['plant', 'crop', 'sapling', 'torch', 'snow_layer', 'fire', 'redstone', 'growing', 'coral', 'carpet', 'pressure_plate', 'button', 'sign', 'banner', 'head', 'candle', 'air', 'fluid']);

const idOf = (state: number) => (state === 0 ? 'air' : blocks.blockOf(state).id);

export const isAir = (state: number): boolean => state === 0 || blocks.blockOf(state).behavior === 'air';

/** Whether a block gives way rather than moving: plants, torches, snow and the like. */
export function isSoft(state: number): boolean {
  if (isAir(state)) return true;
  const def = blocks.blockOf(state);
  return SOFT.has(def.behavior ?? '') || def.replaceable === true;
}

/** Whether a piston can move a block at all. */
export function isMovable(state: number): boolean {
  if (isAir(state)) return true;
  const def = blocks.blockOf(state);
  if (ANCHORED.has(def.id) || def.hardness < 0) return false;
  // anything that keeps contents of its own stays put, as it does in vanilla
  if (def.behavior === 'container' || def.behavior === 'furnaces' || def.behavior === 'workstation') return false;
  if (def.id.endsWith('_bed') || def.id === 'beehive' || def.id === 'bee_nest' || def.id.endsWith('_sign')) return false;
  return true;
}

/**
 * The blocks a push would move, in the order they have to be written (furthest first), or null when
 * something anchored is in the way.
 */
export function pushLine(w: PistonWorld, x: number, y: number, z: number, facing: string): [number, number, number][] | null {
  const [dx, dy, dz] = FACING_OFFSET[facing];
  const line: [number, number, number][] = [];
  let cx = x + dx;
  let cy = y + dy;
  let cz = z + dz;
  for (let i = 0; i < PUSH_LIMIT + 1; i++) {
    const state = w.getBlock(cx, cy, cz);
    if (isSoft(state)) return line; // the run ends at air, or at something that will simply break
    if (!isMovable(state)) return null;
    if (line.length >= PUSH_LIMIT) return null;
    line.push([cx, cy, cz]);
    cx += dx;
    cy += dy;
    cz += dz;
  }
  return null;
}

/** Extends a piston: the line in front moves up one, the head takes the space the piston opens. */
export function extend(w: PistonWorld, x: number, y: number, z: number, facing: string, sticky: boolean): boolean {
  const line = pushLine(w, x, y, z, facing);
  if (!line) return false;
  const [dx, dy, dz] = FACING_OFFSET[facing];
  // whatever the far end runs into is destroyed, the way a piston breaks a torch
  if (line.length) {
    const [lx, ly, lz] = line[line.length - 1];
    const beyond = w.getBlock(lx + dx, ly + dy, lz + dz);
    if (!isAir(beyond)) w.breakBlock(lx + dx, ly + dy, lz + dz);
  }
  for (let i = line.length - 1; i >= 0; i--) {
    const [bx, by, bz] = line[i];
    const state = w.getBlock(bx, by, bz);
    w.setBlock(bx + dx, by + dy, bz + dz, state);
    w.setBlock(bx, by, bz, 0);
  }
  // the piston is marked extended first: the head checks it the moment it is placed
  w.setBlock(x, y, z, blocks.stateWith(sticky ? 'sticky_piston' : 'piston', { facing, extended: 'true' }));
  const head = blocks.stateWith('piston_head', { facing, short: 'false', type: sticky ? 'sticky' : 'normal' });
  w.setBlock(x + dx, y + dy, z + dz, head);
  return true;
}

/** Retracts a piston; a sticky one drags whatever the head was against back with it. */
export function retract(w: PistonWorld, x: number, y: number, z: number, facing: string, sticky: boolean): void {
  const [dx, dy, dz] = FACING_OFFSET[facing];
  const headX = x + dx;
  const headY = y + dy;
  const headZ = z + dz;
  if (idOf(w.getBlock(headX, headY, headZ)) === 'piston_head') w.setBlock(headX, headY, headZ, 0);
  if (sticky) {
    const pulled = w.getBlock(headX + dx, headY + dy, headZ + dz);
    if (!isAir(pulled) && isMovable(pulled) && !isSoft(pulled)) {
      w.setBlock(headX + dx, headY + dy, headZ + dz, 0);
      w.setBlock(headX, headY, headZ, pulled);
    }
  }
  w.setBlock(x, y, z, blocks.stateWith(sticky ? 'sticky_piston' : 'piston', { facing, extended: 'false' }));
}
