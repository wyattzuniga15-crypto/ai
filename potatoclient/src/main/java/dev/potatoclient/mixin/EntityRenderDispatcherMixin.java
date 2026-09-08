package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.entity.EntityRenderDispatcher;
import net.minecraft.client.render.entity.state.EntityRenderState;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.world.WorldView;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Skips entity drop shadows.
 *
 * <p>{@code renderShadow} is static in 1.21.4, so the handler is static too. The
 * shadow pass samples the blocks under every entity, which is why dropping it
 * pays off in crowded scenes rather than only saving a few triangles.
 */
@Mixin(EntityRenderDispatcher.class)
public class EntityRenderDispatcherMixin {
	@Inject(method = "renderShadow", at = @At("HEAD"), cancellable = true)
	private static void potatoclient$skipShadows(MatrixStack matrices, VertexConsumerProvider vertexConsumers,
			EntityRenderState renderState, float opacity, float tickDelta, WorldView world, float radius,
			CallbackInfo ci) {
		if (ConfigManager.get().potato.disableEntityShadows) {
			ci.cancel();
		}
	}
}
