# Voxelcraft checklist

Work from this file. Take the next unchecked item, implement it, run it, check it off, commit.
Never mark something done that has not actually been run. Decisions go in `DECISIONS.md`,
coverage counts in `COVERAGE.md`.

## Phase 0 – setup and data
- [x] Vite + vanilla TypeScript + Three.js scaffold, `npm run dev` / `npm run build` (zero TS errors)
- [x] `tools/fetch-assets.ts`: Minecraft 1.21.11 textures, blockstates, models, data pack (Mojang CDN first, GitHub mirror fallback)
- [x] `tools/build-atlas.ts`: block and item atlases with animation frames and a missing-texture checker tile
- [x] `tools/build-models.ts`: merged `public/models.json`
- [x] `tools/gen-data.ts`: `data/blocks.json` (1166 blocks), `data/items.json` (1505 items), all recipe files, loot tables, tags, mobs, biomes, enchantments, effects, collision shapes
- [x] Vitest: worldgen determinism, model baking of every block state, data integrity (recipes resolve to real items)
- [x] `tools/gen-textures.ts`: deterministic original placeholder art for every texture the models reference (`npm run textures:gen` fills only missing files; `--force --out dir --sheet preview.png` for a full set)

## Phase 1 – engine (playable)
- [x] Chunk storage 16x384x16 (y -64..319), global block-state palette identical to vanilla ids
- [x] Deterministic seeded overworld generator: continental/erosion/peaks noise, rivers, oceans, beaches, 40+ biomes assigned
- [x] Caves (cheese, spaghetti, noodle), lava below y -54, deepslate layer, bedrock, ores with 1.21 y-distributions and deepslate variants
- [x] Surface rules per biome (grass/dirt, sand/sandstone, gravel, snow layers, ice, terracotta bands), trees (oak, fancy oak, birch, spruce, pine, mega spruce, acacia, jungle, dark oak, cherry, pale oak), vegetation
- [x] World worker: generation, decoration across chunk borders, lighting, meshing, time-sliced streaming, patches to delivered chunks
- [x] Flood-fill sky and block light (0-15) across chunk borders with incremental updates on edits
- [x] Vanilla model baker (parents, element rotation, variants, multipart, uvlock) and section mesher with face culling, AO, smooth light, biome tints, fluids
- [x] Renderer: texture atlas with 5-level mip chain, tile table with animated textures, custom chunk shader with vanilla light curve, fog, sky, sun/moon, day/night cycle (20 min)
- [x] First person controls: mouse look, WASD, sprint (key or double-tap), sneak (edge guard), jump, swim, creative flight (double-tap space), auto-step
- [x] Block targeting (raycast against collision shapes), selection outline, crack overlay, vanilla break times by tool tier and hardness, harvest rules
- [x] Placement with state selection (axis, facing, stairs half, slab type/double, torches on walls, ladders, waterlogged)
- [x] Loot-table drops as item entities, pickup, drop with Q, hotbar (1-9, wheel), held item name
- [x] HUD: crosshair, hotbar with rendered block/item icons, hearts, hunger, XP bar, F3 debug overlay
- [x] Survival basics: fall damage, drowning, lava, void, hunger drain and regeneration, death screen and respawn
- [x] Chat and commands: `/gamemode`, `/time`, `/tp`, `/give`, `/clear`, `/seed`, `/kill`, `/heal`, `/setblock`, `/xp`, `/spawnpoint` (`/weather`, `/locate` stubbed)
- [x] Title screen, world list, create world (name, seed, game mode), pause menu, options (render distance, FOV, sensitivity, GUI scale, brightness)
- [x] Save/load in IndexedDB (modified chunks + player + time), autosave, export/import world as .zip
- [x] Playwright smoke test: load world, break a block, place a block, run a command, open inventory, craft planks
- [x] Greedy meshing for opaque full cubes with uniform light/AO (exact vanilla look; `greedyOptions.mergeVariants` for more merging)
- [x] Worker pool for terrain generation (`genWorker.ts` pool fed over MessagePorts; the world worker keeps decoration, lighting and meshing)
- [x] Dropped items persisted with their chunk (falling blocks finish falling before a save)
- [x] Options: key binds screen (vanilla categories, click-to-rebind, Escape = Not Bound, duplicates in red, per-key and global reset), master volume

