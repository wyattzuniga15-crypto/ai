/**
 * The bridge between the game's voices and Mojang's sound events. Every voice the game plays should
 * name a real event, so the recording that comes out is the one Minecraft would have played.
 */
import { describe, expect, it } from 'vitest';
import fs from 'node:fs';
import { SOUND_EVENTS } from '../src/audio/soundEvents.ts';

describe('the sound event map', () => {
  it('covers every voice the game asks for by name', () => {
    const src = fs.readFileSync('src/core/game.ts', 'utf8') + fs.readFileSync('src/entities/mob.ts', 'utf8');
    const asked = new Set<string>();
    for (const m of src.matchAll(/(?:audio\.play|playSound)\('([a-z_0-9]+)'/g)) asked.add(m[1]);
    // the dynamic ones are built from the block's sound group
    for (const group of ['stone', 'wood', 'gravel', 'sand', 'grass', 'wool', 'glass', 'water', 'snow']) {
      asked.add(`dig_${group}`);
      asked.add(`step_${group}`);
    }
    const unmapped = [...asked].filter((name) => !SOUND_EVENTS[name]);
    expect(unmapped).toEqual([]);
  });

  it('names events vanilla actually has', () => {
    // sounds.json is fetched rather than committed, so this only bites once the assets are there
    if (!fs.existsSync('public/sounds.json')) return;
    const defs = JSON.parse(fs.readFileSync('public/sounds.json', 'utf8')) as Record<string, unknown>;
    const missing = Object.entries(SOUND_EVENTS).filter(([, event]) => !(event in defs));
    expect(missing).toEqual([]);
  });

  it('gives every event a file that was actually fetched', () => {
    if (!fs.existsSync('public/sounds.json') || !fs.existsSync('public/sounds')) return;
    const defs = JSON.parse(fs.readFileSync('public/sounds.json', 'utf8')) as Record<string, { sounds?: (string | { name: string; type?: string })[] }>;
    const silent: string[] = [];
    for (const [voice, event] of Object.entries(SOUND_EVENTS)) {
      const names = (defs[event]?.sounds ?? []).map((s) => (typeof s === 'string' ? s : s.type === 'event' ? null : s.name)).filter(Boolean) as string[];
      if (!names.some((n) => fs.existsSync(`public/sounds/${n}.ogg`))) silent.push(`${voice} -> ${event}`);
    }
    expect(silent).toEqual([]);
  });
});
