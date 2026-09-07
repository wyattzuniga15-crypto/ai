import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { assembleStronghold, fillStrongholdPiece, type StrongholdPiece } from '../src/world/gen/stronghold.ts';

const STONE = blocks.defaultState('stone');

function stoneWorld() {
  const written = new Map<string, number>();
  return {
    written,
    access: {
      get: (x: number, y: number, z: number) => written.get(`${x},${y},${z}`) ?? STONE,
      set: (x: number, y: number, z: number, s: number) => { written.set(`${x},${y},${z}`, s); },
    },
  };
}

const overlaps = (a: StrongholdPiece['box'], b: StrongholdPiece['box']) =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;

const fillAll = (
  pieces: StrongholdPiece[],
  world: ReturnType<typeof stoneWorld>,
  clip: { x0: number; x1: number; z0: number; z1: number },
  loot?: string[],
  spawners?: string[],
) => {
  for (const p of pieces)
    fillStrongholdPiece(p, world.access, clip, (x, y, z, table) => loot?.push(`${table}@${x},${y},${z}`), (x, y, z, mob) => spawners?.push(`${mob}@${x},${y},${z}`));
};

describe('stronghold layout', () => {
  it('walks a warren of rooms out of its staircase, always with one portal room', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const pieces = assembleStronghold(seed * 9176, 0, 0, 20);
      expect(pieces[0].type, `seed ${seed}`).toBe('start');
      expect(pieces.length, `seed ${seed}`).toBeGreaterThan(4);
      expect(pieces.filter((p) => p.type === 'portal_room').length, `seed ${seed}`).toBe(1);
      expect(pieces.filter((p) => p.type === 'library').length).toBeLessThanOrEqual(2);
      // rooms never share space, and the warren stays near its staircase
      for (let i = 0; i < pieces.length; i++) {
        expect(Math.abs(pieces[i].box.x0 - pieces[0].x)).toBeLessThanOrEqual(96);
        expect(Math.abs(pieces[i].box.z0 - pieces[0].z)).toBeLessThanOrEqual(96);
        for (let j = i + 1; j < pieces.length; j++)
          expect(overlaps(pieces[i].box, pieces[j].box), `${pieces[i].type} vs ${pieces[j].type}`).toBe(false);
      }
    }
  });

  it('sits under the height it is given and rebuilds the same from a seed', () => {
    const a = assembleStronghold(2024, 3, -8, 12);
    expect(Math.max(...a.map((p) => p.box.y1))).toBeLessThanOrEqual(12);
    const key = (p: StrongholdPiece) => `${p.type}@${p.x},${p.y},${p.z}/${p.dir}`;
    expect(assembleStronghold(2024, 3, -8, 12).map(key)).toEqual(a.map(key));
    expect(assembleStronghold(2025, 3, -8, 12).map(key)).not.toEqual(a.map(key));
  });
});

describe('stronghold rooms', () => {
  const pieces = assembleStronghold(4242 * 3, 0, 0, 20);
  const all = { x0: -400, x1: 400, z0: -400, z1: 400 };

  it('builds the portal room round its frame, over lava, with a silverfish spawner', () => {
    const world = stoneWorld();
    const spawners: string[] = [];
    fillAll(pieces, world, all, undefined, spawners);
    const frames = [...world.written].filter(([, s]) => blocks.idOf(s) === 'end_portal_frame');
    expect(frames.length).toBe(12); // three to a side, corners left out
    // the frames ring a three-by-three of open air with lava under it
    const ys = new Set(frames.map(([k]) => Number(k.split(',')[1])));
    expect(ys.size).toBe(1);
    const y = [...ys][0];
    const xs = frames.map(([k]) => Number(k.split(',')[0]));
    const zs = frames.map(([k]) => Number(k.split(',')[2]));
    const [mx, mz] = [(Math.min(...xs) + Math.max(...xs)) / 2, (Math.min(...zs) + Math.max(...zs)) / 2];
    expect(blocks.idOf(world.access.get(mx, y, mz))).toBe('cave_air');
    expect(blocks.idOf(world.access.get(mx, y - 1, mz))).toBe('lava');
    // eyes are rare: vanilla sets one in ten, so a whole frame is never complete by chance
    const eyes = frames.filter(([, s]) => blocks.prop(s, 'eye') === 'true').length;
    expect(eyes).toBeLessThan(6);
    expect(spawners.length).toBe(1);
    const [sx, sy, sz] = spawners[0].split('@')[1].split(',').map(Number);
    expect(spawners[0].startsWith('silverfish@')).toBe(true);
    expect(blocks.idOf(world.access.get(sx, sy, sz))).toBe('spawner');
  });

  it('weathers its walls and stocks its chests from the stronghold tables', () => {
    const world = stoneWorld();
    const loot: string[] = [];
    fillAll(pieces, world, all, loot);
    const counts = new Map<string, number>();
    for (const s of world.written.values()) {
      const id = blocks.idOf(s);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get('stone_bricks')).toBeGreaterThan(500);
    expect(counts.get('mossy_stone_bricks')).toBeGreaterThan(50);
    expect(counts.get('cracked_stone_bricks')).toBeGreaterThan(50);
    expect(counts.get('infested_stone_bricks')).toBeGreaterThan(5); // the silverfish hide in the walls
    for (const spot of loot) {
      expect(spot.split('@')[0]).toMatch(/^chests\/stronghold_(corridor|crossing|library)$/);
      const [x, y, z] = spot.split('@')[1].split(',').map(Number);
      expect(blocks.idOf(world.access.get(x, y, z))).toBe('chest');
    }
  });

  it('builds the same warren one chunk at a time as it does in one go', () => {
    const whole = stoneWorld();
    fillAll(pieces, whole, all);
    const tiled = stoneWorld();
    for (let cx = 6; cx >= -6; cx--)
      for (let cz = 6; cz >= -6; cz--) fillAll(pieces, tiled, { x0: cx * 16, x1: cx * 16 + 15, z0: cz * 16, z1: cz * 16 + 15 });
    const inside = ([key]: [string, number]) => {
      const [x, , z] = key.split(',').map(Number);
      return x >= -96 && x <= 111 && z >= -96 && z <= 111;
    };
    expect([...tiled.written].filter(inside).sort()).toEqual([...whole.written].filter(inside).sort());
    expect(whole.written.size).toBeGreaterThan(1000);
  });
});
