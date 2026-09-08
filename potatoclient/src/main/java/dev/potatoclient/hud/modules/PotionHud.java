package dev.potatoclient.hud.modules;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudModule;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.client.texture.Sprite;
import net.minecraft.entity.effect.StatusEffect;
import net.minecraft.entity.effect.StatusEffectInstance;
import net.minecraft.registry.entry.RegistryEntry;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

/**
 * Active potion effects with the time left, soonest to expire first.
 *
 * <p>Infinite effects sort last: they never become urgent, so they should not
 * push a beacon effect about to lapse off the top of the list.
 */
public class PotionHud extends HudModule {
	private static final int ROW_GAP = 2;
	private static final int TEXT_GAP = 4;
	private static final int TICKS_PER_SECOND = 20;

	@Override
	public String id() {
		return "potions";
	}

	@Override
	public Text displayName() {
		return Text.literal("Potion effects");
	}

	@Override
	public HudElementConfig element() {
		return ConfigManager.get().hud.potions.element;
	}

	private int iconSize() {
		return Math.max(8, ConfigManager.get().hud.potions.iconSize);
	}

	private List<StatusEffectInstance> effects() {
		HudConfig.Potions cfg = ConfigManager.get().hud.potions;
		ClientPlayerEntity player = this.client.player;
		if (player == null) {
			return List.of();
		}

		List<StatusEffectInstance> list = new ArrayList<>(player.getStatusEffects());
		if (cfg.hideAmbient) {
			list.removeIf(StatusEffectInstance::isAmbient);
		}

		list.sort(Comparator
				.comparingInt((StatusEffectInstance e) -> e.isInfinite() ? 1 : 0)
				.thenComparingInt(StatusEffectInstance::getDuration));
		return list;
	}

	@Override
	public boolean hasContent() {
		return !effects().isEmpty();
	}

	@Override
	public int contentWidth() {
		List<StatusEffectInstance> effects = effects();
		if (effects.isEmpty()) {
			return this.client.textRenderer.getWidth("Speed II  0:30") + iconSize() + TEXT_GAP;
		}

		int widest = 0;
		for (StatusEffectInstance effect : effects) {
			widest = Math.max(widest, this.client.textRenderer.getWidth(label(effect)));
		}
		boolean icons = ConfigManager.get().hud.potions.showIcons;
		return widest + (icons ? iconSize() + TEXT_GAP : 0);
	}

	@Override
	public int contentHeight() {
		int rows = Math.max(1, effects().size());
		int rowHeight = Math.max(iconSize(), this.client.textRenderer.fontHeight);
		return rows * rowHeight + (rows - 1) * ROW_GAP;
	}

	@Override
	protected void renderContent(DrawContext context, RenderTickCounter tickCounter, boolean editing) {
		HudConfig.Potions cfg = ConfigManager.get().hud.potions;
		List<StatusEffectInstance> effects = effects();

		if (effects.isEmpty()) {
			if (editing) {
				context.drawText(this.client.textRenderer, "Speed II  0:30", 0, 0, element().textColor, element().textShadow);
			}
			return;
		}

		int size = iconSize();
		int rowHeight = Math.max(size, this.client.textRenderer.fontHeight);
		int y = 0;

		for (StatusEffectInstance effect : effects) {
			int textX = 0;

			if (cfg.showIcons) {
				Sprite sprite = this.client.getStatusEffectSpriteManager().getSprite(effect.getEffectType());
				context.drawSpriteStretched(RenderLayer::getGuiTextured, sprite, 0, y, size, size);
				textX = size + TEXT_GAP;
			}

			int textY = y + (rowHeight - this.client.textRenderer.fontHeight) / 2;
			context.drawText(this.client.textRenderer, label(effect), textX, textY, colorFor(effect, cfg), element().textShadow);

			y += rowHeight + ROW_GAP;
		}
	}

	private String label(StatusEffectInstance effect) {
		HudConfig.Potions cfg = ConfigManager.get().hud.potions;
		RegistryEntry<StatusEffect> type = effect.getEffectType();

		StringBuilder sb = new StringBuilder(Text.translatable(type.value().getTranslationKey()).getString());
		if (cfg.showAmplifier && effect.getAmplifier() > 0) {
			sb.append(' ').append(roman(effect.getAmplifier() + 1));
		}
		sb.append("  ").append(durationText(effect));
		return sb.toString();
	}

	private static String durationText(StatusEffectInstance effect) {
		if (effect.isInfinite()) {
			return "**:**";
		}
		int totalSeconds = effect.getDuration() / TICKS_PER_SECOND;
		int minutes = totalSeconds / 60;
		int seconds = totalSeconds % 60;
		return String.format("%d:%02d", minutes, seconds);
	}

	private int colorFor(StatusEffectInstance effect, HudConfig.Potions cfg) {
		if (!effect.isInfinite() && effect.getDuration() / TICKS_PER_SECOND <= cfg.warnSeconds) {
			return 0xFFFF5555;
		}
		return element().textColor;
	}

	/** Amplifiers above VIII are vanishingly rare, so the table stops there. */
	private static String roman(int level) {
		return switch (level) {
			case 1 -> "I";
			case 2 -> "II";
			case 3 -> "III";
			case 4 -> "IV";
			case 5 -> "V";
			case 6 -> "VI";
			case 7 -> "VII";
			case 8 -> "VIII";
			default -> Integer.toString(level);
		};
	}
}
