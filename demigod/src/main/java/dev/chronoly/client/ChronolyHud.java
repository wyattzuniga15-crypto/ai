package dev.chronoly.client;

import net.minecraft.client.DeltaTracker;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiGraphics;
import net.minecraft.network.chat.Component;

/**
 * A small, quiet HUD: what you are, what you have left, and what it cost you.
 *
 * <p>Deliberately text and bars rather than art — it is legible, it does not fight the vanilla
 * hotbar, and it is honest about being a first pass.
 */
public final class ChronolyHud {

    private ChronolyHud() {}

    private static final int ENERGY_FULL = 0xFF4FC3F7;
    private static final int ENERGY_EMPTY = 0xFF16323F;
    private static final int DEBT = 0xFF8E5A9E;
    private static final int FAVOUR = 0xFFE8C46A;

    public static void render(GuiGraphics graphics, DeltaTracker delta) {
        Minecraft mc = Minecraft.getInstance();
        if (mc.player == null || mc.options.hideGui || !ClientState.claimed()) return;

        int x = 8;
        int y = graphics.guiHeight() - 62;

        String name = ClientState.parentage();
        graphics.drawString(mc.font,
                Component.literal("§7Child of §f" + Character.toUpperCase(name.charAt(0)) + name.substring(1)),
                x, y, 0xFFFFFF, true);

        // Divine energy, with overdraw drawn as debt eating into the bar from the right.
        int w = 90, h = 5;
        int barY = y + 12;
        float frac = Math.max(0f, Math.min(1f, ClientState.energy() / ClientState.maxEnergy()));
        graphics.fill(x, barY, x + w, barY + h, ENERGY_EMPTY);
        graphics.fill(x, barY, x + (int) (w * frac), barY + h, ENERGY_FULL);

        float debtFrac = Math.max(0f, Math.min(1f, ClientState.overdraw() / ClientState.maxEnergy()));
        if (debtFrac > 0f) {
            graphics.fill(x + w - (int) (w * debtFrac), barY, x + w, barY + h, DEBT);
        }
        graphics.drawString(mc.font,
                Component.literal(String.format("§b%.0f§7/%.0f", ClientState.energy(), ClientState.maxEnergy())),
                x + w + 6, barY - 2, 0xFFFFFF, true);

        // Favour.
        int favY = barY + 10;
        float favFrac = Math.max(0f, Math.min(1f, ClientState.favor() / 1000f));
        graphics.fill(x, favY, x + w, favY + 3, ENERGY_EMPTY);
        graphics.fill(x, favY, x + (int) (w * favFrac), favY + 3, FAVOUR);
        graphics.drawString(mc.font,
                Component.literal(String.format("§e%.0f", ClientState.favor())),
                x + w + 6, favY - 3, 0xFFFFFF, true);

        if (ClientState.overdraw() > 0f) {
            graphics.drawString(mc.font,
                    Component.literal("§8spent — everything is grey and far away"),
                    x, favY + 8, 0xFFFFFF, true);
        }
    }
}
