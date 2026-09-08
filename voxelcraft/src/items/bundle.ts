/**
 * Bundles: vanilla's sack of mixed items, which holds 64 units of weight rather than 64 items.
 * One item weighs 64 divided by how high it stacks, so a bundle takes 64 cobblestone, sixteen eggs
 * or a single saddle, and nothing that is itself a container goes in one. The newest thing put in
 * sits at the front and is the one that comes back out, unless the player has scrolled the bundle
 * round to something else.
 */
import { cloneStack, stackable, type ItemStack, type Slot } from './inventory.ts';
import { items } from './registry.ts';

/** Vanilla's BundleItem.MAX_WEIGHT. */
export const BUNDLE_CAPACITY = 64;
/** The tooltip grid: four cells across, twelve of them, the last counting the rest when it overflows. */
export const BUNDLE_COLUMNS = 4;
export const BUNDLE_CELLS = 12;

export function isBundle(id: string): boolean {
  return items.byId.get(id)?.behavior === 'bundle';
}

/** What one of an item weighs: 64 for a saddle, 4 for an egg, 1 for a cobblestone. */
export function unitWeight(id: string): number {
  return Math.max(1, Math.floor(BUNDLE_CAPACITY / items.maxStack(id)));
}

export function bundleWeight(contents: readonly Slot[] | undefined): number {
  let w = 0;
  for (const s of contents ?? []) if (s) w += unitWeight(s.id) * s.count;
  return w;
}

/** A container never goes inside a container: vanilla keeps bundles and shulker boxes out. */
export function fitsInBundle(stack: ItemStack): boolean {
  return !isBundle(stack.id) && !stack.id.endsWith('shulker_box');
}

/**
 * The entry the bundle is drawn open around: only set while the player has scrolled the bundle
 * round under the cursor, and cleared again when the cursor leaves, which is when vanilla sends
 * its select packet with -1. -1 for a bundle showing nothing.
 */
export function shownIndex(bundle: ItemStack): number {
  const n = bundle.contents?.length ?? 0;
  const i = bundle.selected ?? -1;
  return i >= 0 && i < n ? i : -1;
}

/** What a right click pulls out: whatever is shown, or else the front, which is the newest thing in. */
export function selectedIndex(bundle: ItemStack): number {
  if ((bundle.contents?.length ?? 0) === 0) return -1;
  return Math.max(0, shownIndex(bundle));
}

/**
 * Puts as much of a stack in as the remaining weight allows, merging with a matching entry and
 * otherwise pushing a new one onto the front. Returns how many were taken; the caller shrinks the
 * stack it offered.
 */
export function addToBundle(bundle: ItemStack, stack: ItemStack): number {
  if (!isBundle(bundle.id) || !fitsInBundle(stack) || stack.count <= 0) return 0;
  const contents = (bundle.contents ??= []);
  const room = Math.floor((BUNDLE_CAPACITY - bundleWeight(contents)) / unitWeight(stack.id));
  const n = Math.min(stack.count, room);
  if (n <= 0) return 0;
  const at = contents.findIndex((s) => s && stackable(s, stack));
  if (at >= 0) {
    const merged = cloneStack(contents[at]!, contents[at]!.count + n);
    contents.splice(at, 1);
    contents.unshift(merged);
  } else contents.unshift(cloneStack(stack, n));
  // nothing has been scrolled to since, so the bundle closes again and the newest thing comes out next
  delete bundle.selected;
  return n;
}

/** Takes the whole of the shown entry back out. An entry never runs past a stack, since a full stack weighs the lot. */
export function removeFromBundle(bundle: ItemStack): ItemStack | null {
  const i = selectedIndex(bundle);
  if (i < 0) return null;
  const contents = bundle.contents!;
  const [out] = contents.splice(i, 1);
  if (bundle.selected !== undefined) {
    if (contents.length) bundle.selected = Math.min(i, contents.length - 1);
    else delete bundle.selected;
  }
  return out ? cloneStack(out) : null;
}

/** The mouse wheel over a bundle walks its contents; the open bundle draws whatever is shown. */
export function cycleBundle(bundle: ItemStack, dir: number): boolean {
  const n = bundle.contents?.length ?? 0;
  if (n === 0) return false;
  const from = shownIndex(bundle);
  // the first turn of the wheel picks the front rather than stepping off it
  bundle.selected = from < 0 ? (dir > 0 ? 0 : n - 1) : (((from + dir) % n) + n) % n;
  return bundle.selected !== from;
}

/** The cursor leaving a bundle shuts it, as vanilla's select packet with -1 does. */
export function clearBundleSelection(bundle: ItemStack): boolean {
  if (bundle.selected === undefined) return false;
  delete bundle.selected;
  return true;
}

/** Using a bundle in hand tips the whole lot out. */
export function emptyBundle(bundle: ItemStack): ItemStack[] {
  const out = (bundle.contents ?? []).filter((s): s is ItemStack => !!s).map((s) => cloneStack(s));
  bundle.contents = [];
  delete bundle.selected;
  return out;
}
