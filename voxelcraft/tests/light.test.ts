import { describe, expect, it } from 'vitest';
import { blocks } from '../src/blocks/registry.ts';
import { LightEngine } from '../src/world/light.ts';
import { ChunkData } from '../src/world/chunk.ts';

const emit = (id: string, props: Record<string, string> = {}) => blocks.stateEmit[blocks.stateWith(id, props)];

describe('light a block gives off', () => {
  it('depends on the state it is in, as vanilla\'s does', () => {
    expect(emit('furnace', { lit: 'true', facing: 'north' })).toBe(13);
    expect(emit('furnace', { lit: 'false', facing: 'north' })).toBe(0);
    expect(emit('campfire', { lit: 'true' })).toBe(15);
    expect(emit('campfire', { lit: 'false' })).toBe(0);
    expect(emit('soul_campfire', { lit: 'true' })).toBe(10);
    expect(emit('redstone_lamp', { lit: 'true' })).toBe(15);
    expect(emit('redstone_lamp', { lit: 'false' })).toBe(0);
    expect(emit('redstone_torch', { lit: 'true' })).toBe(7);
    expect(emit('redstone_ore', { lit: 'true' })).toBe(9);
  });

  it('counts the candles on a candle, and the charges in an anchor', () => {
    expect(emit('candle', { lit: 'true', candles: '1' })).toBe(3);
    expect(emit('candle', { lit: 'true', candles: '4' })).toBe(12);
    expect(emit('candle', { lit: 'false', candles: '4' })).toBe(0);
    expect(emit('red_candle', { lit: 'true', candles: '2' })).toBe(6);
    expect(emit('respawn_anchor', { charges: '0' })).toBe(0);
    expect(emit('respawn_anchor', { charges: '4' })).toBe(15);
    expect(emit('sea_pickle', { pickles: '4', waterlogged: 'true' })).toBe(15);
    expect(emit('sea_pickle', { pickles: '4', waterlogged: 'false' })).toBe(0);
    expect(emit('cave_vines', { berries: 'true', age: '0' })).toBe(14);
    expect(emit('cave_vines', { berries: 'false', age: '0' })).toBe(0);
  });

  it('weathers with the copper bulbs, waxed or not', () => {
    expect(emit('copper_bulb', { lit: 'true', powered: 'false' })).toBe(15);
    expect(emit('exposed_copper_bulb', { lit: 'true', powered: 'false' })).toBe(12);
    expect(emit('weathered_copper_bulb', { lit: 'true', powered: 'false' })).toBe(8);
    expect(emit('oxidized_copper_bulb', { lit: 'true', powered: 'false' })).toBe(4);
    expect(emit('waxed_oxidized_copper_bulb', { lit: 'true', powered: 'false' })).toBe(4);
    expect(emit('waxed_copper_bulb', { lit: 'false', powered: 'false' })).toBe(0);
  });

  it('leaves the blocks that always glow the same as they were', () => {
    expect(emit('glowstone')).toBe(15);
    expect(emit('sea_lantern')).toBe(15);
    expect(emit('torch')).toBe(14);
    expect(emit('stone')).toBe(0);
  });
});

describe('the light engine', () => {
  it('spreads a new light through a room and takes it back when it goes', () => {
    const chunk = new ChunkData(0, 0);
    const stone = blocks.defaultState('stone');
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 20; y < 40; y++) chunk.set(x, y, z, stone);
    for (let x = 2; x < 14; x++) for (let z = 2; z < 14; z++) for (let y = 25; y < 30; y++) chunk.set(x, y, z, 0);
    const light = new LightEngine({ getChunk: (cx: number, cz: number) => (cx === 0 && cz === 0 ? chunk : undefined) } as never);
    expect(chunk.getBlockLight(6, 26, 6)).toBe(0);

    const glow = blocks.defaultState('glowstone');
    light.onBlockChanged(4, 26, 4, chunk.set(4, 26, 4, glow), glow);
    expect(chunk.getBlockLight(4, 26, 4)).toBe(15);
    expect(chunk.getBlockLight(5, 26, 4)).toBe(14);
    expect(chunk.getBlockLight(8, 26, 4)).toBe(11);
    // the sections whose light changed are the ones the mesher has to look at again
    expect(light.takeDirty().length).toBeGreaterThan(0);

    // and taking it out again leaves the room as dark as it was
    light.onBlockChanged(4, 26, 4, chunk.set(4, 26, 4, 0), 0);
    for (let x = 2; x < 14; x++) expect(chunk.getBlockLight(x, 26, 4)).toBe(0);
  });

  it('keeps the light of a second source when the first one goes', () => {
    const chunk = new ChunkData(0, 0);
    const stone = blocks.defaultState('stone');
    for (let x = 0; x < 16; x++) for (let z = 0; z < 16; z++) for (let y = 20; y < 40; y++) chunk.set(x, y, z, stone);
    for (let x = 1; x < 15; x++) for (let z = 1; z < 15; z++) for (let y = 25; y < 30; y++) chunk.set(x, y, z, 0);
    const light = new LightEngine({ getChunk: (cx: number, cz: number) => (cx === 0 && cz === 0 ? chunk : undefined) } as never);
    const glow = blocks.defaultState('glowstone');
    light.onBlockChanged(3, 26, 3, chunk.set(3, 26, 3, glow), glow);
    light.onBlockChanged(11, 26, 11, chunk.set(11, 26, 11, glow), glow);
    light.onBlockChanged(3, 26, 3, chunk.set(3, 26, 3, 0), 0);
    expect(chunk.getBlockLight(11, 26, 11)).toBe(15);
    expect(chunk.getBlockLight(10, 26, 11)).toBe(14);
    // and nothing is left where the first one stood
    expect(chunk.getBlockLight(3, 26, 3)).toBe(0);
    expect(chunk.getBlockLight(4, 26, 3)).toBe(0);
  });
});
