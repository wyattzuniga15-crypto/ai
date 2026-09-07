import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.ts';
import * as THREE from 'three';
import type { Mob, MobWorld } from '../src/entities/mob.ts';
import tradesJson from '../data/trades.json';
import itemsJson from '../data/items.json';
import {
  LEVEL_NAMES, LEVEL_XP, PROFESSIONS, buildOffers, costOf, levelFor, offerSatisfied,
  professionForBlock, professionName, tableFor, takeTrade, tierTrades, type Offer,
} from '../src/entities/villagers.ts';
import { villagerTypeFor, villagerBadgeTexture, villagerProfessionTexture, villagerTypeTexture, villagerWearsBrim, VILLAGER_TYPES, mobStats, MOB_SPECS, beeTexture, BEE_FLOWERS, isBreedingFood, ILLAGER_TYPES } from '../src/entities/mobTypes.ts';
import { BEE_FLOWER_IDS, targetVillagerGoal } from '../src/entities/ai.ts';
import { createBlockEntity } from '../src/blocks/blockEntity.ts';
import { blocks } from '../src/blocks/registry.ts';

const tables = tradesJson as unknown as Record<string, { xp: number; trades: unknown[] }[]>;

/** Mob stand-in: building a real Mob needs a DOM for its model, so goals are driven on a stub. */
const makeMob = (type: string): Mob => {
  const def = mobStats(type)!;
  return { def, extra: {}, health: def.health, maxHealth: def.health, dead: false, target: null, age: 0, pos: new THREE.Vector3(), distanceTo: () => 4 } as unknown as Mob;
};

