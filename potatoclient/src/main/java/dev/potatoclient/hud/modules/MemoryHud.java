package dev.potatoclient.hud.modules;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudModule;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.text.Text;

/** Heap in use against heap allocated, with an optional usage bar. */
public class MemoryHud extends HudModule {
	private static final int BAR_HEIGHT = 4;
	private static final long MEGABYTE = 1024L * 1024L;

	/** Sampling the runtime every frame is cheap but pointless; refresh twice a second. */
	private static final long SAMPLE_INTERVAL_MILLIS = 500L;

	private long lastSampleMillis;
	private long usedBytes;
	private long allocatedBytes;
	private long maxBytes;

	@Override
	public String id() {
		return "memory";
	}

	@Override
	public Text displayName() {
		return Text.literal("Memory");
	}

	@Override
	public HudElementConfig element() {
		return ConfigManager.get().hud.memory.element;
	}

	private void sample() {
		long now = System.currentTimeMillis();
		if (now - this.lastSampleMillis < SAMPLE_INTERVAL_MILLIS && this.allocatedBytes != 0L) {
			return;
		}
		this.lastSampleMillis = now;

		Runtime runtime = Runtime.getRuntime();
		this.allocatedBytes = runtime.totalMemory();
		this.maxBytes = runtime.maxMemory();
		this.usedBytes = this.allocatedBytes - runtime.freeMemory();
	}

	private String text() {
		sample();
		HudConfig.Memory cfg = ConfigManager.get().hud.memory;
		StringBuilder sb = new StringBuilder();
		if (cfg.showPercentage) {
			sb.append(Math.round(usedFraction() * 100.0F)).append("% ");
		}
		sb.append(this.usedBytes / MEGABYTE).append('/').append(this.allocatedBytes / MEGABYTE).append(" MB");
		return sb.toString();
	}

	private float usedFraction() {
		long denominator = this.allocatedBytes > 0L ? this.allocatedBytes : this.maxBytes;
		if (denominator <= 0L) {
			return 0.0F;
		}
		return Math.max(0.0F, Math.min(1.0F, (float) this.usedBytes / denominator));
	}

	@Override
	public int contentWidth() {
		return Math.max(60, this.client.textRenderer.getWidth(text()));
	}

	@Override
	public int contentHeight() {
		boolean bar = ConfigManager.get().hud.memory.showBar;
		return this.client.textRenderer.fontHeight + (bar ? BAR_HEIGHT + 2 : 0);
	}

	@Override
	protected void renderContent(DrawContext context, RenderTickCounter tickCounter, boolean editing) {
		HudConfig.Memory cfg = ConfigManager.get().hud.memory;
		String text = text();
		float fraction = usedFraction();

		context.drawText(this.client.textRenderer, text, 0, 0, colorFor(fraction), element().textShadow);

		if (cfg.showBar) {
			int width = contentWidth();
			int top = this.client.textRenderer.fontHeight + 2;
			context.fill(0, top, width, top + BAR_HEIGHT, 0x80000000);
			int filled = Math.round(width * fraction);
			if (filled > 0) {
				context.fill(0, top, filled, top + BAR_HEIGHT, colorFor(fraction));
			}
		}
	}

	private int colorFor(float fraction) {
		if (fraction >= 0.9F) {
			return 0xFFFF5555;
		}
		return fraction >= 0.75F ? 0xFFFFFF55 : 0xFF55FF55;
	}

}
