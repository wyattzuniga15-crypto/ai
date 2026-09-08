package dev.potatoclient.config;

/**
 * Potato Mode: one switch that maximises framerate at the cost of looks.
 *
 * <p>The switch is not a separate rendering path. Turning it on snapshots the
 * current per-feature flags and writes {@code true} to all of them; turning it
 * off restores the snapshot. Every feature therefore stays individually
 * toggleable, including while Potato Mode is on, and the renderers only ever
 * read the per-feature flags.
 */
public class PotatoConfig {
	/** Whether the master switch is currently engaged. */
	public boolean potatoMode = false;

	public boolean disableParticles = false;
	/** When particles are not disabled outright, stop spawning past this many. -1 disables the cap. */
	public int particleCap = -1;
	public boolean disableWeather = false;
	public boolean disableClouds = false;
	public boolean disableFog = false;
	public boolean disableSky = false;
	public boolean disableEntityShadows = false;
	public boolean freezeAnimatedTextures = false;
	public boolean disableGlint = false;

	/** Cull item frames, armour stands and other decoration past {@link #decorationDistance}. */
	public boolean limitDecorationDistance = false;
	public double decorationDistance = 24.0D;

	/** Cull chests, signs, banners and friends past {@link #blockEntityDistance}. */
	public boolean limitBlockEntityDistance = false;
	public double blockEntityDistance = 24.0D;

	/** Skip entities outside the frustum and (optionally) behind solid blocks. */
	public boolean aggressiveEntityCulling = false;
	/** Add an occlusion test on top of the frustum test. Costs a raycast per entity. */
	public boolean occlusionCulling = true;
	/** Entities nearer than this are never occlusion-culled, so melee targets never pop. */
	public double occlusionMinDistance = 8.0D;
	/** Ticks an occlusion result is reused before it is recomputed. */
	public int occlusionCacheTicks = 4;

	/** Snapshot of the per-feature flags taken when Potato Mode was switched on. */
	public Snapshot savedState = null;

	public static class Snapshot {
		public boolean disableParticles;
		public int particleCap;
		public boolean disableWeather;
		public boolean disableClouds;
		public boolean disableFog;
		public boolean disableSky;
		public boolean disableEntityShadows;
		public boolean freezeAnimatedTextures;
		public boolean disableGlint;
		public boolean limitDecorationDistance;
		public boolean limitBlockEntityDistance;
		public boolean aggressiveEntityCulling;
	}
}
