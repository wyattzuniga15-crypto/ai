package dev.chronoly.registry;

import dev.chronoly.ChronolyConstants;
import net.minecraft.world.item.Item;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredItem;
import net.neoforged.neoforge.registries.DeferredRegister;

import java.util.List;

/**
 * The materials the mod is actually about.
 *
 * <p>These are Phase 4's item layer, landing early because the Mist combat rule they exist to serve
 * is the mod's most important mechanic and an empty creative tab teaches nobody anything.
 * The behaviour — the damage matrix, the burn counter, the essence absorption — arrives with the
 * rule itself; these are the things it will attach to.
 */
public final class ChItems {

    public static final DeferredRegister.Items ITEMS =
            DeferredRegister.createItems(ChronolyConstants.MOD_ID);

    /**
     * The Lightning Thief, ch. 17 — Charon does not ferry the dead for free, and the Underworld's
     * economy runs on these. Priced into Phase 9's escape loop.
     */
    public static final DeferredItem<Item> GOLDEN_DRACHMA = ITEMS.registerSimpleItem("golden_drachma");

    /**
     * The Lightning Thief, ch. 6 — the metal that bites the immortal and passes harmlessly through
     * a mortal. Half of the mod's most important rule is made of this.
     */
    public static final DeferredItem<Item> CELESTIAL_BRONZE_INGOT =
            ITEMS.registerSimpleItem("celestial_bronze_ingot");

    /** Consecrated, harsher, and less stable than bronze. Roman work. */
    public static final DeferredItem<Item> IMPERIAL_GOLD_INGOT =
            ITEMS.registerSimpleItem("imperial_gold_ingot");

    /**
     * The Last Olympian — forged only by quenching in the Styx, and it keeps a little of whatever
     * it kills. Phase 4 gives it the data component that grows.
     */
    public static final DeferredItem<Item> STYGIAN_IRON_INGOT =
            ITEMS.registerSimpleItem("stygian_iron_ingot");

    /**
     * The Lightning Thief, ch. 4 — food of the gods, and lethal to a demigod in quantity. The burn
     * counter that makes that true is Phase 4.
     */
    public static final DeferredItem<Item> AMBROSIA = ITEMS.registerSimpleItem("ambrosia");

    /** The drink to ambrosia's food; the same rule, the same danger. */
    public static final DeferredItem<Item> NECTAR = ITEMS.registerSimpleItem("nectar");

    /**
     * The Sea of Monsters — fire that water spreads rather than stops. One of the few things in
     * the mod that hurts everyone, mortal and monster alike.
     */
    public static final DeferredItem<Item> GREEK_FIRE = ITEMS.registerSimpleItem("greek_fire");

    /** Worked Mist, held in a solid. The material Hecate's work is built from. */
    public static final DeferredItem<Item> MIST_GLASS = ITEMS.registerSimpleItem("mist_glass");

    /** Creative-tab order: currency, then the three divine metals, then the consumables. */
    public static final List<DeferredItem<Item>> TAB_ORDER = List.of(
            GOLDEN_DRACHMA,
            CELESTIAL_BRONZE_INGOT, IMPERIAL_GOLD_INGOT, STYGIAN_IRON_INGOT,
            AMBROSIA, NECTAR, GREEK_FIRE, MIST_GLASS);

    private ChItems() {}

    public static void init(IEventBus bus) {
        ITEMS.register(bus);
    }
}
