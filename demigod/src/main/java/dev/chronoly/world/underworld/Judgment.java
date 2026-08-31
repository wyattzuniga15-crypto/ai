package dev.chronoly.world.underworld;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.core.judgment.LifetimeRecord;
import dev.chronoly.core.judgment.Verdict;
import dev.chronoly.registry.ChAttachments;
import dev.chronoly.registry.ChItems;
import dev.chronoly.world.ChDimensions;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.item.ItemStack;

/**
 * The Judgment Pavilion, and the ferryman who will not work for free.
 *
 * <p>The Lightning Thief, ch. 18 — a life gets weighed, and the answer routes you. The routing
 * logic itself lives in {@code core/judgment} and has been unit-tested from the first day of this
 * project; this is the part that puts a player somewhere because of it.
 */
public final class Judgment {

    private Judgment() {}

    /** Where each verdict puts you, relative to the Underworld's arrival point. */
    private record Destination(double x, double y, double z, String arrival) {}

    private static final Destination ASPHODEL = new Destination(8.5, 96, 8.5,
            "§7Asphodel. An endless grey crowd, and nobody is looking for you. "
            + "Most people end up here and most people are fine.");

    private static final Destination ELYSIUM = new Destination(180.5, 110, 8.5,
            "§6Elysium. §7It is warm, and it is beautiful, and leaving is going to be hard.");

    private static final Destination PUNISHMENT = new Destination(-180.5, 80, 8.5,
            "§4The Fields of Punishment. §7You did something specific to end up here, "
            + "and it is going to be brought up.");

    /** Weighs the record, moves the player, and applies what the verdict is worth. */
    public static Verdict judge(ServerPlayer player, DemigodData data) {
        LifetimeRecord record = recordOf(data);
        var ruling = dev.chronoly.core.judgment.Judgment.evaluate(record);

        Destination where = switch (ruling.verdict()) {
            case ELYSIUM -> ELYSIUM;
            case PUNISHMENT -> PUNISHMENT;
            case ASPHODEL -> ASPHODEL;
        };

        ChDimensions.travel(player, ChDimensions.UNDERWORLD, where.x(), where.y(), where.z());

        player.sendSystemMessage(Component.literal("§5§lThe Judgment Pavilion"));
        player.sendSystemMessage(Component.literal("§d\"" + ruling.because() + ".\""));
        player.sendSystemMessage(Component.literal(where.arrival()));

        switch (ruling.verdict()) {
            case ELYSIUM -> {
                data.raiseFlag("saw_elysium");
                player.addEffect(new MobEffectInstance(MobEffects.REGENERATION, 600, 1));
                player.addEffect(new MobEffectInstance(MobEffects.STRENGTH, 6000, 0));
                if (ruling.unlocksIslesOfTheBlest()) {
                    player.sendSystemMessage(Component.literal(
                            "§e§lThe Isles of the Blest open. §7Third time. Almost nobody manages it."));
                    data.raiseFlag("isles_of_the_blest");
                }
            }
            case PUNISHMENT -> {
                player.addEffect(new MobEffectInstance(MobEffects.WEAKNESS, 6000, 1));
                player.addEffect(new MobEffectInstance(MobEffects.SLOWNESS, 6000, 0));
            }
            case ASPHODEL -> player.addEffect(new MobEffectInstance(MobEffects.BLINDNESS, 100, 0));
        }

        ServerLevel level = (ServerLevel) player.level();
        level.playSound(null, player.blockPosition(), SoundEvents.BEACON_DEACTIVATE,
                SoundSource.AMBIENT, 1.0f, 0.5f);
        return ruling.verdict();
    }

    /**
     * Builds the record the pavilion reads. Kept small on purpose — every field here is something
     * the game already tracks rather than something invented for the ceremony.
     */
    private static LifetimeRecord recordOf(DemigodData data) {
        int quests = data.hasFlag("completed_quest") ? 2 : 0;
        int heroic = 0;
        if (data.hasFlag("killed_boss")) heroic += 3;
        if (data.hasFlag("saw_elysium")) heroic += 1;
        int elysiumLives = data.hasFlag("saw_elysium") ? 1 : 0;
        int innocents = data.hasFlag("killed_helpless") ? 3 : 0;
        int oaths = data.hasFlag("broke_oath") ? 1 : 0;
        float peak = data.parentage().map(data::favorWith).orElse(0f);

        return new LifetimeRecord(1, quests, 0, 0, oaths, innocents, 0, heroic, peak, elysiumLives);
    }

    /**
     * The Lightning Thief, ch. 17 — Charon does not ferry anybody for nothing. A drachma buys the
     * crossing back out; without one you wait, which is exactly the transaction in the book.
     */
    public static boolean payCharon(ServerPlayer player) {
        int slot = -1;
        var inv = player.getInventory();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            if (inv.getItem(i).is(ChItems.GOLDEN_DRACHMA.get())) {
                slot = i;
                break;
            }
        }
        if (slot < 0) {
            player.sendSystemMessage(Component.literal(
                    "§7Charon looks at your empty hands and goes back to his paperwork. "
                    + "§8A drachma, or you wait like everybody else."));
            return false;
        }

        inv.removeItem(slot, 1);
        player.sendSystemMessage(Component.literal(
                "§6The drachma disappears into an Italian suit. §7\"Mind the step.\""));
        ChDimensions.travel(player, net.minecraft.world.level.Level.OVERWORLD,
                player.getX(), 128, player.getZ());
        player.sendSystemMessage(Component.literal(
                "§7You come up somewhere ordinary, and the air is very loud."));

        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        data.setEnergy(data.maxEnergy() * 0.4f);
        data.setOverdraw(0f);
        return true;
    }

    /** Consolation for arriving with nothing: one drachma, once, so nobody is stuck forever. */
    public static void mercy(ServerPlayer player, DemigodData data) {
        if (!data.raiseFlag("charon_mercy")) return;
        player.getInventory().add(new ItemStack(ChItems.GOLDEN_DRACHMA.get()));
        player.sendSystemMessage(Component.literal(
                "§8Somebody presses a coin into your hand and does not explain. §7Once only."));
    }
}
