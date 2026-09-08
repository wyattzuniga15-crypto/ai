/**
 * Archaeology: the finds buried in a structure's sand and gravel, and the brush that turns them up.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { blocks } from '../src/blocks/registry.ts';
import { buildStructureSets, stampStructure, type PoolEntry, type StructureIndexEntry, type StructurePlacement, type TemplateJson } from '../src/world/gen/structures.ts';
import { archaeologyLoot } from '../src/items/loot.ts';
import { createBlockEntity } from '../src/blocks/blockEntity.ts';
import { items } from '../src/items/registry.ts';
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

const pocket = () => {
  const cells = new Map<string, number>();
  const world = {
    cells,
    get: (x: number, y: number, z: number) => cells.get(`${x},${y},${z}`) ?? 0,
    set: (x: number, y: number, z: number, s: number) => { cells.set(`${x},${y},${z}`, s); },
  };
  return world as BlockAccess & { cells: Map<string, number> };
};

describe('the six archaeology tables', () => {
  it('all roll something, and every item in them is real', () => {
    for (const table of ['desert_pyramid', 'desert_well', 'ocean_ruin_cold', 'ocean_ruin_warm', 'trail_ruins_common', 'trail_ruins_rare']) {
      const seen = new Set<string>();
      for (let i = 0; i < 200; i++) {
        const rolled = archaeologyLoot(table, () => (i * 0.618) % 1);
        expect(rolled.length, table).toBe(1);
        seen.add(rolled[0].id);
      }
      for (const id of seen) expect(items.byId.has(id), `${table}: ${id}`).toBe(true);
      expect(seen.size, table).toBeGreaterThan(1);
    }
    expect(archaeologyLoot('archaeology/desert_pyramid')).toHaveLength(1);
    expect(archaeologyLoot('not_a_table')).toEqual([]);
  });

  it('gives a suspicious block somewhere to keep its find', () => {
    for (const id of ['suspicious_sand', 'suspicious_gravel']) {
      const e = createBlockEntity(id);
      expect(e, id).toEqual({ type: 'brushable', item: null, brushes: 0, lastBrush: 0 });
      // and mining one drops nothing at all: brush it or lose it, which is vanilla's whole point
      expect(blocks.get(id).drops).toEqual([]);
      expect(blocks.get(id).states.map((s) => s.name)).toEqual(['dusted']);
    }
  });
});

describe.runIf(hasTemplates)('what a structure buries', () => {
  it('hides two finds in an ocean ruin, sand in the warm one and gravel in the cold', () => {
    const sets = load();
    for (const [name, block, table] of [['ocean_ruin_warm', 'suspicious_sand', 'archaeology/ocean_ruin_warm'], ['ocean_ruin_cold', 'suspicious_gravel', 'archaeology/ocean_ruin_cold']] as const) {
      const set = sets.find((s) => s.name === name)!;
      // a big piece, which is where the sand and gravel are
      const key = set.pieces.find((p) => p.includes('big_'))!;
      const world = pocket();
      const buried: { at: string; table: string }[] = [];
      const p: StructurePlacement = { set, template: set.byKey.get(key)!, x: 0, y: 0, z: 0, rotation: 0, integrity: 1, decaySeed: 5, placement: 'ocean_floor', processor: name };
      stampStructure(world, p, { onLoot: (x, y, z, t) => buried.push({ at: `${x},${y},${z}`, table: t }) });
      const found = [...world.cells.entries()].filter(([, s]) => blocks.idOf(s) === block);
      expect(found.length, name).toBeLessThanOrEqual(2);
      expect(found.length, name).toBeGreaterThan(0);
      const dig = buried.filter((b) => b.table === table);
      expect(dig.length, name).toBe(found.length);
      // every marked position really is a suspicious block
      for (const b of dig) expect(blocks.idOf(world.cells.get(b.at)!), b.at).toBe(block);
    }
  });

  it('marks a trail ruin\'s finds with the common table, and the rare one on the buildings', () => {
    const sets = load();
    const set = sets.find((s) => s.name === 'trail_ruins')!;
    const tally = (key: string) => {
      const world = pocket();
      const buried: string[] = [];
      stampStructure(world, { set, template: set.byKey.get(key)!, x: 0, y: 0, z: 0, rotation: 0, integrity: 1, decaySeed: 3, placement: 'buried', processor: 'trail_ruins' }, { onLoot: (_x, _y, _z, t) => buried.push(t) });
      return buried;
    };
    const road = tally(set.pieces.find((p) => p.startsWith('trail_ruins_roads'))!);
    expect(road.length).toBeLessThanOrEqual(2);
    expect(new Set(road)).toEqual(new Set(['archaeology/trail_ruins_common']));
    const house = tally(set.pieces.find((p) => p.startsWith('trail_ruins_buildings'))!);
    expect(house.length).toBeLessThanOrEqual(9);
    expect(house.filter((t) => t.endsWith('common')).length).toBeLessThanOrEqual(6);
    expect(house.filter((t) => t.endsWith('rare')).length).toBeLessThanOrEqual(3);
  });
});
