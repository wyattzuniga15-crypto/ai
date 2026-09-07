/**
 * Block behaviours: what happens on use, on neighbour changes, on random ticks and on scheduled
 * ticks. Dispatched by block id first, then by the `behavior` field from data/blocks.json.
 */
import { blocks, type BlockDef } from './registry.ts';
import type { Rng } from '../core/rng.ts';
import { LAVA_DELAY, WATER_DELAY, tickFluid, type FluidWorld } from '../world/fluids.ts';
import { placeTree, type BlockAccess } from '../world/gen/features.ts';
import { SEA_LEVEL } from '../core/constants.ts';
import { emitted, isPowered, powerAt, updateWireNetwork, wireState } from '../world/redstone.ts';
import { extend, retract, FACING_OFFSET } from '../world/piston.ts';
import { railPowered, railShape } from '../world/rails.ts';

export interface BlockWorld extends FluidWorld {
  /** Light level at a position (max of sky and block light). */
  getLight(x: number, y: number, z: number): number;
  getSkyLight(x: number, y: number, z: number): number;
  /** Make the block fall as an entity. */
  startFalling(x: number, y: number, z: number, state: number): void;
  isDay(): boolean;
  rng: Rng;
  /** Player-facing message (e.g. "You can only sleep at night"). */
  message(text: string): void;
  /** Called by beds. */
  sleep(x: number, y: number, z: number): void;
  addXp(n: number): void;
  /** Feed the player (cake). */
  feed(nutrition: number, saturation: number): void;
  dropItem(id: string, count: number, x: number, y: number, z: number): void;
  /** Light a block of TNT, which is what a signal or a flint and steel does to it. */
  igniteTnt(x: number, y: number, z: number): void;
  /** Sound a note block, at the pitch and instrument its state carries. */
  playNote(x: number, y: number, z: number): void;
  /** Fire a dispenser or drop from a dropper: the main thread has the items and the projectiles. */
  dispense(x: number, y: number, z: number): void;
}

export interface BlockContext {
  w: BlockWorld;
  x: number;
  y: number;
  z: number;
  state: number;
  def: BlockDef;
}

export interface Behavior {
  /** Right-click; return true when handled. */
  onUse?(ctx: BlockContext): boolean;
  onNeighborChanged?(ctx: BlockContext, nx: number, ny: number, nz: number): void;
  onPlaced?(ctx: BlockContext): void;
  randomTick?(ctx: BlockContext): void;
  scheduledTick?(ctx: BlockContext): void;
}

const st = (id: string) => blocks.defaultState(id);
const isAir = (s: number) => s === 0 || blocks.blockOf(s).behavior === 'air';

const SUPPORT_SOIL = new Set(['grass_block', 'dirt', 'coarse_dirt', 'podzol', 'rooted_dirt', 'moss_block', 'mud', 'farmland', 'mycelium', 'muddy_mangrove_roots']);

function needsSupportBelow(ctx: BlockContext, nx: number, ny: number, nz: number, allowed?: (id: string) => boolean): void {
  if (ny !== ctx.y - 1 || nx !== ctx.x || nz !== ctx.z) return;
  const below = ctx.w.getBlock(ctx.x, ctx.y - 1, ctx.z);
  const ok = below !== 0 && (allowed ? allowed(blocks.blockOf(below).id) : blocks.blockOf(below).solid);
  if (!ok) ctx.w.breakBlock(ctx.x, ctx.y, ctx.z);
}

const OPPOSITE: Record<string, [number, number, number]> = { north: [0, 0, 1], south: [0, 0, -1], west: [1, 0, 0], east: [-1, 0, 0], up: [0, -1, 0], down: [0, 1, 0] };

/** Trapdoors and gates simply follow whatever signal reaches them. */
function openOnPower(ctx: BlockContext): void {
  const powered = isPowered(ctx.w, ctx.x, ctx.y, ctx.z);
  if (powered === (blocks.prop(ctx.state, 'open') === 'true')) return;
  ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'open', powered ? 'true' : 'false'));
}

/** Delay in ticks before a component answers a change, as vanilla times each of them. */
function redstoneDelay(id: string, state: number): number {
  if (id === 'repeater') return Number(blocks.prop(state, 'delay') ?? '1') * 2;
  if (id === 'comparator') return 2;
  if (id === 'redstone_lamp') return 4;
  return 2;
}

/**
 * Something changed beside a redstone component: dust recomputes its whole network at once, and
 * everything with a delay (torches, repeaters, comparators, lamps going out) waits its turn.
 */
