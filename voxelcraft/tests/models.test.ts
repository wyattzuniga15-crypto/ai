import fs from 'node:fs';
import { describe, expect, it } from 'vitest';
import { ModelBaker, type ModelsJson } from '../src/world/models.ts';
import { AtlasIndex, type AtlasJson } from '../src/render/atlasIndex.ts';
import { blocks } from '../src/blocks/registry.ts';

const models = JSON.parse(fs.readFileSync('public/models.json', 'utf8')) as ModelsJson;
const atlas = new AtlasIndex(JSON.parse(fs.readFileSync('public/atlas/blocks.json', 'utf8')) as AtlasJson);
const baker = new ModelBaker(models, atlas);

describe('model baker', () => {
  it('bakes a full cube with six culled full faces', () => {
    const m = baker.modelFor(blocks.defaultState('stone'), 0);
    expect(m.quads.length).toBe(6);
    expect(m.fullFaces).toBe(63);
    for (const q of m.quads) expect(q.full).toBe(true);
    expect(m.quads[0].texture).toBe('block/stone');
    expect(m.quads[0].tile).toBe(atlas.tile('block/stone'));
  });

  it('gives grass block distinct top/side/bottom textures and a tinted overlay', () => {
    const m = baker.modelFor(blocks.defaultState('grass_block'), 0);
    const tex = new Set(m.quads.map((q) => q.texture));
    expect(tex.has('block/grass_block_top')).toBe(true);
    expect(tex.has('block/grass_block_side')).toBe(true);
    expect(tex.has('block/dirt')).toBe(true);
    expect(m.quads.some((q) => q.texture === 'block/grass_block_side_overlay' && q.tint === 0)).toBe(true);
    // random y rotations pick different variants but the same textures
    const m2 = baker.modelFor(blocks.defaultState('grass_block'), 0.9);
    expect(m2.quads.length).toBe(m.quads.length);
  });

  it('rotates stairs variants and keeps them non-occluding', () => {
    const s = blocks.stateWith('oak_stairs', { facing: 'east', half: 'bottom', shape: 'straight' });
    const m = baker.modelFor(s, 0);
    expect(m.quads.length).toBeGreaterThan(6);
    expect(blocks.stateOpaque[s]).toBe(0);
    expect(m.fullFaces & (1 << 0)).toBeTruthy(); // bottom face is full
    const n = baker.modelFor(blocks.stateWith('oak_stairs', { facing: 'north', half: 'bottom', shape: 'straight' }), 0);
    expect(n.quads.length).toBe(m.quads.length);
  });

  it('handles cross models and multipart fences', () => {
    const grass = baker.modelFor(blocks.defaultState('short_grass'), 0);
    expect(grass.quads.length).toBe(4);
    expect(grass.ao).toBe(false);
    for (const q of grass.quads) expect(q.cull).toBe(-1);
    const fence = baker.modelFor(blocks.stateWith('oak_fence', { north: 'true', south: 'true', east: 'false', west: 'false' }), 0);
    const lone = baker.modelFor(blocks.defaultState('oak_fence'), 0);
    expect(fence.quads.length).toBeGreaterThan(lone.quads.length);
  });

  it('bakes every block state without throwing and finds textures for nearly all', () => {
    let missing = 0;
    let states = 0;
    const missingNames = new Set<string>();
    for (const def of blocks.defs) {
      for (let s = def.min; s <= def.max; s++) {
        states++;
        const m = baker.modelFor(s, 0.5);
        for (const q of m.quads) if (q.tile === 0 && q.texture !== 'missingno') { missing++; missingNames.add(q.texture); }
      }
    }
    expect(states).toBeGreaterThan(20000);
    expect(missingNames.size).toBeLessThan(10);
  });

  it('resolves item models to sprites or block models', () => {
    expect(baker.itemModel('diamond_sword')).toMatchObject({ kind: 'sprite', textures: ['item/diamond_sword'] });
    const stone = baker.itemModel('stone', 'stone');
    expect(stone?.kind).toBe('model');
    expect(baker.itemModel('oak_planks', 'oak_planks')?.kind).toBe('model');
  });
});
