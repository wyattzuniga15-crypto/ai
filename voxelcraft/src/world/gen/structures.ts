/**
 * Structure placement: vanilla's templates (converted to JSON by `tools/gen-structures.ts`) stamped
 * into the world on vanilla's random spread, one start per spacing×spacing region.
 */
import { blocks } from '../../blocks/registry.ts';
import { Rng, hashPos, mix } from '../../core/rng.ts';
import type { BlockAccess } from './features.ts';

export interface JigsawJson { pos: [number, number, number]; orientation: string; name: string; target: string; pool: string; final: string }
export interface LootSpot { pos: [number, number, number]; table: string }
export interface MobSpot { pos: [number, number, number]; id: string }
export interface TemplateJson { size: [number, number, number]; palette: string[]; blocks: number[]; jigsaws?: JigsawJson[]; loot?: LootSpot[]; mobs?: MobSpot[]; spawners?: MobSpot[] }
export interface PoolEntry { location: string; weight: number; projection: string }
/**
 * A pool alias: a trial chamber decides once per chamber which mobs its spawners hold, by pointing
 * an alias name at a real template pool. `random` picks one target for one alias; `random_group`
 * picks a group of alias/target pairs together, so a chamber's ranged spawners agree with each other.
 */
export type PoolAlias =
  | { type: 'random'; alias: string; targets: { target: string; weight: number }[] }
  | { type: 'random_group'; groups: { weight: number; entries: { alias: string; target: string }[] }[] };

/** One structure of a set: which pool it starts from, how often it is picked, and where it belongs. */
export interface StructureVariant { start: string; weight: number; biomes: string[] }

export interface StructureIndexEntry {
  name: string;
  /** How the structure is placed; `mineshaft` is built in code rather than from templates. */
  placement: 'surface' | 'ocean_floor' | 'jigsaw' | 'mineshaft' | 'desert_pyramid' | 'jungle_temple' | 'swamp_hut' | 'stronghold' | 'buried_treasure';
  spacing: number;
  separation: number;
  salt: number;
  /** Structures spread one per chunk (mineshafts) roll this chance in every chunk instead. */
  frequency?: number;
  /** Ocean ruins scatter more of themselves this far around the one they start with. */
  cluster?: number;
  /** Strongholds are spread in rings round the origin: how many, how far apart, how many per ring. */
  count?: number;
  distance?: number;
  spread?: number;
  pieces: string[];
  biomes: string[];
  /** Pieces that may be placed as the structure itself; the rest are extras the generator adds. */
  main?: string[];
  /** Jigsaw structures: one entry per structure in the set (the five village types), and how far pieces may chain. */
  variants?: StructureVariant[];
  maxDepth?: number;
  /** How far from its start a jigsaw structure may wander (80 blocks for a village, 116 for a city). */
  maxDistance?: number;
  /** Structures built at a fixed depth rather than on the surface: an ancient city sits at y -27. */
  startY?: number;
  startYMax?: number | null;
  /** Pools chosen once per structure rather than per connector (a chamber's spawner contents). */
  aliases?: PoolAlias[];
}

export interface RuntimeTemplate {
  states: Int32Array;
  known: Uint8Array;
  size: [number, number, number];
  blocks: number[];
  jigsaws: JigsawJson[];
  /** Chests and barrels in the piece, with the vanilla loot table that fills them. */
  loot: LootSpot[];
  /** Mobs the piece comes with, such as the drowned that haunt an ocean ruin. */
  mobs: MobSpot[];
  /** Spawners in the piece and the mob each turns (a trial chamber's spawner rooms). */
  spawners: MobSpot[];
  /** Key in the bundle, for pool lookups. */
  key: string;
}

export interface StructureSet extends StructureIndexEntry {
  /** Templates with their palettes resolved to block states (`known` marks entries we can place). */
  templates: RuntimeTemplate[];
  /** The subset a start is picked from: an igloo is always its top, never a basement piece. */
  mainTemplates: RuntimeTemplate[];
  /** How many chunks out from its start a structure can reach, so a chunk knows which starts to ask about. */
  reach: number;
  byKey: Map<string, RuntimeTemplate>;
  pools: Record<string, PoolEntry[]>;
  biomeSet: Set<string>;
  /** Variant biome lists, resolved once. */
  variantBiomes: Set<string>[];
}

