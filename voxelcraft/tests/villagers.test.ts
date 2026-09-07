import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng.ts';
import tradesJson from '../data/trades.json';
import itemsJson from '../data/items.json';
import {
  LEVEL_NAMES, LEVEL_XP, PROFESSIONS, buildOffers, costOf, levelFor, offerSatisfied,
  professionForBlock, professionName, tableFor, takeTrade, tierTrades, type Offer,
} from '../src/entities/villagers.ts';
import { villagerTypeFor, villagerBadgeTexture, villagerProfessionTexture, villagerTypeTexture, villagerWearsBrim, VILLAGER_TYPES, mobStats, MOB_SPECS } from '../src/entities/mobTypes.ts';

const tables = tradesJson as unknown as Record<string, { xp: number; trades: unknown[] }[]>;

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
