package dev.chronoly.core.mist;

/**
 * Which of the two worlds an attack belongs to.
 *
 * <p>The Lightning Thief, ch. 6 — Percy is told a mortal weapon is useless against a monster, and
 * the reverse: celestial bronze "would pass harmlessly through" a mortal. This enum is that rule's
 * first half.
 */
public enum DamageAxis {
    /** Celestial bronze, imperial gold, Stygian iron. Bites the immortal, not the mortal. */
    DIVINE,
    /** Everything else a mortal could swing. The default, by exclusion — see {@link MistRule}. */
    MORTAL_STEEL,
    /** Fire, falling, drowning, Greek fire, godly wrath. Indifferent to which world you are in. */
    BYPASSING
}
