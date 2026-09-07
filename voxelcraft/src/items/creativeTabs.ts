/**
 * The creative inventory's tabs. Vanilla keeps the membership of each one in code rather than in
 * any data file, so this sorts the item list into vanilla's own tabs by what each item is: its
 * behaviour, the block it places and the family its name puts it in. Inside a tab items keep their
 * registry order, which is the order vanilla lists them in.
 */
import { blocks } from '../blocks/registry.ts';
import { items, type ItemDef } from './registry.ts';

export interface CreativeTab {
  id: string;
  title: string;
  /** Item drawn on the tab itself, as vanilla marks each one with something from inside it. */
  icon: string;
}

export const CREATIVE_TABS: CreativeTab[] = [
  { id: 'building_blocks', title: 'Building Blocks', icon: 'bricks' },
  { id: 'colored_blocks', title: 'Colored Blocks', icon: 'cyan_wool' },
  { id: 'natural_blocks', title: 'Natural Blocks', icon: 'grass_block' },
  { id: 'functional_blocks', title: 'Functional Blocks', icon: 'oak_sign' },
  { id: 'redstone_blocks', title: 'Redstone Blocks', icon: 'redstone' },
  { id: 'tools_and_utilities', title: 'Tools & Utilities', icon: 'diamond_pickaxe' },
  { id: 'combat', title: 'Combat', icon: 'diamond_sword' },
  { id: 'food_and_drinks', title: 'Food & Drinks', icon: 'golden_apple' },
  { id: 'ingredients', title: 'Ingredients', icon: 'iron_ingot' },
  { id: 'spawn_eggs', title: 'Spawn Eggs', icon: 'pig_spawn_egg' },
  { id: 'operator_utilities', title: 'Operator Utilities', icon: 'command_block' },
];

/** The sixteen dye colours every coloured block family is named after. */
const COLORS = ['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray', 'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black'];
const COLORED_FAMILIES = ['wool', 'carpet', 'bed', 'banner', 'candle', 'concrete', 'concrete_powder', 'terracotta', 'glazed_terracotta', 'stained_glass', 'stained_glass_pane', 'shulker_box'];

/** Blocks that belong with redstone whatever their own behaviour says. */
const REDSTONE_IDS = new Set([
  'redstone_block', 'repeater', 'comparator', 'observer', 'target', 'tripwire_hook', 'daylight_detector', 'note_block',
  'dispenser', 'dropper', 'hopper', 'piston', 'sticky_piston', 'slime_block', 'honey_block', 'tnt', 'lightning_rod',
  'redstone_lamp', 'redstone_torch', 'lectern', 'crafter', 'copper_bulb', 'exposed_copper_bulb', 'weathered_copper_bulb', 'oxidized_copper_bulb',
  'waxed_copper_bulb', 'waxed_exposed_copper_bulb', 'waxed_weathered_copper_bulb', 'waxed_oxidized_copper_bulb',
]);
const REDSTONE_BEHAVIORS = new Set(['redstone', 'door', 'trapdoor', 'button', 'pressure_plate', 'fence_gate']);

/** Blocks the world grows or lays down itself. */
const NATURAL_IDS = new Set([
  'stone', 'granite', 'diorite', 'andesite', 'deepslate', 'cobbled_deepslate', 'tuff', 'calcite', 'dripstone_block', 'pointed_dripstone',
  'grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'mud', 'mycelium', 'sand', 'red_sand', 'gravel', 'clay', 'moss_block',
  'obsidian', 'crying_obsidian', 'netherrack', 'basalt', 'smooth_basalt', 'blackstone', 'soul_sand', 'soul_soil', 'magma_block',
  'glowstone', 'end_stone', 'bedrock', 'cobblestone', 'cobweb', 'snow', 'snow_block', 'powder_snow', 'ice', 'packed_ice', 'blue_ice',
  'bone_block', 'ancient_debris', 'amethyst_block', 'budding_amethyst', 'amethyst_cluster', 'sculk', 'sculk_vein', 'sculk_catalyst',
  'sculk_shrieker', 'sculk_sensor', 'calibrated_sculk_sensor', 'sponge', 'wet_sponge', 'gravel', 'suspicious_sand', 'suspicious_gravel',
  'turtle_egg', 'sniffer_egg', 'frogspawn', 'dragon_egg', 'infested_stone', 'reinforced_deepslate', 'moss_carpet', 'pale_moss_block',
]);
const NATURAL_BEHAVIORS = new Set(['ore', 'log', 'leaves', 'sapling', 'plant', 'crop', 'growing', 'spreading', 'coral', 'ice', 'farmland', 'snow_layer', 'powder_snow', 'fluid', 'fire']);

