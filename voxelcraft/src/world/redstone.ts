/**
 * Redstone power: what emits a signal, how strongly, and how dust carries it.
 *
 * Vanilla's model in miniature. A source emits a level from 0 to 15. Dust takes the strongest signal
 * reaching it and passes it on one weaker per block. A solid block next to a strong source (a torch
 * under it, a repeater into it) is charged, and anything touching that block reads the signal too,
 * which is what makes a torch under a block light a lamp beside it.
 */
import { blocks } from '../blocks/registry.ts';

export interface PowerWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, state: number): void;
}

/** The six directions, as vanilla names them, with their offsets. */
export const DIRECTIONS: Record<string, [number, number, number]> = {
  north: [0, 0, -1], south: [0, 0, 1], west: [-1, 0, 0], east: [1, 0, 0], up: [0, 1, 0], down: [0, -1, 0],
};
const SIDES = ['north', 'south', 'west', 'east'] as const;
const ALL = ['north', 'south', 'west', 'east', 'up', 'down'] as const;
const OPPOSITE: Record<string, string> = { north: 'south', south: 'north', west: 'east', east: 'west', up: 'down', down: 'up' };

const idOf = (state: number) => (state === 0 ? 'air' : blocks.blockOf(state).id);
const prop = (state: number, name: string) => blocks.prop(state, name);
const isOn = (state: number, name: string) => prop(state, name) === 'true';

/** A block a signal cannot pass through but can charge: vanilla's "conductive" test. */
export function conducts(state: number): boolean {
  if (state === 0) return false;
  const def = blocks.blockOf(state);
  if (!def.solid) return false;
  // glass and its friends look solid but carry nothing
  return !!blocks.stateOpaque[state];
}

/** Which way a lever or button faces out of the block it is on. */
function attachedFace(state: number): string {
  const face = prop(state, 'face');
  if (face === 'floor') return 'up';
  if (face === 'ceiling') return 'down';
  return prop(state, 'facing') ?? 'north';
}

/**
 * The signal a block sends into the neighbour that lies in direction `dir` from it. `strongOnly`
 * asks for vanilla's direct signal, which is what charges a solid block.
 */
export function emitted(w: PowerWorld, x: number, y: number, z: number, dir: string, strongOnly = false): number {
  const state = w.getBlock(x, y, z);
  if (!state) return 0;
  const id = idOf(state);
  switch (id) {
    case 'redstone_block':
      return strongOnly ? 0 : 15;
    case 'redstone_torch':
      // a floor torch powers everything but the block it stands on, and charges the block above it
      return dir === 'down' || !isOn(state, 'lit') ? 0 : strongOnly && dir !== 'up' ? 0 : 15;
    case 'redstone_wall_torch': {
      if (!isOn(state, 'lit')) return 0;
      const back = prop(state, 'facing') ?? 'north';
      if (dir === OPPOSITE[back]) return 0;
      return strongOnly && dir !== 'up' ? 0 : 15;
    }
    case 'lever':
    case 'stone_button': case 'oak_button': case 'spruce_button': case 'birch_button': case 'jungle_button':
    case 'acacia_button': case 'dark_oak_button': case 'mangrove_button': case 'cherry_button': case 'bamboo_button':
    case 'crimson_button': case 'warped_button': case 'polished_blackstone_button': {
      if (!isOn(state, 'powered')) return 0;
      // it charges the block it is fixed to, and gives a weak signal to everything else
      return strongOnly ? (dir === OPPOSITE[attachedFace(state)] ? 15 : 0) : 15;
    }
    case 'repeater': {
      if (!isOn(state, 'powered')) return 0;
      return prop(state, 'facing') === OPPOSITE[dir] ? 0 : prop(state, 'facing') === dir ? 15 : 0;
    }
    case 'comparator': {
      if (!isOn(state, 'powered')) return 0;
      return prop(state, 'facing') === dir ? 15 : 0;
    }
    case 'observer':
      return isOn(state, 'powered') && prop(state, 'facing') === dir ? 15 : 0;
    case 'daylight_detector':
    case 'target':
      return strongOnly ? 0 : Number(prop(state, 'power') ?? '0');
    case 'detector_rail':
      return isOn(state, 'powered') ? (strongOnly && dir !== 'up' ? 0 : 15) : 0;
    case 'redstone_wire': {
      if (strongOnly) return 0;
      const power = Number(prop(state, 'power') ?? '0');
      if (power === 0) return 0;
      // dust feeds the block under it and whatever it points at, never sideways past a corner.
      // the shape it is drawn in is the shape that carries the signal, cross ends included.
      if (dir === 'down') return power;
      if (dir === 'up') return 0;
      return prop(state, dir) === 'none' ? 0 : power;
    }
    default: {
      // plates carry their own power level; the pressure plate behaviour keeps it up to date
      if (id.endsWith('_pressure_plate')) {
        const power = prop(state, 'power');
        const level = power !== undefined ? Number(power) : isOn(state, 'powered') ? 15 : 0;
        return strongOnly && dir !== 'up' ? 0 : level;
      }
      return 0;
    }
  }
}

