import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ModelBaker, type ModelsJson } from '../src/world/models.ts';
import { AtlasIndex, type AtlasJson } from '../src/render/atlasIndex.ts';
import { blocks } from '../src/blocks/registry.ts';
import { ChunkData } from '../src/world/chunk.ts';
import { SectionMesher, faceOrientation, greedyEligible, greedyOptions, type MeshBuffers } from '../src/world/mesher.ts';
import { WORLD_MIN_Y } from '../src/core/constants.ts';

const models = JSON.parse(fs.readFileSync('public/models.json', 'utf8')) as ModelsJson;
const atlas = new AtlasIndex(JSON.parse(fs.readFileSync('public/atlas/blocks.json', 'utf8')) as AtlasJson);
const baker = new ModelBaker(models, atlas);
const SY = 4; // section with y0 = 0

function world(fill: (c: ChunkData) => void): SectionMesher {
  const c = new ChunkData(0, 0);
  c.light.fill(0xf0); // full sky light everywhere
  fill(c);
  return new SectionMesher({ getChunk: (cx, cz) => (cx === 0 && cz === 0 ? c : undefined) }, baker, atlas);
}

/** Summed quad area per face direction (0..5 like DIR_OFFSETS) from the emitted geometry. */
function areas(m: MeshBuffers): number[] {
  const out = [0, 0, 0, 0, 0, 0];
  const p = m.position;
  for (let q = 0; q < p.length / 12; q++) {
    const r = (x: number) => Math.round(x * 1e6) / 1e6; // rotated variants carry 1e-16 noise
    const v = (i: number) => [r(p[q * 12 + i * 3]), r(p[q * 12 + i * 3 + 1]), r(p[q * 12 + i * 3 + 2])];
    const [a, b, c, d] = [v(0), v(1), v(2), v(3)];
    const e1 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
    const e2 = [d[0] - a[0], d[1] - a[1], d[2] - a[2]];
    const n = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
    const area = Math.hypot(...n);
    // rectangles: pick the constant axis; use the vertex positions to decide the side
    const nz = n.filter((v) => v !== 0).length;
    if (nz !== 1) throw new Error(`quad ${q} is not axis aligned: ${[a, b, c, d].map((v) => v.join(',')).join(' | ')}`);
    const axis = n[0] !== 0 ? 0 : n[1] !== 0 ? 1 : 2;
    const positive = n[axis] > 0;
    // DIR_OFFSETS order: -y, +y, -z, +z, -x, +x
    out[(axis === 1 ? 0 : axis === 2 ? 2 : 4) + (positive ? 1 : 0)] += area;
  }
  return out;
}

describe('greedy meshing', () => {
  it('classifies plain cubes and unit faces', () => {
    const stone = baker.modelFor(blocks.defaultState('stone'), 0);
    expect(greedyEligible(stone)).toBe(true);
    expect(greedyEligible(baker.modelFor(blocks.defaultState('oak_stairs'), 0))).toBe(false);
    for (const q of stone.quads) {
      const a = q.dir < 4 ? 0 : 1, b = q.dir < 2 ? 2 : q.dir < 4 ? 1 : 2;
      expect(faceOrientation(q, a, b)).toBeGreaterThanOrEqual(0);
    }
  });

  it('merges a uniformly lit stone brick slab into six quads', () => {
    const y = WORLD_MIN_Y + SY * 16 + 5;
    const mesher = world((c) => {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.set(x, y, z, blocks.defaultState('stone_bricks'));
    });
    const { solid } = mesher.mesh(0, SY, 0);
    expect(solid).not.toBeNull();
    expect(solid!.position.length / 3).toBe(24);
    expect(solid!.index.length).toBe(36);
    // the top face repeats the tile 16×16 times
    let maxU = 0, maxV = 0;
    for (let i = 0; i < solid!.uv.length; i += 2) { maxU = Math.max(maxU, solid!.uv[i]); maxV = Math.max(maxV, solid!.uv[i + 1]); }
    expect(maxU).toBe(16);
    expect(maxV).toBe(16);
    expect(areas(solid!)).toEqual([256, 256, 16, 16, 16, 16]);
  });

  it('keeps every visible face when lighting is not uniform', () => {
    const y = WORLD_MIN_Y + SY * 16 + 5;
    const mesher = world((c) => {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.set(x, y, z, blocks.defaultState(((x + z) & 1) ? 'stone_bricks' : 'oak_planks'));
      c.set(7, y + 1, 7, blocks.defaultState('stone_bricks')); // breaks AO uniformity around it
    });
    const { solid } = mesher.mesh(0, SY, 0);
    // checkerboard tops cannot merge across tiles: 256 top faces less the covered one plus the cube's top
    expect(areas(solid!)).toEqual([256, 256, 16 + 1, 16 + 1, 16 + 1, 16 + 1]);
    expect(solid!.position.length / 3).toBeGreaterThan(24);
    expect(solid!.index.length % 6).toBe(0);
  });

  it('never merges across different blocks or light levels', () => {
    const y = WORLD_MIN_Y + SY * 16 + 5;
    const mesher = world((c) => {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.set(x, y, z, blocks.defaultState(x < 8 ? 'stone_bricks' : 'oak_planks'));
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) if (z >= 8) c.setSky(x, y + 1, z, 10); // darker half above
    });
    const { solid } = mesher.mesh(0, SY, 0);
    // Top faces: 2 blocks × 2 light regions merge into 4 quads. Smooth lighting blends across the
    // light boundary (rows z=7 and z=8: 32 faces) and against the unloaded neighbours, which read
    // as full sky light (row z=15: 16 faces, columns x=0 and x=15 for z=9..14: 12 faces), so those
    // 60 faces stay single quads. Bottom: 2 merged quads. Sides: west/east 1 each, north/south 2 each.
    expect(solid!.position.length / 3).toBe((4 + 60 + 2 + 1 + 1 + 2 + 2) * 4);
    expect(areas(solid!)).toEqual([256, 256, 16, 16, 16, 16]);
  });

  it('merges vanilla random variants only when asked', () => {
    const y = WORLD_MIN_Y + SY * 16 + 5;
    const build = () => world((c) => {
      for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) c.set(x, y, z, blocks.defaultState('stone'));
    });
    const exact = build().mesh(0, SY, 0).solid!;
    expect(exact.position.length / 3).toBeGreaterThan(24); // stone has four rotated/mirrored variants
    expect(areas(exact)).toEqual([256, 256, 16, 16, 16, 16]);
    greedyOptions.mergeVariants = true;
    try {
      const merged = build().mesh(0, SY, 0).solid!;
      expect(merged.position.length / 3).toBe(24);
      expect(areas(merged)).toEqual([256, 256, 16, 16, 16, 16]);
    } finally {
      greedyOptions.mergeVariants = false;
    }
  });
});
