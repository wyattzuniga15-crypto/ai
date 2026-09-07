/**
 * Potions. Vanilla keeps its brewing in code rather than data (`PotionBrewing`), so this is the same
 * table written out: what each potion does, what colour it is, and which ingredient turns one into
 * another. Splash and lingering potions are the same potion in a different bottle, and the effect
 * lasts three quarters and a quarter as long, exactly as vanilla shortens them.
 */
import type { ItemStack } from './inventory.ts';

export interface PotionEffect {
  effect: string;
  /** Ticks; instant effects have none. */
  duration: number;
  amplifier: number;
}

export interface PotionDef {
  id: string;
  /** The name vanilla gives the bottle, without the "Potion of" in front. */
  name: string;
  color: number;
  effects: PotionEffect[];
}

const S = 20;
const MIN = 60 * S;

/** Every potion vanilla brews, with the effects and colours it gives them. */
export const potions: Record<string, PotionDef> = {};

function def(id: string, name: string, color: number, effects: PotionEffect[] = []): void {
  potions[id] = { id, name, color, effects };
}

/** A potion and its long and strong variants, which is how vanilla lays nearly all of them out. */
function family(id: string, name: string, color: number, effect: string, base: number, long?: number, strong?: { duration: number; amplifier: number }): void {
  def(id, name, color, [{ effect, duration: base, amplifier: 0 }]);
  if (long) def(`long_${id}`, name, color, [{ effect, duration: long, amplifier: 0 }]);
  if (strong) def(`strong_${id}`, name, color, [{ effect, duration: strong.duration, amplifier: strong.amplifier }]);
}

def('water', 'Water Bottle', 0x385dc6);
def('mundane', 'Mundane', 0x385dc6);
def('thick', 'Thick', 0x385dc6);
def('awkward', 'Awkward', 0x385dc6);
family('night_vision', 'Night Vision', 0x1f1fa1, 'night_vision', 3 * MIN, 8 * MIN);
family('invisibility', 'Invisibility', 0x7f8392, 'invisibility', 3 * MIN, 8 * MIN);
family('leaping', 'Leaping', 0x22ff4c, 'jump_boost', 3 * MIN, 8 * MIN, { duration: 90 * S, amplifier: 1 });
family('fire_resistance', 'Fire Resistance', 0xe49a3a, 'fire_resistance', 3 * MIN, 8 * MIN);
family('swiftness', 'Swiftness', 0x7cafc6, 'speed', 3 * MIN, 8 * MIN, { duration: 90 * S, amplifier: 1 });
family('slowness', 'Slowness', 0x5a6c81, 'slowness', 90 * S, 4 * MIN, { duration: 20 * S, amplifier: 3 });
family('water_breathing', 'Water Breathing', 0x2e5299, 'water_breathing', 3 * MIN, 8 * MIN);
family('poison', 'Poison', 0x4e9331, 'poison', 45 * S, 90 * S, { duration: 21 * S, amplifier: 1 });
family('regeneration', 'Regeneration', 0xcd5cab, 'regeneration', 45 * S, 90 * S, { duration: 22 * S, amplifier: 1 });
family('strength', 'Strength', 0x932423, 'strength', 3 * MIN, 8 * MIN, { duration: 90 * S, amplifier: 1 });
family('weakness', 'Weakness', 0x484d48, 'weakness', 90 * S, 4 * MIN);
family('slow_falling', 'Slow Falling', 0xf7f8e0, 'slow_falling', 90 * S, 4 * MIN);
family('luck', 'Luck', 0x339900, 'luck', 5 * MIN);
family('wind_charged', 'Wind Charging', 0xbdc9ff, 'wind_charged', 3 * MIN);
family('weaving', 'Weaving', 0x6c574c, 'weaving', 3 * MIN);
family('oozing', 'Oozing', 0x99f5a4, 'oozing', 3 * MIN);
family('infested', 'Infestation', 0x8c9b8c, 'infested', 3 * MIN);
def('healing', 'Healing', 0xf82423, [{ effect: 'instant_health', duration: 0, amplifier: 0 }]);
def('strong_healing', 'Healing', 0xf82423, [{ effect: 'instant_health', duration: 0, amplifier: 1 }]);
def('harming', 'Harming', 0x430a09, [{ effect: 'instant_damage', duration: 0, amplifier: 0 }]);
def('strong_harming', 'Harming', 0x430a09, [{ effect: 'instant_damage', duration: 0, amplifier: 1 }]);
// the turtle master's draught is two effects at once, which is why it has no family of its own
def('turtle_master', 'the Turtle Master', 0x9e8e97, [
  { effect: 'slowness', duration: 20 * S, amplifier: 3 },
  { effect: 'resistance', duration: 20 * S, amplifier: 2 },
]);
def('long_turtle_master', 'the Turtle Master', 0x9e8e97, [
  { effect: 'slowness', duration: 40 * S, amplifier: 3 },
  { effect: 'resistance', duration: 40 * S, amplifier: 2 },
]);
def('strong_turtle_master', 'the Turtle Master', 0x9e8e97, [
  { effect: 'slowness', duration: 20 * S, amplifier: 5 },
  { effect: 'resistance', duration: 20 * S, amplifier: 3 },
]);

