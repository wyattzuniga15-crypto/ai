package dev.potatoclient.mixin;

import dev.potatoclient.hud.HudManager;
import net.minecraft.client.Mouse;
import org.lwjgl.glfw.GLFW;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/** Feeds the CPS counters. Clicks made inside a screen are not gameplay clicks and are ignored. */
@Mixin(Mouse.class)
public class MouseMixin {
	@Inject(method = "onMouseButton", at = @At("HEAD"))
	private void potatoclient$countClicks(long window, int button, int action, int mods, CallbackInfo ci) {
		if (action != GLFW.GLFW_PRESS) {
			return;
		}

		net.minecraft.client.MinecraftClient client = net.minecraft.client.MinecraftClient.getInstance();
		if (client.currentScreen != null) {
			return;
		}

		if (button == GLFW.GLFW_MOUSE_BUTTON_LEFT) {
			HudManager.leftClickTracker().onClick();
		} else if (button == GLFW.GLFW_MOUSE_BUTTON_RIGHT) {
			HudManager.rightClickTracker().onClick();
		}
	}
}
