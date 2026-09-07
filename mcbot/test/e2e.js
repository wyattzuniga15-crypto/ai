#!/usr/bin/env node
'use strict'

// End-to-end test against a real Minecraft server.
//
// Boots flying-squid (a Minecraft server in JavaScript) on a loopback port,
// joins it with the actual bot from index.js and a second plain client that
// plays the part of the owner, then drives the bot through chat exactly the way
// a person would. Nothing here is mocked: real protocol, real world, real
// block breaking, real swings at a real mob.
//
//   node test/e2e.js            # run everything
//   node test/e2e.js mining     # run scenarios matching "mining"
//   VERBOSE=1 node test/e2e.js  # show the bot's own logs

const path = require('path')
const fs = require('fs')
const os = require('os')
const { randomUUID } = require('crypto')

const squid = require('flying-squid')
const mineflayer = require('mineflayer')
const { Vec3 } = require('vec3')

const { createBot } = require('../index')
const { setLevel } = require('../src/log')

const PORT = Number(process.env.E2E_PORT || 25599)
const VERSION = process.env.E2E_VERSION || '1.20.4'
const VERBOSE = Boolean(process.env.VERBOSE)

setLevel(VERBOSE ? 'debug' : 'error')

// ---------------------------------------------------------------- utilities

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function waitFor (label, predicate, { timeout = 30000, interval = 200 } = {}) {
  const deadline = Date.now() + timeout
  let last
  while (Date.now() < deadline) {
    try {
      last = await predicate()
      if (last) return last
    } catch (err) {
      last = err.message
    }
    await sleep(interval)
  }
  throw new Error(`timed out after ${timeout}ms waiting for ${label}` +
    (last ? ` (last: ${JSON.stringify(last)})` : ''))
}

function assert (condition, message) {
  if (!condition) throw new Error(message)
}

// ------------------------------------------------------------------ harness

class World {
  constructor () {
    this.server = null
    this.owner = null
    this.bot = null
    this.chat = [] // everything the bot said
    this.attacks = [] // every attack packet the bot sent
    this.worldFolder = fs.mkdtempSync(path.join(os.tmpdir(), 'mcbot-e2e-'))
  }

  async startServer () {
    this.server = squid.createMCServer({
      motd: 'mcbot e2e',
      port: PORT,
      'online-mode': false,
      logging: VERBOSE,
      gameMode: 0, // survival, so tools and dig times actually matter
      difficulty: 1,
      'view-distance': 4,
      'everybody-op': true,
      worldFolder: this.worldFolder,
      generation: { name: 'superflat', options: { worldHeight: 4 } },
      kickTimeout: 60000,
      plugins: {},
      modpe: false,
      'max-entities': 100,
      'player-list-text': { header: { text: '' }, footer: { text: '' } },
      version: VERSION
    })
    await waitFor('server to listen', () => this.server.listening !== false && this.server._server?.socketServer)
    await sleep(500)
  }

  async joinOwner () {
    this.owner = mineflayer.createBot({
      host: '127.0.0.1', port: PORT, username: 'Owner', auth: 'offline', version: VERSION
    })
    await once(this.owner, 'spawn', 20000)
    await this.owner.waitForChunksToLoad()
  }

  async joinBot (overrides = {}) {
    this.bot = createBot({
      host: '127.0.0.1',
      port: PORT,
      username: 'Claudius',
      auth: 'offline',
      version: VERSION,
      owners: ['Owner'],
      prefix: '!',
      autoReconnect: false,
      stance: 'guard',
      engageRadius: 24,
      eatBelow: 16,
      fleeBelow: 6,
      tickMs: 200,
      searchRadius: 48,
      durabilityReserve: 3,
      criticals: false, // keeps swing timing predictable for the test
      allowUnderFalling: false,
      explore: false, // no tunnelling off into a test world
      logLevel: VERBOSE ? 'debug' : 'error',
      ...overrides
    })

    // Count the swings the bot actually sends down the wire.
    const write = this.bot._client.write.bind(this.bot._client)
    this.bot._client.write = (name, params) => {
      if (name === 'use_entity' && (params?.mouse === 1 || params?.action === 1)) {
        this.attacks.push({ at: Date.now(), target: params.target })
      }
      return write(name, params)
    }

    await once(this.bot, 'spawn', 20000)
    await this.bot.waitForChunksToLoad()
    await waitFor('the bot to wake up', () => this.bot.brain)

    // Record what the bot says, as seen by the owner.
    this.owner.on('chat', (username, message) => {
      if (username === this.bot.username) {
        this.chat.push(message)
        if (VERBOSE) process.stdout.write(`  <${username}> ${message}\n`)
      }
    })
    await sleep(500)
  }

