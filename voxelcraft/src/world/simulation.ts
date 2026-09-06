/**
 * Main-thread block simulation: scheduled ticks (fluids, buttons, gravity), random ticks (crops,
 * grass, leaves, ...) and neighbour updates, dispatched to src/blocks/behaviors.ts.
 */
import { CHUNK_SIZE, SECTION_COUNT, WORLD_MIN_Y } from '../core/constants.ts';
import { blocks } from '../blocks/registry.ts';
import { behaviorFor, hasRandomTick, type BlockContext, type BlockWorld } from '../blocks/behaviors.ts';
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

export class Simulation {
  private readonly heap = new MinHeap();
  private readonly pending = new Set<string>();
  private neighborQueue: number[] = [];
  private seq = 0;
  /** Random ticks per section per game tick (vanilla default randomTickSpeed = 3). */
  randomTickSpeed = 3;
  simulationDistance = 6;

  constructor(private readonly w: BlockWorld, private readonly chunks: () => Iterable<LoadedChunk>) {}

  schedule(x: number, y: number, z: number, delay: number, now: number): void {
    const key = `${x},${y},${z}`;
    if (this.pending.has(key)) return;
    this.pending.add(key);
    this.heap.push({ time: now + Math.max(1, delay), seq: this.seq++, x, y, z });
  }

  /** Called for every block change; fires placement hooks and queues neighbour updates. */
  onBlockChanged(x: number, y: number, z: number, oldState: number, newState: number): void {
    void oldState;
    if (newState !== 0) {
      const def = blocks.blockOf(newState);
      const b = behaviorFor(def);
      if (b?.onPlaced) b.onPlaced({ w: this.w, x, y, z, state: newState, def });
    }
    for (const [dx, dy, dz] of NEIGHBORS) this.neighborQueue.push(x + dx, y + dy, z + dz, x, y, z);
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
    for (const c of this.chunks()) {
      if (Math.max(Math.abs(c.cx - centerCx), Math.abs(c.cz - centerCz)) > this.simulationDistance) continue;
      for (let sy = 0; sy < SECTION_COUNT; sy++) {
        for (let i = 0; i < this.randomTickSpeed; i++) {
          const r = rng.nextU32();
          const lx = r & 15;
          const ly = (r >> 4) & 15;
          const lz = (r >> 8) & 15;
          const y = WORLD_MIN_Y + sy * 16 + ly;
          const state = c.blocks[((y - WORLD_MIN_Y) * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
          if (state === 0) continue;
          const def = blocks.blockOf(state);
          if (!hasRandomTick(def)) continue;
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
