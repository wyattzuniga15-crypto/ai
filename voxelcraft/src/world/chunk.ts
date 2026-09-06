/**
 * Column of 16x384x16 blocks (y -64..319) with light, biome and heightmap data. Used verbatim on
 * both sides of the worker boundary; typed arrays make it cheap to post.
 */
import { CHUNK_SIZE, SECTION_COUNT, WORLD_HEIGHT, WORLD_MIN_Y } from '../core/constants.ts';
import { blocks } from '../blocks/registry.ts';

export const CHUNK_VOLUME = CHUNK_SIZE * CHUNK_SIZE * WORLD_HEIGHT;

export type ChunkStatus = 'empty' | 'terrain' | 'decorated' | 'lit' | 'ready';

export const chunkKey = (cx: number, cz: number): string => `${cx},${cz}`;

export function blockIndex(x: number, y: number, z: number): number {
  return ((y - WORLD_MIN_Y) * CHUNK_SIZE + z) * CHUNK_SIZE + x;
}

export function sectionOf(y: number): number {
  return (y - WORLD_MIN_Y) >> 4;
}

export interface ChunkSnapshot {
  cx: number;
  cz: number;
  blocks: Uint16Array;
  biomes: Uint8Array;
  status: ChunkStatus;
  modified: boolean;
}

export class ChunkData {
  readonly blocks: Uint16Array;
  /** sky << 4 | block light. */
  readonly light: Uint8Array;
  readonly biomes: Uint8Array;
  /** Lowest y such that every block at or above it in the column lets sky light through. */
  readonly heightmap: Int16Array;
  /** Number of non-air blocks per 16-block section, to skip meshing empty sections. */
  readonly sectionCounts: Uint16Array;
  status: ChunkStatus = 'empty';
  /** True once the player (or a saved game) changed something in this column. */
  modified = false;

  constructor(
    readonly cx: number,
    readonly cz: number,
    data?: Uint16Array,
    biomes?: Uint8Array,
  ) {
    this.blocks = data ?? new Uint16Array(CHUNK_VOLUME);
    this.light = new Uint8Array(CHUNK_VOLUME);
    this.biomes = biomes ?? new Uint8Array(CHUNK_SIZE * CHUNK_SIZE);
    this.heightmap = new Int16Array(CHUNK_SIZE * CHUNK_SIZE).fill(WORLD_MIN_Y);
    this.sectionCounts = new Uint16Array(SECTION_COUNT);
    if (data) this.recount();
  }

  get(x: number, y: number, z: number): number {
    return this.blocks[((y - WORLD_MIN_Y) * CHUNK_SIZE + z) * CHUNK_SIZE + x];
  }

  /** Sets a block and returns the previous state. Does not touch light. */
  set(x: number, y: number, z: number, state: number): number {
    const i = ((y - WORLD_MIN_Y) * CHUNK_SIZE + z) * CHUNK_SIZE + x;
    const old = this.blocks[i];
    if (old === state) return old;
    this.blocks[i] = state;
    const sy = (y - WORLD_MIN_Y) >> 4;
    if (old === 0 && state !== 0) this.sectionCounts[sy]++;
    else if (old !== 0 && state === 0) this.sectionCounts[sy]--;
    return old;
  }

  getSky(x: number, y: number, z: number): number {
    return this.light[((y - WORLD_MIN_Y) * CHUNK_SIZE + z) * CHUNK_SIZE + x] >> 4;
  }

  getBlockLight(x: number, y: number, z: number): number {
    return this.light[((y - WORLD_MIN_Y) * CHUNK_SIZE + z) * CHUNK_SIZE + x] & 15;
  }

  setSky(x: number, y: number, z: number, v: number): void {
    const i = ((y - WORLD_MIN_Y) * CHUNK_SIZE + z) * CHUNK_SIZE + x;
    this.light[i] = (this.light[i] & 15) | (v << 4);
  }

  setBlockLight(x: number, y: number, z: number, v: number): void {
    const i = ((y - WORLD_MIN_Y) * CHUNK_SIZE + z) * CHUNK_SIZE + x;
    this.light[i] = (this.light[i] & 0xf0) | v;
  }

  isSectionEmpty(sy: number): boolean {
    return this.sectionCounts[sy] === 0;
  }

  recount(): void {
    this.sectionCounts.fill(0);
    const per = CHUNK_SIZE * CHUNK_SIZE * CHUNK_SIZE;
    for (let sy = 0; sy < SECTION_COUNT; sy++) {
      let n = 0;
      const base = sy * per;
      for (let i = 0; i < per; i++) if (this.blocks[base + i] !== 0) n++;
      this.sectionCounts[sy] = n;
    }
  }

  /** Recomputes the light heightmap for one column. */
  updateHeightmap(x: number, z: number): void {
    const filter = blocks.stateFilter;
    let y = WORLD_MIN_Y + WORLD_HEIGHT - 1;
    for (; y >= WORLD_MIN_Y; y--) {
      if (filter[this.get(x, y, z)] > 0) break;
    }
    this.heightmap[z * CHUNK_SIZE + x] = y + 1;
  }

  updateHeightmapAll(): void {
    for (let z = 0; z < CHUNK_SIZE; z++) for (let x = 0; x < CHUNK_SIZE; x++) this.updateHeightmap(x, z);
  }

  /** Highest non-air block in a column, or WORLD_MIN_Y - 1 when empty. */
  topBlock(x: number, z: number): number {
    for (let y = WORLD_MIN_Y + WORLD_HEIGHT - 1; y >= WORLD_MIN_Y; y--) if (this.get(x, y, z) !== 0) return y;
    return WORLD_MIN_Y - 1;
  }

  snapshot(): ChunkSnapshot {
    return { cx: this.cx, cz: this.cz, blocks: this.blocks.slice(), biomes: this.biomes.slice(), status: this.status, modified: this.modified };
  }
}
