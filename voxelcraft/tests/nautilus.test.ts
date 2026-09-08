/**
 * The nautiluses: Mojang's geometry and spawn rules, the pufferfish that tames one, the fish that
 * heal it, and the charge it runs at a pufferfish when it is angry.
 */
import { describe, expect, it } from 'vitest';
import { MOB_SPECS, NAUTILUS_ARMOR_LAYER, NAUTILUS_ARMOR_POINTS, NAUTILUS_ARMORS, NAUTILUS_COLD_WEIGHT, NAUTILUS_MAX_Y, NAUTILUS_MIN_Y, NAUTILUS_SADDLE_LAYER, NAUTILUS_SEAT, NAUTILUS_TYPES, NAUTILUS_WEIGHT, horseArmorPoints, mobStats, nautilusArmorTexture } from '../src/entities/mobTypes.ts';
import { NAUTILUS_ANGRY_TICKS, NAUTILUS_CHARGE_COOLDOWN, NAUTILUS_CHARGE_KNOCKBACK, NAUTILUS_CHARGE_RANGE, NAUTILUS_FOODS, NAUTILUS_HEALING, NAUTILUS_HUNT_RANGE, NAUTILUS_TAME_CHANCE, NAUTILUS_TAME_FOODS, nautilusChargeGoal, nautilusGoals } from '../src/entities/ai.ts';
import { items } from '../src/items/registry.ts';

