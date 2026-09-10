/**
 * Builds the folder you hand somebody: the built game, the launchers, and only the sounds the game
 * can actually reach — the whole set is three times the size and most of it is never played.
 *
 *   npm run pack            everything the game can play, about 30 MB
 *   npm run pack -- --all   every sound file that was fetched
 *
 * Output is `Voxelcraft/` and `Voxelcraft.zip` beside the repo. Nothing here is committed: the
 * game inside it is Mojang's textures and sounds, which stay out of the repository.
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { PUBLIC } from './lib/paths.ts';
import { ensureDir } from './lib/fs.ts';
import { SOUND_EVENTS } from '../src/audio/soundEvents.ts';

const ALL_SOUNDS = process.argv.includes('--all');
const out = path.resolve('..', 'Voxelcraft');
const dist = path.resolve('dist');

if (!fs.existsSync(path.join(dist, 'index.html'))) {
  console.error('[pack] no dist/ — run `npm run build` first');
  process.exit(1);
}

/** Every sound file the game can ask for: the mapped voices, the cave mood, the nether's own. */
function reachableSounds(): Set<string> {
  const defs = JSON.parse(fs.readFileSync(path.join(PUBLIC, 'sounds.json'), 'utf8')) as
    Record<string, { sounds?: (string | { name: string; type?: string })[] }>;
  const events = new Set<string>(Object.values(SOUND_EVENTS));
  events.add('ambient.cave');
  for (const biome of ['nether_wastes', 'crimson_forest', 'warped_forest', 'soul_sand_valley', 'basalt_deltas']) {
    for (const kind of ['mood', 'loop', 'additions']) events.add(`ambient.${biome}.${kind}`);
  }
  const files = new Set<string>();
  for (const event of events) {
    for (const sound of defs[event]?.sounds ?? []) {
      const name = typeof sound === 'string' ? sound : sound.type === 'event' ? null : sound.name;
      if (name) files.add(name);
    }
  }
  return files;
}

/** Copies a tree, keeping only what `keep` says to keep. */
function copy(from: string, to: string, keep?: (rel: string) => boolean, rel = ''): number {
  let n = 0;
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const next = rel ? `${rel}/${entry.name}` : entry.name;
    const src = path.join(from, entry.name);
    const dst = path.join(to, entry.name);
    if (entry.isDirectory()) {
      const inner = copy(src, dst, keep, next);
      if (inner === 0 && !fs.existsSync(dst)) continue;
      n += inner;
      continue;
    }
    if (keep && !keep(next)) continue;
    ensureDir(to);
    fs.copyFileSync(src, dst);
    n++;
  }
  return n;
}

fs.rmSync(out, { recursive: true, force: true });
ensureDir(out);

const sounds = ALL_SOUNDS ? null : reachableSounds();
const game = path.join(out, 'game');
const files = copy(dist, game, (rel) => {
  if (!rel.startsWith('sounds/')) return true;
  if (!sounds) return true;
  return sounds.has(rel.slice('sounds/'.length).replace(/\.ogg$/, ''));
});

for (const name of fs.readdirSync('package')) {
  fs.copyFileSync(path.join('package', name), path.join(out, name));
  if (name.endsWith('.command') || name.endsWith('.sh')) fs.chmodSync(path.join(out, name), 0o755);
}

const zip = `${out}.zip`;
fs.rmSync(zip, { force: true });
const r = spawnSync('zip', ['-qr', zip, path.basename(out)], { cwd: path.dirname(out), stdio: 'inherit' });
const size = r.status === 0 && fs.existsSync(zip) ? `${(fs.statSync(zip).size / 1048576).toFixed(1)} MB` : 'not zipped';
console.log(`[pack] ${out}: ${files} files; ${zip}: ${size}`);