function redstoneChanged(ctx: BlockContext): void {
  const id = ctx.def.id;
  const { w, x, y, z } = ctx;
  switch (id) {
    case 'redstone_wire':
      updateWireNetwork(w, x, y, z);
      return;
    case 'redstone_torch':
    case 'redstone_wall_torch':
    case 'repeater':
    case 'comparator':
      w.schedule(x, y, z, redstoneDelay(id, ctx.state));
      return;
    case 'redstone_lamp': {
      const powered = isPowered(w, x, y, z);
      const lit = blocks.prop(ctx.state, 'lit') === 'true';
      // a lamp lights the moment it is powered but takes four ticks to go dark again
      if (powered && !lit) w.setBlock(x, y, z, blocks.withProp(ctx.state, 'lit', 'true'));
      else if (!powered && lit) w.schedule(x, y, z, 4);
      return;
    }
    case 'copper_bulb': case 'exposed_copper_bulb': case 'weathered_copper_bulb': case 'oxidized_copper_bulb':
    case 'waxed_copper_bulb': case 'waxed_exposed_copper_bulb': case 'waxed_weathered_copper_bulb': case 'waxed_oxidized_copper_bulb': {
      // a bulb flips each time the signal arrives, and stays that way when it goes
      const powered = isPowered(w, x, y, z);
      if (powered === (blocks.prop(ctx.state, 'powered') === 'true')) return;
      const lit = powered ? blocks.prop(ctx.state, 'lit') !== 'true' : blocks.prop(ctx.state, 'lit') === 'true';
      w.setBlock(x, y, z, blocks.stateWith(id, { powered: powered ? 'true' : 'false', lit: lit ? 'true' : 'false' }));
      return;
    }
    case 'tnt':
      if (isPowered(w, x, y, z)) w.igniteTnt(x, y, z);
      return;
    case 'note_block': {
      const powered = isPowered(w, x, y, z);
      if (powered === (blocks.prop(ctx.state, 'powered') === 'true')) return;
      w.setBlock(x, y, z, blocks.withProp(ctx.state, 'powered', powered ? 'true' : 'false'));
      if (powered) w.playNote(x, y, z);
      return;
    }
    case 'piston': case 'sticky_piston': {
      const facing = blocks.prop(ctx.state, 'facing') ?? 'up';
      const sticky = id === 'sticky_piston';
      const extended = blocks.prop(ctx.state, 'extended') === 'true';
      // a piston reads the signal at itself and at the block its head would occupy, as vanilla does
      const [fx, fy, fz] = FACING_OFFSET[facing];
      const powered = isPowered(w, x, y, z) || isPowered(w, x + fx, y + fy, z + fz);
      if (powered === extended) return;
      if (powered) extend(w, x, y, z, facing, sticky);
      else retract(w, x, y, z, facing, sticky);
      return;
    }
    case 'piston_head': {
      // the head goes when the piston behind it does
      const facing = blocks.prop(ctx.state, 'facing') ?? 'up';
      const [bx, by, bz] = OPPOSITE[facing];
      const base = w.getBlock(x + bx, y + by, z + bz);
      const baseId = base === 0 ? 'air' : blocks.blockOf(base).id;
      if ((baseId !== 'piston' && baseId !== 'sticky_piston') || blocks.prop(base, 'extended') !== 'true') w.setBlock(x, y, z, 0);
      return;
    }
    case 'dispenser': case 'dropper': {
      const powered = isPowered(w, x, y, z);
      if (powered === (blocks.prop(ctx.state, 'triggered') === 'true')) return;
      w.setBlock(x, y, z, blocks.withProp(ctx.state, 'triggered', powered ? 'true' : 'false'));
      if (powered) w.schedule(x, y, z, 4);
      return;
    }
    case 'rail': case 'powered_rail': case 'activator_rail': case 'detector_rail': {
      // the track first works out which way it runs, then whether it is carrying a signal
      const shape = railShape(w, x, y, z, id, blocks.prop(ctx.state, 'shape'));
      let next = shape !== blocks.prop(ctx.state, 'shape') ? blocks.withProp(ctx.state, 'shape', shape) : ctx.state;
      if (id === 'powered_rail' || id === 'activator_rail') {
        const powered = railPowered(w, x, y, z, shape);
        if (powered !== (blocks.prop(next, 'powered') === 'true')) next = blocks.withProp(next, 'powered', powered ? 'true' : 'false');
      }
      if (next !== ctx.state) w.setBlock(x, y, z, next);
      return;
    }
    default:
      return;
  }
}

