/** Block breaking speed and harvest rules (vanilla formulas). */
import { blocks, type BlockDef } from './registry.ts';
import { items, type ItemDef } from '../items/registry.ts';
import type { ItemStack } from '../items/inventory.ts';

export interface MiningContext {
  onGround: boolean;
  inWater: boolean;
  /** Aqua Affinity: mining underwater is not slowed. */
  aquaAffinity?: boolean;
  creative: boolean;
  haste?: number;
  miningFatigue?: number;
}

function toolMatches(def: BlockDef, item: ItemDef | undefined): boolean {
  if (!item) return false;
  if (def.tool && item.behavior === def.tool) return true;
  if (item.behavior === 'shears' && def.shearsSpeed) return true;
  if (item.behavior === 'sword' && def.swordInstant) return true;
  return false;
}

/** True when breaking the block with this item yields its normal drops. */
export function canHarvest(state: number, held: ItemStack | null): boolean {
  const def = blocks.blockOf(state);
  if (!def.requiresTool) return true;
  const item = held ? items.byId.get(held.id) : undefined;
  if (!item) return false;
  if (!toolMatches(def, item)) return false;
  if (item.behavior === 'shears' || item.behavior === 'sword') return true;
  return (item.tierLevel ?? 0) >= (def.tier ?? 0);
}

/** Ticks needed to break the block, or Infinity for unbreakable blocks. */
export function breakTicks(state: number, held: ItemStack | null, ctx: MiningContext): number {
  const def = blocks.blockOf(state);
  if (ctx.creative) return def.hardness < 0 ? Infinity : 0;
  if (def.hardness < 0) return Infinity;
  if (def.hardness === 0) return 0;
  const item = held ? items.byId.get(held.id) : undefined;
  let speed = 1;
  if (item) {
    if (toolMatches(def, item)) {
      if (item.behavior === 'shears') speed = def.shearsSpeed ?? 1;
      else if (item.behavior === 'sword') speed = def.swordInstant ? 1e9 : 1;
      else speed = item.miningSpeed ?? 1;
      const eff = held?.enchantments?.efficiency ?? 0;
      if (eff > 0 && speed > 1) speed += eff * eff + 1;
    } else if (item.behavior === 'sword' && (def.swordEfficient || def.swordSpeed)) speed = def.swordSpeed ?? 1.5;
  }
  if (ctx.haste) speed *= 1 + 0.2 * ctx.haste;
  if (ctx.miningFatigue) speed *= Math.pow(0.3, Math.min(ctx.miningFatigue, 4));
  if (ctx.inWater && !ctx.aquaAffinity) speed /= 5;
  if (!ctx.onGround) speed /= 5;
  let damage = speed / def.hardness;
  damage /= canHarvest(state, held) ? 30 : 100;
  if (damage >= 1) return 0;
  return Math.ceil(1 / damage);
}
