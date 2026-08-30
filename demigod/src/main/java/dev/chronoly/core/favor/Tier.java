package dev.chronoly.core.favor;

/**
 * Ability tiers. Derived from favor, never stored — a stored tier is a tier that can disagree with
 * the favor that produced it.
 *
 * <p>Higher tiers change what an ability <em>is</em>, not just its numbers.
 */
public enum Tier {
    T1(0f), T2(200f), T3(500f), T4(850f);

    private final float threshold;

    Tier(float threshold) {
        this.threshold = threshold;
    }

    public float threshold() {
        return threshold;
    }

    public static Tier forFavor(float favor) {
        if (favor >= T4.threshold) return T4;
        if (favor >= T3.threshold) return T3;
        if (favor >= T2.threshold) return T2;
        return T1;
    }

    public boolean atLeast(Tier other) {
        return ordinal() >= other.ordinal();
    }
}
