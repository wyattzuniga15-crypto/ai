/**
 * The Nether: a hundred and twenty-eight blocks of netherrack between two sheets of bedrock, with a
 * sea of lava in the bottom of it and vanilla's five biomes laid over the lot.
 *
 * Vanilla picks a nether biome by searching its climate points for the one nearest the noise at a
 * position, which is what this does with vanilla's own five points. The terrain is 3D noise closed
 * off at the floor and the roof, the way vanilla's nether noise router is, rather than a height map:
 * the Nether is caves all the way down and needs the overhangs.
 */
import { CHUNK_SIZE } from '../../core/constants.ts';
import { blocks } from '../../blocks/registry.ts';
import { Noise } from '../../core/noise.ts';
import { Rng, hashPos, mix } from '../../core/rng.ts';
import { biomeIndex, biomes } from '../biomes.ts';
import type { ChunkData } from '../chunk.ts';
import type { BlockAccess } from './features.ts';
import type { StructureSpot } from './generator.ts';
import type { StructureSet } from './structures.ts';

/** The Nether is generated between these, with bedrock at both ends, as vanilla builds it. */
export const NETHER_FLOOR = 0;
export const NETHER_ROOF = 127;
/** Vanilla's lava sea fills to here. */
export const NETHER_LAVA_LEVEL = 31;

/** Vanilla's nether climate points: temperature, humidity, and the offset that breaks ties. */
const CLIMATE: { id: string; t: number; h: number; offset: number }[] = [
  { id: 'nether_wastes', t: 0, h: 0, offset: 0 },
  { id: 'soul_sand_valley', t: 0, h: -0.5, offset: 0 },
  { id: 'crimson_forest', t: 0.4, h: 0, offset: 0 },
  { id: 'warped_forest', t: 0, h: 0.5, offset: 0.375 },
  { id: 'basalt_deltas', t: -0.5, h: 0, offset: 0.175 },
];

