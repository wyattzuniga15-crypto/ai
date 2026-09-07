/**
 * Point-sprite particles: block crumbs cut from the block atlas (breaking, cracking) and small
 * sprites from textures/particle (hearts, crits, damage indicators, death poofs). Rendered as
 * two THREE.Points objects with a tiny shader that samples a sub-rectangle per point.
 */
import * as THREE from 'three';
import type { LoadedAtlas } from './atlas.ts';

export type SpriteName = 'heart' | 'crit' | 'damage' | 'poof' | 'smoke' | 'angry' | 'happy';
const SPRITE_FILES: Record<SpriteName, string[]> = {
  heart: ['heart'], crit: ['critical_hit'], damage: ['damage'], angry: ['angry'], happy: ['glint'],
  poof: ['generic_0', 'generic_1', 'generic_2', 'generic_3', 'generic_4', 'generic_5', 'generic_6', 'generic_7'],
  smoke: ['big_smoke_0', 'big_smoke_1', 'big_smoke_2', 'big_smoke_3', 'big_smoke_4', 'big_smoke_5', 'big_smoke_6', 'big_smoke_7'],
};
const SHEET_CELL = 16;
const MAX_POINTS = 4096;

interface Particle {
  x: number; y: number; z: number; px: number; py: number; pz: number;
  vx: number; vy: number; vz: number;
  age: number; life: number; size: number; gravity: number;
  r: number; g: number; b: number;
  /** Normalised atlas/sheet rectangle (u, v, w, h) at frame 0, plus the frame strip for animated sprites. */
  u: number; v: number; w: number; h: number;
  frames?: { u: number; v: number }[];
  sheet: 0 | 1;
  physics: boolean;
}

const vertexShader = /* glsl */ `
attribute vec4 rect;
attribute vec3 color;
attribute float size;
uniform float viewHeight;
varying vec4 vRect;
varying vec3 vColor;
void main() {
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = size * viewHeight * projectionMatrix[1][1] / (2.0 * max(0.1, -mv.z));
  gl_Position = projectionMatrix * mv;
  vRect = rect;
  vColor = color;
}
`;
const fragmentShader = /* glsl */ `
uniform sampler2D map;
varying vec4 vRect;
varying vec3 vColor;
void main() {
  vec4 t = texture2D(map, vRect.xy + gl_PointCoord * vRect.zw);
  if (t.a < 0.1) discard;
  gl_FragColor = vec4(t.rgb * vColor, t.a);
}
`;

class PointBatch {
  readonly points: THREE.Points;
  readonly geometry = new THREE.BufferGeometry();
  readonly position = new Float32Array(MAX_POINTS * 3);
  readonly rect = new Float32Array(MAX_POINTS * 4);
  readonly color = new Float32Array(MAX_POINTS * 3);
  readonly size = new Float32Array(MAX_POINTS);
  readonly material: THREE.ShaderMaterial;

