/** Crafting recipe matching (shaped, shapeless, transmute) against a 2x2 or 3x3 grid. */
import craftingJson from '../../data/recipes/crafting.json';
import type { ItemStack, Slot } from './inventory.ts';
import { cloneStack } from './inventory.ts';
import { items } from './registry.ts';

export type Ingredient = string | string[];

export interface CraftingRecipe {
  id: string;
  type: 'shaped' | 'shapeless' | 'transmute';
  group?: string;
  category?: string;
  pattern?: string[];
  key?: Record<string, Ingredient>;
  ingredients?: Ingredient[];
  input?: Ingredient;
  material?: Ingredient;
  result: { item: string; count: number };
}

export const craftingRecipes = craftingJson as CraftingRecipe[];

/** Items left behind in the grid after crafting (buckets, bottles). */
export const CRAFTING_REMAINDER: Record<string, string> = {
  milk_bucket: 'bucket', water_bucket: 'bucket', lava_bucket: 'bucket', powder_snow_bucket: 'bucket',
  honey_bottle: 'glass_bottle', dragon_breath: 'glass_bottle',
};

export function ingredientMatches(ing: Ingredient, stack: ItemStack | null): boolean {
  if (!stack) return false;
  return Array.isArray(ing) ? ing.includes(stack.id) : ing === stack.id;
}

function ingredientIds(ing: Ingredient): string[] {
  return Array.isArray(ing) ? ing : [ing];
}

export interface CraftResult {
  recipe: CraftingRecipe;
  result: ItemStack;
}

export class CraftingMatcher {
  private readonly byItem = new Map<string, CraftingRecipe[]>();

  constructor(recipes: CraftingRecipe[] = craftingRecipes, private readonly repairable = true) {
    for (const r of recipes) {
      const ids = new Set<string>();
      if (r.type === 'shaped') for (const ing of Object.values(r.key ?? {})) ingredientIds(ing).forEach((i) => ids.add(i));
      else if (r.type === 'shapeless') for (const ing of r.ingredients ?? []) ingredientIds(ing).forEach((i) => ids.add(i));
      else if (r.type === 'transmute') {
        ingredientIds(r.input!).forEach((i) => ids.add(i));
        ingredientIds(r.material!).forEach((i) => ids.add(i));
      }
      for (const id of ids) {
        let list = this.byItem.get(id);
        if (!list) this.byItem.set(id, (list = []));
        list.push(r);
      }
    }
  }

  /** Finds the recipe matching the grid (row-major, `width` x `height`). */
  match(grid: Slot[], width: number, height: number): CraftResult | null {
    const first = grid.find((s) => s);
    if (!first) return null;
    const candidates = this.byItem.get(first.id) ?? [];
    for (const r of candidates) {
      if (r.type === 'shaped' && this.matchShaped(r, grid, width, height)) return { recipe: r, result: { id: r.result.item, count: r.result.count } };
      if (r.type === 'shapeless' && this.matchShapeless(r, grid)) return { recipe: r, result: { id: r.result.item, count: r.result.count } };
      if (r.type === 'transmute') {
        const res = this.matchTransmute(r, grid);
        if (res) return { recipe: r, result: res };
      }
    }
    if (this.repairable) {
      const repaired = repairItems(grid);
      if (repaired) return { recipe: { id: 'repair_item', type: 'shapeless', result: { item: repaired.id, count: 1 } }, result: repaired };
    }
    return null;
  }

  private readonly trimmed = new Map<CraftingRecipe, string[]>();

