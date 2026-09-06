/**
 * Generates the game's data files in data/ from the vanilla data pack (recipes, loot tables, tags,
 * enchantments) and PrismarineJS minecraft-data (hardness, harvest tiers, entity sizes, biomes).
 * Everything here is rules and facts about Minecraft Java 1.21.11 – no art – so the output is
 * committed. Hand-maintained tables (tool and armor stats, foods, mob stats, biome surfaces) live in
 * this file and are merged in.
 *
 * Run `npm run assets` first (it downloads the sources into .cache/), then `npm run data`.
 */
import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import { ASSETS, DATA, MC_VERSION, jarDir, mcDataDir } from './lib/paths.ts';
import { ensureDir, listFiles, readJson, stripNs, writeJson } from './lib/fs.ts';

const md = mcDataDir();
const jar = jarDir();
const pack = path.join(jar, 'data', 'minecraft');
if (!fs.existsSync(path.join(md, 'blocks.json')) || !fs.existsSync(path.join(pack, 'recipe'))) {
  console.error('sources missing – run `npm run assets` first');
  process.exit(1);
}

// ------------------------------------------------------------------------------------------------
// Source types (minecraft-data)
// ------------------------------------------------------------------------------------------------
interface MdBlock {
  id: number; name: string; displayName: string; hardness: number | null; resistance: number;
  stackSize: number; diggable: boolean; material: string; transparent: boolean; emitLight: number;
  filterLight: number; defaultState: number; minStateId: number; maxStateId: number;
  states: { name: string; type: string; num_values: number; values?: string[] }[];
  harvestTools?: Record<string, boolean>; drops: number[]; boundingBox: 'block' | 'empty';
}
interface MdItem {
  id: number; name: string; displayName: string; stackSize: number; maxDurability?: number;
  enchantCategories?: string[]; repairWith?: string[];
}
interface MdEntity {
  id: number; name: string; displayName: string; width: number; height: number; type: string; category: string;
}
interface MdBiome {
  id: number; name: string; category: string; temperature: number; has_precipitation: boolean;
  dimension: string; displayName: string; color: number;
}
interface MdEffect { id: number; name: string; displayName: string; type: 'good' | 'bad' }
interface MdShapes { blocks: Record<string, number | number[]>; shapes: Record<string, number[][]> }
interface MdTints { [k: string]: { data: { keys: (string | number)[]; color: number }[] } }

const blocksMd = readJson<MdBlock[]>(path.join(md, 'blocks.json'));
const itemsMd = readJson<MdItem[]>(path.join(md, 'items.json'));
const entitiesMd = readJson<MdEntity[]>(path.join(md, 'entities.json'));
const biomesMd = readJson<MdBiome[]>(path.join(md, 'biomes.json'));
const effectsMd = readJson<MdEffect[]>(path.join(md, 'effects.json'));
const shapesMd = readJson<MdShapes>(path.join(md, 'blockCollisionShapes.json'));
const tintsMd = readJson<MdTints>(path.join(md, 'tints.json'));

const itemNameById = new Map<number, string>(itemsMd.map((i) => [i.id, i.name]));
const itemNames = new Set(itemsMd.map((i) => i.name));
const blockNames = new Set(blocksMd.map((b) => b.name));

// ------------------------------------------------------------------------------------------------
// Tags
// ------------------------------------------------------------------------------------------------
type TagValue = string | { id: string; required?: boolean };
function loadTags(kind: string): Record<string, string[]> {
  const dir = path.join(pack, 'tags', kind);
  const raw: Record<string, TagValue[]> = {};
  const walk = (d: string) => {
    if (!fs.existsSync(d)) return;
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.json') && !ent.name.startsWith('_')) {
        const name = path.relative(dir, p).slice(0, -5).replace(/\\/g, '/');
        raw[name] = readJson<{ values: TagValue[] }>(p).values ?? [];
      }
    }
  };
  walk(dir);
  const resolved: Record<string, string[]> = {};
  const resolve = (name: string, stack: string[] = []): string[] => {
    if (resolved[name]) return resolved[name];
    if (stack.includes(name)) return [];
    const out = new Set<string>();
    for (const v of raw[name] ?? []) {
      const id = typeof v === 'string' ? v : v.id;
      if (id.startsWith('#')) for (const x of resolve(stripNs(id.slice(1)), [...stack, name])) out.add(x);
      else out.add(stripNs(id));
    }
    return (resolved[name] = [...out].sort());
  };
  for (const name of Object.keys(raw)) resolve(name);
  return resolved;
}
const itemTags = loadTags('item');
const blockTags = loadTags('block');
const enchantmentTags = loadTags('enchantment');
const tagSet = (tags: Record<string, string[]>, name: string) => new Set(tags[name] ?? []);

// ------------------------------------------------------------------------------------------------
// Hand tables (Minecraft Java 1.21.11 values from the wiki)
// ------------------------------------------------------------------------------------------------
/** Mining speed multiplier, durability and attack stats per tool tier. */
const TIERS: Record<string, { level: number; speed: number; durability: number; enchantability: number; damageBonus: number }> = {
  wooden: { level: 0, speed: 2, durability: 59, enchantability: 15, damageBonus: 0 },
  golden: { level: 0, speed: 12, durability: 32, enchantability: 22, damageBonus: 0 },
  stone: { level: 1, speed: 4, durability: 131, enchantability: 5, damageBonus: 1 },
  copper: { level: 1, speed: 5, durability: 190, enchantability: 13, damageBonus: 1 },
  iron: { level: 2, speed: 6, durability: 250, enchantability: 14, damageBonus: 2 },
  diamond: { level: 3, speed: 8, durability: 1561, enchantability: 10, damageBonus: 3 },
  netherite: { level: 4, speed: 9, durability: 2031, enchantability: 15, damageBonus: 4 },
};
/** Base attack damage and attack speed per tool kind (damage is added to the tier bonus). */
const TOOL_KINDS: Record<string, { base: number; speed: number | Record<string, number> }> = {
  sword: { base: 4, speed: 1.6 },
  axe: { base: 7, speed: { wooden: 0.8, golden: 1.0, stone: 0.8, copper: 0.9, iron: 0.9, diamond: 1.0, netherite: 1.0 } },
  pickaxe: { base: 2, speed: 1.2 },
  shovel: { base: 2.5, speed: 1.0 },
  hoe: { base: 1, speed: { wooden: 1.0, golden: 1.0, stone: 2.0, copper: 2.0, iron: 3.0, diamond: 4.0, netherite: 4.0 } },
};
const AXE_DAMAGE: Record<string, number> = { wooden: 7, golden: 7, stone: 9, copper: 9, iron: 9, diamond: 9, netherite: 10 };
const HOE_DAMAGE = 1;
/** Armor points per material: [helmet, chestplate, leggings, boots], toughness, knockback resistance. */
const ARMOR: Record<string, { points: [number, number, number, number]; toughness: number; kb: number; enchantability: number }> = {
  leather: { points: [1, 3, 2, 1], toughness: 0, kb: 0, enchantability: 15 },
  copper: { points: [2, 4, 3, 1], toughness: 0, kb: 0, enchantability: 13 },
  chainmail: { points: [2, 5, 4, 1], toughness: 0, kb: 0, enchantability: 12 },
  golden: { points: [2, 5, 3, 1], toughness: 0, kb: 0, enchantability: 25 },
  iron: { points: [2, 6, 5, 2], toughness: 0, kb: 0, enchantability: 9 },
  diamond: { points: [3, 8, 6, 3], toughness: 2, kb: 0, enchantability: 10 },
  netherite: { points: [3, 8, 6, 3], toughness: 3, kb: 0.1, enchantability: 15 },
};
const ARMOR_SLOTS: Record<string, number> = { helmet: 0, chestplate: 1, leggings: 2, boots: 3 };

