package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import net.minecraft.client.render.Fog;
import net.minecraft.client.render.SkyRendering;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.util.math.MatrixStack;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Skips the sky dome, stars, sun and moon.
 *
 * <p>Each pass is cancelled separately rather than the whole sky stage, so the
 * cleared framebuffer still shows the fog colour and the world does not render
 * against an undefined background.
 */
@Mixin(SkyRendering.class)
public class SkyRenderingMixin {
	private static boolean potatoclient$skySuppressed() {
		return ConfigManager.get().potato.disableSky;
	}

	@Inject(method = "renderSky", at = @At("HEAD"), cancellable = true)
	private void potatoclient$skipSky(float red, float green, float blue, CallbackInfo ci) {
		if (potatoclient$skySuppressed()) {
			ci.cancel();
		}
	}

	@Inject(method = "renderSkyDark", at = @At("HEAD"), cancellable = true)
	private void potatoclient$skipSkyDark(MatrixStack matrices, CallbackInfo ci) {
		if (potatoclient$skySuppressed()) {
			ci.cancel();
		}
	}

	@Inject(method = "renderStars", at = @At("HEAD"), cancellable = true)
	private void potatoclient$skipStars(Fog fog, float alpha, MatrixStack matrices, CallbackInfo ci) {
		if (potatoclient$skySuppressed()) {
			ci.cancel();
		}
	}

	@Inject(method = "renderCelestialBodies", at = @At("HEAD"), cancellable = true)
	private void potatoclient$skipCelestialBodies(MatrixStack matrices, VertexConsumerProvider.Immediate vertexConsumers,
			float tickDelta, int color, float alpha, float rainGradient, Fog fog, CallbackInfo ci) {
		if (potatoclient$skySuppressed()) {
			ci.cancel();
		}
	}

	@Inject(method = "renderEndSky", at = @At("HEAD"), cancellable = true)
	private void potatoclient$skipEndSky(CallbackInfo ci) {
		if (potatoclient$skySuppressed()) {
			ci.cancel();
		}
	}
}
