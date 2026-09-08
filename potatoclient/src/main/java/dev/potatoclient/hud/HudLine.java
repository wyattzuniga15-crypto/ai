package dev.potatoclient.hud;

/** A single line of HUD text with its own colour. */
public record HudLine(String text, int color) {
	public static HudLine of(String text, int color) {
		return new HudLine(text, color);
	}
}