/** Parses `id[prop=value,...]` into a block state, or 0 when the block is unknown to us. */
export function parseState(entry: string): number {
  const open = entry.indexOf('[');
  const id = open < 0 ? entry : entry.slice(0, open);
  if (!blocks.has(id)) return 0;
  if (open < 0) return blocks.defaultState(id);
  const props: Record<string, string> = {};
  for (const part of entry.slice(open + 1, -1).split(',')) {
    const eq = part.indexOf('=');
    if (eq > 0) props[part.slice(0, eq)] = part.slice(eq + 1);
  }
  return blocks.stateWith(id, props);
}

const runtimeTemplate = (key: string, t: TemplateJson): RuntimeTemplate => ({
  key,
  size: t.size,
  blocks: t.blocks,
  jigsaws: t.jigsaws ?? [],
  loot: t.loot ?? [],
  mobs: t.mobs ?? [],
  spawners: t.spawners ?? [],
  states: Int32Array.from(t.palette.map(parseState)),
  // air is a real instruction in a template (it hollows the structure out), unknown blocks are not
  known: Uint8Array.from(t.palette.map((e) => (e === 'air' || parseState(e) !== 0 ? 1 : 0))),
});

/**
 * Chunks a structure can reach from its start: its widest piece plus the offset the start is placed
 * at, or for a jigsaw structure the radius its assembly is allowed to wander (80 blocks) plus a piece.
 */
function structureReach(entry: StructureIndexEntry, templates: RuntimeTemplate[]): number {
  // a jigsaw structure wanders as far as its own limit allows, plus the piece that reaches that far
  if (entry.placement === 'jigsaw') return Math.ceil(((entry.maxDistance ?? 80) + 48) / 16);
  // a mineshaft's walk stays inside 80 blocks of its room, and a piece can be 13 more
  if (entry.placement === 'mineshaft') return 7;
  // a stronghold's rooms are kept inside 80 blocks of its staircase, and a room can be 16 more
  if (entry.placement === 'stronghold') return 6;
  // anything else built in code is one piece, and the largest of them (a pyramid) is 21 blocks
  if (!templates.length) return 3;
  let widest = 0;
  for (const t of templates) widest = Math.max(widest, t.size[0], t.size[2]);
  return Math.ceil((widest + (entry.cluster ?? 0) + 8) / 16);
}

export function buildStructureSets(
  index: StructureIndexEntry[],
  templates: Record<string, TemplateJson>,
  pools: Record<string, Record<string, PoolEntry[]>> = {},
): StructureSet[] {
  return index.map((entry) => {
    const built = entry.pieces.map((p) => (templates[p] ? runtimeTemplate(p, templates[p]) : null)).filter((t): t is RuntimeTemplate => !!t);
    const main = entry.main?.length ? built.filter((t) => entry.main!.includes(t.key)) : built;
    return {
      ...entry,
      biomeSet: new Set(entry.biomes),
      templates: built,
      mainTemplates: main.length ? main : built,
      reach: structureReach(entry, built),
      byKey: new Map(built.map((t) => [t.key, t])),
      pools: pools[entry.name] ?? {},
      variantBiomes: (entry.variants ?? []).map((v) => new Set(v.biomes)),
    };
  // a structure with templates needs them loaded; one built in code declares no pieces at all
  }).filter((s) => s.templates.length > 0 || s.pieces.length === 0);
}

/**
 * Vanilla tries the structures of a set in weighted-random order and keeps the first one that
 * belongs in the biome at the start (`ChunkGenerator.tryGenerateStructure`), which is what makes a
 * village in a desert a desert village and one in a taiga a taiga village.
 */
export function pickVariant(set: StructureSet, biome: string, rng: Rng): StructureVariant | null {
  const left = (set.variants ?? []).map((v, i) => ({ v, biomes: set.variantBiomes[i] }));
  let total = left.reduce((sum, e) => sum + Math.max(1, e.v.weight), 0);
  while (left.length) {
    let r = rng.next() * total;
    let i = 0;
    for (; i < left.length - 1; i++) {
      r -= Math.max(1, left[i].v.weight);
      if (r <= 0) break;
    }
    const [entry] = left.splice(i, 1);
    if (entry.biomes.has(biome)) return entry.v;
    total -= Math.max(1, entry.v.weight);
  }
  return null;
}

