import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { createBlockEntity, type BlockEntity, type ContainerEntity, type FurnaceEntity } from '../src/blocks/blockEntity.ts';
import { containerAt, insertOne, tickHopper, HOPPER_COOLDOWN, type HopperWorld } from '../src/world/hopper.ts';

/** Blocks and their contents in a map, which is all a hopper needs to see. */
class Bench implements HopperWorld {
  readonly blocksAt = new Map<string, number>();
  readonly entities = new Map<string, BlockEntity>();
  rolls: number[] = [];

  getBlock(x: number, y: number, z: number): number {
    return this.blocksAt.get(`${x},${y},${z}`) ?? 0;
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    if (state === 0) this.blocksAt.delete(`${x},${y},${z}`);
    else this.blocksAt.set(`${x},${y},${z}`, state);
  }

  getBlockEntity(x: number, y: number, z: number): BlockEntity | null {
    return this.entities.get(`${x},${y},${z}`) ?? null;
  }

  setBlockEntity(x: number, y: number, z: number, e: BlockEntity): void {
    this.entities.set(`${x},${y},${z}`, e);
  }

  markModified(): void {}

  random(): number {
    return this.rolls.length ? this.rolls.shift()! : 0;
  }

  /** Puts a block down with its container, and returns the container. */
  put(x: number, y: number, z: number, id: string, props: Record<string, string> = {}): ContainerEntity | FurnaceEntity {
    this.setBlock(x, y, z, Object.keys(props).length ? blocks.stateWith(id, props) : blocks.defaultState(id));
    const e = createBlockEntity(id) as ContainerEntity | FurnaceEntity;
    if (e) this.setBlockEntity(x, y, z, e);
    return e;
  }

  /** Runs a hopper until it has moved `n` items, or given up. */
  run(x: number, y: number, z: number, ticks: number, powered = false): number {
    const e = this.getBlockEntity(x, y, z) as ContainerEntity;
    let moves = 0;
    for (let i = 0; i < ticks; i++) if (tickHopper(this, x, y, z, e, powered)) moves++;
    return moves;
  }
}

const ids = (slots: (null | { id: string; count: number })[]): string[] => slots.filter(Boolean).map((s) => `${s!.id}x${s!.count}`);

