/**
 * What enchantments actually do. Vanilla works armour out as an "enchantment protection factor":
 * each piece adds points for the damage in question, the total is capped at twenty, and every point
 * takes four percent off. The weapon and bow numbers below are vanilla's own too.
 */
import type { ItemStack, Slot } from './inventory.ts';

/** The kinds of damage protection tells apart. */
export type DamageSource =
  | 'generic' | 'fall' | 'fire' | 'explosion' | 'projectile' | 'magic' | 'void'
  | 'drown' | 'starve' | 'wall' | 'freeze';

/**
 * The sources vanilla's `bypasses_armor` tag lets straight through: nothing you wear helps
 * against a long drop, a lungful of water, an empty stomach, a block in the head or the cold.
 */
const BYPASSES_ARMOR = new Set<DamageSource>(['fall', 'magic', 'void', 'drown', 'starve', 'wall', 'freeze']);

/** Whether the points on a chestplate count for anything against this source. */
export const armorApplies = (source: DamageSource): boolean => !BYPASSES_ARMOR.has(source);

const level = (stack: Slot, id: string): number => stack?.enchantments?.[id] ?? 0;

/** Points one piece of armour contributes against a source, as vanilla scores them. */
function pieceFactor(stack: Slot, source: DamageSource): number {
  if (!stack) return 0;
  let epf = level(stack, 'protection');
  if (source === 'fire') epf += level(stack, 'fire_protection') * 2;
  if (source === 'explosion') epf += level(stack, 'blast_protection') * 2;
  if (source === 'projectile') epf += level(stack, 'projectile_protection') * 2;
  if (source === 'fall') epf += level(stack, 'feather_falling') * 3;
  return epf;
}

/** How much of the damage the armour's enchantments take off, 0 to 0.8. */
export function protectionFactor(armor: Slot[], source: DamageSource): number {
  if (source === 'void') return 0;
  let epf = 0;
  for (const piece of armor) epf += pieceFactor(piece, source);
  return Math.min(20, epf) * 0.04;
}

/** Thorns: vanilla gives each level a 15% chance to reflect one to four damage. */
export function thornsDamage(armor: Slot[], random: () => number): number {
  let total = 0;
  for (const piece of armor) {
    const lvl = level(piece, 'thorns');
    if (lvl > 0 && random() < 0.15 * lvl) total += 1 + Math.floor(random() * 4);
  }
  return total;
}

/** Mobs vanilla counts as undead, which Smite hits harder. */
const UNDEAD = new Set(['zombie', 'husk', 'drowned', 'zombie_villager', 'skeleton', 'stray', 'wither_skeleton', 'phantom', 'zoglin', 'zombified_piglin', 'skeleton_horse', 'zombie_horse', 'wither']);
/** And the arthropods Bane of Arthropods is for. */
const ARTHROPODS = new Set(['spider', 'cave_spider', 'silverfish', 'endermite', 'bee']);

/** Extra damage a weapon's enchantments add against a particular mob. */
export function weaponBonus(weapon: Slot, mobId: string): number {
  const sharpness = level(weapon, 'sharpness');
  let bonus = sharpness > 0 ? 0.5 * (sharpness - 1) + 1 : 0;
  if (UNDEAD.has(mobId)) bonus += 2.5 * level(weapon, 'smite');
  if (ARTHROPODS.has(mobId)) bonus += 2.5 * level(weapon, 'bane_of_arthropods');
  return bonus;
}

export const isArthropod = (mobId: string): boolean => ARTHROPODS.has(mobId);

/** Ticks of fire a weapon's Fire Aspect sets a mob alight for. */
export const fireAspectTicks = (weapon: Slot): number => level(weapon, 'fire_aspect') * 80;

/**
 * An arrow's base damage, which the arrow's own speed then multiplies. Vanilla starts at two and
 * Power adds half a point a level and half a point besides.
 */
export function bowBaseDamage(bow: Slot): number {
  const power = level(bow, 'power');
  return 2 + (power > 0 ? power * 0.5 + 0.5 : 0);
}

