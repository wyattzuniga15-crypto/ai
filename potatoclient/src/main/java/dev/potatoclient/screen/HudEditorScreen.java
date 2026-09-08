package dev.potatoclient.screen;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudManager;
import dev.potatoclient.hud.HudModule;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.gui.screen.Screen;
import net.minecraft.client.gui.widget.ButtonWidget;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.text.Text;
import org.lwjgl.glfw.GLFW;

import java.util.ArrayList;
import java.util.List;

/**
 * Drag-and-drop layout for the HUD.
 *
 * <p>Every module is drawn, including disabled ones, so a module can be
 * positioned before it is switched on. Dragging snaps to the screen edges, the
 * screen centre lines and the edges of the other modules, which is what keeps a
 * hand-placed HUD looking aligned.
 */
public class HudEditorScreen extends Screen {
	/** Distance in scaled pixels within which a drag snaps to a guide. */
	private static final int SNAP_DISTANCE = 6;

	private final Screen parent;

	private HudModule dragging;
	private int dragOffsetX;
	private int dragOffsetY;
	private final List<Integer> activeGuidesX = new ArrayList<>();
	private final List<Integer> activeGuidesY = new ArrayList<>();

	public HudEditorScreen(Screen parent) {
		super(Text.translatable("potatoclient.screen.hud_editor"));
		this.parent = parent;
	}

	@Override
	protected void init() {
		HudManager.setEditing(true);

		addDrawableChild(ButtonWidget.builder(Text.translatable("potatoclient.button.reset"), button -> resetPositions())
				.dimensions(this.width / 2 - 105, this.height - 28, 100, 20)
				.build());
		addDrawableChild(ButtonWidget.builder(Text.translatable("potatoclient.button.done"), button -> close())
				.dimensions(this.width / 2 + 5, this.height - 28, 100, 20)
				.build());
	}

	@Override
	public void close() {
		HudManager.setEditing(false);
		ConfigManager.save();
		this.client.setScreen(this.parent);
	}

	@Override
	public void removed() {
		HudManager.setEditing(false);
		ConfigManager.save();
	}

	@Override
	public boolean shouldPause() {
		return false;
	}

	@Override
	public void render(DrawContext context, int mouseX, int mouseY, float delta) {
		renderBackground(context, mouseX, mouseY, delta);

		if (this.dragging != null) {
			moveDragged(mouseX, mouseY);
		}

		RenderTickCounter tickCounter = this.client.getRenderTickCounter();

		for (HudModule module : HudManager.modules()) {
			int x = module.screenX(this.width);
			int y = module.screenY(this.height);
			int w = module.width();
			int h = module.height();

			module.render(context, tickCounter, x, y, true);

			boolean hovered = isOver(module, mouseX, mouseY);
			int border = !module.isEnabled() ? 0xFF808080 : (module == this.dragging || hovered ? 0xFF55FF55 : 0xFF3070FF);
			drawBorder(context, x - 2, y - 2, w + 4, h + 4, border);

			if (!module.isEnabled()) {
				// A disabled module is still positionable, so it is shown greyed rather than hidden.
				context.fill(x - 2, y - 2, x + w + 2, y + h + 2, 0x50000000);
			}

			if (hovered && this.dragging == null) {
				context.drawTextWithShadow(this.textRenderer, module.displayName(), x - 2, y - 14, 0xFFFFFFFF);
			}
		}

		drawGuides(context);

		context.drawCenteredTextWithShadow(this.textRenderer,
				Text.translatable("potatoclient.hint.editor"), this.width / 2, 8, 0xFFFFFFFF);

		super.render(context, mouseX, mouseY, delta);
	}

	private void drawGuides(DrawContext context) {
		for (int x : this.activeGuidesX) {
			context.fill(x, 0, x + 1, this.height, 0x80FFFF55);
		}
		for (int y : this.activeGuidesY) {
			context.fill(0, y, this.width, y + 1, 0x80FFFF55);
		}
	}

	private static void drawBorder(DrawContext context, int x, int y, int width, int height, int color) {
		context.fill(x, y, x + width, y + 1, color);
		context.fill(x, y + height - 1, x + width, y + height, color);
		context.fill(x, y, x + 1, y + height, color);
		context.fill(x + width - 1, y, x + width, y + height, color);
	}

	@Override
	public boolean mouseClicked(double mouseX, double mouseY, int button) {
		if (super.mouseClicked(mouseX, mouseY, button)) {
			return true;
		}

		HudModule hit = moduleAt((int) mouseX, (int) mouseY);
		if (hit == null) {
			return false;
		}

		if (button == GLFW.GLFW_MOUSE_BUTTON_RIGHT) {
			hit.element().enabled = !hit.element().enabled;
			ConfigManager.markDirty();
			return true;
		}

		if (button == GLFW.GLFW_MOUSE_BUTTON_LEFT) {
			this.dragging = hit;
			this.dragOffsetX = (int) mouseX - hit.screenX(this.width);
			this.dragOffsetY = (int) mouseY - hit.screenY(this.height);
			return true;
		}

		return false;
	}

