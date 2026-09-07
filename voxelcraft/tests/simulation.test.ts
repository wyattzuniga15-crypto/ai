import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { tickFluid, fluidLevel, WATER_DELAY } from '../src/world/fluids.ts';
import { behaviorFor, type BlockWorld } from '../src/blocks/behaviors.ts';
import { Rng } from '../src/core/rng.ts';

/** Tiny in-memory world for simulation tests. */
class TestWorld implements BlockWorld {
  readonly map = new Map<string, number>();
  readonly scheduled: [number, number, number, number][] = [];
  readonly broken: [number, number, number][] = [];
  readonly drops: string[] = [];
  falling: [number, number, number][] = [];
  rng = new Rng(1);
  light = 15;
  day = true;
  fed = 0;

  constructor(floorY = 60) {
    for (let x = -10; x <= 10; x++) for (let z = -10; z <= 10; z++) for (let y = 0; y <= floorY; y++) this.map.set(`${x},${y},${z}`, blocks.defaultState('stone'));
  }

  getBlock(x: number, y: number, z: number): number {
    return this.map.get(`${x},${y},${z}`) ?? 0;
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    if (state === 0) this.map.delete(`${x},${y},${z}`);
    else this.map.set(`${x},${y},${z}`, state);
  }

  breakBlock(x: number, y: number, z: number): void {
    this.broken.push([x, y, z]);
    this.setBlock(x, y, z, 0);
  }

  schedule(x: number, y: number, z: number, delay: number): void {
    if (!this.scheduled.some((s) => s[0] === x && s[1] === y && s[2] === z)) this.scheduled.push([x, y, z, delay]);
  }

  readonly ignited: [number, number, number][] = [];
  readonly notes: [number, number, number][] = [];

  igniteTnt(x: number, y: number, z: number): void {
    this.ignited.push([x, y, z]);
    this.setBlock(x, y, z, 0);
  }

  playNote(x: number, y: number, z: number): void {
    this.notes.push([x, y, z]);
  }

  getLight(): number {
    return this.light;
  }

  getSkyLight(): number {
    return 15;
  }

  startFalling(x: number, y: number, z: number): void {
    this.falling.push([x, y, z]);
    this.setBlock(x, y, z, 0);
  }

  isDay(): boolean {
    return this.day;
  }

  message(): void {}
  sleep(): void {}
  addXp(): void {}
  feed(n: number): void {
    this.fed += n;
  }
  dropItem(id: string): void {
    this.drops.push(id);
  }

  /** Runs scheduled fluid ticks until nothing is pending (or the limit). */
  settle(limit = 2000): number {
    let n = 0;
    while (this.scheduled.length && n < limit) {
      const [x, y, z] = this.scheduled.shift()!;
      const s = this.getBlock(x, y, z);
      if (s !== 0 && blocks.blockOf(s).behavior === 'fluid') tickFluid(this, x, y, z, s);
      n++;
    }
    return n;
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.map.values()) if (blocks.blockOf(s).id === id) n++;
    return n;
  }
}

const water = (level = 0) => blocks.stateWith('water', { level: String(level) });

describe('fluids', () => {
  it('a water source on flat ground spreads to a 7-block radius diamond', () => {
    const w = new TestWorld();
    w.setBlock(0, 61, 0, water(0));
    w.schedule(0, 61, 0, WATER_DELAY);
    w.settle();
    expect(fluidLevel(w.getBlock(1, 61, 0))).toBe(1);
    expect(fluidLevel(w.getBlock(7, 61, 0))).toBe(7);
    expect(w.getBlock(8, 61, 0)).toBe(0);
    expect(fluidLevel(w.getBlock(3, 61, 4))).toBe(7);
    expect(w.getBlock(4, 61, 4)).toBe(0);
    expect(w.count('water')).toBe(1 + 4 * (7 * 8) / 2);
  });

  it('flows down as a falling column and spreads at the bottom', () => {
    const w = new TestWorld();
    // dig a 1-block pit below the source
    w.setBlock(2, 60, 0, 0);
    w.setBlock(0, 61, 0, water(0));
    w.schedule(0, 61, 0, WATER_DELAY);
    w.settle();
    expect(fluidLevel(w.getBlock(2, 60, 0))).toBe(8);
    // the slope search sends the water toward the hole first: cell 1,61,0 is level 1
    expect(fluidLevel(w.getBlock(1, 61, 0))).toBe(1);
  });

  it('drains when the source is removed and forms infinite water from two sources', () => {
    const w = new TestWorld();
    w.setBlock(0, 61, 0, water(0));
    w.setBlock(2, 61, 0, water(0));
    w.schedule(0, 61, 0, WATER_DELAY);
    w.schedule(2, 61, 0, WATER_DELAY);
    w.settle();
    expect(fluidLevel(w.getBlock(1, 61, 0))).toBe(0); // became a source
    w.setBlock(0, 61, 0, 0);
    w.setBlock(2, 61, 0, 0);
    for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      w.schedule(dx, 61, dz, WATER_DELAY);
      w.schedule(2 + dx, 61, dz, WATER_DELAY);
    }
    w.settle();
    // the remaining source at 1,61,0 keeps its own spread alive
    expect(fluidLevel(w.getBlock(1, 61, 0))).toBe(0);
    expect(fluidLevel(w.getBlock(1, 61, 7))).toBe(7);
  });

  it('turns lava into obsidian or cobblestone when water touches it', () => {
    const w = new TestWorld();
    w.setBlock(0, 61, 0, blocks.stateWith('lava', { level: '0' }));
    w.setBlock(1, 61, 0, water(0));
    tickFluid(w, 0, 61, 0, w.getBlock(0, 61, 0));
    expect(blocks.idOf(w.getBlock(0, 61, 0))).toBe('obsidian');
    w.setBlock(0, 61, 0, blocks.stateWith('lava', { level: '2' }));
    tickFluid(w, 0, 61, 0, w.getBlock(0, 61, 0));
    expect(blocks.idOf(w.getBlock(0, 61, 0))).toBe('cobblestone');
  });

  it('sweeps plants away', () => {
    const w = new TestWorld();
    w.setBlock(1, 61, 0, blocks.defaultState('short_grass'));
    w.setBlock(0, 61, 0, water(0));
    w.schedule(0, 61, 0, WATER_DELAY);
    w.settle();
    expect(w.broken).toContainEqual([1, 61, 0]);
    expect(fluidLevel(w.getBlock(1, 61, 0))).toBe(1);
  });
});