  constructor(map: THREE.Texture) {
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.position, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('rect', new THREE.BufferAttribute(this.rect, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.color, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('size', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.material = new THREE.ShaderMaterial({ uniforms: { map: { value: map }, viewHeight: { value: 720 } }, vertexShader, fragmentShader, transparent: true, depthWrite: false });
    this.points = new THREE.Points(this.geometry, this.material);
    this.points.frustumCulled = false;
    this.geometry.setDrawRange(0, 0);
  }

  set(i: number, p: Particle, alpha: number, frame: number, light: number): void {
    this.position[i * 3] = p.px + (p.x - p.px) * alpha;
    this.position[i * 3 + 1] = p.py + (p.y - p.py) * alpha;
    this.position[i * 3 + 2] = p.pz + (p.z - p.pz) * alpha;
    const f = p.frames ? p.frames[Math.min(p.frames.length - 1, Math.floor((p.age / p.life) * p.frames.length))] : p;
    this.rect[i * 4] = f.u;
    this.rect[i * 4 + 1] = f.v;
    this.rect[i * 4 + 2] = p.w;
    this.rect[i * 4 + 3] = p.h;
    this.color[i * 3] = p.r * light;
    this.color[i * 3 + 1] = p.g * light;
    this.color[i * 3 + 2] = p.b * light;
    this.size[i] = p.size;
    void frame;
  }

  commit(n: number): void {
    for (const a of ['position', 'rect', 'color', 'size']) (this.geometry.getAttribute(a) as THREE.BufferAttribute).needsUpdate = true;
    this.geometry.setDrawRange(0, n);
  }
}

export class ParticleSystem {
  private readonly list: Particle[] = [];
  private readonly blocks: PointBatch;
  private readonly sprites: PointBatch;
  private readonly sheet = document.createElement('canvas');
  private readonly sheetTexture: THREE.CanvasTexture;
  private readonly sheetRects = new Map<string, { u: number; v: number; w: number; h: number }>();
  private loaded = false;

  constructor(private readonly scene: THREE.Scene, private readonly atlas: LoadedAtlas, private readonly isSolid: (x: number, y: number, z: number) => boolean) {
    this.blocks = new PointBatch(atlas.texture);
    this.sheet.width = SHEET_CELL * 8;
    this.sheet.height = SHEET_CELL * 4;
    this.sheetTexture = new THREE.CanvasTexture(this.sheet);
    this.sheetTexture.magFilter = THREE.NearestFilter;
    this.sheetTexture.minFilter = THREE.NearestFilter;
    this.sheetTexture.flipY = false;
    this.sheetTexture.colorSpace = THREE.SRGBColorSpace;
    this.sprites = new PointBatch(this.sheetTexture);
    scene.add(this.blocks.points, this.sprites.points);
  }

  /** Loads the particle sprites into the sheet; sprite particles are skipped until this resolves. */
  async preload(base: string): Promise<void> {
    const names = [...new Set(Object.values(SPRITE_FILES).flat())];
    const g = this.sheet.getContext('2d')!;
    g.imageSmoothingEnabled = false;
    await Promise.all(names.map((name, i) => new Promise<void>((resolve) => {
      const img = new Image();
      const cx = (i % 8) * SHEET_CELL;
      const cy = Math.floor(i / 8) * SHEET_CELL;
      img.onload = () => {
        g.drawImage(img, cx, cy, SHEET_CELL, SHEET_CELL);
        this.sheetRects.set(name, { u: cx / this.sheet.width, v: cy / this.sheet.height, w: SHEET_CELL / this.sheet.width, h: SHEET_CELL / this.sheet.height });
        resolve();
      };
      img.onerror = () => resolve();
      img.src = `${base}textures/particle/${name}.png`;
    })));
    this.sheetTexture.needsUpdate = true;
    this.loaded = true;
  }

  get count(): number {
    return this.list.length;
  }

  private push(p: Particle): void {
    if (this.list.length >= MAX_POINTS * 2) this.list.shift();
    this.list.push(p);
  }

  /** Block crumbs from a random 4×4 texel patch of a block texture tile (vanilla terrain particles). */
  spawnCrumbs(x: number, y: number, z: number, vx: number, vy: number, vz: number, tile: number, tint: number, rng: () => number, size = 0.1 * (rng() * 0.5 + 0.5) * 2): void {
    const t = this.atlas.index.tiles[tile];
    if (!t) return;
    const patch = 4 / 16;
    const u = t.x / this.atlas.width + (rng() * (1 - patch)) * (t.w / this.atlas.width);
    const v = t.y / this.atlas.height + (rng() * (1 - patch)) * (t.h / this.atlas.height);
    this.push({
      x, y, z, px: x, py: y, pz: z, vx, vy, vz, age: 0, life: Math.floor(4 / (rng() * 0.9 + 0.1)), size, gravity: 1,
      r: ((tint >> 16) & 255) / 255 * 0.6, g: ((tint >> 8) & 255) / 255 * 0.6, b: (tint & 255) / 255 * 0.6,
      u, v, w: (t.w / this.atlas.width) * patch, h: (t.h / this.atlas.height) * patch, sheet: 0, physics: true,
    });
  }

  /** The 4×4×4 burst vanilla spawns when a block breaks. */
  spawnBlockBreak(bx: number, by: number, bz: number, tile: number, tint: number, rng: () => number): void {
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) for (let k = 0; k < 4; k++) {
      const x = bx + (i + 0.5) / 4, y = by + (j + 0.5) / 4, z = bz + (k + 0.5) / 4;
      this.spawnCrumbs(x, y, z, (x - bx - 0.5) * 0.4 + (rng() - 0.5) * 0.1, (y - by - 0.5) * 0.4 + rng() * 0.1, (z - bz - 0.5) * 0.4 + (rng() - 0.5) * 0.1, tile, tint, rng);
    }
  }

  /** One crumb at a random point on the hit face while mining. */
  spawnCrack(bx: number, by: number, bz: number, face: number, tile: number, tint: number, rng: () => number): void {
    const n = [[0, -1, 0], [0, 1, 0], [0, 0, -1], [0, 0, 1], [-1, 0, 0], [1, 0, 0]][face] ?? [0, 1, 0];
    const o = 0.1;
    const x = bx + (n[0] === 0 ? rng() : n[0] > 0 ? 1 + o : -o);
    const y = by + (n[1] === 0 ? rng() : n[1] > 0 ? 1 + o : -o);
    const z = bz + (n[2] === 0 ? rng() : n[2] > 0 ? 1 + o : -o);
    this.spawnCrumbs(x, y, z, n[0] * 0.1 + (rng() - 0.5) * 0.05, n[1] * 0.1 + rng() * 0.08, n[2] * 0.1 + (rng() - 0.5) * 0.05, tile, tint, rng, 0.12);
  }

  spawnSprite(name: SpriteName, x: number, y: number, z: number, vx: number, vy: number, vz: number, life: number, size: number, gravity = 0, color = 0xffffff): void {
    if (!this.loaded) return;
    const files = SPRITE_FILES[name];
    const first = this.sheetRects.get(files[0]);
    if (!first) return;
    const frames = files.length > 1 ? files.map((f) => this.sheetRects.get(f) ?? first) : undefined;
    this.push({ x, y, z, px: x, py: y, pz: z, vx, vy, vz, age: 0, life, size, gravity, r: ((color >> 16) & 255) / 255, g: ((color >> 8) & 255) / 255, b: (color & 255) / 255, u: first.u, v: first.v, w: first.w, h: first.h, frames, sheet: 1, physics: name !== 'heart' && name !== 'angry' && name !== 'happy' });
  }

  /** Vanilla-style helpers. */
  hearts(x: number, y: number, z: number, count: number, rng: () => number, w = 1, h = 1): void {
    for (let i = 0; i < count; i++) this.spawnSprite('heart', x + (rng() - 0.5) * w, y + rng() * h, z + (rng() - 0.5) * w, (rng() - 0.5) * 0.02, 0.02 + rng() * 0.04, (rng() - 0.5) * 0.02, 16 + Math.floor(rng() * 8), 0.3 + rng() * 0.15);
  }

  poof(x: number, y: number, z: number, count: number, rng: () => number, w = 1, h = 1): void {
    for (let i = 0; i < count; i++) {
      const g = 0.55 + rng() * 0.35;
      this.spawnSprite('poof', x + (rng() - 0.5) * w, y + rng() * h, z + (rng() - 0.5) * w, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1, (rng() - 0.5) * 0.1, 8 + Math.floor(rng() * 8), 0.35, 0, (Math.round(g * 255) << 16) | (Math.round(g * 255) << 8) | Math.round(g * 255));
    }
  }

  crits(x: number, y: number, z: number, count: number, rng: () => number, kind: 'crit' | 'damage'): void {
    for (let i = 0; i < count; i++) this.spawnSprite(kind, x + (rng() - 0.5), y + rng(), z + (rng() - 0.5), (rng() - 0.5) * 0.2, rng() * 0.15, (rng() - 0.5) * 0.2, kind === 'crit' ? 8 + Math.floor(rng() * 8) : 20, 0.2, kind === 'crit' ? 0.5 : 0.4);
  }

  tick(): void {
    for (let i = this.list.length - 1; i >= 0; i--) {
      const p = this.list[i];
      p.px = p.x; p.py = p.y; p.pz = p.z;
      if (++p.age >= p.life) {
        this.list.splice(i, 1);
        continue;
      }
      p.vy -= 0.04 * p.gravity;
      let nx = p.x + p.vx, ny = p.y + p.vy, nz = p.z + p.vz;
      if (p.physics) {
        // stop against solid blocks instead of falling through (vanilla particles collide)
        if (this.isSolid(Math.floor(nx), Math.floor(p.y), Math.floor(p.z))) { nx = p.x; p.vx = 0; }
        if (this.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(p.z))) { ny = p.y; p.vy = 0; p.vx *= 0.7; p.vz *= 0.7; }
        if (this.isSolid(Math.floor(nx), Math.floor(ny), Math.floor(nz))) { nz = p.z; p.vz = 0; }
      }
      p.x = nx; p.y = ny; p.z = nz;
      p.vx *= 0.98; p.vy *= 0.98; p.vz *= 0.98;
    }
  }

  render(alpha: number, viewHeight: number, lightAt: (x: number, y: number, z: number) => number): void {
    let nb = 0, ns = 0;
    for (const p of this.list) {
      const light = lightAt(Math.floor(p.x), Math.floor(p.y), Math.floor(p.z));
      if (p.sheet === 0) { if (nb < MAX_POINTS) this.blocks.set(nb++, p, alpha, 0, light); }
      else if (ns < MAX_POINTS) this.sprites.set(ns++, p, alpha, 0, light);
    }
    this.blocks.material.uniforms.viewHeight.value = viewHeight;
    this.sprites.material.uniforms.viewHeight.value = viewHeight;
    this.blocks.commit(nb);
    this.sprites.commit(ns);
  }

  dispose(): void {
    this.scene.remove(this.blocks.points, this.sprites.points);
    this.blocks.geometry.dispose();
    this.sprites.geometry.dispose();
  }
}
