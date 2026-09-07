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
import { biomeIndex, biomes, type BiomeDef } from '../biomes.ts';
import { ChunkData } from '../chunk.ts';
import { placeBeeNest, placeTallPlant, placeTree, type BlockAccess } from './features.ts';
import { claimsStart, assembleJigsaw, pickVariant, placementBox, rotate, stampStructure, structureStart, type ClipBox, type StructurePlacement, type StructureSet } from './structures.ts';
import { assembleMineshaft, fillShaftPiece, type ShaftKind, type ShaftPiece } from './mineshaft.ts';
import { buildTemple, TEMPLE_SIZE, type TempleKind } from './temples.ts';
import { assembleStronghold, fillStrongholdPiece, type StrongholdPiece } from './stronghold.ts';
import { assembleMansion, CELL, GRID } from './mansion.ts';
import { buildMonument, MONUMENT_SIZE, MONUMENT_Y } from './monument.ts';

/** Structures vanilla lays out in code, keyed by the placement name their index entry carries. */
const TEMPLE_KINDS = new Set<string>(['desert_pyramid', 'jungle_temple', 'swamp_hut']);

/**
 * Something a structure placed that the main thread has to finish: a chest with the loot table that
 * fills it, a spawner with the mob it turns, or a mob the structure comes with (a hut's witch).
 */
export interface StructureSpot { x: number; y: number; z: number; table?: string; mob?: string; entity?: string; item?: string }

/** A structure worked out for a start chunk: template pieces, a mineshaft's walk, or a temple. */
interface StructureInstance {
  pieces: StructurePlacement[];
  shaft?: { kind: ShaftKind; pieces: ShaftPiece[] };
  temple?: { kind: TempleKind; x: number; y: number; z: number; rotation: number; seed: number };
  rooms?: StrongholdPiece[];
  treasure?: { x: number; y: number; z: number };
  monument?: { x: number; y: number; z: number; seed: number };
}
const EMPTY_STRUCTURE: StructureInstance = { pieces: [] };

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

/**
 * Vanilla bee nest chances per biome: nearly every meadow tree carries one, plains and cherry
 * groves five in a hundred, and the flowery biomes two.
 */
const BEE_NEST_CHANCE: Record<string, number> = {
  meadow: 1, cherry_grove: 0.05, plains: 0.05, sunflower_plains: 0.02, flower_forest: 0.02,
  forest: 0.002, birch_forest: 0.002, old_growth_birch_forest: 0.002,
};

/** Vanilla 1.18+ canyon carver probability per chunk. */
const RAVINE_CHANCE = 0.01;
/**
 * The ladder column in each igloo piece, in template coordinates: vanilla rotates every piece about
 * this column (its `PIVOTS` map), so lining the columns up reproduces vanilla's basement placement.
 */
const IGLOO_LADDER = { top: [3, 5] as [number, number], middle: [1, 1] as [number, number], bottom: [3, 7] as [number, number] };
/** Chunk offsets vanilla samples when deciding whether open water reaches sea level. */
const SEA_SAMPLING_OFFSETS: ReadonlyArray<readonly [number, number]> = [[0, 0], [-2, -1], [-1, -1], [0, -1], [1, -1], [-1, 0], [1, 0], [-2, 1], [-1, 1], [0, 1], [1, 1]];
const MOUNTAIN_BIOMES = new Set(['snowy_slopes', 'jagged_peaks', 'frozen_peaks', 'stony_peaks', 'grove', 'meadow', 'windswept_hills', 'windswept_forest', 'windswept_gravelly_hills']);

export type CaveBiome = 'lush' | 'dripstone' | 'deep_dark';

/** Vanilla pointed dripstone thickness for piece `index` (0 = attached end) of a column `length` long. */
export function dripstoneThickness(length: number, index: number): 'tip' | 'frustum' | 'middle' | 'base' {
  const fromTip = length - 1 - index;
  if (fromTip === 0) return 'tip';
  if (fromTip === 1) return 'frustum';
  return index === 0 ? 'base' : 'middle';
}

export interface ColumnInfo {
  height: number;
  biome: number;
  river: boolean;
}

/** Ground a tree (or a huge mushroom) will stand on, beside the grass block every biome starts from. */
const TREE_GROUND = new Set(['podzol', 'mud', 'snow_block', 'dirt', 'mycelium']);

/** How high the island noise has to run before an ocean lifts a mushroom island out of itself. */
const MUSHROOM_ISLAND = 0.42;

export class WorldGenerator {
  readonly seed: number;
  /** Structure templates and their spreads, installed once the runtime has fetched them. */
  structures: StructureSet[] = [];
  private readonly continental: Noise;
  private readonly erosion: Noise;
  private readonly peaks: Noise;
  private readonly temperature: Noise;
  private readonly humidity: Noise;
  private readonly weird: Noise;
  /** Where the ocean lifts a mushroom island out of itself, which vanilla gives a band of its own. */
  private readonly mushroom: Noise;
  private readonly river: Noise;
  private readonly density: Noise;
  private readonly cheese: Noise;
  private readonly spagA: Noise;
  private readonly spagB: Noise;
  private readonly noodle: Noise;
  private readonly detail: Noise;
  private readonly caveBiome: Noise;
  private readonly aquiferMask: Noise;
  private readonly aquiferLevelNoise: Noise;
  /** Cells removed by ravines in the last generateTerrain (tests). */
  lastRavineCells = 0;
  /** Quantised pre-carve surface heights sampled while filling fluids (cleared per chunk). */
  private readonly surfaceCache = new Map<number, number>();

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
    this.mushroom = n(31);
    this.river = n(7);
    this.density = n(8);
    this.cheese = n(9);
    this.spagA = n(10);
    this.spagB = n(11);
    this.noodle = n(12);
    this.detail = n(13);
    this.caveBiome = n(14);
    this.aquiferMask = n(15);
    this.aquiferLevelNoise = n(16);
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
  // Cave biomes (3D): computed from noise wherever caves are decorated, never stored per column
  // ---------------------------------------------------------------------------------------------
  caveBiomeAt(wx: number, y: number, wz: number, surface: number): CaveBiome | null {
    if (y > surface - 8) return null;
    const v = this.caveBiome.fbm2(wx / 300, wz / 300, 2);
    if (y < -8) {
      // deep dark sits under eroded, mountainous land like vanilla's low-erosion depth band
      const e = this.erosion.fbm2(wx / 700, wz / 700, 3);
      if (e < -0.35 && v > -0.15) return 'deep_dark';
    }
    if (v > 0.38 && y > -40) return 'dripstone';
    if (v < -0.38 && y > -24 && y < 64 && this.humidity.fbm2(wx / 1100, wz / 1100 + 100, 3) > -0.25) return 'lush';
    return null;
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
    // vanilla keeps a band of continentalness for mushroom fields alone, out where the ocean is
    // deepest; ours lifts an island out of that ocean where a slow noise says one stands
    const island = c < -0.55 ? this.mushroom.fbm2(wx / 900 + 500, wz / 900 - 500, 2) : -1;
    const mushroom = island > MUSHROOM_ISLAND;
    if (mushroom) {
      const rise = (island - MUSHROOM_ISLAND) / (1 - MUSHROOM_ISLAND);
      h = Math.max(h, SEA_LEVEL + 1 + rise * 26 + pv * 4);
    }
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
    const biome = mushroom && h > SEA_LEVEL ? biomeIndex('mushroom_fields') : this.pickBiome(c, e, t, hu, w, h, river);
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
      // vanilla's windswept savanna is the eroded one: cliffs and bare rock among the acacia
      if (hu > -0.25) return b(e < -0.4 ? 'windswept_savanna' : w > 0.4 ? 'savanna_plateau' : 'savanna');
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
    this.surfaceCache.clear();
    const infos: ColumnInfo[] = new Array(256);
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const info = this.columnInfo(cx * 16 + x, cz * 16 + z);
        infos[z * 16 + x] = info;
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
    this.carveRavines(chunk);
    // open-water fill level per column (WORLD_MIN_Y - 1 where nothing was open below sea level)
    const fillLevels = new Int16Array(256).fill(WORLD_MIN_Y - 1);
    // surface + water
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const wx = cx * 16 + x;
        const wz = cz * 16 + z;
        const info = infos[z * 16 + x];
        const biome = biomes[info.biome];
        const surf = biome.surface;
        // water fill: sea beds, rivers, lakes and anything carved open near a coast flood to sea
        // level (vanilla's global aquifer); inland ravines and cave mouths that dip below sea level
        // follow the local aquifer instead, so most stay dry and a few become ravine lakes
        if (chunk.get(x, SEA_LEVEL - 1, z) === this.air) {
          const level = info.height < SEA_LEVEL || this.nearSea(wx, wz) ? SEA_LEVEL - 1 : this.aquiferLevel(wx, wz);
          fillLevels[z * 16 + x] = level;
          for (let y = level; y >= WORLD_MIN_Y; y--) {
            if (chunk.get(x, y, z) !== this.air) break;
            chunk.set(x, y, z, this.water);
          }
        }
        // aquifers: enclosed cave air below the local water table floods (lava keeps the deep band)
        const table = Math.min(this.aquiferLevel(wx, wz), SEA_LEVEL - 2, Math.floor(info.height) - 5);
        for (let y = table; y > -54; y--) if (chunk.get(x, y, z) === this.air) chunk.set(x, y, z, this.water);
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
    this.placeAquiferBarriers(chunk, fillLevels);
    // ores are features in vanilla and run after the surface rules, so blobs never eat the topsoil
    this.placeOres(chunk);
    chunk.updateHeightmapAll();
    chunk.status = 'terrain';
  }

