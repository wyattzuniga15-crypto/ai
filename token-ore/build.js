#!/usr/bin/env node
// Builds CvC_TokenOre.mcaddon from BP/ and RP/.
//
// Before zipping it checks the packs for the mistakes Minecraft only reports
// in its content log: broken JSON, a dangling texture or loot-table path, a
// block or item without a name, a feature rule that places a feature that
// does not exist, or a behavior pack that does not point at this resource
// pack. Run it from anywhere:  node token-ore/build.js
"use strict";
const fs = require("fs");
const path = require("path");
const zlib = require("zlib");
const { execFileSync } = require("child_process");

const ROOT = __dirname;
const PACKS = { BP: "CvC_TokenOre_BP", RP: "CvC_TokenOre_RP" };
const OUT = path.join(ROOT, "CvC_TokenOre.mcaddon");

const problems = [];
const fail = (msg) => { if (!problems.includes(msg)) problems.push(msg); };
const exists = (rel) => fs.existsSync(path.join(ROOT, rel));

function walk(dir, base = dir) {
  const out = [];
  for (const name of fs.readdirSync(dir).sort()) {
    const full = path.join(dir, name);
    if (fs.statSync(full).isDirectory()) out.push(...walk(full, base));
    else out.push(path.relative(base, full).split(path.sep).join("/"));
  }
  return out;
}

function readJson(rel) {
  try {
    return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
  } catch (e) {
    fail(`${rel}: ${e.message}`);
    return null;
  }
}

