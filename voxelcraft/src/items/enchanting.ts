/** Enchanting table, anvil and grindstone mechanics (vanilla formulas on data/enchantments.json). */
import enchantmentsJson from '../../data/enchantments.json';
import type { ItemStack } from './inventory.ts';
import { cloneStack } from './inventory.ts';
import { items } from './registry.ts';
import type { Rng } from '../core/rng.ts';

/** Anything that yields uniform randoms (the world Rng or the seeded preview generator). */
export interface RandomSource {
  next(): number;
  int(n: number): number;
}

export interface EnchantDef {
  id: string;
  name: string;
  maxLevel: number;
  weight: number;
  anvilCost: number;
  minCost: { base: number; per_level_above_first: number };
  maxCost: { base: number; per_level_above_first: number };
  slots: string[];
  supportedItems: string | string[];
  primaryItems?: string | string[];
  exclusive: string[];
  treasure: boolean;
  curse: boolean;
  tradeable: boolean;
  inEnchantingTable: boolean;
}

export const enchantments = enchantmentsJson as EnchantDef[];
export const enchantById = new Map(enchantments.map((e) => [e.id, e]));

const asList = (v: string | string[] | undefined): string[] => (v === undefined ? [] : Array.isArray(v) ? v : [v]);

export function minCost(e: EnchantDef, level: number): number {
  return e.minCost.base + e.minCost.per_level_above_first * (level - 1);
}

export function maxCost(e: EnchantDef, level: number): number {
  return e.maxCost.base + e.maxCost.per_level_above_first * (level - 1);
}

export function enchantability(itemId: string): number {
  return items.byId.get(itemId)?.enchantability ?? 0;
}

/** Whether an enchantment can be applied to the item at all (anvil rules; books accept anything). */
export function supports(e: EnchantDef, itemId: string): boolean {
  if (itemId === 'enchanted_book' || itemId === 'book') return true;
  return asList(e.supportedItems).includes(itemId);
}

/** Whether the enchanting table offers this enchantment for the item (primary items). */
export function primary(e: EnchantDef, itemId: string): boolean {
  if (itemId === 'book') return true;
  const p = e.primaryItems !== undefined ? asList(e.primaryItems) : asList(e.supportedItems);
  return p.includes(itemId);
}

export function compatible(a: string, b: string): boolean {
  if (a === b) return false;
  const ea = enchantById.get(a);
  const eb = enchantById.get(b);
  if (!ea || !eb) return true;
  return !ea.exclusive.includes(b) && !eb.exclusive.includes(a);
}

export interface EnchantInstance {
  id: string;
  level: number;
}

function weightedPick(rng: RandomSource, list: EnchantInstance[]): EnchantInstance {
  let total = 0;
  for (const e of list) total += enchantById.get(e.id)!.weight;
  let r = rng.int(total);
  for (const e of list) {
    r -= enchantById.get(e.id)!.weight;
    if (r < 0) return e;
  }
  return list[list.length - 1];
}

/** Vanilla EnchantmentHelper.selectEnchantment. */
export function selectEnchantments(rng: RandomSource, itemId: string, level: number, treasure = false): EnchantInstance[] {
  const ench = enchantability(itemId);
  if (ench <= 0) return [];
  level += 1 + rng.int(Math.floor(ench / 4) + 1) + rng.int(Math.floor(ench / 4) + 1);
  const f = (rng.next() + rng.next() - 1) * 0.15;
  level = Math.max(1, Math.round(level + level * f));
  let available: EnchantInstance[] = [];
  for (const e of enchantments) {
    if (!treasure && e.treasure) continue;
    if (!e.inEnchantingTable) continue;
    if (!primary(e, itemId)) continue;
    for (let lvl = e.maxLevel; lvl >= 1; lvl--) {
      if (level >= minCost(e, lvl) && level <= maxCost(e, lvl)) {
        available.push({ id: e.id, level: lvl });
        break;
      }
    }
  }
  const result: EnchantInstance[] = [];
  if (!available.length) return result;
  const pick = () => {
    const chosen = weightedPick(rng, available);
    result.push(chosen);
    available = available.filter((a) => compatible(a.id, chosen.id));
  };
  pick();
  while (rng.int(50) <= level) {
    if (!available.length) break;
    pick();
    level = Math.floor(level / 2);
  }
  if (itemId === 'book' && result.length > 1) result.splice(rng.int(result.length), 1);
  return result;
}

export interface EnchantOption {
  /** Level requirement shown on the button (0 = unavailable). */
  cost: number;
  /** The enchantment revealed in the tooltip. */
  hint: EnchantInstance | null;
}

