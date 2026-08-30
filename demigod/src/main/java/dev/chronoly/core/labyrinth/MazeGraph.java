package dev.chronoly.core.labyrinth;

import java.util.ArrayDeque;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Deque;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.random.RandomGenerator;

/**
 * The Labyrinth, as a graph.
 *
 * <p>The Battle of the Labyrinth — the maze is alive, it rearranges, and distance inside it has
 * nothing to do with distance outside it.
 *
 * <p>The architectural bet: <b>the graph is the truth and the chunks are a rendering of it.</b>
 * Generation realises the graph into blocks; it never reads the graph back out of blocks. That is
 * what makes shifting corridors tractable — a shift is an edge rewrite plus a re-realise of two
 * chunks, not a search of the world for walls to move.
 */
public final class MazeGraph {

    private final int roomCount;
    private final Set<Long> edges = new LinkedHashSet<>();
    private final String[] setPiece;
    private final int entrance;

    private MazeGraph(int roomCount, int entrance) {
        this.roomCount = roomCount;
        this.entrance = entrance;
        this.setPiece = new String[roomCount];
    }

    public int roomCount() { return roomCount; }

    public int entrance() { return entrance; }

    public String setPieceAt(int room) { return setPiece[room]; }

    public void placeSetPiece(int room, String id) { setPiece[room] = id; }

    public Set<Long> edges() { return Set.copyOf(edges); }

    private static long key(int a, int b) {
        int lo = Math.min(a, b), hi = Math.max(a, b);
        return ((long) lo << 32) | (hi & 0xFFFFFFFFL);
    }

    public boolean connected(int a, int b) { return edges.contains(key(a, b)); }

    public void link(int a, int b) { if (a != b) edges.add(key(a, b)); }

    public void unlink(int a, int b) { edges.remove(key(a, b)); }

    public List<Integer> neighbours(int room) {
        List<Integer> out = new ArrayList<>();
        for (int other = 0; other < roomCount; other++) {
            if (other != room && connected(room, other)) out.add(other);
        }
        return out;
    }

    /**
     * Builds a maze from a seed. Deterministic: the same seed yields the same maze on every server
     * and every client, which is what lets the generator be reproduced rather than synchronised.
     *
     * <p>A random spanning tree first (so it is connected by construction, never by luck), then
     * extra edges for loops — a pure tree maze has exactly one route everywhere and reads as a
     * puzzle rather than as a place.
     */
    public static MazeGraph generate(long seed, int roomCount, double loopiness) {
        if (roomCount < 2) throw new IllegalArgumentException("a maze needs at least two rooms");
        RandomGenerator rng = new java.util.Random(seed);
        MazeGraph g = new MazeGraph(roomCount, 0);

        List<Integer> placed = new ArrayList<>();
        List<Integer> pending = new ArrayList<>();
        for (int i = 0; i < roomCount; i++) pending.add(i);

        placed.add(pending.remove(rng.nextInt(pending.size())));
        while (!pending.isEmpty()) {
            int next = pending.remove(rng.nextInt(pending.size()));
            int anchor = placed.get(rng.nextInt(placed.size()));
            g.link(anchor, next);
            placed.add(next);
        }

        int extra = (int) Math.round(roomCount * loopiness);
        for (int i = 0; i < extra; i++) {
            int a = rng.nextInt(roomCount), b = rng.nextInt(roomCount);
            if (a != b) g.link(a, b);
        }
        return g;
    }

    /** Shortest number of corridors between two rooms, or -1 if there is no route. */
    public int distance(int from, int to) {
        if (from == to) return 0;
        int[] dist = new int[roomCount];
        Arrays.fill(dist, -1);
        dist[from] = 0;
        Deque<Integer> queue = new ArrayDeque<>();
        queue.add(from);
        while (!queue.isEmpty()) {
            int cur = queue.poll();
            for (int n : neighbours(cur)) {
                if (dist[n] == -1) {
                    dist[n] = dist[cur] + 1;
                    if (n == to) return dist[n];
                    queue.add(n);
                }
            }
        }
        return -1;
    }

    /** Every room reachable from the entrance. A maze that fails this has stranded somebody. */
    public boolean fullyReachable() {
        for (int r = 0; r < roomCount; r++) {
            if (distance(entrance, r) < 0) return false;
        }
        return true;
    }

    /**
     * Rearranges one corridor behind the player's back.
     *
     * <p>Two invariants, both enforced here rather than trusted:
     * <ul>
     *   <li>never touch a room that is occupied or adjacent to an occupied one — the maze shifts
     *       where nobody is looking, which is both the lore and the only way to avoid rewriting
     *       blocks under someone's feet;</li>
     *   <li>never disconnect anything — a rewrite that strands a room is rolled back. The maze is
     *       malevolent, not broken, and there is a difference.</li>
     * </ul>
     *
     * @return true if the maze actually changed
     */
    public boolean shift(RandomGenerator rng, Set<Integer> occupied) {
        Set<Integer> frozen = new HashSet<>(occupied);
        for (int room : occupied) frozen.addAll(neighbours(room));

        List<Long> candidates = new ArrayList<>();
        for (long e : edges) {
            int a = (int) (e >> 32), b = (int) (e & 0xFFFFFFFFL);
            if (!frozen.contains(a) && !frozen.contains(b)) candidates.add(e);
        }
        if (candidates.isEmpty()) return false;

        long victim = candidates.get(rng.nextInt(candidates.size()));
        int va = (int) (victim >> 32), vb = (int) (victim & 0xFFFFFFFFL);

        for (int attempt = 0; attempt < 16; attempt++) {
            int na = rng.nextInt(roomCount), nb = rng.nextInt(roomCount);
            if (na == nb || frozen.contains(na) || frozen.contains(nb)) continue;
            if (connected(na, nb)) continue;

            edges.remove(victim);
            link(na, nb);
            if (fullyReachable()) return true;

            unlink(na, nb);           // roll back: it stranded something
            edges.add(victim);
        }
        return false;
    }

    /**
     * The distance mismatch. The Battle of the Labyrinth, ch. 9 — a few minutes' walk inside comes
     * out on the other side of the country.
     *
     * <p>The overworld exit is a function of <em>graph</em> distance from the entrance, never of
     * the player's coordinates inside the dimension. So the mismatch is not a fudge applied at the
     * door; it is the only relationship that ever existed between the two spaces.
     *
     * @param room  where the player is leaving from
     * @param scale overworld blocks per corridor traversed
     */
    public double overworldDistanceFromEntrance(int room, double scale) {
        int hops = distance(entrance, room);
        if (hops < 0) throw new IllegalStateException("room " + room + " is not reachable from the entrance");
        return hops * scale;
    }
}
