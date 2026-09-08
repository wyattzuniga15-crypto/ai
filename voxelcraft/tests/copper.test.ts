/**
 * Weathering copper: the four ages of every family, the neighbour rules that speed the change up
 * or hold it back, and what an axe and a honeycomb leave behind.
 */
import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { COPPER_AGES, WEATHER_CHANCE, copperAge, copperBase, copperFamilies, isWaxedCopper, nextCopper, scrapeCopper, waxCopper, weatherTick, weathers } from '../src/blocks/copper.ts';
import { behaviorFor, type BlockContext, type BlockWorld } from '../src/blocks/behaviors.ts';
import { Rng } from '../src/core/rng.ts';

/** A pocket world holding a handful of blocks, enough for the neighbour scan to read. */
function pocket(seed = 1): BlockWorld & { set(x: number, y: number, z: number, id: string): void } {
  const map = new Map<string, number>();
  const w = {
    getBlock: (x: number, y: number, z: number) => map.get(`${x},${y},${z}`) ?? 0,
    setBlock: (x: number, y: number, z: number, s: number) => { map.set(`${x},${y},${z}`, s); },
    set(x: number, y: number, z: number, id: string) { map.set(`${x},${y},${z}`, blocks.defaultState(id)); },
    rng: new Rng(seed),
  } as unknown as BlockWorld & { set(x: number, y: number, z: number, id: string): void };
  return w;
}

const ctxAt = (w: BlockWorld, x: number, y: number, z: number): BlockContext => {
  const state = w.getBlock(x, y, z);
  return { w, x, y, z, state, def: blocks.blockOf(state) };
};

describe('the ages of copper', () => {
  it('finds every family in the registry, all four ages waxed and not', () => {
    const found = copperFamilies();
    // fifteen in 1.21: the block, cut copper and its slab and stairs, chiseled, grate, bulb, door,
    // trapdoor, bars, chain, lantern, chest, lightning rod and the golem statue
    expect(found).toHaveLength(15);
    for (const f of found) {
      expect(f.stages).toHaveLength(4);
      for (const id of [...f.stages, ...f.waxed]) expect(blocks.has(id)).toBe(true);
    }
    expect(found.map((f) => f.stages[0])).toContain('copper_block');
    expect(found.map((f) => f.stages[0])).toContain('copper_golem_statue');
  });

  it('names the ages in vanilla order', () => {
    expect(COPPER_AGES).toEqual(['unaffected', 'exposed', 'weathered', 'oxidized']);
    expect(copperAge('copper_block')).toBe(0);
    expect(copperAge('exposed_cut_copper_stairs')).toBe(1);
    expect(copperAge('weathered_copper_bulb')).toBe(2);
    expect(copperAge('oxidized_copper_grate')).toBe(3);
    expect(copperAge('stone')).toBe(-1);
    expect(copperBase('oxidized_copper')).toBe('copper_block');
    expect(copperBase('waxed_weathered_copper_door')).toBe('copper_door');
  });

  it('only unwaxed copper below oxidized weathers on its own', () => {
    expect(weathers('copper_block')).toBe(true);
    expect(weathers('weathered_copper_chest')).toBe(true);
    expect(weathers('oxidized_copper')).toBe(false);
    expect(weathers('waxed_copper_block')).toBe(false);
    expect(nextCopper('copper_block')).toBe('exposed_copper');
    expect(nextCopper('exposed_copper')).toBe('weathered_copper');
    expect(nextCopper('weathered_copper')).toBe('oxidized_copper');
    expect(nextCopper('oxidized_copper')).toBeNull();
    expect(nextCopper('waxed_copper_block')).toBeNull();
  });

  it('takes the wax off before it scrapes, the way an axe does', () => {
    expect(isWaxedCopper('waxed_exposed_copper')).toBe(true);
    expect(scrapeCopper('waxed_exposed_copper')).toBe('exposed_copper');
    expect(scrapeCopper('exposed_copper')).toBe('copper_block');
    expect(scrapeCopper('oxidized_copper_lantern')).toBe('weathered_copper_lantern');
    expect(scrapeCopper('copper_block')).toBeNull();
    expect(scrapeCopper('stone')).toBeNull();
    expect(waxCopper('weathered_copper_bars')).toBe('waxed_weathered_copper_bars');
    expect(waxCopper('waxed_weathered_copper_bars')).toBeNull();
  });

  it('carries the state properties across, so a stair keeps its shape', () => {
    const w = pocket();
    const stair = blocks.stateWith('cut_copper_stairs', { facing: 'east', half: 'top', shape: 'inner_left', waterlogged: 'true' });
    w.setBlock(0, 0, 0, stair);
    // no neighbours at all, so the only question is the roll
    (w as unknown as { rng: { next(): number } }).rng = { next: () => 0 };
    weatherTick(ctxAt(w, 0, 0, 0));
    const after = w.getBlock(0, 0, 0);
    expect(blocks.blockOf(after).id).toBe('exposed_cut_copper_stairs');
    expect(blocks.prop(after, 'facing')).toBe('east');
    expect(blocks.prop(after, 'half')).toBe('top');
    expect(blocks.prop(after, 'shape')).toBe('inner_left');
    expect(blocks.prop(after, 'waterlogged')).toBe('true');
  });
});

