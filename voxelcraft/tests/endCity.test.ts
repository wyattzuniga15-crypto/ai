import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.ts';
import { assembleEndCity } from '../src/world/gen/endCity.ts';

const city = (seed: number) => assembleEndCity(new Rng(seed), 0, 70, 0);

describe('an end city', () => {
  it('always starts with vanilla\'s base tower under whatever grows out of it', () => {
    for (let s = 0; s < 40; s++) {
      const pieces = city(s);
      expect(pieces.slice(0, 4).map((p) => p.name)).toEqual(['base_floor', 'second_floor_1', 'third_floor_1', 'third_roof']);
      // and the whole tower turns together
      const rot = pieces[0].rotation;
      for (const p of pieces.slice(0, 4)) expect(p.rotation).toBe(rot);
    }
  });

  it('shells its floors around each other at vanilla\'s own offsets', () => {
    const pieces = city(7);
    const [base, second, third, roof] = pieces;
    // vanilla's floors are shells rather than storeys, and each offset is read from the last piece:
    // the second one starts level with the base, the third four higher and the roof eight above that
    expect(second.y).toBe(base.y);
    expect(third.y).toBe(second.y + 4);
    expect(roof.y).toBe(third.y + 8);
    // and each is two blocks wider than the last, so it sits a block back on both sides
    expect([second.x - base.x, second.z - base.z]).toEqual([-1, -1]);
    expect([third.x - second.x, third.z - second.z]).toEqual([-1, -1]);
  });

  it('grows towers, bridges and at most one ship', () => {
    let ships = 0;
    let towers = 0;
    let bridges = 0;
    for (let s = 0; s < 60; s++) {
      const pieces = city(s);
      const n = pieces.filter((p) => p.name === 'ship').length;
      expect(n).toBeLessThanOrEqual(1);
      ships += n;
      towers += pieces.filter((p) => p.name === 'tower_base').length;
      bridges += pieces.filter((p) => p.name.startsWith('bridge')).length;
    }
    expect(ships).toBeGreaterThan(0);
    expect(towers).toBeGreaterThan(0);
    expect(bridges).toBeGreaterThan(0);
  });

  it('reads a piece\'s footprint from the corner it turns about', () => {
    // a turned city runs backwards from its anchor, so the corner the stamper is given moves with it
    for (let s = 0; s < 80; s++) {
      const pieces = city(s);
      for (const p of pieces) {
        expect(p.x).toBe(p.box.x0);
        expect(p.y).toBe(p.box.y0);
        expect(p.z).toBe(p.box.z0);
        expect(p.box.x1).toBeGreaterThan(p.box.x0);
        expect(p.box.z1).toBeGreaterThan(p.box.z0);
      }
    }
  });

  it('stays inside the reach the chunk stamper allows it', () => {
    for (let s = 0; s < 400; s++)
      for (const p of city(s)) {
        expect(Math.abs(p.box.x0)).toBeLessThan(12 * 16);
        expect(Math.abs(p.box.x1)).toBeLessThan(12 * 16);
        expect(Math.abs(p.box.z0)).toBeLessThan(12 * 16);
        expect(Math.abs(p.box.z1)).toBeLessThan(12 * 16);
      }
  });

  it('builds the same city twice from the same seed', () => {
    expect(JSON.stringify(city(99))).toBe(JSON.stringify(city(99)));
  });
});
