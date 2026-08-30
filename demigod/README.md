# Demigod: Chronicles of Olympus

A Percy Jackson total-content mod for **Minecraft 1.21.11 / NeoForge 21.11**, Java 21.

> Unofficial fan work. *Percy Jackson & the Olympians* belongs to Rick Riordan and Disney; this is
> a non-commercial fan project and is not affiliated with or endorsed by either.

## Status

**Design is complete and the domain model is built and tested. The Minecraft-facing shell is not
yet written.** Read that honestly:

| | State |
|---|---|
| `ARCHITECTURE.md` | ✅ complete — package layout, registries, data flow, ability framework, dimension strategy, 1.21.11 platform notes |
| `DECISIONS.md` | ✅ all 21 open decisions answered |
| `ROADMAP.md` | ✅ v1.0 cut and a post-1.0 content track, each phase with a testable criterion |
| `LORE_REFERENCE.md` | ✅ seeded, with confidence notes and the Books 6–7 verification gate |
| `BALANCE.md` | ✅ every number currently in code |
| `src/main/java/dev/chronoly/core/**` | ✅ **built and passing — 51 tests** |
| Gradle build, `neoforge.mods.toml` | ⚠️ written, **not yet built** — see below |
| Everything touching Minecraft types | ❌ not started |

## What actually works today

The `core/` package is the mod's decision logic, and by deliberate design (ARCHITECTURE §2) it
imports no Minecraft types at all. That makes it testable with nothing but a JDK — and it is
tested:

- **The Mist combat matrix** — celestial bronze through mortals, mortal steel through monsters, a
  demigod hurt by both. Every cell of the matrix, both directions, plus the by-exclusion default
  that makes an unknown mod's sword still fail against a hellhound.
- **Favor** — per-god standing, clamping, tier derivation, and the rule that a broken Styx oath
  outweighs every other penalty.
- **Divine Energy** — overdraw as debt rather than a wall, exhaustion as one saturating number,
  and all eight v1.0 regeneration profiles including Alaska silencing every one of them.
- **Judgment** — Asphodel / Elysium / Punishment, with Punishment checked first so prior heroism
  does not redeem an oathbreaker, and the Isles of the Blest on the third Elysium lifetime.
- **Monster scent** — the power-attracts-danger loop, and wards zeroing it outright.
- **The prophecy generator** — 200 consecutive prophecies verified to be five lines, correctly
  rhymed in both couplets, naming every objective, and using only kennings bound to things the
  planner actually placed.
- **The Labyrinth graph** — deterministic generation, connectivity by construction, a thousand
  shifts that never strand anyone and never move a corridor next to a player, and the
  distance-mismatch exit derived from graph distance rather than coordinates.

Run it:

```sh
./tools/verify-core.sh
```

Needs a JDK 21 and Maven Central. Nothing else.

## Why the Gradle build is unverified

`gradlew build` requires `maven.neoforged.net`, `libraries.minecraft.net`, and
`piston-meta.mojang.com`. All three are blocked by the egress policy of the environment this was
developed in, so ModDevGradle cannot resolve or decompile Minecraft here — the build files are
written to the standard ModDevGradle shape but have **never been executed**. Treat `build.gradle`,
`settings.gradle`, `gradle.properties`, and `neoforge.mods.toml` as reviewed-by-inspection, not as
known-good. The first person to run this on an unrestricted machine should expect to fix version
pins.

That is also why no Minecraft-facing code exists yet. Writing several dozen files against a
1.21.11 API that renamed `ResourceLocation` to `Identifier` and rebuilt the render stack, with no
way to compile any of it, would produce something that looks like progress and almost certainly
does not build. The `core/` layer was built instead because it can be proven.

## Next

Phase 1 in `ROADMAP.md`, on a machine that can reach the NeoForge toolchain. Its acceptance
criterion already includes spikes for the six APIs the 1.21.11 migration primer is silent on, and
for the GeckoLib alpha the mod hard-depends on.
