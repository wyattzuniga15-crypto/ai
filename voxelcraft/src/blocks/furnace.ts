/** Furnace, blast furnace and smoker simulation (vanilla timings). */
import type { FurnaceEntity } from './blockEntity.ts';
import { findCookingRecipe, fuelValue } from '../items/smelting.ts';
import { items } from '../items/registry.ts';
import { cloneStack } from '../items/inventory.ts';

/** Advances the furnace by one tick. Returns whether the lit state changed. */
export function tickFurnace(e: FurnaceEntity): { changed: boolean; litChanged: boolean } {
  const wasLit = e.burnTime > 0;
  let changed = false;
  if (e.burnTime > 0) {
    e.burnTime--;
    changed = true;
  }
  const input = e.items[0];
  const recipe = findCookingRecipe(e.type, input);
  const output = e.items[2];
  const canCook = !!recipe && (!output || (output.id === recipe.result.item && output.count + recipe.result.count <= items.maxStack(output.id)));
  if (e.burnTime <= 0 && canCook) {
    const fuel = e.items[1];
    const value = fuelValue(fuel);
    if (fuel && value > 0) {
      e.burnTime = value;
      e.burnTotal = value;
      if (fuel.id === 'lava_bucket') e.items[1] = { id: 'bucket', count: 1 };
      else {
        fuel.count--;
        if (fuel.count <= 0) e.items[1] = null;
      }
      changed = true;
    }
  }
  if (e.burnTime > 0 && canCook && recipe) {
    e.cookTotal = recipe.cookingTime;
    e.cookTime++;
    if (e.cookTime >= e.cookTotal) {
      e.cookTime = 0;
      if (output) output.count += recipe.result.count;
      else e.items[2] = { id: recipe.result.item, count: recipe.result.count };
      input!.count--;
      if (input!.count <= 0) e.items[0] = null;
      e.xp += recipe.experience;
    }
    changed = true;
  } else if (e.cookTime > 0) {
    e.cookTime = Math.max(0, e.cookTime - 2);
    changed = true;
  }
  return { changed, litChanged: wasLit !== e.burnTime > 0 };
}

/** Takes the stored experience (whole points, keeping the fraction for later). */
export function takeFurnaceXp(e: FurnaceEntity): number {
  const whole = Math.floor(e.xp);
  const frac = e.xp - whole;
  e.xp = frac;
  return whole + (Math.random() < frac ? 1 : 0) - (Math.random() < frac ? 1 : 0) * 0;
}

export { cloneStack as _cloneStack };
