package dev.chronoly.registry;

import dev.chronoly.ChronolyConstants;
import net.minecraft.world.item.Item;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

/**
 * Items. Phase 1 registers only what proves the pipeline; the material and relic sets land in
 * Phase 4 with the Mist combat rule they exist to serve.
 */
public final class ChItems {

    public static final DeferredRegister.Items ITEMS =
            DeferredRegister.createItems(ChronolyConstants.MOD_ID);

    /**
     * The Lightning Thief, ch. 17 — Charon does not work for free, and the Underworld's economy
     * runs on these. Registered first because Phase 9's escape loop is priced in them.
     */
    public static final DeferredItem<Item> GOLDEN_DRACHMA = ITEMS.registerSimpleItem("golden_drachma");

    private ChItems() {}

    public static void init(IEventBus bus) {
        ITEMS.register(bus);
    }
}
