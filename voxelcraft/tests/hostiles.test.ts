/**
 * The three newest hostiles: the bogged that poisons its arrows, the breeze that throws rather than
 * hurts, and the creaking that stops dead the moment you look at it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MOB_SPECS, mobStats, pickHostile } from '../src/entities/mobTypes.ts';
import { CREAKING_RANGE, breezeGoal, creakingStalkGoal } from '../src/entities/ai.ts';
import type { Mob, MobWorld } from '../src/entities/mob.ts';
import { biomes } from '../src/world/biomes.ts';

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
    onGround: true,
    attackCooldown: 0,
    target: null as unknown,
    moveTarget: null as THREE.Vector3 | null,
    lookTarget: null as THREE.Vector3 | null,
    eyePos: () => m.pos.clone().setY(m.pos.y + def.eyeHeight),
    distanceTo: (v: THREE.Vector3) => m.pos.distanceTo(v),
  } as unknown as Mob;
  return m;
}

const world = (over: Partial<MobWorld> = {}) => Object.assign({
  rng: () => 0.5,
  getBlock: () => 0,
  playerTargetable: () => true,
  playerPos: () => new THREE.Vector3(0, 64, 8),
  playerEye: () => new THREE.Vector3(0, 65.6, 8),
  playerLookDir: () => new THREE.Vector3(0, 0, -1),
  playSound: () => {},
}, over) as unknown as MobWorld;

describe('the newest hostiles', () => {
  it('registers the three with vanilla’s stats', () => {
    expect(MOB_SPECS.bogged.model.texture).toBe('skeleton/bogged.png');
    expect(MOB_SPECS.bogged.burnsInSun).toBe(true);
    expect(MOB_SPECS.breeze.animation).toBe('breeze');
    expect(MOB_SPECS.creaking.model.texture).toBe('creaking/creaking.png');
    expect(mobStats('bogged')).toMatchObject({ health: 16, damage: 2, disposition: 'hostile' });
    expect(mobStats('breeze')).toMatchObject({ health: 30, damage: 0 });
    expect(mobStats('creaking')).toMatchObject({ health: 1, damage: 3 });
    // the mushrooms on its skull are what makes a bogged one
    expect(MOB_SPECS.bogged.model.parts.some((p) => p.name === 'mushrooms')).toBe(true);
  });

  it('trades most of a swamp’s skeletons for bogged ones', () => {
    const swamp = biomes.find((b) => b.id === 'swamp')!;
    const plains = biomes.find((b) => b.id === 'plains')!;
    // pickHostile draws a type first; feed it a die that lands on skeleton either way
    let bogged = 0;
    let plain = 0;
    for (let i = 0; i < 200; i++) {
      const r = i / 200;
      if (pickHostile(() => r, swamp, 40, false, 1) === 'bogged') bogged++;
      if (pickHostile(() => r, plains, 40, false, 1) === 'bogged') plain++;
    }
    expect(bogged).toBeGreaterThan(0);
    expect(plain).toBe(0);
  });

  it('keeps a breeze hopping and throwing rather than closing in', () => {
    const goal = breezeGoal();
    const m = makeMob('breeze');
    expect(goal.canUse!(m, world())).toBe(false);
    m.target = 'player';
    expect(goal.canUse!(m, world())).toBe(true);
    const shots: number[] = [];
    const w = world({ rng: () => 0.01, shootArrow: (_f: THREE.Vector3, _t: THREE.Vector3, _v: number, d: number) => shots.push(d) });
    goal.tick!(m, w);
    // it jumps, and its charge does no damage at all
    expect(m.vel.y).toBeGreaterThan(0);
    expect(shots).toEqual([0]);
    expect(m.attackCooldown).toBe(60);
  });

  it('freezes a creaking while it is watched and lets it close when it is not', () => {
    const goal = creakingStalkGoal();
    const m = makeMob('creaking');
    m.pos.set(0, 64, 8);
    // the player at (0,64,0) looking down -z is looking away from a mob at +z
    const away = world({ playerPos: () => new THREE.Vector3(0, 64, 0), playerEye: () => new THREE.Vector3(0, 65.6, 0), playerLookDir: () => new THREE.Vector3(0, 0, -1) });
    goal.tick!(m, away);
    expect(m.extra.frozen).toBe(false);
    expect(m.moveTarget).not.toBeNull();
    expect(m.target).toBe('player');
    // turned round to face it, it stops dead
    const watching = world({ playerPos: () => new THREE.Vector3(0, 64, 0), playerEye: () => new THREE.Vector3(0, 65.6, 0), playerLookDir: () => new THREE.Vector3(0, 0, 1) });
    goal.tick!(m, watching);
    expect(m.extra.frozen).toBe(true);
    expect(m.moveTarget).toBeNull();
    expect(CREAKING_RANGE).toBe(32);
  });
});
