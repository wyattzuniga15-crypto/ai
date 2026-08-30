package dev.chronoly.core.energy;

/**
 * A demigod's Divine Energy, and the debt they run up spending what they do not have.
 *
 * <p>The Sea of Monsters, ch. 12 and elsewhere — Percy can always move more water than is good for
 * him, and pays for it afterwards. Overdraw is modelled as a <em>debt</em> rather than a hard wall:
 * you may always cast, and the bill arrives later. That turns fatigue into a decision instead of a
 * cooldown.
 */
public final class EnergyPool {

    private float current;
    private float debt;

    public EnergyPool(float current) {
        this.current = Math.max(0f, current);
    }

    /** Max pool scales with favor, so growing stronger genuinely means holding more. */
    public static float maxFor(float favor, float base, float perFavor) {
        return base + favor * perFavor;
    }

    public static float maxFor(float favor) {
        return maxFor(favor, 100f, 0.4f);
    }

    public float current() { return current; }

    public float debt() { return debt; }

    /** What a spend actually did — abilities need to know whether they pushed the player under. */
    public record Spend(float paidFromPool, float paidFromDebt, boolean overdrew) {}

    /**
     * Spends, allowing the player to go past empty. Never refuses: refusing is what a mana bar
     * does, and the books are about people who overreach.
     */
    public Spend spend(float cost) {
        if (cost <= 0f) return new Spend(0f, 0f, false);
        float fromPool = Math.min(current, cost);
        float remainder = cost - fromPool;
        current -= fromPool;
        debt += remainder;
        return new Spend(fromPool, remainder, remainder > 0f);
    }

    /** Regenerates toward the cap. Debt is not repaid here — see {@link #decayDebt}. */
    public void regenerate(float amount, float max) {
        if (amount <= 0f) return;
        current = Math.min(max, current + amount);
    }

    /**
     * Debt burns off only while the player is not casting. Casting through exhaustion keeps you
     * exhausted, which is the intended trap.
     */
    public void decayDebt(float amount, boolean casting) {
        if (casting || amount <= 0f) return;
        debt = Math.max(0f, debt - amount);
    }

    /**
     * How badly the player is paying for it, 0..1. Drives reduced max health, slowed movement, and
     * the dimmed screen edges — one number, so the effect and its presentation cannot disagree.
     */
    public float exhaustion(float max) {
        if (max <= 0f) return debt > 0f ? 1f : 0f;
        return Math.max(0f, Math.min(1f, debt / max));
    }

    public boolean exhausted() {
        return debt > 0f;
    }
}
