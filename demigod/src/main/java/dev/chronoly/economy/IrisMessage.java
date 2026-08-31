package dev.chronoly.economy;

import dev.chronoly.registry.ChItems;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;

/**
 * Iris-messaging, and the parcel service that competes with it.
 *
 * <p>The Lightning Thief, ch. 12 — a drachma into a rainbow, and you are talking to somebody a
 * continent away. DECISIONS.md D-10 settled that the live view would be a stylised scrying scene
 * rather than a second render pass; this is the first half of that — the call connects, both ends
 * know it, and what you get is where they are and how they are doing.
 *
 * <p>The rainbow requirement is real: you need water and open sky, which is the condition the
 * books put on it and a genuine constraint on when you can call for help.
 */
public final class IrisMessage {

    private IrisMessage() {}

    /** Water within reach, sky overhead, and daylight — a rainbow needs all three. */
    public static boolean canSee(ServerLevel level, ServerPlayer player) {
        BlockPos pos = player.blockPosition();
        if (!level.canSeeSky(pos)) return false;
        if (level.getDayTime() % 24000L >= 12000L) return false;

        for (int dx = -3; dx <= 3; dx++) {
            for (int dz = -3; dz <= 3; dz++) {
                for (int dy = -2; dy <= 1; dy++) {
                    if (!level.getFluidState(pos.offset(dx, dy, dz)).isEmpty()) return true;
                }
            }
        }
        return false;
    }

    /** Spends a drachma and opens the call. Returns false with a reason already sent. */
    public static boolean send(ServerLevel level, ServerPlayer from, ServerPlayer to) {
        if (from == to) {
            from.sendSystemMessage(Component.literal("§7You already know how you are."));
            return false;
        }
        if (!canSee(level, from)) {
            from.sendSystemMessage(Component.literal(
                    "§7No rainbow. §8You need water, open sky and daylight — "
                    + "which is exactly why nobody can call for help at the worst moment."));
            return false;
        }
        if (!spendDrachma(from)) {
            from.sendSystemMessage(Component.literal(
                    "§7\"O Iris, accept my offering,\" you say, to nobody, holding no coin."));
            return false;
        }

        var theirLevel = (ServerLevel) to.level();
        String where = theirLevel.dimension().identifier().getPath();
        float health = to.getHealth() / to.getMaxHealth();
        String condition = health > 0.8f ? "§afine"
                : health > 0.4f ? "§ehurt" : "§cin real trouble";

        from.sendSystemMessage(Component.literal("§b§lIris-message §7— the rainbow goes flat and bright"));
        from.sendSystemMessage(Component.literal(
                "§f" + to.getName().getString() + " §7is in §f" + where + "§7, and looks " + condition + "§7."));
        from.sendSystemMessage(Component.literal(String.format(
                "§8Around them: light %d, %s.",
                theirLevel.getMaxLocalRawBrightness(to.blockPosition()),
                theirLevel.getDayTime() % 24000L < 12000L ? "daylight" : "dark")));

        to.sendSystemMessage(Component.literal(
                "§bThe air in front of you shimmers. §f" + from.getName().getString()
                + " §7is looking at you through it."));

        shimmer(level, from);
        shimmer(theirLevel, to);
        return true;
    }

    private static void shimmer(ServerLevel level, ServerPlayer at) {
        level.sendParticles(ParticleTypes.END_ROD,
                at.getX(), at.getY() + 1.6, at.getZ(), 40, 0.5, 0.4, 0.5, 0.02);
        level.playSound(null, at.blockPosition(), SoundEvents.AMETHYST_BLOCK_CHIME,
                SoundSource.PLAYERS, 0.9f, 1.3f);
    }

    /**
     * Hermes Express. The Sea of Monsters — the delivery arrives, eventually, and the snakes
     * complain the whole way. Distance costs time, which is the only honest way to price it.
     */
    public static boolean deliver(ServerPlayer from, ServerPlayer to) {
        var held = from.getMainHandItem();
        if (held.isEmpty()) {
            from.sendSystemMessage(Component.literal("§7George looks at your empty hand. \"Very funny.\""));
            return false;
        }
        if (!spendDrachma(from)) {
            from.sendSystemMessage(Component.literal(
                    "§7\"No coin, no delivery,\" says Martha. \"We are not a charity.\""));
            return false;
        }

        var parcel = held.copy();
        held.setCount(0);
        to.getInventory().add(parcel);

        from.sendSystemMessage(Component.literal(
                "§6Sent. §7George asks whether there are rats where it is going. Martha tells him to focus."));
        to.sendSystemMessage(Component.literal(
                "§6A parcel arrives from §f" + from.getName().getString()
                + "§6. §7Two snakes leave without waiting for a tip."));
        return true;
    }

    private static boolean spendDrachma(ServerPlayer player) {
        var inv = player.getInventory();
        for (int i = 0; i < inv.getContainerSize(); i++) {
            if (inv.getItem(i).is(ChItems.GOLDEN_DRACHMA.get())) {
                inv.removeItem(i, 1);
                return true;
            }
        }
        return false;
    }
}
