import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { blocks } from '../src/blocks/registry.ts';
import { buildStructureSets, parseState, rotate, rotateState, stampStructure, structureStart, type StructureIndexEntry, type TemplateJson } from '../src/world/gen/structures.ts';

const hasTemplates = fs.existsSync('public/structures/index.json');
const load = () => {
  const index = JSON.parse(fs.readFileSync('public/structures/index.json', 'utf8')) as StructureIndexEntry[];
  const templates: Record<string, TemplateJson> = {};
  for (const e of index) for (const p of e.pieces) templates[p] = JSON.parse(fs.readFileSync(`public/structures/${p}.json`, 'utf8')) as TemplateJson;
  return { index, templates };
};

describe('structure templates', () => {
  it('parses vanilla state strings', () => {
    expect(parseState('stone')).toBe(blocks.defaultState('stone'));
    expect(blocks.idOf(parseState('oak_log[axis=x]'))).toBe('oak_log');
    expect(blocks.prop(parseState('oak_log[axis=x]'), 'axis')).toBe('x');
    expect(parseState('some_block_we_do_not_have')).toBe(0);
  });

  it('rotates positions a quarter turn at a time', () => {
    // a 3x5 footprint: the corner walks around the piece
    expect(rotate(0, 0, 3, 5, 0)).toEqual([0, 0]);
    expect(rotate(0, 0, 3, 5, 1)).toEqual([4, 0]);
    expect(rotate(0, 0, 3, 5, 2)).toEqual([2, 4]);
    expect(rotate(0, 0, 3, 5, 3)).toEqual([0, 2]);
  });

  it('turns facing and axis with the piece', () => {
    const north = blocks.stateWith('oak_stairs', { facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' });
    expect(blocks.prop(rotateState(north, 1), 'facing')).toBe('east');
    expect(blocks.prop(rotateState(north, 2), 'facing')).toBe('south');
    expect(blocks.prop(rotateState(north, 3), 'facing')).toBe('west');
    expect(rotateState(north, 0)).toBe(north);
    const logX = blocks.stateWith('oak_log', { axis: 'x' });
    expect(blocks.prop(rotateState(logX, 1), 'axis')).toBe('z');
    expect(blocks.prop(rotateState(logX, 2), 'axis')).toBe('x'); // half turns keep the axis
  });

  it('spreads starts one per region, inside the free part of it', () => {
    const set = { name: 't', placement: 'surface', spacing: 32, separation: 8, salt: 14357618, pieces: [], biomes: [], templates: [], biomeSet: new Set<string>() };
    const seen = new Set<string>();
    for (let rx = -4; rx <= 4; rx++)
      for (let rz = -4; rz <= 4; rz++) {
        const s = structureStart(1234, set, rx, rz);
        expect(s.cx).toBeGreaterThanOrEqual(rx * 32);
        expect(s.cx).toBeLessThan(rx * 32 + 24);
        expect(s.cz).toBeGreaterThanOrEqual(rz * 32);
        expect(s.cz).toBeLessThan(rz * 32 + 24);
        seen.add(`${s.cx},${s.cz}`);
      }
    expect(seen.size).toBe(81); // one start per region, none shared
    // the same seed and region always give the same start
    expect(structureStart(1234, set, 2, -3)).toEqual(structureStart(1234, set, 2, -3));
    expect(structureStart(99, set, 2, -3)).not.toEqual(structureStart(1234, set, 2, -3));
  });

  it.runIf(hasTemplates)('loads the vanilla templates and stamps one into a world', () => {
    const { index, templates } = load();
    const sets = buildStructureSets(index, templates);
    expect(sets.map((s) => s.name).sort()).toEqual(['igloo', 'pillager_outpost', 'ruined_portal', 'shipwreck']);
    const igloo = sets.find((s) => s.name === 'igloo')!;
    expect(igloo.biomes).toEqual(['snowy_plains', 'snowy_slopes', 'snowy_taiga']);
    expect(igloo.spacing).toBe(32);
    expect(igloo.templates[0].size).toEqual([7, 5, 8]);

    const world = new Map<string, number>();
    const access = {
      get: (x: number, y: number, z: number) => world.get(`${x},${y},${z}`) ?? 0,
      set: (x: number, y: number, z: number, s: number) => { world.set(`${x},${y},${z}`, s); },
    };
    const written = new Set<string>();
    const placed = stampStructure(access, {
      set: igloo, template: igloo.templates[0], x: 100, y: 64, z: -50, rotation: 1, integrity: 1,
      rng: { next: () => 0.5 } as never,
    }, written);
    expect(placed).toBeGreaterThan(80);
    const ids = new Set([...world.values()].filter(Boolean).map((s) => blocks.idOf(s)));
    expect(ids.has('snow_block')).toBe(true);
    expect(ids.has('red_bed')).toBe(true);
    expect(ids.has('crafting_table')).toBe(true);
    // the piece is 7x5x8, so a quarter turn puts it in an 8x5x7 box
    const xs = [...world.keys()].map((k) => Number(k.split(',')[0]));
    const zs = [...world.keys()].map((k) => Number(k.split(',')[2]));
    expect(Math.max(...xs) - Math.min(...xs)).toBe(7);
    expect(Math.max(...zs) - Math.min(...zs)).toBe(6);
  });
});