/**
 * Vanilla `RandomSpreadStructurePlacement`: each spacing×spacing region of chunks gets one start,
 * placed at a random offset inside the region's free part (spacing minus separation).
 */
export function structureStart(seed: number, set: StructureSet, regionX: number, regionZ: number): { cx: number; cz: number } {
  // a spread of one chunk leaves no room to offset into, so every chunk is its own start
  if (set.spacing <= 1) return { cx: regionX, cz: regionZ };
  const rng = new Rng(mix(seed ^ set.salt, regionX, regionZ, 0x57ac));
  const free = Math.max(1, set.spacing - set.separation);
  return { cx: regionX * set.spacing + rng.int(free), cz: regionZ * set.spacing + rng.int(free) };
}

/** Rotates a template-local position into world space (0-3 quarter turns). */
export function rotate(x: number, z: number, sx: number, sz: number, rotation: number): [number, number] {
  switch (rotation & 3) {
    case 1: return [sz - 1 - z, x];
    case 2: return [sx - 1 - x, sz - 1 - z];
    case 3: return [z, sx - 1 - x];
    default: return [x, z];
  }
}

/** Property values that have to be turned with the piece. */
const FACING = ['north', 'east', 'south', 'west'];
const AXIS_ROTATE: Record<string, string> = { x: 'z', z: 'x' };

/** Rotates a block state's facing/axis so a turned template still looks right. */
export function rotateState(state: number, rotation: number): number {
  if ((rotation & 3) === 0 || state === 0) return state;
  const facing = blocks.prop(state, 'facing');
  if (facing) {
    const i = FACING.indexOf(facing);
    if (i >= 0) state = blocks.withProp(state, 'facing', FACING[(i + rotation) & 3]);
  }
  const axis = blocks.prop(state, 'axis');
  if (axis && (rotation & 1) === 1 && AXIS_ROTATE[axis]) state = blocks.withProp(state, 'axis', AXIS_ROTATE[axis]);
  const rot = blocks.prop(state, 'rotation');
  if (rot) state = blocks.withProp(state, 'rotation', String((Number(rot) + rotation * 4) & 15));
  // fences, walls and panes carry a connection flag per side
  if (rotation) {
    const sides = FACING.map((f) => blocks.prop(state, f)).filter((v) => v !== undefined);
    if (sides.length === 4) {
      const turned = FACING.map((_, i) => blocks.prop(state, FACING[(i - rotation + 8) & 3])!);
      for (let i = 0; i < 4; i++) state = blocks.withProp(state, FACING[i], turned[i]);
    }
  }
  return state;
}

export interface StructurePlacement {
  set: StructureSet;
  template: StructureSet['templates'][number];
  /** World position of the template's (0,0,0) corner. */
  x: number;
  y: number;
  z: number;
  rotation: number;
  /** Fraction of blocks kept; ruined portals decay like vanilla's block_rot processor. */
  integrity: number;
  /** Seed for the decay hash, so a piece crumbles the same however its chunks are visited. */
  decaySeed: number;
  /** Terrain fitting to apply under the piece: ocean pieces keep their water. */
  placement?: string;
}

/** World box a placed piece covers, once its rotation has been taken into account. */
export function placementBox(p: StructurePlacement): { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number } {
  const [sx, sy, sz] = p.template.size;
  const [w, d] = (p.rotation & 1) === 1 ? [sz, sx] : [sx, sz];
  return { x0: p.x, y0: p.y, z0: p.z, x1: p.x + w - 1, y1: p.y + sy - 1, z1: p.z + d - 1 };
}

/** Column range a stamp may write in, so a chunk only ever writes its own blocks. */
export interface ClipBox { x0: number; x1: number; z0: number; z1: number }

/**
 * Writes one placed structure into the world, clipped to the columns the caller asks for.
 * Returns the positions written so the caller can adapt the terrain around them.
 */
/** What a stamp reports back: the blocks it wrote, and the block entities and mobs it wants. */
export interface StampHooks {
  /** Positions written, so the caller can adapt the terrain around them. */
  written?: Set<string>;
  /** Columns the stamp may write in; everything outside is left to the chunk that owns it. */
  clip?: ClipBox;
  onLoot?: (x: number, y: number, z: number, table: string) => void;
  onEntity?: (x: number, y: number, z: number, mob: string) => void;
  onSpawner?: (x: number, y: number, z: number, mob: string) => void;
}

