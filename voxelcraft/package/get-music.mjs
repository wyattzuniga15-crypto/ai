/**
 * Fetches Minecraft's music and its records into this folder.
 *
 *   node get-music.mjs
 *
 * They are not in the download because they are about three hundred megabytes on their own — more
 * than ten times everything else here put together. Everything else already is: the sound effects,
 * the textures, the models.
 *
 * The files come off the same public mirror of Mojang's assets the rest of them came from. Anything
 * already here is left alone, so a run that is interrupted can simply be started again.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const sounds = path.join(here, 'game', 'sounds');
const defsFile = path.join(here, 'game', 'sounds.json');
const VERSION = '1.21.11';
const MIRROR = `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${VERSION}/assets/minecraft/sounds`;
/** Older mirror branches carry the few files the newest one is missing. */
const FALLBACKS = ['1.21.5', '1.21.1'];

if (!fs.existsSync(defsFile)) {
  console.error('Run this from inside the Voxelcraft folder — game/sounds.json is not here.');
  process.exit(1);
}

/** Every music and record file vanilla's own sound table names. */
function wanted() {
  const defs = JSON.parse(fs.readFileSync(defsFile, 'utf8'));
  const names = new Set();
  for (const entry of Object.values(defs)) {
    for (const sound of entry.sounds ?? []) {
      const name = typeof sound === 'string' ? sound : sound.type === 'event' ? null : sound.name;
      if (name && (name.startsWith('music/') || name.startsWith('records/'))) names.add(name);
    }
  }
  return [...names].sort();
}

async function grab(name) {
  const out = path.join(sounds, `${name}.ogg`);
  if (fs.existsSync(out) && fs.statSync(out).size > 1024) return 0;
  for (const version of [VERSION, ...FALLBACKS]) {
    const url = version === VERSION ? `${MIRROR}/${name}.ogg`
      : `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${version}/assets/minecraft/sounds/${name}.ogg`;
    try {
      const res = await fetch(url);
      if (!res.ok) continue;
      const body = Buffer.from(await res.arrayBuffer());
      // a file the mirror does not have comes back as a short "404: Not Found" page, not an error
      if (body.length <= 1024) continue;
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, body);
      return body.length;
    } catch {
      // try the next branch, then give up on this one
    }
  }
  return -1;
}

const list = wanted();
console.log(`\n  Fetching ${list.length} music and record files. This is a few hundred megabytes;`);
console.log('  it can be stopped and started again, and it only has to be done once.\n');

let done = 0;
let bytes = 0;
let missing = 0;
const queue = list.slice();
const workers = Array.from({ length: 6 }, async () => {
  for (let name = queue.pop(); name; name = queue.pop()) {
    const got = await grab(name);
    if (got < 0) missing++;
    else bytes += got;
    done++;
    process.stdout.write(`\r  ${done}/${list.length} — ${(bytes / 1048576).toFixed(0)} MB downloaded   `);
  }
});
await Promise.all(workers);

console.log(`\n\n  Done. ${list.length - missing} files are in place${missing ? `, ${missing} were not on the mirror` : ''}.`);
console.log('  Start the game again and the music will play.\n');
