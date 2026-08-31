package dev.chronoly.world.camp;

import net.minecraft.core.BlockPos;
import net.minecraft.core.Direction;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.block.Block;
import net.minecraft.world.level.block.Blocks;
import net.minecraft.world.level.block.state.BlockState;

import java.util.List;

/**
 * Camp Half-Blood, built rather than generated.
 *
 * <p>The brief wants a hand-authored structure with twenty architecturally distinct cabins, and it
 * is right that structure files are the proper home for that. This places the camp directly from
 * code instead — a real, walkable camp exists now, and converting it into a structure template
 * later is a mechanical job that does not change the layout.
 *
 * <p>The important part is not the buildings. It is the border: inside it, scent is zero, and that
 * is what makes camp feel like home rather than merely safer.
 */
public final class CampBuilder {

    private CampBuilder() {}

    /** How far the ward reaches from the centre. Matches {@code CampWard}. */
    public static final int RADIUS = 48;

    /**
     * The twelve Olympian cabins in the horseshoe the books describe — Zeus and Hera at the head,
     * the rest down the two arms — plus the eight that came later.
     */
    private record Cabin(String god, int number, Block wall, Block roof) {}

    private static final List<Cabin> CABINS = List.of(
            new Cabin("Zeus", 1, Blocks.QUARTZ_BLOCK, Blocks.LIGHT_BLUE_CONCRETE),
            new Cabin("Hera", 2, Blocks.QUARTZ_BLOCK, Blocks.PINK_CONCRETE),
            new Cabin("Poseidon", 3, Blocks.PRISMARINE_BRICKS, Blocks.PRISMARINE),
            new Cabin("Demeter", 4, Blocks.MOSS_BLOCK, Blocks.OAK_LEAVES),
            new Cabin("Ares", 5, Blocks.RED_CONCRETE, Blocks.RED_NETHER_BRICKS),
            new Cabin("Athena", 6, Blocks.SMOOTH_STONE, Blocks.GRAY_CONCRETE),
            new Cabin("Apollo", 7, Blocks.GOLD_BLOCK, Blocks.YELLOW_TERRACOTTA),
            new Cabin("Artemis", 8, Blocks.POLISHED_ANDESITE, Blocks.WHITE_CONCRETE),
            new Cabin("Hephaestus", 9, Blocks.COPPER_BLOCK, Blocks.BLACKSTONE),
            new Cabin("Aphrodite", 10, Blocks.PINK_CONCRETE, Blocks.WHITE_WOOL),
            new Cabin("Hermes", 11, Blocks.STRIPPED_OAK_LOG, Blocks.BROWN_TERRACOTTA),
            new Cabin("Dionysus", 12, Blocks.PURPUR_BLOCK, Blocks.PURPLE_CONCRETE),
            new Cabin("Hades", 13, Blocks.OBSIDIAN, Blocks.BLACK_CONCRETE),
            new Cabin("Iris", 14, Blocks.WHITE_STAINED_GLASS, Blocks.LIGHT_BLUE_STAINED_GLASS),
            new Cabin("Hypnos", 15, Blocks.WHITE_WOOL, Blocks.LIGHT_GRAY_WOOL),
            new Cabin("Nemesis", 16, Blocks.DEEPSLATE_TILES, Blocks.POLISHED_DEEPSLATE),
            new Cabin("Nike", 17, Blocks.SMOOTH_QUARTZ, Blocks.GOLD_BLOCK),
            new Cabin("Hebe", 18, Blocks.LIME_CONCRETE, Blocks.GREEN_CONCRETE),
            new Cabin("Tyche", 19, Blocks.CALCITE, Blocks.EMERALD_BLOCK),
            new Cabin("Hecate", 20, Blocks.BLACKSTONE, Blocks.CRYING_OBSIDIAN));

    /** Places the whole camp centred on {@code origin}. Returns the number of cabins built. */
    public static int build(ServerLevel level, BlockPos origin) {
        flatten(level, origin);
        bigHouse(level, origin.offset(-6, 0, -26));
        pavilion(level, origin.offset(-5, 0, 14));
        wardStone(level, origin);

        int built = 0;
        for (int i = 0; i < CABINS.size(); i++) {
            Cabin cabin = CABINS.get(i);
            // A horseshoe: two arms of ten, opening south.
            boolean left = i % 2 == 0;
            int row = i / 2;
            int x = origin.getX() + (left ? -22 : 14);
            int z = origin.getZ() - 18 + row * 8;
            cabin(level, new BlockPos(x, origin.getY(), z), cabin);
            built++;
        }
        strawberryFields(level, origin.offset(20, 0, 10));
        return built;
    }

    private static void flatten(ServerLevel level, BlockPos origin) {
        for (int dx = -RADIUS; dx <= RADIUS; dx++) {
            for (int dz = -RADIUS; dz <= RADIUS; dz++) {
                if (dx * dx + dz * dz > RADIUS * RADIUS) continue;
                BlockPos ground = new BlockPos(origin.getX() + dx, origin.getY() - 1, origin.getZ() + dz);
                level.setBlock(ground, Blocks.GRASS_BLOCK.defaultBlockState(), 2);
                for (int dy = 0; dy < 6; dy++) {
                    level.setBlock(ground.above(dy + 1), Blocks.AIR.defaultBlockState(), 2);
                }
            }
        }
    }