export class NetherGenerator {
  readonly seed: number;
  /** Structures are installed the same way as the overworld's, though none reach here yet. */
  structures: StructureSet[] = [];
  structureSpots: StructureSpot[] = [];
  private readonly density: Noise;
  private readonly detail: Noise;
  private readonly temperature: Noise;
  private readonly humidity: Noise;
  private readonly patch: Noise;
  private readonly S: Record<string, number> = {};
  private readonly biomeCache = new Map<number, number>();

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const n = (salt: number) => new Noise(mix(this.seed, salt));
    this.density = n(101);
    this.detail = n(102);
    this.temperature = n(103);
    this.humidity = n(104);
    this.patch = n(105);
  }

  private block(id: string): number {
    let s = this.S[id];
    if (s === undefined) s = this.S[id] = blocks.has(id) ? blocks.defaultState(id) : blocks.AIR;
    return s;
  }

  /** The biome at a column: vanilla's nearest climate point to the noise there. */
  biomeAt(wx: number, wz: number): number {
    const key = (wx & 0xffff) | ((wz & 0xffff) << 16);
    const cached = this.biomeCache.get(key);
    if (cached !== undefined) return cached;
    const t = this.temperature.fbm2(wx / 320, wz / 320, 3);
    const h = this.humidity.fbm2(wx / 280 + 900, wz / 280 - 900, 3);
    let best = 0;
    let closest = Infinity;
    for (const c of CLIMATE) {
      const d = (t - c.t) ** 2 + (h - c.h) ** 2 + c.offset * c.offset;
      if (d < closest) {
        closest = d;
        best = biomeIndex(c.id);
      }
    }
    if (this.biomeCache.size > 8192) this.biomeCache.clear();
    this.biomeCache.set(key, best);
    return best;
  }

  /**
   * Solid where the noise says so, with the floor and the roof pulled shut. Vanilla's nether noise
   * closes over the last few blocks under the roof and above the floor, which is what keeps the
   * dimension a closed box however open the caverns inside it get.
   */
  private solidAt(wx: number, y: number, wz: number): boolean {
    if (y <= NETHER_FLOOR || y >= NETHER_ROOF) return true;
    // stretched wide and squashed short, so the caverns come out broad and low like vanilla's
    // rather than as a forest of columns
    const n = this.density.fbm3(wx / 70, y / 28, wz / 70, 4);
    // the ceiling and the floor close over; the middle is open cavern
    const closeRoof = Math.max(0, (y - (NETHER_ROOF - 12)) / 12);
    const closeFloor = Math.max(0, (NETHER_FLOOR + 10 - y) / 10);
    const shape = Math.max(closeRoof, closeFloor) * 1.4;
    // a soft band of open air across the middle, so caverns join up the way vanilla's do
    const open = 0.05 - Math.abs(y - 58) / 400;
    return n + shape - open > 0;
  }

  generateTerrain(chunk: ChunkData): void {
    const NETHERRACK = this.block('netherrack');
    const LAVA = this.block('lava');
    const BEDROCK = this.block('bedrock');
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = chunk.cx * 16 + x;
        const wz = chunk.cz * 16 + z;
        chunk.biomes[z * 16 + x] = this.biomeAt(wx, wz);
        for (let y = NETHER_FLOOR; y <= NETHER_ROOF; y++) {
          if (this.solidAt(wx, y, wz)) chunk.set(x, y, z, NETHERRACK);
          else if (y <= NETHER_LAVA_LEVEL) chunk.set(x, y, z, LAVA);
        }
        // vanilla's bedrock is a solid course with four rough ones over (and under) it
        chunk.set(x, NETHER_FLOOR, z, BEDROCK);
        chunk.set(x, NETHER_ROOF, z, BEDROCK);
        for (let i = 1; i <= 4; i++) {
          if (hashPos(this.seed, wx, i, wz) < 1 - i / 5) chunk.set(x, NETHER_FLOOR + i, z, BEDROCK);
          if (hashPos(this.seed, wx, NETHER_ROOF - i, wz ^ 0x77) < 1 - i / 5) chunk.set(x, NETHER_ROOF - i, z, BEDROCK);
        }
      }
    this.surface(chunk);
  }

  /** Dresses every exposed run of netherrack in what its biome is made of. */
  private surface(chunk: ChunkData): void {
    const NETHERRACK = this.block('netherrack');
    const AIR = blocks.AIR;
    const LAVA = this.block('lava');
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = chunk.cx * 16 + x;
        const wz = chunk.cz * 16 + z;
        const biome = biomes[chunk.biomes[z * 16 + x]].id;
        const patch = this.patch.fbm2(wx / 24, wz / 24, 2);
        let air = false;
        for (let y = NETHER_ROOF - 1; y > NETHER_FLOOR; y--) {
          const s = chunk.get(x, y, z);
          if (s === AIR || s === LAVA) {
            air = true;
            continue;
          }
          if (!air || s !== NETHERRACK) {
            air = false;
            continue;
          }
          air = false;
          // the top of a run: what a biome shows the world
          if (biome === 'soul_sand_valley') {
            const soil = patch > 0 ? 'soul_sand' : 'soul_soil';
            for (let d = 0; d < 4 && chunk.get(x, y - d, z) === NETHERRACK; d++) chunk.set(x, y - d, z, this.block(soil));
          } else if (biome === 'crimson_forest') {
            chunk.set(x, y, z, this.block('crimson_nylium'));
          } else if (biome === 'warped_forest') {
            chunk.set(x, y, z, this.block('warped_nylium'));
          } else if (biome === 'basalt_deltas') {
            const top = patch > 0.15 ? 'basalt' : 'blackstone';
            for (let d = 0; d < 3 && chunk.get(x, y - d, z) === NETHERRACK; d++) chunk.set(x, y - d, z, this.block(top));
          } else if (patch > 0.55) {
            for (let d = 0; d < 3 && chunk.get(x, y - d, z) === NETHERRACK; d++) chunk.set(x, y - d, z, this.block('soul_sand'));
          } else if (patch < -0.6) {
            for (let d = 0; d < 3 && chunk.get(x, y - d, z) === NETHERRACK; d++) chunk.set(x, y - d, z, this.block('gravel'));
          }
        }
      }
    this.ores(chunk);
  }

  /** Vanilla's nether ores: quartz and gold through the whole column, debris deep, magma at the sea. */
  private ores(chunk: ChunkData): void {
    const NETHERRACK = this.block('netherrack');
    const rng = new Rng(mix(this.seed, chunk.cx, chunk.cz, 0x0e2e));
    const blob = (id: string, tries: number, size: number, minY: number, maxY: number) => {
      const state = this.block(id);
      for (let i = 0; i < tries; i++) {
        const cx = rng.int(16), cz = rng.int(16);
        const cy = minY + rng.int(Math.max(1, maxY - minY));
        for (let n = 0; n < size; n++) {
          const x = cx + rng.int(3) - 1, y = cy + rng.int(3) - 1, z = cz + rng.int(3) - 1;
          if (x < 0 || x > 15 || z < 0 || z > 15 || y <= NETHER_FLOOR || y >= NETHER_ROOF) continue;
          if (chunk.get(x, y, z) !== NETHERRACK) continue;
          chunk.set(x, y, z, state);
        }
      }
    };
    blob('nether_quartz_ore', 16, 14, 10, 117);
    blob('nether_gold_ore', 10, 10, 10, 117);
    blob('magma_block', 4, 12, NETHER_LAVA_LEVEL - 4, NETHER_LAVA_LEVEL + 2);
    // ancient debris is rare and deep, and vanilla never lets it touch open air
    for (let i = 0; i < 2; i++) {
      const x = rng.int(16), z = rng.int(16), y = 8 + rng.int(15);
      if (chunk.get(x, y, z) !== NETHERRACK) continue;
      let buried = true;
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const n = x + dx < 0 || x + dx > 15 || z + dz < 0 || z + dz > 15 ? NETHERRACK : chunk.get(x + dx, y + dy, z + dz);
        if (n === blocks.AIR) buried = false;
      }
      if (buried) chunk.set(x, y, z, this.block('ancient_debris'));
    }
  }

  /**
   * What grows on the netherrack once the shape is settled: the forests' fungi and vines, the
   * glowstone hanging off the ceilings, fires, and the basalt pillars of the deltas.
   */
  decorate(chunk: ChunkData, world: BlockAccess): void {
    this.structureSpots = [];
    const rng = new Rng(mix(this.seed, chunk.cx, chunk.cz, 0xdec1));
    const ox = chunk.cx * 16;
    const oz = chunk.cz * 16;
    const AIR = blocks.AIR;
    const solid = (x: number, y: number, z: number) => world.get(x, y, z) !== AIR;

    /** The highest floor in a column: the top of the first solid run under the roof. */
    const floorAt = (x: number, z: number): number => {
      let air = false;
      for (let y = NETHER_ROOF - 1; y > NETHER_FLOOR; y--) {
        const s = world.get(x, y, z);
        if (s === AIR) {
          air = true;
          continue;
        }
        if (air) return y;
      }
      return -1;
    };
    /** The ceiling over a floor, so vines and glowstone know what to hang from. */
    const ceilingAbove = (x: number, y: number, z: number): number => {
      for (let cy = y + 2; cy < NETHER_ROOF; cy++) if (solid(x, cy, z)) return cy;
      return -1;
    };

    for (let i = 0; i < 12; i++) {
      const x = ox + rng.int(16);
      const z = oz + rng.int(16);
      const y = floorAt(x, z);
      if (y < 0) continue;
      const biome = biomes[chunk.biomes[(z - oz) * 16 + (x - ox)]].id;
      const on = world.get(x, y, z);
      const above = y + 1;
      if (biome === 'crimson_forest' && on === this.block('crimson_nylium')) {
        if (rng.next() < 0.25) this.hugeFungus(world, x, above, z, rng, true);
        else world.set(x, above, z, this.block(rng.next() < 0.4 ? 'crimson_fungus' : 'crimson_roots'));
      } else if (biome === 'warped_forest' && on === this.block('warped_nylium')) {
        if (rng.next() < 0.18) this.hugeFungus(world, x, above, z, rng, false);
        else world.set(x, above, z, this.block(rng.next() < 0.35 ? 'warped_fungus' : rng.next() < 0.5 ? 'nether_sprouts' : 'warped_roots'));
      } else if (biome === 'basalt_deltas' && rng.next() < 0.35) {
        // vanilla's basalt columns: a stack of basalt standing out of the delta
        const h = 2 + rng.int(5);
        for (let dy = 0; dy < h; dy++) world.set(x, above + dy, z, this.block('basalt'));
      } else if (biome === 'soul_sand_valley' && rng.next() < 0.25) {
        world.set(x, above, z, this.block(rng.next() < 0.5 ? 'soul_fire' : 'bone_block'));
      } else if (rng.next() < 0.2) {
        world.set(x, above, z, this.block('fire'));
      }
      // glowstone and vines hang from whatever ceiling is over the spot
      const ceiling = ceilingAbove(x, y, z);
      if (ceiling > 0 && rng.next() < 0.3) {
        const glow = this.block('glowstone');
        for (let n = 0; n < 6; n++) {
          const gx = x + rng.int(3) - 1, gz = z + rng.int(3) - 1, gy = ceiling - rng.int(2);
          if (world.get(gx, gy, gz) === AIR) world.set(gx, gy, gz, glow);
        }
      }
      if (ceiling > 0 && biome === 'crimson_forest' && rng.next() < 0.4) {
        const vine = this.block('weeping_vines');
        for (let dy = 1; dy <= 1 + rng.int(4); dy++) if (world.get(x, ceiling - dy, z) === AIR) world.set(x, ceiling - dy, z, vine);
      }
      if (biome === 'warped_forest' && rng.next() < 0.3) {
        const vine = this.block('twisting_vines');
        for (let dy = 1; dy <= 1 + rng.int(4); dy++) if (world.get(x, y + dy, z) === AIR) world.set(x, y + dy, z, vine);
      }
    }
  }

  /** A huge crimson or warped fungus: a stem with a cap of wart blocks and a shroomlight or two. */
  private hugeFungus(world: BlockAccess, x: number, y: number, z: number, rng: Rng, crimson: boolean): void {
    const stem = this.block(crimson ? 'crimson_stem' : 'warped_stem');
    const wart = this.block(crimson ? 'nether_wart_block' : 'warped_wart_block');
    const light = this.block('shroomlight');
    const h = 4 + rng.int(6);
    for (let dy = 0; dy < h; dy++) world.set(x, y + dy, z, stem);
    const top = y + h;
    for (let dx = -2; dx <= 2; dx++)
      for (let dz = -2; dz <= 2; dz++) {
        if (Math.abs(dx) + Math.abs(dz) > 3) continue;
        world.set(x + dx, top, z + dz, wart);
        if (Math.abs(dx) + Math.abs(dz) >= 2 && rng.next() < 0.15) world.set(x + dx, top - 1, z + dz, light);
      }
    world.set(x, top + 1, z, wart);
  }
}
