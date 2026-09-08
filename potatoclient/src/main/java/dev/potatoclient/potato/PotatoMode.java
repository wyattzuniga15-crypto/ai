package dev.potatoclient.potato;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.PotatoConfig;

/**
 * Applies the Potato Mode master switch.
 *
 * <p>Switching it on snapshots every per-feature flag and forces them all on;
 * switching it off restores the snapshot. Renderers never ask whether Potato
 * Mode is engaged, only whether their own feature is disabled, which is what
 * keeps each option individually toggleable while the mode is on.
 */
public final class PotatoMode {
	private PotatoMode() {
	}

	public static boolean isEngaged() {
		return ConfigManager.get().potato.potatoMode;
	}

	public static void toggle() {
		set(!isEngaged());
	}

	public static void set(boolean on) {
		PotatoConfig cfg = ConfigManager.get().potato;
		if (cfg.potatoMode == on) {
			return;
		}

		if (on) {
			cfg.savedState = snapshot(cfg);
			cfg.disableParticles = true;
			cfg.disableWeather = true;
			cfg.disableClouds = true;
			cfg.disableFog = true;
			cfg.disableSky = true;
			cfg.disableEntityShadows = true;
			cfg.freezeAnimatedTextures = true;
			cfg.disableGlint = true;
			cfg.limitDecorationDistance = true;
			cfg.limitBlockEntityDistance = true;
			cfg.aggressiveEntityCulling = true;
		} else if (cfg.savedState != null) {
			restore(cfg, cfg.savedState);
			cfg.savedState = null;
		}

		cfg.potatoMode = on;
		ConfigManager.save();
	}

	private static PotatoConfig.Snapshot snapshot(PotatoConfig cfg) {
		PotatoConfig.Snapshot s = new PotatoConfig.Snapshot();
		s.disableParticles = cfg.disableParticles;
		s.particleCap = cfg.particleCap;
		s.disableWeather = cfg.disableWeather;
		s.disableClouds = cfg.disableClouds;
		s.disableFog = cfg.disableFog;
		s.disableSky = cfg.disableSky;
		s.disableEntityShadows = cfg.disableEntityShadows;
		s.freezeAnimatedTextures = cfg.freezeAnimatedTextures;
		s.disableGlint = cfg.disableGlint;
		s.limitDecorationDistance = cfg.limitDecorationDistance;
		s.limitBlockEntityDistance = cfg.limitBlockEntityDistance;
		s.aggressiveEntityCulling = cfg.aggressiveEntityCulling;
		return s;
	}

	private static void restore(PotatoConfig cfg, PotatoConfig.Snapshot s) {
		cfg.disableParticles = s.disableParticles;
		cfg.particleCap = s.particleCap;
		cfg.disableWeather = s.disableWeather;
		cfg.disableClouds = s.disableClouds;
		cfg.disableFog = s.disableFog;
		cfg.disableSky = s.disableSky;
		cfg.disableEntityShadows = s.disableEntityShadows;
		cfg.freezeAnimatedTextures = s.freezeAnimatedTextures;
		cfg.disableGlint = s.disableGlint;
		cfg.limitDecorationDistance = s.limitDecorationDistance;
		cfg.limitBlockEntityDistance = s.limitBlockEntityDistance;
		cfg.aggressiveEntityCulling = s.aggressiveEntityCulling;
	}
}
