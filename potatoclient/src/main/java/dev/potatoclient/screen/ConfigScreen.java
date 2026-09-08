package dev.potatoclient.screen;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.PotatoConfig;
import dev.potatoclient.config.RenderConfig;
import dev.potatoclient.potato.PotatoMode;
import dev.potatoclient.screen.widget.ActionRow;
import dev.potatoclient.screen.widget.BooleanRow;
import dev.potatoclient.screen.widget.ColorRow;
import dev.potatoclient.screen.widget.HeaderRow;
import dev.potatoclient.screen.widget.OptionRow;
import dev.potatoclient.screen.widget.SliderRow;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

/**
 * The settings screen: three tabs over one scrolling list of rows.
 *
 * <p>Rows are rebuilt whenever the tab changes so that they always read live
 * config values. That is also why Potato Mode's own row can flip eleven other
 * rows and have them redraw correctly on the next frame.
 */
public class ConfigScreen extends Screen {
	private static final int ROW_INSET = 24;
	private static final int LIST_TOP = 44;
	private static final int LIST_BOTTOM_MARGIN = 36;

	private enum Tab {
		HUD("potatoclient.category.hud"),
		RENDER("potatoclient.category.render"),
		POTATO("potatoclient.category.potato");

		final String translationKey;

		Tab(String translationKey) {
			this.translationKey = translationKey;
		}
	}

	private final Screen parent;
	private Tab tab = Tab.HUD;
	private List<OptionRow> rows = List.of();
	private int scroll;
	private OptionRow dragging;

