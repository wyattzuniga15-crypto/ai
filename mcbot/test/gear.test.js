'use strict'

const test = require('node:test')
const assert = require('node:assert')
const Block = require('prismarine-block')('1.20.4')
const mcData = require('minecraft-data')('1.20.4')

const gear = require('../src/gear')

function item (name, extra = {}) {
  const def = mcData.itemsByName[name]
  return {
    name,
    type: def ? def.id : -1,
    count: 1,
    maxDurability: def && def.maxDurability ? def.maxDurability : 0,
    durabilityUsed: 0,
    enchants: [],
    ...extra
  }
}

function block (name) {
  return Block.fromStateId(mcData.blocksByName[name].defaultState, 0)
}

test('pickDigTool takes the pickaxe to iron ore, not the faster-looking nothing', () => {
  const inv = [item('iron_shovel'), item('stone_pickaxe'), item('oak_planks')]
  const choice = gear.pickDigTool(block('iron_ore'), inv)
  assert.equal(choice.item.name, 'stone_pickaxe')
  assert.equal(choice.harvests, true)
})

test('pickDigTool prefers the faster of two working pickaxes', () => {
  const inv = [item('wooden_pickaxe'), item('diamond_pickaxe'), item('stone_pickaxe')]
  const choice = gear.pickDigTool(block('stone'), inv)
  assert.equal(choice.item.name, 'diamond_pickaxe')
})

test('pickDigTool uses bare hands for dirt rather than wearing out a shovel for nothing', () => {
  // A shovel is genuinely faster on dirt, so it should be chosen...
  const withShovel = gear.pickDigTool(block('dirt'), [item('iron_shovel')])
  assert.equal(withShovel.item.name, 'iron_shovel')
  // ...but with no shovel, hands still harvest dirt fine.
  const barehand = gear.pickDigTool(block('dirt'), [item('iron_sword')])
  assert.equal(barehand.item, null)
  assert.equal(barehand.harvests, true)
})

test('pickDigTool spares a nearly-broken tool when another will do', () => {
  const worn = item('diamond_pickaxe', { durabilityUsed: 1560 }) // 1561 max
  const spare = item('stone_pickaxe')
  const choice = gear.pickDigTool(block('stone'), [worn, spare], { durabilityReserve: 5 })
  assert.equal(choice.item.name, 'stone_pickaxe')
})

test('pickDigTool still uses a worn tool when it is the only one', () => {
  const worn = item('diamond_pickaxe', { durabilityUsed: 1560 })
  const choice = gear.pickDigTool(block('iron_ore'), [worn], { durabilityReserve: 5 })
  assert.equal(choice.item.name, 'diamond_pickaxe')
  assert.equal(choice.harvests, true)
})

test('efficiency makes a tool faster', () => {
  const plain = gear.pickDigTool(block('stone'), [item('iron_pickaxe')])
  const enchanted = gear.pickDigTool(block('stone'), [
    item('iron_pickaxe', { enchants: [{ name: 'efficiency', lvl: 5 }] })
  ])
  assert.ok(enchanted.time < plain.time, `${enchanted.time} should beat ${plain.time}`)
})

test('bestWeapon ranks by damage per second, so a sword beats an axe', () => {
  const chosen = gear.bestWeapon([item('diamond_axe'), item('diamond_sword')])
  assert.equal(chosen.name, 'diamond_sword')
})

test('bestWeapon prefers a better sword and ignores non-weapons', () => {
  const chosen = gear.bestWeapon([item('wooden_sword'), item('iron_sword'), item('diamond_pickaxe')])
  assert.equal(chosen.name, 'iron_sword')
})

test('bestWeapon returns null when there is nothing but junk', () => {
  assert.equal(gear.bestWeapon([item('dirt'), item('stick')]), null)
})

test('sharpness tips the choice between two swords', () => {
  const sharp = item('iron_sword', { enchants: [{ name: 'sharpness', lvl: 5 }] })
  const chosen = gear.bestWeapon([item('diamond_sword'), sharp])
  assert.equal(chosen.name, 'iron_sword') // 6+3 = 9 beats a plain diamond's 7
})

test('swingInterval respects the 1.9 attack cooldown', () => {
  assert.equal(Math.round(gear.swingInterval(item('iron_sword'))), 625)
  assert.equal(Math.round(gear.swingInterval(item('stone_axe'))), 1250)
  assert.equal(Math.round(gear.swingInterval(null)), 250)
})

test('bestArmor fills empty slots and upgrades weak pieces', () => {
  const inv = [
    item('leather_helmet'), item('diamond_helmet'),
    item('iron_chestplate'), item('golden_boots')
  ]
  const worn = { torso: item('leather_chestplate') }
  const picks = gear.bestArmor(inv, worn)
  assert.equal(picks.head.name, 'diamond_helmet')
  assert.equal(picks.torso.name, 'iron_chestplate')
  assert.equal(picks.feet.name, 'golden_boots')
  assert.equal(picks.legs, undefined)
})

test('bestArmor leaves a better worn piece alone', () => {
  const picks = gear.bestArmor([item('leather_helmet')], { head: item('diamond_helmet') })
  assert.deepEqual(picks, {})
})

test('bestFood prefers filling food and avoids rotten flesh', () => {
  const foods = mcData.foodsByName
  const chosen = gear.bestFood([item('rotten_flesh'), item('bread')], foods, 20)
  assert.equal(chosen.name, 'bread')
})

test('bestFood eats rotten flesh when that is all there is', () => {
  const chosen = gear.bestFood([item('rotten_flesh')], mcData.foodsByName, 20)
  assert.equal(chosen.name, 'rotten_flesh')
})

test('bestFood does not waste a steak to top off one hunger point', () => {
  const foods = mcData.foodsByName
  const chosen = gear.bestFood([item('cooked_beef'), item('melon_slice')], foods, 1)
  assert.equal(chosen.name, 'melon_slice')
})

test('bestFood returns null with nothing edible', () => {
  assert.equal(gear.bestFood([item('cobblestone')], mcData.foodsByName, 20), null)
})

test('durabilityLeft treats unbreakable items as endless', () => {
  assert.equal(gear.durabilityLeft(item('cobblestone')), Infinity)
  assert.equal(gear.durabilityLeft(item('iron_pickaxe', { durabilityUsed: 200 })), 250 - 200 + 0)
})
