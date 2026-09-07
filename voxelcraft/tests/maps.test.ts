import { describe, expect, it } from 'vitest';
import { MAP_SIZE, blocksPerPixel, createMap, deserializeMap, fillAround, pixelFor, serializeMap, worldFor } from '../src/world/maps.ts';
import { SHADES, shade } from '../src/render/mapColors.ts';

/** A world where the ground steps up as x grows, so shading has something to shade. */
const sample = {
  color: (x: number, z: number): number => (x < -400 || x > 400 ? -1 : 0x40a040),
  height: (x: number): number => 64 + Math.floor(x / 8),
};

describe('maps', () => {
  it('centres a new map the way vanilla centres one', () => {
    // vanilla's squares run from -64 to 63 around each multiple of 128
    expect(createMap(0, 5, 5).cx).toBe(0);
    expect(createMap(1, 50, -30).cx).toBe(0);
    expect(createMap(2, 100, 0).cx).toBe(128);
    expect(createMap(3, -200, 0).cx).toBe(-256);
    expect(createMap(4, 5, 5).cz).toBe(0);
  });

  it('turns positions into pixels and back', () => {
    const map = createMap(0, 0, 0);
    const middle = pixelFor(map, map.cx, map.cz);
    expect(middle).toEqual({ px: 64, pz: 64 });
    const back = worldFor(map, 64, 64);
    expect(back).toEqual({ x: map.cx, z: map.cz });
    expect(pixelFor(map, map.cx + 500, map.cz)).toBeNull();
  });

  it('covers more ground at every scale', () => {
    expect(blocksPerPixel(0)).toBe(1);
    expect(blocksPerPixel(4)).toBe(16);
    const wide = createMap(0, 0, 0, 2);
    const far = pixelFor(wide, wide.cx + 200, wide.cz);
    expect(far).not.toBeNull();
  });

  it('fills in the ground around a position and shades it by the step', () => {
    const map = createMap(0, 0, 0);
    const drawn = fillAround(map, sample, map.cx, map.cz, 8, shade);
    expect(drawn).toBeGreaterThan(200);
    const middle = map.colors[64 * MAP_SIZE + 64];
    expect(middle).toBeGreaterThan(0);
    // ground that steps up toward the south is drawn brighter than flat ground
    const shades = new Set([shade(0x40a040, 0), shade(0x40a040, 1), shade(0x40a040, 2), shade(0x40a040, 3)]);
    expect(shades.has(middle)).toBe(true);
    expect(SHADES).toHaveLength(4);
  });

  it('leaves a locked map alone', () => {
    const map = createMap(0, 0, 0);
    map.locked = true;
    expect(fillAround(map, sample, map.cx, map.cz, 8, shade)).toBe(0);
    expect(map.colors.every((c) => c === -1)).toBe(true);
  });

  it('saves and loads without losing what was drawn', () => {
    const map = createMap(7, 0, 0, 2);
    fillAround(map, sample, map.cx, map.cz, 16, shade);
    const back = deserializeMap(serializeMap(map));
    expect(back.id).toBe(7);
    expect(back.scale).toBe(2);
    expect(back.cx).toBe(map.cx);
    expect([...back.colors]).toEqual([...map.colors]);
  });
});
