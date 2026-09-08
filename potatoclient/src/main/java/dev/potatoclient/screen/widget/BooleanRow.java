package dev.potatoclient.screen.widget;

import net.minecraft.client.gui.DrawContext;

import java.util.function.BooleanSupplier;
import java.util.function.Consumer;

/** An on/off row. */
public class BooleanRow extends OptionRow {
	private final BooleanSupplier getter;
	private final Consumer<Boolean> setter;

	public BooleanRow(String label, String tooltip, BooleanSupplier getter, Consumer<Boolean> setter) {
		super(label, tooltip);
		this.getter = getter;
		this.setter = setter;
	}

	@Override
	protected void renderControl(DrawContext context, int controlX, int y, int mouseX, int mouseY) {
		boolean value = this.getter.getAsBoolean();
		int background = value ? 0xFF2E7D32 : 0xFF5A5A5A;
		context.fill(controlX, y + 1, controlX + CONTROL_WIDTH, y + HEIGHT - 1, background);

		String text = value ? "ON" : "OFF";
		int textX = controlX + (CONTROL_WIDTH - this.client.textRenderer.getWidth(text)) / 2;
		context.drawText(this.client.textRenderer, text, textX,
				y + (HEIGHT - this.client.textRenderer.fontHeight) / 2, 0xFFFFFFFF, false);
	}

	@Override
	public boolean click(double mouseX, double mouseY, int button, int x, int y, int width) {
		if (!overControl(mouseX, mouseY, x, y, width)) {
			return false;
		}
		this.setter.accept(!this.getter.getAsBoolean());
		return true;
	}
}
