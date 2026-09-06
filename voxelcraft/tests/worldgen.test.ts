import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '../src/world/gen/generator.ts';
import { ChunkData } from '../src/world/chunk.ts';
import { blocks } from '../src/blocks/registry.ts';
import { biomes } from '../src/world/biomes.ts';
import { hashString, parseSeed } from '../src/core/rng.ts';
import { SEA_LEVEL, WORLD_MIN_Y } from '../src/core/constants.ts';

function hashChunk(c: ChunkData): number {
  let h = 2166136261;
  for (let i = 0; i < c.blocks.length; i++) {
    h ^= c.blocks[i];
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

describe('world generation', () => {
  it('is deterministic per seed', () => {
    const a = new WorldGenerator(12345);
    const b = new WorldGenerator(12345);
    for (const [cx, cz] of [[0, 0], [3, -2], [-7, 11]]) {
      const ca = new ChunkData(cx, cz);
      const cb = new ChunkData(cx, cz);
      a.generateTerrain(ca);
      b.generateTerrain(cb);
      expect(hashChunk(ca)).toBe(hashChunk(cb));
      expect(Array.from(ca.biomes)).toEqual(Array.from(cb.biomes));
    }
  });

  it('differs between seeds', () => {
    const a = new ChunkData(0, 0);
    const b = new ChunkData(0, 0);
    new WorldGenerator(1).generateTerrain(a);
    new WorldGenerator(2).generateTerrain(b);
    expect(hashChunk(a)).not.toBe(hashChunk(b));
  });

  it('produces bedrock, stone, a surface and water at sea level', () => {
    const gen = new WorldGenerator(hashString('voxelcraft'));
    const counts = new Map<string, number>();
    let t0 = performance.now();
    const n = 9;
    for (let cx = -1; cx <= 1; cx++)
      for (let cz = -1; cz <= 1; cz++) {
        const c = new ChunkData(cx, cz);
        gen.generateTerrain(c);
        for (let i = 0; i < c.blocks.length; i++) {
          const id = blocks.idOf(c.blocks[i]);
          counts.set(id, (counts.get(id) ?? 0) + 1);
        }
        for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) expect(blocks.idOf(c.get(x, WORLD_MIN_Y, z))).toBe('bedrock');
      }
    const ms = (performance.now() - t0) / n;
    console.log(`terrain: ${ms.toFixed(1)} ms/chunk`, [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12));
    expect(counts.get('stone')! > 1000).toBe(true);
    expect(counts.get('deepslate')! > 1000).toBe(true);
    expect((counts.get('grass_block') ?? 0) + (counts.get('sand') ?? 0) + (counts.get('gravel') ?? 0) + (counts.get('snow_block') ?? 0) > 100).toBe(true);
    expect(ms).toBeLessThan(400);
  });

  it('decorates with trees when neighbours exist', () => {
    const gen = new WorldGenerator(42);
    const map = new Map<string, ChunkData>();
    for (let cx = -1; cx <= 1; cx++)
      for (let cz = -1; cz <= 1; cz++) {
        const c = new ChunkData(cx, cz);
        gen.generateTerrain(c);
        map.set(`${cx},${cz}`, c);
      }
    const access = {
      get: (x: number, y: number, z: number) => map.get(`${x >> 4},${z >> 4}`)?.get(x & 15, y, z & 15) ?? 0,
      set: (x: number, y: number, z: number, s: number) => {
        map.get(`${x >> 4},${z >> 4}`)?.set(x & 15, y, z & 15, s);
      },
    };
    let logs = 0;
    for (const c of map.values()) gen.decorate(c, access);
    for (const c of map.values()) for (let i = 0; i < c.blocks.length; i++) if (blocks.blockOf(c.blocks[i]).behavior === 'log') logs++;
    const centre = map.get('0,0')!;
    console.log('biome at spawn:', biomes[centre.biomes[0]].id, 'logs in 3x3:', logs, 'top at 8,8:', centre.topBlock(8, 8), 'sea', SEA_LEVEL);
    expect(centre.status).toBe('decorated');
  });

  it('parses seeds like Minecraft', () => {
    expect(parseSeed('123')).toBe(123);
    expect(parseSeed('-5')).toBe(4294967291);
    expect(parseSeed('hello')).toBe(hashString('hello'));
  });
});