  // Issue an order the way a player would: by typing it in chat.
  order (text) {
    this.chat.length = 0
    this.owner.chat(text)
  }

  said (fragment) {
    return this.chat.some((line) => line.toLowerCase().includes(fragment.toLowerCase()))
  }

  waitForSaying (fragment, timeout = 30000) {
    return waitFor(`the bot to say "${fragment}"`, () => this.said(fragment), { timeout })
  }

  run (command) {
    this.owner.chat(command)
  }

  give (item, count = 1) {
    this.run(`/give ${this.bot.username} ${item} ${count}`)
  }

  setBlock (pos, name) {
    this.run(`/setblock ${pos.x} ${pos.y} ${pos.z} ${name}`)
  }

  // Spawn a mob straight through the server API. flying-squid's own /summon
  // only recognises entities whose registry type is literally "mob", which
  // stopped being true for hostiles somewhere around 1.17 — so this does what
  // its spawnMob does, without the lookup that breaks on modern versions.
  summon (name, position) {
    const def = this.server.registry.entitiesByName[name]
    if (!def) throw new Error(`no entity called ${name} in ${VERSION}`)
    const mob = this.server.initEntity('mob', def.id, this.server.overworld, position)
    mob.uuid = randomUUID()
    mob.name = name
    mob.velocity = new Vec3(0, 0, 0)
    mob.pitch = 0
    mob.headPitch = 0
    mob.yaw = 0
    mob.gravity = new Vec3(0, -20, 0)
    mob.terminalvelocity = new Vec3(27, 27, 27)
    mob.friction = new Vec3(15, 0, 15)
    mob.size = new Vec3(0.75, 1.75, 0.75)
    mob.health = 20
    mob.metadata = []
    mob.updateAndSpawn()
    return mob
  }

  despawn (mob) {
    try { this.server.destroyEntity(mob) } catch { /* already dead */ }
  }

  async stop () {
    try { this.bot?.brain?.stop() } catch { /* never started */ }
    for (const client of [this.bot, this.owner]) {
      try { client?.quit('test over') } catch { /* already gone */ }
    }
    await sleep(300)
    try { this.server?.quit() } catch { /* already down */ }
    await sleep(300)
    try { fs.rmSync(this.worldFolder, { recursive: true, force: true }) } catch { /* best effort */ }
  }
}

function once (emitter, event, timeout) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`timed out waiting for "${event}"`)), timeout)
    emitter.once(event, (...args) => { clearTimeout(timer); resolve(args) })
    emitter.once('error', (err) => { clearTimeout(timer); reject(err) })
  })
}

// ---------------------------------------------------------------- scenarios

const scenarios = []
const scenario = (name, fn) => scenarios.push({ name, fn })

scenario('the bot joins as a real player with a player model', async (w) => {
  // "It is a player model" is not a rendering trick: the bot opens an ordinary
  // client connection, so the server holds a real player entity for it and
  // every other client draws the usual skin and name tag. The server's own view
  // is the ground truth for that, and it is what we check here — flying-squid
  // spawns peer players to each other with a broken entity type on 1.20, so the
  // second client's copy would be testing the test server, not the bot.
  const seen = await waitFor('the owner to see the bot in the player list',
    () => w.owner.players[w.bot.username])
  assert(seen.username === 'Claudius', `player list shows "${seen.username}"`)

  const serverSide = w.server.players.find((p) => p.username === w.bot.username)
  assert(serverSide, 'the server has no player by that name')
  assert(serverSide.type === 'player', `the server holds it as "${serverSide.type}"`)
  assert(serverSide.gameMode === 0, `it joined in game mode ${serverSide.gameMode}, not survival`)

  // And it is a whole player from its own side too: a player entity, a player
  // inventory, health and hunger — not a spectator or a disembodied listener.
  assert(w.bot.entity.type === 'player', `the bot's own entity is "${w.bot.entity.type}"`)
  assert(w.bot.inventory.slots.length >= 36, `inventory has ${w.bot.inventory.slots.length} slots`)
  assert(w.bot.health > 0 && w.bot.food > 0, `health ${w.bot.health}, food ${w.bot.food}`)
})

