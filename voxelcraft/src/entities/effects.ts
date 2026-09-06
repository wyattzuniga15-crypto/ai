/** Status effects on a living entity (vanilla ids, amplifiers and tick behaviour). */
export interface ActiveEffect {
  id: string;
  amplifier: number;
  duration: number;
  ambient?: boolean;
}

export const INSTANT = new Set(['instant_health', 'instant_damage', 'saturation']);

export class EffectSet {
  readonly active = new Map<string, ActiveEffect>();

  add(id: string, duration: number, amplifier = 0): void {
    const cur = this.active.get(id);
    if (cur && (cur.amplifier > amplifier || (cur.amplifier === amplifier && cur.duration >= duration))) return;
    this.active.set(id, { id, amplifier, duration });
  }

  remove(id: string): void {
    this.active.delete(id);
  }

  clear(): void {
    this.active.clear();
  }

  get(id: string): ActiveEffect | undefined {
    return this.active.get(id);
  }

  level(id: string): number {
    const e = this.active.get(id);
    return e ? e.amplifier + 1 : 0;
  }

  /** Ticks durations down; returns the ids that expired. */
  tick(): string[] {
    const expired: string[] = [];
    for (const e of this.active.values()) {
      e.duration--;
      if (e.duration <= 0) {
        this.active.delete(e.id);
        expired.push(e.id);
      }
    }
    return expired;
  }

  serialize(): ActiveEffect[] {
    return [...this.active.values()].map((e) => ({ ...e }));
  }

  restore(list: ActiveEffect[] | undefined): void {
    this.active.clear();
    for (const e of list ?? []) this.active.set(e.id, { ...e });
  }
}

/** Movement speed multiplier from speed/slowness. */
export function speedMultiplier(effects: EffectSet): number {
  return (1 + 0.2 * effects.level('speed')) * (1 - 0.15 * effects.level('slowness'));
}
