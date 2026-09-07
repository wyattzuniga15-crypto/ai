/**
 * Structure placement: vanilla's templates (converted to JSON by `tools/gen-structures.ts`) stamped
 * into the world on vanilla's random spread, one start per spacing×spacing region.
 */
import { blocks } from '../../blocks/registry.ts';
import { Rng, mix } from '../../core/rng.ts';
import type { BlockAccess } from './features.ts';

export interface TemplateJson { size: [number, number, number]; palette: string[]; blocks: number[] }
export interface StructureIndexEntry {
  name: string;
  placement: 'surface' | 'ocean_floor';
  spacing: number;
  separation: number;
  salt: number;
  pieces: string[];
  biomes: string[];
}

export interface StructureSet extends StructureIndexEntry {
  /** Templates with their palettes resolved to block states (`known` marks entries we can place). */
  templates: { states: Int32Array; known: Uint8Array; size: [number, number, number]; blocks: number[] }[];
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

export function buildStructureSets(index: StructureIndexEntry[], templates: Record<string, TemplateJson>): StructureSet[] {
  return index.map((entry) => ({
    ...entry,
    biomeSet: new Set(entry.biomes),
    templates: entry.pieces
      .map((p) => templates[p])
      .filter((t): t is TemplateJson => !!t)
      .map((t) => ({
        size: t.size,
        blocks: t.blocks,
        states: Int32Array.from(t.palette.map(parseState)),
        // air is a real instruction in a template (it hollows the structure out), unknown blocks are not
        known: Uint8Array.from(t.palette.map((e) => (e === 'air' || parseState(e) !== 0 ? 1 : 0))),
      })),
  })).filter((s) => s.templates.length > 0);
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
