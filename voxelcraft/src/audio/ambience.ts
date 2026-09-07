/**
 * Biome ambience, on vanilla's own terms: the cave sound that creeps up on anyone standing in the
 * dark for long enough, the loop some biomes hum under everything else, and the one-off additions
 * the nether throws in.
 *
 * Vanilla's mood is a counter rather than a timer: every tick it looks at one random block in a
 * cube around the player, and a block that is properly dark pushes the counter up by one part in
 * `tickDelay`. When it fills, the sound plays a little way off in the direction of that block and
 * the counter goes back to nothing; standing in the light drains it slowly instead.
 */

/**
 * Vanilla's mood settings, which every biome that has them gives the same numbers: one part in six
 * thousand a tick, a cube eight blocks out, and the sound placed two blocks from the listener. Only
 * the sound itself changes, and only in the Nether.
 */
export const MOOD = { tickDelay: 6000, blockSearchExtent: 8, soundPositionOffset: 2 };

/** The sound a biome's mood plays: the cave everywhere, and each nether biome's own. */
export function moodSound(biome: string): string {
  return NETHER_AMBIENCE_BIOMES.has(biome) ? `ambient.${biome}.mood` : 'ambient.cave';
}

/** How fast the counter drains while the block it looked at was lit, per vanilla. */
const MOOD_DECAY = 0.001;

export interface AmbienceWorld {
  getSkyLight(x: number, y: number, z: number): number;
  getBlockLight(x: number, y: number, z: number): number;
}

export interface MoodSound {
  event: string;
  x: number;
  y: number;
  z: number;
}

/** The mood counter for one player, ticked once a tick wherever they are. */
export class MoodTracker {
  moodiness = 0;

  /**
   * One tick. Returns the sound to play when the counter fills, and null otherwise. `random` draws
   * the block to look at, so a test can aim it.
   */
  tick(w: AmbienceWorld, px: number, py: number, pz: number, biome: string, random: () => number = Math.random): MoodSound | null {
    const extent = MOOD.blockSearchExtent;
    const span = extent * 2;
    const x = Math.floor(px) + Math.floor(random() * span) - extent;
    const y = Math.floor(py) + Math.floor(random() * span) - extent;
    const z = Math.floor(pz) + Math.floor(random() * span) - extent;
    // vanilla wants somewhere the sky never reaches and no lamp has found either
    if (w.getSkyLight(x, y, z) === 0 && w.getBlockLight(x, y, z) === 0) {
      this.moodiness += 1 / MOOD.tickDelay;
    } else if (this.moodiness > 0) {
      this.moodiness = Math.max(0, this.moodiness - MOOD_DECAY);
    }
    if (this.moodiness < 1) return null;
    this.moodiness = 0;
    // the sound comes from a couple of blocks toward the dark place rather than from inside it
    const dx = x + 0.5 - px;
    const dy = y + 0.5 - py;
    const dz = z + 0.5 - pz;
    const len = Math.hypot(dx, dy, dz) || 1;
    const step = MOOD.soundPositionOffset / len;
    return { event: moodSound(biome), x: px + dx * step, y: py + dy * step, z: pz + dz * step };
  }

  reset(): void {
    this.moodiness = 0;
  }
}

/**
 * The biomes vanilla gives an ambience of their own: a loop that hums while you are in them, and
 * additions that turn up now and then.
 */
export interface BiomeAmbience {
  loop?: string;
  /** Chance per tick that an addition plays, as vanilla's `tick_chance` gives it. */
  additions?: { event: string; chance: number };
}

/** The nether's five, which are the only biomes vanilla gives a loop and additions of their own. */
const NETHER_AMBIENCE_BIOMES = new Set(['nether_wastes', 'crimson_forest', 'warped_forest', 'soul_sand_valley', 'basalt_deltas']);

/** Vanilla's `tick_chance` for a biome's additions, the same in every biome that has them. */
export const ADDITIONS_CHANCE = 0.0111;

export function biomeAmbience(biome: string): BiomeAmbience | null {
  if (!NETHER_AMBIENCE_BIOMES.has(biome)) return null;
  return { loop: `ambient.${biome}.loop`, additions: { event: `ambient.${biome}.additions`, chance: ADDITIONS_CHANCE } };
}

/** Which biomes vanilla lets the mood sound build up in: everywhere but the End. */
export const hasMood = (dimension: string): boolean => dimension !== 'end';
