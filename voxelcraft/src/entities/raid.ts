/**
 * Raids. A player who walks into a village carrying Bad Omen brings a raid down on it: waves of
 * illagers spawn nearby and the village has to survive them. The wave table is vanilla's own
 * `Raid.RaiderType`, at normal difficulty, and a Bad Omen of level two or more adds a wave.
 */

/** Vanilla's raiders and how many of each come in each of the seven waves. */
export const WAVES: { type: string; perWave: number[] }[] = [
  { type: 'pillager', perWave: [4, 3, 3, 4, 4, 4, 2] },
  { type: 'vindicator', perWave: [0, 2, 0, 1, 2, 4, 2] },
  { type: 'evoker', perWave: [0, 0, 0, 0, 1, 1, 2] },
  { type: 'witch', perWave: [0, 0, 0, 3, 0, 0, 1] },
  { type: 'ravager', perWave: [0, 0, 1, 0, 1, 0, 2] },
];

/** How many waves a raid runs for; Bad Omen above the first level adds one more. */
export const raidWaves = (badOmenLevel: number): number => 3 + Math.max(0, Math.min(2, badOmenLevel - 1));

export interface RaidState {
  /** Middle of the village the raid is on. */
  cx: number;
  cy: number;
  cz: number;
  wave: number;
  waves: number;
  /** Ticks until the next wave comes. */
  next: number;
  /** How many raiders were in this wave, so the bar can show what is left. */
  waveSize: number;
  over: boolean;
  won: boolean;
}

/** What comes in one wave: the types and how many of each. */
export function waveMobs(wave: number): { type: string; count: number }[] {
  const index = Math.min(wave, WAVES[0].perWave.length) - 1;
  const out: { type: string; count: number }[] = [];
  for (const raider of WAVES) {
    const count = raider.perWave[index] ?? 0;
    if (count > 0) out.push({ type: raider.type, count });
  }
  return out;
}

export function startRaid(x: number, y: number, z: number, badOmenLevel: number): RaidState {
  return { cx: x, cy: y, cz: z, wave: 0, waves: raidWaves(badOmenLevel), next: 100, waveSize: 0, over: false, won: false };
}

/** The bar's title, which vanilla writes as the wave being fought. */
export function raidTitle(raid: RaidState): string {
  if (raid.over) return raid.won ? 'Raid Victory' : 'Raid Defeat';
  return `Raid — Wave ${Math.max(1, raid.wave)} of ${raid.waves}`;
}
