'use strict'

const { goals } = require('mineflayer-pathfinder')
const { parseCommand, stripAddress, HELP } = require('./commands')
const { resolveBlockNames } = require('./targets')
const mining = require('./mining')
const combat = require('./combat')
const survival = require('./survival')
const equipment = require('./equipment')
const threat = require('./threat')
const { sleep, race } = require('./task')
const { logger } = require('./log')

const log = logger('order')

// Chat has a rate limit and servers kick for tripping it, so messages go out
// through a queue rather than all at once.
function makeSay (bot, { interval = 1200 } = {}) {
  const queue = []
  let running = false

  async function pump () {
    running = true
    while (queue.length) {
      const line = queue.shift()
      try { bot.chat(line) } catch (err) { log.warn('chat failed:', err.message) }
      if (queue.length) await new Promise((resolve) => setTimeout(resolve, interval))
    }
    running = false
  }

  return (text) => {
    for (const line of String(text).split('\n')) {
      if (line.trim()) queue.push(line.slice(0, 250))
    }
    if (!running) pump()
  }
}

function summariseInventory (bot) {
  const counts = new Map()
  for (const item of bot.inventory.items()) {
    counts.set(item.name, (counts.get(item.name) || 0) + item.count)
  }
  if (!counts.size) return 'empty-handed'
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([name, n]) => `${n}x ${name}`)
    .join(', ')
}

function playerEntity (bot, name) {
  const player = bot.players[name]
  return player?.entity || null
}

// Follow somebody until told otherwise. Resolves only if they leave.
function followOrder (bot, username, say, opts = {}) {
  const { range = 2 } = opts
  return {
    label: `follow ${username}`,
    run: async (token) => {
      let missingSince = null
      while (true) {
        token.check()
        const target = playerEntity(bot, username)
        if (!target) {
          missingSince = missingSince ?? Date.now()
          // Out of render distance is normal; gone for good is not.
          if (Date.now() - missingSince > 20000) {
            say(`lost track of ${username}`)
            return 'lost'
          }
        } else {
          missingSince = null
          const goal = bot.pathfinder.goal
          if (!(goal instanceof goals.GoalFollow) || goal.entity?.id !== target.id) {
            bot.pathfinder.setGoal(new goals.GoalFollow(target, range), true)
          }
        }
        await sleep(500, token)
      }
    }
  }
}

function gotoOrder (bot, { x, y, z }, say) {
  const label = y === undefined ? `go to ${x}, ${z}` : `go to ${x}, ${y}, ${z}`
  return {
    label,
    run: async (token) => {
      const goal = y === undefined
        ? new goals.GoalXZ(x, z)
        : new goals.GoalNear(x, y, z, 1)
      await race(bot.pathfinder.goto(goal), token)
      return 'arrived'
    },
    onDone: () => say(`got there — ${label.replace('go to ', '')}`),
    onFail: (err) => say(`could not get there: ${err.message}`)
  }
}

function mineOrder (bot, { names, ids, count, label }, say, opts) {
  return {
    label: `mine ${count}x ${label}`,
    run: async (token) => mining.mine(bot, token, {
      ...opts,
      ids,
      count,
      radius: opts.searchRadius,
      onProgress: (block, done, total) => {
        if (done === total || done % 8 === 0) say(`${done}/${total} ${block.name}`)
      }
    }),
    onDone: (result) => {
      if (result.exhausted) say(`ran out of ${label} to mine — got ${result.mined}`)
      else say(`done: ${result.mined}x ${label}`)
    },
    onFail: (err) => say(`mining stopped: ${err.message}`)
  }
}

function huntOrder (bot, what, say, opts) {
  return {
    label: `hunt ${what}`,
    run: async (token) => {
      let killed = 0
      while (true) {
        token.check()
        const target = bot.nearestEntity((e) =>
          e.name === what &&
          e.isValid !== false &&
          e.position.distanceTo(bot.entity.position) <= (opts.huntRadius ?? 48))
        if (!target) return { killed }
        const result = await combat.engage(bot, target, token, opts)
        if (result === 'killed') killed++
        else return { killed, gaveUp: true }
      }
    },
    onDone: (result) => say(result.killed ? `killed ${result.killed} ${what}` : `no ${what} around`),
    onFail: (err) => say(`hunt stopped: ${err.message}`)
  }
}

