import { describe, expect, it } from 'vitest';
import { brew, brewPotion, effectsOf, isBrewingIngredient, potionDisplayName, potionOf, potions } from '../src/items/potions.ts';
import { BREW_TICKS, FUEL_BREWS, canBrew, tickBrewing } from '../src/blocks/brewing.ts';
import type { BrewingEntity } from '../src/blocks/blockEntity.ts';

const bottle = (potion?: string) => ({ id: 'potion', count: 1, ...(potion ? { potion } : {}) });

describe('brewing', () => {
  it('makes the four bases vanilla makes from water', () => {
    expect(brewPotion('water', 'nether_wart')).toBe('awkward');
    expect(brewPotion('water', 'redstone')).toBe('mundane');
    expect(brewPotion('water', 'glowstone_dust')).toBe('thick');
    expect(brewPotion('water', 'fermented_spider_eye')).toBe('weakness');
    expect(brewPotion('water', 'sugar')).toBeNull();
  });

  it('turns awkward into the potion its ingredient calls for', () => {
    expect(brewPotion('awkward', 'sugar')).toBe('swiftness');
    expect(brewPotion('awkward', 'blaze_powder')).toBe('strength');
    expect(brewPotion('awkward', 'ghast_tear')).toBe('regeneration');
    expect(brewPotion('awkward', 'golden_carrot')).toBe('night_vision');
    expect(brewPotion('awkward', 'phantom_membrane')).toBe('slow_falling');
    expect(brewPotion('awkward', 'breeze_rod')).toBe('wind_charged');
    expect(brewPotion('awkward', 'diamond')).toBeNull();
  });

  it('lengthens with redstone and strengthens with glowstone, but only where vanilla does', () => {
    expect(brewPotion('swiftness', 'redstone')).toBe('long_swiftness');
    expect(brewPotion('swiftness', 'glowstone_dust')).toBe('strong_swiftness');
    expect(brewPotion('long_swiftness', 'glowstone_dust')).toBe('strong_swiftness');
    expect(brewPotion('healing', 'redstone')).toBeNull(); // healing is instant, so it has no long form
    expect(brewPotion('night_vision', 'glowstone_dust')).toBeNull();
  });

  it('corrupts a potion with a fermented spider eye', () => {
    expect(brewPotion('night_vision', 'fermented_spider_eye')).toBe('invisibility');
    expect(brewPotion('swiftness', 'fermented_spider_eye')).toBe('slowness');
    expect(brewPotion('healing', 'fermented_spider_eye')).toBe('harming');
    expect(brewPotion('strong_poison', 'fermented_spider_eye')).toBe('strong_harming');
  });

  it('changes the bottle with gunpowder and dragon breath', () => {
    const swift = { id: 'potion', count: 1, potion: 'swiftness' };
    const splash = brew(swift, 'gunpowder');
    expect(splash).toMatchObject({ id: 'splash_potion', potion: 'swiftness' });
    expect(brew(splash!, 'dragon_breath')).toMatchObject({ id: 'lingering_potion', potion: 'swiftness' });
    expect(brew(swift, 'dragon_breath')).toBeNull();
  });

  it('knows a water bottle from an empty one', () => {
    expect(potionOf(bottle())).toBe('water');
    expect(potionOf({ id: 'glass_bottle', count: 1 })).toBeNull();
    expect(potionDisplayName(bottle())).toBe('Water Bottle');
    expect(potionDisplayName(bottle('swiftness'))).toBe('Potion of Swiftness');
    expect(potionDisplayName({ id: 'splash_potion', count: 1, potion: 'strong_healing' })).toBe('Splash Potion of Healing');
    expect(potionDisplayName(bottle('awkward'))).toBe('Awkward Potion');
  });

  it('shortens the effect for splash and lingering bottles the way vanilla does', () => {
    const full = effectsOf(bottle('swiftness'))[0];
    expect(full.duration).toBe(3600);
    expect(effectsOf({ id: 'splash_potion', count: 1, potion: 'swiftness' })[0].duration).toBe(2700);
    expect(effectsOf({ id: 'lingering_potion', count: 1, potion: 'swiftness' })[0].duration).toBe(900);
  });

  it('gives the turtle master both of its effects', () => {
    const e = effectsOf(bottle('turtle_master')).map((x) => x.effect).sort();
    expect(e).toEqual(['resistance', 'slowness']);
    expect(potions.strong_turtle_master.effects[0].amplifier).toBe(5);
  });

  it('lists as an ingredient only what could brew something', () => {
    for (const id of ['nether_wart', 'redstone', 'glowstone_dust', 'gunpowder', 'dragon_breath', 'sugar', 'fermented_spider_eye']) {
      expect(isBrewingIngredient(id)).toBe(true);
    }
    expect(isBrewingIngredient('diamond')).toBe(false);
  });
});

describe('brewing stand', () => {
  const stand = (): BrewingEntity => ({ type: 'brewing_stand', items: [null, null, null, null, null], brewTime: 0, fuel: 0 });

  it('needs fuel, a bottle and an ingredient before it starts', () => {
    const e = stand();
    expect(canBrew(e)).toBe(false);
    e.items[0] = bottle();
    e.items[3] = { id: 'nether_wart', count: 1 };
    expect(canBrew(e)).toBe(true);
    tickBrewing(e);
    expect(e.brewTime).toBe(0); // nothing burns yet
    e.items[4] = { id: 'blaze_powder', count: 2 };
    tickBrewing(e);
    expect(e.fuel).toBe(FUEL_BREWS - 1);
    expect(e.brewTime).toBe(BREW_TICKS);
    expect(e.items[4]).toMatchObject({ count: 1 });
  });

  it('turns every bottle it can when the brew finishes, and uses up the ingredient', () => {
    const e = stand();
    e.items[0] = bottle();
    e.items[1] = bottle();
    e.items[2] = { id: 'glass_bottle', count: 1 };
    e.items[3] = { id: 'nether_wart', count: 2 };
    e.items[4] = { id: 'blaze_powder', count: 1 };
    for (let i = 0; i < BREW_TICKS + 2; i++) tickBrewing(e);
    expect(potionOf(e.items[0])).toBe('awkward');
    expect(potionOf(e.items[1])).toBe('awkward');
    expect(e.items[2]).toMatchObject({ id: 'glass_bottle' }); // an empty bottle is left alone
    expect(e.items[3]).toMatchObject({ count: 1 });
  });

  it('stops when the ingredient cannot do anything to what is in the bottles', () => {
    const e = stand();
    e.items[0] = { id: 'potion', count: 1, potion: 'awkward' };
    e.items[3] = { id: 'diamond', count: 1 };
    e.items[4] = { id: 'blaze_powder', count: 1 };
    for (let i = 0; i < 100; i++) tickBrewing(e);
    expect(e.brewTime).toBe(0);
    expect(potionOf(e.items[0])).toBe('awkward');
  });
});
