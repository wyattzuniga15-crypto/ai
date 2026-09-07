/**
 * Fetches the Minecraft Java 1.21.11 client assets and vanilla data pack that the game needs, and
 * builds the derived files (texture atlases, merged models) that the runtime loads.
 *
 * Sources, tried in order (override with --source=official|mirror):
 *   1. Mojang's public launcher manifest + client jar (piston-meta / piston-data).
 *   2. The InventivetalentDev/minecraft-assets GitHub mirror of the same jar contents, via a git
 *      sparse clone, or via raw file downloads when git is unavailable.
 * It also downloads the PrismarineJS minecraft-data JSON (block hardness, tools, items, entities...)
 * used by `npm run data`.
 *
 * Nothing this script writes is committed: `.cache/`, `assets/textures`, `assets/models`, etc. are
 * gitignored (the repository stays free of Mojang-owned art). Re-run with --force to refresh.
 *
 * Usage: npm run assets -- [--version=1.21.11] [--source=auto|official|mirror] [--force] [--skip-build]
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { unzipSync } from 'fflate';
import { ASSETS, CACHE, MC_VERSION, PUBLIC, jarDir, mcDataDir } from './lib/paths.ts';
import { copyDir, ensureDir, readJson, writeJson } from './lib/fs.ts';
import { buildModels } from './build-models.ts';
import { buildAtlases } from './build-atlas.ts';

// Node's fetch only honours HTTPS_PROXY when NODE_USE_ENV_PROXY=1 is set before startup.
if (process.env.HTTPS_PROXY && !process.env.NODE_USE_ENV_PROXY) {
  const r = spawnSync(process.execPath, [...process.execArgv, ...process.argv.slice(1)], {
    stdio: 'inherit',
    env: { ...process.env, NODE_USE_ENV_PROXY: '1' },
  });
  process.exit(r.status ?? 1);
}

const args = new Map<string, string>();
for (const a of process.argv.slice(2)) {
  const m = /^--([^=]+)(?:=(.*))?$/.exec(a);
  if (m) args.set(m[1], m[2] ?? 'true');
}
const VERSION = args.get('version') ?? MC_VERSION;
const SOURCE = (args.get('source') ?? 'auto') as 'auto' | 'official' | 'mirror';
const FORCE = args.get('force') === 'true';
const SKIP_BUILD = args.get('skip-build') === 'true';

const MANIFEST_URL = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json';
const MIRROR_REPO = 'https://github.com/InventivetalentDev/minecraft-assets';
const MIRROR_RAW = `https://raw.githubusercontent.com/InventivetalentDev/minecraft-assets/${VERSION}`;
const MCDATA_RAW = 'https://raw.githubusercontent.com/PrismarineJS/minecraft-data/master/data';

/** Sub-trees of the client jar that the game uses. Everything else is ignored. */
const JAR_PATHS = [
  'assets/minecraft/textures/',
  'assets/minecraft/blockstates/',
  'assets/minecraft/models/',
  'assets/minecraft/items/',
  'assets/minecraft/texts/',
  'assets/minecraft/lang/en_us.json',
  'data/minecraft/recipe/',
  'data/minecraft/loot_table/',
  'data/minecraft/tags/',
  'data/minecraft/worldgen/biome/',
  'data/minecraft/worldgen/noise_settings/',
  'data/minecraft/worldgen/configured_feature/',
  'data/minecraft/worldgen/placed_feature/',
  'data/minecraft/worldgen/structure/',
  'data/minecraft/worldgen/structure_set/',
  'data/minecraft/worldgen/template_pool/',
  'data/minecraft/worldgen/processor_list/',
  'data/minecraft/structure/',
  'data/minecraft/enchantment/',
  'data/minecraft/trim_pattern/',
  'data/minecraft/trim_material/',
  'data/minecraft/damage_type/',
  'pack.mcmeta',
  'version.json',
];

const MCDATA_FILES = [
  'blocks', 'items', 'recipes', 'entities', 'biomes', 'foods', 'enchantments', 'effects', 'materials',
  'blockCollisionShapes', 'tints', 'attributes', 'instruments', 'particles', 'language', 'version',
  'blockLoot', 'entityLoot', 'windows',
];

const log = (msg: string) => console.log(`[assets] ${msg}`);

async function fetchWithRetry(url: string, tries = 4): Promise<Response> {
  let lastErr: unknown;
  for (let i = 0; i < tries; i++) {
    try {
      const res = await fetch(url, { redirect: 'follow' });
      if (res.ok) return res;
      lastErr = new Error(`${res.status} ${res.statusText} for ${url}`);
      if (res.status >= 400 && res.status < 500 && res.status !== 429) break;
    } catch (e) {
      lastErr = e;
    }
    await new Promise((r) => setTimeout(r, 500 * 2 ** i));
  }
  throw lastErr instanceof Error ? lastErr : new Error(String(lastErr));
}

async function download(url: string, dest: string): Promise<void> {
  const res = await fetchWithRetry(url);
  ensureDir(path.dirname(dest));
  fs.writeFileSync(dest, Buffer.from(await res.arrayBuffer()));
}

