package dev.potatoclient.hud.modules;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudLine;
import dev.potatoclient.hud.TextHudModule;
import dev.potatoclient.tracker.CpsTracker;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

/** Clicks per second, counted separately for the left and right mouse buttons. */
public class CpsHud extends TextHudModule {
	private final CpsTracker left;
	private final CpsTracker right;

	public CpsHud(CpsTracker left, CpsTracker right) {
		this.left = left;
		this.right = right;
	}

	@Override
	public String id() {
		return "cps";
	}

	@Override
	public Text displayName() {
		return Text.literal("CPS");
	}

	@Override
	public HudElementConfig element() {
		return ConfigManager.get().hud.cps.element;
	}

	@Override
	protected List<HudLine> buildLines(boolean editing) {
		HudConfig.Cps cfg = ConfigManager.get().hud.cps;
		int color = element().textColor;

		if (cfg.inline) {
			StringBuilder sb = new StringBuilder();
			if (cfg.showLeft) {
				sb.append(this.left.getCps()).append(" L");
			}
			if (cfg.showRight) {
				if (sb.length() > 0) {
					sb.append(" | ");
				}
				sb.append(this.right.getCps()).append(" R");
			}
			if (sb.length() == 0) {
				return List.of();
			}
			sb.append(" CPS");
			return List.of(HudLine.of(sb.toString(), color));
		}

		List<HudLine> lines = new ArrayList<>(2);
		if (cfg.showLeft) {
			lines.add(HudLine.of(this.left.getCps() + " CPS (L)", color));
		}
		if (cfg.showRight) {
			lines.add(HudLine.of(this.right.getCps() + " CPS (R)", color));
		}
		return lines;
	}
}
