import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Mob, guardianAttackTicks, type MobWorld } from '../src/entities/mob.ts';
import { mobStats } from '../src/entities/mobTypes.ts';
import { guardianGoal, elderCurseGoal } from '../src/entities/ai.ts';

/** Models want a DOM, so the goals are driven on a stand-in the way the other mob tests do. */
const makeGuardian = (type = 'guardian'): Mob => {
  const def = mobStats(type)!;
  return {
    def, extra: {}, health: def.health, maxHealth: def.health, dead: false, removed: false,
    age: 0, inWater: true, target: 'player' as const, moveTarget: null, lookTarget: null,
    moveSpeed: 1, moveTimeout: 0, pos: new THREE.Vector3(0, 64, 0),
    eyePos: () => new THREE.Vector3(0, 64.4, 0),
    distanceTo: (v: THREE.Vector3) => new THREE.Vector3(0, 64.4, 0).distanceTo(v),
  } as unknown as Mob;
};

function makeWorld(over: Partial<MobWorld> = {}): MobWorld & { hurts: number[]; effects: [string, number, number][]; sounds: string[] } {
  const hurts: number[] = [];
  const effects: [string, number, number][] = [];
  const sounds: string[] = [];
  return {
    hurts, effects, sounds,
    playerPos: () => new THREE.Vector3(0, 64, 6),
    playerEye: () => new THREE.Vector3(0, 65.6, 6),
    playerTargetable: () => true,
    lineOfSight: () => true,
    hurtPlayer: (n: number) => hurts.push(n),
    addPlayerEffect: (id: string, ticks: number, amp = 0) => effects.push([id, ticks, amp]),
    playSound: (n: string) => sounds.push(n),
    rng: () => 0.5,
    getBlock: () => 0,
    ...over,
  } as unknown as MobWorld & { hurts: number[]; effects: [string, number, number][]; sounds: string[] };
}

describe('guardian beam', () => {
  it('charges for vanilla\'s attack duration, shorter for the elder', () => {
    expect(guardianAttackTicks(false)).toBe(80);
    expect(guardianAttackTicks(true)).toBe(60);
  });

  it('holds still while it charges, then lands its own attack damage', () => {
    const m = makeGuardian();
    const w = makeWorld();
    const goal = guardianGoal();
    goal.tick(m, w);
    expect(m.extra.beam).toBe(1);
    expect(m.moveTarget).toBeNull(); // vanilla stops moving while the beam builds
    expect(w.sounds).toContain('guardian_attack');
    expect(w.hurts).toEqual([]);
    for (let i = 1; i < 80; i++) goal.tick(m, w);
    expect(w.hurts).toEqual([m.def.damage]);
    expect(m.extra.beam).toBeUndefined(); // the beam is spent
    expect(m.target).toBeNull();
  });

  it('drops the beam when the target goes out of sight', () => {
    const m = makeGuardian();
    const goal = guardianGoal();
    goal.tick(m, makeWorld());
    expect(m.extra.beam).toBe(1);
    goal.tick(m, makeWorld({ lineOfSight: () => false }));
    expect(m.extra.beam).toBeUndefined();
  });

  it('never charges out of water', () => {
    const m = makeGuardian();
    m.inWater = false;
    const goal = guardianGoal();
    goal.tick(m, makeWorld());
    expect(m.extra.beam).toBeUndefined();
  });
});

describe('elder guardian', () => {
  it('curses on vanilla\'s sixty-second beat with five minutes of Mining Fatigue III', () => {
    const m = makeGuardian('elder_guardian');
    const goal = elderCurseGoal();
    m.age = 600;
    expect(goal.canUse(m, makeWorld())).toBe(false);
    m.age = 1200;
    expect(goal.canUse(m, makeWorld())).toBe(true);
    const w = makeWorld();
    goal.tick(m, w);
    expect(w.effects).toEqual([['mining_fatigue', 6000, 2]]);
  });

  it('does not reach a player fifty blocks off', () => {
    const m = makeGuardian('elder_guardian');
    const w = makeWorld({ playerPos: () => new THREE.Vector3(0, 64, 80) });
    elderCurseGoal().tick(m, w);
    expect(w.effects).toEqual([]);
  });

  it('is the same mob at vanilla\'s scale, with its own stats', () => {
    expect(mobStats('elder_guardian')?.scale).toBe(2.35);
    expect(mobStats('elder_guardian')?.animation).toBe('guardian');
    expect(mobStats('guardian')?.aquatic).toBe(true);
    expect(mobStats('elder_guardian')?.health).toBe(80);
    expect(mobStats('guardian')?.health).toBe(30);
    expect(mobStats('guardian')?.damage).toBe(6);
    expect(mobStats('elder_guardian')?.damage).toBe(8);
  });
});
