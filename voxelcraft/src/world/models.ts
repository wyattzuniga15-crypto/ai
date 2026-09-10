/**
 * Bakes vanilla block models (blockstates + models JSON) into flat quad lists per block state.
 * Implements the resource-pack model format: parent chains, texture variables, element rotation
 * with rescale, variant x/y rotation, uvlock, face uv rotation, random weighted variants and
 * multipart conditions. Runs in the mesh worker and (for item icons) on the main thread.
 */
import { blocks } from '../blocks/registry.ts';
import type { AtlasIndex } from '../render/atlasIndex.ts';

export interface ModelJson {
  parent?: string;
  ambientocclusion?: boolean;
  textures?: Record<string, string>;
  elements?: ElementJson[];
  display?: Record<string, { rotation?: number[]; translation?: number[]; scale?: number[] }>;
  gui_light?: string;
}

export interface ElementJson {
  from: [number, number, number];
  to: [number, number, number];
  rotation?: { origin: [number, number, number]; axis: 'x' | 'y' | 'z'; angle: number; rescale?: boolean };
  shade?: boolean;
  light_emission?: number;
  faces: Partial<Record<FaceName, FaceJson>>;
}

export interface FaceJson {
  uv?: [number, number, number, number];
  texture: string;
  cullface?: FaceName;
  rotation?: number;
  tintindex?: number;
}

export type FaceName = 'down' | 'up' | 'north' | 'south' | 'west' | 'east';

export interface VariantJson {
  model: string;
  x?: number;
  y?: number;
  uvlock?: boolean;
  weight?: number;
}

export interface BlockstateJson {
  variants?: Record<string, VariantJson | VariantJson[]>;
  multipart?: { when?: Record<string, unknown>; apply: VariantJson | VariantJson[] }[];
}

export interface ModelsJson {
  blockstates: Record<string, BlockstateJson>;
  models: Record<string, ModelJson>;
}

/** Direction indices used throughout the engine. */
export const DIR_DOWN = 0;
export const DIR_UP = 1;
export const DIR_NORTH = 2;
export const DIR_SOUTH = 3;
export const DIR_WEST = 4;
export const DIR_EAST = 5;
export const FACE_NAMES: FaceName[] = ['down', 'up', 'north', 'south', 'west', 'east'];
export const DIR_OFFSETS: [number, number, number][] = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]];
/** Vanilla directional shading. */
export const FACE_SHADE = [0.5, 1.0, 0.8, 0.8, 0.6, 0.6];

export interface BakedQuad {
  /** 12 floats: 4 vertices in block units (0..1, may exceed slightly for rescaled elements). */
  pos: Float32Array;
  /** 8 floats: tile-relative uv per vertex (0..1). */
  uv: Float32Array;
  /** Atlas tile id. */
  tile: number;
  /** Texture name (for the item icon renderer and debugging). */
  texture: string;
  /** Direction whose neighbour can cull this quad, or -1. */
  cull: number;
  /** Closest axis direction of the quad normal (for shading and light sampling). */
  dir: number;
  /** True when the quad covers the full block face on the block boundary in `dir`. */
  full: boolean;
  tint: number;
  shade: boolean;
}

export interface BakedModel {
  quads: BakedQuad[];
  ao: boolean;
  /** Bitmask of directions covered by a full opaque face. */
  fullFaces: number;
  /** Cached by the mesher: exactly six unit faces, so the greedy pass may merge them. */
  greedy?: boolean;
}

const EMPTY_MODEL: BakedModel = { quads: [], ao: true, fullFaces: 0 };

interface ResolvedModel {
  textures: Record<string, string>;
  elements: ElementJson[];
  ao: boolean;
  display?: ModelJson['display'];
  chain: string[];
}

function faceIndex(name: FaceName | string): number {
  switch (name) {
    case 'down': return 0;
    case 'up': return 1;
    case 'north': return 2;
    case 'south': return 3;
    case 'west': return 4;
    default: return 5;
  }
}

