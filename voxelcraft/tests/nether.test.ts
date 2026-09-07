import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { biomes } from '../src/world/biomes.ts';
import { ChunkData } from '../src/world/chunk.ts';
import { NetherGenerator, NETHER_FLOOR, NETHER_LAVA_LEVEL, NETHER_ROOF } from '../src/world/gen/nether.ts';

const gen = new NetherGenerator(20260907);
const chunk = (cx = 0, cz = 0) => {
  const c = new ChunkData(cx, cz);
  gen.generateTerrain(c);
  return c;
};

const idAt = (c: ChunkData, x: number, y: number, z: number) => {
  const s = c.get(x, y, z);
  return s === 0 ? 'air' : blocks.blockOf(s).id;
};

describe('nether terrain', () => {
  it('is a box: bedrock under the floor and over the roof, as vanilla builds it', () => {
    const c = chunk();
    expect(NETHER_FLOOR).toBe(0);
    expect(NETHER_ROOF).toBe(127);
    for (let x = 0; x < 16; x += 5)
      for (let z = 0; z < 16; z += 5) {
        expect(idAt(c, x, NETHER_FLOOR, z)).toBe('bedrock');
        expect(idAt(c, x, NETHER_ROOF, z)).toBe('bedrock');
      }
  });

  it('leaves nothing above the roof or below the floor', () => {
    const c = chunk();
    for (let x = 0; x < 16; x += 5)
      for (let z = 0; z < 16; z += 5) {
        expect(idAt(c, x, NETHER_ROOF + 1, z)).toBe('air');
        expect(idAt(c, x, NETHER_FLOOR - 1, z)).toBe('air');
      }
  });

  it('fills the bottom with a sea of lava at vanilla\'s level', () => {
    const c = chunk();
    let lava = 0;
    let above = 0;
    for (let x = 0; x < 16; x++)
      for (let z = 0; z < 16; z++) {
        if (idAt(c, x, NETHER_LAVA_LEVEL - 4, z) === 'lava') lava++;
        if (idAt(c, x, NETHER_LAVA_LEVEL + 2, z) === 'lava') above++;
      }
    expect(lava).toBeGreaterThan(0);
    expect(above).toBe(0); // nothing pools above the sea
  });

  it('is netherrack and its ores, never overworld stone', () => {
    const found = new Set<string>();
    for (let cx = 0; cx < 3; cx++)
      for (let cz = 0; cz < 3; cz++) {
        const c = chunk(cx, cz);
        for (let x = 0; x < 16; x += 2) for (let z = 0; z < 16; z += 2) for (let y = 1; y < NETHER_ROOF; y += 2) found.add(idAt(c, x, y, z));
      }
    expect(found.has('netherrack')).toBe(true);
    expect(found.has('nether_quartz_ore')).toBe(true);
    expect(found.has('stone')).toBe(false);
    expect(found.has('water')).toBe(false);
    expect(found.has('grass_block')).toBe(false);
  });

  it('lays vanilla\'s five nether biomes, and only those', () => {
    const seen = new Set<string>();
    for (let cx = -8; cx <= 8; cx += 2)
      for (let cz = -8; cz <= 8; cz += 2) {
        const c = chunk(cx, cz);
        for (let i = 0; i < 256; i += 17) seen.add(biomes[c.biomes[i]].id);
      }
    for (const id of seen) expect(biomes.find((b) => b.id === id)?.dimension).toBe('nether');
    expect(seen.size).toBeGreaterThan(1);
    expect([...seen].every((id) => ['nether_wastes', 'soul_sand_valley', 'crimson_forest', 'warped_forest', 'basalt_deltas'].includes(id))).toBe(true);
  });

  it('dresses a biome in what it is made of', () => {
    const tops = new Map<string, Set<string>>();
    for (let cx = -12; cx <= 12; cx += 3)
      for (let cz = -12; cz <= 12; cz += 3) {
        const c = chunk(cx, cz);
        for (let x = 0; x < 16; x += 4)
          for (let z = 0; z < 16; z += 4) {
            const biome = biomes[c.biomes[z * 16 + x]].id;
            for (let y = NETHER_ROOF - 1; y > NETHER_LAVA_LEVEL; y--) {
              if (idAt(c, x, y, z) === 'air' || idAt(c, x, y + 1, z) !== 'air') continue;
              const set = tops.get(biome) ?? new Set<string>();
              set.add(idAt(c, x, y, z));
              tops.set(biome, set);
              break;
            }
          }
      }
    if (tops.has('crimson_forest')) expect([...tops.get('crimson_forest')!]).toContain('crimson_nylium');
    if (tops.has('warped_forest')) expect([...tops.get('warped_forest')!]).toContain('warped_nylium');
    if (tops.has('soul_sand_valley')) expect([...tops.get('soul_sand_valley')!].some((b) => b === 'soul_sand' || b === 'soul_soil')).toBe(true);
    if (tops.has('basalt_deltas')) expect([...tops.get('basalt_deltas')!].some((b) => b === 'basalt' || b === 'blackstone')).toBe(true);
  });

  it('comes out the same for the same seed, and different for another', () => {
    const a = chunk(3, -2);
    const b = new ChunkData(3, -2);
    gen.generateTerrain(b);
    expect(Array.from(b.blocks)).toEqual(Array.from(a.blocks));
    const other = new ChunkData(3, -2);
    new NetherGenerator(99).generateTerrain(other);
    expect(Array.from(other.blocks)).not.toEqual(Array.from(a.blocks));
  });
});
