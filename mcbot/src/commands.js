'use strict'

// Pure parsing of the orders the bot takes in chat. Kept separate from the
// dispatch so the grammar can be tested without a server.

const ALIASES = {
  mine: 'mine',
  dig: 'mine',
  gather: 'mine',
  chop: 'mine',
  farm: 'mine',
  stop: 'stop',
  halt: 'stop',
  cancel: 'stop',
  come: 'come',
  here: 'come',
  tome: 'come',
  follow: 'follow',
  goto: 'goto',
  go: 'goto',
  fight: 'fight',
  attack: 'fight',
  kill: 'fight',
  hunt: 'fight',
  guard: 'guard',
  defend: 'guard',
  passive: 'passive',
  peace: 'passive',
  hold: 'passive',
  gear: 'gear',
  equip: 'gear',
  armor: 'gear',
  armour: 'gear',
  status: 'status',
  report: 'status',
  how: 'status',
  inv: 'inventory',
  inventory: 'inventory',
  items: 'inventory',
  drop: 'drop',
  give: 'drop',
  toss: 'drop',
  eat: 'eat',
  food: 'eat',
  quit: 'quit',
  leave: 'quit',
  disconnect: 'quit',
  help: 'help',
  commands: 'help'
}

const NUMBER = /^-?\d+$/

function tokenise (text) {
  return String(text || '').trim().split(/\s+/).filter(Boolean)
}

// Strip an address like "!" or "bot," or "Steve:" from the front of a message.
// Returns null when the message was not aimed at the bot at all.
function stripAddress (text, { prefix = '!', names = [] } = {}) {
  const raw = String(text || '').trim()
  if (!raw) return null

  if (prefix && raw.startsWith(prefix)) return raw.slice(prefix.length).trim()

  const lower = raw.toLowerCase()
  for (const name of names) {
    if (!name) continue
    const n = name.toLowerCase()
    if (lower.startsWith(n)) {
      const rest = raw.slice(name.length)
      // Only an address if a separator follows, so "botanist" is not "bot".
      if (/^\s*[,:]?\s+/.test(rest) || /^\s*[,:]\s*/.test(rest)) {
        return rest.replace(/^\s*[,:]?\s*/, '').trim()
      }
    }
  }
  return null
}

function parseCommand (text) {
  const words = tokenise(text)
  if (!words.length) return { error: 'empty' }

  const verb = ALIASES[words[0].toLowerCase()]
  if (!verb) return { error: `unknown command: ${words[0]}` }
  const rest = words.slice(1)

  switch (verb) {
    case 'mine': {
      if (!rest.length) return { error: 'mine what? try: mine iron 10' }
      // Trailing number is the count; everything before it is the block.
      let count = null
      const parts = [...rest]
      if (parts.length > 1 && NUMBER.test(parts[parts.length - 1])) {
        count = parseInt(parts.pop(), 10)
      }
      if (count !== null && count <= 0) return { error: 'count must be at least 1' }
      return { name: 'mine', args: { block: parts.join('_'), count: count ?? 1 } }
    }
    case 'goto': {
      const nums = rest.filter((w) => NUMBER.test(w)).map(Number)
      if (nums.length === 3) return { name: 'goto', args: { x: nums[0], y: nums[1], z: nums[2] } }
      if (nums.length === 2) return { name: 'goto', args: { x: nums[0], z: nums[1] } }
      if (rest.length === 1) return { name: 'come', args: { who: rest[0] } }
      return { error: 'goto needs x y z, or a player name' }
    }
    case 'follow':
      return { name: 'follow', args: { who: rest[0] || null } }
    case 'come':
      return { name: 'come', args: { who: rest[0] || null } }
    case 'fight':
      return { name: 'fight', args: { what: rest.length ? rest.join('_').toLowerCase() : null } }
    case 'drop': {
      const parts = [...rest]
      let count = null
      if (parts.length > 1 && NUMBER.test(parts[parts.length - 1])) count = parseInt(parts.pop(), 10)
      if (!parts.length) return { error: 'drop what?' }
      return { name: 'drop', args: { item: parts.join('_').toLowerCase(), count } }
    }
    default:
      return { name: verb, args: {} }
  }
}

const HELP = [
  'mine <block> [n] — e.g. "mine iron 10", "mine wood 32"',
  'come / follow [player] / goto <x> <y> <z>',
  'fight [mob] / guard / passive — combat stance',
  'gear — equip the best tools and armour I have',
  'status / inventory / eat / drop <item> [n]',
  'stop — drop whatever I am doing'
]

module.exports = { ALIASES, HELP, tokenise, stripAddress, parseCommand }
