/**
 * The beach, the taiga and the peaks: a turtle that lays where it hatched, a fox that sleeps out
 * the day, and a goat that rams.
 */
import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BREEDING_FOODS, LLAMA_COATS, MOB_SPECS, PANDA_GENES, mobStats, pandaGene, rabbitVariantFor } from '../src/entities/mobTypes.ts';
import { GOAT_RAM_COOLDOWN, LLAMA_SPIT_DAMAGE, avoidPlayerGoal, bearDefendGoal, foxSleepGoal, goatRamGoal, llamaSpitGoal, pandaLieGoal, snowGolemGoal, targetMonsterGoal, turtleLayGoal } from '../src/entities/ai.ts';
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
    target: null as unknown,
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

describe('the jungle, the ice and the hills', () => {
  it('registers the four with vanilla’s stats and foods', () => {
    expect(MOB_SPECS.rabbit.animation).toBe('rabbit');
    expect(MOB_SPECS.panda.model.texture).toBe('panda/panda.png');
    expect(MOB_SPECS.polar_bear.model.texture).toBe('bear/polarbear.png');
    expect(MOB_SPECS.llama.model.texture).toBe('llama/creamy.png');
    expect(mobStats('rabbit')).toMatchObject({ health: 3, width: 0.4, height: 0.5 });
    expect(mobStats('panda')).toMatchObject({ health: 20, damage: 6, disposition: 'neutral' });
    expect(mobStats('polar_bear')).toMatchObject({ health: 30, damage: 6 });
    expect(mobStats('llama')).toMatchObject({ health: 22, damage: 1 });
    expect(BREEDING_FOODS.rabbit).toContain('carrot');
    expect(BREEDING_FOODS.panda).toEqual(['bamboo']);
    expect(BREEDING_FOODS.llama).toEqual(['hay_block']);
    // the llama's chests only show once it is carrying them
    expect(MOB_SPECS.llama.model.parts.find((p) => p.name === 'chest_left')?.hidden).toBe(true);
  });

  it('colours a rabbit by where it was born, the way vanilla rolls it', () => {
    // snow gives white, one in five splotched
    expect(rabbitVariantFor('snowy_plains', () => 0.1)).toBe('white');
    expect(rabbitVariantFor('snowy_taiga', () => 0.9)).toBe('white_splotched');
    expect(rabbitVariantFor('jagged_peaks', () => 0.1)).toBe('white');
    expect(rabbitVariantFor('desert', () => 0.5)).toBe('gold');
    // everywhere else: half brown, then salt, then black
    expect(rabbitVariantFor('plains', () => 0.1)).toBe('brown');
    expect(rabbitVariantFor('plains', () => 0.7)).toBe('salt');
    expect(rabbitVariantFor('plains', () => 0.95)).toBe('black');
  });

  it('rolls a panda’s gene, most of them plain', () => {
    expect(pandaGene(() => 0)).toBe('normal');
    expect(pandaGene(() => 0.5)).toBe('lazy');
    expect(pandaGene(() => 0.99)).toBe('brown');
    for (const g of PANDA_GENES) expect(typeof g).toBe('string');
    // every gene it can roll has a skin behind it
    const seen = new Set<string>();
    for (let i = 0; i < 100; i++) seen.add(pandaGene(() => i / 100));
    for (const g of seen) expect(PANDA_GENES).toContain(g);
    expect(LLAMA_COATS).toEqual(['creamy', 'white', 'brown', 'gray']);
  });

  it('lies a lazy panda down and leaves the rest walking', () => {
    const goal = pandaLieGoal();
    const lazy = makeMob('panda');
    lazy.extra.gene = 'lazy';
    expect(goal.canUse!(lazy, makeWorld({ rng: () => 0.001 }))).toBe(true);
    goal.tick!(lazy, makeWorld());
    expect(lazy.extra.lying).toBe(true);
    goal.stop!(lazy, makeWorld());
    expect(lazy.extra.lying).toBe(false);
    const busy = makeMob('panda');
    busy.extra.gene = 'playful';
    expect(goal.canUse!(busy, makeWorld({ rng: () => 0.001 }))).toBe(false);
  });

  it('turns a polar bear on whoever touches its cub', () => {
    const goal = bearDefendGoal();
    const bear = makeMob('polar_bear');
    const quiet = makeWorld({ mobsNear: () => [] });
    expect(goal.canUse!(bear, quiet)).toBe(false);
    // a cub of its own, freshly hurt, is what sets it off
    const cub = makeMob('polar_bear');
    (cub as unknown as { isBaby: boolean }).isBaby = true;
    cub.age = 100;
    cub.lastHurtTime = 90;
    const angry = makeWorld({ mobsNear: () => [cub] });
    expect(goal.canUse!(bear, angry)).toBe(true);
    goal.tick!(bear, angry);
    expect(bear.target).toBe('player');
    // a cub that was hurt a long time ago is water under the bridge
    cub.lastHurtTime = 0;
    expect(goal.canUse!(bear, makeWorld({ mobsNear: () => [cub] }))).toBe(false);
  });

  it('makes a llama spit at whatever hurt it', () => {
    const goal = llamaSpitGoal();
    const m = makeMob('llama');
    (m as unknown as { eyePos: () => THREE.Vector3 }).eyePos = () => m.pos.clone();
    const shots: number[] = [];
    const world = makeWorld({
      playerPos: () => new THREE.Vector3(0, 64, 6),
      playerEye: () => new THREE.Vector3(0, 65.6, 6),
      shootArrow: (_f: THREE.Vector3, _t: THREE.Vector3, _v: number, d: number) => shots.push(d),
    });
    // unhurt, it has nothing to say
    expect(goal.canUse!(m, world)).toBe(false);
    m.age = 100;
    m.lastHurtTime = 90;
    expect(goal.canUse!(m, world)).toBe(true);
    goal.tick!(m, world);
    expect(shots).toEqual([LLAMA_SPIT_DAMAGE]);
    // and then it has to reload
    expect(m.attackCooldown).toBe(40);
    goal.tick!(m, world);
    expect(shots).toEqual([LLAMA_SPIT_DAMAGE]);
  });
});

