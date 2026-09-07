/**
 * Rails: the shape a piece of track takes from what it is next to, and how a powered rail finds its
 * signal. Vanilla works this out in `RailState`; the rules below are the same ones, shortened.
 */
import { blocks } from '../blocks/registry.ts';
import { isPowered, type PowerWorld } from './redstone.ts';

const HORIZONTAL: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const OPPOSITE: Record<string, string> = { north: 'south', south: 'north', west: 'east', east: 'west' };

/** Straight and curved shapes, by the pair of sides they join. */
const STRAIGHT: Record<string, string> = { north: 'north_south', south: 'north_south', west: 'east_west', east: 'east_west' };
const CURVES: Record<string, string> = {
  'north,east': 'north_east', 'north,west': 'north_west', 'south,east': 'south_east', 'south,west': 'south_west',
};

export const isRail = (state: number): boolean => state !== 0 && blocks.blockOf(state).id.endsWith('rail');
const idOf = (state: number) => (state === 0 ? 'air' : blocks.blockOf(state).id);

/** Only plain rails bend round a corner; the powered kinds stay straight. */
export const canCurve = (id: string): boolean => id === 'rail';

/**
 * Where a rail can join: the neighbours that hold rails, level with it or one step up or down.
 * The value is 'up' when the neighbouring rail is a step above, which is what makes a slope.
 */
export function railLinks(w: PowerWorld, x: number, y: number, z: number): Record<string, 'level' | 'up' | 'down'> {
  const out: Record<string, 'level' | 'up' | 'down'> = {};
  for (const [dir, [dx, dz]] of Object.entries(HORIZONTAL)) {
    if (isRail(w.getBlock(x + dx, y, z + dz))) out[dir] = 'level';
    else if (isRail(w.getBlock(x + dx, y + 1, z + dz))) out[dir] = 'up';
    else if (isRail(w.getBlock(x + dx, y - 1, z + dz))) out[dir] = 'down';
  }
  return out;
}

/** The shape a rail should take where it lies, following vanilla's preferences. */
export function railShape(w: PowerWorld, x: number, y: number, z: number, id: string, current?: string): string {
  const links = railLinks(w, x, y, z);
  const dirs = Object.keys(links);
  if (!dirs.length) return current && !current.includes('ascending') ? current : 'north_south';
  if (dirs.length === 1) {
    const dir = dirs[0];
    return links[dir] === 'up' ? `ascending_${dir}` : STRAIGHT[dir];
  }
  // two or more: keep a straight line where one exists, else bend if this rail is allowed to
  for (const dir of dirs) {
    if (links[OPPOSITE[dir]] === undefined) continue;
    if (links[dir] === 'up') return `ascending_${dir}`;
    if (links[OPPOSITE[dir]] === 'up') return `ascending_${OPPOSITE[dir]}`;
    return STRAIGHT[dir];
  }
  if (canCurve(id)) {
    const ns = dirs.find((d) => d === 'north' || d === 'south');
    const ew = dirs.find((d) => d === 'west' || d === 'east');
    if (ns && ew) return CURVES[`${ns},${ew}`];
  }
  const dir = dirs[0];
  return links[dir] === 'up' ? `ascending_${dir}` : STRAIGHT[dir];
}

/**
 * A powered rail turns on from a signal at itself or from another powered rail up to eight along
 * the track, which is vanilla's `findPoweredRailSignal`.
 */
export function railPowered(w: PowerWorld, x: number, y: number, z: number, shape: string, depth = 0): boolean {
  if (isPowered(w, x, y, z)) return true;
  if (depth >= 8) return false;
  const along = shape.includes('east_west') || shape.includes('ascending_east') || shape.includes('ascending_west')
    ? ['west', 'east']
    : ['north', 'south'];
  for (const dir of along) {
    const [dx, dz] = HORIZONTAL[dir];
    for (const dy of [0, 1, -1]) {
      const nx = x + dx;
      const ny = y + dy;
      const nz = z + dz;
      const state = w.getBlock(nx, ny, nz);
      if (idOf(state) !== 'powered_rail') continue;
      const nextShape = blocks.prop(state, 'shape') ?? 'north_south';
      // the run has to carry on the same way, so a corner does not carry power round it
      if (!nextShape.includes(dir === 'west' || dir === 'east' ? 'east_west' : 'north_south')
        && !nextShape.startsWith('ascending')) break;
      if (railPowered(w, nx, ny, nz, nextShape, depth + 1)) return true;
      break;
    }
  }
  return false;
}
