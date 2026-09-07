'use strict'

const test = require('node:test')
const assert = require('node:assert')
const mcData = require('minecraft-data')('1.20.4')
const targets = require('../src/targets')

const known = new Set(Object.keys(mcData.blocksByName))

test('"iron" means the ore in both stone and deepslate', () => {
  const names = targets.resolveBlockNames('iron', known)
  assert.deepEqual(names.sort(), ['deepslate_iron_ore', 'iron_ore'])
})

test('an exact block name is taken literally', () => {
  assert.deepEqual(targets.resolveBlockNames('cobblestone', known), ['cobblestone'])
})

test('"wood" covers every log and stem the version has', () => {
  const names = targets.resolveBlockNames('wood', known)
  assert.ok(names.includes('oak_log'))
  assert.ok(names.includes('birch_log'))
  assert.ok(names.includes('crimson_stem'))
  assert.ok(!names.includes('oak_planks'))
})

test('"ores" gathers all of them, ancient debris included', () => {
  const names = targets.resolveBlockNames('ores', known)
  assert.ok(names.includes('diamond_ore'))
  assert.ok(names.includes('nether_quartz_ore'))
  assert.ok(names.includes('ancient_debris'))
})

test('plurals and spacing are forgiven', () => {
  assert.deepEqual(targets.resolveBlockNames('diamonds', known).sort(), ['deepslate_diamond_ore', 'diamond_ore'])
  assert.deepEqual(targets.resolveBlockNames('  IRON  ', known).sort(), ['deepslate_iron_ore', 'iron_ore'])
  assert.ok(targets.resolveBlockNames('ancient debris', known).includes('ancient_debris'))
})

test('a loose word never selects somebody’s chest', () => {
  const names = targets.resolveBlockNames('chest', known)
  // "chest" is a real block name, so an exact ask is honoured...
  assert.deepEqual(names, ['chest'])
  // ...but a fragment that would sweep containers in does not.
  const loose = targets.resolveBlockNames('shulker', known)
  assert.ok(!loose.includes('shulker_box'))
})

test('nonsense resolves to nothing rather than to something random', () => {
  assert.deepEqual(targets.resolveBlockNames('flurb', known), [])
  assert.deepEqual(targets.resolveBlockNames('', known), [])
})

test('digging refuses next to lava and under gravel', () => {
  assert.equal(targets.isDiggingSafe('stone', ['stone', 'dirt']), true)
  assert.equal(targets.isDiggingSafe('stone', ['stone', 'lava']), false)
  assert.equal(targets.isDiggingSafe('bedrock', []), false)
  const under = Object.assign(['stone'], { above: 'gravel' })
  assert.equal(targets.isDiggingSafe('stone', under), false)
  assert.equal(targets.isDiggingSafe('stone', under, { allowUnderFalling: true }), true)
})

test('targets are ranked near-first, and level ground beats a climb', () => {
  const origin = { x: 0, y: 64, z: 0 }
  const ranked = targets.rankTargets([
    { x: 10, y: 64, z: 0 },
    { x: 2, y: 64, z: 0 },
    { x: 1, y: 50, z: 0 }
  ], origin)
  assert.deepEqual(ranked[0], { x: 2, y: 64, z: 0 })
  assert.deepEqual(ranked[2], { x: 1, y: 50, z: 0 })
})
