'use strict'

const { Vec3 } = require('vec3')
const { goals } = require('mineflayer-pathfinder')
const { equipForBlock } = require('./equipment')
const { rankTargets, isDiggingSafe } = require('./targets')
const { race, sleep, isCancelled } = require('./task')
const { logger } = require('./log')

const log = logger('mine')

const FACES = [
  new Vec3(1, 0, 0), new Vec3(-1, 0, 0),
  new Vec3(0, 1, 0), new Vec3(0, -1, 0),
  new Vec3(0, 0, 1), new Vec3(0, 0, -1)
]

// Names of the blocks touching this one, with the block above tagged so the
// safety check can refuse to stand under falling gravel.
function neighbourNames (bot, pos) {
  const names = []
  for (const face of FACES) {
    const b = bot.blockAt(pos.plus(face))
    if (b) names.push(b.name)
  }
  const above = bot.blockAt(pos.offset(0, 1, 0))
  names.above = above ? above.name : null
  return names
}

function safeToDig (bot, block, opts = {}) {
  return isDiggingSafe(block.name, neighbourNames(bot, block.position), opts)
}

function findTargets (bot, ids, opts = {}) {
  const { radius = 48, count = 64 } = opts
  return bot.findBlocks({ matching: ids, maxDistance: radius, count })
}

// Walk over to whatever just popped out of the block. Mineflayer picks items up
// on contact, so getting close is the whole job.
async function collectDrops (bot, token, opts = {}) {
  const { radius = 8, timeout = 4000 } = opts
  const deadline = Date.now() + timeout

  while (Date.now() < deadline) {
    token.check()
    const drop = bot.nearestEntity((e) =>
      (e.name === 'item' || e.name === 'item_stack') &&
      e.position.distanceTo(bot.entity.position) <= radius)
    if (!drop) return

    try {
      await race(bot.pathfinder.goto(new goals.GoalNear(
        drop.position.x, drop.position.y, drop.position.z, 1)), token)
    } catch (err) {
      if (isCancelled(err)) throw err
      return // Cannot reach it — the drop is not worth stalling the job over.
    }
    await sleep(150, token)
  }
}

// Get in range of one block and break it. Returns true only if the block is
// actually gone afterwards.
async function digBlock (bot, block, token, opts = {}) {
  token.check()
  if (!safeToDig(bot, block, opts)) {
    log.debug(`skipping ${block.name} at ${block.position} — lava or falling blocks next to it`)
    return false
  }

  if (!bot.canDigBlock(block)) {
    try {
      await race(bot.pathfinder.goto(
        new goals.GoalLookAtBlock(block.position, bot.world, { reach: 4 })), token)
    } catch (err) {
      if (isCancelled(err)) throw err
      log.debug(`cannot reach ${block.name} at ${block.position}`)
      return false
    }
  }

  token.check()
  // The world moved while we walked: gravel fell, somebody else mined it.
  const fresh = bot.blockAt(block.position)
  if (!fresh || fresh.type !== block.type) return false
  if (!bot.canDigBlock(fresh)) return false

  const choice = await equipForBlock(bot, fresh, opts)
  log.debug(`digging ${fresh.name} with ${choice.item ? choice.item.name : 'bare hands'} (${Math.round(choice.time)}ms)`)

  const stopDigging = token.onCancel(() => { try { bot.stopDigging() } catch { /* nothing was being dug */ } })
  try {
    await race(bot.dig(fresh), token)
  } catch (err) {
    if (isCancelled(err)) throw err
    log.debug(`dig failed on ${fresh.name}:`, err.message)
    return false
  } finally {
    stopDigging()
  }
  return true
}

// Dig a one-wide, two-high corridor straight ahead. This is the fallback when
// there is no ore in sight: a corridor exposes the blocks along both walls,
// which is how strip mining finds anything.
async function tunnelForward (bot, token, opts = {}) {
  const { length = 12 } = opts
  const yaw = bot.entity.yaw
  const step = new Vec3(-Math.sin(yaw), 0, -Math.cos(yaw))
  const dir = new Vec3(Math.round(step.x), 0, Math.round(step.z))
  if (dir.x === 0 && dir.z === 0) return 0

  let dug = 0
  for (let i = 1; i <= length; i++) {
    token.check()
    const base = bot.entity.position.floored().plus(dir.scaled(i))
    for (const dy of [0, 1]) {
      const block = bot.blockAt(base.offset(0, dy, 0))
      if (!block || block.boundingBox === 'empty') continue
      if (!safeToDig(bot, block, opts)) {
        log.info('stopping the tunnel — something dangerous ahead')
        return dug
      }
      if (await digBlock(bot, block, token, opts)) dug++
    }
    try {
      await race(bot.pathfinder.goto(new goals.GoalBlock(base.x, base.y, base.z)), token)
    } catch (err) {
      if (isCancelled(err)) throw err
      return dug
    }
  }
  return dug
}

// Mine `count` blocks of the given types, searching outward, walking to each
// one and picking up what drops. `onProgress` reports each block as it falls.
async function mine (bot, token, opts = {}) {
  const {
    ids,
    count = 1,
    radius = 48,
    explore = true,
    exploreAttempts = 4,
    onProgress = () => {}
  } = opts

  let mined = 0
  let barren = 0
  const failed = new Set()

  while (mined < count) {
    token.check()

    const positions = findTargets(bot, ids, { radius })
      .filter((p) => !failed.has(p.toString()))

    if (!positions.length) {
      if (!explore || barren >= exploreAttempts) {
        log.info(`no more of that around here — stopping at ${mined}/${count}`)
        return { mined, exhausted: true }
      }
      barren++
      log.info(`nothing in range, digging on to look (${barren}/${exploreAttempts})`)
      await tunnelForward(bot, token, { ...opts, length: 12 })
      continue
    }

    barren = 0
    let progressed = false
    for (const pos of rankTargets(positions, bot.entity.position)) {
      token.check()
      const block = bot.blockAt(pos)
      if (!block || !ids.includes(block.type)) continue

      if (await digBlock(bot, block, token, opts)) {
        mined++
        progressed = true
        onProgress(block, mined, count)
        await collectDrops(bot, token, opts)
        break // The world changed; search again from where we now stand.
      }
      failed.add(pos.toString())
    }

    // Everything in range was unreachable or unsafe. Move and look again
    // rather than spinning on the same rejected list.
    if (!progressed) {
      if (!explore || barren >= exploreAttempts) return { mined, exhausted: true }
      barren++
      await tunnelForward(bot, token, { ...opts, length: 8 })
    }
  }

  return { mined, exhausted: false }
}

module.exports = { neighbourNames, safeToDig, findTargets, collectDrops, digBlock, tunnelForward, mine }