scenario('it kits itself out on command', async (w) => {
  w.give('iron_helmet')
  w.give('diamond_chestplate')
  w.give('iron_leggings')
  w.give('leather_boots')
  w.give('wooden_sword')
  w.give('iron_sword')
  w.give('shield')
  await waitFor('the gear to arrive', () =>
    w.bot.inventory.items().filter((i) => i.name.endsWith('_sword')).length >= 2)

  w.order('!gear')
  await w.waitForSaying('holding')

  const worn = require('../src/equipment').wornArmor(w.bot)
  assert(worn.head?.name === 'iron_helmet', `head: ${worn.head?.name}`)
  assert(worn.torso?.name === 'diamond_chestplate', `torso: ${worn.torso?.name}`)
  assert(worn.legs?.name === 'iron_leggings', `legs: ${worn.legs?.name}`)
  assert(worn.feet?.name === 'leather_boots', `feet: ${worn.feet?.name}`)
  // It should pick the iron sword over the wooden one it was also handed.
  assert(w.bot.heldItem?.name === 'iron_sword', `holding ${w.bot.heldItem?.name}, expected iron_sword`)
})

scenario('it mines what it is told to, with the right tool', async (w) => {
  w.give('stone_pickaxe')
  w.give('iron_shovel')
  await waitFor('the tools to arrive', () =>
    w.bot.inventory.items().some((i) => i.name === 'stone_pickaxe'))

  // Lay out three iron ore blocks in the ground within easy reach.
  const base = w.bot.entity.position.floored()
  const spots = [
    new Vec3(base.x + 3, 4, base.z),
    new Vec3(base.x - 3, 4, base.z),
    new Vec3(base.x, 4, base.z + 3)
  ]
  for (const spot of spots) w.setBlock(spot, 'iron_ore')
  await waitFor('the ore to appear', () =>
    spots.every((s) => w.bot.blockAt(s)?.name === 'iron_ore'), { timeout: 15000 })

  // Watch what it holds while digging: the pickaxe, never the shovel.
  const held = new Set()
  const watch = setInterval(() => {
    if (w.bot.targetDigBlock && w.bot.heldItem) held.add(w.bot.heldItem.name)
  }, 50)

  w.order('!mine iron 3')
  try {
    await w.waitForSaying('done: 3x iron', 120000)
  } finally {
    clearInterval(watch)
  }

  assert(spots.every((s) => w.bot.blockAt(s)?.name !== 'iron_ore'),
    'some ore is still standing after the bot reported it was done')
  assert(held.has('stone_pickaxe'), `dug holding ${[...held].join(', ') || 'nothing'}, expected the pickaxe`)
  assert(!held.has('iron_shovel'), 'it dug ore with a shovel')
})

scenario('it refuses an order it cannot make sense of', async (w) => {
  w.order('!mine flurbium 2')
  await w.waitForSaying('do not know what')
  assert(w.bot.brain.order === null, 'a nonsense order became a standing order')
})

scenario('it walks to where it is told', async (w) => {
  const from = w.bot.entity.position.clone()
  const target = from.offset(8, 0, 8).floored()
  w.order(`!goto ${target.x} 5 ${target.z}`)
  await waitFor('the bot to arrive', () =>
    w.bot.entity.position.xzDistanceTo(target) < 3, { timeout: 60000 })
})

scenario('it fights a hostile mob and kills it', async (w) => {
  w.order('!guard')
  await sleep(500)
  const before = w.attacks.length

  // Drop a zombie a few blocks away and check the bot notices on its own.
  const mob = w.summon('zombie', w.bot.entity.position.offset(4, 0, 0))
  const zombie = await waitFor('a zombie to show up', () =>
    Object.values(w.bot.entities).find((e) => e.name === 'zombie' && e.isValid !== false),
  { timeout: 20000 })
  const zombieId = zombie.id

  const threat = require('../src/threat')
  assert(threat.classify('zombie') === 'hostile', 'a zombie should read as hostile')

  // It should swing at it without being told to.
  await waitFor('the bot to start swinging', () => w.attacks.length > before, { timeout: 30000 })
  assert(w.attacks.some((a) => a.target === zombieId),
    `swung at ${w.attacks.map((a) => a.target).join(',')}, not at the zombie (${zombieId})`)

  // And keep at it until the zombie is actually dead. The server is the truth
  // here: flying-squid deletes a dead mob without sending the removal packet,
  // so the client's own entity list is not the thing to trust.
  await waitFor('the zombie to die', () => !w.server.entities[mob.id], { timeout: 90000 })
  // And the bot should notice and stop swinging at the corpse.
  const afterDeath = w.attacks.length
  await sleep(3000)
  assert(w.attacks.length === afterDeath,
    `it swung ${w.attacks.length - afterDeath} more times after the zombie died`)
})

