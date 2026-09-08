package dev.potatoclient;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.hud.HudManager;
import dev.potatoclient.potato.EntityCulling;
import dev.potatoclient.potato.PotatoMode;
import dev.potatoclient.render.BlockOutlineRenderer;
import dev.potatoclient.render.ChunkBorders;
import dev.potatoclient.render.EspRenderer;
import dev.potatoclient.render.Fullbright;
import dev.potatoclient.render.HitboxRenderer;
import dev.potatoclient.screen.ConfigScreen;
import dev.potatoclient.screen.HudEditorScreen;
import net.fabricmc.api.ClientModInitializer;
import net.fabricmc.fabric.api.client.event.lifecycle.v1.ClientTickEvents;
import net.fabricmc.fabric.api.client.rendering.v1.HudLayerRegistrationCallback;
import net.fabricmc.fabric.api.client.rendering.v1.IdentifiedLayer;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderEvents;
import net.fabricmc.loader.api.FabricLoader;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.text.Text;
import net.minecraft.util.Identifier;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/** Client entrypoint: loads the config, registers keybinds, HUD and render hooks. */
public class PotatoClient implements ClientModInitializer {
	public static final String MOD_ID = "potatoclient";
	public static final Logger LOGGER = LoggerFactory.getLogger("Potato Client");

	private static ClientWorld lastWorld;

	@Override
	public void onInitializeClient() {
		ConfigManager.load();
		PotatoClientKeys.register();

		// Draw above the vanilla overlays but below chat and the debug screen, so
		// the HUD never covers text the player is reading.
		HudLayerRegistrationCallback.EVENT.register(layered ->
				layered.attachLayerAfter(IdentifiedLayer.MISC_OVERLAYS,
						Identifier.of(MOD_ID, "hud"),
						HudManager::render));

		WorldRenderEvents.AFTER_ENTITIES.register(context -> {
			HitboxRenderer.render(context);
			EspRenderer.render(context);
		});
		WorldRenderEvents.BLOCK_OUTLINE.register(BlockOutlineRenderer::onBlockOutline);

		ClientTickEvents.END_CLIENT_TICK.register(this::onEndTick);

		LOGGER.info("Potato Client ready{}", FabricLoader.getInstance().isModLoaded("sodium")
				? " (Sodium detected: chunk rendering left to Sodium)"
				: "");
	}

	private void onEndTick(MinecraftClient client) {
		handleWorldChange(client);
		handleKeybinds(client);

		HudManager.tick();
		ChunkBorders.apply();
		Fullbright.apply();
		ConfigManager.saveIfDirty();
	}

	private void handleWorldChange(MinecraftClient client) {
		if (client.world == lastWorld) {
			return;
		}
		lastWorld = client.world;
		HudManager.onWorldChanged();
		EntityCulling.clear();

		if (client.world == null) {
			// Leaving a world: hand the player's own gamma back before the menu.
			Fullbright.restore();
		}
	}

	private void handleKeybinds(MinecraftClient client) {
		while (PotatoClientKeys.openConfig.wasPressed()) {
			client.setScreen(new ConfigScreen(null));
		}
		while (PotatoClientKeys.openHudEditor.wasPressed()) {
			client.setScreen(new HudEditorScreen(null));
		}
		while (PotatoClientKeys.togglePotatoMode.wasPressed()) {
			PotatoMode.toggle();
			sendStatus(client, "Potato Mode", PotatoMode.isEngaged());
		}
		while (PotatoClientKeys.toggleHitboxes.wasPressed()) {
			boolean enabled = !ConfigManager.get().render.hitboxes.enabled;
			ConfigManager.get().render.hitboxes.enabled = enabled;
			ConfigManager.save();
			sendStatus(client, "Hitboxes", enabled);
		}
		while (PotatoClientKeys.toggleChunkBorders.wasPressed()) {
			ChunkBorders.toggle();
			sendStatus(client, "Chunk borders", ConfigManager.get().render.chunkBorders.enabled);
		}
		while (PotatoClientKeys.toggleFullbright.wasPressed()) {
			Fullbright.toggle();
			sendStatus(client, "Fullbright", ConfigManager.get().render.fullbright.enabled);
		}
		while (PotatoClientKeys.toggleHud.wasPressed()) {
			boolean enabled = !ConfigManager.get().hud.enabled;
			ConfigManager.get().hud.enabled = enabled;
			ConfigManager.save();
			sendStatus(client, "HUD", enabled);
		}
	}

	/** Toggles report to the action bar; a chat line per keypress would be noise. */
	private static void sendStatus(MinecraftClient client, String label, boolean enabled) {
		if (client.player == null) {
			return;
		}
		client.player.sendMessage(Text.literal(label + ": " + (enabled ? "on" : "off")), true);
	}
}
