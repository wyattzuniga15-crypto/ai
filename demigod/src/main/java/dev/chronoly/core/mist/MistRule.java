package dev.chronoly.core.mist;

/**
 * The most important rule in the mod: who can hurt whom.
 *
 * <p>The Lightning Thief, ch. 6 and throughout — celestial bronze passes harmlessly through
 * mortals; mortal steel passes harmlessly through monsters; a demigod is hurt by both.
 *
 * <p>Pure and total, so every cell of the matrix is covered by a test rather than by hope.
 */
public final class MistRule {

    private MistRule() {}

    /** Whether a server enforces the rule. Strict is the default and should stay that way. */
    public enum Strictness { STRICT, RELAXED }

    public static Resolution resolve(Attack attack, Flesh target, Strictness strictness) {
        if (strictness == Strictness.RELAXED) return Resolution.FULL;
        return resolve(attack.axis(), target);
    }

    public static Resolution resolve(DamageAxis axis, Flesh target) {
        return switch (axis) {
            // The world does not care which world you belong to.
            case BYPASSING -> Resolution.FULL;

            // Bronze bites the immortal. It finds nothing to bite in a mortal.
            case DIVINE -> switch (target) {
                case MORTAL -> Resolution.PHASES_THROUGH;
                case MONSTER, IMMORTAL, DEMIGOD -> Resolution.FULL;
            };

            // A mortal blade finds nothing to bite in a monster.
            case MORTAL_STEEL -> switch (target) {
                case MONSTER, IMMORTAL -> Resolution.PHASES_THROUGH;
                case MORTAL, DEMIGOD -> Resolution.FULL;
            };
        };
    }

    /**
     * The lesson a player is owed the first time the rule surprises them. Returned once per player
     * per lesson; the world teaches the rule, not a wiki.
     */
    public enum Lesson {
        /** You swung bronze at someone's grandmother and it went straight through her. */
        BRONZE_THROUGH_MORTAL,
        /** You swung iron at a hellhound and it went straight through it. */
        STEEL_THROUGH_MONSTER
    }

    /** Which lesson, if any, this resolution should teach. */
    public static Lesson lessonFor(DamageAxis axis, Flesh target, Resolution resolution) {
        if (resolution != Resolution.PHASES_THROUGH) return null;
        return axis == DamageAxis.DIVINE ? Lesson.BRONZE_THROUGH_MORTAL : Lesson.STEEL_THROUGH_MONSTER;
    }
}
