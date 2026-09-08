package dev.potatoclient.screen.widget;

import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;

/**
 * One line in the settings list.
 *
 * <p>Rows draw and hit-test themselves against a rectangle the screen supplies,
 * rather than being {@code ClickableWidget}s with their own coordinates. That is
 * what lets the list scroll by simply passing a different {@code y} each frame,
 * with no widget repositioning to keep in sync.
 */
public abstract class OptionRow {
	public static final int HEIGHT = 22;
	/** Width reserved on the right for the control itself. */
	protected static final int CONTROL_WIDTH = 130;

	protected final MinecraftClient client = MinecraftClient.getInstance();
	private final String label;
	private final String tooltip;

	protected OptionRow(String label, String tooltip) {
		this.label = label;
		this.tooltip = tooltip;
	}

	public String label() {
		return this.label;
	}

	public String tooltip() {
		return this.tooltip;
	}

	/** Rows that are headings take a click without doing anything. */
	public boolean selectable() {
		return true;
	}

	public void render(DrawContext context, int x, int y, int width, int mouseX, int mouseY) {
		context.drawText(this.client.textRenderer, this.label, x, y + (HEIGHT - this.client.textRenderer.fontHeight) / 2,
				0xFFFFFFFF, false);
		renderControl(context, controlX(x, width), y, mouseX, mouseY);
	}

	protected abstract void renderControl(DrawContext context, int controlX, int y, int mouseX, int mouseY);

	public boolean click(double mouseX, double mouseY, int button, int x, int y, int width) {
		return false;
	}

	public boolean drag(double mouseX, int x, int y, int width) {
		return false;
	}

	protected static int controlX(int x, int width) {
		return x + width - CONTROL_WIDTH;
	}

	protected boolean overControl(double mouseX, double mouseY, int x, int y, int width) {
		int cx = controlX(x, width);
		return mouseX >= cx && mouseX <= cx + CONTROL_WIDTH && mouseY >= y + 1 && mouseY <= y + HEIGHT - 1;
	}
}