describe('villager trades', () => {
  it('carries a five-tier table for every profession and one for the wandering trader', () => {
    for (const p of PROFESSIONS) {
      const table = tables[tableFor(p.id)!];
      expect(table, p.id).toBeDefined();
      expect(table).toHaveLength(5);
      expect(table.every((t) => t.trades.length > 0), p.id).toBe(true);
      expect(table.map((t) => t.xp)).toEqual(LEVEL_XP);
    }
    expect(tables.wandering_trader).toHaveLength(1);
    expect(tables.wandering_trader[0].trades.length).toBeGreaterThan(20);
  });

  it('only trades items the game actually has', () => {
    const known = new Set((itemsJson as { id: string }[]).map((i) => i.id));
    for (const [name, tiers] of Object.entries(tables))
      for (const tier of tiers)
        for (const t of tier.trades as { wants: { id: string }[]; gives: { id: string } }[]) {
          for (const w of t.wants) expect(known.has(w.id), `${name}: ${w.id}`).toBe(true);
          expect(known.has(t.gives.id), `${name}: ${t.gives.id}`).toBe(true);
        }
  });

  it('maps job site blocks to professions', () => {
    expect(professionForBlock('composter')).toBe('farmer');
    expect(professionForBlock('lectern')).toBe('librarian');
    expect(professionForBlock('grindstone')).toBe('weaponsmith');
    expect(professionForBlock('crafting_table')).toBeNull();
    expect(professionName('farmer')).toBe('Farmer');
    expect(professionName('none')).toBe('Villager');
    // every profession claims a different block
    expect(new Set(PROFESSIONS.map((p) => p.block)).size).toBe(PROFESSIONS.length);
  });

  it('levels up on vanilla experience thresholds', () => {
    expect(LEVEL_NAMES).toEqual(['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master']);
    expect(levelFor(0)).toBe(1);
    expect(levelFor(9)).toBe(1);
    expect(levelFor(10)).toBe(2);
    expect(levelFor(69)).toBe(2);
    expect(levelFor(70)).toBe(3);
    expect(levelFor(150)).toBe(4);
    expect(levelFor(250)).toBe(5);
    expect(levelFor(9999)).toBe(5);
  });

  it('offers two trades per unlocked tier and five for the wandering trader', () => {
    const rng = new Rng(5);
    const novice = buildOffers('farmer', 1, () => rng.next());
    expect(novice).toHaveLength(2);
    const master = buildOffers('farmer', 5, () => rng.next());
    expect(master).toHaveLength(10);
    for (const o of master) {
      expect(o.wants.length).toBeGreaterThan(0);
      expect(o.gives.count).toBeGreaterThan(0);
      expect(o.maxUses).toBeGreaterThan(0);
    }
    expect(buildOffers('wandering_trader', 1, () => rng.next())).toHaveLength(5);
    expect(buildOffers('none', 1, () => rng.next())).toEqual([]);
  });

  it('prices a trade up with demand and refuses payment that is short', () => {
    const offer: Offer = { wants: [{ id: 'wheat', count: 20 }], gives: { id: 'emerald', count: 1 }, maxUses: 3, uses: 0, xp: 2, price: 0.05, demand: 0, discount: 0 };
    expect(costOf(offer)).toBe(20);
    offer.demand = 4;
    expect(costOf(offer)).toBe(24); // 20 + floor(20 × 0.05 × 4)
    offer.demand = 0;
    expect(offerSatisfied(offer, { id: 'wheat', count: 19 }, null)).toBe(false);
    expect(offerSatisfied(offer, { id: 'emerald', count: 64 }, null)).toBe(false);
    expect(offerSatisfied(offer, { id: 'wheat', count: 20 }, null)).toBe(true);
    // an emptied trade is refused until the villager restocks
    offer.uses = offer.maxUses;
    expect(offerSatisfied(offer, { id: 'wheat', count: 64 }, null)).toBe(false);
  });

  it('takes payment, books the use and earns the villager experience', () => {
    const offer: Offer = { wants: [{ id: 'emerald', count: 1 }, { id: 'book', count: 1 }], gives: { id: 'enchanted_book', count: 1 }, maxUses: 12, uses: 0, xp: 5, price: 0.2, demand: 0, discount: 0 };
    const slots = [{ id: 'emerald', count: 3 }, { id: 'book', count: 1 }];
    expect(offerSatisfied(offer, slots[0], slots[1])).toBe(true);
    const xp = takeTrade(offer, slots);
    expect(xp).toBe(5);
    expect(slots[0]).toEqual({ id: 'emerald', count: 2 });
    expect(slots[1]).toBeNull();
    expect(offer.uses).toBe(1);
    expect(offer.demand).toBe(1);
  });

  it('dresses villagers by biome, profession and level', () => {
    expect(villagerTypeFor('desert')).toBe('desert');
    expect(villagerTypeFor('snowy_taiga')).toBe('snow');
    expect(villagerTypeFor('bamboo_jungle')).toBe('jungle');
    expect(villagerTypeFor('plains')).toBe('plains');
    expect(VILLAGER_TYPES).toContain('swamp');
    expect(villagerTypeTexture('taiga')).toBe('villager/type/taiga.png');
    expect(villagerTypeTexture('nonsense')).toBe('villager/type/plains.png');
    expect(villagerProfessionTexture('none')).toBeNull();
    expect(villagerProfessionTexture('cleric')).toBe('villager/profession/cleric.png');
    expect(villagerBadgeTexture(1)).toBe('villager/profession_level/stone.png');
    expect(villagerBadgeTexture(5)).toBe('villager/profession_level/diamond.png');
    // only the straw-hat professions draw the hat brim
    expect(villagerWearsBrim('farmer')).toBe(true);
    expect(villagerWearsBrim('librarian')).toBe(false);
    expect(mobStats('villager')!.animation).toBe('biped');
    expect(MOB_SPECS.wandering_trader.model.parts.some((p) => p.name.endsWith('_badge'))).toBe(false);
  });

  it('keeps every tier reachable from the tables the tools generated', () => {
    for (const p of PROFESSIONS) for (let tier = 0; tier < 5; tier++) expect(tierTrades(p.table, tier).length, `${p.id} tier ${tier}`).toBeGreaterThan(0);
  });
});

