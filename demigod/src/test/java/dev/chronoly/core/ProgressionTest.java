package dev.chronoly.core;

import dev.chronoly.core.energy.*;
import dev.chronoly.core.favor.*;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

class ProgressionTest {

    @Test
    @DisplayName("favor is per-god: standing with your parent is not standing with everyone")
    void favorIsPerGod() {
        FavorLedger l = new FavorLedger();
        l.apply(FavorEvent.of("poseidon", FavorReason.BURNT_OFFERING_BEST_FOOD));
        assertTrue(l.get("poseidon") > 0f);
        assertEquals(0f, l.get("ares"));
    }

    @Test
    @DisplayName("favor clamps at both ends and reports when it swallowed the change")
    void favorClamps() {
        FavorLedger l = new FavorLedger();
        var delta = l.apply(FavorEvent.of("hades", FavorReason.DEATH));
        assertEquals(0f, l.get("hades"), "cannot fall below nothing");
        assertTrue(delta.clamped(), "the ledger should report that the clamp ate the loss");

        l.set("hades", 990f);
        var gain = l.apply(FavorEvent.of("hades", FavorReason.COMPLETE_PROPHESIED_QUEST));
        assertEquals(1000f, l.get("hades"));
        assertTrue(gain.clamped());
    }

    @Test
    @DisplayName("breaking an oath on the Styx is the heaviest loss in the game")
    void styxOathIsTheWorst() {
        float oath = Math.abs(FavorReason.BREAK_STYX_OATH.defaultAmount());
        for (FavorReason r : FavorReason.values()) {
            if (r == FavorReason.BREAK_STYX_OATH || r.isGain()) continue;
            assertTrue(oath > Math.abs(r.defaultAmount()),
                    "an oath on the Styx should outweigh " + r);
        }
    }

    @Test
    @DisplayName("tiers derive from favor at the documented thresholds")
    void tiers() {
        assertEquals(Tier.T1, Tier.forFavor(0f));
        assertEquals(Tier.T1, Tier.forFavor(199f));
        assertEquals(Tier.T2, Tier.forFavor(200f));
        assertEquals(Tier.T3, Tier.forFavor(500f));
        assertEquals(Tier.T4, Tier.forFavor(850f));
        assertEquals(Tier.T4, Tier.forFavor(1000f));
        assertTrue(Tier.T3.atLeast(Tier.T2));
        assertFalse(Tier.T2.atLeast(Tier.T3));
    }

    @Test
    @DisplayName("a rebirth keeps what you earned with the old god and starts the new one at nothing")
    void rebirthKeepsOldStanding() {
        FavorLedger l = new FavorLedger();
        l.set("poseidon", 640f);
        l.set("athena", 0f);
        l.reset("athena");
        assertEquals(640f, l.get("poseidon"));
        assertEquals(0f, l.get("athena"));
    }

    // ---- energy -------------------------------------------------------------------------------

    @Test
    @DisplayName("you may always overreach; the bill arrives as debt, not as a refusal")
    void overdrawIsAllowed() {
        EnergyPool pool = new EnergyPool(30f);
        EnergyPool.Spend spend = pool.spend(100f);
        assertTrue(spend.overdrew());
        assertEquals(30f, spend.paidFromPool(), 1e-4);
        assertEquals(70f, spend.paidFromDebt(), 1e-4);
        assertEquals(0f, pool.current(), 1e-4);
        assertEquals(70f, pool.debt(), 1e-4);
        assertTrue(pool.exhausted());
    }

    @Test
    @DisplayName("exhaustion burns off only while you stop casting")
    void debtDecaysOnlyAtRest() {
        EnergyPool pool = new EnergyPool(0f);
        pool.spend(50f);

        pool.decayDebt(10f, true);
        assertEquals(50f, pool.debt(), 1e-4, "casting through exhaustion keeps you exhausted");

        pool.decayDebt(10f, false);
        assertEquals(40f, pool.debt(), 1e-4);
    }

    @Test
    @DisplayName("exhaustion severity is one number, so the effect and its presentation cannot disagree")
    void exhaustionIsNormalised() {
        EnergyPool pool = new EnergyPool(0f);
        pool.spend(50f);
        assertEquals(0.5f, pool.exhaustion(100f), 1e-4);
        pool.spend(500f);
        assertEquals(1f, pool.exhaustion(100f), 1e-4, "severity saturates rather than running away");
    }

    @Test
    @DisplayName("the pool grows with favor, so getting stronger means holding more")
    void maxScalesWithFavor() {
        assertTrue(EnergyPool.maxFor(1000f) > EnergyPool.maxFor(0f));
    }

    // ---- regeneration profiles ----------------------------------------------------------------

    @Test
    @DisplayName("Poseidon is a different resource in the sea than in a desert")
    void poseidonDependsOnWater() {
        EnergyProfile p = EnergyProfile.poseidon();
        Surroundings sea = new Surroundings(true, true, false, false, 62, false, false, false, true,
                true, false, false, 15, false, false, false, false, false, false, false, 0, false, 0d, false);
        Surroundings desert = new Surroundings(false, false, true, false, 70, false, false, false,
                true, true, false, false, 15, false, false, false, false, false, false, false, 0, false, 0d, false);

        assertTrue(p.rateIn(sea) > p.rateIn(Surroundings.plain()));
        assertTrue(p.rateIn(desert) < 0.1f, "a desert should very nearly switch him off");
    }

    @Test
    @DisplayName("Zeus is poor underground and rich in a storm; Hades is the mirror of it")
    void skyAndUnderworldAreOpposites() {
        Surroundings storm = new Surroundings(false, false, false, false, 140, false, true, true,
                true, true, false, false, 12, false, false, false, false, false, false, false, 0, false, 0d, false);
        Surroundings deepDark = new Surroundings(false, false, false, false, 12, true, false, false,
                false, false, false, false, 0, true, false, false, false, false, false, false, 0, false, 0d, false);

        assertTrue(EnergyProfile.zeus().rateIn(storm) > EnergyProfile.zeus().rateIn(deepDark));
        assertTrue(EnergyProfile.hades().rateIn(deepDark) > EnergyProfile.hades().rateIn(storm));
    }

    @Test
    @DisplayName("Apollo goes out at night")
    void apolloNeedsTheSun() {
        Surroundings night = new Surroundings(false, false, false, false, 64, false, false, false,
                true, false, true, false, 4, false, true, false, false, false, false, false, 0, false, 0d, false);
        assertTrue(EnergyProfile.apollo().rateIn(night) <= 0.05f);
        assertTrue(EnergyProfile.apollo().rateIn(Surroundings.plain()) > 1f);
    }

    @Test
    @DisplayName("Alaska is beyond the gods' reach, and therefore beyond all eight of them")
    void alaskaSilencesEveryone() {
        Surroundings alaska = new Surroundings(false, true, false, false, 80, false, false, false,
                true, true, false, true, 15, false, true, false, false, true, true, true, 5, true, 500d, true);
        for (EnergyProfile p : EnergyProfile.v1()) {
            assertEquals(0f, p.rateIn(alaska), 1e-6, p.god() + " should get nothing in Alaska");
        }
    }

    @Test
    @DisplayName("all eight v1.0 parents have a profile and none of them regenerates for free")
    void everyParentHasAProfile() {
        assertEquals(8, EnergyProfile.v1().size());
        for (EnergyProfile p : EnergyProfile.v1()) {
            assertTrue(p.rateIn(Surroundings.plain()) >= 0f);
            assertFalse(p.clauses().isEmpty(), p.god() + " has no conditions, which makes it flavourless");
        }
    }
}