## Phase 2 – survival core
- [x] Inventory screen (E): 27 + 9 slots, armor, offhand, 2x2 crafting, player preview (default skin, follows the mouse), shift-click, drag-split, number-key swap, double-click collect, Q drop, tooltips
- [x] Crafting table 3x3 using `data/recipes/crafting.json` (shaped with mirroring/trimming, shapeless, transmute, repair)
- [x] Recipe book in the inventory and crafting table: search, craftable-only filter, pages, click to fill the grid from the inventory
- [x] Furnace / blast furnace / smoker: vanilla fuel table, cook times, XP, lit block state, progress sprites
- [x] Chest (27), double chest (54, vanilla left/right pairing), barrel, ender chest (per player), shulker box, hopper, dropper, dispenser GUIs; contents saved with the chunk and spilled on break
- [x] Shulker boxes keep their contents as an item (drop with contents, place them back, tooltip lists contents, no boxes inside boxes)
- [x] Tools/armor/durability everywhere: armor points and toughness reduce mob damage (vanilla formula), armor takes durability, attack damage and attack-speed cooldown, crits, knockback, sharpness/knockback/looting enchantment hooks
- [x] Food: eating by holding use (32 ticks, 16 for dried kelp), nutrition/saturation, food effects, containers returned; exhaustion for sprinting, jumping, mining, regen
- [x] Status effects: regeneration, poison, wither, hunger, saturation, instant health/damage, speed/slowness, jump boost, haste/mining fatigue, resistance, fire resistance, water breathing, night vision (`/effect`), HUD icons with timers
- [x] Block behaviors: doors, trapdoors, fence gates, buttons (timed), levers, beds (two-block placement, spawn point, sleeping skips the night), ladders (climbing), snow layers (stacking, melting), falling blocks (sand, gravel, concrete powder, anvils), leaves decay, saplings grow into trees, grass/mycelium spread and decay, crops/stems/berries/cane/cactus/bamboo growth, farmland hydration, bone meal, cake, ice melting, plants and torches losing support
- [x] Signs: standing and wall placement, four-line editor on placement and on use, board/post meshes with text on the real sign textures
- [x] Water and lava flow (sources, levels, falling columns, slope preference, infinite water, obsidian/cobblestone), buckets (fill and empty), farmland hydration
- [x] Basic mobs: zombie, skeleton (bow), creeper (fuse + explosion), spider (climbs, neutral in light), cow, pig, sheep, chicken; goal-based AI (wander, look, panic, target, melee, ranged, swell); burning in sunlight; vanilla light-level spawning with mob caps, 24-block minimum and despawning; animal groups on chunk generation; loot from the entity loot tables; mobs saved per chunk
- [x] More mobs, first slice: husk (hunger hit), drowned (ocean/river water spawns), stray (slowness arrows), wither skeleton (wither hit, 1.2×), cave spider (poison), slimes in three sizes that split and hop (swamps at night, slime chunks below y=40 with the vanilla seed formula), enderman (stares provoke, blinks around, water hurts)
- [x] More mobs, second slice: wolves (biome variants, pack aggression, hunting sheep and skeletons, taming with bones, sitting, collar dyes, following and blinking to the owner, defending the owner, meat healing and breeding), cod and salmon (schools in oceans and rivers, free swimming, flopping and suffocating on land)
- [x] More mobs, third slice: witches (approach to ten blocks, vanilla potion choice thrown as splash bottles with four-block falloff, drink to heal or extinguish, weight 5 in night spawns) and phantoms (insomnia spawner after three sleepless days, circling flight 20 blocks up, swooping bites for 6, burn in daylight)
- [x] More mobs, fourth slice: horses, donkeys and mules (vanilla box model from the shipped geometry, seven coats with five marking overlays, per-animal speed/jump/health rolls, taming by riding until the temper fills, feeding, saddles and horse armour as equipment layers, chests on donkeys and mules, the horse inventory screen, riding with a charged jump and the jump meter, herds in plains and savannas, horse × donkey = mule)
- [x] More mobs, fifth slice: cats and ocelots (vanilla model with the dyeable collar layer, ten cat coats, untamed cats and ocelots keep their distance, raw fish tempts them close, feeding tames a cat one time in three while an ocelot only ever comes to trust you, sitting, following the owner, creepers and phantoms keep away; ocelot pairs spawn in jungles, cats wait on villages and witch huts)
- [ ] More mobs, next: villagers, bees, illagers, nether and end mobs
- [x] XP orbs as entities (vanilla value split, attraction, pickup sound), levels, death drops
- [x] Mob sounds (ambient/hurt voices for every type), particles (block crumbs and cracks, crit and damage indicators, death poofs, hearts), fire (burning mobs draw vanilla flame billboards, player fire ticks with the first-person flame overlay, burning zombies ignite), babies (half size, big head, 24000-tick growth, follow adults, 5% of natural groups), breeding with vanilla foods/love/cooldown/XP, chicken eggs, shearing with coloured wool and grazing regrowth, milking
- [x] Sound effects synthesized on Web Audio: digging/placing by material, footsteps, hurt/death, eating, XP, pickups, explosions, bows, doors, chests, buttons, mob ambient and hurt sounds; master volume option

