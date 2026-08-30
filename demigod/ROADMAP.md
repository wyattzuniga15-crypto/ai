# ROADMAP — Demigod: Chronicles of Olympus

Phase-ordered build plan. Each phase has an **acceptance criterion that is testable by someone
other than the author** — a phase is not done when the code compiles, it is done when the stated
condition is demonstrably true in a running game.

Three rules govern this roadmap:

1. **Never stub.** If a phase is too large, it ships less content completely rather than all of it
   partially. Cut scope by removing rows, never by half-building them.
2. **Every phase ends with a report** covering: what shipped, what is configurable, what is
   fragile, what is next.
3. **A phase does not start until the previous phase's acceptance criterion passes**, with the one
   exception noted at Phase 5/7 (art work may run in parallel with logic work).

---

## Phase 0 — Decisions (blocking everything)

Resolve **D-01 … D-21** in `ARCHITECTURE.md` §15. Four of them (**D-01** package root, **D-02**
exact 1.21.x target, **D-03** GeckoLib dependency, **D-04** art pipeline) block the first line of
code. **D-20** — the v1.0 roster cut — determines whether this roadmap is 14 phases or 14 phases
plus a post-1.0 content track.

**Done when:** every decision has an answer recorded in `DECISIONS.md`, and the roadmap below has
been re-scoped to match D-20.

---

## Phase 1 — Skeleton

| Item | Detail |
|---|---|
| Gradle | ModDevGradle, pinned NeoForge + MC version, `runClient`/`runServer`/`runData`/`runGameTestServer` |
| Registries | Every `DeferredRegister` holder from ARCHITECTURE §3, empty but wired |
| Custom registries | `chronoly:ability`, `:fatal_flaw`, `:god`, `:energy_profile`, `:mist_substitution`, `:monster_table`, `:prophecy_fragment` created and loading |
| Config | All three `ModConfigSpec`s with `ChBalance` cached view |
| Datagen | Provider skeletons for every generator; `src/generated` committed |
| CI | `gradlew build` + `runData` + `git diff --exit-code src/generated` |
| Docs | `LORE_REFERENCE.md` and `BALANCE.md` created with their table headers and citation format |

**Done when:** `gradlew build` is clean from a fresh clone with no manual steps; the mod loads on
client and dedicated server; `/chronoly` exists and reports the mod version; CI is green and
catches a deliberately stale datagen commit.

---

## Phase 2 — Ability framework

The engine, with no content in it.

- `Ability` / `AbilityInstance` / `AbilityContext` / `AbilityPhase` / `AbilityExecutor`.
- Traits: `Charged`, `Channeled`, `Toggled`, `Sustained`, `Committed`, `Aimed`, `PvpScaled`.
- `DemigodData` attachment with codec, schema version, and the upgrade chain.
- Payload set: `AbilityInput`, `DemigodSnapshot`, `DemigodDelta`, `AbilityFeedback`, `ScreenEffect`.
- Keybinds, hold-to-charge input handling, radial ability wheel.
- HUD: energy arc + cooldown ring (favor bar comes in Phase 3).
- One deliberately trivial test ability, `chronoly:test_spark`, which is **deleted at the end of
  Phase 5** and exists only to exercise the machine.

**Done when:** `test_spark` charges on hold, releases early at reduced effect, costs energy,
enters cooldown, syncs to the HUD, survives a server restart with its cooldown intact, and a
second player on the same server sees its `AbilityFeedback` without seeing the caster's private
state. GameTest covers the full phase machine including CANCEL from every phase.

---

## Phase 3 — Progression

Claiming, Favor, Divine Energy, Fatal Flaws — the loop, with placeholder art.

- Claiming triggers (first monster kill / Favor threshold / brazier offering) and the ceremony
  payload; `/chronoly claim <player> <god>`.
- `FavorLedger` with every gain and loss from the brief §4.2, each a config coefficient.
- `EnergyProfile` predicate evaluation per god, incl. Athena's observed-enemies ring buffer.
- Overdraw + Exhaustion effect + screen-edge vignette.
- All Fatal Flaws implemented as real double edges, documented as a full table in `BALANCE.md`.
- Favor HUD bar with fade-unless-changing.

**Done when:** a fresh player can be claimed, gain and lose Favor through at least six distinct
reasons, cross a tier threshold, drain into overdraw and feel it, and their flaw demonstrably both
helps and hurts them — all verifiable from a single 20-minute play session with no items in the
game yet. Save/load round-trip GameTest passes for every field.

