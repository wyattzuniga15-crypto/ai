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
import net.neoforged.neoforge.network.PacketDistributor;
import org.lwjgl.glfw.GLFW;

/** Client-only wiring. The key sends an intent; the server owns everything that follows. */
@Mod(value = ChronolyConstants.MOD_ID, dist = Dist.CLIENT)
public final class ChronolyClient {

    public static final KeyMapping CAST = new KeyMapping(
            "key.chronoly.cast", KeyConflictContext.IN_GAME, InputConstants.Type.KEYSYM,
            GLFW.GLFW_KEY_G, "key.categories.chronoly");

    public ChronolyClient(IEventBus modBus) {
        modBus.addListener(this::registerKeys);
        net.neoforged.neoforge.common.NeoForge.EVENT_BUS.addListener(this::onClientTick);
    }

    private void registerKeys(RegisterKeyMappingsEvent event) {
        event.register(CAST);
    }

    private void onClientTick(ClientTickEvent.Post event) {
        while (CAST.consumeClick()) {
            PacketDistributor.sendToServer(new CastAbilityPayload());
        }
    }
}
