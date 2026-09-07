/**
 * Background music, on vanilla's own schedule: one track at a time, chosen by where the player is
 * and what they are doing, then a long random wait before the next. Vanilla's `MusicManager` keeps
 * a countdown that is trimmed whenever the situation changes, which is what makes music start
 * sooner when you walk into the End or a biome with a track of its own.
 */

export interface MusicCue {
  event: string;
  /** Ticks to wait after a track ends before the next may start. */
  minDelay: number;
  maxDelay: number;
  /** Whether this cue cuts a track that is already playing, as the End's does. */
  replace: boolean;
}

/** Vanilla's `Musics.createGameMusic`: twelve to twenty-four minutes' wait, never interrupting. */
const game = (event: string): MusicCue => ({ event, minDelay: 12000, maxDelay: 24000, replace: false });

export const MUSIC = {
  menu: game('music.menu'),
  creative: game('music.creative'),
  credits: game('music.credits'),
  underwater: game('music.under_water'),
  game: game('music.game'),
  end: { event: 'music.end', minDelay: 6000, maxDelay: 24000, replace: true },
  dragon: { event: 'music.dragon', minDelay: 0, maxDelay: 0, replace: true },
} satisfies Record<string, MusicCue>;

/**
 * Biomes vanilla gives a track of their own. The nether's five each have one; in the overworld the
 * event is named after the biome, and the few biomes vanilla groups together share the one track.
 */
const BIOME_MUSIC_ALIASES: Record<string, string> = {
  eroded_badlands: 'badlands',
  wooded_badlands: 'badlands',
  old_growth_pine_taiga: 'old_growth_taiga',
  old_growth_spruce_taiga: 'old_growth_taiga',
  mangrove_swamp: 'swamp',
};

const OVERWORLD_MUSIC_BIOMES = new Set([
  'badlands', 'bamboo_jungle', 'cherry_grove', 'deep_dark', 'desert', 'dripstone_caves', 'flower_forest',
  'forest', 'frozen_peaks', 'grove', 'jagged_peaks', 'jungle', 'lush_caves', 'meadow', 'old_growth_taiga',
  'snowy_slopes', 'sparse_jungle', 'stony_peaks', 'swamp',
]);

const NETHER_MUSIC_BIOMES = new Set(['basalt_deltas', 'crimson_forest', 'nether_wastes', 'soul_sand_valley', 'warped_forest']);

/** The cue a biome carries, or null where vanilla leaves it to the general game music. */
export function biomeMusic(biome: string, dimension: string): MusicCue | null {
  if (dimension === 'nether') return NETHER_MUSIC_BIOMES.has(biome) ? game(`music.nether.${biome}`) : null;
  if (dimension !== 'overworld') return null;
  const id = BIOME_MUSIC_ALIASES[biome] ?? biome;
  return OVERWORLD_MUSIC_BIOMES.has(id) ? game(`music.overworld.${id}`) : null;
}

export interface MusicSituation {
  /** True while the credits are rolling, which vanilla scores with its own track. */
  credits: boolean;
  dimension: string;
  biome: string;
  creative: boolean;
  underwater: boolean;
  /** True while the dragon's bar is up, which is the one cue that cuts everything else. */
  dragonFight: boolean;
}

/** Vanilla's `Minecraft.getSituationalMusic`, in the order it asks its questions. */
export function situationalMusic(s: MusicSituation): MusicCue {
  if (s.credits) return MUSIC.credits;
  if (s.dimension === 'end') return s.dragonFight ? MUSIC.dragon : MUSIC.end;
  if (s.underwater) return MUSIC.underwater;
  // creative flight has its own music everywhere but the Nether, which keeps its biome tracks
  if (s.creative && s.dimension !== 'nether') return MUSIC.creative;
  return biomeMusic(s.biome, s.dimension) ?? MUSIC.game;
}

export interface MusicHost {
  /** Starts a track; false when there is no such sound, which leaves the manager waiting. */
  playTrack(event: string, onEnded: () => void): boolean;
  stopTrack(): void;
  random(): number;
}

/** Vanilla's music manager: one track, then a long wait, with the wait trimmed as things change. */
export class MusicManager {
  /** Ticks left before the next track may start; vanilla starts a world a hundred ticks in. */
  delay = 100;
  current: MusicCue | null = null;

  constructor(private readonly host: MusicHost) {}

  private randomInt(min: number, max: number): number {
    return max <= min ? min : min + Math.floor(this.host.random() * (max - min + 1));
  }

  tick(situation: MusicSituation): void {
    const cue = situationalMusic(situation);
    if (this.current) {
      if (this.current.event !== cue.event && cue.replace) {
        // the End and the dragon cut whatever was playing, and start again soon after
        this.host.stopTrack();
        this.current = null;
        this.delay = this.randomInt(0, Math.floor(cue.minDelay / 2));
      } else {
        return;
      }
    }
    this.delay = Math.min(this.delay, cue.maxDelay);
    if (this.delay-- <= 0) this.start(cue);
  }

  private start(cue: MusicCue): void {
    if (!this.host.playTrack(cue.event, () => this.ended(cue))) {
      // nothing to play (a world with no sound assets): wait as long as vanilla would have
      this.delay = this.randomInt(cue.minDelay, cue.maxDelay);
      return;
    }
    this.current = cue;
  }

  private ended(cue: MusicCue): void {
    this.current = null;
    this.delay = this.randomInt(cue.minDelay, cue.maxDelay);
  }

  /** A record silences the music, and leaving one stops the track outright. */
  stop(): void {
    if (this.current) this.host.stopTrack();
    this.current = null;
  }
}
