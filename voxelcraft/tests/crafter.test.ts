import { describe, expect, it } from 'vitest';
import { craftOnce, crafterResult, crafterSlotFor, toggleSlot } from '../src/blocks/crafter.ts';
import { createBlockEntity, type CrafterEntity } from '../src/blocks/blockEntity.ts';

const crafter = (): CrafterEntity => createBlockEntity('crafter') as CrafterEntity;

describe('crafter', () => {
  it('crafts what its pattern makes, and takes one from every slot that helped', () => {
    const e = crafter();
    e.items[4] = { id: 'oak_log', count: 3 };
    expect(crafterResult(e)).toMatchObject({ id: 'oak_planks', count: 4 });
    expect(craftOnce(e)).toMatchObject({ id: 'oak_planks', count: 4 });
    expect(e.items[4]).toMatchObject({ count: 2 });
  });

  it('reads a shaped recipe from the grid', () => {
    const e = crafter();
    for (const i of [0, 1, 3, 4]) e.items[i] = { id: 'oak_planks', count: 1 };
    expect(crafterResult(e)).toMatchObject({ id: 'crafting_table', count: 1 });
    craftOnce(e);
    expect(e.items.every((s) => s === null)).toBe(true);
  });

  it('leaves a switched-off slot out of the pattern', () => {
    const e = crafter();
    e.items[4] = { id: 'oak_log', count: 1 };
    expect(toggleSlot(e, 0)).toBe(true);
    expect(e.disabled[0]).toBe(true);
    expect(crafterResult(e)).toMatchObject({ id: 'oak_planks' });
    // a slot with something in it cannot be switched off
    expect(toggleSlot(e, 4)).toBe(false);
  });

  it('has nothing to make from an empty grid or a pattern that means nothing', () => {
    const e = crafter();
    expect(crafterResult(e)).toBeNull();
    e.items[0] = { id: 'diamond', count: 1 };
    e.items[8] = { id: 'stone', count: 1 };
    expect(crafterResult(e)).toBeNull();
    expect(craftOnce(e)).toBeNull();
  });

  it('sends an item pushed in to the emptiest slot that is switched on', () => {
    const e = crafter();
    e.items[0] = { id: 'stick', count: 3 };
    e.items[1] = { id: 'stick', count: 1 };
    e.disabled[2] = true;
    expect(crafterSlotFor(e, { id: 'stick', count: 1 })).toBe(3); // an empty slot beats a filled one
    for (let i = 3; i < 9; i++) e.items[i] = { id: 'stick', count: 2 };
    expect(crafterSlotFor(e, { id: 'stick', count: 1 })).toBe(1); // then the one with the fewest
    expect(crafterSlotFor(e, { id: 'diamond', count: 1 })).toBe(-1); // nowhere for a different item
  });
});
