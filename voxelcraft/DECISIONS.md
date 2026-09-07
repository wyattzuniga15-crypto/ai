# Decisions

Logged as they are made, most recent last. Each entry says what was chosen and why.

1. **Project lives in `voxelcraft/` inside the `ai` repository.** The repository already hosts
   other single-file games at its root (Cube Roll, Minebreak, ...), so the Vite project gets its own
   folder rather than mixing `src/`, `data/` and `tools/` into the root.

2. **Real Minecraft textures are used, but fetched, never committed.** The owner relaxed the
   original "all art is original" rule and asked for the real 1.21.11 textures. The GitHub
   repository is *public*, so committing Mojang's PNGs would redistribute them. Instead
   `npm run assets` downloads the client jar from Mojang's public launcher CDN (or, when that is
   unreachable, the InventivetalentDev GitHub mirror of the same files) into gitignored folders
   (`.cache/`, `assets/`, `public/atlas`, `public/textures`, `public/models.json`). The game reads
   them resource-pack style from `assets/textures/block/<id>.png`. If the repo ever becomes private
   and the owner wants them committed, removing the `.gitignore` lines is all it takes. The sandbox
   this was built in could only reach the mirror, so the official-CDN path was written carefully
   but not exercised end to end.

3. **Vanilla block models and blockstates are used for rendering.** With real textures allowed,
   using the matching model JSON means every one of the 1166 blocks (stairs, fences, doors, crops,
   torches, ...) renders correctly with zero bespoke code. They travel with the textures (fetched,
   gitignored, merged into `public/models.json`).

4. **Game data comes from the vanilla data pack plus PrismarineJS minecraft-data.** The Minecraft
   Wiki was unreachable from the build sandbox, but the data pack inside the client jar (recipes of
   every type, loot tables, tags, enchantment definitions, biome definitions) and minecraft-data
   1.21.11 (hardness, blast resistance, harvest tiers, entity sizes, biomes) are the same facts in
   machine-readable form. `tools/gen-data.ts` normalises them into the `data/` files that are
   committed. Hand-written tables cover what neither source has: tool/armor stats, food values,
   mob stats, and the generator's per-biome surface configuration.

5. **minecraft-data's foods.json has wrong saturation values for 1.21.11**, so foods are a
   hand-written table (nutrition and saturation modifier per the wiki).

6. **Copper tools/armor (1.21.9+) stats are best-effort**: mining level = stone, speed 5,
   durability 190 (durability confirmed by minecraft-data), sword damage 5, armor 2/4/3/1.
   Re-verify against the wiki when it is reachable.

7. **Block-state ids match vanilla numerically.** Chunks store 16-bit global state ids using the
   same property ordering as the game (last property varies fastest), so blockstate variant keys
   from the model files apply directly.

8. **One world worker owns generation, lighting and meshing.** Keeping the authoritative chunk
   data in one place makes cross-chunk lighting and decoration simple. The main thread keeps block
   copies for physics and raycasts. A generation worker pool is a later optimisation.

9. **Chunk geometry is merged per column (one draw call per column per layer)** rather than one
   mesh per 16^3 section, to keep draw calls near 2 x (2rd+1)^2. Sections are still meshed
   independently in the worker so an edit only rebuilds one section.

10. **Atlas mipmaps are limited to 5 levels (16 px -> 1 px per tile)** with `TEXTURE_MAX_LEVEL`
    set directly on the WebGL texture, mirroring vanilla, so distant terrain does not shimmer and
    tiles never bleed into each other.

11. **Lighting uses the vanilla curve** `b = l/(4-3l)` per channel with a warm tint where block
    light dominates and a "Brightness" option that lifts the dark end, instead of the lightmap
    texture.

12. **Biome grass/foliage colours are sampled from the vanilla colormaps** using each biome's
    temperature and downfall from the data pack, with the dark forest and swamp modifiers.
    Colour blending across biome borders is not done yet.

13. **Fluids render as still source blocks** (8/9 height, flow texture on the sides). Flowing
    water/lava levels come with the fluid simulation in Phase 2.

14. **Sky light is seeded from a per-column light heightmap** and propagated by BFS across chunk
    borders; block placement/removal uses the standard remove-then-re-add flood fill.

15. **Dropped items render as billboard sprites of their inventory icon** (blocks and items alike).
    Vanilla renders block drops as small 3D cubes; this can be upgraded when the entity renderer
    exists.

16. **Fonts are system sans-serif with pixel shadows.** The bitmap font PNGs were not adopted for
    the HTML GUI because the layout uses ordinary text; readability matters more than the exact
    glyphs.

17. **The title splash is "Voxels ahoy!"** – nothing from Mojang's splash list.

18. **GUI screens are one generic slot engine plus per-screen layouts** (`src/ui/screens/`), with the
    vanilla slot coordinates from the container textures. Shift-click routing follows vanilla
    (`quickMove`), including the reversed hotbar-first fill when taking from containers.

