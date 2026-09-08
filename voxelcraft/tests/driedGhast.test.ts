/**
 * The dried ghast: a block that soaks up water a hydration step at a time, dries back out on land,
 * and at the top of the scale splits open and lets a ghastling out.
 */
import { describe, expect, it } from 'vitest';
import { HYDRATION_STEP, MAX_HYDRATION, hydrationOf, hydrationTick, inWater, withHydration } from '../src/blocks/driedGhast.ts';
import { blocks } from '../src/blocks/registry.ts';
import { createBlockEntity, type DriedGhastEntity } from '../src/blocks/blockEntity.ts';
import { GHASTLING_FOOD, GHASTLING_GROW, GHASTLING_SCALE, GHASTLING_TEXTURE, mobStats } from '../src/entities/mobTypes.ts';
import { craftingRecipes } from '../src/items/crafting.ts';

const dry = () => blocks.defaultState('dried_ghast');
const nothing = () => 'air';

describe('the block', () => {
  it('is in the game with all four of vanilla\'s hydration levels', () => {
    expect(blocks.has('dried_ghast')).toBe(true);
    const def = blocks.get('dried_ghast');
    const hydration = def.states.find((s) => s.name === 'hydration');
    expect(hydration!.values).toEqual(['0', '1', '2', '3']);
    expect(MAX_HYDRATION).toBe(3);
    expect(def.states.map((s) => s.name)).toContain('waterlogged');
    expect(def.states.map((s) => s.name)).toContain('facing');
  });

  it('reads and writes its hydration, and will not go past either end', () => {
    expect(hydrationOf(dry())).toBe(0);
    expect(hydrationOf(withHydration(dry(), 2))).toBe(2);
    expect(hydrationOf(withHydration(dry(), 9))).toBe(MAX_HYDRATION);
    expect(hydrationOf(withHydration(dry(), -3))).toBe(0);
  });

  it('keeps a soak counter of its own once it is placed', () => {
    const e = createBlockEntity('dried_ghast') as DriedGhastEntity;
    expect(e.type).toBe('dried_ghast');
    expect(e.soak).toBe(0);
    expect(e.wet).toBe(false);
  });

  it('counts as wet when it has drunk the water in or when any side touches it', () => {
    expect(inWater(dry(), nothing)).toBe(false);
    expect(inWater(blocks.withProp(dry(), 'waterlogged', 'true'), nothing)).toBe(true);
    expect(inWater(dry(), (dx, dy, dz) => (dx === 0 && dy === 1 && dz === 0 ? 'water' : 'air'))).toBe(true);
    expect(inWater(dry(), (dx, dy, dz) => (dx === -1 && dy === 0 && dz === 0 ? 'water' : 'air'))).toBe(true);
    expect(inWater(dry(), () => 'lava')).toBe(false);
  });
});

describe('soaking', () => {
  /** Runs the block for `ticks`, returning where it ends up. */
  const run = (ticks: number, wet: boolean, from = 0) => {
    let hydration = from;
    let soak = 0;
    let wasWet = wet;
    let hatched = 0;
    for (let i = 0; i < ticks; i++) {
      const step = hydrationTick(hydration, soak, wet, wasWet);
      hydration = step.hydration;
      soak = step.soak;
      wasWet = wet;
      if (step.hatch) hatched++;
    }
    return { hydration, hatched };
  };

  it('climbs a step every five minutes in water', () => {
    expect(run(HYDRATION_STEP - 1, true).hydration).toBe(0);
    expect(run(HYDRATION_STEP, true).hydration).toBe(1);
    expect(run(HYDRATION_STEP * 2, true).hydration).toBe(2);
    expect(run(HYDRATION_STEP * 3, true).hydration).toBe(3);
  });

  it('lets a ghastling out a step past the top, twenty minutes in', () => {
    expect(run(HYDRATION_STEP * 4 - 1, true).hatched).toBe(0);
    expect(run(HYDRATION_STEP * 4, true).hatched).toBe(1);
    expect(HYDRATION_STEP * 4).toBe(24000);
  });

  it('dries back out on land, and then stays where it is', () => {
    expect(run(HYDRATION_STEP, false, 3).hydration).toBe(2);
    expect(run(HYDRATION_STEP * 3, false, 3).hydration).toBe(0);
    expect(run(HYDRATION_STEP * 9, false, 3).hydration).toBe(0);
    expect(run(HYDRATION_STEP * 9, false, 0).hatched).toBe(0);
  });

  it('starts the count again when it goes in or comes out of the water', () => {
    const half = hydrationTick(1, HYDRATION_STEP - 1, false, true);
    expect(half.soak).toBe(0);
    expect(half.changed).toBe(false);
    expect(half.hydration).toBe(1);
  });
});

describe('the ghastling that comes out', () => {
  it('is a happy ghast, shrunk to under a quarter and on its own skin', () => {
    const stats = mobStats('happy_ghast')!;
    expect(stats.babyScale).toBeCloseTo(0.2375, 5);
    expect(GHASTLING_SCALE).toBeCloseTo(0.2375, 5);
    expect(GHASTLING_TEXTURE).toBe('ghast/happy_ghast_baby.png');
    // a four-block ghast comes out under a block across
    expect(stats.width * GHASTLING_SCALE).toBeLessThan(1);
  });

  it('grows up in twenty minutes, and sooner for a snowball', () => {
    expect(GHASTLING_GROW).toBe(24000);
    expect(GHASTLING_FOOD).toBe('snowball');
  });
});

describe('getting one', () => {
  it('is eight ghast tears round a lump of soul sand', () => {
    const made = craftingRecipes.find((r) => r.result.item === 'dried_ghast')!;
    expect(made.type).toBe('shaped');
    expect(made.pattern).toEqual(['###', '#X#', '###']);
    expect(made.key!['#']).toBe('ghast_tear');
    expect(made.key!.X).toBe('soul_sand');
  });
});
