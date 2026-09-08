package dev.potatoclient.render;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.RenderConfig;
import dev.potatoclient.mixin.SimpleOptionAccessor;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.option.SimpleOption;

/**
 * Gamma override, not a night-vision effect.
 *
 * <p>Vanilla's brightness slider clamps at 1.0, and {@link SimpleOption#setValue}
 * runs that clamp, so the value is written straight to the option's backing
 * field instead. The player's own setting is captured the first time fullbright
 * is engaged and written back when it is switched off, so toggling it does not
 * quietly rewrite their video settings.
 */
public final class Fullbright {
	private static Double savedGamma;
	private static boolean applied;

	private Fullbright() {
	}

	public static void toggle() {
		RenderConfig.Fullbright cfg = ConfigManager.get().render.fullbright;
		cfg.enabled = !cfg.enabled;
		ConfigManager.save();
		apply();
	}

	/** Called every client tick; cheap, and it survives the options screen resetting gamma. */
	@SuppressWarnings("unchecked")
	public static void apply() {
		MinecraftClient client = MinecraftClient.getInstance();
		if (client.options == null) {
			return;
		}

		RenderConfig.Fullbright cfg = ConfigManager.get().render.fullbright;
		SimpleOption<Double> gamma = client.options.getGamma();
		SimpleOptionAccessor<Double> accessor = (SimpleOptionAccessor<Double>) (Object) gamma;

		if (cfg.enabled) {
			if (!applied) {
				savedGamma = gamma.getValue();
				applied = true;
			}
			double target = Math.max(0.0D, cfg.gamma);
			// Another mod or the video settings screen can move gamma back, so
			// this re-asserts it rather than writing once.
			if (Math.abs(gamma.getValue() - target) > 1.0E-6D) {
				accessor.setPotatoValue(target);
			}
		} else if (applied) {
			accessor.setPotatoValue(savedGamma == null ? 0.5D : savedGamma);
			savedGamma = null;
			applied = false;
		}
	}

	/** Restores the player's gamma on disconnect so it never leaks into the menu. */
	public static void restore() {
		if (!applied) {
			return;
		}
		MinecraftClient client = MinecraftClient.getInstance();
		if (client.options != null && savedGamma != null) {
			@SuppressWarnings("unchecked")
			SimpleOptionAccessor<Double> accessor =
					(SimpleOptionAccessor<Double>) (Object) client.options.getGamma();
			accessor.setPotatoValue(savedGamma);
		}
		savedGamma = null;
		applied = false;
	}
}
