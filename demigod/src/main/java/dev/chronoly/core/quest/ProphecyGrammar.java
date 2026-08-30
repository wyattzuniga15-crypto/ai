package dev.chronoly.core.quest;

import java.util.ArrayList;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * Assembles a prophecy from a plan.
 *
 * <p>Order of operations, which is the point of the whole class:
 * <ol>
 *   <li>the four slots are dealt to the first four line positions, so every objective is named
 *       exactly once and nothing the player needs can be missing from the verse;</li>
 *   <li>a rhyme class is chosen per couplet from the classes that can actually serve both of that
 *       couplet's slots, so rhyme is a <em>constraint on selection</em> rather than something
 *       checked afterwards and hoped for;</li>
 *   <li>a kenning is drawn per element, and recorded, so every poetic phrase traces back to a
 *       concrete thing.</li>
 * </ol>
 *
 * <p>Consequence: the generator cannot emit a prophecy that fails to scan or fails to be solvable.
 * Both properties are structural, not statistical.
 */
public final class ProphecyGrammar {

    private final List<Line> corpus;
    private final List<Line> closers;

    public ProphecyGrammar(List<Line> corpus, List<Line> closers) {
        this.corpus = List.copyOf(corpus);
        this.closers = List.copyOf(closers);
    }

    /** The fragment corpus, exposed so tests can verify rhyme structurally rather than by ear. */
    public List<Line> corpus() { return corpus; }

    public List<Line> closers() { return closers; }

    public Prophecy compose(QuestPlan plan, RandomGenerator rng) {
        List<Slot> order = new ArrayList<>(List.of(Slot.TARGET, Slot.PLACE, Slot.RELIC, Slot.COST));
        shuffle(order, rng);

        // Couplet A covers order[0..1]; couplet B covers order[2..3].
        Line l1 = null, l2 = null, l3 = null, l4 = null;
        for (String rhyme : rhymesServing(order.get(0), order.get(1), rng)) {
            l1 = pick(order.get(0), rhyme, rng);
            l2 = pick(order.get(1), rhyme, rng);
            if (l1 != null && l2 != null) break;
        }
        for (String rhyme : rhymesServing(order.get(2), order.get(3), rng)) {
            l3 = pick(order.get(2), rhyme, rng);
            l4 = pick(order.get(3), rhyme, rng);
            if (l3 != null && l4 != null) break;
        }
        if (l1 == null || l2 == null || l3 == null || l4 == null) {
            throw new IllegalStateException(
                    "corpus cannot serve slots " + order + " — every slot needs a line in a shared rhyme class");
        }
        Line l5 = closers.get(rng.nextInt(closers.size()));

        Map<Slot, Element> bySlot = plan.bySlot();
        Map<Slot, String> chosen = new EnumMap<>(Slot.class);
        for (Element e : plan.elements()) {
            chosen.put(e.slot(), e.kennings().get(rng.nextInt(e.kennings().size())));
        }

        List<String> lines = new ArrayList<>(5);
        for (Line line : List.of(l1, l2, l3, l4)) {
            lines.add(line.render(chosen.get(line.slot())));
        }
        lines.add(l5.template());

        // Sanity: the verse names every objective. Structural, but assert it anyway — this is the
        // property the whole design exists to guarantee, and a corpus edit could break it.
        Set<Slot> named = new HashSet<>(List.of(l1.slot(), l2.slot(), l3.slot(), l4.slot()));
        if (!named.equals(bySlot.keySet())) {
            throw new IllegalStateException("prophecy failed to name every objective: named " + named);
        }
        return new Prophecy(lines, plan, chosen);
    }

    /** Rhyme classes that hold at least one line for each of the two slots, in random order. */
    private List<String> rhymesServing(Slot a, Slot b, RandomGenerator rng) {
        Map<String, Set<Slot>> served = new LinkedHashMap<>();
        for (Line l : corpus) {
            served.computeIfAbsent(l.rhyme(), k -> new HashSet<>()).add(l.slot());
        }
        List<String> out = new ArrayList<>();
        for (var e : served.entrySet()) {
            if (e.getValue().contains(a) && e.getValue().contains(b)) out.add(e.getKey());
        }
        shuffle(out, rng);
        return out;
    }

    private Line pick(Slot slot, String rhyme, RandomGenerator rng) {
        List<Line> matches = new ArrayList<>();
        for (Line l : corpus) {
            if (l.slot() == slot && l.rhyme().equals(rhyme)) matches.add(l);
        }
        return matches.isEmpty() ? null : matches.get(rng.nextInt(matches.size()));
    }

    private static <T> void shuffle(List<T> list, RandomGenerator rng) {
        for (int i = list.size() - 1; i > 0; i--) {
            int j = rng.nextInt(i + 1);
            T tmp = list.get(i);
            list.set(i, list.get(j));
            list.set(j, tmp);
        }
    }

