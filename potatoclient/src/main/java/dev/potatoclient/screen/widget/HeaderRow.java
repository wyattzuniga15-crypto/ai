package dev.potatoclient.screen.widget;

import net.minecraft.client.gui.DrawContext;

/** A non-interactive section heading. */
public class HeaderRow extends OptionRow {
	public HeaderRow(String label) {
		super(label, null);
	}

	@Override
	public boolean selectable() {
		return false;
	}

	@Override
	public void render(DrawContext context, int x, int y, int width, int mouseX, int mouseY) {
		int textY = y + (HEIGHT - this.client.textRenderer.fontHeight) / 2;
		context.drawText(this.client.textRenderer, label(), x, textY, 0xFFFFD070, false);
		int lineY = y + HEIGHT - 3;
		context.fill(x, lineY, x + width, lineY + 1, 0x40FFFFFF);
	}

	@Override
	protected void renderControl(DrawContext context, int controlX, int y, int mouseX, int mouseY) {
	}
}
