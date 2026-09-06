/**
 * Builds render geometry for one 16x16x16 section from baked block models: face culling against
 * neighbours, vanilla-style ambient occlusion and smooth lighting, biome tints and fluid surfaces.
 * Output is plain typed arrays so the worker can transfer them to the renderer.
 */
import { CHUNK_SIZE, WORLD_MIN_Y } from '../core/constants.ts';
import { hashPos } from '../core/rng.ts';
import { blocks, type BlockDef } from '../blocks/registry.ts';
import { DEFAULT_FOLIAGE, DEFAULT_GRASS, DEFAULT_WATER, biomes } from './biomes.ts';
import type { ChunkProvider } from './light.ts';
import { DIR_OFFSETS, FACE_SHADE, type BakedQuad, type ModelBaker } from './models.ts';
import type { AtlasIndex } from '../render/atlasIndex.ts';

export interface MeshBuffers {
  position: Float32Array;
  uv: Float32Array;
  tile: Float32Array;
  /** r, g, b tint and a = shade * ao (0..255) per vertex. */
  color: Uint8Array;
  /** sky, block light per vertex (0..15). */
  light: Uint8Array;
  index: Uint32Array;
}

export interface SectionMesh {
  solid: MeshBuffers | null;
  translucent: MeshBuffers | null;
}

const P = 18; // padded size
const pidx = (x: number, y: number, z: number) => ((y + 1) * P + (z + 1)) * P + (x + 1);

class GeometryBuilder {
  position = new Float32Array(3 * 4 * 512);
  uv = new Float32Array(2 * 4 * 512);
  tile = new Float32Array(4 * 512);
  color = new Uint8Array(4 * 4 * 512);
  light = new Uint8Array(2 * 4 * 512);
  index = new Uint32Array(6 * 512);
  vcount = 0;
  icount = 0;

  private grow(): void {
    const n = this.vcount * 2 + 4;
    const cp = <T extends Float32Array | Uint8Array | Uint32Array>(old: T, len: number): T => {
      const a = new (old.constructor as new (n: number) => T)(len);
      a.set(old as unknown as ArrayLike<number> & T);
      return a;
    };
    this.position = cp(this.position, n * 3);
    this.uv = cp(this.uv, n * 2);
    this.tile = cp(this.tile, n);
    this.color = cp(this.color, n * 4);
    this.light = cp(this.light, n * 2);
    this.index = cp(this.index, (n / 4) * 6);
  }

  /** Adds one vertex; call in groups of four followed by `quadIndices()`. */
  vertex(x: number, y: number, z: number, u: number, v: number, tile: number, r: number, g: number, b: number, a: number, sky: number, block: number): void {
    if ((this.vcount + 1) * 3 > this.position.length) this.grow();
    const i = this.vcount++;
    this.position[i * 3] = x;
    this.position[i * 3 + 1] = y;
    this.position[i * 3 + 2] = z;
    this.uv[i * 2] = u;
    this.uv[i * 2 + 1] = v;
    this.tile[i] = tile;
    this.color[i * 4] = r;
    this.color[i * 4 + 1] = g;
    this.color[i * 4 + 2] = b;
    this.color[i * 4 + 3] = a;
    this.light[i * 2] = sky;
    this.light[i * 2 + 1] = block;
  }

  /** Emits two triangles for the last four vertices, flipping the diagonal for better AO when asked. */
  quadIndices(flip = false): void {
    const b = this.vcount - 4;
    const ix = this.icount;
    if (flip) {
      this.index[ix] = b + 1; this.index[ix + 1] = b + 2; this.index[ix + 2] = b + 3;
      this.index[ix + 3] = b + 1; this.index[ix + 4] = b + 3; this.index[ix + 5] = b;
    } else {
      this.index[ix] = b; this.index[ix + 1] = b + 1; this.index[ix + 2] = b + 2;
      this.index[ix + 3] = b; this.index[ix + 4] = b + 2; this.index[ix + 5] = b + 3;
    }
    this.icount += 6;
  }

  build(): MeshBuffers | null {
    if (this.vcount === 0) return null;
    return {
      position: this.position.slice(0, this.vcount * 3),
      uv: this.uv.slice(0, this.vcount * 2),
      tile: this.tile.slice(0, this.vcount),
      color: this.color.slice(0, this.vcount * 4),
      light: this.light.slice(0, this.vcount * 2),
      index: this.index.slice(0, this.icount),
    };
  }
}

