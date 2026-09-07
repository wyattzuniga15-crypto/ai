/**
 * The lush caves, the swamp and the jungle: an axolotl that plays dead, frogs and the tadpoles they
 * grew from, and parrots that dance to a record.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { AXOLOTL_COLORS, MOB_SPECS, PARROT_COLORS, axolotlColor, frogVariantFor, mobStats } from '../src/entities/mobTypes.ts';
import { ARMADILLO_SCARE_RANGE, AXOLOTL_PLAY_DEAD_TICKS, PARROT_DANCE_RANGE, SNIFFER_SEEDS, allayFollowGoal, armadilloRollGoal, axolotlPlayDeadGoal, camelSitGoal, parrotDanceGoal, snifferDigGoal } from '../src/entities/ai.ts';
import type { Mob, MobWorld } from '../src/entities/mob.ts';
import { blocks } from '../src/blocks/registry.ts';

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

describe('the desert, the savanna and the two that are found', () => {
  it('registers the four with vanilla’s stats', () => {
    expect(MOB_SPECS.camel.model.texture).toBe('camel/camel.png');
    expect(MOB_SPECS.armadillo.model.texture).toBe('armadillo.png');
    expect(MOB_SPECS.sniffer.model.texture).toBe('sniffer.png');
    expect(MOB_SPECS.allay.flying).toBe(true);
    expect(mobStats('camel')).toMatchObject({ health: 32, height: 2.375 });
    expect(mobStats('armadillo')).toMatchObject({ health: 12 });
    expect(mobStats('sniffer')).toMatchObject({ health: 14, width: 1.9 });
    expect(mobStats('allay')).toMatchObject({ health: 20 });
    // the ball an armadillo curls into is hidden until it does
    expect(MOB_SPECS.armadillo.model.parts.find((p) => p.name === 'body_rolled_up')?.hidden).toBe(true);
  });

  it('sits a camel down when it is left alone and stands it up when somebody comes', () => {
    const goal = camelSitGoal();
    const m = makeMob('camel');
    const alone = world({ playerTargetable: () => true, playerPos: () => new THREE.Vector3(0, 64, 40), rng: () => 0.0001 });
    expect(goal.canUse!(m, alone)).toBe(true);
    goal.tick!(m, alone);
    expect(m.extra.sitting).toBe(true);
    // somebody walking up gets it back on its feet
    const near = world({ playerTargetable: () => true, playerPos: () => new THREE.Vector3(0, 64, 3) });
    expect(goal.canContinue!(m, near)).toBe(false);
    expect(goal.canUse!(m, near)).toBe(false);
    expect(m.extra.sitting).toBe(false);
  });

  it('rolls an armadillo up when anything comes near', () => {
    const goal = armadilloRollGoal();
    const m = makeMob('armadillo');
    const quiet = world({ playerTargetable: () => true, playerPos: () => new THREE.Vector3(0, 64, 40), mobsNear: () => [] });
    expect(goal.canUse!(m, quiet)).toBe(false);
    const close = world({ playerTargetable: () => true, playerPos: () => new THREE.Vector3(0, 64, 4), mobsNear: () => [] });
    expect(goal.canUse!(m, close)).toBe(true);
    goal.tick!(m, close);
    expect(m.extra.rolled).toBe(true);
    goal.stop!(m, close);
    expect(m.extra.rolled).toBe(false);
    // a monster does it too, from the same seven blocks
    const monster = makeMob('zombie');
    expect(goal.canUse!(m, world({ playerTargetable: () => false, mobsNear: () => [monster] }))).toBe(true);
    expect(ARMADILLO_SCARE_RANGE).toBe(7);
  });

  it('digs an ancient seed out of the ground with a sniffer', () => {
    const goal = snifferDigGoal();
    const m = makeMob('sniffer');
    const dropped: string[] = [];
    const dirt = world({
      rng: () => 0.0001,
      getBlock: (_x: number, y: number) => (y < 64 ? blocks.defaultState('grass_block') : 0),
      dropItem: (id: string) => dropped.push(id),
      emitParticles: () => {},
      playSound: () => {},
    });
    expect(goal.canUse!(m, dirt)).toBe(true);
    goal.tick!(m, dirt);
    expect(SNIFFER_SEEDS).toContain(dropped[0]);
    // it will not dig stone
    dropped.length = 0;
    goal.tick!(m, world({ rng: () => 0.0001, getBlock: (_x: number, y: number) => (y < 64 ? blocks.defaultState('stone') : 0), dropItem: (id: string) => dropped.push(id), emitParticles: () => {}, playSound: () => {} }));
    expect(dropped).toEqual([]);
  });

  it('keeps an allay beside whoever it belongs to', () => {
    const goal = allayFollowGoal();
    const m = makeMob('allay');
    const near = world({ playerPos: () => new THREE.Vector3(0, 64, 10) });
    expect(goal.canUse!(m, near)).toBe(false);
    m.extra.owner = true;
    expect(goal.canUse!(m, near)).toBe(true);
    goal.tick!(m, near);
    expect(m.moveTarget).not.toBeNull();
    // close up it stops rather than crowding them
    goal.tick!(m, world({ playerPos: () => new THREE.Vector3(0, 64, 2) }));
    expect(m.moveTarget).toBeNull();
  });
});
