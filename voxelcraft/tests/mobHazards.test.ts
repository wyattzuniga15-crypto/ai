/**
 * What the world does to a mob: the drop that hurts it and the water it cannot breathe. Vanilla
 * charges a mob for a fall exactly as it charges a player, and drowns anything that is not a fish.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Mob, type MobWorld } from '../src/entities/mob.ts';
import { mobStats } from '../src/entities/mobTypes.ts';
import { blocks } from '../src/blocks/registry.ts';

const WATER = blocks.defaultState('water');

/** A mob with only the parts these two ticks touch, in the style the other mob tests use. */
function makeMob(id: string): Mob {
  const def = mobStats(id)!;
  const m = {
    def,
    pos: new THREE.Vector3(0, 64, 0),
    vel: new THREE.Vector3(),
    extra: {},
    age: 10,
    health: def.health,
    maxHealth: def.health,
    dead: false,
    onGround: false,
    inWater: false,
    invulnerable: 0,
    hurtTime: 0,
    lastHurtTime: -1000,
    fallDistance: 0,
    air: 300,
    hurt: Mob.prototype.hurt,
    breatheTick: (Mob.prototype as unknown as Record<string, unknown>).breatheTick,
    breathesWater: (Mob.prototype as unknown as Record<string, unknown>).breathesWater,
    fallTick: (Mob.prototype as unknown as Record<string, unknown>).fallTick,
  } as unknown as Mob;
  return m;
}

const world = (fill: number): MobWorld => ({ getBlock: () => fill } as unknown as MobWorld);
const breathe = (m: Mob, w: MobWorld): void => (m as unknown as { breatheTick(w: MobWorld): void }).breatheTick(w);
const fall = (m: Mob, from: number, wasOnGround: boolean): void =>
  (m as unknown as { fallTick(from: number, was: boolean): void }).fallTick(from, wasOnGround);

describe('a mob falling', () => {
  it('is charged a heart for every block past the third, the drop rounded up', () => {
    for (const [height, hearts] of [[3, 0], [4, 1], [10, 7], [20, 17]] as const) {
      const m = makeMob('cow');
      m.health = 100;
      // one long drop, then the tick that lands
      fall(m, 64 + height, false);
      m.onGround = true;
      fall(m, 64, false);
      expect([height, 100 - m.health]).toEqual([height, hearts]);
    }
  });

  it('lets the things that fly or swim off, as vanilla does', () => {
    for (const id of ['bat', 'slime_big', 'cod']) {
      const m = makeMob(id);
      const before = m.health;
      if (id === 'cod') m.inWater = true;
      fall(m, 100, false);
      m.onGround = true;
      fall(m, 64, false);
      expect([id, m.health]).toEqual([id, before]);
    }
  });

  it('forgets the fall once the mob is standing again', () => {
    const m = makeMob('cow');
    fall(m, 100, false);
    expect(m.fallDistance).toBeGreaterThan(0);
    m.onGround = true;
    fall(m, 64, false);
    expect(m.fallDistance).toBe(0);
  });
});

describe('a mob under water', () => {
  it('holds its breath for vanilla’s fifteen seconds and then starts drowning', () => {
    const m = makeMob('cow');
    const w = world(WATER);
    for (let i = 0; i < 300; i++) breathe(m, w);
    expect(m.health).toBe(m.maxHealth); // the breath is only just gone
    for (let i = 0; i < 21; i++) breathe(m, w);
    expect(m.health).toBe(m.maxHealth - 2);
  });

  it('gets its breath back in the air', () => {
    const m = makeMob('cow');
    const w = world(WATER);
    for (let i = 0; i < 100; i++) breathe(m, w);
    expect(m.air).toBeLessThan(300);
    for (let i = 0; i < 100; i++) breathe(m, world(0));
    expect(m.air).toBe(300);
  });

  it('leaves the fish and the drowned alone', () => {
    for (const id of ['cod', 'squid', 'drowned', 'guardian']) {
      const m = makeMob(id);
      const w = world(WATER);
      for (let i = 0; i < 600; i++) breathe(m, w);
      expect([id, m.health]).toEqual([id, m.maxHealth]);
    }
  });
});