export function stampStructure(world: BlockAccess, p: StructurePlacement, hooks: StampHooks = {}): number {
  const { written, clip, onLoot, onEntity, onSpawner } = hooks;
  const { template, rotation } = p;
  const [sx, , sz] = template.size;
  const inside = (x: number, z: number) => !clip || (x >= clip.x0 && x <= clip.x1 && z >= clip.z0 && z <= clip.z1);
  let placed = 0;
  for (const spot of template.loot) {
    const [rx, rz] = rotate(spot.pos[0], spot.pos[2], sx, sz, rotation);
    if (inside(p.x + rx, p.z + rz)) onLoot?.(p.x + rx, p.y + spot.pos[1], p.z + rz, spot.table);
  }
  for (const spot of template.mobs) {
    const [rx, rz] = rotate(spot.pos[0], spot.pos[2], sx, sz, rotation);
    if (inside(p.x + rx, p.z + rz)) onEntity?.(p.x + rx, p.y + spot.pos[1], p.z + rz, spot.id);
  }
  for (const spot of template.spawners) {
    const [rx, rz] = rotate(spot.pos[0], spot.pos[2], sx, sz, rotation);
    if (inside(p.x + rx, p.z + rz)) onSpawner?.(p.x + rx, p.y + spot.pos[1], p.z + rz, spot.id);
  }
  for (let i = 0; i < template.blocks.length; i += 4) {
    const lx = template.blocks[i];
    const ly = template.blocks[i + 1];
    const lz = template.blocks[i + 2];
    const entry = template.blocks[i + 3];
    if (!template.known[entry]) continue;
    const [rx, rz] = rotate(lx, lz, sx, sz, rotation);
    const x = p.x + rx;
    const z = p.z + rz;
    if (!inside(x, z)) continue;
    // decay is hashed from the position, not drawn in template order, so clipping cannot change it
    if (p.integrity < 1 && hashPos(p.decaySeed, x, p.y + ly, z) > p.integrity) continue;
    world.set(x, p.y + ly, z, rotateState(template.states[entry], rotation));
    written?.add(`${x},${p.y + ly},${z}`);
    placed++;
  }
  return placed;
}

// -------------------------------------------------------------------------------------------
// Jigsaw assembly (villages)
// -------------------------------------------------------------------------------------------

/** Horizontal jigsaw fronts, in the rotation order used above. */
const HORIZONTAL: Record<string, number> = { north: 0, east: 1, south: 2, west: 3 };
const DIR_VECTORS: [number, number, number][] = [[0, 0, -1], [1, 0, 0], [0, 0, 1], [-1, 0, 0]];

/** Front face a jigsaw block points at, from its `orientation` property (`front_top`). */
export function jigsawFront(orientation: string): string {
  return orientation.split('_')[0];
}

export interface PlacedPiece {
  template: RuntimeTemplate;
  x: number;
  y: number;
  z: number;
  rotation: number;
  box: { x0: number; y0: number; z0: number; x1: number; y1: number; z1: number };
}

const boxOf = (t: RuntimeTemplate, x: number, y: number, z: number, rotation: number) => {
  const [sx, sy, sz] = t.size;
  const [w, d] = (rotation & 1) === 1 ? [sz, sx] : [sx, sz];
  return { x0: x, y0: y, z0: z, x1: x + w - 1, y1: y + sy - 1, z1: z + sz * 0 + d - 1 };
};

const overlaps = (a: PlacedPiece['box'], b: PlacedPiece['box']): boolean =>
  a.x0 <= b.x1 && a.x1 >= b.x0 && a.y0 <= b.y1 && a.y1 >= b.y0 && a.z0 <= b.z1 && a.z1 >= b.z0;

const contains = (outer: PlacedPiece['box'], inner: PlacedPiece['box']): boolean =>
  outer.x0 <= inner.x0 && outer.x1 >= inner.x1 && outer.y0 <= inner.y0 && outer.y1 >= inner.y1 && outer.z0 <= inner.z0 && outer.z1 >= inner.z1;

/**
 * Whether a candidate may go where it wants. Vanilla tracks the free space inside each piece and
 * lets a child sit in it, which is how a trial chamber's spawners and decorations end up inside the
 * room they belong to; anything that merely runs into another piece is rejected.
 */
