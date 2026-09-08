package dev.potatoclient.mixin;

import net.minecraft.client.option.SimpleOption;
import org.spongepowered.asm.mixin.Mixin;
import org.spongepowered.asm.mixin.gen.Accessor;

/**
 * Writes an option's value past its own validator.
 *
 * <p>{@link SimpleOption#setValue} runs the option's callbacks, and the gamma
 * option's callback clamps to 1.0. Fullbright needs a larger value, so it goes
 * to the backing field directly. The method is named {@code setPotatoValue}
 * rather than {@code setValue} because Mixin derives the accessor kind from the
 * {@code set} prefix, and the erased signature must not collide with the real
 * {@code setValue(Object)}.
 */
@Mixin(SimpleOption.class)
public interface SimpleOptionAccessor<T> {
	@Accessor("value")
	void setPotatoValue(T value);
}