/** Corner order per face: top-left, bottom-left, bottom-right, top-right as seen from outside. */
function faceCorners(d: number, x1: number, y1: number, z1: number, x2: number, y2: number, z2: number): number[] {
  switch (d) {
    case 0: return [x1, y1, z2, x1, y1, z1, x2, y1, z1, x2, y1, z2];
    case 1: return [x1, y2, z1, x1, y2, z2, x2, y2, z2, x2, y2, z1];
    case 2: return [x2, y2, z1, x2, y1, z1, x1, y1, z1, x1, y2, z1];
    case 3: return [x1, y2, z2, x1, y1, z2, x2, y1, z2, x2, y2, z2];
    case 4: return [x1, y2, z1, x1, y1, z1, x1, y1, z2, x1, y2, z2];
    default: return [x2, y2, z2, x2, y1, z2, x2, y1, z1, x2, y2, z1];
  }
}

function defaultUv(d: number, from: number[], to: number[]): [number, number, number, number] {
  switch (d) {
    case 0: return [from[0], 16 - to[2], to[0], 16 - from[2]];
    case 1: return [from[0], from[2], to[0], to[2]];
    case 2: return [16 - to[0], 16 - to[1], 16 - from[0], 16 - from[1]];
    case 3: return [from[0], 16 - to[1], to[0], 16 - from[1]];
    case 4: return [from[2], 16 - to[1], to[2], 16 - from[1]];
    default: return [16 - to[2], 16 - to[1], 16 - from[2], 16 - from[1]];
  }
}

