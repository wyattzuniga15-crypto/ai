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

84. **Brewing is vanilla's graph, written out.** Mojang keeps brewing in code rather than data, so
    `PotionBrewing` is transcribed here: water takes nether wart, redstone, glowstone or a fermented
    spider eye to reach the four bases; the awkward potion takes fifteen ingredients to the potions
    themselves; redstone lengthens and glowstone strengthens wherever vanilla has a long or strong
    form, and each undoes the other; a fermented spider eye corrupts a potion into its opposite; and
    gunpowder and dragon's breath change the bottle rather than what is in it. A bottle carries its
    potion as a field on the stack, so a splash bottle of the same potion is the same brew with three
    quarters of the duration and a lingering one a quarter. The stand burns one blaze powder for
    twenty brews, takes 400 ticks over each, and turns all three bottles at once. Icons are drawn the
    way vanilla draws them, the liquid tinted by the potion's colour under the glass, and the tooltip
    names the bottle and lists what it does. Mobs take the instant effects from a splash; lasting
    effects on mobs wait until mobs carry status effects of their own.

85. **Beds, banners, shulker boxes, skulls and the conduit are drawn the same way chests are.** Their
    block models are empty too, so all sixty-odd of them were invisible. Each is built from vanilla's
    own model layer and given the transform vanilla's renderer applies: a bed is drawn once from its
    head end and reaches a block further to cover its foot; a standing banner is two thirds scale and
    turned by its sixteenth of a circle, a wall banner hangs a block lower with no pole; a shulker
    box turns so its lid opens the way it faces; a skull sits in the bottom half of its block and a
    wall skull halfway up; the conduit floats in the middle and turns on the spot. Finding them uses
    the sweep that already finds chests, and the colour of a dyed banner is a material tint on the
    cloth, exactly as the icons do it.

86. **Hanging signs and cauldrons.** A hanging sign is vanilla's own model — a ten-pixel board, the
    bar it hangs from and its chains, straight when the sign is attached to the block above and
    angled when it swings from a bar — drawn at full size rather than the two thirds a standing sign
    uses, with text on both faces. Placing one under a block hangs it; placing one on a side gives
    the wall variant. A cauldron is filled and emptied a bucket at a time and a third at a time by
    bottles, washes the dye and the name off what is dipped in it, burns whoever stands in a lava
    one and puts out whoever stands in a water one, taking a level for it. Rain filling a cauldron
    waits for weather.

87. **The crafter and the lectern.** A crafter is a three-by-three whose slots can each be switched
    off with an empty hand, exactly as vanilla lets you; a signal makes one of whatever the pattern
    makes and pushes it out of the face the block points at, into a container when there is one and
    onto the ground when there is not. An item hoppered in goes to the emptiest slot that is on, so
    a line of hoppers fills the grid evenly. A lectern holds one book, remembers the page it was
    left at, and hands the book back to whoever sneaks at it. Books are read on vanilla's book
    background and written on it too, the title typed on the book itself rather than in a dialog,
    since signing turns a book and quill into a written book. Fixing the crafter turned up a
    long-standing crash: right-clicking a dispenser or dropper by hand called a behaviour that did
    not exist.

88. **The loom weaves real banners.** Vanilla's pattern list lives in code, so it is written out here:
    thirty-five patterns a dye alone can weave and ten that need their own pattern item, up to six
    layers on one banner. A layer is a pattern name and a dye colour carried on the stack, which is
    also what a placed banner keeps in its block entity and hands back when it is taken down. Each
    layer is drawn as its own piece of cloth a fraction in front of the last, tinted by its dye,
    which is how the banner ends up looking the same in the world, in the hand and on the loom's own
    pattern list. Item stacks now carry potions, book pages and banner patterns, so two that differ
    no longer stack together.

89. **The beacon.** It counts the pyramid under it the way vanilla counts one — four steps at most,
    of iron, gold, emerald, diamond or netherite, each complete or the count stops there — and the
    screen offers a tier of effects for each step, with the second column a full pyramid opens: the
    regeneration vanilla keeps for it, or a second helping of the first effect, which is what makes
    that effect stronger. Paying an ingot sets it going, and every four seconds it gives whoever is
    within ten blocks per level eleven seconds of what it is set to. The beam is drawn as vanilla
    draws it, a bright inner column and a softer outer one climbing into the sky, taking its colour
    from the last pane of stained glass the light passes through.

90. **Maps are drawn from the blocks' own textures.** Vanilla gives every block a map colour chosen
    by hand; rather than transcribe that table, each block's colour is averaged from its own top
    texture in the atlas and tinted the way the world tints it, so grass, sand and stone come out
    looking like themselves. Water and lava have no model to average, so they take the biome's water
    colour and lava's orange. The rest is vanilla's: a map is a hundred and twenty-eight pixels
    square, centred on the square the player is standing in, filled in as it is carried, and each
    pixel shaded one of four ways by how its column compares with the one to its north. A
    cartography table copies a map, zooms it out a step, or locks it so it stops filling in. Vanilla
    draws a held map in the hand; with no first-person hand to draw one in, using a map opens it as
    a page of its own.

91. **Weather runs on vanilla's two counters.** One counts down to the rain turning on or off, the
    other to the thunder, and each level eases in a hundredth a tick so the sky greys over rather
    than snapping. Rain falls as a cylinder of streaks around the player, snow where the biome is
    cold and nothing at all where it never rains; the sky and fog fade toward storm grey and the
    daylight drops by a third, which is what makes the world darken. What rain does, it does the way
    vanilla does it: a fire goes out on its own tick when it can see the sky, cauldrons fill a level
    at a time, snow settles and still water freezes in the cold, and during a storm lightning starts
    a fire where it lands, charges a creeper it hits and hurts whoever is standing too close. The
    moon's phase already showed in the sky; now it also decides whether swamp slimes come out, on
    vanilla's brightness per phase.

92. **Raids come to villages that have villagers and beds.** Vanilla tracks a village as a cluster of
    points of interest; ours looks for villagers within forty-eight blocks and a bed among them,
    which is the same village by a shorter road. A player carrying Bad Omen who walks into one has
    it taken off them and the raid begins: three waves, or up to five for a stronger omen, each of
    the mix vanilla's own table gives — pillagers throughout, vindicators from the second, a ravager
    in the third, witches in the fourth, evokers in the fifth. A bar across the top names the wave
    and shows what is left of it, the next wave waits until the last one is dead, and seeing them all
    off earns Hero of the Village.

93. **Enchantments that do something, and the bow to use them with.** Vanilla scores armour by an
    enchantment protection factor: a point a level of Protection, two for the specialised ones
    against their own damage, three a level of Feather Falling against a fall, capped at twenty and
    four percent off each. That is what the damage path now runs through, with a damage source
    threaded down to it, and absorption soaking what is left before health. Weapons take their bonus
    from Sharpness, Smite against the undead and Bane of Arthropods against the spiders, with Fire
    Aspect setting what it hits alight. The player could not shoot a bow at all, so drawing and
    loosing one is here too: vanilla's draw curve, three blocks a tick at full draw, an arrow spent
    unless the bow has Infinity, and Power, Punch and Flame on the arrow that leaves it. Mending
    takes experience into damaged gear before it reaches the bar, the boots and helmet enchantments
    change how the player swims, sneaks, walks on soul sand, freezes water, holds their breath and
    mines underwater, and the two curses do what they are named for.

