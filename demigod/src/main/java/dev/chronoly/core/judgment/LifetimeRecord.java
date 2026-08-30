package dev.chronoly.core.judgment;

/**
 * What the judges of the dead have to go on. The Lightning Thief, ch. 18 — the Judgment Pavilion
 * weighs a life, not a scoreboard, so this record is written by deeds and read exactly once.
 */
public record LifetimeRecord(
        int deaths,
        int questsCompleted,
        int questsFailed,
        int oathsSworn,
        int oathsBroken,
        int innocentsKilled,
        int hubrisActs,
        int heroicDeeds,
        float peakFavor,
        int elysiumLifetimes) {

    public static LifetimeRecord fresh() {
        return new LifetimeRecord(0, 0, 0, 0, 0, 0, 0, 0, 0f, 0);
    }

    public LifetimeRecord withDeath() {
        return new LifetimeRecord(deaths + 1, questsCompleted, questsFailed, oathsSworn,
                oathsBroken, innocentsKilled, hubrisActs, heroicDeeds, peakFavor, elysiumLifetimes);
    }

    public LifetimeRecord withElysium() {
        return new LifetimeRecord(deaths, questsCompleted, questsFailed, oathsSworn, oathsBroken,
                innocentsKilled, hubrisActs, heroicDeeds, peakFavor, elysiumLifetimes + 1);
    }
}
