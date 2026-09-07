/**
 * The crafting recipes vanilla works out in code: dyeing leather, copying banners, books and maps,
 * decorating a shield and a pot, and packing a firework.
 */
import { describe, expect, it } from 'vitest';
import { blendDyes, matchSpecial, FIREWORK_COLORS, LEATHER_COLOR } from '../src/items/specialRecipes.ts';
import { craftingMatcher } from '../src/items/crafting.ts';
import { consumeIngredients } from '../src/items/crafting.ts';
import { DYE_COLORS } from '../src/ui/specialIcons.ts';
import type { Slot } from '../src/items/inventory.ts';
import { fireworkLifetime } from '../src/entities/firework.ts';

/** Lays a 3x3 grid out from a sketch, so the shaped recipes read the way they look. */
const grid3 = (...cells: (Slot | string | null)[]): Slot[] =>
  cells.map((c) => (typeof c === 'string' ? { id: c, count: 1 } : c));

const bag = (...ids: (string | Slot)[]): Slot[] => {
  const cells: Slot[] = new Array(9).fill(null);
  ids.forEach((v, i) => { cells[i] = typeof v === 'string' ? { id: v, count: 1 } : v; });
  return cells;
};

describe('dyeing', () => {
  it('blends dyes the way vanilla does', () => {
    // one dye on undyed leather is that dye
    expect(blendDyes(null, [DYE_COLORS.red])).toBe(DYE_COLORS.red);
    // vanilla averages the channels, then pushes the result back up to the average peak
    const mix = blendDyes(null, [DYE_COLORS.red, DYE_COLORS.blue]);
    expect(mix).not.toBe(DYE_COLORS.red);
    expect(mix).not.toBe(DYE_COLORS.blue);
    const r = (mix >> 16) & 255, g = (mix >> 8) & 255, b = mix & 255;
    // red and blue: the strongest channel comes back to the average of the two peaks
    expect(Math.max(r, g, b)).toBe(Math.floor((0xb0 + 0xaa) / 2));
    // and a dyed item keeps what it already wears in the mix
    expect(blendDyes(DYE_COLORS.red, [DYE_COLORS.red])).toBe(DYE_COLORS.red);
  });

  it('dyes leather and leaves everything else alone', () => {
    const m = matchSpecial(bag('leather_chestplate', 'red_dye'), 3, 3);
    expect(m?.id).toBe('armor_dye');
    expect(m?.result).toMatchObject({ id: 'leather_chestplate', count: 1, color: DYE_COLORS.red });
    // a second dye works into the colour that is already there
    const again = matchSpecial(bag({ id: 'leather_chestplate', count: 1, color: DYE_COLORS.red }, 'blue_dye'), 3, 3);
    expect(again?.result.color).toBe(blendDyes(DYE_COLORS.red, [DYE_COLORS.blue]));
    expect(matchSpecial(bag('iron_chestplate', 'red_dye'), 3, 3)).toBeNull();
    expect(matchSpecial(bag('leather_chestplate'), 3, 3)).toBeNull();
    // two dyeable items at once is not a recipe
    expect(matchSpecial(bag('leather_boots', 'leather_helmet', 'red_dye'), 3, 3)).toBeNull();
    expect(LEATHER_COLOR).toBe(0xa06540);
  });
});

describe('copying', () => {
  it('duplicates a banner and keeps the one being copied', () => {
    const patterned: Slot = { id: 'white_banner', count: 1, banner: [{ pattern: 'stripe_top', color: 'red' }] };
    const m = matchSpecial(bag(patterned, 'white_banner'), 3, 3);
    expect(m?.id).toBe('banner_duplicate');
    expect(m?.result.banner).toEqual([{ pattern: 'stripe_top', color: 'red' }]);
    expect(m?.keep).toEqual([0]);
    // the copy has to be the same colour, and only one of the two may carry patterns
    expect(matchSpecial(bag(patterned, 'red_banner'), 3, 3)).toBeNull();
    expect(matchSpecial(bag(patterned, patterned), 3, 3)).toBeNull();
    // and the kept slot survives the craft
    const left = consumeIngredients(bag(patterned, 'white_banner'), m!.keep);
    expect(left[0]).toMatchObject({ id: 'white_banner' });
    expect(left[1]).toBeNull();
  });

  it('clones a book once and once again, but not a copy of a copy', () => {
    const book: Slot = { id: 'written_book', count: 1, pages: ['hello'], author: 'someone' };
    const m = matchSpecial(bag(book, 'writable_book', 'writable_book'), 3, 3);
    expect(m?.id).toBe('book_cloning');
    expect(m?.result).toMatchObject({ id: 'written_book', count: 2, generation: 1, author: 'someone' });
    expect(m?.keep).toEqual([0]);
    const copy = matchSpecial(bag({ ...book, generation: 1 }, 'writable_book'), 3, 3);
    expect(copy?.result.generation).toBe(2);
    expect(matchSpecial(bag({ ...book, generation: 2 }, 'writable_book'), 3, 3)).toBeNull();
  });

  it('clones a map and hands the original back with the copies', () => {
    const filled: Slot = { id: 'filled_map', count: 1, map: 7 };
    const m = matchSpecial(bag(filled, 'map', 'map'), 3, 3);
    expect(m?.id).toBe('map_cloning');
    expect(m?.result).toMatchObject({ id: 'filled_map', count: 3, map: 7 });
    expect(matchSpecial(bag(filled), 3, 3)).toBeNull();
  });

  it('extends a map with eight paper, up to vanilla’s widest', () => {
    const filled: Slot = { id: 'filled_map', count: 1, map: 7 };
    const layout = grid3('paper', 'paper', 'paper', 'paper', filled, 'paper', 'paper', 'paper', 'paper');
    const m = matchSpecial(layout, 3, 3, () => 1);
    expect(m?.id).toBe('map_extending');
    expect(m?.mapScale).toBe(true);
    // a map already at the widest scale cannot be extended again
    expect(matchSpecial(layout, 3, 3, () => 4)).toBeNull();
    // and it has to be ringed all the way round
    const gap = [...layout];
    gap[0] = null;
    expect(matchSpecial(gap, 3, 3, () => 0)).toBeNull();
  });
});

