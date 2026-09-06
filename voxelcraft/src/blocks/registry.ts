/**
 * Block registry: every Minecraft 1.21.11 block from data/blocks.json, with the global block-state
 * palette (numeric state ids identical to vanilla) and quick per-state lookups.
 */
import blocksJson from '../../data/blocks.json';

export interface BlockProperty {
  name: string;
  values: string[];
}

export interface BlockDef {
  id: string;
  name: string;
  num: number;
  hardness: number;
  resistance: number;
  tool: string | null;
  tier: number | null;
  requiresTool: boolean;
  transparent: boolean;
  emit: number;
  filter: number;
  min: number;
  max: number;
  default: number;
  states: BlockProperty[];
  solid: boolean;
  behavior: string;
  drops: string[];
  swordEfficient?: boolean;
  swordInstant?: boolean;
  shearsSpeed?: number;
  swordSpeed?: number;
  shape?: number | number[];
  /** In the vanilla `replaceable` tag: placing a block into it overwrites it. */
  replaceable?: boolean;
}

/** Blocks rendered with alpha blending instead of alpha testing. */
const TRANSLUCENT = new Set([
  'water', 'ice', 'frosted_ice', 'slime_block', 'honey_block', 'nether_portal', 'bubble_column', 'tinted_glass',
]);

export class BlockRegistry {
  readonly defs: BlockDef[];
  readonly byId = new Map<string, BlockDef>();
  /** Block index for every state id. */
  readonly stateBlock: Uint16Array;
  readonly stateFilter: Uint8Array;
  readonly stateEmit: Uint8Array;
  /** 1 when the state is a full opaque cube for lighting purposes. */
  readonly stateOpaque: Uint8Array;
  readonly maxState: number;
  readonly AIR: number;
  readonly WATER: number;
  readonly LAVA: number;
  private readonly propIndex = new Map<string, Map<string, number>>();

  constructor(defs: BlockDef[]) {
    this.defs = defs;
    let max = 0;
    for (const d of defs) {
      this.byId.set(d.id, d);
      if (d.max > max) max = d.max;
    }
    this.maxState = max;
    this.stateBlock = new Uint16Array(max + 1);
    this.stateFilter = new Uint8Array(max + 1);
    this.stateEmit = new Uint8Array(max + 1);
    this.stateOpaque = new Uint8Array(max + 1);
    defs.forEach((d, i) => {
      const opaque = d.filter >= 15 && !d.transparent && d.solid ? 1 : 0;
      for (let s = d.min; s <= d.max; s++) {
        this.stateBlock[s] = i;
        this.stateFilter[s] = d.filter;
        this.stateEmit[s] = d.emit;
        this.stateOpaque[s] = opaque;
      }
    });
    this.AIR = this.defaultState('air');
    this.WATER = this.defaultState('water');
    this.LAVA = this.defaultState('lava');
  }

  get(id: string): BlockDef {
    const d = this.byId.get(id);
    if (!d) throw new Error(`unknown block ${id}`);
    return d;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  blockOf(state: number): BlockDef {
    return this.defs[this.stateBlock[state]];
  }

  idOf(state: number): string {
    return this.defs[this.stateBlock[state]].id;
  }

  defaultState(id: string): number {
    return this.get(id).default;
  }

  isAir(state: number): boolean {
    return state === this.AIR || this.defs[this.stateBlock[state]].behavior === 'air';
  }

  isFluid(state: number): boolean {
    const b = this.defs[this.stateBlock[state]];
    return b.behavior === 'fluid';
  }

  isTranslucent(def: BlockDef): boolean {
    return TRANSLUCENT.has(def.id) || def.id.endsWith('_stained_glass') || def.id.endsWith('_stained_glass_pane');
  }

  /** Property values of a state, e.g. { facing: 'north', half: 'bottom' }. */
  props(state: number): Record<string, string> {
    const d = this.blockOf(state);
    const out: Record<string, string> = {};
    let idx = state - d.min;
    for (let i = d.states.length - 1; i >= 0; i--) {
      const p = d.states[i];
      const n = p.values.length;
      out[p.name] = p.values[idx % n];
      idx = Math.floor(idx / n);
    }
    return out;
  }

  prop(state: number, name: string): string | undefined {
    const d = this.blockOf(state);
    let idx = state - d.min;
    for (let i = d.states.length - 1; i >= 0; i--) {
      const p = d.states[i];
      const n = p.values.length;
      const v = p.values[idx % n];
      if (p.name === name) return v;
      idx = Math.floor(idx / n);
    }
    return undefined;
  }

  /** State id of a block with the given properties (unspecified ones keep the default value). */
  stateWith(id: string | BlockDef, props: Record<string, string>): number {
    const d = typeof id === 'string' ? this.get(id) : id;
    if (d.states.length === 0) return d.default;
    const current = this.props(d.default);
    let idx = 0;
    for (const p of d.states) {
      const value = props[p.name] ?? current[p.name];
      let vi = this.valueIndex(d, p, value);
      if (vi < 0) vi = 0;
      idx = idx * p.values.length + vi;
    }
    return d.min + idx;
  }

  withProp(state: number, name: string, value: string): number {
    const d = this.blockOf(state);
    const props = this.props(state);
    props[name] = value;
    return this.stateWith(d, props);
  }

  private valueIndex(d: BlockDef, p: BlockProperty, value: string): number {
    const key = `${d.id}/${p.name}`;
    let m = this.propIndex.get(key);
    if (!m) {
      m = new Map(p.values.map((v, i) => [v, i]));
      this.propIndex.set(key, m);
    }
    return m.get(value) ?? -1;
  }
}

export const blocks = new BlockRegistry(blocksJson as BlockDef[]);
export const AIR = blocks.AIR;
