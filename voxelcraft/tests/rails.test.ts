import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { blocks } from '../src/blocks/registry.ts';
import { railLinks, railPowered, railShape } from '../src/world/rails.ts';
import { Minecart } from '../src/entities/minecart.ts';

/** A flat floor of stone with rails laid on top of it, at y = 64. */
class Track {
  readonly map = new Map<string, number>();

  constructor() {
    for (let x = -4; x <= 40; x++) for (let z = -4; z <= 8; z++) this.map.set(`${x},63,${z}`, blocks.defaultState('stone'));
  }

  getBlock(x: number, y: number, z: number): number {
    return this.map.get(`${x},${y},${z}`) ?? 0;
  }

  set(x: number, y: number, z: number, id: string, props: Record<string, string> = {}): void {
    this.map.set(`${x},${y},${z}`, Object.keys(props).length ? blocks.stateWith(id, props) : blocks.defaultState(id));
  }

  /** Rails never write blocks back, but the power model asks for the method. */
  setBlock(x: number, y: number, z: number, state: number): void {
    if (state === 0) this.map.delete(`${x},${y},${z}`);
    else this.map.set(`${x},${y},${z}`, state);
  }

  /** Lays a run of rail along x, shaping each piece as vanilla would when it is placed. */
  lay(x0: number, x1: number, z: number, id = 'rail', props: Record<string, string> = {}): void {
    for (let x = x0; x <= x1; x++) this.set(x, 64, z, id, { shape: 'east_west', ...props });
  }

  shape(x: number, y: number, z: number): string {
    return blocks.prop(this.getBlock(x, y, z), 'shape') ?? '';
  }
}

const cartAt = (x: number, y: number, z: number): Minecart => new Minecart('minecart', x, y, z, new THREE.Object3D());

describe('rail shapes', () => {
  it('runs straight between two neighbours', () => {
    const t = new Track();
    t.lay(0, 2, 0);
    expect(railShape(t, 1, 64, 0, 'rail')).toBe('east_west');
  });

  it('points at its only neighbour', () => {
    const t = new Track();
    t.set(0, 64, 0, 'rail');
    t.set(0, 64, 1, 'rail');
    expect(railShape(t, 0, 64, 0, 'rail')).toBe('north_south');
  });

  it('bends a plain rail round a corner but not a powered one', () => {
    const t = new Track();
    t.set(0, 64, 0, 'rail');
    t.set(1, 64, 0, 'rail'); // east
    t.set(0, 64, 1, 'rail'); // south
    expect(railShape(t, 0, 64, 0, 'rail')).toBe('south_east');
    expect(railShape(t, 0, 64, 0, 'powered_rail')).toMatch(/east_west|north_south/);
  });

  it('climbs to a rail one block up', () => {
    const t = new Track();
    t.set(0, 64, 0, 'rail');
    t.set(1, 65, 0, 'rail');
    expect(railLinks(t, 0, 64, 0).east).toBe('up');
    expect(railShape(t, 0, 64, 0, 'rail')).toBe('ascending_east');
  });
});

describe('powered rails', () => {
  it('turns on from a signal at the rail itself', () => {
    const t = new Track();
    t.lay(0, 0, 0, 'powered_rail', { powered: 'false' });
    expect(railPowered(t, 0, 64, 0, 'east_west')).toBe(false);
    t.set(0, 63, 0, 'redstone_block');
    expect(railPowered(t, 0, 64, 0, 'east_west')).toBe(true);
  });

  it('carries along eight rails and no further', () => {
    const t = new Track();
    t.lay(0, 9, 0, 'powered_rail', { powered: 'false' });
    t.set(0, 63, 0, 'redstone_block');
    expect(railPowered(t, 8, 64, 0, 'east_west')).toBe(true);
    expect(railPowered(t, 9, 64, 0, 'east_west')).toBe(false);
  });
});

describe('minecarts', () => {
  it('rolls along the rail it was pushed down', () => {
    const t = new Track();
    t.lay(0, 12, 0);
    const cart = cartAt(0.5, 64.1, 0.5);
    cart.tick(t, 0.1);
    expect(cart.vel.x).toBeGreaterThan(0);
    for (let i = 0; i < 20; i++) cart.tick(t);
    expect(cart.pos.x).toBeGreaterThan(2);
    expect(cart.pos.z).toBeCloseTo(0.5, 5); // it keeps to the middle of the track
  });

  it('is pushed up to the top speed by powered rails and no faster', () => {
    const t = new Track();
    t.lay(0, 34, 0, 'powered_rail', { powered: 'true' });
    const cart = cartAt(0.5, 64.1, 0.5);
    cart.tick(t, 0.05);
    for (let i = 0; i < 40; i++) cart.tick(t);
    expect(Math.abs(cart.vel.x)).toBeLessThanOrEqual(0.4 + 1e-9);
    expect(Math.abs(cart.vel.x)).toBeGreaterThan(0.3);
  });

  it('is started by a powered rail only when a block backs it', () => {
    const t = new Track();
    t.lay(0, 6, 0, 'powered_rail', { powered: 'true' });
    const still = cartAt(0.5, 64.1, 0.5);
    still.tick(t);
    expect(still.vel.x).toBe(0); // nothing to push away from

    t.set(-1, 64, 0, 'stone');
    const backed = cartAt(0.5, 64.1, 0.5);
    backed.tick(t);
    expect(backed.vel.x).toBeGreaterThan(0); // shoved east, away from the block
    for (let i = 0; i < 30; i++) backed.tick(t);
    expect(backed.pos.x).toBeGreaterThan(3);
  });

  it('is braked by an unpowered powered rail', () => {
    const t = new Track();
    t.lay(0, 12, 0, 'powered_rail', { powered: 'false' });
    const cart = cartAt(0.5, 64.1, 0.5);
    cart.tick(t, 0.3);
    const first = Math.abs(cart.vel.x);
    for (let i = 0; i < 10; i++) cart.tick(t);
    expect(Math.abs(cart.vel.x)).toBeLessThan(first * 0.5);
  });

  it('falls when it runs off the end of the track', () => {
    const t = new Track();
    t.lay(0, 1, 0);
    const cart = cartAt(1.5, 64.1, 0.5);
    cart.tick(t, 0.3);
    for (let i = 0; i < 30; i++) cart.tick(t);
    expect(cart.pos.x).toBeGreaterThan(2);
    expect(cart.pos.y).toBeCloseTo(64, 1); // it lands on the stone floor
  });

  it('lights a TNT cart on a powered activator rail', () => {
    const t = new Track();
    t.lay(0, 6, 0);
    t.set(3, 64, 0, 'activator_rail', { shape: 'east_west', powered: 'true' });
    const cart = new Minecart('tnt_minecart', 0.5, 64.1, 0.5, new THREE.Object3D());
    cart.tick(t, 0.2);
    for (let i = 0; i < 40 && cart.fuse < 0; i++) cart.tick(t);
    expect(cart.fuse).toBeGreaterThan(0);
    expect(cart.fuse).toBeLessThanOrEqual(80);
  });

  it('gives a chest cart its own twenty-seven slots', () => {
    expect(cartAt(0, 64, 0).items).toBeNull();
    expect(new Minecart('chest_minecart', 0, 64, 0, new THREE.Object3D()).items).toHaveLength(27);
    expect(new Minecart('hopper_minecart', 0, 64, 0, new THREE.Object3D()).items).toHaveLength(5);
  });
});
