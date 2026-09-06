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
- [ ] `tools/gen-textures.ts`: original placeholder art generator for offline use (checker fallback exists at runtime)

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
- [ ] Greedy meshing for opaque full cubes (currently culled per-face meshing)
- [ ] Worker pool for terrain generation (currently one world worker)
- [ ] Item and falling-block entities persisted in the save
- [ ] Options: keybinding editor, volume (audio not started)

## Phase 2 – survival core
- [x] Inventory screen (E): 27 + 9 slots, armor, offhand, 2x2 crafting, shift-click, drag-split, number-key swap, double-click collect, Q drop, tooltips (player preview still missing)
- [x] Crafting table 3x3 using `data/recipes/crafting.json` (shaped with mirroring/trimming, shapeless, transmute, repair)
- [ ] Recipe book
- [x] Furnace / blast furnace / smoker: vanilla fuel table, cook times, XP, lit block state, progress sprites
- [x] Chest (27), double chest (54, vanilla left/right pairing), barrel, ender chest (per player), shulker box, hopper, dropper, dispenser GUIs; contents saved with the chunk and spilled on break
- [ ] Shulker boxes keeping their contents as an item (needs item components)
- [ ] Tools/armor/durability everywhere, armor points, attack damage/cooldown (tool durability and mining speed done; armor and attacks wait for mobs)
- [x] Food: eating by holding use (32 ticks, 16 for dried kelp), nutrition/saturation, food effects, containers returned; exhaustion for sprinting, jumping, mining, regen
- [x] Status effects: regeneration, poison, wither, hunger, saturation, instant health/damage, speed/slowness, jump boost, haste/mining fatigue, resistance, fire resistance, water breathing, night vision (`/effect`); no HUD icons yet
- [x] Block behaviors: doors, trapdoors, fence gates, buttons (timed), levers, beds (two-block placement, spawn point, sleeping skips the night), ladders (climbing), snow layers (stacking, melting), falling blocks (sand, gravel, concrete powder, anvils), leaves decay, saplings grow into trees, grass/mycelium spread and decay, crops/stems/berries/cane/cactus/bamboo growth, farmland hydration, bone meal, cake, ice melting, plants and torches losing support
- [ ] Signs (text editing GUI and rendering)
- [x] Water and lava flow (sources, levels, falling columns, slope preference, infinite water, obsidian/cobblestone), buckets (fill and empty), farmland hydration
- [ ] Basic mobs with original designs: zombie, skeleton, creeper-role, spider, cow, pig, sheep, chicken; spawning by light level, despawn
- [ ] XP orbs, levels, death drops
- [ ] Sound effects (synthesized)

## Phase 3 – world depth
- [ ] All biome features (bamboo, mangrove roots, azalea, dripstone, lush caves, deep dark), 3D biomes
- [ ] Aquifers, ravines, lakes
- [ ] Structures: villages (jobs, trading), mineshafts, strongholds, temples, outposts, ruined portals, shipwrecks, monuments, mansions, trial chambers, ancient cities, igloos, witch huts
- [ ] Redstone: dust, torch, repeater, comparator, pistons, observers, levers, buttons, plates, note blocks, TNT, daylight sensor, target, rails + minecarts
- [ ] Farming: every crop, bone meal, breeding, bees, composting, fishing
- [ ] Enchanting table, anvil, grindstone, smithing table, brewing, loom, cartography, stonecutter, beacon
- [ ] Weather, moon phases affecting spawns, raids
- [ ] Every enchantment and status effect

## Phase 4 – Nether
- [ ] Portals, nether biomes, fortress, bastion, netherite, Wither

## Phase 5 – End
- [ ] Stronghold + end portal, dragon fight, credits/poem, end cities, elytra, gateways

## Phase 6 – polish
- [ ] Everything still stubbed in `COVERAGE.md`, performance pass (60 fps at 8 chunks on integrated graphics), audio, creative inventory tabs and search
