/**
 * Weather. Vanilla keeps two counters, one for rain and one for thunder, each running down to the
 * next change: clear spells last between half an hour and a day and a half, wet ones between ten
 * minutes and twenty, and a storm rumbles over a wet spell for between three and thirteen minutes.
 */
export type Weather = 'clear' | 'rain' | 'thunder';

export interface WeatherState {
  /** Ticks until the rain turns on or off. */
  rainTime: number;
  /** Ticks until the thunder turns on or off. */
  thunderTime: number;
  raining: boolean;
  thundering: boolean;
  /** 0 to 1, eased so the sky darkens rather than snapping. */
  rainLevel: number;
  thunderLevel: number;
}

const clearTime = (rng: () => number): number => Math.floor(rng() * 168000) + 12000;
const rainTime = (rng: () => number): number => Math.floor(rng() * 12000) + 12000;
const clearThunder = (rng: () => number): number => Math.floor(rng() * 168000) + 12000;
const thunderTime = (rng: () => number): number => Math.floor(rng() * 12000) + 3600;

export function newWeather(rng: () => number = Math.random): WeatherState {
  return { rainTime: clearTime(rng), thunderTime: clearThunder(rng), raining: false, thundering: false, rainLevel: 0, thunderLevel: 0 };
}

/** One tick of the sky: the counters run down and flip the weather when they reach nothing. */
export function tickWeather(w: WeatherState, rng: () => number = Math.random): void {
  if (--w.thunderTime <= 0) {
    w.thundering = !w.thundering;
    w.thunderTime = w.thundering ? thunderTime(rng) : clearThunder(rng);
  }
  if (--w.rainTime <= 0) {
    w.raining = !w.raining;
    w.rainTime = w.raining ? rainTime(rng) : clearTime(rng);
  }
  // vanilla eases both levels a step of a hundredth each tick
  w.rainLevel = Math.max(0, Math.min(1, w.rainLevel + (w.raining ? 0.01 : -0.01)));
  w.thunderLevel = Math.max(0, Math.min(1, w.thunderLevel + (w.thundering && w.raining ? 0.01 : -0.01)));
}

/** What the weather is, in a word. */
export function weatherOf(w: WeatherState): Weather {
  if (w.raining && w.thundering) return 'thunder';
  return w.raining ? 'rain' : 'clear';
}

/** Sets the weather outright, which is what the command does. */
export function setWeather(w: WeatherState, kind: Weather, ticks: number, rng: () => number = Math.random): void {
  const duration = ticks > 0 ? ticks : kind === 'clear' ? clearTime(rng) : rainTime(rng);
  w.raining = kind !== 'clear';
  w.thundering = kind === 'thunder';
  w.rainTime = duration;
  w.thunderTime = duration;
}

/** How dark the sky goes: vanilla takes off up to a third of the daylight in a storm. */
export const skyDarken = (w: WeatherState): number => 1 - w.rainLevel * 0.3125 - w.thunderLevel * 0.1;

/** How often lightning strikes near the player during a storm, as a chance per tick. */
export const LIGHTNING_CHANCE = 1 / 6000;

/** Vanilla's moon brightness by phase, which is what decides whether swamp slimes come out. */
const MOON_BRIGHTNESS = [1, 0.75, 0.5, 0.25, 0, 0.25, 0.5, 0.75];

export const moonPhase = (day: number): number => ((day % 8) + 8) % 8;

export const moonBrightness = (day: number): number => MOON_BRIGHTNESS[moonPhase(day)];
