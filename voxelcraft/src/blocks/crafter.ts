/**
 * The crafter. Vanilla crafts one item from the pattern in its enabled slots each time a signal
 * reaches it, and shoots what it made out of the face it points at, into a container if one is
 * there. Items pushed into a crafter go to the emptiest slot it has, never to a disabled one.
 */
import { craftingMatcher } from '../items/crafting.ts';
import { items } from '../items/registry.ts';
import type { ItemStack, Slot } from '../items/inventory.ts';
import type { CrafterEntity } from './blockEntity.ts';

/** What the crafter would make from what is in it, or null when the pattern means nothing. */
export function crafterResult(e: CrafterEntity): ItemStack | null {
  const grid: Slot[] = e.items.map((s, i) => (e.disabled[i] ? null : s));
  if (!grid.some((s) => s)) return null;
  const match = craftingMatcher.match(grid, 3, 3);
  return match ? { ...match.result } : null;
}

/**
 * Crafts once: every slot that took part loses one item. Returns what was made, or null when
 * nothing could be.
 */
export function craftOnce(e: CrafterEntity): ItemStack | null {
  const result = crafterResult(e);
  if (!result) return null;
  for (let i = 0; i < 9; i++) {
    const slot = e.items[i];
    if (!slot || e.disabled[i]) continue;
    if (--slot.count <= 0) e.items[i] = null;
  }
  return result;
}

/**
 * Where an item pushed into a crafter goes: vanilla picks the emptiest slot that is switched on and
 * can still take it, so a hopper fills the grid evenly.
 */
export function crafterSlotFor(e: CrafterEntity, stack: ItemStack): number {
  let best = -1;
  let bestCount = Infinity;
  const max = items.maxStack(stack.id);
  for (let i = 0; i < 9; i++) {
    if (e.disabled[i]) continue;
    const slot = e.items[i];
    if (slot && (slot.id !== stack.id || slot.count >= max)) continue;
    const count = slot?.count ?? 0;
    if (count < bestCount) {
      best = i;
      bestCount = count;
    }
  }
  return best;
}

/** Switching a slot off, which vanilla only allows while it is empty. */
export function toggleSlot(e: CrafterEntity, index: number): boolean {
  if (e.items[index]) return false;
  e.disabled[index] = !e.disabled[index];
  return true;
}
