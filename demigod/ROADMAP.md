# ROADMAP — Demigod: Chronicles of Olympus

Scoped to the **v1.0 cut** agreed in `DECISIONS.md` (D-20): eight parents — Poseidon, Zeus, Hades,
Athena, Ares, Apollo, Hermes, Hecate — the Books 1–2 monster roster, and three places: Camp
Half-Blood, the Underworld, the Labyrinth. Everything else is on the post-1.0 track at the bottom
of this file.

Each phase has an **acceptance criterion testable by someone other than the author**. A phase is
not done when the code compiles; it is done when the stated condition is demonstrably true in a
running game.

Three rules govern this roadmap:

1. **Never stub.** The scope cut has already happened — that was D-20's job. From here, cutting
   further means removing a row, never half-building one. Per D-04 this covers *behaviour*, not
   *appearance*: a monster whose fight is finished against placeholder geometry is done; a monster
   whose fight is unfinished is not, however good it looks.
2. **Every phase ends with a report**: what shipped, what is configurable, what is fragile, what
   is next.
3. **A phase does not start until the previous phase's acceptance criterion passes.** The single
   exception: art production against the Phase-N briefs runs in parallel with Phase N+1's logic.

---

# v1.0

## Phase 1 — Skeleton

> **Partially delivered.** The Minecraft-free `core/` domain model is built and passing (51 tests,
> `tools/verify-core.sh`), and the Gradle/`mods.toml` scaffolding is written. The rest of Phase 1
> is blocked in the development environment: `maven.neoforged.net`, `libraries.minecraft.net` and
> `piston-meta.mojang.com` are denied by egress policy, so ModDevGradle cannot resolve Minecraft
> and `gradlew build` has never been run. See `README.md`.


| Item | Detail |
|---|---|
| Gradle | ModDevGradle on **Minecraft 1.21.11 / NeoForge 21.11** (D-02), `runClient` / `runServer` / `runData` / `runGameTestServer` |
| Registries | Every `DeferredRegister` holder from ARCHITECTURE §3, empty but wired |
| Custom registries | `chronoly:ability`, `:fatal_flaw`, `:god`, `:energy_profile`, `:mist_substitution`, `:monster_table`, `:prophecy_fragment` created and loading |
| Config | All three `ModConfigSpec`s with the `ChBalance` cached view |
| Datagen | Provider skeletons for every generator; `src/generated` committed |
| CI | `gradlew build` + `runData` + `git diff --exit-code src/generated` |
| Docs | `LORE_REFERENCE.md` and `BALANCE.md` created with their table headers and citation format |
| Art pipeline | `art/requests/` created with the template D-04 specifies: silhouette intent, required animation names, bone names, scale, source passage |
| Render funnel | `client/render/pipeline/` created — the single place custom `RenderSetup`s are built, per ARCHITECTURE §17.2 |
| Platform spikes | The six things the 1.21.11 primer is silent on (ARCHITECTURE §17.6), each stood up for real |

**Done when:** `gradlew build` is clean from a fresh clone with no manual steps; the mod loads on
client and dedicated server; `/chronoly` reports the mod version; CI is green **and** demonstrably
fails on a deliberately stale datagen commit.

**And — the 1.21.11 spikes pass.** The migration primer says nothing about six APIs this
architecture leans on, so Phase 1 proves each one on the real version before any content sits on
top of it: an empty `DeferredRegister` loading, a `CustomPacketPayload` round-tripping, an
attachment persisting across a restart, a trivial custom `ChunkGenerator` generating, a datapack
damage type applying, and a GameTest passing. Plus one **GeckoLib-animated test entity** playing a
looping and a triggered animation and surviving a relog — the 1.21.11 GeckoLib build is an alpha
(D-03) and that bet gets tested in Phase 1, not in Phase 7 with sixteen monsters riding on it.

## Phase 2 — Ability framework

The engine, with no content in it.

