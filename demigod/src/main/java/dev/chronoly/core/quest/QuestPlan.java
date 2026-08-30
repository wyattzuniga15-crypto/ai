package dev.chronoly.core.quest;

import java.util.List;
import java.util.Map;

/**
 * A solvable objective set, chosen <em>before</em> a single word of verse exists.
 *
 * <p>This ordering is the whole design. The text is a view of the plan; the plan is never recovered
 * by parsing the text. A class of bug where a beautiful prophecy describes an impossible quest
 * cannot occur, because the quest existed first.
 */
public record QuestPlan(Element target, Element place, Element relic, Element cost, long deadlineTicks) {

    public QuestPlan {
        require(target, Slot.TARGET);
        require(place, Slot.PLACE);
        require(relic, Slot.RELIC);
        require(cost, Slot.COST);
        if (deadlineTicks <= 0) throw new IllegalArgumentException("a quest without a deadline is a hobby");
    }

    private static void require(Element e, Slot expected) {
        if (e == null || e.slot() != expected) {
            throw new IllegalArgumentException("expected a " + expected + " element, got " + e);
        }
    }

    public Map<Slot, Element> bySlot() {
        return Map.of(Slot.TARGET, target, Slot.PLACE, place, Slot.RELIC, relic, Slot.COST, cost);
    }

    public List<Element> elements() {
        return List.of(target, place, relic, cost);
    }
}
