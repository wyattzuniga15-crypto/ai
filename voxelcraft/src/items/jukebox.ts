/**
 * Vanilla's `jukebox_song` registry: what each music disc plays, how long the record runs, and the
 * signal a comparator reads out of the jukebox playing it.
 */
import songs from '../../data/jukebox.json';

export interface JukeboxSong {
  /** Registry name, which is the disc's id without its `music_disc_` prefix. */
  id: string;
  item: string;
  /** What vanilla announces when the record starts, straight out of the language file. */
  name: string;
  /** Sound event the record plays, which is a streamed track rather than an effect. */
  sound: string;
  seconds: number;
  comparator: number;
}

export const JUKEBOX_SONGS = songs as JukeboxSong[];

const byItem = new Map(JUKEBOX_SONGS.map((s) => [s.item, s]));

/** The song a disc plays, or null for anything that is not one. */
export const songForDisc = (item: string): JukeboxSong | null => byItem.get(item) ?? null;

export const isMusicDisc = (item: string): boolean => byItem.has(item);
