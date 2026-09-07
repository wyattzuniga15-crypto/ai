import { describe, expect, it } from 'vitest';
import * as THREE from 'three';
import type { MobWorld } from '../src/entities/mob.ts';
import { Rng } from '../src/core/rng.ts';
import { Mob } from '../src/entities/mob.ts';
import {
  CHESTED_EQUINES, EQUINE_TYPES, HORSE_ARMOR, HORSE_COATS, HORSE_FOODS, HORSE_MARKINGS,
  horseArmorPoints, horseArmorTexture, horseAttributes, horseCoatTexture, horseMarkingTexture,
  initEquine, inheritEquine, mobStats, MOB_SPECS, CAT_FOODS, CAT_VARIANTS, catTexture,
} from '../src/entities/mobTypes.ts';
import { breedsWith, catAvoidGoal, offspringOf, temptGoal } from '../src/entities/ai.ts';
import { horseScreen } from '../src/ui/screens/screens.ts';
import { Inventory } from '../src/items/inventory.ts';

/** Mob stand-in: the model needs a DOM, so these tests drive the plain data paths on a stub. */
const makeMob = (type: string): Mob => {
  const def = mobStats(type)!;
  return {
    def, extra: {} as Record<string, number | boolean | string>, health: def.health, maxHealth: def.health,
    dead: false, invulnerable: 0, hurtTime: 0, lastHurtBy: null, lastHurtTime: -1000, age: 0, persistent: false,
    hurt: Mob.prototype.hurt,
  } as unknown as Mob;
};

