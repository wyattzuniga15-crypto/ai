import { describe, expect, it } from 'vitest';
import { Player } from '../src/entities/player.ts';
import { Input } from '../src/core/input.ts';
import type { BlockSource } from '../src/entities/physics.ts';
import { blocks } from '../src/blocks/registry.ts';

/** Nothing but air, so a glide is only ever the flight model at work. */
const sky: BlockSource = { getBlock: () => 0 };

/** An input with nothing held down but whatever the caller presses. */
const makeInput = () => {
  const down = new Set<string>();
  const pressed = new Set<string>();
  return {
    isDown: (a: string) => down.has(a),
    tickPressed: (a: string) => pressed.has(a),
    press: (a: string) => pressed.add(a),
    hold: (a: string) => down.add(a),
  } as unknown as Input & { press(a: string): void; hold(a: string): void };
};

const glider = (pitch: number) => {
  const p = new Player();
  p.gamemode = 'survival';
  p.pos.set(0, 200, 0);
  p.onGround = false;
  p.pitch = pitch;
  p.yaw = 0;
  p.inventory.armor[2] = { id: 'elytra', count: 1, damage: 0 };
  return p;
};

describe('the elytra', () => {
  it('only opens for a player in the air with one on their back', () => {
    const p = glider(0);
    const input = makeInput();
    input.press('jump');
    p.tick(input, sky, 1);
    expect(p.gliding).toBe(true);

    const bare = glider(0);
    bare.inventory.armor[2] = null;
    const i2 = makeInput();
    i2.press('jump');
    bare.tick(i2, sky, 1);
    expect(bare.gliding).toBe(false);

    // and never off the ground, however hard the jump key is pressed
    const standing = glider(0);
    standing.onGround = true;
    const i3 = makeInput();
    i3.press('jump');
    standing.tick(i3, sky, 1);
    expect(standing.gliding).toBe(false);
  });

  it('will not open on an elytra with nothing left in it', () => {
    const p = glider(0);
    p.inventory.armor[2] = { id: 'elytra', count: 1, damage: 431 };
    expect(p.canGlide()).toBe(false);
    p.inventory.armor[2] = { id: 'elytra', count: 1, damage: 400 };
    expect(p.canGlide()).toBe(true);
  });

  it('trades height for distance: a shallow dive carries far and falls slowly', () => {
    const p = glider(-0.1); // nose a little down
    const input = makeInput();
    input.press('jump');
    p.tick(input, sky, 1);
    for (let i = 0; i < 200; i++) p.tick(makeInput(), sky, i + 2);
    const dropped = 200 - p.pos.y;
    const flown = Math.hypot(p.pos.x, p.pos.z);
    expect(p.gliding).toBe(true);
    expect(flown / dropped).toBeGreaterThan(4); // vanilla glides about six blocks for every one
    expect(flown).toBeGreaterThan(150);
  });

  it('falls out of the sky nose-down and climbs when it is pulled up', () => {
    const dive = glider(-1.2);
    const i1 = makeInput();
    i1.press('jump');
    dive.tick(i1, sky, 1);
    for (let i = 0; i < 40; i++) dive.tick(makeInput(), sky, i + 2);
    const fast = Math.hypot(dive.vel.x, dive.vel.y, dive.vel.z);
    expect(dive.pos.y).toBeLessThan(180);
    // pulling out of that dive turns the speed back into height
    dive.pitch = 0.8;
    const before = dive.vel.y;
    for (let i = 0; i < 20; i++) dive.tick(makeInput(), sky, i + 100);
    expect(dive.vel.y).toBeGreaterThan(before);
    expect(fast).toBeGreaterThan(1);
  });

  it('shuts as soon as there is ground under the flier', () => {
    const p = glider(-0.1);
    const input = makeInput();
    input.press('jump');
    p.tick(input, sky, 1);
    expect(p.gliding).toBe(true);
    p.onGround = true;
    p.tick(makeInput(), sky, 2);
    expect(p.gliding).toBe(false);
  });

  it('counts the ticks it has been open, which is what wears the wings out', () => {
    const p = glider(-0.1);
    const input = makeInput();
    input.press('jump');
    p.tick(input, sky, 1);
    for (let i = 0; i < 60; i++) p.tick(makeInput(), sky, i + 2);
    expect(p.glideTicks).toBe(61);
  });
});

describe('powder snow', () => {
  const snowWorld = (topY: number): BlockSource => ({
    getBlock: (_x: number, y: number) => (y < topY ? blocks.defaultState('powder_snow') : 0),
  });

  const walker = () => {
    const p = new Player();
    p.gamemode = 'survival';
    p.pos.set(0.5, 60, 0.5);
    p.onGround = false;
    return p;
  };

  it('catches a fall and freezes whoever is in it', () => {
    const p = walker();
    p.vel.y = -1;
    for (let i = 0; i < 10; i++) p.tick(makeInput(), snowWorld(64), i);
    expect(p.inPowderSnow).toBe(true);
    expect(p.vel.y).toBeGreaterThanOrEqual(-0.16); // nobody drops through it fast
    expect(p.fallDistance).toBe(0);
    expect(p.frozenTicks).toBe(10);
  });

  it('thaws twice as fast out of it, and never freezes anyone in leather', () => {
    const p = walker();
    for (let i = 0; i < 20; i++) p.tick(makeInput(), snowWorld(64), i);
    expect(p.frozenTicks).toBe(20);
    for (let i = 0; i < 5; i++) p.tick(makeInput(), sky, i);
    expect(p.frozenTicks).toBe(10);

    const warm = walker();
    warm.inventory.armor[2] = { id: 'leather_chestplate', count: 1 };
    for (let i = 0; i < 20; i++) warm.tick(makeInput(), snowWorld(64), i);
    expect(warm.inPowderSnow).toBe(true);
    expect(warm.frozenTicks).toBe(0);
  });

  it('carries a walker in leather boots over the top of it', () => {
    const p = walker();
    p.inventory.armor[0] = { id: 'leather_boots', count: 1 };
    p.pos.set(0.5, 66, 0.5);
    for (let i = 0; i < 30; i++) p.tick(makeInput(), snowWorld(64), i);
    expect(p.pos.y).toBeGreaterThanOrEqual(64);
    expect(p.onGround).toBe(true);
    expect(p.inPowderSnow).toBe(false);
  });
});
