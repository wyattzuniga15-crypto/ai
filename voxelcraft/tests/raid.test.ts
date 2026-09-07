import { describe, expect, it } from 'vitest';
import { WAVES, raidTitle, raidWaves, startRaid, waveMobs } from '../src/entities/raid.ts';

describe('raids', () => {
  it('runs three waves, or more for a stronger omen', () => {
    expect(raidWaves(1)).toBe(3);
    expect(raidWaves(2)).toBe(4);
    expect(raidWaves(5)).toBe(5); // vanilla caps the extra waves at two
  });

  it('brings vanilla’s wave of raiders', () => {
    const first = waveMobs(1);
    expect(first).toEqual([{ type: 'pillager', count: 4 }]);
    const third = waveMobs(3);
    expect(third).toEqual([{ type: 'pillager', count: 3 }, { type: 'ravager', count: 1 }]);
    const fifth = waveMobs(5).map((w) => w.type);
    expect(fifth).toContain('evoker');
    expect(waveMobs(4).some((w) => w.type === 'witch')).toBe(true);
  });

  it('keeps sending raiders past the last wave in its table', () => {
    expect(waveMobs(20).length).toBeGreaterThan(0);
    expect(WAVES.every((w) => w.perWave.length === 7)).toBe(true);
  });

  it('names the bar after the wave being fought', () => {
    const raid = startRaid(0, 64, 0, 1);
    expect(raidTitle(raid)).toBe('Raid — Wave 1 of 3');
    raid.wave = 2;
    expect(raidTitle(raid)).toBe('Raid — Wave 2 of 3');
    raid.over = true;
    raid.won = true;
    expect(raidTitle(raid)).toBe('Raid Victory');
    raid.won = false;
    expect(raidTitle(raid)).toBe('Raid Defeat');
  });
});
