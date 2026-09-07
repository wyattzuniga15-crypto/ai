'use strict'

// Pure gear decisions. Nothing in here touches the bot or the network, so all of
// it is unit-testable against plain fixtures.
//
// Items are prismarine-item shaped: { name, type, count, maxDurability,
// durabilityUsed, enchants: [{ name, lvl }] }.

// Melee damage and attack speed, Java Edition 1.9+ combat. Damage is the value
// the item adds on a fully charged swing; speed is swings per second, which is
// what turns damage into a comparable rate.
const WEAPONS = {
  wooden_sword: { damage: 4, speed: 1.6 },
  golden_sword: { damage: 4, speed: 1.6 },
  stone_sword: { damage: 5, speed: 1.6 },
  iron_sword: { damage: 6, speed: 1.6 },
  diamond_sword: { damage: 7, speed: 1.6 },
  netherite_sword: { damage: 8, speed: 1.6 },
  wooden_axe: { damage: 7, speed: 0.8 },
  stone_axe: { damage: 9, speed: 0.8 },
  golden_axe: { damage: 7, speed: 1.0 },
  iron_axe: { damage: 9, speed: 0.9 },
  diamond_axe: { damage: 9, speed: 1.0 },
  netherite_axe: { damage: 10, speed: 1.0 },
  trident: { damage: 9, speed: 1.1 }
}

const FIST = { damage: 1, speed: 4.0 }

// Armour points and toughness per piece.
const ARMOR = {
  leather_helmet: { slot: 'head', points: 1, toughness: 0 },
  leather_chestplate: { slot: 'torso', points: 3, toughness: 0 },
  leather_leggings: { slot: 'legs', points: 2, toughness: 0 },
  leather_boots: { slot: 'feet', points: 1, toughness: 0 },
  golden_helmet: { slot: 'head', points: 2, toughness: 0 },
  golden_chestplate: { slot: 'torso', points: 5, toughness: 0 },
  golden_leggings: { slot: 'legs', points: 3, toughness: 0 },
  golden_boots: { slot: 'feet', points: 1, toughness: 0 },
  chainmail_helmet: { slot: 'head', points: 2, toughness: 0 },
  chainmail_chestplate: { slot: 'torso', points: 5, toughness: 0 },
  chainmail_leggings: { slot: 'legs', points: 4, toughness: 0 },
  chainmail_boots: { slot: 'feet', points: 1, toughness: 0 },
  iron_helmet: { slot: 'head', points: 2, toughness: 0 },
  iron_chestplate: { slot: 'torso', points: 6, toughness: 0 },
  iron_leggings: { slot: 'legs', points: 5, toughness: 0 },
  iron_boots: { slot: 'feet', points: 2, toughness: 0 },
  turtle_helmet: { slot: 'head', points: 2, toughness: 0 },
  diamond_helmet: { slot: 'head', points: 3, toughness: 2 },
  diamond_chestplate: { slot: 'torso', points: 8, toughness: 2 },
  diamond_leggings: { slot: 'legs', points: 6, toughness: 2 },
  diamond_boots: { slot: 'feet', points: 3, toughness: 2 },
  netherite_helmet: { slot: 'head', points: 3, toughness: 3 },
  netherite_chestplate: { slot: 'torso', points: 8, toughness: 3 },
  netherite_leggings: { slot: 'legs', points: 6, toughness: 3 },
  netherite_boots: { slot: 'feet', points: 3, toughness: 3 }
}

const ARMOR_SLOTS = ['head', 'torso', 'legs', 'feet']

// Food the bot should not eat unless it is the only thing left.
const RISKY_FOOD = new Set([
  'rotten_flesh', 'spider_eye', 'poisonous_potato', 'pufferfish',
  'chicken', 'suspicious_stew', 'chorus_fruit'
])

function enchantLevel (item, name) {
  if (!item || !Array.isArray(item.enchants)) return 0
  const hit = item.enchants.find((e) => e && e.name === name)
  return hit ? hit.lvl : 0
}

// Uses left before the item breaks. Infinity for anything unbreakable.
function durabilityLeft (item) {
  if (!item || !item.maxDurability) return Infinity
  return item.maxDurability - (item.durabilityUsed || 0)
}

// A tool this close to snapping is worth saving if anything else will do.
function isFragile (item, reserve) {
  return durabilityLeft(item) <= reserve
}

