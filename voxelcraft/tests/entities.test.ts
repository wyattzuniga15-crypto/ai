import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { explode, explosionDamage, exposure } from '../src/world/explosion.ts';
import { Rng } from '../src/core/rng.ts';
import { entityDrops } from '../src/items/loot.ts';
import { mobStats, MOB_SPECS } from '../src/entities/mobTypes.ts';
import { boxGeometry } from '../src/entities/boxModel.ts';
import { isBreedingFood, isSlimeChunk, pickHostile, randomSheepColor, wolfVariantFor } from '../src/entities/mobTypes.ts';
import { biomes as allBiomes } from '../src/world/biomes.ts';

class Grid {
  map = new Map<string, number>();
  destroyed: string[] = [];
  fill(x1: number, y1: number, z1: number, x2: number, y2: number, z2: number, id: string) {
    for (let x = x1; x <= x2; x++) for (let y = y1; y <= y2; y++) for (let z = z1; z <= z2; z++) this.map.set(`${x},${y},${z}`, blocks.defaultState(id));
  }
  getBlock(x: number, y: number, z: number) {
    return this.map.get(`${x},${y},${z}`) ?? 0;
  }
  destroyBlock(x: number, y: number, z: number) {
    this.destroyed.push(`${x},${y},${z}`);
    this.map.delete(`${x},${y},${z}`);
  }
}

describe('explosions', () => {
  it('a creeper blast carves a crater in dirt but not bedrock or obsidian', () => {
    const g = new Grid();
    g.fill(-8, 0, -8, 8, 4, 8, 'dirt');
    g.fill(-8, 0, -8, 8, 0, 8, 'bedrock');
    g.map.set('3,3,0', blocks.defaultState('obsidian'));
    const destroyed = explode(g, 0.5, 4.5, 0.5, 3, new Rng(7));
    expect(destroyed.length).toBeGreaterThan(20);
    expect(destroyed.length).toBeLessThan(120);
    expect(blocks.idOf(g.getBlock(0, 0, 0))).toBe('bedrock');
    expect(blocks.idOf(g.getBlock(3, 3, 0))).toBe('obsidian');
    expect(g.getBlock(0, 4, 0)).toBe(0);
    expect(g.getBlock(0, 3, 0)).toBe(0);
  });

  it('damage falls off with distance and cover', () => {
    const g = new Grid();
    expect(explosionDamage(3, 0, 1)).toBe(43);
    expect(explosionDamage(3, 3, 1)).toBe(16);
    expect(explosionDamage(3, 6, 1)).toBe(0);
    const open = exposure(g, 0, 1, 0, { minX: 2, minY: 0, minZ: -0.3, maxX: 2.6, maxY: 1.8, maxZ: 0.3 });
    expect(open).toBe(1);
    g.fill(1, 0, -2, 1, 3, 2, 'stone');
    const covered = exposure(g, 0, 1, 0, { minX: 2, minY: 0, minZ: -0.3, maxX: 2.6, maxY: 1.8, maxZ: 0.3 });
    expect(covered).toBeLessThan(0.2);
  });
});

describe('mobs', () => {
  it('has vanilla stats for the first mobs', () => {
    expect(mobStats('zombie')).toMatchObject({ health: 20, damage: 3, width: 0.6, height: 1.95, disposition: 'hostile' });
    expect(mobStats('creeper')).toMatchObject({ health: 20, width: 0.6, height: 1.7 });
    expect(mobStats('cow')).toMatchObject({ health: 10, disposition: 'passive' });
    expect(mobStats('chicken')?.height).toBe(0.7);
    for (const id of Object.keys(MOB_SPECS)) expect(mobStats(id), id).not.toBeNull();
    expect(mobStats('warden')).toBeNull();
  });

  it('drops vanilla loot', () => {
    const seq = (v: number[]) => {
      let i = 0;
      return () => v[i++ % v.length];
    };
    expect(entityDrops('cow', true, 0, false, seq([0.5]))).toEqual([{ id: 'leather', count: 1 }, { id: 'beef', count: 2 }]);
    expect(entityDrops('cow', true, 0, true, seq([0.5]))[1].id).toBe('cooked_beef');
    expect(entityDrops('creeper', true, 0, false, seq([0.5]))).toEqual([{ id: 'gunpowder', count: 1 }]);
    const zombie = entityDrops('zombie', true, 0, false, seq([0.5]));
    expect(zombie.find((d) => d.id === 'rotten_flesh')?.count).toBe(1);
    // rare drops need killed_by_player and a low roll
    const rare = entityDrops('zombie', true, 0, false, seq([0.001]));
    expect(rare.some((d) => d.id === 'iron_ingot' || d.id === 'carrot' || d.id === 'potato')).toBe(true);
    expect(entityDrops('zombie', false, 0, false, seq([0.001])).some((d) => d.id === 'iron_ingot' || d.id === 'carrot' || d.id === 'potato')).toBe(false);
  });

  it('builds box geometry with the standard texture net', () => {
    const geo = boxGeometry({ uv: [0, 0], box: [-4, -8, -4, 8, 8, 8] }, 64, 64);
    const uv = geo.getAttribute('uv');
    // front face (nz, face index 5): top-left texel (8, 8) of a 64x64 texture
    expect(uv.getX(5 * 4)).toBeCloseTo(8 / 64);
    expect(uv.getY(5 * 4)).toBeCloseTo(1 - 8 / 64);
    expect(uv.getX(5 * 4 + 1)).toBeCloseTo(16 / 64);
    // top face (py): comes from the (8,0)-(16,8) region
    const ys = [0, 1, 2, 3].map((i) => uv.getY(2 * 4 + i));
    expect(Math.min(...ys)).toBeCloseTo(1 - 8 / 64);
    expect(Math.max(...ys)).toBeCloseTo(1);
    const pos = geo.getAttribute('position');
    let minY = Infinity, maxY = -Infinity;
    for (let i = 0; i < pos.count; i++) { minY = Math.min(minY, pos.getY(i)); maxY = Math.max(maxY, pos.getY(i)); }
    expect(minY).toBeCloseTo(0);
    expect(maxY).toBeCloseTo(8);
  });
});