- `Ability` / `AbilityInstance` / `AbilityContext` / `AbilityPhase` / `AbilityExecutor`.
- Traits: `Charged`, `Channeled`, `Toggled`, `Sustained`, `Committed`, `Aimed`, `PvpScaled`.
- `DemigodData` attachment with codec, `schemaVersion`, and the upgrade chain — **from the first
  commit**, not retrofitted.
- Payloads: `AbilityInput`, `DemigodSnapshot`, `DemigodDelta`, `AbilityFeedback`, `ScreenEffect`.
- Keybinds, hold-to-charge input, radial ability wheel.
- HUD: energy arc and cooldown ring.
- One deliberately trivial test ability, `chronoly:test_spark`, **deleted at the end of Phase 5**.

**Done when:** `test_spark` charges on hold, releases early at reduced effect, costs energy, enters
cooldown, syncs to the HUD, survives a server restart with its cooldown intact, and a second player
sees its `AbilityFeedback` without seeing the caster's private state. GameTest covers every phase
transition including CANCEL from each.

## Phase 3 — Progression

Claiming, Favor, Divine Energy, Fatal Flaws — the whole loop, with placeholder art.

- Claiming triggers (first monster kill / Favor threshold / brazier offering), the ceremony
  payload, `/chronoly claim`. Weighted random assignment, Big Three at 3% combined (D-15).
- `FavorLedger` with every gain and loss from brief §4.2, each a config coefficient.
- `EnergyProfile` predicate evaluation for all eight v1.0 parents, including Athena's
  observed-enemies ring buffer — the one stateful profile.
- Overdraw, the Exhaustion effect, the screen-edge vignette.
- Fatal Flaws as real double edges, full table in `BALANCE.md`.
- Favor HUD bar, fading unless changing.

**Done when:** a fresh player can be claimed, gain and lose Favor through at least six distinct
reasons, cross a tier threshold, drain into overdraw and feel it, and demonstrate their flaw both
helping and hurting them — all in one 20-minute session with no items in the game yet. Save/load
round-trip GameTest passes for every field.

## Phase 4 — Materials and the Mist rule

The mod's most important combat rule, before anything depends on it.

- Celestial Bronze, Imperial Gold, Stygian Iron, Greek Fire, Mist-glass, drachmas: items, sources,
  forging recipes, tool/weapon/armor sets.
- Stygian Iron's essence absorption as a growing `DataComponent`.
- `MistCombatResolver` and the full ARCHITECTURE §7.1 matrix, with `mortal_steel`-by-exclusion.
- Phase-through VFX and sounds; `FirstTimeLesson` for each direction of the rule.
- Ambrosia and Nectar: the burn counter, its decay, the golden-fire death, its HUD element.
- **Prototype the D-09 render-time substitution here**, before Hecate or the monsters depend on it.

**Done when:** the bronze-passes-through-mortals rule works in **both** directions, verified by a
GameTest covering every cell of the matrix; a player who strikes a villager with celestial bronze
and a monster with an iron sword receives each diegetic lesson exactly once; overdosing on ambrosia
kills you; and the Mist substitution prototype survives dimension change, chunk unload, and a
player relogging.

> If the schedule slips, protect this phase. It is the earliest point at which the mod is
> recognisably *this* mod rather than a powers mod.

## Phase 5 — The seven ability trees

Poseidon, Zeus, Hades, Athena, Ares, Apollo, Hermes — every tier, to the brief's §5 contract.

Ordered so the shared `sim/` classes land earliest and get the most reuse:

1. **Poseidon** — builds `FluidVolume` (reused by Whirlpool, Hurricane, Charybdis, Demeter later).
2. **Zeus** — builds `ChargeGraph` and `ThunderCue` (reused by Storm Call, Clarisse's spear).
3. **Hades** — builds `LightSampler` / `ShadowGraph` (reused by Hecate and the Underworld).
4. **Athena, Ares, Apollo, Hermes** — compose the existing sims plus `HeatField`.

Per ability, before merge: the physical model written down, coefficients in `BALANCE.md`, a custom
particle type for signature abilities, custom sounds, camera work, a GeckoLib pose bound to names
fixed in its art brief, an explicit PvP coefficient, and a GameTest.

**Done when:** every ability in brief §5.1–5.6 and §5.8 is finished to that contract,
`test_spark` is deleted, and a mixed-parentage party of four can fight for ten minutes with
`/chronoly profile` reporting server overhead inside budget.

**Abuse vectors requiring explicit sign-off in this phase:** Blink and Traveler's Road (claim-mod
and border bypass), Fissure (D-07 — ships off for players), Curse of Achilles (D-08 — ends in
blessed water, mortal point relocates per bath), Shadow Travel through walls into protected regions.

