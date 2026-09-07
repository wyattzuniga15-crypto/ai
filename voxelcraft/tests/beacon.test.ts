import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { BEACON_EFFECTS, beaconRange, beamColors, effectAllowed, pyramidLevels, seesSky } from '../src/blocks/beacon.ts';
import { DYE_COLORS } from '../src/ui/specialIcons.ts';

/** A world of blocks in a map, which is all the beacon rules look at. */
class Site {
  readonly map = new Map<string, number>();

  getBlock(x: number, y: number, z: number): number {
    return this.map.get(`${x},${y},${z}`) ?? 0;
  }

  getSkyLight(): number {
    return 15;
  }

  set(x: number, y: number, z: number, id: string): void {
    this.map.set(`${x},${y},${z}`, blocks.defaultState(id));
  }

  /** Builds `levels` complete steps of pyramid under the beacon at the origin. */
  pyramid(levels: number, id = 'iron_block'): void {
    for (let level = 1; level <= levels; level++) {
      for (let dx = -level; dx <= level; dx++) for (let dz = -level; dz <= level; dz++) this.set(dx, -level, dz, id);
    }
  }
}

describe('beacons', () => {
  it('counts the complete steps of its pyramid and no more', () => {
    const w = new Site();
    expect(pyramidLevels(w, 0, 0, 0)).toBe(0);
    w.pyramid(2);
    expect(pyramidLevels(w, 0, 0, 0)).toBe(2);
    w.pyramid(4);
    expect(pyramidLevels(w, 0, 0, 0)).toBe(4);
    // one block missing from the top step and it drops back
    w.map.delete('1,-1,1');
    expect(pyramidLevels(w, 0, 0, 0)).toBe(0);
  });

  it('takes any of the blocks vanilla allows, and nothing else', () => {
    for (const id of ['iron_block', 'gold_block', 'emerald_block', 'diamond_block', 'netherite_block']) {
      const w = new Site();
      w.pyramid(1, id);
      expect(pyramidLevels(w, 0, 0, 0)).toBe(1);
    }
    const stone = new Site();
    stone.pyramid(1, 'stone');
    expect(pyramidLevels(stone, 0, 0, 0)).toBe(0);
  });

  it('needs a clear line to the sky, though glass does not stop it', () => {
    const w = new Site();
    expect(seesSky(w, 0, 0, 0)).toBe(true);
    w.set(0, 5, 0, 'blue_stained_glass');
    expect(seesSky(w, 0, 0, 0)).toBe(true);
    w.set(0, 8, 0, 'stone');
    expect(seesSky(w, 0, 0, 0)).toBe(false);
  });

  it('takes the beam colour from the glass over it', () => {
    const w = new Site();
    w.set(0, 3, 0, 'red_stained_glass');
    w.set(0, 6, 0, 'lime_stained_glass');
    expect(beamColors(w, 0, 0, 0, (d) => DYE_COLORS[d])).toEqual([DYE_COLORS.red, DYE_COLORS.lime]);
  });

  it('unlocks effects a level at a time, the way vanilla does', () => {
    expect(BEACON_EFFECTS[0]).toEqual(['speed', 'haste']);
    expect(effectAllowed('speed', 1)).toBe(true);
    expect(effectAllowed('resistance', 1)).toBe(false);
    expect(effectAllowed('resistance', 2)).toBe(true);
    expect(effectAllowed('strength', 3)).toBe(true);
    expect(effectAllowed('regeneration', 3)).toBe(false);
    expect(effectAllowed('regeneration', 4)).toBe(true);
  });

  it('reaches further with every level', () => {
    expect(beaconRange(1)).toBe(20);
    expect(beaconRange(4)).toBe(50);
  });
});