interface FoodDef { nutrition: number; saturationModifier: number; alwaysEdible?: boolean; fast?: boolean; effects?: { effect: string; duration: number; amplifier?: number; chance?: number }[]; container?: string }
const S = 20; // ticks per second
const FOODS: Record<string, FoodDef> = {
  apple: { nutrition: 4, saturationModifier: 0.3 },
  baked_potato: { nutrition: 5, saturationModifier: 0.6 },
  beetroot: { nutrition: 1, saturationModifier: 0.6 },
  beetroot_soup: { nutrition: 6, saturationModifier: 0.6, container: 'bowl' },
  bread: { nutrition: 5, saturationModifier: 0.6 },
  carrot: { nutrition: 3, saturationModifier: 0.6 },
  chorus_fruit: { nutrition: 4, saturationModifier: 0.3, alwaysEdible: true },
  cooked_chicken: { nutrition: 6, saturationModifier: 0.6 },
  cooked_cod: { nutrition: 5, saturationModifier: 0.6 },
  cooked_mutton: { nutrition: 6, saturationModifier: 0.8 },
  cooked_porkchop: { nutrition: 8, saturationModifier: 0.8 },
  cooked_rabbit: { nutrition: 5, saturationModifier: 0.6 },
  cooked_salmon: { nutrition: 6, saturationModifier: 0.8 },
  cooked_beef: { nutrition: 8, saturationModifier: 0.8 },
  cookie: { nutrition: 2, saturationModifier: 0.1 },
  dried_kelp: { nutrition: 1, saturationModifier: 0.6, fast: true },
  enchanted_golden_apple: {
    nutrition: 4, saturationModifier: 1.2, alwaysEdible: true,
    effects: [
      { effect: 'regeneration', duration: 20 * S, amplifier: 1 },
      { effect: 'absorption', duration: 120 * S, amplifier: 3 },
      { effect: 'resistance', duration: 300 * S },
      { effect: 'fire_resistance', duration: 300 * S },
    ],
  },
  golden_apple: {
    nutrition: 4, saturationModifier: 1.2, alwaysEdible: true,
    effects: [{ effect: 'regeneration', duration: 5 * S, amplifier: 1 }, { effect: 'absorption', duration: 120 * S }],
  },
  glow_berries: { nutrition: 2, saturationModifier: 0.1 },
  golden_carrot: { nutrition: 6, saturationModifier: 1.2 },
  honey_bottle: { nutrition: 6, saturationModifier: 0.1, alwaysEdible: true, container: 'glass_bottle' },
  melon_slice: { nutrition: 2, saturationModifier: 0.3 },
  mushroom_stew: { nutrition: 6, saturationModifier: 0.6, container: 'bowl' },
  poisonous_potato: { nutrition: 2, saturationModifier: 0.3, effects: [{ effect: 'poison', duration: 5 * S, chance: 0.6 }] },
  potato: { nutrition: 1, saturationModifier: 0.3 },
  pufferfish: {
    nutrition: 1, saturationModifier: 0.1,
    effects: [{ effect: 'poison', duration: 60 * S, amplifier: 1 }, { effect: 'hunger', duration: 15 * S, amplifier: 2 }, { effect: 'nausea', duration: 15 * S }],
  },
  pumpkin_pie: { nutrition: 8, saturationModifier: 0.3 },
  rabbit_stew: { nutrition: 10, saturationModifier: 0.6, container: 'bowl' },
  beef: { nutrition: 3, saturationModifier: 0.3 },
  chicken: { nutrition: 2, saturationModifier: 0.3, effects: [{ effect: 'hunger', duration: 30 * S, chance: 0.3 }] },
  cod: { nutrition: 2, saturationModifier: 0.1 },
  mutton: { nutrition: 2, saturationModifier: 0.3 },
  porkchop: { nutrition: 3, saturationModifier: 0.3 },
  rabbit: { nutrition: 3, saturationModifier: 0.3 },
  salmon: { nutrition: 2, saturationModifier: 0.1 },
  rotten_flesh: { nutrition: 4, saturationModifier: 0.1, effects: [{ effect: 'hunger', duration: 30 * S, chance: 0.8 }] },
  spider_eye: { nutrition: 2, saturationModifier: 0.8, effects: [{ effect: 'poison', duration: 5 * S }] },
  suspicious_stew: { nutrition: 6, saturationModifier: 0.6, alwaysEdible: true, container: 'bowl' },
  sweet_berries: { nutrition: 2, saturationModifier: 0.1 },
  tropical_fish: { nutrition: 1, saturationModifier: 0.1 },
};

/** Mob stats: max health, melee attack damage (normal difficulty), movement speed attribute, XP drop. */
const MOBS: Record<string, { health: number; damage?: number; speed: number; xp?: number; hostile?: boolean; passive?: boolean; neutral?: boolean }> = {
  zombie: { health: 20, damage: 3, speed: 0.23, xp: 5, hostile: true },
  zombie_villager: { health: 20, damage: 3, speed: 0.23, xp: 5, hostile: true },
  husk: { health: 20, damage: 3, speed: 0.23, xp: 5, hostile: true },
  drowned: { health: 20, damage: 3, speed: 0.23, xp: 5, hostile: true },
  skeleton: { health: 20, damage: 2, speed: 0.25, xp: 5, hostile: true },
  stray: { health: 20, damage: 2, speed: 0.25, xp: 5, hostile: true },
  bogged: { health: 16, damage: 2, speed: 0.25, xp: 5, hostile: true },
  wither_skeleton: { health: 20, damage: 8, speed: 0.25, xp: 5, hostile: true },
  creeper: { health: 20, damage: 0, speed: 0.25, xp: 5, hostile: true },
  spider: { health: 16, damage: 2, speed: 0.3, xp: 5, neutral: true },
  cave_spider: { health: 12, damage: 2, speed: 0.3, xp: 5, neutral: true },
  enderman: { health: 40, damage: 7, speed: 0.3, xp: 5, neutral: true },
  endermite: { health: 8, damage: 2, speed: 0.25, xp: 3, hostile: true },
  witch: { health: 26, damage: 0, speed: 0.25, xp: 5, hostile: true },
  slime: { health: 16, damage: 4, speed: 0.3, xp: 4, hostile: true },
  magma_cube: { health: 16, damage: 6, speed: 0.3, xp: 4, hostile: true },
  phantom: { health: 20, damage: 2, speed: 0.7, xp: 5, hostile: true },
  pillager: { health: 24, damage: 0, speed: 0.35, xp: 5, hostile: true },
  vindicator: { health: 24, damage: 5, speed: 0.35, xp: 5, hostile: true },
  evoker: { health: 24, damage: 6, speed: 0.5, xp: 10, hostile: true },
  vex: { health: 14, damage: 9, speed: 0.7, xp: 3, hostile: true },
  illusioner: { health: 32, damage: 0, speed: 0.5, xp: 5, hostile: true },
  ravager: { health: 100, damage: 12, speed: 0.3, xp: 20, hostile: true },
  breeze: { health: 30, damage: 0, speed: 0.63, xp: 10, hostile: true },
  warden: { health: 500, damage: 30, speed: 0.3, xp: 5, hostile: true },
  silverfish: { health: 8, damage: 1, speed: 0.25, xp: 5, hostile: true },
  guardian: { health: 30, damage: 6, speed: 0.5, xp: 10, hostile: true },
  elder_guardian: { health: 80, damage: 8, speed: 0.3, xp: 10, hostile: true },
  blaze: { health: 20, damage: 6, speed: 0.23, xp: 10, hostile: true },
  ghast: { health: 10, damage: 0, speed: 0.7, xp: 5, hostile: true },
  piglin: { health: 16, damage: 5, speed: 0.35, xp: 5, neutral: true },
  piglin_brute: { health: 50, damage: 7, speed: 0.35, xp: 20, hostile: true },
  zombified_piglin: { health: 20, damage: 5, speed: 0.23, xp: 5, neutral: true },
  hoglin: { health: 40, damage: 6, speed: 0.3, xp: 5, hostile: true },
  zoglin: { health: 40, damage: 6, speed: 0.3, xp: 5, hostile: true },
  strider: { health: 20, speed: 0.175, xp: 1, passive: true },
  shulker: { health: 30, damage: 4, speed: 0, xp: 5, hostile: true },
  creaking: { health: 1, damage: 3, speed: 0.4, xp: 0, hostile: true },
  parched: { health: 20, damage: 3, speed: 0.23, xp: 5, hostile: true },
  wither: { health: 300, damage: 8, speed: 0.6, xp: 50, hostile: true },
  ender_dragon: { health: 200, damage: 10, speed: 0.7, xp: 12000, hostile: true },
  giant: { health: 100, damage: 50, speed: 0.5, xp: 5, hostile: true },
  cow: { health: 10, speed: 0.2, xp: 1, passive: true },
  mooshroom: { health: 10, speed: 0.2, xp: 1, passive: true },
  pig: { health: 10, speed: 0.25, xp: 1, passive: true },
  sheep: { health: 8, speed: 0.23, xp: 1, passive: true },
  chicken: { health: 4, speed: 0.25, xp: 1, passive: true },
  horse: { health: 22, speed: 0.225, xp: 1, passive: true },
  donkey: { health: 22, speed: 0.175, xp: 1, passive: true },
  mule: { health: 22, speed: 0.175, xp: 1, passive: true },
  skeleton_horse: { health: 15, speed: 0.2, xp: 1, passive: true },
  zombie_horse: { health: 15, speed: 0.2, xp: 1, passive: true },
  wolf: { health: 8, damage: 4, speed: 0.3, xp: 1, neutral: true },
  cat: { health: 10, damage: 3, speed: 0.3, xp: 1, passive: true },
  ocelot: { health: 10, damage: 3, speed: 0.3, xp: 1, passive: true },
  parrot: { health: 6, speed: 0.2, xp: 1, passive: true },
  fox: { health: 10, damage: 2, speed: 0.3, xp: 1, passive: true },
  bee: { health: 10, damage: 2, speed: 0.3, xp: 1, neutral: true },
  axolotl: { health: 14, damage: 2, speed: 0.1, xp: 1, passive: true },
  frog: { health: 10, damage: 10, speed: 1.0, xp: 1, passive: true },
  tadpole: { health: 6, speed: 1.0, xp: 1, passive: true },
  villager: { health: 20, speed: 0.5, xp: 0, passive: true },
  wandering_trader: { health: 20, speed: 0.5, xp: 0, passive: true },
  iron_golem: { health: 100, damage: 15, speed: 0.25, xp: 0, neutral: true },
  snow_golem: { health: 4, damage: 0, speed: 0.2, xp: 0, passive: true },
  copper_golem: { health: 12, speed: 0.25, xp: 0, passive: true },
  squid: { health: 10, speed: 0.7, xp: 1, passive: true },
  glow_squid: { health: 10, speed: 0.7, xp: 1, passive: true },
  dolphin: { health: 10, damage: 3, speed: 1.2, xp: 1, neutral: true },
  turtle: { health: 30, speed: 0.25, xp: 1, passive: true },
  panda: { health: 20, damage: 6, speed: 0.15, xp: 1, neutral: true },
  polar_bear: { health: 30, damage: 6, speed: 0.25, xp: 1, neutral: true },
  llama: { health: 22, damage: 1, speed: 0.175, xp: 1, neutral: true },
  trader_llama: { health: 22, damage: 1, speed: 0.175, xp: 1, neutral: true },
  goat: { health: 10, damage: 2, speed: 0.2, xp: 1, neutral: true },
  rabbit: { health: 3, speed: 0.3, xp: 1, passive: true },
  bat: { health: 6, speed: 0.6, xp: 0, passive: true },
  camel: { health: 32, speed: 0.09, xp: 1, passive: true },
  sniffer: { health: 14, speed: 0.1, xp: 1, passive: true },
  armadillo: { health: 12, speed: 0.14, xp: 1, passive: true },
  allay: { health: 20, speed: 0.1, xp: 0, passive: true },
  cod: { health: 3, speed: 0.7, xp: 1, passive: true },
  salmon: { health: 3, speed: 0.7, xp: 1, passive: true },
  pufferfish: { health: 3, damage: 3, speed: 0.7, xp: 1, passive: true },
  tropical_fish: { health: 3, speed: 0.7, xp: 1, passive: true },
  happy_ghast: { health: 20, speed: 0.05, xp: 0, passive: true },
  nautilus: { health: 8, speed: 0.7, xp: 1, passive: true },
  zombie_nautilus: { health: 8, speed: 0.7, xp: 1, hostile: true },
  camel_husk: { health: 32, damage: 3, speed: 0.09, xp: 5, hostile: true },
};

