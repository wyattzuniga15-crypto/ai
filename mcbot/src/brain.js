'use strict'

const threat = require('./threat')
const survival = require('./survival')
const combat = require('./combat')
const { Token, isCancelled } = require('./task')
const { logger } = require('./log')

const log = logger('brain')

// What outranks what. A standing order is the lowest thing that still counts as
// doing something; anything above it interrupts, runs, and hands control back.
const PRIORITY = { idle: 0, order: 1, defend: 2, eat: 3, flee: 4 }

class Brain {
  constructor (bot, opts = {}) {
    this.bot = bot
    this.opts = opts
    this.stance = opts.stance || 'guard' // guard | passive
    this.order = null
    this.activity = null
    this.provoked = new Map() // entity id -> when it last hit us
    this.givenUp = new Map() // entity id -> when we stopped trying to reach it
    this.dead = new Map() // entity id -> when we saw it die

    // A mob that has played its death animation is never a target again, even
    // if the packet that removes it is late or never comes.
    this.onEntityDead = (entity) => this.dead.set(entity.id, Date.now())
    bot.on('entityDead', this.onEntityDead)
    this.timer = null
    this.lastSay = ''
  }

  // Combat context, rebuilt each tick because position and grudges move.
  context () {
    this.expire(this.provoked, this.opts.grudgeMs ?? 20000)
    this.expire(this.givenUp, this.opts.retryMs ?? 60000)
    this.expire(this.dead, this.opts.corpseMs ?? 300000)
    // Live views rather than snapshots: a fight can outlast the moment the
    // context was built, and a mob that dies mid-fight has to drop off the
    // target list straight away.
    return {
      origin: this.bot.entity?.position,
      engageRadius: this.opts.engageRadius ?? 16,
      provoked: { has: (id) => this.provoked.has(id) },
      ignore: { has: (id) => this.givenUp.has(id) || this.dead.has(id) },
      fightAvoidable: false
    }
  }

  expire (map, ttl) {
    const now = Date.now()
    for (const [id, when] of map) {
      if (now - when > ttl) map.delete(id)
    }
  }

  remember (entityId) {
    this.provoked.set(entityId, Date.now())
  }

  threats () {
    return threat.findThreats(this.bot.entities, this.context())
  }

  // The single highest-priority thing the bot should be doing this instant.
  decide () {
    const bot = this.bot
    if (!bot.entity || bot.health === undefined) return 'idle'

    const threats = this.threats()

    if (survival.shouldFlee(bot, this.opts) && threats.length) return 'flee'
    if (survival.shouldEat(bot, this.opts) && !threats.length &&
        bot.inventory.items().some((i) => this.opts.foods?.[i.name])) return 'eat'
    if (this.stance !== 'passive' && threats.length) return 'defend'
    if (this.order) return 'order'
    return 'idle'
  }

  start () {
    if (this.timer) return
    this.timer = setInterval(() => {
      this.tick().catch((err) => log.error('tick failed:', err))
    }, this.opts.tickMs ?? 250)
  }

  stop () {
    if (this.timer) clearInterval(this.timer)
    this.timer = null
    this.bot.removeListener('entityDead', this.onEntityDead)
    this.cancelActivity('shutting down')
  }

  async tick () {
    const desired = this.decide()
    const current = this.activity?.mode ?? 'idle'

    if (this.activity && PRIORITY[desired] <= PRIORITY[current]) return
    if (desired === 'idle') return

    if (this.activity) {
      log.info(`${current} interrupted by ${desired}`)
      this.cancelActivity(desired)
    }
    this.run(desired)
  }

  cancelActivity (reason) {
    const activity = this.activity
    if (!activity) return
    this.activity = null
    activity.token.cancel(reason)
    try { this.bot.pathfinder.setGoal(null) } catch { /* not pathing */ }
    try { this.bot.pathfinder.stop() } catch { /* not pathing */ }
    for (const control of ['forward', 'back', 'left', 'right', 'sprint', 'jump']) {
      try { this.bot.setControlState(control, false) } catch { /* not connected */ }
    }
  }

  run (mode) {
    const token = new Token(mode)
    const activity = { mode, token }
    this.activity = activity

    const finish = (err) => {
      if (this.activity !== activity) return // Already superseded.
      this.activity = null
      if (err && !isCancelled(err)) log.error(`${mode} failed:`, err)
    }

    let work
    switch (mode) {
      case 'flee':
        work = survival.flee(this.bot, this.threats(), token, this.opts)
        break
      case 'eat':
        work = survival.eat(this.bot, token, this.opts)
        break
      case 'defend':
        work = combat.defend(this.bot, token, this.context(), {
          ...this.opts,
          onGiveUp: (entity, why) => {
            log.info(`writing off ${entity.name} (${why}) for now`)
            this.givenUp.set(entity.id, Date.now())
          }
        })
        break
      case 'order':
        work = this.order.run(token).then(
          (result) => {
            // The order ran to completion, so it should not start again.
            if (this.order) {
              const done = this.order
              this.order = null
              if (done.onDone) done.onDone(result)
            }
          },
          (err) => {
            if (isCancelled(err)) throw err // Preempted: keep the order for later.
            const failed = this.order
            this.order = null
            if (failed?.onFail) failed.onFail(err)
            throw err
          })
        break
      default:
        this.activity = null
        return
    }

    work.then(() => finish(null), (err) => finish(err))
  }

  // Give the bot a standing order, replacing whatever it was doing.
  setOrder (order) {
    this.cancelActivity('new order')
    this.order = order
    log.info(`order: ${order.label}`)
  }

  clearOrder (reason = 'told to stop') {
    const had = Boolean(this.order)
    this.order = null
    this.cancelActivity(reason)
    return had
  }

  describe () {
    const bot = this.bot
    const parts = [
      `health ${Math.round(bot.health ?? 0)}/20`,
      `food ${Math.round(bot.food ?? 0)}/20`,
      `stance ${this.stance}`
    ]
    parts.push(this.order ? `order: ${this.order.label}` : 'no orders')
    if (this.activity) parts.push(`busy: ${this.activity.mode}`)
    const threats = this.threats()
    if (threats.length) parts.push(`${threats.length} hostile nearby (${threats[0].entity.name})`)
    return parts.join(' · ')
  }
}

module.exports = { Brain, PRIORITY }