/** The strongest signal reaching a position from its six neighbours, charged blocks included. */
export function powerAt(w: PowerWorld, x: number, y: number, z: number): number {
  let best = 0;
  for (const dir of ALL) {
    const [dx, dy, dz] = DIRECTIONS[dir];
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    best = Math.max(best, emitted(w, nx, ny, nz, OPPOSITE[dir]));
    if (best >= 15) return 15;
    // a solid neighbour passes on whatever is strongly powering it
    const neighbour = w.getBlock(nx, ny, nz);
    if (!conducts(neighbour)) continue;
    for (const from of ALL) {
      if (from === OPPOSITE[dir]) continue;
      const [ex, ey, ez] = DIRECTIONS[from];
      best = Math.max(best, emitted(w, nx + ex, ny + ey, nz + ez, OPPOSITE[from], true));
      if (best >= 15) return 15;
    }
  }
  return best;
}

/** Whether anything is powering a block, which is all a door or a lamp needs to know. */
export function isPowered(w: PowerWorld, x: number, y: number, z: number): boolean {
  return powerAt(w, x, y, z) > 0;
}

// -------------------------------------------------------------------------------------------
// Dust
// -------------------------------------------------------------------------------------------

/** Whether dust links to what sits in a direction: another wire, a ramp up or down, or a source. */
export function wireConnection(w: PowerWorld, x: number, y: number, z: number, dir: string): 'none' | 'side' | 'up' {
  const [dx, , dz] = DIRECTIONS[dir];
  const side = w.getBlock(x + dx, y, z + dz);
  const sideId = idOf(side);
  if (sideId === 'redstone_wire') return 'side';
  if (connectsToWire(side, dir)) return 'side';
  // up a step, so long as the block over the wire does not cover the climb
  if (idOf(w.getBlock(x + dx, y + 1, z + dz)) === 'redstone_wire' && !conducts(w.getBlock(x, y + 1, z))) return 'up';
  // or down one, so long as the block in the way is not solid
  if (!conducts(side) && idOf(w.getBlock(x + dx, y - 1, z + dz)) === 'redstone_wire') return 'side';
  return 'none';
}

/** Things dust reaches out to on its own, the way it bends toward a repeater or a lever. */
function connectsToWire(state: number, dir: string): boolean {
  if (!state) return false;
  const id = idOf(state);
  if (id === 'repeater' || id === 'comparator') {
    const facing = prop(state, 'facing');
    return facing === dir || facing === OPPOSITE[dir];
  }
  return ['redstone_block', 'redstone_torch', 'redstone_wall_torch', 'lever', 'observer', 'daylight_detector', 'target', 'detector_rail', 'trapped_chest']
    .includes(id) || id.endsWith('_button') || id.endsWith('_pressure_plate');
}

/** The signal a piece of dust picks up from everything around it that is not dust. */
function wireSource(w: PowerWorld, x: number, y: number, z: number): number {
  let best = 0;
  for (const dir of ALL) {
    const [dx, dy, dz] = DIRECTIONS[dir];
    const nx = x + dx;
    const ny = y + dy;
    const nz = z + dz;
    const neighbour = w.getBlock(nx, ny, nz);
    if (idOf(neighbour) === 'redstone_wire') continue;
    best = Math.max(best, emitted(w, nx, ny, nz, OPPOSITE[dir]));
    if (conducts(neighbour)) {
      for (const from of ALL) {
        if (from === OPPOSITE[dir]) continue;
        const [ex, ey, ez] = DIRECTIONS[from];
        best = Math.max(best, emitted(w, nx + ex, ny + ey, nz + ez, OPPOSITE[from], true));
      }
    }
    if (best >= 15) return 15;
  }
  return best;
}

