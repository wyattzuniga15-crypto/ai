import { describe, expect, it } from 'vitest';
import { addToBundle, BUNDLE_CAPACITY, bundleWeight, clearBundleSelection, cycleBundle, emptyBundle, fitsInBundle, isBundle, removeFromBundle, selectedIndex, shownIndex, unitWeight } from '../src/items/bundle.ts';
import { cloneStack, stackable, type ItemStack } from '../src/items/inventory.ts';
import { items } from '../src/items/registry.ts';
import { craftingRecipes } from '../src/items/crafting.ts';
import { tabOf } from '../src/items/creativeTabs.ts';

const bundle = (): ItemStack => ({ id: 'bundle', count: 1 });
const stack = (id: string, count: number): ItemStack => ({ id, count });

describe('bundle items', () => {
  it('ships all seventeen', () => {
    const all = items.defs.filter((d) => d.behavior === 'bundle');
    expect(all).toHaveLength(17);
    for (const d of all) expect(d.stack).toBe(1);
    expect(all.map((d) => d.id)).toContain('light_gray_bundle');
  });

  it('knows a bundle from anything else', () => {
    expect(isBundle('bundle')).toBe(true);
    expect(isBundle('red_bundle')).toBe(true);
    expect(isBundle('red_shulker_box')).toBe(false);
  });

  it('lists every one in tools and utilities', () => {
    for (const d of items.defs.filter((x) => x.behavior === 'bundle')) expect(tabOf(d)).toBe('tools_and_utilities');
  });
});

describe('weight', () => {
  it('weighs an item at sixty-four over its stack size', () => {
    expect(unitWeight('cobblestone')).toBe(1);
    expect(unitWeight('egg')).toBe(4);
    expect(unitWeight('saddle')).toBe(BUNDLE_CAPACITY);
  });

  it('adds a bundle up', () => {
    expect(bundleWeight([stack('cobblestone', 30), stack('egg', 2)])).toBe(38);
    expect(bundleWeight(undefined)).toBe(0);
  });

  it('keeps containers out of containers', () => {
    expect(fitsInBundle(stack('cobblestone', 1))).toBe(true);
    expect(fitsInBundle(stack('bundle', 1))).toBe(false);
    expect(fitsInBundle(stack('red_bundle', 1))).toBe(false);
    expect(fitsInBundle(stack('shulker_box', 1))).toBe(false);
    expect(fitsInBundle(stack('lime_shulker_box', 1))).toBe(false);
  });
});

describe('packing', () => {
  it('takes a full stack of a stacking item and no more', () => {
    const b = bundle();
    expect(addToBundle(b, stack('cobblestone', 64))).toBe(64);
    expect(bundleWeight(b.contents)).toBe(BUNDLE_CAPACITY);
    expect(addToBundle(b, stack('dirt', 1))).toBe(0);
  });

  it('takes sixteen of a sixteen-stack item, or one saddle', () => {
    const eggs = bundle();
    expect(addToBundle(eggs, stack('egg', 64))).toBe(16);
    const saddle = bundle();
    expect(addToBundle(saddle, stack('saddle', 1))).toBe(1);
    expect(addToBundle(saddle, stack('cobblestone', 1))).toBe(0);
  });

  it('takes part of a stack when only part of it fits', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 60));
    const eggs = stack('egg', 5);
    expect(addToBundle(b, eggs)).toBe(1); // four units of room, an egg weighs four
    expect(bundleWeight(b.contents)).toBe(BUNDLE_CAPACITY);
  });

  it('refuses a bundle and a shulker box', () => {
    const b = bundle();
    expect(addToBundle(b, stack('bundle', 1))).toBe(0);
    expect(addToBundle(b, stack('shulker_box', 1))).toBe(0);
    expect(b.contents ?? []).toHaveLength(0);
  });

  it('merges a matching entry and moves it to the front', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 10));
    addToBundle(b, stack('dirt', 10));
    addToBundle(b, stack('cobblestone', 5));
    expect(b.contents!.map((s) => `${s!.id}x${s!.count}`)).toEqual(['cobblestonex15', 'dirtx10']);
  });

  it('keeps a named stack apart from a plain one', () => {
    const b = bundle();
    addToBundle(b, { id: 'cobblestone', count: 4, name: 'Rubble' });
    addToBundle(b, stack('cobblestone', 4));
    expect(b.contents).toHaveLength(2);
    expect(stackable(b.contents![0]!, b.contents![1]!)).toBe(false);
    expect(bundleWeight(b.contents)).toBe(8);
  });

  it('is filled by one thing that stacks alone', () => {
    const b = bundle();
    expect(addToBundle(b, stack('diamond_sword', 1))).toBe(1);
    expect(bundleWeight(b.contents)).toBe(BUNDLE_CAPACITY);
    expect(addToBundle(b, stack('cobblestone', 1))).toBe(0);
  });
});