---

## Phase 4 — Materials and the Mist rule

The mod's most important combat rule, before any ability depends on it.

- Celestial Bronze, Imperial Gold, Stygian Iron, Greek Fire, Mist-glass, Drachmas: items, ores/
  sources, forging recipes, tool/weapon/armor sets.
- Stygian Iron's essence absorption (a `DataComponent` that grows on kill).
- `MistCombatResolver` and the full §7.1 matrix, with `mortal_steel`-by-exclusion.
- Phase-through VFX + sounds; `FirstTimeLesson` for each direction of the rule.
- Ambrosia and Nectar with the burn counter, its decay, the golden-fire death, and its HUD element.

**Done when:** the bronze-passes-through-mortals rule works in **both** directions in a GameTest
that covers every cell of the matrix; a player striking a villager with celestial bronze and a
monster with an iron sword both receive their diegetic lesson exactly once; and overdosing on
ambrosia kills you.

> Phase 4 is the earliest point at which the mod is recognisably *this* mod. If the schedule
> slips, protect this phase.

---

## Phase 5 — Core ability trees

Per **D-20**'s v1.0 cut: Poseidon, Zeus, Hades, Athena, Ares, Apollo, Hermes — every tier, to the
brief's Section 5 contract.

Order within the phase, chosen so the shared `sim/` classes land earliest and get the most reuse:

1. **Poseidon** — builds `FluidVolume` (used later by Zeus's Hurricane interaction, Demeter,
   Charybdis).
