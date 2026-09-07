import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { chestStates, chestTexture, isChestBlock } from '../src/blocks/chests.ts';

const JUNE = new Date('2026-06-01T12:00:00Z');
const CHRISTMAS = new Date('2026-12-25T12:00:00Z');

describe('chest rendering', () => {
  it('knows which blocks are drawn as chests', () => {
    expect(isChestBlock('chest')).toBe(true);
    expect(isChestBlock('trapped_chest')).toBe(true);
    expect(isChestBlock('ender_chest')).toBe(true);
    expect(isChestBlock('waxed_oxidized_copper_chest')).toBe(true);
    expect(isChestBlock('barrel')).toBe(false);
    expect(isChestBlock('chest_minecart')).toBe(false);
  });

  it('marks every state of every chest in the lookup', () => {
    for (const id of ['chest', 'trapped_chest', 'ender_chest', 'copper_chest', 'weathered_copper_chest']) {
      const def = blocks.get(id);
      for (let s = def.min; s <= def.max; s++) expect(chestStates[s]).toBe(1);
    }
    expect(chestStates[blocks.defaultState('barrel')]).toBe(0);
    expect(chestStates[0]).toBe(0);
  });

  it('picks vanilla’s texture for each kind and half', () => {
    expect(chestTexture('chest', 'single', JUNE)).toBe('chest/normal.png');
    expect(chestTexture('chest', 'left', JUNE)).toBe('chest/normal_left.png');
    expect(chestTexture('chest', 'right', JUNE)).toBe('chest/normal_right.png');
    expect(chestTexture('trapped_chest', 'left', JUNE)).toBe('chest/trapped_left.png');
    expect(chestTexture('ender_chest', 'single', JUNE)).toBe('chest/ender.png');
    expect(chestTexture('copper_chest', 'single', JUNE)).toBe('chest/copper.png');
    expect(chestTexture('waxed_exposed_copper_chest', 'right', JUNE)).toBe('chest/copper_exposed_right.png');
    expect(chestTexture('oxidized_copper_chest', 'single', JUNE)).toBe('chest/copper_oxidized.png');
  });

  it('wraps the plain chests up for Christmas, as vanilla does', () => {
    expect(chestTexture('chest', 'single', CHRISTMAS)).toBe('chest/christmas.png');
    expect(chestTexture('chest', 'left', CHRISTMAS)).toBe('chest/christmas_left.png');
    // the ender chest and the copper ones are never wrapped
    expect(chestTexture('ender_chest', 'single', CHRISTMAS)).toBe('chest/ender.png');
    expect(chestTexture('copper_chest', 'single', CHRISTMAS)).toBe('chest/copper.png');
  });
});