/** Vanilla EnchantmentMenu.slotsChanged: three options for the item with `shelves` bookshelves (0..15). */
export function enchantingOptions(seed: number, itemId: string, shelves: number): EnchantOption[] {
  const out: EnchantOption[] = [];
  const ench = enchantability(itemId);
  const rng = new RngWrapper(seed);
  for (let i = 0; i < 3; i++) {
    let cost = 0;
    if (ench > 0) {
      const base = rng.int(8) + 1 + (shelves >> 1) + rng.int(shelves + 1);
      cost = i === 0 ? Math.max(Math.floor(base / 3), 1) : i === 1 ? Math.floor((base * 2) / 3) + 1 : Math.max(base, shelves * 2);
      if (cost < i + 1) cost = 0;
    }
    let hint: EnchantInstance | null = null;
    if (cost > 0) {
      const list = selectEnchantments(new RngWrapper(seed + i), itemId, cost, false);
      hint = list[0] ?? null;
      if (!hint) cost = 0;
    }
    out.push({ cost, hint });
  }
  return out;
}

/** The enchantments actually applied when option `slot` is chosen (same seed as the preview). */
export function enchantWithOption(seed: number, itemId: string, shelves: number, slot: number): EnchantInstance[] {
  const opts = enchantingOptions(seed, itemId, shelves);
  const cost = opts[slot]?.cost ?? 0;
  if (cost <= 0) return [];
  return selectEnchantments(new RngWrapper(seed + slot), itemId, cost, false);
}

/** Small deterministic RNG adapter so previews and results agree. */
class RngWrapper {
  private s: number;
  constructor(seed: number) {
    this.s = (seed >>> 0) || 1;
  }
  nextU32(): number {
    let x = this.s;
    x ^= x << 13;
    x >>>= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    this.s = x;
    return x;
  }
  next(): number {
    return this.nextU32() / 4294967296;
  }
  int(n: number): number {
    return n <= 0 ? 0 : Math.floor(this.next() * n);
  }
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }
  triangular(min: number, max: number): number {
    return Math.floor(min + ((this.next() + this.next()) / 2) * (max - min + 1));
  }
  chance(p: number): boolean {
    return this.next() < p;
  }
  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)];
  }
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= w;
      if (r < 0) return v;
    }
    return entries[entries.length - 1][0];
  }
}

/** Counts bookshelves that power an enchanting table (vanilla: the 5x5 ring two blocks high, each shelf needing air between it and the table). */
export function countBookshelves(getBlockId: (x: number, y: number, z: number) => string, x: number, y: number, z: number): number {
  let n = 0;
  for (let dz = -2; dz <= 2; dz++)
    for (let dx = -2; dx <= 2; dx++) {
      if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
      for (const dy of [0, 1]) {
        if (getBlockId(x + dx, y + dy, z + dz) !== 'bookshelf') continue;
        if (getBlockId(x + Math.trunc(dx / 2), y + dy, z + Math.trunc(dz / 2)) === 'air') n++;
      }
    }
  return Math.min(15, n);
}

// ------------------------------------------------------------------------------------------------
// Anvil
// ------------------------------------------------------------------------------------------------
export interface AnvilResult {
  result: ItemStack | null;
  cost: number;
  materialCost: number;
  tooExpensive: boolean;
}

