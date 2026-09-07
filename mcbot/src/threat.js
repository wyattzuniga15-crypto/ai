'use strict'

// Pure threat assessment. Entities are plain objects shaped like mineflayer's:
// { id, name, kind, type, position: { x, y, z }, username }.

// Mobs that will come for the bot on sight.
const HOSTILE = new Set([
  'zombie', 'husk', 'drowned', 'zombie_villager', 'zombified_piglin_baby',
  'skeleton', 'stray', 'bogged', 'wither_skeleton', 'skeleton_horse',
  'creeper', 'cave_spider', 'silverfish', 'endermite', 'witch',
  'slime', 'magma_cube', 'blaze', 'ghast', 'phantom', 'vex',
  'pillager', 'vindicator', 'evoker', 'illusioner', 'ravager',
  'guardian', 'shulker', 'hoglin', 'zoglin', 'piglin_brute', 'breeze'
])

// Mobs that leave the bot alone until provoked. Worth fighting only if they
// have already picked the fight.
const NEUTRAL = new Set([
  'enderman', 'zombified_piglin', 'piglin', 'spider', 'iron_golem', 'wolf',
  'polar_bear', 'llama', 'trader_llama', 'panda', 'bee', 'dolphin', 'goat',
  'snow_golem'
])

// Fights a melee bot does not win. Run instead.
const AVOID = new Set([
  'warden', 'ender_dragon', 'wither', 'elder_guardian', 'ravager'
])

// Mobs that hurt most when you stand next to them, so the bot fights them at
// arm's length and backs off between swings.
const EXPLOSIVE = new Set(['creeper'])

// Mobs that shoot, so closing the distance is the whole fight.
const RANGED = new Set([
  'skeleton', 'stray', 'bogged', 'witch', 'pillager', 'blaze', 'ghast',
  'guardian', 'elder_guardian', 'shulker', 'illusioner', 'breeze'
])

// Rough "how much this hurts" weight, used to break ties when several mobs are
// in range and only one can be hit at a time.
const DANGER = {
  creeper: 10,
  witch: 7,
  blaze: 7,
  vindicator: 7,
  piglin_brute: 7,
  ravager: 9,
  pillager: 6,
  skeleton: 6,
  stray: 6,
  bogged: 6,
  wither_skeleton: 6,
  cave_spider: 5,
  zombie: 4,
  husk: 4,
  drowned: 4,
  zombie_villager: 4,
  spider: 4,
  slime: 3,
  magma_cube: 4,
  silverfish: 2,
  endermite: 2,
  phantom: 5,
  vex: 5,
  enderman: 8,
  hoglin: 6,
  zoglin: 6,
  guardian: 5,
  shulker: 4,
  breeze: 5
}

const DEFAULT_DANGER = 4

function classify (name) {
  if (!name) return 'passive'
  if (AVOID.has(name)) return 'avoid'
  if (HOSTILE.has(name)) return 'hostile'
  if (NEUTRAL.has(name)) return 'neutral'
  return 'passive'
}

function distance (a, b) {
  if (!a || !b) return Infinity
  const dx = a.x - b.x
  const dy = a.y - b.y
  const dz = a.z - b.z
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

function isMob (entity) {
  return Boolean(entity) && (entity.type === 'mob' || entity.type === 'hostile' ||
    entity.kind === 'Hostile mobs' || entity.kind === 'Passive mobs')
}

// Should the bot treat this entity as something to fight right now?
// `provoked` is the set of entity ids known to be attacking the bot, which is
// the only thing that makes a neutral mob a target.
function isThreat (entity, ctx = {}) {
  if (!isMob(entity)) return false
  const {
    origin,
    engageRadius = 16,
    provoked = new Set(),
    ignore = new Set(),
    fightAvoidable = false
  } = ctx

  if (ignore.has(entity.id)) return false

  const kind = classify(entity.name)
  if (kind === 'passive') return false
  if (kind === 'avoid' && !fightAvoidable && !provoked.has(entity.id)) return false
  if (kind === 'neutral' && !provoked.has(entity.id)) return false

  if (origin && distance(origin, entity.position) > engageRadius) return false
  return true
}

// Higher is more urgent. Distance dominates — the mob chewing on the bot's leg
// matters more than the scarier one across the field — with danger weight and
// "it is already hitting us" as the tiebreakers.
function threatScore (entity, ctx = {}) {
  const { origin, provoked = new Set() } = ctx
  const dist = origin ? distance(origin, entity.position) : 0
  const danger = DANGER[entity.name] ?? DEFAULT_DANGER
  const proximity = 100 / (1 + dist)
  let score = proximity + danger
  if (provoked.has(entity.id)) score += 15
  // A creeper close enough to matter is the only thing worth answering.
  if (EXPLOSIVE.has(entity.name) && dist < 6) score += 40
  return score
}

function findThreats (entities, ctx = {}) {
  return Object.values(entities || {})
    .filter((e) => isThreat(e, ctx))
    .map((e) => ({ entity: e, score: threatScore(e, ctx), distance: distance(ctx.origin, e.position) }))
    .sort((a, b) => b.score - a.score)
}

function pickTarget (entities, ctx = {}) {
  const threats = findThreats(entities, ctx)
  return threats.length ? threats[0].entity : null
}

// The band the bot wants to fight this mob from, measured the way Minecraft
// measures a swing: from the eyes to the nearest point of the target's hitbox.
// Vanilla reach is 3 blocks. Anything closer than `tooClose` is worth giving up
// ground for — which for a creeper is the difference between a fight and a hole
// in the floor.
function preferredRange (entity) {
  if (EXPLOSIVE.has(entity?.name)) return { attack: 3.0, tooClose: 2.0 }
  return { attack: 3.0, tooClose: 0 }
}

module.exports = {
  HOSTILE,
  NEUTRAL,
  AVOID,
  EXPLOSIVE,
  RANGED,
  DANGER,
  classify,
  distance,
  isMob,
  isThreat,
  threatScore,
  findThreats,
  pickTarget,
  preferredRange
}
