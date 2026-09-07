/**
 * Tripwire: a string strung between two hooks. Vanilla walks the run from a hook with
 * `TripWireHookBlock.calculateState` — up to forty-two blocks, ending at the hook facing back — and
 * powers both ends when anything stands on the string. These are the same walks.
 */
import { blocks } from '../blocks/registry.ts';
import type { PowerWorld } from './redstone.ts';

/** How far apart two hooks may be strung, as vanilla limits them. */
export const MAX_RUN = 42;

const HORIZONTAL: Record<string, [number, number]> = { north: [0, -1], south: [0, 1], west: [-1, 0], east: [1, 0] };
const OPPOSITE: Record<string, string> = { north: 'south', south: 'north', west: 'east', east: 'west' };

const idOf = (state: number) => (state === 0 ? 'air' : blocks.blockOf(state).id);

export interface Run {
  /** The string blocks between the two hooks, nearest the starting hook first. */
  strings: [number, number, number][];
  /** The hook at the far end, when the run reaches one. */
  end: [number, number, number] | null;
}

/** Walks a run out from a hook, the way vanilla does when a hook is placed or nudged. */
export function hookRun(w: PowerWorld, x: number, y: number, z: number): Run {
  const state = w.getBlock(x, y, z);
  if (idOf(state) !== 'tripwire_hook') return { strings: [], end: null };
  const facing = blocks.prop(state, 'facing') ?? 'north';
  const [dx, dz] = HORIZONTAL[facing];
  const strings: [number, number, number][] = [];
  for (let i = 1; i <= MAX_RUN; i++) {
    const px = x + dx * i;
    const pz = z + dz * i;
    const at = w.getBlock(px, y, pz);
    const id = idOf(at);
    if (id === 'tripwire') {
      strings.push([px, y, pz]);
      continue;
    }
    // the run ends at the hook facing back down it, and at anything else it is simply broken
    if (id === 'tripwire_hook' && blocks.prop(at, 'facing') === OPPOSITE[facing]) return { strings, end: [px, y, pz] };
    return { strings: [], end: null };
  }
  return { strings: [], end: null };
}

/** The hooks either end of the run a piece of string belongs to. */
export function hooksFor(w: PowerWorld, x: number, y: number, z: number): [number, number, number][] {
  const out: [number, number, number][] = [];
  for (const [dir, [dx, dz]] of Object.entries(HORIZONTAL)) {
    for (let i = 1; i <= MAX_RUN; i++) {
      const px = x + dx * i;
      const pz = z + dz * i;
      const at = w.getBlock(px, y, pz);
      const id = idOf(at);
      if (id === 'tripwire') continue;
      // a hook counts when it faces back along the run toward this string
      if (id === 'tripwire_hook' && blocks.prop(at, 'facing') === OPPOSITE[dir]) out.push([px, y, pz]);
      break;
    }
  }
  return out;
}

/**
 * Rewrites a whole run from one of its hooks: the hooks are attached when the run reaches the other
 * end, and both hooks and every string carry the signal when anything is standing on the wire.
 * Passing no `pressed` test rewrites the attachment alone and leaves the signal where it is, which
 * is what a block change beside the run needs.
 */
export function updateRun(w: PowerWorld, x: number, y: number, z: number, pressed?: (p: [number, number, number]) => boolean): void {
  const state = w.getBlock(x, y, z);
  if (idOf(state) !== 'tripwire_hook') return;
  const run = hookRun(w, x, y, z);
  const attached = run.end !== null;
  const powered = pressed ? attached && run.strings.some(pressed) : null;
  const write = (px: number, py: number, pz: number, id: string): void => {
    const at = w.getBlock(px, py, pz);
    if (idOf(at) !== id) return;
    let next = blocks.withProp(at, 'attached', attached ? 'true' : 'false');
    if (powered !== null) next = blocks.withProp(next, 'powered', powered ? 'true' : 'false');
    if (next !== at) w.setBlock(px, py, pz, next);
  };
  write(x, y, z, 'tripwire_hook');
  if (run.end) write(run.end[0], run.end[1], run.end[2], 'tripwire_hook');
  for (const [sx, sy, sz] of run.strings) write(sx, sy, sz, 'tripwire');
}

/**
 * Restrings every run touching a position, which is what placing or breaking either block needs.
 * Only the attachment is rewritten: whatever is standing on the wire is the game's to say.
 */
export function updateAround(w: PowerWorld, x: number, y: number, z: number): void {
  if (idOf(w.getBlock(x, y, z)) === 'tripwire_hook') {
    updateRun(w, x, y, z);
    return;
  }
  for (const [hx, hy, hz] of hooksFor(w, x, y, z)) updateRun(w, hx, hy, hz);
}
