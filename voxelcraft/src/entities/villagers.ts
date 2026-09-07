/**
 * Villager professions, levels and the trade economy, driven by `data/trades.json` (generated from
 * Mojang's published trade tables by `tools/gen-trades.ts`).
 */
import tradesJson from '../../data/trades.json';
import type { ItemStack } from '../items/inventory.ts';

export interface TradeItem { id: string; count: number; max?: number; enchanted?: boolean }
export interface TradeDef { wants: TradeItem[]; gives: TradeItem; maxUses: number; xp: number; price: number }
interface TierDef { xp: number; trades: TradeDef[] }

const TABLES = tradesJson as unknown as Record<string, TierDef[]>;

/** Vanilla professions, paired with the job site block that assigns them. */
export const PROFESSIONS: { id: string; name: string; table: string; block: string }[] = [
  { id: 'armorer', name: 'Armorer', table: 'armorer', block: 'blast_furnace' },
  { id: 'butcher', name: 'Butcher', table: 'butcher', block: 'smoker' },
  { id: 'cartographer', name: 'Cartographer', table: 'cartographer', block: 'cartography_table' },
  { id: 'cleric', name: 'Cleric', table: 'cleric', block: 'brewing_stand' },
  { id: 'farmer', name: 'Farmer', table: 'farmer', block: 'composter' },
  { id: 'fisherman', name: 'Fisherman', table: 'fisherman', block: 'barrel' },
  { id: 'fletcher', name: 'Fletcher', table: 'fletcher', block: 'fletching_table' },
  { id: 'leatherworker', name: 'Leatherworker', table: 'leather_worker', block: 'cauldron' },
  { id: 'librarian', name: 'Librarian', table: 'librarian', block: 'lectern' },
  { id: 'mason', name: 'Mason', table: 'mason', block: 'stonecutter' },
  { id: 'shepherd', name: 'Shepherd', table: 'shepherd', block: 'loom' },
  { id: 'toolsmith', name: 'Toolsmith', table: 'tool_smith', block: 'smithing_table' },
  { id: 'weaponsmith', name: 'Weaponsmith', table: 'weapon_smith', block: 'grindstone' },
];

const BY_BLOCK = new Map(PROFESSIONS.map((p) => [p.block, p.id]));
const BY_ID = new Map(PROFESSIONS.map((p) => [p.id, p]));

/** Profession a job site block hands out, or null when the block is not one. */
export function professionForBlock(block: string): string | null {
  return BY_BLOCK.get(block) ?? null;
}

export function professionName(id: string): string {
  return id === 'nitwit' ? 'Nitwit' : id === 'none' ? 'Villager' : BY_ID.get(id)?.name ?? 'Villager';
}

/** Vanilla villager levels and the experience each one needs. */
export const LEVEL_NAMES = ['Novice', 'Apprentice', 'Journeyman', 'Expert', 'Master'];
export const LEVEL_XP = [0, 10, 70, 150, 250];
/** Experience that ends each level, so the badge bar can fill (vanilla caps at master). */
export const LEVEL_MAX_XP = [10, 70, 150, 250, 250];

export function levelFor(xp: number): number {
  let level = 1;
  for (let i = 1; i < LEVEL_XP.length; i++) if (xp >= LEVEL_XP[i]) level = i + 1;
  return level;
}

/** Badge texture for a level (1-5), the vanilla stone → diamond ladder. */
export const LEVEL_BADGES = ['stone', 'iron', 'gold', 'emerald', 'diamond'];

/**
 * Trades a villager offers: vanilla picks two per tier when it unlocks, so the offer list grows as
 * the villager levels up. `pick` chooses which of a tier's trades this villager knows.
 */
export function tierTrades(table: string, tier: number): TradeDef[] {
  return TABLES[table]?.[tier]?.trades ?? [];
}

export function tableFor(profession: string): string | null {
  return BY_ID.get(profession)?.table ?? (profession === 'wandering_trader' ? 'wandering_trader' : null);
}

export interface Offer {
  wants: ItemStack[];
  gives: ItemStack;
  maxUses: number;
  uses: number;
  xp: number;
  price: number;
  /** Vanilla demand: rises as a trade is used and decays over the day, raising the first price. */
  demand: number;
  /** Extra discount from a hero-of-the-village style price drop (negative raises the price). */
  discount: number;
}

const stackOf = (t: TradeItem, rng: () => number): ItemStack => ({
  id: t.id,
  count: t.max && t.max > t.count ? t.count + Math.floor(rng() * (t.max - t.count + 1)) : t.count,
});

/** Builds the offers a villager of this profession knows at `level` (vanilla: two per tier). */
export function buildOffers(profession: string, level: number, rng: () => number): Offer[] {
  const table = tableFor(profession);
  if (!table) return [];
  const offers: Offer[] = [];
  const tiers = profession === 'wandering_trader' ? 1 : level;
  for (let tier = 0; tier < tiers; tier++) {
    const pool = tierTrades(table, tier).slice();
    const want = profession === 'wandering_trader' ? 5 : 2;
    for (let i = 0; i < want && pool.length; i++) {
      const def = pool.splice(Math.floor(rng() * pool.length), 1)[0];
      offers.push({
        wants: def.wants.map((w) => stackOf(w, rng)),
        gives: stackOf(def.gives, rng),
        maxUses: def.maxUses,
        uses: 0,
        xp: def.xp,
        price: def.price,
        demand: 0,
        discount: 0,
      });
    }
  }
  return offers;
}

/**
 * Vanilla price for the first cost item: the base count plus demand and any discount, clamped to at
 * least one and to the item's stack size.
 */
export function costOf(offer: Offer): number {
  const base = offer.wants[0]?.count ?? 0;
  const extra = Math.floor(base * offer.price * Math.max(0, offer.demand)) - offer.discount;
  return Math.max(1, Math.min(64, base + extra));
}

/** Whether the stacks the player put in pay for this offer. */
export function offerSatisfied(offer: Offer, a: ItemStack | null, b: ItemStack | null): boolean {
  if (offer.uses >= offer.maxUses) return false;
  const need = [{ id: offer.wants[0].id, count: costOf(offer) }, ...(offer.wants[1] ? [offer.wants[1]] : [])];
  const have = [a, b].filter((s): s is ItemStack => !!s);
  return need.every((n) => {
    const found = have.find((s) => s.id === n.id && s.count >= n.count);
    return !!found;
  }) && have.length >= need.length;
}

/** Consumes the paid stacks in place and books the trade (uses, demand and villager experience). */
export function takeTrade(offer: Offer, slots: (ItemStack | null)[]): number {
  const need = [{ id: offer.wants[0].id, count: costOf(offer) }, ...(offer.wants[1] ? [offer.wants[1]] : [])];
  for (const n of need) {
    for (let i = 0; i < slots.length; i++) {
      const s = slots[i];
      if (!s || s.id !== n.id || s.count < n.count) continue;
      s.count -= n.count;
      if (s.count <= 0) slots[i] = null;
      break;
    }
  }
  offer.uses++;
  offer.demand++;
  return offer.xp;
}