describe('horses, donkeys and mules', () => {
  it('registers the three equines with vanilla sizes and a rideable model', () => {
    for (const id of EQUINE_TYPES) {
      const stats = mobStats(id);
      expect(stats, id).not.toBeNull();
      expect(stats!.animation).toBe('horse');
      expect(stats!.width).toBeCloseTo(1.3964844, 4);
      expect(MOB_SPECS[id].model.parts.some((p) => p.name === 'saddle')).toBe(true);
    }
    expect(CHESTED_EQUINES).toEqual(['donkey', 'mule']);
    // only horses carry a coat marking layer
    expect(MOB_SPECS.horse.model.parts.some((p) => p.name.endsWith('_marking'))).toBe(true);
    expect(MOB_SPECS.donkey.model.parts.some((p) => p.name.endsWith('_marking'))).toBe(false);
  });

  it('rolls attributes inside vanilla ranges', () => {
    const rng = new Rng(4242);
    let minSpeed = 1, maxSpeed = 0, minJump = 2, maxJump = 0, minHealth = 99, maxHealth = 0;
    for (let i = 0; i < 4000; i++) {
      const a = horseAttributes(() => rng.next());
      expect(a.speed).toBeGreaterThanOrEqual(0.1125);
      expect(a.speed).toBeLessThanOrEqual(0.3375);
      expect(a.jump).toBeGreaterThanOrEqual(0.4);
      expect(a.jump).toBeLessThanOrEqual(1);
      expect(a.health).toBeGreaterThanOrEqual(15);
      expect(a.health).toBeLessThanOrEqual(31);
      minSpeed = Math.min(minSpeed, a.speed); maxSpeed = Math.max(maxSpeed, a.speed);
      minJump = Math.min(minJump, a.jump); maxJump = Math.max(maxJump, a.jump);
      minHealth = Math.min(minHealth, a.health); maxHealth = Math.max(maxHealth, a.health);
    }
    // the three-roll average keeps the extremes rare but reachable
    expect(maxSpeed - minSpeed).toBeGreaterThan(0.1);
    expect(maxJump - minJump).toBeGreaterThan(0.3);
    expect(maxHealth).toBeGreaterThan(minHealth + 8);
  });

  it('gives every horse a coat and marking, and donkeys none', () => {
    const rng = new Rng(9);
    const coats = new Set<string>();
    const markings = new Set<string>();
    for (let i = 0; i < 300; i++) {
      const m = makeMob('horse');
      initEquine(m, () => rng.next());
      coats.add(String(m.extra.coat));
      markings.add(String(m.extra.marking));
      expect(m.maxHealth).toBe(m.health);
      expect(typeof m.extra.speedAttr).toBe('number');
    }
    expect([...coats].sort()).toEqual([...HORSE_COATS].sort());
    expect([...markings].sort()).toEqual([...HORSE_MARKINGS].sort());
    const donkey = makeMob('donkey');
    initEquine(donkey, () => rng.next());
    expect(donkey.extra.coat).toBeUndefined();
    expect(typeof donkey.extra.jumpAttr).toBe('number');
  });

  it('maps coats, markings and armour onto vanilla texture paths', () => {
    expect(horseCoatTexture('chestnut')).toBe('horse/horse_chestnut.png');
    expect(horseCoatTexture('not_a_coat')).toBe('horse/horse_white.png');
    expect(horseMarkingTexture('none')).toBeNull();
    expect(horseMarkingTexture('whitefield')).toBe('horse/horse_markings_whitefield.png');
    expect(horseArmorTexture('golden_horse_armor')).toBe('equipment/horse_body/gold.png');
    expect(horseArmorTexture('')).toBeNull();
    expect(horseArmorPoints('diamond_horse_armor')).toBe(11);
    expect(horseArmorPoints('saddle')).toBe(0);
    for (const id of Object.keys(HORSE_ARMOR)) expect(horseArmorTexture(id)).toMatch(/^equipment\/horse_body\/[a-z]+\.png$/);
  });

  it('soaks damage through horse armour with the vanilla armour formula', () => {
    const bare = makeMob('horse');
    const armored = makeMob('horse');
    armored.extra.armor = 'diamond_horse_armor';
    bare.hurt(10, null, 'player', 0);
    armored.hurt(10, null, 'player', 0);
    expect(bare.def.health - bare.health).toBeCloseTo(10, 5);
    expect(armored.def.health - armored.health).toBeCloseTo(10 * (1 - 11 / 25), 5);
  });

  it('breeds horses with donkeys into sterile mules', () => {
    expect(breedsWith('horse', 'horse')).toBe(true);
    expect(breedsWith('horse', 'donkey')).toBe(true);
    expect(breedsWith('donkey', 'horse')).toBe(true);
    expect(breedsWith('mule', 'mule')).toBe(false);
    expect(breedsWith('mule', 'horse')).toBe(false);
    expect(breedsWith('cow', 'sheep')).toBe(false);
    expect(offspringOf('horse', 'horse')).toBe('horse');
    expect(offspringOf('horse', 'donkey')).toBe('mule');
    expect(offspringOf('donkey', 'horse')).toBe('mule');
  });

  it('averages both parents and a fresh roll into a foal', () => {
    const rng = new Rng(11);
    const a = makeMob('horse');
    const b = makeMob('horse');
    a.extra.speedAttr = 0.3; a.extra.jumpAttr = 1; a.maxHealth = 30; a.extra.tamed = true;
    b.extra.speedAttr = 0.3; b.extra.jumpAttr = 1; b.maxHealth = 30; b.extra.tamed = true;
    const foal = makeMob('horse');
    inheritEquine(foal, a, b, () => rng.next());
    // two fast parents plus one average roll always beat a lone random horse
    expect(foal.extra.speedAttr as number).toBeGreaterThan(0.23);
    expect(foal.extra.jumpAttr as number).toBeGreaterThan(0.79);
    expect(foal.maxHealth).toBeGreaterThan(24);
    expect(foal.extra.tamed).toBe(true);
    expect(foal.persistent).toBe(true);
    expect(HORSE_COATS).toContain(String(foal.extra.coat));
  });

  it('feeds only on vanilla horse foods, and golden ones start breeding', () => {
    expect(Object.keys(HORSE_FOODS).sort()).toEqual(['apple', 'enchanted_golden_apple', 'golden_apple', 'golden_carrot', 'hay_block', 'sugar', 'wheat'].sort());
    expect(HORSE_FOODS.golden_carrot.breeds).toBe(true);
    expect(HORSE_FOODS.wheat.breeds).toBeUndefined();
    expect(HORSE_FOODS.hay_block.heal).toBe(20);
  });

  it('lays out the horse screen like vanilla', () => {
    const inv = new Inventory();
    const horse = horseScreen(inv, 'Horse', [null, null], null, true);
    const container = horse.slots.filter((s) => s.group === 'container');
    expect(container).toHaveLength(2); // saddle and armour
    expect(container[0].accepts!({ id: 'saddle', count: 1 })).toBe(true);
    expect(container[0].accepts!({ id: 'stone', count: 1 })).toBe(false);
    expect(container[1].accepts!({ id: 'iron_horse_armor', count: 1 })).toBe(true);
    const donkey = horseScreen(inv, 'Donkey', [null, null], new Array(15).fill(null), false);
    const dslots = donkey.slots.filter((s) => s.group === 'container');
    expect(dslots).toHaveLength(16); // saddle plus 15 chest slots, no armour
    expect(dslots.slice(1).every((s) => s.x >= 80 && s.y >= 18)).toBe(true);
    expect(donkey.sprites!.some((s) => s.texture.endsWith('chest_slots.png'))).toBe(true);
  });
});

