/**
 * Deterministic overworld generator. Stage 1 (terrain) is a pure function of seed and chunk
 * position: heightmap noise, 3D density for cliffs, caves, ores, surface blocks, water. Stage 2
 * (decorate) places trees and vegetation once the 3x3 neighbourhood has terrain, writing through a
 * BlockAccess so features can cross chunk borders.
 */
import { CHUNK_SIZE, SEA_LEVEL, WORLD_MIN_Y } from '../../core/constants.ts';
import { Noise } from '../../core/noise.ts';
import { Rng, hashPos, mix } from '../../core/rng.ts';
import { blocks } from '../../blocks/registry.ts';
import { biomeIndex, biomes } from '../biomes.ts';
import { ChunkData } from '../chunk.ts';
import { placeTallPlant, placeTree, type BlockAccess } from './features.ts';

const st = (id: string) => blocks.defaultState(id);

interface OreConfig {
  block: string;
  deepslate?: string;
  /** Attempts per chunk (fractions are probabilities). */
  count: number;
  min: number;
  max: number;
  distribution: 'uniform' | 'triangular';
  size: number;
  /** Probability to skip a block that touches air. */
  discardOnAir?: number;
  biomes?: string[];
}

const ORES: OreConfig[] = [
  { block: 'coal_ore', deepslate: 'deepslate_coal_ore', count: 30, min: 136, max: 319, distribution: 'uniform', size: 17 },
  { block: 'coal_ore', deepslate: 'deepslate_coal_ore', count: 20, min: 0, max: 192, distribution: 'triangular', size: 17 },
  { block: 'iron_ore', deepslate: 'deepslate_iron_ore', count: 90, min: 80, max: 319, distribution: 'triangular', size: 9 },
  { block: 'iron_ore', deepslate: 'deepslate_iron_ore', count: 10, min: -24, max: 56, distribution: 'triangular', size: 9 },
  { block: 'iron_ore', deepslate: 'deepslate_iron_ore', count: 10, min: -64, max: 72, distribution: 'uniform', size: 4 },
  { block: 'copper_ore', deepslate: 'deepslate_copper_ore', count: 16, min: -16, max: 112, distribution: 'triangular', size: 10 },
  { block: 'gold_ore', deepslate: 'deepslate_gold_ore', count: 4, min: -64, max: 32, distribution: 'triangular', size: 9 },
  { block: 'gold_ore', deepslate: 'deepslate_gold_ore', count: 0.5, min: -64, max: -48, distribution: 'uniform', size: 9 },
  { block: 'gold_ore', deepslate: 'deepslate_gold_ore', count: 50, min: 32, max: 256, distribution: 'uniform', size: 9, biomes: ['badlands', 'eroded_badlands', 'wooded_badlands'] },
  { block: 'redstone_ore', deepslate: 'deepslate_redstone_ore', count: 4, min: -64, max: 15, distribution: 'uniform', size: 8 },
  { block: 'redstone_ore', deepslate: 'deepslate_redstone_ore', count: 8, min: -96, max: -32, distribution: 'triangular', size: 8 },
  { block: 'diamond_ore', deepslate: 'deepslate_diamond_ore', count: 7, min: -144, max: 16, distribution: 'triangular', size: 4, discardOnAir: 0.5 },
  { block: 'diamond_ore', deepslate: 'deepslate_diamond_ore', count: 2, min: -64, max: -4, distribution: 'uniform', size: 8, discardOnAir: 0.5 },
  { block: 'diamond_ore', deepslate: 'deepslate_diamond_ore', count: 1 / 9, min: -144, max: 16, distribution: 'triangular', size: 12, discardOnAir: 0.7 },
  { block: 'diamond_ore', deepslate: 'deepslate_diamond_ore', count: 4, min: -144, max: 16, distribution: 'triangular', size: 8, discardOnAir: 1 },
  { block: 'lapis_ore', deepslate: 'deepslate_lapis_ore', count: 2, min: -32, max: 32, distribution: 'triangular', size: 7 },
  { block: 'lapis_ore', deepslate: 'deepslate_lapis_ore', count: 4, min: -64, max: 64, distribution: 'uniform', size: 7, discardOnAir: 1 },
  { block: 'emerald_ore', deepslate: 'deepslate_emerald_ore', count: 100, min: -16, max: 319, distribution: 'triangular', size: 3, biomes: ['meadow', 'grove', 'snowy_slopes', 'jagged_peaks', 'frozen_peaks', 'stony_peaks', 'windswept_hills', 'windswept_gravelly_hills', 'windswept_forest', 'cherry_grove'] },
  { block: 'tuff', count: 2, min: -64, max: 0, distribution: 'uniform', size: 64 },
  { block: 'gravel', count: 14, min: -64, max: 319, distribution: 'uniform', size: 33 },
  { block: 'dirt', count: 7, min: 0, max: 160, distribution: 'uniform', size: 33 },
  { block: 'granite', count: 2, min: 0, max: 60, distribution: 'uniform', size: 64 },
  { block: 'diorite', count: 2, min: 0, max: 60, distribution: 'uniform', size: 64 },
  { block: 'andesite', count: 2, min: 0, max: 60, distribution: 'uniform', size: 64 },
  { block: 'granite', count: 1 / 6, min: 64, max: 128, distribution: 'uniform', size: 64 },
  { block: 'diorite', count: 1 / 6, min: 64, max: 128, distribution: 'uniform', size: 64 },
  { block: 'andesite', count: 1 / 6, min: 64, max: 128, distribution: 'uniform', size: 64 },
];

