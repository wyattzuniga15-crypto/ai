import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Mob, type MobWorld } from '../src/entities/mob.ts';
import { mobStats } from '../src/entities/mobTypes.ts';
import { WITHER_SPAWN_TICKS, witherArmoured, witherGoal } from '../src/entities/ai.ts';
import { fireproofItem } from '../src/entities/itemEntity.ts';
import { items } from '../src/items/registry.ts';

const makeWither = (health = 300): Mob => {
  const def = mobStats('wither')!;
  const pos = new THREE.Vector3(0, 70, 0);
  return {
    def, extra: {}, health, maxHealth: def.health, dead: false, removed: false, age: 100,
    invulnerable: 0, hurtTime: 0, lastHurtBy: null, lastHurtTime: -1000,
    target: null as Mob['target'], moveTarget: null, lookTarget: null, moveSpeed: 1, moveTimeout: 0,
    pos, vel: new THREE.Vector3(),
    eyePos: () => pos.clone().setY(pos.y + def.eyeHeight),
    distanceTo: (v: THREE.Vector3) => pos.distanceTo(v),
    hurt: Mob.prototype.hurt,
  } as unknown as Mob;
};

function makeWorld(over: Partial<MobWorld> = {}) {
  const shots: { damage: number; effect?: { id: string; ticks: number } }[] = [];
  const blasts: number[] = [];
  const sounds: string[] = [];
  return Object.assign({
    shots, blasts, sounds,
    playerPos: () => new THREE.Vector3(0, 65, 10),
    playerEye: () => new THREE.Vector3(0, 66.6, 10),
    playerTargetable: () => true,
    lineOfSight: () => true,
    shootArrow: (_f: THREE.Vector3, _t: THREE.Vector3, _v: number, d: number, effect?: { id: string; ticks: number }) => shots.push({ damage: d, effect }),
    explode: (_x: number, _y: number, _z: number, power: number) => blasts.push(power),
    playSound: (n: string) => sounds.push(n),
    rng: () => 0.5,
    getBlock: () => 0,
    hurtPlayer: () => {},
  }, over) as unknown as MobWorld & { shots: { damage: number; effect?: { id: string; ticks: number } }[]; blasts: number[]; sounds: string[] };
}

describe('the Wither rising', () => {
  it('does nothing at all while it is being summoned', () => {
    const m = makeWither();
    m.extra.spawning = WITHER_SPAWN_TICKS;
    const goal = witherGoal();
    const w = makeWorld();
    for (let i = 0; i < WITHER_SPAWN_TICKS - 1; i++) goal.tick(m, w);
    expect(w.shots).toEqual([]);
    expect(w.blasts).toEqual([]);
    expect(m.invulnerable).toBeGreaterThan(0);
  });

  it('blows a hole where it was born when the count runs out', () => {
    const m = makeWither();
    m.extra.spawning = 3;
    const goal = witherGoal();
    const w = makeWorld();
    goal.tick(m, w); // 3 -> 2
    goal.tick(m, w); // 2 -> 1
    expect(w.blasts).toEqual([]);
    goal.tick(m, w); // and off it goes
    expect(w.blasts).toEqual([7]);
    expect(w.sounds).toContain('wither_spawn');
    expect(m.extra.spawning).toBe(0);
  });
});

describe('the Wither fighting', () => {
  it('throws a skull from each head in turn, and they wither what they hit', () => {
    const m = makeWither();
    m.target = 'player';
    const goal = witherGoal();
    const w = makeWorld();
    for (let i = 0; i < 45; i++) goal.tick(m, w);
    expect(w.shots.length).toBe(3);
    for (const s of w.shots) expect(s.effect).toEqual({ id: 'wither', ticks: 200 });
    for (let i = 0; i < 45; i++) goal.tick(m, w);
    expect(w.shots.length).toBe(6);
  });

  it('takes the player as its target when one comes near', () => {
    const m = makeWither();
    const goal = witherGoal();
    goal.tick(m, makeWorld());
    expect(m.target).toBe('player');
  });

  it('is armoured below half its health, and never knocked about', () => {
    const whole = makeWither(300);
    const half = makeWither(150);
    expect(witherArmoured(whole)).toBe(false);
    expect(witherArmoured(half)).toBe(true);
    // vanilla halves what reaches it once it is armoured
    const hurt = makeWither(140);
    hurt.vel.set(0, 0, 0);
    hurt.hurt(20, new THREE.Vector3(0, 70, 5), 'player', 1);
    expect(hurt.health).toBe(130);
    expect(hurt.vel.length()).toBe(0);
    const fresh = makeWither(300);
    fresh.hurt(20, null, 'player', 0);
    expect(fresh.health).toBe(280);
  });

  it('is one of vanilla\'s bosses by its numbers', () => {
    expect(mobStats('wither')?.health).toBe(300);
    expect(mobStats('wither')?.xp).toBe(50);
    expect(mobStats('wither')?.fireproof).toBe(true);
    expect(mobStats('wither')?.flying).toBe(true);
  });
});

describe('netherite', () => {
  it('is what survives a fire, and nothing else is', () => {
    expect(fireproofItem('netherite_pickaxe')).toBe(true);
    expect(fireproofItem('netherite_ingot')).toBe(true);
    expect(fireproofItem('netherite_scrap')).toBe(true);
    expect(fireproofItem('ancient_debris')).toBe(true);
    expect(fireproofItem('diamond_pickaxe')).toBe(false);
    expect(fireproofItem('oak_planks')).toBe(false);
  });

  it('carries vanilla\'s knockback resistance, a tenth to a piece', () => {
    for (const id of ['netherite_helmet', 'netherite_chestplate', 'netherite_leggings', 'netherite_boots'])
      expect(items.byId.get(id)?.armor?.knockbackResistance).toBeCloseTo(0.1);
    expect(items.byId.get('diamond_chestplate')?.armor?.knockbackResistance).toBe(0);
  });
});
