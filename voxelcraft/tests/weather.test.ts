import { describe, expect, it } from 'vitest';
import { LIGHTNING_CHANCE, moonBrightness, moonPhase, newWeather, setWeather, skyDarken, tickWeather, weatherOf } from '../src/world/weather.ts';
import { pickHostile } from '../src/entities/mobTypes.ts';
import { biomes } from '../src/world/biomes.ts';

/** A die that always rolls the same, so the counters are predictable. */
const fixed = (v: number) => () => v;

describe('weather', () => {
  it('starts clear, with a long wait before the first rain', () => {
    const w = newWeather(fixed(0));
    expect(weatherOf(w)).toBe('clear');
    expect(w.rainTime).toBe(12000);
    expect(w.raining).toBe(false);
  });

  it('turns the rain on when its counter runs out, and off again later', () => {
    const w = newWeather(fixed(0));
    w.rainTime = 1;
    tickWeather(w, fixed(0));
    expect(w.raining).toBe(true);
    expect(w.rainTime).toBe(12000); // a wet spell of its own length
    w.rainTime = 1;
    tickWeather(w, fixed(0));
    expect(w.raining).toBe(false);
  });

  it('eases the rain in and out rather than snapping', () => {
    const w = newWeather(fixed(0));
    setWeather(w, 'rain', 200);
    for (let i = 0; i < 50; i++) tickWeather(w, fixed(0.5));
    expect(w.rainLevel).toBeGreaterThan(0.4);
    expect(w.rainLevel).toBeLessThanOrEqual(0.51); // fifty ticks of a hundredth each
    setWeather(w, 'clear', 200);
    for (let i = 0; i < 100; i++) tickWeather(w, fixed(0.5));
    expect(w.rainLevel).toBe(0);
  });

  it('only thunders while it is also raining', () => {
    const w = newWeather(fixed(0));
    setWeather(w, 'thunder', 400);
    for (let i = 0; i < 30; i++) tickWeather(w, fixed(0.5));
    expect(weatherOf(w)).toBe('thunder');
    expect(w.thunderLevel).toBeGreaterThan(0);
    setWeather(w, 'clear', 400);
    for (let i = 0; i < 120; i++) tickWeather(w, fixed(0.5));
    expect(weatherOf(w)).toBe('clear');
    expect(w.thunderLevel).toBe(0);
  });

  it('darkens the sky as it comes down', () => {
    const w = newWeather(fixed(0));
    expect(skyDarken(w)).toBe(1);
    w.rainLevel = 1;
    expect(skyDarken(w)).toBeCloseTo(0.6875, 4);
    w.thunderLevel = 1;
    expect(skyDarken(w)).toBeCloseTo(0.5875, 4);
    expect(LIGHTNING_CHANCE).toBeGreaterThan(0);
  });
});

describe('the moon', () => {
  it('runs through vanilla’s eight phases', () => {
    expect(moonPhase(0)).toBe(0);
    expect(moonPhase(8)).toBe(0);
    expect(moonPhase(-1)).toBe(7);
    expect(moonBrightness(0)).toBe(1); // full
    expect(moonBrightness(4)).toBe(0); // new
    expect(moonBrightness(2)).toBe(0.5);
  });

  it('keeps swamp slimes in on a dark night', () => {
    const swamp = biomes.find((b) => b.category === 'swamp');
    expect(swamp).toBeTruthy();
    const rolls = [0.4, 0.4, 0.4, 0.4];
    const rng = (): number => rolls.shift() ?? 0.4;
    // a full moon lets them out
    expect(pickHostile(rng, swamp, 60, false, 1).startsWith('slime')).toBe(true);
    // a new moon never does
    let slimes = 0;
    for (let i = 0; i < 50; i++) if (pickHostile(Math.random, swamp, 60, false, 0).startsWith('slime')) slimes++;
    expect(slimes).toBe(0);
  });
});
