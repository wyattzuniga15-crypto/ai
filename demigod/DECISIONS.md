# DECISIONS — Demigod: Chronicles of Olympus

The answers to `ARCHITECTURE.md` §15. Three states:

- **DECIDED** — you chose this.
- **DEFAULT TAKEN** — my recommendation from §15, adopted so it stops blocking. Say the word and
  it changes; the cost of changing rises steeply once the phase that depends on it has shipped.
- **PENDING** — still blocking.

---

## D-20 — v1.0 scope · **DECIDED: cut to a finished core**

v1.0 ships **eight parents** — Poseidon, Zeus, Hades, Athena, Ares, Apollo, Hermes, Hecate — the
**Books 1–2 monster roster**, and **three places**: Camp Half-Blood, the Underworld, the
Labyrinth. Everything else moves to the post-1.0 content track in `ROADMAP.md`.

This is the decision the whole roadmap hangs on. The brief's own rule — *do less of it completely
rather than all of it partially* — now has teeth: the roster shrank, the quality bar did not.
Nothing in the v1.0 track is allowed to ship half-finished on the grounds that scope is large,
because scope is no longer large.

Hecate is in the core cut rather than deferred with the other non-Big-Three cabins because she is
the Mist, and the Mist is the mod's signature system. Shipping v1.0 with the Mist as a pure combat
rule and nobody able to *bend* it would ship the mod without its thesis.

## D-04 — Art and audio · **DECIDED: placeholders plus an art request list**

Every entity ships complete in logic, AI, sound hooks, and animation *rigging* — against
placeholder geometry. Each one carries an art brief in `art/requests/<entity>.md`: silhouette
intent, required animation set (with the exact GeckoLib animation names the code calls), bone
names the code binds to, scale, and the book passage it comes from.

This makes the art swap a drop-in: replacing a placeholder model is a file replacement, never a
code change, because the code only ever refers to animation names and bone names that the brief
fixed in advance.

**Consequence, stated plainly:** "never stub" now holds for *behaviour*, not for *appearance*.
A monster whose fight is finished but whose model is a textured box counts as done for the phase
gate. A monster whose fight is unfinished does not, regardless of how good it looks.

## D-09 — Mist render substitution · **DECIDED: render-time substitution**

One entity on the server. Per-observer resolution shipped as `MistView`. The client's
`MistViewCache` swaps renderer, model, display name, and sound set at draw time.

Accepted cost, on the record: a determined client-side mod can see through the Mist. For a
co-op mod this is the right trade — the alternative doubles entity-tracking cost on every server
forever to defend against something that isn't an attack.

Mortal *mobs* get the same resolution through an AI targeting filter, so they genuinely never
react to monsters — that path is server-side and cannot be seen through.

## D-02 — Exact 1.21.x target · **DECIDED: 1.21.11, NeoForge 21.11**

The newest. I checked what that actually costs rather than assuming, and it is not free.

### What 1.21.11 changes in the code

Verified against the NeoForged 1.21.10 → 1.21.11 migration primer and written up in
`ARCHITECTURE.md` §17. The four that change design rather than syntax:

- **`ResourceLocation` is now `Identifier`** — global rename, mechanical but total. The
  architecture has been updated throughout.
- **The rendering stack moved.** `RenderType` statics are on `RenderTypes`; custom types need
  `RenderSetup#builder` with an explicit `RenderPipeline`; texture binding takes a `GpuSampler`;
  items have their own atlas. Every custom render path in the mod is now funnelled through one
  package so the next move costs one port, not sixty.
- **`DimensionSpecialEffects` is gone**, replaced by registry-backed environment attributes with
  timelines. This one is a *win*: the Underworld's grey light and Olympus' gold become
  datapack-authored and tunable without a recompile.
- **New vanilla weapon data components** — `DAMAGE_TYPE`, `ATTACK_RANGE` and friends. Also a win:
  a celestial bronze sword declares its damage type as a vanilla component, so the Mist combat
  rule reads vanilla data instead of a bespoke lookup, and Ares' `+reach` uses `ATTACK_RANGE`
  rather than a custom attribute.

