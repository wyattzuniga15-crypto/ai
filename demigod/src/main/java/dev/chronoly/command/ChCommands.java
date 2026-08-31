package dev.chronoly.command;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import dev.chronoly.ability.Abilities;
import dev.chronoly.attachment.DemigodData;
import dev.chronoly.boss.BossKind;
import dev.chronoly.boss.Bosses;
import dev.chronoly.core.favor.Tier;
import dev.chronoly.world.ChDimensions;
import net.minecraft.server.level.ServerLevel;
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

    /**
     * 1.21.11 replaced integer permission levels with PermissionChecks, so the old
     * {@code hasPermission(int)} is gone. The op list is a stable way to ask the same question.
     */
    private static boolean isOperator(CommandSourceStack source, ServerPlayer player) {
        return source.getServer().getPlayerList().isOp(player.nameAndId());
    }

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

        var claim = Commands.literal("claim");
        for (String god : GODS) {
            claim.then(Commands.literal(god).executes(ctx -> {
                ServerPlayer p = ctx.getSource().getPlayerOrException();
                if (!isOperator(ctx.getSource(), p)) {
                    p.sendSystemMessage(Component.literal("§7Only an operator may hand out parentage."));
                    return 0;
                }
                GameplayEvents.claimAs(p, p.getData(ChAttachments.DEMIGOD.get()), god);
                return 1;
            }));
        }
        root.then(claim);

        root.then(Commands.literal("favor")
                .then(Commands.argument("amount", com.mojang.brigadier.arguments.FloatArgumentType.floatArg())
                        .executes(ctx -> {
                            ServerPlayer p = ctx.getSource().getPlayerOrException();
                            if (!isOperator(ctx.getSource(), p)) return 0;
                            DemigodData d = p.getData(ChAttachments.DEMIGOD.get());
                            if (!d.isClaimed()) return 0;
                            d.addFavor(d.parentage().orElseThrow(),
                                    com.mojang.brigadier.arguments.FloatArgumentType.getFloat(ctx, "amount"));
                            return 1;
                        })));

        // Travel. The Underworld you can always reach; Olympus wants standing.
        root.then(Commands.literal("travel")
                .then(Commands.literal("underworld").executes(ctx -> {
                    ServerPlayer p = ctx.getSource().getPlayerOrException();
                    ChDimensions.sendToUnderworld(p, "You walk in on your own two feet. Few do.");
                    return 1;
                }))
                .then(Commands.literal("olympus").executes(ctx -> {
                    ServerPlayer p = ctx.getSource().getPlayerOrException();
                    DemigodData d = p.getData(ChAttachments.DEMIGOD.get());
                    if (!d.isClaimed()) {
                        p.sendSystemMessage(Component.literal(
                                "§7The lift does not have a six hundredth floor for you."));
                        return 0;
                    }
                    ChDimensions.sendToOlympus(p);
                    return 1;
                }))
                .then(Commands.literal("home").executes(ctx -> {
                    ServerPlayer p = ctx.getSource().getPlayerOrException();
                    ChDimensions.travel(p, net.minecraft.world.level.Level.OVERWORLD,
                            p.getX(), 128, p.getZ());
                    p.sendSystemMessage(Component.literal("§7Back where the air is ordinary."));
                    return 1;
                })));

        // Boss summoning stays an operator tool until quests place them properly.
        var summon = Commands.literal("summon");
        for (BossKind kind : BossKind.values()) {
            summon.then(Commands.literal(kind.id()).executes(ctx -> {
                ServerPlayer p = ctx.getSource().getPlayerOrException();
                if (!isOperator(ctx.getSource(), p)) {
                    p.sendSystemMessage(Component.literal("§7Only an operator may call one of those."));
                    return 0;
                }
                var look = p.getLookAngle();
                Bosses.spawn((ServerLevel) p.level(), kind,
                        p.getX() + look.x * 8, p.getY(), p.getZ() + look.z * 8);
                return 1;
            }));
        }
        root.then(summon);

        event.getDispatcher().register(root);
    }
}
