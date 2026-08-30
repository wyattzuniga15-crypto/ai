package dev.chronoly.core;

import dev.chronoly.core.judgment.*;
import dev.chronoly.core.scent.*;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class JudgmentAndScentTest {

    @Test
    @DisplayName("an ordinary life goes to Asphodel")
    void ordinaryLife() {
        assertEquals(Verdict.ASPHODEL, Judgment.evaluate(LifetimeRecord.fresh()).verdict());
    }

    @Test
    @DisplayName("heroism earns Elysium")
    void heroismEarnsElysium() {
        LifetimeRecord hero = new LifetimeRecord(1, 3, 0, 2, 0, 0, 0, 6, 820f, 0);
        assertEquals(Verdict.ELYSIUM, Judgment.evaluate(hero).verdict());
    }

    @Test
    @DisplayName("a broken oath outweighs every quest you finished first")
    void punishmentOutranksHeroism() {
        LifetimeRecord oathbreaker = new LifetimeRecord(1, 9, 0, 4, 1, 0, 0, 20, 1000f, 2);
        Judgment.Ruling r = Judgment.evaluate(oathbreaker);
        assertEquals(Verdict.PUNISHMENT, r.verdict(),
                "the books are unsentimental about this: prior heroism does not redeem it");
        assertTrue(r.because().contains("Styx"));
    }

    @Test
    @DisplayName("killing the helpless, and sustained hubris, both land you in Punishment")
    void otherRoadsToPunishment() {
        assertEquals(Verdict.PUNISHMENT,
                Judgment.evaluate(new LifetimeRecord(0, 0, 0, 0, 0, 3, 0, 0, 0f, 0)).verdict());
        assertEquals(Verdict.PUNISHMENT,
                Judgment.evaluate(new LifetimeRecord(0, 0, 0, 0, 0, 0, 8, 0, 0f, 0)).verdict());
    }

    @Test
    @DisplayName("the third Elysium lifetime unlocks the Isles of the Blest")
    void islesOfTheBlest() {
        LifetimeRecord twice = new LifetimeRecord(2, 4, 0, 0, 0, 0, 0, 9, 900f, 2);
        Judgment.Ruling r = Judgment.evaluate(twice);
        assertEquals(Verdict.ELYSIUM, r.verdict());
        assertTrue(r.unlocksIslesOfTheBlest(), "this death is the third — the Isles should open");

        LifetimeRecord once = new LifetimeRecord(1, 4, 0, 0, 0, 0, 0, 9, 900f, 0);
        assertFalse(Judgment.evaluate(once).unlocksIslesOfTheBlest());
    }

    @Test
    @DisplayName("every ruling says why, so the pavilion can speak it aloud")
    void everyRulingIsExplained() {
        for (LifetimeRecord r : new LifetimeRecord[]{
                LifetimeRecord.fresh(),
                new LifetimeRecord(1, 3, 0, 2, 0, 0, 0, 6, 820f, 0),
                new LifetimeRecord(1, 0, 0, 1, 1, 0, 0, 0, 0f, 0)}) {
            assertFalse(Judgment.evaluate(r).because().isBlank());
        }
    }

    // ---- scent --------------------------------------------------------------------------------

    @Test
    @DisplayName("a ward zeroes scent outright — this is what makes camp home rather than safer")
    void wardsZeroScent() {
        var loud = new ScentModel.Inputs(1000f, 1f, 6, 10, false);
        var warded = new ScentModel.Inputs(1000f, 1f, 6, 10, true);
        assertEquals(1f, ScentModel.compute(loud), 1e-4);
        assertEquals(0f, ScentModel.compute(warded), 1e-4);
        assertEquals(ThreatTier.UNSEEN, ScentModel.threat(ScentModel.compute(warded)));
    }

    @Test
    @DisplayName("power raises scent — the loop the whole mod depends on")
    void powerRaisesThreat() {
        float weak = ScentModel.compute(new ScentModel.Inputs(0f, 0.1f, 0, 0, false));
        float strong = ScentModel.compute(new ScentModel.Inputs(900f, 1f, 4, 6, false));
        assertTrue(strong > weak, "getting stronger must raise the stakes, never flatten them");
        assertEquals(ThreatTier.UNSEEN, ScentModel.threat(weak));
        assertEquals(ThreatTier.HUNTED, ScentModel.threat(strong));
    }

    @Test
    @DisplayName("a child of the Big Three cannot hide by digging down")
    void diggingDownIsNotAStrategy() {
        float bigThree = ScentModel.compute(new ScentModel.Inputs(700f, 1f, 3, 4, false));
        assertFalse(ScentModel.canHideUnderground(bigThree));

        float unclaimedKid = ScentModel.compute(new ScentModel.Inputs(20f, 0.1f, 0, 0, false));
        assertTrue(ScentModel.canHideUnderground(unclaimedKid),
                "a new player must still be able to hide, or onboarding is cruel");
    }

    @Test
    @DisplayName("scent stays inside 0..1 however extreme the inputs")
    void scentIsBounded() {
        assertEquals(1f, ScentModel.compute(new ScentModel.Inputs(99999f, 99f, 999, 999, false)), 1e-4);
        assertEquals(0f, ScentModel.compute(new ScentModel.Inputs(0f, 0f, 0, 0, false)), 1e-4);
    }
}
