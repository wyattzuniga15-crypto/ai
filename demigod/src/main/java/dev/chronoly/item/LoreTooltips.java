package dev.chronoly.item;

import dev.chronoly.ChronolyConstants;
import net.minecraft.network.chat.Component;
import net.neoforged.neoforge.event.entity.player.ItemTooltipEvent;

/**
 * Attaches {@link Lore} to any of the mod's items when they are held or hovered.
 *
 * <p>Done through the tooltip event rather than by overriding {@code appendHoverText} on fourteen
 * item classes. 1.21.11 moved a great deal, this method's signature is not in the notes as
 * verified, and one call site is a cheaper thing to be wrong about than fourteen.
 */
public final class LoreTooltips {

    private LoreTooltips() {}

    public static void onTooltip(ItemTooltipEvent event) {
        var id = net.minecraft.core.registries.BuiltInRegistries.ITEM
                .getKey(event.getItemStack().getItem());
        if (!id.getNamespace().equals(ChronolyConstants.MOD_ID)) return;

        Component line = Lore.lineFor(id.getPath());
        if (line != null) event.getToolTip().add(line);
    }
}