19. **Block entities live on the main thread** (`LoadedChunk.entities`, keyed by world position)
    and are saved as JSON inside the chunk record. The worker never needs them.

20. **Shulker boxes spill their contents when broken** for now; keeping contents inside the item
    needs item components, which come with the anvil/enchanting work.

21. **The furnace lighting tick does not consume fuel time**, matching vanilla (`litTime` is
    decremented only when the furnace was already lit at the start of the tick).

22. **Block simulation runs on the main thread** (`src/world/simulation.ts`): scheduled ticks in a
    binary heap, vanilla random ticks (3 per section per tick within a 6-chunk simulation distance)
    and neighbour updates, dispatched to `src/blocks/behaviors.ts`. The worker only lights and
    meshes; edits are batched per tick into one message.

23. **Fluids follow the vanilla level rules** (amount 8 source, drop-off 1 for water and 2 for
    lava, falling columns, slope search up to 4 blocks, infinite water from two sources, lava +
    water interactions) but render as still surfaces with the level-based height; per-corner
    heights and flow-direction texture rotation are still to do.

24. **Input edges are latched per simulation tick as well as per frame.** Rendering runs faster
    than the 20 TPS simulation, so frame-cleared key/mouse edges could be missed by the tick; a
    second set (`tickPressed`, `tickClicked`) fixes that.

25. **Sleeping skips to morning after a two-second delay** without the vanilla monster check
    (there are no mobs yet) and without the wake-up animation.

26. **Bed placement uses the vanilla `part`/`facing`/`occupied` states** with the head one block
    further along the player's facing; sitting in it is not simulated.

27. **Mobs use the vanilla entity textures on re-created classic box models.** The owner relaxed
    the art rule to "use the real textures"; entity textures only make sense on the box models
    they were painted for, so `src/entities/mobTypes.ts` re-creates the classic biped, quadruped,
    creeper, spider and chicken part layouts from public knowledge of the model format. This goes
    beyond the original "original mob designs" brief item; if that is not wanted, the model
    definitions are the only thing to swap. The 1.21.5+ cow and pig textures are 64x64 but keep
    the classic net in their top half, so the classic layouts map onto them.

28. **Mob movement uses `speed_attribute^2 * 2.2` blocks/tick of acceleration**, which reproduces
    vanilla's input-vector scaling (a zombie moves about 2.3 m/s, a spider about 4 m/s). Pathing is
    straight-line steering with auto-jump; A* comes later.

29. **XP from kills and furnaces is awarded directly** instead of spawning XP orb entities for now.

30. **The world generator dressed fake surfaces under ore and dirt blobs** (grass blocks inside the
    ground), which random ticks then converted to dirt hundreds of times a second. Surfaces are now
    only stone runs directly under air or water.

31. **All sound is synthesized in code** (`src/audio/audio.ts`, Web Audio noise bursts and
    oscillators) as the brief asked; the texture exception the owner granted does not cover
    Mojang's sound files. Sounds are spatialised by simple distance falloff (16 blocks).

32. **Falling-block entities are not saved**; they land within a second, and a save in that
    window loses at most the block. Dropped items are saved with their chunk.

33. **Enchanting options are generated from a per-table seed with a small xorshift generator** so
    the preview and the applied result agree exactly, mirroring vanilla's seeded `EnchantmentMenu`.
    The obfuscated glyph text on the buttons is decorative; the tooltip reveals one enchantment
    like vanilla.

34. **Sign boards and posts are entity meshes** (the vanilla sign block models have no elements),
    rendered with the box-model builder on the real `entity/signs/*.png` textures, with the text
    on a canvas plane. Hanging signs are not placeable yet.

35. **Armor trims are stored on the stack as `{ pattern, material }` registry ids** (`bolt`,
    `lapis`), generated into `data/trims.json` from the data pack's `trim_pattern` and
    `trim_material` folders with the vanilla names and material colours. Vanilla maps ingredient
    items to materials through the `provides_trim_material` item component, which minecraft-data
    does not expose, so that eleven-entry table is hand-encoded in `tools/gen-data.ts`. Trimmed
    armor still uses the plain item icon; the tooltip shows the vanilla "Upgrade:" lines in the
    material colour.

36. **Every workstation screen hands its own slots back on close** (`returnSlots`), like vanilla's
    `removed()`; leftovers that do not fit are dropped at the player's feet. The anvil and
    grindstone screens were missing this and silently lost their inputs.

37. **Standing signs carry separate front and back text** like vanilla's `front_text`/`back_text`;
    right-clicking edits the side the player stands on (`SignBlock.isFacingFrontText`). A blank
    back draws no text plane. Glowing/dyed text is stored (`color`) but not yet editable in-game.

38. **`tools/gen-textures.ts` only fills gaps.** With the fetched assets present it generates
    nothing; without them it paints deterministic 16×16 placeholders (pattern family chosen from
    the texture name: planks, logs, bricks, ores, leaves, plants, liquids, glass, tools, items) for
    every texture `public/models.json` references, so an offline checkout renders readable blocks
    instead of the checker. It never overwrites a real texture unless `--force` is passed.

