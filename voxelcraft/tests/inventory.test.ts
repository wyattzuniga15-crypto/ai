import { describe, expect, it } from 'vitest';
import { Inventory, cloneStack, stackable, type ItemStack } from '../src/items/inventory.ts';

describe('inventory', () => {
  it('stacks into existing slots then empty slots and respects max stack', () => {
    const inv = new Inventory();
    expect(inv.add({ id: 'cobblestone', count: 70 })).toBe(0);
    expect(inv.slots[0]).toEqual({ id: 'cobblestone', count: 64 });
    expect(inv.slots[1]).toEqual({ id: 'cobblestone', count: 6 });
    expect(inv.add({ id: 'cobblestone', count: 10 })).toBe(0);
    expect(inv.slots[1]).toEqual({ id: 'cobblestone', count: 16 });
    expect(inv.count('cobblestone')).toBe(80);
    expect(inv.add({ id: 'diamond_sword', count: 1 })).toBe(0);
    expect(inv.slots[2]).toEqual({ id: 'diamond_sword', count: 1 });
  });

  it('reports leftovers when full', () => {
    const inv = new Inventory();
    for (let i = 0; i < 36; i++) inv.slots[i] = { id: 'stone', count: 64 };
    expect(inv.add({ id: 'stone', count: 5 })).toBe(5);
    expect(inv.add({ id: 'dirt', count: 5 })).toBe(5);
  });

  it('removes and consumes', () => {
    const inv = new Inventory();
    inv.add({ id: 'oak_planks', count: 100 });
    expect(inv.remove('oak_planks', 70)).toBe(70);
    expect(inv.count('oak_planks')).toBe(30);
    inv.selected = 0;
    inv.consumeSelected(30);
    expect(inv.slots[0]).toBeNull();
  });

  it('damages tools and breaks them at zero durability', () => {
    const inv = new Inventory();
    inv.slots[0] = { id: 'wooden_pickaxe', count: 1, damage: 58 };
    expect(inv.damageSelected()).toBe(true);
    expect(inv.slots[0]).toBeNull();
  });

  it('serializes and restores', () => {
    const inv = new Inventory();
    inv.add({ id: 'stone', count: 3 });
    inv.armor[3] = { id: 'iron_helmet', count: 1, damage: 2 };
    const copy = new Inventory();
    copy.restore(JSON.parse(JSON.stringify(inv.serialize())));
    expect(copy.slots[0]).toEqual({ id: 'stone', count: 3 });
    expect(copy.armor[3]).toEqual({ id: 'iron_helmet', count: 1, damage: 2 });
  });

  it('keeps shulker box contents as an item component', () => {
    const box: ItemStack = { id: 'shulker_box', count: 1, contents: [{ id: 'stone', count: 5 }, null, { id: 'diamond', count: 2 }] };
    const copy = cloneStack(box);
    expect(copy).toEqual(box);
    expect(copy.contents).not.toBe(box.contents);
    expect(copy.contents![0]).not.toBe(box.contents![0]);
    expect(stackable(box, { id: 'shulker_box', count: 1 })).toBe(false);
    expect(stackable(box, cloneStack(box))).toBe(true);
  });
});