function fits(placed: PlacedPiece[], parent: PlacedPiece, box: PlacedPiece['box']): boolean {
  // only a small fitting may sit inside a room; a room-sized piece has to find space of its own
  const small = box.x1 - box.x0 <= 6 && box.z1 - box.z0 <= 6 && box.y1 - box.y0 <= 6;
  if (small && placed.some((p) => contains(p.box, box))) return true;
  return !placed.some((p) => p !== parent && overlaps(p.box, box));
}

/** World position of a jigsaw block once its piece has been rotated and placed. */
function jigsawWorld(piece: PlacedPiece, j: JigsawJson): { x: number; y: number; z: number; front: number } {
  const [sx, , sz] = piece.template.size;
  const [rx, rz] = rotate(j.pos[0], j.pos[2], sx, sz, piece.rotation);
  const front = HORIZONTAL[jigsawFront(j.orientation)];
  return { x: piece.x + rx, y: piece.y + j.pos[1], z: piece.z + rz, front: front === undefined ? -1 : (front + piece.rotation) & 3 };
}

/** The pools a structure's aliases stand for this time round, rolled once per structure. */
export function resolveAliases(set: StructureSet, rng: Rng): Map<string, string> {
  const out = new Map<string, string>();
  for (const alias of set.aliases ?? []) {
    if (alias.type === 'random') {
      let total = 0;
      for (const t of alias.targets) total += Math.max(1, t.weight);
      let r = rng.next() * total;
      for (const t of alias.targets) {
        r -= Math.max(1, t.weight);
        if (r <= 0) {
          out.set(alias.alias, t.target);
          break;
        }
      }
      continue;
    }
    let total = 0;
    for (const g of alias.groups) total += Math.max(1, g.weight);
    let r = rng.next() * total;
    for (const g of alias.groups) {
      r -= Math.max(1, g.weight);
      if (r <= 0) {
        for (const e of g.entries) out.set(e.alias, e.target);
        break;
      }
    }
  }
  return out;
}

