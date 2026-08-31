package dev.chronoly.world.olympus;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.core.BlockPos;
import net.minecraft.core.particles.ParticleTypes;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.sounds.SoundEvents;
import net.minecraft.sounds.SoundSource;
import net.minecraft.world.effect.MobEffectInstance;
import net.minecraft.world.effect.MobEffects;
import net.minecraft.world.level.block.Blocks;

import java.util.List;

/**
 * The throne room, and the twelve who sit in it.
 *
 * <p>The Lightning Thief, ch. 21 — a hall built for beings twenty feet tall, arranged in a U, and
 * the unsettling part is not the scale but being looked at. A boon here is not a shop: your parent
 * gives you something because you are theirs, and the rest do not.
 */
public final class ThroneRoom {

    private ThroneRoom() {}

    private record Throne(String god, net.minecraft.world.level.block.Block material) {}

    private static final List<Throne> THRONES = List.of(
            new Throne("zeus", Blocks.LIGHTNING_ROD),
            new Throne("hera", Blocks.PINK_CONCRETE),
            new Throne("poseidon", Blocks.PRISMARINE_BRICKS),
            new Throne("demeter", Blocks.MOSS_BLOCK),
            new Throne("ares", Blocks.RED_NETHER_BRICKS),
            new Throne("athena", Blocks.SMOOTH_STONE),
            new Throne("apollo", Blocks.GOLD_BLOCK),
            new Throne("artemis", Blocks.POLISHED_ANDESITE),
            new Throne("hephaestus", Blocks.COPPER_BLOCK),
            new Throne("aphrodite", Blocks.PINK_WOOL),
            new Throne("hermes", Blocks.STRIPPED_OAK_LOG),
            new Throne("dionysus", Blocks.PURPUR_BLOCK));

    /** Raises the hall. Twelve thrones in a horseshoe, a hearth at the centre, Hestia tending it. */
    public static int build(ServerLevel level, BlockPos origin) {
        // Floor and colonnade.
        for (int dx = -24; dx <= 24; dx++) {
            for (int dz = -24; dz <= 24; dz++) {
                level.setBlock(origin.offset(dx, -1, dz), Blocks.SMOOTH_QUARTZ.defaultBlockState(), 2);
                for (int dy = 0; dy < 14; dy++) {
                    level.setBlock(origin.offset(dx, dy, dz), Blocks.AIR.defaultBlockState(), 2);
                }
                boolean column = (Math.abs(dx) == 22 || Math.abs(dz) == 22)
                        && (dx % 6 == 0 || dz % 6 == 0);
                if (column) {
                    for (int dy = 0; dy < 12; dy++) {
                        level.setBlock(origin.offset(dx, dy, dz),
                                Blocks.QUARTZ_PILLAR.defaultBlockState(), 2);
                    }
                }
            }
        }

        // The hearth. The Last Olympian — Hestia keeps the fire, and she is the one who matters.
        for (int dx = -2; dx <= 2; dx++) {
            for (int dz = -2; dz <= 2; dz++) {
                level.setBlock(origin.offset(dx, -1, dz), Blocks.NETHER_BRICKS.defaultBlockState(), 2);
            }
        }
        level.setBlock(origin, Blocks.CAMPFIRE.defaultBlockState(), 2);

        int placed = 0;
        for (int i = 0; i < THRONES.size(); i++) {
            Throne throne = THRONES.get(i);
            boolean left = i % 2 == 0;
            int row = i / 2;
            int x = origin.getX() + (left ? -16 : 16);
            int z = origin.getZ() - 15 + row * 6;
            throne(level, new BlockPos(x, origin.getY(), z), throne);
            placed++;
        }
        return placed;
    }

    private static void throne(ServerLevel level, BlockPos at, Throne throne) {
        var seat = throne.material().defaultBlockState();
        for (int dy = 0; dy < 6; dy++) {
            for (int dx = -2; dx <= 2; dx++) {
                level.setBlock(at.offset(dx, dy, 0), dy < 2 || Math.abs(dx) == 2
                        ? seat : Blocks.AIR.defaultBlockState(), 2);
            }
        }
        level.setBlock(at.offset(0, 2, 0), Blocks.SMOOTH_QUARTZ_SLAB.defaultBlockState(), 2);
        level.setBlock(at.offset(-2, 6, 0), Blocks.SEA_LANTERN.defaultBlockState(), 2);
        level.setBlock(at.offset(2, 6, 0), Blocks.SEA_LANTERN.defaultBlockState(), 2);
    }

    /**
     * A boon from your parent, once per day of favour earned.
     *
     * <p>Not a shop. The other eleven have nothing for you, and being told so by eleven gods is
     * part of the experience of standing in that room.
     */
    public static boolean petition(ServerPlayer player, String god) {
        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.isClaimed()) {
            player.sendSystemMessage(Component.literal(
                    "§7Twelve enormous faces turn towards you and none of them knows who you are."));
            return false;
        }
        String parent = data.parentage().orElseThrow();
        if (!parent.equals(god)) {
            player.sendSystemMessage(Component.literal(
                    "§7" + capitalise(god) + " looks at you for a moment, and then past you. "
                    + "§8You are not theirs."));
            return false;
        }
        float favor = data.favorWith(parent);
        if (favor < 150f) {
            player.sendSystemMessage(Component.literal(
                    "§7Your parent does not look up. §8Come back when you have done something."));
            return false;
        }
        if (!data.raiseFlag("boon_claimed")) {
            player.sendSystemMessage(Component.literal(
                    "§7\"I have already given you something. §8Use it.\""));
            return false;
        }

        ServerLevel level = (ServerLevel) player.level();
        level.sendParticles(ParticleTypes.END_ROD,
                player.getX(), player.getY() + 2, player.getZ(), 100, 0.6, 1.4, 0.6, 0.04);
        level.playSound(null, player.blockPosition(), SoundEvents.BEACON_POWER_SELECT,
                SoundSource.PLAYERS, 1.2f, 0.9f);

        data.setEnergy(data.maxEnergy());
        data.setOverdraw(0f);
        player.addEffect(new MobEffectInstance(MobEffects.HEALTH_BOOST, 72000, 1));
        player.addEffect(new MobEffectInstance(MobEffects.REGENERATION, 400, 1));

        player.sendSystemMessage(Component.literal(
                "§6§l" + capitalise(parent) + " acknowledges you."));
        player.sendSystemMessage(Component.literal(
                "§7Something settles into your chest that was not there before. "
                + "§8It does not feel like a gift so much as a debt."));
        return true;
    }

    private static String capitalise(String s) {
        return Character.toUpperCase(s.charAt(0)) + s.substring(1);
    }

    public static List<String> gods() {
        return THRONES.stream().map(Throne::god).toList();
    }
}
