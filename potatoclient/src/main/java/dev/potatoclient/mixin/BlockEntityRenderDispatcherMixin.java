package dev.potatoclient.mixin;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.PotatoConfig;
import net.minecraft.block.entity.BlockEntity;
import net.minecraft.client.render.Camera;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.block.entity.BlockEntityRenderDispatcher;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.math.Vec3d;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.Shadow;
import org.spongepowered.asm.mixin.injection.At;
import org.spongepowered.asm.mixin.injection.Inject;
import org.spongepowered.asm.mixin.injection.callback.CallbackInfo;

/**
 * Caps how far chests, signs and banners are drawn.
 *
 * <p>Each block entity renderer is an individual draw with its own model and
 * matrix work, so a storage room stops costing anything once it is past the
 * radius. Terrain is untouched, which is what keeps this compatible with
 * Sodium's chunk meshing.
 */
@Mixin(BlockEntityRenderDispatcher.class)
public class BlockEntityRenderDispatcherMixin {
	@Shadow
	public Camera camera;

	@Inject(
			method = "render(Lnet/minecraft/block/entity/BlockEntity;FLnet/minecraft/client/util/math/MatrixStack;Lnet/minecraft/client/render/VertexConsumerProvider;)V",
			at = @At("HEAD"),
			cancellable = true)
	private void potatoclient$limitDistance(BlockEntity blockEntity, float tickDelta, MatrixStack matrices,
			VertexConsumerProvider vertexConsumers, CallbackInfo ci) {
		PotatoConfig cfg = ConfigManager.get().potato;
		if (!cfg.limitBlockEntityDistance || this.camera == null) {
			return;
		}

		BlockPos pos = blockEntity.getPos();
		Vec3d cameraPos = this.camera.getPos();
		// Measured to the block's centre so a chest does not pop a half block early.
		double dx = pos.getX() + 0.5D - cameraPos.x;
		double dy = pos.getY() + 0.5D - cameraPos.y;
		double dz = pos.getZ() + 0.5D - cameraPos.z;

		if (dx * dx + dy * dy + dz * dz > cfg.blockEntityDistance * cfg.blockEntityDistance) {
			ci.cancel();
		}
	}
}
