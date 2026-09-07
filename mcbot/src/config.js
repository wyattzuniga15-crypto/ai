'use strict'

// Configuration comes from flags first, then the environment, then defaults.
// Nothing here has a secret baked in: an account password or token belongs in
// the environment, never in the repository.

const DEFAULTS = {
  host: 'localhost',
  port: 25565,
  username: 'Claudius',
  auth: 'offline', // 'offline' for a cracked/LAN server, 'microsoft' for a real account
  version: null, // null lets mineflayer negotiate the server's version
  owners: [], // empty means anyone in chat may command the bot
  prefix: '!',
  autoReconnect: true,
  reconnectDelay: 10000,
  logLevel: 'info',

  // Behaviour thresholds.
  stance: 'guard', // guard | passive
  engageRadius: 16,
  eatBelow: 16,
  fleeBelow: 6,
  tickMs: 250,
  searchRadius: 48,
  durabilityReserve: 3,
  criticals: true,
  allowUnderFalling: false,
  explore: true
}

const NUMBERS = new Set([
  'port', 'reconnectDelay', 'engageRadius', 'eatBelow', 'fleeBelow', 'tickMs',
  'searchRadius', 'durabilityReserve'
])
const BOOLEANS = new Set(['autoReconnect', 'criticals', 'allowUnderFalling', 'explore'])
const LISTS = new Set(['owners'])

function parseValue (key, raw) {
  if (NUMBERS.has(key)) {
    const n = Number(raw)
    if (!Number.isFinite(n)) throw new Error(`${key} must be a number, got "${raw}"`)
    return n
  }
  if (BOOLEANS.has(key)) return !(raw === 'false' || raw === '0' || raw === 'no')
  if (LISTS.has(key)) return String(raw).split(',').map((s) => s.trim()).filter(Boolean)
  return raw
}

function parseArgs (argv) {
  const out = {}
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (!arg.startsWith('--')) continue
    let key = arg.slice(2)
    let raw
    const eq = key.indexOf('=')
    if (eq >= 0) {
      raw = key.slice(eq + 1)
      key = key.slice(0, eq)
    } else if (BOOLEANS.has(key) && (i + 1 >= argv.length || argv[i + 1].startsWith('--'))) {
      raw = 'true'
    } else {
      raw = argv[++i]
    }
    if (raw === undefined) throw new Error(`--${key} needs a value`)
    if (!(key in DEFAULTS) && key !== 'password') throw new Error(`unknown option --${key}`)
    out[key] = parseValue(key, raw)
  }
  return out
}

const ENV_KEYS = {
  MC_HOST: 'host',
  MC_PORT: 'port',
  MC_USERNAME: 'username',
  MC_AUTH: 'auth',
  MC_VERSION: 'version',
  MC_OWNERS: 'owners',
  MC_PREFIX: 'prefix',
  MC_STANCE: 'stance',
  LOG_LEVEL: 'logLevel'
}

function fromEnv (env) {
  const out = {}
  for (const [envKey, key] of Object.entries(ENV_KEYS)) {
    if (env[envKey] !== undefined && env[envKey] !== '') out[key] = parseValue(key, env[envKey])
  }
  return out
}

function load (argv = process.argv.slice(2), env = process.env) {
  const config = { ...DEFAULTS, ...fromEnv(env), ...parseArgs(argv) }
  if (env.MC_PASSWORD) config.password = env.MC_PASSWORD
  if (!['offline', 'microsoft'].includes(config.auth)) {
    throw new Error(`auth must be "offline" or "microsoft", got "${config.auth}"`)
  }
  if (!['guard', 'passive'].includes(config.stance)) {
    throw new Error(`stance must be "guard" or "passive", got "${config.stance}"`)
  }
  if (config.port < 1 || config.port > 65535) throw new Error(`port out of range: ${config.port}`)
  return config
}

module.exports = { DEFAULTS, load, parseArgs, fromEnv, parseValue }
