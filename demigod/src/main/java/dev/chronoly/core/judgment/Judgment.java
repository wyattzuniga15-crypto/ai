package dev.chronoly.core.judgment;

/**
 * The Judgment Pavilion. Reads a life and routes it.
 *
 * <p>Punishment is checked before Elysium on purpose: a hero who broke an oath on the Styx is not
 * redeemed by the quests they finished first, and the books are unsentimental about that.
 */
public final class Judgment {

    private Judgment() {}

    /** Thresholds, all config-exposed and mirrored in BALANCE.md. */
    public record Thresholds(int innocentsForPunishment, int hubrisForPunishment,
                             int deedsForElysium, int questsForElysium, float favorForElysium,
                             int elysiumLifetimesForBlest) {
        public static Thresholds defaults() {
            return new Thresholds(3, 8, 5, 2, 700f, 3);
        }
    }

    /** The verdict plus the reason, so the pavilion can say it out loud in the books' register. */
    public record Ruling(Verdict verdict, String because, boolean unlocksIslesOfTheBlest) {}

    public static Ruling evaluate(LifetimeRecord r, Thresholds t) {
        if (r.oathsBroken() > 0) {
            return new Ruling(Verdict.PUNISHMENT, "you swore on the River Styx and thought better of it", false);
        }
        if (r.innocentsKilled() >= t.innocentsForPunishment()) {
            return new Ruling(Verdict.PUNISHMENT, "you killed what could not fight back", false);
        }
        if (r.hubrisActs() >= t.hubrisForPunishment()) {
            return new Ruling(Verdict.PUNISHMENT, "you were quite sure you had already won", false);
        }

        boolean heroic = r.heroicDeeds() >= t.deedsForElysium()
                || r.questsCompleted() >= t.questsForElysium()
                || r.peakFavor() >= t.favorForElysium();
        if (heroic) {
            boolean blest = r.elysiumLifetimes() + 1 >= t.elysiumLifetimesForBlest();
            return new Ruling(Verdict.ELYSIUM, "you did what you said you would do", blest);
        }
        return new Ruling(Verdict.ASPHODEL, "you were, on balance, fine", false);
    }

    public static Ruling evaluate(LifetimeRecord r) {
        return evaluate(r, Thresholds.defaults());
    }
}
