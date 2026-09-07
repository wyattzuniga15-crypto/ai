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

/** One of the obsidian pillars the end crystals stand on. */
export interface EndSpike {
  x: number;
  z: number;
  /** Half-width of the pillar, so it spans 2r+1 blocks. */
  radius: number;
  height: number;
  /** Vanilla cages three of the ten crystals in iron bars. */
  caged: boolean;
}

/**
 * Vanilla's ten spikes: evenly spaced around a circle of radius forty-three, with their order
 * shuffled by the world seed so which one is tall and which is caged changes from world to world.
 */
export function endSpikes(seed: number): EndSpike[] {
  const order = [...Array(10).keys()];
  const rng = new Rng(mix(seed >>> 0, 0, 0, 0x5719));
  // a seeded shuffle, as vanilla shuffles its own list of ten
  for (let i = order.length - 1; i > 0; i--) {
    const j = rng.int(i + 1);
    [order[i], order[j]] = [order[j], order[i]];
  }
  return order.map((slot, i) => {
    const angle = (2 * Math.PI * i) / 10;
    return {
      x: Math.floor(Math.cos(angle) * 42),
      z: Math.floor(Math.sin(angle) * 42),
      radius: 2 + Math.floor(slot / 3),
      height: 76 + slot * 3,
      caged: slot < 3,
    };
  });
}

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

  /** Chorus plants on the outer islands, and the dragon's pillars on the middle one. */
  decorate(chunk: ChunkData, world: BlockAccess): void {
    this.structureSpots = [];
    this.placeSpikes(chunk, world);
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

  /**
   * The ten obsidian pillars, each with an end crystal on top and three of them caged in iron bars,
   * as vanilla stands them around the middle island.
   */
  private placeSpikes(chunk: ChunkData, world: BlockAccess): void {
    const x0 = chunk.cx * 16;
    const z0 = chunk.cz * 16;
    if (Math.hypot(x0, z0) > 96) return;
    const OBSIDIAN = this.block('obsidian');
    const BEDROCK = this.block('bedrock');
    const BARS = this.block('iron_bars');
    for (const spike of endSpikes(this.seed)) {
      if (spike.x + spike.radius < x0 || spike.x - spike.radius > x0 + 15) continue;
      if (spike.z + spike.radius < z0 || spike.z - spike.radius > z0 + 15) continue;
      for (let dx = -spike.radius; dx <= spike.radius; dx++)
        for (let dz = -spike.radius; dz <= spike.radius; dz++) {
          if (dx * dx + dz * dz > (spike.radius + 0.5) ** 2) continue;
          const x = spike.x + dx;
          const z = spike.z + dz;
          if (x < x0 || x > x0 + 15 || z < z0 || z > z0 + 15) continue;
          for (let y = END_SURFACE - 8; y <= spike.height; y++) world.set(x, y, z, OBSIDIAN);
          // vanilla caps each pillar with bedrock under the crystal
          if (dx === 0 && dz === 0) world.set(x, spike.height + 1, z, BEDROCK);
        }
      // the crystal itself, and the cage vanilla puts round three of them
      const inChunk = spike.x >= x0 && spike.x <= x0 + 15 && spike.z >= z0 && spike.z <= z0 + 15;
      if (inChunk) this.structureSpots.push({ x: spike.x + 0.5, y: spike.height + 2, z: spike.z + 0.5, entity: 'end_crystal' });
      if (!spike.caged) continue;
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          const edge = Math.abs(dx) === 2 || Math.abs(dz) === 2;
          const x = spike.x + dx;
          const z = spike.z + dz;
          if (!edge || x < x0 || x > x0 + 15 || z < z0 || z > z0 + 15) continue;
          for (let y = spike.height + 1; y <= spike.height + 4; y++) world.set(x, y, z, BARS);
        }
      for (let dx = -2; dx <= 2; dx++)
        for (let dz = -2; dz <= 2; dz++) {
          const x = spike.x + dx;
          const z = spike.z + dz;
          if (x < x0 || x > x0 + 15 || z < z0 || z > z0 + 15) continue;
          world.set(x, spike.height + 5, z, BARS);
        }
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

/** One block the exit portal's podium asks for, as `endPodium` lays it out. */
export interface PodiumBlock {
  x: number;
  y: number;
  z: number;
  /** `air` where vanilla clears the ground over the fountain. */
  id: string;
  props?: Record<string, string>;
}

/**
 * Vanilla's `EndPodiumFeature`: the bedrock fountain at the middle of the End's island, with the
 * pillar the dragon egg sits on and its four torches. It walks a nine-wide box from one below the
 * podium's level to well above it and measures the distance to the middle in three dimensions, so
 * the disc narrows as it climbs — that is what clears a dome over the fountain rather than a shaft.
 * `active` is the difference between the fountain the island is generated with and the way home the
 * dragon's death opens.
 */
export function endPodium(base: number, active: boolean): PodiumBlock[] {
  const out: PodiumBlock[] = [];
  for (let dx = -4; dx <= 4; dx++)
    for (let dz = -4; dz <= 4; dz++)
      for (let dy = -1; dy <= 32; dy++) {
        const d2 = dx * dx + dy * dy + dz * dz;
        const inner = d2 < 2.5 * 2.5;
        if (!inner && d2 >= 3.5 * 3.5) continue;
        const y = base + dy;
        if (dy < 0) out.push({ x: dx, y, z: dz, id: inner ? 'bedrock' : 'end_stone' });
        else if (dy > 0) out.push({ x: dx, y, z: dz, id: 'air' });
        else out.push({ x: dx, y, z: dz, id: inner ? (active ? 'end_portal' : 'air') : 'bedrock' });
      }
  // the pillar in the middle and the four torches around it
  for (let dy = 0; dy < 4; dy++) out.push({ x: 0, y: base + dy, z: 0, id: 'bedrock' });
  for (const [dx, dz, facing] of [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']] as [number, number, string][])
    out.push({ x: dx, y: base + 2, z: dz, id: 'wall_torch', props: { facing } });
  // vanilla leaves the egg on top of the pillar the first time the dragon is beaten
  if (active) out.push({ x: 0, y: base + 4, z: 0, id: 'dragon_egg' });
  return out;
}
