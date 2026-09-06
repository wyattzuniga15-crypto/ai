/**
 * Deterministic pseudo-random numbers. World generation must be reproducible per seed, so nothing
 * in src/world may use Math.random.
 */

/** 32-bit string/number hash (FNV-1a) used to turn arbitrary seeds into integers. */
export function hashString(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Turns user input into a numeric world seed the way Minecraft does: numeric strings parse, others hash. */
export function parseSeed(input: string): number {
  const trimmed = input.trim();
  if (trimmed === '') return (Math.random() * 0xffffffff) >>> 0;
  if (/^-?\d+$/.test(trimmed)) return Number(BigInt.asUintN(32, BigInt(trimmed)));
  return hashString(trimmed);
}

/** Mixes several integers into one well-distributed 32-bit value. */
export function mix(...values: number[]): number {
  let h = 0x9e3779b9;
  for (const v of values) {
    h ^= (v | 0) + 0x7f4a7c15 + (h << 6) + (h >>> 2);
    h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d);
    h = Math.imul(h ^ (h >>> 12), 0x297a2d39);
  }
  return (h ^ (h >>> 15)) >>> 0;
}

/** Position hash in [0,1) – used for per-block random model variants and bedrock patterns. */
export function hashPos(seed: number, x: number, y: number, z: number): number {
  return mix(seed, x, y, z) / 4294967296;
}

/** xoshiro128** – small, fast and good enough for feature placement. */
export class Rng {
  private s0: number;
  private s1: number;
  private s2: number;
  private s3: number;

  constructor(seed: number) {
    // splitmix32 to expand the seed into four state words
    let x = seed >>> 0;
    const next = () => {
      x = (x + 0x9e3779b9) >>> 0;
      let z = x;
      z = Math.imul(z ^ (z >>> 16), 0x85ebca6b);
      z = Math.imul(z ^ (z >>> 13), 0xc2b2ae35);
      return (z ^ (z >>> 16)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 1;
  }

  /** Uniform 32-bit unsigned integer. */
  nextU32(): number {
    const result = Math.imul(rotl(Math.imul(this.s1, 5), 7), 9) >>> 0;
    const t = this.s1 << 9;
    this.s2 ^= this.s0;
    this.s3 ^= this.s1;
    this.s1 ^= this.s2;
    this.s0 ^= this.s3;
    this.s2 ^= t;
    this.s3 = rotl(this.s3, 11);
    return result;
  }

  /** Uniform float in [0, 1). */
  next(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform integer in [0, n). */
  int(n: number): number {
    return Math.floor(this.next() * n);
  }

  /** Uniform integer in [min, max] inclusive. */
  range(min: number, max: number): number {
    return min + this.int(max - min + 1);
  }

  /** Triangular distribution between min and max (inclusive), peaking at the middle. */
  triangular(min: number, max: number): number {
    const a = this.next();
    const b = this.next();
    return Math.floor(min + ((a + b) / 2) * (max - min + 1));
  }

  chance(p: number): boolean {
    return this.next() < p;
  }

  pick<T>(list: readonly T[]): T {
    return list[this.int(list.length)];
  }

  /** Picks an entry by weight from [value, weight] pairs. */
  weighted<T>(entries: readonly (readonly [T, number])[]): T {
    let total = 0;
    for (const [, w] of entries) total += w;
    let r = this.next() * total;
    for (const [v, w] of entries) {
      r -= w;
      if (r < 0) return v;
    }
    return entries[entries.length - 1][0];
  }
}

function rotl(x: number, k: number): number {
  return (x << k) | (x >>> (32 - k));
}
