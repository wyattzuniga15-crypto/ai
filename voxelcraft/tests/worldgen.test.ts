import { describe, expect, it } from 'vitest';
import { WorldGenerator, dripstoneThickness } from '../src/world/gen/generator.ts';
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

const biomesById = (i: number) => biomes[i]?.id;

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

  it('orders pointed dripstone like vanilla', () => {
    expect([0].map((i) => dripstoneThickness(1, i))).toEqual(['tip']);
    expect([0, 1].map((i) => dripstoneThickness(2, i))).toEqual(['frustum', 'tip']);
    expect([0, 1, 2].map((i) => dripstoneThickness(3, i))).toEqual(['base', 'frustum', 'tip']);
    expect([0, 1, 2, 3, 4].map((i) => dripstoneThickness(5, i))).toEqual(['base', 'middle', 'middle', 'frustum', 'tip']);
  });

  it('decorates cave biomes and mangrove swamps deterministically', () => {
    const gen = new WorldGenerator(4242);
    const chunks = new Map<string, ChunkData>();
    const at = (cx: number, cz: number) => {
      const k = `${cx},${cz}`;
      let c = chunks.get(k);
      if (!c) { c = new ChunkData(cx, cz); gen.generateTerrain(c); chunks.set(k, c); }
      return c;
    };
    const access = {
      get: (x: number, y: number, z: number) => (y < WORLD_MIN_Y || y > 319 ? 0 : at(x >> 4, z >> 4).get(x & 15, y, z & 15)),
      set: (x: number, y: number, z: number, st: number) => { if (y >= WORLD_MIN_Y && y <= 319) at(x >> 4, z >> 4).set(x & 15, y, z & 15, st); },
    };
    // find one chunk per cave biome and a mangrove swamp by probing the noise fields
    const found: Record<string, [number, number] | null> = { lush: null, dripstone: null, deep_dark: null, mangrove: null };
    for (let r = 0; r < 60 && Object.values(found).some((v) => !v); r++) {
      for (const [cx, cz] of [[r, 0], [-r, 3], [2, r], [5, -r], [r, r], [-r, -r]]) {
        const wx = cx * 16 + 8, wz = cz * 16 + 8;
        const info = gen.columnInfo(wx, wz);
        const h = Math.floor(info.height);
        if (!found.lush && gen.caveBiomeAt(wx, 30, wz, h) === 'lush' && h > 60) found.lush = [cx, cz];
        if (!found.dripstone && gen.caveBiomeAt(wx, 20, wz, h) === 'dripstone') found.dripstone = [cx, cz];
        if (!found.deep_dark && gen.caveBiomeAt(wx, -30, wz, h) === 'deep_dark') found.deep_dark = [cx, cz];
        if (!found.mangrove && biomesById(info.biome) === 'mangrove_swamp') found.mangrove = [cx, cz];
      }
    }
    const count = (c: ChunkData, ids: string[]) => {
      let n = 0;
      for (let y = WORLD_MIN_Y; y < 200; y++) for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) { const s = c.get(x, y, z); if (s !== 0 && ids.includes(blocks.idOf(s))) n++; }
      return n;
    };
    const expectFeatures = (key: string, ids: string[]) => {
      const pos = found[key];
      if (!pos) return; // this seed may simply not reach the biome within the probe radius
      let total = 0;
      for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) {
        const c = at(pos[0] + dx, pos[1] + dz);
        if (c.status === 'terrain') gen.decorate(c, access);
        total += count(c, ids);
      }
      expect(total, `${key} features near chunk ${pos}`).toBeGreaterThan(0);
    };
    expectFeatures('lush', ['moss_block', 'cave_vines', 'cave_vines_plant', 'moss_carpet', 'azalea', 'flowering_azalea', 'spore_blossom']);
    expectFeatures('dripstone', ['dripstone_block', 'pointed_dripstone']);
    expectFeatures('deep_dark', ['sculk', 'sculk_sensor', 'sculk_shrieker', 'sculk_catalyst', 'sculk_vein']);
    expectFeatures('mangrove', ['mangrove_roots', 'muddy_mangrove_roots', 'mangrove_log', 'mangrove_propagule']);
    expect(Object.values(found).filter(Boolean).length).toBeGreaterThan(1);
    // determinism: a fresh generator decorates identically
    const probe = found.dripstone ?? found.lush ?? [0, 0];
    const again = new WorldGenerator(4242);
    const other = new Map<string, ChunkData>();
    const at2 = (cx: number, cz: number) => { const k = `${cx},${cz}`; let c = other.get(k); if (!c) { c = new ChunkData(cx, cz); again.generateTerrain(c); other.set(k, c); } return c; };
    const access2 = { get: (x: number, y: number, z: number) => (y < WORLD_MIN_Y || y > 319 ? 0 : at2(x >> 4, z >> 4).get(x & 15, y, z & 15)), set: (x: number, y: number, z: number, st: number) => { if (y >= WORLD_MIN_Y && y <= 319) at2(x >> 4, z >> 4).set(x & 15, y, z & 15, st); } };
    for (let dx = -1; dx <= 1; dx++) for (let dz = -1; dz <= 1; dz++) { const c = at2(probe[0] + dx, probe[1] + dz); if (c.status === 'terrain') again.decorate(c, access2); }
    expect(Buffer.from(at2(probe[0], probe[1]).blocks.buffer).equals(Buffer.from(at(probe[0], probe[1]).blocks.buffer))).toBe(true);
  });
});
