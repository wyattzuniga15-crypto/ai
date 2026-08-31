package dev.chronoly.registry;

import dev.chronoly.ChronolyConstants;
import dev.chronoly.boss.BossKind;
import dev.chronoly.entity.ChBossEntity;
import net.minecraft.core.registries.Registries;
import net.minecraft.resources.ResourceKey;
import net.minecraft.world.entity.EntityType;
import net.minecraft.world.entity.MobCategory;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.event.entity.EntityAttributeCreationEvent;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

import java.util.EnumMap;
import java.util.Map;

/**
 * One entity type per named monster.
 *
 * <p>Nine registrations of one class rather than one type with a variant field, on purpose: the
 * type is the identity, so it survives a save/load with no bespoke serialisation, the renderer is
 * chosen by type like every vanilla mob, and a hypothetical datapack can target
 * {@code chronoly:medusa} the way it targets {@code minecraft:witch}.
 */
public final class ChEntities {

    public static final DeferredRegister<EntityType<?>> ENTITIES =
            DeferredRegister.create(Registries.ENTITY_TYPE, ChronolyConstants.MOD_ID);

    private static final Map<BossKind, DeferredHolder<EntityType<?>, EntityType<ChBossEntity>>> TYPES =
            new EnumMap<>(BossKind.class);

    static {
        for (BossKind kind : BossKind.values()) {
            // Sized to read as what they are: the flyer small, the drakon long, the rest bulky.
            float w = switch (kind) {
                case FURY -> 0.9f;
                case LYDIAN_DRAKON -> 2.6f;
                case CHARYBDIS -> 2.4f;
                case MEDUSA -> 0.8f;
                default -> 1.6f;
            };
            float h = switch (kind) {
                case FURY -> 1.6f;
                case MEDUSA -> 2.0f;
                case CHARYBDIS -> 1.6f;
                case LYDIAN_DRAKON -> 1.8f;
                default -> 2.3f;
            };
            ResourceKey<EntityType<?>> key =
                    ResourceKey.create(Registries.ENTITY_TYPE, ChronolyConstants.id(kind.id()));
            TYPES.put(kind, ENTITIES.register(kind.id(), () ->
                    EntityType.Builder
                            .of((EntityType<ChBossEntity> t, net.minecraft.world.level.Level l) ->
                                    new ChBossEntity(t, l, kind), MobCategory.MONSTER)
                            .sized(w, h)
                            .fireImmune()
                            .clientTrackingRange(10)
                            .build(key)));
        }
    }

    public static EntityType<ChBossEntity> typeFor(BossKind kind) {
        return TYPES.get(kind).get();
    }

    public static void init(IEventBus modBus) {
        ENTITIES.register(modBus);
        modBus.addListener(ChEntities::attributes);
    }

    /** Base attributes; Bosses#spawn still applies the per-kind health, damage and speed. */
    private static void attributes(EntityAttributeCreationEvent event) {
        for (BossKind kind : BossKind.values()) {
            event.put(typeFor(kind), ChBossEntity.baseAttributes().build());
        }
    }

    private ChEntities() {}
}