describe('bees', () => {
  it('registers the bee with vanilla stats and a flying model', () => {
    const stats = mobStats('bee');
    expect(stats).not.toBeNull();
    expect(stats!.flying).toBe(true);
    expect(stats!.health).toBe(10);
    expect(stats!.damage).toBe(2);
    const names = MOB_SPECS.bee.model.parts.map((p) => p.name);
    expect(names).toEqual(['body', 'stinger', 'right_wing', 'left_wing', 'leg_front', 'leg_mid', 'leg_back']);
  });

  it('swaps between the four vanilla bee skins', () => {
    expect(beeTexture(false, false)).toBe('bee/bee.png');
    expect(beeTexture(true, false)).toBe('bee/bee_angry.png');
    expect(beeTexture(false, true)).toBe('bee/bee_nectar.png');
    expect(beeTexture(true, true)).toBe('bee/bee_angry_nectar.png');
  });

  it('pollinates and breeds with the vanilla flowers', () => {
    expect(BEE_FLOWERS).toContain('dandelion');
    expect(BEE_FLOWERS).toContain('cherry_leaves');
    expect(BEE_FLOWERS).not.toContain('grass');
    expect(isBreedingFood('bee', 'poppy')).toBe(true);
    expect(isBreedingFood('bee', 'wheat')).toBe(false);
    // the goal reads the same list, so a bee looks for exactly what it breeds with
    expect(BEE_FLOWER_IDS).toEqual(BEE_FLOWERS);
  });

  it('gives hives a block entity that holds bees', () => {
    for (const id of ['bee_nest', 'beehive']) {
      const e = createBlockEntity(id);
      expect(e, id).toEqual({ type: 'beehive', bees: [], nectar: [] });
    }
    expect(createBlockEntity('stone')).toBeNull();
  });

  it('keeps the vanilla honey levels on both hive blocks', () => {
    for (const id of ['bee_nest', 'beehive']) {
      const def = blocks.byId.get(id);
      expect(def, id).toBeDefined();
      const levels = def!.states?.find((s) => s.name === 'honey_level');
      expect(levels?.values).toEqual(['0', '1', '2', '3', '4', '5']);
    }
  });
});

describe('illagers', () => {
  it('registers every illager with vanilla stats', () => {
    const expected: Record<string, { health: number; damage: number; animation: string }> = {
      pillager: { health: 24, damage: 0, animation: 'illager' },
      vindicator: { health: 24, damage: 5, animation: 'illager' },
      evoker: { health: 24, damage: 6, animation: 'illager' },
      vex: { health: 14, damage: 9, animation: 'vex' },
      ravager: { health: 100, damage: 12, animation: 'quadruped' },
    };
    for (const id of ILLAGER_TYPES) {
      const stats = mobStats(id);
      expect(stats, id).not.toBeNull();
      expect(stats!.disposition).toBe('hostile');
      expect(stats!.health).toBe(expected[id].health);
      expect(stats!.damage).toBe(expected[id].damage);
      expect(stats!.animation).toBe(expected[id].animation);
    }
    expect(mobStats('vex')!.flying).toBe(true);
  });

  it('dresses illagers in the crossed-arm model and the vex in wings', () => {
    for (const id of ['pillager', 'vindicator', 'evoker']) {
      const names = MOB_SPECS[id].model.parts.map((p) => p.name);
      expect(names, id).toContain('arms');
      expect(names, id).toContain('right_arm');
      expect(names, id).toContain('nose');
      // the crossed arms start hidden and only show while the illager is idle
      expect(MOB_SPECS[id].model.parts.find((p) => p.name === 'arms')!.hidden).toBe(true);
    }
    const vex = MOB_SPECS.vex.model.parts.map((p) => p.name);
    expect(vex).toContain('left_wing');
    expect(vex).toContain('right_wing');
  });

  it('sends illagers after villagers as well as the player', () => {
    const world = {
      mobsNear: () => [villager],
      playerPos: () => new THREE.Vector3(0, 64, 0),
      rng: () => 0.5,
    } as unknown as MobWorld;
    const villager = makeMob('villager');
    const vindicator = makeMob('vindicator');
    const goal = targetVillagerGoal();
    expect(goal.canUse(vindicator, world)).toBe(true);
    goal.tick(vindicator, world);
    expect(vindicator.target).toBe(villager);
    // an illager already fighting the player keeps that target
    vindicator.target = 'player';
    expect(goal.canUse(vindicator, world)).toBe(false);
  });
});
