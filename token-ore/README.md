# Claude vs ChatGPT Challenge — Token Ore (Bedrock add-on)

Namespace: `cvc`. Built for Bedrock 26.20+ (JSON format 1.26.20). No experimental toggles needed.

## What's in it

| Thing | ID | Notes |
|---|---|---|
| Token Ore | `cvc:token_ore` | Stone layer, light level 4 |
| Deepslate Token Ore | `cvc:deepslate_token_ore` | Deepslate layer, slower to mine |
| Raw Token | `cvc:raw_token` | Drops 1–3 from ore (iron pick or better) |
| Token | `cvc:token` | Smelt or blast Raw Token |

World gen: y 0–64 at 6 veins/chunk, y -64–0 at 10 veins/chunk, vein size 9, all Overworld biomes. Stone-type blocks become Token Ore, deepslate becomes Deepslate Token Ore.

Silk Touch drops the ore block. Fortune adds 0–level extra Raw Tokens. Both handled by `scripts/main.js` because Bedrock loot tables can't do it for custom blocks.

## Install

**Windows / Android / iOS:** open `CvC_TokenOre.mcaddon` — Minecraft imports both packs.

**Manual:** unzip and drop the two folders into
- Windows: `%LOCALAPPDATA%\Packages\Microsoft.MinecraftUWP_8wekyb3d8bbwe\LocalState\games\com.mojang\behavior_packs` and `...\resource_packs`
- Android: `Android/data/com.mojang.minecraftpe/files/games/com.mojang/behavior_packs` and `resource_packs`

Then: new world → Behavior Packs → activate the BP (the RP auto-attaches).

## Test checklist

1. Settings → Creator → turn on **Content Log GUI** and **Content Log File**. Load the world. Zero errors expected.
2. Creative inventory → Nature tab → both ores. Items tab → Raw Token and Token.
3. `/give @s cvc:raw_token 8` then `/setblock ~ ~ ~1 cvc:token_ore` — confirm textures and glow.
4. Survival: break with stone pickaxe → nothing. Iron pickaxe → 1–3 Raw Token.
5. `/enchant @s silk_touch` on an iron pick → drops the ore block. `/enchant @s fortune 3` → extra tokens sometimes.
6. Dig at y=30 and y=-40 in a fresh world → ore at both depths.
7. Smelt Raw Token in a furnace and a blast furnace → Token.

## Editing

- Textures are 16x16 placeholders in `RP/textures/blocks` and `RP/textures/items`. Replace the PNGs, keep the filenames.
- Spawn rates: `BP/feature_rules/*.json` → `iterations`. Vein size: `BP/features/token_ore_feature.json` → `count`.
- Mining speed: `BP/blocks/*.json` → `seconds_to_destroy` is hand time, `destroy_speed` is hardness with a pickaxe (lower = faster).
- Drop counts and which pickaxes count as "iron or better": the constants at the top of `BP/scripts/main.js`.

## Rebuilding the .mcaddon

```sh
node token-ore/build.js
```

It checks the packs first (JSON syntax, texture and loot-table paths, lang names,
feature wiring, the BP → RP dependency) and refuses to build if anything is off,
then writes `CvC_TokenOre.mcaddon` with the folders renamed to `CvC_TokenOre_BP`
and `CvC_TokenOre_RP`. The output is byte-identical for unchanged sources.
