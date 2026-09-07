import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { drawnStates, placedModel } from '../src/blocks/blockEntityRender.ts';

const state = (id: string, props: Record<string, string> = {}) =>
  (Object.keys(props).length ? blocks.stateWith(id, props) : blocks.defaultState(id));

describe('blocks vanilla draws itself', () => {
  it('marks every bed, banner, shulker box, skull and the conduit', () => {
    for (const id of ['red_bed', 'blue_banner', 'yellow_wall_banner', 'purple_shulker_box', 'shulker_box', 'skeleton_skull', 'zombie_wall_head', 'conduit']) {
      const def = blocks.get(id);
      for (let s = def.min; s <= def.max; s++) expect(drawnStates[s]).toBe(1);
    }
    expect(drawnStates[state('stone')]).toBe(0);
    expect(drawnStates[state('chest')]).toBe(0); // chests have a renderer of their own
  });

  it('draws a bed once, from the head end, two blocks long', () => {
    const head = placedModel(state('red_bed', { facing: 'south', part: 'head', occupied: 'false' }));
    const foot = placedModel(state('red_bed', { facing: 'south', part: 'foot', occupied: 'false' }));
    expect(foot).toBeNull();
    expect(head?.model.texture).toBe('bed/red.png');
    expect(head?.offset).toEqual([0, 0, 1]);
    expect(head?.yaw).toBeCloseTo(Math.PI, 5);
    expect(placedModel(state('red_bed', { facing: 'north', part: 'head', occupied: 'false' }))?.yaw).toBe(0);
  });

  it('turns a standing banner by its sixteenth and hangs a wall one lower', () => {
    const standing = placedModel(state('blue_banner', { rotation: '4' }));
    // the base cloth takes the banner's own dye, and each woven layer takes its own
    expect(standing?.tints?.[0]).toEqual({ texture: 'banner/base.png', color: 0x3c44aa });
    expect(standing?.yaw).toBeCloseTo(Math.PI / 2, 5);
    expect(standing?.scale).toBeCloseTo(2 / 3, 5);
    const wall = placedModel(state('blue_banner'.replace('banner', 'wall_banner'), { facing: 'south' }));
    expect(wall?.offset[1]).toBeLessThan(standing!.offset[1]);
    // a wall banner has no pole, which is the one part vanilla drops
    expect(standing?.model.parts.some((p) => p.name === 'pole')).toBe(true);
    expect(wall?.model.parts.some((p) => p.name === 'pole')).toBe(false);

    // woven patterns each become a piece of cloth of their own, in their own colour
    const woven = placedModel(state('white_banner', { rotation: '0' }), [{ pattern: 'creeper', color: 'lime' }]);
    expect(woven?.model.parts.filter((p) => p.name.startsWith('flag'))).toHaveLength(2);
    expect(woven?.tints?.[1]).toEqual({ texture: 'banner/creeper.png', color: 0x80c71f });
  });

  it('gives each skull its own texture and sits it on the block', () => {
    expect(placedModel(state('skeleton_skull', { rotation: '0', powered: 'false' }))?.model.texture).toBe('skeleton/skeleton.png');
    expect(placedModel(state('creeper_head', { rotation: '0', powered: 'false' }))?.model.texture).toBe('creeper/creeper.png');
    const wall = placedModel(state('zombie_wall_head', { facing: 'east', powered: 'false' }));
    expect(wall?.model.texture).toBe('zombie/zombie.png');
    expect(wall?.offset[1]).toBeGreaterThan(0); // a wall head sits higher than one on the floor
  });

  it('has nothing to say about ordinary blocks', () => {
    expect(placedModel(state('stone'))).toBeNull();
    expect(placedModel(0)).toBeNull();
  });
});