94. **The status effects that were left, and the glow drawn with a stencil.** Mobs never carried
    effects of their own, so they do now: the same add-keeps-the-stronger rule vanilla uses, poison
    and wither ticking damage down, regeneration healing, and speed and slowness scaling the walk.
    Invisibility shortens the range at which a mob notices the player rather than hiding a model that
    is not drawn in first person; blindness and darkness close a radial murk over the view, and
    nausea warps the canvas. The four from 1.21 fire on death, as vanilla's do: wind charged bursts,
    weaving leaves cobwebs, oozing two slimes, infested silverfish. Glowing had no good cheap answer
    — vanilla renders the entity into its own buffer and runs an edge filter over it, which would
    mean a second render target and a full-screen pass for something usually off — so it is drawn
    with the stencil buffer instead: the model is stamped into the stencil at its own size, then
    drawn again fattened by three quarters of a pixel, painting only where the stamp is missing.
    That leaves the fringe alone, and since neither pass tests depth the outline shows through
    blocks the way the effect does. Both passes are marked transparent even though the hull paints
    solid, because three draws every opaque material before any transparent one and an opaque hull
    would run before its own stamp. Strength adds three damage a level and weakness takes four,
    slow falling swaps gravity for vanilla's 0.01 and cancels the fall. `/effect` now honours the
    selector it is given, `@e` reaching every entity, and spectral and tipped arrows finally differ
    from plain ones: ten seconds of glowing, or the potion they were tipped with at an eighth of its
    duration, which is also what a lingering potion crossed with eight arrows now crafts. Three
    effects are still unreachable, each waiting on content that does not exist yet: raid omen and
    trial omen on trial chambers, breath of the nautilus on the conduit 1.21.9 gave it to.

95. **Guardians, and the monument they keep.** The guardian model is transcribed from vanilla and
    then checked against the texture rather than trusted: laying the net of every box over
    `guardian.png` puts the 12x12x16 core, the two side plates, the plates above and below, the
    eye, the three tail segments and the tail's fin exactly where the artwork has them, which is
    also why the core's own side, top and bottom faces are transparent but for a two-pixel border.
    Only the twelve spikes are ours — four on top, four at the corners of the middle, four
    underneath — since their ring is set in code vanilla ships no data for.

    Their beam is not vanilla's renderer either. Vanilla draws glowing entities and this beam
    through buffers of their own; here the beam is two crossed quads carrying Mojang's beam
    texture, scrolling along their length, thin while the charge builds and snapping wide as it
    lands. What the beam *does* is vanilla's: eighty ticks of charge (sixty for an elder), the
    guardian holding still and its spikes flaring while it aims, the shot cancelled if it loses
    sight of what it aimed at, and the guardian's own attack damage when it lands. Reaching in to
    hit one that is holding still costs two damage to its spikes, and an elder curses everyone
    within fifty blocks with five minutes of Mining Fatigue III on its own sixty-second beat.

    The monument is placed on vanilla's own spread — spacing 32, separation 5, salt 10387313, the
    four deep ocean biomes — read out of the data files by `tools/gen-structures.ts` like every
    other structure, and it starts at vanilla's fixed y 39 so its roof comes out just under the
    sea. The building is vanilla in size (58x23x58), material, entrance, sponge room, its eight
    blocks of gold sealed in dark prismarine and its three elder guardians; the room plan on the
    eight-block grid is ours, as the mansion's is, because `OceanMonumentPieces` is a thousand
    lines of Java with no data behind it to read. Whatever the building does not fill is flooded,
    so it never leaves an air pocket under the ocean, and it is written chunk by chunk from the
    same seed, so it comes out the same however a player swims up to it.

96. **The Nether, and how a second world fits in.** A dimension is a whole world: its own terrain
    generator, its own workers, its own chunks in the save. Rather than teach one world to hold
    two, stepping through a portal throws the current one away and builds the next — the chunks
    are flushed first, the entities and block-entity renderers cleared, and a fresh `World` is
    made for the dimension being entered. Chunks are keyed by dimension in IndexedDB, with the
    overworld keeping the plain key it always had so saves made before this still load, and an
    exported world puts another dimension's chunks in a folder of their own for the same reason.

    The terrain is vanilla's shape rather than vanilla's noise router: a hundred and twenty-eight
    blocks between two sheets of bedrock, 3D noise stretched wide and squashed short so the
    caverns come out broad and low, closing over near the floor and the roof so the dimension
    stays a closed box, and everything under y 31 flooded with lava. The biomes are vanilla's own
    five climate points searched for the nearest, which is how vanilla picks a nether biome, and
    each wears what it should: nylium and fungi in the forests, soul sand and soul soil in the
    valley, basalt and blackstone in the deltas, with glowstone hanging from the ceilings, fires
    on the netherrack, quartz and gold through the rock and ancient debris buried deep where no
    air touches it.

    Portals follow vanilla's rules exactly where they are stated: an opening two to twenty-one
    wide and three to twenty-one tall inside an obsidian frame, lit by flint and steel from
    anywhere inside it, portal blocks taking the frame's own axis; eighty ticks of standing in one
    in survival and no wait in creative; x and z divided by eight going down and multiplied going
    back; a portal looked for within sixteen blocks of where the traveller comes out and one built
    for them when the search comes up empty. Coming back up the height they left at means nothing,
    so the return aims at the ground instead. The Nether hides the sun and the moon, paints
    vanilla's `0x330808` fog over everything and carries vanilla's ambient light of 0.1 laid over
    the brightness curve, so its caverns are gloomy rather than pitch black. Nothing spawns down
    there yet: its mobs come with the fortress, and overworld animals have no business in it.

97. **The Nether's own mobs.** Ten more, and every model transcribed from vanilla and then checked
    against its texture rather than trusted: laying each box's net over the artwork put the piglin's
    ten-wide head, its snout, tusks and both ears exactly where the skin has them, the blaze's head
    and rod, the magma cube's eight flat slices and its core, and the strider's body and legs. Where
    the texture could not settle it — the ghast, which is opaque across its whole net — vanilla's
    own numbers stand: a sixteen-block body with nine tentacles of vanilla's lengths, drawn at the
    4.5 the ghast renderer scales by.

    Their behaviour is vanilla's where vanilla states it. A piglin takes offence at a player with no
    gold on and leaves one wearing it alone until it is hit, which is the whole of the truce; a
    brute never cares either way. A blaze holds still, charges, and looses a round of three
    fireballs six ticks apart before a long pause, and only ever at something it can see. A ghast
    howls, charges for forty ticks and spits. Striders walk on top of their lava sea rather than
    sinking into it, and shiver when they end up ashore. Everything born down there is fireproof,
    and they spawn at any light level, as vanilla's nether monsters do, on vanilla's own per-biome
    lists — hoglins and piglins in the crimson forest, endermen and striders in the warped, ghasts
    and skeletons in the soul sand valley, magma cubes in the deltas, zombified piglins everywhere.

    One vanilla rule was missing and is now in: standing in the portal you arrived in holds its
    cooldown up rather than counting it down, so a traveller has to step out before the way back
    opens. Without it a player who arrives and stands still is sent home five minutes later, which
    is exactly what the first run of the Nether did.

98. **The fortress and the bastion, on one spread.** Vanilla puts both in a single structure set —
    the nether complexes, spacing 27, separation 4 — and picks between them by weight at each start,
    three in five to the bastion and two to the fortress. That is now a general thing here: a set
    can declare its share of a spread, and each start falls to exactly one of the structures on it,
    so the two never collide and neither is rarer than vanilla makes it.

    The bastion is vanilla's own, templates and all: its hundred and sixty-seven pieces and their
    pools go through the same jigsaw assembly a village does, built at the y its data names. What it
    needed was the beardifier — vanilla pushes terrain away from a structure with a falloff, which is
    what makes a bastion a courtyard standing in the open rather than a warren packed in solid
    netherrack. Ours clears each piece's box and six blocks around and above it, with two rules
    learned the hard way: every piece of a start is stamped before any of it is cleared around, and
    no cell inside another piece's box is ever cleared — otherwise one piece's margin eats the
    next's walls, or the chunk next door carves away the half of the structure this chunk wrote.

    The fortress is built in code, as vanilla builds it: a bridge crossing to start, then a walk of
    bridges with their fenced decks and columns dropped to the ground, corridors with windows,
    crossings, stairs, wart rooms with soul sand and a chest of vanilla's `nether_bridge` loot, and
    blaze spawner rooms with the spawner on its platform behind a fence. The plan is ours, as the
    mansion's is; the pieces are vanilla's. Wither skeletons and zombified piglins are put in as it
    is built, and the blaze spawners keep the blazes coming.