export const punchKnockback = (bow: Slot): number => level(bow, 'punch');

/** Vanilla draws a crossbow in twenty-five ticks, five fewer for each level of Quick Charge. */
export const crossbowChargeTicks = (bow: Slot): number => Math.max(1, 25 - 5 * level(bow, 'quick_charge'));
/** Multishot looses three bolts for the price of one. */
export const hasMultishot = (bow: Slot): boolean => level(bow, 'multishot') > 0;
/** How many mobs a bolt goes through before it stops. */
export const piercingCount = (bow: Slot): number => level(bow, 'piercing');
/**
 * The mace's smash: vanilla adds four damage a block for the first three blocks of the fall, two a
 * block for the next five and one a block after that, and Density adds half a point a level a block.
 */
export function maceDamage(mace: Slot, fallDistance: number): number {
  if (fallDistance <= 1.5) return 0;
  const d = fallDistance;
  let bonus = 0;
  bonus += Math.min(d, 3) * 4;
  if (d > 3) bonus += Math.min(d - 3, 5) * 2;
  if (d > 8) bonus += (d - 8) * 1;
  return bonus + level(mace, 'density') * 0.5 * d;
}
/** How far Wind Burst throws the wielder back up, in vanilla's own steps. */
export const windBurstLift = (mace: Slot): number => [0, 0.7, 0.8, 0.9][Math.min(3, level(mace, 'wind_burst'))];
/** Sweeping Edge: vanilla's share of the blow that the sweep passes on, a level over a level plus one. */
export function sweepingRatio(sword: Slot): number {
  const l = level(sword, 'sweeping_edge');
  return l > 0 ? l / (l + 1) : 0;
}

/** Impaling: vanilla adds two and a half points a level against anything wet. */
export const impalingBonus = (trident: Slot): number => level(trident, 'impaling') * 2.5;
export const loyaltyLevel = (trident: Slot): number => level(trident, 'loyalty');
export const riptideLevel = (trident: Slot): number => level(trident, 'riptide');
export const hasChanneling = (trident: Slot): boolean => level(trident, 'channeling') > 0;
export const hasFlame = (bow: Slot): boolean => level(bow, 'flame') > 0;
export const hasInfinity = (bow: Slot): boolean => level(bow, 'infinity') > 0;

/** Vanilla's draw: a bow is fully drawn after twenty ticks, and the pull curve is not linear. */
export function bowCharge(ticks: number): number {
  const t = ticks / 20;
  const charge = (t * t + t * 2) / 3;
  return Math.min(1, charge);
}

/**
 * Mending: experience mends the gear that needs it before it goes to the player's level. Vanilla
 * repairs two points of durability per point of experience.
 */
export function mendingTarget(gear: Slot[]): ItemStack | null {
  const damaged = gear.filter((s): s is ItemStack => !!s && (s.damage ?? 0) > 0 && !!s.enchantments?.mending);
  if (!damaged.length) return null;
  return damaged[Math.floor(Math.random() * damaged.length)];
}

export const hasCurse = (stack: Slot, curse: 'binding' | 'vanishing'): boolean =>
  level(stack, curse === 'binding' ? 'binding_curse' : 'vanishing_curse') > 0 || level(stack, `curse_of_${curse}`) > 0;

/** Depth Strider takes a third off the water's drag for each level, as vanilla speeds you up. */
export const depthStriderFactor = (boots: Slot): number => Math.min(3, level(boots, 'depth_strider')) / 3;

/** Respiration adds fifteen seconds of breath a level. */
export const respirationTicks = (helmet: Slot): number => level(helmet, 'respiration') * 300;

export const hasAquaAffinity = (helmet: Slot): boolean => level(helmet, 'aqua_affinity') > 0;
export const frostWalkerLevel = (boots: Slot): number => level(boots, 'frost_walker');
export const soulSpeedLevel = (boots: Slot): number => level(boots, 'soul_speed');
export const swiftSneakLevel = (leggings: Slot): number => level(leggings, 'swift_sneak');
