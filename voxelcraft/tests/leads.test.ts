/**
 * Name tags and leads: which mobs take one, how far a lead stretches before it snaps, and the
 * rainbow a sheep called jeb_ wears.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { JEB_NAME, JEB_PERIOD, LEASH_BREAK, LEASH_FORCE, LEASH_PULL, LeashLine, NAME_PLATE_LIFT, jebColor } from '../src/entities/nameplate.ts';
import { UNTAGGABLE, canBeLeashed, canBeNamed, mobStats } from '../src/entities/mobTypes.ts';
import { items } from '../src/items/registry.ts';

beforeAll(() => {
  THREE.TextureLoader.prototype.load = function load() { return new THREE.Texture(); } as never;
});

describe('name tags and leads', () => {
  it('are items the game knows about', () => {
    expect(items.byId.get('name_tag')?.behavior).toBe('name_tag');
    expect(items.byId.get('lead')?.behavior).toBe('lead');
  });

  it('work on every mob but the two bosses and the crystal', () => {
    expect(UNTAGGABLE).toEqual(['ender_dragon', 'wither', 'end_crystal']);
    for (const type of ['cow', 'sheep', 'zombie', 'copper_golem', 'nautilus', 'villager']) {
      expect(canBeNamed(type), type).toBe(true);
      expect(canBeLeashed(type), type).toBe(true);
    }
    for (const type of UNTAGGABLE) {
      expect(canBeNamed(type), type).toBe(false);
      expect(canBeLeashed(type), type).toBe(false);
    }
    expect(canBeNamed('not_a_mob')).toBe(false);
    // and every one of them really is a mob the game has
    for (const type of UNTAGGABLE) expect(mobStats(type), type).not.toBeNull();
  });

  it("stretches to six blocks before it pulls and ten before it snaps", () => {
    expect(LEASH_PULL).toBe(6);
    expect(LEASH_BREAK).toBe(10);
    expect(LEASH_PULL).toBeLessThan(LEASH_BREAK);
    expect(LEASH_FORCE).toBeGreaterThan(0);
    expect(NAME_PLATE_LIFT).toBeGreaterThan(0);
  });

  it('strings a cord between two points that sags in the middle', () => {
    const line = new LeashLine(8);
    const from = new THREE.Vector3(0, 10, 0);
    const to = new THREE.Vector3(6, 10, 0);
    line.update(from, to);
    const pos = line.line.geometry.attributes.position as THREE.BufferAttribute;
    expect(pos.count).toBe(9);
    // the ends are where they were put
    expect(pos.getX(0)).toBeCloseTo(0, 5);
    expect(pos.getX(8)).toBeCloseTo(6, 5);
    expect(pos.getY(0)).toBeCloseTo(10, 5);
    expect(pos.getY(8)).toBeCloseTo(10, 5);
    // and the middle hangs below them
    expect(pos.getY(4)).toBeLessThan(10);
    line.dispose();
  });

  it('runs a jeb_ sheep through all sixteen dyes and back to where it started', () => {
    expect(JEB_NAME).toBe('jeb_');
    const span = 16 * JEB_PERIOD;
    expect(jebColor(0)).toBe(jebColor(span));
    expect(jebColor(0)).toBe(0xf9fffe); // it starts on white, as vanilla's list does
    // every colour it passes through is a real one, and it never sits still
    const seen = new Set<number>();
    for (let t = 0; t < span; t += 5) seen.add(jebColor(t));
    expect(seen.size).toBeGreaterThan(50);
    // halfway between two dyes it is a blend of them rather than either
    const mid = jebColor(Math.floor(JEB_PERIOD / 2));
    expect(mid).not.toBe(jebColor(0));
    expect(mid).not.toBe(jebColor(JEB_PERIOD));
    // and it is the same colour whichever way the clock has wrapped
    expect(jebColor(-span + 7)).toBe(jebColor(7));
  });
});