## Phase 6 — Hecate and the Mist manipulation layer

Hecate is in the v1.0 cut because she *is* the Mist, and shipping the Mist as a combat rule that
nobody can bend would ship the mod without its thesis.

- Mistform, Witchlight, Words of Power (`skotos`, `pyr`, `phobos`, `lyse` — each with a distinct
  incantation sound and distinct VFX), Crossroads Step, Enchanter, Veil of Night.
- The full glamour path on top of the Phase 4 substitution prototype: disguise a player, hide a
  structure, make a monster look like a cow — server-authoritative throughout.
- Athena's *Pierce the Mist* becomes meaningful here and gets its counterplay test.

**Done when:** a Hecate child can hide a base from another player who has not pierced the Mist,
that player can pierce it and see the truth, and the server's answer is identical for both — no
client ever disagrees with the server about what exists.

## Phase 7 — Monsters, Books 1–2

Minotaur, the Furies, Medusa, the Chimera and Echidna, hellhounds, Cerberus, Charon, Procrustes;
Colchis Bulls, the Hydra, Scylla, Charybdis, the Sirens, Polyphemus, Circe, Laistrygonians.

Every monster: telegraphed attacks with real counterplay, lore-accurate behaviour, custom sounds,
golden-dust dissolution, a Tartarus reformation timer, and `MonsterMemory` so notable monsters
remember you. Animation rigged against its art brief (D-04).

The signature mechanics are the acceptance criteria, not decoration:
- **Hydra** — cut a head, two grow back, unless the stump is cauterised with fire.
- **Medusa** — a real look-away mechanic checking your actual view vector.
- **Charybdis** — a genuine whirlpool hazard built on `FluidVolume`.
- **Sirens** — an audio illusion showing each player what *they* want most.
- **Circe** — real transformation, reversible.

**Done when:** each monster is distinguishable in combat with your eyes shut to its model — the
fight differs because the mechanic differs. Reformation verified across a server restart.

## Phase 8 — Camp Half-Blood, scent, and onboarding

- Camp as a hand-authored generated structure: 20 architecturally distinct cabins, the Big House
  with the attic Oracle, the dining pavilion and braziers, the arena, the forges, the strawberry
  fields, the lava climbing wall that slams shut, the canoe lake, Thalia's Pine and the Fleece, the
  armory, Bunker 9. One coastal plains/forest location per world.
  *(All 20 cabins are built even though 8 are playable — the empty ones are the post-1.0 track's
  foundation and their absence would be conspicuous.)*
- `ScentModel` and the `SpawnDirector`: lore-appropriate spawns scaled to tier and biome. High
  scent means digging down does not save you; low scent means near-invisibility.
- `WardRegistry`: camp's borders and craftable wards zero out scent inside their radius.
- **Satyr onboarding** — satyrs smell unclaimed demigods, seek them out, escort them to camp. The
  primary onboarding path. **No tutorial book.**

**Done when:** a brand-new player given no instructions is found by a satyr, escorted to camp,
claimed, and trained — observed end to end by a tester who has not read the docs. The phase report
publishes real spawn-director numbers at 1, 5, and 20 players.

## Phase 9 — The Underworld

The Styx, Charon's ferry, the EZ-Death line, Cerberus, the Judgment Pavilion, Asphodel, Elysium,
the Isles of the Blest, the Fields of Punishment as themed challenge rooms, Hades' palace,
Persephone's garden, and the gate to Tartarus (locked in v1.0 — it opens on the post-1.0 track).