describe('block behaviours', () => {
  it('sand schedules a fall when unsupported', () => {
    const w = new TestWorld();
    const sand = blocks.defaultState('sand');
    w.setBlock(0, 62, 0, sand);
    const def = blocks.blockOf(sand);
    const b = behaviorFor(def)!;
    b.onPlaced!({ w, x: 0, y: 62, z: 0, state: sand, def });
    expect(w.scheduled).toEqual([[0, 62, 0, 2]]);
    b.scheduledTick!({ w, x: 0, y: 62, z: 0, state: sand, def });
    expect(w.falling).toEqual([[0, 62, 0]]);
  });

  it('doors toggle both halves and buttons reset', () => {
    const w = new TestWorld();
    const lower = blocks.stateWith('oak_door', { half: 'lower', facing: 'north', open: 'false', hinge: 'left', powered: 'false' });
    const upper = blocks.withProp(lower, 'half', 'upper');
    w.setBlock(0, 61, 0, lower);
    w.setBlock(0, 62, 0, upper);
    const def = blocks.blockOf(lower);
    expect(behaviorFor(def)!.onUse!({ w, x: 0, y: 61, z: 0, state: lower, def })).toBe(true);
    expect(blocks.prop(w.getBlock(0, 61, 0), 'open')).toBe('true');
    expect(blocks.prop(w.getBlock(0, 62, 0), 'open')).toBe('true');
    const button = blocks.defaultState('oak_button');
    w.setBlock(1, 61, 0, button);
    const bdef = blocks.blockOf(button);
    behaviorFor(bdef)!.onUse!({ w, x: 1, y: 61, z: 0, state: button, def: bdef });
    expect(blocks.prop(w.getBlock(1, 61, 0), 'powered')).toBe('true');
    expect(w.scheduled).toContainEqual([1, 61, 0, 30]);
  });

  it('wheat grows through its ages on farmland and grass spreads onto dirt', () => {
    const w = new TestWorld();
    w.setBlock(0, 60, 0, blocks.stateWith('farmland', { moisture: '7' }));
    let wheat = blocks.stateWith('wheat', { age: '0' });
    w.setBlock(0, 61, 0, wheat);
    const def = blocks.blockOf(wheat);
    for (let i = 0; i < 400 && Number(blocks.prop(w.getBlock(0, 61, 0), 'age')) < 7; i++) {
      wheat = w.getBlock(0, 61, 0);
      behaviorFor(def)!.randomTick!({ w, x: 0, y: 61, z: 0, state: wheat, def });
    }
    expect(blocks.prop(w.getBlock(0, 61, 0), 'age')).toBe('7');
    w.setBlock(0, 60, 1, blocks.defaultState('grass_block'));
    w.setBlock(0, 60, 2, blocks.defaultState('dirt'));
    w.setBlock(0, 61, 2, 0);
    const gdef = blocks.get('grass_block');
    for (let i = 0; i < 200 && blocks.idOf(w.getBlock(0, 60, 2)) !== 'grass_block'; i++) behaviorFor(gdef)!.randomTick!({ w, x: 0, y: 60, z: 1, state: gdef.default, def: gdef });
    expect(blocks.idOf(w.getBlock(0, 60, 2))).toBe('grass_block');
  });

  it('unsupported flowers break and leaves decay without logs', () => {
    const w = new TestWorld();
    const poppy = blocks.defaultState('poppy');
    w.setBlock(0, 61, 0, poppy);
    w.setBlock(0, 60, 0, 0);
    const def = blocks.blockOf(poppy);
    behaviorFor(def)!.onNeighborChanged!({ w, x: 0, y: 61, z: 0, state: poppy, def }, 0, 60, 0);
    expect(w.broken).toContainEqual([0, 61, 0]);
    const leaves = blocks.stateWith('oak_leaves', { persistent: 'false', distance: '7', waterlogged: 'false' });
    w.setBlock(5, 70, 5, leaves);
    const ldef = blocks.blockOf(leaves);
    w.rng = new Rng(3);
    for (let i = 0; i < 20 && w.getBlock(5, 70, 5) !== 0; i++) behaviorFor(ldef)!.randomTick!({ w, x: 5, y: 70, z: 5, state: leaves, def: ldef });
    expect(w.getBlock(5, 70, 5)).toBe(0);
    // leaves next to a log survive
    w.setBlock(5, 70, 5, leaves);
    w.setBlock(6, 70, 5, blocks.defaultState('oak_log'));
    for (let i = 0; i < 20; i++) behaviorFor(ldef)!.randomTick!({ w, x: 5, y: 70, z: 5, state: leaves, def: ldef });
    expect(w.getBlock(5, 70, 5)).toBe(leaves);
  });
});
