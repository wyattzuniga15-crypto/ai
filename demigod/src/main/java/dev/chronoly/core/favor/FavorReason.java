package dev.chronoly.core.favor;

/**
 * Every way a god comes to think more, or less, of you.
 *
 * <p>Drawn from the brief's §4.2. Coefficients here are the <em>defaults</em>; every one is
 * config-exposed and mirrored in BALANCE.md, so nothing in the economy is hardcoded.
 */
public enum FavorReason {

    // ---- gains -------------------------------------------------------------------------------
    /**
     * The Lightning Thief, ch. 7 — you scrape the best part of your meal into the fire. The books
     * are specific that it is the best portion, not the leftovers, so the mod scores the offering
     * by nutrition and saturation rather than counting items.
     */
    BURNT_OFFERING_BEST_FOOD(12f),
    /** Killing something that stands against your parent. */
    SLAY_OPPOSED_MONSTER(6f),
    /** Finishing what the Oracle set you. The single largest honest gain in the game. */
    COMPLETE_PROPHESIED_QUEST(120f),
    /** Doing something your parent would have done. */
    PARENT_ALIGNED_DEED(8f),
    /** Athena — crafting a kind of thing you have never made before. Invention, not repetition. */
    FIRST_CRAFT_OF_TYPE(10f),
    /** Ares — winning a fight you should have lost. */
    WIN_FIGHT_NEAR_DEATH(15f),
    /** Hermes — a theft or a delivery that came off. */
    SUCCESSFUL_ERRAND(7f),
    /** Demeter — bringing in a grown crop. */
    HARVEST_MATURE_CROPS(3f),
    /** Hephaestus — work done at the forge in celestial bronze. */
    FORGE_CELESTIAL_BRONZE(9f),
    /** Hades — burying what you killed. The dead are his, and he notices who is careless. */
    BURIAL_RITE(5f),

    // ---- losses ------------------------------------------------------------------------------
    /** Hubris. Declaring the fight won before it is. The gods have opinions about this. */
    BOAST(-20f),
    /** Killing something that could not fight back. */
    KILL_HELPLESS(-25f),
    /** Dying. Embarrassing for everyone. */
    DEATH(-40f),
    /**
     * The Last Olympian, ch. 4 — an oath on the Styx is not a promise, it is a mechanism. Breaking
     * one is the heaviest single loss in the mod and it is meant to be frightening.
     */
    BREAK_STYX_OATH(-150f),
    /** Harming a god's sacred animal, which is a specific and personal insult. */
    HARM_SACRED_ANIMAL(-35f);

    private final float defaultAmount;

    FavorReason(float defaultAmount) {
        this.defaultAmount = defaultAmount;
    }

    public float defaultAmount() {
        return defaultAmount;
    }

    public boolean isGain() {
        return defaultAmount > 0f;
    }
}