/** Surface and vegetation config for biomes the world generator supports. */
interface BiomeSurface { top: string; filler: string; underwater?: string; trees?: [string, number][]; grassDensity?: number; flowers?: string[]; extra?: string[]; snow?: boolean }
const BIOME_SURFACE: Record<string, BiomeSurface> = {
  plains: { top: 'grass_block', filler: 'dirt', trees: [['oak', 0.03]], grassDensity: 0.25, flowers: ['dandelion', 'poppy', 'azure_bluet', 'oxeye_daisy', 'cornflower'] },
  sunflower_plains: { top: 'grass_block', filler: 'dirt', trees: [['oak', 0.03]], grassDensity: 0.25, flowers: ['dandelion', 'poppy', 'azure_bluet', 'oxeye_daisy', 'cornflower'], extra: ['sunflower'] },
  forest: { top: 'grass_block', filler: 'dirt', trees: [['oak', 0.6], ['birch', 0.3], ['fancy_oak', 0.1]], grassDensity: 0.3, flowers: ['dandelion', 'poppy', 'lily_of_the_valley'] },
  flower_forest: { top: 'grass_block', filler: 'dirt', trees: [['oak', 0.5], ['birch', 0.5]], grassDensity: 0.2, flowers: ['dandelion', 'poppy', 'allium', 'azure_bluet', 'red_tulip', 'orange_tulip', 'white_tulip', 'pink_tulip', 'oxeye_daisy', 'cornflower', 'lily_of_the_valley'] },
  birch_forest: { top: 'grass_block', filler: 'dirt', trees: [['birch', 1]], grassDensity: 0.3, flowers: ['dandelion', 'poppy', 'lily_of_the_valley'] },
  old_growth_birch_forest: { top: 'grass_block', filler: 'dirt', trees: [['tall_birch', 1]], grassDensity: 0.3, flowers: ['dandelion', 'poppy', 'lily_of_the_valley'] },
  dark_forest: { top: 'grass_block', filler: 'dirt', trees: [['dark_oak', 0.7], ['oak', 0.2], ['birch', 0.1]], grassDensity: 0.3, flowers: ['dandelion', 'poppy'], extra: ['brown_mushroom', 'red_mushroom'] },
  taiga: { top: 'grass_block', filler: 'dirt', trees: [['spruce', 0.7], ['pine', 0.3]], grassDensity: 0.3, flowers: ['dandelion', 'poppy'], extra: ['fern', 'large_fern', 'sweet_berry_bush'] },
  old_growth_pine_taiga: { top: 'grass_block', filler: 'dirt', trees: [['mega_pine', 0.3], ['spruce', 0.4], ['pine', 0.3]], grassDensity: 0.3, extra: ['fern', 'large_fern', 'sweet_berry_bush', 'brown_mushroom', 'red_mushroom'] },
  old_growth_spruce_taiga: { top: 'grass_block', filler: 'dirt', trees: [['mega_spruce', 0.3], ['spruce', 0.7]], grassDensity: 0.3, extra: ['fern', 'large_fern', 'sweet_berry_bush', 'brown_mushroom', 'red_mushroom'] },
  snowy_taiga: { top: 'grass_block', filler: 'dirt', trees: [['spruce', 1]], grassDensity: 0.1, extra: ['fern'], snow: true },
  snowy_plains: { top: 'grass_block', filler: 'dirt', trees: [['spruce', 0.01]], grassDensity: 0.02, snow: true },
  ice_spikes: { top: 'snow_block', filler: 'dirt', grassDensity: 0, snow: true },
  desert: { top: 'sand', filler: 'sandstone', extra: ['cactus', 'dead_bush'] },
  savanna: { top: 'grass_block', filler: 'dirt', trees: [['acacia', 0.8], ['oak', 0.2]], grassDensity: 0.4, flowers: ['dandelion', 'poppy'] },
  savanna_plateau: { top: 'grass_block', filler: 'dirt', trees: [['acacia', 0.8], ['oak', 0.2]], grassDensity: 0.4 },
  windswept_savanna: { top: 'grass_block', filler: 'dirt', trees: [['acacia', 0.8], ['oak', 0.2]], grassDensity: 0.4 },
  jungle: { top: 'grass_block', filler: 'dirt', trees: [['jungle', 0.5], ['jungle_bush', 0.3], ['mega_jungle', 0.2]], grassDensity: 0.5, extra: ['fern', 'melon', 'bamboo'] },
  sparse_jungle: { top: 'grass_block', filler: 'dirt', trees: [['jungle', 0.5], ['jungle_bush', 0.3], ['oak', 0.2]], grassDensity: 0.4, extra: ['fern', 'melon'] },
  bamboo_jungle: { top: 'grass_block', filler: 'dirt', trees: [['jungle', 0.3], ['mega_jungle', 0.2]], grassDensity: 0.4, extra: ['bamboo', 'bamboo', 'bamboo'] },
  swamp: { top: 'grass_block', filler: 'dirt', underwater: 'clay', trees: [['swamp_oak', 1]], grassDensity: 0.4, flowers: ['blue_orchid'], extra: ['lily_pad', 'brown_mushroom', 'red_mushroom'] },
  mangrove_swamp: { top: 'mud', filler: 'mud', trees: [['mangrove', 1]], grassDensity: 0.3 },
  beach: { top: 'sand', filler: 'sandstone' },
  snowy_beach: { top: 'sand', filler: 'sandstone', snow: true },
  stony_shore: { top: 'stone', filler: 'stone' },
  river: { top: 'sand', filler: 'dirt', underwater: 'gravel' },
  frozen_river: { top: 'sand', filler: 'dirt', underwater: 'gravel', snow: true },
  ocean: { top: 'gravel', filler: 'gravel', underwater: 'gravel' },
  deep_ocean: { top: 'gravel', filler: 'gravel', underwater: 'gravel' },
  warm_ocean: { top: 'sand', filler: 'sand', underwater: 'sand' },
  lukewarm_ocean: { top: 'sand', filler: 'sand', underwater: 'sand' },
  deep_lukewarm_ocean: { top: 'sand', filler: 'sand', underwater: 'sand' },
  cold_ocean: { top: 'gravel', filler: 'gravel', underwater: 'gravel' },
  deep_cold_ocean: { top: 'gravel', filler: 'gravel', underwater: 'gravel' },
  frozen_ocean: { top: 'gravel', filler: 'gravel', underwater: 'gravel', snow: true },
  deep_frozen_ocean: { top: 'gravel', filler: 'gravel', underwater: 'gravel', snow: true },
  mushroom_fields: { top: 'mycelium', filler: 'dirt', extra: ['brown_mushroom', 'red_mushroom'] },
  windswept_hills: { top: 'grass_block', filler: 'dirt', trees: [['spruce', 0.5], ['oak', 0.5]], grassDensity: 0.1 },
  windswept_gravelly_hills: { top: 'gravel', filler: 'gravel', trees: [['spruce', 0.5], ['oak', 0.5]] },
  windswept_forest: { top: 'grass_block', filler: 'dirt', trees: [['spruce', 0.5], ['oak', 0.5]], grassDensity: 0.2 },
  meadow: { top: 'grass_block', filler: 'dirt', trees: [['oak', 0.01], ['birch', 0.01]], grassDensity: 0.5, flowers: ['dandelion', 'poppy', 'allium', 'azure_bluet', 'oxeye_daisy', 'cornflower'] },
  cherry_grove: { top: 'grass_block', filler: 'dirt', trees: [['cherry', 1]], grassDensity: 0.4, flowers: ['pink_petals', 'pink_petals'] },
  grove: { top: 'snow_block', filler: 'dirt', trees: [['spruce', 1]], snow: true },
  snowy_slopes: { top: 'snow_block', filler: 'stone', snow: true },
  jagged_peaks: { top: 'snow_block', filler: 'stone', snow: true },
  frozen_peaks: { top: 'snow_block', filler: 'stone', snow: true },
  stony_peaks: { top: 'stone', filler: 'stone' },
  badlands: { top: 'red_sand', filler: 'terracotta', extra: ['dead_bush', 'cactus'] },
  eroded_badlands: { top: 'red_sand', filler: 'terracotta', extra: ['dead_bush', 'cactus'] },
  wooded_badlands: { top: 'grass_block', filler: 'terracotta', trees: [['oak', 1]], grassDensity: 0.2, extra: ['dead_bush'] },
  pale_garden: { top: 'grass_block', filler: 'dirt', trees: [['pale_oak', 1]], grassDensity: 0.2, extra: ['pale_moss_carpet'] },
  deep_dark: { top: 'sculk', filler: 'deepslate' },
  dripstone_caves: { top: 'dripstone_block', filler: 'stone' },
  lush_caves: { top: 'moss_block', filler: 'stone' },
  nether_wastes: { top: 'netherrack', filler: 'netherrack' },
  soul_sand_valley: { top: 'soul_sand', filler: 'soul_soil' },
  crimson_forest: { top: 'crimson_nylium', filler: 'netherrack' },
  warped_forest: { top: 'warped_nylium', filler: 'netherrack' },
  basalt_deltas: { top: 'basalt', filler: 'blackstone' },
  the_end: { top: 'end_stone', filler: 'end_stone' },
  end_highlands: { top: 'end_stone', filler: 'end_stone' },
  end_midlands: { top: 'end_stone', filler: 'end_stone' },
  end_barrens: { top: 'end_stone', filler: 'end_stone' },
  small_end_islands: { top: 'end_stone', filler: 'end_stone' },
  the_void: { top: 'air', filler: 'air' },
};

