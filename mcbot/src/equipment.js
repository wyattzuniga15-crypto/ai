'use strict'

const gear = require('./gear')
const { logger } = require('./log')

const log = logger('gear')

function inventoryItems (bot) {
  return bot.inventory.items()
}

// What the bot is wearing right now, read straight out of the armour slots.
function wornArmor (bot) {
  const worn = {}
  for (const slot of gear.ARMOR_SLOTS) {
    const index = bot.getEquipmentDestSlot(slot)
    worn[slot] = bot.inventory.slots[index] || null
  }
  return worn
}

async function equipToHand (bot, item) {
  const held = bot.heldItem
  if (!item) {
    if (held) await bot.unequip('hand')
    return null
  }
  if (held && held.type === item.type) return held
  await bot.equip(item, 'hand')
  return bot.heldItem
}

// Hold whatever breaks this block fastest while still dropping the goods.
async function equipForBlock (bot, block, opts = {}) {
  const choice = gear.pickDigTool(block, inventoryItems(bot), {
    creative: bot.game?.gameMode === 'creative',
    inWater: bot.entity?.isInWater ?? false,
    notOnGround: !(bot.entity?.onGround ?? true),
    durabilityReserve: opts.durabilityReserve ?? 0
  })
  await equipToHand(bot, choice.item)
  return choice
}

async function equipWeapon (bot, opts = {}) {
  const weapon = gear.bestWeapon(inventoryItems(bot), {
    durabilityReserve: opts.durabilityReserve ?? 0
  })
  await equipToHand(bot, weapon)
  return weapon
}

// Put on every piece that beats what is already worn. Returns the names of
// what changed, so the caller can say something useful in chat.
async function equipArmor (bot, opts = {}) {
  const picks = gear.bestArmor(inventoryItems(bot), wornArmor(bot), {
    durabilityReserve: opts.durabilityReserve ?? 0
  })
  const changed = []
  for (const [slot, item] of Object.entries(picks)) {
    try {
      await bot.equip(item, slot)
      changed.push(item.name)
    } catch (err) {
      log.warn(`could not put on ${item.name}:`, err.message)
    }
  }
  return changed
}

// Shield in the off hand if there is one, which is most of what keeps a bot
// alive against skeletons.
async function equipShield (bot) {
  const shield = inventoryItems(bot).find((i) => i.name === 'shield')
  if (!shield) return null
  const offhandSlot = bot.getEquipmentDestSlot('off-hand')
  if (bot.inventory.slots[offhandSlot]?.name === 'shield') return shield
  try {
    await bot.equip(shield, 'off-hand')
    return shield
  } catch (err) {
    log.warn('could not raise shield:', err.message)
    return null
  }
}

module.exports = {
  inventoryItems,
  wornArmor,
  equipToHand,
  equipForBlock,
  equipWeapon,
  equipArmor,
  equipShield
}
