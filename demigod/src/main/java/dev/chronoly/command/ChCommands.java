package dev.chronoly.command;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import dev.chronoly.ability.Abilities;
import dev.chronoly.attachment.DemigodData;
import dev.chronoly.core.favor.Tier;
import dev.chronoly.event.GameplayEvents;
import dev.chronoly.registry.ChAttachments;
import net.minecraft.commands.CommandSourceStack;
import net.minecraft.commands.Commands;
import net.minecraft.network.chat.Component;
import net.minecraft.server.level.ServerPlayer;
import net.neoforged.neoforge.event.RegisterCommandsEvent;

import java.util.List;

public final class ChCommands {

    private static final List<String> GODS = List.of(
            "poseidon", "zeus", "hades", "athena", "ares", "apollo", "hermes", "hecate");

    private ChCommands() {}

    public static void register(RegisterCommandsEvent event) {
        LiteralArgumentBuilder<CommandSourceStack> root = Commands.literal("chronoly");

        root.then(Commands.literal("status").executes(ctx -> {
            ServerPlayer p = ctx.getSource().getPlayerOrException();
            DemigodData d = p.getData(ChAttachments.DEMIGOD.get());
            if (!d.isClaimed()) {
                p.sendSystemMessage(Component.literal(
                        "§7Unclaimed. Kill something that should not exist and see who notices."));
                return 1;
            }
            String god = d.parentage().orElseThrow();
            float favor = d.favorWith(god);
            p.sendSystemMessage(Component.literal(String.format(
                    "§6Child of %s §7| §eFavour §f%.0f§7/1000 (%s) §7| §bEnergy §f%.0f§7/%.0f%s",
                    god.substring(0, 1).toUpperCase() + god.substring(1),
                    favor, Tier.forFavor(favor), d.energy(), d.maxEnergy(),
                    d.overdraw() > 0 ? String.format(" §8| exhausted %.0f", d.overdraw()) : "")));
            return 1;
        }));

        root.then(Commands.literal("cast").executes(ctx -> {
            ServerPlayer p = ctx.getSource().getPlayerOrException();
            Abilities.Result r = Abilities.cast(p);
            p.sendSystemMessage(Component.literal(r.message()));
            return r.cast() ? 1 : 0;
        }));

        var claim = Commands.literal("claim").requires(s -> s.hasPermission(2));
        for (String god : GODS) {
            claim.then(Commands.literal(god).executes(ctx -> {
                ServerPlayer p = ctx.getSource().getPlayerOrException();
                GameplayEvents.claimAs(p, p.getData(ChAttachments.DEMIGOD.get()), god);
                return 1;
            }));
        }
        root.then(claim);

        root.then(Commands.literal("favor").requires(s -> s.hasPermission(2))
                .then(Commands.argument("amount", com.mojang.brigadier.arguments.FloatArgumentType.floatArg())
                        .executes(ctx -> {
                            ServerPlayer p = ctx.getSource().getPlayerOrException();
                            DemigodData d = p.getData(ChAttachments.DEMIGOD.get());
                            if (!d.isClaimed()) return 0;
                            d.addFavor(d.parentage().orElseThrow(),
                                    com.mojang.brigadier.arguments.FloatArgumentType.getFloat(ctx, "amount"));
                            return 1;
                        })));

        event.getDispatcher().register(root);
    }
}
