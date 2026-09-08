package dev.potatoclient.hud.modules;

import dev.potatoclient.config.ConfigManager;
import dev.potatoclient.config.HudConfig;
import dev.potatoclient.config.HudElementConfig;
import dev.potatoclient.hud.HudModule;
import net.minecraft.client.gui.DrawContext;
import net.minecraft.client.network.ClientPlayerEntity;
import net.minecraft.client.render.RenderTickCounter;
import net.minecraft.item.ItemStack;
import net.minecraft.text.Text;

import java.util.ArrayList;
import java.util.List;

/** Worn armour (and optionally the held item) with remaining durability. */
public class ArmorHud extends HudModule {
	private static final int SLOT = 16;
	private static final int SPACING = 4;
	/** Room under each icon for the durability number. */
	private static final int LABEL_HEIGHT = 10;

	@Override
	public String id() {
		return "armor";
	}

	@Override
	public Text displayName() {
		return Text.literal("Armor");
	}

	@Override
	public HudElementConfig element() {
		return ConfigManager.get().hud.armor.element;
	}

	/** Helmet first, then chestplate, leggings, boots, then optionally the held item. */
	private List<ItemStack> stacks(boolean editing) {
		HudConfig.Armor cfg = ConfigManager.get().hud.armor;
		ClientPlayerEntity player = this.client.player;
		List<ItemStack> result = new ArrayList<>(5);

		if (player == null) {
			// Opened from the main menu: there is no inventory to read, so the
			// editor gets empty slots to drag rather than invented items.
			return result;
		}

		// PlayerInventory indexes armour boots-first; reverse it so the HUD reads top-down.
		for (int slot = 3; slot >= 0; slot--) {
			ItemStack stack = player.getInventory().getArmorStack(slot);
			if (stack.isEmpty() || (cfg.hideUndamageable && !stack.isDamageable())) {
				continue;
			}
			result.add(stack);
		}

		if (cfg.showHeldItem) {
			ItemStack held = player.getMainHandStack();
			if (!held.isEmpty() && !(cfg.hideUndamageable && !held.isDamageable())) {
				result.add(held);
			}
		}

		return result;
	}

	@Override
	public boolean hasContent() {
		return !stacks(false).isEmpty();
	}

	/** Slots shown in the editor when there is nothing equipped, so the box has a size. */
	private int slotCount(boolean editing) {
		int actual = stacks(editing).size();
		return actual > 0 ? actual : (editing ? 4 : 0);
	}

	@Override
	public int contentWidth() {
		HudConfig.Armor cfg = ConfigManager.get().hud.armor;
		int count = Math.max(1, slotCount(true));
		if (cfg.vertical) {
			return SLOT + (cfg.showDurabilityNumbers ? 4 + widestLabel() : 0);
		}
		return count * SLOT + (count - 1) * SPACING;
	}

	@Override
	public int contentHeight() {
		HudConfig.Armor cfg = ConfigManager.get().hud.armor;
		int count = Math.max(1, slotCount(true));
		if (cfg.vertical) {
			return count * SLOT + (count - 1) * SPACING;
		}
		return SLOT + (cfg.showDurabilityNumbers ? LABEL_HEIGHT : 0);
	}

	private int widestLabel() {
		int max = 0;
		for (ItemStack stack : stacks(true)) {
			max = Math.max(max, this.client.textRenderer.getWidth(durabilityLabel(stack)));
		}
		return max;
	}

	@Override
	protected void renderContent(DrawContext context, RenderTickCounter tickCounter, boolean editing) {
		HudConfig.Armor cfg = ConfigManager.get().hud.armor;
		List<ItemStack> stacks = stacks(editing);

		if (stacks.isEmpty() && editing) {
			drawEmptySlots(context, cfg);
			return;
		}

		int x = 0;
		int y = 0;
		for (ItemStack stack : stacks) {
			// drawItem paints the sprite plus the vanilla damage bar.
			context.drawItem(stack, x, y);
			context.drawItemBar(stack, x, y);

			if (cfg.showDurabilityNumbers && stack.isDamageable()) {
				String label = durabilityLabel(stack);
				int color = cfg.colorByDurability ? durabilityColor(stack) : element().textColor;
				if (cfg.vertical) {
					int textY = y + (SLOT - this.client.textRenderer.fontHeight) / 2;
					context.drawText(this.client.textRenderer, label, x + SLOT + 4, textY, color, element().textShadow);
				} else {
					int textX = x + (SLOT - this.client.textRenderer.getWidth(label)) / 2;
					context.drawText(this.client.textRenderer, label, textX, y + SLOT + 1, color, element().textShadow);
				}
			}

			if (cfg.vertical) {
				y += SLOT + SPACING;
			} else {
				x += SLOT + SPACING;
			}
		}
	}

	private void drawEmptySlots(DrawContext context, HudConfig.Armor cfg) {
		for (int i = 0; i < 4; i++) {
			int x = cfg.vertical ? 0 : i * (SLOT + SPACING);
			int y = cfg.vertical ? i * (SLOT + SPACING) : 0;
			context.fill(x, y, x + SLOT, y + SLOT, 0x40FFFFFF);
		}
	}

	private String durabilityLabel(ItemStack stack) {
		if (!stack.isDamageable()) {
			return "";
		}
		int remaining = stack.getMaxDamage() - stack.getDamage();
		if (ConfigManager.get().hud.armor.percentage) {
			int max = Math.max(1, stack.getMaxDamage());
			return Math.round(remaining * 100.0F / max) + "%";
		}
		return Integer.toString(remaining);
	}

	private static int durabilityColor(ItemStack stack) {
		int max = Math.max(1, stack.getMaxDamage());
		float fraction = (float) (max - stack.getDamage()) / max;
		if (fraction > 0.5F) {
			return 0xFF55FF55;
		}
		return fraction > 0.2F ? 0xFFFFFF55 : 0xFFFF5555;
	}
}
