package dev.chronoly.core.mist;

/** The outcome of putting an attack through {@link MistRule}. */
public enum Resolution {
    /** The blow lands. */
    FULL,
    /**
     * The blow passes through as though the target were not there. Not a miss, not a block —
     * the weapon and the flesh belong to different worlds. Deserves its own feedback, once.
     */
    PHASES_THROUGH
}
