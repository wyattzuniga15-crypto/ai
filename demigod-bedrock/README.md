# Demigod: Chronicles of Olympus — Bedrock Edition

The Bedrock port of the Java mod at `../demigod/`. Same numbers, same rules, same voice.
Ships as one `.mcaddon`: import it, enable both packs on a world, **turn on the
Beta APIs / scripting experiment** (required for everything beyond the entities and recipes),
and type `!chronoly help` in chat.

## What changes shape on Bedrock — honestly

Bedrock has no seam for several things the Java build hangs off. The mechanics keep their
meaning and change their door:

| Java | Bedrock |
|---|---|
| Press G to cast | Hold and use the **Birthright** item (stick + gold nugget) |
| `/chronoly ...` commands | `!chronoly ...` in chat |
| Underworld & Olympus dimensions | Far places in this world (z ±100,000), built on first travel |
| Tooltips in the books' voice | Not ported — Bedrock items have no scriptable lore hook here |
| Damage cancelled by the Mist | Damage **healed back** in full (stable scripts cannot cancel hits) |
| Boss bars per boss colour | The `minecraft:boss` component (one style) |
| GameTests + 51 core unit tests | Nothing — this port has no test harness at all |

**Nothing in this pack has ever been run.** The Java build at least compiles under CI;
this JSON and script were written against documented Bedrock formats (1.21.x, `@minecraft/server`
1.13.0 stable) and validated as JSON/JS syntax only. Expect first-launch issues, and read
`content log` in-game if entities or items fail to appear.

## What's here

- The nine named monsters as real Bedrock entities — same health/damage/speed, own geometry
  (ported cube-for-cube from the Java models), the same hand-painted 128×128 textures,
  molang walk cycles, and boss bars.
- Their mechanics in script: Medusa's gaze, the Hydra's heads, the lion's roar-window
  invulnerability, Charybdis' pull, the Chimera's fire ring, the Drakon's poison, and the
  telegraphed heavy blow with its "It rears back. Move." warning.
- All 28 items with pixel-art icons, 24 recipes, boss loot tables, the five legendary
  relic drops, and relic right-click powers.
- The Mist rule, claiming (Big Three 3%), favour with tiers, energy with overdraw-as-debt,
  ambrosia burn, the Oracle (targets really spawn), the Styx oath, boasting, burial rites,
  judgment on death routing to Asphodel/Elysium/Punishment, Charon's drachma, camp building,
  and an actionbar HUD.
