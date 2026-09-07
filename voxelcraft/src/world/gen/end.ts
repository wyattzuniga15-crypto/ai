/**
 * The End: the central island floating in the void, and the outer islands scattered past a
 * thousand blocks of nothing.
 *
 * The island shape is vanilla's own: a hundred minus eight times the distance from the middle,
 * with the outer islands found by walking a grid of noise samples around each column and taking
 * whichever island reaches furthest. Everything else here — how thick the lens is and what the
 * crags do to its edge — is ours, since vanilla's is a density function with no data behind it.
 */
import { CHUNK_SIZE } from '../../core/constants.ts';
import { blocks } from '../../blocks/registry.ts';
import { Noise } from '../../core/noise.ts';
import { Rng, mix } from '../../core/rng.ts';
import { biomeIndex } from '../biomes.ts';
import type { ChunkData } from '../chunk.ts';
import type { BlockAccess } from './features.ts';
import type { StructureSpot } from './generator.ts';
import type { StructureSet } from './structures.ts';

/** The height the main island sits at, and where the player arrives. */
export const END_SURFACE = 64;
/** Vanilla's arrival platform, five blocks square of obsidian at (100, 49, 0). */
export const END_PLATFORM: [number, number, number] = [100, 49, 0];
/** Nothing is generated outside this band, which is what makes the End a void. */
export const END_MIN_Y = 0;
export const END_MAX_Y = 128;

export class EndGenerator {
  readonly seed: number;
  structures: StructureSet[] = [];
  structureSpots: StructureSpot[] = [];
  private readonly island: Noise;
  private readonly detail: Noise;
  private readonly S: Record<string, number> = {};

  constructor(seed: number) {
    this.seed = seed >>> 0;
    this.island = new Noise(mix(this.seed, 201));
    this.detail = new Noise(mix(this.seed, 202));
  }

  private block(id: string): number {
    let s = this.S[id];
    if (s === undefined) s = this.S[id] = blocks.has(id) ? blocks.defaultState(id) : blocks.AIR;
    return s;
  }

  /**
   * Vanilla's island value for a column, in its own eight-block units: a hundred at the middle
   * falling off with distance, and any outer island whose own falloff reaches further.
   */
  islandAt(wx: number, wz: number): number {
    const x = Math.floor(wx / 8);
    const z = Math.floor(wz / 8);
    const kx = wx - x * 8;
    const kz = wz - z * 8;
    let f = Math.max(-100, Math.min(80, 100 - Math.hypot(wx, wz)));
    for (let i = -12; i <= 12; i++)
      for (let j = -12; j <= 12; j++) {
        const cx = x + i;
        const cz = z + j;
        // the outer islands only start once a thousand blocks of void are behind you
        if (cx * cx + cz * cz <= 4096) continue;
        if (this.island.noise2(cx * 0.35, cz * 0.35) >= -0.72) continue;
        const size = ((Math.abs(cx) * 3439 + Math.abs(cz) * 147) % 13) + 9;
        const dx = kx - i * 8;
        const dz = kz - j * 8;
        f = Math.max(f, Math.max(-100, Math.min(80, 100 - Math.hypot(dx, dz) * size / 8)));
      }
    return f;
  }

  generateTerrain(chunk: ChunkData): void {
    const END_STONE = this.block('end_stone');
    const biome = biomeIndex('the_end');
    const highlands = biomeIndex('end_highlands');
    const barrens = biomeIndex('end_barrens');
    const midlands = biomeIndex('end_midlands');
    const small = biomeIndex('small_end_islands');
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = chunk.cx * 16 + x;
        const wz = chunk.cz * 16 + z;
        const f = this.islandAt(wx, wz);
        const far = Math.hypot(wx, wz) > 1024;
        // vanilla's biomes: the middle island, then the rings, and the small islands beyond
        chunk.biomes[z * 16 + x] = far
          ? (f > 40 ? highlands : f > 20 ? midlands : f > 0 ? barrens : small)
          : biome;
        if (f <= 0) continue;
        // a lens of end stone, thickest in the middle of whatever island this is
        const crag = this.detail.fbm2(wx / 40, wz / 40, 3) * 6;
        const top = Math.round(END_SURFACE + f / 16 + crag * 0.4);
        const bottom = Math.round(END_SURFACE - f / 8 + crag);
        for (let y = Math.max(END_MIN_Y, bottom); y <= Math.min(END_MAX_Y, top); y++) {
          // the underside breaks up into crags rather than ending flat
          if (y < bottom + 2 && this.detail.noise3(wx / 12, y / 8, wz / 12) < -0.15) continue;
          chunk.set(x, y, z, END_STONE);
        }
      }
  }

  /** Chorus plants on the outer islands, and nothing at all on the middle one, as vanilla has it. */
  decorate(chunk: ChunkData, world: BlockAccess): void {
    this.structureSpots = [];
    const rng = new Rng(mix(this.seed, chunk.cx, chunk.cz, 0xdec2));
    const ox = chunk.cx * 16;
    const oz = chunk.cz * 16;
    if (Math.hypot(ox, oz) < 512) return; // nothing grows on the middle island, as vanilla leaves it bare
    for (let i = 0; i < 4; i++) {
      const x = ox + rng.int(16);
      const z = oz + rng.int(16);
      let y = -1;
      for (let cy = END_MAX_Y; cy > END_MIN_Y; cy--) {
        if (world.get(x, cy, z) === blocks.AIR) continue;
        y = cy;
        break;
      }
      if (y < 0 || blocks.blockOf(world.get(x, y, z)).id !== 'end_stone') continue;
      if (rng.next() < 0.35) this.chorusPlant(world, x, y + 1, z, rng);
    }
  }

  /** A chorus plant: a stem branching upward with a flower on each end, as vanilla grows one. */
  private chorusPlant(world: BlockAccess, x: number, y: number, z: number, rng: Rng): void {
    const PLANT = this.block('chorus_plant');
    const FLOWER = this.block('chorus_flower');
    const height = 2 + rng.int(4);
    for (let i = 0; i < height; i++) world.set(x, y + i, z, PLANT);
    // a branch or two off the trunk, each ending in a flower
    for (let b = 0; b < 1 + rng.int(3); b++) {
      const bx = x + rng.int(3) - 1;
      const bz = z + rng.int(3) - 1;
      const by = y + 1 + rng.int(Math.max(1, height - 1));
      if (bx === x && bz === z) continue;
      world.set(bx, by, bz, PLANT);
      world.set(bx, by + 1, bz, FLOWER);
    }
    world.set(x, y + height, z, FLOWER);
  }
}