describe('unpacking', () => {
  it('gives back the newest thing first', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 10));
    addToBundle(b, stack('dirt', 3));
    expect(removeFromBundle(b)).toEqual({ id: 'dirt', count: 3 });
    expect(removeFromBundle(b)).toEqual({ id: 'cobblestone', count: 10 });
    expect(removeFromBundle(b)).toBeNull();
  });

  it('gives back whatever the bundle is showing', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 10));
    addToBundle(b, stack('dirt', 3));
    cycleBundle(b, 1);
    cycleBundle(b, 1);
    expect(shownIndex(b)).toBe(1);
    expect(removeFromBundle(b)!.id).toBe('cobblestone');
  });

  it('tips the whole lot out when it is used', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 10));
    addToBundle(b, stack('dirt', 3));
    const out = emptyBundle(b);
    expect(out.map((s) => s.id)).toEqual(['dirt', 'cobblestone']);
    expect(b.contents).toHaveLength(0);
    expect(emptyBundle(b)).toHaveLength(0);
  });
});

describe('what the bundle shows', () => {
  it('shows nothing until the wheel is turned', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 10));
    expect(shownIndex(b)).toBe(-1);
    expect(selectedIndex(b)).toBe(0); // with nothing shown, the front is what comes out
    cycleBundle(b, 1);
    expect(shownIndex(b)).toBe(0);
  });

  it('walks round and back', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 10));
    addToBundle(b, stack('dirt', 10));
    addToBundle(b, stack('sand', 10));
    cycleBundle(b, -1);
    expect(shownIndex(b)).toBe(2);
    cycleBundle(b, 1);
    expect(shownIndex(b)).toBe(0);
  });

  it('shuts again when the cursor leaves', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 10));
    cycleBundle(b, 1);
    expect(clearBundleSelection(b)).toBe(true);
    expect(shownIndex(b)).toBe(-1);
    expect(clearBundleSelection(b)).toBe(false);
  });

  it('shuts when something is packed away', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 10));
    cycleBundle(b, 1);
    addToBundle(b, stack('dirt', 1));
    expect(shownIndex(b)).toBe(-1);
  });

  it('has nothing to show when it is empty', () => {
    const b = bundle();
    expect(shownIndex(b)).toBe(-1);
    expect(selectedIndex(b)).toBe(-1);
    expect(cycleBundle(b, 1)).toBe(false);
  });
});

describe('a bundle keeps what it holds', () => {
  it('through a copy', () => {
    const b = bundle();
    addToBundle(b, stack('cobblestone', 10));
    const copy = cloneStack(b);
    expect(bundleWeight(copy.contents)).toBe(10);
    copy.contents![0]!.count = 1;
    expect(b.contents![0]!.count).toBe(10);
  });

  it('through a dye, which is what a transmute recipe is for', () => {
    const dyes = craftingRecipes.filter((r) => r.group === 'bundle_dye');
    expect(dyes).toHaveLength(16);
    for (const r of dyes) expect(r.type).toBe('transmute');
  });
});