- Death routes here as a shade instead of the respawn screen; D-05 governs items in both
  keep-inventory branches.
- Judgment from `LifetimeRecord`.
- Escape as a real 5–15 minute loop: bribe Charon with a drachma, slip past Cerberus, find the
  exit — or wait out the timer.
- Elysium buff on return, Punishment curse, three Elysium lifetimes unlocking the Isles.
- Bathing in the Styx grants the Curse of Achilles with its hidden mortal point (D-08).

**Done when:** dying is a story rather than a menu — a tester dying with a bad record and one dying
with a good one have visibly different experiences, and both can get out. Dimension-transition
GameTests confirm no attachment state is lost in either direction.

## Phase 10 — The Labyrinth

The technical centrepiece.

- Custom `ChunkGenerator` over a logical `MazeGraph` in `SavedData`; chunks realise the graph, the
  graph is never read back from chunks.
- Corridors rearrange behind you — mutations apply only to chunks with no players in or adjacent.
- **Distance mismatch** — 100 blocks in, 10,000 blocks away on exit, from graph distance × anchor
  scale, never from in-dimension coordinates.
- Navigable only with Ariadne's String, a clear-sighted mortal companion, or Daedalus' workshop.
- Entrances generate as `Δ`-marked cracks anywhere.
- Procedural corridors mixed with authored set-pieces: Antaeus' arena, the ranch, the workshop,
  Hephaestus' forge, Calypso's exit, the Sphinx's chamber, bone-filled dead ends.
  *(Antaeus and the Sphinx get their full boss mechanics here rather than waiting for the Book 4
  roster — their rooms would be empty otherwise.)*

**Done when:** the distance mismatch and the shifting walls both demonstrably work; Ariadne's
String reliably navigates a maze a player without it gets lost in; generation is deterministic for
a fixed seed; a player is never stranded by a shift; and the phase report publishes generation
timings, not adjectives.

## Phase 11 — Economy and communication

- Golden drachmas as currency — monster drops, denominations, Charon's fare.
- **Iris-Messaging** as the D-10 stylised scrying view, one drachma per message, text styled as
  speech. Voice stays a post-1.0 soft-dep.
- **Hermes Express** — cross-dimension item delivery with a fee and a distance-proportional delay,
  George and Martha complaining about rats.
- Hermes waystations tying into the Phase 5 Courier's Network.

**Done when:** two players in different dimensions can find each other, talk, and send an item, and
the whole loop costs drachmas they had to earn.

## Phase 12 — Prophecy and quests

- The Oracle in the Big House attic.
- `QuestPlanner` → objective set → `ProphecyGrammar` → five lines, two rhyming couplets plus a
  final line. The text is a **view** of the objectives, never their source.
- Quest parties of three, with a satyr or summoned ally filling the third slot for solo players.
- Travel, defeat or outwit, retrieve, return before a deadline — with real failure consequences.
- Prophecy tracker HUD.

**Done when:** 200 consecutively generated prophecies are all scannable as verse, correctly
rhymed, and mechanically solvable — verified by an automated run over the generator — plus a human
read of a random 20 for voice.

## Phase 13 — Polish and ship

**Re-check the compat matrix first** — Patchouli, Jade and EMI had no 1.21.11 builds when D-02 was
taken, and if Patchouli still doesn't, the guidebook ships as a mod-native book with the same
authored content (the writing is the deliverable; the renderer is not).

Particle systems audited against the 400-per-instance budget; the full original sound set with
subtitles, attenuation, reverb tags, distance-delayed thunder, and per-god leitmotifs; camera work;
HUD layout and repositioning; the Patchouli guidebook in the books' voice; JEI/EMI, Curios, and
Jade/WTHIT integrations; advancement titles in the Riordan register; a balance pass ability by
ability with PvP coefficients reviewed individually; and the README stating this is unofficial fan
work (D-21).

**Done when:** all eight deliverables in brief §11 exist and are current; `gradlew build` is clean;
the full GameTest suite passes; the perf budget is met with 20 demigods online **with published
numbers**; and a 20-player playtest completes a full arc — spawn, satyr, claiming, camp, a quest, a
death, an Underworld escape, and a boss — with no state loss across a server restart.