  /** Pattern rows without empty leading/trailing rows and columns (vanilla "shrink"). */
  private trimPattern(r: CraftingRecipe): string[] {
    let rows = this.trimmed.get(r);
    if (rows) return rows;
    const src = r.pattern ?? [];
    const w = Math.max(0, ...src.map((row) => row.length));
    let minX = w, maxX = -1, minY = src.length, maxY = -1;
    src.forEach((row, y) => [...row].forEach((ch, x) => {
      if (ch !== ' ') { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); }
    }));
    rows = maxX < 0 ? [] : src.slice(minY, maxY + 1).map((row) => row.padEnd(w, ' ').slice(minX, maxX + 1));
    this.trimmed.set(r, rows);
    return rows;
  }

  private matchShaped(r: CraftingRecipe, grid: Slot[], width: number, height: number): boolean {
    const pattern = this.trimPattern(r);
    const ph = pattern.length;
    if (ph === 0) return false;
    const pw = Math.max(...pattern.map((row) => row.length));
    if (pw > width || ph > height) return false;
    let minX = width, minY = height, maxX = -1, maxY = -1;
    for (let y = 0; y < height; y++)
      for (let x = 0; x < width; x++) {
        if (grid[y * width + x]) {
          minX = Math.min(minX, x); maxX = Math.max(maxX, x);
          minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    if (maxX < 0) return false;
    if (maxX - minX + 1 !== pw || maxY - minY + 1 !== ph) return false;
    for (const mirror of [false, true]) {
      let ok = true;
      for (let y = 0; y < ph && ok; y++)
        for (let x = 0; x < pw; x++) {
          const row = pattern[y];
          const px = mirror ? pw - 1 - x : x;
          const ch = px < row.length ? row[px] : ' ';
          const cell = grid[(minY + y) * width + (minX + x)];
          if (ch === ' ') {
            if (cell) { ok = false; break; }
          } else {
            const ing = r.key![ch];
            if (!ing || !ingredientMatches(ing, cell)) { ok = false; break; }
          }
        }
      if (ok) return true;
    }
    return false;
  }

  private matchShapeless(r: CraftingRecipe, grid: Slot[]): boolean {
    const present = grid.filter((s): s is ItemStack => !!s);
    const ings = r.ingredients ?? [];
    if (present.length !== ings.length) return false;
    const used = new Array(present.length).fill(false);
    const solve = (i: number): boolean => {
      if (i === ings.length) return true;
      for (let j = 0; j < present.length; j++) {
        if (used[j] || !ingredientMatches(ings[i], present[j])) continue;
        used[j] = true;
        if (solve(i + 1)) return true;
        used[j] = false;
      }
      return false;
    };
    return solve(0);
  }

  private matchTransmute(r: CraftingRecipe, grid: Slot[]): ItemStack | null {
    const present = grid.filter((s): s is ItemStack => !!s);
    if (present.length !== 2) return null;
    for (const [a, b] of [[present[0], present[1]], [present[1], present[0]]]) {
      if (ingredientMatches(r.input!, a) && ingredientMatches(r.material!, b)) {
        const out = cloneStack(a, 1);
        out.id = r.result.item;
        return out;
      }
    }
    return null;
  }
}

/** Vanilla "repair item" special recipe: two damaged copies of a tool combine their durability. */
export function repairItems(grid: Slot[]): ItemStack | null {
  const present = grid.filter((s): s is ItemStack => !!s);
  if (present.length !== 2 || present[0].id !== present[1].id) return null;
  const def = items.byId.get(present[0].id);
  if (!def?.durability || present[0].count !== 1 || present[1].count !== 1) return null;
  if (!present[0].damage && !present[1].damage) return null;
  const a = def.durability - (present[0].damage ?? 0);
  const b = def.durability - (present[1].damage ?? 0);
  const total = Math.min(def.durability, a + b + Math.floor(def.durability * 0.05));
  return { id: def.id, count: 1, damage: def.durability - total };
}

/** Removes one of each ingredient from the grid, leaving container items behind. */
export function consumeIngredients(grid: Slot[]): Slot[] {
  return grid.map((s) => {
    if (!s) return null;
    const remainder = CRAFTING_REMAINDER[s.id];
    if (s.count <= 1) return remainder ? { id: remainder, count: 1 } : null;
    return cloneStack(s, s.count - 1);
  });
}

export const craftingMatcher = new CraftingMatcher();
