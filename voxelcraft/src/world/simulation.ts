/**
 * Main-thread block simulation: scheduled ticks (fluids, buttons, gravity), random ticks (crops,
 * grass, leaves, ...) and neighbour updates, dispatched to src/blocks/behaviors.ts.
 */
import { CHUNK_SIZE, SECTION_COUNT, WORLD_MIN_Y } from '../core/constants.ts';
import { blocks } from '../blocks/registry.ts';
import { behaviorFor, randomTickable, type BlockContext, type BlockWorld } from '../blocks/behaviors.ts';
import type { LoadedChunk } from './world.ts';

interface Scheduled {
  time: number;
  seq: number;
  x: number;
  y: number;
  z: number;
}

class MinHeap {
  private readonly a: Scheduled[] = [];

  get size(): number {
    return this.a.length;
  }

  peek(): Scheduled | undefined {
    return this.a[0];
  }

  push(s: Scheduled): void {
    const a = this.a;
    a.push(s);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].time < a[i].time || (a[p].time === a[i].time && a[p].seq < a[i].seq)) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop(): Scheduled | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = i * 2 + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && (a[l].time < a[m].time || (a[l].time === a[m].time && a[l].seq < a[m].seq))) m = l;
        if (r < a.length && (a[r].time < a[m].time || (a[r].time === a[m].time && a[r].seq < a[m].seq))) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const NEIGHBORS: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

/** Blocks whose change can move a redstone signal, and so need the wider update. */
function carriesSignal(state: number): boolean {
  if (state === 0) return false;
  const def = blocks.blockOf(state);
  return def.behavior === 'redstone' || def.behavior === 'button' || def.behavior === 'pressure_plate'
    || def.id === 'redstone_block' || def.id === 'redstone_wall_torch' || !!blocks.stateOpaque[state];
}

export class Simulation {
  private readonly heap = new MinHeap();
  private readonly pending = new Set<string>();
  private neighborQueue: number[] = [];
  private seq = 0;
  /** Random ticks per section per game tick (vanilla default randomTickSpeed = 3). */
  randomTickSpeed = 3;
  simulationDistance = 6;

  /**
   * Which sections of a chunk hold anything at all, by chunk key. Vanilla only random-ticks the
   * sections that are not empty, and in a normal world most of a column is sky.
   */
  private readonly tickMasks = new Map<string, Uint8Array>();

  constructor(private readonly w: BlockWorld, private readonly chunks: () => Iterable<LoadedChunk>) {}

  /** Forgets what a chunk's sections held, after generation or a reload has rewritten them. */
  invalidateChunk(cx: number, cz: number): void {
    this.tickMasks.delete(`${cx},${cz}`);
  }

  /** Works the mask out the first time a chunk is asked about, and keeps it until it is edited. */
  private sectionsWithBlocks(c: LoadedChunk): Uint8Array {
    const key = `${c.cx},${c.cz}`;
    const cached = this.tickMasks.get(key);
    if (cached) return cached;
    const mask = new Uint8Array(SECTION_COUNT);
    const perSection = 16 * CHUNK_SIZE * CHUNK_SIZE;
    for (let sy = 0; sy < SECTION_COUNT; sy++) {
      const from = sy * perSection;
      for (let i = from; i < from + perSection; i++) {
        if (c.blocks[i] === 0) continue;
        mask[sy] = 1;
        break;
      }
    }
    if (this.tickMasks.size > 1024) this.tickMasks.clear();
    this.tickMasks.set(key, mask);
    return mask;
  }

  schedule(x: number, y: number, z: number, delay: number, now: number): void {
    const key = `${x},${y},${z}`;
    if (this.pending.has(key)) return;
    this.pending.add(key);
    this.heap.push({ time: now + Math.max(1, delay), seq: this.seq++, x, y, z });
  }

  /** Called for every block change; fires placement hooks and queues neighbour updates. */
  onBlockChanged(x: number, y: number, z: number, oldState: number, newState: number): void {
    void oldState;
    // the section this cell is in may have gone from empty to not: its mask has to be worked out again
    if (newState !== 0) this.tickMasks.delete(`${x >> 4},${z >> 4}`);
    if (newState !== 0) {
      const def = blocks.blockOf(newState);
      const b = behaviorFor(def);
      if (b?.onPlaced) b.onPlaced({ w: this.w, x, y, z, state: newState, def });
    }
    for (const [dx, dy, dz] of NEIGHBORS) this.neighborQueue.push(x + dx, y + dy, z + dz, x, y, z);
    // a redstone change also wakes the neighbours of its neighbours, which is how a signal reaches
    // through a block it charges to the torch or dust on the far side of it
    if (!carriesSignal(oldState) && !carriesSignal(newState)) return;
    for (const [dx, dy, dz] of NEIGHBORS)
      for (const [ex, ey, ez] of NEIGHBORS) {
        if (dx + ex === 0 && dy + ey === 0 && dz + ez === 0) continue;
        this.neighborQueue.push(x + dx + ex, y + dy + ey, z + dz + ez, x + dx, y + dy, z + dz);
      }
  }

  tick(now: number, centerCx: number, centerCz: number): void {
    // scheduled ticks
    let guard = 0;
    while (this.heap.size && this.heap.peek()!.time <= now && guard++ < 20000) {
      const s = this.heap.pop()!;
      this.pending.delete(`${s.x},${s.y},${s.z}`);
      const state = this.w.getBlock(s.x, s.y, s.z);
      if (state === 0) continue;
      const def = blocks.blockOf(state);
      const b = behaviorFor(def);
      b?.scheduledTick?.({ w: this.w, x: s.x, y: s.y, z: s.z, state, def });
    }
    // random ticks
    const rng = this.w.rng;
    const ticks = randomTickable();
    for (const c of this.chunks()) {
      if (Math.max(Math.abs(c.cx - centerCx), Math.abs(c.cz - centerCz)) > this.simulationDistance) continue;
      const mask = this.sectionsWithBlocks(c);
      for (let sy = 0; sy < SECTION_COUNT; sy++) {
        if (!mask[sy]) continue; // nothing but sky in there
        for (let i = 0; i < this.randomTickSpeed; i++) {
          const r = rng.nextU32();
          const lx = r & 15;
          const ly = (r >> 4) & 15;
          const lz = (r >> 8) & 15;
          const y = WORLD_MIN_Y + sy * 16 + ly;
          const state = c.blocks[((y - WORLD_MIN_Y) * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
          if (state === 0 || !ticks[state]) continue;
          const def = blocks.blockOf(state);
          const ctx: BlockContext = { w: this.w, x: c.cx * 16 + lx, y, z: c.cz * 16 + lz, state, def };
          behaviorFor(def)!.randomTick!(ctx);
        }
      }
    }
    // neighbour updates (may enqueue more; bounded per tick)
    let processed = 0;
    while (this.neighborQueue.length && processed < 8192) {
      const q = this.neighborQueue;
      this.neighborQueue = [];
      for (let i = 0; i + 5 < q.length; i += 6) {
        const x = q[i], y = q[i + 1], z = q[i + 2];
        const state = this.w.getBlock(x, y, z);
        if (state === 0) continue;
        const def = blocks.blockOf(state);
        const b = behaviorFor(def);
        b?.onNeighborChanged?.({ w: this.w, x, y, z, state, def }, q[i + 3], q[i + 4], q[i + 5]);
        processed++;
      }
    }
  }
}