## Phase 3 – world depth
- [x] Cave biomes as 3D noise regions (lush caves with moss, azaleas, glow berry vines and spore blossoms; dripstone caves with stalactites and stalagmites; deep dark with sculk, sensors, shriekers and catalysts), glow lichen in every cave, azalea trees above lush caves, mangrove trees on stilt roots with propagules, bamboo
- [ ] Remaining biome features: cherry/pale garden details, coral reefs, icebergs, badlands mineshaft-free terracotta bands polish
- [x] Aquifers (global sea-level fill only near the sea, vanilla's eleven-column sampling plus a shore test; elsewhere a noise water table floods enclosed caves, with stone barriers between columns at different levels), ravines (vanilla canyon random walk, 1% of chunks, start y 10–67 so they open to the surface, carved per chunk so generation stays parallel and deterministic), underground lava lakes (1 in 8 chunks, walled where they would spill)
- [ ] Structures: villages (jobs, trading), mineshafts, strongholds, temples, outposts, ruined portals, shipwrecks, monuments, mansions, trial chambers, ancient cities, igloos, witch huts
- [ ] Redstone: dust, torch, repeater, comparator, pistons, observers, levers, buttons, plates, note blocks, TNT, daylight sensor, target, rails + minecarts
- [ ] Farming: every crop, bone meal, breeding, bees, composting, fishing
- [x] Enchanting table (bookshelf power, vanilla option costs, weighted enchantment selection, lapis and level costs), anvil (repair, combine, rename, prior-work penalty, 40-level cap), grindstone (disenchant with XP refund, combine)
- [x] Stonecutter (recipe list with selection and scrollbar, one-at-a-time and shift-click crafting)
- [x] Smithing table (netherite upgrade, armor trims with vanilla pattern/material tooltips)
- [ ] Brewing stand, loom, cartography table, beacon, lectern, crafter
- [ ] Weather, moon phases affecting spawns, raids
- [ ] Every enchantment and status effect

## Phase 4 – Nether
- [ ] Portals, nether biomes, fortress, bastion, netherite, Wither

## Phase 5 – End
- [ ] Stronghold + end portal, dragon fight, credits/poem, end cities, elytra, gateways

## Phase 6 – polish
- [ ] Everything still stubbed in `COVERAGE.md`, performance pass (60 fps at 8 chunks on integrated graphics), audio, creative inventory tabs and search
