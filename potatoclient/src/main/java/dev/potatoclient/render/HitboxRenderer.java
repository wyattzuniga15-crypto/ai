package dev.potatoclient.render;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.RenderConfig;
import dev.potatoclient.render.RenderUtil.LineBatch;
import net.fabricmc.fabric.api.client.rendering.v1.WorldRenderContext;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.client.world.ClientWorld;
import net.minecraft.entity.Entity;
import net.minecraft.util.hit.EntityHitResult;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;

/**
 * Entity bounding boxes without the F3 debug screen.
 *
 * <p>Runs from Fabric's after-entities world render event rather than a
 * {@code WorldRenderer} mixin, which is the reason it coexists with Sodium: it
 * never touches terrain rendering or the chunk pipeline, it only appends lines
 * to the entity vertex consumer that is already in flight.
 */
public final class HitboxRenderer {
	private HitboxRenderer() {
	}

	public static void render(WorldRenderContext context) {
		RenderConfig.Hitboxes cfg = ConfigManager.get().render.hitboxes;
		if (!cfg.enabled) {
			return;
		}

		MinecraftClient client = MinecraftClient.getInstance();
		ClientWorld world = context.world();
		MatrixStack matrices = context.matrixStack();
		VertexConsumerProvider consumers = context.consumers();

		// matrixStack() is nullable when another mod supplies the context.
		if (world == null || matrices == null || consumers == null || context.camera() == null) {
			return;
		}

		Vec3d cameraPos = context.camera().getPos();
		double maxDistanceSq = cfg.maxDistance * cfg.maxDistance;
		Entity targeted = targetedEntity(client);
		float tickDelta = context.tickCounter().getTickDelta(false);

		matrices.push();
		// World rendering runs with the camera at the origin, so shift world
		// coordinates back by the camera position before emitting them.
		matrices.translate(-cameraPos.x, -cameraPos.y, -cameraPos.z);

		try (LineBatch batch = LineBatch.depthTested(consumers, cfg.lineWidth)) {
			int drawn = 0;
			for (Entity entity : world.getEntities()) {
				if (drawn >= cfg.maxBoxesPerFrame) {
					break;
				}
				if (!shouldDraw(client, entity, cfg, targeted, cameraPos, maxDistanceSq)) {
					continue;
				}
				drawEntity(batch, matrices, entity, cfg, tickDelta);
				drawn++;
			}
		}

		matrices.pop();
	}

	private static boolean shouldDraw(MinecraftClient client, Entity entity, RenderConfig.Hitboxes cfg,
			Entity targeted, Vec3d cameraPos, double maxDistanceSq) {
		if (!entity.isAlive()) {
			return false;
		}
		// Never box the camera's own body; it fills the screen in first person.
		if (entity == client.getCameraEntity()) {
			return false;
		}
		if (cfg.onlyTargeted && entity != targeted) {
			return false;
		}
		if (cfg.respectInvisibility && client.player != null && entity.isInvisibleTo(client.player)) {
			return false;
		}
		return entity.squaredDistanceTo(cameraPos) <= maxDistanceSq;
	}

	private static void drawEntity(LineBatch batch, MatrixStack matrices, Entity entity,
			RenderConfig.Hitboxes cfg, float tickDelta) {
		EntityCategory category = EntityCategory.of(entity);
		int color = RenderUtil.argb(category.color(cfg), cfg.opacity);

		// Interpolated position, so boxes do not lag a tick behind the model.
		Vec3d lerped = entity.getLerpedPos(tickDelta);
		Box box = entity.getBoundingBox().offset(lerped.subtract(entity.getPos()));

		batch.box(matrices, box, color);

		if (cfg.showAttackExpansion) {
			// Vanilla picks an entity by testing the ray against its box grown by
			// this much, so the outer box is the volume a hit actually needs.
			batch.box(matrices, box.expand(cfg.attackExpansion), RenderUtil.argb(cfg.expansionColor, cfg.opacity));
		}

		if (cfg.eyeLine) {
			Vec3d eye = new Vec3d(lerped.x, lerped.y + entity.getStandingEyeHeight(), lerped.z);
			Vec3d look = entity.getRotationVec(tickDelta);
			batch.line(matrices, eye, eye.add(look.multiply(cfg.eyeLineLength)), color);
		}
	}

	private static Entity targetedEntity(MinecraftClient client) {
		HitResult hit = client.crosshairTarget;
		return hit instanceof EntityHitResult entityHit ? entityHit.getEntity() : null;
	}
}
