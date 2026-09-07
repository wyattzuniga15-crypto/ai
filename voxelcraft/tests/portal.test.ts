import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { buildPortal, findFrame, findPortalNear, lightPortal, scalePosition, NETHER_SCALE } from '../src/world/portal.ts';

function fakeWorld(fill = blocks.AIR) {
  const map = new Map<string, number>();
  return {
    map,
    get: (x: number, y: number, z: number) => map.get(`${x},${y},${z}`) ?? fill,
    set: (x: number, y: number, z: number, s: number) => void map.set(`${x},${y},${z}`, s),
  };
}

/** A frame with an opening `w` wide along the axis and `h` tall, its bottom-left at the origin. */
function frame(w: number, h: number, axis: 'x' | 'z') {
  const world = fakeWorld();
  const OB = blocks.defaultState('obsidian');
  const dx = axis === 'x' ? 1 : 0;
  const dz = axis === 'z' ? 1 : 0;
  for (let i = -1; i <= w; i++) {
    world.set(dx * i, -1, dz * i, OB);
    world.set(dx * i, h, dz * i, OB);
  }
  for (let y = 0; y < h; y++) {
    world.set(-dx, y, -dz, OB);
    world.set(dx * w, y, dz * w, OB);
  }
  return world;
}

describe('portal frames', () => {
  it('finds vanilla\'s smallest frame from anywhere inside it', () => {
    const world = frame(2, 3, 'x');
    for (let i = 0; i < 2; i++)
      for (let y = 0; y < 3; y++) {
        const found = findFrame(world, i, y, 0);
        expect(found?.axis).toBe('x');
        expect(found?.cells.length).toBe(6);
      }
  });

  it('finds one on the other axis too', () => {
    const found = findFrame(frame(2, 3, 'z'), 0, 1, 1);
    expect(found?.axis).toBe('z');
    expect(found?.cells.length).toBe(6);
  });

  it('takes a bigger opening, up to vanilla\'s limit', () => {
    expect(findFrame(frame(5, 7, 'x'), 2, 3, 0)?.cells.length).toBe(35);
    expect(findFrame(frame(21, 21, 'x'), 10, 10, 0)?.cells.length).toBe(21 * 21);
    expect(findFrame(frame(22, 3, 'x'), 10, 1, 0)).toBeNull();
  });

  it('refuses one too small, or with a hole in it', () => {
    expect(findFrame(frame(1, 3, 'x'), 0, 1, 0)).toBeNull();
    expect(findFrame(frame(2, 2, 'x'), 0, 1, 0)).toBeNull();
    const holed = frame(2, 3, 'x');
    holed.set(-1, 1, 0, blocks.AIR); // a missing side stone
    expect(findFrame(holed, 0, 1, 0)).toBeNull();
    const open = frame(2, 3, 'x');
    open.set(0, 3, 0, blocks.AIR); // no lintel
    expect(findFrame(open, 0, 1, 0)).toBeNull();
  });

  it('fills the opening with portal blocks on the frame\'s own axis', () => {
    const world = frame(2, 3, 'x');
    expect(lightPortal(world, 0, 0, 0)).toBe(true);
    const state = world.get(1, 2, 0);
    expect(blocks.blockOf(state).id).toBe('nether_portal');
    expect(blocks.prop(state, 'axis')).toBe('x');
    expect(lightPortal(fakeWorld(), 0, 0, 0)).toBe(false);
  });
});

describe('travelling', () => {
  it('divides by eight going down and multiplies going back, as vanilla scales the Nether', () => {
    expect(scalePosition(800, -80, 'overworld', 'nether')).toEqual([100, -10]);
    expect(scalePosition(100, -10, 'nether', 'overworld')).toEqual([800, -80]);
    expect(NETHER_SCALE).toBe(8);
    expect(scalePosition(12, 12, 'overworld', 'overworld')).toEqual([12, 12]);
  });

  it('finds the nearest portal to where a traveller comes out', () => {
    const world = fakeWorld();
    const portal = blocks.defaultState('nether_portal');
    world.set(5, 64, 0, portal);
    world.set(-2, 64, 0, portal);
    expect(findPortalNear(world, 0, 64, 0, 16, 60, 70)).toEqual([-2, 64, 0]);
    expect(findPortalNear(world, 0, 64, 0, 1, 60, 70)).toBeNull();
  });

  it('builds one where there is none, and it is a portal you can find again', () => {
    const world = fakeWorld();
    const STONE = blocks.defaultState('stone');
    for (let x = -20; x <= 20; x++) for (let z = -20; z <= 20; z++) for (let y = 0; y < 64; y++) world.set(x, y, z, STONE);
    const [px, py, pz] = buildPortal(world, 0, 64, 0, 0, 127);
    expect(blocks.blockOf(world.get(px, py, pz)).id).toBe('nether_portal');
    expect(blocks.blockOf(world.get(px, py - 1, pz)).id).toBe('obsidian');
    expect(blocks.blockOf(world.get(px, py + 4, pz)).id).toBe('obsidian');
    expect(findPortalNear(world, px, py, pz, 4, 0, 127)).toEqual([px, py, pz]);
    // and the frame it built is one the game would recognise on its own
    expect(findFrame(world, px, py, pz)?.cells.length).toBe(8);
  });
});
