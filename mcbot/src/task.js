'use strict'

// Cooperative cancellation. Every long-running behaviour takes a token and
// checks it between steps, so the brain can drop what the bot is doing the
// moment something more urgent shows up — a creeper does not wait for the
// current block to finish breaking.

class Cancelled extends Error {
  constructor (reason = 'cancelled') {
    super(reason)
    this.name = 'Cancelled'
    this.reason = reason
  }
}

class Token {
  constructor (label = 'task') {
    this.label = label
    this.cancelled = false
    this.reason = null
    this._listeners = []
  }

  cancel (reason = 'cancelled') {
    if (this.cancelled) return
    this.cancelled = true
    this.reason = reason
    for (const fn of this._listeners.splice(0)) {
      try { fn(reason) } catch { /* a listener failing must not block the rest */ }
    }
  }

  check () {
    if (this.cancelled) throw new Cancelled(this.reason)
  }

  onCancel (fn) {
    if (this.cancelled) fn(this.reason)
    else this._listeners.push(fn)
    return () => {
      const i = this._listeners.indexOf(fn)
      if (i >= 0) this._listeners.splice(i, 1)
    }
  }
}

function sleep (ms, token) {
  return new Promise((resolve, reject) => {
    if (token && token.cancelled) return reject(new Cancelled(token.reason))
    const timer = setTimeout(() => { off(); resolve() }, ms)
    const off = token
      ? token.onCancel((reason) => { clearTimeout(timer); reject(new Cancelled(reason)) })
      : () => {}
  })
}

// Run a promise but give up on it the moment the token is cancelled. The
// underlying operation keeps running; callers pair this with bot.pathfinder
// .stop() or bot.stopDigging() to actually halt the bot.
function race (promise, token) {
  if (!token) return promise
  return new Promise((resolve, reject) => {
    let settled = false
    const off = token.onCancel((reason) => {
      if (settled) return
      settled = true
      reject(new Cancelled(reason))
    })
    promise.then(
      (v) => { if (!settled) { settled = true; off(); resolve(v) } },
      (e) => { if (!settled) { settled = true; off(); reject(e) } }
    )
  })
}

function isCancelled (err) {
  return err instanceof Cancelled || err?.name === 'Cancelled'
}

module.exports = { Cancelled, Token, sleep, race, isCancelled }
