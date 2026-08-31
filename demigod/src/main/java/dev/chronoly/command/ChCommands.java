package dev.chronoly.command;

import com.mojang.brigadier.builder.LiteralArgumentBuilder;
import dev.chronoly.ability.Abilities;
import dev.chronoly.attachment.DemigodData;
import dev.chronoly.boss.BossKind;
import dev.chronoly.boss.Bosses;
import dev.chronoly.core.favor.Tier;
import dev.chronoly.quest.Oracle;
import dev.chronoly.world.underworld.Judgment;
import dev.chronoly.world.camp.CampBuilder;
import dev.chronoly.world.camp.CampWard;
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
                    // Leaving the Underworld is a transaction, not a command.
                    if (ChDimensions.isUnderworld(p.level())) {
                        return Judgment.payCharon(p) ? 1 : 0;
                    }
                    ChDimensions.travel(p, net.minecraft.world.level.Level.OVERWORLD,
                            p.getX(), 128, p.getZ());
                    p.sendSystemMessage(Component.literal("§7Back where the air is ordinary."));
                    return 1;
                })));

        root.then(Commands.literal("charon").executes(ctx -> {
            ServerPlayer p = ctx.getSource().getPlayerOrException();
            if (!ChDimensions.isUnderworld(p.level())) {
                p.sendSystemMessage(Component.literal(
                        "§7Charon is not up here. He does not do house calls."));
                return 0;
            }
            return Judgment.payCharon(p) ? 1 : 0;
        }));

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

        root.then(Commands.literal("prophecy").executes(ctx -> {
            ServerPlayer p = ctx.getSource().getPlayerOrException();
            DemigodData d = p.getData(ChAttachments.DEMIGOD.get());
            if (!d.isClaimed()) {
                p.sendSystemMessage(Component.literal(
                        "§7The Oracle does not waste breath on the unclaimed."));
                return 0;
            }
            if (d.hasQuest()) {
                p.sendSystemMessage(Component.literal(
                        "§7You already have somewhere to be. §8/chronoly quest"));
                return 0;
            }
            Oracle.consult(p, d);
            return 1;
        }));

        root.then(Commands.literal("quest").executes(ctx -> {
            ServerPlayer p = ctx.getSource().getPlayerOrException();
            DemigodData d = p.getData(ChAttachments.DEMIGOD.get());
            if (!d.hasQuest()) {
                p.sendSystemMessage(Component.literal(
                        "§7No prophecy on you. §8/chronoly prophecy if you want one."));
                return 0;
            }
            long left = (d.questDeadline() - p.level().getGameTime()) / 20L;
            p.sendSystemMessage(Component.literal(String.format(
                    "§6Quest: §fdestroy %s §7in §f%s §7| §e%d§7s left",
                    d.questTarget(), d.questPlace(), Math.max(0, left))));
            return 1;
        }));

        root.then(Commands.literal("camp")
                .then(Commands.literal("build").executes(ctx -> {
                    ServerPlayer p = ctx.getSource().getPlayerOrException();
                    if (!isOperator(ctx.getSource(), p)) {
                        p.sendSystemMessage(Component.literal("§7Only an operator may raise the camp."));
                        return 0;
                    }
                    ServerLevel level = (ServerLevel) p.level();
                    var origin = p.blockPosition();
                    int cabins = CampBuilder.build(level, origin);
                    CampWard.register(level, origin, CampBuilder.RADIUS);
                    p.sendSystemMessage(Component.literal(
                            "§6Camp Half-Blood stands. §7" + cabins
                            + " cabins, the Big House, the pavilion, and a pine on the hill."));
                    p.sendSystemMessage(Component.literal(
                            "§7Inside the borders nothing can smell you."));
                    return 1;
                }))
                .then(Commands.literal("ward").executes(ctx -> {
                    ServerPlayer p = ctx.getSource().getPlayerOrException();
                    ServerLevel level = (ServerLevel) p.level();
                    boolean safe = CampWard.isWarded(level, p.blockPosition());
                    p.sendSystemMessage(Component.literal(safe
                            ? "§aYou are inside the borders. Nothing out there knows where you are."
                            : "§cYou are outside the borders. §7Whatever is hunting you can still smell you."));
                    return 1;
                })));

        event.getDispatcher().register(root);
    }
}
