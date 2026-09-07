/**
 * The cave and the ocean: bats hanging in the dark, squid drifting, and dolphins handing whoever
 * swims beside them vanilla's grace.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MOB_SPECS, mobStats } from '../src/entities/mobTypes.ts';
import { batGoal, squidGoal, dolphinGoal } from '../src/entities/ai.ts';
import type { Mob, MobWorld } from '../src/entities/mob.ts';
import { blocks } from '../src/blocks/registry.ts';

const WATER = blocks.defaultState('water');
const STONE = blocks.defaultState('stone');

function makeMob(id: string, x = 0, y = 64, z = 0): Mob {
  const def = mobStats(id)!;
  const m = {
    def,
    pos: new THREE.Vector3(x, y, z),
    vel: new THREE.Vector3(),
    extra: {} as Record<string, unknown>,
    age: 0,
    lastHurtTime: -1000,
    inWater: false,
    moveTarget: null as THREE.Vector3 | null,
    moveSpeed: 1,
    moveTimeout: 0,
    lookTarget: null as THREE.Vector3 | null,
    distanceTo: (v: THREE.Vector3) => m.pos.distanceTo(v),
  } as unknown as Mob;
  return m;
}

function makeWorld(over: Partial<MobWorld> = {}): MobWorld & { effects: [string, number][] } {
  const effects: [string, number][] = [];
  return Object.assign({
    effects,
    rng: () => 0.5,
    getBlock: () => 0,
    getSkyLight: () => 0,
    getBlockLight: () => 0,
    playerPos: () => new THREE.Vector3(0, 64, 40),
    addPlayerEffect: (id: string, ticks: number) => effects.push([id, ticks]),
  }, over) as unknown as MobWorld & { effects: [string, number][] };
}

describe('the cave and the ocean', () => {
  it('registers the four with vanilla’s stats', () => {
    expect(MOB_SPECS.bat.model.texture).toBe('bat.png');
    // vanilla draws a bat at a bit over a third of its model
    expect(MOB_SPECS.bat.scale).toBe(0.35);
    expect(MOB_SPECS.bat.flying).toBe(true);
    expect(MOB_SPECS.squid.model.texture).toBe('squid/squid.png');
    expect(MOB_SPECS.glow_squid.model.texture).toBe('squid/glow_squid.png');
    expect(MOB_SPECS.squid.aquatic).toBe(true);
    expect(MOB_SPECS.dolphin.model.texture).toBe('dolphin.png');
    expect(mobStats('bat')).toMatchObject({ health: 6, width: 0.5, height: 0.9 });
    expect(mobStats('squid')).toMatchObject({ health: 10, disposition: 'passive' });
    expect(mobStats('glow_squid')).toMatchObject({ health: 10 });
    expect(mobStats('dolphin')).toMatchObject({ health: 10, damage: 3, disposition: 'neutral' });
  });

  it('hangs a bat up in the dark and wakes it when the light comes', () => {
    const goal = batGoal();
    const m = makeMob('bat');
    m.extra.resting = true;
    // a block over its head and nobody near: it stays where it is
    const dark = makeWorld({ getBlock: (_x, y) => (y > 64 ? STONE : 0) });
    goal.tick!(m, dark);
    expect(m.extra.resting).toBe(true);
    expect(m.moveTarget).toBeNull();
    // a lamp under it sends it off
    const lit = makeWorld({ getBlock: (_x, y) => (y > 64 ? STONE : 0), getBlockLight: () => 15 });
    goal.tick!(m, lit);
    expect(m.extra.resting).toBe(false);
    expect(m.moveTarget).not.toBeNull();
    // and it never settles in the open sky
    const open = makeWorld({ getBlock: () => 0, rng: () => 0 });
    m.moveTarget = null;
    goal.tick!(m, open);
    expect(m.extra.resting).toBe(false);
  });

  it('drifts a squid through water and leaves it flopping out of it', () => {
    const goal = squidGoal();
    const m = makeMob('squid');
    const sea = makeWorld({ getBlock: () => WATER });
    m.inWater = true;
    goal.tick!(m, sea);
    expect(m.moveTarget).not.toBeNull();
    expect(m.moveSpeed).toBeLessThan(1);
    // hurt, it bolts
    m.lastHurtTime = m.age;
    m.moveTarget = null;
    goal.tick!(m, sea);
    expect(m.moveSpeed).toBeGreaterThan(1);
    // out of the water it has nowhere to go
    m.inWater = false;
    m.moveTarget = new THREE.Vector3(1, 1, 1);
    goal.tick!(m, sea);
    expect(m.moveTarget).toBeNull();
  });

  it('gives a swimming player dolphin’s grace, and only in the water', () => {
    const goal = dolphinGoal();
    const m = makeMob('dolphin', 0, 64, 0);
    const near = makeWorld({ getBlock: () => WATER, playerPos: () => new THREE.Vector3(0, 64, 4) });
    m.inWater = true;
    goal.tick!(m, near);
    expect((near as unknown as { effects: [string, number][] }).effects).toEqual([['dolphins_grace', 100]]);
    // a player out of the water, or too far off, gets nothing
    const dry = makeWorld({ getBlock: () => 0, playerPos: () => new THREE.Vector3(0, 64, 4) });
    goal.tick!(m, dry);
    expect((dry as unknown as { effects: [string, number][] }).effects).toEqual([]);
    const far = makeWorld({ getBlock: () => WATER, playerPos: () => new THREE.Vector3(0, 64, 40) });
    goal.tick!(m, far);
    expect((far as unknown as { effects: [string, number][] }).effects).toEqual([]);
  });
});