const LEAF_CONST: Record<string, number> = { birch_leaves: 0x80a755, spruce_leaves: 0x619961 };

export function tintColor(def: BlockDef, state: number, tintIndex: number, biomeIdx: number): number {
  if (tintIndex < 0) return 0xffffff;
  const b = biomes[biomeIdx];
  const id = def.id;
  if (id === 'water' || id === 'water_cauldron' || id === 'bubble_column') return b?.waterColor ?? DEFAULT_WATER;
  if (id.endsWith('_leaves')) return LEAF_CONST[id] ?? b?.foliageColor ?? DEFAULT_FOLIAGE;
  if (id === 'vine') return b?.foliageColor ?? DEFAULT_FOLIAGE;
  if (id === 'lily_pad') return 0x208030;
  if (id === 'attached_melon_stem' || id === 'attached_pumpkin_stem') return 0xe0c71c;
  if (id === 'melon_stem' || id === 'pumpkin_stem') {
    const age = Number(blocks.prop(state, 'age') ?? 0);
    return ((age * 32) << 16) | ((255 - age * 8) << 8) | (age * 4);
  }
  if (id === 'redstone_wire') {
    const p = Number(blocks.prop(state, 'power') ?? 0) / 15;
    const r = Math.round((0.3 + p * 0.7) * 255);
    const g = Math.round(Math.max(0, p * p * 0.7 - 0.5) * 255);
    return (r << 16) | (g << 8) | 0;
  }
  return b?.grassColor ?? DEFAULT_GRASS;
}

export class SectionMesher {
  private readonly pad = new Uint16Array(P * P * P);
  private readonly padLight = new Uint8Array(P * P * P);
  private readonly padBiome = new Uint8Array(P * P);
  private readonly waterStill: number;
  private readonly waterFlow: number;
  private readonly lavaStill: number;
  private readonly lavaFlow: number;

  constructor(private readonly chunks: ChunkProvider, private readonly baker: ModelBaker, atlas: AtlasIndex) {
    this.waterStill = atlas.tile('block/water_still');
    this.waterFlow = atlas.tile('block/water_flow');
    this.lavaStill = atlas.tile('block/lava_still');
    this.lavaFlow = atlas.tile('block/lava_flow');
  }

  /** Copies the section plus a one-block border into the padded arrays. */
  private fill(cx: number, sy: number, cz: number): boolean {
    const pad = this.pad;
    const pl = this.padLight;
    const y0 = WORLD_MIN_Y + sy * 16;
    let any = false;
    for (let dz = -1; dz <= 1; dz++)
      for (let dx = -1; dx <= 1; dx++) {
        const c = this.chunks.getChunk(cx + dx, cz + dz);
        const xs = dx === -1 ? 15 : 0;
        const xe = dx === 1 ? 0 : 15;
        const zs = dz === -1 ? 15 : 0;
        const ze = dz === 1 ? 0 : 15;
        for (let lz = zs; lz <= ze; lz++)
          for (let lx = xs; lx <= xe; lx++) {
            const px = dx * 16 + lx;
            const pz = dz * 16 + lz;
            if (c) this.padBiome[(pz + 1) * P + (px + 1)] = c.biomes[lz * 16 + lx];
            for (let py = -1; py <= 16; py++) {
              const y = y0 + py;
              const i = pidx(px, py, pz);
              if (!c || y < WORLD_MIN_Y || y > WORLD_MIN_Y + 383) {
                pad[i] = 0;
                pl[i] = y > WORLD_MIN_Y + 383 || !c ? 0xf0 : 0;
                continue;
              }
              const s = c.get(lx, y, lz);
              pad[i] = s;
              pl[i] = c.light[((y - WORLD_MIN_Y) * CHUNK_SIZE + lz) * CHUNK_SIZE + lx];
              if (s !== 0 && dx === 0 && dz === 0 && py >= 0 && py < 16) any = true;
            }
          }
      }
    return any;
  }

