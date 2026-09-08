package dev.potatoclient.render;

import net.minecraft.client.render.RenderLayer;
import net.minecraft.client.render.VertexConsumer;
import net.minecraft.client.render.VertexConsumerProvider;
import net.minecraft.client.render.VertexRendering;
import net.minecraft.client.util.math.MatrixStack;
import net.minecraft.util.math.Box;
import net.minecraft.util.math.Vec3d;
import net.minecraft.util.shape.VoxelShape;

/**
 * Line drawing for the debug overlays.
 *
 * <p>Two layers are used, and the difference matters:
 *
 * <ul>
 * <li>{@link RenderLayer#getLines()} draws independent segment pairs and respects
 *     the depth buffer. It is what vanilla uses for F3+B hitboxes, so any number
 *     of boxes can share one buffer.</li>
 * <li>{@link RenderLayer#getDebugLineStrip(double)} bakes a line width but draws
 *     one connected strip, which is what vanilla's debug renderers draw over
 *     terrain with. Everything in the buffer joins up, so each shape has to be
 *     flushed before the next one starts.</li>
 * </ul>
 *
 * <p>{@link LineBatch} hides that difference. The width for the depth-tested
 * layer comes from {@link #widthOverride()}, which
 * {@code dev.potatoclient.mixin.RenderPhaseMixin} applies while a batch flushes.
 */
public final class RenderUtil {
	private static float widthOverride;

	private RenderUtil() {
	}

	/** Read by the render-phase mixin; 0 means "leave vanilla's width alone". */
	public static float widthOverride() {
		return widthOverride;
	}

	public static int argb(int color, float opacityMultiplier) {
		int alpha = Math.round(((color >>> 24) & 0xFF) * Math.max(0.0F, Math.min(1.0F, opacityMultiplier)));
		return (alpha << 24) | (color & 0x00FFFFFF);
	}

	private static float red(int argb) {
		return ((argb >> 16) & 0xFF) / 255.0F;
	}

	private static float green(int argb) {
		return ((argb >> 8) & 0xFF) / 255.0F;
	}

	private static float blue(int argb) {
		return (argb & 0xFF) / 255.0F;
	}

	private static float alpha(int argb) {
		return ((argb >>> 24) & 0xFF) / 255.0F;
	}

	/** A run of lines sharing one layer, flushed so their topology stays correct. */
	public static final class LineBatch implements AutoCloseable {
		private final VertexConsumerProvider consumers;
		private final RenderLayer layer;
		private final float width;
		private final boolean strip;
		private final VertexConsumerProvider.Immediate immediate;
		private boolean pending;

		private LineBatch(VertexConsumerProvider consumers, RenderLayer layer, float width, boolean strip) {
			this.consumers = consumers;
			this.layer = layer;
			this.width = width;
			this.strip = strip;
			this.immediate = consumers instanceof VertexConsumerProvider.Immediate value ? value : null;
		}

		/** Depth-tested pairs; any number of shapes share one draw. */
		public static LineBatch depthTested(VertexConsumerProvider consumers, float width) {
			return new LineBatch(consumers, RenderLayer.getLines(), width, false);
		}

		/**
		 * Drawn over terrain. Falls back to the depth-tested layer when the buffer
		 * cannot be flushed between shapes, because an unflushed strip would join
		 * every shape to the next with a stray line.
		 */
		public static LineBatch throughWalls(VertexConsumerProvider consumers, float width) {
			if (!(consumers instanceof VertexConsumerProvider.Immediate)) {
				return depthTested(consumers, width);
			}
			return new LineBatch(consumers, RenderLayer.getDebugLineStrip(Math.max(0.5D, width)), width, true);
		}

		public void box(MatrixStack matrices, Box box, int argb) {
			VertexConsumer consumer = this.consumers.getBuffer(this.layer);
			if (this.strip) {
				strip(matrices, consumer, box, argb);
			} else {
				VertexRendering.drawBox(matrices, consumer, box, red(argb), green(argb), blue(argb), alpha(argb));
			}
			endShape();
		}

		/** Only valid on the depth-tested layer; a voxel shape is not one strip. */
		public void outline(MatrixStack matrices, VoxelShape shape, double x, double y, double z, int argb) {
			VertexConsumer consumer = this.consumers.getBuffer(RenderLayer.getLines());
			VertexRendering.drawOutline(matrices, consumer, shape, x, y, z, argb);
			endShape();
		}

		public void line(MatrixStack matrices, Vec3d from, Vec3d to, int argb) {
			VertexConsumer consumer = this.consumers.getBuffer(this.layer);
			MatrixStack.Entry entry = matrices.peek();
			if (this.strip) {
				consumer.vertex(entry, (float) from.x, (float) from.y, (float) from.z).color(argb);
				consumer.vertex(entry, (float) to.x, (float) to.y, (float) to.z).color(argb);
			} else {
				// The pairs layer expects a normal; the segment's own direction does.
				Vec3d direction = to.subtract(from);
				double length = direction.length();
				Vec3d normal = length < 1.0E-6D ? new Vec3d(0.0D, 1.0D, 0.0D) : direction.multiply(1.0D / length);
				consumer.vertex(entry, (float) from.x, (float) from.y, (float) from.z).color(argb)
						.normal(entry, (float) normal.x, (float) normal.y, (float) normal.z);
				consumer.vertex(entry, (float) to.x, (float) to.y, (float) to.z).color(argb)
						.normal(entry, (float) normal.x, (float) normal.y, (float) normal.z);
			}
			endShape();
		}

		private void endShape() {
			this.pending = true;
			if (this.strip) {
				flush();
			}
		}

		@Override
		public void close() {
			flush();
		}

		private void flush() {
			if (!this.pending || this.immediate == null) {
				return;
			}
			this.pending = false;
			widthOverride = this.width;
			try {
				this.immediate.draw(this.layer);
			} finally {
				widthOverride = 0.0F;
			}
		}
	}

	/**
	 * A box outline as one line strip.
	 *
	 * <p>All eight corners of a cube have odd degree, so no walk covers the twelve
	 * edges exactly once. This one retraces three, which is invisible because the
	 * retraced pixels are identical.
	 */
	private static void strip(MatrixStack matrices, VertexConsumer consumer, Box box, int argb) {
		float x0 = (float) box.minX;
		float y0 = (float) box.minY;
		float z0 = (float) box.minZ;
		float x1 = (float) box.maxX;
		float y1 = (float) box.maxY;
		float z1 = (float) box.maxZ;
		MatrixStack.Entry entry = matrices.peek();

		float[][] path = {
				{x0, y0, z0}, {x1, y0, z0}, {x1, y0, z1}, {x0, y0, z1}, {x0, y0, z0},
				{x0, y1, z0}, {x1, y1, z0}, {x1, y1, z1}, {x0, y1, z1}, {x0, y1, z0},
				{x1, y1, z0}, {x1, y0, z0}, {x1, y0, z1}, {x1, y1, z1}, {x0, y1, z1}, {x0, y0, z1},
		};
		for (float[] point : path) {
			consumer.vertex(entry, point[0], point[1], point[2]).color(argb);
		}
	}
}
