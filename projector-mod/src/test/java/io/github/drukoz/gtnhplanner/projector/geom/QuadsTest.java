package io.github.drukoz.gtnhplanner.projector.geom;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class QuadsTest {
    @Test void topFaceUsesVanillaCornerOrder() {
        assertArrayEquals(new double[] {1, 1, 1, 1, 1,  1, 1, 0, 1, 0,  0, 1, 0, 0, 0,  0, 1, 1, 0, 1}, Quads.face(1, 0), 1e-9);
    }
    @Test void grownNorthFaceSitsJustOutsideTheBlock() {
        assertArrayEquals(new double[] {-0.01, 1.01, -0.01, 1, 0,  1.01, 1.01, -0.01, 0, 0,  1.01, -0.01, -0.01, 0, 1,  -0.01, -0.01, -0.01, 1, 1}, Quads.face(2, 0.01), 1e-9);
    }
    @Test void coverMarkerIsASquareOnItsFace() {
        assertArrayEquals(new double[] {0.25, 0.75, 1.02, 0, 0,  0.25, 0.25, 1.02, 0, 1,  0.75, 0.25, 1.02, 1, 1,  0.75, 0.75, 1.02, 1, 0}, Quads.marker(3, 0.25, 0.75, 0.02), 1e-9);
    }
    @Test void facingHelpers() {
        assertEquals("south", Facing.name(3)); assertEquals("unknown", Facing.name(6));
        assertEquals(2, Facing.opposite(3)); assertArrayEquals(new int[] {1, 0, 0}, Facing.offset(5));
        assertFalse(Facing.valid(-1));
    }

    // Beyond the brief: the whole corner table, grow and markers on every side, the facing helpers on every side.

    /** The plan's corner table row for row: per side, 4 corners of "x,y,z · u,v". */
    static final String[] TABLE = {
        "0,0,1 · 0,1 | 0,0,0 · 0,0 | 1,0,0 · 1,0 | 1,0,1 · 1,1",    // 0 down
        "1,1,1 · 1,1 | 1,1,0 · 1,0 | 0,1,0 · 0,0 | 0,1,1 · 0,1",    // 1 up
        "0,1,0 · 1,0 | 1,1,0 · 0,0 | 1,0,0 · 0,1 | 0,0,0 · 1,1",    // 2 north
        "0,1,1 · 0,0 | 0,0,1 · 0,1 | 1,0,1 · 1,1 | 1,1,1 · 1,0",    // 3 south
        "0,1,1 · 1,0 | 0,1,0 · 0,0 | 0,0,0 · 0,1 | 0,0,1 · 1,1",    // 4 west
        "1,0,1 · 0,1 | 1,0,0 · 1,1 | 1,1,0 · 1,0 | 1,1,1 · 0,0"};   // 5 east
    private static double[] unit(int side) { String[] n = TABLE[side].split("[^01]+"); double[] r = new double[n.length]; for (int i = 0; i < n.length; i++) r[i] = Double.parseDouble(n[i]); return r; }

    @Test void everyFaceFollowsTheVanillaCornerTable() {
        for (int side = 0; side < 6; side++) assertArrayEquals(unit(side), Quads.face(side, 0), 1e-9, "side " + side);
    }

    @Test void growAndMarkersMoveEveryCornerByTheRuleOnEverySide() {
        for (int side = 0; side < 6; side++) {
            double[] u = unit(side), grown = Quads.face(side, 0.25), mark = Quads.marker(side, 0.15, 0.85, 0.012);
            int own = -1;   // the face's own coordinate: the one that is the same at all four corners
            for (int c = 0; c < 3; c++) if (u[c] == u[5 + c] && u[c] == u[10 + c] && u[c] == u[15 + c]) own = c;
            for (int i = 0; i < 20; i++) {
                int c = i % 5; boolean one = u[i] == 1;
                assertEquals(c >= 3 ? u[i] : one ? 1.25 : -0.25, grown[i], 1e-9, "grown side " + side + ", value " + i);
                assertEquals(c >= 3 ? u[i] : c == own ? (one ? 1.012 : -0.012) : (one ? 0.85 : 0.15), mark[i], 1e-9, "marker side " + side + ", value " + i);
            }
        }
    }

    @Test void onlyTheSixSidesHaveQuads() {
        assertThrows(IllegalArgumentException.class, () -> Quads.face(6, 0));
        assertThrows(IllegalArgumentException.class, () -> Quads.marker(-1, 0.25, 0.75, 0.02));
    }

    @Test void facingHelpersOnEverySide() {
        assertArrayEquals(new String[] {"down", "up", "north", "south", "west", "east"}, Facing.NAMES);
        int[][] offsets = {{0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}, {-1, 0, 0}, {1, 0, 0}};
        int[] opposites = {1, 0, 3, 2, 5, 4};
        for (int side = 0; side < 6; side++) {
            assertTrue(Facing.valid(side)); assertEquals(Facing.NAMES[side], Facing.name(side));
            assertEquals(opposites[side], Facing.opposite(side)); assertArrayEquals(offsets[side], Facing.offset(side), "side " + side);
        }
        assertFalse(Facing.valid(6)); assertEquals("unknown", Facing.name(-1));
        assertArrayEquals(new int[] {0, 0, 0}, Facing.offset(-1)); assertArrayEquals(new int[] {0, 0, 0}, Facing.offset(6));
        Facing.offset(5)[0] = 9; assertArrayEquals(new int[] {1, 0, 0}, Facing.offset(5));   // each call gives a new array
    }
}
