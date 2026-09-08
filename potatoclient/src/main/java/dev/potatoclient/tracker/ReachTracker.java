package dev.potatoclient.tracker;

import net.minecraft.entity.Entity;
import net.minecraft.entity.player.PlayerEntity;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;

/**
 * Records how far away the last entity the player hit actually was.
 *
 * <p>The number reported is the distance from the player's eyes to the nearest
 * point of the target's bounding box, which is the quantity a server-side reach
 * check measures. Distance to the entity's centre would read roughly half a
 * block longer and would not match.
 */
public final class ReachTracker {
	private double lastReach = -1.0D;
	private String lastTargetName = "";
	private int ticksSinceHit = Integer.MAX_VALUE;

	public void recordHit(PlayerEntity attacker, Entity target) {
		Vec3d eye = attacker.getEyePos();
		this.lastReach = distanceToBox(eye, target.getBoundingBox());
		this.lastTargetName = target.getName().getString();
		this.ticksSinceHit = 0;
	}

	public void tick() {
		if (this.ticksSinceHit != Integer.MAX_VALUE) {
			this.ticksSinceHit++;
		}
	}

	public void reset() {
		this.lastReach = -1.0D;
		this.lastTargetName = "";
		this.ticksSinceHit = Integer.MAX_VALUE;
	}

	public boolean hasReading(int holdTicks) {
		if (this.lastReach < 0.0D) {
			return false;
		}
		return holdTicks <= 0 || this.ticksSinceHit <= holdTicks;
	}

	public double getLastReach() {
		return this.lastReach;
	}

	public String getLastTargetName() {
		return this.lastTargetName;
	}

	/** Euclidean distance from a point to the closest point of a box; 0 when inside. */
	public static double distanceToBox(Vec3d point, Box box) {
		double dx = Math.max(Math.max(box.minX - point.x, 0.0D), point.x - box.maxX);
		double dy = Math.max(Math.max(box.minY - point.y, 0.0D), point.y - box.maxY);
		double dz = Math.max(Math.max(box.minZ - point.z, 0.0D), point.z - box.maxZ);
		return Math.sqrt(dx * dx + dy * dy + dz * dz);
	}
}
