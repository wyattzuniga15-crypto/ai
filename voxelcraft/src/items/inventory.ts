/** Item stacks and the player inventory (9 hotbar + 27 main + 4 armor + offhand). */
import { items } from './registry.ts';

export interface ItemStack {
  id: string;
  count: number;
  /** Damage taken (durability used). */
  damage?: number;
  enchantments?: Record<string, number>;
  name?: string;
  /** Anvil prior-work penalty. */
  repairCost?: number;
  /** Armor trim applied at a smithing table. */
  trim?: { pattern: string; material: string };
  /** Container contents carried by the item (shulker boxes), 27 slots. */
  contents?: (ItemStack | null)[];
  /** What a bottle holds: a potion id from `items/potions.ts`. */
  potion?: string;
}

export type Slot = ItemStack | null;

export function stackable(a: ItemStack, b: ItemStack): boolean {
  return a.id === b.id && (a.damage ?? 0) === (b.damage ?? 0) && JSON.stringify(a.enchantments ?? null) === JSON.stringify(b.enchantments ?? null) && (a.name ?? '') === (b.name ?? '') && (a.repairCost ?? 0) === (b.repairCost ?? 0) && JSON.stringify(a.trim ?? null) === JSON.stringify(b.trim ?? null) && JSON.stringify(a.contents ?? null) === JSON.stringify(b.contents ?? null);
}

export function cloneStack(s: ItemStack, count = s.count): ItemStack {
  const c: ItemStack = { id: s.id, count };
  if (s.damage) c.damage = s.damage;
  if (s.enchantments && Object.keys(s.enchantments).length) c.enchantments = { ...s.enchantments };
  if (s.name) c.name = s.name;
  if (s.repairCost) c.repairCost = s.repairCost;
  if (s.trim) c.trim = { ...s.trim };
  if (s.contents) c.contents = s.contents.map((x) => (x ? cloneStack(x) : null));
  return c;
}

export class Inventory {
  /** 0-8 hotbar, 9-35 main inventory. */
  readonly slots: Slot[] = new Array(36).fill(null);
  /** boots, leggings, chestplate, helmet (vanilla order). */
  readonly armor: Slot[] = new Array(4).fill(null);
  offhand: Slot = null;
  selected = 0;
  /** Bumps when anything changes so the HUD can refresh lazily. */
  version = 0;

  get hotbar(): Slot[] {
    return this.slots.slice(0, 9);
  }

  get(slot: number): Slot {
    return this.slots[slot];
  }

  set(slot: number, stack: Slot): void {
    this.slots[slot] = stack && stack.count > 0 ? stack : null;
    this.version++;
  }

  get selectedStack(): Slot {
    return this.slots[this.selected];
  }

  /** Adds items, filling matching stacks first, then empty slots (hotbar first). Returns leftovers. */
  add(stack: ItemStack): number {
    let remaining = stack.count;
    const max = items.maxStack(stack.id);
    const order = [...Array(36).keys()];
    for (const i of order) {
      const s = this.slots[i];
      if (s && stackable(s, stack) && s.count < max) {
        const n = Math.min(max - s.count, remaining);
        s.count += n;
        remaining -= n;
        if (remaining === 0) break;
      }
    }
    if (remaining > 0) {
      for (const i of order) {
        if (!this.slots[i]) {
          const n = Math.min(max, remaining);
          this.slots[i] = cloneStack(stack, n);
          remaining -= n;
          if (remaining === 0) break;
        }
      }
    }
    this.version++;
    return remaining;
  }

  /** Removes up to n items with the id; returns how many were removed. */
  remove(id: string, n: number): number {
    let left = n;
    for (let i = 0; i < 36 && left > 0; i++) {
      const s = this.slots[i];
      if (!s || s.id !== id) continue;
      const take = Math.min(s.count, left);
      s.count -= take;
      left -= take;
      if (s.count === 0) this.slots[i] = null;
    }
    this.version++;
    return n - left;
  }

  count(id: string): number {
    let n = 0;
    for (const s of this.slots) if (s && s.id === id) n += s.count;
    return n;
  }

  /** Consumes one item from the selected slot (survival). */
  consumeSelected(n = 1): void {
    const s = this.slots[this.selected];
    if (!s) return;
    s.count -= n;
    if (s.count <= 0) this.slots[this.selected] = null;
    this.version++;
  }

  /** Damages the held tool; returns true if it broke. */
  damageSelected(amount = 1): boolean {
    const s = this.slots[this.selected];
    if (!s) return false;
    const def = items.byId.get(s.id);
    if (!def?.durability) return false;
    let unbreakingLevel = s.enchantments?.unbreaking ?? 0;
    if (unbreakingLevel > 0 && Math.random() < unbreakingLevel / (unbreakingLevel + 1)) return false;
    s.damage = (s.damage ?? 0) + amount;
    this.version++;
    if (s.damage >= def.durability) {
      this.slots[this.selected] = null;
      return true;
    }
    return false;
  }

  clear(): void {
    this.slots.fill(null);
    this.armor.fill(null);
    this.offhand = null;
    this.version++;
  }

  serialize(): { slots: Slot[]; armor: Slot[]; offhand: Slot } {
    return { slots: this.slots.map((s) => (s ? cloneStack(s) : null)), armor: this.armor.map((s) => (s ? cloneStack(s) : null)), offhand: this.offhand ? cloneStack(this.offhand) : null };
  }

  restore(data: { slots: Slot[]; armor: Slot[]; offhand: Slot }): void {
    for (let i = 0; i < 36; i++) this.slots[i] = data.slots?.[i] && items.has(data.slots[i]!.id) ? cloneStack(data.slots[i]!) : null;
    for (let i = 0; i < 4; i++) this.armor[i] = data.armor?.[i] && items.has(data.armor[i]!.id) ? cloneStack(data.armor[i]!) : null;
    this.offhand = data.offhand && items.has(data.offhand.id) ? cloneStack(data.offhand) : null;
    this.version++;
  }
}