/** The delayed half: a torch inverts what holds it up, a repeater and comparator pass their input on. */
function redstoneTick(ctx: BlockContext): void {
  const { w, x, y, z } = ctx;
  const id = ctx.def.id;
  const state = w.getBlock(x, y, z);
  if (state === 0 || blocks.blockOf(state).id !== id) return;
  if (id === 'redstone_torch' || id === 'redstone_wall_torch') {
    // the block it is fixed to: a floor torch stands on the one below, a wall torch hangs off its facing
    const [bx, by, bz] = id === 'redstone_torch'
      ? [x, y - 1, z]
      : [x + OPPOSITE[blocks.prop(state, 'facing') ?? 'north'][0], y, z + OPPOSITE[blocks.prop(state, 'facing') ?? 'north'][2]];
    const lit = !isPowered(w, bx, by, bz);
    if (lit !== (blocks.prop(state, 'lit') === 'true')) w.setBlock(x, y, z, blocks.withProp(state, 'lit', lit ? 'true' : 'false'));
    return;
  }
  if (id === 'repeater') {
    const facing = blocks.prop(state, 'facing') ?? 'north';
    const back = OPPOSITE[facing];
    const input = powerAt(w, x + back[0], y, z + back[2]) > 0 || emitted(w, x + back[0], y, z + back[2], facing) > 0;
    if (input !== (blocks.prop(state, 'powered') === 'true')) w.setBlock(x, y, z, blocks.withProp(state, 'powered', input ? 'true' : 'false'));
    return;
  }
  if (id === 'comparator') {
    const facing = blocks.prop(state, 'facing') ?? 'north';
    const back = OPPOSITE[facing];
    const rear = powerAt(w, x + back[0], y, z + back[2]);
    // the two sides feed the comparison; the stronger of them is what the rear is measured against
    const sides = facing === 'north' || facing === 'south' ? ['west', 'east'] : ['north', 'south'];
    let side = 0;
    for (const dir of sides) {
      const [dx, , dz] = OPPOSITE[dir];
      side = Math.max(side, powerAt(w, x - dx, y, z - dz));
    }
    const out = blocks.prop(state, 'mode') === 'subtract' ? Math.max(0, rear - side) : rear >= side ? rear : 0;
    const powered = out > 0;
    if (powered !== (blocks.prop(state, 'powered') === 'true')) w.setBlock(x, y, z, blocks.withProp(state, 'powered', powered ? 'true' : 'false'));
    return;
  }
  if (id === 'redstone_lamp') {
    const powered = isPowered(w, x, y, z);
    if (powered !== (blocks.prop(state, 'lit') === 'true')) w.setBlock(x, y, z, blocks.withProp(state, 'lit', powered ? 'true' : 'false'));
    return;
  }
  if (id === 'redstone_wire') updateWireNetwork(w, x, y, z);
  if (id === 'observer') {
    // the pulse is two ticks long, as vanilla times it
    if (blocks.prop(state, 'powered') === 'true') w.setBlock(x, y, z, blocks.withProp(state, 'powered', 'false'));
    return;
  }
  if (id === 'dispenser' || id === 'dropper') {
    w.dispense(x, y, z);
    return;
  }
  if (id === 'daylight_detector') {
    const inverted = blocks.prop(state, 'inverted') === 'true';
    const sky = w.getSkyLight(x, y + 1, z);
    // vanilla scales the sky light by the time of day; ours reads the light the sky is giving now
    const power = Math.max(0, Math.min(15, inverted ? 15 - sky : sky));
    if (power !== Number(blocks.prop(state, 'power') ?? '0')) w.setBlock(x, y, z, blocks.withProp(state, 'power', String(power)));
    w.schedule(x, y, z, 20);
  }
}

function growCrop(ctx: BlockContext, maxAge: number): void {
  const age = Number(blocks.prop(ctx.state, 'age') ?? 0);
  if (age >= maxAge) return;
  if (ctx.w.getLight(ctx.x, ctx.y, ctx.z) < 9) return;
  const below = ctx.w.getBlock(ctx.x, ctx.y - 1, ctx.z);
  const moist = below !== 0 && blocks.blockOf(below).id === 'farmland' && Number(blocks.prop(below, 'moisture') ?? 0) > 0;
  // vanilla: growth chance 1/(floor(25/points)+1), points 2..4 for dry..hydrated farmland
  const points = moist ? 4 : 2;
  if (ctx.w.rng.int(Math.floor(25 / points) + 1) !== 0) return;
  ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'age', String(age + 1)));
}

