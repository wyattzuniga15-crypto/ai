/**
 * The structures the generator did not place before: the nether's bone fossils, the ruined portals
 * of the ocean and the nether, and the trail ruins buried under the taiga.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { blocks } from '../src/blocks/registry.ts';
import { buildStructureSets, pickSetup, stampStructure, type PoolEntry, type StructureIndexEntry, type StructurePlacement, type TemplateJson } from '../src/world/gen/structures.ts';
import { Rng } from '../src/core/rng.ts';
import type { BlockAccess } from '../src/world/gen/features.ts';

const hasTemplates = fs.existsSync('public/structures/index.json');
const load = () => {
  const index = JSON.parse(fs.readFileSync('public/structures/index.json', 'utf8')) as StructureIndexEntry[];
  const templates: Record<string, TemplateJson> = {};
  const pools: Record<string, Record<string, PoolEntry[]>> = {};
  for (const e of index) {
    if (!e.pieces.length) continue;
    const bundle = JSON.parse(fs.readFileSync(`public/structures/${e.name}.json`, 'utf8')) as { pieces: Record<string, TemplateJson>; pools?: Record<string, PoolEntry[]> };
    Object.assign(templates, bundle.pieces);
    if (bundle.pools) pools[e.name] = bundle.pools;
  }
  return buildStructureSets(index, templates, pools);
};

/** A world that just remembers what was written into it. */
const pocket = (): BlockAccess & { cells: Map<string, number> } => {
  const cells = new Map<string, number>();
  return {
    cells,
    get: (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? 0,
    set: (x: number, y: number, z: number, s: number) => { cells.set(`${x},${y},${z}`, s); },
  } as BlockAccess & { cells: Map<string, number> };
};

const idsIn = (world: { cells: Map<string, number> }): Record<string, number> => {
  const out: Record<string, number> = {};
  for (const s of world.cells.values()) {
    const id = blocks.idOf(s);
    out[id] = (out[id] ?? 0) + 1;
  }
  return out;
};

describe.runIf(hasTemplates)('the last of the structures', () => {
  it('spreads nether fossils the way Mojang does: one every other chunk in the soul sand valleys', () => {
    const set = load().find((s) => s.name === 'nether_fossil')!;
    expect(set).toBeDefined();
    expect(set.spacing).toBe(2);
    expect(set.separation).toBe(1);
    expect(set.biomes).toEqual(['soul_sand_valley']);
    expect(set.pieces).toHaveLength(14);
    // every one of them is a skeleton of bone blocks and nothing else
    for (const key of set.pieces) {
      const t = set.byKey.get(key)!;
      const ids = new Set([...t.states].map((s) => blocks.idOf(s)));
      expect([...ids].filter((i) => i !== 'air'), key).toEqual(['bone_block']);
    }
  });

  it('carries all seven ruined portals, each with the setups its own file names', () => {
    const set = load().find((s) => s.name === 'ruined_portal')!;
    expect(set.variants?.map((v) => v.start)).toEqual(['standard', 'desert', 'jungle', 'mountain', 'swamp', 'ocean', 'nether']);
    // the two that were missing, with the placements that made them missing
    expect(set.setups!.ocean).toEqual([{ placement: 'on_ocean_floor', mossiness: 0.8, blackstone: false, airPocket: 0, cold: true, overgrown: false, vines: false, weight: 1 }]);
    expect(set.setups!.nether).toEqual([{ placement: 'in_nether', mossiness: 0, blackstone: true, airPocket: 0.5, cold: false, overgrown: false, vines: false, weight: 1 }]);
    // and the standard one still has both of vanilla's, evenly weighted
    expect(set.setups!.standard.map((s) => s.placement)).toEqual(['underground', 'on_land_surface']);
    expect(set.setups!.standard.every((s) => s.weight === 0.5)).toBe(true);
    // the nether's portals stand in nether biomes and nowhere else
    expect(set.variants!.find((v) => v.start === 'nether')!.biomes).toEqual(['basalt_deltas', 'crimson_forest', 'nether_wastes', 'soul_sand_valley', 'warped_forest']);
  });

  it('draws a setup by weight, and never off the end of the list', () => {
    const set = load().find((s) => s.name === 'ruined_portal')!;
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) seen.add(pickSetup(set, 'standard', new Rng(i))!.placement);
    expect([...seen].sort()).toEqual(['on_land_surface', 'underground']);
    expect(pickSetup(set, 'nether', new Rng(1))!.blackstone).toBe(true);
    expect(pickSetup(set, 'not_a_variant', new Rng(1))).toBeNull();
  });

  it("builds the nether's portal out of blackstone and the ocean's out of moss", () => {
    const set = load().find((s) => s.name === 'ruined_portal')!;
    const template = set.byKey.get(set.pieces.find((p) => p.includes('portal_1'))!)!;
    const base: StructurePlacement = { set, template, x: 0, y: 0, z: 0, rotation: 0, integrity: 1, decaySeed: 7, placement: 'surface' };

    const nether = pocket();
    stampStructure(nether, { ...base, blackstone: true });
    const netherIds = idsIn(nether);
    expect(netherIds.blackstone).toBeGreaterThan(0);
    // not one stone brick survives the swap
    for (const id of ['stone_bricks', 'cracked_stone_bricks', 'mossy_stone_bricks', 'stone_brick_slab', 'stone_brick_stairs']) {
      expect(netherIds[id], id).toBeUndefined();
    }
    expect(netherIds.obsidian).toBeGreaterThan(0); // the frame itself is untouched

    const ocean = pocket();
    stampStructure(ocean, { ...base, mossiness: 0.8 });
    const oceanIds = idsIn(ocean);
    const plain = pocket();
    stampStructure(plain, base);
    const plainIds = idsIn(plain);
    expect(oceanIds.mossy_stone_bricks ?? 0).toBeGreaterThan(plainIds.mossy_stone_bricks ?? 0);
    expect(oceanIds.stone_bricks ?? 0).toBeLessThan(plainIds.stone_bricks);
    expect(oceanIds.blackstone).toBeUndefined();
  });

  it('splits the shipwrecks: one settles on the sea floor, the other runs aground', () => {
    const set = load().find((s) => s.name === 'shipwreck')!;
    expect(set.placement).toBe('shipwreck');
    const sunken = set.variants!.find((v) => v.start === 'sunken')!;
    const beached = set.variants!.find((v) => v.start === 'beached')!;
    expect(beached.biomes).toEqual(['beach', 'snowy_beach']);
    expect(sunken.biomes).toContain('ocean');
    expect(sunken.biomes).not.toContain('beach');
  });

  it('buries the trail ruins fifteen blocks under whatever ground they start on', () => {
    const set = load().find((s) => s.name === 'trail_ruins')!;
    expect(set.placement).toBe('jigsaw');
    expect(set.spacing).toBe(34);
    expect(set.startY).toBe(-15);
    expect(set.startYRelative).toBe(true);
    expect(set.maxDepth).toBe(7);
    expect(set.biomes).toContain('taiga');
    expect(set.biomes).toContain('jungle');
    expect(set.pieces.length).toBeGreaterThan(50);
  });

  it('runs vanilla\'s dig over a trail ruins piece: six suspicious gravels and no more', () => {
    const set = load().find((s) => s.name === 'trail_ruins')!;
    const key = set.pieces.find((p) => p.startsWith('trail_ruins_roads'))!;
    const template = set.byKey.get(key)!;
    const base: StructurePlacement = { set, template, x: 0, y: 0, z: 0, rotation: 0, integrity: 1, decaySeed: 11, placement: 'buried' };
    const plain = pocket();
    stampStructure(plain, base);
    const dug = pocket();
    stampStructure(dug, { ...base, processor: 'trail_ruins' });
    const before = idsIn(plain);
    const after = idsIn(dug);
    expect(before.suspicious_gravel).toBeUndefined();
    expect(after.suspicious_gravel).toBeLessThanOrEqual(6);
    expect(after.suspicious_gravel).toBeGreaterThan(0);
    // a fifth of the rest of the gravel weathers to dirt and a tenth more to coarse dirt
    expect(after.gravel).toBeLessThan(before.gravel);
    expect((after.dirt ?? 0) + (after.coarse_dirt ?? 0)).toBeGreaterThan(0);
    // and the six are the same six however the piece is clipped
    const half = pocket();
    stampStructure(half, { ...base, processor: 'trail_ruins' }, { clip: { x0: 0, x1: 3, z0: 0, z1: 15 } });
    for (const [at, state] of half.cells) {
      if (blocks.idOf(state) !== 'suspicious_gravel') continue;
      expect(blocks.idOf(dug.cells.get(at) ?? 0), at).toBe('suspicious_gravel');
    }
  });
});
