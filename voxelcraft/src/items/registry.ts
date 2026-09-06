/** Item registry from data/items.json (every 1.21.11 item). */
import itemsJson from '../../data/items.json';

export interface ItemDef {
  id: string;
  name: string;
  num: number;
  stack: number;
  behavior: string;
  durability?: number;
  repair?: string[];
  enchant?: string[];
  tier?: string;
  tierLevel?: number;
  miningSpeed?: number;
  attack?: { damage: number; speed: number };
  armor?: { slot: string; points: number; toughness: number; knockbackResistance: number };
  food?: { nutrition: number; saturation: number; alwaysEdible?: boolean; eatTicks?: number; effects?: { effect: string; duration: number; amplifier?: number; chance?: number }[]; container?: string };
  block?: string;
}

export class ItemRegistry {
  readonly defs: ItemDef[];
  readonly byId = new Map<string, ItemDef>();
  /** Item that places a given block id. */
  readonly byBlock = new Map<string, ItemDef>();

  constructor(defs: ItemDef[]) {
    this.defs = defs;
    for (const d of defs) {
      this.byId.set(d.id, d);
      if (d.block && !this.byBlock.has(d.block)) this.byBlock.set(d.block, d);
    }
  }

  get(id: string): ItemDef {
    const d = this.byId.get(id);
    if (!d) throw new Error(`unknown item ${id}`);
    return d;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  maxStack(id: string): number {
    return this.byId.get(id)?.stack ?? 64;
  }

  isTool(id: string): boolean {
    const b = this.byId.get(id)?.behavior;
    return b === 'pickaxe' || b === 'axe' || b === 'shovel' || b === 'hoe' || b === 'sword' || b === 'shears';
  }
}

export const items = new ItemRegistry(itemsJson as ItemDef[]);