function growStalk(ctx: BlockContext, id: string, maxHeight: number): void {
  if (!isAir(ctx.w.getBlock(ctx.x, ctx.y + 1, ctx.z))) return;
  let h = 1;
  while (h < maxHeight + 1 && blocks.blockOf(ctx.w.getBlock(ctx.x, ctx.y - h, ctx.z)).id === id) h++;
  if (h >= maxHeight) return;
  const age = Number(blocks.prop(ctx.state, 'age') ?? 0);
  if (age >= 15) {
    ctx.w.setBlock(ctx.x, ctx.y + 1, ctx.z, blocks.stateWith(id, { age: '0' }));
    ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'age', '0'));
  } else ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'age', String(age + 1)));
}

const TREE_FOR_SAPLING: Record<string, string> = {
  oak_sapling: 'oak', birch_sapling: 'birch', spruce_sapling: 'spruce', jungle_sapling: 'jungle', acacia_sapling: 'acacia',
  dark_oak_sapling: 'dark_oak', cherry_sapling: 'cherry', mangrove_propagule: 'mangrove', pale_oak_sapling: 'pale_oak',
};

const behaviors: Record<string, Behavior> = {
  // ---------------------------------------------------------------- decorations needing support
  plant: {
    onNeighborChanged: (ctx, nx, ny, nz) => needsSupportBelow(ctx, nx, ny, nz, (id) => SUPPORT_SOIL.has(id) || id === 'sand' || id === 'red_sand' || id === 'gravel' || id === 'clay' || blocks.get(id).solid && !ctx.def.id.endsWith('_flower') && !['short_grass', 'tall_grass', 'fern', 'large_fern', 'dandelion', 'poppy'].includes(ctx.def.id)),
  },
  crop: {
    onNeighborChanged: (ctx, nx, ny, nz) => needsSupportBelow(ctx, nx, ny, nz, (id) => id === 'farmland' || id === 'soul_sand' || ctx.def.id === 'cocoa' || ctx.def.id === 'sweet_berry_bush'),
    randomTick: (ctx) => {
      const id = ctx.def.id;
      if (id === 'wheat' || id === 'carrots' || id === 'potatoes') growCrop(ctx, 7);
      else if (id === 'beetroots' || id === 'nether_wart' || id === 'sweet_berry_bush') {
        const age = Number(blocks.prop(ctx.state, 'age') ?? 0);
        if (age < 3 && ctx.w.rng.int(id === 'nether_wart' ? 10 : 5) === 0 && ctx.w.getLight(ctx.x, ctx.y, ctx.z) >= 9) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'age', String(age + 1)));
      } else if (id === 'melon_stem' || id === 'pumpkin_stem') {
        const age = Number(blocks.prop(ctx.state, 'age') ?? 0);
        if (age < 7) growCrop(ctx, 7);
        else if (ctx.w.rng.int(4) === 0 && ctx.w.getLight(ctx.x, ctx.y, ctx.z) >= 9) {
          const fruit = id === 'melon_stem' ? 'melon' : 'pumpkin';
          const dirs: [number, number, string][] = [[0, -1, 'north'], [0, 1, 'south'], [-1, 0, 'west'], [1, 0, 'east']];
          const [dx, dz, facing] = dirs[ctx.w.rng.int(4)];
          if (isAir(ctx.w.getBlock(ctx.x + dx, ctx.y, ctx.z + dz))) {
            const ground = blocks.blockOf(ctx.w.getBlock(ctx.x + dx, ctx.y - 1, ctx.z + dz)).id;
            if (SUPPORT_SOIL.has(ground)) {
              ctx.w.setBlock(ctx.x + dx, ctx.y, ctx.z + dz, st(fruit));
              ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.stateWith(`attached_${id}`, { facing }));
            }
          }
        }
      }
    },
  },
  sapling: {
    onNeighborChanged: (ctx, nx, ny, nz) => needsSupportBelow(ctx, nx, ny, nz, (id) => SUPPORT_SOIL.has(id)),
    randomTick: (ctx) => {
      if (ctx.w.getLight(ctx.x, ctx.y + 1, ctx.z) < 9 || ctx.w.rng.int(7) !== 0) return;
      const stage = Number(blocks.prop(ctx.state, 'stage') ?? 0);
      if (stage === 0) {
        ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'stage', '1'));
        return;
      }
      growTree(ctx);
    },
  },
  torch: {
    onNeighborChanged: (ctx, nx, ny, nz) => {
      const facing = blocks.prop(ctx.state, 'facing');
      if (facing) {
        const [dx, dy, dz] = OPPOSITE[facing];
        if (nx === ctx.x + dx && ny === ctx.y + dy && nz === ctx.z + dz && !blocks.blockOf(ctx.w.getBlock(nx, ny, nz)).solid) ctx.w.breakBlock(ctx.x, ctx.y, ctx.z);
      } else needsSupportBelow(ctx, nx, ny, nz);
    },
  },
  snow_layer: {
    onNeighborChanged: (ctx, nx, ny, nz) => needsSupportBelow(ctx, nx, ny, nz),
    randomTick: (ctx) => {
      if (ctx.w.getLight(ctx.x, ctx.y, ctx.z) > 11 && ctx.w.getSkyLight(ctx.x, ctx.y, ctx.z) < 15 && ctx.w.rng.int(4) === 0) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, 0);
    },
  },
  carpet: { onNeighborChanged: (ctx, nx, ny, nz) => needsSupportBelow(ctx, nx, ny, nz, (id) => !isAir(blocks.get(id).default)) },
  pressure_plate: { onNeighborChanged: (ctx, nx, ny, nz) => needsSupportBelow(ctx, nx, ny, nz) },
  climbable: {
    onNeighborChanged: (ctx, nx, ny, nz) => {
      if (ctx.def.id !== 'ladder') return;
      const facing = blocks.prop(ctx.state, 'facing') ?? 'north';
      const [dx, dy, dz] = OPPOSITE[facing];
      if (nx === ctx.x + dx && ny === ctx.y + dy && nz === ctx.z + dz && !blocks.blockOf(ctx.w.getBlock(nx, ny, nz)).solid) ctx.w.breakBlock(ctx.x, ctx.y, ctx.z);
    },
  },
  growing: {
    onNeighborChanged: (ctx, nx, ny, nz) => {
      const id = ctx.def.id;
      if (id === 'sugar_cane') needsSupportBelow(ctx, nx, ny, nz, (b) => b === 'sugar_cane' || SUPPORT_SOIL.has(b) || b === 'sand' || b === 'red_sand');
      else if (id === 'cactus') needsSupportBelow(ctx, nx, ny, nz, (b) => b === 'cactus' || b === 'sand' || b === 'red_sand');
      else if (id === 'bamboo') needsSupportBelow(ctx, nx, ny, nz, (b) => b === 'bamboo' || b === 'bamboo_sapling' || SUPPORT_SOIL.has(b) || b === 'sand' || b === 'gravel');
    },
    randomTick: (ctx) => {
      const id = ctx.def.id;
      if (id === 'sugar_cane') growStalk(ctx, id, 3);
      else if (id === 'cactus') growStalk(ctx, id, 3);
      else if (id === 'bamboo' && ctx.w.rng.int(3) === 0 && isAir(ctx.w.getBlock(ctx.x, ctx.y + 1, ctx.z))) {
        let h = 1;
        while (blocks.blockOf(ctx.w.getBlock(ctx.x, ctx.y - h, ctx.z)).id === 'bamboo') h++;
        if (h < 16) ctx.w.setBlock(ctx.x, ctx.y + 1, ctx.z, blocks.stateWith('bamboo', { age: '1', leaves: 'small', stage: '0' }));
      }
    },
  },
  // ---------------------------------------------------------------- gravity
  falling: {
    onPlaced: (ctx) => { if (isAir(ctx.w.getBlock(ctx.x, ctx.y - 1, ctx.z)) || blocks.blockOf(ctx.w.getBlock(ctx.x, ctx.y - 1, ctx.z)).behavior === 'fluid') ctx.w.schedule(ctx.x, ctx.y, ctx.z, 2); },
    onNeighborChanged: (ctx, nx, ny) => { if (ny === ctx.y - 1 && nx === ctx.x) ctx.w.schedule(ctx.x, ctx.y, ctx.z, 2); },
    scheduledTick: (ctx) => {
      const below = ctx.w.getBlock(ctx.x, ctx.y - 1, ctx.z);
      if (isAir(below) || blocks.blockOf(below).behavior === 'fluid') ctx.w.startFalling(ctx.x, ctx.y, ctx.z, ctx.state);
    },
  },
  // ---------------------------------------------------------------- doors, gates, switches
  door: {
    onUse: (ctx) => {
      if (ctx.def.id === 'iron_door') return false;
      const open = blocks.prop(ctx.state, 'open') === 'true' ? 'false' : 'true';
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'open', open));
      const half = blocks.prop(ctx.state, 'half');
      const oy = half === 'lower' ? ctx.y + 1 : ctx.y - 1;
      const o = ctx.w.getBlock(ctx.x, oy, ctx.z);
      if (o !== 0 && blocks.blockOf(o).id === ctx.def.id) ctx.w.setBlock(ctx.x, oy, ctx.z, blocks.withProp(o, 'open', open));
      return true;
    },
    onNeighborChanged: (ctx, nx, ny, nz) => {
      const half = blocks.prop(ctx.state, 'half');
      if (half === 'lower') needsSupportBelow(ctx, nx, ny, nz);
      const oy = half === 'lower' ? ctx.y + 1 : ctx.y - 1;
      if (nx === ctx.x && ny === oy && nz === ctx.z) {
        const o = ctx.w.getBlock(nx, ny, nz);
        if (o === 0 || blocks.blockOf(o).id !== ctx.def.id) {
          ctx.w.setBlock(ctx.x, ctx.y, ctx.z, 0);
          return;
        }
      }
      // a door opens on a signal to either of its halves, and both halves swing together
      const powered = isPowered(ctx.w, ctx.x, ctx.y, ctx.z) || isPowered(ctx.w, ctx.x, oy, ctx.z);
      if (powered === (blocks.prop(ctx.state, 'open') === 'true')) return;
      const open = powered ? 'true' : 'false';
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'open', open));
      const other = ctx.w.getBlock(ctx.x, oy, ctx.z);
      if (other !== 0 && blocks.blockOf(other).id === ctx.def.id) ctx.w.setBlock(ctx.x, oy, ctx.z, blocks.withProp(other, 'open', open));
    },
  },
  trapdoor: {
    onUse: (ctx) => {
      if (ctx.def.id === 'iron_trapdoor') return false;
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'open', blocks.prop(ctx.state, 'open') === 'true' ? 'false' : 'true'));
      return true;
    },
    onNeighborChanged: (ctx) => openOnPower(ctx),
  },
  fence_gate: {
    onUse: (ctx) => {
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'open', blocks.prop(ctx.state, 'open') === 'true' ? 'false' : 'true'));
      return true;
    },
    onNeighborChanged: (ctx) => openOnPower(ctx),
  },
  button: {
    onUse: (ctx) => {
      if (blocks.prop(ctx.state, 'powered') === 'true') return true;
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'powered', 'true'));
      ctx.w.schedule(ctx.x, ctx.y, ctx.z, ctx.def.id === 'stone_button' || ctx.def.id === 'polished_blackstone_button' ? 20 : 30);
      return true;
    },
    scheduledTick: (ctx) => ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'powered', 'false')),
  },
  // ---------------------------------------------------------------- redstone
  redstone: {
    onUse: (ctx) => {
      const id = ctx.def.id;
      if (id === 'lever') {
        const powered = blocks.prop(ctx.state, 'powered') === 'true' ? 'false' : 'true';
        ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'powered', powered));
        return true;
      }
      if (id === 'repeater') {
        // right-clicking a repeater steps its delay round one to four ticks, as vanilla does
        const delay = String((Number(blocks.prop(ctx.state, 'delay') ?? '1') % 4) + 1);
        ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'delay', delay));
        return true;
      }
      if (id === 'comparator') {
        const mode = blocks.prop(ctx.state, 'mode') === 'compare' ? 'subtract' : 'compare';
        ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'mode', mode));
        ctx.w.schedule(ctx.x, ctx.y, ctx.z, 2);
        return true;
      }
      return false;
    },
    onPlaced: (ctx) => {
      redstoneChanged(ctx);
      // a daylight sensor reads the sky as soon as it is down, and keeps checking
      if (ctx.def.id === 'daylight_detector') ctx.w.schedule(ctx.x, ctx.y, ctx.z, 1);
    },
    onNeighborChanged: (ctx, nx, ny, nz) => {
      const id = ctx.def.id;
      if (id === 'redstone_wire' || id === 'redstone_torch' || id === 'lever' || id === 'repeater' || id === 'comparator' || id.endsWith('rail')) {
        needsSupportBelow(ctx, nx, ny, nz, (b) => blocks.get(b).solid);
      }
      // an observer watches one block and pulses when it changes, whatever the change was
      if (id === 'observer') {
        const facing = blocks.prop(ctx.state, 'facing') ?? 'north';
        const [dx, dy, dz] = OPPOSITE[facing];
        if (nx === ctx.x - dx && ny === ctx.y - dy && nz === ctx.z - dz && blocks.prop(ctx.state, 'powered') !== 'true') {
          ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'powered', 'true'));
          ctx.w.schedule(ctx.x, ctx.y, ctx.z, 2);
        }
        return;
      }
      redstoneChanged(ctx);
    },
    scheduledTick: (ctx) => redstoneTick(ctx),
  },

  // ---------------------------------------------------------------- beds
  bed: {
    onUse: (ctx) => {
      ctx.w.sleep(ctx.x, ctx.y, ctx.z);
      return true;
    },
    onNeighborChanged: (ctx, nx, ny, nz) => {
      const facing = blocks.prop(ctx.state, 'facing') ?? 'north';
      const part = blocks.prop(ctx.state, 'part');
      const [dx, , dz] = part === 'foot' ? [-OPPOSITE[facing][0], 0, -OPPOSITE[facing][2]] : OPPOSITE[facing];
      if (nx === ctx.x + dx && ny === ctx.y && nz === ctx.z + dz) {
        const o = ctx.w.getBlock(nx, ny, nz);
        if (o === 0 || blocks.blockOf(o).id !== ctx.def.id) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, 0);
      }
    },
  },
  // ---------------------------------------------------------------- spreading blocks
  spreading: {
    randomTick: (ctx) => {
      const id = ctx.def.id;
      if (id !== 'grass_block' && id !== 'mycelium') return;
      const above = ctx.w.getBlock(ctx.x, ctx.y + 1, ctx.z);
      const aboveDef = blocks.blockOf(above);
      const filter = blocks.stateFilter[above];
      if (ctx.w.getLight(ctx.x, ctx.y + 1, ctx.z) < 4 && filter > 2 && aboveDef.behavior !== 'snow_layer') {
        ctx.w.setBlock(ctx.x, ctx.y, ctx.z, st('dirt'));
        return;
      }
      if (ctx.w.getLight(ctx.x, ctx.y + 1, ctx.z) < 9) return;
      for (let i = 0; i < 4; i++) {
        const x = ctx.x + ctx.w.rng.int(3) - 1;
        const y = ctx.y + ctx.w.rng.int(5) - 3;
        const z = ctx.z + ctx.w.rng.int(3) - 1;
        const t = ctx.w.getBlock(x, y, z);
        if (t === 0 || blocks.blockOf(t).id !== 'dirt') continue;
        const ta = ctx.w.getBlock(x, y + 1, z);
        if (ctx.w.getLight(x, y + 1, z) >= 4 && blocks.stateFilter[ta] <= 2) ctx.w.setBlock(x, y, z, blocks.stateWith(id, { snowy: blocks.blockOf(ta).behavior === 'snow_layer' ? 'true' : 'false' }));
      }
    },
  },
  farmland: {
    randomTick: (ctx) => {
      if (ctx.def.id !== 'farmland') return;
      let water = false;
      for (let dx = -4; dx <= 4 && !water; dx++)
        for (let dz = -4; dz <= 4 && !water; dz++)
          for (let dy = 0; dy <= 1; dy++) {
            const s = ctx.w.getBlock(ctx.x + dx, ctx.y + dy, ctx.z + dz);
            if (s !== 0 && blocks.blockOf(s).id === 'water') { water = true; break; }
          }
      const moisture = Number(blocks.prop(ctx.state, 'moisture') ?? 0);
      if (water) {
        if (moisture < 7) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'moisture', '7'));
      } else if (moisture > 0) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'moisture', String(moisture - 1)));
      else {
        const above = ctx.w.getBlock(ctx.x, ctx.y + 1, ctx.z);
        if (above === 0 || blocks.blockOf(above).behavior !== 'crop') ctx.w.setBlock(ctx.x, ctx.y, ctx.z, st('dirt'));
      }
    },
  },
  leaves: {
    randomTick: (ctx) => {
      if (blocks.prop(ctx.state, 'persistent') === 'true') return;
      if (ctx.w.rng.int(3) !== 0) return;
      // decay when no log is within 6 blocks through connected leaves
      const seen = new Set<string>();
      const queue: [number, number, number, number][] = [[ctx.x, ctx.y, ctx.z, 0]];
      while (queue.length) {
        const [x, y, z, d] = queue.shift()!;
        for (const [dx, dy, dz] of [[1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1]]) {
          const nx = x + dx, ny = y + dy, nz = z + dz;
          const key = `${nx},${ny},${nz}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const s = ctx.w.getBlock(nx, ny, nz);
          if (s === 0) continue;
          const b = blocks.blockOf(s).behavior;
          if (b === 'log') return;
          if (b === 'leaves' && d + 1 < 6) queue.push([nx, ny, nz, d + 1]);
        }
      }
      ctx.w.breakBlock(ctx.x, ctx.y, ctx.z);
    },
  },
  fluid: {
    scheduledTick: (ctx) => tickFluid(ctx.w, ctx.x, ctx.y, ctx.z, ctx.state),
    onPlaced: (ctx) => ctx.w.schedule(ctx.x, ctx.y, ctx.z, ctx.def.id === 'water' ? WATER_DELAY : LAVA_DELAY),
    onNeighborChanged: (ctx) => ctx.w.schedule(ctx.x, ctx.y, ctx.z, ctx.def.id === 'water' ? WATER_DELAY : LAVA_DELAY),
  },
  ice: {
    randomTick: (ctx) => {
      if (ctx.def.id === 'ice' && ctx.w.getLight(ctx.x, ctx.y, ctx.z) > 11 && ctx.w.rng.int(4) === 0) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, ctx.y < SEA_LEVEL - 20 ? 0 : st('water'));
    },
  },
};

/** A dispenser and a dropper are containers that also answer a signal. */
const dispenserBehavior: Behavior = {
  onUse: (ctx) => behaviors.container.onUse!(ctx),
  onNeighborChanged: (ctx) => redstoneChanged(ctx),
  scheduledTick: (ctx) => redstoneTick(ctx),
};

const byId: Record<string, Behavior> = {
  dispenser: dispenserBehavior,
  dropper: dispenserBehavior,
  lever: {
    onUse: (ctx) => {
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'powered', blocks.prop(ctx.state, 'powered') === 'true' ? 'false' : 'true'));
      return true;
    },
  },
  cake: {
    onUse: (ctx) => {
      const bites = Number(blocks.prop(ctx.state, 'bites') ?? 0);
      ctx.w.feed(2, 0.4);
      if (bites >= 6) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, 0);
      else ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'bites', String(bites + 1)));
      return true;
    },
  },
  sweet_berry_bush: {
    onUse: (ctx) => {
      const age = Number(blocks.prop(ctx.state, 'age') ?? 0);
      if (age < 2) return false;
      ctx.w.dropItem('sweet_berries', 1 + ctx.w.rng.int(2) + (age === 3 ? 1 : 0), ctx.x + 0.5, ctx.y + 0.5, ctx.z + 0.5);
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'age', '1'));
      return true;
    },
  },
  composter: {
    onUse: () => false,
  },
};

function growTree(ctx: BlockContext): void {
  const type = TREE_FOR_SAPLING[ctx.def.id];
  if (!type) return;
  const access: BlockAccess = { get: (x, y, z) => ctx.w.getBlock(x, y, z), set: (x, y, z, s) => ctx.w.setBlock(x, y, z, s) };
  ctx.w.setBlock(ctx.x, ctx.y, ctx.z, 0);
  if (!placeTree(access, ctx.w.rng, type, ctx.x, ctx.y, ctx.z)) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, ctx.state);
}

export function behaviorFor(def: BlockDef): Behavior | undefined {
  return byId[def.id] ?? behaviors[def.behavior];
}

export function hasRandomTick(def: BlockDef): boolean {
  const b = behaviorFor(def);
  return !!b?.randomTick;
}

/** Bone meal on a growable block; returns true when consumed. */
export function applyBoneMeal(w: BlockWorld, x: number, y: number, z: number, state: number): boolean {
  const def = blocks.blockOf(state);
  if (def.behavior === 'sapling') {
    if (w.rng.int(100) < 45) growTree({ w, x, y, z, state, def });
    return true;
  }
  if (def.behavior === 'crop') {
    const age = Number(blocks.prop(state, 'age') ?? 0);
    const max = def.id === 'beetroots' || def.id === 'nether_wart' || def.id === 'sweet_berry_bush' ? 3 : 7;
    if (def.id === 'nether_wart' || age >= max) return false;
    w.setBlock(x, y, z, blocks.withProp(state, 'age', String(Math.min(max, age + 2 + w.rng.int(4)))));
    return true;
  }
  if (def.id === 'grass_block') {
    for (let i = 0; i < 24; i++) {
      const px = x + w.rng.int(7) - 3;
      const pz = z + w.rng.int(7) - 3;
      const top = w.getBlock(px, y, pz);
      if (top === 0 || blocks.blockOf(top).id !== 'grass_block' || !isAir(w.getBlock(px, y + 1, pz))) continue;
      w.setBlock(px, y + 1, pz, w.rng.int(8) === 0 ? st(w.rng.int(2) === 0 ? 'dandelion' : 'poppy') : st('short_grass'));
    }
    return true;
  }
  return false;
}