/** Item ids whose placed block has a different id. */
const ITEM_PLACES: Record<string, string> = {
  wheat_seeds: 'wheat', carrot: 'carrots', potato: 'potatoes', beetroot_seeds: 'beetroots', melon_seeds: 'melon_stem',
  pumpkin_seeds: 'pumpkin_stem', torchflower_seeds: 'torchflower_crop', pitcher_pod: 'pitcher_crop', redstone: 'redstone_wire',
  string: 'tripwire', cocoa_beans: 'cocoa', sweet_berries: 'sweet_berry_bush', glow_berries: 'cave_vines', bamboo: 'bamboo_sapling',
  water_bucket: 'water', lava_bucket: 'lava', powder_snow_bucket: 'powder_snow', flower_pot: 'flower_pot', cake: 'cake',
  repeater: 'repeater', comparator: 'comparator', brewing_stand: 'brewing_stand', cauldron: 'cauldron', sugar_cane: 'sugar_cane',
  nether_wart: 'nether_wart', kelp: 'kelp', frogspawn: 'frogspawn', lily_pad: 'lily_pad', torch: 'torch', soul_torch: 'soul_torch',
  redstone_torch: 'redstone_torch', copper_torch: 'copper_torch', lantern: 'lantern', soul_lantern: 'soul_lantern', copper_lantern: 'copper_lantern', chain: 'chain', bell: 'bell',
  campfire: 'campfire', soul_campfire: 'soul_campfire', scaffolding: 'scaffolding', ladder: 'ladder', vine: 'vine', snow: 'snow', hopper: 'hopper',
  end_crystal: '', painting: '', item_frame: '', glow_item_frame: '', armor_stand: '',
};

// ------------------------------------------------------------------------------------------------
// Behavior classification
// ------------------------------------------------------------------------------------------------
const CONTAINERS = new Set(['chest', 'trapped_chest', 'ender_chest', 'barrel', 'furnace', 'blast_furnace', 'smoker', 'hopper', 'dropper', 'dispenser', 'brewing_stand', 'copper_chest', 'exposed_copper_chest', 'weathered_copper_chest', 'oxidized_copper_chest', 'waxed_copper_chest', 'waxed_exposed_copper_chest', 'waxed_weathered_copper_chest', 'waxed_oxidized_copper_chest']);
const WORKSTATIONS = new Set(['crafting_table', 'enchanting_table', 'anvil', 'chipped_anvil', 'damaged_anvil', 'grindstone', 'smithing_table', 'cartography_table', 'loom', 'stonecutter', 'beacon', 'lectern', 'crafter']);
const CROPS = new Set(['wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart', 'melon_stem', 'pumpkin_stem', 'attached_melon_stem', 'attached_pumpkin_stem', 'torchflower_crop', 'pitcher_crop', 'sweet_berry_bush', 'cocoa']);
const FLUIDS = new Set(['water', 'lava']);
const FALLING = new Set(['sand', 'red_sand', 'gravel', 'anvil', 'chipped_anvil', 'damaged_anvil', 'dragon_egg', 'suspicious_sand', 'suspicious_gravel']);
const REDSTONE = new Set(['redstone_wire', 'repeater', 'comparator', 'lever', 'observer', 'piston', 'sticky_piston', 'piston_head', 'moving_piston', 'redstone_torch', 'redstone_wall_torch', 'redstone_block', 'target', 'daylight_detector', 'tripwire', 'tripwire_hook', 'tnt', 'note_block', 'redstone_lamp', 'lightning_rod', 'sculk_sensor', 'calibrated_sculk_sensor', 'crafter', 'copper_bulb', 'exposed_copper_bulb', 'weathered_copper_bulb', 'oxidized_copper_bulb', 'waxed_copper_bulb', 'waxed_exposed_copper_bulb', 'waxed_weathered_copper_bulb', 'waxed_oxidized_copper_bulb']);
const SPREADING = new Set(['grass_block', 'mycelium', 'podzol', 'crimson_nylium', 'warped_nylium']);

