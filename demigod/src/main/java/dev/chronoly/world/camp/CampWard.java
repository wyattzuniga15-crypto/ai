package dev.chronoly.world.camp;

import net.minecraft.core.BlockPos;
import net.minecraft.server.level.ServerLevel;
import net.minecraft.world.level.saveddata.SavedData;

import java.util.ArrayList;
import java.util.List;

/**
 * Where the world cannot smell you.
 *
 * <p>The Sea of Monsters — the borders hold because something on the hill holds them. Inside a
 * ward scent is zero rather than reduced, and that absoluteness is the whole point: camp is home,
 * not merely a quieter place to be hunted.
 */
public final class CampWard {

    private CampWard() {}

    /** Ward centres, in memory for now; persisting them is a small SavedData away. */
    private static final List<Ward> WARDS = new ArrayList<>();

    public record Ward(String dimension, BlockPos centre, int radius) {
        public boolean covers(String dim, BlockPos pos) {
            if (!dimension.equals(dim)) return false;
            int dx = pos.getX() - centre.getX();
            int dz = pos.getZ() - centre.getZ();
            return dx * dx + dz * dz <= radius * radius;
        }
    }

    public static void register(ServerLevel level, BlockPos centre, int radius) {
        WARDS.removeIf(w -> w.centre().equals(centre));
        WARDS.add(new Ward(level.dimension().identifier().toString(), centre, radius));
    }

    public static boolean isWarded(ServerLevel level, BlockPos pos) {
        String dim = level.dimension().identifier().toString();
        for (Ward w : WARDS) {
            if (w.covers(dim, pos)) return true;
        }
        return false;
    }

    public static int count() {
        return WARDS.size();
    }
}
