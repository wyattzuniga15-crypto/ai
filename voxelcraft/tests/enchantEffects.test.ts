import { describe, expect, it } from 'vitest';
import { bowBaseDamage, bowCharge, depthStriderFactor, fireAspectTicks, hasCurse, hasFlame, hasInfinity, mendingTarget, protectionFactor, punchKnockback, respirationTicks, thornsDamage, weaponBonus } from '../src/items/enchantEffects.ts';
import type { Slot } from '../src/items/inventory.ts';

const piece = (id: string, enchantments: Record<string, number>): Slot => ({ id, count: 1, enchantments });

describe('armour enchantments', () => {
  it('takes four percent off for every point of protection', () => {
    const suit = [piece('diamond_boots', { protection: 4 }), piece('diamond_leggings', { protection: 4 }), null, null];
    expect(protectionFactor(suit, 'generic')).toBeCloseTo(0.32, 5);
  });

  it('counts the specialised protections double, and feather falling triple', () => {
    const fire = [piece('iron_helmet', { fire_protection: 2 }), null, null, null];
    expect(protectionFactor(fire, 'fire')).toBeCloseTo(0.16, 5);
    expect(protectionFactor(fire, 'generic')).toBe(0);
    const boots = [piece('iron_boots', { feather_falling: 4 }), null, null, null];
    expect(protectionFactor(boots, 'fall')).toBeCloseTo(0.48, 5);
    const blast = [piece('iron_chestplate', { blast_protection: 3 }), null, null, null];
    expect(protectionFactor(blast, 'explosion')).toBeCloseTo(0.24, 5);
  });

  it('never takes off more than vanilla’s eighty percent, and nothing at all in the void', () => {
    const suit = new Array(4).fill(piece('netherite_helmet', { protection: 10 }));
    expect(protectionFactor(suit, 'generic')).toBeCloseTo(0.8, 5);
    expect(protectionFactor(suit, 'void')).toBe(0);
  });

  it('pays hurt back with thorns, on vanilla’s odds', () => {
    const suit = [piece('diamond_chestplate', { thorns: 3 }), null, null, null];
    expect(thornsDamage(suit, () => 0.9)).toBe(0); // 15% a level, so a high roll misses
    expect(thornsDamage(suit, () => 0)).toBeGreaterThan(0);
    expect(thornsDamage([null, null, null, null], () => 0)).toBe(0);
  });
});

describe('weapon and bow enchantments', () => {
  it('adds sharpness against anything and smite only against the undead', () => {
    const sword = piece('diamond_sword', { sharpness: 3 });
    expect(weaponBonus(sword, 'cow')).toBeCloseTo(2, 5);
    const smiting = piece('diamond_sword', { smite: 4 });
    expect(weaponBonus(smiting, 'zombie')).toBe(10);
    expect(weaponBonus(smiting, 'cow')).toBe(0);
    const bane = piece('iron_sword', { bane_of_arthropods: 2 });
    expect(weaponBonus(bane, 'spider')).toBe(5);
    expect(weaponBonus(bane, 'creeper')).toBe(0);
  });

  it('sets a mob alight for four seconds a level of fire aspect', () => {
    expect(fireAspectTicks(piece('iron_sword', { fire_aspect: 2 }))).toBe(160);
    expect(fireAspectTicks(null)).toBe(0);
  });

  it('draws a bow the way vanilla draws one', () => {
    expect(bowCharge(0)).toBe(0);
    expect(bowCharge(20)).toBe(1);
    expect(bowCharge(10)).toBeCloseTo(0.4167, 3);
    // the arrow's own speed multiplies this, so a full draw of a plain bow lands six
    expect(bowBaseDamage(null)).toBe(2);
    expect(bowBaseDamage(piece('bow', { power: 5 }))).toBe(5);
    expect(punchKnockback(piece('bow', { punch: 2 }))).toBe(2);
    expect(hasFlame(piece('bow', { flame: 1 }))).toBe(true);
    expect(hasInfinity(piece('bow', {}))).toBe(false);
  });
});

describe('the rest of the gear', () => {
  it('mends the damaged piece that carries mending', () => {
    const worn = piece('diamond_pickaxe', { mending: 1 })!;
    worn.damage = 40;
    expect(mendingTarget([worn, null])).toBe(worn);
    expect(mendingTarget([piece('diamond_pickaxe', {}), null])).toBeNull();
    const fresh = piece('diamond_axe', { mending: 1 });
    expect(mendingTarget([fresh])).toBeNull(); // nothing to mend
  });

  it('reads the curses vanilla puts on gear', () => {
    expect(hasCurse(piece('iron_helmet', { binding_curse: 1 }), 'binding')).toBe(true);
    expect(hasCurse(piece('iron_helmet', { vanishing_curse: 1 }), 'vanishing')).toBe(true);
    expect(hasCurse(piece('iron_helmet', {}), 'binding')).toBe(false);
  });

  it('speeds a swimmer up and stretches a diver’s breath', () => {
    expect(depthStriderFactor(piece('boots', { depth_strider: 3 }))).toBe(1);
    expect(depthStriderFactor(piece('boots', { depth_strider: 1 }))).toBeCloseTo(1 / 3, 5);
    expect(respirationTicks(piece('helmet', { respiration: 3 }))).toBe(900);
  });
});
