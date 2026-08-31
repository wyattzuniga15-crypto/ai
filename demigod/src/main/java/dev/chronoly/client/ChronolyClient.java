package dev.chronoly.client;

import com.mojang.blaze3d.platform.InputConstants;
import dev.chronoly.ChronolyConstants;
import dev.chronoly.net.c2s.CastAbilityPayload;
import net.minecraft.client.KeyMapping;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.fml.common.Mod;
import net.neoforged.neoforge.client.event.ClientTickEvent;
import net.neoforged.neoforge.client.event.RegisterKeyMappingsEvent;
import net.neoforged.neoforge.client.settings.KeyConflictContext;
import org.lwjgl.glfw.GLFW;

/**
 * Client wiring: one key, and the HUD that tells you what you are.
 *
 * <p>The key sends an intent and nothing else. The server decides whether anything happens, which
 * is ARCHITECTURE §5.1 and the reason none of this can be cheated by a modified client.
 */
@Mod(value = ChronolyConstants.MOD_ID, dist = Dist.CLIENT)
public final class ChronolyClient {

    public static final KeyMapping CAST = new KeyMapping(
            "key.chronoly.cast",
            KeyConflictContext.IN_GAME,
            InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_G,
            KeyMapping.Category.GAMEPLAY);

    public ChronolyClient(IEventBus modBus) {
        modBus.addListener(this::registerKeys);
        modBus.addListener(this::registerHud);
        modBus.addListener(this::registerLayers);
        modBus.addListener(this::registerRenderers);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onClientTick);
    }

    private void registerLayers(net.neoforged.neoforge.client.event.EntityRenderersEvent.RegisterLayerDefinitions event) {
        for (dev.chronoly.boss.BossKind kind : dev.chronoly.boss.BossKind.values()) {
            event.registerLayerDefinition(dev.chronoly.client.render.BossModels.layer(kind),
                    () -> dev.chronoly.client.render.BossModels.of(kind));
        }
    }

    private void registerRenderers(net.neoforged.neoforge.client.event.EntityRenderersEvent.RegisterRenderers event) {
        for (dev.chronoly.boss.BossKind kind : dev.chronoly.boss.BossKind.values()) {
            event.registerEntityRenderer(dev.chronoly.registry.ChEntities.typeFor(kind),
                    ctx -> new dev.chronoly.client.render.ChBossRenderer(ctx, kind));
        }
    }

    private void registerKeys(RegisterKeyMappingsEvent event) {
        event.register(CAST);
    }

    private void registerHud(net.neoforged.neoforge.client.event.RegisterGuiLayersEvent event) {
        event.registerAboveAll(ChronolyConstants.id("demigod_hud"), ChronolyHud::render);
    }

    private void onClientTick(ClientTickEvent.Post event) {
        while (CAST.consumeClick()) {
            net.neoforged.neoforge.client.network.ClientPacketDistributor.sendToServer(
                    new CastAbilityPayload());
        }
    }
}