  mesh(cx: number, sy: number, cz: number): SectionMesh {
    const c = this.chunks.getChunk(cx, cz);
    if (!c || c.isSectionEmpty(sy)) return { solid: null, translucent: null };
    if (!this.fill(cx, sy, cz)) return { solid: null, translucent: null };
    const solid = new GeometryBuilder();
    const translucent = new GeometryBuilder();
    const pad = this.pad;
    const opaque = blocks.stateOpaque;
    const y0 = WORLD_MIN_Y + sy * 16;
    const ox = cx * 16;
    const oz = cz * 16;
    for (let y = 0; y < 16; y++)
      for (let z = 0; z < 16; z++)
        for (let x = 0; x < 16; x++) {
          const state = pad[pidx(x, y, z)];
          if (state === 0) continue;
          const def = blocks.blockOf(state);
          if (def.behavior === 'air') continue;
          const biome = this.padBiome[(z + 1) * P + (x + 1)];
          if (def.behavior === 'fluid') {
            this.fluid(def.id === 'water' ? translucent : solid, def, state, x, y, z, biome);
            continue;
          }
          const model = this.baker.modelFor(state, hashPos(0x5eed, ox + x, y0 + y, oz + z));
          if (model.quads.length === 0) continue;
          const translucentLayer = blocks.isTranslucent(def);
          const gb = translucentLayer ? translucent : solid;
          for (const q of model.quads) {
            if (q.cull >= 0) {
              const o = DIR_OFFSETS[q.cull];
              const n = pad[pidx(x + o[0], y + o[1], z + o[2])];
              if (opaque[n]) continue;
              if (n !== 0 && n === state && (translucentLayer || def.behavior === 'glass' || def.behavior === 'leaves' && false)) continue;
              if (n !== 0 && blocks.stateBlock[n] === blocks.stateBlock[state] && (def.behavior === 'glass' || def.id.endsWith('_stained_glass') || def.id === 'ice')) continue;
            }
            this.emitQuad(gb, q, model.ao, def, state, x, y, z, biome);
          }
        }
    return { solid: solid.build(), translucent: translucent.build() };
  }

  private emitQuad(gb: GeometryBuilder, q: BakedQuad, ao: boolean, def: BlockDef, state: number, x: number, y: number, z: number, biome: number): void {
    const tint = tintColor(def, state, q.tint, biome);
    const tr = (tint >> 16) & 255;
    const tg = (tint >> 8) & 255;
    const tb = tint & 255;
    const shade = q.shade ? FACE_SHADE[q.dir] : 1;
    const pad = this.pad;
    const pl = this.padLight;
    const opaque = blocks.stateOpaque;
    const d = q.dir;
    const o = DIR_OFFSETS[d];
    const smooth = ao && q.full && q.cull === d;
    let flip = false;
    if (smooth) {
      // tangent axes for this face
      const a = d < 2 ? 0 : d < 4 ? 0 : 1; // axis index: x=0,y=1,z=2 -> first tangent
      const b = d < 2 ? 2 : d < 4 ? 1 : 2;
      const aoVals = [0, 0, 0, 0];
      const skyVals = [0, 0, 0, 0];
      const blkVals = [0, 0, 0, 0];
      const nx = x + o[0], ny = y + o[1], nz = z + o[2];
      const nl = pl[pidx(nx, ny, nz)];
      for (let i = 0; i < 4; i++) {
        const pa = q.pos[i * 3 + a] > 0.5 ? 1 : -1;
        const pb = q.pos[i * 3 + b] > 0.5 ? 1 : -1;
        const sa = [0, 0, 0]; sa[a] = pa;
        const sb = [0, 0, 0]; sb[b] = pb;
        const i1 = pidx(nx + sa[0], ny + sa[1], nz + sa[2]);
        const i2 = pidx(nx + sb[0], ny + sb[1], nz + sb[2]);
        const i3 = pidx(nx + sa[0] + sb[0], ny + sa[1] + sb[1], nz + sa[2] + sb[2]);
        const o1 = opaque[pad[i1]];
        const o2 = opaque[pad[i2]];
        const o3 = o1 && o2 ? 1 : opaque[pad[i3]];
        const occl = o1 + o2 + o3;
        aoVals[i] = (1 + (3 - occl)) / 4 * 0.75 + 0.25; // 0.25 .. 1.0 like vanilla's 0.2 shade + spread
        let sky = nl >> 4, blk = nl & 15, n = 1;
        for (const [ii, oc] of [[i1, o1], [i2, o2], [i3, o3]] as [number, number][]) {
          const l = oc ? nl : pl[ii];
          sky += l >> 4;
          blk += l & 15;
          n++;
        }
        skyVals[i] = sky / n;
        blkVals[i] = blk / n;
      }
      flip = aoVals[0] + aoVals[2] < aoVals[1] + aoVals[3];
      for (let i = 0; i < 4; i++) {
        gb.vertex(x + q.pos[i * 3], y + q.pos[i * 3 + 1], z + q.pos[i * 3 + 2], q.uv[i * 2], q.uv[i * 2 + 1], q.tile, tr, tg, tb, Math.round(shade * aoVals[i] * 255), Math.round(skyVals[i]), Math.round(blkVals[i]));
      }
      gb.quadIndices(flip);
      return;
    }
    // flat lighting: sample the neighbour in the face direction when it is not opaque, else self
    let li = pidx(x + o[0], y + o[1], z + o[2]);
    if (q.cull < 0 || opaque[pad[li]]) li = pidx(x, y, z);
    const l = pl[li];
    const self = pl[pidx(x, y, z)];
    const sky = Math.max(l >> 4, self >> 4);
    const blk = Math.max(l & 15, self & 15);
    for (let i = 0; i < 4; i++) {
      gb.vertex(x + q.pos[i * 3], y + q.pos[i * 3 + 1], z + q.pos[i * 3 + 2], q.uv[i * 2], q.uv[i * 2 + 1], q.tile, tr, tg, tb, Math.round(shade * 255), sky, blk);
    }
    gb.quadIndices(false);
  }

