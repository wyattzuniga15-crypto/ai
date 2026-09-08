package dev.potatoclient.config;

/** Per-module HUD settings. Every module owns an {@link HudElementConfig}. */
public class HudConfig {
	/** Master switch for the whole overlay; individual modules keep their own state. */
	public boolean enabled = true;
	/** Hide the overlay while a screen (inventory, chat, …) is open. */
	public boolean hideInScreens = false;
	/** Hide the overlay while the vanilla F3 debug screen is up, to avoid overlap. */
	public boolean hideWithDebugScreen = true;

	public Fps fps = new Fps();
	public Coordinates coordinates = new Coordinates();
	public Ping ping = new Ping();
	public Cps cps = new Cps();
	public Keystrokes keystrokes = new Keystrokes();
	public Armor armor = new Armor();
	public Potions potions = new Potions();
	public Reach reach = new Reach();
	public Memory memory = new Memory();

	public static class Fps {
		public HudElementConfig element = new HudElementConfig(true, 0.006F, 0.006F);
		public boolean showCurrent = true;
		public boolean showAverage = true;
		public boolean showOnePercentLow = true;
		public boolean colorCoded = true;
		/** At or above this many FPS the readout is green. */
		public int goodThreshold = 120;
		/** At or above this many FPS the readout is yellow; below it, red. */
		public int fairThreshold = 60;
		/** Seconds of history used for the average and the 1% low. */
		public int windowSeconds = 10;
		public int goodColor = 0xFF55FF55;
		public int fairColor = 0xFFFFFF55;
		public int badColor = 0xFFFF5555;
	}

	public static class Coordinates {
		public HudElementConfig element = new HudElementConfig(true, 0.006F, 0.055F);
		public boolean showXyz = true;
		public boolean showChunkRelative = true;
		public boolean showFacing = true;
		public boolean showBiome = true;
		public int decimals = 1;
	}

	public static class Ping {
		public HudElementConfig element = new HudElementConfig(true, 0.006F, 0.155F);
		/** Ticks between samples; the server only refreshes latency every second or so. */
		public int sampleIntervalTicks = 10;
		public boolean colorCoded = true;
		/** At or below this many ms the readout is green. */
		public int goodThreshold = 60;
		/** At or below this many ms the readout is yellow; above it, red. */
		public int fairThreshold = 150;
	}

	public static class Cps {
		public HudElementConfig element = new HudElementConfig(false, 0.006F, 0.195F);
		public boolean showLeft = true;
		public boolean showRight = true;
		/** Put left and right on one line instead of two. */
		public boolean inline = true;
	}

	public static class Keystrokes {
		public HudElementConfig element = new HudElementConfig(false, 0.006F, 0.62F);
		public boolean showMouseButtons = true;
		public boolean showSpace = true;
		public boolean showSneak = true;
		public boolean showCps = false;
		/** Fade/shrink animation when a key goes down. */
		public boolean pressAnimation = true;
		/** Length of the press animation in milliseconds. */
		public int animationMillis = 120;
		public int keySize = 20;
		public int keyGap = 2;
		public int idleBackground = 0x60000000;
		public int pressedBackground = 0xC0FFFFFF;
		public int idleText = 0xFFFFFFFF;
		public int pressedText = 0xFF000000;
	}

	public static class Armor {
		public HudElementConfig element = new HudElementConfig(false, 0.42F, 0.86F);
		public boolean showHeldItem = true;
		public boolean showDurabilityNumbers = true;
		/** Show remaining durability as a percentage instead of a raw count. */
		public boolean percentage = false;
		public boolean vertical = false;
		/** Tint the number by remaining durability. */
		public boolean colorByDurability = true;
		/** Skip slots holding items that cannot take damage. */
		public boolean hideUndamageable = false;
	}

	public static class Potions {
		public HudElementConfig element = new HudElementConfig(false, 0.88F, 0.06F);
		public boolean showIcons = true;
		public boolean showAmplifier = true;
		public boolean hideAmbient = false;
		public int iconSize = 18;
		/** Below this many seconds remaining the timer turns red. */
		public int warnSeconds = 10;
	}

	public static class Reach {
		public HudElementConfig element = new HudElementConfig(false, 0.006F, 0.235F);
		public int decimals = 2;
		/** How long the last measurement stays on screen, in ticks. 0 keeps it forever. */
		public int holdTicks = 60;
		/** Also measure reach on right-click interactions. */
		public boolean trackInteractions = false;
	}

	public static class Memory {
		public HudElementConfig element = new HudElementConfig(false, 0.006F, 0.275F);
		public boolean showBar = true;
		public boolean showPercentage = true;
	}
}
