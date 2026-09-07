/**
 * Nether portals: finding the obsidian frame a flint and steel was struck inside, filling it, and
 * working out where the other side comes out.
 *
 * Vanilla's rules, kept: a frame is obsidian around an opening two to twenty-one wide and three to
 * twenty-one tall, lying on the x or the z axis; the portal blocks take that axis; and a journey
 * divides or multiplies x and z by eight, which is what makes eight blocks of the Nether worth
 * sixty-four of the overworld.
 */
import { blocks } from '../blocks/registry.ts';
import type { Dimension } from './protocol.ts';

export interface PortalBlocks {
  get(x: number, y: number, z: number): number;
  set(x: number, y: number, z: number, state: number): void;
}

/** Vanilla's limits on the opening inside a frame. */
export const MIN_WIDTH = 2;
export const MAX_WIDTH = 21;
export const MIN_HEIGHT = 3;
export const MAX_HEIGHT = 21;
/** How long a player stands in a portal before it takes them (vanilla's portal wait time). */
export const PORTAL_WAIT = 80;
/** And how long before it will take them again, so they do not bounce straight back. */
export const PORTAL_COOLDOWN = 300;
/** Eight blocks of the Nether to sixty-four of the overworld. */
export const NETHER_SCALE = 8;

const isFrame = (state: number) => state !== 0 && blocks.blockOf(state).id === 'obsidian';
const isInside = (state: number) => state === 0 || blocks.blockOf(state).id === 'fire' || blocks.blockOf(state).id === 'nether_portal';

export interface FoundPortal {
  axis: 'x' | 'z';
  /** Every block of the opening. */
  cells: [number, number, number][];
}

/**
 * The opening a position sits in, if it is one: vanilla walks to the bottom-left of the hole, then
 * measures how wide and how tall it runs before the obsidian.
 */
export function findFrame(world: PortalBlocks, x: number, y: number, z: number): FoundPortal | null {
  for (const axis of ['x', 'z'] as const) {
    const found = frameOnAxis(world, x, y, z, axis);
    if (found) return found;
  }
  return null;
}

function frameOnAxis(world: PortalBlocks, x: number, y: number, z: number, axis: 'x' | 'z'): FoundPortal | null {
  const dx = axis === 'x' ? 1 : 0;
  const dz = axis === 'z' ? 1 : 0;
  if (!isInside(world.get(x, y, z))) return null;
  // walk down to the floor of the opening and back along the axis to its near edge
  let by = y;
  while (isInside(world.get(x, by - 1, z)) && y - by < MAX_HEIGHT) by--;
  if (!isFrame(world.get(x, by - 1, z))) return null;
  let bx = x, bz = z;
  while (isInside(world.get(bx - dx, by, bz - dz)) && Math.abs(bx - x) + Math.abs(bz - z) < MAX_WIDTH) {
    bx -= dx;
    bz -= dz;
  }
  if (!isFrame(world.get(bx - dx, by, bz - dz))) return null;
  // how far the opening runs, and how tall it is
  let width = 0;
  while (width <= MAX_WIDTH && isInside(world.get(bx + dx * width, by, bz + dz * width))) width++;
  if (width < MIN_WIDTH || width > MAX_WIDTH) return null;
  if (!isFrame(world.get(bx + dx * width, by, bz + dz * width))) return null;
  let height = 0;
  while (height <= MAX_HEIGHT) {
    let open = true;
    for (let i = 0; i < width; i++) if (!isInside(world.get(bx + dx * i, by + height, bz + dz * i))) open = false;
    if (!open) break;
    // the sides have to be obsidian all the way up
    if (!isFrame(world.get(bx - dx, by + height, bz - dz)) || !isFrame(world.get(bx + dx * width, by + height, bz + dz * width))) return null;
    height++;
  }
  if (height < MIN_HEIGHT || height > MAX_HEIGHT) return null;
  // and the lintel closes the top
  for (let i = 0; i < width; i++) if (!isFrame(world.get(bx + dx * i, by + height, bz + dz * i))) return null;
  const cells: [number, number, number][] = [];
  for (let i = 0; i < width; i++) for (let h = 0; h < height; h++) cells.push([bx + dx * i, by + h, bz + dz * i]);
  return { axis, cells };
}

/** Fills a found opening with portal blocks. Returns false if there was no frame to fill. */
export function lightPortal(world: PortalBlocks, x: number, y: number, z: number): boolean {
  const found = findFrame(world, x, y, z);
  if (!found) return false;
  const state = blocks.stateWith('nether_portal', { axis: found.axis });
  for (const [cx, cy, cz] of found.cells) world.set(cx, cy, cz, state);
  return true;
}

