/**
 * Structure placement: vanilla's templates (converted to JSON by `tools/gen-structures.ts`) stamped
 * into the world on vanilla's random spread, one start per spacing×spacing region.
 */
import { blocks } from '../../blocks/registry.ts';
import { Rng, mix } from '../../core/rng.ts';
import type { BlockAccess } from './features.ts';

export interface JigsawJson { pos: [number, number, number]; orientation: string; name: string; target: string; pool: string; final: string }
export interface TemplateJson { size: [number, number, number]; palette: string[]; blocks: number[]; jigsaws?: JigsawJson[] }
export interface PoolEntry { location: string; weight: number; projection: string }
export interface StructureIndexEntry {
  name: string;
  placement: 'surface' | 'ocean_floor' | 'jigsaw';
  spacing: number;
  separation: number;
  salt: number;
  pieces: string[];
  biomes: string[];
  /** Jigsaw structures: the pools a village can start from, and how far pieces may chain. */
  starts?: string[];
  maxDepth?: number;
}

export interface RuntimeTemplate {
  states: Int32Array;
  known: Uint8Array;
  size: [number, number, number];
  blocks: number[];
  jigsaws: JigsawJson[];
  /** Key in the bundle, for pool lookups. */
  key: string;
}

export interface StructureSet extends StructureIndexEntry {
  /** Templates with their palettes resolved to block states (`known` marks entries we can place). */
  templates: RuntimeTemplate[];
  byKey: Map<string, RuntimeTemplate>;
  pools: Record<string, PoolEntry[]>;
  biomeSet: Set<string>;
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
  states: Int32Array.from(t.palette.map(parseState)),
  // air is a real instruction in a template (it hollows the structure out), unknown blocks are not
  known: Uint8Array.from(t.palette.map((e) => (e === 'air' || parseState(e) !== 0 ? 1 : 0))),
});

export function buildStructureSets(
  index: StructureIndexEntry[],
  templates: Record<string, TemplateJson>,
  pools: Record<string, Record<string, PoolEntry[]>> = {},
): StructureSet[] {
  return index.map((entry) => {
    const built = entry.pieces.map((p) => (templates[p] ? runtimeTemplate(p, templates[p]) : null)).filter((t): t is RuntimeTemplate => !!t);
    return {
      ...entry,
      biomeSet: new Set(entry.biomes),
      templates: built,
      byKey: new Map(built.map((t) => [t.key, t])),
      pools: pools[entry.name] ?? {},
    };
  }).filter((s) => s.templates.length > 0);
}

/**
 * Vanilla `RandomSpreadStructurePlacement`: each spacing×spacing region of chunks gets one start,
 * placed at a random offset inside the region's free part (spacing minus separation).
 */
export function structureStart(seed: number, set: StructureSet, regionX: number, regionZ: number): { cx: number; cz: number } {
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
  rng: Rng;
}

/**
 * Writes one placed structure into the world, clipped to whatever chunks the access covers.
 * Returns the positions written so the caller can adapt the terrain around them.
 */
export function stampStructure(world: BlockAccess, p: StructurePlacement, written?: Set<string>): number {
  const { template, rotation } = p;
  const [sx, , sz] = template.size;
  let placed = 0;
  for (let i = 0; i < template.blocks.length; i += 4) {
    const lx = template.blocks[i];
    const ly = template.blocks[i + 1];
    const lz = template.blocks[i + 2];
    const entry = template.blocks[i + 3];
    if (!template.known[entry]) continue;
    const state = template.states[entry];
    if (p.integrity < 1 && p.rng.next() > p.integrity) continue;
    const [rx, rz] = rotate(lx, lz, sx, sz, rotation);
    world.set(p.x + rx, p.y + ly, p.z + rz, rotateState(state, rotation));
    written?.add(`${p.x + rx},${p.y + ly},${p.z + rz}`);
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

/** World position of a jigsaw block once its piece has been rotated and placed. */
function jigsawWorld(piece: PlacedPiece, j: JigsawJson): { x: number; y: number; z: number; front: number } {
  const [sx, , sz] = piece.template.size;
  const [rx, rz] = rotate(j.pos[0], j.pos[2], sx, sz, piece.rotation);
  const front = HORIZONTAL[jigsawFront(j.orientation)];
  return { x: piece.x + rx, y: piece.y + j.pos[1], z: piece.z + rz, front: front === undefined ? -1 : (front + piece.rotation) & 3 };
}

/** Weighted pick from a template pool, skipping entries whose template we do not have. */
function pickFromPool(set: StructureSet, pool: string, rng: Rng): RuntimeTemplate | null {
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
 * Vanilla's jigsaw assembly, simplified: start from a piece of the start pool, then walk its jigsaw
 * blocks outward, attaching a piece from each connector's target pool so the two jigsaws meet face
 * to face. Pieces that would overlap something already placed are skipped, and the chain stops at
 * the structure's depth (six for villages).
 */
export function assembleJigsaw(set: StructureSet, startPool: string, x: number, y: number, z: number, rng: Rng, trace?: (msg: string) => void): PlacedPiece[] {
  const start = pickFromPool(set, startPool, rng);
  if (!start) return [];
  const rotation = rng.int(4);
  const placed: PlacedPiece[] = [{ template: start, x, y, z, rotation, box: boxOf(start, x, y, z, rotation) }];
  const maxDepth = set.maxDepth ?? 6;
  const maxDistance = 80;
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
        if (from.front < 0) continue; // vertical connectors (iron golem spawns) are ignored
        const [dx, , dz] = DIR_VECTORS[from.front];
        if (Math.abs(from.x + dx - x) > maxDistance || Math.abs(from.z + dz - z) > maxDistance) continue;
        const candidates = (set.pools[j.pool] ?? []).length;
        if (!candidates) {
          trace?.(`no pool ${j.pool}`);
          continue;
        }
        // a few tries to find a piece that fits without overlapping what is already there
        for (let attempt = 0; attempt < 6; attempt++) {
          const template = pickFromPool(set, j.pool, rng);
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
          if (placed.some((p) => p !== piece && overlaps(p.box, box))) {
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