// Turn one chat line into an action. Returns a short string describing what it
// did, or null if the message was not a command.
function createDispatcher ({ bot, brain, mcData, config }) {
  const say = makeSay(bot)
  const blockNames = new Set(Object.keys(mcData.blocksByName))

  async function handle (username, message) {
    if (username === bot.username) return null
    if (config.owners.length && !config.owners.includes(username)) return null

    const body = stripAddress(message, { prefix: config.prefix, names: [bot.username] })
    if (body === null) return null

    const parsed = parseCommand(body)
    if (parsed.error) {
      say(parsed.error)
      return parsed.error
    }

    const { name, args } = parsed
    log.info(`${username}: ${name} ${JSON.stringify(args)}`)

    switch (name) {
      case 'mine': {
        const names = resolveBlockNames(args.block, blockNames)
        if (!names.length) {
          say(`I do not know what "${args.block}" is`)
          return 'unknown block'
        }
        const ids = names.map((n) => mcData.blocksByName[n].id)
        say(`mining ${args.count}x ${args.block}`)
        brain.setOrder(mineOrder(bot, { names, ids, count: args.count, label: args.block }, say, config))
        return 'mining'
      }

      case 'come':
      case 'goto': {
        if (name === 'come' || args.x === undefined) {
          const who = args.who || username
          const target = playerEntity(bot, who)
          if (!target) {
            say(`I cannot see ${who}`)
            return 'no such player'
          }
          const p = target.position
          say(`on my way to ${who}`)
          brain.setOrder(gotoOrder(bot, { x: Math.floor(p.x), y: Math.floor(p.y), z: Math.floor(p.z) }, say))
          return 'walking'
        }
        say(`heading to ${args.x}, ${args.y ?? '~'}, ${args.z}`)
        brain.setOrder(gotoOrder(bot, args, say))
        return 'walking'
      }

      case 'follow': {
        const who = args.who || username
        if (!bot.players[who]) {
          say(`I cannot see ${who}`)
          return 'no such player'
        }
        say(`following ${who}`)
        brain.setOrder(followOrder(bot, who, say, config))
        return 'following'
      }

      case 'fight': {
        brain.stance = 'guard'
        if (args.what) {
          say(`hunting ${args.what}`)
          brain.setOrder(huntOrder(bot, args.what, say, config))
          return 'hunting'
        }
        const near = threat.findThreats(bot.entities, brain.context())
        say(near.length ? `on it — ${near.length} nearby` : 'nothing hostile in sight; I will guard')
        return 'fighting'
      }

      case 'guard':
        brain.stance = 'guard'
        say('guarding — I will fight anything hostile that comes close')
        return 'guarding'

      case 'passive':
        brain.stance = 'passive'
        brain.cancelActivity('going passive')
        say('standing down — I will not start fights')
        return 'passive'

      case 'gear': {
        const armor = await equipment.equipArmor(bot, config)
        const weapon = await equipment.equipWeapon(bot, config)
        const shield = await equipment.equipShield(bot)
        const bits = []
        if (armor.length) bits.push(`wearing ${armor.join(', ')}`)
        if (weapon) bits.push(`holding ${weapon.name}`)
        if (shield) bits.push('shield up')
        say(bits.length ? bits.join('; ') : 'nothing worth equipping')
        return 'geared'
      }

      case 'status':
        say(brain.describe())
        return 'status'

      case 'inventory':
        say(summariseInventory(bot))
        return 'inventory'

      case 'eat': {
        const food = await survival.eat(bot, brain.activity?.token || { check () {}, onCancel: () => () => {} }, config)
        say(food ? `ate ${food.name}` : 'nothing to eat')
        return 'ate'
      }

      case 'drop': {
        const item = bot.inventory.items().find((i) => i.name === args.item)
        if (!item) {
          say(`I have no ${args.item}`)
          return 'no such item'
        }
        const asker = playerEntity(bot, username)
        if (asker) await bot.lookAt(asker.position.offset(0, 1.6, 0)).catch(() => {})
        await bot.toss(item.type, null, args.count ?? item.count)
        say(`dropped ${args.count ?? item.count}x ${args.item}`)
        return 'dropped'
      }

      case 'stop': {
        const had = brain.clearOrder(`${username} said stop`)
        say(had ? 'stopping' : 'I was not doing anything')
        return 'stopped'
      }

      case 'quit':
        say('logging off')
        setTimeout(() => bot.quit('asked to leave'), 500)
        return 'quitting'

      case 'help':
        say(HELP.join('\n'))
        return 'help'

      default:
        return null
    }
  }

  return { handle, say }
}

module.exports = {
  createDispatcher,
  makeSay,
  summariseInventory,
  followOrder,
  gotoOrder,
  mineOrder,
  huntOrder
}