99. **Netherite, and the Wither.** Most of netherite was already standing: ancient debris smelts to
    scrap, four scrap and four gold make an ingot, and the smithing table upgrades gear with it. Two
    vanilla rules were missing and are now in — a dropped item burns up in lava or fire unless it is
    netherite (or the debris it comes from), which is the whole reason to carry a netherite pickaxe
    into the Nether; and each piece of netherite armour gives a tenth of knockback resistance, which
    is now taken off what a hit shoves the player by.

    The Wither is vanilla's: three wither skeleton skulls over a T of soul sand or soul soil, checked
    from whichever skull was placed last, and the ritual's blocks are spent when it fires. It rises
    for two hundred and twenty ticks, untouchable and healing from a third of its health to all of
    it, and then blows a hole where it was born. After that it keeps its distance, throws a skull
    from each of its three heads on its own beat — each one leaving ten seconds of Wither — and
    charges once it is armoured, which vanilla makes it below half health: everything that reaches
    it is halved, and it is never knocked about. Its bar says which of the three it is doing. Killing
    it drops the nether star, which vanilla drops in code rather than from a table.

    One bug worth recording: a Wither hovering exactly on top of what it was aiming at made a
    zero-length vector, `setLength` turned it into NaN, and the NaN position reached `getBlock`,
    where an out-of-range index quietly returned `undefined` and the first `.behavior` read threw.
    The goal now keeps a direction to fall back on, and the fluid check refuses a position that is
    not finite.

100. **The End, and the lighting bug it turned up.** The island is vanilla's own function — a
     hundred minus the distance from the middle, with any outer island whose own falloff reaches
     further, found by walking the grid of noise samples around each column — so the middle island
     comes out a hundred blocks across and the outer ones start past five hundred blocks of void.
     How thick the lens is and what the crags do to its underside are ours; vanilla's is a density
     function with nothing behind it to read. Chorus plants grow only out on the far islands, as
     vanilla leaves the middle one bare. The way in is vanilla's too: an eye of ender in each of a
     stronghold's twelve frames opens the portal, and standing in it puts the traveller on the
     obsidian platform vanilla builds at (100, 49, 0), clearing whatever was in the way; the way
     home puts them back where they sleep.

     Building it turned up a bug that had been quietly spoiling the Nether as well. The world worker
     runs chunks through terrain, decoration, lighting and meshing, and each step only runs on a
     chunk the last one finished — but nothing in the worker marked a chunk *decorated*. The
     overworld's generator happened to set that itself at the end of its own decorate, so the
     overworld was fine and nothing else was: the Nether and the End never lit a chunk, never marked
     a section dirty and so never meshed one. The Nether looked like it worked because its arrival
     chunks were meshed by the block edits the portal builder made. The step now ends in the worker,
     where it belongs, and the Nether has had its glowstone and lava lighting the rock ever since.

101. **The dragon fight.** The dragon belongs to the dimension, not to a chunk: vanilla keeps it in
     the fight's own saved state, so ours is spawned by the game whenever the End has none and the
     middle chunk is loaded, kept out of the chunk saves so a reload can never leave two of them,
     and never put up again once `dragonKilled` is set. Every crystal still standing heals it one
     health every ten ticks and draws vanilla's beam to it, and while one stands nothing can touch
     it at all — that is what makes the crystals the fight rather than the dragon. Breaking one sets
     off a power-six blast where it stood, which the obsidian pillar under it shrugs off exactly as
     vanilla's does. It circles the island at radius forty-five and dives at whoever is down there
     once the crystals are gone, is never knocked about, and rides vanilla's pink boss bar.

     The exit portal is vanilla's `EndPodiumFeature`, transcribed: the nine-wide box walked from one
     below the podium to well above it, the distance to the middle measured in three dimensions so
     the disc narrows as it climbs and clears a dome rather than a shaft, the bedrock rim, the
     four-block pillar and its four wall torches. It stands on the island from the start with an
     empty middle, and the dragon's death fills that middle with the portal, lays the egg on the
     pillar and gives up five hundred experience. Where it stands is the island's own top, worked
     out once and kept in the save the way vanilla keeps the fight's portal position, so the
     podium's own bedrock can never walk it upward.

     Two things had to be fixed to see any of it. The End portal is drawn in vanilla by a block
     entity renderer, so its model file carries no geometry at all and ours came out invisible: the
     asset scripts now fold vanilla's own starfield texture into the block atlas and synthesize the
     quad it belongs on, which is the same thing vanilla's client does in code. And a traveller was
     being ticked while the next dimension was still being built — a world with no chunks in it yet
     — so anyone crossing in survival fell through the floor and died of it before they arrived.
     They are held still until they land, as vanilla holds them.

102. **Gateways, and the poem.** The gateway the dragon's death opens sits in one of vanilla's
     twenty slots on a circle of radius ninety-six, shuffled with the world seed and taken from the
     back so a second dragon would open a second one somewhere else, inside vanilla's own little
     bedrock shrine. Stepping into it throws a traveller a thousand blocks out along the line from
     the middle of the island and opens the way back ten blocks above whatever it lands on, which is
     what vanilla does; where vanilla grows one of its own end islands if that stretch is empty,
     ours lays a small disc of end stone, because our islands come out of the chunk generator rather
     than out of a feature that can be placed on demand. Because the world streams chunks around
     whoever is playing, the traveller is moved out there first and the ground they are landing on
     is only looked for once it has arrived.

     The end poem and the credits are Mojang's own files, `texts/end.txt` and `texts/credits.json`,
     fetched by the asset script like every other asset and never committed. The screen reads them
     at runtime and plays whatever it finds: the poem with vanilla's own colour codes, the reader's
     name where `PLAYERNAME` stands, and the scrambling drawn as flickering glyphs; then the credits
     by section. With neither file there it says only that the game is over, which is the same rule
     the textures follow. It rolls the first time a traveller walks back out of a beaten End, as
     vanilla plays it once, and Escape skips it.

103. **End cities.** Vanilla builds these in code rather than through a template pool: twenty
     templates stacked by a little grammar of four sections — a house tower of one, two or three
     floors; the thin tower that rises out of its roof; the bridges that reach off a tower's landings
     to more house towers, to a fat tower, or to the one ship a city gets; and the fat tower with
     bridges off each of its middle floors. Ours is that grammar with vanilla's own offsets, each
     piece laid against the one before it in that piece's turned frame, so a whole city turns with
     the rotation its start rolled. Whether a run of the grammar is kept is vanilla's rule too: every
     section is built into a list of its own and thrown away whole if any of it lands in a piece
     another run laid, which is what stops a bridge growing through a tower. The offsets, and the
     rule that a piece's footprint runs backwards from its anchor when it is turned, were taken from
     Cubiomes, an MIT-licensed reimplementation of vanilla's world generation, rather than guessed.

     The city sites itself the way vanilla does: on the outer islands, in a chunk whose four corners
     all stand at least sixty blocks up, measured from the same island function the terrain is built
     from so the site can be judged before its chunks exist. Its chests are the `Chest` markers with
     vanilla's own treasure table under them, its shulkers the `Sentry` markers, and the `Elytra`
     marker in the ship leaves the elytra itself standing where vanilla hangs it. Vanilla hangs it in
     an item frame, which this game has no entity for yet, so for now it stands there as a dropped
     item that never rots away — the same place, and the same thing to pick up.

