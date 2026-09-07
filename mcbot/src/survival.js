'use strict'

const { goals } = require('mineflayer-pathfinder')
const gear = require('./gear')
const { equipToHand } = require('./equipment')
const { race, sleep } = require('./task')
const { logger } = require('./log')

const log = logger('life')

function shouldEat (bot, opts = {}) {
  const { eatBelow = 16 } = opts
  return bot.food < eatBelow
}

function shouldFlee (bot, opts = {}) {
  const { fleeBelow = 6 } = opts
  return bot.health <= fleeBelow
}

// Eat the most sensible thing in the pack, then put the old item back in hand
// so combat or mining picks up where it left off.
async function eat (bot, token, opts = {}) {
  const foods = opts.foods || {}
  const missing = 20 - bot.food
  const food = gear.bestFood(bot.inventory.items(), foods, missing)
  if (!food) return null

  const previous = bot.heldItem
  await equipToHand(bot, food)
  try {
    await race(bot.consume(), token)
    log.info(`ate ${food.name} (food ${bot.food}/20)`)
  } catch (err) {
    if (err?.name === 'Cancelled') throw err
    log.warn(`could not eat ${food.name}:`, err.message)
    return null
  } finally {
    if (previous && previous.type !== food.type) {
      await equipToHand(bot, bot.inventory.items().find((i) => i.type === previous.type) || null)
        .catch(() => {})
    }
  }
  return food
}

// Head away from the mob average, on the level rather than into a wall. The
// goal is XZ only so the pathfinder is free to find whatever route exists.
async function flee (bot, threats, token, opts = {}) {
  const { distance = 24 } = opts
  const me = bot.entity.position
  if (!threats.length) return false

  let dx = 0
  let dz = 0
  for (const t of threats) {
    const pos = t.entity ? t.entity.position : t.position
    dx += me.x - pos.x
    dz += me.z - pos.z
  }
  const length = Math.sqrt(dx * dx + dz * dz)
  // Cornered, with mobs on every side: pick any direction rather than freeze.
  if (length < 0.001) {
    const angle = Math.random() * Math.PI * 2
    dx = Math.cos(angle)
    dz = Math.sin(angle)
  } else {
    dx /= length
    dz /= length
  }

  const goal = new goals.GoalXZ(
    Math.floor(me.x + dx * distance),
    Math.floor(me.z + dz * distance)
  )
  log.info(`falling back from ${threats.length} mob(s)`)
  try {
    await race(bot.pathfinder.goto(goal), token)
    return true
  } catch (err) {
    if (err?.name === 'Cancelled') throw err
    // No route out. Sprint away by hand so the bot is at least moving.
    bot.setControlState('sprint', true)
    bot.setControlState('forward', true)
    try {
      await bot.lookAt(me.offset(dx * 10, 0, dz * 10))
      await sleep(1000, token)
    } finally {
      bot.setControlState('forward', false)
      bot.setControlState('sprint', false)
    }
    return false
  }
}

module.exports = { shouldEat, shouldFlee, eat, flee }
