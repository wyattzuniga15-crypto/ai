/**
 * Merges the vanilla blockstate and model JSON files (fetched by `npm run assets`) into one
 * compact `public/models.json` that the game and its mesh worker load at startup.
 *
 * Namespaces are stripped ("minecraft:block/stone" -> "block/stone") so the runtime never has to
 * care about them. Everything else is kept verbatim: the runtime model baker implements the vanilla
 * model format (parents, textures, elements, rotations, uvlock, variants, multipart).
 */
import fs from 'node:fs';
import path from 'node:path';
import { ASSETS, PUBLIC } from './lib/paths.ts';
import { listFiles, readJson, stripNs, writeJson } from './lib/fs.ts';

type Json = Record<string, unknown>;

function normalizeModel(model: Json): Json {
  const out: Json = {};
  if (typeof model.parent === 'string') out.parent = stripNs(model.parent);
  if (model.ambientocclusion === false) out.ambientocclusion = false;
  if (model.textures && typeof model.textures === 'object') {
    const tex: Record<string, string> = {};
    for (const [k, v] of Object.entries(model.textures as Record<string, string>)) tex[k] = stripNs(v);
    out.textures = tex;
  }
  if (Array.isArray(model.elements)) out.elements = model.elements;
  if (model.display) out.display = model.display;
  if (model.gui_light) out.gui_light = model.gui_light;
  return out;
}

function normalizeVariantList(v: unknown): unknown {
  const fix = (m: Json) => {
    const o: Json = { ...m };
    if (typeof o.model === 'string') o.model = stripNs(o.model);
    return o;
  };
  return Array.isArray(v) ? v.map((m) => fix(m as Json)) : fix(v as Json);
}

function normalizeBlockstate(bs: Json): Json {
  const out: Json = {};
  if (bs.variants && typeof bs.variants === 'object') {
    const variants: Json = {};
    for (const [k, v] of Object.entries(bs.variants as Json)) variants[k] = normalizeVariantList(v);
    out.variants = variants;
  }
  if (Array.isArray(bs.multipart)) {
    out.multipart = (bs.multipart as Json[]).map((part) => ({
      ...(part.when ? { when: part.when } : {}),
      apply: normalizeVariantList(part.apply),
    }));
  }
  return out;
}

/**
 * Geometry vanilla's own client supplies in code rather than in JSON: the End portal and the End
 * gateway are drawn by a block entity renderer, so their models carry no elements at all. These
 * stand in for that renderer with the same starfield on a plain quad — the portal's surface sits
 * three quarters of the way up the block, as its shape does in vanilla, and the gateway is a cube.
 * The `uv` takes a sixteenth of the starfield so the stars land thickly over a single block.
 */
const SYNTHESIZED_MODELS: Record<string, Json> = {
  'block/end_portal': {
    textures: { particle: 'block/obsidian', portal: 'block/end_portal_stars' },
    elements: [{ from: [0, 0, 0], to: [16, 12, 16], faces: { up: { uv: [0, 0, 4, 4], texture: '#portal' } } }],
  },
  'block/end_gateway': {
    textures: { particle: 'block/obsidian', portal: 'block/end_portal_stars' },
    elements: [{
      from: [0, 0, 0], to: [16, 16, 16],
      faces: Object.fromEntries(['down', 'up', 'north', 'south', 'west', 'east'].map((f) => [f, { uv: [0, 0, 4, 4], texture: '#portal' }])),
    }],
  },
};

/** The first plain model an items/ definition names, however deep its conditions go. */
function firstModel(node: unknown): string | null {
  if (Array.isArray(node)) {
    for (const child of node) {
      const found = firstModel(child);
      if (found) return found;
    }
    return null;
  }
  if (!node || typeof node !== 'object') return null;
  const o = node as Json;
  if (o.type === 'minecraft:model' && typeof o.model === 'string') return stripNs(o.model);
  for (const value of Object.values(o)) {
    const found = firstModel(value);
    if (found) return found;
  }
  return null;
}

export function buildModels(): { blockstates: number; models: number; bytes: number } {
  const blockstatesDir = path.join(ASSETS, 'blockstates');
  const modelsDir = path.join(ASSETS, 'models');
  if (!fs.existsSync(blockstatesDir) || !fs.existsSync(modelsDir)) {
    throw new Error('assets/blockstates or assets/models missing – run `npm run assets` first');
  }
  const blockstates: Json = {};
  for (const f of listFiles(blockstatesDir, '.json')) {
    blockstates[f.slice(0, -5)] = normalizeBlockstate(readJson<Json>(path.join(blockstatesDir, f)));
  }
  const models: Json = {};
  for (const sub of ['block', 'item']) {
    const dir = path.join(modelsDir, sub);
    for (const f of listFiles(dir, '.json')) {
      models[`${sub}/${f.slice(0, -5)}`] = normalizeModel(readJson<Json>(path.join(dir, f)));
    }
  }
  for (const [name, model] of Object.entries(SYNTHESIZED_MODELS)) models[name] = model;
  // Items whose look is chosen at runtime (a compass by its needle, a clock by the sun) carry no
  // model of their own, only an items/ definition that picks one. The first model such a definition
  // names is the one to draw them by, which is what the compass in a frame looks like.
  const itemsDir = path.join(ASSETS, 'items');
  if (fs.existsSync(itemsDir)) {
    for (const f of listFiles(itemsDir, '.json')) {
      const id = f.slice(0, -5);
      if (models[`item/${id}`]) continue;
      const first = firstModel(readJson<Json>(path.join(itemsDir, f)));
      if (first && models[first]) models[`item/${id}`] = { parent: first };
    }
  }
  const out = path.join(PUBLIC, 'models.json');
  writeJson(out, { blockstates, models });
  return { blockstates: Object.keys(blockstates).length, models: Object.keys(models).length, bytes: fs.statSync(out).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const r = buildModels();
  console.log(`models.json: ${r.blockstates} blockstates, ${r.models} models, ${(r.bytes / 1024).toFixed(0)} KB`);
}