### What 1.21.11 costs in compatibility

Checked as of this writing; all of it moves, so Phase 13 re-checks before the compat matrix ships.

| Dependency | 1.21.11 status | Consequence |
|---|---|---|
| **Curios API** | ✅ `14.0.0+1.21.11` | Relic slot system ships in v1.0 as planned |
| **JEI** | ✅ `27.4.0.15` for NeoForge 1.21.11 | Recipe plugin ships in v1.0 |
| **GeckoLib** | ⚠️ `1.21.11-5.4-alpha-1` — **alpha** | See D-03 below; this is the real cost |
| **Patchouli** | ❌ no 1.21.11 build found | The guidebook is at risk — see below |
| **Jade / WTHIT** | ❌ no 1.21.11 build found | Providers deferred to a post-1.0 compat pass |

**Patchouli is the awkward one**, because the guidebook is deliverable 7 in the brief and the
in-world voice of the mod. It is not a blocker until Phase 13, by which time it may well have
updated. The fallback, if it hasn't: ship the guidebook as a mod-native book item using the same
authored content, and add the Patchouli integration later. The *writing* is the deliverable; the
renderer is an implementation detail, and it is not worth pinning the whole mod to an older
Minecraft to keep one dependency.

Jade and EMI drop out of the v1.0 compat matrix and into a post-1.0 pass. The README will state
what is actually supported rather than what was aspired to.

---

## D-03 — GeckoLib · **VERIFIED at compile level; hard dependency confirmed**

Spiked in CI over four runs. The worry was an unstable alpha that could not carry sixteen animated
monsters. That is not what was found.

**The 1.21.11 alpha is usable.** It resolves, downloads, and its API is intact — `GeoEntity`,
`AnimatableInstanceCache`, `AnimatableManager`, `RawAnimation`, `GeckoLibUtil` and
`triggerableAnim` all compiled on the first attempt. What failed was not the library being broken
but GeckoLib **5.x having a different shape from 4.x**, which is what a major version means and
exactly what the spike existed to measure.

### The two 5.x API changes, now measured rather than feared

| Change | Consequence for the monster roster |
|---|---|
| `AnimationController` **dropped the animatable argument** — the constructors are `(handler)`, `(name, handler)`, `(name, transitionTicks, handler)` | Every monster's `registerControllers` is written the new way from the start; no 4.x tutorial copied in will compile |
| `PlayState` is **not** in `software.bernie.geckolib.animation` | Unresolved. The spike avoids naming it; where it went is a one-line answer whenever a controller needs an explicit `STOP` |

### Repository correction

GeckoLib is **not on Maven Central**, contrary to what this file said in an earlier revision. That
claim came from an mvnrepository listing, and mvnrepository indexes third-party repositories
alongside Central. Every GeckoLib artifact 404s on Central, `1.21.1` included. Cloudsmith
(`dl.cloudsmith.io/public/geckolib3/geckolib/maven/`) is the only publisher, so the build does
need that third-party repository.

### What is still NOT verified

**The animations have not been seen to play.** CI has no client, so the spike proves the artifact
resolves and the API surface compiles — nothing more. The roadmap's Phase 1 criterion ("plays a
looping and a triggered animation, and survives a relog") is **half satisfied**. The other half
needs a human at a keyboard with the mod loaded, and is not claimed here.

### Mitigations, kept

Still worth keeping even with the alpha looking sound: entity animation is reached only through
`entity/render/anim/`, art briefs fix animation and bone names in advance (D-04), and the spike
lives in `src/spike/java` behind `-PwithGeckolib` in its own `continue-on-error` job — which
earned its keep, since the spike failed three times while the downloadable mod jar stayed green
throughout.

---

## Defaults taken

### D-01 — Package root · `dev.chronoly`
Neutral, matches the mod id, no publishing identity baked in. Free to change now, expensive after
Phase 1.

### D-03 — GeckoLib · hard dependency
Every monster and most abilities want it. The mod refuses to load without it, which is honest.

