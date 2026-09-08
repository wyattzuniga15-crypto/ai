package dev.potatoclient.tracker;

/** Counts clicks in the trailing second for one mouse button. */
public final class CpsTracker {
	private static final int CAPACITY = 128;
	private static final long WINDOW_NANOS = 1_000_000_000L;

	private final long[] clicks = new long[CAPACITY];
	private int head;
	private int size;

	public void onClick() {
		long now = System.nanoTime();
		prune(now);

		if (this.size == CAPACITY) {
			// Nobody clicks 128 times a second; drop the oldest rather than grow.
			this.head = (this.head + 1) % CAPACITY;
			this.size--;
		}
		this.clicks[(this.head + this.size) % CAPACITY] = now;
		this.size++;
	}

	public int getCps() {
		prune(System.nanoTime());
		return this.size;
	}

	public void reset() {
		this.head = 0;
		this.size = 0;
	}

	private void prune(long now) {
		long cutoff = now - WINDOW_NANOS;
		while (this.size > 0 && this.clicks[this.head] < cutoff) {
			this.head = (this.head + 1) % CAPACITY;
			this.size--;
		}
	}
}
