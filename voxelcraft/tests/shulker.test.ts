import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Mob, SHULKER_OPEN_TICKS, shulkerOpen, type MobWorld } from '../src/entities/mob.ts';
import { mobStats } from '../src/entities/mobTypes.ts';
import { shulkerGoal } from '../src/entities/ai.ts';

const makeShulker = (): Mob => {
  const def = mobStats('shulker')!;
  const pos = new THREE.Vector3(0, 70, 0);
  return {
    def, extra: {}, health: def.health, maxHealth: def.health, dead: false, removed: false, age: 0,
    invulnerable: 0, hurtTime: 0, lastHurtBy: null, lastHurtTime: -1000,
    target: null as Mob['target'], moveTarget: null, lookTarget: null, moveSpeed: 1, moveTimeout: 0,
    pos, vel: new THREE.Vector3(),
    eyePos: () => pos.clone().setY(pos.y + def.eyeHeight),
    hurt: Mob.prototype.hurt,
  } as unknown as Mob;
};

const makeWorld = (distance: number, over: Partial<MobWorld> = {}) => {
  const shots: { damage: number; effect?: { id: string; ticks: number } }[] = [];
  return Object.assign({
    shots,
    playerPos: () => new THREE.Vector3(0, 70, distance),
    playerEye: () => new THREE.Vector3(0, 71.6, distance),
    playerTargetable: () => true,
    lineOfSight: () => true,
    shootArrow: (_f: THREE.Vector3, _t: THREE.Vector3, _v: number, d: number, effect?: { id: string; ticks: number }) => shots.push({ damage: d, effect }),
    playSound: () => {},
    rng: () => 0.5,
    getBlock: () => 0,
  }, over) as unknown as MobWorld & { shots: { damage: number; effect?: { id: string; ticks: number } }[] };
};

describe('a shulker', () => {
  it('opens its lid for a player who comes near, and shuts it again when they go', () => {
    const m = makeShulker();
    const goal = shulkerGoal();
    const near = makeWorld(6);
    for (let i = 0; i < SHULKER_OPEN_TICKS; i++) goal.tick(m, near);
    expect(shulkerOpen(m)).toBe(1);
    const gone = makeWorld(40);
    for (let i = 0; i < SHULKER_OPEN_TICKS; i++) goal.tick(m, gone);
    expect(shulkerOpen(m)).toBe(0);
  });

  it('fires a bullet that leaves whoever it hits drifting upward', () => {
    const m = makeShulker();
    const goal = shulkerGoal();
    const w = makeWorld(6);
    for (let i = 0; i < 400; i++) goal.tick(m, w);
    expect(w.shots.length).toBeGreaterThan(1);
    expect(w.shots[0].damage).toBe(m.def.damage);
    expect(w.shots[0].effect).toEqual({ id: 'levitation', ticks: 200 });
  });

  it('never moves, however hard it is pushed', () => {
    const m = makeShulker();
    m.vel.set(0.5, -0.4, 0.2);
    shulkerGoal().tick(m, makeWorld(6));
    expect(m.vel.length()).toBe(0);
    expect(m.moveTarget).toBeNull();
    // and it is never knocked about when it is hit
    m.hurt(4, new THREE.Vector3(0, 70, 5), 'player');
    expect(m.vel.length()).toBe(0);
  });

  it('shrugs off most of a hit while it is shut, and takes it all once it is open', () => {
    const shut = makeShulker();
    shut.hurt(10, null, 'player');
    expect(shut.maxHealth - shut.health).toBeCloseTo(2, 5);
    const open = makeShulker();
    open.extra.open = SHULKER_OPEN_TICKS;
    open.hurt(10, null, 'player');
    expect(open.maxHealth - open.health).toBeCloseTo(10, 5);
  });
});
