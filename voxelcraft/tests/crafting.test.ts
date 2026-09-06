import { describe, expect, it } from 'vitest';
import { CraftingMatcher, consumeIngredients, craftingMatcher, craftingRecipes, repairItems } from '../src/items/crafting.ts';
import type { Slot } from '../src/items/inventory.ts';
import { findCookingRecipe, fuelValue } from '../src/items/smelting.ts';
import { tickFurnace } from '../src/blocks/furnace.ts';
import { createBlockEntity, type FurnaceEntity } from '../src/blocks/blockEntity.ts';

const s = (id: string, count = 1): Slot => ({ id, count });
const grid2 = (...cells: (Slot | undefined)[]): Slot[] => Array.from({ length: 4 }, (_, i) => cells[i] ?? null);
const grid3 = (...cells: (Slot | undefined)[]): Slot[] => Array.from({ length: 9 }, (_, i) => cells[i] ?? null);

describe('crafting matcher', () => {
  it('matches shapeless planks from any log anywhere in the 2x2 grid', () => {
    expect(craftingMatcher.match(grid2(s('oak_log')), 2, 2)?.result).toEqual({ id: 'oak_planks', count: 4 });
    expect(craftingMatcher.match(grid2(null, null, null, s('birch_log')), 2, 2)?.result).toEqual({ id: 'birch_planks', count: 4 });
    expect(craftingMatcher.match(grid2(s('stripped_spruce_log')), 2, 2)?.result).toEqual({ id: 'spruce_planks', count: 4 });
  });

  it('matches shaped recipes with translation and mirroring', () => {
    expect(craftingMatcher.match(grid2(s('oak_planks'), s('oak_planks'), s('oak_planks'), s('oak_planks')), 2, 2)?.result).toEqual({ id: 'crafting_table', count: 1 });
    // sticks: two planks vertically, anywhere
    expect(craftingMatcher.match(grid2(null, s('oak_planks'), null, s('oak_planks')), 2, 2)?.result).toEqual({ id: 'stick', count: 4 });
    // pickaxe in a 3x3 grid
    expect(craftingMatcher.match(grid3(s('cobblestone'), s('cobblestone'), s('cobblestone'), null, s('stick'), null, null, s('stick'), null), 3, 3)?.result).toEqual({ id: 'stone_pickaxe', count: 1 });
    // axe is mirrored: both orientations craft
    const axeA = grid3(s('iron_ingot'), s('iron_ingot'), null, s('iron_ingot'), s('stick'), null, null, s('stick'), null);
    const axeB = grid3(null, s('iron_ingot'), s('iron_ingot'), null, s('stick'), s('iron_ingot'), null, s('stick'), null);
    expect(craftingMatcher.match(axeA, 3, 3)?.result.id).toBe('iron_axe');
    expect(craftingMatcher.match(axeB, 3, 3)?.result.id).toBe('iron_axe');
    // a 3-wide recipe can't be made in the 2x2 grid
    expect(craftingMatcher.match(grid2(s('cobblestone'), s('cobblestone'), s('cobblestone'), s('stick')), 2, 2)).toBeNull();
    // wrong shape
    expect(craftingMatcher.match(grid3(s('cobblestone'), s('cobblestone'), s('cobblestone'), s('stick'), null, null, s('stick'), null, null), 3, 3)?.result.id).not.toBe('stone_pickaxe');
  });

  it('consumes ingredients and leaves buckets behind', () => {
    const left = consumeIngredients(grid3(s('milk_bucket'), s('sugar', 2), s('egg'), s('wheat', 3)));
    expect(left[0]).toEqual({ id: 'bucket', count: 1 });
    expect(left[1]).toEqual({ id: 'sugar', count: 1 });
    expect(left[2]).toBeNull();
    expect(left[3]).toEqual({ id: 'wheat', count: 2 });
  });

  it('repairs two damaged tools', () => {
    const r = repairItems(grid2({ id: 'iron_pickaxe', count: 1, damage: 200 }, { id: 'iron_pickaxe', count: 1, damage: 200 }));
    expect(r).toEqual({ id: 'iron_pickaxe', count: 1, damage: 250 - Math.min(250, 50 + 50 + 12) });
    expect(repairItems(grid2(s('iron_pickaxe'), s('iron_pickaxe')))).toBeNull();
  });

  it('every crafting recipe is matchable from its own pattern', () => {
    const m = new CraftingMatcher();
    let checked = 0;
    for (const r of craftingRecipes) {
      if (r.type === 'shaped') {
        const grid: Slot[] = grid3();
        r.pattern!.forEach((row, y) => [...row].forEach((ch, x) => { if (ch !== ' ') grid[y * 3 + x] = s(Array.isArray(r.key![ch]) ? (r.key![ch] as string[])[0] : (r.key![ch] as string)); }));
        expect(m.match(grid, 3, 3)?.result.id, r.id).toBe(r.result.item);
        checked++;
      } else if (r.type === 'shapeless') {
        const grid: Slot[] = grid3();
        r.ingredients!.forEach((ing, i) => { grid[i] = s(Array.isArray(ing) ? ing[0] : ing); });
        expect(m.match(grid, 3, 3), r.id).not.toBeNull();
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(1000);
  });
});

describe('furnace', () => {
  it('smelts iron ore with coal at vanilla speed', () => {
    const f = createBlockEntity('furnace') as FurnaceEntity;
    f.items[0] = s('iron_ore', 2);
    f.items[1] = s('coal', 1);
    expect(fuelValue(s('coal'))).toBe(1600);
    expect(findCookingRecipe('furnace', s('iron_ore'))?.result.item).toBe('iron_ingot');
    let ticks = 0;
    while (!f.items[2] && ticks < 1000) {
      tickFurnace(f);
      ticks++;
    }
    expect(ticks).toBe(200);
    expect(f.items[2]).toEqual({ id: 'iron_ingot', count: 1 });
    expect(f.items[0]).toEqual({ id: 'iron_ore', count: 1 });
    expect(f.items[1]).toBeNull();
    expect(f.burnTime).toBe(1401); // the lighting tick does not consume fuel time, like vanilla
    while (f.items[0] && ticks < 1000) {
      tickFurnace(f);
      ticks++;
    }
    expect(f.items[2]).toEqual({ id: 'iron_ingot', count: 2 });
    expect(f.xp).toBeCloseTo(1.4);
  });

  it('blast furnace is twice as fast and refuses food', () => {
    const f = createBlockEntity('blast_furnace') as FurnaceEntity;
    f.items[0] = s('gold_ore');
    f.items[1] = s('oak_planks');
    let ticks = 0;
    while (!f.items[2] && ticks < 1000) { tickFurnace(f); ticks++; }
    expect(ticks).toBe(100);
    expect(findCookingRecipe('blast_furnace', s('beef'))).toBeNull();
    expect(findCookingRecipe('smoker', s('beef'))?.result.item).toBe('cooked_beef');
  });
});
