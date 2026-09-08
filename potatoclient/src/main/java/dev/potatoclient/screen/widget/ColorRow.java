package dev.potatoclient.screen.widget;

import net.minecraft.client.gui.DrawContext;
import org.lwjgl.glfw.GLFW;

import java.util.function.Consumer;
import java.util.function.IntSupplier;

/**
 * A colour row with a swatch.
 *
 * <p>Left-click walks a fixed palette, right-click steps the alpha. A full
 * colour picker would be a screen of its own; the config file takes an exact
 * ARGB integer for anyone who wants one.
 */
public class ColorRow extends OptionRow {
	private static final int[] PALETTE = {
			0xFFFFFF, 0xFF4040, 0xFF9040, 0xFFFF40, 0x40FF40, 0x40FFC0,
			0x40C0FF, 0x4080FF, 0xC040FF, 0xFF40C0, 0x808080, 0x000000,
	};
	private static final int[] ALPHAS = {0x40, 0x80, 0xC0, 0xFF};

	private final IntSupplier getter;
	private final Consumer<Integer> setter;

	public ColorRow(String label, String tooltip, IntSupplier getter, Consumer<Integer> setter) {
		super(label, tooltip);
		this.getter = getter;
		this.setter = setter;
	}

	@Override
	protected void renderControl(DrawContext context, int controlX, int y, int mouseX, int mouseY) {
		int color = this.getter.getAsInt();

		context.fill(controlX, y + 1, controlX + CONTROL_WIDTH, y + HEIGHT - 1, 0xFF2A2A2A);
		// Checkerboard behind the swatch so a low alpha is visible as such.
		drawChecker(context, controlX + 2, y + 3, 28, HEIGHT - 6);
		context.fill(controlX + 2, y + 3, controlX + 30, y + HEIGHT - 3, color);

		String text = String.format("#%08X", color);
		context.drawText(this.client.textRenderer, text, controlX + 36,
				y + (HEIGHT - this.client.textRenderer.fontHeight) / 2, 0xFFFFFFFF, false);
	}

	private static void drawChecker(DrawContext context, int x, int y, int width, int height) {
		int cell = 4;
		for (int row = 0; row * cell < height; row++) {
			for (int col = 0; col * cell < width; col++) {
				int shade = ((row + col) & 1) == 0 ? 0xFF909090 : 0xFF505050;
				int x0 = x + col * cell;
				int y0 = y + row * cell;
				context.fill(x0, y0, Math.min(x0 + cell, x + width), Math.min(y0 + cell, y + height), shade);
			}
		}
	}

	@Override
	public boolean click(double mouseX, double mouseY, int button, int x, int y, int width) {
		if (!overControl(mouseX, mouseY, x, y, width)) {
			return false;
		}

		int color = this.getter.getAsInt();
		int alpha = (color >>> 24) & 0xFF;
		int rgb = color & 0xFFFFFF;

		if (button == GLFW.GLFW_MOUSE_BUTTON_RIGHT) {
			this.setter.accept((nextAlpha(alpha) << 24) | rgb);
		} else {
			this.setter.accept((alpha << 24) | nextRgb(rgb));
		}
		return true;
	}

	private static int nextRgb(int rgb) {
		for (int i = 0; i < PALETTE.length; i++) {
			if (PALETTE[i] == rgb) {
				return PALETTE[(i + 1) % PALETTE.length];
			}
		}
		return PALETTE[0];
	}

	private static int nextAlpha(int alpha) {
		for (int i = 0; i < ALPHAS.length; i++) {
			if (ALPHAS[i] == alpha) {
				return ALPHAS[(i + 1) % ALPHAS.length];
			}
		}
		return ALPHAS[ALPHAS.length - 1];
	}
}