### D-05 — Death and keep-inventory
`keepInventory=false`: you arrive in the Underworld as a shade with nothing; your items stay at
the death site with an extended despawn; escaping returns you to that site. `keepInventory=true`:
the Underworld run still happens — the stakes become the clock and the verdict rather than your
gear. Both branches documented in the guidebook.

### D-06 — Charmspeak · bounded verb grammar, off by default against players
A fixed verb set — STOP, FLEE, DROP, ATTACK ‹target›, KNEEL, FORGET — chosen from a radial menu or
typed as a short phrase matched against a localised alias list. It reads like speech and behaves
like an enum. Free-text parsing is unshippable and unbalanceable; this is the version that can
actually be tuned. Against players: short, resistible, loudly telegraphed, **off by default**,
with a config kill-switch.

### D-07 — Fissure vs. players · off by default
On for mobs. When a server enables it for players, the target must be below a health threshold and
gets a resist window. This is the most grief-capable thing in the mod and it defaults to closed.

### D-08 — Curse of Achilles ends in blessed water, not salt water
Canon is the Little Tiber — a *blessed* river, not the sea generally. Salt water would end the
curse the first time a son of Poseidon does the most in-character thing available to him, which is
backwards. The mortal point relocates on each new bath in the Styx.

### D-10 — Iris-Messaging · stylised scrying view, text styled as speech
The target's surroundings render as a low-detail silhouette scene with real entity positions —
magical rather than a webcam, and one draw pass instead of two full world renders. Voice stays a
soft-dep integration for later, not a v1.0 dependency.

### D-15 — Parent assignment · weighted random, Big Three 3% combined
You don't choose your parent; that's the point of being claimed. The Altar of Offering ships as a
server option for those who want agency.

### D-16 — Rebirth Token · rare Fields-of-Punishment drop
Reparenting keeps your Favor with the old god — you don't lose what you earned — and starts the
new parent at zero.

### D-17 — Prophecy localisation · per-language fragment corpus, English shipped
Runtime-assembled verse can't be translated as whole strings. Translators get the corpus and a
document explaining rhyme classes and scansion.

### D-21 — Unofficial fan work
Non-commercial, no monetisation, and the README says so plainly. Nothing technical changes.

---

## Deferred with the content they belong to

These stop being hypothetical when their post-1.0 phase starts; recorded now so the decision isn't
re-litigated from scratch then.

| | Decision | Direction when it lands | Lands in |
|---|---|---|---|
| D-11 | Lotus Hotel time dilation | Invert it — the player's *subjective* session is short while their hunger, cooldowns and quest deadlines advance at outside rate. Produces the book's horror on exit correctly. | Post-1.0 C |
| D-12 | Sea of Monsters | A dimension, entered by sailing into a generated anomaly. Ogygia, Circe's island and Scylla's strait each need authored geography that overworld generation would fight. | Post-1.0 C |
| D-13 | Alaska, beyond the gods' reach | A biome-tag region — snowy taiga / ice spikes past a distance threshold. Reads naturally, works in any world. | Post-1.0 C |
| D-14 | Lydian Drakon, "only a child of Ares may kill it" | Anyone may weaken it; only an Ares child lands the kill. The party mechanic the books actually depict, and it doesn't hard-block the boss on servers without one. | Post-1.0 D |
| D-18 | Hunters of Artemis vow | Scoped to mod-internal consequences. Compat-mod marriage blocking is an optional integration, not a feature. | Post-1.0 B |
| D-19 | Titan corruption path | Out of scope for 1.0 — it is an entire second progression tree. | Post-1.0 F |

---

## Still blocked on source material

**Books 6 and 7** (*The Chalice of the Gods*, *The Wrath of the Triple Goddess*) are not
implemented from memory — the brief itself flags them as the ones most likely to be got subtly
wrong. Before post-1.0 phase E: Geras's encounter structure, Nereus's transformation sequence, the
roster of Hecate's animals and what leaks out of her collection, and the shape of the Ganymede
chalice quest. `LORE_REFERENCE.md` carries a confidence note wherever the mod invents rather than
adapts.
