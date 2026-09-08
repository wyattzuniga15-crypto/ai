package dev.potatoclient.potato;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.PotatoConfig;
import net.minecraft.block.ShapeContext;
import net.minecraft.client.MinecraftClient;
import net.minecraft.entity.Entity;
import net.minecraft.entity.decoration.ArmorStandEntity;
import net.minecraft.entity.decoration.DisplayEntity;
import net.minecraft.entity.decoration.ItemFrameEntity;
import net.minecraft.entity.decoration.painting.PaintingEntity;
import net.minecraft.util.hit.HitResult;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.world.RaycastContext;

import java.util.Map;
import java.util.WeakHashMap;

/**
 * Decides which entities can be skipped this frame.
 *
 * <p>Two independent tests. The distance test drops decoration entities past a
 * configured radius, which is what makes a wall of item frames cheap. The
 * occlusion test drops entities hidden behind solid blocks, sampling a handful
 * of corner rays rather than one centre ray so an entity peeking around a corner
 * is not culled.
 *
 * <p>Results are cached per entity for a few ticks: a raycast per entity per
 * frame would cost more than the draw it saves. The cache is a
 * {@link WeakHashMap} so despawned entities do not pin memory.
 */
public final class EntityCulling {
	private static final Map<Entity, CacheEntry> CACHE = new WeakHashMap<>();

	private static final class CacheEntry {
		boolean occluded;
		long expiresAtTick;
	}

	private EntityCulling() {
	}

	public static void clear() {
		CACHE.clear();
	}

	/** True when the entity is decoration that the distance limit applies to. */
	public static boolean isDecoration(Entity entity) {
		return entity instanceof ItemFrameEntity
				|| entity instanceof ArmorStandEntity
				|| entity instanceof PaintingEntity
				|| entity instanceof DisplayEntity;
	}

	/**
	 * @return true when the entity may be skipped entirely this frame
	 */
	public static boolean shouldCull(Entity entity, double cameraX, double cameraY, double cameraZ) {
		PotatoConfig cfg = ConfigManager.get().potato;
		MinecraftClient client = MinecraftClient.getInstance();

		// The camera entity is never culled; in third person it is the subject.
		if (entity == client.getCameraEntity()) {
			return false;
		}

		double distanceSq = entity.squaredDistanceTo(cameraX, cameraY, cameraZ);

		if (cfg.limitDecorationDistance && isDecoration(entity)
				&& distanceSq > cfg.decorationDistance * cfg.decorationDistance) {
			return true;
		}

		if (!cfg.aggressiveEntityCulling || !cfg.occlusionCulling) {
			return false;
		}

		// Close entities are never occlusion-culled: a melee target flickering
		// out because a corner clipped the ray is far worse than the frames saved.
		if (distanceSq < cfg.occlusionMinDistance * cfg.occlusionMinDistance) {
			return false;
		}

		return isOccluded(entity, new Vec3d(cameraX, cameraY, cameraZ), cfg);
	}

	private static boolean isOccluded(Entity entity, Vec3d camera, PotatoConfig cfg) {
		if (entity.getWorld() == null) {
			return false;
		}

		long now = entity.getWorld().getTime();
		CacheEntry cached = CACHE.get(entity);
		if (cached != null && cached.expiresAtTick > now) {
			return cached.occluded;
		}

		boolean occluded = computeOcclusion(entity, camera);

		CacheEntry entry = cached == null ? new CacheEntry() : cached;
		entry.occluded = occluded;
		entry.expiresAtTick = now + Math.max(1, cfg.occlusionCacheTicks);
		CACHE.put(entity, entry);
		return occluded;
	}

	/** Samples the box centre and its eight corners, pulled slightly inward. */
	private static boolean computeOcclusion(Entity entity, Vec3d camera) {
		Box box = entity.getBoundingBox();
		// Shrinking avoids rays that graze the block the entity is standing in.
		Box probe = box.contract(Math.min(0.1D, box.getLengthX() / 4.0D),
				Math.min(0.1D, box.getLengthY() / 4.0D),
				Math.min(0.1D, box.getLengthZ() / 4.0D));

		if (!isBlocked(entity, camera, probe.getCenter())) {
			return false;
		}

		for (int corner = 0; corner < 8; corner++) {
			double x = (corner & 1) == 0 ? probe.minX : probe.maxX;
			double y = (corner & 2) == 0 ? probe.minY : probe.maxY;
			double z = (corner & 4) == 0 ? probe.minZ : probe.maxZ;
			if (!isBlocked(entity, camera, new Vec3d(x, y, z))) {
				return false;
			}
		}

		return true;
	}

	private static boolean isBlocked(Entity entity, Vec3d from, Vec3d to) {
		RaycastContext context = new RaycastContext(from, to,
				RaycastContext.ShapeType.COLLIDER,
				RaycastContext.FluidHandling.NONE,
				ShapeContext.absent());
		return entity.getWorld().raycast(context).getType() != HitResult.Type.MISS;
	}
}