/** Rotates a point about an origin around an axis (degrees). */
function rotatePoint(p: number[], origin: number[], axis: string, deg: number, rescale = false): void {
  const rad = (deg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  let x = p[0] - origin[0];
  let y = p[1] - origin[1];
  let z = p[2] - origin[2];
  let scale = 1;
  if (rescale) scale = 1 / Math.cos(rad);
  if (axis === 'x') {
    const ny = y * c - z * s;
    const nz = y * s + z * c;
    y = ny * scale;
    z = nz * scale;
  } else if (axis === 'y') {
    const nx = x * c + z * s;
    const nz = -x * s + z * c;
    x = nx * scale;
    z = nz * scale;
  } else {
    const nx = x * c - y * s;
    const ny = x * s + y * c;
    x = nx * scale;
    y = ny * scale;
  }
  p[0] = x + origin[0];
  p[1] = y + origin[1];
  p[2] = z + origin[2];
}

function rotateDir(d: number, axis: 'x' | 'y', deg: number): number {
  const steps = ((deg / 90) % 4 + 4) % 4;
  let r = d;
  for (let i = 0; i < steps; i++) {
    if (axis === 'y') {
      // rotation by -90 about y: north -> east -> south -> west
      r = r === DIR_NORTH ? DIR_EAST : r === DIR_EAST ? DIR_SOUTH : r === DIR_SOUTH ? DIR_WEST : r === DIR_WEST ? DIR_NORTH : r;
    } else {
      // rotation by -90 about x: up -> north -> down -> south
      r = r === DIR_UP ? DIR_NORTH : r === DIR_NORTH ? DIR_DOWN : r === DIR_DOWN ? DIR_SOUTH : r === DIR_SOUTH ? DIR_UP : r;
    }
  }
  return r;
}

function quadNormalDir(pos: Float32Array): number {
  const ax = pos[3] - pos[0], ay = pos[4] - pos[1], az = pos[5] - pos[2];
  const bx = pos[6] - pos[0], by = pos[7] - pos[1], bz = pos[8] - pos[2];
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const ax2 = Math.abs(nx), ay2 = Math.abs(ny), az2 = Math.abs(nz);
  if (ay2 >= ax2 && ay2 >= az2) return ny > 0 ? DIR_UP : DIR_DOWN;
  if (ax2 >= az2) return nx > 0 ? DIR_EAST : DIR_WEST;
  return nz > 0 ? DIR_SOUTH : DIR_NORTH;
}

function isFullFace(pos: Float32Array, d: number): boolean {
  const eps = 1e-4;
  const axis = d < 2 ? 1 : d < 4 ? 2 : 0;
  const plane = d === 0 || d === 2 || d === 4 ? 0 : 1;
  let minA = Infinity, maxA = -Infinity, minB = Infinity, maxB = -Infinity;
  const a = axis === 0 ? 1 : 0;
  const b = axis === 2 ? 1 : 2;
  for (let i = 0; i < 4; i++) {
    if (Math.abs(pos[i * 3 + axis] - plane) > eps) return false;
    const va = pos[i * 3 + a];
    const vb = pos[i * 3 + b];
    minA = Math.min(minA, va); maxA = Math.max(maxA, va);
    minB = Math.min(minB, vb); maxB = Math.max(maxB, vb);
  }
  return minA <= eps && maxA >= 1 - eps && minB <= eps && maxB >= 1 - eps;
}

export class ModelBaker {
  private readonly resolved = new Map<string, ResolvedModel | null>();
  private readonly baked = new Map<string, BakedModel>();
  private readonly stateCache = new Map<number, { weight: number; model: BakedModel }[]>();

  constructor(readonly data: ModelsJson, readonly atlas: AtlasIndex) {}

  /** Follows the parent chain and merges textures/elements the way vanilla does. */
  resolve(name: string): ResolvedModel | null {
    const cached = this.resolved.get(name);
    if (cached !== undefined) return cached;
    const chain: string[] = [];
    let textures: Record<string, string> = {};
    let elements: ElementJson[] | undefined;
    let ao = true;
    let display: ModelJson['display'];
    let cur: string | undefined = name;
    let guard = 0;
    while (cur && guard++ < 32) {
      const m: ModelJson | undefined = this.data.models[cur];
      chain.push(cur);
      if (!m) break;
      textures = { ...(m.textures ?? {}), ...textures };
      if (!elements && m.elements) elements = m.elements;
      if (m.ambientocclusion === false) ao = false;
      if (!display && m.display) display = m.display;
      cur = m.parent;
    }
    if (!this.data.models[name]) {
      this.resolved.set(name, null);
      return null;
    }
    // resolve texture variables (#name -> texture path)
    const out: Record<string, string> = {};
    for (const key of Object.keys(textures)) {
      let v = textures[key];
      let g = 0;
      while (g++ < 16) {
        if (v.startsWith('#')) v = textures[v.slice(1)] ?? 'missingno';
        else if (textures[v] !== undefined && textures[v] !== v) v = textures[v];
        else break;
      }
      out[key] = v;
    }
    const r: ResolvedModel = { textures: out, elements: elements ?? [], ao, display, chain };
    this.resolved.set(name, r);
    return r;
  }

  /**
   * The texture a face asks for. Most of Mojang's models name a slot with a hash — `#all` — but a
   * few of the newer ones write the bare slot name instead, and vanilla resolves that against the
   * model's own slots either way. Anything that is neither a slot nor a hash is a texture path.
   */
  textureFor(model: ResolvedModel, ref: string): string {
    let v = ref;
    let g = 0;
    while (g++ < 16) {
      if (v.startsWith('#')) v = model.textures[v.slice(1)] ?? 'missingno';
      else if (model.textures[v] !== undefined && model.textures[v] !== v) v = model.textures[v];
      else break;
    }
    return v;
  }

  /** Bakes one model with a variant transform. Cached by (model, x, y, uvlock). */
  bake(modelName: string, rx = 0, ry = 0, uvlock = false): BakedModel {
    const key = `${modelName}|${rx}|${ry}|${uvlock ? 1 : 0}`;
    const cached = this.baked.get(key);
    if (cached) return cached;
    const model = this.resolve(modelName);
    const quads: BakedQuad[] = [];
    let fullFaces = 0;
    if (model) {
      for (const el of model.elements) {
        const from = el.from;
        const to = el.to;
        for (const faceName of Object.keys(el.faces) as FaceName[]) {
          const face = el.faces[faceName];
          if (!face) continue;
          const d = faceIndex(faceName);
          const corners = faceCorners(d, from[0], from[1], from[2], to[0], to[1], to[2]);
          const uvRect = face.uv ?? defaultUv(d, from, to);
          // uv per corner: top-left, bottom-left, bottom-right, top-right
          let uvs = [uvRect[0], uvRect[1], uvRect[0], uvRect[3], uvRect[2], uvRect[3], uvRect[2], uvRect[1]];
          const rot = ((face.rotation ?? 0) / 90) | 0;
          for (let i = 0; i < rot; i++) uvs = [uvs[2], uvs[3], uvs[4], uvs[5], uvs[6], uvs[7], uvs[0], uvs[1]];
          const pts: number[][] = [];
          for (let i = 0; i < 4; i++) {
            const p = [corners[i * 3], corners[i * 3 + 1], corners[i * 3 + 2]];
            if (el.rotation) rotatePoint(p, el.rotation.origin, el.rotation.axis, el.rotation.angle, el.rotation.rescale);
            if (rx) rotatePoint(p, [8, 8, 8], 'x', -rx);
            if (ry) rotatePoint(p, [8, 8, 8], 'y', -ry);
            pts.push(p);
          }
          const pos = new Float32Array(12);
          for (let i = 0; i < 4; i++) {
            pos[i * 3] = pts[i][0] / 16;
            pos[i * 3 + 1] = pts[i][1] / 16;
            pos[i * 3 + 2] = pts[i][2] / 16;
          }
          let cull = face.cullface ? faceIndex(face.cullface) : -1;
          if (cull >= 0) {
            if (rx) cull = rotateDir(cull, 'x', rx);
            if (ry) cull = rotateDir(cull, 'y', ry);
          }
          const dir = quadNormalDir(pos);
          const uv = new Float32Array(8);
          if (uvlock && (rx || ry) && !el.rotation) {
            // Re-derive uvs from the final positions so the texture keeps its world orientation.
            const fin = faceCorners(dir, Math.min(pos[0], pos[3], pos[6], pos[9]) * 16, Math.min(pos[1], pos[4], pos[7], pos[10]) * 16, Math.min(pos[2], pos[5], pos[8], pos[11]) * 16, Math.max(pos[0], pos[3], pos[6], pos[9]) * 16, Math.max(pos[1], pos[4], pos[7], pos[10]) * 16, Math.max(pos[2], pos[5], pos[8], pos[11]) * 16);
            const ruv = uvRect;
            const cuv = [ruv[0], ruv[1], ruv[0], ruv[3], ruv[2], ruv[3], ruv[2], ruv[1]];
            for (let i = 0; i < 4; i++) {
              // find which canonical corner this vertex is
              let best = 0;
              let bestD = Infinity;
              for (let j = 0; j < 4; j++) {
                const dd = (pos[i * 3] * 16 - fin[j * 3]) ** 2 + (pos[i * 3 + 1] * 16 - fin[j * 3 + 1]) ** 2 + (pos[i * 3 + 2] * 16 - fin[j * 3 + 2]) ** 2;
                if (dd < bestD) {
                  bestD = dd;
                  best = j;
                }
              }
              uv[i * 2] = cuv[best * 2] / 16;
              uv[i * 2 + 1] = cuv[best * 2 + 1] / 16;
            }
          } else {
            for (let i = 0; i < 8; i++) uv[i] = uvs[i] / 16;
          }
          const texture = this.textureFor(model, face.texture);
          const full = cull >= 0 && isFullFace(pos, cull);
          if (full && !texture.includes('overlay')) fullFaces |= 1 << cull;
          quads.push({ pos, uv, tile: this.atlas.tile(texture), texture, cull, dir, full, tint: face.tintindex ?? -1, shade: el.shade !== false });
        }
      }
    }
    const baked: BakedModel = { quads, ao: model?.ao ?? true, fullFaces };
    this.baked.set(key, baked);
    return baked;
  }

  private matchesCondition(when: Record<string, unknown>, props: Record<string, string>): boolean {
    if (Array.isArray(when.OR)) return (when.OR as Record<string, unknown>[]).some((c) => this.matchesCondition(c, props));
    if (Array.isArray(when.AND)) return (when.AND as Record<string, unknown>[]).every((c) => this.matchesCondition(c, props));
    for (const [k, v] of Object.entries(when)) {
      const options = String(v).split('|');
      if (!options.includes(props[k] ?? '')) return false;
    }
    return true;
  }

  private variantMatches(key: string, props: Record<string, string>): boolean {
    if (key === '' || key === 'normal') return true;
    for (const part of key.split(',')) {
      const [k, v] = part.split('=');
      if (props[k] !== v) return false;
    }
    return true;
  }

  /** All weighted model variants for a block state. */
  variantsFor(state: number): { weight: number; model: BakedModel }[] {
    const cached = this.stateCache.get(state);
    if (cached) return cached;
    const def = blocks.blockOf(state);
    const bs = this.data.blockstates[def.id];
    const props = blocks.props(state);
    let result: { weight: number; model: BakedModel }[] = [];
    if (bs?.variants) {
      let list: VariantJson | VariantJson[] | undefined;
      for (const key of Object.keys(bs.variants)) {
        if (this.variantMatches(key, props)) {
          list = bs.variants[key];
          break;
        }
      }
      if (list) {
        const arr = Array.isArray(list) ? list : [list];
        result = arr.map((v) => ({ weight: v.weight ?? 1, model: this.bake(v.model, v.x ?? 0, v.y ?? 0, v.uvlock ?? false) }));
      }
    } else if (bs?.multipart) {
      const quads: BakedQuad[] = [];
      let ao = true;
      let fullFaces = 0;
      for (const part of bs.multipart) {
        if (part.when && !this.matchesCondition(part.when, props)) continue;
        const arr = Array.isArray(part.apply) ? part.apply : [part.apply];
        const v = arr[0];
        const m = this.bake(v.model, v.x ?? 0, v.y ?? 0, v.uvlock ?? false);
        quads.push(...m.quads);
        ao = ao && m.ao;
        fullFaces |= m.fullFaces;
      }
      result = [{ weight: 1, model: { quads, ao, fullFaces } }];
    }
    if (result.length === 0) result = [{ weight: 1, model: EMPTY_MODEL }];
    this.stateCache.set(state, result);
    return result;
  }

  /** Picks a variant using a per-position random value in [0, 1). */
  modelFor(state: number, rand: number): BakedModel {
    const variants = this.variantsFor(state);
    if (variants.length === 1) return variants[0].model;
    let total = 0;
    for (const v of variants) total += v.weight;
    let r = rand * total;
    for (const v of variants) {
      r -= v.weight;
      if (r < 0) return v.model;
    }
    return variants[variants.length - 1].model;
  }

  /** Item model resolution for GUI icons: a flat sprite (generated items) or a 3D block model. */
  itemModel(itemId: string, blockId?: string): { kind: 'sprite'; textures: string[] } | { kind: 'model'; model: BakedModel; display?: ModelJson['display']; name: string } | null {
    const name = this.data.models[`item/${itemId}`] ? `item/${itemId}` : blockId && this.data.models[`block/${blockId}`] ? `block/${blockId}` : null;
    if (!name) return null;
    const r = this.resolve(name);
    if (!r) return null;
    const generated = r.chain.some((c) => c === 'item/generated' || c === 'builtin/generated' || c === 'item/handheld' || c === 'item/handheld_rod' || c === 'item/handheld_mace');
    if (r.elements.length === 0 && (generated || r.textures.layer0)) {
      const layers: string[] = [];
      for (let i = 0; i < 8; i++) {
        const t = r.textures[`layer${i}`];
        if (!t) break;
        layers.push(t);
      }
      if (layers.length) return { kind: 'sprite', textures: layers };
    }
    if (r.elements.length === 0) return null;
    return { kind: 'model', model: this.bake(name), display: r.display, name };
  }
}
