/**
 * The animals you steer and the wolf you armour: the saddle a pig and a strider take, the stick
 * that drives each one and the boost it gives, and armadillo-scute armour on a tamed wolf.
 */
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { MOB_SPECS, PIG_SADDLE_LAYER, SADDLE_ANIMALS, STEER_BOOST, STEER_BOOST_MULTIPLIER, STRIDER_SADDLE_LAYER, WOLF_ARMOR_DURABILITY, WOLF_ARMOR_LAYER, WOLF_ARMOR_POINTS, WOLF_ARMOR_REPAIR, mobStats } from '../src/entities/mobTypes.ts';
import { items } from '../src/items/registry.ts';

describe('the two you steer', () => {
  it('is the pig and the strider, each with its own stick', () => {
    expect(SADDLE_ANIMALS).toEqual({ pig: 'carrot_on_a_stick', strider: 'warped_fungus_on_a_stick' });
    for (const [animal, stick] of Object.entries(SADDLE_ANIMALS)) {
      expect(mobStats(animal), animal).not.toBeNull();
      expect(items.has(stick), stick).toBe(true);
      expect(items.get(stick).behavior, stick).toBe('tool');
    }
  });

  it('wears a saddle drawn off vanilla\'s own equipment sheet, hidden until it goes on', () => {
    for (const [animal, layer] of [['pig', PIG_SADDLE_LAYER], ['strider', STRIDER_SADDLE_LAYER]] as [string, string][]) {
      const saddle = MOB_SPECS[animal].model.parts.find((p) => p.name === 'saddle')!;
      expect(saddle, animal).toBeDefined();
      expect(saddle.hidden, animal).toBe(true);
      expect(saddle.texture, animal).toBe(layer);
      expect(fs.existsSync(`public/textures/entity/${layer}`), layer).toBe(true);
      // the strap is the animal's own body box, a little proud of it
      expect(saddle.boxes[0].inflate, animal).toBeGreaterThan(0);
      const body = MOB_SPECS[animal].model.parts.find((p) => p.name === 'body')!;
      expect(saddle.boxes[0].box, animal).toEqual(body.boxes[0].box);
      expect(saddle.boxes[0].uv, animal).toEqual(body.boxes[0].uv);
    }
  });

  it('takes Mojang\'s boost: a third again as fast, and the stick pays for it', () => {
    expect(STEER_BOOST_MULTIPLIER).toBe(1.35);
    // three seconds on a pig for two points of the carrot, sixteen on a strider for one of the fungus
    expect(STEER_BOOST.pig).toEqual({ ticks: 60, wear: 2 });
    expect(STEER_BOOST.strider).toEqual({ ticks: 320, wear: 1 });
    for (const animal of Object.keys(SADDLE_ANIMALS)) expect(STEER_BOOST[animal], animal).toBeDefined();
  });

  it('carries a rider at its own pace: a strider is slower than a pig, as vanilla has it', () => {
    expect(mobStats('pig')!.speed).toBeCloseTo(0.25, 5);
    expect(mobStats('strider')!.speed).toBeLessThan(mobStats('pig')!.speed);
  });
});

describe('wolf armour', () => {
  it('is armadillo scutes, worn and mended', () => {
    const def = items.get('wolf_armor');
    expect(def.behavior).toBe('animal_equipment');
    expect(def.durability).toBe(WOLF_ARMOR_DURABILITY);
    expect(def.repair).toContain(WOLF_ARMOR_REPAIR);
    expect(items.has(WOLF_ARMOR_REPAIR)).toBe(true);
  });

  it('is drawn on the wolf\'s own boxes, off vanilla\'s body sheet', () => {
    const parts = MOB_SPECS.wolf.model.parts;
    const armor = parts.filter((p) => p.name.startsWith('armor_'));
    expect(armor.length).toBe(7);
    expect(fs.existsSync(`public/textures/entity/${WOLF_ARMOR_LAYER}`)).toBe(true);
    const byName = new Map(parts.map((p) => [p.name, p]));
    for (const p of armor) {
      expect(p.hidden, p.name).toBe(true);
      expect(p.texture, p.name).toBe(WOLF_ARMOR_LAYER);
      // each piece is the wolf's own box, grown a little
      const worn = byName.get(p.name.slice('armor_'.length))!;
      expect(p.boxes[0].box, p.name).toEqual(worn.boxes[0].box);
      expect(p.boxes[0].inflate, p.name).toBeGreaterThan(0);
    }
  });

  it('takes as much off a blow as vanilla\'s eleven points', () => {
    expect(WOLF_ARMOR_POINTS).toBe(11);
    // vanilla's armour formula: four per cent a point
    const left = 1 - Math.min(20, WOLF_ARMOR_POINTS) / 25;
    expect(left).toBeCloseTo(0.56, 5);
    expect(10 * left).toBeCloseTo(5.6, 5);
  });
});
