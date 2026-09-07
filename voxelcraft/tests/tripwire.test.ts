import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { Rng } from '../src/core/rng.ts';
import { Simulation } from '../src/world/simulation.ts';
import { targetStrength } from '../src/world/redstone.ts';
import { hookRun, hooksFor, updateRun } from '../src/world/tripwire.ts';
import type { BlockWorld } from '../src/blocks/behaviors.ts';

/** The same slab of stone the redstone tests use, with the simulation running over it. */
class Bench implements BlockWorld {
  readonly map = new Map<string, number>();
  readonly sim: Simulation;
  rng = new Rng(3);
  time = 0;

  constructor() {
    for (let x = -8; x <= 8; x++) for (let z = -8; z <= 8; z++) this.map.set(`${x},63,${z}`, blocks.defaultState('stone'));
    this.sim = new Simulation(this, () => []);
  }

  getBlock(x: number, y: number, z: number): number {
    return this.map.get(`${x},${y},${z}`) ?? 0;
  }

  setBlock(x: number, y: number, z: number, state: number): void {
    const old = this.getBlock(x, y, z);
    if (old === state) return;
    if (state === 0) this.map.delete(`${x},${y},${z}`);
    else this.map.set(`${x},${y},${z}`, state);
    this.sim.onBlockChanged(x, y, z, old, state);
  }

  place(x: number, y: number, z: number, id: string, props: Record<string, string> = {}): void {
    this.setBlock(x, y, z, Object.keys(props).length ? blocks.stateWith(id, props) : blocks.defaultState(id));
  }

  run(ticks = 6): void {
    for (let i = 0; i < ticks; i++) this.sim.tick(++this.time, 0, 0);
  }

  prop(x: number, y: number, z: number, name: string): string | undefined {
    return blocks.prop(this.getBlock(x, y, z), name);
  }

  breakBlock(x: number, y: number, z: number): void {
    this.setBlock(x, y, z, 0);
  }

  schedule(x: number, y: number, z: number, delay: number): void {
    this.sim.schedule(x, y, z, delay, this.time);
  }

  getLight(): number {
    return 15;
  }

  getSkyLight(): number {
    return 15;
  }

  isDay(): boolean {
    return true;
  }

  isRaining(): boolean {
    return false;
  }

  dropItem(): void {}
  igniteTnt(): void {}
  playNote(): void {}
  dispense(): void {}
  sleep(): void {}
  markModified(): void {}
  getBlockEntity(): null {
    return null;
  }
  setBlockEntity(): void {}
  playSound(): void {}
  particles(): void {}
  startFalling(): void {}
  message(): void {}
  addXp(): void {}
  feed(): void {}
}

/** A run of string between two hooks facing each other along x. */
function strung(b: Bench, x0: number, x1: number): void {
  b.place(x0, 64, 0, 'tripwire_hook', { attached: 'false', facing: 'east', powered: 'false' });
  for (let x = x0 + 1; x < x1; x++) b.place(x, 64, 0, 'tripwire', { attached: 'false', disarmed: 'false', powered: 'false', north: 'false', south: 'false', east: 'true', west: 'true' });
  b.place(x1, 64, 0, 'tripwire_hook', { attached: 'false', facing: 'west', powered: 'false' });
}

describe('tripwire', () => {
  it('finds the hook at the other end of the run', () => {
    const b = new Bench();
    strung(b, -3, 1);
    const run = hookRun(b, -3, 64, 0);
    expect(run.strings).toHaveLength(3);
    expect(run.end).toEqual([1, 64, 0]);
    expect(hooksFor(b, 0, 64, 0).sort()).toEqual([[-3, 64, 0], [1, 64, 0]]);
  });

  it('attaches both hooks and every string', () => {
    const b = new Bench();
    strung(b, -3, 1);
    updateRun(b, -3, 64, 0, () => false);
    expect(b.prop(-3, 64, 0, 'attached')).toBe('true');
    expect(b.prop(1, 64, 0, 'attached')).toBe('true');
    expect(b.prop(0, 64, 0, 'attached')).toBe('true');
    expect(b.prop(-3, 64, 0, 'powered')).toBe('false');
  });

  it('leaves a broken run unattached', () => {
    const b = new Bench();
    strung(b, -3, 1);
    b.place(0, 64, 0, 'stone'); // the string is cut
    updateRun(b, -3, 64, 0, () => false);
    expect(hookRun(b, -3, 64, 0).end).toBeNull();
    expect(b.prop(-3, 64, 0, 'attached')).toBe('false');
  });

  it('powers both hooks and the wire when something stands on it, and lights a lamp beside it', () => {
    const b = new Bench();
    strung(b, -3, 1);
    b.place(-4, 64, 0, 'redstone_lamp');
    updateRun(b, -3, 64, 0, () => false);
    b.run();
    expect(b.prop(-4, 64, 0, 'lit')).toBe('false');

    updateRun(b, -3, 64, 0, ([x]) => x === -1);
    b.run();
    expect(b.prop(-3, 64, 0, 'powered')).toBe('true');
    expect(b.prop(1, 64, 0, 'powered')).toBe('true');
    expect(b.prop(-1, 64, 0, 'powered')).toBe('true');
    expect(b.prop(-4, 64, 0, 'lit')).toBe('true');

    updateRun(b, -3, 64, 0, () => false);
    b.run();
    expect(b.prop(-3, 64, 0, 'powered')).toBe('false');
    expect(b.prop(-4, 64, 0, 'lit')).toBe('false');
  });
});

describe('target blocks', () => {
  it('scores a shot by how near the middle it lands', () => {
    expect(targetStrength(0, 64, 0, 0.5, 64.5, 0)).toBe(15); // dead centre of the north face
    expect(targetStrength(0, 64, 0, 0.5, 64.9, 0)).toBeLessThan(15);
    expect(targetStrength(0, 64, 0, 0.02, 64.02, 0)).toBe(1); // the very corner still counts as a hit
  });

  it('powers what is next to it and lets go when its tick comes round', () => {
    const b = new Bench();
    b.place(0, 64, 0, 'target', { power: '0' });
    b.place(1, 64, 0, 'redstone_lamp');
    b.run();
    expect(b.prop(1, 64, 0, 'lit')).toBe('false');
    b.setBlock(0, 64, 0, blocks.stateWith('target', { power: '15' }));
    b.run();
    expect(b.prop(1, 64, 0, 'lit')).toBe('true');
    b.schedule(0, 64, 0, 20);
    b.run(25);
    expect(b.prop(0, 64, 0, 'power')).toBe('0');
    expect(b.prop(1, 64, 0, 'lit')).toBe('false');
  });
});
