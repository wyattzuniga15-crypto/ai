import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { Rng } from '../src/core/rng.ts';
import { Simulation } from '../src/world/simulation.ts';
import { emitted, isPowered, powerAt, wireConnection } from '../src/world/redstone.ts';
import type { BlockWorld } from '../src/blocks/behaviors.ts';
import { createBlockEntity } from '../src/blocks/blockEntity.ts';
import { analogOutput, comparatorOutput, containerSignal } from '../src/world/redstone.ts';

/**
 * A slab of stone with the simulation running over it, so the tests drive redstone through the same
 * neighbour updates and scheduled ticks the game does.
 */
class Bench implements BlockWorld {
  readonly map = new Map<string, number>();
  readonly ignited: [number, number, number][] = [];
  readonly notes: [number, number, number][] = [];
  readonly sim: Simulation;
  rng = new Rng(7);
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

  /** Puts a block down and lets the world settle around it. */
  place(x: number, y: number, z: number, id: string, props: Record<string, string> = {}): void {
    this.setBlock(x, y, z, Object.keys(props).length ? blocks.stateWith(id, props) : blocks.defaultState(id));
    this.run();
  }

  /** Runs the simulation for a few ticks, which is long enough for any of these circuits. */
  run(ticks = 10): void {
    for (let i = 0; i < ticks; i++) this.sim.tick(++this.time, 0, 0);
  }

  power(x: number, y: number, z: number): number {
    const state = this.getBlock(x, y, z);
    return state === 0 ? 0 : Number(blocks.prop(state, 'power') ?? '0');
  }

  id(x: number, y: number, z: number): string {
    const state = this.getBlock(x, y, z);
    return state === 0 ? 'air' : blocks.blockOf(state).id;
  }

  prop(x: number, y: number, z: number, name: string): string | undefined {
    return blocks.prop(this.getBlock(x, y, z), name);
  }

  readonly entities = new Map<string, import('../src/blocks/blockEntity.ts').BlockEntity>();

  getBlockEntity(x: number, y: number, z: number) {
    return this.entities.get(`${x},${y},${z}`);
  }

