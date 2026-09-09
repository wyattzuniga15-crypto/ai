/**
 * Loads a packed atlas (PNG + JSON) into a Three.js texture with a hand-built 5-level mip chain
 * (16 -> 1 px per tile, so tiles never bleed into each other) plus the tile-table texture the chunk
 * shader uses to map tile ids to atlas rectangles. Animated tiles advance through the table.
 */
import * as THREE from 'three';
import { AtlasIndex, type AtlasJson } from './atlasIndex.ts';

export interface LoadedAtlas {
  index: AtlasIndex;
  texture: THREE.DataTexture;
  tileTable: THREE.DataTexture;
  tileCount: number;
  /** Advance animations by one game tick. */
  tick(): void;
  /** Raw level-0 pixels (for icon rendering). */
  pixels: Uint8Array;
  width: number;
  height: number;
}

async function loadPixels(url: string): Promise<{ data: Uint8Array; width: number; height: number }> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`failed to load ${url}: ${res.status}`);
  const blob = await res.blob();
  const bmp = await createImageBitmap(blob, { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
  const canvas = document.createElement('canvas');
  canvas.width = bmp.width;
  canvas.height = bmp.height;
  const g = canvas.getContext('2d', { willReadFrequently: true })!;
  g.drawImage(bmp, 0, 0);
  const img = g.getImageData(0, 0, bmp.width, bmp.height);
  return { data: new Uint8Array(img.data.buffer), width: bmp.width, height: bmp.height };
}

/** Box-filters one level down, weighting colour by alpha so transparent texels don't darken edges. */
function downsample(src: Uint8Array, w: number, h: number): Uint8Array {
  const nw = Math.max(1, w >> 1);
  const nh = Math.max(1, h >> 1);
  const out = new Uint8Array(nw * nh * 4);
  for (let y = 0; y < nh; y++)
    for (let x = 0; x < nw; x++) {
      let r = 0, g = 0, b = 0, a = 0, n = 0;
      for (let dy = 0; dy < 2; dy++)
        for (let dx = 0; dx < 2; dx++) {
          const sx = Math.min(w - 1, x * 2 + dx);
          const sy = Math.min(h - 1, y * 2 + dy);
          const i = (sy * w + sx) * 4;
          const al = src[i + 3];
          r += src[i] * al;
          g += src[i + 1] * al;
          b += src[i + 2] * al;
          a += al;
          n++;
        }
      const o = (y * nw + x) * 4;
      if (a > 0) {
        out[o] = r / a;
        out[o + 1] = g / a;
        out[o + 2] = b / a;
      }
      out[o + 3] = a / n;
    }
  return out;
}

export async function loadAtlas(base: string, name: string): Promise<LoadedAtlas> {
  const [json, px] = await Promise.all([
    fetch(`${base}atlas/${name}.json`).then((r) => r.json() as Promise<AtlasJson>),
    loadPixels(`${base}atlas/${name}.png`),
  ]);
  const index = new AtlasIndex(json);
  const texture = new THREE.DataTexture(px.data, px.width, px.height, THREE.RGBAFormat, THREE.UnsignedByteType);
  texture.colorSpace = THREE.NoColorSpace;
  texture.magFilter = THREE.NearestFilter;
  texture.minFilter = THREE.NearestMipmapLinearFilter;
  texture.generateMipmaps = false;
  texture.flipY = false;
  texture.unpackAlignment = 1;
  const mips: { data: Uint8Array; width: number; height: number }[] = [];
  let data = px.data;
  let w = px.width;
  let h = px.height;
  for (let level = 0; level < 5; level++) {
    mips.push({ data, width: w, height: h });
    if (w === 1 && h === 1) break;
    data = downsample(data, w, h);
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  texture.mipmaps = mips as unknown as THREE.DataTexture['mipmaps'];
  texture.needsUpdate = true;

  // tile table: u0, v0, w, h in normalised atlas coordinates, one texel per tile
  const count = index.count;
  const table = new Float32Array(count * 4);
  const setTile = (i: number, x: number, y: number, tw: number, th: number) => {
    table[i * 4] = x / index.width;
    table[i * 4 + 1] = y / index.height;
    table[i * 4 + 2] = tw / index.width;
    table[i * 4 + 3] = th / index.height;
  };
  index.tiles.forEach((t, i) => setTile(i, t.x, t.y, t.w, t.h));
  const tileTable = new THREE.DataTexture(table, count, 1, THREE.RGBAFormat, THREE.FloatType);
  tileTable.magFilter = THREE.NearestFilter;
  tileTable.minFilter = THREE.NearestFilter;
  tileTable.generateMipmaps = false;
  tileTable.needsUpdate = true;

  // animation state per animated tile
  const anim = index.animated.map((id) => ({ id, pos: 0, ticks: 0 }));
  const tick = () => {
    if (!anim.length) return;
    for (const a of anim) {
      const t = index.tiles[a.id];
      const seq = t.seq ?? t.frames!.map((_, i) => [i, 1] as [number, number]);
      a.ticks++;
      if (a.ticks >= seq[a.pos][1]) {
        a.ticks = 0;
        a.pos = (a.pos + 1) % seq.length;
        const frame = t.frames![seq[a.pos][0]] ?? t.frames![0];
        setTile(a.id, frame[0], frame[1], t.w, t.h);
      }
    }
    tileTable.needsUpdate = true;
  };
  return { index, texture, tileTable, tileCount: count, tick, pixels: px.data, width: px.width, height: px.height };
}

/** Limits sampling to the mip levels we uploaded; without this an incomplete chain samples black. */
export function applyMipLimit(renderer: THREE.WebGLRenderer, texture: THREE.Texture, maxLevel: number): void {
  renderer.initTexture(texture);
  const gl = renderer.getContext();
  const props = renderer.properties.get(texture) as { __webglTexture?: WebGLTexture };
  if (!props.__webglTexture) return;
  gl.bindTexture(gl.TEXTURE_2D, props.__webglTexture);
  gl.texParameteri(gl.TEXTURE_2D, (gl as WebGL2RenderingContext).TEXTURE_MAX_LEVEL, maxLevel);
  gl.bindTexture(gl.TEXTURE_2D, null);
}