	@Override
	public boolean mouseReleased(double mouseX, double mouseY, int button) {
		if (this.dragging != null && button == GLFW.GLFW_MOUSE_BUTTON_LEFT) {
			this.dragging = null;
			this.activeGuidesX.clear();
			this.activeGuidesY.clear();
			ConfigManager.markDirty();
			return true;
		}
		return super.mouseReleased(mouseX, mouseY, button);
	}

	@Override
	public boolean mouseScrolled(double mouseX, double mouseY, double horizontalAmount, double verticalAmount) {
		HudModule hit = this.dragging != null ? this.dragging : moduleAt((int) mouseX, (int) mouseY);
		if (hit == null) {
			return super.mouseScrolled(mouseX, mouseY, horizontalAmount, verticalAmount);
		}

		HudElementConfig cfg = hit.element();
		cfg.scale = Math.max(0.25F, Math.min(4.0F, cfg.scale + (float) verticalAmount * 0.1F));
		ConfigManager.markDirty();
		return true;
	}

	@Override
	public boolean keyPressed(int keyCode, int scanCode, int modifiers) {
		if (keyCode == GLFW.GLFW_KEY_R) {
			resetPositions();
			return true;
		}
		return super.keyPressed(keyCode, scanCode, modifiers);
	}

	private void moveDragged(int mouseX, int mouseY) {
		HudModule module = this.dragging;
		int targetX = mouseX - this.dragOffsetX;
		int targetY = mouseY - this.dragOffsetY;

		this.activeGuidesX.clear();
		this.activeGuidesY.clear();

		int width = module.width();
		int height = module.height();

		targetX = snap(targetX, width, this.width, guidesX(module), this.activeGuidesX);
		targetY = snap(targetY, height, this.height, guidesY(module), this.activeGuidesY);

		module.element().setPixelPosition(targetX, targetY, this.width, this.height, width, height);
		ConfigManager.markDirty();
	}

	/**
	 * Snaps one axis to the nearest guide.
	 *
	 * <p>Both the element's leading and trailing edge are tested against every
	 * guide, so a box can align by either side, and the guide that won is
	 * recorded so the editor can draw the line the user snapped to.
	 */
	private static int snap(int position, int size, int screenSize, List<Integer> guides, List<Integer> hitGuides) {
		int bestPosition = position;
		int bestGuide = 0;
		int bestDistance = SNAP_DISTANCE + 1;

		for (int guide : guides) {
			int leading = Math.abs(guide - position);
			if (leading < bestDistance) {
				bestDistance = leading;
				bestPosition = guide;
				bestGuide = guide;
			}
			int trailing = Math.abs(guide - (position + size));
			if (trailing < bestDistance) {
				bestDistance = trailing;
				bestPosition = guide - size;
				bestGuide = guide;
			}
		}

		if (bestDistance > SNAP_DISTANCE) {
			return position;
		}

		hitGuides.add(bestGuide);
		return Math.max(0, Math.min(bestPosition, screenSize - size));
	}

	private List<Integer> guidesX(HudModule moving) {
		List<Integer> guides = new ArrayList<>();
		guides.add(0);
		guides.add(this.width / 2);
		guides.add(this.width);
		for (HudModule other : HudManager.modules()) {
			if (other == moving) {
				continue;
			}
			int x = other.screenX(this.width);
			guides.add(x);
			guides.add(x + other.width());
		}
		return guides;
	}

	private List<Integer> guidesY(HudModule moving) {
		List<Integer> guides = new ArrayList<>();
		guides.add(0);
		guides.add(this.height / 2);
		guides.add(this.height);
		for (HudModule other : HudManager.modules()) {
			if (other == moving) {
				continue;
			}
			int y = other.screenY(this.height);
			guides.add(y);
			guides.add(y + other.height());
		}
		return guides;
	}

	private HudModule moduleAt(int mouseX, int mouseY) {
		// Walk backwards so the module drawn last, and therefore on top, wins.
		List<HudModule> modules = HudManager.modules();
		for (int i = modules.size() - 1; i >= 0; i--) {
			HudModule module = modules.get(i);
			if (isOver(module, mouseX, mouseY)) {
				return module;
			}
		}
		return null;
	}

	private boolean isOver(HudModule module, int mouseX, int mouseY) {
		int x = module.screenX(this.width);
		int y = module.screenY(this.height);
		return mouseX >= x - 2 && mouseX <= x + module.width() + 2
				&& mouseY >= y - 2 && mouseY <= y + module.height() + 2;
	}

	private void resetPositions() {
		ConfigManager.get().hud = new dev.potatoclient.config.HudConfig();
		ConfigManager.save();
	}
}
