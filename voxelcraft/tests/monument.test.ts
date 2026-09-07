import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { buildMonument, MONUMENT_SIZE, MONUMENT_Y } from '../src/world/gen/monument.ts';

/** A world the monument can be written into and read back out of. */
function fakeWorld() {
  const map = new Map<string, number>();
  return {
    map,
    get: (x: number, y: number, z: number) => map.get(`${x},${y},${z}`) ?? blocks.AIR,
    set: (x: number, y: number, z: number, s: number) => void map.set(`${x},${y},${z}`, s),
  };
}

function build(x = 0, z = 0) {
  const world = fakeWorld();
  const entities: { x: number; y: number; z: number; mob: string }[] = [];
  const [w, , d] = MONUMENT_SIZE;
  buildMonument({
    world, x, y: MONUMENT_Y, z, seed: 1234,
    clip: { x0: x, x1: x + w - 1, z0: z, z1: z + d - 1 },
    onEntity: (ex, ey, ez, mob) => entities.push({ x: ex, y: ey, z: ez, mob }),
  });
  const tally = new Map<string, number>();
  for (const [key, state] of world.map) {
    void key;
    const id = blocks.blockOf(state).id;
    tally.set(id, (tally.get(id) ?? 0) + 1);
  }
  return { world, entities, tally };
}

describe('ocean monument', () => {
  it('is vanilla\'s 58x23x58 block of prismarine', () => {
    const { world } = build();
    const [w, h, d] = MONUMENT_SIZE;
    expect([w, h, d]).toEqual([58, 23, 58]);
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const key of world.map.keys()) {
      const [x, y] = key.split(',').map(Number);
      minX = Math.min(minX, x);
      maxX = Math.max(maxX, x);
      minY = Math.min(minY, y);
      maxY = Math.max(maxY, y);
    }
    expect(minX).toBe(0);
    expect(maxX).toBe(w - 1);
    expect(minY).toBe(MONUMENT_Y);
    expect(maxY).toBeLessThanOrEqual(MONUMENT_Y + h - 1);
  });

  it('is built of the prismarine family and lit with sea lanterns', () => {
    const { tally } = build();
    expect(tally.get('prismarine')).toBeGreaterThan(1000);
    expect(tally.get('prismarine_bricks')).toBeGreaterThan(1000);
    expect(tally.get('dark_prismarine')).toBeGreaterThan(100);
    expect(tally.get('sea_lantern')).toBeGreaterThan(10);
    expect(tally.get('wet_sponge')).toBeGreaterThan(0);
  });

  it('hides vanilla\'s eight blocks of gold, sealed in dark prismarine', () => {
    const { world, tally } = build();
    expect(tally.get('gold_block')).toBe(8);
    const gold: [number, number, number][] = [];
    for (const [key, state] of world.map) if (blocks.blockOf(state).id === 'gold_block') gold.push(key.split(',').map(Number) as [number, number, number]);
    // every block around the hoard is dark prismarine or gold: nothing can be swum to it
    for (const [x, y, z] of gold)
      for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
        const id = blocks.blockOf(world.get(x + dx, y + dy, z + dz)).id;
        expect(['gold_block', 'dark_prismarine', 'water']).toContain(id);
      }
  });

  it('leaves no air pocket under the sea', () => {
    const { world } = build();
    let air = 0;
    for (const state of world.map.values()) if (state === blocks.AIR) air++;
    expect(air).toBe(0);
  });

  it('comes with vanilla\'s three elder guardians and a shoal of guardians', () => {
    const { entities } = build();
    const elders = entities.filter((e) => e.mob === 'elder_guardian');
    expect(elders.length).toBe(3);
    expect(entities.filter((e) => e.mob === 'guardian').length).toBeGreaterThan(2);
    // one elder to a wing and one in the top room, so no two share a spot
    const spots = new Set(elders.map((e) => `${e.x},${e.y},${e.z}`));
    expect(spots.size).toBe(3);
  });

  it('writes only inside the chunk it is clipped to', () => {
    const world = fakeWorld();
    buildMonument({ world, x: 0, y: MONUMENT_Y, z: 0, seed: 7, clip: { x0: 16, x1: 31, z0: 16, z1: 31 } });
    for (const key of world.map.keys()) {
      const [x, , z] = key.split(',').map(Number);
      expect(x).toBeGreaterThanOrEqual(16);
      expect(x).toBeLessThanOrEqual(31);
      expect(z).toBeGreaterThanOrEqual(16);
      expect(z).toBeLessThanOrEqual(31);
    }
  });

  it('comes out the same however its chunks are visited', () => {
    const whole = build().world;
    const piecemeal = fakeWorld();
    const [w, , d] = MONUMENT_SIZE;
    for (let cx = 0; cx < w; cx += 16)
      for (let cz = 0; cz < d; cz += 16)
        buildMonument({ world: piecemeal, x: 0, y: MONUMENT_Y, z: 0, seed: 1234, clip: { x0: cx, x1: cx + 15, z0: cz, z1: cz + 15 } });
    expect(piecemeal.map.size).toBe(whole.map.size);
    for (const [key, state] of whole.map) expect(piecemeal.map.get(key)).toBe(state);
  });
});
