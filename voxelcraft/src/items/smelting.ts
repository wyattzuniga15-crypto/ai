/** Furnace family recipes and fuel values (vanilla burn times in ticks). */
import smeltingJson from '../../data/recipes/smelting.json';
import blastingJson from '../../data/recipes/blasting.json';
import smokingJson from '../../data/recipes/smoking.json';
import campfireJson from '../../data/recipes/campfire.json';
import tagsJson from '../../data/tags.json';
import type { ItemStack } from './inventory.ts';
import { ingredientMatches, type Ingredient } from './crafting.ts';

export interface CookingRecipe {
  id: string;
  group?: string;
  category?: string;
  ingredient: Ingredient;
  result: { item: string; count: number };
  experience: number;
  cookingTime: number;
}

export type FurnaceKind = 'furnace' | 'blast_furnace' | 'smoker' | 'campfire';

const lists: Record<FurnaceKind, CookingRecipe[]> = {
  furnace: smeltingJson as CookingRecipe[],
  blast_furnace: blastingJson as CookingRecipe[],
  smoker: smokingJson as CookingRecipe[],
  campfire: campfireJson as CookingRecipe[],
};

export function findCookingRecipe(kind: FurnaceKind, stack: ItemStack | null): CookingRecipe | null {
  if (!stack) return null;
  for (const r of lists[kind]) if (ingredientMatches(r.ingredient, stack)) return r;
  return null;
}

const itemTags = (tagsJson as { item: Record<string, string[]> }).item;
const tagFuel: [string, number][] = [
  ['logs', 300], ['planks', 300], ['wooden_stairs', 300], ['wooden_slabs', 150], ['wooden_fences', 300],
  ['wooden_buttons', 100], ['wooden_pressure_plates', 300], ['wooden_trapdoors', 300], ['wooden_doors', 200],
  ['saplings', 100], ['wool', 100], ['wool_carpets', 67], ['signs', 200], ['hanging_signs', 800], ['boats', 1200],
  ['banners', 300], ['bamboo_blocks', 300], ['fence_gates', 300],
];
const itemFuel: Record<string, number> = {
  lava_bucket: 20000, coal_block: 16000, blaze_rod: 2400, coal: 1600, charcoal: 1600, dried_kelp_block: 4000,
  bookshelf: 300, chiseled_bookshelf: 300, lectern: 300, chest: 300, trapped_chest: 300, crafting_table: 300, daylight_detector: 300,
  jukebox: 300, note_block: 300, ladder: 300, bow: 300, fishing_rod: 300, wooden_sword: 200, wooden_shovel: 200,
  wooden_pickaxe: 200, wooden_axe: 200, wooden_hoe: 200, stick: 100, bowl: 100, bamboo: 50, scaffolding: 400,
  dead_bush: 100, azalea: 100, flowering_azalea: 100, mangrove_roots: 300, barrel: 300, cartography_table: 300,
  fletching_table: 300, smithing_table: 300, loom: 300, composter: 300, crossbow: 300, bamboo_mosaic: 300,
  bamboo_mosaic_stairs: 300, bamboo_mosaic_slab: 150, leaf_litter: 100, dry_grass: 100, short_dry_grass: 100, tall_dry_grass: 100,
};

/** Burn time in ticks, or 0 when the item is not a fuel. */
export function fuelValue(stack: ItemStack | null): number {
  if (!stack) return 0;
  if (itemFuel[stack.id] !== undefined) return itemFuel[stack.id];
  for (const [tag, value] of tagFuel) if (itemTags[tag]?.includes(stack.id)) return value;
  return 0;
}

export function isFuel(stack: ItemStack | null): boolean {
  return fuelValue(stack) > 0;
}
