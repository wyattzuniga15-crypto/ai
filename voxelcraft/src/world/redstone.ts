/**
 * Redstone power: what emits a signal, how strongly, and how dust carries it.
 *
 * Vanilla's model in miniature. A source emits a level from 0 to 15. Dust takes the strongest signal
 * reaching it and passes it on one weaker per block. A solid block next to a strong source (a torch
 * under it, a repeater into it) is charged, and anything touching that block reads the signal too,
 * which is what makes a torch under a block light a lamp beside it.
 */
import { blocks } from '../blocks/registry.ts';
import { items } from '../items/registry.ts';
import { songForDisc } from '../items/jukebox.ts';
import type { BlockEntity } from '../blocks/blockEntity.ts';
import type { Slot } from '../items/inventory.ts';

export interface PowerWorld {
  getBlock(x: number, y: number, z: number): number;
  setBlock(x: number, y: number, z: number, state: number): void;
  /** What a container at a position holds, which is what a comparator reads out of it. */
  getBlockEntity?(x: number, y: number, z: number): BlockEntity | null | undefined;
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


// -------------------------------------------------------------------------------------------
// What a comparator reads
// -------------------------------------------------------------------------------------------
/**
 * Vanilla's `AbstractContainerMenu.getRedstoneSignalFromContainer`: every stack counts for the
 * fraction of its own stack limit that it fills, the fractions are averaged over every slot, and
 * anything at all in the container is worth at least one.
 */
export function containerSignal(slots: readonly Slot[]): number {
  if (!slots.length) return 0;
  let f = 0;
  for (const s of slots) {
    if (!s || s.count <= 0) continue;
    f += s.count / Math.max(1, items.maxStack(s.id));
  }
  f /= slots.length;
  return Math.floor(f * 14) + (f > 0 ? 1 : 0);
}

/**
 * The level a block hands a comparator that reads it, or null for a block with nothing to say.
 * Vanilla calls this a block's analog output signal, and it is what makes a comparator measure a
 * chest, a cauldron, a composter or the record a jukebox is spinning.
 */
export function analogOutput(w: PowerWorld, x: number, y: number, z: number): number | null {
  const state = w.getBlock(x, y, z);
  if (!state) return null;
  const id = idOf(state);
  const entity = w.getBlockEntity?.(x, y, z);
  switch (id) {
    case 'composter':
      return Number(prop(state, 'level') ?? '0');
    case 'cauldron':
      return 0;
    case 'water_cauldron':
    case 'powder_snow_cauldron':
      return Number(prop(state, 'level') ?? '0');
    case 'lava_cauldron':
      return 3;
    case 'beehive':
    case 'bee_nest':
      return Number(prop(state, 'honey_level') ?? '0');
    case 'cake':
      // vanilla: two for every bite still to be taken
      return (7 - Number(prop(state, 'bites') ?? '0')) * 2;
    case 'respawn_anchor':
      return Number(prop(state, 'charges') ?? '0');
    case 'end_portal_frame':
      return isOn(state, 'eye') ? 15 : 0;
    case 'jukebox': {
      const disc = entity && 'items' in entity ? entity.items[0] : null;
      return disc ? songForDisc(disc.id)?.comparator ?? 0 : 0;
    }
    case 'lectern': {
      if (!entity || entity.type !== 'lectern' || !entity.book) return 0;
      const pages = Math.max(1, entity.book.pages?.length ?? 1);
      // vanilla spreads the pages over fourteen levels, with the first page worth one
      return pages > 1 ? Math.floor((entity.page / (pages - 1)) * 14) + 1 : 15;
    }
    case 'crafter': {
      // vanilla counts a crafter's slots rather than weighing them: a slot that is filled or
      // switched off is worth one
      if (!entity || entity.type !== 'crafter') return 0;
      let n = 0;
      for (let i = 0; i < entity.items.length; i++) if (entity.items[i] || entity.disabled[i]) n++;
      return n;
    }
    default:
      break;
  }
  if (entity && 'items' in entity) return containerSignal(entity.items);
  return null;
}

/**
 * What feeds a comparator's side. Vanilla is fussy here: only a redstone block, dust, or another
 * diode pointing into it counts, so a torch or a lever beside a comparator is ignored.
 */
function sideSignal(w: PowerWorld, x: number, y: number, z: number, dir: string): number {
  const state = w.getBlock(x, y, z);
  if (!state) return 0;
  const id = idOf(state);
  if (id === 'redstone_block') return 15;
  if (id === 'redstone_wire') return Number(prop(state, 'power') ?? '0');
  if (id === 'repeater' || id === 'comparator') return emitted(w, x, y, z, dir);
  return 0;
}

/** How far one comparator may read another before the chain is cut, which vanilla never needs. */
const COMPARATOR_MAX_DEPTH = 8;
let comparatorDepth = 0;

/**
 * What a comparator puts out, on vanilla's own reading: the stronger of the redstone behind it and
 * whatever the block behind it has to say, measured against the stronger of its two sides. In
 * compare mode a side that beats the input silences it; in subtract mode it is taken off.
 */
export function comparatorOutput(w: PowerWorld, x: number, y: number, z: number, state: number): number {
  if (comparatorDepth >= COMPARATOR_MAX_DEPTH) return 0;
  comparatorDepth++;
  try {
    const facing = prop(state, 'facing') ?? 'north';
    const back = OPPOSITE[facing];
    const [bx, , bz] = DIRECTIONS[back];
    // vanilla reads what the block behind sends this way, and dust whatever way it happens to point
    const behindState = w.getBlock(x + bx, y, z + bz);
    let input = emitted(w, x + bx, y, z + bz, facing);
    if (idOf(behindState) === 'redstone_wire') input = Math.max(input, Number(prop(behindState, 'power') ?? '0'));
    const behind = analogOutput(w, x + bx, y, z + bz);
    if (behind !== null) input = behind;
    else if (input < 15 && conducts(behindState)) {
      // vanilla looks one block further when a solid block is in the way, for a container behind it
      const further = analogOutput(w, x + bx * 2, y, z + bz * 2);
      if (further !== null) input = further;
    }
    const sides = facing === 'north' || facing === 'south' ? ['west', 'east'] : ['north', 'south'];
    let side = 0;
    for (const dir of sides) {
      const [dx, , dz] = DIRECTIONS[dir];
      side = Math.max(side, sideSignal(w, x + dx, y, z + dz, OPPOSITE[dir]));
    }
    return prop(state, 'mode') === 'subtract' ? Math.max(0, input - side) : input >= side ? input : 0;
  } finally {
    comparatorDepth--;
  }
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
      // vanilla's comparator puts out a level rather than a switch, which is the whole point of it
      if (prop(state, 'facing') !== dir) return 0;
      return comparatorOutput(w, x, y, z, state);
    }
    case 'observer':
      // the eye watches the block it faces and the signal comes out of the back, so an
      // observer powers the side opposite the one it is watching
      return isOn(state, 'powered') && prop(state, 'facing') === OPPOSITE[dir] ? 15 : 0;
    case 'daylight_detector':
    case 'target':
      return strongOnly ? 0 : Number(prop(state, 'power') ?? '0');
    case 'detector_rail':
      return isOn(state, 'powered') ? (strongOnly && dir !== 'up' ? 0 : 15) : 0;
    case 'tripwire_hook': {
      if (!isOn(state, 'powered')) return 0;
      // like a button, it charges the block it hangs on and gives everything else a weak signal
      return strongOnly ? (dir === OPPOSITE[prop(state, 'facing') ?? 'north'] ? 15 : 0) : 15;
    }
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
  return ['redstone_block', 'redstone_torch', 'redstone_wall_torch', 'lever', 'observer', 'daylight_detector', 'target', 'detector_rail', 'tripwire_hook', 'trapped_chest']
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

/**
 * How hard a target block was hit: vanilla scores the shot by how near the middle of the face the
 * arrow struck, from 1 at the rim to 15 in the bullseye.
 */
export function targetStrength(bx: number, by: number, bz: number, px: number, py: number, pz: number): number {
  const dx = Math.abs(px - bx - 0.5);
  const dy = Math.abs(py - by - 0.5);
  const dz = Math.abs(pz - bz - 0.5);
  // the axis the arrow came in along does not count, so the smallest of the three pairs wins
  const off = Math.min(Math.max(dy, dz), Math.max(dx, dz), Math.max(dx, dy));
  return Math.max(1, Math.ceil(15 * Math.max(0, Math.min(1, (0.5 - off) / 0.5))));
}
