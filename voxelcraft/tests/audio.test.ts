/**
 * Music, ambience and records: vanilla's own sound event table, the schedule the music manager
 * keeps, the mood counter behind the cave sound, and what a jukebox does with a disc.
 */
import { describe, expect, it } from 'vitest';
import { SoundDefinitions } from '../src/audio/sounds.ts';
import { MUSIC, MusicManager, biomeMusic, situationalMusic, type MusicSituation } from '../src/audio/music.ts';
import { ADDITIONS_CHANCE, MOOD, MoodTracker, biomeAmbience, hasMood, moodSound } from '../src/audio/ambience.ts';
import { JUKEBOX_SONGS, isMusicDisc, songForDisc } from '../src/items/jukebox.ts';
import { createBlockEntity, type JukeboxEntity } from '../src/blocks/blockEntity.ts';
import { items } from '../src/items/registry.ts';

const situation = (over: Partial<MusicSituation> = {}): MusicSituation =>
  ({ credits: false, dimension: 'overworld', biome: 'plains', creative: false, underwater: false, dragonFight: false, ...over });

describe('sound definitions', () => {
  const defs = new SoundDefinitions();
  defs.load({
    'music_disc.13': { sounds: [{ name: 'records/13', stream: true }] },
    'entity.cow.ambient': { subtitle: 'subtitles.entity.cow.ambient', sounds: [{ name: 'mob/cow/say1', weight: 3 }, { name: 'mob/cow/say2', volume: 0.5, pitch: 1.2 }] },
    'block.stone.step': { sounds: ['step/stone1', 'step/stone2'] },
    // an entry that only points at another event is not a file, and is left out
    'entity.cow.hurt': { sounds: [{ name: 'entity.cow.ambient', type: 'event' }] },
  });

  it('reads vanilla’s shapes: bare names, objects and streams', () => {
    expect(defs.variants('block.stone.step').map((v) => v.name)).toEqual(['step/stone1', 'step/stone2']);
    expect(defs.variants('music_disc.13')[0]).toMatchObject({ name: 'records/13', stream: true, volume: 1, pitch: 1, weight: 1 });
    expect(defs.variants('entity.cow.ambient')[1]).toMatchObject({ name: 'mob/cow/say2', volume: 0.5, pitch: 1.2 });
    expect(defs.subtitle('entity.cow.ambient')).toBe('subtitles.entity.cow.ambient');
    expect(defs.has('entity.cow.hurt')).toBe(false);
  });

  it('draws a variant by its weight', () => {
    // say1 carries three quarters of the weight, so anything under 0.75 lands on it
    expect(defs.pick('entity.cow.ambient', () => 0.7)?.name).toBe('mob/cow/say1');
    expect(defs.pick('entity.cow.ambient', () => 0.8)?.name).toBe('mob/cow/say2');
    expect(defs.pick('nothing.here')).toBeNull();
  });
});

describe('background music', () => {
  it('asks vanilla’s questions in vanilla’s order', () => {
    expect(situationalMusic(situation()).event).toBe('music.game');
    expect(situationalMusic(situation({ biome: 'swamp' })).event).toBe('music.overworld.swamp');
    expect(situationalMusic(situation({ creative: true, biome: 'swamp' })).event).toBe('music.creative');
    // the Nether keeps its own biome music even in creative
    expect(situationalMusic(situation({ creative: true, dimension: 'nether', biome: 'crimson_forest' })).event).toBe('music.nether.crimson_forest');
    expect(situationalMusic(situation({ underwater: true, creative: true })).event).toBe('music.under_water');
    expect(situationalMusic(situation({ dimension: 'end' })).event).toBe('music.end');
    expect(situationalMusic(situation({ dimension: 'end', dragonFight: true })).event).toBe('music.dragon');
    expect(situationalMusic(situation({ credits: true, dimension: 'end', dragonFight: true })).event).toBe('music.credits');
  });

  it('gives the biomes vanilla gives a track of their own', () => {
    expect(biomeMusic('cherry_grove', 'overworld')?.event).toBe('music.overworld.cherry_grove');
    // the badlands' three and the two old growth taigas share one track each
    expect(biomeMusic('eroded_badlands', 'overworld')?.event).toBe('music.overworld.badlands');
    expect(biomeMusic('old_growth_pine_taiga', 'overworld')?.event).toBe('music.overworld.old_growth_taiga');
    expect(biomeMusic('mangrove_swamp', 'overworld')?.event).toBe('music.overworld.swamp');
    expect(biomeMusic('plains', 'overworld')).toBeNull();
    expect(biomeMusic('basalt_deltas', 'nether')?.event).toBe('music.nether.basalt_deltas');
    expect(biomeMusic('the_end', 'end')).toBeNull();
    expect(MUSIC.game).toMatchObject({ minDelay: 12000, maxDelay: 24000, replace: false });
    expect(MUSIC.end).toMatchObject({ minDelay: 6000, maxDelay: 24000, replace: true });
  });

  it('plays one track, then waits vanilla’s delay before the next', () => {
    const played: string[] = [];
    let ended: (() => void) | null = null;
    const m = new MusicManager({
      playTrack: (event, onEnded) => { played.push(event); ended = onEnded; return true; },
      stopTrack: () => played.push('stop'),
      random: () => 0.5,
    });
    const s = situation();
    // vanilla starts a world a hundred ticks short of its first track
    expect(m.delay).toBe(100);
    for (let i = 0; i < 100; i++) m.tick(s);
    expect(played).toEqual([]);
    m.tick(s);
    expect(played).toEqual(['music.game']);
    // while it runs nothing else starts, however long the world ticks
    for (let i = 0; i < 100; i++) m.tick(s);
    expect(played).toEqual(['music.game']);
    ended!();
    // the wait is drawn between the cue's two delays: halfway, for this die
    expect(m.delay).toBe(18000);
    for (let i = 0; i < 18000; i++) m.tick(s);
    expect(played).toEqual(['music.game']);
    m.tick(s);
    expect(played).toEqual(['music.game', 'music.game']);
  });

  it('lets the End cut whatever was playing, and waits only half as long', () => {
    const played: string[] = [];
    const m = new MusicManager({ playTrack: (e) => { played.push(e); return true; }, stopTrack: () => played.push('stop'), random: () => 0.5 });
    for (let i = 0; i <= 100; i++) m.tick(situation());
    expect(played).toEqual(['music.game']);
    m.tick(situation({ dimension: 'end' }));
    expect(played).toEqual(['music.game', 'stop']);
    // half of the End's own minimum by this die, less the tick that has already run down
    expect(m.delay).toBe(1499);
  });

  it('keeps waiting when there is no sound file to play', () => {
    const m = new MusicManager({ playTrack: () => false, stopTrack: () => {}, random: () => 0 });
    for (let i = 0; i <= 100; i++) m.tick(situation());
    expect(m.current).toBeNull();
    expect(m.delay).toBe(12000);
  });
});