async function fetchJson<T>(url: string): Promise<T> {
  return (await (await fetchWithRetry(url)).json()) as T;
}

// ---------------------------------------------------------------------------------------------
// 1. Official: Mojang launcher manifest -> version json -> client jar -> extract what we need.
// ---------------------------------------------------------------------------------------------
async function fetchOfficial(dest: string): Promise<void> {
  interface Manifest { versions: { id: string; url: string }[] }
  interface VersionJson { downloads: { client: { url: string; sha1: string; size: number } } }
  log(`official: reading ${MANIFEST_URL}`);
  const manifest = await fetchJson<Manifest>(MANIFEST_URL);
  const entry = manifest.versions.find((v) => v.id === VERSION);
  if (!entry) throw new Error(`version ${VERSION} not in Mojang manifest`);
  const version = await fetchJson<VersionJson>(entry.url);
  const jarPath = path.join(CACHE, `client-${VERSION}.jar`);
  if (!fs.existsSync(jarPath) || fs.statSync(jarPath).size !== version.downloads.client.size) {
    log(`official: downloading client jar (${(version.downloads.client.size / 1048576).toFixed(1)} MB)`);
    await download(version.downloads.client.url, jarPath);
  }
  log('official: extracting');
  const files = unzipSync(new Uint8Array(fs.readFileSync(jarPath)), {
    filter: (f) => JAR_PATHS.some((p) => f.name.startsWith(p)) && !f.name.endsWith('/'),
  });
  let n = 0;
  for (const [name, data] of Object.entries(files)) {
    const out = path.join(dest, name);
    ensureDir(path.dirname(out));
    fs.writeFileSync(out, data);
    n++;
  }
  log(`official: extracted ${n} files`);
}

// ---------------------------------------------------------------------------------------------
// 2. Mirror: git sparse clone of the per-version branch, or raw downloads driven by _list.json.
// ---------------------------------------------------------------------------------------------
function gitAvailable(): boolean {
  return spawnSync('git', ['--version'], { stdio: 'ignore' }).status === 0;
}