function lang(rel) {
  const keys = new Set();
  for (const line of fs.readFileSync(path.join(ROOT, rel), "utf8").split(/\r?\n/)) {
    const m = /^([^#=][^=]*)=(.*)$/.exec(line.trim());
    if (m && m[2].trim()) keys.add(m[1].trim());
  }
  return keys;
}

// ---------------------------------------------------------------- checks --
const files = {};
for (const pack of Object.keys(PACKS)) {
  files[pack] = walk(path.join(ROOT, pack));
  for (const rel of files[pack]) if (rel.endsWith(".json")) readJson(`${pack}/${rel}`);
}

const bpManifest = readJson("BP/manifest.json");
const rpManifest = readJson("RP/manifest.json");
if (bpManifest && rpManifest) {
  const rpUuid = rpManifest.header.uuid;
  const deps = bpManifest.dependencies || [];
  if (!deps.some((d) => d.uuid === rpUuid)) fail("BP/manifest.json does not depend on the RP uuid, so the RP will not auto-attach");
  if (!deps.some((d) => d.module_name === "@minecraft/server")) fail("BP/manifest.json has no @minecraft/server dependency");
  const script = (bpManifest.modules || []).find((m) => m.type === "script");
  if (!script) fail("BP/manifest.json has no script module");
  else if (!exists(`BP/${script.entry}`)) fail(`BP/manifest.json script entry ${script.entry} is missing`);
  else execFileSync(process.execPath, ["--check", path.join(ROOT, "BP", script.entry)], { stdio: "inherit" });
  const uuids = [bpManifest.header.uuid, rpUuid, ...bpManifest.modules.map((m) => m.uuid), ...rpManifest.modules.map((m) => m.uuid)];
  if (new Set(uuids).size !== uuids.length) fail("manifest uuids are not all distinct");
}

const terrain = readJson("RP/textures/terrain_texture.json");
const items = readJson("RP/textures/item_texture.json");
for (const [rel, atlas] of [["RP/textures/terrain_texture.json", terrain], ["RP/textures/item_texture.json", items]]) {
  if (!atlas) continue;
  for (const [key, entry] of Object.entries(atlas.texture_data || {})) {
    const tex = typeof entry.textures === "string" ? entry.textures : entry.textures && entry.textures.path;
    if (!tex || !exists(`RP/${tex}.png`)) fail(`${rel}: texture "${key}" points at RP/${tex}.png, which does not exist`);
  }
}

const names = exists("RP/texts/en_US.lang") ? lang("RP/texts/en_US.lang") : new Set();
const blockIds = new Set();
const itemIds = new Set();
const wearables = new Set();
for (const rel of files.BP.filter((f) => f.startsWith("blocks/") && f.endsWith(".json"))) {
  const block = readJson(`BP/${rel}`);
  if (!block) continue;
  const def = block["minecraft:block"];
  const id = def.description.identifier;
  blockIds.add(id);
  if (!names.has(`tile.${id}.name`)) fail(`RP/texts/en_US.lang has no tile.${id}.name entry`);
  for (const inst of Object.values(def.components["minecraft:material_instances"] || {})) {
    if (terrain && !(inst.texture in terrain.texture_data)) fail(`BP/${rel}: texture "${inst.texture}" is not in terrain_texture.json`);
  }
  const loot = def.components["minecraft:loot"];
  if (loot && !exists(`BP/${loot}`)) fail(`BP/${rel}: loot table ${loot} is missing`);
  if (!def.description.menu_category) fail(`BP/${rel}: no menu_category, so it will not show in the creative inventory`);
}
for (const rel of files.BP.filter((f) => f.startsWith("items/") && f.endsWith(".json"))) {
  const item = readJson(`BP/${rel}`);
  if (!item) continue;
  const def = item["minecraft:item"];
  const id = def.description.identifier;
  itemIds.add(id);
  if (!names.has(`item.${id}`)) fail(`RP/texts/en_US.lang has no item.${id} entry`);
  const icon = def.components["minecraft:icon"];
  const key = typeof icon === "string" ? icon : icon && icon.textures && icon.textures.default;
  if (items && !(key in items.texture_data)) fail(`BP/${rel}: icon "${key}" is not in item_texture.json`);
  if (!def.description.menu_category) fail(`BP/${rel}: no menu_category, so it will not show in the creative inventory`);
  if (def.components["minecraft:wearable"]) wearables.add(id);
}

// Armor is invisible when worn unless an attachable binds a model to the item.
const ARMOR_GEOMETRY = new Set(["helmet", "chestplate", "leggings", "boots"].flatMap((p) => [`geometry.humanoid.armor.${p}`, `geometry.player.armor.${p}`]));
const attached = new Set();
for (const rel of files.RP.filter((f) => f.startsWith("attachables/") && f.endsWith(".json"))) {
  const attachable = readJson(`RP/${rel}`);
  if (!attachable) continue;
  const desc = attachable["minecraft:attachable"].description;
  const target = desc.item ? Object.keys(desc.item)[0] : desc.identifier;
  if (!itemIds.has(target)) fail(`RP/${rel}: attaches to unknown item ${target}`);
  attached.add(target);
  const tex = desc.textures && desc.textures.default;
  if (!tex || !exists(`RP/${tex}.png`)) fail(`RP/${rel}: texture RP/${tex}.png is missing`);
  const geo = desc.geometry && desc.geometry.default;
  if (!ARMOR_GEOMETRY.has(geo)) fail(`RP/${rel}: unknown armor geometry ${geo}`);
}
for (const id of wearables) if (!attached.has(id)) fail(`${id} is wearable but has no attachable in RP/attachables`);

const featureIds = new Set();
for (const rel of files.BP.filter((f) => f.startsWith("features/") && f.endsWith(".json"))) {
  const feature = readJson(`BP/${rel}`);
  if (!feature) continue;
  for (const [kind, def] of Object.entries(feature)) {
    if (kind === "format_version") continue;
    featureIds.add(def.description.identifier);
    for (const rule of def.replace_rules || []) {
      if (!blockIds.has(rule.places_block)) fail(`BP/${rel}: places unknown block ${rule.places_block}`);
    }
  }
}
for (const rel of files.BP.filter((f) => f.startsWith("feature_rules/") && f.endsWith(".json"))) {
  const rule = readJson(`BP/${rel}`);
  if (!rule) continue;
  const def = rule["minecraft:feature_rules"];
  if (!featureIds.has(def.description.places_feature)) fail(`BP/${rel}: places unknown feature ${def.description.places_feature}`);
}
for (const rel of files.BP.filter((f) => f.startsWith("recipes/") && f.endsWith(".json"))) {
  const recipe = readJson(`BP/${rel}`);
  if (!recipe) continue;
  for (const def of Object.values(recipe)) {
    if (typeof def !== "object") continue;
    const refs = [def.input, def.output, def.result, ...(def.unlock || []), ...(def.ingredients || []), ...Object.values(def.key || {})];
    for (const ref of refs) {
      const id = typeof ref === "string" ? ref : ref && ref.item;
      if (id && id.startsWith("cvc:") && !itemIds.has(id) && !blockIds.has(id)) fail(`BP/${rel}: unknown item ${id}`);
    }
  }
}

if (problems.length) {
  console.error("Not building. Fix these first:\n  " + problems.join("\n  "));
  process.exit(1);
}

// -------------------------------------------------------------------- zip --
// A minimal deflate zip writer with fixed timestamps, so rebuilding from
// unchanged sources yields a byte-identical .mcaddon.
const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
function crc32(buf) {
  let c = 0xffffffff;
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1; // 2026-01-01
const DOS_TIME = 0;

const locals = [];
const central = [];
let offset = 0;
for (const [pack, folder] of Object.entries(PACKS)) {
  for (const rel of files[pack]) {
    const name = Buffer.from(`${folder}/${rel}`, "utf8");
    const data = fs.readFileSync(path.join(ROOT, pack, rel));
    const packed = zlib.deflateRawSync(data, { level: 9 });
    const crc = crc32(data);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(8, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(packed.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(0, 8);
    entry.writeUInt16LE(8, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(packed.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(name.length, 28);
    entry.writeUInt16LE(0, 30);
    entry.writeUInt16LE(0, 32);
    entry.writeUInt16LE(0, 34);
    entry.writeUInt16LE(0, 36);
    entry.writeUInt32LE(0, 38);
    entry.writeUInt32LE(offset, 42);
    locals.push(local, name, packed);
    central.push(entry, name);
    offset += local.length + name.length + packed.length;
  }
}
const cd = Buffer.concat(central);
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(0, 4);
end.writeUInt16LE(0, 6);
end.writeUInt16LE(files.BP.length + files.RP.length, 8);
end.writeUInt16LE(files.BP.length + files.RP.length, 10);
end.writeUInt32LE(cd.length, 12);
end.writeUInt32LE(offset, 16);
end.writeUInt16LE(0, 20);
fs.writeFileSync(OUT, Buffer.concat([...locals, cd, end]));
console.log(`${path.basename(OUT)}: ${files.BP.length + files.RP.length} files, ${fs.statSync(OUT).size} bytes`);