scenario('it respects the attack cooldown instead of spamming clicks', async (w) => {
  const swings = w.attacks.slice(-12)
  assert(swings.length >= 4, `only ${swings.length} swings recorded to judge`)
  const gaps = []
  for (let i = 1; i < swings.length; i++) gaps.push(swings[i].at - swings[i - 1].at)
  const tooFast = gaps.filter((g) => g < 500)
  assert(tooFast.length === 0,
    `${tooFast.length} of ${gaps.length} swings came faster than the 625ms sword cooldown: ${gaps.join(', ')}`)
})

scenario('passive means it will not start a fight', async (w) => {
  w.order('!passive')
  await w.waitForSaying('standing down')
  await sleep(500)

  const before = w.attacks.length
  const mob = w.summon('zombie', w.bot.entity.position.offset(3, 0, 0))
  const zombie = await waitFor('a second zombie', () =>
    Object.values(w.bot.entities).find((e) => e.name === 'zombie' && e.isValid !== false),
  { timeout: 20000 })

  await sleep(6000)
  assert(w.attacks.length === before,
    `it swung ${w.attacks.length - before} times while passive`)
  assert(w.bot.entities[zombie.id], 'the zombie died during the passive test')

  w.despawn(mob)
  w.order('!guard')
  await w.waitForSaying('guarding')
})

scenario('stop drops whatever it is doing', async (w) => {
  w.order('!passive') // keep the zombie from preempting the order under test
  await w.waitForSaying('standing down')

  const base = w.bot.entity.position.floored()
  for (let i = 0; i < 6; i++) w.setBlock(new Vec3(base.x + 5 + i, 4, base.z + 5), 'iron_ore')
  await sleep(2000)

  w.order('!mine iron 6')
  await waitFor('the mining order to take hold', () => w.bot.brain.order?.label.includes('mine'))

  w.order('!stop')
  await w.waitForSaying('stopping')
  assert(w.bot.brain.order === null, 'the order survived a stop')
  await waitFor('the bot to stand down', () => w.bot.brain.activity === null, { timeout: 10000 })
})

scenario('it reports its own state', async (w) => {
  w.order('!status')
  await w.waitForSaying('health')
  assert(w.said('stance'), 'status left out the stance')

  w.order('!inventory')
  await w.waitForSaying('x ')

  w.order('!help')
  await w.waitForSaying('mine <block>')
})

// -------------------------------------------------------------------- runner

async function main () {
  const filter = process.argv[2]
  const chosen = filter ? scenarios.filter((s) => s.name.includes(filter)) : scenarios
  if (!chosen.length) {
    process.stderr.write(`no scenario matches "${filter}"\n`)
    process.exit(1)
  }

  const w = new World()
  let failures = 0

  process.stdout.write(`booting a Minecraft ${VERSION} server on ${PORT}\n`)
  await w.startServer()
  await w.joinOwner()
  await w.joinBot()
  process.stdout.write(`${w.bot.username} joined as a player\n\n`)

  for (const { name, fn } of chosen) {
    const started = Date.now()
    try {
      await fn(w)
      process.stdout.write(`ok   ${name}  (${((Date.now() - started) / 1000).toFixed(1)}s)\n`)
    } catch (err) {
      failures++
      process.stdout.write(`FAIL ${name}  (${((Date.now() - started) / 1000).toFixed(1)}s)\n`)
      process.stdout.write(`       ${err.message}\n`)
    }
  }

  await w.stop()
  process.stdout.write(`\n${chosen.length - failures}/${chosen.length} scenarios passed\n`)
  process.exit(failures ? 1 : 0)
}

main().catch((err) => {
  process.stderr.write(`${err.stack}\n`)
  process.exit(1)
})
