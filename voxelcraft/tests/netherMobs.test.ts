import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { blocks } from '../src/blocks/registry.ts';
import { biomeById } from '../src/world/biomes.ts';
import { Mob, type MobWorld } from '../src/entities/mob.ts';
import { BARTER_ITEM, BARTER_TICKS, mobStats, pickNether } from '../src/entities/mobTypes.ts';
import { barterLoot } from '../src/items/loot.ts';
import { blazeGoal, ghastGoal, piglinAngerGoal, striderGoal } from '../src/entities/ai.ts';

const makeMob = (type: string, at = new THREE.Vector3(0, 64, 0)): Mob => {
  const def = mobStats(type)!;
  return {
    def, extra: {}, health: def.health, dead: false, removed: false, age: 100, lastHurtTime: -1000,
    inWater: false, target: null as Mob['target'], moveTarget: null, lookTarget: null, moveSpeed: 1, moveTimeout: 0,
    pos: at, vel: new THREE.Vector3(),
    eyePos: () => at.clone().setY(at.y + def.eyeHeight),
    distanceTo: (v: THREE.Vector3) => at.distanceTo(v),
  } as unknown as Mob;
};

function makeWorld(over: Partial<MobWorld> = {}) {
  const shots: number[] = [];
  const sounds: string[] = [];
  return Object.assign({
    shots, sounds,
    playerPos: () => new THREE.Vector3(0, 64, 8),
    playerEye: () => new THREE.Vector3(0, 65.6, 8),
    playerTargetable: () => true,
    playerWearsGold: () => false,
    lineOfSight: () => true,
    shootArrow: (_f: THREE.Vector3, _t: THREE.Vector3, _v: number, d: number) => shots.push(d),
    playSound: (n: string) => sounds.push(n),
    rng: () => 0.5,
    getBlock: () => 0,
    hurtPlayer: () => {},
  }, over) as unknown as MobWorld & { shots: number[]; sounds: string[] };
}

describe('nether mobs', () => {
  it('are fireproof, and the strider walks on its lava', () => {
    for (const id of ['zombified_piglin', 'blaze', 'ghast', 'strider', 'magma_cube', 'zoglin']) expect(mobStats(id)?.fireproof).toBe(true);
    expect(mobStats('strider')?.walksOnLava).toBe(true);
    expect(mobStats('piglin')?.fireproof).toBeUndefined(); // piglins burn like anything else
    expect(mobStats('zombie')?.fireproof).toBeUndefined();
  });

  it('carry vanilla\'s stats', () => {
    expect(mobStats('piglin')?.health).toBe(16);
    expect(mobStats('piglin_brute')?.health).toBe(50);
    expect(mobStats('hoglin')?.health).toBe(40);
    expect(mobStats('blaze')?.health).toBe(20);
    expect(mobStats('ghast')?.health).toBe(10);
    expect(mobStats('magma_cube_big')?.health).toBe(16);
    expect(mobStats('ghast')?.scale).toBe(4.5);
  });
});

describe('nether spawning', () => {
  it('gives each biome the mobs vanilla gives it', () => {
    const roll = (biome: string) => {
      const seen = new Set<string>();
      let n = 0;
      for (let i = 0; i < 400; i++) seen.add(pickNether(() => ((n = (n * 9301 + 49297) % 233280) / 233280), biomeById(biome)));
      return seen;
    };
    expect([...roll('crimson_forest')].every((m) => ['hoglin', 'piglin', 'zombified_piglin'].includes(m))).toBe(true);
    expect([...roll('warped_forest')].every((m) => ['enderman', 'strider'].includes(m))).toBe(true);
    const wastes = roll('nether_wastes');
    expect(wastes.has('zombified_piglin')).toBe(true);
    expect(wastes.has('ghast')).toBe(true);
    // magma cubes come out in one of vanilla's three sizes
    const deltas = roll('basalt_deltas');
    expect([...deltas].some((m) => m.startsWith('magma_cube'))).toBe(true);
  });
});

describe('piglins', () => {
  it('take offence at a player with no gold on', () => {
    const m = makeMob('piglin');
    const goal = piglinAngerGoal();
    const w = makeWorld();
    expect(goal.canUse(m, w)).toBe(true);
    goal.tick(m, w);
    expect(m.target).toBe('player');
  });

  it('leave a player wearing gold alone, until they are hit', () => {
    const m = makeMob('piglin');
    const goal = piglinAngerGoal();
    expect(goal.canUse(m, makeWorld({ playerWearsGold: () => true }))).toBe(false);
    m.lastHurtTime = m.age; // vanilla: hitting one ends the truce
    expect(goal.canUse(m, makeWorld({ playerWearsGold: () => true }))).toBe(true);
  });

  it('needs to see them at all', () => {
    const m = makeMob('piglin');
    expect(piglinAngerGoal().canUse(m, makeWorld({ lineOfSight: () => false }))).toBe(false);
    const far = makeMob('piglin', new THREE.Vector3(0, 64, 90));
    expect(piglinAngerGoal().canUse(far, makeWorld())).toBe(false);
  });
});

