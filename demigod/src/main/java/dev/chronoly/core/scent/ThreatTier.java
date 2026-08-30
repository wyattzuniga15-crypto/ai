package dev.chronoly.core.scent;

/** How much attention the world is paying. Selects the spawn director's monster table. */
public enum ThreatTier {
    /** Nearly ignored. An unclaimed kid nobody has noticed yet. */
    UNSEEN,
    /** Something has caught the trail. */
    FAINT,
    /** You are on a list. */
    NOTICED,
    /** Things are coming specifically for you, and they are not the small ones. */
    HUNTED
}
