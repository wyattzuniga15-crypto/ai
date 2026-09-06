/**
 * Block behaviours: what happens on use, on neighbour changes, on random ticks and on scheduled
 * ticks. Dispatched by block id first, then by the `behavior` field from data/blocks.json.
 */
import { blocks, type BlockDef } from './registry.ts';
import type { Rng } from '../core/rng.ts';
import { LAVA_DELAY, WATER_DELAY, tickFluid, type FluidWorld } from '../world/fluids.ts';
import { placeTree, type BlockAccess } from '../world/gen/features.ts';
import { SEA_LEVEL } from '../core/constants.ts';

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
        if (o === 0 || blocks.blockOf(o).id !== ctx.def.id) ctx.w.setBlock(ctx.x, ctx.y, ctx.z, 0);
      }
    },
  },
  trapdoor: {
    onUse: (ctx) => {
      if (ctx.def.id === 'iron_trapdoor') return false;
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'open', blocks.prop(ctx.state, 'open') === 'true' ? 'false' : 'true'));
      return true;
    },
  },
  fence_gate: {
    onUse: (ctx) => {
      ctx.w.setBlock(ctx.x, ctx.y, ctx.z, blocks.withProp(ctx.state, 'open', blocks.prop(ctx.state, 'open') === 'true' ? 'false' : 'true'));
      return true;
    },
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

const byId: Record<string, Behavior> = {
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
