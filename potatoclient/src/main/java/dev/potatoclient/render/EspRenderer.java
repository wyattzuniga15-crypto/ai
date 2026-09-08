package dev.potatoclient.render;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.RenderConfig;
import dev.potatoclient.render.RenderUtil.LineBatch;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ExperienceOrbEntity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;

/**
 * Outlines dropped items and experience orbs.
 *
 * <p>Off by default. The through-walls toggle picks the render layer: the debug
 * line strip is what vanilla's own debug renderers draw over terrain with, while
 * the ordinary line layer stays behind blocks.
 */
public final class EspRenderer {
	/** Items and orbs are small; a little padding makes the outline readable. */
	private static final double PADDING = 0.08D;
	/** Ceiling on boxes per frame, since the through-walls layer flushes per box. */
	private static final int MAX_BOXES = 256;

	private EspRenderer() {
	}

	public static void render(WorldRenderContext context) {
		RenderConfig.Esp cfg = ConfigManager.get().render.esp;
		if (!cfg.items && !cfg.experienceOrbs) {
			return;
		}

		ClientWorld world = context.world();
		MatrixStack matrices = context.matrixStack();
		VertexConsumerProvider consumers = context.consumers();
		if (world == null || matrices == null || consumers == null || context.camera() == null) {
			return;
		}

		Vec3d cameraPos = context.camera().getPos();
		double maxDistanceSq = cfg.maxDistance * cfg.maxDistance;
		float tickDelta = context.tickCounter().getTickDelta(false);

		matrices.push();
		matrices.translate(-cameraPos.x, -cameraPos.y, -cameraPos.z);

		try (LineBatch batch = cfg.throughWalls
				? LineBatch.throughWalls(consumers, cfg.lineWidth)
				: LineBatch.depthTested(consumers, cfg.lineWidth)) {
			int drawn = 0;
			for (Entity entity : world.getEntities()) {
				if (drawn >= MAX_BOXES) {
					break;
				}

				int color;
				if (cfg.items && entity instanceof ItemEntity) {
					color = cfg.itemColor;
				} else if (cfg.experienceOrbs && entity instanceof ExperienceOrbEntity) {
					color = cfg.orbColor;
				} else {
					continue;
				}

				if (entity.squaredDistanceTo(cameraPos) > maxDistanceSq) {
					continue;
				}

				Vec3d lerped = entity.getLerpedPos(tickDelta);
				Box box = entity.getBoundingBox().offset(lerped.subtract(entity.getPos())).expand(PADDING);
				batch.box(matrices, box, color);
				drawn++;
			}
		}

		matrices.pop();
	}
}
