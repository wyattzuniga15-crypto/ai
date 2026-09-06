# Coverage

Counts of Minecraft Java 1.21.11 content that is fully working, partially working, or only
registered (data present, no behavior). Regenerate the data counts with `npm run data`
(`data/summary.json`).

| Category | Total in data | Working | Partial | Stubbed / registered only |
| --- | ---: | ---: | ---: | ---: |
| Blocks (registry, model, placement, breaking, light) | 1166 | 1166 render + break/place | ~250 need behavior (doors, containers, redstone, crops, fluids flow) | – |
| Block behaviors (`behavior` field) | 43 kinds | solid, plant (support), log, ore, leaves (decay), sapling (growth), slab, stairs, torch (support), glass, pane, fence, wall, carpet, snow_layer (stack/melt), container, furnaces, crafting table, falling, fluid (flow), crop (growth), spreading, farmland, door, trapdoor, fence_gate, bed, button, lever, climbable, ice (melt), growing (cane/cactus/bamboo) | workstation (crafting table only), pressure_plate (support only), decoration | redstone, sign, banner, head, candle, coral, fire, portal, unbreakable |
| Items | 1505 | block items (1020) place; tools affect break speed/harvest and lose durability; 40 foods edible with effects; buckets; bone meal | armor (data only, no damage reduction yet) | ~430 non-block items need behaviors |
| Crafting recipes | 1058 shaped/shapeless/transmute + 12 special | 1058 craftable in the inventory / crafting table; repair item special | – | 11 special recipes (dye, fireworks, maps, books, banners...) |
| Smelting / blasting / smoking / campfire | 73 / 25 / 9 / 9 | furnace, blast furnace, smoker fully working | – | campfire cooking |
| Stonecutting / smithing | 254 / 30 | 0 | – | all |
| Loot tables | 1085 blocks, 158 entities, 121 chests, gameplay/archaeology | block drops (silk touch, fortune, block-state conditions) and entity drops (killed-by-player, looting, cooked when burning) | – | chest/gameplay tables unused |
| Mobs | 157 entity types (91 with stats) | 8 (zombie, skeleton, creeper, spider, cow, pig, sheep, chicken) with AI, spawning, loot, combat | – | 149 |
| Biomes | 65 | 48 placed by the generator with surfaces, colours and vegetation | rest have colours/data only | nether/end (no dimensions yet) |
| Enchantments | 43 | efficiency, silk touch, fortune, unbreaking honoured in mining/drops | – | rest |
| Status effects | 40 | 16 (regeneration, poison, wither, hunger, saturation, instant health/damage, speed, slowness, jump boost, haste, mining fatigue, resistance, fire resistance, water breathing, night vision) | – | 24 (mostly need mobs, combat or visuals) |
| Structures | 0 | – | – | – |
| Dimensions | 3 | overworld | – | nether, end |
| GUI screens | – | title, world select/create, pause, options, death, chat, HUD, inventory, crafting table, furnace family, chest/double chest/ender chest/barrel/shulker/hopper/dropper/dispenser | – | anvil, enchanting, grindstone, smithing, brewing, cartography, loom, stonecutter, beacon, trading, recipe book, creative tabs |
| Commands | – | gamemode, time, tp, give, clear, seed, kill, heal, setblock, xp, spawnpoint, effect, summon, butcher | weather, locate (messages only) | – |
