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
import { updateAround } from '../world/tripwire.ts';
import { extend, retract, FACING_OFFSET } from '../world/piston.ts';
import { railPowered, railShape } from '../world/rails.ts';
import { composterLevel, composterState } from './composter.ts';

export interface BlockWorld extends FluidWorld {
  /** Light level at a position (max of sky and block light). */
  getLight(x: number, y: number, z: number): number;
  getSkyLight(x: number, y: number, z: number): number;
  /** Make the block fall as an entity. */
  startFalling(x: number, y: number, z: number, state: number): void;
  isDay(): boolean;
  /** Whether rain is falling, which is what puts a fire out. */
  isRaining(): boolean;
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

/** Whether a chorus plant still has something to hold on to, by vanilla's own reading of it. */
function chorusStands(ctx: BlockContext): boolean {
  const idAt = (x: number, y: number, z: number) => blocks.blockOf(ctx.w.getBlock(x, y, z)).id;
  const below = idAt(ctx.x, ctx.y - 1, ctx.z);
  // a plant with something over it and something under it is a middle piece: it hangs off neither side
  const stacked = ctx.w.getBlock(ctx.x, ctx.y + 1, ctx.z) !== 0 && ctx.w.getBlock(ctx.x, ctx.y - 1, ctx.z) !== 0;
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
    if (idAt(ctx.x + dx, ctx.y, ctx.z + dz) !== 'chorus_plant') continue;
    if (stacked) return false;
    const under = idAt(ctx.x + dx, ctx.y - 1, ctx.z + dz);
    if (under === 'chorus_plant' || under === 'end_stone') return true;
  }
  return below === 'chorus_plant' || below === 'end_stone';
}

/** The chorus plant a grown flower leaves behind, wired to whatever it touches. */
function chorusPlantState(ctx: BlockContext, x: number, y: number, z: number): number {
  const touching = (bx: number, by: number, bz: number) => {
    const id = blocks.blockOf(ctx.w.getBlock(bx, by, bz)).id;
    return id === 'chorus_plant' || id === 'chorus_flower' || (by < y && id === 'end_stone');
  };
  let state = blocks.defaultState('chorus_plant');
  for (const [name, dx, dy, dz] of [['up', 0, 1, 0], ['down', 0, -1, 0], ['north', 0, 0, -1], ['south', 0, 0, 1], ['west', -1, 0, 0], ['east', 1, 0, 0]] as [string, number, number, number][])
    state = blocks.withProp(state, name, touching(x + dx, y + dy, z + dz) ? 'true' : 'false');
  return state;
}

/**
 * Vanilla's chorus flower: it climbs while there is room above, dying off after four blocks unless
 * it is standing on end stone, and branches sideways when it cannot climb. A flower that can do
 * neither ages out and stops.
 */