describe('the variants of what was already here', () => {
  it('registers the six that reuse a model already in the game', () => {
    expect(MOB_SPECS.silverfish.animation).toBe('silverfish');
    expect(MOB_SPECS.endermite.animation).toBe('silverfish');
    expect(MOB_SPECS.silverfish.model.texture).toBe('silverfish.png');
    expect(MOB_SPECS.endermite.model.texture).toBe('endermite.png');
    expect(MOB_SPECS.trader_llama.model.texture).toBe('llama/brown.png');
    expect(MOB_SPECS.trader_llama.loot).toBe('trader_llama');
    expect(MOB_SPECS.skeleton_horse.model.texture).toBe('horse/horse_skeleton.png');
    expect(MOB_SPECS.zombie_horse.model.texture).toBe('horse/horse_zombie.png');
    expect(MOB_SPECS.zombie_villager.model.texture).toBe('zombie_villager/zombie_villager.png');
    // the undead burn in the sun, and the little ones come for whoever is near
    expect(MOB_SPECS.zombie_villager.burnsInSun).toBe(true);
    expect(mobStats('silverfish')).toMatchObject({ health: 8, damage: 1, disposition: 'hostile' });
    expect(mobStats('endermite')).toMatchObject({ health: 8, damage: 2, disposition: 'hostile' });
    expect(mobStats('zombie_villager')).toMatchObject({ health: 20, damage: 3, disposition: 'hostile' });
    expect(mobStats('trader_llama')).toMatchObject({ health: 22, disposition: 'neutral' });
    expect(mobStats('skeleton_horse')).toMatchObject({ health: 15 });
    expect(mobStats('zombie_horse')).toMatchObject({ health: 15 });
  });

  it('gives every registered mob stats to stand on', () => {
    for (const id of Object.keys(MOB_SPECS)) expect(mobStats(id), id).not.toBeNull();
  });
});

describe('the golems', () => {
  it('registers both, built rather than born', () => {
    expect(MOB_SPECS.iron_golem.model.texture).toBe('iron_golem/iron_golem.png');
    expect(MOB_SPECS.snow_golem.model.texture).toBe('snow_golem.png');
    expect(mobStats('iron_golem')).toMatchObject({ health: 100, damage: 15, disposition: 'neutral' });
    expect(mobStats('snow_golem')).toMatchObject({ health: 4, disposition: 'passive' });
    // vanilla turns the snowman's second arm right round rather than mirroring it
    const arm = MOB_SPECS.snow_golem.model.parts.find((p) => p.name === 'left_arm');
    expect(arm?.rotation?.[1]).toBeCloseTo(Math.PI, 5);
  });

  it('sends an iron golem after a monster and after whoever hit it', () => {
    const goal = targetMonsterGoal();
    const golem = makeMob('iron_golem');
    const zombie = makeMob('zombie', 0, 64, 5);
    expect(goal.canUse!(golem, makeWorld({ mobsNear: () => [] }))).toBe(false);
    expect(golem.target).toBeNull();
    goal.canUse!(golem, makeWorld({ mobsNear: () => [zombie] }));
    expect(golem.target).toBe(zombie);
    // it leaves a creeper be, which vanilla's golem also does
    golem.target = null;
    goal.canUse!(golem, makeWorld({ mobsNear: () => [makeMob('creeper', 0, 64, 3)] }));
    expect(golem.target).toBeNull();
    // and it turns on whoever hit it
    golem.age = 100;
    golem.lastHurtTime = 90;
    goal.canUse!(golem, makeWorld({ mobsNear: () => [] }));
    expect(golem.target).toBe('player');
  });

  it('makes a snowman lay snow and throw snowballs', () => {
    const goal = snowGolemGoal();
    const m = makeMob('snow_golem', 0.5, 64, 0.5);
    (m as unknown as { eyePos: () => THREE.Vector3 }).eyePos = () => m.pos.clone();
    const shots: number[] = [];
    const world = makeWorld({
      mobsNear: () => [],
      getBlock: (_x: number, y: number) => (y < 64 ? STONE : 0),
      shootArrow: (_f: THREE.Vector3, _t: THREE.Vector3, _v: number, d: number) => shots.push(d),
    });
    m.age = 10;
    goal.tick!(m, world);
    expect(world.placed).toEqual([[0, 64, 0, 'snow']]);
    // with a monster in front of it, it throws — and vanilla's snowball does no damage
    const zombie = makeMob('zombie', 0, 64, 6);
    (zombie as unknown as { eyePos: () => THREE.Vector3 }).eyePos = () => zombie.pos.clone();
    m.age = 11;
    const fight = makeWorld({
      mobsNear: () => [zombie],
      getBlock: () => 0,
      shootArrow: (_f: THREE.Vector3, _t: THREE.Vector3, _v: number, d: number) => shots.push(d),
    });
    goal.tick!(m, fight);
    expect(shots).toEqual([0]);
    expect(m.attackCooldown).toBe(20);
  });
});
