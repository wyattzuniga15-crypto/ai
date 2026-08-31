package dev.chronoly.registry;

import dev.chronoly.ChronolyConstants;
import net.minecraft.core.registries.Registries;
import net.minecraft.network.chat.Component;
import net.minecraft.world.item.CreativeModeTab;
import net.minecraft.world.item.ItemStack;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.registries.DeferredHolder;
import net.neoforged.neoforge.registries.DeferredRegister;

public final class ChCreativeTabs {

    public static final DeferredRegister<CreativeModeTab> TABS =
            DeferredRegister.create(Registries.CREATIVE_MODE_TAB, ChronolyConstants.MOD_ID);

    public static final DeferredHolder<CreativeModeTab, CreativeModeTab> MAIN = TABS.register("main",
            () -> CreativeModeTab.builder()
                    .title(Component.translatable("itemGroup.chronoly.main"))
                    .icon(() -> new ItemStack(ChItems.GOLDEN_DRACHMA.get()))
                    .displayItems((params, output) ->
                            ChItems.TAB_ORDER.forEach(item -> output.accept(item.get())))
                    .build());

    private ChCreativeTabs() {}

    public static void init(IEventBus bus) {
        TABS.register(bus);
    }
}
