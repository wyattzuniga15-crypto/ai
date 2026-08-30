package dev.chronoly.core.favor;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * A demigod's standing with every god who has noticed them.
 *
 * <p>Pure: it holds numbers and applies events, and knows nothing about players, worlds, or ticks.
 * That is what lets the whole progression economy be tested at unit-test speed.
 */
public final class FavorLedger {

    public static final float MIN = 0f;
    public static final float MAX = 1000f;

    private final Map<String, Float> favor = new HashMap<>();

    /** The favor actually applied after clamping — which is not always what was asked for. */
    public record Delta(String god, float requested, float applied, float total) {
        /** True when the clamp swallowed some or all of the change. */
        public boolean clamped() {
            return Math.abs(requested - applied) > 1e-4f;
        }
    }

    public float get(String god) {
        return favor.getOrDefault(god, MIN);
    }

    public Tier tier(String god) {
        return Tier.forFavor(get(god));
    }

    public Map<String, Float> snapshot() {
        return Collections.unmodifiableMap(new HashMap<>(favor));
    }

    /** Applies an event using the reason's default coefficient. */
    public Delta apply(FavorEvent event) {
        return apply(event, event.reason().defaultAmount());
    }

    /**
     * Applies an event with an explicit coefficient, which is how the config overrides reach this
     * class without it ever knowing config exists.
     */
    public Delta apply(FavorEvent event, float coefficient) {
        float before = get(event.god());
        float requested = coefficient * event.multiplier();
        float after = clamp(before + requested);
        favor.put(event.god(), after);
        return new Delta(event.god(), requested, after - before, after);
    }

    /** Used by the Rebirth Token: a new parent starts at nothing, old standing is kept. */
    public void reset(String god) {
        favor.remove(god);
    }

    public void set(String god, float value) {
        favor.put(god, clamp(value));
    }

    private static float clamp(float v) {
        return Math.max(MIN, Math.min(MAX, v));
    }
}
