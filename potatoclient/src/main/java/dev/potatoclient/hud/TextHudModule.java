package dev.potatoclient.hud;

import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.RenderTickCounter;

import java.util.List;

/** Base for the modules that are just a stack of coloured text lines. */
public abstract class TextHudModule extends HudModule {
	/** Rebuilt every frame; cached between the layout and render passes of one frame. */
	private List<HudLine> cachedLines = List.of();
	private long cachedFrame = -1L;

	/** The lines to draw this frame, top to bottom. */
	protected abstract List<HudLine> buildLines(boolean editing);

	protected final List<HudLine> lines(boolean editing) {
		long frame = HudManager.frameCounter();
		if (frame != this.cachedFrame) {
			this.cachedFrame = frame;
			this.cachedLines = buildLines(editing);
		}
		return this.cachedLines;
	}

	@Override
	public int contentWidth() {
		int max = 0;
		for (HudLine line : lines(HudManager.isEditing())) {
			max = Math.max(max, this.client.textRenderer.getWidth(line.text()));
		}
		return Math.max(1, max);
	}

	@Override
	public int contentHeight() {
		int count = lines(HudManager.isEditing()).size();
		return Math.max(1, count * lineHeight() - 1);
	}

	@Override
	public boolean hasContent() {
		return !lines(HudManager.isEditing()).isEmpty();
	}

	@Override
	protected void renderContent(DrawContext context, RenderTickCounter tickCounter, boolean editing) {
		boolean shadow = element().textShadow;
		int y = 0;
		for (HudLine line : lines(editing)) {
			context.drawText(this.client.textRenderer, line.text(), 0, y, line.color(), shadow);
			y += lineHeight();
		}
	}
}
