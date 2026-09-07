import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { FORTRESS_Y, assembleFortress, fillFortressPiece, type FortressPiece } from '../src/world/gen/fortress.ts';

function fakeWorld() {
  const map = new Map<string, number>();
  return {
    map,
    get: (x: number, y: number, z: number) => map.get(`${x},${y},${z}`) ?? blocks.AIR,
    set: (x: number, y: number, z: number, s: number) => void map.set(`${x},${y},${z}`, s),
  };
}

function build(pieces: FortressPiece[], clip = { x0: -256, x1: 256, z0: -256, z1: 256 }) {
  const world = fakeWorld();
  const loot: string[] = [];
  const spawners: string[] = [];
  const mobs: string[] = [];
  for (const p of pieces) fillFortressPiece(p, world, clip, (_x, _y, _z, t) => loot.push(t), (_x, _y, _z, m) => spawners.push(m), (_x, _y, _z, m) => mobs.push(m));
  const tally = new Map<string, number>();
  for (const state of world.map.values()) {
    const id = blocks.blockOf(state).id;
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  return { world, tally, loot, spawners, mobs };
}

describe('fortress layout', () => {
  it('starts from a crossing at vanilla\'s bridge height and grows out of it', () => {
    const pieces = assembleFortress(1234, 0, 0);
    expect(pieces.length).toBeGreaterThan(4);
    expect(pieces[0].type).toBe('crossing');
    expect(pieces[0].box.y0).toBe(FORTRESS_Y);
    for (const p of pieces) {
      expect(Math.abs(p.box.x0)).toBeLessThanOrEqual(160);
      expect(Math.abs(p.box.z0)).toBeLessThanOrEqual(160);
    }
  });

  it('never lets two pieces stand in the same place', () => {
    for (const seed of [1, 77, 4242, 99999]) {
      const pieces = assembleFortress(seed, 0, 0);
      for (let i = 0; i < pieces.length; i++)
        for (let j = i + 1; j < pieces.length; j++) {
          const a = pieces[i].box, b = pieces[j].box;
          const hit = a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;
          expect(hit).toBe(false);
        }
    }
  });

  it('comes out the same for the same seed', () => {
    expect(assembleFortress(555, 16, -32)).toEqual(assembleFortress(555, 16, -32));
    expect(assembleFortress(556, 16, -32)).not.toEqual(assembleFortress(555, 16, -32));
  });
});

describe('fortress pieces', () => {
  it('are made of nether brick, with fences on the bridges', () => {
    const { tally } = build(assembleFortress(4242, 0, 0));
    expect(tally.get('nether_bricks')).toBeGreaterThan(500);
    expect(tally.get('nether_brick_fence')).toBeGreaterThan(10);
  });

  it('grows nether wart on soul sand and leaves a chest with it', () => {
    const wart: FortressPiece = { type: 'wart_room', box: { x0: 0, x1: 8, y0: 64, y1: 71, z0: 0, z1: 8 }, dir: 0, seed: 7 };
    const { tally, loot } = build([wart]);
    expect(tally.get('soul_sand')).toBeGreaterThan(10);
    expect(tally.get('nether_wart')).toBeGreaterThan(5);
    expect(loot).toEqual(['chests/nether_bridge']);
  });

  it('puts a blaze spawner on its platform', () => {
    const room: FortressPiece = { type: 'blaze_room', box: { x0: 0, x1: 8, y0: 64, y1: 71, z0: 0, z1: 8 }, dir: 0, seed: 7 };
    const { tally, spawners, world } = build([room]);
    expect(spawners).toEqual(['blaze']);
    expect(tally.get('spawner')).toBe(1);
    expect(blocks.blockOf(world.get(4, 66, 4)).id).toBe('spawner');
    expect(blocks.blockOf(world.get(4, 65, 4)).id).toBe('nether_bricks'); // the platform under it
  });

  it('keeps wither skeletons and zombified piglins in its corridors', () => {
    const { mobs } = build(assembleFortress(4242, 0, 0));
    expect(mobs.length).toBeGreaterThan(0);
    expect(mobs.every((m) => m === 'wither_skeleton' || m === 'zombified_piglin')).toBe(true);
  });

  it('writes only inside the chunk it is clipped to', () => {
    const pieces = assembleFortress(4242, 0, 0);
    const { world } = build(pieces, { x0: 0, x1: 15, z0: 0, z1: 15 });
    for (const key of world.map.keys()) {
      const [x, , z] = key.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(0);
      expect(x).toBeLessThanOrEqual(15);
      expect(z).toBeGreaterThanOrEqual(0);
      expect(z).toBeLessThanOrEqual(15);
    }
  });

  it('comes out the same however its chunks are visited', () => {
    const pieces = assembleFortress(4242, 0, 0);
    const whole = build(pieces).world;
    const piecemeal = fakeWorld();
    for (let cx = -160; cx < 176; cx += 16)
      for (let cz = -160; cz < 176; cz += 16)
        for (const p of pieces) fillFortressPiece(p, piecemeal, { x0: cx, x1: cx + 15, z0: cz, z1: cz + 15 });
    expect(piecemeal.map.size).toBe(whole.map.size);
    for (const [key, state] of whole.map) expect(piecemeal.map.get(key)).toBe(state);
  });
});
