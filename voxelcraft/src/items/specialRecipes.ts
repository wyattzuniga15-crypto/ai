/**
 * Vanilla's special crafting recipes: the ones whose result is worked out in code rather than
 * written down, because it depends on what went into the grid — the dye on a piece of leather, the
 * patterns copied off a banner, the colours packed into a firework star.
 *
 * Each one follows vanilla's own matcher: which items it will take, how many of each, and what it
 * makes of them. Two of them leave an ingredient where it is rather than eating it, which is what
 * vanilla's remaining items do.
 */
import { items } from './registry.ts';
import { cloneStack, type ItemStack, type Slot } from './inventory.ts';
import { DYE_COLORS } from '../ui/specialIcons.ts';

export interface SpecialResult {
  /** Vanilla's own recipe id, so a test or the recipe book can name it. */
  id: string;
  result: ItemStack;
  /** Grid slots the craft leaves alone, as vanilla's remaining items do. */
  keep?: number[];
  /** A map the world has to make when the result is taken; only the world knows its maps. */
  mapScale?: boolean;
}

/** The colour each dye burns, which vanilla keeps apart from the colour it paints with. */
export const FIREWORK_COLORS: Record<string, number> = {
  white: 0xf0f0f0, orange: 0xeb8844, magenta: 0xc354cd, light_blue: 0x6689d3, yellow: 0xdecf2a, lime: 0x41cd34,
  pink: 0xd88198, gray: 0x434343, light_gray: 0xababab, cyan: 0x287697, purple: 0x7b2fbe, blue: 0x253192,
  brown: 0x51301a, green: 0x3b511a, red: 0xb3312c, black: 0x1e1b1b,
};

/** Vanilla's undyed leather, which a first dye is blended into rather than replacing. */
export const LEATHER_COLOR = 0xa06540;

const DYE_IDS = new Set(Object.keys(DYE_COLORS).map((c) => `${c}_dye`));
const dyeColorOf = (id: string): string | null => (DYE_IDS.has(id) ? id.slice(0, -4) : null);

/** Items vanilla lets a dye be worked into: leather armour and the two leather harnesses. */
const DYEABLE = new Set(['leather_helmet', 'leather_chestplate', 'leather_leggings', 'leather_boots', 'leather_horse_armor', 'wolf_armor']);

/** What each extra ingredient shapes a firework star into, as vanilla's own table does. */
const STAR_SHAPES: Record<string, string> = {
  fire_charge: 'large_ball',
  feather: 'burst',
  gold_nugget: 'star',
  creeper_head: 'creeper',
  skeleton_skull: 'creeper',
  wither_skeleton_skull: 'creeper',
  zombie_head: 'creeper',
  player_head: 'creeper',
  dragon_head: 'creeper',
  piglin_head: 'creeper',
};

/** Sherds and bricks: what vanilla lets a decorated pot be made of. */
const isPotIngredient = (id: string): boolean => id === 'brick' || id.endsWith('_pottery_sherd');

const present = (grid: Slot[]): { stack: ItemStack; i: number }[] =>
  grid.map((stack, i) => ({ stack, i })).filter((e): e is { stack: ItemStack; i: number } => !!e.stack && e.stack.count > 0);

/**
 * Vanilla `DyedItemColor.applyDyes`: the dyes and whatever colour the item already wears are
 * averaged channel by channel, then brightened back up to the average of their strongest channels,
 * which is what keeps a mix of dyes from turning muddy.
 */
export function blendDyes(existing: number | null, dyes: number[]): number {
  const sum = [0, 0, 0];
  let strongest = 0;
  let n = 0;
  const add = (c: number) => {
    const r = (c >> 16) & 255, g = (c >> 8) & 255, b = c & 255;
    strongest += Math.max(r, g, b);
    sum[0] += r;
    sum[1] += g;
    sum[2] += b;
    n++;
  };
  if (existing !== null) add(existing);
  for (const d of dyes) add(d);
  if (!n) return LEATHER_COLOR;
  let r = Math.floor(sum[0] / n), g = Math.floor(sum[1] / n), b = Math.floor(sum[2] / n);
  const f = strongest / n;
  const peak = Math.max(r, g, b);
  if (peak > 0) {
    r = Math.floor((r * f) / peak);
    g = Math.floor((g * f) / peak);
    b = Math.floor((b * f) / peak);
  }
  return (r << 16) | (g << 8) | b;
}

/** One dyeable item and any number of dyes: vanilla's `ArmorDyeRecipe`. */
function armorDye(grid: Slot[]): SpecialResult | null {
  let target: ItemStack | null = null;
  const dyes: number[] = [];
  for (const { stack } of present(grid)) {
    const color = dyeColorOf(stack.id);
    if (color) {
      // dyeing takes the colour the dye paints with, which is not the colour it burns
      dyes.push(DYE_COLORS[color]);
      continue;
    }
    if (!DYEABLE.has(stack.id) || target) return null;
    target = stack;
  }
  if (!target || !dyes.length) return null;
  const out = cloneStack(target, 1);
  out.color = blendDyes(target.color ?? null, dyes);
  return { id: 'armor_dye', result: out };
}