  /**
   * Vanilla's aquifer barrier, simplified: where an open column was flooded higher than its
   * neighbour, the neighbour's air beside that water turns to stone so ravine lakes and shore
   * water do not pour into dry carved space. Only pairs inside this chunk are known.
   */
  private placeAquiferBarriers(chunk: ChunkData, fillLevels: Int16Array): void {
    for (let z = 0; z < CHUNK_SIZE; z++)
      for (let x = 0; x < CHUNK_SIZE; x++) {
        const mine = fillLevels[z * 16 + x];
        for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
          const nx = x + dx, nz = z + dz;
          if (nx < 0 || nx > 15 || nz < 0 || nz > 15) continue;
          const theirs = fillLevels[nz * 16 + nx];
          if (theirs <= mine) continue;
          for (let y = theirs; y > mine && y >= WORLD_MIN_Y; y--) {
            if (chunk.get(nx, y, nz) !== this.water) continue;
            if (chunk.get(x, y, z) === this.air) chunk.set(x, y, z, y < 0 ? this.deepslate : this.stone);
          }
        }
      }
  }

  /**
   * Local aquifer water level: about half the map is dry (no underground water), the rest floods
   * caves up to a level between y −35 and 55 that varies smoothly over ~200 blocks.
   */
  aquiferLevel(wx: number, wz: number): number {
    const mask = this.aquiferMask.fbm2(wx / 150, wz / 150, 2);
    if (mask > 0.05) return WORLD_MIN_Y - 1;
    if (mask < -0.42) return SEA_LEVEL - 1; // vanilla floodedness > 0.8: the global sea level applies
    return Math.round(10 + this.aquiferLevelNoise.fbm2(wx / 220, wz / 220, 2) * 45);
  }

  /** Pre-carve surface height of the 4×4 cell containing (wx, wz), cached for the current chunk. */
  private preliminarySurface(wx: number, wz: number): number {
    const qx = Math.floor(wx / 4);
    const qz = Math.floor(wz / 4);
    const key = qx * 0x100000 + qz;
    let h = this.surfaceCache.get(key);
    if (h === undefined) {
      h = Math.floor(this.columnInfo(qx * 4 + 2, qz * 4 + 2).height);
      this.surfaceCache.set(key, h);
    }
    return h;
  }

  /**
   * Vanilla aquifer rule for open water: a column floods to sea level when any of the eleven
   * sampled columns around it (chunk offsets, like `Aquifer.SURFACE_SAMPLING_OFFSETS_IN_CHUNKS`)
   * has its surface more than eight blocks below sea level. Our coasts shelve gently, so the shore
   * itself (sea within eight blocks) counts too; the aquifer barrier keeps the water in place.
   */
  nearSea(wx: number, wz: number): boolean {
    for (const [ox, oz] of SEA_SAMPLING_OFFSETS) if (this.preliminarySurface(wx + ox * 16, wz + oz * 16) + 8 < SEA_LEVEL) return true;
    for (let ox = -8; ox <= 8; ox += 4) for (let oz = -8; oz <= 8; oz += 4) if (this.preliminarySurface(wx + ox, wz + oz) < SEA_LEVEL) return true;
    return false;
  }

  /** Whether a ravine starts in chunk (cx, cz): vanilla canyon probability 0.01 per chunk. */
  ravineStartsIn(cx: number, cz: number): boolean {
    return new Rng(mix(this.seed, cx, cz, 0xca7e)).chance(RAVINE_CHANCE);
  }

  /**
   * Vanilla-style canyon carver: each chunk within four chunks may seed a random walk of up to
   * 112 steps carving tall thin ellipsoids; only the cells inside this chunk are removed, so
   * generation stays independent per chunk and deterministic.
   */
  private carveRavines(chunk: ChunkData): void {
    this.lastRavineCells = 0;
    const x0 = chunk.cx * 16;
    const z0 = chunk.cz * 16;
    for (let dcx = -4; dcx <= 4; dcx++)
      for (let dcz = -4; dcz <= 4; dcz++) {
        const scx = chunk.cx + dcx;
        const scz = chunk.cz + dcz;
        const rng = new Rng(mix(this.seed, scx, scz, 0xca7e));
        if (!rng.chance(RAVINE_CHANCE)) continue;
        let x = scx * 16 + rng.int(16);
        let z = scz * 16 + rng.int(16);
        let y = rng.range(10, 67);
        let yaw = rng.next() * Math.PI * 2;
        let pitch = (rng.next() - 0.5) * 0.25;
        let yawDelta = 0;
        let pitchDelta = 0;
        const thickness = (rng.next() * 2 + rng.next()) * 2;
        const steps = 112 - rng.int(28);
        for (let i = 0; i < steps; i++) {
          const rh = 1.5 + Math.sin((i * Math.PI) / steps) * thickness;
          const rv = rh * 3;
          x += Math.cos(yaw) * Math.cos(pitch);
          z += Math.sin(yaw) * Math.cos(pitch);
          y += Math.sin(pitch);
          pitch = pitch * 0.7 + pitchDelta * 0.05;
          yaw += yawDelta * 0.05;
          yawDelta = yawDelta * 0.75 + (rng.next() - rng.next()) * rng.next() * 4;
          pitchDelta = pitchDelta * 0.9 + (rng.next() - rng.next()) * rng.next() * 2;
          if (rng.int(4) === 0) continue;
          // clip the ellipsoid to this chunk
          const minX = Math.max(x0, Math.floor(x - rh)), maxX = Math.min(x0 + 15, Math.ceil(x + rh));
          const minZ = Math.max(z0, Math.floor(z - rh)), maxZ = Math.min(z0 + 15, Math.ceil(z + rh));
          if (minX > maxX || minZ > maxZ) continue;
          const minY = Math.max(WORLD_MIN_Y + 6, Math.floor(y - rv)), maxY = Math.min(250, Math.ceil(y + rv));
          for (let bx = minX; bx <= maxX; bx++)
            for (let bz = minZ; bz <= maxZ; bz++) {
              const lx = bx - x0, lz = bz - z0;
              const dx = (bx + 0.5 - x) / rh, dz = (bz + 0.5 - z) / rh;
              // jagged walls like vanilla's per-layer width table
              const wobble = 0.85 + this.detail.noise2(bx / 7, bz / 7) * 0.3;
              if (dx * dx + dz * dz > wobble) continue;
              for (let by = minY; by <= maxY; by++) {
                const dy = (by + 0.5 - y) / rv;
                if (dx * dx + dz * dz + dy * dy >= wobble) continue;
                const cur = chunk.get(lx, by, lz);
                if (cur === this.air || cur === this.bedrock) continue;
                chunk.set(lx, by, lz, by <= -54 ? this.lava : this.air);
                this.lastRavineCells++;
              }
            }
        }
      }
  }

  /**
   * Underground lava lake (vanilla lake_lava, 1 in 8 chunks): a blob of a few ellipsoids filled
   * with lava below its centre and air above, walled with stone wherever it would spill into caves.
   */
  placeLavaLake(world: BlockAccess, rng: Rng, x: number, y: number, z: number): boolean {
    const cells = new Set<string>();
    const blobs = rng.range(4, 6);
    for (let b = 0; b < blobs; b++) {
      const cx = x + rng.range(-3, 3), cy = y + rng.range(-1, 1), cz = z + rng.range(-3, 3);
      const rx = 2 + rng.next() * 2, ry = 1 + rng.next() * 2, rz = 2 + rng.next() * 2;
      for (let dx = -4; dx <= 4; dx++) for (let dy = -3; dy <= 3; dy++) for (let dz = -4; dz <= 4; dz++) {
        if ((dx / rx) ** 2 + (dy / ry) ** 2 + (dz / rz) ** 2 < 1) cells.add(`${cx + dx},${cy + dy},${cz + dz}`);
      }
    }
    const parse = (k: string) => k.split(',').map(Number) as [number, number, number];
    // abort when the lake would open into the sky like vanilla's containment check
    for (const k of cells) {
      const [px, py, pz] = parse(k);
      if (py > y && world.get(px, py, pz) === this.air) return false;
    }
    for (const k of cells) {
      const [px, py, pz] = parse(k);
      world.set(px, py, pz, py <= y ? this.lava : this.air);
    }
    const stone = this.block('stone');
    for (const k of cells) {
      const [px, py, pz] = parse(k);
      if (py > y) continue;
      for (const [ox, oy, oz] of [[1, 0, 0], [-1, 0, 0], [0, 0, 1], [0, 0, -1], [0, -1, 0]]) {
        const nk = `${px + ox},${py + oy},${pz + oz}`;
        if (cells.has(nk)) continue;
        const cur = world.get(px + ox, py + oy, pz + oz);
        if (cur === this.air || cur === this.water) world.set(px + ox, py + oy, pz + oz, stone);
      }
    }
    return true;
  }

  /**
   * Vanilla's badlands band table (`SurfaceSystem.generateBands`): 192 layers of plain terracotta
   * with runs of orange laid down first, then single bands of yellow, brown and red, then white
   * bands edged in light gray. It is rolled once per world, so a seed's stripes are its own.
   */
  private buildTerracottaBands(): string[] {
    const rng = new Rng(mix(this.seed, 0, 0, 0xba7d));
    const bands = new Array<string>(192).fill('terracotta');
    for (let i = 0; i < 192; i += rng.range(1, 5) + 1) {
      const run = rng.range(0, 3);
      if (i + run >= 192) break;
      for (let j = 0; j <= run; j++) bands[i + j] = 'orange_terracotta';
    }
    const runs = (count: number, block: string, maxLen: number) => {
      for (let n = 0; n < count; n++) {
        const len = rng.range(1, maxLen);
        const at = rng.int(192);
        for (let j = 0; j < len && at + j < 192; j++) bands[at + j] = block;
      }
    };
    runs(rng.range(6, 15), 'yellow_terracotta', 3);
    runs(rng.range(6, 15), 'brown_terracotta', 3);
    runs(rng.range(6, 15), 'red_terracotta', 3);
    for (let n = 0, count = rng.range(3, 6); n < count; n++) {
      const at = rng.int(192);
      const len = rng.range(1, 3);
      for (let j = 0; j < len && at + j < 192; j++) {
        bands[at + j] = 'white_terracotta';
        // white bands sit between light gray edges in vanilla
        if (at + j - 1 >= 0 && bands[at + j - 1] === 'terracotta') bands[at + j - 1] = 'light_gray_terracotta';
        if (at + j + 1 < 192 && bands[at + j + 1] === 'terracotta') bands[at + j + 1] = 'light_gray_terracotta';
      }
    }
    return bands;
  }

  /** Badlands stripe colour at a height, from this world's band table. */
  terracottaBand(y: number): string {
    if (!this.bands) this.bands = this.buildTerracottaBands();
    return this.bands[((y % 192) + 192) % 192];
  }
  private bands: string[] | null = null;

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
    this.structureSpots = [];
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

    // structures go in before the scatter features, as vanilla's generation steps do
    this.placeStructures(chunk, world);

    if (rng.chance(1 / 8)) {
      const lx = rng.range(3, 12), lz = rng.range(3, 12);
      const ly = rng.range(-50, 30);
      const rock = (y: number) => { const s = chunk.get(lx, y, lz); return s === this.stone || s === this.deepslate; };
      if (rock(ly) && rock(ly + 3) && rock(ly - 3)) this.placeLavaLake(world, rng, ox + lx, ly, oz + lz);
    }
    this.decorateCaves(chunk, world, rng);
    // azalea trees mark lush caves below
    for (let i = 0; i < 3; i++) {
      const lx = rng.range(2, 13);
      const lz = rng.range(2, 13);
      const { y, block } = surfaceAt(lx, lz);
      const id = blocks.blockOf(block).id;
      if (y < SEA_LEVEL || (id !== 'grass_block' && id !== 'dirt' && id !== 'moss_block')) continue;
      if (this.caveBiomeAt(ox + lx, y - 30, oz + lz, y) === 'lush' && rng.chance(0.35)) placeTree(world, rng, 'azalea', ox + lx, y + 1, oz + lz);
    }

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
        if (y < SEA_LEVEL - 1 || (block !== grass && !TREE_GROUND.has(blocks.blockOf(block).id))) continue;
        const type = rng.weighted(tl);
        if (placeTree(world, rng, type, ox + lx, y + 1, oz + lz) && rng.chance(BEE_NEST_CHANCE[b.id] ?? 0)) {
          placeBeeNest(world, rng, ox + lx, y + 1, oz + lz);
        }
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
    this.decorateOcean(chunk, world, rng, biomeAt, surfaceAt);
    this.decoratePaleGarden(chunk, world, rng, biomeAt);
    chunk.status = 'decorated';
  }

  /**
   * Vanilla computes a structure's start once and then lets every chunk it covers write its own
   * part of it. Ours does the same: a chunk asks each structure set which nearby starts could reach
   * it, and stamps the pieces of those starts clipped to its own columns. Placement depends only on
   * the seed and the start chunk, so a structure comes out the same whichever way the player
   * approaches it, and nothing is lost off the edge of what happens to be loaded.
   */
  private placeStructures(chunk: ChunkData, world: BlockAccess): void {
    const clip = { x0: chunk.cx * 16, x1: chunk.cx * 16 + 15, z0: chunk.cz * 16, z1: chunk.cz * 16 + 15 };
    const loot = (lx: number, ly: number, lz: number, table: string) => this.structureSpots.push({ x: lx, y: ly, z: lz, table });
    const spawner = (lx: number, ly: number, lz: number, mob: string) => this.structureSpots.push({ x: lx, y: ly, z: lz, mob });
    const entity = (lx: number, ly: number, lz: number, mob: string) => this.structureSpots.push({ x: lx, y: ly, z: lz, entity: mob });
    for (const set of this.structures) {
      for (const start of this.nearbyStarts(set, chunk.cx, chunk.cz)) {
        const instance = this.structureAt(set, start.cx, start.cz);
        for (const piece of instance.pieces) {
          const box = placementBox(piece);
          if (box.x1 < clip.x0 || box.x0 > clip.x1 || box.z1 < clip.z0 || box.z0 > clip.z1) continue;
          const written = new Set<string>();
          stampStructure(world, piece, { written, clip, onLoot: loot, onEntity: entity, onSpawner: spawner });
          this.fitStructureToTerrain(world, box, written, piece.placement ?? 'surface', clip);
        }
        if (instance.temple) {
          const t = instance.temple;
          const [tw, , td] = TEMPLE_SIZE[t.kind];
          const [w, d] = (t.rotation & 1) === 1 ? [td, tw] : [tw, td];
          if (t.x <= clip.x1 && t.x + w - 1 >= clip.x0 && t.z <= clip.z1 && t.z + d - 1 >= clip.z0)
            buildTemple({ world, clip, x: t.x, y: t.y, z: t.z, rotation: t.rotation, seed: t.seed, kind: t.kind, onLoot: loot, onEntity: entity });
        }
        if (instance.treasure) this.buryTreasure(world, clip, instance.treasure, loot);
        if (instance.monument) {
          const m = instance.monument;
          const [mw, , md] = MONUMENT_SIZE;
          if (m.x <= clip.x1 && m.x + mw - 1 >= clip.x0 && m.z <= clip.z1 && m.z + md - 1 >= clip.z0)
            buildMonument({ world, clip, x: m.x, y: m.y, z: m.z, seed: m.seed, onEntity: entity });
        }
        for (const room of instance.rooms ?? []) {
          const b = room.box;
          if (b.x1 < clip.x0 || b.x0 > clip.x1 || b.z1 < clip.z0 || b.z0 > clip.z1) continue;
          fillStrongholdPiece(room, world, clip, loot, spawner);
        }
        if (!instance.shaft) continue;
        for (const piece of instance.shaft.pieces) {
          const b = piece.box;
          if (b.x1 < clip.x0 || b.x0 > clip.x1 || b.z1 < clip.z0 || b.z0 > clip.z1) continue;
          fillShaftPiece(piece, instance.shaft.kind, world, clip, loot, spawner);
        }
      }
    }
  }

  /**
   * The biome a structure belongs to where it wants to start, or null when it does not belong there.
   * Most read the surface biome, but one built at a fixed depth (an ancient city) belongs to the cave
   * biome at that depth instead.
   */
  private structureBiome(set: StructureSet, wx: number, wz: number): string | null {
    const info = this.columnInfo(wx, wz);
    const surface = biomes[info.biome].id;
    if (set.biomeSet.has(surface)) return surface;
    if (set.startY === undefined) return null;
    const cave = this.caveBiomeAt(wx, set.startY, wz, Math.floor(info.height));
    const id = cave === 'deep_dark' ? 'deep_dark' : cave === 'lush' ? 'lush_caves' : cave === 'dripstone' ? 'dripstone_caves' : null;
    return id !== null && set.biomeSet.has(id) ? id : null;
  }

  /** Start chunks of the structure set that lie close enough to reach the chunk being generated. */
  private nearbyStarts(set: StructureSet, cx: number, cz: number): { cx: number; cz: number }[] {
    const out: { cx: number; cz: number }[] = [];
    const r = set.reach;
    if (set.placement === 'stronghold') {
      for (const ring of this.strongholdRings(set)) if (Math.abs(ring.cx - cx) <= r && Math.abs(ring.cz - cz) <= r) out.push(ring);
      return out;
    }
    for (let rx = Math.floor((cx - r) / set.spacing); rx <= Math.floor((cx + r) / set.spacing); rx++)
      for (let rz = Math.floor((cz - r) / set.spacing); rz <= Math.floor((cz + r) / set.spacing); rz++) {
        const start = structureStart(this.seed, set, rx, rz);
        if (Math.abs(start.cx - cx) > r || Math.abs(start.cz - cz) > r) continue;
        // a structure spread one per chunk (a mineshaft) rolls its chance in every chunk instead
        if (set.frequency !== undefined && hashPos(this.seed ^ set.salt, start.cx, 0x5eed, start.cz) >= set.frequency) continue;
        out.push(start);
      }
    return out;
  }

  /**
   * The structure starting in a chunk, or an empty one when the roll fails there. A start is worked
   * out once and kept, because the chunks it covers all ask for the same one.
   */
  private structureAt(set: StructureSet, cx: number, cz: number): StructureInstance {
    const key = `${set.name}:${cx}:${cz}`;
    const cached = this.structureCache.get(key);
    if (cached) return cached;
    const instance = this.buildStructure(set, cx, cz);
    // the cache is only a stamping aid, so anything is safe to drop once it grows large
    if (this.structureCache.size > 256) this.structureCache.clear();
    this.structureCache.set(key, instance);
    return instance;
  }

  private buildStructure(set: StructureSet, cx: number, cz: number): StructureInstance {
    const rng = new Rng(mix(this.seed ^ set.salt, cx, cz, 0x5747));
    const wx = cx * 16 + rng.int(8);
    const wz = cz * 16 + rng.int(8);
    const biome = this.structureBiome(set, wx, wz);
    if (biome === null) return EMPTY_STRUCTURE;
    // a shared spread (the fortress and the bastion) gives each start to one of them, by weight
    if (!claimsStart(this.seed, set, cx, cz)) return EMPTY_STRUCTURE;
    const decaySeed = mix(this.seed ^ set.salt, cx, cz, 0x0d3c);
    if (set.placement === 'mineshaft') return this.buildMineshaft(set, cx, cz, biome, rng);
    if (TEMPLE_KINDS.has(set.placement)) return this.buildTempleAt(set, wx, wz, rng);
    if (set.placement === 'stronghold') return this.buildStronghold(set, cx, cz);
    if (set.placement === 'buried_treasure') return this.buildBuriedTreasure(set, wx, wz);
    if (set.placement === 'monument') return this.buildMonument(set, wx, wz);
    if (set.placement === 'fossil') return this.buildFossil(set, wx, wz, rng, decaySeed);
    if (set.placement === 'mansion') return this.buildMansion(set, wx, wz, rng, decaySeed);
    if (set.placement === 'jigsaw') return { pieces: this.buildJigsaw(set, biome, wx, wz, rng, decaySeed) };
    const template = set.mainTemplates[rng.int(set.mainTemplates.length)];
    const rotation = rng.int(4);
    const [sx, , sz] = template.size;
    const [rw, rd] = (rotation & 1) === 1 ? [sz, sx] : [sx, sz];
    const y = this.structureGroundY(wx, wz, rw, rd, set.placement);
    if (y === null) return EMPTY_STRUCTURE;
    // ruined portals crumble; everything else is placed whole
    const integrity = set.name === 'ruined_portal' ? 0.6 + rng.next() * 0.3 : 1;
    const pieces: StructurePlacement[] = [{ set, template, x: wx, y, z: wz, rotation, integrity, decaySeed, placement: set.placement }];
    if (set.name === 'igloo') pieces.push(...this.iglooBasement(set, template, wx, y, wz, rotation, rng, decaySeed));
    if (set.cluster) pieces.push(...this.ruinCluster(set, wx, wz, rng, decaySeed));
    this.lastStructure = { name: set.name, x: wx, y, z: wz };
    return { pieces };
  }

  /**
   * Abandoned mineshafts: vanilla rolls one in every chunk at a low chance, builds the room and its
   * corridors around it, then drops the lot underground — a mesa shaft just below the badlands
   * surface, where the cliffs cut into it, and an ordinary one anywhere under the sea level.
   */
  private buildMineshaft(set: StructureSet, cx: number, cz: number, biome: string, rng: Rng): StructureInstance {
    const variant = pickVariant(set, biome, rng);
    if (!variant) return EMPTY_STRUCTURE;
    const kind: ShaftKind = variant.start === 'mesa' ? 'mesa' : 'normal';
    const surface = Math.floor(this.columnInfo(cx * 16 + 2, cz * 16 + 2).height);
    const topY = kind === 'mesa'
      ? Math.max(SEA_LEVEL, surface - 4)
      : Math.min(surface - 8, WORLD_MIN_Y + 30 + rng.int(SEA_LEVEL - WORLD_MIN_Y - 40));
    if (topY < WORLD_MIN_Y + 20) return EMPTY_STRUCTURE;
    const pieces = assembleMineshaft(mix(this.seed, cx, cz, 0x5e17), cx, cz, topY);
    this.lastStructure = { name: set.name, x: cx * 16 + 2, y: topY, z: cz * 16 + 2, pieces: pieces.length, variant: kind };
    return { pieces: [], shaft: { kind, pieces } };
  }

  /**
   * Vanilla's `OceanRuinPieces.addClusterRuins`: the ruin a start lands on is surrounded by four to
   * eight more, scattered about two chunks around it and each sunk to the sea floor under itself.
   */
  private ruinCluster(set: StructureSet, wx: number, wz: number, rng: Rng, decaySeed: number): StructurePlacement[] {
    const out: StructurePlacement[] = [];
    const spread = set.cluster ?? 24;
    const wanted = 4 + rng.int(5);
    // only the small ruins scatter; the big one is the centrepiece
    const small = set.templates.filter((t) => !t.key.includes('big_'));
    if (!small.length) return out;
    for (let i = 0; i < wanted; i++) {
      const template = small[rng.int(small.length)];
      const rotation = rng.int(4);
      const [sx, , sz] = template.size;
      const [w, d] = (rotation & 1) === 1 ? [sz, sx] : [sx, sz];
      const x = wx + rng.int(spread * 2 + 1) - spread;
      const z = wz + rng.int(spread * 2 + 1) - spread;
      const y = this.structureGroundY(x, z, w, d, 'ocean_floor');
      if (y === null) continue;
      out.push({ set, template, x, y, z, rotation, integrity: 1, decaySeed, placement: 'ocean_floor' });
    }
    return out;
  }

  /**
   * Vanilla's `IglooPieces`: half of all igloos hide a ladder shaft under the trapdoor, four to
   * eleven three-block sections deep, ending in the laboratory with its chest and brewing stand.
   * Every piece turns about its own ladder column, which is what keeps the shaft lined up when the
   * igloo is rotated.
   */
  private iglooBasement(
    set: StructureSet,
    top: StructureSet['templates'][number],
    x: number,
    y: number,
    z: number,
    rotation: number,
    rng: Rng,
    decaySeed: number,
  ): StructurePlacement[] {
    const middle = set.byKey.get('igloo_middle');
    const bottom = set.byKey.get('igloo_bottom');
    if (!middle || !bottom || rng.next() >= 0.5) return [];
    const sections = 4 + rng.int(8);
    // world column the ladder runs down, taken from the trapdoor in the igloo's floor
    const [tx, tz] = rotate(IGLOO_LADDER.top[0], IGLOO_LADDER.top[1], top.size[0], top.size[2], rotation);
    const ax = x + tx;
    const az = z + tz;
    const at = (template: StructureSet['templates'][number], ladder: [number, number], py: number): StructurePlacement => {
      const [lx, lz] = rotate(ladder[0], ladder[1], template.size[0], template.size[2], rotation);
      // the basement is dug into solid ground, so it needs no foundation under it
      return { set, template, x: ax - lx, y: py, z: az - lz, rotation, integrity: 1, decaySeed, placement: 'underground' };
    };
    const pieces = [at(bottom, IGLOO_LADDER.bottom, y - 3 - sections * 3)];
    for (let i = 0; i < sections - 1; i++) pieces.push(at(middle, IGLOO_LADDER.middle, y - 3 - i * 3));
    return pieces;
  }

  /**
   * Woodland mansions: two floors of vanilla's own rooms on its eight-block grid, walled, roofed and
   * fronted by the entrance hall, sitting on the flattest ground the footprint can find.
   */
  private buildMansion(set: StructureSet, wx: number, wz: number, rng: Rng, decaySeed: number): StructureInstance {
    const span = GRID * CELL;
    const ground = this.structureGroundY(wx, wz, span, span, 'temple');
    if (ground === null) return EMPTY_STRUCTURE;
    const laid = assembleMansion(set, mix(this.seed, wx, wz, 0x3a11), wx, ground, wz);
    const pieces: StructurePlacement[] = [];
    for (const piece of laid) {
      const template = set.byKey.get(piece.key);
      if (!template) continue;
      pieces.push({ set, template, x: piece.x, y: piece.y, z: piece.z, rotation: piece.rotation, integrity: 1, decaySeed, placement: 'surface' });
    }
    if (!pieces.length) return EMPTY_STRUCTURE;
    this.lastStructure = { name: set.name, x: wx, y: ground, z: wz, pieces: pieces.length };
    return { pieces };
  }

  /**
   * Fossils: a spine or a skull buried in the ground, most of it bone and a little of it coal, the
   * way vanilla lays the base template down rotted and its coal twin over the top.
   */
  private buildFossil(set: StructureSet, wx: number, wz: number, rng: Rng, decaySeed: number): StructureInstance {
    const base = set.mainTemplates[rng.int(set.mainTemplates.length)];
    const coal = set.byKey.get(`${base.key}_coal`);
    const rotation = rng.int(4);
    const surface = Math.floor(this.columnInfo(wx, wz).height);
    // vanilla buries the upper fossil anywhere under the surface and the lower one in the deepslate
    const deep = rng.next() < 0.5;
    const y = deep
      ? WORLD_MIN_Y + 8 + rng.int(40)
      : Math.max(0, Math.min(surface - 12, rng.int(Math.max(1, surface - 12))));
    if (y + base.size[1] >= surface - 2) return EMPTY_STRUCTURE;
    // vanilla only buries one where the ground round it is solid, so it does not hang in a cave
    const [sx, , sz] = base.size;
    const [w, d] = (rotation & 1) === 1 ? [sz, sx] : [sx, sz];
    for (const [cx2, cz2] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1]] as [number, number][]) {
      const at = this.columnInfo(wx + cx2, wz + cz2);
      if (y > Math.floor(at.height) - 4) return EMPTY_STRUCTURE;
    }
    this.lastStructure = { name: set.name, x: wx, y, z: wz, variant: base.key };
    const pieces: StructurePlacement[] = [
      // the bones rot a little, and only a fraction of the coal seam comes through
      { set, template: base, x: wx, y, z: wz, rotation, integrity: 0.9, decaySeed, placement: 'underground' },
    ];
    if (coal) pieces.push({ set, template: coal, x: wx, y, z: wz, rotation, integrity: 0.15, decaySeed: decaySeed ^ 0x5c0a1, placement: 'underground' });
    return { pieces };
  }

  /**
   * Buried treasure: one chest under the sand of a beach, which is what a treasure map points at.
   * It is written where it is worked out rather than through a piece, since it is a single block.
   */
  /**
   * Ocean monuments: vanilla starts the building at a fixed y so its roof comes out just under the
   * sea, and only builds where the floor is deep enough to take the whole thing.
   */
  private buildMonument(set: StructureSet, wx: number, wz: number): StructureInstance {
    const [w, , d] = MONUMENT_SIZE;
    // the floor has to be low enough across the footprint, or the block would break the surface
    for (const [ox, oz] of [[0, 0], [w - 1, 0], [0, d - 1], [w - 1, d - 1], [w >> 1, d >> 1]]) {
      if (Math.floor(this.columnInfo(wx + ox, wz + oz).height) > MONUMENT_Y + 12) return EMPTY_STRUCTURE;
    }
    this.lastStructure = { name: set.name, x: wx, y: MONUMENT_Y, z: wz };
    return { pieces: [], monument: { x: wx, y: MONUMENT_Y, z: wz, seed: mix(this.seed ^ set.salt, wx, wz, 0x11071) } };
  }

  private buildBuriedTreasure(set: StructureSet, wx: number, wz: number): StructureInstance {
    const surface = Math.floor(this.columnInfo(wx, wz).height);
    this.lastStructure = { name: set.name, x: wx, y: surface, z: wz };
    return { pieces: [], treasure: { x: wx, y: surface, z: wz } };
  }

  /**
   * Vanilla's `BuriedTreasurePiece`: walk down from the sea floor until the block underneath is
   * something the beach sits on, put the chest there, and seal whatever air or water touches it, so
   * the treasure is properly buried rather than sitting out on the sand.
   */
  private buryTreasure(world: BlockAccess, clip: ClipBox, t: { x: number; y: number; z: number }, loot: (x: number, y: number, z: number, table: string) => void): void {
    if (t.x < clip.x0 || t.x > clip.x1 || t.z < clip.z0 || t.z > clip.z1) return;
    const bedrock = ['sandstone', 'stone', 'andesite', 'granite', 'diorite', 'deepslate', 'tuff'];
    const sand = this.block('sand');
    for (let y = t.y; y > WORLD_MIN_Y + 2; y--) {
      const below = world.get(t.x, y - 1, t.z);
      if (!below || !bedrock.includes(blocks.blockOf(below).id)) continue;
      // whatever is open around the chest is packed with sand, so nothing gives its place away
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]] as [number, number, number][]) {
        const nx = t.x + dx;
        const nz = t.z + dz;
        if (nx < clip.x0 || nx > clip.x1 || nz < clip.z0 || nz > clip.z1) continue;
        const at = world.get(nx, y + dy, nz);
        if (at === this.air || at === this.water) world.set(nx, y + dy, nz, sand);
      }
      world.set(t.x, y, t.z, blocks.stateWith('chest', { facing: 'north', type: 'single', waterlogged: 'false' }));
      loot(t.x, y, t.z, 'chests/buried_treasure');
      return;
    }
  }

  /**
   * Strongholds: vanilla spreads 128 of them in rings round the origin rather than on a grid, three
   * in the first ring about 1400 blocks out, then more in each ring beyond it.
   */
  strongholdRings(set: StructureSet): { cx: number; cz: number }[] {
    if (this.rings) return this.rings;
    const rng = new Rng(mix(this.seed, 0, 0, 0x571a));
    const count = set.count ?? 128;
    const distance = set.distance ?? 32;
    let spread = set.spread ?? 3;
    let angle = rng.next() * Math.PI * 2;
    let ring = 0;
    let placed = 0;
    const out: { cx: number; cz: number }[] = [];
    for (let i = 0; i < count; i++) {
      const away = 4 * distance + distance * ring * 6 + (rng.next() - 0.5) * distance * 2.5;
      out.push({ cx: Math.round(Math.cos(angle) * away), cz: Math.round(Math.sin(angle) * away) });
      angle += (Math.PI * 2) / spread;
      if (++placed === spread) {
        ring++;
        placed = 0;
        spread = Math.min(spread + Math.floor((2 * spread) / (ring + 1)), count - i);
        angle += rng.next() * Math.PI * 2;
      }
    }
    this.rings = out;
    return out;
  }
  private rings: { cx: number; cz: number }[] | null = null;

  /** The warren of one stronghold, put deep enough that its staircase stays underground. */
  private buildStronghold(set: StructureSet, cx: number, cz: number): StructureInstance {
    const surface = Math.floor(this.columnInfo(cx * 16 + 2, cz * 16 + 2).height);
    const topY = Math.min(surface - 12, 40);
    if (topY < WORLD_MIN_Y + 30) return EMPTY_STRUCTURE;
    const rooms = assembleStronghold(mix(this.seed, cx, cz, 0x5721), cx, cz, topY);
    if (!rooms.length) return EMPTY_STRUCTURE;
    this.lastStructure = { name: set.name, x: cx * 16 + 2, y: topY, z: cz * 16 + 2, pieces: rooms.length };
    return { pieces: [], rooms };
  }

  /**
   * The temples vanilla builds in code: a desert pyramid or jungle temple sits its floor on the
   * ground, and a swamp hut stands on stilts on the water the way vanilla puts it on the surface
   * heightmap rather than the ground.
   */
  private buildTempleAt(set: StructureSet, wx: number, wz: number, rng: Rng): StructureInstance {
    const kind = set.placement as TempleKind;
    const rotation = rng.int(4);
    const [tw, , td] = TEMPLE_SIZE[kind];
    const [w, d] = (rotation & 1) === 1 ? [td, tw] : [tw, td];
    const ground = this.structureGroundY(wx, wz, w, d, kind === 'swamp_hut' ? 'water_surface' : 'temple');
    if (ground === null) return EMPTY_STRUCTURE;
    // a temple's own floor is its local y 0, which sits on the ground rather than one above it
    const y = kind === 'swamp_hut' ? ground : ground - 1;
    this.lastStructure = { name: set.name, x: wx, y, z: wz, variant: kind };
    return { pieces: [], temple: { kind, x: wx, y, z: wz, rotation, seed: mix(this.seed, wx, wz, 0x7e39) } };
  }

  /**
   * Villages: assemble the jigsaw pieces around a town centre, sitting every piece on the ground
   * under it the way vanilla's rigid projection does.
   */
  private buildJigsaw(set: StructureSet, biome: string, wx: number, wz: number, rng: Rng, decaySeed: number): StructurePlacement[] {
    // which of the set's structures belongs here: a desert village in a desert, a taiga one in a taiga
    const variant = pickVariant(set, biome, rng);
    if (!variant) return [];
    const startPool = variant.start;
    // a city is built at the depth its structure names; a village follows the ground it stands on
    const buried = set.startY !== undefined;
    const baseY = buried
      ? set.startY! + (set.startYMax && set.startYMax > set.startY! ? rng.int(set.startYMax - set.startY! + 1) : 0)
      : Math.floor(this.columnInfo(wx, wz).height) + 1;
    const assembled = assembleJigsaw(set, startPool, wx, baseY, wz, rng);
    if (assembled.length < 2) return [];
    const pieces = assembled.map((piece) => {
      const [sx, , sz] = piece.template.size;
      const [w, d] = (piece.rotation & 1) === 1 ? [sz, sx] : [sx, sz];
      // rigid pieces follow the ground under themselves, which keeps a village on a slope walkable
      const ground = buried ? null : this.structureGroundY(piece.x, piece.z, w, d);
      return {
        set, template: piece.template, x: piece.x, y: ground ?? piece.y, z: piece.z,
        rotation: piece.rotation, integrity: 1, decaySeed, placement: buried ? 'buried' : 'surface',
      };
    });
    this.lastStructure = { name: set.name, x: wx, y: baseY, z: wz, pieces: pieces.length, variant: variant.start };
    return pieces;
  }

  /**
   * Vanilla's terrain adaptation in miniature: clear whatever terrain sits inside the structure's
   * box and give it a foundation down to the ground, so a piece on a slope is neither buried nor
   * left floating. Ocean pieces keep their water, since a shipwreck is meant to be flooded.
   */
  private fitStructureToTerrain(
    world: BlockAccess,
    box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number },
    written: Set<string>,
    placement: string,
    clip: ClipBox,
  ): void {
    // a piece dug into the ground carves its own room out of the stone and needs no foundation
    if (placement === 'underground') return;
    // vanilla's beardifier hollows the whole box a buried structure sits in, which is what makes an
    // ancient city a cavern full of buildings rather than a warren packed in solid deepslate
    if (placement === 'buried') {
      for (let x = Math.max(box.x0, clip.x0); x <= Math.min(box.x1, clip.x1); x++)
        for (let z = Math.max(box.z0, clip.z0); z <= Math.min(box.z1, clip.z1); z++)
          for (let y = box.y0; y <= box.y1; y++) {
            if (written.has(`${x},${y},${z}`)) continue;
            const cur = world.get(x, y, z);
            if (cur !== this.air && cur !== this.water) world.set(x, y, z, this.air);
          }
      return;
    }
    const filler = this.block('dirt');
    for (let x = Math.max(box.x0, clip.x0); x <= Math.min(box.x1, clip.x1); x++)
      for (let z = Math.max(box.z0, clip.z0); z <= Math.min(box.z1, clip.z1); z++) {
        // carve the terrain that would poke into the piece
        if (placement !== 'ocean_floor') {
          for (let y = box.y0; y <= box.y1; y++) {
            if (written.has(`${x},${y},${z}`)) continue;
            const cur = world.get(x, y, z);
            if (cur !== this.air && cur !== this.water) world.set(x, y, z, this.air);
          }
        }
        // and hold it up where the ground falls away
        for (let dy = 1; dy <= 8; dy++) {
          const cur = world.get(x, box.y0 - dy, z);
          if (cur !== this.air && cur !== this.water) break;
          if (placement === 'ocean_floor' && cur === this.water) break;
          world.set(x, box.y0 - dy, z, filler);
        }
      }
  }

  /** Ground height a structure should sit on: the lowest surface under its footprint. */
  private structureGroundY(wx: number, wz: number, w: number, d: number, placement = 'surface'): number | null {
    let lowest = Infinity;
    let highest = -Infinity;
    // sample a grid over the footprint, not just its corners
    const step = Math.max(1, Math.floor(Math.min(w, d) / 3));
    for (let dx = 0; dx < w; dx += step)
      for (let dz = 0; dz < d; dz += step) {
        const h = Math.floor(this.columnInfo(wx + dx, wz + dz).height);
        lowest = Math.min(lowest, h);
        highest = Math.max(highest, h);
      }
    if (!Number.isFinite(lowest)) return null;
    // a temple carries its own foundation down to the ground, so it does not need level ground first
    if (placement === 'temple') return lowest < SEA_LEVEL ? null : lowest + 1;
    // and a swamp hut stands on stilts on the water it is built over, following the surface
    if (placement === 'water_surface') return Math.max(lowest, SEA_LEVEL);
    // vanilla only starts a structure where the ground is close to level; ours allows a small slope
    if (highest - lowest > 3) return null;
    if (placement === 'ocean_floor') {
      if (lowest >= SEA_LEVEL - 2) return null;
      return lowest + 1;
    }
    if (lowest < SEA_LEVEL) return null;
    return lowest + 1;
  }

  /** The last structure worked out, for tests and debugging. */
  lastStructure: { name: string; x: number; y: number; z: number; pieces?: number; variant?: string } | null = null;
  /**
   * Block entities the structures in this chunk want: chests with the loot table that fills them,
   * spawners with the mob they turn. They are made on the main thread, where the tables live.
   */
  structureSpots: StructureSpot[] = [];
  /** Structures already worked out, keyed by set and start chunk; every chunk they cover reuses them. */
  private readonly structureCache = new Map<string, StructureInstance>();

  /** Pale gardens hang moss from their canopy and spread pale moss over the ground, as vanilla does. */
  private decoratePaleGarden(chunk: ChunkData, world: BlockAccess, rng: Rng, biomeAt: (lx: number, lz: number) => BiomeDef): void {
    if (biomeAt(8, 8).id !== 'pale_garden') return;
    const ox = chunk.cx * 16;
    const oz = chunk.cz * 16;
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        const top = chunk.topBlock(lx, lz);
        for (let y = top; y > top - 24 && y > SEA_LEVEL - 8; y--) {
          const here = chunk.get(lx, y, lz);
          if (blocks.idOf(here) !== 'pale_oak_leaves') continue;
          if (chunk.get(lx, y - 1, lz) !== this.air || !rng.chance(0.25)) continue;
          const length = rng.range(1, 4);
          for (let k = 1; k <= length; k++) {
            if (world.get(wx, y - k, wz) !== this.air) break;
            world.set(wx, y - k, wz, blocks.stateWith('pale_hanging_moss', { tip: k === length ? 'true' : 'false' }));
          }
        }
        // patches of pale moss on the forest floor
        if (top > SEA_LEVEL && blocks.idOf(chunk.get(lx, top, lz)) === 'grass_block' && rng.chance(0.08)) {
          world.set(wx, top, wz, this.block('pale_moss_block'));
        }
      }
  }

  /**
   * Ocean floors: vanilla dresses them with seagrass everywhere, kelp forests in the cooler seas,
   * coral reefs with fans and sea pickles in warm water, and icebergs in the frozen ones.
   */
  private decorateOcean(
    chunk: ChunkData,
    world: BlockAccess,
    rng: Rng,
    biomeAt: (lx: number, lz: number) => BiomeDef,
    surfaceAt: (lx: number, lz: number) => { y: number; block: number },
  ): void {
    const ox = chunk.cx * 16;
    const oz = chunk.cz * 16;
    const b = biomeAt(8, 8);
    if (b.category !== 'ocean' && b.category !== 'river' && !(b.category === 'ice' && b.id.includes('ocean'))) return;
    const frozen = b.id.includes('frozen');
    // only true warm oceans grow coral; lukewarm ones get kelp like the colder seas
    const warm = b.id === 'warm_ocean';
    // the sea floor: the topmost solid block under the water column, not the water surface
    const floorAt = (lx: number, lz: number): number => {
      for (let y = SEA_LEVEL - 1; y > WORLD_MIN_Y; y--) {
        const s2 = chunk.get(lx, y, lz);
        if (s2 !== this.water && s2 !== this.air) return y;
      }
      return WORLD_MIN_Y - 1;
    };
    void surfaceAt;
    // seagrass and kelp
    for (let i = 0; i < 40; i++) {
      const lx = rng.int(16);
      const lz = rng.int(16);
      const y = floorAt(lx, lz);
      if (y >= SEA_LEVEL - 2 || y < WORLD_MIN_Y) continue;
      const wx = ox + lx;
      const wz = oz + lz;
      if (world.get(wx, y + 1, wz) !== this.water) continue;
      if (!warm && rng.chance(0.12)) {
        // a kelp column reaching most of the way to the surface
        const height = rng.range(3, Math.max(3, SEA_LEVEL - y - 2));
        for (let k = 1; k <= height; k++) {
          if (world.get(wx, y + k, wz) !== this.water) break;
          world.set(wx, y + k, wz, this.block(k === height ? 'kelp' : 'kelp_plant'));
        }
        continue;
      }
      if (rng.chance(0.35)) {
        if (rng.chance(0.25) && world.get(wx, y + 2, wz) === this.water) {
          world.set(wx, y + 1, wz, blocks.stateWith('tall_seagrass', { half: 'lower' }));
          world.set(wx, y + 2, wz, blocks.stateWith('tall_seagrass', { half: 'upper' }));
        } else world.set(wx, y + 1, wz, this.block('seagrass'));
      }
    }
    if (warm && rng.chance(0.6)) {
      const lx = rng.int(16), lz = rng.int(16);
      this.placeCoralReef(world, rng, ox + lx, oz + lz, floorAt(lx, lz));
    }
    if (frozen && rng.chance(0.12)) this.placeIceberg(world, rng, ox + rng.int(16), oz + rng.int(16));
  }

  /** A blob of coral blocks with fans and sea pickles, vanilla's warm-ocean reef in miniature. */
  private placeCoralReef(world: BlockAccess, rng: Rng, wx: number, wz: number, y: number): void {
    if (y >= SEA_LEVEL - 3 || y < WORLD_MIN_Y) return;
    const kinds = ['tube', 'brain', 'bubble', 'fire', 'horn'];
    const kind = rng.pick(kinds);
    const radius = 2 + rng.int(3);
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++)
        for (let dy = 0; dy <= radius; dy++) {
          if (dx * dx + dz * dz + dy * dy > radius * radius) continue;
          const x = wx + dx, z = wz + dz, cy = y + dy;
          if (world.get(x, cy, z) !== this.water) continue;
          if (dy === 0 || rng.chance(0.55)) world.set(x, cy, z, this.block(`${rng.chance(0.7) ? kind : rng.pick(kinds)}_coral_block`));
        }
    // fans and pickles on top of the reef
    for (let i = 0; i < 24; i++) {
      const x = wx + rng.range(-radius, radius);
      const z = wz + rng.range(-radius, radius);
      for (let dy = radius + 1; dy >= 0; dy--) {
        const cy = y + dy;
        if (world.get(x, cy, z) !== this.water || !blocks.idOf(world.get(x, cy - 1, z)).endsWith('_coral_block')) continue;
        if (rng.chance(0.35)) world.set(x, cy, z, blocks.stateWith('sea_pickle', { pickles: String(rng.range(1, 4)), waterlogged: 'true' }));
        else world.set(x, cy, z, blocks.stateWith(`${rng.pick(kinds)}_coral_fan`, { waterlogged: 'true' }));
        break;
      }
    }
  }

  /** Packed-ice iceberg with a blue ice core and snow on top, like vanilla's frozen ocean feature. */
  private placeIceberg(world: BlockAccess, rng: Rng, wx: number, wz: number): void {
    const height = rng.range(6, 20);
    const radius = rng.range(3, 8);
    const base = SEA_LEVEL - 1 - rng.range(2, 6);
    for (let dy = 0; dy < height; dy++) {
      // the berg tapers as it rises, with a wobble so it does not read as a cone
      const t = dy / height;
      const r = Math.max(1, radius * (1 - t * 0.8) + (rng.chance(0.3) ? 1 : 0));
      for (let dx = -Math.ceil(r); dx <= Math.ceil(r); dx++)
        for (let dz = -Math.ceil(r); dz <= Math.ceil(r); dz++) {
          if (dx * dx + dz * dz > r * r) continue;
          const y = base + dy;
          const cur = world.get(wx + dx, y, wz + dz);
          if (cur !== this.water && cur !== this.air) continue;
          const core = dy < height * 0.3 && dx * dx + dz * dz < (r * 0.4) ** 2;
          world.set(wx + dx, y, wz + dz, this.block(core ? 'blue_ice' : 'packed_ice'));
        }
    }
    for (let dx = -radius; dx <= radius; dx++)
      for (let dz = -radius; dz <= radius; dz++) {
        for (let y = base + height; y > base; y--) {
          if (blocks.idOf(world.get(wx + dx, y, wz + dz)) !== 'packed_ice') continue;
          if (world.get(wx + dx, y + 1, wz + dz) === this.air && rng.chance(0.6)) world.set(wx + dx, y + 1, wz + dz, this.block('snow'));
          break;
        }
      }
  }

  /**
   * Lush, dripstone and deep dark cave features: floors and ceilings of cave air inside a cave biome
   * get their biome blocks, plus glow lichen in every cave.
   */
  private decorateCaves(chunk: ChunkData, world: BlockAccess, rng: Rng): void {
    const ox = chunk.cx * 16;
    const oz = chunk.cz * 16;
    const AIR = this.air;
    const isRock = (s: number) => s === this.stone || s === this.deepslate;
    const B = (id: string) => this.block(id);
    for (let lz = 0; lz < 16; lz++)
      for (let lx = 0; lx < 16; lx++) {
        const wx = ox + lx;
        const wz = oz + lz;
        const surface = chunk.topBlock(lx, lz);
        const start = Math.min(surface - 8, 200);
        for (let y = start; y > WORLD_MIN_Y + 6; y--) {
          if (chunk.get(lx, y, lz) !== AIR) continue;
          const below = chunk.get(lx, y - 1, lz);
          const above = chunk.get(lx, y + 1, lz);
          const floor = isRock(below);
          const ceiling = isRock(above);
          if (!floor && !ceiling) continue;
          if (ceiling && rng.chance(0.012)) world.set(wx, y, wz, blocks.stateWith('glow_lichen', { up: 'true' }));
          const biome = this.caveBiomeAt(wx, y, wz, surface);
          if (!biome) continue;
          if (biome === 'lush') {
            if (floor) {
              world.set(wx, y - 1, wz, B(rng.chance(0.9) ? 'moss_block' : 'clay'));
              const r = rng.next();
              if (r < 0.22) world.set(wx, y, wz, B('short_grass'));
              else if (r < 0.3) placeTallPlant(world, 'tall_grass', wx, y, wz);
              else if (r < 0.42) world.set(wx, y, wz, B('moss_carpet'));
              else if (r < 0.46) world.set(wx, y, wz, B('azalea'));
              else if (r < 0.485) world.set(wx, y, wz, B('flowering_azalea'));
            }
            if (ceiling) {
              if (rng.chance(0.6)) world.set(wx, y + 1, wz, B('moss_block'));
              if (rng.chance(0.1)) {
                const len = rng.range(1, 7);
                let yy = y;
                for (let i = 0; i < len && chunk.get(lx, yy, lz) === AIR && yy > WORLD_MIN_Y + 6; i++, yy--) {
                  const last = i === len - 1 || chunk.get(lx, yy - 1, lz) !== AIR;
                  world.set(wx, yy, wz, blocks.stateWith(last ? 'cave_vines' : 'cave_vines_plant', last ? { age: '0', berries: rng.chance(0.11) ? 'true' : 'false' } : { berries: rng.chance(0.11) ? 'true' : 'false' }));
                  if (last) break;
                }
              } else if (rng.chance(0.02)) world.set(wx, y, wz, B('spore_blossom'));
            }
          } else if (biome === 'dripstone') {
            if (floor) {
              if (rng.chance(0.7)) world.set(wx, y - 1, wz, B('dripstone_block'));
              if (rng.chance(0.07)) {
                const len = rng.range(1, 4);
                for (let i = 0; i < len && chunk.get(lx, y + i, lz) === AIR; i++) {
                  const l = Math.min(len, this.airRun(chunk, lx, y, lz, 1, len));
                  world.set(wx, y + i, wz, blocks.stateWith('pointed_dripstone', { thickness: dripstoneThickness(l, i), vertical_direction: 'up', waterlogged: 'false' }));
                }
              }
            }
            if (ceiling) {
              if (rng.chance(0.7)) world.set(wx, y + 1, wz, B('dripstone_block'));
              if (rng.chance(0.09)) {
                const len = rng.range(1, 5);
                const l = Math.min(len, this.airRun(chunk, lx, y, lz, -1, len));
                for (let i = 0; i < l; i++) world.set(wx, y - i, wz, blocks.stateWith('pointed_dripstone', { thickness: dripstoneThickness(l, i), vertical_direction: 'down', waterlogged: 'false' }));
              }
            }
          } else {
            if (floor) {
              if (rng.chance(0.85)) world.set(wx, y - 1, wz, B('sculk'));
              const r = rng.next();
              if (r < 0.015) world.set(wx, y, wz, blocks.stateWith('sculk_sensor', { power: '0', sculk_sensor_phase: 'inactive', waterlogged: 'false' }));
              else if (r < 0.02) world.set(wx, y, wz, blocks.stateWith('sculk_shrieker', { can_summon: 'false', shrieking: 'false', waterlogged: 'false' }));
              else if (r < 0.028) world.set(wx, y, wz, B('sculk_catalyst'));
            }
            if (ceiling && rng.chance(0.08)) world.set(wx, y, wz, blocks.stateWith('sculk_vein', { up: 'true' }));
          }
        }
      }
  }

  /** Number of consecutive air cells from y in direction dir (1 up, -1 down), capped. */
  private airRun(chunk: ChunkData, lx: number, y: number, lz: number, dir: number, cap: number): number {
    let n = 0;
    while (n < cap && y + dir * n > WORLD_MIN_Y && y + dir * n < 319 && chunk.get(lx, y + dir * n, lz) === this.air) n++;
    return n;
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