const MOUNTAIN_BIOMES = new Set(['snowy_slopes', 'jagged_peaks', 'frozen_peaks', 'stony_peaks', 'grove', 'meadow', 'windswept_hills', 'windswept_forest', 'windswept_gravelly_hills']);

export interface ColumnInfo {
  height: number;
  biome: number;
  river: boolean;
}

export class WorldGenerator {
  readonly seed: number;
  private readonly continental: Noise;
  private readonly erosion: Noise;
  private readonly peaks: Noise;
  private readonly temperature: Noise;
  private readonly humidity: Noise;
  private readonly weird: Noise;
  private readonly river: Noise;
  private readonly density: Noise;
  private readonly cheese: Noise;
  private readonly spagA: Noise;
  private readonly spagB: Noise;
  private readonly noodle: Noise;
  private readonly detail: Noise;

  private readonly S: Record<string, number>;
  private readonly stone: number;
  private readonly deepslate: number;
  private readonly water: number;
  private readonly lava: number;
  private readonly bedrock: number;
  private readonly air: number;

  constructor(seed: number) {
    this.seed = seed >>> 0;
    const n = (salt: number) => new Noise(mix(this.seed, salt));
    this.continental = n(1);
    this.erosion = n(2);
    this.peaks = n(3);
    this.temperature = n(4);
    this.humidity = n(5);
    this.weird = n(6);
    this.river = n(7);
    this.density = n(8);
    this.cheese = n(9);
    this.spagA = n(10);
    this.spagB = n(11);
    this.noodle = n(12);
    this.detail = n(13);
    this.S = {};
    this.stone = st('stone');
    this.deepslate = st('deepslate');
    this.water = st('water');
    this.lava = st('lava');
    this.bedrock = st('bedrock');
    this.air = blocks.AIR;
  }

  private block(id: string): number {
    let s = this.S[id];
    if (s === undefined) s = this.S[id] = st(id);
    return s;
  }

  // ---------------------------------------------------------------------------------------------
  // Climate and terrain shape
  // ---------------------------------------------------------------------------------------------
  private baseHeight(c: number, e: number, pv: number): { h: number; amp: number } {
    // continentalness spline
    let h: number;
    if (c < -0.5) h = 24 + (c + 1) * 20;
    else if (c < -0.2) h = 34 + ((c + 0.5) / 0.3) * 22;
    else if (c < -0.08) h = 56 + ((c + 0.2) / 0.12) * 8;
    else if (c < 0.3) h = 64 + ((c + 0.08) / 0.38) * 14;
    else if (c < 0.6) h = 78 + ((c - 0.3) / 0.3) * 40;
    else h = 118 + ((c - 0.6) / 0.4) * 80;
    // erosion flattens; peaks & valleys add relief scaled by how rugged the area is
    const rugged = (1 - e) * 0.5; // 0 flat .. 1 rugged
    const amp = c < -0.08 ? 6 + rugged * 8 : 8 + rugged * (c > 0.3 ? 70 : 30);
    h += pv * amp;
    return { h, amp };
  }