---

# Post-1.0 content track

Each is a self-contained release. Order is a suggestion; they are independent except where noted.

| | Content | Notes |
|---|---|---|
| **A** | Hephaestus, Aphrodite, Demeter | Automatons are a subsystem, not an ability — budget accordingly. Charmspeak ships to the D-06 bounded grammar, off by default against players, with a dedicated PvP review gate. |
| **B** | Artemis and the Hunters; the minor cabins — Dionysus, Iris, Hypnos, Nemesis, Nike, Tyche, Hebe | Not filler; same contract. The Hunters' vow is D-18. |
| **C** | Mount Olympus, the Sea of Monsters, and the remaining structures — Lotus Hotel (D-11), Waterland, Mount Othrys, Geryon's ranch, the Hesperides, Hoover Dam, the Princess Andromeda, Alaska (D-13), New Rome's gateway | Sea of Monsters as a dimension (D-12). Olympus unlocks the gods-as-NPC boon and quest layer. |
| **D** | Books 3–5 monsters and bosses — Nemean Lion, Manticore, Ladon, Atlas, the Sphinx elsewhere, Geryon, Kampê, Empousai, the Lydian Drakon (D-14), Hyperion, Kronos, Typhon | Kronos and Typhon are raid-scale; they need C's structures to stand in. |
| **E** | Books 6–7 — the Ganymede chalice, Geras, Nereus, the Gorgons, the Hebe arcade, Hecate's brownstone | **Blocked on source verification** — see `DECISIONS.md`. Not written from memory. |
| **F** | The Titan corruption path, and Tartarus opening | D-19. An entire second progression tree; deliberately last. |

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Art throughput becomes the critical path | 7 onward | D-04 decouples it: art briefs fix animation and bone names up front, so a model swap is a file replacement, never a code change |
| GeckoLib's only 1.21.11 build is an alpha | 1, 7 | Proven or disproven by a Phase 1 spike; animation reached only through `entity/render/anim/`, so an API break is a bounded port |
| Patchouli has no 1.21.11 build | 13 | Re-checked at Phase 13; fallback is a mod-native book carrying the same authored content |
| The 1.21.11 rendering stack moves again | 13 onward | Every custom render path funnelled through `client/render/pipeline/` — one port, not sixty call sites |
| Mist render substitution proves fragile | 4 | Prototyped in Phase 4, three phases before Hecate depends on it — deliberately early so failure is cheap |
| Labyrinth generator performance | 10 | Graph-first design keeps chunk work local; profiled from the first commit, not at the end |
| Save-format churn breaking worlds | 2 onward | `schemaVersion` and the upgrade chain exist from the first commit; round-trip GameTest every phase |
| The post-1.0 track quietly becomes v1.0 again | all | The cut in D-20 is a commitment. Adding a cabin or a boss to the v1.0 track requires removing something else from it. |
| Books 6–7 lore accuracy | Post-1.0 E | Blocked pending source verification; `LORE_REFERENCE.md` carries confidence notes wherever the mod invents |

---

## Deliverable tracking

| Deliverable (brief §11) | Lands |
|---|---|
| `ARCHITECTURE.md` | ✅ done |
| `ROADMAP.md` | ✅ done |
| `DECISIONS.md` | ✅ done (not in the brief; added because 21 open decisions needed a home) |
| `LORE_REFERENCE.md` | ✅ seeded, with confidence notes; appended every phase |
| `BALANCE.md` | ✅ every number currently in code; filled further in Phases 3–6, final pass Phase 13 |
| `README.md` | ✅ status and honest limits now; compatibility matrix at Phase 13 |
| Core domain model + unit suite | ✅ 51 tests passing |
| Gradle project building clean with datagen | Phase 1 — **blocked on toolchain reachability** |
| Full GameTest suite | grows every phase; complete Phase 13 |
| Patchouli guidebook | Phase 13 (fallback per D-02 if no 1.21.11 build) |
