import { describe, expect, it } from 'vitest';
import { anvilResult, compatible, countBookshelves, enchantById, enchantWithOption, enchantingOptions, grindstoneResult, selectEnchantments, supports } from '../src/items/enchanting.ts';
import { Rng } from '../src/core/rng.ts';

describe('enchanting table', () => {
  it('offers three options with rising costs and reveals an enchantment', () => {
    for (let seed = 1; seed < 40; seed++) {
      const opts = enchantingOptions(seed, 'diamond_sword', 15);
      expect(opts.length).toBe(3);
      expect(opts[2].cost).toBe(30);
      expect(opts[0].cost).toBeGreaterThanOrEqual(1);
      expect(opts[0].cost).toBeLessThanOrEqual(opts[1].cost);
      for (const o of opts) if (o.cost > 0) expect(o.hint).not.toBeNull();
      const applied = enchantWithOption(seed, 'diamond_sword', 15, 2);
      expect(applied.length).toBeGreaterThan(0);
      expect(applied[0]).toEqual(opts[2].hint);
      for (const a of applied) expect(supports(enchantById.get(a.id)!, 'diamond_sword')).toBe(true);
      for (const a of applied) for (const b of applied) if (a !== b) expect(compatible(a.id, b.id)).toBe(true);
    }
    expect(enchantingOptions(5, 'stone', 15).every((o) => o.cost === 0)).toBe(true);
    expect(enchantingOptions(5, 'diamond_sword', 0)[2].cost).toBeLessThanOrEqual(8);
  });

  it('selects level-appropriate enchantments', () => {
    const rng = new Rng(9);
    const list = selectEnchantments(rng, 'diamond_pickaxe', 30);
    expect(list.length).toBeGreaterThan(0);
    for (const e of list) {
      const def = enchantById.get(e.id)!;
      expect(e.level).toBeLessThanOrEqual(def.maxLevel);
      expect(def.treasure).toBe(false);
    }
    expect(selectEnchantments(new Rng(1), 'book', 1).length).toBeLessThanOrEqual(1);
  });

  it('counts bookshelves around the table', () => {
    const shelves = new Set<string>();
    for (let dx = -2; dx <= 2; dx++) for (let dz = -2; dz <= 2; dz++) if (Math.abs(dx) === 2 || Math.abs(dz) === 2) { shelves.add(`${dx},0,${dz}`); shelves.add(`${dx},1,${dz}`); }
    const world = (x: number, y: number, z: number) => (shelves.has(`${x},${y},${z}`) ? 'bookshelf' : 'air');
    expect(countBookshelves(world, 0, 0, 0)).toBe(15); // 32 shelves capped at 15
    // one wall of shelves only: 5 x 2 = 10, three of them blocked by a stone in the gap
    const wall = (x: number, y: number, z: number) => (x === 2 && (y === 0 || y === 1) && Math.abs(z) <= 2 ? 'bookshelf' : 'air');
    expect(countBookshelves(wall, 0, 0, 0)).toBe(10);
    const blocked = (x: number, y: number, z: number) => (x === 1 && z === 0 && y === 0 ? 'stone' : wall(x, y, z));
    expect(countBookshelves(blocked, 0, 0, 0)).toBe(7);
    expect(countBookshelves(() => 'air', 0, 0, 0)).toBe(0);
  });
});

describe('anvil', () => {
  it('repairs with materials, combines enchantments and charges vanilla costs', () => {
    const repair = anvilResult({ id: 'diamond_pickaxe', count: 1, damage: 1000 }, { id: 'diamond', count: 2 }, undefined);
    expect(repair.result?.damage).toBe(1000 - 2 * 390);
    expect(repair.cost).toBe(2);
    expect(repair.materialCost).toBe(2);
    const merge = anvilResult({ id: 'diamond_sword', count: 1, enchantments: { sharpness: 3 } }, { id: 'enchanted_book', count: 1, enchantments: { sharpness: 3, unbreaking: 2 } }, undefined);
    expect(merge.result?.enchantments).toEqual({ sharpness: 4, unbreaking: 2 });
    expect(merge.cost).toBe(4 + 2 * 1 + 0);
    expect(merge.result?.repairCost).toBe(1);
    const conflict = anvilResult({ id: 'diamond_sword', count: 1, enchantments: { sharpness: 1 } }, { id: 'enchanted_book', count: 1, enchantments: { smite: 1 } }, undefined);
    expect(conflict.result).toBeNull();
    const rename = anvilResult({ id: 'stick', count: 1 }, null, 'Pointy');
    expect(rename.result?.name).toBe('Pointy');
    expect(rename.cost).toBe(1);
    const nothing = anvilResult({ id: 'stick', count: 1 }, null, undefined);
    expect(nothing.result).toBeNull();
    const expensive = anvilResult({ id: 'diamond_sword', count: 1, repairCost: 63 }, { id: 'enchanted_book', count: 1, enchantments: { sharpness: 1 } }, undefined);
    expect(expensive.tooExpensive).toBe(true);
  });
});

describe('grindstone', () => {
  it('strips enchantments except curses and returns xp', () => {
    const r = grindstoneResult({ id: 'diamond_sword', count: 1, enchantments: { sharpness: 5, vanishing_curse: 1 } }, null);
    expect(r.result?.enchantments).toEqual({ vanishing_curse: 1 });
    expect(r.xp).toBeGreaterThan(0);
    const both = grindstoneResult({ id: 'iron_pickaxe', count: 1, damage: 200 }, { id: 'iron_pickaxe', count: 1, damage: 200 });
    expect(both.result?.damage).toBe(250 - Math.min(250, 50 + 50 + 12));
    expect(grindstoneResult({ id: 'stick', count: 1 }, null).result).toBeNull();
  });
});
