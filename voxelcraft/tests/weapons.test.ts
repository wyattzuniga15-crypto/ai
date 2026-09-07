import { describe, expect, it } from 'vitest';
import { crossbowChargeTicks, hasChanneling, hasMultishot, impalingBonus, loyaltyLevel, maceDamage, piercingCount, riptideLevel, sweepingRatio, windBurstLift } from '../src/items/enchantEffects.ts';
import type { ItemStack } from '../src/items/inventory.ts';

const with_ = (id: string, enchantments: Record<string, number>): ItemStack => ({ id, count: 1, enchantments });

describe('the crossbow', () => {
  it('draws in vanilla\'s twenty-five ticks, five fewer for each level of Quick Charge', () => {
    expect(crossbowChargeTicks({ id: 'crossbow', count: 1 })).toBe(25);
    expect(crossbowChargeTicks(with_('crossbow', { quick_charge: 1 }))).toBe(20);
    expect(crossbowChargeTicks(with_('crossbow', { quick_charge: 3 }))).toBe(10);
    // never instant, however far the enchantment is pushed
    expect(crossbowChargeTicks(with_('crossbow', { quick_charge: 9 }))).toBeGreaterThan(0);
  });

  it('reads Multishot and Piercing off the bow', () => {
    expect(hasMultishot({ id: 'crossbow', count: 1 })).toBe(false);
    expect(hasMultishot(with_('crossbow', { multishot: 1 }))).toBe(true);
    expect(piercingCount({ id: 'crossbow', count: 1 })).toBe(0);
    expect(piercingCount(with_('crossbow', { piercing: 4 }))).toBe(4);
  });
});

describe('the mace', () => {
  it('does nothing extra on the ground or a short hop', () => {
    const mace: ItemStack = { id: 'mace', count: 1 };
    expect(maceDamage(mace, 0)).toBe(0);
    expect(maceDamage(mace, 1.5)).toBe(0);
  });

  it('adds vanilla\'s four a block, then two, then one', () => {
    const mace: ItemStack = { id: 'mace', count: 1 };
    expect(maceDamage(mace, 3)).toBeCloseTo(12, 5); // three blocks at four
    expect(maceDamage(mace, 8)).toBeCloseTo(12 + 10, 5); // five more at two
    expect(maceDamage(mace, 10)).toBeCloseTo(12 + 10 + 2, 5); // and a point a block after that
  });

  it('lets Density add half a point a level for every block fallen', () => {
    const plain = maceDamage({ id: 'mace', count: 1 }, 6);
    expect(maceDamage(with_('mace', { density: 4 }), 6)).toBeCloseTo(plain + 4 * 0.5 * 6, 5);
  });

  it('throws the wielder back up with Wind Burst, and not without it', () => {
    expect(windBurstLift({ id: 'mace', count: 1 })).toBe(0);
    expect(windBurstLift(with_('mace', { wind_burst: 1 }))).toBeGreaterThan(0);
    expect(windBurstLift(with_('mace', { wind_burst: 3 }))).toBeGreaterThan(windBurstLift(with_('mace', { wind_burst: 1 })));
  });
});

describe('the trident', () => {
  it('reads its own four enchantments', () => {
    expect(impalingBonus(with_('trident', { impaling: 4 }))).toBeCloseTo(10, 5);
    expect(impalingBonus({ id: 'trident', count: 1 })).toBe(0);
    expect(loyaltyLevel(with_('trident', { loyalty: 3 }))).toBe(3);
    expect(riptideLevel(with_('trident', { riptide: 2 }))).toBe(2);
    expect(hasChanneling(with_('trident', { channeling: 1 }))).toBe(true);
    expect(hasChanneling({ id: 'trident', count: 1 })).toBe(false);
  });
});

describe('the sword sweep', () => {
  it('passes on a share of the blow that grows with Sweeping Edge', () => {
    expect(sweepingRatio({ id: 'diamond_sword', count: 1 })).toBe(0);
    expect(sweepingRatio(with_('diamond_sword', { sweeping_edge: 1 }))).toBeCloseTo(0.5, 5);
    expect(sweepingRatio(with_('diamond_sword', { sweeping_edge: 3 }))).toBeCloseTo(0.75, 5);
  });
});
