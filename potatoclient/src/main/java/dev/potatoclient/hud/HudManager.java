package dev.potatoclient.hud;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.hud.modules.ArmorHud;
import dev.potatoclient.hud.modules.CoordinatesHud;
import dev.potatoclient.hud.modules.CpsHud;
import dev.potatoclient.hud.modules.FpsHud;
import dev.potatoclient.hud.modules.KeystrokesHud;
import dev.potatoclient.hud.modules.MemoryHud;
import dev.potatoclient.hud.modules.PingHud;
import dev.potatoclient.hud.modules.PotionHud;
import dev.potatoclient.hud.modules.ReachHud;
import dev.potatoclient.tracker.CpsTracker;
import dev.potatoclient.tracker.FpsTracker;
import dev.potatoclient.tracker.ReachTracker;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.hud.DebugHud;
import net.minecraft.client.render.RenderTickCounter;

import java.util.List;

/** Owns the HUD modules, their shared trackers, and the per-frame draw. */
public final class HudManager {
	private static final FpsTracker FPS = new FpsTracker();
	private static final CpsTracker LEFT_CLICKS = new CpsTracker();
	private static final CpsTracker RIGHT_CLICKS = new CpsTracker();
	private static final ReachTracker REACH = new ReachTracker();

	private static final List<HudModule> MODULES = List.of(
			new FpsHud(FPS),
			new CoordinatesHud(),
			new PingHud(),
			new CpsHud(LEFT_CLICKS, RIGHT_CLICKS),
			new KeystrokesHud(LEFT_CLICKS, RIGHT_CLICKS),
			new ArmorHud(),
			new PotionHud(),
			new ReachHud(REACH),
			new MemoryHud());

	/** Bumped once per drawn frame; text modules key their layout cache off it. */
	private static long frame;
	private static boolean editing;

	private HudManager() {
	}

	public static List<HudModule> modules() {
		return MODULES;
	}

	public static FpsTracker fpsTracker() {
		return FPS;
	}

	public static CpsTracker leftClickTracker() {
		return LEFT_CLICKS;
	}

	public static CpsTracker rightClickTracker() {
		return RIGHT_CLICKS;
	}

	public static ReachTracker reachTracker() {
		return REACH;
	}

	public static long frameCounter() {
		return frame;
	}

	/** True while the HUD editor screen is open, so modules can show placeholder content. */
	public static boolean isEditing() {
		return editing;
	}

	public static void setEditing(boolean value) {
		editing = value;
	}

	public static void tick() {
		for (HudModule module : MODULES) {
			module.tick();
		}
	}

	public static void onWorldChanged() {
		FPS.reset();
		LEFT_CLICKS.reset();
		RIGHT_CLICKS.reset();
		REACH.reset();
		for (HudModule module : MODULES) {
			module.reset();
		}
	}

	/** The HUD layer body, registered against Fabric's layered drawer. */
	public static void render(DrawContext context, RenderTickCounter tickCounter) {
		FPS.onFrame();
		frame++;

		if (!shouldDraw()) {
			return;
		}

		int screenWidth = context.getScaledWindowWidth();
		int screenHeight = context.getScaledWindowHeight();

		for (HudModule module : MODULES) {
			if (!module.isEnabled() || !module.hasContent()) {
				continue;
			}
			module.render(context, tickCounter, module.screenX(screenWidth), module.screenY(screenHeight), false);
		}
	}

	private static boolean shouldDraw() {
		HudConfig cfg = ConfigManager.get().hud;
		if (!cfg.enabled) {
			return false;
		}

		MinecraftClient client = MinecraftClient.getInstance();
		if (client.options != null && client.options.hudHidden) {
			return false;
		}
		if (cfg.hideInScreens && client.currentScreen != null) {
			return false;
		}
		if (cfg.hideWithDebugScreen && isDebugHudOpen(client)) {
			return false;
		}
		return true;
	}

	private static boolean isDebugHudOpen(MinecraftClient client) {
		if (client.inGameHud == null) {
			return false;
		}
		DebugHud debugHud = client.inGameHud.getDebugHud();
		return debugHud != null && debugHud.shouldShowDebugHud();
	}
}