// Pick what to hold to break `block`. `block` is prismarine-block shaped: it
// supplies digTime(itemType, creative, inWater, notOnGround, enchants) in ms and
// canHarvest(itemType), which is what decides whether the block drops anything.
//
// Returns { item, time, harvests }. A null item means bare hands are the best
// available choice, which is still a real answer — dirt does not want a pickaxe.
function pickDigTool (block, items, opts = {}) {
  const {
    creative = false,
    inWater = false,
    notOnGround = false,
    durabilityReserve = 0
  } = opts

  const candidates = [null, ...items.filter(Boolean)]
  const scored = candidates.map((item) => {
    const type = item ? item.type : null
    return {
      item,
      time: block.digTime(type, creative, inWater, notOnGround, item ? item.enchants : []),
      harvests: Boolean(block.canHarvest(type)),
      fragile: item ? isFragile(item, durabilityReserve) : false
    }
  })

  // Dropping the block beats being quick about it: mining stone with a fist is
  // fast in the sense that nothing comes of it.
  const harvesting = scored.filter((c) => c.harvests)
  const pool = harvesting.length ? harvesting : scored

  // Prefer a tool that will survive the job, but never refuse to work: if every
  // option is worn out, use the worn-out one rather than standing there.
  const sturdy = pool.filter((c) => !c.fragile)
  const usable = sturdy.length ? sturdy : pool

  let best = usable[0]
  for (const c of usable) {
    if (c.time < best.time) best = c
    // Same speed, so keep hands free and save the tool.
    else if (c.time === best.time && best.item && !c.item) best = c
  }
  return { item: best.item, time: best.time, harvests: best.harvests }
}

// Damage per second, which is the number that matters once the bot respects the
// 1.9 attack cooldown and only swings fully charged.
function weaponScore (item) {
  const base = item ? WEAPONS[item.name] : null
  if (!base) return { damage: FIST.damage, speed: FIST.speed, dps: FIST.damage * FIST.speed }
  const sharpness = enchantLevel(item, 'sharpness')
  // Sharpness I adds 1, every level after adds 0.5.
  const damage = base.damage + (sharpness > 0 ? 1 + (sharpness - 1) * 0.5 : 0)
  return { damage, speed: base.speed, dps: damage * base.speed }
}

// Milliseconds between fully charged swings for the held weapon.
function swingInterval (item) {
  const { speed } = weaponScore(item)
  return 1000 / speed
}

function bestWeapon (items, opts = {}) {
  const { durabilityReserve = 0 } = opts
  const weapons = items.filter((i) => i && WEAPONS[i.name])
  if (!weapons.length) return null

  const sturdy = weapons.filter((i) => !isFragile(i, durabilityReserve))
  const pool = sturdy.length ? sturdy : weapons

  let best = null
  let bestDps = weaponScore(null).dps
  for (const item of pool) {
    const { dps } = weaponScore(item)
    if (dps > bestDps) { best = item; bestDps = dps }
  }
  return best
}

function armorScore (item) {
  const spec = ARMOR[item.name]
  if (!spec) return -1
  const protection = enchantLevel(item, 'protection')
  return spec.points * 10 + spec.toughness * 3 + protection
}

// Best piece per armour slot, given what is in the inventory and what is
// already worn. Returns only the slots worth changing.
function bestArmor (items, worn = {}, opts = {}) {
  const { durabilityReserve = 0 } = opts
  const picks = {}
  for (const slot of ARMOR_SLOTS) {
    const wornPiece = worn[slot] || null
    const wornScore = wornPiece && ARMOR[wornPiece.name] ? armorScore(wornPiece) : -1

    let best = null
    let bestScore = wornScore
    for (const item of items) {
      const spec = item && ARMOR[item.name]
      if (!spec || spec.slot !== slot) continue
      if (isFragile(item, durabilityReserve)) continue
      const score = armorScore(item)
      if (score > bestScore) { best = item; bestScore = score }
    }
    if (best) picks[slot] = best
  }
  return picks
}

// What to eat. `foods` maps item name -> { foodPoints, saturation }, straight
// from minecraft-data. `missing` is how much hunger there is room to restore.
function bestFood (items, foods, missing = 20) {
  const edible = items.filter((i) => i && foods[i.name])
  if (!edible.length) return null

  const safe = edible.filter((i) => !RISKY_FOOD.has(i.name))
  const pool = safe.length ? safe : edible

  let best = null
  let bestScore = -Infinity
  for (const item of pool) {
    const food = foods[item.name]
    // Reward saturation, and penalise the hunger points that would spill over
    // the bar and be thrown away.
    const waste = Math.max(0, food.foodPoints - missing)
    const score = food.foodPoints + food.saturation * 0.5 - waste * 2
    if (score > bestScore) { best = item; bestScore = score }
  }
  return best
}

module.exports = {
  WEAPONS,
  ARMOR,
  ARMOR_SLOTS,
  RISKY_FOOD,
  FIST,
  enchantLevel,
  durabilityLeft,
  isFragile,
  pickDigTool,
  weaponScore,
  swingInterval,
  bestWeapon,
  bestArmor,
  bestFood
}
