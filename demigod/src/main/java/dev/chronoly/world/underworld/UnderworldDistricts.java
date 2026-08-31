package dev.chronoly.world.underworld;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

/**
 * The three places the judged actually go.
 *
 * <p>The Lightning Thief, ch. 18 — Asphodel is an endless grey crowd, Elysium is warm and gated,
 * and Punishment is specific. Before this class the verdicts teleported players to bare
 * coordinates in nether-noise terrain; a sentence like "Elysium. It is warm, and it is beautiful"
 * deserves somewhere to be true.
 *
 * <p>Everything here is carved out of whatever the generator put there, which is the same honest
 * approach the shore takes: the Underworld's terrain is the terrain, and the districts are built
 * into it rather than pretending it away.
 */
public final class UnderworldDistricts {

    private UnderworldDistricts() {}

    /** Centres. Judgment routes to these, so the two files must agree. */
    public static final BlockPos ASPHODEL = new BlockPos(8, 96, 80);
    public static final BlockPos ELYSIUM = new BlockPos(180, 110, 8);
    public static final BlockPos PUNISHMENT = new BlockPos(-180, 80, 8);

    /** Idempotent; the lodestone under each district is the "already built" marker. */
    public static void ensure(ServerLevel level) {
        if (!level.getBlockState(ASPHODEL.below(2)).is(Blocks.LODESTONE)) asphodel(level);
        if (!level.getBlockState(ELYSIUM.below(2)).is(Blocks.LODESTONE)) elysium(level);
        if (!level.getBlockState(PUNISHMENT.below(2)).is(Blocks.LODESTONE)) punishment(level);
    }

    /** A platform with a themed floor and headroom, the shared skeleton of all three. */
    private static void platform(ServerLevel level, BlockPos centre, int radius, int headroom,
                                 BlockState floor) {
        for (int dx = -radius; dx <= radius; dx++) {
            for (int dz = -radius; dz <= radius; dz++) {
                BlockPos col = centre.offset(dx, 0, dz);
                level.setBlock(col.below(), floor, 2);
                for (int dy = 0; dy < headroom; dy++) {
                    level.setBlock(col.above(dy), Blocks.AIR.defaultBlockState(), 2);
                }
            }
        }
        level.setBlock(centre.below(2), Blocks.LODESTONE.defaultBlockState(), 2);
    }

    /**
     * An endless grey crowd, rendered as an endless grey field. White asphodel flowers, no colour
     * anywhere else, and just enough light to see how far it goes.
     */
    private static void asphodel(ServerLevel level) {
        platform(level, ASPHODEL, 26, 10, Blocks.GRAY_CONCRETE_POWDER.defaultBlockState());
        var rng = level.random;
        for (int i = 0; i < 90; i++) {
            BlockPos at = ASPHODEL.offset(rng.nextInt(51) - 25, 0, rng.nextInt(51) - 25);
            if (!level.getBlockState(at).isAir()) continue;
            level.setBlock(at, rng.nextInt(3) == 0
                    ? Blocks.WHITE_TULIP.defaultBlockState()
                    : Blocks.DEAD_BUSH.defaultBlockState(), 2);
        }
        for (int dx = -24; dx <= 24; dx += 12) {
            for (int dz = -24; dz <= 24; dz += 12) {
                level.setBlock(ASPHODEL.offset(dx, 0, dz), Blocks.SOUL_LANTERN.defaultBlockState(), 2);
            }
        }
    }