describe('ambience', () => {
  const dark = { getSkyLight: () => 0, getBlockLight: () => 0 };
  const lit = { getSkyLight: () => 15, getBlockLight: () => 0 };

  it('builds the cave sound over vanilla’s six thousand ticks in the dark', () => {
    const mood = new MoodTracker();
    let heard = null;
    let ticks = 0;
    while (!heard && ticks < MOOD.tickDelay * 2) {
      heard = mood.tick(dark, 0, 64, 0, 'plains', () => 0.5);
      ticks++;
    }
    // one part in six thousand a tick, so it fills after about that many (floats land it on 6001)
    expect(ticks).toBeGreaterThanOrEqual(MOOD.tickDelay);
    expect(ticks).toBeLessThanOrEqual(MOOD.tickDelay + 2);
    expect(heard?.event).toBe('ambient.cave');
    // it comes from a couple of blocks off rather than from inside the wall
    expect(Math.hypot(heard!.x - 0, heard!.y - 64, heard!.z - 0)).toBeCloseTo(MOOD.soundPositionOffset, 5);
    expect(mood.moodiness).toBe(0);
  });

  it('drains in the light, and the Nether has moods of its own', () => {
    const mood = new MoodTracker();
    for (let i = 0; i < 600; i++) mood.tick(dark, 0, 64, 0, 'plains', () => 0.5);
    const built = mood.moodiness;
    expect(built).toBeCloseTo(0.1, 5);
    for (let i = 0; i < 50; i++) mood.tick(lit, 0, 64, 0, 'plains', () => 0.5);
    expect(mood.moodiness).toBeCloseTo(built - 0.05, 5);
    expect(moodSound('crimson_forest')).toBe('ambient.crimson_forest.mood');
    expect(moodSound('plains')).toBe('ambient.cave');
    expect(hasMood('end')).toBe(false);
  });

  it('hums the nether biomes and leaves the rest quiet', () => {
    expect(biomeAmbience('soul_sand_valley')).toEqual({ loop: 'ambient.soul_sand_valley.loop', additions: { event: 'ambient.soul_sand_valley.additions', chance: ADDITIONS_CHANCE } });
    expect(biomeAmbience('plains')).toBeNull();
    expect(ADDITIONS_CHANCE).toBe(0.0111);
  });
});

describe('records', () => {
  it('carries vanilla’s twenty-one songs with their lengths and signals', () => {
    expect(JUKEBOX_SONGS).toHaveLength(21);
    expect(songForDisc('music_disc_13')).toMatchObject({ sound: 'music_disc.13', seconds: 178, comparator: 1 });
    expect(songForDisc('music_disc_pigstep')).toMatchObject({ name: 'Lena Raine - Pigstep', seconds: 149, comparator: 13 });
    expect(songForDisc('music_disc_5')?.comparator).toBe(15);
    expect(songForDisc('stone')).toBeNull();
    // every disc in the item registry has a song, and every song an item
    for (const def of items.defs) if (def.behavior === 'music_disc') expect(isMusicDisc(def.id), def.id).toBe(true);
    for (const song of JUKEBOX_SONGS) expect(items.has(song.item), song.item).toBe(true);
  });

  it('gives a jukebox a slot of its own', () => {
    const e = createBlockEntity('jukebox') as JukeboxEntity;
    expect(e).toEqual({ type: 'jukebox', items: [null], ticks: 0 });
  });
});
