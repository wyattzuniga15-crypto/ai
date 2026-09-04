# Claude vs ChatGPT Challenge — Token Ore (Bedrock add-on)

Namespace: `cvc`. Built for Bedrock 26.20+ (JSON format 1.26.20). No experimental toggles needed.

## What's in it

| Thing | ID | Notes |
|---|---|---|
| Token Ore | `cvc:token_ore` | Stone layer, light level 4 |
| Deepslate Token Ore | `cvc:deepslate_token_ore` | Deepslate layer, slower to mine |
| Raw Token | `cvc:raw_token` | Drops 1–3 from ore (iron pick or better) |
| Token | `cvc:token` | Smelt or blast Raw Token |
| Token Sword, Pickaxe, Axe, Shovel, Hoe | `cvc:token_sword` … `cvc:token_hoe` | Vanilla tool recipes: Tokens plus sticks |
| Token Helmet, Chestplate, Leggings, Boots | `cvc:token_helmet` … `cvc:token_boots` | Vanilla armor recipes: Tokens only |

World gen: y 0–64 at 6 veins/chunk, y -64–0 at 10 veins/chunk, vein size 9, all Overworld biomes. Stone-type blocks become Token Ore, deepslate becomes Deepslate Token Ore.

Silk Touch drops the ore block. Fortune adds 0–level extra Raw Tokens. Both handled by `scripts/main.js` because Bedrock loot tables can't do it for custom blocks.

## Token gear

A tier between diamond and netherite: netherite mining speed, diamond damage and armor points, durability and enchantability in between, and none of netherite's armor toughness or knockback resistance.

| | Diamond | **Token** | Netherite |
|---|---|---|---|
| Tool durability | 1561 | **1800** | 2031 |
| Mining speed | 8 | **9** | 9 |
| Extra damage: sword / axe / pickaxe / shovel / hoe | 7 / 6 / 5 / 4 / 4 | **7 / 6 / 5 / 4 / 4** | 8 / 7 / 6 / 5 / 5 |
| Enchantability | 10 | **12** | 15 |
| Armor points: helmet / chest / legs / boots | 3 / 8 / 6 / 3 | **3 / 8 / 6 / 3** | 3 / 8 / 6 / 3 |
| Armor durability: helmet / chest / legs / boots | 363 / 528 / 495 / 429 | **385 / 560 / 525 / 455** | 407 / 592 / 555 / 481 |
| Toughness / knockback resistance | 2 / 0 | **0 / 0** | 3 / 0.1 |

The tools carry the `minecraft:diamond_tier` item tag (plus `cvc:token_tier`), so they should harvest everything a diamond tool does, Token Ore included. Anything repairs in an anvil with a Token (25% per Token) or by combining two of the same piece. Armor shows on the player and on armor-wearing mobs; the worn model uses the classic 64x32 armor sheets.

## Install

**Windows / Android / iOS:** open `CvC_TokenOre.mcaddon` — Minecraft imports both packs.

**Manual:** unzip and drop the two folders into
- Windows: `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\behavior_packs` and `...\resource_packs`
- Android: `Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs` and `resource_packs`

Then: new world → Behavior Packs → activate the BP (the RP auto-attaches).

## Test checklist

1. Settings → Creator → turn on **Content Log GUI** and **Content Log File**. Load the world. Zero errors expected.
2. Creative inventory → Nature tab → both ores. Items tab → Raw Token and Token. Equipment tab → the five tools next to the vanilla ones, the four armor pieces next to vanilla armor.
3. `/give @s cvc:raw_token 8` then `/setblock ~ ~ ~1 cvc:token_ore` — confirm textures and glow.
4. Survival: break with stone pickaxe → nothing. Iron pickaxe → 1–3 Raw Token.
5. `/enchant @s silk_touch` on an iron pick → drops the ore block. `/enchant @s fortune 3` → extra tokens sometimes.
6. Dig at y=30 and y=-40 in a fresh world → ore at both depths.
7. Smelt Raw Token in a furnace and a blast furnace → Token.
8. Craft each tool and armor piece from Tokens (and sticks) in the vanilla shapes. Put on all four armor pieces → 20 armor points, amber armor on the player.
9. Token pickaxe: stone breaks about as fast as with netherite, obsidian drops, Token Ore drops Raw Token.
10. Anvil: a damaged Token tool plus one Token repairs a quarter of its durability.

## Editing

- Textures are 16x16 placeholders in `RP/textures/blocks` and `RP/textures/items`. Replace the PNGs, keep the filenames. The worn armor is `RP/textures/models/armor/token_1.png` (helmet, chestplate, boots) and `token_2.png` (leggings), 64x32 in the vanilla layout.
- Spawn rates: `BP/feature_rules/*.json` → `iterations`. Vein size: `BP/features/token_ore_feature.json` → `count`.
- Mining speed: `BP/blocks/*.json`. Both numbers are hardness, and a break takes 1.5 × hardness ÷ tool speed seconds. `seconds_to_destroy` applies by hand or with a pickaxe below iron (10, so 15 s by hand, like vanilla iron ore). `destroy_speed` inside `item_specific_speeds` applies with an iron-or-better pickaxe (3, like vanilla iron ore: 0.75 s iron, 0.5 s netherite or Token).
- Gear stats: `BP/items/token_*.json` → `max_durability`, `minecraft:damage`, `minecraft:digger` → `speed`, `minecraft:wearable` → `protection`, `minecraft:enchantable` → `value`.
- Drop counts and which pickaxes count as "iron or better": the constants at the top of `BP/scripts/main.js`.

## Rebuilding the .mcaddon

```sh
node token-ore/build.js
```

It checks the packs first (JSON syntax, texture and loot-table paths, lang names,
feature wiring, recipe ingredients, armor attachables, the BP → RP dependency)
and refuses to build if anything is off, then writes `CvC_TokenOre.mcaddon`
with the folders renamed to `CvC_TokenOre_BP` and `CvC_TokenOre_RP`. The output
is byte-identical for unchanged sources.
