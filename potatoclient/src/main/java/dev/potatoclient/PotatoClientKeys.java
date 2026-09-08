package dev.potatoclient;

import net.fabricmc.fabric.api.client.keybinding.v1.KeyBindingHelper;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.util.InputUtil;
import org.lwjgl.glfw.GLFW;

/** Every keybind the mod registers, all unbound-friendly and rebindable in Controls. */
public final class PotatoClientKeys {
	private static final String CATEGORY = "category.potatoclient.main";

	public static KeyBinding openConfig;
	public static KeyBinding openHudEditor;
	public static KeyBinding togglePotatoMode;
	public static KeyBinding toggleHitboxes;
	public static KeyBinding toggleChunkBorders;
	public static KeyBinding toggleFullbright;
	public static KeyBinding toggleHud;

	private PotatoClientKeys() {
	}

	public static void register() {
		openConfig = bind("key.potatoclient.config", GLFW.GLFW_KEY_F9);
		openHudEditor = bind("key.potatoclient.hud_editor", GLFW.GLFW_KEY_F10);
		togglePotatoMode = bind("key.potatoclient.potato_mode", GLFW.GLFW_KEY_P);
		toggleHitboxes = bind("key.potatoclient.hitboxes", GLFW.GLFW_KEY_B);
		toggleChunkBorders = bind("key.potatoclient.chunk_borders", GLFW.GLFW_KEY_G);
		// Unbound by default: fullbright and hiding the HUD are personal choices,
		// and stealing another key for them would be rude.
		toggleFullbright = bind("key.potatoclient.fullbright", GLFW.GLFW_KEY_UNKNOWN);
		toggleHud = bind("key.potatoclient.toggle_hud", GLFW.GLFW_KEY_UNKNOWN);
	}

	private static KeyBinding bind(String translationKey, int keyCode) {
		return KeyBindingHelper.registerKeyBinding(
				new KeyBinding(translationKey, InputUtil.Type.KEYSYM, keyCode, CATEGORY));
	}
}
