/**
 * Banner patterns. Vanilla keeps the loom's list in code: most patterns come from a dye alone, and
 * eight of them need the pattern item that carries them. A banner holds up to six layers on top of
 * its base colour, each a pattern in a dye colour.
 */
import type { ItemStack } from './inventory.ts';

export interface BannerLayer {
  /** The pattern's texture name under `entity/banner/`. */
  pattern: string;
  color: string;
}

/** How many patterns vanilla lets a loom put on one banner. */
export const MAX_LAYERS = 6;

/** The patterns a loom offers for a dye alone, in vanilla's own order. */
export const LOOM_PATTERNS = [
  'base', 'square_bottom_left', 'square_bottom_right', 'square_top_left', 'square_top_right',
  'stripe_bottom', 'stripe_top', 'stripe_left', 'stripe_right', 'stripe_center', 'stripe_middle',
  'stripe_downright', 'stripe_downleft', 'small_stripes', 'cross', 'straight_cross',
  'triangle_bottom', 'triangle_top', 'triangles_bottom', 'triangles_top',
  'diagonal_left', 'diagonal_right', 'diagonal_up_left', 'diagonal_up_right',
  'circle', 'rhombus', 'half_vertical', 'half_horizontal', 'half_vertical_right', 'half_horizontal_bottom',
  'border', 'curly_border', 'gradient', 'gradient_up', 'bricks',
];

/** The patterns that need their own item, and the item that carries each. */
export const PATTERN_ITEMS: Record<string, string> = {
  flower_banner_pattern: 'flower',
  creeper_banner_pattern: 'creeper',
  skull_banner_pattern: 'skull',
  mojang_banner_pattern: 'mojang',
  globe_banner_pattern: 'globe',
  piglin_banner_pattern: 'piglin',
  flow_banner_pattern: 'flow',
  guster_banner_pattern: 'guster',
  field_masoned_banner_pattern: 'bricks',
  bordure_indented_banner_pattern: 'curly_border',
};

const COLORS = new Set(['white', 'orange', 'magenta', 'light_blue', 'yellow', 'lime', 'pink', 'gray',
  'light_gray', 'cyan', 'purple', 'blue', 'brown', 'green', 'red', 'black']);

export const isBanner = (id: string): boolean => id.endsWith('_banner') && COLORS.has(id.slice(0, -7));

/** The dye colour an item gives, or null when it is not a dye. */
export function dyeColor(id: string): string | null {
  if (!id.endsWith('_dye')) return null;
  const c = id.slice(0, -4);
  return COLORS.has(c) ? c : null;
}

/** A banner's base colour, taken from its block id. */
export const bannerColor = (id: string): string => (isBanner(id) ? id.slice(0, -7) : 'white');

/** The layers a banner carries, base colour first as vanilla stores it. */
export const bannerLayers = (stack: ItemStack): BannerLayer[] => stack.banner ?? [];

/**
 * What the loom would weave: the banner with one more layer. Returns null when the three slots do
 * not make a pattern, which is what greys the result out.
 */
export function loomResult(banner: ItemStack | null, dye: ItemStack | null, pattern: ItemStack | null, selected: string | null): ItemStack | null {
  if (!banner || !isBanner(banner.id) || !dye) return null;
  const color = dyeColor(dye.id);
  if (!color) return null;
  const layers = bannerLayers(banner);
  if (layers.length >= MAX_LAYERS) return null;
  const wanted = pattern ? PATTERN_ITEMS[pattern.id] : selected;
  if (!wanted) return null;
  if (!pattern && !LOOM_PATTERNS.includes(wanted)) return null;
  return { ...banner, count: 1, banner: [...layers, { pattern: wanted, color }] };
}
