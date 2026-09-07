'use strict'

// Pure target resolution: turning what somebody typed in chat ("mine iron")
// into a concrete list of block names, and ranking the candidates the world
// search comes back with.

// Named groups, so "iron" means the ore in both its stone and deepslate form
// rather than iron bars and iron blocks.
const GROUPS = {
  coal: ['coal_ore', 'deepslate_coal_ore'],
  iron: ['iron_ore', 'deepslate_iron_ore'],
  copper: ['copper_ore', 'deepslate_copper_ore'],
  gold: ['gold_ore', 'deepslate_gold_ore', 'nether_gold_ore'],
  redstone: ['redstone_ore', 'deepslate_redstone_ore'],
  lapis: ['lapis_ore', 'deepslate_lapis_ore'],
  emerald: ['emerald_ore', 'deepslate_emerald_ore'],
  diamond: ['diamond_ore', 'deepslate_diamond_ore'],
  quartz: ['nether_quartz_ore'],
  netherite: ['ancient_debris'],
  debris: ['ancient_debris'],
  stone: ['stone', 'cobblestone', 'deepslate', 'cobbled_deepslate', 'granite', 'diorite', 'andesite', 'tuff', 'calcite'],
  dirt: ['dirt', 'grass_block', 'coarse_dirt', 'rooted_dirt', 'podzol', 'mycelium'],
  sand: ['sand', 'red_sand', 'soul_sand'],
  gravel: ['gravel'],
  clay: ['clay'],
  obsidian: ['obsidian', 'crying_obsidian'],
  glowstone: ['glowstone'],
  netherrack: ['netherrack']
}

// Groups built by pattern instead of by hand, because the block list grows with
// every wood type Mojang adds.
const PATTERN_GROUPS = {
  wood: (name) => name.endsWith('_log') || name.endsWith('_stem') || name.endsWith('_wood') || name.endsWith('_hyphae'),
  log: (name) => name.endsWith('_log') || name.endsWith('_stem'),
  logs: (name) => name.endsWith('_log') || name.endsWith('_stem'),
  tree: (name) => name.endsWith('_log') || name.endsWith('_stem'),
  leaves: (name) => name.endsWith('_leaves'),
  planks: (name) => name.endsWith('_planks'),
  ores: (name) => name.endsWith('_ore') || name === 'ancient_debris',
  ore: (name) => name.endsWith('_ore') || name === 'ancient_debris',
  wool: (name) => name.endsWith('_wool'),
  glass: (name) => name === 'glass' || name.endsWith('_stained_glass'),
  crops: (name) => ['wheat', 'carrots', 'potatoes', 'beetroots', 'nether_wart'].includes(name)
}

// Blocks the bot will not break unless it was named exactly, so a "mine stone"
// order never eats somebody's chest or the bed they sleep in.
const PROTECTED = new Set([
  'chest', 'trapped_chest', 'ender_chest', 'barrel', 'shulker_box', 'furnace',
  'blast_furnace', 'smoker', 'brewing_stand', 'enchanting_table', 'anvil',
  'beacon', 'conduit', 'spawner', 'end_portal_frame', 'respawn_anchor',
  'lodestone', 'jukebox', 'note_block', 'bell', 'lectern', 'hopper',
  'dispenser', 'dropper', 'crafting_table', 'grindstone', 'smithing_table',
  'cartography_table', 'fletching_table', 'loom', 'stonecutter', 'composter',
  'campfire', 'soul_campfire', 'bookshelf', 'chiseled_bookshelf'
])

// Blocks nothing can break, or that break the bot's day when they do.
const NEVER_DIG = new Set([
  'bedrock', 'barrier', 'command_block', 'chain_command_block',
  'repeating_command_block', 'structure_block', 'jigsaw', 'end_portal',
  'end_gateway', 'nether_portal', 'light', 'water', 'lava', 'fire',
  'soul_fire', 'air', 'cave_air', 'void_air', 'moving_piston'
])

const HAZARDS = new Set(['lava', 'flowing_lava', 'fire', 'soul_fire', 'magma_block'])
const FALLING = new Set(['sand', 'red_sand', 'gravel', 'anvil', 'suspicious_sand', 'suspicious_gravel'])

function normalise (query) {
  return String(query || '').trim().toLowerCase().replace(/[\s-]+/g, '_')
}

// Resolve a chat word to real block names. `known` is the set of block names the
// server's version actually has, so the bot never asks for a block that does
// not exist on that version.
function resolveBlockNames (query, known) {
  const want = normalise(query)
  if (!want) return []
  const has = (name) => !known || known.has(name)
  const all = known ? [...known] : []

  // Somebody typed a real block name: take them at their word, protected or not.
  if (has(want)) return [want]

  if (GROUPS[want]) return GROUPS[want].filter(has)

  // Plural of a group, e.g. "diamonds".
  const singular = want.replace(/s$/, '')
  if (GROUPS[singular] && !PATTERN_GROUPS[want]) return GROUPS[singular].filter(has)

  if (PATTERN_GROUPS[want]) return all.filter(PATTERN_GROUPS[want]).sort()

  // Last resort: treat it as a fragment, but only against non-protected blocks
  // so a loose word cannot select the furniture.
  const loose = all.filter((name) => name.includes(want) && !PROTECTED.has(name) && !NEVER_DIG.has(name))
  if (loose.length) {
    // "iron" should not pull in iron_bars when iron_ore is on the table.
    const ores = loose.filter((name) => name.endsWith('_ore'))
    return (ores.length ? ores : loose).sort()
  }
  return []
}

// Is it sane to break this block? `neighbourNames` are the six blocks touching
// it plus the one above, by name.
function isDiggingSafe (blockName, neighbourNames = [], opts = {}) {
  const { allowUnderFalling = false } = opts
  if (NEVER_DIG.has(blockName)) return false
  for (const n of neighbourNames) {
    if (HAZARDS.has(n)) return false
  }
  if (!allowUnderFalling && neighbourNames.above && FALLING.has(neighbourNames.above)) return false
  return true
}

// Order candidate positions so the bot works outward from where it stands and
// stays roughly level, rather than yo-yoing up and down a shaft.
function rankTargets (positions, origin, opts = {}) {
  const { verticalPenalty = 2 } = opts
  return positions
    .map((pos) => {
      const dx = pos.x - origin.x
      const dy = pos.y - origin.y
      const dz = pos.z - origin.z
      const flat = Math.sqrt(dx * dx + dz * dz)
      return { pos, cost: flat + Math.abs(dy) * verticalPenalty }
    })
    .sort((a, b) => a.cost - b.cost)
    .map((c) => c.pos)
}

module.exports = {
  GROUPS,
  PATTERN_GROUPS,
  PROTECTED,
  NEVER_DIG,
  HAZARDS,
  FALLING,
  normalise,
  resolveBlockNames,
  isDiggingSafe,
  rankTargets
}