describe('blaze and ghast', () => {
  it('the blaze shoots vanilla\'s round of three, then pauses', () => {
    const m = makeMob('blaze');
    m.target = 'player';
    const goal = blazeGoal();
    const w = makeWorld();
    for (let i = 0; i < 60; i++) goal.tick(m, w);
    expect(w.shots.length).toBe(3);
    expect(w.shots[0]).toBe(mobStats('blaze')!.damage);
    for (let i = 0; i < 60; i++) goal.tick(m, w);
    expect(w.shots.length).toBe(6); // the next round
  });

  it('the blaze holds its fire without a target or a clear line', () => {
    const m = makeMob('blaze');
    const goal = blazeGoal();
    const idle = makeWorld();
    for (let i = 0; i < 60; i++) goal.tick(m, idle);
    expect(idle.shots.length).toBe(0);
    m.target = 'player';
    const blind = makeWorld({ lineOfSight: () => false });
    for (let i = 0; i < 60; i++) goal.tick(m, blind);
    expect(blind.shots.length).toBe(0);
  });

  it('the ghast charges before it spits, and warns as it does', () => {
    const m = makeMob('ghast');
    m.target = 'player';
    const goal = ghastGoal();
    const w = makeWorld();
    for (let i = 0; i < 39; i++) goal.tick(m, w);
    expect(w.shots.length).toBe(0);
    expect(w.sounds).toContain('ghast_warn');
    goal.tick(m, w);
    expect(w.shots.length).toBe(1);
    expect(m.extra.charge).toBe(0);
  });
});

describe('striders', () => {
  it('stay on the lava they live on', () => {
    const lava = blocks.defaultState('lava');
    const m = makeMob('strider');
    const w = makeWorld({ getBlock: () => lava });
    striderGoal().tick(m, w);
    expect(m.extra.cold).toBe(false);
    expect(m.moveTarget).not.toBeNull();
  });

  it('shiver when they end up ashore', () => {
    const m = makeMob('strider');
    striderGoal().tick(m, makeWorld({ getBlock: () => blocks.defaultState('netherrack') }));
    expect(m.extra.cold).toBe(true);
  });
});

describe('bartering', () => {
  it('takes the gold ingot vanilla asks for, for the eight seconds it admires it', () => {
    expect(BARTER_ITEM).toBe('gold_ingot');
    expect(BARTER_TICKS).toBe(160);
  });

  it('always hands something back, and only things off the bartering table', () => {
    // an enchanted book, not a plain one: `enchant_randomly` upgrades it on the way out
    const allowed = new Set(['enchanted_book', 'iron_boots', 'potion', 'splash_potion', 'fire_charge', 'ender_pearl',
      'string', 'quartz', 'obsidian', 'crying_obsidian', 'soul_sand', 'nether_brick', 'spectral_arrow',
      'gravel', 'blackstone', 'leather', 'iron_nugget', 'dried_ghast']);
    let rolls = 0;
    for (let i = 0; i < 400; i++) {
      const seed = i;
      const got = barterLoot(mulberry(seed));
      expect(got.length).toBeGreaterThan(0);
      for (const s of got) {
        expect(allowed.has(s.id)).toBe(true);
        expect(s.count).toBeGreaterThan(0);
        rolls++;
      }
    }
    expect(rolls).toBe(400); // one pool roll, so exactly one thing comes back each time
  });

  it('gives the common junk far more often than the treasure', () => {
    const counts = new Map<string, number>();
    for (let i = 0; i < 4000; i++) for (const s of barterLoot(mulberry(i + 9000))) counts.set(s.id, (counts.get(s.id) ?? 0) + 1);
    // gravel is weight 40, an ender pearl weight 10: the junk has to come up several times as often
    expect(counts.get('gravel') ?? 0).toBeGreaterThan(counts.get('ender_pearl') ?? 0);
    expect(counts.get('iron_boots') ?? 0).toBeGreaterThan(0);
  });
});

/** A small deterministic generator, so the rolls above are the same on every run. */
function mulberry(seed: number): () => number {
  let a = seed + 0x6d2b79f5;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
