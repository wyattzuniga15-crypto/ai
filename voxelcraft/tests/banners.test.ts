import { describe, expect, it } from 'vitest';
import { LOOM_PATTERNS, MAX_LAYERS, PATTERN_ITEMS, bannerColor, dyeColor, isBanner, loomResult } from '../src/items/banners.ts';
import { cloneStack, stackable } from '../src/items/inventory.ts';

const banner = (color = 'white', layers?: { pattern: string; color: string }[]) => ({ id: `${color}_banner`, count: 1, ...(layers ? { banner: layers } : {}) });

describe('the loom', () => {
  it('weaves the pattern that is picked, in the colour of the dye', () => {
    const woven = loomResult(banner(), { id: 'red_dye', count: 3 }, null, 'stripe_bottom');
    expect(woven).toMatchObject({ id: 'white_banner', banner: [{ pattern: 'stripe_bottom', color: 'red' }] });
  });

  it('adds to what is already woven, up to vanilla’s six', () => {
    const layers = LOOM_PATTERNS.slice(1, 6).map((pattern) => ({ pattern, color: 'blue' }));
    const five = loomResult(banner('white', layers), { id: 'lime_dye', count: 1 }, null, 'circle');
    expect(five?.banner).toHaveLength(MAX_LAYERS);
    expect(loomResult(five!, { id: 'lime_dye', count: 1 }, null, 'circle')).toBeNull();
  });

  it('needs the pattern item for the patterns vanilla keeps behind one', () => {
    expect(loomResult(banner(), { id: 'blue_dye', count: 1 }, null, 'creeper')).toBeNull();
    const withItem = loomResult(banner(), { id: 'blue_dye', count: 1 }, { id: 'creeper_banner_pattern', count: 1 }, null);
    expect(withItem?.banner).toEqual([{ pattern: 'creeper', color: 'blue' }]);
    expect(PATTERN_ITEMS.globe_banner_pattern).toBe('globe');
  });

  it('makes nothing without a banner or without a dye', () => {
    expect(loomResult(null, { id: 'red_dye', count: 1 }, null, 'circle')).toBeNull();
    expect(loomResult(banner(), null, null, 'circle')).toBeNull();
    expect(loomResult({ id: 'stone', count: 1 }, { id: 'red_dye', count: 1 }, null, 'circle')).toBeNull();
    expect(loomResult(banner(), { id: 'stone', count: 1 }, null, 'circle')).toBeNull();
  });

  it('knows banners, their base colours and the dyes', () => {
    expect(isBanner('cyan_banner')).toBe(true);
    expect(isBanner('banner')).toBe(false);
    expect(bannerColor('light_blue_banner')).toBe('light_blue');
    expect(dyeColor('magenta_dye')).toBe('magenta');
    expect(dyeColor('bone_meal')).toBeNull();
  });
});

describe('stacks carrying more than an id', () => {
  it('keeps potions, pages and patterns when copied', () => {
    const copy = cloneStack({ id: 'white_banner', count: 1, banner: [{ pattern: 'circle', color: 'red' }] });
    expect(copy.banner).toEqual([{ pattern: 'circle', color: 'red' }]);
    const book = cloneStack({ id: 'written_book', count: 1, pages: ['one', 'two'], author: 'Player' });
    expect(book.pages).toEqual(['one', 'two']);
    expect(cloneStack({ id: 'potion', count: 1, potion: 'swiftness' }).potion).toBe('swiftness');
  });

  it('does not stack two bottles or banners that differ', () => {
    expect(stackable({ id: 'potion', count: 1, potion: 'water' }, { id: 'potion', count: 1, potion: 'healing' })).toBe(false);
    expect(stackable(banner('white', [{ pattern: 'circle', color: 'red' }]), banner('white'))).toBe(false);
    expect(stackable(banner('white'), banner('white'))).toBe(true);
  });
});
