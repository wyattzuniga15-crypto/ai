/**
 * Vanilla's own sound event definitions, read from the `sounds.json` the asset fetch lays down.
 * An event names one or more files, each with a weight, a volume and a pitch, and says whether it
 * streams (music and records do). The game uses the table to pick a variant the way vanilla picks
 * one; the files themselves are optional, since they come off Mojang's CDN rather than the jar.
 */
export interface SoundVariant {
  /** Path under `sounds/`, without the extension: `records/13`, `mob/cow/say1`. */
  name: string;
  volume: number;
  pitch: number;
  weight: number;
  /** Streamed sounds are the long ones — music, records — which play through an audio element. */
  stream: boolean;
}

interface RawEntry {
  sounds?: (string | { name: string; type?: string; volume?: number; pitch?: number; weight?: number; stream?: boolean })[];
  subtitle?: string;
}

export class SoundDefinitions {
  private readonly events = new Map<string, SoundVariant[]>();
  private readonly subtitles = new Map<string, string>();

  get size(): number {
    return this.events.size;
  }

  /** Reads vanilla's file. Entries that point at another event rather than a file are skipped. */
  load(json: Record<string, RawEntry>): void {
    for (const [event, entry] of Object.entries(json)) {
      if (entry.subtitle) this.subtitles.set(event, entry.subtitle);
      const list: SoundVariant[] = [];
      for (const sound of entry.sounds ?? []) {
        if (typeof sound === 'string') {
          list.push({ name: sound, volume: 1, pitch: 1, weight: 1, stream: false });
          continue;
        }
        // "type": "event" points at another event, which nothing the game plays uses
        if (sound.type === 'event') continue;
        list.push({ name: sound.name, volume: sound.volume ?? 1, pitch: sound.pitch ?? 1, weight: sound.weight ?? 1, stream: sound.stream ?? false });
      }
      if (list.length) this.events.set(event, list);
    }
  }

  has(event: string): boolean {
    return this.events.has(event);
  }

  variants(event: string): SoundVariant[] {
    return this.events.get(event) ?? [];
  }

  subtitle(event: string): string | null {
    return this.subtitles.get(event) ?? null;
  }

  /** One variant, drawn by vanilla's weights. */
  pick(event: string, random: () => number = Math.random): SoundVariant | null {
    const list = this.events.get(event);
    if (!list || !list.length) return null;
    const total = list.reduce((a, v) => a + v.weight, 0);
    let r = random() * total;
    for (const v of list) {
      r -= v.weight;
      if (r < 0) return v;
    }
    return list[list.length - 1];
  }
}

export const soundDefs = new SoundDefinitions();

/** Loads `sounds.json`; a world with no fetched assets simply runs without it. */
export async function loadSoundDefinitions(base: string): Promise<boolean> {
  try {
    const res = await fetch(`${base}sounds.json`);
    if (!res.ok) return false;
    soundDefs.load((await res.json()) as Record<string, RawEntry>);
    return soundDefs.size > 0;
  } catch {
    return false;
  }
}
