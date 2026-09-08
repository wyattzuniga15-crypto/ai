package dev.potatoclient.hud.modules;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudLine;
import dev.potatoclient.hud.TextHudModule;
import dev.potatoclient.tracker.ReachTracker;
import net.minecraft.text.Text;

import java.util.List;

/** Distance to the entity the player last hit. */
public class ReachHud extends TextHudModule {
	private final ReachTracker tracker;

	public ReachHud(ReachTracker tracker) {
		this.tracker = tracker;
	}

	@Override
	public String id() {
		return "reach";
	}

	@Override
	public Text displayName() {
		return Text.literal("Reach");
	}

	@Override
	public HudElementConfig element() {
		return ConfigManager.get().hud.reach.element;
	}

	@Override
	public void tick() {
		this.tracker.tick();
	}

	@Override
	public void reset() {
		this.tracker.reset();
	}

	@Override
	protected List<HudLine> buildLines(boolean editing) {
		HudConfig.Reach cfg = ConfigManager.get().hud.reach;
		int color = element().textColor;

		if (!this.tracker.hasReading(cfg.holdTicks)) {
			return editing ? List.of(HudLine.of("Reach 3.00", color)) : List.of();
		}

		int decimals = Math.max(0, Math.min(4, cfg.decimals));
		return List.of(HudLine.of("Reach " + String.format("%." + decimals + "f", this.tracker.getLastReach()), color));
	}
}