	public ConfigScreen(Screen parent) {
		super(Text.translatable("potatoclient.screen.config"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		int tabWidth = 100;
		int totalWidth = tabWidth * Tab.values().length + 8;
		int x = this.width / 2 - totalWidth / 2;

		for (Tab value : Tab.values()) {
			ButtonWidget button = ButtonWidget.builder(Text.translatable(value.translationKey), b -> {
				this.tab = value;
				this.scroll = 0;
				clearAndInit();
			}).dimensions(x, 18, tabWidth, 20).build();
			button.active = value != this.tab;
			addDrawableChild(button);
			x += tabWidth + 4;
		}

		addDrawableChild(ButtonWidget.builder(Text.translatable("potatoclient.button.hud_editor"),
						b -> this.client.setScreen(new HudEditorScreen(this)))
				.dimensions(this.width / 2 - 155, this.height - 28, 150, 20)
				.build());
		addDrawableChild(ButtonWidget.builder(Text.translatable("potatoclient.button.done"), b -> close())
				.dimensions(this.width / 2 + 5, this.height - 28, 150, 20)
				.build());

		this.rows = buildRows();
	}

	@Override
	public void close() {
		ConfigManager.save();
		this.client.setScreen(this.parent);
	}

	@Override
	public boolean shouldPause() {
		return false;
	}

	private int listBottom() {
		return this.height - LIST_BOTTOM_MARGIN;
	}

	private int contentHeight() {
		return this.rows.size() * OptionRow.HEIGHT;
	}

	private int maxScroll() {
		return Math.max(0, contentHeight() - (listBottom() - LIST_TOP));
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float delta) {
		renderBackground(context, mouseX, mouseY, delta);

		context.drawCenteredTextWithShadow(this.textRenderer, this.title, this.width / 2, 6, 0xFFFFFFFF);

		int listWidth = this.width - ROW_INSET * 2;
		int left = ROW_INSET;

		context.fill(left - 4, LIST_TOP - 2, left + listWidth + 4, listBottom() + 2, 0x60000000);

		// Rows outside the viewport are skipped rather than clipped, which keeps
		// the draw cost flat no matter how long a tab gets.
		int firstVisible = Math.max(0, this.scroll / OptionRow.HEIGHT);
		int y = LIST_TOP - this.scroll + firstVisible * OptionRow.HEIGHT;

		OptionRow hovered = null;
		for (int i = firstVisible; i < this.rows.size() && y < listBottom(); i++) {
			OptionRow row = this.rows.get(i);
			if (y + OptionRow.HEIGHT > LIST_TOP) {
				row.render(context, left, y, listWidth, mouseX, mouseY);
				if (mouseY >= y && mouseY < y + OptionRow.HEIGHT && mouseX >= left && mouseX <= left + listWidth) {
					hovered = row;
				}
			}
			y += OptionRow.HEIGHT;
		}

		if (maxScroll() > 0) {
			drawScrollbar(context, left + listWidth + 6);
		}

		super.render(context, mouseX, mouseY, delta);

		if (hovered != null && hovered.tooltip() != null) {
			context.drawTooltip(this.textRenderer, Text.literal(hovered.tooltip()), mouseX, mouseY);
		}
	}

	private void drawScrollbar(DrawContext context, int x) {
		int viewport = listBottom() - LIST_TOP;
		int trackHeight = viewport;
		int thumbHeight = Math.max(16, trackHeight * viewport / Math.max(1, contentHeight()));
		int thumbY = LIST_TOP + (trackHeight - thumbHeight) * this.scroll / Math.max(1, maxScroll());

		context.fill(x, LIST_TOP, x + 4, listBottom(), 0x40FFFFFF);
		context.fill(x, thumbY, x + 4, thumbY + thumbHeight, 0xFFB0B0B0);
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button) {
		if (super.mouseClicked(mouseX, mouseY, button)) {
			return true;
		}
		if (mouseY < LIST_TOP || mouseY > listBottom()) {
			return false;
		}

		int left = ROW_INSET;
		int listWidth = this.width - ROW_INSET * 2;
		int index = (int) ((mouseY - LIST_TOP + this.scroll) / OptionRow.HEIGHT);
		if (index < 0 || index >= this.rows.size()) {
			return false;
		}

		OptionRow row = this.rows.get(index);
		int rowY = LIST_TOP - this.scroll + index * OptionRow.HEIGHT;
		if (row.click(mouseX, mouseY, button, left, rowY, listWidth)) {
			this.dragging = row;
			ConfigManager.markDirty();
			// No rebuild here: every row reads its value through a supplier bound
			// to the live config object, so Potato Mode flipping eleven other
			// flags shows up on the next frame. Rebuilding would also invalidate
			// the row this drag is bound to.
			return true;
		}
		return false;
	}

	@Override
	public boolean mouseDragged(double mouseX, double mouseY, int button, double deltaX, double deltaY) {
		if (this.dragging != null) {
			int left = ROW_INSET;
			int listWidth = this.width - ROW_INSET * 2;
			int index = this.rows.indexOf(this.dragging);
			int rowY = LIST_TOP - this.scroll + index * OptionRow.HEIGHT;
			if (this.dragging.drag(mouseX, left, rowY, listWidth)) {
				ConfigManager.markDirty();
				return true;
			}
		}
		return super.mouseDragged(mouseX, mouseY, button, deltaX, deltaY);
	}

	@Override
	public boolean mouseReleased(double mouseX, double mouseY, int button) {
		this.dragging = null;
		return super.mouseReleased(mouseX, mouseY, button);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
		this.scroll = Math.max(0, Math.min(maxScroll(), this.scroll - (int) (verticalAmount * OptionRow.HEIGHT)));
		return true;
	}

	private List<OptionRow> buildRows() {
		return switch (this.tab) {
			case HUD -> hudRows();
			case RENDER -> renderRows();
			case POTATO -> potatoRows();
		};
	}

	private List<OptionRow> hudRows() {
		HudConfig cfg = ConfigManager.get().hud;
		List<OptionRow> rows = new ArrayList<>();

		rows.add(new HeaderRow("General"));
		rows.add(new BooleanRow("HUD enabled", "Master switch for the whole overlay.",
				() -> cfg.enabled, v -> cfg.enabled = v));
		rows.add(new BooleanRow("Hide while a screen is open", "Hides the HUD in the inventory and other menus.",
				() -> cfg.hideInScreens, v -> cfg.hideInScreens = v));
		rows.add(new BooleanRow("Hide with the F3 screen", "Avoids overlapping the vanilla debug text.",
				() -> cfg.hideWithDebugScreen, v -> cfg.hideWithDebugScreen = v));
		rows.add(new ActionRow("Layout", "Drag modules into place.", "Open HUD editor",
				() -> this.client.setScreen(new HudEditorScreen(this))));

		rows.add(new HeaderRow("FPS"));
		rows.add(new BooleanRow("Enabled", null, () -> cfg.fps.element.enabled, v -> cfg.fps.element.enabled = v));
		rows.add(new BooleanRow("Show current", null, () -> cfg.fps.showCurrent, v -> cfg.fps.showCurrent = v));
		rows.add(new BooleanRow("Show rolling average", null, () -> cfg.fps.showAverage, v -> cfg.fps.showAverage = v));
		rows.add(new BooleanRow("Show 1% low", "Mean framerate of the slowest 1% of frames in the window.",
				() -> cfg.fps.showOnePercentLow, v -> cfg.fps.showOnePercentLow = v));
		rows.add(new BooleanRow("Colour code", null, () -> cfg.fps.colorCoded, v -> cfg.fps.colorCoded = v));
		rows.add(SliderRow.ofInt("Green above", "FPS at or above this reads green.", 30, 480,
				() -> cfg.fps.goodThreshold, v -> cfg.fps.goodThreshold = (int) v));
		rows.add(SliderRow.ofInt("Yellow above", "Below this the readout is red.", 10, 240,
				() -> cfg.fps.fairThreshold, v -> cfg.fps.fairThreshold = (int) v));
		rows.add(SliderRow.ofInt("History window", "Seconds of frame history behind the average and 1% low.", 1, 30,
				() -> cfg.fps.windowSeconds, v -> cfg.fps.windowSeconds = (int) v));
		rows.add(new SliderRow("Scale", null, 0.25D, 4.0D, 0.05D, 2, "x",
				() -> cfg.fps.element.scale, v -> cfg.fps.element.scale = (float) v));

		rows.add(new HeaderRow("Coordinates"));
		rows.add(new BooleanRow("Enabled", null, () -> cfg.coordinates.element.enabled, v -> cfg.coordinates.element.enabled = v));
		rows.add(new BooleanRow("XYZ", null, () -> cfg.coordinates.showXyz, v -> cfg.coordinates.showXyz = v));
		rows.add(new BooleanRow("Chunk relative", null, () -> cfg.coordinates.showChunkRelative, v -> cfg.coordinates.showChunkRelative = v));
		rows.add(new BooleanRow("Facing", null, () -> cfg.coordinates.showFacing, v -> cfg.coordinates.showFacing = v));
		rows.add(new BooleanRow("Biome", null, () -> cfg.coordinates.showBiome, v -> cfg.coordinates.showBiome = v));
		rows.add(SliderRow.ofInt("Decimals", null, 0, 4, () -> cfg.coordinates.decimals, v -> cfg.coordinates.decimals = (int) v));

		rows.add(new HeaderRow("Ping"));
		rows.add(new BooleanRow("Enabled", null, () -> cfg.ping.element.enabled, v -> cfg.ping.element.enabled = v));
		rows.add(new BooleanRow("Colour code", null, () -> cfg.ping.colorCoded, v -> cfg.ping.colorCoded = v));
		rows.add(SliderRow.ofInt("Sample interval", "Ticks between reads of the server's latency figure.", 1, 100,
				() -> cfg.ping.sampleIntervalTicks, v -> cfg.ping.sampleIntervalTicks = (int) v));

		rows.add(new HeaderRow("CPS"));
		rows.add(new BooleanRow("Enabled", null, () -> cfg.cps.element.enabled, v -> cfg.cps.element.enabled = v));
		rows.add(new BooleanRow("Left button", null, () -> cfg.cps.showLeft, v -> cfg.cps.showLeft = v));
		rows.add(new BooleanRow("Right button", null, () -> cfg.cps.showRight, v -> cfg.cps.showRight = v));
		rows.add(new BooleanRow("One line", null, () -> cfg.cps.inline, v -> cfg.cps.inline = v));

		rows.add(new HeaderRow("Keystrokes"));
		rows.add(new BooleanRow("Enabled", null, () -> cfg.keystrokes.element.enabled, v -> cfg.keystrokes.element.enabled = v));
		rows.add(new BooleanRow("Mouse buttons", null, () -> cfg.keystrokes.showMouseButtons, v -> cfg.keystrokes.showMouseButtons = v));
		rows.add(new BooleanRow("Space", null, () -> cfg.keystrokes.showSpace, v -> cfg.keystrokes.showSpace = v));
		rows.add(new BooleanRow("Sneak", null, () -> cfg.keystrokes.showSneak, v -> cfg.keystrokes.showSneak = v));
		rows.add(new BooleanRow("CPS on mouse keys", null, () -> cfg.keystrokes.showCps, v -> cfg.keystrokes.showCps = v));
		rows.add(new BooleanRow("Press animation", null, () -> cfg.keystrokes.pressAnimation, v -> cfg.keystrokes.pressAnimation = v));
		rows.add(SliderRow.ofInt("Animation length", "Milliseconds.", 20, 500,
				() -> cfg.keystrokes.animationMillis, v -> cfg.keystrokes.animationMillis = (int) v));
		rows.add(SliderRow.ofInt("Key size", null, 12, 40, () -> cfg.keystrokes.keySize, v -> cfg.keystrokes.keySize = (int) v));
		rows.add(new ColorRow("Pressed colour", null, () -> cfg.keystrokes.pressedBackground, v -> cfg.keystrokes.pressedBackground = v));

		rows.add(new HeaderRow("Armor"));
		rows.add(new BooleanRow("Enabled", null, () -> cfg.armor.element.enabled, v -> cfg.armor.element.enabled = v));
		rows.add(new BooleanRow("Show held item", null, () -> cfg.armor.showHeldItem, v -> cfg.armor.showHeldItem = v));
		rows.add(new BooleanRow("Durability numbers", null, () -> cfg.armor.showDurabilityNumbers, v -> cfg.armor.showDurabilityNumbers = v));
		rows.add(new BooleanRow("As percentage", null, () -> cfg.armor.percentage, v -> cfg.armor.percentage = v));
		rows.add(new BooleanRow("Vertical layout", null, () -> cfg.armor.vertical, v -> cfg.armor.vertical = v));
		rows.add(new BooleanRow("Colour by durability", null, () -> cfg.armor.colorByDurability, v -> cfg.armor.colorByDurability = v));

		rows.add(new HeaderRow("Potion effects"));
		rows.add(new BooleanRow("Enabled", null, () -> cfg.potions.element.enabled, v -> cfg.potions.element.enabled = v));
		rows.add(new BooleanRow("Icons", null, () -> cfg.potions.showIcons, v -> cfg.potions.showIcons = v));
		rows.add(new BooleanRow("Amplifier", null, () -> cfg.potions.showAmplifier, v -> cfg.potions.showAmplifier = v));
		rows.add(new BooleanRow("Hide ambient (beacon) effects", null, () -> cfg.potions.hideAmbient, v -> cfg.potions.hideAmbient = v));
		rows.add(SliderRow.ofInt("Icon size", null, 10, 32, () -> cfg.potions.iconSize, v -> cfg.potions.iconSize = (int) v));
		rows.add(SliderRow.ofInt("Warn below", "Seconds remaining at which the timer turns red.", 0, 60,
				() -> cfg.potions.warnSeconds, v -> cfg.potions.warnSeconds = (int) v));

		rows.add(new HeaderRow("Reach"));
		rows.add(new BooleanRow("Enabled", null, () -> cfg.reach.element.enabled, v -> cfg.reach.element.enabled = v));
		rows.add(new BooleanRow("Track right-click interactions", null, () -> cfg.reach.trackInteractions, v -> cfg.reach.trackInteractions = v));
		rows.add(SliderRow.ofInt("Decimals", null, 0, 4, () -> cfg.reach.decimals, v -> cfg.reach.decimals = (int) v));
		rows.add(SliderRow.ofInt("Hold time", "Ticks the last reading stays up. 0 keeps it forever.", 0, 200,
				() -> cfg.reach.holdTicks, v -> cfg.reach.holdTicks = (int) v));

		rows.add(new HeaderRow("Memory"));
		rows.add(new BooleanRow("Enabled", null, () -> cfg.memory.element.enabled, v -> cfg.memory.element.enabled = v));
		rows.add(new BooleanRow("Usage bar", null, () -> cfg.memory.showBar, v -> cfg.memory.showBar = v));
		rows.add(new BooleanRow("Percentage", null, () -> cfg.memory.showPercentage, v -> cfg.memory.showPercentage = v));

		return rows;
	}

	private List<OptionRow> renderRows() {
		RenderConfig cfg = ConfigManager.get().render;
		List<OptionRow> rows = new ArrayList<>();

		rows.add(new HeaderRow("Hitboxes"));
		rows.add(new BooleanRow("Enabled", "No F3+B needed.", () -> cfg.hitboxes.enabled, v -> cfg.hitboxes.enabled = v));
		rows.add(new SliderRow("Line thickness", null, 0.5D, 6.0D, 0.5D, 1, " px",
				() -> cfg.hitboxes.lineWidth, v -> cfg.hitboxes.lineWidth = (float) v));
		rows.add(new SliderRow("Opacity", null, 0.05D, 1.0D, 0.05D, 2, "",
				() -> cfg.hitboxes.opacity, v -> cfg.hitboxes.opacity = (float) v));
		rows.add(new SliderRow("Max distance", "Keeps mob farms from tanking the framerate.", 4.0D, 128.0D, 1.0D, 0, " m",
				() -> cfg.hitboxes.maxDistance, v -> cfg.hitboxes.maxDistance = v));
		rows.add(SliderRow.ofInt("Max boxes per frame", null, 32, 4096,
				() -> cfg.hitboxes.maxBoxesPerFrame, v -> cfg.hitboxes.maxBoxesPerFrame = (int) v));
		rows.add(new BooleanRow("Eye line", "Draws each entity's look vector.", () -> cfg.hitboxes.eyeLine, v -> cfg.hitboxes.eyeLine = v));
		rows.add(new SliderRow("Eye line length", null, 0.5D, 16.0D, 0.5D, 1, " m",
				() -> cfg.hitboxes.eyeLineLength, v -> cfg.hitboxes.eyeLineLength = v));
		rows.add(new BooleanRow("Show attack expansion", "The 0.1 block box vanilla actually tests a hit against.",
				() -> cfg.hitboxes.showAttackExpansion, v -> cfg.hitboxes.showAttackExpansion = v));
		rows.add(new SliderRow("Expansion size", null, 0.01D, 0.5D, 0.01D, 2, " m",
				() -> cfg.hitboxes.attackExpansion, v -> cfg.hitboxes.attackExpansion = v));
		rows.add(new BooleanRow("Only the targeted entity", null, () -> cfg.hitboxes.onlyTargeted, v -> cfg.hitboxes.onlyTargeted = v));
		rows.add(new BooleanRow("Respect invisibility", null, () -> cfg.hitboxes.respectInvisibility, v -> cfg.hitboxes.respectInvisibility = v));
		rows.add(new ColorRow("Hostile", null, () -> cfg.hitboxes.hostileColor, v -> cfg.hitboxes.hostileColor = v));
		rows.add(new ColorRow("Passive", null, () -> cfg.hitboxes.passiveColor, v -> cfg.hitboxes.passiveColor = v));
		rows.add(new ColorRow("Players", null, () -> cfg.hitboxes.playerColor, v -> cfg.hitboxes.playerColor = v));
		rows.add(new ColorRow("Items", null, () -> cfg.hitboxes.itemColor, v -> cfg.hitboxes.itemColor = v));
		rows.add(new ColorRow("Other", null, () -> cfg.hitboxes.otherColor, v -> cfg.hitboxes.otherColor = v));
		rows.add(new ColorRow("Expansion box", null, () -> cfg.hitboxes.expansionColor, v -> cfg.hitboxes.expansionColor = v));

		rows.add(new HeaderRow("Chunk borders"));
		rows.add(new BooleanRow("Enabled", "Same lines as F3+G, on their own key.",
				() -> cfg.chunkBorders.enabled, v -> cfg.chunkBorders.enabled = v));

		rows.add(new HeaderRow("Block outline"));
		rows.add(new BooleanRow("Customise", "Replaces the vanilla outline.", () -> cfg.blockOutline.customize, v -> cfg.blockOutline.customize = v));
		rows.add(new SliderRow("Thickness", null, 0.5D, 6.0D, 0.5D, 1, " px",
				() -> cfg.blockOutline.lineWidth, v -> cfg.blockOutline.lineWidth = (float) v));
		rows.add(new ColorRow("Colour", null, () -> cfg.blockOutline.color, v -> cfg.blockOutline.color = v));
		rows.add(new BooleanRow("Glow", "Adds a wider, dimmer pass underneath.", () -> cfg.blockOutline.glow, v -> cfg.blockOutline.glow = v));
		rows.add(new SliderRow("Glow opacity", null, 0.05D, 1.0D, 0.05D, 2, "",
				() -> cfg.blockOutline.glowOpacity, v -> cfg.blockOutline.glowOpacity = (float) v));

		rows.add(new HeaderRow("Item and XP highlighting"));
		rows.add(new BooleanRow("Dropped items", null, () -> cfg.esp.items, v -> cfg.esp.items = v));
		rows.add(new BooleanRow("Experience orbs", null, () -> cfg.esp.experienceOrbs, v -> cfg.esp.experienceOrbs = v));
		rows.add(new BooleanRow("Through walls", "Off by default.", () -> cfg.esp.throughWalls, v -> cfg.esp.throughWalls = v));
		rows.add(new SliderRow("Max distance", null, 4.0D, 128.0D, 1.0D, 0, " m",
				() -> cfg.esp.maxDistance, v -> cfg.esp.maxDistance = v));
		rows.add(new ColorRow("Item colour", null, () -> cfg.esp.itemColor, v -> cfg.esp.itemColor = v));
		rows.add(new ColorRow("Orb colour", null, () -> cfg.esp.orbColor, v -> cfg.esp.orbColor = v));

		rows.add(new HeaderRow("Fullbright"));
		rows.add(new BooleanRow("Enabled", "Overrides gamma. Not a night-vision effect.",
				() -> cfg.fullbright.enabled, v -> cfg.fullbright.enabled = v));
		rows.add(new SliderRow("Gamma", null, 1.0D, 30.0D, 0.5D, 1, "",
				() -> cfg.fullbright.gamma, v -> cfg.fullbright.gamma = v));

		return rows;
	}

	private List<OptionRow> potatoRows() {
		PotatoConfig cfg = ConfigManager.get().potato;
		List<OptionRow> rows = new ArrayList<>();

		rows.add(new HeaderRow("Master switch"));
		rows.add(new BooleanRow("Potato Mode",
				"Turns every option below on at once. Turning it off restores what they were before.",
				PotatoMode::isEngaged, PotatoMode::set));

		rows.add(new HeaderRow("Individual toggles"));
		rows.add(new BooleanRow("Disable particles", null, () -> cfg.disableParticles, v -> cfg.disableParticles = v));
		rows.add(SliderRow.ofInt("Particle cap", "Used when particles are not disabled outright. -1 is no cap.", -1, 4000,
				() -> cfg.particleCap, v -> cfg.particleCap = (int) v));
		rows.add(new BooleanRow("Disable weather", "Rain and snow, plus their splash particles.",
				() -> cfg.disableWeather, v -> cfg.disableWeather = v));
		rows.add(new BooleanRow("Disable clouds", null, () -> cfg.disableClouds, v -> cfg.disableClouds = v));
		rows.add(new BooleanRow("Remove fog", "Distance fog and the water and lava dimming.",
				() -> cfg.disableFog, v -> cfg.disableFog = v));
		rows.add(new BooleanRow("Disable sky", "Sky dome, stars, sun and moon.", () -> cfg.disableSky, v -> cfg.disableSky = v));
		rows.add(new BooleanRow("Disable entity shadows", null, () -> cfg.disableEntityShadows, v -> cfg.disableEntityShadows = v));
		rows.add(new BooleanRow("Freeze animated textures", "Water, lava, fire and portals stop animating.",
				() -> cfg.freezeAnimatedTextures, v -> cfg.freezeAnimatedTextures = v));
		rows.add(new BooleanRow("Disable enchantment glint", null, () -> cfg.disableGlint, v -> cfg.disableGlint = v));

		rows.add(new HeaderRow("Distance limits"));
		rows.add(new BooleanRow("Limit decoration distance", "Item frames, armour stands, paintings and displays.",
				() -> cfg.limitDecorationDistance, v -> cfg.limitDecorationDistance = v));
		rows.add(new SliderRow("Decoration distance", null, 4.0D, 128.0D, 1.0D, 0, " m",
				() -> cfg.decorationDistance, v -> cfg.decorationDistance = v));
		rows.add(new BooleanRow("Limit block entity distance", "Chests, signs, banners and the like.",
				() -> cfg.limitBlockEntityDistance, v -> cfg.limitBlockEntityDistance = v));
		rows.add(new SliderRow("Block entity distance", null, 4.0D, 128.0D, 1.0D, 0, " m",
				() -> cfg.blockEntityDistance, v -> cfg.blockEntityDistance = v));

		rows.add(new HeaderRow("Entity culling"));
		rows.add(new BooleanRow("Aggressive entity culling", "Skips entities outside the frustum.",
				() -> cfg.aggressiveEntityCulling, v -> cfg.aggressiveEntityCulling = v));
		rows.add(new BooleanRow("Occlusion culling", "Also skips entities fully behind solid blocks.",
				() -> cfg.occlusionCulling, v -> cfg.occlusionCulling = v));
		rows.add(new SliderRow("Never cull nearer than", null, 0.0D, 32.0D, 1.0D, 0, " m",
				() -> cfg.occlusionMinDistance, v -> cfg.occlusionMinDistance = v));
		rows.add(SliderRow.ofInt("Occlusion cache", "Ticks a visibility result is reused.", 1, 20,
				() -> cfg.occlusionCacheTicks, v -> cfg.occlusionCacheTicks = (int) v));

		return rows;
	}
}
