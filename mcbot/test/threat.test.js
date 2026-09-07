'use strict'

const test = require('node:test')
const assert = require('node:assert')
const threat = require('../src/threat')

let nextId = 1
function mob (name, x = 0, y = 0, z = 0, extra = {}) {
  return { id: nextId++, name, type: 'mob', kind: 'Hostile mobs', position: { x, y, z }, ...extra }
}

const origin = { x: 0, y: 0, z: 0 }

test('classifies mobs into fight, wait-and-see, and run', () => {
  assert.equal(threat.classify('zombie'), 'hostile')
  assert.equal(threat.classify('enderman'), 'neutral')
  assert.equal(threat.classify('warden'), 'avoid')
  assert.equal(threat.classify('cow'), 'passive')
})

test('a hostile in range is a threat; a cow never is', () => {
  assert.equal(threat.isThreat(mob('zombie', 3, 0, 0), { origin }), true)
  assert.equal(threat.isThreat(mob('cow', 3, 0, 0), { origin }), false)
})

test('range is respected', () => {
  assert.equal(threat.isThreat(mob('zombie', 40, 0, 0), { origin, engageRadius: 16 }), false)
  assert.equal(threat.isThreat(mob('zombie', 10, 0, 0), { origin, engageRadius: 16 }), true)
})

test('a neutral mob is left alone until it starts something', () => {
  const enderman = mob('enderman', 4, 0, 0)
  assert.equal(threat.isThreat(enderman, { origin }), false)
  assert.equal(threat.isThreat(enderman, { origin, provoked: new Set([enderman.id]) }), true)
})

test('the bot does not pick a fight with a warden', () => {
  const warden = mob('warden', 5, 0, 0)
  assert.equal(threat.isThreat(warden, { origin }), false)
  assert.equal(threat.isThreat(warden, { origin, fightAvoidable: true }), true)
})

test('players and dropped items are not mobs', () => {
  const player = { id: 99, name: 'player', type: 'player', username: 'Steve', position: { x: 1, y: 0, z: 0 } }
  const drop = { id: 98, name: 'item', type: 'object', position: { x: 1, y: 0, z: 0 } }
  assert.equal(threat.isThreat(player, { origin }), false)
  assert.equal(threat.isThreat(drop, { origin }), false)
})

test('the nearer of two identical mobs is the target', () => {
  const far = mob('zombie', 12, 0, 0)
  const near = mob('zombie', 2, 0, 0)
  const picked = threat.pickTarget({ 1: far, 2: near }, { origin })
  assert.equal(picked.id, near.id)
})

test('a close creeper jumps the queue', () => {
  const zombie = mob('zombie', 2, 0, 0)
  const creeper = mob('creeper', 4, 0, 0)
  const picked = threat.pickTarget({ 1: zombie, 2: creeper }, { origin })
  assert.equal(picked.name, 'creeper')
})

test('whatever is already hitting the bot outranks an equal mob further off', () => {
  const biting = mob('zombie', 5, 0, 0)
  const idle = mob('zombie', 4, 0, 0)
  const picked = threat.pickTarget({ 1: biting, 2: idle }, { origin, provoked: new Set([biting.id]) })
  assert.equal(picked.id, biting.id)
})

test('findThreats sorts by urgency and drops everything harmless', () => {
  const list = threat.findThreats({
    1: mob('cow', 1, 0, 0),
    2: mob('zombie', 9, 0, 0),
    3: mob('skeleton', 3, 0, 0)
  }, { origin })
  assert.equal(list.length, 2)
  assert.equal(list[0].entity.name, 'skeleton')
})

test('creepers are fought at arm’s length', () => {
  const creeper = threat.preferredRange({ name: 'creeper' })
  const zombie = threat.preferredRange({ name: 'zombie' })
  assert.ok(creeper.tooClose > 0)
  assert.equal(zombie.tooClose, 0)
})

test('distance is euclidean and survives a missing position', () => {
  assert.equal(threat.distance({ x: 0, y: 0, z: 0 }, { x: 3, y: 0, z: 4 }), 5)
  assert.equal(threat.distance(null, { x: 1, y: 1, z: 1 }), Infinity)
})
