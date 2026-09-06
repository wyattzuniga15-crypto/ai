/**
 * Flood-fill light engine (sky and block channels, 0..15) working across chunk borders. Runs in
 * the world worker, which owns the authoritative chunk data. Every cell it changes is recorded as a
 * dirty section so the mesher can rebuild exactly what changed.
 */
import { CHUNK_SIZE, WORLD_MIN_Y, WORLD_MAX_Y } from '../core/constants.ts';
import { blocks } from '../blocks/registry.ts';
import type { ChunkData } from './chunk.ts';

export interface ChunkProvider {
  getChunk(cx: number, cz: number): ChunkData | undefined;
}

export const sectionKey = (cx: number, sy: number, cz: number): string => `${cx},${sy},${cz}`;

/** Growable queue of (x, y, z, value) tuples. */
class LightQueue {
  private data = new Int32Array(4 * 4096);
  private head = 0;
  private tail = 0;

  get length(): number {
    return this.tail - this.head;
  }

  push(x: number, y: number, z: number, v: number): void {
    if (this.tail * 4 + 4 > this.data.length) {
      if (this.head > 0) {
        this.data.copyWithin(0, this.head * 4, this.tail * 4);
        this.tail -= this.head;
        this.head = 0;
      }
      if (this.tail * 4 + 4 > this.data.length) {
        const bigger = new Int32Array(this.data.length * 2);
        bigger.set(this.data);
        this.data = bigger;
      }
    }
    const i = this.tail * 4;
    this.data[i] = x;
    this.data[i + 1] = y;
    this.data[i + 2] = z;
    this.data[i + 3] = v;
    this.tail++;
  }

  /** Reads the next tuple into `out` and returns false when empty. */
  shift(out: Int32Array): boolean {
    if (this.head >= this.tail) {
      this.head = this.tail = 0;
      return false;
    }
    const i = this.head * 4;
    out[0] = this.data[i];
    out[1] = this.data[i + 1];
    out[2] = this.data[i + 2];
    out[3] = this.data[i + 3];
    this.head++;
    return true;
  }
}

const DX = [0, 0, 0, 0, -1, 1];
const DY = [-1, 1, 0, 0, 0, 0];
const DZ = [0, 0, -1, 1, 0, 0];

export class LightEngine {
  /** Sections whose light changed since the last `takeDirty()`. */
  private dirty = new Set<string>();
  private readonly skyAdd = new LightQueue();
  private readonly skyRemove = new LightQueue();
  private readonly blockAdd = new LightQueue();
  private readonly blockRemove = new LightQueue();
  private readonly tmp = new Int32Array(4);
  private lastChunk: ChunkData | undefined;
  private lastCx = NaN;
  private lastCz = NaN;

  constructor(private readonly chunks: ChunkProvider) {}

  takeDirty(): string[] {
    const out = [...this.dirty];
    this.dirty.clear();
    return out;
  }

  private chunkAt(x: number, z: number): ChunkData | undefined {
    const cx = x >> 4;
    const cz = z >> 4;
    if (cx === this.lastCx && cz === this.lastCz) return this.lastChunk;
    this.lastCx = cx;
    this.lastCz = cz;
    return (this.lastChunk = this.chunks.getChunk(cx, cz));
  }

  /** Call whenever chunks are added or removed so the one-entry cache can't go stale. */
  invalidateCache(): void {
    this.lastCx = NaN;
    this.lastCz = NaN;
    this.lastChunk = undefined;
  }

  getState(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.get(x & 15, y, z & 15) : 0;
  }

  getSky(x: number, y: number, z: number): number {
    if (y > WORLD_MAX_Y) return 15;
    if (y < WORLD_MIN_Y) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.getSky(x & 15, y, z & 15) : 0;
  }

  getBlockLight(x: number, y: number, z: number): number {
    if (y < WORLD_MIN_Y || y > WORLD_MAX_Y) return 0;
    const c = this.chunkAt(x, z);
    return c ? c.getBlockLight(x & 15, y, z & 15) : 0;
  }

  private markDirty(x: number, y: number, z: number): void {
    const cx = x >> 4;
    const cz = z >> 4;
    const sy = (y - WORLD_MIN_Y) >> 4;
    this.dirty.add(sectionKey(cx, sy, cz));
    // Faces on section borders sample neighbouring cells, so touch neighbours when on an edge.
    const lx = x & 15;
    const lz = z & 15;
    const ly = (y - WORLD_MIN_Y) & 15;
    if (lx === 0) this.dirty.add(sectionKey(cx - 1, sy, cz));
    if (lx === 15) this.dirty.add(sectionKey(cx + 1, sy, cz));
    if (lz === 0) this.dirty.add(sectionKey(cx, sy, cz - 1));
    if (lz === 15) this.dirty.add(sectionKey(cx, sy, cz + 1));
    if (ly === 0 && sy > 0) this.dirty.add(sectionKey(cx, sy - 1, cz));
    if (ly === 15 && sy < 23) this.dirty.add(sectionKey(cx, sy + 1, cz));
  }

