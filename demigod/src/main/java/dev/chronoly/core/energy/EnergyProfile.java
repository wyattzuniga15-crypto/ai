package dev.chronoly.core.energy;

import java.util.List;

/**
 * How a given parent's blood renews itself, and where it does not.
 *
 * <p>This is the mod's main flavour lever: a son of Poseidon is a different <em>resource</em> in a
 * desert than he is in the sea, without a single ability being disabled. The brief's §4.3 supplies
 * most of these; two are marked INVENTED and are flagged for sign-off.
 */
public record EnergyProfile(String god, float base, List<RegenClause> clauses) {

    /** Evaluates the per-second regeneration rate in this place. */
    public float rateIn(Surroundings s) {
        // Alaska overrides everything. Beyond the gods' reach means beyond it.
        if (s.godless()) return 0f;

        float rate = base;
        for (RegenClause c : clauses) {
            if (c.mode() == RegenClause.Mode.ADD && c.when().test(s)) rate += c.value();
        }
        for (RegenClause c : clauses) {
            if (c.mode() == RegenClause.Mode.MULTIPLY && c.when().test(s)) rate *= c.value();
        }
        float ceiling = Float.MAX_VALUE;
        for (RegenClause c : clauses) {
            if (c.mode() == RegenClause.Mode.CLAMP && c.when().test(s)) ceiling = Math.min(ceiling, c.value());
        }
        return Math.max(0f, Math.min(rate, ceiling));
    }

    private static final float BASE = 1.0f;

    /** The Lightning Thief, ch. 16 — the water gives Percy back everything he spends. */
    public static EnergyProfile poseidon() {
        return new EnergyProfile("poseidon", BASE, List.of(
                RegenClause.multiply("submerged", Surroundings::submerged, 4.0f),
                RegenClause.multiply("near_water", Surroundings::nearWater, 2.0f),
                RegenClause.clamp("desert", Surroundings::inDesert, 0.05f),
                RegenClause.clamp("nether", Surroundings::inNether, 0.05f)));
    }

    /** The sky is his. Underground, he is a long way from home. */
    public static EnergyProfile zeus() {
        return new EnergyProfile("zeus", BASE, List.of(
                RegenClause.add("altitude", s -> s.altitude() > 100, 1.5f),
                RegenClause.multiply("rain", Surroundings::raining, 1.8f),
                RegenClause.multiply("storm", Surroundings::thundering, 3.0f),
                RegenClause.clamp("underground", Surroundings::underground, 0.15f)));
    }

    /** The Lightning Thief, ch. 19 — his power is under the earth, in the dark, among the dead. */
    public static EnergyProfile hades() {
        return new EnergyProfile("hades", BASE, List.of(
                RegenClause.multiply("darkness", s -> s.lightLevel() <= 4, 3.0f),
                RegenClause.multiply("underground", Surroundings::underground, 1.6f),
                RegenClause.add("near_dead", Surroundings::nearUndeadOrGraves, 1.0f),
                RegenClause.clamp("bright_day", s -> s.daylight() && s.skyVisible() && s.lightLevel() >= 12, 0.2f)));
    }

    /** The sun, and only the sun. */
    public static EnergyProfile apollo() {
        return new EnergyProfile("apollo", BASE, List.of(
                RegenClause.multiply("sunlight", s -> s.daylight() && s.skyVisible(), 3.5f),
                RegenClause.clamp("night", s -> !s.daylight(), 0.05f)));
    }

    /**
     * The Titan's Curse — Athena's children think their way to strength. Rewards watching enemies
     * you have not yet been hit by, which is the only profile that reads a stateful counter.
     */
    public static EnergyProfile athena() {
        return new EnergyProfile("athena", BASE, List.of(
                RegenClause.add("observed_unhit", s -> s.distinctEnemiesObservedUnhit() > 0,
                        0.6f),
                RegenClause.multiply("well_read_battlefield", s -> s.distinctEnemiesObservedUnhit() >= 3, 2.0f)));
    }

    /** The crossroads, the dark, and torchlight. The Battle of the Labyrinth, ch. 12. */
    public static EnergyProfile hecate() {
        return new EnergyProfile("hecate", BASE, List.of(
                RegenClause.multiply("crossroads", Surroundings::atCrossroads, 3.0f),
                RegenClause.multiply("night", s -> !s.daylight(), 1.8f),
                RegenClause.add("torchlight", Surroundings::nearTorches, 0.5f)));
    }

    /**
     * INVENTED — the brief gives no regeneration rule for Ares. Proposed: war feeds him, so favour
     * recent violence and being hurt. Flagged for sign-off.
     */
    public static EnergyProfile ares() {
        return new EnergyProfile("ares", BASE, List.of(
                RegenClause.multiply("recent_violence", Surroundings::recentViolence, 2.5f),
                RegenClause.clamp("peace", s -> !s.recentViolence(), 0.4f)));
    }

    /**
     * INVENTED — the brief gives no regeneration rule for Hermes. Proposed: distance travelled,
     * because he is the god of the road and standing still is the one thing he never does.
     * Flagged for sign-off.
     */
    public static EnergyProfile hermes() {
        return new EnergyProfile("hermes", BASE, List.of(
                RegenClause.add("travelling", s -> s.blocksTravelledRecently() > 32d, 1.2f),
                RegenClause.clamp("stationary", s -> s.blocksTravelledRecently() < 1d, 0.3f)));
    }

    /** The eight parents playable in v1.0. */
    public static List<EnergyProfile> v1() {
        return List.of(poseidon(), zeus(), hades(), athena(), ares(), apollo(), hermes(), hecate());
    }
}