104. **Shulkers.** A shulker is a block with a lid: it never moves, is never knocked about, and
     nothing gravity does applies to it. It opens when a player comes within sixteen blocks and it
     can see them, and while open it fires vanilla's bullet on vanilla's own countdown — one to five
     and a half seconds apart — which does its damage and leaves whoever it hits drifting upward on
     Levitation. Shut, it carries vanilla's twenty points of armour and takes a fifth of a hit;
     open, it takes all of it, which is what makes the timing of the fight. They come only with end
     cities, from the `Sentry` markers their templates carry, exactly as vanilla spawns them.

105. **The elytra.** Vanilla's fall flying, transcribed as it is written: gravity is cut by how flat
     the wings are held (the cosine of the pitch, squared), a dive turns falling into speed along the
     line of sight, pulling up trades that speed back for height at three and a fifth times the rate,
     and the whole thing is drawn a tenth of the way toward wherever the player is looking each tick,
     with vanilla's own drag. It opens on a jump press in the air and shuts on the ground, in water,
     or when there is nothing left of the wings; it costs a point of wear a second; and flying into
     something at speed hurts for ten times the speed lost, less three, which is vanilla's kinetic
     damage. A firework rocket lit while gliding pushes along the line of sight for as long as it
     burns. Note that fireworks cannot be crafted yet, so for now a rocket has to be given.

106. **Chorus fruit and purpur.** The flower is vanilla's `ChorusFlowerBlock`: it climbs while there
     is room above and nothing growing into the sides of where it is going, dies off after four
     blocks of stem unless the whole of it stands on end stone, and branches sideways when it cannot
     climb, ageing out into a spent flower when it can do neither. What it leaves behind is a stem
     that re-reads what it is joined to whenever anything beside it changes, and that comes down the
     moment the end stone or the stem under it goes — vanilla's own rule, which is why a chorus
     plant harvests itself from the bottom. Eating the fruit throws the eater up to eight blocks in
     any direction, sixteen tries at somewhere with a floor and room to stand and nothing at all if
     none of them is safe. Smelting the fruit and crafting the popped one into purpur and end rods
     were already in the recipe data and needed nothing new.

107. **The creative menu.** Vanilla keeps the membership of each creative tab in code rather than in
     any data file, so ours sorts the item list into vanilla's own eleven tabs by what each item is:
     its behaviour, the block it places, and the family its name puts it in — a coloured block is one
     of the sixteen dye names in front of one of the coloured families, a redstone block is anything
     with a redstone behaviour or a door, a natural block is what the world lays down itself, and so
     on. Inside a tab items keep their registry order, which is close to the order vanilla lists them
     in because the registry itself was arranged that way. The assignment is therefore ours, not
     vanilla's exact list; the tabs, the search and the scroll bar behave as vanilla's do. Every slot
     in the grid is a bottomless source — taking from one leaves it there — and anything dropped back
     onto the list is thrown away, which is how vanilla's own list behaves.

     Making the menu draw every item turned up a whole class of missing icons. Since 1.21.4 an item
     whose look is chosen at runtime — a compass by its needle, a clock by the sun — has no model of
     its own, only an `items/` definition that picks between thirty-odd of them. The asset script now
     resolves such a definition down to the first model it names, which is what the icon is drawn
     from. Eleven items are still without one, all of them things vanilla draws with a block entity
     renderer: decorated pots, the dragon head and the copper golem statues.

108. **Fire, candles and coral.** Fire had only ever gone out in the rain; it now behaves as
     vanilla's `FireBlock` does. It ticks itself every thirty ticks or so, ages a step at a time up
     to fifteen, eats what it is touching — what is over and under it more readily than what is
     beside it, at vanilla's own odds — and reaches into the three-by-three box around it, less
     readily the higher the spot, leaving fire wherever something catches. A fire with nothing to
     burn needs a floor and dies once it is old; one on netherrack or soul soil never goes out; and
     rain puts out anything the sky can see. How readily a block catches and how readily it burns
     away is a pair of numbers vanilla keeps in code, so ours reads them off the families the ids
     fall into — leaves and wool thirty and sixty, planks five and twenty, logs five and five, and
     so on. A wooden house now burns down around a fire left in it.

     Two smaller stubs went with it: flint and steel lights a candle or a campfire where it stands
     rather than setting a fire beside it, and a hand puts a lit candle out; and coral with no water
     against it dies into the dead one of its kind, keeping the way it faces.

109. **Light that depends on the state, and two bugs behind it.** Vanilla works out how much light a
     block gives off from its state rather than from the block alone, and the data the game is
     generated from can only carry one number per block — the default state's. So an unlit furnace
     glowed and a lit one did not, an unlit campfire lit a room, and a lit redstone lamp did nothing.
     The registry now applies vanilla's own rule per state where there is one: the furnace family at
     thirteen when lit, campfires at fifteen and soul campfires at ten, redstone lamps at fifteen,
     redstone torches at seven, redstone ore at nine, a candle at three for each candle on it, a
     respawn anchor by its charges, a sea pickle by how many are in the water, cave vines by their
     berries, and the copper bulbs at fifteen down to four as they weather.

     Two real bugs turned up on the way. The worker owns the light engine, and nothing ever told the
     main thread what it had worked out: the copy the main thread reads — for mob spawning, for
     growing crops, for how brightly to draw a mob, for the debug readout — was whatever it had been
     when the chunk was first delivered. Each section now carries its light back as it is remeshed.
     And the light engine's spread queue trusted entries that were queued before a removal walk ran,
     so taking a torch away lit the room straight back up from the light it had just cleared: an
     entry that names light the cell no longer holds is now skipped.

110. **The three weapons that had no behaviour.** The crossbow is drawn once and then held loaded —
     vanilla's twenty-five ticks, five fewer for each level of Quick Charge — and its bolt leaves
     faster than a fully drawn bow's. Multishot throws three for the price of one arrow, ten degrees
     apart, and Piercing carries a bolt through what it hits, never through the same mob twice. A
     loaded crossbow draws itself with the bolt in it, as vanilla's own model does.

     The trident is wound up like a bow and thrown when it is let go. Vanilla leaves the thrown one
     stuck in the ground until somebody walks into it; this game has no entity for that, so it is
     handed back as a dropped item where it landed — the same place, and the same thing to pick up —
     and Loyalty hands it back at the thrower's feet instead. Channeling calls the lightning down on
     what it hits in a storm, Impaling adds two and a half points a level against anything wet, and
     Riptide throws the thrower along their line of sight rather than throwing the trident at all.

     The mace turns a fall into the blow at vanilla's own rate — four damage a block for the first
     three, two for the next five, one after that, and half a point a level a block for Density —
     throws everything within a few blocks back, and lands the wielder as if they had not fallen.
     Wind Burst throws them straight back up for another swing. Breach is the one mace enchantment
     left out: it works on the target's armour, and mobs here have none to pierce.

     A sword's sweep went in with them: swung at full reach, standing, and not landing a crit, it
     passes a point plus Sweeping Edge's share of the blow to everything beside what it hit.

