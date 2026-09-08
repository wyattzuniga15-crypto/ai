package dev.potatoclient.config;

/** Rendering and debug-visualisation settings. */
public class RenderConfig {
	public Hitboxes hitboxes = new Hitboxes();
	public ChunkBorders chunkBorders = new ChunkBorders();
	public BlockOutline blockOutline = new BlockOutline();
	public Esp esp = new Esp();
	public Fullbright fullbright = new Fullbright();

	public static class Hitboxes {
		public boolean enabled = false;
		/** Line width in pixels, passed to the line render state. */
		public float lineWidth = 2.0F;
		/** 0..1 opacity applied to every hitbox line. */
		public float opacity = 0.85F;
		/** Beyond this many blocks a hitbox is skipped entirely. Keeps mob farms usable. */
		public double maxDistance = 32.0D;
		/** Hard ceiling on how many boxes may be drawn in one frame. */
		public int maxBoxesPerFrame = 512;
		/** Draw the entity's look vector as a ray from its eyes. */
		public boolean eyeLine = false;
		/** Length of that ray in blocks. */
		public double eyeLineLength = 2.0D;
		/** Draw the extra box showing the 0.1-block attack collision expansion. */
		public boolean showAttackExpansion = false;
		/** Size of that expansion. Vanilla picks entities against a box grown by this. */
		public double attackExpansion = 0.1D;
		/** ARGB colour of the expansion box. */
		public int expansionColor = 0x80FFFFFF;
		/** Skip entities the player cannot see (invisible mobs, spectators). */
		public boolean respectInvisibility = true;
		/** Only draw the box for the entity under the crosshair. */
		public boolean onlyTargeted = false;

		public int hostileColor = 0xFFFF4040;
		public int passiveColor = 0xFF40FF40;
		public int playerColor = 0xFF4080FF;
		public int itemColor = 0xFFFFFF40;
		public int otherColor = 0xFFC0C0C0;
	}

	public static class ChunkBorders {
		/** Driven by the keybind; mirrors the vanilla F3+G renderer without the debug screen. */
		public boolean enabled = false;
	}

	public static class BlockOutline {
		/** Take over the vanilla block outline so thickness, colour and glow apply. */
		public boolean customize = false;
		public float lineWidth = 2.0F;
		public int color = 0xFF000000;
		/** Draw the outline through terrain so it is visible against a busy background. */
		public boolean glow = false;
		/** Opacity of the extra pass used for the glow. */
		public float glowOpacity = 0.35F;
	}

	public static class Esp {
		public boolean items = false;
		public boolean experienceOrbs = false;
		/** Draw the boxes through walls. Off by default. */
		public boolean throughWalls = false;
		public double maxDistance = 48.0D;
		public float lineWidth = 1.5F;
		public int itemColor = 0xFFFFFF40;
		public int orbColor = 0xFF40FFC0;
	}

	public static class Fullbright {
		/** Overrides the gamma option; this is not a night-vision effect. */
		public boolean enabled = false;
		/** Gamma written while fullbright is on. Vanilla's slider stops at 1.0. */
		public double gamma = 15.0D;
	}
}