/** The dust each piece of dust passes power to: level, up a step, or down one. */
function wireNeighbours(w: PowerWorld, x: number, y: number, z: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const dir of SIDES) {
    const [dx, , dz] = DIRECTIONS[dir];
    const side = w.getBlock(x + dx, y, z + dz);
    if (idOf(side) === 'redstone_wire') out.push([x + dx, y, z + dz]);
    if (!conducts(side) && idOf(w.getBlock(x + dx, y - 1, z + dz)) === 'redstone_wire') out.push([x + dx, y - 1, z + dz]);
    if (!conducts(w.getBlock(x, y + 1, z)) && idOf(w.getBlock(x + dx, y + 1, z + dz)) === 'redstone_wire') out.push([x + dx, y + 1, z + dz]);
  }
  return out;
}

const MAX_NETWORK = 2000;

/**
 * Recomputes a whole dust network at once: gather it, take the strongest source feeding each piece,
 * then let the power fall away one level per block. Writing the results is what wakes the doors,
 * lamps and pistons attached to it, through the ordinary neighbour updates.
 */
export function updateWireNetwork(w: PowerWorld, x: number, y: number, z: number): void {
  if (idOf(w.getBlock(x, y, z)) !== 'redstone_wire') return;
  const key = (a: number, b: number, c: number) => `${a},${b},${c}`;
  const network: [number, number, number][] = [];
  const seen = new Set<string>([key(x, y, z)]);
  const queue: [number, number, number][] = [[x, y, z]];
  while (queue.length && network.length < MAX_NETWORK) {
    const at = queue.shift()!;
    network.push(at);
    for (const n of wireNeighbours(w, at[0], at[1], at[2])) {
      const k = key(n[0], n[1], n[2]);
      if (seen.has(k)) continue;
      seen.add(k);
      queue.push(n);
    }
  }

  // strongest source into each piece, then a flood outwards losing one level a block
  const level = new Map<string, number>();
  const front: [number, number, number][] = [];
  for (const [px, py, pz] of network) {
    const power = wireSource(w, px, py, pz);
    level.set(key(px, py, pz), power);
    if (power > 0) front.push([px, py, pz]);
  }
  front.sort((a, b) => level.get(key(b[0], b[1], b[2]))! - level.get(key(a[0], a[1], a[2]))!);
  while (front.length) {
    const [px, py, pz] = front.shift()!;
    const here = level.get(key(px, py, pz))!;
    if (here <= 1) continue;
    for (const [nx, ny, nz] of wireNeighbours(w, px, py, pz)) {
      const k = key(nx, ny, nz);
      if (!level.has(k)) continue;
      if (level.get(k)! >= here - 1) continue;
      level.set(k, here - 1);
      front.push([nx, ny, nz]);
    }
  }

  for (const [px, py, pz] of network) {
    const state = w.getBlock(px, py, pz);
    if (idOf(state) !== 'redstone_wire') continue;
    const power = level.get(key(px, py, pz)) ?? 0;
    const next = wireState(w, px, py, pz, power);
    if (next !== state) w.setBlock(px, py, pz, next);
  }
}

/** The state a piece of dust should have: its power and the shape it draws itself in. */
export function wireState(w: PowerWorld, x: number, y: number, z: number, power: number): number {
  const props: Record<string, string> = { power: String(power) };
  for (const dir of SIDES) props[dir] = wireConnection(w, x, y, z, dir);
  // vanilla straightens dust out: with nothing on one axis, the other axis reaches both ways, so a
  // lone piece is a cross and the end of a line still points onward into whatever it runs into
  const noNS = props.north === 'none' && props.south === 'none';
  const noEW = props.east === 'none' && props.west === 'none';
  if (props.west === 'none' && noNS) props.west = 'side';
  if (props.east === 'none' && noNS) props.east = 'side';
  if (props.north === 'none' && noEW) props.north = 'side';
  if (props.south === 'none' && noEW) props.south = 'side';
  return blocks.stateWith('redstone_wire', props);
}
