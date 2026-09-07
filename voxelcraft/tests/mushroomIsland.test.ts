/**
 * Mushroom fields and windswept savanna: the last two overworld biomes the generator had colours
 * for but never placed, the huge mushrooms that stand on the island, and the mooshroom that grazes
 * it.
 */
import { describe, expect, it } from 'vitest';
import { WorldGenerator } from '../src/world/gen/generator.ts';
import { placeHugeMushroom, type BlockAccess } from '../src/world/gen/features.ts';
import { ChunkData } from '../src/world/chunk.ts';
import { biomes } from '../src/world/biomes.ts';
import { blocks } from '../src/blocks/registry.ts';
import { Rng } from '../src/core/rng.ts';
import { BREEDING_FOODS, MOB_SPECS, mobStats } from '../src/entities/mobTypes.ts';
import { entityDrops } from '../src/items/loot.ts';

/** A tiny seeded generator, so the loot roll below is the same on every run. */
function mulberry(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a = Math.imul(a ^ (a >>> 15), a | 1);
    a ^= a + Math.imul(a ^ (a >>> 7), a | 61);
    return ((a ^ (a >>> 14)) >>> 0) / 4294967296;
  };
}

/** A flat mycelium floor a feature can be grown on, with everything above it open. */
function platform(): BlockAccess & { counts(match: RegExp): Map<string, number> } {
  const store = new Map<string, number>();
  const mycelium = blocks.defaultState('mycelium');
  return {
    get(x, y, z) {
      if (y < 64) return store.get(`${x},${y},${z}`) ?? mycelium;
      return store.get(`${x},${y},${z}`) ?? blocks.AIR;
    },
    set(x, y, z, s) {
      store.set(`${x},${y},${z}`, s);
    },
    counts(match) {
      const out = new Map<string, number>();
      for (const s of store.values()) {
        const id = blocks.blockOf(s).id;
        if (match.test(id)) out.set(id, (out.get(id) ?? 0) + 1);
      }
      return out;
    },
  };
}

const propsOf = (s: number) => ['up', 'down', 'north', 'south', 'east', 'west'].map((p) => `${p}=${blocks.prop(s, p)}`).join(',');

