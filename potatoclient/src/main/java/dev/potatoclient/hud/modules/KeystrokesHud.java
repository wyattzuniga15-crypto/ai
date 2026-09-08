package dev.potatoclient.hud.modules;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudModule;
import dev.potatoclient.tracker.CpsTracker;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.option.GameOptions;
import net.minecraft.client.option.KeyBinding;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.text.Text;


/**
 * WASD, jump, sneak and the mouse buttons, with a press animation.
 *
 * <p>Keys are read from the player's actual bindings, so a rebound layout still
 * lights up the right box, and the labels follow the binding rather than being
 * hard-coded to WASD.
 */
public class KeystrokesHud extends HudModule {
	private static final int ROWS = 3;
	private static final int COLUMNS = 3;

	private final CpsTracker leftCps;
	private final CpsTracker rightCps;

	/** Wall-clock time each key last went down, for the press animation. */
	private final java.util.Map<String, Long> pressStart = new java.util.HashMap<>();
	private final java.util.Set<String> heldLastFrame = new java.util.HashSet<>();

	public KeystrokesHud(CpsTracker leftCps, CpsTracker rightCps) {
		this.leftCps = leftCps;
		this.rightCps = rightCps;
	}

	@Override
	public String id() {
		return "keystrokes";
	}

	@Override
	public Text displayName() {
		return Text.literal("Keystrokes");
	}

	@Override
	public HudElementConfig element() {
		return ConfigManager.get().hud.keystrokes.element;
	}

	private HudConfig.Keystrokes cfg() {
		return ConfigManager.get().hud.keystrokes;
	}

	private int keySize() {
		return Math.max(8, cfg().keySize);
	}

	private int gap() {
		return Math.max(0, cfg().keyGap);
	}

	@Override
	public int contentWidth() {
		return COLUMNS * keySize() + (COLUMNS - 1) * gap();
	}

	@Override
	public int contentHeight() {
		HudConfig.Keystrokes cfg = cfg();
		int rows = ROWS;
		if (cfg.showMouseButtons) {
			rows++;
		}
		if (cfg.showSpace) {
			rows++;
		}
		int height = rows * keySize() + (rows - 1) * gap();
		if (cfg.showSneak) {
			// The sneak bar is half height so it does not dwarf the letter keys.
			height += gap() + keySize() / 2;
		}
		return height;
	}

	@Override
	public void reset() {
		this.pressStart.clear();
		this.heldLastFrame.clear();
	}

	@Override
	protected void renderContent(DrawContext context, RenderTickCounter tickCounter, boolean editing) {
		HudConfig.Keystrokes cfg = cfg();
		GameOptions options = this.client.options;
		if (options == null) {
			return;
		}

		int size = keySize();
		int gap = gap();
		int step = size + gap;
		int fullWidth = contentWidth();
		int y = 0;

		// Row 1: forward, centred.
		drawKey(context, cfg, step, 0, size, size, label(options.forwardKey, "W"), pressed(options.forwardKey, editing), "forward");
		y += step;

		// Row 2: left, back, right.
		drawKey(context, cfg, 0, y, size, size, label(options.leftKey, "A"), pressed(options.leftKey, editing), "left");
		drawKey(context, cfg, step, y, size, size, label(options.backKey, "S"), pressed(options.backKey, editing), "back");
		drawKey(context, cfg, step * 2, y, size, size, label(options.rightKey, "D"), pressed(options.rightKey, editing), "right");
		y += step;

		if (cfg.showMouseButtons) {
			int half = (fullWidth - gap) / 2;
			String leftLabel = cfg.showCps ? this.leftCps.getCps() + " CPS" : "LMB";
			String rightLabel = cfg.showCps ? this.rightCps.getCps() + " CPS" : "RMB";
			drawKey(context, cfg, 0, y, half, size, leftLabel, pressed(options.attackKey, editing), "attack");
			drawKey(context, cfg, half + gap, y, fullWidth - half - gap, size, rightLabel, pressed(options.useKey, editing), "use");
			y += step;
		}

		if (cfg.showSpace) {
			drawKey(context, cfg, 0, y, fullWidth, size, label(options.jumpKey, "SPACE"), pressed(options.jumpKey, editing), "jump");
			y += step;
		}

		if (cfg.showSneak) {
			int height = size / 2;
			drawKey(context, cfg, 0, y, fullWidth, height, label(options.sneakKey, "SHIFT"), pressed(options.sneakKey, editing), "sneak");
		}
	}

	/**
	 * Press animation: the box eases from the idle colour to the pressed colour
	 * over {@code animationMillis} and holds there while the key stays down.
	 */
	private void drawKey(DrawContext context, HudConfig.Keystrokes cfg,
			int x, int y, int width, int height, String label, boolean down, String key) {
		float progress = animationProgress(cfg, key, down);

		int background = lerpColor(cfg.idleBackground, cfg.pressedBackground, progress);
		int textColor = lerpColor(cfg.idleText, cfg.pressedText, progress);

		context.fill(x, y, x + width, y + height, background);

		int textWidth = this.client.textRenderer.getWidth(label);
		int textX = x + (width - textWidth) / 2;
		int textY = y + (height - this.client.textRenderer.fontHeight) / 2 + 1;
		context.drawText(this.client.textRenderer, label, textX, textY, textColor, element().textShadow);
	}

	private float animationProgress(HudConfig.Keystrokes cfg, String key, boolean down) {
		if (!cfg.pressAnimation) {
			return down ? 1.0F : 0.0F;
		}

		long now = System.currentTimeMillis();
		boolean wasHeld = this.heldLastFrame.contains(key);

		if (down && !wasHeld) {
			this.pressStart.put(key, now);
			this.heldLastFrame.add(key);
		} else if (!down && wasHeld) {
			this.pressStart.put(key, now);
			this.heldLastFrame.remove(key);
		}

		long start = this.pressStart.getOrDefault(key, 0L);
		float duration = Math.max(1, cfg.animationMillis);
		float t = Math.max(0.0F, Math.min(1.0F, (now - start) / duration));
		return down ? t : 1.0F - t;
	}

	private boolean pressed(KeyBinding binding, boolean editing) {
		if (editing) {
			return false;
		}
		return binding.isPressed();
	}

	/** Uses the bound key's own label, falling back to the vanilla letter. */
	private static String label(KeyBinding binding, String fallback) {
		String bound = binding.getBoundKeyLocalizedText().getString();
		if (bound == null || bound.isEmpty()) {
			return fallback;
		}
		return bound.length() <= 5 ? bound.toUpperCase(java.util.Locale.ROOT) : fallback;
	}

	private static int lerpColor(int from, int to, float t) {
		float clamped = Math.max(0.0F, Math.min(1.0F, t));
		int a = lerpChannel(from >>> 24, to >>> 24, clamped);
		int r = lerpChannel((from >> 16) & 0xFF, (to >> 16) & 0xFF, clamped);
		int g = lerpChannel((from >> 8) & 0xFF, (to >> 8) & 0xFF, clamped);
		int b = lerpChannel(from & 0xFF, to & 0xFF, clamped);
		return (a << 24) | (r << 16) | (g << 8) | b;
	}

	private static int lerpChannel(int from, int to, float t) {
		return Math.round(from + (to - from) * t) & 0xFF;
	}

}