  // ---------------------------------------------------------------------------------------------
  // Initial lighting of a freshly generated (or loaded) chunk
  // ---------------------------------------------------------------------------------------------
  initChunk(chunk: ChunkData): void {
    this.invalidateCache();
    const ox = chunk.cx * CHUNK_SIZE;
    const oz = chunk.cz * CHUNK_SIZE;
    const filter = blocks.stateFilter;
    const emit = blocks.stateEmit;
    chunk.light.fill(0);
    chunk.updateHeightmapAll();
    // direct sky columns
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const top = chunk.heightmap[z * 16 + x];
        for (let y = top; y <= WORLD_MAX_Y; y++) chunk.setSky(x, y, z, 15);
      }
    // seeds: the lowest sky cell of each column, cliff faces next to lower columns, chunk edges
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const top = chunk.heightmap[z * 16 + x];
        if (top <= WORLD_MAX_Y) this.skyAdd.push(ox + x, top, oz + z, 15);
        for (let d = 2; d < 6; d++) {
          const nx = x + DX[d];
          const nz = z + DZ[d];
          let ntop: number;
          if (nx < 0 || nx > 15 || nz < 0 || nz > 15) {
            const nc = this.chunks.getChunk(chunk.cx + (nx < 0 ? -1 : nx > 15 ? 1 : 0), chunk.cz + (nz < 0 ? -1 : nz > 15 ? 1 : 0));
            if (!nc) continue;
            ntop = nc.heightmap[(nz & 15) * 16 + (nx & 15)];
          } else ntop = chunk.heightmap[nz * 16 + nx];
          // every sky cell of this column that faces a lower neighbour column can light it sideways
          for (let y = top; y < ntop; y++) this.skyAdd.push(ox + x, y, oz + z, 15);
        }
      }
    // pull light in from already-lit neighbour chunks along the four borders
    for (let d = 2; d < 6; d++) {
      const nc = this.chunks.getChunk(chunk.cx + DX[d], chunk.cz + DZ[d]);
      if (!nc || nc.status === 'empty' || nc.status === 'terrain' || nc.status === 'decorated') continue;
      for (let i = 0; i < CHUNK_SIZE; i++) {
        const nx = d === 4 ? 15 : d === 5 ? 0 : i;
        const nz = d === 2 ? 15 : d === 3 ? 0 : i;
        const wx = nc.cx * 16 + nx;
        const wz = nc.cz * 16 + nz;
        for (let y = WORLD_MIN_Y; y <= WORLD_MAX_Y; y++) {
          const s = nc.getSky(nx, y, nz);
          if (s > 1) this.skyAdd.push(wx, y, wz, s);
          const b = nc.getBlockLight(nx, y, nz);
          if (b > 1) this.blockAdd.push(wx, y, wz, b);
        }
      }
    }
    // emitters
    const data = chunk.blocks;
    for (let i = 0; i < data.length; i++) {
      const e = emit[data[i]];
      if (e > 0) {
        const x = i & 15;
        const z = (i >> 4) & 15;
        const y = (i >> 8) + WORLD_MIN_Y;
        chunk.setBlockLight(x, y, z, e);
        this.blockAdd.push(ox + x, y, oz + z, e);
      }
    }
    void filter;
    this.propagate();
    this.markChunkDirty(chunk);
  }

  private markChunkDirty(chunk: ChunkData): void {
    for (let sy = 0; sy < 24; sy++) this.dirty.add(sectionKey(chunk.cx, sy, chunk.cz));
  }

  // ---------------------------------------------------------------------------------------------
  // Incremental updates
  // ---------------------------------------------------------------------------------------------
  /** Must be called after the block has been written to its chunk. */
  onBlockChanged(x: number, y: number, z: number, oldState: number, newState: number): void {
    this.invalidateCache();
    const chunk = this.chunkAt(x, z);
    if (!chunk) return;
    const lx = x & 15;
    const lz = z & 15;
    const oldFilter = blocks.stateFilter[oldState];
    const newFilter = blocks.stateFilter[newState];
    const oldEmit = blocks.stateEmit[oldState];
    const newEmit = blocks.stateEmit[newState];
    const oldTop = chunk.heightmap[lz * 16 + lx];
    chunk.updateHeightmap(lx, lz);
    const newTop = chunk.heightmap[lz * 16 + lx];

    // --- sky light ---
    if (newFilter > oldFilter || newTop > oldTop) {
      // more opaque: remove the cell's light and everything that depended on it
      const cur = chunk.getSky(lx, y, lz);
      if (cur > 0) {
        chunk.setSky(lx, y, lz, 0);
        this.skyRemove.push(x, y, z, cur);
      }
      // the direct sky column below the new block loses its source
      if (newTop > oldTop) {
        for (let yy = y - 1; yy >= oldTop; yy--) {
          const v = chunk.getSky(lx, yy, lz);
          if (v === 0) continue;
          chunk.setSky(lx, yy, lz, 0);
          this.skyRemove.push(x, yy, z, v);
        }
      }
      this.markDirty(x, y, z);
    }
    if (newFilter < oldFilter || newTop < oldTop) {
      // more transparent: extend the sky column and let neighbours flow in
      if (newTop < oldTop) {
        for (let yy = oldTop - 1; yy >= newTop; yy--) {
          chunk.setSky(lx, yy, lz, 15);
          this.skyAdd.push(x, yy, z, 15);
        }
      }
      for (let d = 0; d < 6; d++) {
        const v = this.getSky(x + DX[d], y + DY[d], z + DZ[d]);
        if (v > 1) this.skyAdd.push(x + DX[d], y + DY[d], z + DZ[d], v);
      }
      this.markDirty(x, y, z);
    }
    if (newFilter === oldFilter && newTop === oldTop) {
      // e.g. water -> ice: still refresh so the mesh gets rebuilt
      this.markDirty(x, y, z);
    }

    // --- block light ---
    const curB = chunk.getBlockLight(lx, y, lz);
    if (curB > 0 && (newEmit < curB || newFilter > oldFilter)) {
      chunk.setBlockLight(lx, y, lz, 0);
      this.blockRemove.push(x, y, z, curB);
    }
    if (newEmit > 0) {
      chunk.setBlockLight(lx, y, lz, newEmit);
      this.blockAdd.push(x, y, z, newEmit);
    } else if (newFilter < oldFilter) {
      for (let d = 0; d < 6; d++) {
        const v = this.getBlockLight(x + DX[d], y + DY[d], z + DZ[d]);
        if (v > 1) this.blockAdd.push(x + DX[d], y + DY[d], z + DZ[d], v);
      }
    }
    this.propagate();
  }

  propagate(): void {
    this.invalidateCache();
    this.drainRemove(this.skyRemove, this.skyAdd, true);
    this.drainAdd(this.skyAdd, true);
    this.drainRemove(this.blockRemove, this.blockAdd, false);
    this.drainAdd(this.blockAdd, false);
  }

  private drainAdd(queue: LightQueue, sky: boolean): void {
    const t = this.tmp;
    const filter = blocks.stateFilter;
    while (queue.shift(t)) {
      const x = t[0];
      const y = t[1];
      const z = t[2];
      const level = t[3];
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        const nz = z + DZ[d];
        if (ny < WORLD_MIN_Y || ny > WORLD_MAX_Y) continue;
        const nc = this.chunkAt(nx, nz);
        if (!nc) continue;
        const lx = nx & 15;
        const lz = nz & 15;
        const f = filter[nc.get(lx, ny, lz)];
        if (f >= 15) continue;
        let nl: number;
        if (sky && d === 0 && level === 15) nl = 15 - f;
        else nl = level - Math.max(1, f);
        if (nl <= 0) continue;
        const cur = sky ? nc.getSky(lx, ny, lz) : nc.getBlockLight(lx, ny, lz);
        if (cur >= nl) continue;
        if (sky) nc.setSky(lx, ny, lz, nl);
        else nc.setBlockLight(lx, ny, lz, nl);
        this.markDirty(nx, ny, nz);
        queue.push(nx, ny, nz, nl);
      }
    }
  }

  private drainRemove(queue: LightQueue, addQueue: LightQueue, sky: boolean): void {
    const t = this.tmp;
    while (queue.shift(t)) {
      const x = t[0];
      const y = t[1];
      const z = t[2];
      const level = t[3];
      for (let d = 0; d < 6; d++) {
        const nx = x + DX[d];
        const ny = y + DY[d];
        const nz = z + DZ[d];
        if (ny < WORLD_MIN_Y || ny > WORLD_MAX_Y) continue;
        const nc = this.chunkAt(nx, nz);
        if (!nc) continue;
        const lx = nx & 15;
        const lz = nz & 15;
        const cur = sky ? nc.getSky(lx, ny, lz) : nc.getBlockLight(lx, ny, lz);
        if (cur === 0) continue;
        // A cell fed by this one has a strictly lower level, except sky light straight below a 15.
        const dependent = cur < level || (sky && d === 0 && level === 15 && cur === 15 && ny < nc.heightmap[lz * 16 + lx]);
        if (dependent) {
          if (sky) nc.setSky(lx, ny, lz, 0);
          else nc.setBlockLight(lx, ny, lz, 0);
          this.markDirty(nx, ny, nz);
          queue.push(nx, ny, nz, cur);
        } else {
          addQueue.push(nx, ny, nz, cur);
        }
      }
    }
  }
}