/** Blocks that do something when they are used or that decorate a room. */
const FUNCTIONAL_IDS = new Set([
  'torch', 'soul_torch', 'lantern', 'soul_lantern', 'chain', 'end_rod', 'ladder', 'scaffolding', 'bookshelf', 'chiseled_bookshelf',
  'crafting_table', 'furnace', 'blast_furnace', 'smoker', 'chest', 'trapped_chest', 'ender_chest', 'barrel', 'jukebox', 'beacon',
  'conduit', 'anvil', 'chipped_anvil', 'damaged_anvil', 'grindstone', 'loom', 'smithing_table', 'stonecutter', 'cartography_table',
  'fletching_table', 'brewing_stand', 'cauldron', 'water_cauldron', 'lava_cauldron', 'powder_snow_cauldron', 'composter', 'campfire',
  'soul_campfire', 'bell', 'lodestone', 'respawn_anchor', 'enchanting_table', 'end_portal_frame', 'flower_pot', 'armor_stand',
  'item_frame', 'glow_item_frame', 'painting', 'decorated_pot', 'beehive', 'bee_nest', 'hay_block', 'dried_kelp_block', 'sea_lantern',
  'shroomlight', 'ochre_froglight', 'verdant_froglight', 'pearlescent_froglight', 'candle', 'skeleton_skull', 'wither_skeleton_skull',
  'zombie_head', 'player_head', 'creeper_head', 'dragon_head', 'piglin_head', 'end_crystal', 'lily_pad', 'sniffer_egg',
]);
const FUNCTIONAL_BEHAVIORS = new Set(['container', 'workstation', 'sign', 'bed', 'banner', 'head', 'candle', 'torch', 'climbable']);

/** Items only an operator has any use for. */
const OPERATOR_IDS = new Set(['barrier', 'command_block', 'chain_command_block', 'repeating_command_block', 'command_block_minecart', 'structure_block', 'structure_void', 'jigsaw', 'light', 'debug_stick', 'spawner', 'trial_spawner', 'vault']);

/** Tools and the odds and ends that go with them. */
const TOOL_BEHAVIORS = new Set(['pickaxe', 'axe', 'shovel', 'hoe', 'shears', 'bucket', 'fishing_rod', 'flint_and_steel', 'spawn_egg', 'elytra', 'firework', 'boat', 'minecart']);
const TOOL_IDS = new Set([
  'lead', 'name_tag', 'compass', 'recovery_compass', 'clock', 'map', 'filled_map', 'spyglass', 'brush', 'saddle', 'bundle',
  'goat_horn', 'bucket', 'water_bucket', 'lava_bucket', 'powder_snow_bucket', 'milk_bucket', 'axolotl_bucket', 'tadpole_bucket',
  'cod_bucket', 'salmon_bucket', 'pufferfish_bucket', 'tropical_fish_bucket', 'flint_and_steel', 'fire_charge', 'shears', 'elytra',
  'writable_book', 'written_book', 'glass_bottle', 'wind_charge',
]);