  private fluid(gb: GeometryBuilder, def: BlockDef, state: number, x: number, y: number, z: number, biome: number): void {
    const pad = this.pad;
    const pl = this.padLight;
    const opaque = blocks.stateOpaque;
    const water = def.id === 'water';
    const still = water ? this.waterStill : this.lavaStill;
    const flow = water ? this.waterFlow : this.lavaFlow;
    const tint = water ? tintColor(def, state, 0, biome) : 0xffffff;
    const tr = (tint >> 16) & 255, tg = (tint >> 8) & 255, tb = tint & 255;
    const sameFluid = (s: number) => s !== 0 && blocks.stateBlock[s] === blocks.stateBlock[state];
    const above = pad[pidx(x, y + 1, z)];
    const level = Number(blocks.prop(state, 'level') ?? 0);
    const h = sameFluid(above) ? 1 : level >= 8 ? 1 : (8 - (level & 7)) / 9;
    const self = pl[pidx(x, y, z)];
    const lightAt = (dx: number, dy: number, dz: number) => {
      const i = pidx(x + dx, y + dy, z + dz);
      return opaque[pad[i]] ? self : pl[i];
    };
    const emit = (px: number[], u: number[], tile: number, l: number, shade: number) => {
      for (let i = 0; i < 4; i++) gb.vertex(x + px[i * 3], y + px[i * 3 + 1], z + px[i * 3 + 2], u[i * 2], u[i * 2 + 1], tile, tr, tg, tb, Math.round(shade * 255), l >> 4, l & 15);
      gb.quadIndices();
    };
    // top
    if (!sameFluid(above)) emit([0, h, 0, 0, h, 1, 1, h, 1, 1, h, 0], [0, 0, 0, 1, 1, 1, 1, 0], still, lightAt(0, 1, 0), 1);
    // bottom
    const below = pad[pidx(x, y - 1, z)];
    if (!sameFluid(below) && !opaque[below]) emit([0, 0, 1, 0, 0, 0, 1, 0, 0, 1, 0, 1], [0, 0, 0, 1, 1, 1, 1, 0], still, lightAt(0, -1, 0), 0.5);
    // sides: north, south, west, east
    const sides: [number, number, number, number[], number][] = [
      [0, -1, 2, [1, h, 0, 1, 0, 0, 0, 0, 0, 0, h, 0], 0.8],
      [0, 1, 3, [0, h, 1, 0, 0, 1, 1, 0, 1, 1, h, 1], 0.8],
      [-1, 0, 4, [0, h, 0, 0, 0, 0, 0, 0, 1, 0, h, 1], 0.6],
      [1, 0, 5, [1, h, 1, 1, 0, 1, 1, 0, 0, 1, h, 0], 0.6],
    ];
    const v0 = (1 - h) * 0.5;
    const uvSide = [0, v0, 0, 0.5, 0.5, 0.5, 0.5, v0];
    for (const [dx, dz, , px, shade] of sides) {
      const n = pad[pidx(x + dx, y, z + dz)];
      if (sameFluid(n) || opaque[n]) continue;
      emit(px, uvSide, flow, lightAt(dx, 0, dz), shade);
    }
  }
}