/** A patterned banner and a blank one of the same colour: vanilla's `BannerDuplicateRecipe`. */
function bannerDuplicate(grid: Slot[]): SpecialResult | null {
  let patterned: { stack: ItemStack; i: number } | null = null;
  let blank: ItemStack | null = null;
  const list = present(grid);
  if (list.length !== 2) return null;
  for (const entry of list) {
    if (!entry.stack.id.endsWith('_banner') || entry.stack.id.endsWith('_wall_banner')) return null;
    if (entry.stack.banner?.length) {
      if (patterned) return null;
      patterned = entry;
    } else {
      if (blank) return null;
      blank = entry.stack;
    }
  }
  if (!patterned || !blank || patterned.stack.id !== blank.id) return null;
  // vanilla leaves the banner being copied in the grid, so one banner makes as many as you like
  return { id: 'banner_duplicate', result: cloneStack(patterned.stack, 1), keep: [patterned.i] };
}

/** A written book and up to eight blank ones: vanilla's `BookCloningRecipe`. */
function bookCloning(grid: Slot[]): SpecialResult | null {
  let written: { stack: ItemStack; i: number } | null = null;
  let blanks = 0;
  for (const entry of present(grid)) {
    if (entry.stack.id === 'written_book') {
      if (written || entry.stack.count !== 1) return null;
      written = entry;
    } else if (entry.stack.id === 'writable_book') {
      if (entry.stack.count !== 1) return null;
      blanks++;
    } else return null;
  }
  if (!written || !blanks) return null;
  // vanilla stops at a copy of a copy: generation 2 cannot be copied again
  const generation = written.stack.generation ?? 0;
  if (generation >= 2) return null;
  const out = cloneStack(written.stack, blanks);
  out.generation = generation + 1;
  return { id: 'book_cloning', result: out, keep: [written.i] };
}

/** A filled map and any number of empty ones: vanilla's `MapCloningRecipe`. */
function mapCloning(grid: Slot[]): SpecialResult | null {
  let filled: ItemStack | null = null;
  let blanks = 0;
  for (const { stack } of present(grid)) {
    if (stack.id === 'filled_map') {
      if (filled || stack.map === undefined || stack.count !== 1) return null;
      filled = stack;
    } else if (stack.id === 'map') blanks += stack.count;
    else return null;
  }
  if (!filled || !blanks) return null;
  // the original goes in and comes back out with its copies
  return { id: 'map_cloning', result: cloneStack(filled, blanks + 1) };
}

/** A filled map ringed by eight paper: vanilla's `MapExtendingRecipe`, which zooms it out a step. */
function mapExtending(grid: Slot[], width: number, height: number, scaleOf: (id: number) => number): SpecialResult | null {
  if (width !== 3 || height !== 3) return null;
  const middle = grid[4];
  if (middle?.id !== 'filled_map' || middle.map === undefined || middle.count !== 1) return null;
  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    if (grid[i]?.id !== 'paper') return null;
  }
  // vanilla stops at scale four, the widest a map goes
  if (scaleOf(middle.map) >= 4) return null;
  return { id: 'map_extending', result: cloneStack(middle, 1), mapScale: true };
}

/** A shield and a banner: vanilla's `ShieldDecorationRecipe`. */
function shieldDecoration(grid: Slot[]): SpecialResult | null {
  const list = present(grid);
  if (list.length !== 2) return null;
  const shield = list.find((e) => e.stack.id === 'shield')?.stack;
  const banner = list.find((e) => e.stack.id.endsWith('_banner'))?.stack;
  if (!shield || !banner || shield.count !== 1 || banner.count !== 1) return null;
  const out = cloneStack(shield, 1);
  out.bannerColor = banner.id.slice(0, -'_banner'.length);
  out.banner = (banner.banner ?? []).map((l) => ({ ...l }));
  return { id: 'shield_decoration', result: out };
}

/** Four sherds or bricks in a diamond: vanilla's `DecoratedPotRecipe`. */
function decoratedPot(grid: Slot[], width: number, height: number): SpecialResult | null {
  if (width !== 3 || height !== 3) return null;
  const faces = [1, 3, 5, 7];
  for (let i = 0; i < 9; i++) {
    const wanted = faces.includes(i);
    const stack = grid[i];
    if (wanted !== !!stack) return null;
    if (stack && !isPotIngredient(stack.id)) return null;
  }
  // vanilla stores them back, left, right, front, which is the order they sit in the grid
  return { id: 'decorated_pot', result: { id: 'decorated_pot', count: 1, sherds: faces.map((i) => grid[i]!.id) } };
}

