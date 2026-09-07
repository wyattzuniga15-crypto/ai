'use strict'

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 }

let threshold = LEVELS.info

function setLevel (name) {
  if (!(name in LEVELS)) throw new Error(`unknown log level: ${name}`)
  threshold = LEVELS[name]
}

function stamp () {
  return new Date().toISOString().slice(11, 19)
}

function emit (level, tag, args) {
  if (LEVELS[level] < threshold) return
  const stream = LEVELS[level] >= LEVELS.warn ? process.stderr : process.stdout
  stream.write(`${stamp()} [${tag}] ${args.map(fmt).join(' ')}\n`)
}

function fmt (v) {
  if (typeof v === 'string') return v
  if (v instanceof Error) return v.stack || v.message
  try { return JSON.stringify(v) } catch { return String(v) }
}

function logger (tag) {
  return {
    debug: (...a) => emit('debug', tag, a),
    info: (...a) => emit('info', tag, a),
    warn: (...a) => emit('warn', tag, a),
    error: (...a) => emit('error', tag, a)
  }
}

module.exports = { logger, setLevel, LEVELS }
