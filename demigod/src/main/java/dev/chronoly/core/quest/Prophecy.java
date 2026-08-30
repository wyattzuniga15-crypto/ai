package dev.chronoly.core.quest;

import java.util.List;
import java.util.Map;

/**
 * Five lines: two rhyming couplets and a closing line.
 *
 * @param lines        the verse, as the Oracle speaks it
 * @param plan         the objectives it encodes — the machine-readable truth
 * @param kenningUsed  which kenning stood for which slot, so the tracker can highlight the phrase
 *                     that turned out to matter once the player works it out
 */
public record Prophecy(List<String> lines, QuestPlan plan, Map<Slot, String> kenningUsed) {

    public Prophecy {
        if (lines.size() != 5) throw new IllegalArgumentException("a prophecy is five lines, got " + lines.size());
        lines = List.copyOf(lines);
        kenningUsed = Map.copyOf(kenningUsed);
    }

    public String spoken() {
        return String.join("\n", lines);
    }
}
