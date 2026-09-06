/** Vanilla explosion: ray-cast block destruction weighted by blast resistance, entity damage by exposure. */
import { blocks } from '../blocks/registry.ts';
import { Rng } from '../core/rng.ts';

export interface ExplosionWorld {
  getBlock(x: number, y: number, z: number): number;
  /** Destroy a block; `drop` false when the block is consumed by the blast. */
  destroyBlock(x: number, y: number, z: number, drop: boolean): void;
}

/** Returns the set of destroyed block positions (also applied through `destroyBlock`). */
export function explode(w: ExplosionWorld, cx: number, cy: number, cz: number, power: number, rng: Rng = new Rng((Math.random() * 1e9) >>> 0)): [number, number, number][] {
  const destroyed = new Set<string>();
  const out: [number, number, number][] = [];
  for (let i = 0; i < 16; i++)
    for (let j = 0; j < 16; j++)
      for (let k = 0; k < 16; k++) {
        if (i !== 0 && i !== 15 && j !== 0 && j !== 15 && k !== 0 && k !== 15) continue;
        let dx = i / 15 * 2 - 1;
        let dy = j / 15 * 2 - 1;
        let dz = k / 15 * 2 - 1;
        const len = Math.hypot(dx, dy, dz);
        dx /= len;
        dy /= len;
        dz /= len;
        let strength = power * (0.7 + rng.next() * 0.6);
        let x = cx;
        let y = cy;
        let z = cz;
        while (strength > 0) {
          const bx = Math.floor(x);
          const by = Math.floor(y);
          const bz = Math.floor(z);
          const state = w.getBlock(bx, by, bz);
          if (state !== 0) {
            const def = blocks.blockOf(state);
            const resistance = def.behavior === 'fluid' ? 100 : def.resistance;
            strength -= (resistance + 0.3) * 0.3;
            if (strength > 0 && def.hardness >= 0 && def.behavior !== 'fluid') destroyed.add(`${bx},${by},${bz}`);
          }
          x += dx * 0.3;
          y += dy * 0.3;
          z += dz * 0.3;
          strength -= 0.225;
        }
      }
  for (const key of destroyed) {
    const [x, y, z] = key.split(',').map(Number);
    out.push([x, y, z]);
    w.destroyBlock(x, y, z, rng.next() < 1 / power);
  }
  return out;
}

/** Fraction of sample points on the box that have a clear line to the explosion centre. */
export function exposure(w: ExplosionWorld, cx: number, cy: number, cz: number, box: { minX: number; minY: number; minZ: number; maxX: number; maxY: number; maxZ: number }): number {
  const sx = box.maxX - box.minX;
  const sy = box.maxY - box.minY;
  const sz = box.maxZ - box.minZ;
  const stepX = 1 / (sx * 2 + 1);
  const stepY = 1 / (sy * 2 + 1);
  const stepZ = 1 / (sz * 2 + 1);
  if (stepX < 0 || stepY < 0 || stepZ < 0) return 0;
  let clear = 0;
  let total = 0;
  const ox = (1 - Math.floor(1 / stepX) * stepX) / 2;
  const oz = (1 - Math.floor(1 / stepZ) * stepZ) / 2;
  for (let fx = 0; fx <= 1; fx += stepX)
    for (let fy = 0; fy <= 1; fy += stepY)
      for (let fz = 0; fz <= 1; fz += stepZ) {
        const px = box.minX + sx * fx + ox;
        const py = box.minY + sy * fy;
        const pz = box.minZ + sz * fz + oz;
        if (clearPath(w, px, py, pz, cx, cy, cz)) clear++;
        total++;
      }
  return total ? clear / total : 0;
}

function clearPath(w: ExplosionWorld, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const len = Math.hypot(dx, dy, dz);
  const steps = Math.ceil(len / 0.25);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    const s = w.getBlock(Math.floor(x0 + dx * t), Math.floor(y0 + dy * t), Math.floor(z0 + dz * t));
    if (s !== 0 && blocks.stateOpaque[s]) return false;
  }
  return true;
}

/** Damage dealt to an entity at distance `dist` with the given exposure (vanilla formula). */
export function explosionDamage(power: number, dist: number, exposureValue: number): number {
  const impact = (1 - dist / (power * 2)) * exposureValue;
  if (impact <= 0) return 0;
  return Math.floor((impact * impact + impact) * 7 * power + 1);
}