const tagHas = (tag: string, name: string) => (blockTags[tag] ?? []).includes(name);
const PLANT_NAMES = new Set(['short_grass', 'tall_grass', 'fern', 'large_fern', 'dead_bush', 'seagrass', 'tall_seagrass', 'lily_pad', 'moss_carpet', 'sea_pickle', 'small_dripleaf', 'big_dripleaf', 'big_dripleaf_stem', 'spore_blossom', 'hanging_roots', 'pink_petals', 'wildflowers', 'bush', 'firefly_bush', 'cactus_flower', 'leaf_litter', 'pitcher_plant', 'glow_lichen', 'sculk_vein', 'dry_grass', 'short_dry_grass', 'tall_dry_grass', 'nether_sprouts', 'warped_roots', 'crimson_roots', 'warped_fungus', 'crimson_fungus', 'brown_mushroom', 'red_mushroom', 'mangrove_propagule', 'azalea', 'flowering_azalea', 'sunflower', 'lilac', 'rose_bush', 'peony', 'torchflower', 'weeping_vines', 'twisting_vines', 'weeping_vines_plant', 'twisting_vines_plant', 'kelp', 'kelp_plant', 'vine', 'cave_vines', 'cave_vines_plant', 'pale_hanging_moss', 'pale_moss_carpet', 'sugar_cane', 'bamboo_sapling']);

function blockBehavior(b: MdBlock): string {
  const n = b.name;
  if (FLUIDS.has(n)) return 'fluid';
  if (n === 'air' || n === 'cave_air' || n === 'void_air') return 'air';
  if (CROPS.has(n) || tagHas('crops', n)) return 'crop';
  if (CONTAINERS.has(n) || tagHas('shulker_boxes', n)) return 'container';
  if (WORKSTATIONS.has(n)) return 'workstation';
  if (REDSTONE.has(n) || tagHas('rails', n)) return 'redstone';
  if (tagHas('pressure_plates', n)) return 'pressure_plate';
  if (tagHas('buttons', n)) return 'button';
  if (tagHas('doors', n)) return 'door';
  if (tagHas('trapdoors', n)) return 'trapdoor';
  if (tagHas('fence_gates', n)) return 'fence_gate';
  if (tagHas('fences', n)) return 'fence';
  if (tagHas('walls', n)) return 'wall';
  if (tagHas('stairs', n)) return 'stairs';
  if (tagHas('slabs', n)) return 'slab';
  if (tagHas('beds', n)) return 'bed';
  if (tagHas('all_signs', n)) return 'sign';
  if (tagHas('banners', n)) return 'banner';
  if (n.endsWith('_head') || n.endsWith('_skull')) return 'head';
  if (tagHas('leaves', n)) return 'leaves';
  if (tagHas('saplings', n) || n === 'bamboo_sapling') return 'sapling';
  if (tagHas('wool_carpets', n) || n === 'moss_carpet' || n === 'pale_moss_carpet') return 'carpet';
  if (n.endsWith('_glass_pane') || n === 'glass_pane' || n === 'iron_bars' || n.endsWith('_bars') || n.endsWith('_chain') || n === 'chain') return 'pane';
  if (tagHas('impermeable', n) || n === 'tinted_glass') return 'glass';
  if (n.endsWith('_torch') || n === 'torch') return 'torch';
  if (tagHas('candles', n) || tagHas('candle_cakes', n)) return 'candle';
  if (n.endsWith('_concrete_powder') || FALLING.has(n)) return 'falling';
  if (tagHas('logs', n) || n.endsWith('_wood') || n.endsWith('_hyphae') || n === 'bamboo_block' || n === 'stripped_bamboo_block' || n.startsWith('stripped_')) return 'log';
  if (n.endsWith('_ore') || n === 'ancient_debris' || n === 'gilded_blackstone') return 'ore';
  if (tagHas('corals', n) || tagHas('wall_corals', n) || tagHas('coral_blocks', n) || n.endsWith('_coral_block') || n.endsWith('_coral_fan') || n.endsWith('_coral_wall_fan') || n.endsWith('_coral')) return 'coral';
  if (tagHas('climbable', n) && n !== 'cave_vines' && n !== 'weeping_vines' && n !== 'twisting_vines' && n !== 'vine') return 'climbable';
  if (n === 'farmland' || n === 'dirt_path') return 'farmland';
  if (SPREADING.has(n)) return 'spreading';
  if (n === 'snow') return 'snow_layer';
  if (n === 'powder_snow') return 'powder_snow';
  if (n === 'cactus' || n === 'sugar_cane' || n === 'bamboo' || n === 'kelp' || n === 'kelp_plant' || n === 'chorus_plant' || n === 'chorus_flower') return 'growing';
  if (tagHas('fire', n)) return 'fire';
  if (tagHas('portals', n)) return 'portal';
  if (n === 'bedrock' || n === 'barrier' || n === 'command_block' || n === 'structure_block' || n === 'jigsaw' || n === 'light' || n.endsWith('_command_block') || n === 'end_portal_frame' || n === 'reinforced_deepslate' || n === 'test_block' || n === 'test_instance_block') return 'unbreakable';
  if (tagHas('ice', n)) return 'ice';
  if (tagHas('small_flowers', n) || tagHas('tall_flowers', n) || tagHas('flowers', n) || PLANT_NAMES.has(n) || b.material.includes('plant') || n.endsWith('_flower') || n.endsWith('_roots') || n.endsWith('_fungus') || n.endsWith('_mushroom')) return 'plant';
  if (tagHas('flower_pots', n)) return 'decoration';
  if (n === 'tnt') return 'redstone';
  return 'solid';
}

function itemBehavior(name: string): string {
  if (name in FOODS) return 'food';
  if (name.endsWith('_spawn_egg')) return 'spawn_egg';
  if (name.startsWith('music_disc_')) return 'music_disc';
  if (name.endsWith('_sword')) return 'sword';
  if (name.endsWith('_spear')) return 'spear';
  if (name.endsWith('_pickaxe')) return 'pickaxe';
  if (name.endsWith('_axe')) return 'axe';
  if (name.endsWith('_shovel')) return 'shovel';
  if (name.endsWith('_hoe')) return 'hoe';
  if (name.endsWith('_helmet') || name.endsWith('_chestplate') || name.endsWith('_leggings') || name.endsWith('_boots')) return 'armor';
  if (name.endsWith('_horse_armor') || name === 'wolf_armor' || name === 'saddle' || name.endsWith('_harness')) return 'animal_equipment';
  if (name === 'bucket' || name.endsWith('_bucket')) return 'bucket';
  if (name === 'potion' || name === 'splash_potion' || name === 'lingering_potion') return 'potion';
  if (name.endsWith('_boat') || name.endsWith('_raft')) return 'boat';
  if (name.endsWith('minecart')) return 'minecart';
  if (name.endsWith('_dye')) return 'dye';
  if (name.endsWith('_banner_pattern')) return 'banner_pattern';
  if (name.endsWith('_smithing_template')) return 'smithing_template';
  if (name.endsWith('_pottery_sherd')) return 'pottery_sherd';
  if (name === 'bundle' || name.endsWith('_bundle')) return 'bundle';
  if (name === 'arrow' || name === 'spectral_arrow' || name === 'tipped_arrow') return 'arrow';
  if (name === 'ender_pearl' || name === 'snowball' || name === 'egg' || name === 'wind_charge' || name === 'experience_bottle' || name === 'fire_charge' || name === 'ender_eye' || name.endsWith('_egg') && name !== 'dragon_egg') return 'throwable';
  const singles: Record<string, string> = {
    bow: 'bow', crossbow: 'crossbow', trident: 'trident', shield: 'shield', elytra: 'elytra', fishing_rod: 'fishing_rod',
    shears: 'shears', flint_and_steel: 'flint_and_steel', bone_meal: 'bone_meal', compass: 'compass', recovery_compass: 'compass',
    clock: 'clock', map: 'map', filled_map: 'map', book: 'book', writable_book: 'book', written_book: 'book', enchanted_book: 'enchanted_book',
    name_tag: 'name_tag', lead: 'lead', firework_rocket: 'firework', firework_star: 'firework_star', totem_of_undying: 'totem',
    mace: 'mace', brush: 'brush', goat_horn: 'goat_horn', spyglass: 'spyglass', turtle_helmet: 'armor', milk_bucket: 'bucket',
    glass_bottle: 'bottle', item_frame: 'placeable_entity', glow_item_frame: 'placeable_entity', painting: 'placeable_entity',
    armor_stand: 'placeable_entity', end_crystal: 'placeable_entity', carrot_on_a_stick: 'tool', warped_fungus_on_a_stick: 'tool',
  };
  if (singles[name]) return singles[name];
  if (blockNames.has(name) || ITEM_PLACES[name]) return 'block';
  return 'item';
}

