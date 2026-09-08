package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import net.minecraft.client.option.CloudRenderMode;
import net.minecraft.client.render.CloudRenderer;
import net.minecraft.util.math.Vec3d;
import org.joml.Matrix4f;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Skips the cloud layer.
 *
 * <p>Cancelling at the head of the render call also skips the mesh rebuild that
 * happens when the player crosses a cloud cell, so nothing is being prepared for
 * geometry that is never drawn.
 */
@Mixin(CloudRenderer.class)
public class CloudRendererMixin {
	@Inject(
			method = "renderClouds(ILnet/minecraft/client/option/CloudRenderMode;FLorg/joml/Matrix4f;Lorg/joml/Matrix4f;Lnet/minecraft/util/math/Vec3d;F)V",
			at = @At("HEAD"),
			cancellable = true)
	private void potatoclient$skipClouds(int color, CloudRenderMode cloudRenderMode, float cloudHeight,
			Matrix4f positionMatrix, Matrix4f projectionMatrix, Vec3d cameraPos, float ticks, CallbackInfo ci) {
		if (ConfigManager.get().potato.disableClouds) {
			ci.cancel();
		}
	}
}