111. **The last two block behaviours.** A flower pot takes whatever the hand holds that has a potted
     form of its own and gives it back to an empty hand, which is the whole of what a pot does. And
     powder snow behaves as vanilla's: it has no collision, so a walker sinks into it, falls through
     it no faster than fifteen hundredths of a block a tick, wades slowly, and puts out any fire they
     were carrying; the cold builds over a hundred and forty ticks and then bites once every two
     seconds, and any leather armour keeps it out entirely. Leather boots carry a walker over the top
     of it, and sneaking drops them in — the footing is put on for that one walker by handing their
     own collision a solid block where the snow is, since nothing else in the game treats it as one.

     That leaves no block category without the behaviour vanilla gives it. Banners, heads, portals,
     bedrock and the plain shapes have entries in the behaviour table only as categories: what they
     do, the game already does with them elsewhere — a banner is woven at a loom and drawn as a block
     entity, a wither skull is watched for where the Wither is summoned, a portal is stepped into,
     and bedrock is simply unbreakable.

112. **The performance pass.** Three things were eating the main thread, all of them found by
     timing the frame rather than by guessing.

     A chunk is meshed a section at a time and each finished section was rebuilding the whole
     column's geometry — two dozen rebuilds of a three-hundred-and-eighty-four-block column for one
     chunk arriving, twelve of them in a frame while chunks were streaming in. A column now waits
     until its sections stop arriving (eighty milliseconds, or half a second at the outside) before
     it is rebuilt, and rebuilds are given four milliseconds of a frame between them. That took the
     work the streaming does per frame from about fourteen milliseconds to two or three.

     The simulation was drawing three random ticks for every section of every chunk in range,
     whether or not the section held anything: in a normal world most of a column is sky. It now
     keeps, per chunk, which sections hold blocks at all — worked out once and forgotten whenever
     that chunk is edited, patched by the generator or reloaded — and it asks a table indexed by
     block state whether a block wants random ticks rather than looking up its behaviour. Random
     ticks went from three and a half milliseconds a tick to one and a half.

     And every chunk column carried a bounding sphere of radius two hundred and eighty about the
     middle of the world's height, which is in view from everywhere: nothing was ever culled. Each
     column is now bounded by the sections that actually hold geometry, so looking at the sky draws
     thirty-six calls where it drew nearly six hundred.

113. **Mushroom fields and windswept savanna.** These were the last two overworld biomes with data
     but no ground: the picker never returned either. Vanilla reaches mushroom fields through a
     continentalness band of its own — a strip of the deepest ocean the other biomes never claim —
     and windswept savanna through erosion, as the broken-up savanna. Ours does the same in the
     shape our own noise takes: below −0.55 continentalness a slow noise decides where an island
     stands and lifts the column out of the water for it, and the savanna branch splits on erosion
     the way the picker's other branches split on weirdness. Over ten seeds and eight thousand
     blocks either way the picker now reaches fifty-one of the fifty-five overworld biomes; the
     three that are left are the cave biomes, which are assigned underground rather than by column,
     and `the_void`, which vanilla never generates either.

     A mushroom island is nothing without its mushrooms, so `placeHugeMushroom` grows vanilla's
     two: four to six blocks of stem (one in twelve twice that) with both ends left open, and a cap
     whose six booleans say which faces wear the skin. The red one is a dome — three rings whose
     corners and middles are cut away, closed over by a solid square one ring narrower — and the
     brown one is a single flat disc of radius three with only its four corners missing. The island
     gets three attempts a chunk, weighted three red to one brown, which is the ratio vanilla's own
     selector rolls.

114. **The mooshroom.** Vanilla spawns nothing but mooshrooms in mushroom fields, in groups of four
     to eight, on mycelium, wherever the sky reaches — so that is the one spawn rule the biome has.
     It is a cow underneath: the same model and stats, milked with a bucket, bred with wheat, and
     dropping what a cow drops. A bowl held to one comes back as mushroom stew; a red one struck by
     lightning turns brown and takes no damage; shears take five mushrooms off it and leave a plain
     cow standing in its place with the same health, which is what vanilla does rather than
     changing the animal in place. The one piece left out is the suspicious stew a brown mooshroom
     serves after eating a flower, since nothing in the game stores a stew's effect yet.

     Vanilla renders the three mushrooms on its back as block models rather than as part of the
     skin, and so does this: the game bakes a `red_mushroom` or `brown_mushroom` block model and
     hangs three of them off the mob's group, two on the back and one on the shoulder, each turned
     a little. Their offsets are by eye against how a mooshroom looks in game rather than copied
     from vanilla's renderer, whose numbers were not to hand; measured against the cow model, the
     body's back sits at 1.375 blocks and the mushrooms stand from 1.30, so each rides the back
     with its stem in the fur. They are lit by the block atlas rather than by the mob's own light,
     which is the same compromise falling blocks and minecart contents already make.

115. **Audio, and the files that are not here.** Minecraft's sounds are not in the client jar: the
     jar carries `sounds.json`, which says what each event may play and at what volume, pitch and
     weight, and the ogg files themselves come off Mojang's own asset CDN through the version's
     asset index. The fetch does both — `npm run assets` lays `sounds.json` down as
     `public/sounds.json`, and `npm run assets -- --sounds` walks the asset index for the ogg files
     into `public/sounds/` — but this repository is public, so both stay gitignored with the rest of
     the fetched assets.

     That splits the work in two, and the split is deliberate. Everything that decides *what* should
     be playing is code: the definitions table with vanilla's weights, the music manager, the mood
     counter, the jukebox. Everything that actually makes a noise is either one of the sixty-one
     synthesized effects the game already had or a streamed file, and a world whose ogg files were
     never fetched picks exactly the same track and then stays quiet. Nothing is faked: no generated
     stand-in music pretends to be a record, because a made-up tune under a disc's name would be
     less faithful than silence.

     The long channel holds one sound at a time, as vanilla's does, which is why a record silences
     the music while it spins. A missing file reports itself as a track that has ended rather than
     one that never started, so the music manager waits its usual twelve to twenty-four thousand
     ticks and tries again instead of believing something is playing forever.

