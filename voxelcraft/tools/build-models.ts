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
  const out = path.join(PUBLIC, 'models.json');
  writeJson(out, { blockstates, models });
  return { blockstates: Object.keys(blockstates).length, models: Object.keys(models).length, bytes: fs.statSync(out).size };
}

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const r = buildModels();
  console.log(`models.json: ${r.blockstates} blockstates, ${r.models} models, ${(r.bytes / 1024).toFixed(0)} KB`);
}
