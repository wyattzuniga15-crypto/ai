import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { biomes } from '../src/world/biomes.ts';
import { ChunkData } from '../src/world/chunk.ts';
import { EndGenerator, END_PLATFORM, END_SURFACE } from '../src/world/gen/end.ts';

const gen = new EndGenerator(20260907);
const chunk = (cx = 0, cz = 0) => {
  const c = new ChunkData(cx, cz);
  gen.generateTerrain(c);
  return c;
};
const idAt = (c: ChunkData, x: number, y: number, z: number) => {
  const s = c.get(x, y, z);
  return s === 0 ? 'air' : blocks.blockOf(s).id;
};

describe('the End island', () => {
  it('is a hundred blocks across from the middle, as vanilla measures it', () => {
    expect(gen.islandAt(0, 0)).toBeCloseTo(80); // vanilla clamps the middle to eighty
    expect(gen.islandAt(50, 0)).toBeCloseTo(50);
    expect(gen.islandAt(99, 0)).toBeLessThan(2);
    expect(gen.islandAt(120, 0)).toBeLessThan(0);
  });

  it('is made of end stone around y 64, and nothing else', () => {
    const c = chunk();
    const found = new Set<string>();
    for (let x = 0; x < 16; x += 3) for (let z = 0; z < 16; z += 3) for (let y = 0; y < 128; y += 2) found.add(idAt(c, x, y, z));
    expect(found.has('end_stone')).toBe(true);
    expect([...found].every((id) => id === 'air' || id === 'end_stone')).toBe(true);
    expect(idAt(c, 8, END_SURFACE, 8)).toBe('end_stone');
    expect(idAt(c, 8, 120, 8)).toBe('air');
    expect(idAt(c, 8, 10, 8)).toBe('air');
  });

  it('leaves the void between the middle island and the outer ones', () => {
    // a chunk two hundred blocks out is empty sky
    const c = chunk(14, 0);
    let solid = 0;
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 0; y < 128; y++) if (c.get(x, y, z) !== 0) solid++;
    expect(solid).toBe(0);
  });

  it('gives the middle island vanilla\'s own biome, and the outer ones theirs', () => {
    const middle = chunk();
    expect(biomes[middle.biomes[0]].id).toBe('the_end');
    const far = chunk(200, 200);
    for (let i = 0; i < 256; i += 37) expect(biomes[far.biomes[i]].dimension).toBe('end');
  });

  it('puts vanilla\'s arrival platform where vanilla puts it', () => {
    expect(END_PLATFORM).toEqual([100, 49, 0]);
  });

  it('comes out the same for the same seed, and different for another', () => {
    const a = chunk(2, -3);
    const b = new ChunkData(2, -3);
    gen.generateTerrain(b);
    expect(Array.from(b.blocks)).toEqual(Array.from(a.blocks));
    const other = new ChunkData(2, -3);
    new EndGenerator(7).generateTerrain(other);
    // the middle island is the same shape whatever the seed; its crags are not
    expect(Array.from(other.blocks)).not.toEqual(Array.from(a.blocks));
  });
});

describe('outer islands', () => {
  it('appear past the void, and grow chorus plants', () => {
    let island: [number, number] | null = null;
    for (let r = 512; r < 900 && !island; r += 16)
      for (let a = 0; a < 12; a++) {
        const x = Math.round(Math.cos((a / 12) * 6.283) * r);
        const z = Math.round(Math.sin((a / 12) * 6.283) * r);
        if (gen.islandAt(x, z) > 20) { island = [x, z]; break; }
      }
    expect(island).not.toBeNull();
    const [ix, iz] = island!;
    const cx = ix >> 4, cz = iz >> 4;
    const chunks = new Map<string, ChunkData>();
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
      const c = new ChunkData(cx + dx, cz + dz);
      gen.generateTerrain(c);
      chunks.set(`${cx + dx},${cz + dz}`, c);
    }
    const world = {
      get: (x: number, y: number, z: number) => chunks.get(`${x >> 4},${z >> 4}`)?.get(x & 15, y, z & 15) ?? 0,
      set: (x: number, y: number, z: number, s: number) => chunks.get(`${x >> 4},${z >> 4}`)?.set(x & 15, y, z & 15, s),
    };
    let chorus = 0;
    for (const c of chunks.values()) {
      gen.decorate(c, world);
      for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 40; y < 110; y++) {
        const id = idAt(c, x, y, z);
        if (id === 'chorus_plant' || id === 'chorus_flower') chorus++;
      }
    }
    expect(chorus).toBeGreaterThan(0);
  });

  it('never grows anything on the middle island', () => {
    const c = chunk();
    const world = { get: () => 0, set: () => { throw new Error('the middle island is bare'); } };
    expect(() => gen.decorate(c, world)).not.toThrow();
  });
});
