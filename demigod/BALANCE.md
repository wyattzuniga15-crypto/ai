# BALANCE — Demigod: Chronicles of Olympus

Every number the mod makes a decision with. Each is config-exposed; nothing here is hardcoded in an
ability. Rows marked **live** are implemented and covered by the core test suite; the rest are
reserved for the phase that fills them.

## Tiers (live)

| Tier | Favor | Meaning |
|---|---|---|
| T1 | 0 | Claimed, and dangerous to yourself |
| T2 | 200 | Competent |
| T3 | 500 | The reason monsters travel to find you |
| T4 | 850 | Signature. Rare, expensive, memorable |

Tier is *derived*, never stored — a stored tier is one that can disagree with the favour that
produced it.

## Favor economy (live)

Range 0–1000, per god. You can be in good standing with your parent and in trouble with Hermes.

| Reason | Default | Source |
|---|---:|---|
| Complete a prophesied quest | +120 | brief §4.2 |
| Win a fight below 20% health (Ares) | +15 | §4.2 |
| Burnt offering, best portion | +12 | The Lightning Thief, ch. 7 |
| First craft of a kind (Athena) | +10 | §4.2 |
| Forge in celestial bronze (Hephaestus) | +9 | §4.2 |
| A deed aligned with your parent | +8 | §4.2 |
| Theft or delivery (Hermes) | +7 | §4.2 |
| Slay an opposed monster | +6 | §4.2 |
| Burial rites (Hades) | +5 | §4.2 |
| Harvest mature crops (Demeter) | +3 | §4.2 |
| Boast / declare victory early | −20 | §4.2 |
| Kill something helpless | −25 | §4.2 |
| Harm a sacred animal | −35 | §4.2 |
| Die | −40 | §4.2 |
| **Break an oath on the Styx** | **−150** | The Last Olympian, ch. 4 |

The Styx oath is deliberately the heaviest single loss in the game, and a test enforces that it
outweighs every other penalty. It is meant to be frightening.

## Divine Energy (live)

| Quantity | Default |
|---|---|
| Pool base | 100 |
| Pool per point of favor | +0.4 (so 500 at max favor) |
| Base regen | 1.0/s before clauses |

**Overdraw is debt, not a wall.** A spend is never refused; the shortfall becomes debt, and debt
drives exhaustion severity (`debt / max`, saturating at 1) which is the *single* number behind
reduced max health, slowed movement, and the dimmed screen edges — so the effect and its
presentation cannot drift apart. Debt burns off only while not casting: casting through exhaustion
keeps you exhausted, which is the intended trap.

### Regeneration profiles (live)

Clauses apply in order: all `ADD`, then all `MULTIPLY`, then the lowest `CLAMP` ceiling wins.
Alaska (`godless`) zeroes every profile before any clause runs.

| Parent | Clauses |
|---|---|
| Poseidon | ×4.0 submerged · ×2.0 near water · ceiling 0.05 in desert · ceiling 0.05 in the Nether |
| Zeus | +1.5 above y=100 · ×1.8 rain · ×3.0 thunderstorm · ceiling 0.15 underground |
| Hades | ×3.0 in darkness (light ≤4) · ×1.6 underground · +1.0 near undead or graves · ceiling 0.2 in bright daylight |
| Apollo | ×3.5 in direct sun · ceiling 0.05 at night |
| Athena | +0.6 with any enemy observed unhit · ×2.0 at three or more |
| Hecate | ×3.0 at a crossroads · ×1.8 at night · +0.5 near torches |
| Ares | ×2.5 after recent violence · ceiling 0.4 in peace — **INVENTED, needs sign-off** |
| Hermes | +1.2 while travelling (>32 blocks recently) · ceiling 0.3 stationary — **INVENTED, needs sign-off** |

The brief specifies regeneration rules for Poseidon, Zeus, Hades, Apollo, Artemis, Demeter,
Hephaestus, Hecate, Hypnos and Athena — but not for Ares or Hermes, who are both in the v1.0 cut.
Rather than leave them flavourless, both are proposed above and flagged here per the brief's
"ask before inventing" rule. Ares is fed by war; Hermes by the road.

## Monster scent (live)

Scent is 0–1 and weights to 1.0 exactly:

| Contribution | Weight |
|---|---:|
| Favor (÷1000) | 0.50 |
| Parent rarity (Big Three ≈ 1.0) | 0.25 |
| Divine relics carried (÷6) | 0.15 |
| Recent kills (÷10) | 0.10 |

**A ward zeroes it outright** rather than reducing it. That absoluteness is what makes camp feel
like home instead of merely safer.

| Threat tier | Scent |
|---|---|
| Unseen | < 0.15 |
| Faint | 0.15 |
| Noticed | 0.45 |
| Hunted | 0.75 |

Digging down stops working at 0.45. A child of the Big Three with any standing cannot hide
underground; a new unclaimed player still can, or onboarding would be cruel.

## Judgment (live)

Punishment is evaluated **before** Elysium. Prior heroism does not redeem a broken oath.

| Route | Condition |
|---|---|
| Punishment | any broken Styx oath · ≥3 innocents killed · ≥8 acts of hubris |
| Elysium | ≥5 heroic deeds **or** ≥2 quests completed **or** peak favor ≥700 |
| Asphodel | everything else |
| Isles of the Blest | the 3rd Elysium lifetime |

## The Labyrinth (live)

| Quantity | Default |
|---|---|
| Loopiness (extra edges as a fraction of rooms) | 0.15–0.25 |
| Overworld blocks per corridor traversed | 900 |

The exit is a function of **graph distance from the entrance**, never of coordinates inside the
dimension — so the distance mismatch is the only relationship that ever existed between the two
spaces, not a fudge applied at the door. A ~30-corridor walk exits ~27,000 blocks away.

## Reserved

Per-ability energy costs, cooldowns, fatigue tails, and PvP coefficients land with their abilities
in Phases 5–6; fatal flaw coefficients in Phase 3; spawn director rates in Phase 8. Each ability's
table arrives in the same commit as the ability, never after it.
