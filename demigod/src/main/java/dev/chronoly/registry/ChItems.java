package dev.chronoly.registry;

import dev.chronoly.ChronolyConstants;
import dev.chronoly.item.AmbrosiaItem;
import net.minecraft.core.component.DataComponents;
import net.minecraft.world.entity.EquipmentSlotGroup;
import net.minecraft.world.entity.ai.attributes.AttributeModifier;
import net.minecraft.world.entity.ai.attributes.Attributes;
import net.minecraft.world.item.Item;
import net.minecraft.world.item.component.ItemAttributeModifiers;
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
    public static final DeferredItem<Item> AMBROSIA = ITEMS.registerItem("ambrosia",
            props -> new AmbrosiaItem(props.stacksTo(16), 10f, 34f, 100f));

    /** The drink to ambrosia's food; the same rule, the same danger. */
    public static final DeferredItem<Item> NECTAR = ITEMS.registerItem("nectar",
            props -> new AmbrosiaItem(props.stacksTo(8), 6f, 20f, 100f));

    /**
     * The Sea of Monsters — fire that water spreads rather than stops. One of the few things in
     * the mod that hurts everyone, mortal and monster alike.
     */
    public static final DeferredItem<Item> GREEK_FIRE = ITEMS.registerSimpleItem("greek_fire");

    /** Worked Mist, held in a solid. The material Hecate's work is built from. */
    public static final DeferredItem<Item> MIST_GLASS = ITEMS.registerSimpleItem("mist_glass");

    /**
     * The Lightning Thief, ch. 6 — Riptide. Bronze bites the immortal and finds nothing in a mortal.
     * Attack power comes from a vanilla attribute modifier rather than a tool material, so the
     * weapon composes with everything else that touches reach and damage.
     */
    public static final DeferredItem<Item> CELESTIAL_BRONZE_SWORD = ITEMS.registerItem(
            "celestial_bronze_sword", props -> new Item(props.durability(900)
                    .component(DataComponents.ATTRIBUTE_MODIFIERS, weapon(7.0, -2.4))));

    public static final DeferredItem<Item> CELESTIAL_BRONZE_DAGGER = ITEMS.registerItem(
            "celestial_bronze_dagger", props -> new Item(props.durability(500)
                    .component(DataComponents.ATTRIBUTE_MODIFIERS, weapon(4.5, -1.8))));

    /** Harsher and less stable than bronze, as consecrated metal should be. */
    public static final DeferredItem<Item> IMPERIAL_GOLD_SWORD = ITEMS.registerItem(
            "imperial_gold_sword", props -> new Item(props.durability(700)
                    .component(DataComponents.ATTRIBUTE_MODIFIERS, weapon(8.0, -2.6))));

    /** The Last Olympian — it keeps a little of whatever it kills. */
    public static final DeferredItem<Item> STYGIAN_IRON_SWORD = ITEMS.registerItem(
            "stygian_iron_sword", props -> new Item(props.durability(1100)
                    .component(DataComponents.ATTRIBUTE_MODIFIERS, weapon(7.5, -2.4))));

    private static ItemAttributeModifiers weapon(double damage, double speed) {
        return ItemAttributeModifiers.builder()
                .add(Attributes.ATTACK_DAMAGE,
                        new AttributeModifier(ChronolyConstants.id("weapon_damage"), damage,
                                AttributeModifier.Operation.ADD_VALUE),
                        EquipmentSlotGroup.MAINHAND)
                .add(Attributes.ATTACK_SPEED,
                        new AttributeModifier(ChronolyConstants.id("weapon_speed"), speed,
                                AttributeModifier.Operation.ADD_VALUE),
                        EquipmentSlotGroup.MAINHAND)
                .build();
    }

    /** Creative-tab order: weapons, currency, metals, consumables. */
    public static final List<DeferredItem<Item>> TAB_ORDER = List.of(
            CELESTIAL_BRONZE_SWORD, CELESTIAL_BRONZE_DAGGER, IMPERIAL_GOLD_SWORD, STYGIAN_IRON_SWORD,
            GOLDEN_DRACHMA,
            CELESTIAL_BRONZE_INGOT, IMPERIAL_GOLD_INGOT, STYGIAN_IRON_INGOT,
            AMBROSIA, NECTAR, GREEK_FIRE, MIST_GLASS);

    private ChItems() {}

    public static void init(IEventBus bus) {
        ITEMS.register(bus);
    }
}
