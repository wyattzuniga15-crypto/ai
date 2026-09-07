#!/usr/bin/env node
'use strict'

const mineflayer = require('mineflayer')
const { pathfinder, Movements } = require('mineflayer-pathfinder')
const minecraftData = require('minecraft-data')

const { load } = require('./src/config')
const { Brain } = require('./src/brain')
const { createDispatcher } = require('./src/orders')
const equipment = require('./src/equipment')
const { setLevel, logger } = require('./src/log')

const log = logger('bot')

// Pathfinding rules. The bot may dig its way through, but it should not tower
// into the sky or walk into lava to save three blocks of travel.
function buildMovements (bot, mcData, config) {
  const movements = new Movements(bot, mcData)
  movements.canDig = true
  movements.allow1by1towers = false
  movements.allowParkour = true
  movements.allowSprinting = true
  movements.dontMineUnderFallingBlock = true
  movements.dontCreateFlow = true
  movements.maxDropDown = 4
  movements.digCost = 2

  for (const name of ['lava', 'fire', 'soul_fire', 'magma_block', 'campfire', 'sweet_berry_bush', 'powder_snow']) {
    const block = mcData.blocksByName[name]
    if (block) movements.blocksToAvoid.add(block.id)
  }
  // Breaking somebody's chest to shorten a walk is never the right call.
  for (const name of ['chest', 'trapped_chest', 'ender_chest', 'barrel', 'furnace', 'crafting_table', 'bed']) {
    const block = mcData.blocksByName[name]
    if (block) movements.blocksCantBreak.add(block.id)
  }
  if (config.allowUnderFalling) movements.dontMineUnderFallingBlock = false
  return movements
}

function createBot (config) {
  const options = {
    host: config.host,
    port: config.port,
    username: config.username,
    auth: config.auth,
    hideErrors: false
  }
  if (config.version) options.version = config.version
  if (config.password) options.password = config.password

  const bot = mineflayer.createBot(options)
  bot.loadPlugin(pathfinder)

  bot.once('spawn', () => {
    const mcData = minecraftData(bot.version)
    bot.pathfinder.setMovements(buildMovements(bot, mcData, config))

    const brain = new Brain(bot, { ...config, foods: mcData.foodsByName })
    const { handle, say } = createDispatcher({ bot, brain, mcData, config })
    bot.brain = brain

    log.info(`joined ${config.host}:${config.port} as ${bot.username} (Minecraft ${bot.version})`)
    log.info(`stance ${brain.stance}; taking orders from ${config.owners.length ? config.owners.join(', ') : 'anyone'} with prefix "${config.prefix}"`)

    // Turn up wearing the best of what is in the pack, so the first fight is
    // not fought in a leather cap.
    equipment.equipArmor(bot, config)
      .then(() => equipment.equipWeapon(bot, config))
      .then(() => equipment.equipShield(bot))
      .catch((err) => log.warn('could not kit up:', err.message))

    brain.start()
    say(`${bot.username} reporting in. Say "${config.prefix}help" for what I can do.`)

    const onMessage = (username, message) => {
      Promise.resolve(handle(username, message)).catch((err) => {
        log.error('command failed:', err)
        say(`that went wrong: ${err.message}`)
      })
    }
    bot.on('chat', onMessage)
    bot.on('whisper', onMessage)

    // Remember who is hitting us: it is the only thing that makes a neutral
    // mob a target, and it breaks ties between equally close hostiles.
    bot.on('entityHurt', (entity, source) => {
      if (entity.id !== bot.entity.id) return
      if (source && source.id !== bot.entity.id) brain.remember(source.id)
    })

    bot.on('death', () => {
      log.warn('died')
      brain.clearOrder('died')
      say('I died. Orders cleared.')
    })

    bot.on('respawn', () => {
      equipment.equipArmor(bot, config).catch(() => {})
    })

    bot.on('health', () => {
      log.debug(`health ${bot.health} food ${bot.food}`)
    })
  })

  bot.on('kicked', (reason) => log.warn('kicked:', reason))
  bot.on('error', (err) => log.error(err.message))

  return bot
}

function main () {
  let config
  try {
    config = load()
  } catch (err) {
    process.stderr.write(`${err.message}\n\nUsage: node index.js --host <server> [--port 25565] [--username Name]\n` +
      '                    [--auth offline|microsoft] [--owners Steve,Alex] [--stance guard|passive]\n')
    process.exit(1)
  }
  setLevel(config.logLevel)

  let stopping = false
  let bot = null

  const connect = () => {
    log.info(`connecting to ${config.host}:${config.port} …`)
    bot = createBot(config)
    bot.on('end', (reason) => {
      if (stopping) return
      if (!config.autoReconnect) {
        log.info(`disconnected (${reason}); not reconnecting`)
        process.exit(0)
      }
      log.warn(`disconnected (${reason}); reconnecting in ${config.reconnectDelay / 1000}s`)
      setTimeout(connect, config.reconnectDelay)
    })
  }

  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      stopping = true
      log.info('shutting down')
      try { bot?.brain?.stop() } catch { /* never started */ }
      try { bot?.quit('shutting down') } catch { /* already gone */ }
      process.exit(0)
    })
  }

  connect()
}

if (require.main === module) main()

module.exports = { createBot, buildMovements }
