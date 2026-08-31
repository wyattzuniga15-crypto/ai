package dev.chronoly.world.underworld;

import dev.chronoly.attachment.DemigodData;
import dev.chronoly.boss.BossKind;
import dev.chronoly.boss.Bosses;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.core.BlockPos;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.server.level.ServerPlayer;
import net.minecraft.world.level.block.Blocks;

/**
 * The shore, the queue, and the dog.
 *
 * <p>The Lightning Thief, ch. 17–18 — you arrive at a beach, there is a queue, and the way out is
 * guarded by something with three heads that does not take bribes. Built once per world on the
 * first arrival so the place is somewhere rather than a coordinate.
 */
public final class UnderworldGate {

    private UnderworldGate() {}

    private static boolean built;

    /** Runs on arrival. Cheap after the first time. */
    public static void ensure(ServerLevel level, ServerPlayer arriving) {
        DemigodData data = arriving.getData(ChAttachments.DEMIGOD.get());
        if (data.raiseFlag("saw_underworld")) {
            arriving.sendSystemMessage(Component.literal(
                    "§8There is a queue. There is always a queue. §7Somewhere ahead of it, "
                    + "something very large is barking."));
        }
        if (built) return;
        built = true;

        BlockPos origin = new BlockPos(8, 96, 8);
        shore(level, origin);
        gate(level, origin.offset(0, 0, 26));

        // Cerberus, on the gate, exactly where the books put him.
        Bosses.spawn(level, BossKind.CERBERUS, origin.getX() + 0.5, origin.getY(), origin.getZ() + 30.5);
    }

    /** The beach on the near side of the Styx, and a floor that is not lava. */
    private static void shore(ServerLevel level, BlockPos origin) {
        for (int dx = -14; dx <= 14; dx++) {
            for (int dz = -10; dz <= 10; dz++) {
                for (int dy = 0; dy < 8; dy++) {
                    level.setBlock(origin.offset(dx, dy, dz), Blocks.AIR.defaultBlockState(), 2);
                }
                level.setBlock(origin.offset(dx, -1, dz),
                        Blocks.GRAY_CONCRETE_POWDER.defaultBlockState(), 2);
            }
        }
        // The Styx itself: a dark channel along the near edge.
        for (int dx = -14; dx <= 14; dx++) {
            for (int dz = -14; dz < -10; dz++) {
                level.setBlock(origin.offset(dx, -1, dz), Blocks.OBSIDIAN.defaultBlockState(), 2);
                level.setBlock(origin.offset(dx, 0, dz), Blocks.WATER.defaultBlockState(), 2);
            }
        }
        for (int dx = -14; dx <= 14; dx += 7) {
            level.setBlock(origin.offset(dx, 0, -9), Blocks.SOUL_LANTERN.defaultBlockState(), 2);
        }
    }

    /** Where the gate stands, so walking into it can mean something. */
    public static final BlockPos GATE = new BlockPos(8, 96, 34);

    /**
     * Standing in the gateway with a drachma is the way out. A command works too, but a door you
     * can walk through is a place and a command is a menu.
     */
    public static void tickGate(ServerLevel level, ServerPlayer player) {
        if (!dev.chronoly.world.ChDimensions.isUnderworld(level)) return;
        if (player.blockPosition().distSqr(GATE) > 16) return;

        DemigodData data = player.getData(ChAttachments.DEMIGOD.get());
        if (!data.hasFlag("gate_warned")) {
            data.raiseFlag("gate_warned");
            player.sendSystemMessage(Component.literal(
                    "§7The gate is open and nobody is stopping you. §8Charon wants his fare first — "
                    + "hold a drachma and walk through."));
            return;
        }
        Judgment.payCharon(player);
    }

    /** The gate out, and the columns that make it look official. */
    private static void gate(ServerLevel level, BlockPos at) {
        for (int dy = 0; dy < 9; dy++) {
            level.setBlock(at.offset(-5, dy, 0), Blocks.POLISHED_BLACKSTONE.defaultBlockState(), 2);
            level.setBlock(at.offset(5, dy, 0), Blocks.POLISHED_BLACKSTONE.defaultBlockState(), 2);
        }
        for (int dx = -5; dx <= 5; dx++) {
            level.setBlock(at.offset(dx, 9, 0), Blocks.POLISHED_BLACKSTONE.defaultBlockState(), 2);
            level.setBlock(at.offset(dx, 10, 0), Blocks.CHISELED_POLISHED_BLACKSTONE.defaultBlockState(), 2);
        }
        level.setBlock(at.offset(-6, 9, 0), Blocks.SOUL_LANTERN.defaultBlockState(), 2);
        level.setBlock(at.offset(6, 9, 0), Blocks.SOUL_LANTERN.defaultBlockState(), 2);
    }
}