/** Vanilla AnvilMenu.createResult (creative mode ignores the 40-level cap). */
export function anvilResult(left: ItemStack | null, right: ItemStack | null, name: string | undefined, creative = false): AnvilResult {
  if (!left) return { result: null, cost: 0, materialCost: 0, tooExpensive: false };
  const def = items.byId.get(left.id);
  const result = cloneStack(left);
  let cost = 0;
  let materialCost = 0;
  const baseRepairCost = (left.repairCost ?? 0) + (right?.repairCost ?? 0);
  let changed = false;
  if (right) {
    const rightDef = items.byId.get(right.id);
    const repairable = !!def?.durability;
    if (repairable && def?.repair?.includes(right.id)) {
      // repair with materials: 25% per unit, up to 4 units
      let damage = result.damage ?? 0;
      if (damage <= 0) return { result: null, cost: 0, materialCost: 0, tooExpensive: false };
      let units = 0;
      while (damage > 0 && units < Math.min(4, right.count)) {
        damage = Math.max(0, damage - Math.floor(def.durability! / 4));
        units++;
        cost++;
      }
      result.damage = damage;
      materialCost = units;
      changed = true;
    } else if (right.id === left.id || right.id === 'enchanted_book') {
      const book = right.id === 'enchanted_book';
      if (!book && repairable && (right.damage ?? 0) < (def?.durability ?? 0)) {
        const max = def!.durability!;
        const leftDur = max - (result.damage ?? 0);
        const rightDur = max - (right.damage ?? 0);
        const combined = Math.min(max, leftDur + rightDur + Math.floor(max * 0.12));
        if (combined > leftDur) {
          result.damage = max - combined;
          cost += 2;
          changed = true;
        }
      }
      const rightEnchants = right.enchantments ?? {};
      let merged = false;
      let incompatible = false;
      for (const [id, lvl] of Object.entries(rightEnchants)) {
        const e = enchantById.get(id);
        if (!e) continue;
        const cur = result.enchantments?.[id] ?? 0;
        let newLvl = cur === lvl ? lvl + 1 : Math.max(cur, lvl);
        newLvl = Math.min(newLvl, e.maxLevel);
        const applicable = creative || left.id === 'enchanted_book' || supports(e, left.id);
        let conflict = false;
        for (const other of Object.keys(result.enchantments ?? {})) if (other !== id && !compatible(other, id)) conflict = true;
        if (!applicable || conflict) {
          incompatible = true;
          cost += 1;
          continue;
        }
        result.enchantments = { ...(result.enchantments ?? {}), [id]: newLvl };
        merged = true;
        let per = e.anvilCost;
        if (book) per = Math.max(1, Math.floor(per / 2));
        cost += per * newLvl;
      }
      if (!merged && !changed) {
        if (incompatible && !book) return { result: null, cost: 0, materialCost: 0, tooExpensive: false };
        if (!incompatible) return { result: null, cost: 0, materialCost: 0, tooExpensive: false };
      }
      changed = changed || merged;
      void rightDef;
    } else return { result: null, cost: 0, materialCost: 0, tooExpensive: false };
  }
  const newName = name?.trim() ?? '';
  if (newName && newName !== (left.name ?? '')) {
    result.name = newName.slice(0, 50);
    cost += 1;
    changed = true;
  } else if (!newName && left.name && name !== undefined) {
    delete result.name;
    cost += 1;
    changed = true;
  }
  if (!changed) return { result: null, cost: 0, materialCost: 0, tooExpensive: false };
  cost += baseRepairCost;
  result.repairCost = Math.max(left.repairCost ?? 0, right?.repairCost ?? 0) * 2 + 1;
  const tooExpensive = cost >= 40 && !creative;
  return { result: tooExpensive ? null : result, cost, materialCost, tooExpensive };
}

// ------------------------------------------------------------------------------------------------
// Grindstone
// ------------------------------------------------------------------------------------------------
export function grindstoneResult(top: ItemStack | null, bottom: ItemStack | null): { result: ItemStack | null; xp: number } {
  const a = top ?? bottom;
  if (!a) return { result: null, xp: 0 };
  if (top && bottom && (top.id !== bottom.id || !items.byId.get(top.id)?.durability)) return { result: null, xp: 0 };
  const result = cloneStack(a, 1);
  let xp = 0;
  const strip = (s: ItemStack) => {
    for (const [id, lvl] of Object.entries(s.enchantments ?? {})) {
      const e = enchantById.get(id);
      if (!e) continue;
      if (e.curse) continue;
      xp += minCost(e, lvl);
    }
  };
  strip(a);
  if (top && bottom) strip(bottom);
  const curses: Record<string, number> = {};
  for (const [id, lvl] of Object.entries(a.enchantments ?? {})) if (enchantById.get(id)?.curse) curses[id] = lvl;
  if (Object.keys(curses).length) result.enchantments = curses;
  else delete result.enchantments;
  delete result.repairCost;
  if (result.id === 'enchanted_book') result.id = 'book';
  if (top && bottom) {
    const def = items.byId.get(top.id)!;
    const max = def.durability!;
    const dur = Math.min(max, max - (top.damage ?? 0) + (max - (bottom.damage ?? 0)) + Math.floor(max * 0.05));
    result.damage = max - dur;
    if (result.damage <= 0) delete result.damage;
  }
  if (!xp && !(a.enchantments && Object.keys(a.enchantments).some((id) => !enchantById.get(id)?.curse)) && !(top && bottom)) return { result: null, xp: 0 };
  return { result, xp };
}

export function grindstoneXp(rng: RandomSource | Rng, xp: number): number {
  if (xp <= 0) return 0;
  return Math.ceil(xp / 2) + rng.int(Math.floor(xp / 2) + 1);
}

export function enchantmentName(id: string, level: number): string {
  const e = enchantById.get(id);
  const roman = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X'][level] ?? String(level);
  return `${e?.name ?? id}${e && e.maxLevel > 1 ? ` ${roman}` : ''}`;
}
