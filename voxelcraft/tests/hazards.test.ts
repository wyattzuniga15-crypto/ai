/**
 * The ways the world hurts, and what armour is worth against each of them. Vanilla sorts damage
 * into what a chestplate helps with and what it does not, and the two lists are not the same.
 */
import { describe, expect, it } from 'vitest';
import { armorApplies, type DamageSource } from '../src/items/enchantEffects.ts';
import { createBlockEntity } from '../src/blocks/blockEntity.ts';
import { findCookingRecipe } from '../src/items/smelting.ts';

describe('what armour is worth', () => {
  it('counts against fire, lava and the blows that come at you', () => {
    for (const source of ['fire', 'explosion', 'projectile', 'generic'] as DamageSource[]) {
      expect([source, armorApplies(source)]).toEqual([source, true]);
    }
  });

  it('counts for nothing against the things vanilla lets straight through', () => {
    // `bypasses_armor`: a long drop, a lungful of water, an empty stomach, a wall, the cold, the void
    for (const source of ['fall', 'drown', 'starve', 'wall', 'freeze', 'void', 'magic'] as DamageSource[]) {
      expect([source, armorApplies(source)]).toEqual([source, false]);
    }
  });
});

describe('the campfire', () => {
  it('has somewhere to put the four things vanilla lets it hold', () => {
    const e = createBlockEntity('campfire');
    expect(e?.type).toBe('campfire');
    expect(e && 'items' in e ? e.items.length : 0).toBe(4);
    expect(createBlockEntity('soul_campfire')?.type).toBe('campfire');
  });

  it('knows what a campfire cooks, and how long it takes over one', () => {
    const beef = findCookingRecipe('campfire', { id: 'beef', count: 1 });
    expect(beef?.result.item).toBe('cooked_beef');
    expect(beef?.cookingTime).toBe(600); // vanilla's thirty seconds
    expect(findCookingRecipe('campfire', { id: 'iron_ore', count: 1 })).toBeNull();
  });
});
