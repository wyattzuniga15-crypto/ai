package dev.chronoly.core.energy;

/**
 * A flattened sample of everything the regeneration rules can ask about, taken once per evaluation
 * so no predicate does its own world lookup.
 *
 * <p>This shape is the performance contract: sampling is bounded and cadenced (once per 20 ticks
 * per player), and a profile with fifteen clauses still costs one sample, not fifteen.
 */
public record Surroundings(
        boolean submerged,
        boolean nearWater,
        boolean inDesert,
        boolean inNether,
        int altitude,
        boolean underground,
        boolean raining,
        boolean thundering,
        boolean skyVisible,
        boolean daylight,
        boolean moonlit,
        boolean inForest,
        int lightLevel,
        boolean nearUndeadOrGraves,
        boolean onFertileGround,
        boolean matureCropsNearby,
        boolean nearLavaOrForge,
        boolean atCrossroads,
        boolean nearTorches,
        boolean stillOrRested,
        int distinctEnemiesObservedUnhit,
        boolean recentViolence,
        double blocksTravelledRecently,
        /** Alaska. Beyond the reach of the gods, and therefore beyond the reach of their gifts. */
        boolean godless) {

    /** A neutral overworld noon on flat grass — the baseline every profile is measured against. */
    public static Surroundings plain() {
        return new Surroundings(false, false, false, false, 64, false, false, false, true, true,
                false, false, 15, false, true, false, false, false, false, false, 0, false, 0d, false);
    }
}
