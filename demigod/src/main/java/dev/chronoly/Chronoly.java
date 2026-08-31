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
import net.neoforged.neoforge.common.NeoForge;
import dev.chronoly.command.ChCommands;
import dev.chronoly.event.GameplayEvents;

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

        NeoForge.EVENT_BUS.addListener(GameplayEvents::onIncomingDamage);
        NeoForge.EVENT_BUS.addListener(GameplayEvents::onDeath);
        NeoForge.EVENT_BUS.addListener(GameplayEvents::onPlayerDeath);
        NeoForge.EVENT_BUS.addListener(GameplayEvents::onServerTick);
        NeoForge.EVENT_BUS.addListener(ChCommands::register);
        NeoForge.EVENT_BUS.addListener(dev.chronoly.event.PietyEvents::onOffer);
        NeoForge.EVENT_BUS.addListener(dev.chronoly.event.PietyEvents::onCraft);
        NeoForge.EVENT_BUS.addListener(dev.chronoly.event.PietyEvents::onKill);
        NeoForge.EVENT_BUS.addListener(dev.chronoly.item.LoreTooltips::onTooltip);

        container.registerConfig(ModConfig.Type.SERVER, ChServerConfig.SPEC);
        container.registerConfig(ModConfig.Type.COMMON, ChCommonConfig.SPEC);
    }
}
