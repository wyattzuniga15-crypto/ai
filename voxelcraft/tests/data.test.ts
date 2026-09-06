import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { items } from '../src/items/registry.ts';
import crafting from '../data/recipes/crafting.json';
import smelting from '../data/recipes/smelting.json';
import blasting from '../data/recipes/blasting.json';
import smoking from '../data/recipes/smoking.json';
import campfire from '../data/recipes/campfire.json';
import stonecutting from '../data/recipes/stonecutting.json';
import smithing from '../data/recipes/smithing.json';
import summary from '../data/summary.json';
import { blockDrops } from '../src/items/loot.ts';
import { breakTicks, canHarvest } from '../src/blocks/mining.ts';

type Ingredient = string | string[];
const ingredientIds = (i: Ingredient): string[] => (Array.isArray(i) ? i : [i]);

describe('block registry', () => {
  it('contains the full 1.21.11 block list with contiguous vanilla state ids', () => {
    expect(blocks.defs.length).toBe(summary.blocks);
    expect(blocks.defs.length).toBe(1166);
    let next = 0;
    for (const d of blocks.defs) {
      expect(d.min).toBe(next);
      expect(d.max).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeGreaterThanOrEqual(d.min);
      expect(d.default).toBeLessThanOrEqual(d.max);
      const combos = d.states.reduce((a, s) => a * s.values.length, 1);
      expect(d.max - d.min + 1).toBe(combos);
      next = d.max + 1;
    }
    expect(blocks.AIR).toBe(0);
    for (const id of ['stone', 'grass_block', 'oak_log', 'diamond_ore', 'crafting_table', 'water', 'lava', 'bedrock', 'end_portal_frame', 'copper_chest', 'pale_oak_leaves']) expect(blocks.has(id)).toBe(true);
  });

  it('round-trips block state properties', () => {
    const s = blocks.stateWith('oak_stairs', { facing: 'east', half: 'top', shape: 'inner_left', waterlogged: 'true' });
    expect(blocks.props(s)).toEqual({ facing: 'east', half: 'top', shape: 'inner_left', waterlogged: 'true' });
    expect(blocks.idOf(s)).toBe('oak_stairs');
    expect(blocks.withProp(s, 'half', 'bottom')).toBe(blocks.stateWith('oak_stairs', { facing: 'east', half: 'bottom', shape: 'inner_left', waterlogged: 'true' }));
    // vanilla default oak_stairs state id is 3717 in 1.21.11
    expect(blocks.get('oak_stairs').default).toBe(3717);
    expect(blocks.props(3717)).toEqual({ facing: 'north', half: 'bottom', shape: 'straight', waterlogged: 'false' });
  });

  it('has hardness, tool and tier data for ores', () => {
    const d = blocks.get('diamond_ore');
    expect(d.hardness).toBe(3);
    expect(d.tool).toBe('pickaxe');
    expect(d.tier).toBe(2);
    expect(blocks.get('obsidian').tier).toBe(3);
    expect(blocks.get('stone').tier).toBe(0);
    expect(blocks.get('dirt').requiresTool).toBe(false);
  });
});

describe('item registry', () => {
  it('contains the full 1.21.11 item list', () => {
    expect(items.defs.length).toBe(summary.items);
    expect(items.defs.length).toBe(1505);
    for (const id of ['diamond_sword', 'netherite_pickaxe', 'elytra', 'mace', 'wind_charge', 'bundle', 'copper_sword', 'spyglass', 'goat_horn', 'brush', 'totem_of_undying', 'music_disc_pigstep']) expect(items.has(id)).toBe(true);
  });

  it('has tool, armor and food stats', () => {
    expect(items.get('diamond_pickaxe')).toMatchObject({ behavior: 'pickaxe', tier: 'diamond', tierLevel: 3, miningSpeed: 8, durability: 1561 });
    expect(items.get('diamond_sword').attack).toEqual({ damage: 7, speed: 1.6 });
    expect(items.get('iron_chestplate').armor).toMatchObject({ slot: 'chestplate', points: 6 });
    expect(items.get('cooked_beef').food).toMatchObject({ nutrition: 8, saturation: 12.8 });
    expect(items.get('golden_apple').food?.alwaysEdible).toBe(true);
    expect(items.get('oak_planks').block).toBe('oak_planks');
    expect(items.get('wheat_seeds').block).toBe('wheat');
  });
});