describe('cats and ocelots', () => {
  it('registers both with the vanilla model and a collar only on cats', () => {
    for (const id of ['cat', 'ocelot']) {
      const stats = mobStats(id);
      expect(stats, id).not.toBeNull();
      expect(stats!.height).toBeCloseTo(0.7, 3);
      const names = MOB_SPECS[id].model.parts.map((p) => p.name);
      expect(names).toContain('tail');
      expect(names).toContain('tail_tip');
      expect(names.includes('collar')).toBe(id === 'cat');
    }
  });

  it('maps cat variants onto vanilla textures', () => {
    expect(CAT_VARIANTS).toHaveLength(10);
    for (const v of CAT_VARIANTS) expect(catTexture(v)).toBe(`cat/${v}.png`);
    expect(catTexture('all_black')).toBe('cat/all_black.png'); // the witch hut cat
    expect(catTexture('nonsense')).toBe('cat/tabby.png');
    expect(CAT_FOODS).toEqual(['cod', 'salmon']);
  });

  it('tempts and flees only while the rules allow it', () => {
    const world = {
      playerPos: () => new THREE.Vector3(0, 64, 0),
      playerEye: () => new THREE.Vector3(0, 65.6, 0),
      playerTargetable: () => true,
      playerHolding: () => held,
      rng: () => 0.5,
      getBlock: () => 0,
    } as unknown as MobWorld;
    let held: string | null = 'cod';
    const cat = makeMob('cat');
    (cat as { pos: THREE.Vector3 }).pos = new THREE.Vector3(3, 64, 0);
    (cat as { distanceTo: (v: THREE.Vector3) => number }).distanceTo = (v) => cat.pos.distanceTo(v);
    const tempt = temptGoal(CAT_FOODS, 10);
    const flee = catAvoidGoal();
    expect(tempt.canUse(cat, world)).toBe(true);
    expect(flee.canUse(cat, world)).toBe(false); // a fed hand is not a threat
    held = null;
    expect(tempt.canUse(cat, world)).toBe(false);
    expect(flee.canUse(cat, world)).toBe(true);
    cat.extra.tamed = true;
    expect(flee.canUse(cat, world)).toBe(false); // a tamed cat stays put
    held = 'cod';
    cat.extra.sitting = true;
    expect(tempt.canUse(cat, world)).toBe(false); // a sitting cat ignores food
  });
});
