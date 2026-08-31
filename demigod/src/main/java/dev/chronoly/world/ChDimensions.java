package dev.chronoly.world;

import dev.chronoly.ChronolyConstants;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.resources.ResourceKey;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.level.Level;

/**
 * The two places that are not the world.
 *
 * <p>The Lightning Thief, ch. 17–19 for the Underworld; ch. 21 for Olympus, reached from the six
 * hundredth floor of a building that only has a hundred.
 */
public final class ChDimensions {

    public static final ResourceKey<Level> UNDERWORLD =
            ResourceKey.create(Registries.DIMENSION, ChronolyConstants.id("underworld"));

    public static final ResourceKey<Level> OLYMPUS =
            ResourceKey.create(Registries.DIMENSION, ChronolyConstants.id("olympus"));

    private ChDimensions() {}

    /**
     * Every dimension change in the mod goes through here, so the one API most likely to move
     * between versions has exactly one call site.
     */
    public static boolean travel(ServerPlayer player, ResourceKey<Level> destination,
                                 double x, double y, double z) {
        // ServerPlayer lost getServer() in 1.21.11; the level still has it.
        var server = ((ServerLevel) player.level()).getServer();
        ServerLevel target = server.getLevel(destination);
        if (target == null) return false;

        player.teleportTo(target, x, y, z, java.util.Set.of(), player.getYRot(), player.getXRot(), true);
        return true;
    }

    /** Arriving in the Underworld: a long way down, and everyone there knows it. */
    public static void sendToUnderworld(ServerPlayer player, String reason) {
        if (!travel(player, UNDERWORLD, 8.5, 96, 8.5)) return;
        player.sendSystemMessage(Component.literal("§8" + reason));
        player.sendSystemMessage(Component.literal(
                "§7The air smells like old pennies and dead flowers. §8Find your way out, "
                + "or wait for the ferryman."));
        ServerLevel level = (ServerLevel) player.level();
        level.playSound(null, player.blockPosition(), SoundEvents.WITHER_SPAWN,
                SoundSource.AMBIENT, 0.4f, 0.4f);
        dev.chronoly.world.underworld.UnderworldGate.ensure(level, player);
    }

    public static void sendToOlympus(ServerPlayer player) {
        if (!travel(player, OLYMPUS, 8.5, 160, 8.5)) return;
        // The place exists before anybody has to be told to build it.
        dev.chronoly.world.olympus.OlympusBuilder.ensure((ServerLevel) player.level());
        player.sendSystemMessage(Component.literal(
                "§e§lThe six hundredth floor. §6Everything is marble and nobody is looking at you yet."));
        ServerLevel level = (ServerLevel) player.level();
        level.playSound(null, player.blockPosition(), SoundEvents.BEACON_ACTIVATE,
                SoundSource.AMBIENT, 1.0f, 1.4f);
    }

    public static boolean isUnderworld(Level level) {
        return level.dimension().equals(UNDERWORLD);
    }

    public static boolean isOlympus(Level level) {
        return level.dimension().equals(OLYMPUS);
    }
}
