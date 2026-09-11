/**
 * One command to play. Fetches whatever the game is missing — Mojang's textures, models and data,
 * the structure templates, optionally the sounds — and then starts the server.
 *
 *   npm start                 the dev server, on http://localhost:5173
 *   npm start -- --sounds     with Mojang's own sound effects (57 MB, once)
 *   npm start -- --music      and the music and the records as well (another 315 MB)
 *   npm start -- --build      build first and serve the static site instead
 *   npm start -- --phone      also serve to the network, so a phone on the same wi-fi can play
 *   npm start -- --force      re-fetch everything, even what is already here
 *
 * Everything it downloads lands in gitignored folders. Nothing Mojang-owned is committed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';

const args = process.argv.slice(2);
const has = (flag: string): boolean => args.includes(flag);
const force = has('--force');

/** Runs one of the repo's own tools, and stops here if it fails. */
function run(what: string, cmd: string, cmdArgs: string[]): void {
  console.log(`\n→ ${what}`);
  const r = spawnSync(cmd, cmdArgs, { stdio: 'inherit', shell: process.platform === 'win32' });
  if (r.status !== 0) {
    console.error(`\n${what} failed. Fix that and run npm start again.`);
    process.exit(r.status ?? 1);
  }
}

const missing = (file: string): boolean => force || !fs.existsSync(file);

if (missing('public/atlas/blocks.png')) {
  run('Fetching the 1.21.11 textures, models and data (about twenty seconds, once)', 'npx', ['tsx', 'tools/fetch-assets.ts', ...(force ? ['--force'] : [])]);
} else {
  console.log('✓ textures and models are already here');
}

if (missing('public/structures/index.json')) {
  run('Converting the structure templates (villages, strongholds, fortresses...)', 'npx', ['tsx', 'tools/gen-structures.ts']);
} else {
  console.log('✓ structure templates are already here');
}

const wantsMusic = has('--music');
// the effects are 57 MB and the music another 315, so each is asked for separately
if ((has('--sounds') || wantsMusic) && (force || missing('public/sounds') || (wantsMusic && missing('public/sounds/music')))) {
  run(wantsMusic ? 'Fetching the sounds, the music and the records' : 'Fetching the sound files',
    'npx', ['tsx', 'tools/fetch-assets.ts', '--sounds', ...(wantsMusic ? ['--music'] : []), '--skip-build']);
} else if (!fs.existsSync('public/sounds')) {
  console.log('✓ ready (run `npm start -- --sounds` once for Mojang\'s own sound effects)');
} else if (!fs.existsSync('public/sounds/music')) {
  console.log('✓ sound effects are here (add `npm start -- --music` once for the music and the records)');
}

// vite opens the browser itself on the port it actually settled on, which is the one to trust;
// on a machine with no desktop to open anything on, it just serves and says where
const desktop = process.platform === 'darwin' || process.platform === 'win32' || !!process.env.DISPLAY;
const open = desktop ? ['--open'] : [];
// a phone cannot reach a server that only answers to this machine, so --phone puts it on the wi-fi
// and prints the address to type in; vite lists every one of this machine's addresses itself
const phone = has('--phone') ? ['--host'] : [];
if (phone.length) {
  console.log('\nOn the phone: join the same wi-fi, open the Network address below, and turn it');
  console.log('sideways. "Add to Home Screen" in the browser gives a proper full screen.');
}
if (has('--build')) {
  run('Building', 'npx', ['vite', 'build']);
  console.log('\nPress Ctrl+C to stop.\n');
  run('Serving', 'npx', ['vite', 'preview', ...open, ...phone]);
} else {
  console.log('\nPress Ctrl+C to stop.\n');
  run('Serving', 'npx', ['vite', ...open, ...phone]);
}
