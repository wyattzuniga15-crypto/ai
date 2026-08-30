package dev.chronoly;

import dev.chronoly.config.ChCommonConfig;
import dev.chronoly.net.ChPayloads;
import dev.chronoly.config.ChServerConfig;
import dev.chronoly.registry.ChAttachments;
import dev.chronoly.registry.ChCreativeTabs;
import dev.chronoly.registry.ChItems;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.ModContainer;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.config.ModConfig;

/**
 * Entry point.
 *
 * <p>ARCHITECTURE §3.1 — every registry holder is initialised here in a fixed order, and no static
 * initialiser anywhere has a side effect beyond registering with its DeferredRegister.
 */
@Mod(ChronolyConstants.MOD_ID)
public final class Chronoly {

    public Chronoly(IEventBus modBus, ModContainer container) {
        ChItems.init(modBus);
        ChCreativeTabs.init(modBus);
        ChAttachments.init(modBus);

        modBus.addListener(ChPayloads::register);

        container.registerConfig(ModConfig.Type.SERVER, ChServerConfig.SPEC);
        container.registerConfig(ModConfig.Type.COMMON, ChCommonConfig.SPEC);
    }
}