/** Weapons, armour and everything else a fight calls for. */
const COMBAT_BEHAVIORS = new Set(['sword', 'bow', 'crossbow', 'trident', 'mace', 'arrow', 'shield']);
const COMBAT_IDS = new Set(['arrow', 'spectral_arrow', 'tipped_arrow', 'shield', 'totem_of_undying', 'firework_star', 'snowball', 'egg', 'ender_pearl', 'ender_eye', 'splash_potion', 'lingering_potion', 'wolf_armor']);

const isColored = (id: string): boolean => {
  const color = COLORS.find((c) => id.startsWith(`${c}_`));
  if (!color) return false;
  const rest = id.slice(color.length + 1);
  return COLORED_FAMILIES.includes(rest) || rest === 'wall_banner' || rest === 'stained_glass_pane';
};

/** Blocks the game needs but nobody can hold: vanilla leaves these out of the menu altogether. */
const HIDDEN = new Set(['air', 'cave_air', 'void_air', 'water', 'lava', 'fire', 'soul_fire', 'moving_piston', 'piston_head', 'nether_portal', 'end_portal', 'end_gateway', 'bubble_column', 'chorus_plant', 'attached_melon_stem', 'attached_pumpkin_stem']);

/** Whether an item shows up in the creative menu at all. */
export const inCreativeMenu = (def: ItemDef): boolean => !HIDDEN.has(def.id);

/** The tab an item belongs in, by the same reading vanilla's own lists take of it. */
export function tabOf(def: ItemDef): string {
  const id = def.id;
  if (OPERATOR_IDS.has(id)) return 'operator_utilities';
  if (def.behavior === 'spawn_egg' || id.endsWith('_spawn_egg')) return 'spawn_eggs';
  if (def.food || id === 'potion' || id === 'honey_bottle' || id === 'milk_bucket') return 'food_and_drinks';
  if (def.armor && id !== 'elytra') return 'combat';
  if (COMBAT_BEHAVIORS.has(def.behavior ?? '') || COMBAT_IDS.has(id)) return 'combat';
  if (TOOL_IDS.has(id) || TOOL_BEHAVIORS.has(def.behavior ?? '')) return 'tools_and_utilities';
  if (id.endsWith('_horse_armor') || id.startsWith('music_disc_') || id.endsWith('_boat') || id.endsWith('_raft') || id.endsWith('_minecart')) return 'tools_and_utilities';
  if (!def.block) return 'ingredients';
  // block items: the four block tabs, read off the block itself
  if (isColored(id)) return 'colored_blocks';
  const block = blocks.has(def.block) ? blocks.get(def.block) : null;
  const behavior = block?.behavior ?? '';
  if (REDSTONE_IDS.has(id) || REDSTONE_BEHAVIORS.has(behavior) || id.endsWith('_rail') || id === 'rail') return 'redstone_blocks';
  if (FUNCTIONAL_IDS.has(id) || FUNCTIONAL_BEHAVIORS.has(behavior) || id.endsWith('_sign') || id.endsWith('_hanging_sign')) return 'functional_blocks';
  if (NATURAL_IDS.has(id) || NATURAL_BEHAVIORS.has(behavior)) return 'natural_blocks';
  return 'building_blocks';
}

/** Every item in a tab, in registry order — which is the order vanilla lists them in. */
export function tabItems(tab: string): ItemDef[] {
  return items.defs.filter((def) => inCreativeMenu(def) && tabOf(def) === tab).sort((a, b) => a.num - b.num);
}

/** Items whose name or id matches what has been typed, for the search tab. */
export function searchItems(query: string): ItemDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return [];
  return items.defs
    .filter((def) => inCreativeMenu(def) && (def.id.includes(q.replace(/ /g, '_')) || def.name.toLowerCase().includes(q)))
    .sort((a, b) => {
      // whatever starts with what was typed comes first, as vanilla's search does
      const an = a.name.toLowerCase().startsWith(q) ? 0 : 1;
      const bn = b.name.toLowerCase().startsWith(q) ? 0 : 1;
      return an - bn || a.num - b.num;
    });
}