describe('what the copper around it does', () => {
  /**
   * The exact chance the block weathers, found by bisecting on a fixed roll rather than sampling:
   * the tick weathers when the roll falls under the chance, so the chance is where that flips.
   */
  const chanceOf = (w: BlockWorld, id: string): number => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 40; i++) {
      const probe = (lo + hi) / 2;
      w.setBlock(0, 0, 0, blocks.defaultState(id));
      (w as { rng: { next(): number } }).rng = { next: () => probe } as never;
      weatherTick(ctxAt(w, 0, 0, 0));
      if (blocks.blockOf(w.getBlock(0, 0, 0)).id === id) hi = probe;
      else lo = probe;
    }
    w.setBlock(0, 0, 0, blocks.defaultState(id));
    return lo;
  };

  it("weathers at vanilla's one-in-eighteen with nothing else about", () => {
    expect(chanceOf(pocket(), 'copper_block')).toBeCloseTo(WEATHER_CHANCE, 6);
  });

  it('is held back completely by a single younger neighbour', () => {
    const w = pocket();
    w.set(3, 0, 0, 'copper_block'); // younger than exposed, three away
    expect(chanceOf(w, 'exposed_copper')).toBe(0);
  });

  it('is slowed by neighbours of its own age and unaffected by older ones', () => {
    const same = pocket();
    same.set(1, 0, 0, 'copper_block');
    same.set(-1, 0, 0, 'copper_block');
    same.set(0, 0, 1, 'copper_block');
    // (0+1)/(0+3+1) squared: a sixteenth of the base chance
    expect(chanceOf(same, 'copper_block')).toBeCloseTo(WEATHER_CHANCE / 16, 6);

    const older = pocket();
    older.set(1, 0, 0, 'oxidized_copper');
    older.set(-1, 0, 0, 'oxidized_copper');
    older.set(0, 0, 1, 'oxidized_copper');
    // (3+1)/(3+0+1) squared: the full chance
    expect(chanceOf(older, 'copper_block')).toBeCloseTo(WEATHER_CHANCE, 6);

    const mixed = pocket();
    mixed.set(1, 0, 0, 'oxidized_copper');
    mixed.set(-1, 0, 0, 'exposed_copper');
    // one older, one the same: (1+1)/(1+1+1) squared
    expect(chanceOf(mixed, 'exposed_copper')).toBeCloseTo((4 / 9) * WEATHER_CHANCE, 6);
  });

  it('ignores waxed copper entirely, older or younger', () => {
    const w = pocket();
    w.set(1, 0, 0, 'waxed_copper_block'); // younger, but waxed: it holds nothing back
    w.set(-1, 0, 0, 'waxed_oxidized_copper');
    expect(chanceOf(w, 'exposed_copper')).toBeCloseTo(WEATHER_CHANCE, 6);
  });

  it('only looks four blocks away, by Manhattan distance', () => {
    const near = pocket();
    near.set(2, 2, 0, 'copper_block'); // four away
    expect(chanceOf(near, 'exposed_copper')).toBe(0);
    const far = pocket();
    far.set(2, 2, 1, 'copper_block'); // five away
    expect(chanceOf(far, 'exposed_copper')).toBeCloseTo(WEATHER_CHANCE, 6);
  });
});

describe('the behaviour table', () => {
  it('gives copper a random tick without losing what the block already did', () => {
    // a copper door still opens, and now weathers as well
    const door = behaviorFor(blocks.get('copper_door'));
    expect(door?.randomTick).toBeTypeOf('function');
    expect(door?.onUse).toBeTypeOf('function');
    // the waxed one keeps the door behaviour and gains nothing
    expect(behaviorFor(blocks.get('waxed_copper_door'))?.randomTick).toBeUndefined();
    // and plain copper, which had no behaviour at all, now has one
    expect(behaviorFor(blocks.get('copper_block'))?.randomTick).toBeTypeOf('function');
    expect(behaviorFor(blocks.get('oxidized_copper'))?.randomTick).toBeUndefined();
  });
});
