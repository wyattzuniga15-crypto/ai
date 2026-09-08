/**
 * The copper golem: Mojang's oxidation timer, the model it is built from, and the chest run its
 * goal walks (the chests it takes from and the ones it fills).
 */
import { describe, expect, it } from 'vitest';
import { COPPER_GOLEM_FLOWER, COPPER_GOLEM_OXIDATION, COPPER_GOLEM_SKINS, MOB_SPECS, mobStats } from '../src/entities/mobTypes.ts';
import { COPPER_GOLEM_DESTINATIONS, COPPER_GOLEM_SOURCES, HAUL_IDLE_COOLDOWN, HAUL_INITIAL_COOLDOWN, HAUL_STACK, HAUL_SEARCH, transportItemsGoal, takeFlowerGoal } from '../src/entities/ai.ts';
import { blocks } from '../src/blocks/registry.ts';
import { copperAge } from '../src/blocks/copper.ts';
import { statueAge, statueModel } from '../src/blocks/copperStatue.ts';
import { drawnStates, placedModel } from '../src/blocks/blockEntityRender.ts';

describe('the copper golem', () => {
  it('carries the stats the data gives it', () => {
    const stats = mobStats('copper_golem');
    expect(stats).not.toBeNull();
    expect(stats!.health).toBe(12);
    expect(stats!.damage).toBe(0);
    expect(stats!.height).toBeCloseTo(0.98, 3);
  });

  it("oxidises on Mojang's own timer, three ages before it seizes up", () => {
    // twenty-one to twenty-three minutes an age, so about an hour from new copper to a statue
    expect(COPPER_GOLEM_OXIDATION).toEqual([25200, 27600]);
    expect(COPPER_GOLEM_OXIDATION[0] / 20 / 60).toBeCloseTo(21, 5);
    expect(COPPER_GOLEM_OXIDATION[1] / 20 / 60).toBeCloseTo(23, 5);
  });

  it('wears one skin per age, each with eyes to match', () => {
    expect(COPPER_GOLEM_SKINS).toEqual(['copper_golem', 'exposed_copper_golem', 'weathered_copper_golem', 'oxidized_copper_golem']);
    const model = MOB_SPECS.copper_golem.model;
    expect(model.texture).toBe('copper_golem/copper_golem.png');
    const eyes = model.parts.find((p) => p.name === 'eyes');
    expect(eyes?.texture).toBe('copper_golem/copper_golem_eyes.png');
    expect(eyes?.parent).toBe('head');
  });

  it('is built out of Mojang geometry: a head on a body on two legs, with the rod on top', () => {
    const parts = new Map(MOB_SPECS.copper_golem.model.parts.map((p) => [p.name, p]));
    expect([...parts.keys()]).toEqual(['root', 'body', 'head', 'eyes', 'right_arm', 'right_item', 'left_arm', 'right_leg', 'left_leg']);
    expect(parts.get('body')!.parent).toBe('root');
    expect(parts.get('head')!.parent).toBe('body');
    expect(parts.get('right_item')!.parent).toBe('right_arm');
    // the head's four boxes: the head itself, the beak, and the two of the lightning rod
    expect(parts.get('head')!.boxes).toHaveLength(4);
    // the model stands 24 px tall counting the rod, and the hitbox stops at the head's top
    const legTop = 24 - parts.get('right_leg')!.pivot[1];
    expect(legTop).toBe(5);
    const rod = parts.get('head')!.boxes[3];
    expect(24 - parts.get('head')!.pivot[1] - rod.box[1]).toBe(24);
    // the poppy it picks has no texture in the vanilla assets, so it is hung off the head as the
    // flower's own block model rather than being part of the net
    expect(parts.has('flower')).toBe(false);
    expect(COPPER_GOLEM_FLOWER).toEqual([12, 11]);
  });

  it('takes from copper chests and fills ordinary ones', () => {
    expect(COPPER_GOLEM_SOURCES).toHaveLength(8);
    for (const id of COPPER_GOLEM_SOURCES) {
      expect(blocks.has(id)).toBe(true);
      expect(copperAge(id)).toBeGreaterThanOrEqual(0);
    }
    expect(COPPER_GOLEM_DESTINATIONS).toEqual(['chest', 'trapped_chest']);
    expect(HAUL_STACK).toBe(16);
    expect(HAUL_SEARCH).toEqual([32, 8]);
    expect(HAUL_INITIAL_COOLDOWN).toBe(60);
    expect(HAUL_IDLE_COOLDOWN).toBe(140);
  });

  it('goes looking only once its cooldown has run down', () => {
    const goal = transportItemsGoal();
    let asked: string[] | null = null;
    const w = { findContainer: (_x: number, _y: number, _z: number, _h: number, _v: number, ids: string[]) => { asked = ids; return null; } };
    const m = { pos: { x: 0, y: 0, z: 0 }, extra: { haulCooldown: 2 } } as never;
    expect(goal.canUse(m, w as never)).toBe(false);
    expect((m as { extra: { haulCooldown: number } }).extra.haulCooldown).toBe(1);
    goal.canUse(m, w as never);
    goal.canUse(m, w as never);
    // empty-handed it hunts for a copper chest to raid
    expect(asked).toEqual(COPPER_GOLEM_SOURCES);
  });

  it('looks for a chest to fill once its hands are full', () => {
    const goal = transportItemsGoal();
    let asked: string[] | null = null;
    const w = { findContainer: (_x: number, _y: number, _z: number, _h: number, _v: number, ids: string[]) => { asked = ids; return null; } };
    const m = { pos: { x: 0, y: 0, z: 0 }, extra: { carrying: { id: 'iron_ingot', count: 4 } } } as never;
    goal.canUse(m, w as never);
    expect(asked).toEqual(COPPER_GOLEM_DESTINATIONS);
  });

  it('only picks a flower by day, and only when its head is bare', () => {
    const goal = takeFlowerGoal();
    const w = { isDay: () => true, findBlock: () => ({ x: 1, y: 0, z: 0, block: 'poppy' }) } as never;
    expect(goal.canUse({ pos: { x: 0, y: 0, z: 0 }, extra: {} } as never, w)).toBe(true);
    expect(goal.canUse({ pos: { x: 0, y: 0, z: 0 }, extra: { flower: true } } as never, w)).toBe(false);
    const night = { isDay: () => false, findBlock: () => ({ x: 1, y: 0, z: 0, block: 'poppy' }) } as never;
    expect(goal.canUse({ pos: { x: 0, y: 0, z: 0 }, extra: {} } as never, night)).toBe(false);
  });

  it('has a statue block to seize up into, in all four ages', () => {
    for (const [age, id] of ['copper_golem_statue', 'exposed_copper_golem_statue', 'weathered_copper_golem_statue', 'oxidized_copper_golem_statue'].entries()) {
      expect(blocks.has(id)).toBe(true);
      expect(blocks.get(id).states.map((s) => s.name)).toContain('copper_golem_pose');
      expect(statueAge(id)).toBe(age);
      expect(statueAge(`waxed_${id}`)).toBe(age);
      expect(statueModel(id, 'standing')!.texture).toBe(`copper_golem/${COPPER_GOLEM_SKINS[age]}.png`);
    }
    expect(statueAge('stone')).toBe(-1);
  });

  it('draws all four poses, the sitting one folded up the way Mojang authored it', () => {
    for (const pose of ['standing', 'sitting', 'running', 'star']) {
      const model = statueModel('copper_golem_statue', pose);
      expect(model, pose).not.toBeNull();
      expect(model!.parts.map((p) => p.name)).toEqual(['root', 'body', 'head', 'right_arm', 'left_arm', 'right_leg', 'left_leg']);
    }
    expect(statueModel('copper_golem_statue', 'dancing')).toBeNull();
    // only the sitting pose turns anything: both arms go back twenty-five degrees
    const sitting = statueModel('copper_golem_statue', 'sitting')!;
    for (const arm of ['right_arm', 'left_arm']) {
      expect(sitting.parts.find((p) => p.name === arm)!.rotation![0]).toBeCloseTo(-(25 * Math.PI) / 180, 3);
    }
    expect(statueModel('copper_golem_statue', 'standing')!.parts.every((p) => !p.rotation)).toBe(true);
  });

  it('is drawn as a block entity, since vanilla ships no model for it', () => {
    const state = blocks.stateWith('weathered_copper_golem_statue', { copper_golem_pose: 'running', facing: 'east', waterlogged: 'false' });
    expect(drawnStates[state]).toBe(1);
    const placed = placedModel(state);
    expect(placed?.model.texture).toBe('copper_golem/weathered_copper_golem.png');
    expect(placed?.yaw).toBeCloseTo(-Math.PI / 2, 5);
    expect(placed?.scale).toBe(1);
  });
});
