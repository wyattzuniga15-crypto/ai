package dev.chronoly.core.scent;

/**
 * How strongly the world can smell you.
 *
 * <p>This is the loop the brief calls the single most important mechanic: power raises scent, scent
 * raises threat, and so getting stronger raises the stakes instead of flattening them. Nothing here
 * may be softened without breaking that.
 */
public final class ScentModel {

    private ScentModel() {}

    /**
     * @param favor           standing with your parent
     * @param parentRarity    0..1, higher for the Big Three — a child of Poseidon reeks
     * @param relicsCarried   divine items are loud
     * @param recentKills     fresh monster dust draws more
     * @param insideWard      camp's borders, or a ward you built
     */
    public record Inputs(float favor, float parentRarity, int relicsCarried, int recentKills,
                         boolean insideWard) {}

    /**
     * Scent, 0..1.
     *
     * <p>A ward zeroes it outright rather than reducing it. That absoluteness is what makes camp
     * feel like home instead of merely safer, and it is the reason a new player can breathe.
     */
    public static float compute(Inputs in) {
        if (in.insideWard()) return 0f;

        float fromFavor = clamp01(in.favor() / 1000f) * 0.5f;
        float fromBlood = clamp01(in.parentRarity()) * 0.25f;
        float fromRelics = clamp01(in.relicsCarried() / 6f) * 0.15f;
        float fromKills = clamp01(in.recentKills() / 10f) * 0.10f;
        return clamp01(fromFavor + fromBlood + fromRelics + fromKills);
    }

    public static ThreatTier threat(float scent) {
        if (scent >= 0.75f) return ThreatTier.HUNTED;
        if (scent >= 0.45f) return ThreatTier.NOTICED;
        if (scent >= 0.15f) return ThreatTier.FAINT;
        return ThreatTier.UNSEEN;
    }

    /**
     * Digging down does not help a strong-smelling demigod. The spawn director uses this rather
     * than a light-level check, which is precisely why burying yourself is not a strategy.
     */
    public static boolean canHideUnderground(float scent) {
        return scent < 0.45f;
    }

    private static float clamp01(float v) {
        return Math.max(0f, Math.min(1f, v));
    }
}