116. **The music manager and the cave sound.** `situationalMusic` asks vanilla's questions in
     vanilla's order — credits, then the End (the dragon's own cue while its bar is up), then
     underwater, then creative outside the Nether, then the biome's own track, then the general game
     music. The delays are vanilla's: twelve to twenty-four thousand ticks between tracks, six to
     twenty-four in the End, and a hundred ticks before the first one in a fresh world. Only the
     End's cues replace a track that is already playing, and doing so trims the wait to half the
     minimum, which is what makes music start again soon after you arrive.

     The mood is vanilla's counter rather than a timer. Every tick it looks at one random block in a
     cube eight blocks out; a block the sky and every lamp have both missed pushes the counter up by
     one part in six thousand, and anything lit drains it by a thousandth. When it fills, the sound
     plays two blocks from the listener in the direction of that block and the counter resets. The
     numbers all come from the biome files (`tick_delay` 6000, `block_search_extent` 8, `offset` 2,
     and `tick_chance` 0.0111 for a biome's additions); the Nether's five biomes swap the cave sound
     for one of their own and hum a loop besides.

117. **Records.** The `jukebox_song` registry lives in the data pack rather than in minecraft-data,
     so its twenty-one entries are a table in `tools/gen-data.ts` carrying each song's length and
     comparator signal, with the names read out of the language file — the disc a jukebox is
     spinning is announced exactly as vanilla announces it. A disc goes into an empty jukebox and
     comes back out of a full one; the record runs its own length and then stops, leaving the disc
     in the slot the way vanilla leaves it; a note comes off the top of the block once a second; and
     the sound fades over sixty-four blocks, which is the reach vanilla gives a jukebox.

     Two pieces of vanilla's jukebox are not here yet, both for the same reason: comparators in this
     game are still binary, so nothing reads the signal the table carries, and hoppers only feed
     block entities the container code knows about. The song data is right either way, and neither
     is worth widening the redstone or hopper code for in a slice about sound.

118. **The comparator that reads.** Comparators were a switch: on at fifteen or off. Vanilla's puts
     out a level, and half of what comparators are for is measuring something. Both halves are here
     now.

     `analogOutput` is vanilla's `getAnalogOutputSignal` for every block in this game that has one.
     A container is weighed the way `getRedstoneSignalFromContainer` weighs it — each stack counts
     for the fraction of its own stack limit it fills, the fractions are averaged over every slot,
     and anything at all in there is worth at least one, so a single stack in a chest reads 1 and a
     full one reads 15. A crafter is counted rather than weighed, a slot that is filled or switched
     off worth one apiece. A jukebox is worth the signal its record carries, out of the table the
     data generator writes. Composters, cauldrons, cakes, beehives, respawn anchors, lecterns and an
     end portal frame with an eye in it all hand over the level their own state already holds.

     The comparator itself follows vanilla's reading: the input is what the block behind sends this
     way (dust counts whichever way it is pointing), replaced by the analog level if that block has
     one, and looked for one block further when a solid block is in the way. Its sides are fussy in
     vanilla's own way — only dust, a block of redstone, or another diode pointing in, so a torch
     beside a comparator is ignored. Compare mode passes the input through unless a side beats it;
     subtract takes the side off. The level is worked out where it is read rather than stored in the
     block, which is what vanilla's block entity is for; a depth guard cuts a chain of comparators
     reading each other, which vanilla's stored value cuts for free.

     Nothing in this game calls out of a container when its contents move, so the last piece is a
     poll: every second tick the level each block entity would hand a comparator is worked out and
     compared with what it was, and anything that has changed wakes the blocks around it the way
     vanilla's `updateNeighbourForOutputSignal` does. Two ticks is the delay vanilla's comparator
     runs on anyway.

119. **The recipes vanilla writes in code.** Twelve of Minecraft's crafting recipes have no pattern
     to match: their result depends on what went in, so vanilla writes them as classes. Ten of them
     were missing here. They are all in `src/items/specialRecipes.ts` now, each following its own
     vanilla matcher — which items it takes, how many of each, and what it makes.

     Dyeing is the fiddly one. Vanilla does not simply overwrite the colour: `DyedItemColor.applyDyes`
     averages the dyes and whatever the leather already wears channel by channel, then scales the
     result back up so its strongest channel matches the average of the inputs' strongest channels.
     That last step is what stops a mix of dyes turning muddy, and it is why dyeing the same piece
     twice with the same dye leaves it where it was. Two recipes leave an ingredient in the grid
     rather than eating it — the banner being copied and the book being cloned — which is what
     vanilla's remaining items do, so `consumeIngredients` now takes the slots to keep.

     Map extending is the one recipe the grid cannot finish on its own: a wider map is a new map,
     and only the world keeps them. Vanilla marks the item for the server to widen; here the grid
     carries a hook the game fills in, so the map is made when the result is taken off the slot.

     Three of the recipes make fireworks, which meant fireworks had to do something. A rocket used
     while gliding still pushes the flier along; used anywhere else it now goes up, on vanilla's own
     climb — a fifteenth faster sideways every tick and four hundredths more lift — for ten ticks a
     charge plus two small rolls, and then bursts. The burst throws its sparks in the shape the star
     was made in: spheres for the two balls, a flat sheet for a burst, and vanilla's own outlines
     for the five-pointed star and the creeper's face, each in the star's colours with the fade
     colours coming out behind them.

     What the new data does not do yet is show on the blocks and items that carry it: a decorated
     pot draws plain, a decorated shield draws plain, and dyed leather is tinted in the inventory
     but nothing wears armour in this game to tint. The recipes are right; the models can catch up.

120. **Bats, squid and dolphins, and a bug they turned up.** The two emptiest parts of the world
     were the caves and the sea. Four mobs fill them in: the bat, the squid, the glow squid and the
     dolphin.

     Their models come from Mojang's own Bedrock geometry through `tools/geo-to-model.ts` — the same
     box layouts and texture nets the Java models use — rather than from anybody's memory of what a
     dolphin looks like. Two things had to be worked out on top of that. The bat's model is two and
     a half blocks tall as authored, because vanilla's `BatRenderer` draws it at 0.35 scale; ours
     does the same. And the squid's model, converted straight across, hangs its tentacles the wrong
     way, because vanilla's squid renderer flips the whole thing — our converted version reads
     right side up as it stands, so it is used as it stands.

     Getting them in also turned up a real bug. The model builder makes a child part's pivot
     relative to its parent by subtracting the parent group's position, which is fine for a child of
     a root part and wrong for a grandchild, whose parent's position had itself already been made
     relative. Every three-deep part in the game was a block and a half out of place: the dragon's
     tail tips and wing tips, the horse's saddle head, the guardian's tail segments, a bee's wing
     tips. The builder now keeps each part's absolute pivot and subtracts that instead.

     Behaviour follows vanilla's own: a bat hangs from whatever it is under until the light comes up
     over seven or somebody walks within four blocks, then flutters between spots a few blocks off;
     squid drift in slow pulses and bolt when they are hurt; dolphins swim fast, make for the
     surface for a breath, and hand a player swimming within ten blocks a hundred ticks of Dolphin's
     Grace. Spawning is vanilla's too: bats in the dark below sea level in the ambient group,
     glow squid in sunless water below thirty, and squid and dolphins with the fish when an ocean
     chunk rolls its animals, dolphins only where the water is not frozen.

121. **Turtles, foxes and goats.** Three more from Mojang's geometry, each with the one behaviour
     that makes it itself.

     A turtle remembers the sand it came from. Breeding a pair does not produce a calf on the spot
     the way every other animal does: one of them carries an egg, walks back to the beach it
     remembers, and lays a clutch of one to four there — and only on sand, which is why a turtle
     bred inland never lays. Its shell needed vanilla's own quarter turn: Bedrock's geometry stands
     the shell on edge, and Java's `TurtleModel` lays it flat with an xRot of a quarter turn on the
     body and the egg belly, with the head and the four flippers as parts of their own rather than
     children of the shell.

     A fox sleeps out the day, curled on its side with the skin vanilla gives a sleeping one, and
     wakes for a hurt or for anybody within eight blocks; awake, it keeps away from players rather
     than coming to them. A goat waits out a six-hundred-tick cooldown, then lowers its head at
     whatever has stood four to eight blocks off and charges, and the blow throws rather than hurts.

     Spawning follows vanilla's lists: turtles on beaches, foxes in the taigas and groves (white in
     the snowy ones), goats on the peaks, the snowy slopes and the meadows.

122. **Rabbits, pandas, polar bears and llamas.** The last four of the overworld's ordinary animals,
     on the same footing as the rest: Mojang's geometry for the models, vanilla's own rules for what
     they are and what they do.

     A rabbit's coat is rolled the way `Rabbit.getRandomRabbitType` rolls it — white in the snow
     with one in five splotched, gold in the desert and the badlands, and half brown, then salt,
     then black everywhere else — and it hops rather than walks, the haunches tucking and the front
     legs reaching out over each spring. A panda is born with one of vanilla's seven genes, each
     with a skin of its own, and the laziest of them lies on its back for a while at a time. A polar
     bear minds its own business until a cub within a dozen blocks is hurt, and then it comes for
     whoever did it. A llama herd shares a coat the way a horse herd shares one, and a llama that
     has been hurt spits rather than walking over to bite.

     Three of the four needed vanilla's quarter turn on the body, the same one the cow and the
     turtle need: Bedrock authors a bear's, a panda's and a llama's barrel standing on end.

