import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { behaviorFor, type BlockWorld } from '../src/blocks/behaviors.ts';
import { Rng } from '../src/core/rng.ts';

/** A patch of the End to grow chorus on. */
class Island implements BlockWorld {
  readonly map = new Map<string, number>();
  rng = new Rng(7);

  getBlock(x: number, y: number, z: number): number {
    return this.map.get(`${x},${y},${z}`) ?? 0;
  }

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

  tick(x: number, y: number, z: number): void {
    const state = this.getBlock(x, y, z);
    if (state === 0) return;
    const def = blocks.blockOf(state);
    behaviorFor(def)?.randomTick?.({ w: this, x, y, z, state, def });
  }

  /** Tells a block its neighbour changed, the way the world does when one is broken. */
  neighbor(x: number, y: number, z: number, nx: number, ny: number, nz: number): void {
    const state = this.getBlock(x, y, z);
    if (state === 0) return;
    const def = blocks.blockOf(state);
    behaviorFor(def)?.onNeighborChanged?.({ w: this, x, y, z, state, def }, nx, ny, nz);
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.map.values()) if (blocks.blockOf(s).id === id) n++;
    return n;
  }

  getLight(): number { return 15; }
  getSkyLight(): number { return 15; }
  isDay(): boolean { return true; }
  isRaining(): boolean { return false; }
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
  schedule(): void {}
  markModified(): void {}
  getBlockEntity(): null { return null; }
  setBlockEntity(): void {}
  playSound(): void {}
}

describe('chorus plants', () => {
  it('grows a flower on end stone into a stem with a flower still on top', () => {
    const w = new Island();
    w.place(0, 63, 0, 'end_stone');
    w.place(0, 64, 0, 'chorus_flower', { age: '0' });
    for (let i = 0; i < 40; i++)
      for (let y = 64; y < 80; y++)
        for (let x = -4; x <= 4; x++)
          for (let z = -4; z <= 4; z++)
            if (w.id(x, y, z) === 'chorus_flower') w.tick(x, y, z);
    expect(w.count('chorus_plant')).toBeGreaterThan(1);
    expect(w.count('chorus_flower')).toBeGreaterThan(0);
    // and the stem it left behind knows what it is joined to
    expect(blocks.prop(w.getBlock(0, 64, 0), 'down')).toBe('true');
    expect(blocks.prop(w.getBlock(0, 64, 0), 'up')).toBe('true');
  });

  it('never grows a flower into a block that is already there', () => {
    const w = new Island();
    w.place(0, 63, 0, 'end_stone');
    w.place(0, 64, 0, 'chorus_flower', { age: '0' });
    w.place(0, 65, 0, 'end_stone'); // a ceiling right over it
    for (let i = 0; i < 20; i++) w.tick(0, 64, 0);
    expect(w.id(0, 64, 0)).toBe('chorus_flower');
    expect(w.count('chorus_plant')).toBe(0);
  });

  it('brings the stem down when what it stood on goes', () => {
    const w = new Island();
    w.place(0, 63, 0, 'end_stone');
    for (let y = 64; y <= 67; y++) w.place(0, y, 0, 'chorus_plant');
    // pulling the end stone out from under it takes the block that stood on it
    w.setBlock(0, 63, 0, 0);
    w.neighbor(0, 64, 0, 0, 63, 0);
    expect(w.id(0, 64, 0)).toBe('air');
    // and each block above follows as the one under it goes
    w.neighbor(0, 65, 0, 0, 64, 0);
    expect(w.id(0, 65, 0)).toBe('air');
  });

  it('lets a branch hang on as long as what it grew from is still there', () => {
    const w = new Island();
    w.place(0, 63, 0, 'end_stone');
    w.place(0, 64, 0, 'chorus_plant');
    w.place(1, 64, 0, 'chorus_plant'); // a branch off the side of the trunk
    w.neighbor(1, 64, 0, 1, 63, 0);
    expect(w.id(1, 64, 0)).toBe('chorus_plant');
  });
});
