package dev.chronoly.core.favor;

/**
 * One thing that happened, addressed to one god.
 *
 * @param god        the god whose opinion is changing — favor is per-god, so you can be in good
 *                   standing with your parent and in trouble with Hermes at the same time
 * @param reason     what happened
 * @param multiplier scales the reason's coefficient for magnitude (a better offering, a bigger
 *                   quest). Must be non-negative; direction comes from the reason, never from here.
 */
public record FavorEvent(String god, FavorReason reason, float multiplier) {

    public FavorEvent {
        if (god == null || god.isBlank()) throw new IllegalArgumentException("god required");
        if (multiplier < 0f) throw new IllegalArgumentException("multiplier must be >= 0, was " + multiplier);
    }

    public static FavorEvent of(String god, FavorReason reason) {
        return new FavorEvent(god, reason, 1f);
    }
}