39. **Greedy meshing only merges faces whose four vertices share the same light and AO**, since a
    merged quad interpolates linearly and cannot reproduce vanilla's per-corner AO. On natural
    terrain that removes only a few percent of the vertices (AO touches almost every face), but
    flat builds, plains and cave floors collapse to a handful of quads. Vanilla's random
    blockstate variants (stone, dirt, sand, netherrack rotate or mirror their textures) are kept
    exact by default; `greedyOptions.mergeVariants` trades that variation for larger merges and is
    reserved for a future "fast graphics" option. The chunk shader repeats the tile with `fract`
    and samples through `textureGrad` so mip selection stays continuous across the repeats.

40. **Terrain generation runs in a small worker pool, everything else stays in the one world
    worker.** Raw terrain (~130 ms per chunk) is the slowest pipeline step and is pure per chunk,
    so `genWorker.ts` instances (cores minus two, one to four) generate columns and transfer the
    block, biome and heightmap buffers to the world worker over MessagePorts created on the main
    thread. Decoration, lighting and meshing need neighbouring chunks and stay single-threaded so
    the authoritative chunk data has exactly one owner. Each pool worker holds at most three
    queued requests so a moving player keeps getting the nearest chunks first.
    Measured in the software-rendered test sandbox (4 cores): time to a playable world 2.8 s → 1.9 s
    and the full render-distance-4 chunk set arrives about two seconds earlier; `options.genWorkers`
    overrides the pool size (0 generates in the world worker).

41. **Key binds follow vanilla's Controls screen**: same action names and categories, click a key
    then press the new key or mouse button, Escape leaves it "Not Bound", duplicates show in red,
    each row and the whole table can be reset. Attack/Use/Pick Block are actions bound to mouse
    buttons by default, so they are rebindable too. The pause key cannot be unbound so the menu
    always stays reachable. Only overrides are stored in `options.bindings`.

42. **Item components are plain optional fields on `ItemStack`** (`damage`, `enchantments`,
    `name`, `repairCost`, `trim`, now `contents`) rather than a generic component map; `stackable`
    compares them structurally. Shulker boxes with anything inside drop as one item carrying the
    27 slots in every game mode, exactly like vanilla's `copy_components` loot function, and hand
    them back on placement. Shulker boxes refuse other shulker boxes.

43. **Items vanilla draws with block-entity renderers get box-model icons.** Shulker boxes, chests
    (all wood/copper variants), beds, banners (tinted `banner/base` flag), shields, mob and player
    heads and the conduit are built with the mob box-model builder on their entity textures and
    rendered with the item's GUI display transform; chests use a vertical UV flip because vanilla
    draws them without the model y flip. Anything still without a drawable model (dragon head,
    decorated pot, copper golem statues) shows the magenta/black checker instead of a broken image.

44. **Mob variants share their base mob's model and voice.** Husk, drowned and stray are the zombie
    and skeleton bipeds with the vanilla overlay skins; slimes are one cube model at scale 1, 2 and 4
    (`slime`, `slime_medium`, `slime_big`) with vanilla health size², damage size and splitting on
    death; slime chunks use vanilla's Java `Random` seed mix with int32 overflow reproduced. Endermen
    are provoked by the vanilla stare test and by hits, blink with a 16-try ground search, and take
    water damage, but do not yet pick up blocks or dodge projectiles. Husks and strays replace 80%
    of zombie and skeleton spawns in deserts and snowy biomes; drowned spawn in ocean and river water.

45. **Particles are point sprites, not quads.** Block crumbs sample a random 4×4 texel patch of one
    of the block's own textures straight from the block atlas (vanilla terrain particles), and the
    sprite particles (hearts, crits, damage indicators, poofs) come from `textures/particle` packed
    into a small runtime sheet. Burning entities draw camera-facing quads through the chunk shader so
    the animated `fire_0`/`fire_1` tiles stay in step with block fire. Animal age, love, cooldown,
    shearing, colour and egg timers live in the mob's `extra` map so saves carry them without new
    fields; babies are drawn at half scale with a double-size head like vanilla's `AgeableMob`.

46. **Mob targets are either the player or another mob.** The melee goal, target loss and defence
    logic work on that union so tamed wolves can fight the mob that hurt or was hit by their owner
    and wild wolves can hunt sheep and skeletons; the ranged, creeper, slime and enderman goals stay
    player-only. Wolves pick their 1.20.5 variant skin from the spawn biome, and fish are the first
    "aquatic" mobs: no buoyancy pop, free 3D swimming to water cells, flopping and suffocation on
    land, and no persistence so schools despawn like vanilla water animals.

