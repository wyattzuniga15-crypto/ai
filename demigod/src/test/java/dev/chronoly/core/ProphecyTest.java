package dev.chronoly.core;

import dev.chronoly.core.quest.*;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.*;

import static org.junit.jupiter.api.Assertions.*;

/**
 * The roadmap's Phase 12 acceptance criterion, run as a test: 200 consecutively generated
 * prophecies must all scan as verse, rhyme correctly, and be mechanically solvable.
 */
class ProphecyTest {

    private static final List<Element> TARGETS = List.of(
            new Element(Slot.TARGET, "minotaur", List.of("the bull that walks upright", "your mother's last mistake")),
            new Element(Slot.TARGET, "medusa", List.of("the gaze that makes a garden", "the aunt with the bad temper")),
            new Element(Slot.TARGET, "hydra", List.of("the many-headed patience", "what grows back twice")));

    private static final List<Element> PLACES = List.of(
            new Element(Slot.PLACE, "labyrinth", List.of("the maze that hates you", "the door marked with a triangle")),
            new Element(Slot.PLACE, "underworld", List.of("the country under the country", "where the queue is longest")),
            new Element(Slot.PLACE, "sea_of_monsters", List.of("the water that forgets its charts")));

    private static final List<Element> RELICS = List.of(
            new Element(Slot.RELIC, "fleece", List.of("the golden wool", "the cure that heals the tree")),
            new Element(Slot.RELIC, "master_bolt", List.of("the stolen thunder", "the thing that was never yours")),
            new Element(Slot.RELIC, "chalice", List.of("the cup of the cupbearer")));

    private static final List<Element> COSTS = List.of(
            new Element(Slot.COST, "a_friend", List.of("the one who came with you", "a friend at the last door")),
            new Element(Slot.COST, "an_oath", List.of("a word you gave the river", "the promise you keep bringing up")),
            new Element(Slot.COST, "a_year", List.of("a year you will not get back")));

    private static QuestPlan plan(Random rng) {
        return new QuestPlan(
                TARGETS.get(rng.nextInt(TARGETS.size())),
                PLACES.get(rng.nextInt(PLACES.size())),
                RELICS.get(rng.nextInt(RELICS.size())),
                COSTS.get(rng.nextInt(COSTS.size())),
                24000L);
    }

    /** Recovers which corpus line produced a rendered line, so rhyme can be checked structurally. */
    private static Line sourceOf(ProphecyGrammar g, String rendered, Prophecy p) {
        for (Line l : g.corpus()) {
            String kenning = p.kenningUsed().get(l.slot());
            if (kenning != null && l.render(kenning).equals(rendered)) return l;
        }
        return null;
    }

    @Test
    @DisplayName("200 consecutive prophecies: five lines, two rhyming couplets, every objective named")
    void twoHundredProphecies() {
        ProphecyGrammar g = ProphecyGrammar.english();
        Random rng = new Random(20260830L);

        for (int i = 0; i < 200; i++) {
            QuestPlan plan = plan(rng);
            Prophecy p = g.compose(plan, rng);

            assertEquals(5, p.lines().size(), "prophecy " + i + " was not five lines");

            Line l1 = sourceOf(g, p.lines().get(0), p);
            Line l2 = sourceOf(g, p.lines().get(1), p);
            Line l3 = sourceOf(g, p.lines().get(2), p);
            Line l4 = sourceOf(g, p.lines().get(3), p);
            assertNotNull(l1); assertNotNull(l2); assertNotNull(l3); assertNotNull(l4);

            assertEquals(l1.rhyme(), l2.rhyme(), "prophecy " + i + ": first couplet does not rhyme");
            assertEquals(l3.rhyme(), l4.rhyme(), "prophecy " + i + ": second couplet does not rhyme");

            Set<Slot> named = new HashSet<>(List.of(l1.slot(), l2.slot(), l3.slot(), l4.slot()));
            assertEquals(EnumSet.allOf(Slot.class), named,
                    "prophecy " + i + " left an objective unnamed, which makes it unsolvable");

            // Every kenning spoken must trace back to something the planner actually placed.
            for (Map.Entry<Slot, String> e : p.kenningUsed().entrySet()) {
                Element el = plan.bySlot().get(e.getKey());
                assertTrue(el.kennings().contains(e.getValue()),
                        "prophecy " + i + " invented a phrase for " + e.getKey());
            }

            for (String line : p.lines()) {
                assertFalse(line.contains("{}"), "prophecy " + i + " left a slot unfilled");
                assertFalse(line.isBlank());
            }
        }
    }

    @Test
    @DisplayName("the same seed speaks the same prophecy")
    void deterministic() {
        Random r = new Random(7L);
        QuestPlan plan = plan(r);
        assertEquals(ProphecyGrammar.speak(plan, 99L).spoken(), ProphecyGrammar.speak(plan, 99L).spoken());
    }

    @Test
    @DisplayName("the text is a view of the objectives, never their source")
    void planSurvivesTheVerse() {
        Random r = new Random(3L);
        QuestPlan plan = plan(r);
        Prophecy p = ProphecyGrammar.english().compose(plan, new Random(11L));
        assertSame(plan, p.plan(),
                "the machine-readable quest must be carried alongside the verse, not parsed back out of it");
    }

    @Test
    @DisplayName("a quest without a deadline is rejected")
    void deadlineRequired() {
        Random r = new Random(1L);
        assertThrows(IllegalArgumentException.class, () -> new QuestPlan(
                TARGETS.get(0), PLACES.get(0), RELICS.get(0), COSTS.get(0), 0L));
    }

    @Test
    @DisplayName("an element with no kennings cannot exist — the verse would have nothing to say")
    void kenningsRequired() {
        assertThrows(IllegalArgumentException.class,
                () -> new Element(Slot.TARGET, "nameless", List.of()));
    }
}
