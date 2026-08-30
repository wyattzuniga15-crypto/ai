package dev.chronoly.core.energy;

import java.util.function.Predicate;

/**
 * One conditional rule in a god's regeneration profile.
 *
 * @param name  a stable id, so BALANCE.md and the config can name this clause
 * @param when  the condition
 * @param mode  how it combines
 * @param value the coefficient
 */
public record RegenClause(String name, Predicate<Surroundings> when, Mode mode, float value) {

    public enum Mode {
        /** Adds flat rate. Applied first. */
        ADD,
        /** Scales the accumulated rate. Applied second. */
        MULTIPLY,
        /** Imposes a ceiling. Applied last, and the lowest ceiling wins. */
        CLAMP
    }

    public static RegenClause add(String name, Predicate<Surroundings> when, float value) {
        return new RegenClause(name, when, Mode.ADD, value);
    }

    public static RegenClause multiply(String name, Predicate<Surroundings> when, float value) {
        return new RegenClause(name, when, Mode.MULTIPLY, value);
    }

    public static RegenClause clamp(String name, Predicate<Surroundings> when, float ceiling) {
        return new RegenClause(name, when, Mode.CLAMP, ceiling);
    }
}