  columnInfo(wx: number, wz: number): ColumnInfo {
    const c = this.continental.fbm2(wx / 1400, wz / 1400, 4);
    const e = this.erosion.fbm2(wx / 700, wz / 700, 3);
    const pv = this.peaks.fbm2(wx / 180, wz / 180, 4);
    const t = this.temperature.fbm2(wx / 1600 + 100, wz / 1600, 3);
    const hu = this.humidity.fbm2(wx / 1100, wz / 1100 + 100, 3);
    const w = this.weird.fbm2(wx / 900, wz / 900, 2);
    let { h } = this.baseHeight(c, e, pv);
    let river = false;
    if (c > -0.2 && h < 110) {
      const r = this.river.ridge2(wx / 520, wz / 520, 2);
      const width = 0.035 + Math.max(0, e) * 0.02;
      if (r < width) {
        const depth = (1 - r / width) * 8;
        const riverBed = Math.min(h, 62 - depth * 0.6);
        h = riverBed < h ? riverBed + (h - riverBed) * Math.max(0, 1 - (1 - r / width) * 1.6) : h;
        river = r < width * 0.7 && h < SEA_LEVEL;
      }
    }
    const biome = this.pickBiome(c, e, t, hu, w, h, river);
    return { height: h, biome, river };
  }

  private pickBiome(c: number, e: number, t: number, hu: number, w: number, h: number, river: boolean): number {
    const b = (id: string) => biomeIndex(id);
    if (river) return b(t < -0.45 ? 'frozen_river' : 'river');
    if (h < SEA_LEVEL - 1 && c < -0.05) {
      const deep = h < 40;
      if (t < -0.45) return b(deep ? 'deep_frozen_ocean' : 'frozen_ocean');
      if (t < -0.15) return b(deep ? 'deep_cold_ocean' : 'cold_ocean');
      if (t > 0.55) return b('warm_ocean');
      if (t > 0.2) return b(deep ? 'deep_lukewarm_ocean' : 'lukewarm_ocean');
      return b(deep ? 'deep_ocean' : 'ocean');
    }
    if (h < SEA_LEVEL + 3 && c < 0.0 && c > -0.2) {
      if (e < -0.3) return b('stony_shore');
      return b(t < -0.45 ? 'snowy_beach' : 'beach');
    }
    if (h > 150) {
      if (t < -0.15) return b(w > 0.2 ? 'frozen_peaks' : 'jagged_peaks');
      return b(t > 0.55 ? 'stony_peaks' : w > 0.1 ? 'jagged_peaks' : 'stony_peaks');
    }
    if (h > 110) {
      if (t < -0.15) return b(hu > 0 ? 'grove' : 'snowy_slopes');
      if (hu > 0.15) return b('grove');
      return b(w > 0.2 ? 'windswept_hills' : 'meadow');
    }
    if (t < -0.45) {
      if (w > 0.45) return b('ice_spikes');
      return b(hu > 0.1 ? 'snowy_taiga' : 'snowy_plains');
    }
    if (t < -0.15) {
      if (hu > 0.3) return b(w > 0.2 ? 'old_growth_spruce_taiga' : 'old_growth_pine_taiga');
      if (e < -0.35) return b(w > 0 ? 'windswept_forest' : 'windswept_gravelly_hills');
      return b(hu > -0.2 ? 'taiga' : 'windswept_hills');
    }
    if (t < 0.25) {
      if (hu > 0.4) return b(h < SEA_LEVEL + 4 ? 'swamp' : 'dark_forest');
      if (hu > 0.15) return b(w > 0.3 ? 'flower_forest' : w < -0.3 ? 'birch_forest' : 'forest');
      if (hu > -0.15) return b(w > 0.4 ? 'cherry_grove' : w < -0.4 ? 'old_growth_birch_forest' : 'forest');
      if (w > 0.5) return b('sunflower_plains');
      return b(hu < -0.4 && w < -0.4 ? 'pale_garden' : 'plains');
    }
    if (t < 0.55) {
      if (hu > 0.35) return b(w > 0.3 ? 'bamboo_jungle' : 'jungle');
      if (hu > 0.1) return b('sparse_jungle');
      if (hu > -0.25) return b(w > 0.4 ? 'savanna_plateau' : 'savanna');
      return b('plains');
    }
    if (hu > 0.3 && h < SEA_LEVEL + 6) return b('mangrove_swamp');
    if (w > 0.35) return b(hu > 0 ? 'wooded_badlands' : w > 0.6 ? 'eroded_badlands' : 'badlands');
    if (hu > 0.2) return b('savanna');
    return b('desert');
  }

