import { describe, expect, it } from 'vitest';
import { isHangingSign, isSignBlock, signWood } from '../src/blocks/signs.ts';
import { createBlockEntity } from '../src/blocks/blockEntity.ts';

describe('signs', () => {
  it('counts every sign, hanging ones included', () => {
    for (const id of ['oak_sign', 'oak_wall_sign', 'oak_hanging_sign', 'oak_wall_hanging_sign', 'bamboo_hanging_sign']) {
      expect(isSignBlock(id)).toBe(true);
    }
    expect(isSignBlock('oak_planks')).toBe(false);
  });

  it('knows a hanging sign from a standing one', () => {
    expect(isHangingSign('oak_hanging_sign')).toBe(true);
    expect(isHangingSign('oak_wall_hanging_sign')).toBe(true);
    expect(isHangingSign('oak_sign')).toBe(false);
  });

  it('takes the wood from any of the four kinds', () => {
    expect(signWood('oak_sign')).toBe('oak');
    expect(signWood('dark_oak_wall_sign')).toBe('dark_oak');
    expect(signWood('cherry_hanging_sign')).toBe('cherry');
    expect(signWood('pale_oak_wall_hanging_sign')).toBe('pale_oak');
  });

  it('gives a hanging sign the block entity that holds its text', () => {
    const e = createBlockEntity('spruce_hanging_sign');
    expect(e?.type).toBe('sign');
    expect((e as { lines: string[] }).lines).toHaveLength(4);
  });
});