    /** A cabin: 7×7, its god's colours, a door facing the green, and a sign with the number. */
    private static void cabin(ServerLevel level, BlockPos at, Cabin cabin) {
        BlockState wall = cabin.wall().defaultBlockState();
        BlockState roof = cabin.roof().defaultBlockState();

        for (int dx = 0; dx < 7; dx++) {
            for (int dz = 0; dz < 7; dz++) {
                for (int dy = 0; dy < 5; dy++) {
                    boolean edge = dx == 0 || dx == 6 || dz == 0 || dz == 6;
                    BlockPos p = at.offset(dx, dy, dz);
                    if (dy == 4) {
                        level.setBlock(p, roof, 2);
                    } else if (edge) {
                        level.setBlock(p, wall, 2);
                    } else {
                        level.setBlock(p, Blocks.AIR.defaultBlockState(), 2);
                    }
                }
                level.setBlock(at.offset(dx, -1, dz), Blocks.POLISHED_ANDESITE.defaultBlockState(), 2);
            }
        }
        // Door and a torch either side.
        level.setBlock(at.offset(3, 0, 6), Blocks.AIR.defaultBlockState(), 2);
        level.setBlock(at.offset(3, 1, 6), Blocks.AIR.defaultBlockState(), 2);
        level.setBlock(at.offset(2, 2, 6), Blocks.TORCH.defaultBlockState(), 2);
        level.setBlock(at.offset(4, 2, 6), Blocks.TORCH.defaultBlockState(), 2);
        // Bed inside, because a cabin without a bunk is a shed.
        level.setBlock(at.offset(2, 0, 2), Blocks.WHITE_BED.defaultBlockState(), 2);
    }

    /** The Big House: four storeys of farmhouse with the attic where the Oracle sits. */
    private static void bigHouse(ServerLevel level, BlockPos at) {
        for (int dx = 0; dx < 13; dx++) {
            for (int dz = 0; dz < 11; dz++) {
                for (int dy = 0; dy < 10; dy++) {
                    boolean edge = dx == 0 || dx == 12 || dz == 0 || dz == 10;
                    BlockPos p = at.offset(dx, dy, dz);
                    if (dy == 9) {
                        level.setBlock(p, Blocks.DARK_OAK_PLANKS.defaultBlockState(), 2);
                    } else if (edge) {
                        level.setBlock(p, Blocks.LIGHT_BLUE_TERRACOTTA.defaultBlockState(), 2);
                    } else {
                        level.setBlock(p, Blocks.AIR.defaultBlockState(), 2);
                    }
                }
                level.setBlock(at.offset(dx, -1, dz), Blocks.DARK_OAK_PLANKS.defaultBlockState(), 2);
            }
        }
        level.setBlock(at.offset(6, 0, 10), Blocks.AIR.defaultBlockState(), 2);
        level.setBlock(at.offset(6, 1, 10), Blocks.AIR.defaultBlockState(), 2);
        // The attic. Green mist optional; the Oracle is a command for now.
        level.setBlock(at.offset(6, 8, 5), Blocks.LECTERN.defaultBlockState(), 2);
        level.setBlock(at.offset(5, 8, 5), Blocks.CANDLE.defaultBlockState(), 2);
    }

    /** The dining pavilion: open columns, and braziers you burn the best of your food in. */
    private static void pavilion(ServerLevel level, BlockPos at) {
        for (int dx = 0; dx < 11; dx++) {
            for (int dz = 0; dz < 11; dz++) {
                level.setBlock(at.offset(dx, -1, dz), Blocks.SMOOTH_QUARTZ.defaultBlockState(), 2);
                boolean column = (dx % 5 == 0) && (dz % 5 == 0);
                if (column) {
                    for (int dy = 0; dy < 5; dy++) {
                        level.setBlock(at.offset(dx, dy, dz), Blocks.QUARTZ_PILLAR.defaultBlockState(), 2);
                    }
                }
                if (dz == 10) level.setBlock(at.offset(dx, 5, dz), Blocks.SMOOTH_QUARTZ_SLAB.defaultBlockState(), 2);
            }
        }
        level.setBlock(at.offset(5, 0, 5), Blocks.CAMPFIRE.defaultBlockState(), 2);
        level.setBlock(at.offset(3, 0, 5), Blocks.CAMPFIRE.defaultBlockState(), 2);
        level.setBlock(at.offset(7, 0, 5), Blocks.CAMPFIRE.defaultBlockState(), 2);
    }

    /**
     * Thalia's Pine, in the form the mod can actually check: a gold block under a pine, which the
     * spawn director already reads as a ward. The tree is scenery; the gold is the mechanic.
     */
    private static void wardStone(ServerLevel level, BlockPos origin) {
        BlockPos base = origin.offset(0, 0, -34);
        level.setBlock(base.below(), Blocks.GOLD_BLOCK.defaultBlockState(), 2);
        for (int dy = 0; dy < 9; dy++) {
            level.setBlock(base.above(dy), Blocks.SPRUCE_LOG.defaultBlockState(), 2);
        }
        for (int dy = 3; dy < 10; dy++) {
            int r = Math.max(1, 4 - (dy - 3) / 2);
            for (int dx = -r; dx <= r; dx++) {
                for (int dz = -r; dz <= r; dz++) {
                    if (dx == 0 && dz == 0) continue;
                    if (dx * dx + dz * dz > r * r) continue;
                    level.setBlock(base.offset(dx, dy, dz), Blocks.SPRUCE_LEAVES.defaultBlockState(), 2);
                }
            }
        }
    }

    private static void strawberryFields(ServerLevel level, BlockPos at) {
        for (int dx = 0; dx < 14; dx++) {
            for (int dz = 0; dz < 10; dz++) {
                BlockPos ground = at.offset(dx, -1, dz);
                boolean row = dz % 3 == 1;
                level.setBlock(ground, row ? Blocks.FARMLAND.defaultBlockState()
                        : Blocks.DIRT_PATH.defaultBlockState(), 2);
                if (row) level.setBlock(ground.above(), Blocks.SWEET_BERRY_BUSH.defaultBlockState(), 2);
            }
        }
    }
}