/** Weighted pick from a template pool, skipping entries whose template we do not have. */
function pickFromPool(set: StructureSet, poolName: string, rng: Rng, aliases?: Map<string, string>): RuntimeTemplate | null {
  const pool = aliases?.get(poolName) ?? poolName;
  const entries = (set.pools[pool] ?? []).filter((e) => set.byKey.has(e.location.replace(/\//g, '_')));
  if (!entries.length) return null;
  let total = 0;
  for (const e of entries) total += Math.max(1, e.weight);
  let r = rng.next() * total;
  for (const e of entries) {
    r -= Math.max(1, e.weight);
    if (r <= 0) return set.byKey.get(e.location.replace(/\//g, '_')) ?? null;
  }
  return set.byKey.get(entries[entries.length - 1].location.replace(/\//g, '_')) ?? null;
}

/**
 * Vanilla lets a jigsaw block point up or down as well as sideways, which is how a chamber stacks on
 * another or a village house takes its roof. The child is placed so its own connector sits directly
 * over or under this one, at whatever horizontal turn leaves it room.
 */
function attachVertical(
  set: StructureSet,
  placed: PlacedPiece[],
  parent: PlacedPiece,
  j: JigsawJson,
  from: { x: number; y: number; z: number },
  rng: Rng,
  aliases: Map<string, string>,
  trace?: (msg: string) => void,
): PlacedPiece | null {
  const up = jigsawFront(j.orientation) === 'up';
  const wantFront = up ? 'down' : 'up';
  for (let attempt = 0; attempt < 4; attempt++) {
    const template = pickFromPool(set, j.pool, rng, aliases);
    if (!template) return null;
    const targets = template.jigsaws.filter((t) => t.name === j.target && jigsawFront(t.orientation) === wantFront);
    if (!targets.length) {
      trace?.(`no vertical connector '${j.target}' in ${template.key}`);
      continue;
    }
    const target = targets[rng.int(targets.length)];
    const rot = rng.int(4);
    const [tsx, , tsz] = template.size;
    const [trx, trz] = rotate(target.pos[0], target.pos[2], tsx, tsz, rot);
    const px = from.x - trx;
    const py = from.y + (up ? 1 : -1) - target.pos[1];
    const pz = from.z - trz;
    const box = boxOf(template, px, py, pz, rot);
    if (!fits(placed, parent, box)) {
      trace?.(`overlap stacking ${template.key} on ${parent.template.key}`);
      continue;
    }
    const child: PlacedPiece = { template, x: px, y: py, z: pz, rotation: rot, box };
    placed.push(child);
    return child;
  }
  return null;
}

/**
 * Vanilla's jigsaw assembly, simplified: start from a piece of the start pool, then walk its jigsaw
 * blocks outward, attaching a piece from each connector's target pool so the two jigsaws meet face
 * to face. Pieces that would overlap something already placed are skipped, and the chain stops at
 * the structure's depth (six for villages).
 */
export function assembleJigsaw(set: StructureSet, startPool: string, x: number, y: number, z: number, rng: Rng, trace?: (msg: string) => void): PlacedPiece[] {
  // which pools this structure's aliases stand for is decided once, before anything is placed
  const aliases = resolveAliases(set, rng);
  const start = pickFromPool(set, startPool, rng, aliases);
  if (!start) return [];
  const rotation = rng.int(4);
  const placed: PlacedPiece[] = [{ template: start, x, y, z, rotation, box: boxOf(start, x, y, z, rotation) }];
  const maxDepth = set.maxDepth ?? 6;
  const maxDistance = set.maxDistance ?? 80;
  let queue: { piece: PlacedPiece; depth: number }[] = [{ piece: placed[0], depth: 0 }];
  while (queue.length) {
    const next: typeof queue = [];
    for (const { piece, depth } of queue) {
      if (depth >= maxDepth) continue;
      // vanilla shuffles a piece's connectors, which is what stops the streets from taking every slot
      const connectors = piece.template.jigsaws.slice();
      for (let i = connectors.length - 1; i > 0; i--) {
        const k = rng.int(i + 1);
        [connectors[i], connectors[k]] = [connectors[k], connectors[i]];
      }
      for (const j of connectors) {
        const from = jigsawWorld(piece, j);
        if (from.front < 0) {
          // a connector pointing up or down stacks the next piece straight above or below this one
          const child = attachVertical(set, placed, piece, j, from, rng, aliases, trace);
          if (child) next.push({ piece: child, depth: depth + 1 });
          continue;
        }
        const [dx, , dz] = DIR_VECTORS[from.front];
        if (Math.abs(from.x + dx - x) > maxDistance || Math.abs(from.z + dz - z) > maxDistance) continue;
        const candidates = (set.pools[aliases.get(j.pool) ?? j.pool] ?? []).length;
        if (!candidates) {
          trace?.(`no pool ${j.pool}`);
          continue;
        }
        // a few tries to find a piece that fits without overlapping what is already there
        for (let attempt = 0; attempt < 6; attempt++) {
          const template = pickFromPool(set, j.pool, rng, aliases);
          if (!template) {
            trace?.(`empty pool ${j.pool}`);
            break;
          }
          const targets = template.jigsaws.filter((t) => t.name === j.target && HORIZONTAL[jigsawFront(t.orientation)] !== undefined);
          if (!targets.length) {
            trace?.(`no connector '${j.target}' in ${template.key}`);
            continue;
          }
          const target = targets[rng.int(targets.length)];
          const targetFront = HORIZONTAL[jigsawFront(target.orientation)];
          // rotate the candidate so its connector faces back along ours
          const wantFront = (from.front + 2) & 3;
          const rot = (wantFront - targetFront + 4) & 3;
          const [tsx, , tsz] = template.size;
          const [trx, trz] = rotate(target.pos[0], target.pos[2], tsx, tsz, rot);
          const px = from.x + dx - trx;
          const py = from.y - target.pos[1];
          const pz = from.z + dz - trz;
          const box = boxOf(template, px, py, pz, rot);
          // vanilla checks a candidate against the space its parent leaves free, so a house may
          // share the edge of the street piece it hangs off, but not run into anything else
          if (!fits(placed, piece, box)) {
            trace?.(`overlap placing ${template.key} from ${piece.template.key}`);
            continue;
          }
          const child: PlacedPiece = { template, x: px, y: py, z: pz, rotation: rot, box };
          placed.push(child);
          next.push({ piece: child, depth: depth + 1 });
          break;
        }
      }
    }
    queue = next;
  }
  return placed;
}