// ------------------------------------------------------------------------------------------------
// Blocks
// ------------------------------------------------------------------------------------------------
const TIER_ORDER: [string, number][] = [['wooden', 0], ['stone', 1], ['iron', 2], ['diamond', 3], ['netherite', 4]];
const mineable: Record<string, Set<string>> = {
  pickaxe: tagSet(blockTags, 'mineable/pickaxe'),
  axe: tagSet(blockTags, 'mineable/axe'),
  shovel: tagSet(blockTags, 'mineable/shovel'),
  hoe: tagSet(blockTags, 'mineable/hoe'),
};
const incorrectFor: Record<string, Set<string>> = {};
for (const [t] of TIER_ORDER) incorrectFor[t] = tagSet(blockTags, `incorrect_for_${t}_tool`);
const swordEfficient = tagSet(blockTags, 'sword_efficient');
const swordInstant = tagSet(blockTags, 'sword_instantly_mines');
const leavesTag = tagSet(blockTags, 'leaves');
const woolTag = tagSet(blockTags, 'wool');

function harvestTier(name: string, b: MdBlock): number | null {
  if (!b.harvestTools) return null;
  for (const [t, level] of TIER_ORDER) if (!incorrectFor[t].has(name)) return level;
  return 4;
}

const blocks = blocksMd.map((b) => {
  let tool: string | null = null;
  for (const [k, set] of Object.entries(mineable)) if (set.has(b.name)) { tool = k; break; }
  const states = b.states.map((s) => ({
    name: s.name,
    values: s.type === 'bool' ? ['true', 'false'] : (s.values ?? []),
  }));
  const tier = harvestTier(b.name, b);
  const shape = shapesMd.blocks[b.name];
  const out: Record<string, unknown> = {
    id: b.name,
    name: b.displayName,
    num: b.id,
    hardness: b.hardness === null ? -1 : b.hardness,
    resistance: b.resistance,
    tool,
    tier,
    requiresTool: tier !== null,
    transparent: b.transparent,
    emit: b.emitLight,
    filter: b.filterLight,
    min: b.minStateId,
    max: b.maxStateId,
    default: b.defaultState,
    states,
    solid: b.boundingBox === 'block',
    behavior: blockBehavior(b),
    drops: b.drops.map((d) => itemNameById.get(d)).filter((x): x is string => !!x),
  };
  if (tagHas('replaceable', b.name)) out.replaceable = true;
  if (swordEfficient.has(b.name)) out.swordEfficient = true;
  if (swordInstant.has(b.name)) out.swordInstant = true;
  if (leavesTag.has(b.name)) out.shearsSpeed = 15;
  else if (woolTag.has(b.name) || b.name === 'cobweb') out.shearsSpeed = b.name === 'cobweb' ? 15 : 5;
  if (b.name === 'cobweb') out.swordSpeed = 15;
  else if (leavesTag.has(b.name) || b.material.includes('plant') || b.material.includes('gourd')) out.swordSpeed = 1.5;
  if (typeof shape === 'number' ? shape !== 1 : Array.isArray(shape)) out.shape = shape;
  return out;
});
writeJson(path.join(DATA, 'blocks.json'), blocks);
writeJson(path.join(DATA, 'collision.json'), { shapes: shapesMd.shapes });

// ------------------------------------------------------------------------------------------------
// Items
// ------------------------------------------------------------------------------------------------
const items = itemsMd.map((i) => {
  const behavior = itemBehavior(i.name);
  const out: Record<string, unknown> = {
    id: i.name,
    name: i.displayName,
    num: i.id,
    stack: i.stackSize,
    behavior,
  };
  if (i.maxDurability) out.durability = i.maxDurability;
  if (i.repairWith?.length) out.repair = i.repairWith;
  if (i.enchantCategories?.length) out.enchant = i.enchantCategories;
  const m = /^(wooden|stone|copper|iron|golden|diamond|netherite)_(sword|pickaxe|axe|shovel|hoe|helmet|chestplate|leggings|boots)$/.exec(i.name);
  if (m) {
    const [, mat, kind] = m;
    if (kind in TOOL_KINDS) {
      const tier = TIERS[mat];
      out.tier = mat;
      out.tierLevel = tier.level;
      out.miningSpeed = tier.speed;
      out.enchantability = tier.enchantability;
      out.durability = i.maxDurability ?? tier.durability;
      const spec = TOOL_KINDS[kind];
      let damage = spec.base + tier.damageBonus;
      if (kind === 'axe') damage = AXE_DAMAGE[mat];
      if (kind === 'hoe') damage = HOE_DAMAGE;
      out.attack = { damage, speed: typeof spec.speed === 'number' ? spec.speed : spec.speed[mat] };
    } else if (kind in ARMOR_SLOTS && ARMOR[mat]) {
      const a = ARMOR[mat];
      out.armor = { slot: kind, points: a.points[ARMOR_SLOTS[kind]], toughness: a.toughness, knockbackResistance: a.kb };
      out.enchantability = a.enchantability;
    }
  }
  const cm = /^(leather|chainmail)_(helmet|chestplate|leggings|boots)$/.exec(i.name);
  if (cm) {
    const a = ARMOR[cm[1]];
    out.armor = { slot: cm[2], points: a.points[ARMOR_SLOTS[cm[2]]], toughness: 0, knockbackResistance: 0 };
    out.enchantability = a.enchantability;
  }
  const ENCHANTABILITY: Record<string, number> = { book: 1, bow: 1, crossbow: 1, fishing_rod: 1, trident: 1, shield: 1, elytra: 15, turtle_helmet: 9, mace: 15, shears: 1, flint_and_steel: 1, carrot_on_a_stick: 1, warped_fungus_on_a_stick: 1, brush: 1, compass: 1, recovery_compass: 1, spyglass: 1 };
  if (ENCHANTABILITY[i.name] !== undefined) out.enchantability = ENCHANTABILITY[i.name];
  if (i.name === 'turtle_helmet') out.armor = { slot: 'helmet', points: 2, toughness: 0, knockbackResistance: 0 };
  if (i.name === 'elytra') out.armor = { slot: 'chestplate', points: 0, toughness: 0, knockbackResistance: 0 };
  if (i.name === 'trident') out.attack = { damage: 9, speed: 1.1 };
  if (i.name === 'mace') out.attack = { damage: 6, speed: 0.6 };
  if (i.name === 'shears') out.miningSpeed = 5;
  if (FOODS[i.name]) {
    const f = FOODS[i.name];
    out.food = {
      nutrition: f.nutrition,
      saturation: Math.round(f.nutrition * f.saturationModifier * 2 * 100) / 100,
      ...(f.alwaysEdible ? { alwaysEdible: true } : {}),
      ...(f.fast ? { eatTicks: 16 } : {}),
      ...(f.effects ? { effects: f.effects } : {}),
      ...(f.container ? { container: f.container } : {}),
    };
  }
  if (behavior === 'block') {
    const place = ITEM_PLACES[i.name] ?? i.name;
    if (place) out.block = place;
  }
  return out;
});
writeJson(path.join(DATA, 'items.json'), items);

