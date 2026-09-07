import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Mob, type MobWorld } from '../src/entities/mob.ts';
import { mobStats } from '../src/entities/mobTypes.ts';
import { dragonGoal, dragonShielded } from '../src/entities/ai.ts';
import { endPodium } from '../src/world/gen/end.ts';

/** A stand-in for the real mob, as the other entity tests use: the model needs a DOM. */
const makeMob = (type: string, x = 0, y = 78, z = 0): Mob => {
  const def = mobStats(type)!;
  const pos = new THREE.Vector3(x, y, z);
  return {
    def, extra: {}, health: def.health, maxHealth: def.health, dead: false, removed: false, age: 0,
    invulnerable: 0, hurtTime: 0, lastHurtBy: null, lastHurtTime: -1000, attackCooldown: 0,
    target: null as Mob['target'], moveTarget: null, lookTarget: null, moveSpeed: 1, moveTimeout: 0,
    pos, vel: new THREE.Vector3(),
    eyePos: () => pos.clone().setY(pos.y + def.eyeHeight),
    aabb: () => ({ minX: pos.x - 2, maxX: pos.x + 2, minY: pos.y, maxY: pos.y + 2, minZ: pos.z - 2, maxZ: pos.z + 2 }),
    hurt: Mob.prototype.hurt,
  } as unknown as Mob;
};

const makeWorld = (mobs: Mob[], over: Partial<MobWorld> = {}) => {
  const hits: number[] = [];
  return Object.assign({
    hits,
    mobsNear: () => mobs,
    playerPos: () => new THREE.Vector3(0, 65, 200),
    playerEye: () => new THREE.Vector3(0, 66.6, 200),
    playerBox: () => ({ minX: -0.3, maxX: 0.3, minY: 65, maxY: 66.8, minZ: 199.7, maxZ: 200.3 }),
    playerTargetable: () => true,
    hurtPlayer: (d: number) => hits.push(d),
    rng: () => 0.5,
    getBlock: () => 0,
  }, over) as unknown as MobWorld & { hits: number[] };
};

describe('the crystals that keep the dragon up', () => {
  it('heals it while any still stand, and counts them for the shield', () => {
    const dragon = makeMob('ender_dragon');
    const crystals = [makeMob('end_crystal', 42, 100, 0), makeMob('end_crystal', -42, 100, 0)];
    const w = makeWorld([...crystals, dragon]);
    dragon.health = 150;
    const goal = dragonGoal();
    // vanilla gives it one health every ten ticks for as long as a crystal is left
    for (let i = 0; i < 40; i++) {
      dragon.age = i * 10;
      goal.tick(dragon, w);
    }
    expect(dragon.extra.crystals).toBe(2);
    expect(dragon.health).toBeGreaterThan(150);
    expect(dragonShielded(dragon)).toBe(true);
  });

  it('draws a beam from every crystal that is healing it, and lets it fade when they are gone', () => {
    const dragon = makeMob('ender_dragon');
    const crystal = makeMob('end_crystal', 42, 100, 0);
    const goal = dragonGoal();
    goal.tick(dragon, makeWorld([crystal, dragon]));
    expect(crystal.extra.beam).toBe(2);
    expect(crystal.extra.beamX).toBe(dragon.pos.x);
    // and with the crystals broken there is nothing left to draw, or to heal it
    crystal.dead = true;
    goal.tick(dragon, makeWorld([dragon]));
    expect(dragon.extra.crystals).toBe(0);
    expect(dragonShielded(dragon)).toBe(false);
  });
});

describe('hurting the dragon', () => {
  it('shrugs off everything while a crystal is still standing', () => {
    const dragon = makeMob('ender_dragon');
    dragon.extra.crystals = 1;
    expect(dragon.hurt(50, null, 'player')).toBe(false);
    expect(dragon.health).toBe(dragon.maxHealth);
  });

  it('takes the hit once they are all gone, and is never knocked about', () => {
    const dragon = makeMob('ender_dragon');
    dragon.extra.crystals = 0;
    expect(dragon.hurt(20, new THREE.Vector3(0, 78, 10), 'player')).toBe(true);
    expect(dragon.health).toBe(dragon.maxHealth - 20);
    expect(dragon.vel.length()).toBe(0);
  });
});

describe("the exit portal's podium", () => {
  const at = (list: ReturnType<typeof endPodium>, x: number, y: number, z: number) =>
    [...list].reverse().find((b) => b.x === x && b.y === y && b.z === z)?.id;

  it('lays out vanilla shape: a bedrock rim, the pillar and its four torches', () => {
    const p = endPodium(69, true);
    expect(at(p, 0, 68, 0)).toBe('bedrock'); // the disc under the podium
    expect(at(p, 3, 68, 0)).toBe('end_stone'); // and the rim's footing beside it
    expect(at(p, 3, 69, 0)).toBe('bedrock'); // the ring around the portal
    expect(at(p, 0, 69, 0)).toBe('bedrock'); // the pillar rises from the middle
    expect(at(p, 0, 72, 0)).toBe('bedrock');
    for (const [x, z, facing] of [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']] as [number, number, string][]) {
      const torch = [...p].reverse().find((b) => b.x === x && b.y === 71 && b.z === z);
      expect(torch?.id).toBe('wall_torch');
      expect(torch?.props?.facing).toBe(facing);
    }
    // and the ground over the fountain is cleared, in a dome that narrows as it climbs
    expect(at(p, 3, 70, 0)).toBe('air');
    expect(p.some((b) => b.x === 3 && b.y === 75)).toBe(false);
  });

  it('only fills the middle and lays the egg once the dragon has fallen', () => {
    const idle = endPodium(69, false);
    expect(at(idle, 1, 69, 0)).toBe('air');
    expect(idle.some((b) => b.id === 'dragon_egg')).toBe(false);
    const beaten = endPodium(69, true);
    expect(at(beaten, 1, 69, 0)).toBe('end_portal');
    expect(at(beaten, 2, 69, 0)).toBe('end_portal');
    expect(at(beaten, 0, 73, 0)).toBe('dragon_egg');
  });

  it('follows the podium up or down with the island under it', () => {
    const low = endPodium(60, true);
    expect(at(low, 0, 64, 0)).toBe('dragon_egg');
    expect(at(low, 1, 60, 0)).toBe('end_portal');
  });
});
