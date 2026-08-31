package dev.chronoly.world.onboard;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.registry.ChAttachments;
import dev.chronoly.registry.ChItems;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.entity.EntitySpawnReason;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.Mob;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.item.ItemStack;

/**
 * The satyr who finds you.
 *
 * <p>The Lightning Thief — Grover is at the school before Percy knows there is anything to know.
 * The brief is explicit that this is the onboarding path and that a tutorial book is not: a new
 * player should be found, told, and pointed somewhere, by something that walks up to them.
 *
 * <p>Satyrs smell demigods, so the trigger is the same scent the monsters use. If you are worth
 * hunting, you are worth rescuing, and both arrive at once.
 */
public final class SatyrGuide {

    private SatyrGuide() {}

    private static int tick;

    /** Lines the satyr uses, in order, one per encounter. */
    private static final String[] SCRIPT = {
            "§aA satyr falls into step beside you. §f\"Don't panic. Keep walking. Act normal.\"",
            "§f\"You're not going crazy. The things you've been seeing are real, "
                    + "and they've noticed you back.\"",
            "§f\"There's a place they can't follow. I can get you there — "
                    + "§ecraft a golden drachma and stand on gold§f, and they lose the scent.\"",
            "§f\"Kill something that shouldn't exist and your parent will speak for you. "
                    + "That's how it works. That's how it's always worked.\"",
    };

    /** Runs every ten seconds; only ever touches unclaimed players. */
    public static void tick(ServerLevel level) {
        if (++tick % 200 != 0) return;

        for (ServerPlayer player : level.players()) {
            DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
            if (data.isClaimed()) continue;
            if (data.hasFlag("satyr_done")) continue;

            int stage = stageOf(data);
            if (stage >= SCRIPT.length) {
                data.raiseFlag("satyr_done");
                continue;
            }
            // Roughly one encounter every few minutes, not every sweep.
            if (level.random.nextFloat() > 0.22f) continue;

            data.raiseFlag("satyr_" + stage);
            player.sendSystemMessage(Component.literal(SCRIPT[stage]));

            if (stage == 0) {
                spawnSatyr(level, player);
                player.sendSystemMessage(Component.literal(
                        "§8(A satyr. Half goat, entirely serious about this.)"));
            }
            if (stage == 2) {
                player.getInventory().add(new ItemStack(ChItems.GOLDEN_DRACHMA.get(), 2));
                player.sendSystemMessage(Component.literal(
                        "§7He presses two coins into your hand. §8\"For the ferry. Long story.\""));
            }
            if (stage == SCRIPT.length - 1) {
                player.getInventory().add(new ItemStack(ChItems.CELESTIAL_BRONZE_DAGGER.get()));
                player.sendSystemMessage(Component.literal(
                        "§6He gives you a bronze knife. §f\"Ordinary metal won't touch them. "
                        + "This will.\""));
                data.raiseFlag("satyr_done");
            }
        }
    }

    private static int stageOf(DemigodData data) {
        int stage = 0;
        while (stage < SCRIPT.length && data.hasFlag("satyr_" + stage)) stage++;
        return stage;
    }

    /** A satyr, as close as vanilla bodies get: a goat that will not leave and has a name. */
    private static void spawnSatyr(ServerLevel level, ServerPlayer player) {
        var raw = EntityType.GOAT.create(level, EntitySpawnReason.MOB_SUMMONED);
        if (!(raw instanceof Mob satyr)) return;

        var look = player.getLookAngle();
        satyr.setPos(player.getX() + look.x * 3, player.getY(), player.getZ() + look.z * 3);
        satyr.setCustomName(Component.literal("§aA satyr §7— keeper of the woods"));
        satyr.setCustomNameVisible(true);
        satyr.setPersistenceRequired();

        var speed = satyr.getAttribute(Attributes.MOVEMENT_SPEED);
        if (speed != null) speed.setBaseValue(0.32);

        level.addFreshEntity(satyr);
        level.sendParticles(ParticleTypes.HAPPY_VILLAGER,
                satyr.getX(), satyr.getY() + 1, satyr.getZ(), 20, 0.4, 0.5, 0.4, 0.0);
        level.playSound(null, satyr.blockPosition(), SoundEvents.GOAT_AMBIENT,
                SoundSource.NEUTRAL, 0.8f, 0.8f);
    }
}
