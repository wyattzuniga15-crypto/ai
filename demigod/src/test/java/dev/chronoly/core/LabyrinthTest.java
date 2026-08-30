package dev.chronoly.core;

import dev.chronoly.core.labyrinth.MazeGraph;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

import java.util.Random;
import java.util.Set;

import static org.junit.jupiter.api.Assertions.*;

/** The roadmap's Phase 10 criteria, as far as they can be checked without a world. */
class LabyrinthTest {

    @Test
    @DisplayName("the same seed builds the same maze")
    void deterministic() {
        assertEquals(MazeGraph.generate(1234L, 60, 0.2).edges(),
                MazeGraph.generate(1234L, 60, 0.2).edges());
    }

    @Test
    @DisplayName("different seeds build different mazes")
    void seedsMatter() {
        assertNotEquals(MazeGraph.generate(1L, 60, 0.2).edges(),
                MazeGraph.generate(2L, 60, 0.2).edges());
    }

    @Test
    @DisplayName("every generated maze is connected by construction, not by luck")
    void alwaysReachable() {
        for (long seed = 0; seed < 200; seed++) {
            MazeGraph g = MazeGraph.generate(seed, 40, 0.15);
            assertTrue(g.fullyReachable(), "seed " + seed + " generated a stranded room");
        }
    }

    @Test
    @DisplayName("a shift never strands anyone: connectivity survives a thousand rearrangements")
    void shiftingPreservesReachability() {
        MazeGraph g = MazeGraph.generate(42L, 50, 0.25);
        Random rng = new Random(42L);
        Set<Integer> occupied = Set.of(7);

        for (int i = 0; i < 1000; i++) {
            g.shift(rng, occupied);
            assertTrue(g.fullyReachable(), "the maze disconnected itself on shift " + i);
        }
    }

    @Test
    @DisplayName("the maze only shifts where nobody is looking")
    void shiftsAvoidOccupiedRooms() {
        MazeGraph g = MazeGraph.generate(9L, 40, 0.2);
        Random rng = new Random(9L);
        int player = 12;
        Set<Integer> occupied = Set.of(player);

        var before = g.neighbours(player);
        for (int i = 0; i < 500; i++) g.shift(rng, occupied);
        assertEquals(before, g.neighbours(player),
                "corridors next to the player changed under their feet");
    }

    @Test
    @DisplayName("a shift with the whole maze occupied simply declines to happen")
    void nowhereSafeToShift() {
        MazeGraph g = MazeGraph.generate(5L, 10, 0.1);
        Set<Integer> everyone = Set.of(0,1,2,3,4,5,6,7,8,9);
        assertFalse(g.shift(new Random(5L), everyone));
        assertTrue(g.fullyReachable());
    }

    @Test
    @DisplayName("distance inside does not match distance outside")
    void distanceMismatch() {
        MazeGraph g = MazeGraph.generate(77L, 80, 0.1);
        double scale = 900d;   // overworld blocks per corridor

        int far = -1;
        int best = -1;
        for (int r = 0; r < g.roomCount(); r++) {
            int d = g.distance(g.entrance(), r);
            if (d > best) { best = d; far = r; }
        }
        assertTrue(best > 0);

        double outside = g.overworldDistanceFromEntrance(far, scale);
        assertTrue(outside > 3000d,
                "a short walk inside should come out a very long way away; got " + outside);
        assertTrue(best < 40, "the walk itself should stay short; took " + best + " corridors");
    }

    @Test
    @DisplayName("the exit is a function of graph distance, so it cannot be walked around")
    void exitDerivesFromGraphNotCoordinates() {
        MazeGraph g = MazeGraph.generate(3L, 30, 0.2);
        int room = 5;
        assertEquals(g.distance(g.entrance(), room) * 250d,
                g.overworldDistanceFromEntrance(room, 250d), 1e-6);
    }

    @Test
    @DisplayName("set pieces can be pinned into rooms and stay put")
    void setPieces() {
        MazeGraph g = MazeGraph.generate(11L, 20, 0.2);
        g.placeSetPiece(4, "antaeus_arena");
        assertEquals("antaeus_arena", g.setPieceAt(4));
        assertNull(g.setPieceAt(5));
    }

    @Test
    @DisplayName("a maze needs at least two rooms")
    void degenerate() {
        assertThrows(IllegalArgumentException.class, () -> MazeGraph.generate(1L, 1, 0.1));
    }
}
