/**
 * The sixteen harnesses and the happy ghast that wears one: the item, the equipment layer it draws
 * with, where Mojang seats its riders and how fast one flies with somebody aboard.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { HAPPY_GHAST_BACKWARDS, HAPPY_GHAST_HARNESS_LAYER, HAPPY_GHAST_SEAT, HAPPY_GHAST_SEATS, HAPPY_GHAST_STEP_OFF, HAPPY_GHAST_TEMPT_RANGE, HAPPY_GHAST_TEMPT_STOP, HARNESS_COLORS, MOB_SPECS, harnessLayer, isHarness, mobStats } from '../src/entities/mobTypes.ts';
import { items } from '../src/items/registry.ts';
import { tabOf } from '../src/items/creativeTabs.ts';
import { craftingRecipes } from '../src/items/crafting.ts';

describe('the harness items', () => {
  it('ships all sixteen, one per dye', () => {
    const all = items.defs.filter((d) => d.id.endsWith('_harness'));
    expect(all).toHaveLength(16);
    for (const d of all) {
      expect(d.stack, d.id).toBe(1);
      expect(d.behavior, d.id).toBe('animal_equipment');
      expect(isHarness(d.id), d.id).toBe(true);
    }
    expect(HARNESS_COLORS).toHaveLength(16);
    expect(HARNESS_COLORS).toContain('light_gray');
  });

  it('knows a harness from a saddle or from horse armour', () => {
    expect(isHarness('saddle')).toBe(false);
    expect(isHarness('iron_horse_armor')).toBe(false);
    expect(isHarness('wolf_armor')).toBe(false);
    expect(isHarness('rainbow_harness')).toBe(false);
  });

  it('lists every one with the saddle, in tools and utilities', () => {
    for (const c of HARNESS_COLORS) expect(tabOf(items.get(`${c}_harness`)), c).toBe('tools_and_utilities');
  });

  it('is made from three leather over glass, wool and glass', () => {
    const made = craftingRecipes.filter((r) => r.group === 'harness');
    expect(made.length).toBeGreaterThanOrEqual(16);
    const white = made.find((r) => r.result.item === 'white_harness')!;
    expect(white.type).toBe('shaped');
    expect(white.pattern).toEqual(['LLL', 'G#G']);
    expect(white.key!['#']).toBe('white_wool');
  });

  it('has the body texture Mojang draws each one with', () => {
    for (const c of HARNESS_COLORS) {
      expect(harnessLayer(`${c}_harness`)).toBe(`equipment/happy_ghast_body/${c}_harness.png`);
      expect(fs.existsSync(`public/textures/entity/${harnessLayer(`${c}_harness`)}`), c).toBe(true);
    }
    expect(HAPPY_GHAST_HARNESS_LAYER).toBe(harnessLayer('white_harness'));
  });
});

describe('the happy ghast', () => {
  it('is the ghast built again on its own skin, with the harness hidden until one goes on', () => {
    const model = MOB_SPECS.happy_ghast.model;
    const byName = new Map(model.parts.map((p) => [p.name, p]));
    expect(model.texture).toBe('ghast/happy_ghast.png');
    // its skin is the ghast's net on a sheet twice as tall: the goggles live in the half below
    expect(model.texW).toBe(64);
    expect(model.texH).toBe(64);
    expect(byName.get('body')!.boxes[0].box).toEqual([-8, -8, -8, 16, 16, 16]);
    expect([...byName.keys()].filter((n) => n.startsWith('tentacle'))).toHaveLength(9);
    for (const n of ['harness', 'goggles']) {
      expect(byName.get(n)!.hidden, n).toBe(true);
      expect(byName.get(n)!.texture, n).toBe(HAPPY_GHAST_HARNESS_LAYER);
    }
    // the straps wrap the body a hair proud of it; the goggles sit across the front at eye height
    expect(byName.get('harness')!.boxes[0].inflate).toBeGreaterThan(0);
    expect(byName.get('goggles')!.parent).toBe('harness');
    expect(byName.get('goggles')!.boxes[0].uv).toEqual([0, 32]);
    expect(byName.get('goggles')!.boxes[0].box).toEqual([-8, -5, -8, 16, 5, 5]);
  });

  it('flies, and is as big and as tough as vanilla makes it', () => {
    const stats = mobStats('happy_ghast')!;
    expect(stats.flying).toBe(true);
    expect(stats.health).toBe(20);
    expect(stats.width).toBe(4);
    expect(stats.height).toBe(4);
    expect(stats.speed).toBeCloseTo(0.05, 5);
  });

  it('is tempted by a snowball and by the harness itself', () => {
    const goals = MOB_SPECS.happy_ghast.goals!();
    expect(goals.length).toBeGreaterThan(1);
    expect(HAPPY_GHAST_TEMPT_RANGE).toBe(16);
    // it is four blocks wide, so Mojang has it pull up seven blocks short rather than in your face
    expect(HAPPY_GHAST_TEMPT_STOP).toBe(7);
  });

  it('seats four riders round its top, where Mojang puts them', () => {
    expect(HAPPY_GHAST_SEAT).toBeCloseTo(3.8, 5);
    expect(HAPPY_GHAST_SEATS).toEqual([[0, 1.7], [-1.7, 0], [0, -1.7], [1.7, 0]]);
    // every seat the same distance out, a quarter turn apart
    for (const [x, z] of HAPPY_GHAST_SEATS) expect(Math.hypot(x, z)).toBeCloseTo(1.7, 5);
  });

  it('backs up at half speed, and only lets a rider off over ground', () => {
    expect(HAPPY_GHAST_BACKWARDS).toBe(0.5);
    expect(HAPPY_GHAST_STEP_OFF).toBeGreaterThan(0);
  });
});
