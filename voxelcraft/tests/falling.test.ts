/**
 * Falling. Vanilla takes a heart for every block past the third, rounding the drop up, so a fall
 * that lands a hair short of a whole block still costs what the whole block would.
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/entities/player.ts';
import { Input } from '../src/core/input.ts';
import { blocks } from '../src/blocks/registry.ts';
import type { BlockSource } from '../src/entities/physics.ts';

const stone = blocks.defaultState('stone');
/** Solid ground below y=64, air above it. */
const ground: BlockSource = { getBlock: (_x: number, y: number) => (y < 64 ? stone : 0) };

const idle = () => ({ isDown: () => false, tickPressed: () => false }) as unknown as Input;

/** Drops a player from `height` blocks above the ground and returns the fall the game sees. */
function drop(height: number): number {
  const p = new Player();
  p.gamemode = 'survival';
  p.pos.set(0.5, 64 + height, 0.5);
  p.onGround = false;
  const input = idle();
  for (let t = 0; t < 400 && p.landed === 0; t++) p.tick(input, ground, t);
  return p.landed;
}

/** Hearts vanilla takes off for that drop. */
const damageOf = (fall: number): number => Math.max(0, Math.ceil(fall - 3));

describe('fall damage', () => {
  it('hurts for every block past the third, exactly as vanilla counts them', () => {
    // the ladder from a vanilla world: three blocks is free, four costs one heart, and so on
    for (const [height, hearts] of [[3, 0], [4, 1], [5, 2], [6, 3], [10, 7], [20, 17]] as const) {
      expect([height, damageOf(drop(height))]).toEqual([height, hearts]);
    }
  });

  it('measures the ground actually covered, landing tick and all', () => {
    // the tick that lands still fell: dropping the last part of it left every fall a block short
    for (const height of [4, 7, 12]) {
      const fall = drop(height);
      expect(fall).toBeGreaterThan(height - 1);
      expect(fall).toBeLessThanOrEqual(height + 0.01);
    }
  });

  it('rounds the drop up rather than down', () => {
    // 5.5 blocks is 2.5 past the free three, which vanilla charges as three hearts, not two
    expect(damageOf(5.5)).toBe(3);
    expect(damageOf(3.2)).toBe(1);
    expect(damageOf(3)).toBe(0);
  });
});
