import { describe, expect, it } from 'vitest';
import { Mob } from '../src/entities/mob.ts';
import { mobStats } from '../src/entities/mobTypes.ts';

/** The model needs a DOM, so these drive the effect machinery on a stand-in, as the other tests do. */
const makeMob = (type: string): Mob => {
  const def = mobStats(type)!;
  return {
    def, extra: {}, health: def.health, maxHealth: def.health, dead: false, invulnerable: 0, hurtTime: 0,
    age: 0, effects: new Map(), addEffect: Mob.prototype.addEffect, effectLevel: Mob.prototype.effectLevel,
  } as unknown as Mob;
};

describe('effects on mobs', () => {
  it('keeps the stronger of two helpings, as vanilla does', () => {
    const m = makeMob('zombie');
    m.addEffect('poison', 100, 0);
    m.addEffect('poison', 40, 0);
    expect(m.effects.get('poison')?.ticks).toBe(100);
    m.addEffect('poison', 40, 1);
    expect(m.effects.get('poison')?.amplifier).toBe(1);
    expect(m.effectLevel('poison')).toBe(2);
    expect(m.effectLevel('speed')).toBe(0);
  });

  it('reads a level as vanilla writes it, one above the amplifier', () => {
    const m = makeMob('spider');
    m.addEffect('speed', 200, 2);
    expect(m.effectLevel('speed')).toBe(3);
    m.effects.delete('speed');
    expect(m.effectLevel('speed')).toBe(0);
  });
});
