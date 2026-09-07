/**
 * Map colours. Vanilla gives every block a `MapColor` chosen to match how it looks; ours are taken
 * from the block's own top texture, averaged over its pixels and tinted the way the world tints it,
 * so a map drawn from them reads the same way vanilla's does.
 */
import type { LoadedAtlas } from './atlas.ts';
import type { ModelBaker } from '../world/models.ts';
import { blocks } from '../blocks/registry.ts';
import { tintColor } from '../world/mesher.ts';

/** Vanilla shades each colour four ways by how the ground steps up or down. */
export const SHADES = [180, 220, 255, 135];

export class MapColors {
  private readonly cache = new Map<number, number>();

  constructor(private readonly atlas: LoadedAtlas, private readonly baker: ModelBaker) {}

  /** The colour a block shows on a map, as 0xRRGGBB. */
  colorOf(state: number, biome: number): number {
    const key = state * 64 + (biome & 63);
    const cached = this.cache.get(key);
    if (cached !== undefined) return cached;
    let color = 0x7f7f7f;
    try {
      color = this.compute(state, biome);
    } catch {
      /* a block with no model keeps the plain grey */
    }
    this.cache.set(key, color);
    return color;
  }

  private compute(state: number, biome: number): number {
    if (state === 0) return 0x000000;
    const def = blocks.blockOf(state);
    // fluids are drawn by the fluid mesher rather than a model, so they have no quads to average
    if (def.behavior === 'fluid' || def.id === 'water' || def.id === 'lava') {
      if (def.id === 'lava') return 0xd45a12;
      return tintColor(def, state, 0, biome);
    }
    const model = this.baker.modelFor(state, 0.3);
    // the face pointing up is what a map sees; failing that, whatever the block has
    const quad = model.quads.find((q) => q.dir === 1) ?? model.quads[0];
    if (!quad) return 0x7f7f7f;
    const tile = this.atlas.index.tiles[quad.tile];
    let r = 0;
    let g = 0;
    let b = 0;
    let n = 0;
    for (let y = 0; y < tile.h; y++) {
      for (let x = 0; x < tile.w; x++) {
        const i = ((tile.y + y) * this.atlas.width + tile.x + x) * 4;
        const a = this.atlas.pixels[i + 3];
        if (a < 128) continue;
        r += this.atlas.pixels[i];
        g += this.atlas.pixels[i + 1];
        b += this.atlas.pixels[i + 2];
        n++;
      }
    }
    if (!n) return 0x000000;
    const tint = tintColor(def, state, quad.tint, biome);
    const tr = ((tint >> 16) & 255) / 255;
    const tg = ((tint >> 8) & 255) / 255;
    const tb = (tint & 255) / 255;
    return (Math.round((r / n) * tr) << 16) | (Math.round((g / n) * tg) << 8) | Math.round((b / n) * tb);
  }
}

/** Applies one of vanilla's four shades to a colour. */
export function shade(color: number, level: number): number {
  const s = SHADES[level] / 255;
  return (Math.round(((color >> 16) & 255) * s) << 16) | (Math.round(((color >> 8) & 255) * s) << 8) | Math.round((color & 255) * s);
}
