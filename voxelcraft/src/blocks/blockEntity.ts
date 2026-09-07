/** Block entities: per-position data such as container contents and furnace progress. */
import type { Slot } from '../items/inventory.ts';
import { cloneStack } from '../items/inventory.ts';
import { items } from '../items/registry.ts';

export interface ContainerEntity {
  type: 'chest' | 'barrel' | 'shulker_box' | 'hopper' | 'dispenser' | 'dropper' | 'trapped_chest';
  items: Slot[];
  /** Ticks a hopper waits before it may move another item. */
  cooldown?: number;
}

export interface FurnaceEntity {
  type: 'furnace' | 'blast_furnace' | 'smoker';
  /** input, fuel, output */
  items: Slot[];
  burnTime: number;
  burnTotal: number;
  cookTime: number;
  cookTotal: number;
  xp: number;
}

/** Crafters: a three-by-three of slots, some of which can be switched off. */
export interface CrafterEntity {
  type: 'crafter';
  items: Slot[];
  /** Slots the player has switched off, which stay empty and are left out of the pattern. */
  disabled: boolean[];
  /** True while the crafter is playing its craft, which vanilla shows on the block. */
  crafting: boolean;
}

/** Lecterns: the book on the stand and the page it is open at. */
export interface LecternEntity {
  type: 'lectern';
  book: Slot;
  page: number;
}

/** Brewing stands: three bottles, the ingredient over them and the blaze powder that fires it. */
export interface BrewingEntity {
  type: 'brewing_stand';
  /** bottle 0-2, ingredient, fuel */
  items: Slot[];
  /** Ticks left of the brew, counting down from 400 as vanilla does. */
  brewTime: number;
  /** Brews left in the blaze powder that was put in. */
  fuel: number;
}

export interface SignEntity {
  type: 'sign';
  lines: string[];
  /** Text on the back of a standing sign (vanilla `back_text`); absent means blank. */
  backLines?: string[];
  color?: string;
}

/** Bee nests and hives: the bees living inside and how long each has been in there. */
export interface HiveEntity {
  type: 'beehive';
  /** Ticks each resident bee has spent inside; vanilla lets them out after 600 (2400 at night). */
  bees: number[];
  /** Whether each stored bee arrived carrying nectar, which is what raises the honey level. */
  nectar: boolean[];
}

/** Monster spawners: which mob comes out and how long until the next batch. */
export interface SpawnerEntity {
  type: 'spawner';
  /** Mob id the cage spins, or empty for a spawner with nothing set. */
  mob: string;
  /** Ticks until the next attempt; vanilla starts at 20 and then waits 200-800. */
  delay: number;
}

export type BlockEntity = ContainerEntity | FurnaceEntity | BrewingEntity | CrafterEntity | LecternEntity | SignEntity | HiveEntity | SpawnerEntity;

export const CONTAINER_SIZES: Record<string, number> = {
  chest: 27, trapped_chest: 27, barrel: 27, shulker_box: 27, hopper: 5, dispenser: 9, dropper: 9,
};

/** Base container kind for a block id (colored shulker boxes, copper chests...). */
export function containerKind(blockId: string): string | null {
  if (blockId.endsWith('shulker_box')) return 'shulker_box';
  if (blockId.endsWith('copper_chest')) return 'chest';
  return blockId in CONTAINER_SIZES ? blockId : null;
}

/** Creates the block entity a freshly placed block needs, or null. */
export function createBlockEntity(blockId: string): BlockEntity | null {
  if (blockId === 'furnace' || blockId === 'blast_furnace' || blockId === 'smoker') {
    return { type: blockId, items: [null, null, null], burnTime: 0, burnTotal: 0, cookTime: 0, cookTotal: blockId === 'furnace' ? 200 : 100, xp: 0 };
  }
  if (blockId === 'brewing_stand') return { type: 'brewing_stand', items: [null, null, null, null, null], brewTime: 0, fuel: 0 };
  if (blockId === 'crafter') return { type: 'crafter', items: new Array(9).fill(null), disabled: new Array(9).fill(false), crafting: false };
  if (blockId === 'lectern') return { type: 'lectern', book: null, page: 0 };
  const kind = containerKind(blockId);
  if (kind) return { type: kind as ContainerEntity['type'], items: new Array(CONTAINER_SIZES[kind]).fill(null) };
  if (blockId.endsWith('_sign')) return { type: 'sign', lines: ['', '', '', ''] };
  if (blockId === 'beehive' || blockId === 'bee_nest') return { type: 'beehive', bees: [], nectar: [] };
  if (blockId === 'spawner') return { type: 'spawner', mob: '', delay: 20 };
  return null;
}

export function entityKey(x: number, y: number, z: number): string {
  return `${x},${y},${z}`;
}

export function serializeEntities(map: Map<string, BlockEntity>): string | null {
  if (map.size === 0) return null;
  const out: Record<string, BlockEntity> = {};
  for (const [k, v] of map) out[k] = v;
  return JSON.stringify(out);
}

export function deserializeEntities(json: string | null | undefined): Map<string, BlockEntity> {
  const map = new Map<string, BlockEntity>();
  if (!json) return map;
  try {
    const obj = JSON.parse(json) as Record<string, BlockEntity>;
    for (const [k, v] of Object.entries(obj)) {
      if ('items' in v && Array.isArray(v.items)) v.items = v.items.map((s) => (s && items.has(s.id) ? cloneStack(s) : null));
      map.set(k, v);
    }
  } catch (e) {
    console.warn('bad block entity data', e);
  }
  return map;
}