47. **Splash potions reuse the arrow projectile.** A thrown bottle is an `Arrow` in potion mode: it
    flies with the same arc, bursts on the first block or the player, and the game applies the
    effect with vanilla's `1 - distance/4` falloff (instant damage 6 for harming). Witches follow
    the vanilla potion table (slowness beyond eight blocks, poison while the target has eight or
    more health, weakness at close range one time in four, otherwise harming) and drink to heal or
    put themselves out. Phantoms are the first flying mobs (no gravity, 3D steering) and only
    appear through the insomnia spawner: none before 72000 ticks without sleep, then rising odds.

48. **Cave biomes are computed, not stored.** Lush, dripstone and deep dark regions come from a
    300-block noise field (deep dark additionally needs low erosion below y −8, lush needs mild
    humidity between y −24 and 64) and are evaluated at decoration time, while the chunk keeps one
    surface biome per column for tints, spawning and saves. Cave floors and ceilings inside a region
    get the biome's blocks; pointed dripstone columns use vanilla's tip/frustum/middle/base order.
    Sculk sensors and shriekers are placed but inert until redstone and the warden arrive.

49. **The lightmap keeps vanilla's brightness floor.** Fully dark cells render at 3% brightness on
    Moody and up to 13% at full brightness (vanilla's `0.96 × light + 0.03` lightmap term and the
    gamma lift), so caves read as dark rock instead of a black screen; mobs and particles use the same
    floor through `brightnessAt`.

50. **Carvers are re-derived per chunk instead of shared.** Every chunk replays the ravine walks
    seeded in the 9×9 chunks around it and keeps only the cells inside its own bounds, so the
    terrain workers never need neighbours (vanilla does the same with an 8-chunk carver radius).
    Aquifers are a simplified version of vanilla's: a mask noise leaves about half the map dry and
    a level noise floods enclosed cave air below the local table, no barrier noise. Lava lakes are
    the only remaining vanilla lake feature and are placed underground during decoration.

51. **Ravines breach the surface, and water no longer follows them down.** The canyon walk uses
    vanilla's 1% per-chunk chance and starts between y 10 and 67, and the old rule that stopped
    carving at sea level is gone, so canyons cut through hillsides and bottom out around y 20–40
    instead of hiding underground. To keep them dry, the sea fill is now an aquifer decision like
    vanilla's: a column floods to sea level only when it is under the sea or near it (the eleven
    chunk-offset samples of `Aquifer.SURFACE_SAMPLING_OFFSETS_IN_CHUNKS`, plus a short-range shore
    test because our coasts shelve gently), and otherwise fills to the local water table, which is
    below the ravine floor almost everywhere. Where two neighbouring columns settled at different
    levels, the higher water is walled off with stone, vanilla's aquifer barrier in miniature; a
    rare region of the mask noise floods to sea level throughout, which is where ravine lakes come
    from.

52. **Ores are placed after the surface rules, not before.** Vanilla runs ore blobs as features,
    long after surface rules dress the top of each column, so a gravel or dirt blob that reaches the
    surface stays buried under the grass. Ours ran before dressing, which left bare dirt and gravel
    patches all over grassy hills; moving the call after the surface pass (ores only ever replace
    stone and deepslate) restores vanilla's look and costs nothing.

53. **Entity models come from the shipped Bedrock geometry.** Java hardcodes its entity models in
    code, but Mojang publishes the same box layouts and texture nets as geometry JSON for Bedrock,
    so `tools/geo-to-model.ts` converts those into our part lists (y flip, feet at 24, boxes rebased
    onto their pivot). The horse's parts, pivots and UVs are vanilla's to the pixel; the head, neck,
    mouth, ears and mane are merged into one `head` group the way Java's `head_parts` is, so the
    look rotation tilts the whole assembly. Saddles, bridles, reins and horse armour are separate
    texture layers (`entity/equipment/...`), matching 1.21's equipment textures.

54. **Riding is a control channel on the mob, not a second physics body.** A ridden mob keeps its
    own physics and collision; the game feeds it steering (`forward`, `strafe`, `jump`) each tick and
    seats the player on its back afterwards. Ridden acceleration is `speed × 1.79`, which with the
    0.546 ground friction settles at vanilla's 4.8–14.5 blocks per second across the 0.1125–0.3375
    speed attribute, and a charged jump uses the jump-strength attribute directly (0.4–1.0, so 1.1 to
    5.3 blocks). The mount is not saved with the player: reloading a world leaves the horse standing
    where it was, saddle and all.

55. **Cats are in, but they still wait on villages.** Ocelots spawn in pairs in the jungles like
    vanilla, and can be tempted with raw fish until they trust the player, never tamed, as of 1.14.
    Cats keep every behaviour (fish tames one time in three, sitting, collars, following the owner,
    scaring creepers and phantoms), but vanilla only spawns them in villages and witch huts, so
    until those structures exist they arrive through breeding or `/summon` rather than by wandering
    the world. Making them spawn anywhere else would be less faithful, not more.

