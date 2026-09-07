import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { behaviorFor, flammability, type BlockWorld } from '../src/blocks/behaviors.ts';
import { Rng } from '../src/core/rng.ts';

/** A room to set alight. */
class Room implements BlockWorld {
  readonly map = new Map<string, number>();
  rng = new Rng(3);
  raining = false;
  readonly scheduled: string[] = [];

  getBlock(x: number, y: number, z: number): number { return this.map.get(`${x},${y},${z}`) ?? 0; }
  setBlock(x: number, y: number, z: number, state: number): void {
    if (state === 0) this.map.delete(`${x},${y},${z}`);
    else this.map.set(`${x},${y},${z}`, state);
  }
  place(x: number, y: number, z: number, id: string, props: Record<string, string> = {}): void {
    this.setBlock(x, y, z, Object.keys(props).length ? blocks.stateWith(id, props) : blocks.defaultState(id));
  }
  id(x: number, y: number, z: number): string {
    const s = this.getBlock(x, y, z);
    return s === 0 ? 'air' : blocks.blockOf(s).id;
  }
  count(id: string): number {
    let n = 0;
    for (const s of this.map.values()) if (blocks.blockOf(s).id === id) n++;
    return n;
  }
  /** Runs the fire's scheduled tick, which is what vanilla paces a spread with. */
  tick(x: number, y: number, z: number): void {
    const state = this.getBlock(x, y, z);
    if (state === 0) return;
    const def = blocks.blockOf(state);
    behaviorFor(def)?.scheduledTick?.({ w: this, x, y, z, state, def });
  }
  neighbor(x: number, y: number, z: number): void {
    const state = this.getBlock(x, y, z);
    if (state === 0) return;
    const def = blocks.blockOf(state);
    behaviorFor(def)?.onNeighborChanged?.({ w: this, x, y, z, state, def }, x, y - 1, z);
  }

  getLight(): number { return 15; }
  getSkyLight(): number { return 15; }
  isDay(): boolean { return true; }
  isRaining(): boolean { return this.raining; }
  breakBlock(x: number, y: number, z: number): void { this.setBlock(x, y, z, 0); }
  startFalling(): void {}
  message(): void {}
  addXp(): void {}
  feed(): void {}
  dropItem(): void {}
  igniteTnt(): void {}
  playNote(): void {}
  dispense(): void {}
  sleep(): void {}
  schedule(x: number, y: number, z: number): void { this.scheduled.push(`${x},${y},${z}`); }
  getBlockEntity(): null { return null; }
  setBlockEntity(): void {}
  playSound(): void {}
}

describe('what burns', () => {
  it('knows vanilla\'s families and leaves stone alone', () => {
    expect(flammability('oak_planks')).toEqual({ catches: 5, burns: 20 });
    expect(flammability('oak_log')).toEqual({ catches: 5, burns: 5 });
    expect(flammability('oak_leaves')).toEqual({ catches: 30, burns: 60 });
    expect(flammability('white_wool')).toEqual({ catches: 30, burns: 60 });
    expect(flammability('short_grass')?.catches).toBe(60);
    expect(flammability('stone')).toBeNull();
    expect(flammability('cobblestone')).toBeNull();
    expect(flammability('water')).toBeNull();
  });
});

describe('a fire', () => {
  it('burns a wooden house down around itself', () => {
    const w = new Room();
    for (let x = 0; x < 8; x++) for (let z = 0; z < 8; z++) for (let y = 60; y <= 64; y++) w.place(x, y, z, 'oak_planks');
    w.place(0, 65, 0, 'fire', { age: '0' });
    let peak = 0;
    for (let i = 0; i < 400; i++) {
      const fires: [number, number, number][] = [];
      for (let x = -2; x < 10; x++) for (let z = -2; z < 10; z++) for (let y = 58; y <= 70; y++) if (w.id(x, y, z) === 'fire') fires.push([x, y, z]);
      peak = Math.max(peak, fires.length);
      for (const [x, y, z] of fires) w.tick(x, y, z);
    }
    // the fire took hold, spread through the wood and ate most of it
    expect(peak).toBeGreaterThan(5);
    expect(w.count('oak_planks')).toBeLessThan(80);
    // and it asked to be ticked again each time, which is what keeps it going
    expect(w.scheduled.length).toBeGreaterThan(10);
  });

  it('goes out when there is nothing to burn and nothing to stand on', () => {
    const w = new Room();
    w.place(0, 64, 0, 'fire', { age: '10' });
    w.tick(0, 64, 0);
    expect(w.id(0, 64, 0)).toBe('air');
  });

  it('is put out by rain wherever the sky can see it', () => {
    const w = new Room();
    w.place(0, 63, 0, 'stone');
    w.place(0, 64, 0, 'fire', { age: '15' });
    w.raining = true;
    let out = false;
    for (let i = 0; i < 20 && !out; i++) {
      w.tick(0, 64, 0);
      out = w.id(0, 64, 0) === 'air';
    }
    expect(out).toBe(true);
  });

  it('burns for ever on netherrack', () => {
    const w = new Room();
    w.place(0, 63, 0, 'netherrack');
    w.place(0, 64, 0, 'fire', { age: '15' });
    w.raining = true;
    for (let i = 0; i < 50; i++) w.tick(0, 64, 0);
    expect(w.id(0, 64, 0)).toBe('fire');
  });

  it('vanishes the moment what held it up is taken away', () => {
    const w = new Room();
    w.place(0, 63, 0, 'stone');
    w.place(0, 64, 0, 'fire', { age: '0' });
    w.setBlock(0, 63, 0, 0);
    w.neighbor(0, 64, 0);
    expect(w.id(0, 64, 0)).toBe('air');
  });
});

describe('candles and coral', () => {
  it('lets a hand put a lit candle out', () => {
    const w = new Room();
    w.place(0, 64, 0, 'candle', { candles: '1', lit: 'true', waterlogged: 'false' });
    const state = w.getBlock(0, 64, 0);
    const def = blocks.blockOf(state);
    const handled = behaviorFor(def)?.onUse?.({ w, x: 0, y: 64, z: 0, state, def });
    expect(handled).toBe(true);
    expect(blocks.prop(w.getBlock(0, 64, 0), 'lit')).toBe('false');
    // and does nothing at all to one that is already out
    const out = w.getBlock(0, 64, 0);
    expect(behaviorFor(def)?.onUse?.({ w, x: 0, y: 64, z: 0, state: out, def })).toBe(false);
  });

  it('kills coral that has no water against it, and spares the piece that has', () => {
    const w = new Room();
    w.place(0, 64, 0, 'tube_coral_block');
    w.tick(0, 64, 0);
    expect(w.id(0, 64, 0)).toBe('dead_tube_coral_block');

    w.place(4, 64, 0, 'tube_coral_block');
    w.place(5, 64, 0, 'water');
    w.tick(4, 64, 0);
    expect(w.id(4, 64, 0)).toBe('tube_coral_block');
  });

  it('leaves what is already dead alone', () => {
    const w = new Room();
    w.place(0, 64, 0, 'dead_tube_coral_block');
    w.tick(0, 64, 0);
    expect(w.id(0, 64, 0)).toBe('dead_tube_coral_block');
  });
});
