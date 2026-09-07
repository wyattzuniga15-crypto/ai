import { describe, it, expect } from 'vitest';
import { arrowEffects, potionDisplayName, brew } from '../src/items/potions.ts';
import { tippedArrows, craftingMatcher } from '../src/items/crafting.ts';
import type { ItemStack, Slot } from '../src/items/inventory.ts';

const tip = (potion?: string): ItemStack => ({ id: 'tipped_arrow', count: 1, ...(potion ? { potion } : {}) });

describe('arrowEffects', () => {
  it('gives a spectral arrow vanilla\'s ten seconds of glowing', () => {
    expect(arrowEffects({ id: 'spectral_arrow', count: 1 })).toEqual([{ id: 'glowing', ticks: 200 }]);
  });

  it('leaves a plain arrow with nothing', () => {
    expect(arrowEffects({ id: 'arrow', count: 1 })).toEqual([]);
  });

  it('carries a tipped arrow\'s potion at an eighth of the bottle\'s duration', () => {
    // Potion of Poison lasts 45s; on an arrow that is 45 * 20 / 8 = 112 ticks
    expect(arrowEffects(tip('poison'))).toEqual([{ id: 'poison', ticks: 112, amplifier: 0 }]);
  });

  it('carries every effect a potion has', () => {
    const both = arrowEffects(tip('turtle_master')).map((e) => e.id);
    expect(both).toEqual(['slowness', 'resistance']);
  });
});

describe('tipped arrow items', () => {
  it('is named for the arrow, not the bottle', () => {
    expect(potionDisplayName(tip('poison'))).toBe('Arrow of Poison');
    expect(potionDisplayName(tip())).toBe('Tipped Arrow');
    expect(potionDisplayName({ id: 'potion', count: 1, potion: 'poison' })).toBe('Potion of Poison');
  });

  it('cannot be brewed further: arrows are tipped at a crafting table', () => {
    expect(brew(tip('poison'), 'redstone')).toBeNull();
    expect(brew({ id: 'potion', count: 1, potion: 'poison' }, 'redstone')?.potion).toBe('long_poison');
  });
});

describe('tippedArrows recipe', () => {
  const arrow: Slot = { id: 'arrow', count: 1 };
  const grid = (middle: Slot): Slot[] => [arrow, arrow, arrow, arrow, middle, arrow, arrow, arrow, arrow];

  it('tips eight arrows with the lingering potion in the middle', () => {
    const out = tippedArrows(grid({ id: 'lingering_potion', count: 1, potion: 'strong_healing' }), 3, 3);
    expect(out).toEqual({ id: 'tipped_arrow', count: 8, potion: 'strong_healing' });
  });

  it('needs all eight arrows and a lingering potion', () => {
    const short = grid({ id: 'lingering_potion', count: 1, potion: 'poison' });
    short[8] = null;
    expect(tippedArrows(short, 3, 3)).toBeNull();
    expect(tippedArrows(grid({ id: 'splash_potion', count: 1, potion: 'poison' }), 3, 3)).toBeNull();
    expect(tippedArrows(grid({ id: 'lingering_potion', count: 1 }), 2, 2)).toBeNull();
  });

  it('is found by the crafting matcher', () => {
    const m = craftingMatcher.match(grid({ id: 'lingering_potion', count: 1, potion: 'poison' }), 3, 3);
    expect(m?.recipe.id).toBe('tipped_arrow');
    expect(m?.result).toEqual({ id: 'tipped_arrow', count: 8, potion: 'poison' });
  });
});