function growChorus(ctx: BlockContext): void {
  const above = ctx.w.getBlock(ctx.x, ctx.y + 1, ctx.z);
  const age = Number(blocks.prop(ctx.state, 'age') ?? 0);
  if (above !== 0 || age >= 5) return;
  const flower = (x: number, y: number, z: number, a: number) => ctx.w.setBlock(x, y, z, blocks.stateWith('chorus_flower', { age: String(Math.min(5, a)) }));
  const empty = (x: number, y: number, z: number) => ctx.w.getBlock(x, y, z) === 0;
  // nothing may be growing into the sides of where it is going, or it would grow through itself
  const clearAround = (x: number, y: number, z: number, from?: [number, number]) => {
    for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) {
      if (from && dx === from[0] && dz === from[1]) continue;
      if (!empty(x + dx, y, z + dz)) return false;
    }
    return true;
  };
  const belowId = blocks.blockOf(ctx.w.getBlock(ctx.x, ctx.y - 1, ctx.z)).id;
  let climbs = false;
  let onEndStone = false;
  if (belowId === 'end_stone') climbs = true;
  else if (belowId === 'chorus_plant') {
    // vanilla lets a stem climb four blocks, or five when the whole of it stands on end stone
    let height = 1;
    for (let i = 0; i < 4; i++) {
      const id = blocks.blockOf(ctx.w.getBlock(ctx.x, ctx.y - height - 1, ctx.z)).id;
      if (id !== 'chorus_plant') {
        if (id === 'end_stone') onEndStone = true;
        break;
      }
      height++;
    }
    if (height < 2 || height <= ctx.w.rng.int(onEndStone ? 5 : 4)) climbs = true;
  } else if (belowId === 'air') climbs = true;
  if (climbs && clearAround(ctx.x, ctx.y + 1, ctx.z) && empty(ctx.x, ctx.y + 2, ctx.z)) {
    // the flower goes up first so the stem it leaves behind knows there is something over it
    flower(ctx.x, ctx.y + 1, ctx.z, age);
    ctx.w.setBlock(ctx.x, ctx.y, ctx.z, chorusPlantState(ctx, ctx.x, ctx.y, ctx.z));
    return;
  }
  if (age >= 4) {
    ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.stateWith('chorus_flower', { age: '5' }));
    return;
  }
  let branched = false;
  const tries = ctx.w.rng.int(4) + (onEndStone ? 1 : 0);
  for (let i = 0; i < tries; i++) {
    const [dx, dz] = ([[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][])[ctx.w.rng.int(4)];
    const x = ctx.x + dx;
    const z = ctx.z + dz;
    if (!empty(x, ctx.y, z) || !empty(x, ctx.y - 1, z) || !clearAround(x, ctx.y, z, [-dx, -dz])) continue;
    flower(x, ctx.y, z, age + 1);
    branched = true;
  }
  ctx.w.setBlock(ctx.x, ctx.y, ctx.z, branched ? chorusPlantState(ctx, ctx.x, ctx.y, ctx.z) : blocks.stateWith('chorus_flower', { age: '5' }));
}

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
    case 'tripwire':
    case 'tripwire_hook':
      // the run is restrung around the change; whatever is standing on the wire stays standing on it
      updateAround(w, x, y, z);
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
    case 'crafter': case 'dispenser': case 'dropper': {
      const powered = isPowered(w, x, y, z);
      if (powered === (blocks.prop(ctx.state, 'triggered') === 'true')) return;
      let next = blocks.withProp(ctx.state, 'triggered', powered ? 'true' : 'false');
      // a crafter shows itself crafting while the signal is on it
      if (id === 'crafter') next = blocks.withProp(next, 'crafting', powered ? 'true' : 'false');
      w.setBlock(x, y, z, next);
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
  if (id === 'dispenser' || id === 'dropper' || id === 'crafter') {
    // the game has the items: a dispenser fires, a dropper drops and a crafter crafts
    w.dispense(x, y, z);
    if (id === 'crafter') w.setBlock(x, y, z, blocks.withProp(w.getBlock(x, y, z), 'crafting', 'false'));
    return;
  }
  if (id === 'target') {
    // vanilla holds a target's signal for a moment after the shot and then lets it go
    if (blocks.prop(state, 'power') !== '0') w.setBlock(x, y, z, blocks.withProp(state, 'power', '0'));
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

/**
 * The two flower crops finish by turning into the flower itself: a torchflower at the last stage,
 * and a pitcher plant that stands two blocks tall.
 */
function ripenFlowerCrop(ctx: BlockContext): void {
  const state = ctx.w.getBlock(ctx.x, ctx.y, ctx.z);
  if (state === 0 || blocks.blockOf(state).id !== ctx.def.id) return;
  const age = Number(blocks.prop(state, 'age') ?? 0);
  if (ctx.def.id === 'torchflower_crop') {
    // the torchflower crop has only two stages; the second one is the flower itself
    if (age >= 1) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, st('torchflower'));
    return;
  }
  if (age < 4 || !isAir(ctx.w.getBlock(ctx.x, ctx.y + 1, ctx.z))) return;
  ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.stateWith('pitcher_plant', { half: 'lower' }));
  ctx.w.setBlock(ctx.x, ctx.y + 1, ctx.z, blocks.stateWith('pitcher_plant', { half: 'upper' }));
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
      } else if (id === 'cocoa') {
        // cocoa ripens on the jungle log it hangs from, in three stages
        const age = Number(blocks.prop(ctx.state, 'age') ?? 0);
        if (age < 2 && ctx.w.rng.int(5) === 0) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'age', String(age + 1)));
      } else if (id === 'torchflower_crop' || id === 'pitcher_crop') {
        growCrop(ctx, id === 'torchflower_crop' ? 1 : 4);
        ripenFlowerCrop(ctx);
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
      else if (id === 'chorus_flower') needsSupportBelow(ctx, nx, ny, nz, (b) => b === 'end_stone' || b === 'chorus_plant' || b === 'air');
      else if (id === 'chorus_plant') {
        if (!chorusStands(ctx)) ctx.w.breakBlock(ctx.x, ctx.y, ctx.z);
        else {
          // a plant re-reads what it is joined to whenever anything beside it changes
          const wired = chorusPlantState(ctx, ctx.x, ctx.y, ctx.z);
          if (wired !== ctx.state) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, wired);
        }
      }
    },
    randomTick: (ctx) => {
      const id = ctx.def.id;
      if (id === 'chorus_flower') growChorus(ctx);
      else if (id === 'sugar_cane') growStalk(ctx, id, 3);
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
  /** A candle: a hand puts one out, and flint and steel lights it again (the game strikes that). */
  candle: {
    onUse: (ctx) => {
      if (blocks.prop(ctx.state, 'lit') !== 'true') return false;
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'lit', 'false'));
      return true;
    },
  },
  /**
   * Coral out of water dies, as vanilla's does: a piece with no water against it turns into the
   * dead one of its kind the next time it is looked at.
   */
  coral: {
    onNeighborChanged: (ctx) => ctx.w.schedule(ctx.x, ctx.y, ctx.z, 60 + ctx.w.rng.int(40)),
    onPlaced: (ctx) => ctx.w.schedule(ctx.x, ctx.y, ctx.z, 60 + ctx.w.rng.int(40)),
    scheduledTick: (ctx) => {
      const id = ctx.def.id;
      if (id.startsWith('dead_') || !blocks.has(`dead_${id}`)) return;
      if (blocks.prop(ctx.state, 'waterlogged') === 'true') return;
      for (const [dx, dy, dz] of NEIGHBORS) if (blocks.blockOf(ctx.w.getBlock(ctx.x + dx, ctx.y + dy, ctx.z + dz)).id === 'water') return;
      // vanilla keeps the shape and the way it faces, only the block itself dies
      let dead = blocks.defaultState(`dead_${id}`);
      for (const prop of ['facing', 'waterlogged']) {
        const value = blocks.prop(ctx.state, prop);
        if (value !== undefined && blocks.prop(dead, prop) !== undefined) dead = blocks.withProp(dead, prop, value);
      }
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, dead);
    },
  },
};