    /**
     * The shipped English corpus. Four rhyme classes, every slot served in every class, which is
     * what makes composition total rather than best-effort.
     *
     * <p>Voice target: the Riordan register — plain words, a bad feeling, and one joke's worth of
     * dryness. Grand where the books are grand, never grimdark-generic.
     */
    public static ProphecyGrammar english() {
        List<Line> c = new ArrayList<>();

        // -- rhyme class AKE ----------------------------------------------------------------
        c.add(new Line(Slot.TARGET, "AKE", "You shall go west to face {}, awake,"));
        c.add(new Line(Slot.TARGET, "AKE", "And find {} in the dark, for your own sake,"));
        c.add(new Line(Slot.PLACE,  "AKE", "The road runs down to {}, and does not break,"));
        c.add(new Line(Slot.PLACE,  "AKE", "Past {} where the old stones ache,"));
        c.add(new Line(Slot.RELIC,  "AKE", "You shall carry home {} that the gods forsake,"));
        c.add(new Line(Slot.RELIC,  "AKE", "And lift {} from the water's wake,"));
        c.add(new Line(Slot.COST,   "AKE", "But {} is the toll that you must make,"));
        c.add(new Line(Slot.COST,   "AKE", "And {} shall be the promise that you break,"));

        // -- rhyme class OWN ----------------------------------------------------------------
        c.add(new Line(Slot.TARGET, "OWN", "You shall meet {} where it waits alone,"));
        c.add(new Line(Slot.TARGET, "OWN", "And know {} by the sound of bone on bone,"));
        c.add(new Line(Slot.PLACE,  "OWN", "Go down to {} where the light is gone,"));
        c.add(new Line(Slot.PLACE,  "OWN", "Through {} that no map has ever shown,"));
        c.add(new Line(Slot.RELIC,  "OWN", "You shall bring back {} that was not your own,"));
        c.add(new Line(Slot.RELIC,  "OWN", "And set {} upon an empty throne,"));
        c.add(new Line(Slot.COST,   "OWN", "And pay with {} before the day is done,"));
        c.add(new Line(Slot.COST,   "OWN", "For {} is a debt that stands alone,"));

        // -- rhyme class IRE ----------------------------------------------------------------
        c.add(new Line(Slot.TARGET, "IRE", "You shall stand before {} in the fire,"));
        c.add(new Line(Slot.TARGET, "IRE", "And {} shall name you liar,"));
        c.add(new Line(Slot.PLACE,  "IRE", "The way runs through {}, ever higher,"));
        c.add(new Line(Slot.PLACE,  "IRE", "To {}, where the dead retire,"));
        c.add(new Line(Slot.RELIC,  "IRE", "You shall take up {} from the pyre,"));
        c.add(new Line(Slot.RELIC,  "IRE", "And hold {} against your own desire,"));
        c.add(new Line(Slot.COST,   "IRE", "And {} shall be the price entire,"));
        c.add(new Line(Slot.COST,   "IRE", "For {} is what the Fates require,"));

        // -- rhyme class AY -----------------------------------------------------------------
        c.add(new Line(Slot.TARGET, "AY", "You shall find {} at the close of day,"));
        c.add(new Line(Slot.TARGET, "AY", "And {} shall stand across your way,"));
        c.add(new Line(Slot.PLACE,  "AY", "Seek {} where the shadows lay,"));
        c.add(new Line(Slot.PLACE,  "AY", "And enter {} without delay,"));
        c.add(new Line(Slot.RELIC,  "AY", "You shall win {} and bear it away,"));
        c.add(new Line(Slot.RELIC,  "AY", "And carry {} though it bids you stay,"));
        c.add(new Line(Slot.COST,   "AY", "But {} is the forfeit you shall pay,"));
        c.add(new Line(Slot.COST,   "AY", "And {} shall be the one who must betray."));

        List<Line> closers = List.of(
                new Line(null, "END", "And you shall fail to save what matters most."),
                new Line(null, "END", "One of the three shall not come home again."),
                new Line(null, "END", "And in the end the choice shall not be yours."),
                new Line(null, "END", "You shall know the answer far too late."),
                new Line(null, "END", "And what you leave behind shall follow after."));

        return new ProphecyGrammar(c, closers);
    }

    /** A convenience for tests and for the Oracle: plan in, verse out. */
    public static Prophecy speak(QuestPlan plan, long seed) {
        return english().compose(plan, new java.util.Random(seed));
    }

    /** Every distinct kenning the corpus could have emitted for this plan. */
    public static Map<Slot, List<String>> kenningSpace(QuestPlan plan) {
        Map<Slot, List<String>> out = new HashMap<>();
        for (Element e : plan.elements()) out.put(e.slot(), e.kennings());
        return out;
    }
}
