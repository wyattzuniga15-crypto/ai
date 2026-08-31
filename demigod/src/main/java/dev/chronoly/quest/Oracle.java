package dev.chronoly.quest;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.boss.BossKind;
import dev.chronoly.core.quest.Element;
import dev.chronoly.core.quest.Prophecy;
import dev.chronoly.core.quest.ProphecyGrammar;
import dev.chronoly.core.quest.QuestPlan;
import dev.chronoly.core.quest.Slot;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;

import java.util.List;
import java.util.Random;

/**
 * The Oracle, finally speaking.
 *
 * <p>The generator in {@code core/quest} has been tested against 200 consecutive prophecies since
 * the first day of this project and never had anything call it. This is the thing that calls it:
 * a planner picks a real, solvable objective set first, and the verse is assembled as a view of
 * that plan — never parsed back out of it.
 */
public final class Oracle {

    private Oracle() {}

    private static final List<Element> PLACES = List.of(
            new Element(Slot.PLACE, "underworld",
                    List.of("the country under the country", "where the queue is longest",
                            "the shore that everybody reaches")),
            new Element(Slot.PLACE, "olympus",
                    List.of("the floor that is not on the button panel", "the marble above the smog")),
            new Element(Slot.PLACE, "overworld",
                    List.of("the ordinary world, which is worse", "the fields you already know")));

    private static final List<Element> RELICS = List.of(
            new Element(Slot.RELIC, "golden_drachma",
                    List.of("the ferryman's fee", "the coin that opens the last door")),
            new Element(Slot.RELIC, "celestial_bronze_ingot",
                    List.of("the metal that bites the deathless", "what the forge owes you")),
            new Element(Slot.RELIC, "ambrosia",
                    List.of("the food that is not for you", "a taste of somebody else's kitchen")));

    private static final List<Element> COSTS = List.of(
            new Element(Slot.COST, "your_strength",
                    List.of("the strength you were saving", "what you had left over")),
            new Element(Slot.COST, "a_promise",
                    List.of("a word you gave the river", "the promise you keep bringing up")),
            new Element(Slot.COST, "the_way_back",
                    List.of("the road you came in by", "the door behind you")));

    /** Speaks a prophecy and binds the player to the quest it encodes. */
    public static Prophecy consult(ServerPlayer player, DemigodData data) {
        Random rng = new Random(player.getUUID().getLeastSignificantBits() ^ player.level().getGameTime());

        BossKind target = BossKind.values()[rng.nextInt(BossKind.values().length)];
        Element targetEl = new Element(Slot.TARGET, target.id(), kenningsFor(target));
        Element place = PLACES.get(rng.nextInt(PLACES.size()));
        Element relic = RELICS.get(rng.nextInt(RELICS.size()));
        Element cost = COSTS.get(rng.nextInt(COSTS.size()));

        QuestPlan plan = new QuestPlan(targetEl, place, relic, cost, 72000L);
        Prophecy prophecy = ProphecyGrammar.english().compose(plan, rng);

        data.setQuest(target.id(), place.id(), player.level().getGameTime() + plan.deadlineTicks());

        ServerLevel level = (ServerLevel) player.level();
        level.playSound(null, player.blockPosition(), SoundEvents.ENDER_DRAGON_AMBIENT,
                SoundSource.AMBIENT, 0.6f, 1.7f);

        player.sendSystemMessage(Component.literal("§5§lThe Oracle of Delphi"));
        for (String line : prophecy.lines()) {
            player.sendSystemMessage(Component.literal("§d" + line));
        }
        player.sendSystemMessage(Component.literal(
                "§7Your quest: §fdestroy " + target.title + "§7. §8/chronoly quest to check."));
        return prophecy;
    }

    private static List<String> kenningsFor(BossKind kind) {
        return switch (kind) {
            case MINOTAUR -> List.of("the bull that walks upright", "your mother's last mistake");
            case HYDRA -> List.of("the many-headed patience", "what grows back twice");
            case CERBERUS -> List.of("the three-headed doorman", "what waits at the gate");
            case FURY -> List.of("the kindly one who is not", "the teacher with the wrong wings");
            case LYDIAN_DRAKON -> List.of("the armoured old thing", "what the prophecy named");
            case MEDUSA -> List.of("the aunt with the bad temper", "the gaze that makes a garden");
            case NEMEAN_LION -> List.of("the hide that turns everything", "what only opens once");
            case CHIMERA -> List.of("three deaths in one body", "the thing with the wrong number of heads");
        };
    }
}