/** Water plus one thing: the four bases vanilla allows. */
const FROM_WATER: Record<string, string> = {
  nether_wart: 'awkward',
  redstone: 'mundane',
  glowstone_dust: 'thick',
  fermented_spider_eye: 'weakness',
};

/** The awkward potion plus its ingredient, which is where every real potion comes from. */
const FROM_AWKWARD: Record<string, string> = {
  sugar: 'swiftness',
  rabbit_foot: 'leaping',
  blaze_powder: 'strength',
  glistering_melon_slice: 'healing',
  spider_eye: 'poison',
  ghast_tear: 'regeneration',
  magma_cream: 'fire_resistance',
  pufferfish: 'water_breathing',
  golden_carrot: 'night_vision',
  turtle_helmet: 'turtle_master',
  phantom_membrane: 'slow_falling',
  breeze_rod: 'wind_charged',
  cobweb: 'weaving',
  slime_block: 'oozing',
  stone: 'infested',
};

/** Fermented spider eye corrupts a potion into its opposite, the way vanilla pairs them. */
const CORRUPTS: Record<string, string> = {
  night_vision: 'invisibility',
  long_night_vision: 'long_invisibility',
  swiftness: 'slowness',
  long_swiftness: 'long_slowness',
  strong_swiftness: 'strong_slowness',
  leaping: 'slowness',
  long_leaping: 'long_slowness',
  strong_leaping: 'strong_slowness',
  healing: 'harming',
  strong_healing: 'strong_harming',
  poison: 'harming',
  long_poison: 'harming',
  strong_poison: 'strong_harming',
  water: 'weakness',
};

const BOTTLES = new Set(['potion', 'splash_potion', 'lingering_potion']);
/** Everything that holds a potion: the bottles, and the arrows one tipped. */
const POTION_ITEMS = new Set([...BOTTLES, 'tipped_arrow']);

/** The potion a bottle (or the arrow it tipped) holds; nothing set is water, as vanilla treats it. */
export const potionOf = (stack: ItemStack | null): string | null =>
  stack && POTION_ITEMS.has(stack.id) ? stack.potion ?? 'water' : null;

/**
 * One brewing step: the bottle in the stand, the ingredient above it, and what comes out. Gunpowder
 * and dragon's breath change the bottle rather than the potion; everything else changes the potion.
 */
