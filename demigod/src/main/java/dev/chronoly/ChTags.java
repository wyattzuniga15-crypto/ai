package dev.chronoly;

import net.minecraft.core.registries.Registries;
import net.minecraft.tags.TagKey;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.item.Item;

/** Tags the Mist combat rule reads. Kept in one place because the rule is load-bearing. */
public final class ChTags {

    public static final TagKey<Item> DIVINE_WEAPON =
            TagKey.create(Registries.ITEM, ChronolyConstants.id("divine_weapon"));

    /**
     * Weapons that belong to neither world and wound both. Backbiter is the whole reason this
     * exists: half mortal steel and half celestial bronze, it cuts mortals <em>and</em> monsters,
     * which no single-axis weapon can do.
     */
    public static final TagKey<Item> BYPASSES_MIST =
            TagKey.create(Registries.ITEM, ChronolyConstants.id("bypasses_mist"));

    /** Things that dissolve into golden dust. Mortal steel cannot touch them. */
    public static final TagKey<EntityType<?>> MONSTER =
            TagKey.create(Registries.ENTITY_TYPE, ChronolyConstants.id("monster"));

    /** Ordinary people and animals. Divine metal passes straight through them. */
    public static final TagKey<EntityType<?>> MORTAL =
            TagKey.create(Registries.ENTITY_TYPE, ChronolyConstants.id("mortal"));

    private ChTags() {}
}
