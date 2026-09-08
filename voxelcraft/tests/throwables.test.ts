/**
 * The things a player throws by hand, and the eggs that spawn a mob rather than a chicken.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { Arrow, THROWN_GRAVITY, THROW_SPEED } from '../src/entities/arrow.ts';
import { items } from '../src/items/registry.ts';
import { blocks } from '../src/blocks/registry.ts';
import { mobStats } from '../src/entities/mobTypes.ts';
import { ENDERMITE_CHANCE, ENDER_EYE_LIFE, ENDER_EYE_SURVIVES, ENDER_PEARL_DAMAGE, SNOWBALL_BLAZE_DAMAGE, WIND_BURST_RADIUS, XP_BOTTLE_SPEED } from '../src/core/game.ts';

// the projectile builds a mesh, and there is no document here to load its texture into
beforeAll(() => {
  THREE.TextureLoader.prototype.load = function load() { return new THREE.Texture(); } as never;
});

/** A floor at y 0 and air everywhere else. */
const ground = { getBlock: (_x: number, y: number, _z: number) => (y < 0 ? blocks.defaultState('stone') : 0) };

const thrown = (dir: THREE.Vector3, speed = THROW_SPEED): Arrow => {
  const a = new Arrow('', new THREE.Vector3(0, 10, 0), dir, speed, 0, true);
  a.kind = 'thrown';
  a.vel.copy(dir).normalize().multiplyScalar(speed);
  return a;
};

describe('what a hand can throw', () => {
  it('knows which eggs are thrown and which are laid in the ground', () => {
    for (const id of ['snowball', 'egg', 'blue_egg', 'brown_egg', 'ender_pearl', 'ender_eye', 'wind_charge', 'experience_bottle', 'fire_charge']) {
      expect(items.byId.get(id)?.behavior, id).toBe('throwable');
    }
    // a turtle's and a sniffer's are blocks: they are placed, not thrown
    for (const id of ['turtle_egg', 'sniffer_egg']) {
      expect(items.byId.get(id)?.behavior, id).toBe('block');
      expect(items.byId.get(id)?.block, id).toBe(id);
      expect(blocks.has(id), id).toBe(true);
    }
    expect(items.byId.get('dragon_egg')?.behavior).toBe('block');
  });

  it("falls at vanilla's throwable gravity rather than an arrow's", () => {
    expect(THROWN_GRAVITY).toBe(0.03);
    expect(THROW_SPEED).toBe(1.5);
    expect(XP_BOTTLE_SPEED).toBe(0.7);
    const ball = thrown(new THREE.Vector3(0, 0, -1));
    const arrow = new Arrow('', new THREE.Vector3(0, 10, 0), new THREE.Vector3(0, 0, -1), THROW_SPEED, 1, true);
    for (let i = 0; i < 10; i++) {
      ball.tick(ground as never, null, () => {});
      arrow.tick(ground as never, null, () => {});
    }
    // the same launch, but the snowball is still higher after ten ticks
    expect(ball.pos.y).toBeGreaterThan(arrow.pos.y);
    expect(ball.vel.y).toBeCloseTo(arrow.vel.y + 0.02 * 10 * 0.99 ** 5, 1);
  });

  it('bursts on the first thing it touches instead of sticking in it', () => {
    let burst: THREE.Vector3 | null = null;
    const ball = thrown(new THREE.Vector3(0, -1, 0));
    ball.onSplash = (pos) => { burst = pos; };
    for (let i = 0; i < 40 && !ball.removed; i++) ball.tick(ground as never, null, () => {});
    expect(ball.removed).toBe(true);
    expect(burst).not.toBeNull();
    expect(burst!.y).toBeLessThan(1);
    expect(ball.stuck).toBe(false);
  });

  it('lets an eye of ender through the world and bursts it when its time is up', () => {
    let burst = 0;
    const eye = thrown(new THREE.Vector3(0, -1, 0));
    eye.ghost = true;
    eye.life = ENDER_EYE_LIFE;
    eye.onSplash = () => { burst++; };
    for (let i = 0; i < ENDER_EYE_LIFE + 5 && !eye.removed; i++) eye.tick(ground as never, null, () => {});
    expect(burst).toBe(1);
    expect(eye.removed).toBe(true);
    // it went straight through the floor rather than stopping on it
    expect(eye.pos.y).toBeLessThan(0);
    expect(ENDER_EYE_LIFE).toBe(80);
    expect(ENDER_EYE_SURVIVES).toBe(0.8);
  });

  it('carries the numbers vanilla gives each throw', () => {
    expect(ENDER_PEARL_DAMAGE).toBe(5);
    expect(ENDERMITE_CHANCE).toBeCloseTo(0.05, 5);
    expect(SNOWBALL_BLAZE_DAMAGE).toBe(3);
    expect(WIND_BURST_RADIUS).toBeGreaterThan(1);
  });
});

describe('spawn eggs', () => {
  it('names a mob the game has, every one of them', () => {
    const eggs = [...items.byId.values()].filter((i) => i.behavior === 'spawn_egg');
    expect(eggs.length).toBe(87);
    for (const egg of eggs) {
      const type = egg.id.replace(/_spawn_egg$/, '');
      expect(mobStats(type), egg.id).not.toBeNull();
    }
  });

  it('leaves nothing else looking like one', () => {
    for (const i of items.byId.values()) {
      if (i.id.endsWith('_spawn_egg')) expect(i.behavior, i.id).toBe('spawn_egg');
    }
  });
});
