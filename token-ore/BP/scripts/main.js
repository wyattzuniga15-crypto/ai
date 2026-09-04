// Token Ore drops.
//
// Bedrock loot tables cannot express "iron pickaxe or better", Silk Touch or
// Fortune for custom blocks, so both ores use an empty loot table and this
// script spawns the drops itself whenever a player breaks one.

import { world, ItemStack } from "@minecraft/server";

const ORES = new Set(["cvc:token_ore", "cvc:deepslate_token_ore"]);
const RAW_TOKEN = "cvc:raw_token";

// Raw Tokens per ore before Fortune, inclusive on both ends.
const MIN_DROP = 1;
const MAX_DROP = 3;

// A pickaxe of iron tier or better harvests the ore. The tier tags cover
// custom pickaxes from other packs; the ids are a fallback for known ones.
const TIER_TAGS = ["minecraft:iron_tier", "minecraft:diamond_tier", "minecraft:netherite_tier", "cvc:token_tier"];
const HARVEST_PICKAXES = new Set([
  "minecraft:iron_pickaxe",
  "minecraft:diamond_pickaxe",
  "minecraft:netherite_pickaxe",
  "cvc:token_pickaxe"
]);

function randomInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function isCreative(player) {
  try {
    return /creative/i.test(String(player.getGameMode()));
  } catch (_) {
    return false;
  }
}

function canHarvest(tool) {
  if (!tool) return false;
  if (HARVEST_PICKAXES.has(tool.typeId)) return true;
  try {
    return tool.hasTag("minecraft:is_pickaxe") && TIER_TAGS.some((tag) => tool.hasTag(tag));
  } catch (_) {
    return false;
  }
}

// Level of the named enchantment on the tool, or 0 when it is absent.
function enchantmentLevel(tool, name) {
  try {
    const enchantable = tool.getComponent("minecraft:enchantable");
    if (!enchantable) return 0;
    for (const enchantment of enchantable.getEnchantments()) {
      const id = String(enchantment.type && enchantment.type.id ? enchantment.type.id : enchantment.type);
      if (id === name || id === "minecraft:" + name) return enchantment.level;
    }
  } catch (_) {
    // Not enchantable: level 0.
  }
  return 0;
}

world.afterEvents.playerBreakBlock.subscribe((event) => {
  const oreId = event.brokenBlockPermutation.type.id;
  if (!ORES.has(oreId)) return;
  if (isCreative(event.player)) return;

  const tool = event.itemStackBeforeBreak;
  if (!canHarvest(tool)) return;

  const { x, y, z } = event.block.location;
  const center = { x: x + 0.5, y: y + 0.5, z: z + 0.5 };

  if (enchantmentLevel(tool, "silk_touch") > 0) {
    event.dimension.spawnItem(new ItemStack(oreId, 1), center);
    return;
  }

  const fortune = enchantmentLevel(tool, "fortune");
  const count = randomInt(MIN_DROP, MAX_DROP) + (fortune > 0 ? randomInt(0, fortune) : 0);
  event.dimension.spawnItem(new ItemStack(RAW_TOKEN, count), center);
});