  // ---------------------------------------------------------------------------------------------
  // Stage 1: terrain
  // ---------------------------------------------------------------------------------------------
  generateTerrain(chunk: ChunkData): void {
    const cx = chunk.cx;
    const cz = chunk.cz;
    const infos: ColumnInfo[] = new Array(256);
    const heights = new Float32Array(256);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const info = this.columnInfo(cx * 16 + x, cz * 16 + z);
        infos[z * 16 + x] = info;
        heights[z * 16 + x] = info.height;
        chunk.biomes[z * 16 + x] = info.biome;
      }
    const topY = new Int16Array(256);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * 16 + x;
        const wz = cz * 16 + z;
        const info = infos[z * 16 + x];
        const h = info.height;
        const biome = biomes[info.biome];
        const cliff = MOUNTAIN_BIOMES.has(biome.id) || h > 100;
        let top = WORLD_MIN_Y - 1;
        for (let y = WORLD_MIN_Y; y <= 319; y++) {
          let solid: boolean;
          if (y > h + 24) solid = false;
          else if (y < h - 24) solid = true;
          else {
            // 3D density: overhangs and cliffs in rugged terrain
            const d = (h - y) / 24;
            const n = cliff ? this.density.fbm3(wx / 60, y / 30, wz / 60, 3) * 0.9 : this.density.noise3(wx / 40, y / 24, wz / 40) * 0.25;
            solid = d + n > 0;
          }
          if (!solid) continue;
          // caves
          if (y > WORLD_MIN_Y + 4 && this.isCave(wx, y, wz, h)) {
            if (y < -54) chunk.set(x, y, z, this.lava);
            continue;
          }
          chunk.set(x, y, z, y < 0 ? (y < -8 || hashPos(this.seed, wx, y, wz) < (-y) / 8 ? this.deepslate : this.stone) : this.stone);
          top = y;
        }
        topY[z * 16 + x] = top;
        // bedrock
        chunk.set(x, WORLD_MIN_Y, z, this.bedrock);
        for (let y = WORLD_MIN_Y + 1; y <= WORLD_MIN_Y + 4; y++) if (hashPos(this.seed, wx, y, wz ^ 0x55) < 1 - (y - WORLD_MIN_Y) / 5) chunk.set(x, y, z, this.bedrock);
      }
    this.placeOres(chunk);
    // surface + water
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * 16 + x;
        const wz = cz * 16 + z;
        const info = infos[z * 16 + x];
        const biome = biomes[info.biome];
        const surf = biome.surface;
        // water fill
        for (let y = SEA_LEVEL - 1; y >= WORLD_MIN_Y; y--) {
          if (chunk.get(x, y, z) !== this.air) break;
          chunk.set(x, y, z, this.water);
        }
        // surface layers: walk down through the column and dress every solid run that sits
        // directly under air or water (ore and dirt blobs inside the ground are not surfaces)
        let depthBudget = 0;
        let prev: 'air' | 'water' | 'other' = 'air';
        const steep = MOUNTAIN_BIOMES.has(biome.id) && this.detail.noise2(wx / 12, wz / 12) > 0.15;
        for (let y = 319; y >= WORLD_MIN_Y + 5; y--) {
          const s = chunk.get(x, y, z);
          if (s === this.air) {
            depthBudget = 0;
            prev = 'air';
            continue;
          }
          if (s === this.water || s === this.lava) {
            depthBudget = 0;
            prev = 'water';
            continue;
          }
          if (s !== this.stone && s !== this.deepslate) {
            depthBudget = 0;
            prev = 'other';
            continue;
          }
          if (prev === 'air' || prev === 'water') {
            // first stone block under air or water
            const exposedTop = prev === 'air';
            const underwater = prev === 'water' || y < SEA_LEVEL - 1;
            const beachy = y <= SEA_LEVEL + 1 && y >= SEA_LEVEL - 4 && (biome.category === 'beach' || biome.category === 'ocean' || biome.category === 'river');
            depthBudget = 3 + Math.floor(hashPos(this.seed, wx, 7, wz) * 2);
            prev = 'other';
            if (y < 0 || steep) {
              depthBudget = 0;
              continue;
            }
            if (underwater) {
              chunk.set(x, y, z, this.block(surf.underwater ?? (beachy ? 'sand' : 'gravel')));
            } else if (beachy) {
              chunk.set(x, y, z, this.block('sand'));
            } else {
              chunk.set(x, y, z, this.block(surf.top === 'grass_block' && y > 200 && biome.category !== 'jungle' ? 'stone' : surf.top));
              if (surf.snow && exposedTop && y >= SEA_LEVEL) {
                if (surf.top === 'grass_block' || surf.top === 'snow_block' || surf.top === 'sand' || surf.top === 'stone' || surf.top === 'gravel') {
                  if (y + 1 <= 319) chunk.set(x, y + 1, z, this.block('snow'));
                  if (surf.top === 'grass_block') chunk.set(x, y, z, blocks.stateWith('grass_block', { snowy: 'true' }));
                }
              }
            }
            depthBudget--;
          } else if (depthBudget > 0) {
            const filler = surf.filler === 'terracotta' ? this.terracottaBand(y) : surf.filler;
            chunk.set(x, y, z, this.block(filler));
            depthBudget--;
            prev = 'other';
          } else prev = 'other';
        }
        // freeze water surface in snowy biomes
        if (surf.snow && chunk.get(x, SEA_LEVEL - 1, z) === this.water && chunk.get(x, SEA_LEVEL, z) === this.air) chunk.set(x, SEA_LEVEL - 1, z, this.block('ice'));
      }
    chunk.updateHeightmapAll();
    chunk.status = 'terrain';
  }

  private terracottaBand(y: number): string {
    const bands = ['terracotta', 'orange_terracotta', 'terracotta', 'yellow_terracotta', 'white_terracotta', 'red_terracotta', 'terracotta', 'brown_terracotta', 'light_gray_terracotta'];
    return bands[Math.abs(Math.floor(y / 2)) % bands.length];
  }

  private isCave(wx: number, y: number, wz: number, surface: number): boolean {
    const depth = surface - y;
    if (depth < 3 && y > SEA_LEVEL - 4) {
      // let some tunnels reach the surface but keep most caves closed near the top
      if (this.detail.noise2(wx / 30, wz / 30) < 0.35) return false;
    }
    // cheese caves: big caverns, more common deep down
    const bias = y < 0 ? 0.62 : 0.72 + Math.max(0, y - 60) / 200;
    if (this.cheese.fbm3(wx / 90, y / 45, wz / 90, 2) > bias) return true;
    // spaghetti caves: long winding tunnels where two noise fields are both near zero
    const a = this.spagA.fbm3(wx / 70, y / 55, wz / 70, 2);
    const b = this.spagB.fbm3(wx / 70, y / 55, wz / 70, 2);
    const w = y < 0 ? 0.075 : 0.06;
    if (Math.abs(a) < w && Math.abs(b) < w) return true;
    // noodle caves: thin tubes
    const c = this.noodle.noise3(wx / 40, y / 40, wz / 40);
    const d = this.spagA.noise3(wx / 40 + 50, y / 40, wz / 40 + 50);
    return Math.abs(c) < 0.035 && Math.abs(d) < 0.035;
  }

  private placeOres(chunk: ChunkData): void {
    const rng = new Rng(mix(this.seed, chunk.cx, chunk.cz, 0x0e5));
    const biome = biomes[chunk.biomes[8 * 16 + 8]].id;
    for (const ore of ORES) {
      if (ore.biomes && !ore.biomes.includes(biome)) continue;
      const attempts = Math.floor(ore.count) + (rng.chance(ore.count - Math.floor(ore.count)) ? 1 : 0);
      for (let i = 0; i < attempts; i++) {
        const x = rng.int(16);
        const z = rng.int(16);
        const y = ore.distribution === 'uniform' ? rng.range(ore.min, ore.max) : rng.triangular(ore.min, ore.max);
        if (y < WORLD_MIN_Y + 1 || y > 319) continue;
        this.placeVein(chunk, rng, x, y, z, ore);
      }
    }
  }

  private placeVein(chunk: ChunkData, rng: Rng, x: number, y: number, z: number, ore: OreConfig): void {
    const size = ore.size;
    const radius = Math.max(0.6, Math.cbrt(size) * 0.62);
    const angle = rng.next() * Math.PI;
    const len = Math.max(1, size / 8);
    const x1 = x + Math.sin(angle) * len;
    const x2 = x - Math.sin(angle) * len;
    const z1 = z + Math.cos(angle) * len;
    const z2 = z - Math.cos(angle) * len;
    const y1 = y + rng.int(3) - 1;
    const y2 = y + rng.int(3) - 1;
    const ry = Math.max(0.6, radius * 0.7);
    const rx = Math.ceil(radius + len);
    for (let dx = -rx; dx <= rx; dx++)
      for (let dz = -rx; dz <= rx; dz++)
        for (let dy = -Math.ceil(ry); dy <= Math.ceil(ry); dy++) {
          const px = x + dx;
          const pz = z + dz;
          const py = y + dy;
          if (px < 0 || px > 15 || pz < 0 || pz > 15 || py < WORLD_MIN_Y + 1 || py > 319) continue;
          // distance to the segment (x1,y1,z1)-(x2,y2,z2)
          const t = Math.max(0, Math.min(1, ((px - x1) * (x2 - x1) + (pz - z1) * (z2 - z1)) / ((x2 - x1) ** 2 + (z2 - z1) ** 2 || 1)));
          const sx = x1 + (x2 - x1) * t;
          const sz = z1 + (z2 - z1) * t;
          const sy = y1 + (y2 - y1) * t;
          const dist = ((px - sx) / radius) ** 2 + ((py - sy) / ry) ** 2 + ((pz - sz) / radius) ** 2;
          if (dist > 1) continue;
          const cur = chunk.get(px, py, pz);
          if (cur !== this.stone && cur !== this.deepslate) continue;
          if (ore.discardOnAir) {
            let air = false;
            for (const [ox, oy, oz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
              const nx = px + ox;
              const nz = pz + oz;
              if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
              if (chunk.get(nx, py + oy, nz) === this.air) {
                air = true;
                break;
              }
            }
            if (air && rng.chance(ore.discardOnAir)) continue;
          }
          const isDeep = cur === this.deepslate;
          if (isDeep && !ore.deepslate) {
            if (ore.block === 'tuff') chunk.set(px, py, pz, this.block('tuff'));
            continue;
          }
          chunk.set(px, py, pz, this.block(isDeep ? ore.deepslate! : ore.block));
        }
  }

  // ---------------------------------------------------------------------------------------------
  // Stage 2: decoration (trees, plants) – needs the 3x3 neighbourhood to have terrain
  // ---------------------------------------------------------------------------------------------
  decorate(chunk: ChunkData, world: BlockAccess): void {
    const rng = new Rng(mix(this.seed, chunk.cx, chunk.cz, 0xdec0));
    const ox = chunk.cx * 16;
    const oz = chunk.cz * 16;
    const AIR = this.air;
    const grass = this.block('grass_block');
    const surfaceAt = (lx: number, lz: number): { y: number; block: number } => {
      const y = chunk.topBlock(lx, lz);
      return { y, block: y >= WORLD_MIN_Y ? chunk.get(lx, y, lz) : AIR };
    };
    const biomeAt = (lx: number, lz: number) => biomes[chunk.biomes[lz * 16 + lx]];

    // trees
    const centre = biomeAt(8, 8);
    const trees = centre.surface.trees ?? [];
    if (trees.length) {
      const density = trees.reduce((a, [, w]) => a + w, 0);
      const attempts = Math.round(density * 14) + (rng.chance(density * 14 - Math.floor(density * 14)) ? 1 : 0);
      for (let i = 0; i < attempts; i++) {
        const lx = rng.range(1, 14);
        const lz = rng.range(1, 14);
        const b = biomeAt(lx, lz);
        const tl = b.surface.trees;
        if (!tl || !tl.length) continue;
        const { y, block } = surfaceAt(lx, lz);
        if (y < SEA_LEVEL - 1 || (block !== grass && blocks.blockOf(block).id !== 'podzol' && blocks.blockOf(block).id !== 'mud' && blocks.blockOf(block).id !== 'snow_block' && blocks.blockOf(block).id !== 'dirt')) continue;
        const type = rng.weighted(tl);
        placeTree(world, rng, type, ox + lx, y + 1, oz + lz);
      }
    }
    // vegetation
    for (let i = 0; i < 48; i++) {
      const lx = rng.int(16);
      const lz = rng.int(16);
      const b = biomeAt(lx, lz);
      const s = b.surface;
      const { y, block } = surfaceAt(lx, lz);
      if (y < WORLD_MIN_Y || y >= 318) continue;
      const wx = ox + lx;
      const wz = oz + lz;
      const above = world.get(wx, y + 1, wz);
      const top = blocks.blockOf(block).id;
      if (above !== AIR) {
        // lily pads on water
        if (block === this.water && s.extra?.includes('lily_pad') && rng.chance(0.15) && y === SEA_LEVEL - 1) world.set(wx, y + 1, wz, this.block('lily_pad'));
        continue;
      }
      if (top === 'grass_block') {
        const r = rng.next();
        const gd = s.grassDensity ?? 0;
        if (r < gd) {
          if (rng.chance(0.08)) placeTallPlant(world, 'tall_grass', wx, y + 1, wz);
          else world.set(wx, y + 1, wz, this.block('short_grass'));
        } else if (s.flowers && r < gd + 0.06) {
          const f = rng.pick(s.flowers);
          if (f === 'pink_petals') world.set(wx, y + 1, wz, blocks.stateWith('pink_petals', { flower_amount: String(rng.range(1, 4)) }));
          else world.set(wx, y + 1, wz, this.block(f));
        } else if (s.extra && r < gd + 0.12) {
          this.placeExtra(world, rng, rng.pick(s.extra), wx, y + 1, wz, block);
        } else if (r < gd + 0.125 && b.temperature > 0.1 && rng.chance(0.15)) {
          world.set(wx, y + 1, wz, blocks.stateWith('pumpkin', {}));
        }
        // sugar cane by water
        if (y <= SEA_LEVEL + 1 && rng.chance(0.25) && this.nearWater(world, wx, y, wz)) this.placeCane(world, rng, wx, y + 1, wz);
      } else if (top === 'sand' || top === 'red_sand') {
        if (s.extra?.includes('cactus') && rng.chance(0.12)) this.placeCactus(world, rng, wx, y + 1, wz);
        else if (s.extra?.includes('dead_bush') && rng.chance(0.12)) world.set(wx, y + 1, wz, this.block('dead_bush'));
        else if (y <= SEA_LEVEL + 1 && rng.chance(0.3) && this.nearWater(world, wx, y, wz)) this.placeCane(world, rng, wx, y + 1, wz);
      } else if (top === 'podzol' || top === 'mycelium') {
        if (rng.chance(0.3)) world.set(wx, y + 1, wz, this.block(rng.chance(0.5) ? 'brown_mushroom' : 'red_mushroom'));
      } else if (top === 'snow_block' && s.extra?.includes('fern') && rng.chance(0.1)) {
        world.set(wx, y + 1, wz, this.block('fern'));
      }
    }
    chunk.status = 'decorated';
  }

  private nearWater(world: BlockAccess, x: number, y: number, z: number): boolean {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (world.get(x + dx, y, z + dz) === this.water) return true;
    return false;
  }

  private placeCane(world: BlockAccess, rng: Rng, x: number, y: number, z: number): void {
    const h = rng.range(1, 3);
    for (let i = 0; i < h; i++) {
      if (world.get(x, y + i, z) !== this.air) break;
      world.set(x, y + i, z, blocks.stateWith('sugar_cane', { age: '0' }));
    }
  }

  private placeCactus(world: BlockAccess, rng: Rng, x: number, y: number, z: number): void {
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (world.get(x + dx, y, z + dz) !== this.air) return;
    const h = rng.range(1, 3);
    for (let i = 0; i < h; i++) {
      if (world.get(x, y + i, z) !== this.air) break;
      world.set(x, y + i, z, blocks.stateWith('cactus', { age: '0' }));
    }
  }

  private placeExtra(world: BlockAccess, rng: Rng, id: string, x: number, y: number, z: number, ground: number): void {
    switch (id) {
      case 'large_fern': case 'sunflower': case 'lilac': case 'rose_bush': case 'peony':
        placeTallPlant(world, id, x, y, z);
        return;
      case 'sweet_berry_bush':
        world.set(x, y, z, blocks.stateWith(id, { age: String(rng.range(1, 3)) }));
        return;
      case 'bamboo':
        if (ground !== this.block('grass_block')) return;
        for (let i = 0; i < rng.range(4, 12); i++) {
          if (world.get(x, y + i, z) !== this.air) break;
          world.set(x, y + i, z, blocks.stateWith('bamboo', { age: '1', leaves: i > 2 ? 'large' : 'none', stage: '0' }));
        }
        return;
      case 'melon':
        world.set(x, y, z, this.block('melon'));
        return;
      case 'cactus': case 'dead_bush': case 'lily_pad':
        return;
      default:
        if (blocks.has(id)) world.set(x, y, z, this.block(id));
    }
  }
}
