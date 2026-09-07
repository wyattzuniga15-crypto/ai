'use strict'

const test = require('node:test')
const assert = require('node:assert')
const { parseCommand, stripAddress } = require('../src/commands')

test('a prefix or the bot’s name gets its attention, and nothing else does', () => {
  const opts = { prefix: '!', names: ['Miner'] }
  assert.equal(stripAddress('!mine iron', opts), 'mine iron')
  assert.equal(stripAddress('Miner, mine iron', opts), 'mine iron')
  assert.equal(stripAddress('Miner: status', opts), 'status')
  assert.equal(stripAddress('just chatting', opts), null)
  assert.equal(stripAddress('Minerals are nice', opts), null)
})

test('mine takes a block and an optional count', () => {
  assert.deepEqual(parseCommand('mine iron 10'), { name: 'mine', args: { block: 'iron', count: 10 } })
  assert.deepEqual(parseCommand('mine wood'), { name: 'mine', args: { block: 'wood', count: 1 } })
  assert.deepEqual(parseCommand('chop ancient debris 4'),
    { name: 'mine', args: { block: 'ancient_debris', count: 4 } })
})

test('mine rejects a missing or nonsense count', () => {
  assert.ok(parseCommand('mine').error)
  assert.ok(parseCommand('mine iron 0').error)
})

test('goto takes coordinates, or a name and becomes come', () => {
  assert.deepEqual(parseCommand('goto 100 64 -20'), { name: 'goto', args: { x: 100, y: 64, z: -20 } })
  assert.deepEqual(parseCommand('goto 100 -20'), { name: 'goto', args: { x: 100, z: -20 } })
  assert.deepEqual(parseCommand('go Steve'), { name: 'come', args: { who: 'Steve' } })
  assert.ok(parseCommand('goto over there').error)
})

test('follow and come default to whoever asked', () => {
  assert.deepEqual(parseCommand('follow'), { name: 'follow', args: { who: null } })
  assert.deepEqual(parseCommand('follow Steve'), { name: 'follow', args: { who: 'Steve' } })
  assert.deepEqual(parseCommand('come'), { name: 'come', args: { who: null } })
})

test('fight can name a mob or mean "anything nearby"', () => {
  assert.deepEqual(parseCommand('fight'), { name: 'fight', args: { what: null } })
  assert.deepEqual(parseCommand('kill cave spider'), { name: 'fight', args: { what: 'cave_spider' } })
})

test('drop takes an item and an optional count', () => {
  assert.deepEqual(parseCommand('drop iron_ore 5'), { name: 'drop', args: { item: 'iron_ore', count: 5 } })
  assert.deepEqual(parseCommand('give cooked beef'), { name: 'drop', args: { item: 'cooked_beef', count: null } })
  assert.ok(parseCommand('drop').error)
})

test('the short words work', () => {
  assert.equal(parseCommand('stop').name, 'stop')
  assert.equal(parseCommand('halt').name, 'stop')
  assert.equal(parseCommand('inv').name, 'inventory')
  assert.equal(parseCommand('guard').name, 'guard')
  assert.equal(parseCommand('passive').name, 'passive')
  assert.equal(parseCommand('gear').name, 'gear')
})

test('an unknown word is reported, not guessed at', () => {
  assert.match(parseCommand('flumox the thing').error, /unknown command/)
  assert.ok(parseCommand('').error)
})
