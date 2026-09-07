/**
 * Composters. Vanilla keeps a list of what can go in one and how likely each thing is to raise the
 * level (`ComposterBlock.COMPOSTABLES`); seven fills make it ready, and the eighth right-click takes
 * the bone meal back out.
 */
import { blocks } from './registry.ts';

/** The one-in-a-hundred chances vanilla gives each compostable, by item id. */
const CHANCE: Record<string, number> = {};
const add = (chance: number, ids: string[]): void => { for (const id of ids) CHANCE[id] = chance; };

add(0.3, ['beetroot_seeds', 'dried_kelp', 'short_grass', 'hanging_roots', 'kelp', 'mangrove_roots', 'melon_seeds',
  'moss_carpet', 'pale_hanging_moss', 'pitcher_pod', 'pumpkin_seeds', 'seagrass', 'small_dripleaf', 'sweet_berries',
  'torchflower_seeds', 'wheat_seeds', 'glow_berries', 'pink_petals', 'leaf_litter', 'wildflowers', 'firefly_bush',
  'cactus_flower', 'bush', 'short_dry_grass', 'tall_dry_grass']);
add(0.5, ['cactus', 'dried_kelp_block', 'glow_lichen', 'melon_slice', 'nether_sprouts', 'sugar_cane', 'tall_grass',
  'twisting_vines', 'vine', 'weeping_vines', 'pale_moss_carpet']);
add(0.65, ['apple', 'azalea', 'beetroot', 'big_dripleaf', 'carrot', 'cocoa_beans', 'fern', 'large_fern', 'lily_pad',
  'melon', 'moss_block', 'pale_moss_block', 'brown_mushroom', 'red_mushroom', 'crimson_fungus', 'warped_fungus',
  'crimson_roots', 'warped_roots', 'nether_wart', 'potato', 'pumpkin', 'sea_pickle', 'wheat', 'chorus_flower',
  'chorus_fruit', 'spore_blossom', 'torchflower', 'wither_rose', 'open_eyeblossom', 'closed_eyeblossom']);
add(0.85, ['baked_potato', 'bread', 'cookie', 'flowering_azalea', 'hay_block', 'nether_wart_block', 'warped_wart_block',
  'pitcher_plant', 'shroomlight', 'brown_mushroom_block', 'red_mushroom_block', 'sunflower', 'lilac', 'rose_bush', 'peony']);
add(1, ['cake', 'pumpkin_pie']);

/** Small flowers, leaves and saplings all compost, so they are matched by name rather than listed. */
export function compostChance(id: string): number {
  const known = CHANCE[id];
  if (known !== undefined) return known;
  if (id.endsWith('_leaves')) return 0.3;
  if (id.endsWith('_sapling')) return 0.3;
  if (id.endsWith('_tulip') || id === 'dandelion' || id === 'poppy' || id === 'blue_orchid' || id === 'allium'
    || id === 'azure_bluet' || id === 'oxeye_daisy' || id === 'cornflower' || id === 'lily_of_the_valley') return 0.65;
  return 0;
}

export const isCompostable = (id: string): boolean => compostChance(id) > 0;

export const composterLevel = (state: number): number => Number(blocks.prop(state, 'level') ?? '0');

export const composterState = (level: number): number => blocks.stateWith('composter', { level: String(level) });

/**
 * One item into the composter. The item is always used up; the level only rises on the roll, and
 * the seventh fill starts the wait that turns it out ready.
 */
export function compost(state: number, itemId: string, roll: number): { state: number; filled: boolean } | null {
  const chance = compostChance(itemId);
  if (chance <= 0) return null;
  const level = composterLevel(state);
  if (level >= 7) return null;
  if (roll >= chance) return { state, filled: false };
  return { state: composterState(level + 1), filled: true };
}