describe('mushroom fields', () => {
  it('lifts a mushroom island out of the deep ocean', () => {
    const gen = new WorldGenerator(4242);
    // the island this seed grows off the south-west deep ocean
    const info = gen.columnInfo(600, -1100);
    expect(biomes[info.biome].id).toBe('mushroom_fields');
    expect(info.height).toBeGreaterThan(63);
    // and it is an island: the water is back within a couple of hundred blocks
    expect(biomes[gen.columnInfo(600, -1500).biome].category).toBe('ocean');
  });

  it('places windswept savanna where the savanna is eroded', () => {
    const gen = new WorldGenerator(4242);
    expect(biomes[gen.columnInfo(-3960, 120).biome].id).toBe('windswept_savanna');
  });

  it('grows every overworld biome the picker can reach over a wide sample', () => {
    const gen = new WorldGenerator(4242);
    const seen = new Set<string>();
    for (let x = -4000; x <= 4000; x += 40)
      for (let z = -4000; z <= 4000; z += 40) seen.add(biomes[gen.columnInfo(x, z).biome].id);
    expect(seen.has('mushroom_fields')).toBe(true);
    expect(seen.has('windswept_savanna')).toBe(true);
  });

  it('grows a red huge mushroom with a hollow ring under a closed cap', () => {
    const w = platform();
    const rng = new Rng(7);
    expect(placeHugeMushroom(w, rng, 0, 64, 0, true)).toBe(true);
    let height = 0;
    while (blocks.blockOf(w.get(0, 64 + height, 0)).id === 'mushroom_stem') height++;
    expect(height).toBeGreaterThanOrEqual(4);
    // the stem's ends are open, as vanilla leaves them
    expect(blocks.prop(w.get(0, 64, 0), 'up')).toBe('false');
    expect(blocks.prop(w.get(0, 64, 0), 'down')).toBe('false');
    // the rings: only the four sides, never the corners and never the middle
    for (let dy = height - 3; dy < height; dy++) {
      expect(blocks.blockOf(w.get(2, 64 + dy, 2)).id, 'corner').toBe('air');
      expect(blocks.blockOf(w.get(1, 64 + dy, 1)).id, 'inside the ring').toBe('air');
      expect(blocks.blockOf(w.get(2, 64 + dy, 0)).id, 'side').toBe('red_mushroom_block');
      expect(blocks.blockOf(w.get(0, 64 + dy, 2)).id, 'side').toBe('red_mushroom_block');
    }
    // the top is a solid three by three one ring narrower
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) expect(blocks.blockOf(w.get(dx, 64 + height, dz)).id).toBe('red_mushroom_block');
    expect(blocks.blockOf(w.get(2, 64 + height, 0)).id).toBe('air');
    // the skin shows on the faces that point out of the cap; only the two topmost layers are capped
    expect(propsOf(w.get(2, 64 + height - 3, 0))).toBe('up=false,down=false,north=false,south=false,east=true,west=false');
    expect(propsOf(w.get(2, 64 + height - 1, 0))).toBe('up=true,down=false,north=false,south=false,east=true,west=false');
    expect(propsOf(w.get(0, 64 + height, 0))).toBe('up=true,down=false,north=false,south=false,east=false,west=false');
  });

  it('grows a brown huge mushroom as one flat disc', () => {
    const w = platform();
    const rng = new Rng(11);
    expect(placeHugeMushroom(w, rng, 0, 64, 0, false)).toBe(true);
    let height = 0;
    while (blocks.blockOf(w.get(0, 64 + height, 0)).id === 'mushroom_stem') height++;
    const cap = 64 + height;
    // radius three, corners cut: 45 blocks in one layer and nothing above or below it
    let n = 0;
    for (let dx = -4; dx <= 4; dx++)
      for (let dz = -4; dz <= 4; dz++) if (blocks.blockOf(w.get(dx, cap, dz)).id === 'brown_mushroom_block') n++;
    expect(n).toBe(45);
    expect(blocks.blockOf(w.get(3, cap, 3)).id).toBe('air');
    expect(blocks.blockOf(w.get(0, cap - 1, 0)).id).toBe('mushroom_stem');
    expect(w.counts(/mushroom_block/).get('brown_mushroom_block')).toBe(45);
    // the whole disc is a top face, and its rim shows the skin outward
    expect(propsOf(w.get(0, cap, 0))).toBe('up=true,down=false,north=false,south=false,east=false,west=false');
    expect(propsOf(w.get(-3, cap, 0))).toBe('up=true,down=false,north=false,south=false,east=false,west=true');
  });

  it('dots the island with huge mushrooms when it decorates', () => {
    const gen = new WorldGenerator(4242);
    const map = new Map<string, ChunkData>();
    const cx = 600 >> 4, cz = -1100 >> 4;
    for (let dx = -1; dx <= 1; dx++)
      for (let dz = -1; dz <= 1; dz++) {
        const c = new ChunkData(cx + dx, cz + dz);
        gen.generateTerrain(c);
        map.set(`${cx + dx},${cz + dz}`, c);
      }
    const access: BlockAccess = {
      get: (x, y, z) => map.get(`${x >> 4},${z >> 4}`)?.get(x & 15, y, z & 15) ?? 0,
      set: (x, y, z, s) => { map.get(`${x >> 4},${z >> 4}`)?.set(x & 15, y, z & 15, s); },
    };
    for (const c of map.values()) gen.decorate(c, access);
    const counts = new Map<string, number>();
    for (const c of map.values())
      for (const s of c.blocks) {
        const id = blocks.blockOf(s).id;
        if (/mushroom|mycelium/.test(id)) counts.set(id, (counts.get(id) ?? 0) + 1);
      }
    expect(biomes[map.get(`${cx},${cz}`)!.biomes[8 * 16 + 8]].id).toBe('mushroom_fields');
    expect(counts.get('mycelium') ?? 0).toBeGreaterThan(500);
    expect(counts.get('mushroom_stem') ?? 0).toBeGreaterThan(20);
    // vanilla weights red three to one over brown
    expect(counts.get('red_mushroom_block') ?? 0).toBeGreaterThan(counts.get('brown_mushroom_block') ?? 0);
    // and the small mushrooms still grow on the mycelium between them
    expect((counts.get('red_mushroom') ?? 0) + (counts.get('brown_mushroom') ?? 0)).toBeGreaterThan(10);
  });
});

describe('mooshroom', () => {
  it('is a cow in a red skin', () => {
    expect(MOB_SPECS.mooshroom.model.texture).toBe('cow/red_mooshroom.png');
    expect(MOB_SPECS.mooshroom.animation).toBe('quadruped');
    const stats = mobStats('mooshroom')!;
    expect(stats).toMatchObject({ health: 10, disposition: 'passive', width: 0.9, height: 1.4 });
    expect(BREEDING_FOODS.mooshroom).toEqual(['wheat']);
  });

  it('drops what a cow drops', () => {
    let leather = 0;
    let beef = 0;
    for (let i = 0; i < 200; i++)
      for (const s of entityDrops('mooshroom', true, 0, false, mulberry(i))) {
        if (s.id === 'leather') leather += s.count;
        if (s.id === 'beef') beef += s.count;
      }
    expect(leather).toBeGreaterThan(0);
    expect(beef).toBeGreaterThan(200);
  });
});