/** Paper, one to three gunpowder and any number of stars: vanilla's `FireworkRocketRecipe`. */
function fireworkRocket(grid: Slot[]): SpecialResult | null {
  let paper = 0;
  let powder = 0;
  const explosions: NonNullable<ItemStack['explosion']>[] = [];
  for (const { stack } of present(grid)) {
    if (stack.id === 'paper') paper += stack.count;
    else if (stack.id === 'gunpowder') powder += stack.count;
    else if (stack.id === 'firework_star') {
      if (stack.explosion) explosions.push({ ...stack.explosion });
      else explosions.push({ shape: 'small_ball', colors: [FIREWORK_COLORS.white] });
    } else return null;
  }
  if (paper !== 1 || powder < 1 || powder > 3) return null;
  const out: ItemStack = { id: 'firework_rocket', count: 3, firework: { flight: powder, explosions } };
  return { id: 'firework_rocket', result: out };
}

/** Gunpowder, dyes and the trimmings: vanilla's `FireworkStarRecipe`. */
function fireworkStar(grid: Slot[]): SpecialResult | null {
  let powder = 0;
  let shape: string | null = null;
  let trail = false;
  let twinkle = false;
  const colors: number[] = [];
  for (const { stack } of present(grid)) {
    const dye = dyeColorOf(stack.id);
    if (dye) {
      colors.push(FIREWORK_COLORS[dye]);
      continue;
    }
    if (stack.id === 'gunpowder') {
      powder += stack.count;
      continue;
    }
    if (stack.id === 'diamond') {
      if (trail) return null;
      trail = true;
      continue;
    }
    if (stack.id === 'glowstone_dust') {
      if (twinkle) return null;
      twinkle = true;
      continue;
    }
    const s = STAR_SHAPES[stack.id];
    if (!s || shape) return null;
    shape = s;
  }
  if (powder !== 1 || !colors.length) return null;
  const explosion: NonNullable<ItemStack['explosion']> = { shape: shape ?? 'small_ball', colors };
  if (trail) explosion.trail = true;
  if (twinkle) explosion.twinkle = true;
  return { id: 'firework_star', result: { id: 'firework_star', count: 1, explosion } };
}

/** A star and more dyes, which vanilla fades the burst through: `FireworkStarFadeRecipe`. */
function fireworkStarFade(grid: Slot[]): SpecialResult | null {
  let star: ItemStack | null = null;
  const fade: number[] = [];
  for (const { stack } of present(grid)) {
    const dye = dyeColorOf(stack.id);
    if (dye) {
      fade.push(FIREWORK_COLORS[dye]);
      continue;
    }
    if (stack.id !== 'firework_star' || star) return null;
    star = stack;
  }
  if (!star || !fade.length) return null;
  const out = cloneStack(star, 1);
  out.explosion = { ...(star.explosion ?? { shape: 'small_ball', colors: [FIREWORK_COLORS.white] }), fade };
  return { id: 'firework_star_fade', result: out };
}

/**
 * Vanilla "tipped arrow": a lingering potion in the middle of eight arrows tips them all, each
 * carrying the potion the bottle held.
 */
export function tippedArrows(grid: Slot[], width: number, height: number): ItemStack | null {
  if (width !== 3 || height !== 3) return null;
  const middle = grid[4];
  if (middle?.id !== 'lingering_potion') return null;
  for (let i = 0; i < 9; i++) {
    if (i === 4) continue;
    if (grid[i]?.id !== 'arrow') return null;
  }
  const out: ItemStack = { id: 'tipped_arrow', count: 8 };
  if (middle.potion) out.potion = middle.potion;
  return out;
}

/** Vanilla "repair item": two damaged copies of a tool combine their durability. */
export function repairItems(grid: Slot[]): ItemStack | null {
  const list = present(grid);
  if (list.length !== 2 || list[0].stack.id !== list[1].stack.id) return null;
  const def = items.byId.get(list[0].stack.id);
  if (!def?.durability || list[0].stack.count !== 1 || list[1].stack.count !== 1) return null;
  if (!list[0].stack.damage && !list[1].stack.damage) return null;
  const a = def.durability - (list[0].stack.damage ?? 0);
  const b = def.durability - (list[1].stack.damage ?? 0);
  const total = Math.min(def.durability, a + b + Math.floor(def.durability * 0.05));
  return { id: def.id, count: 1, damage: def.durability - total };
}

/**
 * Every special recipe, tried in turn. `scaleOf` says how far a map has already been zoomed out,
 * which only the world knows; a grid with no map in it never asks.
 */
export function matchSpecial(grid: Slot[], width: number, height: number, scaleOf: (id: number) => number = () => 0): SpecialResult | null {
  return armorDye(grid)
    ?? bannerDuplicate(grid)
    ?? bookCloning(grid)
    ?? mapCloning(grid)
    ?? mapExtending(grid, width, height, scaleOf)
    ?? shieldDecoration(grid)
    ?? decoratedPot(grid, width, height)
    ?? fireworkStar(grid)
    ?? fireworkStarFade(grid)
    ?? fireworkRocket(grid);
}