/** A dispenser, a dropper and a crafter are containers that also answer a signal. */
const dispenserBehavior: Behavior = {
  // the game opens the screen itself, since the items live on the main thread
  onUse: () => false,
  onNeighborChanged: (ctx) => redstoneChanged(ctx),
  scheduledTick: (ctx) => redstoneTick(ctx),
};

const byId: Record<string, Behavior> = {
  dispenser: dispenserBehavior,
  dropper: dispenserBehavior,
  crafter: dispenserBehavior,
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
  fire: {
    // rain puts a fire out, which in vanilla is the fire block's own tick noticing the weather
    randomTick: (ctx) => {
      if (!ctx.w.isRaining()) return;
      if (ctx.w.getSkyLight(ctx.x, ctx.y, ctx.z) <= 0) return;
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, 0);
    },
    onPlaced: (ctx) => fireSchedule(ctx),
    onNeighborChanged: (ctx) => {
      // a fire with nothing left to stand on or burn goes out at once, as vanilla's does
      if (ctx.def.id !== 'fire') return;
      if (!fireSurvives(ctx)) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, 0);
    },
    scheduledTick: (ctx) => burnTick(ctx),
  },
  composter: {
    // the seventh fill ripens a moment later, which is when vanilla turns the level to eight
    scheduledTick: (ctx) => {
      if (composterLevel(ctx.state) !== 7) return;
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, composterState(8));
    },
  },
};


