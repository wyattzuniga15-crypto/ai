/**
 * Seeded gradient noise (improved Perlin) in 2D and 3D with fractal Brownian motion helpers.
 * Output range is roughly [-1, 1].
 */
import { Rng } from './rng.ts';

const GRAD3 = [
  [1, 1, 0], [-1, 1, 0], [1, -1, 0], [-1, -1, 0],
  [1, 0, 1], [-1, 0, 1], [1, 0, -1], [-1, 0, -1],
  [0, 1, 1], [0, -1, 1], [0, 1, -1], [0, -1, -1],
  [1, 1, 0], [0, -1, 1], [-1, 1, 0], [0, -1, -1],
];

const fade = (t: number) => t * t * t * (t * (t * 6 - 15) + 10);
const lerp = (a: number, b: number, t: number) => a + t * (b - a);

export class Noise {
  private readonly perm = new Uint8Array(512);
  private readonly permMod16 = new Uint8Array(512);

  constructor(seed: number) {
    const rng = new Rng(seed);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    for (let i = 255; i > 0; i--) {
      const j = rng.int(i + 1);
      const t = p[i];
      p[i] = p[j];
      p[j] = t;
    }
    for (let i = 0; i < 512; i++) {
      this.perm[i] = p[i & 255];
      this.permMod16[i] = this.perm[i] % 16;
    }
  }

  noise2(x: number, y: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    const u = fade(x);
    const v = fade(y);
    const p = this.perm;
    const pm = this.permMod16;
    const A = p[X] + Y;
    const B = p[X + 1] + Y;
    const g00 = GRAD3[pm[A]];
    const g10 = GRAD3[pm[B]];
    const g01 = GRAD3[pm[A + 1]];
    const g11 = GRAD3[pm[B + 1]];
    const n00 = g00[0] * x + g00[1] * y;
    const n10 = g10[0] * (x - 1) + g10[1] * y;
    const n01 = g01[0] * x + g01[1] * (y - 1);
    const n11 = g11[0] * (x - 1) + g11[1] * (y - 1);
    return lerp(lerp(n00, n10, u), lerp(n01, n11, u), v) * 1.42;
  }

  noise3(x: number, y: number, z: number): number {
    const X = Math.floor(x) & 255;
    const Y = Math.floor(y) & 255;
    const Z = Math.floor(z) & 255;
    x -= Math.floor(x);
    y -= Math.floor(y);
    z -= Math.floor(z);
    const u = fade(x);
    const v = fade(y);
    const w = fade(z);
    const p = this.perm;
    const pm = this.permMod16;
    const A = p[X] + Y;
    const AA = p[A] + Z;
    const AB = p[A + 1] + Z;
    const B = p[X + 1] + Y;
    const BA = p[B] + Z;
    const BB = p[B + 1] + Z;
    const g = (h: number, dx: number, dy: number, dz: number) => {
      const gr = GRAD3[pm[h]];
      return gr[0] * dx + gr[1] * dy + gr[2] * dz;
    };
    return (
      lerp(
        lerp(lerp(g(AA, x, y, z), g(BA, x - 1, y, z), u), lerp(g(AB, x, y - 1, z), g(BB, x - 1, y - 1, z), u), v),
        lerp(lerp(g(AA + 1, x, y, z - 1), g(BA + 1, x - 1, y, z - 1), u), lerp(g(AB + 1, x, y - 1, z - 1), g(BB + 1, x - 1, y - 1, z - 1), u), v),
        w,
      ) * 1.15
    );
  }

  /** Fractal Brownian motion in 2D; returns roughly [-1, 1]. */
  fbm2(x: number, y: number, octaves = 4, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise2(x, y) * amp;
      norm += amp;
      amp *= gain;
      x *= lacunarity;
      y *= lacunarity;
    }
    return sum / norm;
  }

  fbm3(x: number, y: number, z: number, octaves = 3, lacunarity = 2, gain = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    for (let i = 0; i < octaves; i++) {
      sum += this.noise3(x, y, z) * amp;
      norm += amp;
      amp *= gain;
      x *= lacunarity;
      y *= lacunarity;
      z *= lacunarity;
    }
    return sum / norm;
  }

  /** Ridged 2D noise in [0, 1]: 0 along ridges, useful for rivers. */
  ridge2(x: number, y: number, octaves = 2): number {
    return Math.abs(this.fbm2(x, y, octaves));
  }
}