56. **The trade economy is generated, not hand-written.** Java keeps villager trades in code, but
    Mojang publishes the same economy as data for Bedrock, so `tools/gen-trades.ts` converts those
    tables into `data/trades.json`: five tiers per profession on vanilla's 0/10/70/150/250 experience
    thresholds, plus the wandering trader's pool. Legacy Bedrock item names are mapped back to their
    1.21 ids and the four trades whose items do not exist in 1.21 are dropped. Villagers pick two
    trades per unlocked tier, prices climb with demand, and a used-up trade sends the villager back
    to its job site to restock.

57. **Villagers exist before villages do.** A villager takes its profession from any job site block
    the player puts down (a composter makes a farmer, a lectern a librarian) rather than from a
    village, and the wandering trader turns up near the player for a day at a time, so trading is
    reachable now. Village-only behaviour (beds, breeding, gossip, raids and iron golems) waits for
    the structures phase.

58. **Bee nests are placed by the tree feature, and their bees are entities from the start.** A tree
    that generates in a bee biome hangs a nest on the trunk under the leaves (vanilla's chances:
    every meadow tree, five in a hundred in plains and cherry groves, two in the flowery biomes),
    and the three bees vanilla puts inside the nest are spawned as real bees bound to it the first
    time the chunk is populated. They pollinate flowers, carry the nectar home, and the honey level
    rises when they come back out, which is what a hive's `beehive` block entity tracks.

59. **Ranged mobs were aiming over the player's head.** Vanilla aims a bow a third of the way up the
    target and adds `0.2 × distance` to the vertical component; ours aimed at the eyes with half
    that arc, so skeleton and stray arrows sailed past above the hitbox and never hit anything. Both
    are now vanilla's, and the arc is scaled by the launch speed so a pillager's faster crossbow bolt
    follows the same line rather than flying high.

60. **Illagers are here; raids wait for villages.** Pillagers, vindicators, evokers (with vex
    summons and fang lines), vexes and ravagers all hunt villagers as well as the player, and
    patrols spawn from the fifth day on with a captain. Killing a captain leaves Bad Omen on the
    player, which is the raid trigger in vanilla; the raid itself needs villages, so for now the
    effect simply sits on the player.

61. **Ocean floors and badlands stripes follow vanilla's own rules.** Every ocean floor now grows
    seagrass, the cooler ones grow kelp forests, warm oceans get coral reefs with fans and sea
    pickles, and frozen oceans raise packed-ice icebergs with blue-ice cores and snow caps. The
    badlands band table is rolled once per world like vanilla's `SurfaceSystem.generateBands`:
    orange runs over plain terracotta, then yellow, brown and red bands, then white bands edged in
    light gray, so two seeds stripe differently.

