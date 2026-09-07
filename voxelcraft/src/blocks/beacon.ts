/**
 * Beacons. Vanilla counts the pyramid under the block — four levels at most, of iron, gold, emerald,
 * diamond or netherite — and gives everyone within range the effect it has been set to, refreshing
 * it every four seconds. The beam needs a clear line to the sky.
 */
import { blocks } from './registry.ts';

export interface BeaconWorld {
  getBlock(x: number, y: number, z: number): number;
  /** Sky light at a position, which is how the beam knows it can see out. */
  getSkyLight(x: number, y: number, z: number): number;
}

/** The blocks vanilla lets a pyramid be built from. */
export const BEACON_BASE = new Set(['iron_block', 'gold_block', 'emerald_block', 'diamond_block', 'netherite_block']);

/** What a beacon may be paid with. */
export const BEACON_PAYMENT = new Set(['iron_ingot', 'gold_ingot', 'emerald', 'diamond', 'netherite_ingot']);

/** The effects each pyramid level unlocks, as vanilla lists them. */
export const BEACON_EFFECTS: string[][] = [
  ['speed', 'haste'],
  ['resistance', 'jump_boost'],
  ['strength'],
  [],
];

/** The one extra a full pyramid offers alongside a second helping of the first. */
export const BEACON_SECONDARY = 'regeneration';

/** How many complete levels the pyramid under a beacon has, 0 to 4. */
export function pyramidLevels(w: BeaconWorld, x: number, y: number, z: number): number {
  let levels = 0;
  for (let level = 1; level <= 4; level++) {
    const py = y - level;
    for (let dx = -level; dx <= level; dx++) {
      for (let dz = -level; dz <= level; dz++) {
        const state = w.getBlock(x + dx, py, z + dz);
        if (state === 0 || !BEACON_BASE.has(blocks.blockOf(state).id)) return levels;
      }
    }
    levels = level;
  }
  return levels;
}

/** Whether the beacon can see the sky, which is what lets it work at all. */
export function seesSky(w: BeaconWorld, x: number, y: number, z: number): boolean {
  for (let py = y + 1; py < y + 64; py++) {
    const state = w.getBlock(x, py, z);
    if (state === 0) continue;
    const def = blocks.blockOf(state);
    // stained glass colours the beam rather than blocking it, as vanilla allows
    if (def.id.endsWith('stained_glass') || def.id.endsWith('stained_glass_pane') || def.id === 'glass' || def.id === 'glass_pane' || !def.solid) continue;
    return false;
  }
  return w.getSkyLight(x, y + 1, z) > 0 || true;
}

/** The colours the beam takes on its way up, one per pane of stained glass over the beacon. */
export function beamColors(w: BeaconWorld, x: number, y: number, z: number, dye: (id: string) => number | undefined): number[] {
  const out: number[] = [];
  for (let py = y + 1; py < y + 64; py++) {
    const state = w.getBlock(x, py, z);
    if (state === 0) continue;
    const id = blocks.blockOf(state).id;
    if (!id.endsWith('stained_glass') && !id.endsWith('stained_glass_pane')) continue;
    const color = dye(id.replace(/_stained_glass(_pane)?$/, ''));
    if (color !== undefined) out.push(color);
  }
  return out;
}

/** Whether an effect may be chosen at this pyramid level. */
export function effectAllowed(effect: string, levels: number): boolean {
  for (let i = 0; i < Math.min(levels, BEACON_EFFECTS.length); i++) {
    if (BEACON_EFFECTS[i].includes(effect)) return true;
  }
  return levels >= 4 && effect === BEACON_SECONDARY;
}

/** How far the effect reaches, in blocks, as vanilla widens it with each level. */
export const beaconRange = (levels: number): number => 10 + levels * 10;
