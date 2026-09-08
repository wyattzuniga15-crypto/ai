/**
 * The seven spears: the damage, wear and swing Mojang's own behaviour files give them, and the
 * reach that is what a spear has instead of a sword's damage.
 */
import { describe, expect, it } from 'vitest';
import { items } from '../src/items/registry.ts';
import { MELEE_REACH, SPEAR_REACH, TOTEM, TOTEM_ABSORPTION, TOTEM_FIRE_RESISTANCE, TOTEM_REGENERATION } from '../src/core/constants.ts';
import { tabOf } from '../src/items/creativeTabs.ts';

const SPEARS = ['wooden', 'stone', 'copper', 'iron', 'golden', 'diamond', 'netherite'].map((t) => `${t}_spear`);

describe('the spears', () => {
  it('is all seven tiers, one of each', () => {
    const all = items.defs.filter((d) => d.behavior === 'spear');
    expect(all.map((d) => d.id).sort()).toEqual([...SPEARS].sort());
    for (const d of all) expect(d.stack, d.id).toBe(1);
  });

  it('carries Mojang\'s own damage and wear', () => {
    const expected: Record<string, [damage: number, durability: number]> = {
      wooden_spear: [1, 60], stone_spear: [2, 130], copper_spear: [2, 190], iron_spear: [3, 250],
      golden_spear: [1, 30], diamond_spear: [4, 1560], netherite_spear: [5, 2030],
    };
    for (const [id, [damage, durability]] of Object.entries(expected)) {
      const def = items.get(id);
      expect(def.attack, id).toBeDefined();
      expect(def.attack!.damage, id).toBe(damage);
      expect(def.durability, id).toBe(durability);
    }
  });

  it('swings at the reciprocal of the cooldown its file gives', () => {
    // 0.65s on a wooden one up to 1.15s on a netherite one, written as attacks a second
    expect(items.get('wooden_spear').attack!.speed).toBeCloseTo(1 / 0.65, 3);
    expect(items.get('iron_spear').attack!.speed).toBeCloseTo(1 / 0.95, 3);
    expect(items.get('netherite_spear').attack!.speed).toBeCloseTo(1 / 1.15, 3);
    // the better the spear the slower the swing, which is the trade vanilla makes
    const speeds = SPEARS.filter((id) => id !== 'golden_spear').map((id) => items.get(id).attack!.speed);
    for (let i = 1; i < speeds.length; i++) expect(speeds[i], SPEARS[i]).toBeLessThan(speeds[i - 1]);
  });

  it('hits softer than the sword of its own tier, and reaches further', () => {
    for (const t of ['wooden', 'stone', 'iron', 'diamond', 'netherite']) {
      expect(items.get(`${t}_spear`).attack!.damage, t).toBeLessThan(items.get(`${t}_sword`).attack!.damage);
    }
    expect(SPEAR_REACH).toBeGreaterThan(MELEE_REACH);
    expect(SPEAR_REACH).toBe(4.5);
    expect(MELEE_REACH).toBe(3);
  });

  it('takes an enchantment, and its tier is known', () => {
    for (const id of SPEARS) {
      const def = items.get(id);
      expect(def.enchantability, id).toBeGreaterThan(0);
      expect(def.tier, id).toBe(id.slice(0, -6));
      expect(def.repair, id).toBeTruthy();
    }
    // the golden one takes an enchantment best of all, as gold always does
    expect(items.get('golden_spear').enchantability).toBe(22);
    expect(items.get('stone_spear').enchantability).toBe(5);
  });

  it('is listed with the weapons', () => {
    for (const id of SPEARS) expect(tabOf(items.get(id)), id).toBe('combat');
  });
});

describe('the totem of undying', () => {
  it('carries Mojang\'s own three blessings, in ticks', () => {
    expect(TOTEM).toBe('totem_of_undying');
    expect(items.has(TOTEM)).toBe(true);
    expect(items.get(TOTEM).stack).toBe(1);
    // regeneration for forty-five seconds, fire resistance for forty, absorption for five
    expect(TOTEM_REGENERATION).toBe(900);
    expect(TOTEM_FIRE_RESISTANCE).toBe(800);
    expect(TOTEM_ABSORPTION).toBe(100);
    expect(tabOf(items.get(TOTEM))).toBe('combat');
  });
});
