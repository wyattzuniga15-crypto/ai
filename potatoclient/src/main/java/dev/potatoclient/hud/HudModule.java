package dev.potatoclient.hud;

import dev.potatoclient.config.HudElementConfig;
import net.minecraft.client.MinecraftClient;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.text.Text;

/**
 * One draggable overlay element.
 *
 * <p>Subclasses lay themselves out in unscaled coordinates starting at the
 * origin and report that size through {@link #contentWidth()} and
 * {@link #contentHeight()}. This class applies the element's scale, position and
 * background, so the editor's drag box and the drawn pixels can never disagree.
 */
public abstract class HudModule {
	protected static final int PADDING = 2;

	protected final MinecraftClient client = MinecraftClient.getInstance();

	/** Stable key used in the config file and the editor. */
	public abstract String id();

	public abstract Text displayName();

	public abstract HudElementConfig element();

	/** Width before {@link HudElementConfig#scale} is applied. */
	public abstract int contentWidth();

	/** Height before {@link HudElementConfig#scale} is applied. */
	public abstract int contentHeight();

	/** Draws the element with its top-left at the origin, in unscaled coordinates. */
	protected abstract void renderContent(DrawContext context, RenderTickCounter tickCounter, boolean editing);

	/** Per-client-tick hook for modules that sample state on a tick boundary. */
	public void tick() {
	}

	/** Called when the player leaves a world so stale readings are not carried over. */
	public void reset() {
	}

	/**
	 * Whether the module has anything to show right now. The editor ignores this
	 * so an element can still be positioned while, say, no potion is active.
	 */
	public boolean hasContent() {
		return true;
	}

	public boolean isEnabled() {
		return element().enabled;
	}

	public final float scale() {
		return Math.max(0.25F, Math.min(4.0F, element().scale));
	}

	public final int width() {
		return Math.max(1, Math.round(contentWidth() * scale()));
	}

	public final int height() {
		return Math.max(1, Math.round(contentHeight() * scale()));
	}

	public final int screenX(int screenWidth) {
		return element().pixelX(screenWidth, width());
	}

	public final int screenY(int screenHeight) {
		return element().pixelY(screenHeight, height());
	}

	public final void render(DrawContext context, RenderTickCounter tickCounter, int x, int y, boolean editing) {
		HudElementConfig cfg = element();

		if (cfg.background) {
			context.fill(x - PADDING, y - PADDING, x + width() + PADDING, y + height() + PADDING, cfg.backgroundColor);
		}

		MatrixStack matrices = context.getMatrices();
		matrices.push();
		matrices.translate((float) x, (float) y, 0.0F);
		float scale = scale();
		matrices.scale(scale, scale, 1.0F);
		renderContent(context, tickCounter, editing);
		matrices.pop();
	}

	protected int lineHeight() {
		return this.client.textRenderer.fontHeight + 1;
	}
}
