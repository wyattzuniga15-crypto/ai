/**
 * Boats and rafts: the model cut from vanilla's own texture net, the ids each wood makes, and the
 * way one floats, is rowed and stops on land.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import * as THREE from 'three';
import { BOAT_LAND_FRICTION, BOAT_MAX_SPEED, BOAT_PADDLE_PUSH, BOAT_WATER_FRICTION, BOAT_WOODS, Boat, boatItem, boatItemId, boatModel } from '../src/entities/boat.ts';
import { blocks } from '../src/blocks/registry.ts';
import { items } from '../src/items/registry.ts';

beforeAll(() => {
  THREE.TextureLoader.prototype.load = function load() { return new THREE.Texture(); } as never;
});

/** Water up to y 10 over stone, and air above. */
const pond = {
  getBlock: (_x: number, y: number, _z: number) => (y < 0 ? blocks.defaultState('stone') : y < 10 ? blocks.defaultState('water') : 0),
};
const dry = { getBlock: (_x: number, y: number, _z: number) => (y < 0 ? blocks.defaultState('stone') : 0) };

describe('the boats', () => {
  it('names every wood the game has an item for', () => {
    expect(BOAT_WOODS).toHaveLength(10);
    for (const wood of BOAT_WOODS) {
      for (const chest of [false, true]) {
        const id = boatItemId(wood, chest);
        expect(items.byId.has(id), id).toBe(true);
        expect(boatItem(id), id).toEqual({ wood, chest });
      }
    }
    // a bamboo one is a raft rather than a boat, and only bamboo is
    expect(boatItemId('bamboo', false)).toBe('bamboo_raft');
    expect(boatItemId('oak', false)).toBe('oak_boat');
    expect(boatItem('oak_planks')).toBeNull();
    expect(boatItem('minecart')).toBeNull();
  });

  it('is cut from the net vanilla ships: a floor, four walls and two oars', () => {
    const model = boatModel('oak', false);
    expect(model.texture).toBe('boat/oak.png');
    expect([model.texW, model.texH]).toEqual([128, 64]);
    const parts = new Map(model.parts.map((p) => [p.name, p]));
    expect([...parts.keys()]).toEqual(['bottom', 'back', 'front', 'right', 'left', 'left_paddle', 'right_paddle']);
    // the sizes come off the texture's own regions
    expect(parts.get('bottom')!.boxes[0].box.slice(3)).toEqual([28, 16, 3]);
    expect(parts.get('back')!.boxes[0].box.slice(3)).toEqual([18, 6, 2]);
    expect(parts.get('front')!.boxes[0].box.slice(3)).toEqual([16, 6, 2]);
    expect(parts.get('left')!.boxes[0].box.slice(3)).toEqual([28, 6, 2]);
    expect(parts.get('right')!.boxes[0].box.slice(3)).toEqual([28, 6, 2]);
    // each oar is a shaft and a blade, and the two are cut from different rows of the sheet
    expect(parts.get('left_paddle')!.boxes.map((b) => b.uv[1])).toEqual([0, 0]);
    expect(parts.get('right_paddle')!.boxes.map((b) => b.uv[1])).toEqual([20, 20]);
    expect(parts.get('left_paddle')!.boxes[0].box.slice(3)).toEqual([2, 2, 18]);
    expect(parts.get('left_paddle')!.boxes[1].box.slice(3)).toEqual([1, 6, 7]);
  });

  it('adds a chest to a chest boat and a taller sheet to draw it on', () => {
    const model = boatModel('oak', true);
    expect(model.texture).toBe('chest_boat/oak.png');
    expect(model.texH).toBe(128);
    const chest = model.parts.find((p) => p.name === 'chest')!;
    expect(chest.boxes).toHaveLength(3);
    expect(chest.boxes[0].box.slice(3)).toEqual([12, 8, 12]);
    expect(chest.boxes[1].box.slice(3)).toEqual([12, 5, 12]);
    expect(boatModel('oak', false).parts.some((p) => p.name === 'chest')).toBe(false);
  });

  it('floats where the water is and settles on the ground where it is not', () => {
    const floating = new Boat('boat', 'oak', 0, 4, 0, '');
    for (let i = 0; i < 200; i++) floating.tick(pond);
    // it comes to rest at the surface rather than sinking to the bottom or flying out
    expect(floating.pos.y).toBeGreaterThan(9);
    expect(floating.pos.y).toBeLessThan(11);
    expect(Math.abs(floating.vel.y)).toBeLessThan(0.1);

    const grounded = new Boat('boat', 'oak', 0, 6, 0, '');
    for (let i = 0; i < 100; i++) grounded.tick(dry);
    expect(grounded.pos.y).toBe(0);
  });

  it('is rowed by turning and then pushing, and rubs to a stop when the oars stop', () => {
    const boat = new Boat('boat', 'oak', 0, 10, 0, '');
    boat.control = { forward: 1, turn: 0 };
    for (let i = 0; i < 60; i++) boat.tick(pond);
    const speed = Math.hypot(boat.vel.x, boat.vel.z);
    expect(speed).toBeGreaterThan(0.1);
    expect(speed).toBeLessThanOrEqual(BOAT_MAX_SPEED + 1e-9);
    // a stroke a tick against the water's drag settles just under the speed limit
    expect(speed).toBeCloseTo((BOAT_PADDLE_PUSH * BOAT_WATER_FRICTION) / (1 - BOAT_WATER_FRICTION), 2);
    const before = boat.pos.z;
    expect(before).toBeLessThan(0); // it went the way it was pointing, which is -z

    boat.control = null;
    for (let i = 0; i < 60; i++) boat.tick(pond);
    expect(Math.hypot(boat.vel.x, boat.vel.z)).toBeLessThan(0.01);

    const turning = new Boat('boat', 'oak', 0, 10, 0, '');
    turning.control = { forward: 0, turn: 1 };
    for (let i = 0; i < 20; i++) turning.tick(pond);
    expect(turning.yaw).toBeGreaterThan(0.2);
    expect(BOAT_LAND_FRICTION).toBeLessThan(BOAT_WATER_FRICTION);
  });
});