describe('recipes', () => {
  it('every crafting recipe resolves to real item ids', () => {
    expect(crafting.length).toBe(summary.recipes.crafting);
    for (const r of crafting as { id: string; type: string; result?: { item: string; count: number }; key?: Record<string, Ingredient>; ingredients?: Ingredient[]; input?: Ingredient; material?: Ingredient }[]) {
      expect(r.result, r.id).toBeDefined();
      expect(items.has(r.result!.item), `${r.id} -> ${r.result!.item}`).toBe(true);
      expect(r.result!.count).toBeGreaterThan(0);
      const ings: Ingredient[] = r.type === 'shaped' ? Object.values(r.key ?? {}) : r.type === 'shapeless' ? (r.ingredients ?? []) : [r.input!, r.material!];
      expect(ings.length).toBeGreaterThan(0);
      for (const ing of ings) for (const id of ingredientIds(ing)) expect(items.has(id), `${r.id} ingredient ${id}`).toBe(true);
    }
    const planks = (crafting as { id: string }[]).find((r) => r.id === 'oak_planks');
    expect(planks).toMatchObject({ type: 'shapeless', result: { item: 'oak_planks', count: 4 } });
    const table = (crafting as { id: string; pattern?: string[] }[]).find((r) => r.id === 'crafting_table');
    expect(table?.pattern).toEqual(['##', '##']);
  });

  it('cooking, stonecutting and smithing recipes resolve', () => {
    for (const [name, list] of Object.entries({ smelting, blasting, smoking, campfire })) {
      expect(list.length).toBe((summary.recipes as Record<string, number>)[name]);
      for (const r of list as { id: string; ingredient: Ingredient; result: { item: string }; cookingTime: number; experience: number }[]) {
        expect(items.has(r.result.item), r.id).toBe(true);
        for (const id of ingredientIds(r.ingredient)) expect(items.has(id), `${r.id} ${id}`).toBe(true);
        expect(r.cookingTime).toBeGreaterThan(0);
      }
    }
    const iron = (smelting as { id: string; cookingTime: number; experience: number }[]).find((r) => r.id === 'iron_ingot_from_smelting_iron_ore');
    expect(iron).toMatchObject({ cookingTime: 200, experience: 0.7 });
    for (const r of stonecutting as { id: string; ingredient: Ingredient; result: { item: string } }[]) {
      expect(items.has(r.result.item), r.id).toBe(true);
      for (const id of ingredientIds(r.ingredient)) expect(items.has(id), r.id).toBe(true);
    }
    for (const r of smithing as { id: string; type: string; base: Ingredient; template: Ingredient; addition: Ingredient; result?: { item: string } }[]) {
      if (r.result) expect(items.has(r.result.item), r.id).toBe(true);
      for (const ing of [r.base, r.template, r.addition]) for (const id of ingredientIds(ing)) expect(items.has(id), r.id).toBe(true);
    }
    expect((smithing as { id: string; type: string }[]).some((r) => r.id === 'netherite_sword_smithing' && r.type === 'transform')).toBe(true);
  });
});

describe('loot and mining', () => {
  const seq = (values: number[]) => {
    let i = 0;
    return () => values[i++ % values.length];
  };
  it('applies silk touch and fortune to ore drops', () => {
    expect(blockDrops(blocks.defaultState('stone'), null, seq([0.5]))).toEqual([{ id: 'cobblestone', count: 1 }]);
    expect(blockDrops(blocks.defaultState('stone'), { id: 'diamond_pickaxe', count: 1, enchantments: { silk_touch: 1 } }, seq([0.5]))).toEqual([{ id: 'stone', count: 1 }]);
    expect(blockDrops(blocks.defaultState('diamond_ore'), { id: 'iron_pickaxe', count: 1 }, seq([0.5]))).toEqual([{ id: 'diamond', count: 1 }]);
    const fortune = blockDrops(blocks.defaultState('diamond_ore'), { id: 'iron_pickaxe', count: 1, enchantments: { fortune: 3 } }, seq([0.99]));
    expect(fortune[0].id).toBe('diamond');
    expect(fortune[0].count).toBe(4);
    expect(blockDrops(blocks.defaultState('grass_block'), null, seq([0.5]))).toEqual([{ id: 'dirt', count: 1 }]);
    expect(blockDrops(blocks.defaultState('oak_leaves'), { id: 'shears', count: 1 }, seq([0.5]))).toEqual([{ id: 'oak_leaves', count: 1 }]);
  });

  it('computes vanilla break times', () => {
    const ctx = { onGround: true, inWater: false, creative: false };
    expect(breakTicks(blocks.defaultState('stone'), null, ctx)).toBe(150); // 7.5 s by hand
    expect(breakTicks(blocks.defaultState('stone'), { id: 'wooden_pickaxe', count: 1 }, ctx)).toBe(23); // 1.15 s
    expect(breakTicks(blocks.defaultState('stone'), { id: 'diamond_pickaxe', count: 1 }, ctx)).toBe(6); // 0.3 s
    expect(breakTicks(blocks.defaultState('obsidian'), { id: 'diamond_pickaxe', count: 1 }, ctx)).toBe(188); // 9.4 s
    expect(breakTicks(blocks.defaultState('obsidian'), { id: 'iron_pickaxe', count: 1 }, ctx)).toBe(834); // wrong tier
    expect(breakTicks(blocks.defaultState('bedrock'), { id: 'netherite_pickaxe', count: 1 }, ctx)).toBe(Infinity);
    expect(breakTicks(blocks.defaultState('oak_log'), { id: 'diamond_axe', count: 1 }, ctx)).toBe(8);
    expect(canHarvest(blocks.defaultState('diamond_ore'), { id: 'stone_pickaxe', count: 1 })).toBe(false);
    expect(canHarvest(blocks.defaultState('diamond_ore'), { id: 'iron_pickaxe', count: 1 })).toBe(true);
    expect(canHarvest(blocks.defaultState('dirt'), null)).toBe(true);
    expect(breakTicks(blocks.defaultState('stone'), null, { ...ctx, creative: true })).toBe(0);
  });
});
