package dev.potatoclient.screen.widget;

import net.minecraft.client.gui.DrawContext;

/** A row whose control is a plain button. */
public class ActionRow extends OptionRow {
	private final String buttonText;
	private final Runnable action;

	public ActionRow(String label, String tooltip, String buttonText, Runnable action) {
		super(label, tooltip);
		this.buttonText = buttonText;
		this.action = action;
	}

	@Override
	protected void renderControl(DrawContext context, int controlX, int y, int mouseX, int mouseY) {
		boolean hovered = mouseX >= controlX && mouseX <= controlX + CONTROL_WIDTH
				&& mouseY >= y + 1 && mouseY <= y + HEIGHT - 1;
		context.fill(controlX, y + 1, controlX + CONTROL_WIDTH, y + HEIGHT - 1, hovered ? 0xFF5A5A5A : 0xFF3A3A3A);

		int textX = controlX + (CONTROL_WIDTH - this.client.textRenderer.getWidth(this.buttonText)) / 2;
		context.drawText(this.client.textRenderer, this.buttonText, textX,
				y + (HEIGHT - this.client.textRenderer.fontHeight) / 2, 0xFFFFFFFF, false);
	}

	@Override
	public boolean click(double mouseX, double mouseY, int button, int x, int y, int width) {
		if (!overControl(mouseX, mouseY, x, y, width)) {
			return false;
		}
		this.action.run();
		return true;
	}
}
