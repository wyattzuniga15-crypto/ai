/**
 * Getting out of the water. Vanilla lifts a swimmer at 0.3 whenever they are pressed sideways into
 * something and the box 0.6 above where the tick started is clear — that, and not the jump key, is
 * what carries a player onto the bank. Without it deep water was a trap: you could reach the wall
 * and nothing more.
 */
import { describe, expect, it } from 'vitest';
import { Player } from '../src/entities/player.ts';
import { Input } from '../src/core/input.ts';
import { blocks } from '../src/blocks/registry.ts';
import type { BlockSource } from '../src/entities/physics.ts';

const stone = blocks.defaultState('stone');
const water = blocks.defaultState('water');

/**
 * A pool floored at y=64 and filled to y=68, with a stone bank from x>=4 whose top is level with
 * the surface. Everything above the water and to the west of the bank is open air.
 */
const pool: BlockSource = {
  getBlock: (x: number, y: number, z: number) => {
    if (y < 64) return stone;
    if (Math.abs(z) > 8) return stone;
    if (y >= 68) return 0;
    return x >= 4 ? stone : water;
  },
};

/** Holds one key down and nothing else. */
const holding = (...keys: string[]): Input =>
  ({ isDown: (a: string) => keys.includes(a), tickPressed: () => false }) as unknown as Input;

/** Swims east for up to `ticks` ticks, stopping once the player is dry and standing. */
function swimEast(input: Input, ticks = 200): Player {
  const p = new Player();
  p.gamemode = 'survival';
  p.pos.set(0.5, 65, 0.5);
  p.yaw = -Math.PI / 2; // +x
  for (let t = 0; t < ticks; t++) {
    p.tick(input, pool, t);
    if (p.onGround && !p.inWater && p.pos.y >= 68) break;
  }
  return p;
}

describe('swimming out of water', () => {
  it('carries a swimmer up the bank and onto it', () => {
    const p = swimEast(holding('forward'));
    expect([Math.round(p.pos.y * 100) / 100, p.inWater, p.onGround]).toEqual([68, false, true]);
    expect(p.pos.x).toBeGreaterThan(4);
  });

  it('needs no jump key to do it, the way vanilla needs none', () => {
    // the old code only rose on a jump press from the floor of the pool, so holding nothing but
    // forward left the player pinned against the wall at the bottom
    const p = swimEast(holding('forward'), 200);
    expect(p.pos.y).toBeGreaterThan(67);
  });

  it('leaves a swimmer in open water alone, sinking as before', () => {
    const p = new Player();
    p.gamemode = 'survival';
    p.pos.set(-4.5, 67, 0.5);
    p.yaw = Math.PI / 2; // away from the bank, into open water
    const input = holding('forward');
    for (let t = 0; t < 60; t++) p.tick(input, pool, t);
    expect(p.pos.y).toBeLessThan(67);
    expect(p.inWater).toBe(true);
  });

  it('does not lift a swimmer with no room above, such as under an overhang', () => {
    // a pool roofed over at the waterline: pressed against the wall, but the 0.6 above is solid
    const roofed: BlockSource = {
      getBlock: (x: number, y: number, z: number) => {
        if (y < 64 || Math.abs(z) > 8) return stone;
        if (y >= 66) return stone;
        return x >= 4 ? stone : water;
      },
    };
    const p = new Player();
    p.gamemode = 'survival';
    p.pos.set(0.5, 64, 0.5);
    const input = holding('forward');
    p.yaw = -Math.PI / 2;
    for (let t = 0; t < 80; t++) p.tick(input, roofed, t);
    expect(p.pos.y).toBeLessThan(64.5);
  });
});
