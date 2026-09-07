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

/**
 * Light that depends on the block's own state. Vanilla keeps these in code as a function of the
 * state rather than as one number per block, and the data we generate from can only carry the
 * default state's value — which is why an unlit furnace would otherwise glow and a lit one would
 * not. The numbers are vanilla's own.
 */
const STATE_LIGHT: Record<string, (p: Record<string, string>) => number> = {
  candle: (p) => (p.lit === 'true' ? 3 * Number(p.candles ?? 1) : 0),
  candle_cake: (p) => (p.lit === 'true' ? 3 : 0),
  redstone_lamp: (p) => (p.lit === 'true' ? 15 : 0),
  redstone_torch: (p) => (p.lit === 'true' ? 7 : 0),
  redstone_wall_torch: (p) => (p.lit === 'true' ? 7 : 0),
  redstone_ore: (p) => (p.lit === 'true' ? 9 : 0),
  deepslate_redstone_ore: (p) => (p.lit === 'true' ? 9 : 0),
  furnace: (p) => (p.lit === 'true' ? 13 : 0),
  blast_furnace: (p) => (p.lit === 'true' ? 13 : 0),
  smoker: (p) => (p.lit === 'true' ? 13 : 0),
  campfire: (p) => (p.lit === 'true' ? 15 : 0),
  soul_campfire: (p) => (p.lit === 'true' ? 10 : 0),
  respawn_anchor: (p) => Math.floor((Number(p.charges ?? 0) * 15) / 4),
  sea_pickle: (p) => (p.waterlogged === 'true' ? 3 + 3 * Number(p.pickles ?? 1) : 0),
  cave_vines: (p) => (p.berries === 'true' ? 14 : 0),
  cave_vines_plant: (p) => (p.berries === 'true' ? 14 : 0),
  light: (p) => Number(p.level ?? 15),
  copper_bulb: (p) => (p.lit === 'true' ? 15 : 0),
  exposed_copper_bulb: (p) => (p.lit === 'true' ? 12 : 0),
  weathered_copper_bulb: (p) => (p.lit === 'true' ? 8 : 0),
  oxidized_copper_bulb: (p) => (p.lit === 'true' ? 4 : 0),
};

/** The same rule for every block whose id ends this way: the dyed candles and the waxed bulbs. */
const STATE_LIGHT_SUFFIX: [string, (p: Record<string, string>) => number][] = [
  ['_candle_cake', STATE_LIGHT.candle_cake],
  ['_candle', STATE_LIGHT.candle],
];

/** The light rule for a block, if its light depends on more than which block it is. */
function stateLightRule(id: string): ((p: Record<string, string>) => number) | null {
  if (STATE_LIGHT[id]) return STATE_LIGHT[id];
  const waxed = id.startsWith('waxed_') ? id.slice(6) : null;
  if (waxed && STATE_LIGHT[waxed]) return STATE_LIGHT[waxed];
  for (const [suffix, rule] of STATE_LIGHT_SUFFIX) if (id.endsWith(suffix)) return rule;
  return null;
}

/** Blocks rendered with alpha blending instead of alpha testing. */
const TRANSLUCENT = new Set([
  'water', 'ice', 'frosted_ice', 'slime_block', 'honey_block', 'nether_portal', 'bubble_column', 'tinted_glass',
]);

/** The properties of one state id, read straight off the block's own list of them. */
function decodeProps(d: BlockDef, state: number): Record<string, string> {
  const out: Record<string, string> = {};
  let idx = state - d.min;
  for (let i = d.states.length - 1; i >= 0; i--) {
    const p = d.states[i];
    out[p.name] = p.values[idx % p.values.length];
    idx = Math.floor(idx / p.values.length);
  }
  return out;
}

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
      const rule = stateLightRule(d.id);
      for (let s = d.min; s <= d.max; s++) {
        this.stateBlock[s] = i;
        this.stateFilter[s] = d.filter;
        this.stateEmit[s] = rule ? Math.max(0, Math.min(15, rule(decodeProps(d, s)))) : d.emit;
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
