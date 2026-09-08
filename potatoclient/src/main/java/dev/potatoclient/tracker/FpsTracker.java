package dev.potatoclient.tracker;

import java.util.Arrays;

/**
 * Frame-time history behind the FPS readout.
 *
 * <p>Keeps a ring buffer of frame durations covering the configured window and
 * derives the rolling average and the 1% low from it. The 1% low is the mean of
 * the slowest one percent of frames in the window, which is the figure
 * benchmarking tools report; a single stutter therefore shows up there without
 * moving the average.
 */
public final class FpsTracker {
	/** Enough room for a 30 s window at 1000 fps. Frames past that are dropped, not resized into. */
	private static final int CAPACITY = 30_000;
	/** Recomputing the percentile every frame would mean sorting thousands of samples per frame. */
	private static final long RECOMPUTE_INTERVAL_NANOS = 200_000_000L;

	private final long[] durations = new long[CAPACITY];
	private final long[] timestamps = new long[CAPACITY];
	private int head;
	private int size;

	private long lastFrameNanos = -1L;
	private long lastRecomputeNanos;

	private double average;
	private double onePercentLow;

	private long windowNanos = 10_000_000_000L;

	public void setWindowSeconds(int seconds) {
		this.windowNanos = Math.max(1L, seconds) * 1_000_000_000L;
	}

	/** Call once per rendered frame. */
	public void onFrame() {
		long now = System.nanoTime();

		if (this.lastFrameNanos > 0L) {
			long delta = now - this.lastFrameNanos;
			// A pause (alt-tab, world load) produces a multi-second "frame" that
			// would poison both the average and the 1% low, so drop it.
			if (delta > 0L && delta < 1_000_000_000L) {
				push(delta, now);
			}
		}
		this.lastFrameNanos = now;

		prune(now);

		if (now - this.lastRecomputeNanos >= RECOMPUTE_INTERVAL_NANOS) {
			this.lastRecomputeNanos = now;
			recompute();
		}
	}

	public void reset() {
		this.head = 0;
		this.size = 0;
		this.lastFrameNanos = -1L;
		this.average = 0.0D;
		this.onePercentLow = 0.0D;
	}

	/** Mean framerate over the window, or 0 before enough samples exist. */
	public double getAverageFps() {
		return this.average;
	}

	/** Mean framerate of the slowest 1% of frames in the window. */
	public double getOnePercentLowFps() {
		return this.onePercentLow;
	}

	public int getSampleCount() {
		return this.size;
	}

	private void push(long duration, long now) {
		int index = (this.head + this.size) % CAPACITY;
		if (this.size == CAPACITY) {
			// Full: overwrite the oldest and advance the head.
			this.durations[this.head] = duration;
			this.timestamps[this.head] = now;
			this.head = (this.head + 1) % CAPACITY;
		} else {
			this.durations[index] = duration;
			this.timestamps[index] = now;
			this.size++;
		}
	}

	private void prune(long now) {
		long cutoff = now - this.windowNanos;
		while (this.size > 0 && this.timestamps[this.head] < cutoff) {
			this.head = (this.head + 1) % CAPACITY;
			this.size--;
		}
	}

	private void recompute() {
		int n = this.size;
		if (n <= 0) {
			this.average = 0.0D;
			this.onePercentLow = 0.0D;
			return;
		}

		long total = 0L;
		long[] sorted = new long[n];
		for (int i = 0; i < n; i++) {
			long d = this.durations[(this.head + i) % CAPACITY];
			sorted[i] = d;
			total += d;
		}

		this.average = total > 0L ? (double) n * 1_000_000_000.0D / total : 0.0D;

		Arrays.sort(sorted);
		// Slowest 1% sit at the end once sorted by duration.
		int worstCount = Math.max(1, n / 100);
		long worstTotal = 0L;
		for (int i = n - worstCount; i < n; i++) {
			worstTotal += sorted[i];
		}
		this.onePercentLow = worstTotal > 0L
				? (double) worstCount * 1_000_000_000.0D / worstTotal
				: 0.0D;
	}
}
