/**
 * The beach, the taiga and the peaks: a turtle that lays where it hatched, a fox that sleeps out
 * the day, and a goat that rams.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BREEDING_FOODS, MOB_SPECS, mobStats } from '../src/entities/mobTypes.ts';
import { GOAT_RAM_COOLDOWN, avoidPlayerGoal, foxSleepGoal, goatRamGoal, turtleLayGoal } from '../src/entities/ai.ts';
import type { Mob, MobWorld } from '../src/entities/mob.ts';
import { blocks } from '../src/blocks/registry.ts';

const SAND = blocks.defaultState('sand');
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
    onGround: true,
    inWater: false,
    isBaby: false,
    attackCooldown: 0,
    moveTarget: null as THREE.Vector3 | null,
    moveSpeed: 1,
    moveTimeout: 0,
    lookTarget: null as THREE.Vector3 | null,
    distanceTo: (v: THREE.Vector3) => m.pos.distanceTo(v),
  } as unknown as Mob;
  return m;
}

function makeWorld(over: Partial<MobWorld> = {}) {
  const placed: [number, number, number, string][] = [];
  const hurts: number[] = [];
  return Object.assign({
    placed, hurts,
    rng: () => 0.5,
    getBlock: () => 0,
    setBlock: (x: number, y: number, z: number, state: number) => placed.push([x, y, z, blocks.blockOf(state).id]),
    getSkyLight: () => 15,
    getBlockLight: () => 0,
    isDay: () => true,
    playerPos: () => new THREE.Vector3(0, 64, 40),
    playerTargetable: () => true,
    playSound: () => {},
    hurtPlayer: (n: number) => hurts.push(n),
  }, over) as unknown as MobWorld & { placed: [number, number, number, string][]; hurts: number[] };
}

describe('the beach, the taiga and the peaks', () => {
  it('registers the three with vanilla’s stats and foods', () => {
    expect(MOB_SPECS.turtle.model.texture).toBe('turtle/big_sea_turtle.png');
    expect(MOB_SPECS.fox.model.texture).toBe('fox/fox.png');
    expect(MOB_SPECS.goat.model.texture).toBe('goat/goat.png');
    expect(mobStats('turtle')).toMatchObject({ health: 30, disposition: 'passive' });
    expect(mobStats('fox')).toMatchObject({ health: 10, damage: 2 });
    expect(mobStats('goat')).toMatchObject({ health: 10, damage: 2, disposition: 'neutral' });
    expect(BREEDING_FOODS.turtle).toEqual(['seagrass']);
    expect(BREEDING_FOODS.goat).toEqual(['wheat']);
    expect(BREEDING_FOODS.fox).toEqual(['sweet_berries', 'glow_berries']);
    // vanilla lays the shell flat with a quarter turn rather than standing it on edge
    const body = MOB_SPECS.turtle.model.parts.find((p) => p.name === 'body');
    expect(body?.rotation?.[0]).toBeCloseTo(Math.PI / 2, 5);
    expect(body?.parent).toBeUndefined();
  });

  it('walks a turtle home and lays a clutch in the sand', () => {
    const goal = turtleLayGoal();
    const m = makeMob('turtle', 0, 64, 0);
    m.extra.hasEgg = true;
    m.extra.home = { x: 20, z: 0 } as never;
    expect(goal.canUse!(m, makeWorld())).toBe(true);
    // far from home it walks there rather than digging
    const away = makeWorld({ getBlock: () => SAND });
    goal.tick!(m, away);
    expect(away.placed).toEqual([]);
    expect(m.moveTarget?.x).toBe(20.5);
    // standing on the sand it has come back to, it lays
    m.pos.set(20.5, 64, 0.5);
    const beach = makeWorld({ getBlock: (_x, y) => (y < 64 ? SAND : 0) });
    goal.tick!(m, beach);
    expect(beach.placed).toEqual([[20, 64, 0, 'turtle_egg']]);
    expect(m.extra.hasEgg).toBe(false);
    // and it will not dig into stone
    m.extra.hasEgg = true;
    const rock = makeWorld({ getBlock: (_x, y) => (y < 64 ? STONE : 0) });
    goal.tick!(m, rock);
    expect(rock.placed).toEqual([]);
  });

  it('puts a fox to sleep in the daylight and wakes it for company', () => {
    const goal = foxSleepGoal();
    const m = makeMob('fox');
    goal.tick!(m, makeWorld());
    expect(m.extra.sleeping).toBe(true);
    // somebody standing over it wakes it
    goal.tick!(m, makeWorld({ playerPos: () => new THREE.Vector3(0, 64, 3) }));
    expect(m.extra.sleeping).toBe(false);
    // so does the night
    goal.tick!(m, makeWorld());
    expect(m.extra.sleeping).toBe(true);
    goal.tick!(m, makeWorld({ isDay: () => false }));
    expect(m.extra.sleeping).toBe(false);
    // and a sleeping fox does not run from anybody
    const flee = avoidPlayerGoal();
    m.extra.sleeping = true;
    expect(flee.canUse!(m, makeWorld({ playerPos: () => new THREE.Vector3(0, 64, 3) }))).toBe(false);
    m.extra.sleeping = false;
    expect(flee.canUse!(m, makeWorld({ playerPos: () => new THREE.Vector3(0, 64, 3) }))).toBe(true);
    flee.tick!(m, makeWorld({ playerPos: () => new THREE.Vector3(0, 64, 3) }));
    // it heads the other way
    expect(m.moveTarget!.z).toBeLessThan(m.pos.z);
  });

  it('charges a goat at what stands a few blocks off, then makes it wait', () => {
    const goal = goatRamGoal();
    const m = makeMob('goat', 0, 64, 0);
    const near = () => makeWorld({ playerPos: () => new THREE.Vector3(0, 64, 6) });
    expect(goal.canUse!(m, near())).toBe(true);
    // too close or too far and it leaves them alone
    expect(goal.canUse!(m, makeWorld({ playerPos: () => new THREE.Vector3(0, 64, 2) }))).toBe(false);
    expect(goal.canUse!(m, makeWorld({ playerPos: () => new THREE.Vector3(0, 64, 20) }))).toBe(false);
    // it lines up and charges
    goal.tick!(m, near());
    expect(m.extra.ramming).toBe(true);
    expect(m.moveSpeed).toBe(2);
    // and lands the blow when it arrives, then waits vanilla's long cooldown out
    m.pos.set(0, 64, 5);
    const hit = makeWorld({ playerPos: () => new THREE.Vector3(0, 64, 6) });
    goal.tick!(m, hit);
    expect(hit.hurts).toEqual([m.def.damage]);
    expect(m.extra.ramCooldown).toBe(GOAT_RAM_COOLDOWN);
    expect(goal.canUse!(m, near())).toBe(false);
    expect(m.extra.ramCooldown).toBe(GOAT_RAM_COOLDOWN - 1);
  });
});
