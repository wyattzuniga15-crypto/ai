package dev.potatoclient.render;

import dev.potatoclient.config.RenderConfig;
import net.minecraft.entity.Entity;
import net.minecraft.entity.ExperienceOrbEntity;
import net.minecraft.entity.ItemEntity;
import net.minecraft.entity.mob.Monster;
import net.minecraft.entity.passive.PassiveEntity;
import net.minecraft.entity.player.PlayerEntity;

/** Groups entities so hitboxes can be coloured by what they are. */
public enum EntityCategory {
	HOSTILE,
	PASSIVE,
	PLAYER,
	ITEM,
	OTHER;

	public static EntityCategory of(Entity entity) {
		if (entity instanceof PlayerEntity) {
			return PLAYER;
		}
		// Monster is the interface every hostile mob implements, including ones
		// like the Warden that do not extend HostileEntity.
		if (entity instanceof Monster) {
			return HOSTILE;
		}
		if (entity instanceof PassiveEntity) {
			return PASSIVE;
		}
		if (entity instanceof ItemEntity || entity instanceof ExperienceOrbEntity) {
			return ITEM;
		}
		return OTHER;
	}

	public int color(RenderConfig.Hitboxes cfg) {
		return switch (this) {
			case HOSTILE -> cfg.hostileColor;
			case PASSIVE -> cfg.passiveColor;
			case PLAYER -> cfg.playerColor;
			case ITEM -> cfg.itemColor;
			case OTHER -> cfg.otherColor;
		};
	}
}
