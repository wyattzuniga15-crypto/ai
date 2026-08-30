package dev.chronoly.core;

import dev.chronoly.core.mist.*;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The full matrix, every cell, both directions. This is the mod's most important rule, so it gets
 * exhaustive coverage rather than representative coverage.
 */
class MistRuleTest {

    @Test
    @DisplayName("celestial bronze passes harmlessly through mortals")
    void bronzeThroughMortal() {
        assertEquals(Resolution.PHASES_THROUGH,
                MistRule.resolve(Attack.divine(), Flesh.MORTAL, MistRule.Strictness.STRICT));
    }

    @Test
    @DisplayName("mortal steel passes harmlessly through monsters")
    void steelThroughMonster() {
        assertEquals(Resolution.PHASES_THROUGH,
                MistRule.resolve(Attack.mortalSteel(), Flesh.MONSTER, MistRule.Strictness.STRICT));
    }

    @Test
    @DisplayName("each weapon bites the world it belongs to")
    void eachBitesItsOwnWorld() {
        assertEquals(Resolution.FULL, MistRule.resolve(DamageAxis.DIVINE, Flesh.MONSTER));
        assertEquals(Resolution.FULL, MistRule.resolve(DamageAxis.DIVINE, Flesh.IMMORTAL));
        assertEquals(Resolution.FULL, MistRule.resolve(DamageAxis.MORTAL_STEEL, Flesh.MORTAL));
    }

    @Test
    @DisplayName("a demigod is half of each, and is hurt by both")
    void demigodIsHurtByBoth() {
        assertEquals(Resolution.FULL, MistRule.resolve(DamageAxis.DIVINE, Flesh.DEMIGOD));
        assertEquals(Resolution.FULL, MistRule.resolve(DamageAxis.MORTAL_STEEL, Flesh.DEMIGOD));
    }

    @Test
    @DisplayName("mortal steel cannot touch a god either")
    void steelThroughImmortal() {
        assertEquals(Resolution.PHASES_THROUGH, MistRule.resolve(DamageAxis.MORTAL_STEEL, Flesh.IMMORTAL));
    }

    @Test
    @DisplayName("fire, falling and drowning do not care which world you are in")
    void bypassingHitsEverything() {
        for (Flesh f : Flesh.values()) {
            assertEquals(Resolution.FULL, MistRule.resolve(DamageAxis.BYPASSING, f),
                    "bypassing damage should always land, failed on " + f);
        }
    }

    @Test
    @DisplayName("every cell of the matrix is decided — no nulls, no gaps")
    void matrixIsTotal() {
        for (DamageAxis axis : DamageAxis.values()) {
            for (Flesh flesh : Flesh.values()) {
                assertNotNull(MistRule.resolve(axis, flesh), axis + " vs " + flesh + " was undecided");
            }
        }
    }

    @Test
    @DisplayName("an unknown mod's sword is mortal steel by exclusion, so it still fails on monsters")
    void unknownWeaponsAreMortalByDefault() {
        // No divine tag, no divine damage type, no bypass tag — i.e. some other mod's new sword.
        Attack someOtherModsSword = new Attack(false, false, false);
        assertEquals(DamageAxis.MORTAL_STEEL, someOtherModsSword.axis());
        assertEquals(Resolution.PHASES_THROUGH,
                MistRule.resolve(someOtherModsSword, Flesh.MONSTER, MistRule.Strictness.STRICT),
                "a weapon nobody has tagged must still fail against a monster");
    }

    @Test
    @DisplayName("divine is recognised from the vanilla damage type as well as the weapon tag")
    void divineViaDamageComponent() {
        Attack viaComponent = new Attack(false, true, false);
        assertEquals(DamageAxis.DIVINE, viaComponent.axis());
    }

    @Test
    @DisplayName("bypassing outranks divine when both apply")
    void bypassWins() {
        assertEquals(DamageAxis.BYPASSING, new Attack(true, true, true).axis());
    }

    @Test
    @DisplayName("relaxed servers get vanilla behaviour everywhere")
    void relaxedDisablesTheRule() {
        assertEquals(Resolution.FULL,
                MistRule.resolve(Attack.divine(), Flesh.MORTAL, MistRule.Strictness.RELAXED));
        assertEquals(Resolution.FULL,
                MistRule.resolve(Attack.mortalSteel(), Flesh.MONSTER, MistRule.Strictness.RELAXED));
    }

    @Test
    @DisplayName("each phase-through teaches its own lesson, and a landed hit teaches none")
    void lessons() {
        assertEquals(MistRule.Lesson.BRONZE_THROUGH_MORTAL,
                MistRule.lessonFor(DamageAxis.DIVINE, Flesh.MORTAL, Resolution.PHASES_THROUGH));
        assertEquals(MistRule.Lesson.STEEL_THROUGH_MONSTER,
                MistRule.lessonFor(DamageAxis.MORTAL_STEEL, Flesh.MONSTER, Resolution.PHASES_THROUGH));
        assertNull(MistRule.lessonFor(DamageAxis.DIVINE, Flesh.MONSTER, Resolution.FULL));
    }
}
