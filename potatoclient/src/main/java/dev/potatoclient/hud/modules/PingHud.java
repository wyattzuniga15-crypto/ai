package dev.potatoclient.hud.modules;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudLine;
import dev.potatoclient.hud.TextHudModule;
import net.minecraft.client.network.ClientPlayNetworkHandler;
import net.minecraft.client.network.PlayerListEntry;
import net.minecraft.text.Text;

import java.util.List;

/**
 * Round-trip latency to the current server.
 *
 * <p>The value is the one the server publishes in the player list, so it is only
 * as fresh as the server's own keep-alive cycle; sampling it faster than
 * {@code sampleIntervalTicks} would just re-read the same number.
 */
public class PingHud extends TextHudModule {
	private int lastPing = -1;
	private int ticksSinceSample;

	@Override
	public String id() {
		return "ping";
	}

	@Override
	public Text displayName() {
		return Text.literal("Ping");
	}

	@Override
	public HudElementConfig element() {
		return ConfigManager.get().hud.ping.element;
	}

	@Override
	public void tick() {
		HudConfig.Ping cfg = ConfigManager.get().hud.ping;
		if (++this.ticksSinceSample < Math.max(1, cfg.sampleIntervalTicks)) {
			return;
		}
		this.ticksSinceSample = 0;

		ClientPlayNetworkHandler handler = this.client.getNetworkHandler();
		if (handler == null || this.client.player == null) {
			this.lastPing = -1;
			return;
		}

		PlayerListEntry entry = handler.getPlayerListEntry(this.client.player.getUuid());
		this.lastPing = entry == null ? -1 : entry.getLatency();
	}

	@Override
	public void reset() {
		this.lastPing = -1;
		this.ticksSinceSample = 0;
	}

	@Override
	protected List<HudLine> buildLines(boolean editing) {
		HudConfig.Ping cfg = ConfigManager.get().hud.ping;

		if (this.lastPing < 0) {
			// Singleplayer has no meaningful latency; show a placeholder only in the editor.
			return editing ? List.of(HudLine.of("0 ms", cfg.colorCoded ? 0xFF55FF55 : element().textColor)) : List.of();
		}

		return List.of(HudLine.of(this.lastPing + " ms", colorFor(this.lastPing, cfg)));
	}

	private int colorFor(int ping, HudConfig.Ping cfg) {
		if (!cfg.colorCoded) {
			return element().textColor;
		}
		if (ping <= cfg.goodThreshold) {
			return 0xFF55FF55;
		}
		return ping <= cfg.fairThreshold ? 0xFFFFFF55 : 0xFFFF5555;
	}
}
