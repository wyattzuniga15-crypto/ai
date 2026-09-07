import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { blocks } from '../src/blocks/registry.ts';
import { compost, compostChance, composterLevel, isCompostable } from '../src/blocks/composter.ts';
import { fishingLoot } from '../src/items/loot.ts';
import { FishingBobber } from '../src/entities/bobber.ts';
import { applyBoneMeal, behaviorFor, type BlockWorld } from '../src/blocks/behaviors.ts';
import { Rng } from '../src/core/rng.ts';

/** A patch of ground to grow things on. */
class Field implements BlockWorld {
  readonly map = new Map<string, number>();
  rng = new Rng(11);

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

  prop(x: number, y: number, z: number, name: string): string | undefined {
    return blocks.prop(this.getBlock(x, y, z), name);
  }

  /** Random-ticks a block the way the simulation would. */
  tick(x: number, y: number, z: number): void {
    const state = this.getBlock(x, y, z);
    if (state === 0) return;
    const def = blocks.blockOf(state);
    behaviorFor(def)?.randomTick?.({ w: this, x, y, z, state, def });
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

  breakBlock(x: number, y: number, z: number): void {
    this.setBlock(x, y, z, 0);
  }

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
  getBlockEntity(): null {
    return null;
  }
  setBlockEntity(): void {}
  playSound(): void {}
  particles(): void {}
}

describe('composter', () => {
  it('takes what vanilla lets it take, at vanilla’s odds', () => {
    expect(compostChance('wheat_seeds')).toBe(0.3);
    expect(compostChance('oak_leaves')).toBe(0.3);
    expect(compostChance('birch_sapling')).toBe(0.3);
    expect(compostChance('sugar_cane')).toBe(0.5);
    expect(compostChance('wheat')).toBe(0.65);
    expect(compostChance('poppy')).toBe(0.65);
    expect(compostChance('bread')).toBe(0.85);
    expect(compostChance('cake')).toBe(1);
    expect(isCompostable('stone')).toBe(false);
    expect(isCompostable('diamond')).toBe(false);
  });

  it('rises a level only when the roll comes off', () => {
    const empty = blocks.stateWith('composter', { level: '0' });
    expect(compost(empty, 'wheat_seeds', 0.1)?.filled).toBe(true);
    expect(composterLevel(compost(empty, 'wheat_seeds', 0.1)!.state)).toBe(1);
    const missed = compost(empty, 'wheat_seeds', 0.9)!;
    expect(missed.filled).toBe(false);
    expect(composterLevel(missed.state)).toBe(0);
  });

  it('refuses things that do not compost, and anything at all once it is full', () => {
    const empty = blocks.stateWith('composter', { level: '0' });
    expect(compost(empty, 'stone', 0)).toBeNull();
    const full = blocks.stateWith('composter', { level: '7' });
    expect(compost(full, 'cake', 0)).toBeNull();
  });
});

describe('fishing loot', () => {
  const tally = (luck: number, open: boolean, n: number): Record<string, number> => {
    const out: Record<string, number> = {};
    let seed = 12345;
    const random = (): number => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    for (let i = 0; i < n; i++) for (const s of fishingLoot(luck, open, random)) out[s.id] = (out[s.id] ?? 0) + 1;
    return out;
  };

  it('brings up mostly fish, cod most of all', () => {
    const t = tally(0, true, 2000);
    expect(t.cod).toBeGreaterThan(900);
    expect(t.cod).toBeGreaterThan(t.salmon);
    expect(t.salmon).toBeGreaterThan(t.pufferfish);
  });

  it('keeps treasure for open water', () => {
    const closed = tally(0, false, 1500);
    for (const id of ['name_tag', 'saddle', 'nautilus_shell', 'enchanted_book']) expect(closed[id] ?? 0).toBe(0);
    const open = tally(0, true, 1500);
    expect((open.nautilus_shell ?? 0) + (open.name_tag ?? 0) + (open.saddle ?? 0)).toBeGreaterThan(0);
  });

  it('lets luck of the sea shift the odds vanilla’s way', () => {
    const plain = tally(0, true, 2000);
    const lucky = tally(3, true, 2000);
    const treasure = (t: Record<string, number>) => (t.name_tag ?? 0) + (t.saddle ?? 0) + (t.nautilus_shell ?? 0) + (t.enchanted_book ?? 0);
    const junk = (t: Record<string, number>) => (t.lily_pad ?? 0) + (t.bowl ?? 0) + (t.stick ?? 0) + (t.rotten_flesh ?? 0);
    expect(treasure(lucky)).toBeGreaterThan(treasure(plain));
    expect(junk(lucky)).toBeLessThan(junk(plain));
  });
});

describe('fishing bobber', () => {
  /** A pond: water from y 60 to 63 over stone, air above. */
  const pond = {
    getBlock(x: number, y: number, z: number): number {
      if (Math.abs(x) > 40 || Math.abs(z) > 40) return blocks.defaultState('stone');
      if (y < 60) return blocks.defaultState('stone');
      if (y <= 63) return blocks.defaultState('water');
      return 0;
    },
  };

  const cast = (dx: number, dy: number, dz: number, lure = 0, random = () => 0.5): FishingBobber =>
    new FishingBobber(0, 68, 0, new THREE.Vector3(dx, dy, dz), lure, new THREE.Object3D(), random);

  it('falls until it meets the water, then floats and starts fishing', () => {
    const bobber = cast(1, 0, 0);
    for (let i = 0; i < 60 && !bobber.inWater; i++) bobber.tick(pond);
    expect(bobber.inWater).toBe(true);
    expect(bobber.pos.y).toBeCloseTo(63.9, 5); // floating on the top water block
    expect(bobber.wait).toBeGreaterThan(0);
  });

  it('shortens the wait by a hundred ticks for every level of Lure', () => {
    const plain = cast(1, 0, 0, 0);
    const lured = cast(1, 0, 0, 3);
    for (const b of [plain, lured]) for (let i = 0; i < 60 && !b.inWater; i++) b.tick(pond);
    expect(plain.wait - lured.wait).toBe(300);
  });

  it('bites when the wait runs out, and gives up again if nothing reels it in', () => {
    const bobber = cast(1, 0, 0, 3);
    for (let i = 0; i < 400 && !bobber.biting; i++) bobber.tick(pond);
    expect(bobber.biting).toBe(true);
    const held = bobber.nibble;
    expect(held).toBeGreaterThanOrEqual(20);
    for (let i = 0; i < held; i++) bobber.tick(pond);
    expect(bobber.biting).toBe(false);
    expect(bobber.wait).toBeGreaterThan(0); // back to waiting
  });

  it('knows open water from a hole in the ground', () => {
    const bobber = cast(1, 0, 0);
    for (let i = 0; i < 60 && !bobber.inWater; i++) bobber.tick(pond);
    expect(bobber.openWater(pond)).toBe(true);
    // the same bobber against a wall of stone is not fishing open water
    const walled = { getBlock: (x: number, y: number, z: number) => (x > bobber.pos.x ? blocks.defaultState('stone') : pond.getBlock(x, y, z)) };
    expect(bobber.openWater(walled)).toBe(false);
  });

  it('sticks where it lands when it never reaches water', () => {
    const dry = { getBlock: (x: number, y: number, z: number) => (y < 66 ? blocks.defaultState('stone') : 0) };
    const bobber = cast(1, 0, 0);
    for (let i = 0; i < 60 && !bobber.stuck; i++) bobber.tick(dry);
    expect(bobber.stuck).toBe(true);
    expect(bobber.inWater).toBe(false);
    for (let i = 0; i < 100; i++) bobber.tick(dry);
    expect(bobber.biting).toBe(false);
  });
});

describe('crops', () => {
  const farm = (): Field => {
    const w = new Field();
    for (let x = 0; x < 4; x++) w.place(x, 63, 0, 'farmland', { moisture: '7' });
    return w;
  };

  it('ripens wheat on watered farmland', () => {
    const w = farm();
    w.place(0, 64, 0, 'wheat', { age: '0' });
    for (let i = 0; i < 200; i++) w.tick(0, 64, 0);
    expect(w.prop(0, 64, 0, 'age')).toBe('7');
  });

  it('turns the torchflower crop into the flower, and the pitcher crop into a plant two blocks tall', () => {
    const w = farm();
    w.place(0, 64, 0, 'torchflower_crop', { age: '0' });
    w.place(1, 64, 0, 'pitcher_crop', { age: '0', half: 'lower' });
    for (let i = 0; i < 400; i++) {
      w.tick(0, 64, 0);
      w.tick(1, 64, 0);
    }
    expect(w.id(0, 64, 0)).toBe('torchflower');
    expect(w.id(1, 64, 0)).toBe('pitcher_plant');
    expect(w.id(1, 65, 0)).toBe('pitcher_plant');
  });

  it('ripens cocoa on its jungle log, three stages and no further', () => {
    const w = new Field();
    w.place(2, 64, 0, 'jungle_log', { axis: 'y' });
    w.place(2, 64, 1, 'cocoa', { age: '0', facing: 'north' });
    for (let i = 0; i < 200; i++) w.tick(2, 64, 1);
    expect(w.prop(2, 64, 1, 'age')).toBe('2');
  });
});

describe('bone meal', () => {
  const meal = (w: Field, x: number, y: number, z: number): boolean => applyBoneMeal(w, x, y, z, w.getBlock(x, y, z));

  it('moves a crop on, and cocoa by a single stage', () => {
    const w = new Field();
    w.place(0, 63, 0, 'farmland', { moisture: '7' });
    w.place(0, 64, 0, 'wheat', { age: '0' });
    expect(meal(w, 0, 64, 0)).toBe(true);
    expect(Number(w.prop(0, 64, 0, 'age'))).toBeGreaterThan(1);

    w.place(2, 64, 0, 'jungle_log', { axis: 'y' });
    w.place(2, 64, 1, 'cocoa', { age: '0', facing: 'north' });
    expect(meal(w, 2, 64, 1)).toBe(true);
    expect(w.prop(2, 64, 1, 'age')).toBe('1');
  });

  it('grows kelp up, doubles seagrass and multiplies a sea pickle', () => {
    const w = new Field();
    for (let y = 50; y <= 60; y++) w.place(6, y, 0, 'water');
    w.place(6, 50, 0, 'kelp_plant');
    expect(meal(w, 6, 50, 0)).toBe(true);
    expect(w.id(6, 51, 0)).toBe('kelp');

    w.place(5, 62, 0, 'water');
    w.place(5, 61, 0, 'seagrass');
    expect(meal(w, 5, 61, 0)).toBe(true);
    expect(w.id(5, 61, 0)).toBe('tall_seagrass');
    expect(w.id(5, 62, 0)).toBe('tall_seagrass');

    w.place(7, 60, 0, 'sea_pickle', { pickles: '1', waterlogged: 'true' });
    expect(meal(w, 7, 60, 0)).toBe(true);
    expect(w.prop(7, 60, 0, 'pickles')).toBe('2');
  });

  it('spreads moss over the ground around it', () => {
    const w = new Field();
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) w.place(20 + dx, 63, dz, 'stone');
    w.place(20, 63, 0, 'moss_block');
    expect(meal(w, 20, 63, 0)).toBe(true);
    let patch = 0;
    for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) if (w.id(20 + dx, 63, dz) === 'moss_block') patch++;
    expect(patch).toBeGreaterThan(5);
  });

  it('does nothing to a block that does not grow', () => {
    const w = new Field();
    w.place(0, 63, 0, 'stone');
    expect(meal(w, 0, 63, 0)).toBe(false);
  });
});
