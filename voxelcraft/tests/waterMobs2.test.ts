/**
 * The lush caves, the swamp and the jungle: an axolotl that plays dead, frogs and the tadpoles they
 * grew from, and parrots that dance to a record.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AXOLOTL_COLORS, MOB_SPECS, PARROT_COLORS, axolotlColor, frogVariantFor, mobStats } from '../src/entities/mobTypes.ts';
import { AXOLOTL_PLAY_DEAD_TICKS, PARROT_DANCE_RANGE, axolotlPlayDeadGoal, parrotDanceGoal } from '../src/entities/ai.ts';
import type { Mob, MobWorld } from '../src/entities/mob.ts';

function makeMob(id: string): Mob {
  const def = mobStats(id)!;
  const m = {
    def,
    pos: new THREE.Vector3(0, 64, 0),
    vel: new THREE.Vector3(),
    extra: {} as Record<string, unknown>,
    age: 100,
    lastHurtTime: -1000,
    health: def.health,
    inWater: false,
    moveTarget: null as THREE.Vector3 | null,
    lookTarget: null as THREE.Vector3 | null,
    distanceTo: (v: THREE.Vector3) => m.pos.distanceTo(v),
  } as unknown as Mob;
  return m;
}

const world = (over: Partial<MobWorld> = {}) => Object.assign({ rng: () => 0.1, getBlock: () => 0 }, over) as unknown as MobWorld;

describe('the lush caves, the swamp and the jungle', () => {
  it('registers the four with vanilla’s stats', () => {
    expect(MOB_SPECS.axolotl.aquatic).toBe(true);
    expect(MOB_SPECS.tadpole.aquatic).toBe(true);
    expect(MOB_SPECS.frog.animation).toBe('rabbit');
    expect(MOB_SPECS.parrot.flapping).toBe(true);
    expect(mobStats('axolotl')).toMatchObject({ health: 14, damage: 2 });
    expect(mobStats('frog')).toMatchObject({ health: 10 });
    expect(mobStats('tadpole')).toMatchObject({ health: 6 });
    expect(mobStats('parrot')).toMatchObject({ health: 6 });
  });

  it('rolls an axolotl’s colour, blue once in twelve hundred', () => {
    expect(axolotlColor(() => 0)).toBe('blue');
    expect(AXOLOTL_COLORS).not.toContain('blue');
    for (const r of [0.001, 0.3, 0.6, 0.9]) expect(AXOLOTL_COLORS).toContain(axolotlColor(() => r));
    expect(PARROT_COLORS).toHaveLength(5);
  });

  it('colours a frog by how warm its swamp is', () => {
    expect(frogVariantFor(0.2)).toBe('cold');
    expect(frogVariantFor(0.8)).toBe('temperate');
    expect(frogVariantFor(1.2)).toBe('warm');
  });

  it('rolls a badly hurt axolotl over and heals it while it lies there', () => {
    const goal = axolotlPlayDeadGoal();
    const m = makeMob('axolotl');
    // hale and hearty in the water, it does nothing
    m.inWater = true;
    m.lastHurtTime = m.age - 1;
    expect(goal.canUse!(m, world())).toBe(false);
    // under half health, freshly hit, it plays dead
    m.health = 5;
    expect(goal.canUse!(m, world())).toBe(true);
    goal.tick!(m, world());
    expect(m.extra.playDead).toBe(AXOLOTL_PLAY_DEAD_TICKS - 1);
    expect(m.moveTarget).toBeNull();
    // it heals a heart every second it lies there
    m.extra.playDead = 20;
    m.health = 5;
    goal.tick!(m, world());
    expect(m.health).toBe(6);
    // and out of the water it never starts
    m.inWater = false;
    m.extra.playDead = 0;
    expect(goal.canUse!(m, world())).toBe(false);
  });

  it('dances a parrot beside a playing jukebox and stops it when the record does', () => {
    const goal = parrotDanceGoal();
    const m = makeMob('parrot');
    expect(goal.canUse!(m, world({ recordNear: () => false }))).toBe(false);
    expect(goal.canUse!(m, world({ recordNear: () => true }))).toBe(true);
    goal.tick!(m, world({ recordNear: () => true }));
    expect(m.extra.dancing).toBe(true);
    expect(goal.canContinue!(m, world({ recordNear: () => false }))).toBe(false);
    goal.stop!(m, world());
    expect(m.extra.dancing).toBe(false);
    // vanilla only hears a record from three blocks off
    expect(PARROT_DANCE_RANGE).toBe(3);
  });
});