describe('new mob types', () => {
  it('derives slime sizes and scaled variants from shared data', () => {
    const small = mobStats('slime')!, medium = mobStats('slime_medium')!, big = mobStats('slime_big')!;
    expect([small.health, medium.health, big.health]).toEqual([1, 4, 16]);
    expect([small.width, medium.width, big.width]).toEqual([0.51, 1.02, 2.04]);
    expect([small.scale, medium.scale, big.scale]).toEqual([1, 2, 4]);
    expect(small.loot).toBe('slime');
    expect(big.loot).toBe('slime_big');
    expect(mobStats('wither_skeleton')!.scale).toBe(1.2);
    expect(mobStats('husk')!.burnsInSun).toBeFalsy();
    expect(mobStats('drowned')!.burnsInSun).toBe(true);
    expect(mobStats('enderman')!.health).toBe(40);
    for (const id of ['husk', 'drowned', 'stray', 'wither_skeleton', 'cave_spider', 'slime', 'slime_medium', 'slime_big', 'enderman']) expect(mobStats(id), id).toBeTruthy();
  });

  it('marks about one chunk in ten as a slime chunk, deterministically', () => {
    let n = 0;
    for (let cx = -20; cx < 20; cx++) for (let cz = -25; cz < 25; cz++) if (isSlimeChunk(cx, cz, 12345)) n++;
    expect(n).toBeGreaterThan(140); // 2000 chunks, 10% expected
    expect(n).toBeLessThan(260);
    expect(isSlimeChunk(3, -7, 12345)).toBe(isSlimeChunk(3, -7, 12345));
    expect(isSlimeChunk(3, -7, 12345)).toBe(isSlimeChunk(3, -7, 12345));
    expect(isSlimeChunk(3, -7, 12345) === isSlimeChunk(3, -7, 99)).toBe(isSlimeChunk(3, -7, 12345) === isSlimeChunk(3, -7, 99)); // seeds differ, values may too
  });

  it('follows vanilla biome substitutions when picking monsters', () => {
    let seq = 0;
    const rng = () => { seq = (seq * 1103515245 + 12345) % 2147483648; return seq / 2147483648; };
    const desert = allBiomes.find((b) => b.category === 'desert');
    const snowy = allBiomes.find((b) => b.precipitation === 'snow');
    const swamp = allBiomes.find((b) => b.category === 'swamp');
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) { const t = pickHostile(rng, desert, 64, false); counts[t] = (counts[t] ?? 0) + 1; }
    expect(counts.husk).toBeGreaterThan(counts.zombie ?? 0);
    expect(counts.stray).toBeUndefined();
    const snow: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) { const t = pickHostile(rng, snowy, 64, false); snow[t] = (snow[t] ?? 0) + 1; }
    expect(snow.stray).toBeGreaterThan(snow.skeleton ?? 0);
    const swampy = new Set<string>();
    for (let i = 0; i < 500; i++) swampy.add(pickHostile(rng, swamp, 60, false));
    expect(swampy.has('slime') || swampy.has('slime_medium') || swampy.has('slime_big')).toBe(true);
    const deep = new Set<string>();
    for (let i = 0; i < 500; i++) deep.add(pickHostile(rng, desert, 20, true));
    expect(deep.has('slime_big') || deep.has('slime')).toBe(true);
    for (let i = 0; i < 500; i++) expect(pickHostile(rng, desert, 20, false).startsWith('slime')).toBe(false);
  });

  it('knows vanilla breeding foods and sheep colour odds', () => {
    expect(isBreedingFood('cow', 'wheat')).toBe(true);
    expect(isBreedingFood('pig', 'carrot')).toBe(true);
    expect(isBreedingFood('pig', 'wheat')).toBe(false);
    expect(isBreedingFood('chicken', 'wheat_seeds')).toBe(true);
    expect(isBreedingFood('zombie', 'wheat')).toBe(false);
    let seq = 7;
    const rng = () => { seq = (seq * 1103515245 + 12345) % 2147483648; return seq / 2147483648; };
    const counts: Record<string, number> = {};
    for (let i = 0; i < 10000; i++) { const c = randomSheepColor(rng); counts[c] = (counts[c] ?? 0) + 1; }
    expect(counts.white).toBeGreaterThan(7500);
    for (const c of ['black', 'gray', 'light_gray']) { expect(counts[c]).toBeGreaterThan(350); expect(counts[c]).toBeLessThan(650); }
    expect(counts.brown).toBeGreaterThan(200);
    expect(counts.brown).toBeLessThan(400);
    expect(counts.pink ?? 0).toBeLessThan(60);
  });

  it('has wolves and fish with vanilla stats and biome variants', () => {
    expect(mobStats('wolf')!.health).toBe(8);
    expect(mobStats('cod')!.aquatic).toBe(true);
    expect(mobStats('salmon')!.width).toBe(0.7);
    expect(wolfVariantFor('taiga')).toBe('pale');
    expect(wolfVariantFor('snowy_taiga')).toBe('ashen');
    expect(wolfVariantFor('forest')).toBe('woods');
    expect(wolfVariantFor('bamboo_jungle')).toBe('rusty');
    expect(wolfVariantFor('plains')).toBeNull();
    expect(isBreedingFood('wolf', 'cooked_beef')).toBe(true);
  });
});