2. **Zeus** — builds `ChargeGraph` + `ThunderCue` (used by Storm Call, Clarisse's spear, Kronos).
3. **Hades** — builds `LightSampler`/`ShadowGraph` (used by Hecate, Nyx, the Underworld).
4. **Athena, Ares, Apollo, Hermes** — mostly compose existing sims plus `HeatField`.

Each ability requires, before merge: the physical model written down, the config coefficients in
`BALANCE.md`, a custom particle type for signature abilities, custom sounds, camera work, a
GeckoLib pose, an explicit PvP coefficient, and a GameTest.

**Done when:** every ability listed under §5.1–5.6 and §5.8 of the brief is finished to that
contract, `test_spark` is deleted, and a mixed-parentage party of four can fight for ten minutes
with `/chronoly profile` reporting server overhead under budget.

**Flagged abuse vectors requiring an explicit sign-off in this phase:** Blink and Traveler's Road
(claim-mod and border bypass), Fissure (D-07), Curse of Achilles (D-08), Shadow Travel through
walls into protected regions.

---

## Phase 6 — Remaining cabins

Hephaestus, Aphrodite, Demeter, Hecate, and the minor cabins (Dionysus, Iris, Hypnos, Nemesis,
Nike, Tyche, Hebe). Same contract, no exceptions — the brief is explicit that the minor cabins are
not filler.

Two items in this phase carry disproportionate risk and are called out:
- **Charmspeak** (D-06) — bounded verb grammar, off-by-default against players, kill-switch, and a
  dedicated PvP balance review before it ships.
- **Automatons** (Hephaestus) — modular parts and behaviours is a subsystem, not an ability;
  budget for it accordingly.

**Done when:** every ability in brief §5.9–5.13 is finished, and a server can disable Charmspeak
entirely with one config line and have nothing else break.

---

## Phase 7 — Monsters, Books 1–2

Minotaur, the Furies, Medusa, Chimera & Echidna, hellhounds, Cerberus, Charon, Procrustes;
Colchis Bulls, the Hydra, Scylla, Charybdis, the Sirens, Polyphemus, Circe, Laistrygonians.

Every monster: GeckoLib model + full animation set, telegraphed attacks with real counterplay,
lore-accurate behaviour, custom sounds, golden-dust dissolution, and a Tartarus reformation timer
with `MonsterMemory` so notable monsters remember you.

The signature mechanics are the acceptance criteria, not decoration:
- **Hydra:** cutting a head grows two back unless the stump is cauterised with fire.
- **Medusa:** a real look-away mechanic — the gaze checks your actual view vector.
- **Charybdis:** a genuine whirlpool hazard built on `FluidVolume`.
- **Sirens:** an audio illusion that shows each player what *they* want most.

**Done when:** each monster is distinguishable in combat with your eyes closed to its model — the
fight feels different because the mechanic is different. Reformation is verified across a server
restart.

---

## Phase 8 — Camp Half-Blood, scent, and onboarding

- Camp Half-Blood as a hand-authored generated structure: 20 architecturally distinct cabins, the
  Big House with the attic Oracle, the dining pavilion and braziers, the arena, the forges, the
  strawberry fields, the lava climbing wall that slams shut, the canoe lake, Thalia's Pine and the
  Fleece, the armory, Bunker 9. One coastal plains/forest location per world.
- `ScentModel` and the `SpawnDirector`: lore-appropriate spawns scaled to tier and biome; high
  scent means digging down does not save you; low scent means near-invisibility to monsters.
- `WardRegistry`: camp's borders and craftable smaller wards zero out scent inside their radius.
- **Satyr onboarding**: satyrs smell unclaimed demigods, seek them out, and escort them to camp.
  This is the primary onboarding path — **no tutorial book**.

**Done when:** a brand-new player, given no instructions, is found by a satyr, escorted to camp,
claimed, and trained — observed end-to-end by a tester who has not read the docs. And
`/chronoly profile` publishes real spawn-director numbers (ms/tick at 1, 5, and 20 players) in the
phase report.

---

## Phase 9 — The Underworld

The dimension: the Styx, Charon's ferry, the EZ-Death line, Cerberus, the Judgment Pavilion,
Asphodel, Elysium, the Isles of the Blest, the Fields of Punishment as themed challenge rooms,
Hades' palace, Persephone's garden, and the gate to Tartarus.

- Death routes to the Underworld as a shade instead of the respawn screen (D-05 governs items).
- Judgment from `LifetimeRecord`: Asphodel by default, Elysium for heroism, Punishment for
  oathbreaking, murder of innocents, and hubris.
- Escape as a real 5–15 minute loop: bribe Charon with a drachma, slip past Cerberus, find the
  exit — or wait out the timer.
- Elysium buff on return; Punishment curse. Three Elysium lifetimes unlocks the Isles of the Blest.
- Bathing in the Styx grants the Curse of Achilles, with the hidden mortal point (D-08 governs how
  it ends).

**Done when:** dying is a story rather than a menu — a tester who dies with a bad record and one
who dies with a good one have visibly different experiences, and both can get out. Dimension
transition GameTests confirm no attachment state is lost in either direction.

---

## Phase 10 — The Labyrinth

The technical centrepiece.

- Custom `ChunkGenerator` over a logical `MazeGraph` held in `SavedData`; chunks realise the graph
  rather than the graph being read back from chunks.
- Corridors rearrange behind you — mutations apply only to chunks with no players in or adjacent.
- **Distance mismatch:** walk 100 blocks in, exit 10,000 blocks away, resolved from graph distance
  × an anchor scale, not from in-dimension coordinates.
- Navigable only with Ariadne's String, a clear-sighted mortal companion, or Daedalus' workshop.
- Entrances generate as `Δ`-marked cracks anywhere.
- A mix of procedural corridors and authored set-pieces: Antaeus' arena, the ranch, the workshop,
  Hephaestus' forge, Calypso's exit, the Sphinx's chamber, bone-filled dead ends.

**Done when:** the distance mismatch and the shifting walls both demonstrably work; Ariadne's
String reliably navigates a maze that a player without it gets lost in; the generator is
deterministic for a fixed seed; a player is never stranded by a shift; and the phase report
publishes generation timings, not adjectives.

---

## Phase 11 — Remaining world

Mount Olympus (the 600th-floor lift, the throne room, the forges, the marketplace, the gardens,
gods as NPCs granting boons and quests); the Sea of Monsters (D-12) with Polyphemus' island,
Circe's island, the Sirens' rocks, Scylla's strait, and Ogygia; the Lotus Hotel & Casino (D-11);
Waterland; Mount Othrys; Geryon's ranch; the Garden of the Hesperides; Hoover Dam; the Princess
Andromeda as a sailing, boardable boss ship; Alaska as the godless hard zone (D-13); Hecate's
brownstone; New Rome's gateway.

Also in this phase, because they are world-scale rather than ability-scale: the economy and
communication layer — golden drachmas, Iris-Messaging (D-10), Hermes Express with George and
Martha, and the Hermes waystation network.

**Done when:** every dimension and named structure is reachable by an in-world route a player can
discover without commands, and each is lore-faithful enough that a reader of the books recognises
it on sight.

---

## Phase 12 — Books 3–7 monsters and bosses

Book 3: the Manticore, the Nemean Lion (impervious hide — only the open mouth), reassembling
skeleton warriors, Ladon, Atlas, the Ophiotaurus, the Erymanthian Boar.
Book 4: the Sphinx (a real riddle encounter), Antaeus (heals on ground contact — must be lifted),
Geryon (three bodies, three bars, pierced at once), Kampê, telkhines, Empousai, Briares, Daedalus,
Janus.
Book 5: the Lydian Drakon (D-14), Hyperion, Kronos as a multi-phase raid boss with time
manipulation, Typhon as a world-scale multiplayer terrain-destroying event, Titan army units,
Ethan Nakamura, the returned Minotaur.
Books 6–7: the Ganymede chalice questline, Geras (an aging wrestling match won by enduring, not by
damage), Iris's shop, Nereus (hold on through every transformation), the Gorgons, the Hebe arcade,
and Hecate's brownstone as a timed escalating survival-and-repair scenario.

**Blocked on ARCHITECTURE §16:** Books 6 and 7 are not implemented from memory. Source
verification or your confirmation is required first.

**Done when:** every named boss has a real mechanic rather than a stat block — a tester can
describe how to beat each one without mentioning damage numbers.

---

## Phase 13 — Prophecy and quests

- The Oracle in the Big House attic.
- `QuestPlanner` → objective set → `ProphecyGrammar` → five lines (two rhyming couplets plus a
  final line). Text is a **view** of the objectives, never their source.
- Quest parties of three, with a satyr or summoned ally filling the third slot for solo players.
- Quest structure: travel, defeat or outwit, retrieve, return before a deadline. Real failure
  consequences.
- Prophecy tracker HUD.

**Done when:** 200 consecutively generated prophecies are all (a) scannable as verse, (b) rhyming
correctly, and (c) mechanically solvable — verified by an automated JUnit run over the generator,
plus a human read of a random 20 for voice.

---

## Phase 14 — Polish and ship

Custom particle systems audited against the 400/instance budget; the full original sound set with
subtitles, attenuation, reverb tags, distance-delayed thunder, and per-god leitmotifs; camera work;
HUD layout and repositioning; the Patchouli guidebook written in the books' voice; JEI/EMI, Curios,
Jade/WTHIT integrations; advancement titles in the Riordan register; and a full balance pass with
PvP coefficients reviewed ability by ability.

**Done when:** all eight deliverables in brief §11 exist and are current; `gradlew build` is clean;
the full GameTest suite passes; the perf budget is met with 20 demigods online with published
numbers; and a 20-player playtest completes a full arc — spawn, satyr, claiming, camp, a quest, a
death, an Underworld escape, and a boss — with no state loss across a server restart.

---

## Risk register

| Risk | Phase | Mitigation |
|---|---|---|
| Art and audio scope (~60 animated monsters, original score) | 4–12 | **D-04** decides this before Phase 1. If no artist, the roster must shrink — the quality bar does not. |
| Mist render substitution proves fragile | 8, ongoing | **D-09**; prototype the chosen approach during Phase 4, before anything depends on it |
| Labyrinth generator performance | 10 | Graph-first design keeps chunk work local; profile from the first commit, not at the end |
| Charmspeak balance and abuse | 6 | Bounded grammar, off-by-default vs players, kill-switch, dedicated review gate |
| Save-format churn breaking worlds | 2 onward | `schemaVersion` + upgrade chain from the first commit; round-trip GameTest per phase |
| Total scope exceeding a shippable v1.0 | all | **D-20** — cut the roster, not the finish |
| Books 6–7 lore accuracy | 12 | Blocked pending source verification; `LORE_REFERENCE.md` confidence notes |

---

## Deliverable tracking

| Deliverable (brief §11) | Lands |
|---|---|
| `ARCHITECTURE.md` | ✅ now |
| `ROADMAP.md` | ✅ now |
| `LORE_REFERENCE.md` | created Phase 1, appended every phase |
| `BALANCE.md` | created Phase 1, filled Phases 3–6, final pass Phase 14 |
| Gradle project building clean with datagen | Phase 1 |
| Full GameTest suite | grows every phase; complete Phase 14 |
| Patchouli guidebook | Phase 14 |
| `README.md` + compatibility matrix | Phase 14 |