function fetchMirrorGit(dest: string): boolean {
  const cloneDir = path.join(CACHE, `mirror-${VERSION}`);
  const run = (cmd: string[], cwd?: string) => {
    const r = spawnSync(cmd[0], cmd.slice(1), { cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    return r.status === 0;
  };
  if (!fs.existsSync(path.join(cloneDir, '.git'))) {
    fs.rmSync(cloneDir, { recursive: true, force: true });
    log(`mirror: git sparse clone of ${MIRROR_REPO}@${VERSION}`);
    if (!run(['git', 'clone', '--quiet', '--depth', '1', '--branch', VERSION, '--filter=blob:none', '--sparse', '--no-checkout', MIRROR_REPO, cloneDir])) return false;
  }
  const sparse = JAR_PATHS.map((p) => p.replace(/\/$/, ''));
  if (!run(['git', 'sparse-checkout', 'set', '--no-cone', ...sparse], cloneDir)) return false;
  if (!run(['git', 'checkout', '--quiet'], cloneDir)) return false;
  let n = 0;
  for (const p of JAR_PATHS) {
    const from = path.join(cloneDir, p);
    if (!fs.existsSync(from)) continue;
    if (fs.statSync(from).isDirectory()) n += copyDir(from, path.join(dest, p), (rel) => !/(^|\/)_(list|all)\.json$/.test(rel));
    else {
      ensureDir(path.dirname(path.join(dest, p)));
      fs.copyFileSync(from, path.join(dest, p));
      n++;
    }
  }
  log(`mirror: copied ${n} files from git checkout`);
  return n > 0;
}

async function fetchMirrorRaw(dest: string): Promise<void> {
  interface Listing { directories: string[]; files: string[] }
  const queue: string[] = [];
  const files: string[] = [];
  for (const p of JAR_PATHS) {
    if (p.endsWith('/')) queue.push(p.replace(/\/$/, ''));
    else files.push(p);
  }
  while (queue.length) {
    const dir = queue.pop()!;
    // a listing that is not there means this source does not carry that folder, which is only ever
    // true of the optional ones: the fetch goes on without it rather than failing outright
    const listing = await fetchJson<Listing>(`${MIRROR_RAW}/${dir}/_list.json`).catch(() => null);
    if (!listing) {
      log(`mirror: ${dir} not in this source, skipped`);
      continue;
    }
    for (const d of listing.directories) queue.push(`${dir}/${d}`);
    for (const f of listing.files) if (!/^_(list|all)\.json$/.test(f)) files.push(`${dir}/${f}`);
  }
  log(`mirror: downloading ${files.length} files`);
  let done = 0;
  const workers = Array.from({ length: 16 }, async () => {
    while (files.length) {
      const f = files.pop()!;
      const out = path.join(dest, f);
      if (!fs.existsSync(out)) await download(`${MIRROR_RAW}/${f}`, out);
      if (++done % 500 === 0) log(`mirror: ${done} files`);
    }
  });
  await Promise.all(workers);
}

async function ensureGameFiles(): Promise<string> {
  const dest = jarDir(VERSION);
  const marker = path.join(dest, '.complete');
  if (!FORCE && fs.existsSync(marker)) {
    const info = readJson<{ source: string }>(marker);
    log(`game files already present in ${path.relative(process.cwd(), dest)} (source: ${info.source})`);
    return info.source;
  }
  fs.rmSync(dest, { recursive: true, force: true });
  ensureDir(dest);
  let source = '';
  if (SOURCE !== 'mirror') {
    try {
      await fetchOfficial(dest);
      source = 'official';
    } catch (e) {
      if (SOURCE === 'official') throw e;
      log(`official source unavailable (${(e as Error).message}); falling back to the GitHub mirror`);
    }
  }
  if (!source) {
    if (gitAvailable() && fetchMirrorGit(dest)) source = 'mirror-git';
    else {
      await fetchMirrorRaw(dest);
      source = 'mirror-raw';
    }
  }
  writeJson(marker, { version: VERSION, source, fetched: new Date().toISOString() }, true);
  return source;
}

// ---------------------------------------------------------------------------------------------
// 3. PrismarineJS minecraft-data (hardness, harvest tools, entity sizes, biomes, enchantments...).
// ---------------------------------------------------------------------------------------------
async function ensureMinecraftData(): Promise<void> {
  const dest = mcDataDir(VERSION);
  const marker = path.join(dest, '.complete');
  if (!FORCE && fs.existsSync(marker)) {
    log('minecraft-data already present');
    return;
  }
  ensureDir(dest);
  const dataPaths = await fetchJson<{ pc: Record<string, Record<string, string>> }>(`${MCDATA_RAW}/dataPaths.json`);
  const paths = dataPaths.pc[VERSION];
  if (!paths) throw new Error(`minecraft-data has no entry for ${VERSION}`);
  await Promise.all(
    MCDATA_FILES.map(async (name) => {
      const dir = paths[name];
      if (!dir) return;
      await download(`${MCDATA_RAW}/${dir}/${name}.json`, path.join(dest, `${name}.json`));
    }),
  );
  writeJson(marker, { version: VERSION, fetched: new Date().toISOString() }, true);
  log(`minecraft-data: ${MCDATA_FILES.filter((n) => paths[n]).length} files`);
}

// ---------------------------------------------------------------------------------------------
// 4. Lay the files out resource-pack style under assets/ and build the runtime bundles in public/.
// ---------------------------------------------------------------------------------------------
function syncAssets(): void {
  const jar = jarDir(VERSION);
  const mc = path.join(jar, 'assets', 'minecraft');
  const pairs: [string, string][] = [
    ['textures', 'textures'],
    ['blockstates', 'blockstates'],
    ['models', 'models'],
    ['items', 'items'],
    ['texts', 'texts'],
    ['lang', 'lang'],
  ];
  for (const [from, to] of pairs) {
    fs.rmSync(path.join(ASSETS, to), { recursive: true, force: true });
    if (!fs.existsSync(path.join(mc, from))) {
      log(`assets/${to}: not in this source, skipped`);
      continue;
    }
    const n = copyDir(path.join(mc, from), path.join(ASSETS, to));
    log(`assets/${to}: ${n} files`);
  }
}

function buildRuntimeBundles(): void {
  const m = buildModels();
  log(`public/models.json: ${m.blockstates} blockstates, ${m.models} models, ${(m.bytes / 1024).toFixed(0)} KB`);
  const a = buildAtlases();
  for (const r of a) log(`public/atlas/${r.name}.png: ${r.tiles} tiles, ${r.width}x${r.height}`);
  // Textures that are used directly (GUI, sky, particles, mob effects...) rather than through an atlas.
  const texRoot = path.join(ASSETS, 'textures');
  fs.rmSync(path.join(PUBLIC, 'textures'), { recursive: true, force: true });
  let n = 0;
  for (const cat of fs.readdirSync(texRoot)) {
    if (cat === 'block' || cat === 'item') continue;
    n += copyDir(path.join(texRoot, cat), path.join(PUBLIC, 'textures', cat));
  }
  log(`public/textures: ${n} files`);
  ensureDir(path.join(PUBLIC, 'lang'));
  fs.copyFileSync(path.join(ASSETS, 'lang', 'en_us.json'), path.join(PUBLIC, 'lang', 'en_us.json'));
  // the end poem and the credits, read at runtime by the screen that plays after the dragon
  fs.rmSync(path.join(PUBLIC, 'texts'), { recursive: true, force: true });
  if (fs.existsSync(path.join(ASSETS, 'texts'))) log(`public/texts: ${copyDir(path.join(ASSETS, 'texts'), path.join(PUBLIC, 'texts'))} files`);
}

async function main() {
  ensureDir(CACHE);
  const source = await ensureGameFiles();
  await ensureMinecraftData();
  syncAssets();
  if (!SKIP_BUILD) buildRuntimeBundles();
  log(`done (Minecraft ${VERSION}, source ${source})`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
