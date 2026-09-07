/**
 * The brewing stand. Vanilla brews for 400 ticks at a time, burns one blaze powder for twenty
 * brews, and applies the ingredient to all three bottles at once.
 */
import { brew } from '../items/potions.ts';
import type { BrewingEntity } from './blockEntity.ts';

/** Ticks a brew takes, as vanilla times it. */
export const BREW_TICKS = 400;
/** Brews one piece of blaze powder is good for. */
export const FUEL_BREWS = 20;

/** Whether the stand could brew what is in it right now. */
export function canBrew(e: BrewingEntity): boolean {
  const ingredient = e.items[3];
  if (!ingredient || ingredient.count <= 0) return false;
  for (let i = 0; i < 3; i++) {
    const bottle = e.items[i];
    if (bottle && brew(bottle, ingredient.id)) return true;
  }
  return false;
}

/**
 * One tick of the stand: it takes fuel when it needs it, counts the brew down, and turns every
 * bottle it can when the time runs out. Returns true when something changed.
 */
export function tickBrewing(e: BrewingEntity): boolean {
  const ready = canBrew(e);
  let changed = false;
  if (ready && e.fuel <= 0) {
    const fuel = e.items[4];
    if (fuel && fuel.id === 'blaze_powder' && fuel.count > 0) {
      e.fuel = FUEL_BREWS;
      if (--fuel.count <= 0) e.items[4] = null;
      changed = true;
    }
  }
  if (!ready || e.fuel <= 0) {
    if (e.brewTime > 0) {
      e.brewTime = 0;
      changed = true;
    }
    return changed;
  }
  if (e.brewTime <= 0) {
    e.brewTime = BREW_TICKS;
    e.fuel--;
    return true;
  }
  if (--e.brewTime > 0) return true;
  // the brew is done: every bottle the ingredient works on turns at once
  const ingredient = e.items[3]!;
  for (let i = 0; i < 3; i++) {
    const bottle = e.items[i];
    if (!bottle) continue;
    const result = brew(bottle, ingredient.id);
    if (result) e.items[i] = result;
  }
  if (--ingredient.count <= 0) e.items[3] = null;
  return true;
}