    /**
     * Warm, beautiful, and hard to leave. The only grass in the Underworld, gold in the paths,
     * real daylight-coloured lamps, and a pavilion because heroes get architecture.
     */
    private static void elysium(ServerLevel level) {
        platform(level, ELYSIUM, 26, 12, Blocks.GRASS_BLOCK.defaultBlockState());

        // A gold path crossing the field, which is how you know where you are.
        for (int d = -26; d <= 26; d++) {
            level.setBlock(ELYSIUM.offset(d, -1, 0), Blocks.GOLD_BLOCK.defaultBlockState(), 2);
            level.setBlock(ELYSIUM.offset(0, -1, d), Blocks.GOLD_BLOCK.defaultBlockState(), 2);
        }
        var rng = level.random;
        for (int i = 0; i < 70; i++) {
            BlockPos at = ELYSIUM.offset(rng.nextInt(51) - 25, 0, rng.nextInt(51) - 25);
            if (!level.getBlockState(at).isAir()) continue;
            level.setBlock(at, switch (rng.nextInt(4)) {
                case 0 -> Blocks.PEONY.defaultBlockState();
                case 1 -> Blocks.SUNFLOWER.defaultBlockState();
                case 2 -> Blocks.CORNFLOWER.defaultBlockState();
                default -> Blocks.OXEYE_DAISY.defaultBlockState();
            }, 2);
        }
        // Light like a sky the Underworld does not have.
        for (int dx = -20; dx <= 20; dx += 10) {
            for (int dz = -20; dz <= 20; dz += 10) {
                level.setBlock(ELYSIUM.offset(dx, 9, dz), Blocks.GLOWSTONE.defaultBlockState(), 2);
            }
        }
        // The pavilion: a small quartz square with a laurel of leaves.
        for (int dx = -4; dx <= 4; dx++) {
            for (int dz = -4; dz <= 4; dz++) {
                level.setBlock(ELYSIUM.offset(dx, -1, dz + 14), Blocks.SMOOTH_QUARTZ.defaultBlockState(), 2);
            }
        }
        for (int c = 0; c < 4; c++) {
            int dx = (c % 2 == 0) ? -4 : 4;
            int dz = (c < 2) ? 10 : 18;
            for (int dy = 0; dy < 5; dy++) {
                level.setBlock(ELYSIUM.offset(dx, dy, dz), Blocks.QUARTZ_PILLAR.defaultBlockState(), 2);
            }
            level.setBlock(ELYSIUM.offset(dx, 5, dz), Blocks.CHERRY_LEAVES.defaultBlockState(), 2);
        }
    }

    /**
     * You did something specific to end up here. Blackstone, heat from below, and the furniture
     * of consequences — nothing decorative is ever red-hot by accident.
     */
    private static void punishment(ServerLevel level) {
        platform(level, PUNISHMENT, 26, 10, Blocks.POLISHED_BLACKSTONE.defaultBlockState());
        var rng = level.random;
        for (int i = 0; i < 60; i++) {
            BlockPos at = PUNISHMENT.offset(rng.nextInt(51) - 25, -1, rng.nextInt(51) - 25);
            level.setBlock(at, rng.nextInt(4) == 0
                    ? Blocks.MAGMA_BLOCK.defaultBlockState()
                    : Blocks.BASALT.defaultBlockState(), 2);
        }
        // Lava channels along two edges, so the heat has a direction.
        for (int d = -26; d <= 26; d++) {
            level.setBlock(PUNISHMENT.offset(d, -1, -26), Blocks.LAVA.defaultBlockState(), 2);
            level.setBlock(PUNISHMENT.offset(-26, -1, d), Blocks.LAVA.defaultBlockState(), 2);
        }
        // Chains from above, over iron-barred pens.
        for (int dx = -18; dx <= 18; dx += 9) {
            for (int dz = -12; dz <= 18; dz += 10) {
                for (int dy = 5; dy < 9; dy++) {
                    level.setBlock(PUNISHMENT.offset(dx, dy, dz), Blocks.CHAIN.defaultBlockState(), 2);
                }
                for (int bx = -1; bx <= 1; bx++) {
                    for (int bz = -1; bz <= 1; bz++) {
                        if (bx == 0 && bz == 0) continue;
                        for (int dy = 0; dy < 3; dy++) {
                            level.setBlock(PUNISHMENT.offset(dx + bx, dy, dz + bz),
                                    Blocks.IRON_BARS.defaultBlockState(), 2);
                        }
                    }
                }
            }
        }
        for (int dx = -24; dx <= 24; dx += 8) {
            level.setBlock(PUNISHMENT.offset(dx, 0, 24), Blocks.SOUL_CAMPFIRE.defaultBlockState(), 2);
        }
    }
}
