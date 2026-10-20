package io.github.drukoz.gtnhplanner.projector.view;

import static org.junit.jupiter.api.Assertions.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class AimRayTest {
    static final double[] EYE = {0.5, 65.62, 0.5};
    static final double[] PLUS_X = {1, 0, 0};
    static final AimRay.Stops NONE = (x, y, z) -> false;

    static AimRay.Ghosts ghosts(Object... keyAndBlock) {
        Map<String, Integer> m = new HashMap<>();
        for (int i = 0; i < keyAndBlock.length; i += 2) m.put((String) keyAndBlock[i], (Integer) keyAndBlock[i + 1]);
        return (x, y, z) -> m.getOrDefault(x + "," + y + "," + z, -1);
    }

    static AimRay.Stops stopAt(String key) { return (x, y, z) -> key.equals(x + "," + y + "," + z); }

    static List<Integer> blocks(List<AimRay.Hit> hits) {
        List<Integer> out = new ArrayList<>();
        for (AimRay.Hit h : hits) out.add(h.block);
        return out;
    }

    static List<AimRay.Hit> walkX(AimRay.Stops stops) {
        return AimRay.walk(EYE, PLUS_X, 96, ghosts("5,65,0", 1, "8,65,0", 2), stops);
    }

    @Test void hitsAFloatingGhostFarAway() {
        List<AimRay.Hit> h = AimRay.walk(EYE, PLUS_X, 96, ghosts("40,65,0", 7), NONE);
        assertEquals(1, h.size()); assertEquals(7, h.get(0).block); assertEquals(39.5, h.get(0).distance, 1e-9);
    }

    @Test void aRealBlockStopsTheAimButItsOwnGhostCounts() {
        assertEquals(Arrays.asList(1), blocks(walkX(stopAt("5,65,0"))));
        assertEquals(Arrays.asList(1), blocks(walkX(stopAt("6,65,0"))));
        assertEquals(Arrays.asList(1, 2), blocks(walkX(NONE)));
        assertEquals(4.5, walkX(NONE).get(0).distance, 1e-9); assertEquals(7.5, walkX(NONE).get(1).distance, 1e-9);
    }

    @Test void neverGoesPastMaxDistance() {
        assertTrue(AimRay.walk(EYE, PLUS_X, 96, ghosts("100,65,0", 3), NONE).isEmpty());
        assertEquals(1, AimRay.walk(EYE, PLUS_X, 96, ghosts("96,65,0", 3), NONE).size());
    }

    @Test void skipsTheEyesOwnCell() {
        assertEquals(Arrays.asList(5), blocks(AimRay.walk(EYE, PLUS_X, 96, ghosts("0,65,0", 4, "3,65,0", 5), NONE)));
    }

    @Test void walksStraightDownAndExactDiagonals() {
        List<AimRay.Hit> down = AimRay.walk(new double[] {0.5, 70.5, 0.5}, new double[] {0, -1, 0}, 96, ghosts("0,68,0", 1, "0,66,0", 2), NONE);
        assertEquals(Arrays.asList(1, 2), blocks(down)); assertEquals(1.5, down.get(0).distance, 1e-9); assertEquals(3.5, down.get(1).distance, 1e-9);
        List<AimRay.Hit> diag = AimRay.walk(new double[] {0.5, 65.5, 0.5}, new double[] {1, 0, 1}, 96, ghosts("2,65,2", 9), NONE);
        assertEquals(Arrays.asList(9), blocks(diag)); assertEquals(1.5 * Math.sqrt(2), diag.get(0).distance, 1e-9);
    }

    @Test void aZeroLookHitsNothing() {
        assertTrue(AimRay.walk(EYE, new double[] {0, 0, 0}, 96, ghosts("1,65,0", 1), NONE).isEmpty());
    }
}