  /** Puts a container down with something in it, which is what a comparator is there to measure. */
  placeContainer(x: number, y: number, z: number, id: string, items: (import('../src/items/inventory.ts').Slot)[]): void {
    this.place(x, y, z, id);
    const entity = createBlockEntity(id)!;
    if ('items' in entity) for (let i = 0; i < items.length; i++) entity.items[i] = items[i];
    this.entities.set(`${x},${y},${z}`, entity);
    this.sim.pokeNeighbors(x, y, z);
    this.run();
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

  startFalling(): void {}
  isDay(): boolean {
    return true;
  }

  isRaining(): boolean {
    return false;
  }

  message(): void {}
  sleep(): void {}
  addXp(): void {}
  feed(): void {}
  dropItem(): void {}
  igniteTnt(x: number, y: number, z: number): void {
    this.ignited.push([x, y, z]);
    this.setBlock(x, y, z, 0);
  }

  playNote(x: number, y: number, z: number): void {
    this.notes.push([x, y, z]);
  }

  readonly dispensed: [number, number, number][] = [];

  dispense(x: number, y: number, z: number): void {
    this.dispensed.push([x, y, z]);
  }
}

/** A run of dust along +x at y 64, on the stone floor. */
function dustLine(w: Bench, length: number): void {
  for (let x = 0; x < length; x++) w.place(x, 64, 0, 'redstone_wire');
}

describe('redstone power', () => {
  it('carries a signal down a line of dust, one weaker each block', () => {
    const w = new Bench();
    dustLine(w, 8);
    expect(w.power(0, 64, 0)).toBe(0); // nothing is powering it yet
    w.place(-1, 64, 0, 'redstone_block');
    expect(w.power(0, 64, 0)).toBe(15);
    expect(w.power(1, 64, 0)).toBe(14);
    expect(w.power(7, 64, 0)).toBe(8);
    // pull the source out and the whole line goes dark
    w.setBlock(-1, 64, 0, 0);
    w.run();
    expect(w.power(0, 64, 0)).toBe(0);
    expect(w.power(7, 64, 0)).toBe(0);
  });

  it('runs out after fifteen blocks', () => {
    const w = new Bench();
    for (let x = 0; x < 17; x++) w.place(x, 64, 0, 'redstone_wire');
    w.place(-1, 64, 0, 'redstone_block');
    expect(w.power(14, 64, 0)).toBe(1);
    expect(w.power(15, 64, 0)).toBe(0);
    expect(w.power(16, 64, 0)).toBe(0);
  });

  it('switches with a lever, and lights a lamp through the block it is on', () => {
    const w = new Bench();
    dustLine(w, 4);
    w.place(4, 64, 0, 'redstone_lamp');
    w.place(-1, 64, 0, 'lever', { face: 'floor', facing: 'north', powered: 'false' });
    expect(w.power(0, 64, 0)).toBe(0);
    expect(w.prop(4, 64, 0, 'lit')).toBe('false');

    w.setBlock(-1, 64, 0, blocks.stateWith('lever', { face: 'floor', facing: 'north', powered: 'true' }));
    w.run();
    expect(w.power(0, 64, 0)).toBe(15);
    expect(w.prop(4, 64, 0, 'lit')).toBe('true');

    w.setBlock(-1, 64, 0, blocks.stateWith('lever', { face: 'floor', facing: 'north', powered: 'false' }));
    w.run();
    expect(w.power(0, 64, 0)).toBe(0);
    expect(w.prop(4, 64, 0, 'lit')).toBe('false'); // four ticks later, and the bench ran ten
  });

  it('inverts with a torch: powering the block it stands on puts it out', () => {
    const w = new Bench();
    w.place(0, 64, 0, 'stone');
    w.place(0, 65, 0, 'redstone_torch', { lit: 'true' });
    w.place(1, 65, 0, 'redstone_wire');
    w.run();
    expect(w.power(1, 65, 0)).toBe(15); // the torch feeds the dust beside it

    // power the block under the torch and it goes out
    w.place(-1, 64, 0, 'redstone_block');
    w.run();
    expect(w.prop(0, 65, 0, 'lit')).toBe('false');
    expect(w.power(1, 65, 0)).toBe(0);

    w.setBlock(-1, 64, 0, 0);
    w.run();
    expect(w.prop(0, 65, 0, 'lit')).toBe('true');
    expect(w.power(1, 65, 0)).toBe(15);
  });

  it('repeats a fading signal back up to full strength', () => {
    const w = new Bench();
    for (let x = 0; x < 12; x++) w.place(x, 64, 0, 'redstone_wire');
    w.place(-1, 64, 0, 'redstone_block');
    expect(w.power(11, 64, 0)).toBe(4);
    // a repeater facing east takes what reaches it and sends fifteen on
    w.place(12, 64, 0, 'repeater', { facing: 'east', delay: '1', locked: 'false', powered: 'false' });
    for (let x = 13; x < 18; x++) w.place(x, 64, 0, 'redstone_wire');
    w.run();
    expect(w.prop(12, 64, 0, 'powered')).toBe('true');
    expect(w.power(13, 64, 0)).toBe(15);
    expect(w.power(17, 64, 0)).toBe(11);
  });

  it('compares and subtracts with a comparator, keeping the level', () => {
    const w = new Bench();
    // a block of redstone into four blocks of dust leaves twelve reaching the comparator
    for (let x = 0; x < 4; x++) w.place(x, 64, 0, 'redstone_wire');
    w.place(-1, 64, 0, 'redstone_block');
    w.place(4, 64, 0, 'comparator', { facing: 'east', mode: 'compare', powered: 'false' });
    for (let x = 5; x <= 6; x++) w.place(x, 64, 0, 'redstone_wire');
    w.run();
    expect(w.prop(4, 64, 0, 'powered')).toBe('true');
    // vanilla passes the level through rather than turning it back up to fifteen
    expect(w.power(3, 64, 0)).toBe(12);
    expect(w.power(5, 64, 0)).toBe(12);
    expect(w.power(6, 64, 0)).toBe(11);

    // a weaker signal on the side changes nothing in compare mode
    w.place(4, 64, -6, 'redstone_block');
    for (let z = -5; z <= -1; z++) w.place(4, 64, z, 'redstone_wire');
    w.run();
    expect(w.power(4, 64, -1)).toBe(11);
    expect(w.power(5, 64, 0)).toBe(12);

    // subtract mode takes the side off the back
    w.place(4, 64, 0, 'comparator', { facing: 'east', mode: 'subtract', powered: 'true' });
    w.run();
    expect(w.power(5, 64, 0)).toBe(1);
    expect(w.prop(4, 64, 0, 'powered')).toBe('true');

    // and a stronger side shuts compare mode off altogether
    w.place(4, 64, 0, 'comparator', { facing: 'east', mode: 'compare', powered: 'true' });
    w.place(4, 64, -1, 'redstone_block');
    w.run();
    expect(w.prop(4, 64, 0, 'powered')).toBe('false');
    expect(w.power(5, 64, 0)).toBe(0);
  });

  it('measures what a container holds, the way vanilla weighs it', () => {
    // vanilla: each stack counts for the fraction of its own limit it fills, averaged over the slots
    expect(containerSignal(new Array(27).fill(null))).toBe(0);
    expect(containerSignal([{ id: 'stone', count: 1 }, ...new Array(26).fill(null)])).toBe(1);
    expect(containerSignal(new Array(27).fill({ id: 'stone', count: 64 }))).toBe(15);
    expect(containerSignal(new Array(27).fill({ id: 'stone', count: 32 }))).toBe(8);
    // an unstackable item fills its slot on its own
    expect(containerSignal([{ id: 'diamond_sword', count: 1 }, ...new Array(4).fill(null)])).toBe(3);
  });

  it('reads a chest, a jukebox and the blocks that carry a level of their own', () => {
    const w = new Bench();
    w.placeContainer(0, 64, 0, 'chest', [{ id: 'stone', count: 64 }]);
    expect(analogOutput(w, 0, 64, 0)).toBe(1);
    w.placeContainer(1, 64, 0, 'chest', new Array(27).fill({ id: 'stone', count: 64 }));
    expect(analogOutput(w, 1, 64, 0)).toBe(15);
    w.placeContainer(2, 64, 0, 'jukebox', [{ id: 'music_disc_pigstep', count: 1 }]);
    expect(analogOutput(w, 2, 64, 0)).toBe(13);
    w.place(3, 64, 0, 'composter', { level: '5' });
    expect(analogOutput(w, 3, 64, 0)).toBe(5);
    w.place(4, 64, 0, 'water_cauldron', { level: '2' });
    expect(analogOutput(w, 4, 64, 0)).toBe(2);
    w.place(5, 64, 0, 'cake', { bites: '3' });
    expect(analogOutput(w, 5, 64, 0)).toBe(8);
    w.place(6, 64, 0, 'end_portal_frame', { eye: 'true', facing: 'north' });
    expect(analogOutput(w, 6, 64, 0)).toBe(15);
    w.place(7, 64, 0, 'stone');
    expect(analogOutput(w, 7, 64, 0)).toBeNull();
    // a crafter counts its slots instead of weighing them, filled or switched off alike
    w.placeContainer(8, 64, 0, 'crafter', [{ id: 'stone', count: 1 }, null, { id: 'stone', count: 64 }]);
    const crafter = w.getBlockEntity(8, 64, 0)!;
    expect(analogOutput(w, 8, 64, 0)).toBe(2);
    if (crafter.type === 'crafter') crafter.disabled[4] = true;
    expect(analogOutput(w, 8, 64, 0)).toBe(3);
  });

  it('drives dust off a chest through a comparator', () => {
    const w = new Bench();
    w.place(0, 64, 0, 'comparator', { facing: 'east', mode: 'compare', powered: 'false' });
    for (let x = 1; x < 5; x++) w.place(x, 64, 0, 'redstone_wire');
    w.placeContainer(-1, 64, 0, 'chest', new Array(27).fill({ id: 'stone', count: 32 }));
    expect(comparatorOutput(w, 0, 64, 0, w.getBlock(0, 64, 0))).toBe(8);
    expect(w.prop(0, 64, 0, 'powered')).toBe('true');
    expect(w.power(1, 64, 0)).toBe(8);
    expect(w.power(4, 64, 0)).toBe(5);

    // emptying it drops the signal, once the poke that a container change sends has gone round
    const entity = w.getBlockEntity(-1, 64, 0)!;
    if ('items' in entity) entity.items.fill(null);
    w.sim.pokeNeighbors(-1, 64, 0);
    w.run();
    expect(w.prop(0, 64, 0, 'powered')).toBe('false');
    expect(w.power(1, 64, 0)).toBe(0);
  });

  it('opens a door and lights a fuse', () => {
    const w = new Bench();
    w.place(0, 64, 0, 'oak_door', { facing: 'north', half: 'lower', hinge: 'left', open: 'false', powered: 'false' });
    w.place(0, 65, 0, 'oak_door', { facing: 'north', half: 'upper', hinge: 'left', open: 'false', powered: 'false' });
    w.place(2, 64, 0, 'tnt');
    w.place(1, 64, 0, 'redstone_block');
    w.run();
    expect(w.prop(0, 64, 0, 'open')).toBe('true');
    expect(w.prop(0, 65, 0, 'open')).toBe('true'); // both halves swing together
    expect(w.ignited).toEqual([[2, 64, 0]]);

    w.setBlock(1, 64, 0, 0);
    w.run();
    expect(w.prop(0, 64, 0, 'open')).toBe('false');
  });
});

describe('redstone wiring', () => {
  it('draws itself as a cross alone and a line in a run', () => {
    const w = new Bench();
    w.place(0, 64, 0, 'redstone_wire');
    for (const dir of ['north', 'south', 'east', 'west']) expect(w.prop(0, 64, 0, dir)).toBe('side');
    w.place(1, 64, 0, 'redstone_wire');
    w.place(2, 64, 0, 'redstone_wire');
    w.run();
    expect(w.prop(1, 64, 0, 'east')).toBe('side');
    expect(w.prop(1, 64, 0, 'west')).toBe('side');
    expect(w.prop(1, 64, 0, 'north')).toBe('none');
    expect(w.prop(1, 64, 0, 'south')).toBe('none');
  });

  it('climbs a step and falls down one', () => {
    const w = new Bench();
    w.place(0, 64, 0, 'redstone_wire');
    w.place(1, 64, 0, 'stone');
    w.place(1, 65, 0, 'redstone_wire');
    w.run();
    expect(wireConnection(w, 0, 64, 0, 'east')).toBe('up');
    expect(w.prop(0, 64, 0, 'east')).toBe('up');
    // and the signal climbs with it
    w.place(-1, 64, 0, 'redstone_block');
    expect(w.power(1, 65, 0)).toBe(14);
  });

  it('reads power through a charged block but not a weak one', () => {
    const w = new Bench();
    // a torch charges the block above it, so dust on that block is powered
    w.place(0, 64, 0, 'redstone_torch', { lit: 'true' });
    w.place(0, 65, 0, 'stone');
    w.place(0, 66, 0, 'redstone_wire');
    w.run();
    expect(w.power(0, 66, 0)).toBe(15);
    expect(emitted(w, 0, 64, 0, 'up', true)).toBe(15);

    // dust only weakly powers the block it runs into, so dust the other side stays dark
    const b = new Bench();
    b.place(0, 64, 0, 'redstone_block');
    b.place(1, 64, 0, 'redstone_wire');
    b.place(2, 64, 0, 'stone');
    b.place(3, 64, 0, 'redstone_wire');
    b.run();
    expect(b.power(1, 64, 0)).toBe(15);
    expect(b.power(3, 64, 0)).toBe(0);
    expect(isPowered(b, 2, 64, 0)).toBe(true); // the block itself is powered, just not through
    expect(powerAt(b, 3, 64, 0)).toBe(0);
  });
});

describe('pistons', () => {
  it('shoves a line of blocks along and takes them back when it is sticky', () => {
    const w = new Bench();
    w.place(0, 64, 0, 'sticky_piston', { facing: 'east', extended: 'false' });
    w.place(1, 64, 0, 'stone');
    w.place(2, 64, 0, 'dirt');
    w.place(-1, 64, 0, 'redstone_block');
    w.run();
    expect(w.prop(0, 64, 0, 'extended')).toBe('true');
    expect(w.id(1, 64, 0)).toBe('piston_head');
    expect(w.id(2, 64, 0)).toBe('stone'); // both blocks moved one along
    expect(w.id(3, 64, 0)).toBe('dirt');

    w.setBlock(-1, 64, 0, 0);
    w.run();
    expect(w.prop(0, 64, 0, 'extended')).toBe('false');
    expect(w.id(1, 64, 0)).toBe('stone'); // the sticky head dragged the stone back
    expect(w.id(2, 64, 0)).toBe('air');
    expect(w.id(3, 64, 0)).toBe('dirt');
  });

  it('refuses to push what is anchored, and pushes at most twelve blocks', () => {
    const w = new Bench();
    w.place(0, 64, 0, 'piston', { facing: 'east', extended: 'false' });
    w.place(1, 64, 0, 'stone');
    w.place(2, 64, 0, 'obsidian');
    w.place(-1, 64, 0, 'redstone_block');
    w.run();
    expect(w.prop(0, 64, 0, 'extended')).toBe('false'); // obsidian will not budge
    expect(w.id(1, 64, 0)).toBe('stone');

    const b = new Bench();
    b.place(0, 64, 0, 'piston', { facing: 'east', extended: 'false' });
    for (let x = 1; x <= 13; x++) b.place(x, 64, 0, 'stone');
    b.place(-1, 64, 0, 'redstone_block');
    b.run();
    expect(b.prop(0, 64, 0, 'extended')).toBe('false'); // thirteen is one too many
  });

  it('breaks the soft thing in its way and drops its head when it is taken out', () => {
    const w = new Bench();
    w.place(0, 64, 0, 'piston', { facing: 'east', extended: 'false' });
    w.place(1, 64, 0, 'stone');
    w.place(2, 64, 0, 'torch');
    w.place(-1, 64, 0, 'redstone_block');
    w.run();
    expect(w.prop(0, 64, 0, 'extended')).toBe('true');
    expect(w.id(2, 64, 0)).toBe('stone');

    // pull the piston out and its head goes with it
    w.setBlock(0, 64, 0, 0);
    w.run();
    expect(w.id(1, 64, 0)).toBe('air');
  });
});

describe('dispensers', () => {
  it('fires once on a rising signal and waits for the next one', () => {
    const w = new Bench();
    w.place(0, 64, 0, 'dispenser', { facing: 'east', triggered: 'false' });
    w.place(-1, 64, 0, 'redstone_block');
    w.run();
    expect(w.prop(0, 64, 0, 'triggered')).toBe('true');
    expect(w.dispensed.length).toBe(1);
    w.run();
    expect(w.dispensed.length).toBe(1); // holding the signal does not fire it again

    w.setBlock(-1, 64, 0, 0);
    w.run();
    expect(w.prop(0, 64, 0, 'triggered')).toBe('false');
    w.place(-1, 64, 0, 'redstone_block');
    expect(w.dispensed.length).toBe(2);
  });
});