123. **Six that reuse what was already here.** Not every mob needs a model of its own. A trader
     llama is a llama in the coat vanilla gives it, arriving in a pair beside the wandering trader
     with its chests showing; a skeleton horse and a zombie horse are the equine model in a bleached
     and a rotted skin; a zombie villager is the villager model in the green one, burning in the sun
     like the rest of the undead. Only the silverfish and the endermite needed geometry, and both
     ripple their segments along their length rather than walking.

     Each brought the vanilla behaviour that makes it worth having. Breaking one of the infested
     blocks lets its silverfish out, which is the whole point of them. And a zombie villager that
     something has weakened takes a golden apple and shakes for three to five minutes before
     standing up a villager again, keeping how hurt it was — vanilla's cure, minus the villager's
     memory of the prices it used to charge, which nothing here stores yet.

124. **The two golems.** Both are built rather than spawned, which is the point of them: a snowman
     on two blocks of snow, an iron golem on a T of four iron blocks, and in both cases a carved
     pumpkin placed last is what brings the thing to life. That is the same ritual the Wither
     already used, checked from the block that finishes it, so placing a pumpkin now looks for both
     shapes underneath it.

     A snowman wears its pumpkin the way vanilla renders it — a block model on the head at five
     eighths scale, turning as the head turns, which meant letting a mob's decoration hang off a
     named part rather than only off its root. It lays a layer of snow wherever it walks and throws
     snowballs that do no damage at all, because in vanilla the knock is the whole point.

     An iron golem goes for the monsters and leaves creepers alone, as vanilla's does, and turns on
     whoever hits it. What it does not do yet is belong to a village: vanilla's golems are spawned
     by villagers who are frightened, and they hand out poppies. The villages here have villagers
     but no fear, so a golem still has to be built by hand.

125. **Axolotls, frogs, tadpoles and parrots.** Four more, each with the thing that makes it worth
     meeting.

     An axolotl comes in vanilla's five colours, with blue drawn once in twelve hundred and the
     other four evenly; badly hurt in the water it rolls onto its back and plays dead for ten
     seconds, healing a heart a second while it lies there, which is the whole trick. Vanilla puts
     them in the lush caves, and since nothing here asks a cave which biome it is, they spawn in the
     same sunless underground water the glow squid use — but only over a bed of clay, which is a
     real vanilla condition and gets them into roughly the right caves.

     A frog takes its colour from how warm the swamp it hatched in is, cold, temperate or warm, and
     a tadpole is the head and tail it grew from. A parrot comes in vanilla's five colours and
     dances beside a jukebox that is playing, which needed the mob world to be able to ask whether
     there is a record spinning within three blocks — the reach vanilla gives it. It bobs from foot
     to foot until the music stops, which is exactly as much as vanilla's parrot does about it.

126. **Camels, armadillos, sniffers and allays.** Four more, again from Mojang's geometry, each with
     the one habit that identifies it: a camel folds its legs under it when nothing has come near
     for a while and stands the moment somebody does; an armadillo curls into the ball its model
     carries a second shape for, at a player or a monster within seven blocks; a sniffer noses an
     ancient seed — a torchflower seed or a pitcher pod — out of ground it can dig, and nothing else;
     an allay keeps beside whoever it belongs to, hovering a little above and to one side rather
     than sitting on their head.

     Two of the four have no natural spawn in vanilla either: a sniffer is hatched from an egg dug
     out of suspicious sand, and an allay is found caged in an outpost or a mansion, so both are
     registered and behave, and are met by summoning them rather than by walking into one. The
     camel and the armadillo do spawn, in the desert and in the savannas and badlands.

     The sniffer was checked by measuring its model rather than photographing it: at just over two
     blocks tall with all twelve of its parts and six legs where they should be, it would not sit in
     the little photo pool the other portraits use.

127. **The bogged, the breeze and the creaking.** The bogged is a skeleton with mushrooms on its
     skull and poison on its arrows, and it takes four in five of a swamp's skeletons the way a
     stray takes four in five of a snowy biome's — the same rule, one line further down. The breeze
     will not stand still: it hops in and out of a fight and throws a charge that does no damage at
     all, because the shove is what it is for.

     The creaking is the odd one. It closes on whoever is near and stops stock still the moment the
     player's own line of sight falls on it, holding whatever pose it was caught in — which meant
     restoring every part to its rest pose rather than letting the walk cycle keep running. What it
     does not have is the heart: in vanilla a creaking cannot be killed while its creaking heart
     still stands in the pale garden, and nothing here generates one, so this one dies like anything
     else.

128. **The warden.** It is blind, so nothing about it works the way the other hostiles do. There is
     no sight check and no target goal: it keeps a number, and the number is what decides. Anger
     builds while somebody is within twenty-four blocks — twice as fast inside eight — and drains a
     point a tick when they are not; a blow adds thirty-five, so one hit is not quite enough and two
     are. At eighty it hunts.

     Close up it swings for thirty. Between four and twenty blocks it stands still and winds a sonic
     boom up over thirty-four ticks, and the boom is dealt straight to the player rather than
     through the damage path, because in vanilla no wall and no armour stops one. Anything within
     twenty blocks of it is in the dark whether it has noticed them or not, which is what the
     screenshot of the fight shows: a black screen, a health bar and a chat log.

     What calls it is the sculk shrieker. Standing over one that can summon sets it off, and the
     warning level climbs; the fourth shriek brings a warden up out of the floor beside it. The
     level falls back one every ten minutes of quiet, so a careful walk through an ancient city
     never wakes one — which is exactly the tension vanilla's deep dark is built on.

129. **The last of the variants.** Seven that needed no geometry of their own: the illusioner is the
     illager model in its starry robe, firing arrows that blind; the giant is a zombie at six times
     the size, which is all vanilla's is; the happy ghast and the camel husk are a ghast and a camel
     in other skins; the parched is a desert skeleton; the tropical fish borrows the cod's shape.

     Only the pufferfish needed thought. Vanilla draws it in three sizes rather than scaling one, so
     the model carries all three and shows whichever the swelling calls for: it puffs a step every
     half second while something is within four blocks and settles a step every two seconds once
     they have gone, which is four times slower than it swells.

     That leaves three of the eighty-nine entity types with stats unimplemented — the copper golem
     and the two nautiluses, all from 1.21.9 — and sixty-six entity types that are not mobs at all:
     projectiles, boats, minecarts and the display entities.

130. **Weathering copper.** None of it was implemented: copper blocks never aged, an axe did
     nothing to them and honeycomb did nothing either. The fifteen families are read off the block
     registry rather than listed by hand — anything with an `exposed_x`, a `weathered_x`, an
     `oxidized_x` and the four `waxed_` copies weathers, which is exactly the fifteen 1.21 ships
     (the block, cut copper with its slab and stairs, chiseled, the grate, bulb, door, trapdoor,
     bars, chain, lantern, chest, the lightning rod and the golem statue). Only the `copper` family
     names its youngest age differently (`copper_block`), which is the one special case in the
     table.

     The tick is vanilla's `ChangeOverTimeBlock.changeOverTime` in full, because the neighbour rules
     are what make a copper build weather in patches rather than uniformly: every copper block
     within four by Manhattan distance is counted, a single younger one anywhere in that ball stops
     the change dead, and otherwise the chance is `((older + 1) / (older + same + 1))²` times
     `WeatheringCopper`'s own `0.05688889`. Waxed blocks are not weathering blocks in vanilla, so
     they neither hold a neighbour back nor push it on. The state properties come across unchanged,
     so a stair keeps its facing, half, shape and waterlogging as it ages.

     The axe takes vanilla's order — strip a log, then scrape one age, then take the wax off — which
     matters because it decides what an axe does to *waxed exposed copper*: the wax, not the age.
     Log stripping came along with it since it is the same method in vanilla and the `stripped_x`
     ids make it a one-line lookup. `behaviorFor` now merges the weathering random tick onto
     whatever the block already did, so a copper door still opens.