export function brew(bottle: ItemStack, ingredient: string): ItemStack | null {
  if (!BOTTLES.has(bottle.id)) return null; // arrows are tipped at a crafting table, never brewed
  const potion = potionOf(bottle);
  if (potion === null) return null;
  if (ingredient === 'gunpowder') return bottle.id === 'potion' ? { ...bottle, id: 'splash_potion' } : null;
  if (ingredient === 'dragon_breath') return bottle.id === 'splash_potion' ? { ...bottle, id: 'lingering_potion' } : null;
  const next = brewPotion(potion, ingredient);
  return next ? { ...bottle, potion: next } : null;
}

/** The potion an ingredient turns another potion into. */
export function brewPotion(potion: string, ingredient: string): string | null {
  if (ingredient === 'fermented_spider_eye') return CORRUPTS[potion] ?? null;
  if (potion === 'water') return FROM_WATER[ingredient] ?? null;
  if (potion === 'awkward') {
    const made = FROM_AWKWARD[ingredient];
    return made && potions[made] ? made : null;
  }
  // redstone lengthens and glowstone strengthens, each undoing the other
  const bare = potion.replace(/^(long|strong)_/, '');
  if (ingredient === 'redstone') return potions[`long_${bare}`] ? `long_${bare}` : null;
  if (ingredient === 'glowstone_dust') return potions[`strong_${bare}`] ? `strong_${bare}` : null;
  return null;
}

/** Whether an ingredient could ever do anything in a brewing stand, for the slot filter. */
export function isBrewingIngredient(id: string): boolean {
  return id === 'gunpowder' || id === 'dragon_breath' || id === 'redstone' || id === 'glowstone_dust'
    || id === 'fermented_spider_eye' || id in FROM_WATER || id in FROM_AWKWARD;
}

/**
 * How long the effects last in the bottle they are in: splash three quarters, lingering a quarter,
 * and an eighth on the arrow a potion tips.
 */
export function effectsOf(stack: ItemStack): PotionEffect[] {
  const potion = potionOf(stack);
  const def = potion ? potions[potion] : undefined;
  if (!def) return [];
  const scale = stack.id === 'splash_potion' ? 0.75 : stack.id === 'lingering_potion' ? 0.25 : stack.id === 'tipped_arrow' ? 1 / 8 : 1;
  return def.effects.map((e) => ({ ...e, duration: Math.floor(e.duration * scale) }));
}

/** The colour of what is in the bottle, which is what the icon is tinted with. */
export function potionColor(stack: ItemStack): number {
  const potion = potionOf(stack);
  return (potion ? potions[potion]?.color : undefined) ?? 0x385dc6;
}

/** Vanilla's name for a bottle: "Splash Potion of Swiftness", "Water Bottle" and the rest. */
export function potionDisplayName(stack: ItemStack): string {
  const potion = potionOf(stack) ?? 'water';
  const def = potions[potion] ?? potions.water;
  const kind = stack.id === 'splash_potion' ? 'Splash Potion' : stack.id === 'lingering_potion' ? 'Lingering Potion' : stack.id === 'tipped_arrow' ? 'Arrow' : 'Potion';
  if (potion === 'water') return stack.id === 'potion' ? 'Water Bottle' : stack.id === 'tipped_arrow' ? 'Tipped Arrow' : `${kind} of Water`;
  if (potion === 'mundane' || potion === 'thick' || potion === 'awkward') return `${def.name} ${kind}`;
  return `${kind} of ${def.name}`;
}

/**
 * What an arrow leaves on what it hits. A spectral arrow gives vanilla's ten seconds of Glowing;
 * a tipped one carries its potion, cut to an eighth by `effectsOf`; a plain arrow gives nothing.
 */
export function arrowEffects(stack: ItemStack): { id: string; ticks: number; amplifier?: number }[] {
  if (stack.id === 'spectral_arrow') return [{ id: 'glowing', ticks: 200 }];
  if (stack.id !== 'tipped_arrow') return [];
  return effectsOf(stack).map((e) => ({ id: e.effect, ticks: e.duration, amplifier: e.amplifier }));
}
