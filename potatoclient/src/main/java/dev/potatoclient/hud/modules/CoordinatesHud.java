package dev.potatoclient.hud.modules;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudLine;
import dev.potatoclient.hud.TextHudModule;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.text.Text;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Direction;
import net.minecraft.world.biome.Biome;

import java.util.ArrayList;
import java.util.List;

/** XYZ, chunk-relative position, facing and biome. */
public class CoordinatesHud extends TextHudModule {
	@Override
	public String id() {
		return "coordinates";
	}

	@Override
	public Text displayName() {
		return Text.literal("Coordinates");
	}

	@Override
	public HudElementConfig element() {
		return ConfigManager.get().hud.coordinates.element;
	}

	@Override
	protected List<HudLine> buildLines(boolean editing) {
		HudConfig.Coordinates cfg = ConfigManager.get().hud.coordinates;
		ClientPlayerEntity player = this.client.player;
		ClientWorld world = this.client.world;
		int color = element().textColor;

		if (player == null || world == null) {
			return editing ? List.of(HudLine.of("XYZ 0.0 / 64.0 / 0.0", color)) : List.of();
		}

		List<HudLine> lines = new ArrayList<>(4);
		int decimals = Math.max(0, Math.min(4, cfg.decimals));
		String format = "%." + decimals + "f";

		if (cfg.showXyz) {
			lines.add(HudLine.of("XYZ " + String.format(format, player.getX())
					+ " / " + String.format(format, player.getY())
					+ " / " + String.format(format, player.getZ()), color));
		}

		BlockPos pos = player.getBlockPos();

		if (cfg.showChunkRelative) {
			// Math.floorMod keeps the in-chunk offset positive on the negative side of the axes.
			int inChunkX = Math.floorMod(pos.getX(), 16);
			int inChunkZ = Math.floorMod(pos.getZ(), 16);
			lines.add(HudLine.of("Chunk " + inChunkX + " " + (pos.getY() & 15) + " " + inChunkZ
					+ " in " + (pos.getX() >> 4) + " " + (pos.getZ() >> 4), color));
		}

		if (cfg.showFacing) {
			Direction facing = player.getHorizontalFacing();
			lines.add(HudLine.of("Facing " + capitalize(facing.getName()) + " " + axisHint(facing)
					+ String.format(" (%.1f / %.1f)", wrapDegrees(player.getYaw()), wrapDegrees(player.getPitch())), color));
		}

		if (cfg.showBiome) {
			RegistryEntry<Biome> biome = world.getBiome(pos);
			// getIdAsString yields "minecraft:plains" for registered biomes and a
			// readable placeholder for a datapack biome with no id.
			lines.add(HudLine.of("Biome " + biome.getIdAsString(), color));
		}

		return lines;
	}

	/** Which way the world axes move when facing this direction, as the F3 screen shows it. */
	private static String axisHint(Direction facing) {
		return switch (facing) {
			case NORTH -> "(-Z)";
			case SOUTH -> "(+Z)";
			case WEST -> "(-X)";
			case EAST -> "(+X)";
			default -> "";
		};
	}

	private static String capitalize(String value) {
		return value.isEmpty() ? value : Character.toUpperCase(value.charAt(0)) + value.substring(1);
	}

	private static float wrapDegrees(float degrees) {
		float wrapped = degrees % 360.0F;
		if (wrapped >= 180.0F) {
			wrapped -= 360.0F;
		}
		if (wrapped < -180.0F) {
			wrapped += 360.0F;
		}
		return wrapped;
	}

}
