package dev.potatoclient.render;

import dev.potatoclient.config.ConfigManager;
import net.minecraft.client.MinecraftClient;

/**
 * Chunk borders on a keybind.
 *
 * <p>This drives the vanilla renderer's own flag rather than drawing a second
 * grid, so the lines look exactly like F3+G and cost nothing when off. The flag
 * is re-applied each tick because vanilla's own F3+G toggle writes the same
 * field.
 */
public final class ChunkBorders {
	private ChunkBorders() {
	}

	public static void toggle() {
		boolean enabled = !ConfigManager.get().render.chunkBorders.enabled;
		ConfigManager.get().render.chunkBorders.enabled = enabled;
		ConfigManager.save();
		apply();
	}

	public static void apply() {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client.debugRenderer == null) {
			return;
		}
		client.debugRenderer.showChunkBorder = ConfigManager.get().render.chunkBorders.enabled;
	}
}
