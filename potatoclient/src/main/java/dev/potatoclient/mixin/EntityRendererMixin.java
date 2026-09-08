package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.PotatoConfig;
import dev.potatoclient.potato.EntityCulling;
import net.minecraft.client.render.Frustum;
import net.minecraft.client.render.entity.EntityRenderer;
import net.minecraft.entity.Entity;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfoReturnable;

/**
 * The single gate for entity culling and the decoration distance limit.
 *
 * <p>{@code EntityRenderer#shouldRender} is the right hook for Sodium
 * compatibility: Sodium rewrites chunk and terrain rendering but leaves this
 * per-entity decision alone, and because the injection only ever returns
 * {@code false} it composes with any other mod that also wants to skip an
 * entity.
 *
 * <p>Vanilla already frustum-culls here. What is added is the occlusion test,
 * the decoration radius, and ignoring {@code ignoreCameraFrustum} for entities
 * that ask to be drawn even when off-screen.
 */
@Mixin(EntityRenderer.class)
public class EntityRendererMixin {
	@Inject(method = "shouldRender", at = @At("HEAD"), cancellable = true)
	private void potatoclient$cull(Entity entity, Frustum frustum, double cameraX, double cameraY, double cameraZ,
			CallbackInfoReturnable<Boolean> cir) {
		PotatoConfig cfg = ConfigManager.get().potato;
		if (!cfg.aggressiveEntityCulling && !cfg.limitDecorationDistance) {
			return;
		}

		if (cfg.aggressiveEntityCulling && !frustum.isVisible(entity.getBoundingBox())) {
			cir.setReturnValue(false);
			return;
		}

		if (EntityCulling.shouldCull(entity, cameraX, cameraY, cameraZ)) {
			cir.setReturnValue(false);
		}
	}
}