// ---------------------------------------------------------------------------------------------
// Fire
// ---------------------------------------------------------------------------------------------
/**
 * How readily a block catches and how readily it burns away, which vanilla keeps in code as a pair
 * of numbers per block. These are vanilla's own values, read off the families the ids fall into.
 */
export function flammability(id: string): { catches: number; burns: number } | null {
  if (id.endsWith('_leaves') || id === 'wool' || id.endsWith('_wool') || id.endsWith('_carpet') || id === 'moss_carpet' || id === 'dried_kelp_block') return { catches: 30, burns: 60 };
  if (id.endsWith('_planks') || id.endsWith('_slab') && WOODY.test(id) || id.endsWith('_stairs') && WOODY.test(id) || id.endsWith('_fence') || id.endsWith('_fence_gate') || id === 'bookshelf' || id === 'chiseled_bookshelf' || id === 'lectern' || id === 'composter' || id === 'beehive' || id === 'bee_nest' || id === 'bamboo_mosaic') return { catches: 5, burns: 20 };
  if (id.endsWith('_log') || id.endsWith('_wood') || id.endsWith('_stem') || id.endsWith('_hyphae') || id === 'coal_block' || id === 'bamboo_block') return { catches: 5, burns: 5 };
  if (id === 'hay_block' || id === 'target' || id === 'scaffolding') return { catches: 60, burns: 20 };
  if (id === 'tnt') return { catches: 15, burns: 100 };
  if (id === 'vine' || id === 'glow_lichen' || id === 'bamboo' || id === 'big_dripleaf' || id === 'small_dripleaf' || id === 'hanging_roots') return { catches: 15, burns: 100 };
  if (PLANTS.test(id)) return { catches: 60, burns: 100 };
  return null;
}

const WOODY = /(oak|spruce|birch|jungle|acacia|dark_oak|mangrove|cherry|pale_oak|bamboo|crimson|warped)/;
const PLANTS = /(_flower|grass|fern|sapling|_bush|tulip|orchid|allium|daisy|cornflower|lily|dandelion|poppy|azalea|petals|_sprouts|wheat|_roots|deadbush|sunflower|lilac|peony|rose_bush|pitcher_plant|torchflower|kelp|seagrass)/;

/** A fire on netherrack, magma or soul soil is one vanilla never lets go out. */
const everBurning = (id: string): boolean => id === 'netherrack' || id === 'magma_block' || id === 'soul_sand' || id === 'soul_soil';

/** Whether anything holds this fire up: the block under it, or something beside it to burn. */
function fireSurvives(ctx: BlockContext): boolean {
  const below = blocks.blockOf(ctx.w.getBlock(ctx.x, ctx.y - 1, ctx.z));
  if (below.solid || everBurning(below.id)) return true;
  for (const [dx, dy, dz] of NEIGHBORS) {
    const id = blocks.blockOf(ctx.w.getBlock(ctx.x + dx, ctx.y + dy, ctx.z + dz)).id;
    if (flammability(id)) return true;
  }
  return false;
}

