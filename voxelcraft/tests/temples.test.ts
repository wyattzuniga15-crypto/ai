import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { buildTemple, TEMPLE_SIZE, type TempleKind } from '../src/world/gen/temples.ts';

const STONE = blocks.defaultState('stone');

/** A world of solid ground, so the pieces that dig into it have something to dig. */
function ground(top = 64) {
  const written = new Map<string, number>();
  return {
    written,
    access: {
      get: (x: number, y: number, z: number) => written.get(`${x},${y},${z}`) ?? (y <= top ? STONE : blocks.AIR),
      set: (x: number, y: number, z: number, s: number) => { written.set(`${x},${y},${z}`, s); },
    },
  };
}

const WIDE = { x0: -400, x1: 400, z0: -400, z1: 400 };

function build(kind: TempleKind, rotation = 0, clip = WIDE, world = ground(), loot?: string[], mobs?: string[]) {
  buildTemple({
    world: world.access, clip, x: 0, y: 64, z: 0, rotation, seed: 4242, kind,
    onLoot: (x, y, z, table) => loot?.push(`${table}@${x},${y},${z}`),
    onEntity: (x, y, z, mob) => mobs?.push(`${mob}@${x},${y},${z}`),
  });
  return world;
}

const counts = (world: ReturnType<typeof ground>) => {
  const out = new Map<string, number>();
  for (const state of world.written.values()) {
    const id = blocks.idOf(state);
    out.set(id, (out.get(id) ?? 0) + 1);
  }
  return out;
};

describe('desert pyramid', () => {
  it('raises a stepped pyramid over a treasure room with four chests and a charge under the plate', () => {
    const loot: string[] = [];
    const world = build('desert_pyramid', 0, WIDE, ground(), loot);
    const c = counts(world);
    expect(c.get('sandstone')).toBeGreaterThan(1000);
    expect(c.get('orange_terracotta')).toBeGreaterThan(0);
    expect(c.get('blue_terracotta')).toBeGreaterThan(0);
    expect(c.get('tnt')).toBe(9); // the three-by-three charge under the floor
    expect(c.get('stone_pressure_plate')).toBe(1);

    // four chests, all of the pyramid's table, all standing in the room
    const chests = loot.filter((spot) => spot.startsWith('chests/'));
    expect(chests.length).toBe(4);
    for (const spot of chests) {
      expect(spot.startsWith('chests/desert_pyramid@')).toBe(true);
      const [x, y, z] = spot.split('@')[1].split(',').map(Number);
      expect(blocks.idOf(world.access.get(x, y, z))).toBe('chest');
      expect(y).toBeLessThan(64); // the room is under the floor, not in the hall
    }
    // and four blocks of suspicious sand in the corners of the same floor, for a brush to find
    const buried = loot.filter((spot) => spot.startsWith('archaeology/desert_pyramid@'));
    expect(buried.length).toBe(4);
    expect(c.get('suspicious_sand')).toBe(4);
    for (const spot of buried) {
      const [x, y, z] = spot.split('@')[1].split(',').map(Number);
      expect(blocks.idOf(world.access.get(x, y, z))).toBe('suspicious_sand');
      expect(y).toBeLessThan(64);
    }
    // the plate sits over the charge, with the floor between them
    const plate = [...world.written].find(([, s]) => blocks.idOf(s) === 'stone_pressure_plate')!;
    const [px, py, pz] = plate[0].split(',').map(Number);
    expect(blocks.idOf(world.access.get(px, py - 1, pz))).toBe('cut_sandstone');
    expect(blocks.idOf(world.access.get(px, py - 2, pz))).toBe('tnt');
    // and the marked floor above it, which is what gives the room away
    expect(blocks.idOf(world.access.get(px, 64, pz))).toBe('blue_terracotta');
  });

  it('turns with its rotation and stays inside its footprint', () => {
    for (const rotation of [0, 1, 2, 3]) {
      const world = build('desert_pyramid', rotation);
      const [w, , d] = TEMPLE_SIZE.desert_pyramid;
      const [rw, rd] = (rotation & 1) === 1 ? [d, w] : [w, d];
      for (const key of world.written.keys()) {
        const [x, , z] = key.split(',').map(Number);
        expect(x).toBeGreaterThanOrEqual(0);
        expect(x).toBeLessThan(rw);
        expect(z).toBeGreaterThanOrEqual(0);
        expect(z).toBeLessThan(rd);
      }
    }
  });
});

describe('jungle temple and swamp hut', () => {
  it('hides two chests and two dispensers of arrows in the jungle temple', () => {
    const loot: string[] = [];
    const world = build('jungle_temple', 0, WIDE, ground(), loot);
    const c = counts(world);
    expect(c.get('cobblestone')).toBeGreaterThan(200);
    expect(c.get('mossy_cobblestone')).toBeGreaterThan(100);
    expect(c.get('dispenser')).toBe(2);
    expect(c.get('lever')).toBe(2);
    expect(c.get('tripwire')).toBe(4);
    expect(loot.filter((l) => l.startsWith('chests/jungle_temple@')).length).toBe(2);
    expect(loot.filter((l) => l.startsWith('chests/jungle_temple_dispenser@')).length).toBe(2);
  });

  it('stands the witch hut on stilts and gives it a witch and a cat', () => {
    const mobs: string[] = [];
    const world = build('swamp_hut', 0, WIDE, ground(60), undefined, mobs);
    const c = counts(world);
    expect(c.get('spruce_planks')).toBeGreaterThan(40);
    expect(c.get('spruce_stairs')).toBeGreaterThan(10);
    expect(c.get('spruce_log')).toBeGreaterThan(3); // the stilts, driven down to the ground
    expect(c.get('cauldron')).toBe(1);
    expect(c.get('crafting_table')).toBe(1);
    expect(mobs.map((m) => m.split('@')[0]).sort()).toEqual(['cat', 'witch']);
  });
});

describe('temples across chunks', () => {
  it('builds the same temple one chunk at a time as it does in one go', () => {
    for (const kind of ['desert_pyramid', 'jungle_temple', 'swamp_hut'] as TempleKind[]) {
      const whole = build(kind, 2);
      const tiled = ground();
      // the chunks are visited back to front, so any leaked order would show up as a difference
      for (let cx = 2; cx >= -1; cx--)
        for (let cz = 2; cz >= -1; cz--) build(kind, 2, { x0: cx * 16, x1: cx * 16 + 15, z0: cz * 16, z1: cz * 16 + 15 }, tiled);
      expect([...tiled.written].sort(), kind).toEqual([...whole.written].sort());
      expect(whole.written.size, kind).toBeGreaterThan(120);
    }
  });
});
