import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { blocks } from '../src/blocks/registry.ts';
import { assembleJigsaw, buildStructureSets, jigsawFront, parseState, pickVariant, rotate, rotateState, stampStructure, structureStart, type PoolEntry, type StructureIndexEntry, type TemplateJson } from '../src/world/gen/structures.ts';
import { Rng } from '../src/core/rng.ts';
import { WorldGenerator } from '../src/world/gen/generator.ts';
import { ChunkData } from '../src/world/chunk.ts';

const hasTemplates = fs.existsSync('public/structures/index.json');
const load = () => {
  const index = JSON.parse(fs.readFileSync('public/structures/index.json', 'utf8')) as StructureIndexEntry[];
  const templates: Record<string, TemplateJson> = {};
  const pools: Record<string, Record<string, PoolEntry[]>> = {};
  for (const e of index) {
    if (!e.pieces.length) continue; // mineshafts are built in code, so they have no bundle
    const bundle = JSON.parse(fs.readFileSync(`public/structures/${e.name}.json`, 'utf8')) as { pieces: Record<string, TemplateJson>; pools?: Record<string, PoolEntry[]> };
    Object.assign(templates, bundle.pieces);
    if (bundle.pools) pools[e.name] = bundle.pools;
  }
  return { index, templates, pools };
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
    const set = { name: 't', placement: 'surface' as const, spacing: 32, separation: 8, salt: 14357618, pieces: [], biomes: [], templates: [], mainTemplates: [], reach: 2, byKey: new Map(), pools: {}, biomeSet: new Set<string>(), variantBiomes: [] };
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
    const { index, templates, pools } = load();
    const sets = buildStructureSets(index, templates, pools);
    expect(sets.map((s) => s.name).sort()).toEqual(['igloo', 'mineshaft', 'pillager_outpost', 'ruined_portal', 'shipwreck', 'village']);
    const igloo = sets.find((s) => s.name === 'igloo')!;
    expect(igloo.biomes).toEqual(['snowy_plains', 'snowy_slopes', 'snowy_taiga']);
    expect(igloo.spacing).toBe(32);
    expect(igloo.mainTemplates[0].size).toEqual([7, 5, 8]);

    const world = new Map<string, number>();
    const access = {
      get: (x: number, y: number, z: number) => world.get(`${x},${y},${z}`) ?? 0,
      set: (x: number, y: number, z: number, s: number) => { world.set(`${x},${y},${z}`, s); },
    };
    const written = new Set<string>();
    const placed = stampStructure(access, {
      set: igloo, template: igloo.mainTemplates[0], x: 100, y: 64, z: -50, rotation: 1, integrity: 1, decaySeed: 1,
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

  it.runIf(hasTemplates)('keeps the igloo basement out of the pieces a start is picked from', () => {
    const { index, templates, pools } = load();
    const igloo = buildStructureSets(index, templates, pools).find((s) => s.name === 'igloo')!;
    expect(igloo.templates.map((t) => t.key).sort()).toEqual(['igloo_bottom', 'igloo_middle', 'igloo_top']);
    expect(igloo.mainTemplates.map((t) => t.key)).toEqual(['igloo_top']);
    // the shaft is three ladders tall, which is what the generator stacks the basement in
    expect(igloo.byKey.get('igloo_middle')!.size).toEqual([3, 3, 3]);
    const shipwreck = buildStructureSets(index, templates, pools).find((s) => s.name === 'shipwreck')!;
    expect(shipwreck.mainTemplates.length).toBe(shipwreck.templates.length); // no extras: any hull may be the wreck
  });

  it.runIf(hasTemplates)('reads chests marked by a data block as well as ones tagged with a table', () => {
    const { index, templates, pools } = load();
    const sets = buildStructureSets(index, templates, pools);
    // vanilla's shipwrecks and igloos mark their chests with a structure block one above the chest
    const bottom = sets.find((s) => s.name === 'igloo')!.byKey.get('igloo_bottom')!;
    expect(bottom.loot).toEqual([{ pos: [1, 1, 6], table: 'chests/igloo_chest' }]);
    const shipwreck = sets.find((s) => s.name === 'shipwreck')!;
    const withMast = shipwreck.byKey.get('shipwreck_with_mast')!;
    expect(withMast.loot.map((l) => l.table).sort()).toEqual(['chests/shipwreck_map', 'chests/shipwreck_supply', 'chests/shipwreck_treasure']);
    // every marked spot must land on the chest it fills, in every piece of every structure
    for (const set of sets)
      for (const template of set.templates)
        for (const spot of template.loot) {
          const i = template.blocks.findIndex((_, n) => n % 4 === 0
            && template.blocks[n] === spot.pos[0] && template.blocks[n + 1] === spot.pos[1] && template.blocks[n + 2] === spot.pos[2]);
          expect(i, `${template.key} ${spot.table}`).toBeGreaterThanOrEqual(0);
          const id = blocks.idOf(template.states[template.blocks[i + 3]]);
          expect(id, `${template.key} ${spot.table}`).toMatch(/chest|barrel/);
        }
    // and the loot reported by a stamp comes back rotated with the piece
    const reported: string[] = [];
    const world = new Map<string, number>();
    stampStructure(
      { get: (x, y, z) => world.get(`${x},${y},${z}`) ?? 0, set: (x, y, z, st) => { world.set(`${x},${y},${z}`, st); } },
      { set: shipwreck, template: withMast, x: 0, y: 40, z: 0, rotation: 1, integrity: 1, decaySeed: 1 },
      undefined,
      (x, y, z, table) => reported.push(`${table}@${x},${y},${z}`),
    );
    expect(reported.length).toBe(3);
    for (const line of reported) {
      const [x, y, z] = line.split('@')[1].split(',').map(Number);
      expect(blocks.idOf(world.get(`${x},${y},${z}`) ?? 0)).toBe('chest');
    }
  });
});

describe('jigsaw villages', () => {
  it.runIf(hasTemplates)('assembles a village of streets and houses around a town centre', () => {
    const { index, templates, pools } = load();
    const village = buildStructureSets(index, templates, pools).find((s) => s.name === 'village')!;
    expect(village.variants?.length).toBe(5); // one entry per village type, each with its own biomes
    expect(village.variants?.map((v) => v.start.split('/')[1]).sort()).toEqual(['desert', 'plains', 'savanna', 'snowy', 'taiga']);
    expect(village.templates.length).toBeGreaterThan(300);

    const rng = new Rng(12345);
    const pieces = assembleJigsaw(village, 'village/plains/town_centers', 0, 70, 0, rng);
    expect(pieces.length).toBeGreaterThan(10);
    expect(pieces[0].template.key).toContain('town_centers');
    const kinds = new Set(pieces.map((p) => p.template.key.split('_')[2]));
    expect(kinds.has('streets')).toBe(true);
    expect(kinds.has('houses')).toBe(true);
    // pieces stay near the centre and only ever share space with the piece they hang off
    for (const p of pieces) {
      expect(Math.abs(p.x)).toBeLessThan(140);
      expect(Math.abs(p.z)).toBeLessThan(140);
    }
    // the same seed rebuilds the same village
    const again = assembleJigsaw(village, 'village/plains/town_centers', 0, 70, 0, new Rng(12345));
    expect(again.map((p) => `${p.template.key}@${p.x},${p.z}`)).toEqual(pieces.map((p) => `${p.template.key}@${p.x},${p.z}`));
  });

  it.runIf(hasTemplates)('picks the village type the biome calls for', () => {
    const { index, templates, pools } = load();
    const village = buildStructureSets(index, templates, pools).find((s) => s.name === 'village')!;
    const pick = (biome: string, seed: number) => pickVariant(village, biome, new Rng(seed))?.start ?? null;
    // whatever the roll, only the type that belongs in the biome can come out of it
    for (let seed = 0; seed < 40; seed++) {
      expect(pick('desert', seed)).toBe('village/desert/town_centers');
      expect(pick('snowy_plains', seed)).toBe('village/snowy/town_centers');
      expect(pick('plains', seed)).toBe('village/plains/town_centers');
      expect(pick('meadow', seed)).toBe('village/plains/town_centers'); // meadows get plains villages
      expect(pick('jungle', seed)).toBeNull(); // no village type belongs in a jungle
    }
  });

  it('reads a jigsaw block\'s front from its orientation', () => {
    expect(jigsawFront('up_north')).toBe('up');
    expect(jigsawFront('east_up')).toBe('east');
    expect(jigsawFront('north_up')).toBe('north');
  });
});

describe('clipped stamping', () => {
  const stampInto = (world: Map<string, number>, p: Parameters<typeof stampStructure>[1], clip?: { x0: number; x1: number; z0: number; z1: number }) =>
    stampStructure(
      { get: (x, y, z) => world.get(`${x},${y},${z}`) ?? 0, set: (x, y, z, st) => { world.set(`${x},${y},${z}`, st); } },
      p, undefined, undefined, clip,
    );

  it.runIf(hasTemplates)('writes the same world one chunk at a time as it does in one go', () => {
    const { index, templates, pools } = load();
    const sets = buildStructureSets(index, templates, pools);
    const shipwreck = sets.find((s) => s.name === 'shipwreck')!;
    // a 28-block hull spans three chunks, so the tiling has real seams to get wrong
    const placement = { set: shipwreck, template: shipwreck.byKey.get('shipwreck_with_mast')!, x: 10, y: 40, z: -6, rotation: 3, integrity: 1, decaySeed: 99 };
    const whole = new Map<string, number>();
    const written = stampInto(whole, placement);
    expect(written).toBeGreaterThan(400);

    const tiled = new Map<string, number>();
    let sum = 0;
    for (let cx = -1; cx <= 2; cx++)
      for (let cz = -2; cz <= 1; cz++) sum += stampInto(tiled, placement, { x0: cx * 16, x1: cx * 16 + 15, z0: cz * 16, z1: cz * 16 + 15 });
    expect(sum).toBe(written);
    expect([...tiled].sort()).toEqual([...whole].sort());
  });

  it.runIf(hasTemplates)('crumbles a ruined portal the same way however it is clipped', () => {
    const { index, templates, pools } = load();
    const portals = buildStructureSets(index, templates, pools).find((s) => s.name === 'ruined_portal')!;
    const placement = { set: portals, template: portals.templates[0], x: -3, y: 64, z: -3, rotation: 0, integrity: 0.6, decaySeed: 7 };
    const whole = new Map<string, number>();
    const kept = stampInto(whole, placement);
    // decay is a hash of the position, so the four chunks the portal touches agree on every block
    const tiled = new Map<string, number>();
    let sum = 0;
    for (let cx = -1; cx <= 1; cx++)
      for (let cz = -1; cz <= 1; cz++) sum += stampInto(tiled, placement, { x0: cx * 16, x1: cx * 16 + 15, z0: cz * 16, z1: cz * 16 + 15 });
    expect(sum).toBe(kept);
    expect([...tiled].sort()).toEqual([...whole].sort());
    // and the decay actually removed something
    const solid = stampInto(new Map(), { ...placement, integrity: 1 });
    expect(kept).toBeLessThan(solid);
  });
});

describe('igloo basements', () => {
  it.runIf(hasTemplates)('digs a ladder shaft down to the laboratory and marks its chest', () => {
    const { index, templates, pools } = load();
    const gen = new WorldGenerator(4242);
    // only igloos, so the chunk generates quickly and nothing else can claim the start
    gen.structures = buildStructureSets(index, templates, pools).filter((s) => s.name === 'igloo');
    const chunks = new Map<string, ChunkData>();
    const access = {
      get: (x: number, y: number, z: number) => chunks.get(`${x >> 4},${z >> 4}`)?.get(x & 15, y, z & 15) ?? 0,
      set: (x: number, y: number, z: number, st: number) => { chunks.get(`${x >> 4},${z >> 4}`)?.set(x & 15, y, z & 15, st); },
    };
    const [cx, cz] = [264, -140]; // a snowy plains igloo on this seed, basement and all
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = new ChunkData(cx + dx, cz + dz);
        gen.generateTerrain(c);
        chunks.set(`${cx + dx},${cz + dz}`, c);
      }
    gen.decorate(chunks.get(`${cx},${cz}`)!, access);
    const igloo = gen.lastStructure!;
    expect(igloo.name).toBe('igloo');

    // the basement's chest is reported for filling, and there is a chest where it says
    expect(gen.structureSpots).toEqual([{ x: igloo.x + 1, y: igloo.y - 14, z: igloo.z + 4, table: 'chests/igloo_chest' }]);
    const spot = gen.structureSpots[0];
    expect(blocks.idOf(access.get(spot.x, spot.y, spot.z))).toBe('chest');

    // the shaft runs unbroken from the trapdoor in the floor down to the laboratory
    let door: [number, number] | null = null;
    for (let dx = 0; dx < 8 && !door; dx++)
      for (let dz = 0; dz < 9 && !door; dz++)
        if (blocks.idOf(access.get(igloo.x + dx, igloo.y, igloo.z + dz)) === 'oak_trapdoor') door = [igloo.x + dx, igloo.z + dz];
    expect(door).not.toBeNull();
    let rungs = 0;
    for (let y = igloo.y - 1; y > igloo.y - 40; y--) {
      if (blocks.idOf(access.get(door![0], y, door![1])) !== 'ladder') break;
      rungs++;
    }
    // vanilla stacks four to eleven three-block sections, plus the four rungs inside the laboratory
    expect(rungs).toBeGreaterThanOrEqual(13);
    expect(rungs).toBeLessThanOrEqual(34);
    expect(rungs % 3).toBe(1);

    // and the laboratory itself is furnished
    const room = new Set<string>();
    for (let y = spot.y - 1; y <= spot.y + 4; y++)
      for (let dx = -4; dx < 10; dx++)
        for (let dz = -4; dz < 12; dz++) room.add(blocks.idOf(access.get(spot.x + dx, y, spot.z + dz)));
    expect(room.has('brewing_stand')).toBe(true);
    expect(room.has('water_cauldron')).toBe(true);
    expect(room.has('red_carpet')).toBe(true);
  });
});
