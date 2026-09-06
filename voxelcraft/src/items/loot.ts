/** Evaluates vanilla-format loot tables (data/loot/*.json) for block drops and more. */
import lootBlocks from '../../data/loot/blocks.json';
import lootEntities from '../../data/loot/entities.json';
import tagsJson from '../../data/tags.json';
import type { ItemStack } from './inventory.ts';
import { items } from './registry.ts';
import { blocks } from '../blocks/registry.ts';

type Json = Record<string, unknown>;
const blockTables = lootBlocks as Record<string, Json>;
const entityTables = lootEntities as Record<string, Json>;
const itemTags = (tagsJson as { item: Record<string, string[]> }).item;

export interface LootContext {
  tool: ItemStack | null;
  blockState?: number;
  /** explosion radius when destroyed by an explosion */
  explosion?: number;
  random: () => number;
  killedByPlayer?: boolean;
  /** Looting level of the killing weapon. */
  looting?: number;
  /** Whether the entity was on fire (cooked drops). */
  onFire?: boolean;
}

function stripTag(v: string): string {
  return v.replace(/^#?minecraft:/, '').replace(/^#/, '');
}

function itemMatches(pred: unknown, tool: ItemStack | null): boolean {
  if (!tool) return false;
  const list = Array.isArray(pred) ? pred : [pred];
  for (const p of list) {
    if (typeof p !== 'string') continue;
    if (p.startsWith('#')) {
      if ((itemTags[stripTag(p)] ?? []).includes(tool.id)) return true;
    } else if (stripTag(p) === tool.id) return true;
  }
  return false;
}

function enchantLevel(tool: ItemStack | null, id: string): number {
  return tool?.enchantments?.[id] ?? 0;
}

function numberRange(v: unknown, ctx: LootContext): number {
  if (typeof v === 'number') return v;
  if (v && typeof v === 'object') {
    const o = v as { type?: string; min?: number; max?: number; n?: number; p?: number; value?: number };
    const type = (o.type ?? 'uniform').replace('minecraft:', '');
    if (type === 'constant') return o.value ?? 0;
    if (type === 'uniform') {
      const min = numberRange(o.min ?? 0, ctx);
      const max = numberRange(o.max ?? 0, ctx);
      return min + Math.floor(ctx.random() * (max - min + 1));
    }
    if (type === 'binomial') {
      let n = 0;
      const trials = numberRange(o.n ?? 0, ctx);
      const p = numberRange(o.p ?? 0, ctx);
      for (let i = 0; i < trials; i++) if (ctx.random() < p) n++;
      return n;
    }
  }
  return 0;
}

function checkCondition(c: Json, ctx: LootContext): boolean {
  const type = String(c.condition ?? '').replace('minecraft:', '');
  switch (type) {
    case 'survives_explosion':
      return ctx.explosion === undefined || ctx.random() <= 1 / ctx.explosion;
    case 'match_tool': {
      const pred = (c.predicate ?? {}) as Json;
      if (pred.items !== undefined && !itemMatches(pred.items, ctx.tool)) return false;
      const preds = (pred.predicates ?? {}) as Json;
      const ench = (preds['minecraft:enchantments'] ?? preds.enchantments) as { enchantments?: string; levels?: { min?: number } }[] | undefined;
      if (ench) {
        for (const e of ench) {
          const lvl = enchantLevel(ctx.tool, stripTag(e.enchantments ?? ''));
          if (lvl < (e.levels?.min ?? 1)) return false;
        }
      }
      return true;
    }
    case 'block_state_property': {
      if (ctx.blockState === undefined) return false;
      const props = blocks.props(ctx.blockState);
      const want = (c.properties ?? {}) as Record<string, string>;
      for (const [k, v] of Object.entries(want)) if (props[k] !== String(v)) return false;
      return true;
    }
    case 'random_chance':
      return ctx.random() < numberRange(c.chance, ctx);
    case 'random_chance_with_enchanted_bonus': {
      const lvl = enchantLevel(ctx.tool, stripTag(String(c.enchantment ?? '')));
      const chances = c.enchanted_chance as { type?: string; base?: number; per_level_above_first?: number } | number | undefined;
      let p = typeof c.unenchanted_chance === 'number' ? c.unenchanted_chance : 0;
      if (lvl > 0 && chances) p = typeof chances === 'number' ? chances : (chances.base ?? 0) + (lvl - 1) * (chances.per_level_above_first ?? 0);
      return ctx.random() < p;
    }
    case 'table_bonus': {
      const lvl = enchantLevel(ctx.tool, stripTag(String(c.enchantment ?? '')));
      const chances = (c.chances ?? []) as number[];
      const p = chances[Math.min(lvl, chances.length - 1)] ?? 0;
      return ctx.random() < p;
    }
    case 'inverted':
      return !checkCondition((c.term ?? {}) as Json, ctx);
    case 'any_of':
      return ((c.terms ?? []) as Json[]).some((t) => checkCondition(t, ctx));
    case 'all_of':
      return ((c.terms ?? []) as Json[]).every((t) => checkCondition(t, ctx));
    case 'killed_by_player':
      return !!ctx.killedByPlayer;
    case 'entity_properties': {
      const pred = (c.predicate ?? {}) as { flags?: { is_on_fire?: boolean } };
      if (pred.flags?.is_on_fire !== undefined) return pred.flags.is_on_fire === !!ctx.onFire;
      return c.entity === 'this';
    }
    case 'damage_source_properties':
      return false;
    default:
      return true;
  }
}

function conditionsOk(list: unknown, ctx: LootContext): boolean {
  if (!Array.isArray(list)) return true;
  return list.every((c) => checkCondition(c as Json, ctx));
}

function applyFunctions(stack: ItemStack, fns: unknown, ctx: LootContext): ItemStack | null {
  if (!Array.isArray(fns)) return stack;
  for (const f of fns as Json[]) {
    if (!conditionsOk(f.conditions, ctx)) continue;
    const type = String(f.function ?? '').replace('minecraft:', '');
    switch (type) {
      case 'set_count': {
        const n = numberRange(f.count, ctx);
        stack.count = f.add ? stack.count + n : n;
        break;
      }
      case 'apply_bonus': {
        const lvl = enchantLevel(ctx.tool, stripTag(String(f.enchantment ?? '')));
        const formula = String(f.formula ?? '').replace('minecraft:', '');
        const params = (f.parameters ?? {}) as { extra?: number; probability?: number; bonusMultiplier?: number };
        if (lvl > 0) {
          if (formula === 'ore_drops') {
            const m = Math.floor(ctx.random() * (lvl + 2)) - 1;
            if (m > 0) stack.count *= m + 1;
          } else if (formula === 'uniform_bonus_count') {
            stack.count += Math.floor(ctx.random() * (lvl * (params.bonusMultiplier ?? 1) + 1));
          } else if (formula === 'binomial_with_bonus_count') {
            const n = lvl + (params.extra ?? 0);
            for (let i = 0; i < n; i++) if (ctx.random() < (params.probability ?? 0.5)) stack.count++;
          }
        }
        break;
      }
      case 'limit_count': {
        const lim = (f.limit ?? {}) as { min?: number; max?: number } | number;
        if (typeof lim === 'number') stack.count = Math.min(stack.count, lim);
        else {
          if (lim.max !== undefined) stack.count = Math.min(stack.count, numberRange(lim.max, ctx));
          if (lim.min !== undefined) stack.count = Math.max(stack.count, numberRange(lim.min, ctx));
        }
        break;
      }
      case 'furnace_smelt':
        break;
      case 'enchanted_count_increase': {
        const lvl = enchantLevel(ctx.tool, stripTag(String(f.enchantment ?? '')));
        if (lvl > 0) {
          const extra = numberRange(f.count, ctx) * lvl;
          stack.count += extra;
          if (typeof f.limit === 'number') stack.count = Math.min(stack.count, f.limit);
        }
        break;
      }
      default:
        break;
    }
  }
  return stack.count > 0 ? stack : null;
}

function evalEntry(e: Json, ctx: LootContext, out: ItemStack[]): boolean {
  if (!conditionsOk(e.conditions, ctx)) return false;
  const type = String(e.type ?? 'item').replace('minecraft:', '');
  switch (type) {
    case 'item': {
      const id = stripTag(String(e.name ?? ''));
      if (!items.has(id)) return true;
      const s = applyFunctions({ id, count: 1 }, e.functions, ctx);
      if (s) out.push(s);
      return true;
    }
    case 'alternatives':
      for (const child of (e.children ?? []) as Json[]) if (evalEntry(child, ctx, out)) return true;
      return false;
    case 'group':
      for (const child of (e.children ?? []) as Json[]) evalEntry(child, ctx, out);
      return true;
    case 'sequence':
      for (const child of (e.children ?? []) as Json[]) if (!evalEntry(child, ctx, out)) break;
      return true;
    case 'loot_table': {
      const ref = e.value;
      if (typeof ref === 'string') {
        const sub = blockTables[stripTag(ref).replace(/^blocks\//, '')];
        if (sub) out.push(...evalTable(sub, ctx));
      } else if (ref && typeof ref === 'object') out.push(...evalTable(ref as Json, ctx));
      return true;
    }
    case 'empty':
      return true;
    default:
      return false;
  }
}

export function evalTable(table: Json, ctx: LootContext): ItemStack[] {
  const out: ItemStack[] = [];
  for (const pool of (table.pools ?? []) as Json[]) {
    if (!conditionsOk(pool.conditions, ctx)) continue;
    const rolls = numberRange(pool.rolls ?? 1, ctx);
    for (let r = 0; r < rolls; r++) {
      const entries = ((pool.entries ?? []) as Json[]).filter((e) => conditionsOk(e.conditions, ctx));
      if (!entries.length) continue;
      const total = entries.reduce((a, e) => a + Number(e.weight ?? 1), 0);
      let pick = ctx.random() * total;
      let chosen = entries[entries.length - 1];
      for (const e of entries) {
        pick -= Number(e.weight ?? 1);
        if (pick < 0) {
          chosen = e;
          break;
        }
      }
      const before = out.length;
      evalEntry({ ...chosen, conditions: undefined }, ctx, out);
      // apply pool-level functions to what this roll produced
      for (let i = before; i < out.length; i++) {
        const s = applyFunctions(out[i], pool.functions, ctx);
        if (!s) out.splice(i--, 1);
      }
    }
  }
  const merged: ItemStack[] = [];
  for (const s of out) {
    const t = applyFunctions(s, table.functions, ctx);
    if (!t) continue;
    const m = merged.find((x) => x.id === t.id && !x.damage && !t.damage);
    if (m) m.count += t.count;
    else merged.push(t);
  }
  return merged;
}

/** Drops for a mob death. */
export function entityDrops(type: string, killedByPlayer: boolean, looting = 0, onFire = false, random: () => number = Math.random): ItemStack[] {
  const table = entityTables[type];
  if (!table) return [];
  const ctx: LootContext = { tool: looting > 0 ? { id: 'diamond_sword', count: 1, enchantments: { looting } } : null, random, killedByPlayer, looting, onFire };
  const drops = evalTable(table, ctx);
  if (onFire) {
    const cooked: Record<string, string> = { beef: 'cooked_beef', porkchop: 'cooked_porkchop', mutton: 'cooked_mutton', chicken: 'cooked_chicken', cod: 'cooked_cod', salmon: 'cooked_salmon', rabbit: 'cooked_rabbit' };
    for (const d of drops) if (cooked[d.id]) d.id = cooked[d.id];
  }
  return drops;
}

/** Drops for breaking a block. */
export function blockDrops(state: number, tool: ItemStack | null, random: () => number = Math.random): ItemStack[] {
  const def = blocks.blockOf(state);
  const table = blockTables[def.id];
  if (!table) return def.drops.map((id) => ({ id, count: 1 }));
  return evalTable(table, { tool, blockState: state, random });
}

export function hasLootTable(blockId: string): boolean {
  return blockId in blockTables;
}