describe('hoppers', () => {
  it('pulls from the chest above and pushes into the one it faces', () => {
    const b = new Bench();
    const above = b.put(0, 2, 0, 'chest') as ContainerEntity;
    const hopper = b.put(0, 1, 0, 'hopper', { facing: 'down', enabled: 'true' }) as ContainerEntity;
    const below = b.put(0, 0, 0, 'chest') as ContainerEntity;
    above.items[0] = { id: 'diamond', count: 3 };

    b.run(0, 1, 0, 40);
    expect(ids(above.items)).toEqual([]);
    expect(ids(below.items)).toEqual(['diamondx3']);
    expect(ids(hopper.items)).toEqual([]);
  });

  it('waits eight ticks between moves, as vanilla times it', () => {
    const b = new Bench();
    const above = b.put(0, 2, 0, 'chest') as ContainerEntity;
    b.put(0, 1, 0, 'hopper', { facing: 'down', enabled: 'true' });
    b.put(0, 0, 0, 'chest');
    above.items[0] = { id: 'stone', count: 64 };
    const moves = b.run(0, 1, 0, HOPPER_COOLDOWN * 4);
    expect(moves).toBe(4);
  });

  it('stops while it is held by a signal', () => {
    const b = new Bench();
    const above = b.put(0, 2, 0, 'chest') as ContainerEntity;
    b.put(0, 1, 0, 'hopper', { facing: 'down', enabled: 'false' });
    b.put(0, 0, 0, 'chest');
    above.items[0] = { id: 'stone', count: 8 };
    expect(b.run(0, 1, 0, 40, true)).toBe(0);
    expect(ids(above.items)).toEqual(['stonex8']);
  });

  it('feeds a furnace its input from above and its fuel from the side', () => {
    const b = new Bench();
    const furnace = b.put(0, 0, 0, 'furnace', { facing: 'north', lit: 'false' }) as FurnaceEntity;

    const top = b.put(0, 2, 0, 'chest') as ContainerEntity;
    const down = b.put(0, 1, 0, 'hopper', { facing: 'down', enabled: 'true' }) as ContainerEntity;
    top.items[0] = { id: 'raw_iron', count: 2 };
    b.run(0, 1, 0, 40);
    expect(furnace.items[0]).toMatchObject({ id: 'raw_iron', count: 2 });
    expect(ids(down.items)).toEqual([]);

    const sideChest = b.put(1, 1, 0, 'chest') as ContainerEntity;
    b.put(1, 0, 0, 'hopper', { facing: 'west', enabled: 'true' });
    sideChest.items[0] = { id: 'coal', count: 4 };
    b.run(1, 0, 0, 60);
    expect(furnace.items[1]).toMatchObject({ id: 'coal', count: 4 });
  });

  it('takes only the finished item out of a furnace', () => {
    const b = new Bench();
    const furnace = b.put(0, 2, 0, 'furnace', { facing: 'north', lit: 'false' }) as FurnaceEntity;
    furnace.items[0] = { id: 'raw_gold', count: 5 };
    furnace.items[1] = { id: 'coal', count: 5 };
    furnace.items[2] = { id: 'gold_ingot', count: 2 };
    const hopper = b.put(0, 1, 0, 'hopper', { facing: 'down', enabled: 'true' }) as ContainerEntity;
    b.run(0, 1, 0, 40);
    expect(ids(hopper.items)).toEqual(['gold_ingotx2']);
    expect(furnace.items[0]).toMatchObject({ id: 'raw_gold', count: 5 });
    expect(furnace.items[1]).toMatchObject({ id: 'coal', count: 5 });
  });

  it('composts what it is pointed into and takes the bone meal back out', () => {
    const b = new Bench();
    const chest = b.put(0, 2, 0, 'chest') as ContainerEntity;
    const feeder = b.put(0, 1, 0, 'hopper', { facing: 'down', enabled: 'true' }) as ContainerEntity;
    b.setBlock(0, 0, 0, blocks.stateWith('composter', { level: '0' }));
    chest.items[0] = { id: 'wheat_seeds', count: 10 };
    b.rolls = new Array(40).fill(0); // every roll succeeds
    b.run(0, 1, 0, 80);
    // seven loads fill it; the rest of the seeds stay in the hopper, since a full composter is shut
    expect(blocks.prop(b.getBlock(0, 0, 0), 'level')).toBe('7');
    expect(ids(feeder.items).join()).toMatch(/wheat_seeds/);

    // a ready composter empties into the hopper under it
    b.setBlock(0, 0, 0, blocks.stateWith('composter', { level: '8' }));
    const under = b.put(0, -1, 0, 'hopper', { facing: 'down', enabled: 'true' }) as ContainerEntity;
    b.run(0, -1, 0, 20);
    expect(ids(under.items)).toEqual(['bone_mealx1']);
    expect(blocks.prop(b.getBlock(0, 0, 0), 'level')).toBe('0');
  });

  it('merges into a stack that is already there, and refuses a full container', () => {
    const b = new Bench();
    const target = { entity: { type: 'chest', items: new Array(27).fill(null) } as ContainerEntity, kind: 'chest' };
    target.entity.items[0] = { id: 'stone', count: 63 };
    expect(insertOne(target, { id: 'stone', count: 1 }, 'up')).toBe(true);
    expect(target.entity.items[0]).toMatchObject({ count: 64 });
    for (let i = 1; i < 27; i++) target.entity.items[i] = { id: 'dirt', count: 64 };
    expect(insertOne(target, { id: 'stone', count: 1 }, 'up')).toBe(false);
  });

  it('makes the container block entity the first time it is asked for one', () => {
    const b = new Bench();
    b.setBlock(0, 0, 0, blocks.defaultState('barrel'));
    const found = containerAt(b, 0, 0, 0);
    expect(found?.kind).toBe('barrel');
    expect(found?.entity.items).toHaveLength(27);
    expect(containerAt(b, 5, 5, 5)).toBeNull();
  });
});
