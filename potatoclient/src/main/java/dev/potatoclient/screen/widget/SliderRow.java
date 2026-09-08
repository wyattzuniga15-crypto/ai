package dev.potatoclient.screen.widget;

import net.minecraft.client.gui.DrawContext;

import java.util.function.DoubleConsumer;
import java.util.function.DoubleSupplier;

/**
 * A numeric row backed by a drag-anywhere slider.
 *
 * <p>Values are stored as doubles and rounded to {@code step} on the way out, so
 * one class covers integer counts, distances and 0-1 fractions.
 */
public class SliderRow extends OptionRow {
	private final DoubleSupplier getter;
	private final DoubleConsumer setter;
	private final double min;
	private final double max;
	private final double step;
	private final String suffix;
	private final int decimals;

	public SliderRow(String label, String tooltip, double min, double max, double step, int decimals, String suffix,
			DoubleSupplier getter, DoubleConsumer setter) {
		super(label, tooltip);
		this.min = min;
		this.max = max;
		this.step = step;
		this.decimals = decimals;
		this.suffix = suffix == null ? "" : suffix;
		this.getter = getter;
		this.setter = setter;
	}

	public static SliderRow ofInt(String label, String tooltip, int min, int max, DoubleSupplier getter, DoubleConsumer setter) {
		return new SliderRow(label, tooltip, min, max, 1.0D, 0, "", getter, setter);
	}

	@Override
	protected void renderControl(DrawContext context, int controlX, int y, int mouseX, int mouseY) {
		double value = clamp(this.getter.getAsDouble());
		double fraction = this.max == this.min ? 0.0D : (value - this.min) / (this.max - this.min);

		context.fill(controlX, y + 1, controlX + CONTROL_WIDTH, y + HEIGHT - 1, 0xFF3A3A3A);
		int filled = (int) Math.round(CONTROL_WIDTH * fraction);
		if (filled > 0) {
			context.fill(controlX, y + 1, controlX + filled, y + HEIGHT - 1, 0xFF3F6FA8);
		}

		String text = format(value) + this.suffix;
		int textX = controlX + (CONTROL_WIDTH - this.client.textRenderer.getWidth(text)) / 2;
		context.drawText(this.client.textRenderer, text, textX,
				y + (HEIGHT - this.client.textRenderer.fontHeight) / 2, 0xFFFFFFFF, false);
	}

	private String format(double value) {
		if (this.decimals <= 0) {
			return Long.toString(Math.round(value));
		}
		return String.format("%." + this.decimals + "f", value);
	}

	@Override
	public boolean click(double mouseX, double mouseY, int button, int x, int y, int width) {
		if (!overControl(mouseX, mouseY, x, y, width)) {
			return false;
		}
		applyFromMouse(mouseX, x, width);
		return true;
	}

	@Override
	public boolean drag(double mouseX, int x, int y, int width) {
		applyFromMouse(mouseX, x, width);
		return true;
	}

	private void applyFromMouse(double mouseX, int x, int width) {
		int controlX = controlX(x, width);
		double fraction = Math.max(0.0D, Math.min(1.0D, (mouseX - controlX) / CONTROL_WIDTH));
		double raw = this.min + fraction * (this.max - this.min);
		// Round to the step so the stored value is exactly what the label shows.
		double stepped = this.step <= 0.0D ? raw : Math.round(raw / this.step) * this.step;
		this.setter.accept(clamp(stepped));
	}

	private double clamp(double value) {
		return Math.max(this.min, Math.min(this.max, value));
	}
}