describe('the nautilus', () => {
  it('is in the game as both an animal and an undead one', () => {
    expect(NAUTILUS_TYPES).toEqual(['nautilus', 'zombie_nautilus']);
    for (const id of NAUTILUS_TYPES) {
      const stats = mobStats(id);
      expect(stats, id).not.toBeNull();
      expect(stats!.aquatic, id).toBe(true);
      expect(stats!.health, id).toBe(8);
      // the wiki's table gives both a nought; Mojang's own behaviour pack charges for three
      expect(stats!.damage, id).toBe(3);
      expect(stats!.width, id).toBeCloseTo(0.875, 3);
      expect(stats!.height, id).toBeCloseTo(0.95, 3);
    }
    expect(mobStats('zombie_nautilus')!.burnsInSun).toBe(true);
    expect(mobStats('nautilus')!.burnsInSun).toBeUndefined();
  });

  it('is built from Mojang geometry: a shell in front, the mouth trailing behind', () => {
    const parts = MOB_SPECS.nautilus.model.parts;
    const byName = new Map(parts.map((p) => [p.name, p]));
    expect([...byName.keys()]).toEqual(['nautilus', 'head', 'body', 'mouth_top', 'inner_mouth', 'mouth_bottom', 'armor', 'saddle']);
    expect(MOB_SPECS.nautilus.model.texW).toBe(128);
    expect(byName.get('mouth_top')!.parent).toBe('body');
    // the shell leads (its boxes reach toward -z) and the mouth trails behind the body's pivot
    expect(byName.get('head')!.boxes[0].box[2]).toBe(-7);
    expect(byName.get('body')!.pivot[2]).toBeGreaterThan(0);
    expect(byName.get('mouth_top')!.pivot[2]).toBeGreaterThan(byName.get('body')!.pivot[2]);
    // the saddle and armour are the shell again, hidden until they are put on
    for (const layer of ['saddle', 'armor']) expect(byName.get(layer)!.hidden, layer).toBe(true);
    expect(byName.get('saddle')!.texture).toBe(NAUTILUS_SADDLE_LAYER);
    expect(byName.get('armor')!.texture).toBe(NAUTILUS_ARMOR_LAYER);
  });

  it('grows coral only on the zombie one, as crossed planes on its shell', () => {
    const zombie = MOB_SPECS.zombie_nautilus.model.parts.map((p) => p.name);
    expect(zombie.filter((n) => n.includes('coral'))).toEqual(['yellow_coral_0', 'yellow_coral_1', 'blue_coral_0', 'blue_coral_1', 'red_coral_0', 'red_coral_1']);
    expect(MOB_SPECS.nautilus.model.parts.some((p) => p.name.includes('coral'))).toBe(false);
    for (const p of MOB_SPECS.zombie_nautilus.model.parts) {
      if (!p.name.includes('coral')) continue;
      expect(p.hidden, p.name).toBe(true);
      expect(p.parent, p.name).toBe('head');
      expect(Math.abs(p.rotation![1]), p.name).toBeGreaterThan(0.5); // turned about a quarter turn
    }
  });

  it('takes the five armours the data ships, and they soak damage like a horse\'s', () => {
    expect(NAUTILUS_ARMORS).toEqual(['copper', 'iron', 'golden', 'diamond', 'netherite']);
    for (const kind of NAUTILUS_ARMORS) {
      const id = `${kind}_nautilus_armor`;
      expect(items.byId.has(id), id).toBe(true);
      expect(nautilusArmorTexture(id), id).toBe(`equipment/nautilus_body/${kind === 'golden' ? 'gold' : kind}.png`);
      expect(horseArmorPoints(id), id).toBe(NAUTILUS_ARMOR_POINTS[kind]);
    }
    // the ladder climbs, and nothing else is nautilus armour
    expect(NAUTILUS_ARMORS.map((k) => NAUTILUS_ARMOR_POINTS[k])).toEqual([3, 5, 7, 11, 12]);
    expect(nautilusArmorTexture('iron_horse_armor')).toBeNull();
    expect(nautilusArmorTexture('saddle')).toBeNull();
  });

  it('is tamed by a pufferfish and fed by any fish, at the worth Mojang gives each', () => {
    expect(NAUTILUS_TAME_FOODS).toEqual(['pufferfish', 'pufferfish_bucket']);
    expect(NAUTILUS_TAME_CHANCE).toBeCloseTo(1 / 3, 5);
    expect(NAUTILUS_HEALING.cooked_salmon).toBe(12);
    expect(NAUTILUS_HEALING.cooked_cod).toBe(10);
    expect(NAUTILUS_HEALING.cod).toBe(4);
    expect(NAUTILUS_HEALING.pufferfish).toBe(2);
    for (const id of Object.keys(NAUTILUS_HEALING)) expect(items.byId.has(id), id).toBe(true);
    for (const id of NAUTILUS_FOODS) expect(items.byId.has(id), id).toBe(true);
  });

  it('seats its rider on top of the shell, where Mojang puts them', () => {
    expect(NAUTILUS_SEAT).toBeCloseTo(0.925, 5);
  });

  it('spawns alone in the ocean, deep down, and more rarely where the water is cold', () => {
    expect([NAUTILUS_MIN_Y, NAUTILUS_MAX_Y]).toEqual([38, 58]);
    expect(NAUTILUS_WEIGHT).toBe(25);
    expect(NAUTILUS_COLD_WEIGHT).toBe(10);
    expect(NAUTILUS_COLD_WEIGHT).toBeLessThan(NAUTILUS_WEIGHT);
  });

  it('hunts pufferfish and nothing else, and charges rather than biting', () => {
    expect([NAUTILUS_HUNT_RANGE, NAUTILUS_CHARGE_RANGE]).toEqual([25, 16]);
    expect(NAUTILUS_ANGRY_TICKS).toBe(400);
    expect(NAUTILUS_CHARGE_COOLDOWN).toBe(80);
    expect(NAUTILUS_CHARGE_KNOCKBACK).toBe(2);
    const goal = nautilusChargeGoal();
    const w = { rng: () => 0, mobsNear: () => [], lineOfSight: () => true } as never;
    // a tamed one keeps out of fights, and so does one being ridden
    expect(goal.canUse({ extra: { tamed: true }, target: null, age: 0, pos: { x: 0, y: 0, z: 0 } } as never, w)).toBe(false);
    expect(goal.canUse({ extra: {}, ridden: true, target: null, age: 0, pos: { x: 0, y: 0, z: 0 } } as never, w)).toBe(false);
    // and a wild one only looks now and then
    expect(goal.canUse({ extra: {}, ridden: false, target: null, age: 3, pos: { x: 0, y: 0, z: 0 } } as never, w)).toBe(false);
  });

  it("orders its goals the way Mojang's priorities do: panic, then the hunt, then swimming", () => {
    const goals = nautilusGoals();
    expect(goals).toHaveLength(8);
    // the charge has to come before the swimming, or the swim goal would hold the movement slot
    const charge = goals.findIndex((g) => g.flags === 7);
    expect(charge).toBe(1);
    expect(charge).toBeLessThan(goals.length - 3);
  });
});
