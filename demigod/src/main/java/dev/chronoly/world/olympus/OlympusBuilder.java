package dev.chronoly.world.olympus;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;

/**
 * Olympus builds itself the first time anybody reaches the six hundredth floor.
 *
 * <p>Before this, the throne room existed only if an operator typed a command, which meant most
 * players arrived at bare floating-island terrain a hundred and sixty blocks up — or at nothing at
 * all, since the generator owes nobody a floor at the arrival point. Now arrival guarantees a
 * plaza underfoot, and the hall of thrones is already standing at the end of the walkway.
 */
public final class OlympusBuilder {

    private OlympusBuilder() {}

    /** Where travel lands you; must agree with ChDimensions#sendToOlympus. */
    public static final BlockPos ARRIVAL = new BlockPos(8, 160, 8);

    /** The throne room's centre. Its floor sits at ARRIVAL's feet level. */
    public static final BlockPos THRONES = new BlockPos(8, 160, 58);

    /** Idempotent — the lodestone below the plaza is the marker. */
    public static void ensure(ServerLevel level) {
        if (level.getBlockState(ARRIVAL.below(3)).is(Blocks.LODESTONE)) return;

        plaza(level);
        walkway(level);
        ThroneRoom.build(level, THRONES);

        level.setBlock(ARRIVAL.below(3), Blocks.LODESTONE.defaultBlockState(), 2);
    }

    /** Marble underfoot no matter what the generator thought, columns at the rim. */
    private static void plaza(ServerLevel level) {
        for (int dx = -15; dx <= 15; dx++) {
            for (int dz = -15; dz <= 15; dz++) {
                if (dx * dx + dz * dz > 15 * 15) continue;
                BlockPos col = ARRIVAL.offset(dx, 0, dz);
                level.setBlock(col.below(), Blocks.SMOOTH_QUARTZ.defaultBlockState(), 2);
                level.setBlock(col.below(2), Blocks.QUARTZ_BRICKS.defaultBlockState(), 2);
                for (int dy = 0; dy < 10; dy++) {
                    level.setBlock(col.above(dy), Blocks.AIR.defaultBlockState(), 2);
                }
            }
        }
        for (int c = 0; c < 12; c++) {
            double a = c * Math.PI / 6.0;
            int dx = (int) Math.round(Math.cos(a) * 13);
            int dz = (int) Math.round(Math.sin(a) * 13);
            for (int dy = 0; dy < 7; dy++) {
                level.setBlock(ARRIVAL.offset(dx, dy, dz), Blocks.QUARTZ_PILLAR.defaultBlockState(), 2);
            }
            level.setBlock(ARRIVAL.offset(dx, 7, dz), Blocks.SEA_LANTERN.defaultBlockState(), 2);
        }
    }

    /** Five wide, marble, lit, and pointing at the only door that matters. */
    private static void walkway(ServerLevel level) {
        for (int dz = 14; dz <= 34; dz++) {
            for (int dx = -2; dx <= 2; dx++) {
                BlockPos col = new BlockPos(ARRIVAL.getX() + dx, ARRIVAL.getY(), ARRIVAL.getZ() + dz);
                level.setBlock(col.below(), Blocks.SMOOTH_QUARTZ.defaultBlockState(), 2);
                for (int dy = 0; dy < 6; dy++) {
                    level.setBlock(col.above(dy), Blocks.AIR.defaultBlockState(), 2);
                }
            }
            if (dz % 5 == 0) {
                level.setBlock(new BlockPos(ARRIVAL.getX() - 3, ARRIVAL.getY(), ARRIVAL.getZ() + dz),
                        Blocks.LANTERN.defaultBlockState(), 2);
                level.setBlock(new BlockPos(ARRIVAL.getX() + 3, ARRIVAL.getY(), ARRIVAL.getZ() + dz),
                        Blocks.LANTERN.defaultBlockState(), 2);
            }
        }
    }
}
