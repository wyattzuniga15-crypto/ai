package dev.chronoly.core.quest;

import java.util.List;

/**
 * One thing a quest is actually about, together with the ways a prophecy is allowed to refer to it.
 *
 * <p>The kennings matter as much as the id. A prophecy is ambiguous in phrasing and unambiguous in
 * mechanics, and that is only true if every poetic phrase is bound in advance to a concrete thing
 * the planner placed in the world.
 */
public record Element(Slot slot, String id, List<String> kennings) {

    public Element {
        if (kennings == null || kennings.isEmpty()) {
            throw new IllegalArgumentException("every element needs at least one kenning: " + id);
        }
        kennings = List.copyOf(kennings);
    }
}
