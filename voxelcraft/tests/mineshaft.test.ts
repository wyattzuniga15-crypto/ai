import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { assembleMineshaft, fillShaftPiece, type ShaftBox, type ShaftPiece } from '../src/world/gen/mineshaft.ts';

const STONE = blocks.defaultState('stone');

/** A world of solid stone, which is what a mineshaft is dug out of. */
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

const overlaps = (a: ShaftBox, b: ShaftBox) =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;

const fillAll = (
  pieces: ShaftPiece[],
  world: ReturnType<typeof stoneWorld>,
  clip: { x0: number; x1: number; z0: number; z1: number },
  loot?: string[],
  spawners?: string[],
) => {
  for (const p of pieces)
    fillShaftPiece(p, 'normal', world.access, clip, (x, y, z, table) => loot?.push(`${table}@${x},${y},${z}`), (x, y, z, mob) => spawners?.push(`${mob}@${x},${y},${z}`));
};

describe('mineshaft layout', () => {
  it('walks a room out into corridors, crossings and stairs', () => {
    const pieces = assembleMineshaft(12345, 0, 0, 30);
    expect(pieces[0].type).toBe('room');
    const kinds = new Set(pieces.map((p) => p.type));
    expect(kinds.has('corridor')).toBe(true);
    // vanilla shafts are tens of pieces, not hundreds: the walk stops nine pieces out
    expect(pieces.length).toBeGreaterThan(10);
    expect(pieces.length).toBeLessThan(200);
    // no two pieces occupy the same space
    for (let i = 0; i < pieces.length; i++)
      for (let j = i + 1; j < pieces.length; j++) expect(overlaps(pieces[i].box, pieces[j].box), `${pieces[i].type} vs ${pieces[j].type}`).toBe(false);
  });

  it('sits under the height it is given and stays near its room', () => {
    for (const top of [30, -20, 5]) {
      const pieces = assembleMineshaft(999 + top, 4, -7, top);
      expect(Math.max(...pieces.map((p) => p.box.y1))).toBe(top);
      const room = pieces[0].box;
      for (const p of pieces) {
        // the walk is capped at 80 blocks out, plus the piece that reaches that far
        expect(Math.abs(p.box.x0 - room.x0)).toBeLessThanOrEqual(96);
        expect(Math.abs(p.box.z0 - room.z0)).toBeLessThanOrEqual(96);
      }
    }
  });

  it('rebuilds the same shaft from the same seed', () => {
    const a = assembleMineshaft(4242, -3, 8, 20);
    const b = assembleMineshaft(4242, -3, 8, 20);
    const key = (p: ShaftPiece) => `${p.type}@${p.box.x0},${p.box.y0},${p.box.z0}/${p.dir}/${p.seed}`;
    expect(a.map(key)).toEqual(b.map(key));
    expect(assembleMineshaft(4243, -3, 8, 20).map(key)).not.toEqual(a.map(key));
  });
});

describe('mineshaft blocks', () => {
  const pieces = assembleMineshaft(777, 0, 0, 20);
  const all = { x0: -300, x1: 300, z0: -300, z1: 300 };

  it('props its corridors up and lays rails down the middle of them', () => {
    const world = stoneWorld();
    const loot: string[] = [];
    const spawners: string[] = [];
    fillAll(pieces, world, all, loot, spawners);
    const counts = new Map<string, number>();
    for (const state of world.written.values()) {
      const id = blocks.idOf(state);
      counts.set(id, (counts.get(id) ?? 0) + 1);
    }
    expect(counts.get('cave_air')).toBeGreaterThan(1000);
    expect(counts.get('oak_fence')).toBeGreaterThan(10);
    expect(counts.get('oak_planks')).toBeGreaterThan(10);
    expect(counts.get('rail')).toBeGreaterThan(10);
    // rails are laid on the floor with room to walk over them, though a spider corridor may have
    // strung a cobweb there, and a passage dug later can leave the odd length of track hanging
    let rails = 0;
    let hanging = 0;
    for (const [key, state] of world.written) {
      if (blocks.idOf(state) !== 'rail') continue;
      rails++;
      const [x, y, z] = key.split(',').map(Number);
      if (!blocks.stateOpaque[world.access.get(x, y - 1, z)]) hanging++;
      expect(blocks.stateOpaque[world.access.get(x, y + 1, z)]).toBeFalsy();
    }
    expect(hanging / rails).toBeLessThan(0.05);
    // whatever chests the corridors hide are reported for filling, and stand where they are reported
    for (const spot of loot) {
      expect(spot.startsWith('chests/abandoned_mineshaft@')).toBe(true);
      const [x, y, z] = spot.split('@')[1].split(',').map(Number);
      expect(blocks.idOf(world.access.get(x, y, z))).toBe('chest');
    }
    // and a cobwebbed corridor comes with its cave spider spawner
    expect(spawners.length).toBeGreaterThan(0);
    for (const spot of spawners) {
      expect(spot.startsWith('cave_spider@')).toBe(true);
      const [x, y, z] = spot.split('@')[1].split(',').map(Number);
      expect(blocks.idOf(world.access.get(x, y, z))).toBe('spawner');
    }
    expect(counts.get('spawner')).toBe(spawners.length);
  });

  it('digs the same shaft one chunk at a time as it does in one go', () => {
    const whole = stoneWorld();
    fillAll(pieces, whole, all);
    const tiled = stoneWorld();
    // the chunks are visited in the order the world would not use, to catch any order that leaks in
    const chunks: [number, number][] = [];
    for (let cx = -8; cx <= 8; cx++) for (let cz = -8; cz <= 8; cz++) chunks.push([cx, cz]);
    for (const [cx, cz] of chunks.reverse()) fillAll(pieces, tiled, { x0: cx * 16, x1: cx * 16 + 15, z0: cz * 16, z1: cz * 16 + 15 });
    // everything inside the tiled area has to match block for block
    const inside = ([key]: [string, number]) => {
      const [x, , z] = key.split(',').map(Number);
      return x >= -128 && x <= 143 && z >= -128 && z <= 143;
    };
    const a = [...whole.written].filter(inside).sort();
    const b = [...tiled.written].filter(inside).sort();
    expect(b).toEqual(a);
    expect(a.length).toBeGreaterThan(1000);
  });
});
