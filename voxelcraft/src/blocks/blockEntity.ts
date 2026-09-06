/** Block entities: per-position data such as container contents and furnace progress. */
import type { Slot } from '../items/inventory.ts';
import { cloneStack } from '../items/inventory.ts';
import { items } from '../items/registry.ts';

export interface ContainerEntity {
  type: 'chest' | 'barrel' | 'shulker_box' | 'hopper' | 'dispenser' | 'dropper' | 'trapped_chest';
  items: Slot[];
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

export type BlockEntity = ContainerEntity | FurnaceEntity;

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
  const kind = containerKind(blockId);
  if (kind) return { type: kind as ContainerEntity['type'], items: new Array(CONTAINER_SIZES[kind]).fill(null) };
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
      if (Array.isArray(v.items)) v.items = v.items.map((s) => (s && items.has(s.id) ? cloneStack(s) : null));
      map.set(k, v);
    }
  } catch (e) {
    console.warn('bad block entity data', e);
  }
  return map;
}