// ------------------------------------------------------------------------------------------------
// Recipes
// ------------------------------------------------------------------------------------------------
type Ingredient = string | string[];
function ingredient(v: unknown): Ingredient {
  const list = new Set<string>();
  const add = (x: unknown) => {
    if (typeof x === 'string') {
      if (x.startsWith('#')) for (const id of itemTags[stripNs(x.slice(1))] ?? []) list.add(id);
      else list.add(stripNs(x));
    } else if (Array.isArray(x)) x.forEach(add);
    else if (x && typeof x === 'object') {
      const o = x as { item?: string; tag?: string; id?: string };
      if (o.item) list.add(stripNs(o.item));
      else if (o.id) list.add(stripNs(o.id));
      else if (o.tag) for (const id of itemTags[stripNs(o.tag)] ?? []) list.add(id);
    }
  };
  add(v);
  const arr = [...list].sort();
  return arr.length === 1 ? arr[0] : arr;
}
interface RawRecipe {
  type: string; category?: string; group?: string; pattern?: string[]; key?: Record<string, unknown>;
  ingredients?: unknown[]; ingredient?: unknown; result?: { id: string; count?: number } | string;
  experience?: number; cookingtime?: number; template?: unknown; base?: unknown; addition?: unknown;
  input?: unknown; material?: unknown; pattern_id?: string;
}
const trimPatternOf = (r: RawRecipe) => (typeof r.pattern === 'string' ? stripNs(r.pattern) : r.pattern_id ? stripNs(r.pattern_id) : undefined);
const result = (r: RawRecipe) => {
  if (!r.result) return undefined;
  if (typeof r.result === 'string') return { item: stripNs(r.result), count: 1 };
  return { item: stripNs(r.result.id), count: r.result.count ?? 1 };
};
const crafting: unknown[] = [];
const cooking: Record<string, unknown[]> = { smelting: [], blasting: [], smoking: [], campfire: [] };
const stonecutting: unknown[] = [];
const smithing: unknown[] = [];
const special: unknown[] = [];
const recipeDir = path.join(pack, 'recipe');
for (const f of listFiles(recipeDir, '.json')) {
  if (f.startsWith('_')) continue;
  const id = f.slice(0, -5);
  const r = readJson<RawRecipe>(path.join(recipeDir, f));
  const type = stripNs(r.type);
  const common = { id, ...(r.group ? { group: r.group } : {}), ...(r.category ? { category: r.category } : {}) };
  switch (type) {
    case 'crafting_shaped':
      crafting.push({ ...common, type: 'shaped', pattern: r.pattern, key: Object.fromEntries(Object.entries(r.key ?? {}).map(([k, v]) => [k, ingredient(v)])), result: result(r) });
      break;
    case 'crafting_shapeless':
      crafting.push({ ...common, type: 'shapeless', ingredients: (r.ingredients ?? []).map(ingredient), result: result(r) });
      break;
    case 'crafting_transmute':
      crafting.push({ ...common, type: 'transmute', input: ingredient(r.input), material: ingredient(r.material), result: result(r) });
      break;
    case 'smelting': case 'blasting': case 'smoking': case 'campfire_cooking':
      cooking[type === 'campfire_cooking' ? 'campfire' : type].push({ ...common, ingredient: ingredient(r.ingredient), result: result(r), experience: r.experience ?? 0, cookingTime: r.cookingtime ?? 200 });
      break;
    case 'stonecutting':
      stonecutting.push({ ...common, ingredient: ingredient(r.ingredient), result: result(r) });
      break;
    case 'smithing_transform':
      smithing.push({ ...common, type: 'transform', template: ingredient(r.template), base: ingredient(r.base), addition: ingredient(r.addition), result: result(r) });
      break;
    case 'smithing_trim':
      smithing.push({ ...common, type: 'trim', template: ingredient(r.template), base: ingredient(r.base), addition: ingredient(r.addition), pattern: trimPatternOf(r) });
      break;
    default:
      if (type.startsWith('crafting_special_') || type === 'crafting_decorated_pot') special.push({ ...common, type: type.replace('crafting_special_', '').replace('crafting_', '') });
      else console.warn(`unknown recipe type ${type} in ${f}`);
  }
}
writeJson(path.join(DATA, 'recipes', 'crafting.json'), crafting);
for (const [k, v] of Object.entries(cooking)) writeJson(path.join(DATA, 'recipes', `${k}.json`), v);
writeJson(path.join(DATA, 'recipes', 'stonecutting.json'), stonecutting);
writeJson(path.join(DATA, 'recipes', 'smithing.json'), smithing);
writeJson(path.join(DATA, 'recipes', 'special.json'), special);

// ------------------------------------------------------------------------------------------------
// Loot tables (kept in the vanilla structure minus namespaces; evaluated by src/items/loot.ts)
// ------------------------------------------------------------------------------------------------
function normalizeLoot(v: unknown): unknown {
  if (typeof v === 'string') return stripNs(v);
  if (Array.isArray(v)) return v.map(normalizeLoot);
  if (v && typeof v === 'object') {
    const o: Record<string, unknown> = {};
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      if (k === 'random_sequence') continue;
      o[k] = normalizeLoot(x);
    }
    return o;
  }
  return v;
}
const lootRoot = path.join(pack, 'loot_table');
for (const cat of fs.readdirSync(lootRoot, { withFileTypes: true })) {
  if (!cat.isDirectory()) continue;
  const tables: Record<string, unknown> = {};
  const walk = (d: string) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name);
      if (ent.isDirectory()) walk(p);
      else if (ent.name.endsWith('.json') && !ent.name.startsWith('_')) {
        tables[path.relative(path.join(lootRoot, cat.name), p).slice(0, -5).replace(/\\/g, '/')] = normalizeLoot(readJson(p));
      }
    }
  };
  walk(path.join(lootRoot, cat.name));
  writeJson(path.join(DATA, 'loot', `${cat.name}.json`), tables);
}

// ------------------------------------------------------------------------------------------------
// Tags, mobs, biomes, enchantments, effects
// ------------------------------------------------------------------------------------------------
writeJson(path.join(DATA, 'tags.json'), { item: itemTags, block: blockTags });

const mobs = entitiesMd.map((e) => {
  const stats = MOBS[e.name];
  return {
    id: e.name,
    name: e.displayName,
    num: e.id,
    width: e.width,
    height: e.height,
    type: e.type,
    category: e.category,
    ...(stats ? { health: stats.health, damage: stats.damage ?? 0, speed: stats.speed, xp: stats.xp ?? 0, disposition: stats.hostile ? 'hostile' : stats.neutral ? 'neutral' : 'passive' } : {}),
  };
});
writeJson(path.join(DATA, 'mobs.json'), mobs);