/** Where a journey between the two worlds comes out, before a portal is looked for there. */
export function scalePosition(x: number, z: number, from: Dimension, to: Dimension): [number, number] {
  if (from === 'overworld' && to === 'nether') return [Math.floor(x / NETHER_SCALE), Math.floor(z / NETHER_SCALE)];
  if (from === 'nether' && to === 'overworld') return [Math.floor(x * NETHER_SCALE), Math.floor(z * NETHER_SCALE)];
  return [Math.floor(x), Math.floor(z)];
}

/**
 * The nearest portal block to a position, searched the way vanilla searches: out through a box
 * around where the traveller arrived, nearest first.
 */
export function findPortalNear(world: PortalBlocks, x: number, y: number, z: number, radius: number, minY: number, maxY: number): [number, number, number] | null {
  const portal = blocks.defaultState('nether_portal');
  let best: [number, number, number] | null = null;
  let closest = Infinity;
  for (let dx = -radius; dx <= radius; dx++)
    for (let dz = -radius; dz <= radius; dz++)
      for (let cy = minY; cy <= maxY; cy++) {
        const cx = x + dx, cz = z + dz;
        const s = world.get(cx, cy, cz);
        if (s === 0 || blocks.blockOf(s).id !== 'nether_portal') continue;
        void portal;
        const d = dx * dx + dz * dz + (cy - y) * (cy - y);
        if (d < closest) {
          closest = d;
          best = [cx, cy, cz];
        }
      }
  return best;
}

/**
 * Vanilla builds a portal where it cannot find one: it looks for a flat spot with room over it,
 * carves the space, lays the obsidian frame and lights it. Returns the block to stand in.
 */
export function buildPortal(world: PortalBlocks, x: number, y: number, z: number, minY: number, maxY: number): [number, number, number] {
  const OBSIDIAN = blocks.defaultState('obsidian');
  const AIR = blocks.AIR;
  const [px, py, pz] = findPlatform(world, x, y, z, minY, maxY);
  // the frame stands in the plane x = px, its opening two blocks along z and four tall
  for (let dz = -1; dz <= 2; dz++)
    for (let dy = -1; dy <= 4; dy++)
      world.set(px, py + dy, pz + dz, AIR);
  for (let dy = -1; dy <= 4; dy++) {
    world.set(px, py + dy, pz - 1, OBSIDIAN);
    world.set(px, py + dy, pz + 2, OBSIDIAN);
  }
  for (let dz = 0; dz <= 1; dz++) {
    world.set(px, py - 1, pz + dz, OBSIDIAN);
    world.set(px, py + 4, pz + dz, OBSIDIAN);
  }
  // and a platform to arrive on, so nobody steps out into a lava fall
  for (let dz = -2; dz <= 3; dz++) for (let dx = -1; dx <= 1; dx++) if (world.get(px + dx, py - 1, pz + dz) === AIR) world.set(px + dx, py - 1, pz + dz, OBSIDIAN);
  const state = blocks.stateWith('nether_portal', { axis: 'z' });
  for (let dz = 0; dz <= 1; dz++) for (let dy = 0; dy <= 3; dy++) world.set(px, py + dy, pz + dz, state);
  return [px, py, pz];
}

/** A place to put a portal: the first spot with solid ground and five blocks of air over it. */
function findPlatform(world: PortalBlocks, x: number, y: number, z: number, minY: number, maxY: number): [number, number, number] {
  for (let r = 0; r <= 16; r += 2)
    for (let dx = -r; dx <= r; dx++)
      for (let dz = -r; dz <= r; dz++) {
        if (r > 0 && Math.max(Math.abs(dx), Math.abs(dz)) !== r) continue;
        for (let cy = Math.min(maxY - 6, y + 8); cy > minY + 1; cy--) {
          const under = world.get(x + dx, cy - 1, z + dz);
          if (under === 0 || !blocks.blockOf(under).solid) continue;
          let clear = true;
          for (let h = 0; h < 5 && clear; h++)
            for (let d = -1; d <= 2 && clear; d++)
              if (world.get(x + dx, cy + h, z + dz + d) !== 0) clear = false;
          if (clear) return [x + dx, cy, z + dz];
        }
      }
  // nothing suitable: vanilla carves a spot out anyway, at the height it arrived at
  return [x, Math.max(minY + 2, Math.min(maxY - 6, y)), z];
}
