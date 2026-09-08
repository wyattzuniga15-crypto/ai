package dev.potatoclient.hud.modules;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudLine;
import dev.potatoclient.hud.TextHudModule;
import dev.potatoclient.tracker.FpsTracker;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

/** Current framerate plus a rolling average and the 1% low, colour-coded. */
public class FpsHud extends TextHudModule {
	private final FpsTracker tracker;

	public FpsHud(FpsTracker tracker) {
		this.tracker = tracker;
	}

	@Override
	public String id() {
		return "fps";
	}

	@Override
	public Text displayName() {
		return Text.literal("FPS");
	}

	@Override
	public HudElementConfig element() {
		return ConfigManager.get().hud.fps.element;
	}

	@Override
	protected List<HudLine> buildLines(boolean editing) {
		HudConfig.Fps cfg = ConfigManager.get().hud.fps;
		this.tracker.setWindowSeconds(cfg.windowSeconds);

		List<HudLine> lines = new ArrayList<>(3);
		int current = this.client.getCurrentFps();

		if (cfg.showCurrent) {
			lines.add(HudLine.of(current + " FPS", colorFor(current, cfg)));
		}
		if (cfg.showAverage) {
			double avg = this.tracker.getAverageFps();
			lines.add(HudLine.of(String.format("avg %.0f", avg), colorFor((int) Math.round(avg), cfg)));
		}
		if (cfg.showOnePercentLow) {
			double low = this.tracker.getOnePercentLowFps();
			lines.add(HudLine.of(String.format("1%% low %.0f", low), colorFor((int) Math.round(low), cfg)));
		}
		return lines;
	}

	private int colorFor(int fps, HudConfig.Fps cfg) {
		if (!cfg.colorCoded) {
			return element().textColor;
		}
		if (fps > cfg.goodThreshold) {
			return cfg.goodColor;
		}
		return fps >= cfg.fairThreshold ? cfg.fairColor : cfg.badColor;
	}
}