// Vanilla biome definitions from the data pack give temperature, downfall and colour overrides;
// grass and foliage colours come from the colormap textures exactly like the game samples them.
const biomeDir = path.join(pack, 'worldgen', 'biome');
const colormap = (name: string) => PNG.sync.read(fs.readFileSync(path.join(ASSETS, 'textures', 'colormap', `${name}.png`)));
const grassMap = colormap('grass');
const foliageMap = colormap('foliage');
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
function sampleColormap(png: PNG, temperature: number, downfall: number): number {
  const t = clamp01(temperature);
  const h = clamp01(downfall) * t;
  const i = Math.round((1 - t) * 255);
  const j = Math.round((1 - h) * 255);
  const idx = (j * png.width + i) * 4;
  return (png.data[idx] << 16) | (png.data[idx + 1] << 8) | png.data[idx + 2];
}
type WgColor = number | string | number[] | undefined;
interface WgBiome {
  temperature: number; downfall: number; has_precipitation: boolean;
  effects: { sky_color?: WgColor; fog_color?: WgColor; water_color?: WgColor; water_fog_color?: WgColor; grass_color?: WgColor; foliage_color?: WgColor; grass_color_modifier?: string };
}
/** Colours appear as ints, "#RRGGBB" strings or [r,g,b] float arrays depending on the version. */
function wgColor(v: WgColor): number | undefined {
  if (v === undefined || v === null) return undefined;
  if (typeof v === 'number') return v >>> 0 & 0xffffff;
  if (typeof v === 'string') return parseInt(v.replace('#', ''), 16) & 0xffffff;
  if (Array.isArray(v)) return ((Math.round(v[0] * 255) << 16) | (Math.round(v[1] * 255) << 8) | Math.round(v[2] * 255)) & 0xffffff;
  return undefined;
}
const tintFor = (kind: string, biome: string): number | undefined => {
  for (const entry of tintsMd[kind]?.data ?? []) if (entry.keys.includes(biome)) return entry.color >>> 0 & 0xffffff;
  return undefined;
};
const biomes = biomesMd.map((b) => {
  const wgFile = path.join(biomeDir, `${b.name}.json`);
  const wg = fs.existsSync(wgFile) ? readJson<WgBiome>(wgFile) : null;
  const temperature = wg?.temperature ?? b.temperature;
  const downfall = wg?.downfall ?? 0.5;
  const eff = wg?.effects ?? {};
  let grass = wgColor(eff.grass_color) ?? sampleColormap(grassMap, temperature, downfall);
  if (eff.grass_color_modifier === 'dark_forest') grass = ((grass & 0xfefefe) + 0x28340a) >> 1;
  else if (eff.grass_color_modifier === 'swamp') grass = 0x6a7039;
  const foliage = wgColor(eff.foliage_color) ?? sampleColormap(foliageMap, temperature, downfall);
  return {
    id: b.name,
    name: b.displayName,
    num: b.id,
    category: b.category,
    dimension: b.dimension,
    temperature,
    downfall,
    precipitation: !(wg?.has_precipitation ?? b.has_precipitation) ? 'none' : temperature < 0.15 ? 'snow' : 'rain',
    color: b.color,
    grassColor: grass,
    foliageColor: foliage,
    waterColor: wgColor(eff.water_color) ?? tintFor('water', b.name) ?? 0x3f76e4,
    waterFogColor: wgColor(eff.water_fog_color) ?? 0x050533,
    skyColor: wgColor(eff.sky_color) ?? 0x78a7ff,
    fogColor: wgColor(eff.fog_color) ?? 0xc0d8ff,
    surface: BIOME_SURFACE[b.name] ?? { top: 'grass_block', filler: 'dirt' },
  };
});
writeJson(path.join(DATA, 'biomes.json'), biomes);

interface RawEnchant {
  description: unknown; supported_items: unknown; primary_items?: unknown; weight: number; max_level: number;
  min_cost: { base: number; per_level_above_first: number }; max_cost: { base: number; per_level_above_first: number };
  anvil_cost: number; slots: string[]; exclusive_set?: unknown; effects?: Record<string, unknown>;
}
const enchDir = path.join(pack, 'enchantment');
const exclusiveSets: Record<string, string[]> = {};
for (const [tag, list] of Object.entries(enchantmentTags)) if (tag.startsWith('exclusive_set/')) exclusiveSets[tag.slice('exclusive_set/'.length)] = list;
const treasure = tagSet(enchantmentTags, 'treasure');
const curse = tagSet(enchantmentTags, 'curse');
const tradeable = tagSet(enchantmentTags, 'tradeable');
const inTable = tagSet(enchantmentTags, 'in_enchanting_table');
const enchantments = listFiles(enchDir, '.json').filter((f) => !f.startsWith('_')).map((f) => {
  const id = f.slice(0, -5);
  const e = readJson<RawEnchant>(path.join(enchDir, f));
  const tagName = (v: unknown) => (typeof v === 'string' && v.startsWith('#') ? stripNs(v.slice(1)) : undefined);
  const supportedTag = tagName(e.supported_items);
  const primaryTag = tagName(e.primary_items);
  let exclusive: string[] = [];
  if (typeof e.exclusive_set === 'string') {
    const t = tagName(e.exclusive_set);
    exclusive = t ? (enchantmentTags[t] ?? []) : [stripNs(e.exclusive_set)];
  } else if (Array.isArray(e.exclusive_set)) exclusive = (e.exclusive_set as string[]).map(stripNs);
  const desc = e.description as { translate?: string };
  return {
    id,
    name: id.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' '),
    translationKey: desc?.translate,
    maxLevel: e.max_level,
    weight: e.weight,
    anvilCost: e.anvil_cost,
    minCost: e.min_cost,
    maxCost: e.max_cost,
    slots: e.slots,
    supportedItems: supportedTag ? (itemTags[supportedTag] ?? []) : ingredient(e.supported_items),
    primaryItems: primaryTag ? (itemTags[primaryTag] ?? []) : e.primary_items ? ingredient(e.primary_items) : undefined,
    exclusive: exclusive.filter((x) => x !== id),
    treasure: treasure.has(id),
    curse: curse.has(id),
    tradeable: tradeable.has(id),
    inEnchantingTable: inTable.has(id),
    effects: Object.keys(e.effects ?? {}),
  };
});
writeJson(path.join(DATA, 'enchantments.json'), enchantments);

const effects = effectsMd.map((e) => ({
  id: e.name.replace(/([a-z])([A-Z])/g, '$1_$2').toLowerCase(),
  name: e.displayName,
  num: e.id,
  type: e.type,
}));
writeJson(path.join(DATA, 'effects.json'), effects);

// ------------------------------------------------------------------------------------------------
// Armor trims: patterns and materials from the data pack. Vanilla maps ingredient items to materials
// with the `provides_trim_material` item component; that table is hand-encoded here.
// ------------------------------------------------------------------------------------------------
const TRIM_MATERIAL_ITEMS: Record<string, string> = {
  amethyst: 'amethyst_shard', copper: 'copper_ingot', diamond: 'diamond', emerald: 'emerald', gold: 'gold_ingot',
  iron: 'iron_ingot', lapis: 'lapis_lazuli', netherite: 'netherite_ingot', quartz: 'quartz', redstone: 'redstone', resin: 'resin_brick',
};
const langFile = [path.join(ASSETS, 'lang', 'en_us.json'), path.join(jar, 'assets', 'minecraft', 'lang', 'en_us.json')].find((f) => fs.existsSync(f));
const lang: Record<string, string> = langFile ? readJson<Record<string, string>>(langFile) : {};
const titleCase = (s: string) => s.split('_').map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
const dataFiles = (dir: string) => (fs.existsSync(dir) ? listFiles(dir, '.json').filter((f) => !f.startsWith('_')) : []);
const trimPatterns = dataFiles(path.join(pack, 'trim_pattern')).map((f) => {
  const id = f.slice(0, -5);
  const raw = readJson<{ decal?: boolean }>(path.join(pack, 'trim_pattern', f));
  return { id, name: lang[`trim_pattern.minecraft.${id}`] ?? `${titleCase(id)} Armor Trim`, template: `${id}_armor_trim_smithing_template`, decal: !!raw.decal };
});
const trimMaterials = dataFiles(path.join(pack, 'trim_material')).map((f) => {
  const id = f.slice(0, -5);
  const raw = readJson<{ description?: { color?: string } }>(path.join(pack, 'trim_material', f));
  return { id, name: lang[`trim_material.minecraft.${id}`] ?? `${titleCase(id)} Material`, item: TRIM_MATERIAL_ITEMS[id] ?? id, color: raw.description?.color ?? '#ffffff' };
});
for (const p of trimPatterns) if (!itemNames.has(p.template)) console.warn(`trim pattern ${p.id}: no template item ${p.template}`);
for (const m of trimMaterials) if (!itemNames.has(m.item)) console.warn(`trim material ${m.id}: no ingredient item ${m.item}`);
writeJson(path.join(DATA, 'trims.json'), { patterns: trimPatterns, materials: trimMaterials });

// ------------------------------------------------------------------------------------------------
// Summary
// ------------------------------------------------------------------------------------------------
const summary = {
  version: MC_VERSION,
  blocks: blocks.length,
  items: items.length,
  recipes: {
    crafting: crafting.length,
    smelting: cooking.smelting.length,
    blasting: cooking.blasting.length,
    smoking: cooking.smoking.length,
    campfire: cooking.campfire.length,
    stonecutting: stonecutting.length,
    smithing: smithing.length,
    special: special.length,
  },
  mobs: mobs.length,
  biomes: biomes.length,
  enchantments: enchantments.length,
  effects: effects.length,
  trims: { patterns: trimPatterns.length, materials: trimMaterials.length },
};
writeJson(path.join(DATA, 'summary.json'), summary, true);
console.log(JSON.stringify(summary, null, 1));
ensureDir(path.join(DATA, 'structures'));
