/**
 * The three newest hostiles: the bogged that poisons its arrows, the breeze that throws rather than
 * hurts, and the creaking that stops dead the moment you look at it.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { MOB_SPECS, mobStats, pickHostile } from '../src/entities/mobTypes.ts';
import { CREAKING_RANGE, PUFF_RANGE, WARDEN_ANGRY, WARDEN_BOOM_CHARGE, WARDEN_BOOM_DAMAGE, WARDEN_BOOM_RANGE, breezeGoal, creakingStalkGoal, pufferPuffGoal, wardenGoal } from '../src/entities/ai.ts';
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

describe('the warden', () => {
  it('registers with vanilla’s stats and no eyes on its model', () => {
    expect(MOB_SPECS.warden.model.texture).toBe('warden/warden.png');
    expect(MOB_SPECS.warden.animation).toBe('warden');
    expect(mobStats('warden')).toMatchObject({ health: 500, damage: 30, disposition: 'hostile' });
    // the tendrils are what it hunts with; there is nothing on it called an eye
    const names = MOB_SPECS.warden.model.parts.map((p) => p.name);
    expect(names).toContain('right_tendril');
    expect(names).toContain('left_tendril');
    expect(names.some((n) => n.includes('eye'))).toBe(false);
  });

  it('builds anger while somebody is near, and lets it drain when they go', () => {
    const goal = wardenGoal();
    const m = makeMob('warden');
    const near = world({ playerPos: () => new THREE.Vector3(0, 64, 4), addPlayerEffect: () => {} });
    for (let i = 0; i < 10; i++) goal.tick!(m, near);
    expect(m.extra.anger).toBe(20);
    expect(m.target).toBeNull();
    // a blow sends it up in a hurry, though one is not quite enough
    m.lastHurtTime = m.age - 1;
    goal.tick!(m, near);
    expect(m.extra.anger).toBe(57);
    expect(m.target).toBeNull();
    goal.tick!(m, near);
    expect(m.extra.anger as number).toBeGreaterThan(WARDEN_ANGRY);
    expect(m.target).toBe('player');
    // and it falls back when nobody is about
    m.lastHurtTime = -1000;
    const gone = world({ playerTargetable: () => false, addPlayerEffect: () => {} });
    const before = m.extra.anger as number;
    for (let i = 0; i < 5; i++) goal.tick!(m, gone);
    expect(m.extra.anger).toBe(before - 5);
  });

  it('winds a sonic boom up and lets it through walls and armour', () => {
    const goal = wardenGoal();
    const m = makeMob('warden');
    const hurts: number[] = [];
    const effects: string[] = [];
    const w = world({
      playerPos: () => new THREE.Vector3(0, 64, 10),
      playerEye: () => new THREE.Vector3(0, 65.6, 10),
      addPlayerEffect: (id: string) => effects.push(id),
      hurtPlayer: (n: number) => hurts.push(n),
    });
    m.extra.anger = 120;
    // it charges for vanilla's count and only then lets go
    for (let i = 0; i < WARDEN_BOOM_CHARGE - 1; i++) goal.tick!(m, w);
    expect(hurts).toEqual([]);
    goal.tick!(m, w);
    expect(hurts).toEqual([WARDEN_BOOM_DAMAGE]);
    expect(m.extra.charging).toBe(0);
    // anything within its reach is in the dark, angry or not
    expect(effects).toContain('darkness');
    expect(WARDEN_BOOM_RANGE).toBe(20);
    expect(CREAKING_RANGE).toBe(32);
  });
});

describe('the last of the variants', () => {
  it('registers the seven that reuse a model already here', () => {
    expect(MOB_SPECS.illusioner.model.texture).toBe('illager/illusioner.png');
    expect(MOB_SPECS.giant.scale).toBe(6);
    expect(MOB_SPECS.happy_ghast.data).toBe('happy_ghast');
    expect(MOB_SPECS.camel_husk.burnsInSun).toBe(true);
    expect(MOB_SPECS.parched.model.texture).toBe('skeleton/parched.png');
    expect(MOB_SPECS.pufferfish.aquatic).toBe(true);
    expect(MOB_SPECS.tropical_fish.aquatic).toBe(true);
    expect(mobStats('giant')).toMatchObject({ health: 100, damage: 50 });
    expect(mobStats('illusioner')).toMatchObject({ health: 32 });
    expect(mobStats('happy_ghast')).toMatchObject({ health: 20, disposition: 'passive' });
    expect(mobStats('camel_husk')).toMatchObject({ disposition: 'hostile' });
    expect(mobStats('pufferfish')).toMatchObject({ health: 3, damage: 3 });
    // the two swollen shapes wait hidden until something comes near
    const parts = MOB_SPECS.pufferfish.model.parts;
    expect(parts.find((p) => p.name === 'puffed_mid')?.hidden).toBe(true);
    expect(parts.find((p) => p.name === 'puffed_large')?.hidden).toBe(true);
  });

  it('swells a pufferfish in two steps and lets it down slowly', () => {
    const goal = pufferPuffGoal();
    const m = makeMob('pufferfish');
    const near = world({ playerPos: () => new THREE.Vector3(0, 64, 2) });
    m.age = 10;
    goal.tick!(m, near);
    expect(m.extra.puff).toBe(1);
    m.age = 20;
    goal.tick!(m, near);
    expect(m.extra.puff).toBe(2);
    // it never goes past the fattest shape
    m.age = 30;
    goal.tick!(m, near);
    expect(m.extra.puff).toBe(2);
    // and settles four times more slowly once whatever it was has gone
    const gone = world({ playerPos: () => new THREE.Vector3(0, 64, 40) });
    m.age = 40;
    goal.tick!(m, gone);
    expect(m.extra.puff).toBe(1);
    m.age = 50;
    goal.tick!(m, gone);
    expect(m.extra.puff).toBe(1);
    m.age = 80;
    goal.tick!(m, gone);
    expect(m.extra.puff).toBe(0);
    expect(PUFF_RANGE).toBe(4);
  });
});
