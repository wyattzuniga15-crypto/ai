'use strict'

const { goals } = require('mineflayer-pathfinder')
const threat = require('./threat')
const { equipWeapon, equipShield } = require('./equipment')
const { swingInterval } = require('./gear')
const { sleep, isCancelled } = require('./task')
const { collectDrops } = require('./mining')
const { logger } = require('./log')

const log = logger('fight')

function isAlive (bot, entity) {
  return Boolean(entity) && entity.isValid !== false && Boolean(bot.entities[entity.id])
}

// Watch for the death animation the server sends the moment a mob's health hits
// zero. The entity itself is removed by a separate packet that can lag behind —
// or, on some servers, never arrive — and swinging at a corpse until a timeout
// expires is a good way to be standing still when the next mob turns up.
function watchForDeath (bot, target) {
  const state = { dead: false }
  state.off = () => {
    bot.removeListener('entityDead', onDead)
    bot.removeListener('entityGone', onGone)
  }
  function onDead (entity) { if (entity.id === target.id) state.dead = true }
  function onGone (entity) { if (entity.id === target.id) state.dead = true }
  bot.on('entityDead', onDead)
  bot.on('entityGone', onGone)
  return state
}

// Aim for the upper body rather than the feet, which is what actually lands a
// hit on anything taller than a chicken.
function aimPoint (entity) {
  const height = entity.height || 1.8
  return entity.position.offset(0, height * 0.75, 0)
}

const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi))

// Distance from the bot's eyes to the closest point of the mob's hitbox. This
// is what decides whether a swing lands, and it is not the same as the distance
// between the two entity positions — a mob's position is its feet, and a tall
// mob standing a step above the bot reads as far away by that measure while
// being well inside reach. Getting this wrong leaves the bot circling a zombie
// it is perfectly able to hit.
function reach (bot, entity) {
  const eye = bot.entity.position.offset(0, bot.entity.eyeHeight ?? 1.62, 0)
  const halfWidth = (entity.width ?? 0.6) / 2
  const height = entity.height ?? 1.8
  const p = entity.position
  const dx = eye.x - clamp(eye.x, p.x - halfWidth, p.x + halfWidth)
  const dy = eye.y - clamp(eye.y, p.y, p.y + height)
  const dz = eye.z - clamp(eye.z, p.z - halfWidth, p.z + halfWidth)
  return Math.sqrt(dx * dx + dy * dy + dz * dz)
}

// Fight one mob until it is dead, gone, or clearly not worth chasing.
// Returns 'killed' | 'lost' | 'gaveup'.
async function engage (bot, target, token, opts = {}) {
  const {
    tick = 100,
    maxChase = 32,
    timeout = 45000,
    criticals = true
  } = opts

  const { attack: attackRange, tooClose } = threat.preferredRange(target)
  const started = Date.now()
  const death = watchForDeath(bot, target)

  let lastSwing = 0
  let lastReport = 0
  let swings = 0
  let mode = null // 'toward' | 'away'

  await equipWeapon(bot, opts)
  await equipShield(bot).catch(() => {})

  const clearGoal = () => { try { bot.pathfinder.setGoal(null) } catch { /* already idle */ } }
  const releaseGoal = token.onCancel(clearGoal)

  try {
    while (true) {
      token.check()

      if (death.dead || !isAlive(bot, target)) {
        log.info(`${target.name} down after ${swings} swing${swings === 1 ? '' : 's'}`)
        clearGoal()
        await collectDrops(bot, token, { radius: 6, timeout: 2500 }).catch(() => {})
        return 'killed'
      }

      const range = reach(bot, target)
      const dist = bot.entity.position.distanceTo(target.position)

      if (Date.now() - lastReport > 3000) {
        lastReport = Date.now()
        log.debug(`${target.name} ${range.toFixed(2)}m from my reach, moving ${mode ?? 'nowhere'}, ` +
          `holding ${bot.heldItem?.name ?? 'nothing'}, ${swings} swings`)
      }

      if (dist > maxChase) {
        log.info(`${target.name} got away`)
        clearGoal()
        return 'lost'
      }
      if (Date.now() - started > timeout) {
        log.warn(`giving up on ${target.name} after ${Math.round(timeout / 1000)}s and ${swings} swings`)
        clearGoal()
        return 'gaveup'
      }

      // Movement is one standing goal for the whole fight rather than a goal
      // set and cleared around every swing: the pathfinder already stops once
      // it is close enough, and thrashing the goal just makes the bot shuffle
      // in and out of its own reach.
      const wantsSpace = Boolean(tooClose) && range < tooClose
      const next = wantsSpace ? 'away' : 'toward'
      if (mode !== next) {
        bot.pathfinder.setGoal(next === 'away'
          ? new goals.GoalInvert(new goals.GoalFollow(target, 4))
          : new goals.GoalFollow(target, 1), true)
        mode = next
      }

      // Swing only when the mob is genuinely within reach and the cooldown has
      // run out. A swing that is early does a fraction of the damage, and one
      // thrown from out of range does none at all.
      if (!wantsSpace && range <= attackRange && Date.now() - lastSwing >= swingInterval(bot.heldItem)) {
        await bot.lookAt(aimPoint(target), true)
        // Landing a hit on the way down is a critical, for half again the damage.
        if (criticals && bot.entity.onGround) {
          bot.setControlState('jump', true)
          bot.setControlState('jump', false)
          await sleep(180, token)
          if (death.dead || !isAlive(bot, target)) continue
        }
        bot.attack(target)
        swings++
        lastSwing = Date.now()
      }

      await sleep(tick, token)
    }
  } finally {
    death.off()
    releaseGoal()
    clearGoal()
  }
}

// Keep fighting whatever is worth fighting until the area is clear.
async function defend (bot, token, ctx, opts = {}) {
  const { onGiveUp = () => {} } = opts
  const ignored = new Set()
  let killed = 0

  while (true) {
    token.check()
    // Skip anything already given up on, or the same unreachable ghast gets
    // picked again on every pass.
    const remaining = threat.findThreats(bot.entities, { ...ctx, origin: bot.entity.position })
      .filter((t) => !ignored.has(t.entity.id))
    if (!remaining.length) return { killed }
    const target = remaining[0].entity

    log.info(`engaging ${target.name} at ${Math.round(bot.entity.position.distanceTo(target.position))}m`)
    let result
    try {
      result = await engage(bot, target, token, opts)
    } catch (err) {
      if (isCancelled(err)) throw err
      log.warn(`fight with ${target.name} broke off:`, err.message)
      result = 'gaveup'
    }
    if (result === 'killed') {
      killed++
    } else {
      ignored.add(target.id)
      // Tell the brain too, or the next defend() starts with a clean slate and
      // walks straight back to the mob it just spent 45 seconds failing to hit.
      onGiveUp(target, result)
    }
  }
}

module.exports = { isAlive, aimPoint, reach, watchForDeath, engage, defend }