const NEIGHBORS: [number, number, number][] = [[0, 1, 0], [0, -1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];

/** Vanilla ticks a fire every thirty ticks or so, which is what paces a spread. */
function fireSchedule(ctx: BlockContext): void {
  if (ctx.def.id !== 'fire') return;
  ctx.w.schedule(ctx.x, ctx.y, ctx.z, 30 + ctx.w.rng.int(10));
}

/**
 * Vanilla's fire tick: it ages, eats what it is touching, and reaches for whatever is near enough
 * to catch. A fire on netherrack burns for ever; one with nothing to burn and nothing to stand on
 * goes out; and rain puts out anything the sky can see. The numbers are vanilla's own.
 */
function burnTick(ctx: BlockContext): void {
  if (ctx.def.id !== 'fire') return;
  const w = ctx.w;
  const { x, y, z } = ctx;
  const age = Number(blocks.prop(ctx.state, 'age') ?? 0);
  const belowId = blocks.blockOf(w.getBlock(x, y - 1, z)).id;
  const forever = everBurning(belowId);
  const wet = w.isRaining() && w.getSkyLight(x, y, z) > 0;
  if (!forever && wet && w.rng.next() < 0.2 + age * 0.03) {
    w.setBlock(x, y, z, 0);
    return;
  }
  // it ages by a step at a time until it is at fifteen
  const older = Math.min(15, age + Math.floor(w.rng.int(3) / 2));
  let state = ctx.state;
  if (older !== age) {
    state = blocks.withProp(ctx.state, 'age', String(older));
    w.setBlock(x, y, z, state);
  }
  if (forever) return;
  fireSchedule(ctx);
  if (!fireSurvives(ctx)) {
    // nothing to burn: it needs a floor, and an old fire goes out even with one
    if (!blocks.blockOf(w.getBlock(x, y - 1, z)).solid || older > 3) w.setBlock(x, y, z, 0);
    return;
  }
  if (older === 15 && w.rng.int(4) === 0 && !flammability(belowId)) {
    w.setBlock(x, y, z, 0);
    return;
  }
  // what it touches burns away: what is over and under it goes more readily than what is beside it
  const eat = (bx: number, by: number, bz: number, chance: number) => {
    const f = flammability(blocks.blockOf(w.getBlock(bx, by, bz)).id);
    if (!f || w.rng.int(chance) >= f.burns) return;
    // vanilla leaves fire where the block was unless the fire is old, or the rain would drown it
    const rained = w.isRaining() && w.getSkyLight(bx, by, bz) > 0;
    if (w.rng.int(older + 10) < 5 && !rained) w.setBlock(bx, by, bz, blocks.stateWith('fire', { age: String(Math.min(15, older + Math.floor(w.rng.int(5) / 4))) }));
    else w.setBlock(bx, by, bz, 0);
  };
  eat(x, y + 1, z, 250);
  eat(x, y - 1, z, 250);
  for (const [dx, dz] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as [number, number][]) eat(x + dx, y, z + dz, 300);
  // and it reaches out to anything nearby that will catch, less readily the higher it is
  for (let ox = -1; ox <= 1; ox++)
    for (let oz = -1; oz <= 1; oz++)
      for (let oy = -1; oy <= 4; oy++) {
        if (ox === 0 && oy === 0 && oz === 0) continue;
        const bx = x + ox;
        const by = y + oy;
        const bz = z + oz;
        if (w.getBlock(bx, by, bz) !== 0) continue;
        let odds = 0;
        for (const [nx, ny, nz] of NEIGHBORS) {
          const f = flammability(blocks.blockOf(w.getBlock(bx + nx, by + ny, bz + nz)).id);
          if (f) odds = Math.max(odds, f.catches);
        }
        if (odds <= 0) continue;
        // vanilla's Normal difficulty is worth seven of these odds
        const chance = Math.floor((odds + 40 + 14) / (older + 30));
        const reach = oy > 1 ? 100 + (oy - 1) * 100 : 100;
        if (chance <= 0 || w.rng.int(reach) > chance) continue;
        if (w.isRaining() && w.getSkyLight(bx, by, bz) > 0) continue;
        w.setBlock(bx, by, bz, blocks.stateWith('fire', { age: String(Math.min(15, older + Math.floor(w.rng.int(5) / 4))) }));
      }
}

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
    if (def.id === 'cocoa') {
      // vanilla moves cocoa on one stage rather than several
      if (age >= 2) return false;
      w.setBlock(x, y, z, blocks.withProp(state, 'age', String(age + 1)));
      return true;
    }
    if (def.id === 'torchflower_crop' || def.id === 'pitcher_crop') {
      const max = def.id === 'torchflower_crop' ? 1 : 4;
      if (age >= max) return false;
      w.setBlock(x, y, z, blocks.withProp(state, 'age', String(Math.min(max, age + 1))));
      ripenFlowerCrop({ w, x, y, z, state, def });
      return true;
    }
    const max = def.id === 'beetroots' || def.id === 'nether_wart' || def.id === 'sweet_berry_bush' ? 3 : 7;
    if (def.id === 'nether_wart' || age >= max) return false;
    w.setBlock(x, y, z, blocks.withProp(state, 'age', String(Math.min(max, age + 2 + w.rng.int(4)))));
    return true;
  }
  if (def.id === 'kelp' || def.id === 'kelp_plant' || def.id === 'cave_vines' || def.id === 'cave_vines_plant'
    || def.id === 'sea_pickle' || def.id === 'seagrass' || def.id === 'moss_block') {
    return boneMealSpread(w, x, y, z, def.id);
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

/**
 * Bone meal on the things that spread rather than ripen: kelp and cave vines put on length, a sea
 * pickle multiplies, seagrass grows tall, and moss creeps over the ground around it.
 */
function boneMealSpread(w: BlockWorld, x: number, y: number, z: number, id: string): boolean {
  if (id === 'kelp' || id === 'kelp_plant') {
    let top = y;
    while (blocks.blockOf(w.getBlock(x, top + 1, z)).id.startsWith('kelp')) top++;
    const above = w.getBlock(x, top + 1, z);
    if (blocks.blockOf(above).id !== 'water') return false;
    w.setBlock(x, top, z, st('kelp_plant'));
    w.setBlock(x, top + 1, z, blocks.stateWith('kelp', { age: String(w.rng.int(25)) }));
    return true;
  }
  if (id === 'cave_vines' || id === 'cave_vines_plant') {
    let bottom = y;
    while (blocks.blockOf(w.getBlock(x, bottom - 1, z)).id.startsWith('cave_vines')) bottom--;
    if (!isAir(w.getBlock(x, bottom - 1, z))) {
      // nowhere to grow: the berries come on instead, which is the other thing bone meal does here
      const state = w.getBlock(x, y, z);
      if (blocks.prop(state, 'berries') === 'false') {
        w.setBlock(x, y, z, blocks.withProp(state, 'berries', 'true'));
        return true;
      }
      return false;
    }
    w.setBlock(x, bottom, z, blocks.stateWith('cave_vines_plant', { berries: 'false' }));
    w.setBlock(x, bottom - 1, z, blocks.stateWith('cave_vines', { age: String(w.rng.int(25)), berries: w.rng.int(9) === 0 ? 'true' : 'false' }));
    return true;
  }
  if (id === 'sea_pickle') {
    const state = w.getBlock(x, y, z);
    const count = Number(blocks.prop(state, 'pickles') ?? '1');
    if (count >= 4) return false;
    w.setBlock(x, y, z, blocks.withProp(state, 'pickles', String(count + 1)));
    return true;
  }
  if (id === 'seagrass') {
    if (blocks.blockOf(w.getBlock(x, y + 1, z)).id !== 'water') return false;
    w.setBlock(x, y, z, blocks.stateWith('tall_seagrass', { half: 'lower' }));
    w.setBlock(x, y + 1, z, blocks.stateWith('tall_seagrass', { half: 'upper' }));
    return true;
  }
  // moss: vanilla spreads it over a small patch of what it will take, with the odd plant on top
  let spread = false;
  for (let i = 0; i < 24; i++) {
    const px = x + w.rng.int(5) - 2;
    const pz = z + w.rng.int(5) - 2;
    for (const py of [y, y + 1, y - 1]) {
      const at = w.getBlock(px, py, pz);
      const atId = at === 0 ? 'air' : blocks.blockOf(at).id;
      if (!SUPPORT_SOIL.has(atId) && atId !== 'stone') continue;
      if (!isAir(w.getBlock(px, py + 1, pz))) break;
      w.setBlock(px, py, pz, st('moss_block'));
      if (w.rng.int(3) === 0) w.setBlock(px, py + 1, pz, st(w.rng.int(2) === 0 ? 'short_grass' : 'moss_carpet'));
      spread = true;
      break;
    }
  }
  return spread;
}