describe('decorating', () => {
  it('puts a banner on a shield', () => {
    const banner: Slot = { id: 'blue_banner', count: 1, banner: [{ pattern: 'cross', color: 'white' }] };
    const m = matchSpecial(bag('shield', banner), 3, 3);
    expect(m?.id).toBe('shield_decoration');
    expect(m?.result).toMatchObject({ id: 'shield', bannerColor: 'blue' });
    expect(m?.result.banner).toEqual([{ pattern: 'cross', color: 'white' }]);
  });

  it('makes a decorated pot out of four sherds', () => {
    const m = matchSpecial(grid3(null, 'brick', null, 'angler_pottery_sherd', null, 'brick', null, 'arms_up_pottery_sherd', null), 3, 3);
    expect(m?.id).toBe('decorated_pot');
    // vanilla stores them back, left, right, front
    expect(m?.result.sherds).toEqual(['brick', 'angler_pottery_sherd', 'brick', 'arms_up_pottery_sherd']);
    // anything that is not a sherd or a brick is not a pot
    expect(matchSpecial(grid3(null, 'stone', null, 'brick', null, 'brick', null, 'brick', null), 3, 3)).toBeNull();
  });
});

describe('fireworks', () => {
  it('packs a star out of gunpowder, dye and the trimmings', () => {
    const plain = matchSpecial(bag('gunpowder', 'red_dye'), 3, 3);
    expect(plain?.id).toBe('firework_star');
    expect(plain?.result.explosion).toEqual({ shape: 'small_ball', colors: [FIREWORK_COLORS.red] });
    const fancy = matchSpecial(bag('gunpowder', 'red_dye', 'blue_dye', 'fire_charge', 'diamond', 'glowstone_dust'), 3, 3);
    expect(fancy?.result.explosion).toEqual({ shape: 'large_ball', colors: [FIREWORK_COLORS.red, FIREWORK_COLORS.blue], trail: true, twinkle: true });
    expect(matchSpecial(bag('gunpowder', 'red_dye', 'feather'), 3, 3)?.result.explosion?.shape).toBe('burst');
    expect(matchSpecial(bag('gunpowder', 'red_dye', 'gold_nugget'), 3, 3)?.result.explosion?.shape).toBe('star');
    expect(matchSpecial(bag('gunpowder', 'red_dye', 'creeper_head'), 3, 3)?.result.explosion?.shape).toBe('creeper');
    // one shape at a time, and never without a dye
    expect(matchSpecial(bag('gunpowder', 'red_dye', 'feather', 'gold_nugget'), 3, 3)).toBeNull();
    expect(matchSpecial(bag('gunpowder', 'diamond'), 3, 3)).toBeNull();
  });

  it('fades a star with more dye', () => {
    const star: Slot = { id: 'firework_star', count: 1, explosion: { shape: 'star', colors: [FIREWORK_COLORS.red] } };
    const m = matchSpecial(bag(star, 'yellow_dye', 'white_dye'), 3, 3);
    expect(m?.id).toBe('firework_star_fade');
    expect(m?.result.explosion).toEqual({ shape: 'star', colors: [FIREWORK_COLORS.red], fade: [FIREWORK_COLORS.yellow, FIREWORK_COLORS.white] });
  });

  it('builds a rocket out of paper, gunpowder and stars', () => {
    const star: Slot = { id: 'firework_star', count: 1, explosion: { shape: 'large_ball', colors: [FIREWORK_COLORS.lime] } };
    const m = matchSpecial(bag('paper', 'gunpowder', 'gunpowder', star), 3, 3);
    expect(m?.id).toBe('firework_rocket');
    expect(m?.result.count).toBe(3);
    expect(m?.result.firework).toEqual({ flight: 2, explosions: [{ shape: 'large_ball', colors: [FIREWORK_COLORS.lime] }] });
    // vanilla takes one to three gunpowder and exactly one paper
    expect(matchSpecial(bag('paper', 'gunpowder', 'gunpowder', 'gunpowder', 'gunpowder'), 3, 3)).toBeNull();
    expect(matchSpecial(bag('gunpowder'), 3, 3)).toBeNull();
  });

  it('flies for ten ticks a charge, and a little over', () => {
    for (const flight of [1, 2, 3]) {
      const lo = fireworkLifetime(flight, () => 0);
      const hi = fireworkLifetime(flight, () => 0.999);
      expect(lo).toBe(10 * (1 + flight));
      expect(hi).toBe(10 * (1 + flight) + 5 + 6);
    }
  });
});

describe('the crafting matcher', () => {
  it('finds the special recipes alongside the written ones', () => {
    const m = craftingMatcher.match(bag('leather_boots', 'green_dye'), 3, 3);
    expect(m?.recipe.id).toBe('armor_dye');
    expect(m?.result.color).toBe(DYE_COLORS.green);
    // and still finds an ordinary one
    const planks = craftingMatcher.match([{ id: 'oak_log', count: 1 }, null, null, null], 2, 2);
    expect(planks?.result.id).toBe('oak_planks');
  });
});
