import { describe, expect, it } from 'vitest';
import { smithingRecipes, smithingResult, stonecuttingRecipesFor } from '../src/ui/screens/workstations.ts';
import { trimMaterialForItem, trimMaterials, trimPattern, trimPatterns } from '../src/items/trims.ts';
import { items } from '../src/items/registry.ts';

describe('armor trims', () => {
  it('every trim recipe names a real pattern, template and materials', () => {
    for (const r of smithingRecipes.filter((r) => r.type === 'trim')) {
      expect(r.pattern, r.id).toBeTruthy();
      const p = trimPattern(r.pattern!);
      expect(p, r.id).toBeTruthy();
      expect(r.template).toBe(p!.template);
      expect(items.byId.has(p!.template), p!.template).toBe(true);
      for (const a of r.addition as string[]) expect(trimMaterialForItem(a), a).toBeTruthy();
    }
    expect(trimPatterns.length).toBe(18);
    expect(trimMaterials.length).toBe(11);
    for (const m of trimMaterials) expect(items.byId.has(m.item), m.item).toBe(true);
  });

  it('applies a trim and refuses the same trim twice', () => {
    const out = smithingResult({ id: 'bolt_armor_trim_smithing_template', count: 1 }, { id: 'iron_chestplate', count: 1, damage: 3 }, { id: 'lapis_lazuli', count: 1 });
    expect(out).toEqual({ id: 'iron_chestplate', count: 1, damage: 3, trim: { pattern: 'bolt', material: 'lapis' } });
    expect(smithingResult({ id: 'bolt_armor_trim_smithing_template', count: 1 }, out, { id: 'lapis_lazuli', count: 1 })).toBeNull();
    expect(smithingResult({ id: 'bolt_armor_trim_smithing_template', count: 1 }, out, { id: 'redstone', count: 1 })?.trim).toEqual({ pattern: 'bolt', material: 'redstone' });
    expect(smithingResult({ id: 'bolt_armor_trim_smithing_template', count: 1 }, { id: 'iron_sword', count: 1 }, { id: 'lapis_lazuli', count: 1 })).toBeNull();
  });

  it('upgrades diamond gear to netherite keeping enchantments and damage', () => {
    const out = smithingResult({ id: 'netherite_upgrade_smithing_template', count: 1 }, { id: 'diamond_sword', count: 1, damage: 10, enchantments: { sharpness: 3 } }, { id: 'netherite_ingot', count: 1 });
    expect(out).toEqual({ id: 'netherite_sword', count: 1, damage: 10, enchantments: { sharpness: 3 } });
    expect(smithingResult({ id: 'netherite_upgrade_smithing_template', count: 1 }, { id: 'iron_sword', count: 1 }, { id: 'netherite_ingot', count: 1 })).toBeNull();
    expect(smithingResult(null, { id: 'diamond_sword', count: 1 }, { id: 'netherite_ingot', count: 1 })).toBeNull();
  });
});

describe('stonecutter', () => {
  it('lists every stonecutting recipe for an input', () => {
    const stone = stonecuttingRecipesFor({ id: 'stone', count: 1 });
    const results = stone.map((r) => `${r.result.item}x${r.result.count}`);
    expect(results).toContain('stone_slabx2');
    expect(results).toContain('stone_stairsx1');
    expect(results).toContain('stone_bricksx1');
    expect(results).toContain('chiseled_stone_bricksx1');
    for (const r of stone) expect(items.byId.has(r.result.item), r.result.item).toBe(true);
    expect(stonecuttingRecipesFor({ id: 'dirt', count: 1 })).toEqual([]);
    expect(stonecuttingRecipesFor(null)).toEqual([]);
  });
});