62. **Structures use Mojang's own templates, fetched not committed.** The client ships every
    structure piece as an `.nbt` template, so `tools/gen-structures.ts` reads those (with a small NBT
    reader in `tools/nbt.ts`), resolves their palettes and writes compact JSON into
    `public/structures/`, gitignored like the textures. Placement follows the matching
    `structure_set`: one start per spacing×spacing region at a random offset, with the biome list
    read from the structure's own tag. A piece is rotated, fitted to the flattest ground under its
    footprint, and the terrain inside its box is carved away and underpinned, which is vanilla's
    terrain adaptation in miniature. Igloos, shipwrecks, ruined portals (with vanilla's decay) and
    pillager outposts land first; the outpost's banners tell the game where to put its pillagers.

63. **Villages are assembled by a jigsaw placer, not hand-built.** The converter keeps each
    template's jigsaw blocks (their connector name, target, pool and facing) and walks the template
    pools from every village start pool, so all five village types come across with their streets,
    houses, farms and workstations. Assembly follows vanilla: start from the town centre, shuffle
    each piece's connectors, attach a weighted pick from the connector's pool so the two jigsaw
    blocks meet face to face, and reject anything that would run into another piece — except the
    piece it hangs off, which is how a house is allowed to sit on the edge of its street. A villager
    spawns per bed (dirt paths tell a village bed from an igloo's) and takes a job from the
    village's own workstations, and a cat moves in.

64. **Structure chests are filled on the main thread, from the table the template names.** A
    template says which loot table a chest holds in one of two ways: a `LootTable` tag on the chest
    itself, or a `structure_block` in DATA mode sitting one block above it whose metadata the piece
    code reads (`supply_chest`, `map_chest`, `treasure_chest` on shipwrecks, `chest` in an igloo).
    The converter reads both and records a loot spot; the generator collects the spots it stamps and
    the worker ships them with the chunk, because the loot tables and the item registry live on the
    main thread. Chests are then created and filled on first load, scattering the rolled stacks
    through the container the way vanilla does, so a wreck's supply chest and its map chest hold
    different things and an enchanted golden axe comes out of a ruined portal already enchanted.

65. **Igloos are built the way `IglooPieces` builds them.** Half of all igloos hide a basement: four
    to eleven three-block ladder sections under the trapdoor, ending in the laboratory with its
    brewing stand, cauldron and chest. Vanilla turns each piece about its own ladder column (its
    `PIVOTS` entry), which is what keeps the shaft lined up when the igloo is rotated, so the
    generator lines the three columns up instead of copying vanilla's offsets. The basement pieces
    ship in the igloo bundle but are marked as extras, not starts, so a structure is never placed as
    a bare ladder section.

66. **A chunk writes its own part of every structure that reaches it.** Structures used to be
    stamped from the chunk they start in, writing outward through the neighbour-aware block access,
    which meant a piece landed only where chunks happened to be loaded: villages came out with
    houses missing and chests standing in chunks that never got their chest. Placement now follows
    vanilla. A chunk asks each structure set which starts lie within reach of it (a set's reach is
    its widest piece, or 128 blocks for a jigsaw structure, whose assembly wanders at most 97), the
    start is worked out once from the seed and its chunk and kept in a small cache, and the pieces
    are stamped clipped to the chunk's own columns. Nothing depends on load order any more: the same
    seed gives the same structure whichever way the player arrives, and a ruined portal's decay is
    hashed from each block's position instead of drawn in template order, so the crumbling matches
    across a chunk boundary.

67. **A village is of the type its biome calls for.** Vanilla's `villages` structure set holds all
    five village types, each with its own start pool and biome list; the game tries them in
    weighted-random order and keeps the first that belongs in the biome at the start. Ours had been
    picking a start pool at random from the set, which put sandstone desert villages in plains. The
    converter now writes one variant per structure in the set, with that structure's own biomes, and
    the generator picks the same way vanilla does.

68. **Mineshafts are walked, not stamped.** Vanilla builds them in code rather than from templates,
    so `src/world/gen/mineshaft.ts` follows `MineshaftPieces`: a room, then corridors, crossings and
    stairs branching off it, each piece placed beside the last and rejected where it would run into
    one already there, nine pieces deep at most. Placement comes from the data files like every other
    structure: spacing one with a frequency of 0.004, which is vanilla's roll in every chunk, and a
    badlands shaft is timbered in dark oak. Two things are ours rather than vanilla's. The walk is
    kept inside 80 blocks of its own room (vanilla measures that from the parent piece, which lets a
    shaft wander further than a chunk can know to ask about), and every decision inside a piece is
    hashed from the block's position instead of drawn in order, so a corridor comes out the same
    however its chunks are visited. Chests hold the abandoned mineshaft table; vanilla puts that loot
    in a chest minecart on a rail, and until minecarts exist ours stands on the floor.

69. **Spawners are block entities the generator asks for.** A mineshaft's spider corridor puts down a
    cage, and which mob it turns is part of the structure, not the block, so the channel that already
    carried chest loot from the worker now carries any block entity a structure wants: a chest with
    its loot table, a spawner with its mob. Ticking follows `BaseSpawner` — nothing happens unless a
    player is within sixteen blocks, then four attempts to place the mob in the nine-by-three-by-nine
    box around the cage, none at all once six of them are already there, and ten to forty seconds
    until the next batch. Light is ignored, as vanilla ignores it for spawner spawns, but a mob still
    needs room and a floor. Mining a spawner or an ore now drops experience from vanilla's own
    ranges, and silk touch takes the block instead.

70. **Temples are built in code, like vanilla, and shaped by eye where the Java is not.** Desert
    pyramids, jungle temples and swamp huts have no templates to convert: vanilla lays each one out
    block by block. `src/world/gen/temples.ts` does the same through the clipped writer the
    mineshafts use, so a temple straddling four chunks comes out the same however they are visited.
    The pyramid follows vanilla's own loop — a ring of sandstone per layer with the inside cut away,
    towers on the front, the orange and blue mark on the floor, and the room eleven blocks under it
    with a chest in each wall and nine TNT under the pressure plate. The jungle temple and the hut
    are faithful in what they contain (the lever puzzle and its chest, the tripwire between two
    dispensers of arrows, the cauldron and crafting table, the witch and her black cat) and
    approximate in their trim, since matching every block of the Java from memory would be guesswork.
    A pyramid or temple carries its own foundation down to the ground, so unlike a template structure
    it does not ask for level ground first, and a hut stands on stilts on the water surface the way
    vanilla puts it on the motion-blocking heightmap rather than the ground.

71. **Strongholds are walked like the mineshafts, and spread in vanilla's rings.** `strongholds.json`
    places them by concentric rings rather than a grid: 128 of them, three in the first ring about
    2000 blocks out and more in each ring beyond, so the generator works the ring positions out once
    per world from the seed and a chunk asks which of them reach it. The warren itself follows
    `StrongholdPieces` — the spiral staircase, then corridors, turns, room crossings, stairs down,
    five-way crossings, prison cells, a library and the portal room, each room placed against the
    last and rejected where it would run into one already there. Two deviations: the walk is kept
    inside 80 blocks of its staircase, as the mineshafts are, which makes a stronghold smaller than
    vanilla's sprawl (about fifteen rooms), and where a walk never finds room for the portal room it
    is hung off whatever doorway is still free rather than the whole stronghold being regenerated.
    Every stronghold has exactly one, since without it there is no way to the End. Vanilla also
    nudges each ring position toward a stronghold-biased biome; ours takes the ring position as it
    falls.

72. **Ocean ruins come as two sets sharing one spread.** Vanilla's `ocean_ruins` structure set holds
    a warm structure and a cold one, each with its own biomes and its own templates (sandstone for
    the warm seas, stone brick weathered three ways for the cold). Rather than teach one set to pick
    between two template groups, the converter writes two index entries with the same salt and
    spacing, so both land on the same starts and the biome check decides which of them builds. The
    ruin a start lands on is surrounded by four to eight more, each sunk to the sea floor under
    itself, which is vanilla's cluster. Their data markers work differently from an igloo's: the
    chest goes where the marker stands rather than below it, so the converter puts a chest into the
    template there, and a `drowned` marker becomes a mob the structure asks the main thread for,
    through the same channel that carries chest loot and spawners.

73. **A structure built at a fixed depth is hollowed out of the rock it sits in.** An ancient city is
    a jigsaw structure like a village, but its own JSON gives an absolute start height (-27) instead
    of projecting to the surface, and vanilla's terrain adaptation hollows each piece's box before
    the piece is written — without that the city is a warren packed solid in deepslate, since the
    templates only describe the buildings, not the cavern around them. The converter now carries the
    start height, the assembly's distance limit and its depth out of the structure JSON, and a piece
    of a buried structure carves its box and takes no foundation. The deep dark is a cave biome
    rather than a surface one, so a structure with a start height checks the cave biome at that depth
    for where it belongs. Buried treasure is the small cousin: one chest, walked down from the sea
    floor until the block under it is stone or sandstone, then packed in sand so nothing shows.

74. **Jigsaw connections go up and down as well as sideways.** Vanilla's jigsaw blocks can point at
    the ceiling or the floor, and a third of a trial chamber's connectors do: that is how a chamber
    hangs its spawners under a room and how a village stacks its decorations. Ours ignored them, so
    both came out sparse. A vertical connection places the child directly over or under the
    connector at whatever horizontal turn leaves room, and the overlap rule now lets a small piece
    (no more than seven blocks across) sit inside a room already placed, which is the part of
    vanilla's free-space tracking that matters: a spawner belongs inside the chamber it guards, but a
    room-sized piece still has to find space of its own.

75. **A trial chamber decides its mobs once, through the pool aliases.** Its structure JSON points
    alias names at real template pools, in groups so a chamber's ranged spawners agree with each
    other, and the converter carries those aliases across. Assembly rolls them once per chamber and
    maps every pool lookup through the result. Each spawner piece is named after the mob it holds, so
    the converter reads that name and reports the trial spawner block with it; the game gives it the
    same block entity an ordinary spawner gets. Mobs we do not have yet (breeze, bogged, silverfish)
    keep their spawners, which simply turn nothing until those mobs exist.

76. **A mansion is vanilla's rooms on our own floor plan.** Vanilla grows an irregular blob of rooms
    with `MansionGrid` and then walks it placing templates; ours lays a seven-by-seven rectangle of
    eight-block cells, fills it with the same room templates (a two-by-two hall now and then, a room
    running two cells deep, otherwise a single room), walls each floor with vanilla's flat and window
    segments, roofs it, and cuts the entrance hall into the middle of the south side. Every block
    placed is Mojang's; only the plan is ours. The mansion's chests are marked with the way they face
    (`ChestWest` and friends), so the converter puts the chest in facing that way, and its `Mage` and
    `Warrior` markers become the evokers and vindicators that live there. Fossils came the same way
    even though vanilla treats them as a feature rather than a structure: the bones are stamped a
    little rotted and their coal twin over the top at a low chance, in the three biomes whose feature
    lists mention them.

77. **Redstone follows vanilla's two kinds of signal.** A source emits a level from 0 to 15, weakly
    to everything beside it and strongly into the one block it is fixed to; a solid block strongly
    powered is charged, and anything touching that block reads the signal, which is what lets a torch
    under a block light a lamp on the far side of it. Dust is recomputed a whole network at a time:
    gather the connected pieces, take the strongest source feeding each, then let the power fall away
    one level a block. Writing the result is what wakes the doors, lamps and TNT attached to it,
    through the ordinary neighbour updates, and because the recompute is idempotent the cascade
    settles in a tick or two. Two details matter more than they look: dust carries its signal along
    the shape it is *drawn* in, so vanilla's rule that a line with nothing on the cross axis reaches
    both ways is what lets a run of dust light the lamp it ends at; and a change to anything that can
    move a signal wakes the neighbours of its neighbours, since that is how a charged block passes
    the news on.

78. **Pistons move their line in one step, and carts ride the track vanilla lays.** A piston resolves
    the run in front of it the way `PistonStructureResolver` does — twelve blocks at most, anything
    soft in the way broken, anything anchored refusing to budge — and then writes the blocks in their
    new places rather than animating them across two ticks, because nothing else in the game reads a
    half-moved block. The piston is marked extended before its head is placed, since the head checks
    for the piston the moment it lands. Rails take their shape from the rails beside them, level or a
    step up or down, with only plain rail allowed to bend round a corner, and a powered rail finds
    its signal up to eight rails along the run, which is `findPoweredRailSignal` shortened. A cart
    snaps to the line of the rail under it and keeps to its middle; a powered rail adds 0.06 to a
    moving cart and shoves a still one 0.02 away from a block at either end, exactly the two cases
    vanilla splits; a detector rail powers up under a cart and holds the pulse for a second, so a
    cart at full speed still trips it. A chest cart carries twenty-seven slots and a hopper cart
    five, a TNT cart lights on a powered activator rail and goes off like a stick of TNT, and the
    block a loaded cart carries is drawn inside it at three quarters size. Carts are saved with the
    entities of the chunk they are standing in and come back when it loads.

79. **A target scores the shot, and tripwire is walked from its hooks.** Vanilla reads where an arrow
    struck a target block and turns the distance from the middle of that face into a signal from 1 at
    the rim to 15 in the bullseye, then lets it go a second later; ours takes the same measurement
    from the point the arrow stuck and schedules the release twenty ticks out. Tripwire is a run
    rather than a block: a hook walks up to forty-two blocks the way it faces, and a run exists only
    when it ends at the hook facing back down it. Placing or breaking anything along a run restrings
    it — attachment only — while whether the wire is stood on is the game's to say each tick, so the
    two never fight each other. Anything with a body in the string powers both hooks and every piece
    of wire between them, and the signal is held for half a second after the last thing steps off.

80. **Chests are drawn the way vanilla draws them, as block entities.** The `chest` block model
    Mojang ships is empty — the game draws the chest itself with `ChestRenderer` — so a chest placed
    in this world was simply invisible, structure chests included. Chests are now built from
    vanilla's own three boxes (body, lid and the lock that turns with it) on the chest entity
    textures, single and double, plain, trapped, ender and the four copper ages, wrapped up over
    Christmas the way vanilla wraps them, with the lid swinging open while someone is looking
    inside. Finding them is the same trick the mesher uses: a lookup of every chest block state, a
    sweep of each chunk as it loads, and the ordinary block-change hook after that. The chest a
    chest minecart carries is the same model, since there is no block model to borrow.

81. **Farming is vanilla's own arithmetic.** A hoe turns exactly what vanilla's tillables turn into:
    dirt, grass and paths to farmland, coarse dirt to dirt, rooted dirt to dirt with its hanging
    roots dropped. Landing on farmland from a height tramples it back to dirt on vanilla's odds,
    the fall distance less a half. Crops grow on the chance vanilla gives them, faster on watered
    farmland, and the two flower crops finish by becoming the flower: a torchflower at its second
    stage, a pitcher plant standing two blocks tall. Bone meal moves a crop several stages, cocoa
    exactly one, and spreads the plants that spread rather than ripen — kelp and cave vines put on
    length, a sea pickle multiplies, seagrass grows tall, moss creeps over the ground around it.
    A composter takes what vanilla's list allows at the odds vanilla gives each thing, seven fills
    make it ready a moment later, and the eighth click hands the bone meal back.

82. **Fishing runs on the loot tables, not on a guess.** The bobber is thrown the way vanilla throws
    it, falls until it meets water, floats there and waits between 100 and 600 ticks, a hundred less
    for each level of Lure, then dips for a second or two: reeling in during the dip is the catch.
    What comes up is `gameplay/fishing` itself, three pools weighted by luck the way vanilla weights
    them (`weight + quality × luck`), so luck of the sea makes treasure likelier and junk rarer, and
    the treasure pool is kept for open water — the five-by-five of columns around the bobber, water
    below and air above. The catch is thrown to whoever reeled it in, gives one to six experience,
    and costs the rod a point of durability.

83. **A hopper moves one item every eight ticks, the way vanilla counts.** It pushes into whatever it
    faces before pulling from whatever is above it, and a move sets the cooldown again; a signal
    holds it still. Side matters where vanilla says it does: a furnace takes its input from above,
    its fuel from the side and gives up only the finished item through its bottom, and a composter
    takes compostables in on the same odds a hand would and hands its bone meal down when it is
    ready. Items resting in the funnel are swept up as well as ones lying on top, since our items
    fall into the hopper's middle rather than sitting on its rim. Hoppers need a block entity to
    tick at all, so one is made when a chunk is swept and whenever a hopper is placed — the same
    sweep that finds chests to draw. A hopper minecart picks up what it rolls over and empties into
    the container it is running above.
