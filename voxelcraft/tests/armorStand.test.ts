/**
 * Armour stands and end crystals: Mojang's stand geometry with the four pieces of armour hung on
 * it at the biped's own sizes, and the crystal that only stands on obsidian or bedrock.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ARMOR_LAYER, ARMOR_MATERIALS, ARMOR_SLOT_LAYERS, LEGGINGS_LAYER, MOB_SPECS, armorLayerTexture, armorSlotOf, mobStats } from '../src/entities/mobTypes.ts';
import { items } from '../src/items/registry.ts';

describe('the armour stand', () => {
  it('stands in the game with vanilla\'s health and size', () => {
    const stats = mobStats('armor_stand')!;
    expect(stats.health).toBe(20);
    expect(stats.width).toBeCloseTo(0.5, 5);
    expect(stats.height).toBeCloseTo(1.975, 5);
    expect(MOB_SPECS.armor_stand.goals()).toHaveLength(0);
  });

  it('is Mojang\'s own geometry: a base plate under a frame of thin posts', () => {
    const byName = new Map(MOB_SPECS.armor_stand.model.parts.map((p) => [p.name, p]));
    expect(MOB_SPECS.armor_stand.model.texture).toBe('armorstand/wood.png');
    for (const n of ['baseplate', 'waist', 'body', 'head', 'left_arm', 'right_arm', 'left_leg', 'right_leg']) expect(byName.has(n), n).toBe(true);
    // the plate is twelve wide and one thick, on the ground
    expect(byName.get('baseplate')!.boxes[0].box).toEqual([-6, -1, -6, 12, 1, 12]);
    expect(byName.get('baseplate')!.pivot[1]).toBe(24);
    // the head is a thin post, not a block
    expect(byName.get('head')!.boxes[0].box).toEqual([-1, -7, -1, 2, 7, 2]);
  });

  it('wears the armour at the biped\'s sizes, each piece on its own material', () => {
    const byName = new Map(MOB_SPECS.armor_stand.model.parts.map((p) => [p.name, p]));
    for (const n of ['helmet', 'chest', 'right_sleeve', 'left_sleeve', 'right_boot', 'left_boot', 'belt', 'right_legging', 'left_legging']) {
      expect(byName.get(n)!.hidden, n).toBe(true);
    }
    // the helmet is the biped's head box grown by one, which is vanilla's outer armour layer
    expect(byName.get('helmet')!.boxes[0].box).toEqual([-4, -8, -4, 8, 8, 8]);
    expect(byName.get('helmet')!.boxes[0].inflate).toBe(1);
    // the leggings are the inner layer, a hair tighter and off their own sheet
    expect(byName.get('belt')!.boxes[0].inflate).toBe(0.5);
    expect(byName.get('belt')!.texture).toBe(LEGGINGS_LAYER);
    expect(byName.get('helmet')!.texture).toBe(ARMOR_LAYER);
    // four slots, four materials, so a gold chestplate and a diamond helmet are not the same colour
    const layers = new Set(['helmet', 'chest', 'right_boot', 'belt'].map((n) => byName.get(n)!.layer));
    expect(layers.size).toBe(4);
    expect(ARMOR_SLOT_LAYERS).toHaveLength(4);
  });
});

describe('the armour it wears', () => {
  it('puts each piece in vanilla\'s own slot order', () => {
    expect(armorSlotOf('iron_boots')).toBe(0);
    expect(armorSlotOf('iron_leggings')).toBe(1);
    expect(armorSlotOf('iron_chestplate')).toBe(2);
    expect(armorSlotOf('iron_helmet')).toBe(3);
    expect(armorSlotOf('turtle_helmet')).toBe(3);
    expect(armorSlotOf('carved_pumpkin')).toBe(3);
    expect(armorSlotOf('diamond_sword')).toBe(-1);
    expect(armorSlotOf('bread')).toBe(-1);
  });

  it('draws every material off the sheet vanilla draws it from', () => {
    for (const m of ARMOR_MATERIALS) {
      const id = `${m}_helmet`;
      if (!items.has(id)) continue;
      const tex = armorLayerTexture(id, false)!;
      expect(tex, id).not.toBeNull();
      expect(fs.existsSync(`public/textures/entity/${tex}`), tex).toBe(true);
    }
    // gold and the turtle are the two whose file is not named after the item
    expect(armorLayerTexture('golden_boots', false)).toBe('equipment/humanoid/gold.png');
    expect(armorLayerTexture('turtle_helmet', false)).toBe('equipment/humanoid/turtle_scute.png');
    expect(armorLayerTexture('iron_leggings', true)).toBe('equipment/humanoid_leggings/iron.png');
    expect(armorLayerTexture('elytra', false)).toBeNull();
    expect(armorLayerTexture('bread', false)).toBeNull();
  });

  it('has a leggings sheet for every outer one', () => {
    for (const m of ARMOR_MATERIALS) {
      const id = `${m}_leggings`;
      if (!items.has(id)) continue;
      expect(fs.existsSync(`public/textures/entity/${armorLayerTexture(id, true)!}`), id).toBe(true);
    }
  });
});

describe('the end crystal', () => {
  it('is an entity the game already knows how to draw', () => {
    const stats = mobStats('end_crystal')!;
    expect(stats.health).toBe(1);
    expect(stats.fireproof).toBe(true);
    expect(stats.model.texture).toBe('end_crystal/end_crystal.png');
  });

  it('is an item you can hold and put down', () => {
    expect(items.get('end_crystal').behavior).toBe('placeable_entity');
    expect(items.get('armor_stand').behavior).toBe('placeable_entity');
  });
});
