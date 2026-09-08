/**
 * Paintings and item frames: Mojang's picture registry, the room a picture needs and where it sits
 * on the block it was hung from, and the eight turns an item in a frame takes.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { COUNTER_CLOCKWISE, FACING_VEC, FRAME_ROTATIONS, HANGING_DEPTH, PAINTINGS, PAINTING_BY_ID, WALL_FACINGS, choosePainting, hangingCells, hangingOffset, hangingStart } from '../src/entities/hanging.ts';
import { items } from '../src/items/registry.ts';

describe('the pictures', () => {
  it('is Mojang\'s whole registry, with the four that only a command gives you left out of the wall', () => {
    expect(PAINTINGS).toHaveLength(51);
    const placeable = PAINTINGS.filter((p) => p.placeable);
    expect(placeable).toHaveLength(47);
    for (const id of ['earth', 'fire', 'water', 'wind']) expect(PAINTING_BY_ID.get(id)!.placeable, id).toBe(false);
  });

  it('carries each one\'s size, name and painter', () => {
    const kebab = PAINTING_BY_ID.get('kebab')!;
    expect([kebab.width, kebab.height]).toEqual([1, 1]);
    expect(PAINTING_BY_ID.get('pigscene')!.width).toBe(4);
    expect(PAINTING_BY_ID.get('fighters')!.width).toBe(4);
    expect(PAINTING_BY_ID.get('fighters')!.height).toBe(2);
    expect(PAINTING_BY_ID.get('alban')!.author).toBe('Kristoffer Zetterstrand');
    for (const p of PAINTINGS) {
      expect(p.width, p.id).toBeGreaterThan(0);
      expect(p.height, p.id).toBeGreaterThan(0);
      expect(p.name, p.id).not.toBe('');
    }
  });

  it('has a texture on disk for every one, sixteen pixels to the block', () => {
    for (const p of PAINTINGS) {
      const file = `public/textures/painting/${p.id}.png`;
      expect(fs.existsSync(file), p.id).toBe(true);
      const b = fs.readFileSync(file);
      expect(b.readUInt32BE(16), `${p.id} width`).toBe(p.width * 16);
      expect(b.readUInt32BE(20), `${p.id} height`).toBe(p.height * 16);
    }
    expect(fs.existsSync('public/textures/painting/back.png')).toBe(true);
  });
});

describe('the room a picture needs', () => {
  it('grows counter-clockwise and up from the block it was hung on, the way Mojang does', () => {
    // sizes one and two start on the clicked block; three and four reach one back
    expect(hangingStart(1)).toBe(0);
    expect(hangingStart(2)).toBe(0);
    expect(hangingStart(3)).toBe(-1);
    expect(hangingStart(4)).toBe(-1);
    // an even side pushes the middle of the picture half a block that way
    expect(hangingOffset(1)).toBe(0);
    expect(hangingOffset(2)).toBe(0.5);
    expect(hangingOffset(3)).toBe(0);
    expect(hangingOffset(4)).toBe(0.5);
  });

  it('covers one block per block of the picture', () => {
    expect(hangingCells(1, 1, 'south')).toEqual([[0, 0, 0]]);
    expect(hangingCells(2, 2, 'south')).toHaveLength(4);
    expect(hangingCells(4, 3, 'south')).toHaveLength(12);
    const cells = hangingCells(2, 2, 'south');
    expect(new Set(cells.map((c) => c.join(','))).size).toBe(4);
  });

  it('turns the right way for each wall', () => {
    // counter-clockwise, looking down: south -> east -> north -> west
    expect(COUNTER_CLOCKWISE.south).toEqual([1, 0, 0]);
    expect(COUNTER_CLOCKWISE.north).toEqual([-1, 0, 0]);
    expect(COUNTER_CLOCKWISE.west).toEqual([0, 0, 1]);
    expect(COUNTER_CLOCKWISE.east).toEqual([0, 0, -1]);
    for (const f of WALL_FACINGS) {
      const [cx, , cz] = COUNTER_CLOCKWISE[f];
      const [fx, , fz] = FACING_VEC[f];
      // the turn is square to the way it faces
      expect(Math.abs(cx * fx + cz * fz), f).toBe(0);
    }
  });

  it('stands off the wall the distance Mojang stands one', () => {
    expect(HANGING_DEPTH).toBeCloseTo(0.46875, 6);
  });
});

describe('choosing one', () => {
  const always = () => true;

  it('takes the biggest that fits, and one of those at random', () => {
    const biggest = choosePainting(always, () => 0)!;
    expect(biggest.width * biggest.height).toBe(16);
    const all = new Set<string>();
    for (let i = 0; i < 40; i++) all.add(choosePainting(always, Math.random)!.id);
    // there are five four-by-fours, and over forty tries more than one should come up
    expect(all.size).toBeGreaterThan(1);
    for (const id of all) expect(PAINTING_BY_ID.get(id)!.width * PAINTING_BY_ID.get(id)!.height).toBe(16);
  });

  it('falls back to a smaller one in a smaller space', () => {
    const one = choosePainting((v) => v.width === 1 && v.height === 1, () => 0)!;
    expect([one.width, one.height]).toEqual([1, 1]);
    const wide = choosePainting((v) => v.height === 1 && v.width <= 2, () => 0)!;
    expect(wide.width).toBe(2);
  });

  it('never offers one a command alone can give you', () => {
    for (let i = 0; i < 60; i++) expect(choosePainting((v) => v.width === 2 && v.height === 2, Math.random)!.placeable).toBe(true);
  });

  it('gives nothing back when there is no room at all', () => {
    expect(choosePainting(() => false, Math.random)).toBeNull();
  });
});

describe('the items', () => {
  it('are the three vanilla hangs on a wall', () => {
    for (const id of ['painting', 'item_frame', 'glow_item_frame']) {
      expect(items.has(id), id).toBe(true);
      expect(items.get(id).behavior, id).toBe('placeable_entity');
    }
  });

  it('turns an item in a frame through eight and back round', () => {
    expect(FRAME_ROTATIONS).toBe(8);
    let r = 0;
    const seen = [];
    for (let i = 0; i < 9; i++) { seen.push(r); r = (r + 1) % FRAME_ROTATIONS; }
    expect(seen).toEqual([0, 1, 2, 3, 4, 5, 6, 7, 0]);
  });
});
