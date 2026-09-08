package dev.potatoclient.render;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.RenderConfig;
import dev.potatoclient.render.RenderUtil.LineBatch;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.BlockPos;
import net.minecraft.util.shape.VoxelShape;

/**
 * Replaces the vanilla block outline with a configurable one.
 *
 * <p>Uses Fabric's block-outline event, so the vanilla outline is suppressed by
 * returning {@code false} rather than by overwriting {@code WorldRenderer}. That
 * matters for Sodium compatibility, since Sodium rewrites large parts of that
 * class and an {@code @Overwrite} there would be a hard conflict.
 *
 * <p>A voxel shape is a set of disjoint edges, so it is always drawn on the
 * pairs layer; the strip layer would join its edges together.
 */
public final class BlockOutlineRenderer {
	private BlockOutlineRenderer() {
	}

	/**
	 * @return false to suppress the vanilla outline, true to let it draw
	 */
	public static boolean onBlockOutline(WorldRenderContext worldContext,
			WorldRenderContext.BlockOutlineContext outlineContext) {
		RenderConfig.BlockOutline cfg = ConfigManager.get().render.blockOutline;
		if (!cfg.customize) {
			return true;
		}

		MatrixStack matrices = worldContext.matrixStack();
		VertexConsumerProvider consumers = worldContext.consumers();
		if (matrices == null || consumers == null) {
			return true;
		}

		BlockPos pos = outlineContext.blockPos();
		VoxelShape shape = outlineContext.blockState().getOutlineShape(worldContext.world(), pos);
		if (shape.isEmpty()) {
			return false;
		}

		double offsetX = pos.getX() - outlineContext.cameraX();
		double offsetY = pos.getY() - outlineContext.cameraY();
		double offsetZ = pos.getZ() - outlineContext.cameraZ();

		if (cfg.glow) {
			// A wider, dimmer pass underneath reads as a halo and stays visible
			// against busy terrain without blurring the crisp edge on top.
			try (LineBatch glow = LineBatch.depthTested(consumers, cfg.lineWidth * 2.5F)) {
				glow.outline(matrices, shape, offsetX, offsetY, offsetZ, RenderUtil.argb(cfg.color, cfg.glowOpacity));
			}
		}

		try (LineBatch batch = LineBatch.depthTested(consumers, cfg.lineWidth)) {
			batch.outline(matrices, shape, offsetX, offsetY, offsetZ, cfg.color);
		}

		return false;
	}
}
