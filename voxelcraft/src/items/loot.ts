/** Evaluates vanilla-format loot tables (data/loot/*.json) for block drops and more. */
import lootBlocks from '../../data/loot/blocks.json';
import lootEntities from '../../data/loot/entities.json';
import tagsJson from '../../data/tags.json';
import type { ItemStack } from './inventory.ts';
import { items } from './registry.ts';
import { blocks } from '../blocks/registry.ts';
import lootChests from '../../data/loot/chests.json';
import lootGameplay from '../../data/loot/gameplay.json';
import { enchantments, supports } from './enchanting.ts';

type Json = Record<string, unknown>;
const blockTables = lootBlocks as Record<string, Json>;
const entityTables = lootEntities as Record<string, Json>;
const chestTables = lootChests as unknown as Record<string, Json>;
const gameplayTables = lootGameplay as unknown as Record<string, Json>;
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
  /** Luck, which shifts weights by each entry's quality (luck of the sea, the luck effect). */
  luck?: number;
  /** Whether a fishing hook is in open water, which is what the treasure pool asks about. */
  openWater?: boolean;
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
      const pred = (c.predicate ?? {}) as { flags?: { is_on_fire?: boolean }; type_specific?: { type?: string; in_open_water?: boolean } };
      if (pred.flags?.is_on_fire !== undefined) return pred.flags.is_on_fire === !!ctx.onFire;
      // the treasure pool asks whether the hook is in open water
      const hook = pred.type_specific;
      if (hook?.type === 'fishing_hook' && hook.in_open_water !== undefined) return hook.in_open_water === !!ctx.openWater;
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
      case 'enchant_randomly': {
        // chest loot often hands out a randomly enchanted book or tool
        const pool = enchantablesFor(stack.id);
        if (pool.length) {
          const pick = pool[Math.floor(ctx.random() * pool.length)];
          const level = 1 + Math.floor(ctx.random() * pick.maxLevel);
          stack.enchantments = { ...(stack.enchantments ?? {}), [pick.id]: level };
          if (stack.id === 'book') stack.id = 'enchanted_book';
        }
        break;
      }
      case 'enchant_with_levels': {
        const levels = numberRange(f.levels, ctx);
        const pool = enchantablesFor(stack.id);
        if (pool.length) {
          const n = 1 + Math.floor(ctx.random() * Math.max(1, Math.round(levels / 15)));
          for (let i = 0; i < n; i++) {
            const pick = pool[Math.floor(ctx.random() * pool.length)];
            const level = 1 + Math.floor(ctx.random() * pick.maxLevel);
            stack.enchantments = { ...(stack.enchantments ?? {}), [pick.id]: level };
          }
          if (stack.id === 'book') stack.id = 'enchanted_book';
        }
        break;
      }
      case 'set_damage': {
        const damage = numberRange(f.damage, ctx);
        const max = items.byId.get(stack.id)?.durability;
        if (max) stack.damage = Math.max(0, Math.round(max * (1 - damage)));
        break;
      }
      case 'set_potion': {
        const potion = stripTag(String(f.id ?? ''));
        if (potion) stack.name = potion;
        break;
      }
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
        const name = stripTag(ref);
        const sub = name.startsWith('gameplay/') ? gameplayTables[name.replace(/^gameplay\//, '')] : blockTables[name.replace(/^blocks\//, '')];
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
      // vanilla weights an entry by `weight + quality * luck`, which is what luck of the sea moves
      const weightOf = (e: Json) => Math.max(0, Math.floor(Number(e.weight ?? 1) + Number(e.quality ?? 0) * (ctx.luck ?? 0)));
      const total = entries.reduce((a, e) => a + weightOf(e), 0);
      if (total <= 0) continue;
      let pick = ctx.random() * total;
      let chosen = entries[entries.length - 1];
      for (const e of entries) {
        pick -= weightOf(e);
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

/** Enchantments that may be rolled onto an item by a chest loot function. */
function enchantablesFor(id: string): { id: string; maxLevel: number }[] {
  const out: { id: string; maxLevel: number }[] = [];
  for (const e of enchantments) {
    if (e.treasure) continue; // vanilla's random loot enchantments skip the treasure-only ones
    if (id === 'book' || id === 'enchanted_book' || supports(e, id)) out.push({ id: e.id, maxLevel: e.maxLevel });
  }
  return out;
}

/** Chest loot for a structure (vanilla `chests/...` tables). */
export function chestLoot(table: string, random: () => number = Math.random): ItemStack[] {
  const key = table.replace('minecraft:', '').replace(/^chests\//, '');
  const def = chestTables[key];
  if (!def) return [];
  return evalTable(def, { tool: null, random });
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

/**
 * Experience a block drops when it is mined, from vanilla's `Block.getExpDrop` (a silk touch pick
 * takes the block itself instead, and drops no experience).
 */
const BLOCK_XP: Record<string, [number, number]> = {
  coal_ore: [0, 2], deepslate_coal_ore: [0, 2],
  diamond_ore: [3, 7], deepslate_diamond_ore: [3, 7],
  emerald_ore: [3, 7], deepslate_emerald_ore: [3, 7],
  lapis_ore: [2, 5], deepslate_lapis_ore: [2, 5],
  redstone_ore: [1, 5], deepslate_redstone_ore: [1, 5],
  nether_gold_ore: [0, 1], nether_quartz_ore: [2, 5],
  spawner: [15, 43], trial_spawner: [15, 43],
  sculk: [1, 1], sculk_catalyst: [5, 5], sculk_shrieker: [5, 5], sculk_sensor: [5, 5], calibrated_sculk_sensor: [5, 5],
  sculk_vein: [1, 1], infested_stone: [0, 0],
};

/** Experience dropped by breaking a block with the given tool. */
export function blockXp(blockId: string, tool: ItemStack | null, random: () => number = Math.random): number {
  const range = BLOCK_XP[blockId];
  if (!range) return 0;
  if (tool?.enchantments?.silk_touch) return 0;
  return range[0] + Math.floor(random() * (range[1] - range[0] + 1));
}

export function hasLootTable(blockId: string): boolean {
  return blockId in blockTables;
}

/**
 * What comes up on the line. Vanilla rolls `gameplay/fishing`, whose three pools are weighted by
 * luck: luck of the sea makes treasure likelier and junk rarer, and treasure needs open water.
 */
export function fishingLoot(luck = 0, openWater = true, random: () => number = Math.random): ItemStack[] {
  const table = gameplayTables.fishing;
  if (!table) return [];
  const rod: ItemStack = { id: 'fishing_rod', count: 1, enchantments: luck > 0 ? { luck_of_the_sea: luck } : undefined };
  return evalTable(table, { tool: rod, random, luck, openWater });
}
