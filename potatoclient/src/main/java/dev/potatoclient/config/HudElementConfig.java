package dev.potatoclient.config;

/**
 * Position and styling shared by every HUD module.
 *
 * <p>The position is stored as a fraction of the <em>scaled</em> window so a HUD
 * laid out at 1080p still looks right at 1440p and at a different GUI scale.
 * The fraction addresses the element's top-left corner; {@link #clamp} keeps the
 * whole box on screen after a resize.
 */
public class HudElementConfig {
	public boolean enabled;
	/** Fraction of the scaled window width, addressing the element's left edge. */
	public float x;
	/** Fraction of the scaled window height, addressing the element's top edge. */
	public float y;
	/** Font/icon scale multiplier. */
	public float scale = 1.0F;
	/** Draw a translucent plate behind the element. */
	public boolean background = true;
	/** ARGB colour of that plate. */
	public int backgroundColor = 0x60000000;
	/** Drop shadow on text. */
	public boolean textShadow = true;
	/** ARGB colour used for text that is not otherwise colour-coded. */
	public int textColor = 0xFFFFFFFF;

	public HudElementConfig() {
	}

	public HudElementConfig(boolean enabled, float x, float y) {
		this.enabled = enabled;
		this.x = x;
		this.y = y;
	}

	public int pixelX(int screenWidth, int elementWidth) {
		return clamp(Math.round(this.x * screenWidth), screenWidth, elementWidth);
	}

	public int pixelY(int screenHeight, int elementHeight) {
		return clamp(Math.round(this.y * screenHeight), screenHeight, elementHeight);
	}

	private static int clamp(int value, int screenSize, int elementSize) {
		int max = Math.max(0, screenSize - elementSize);
		return Math.max(0, Math.min(value, max));
	}

	/** Stores a pixel position back as a fraction, clamping the box on screen. */
	public void setPixelPosition(int px, int py, int screenWidth, int screenHeight, int elementWidth, int elementHeight) {
		int cx = clamp(px, screenWidth, elementWidth);
		int cy = clamp(py, screenHeight, elementHeight);
		this.x = screenWidth <= 0 ? 0.0F : (float) cx / screenWidth;
		this.y = screenHeight <= 0 ? 0.0F : (float) cy / screenHeight;
	}
}