131. **The copper golem.** Built like the other two golems, from a carved pumpkin placed on a
     single copper block — and it inherits that block's age and wax, so a golem raised on weathered
     copper starts weathered and one raised on waxed copper never ages at all. The model is
     Mojang's `geometry.copper_golem`: a wide flat head with a beak in front and a lightning rod
     standing on top, on a body between two stubby legs, twenty-four pixels tall in all against a
     hitbox that stops at the head. The eyes are a second layer over the head, and both the skin
     and the eye layer follow the age.

     Oxidation is Mojang's own looping timer, `[25200, 27600]` ticks — twenty-one to twenty-three
     minutes an age, so about an hour from new copper to a statue. Reaching the fourth age is the
     end of it: the golem sets an `oxidized_copper_golem_statue` down where it stands, turned to
     the nearest quarter of its heading, drops whatever it was carrying and is gone. Honeycomb
     waxes it and stops the timer; an axe takes the wax off first and only then scrapes an age
     away, exactly as it does on a block; shears take its flower.

     The chest run is `behavior.transport_items` from Mojang's behaviour pack: it takes from the
     eight copper chests and fills ordinary and trapped ones, sixteen items a trip, preferring a
     slot that already holds the same item over an empty one, with three seconds between failed
     trips and seven between deliveries. It searches thirty-two blocks across and eight up, walking
     the block-entity index rather than scanning the world, and carries the stack in its right hand
     where Mojang's `rightItem` bone is.

     Two things had to be decided rather than read. Vanilla ships no `copper_golem_flower` texture
     in the Java assets (Bedrock has one; Java does not), so the poppy the golem picks by day is
     the flower's own block model stood on its head, cut down to the eleven pixels Mojang's flower
     geometry occupies. And nothing in the data says how a statue comes back to life, so it takes
     the same axe every other copper block does: scraping the oxidized statue — the one a golem
     seized up into — wakes the golem back up a stage lighter, at weathered.

132. **Drawing the copper golem statue.** Vanilla ships an empty block model for all eight statue
     blocks and draws them in code, so until now they were placeable and invisible — which stopped
     mattering the moment golems started turning into them. All four of Mojang's poses are
     converted the same way the mob's geometry is (standing, sitting with its arms back
     twenty-five degrees, running, and the star), and the age picks the texture off the same net.
     They stand on the floor of their block at full scale with the rod poking above it, the way the
     golem's own model overshoots its hitbox.

133. **The nautiluses.** The last two entity types with stats, and the most complicated animals in
     the game: Mojang's geometry gives them a shell in front with the body and a three-part mouth
     trailing behind, which is how the animal actually swims — backwards, on a jet. The mouth works
     open and shut as it goes, and the shell rolls with it.

     Everything about them came out of Mojang's own behaviour pack rather than being guessed at.
     They spawn one at a time in ocean biomes between y 38 and 58, at weight 25 in warm and deep
     water and 10 in the cold shallows (read here as a quarter and a tenth of the ocean roll). A
     pufferfish tames one, one try in three; after that any fish heals it, at Mojang's own worth
     per fish (a cooked salmon twelve, a raw cod four, a pufferfish two). Wild, it hunts pufferfish
     and nothing else: it picks one out at twenty-five blocks with even odds, stays angry for
     twenty seconds, and charges instead of biting — a run every four seconds that overshoots by a
     block and a half and knocks what it hits aside.

     The goal order mattered more than it usually does. Our runner gives an earlier goal first call
     on the movement slot, and `swimGoal` is always willing in water, so with the swimming first
     the charge never ran at all — the nautilus drifted about while a pufferfish sat next to it.
     Reordering to Mojang's priorities (panic, charge, tempt, breed, follow, swim) fixed it.

     `data/mobs.json` gives both nautiluses nought attack damage, which is what the wiki's table
     says; Mojang's behaviour pack gives them three. The charge is aimed at pufferfish rather than
     players, which is probably why the table leaves it out, so the three is used here and the
     override says so.

     Two gaps worth naming. Vanilla has a separate baby model and a 64×64 baby texture; ours is the
     adult at half size like every other baby here, minus the double-size head vanilla gives babies
     — a nautilus's head part is its whole shell. And the zombie nautilus has no spawn rules file in
     Mojang's pack at all, so it has no natural spawn here either: it comes from its spawn egg, and
     half of them grow coral on the shell.

134. **Riding a nautilus.** Saddled and tamed, it carries a rider, and that needed two things the
     game did not have. Steering in three dimensions: the rider's pitch became a lift on the mount's
     control, so a nautilus swims wherever whoever is on it is looking. And a speed that suits
     water: the ridden acceleration the horses use is 1.79 times the mob's speed attribute, which on
     a nautilus (0.7 in the data, a fish's number) settled at twelve blocks a tick — it shot out of
     the sea. Mojang gives a ridden nautilus 0.055 underwater, which against vanilla's water drag of
     0.8 settles at about a quarter of a block a tick; ours drags at 0.9, so the push is halved to
     0.0275 to land in the same place. It swims at about four blocks a second now.

     While it is saddled and in the water it breathes for its rider — vanilla's breath of the
     nautilus — so the air bar holds while you ride. Its saddle and the five body armours go on
     through vanilla's own nautilus screen, and the armour soaks damage on the horse ladder.

135. **The last of the structures.** Five of Mojang's thirty-four were never placed, and one more
     was placed but could never appear.

     *Nether fossils* are the simplest: fourteen skeletons of bone block, spread one every other
     chunk through the soul sand valleys — by far the densest spread in the game — dropped onto the
     first floor under a height sampled between y 32 and the roof, which is vanilla's own walk.

     *The ruined portals* were the interesting ones. All seven share a single spread, and each names
     its own biomes and its own setups, so they are emitted as variants of one entry: the biome
     picks which of the seven a start becomes, and then one of that one's setups is drawn by weight.
     The setup says where it stands (on the ground, sunk into it, under it, on the sea floor, in the
     nether), how much of its stone brick has gone mossy, and whether the whole thing is blackstone
     instead. Two of the seven — the ocean's and the nether's — were simply missing before, and the
     other five now weather the way their own files say rather than all alike: a jungle portal comes
     up four fifths mossy, a plains one a fifth. The blackstone swap maps the whole stone-brick
     family (and the plain stone, the slabs, the stairs and the wall) onto blackstone, which is the
     only reading the shared templates allow. `vines` and `overgrown`, which only the jungle and
     swamp setups set, are still not applied.

     *Trail ruins* are a jigsaw structure like a village, with one wrinkle: their start height is
     both projected to the ground and offset, so they sit fifteen blocks under whatever they are
     built on. That needed a `startYRelative` flag — every other buried structure here measures from
     y 0. Their archaeology processor is vanilla's: a fifth of the gravel weathers to dirt and a
     tenth more to coarse dirt, a tenth of the mud brick slumps to packed mud, and up to six gravel
     blocks per piece become the suspicious ones. The six are chosen from the whole piece rather
     than the part of it in the chunk being written, so neighbouring chunks agree on which they are.
     Brushing them is still not implemented, so for now they are a block rather than a dig.

     *Beached shipwrecks* were in the index all along but could never generate: both shipwreck
     structures were placed on the ocean floor, and the ground test refuses a floor at or above sea
     level, so every start in a beach biome came back empty. They are variants now too, and the
     beached one stands on the sand.

     That is every structure Mojang ships generating in the game.
