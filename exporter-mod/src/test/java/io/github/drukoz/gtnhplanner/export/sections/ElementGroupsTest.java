package io.github.drukoz.gtnhplanner.export.sections;

import static org.junit.jupiter.api.Assertions.assertArrayEquals;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.Arrays;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.junit.jupiter.api.Test;

class ElementGroupsTest {

    private static final Object A = new Object(), B = new Object(), C = new Object();

    /** The key of {@link ElementGroups#key} computed in int arithmetic, without its long casts. */
    private static long intKey(int x, int y, int z) {
        return ((x & 0x3FFFFFF) << 34) | ((y & 0xFF) << 26) | (z & 0x3FFFFFF);
    }

    /** Six blocks visited (0, a), (1, b), (2, a), (3, a), (3, b), (1, b), (5, c); block 4 is never visited. */
    private static ElementGroups.Visits walk(Object a, Object b, Object c) {
        ElementGroups.Visits v = new ElementGroups.Visits(6);
        v.visit(0, a);
        v.visit(1, b);
        v.visit(2, a);
        v.visit(3, a);
        v.visit(3, b);
        v.visit(1, b);
        v.visit(5, c);
        return v;
    }

    @Test
    void neighbouringCellsHaveDifferentKeys() {
        Set<Long> keys = new HashSet<>(
            Arrays.asList(
                ElementGroups.key(8192, 128, 8192),
                ElementGroups.key(8193, 128, 8192),
                ElementGroups.key(8192, 129, 8192),
                ElementGroups.key(8192, 128, 8193),
                ElementGroups.key(-5, 0, -5)));
        assertEquals(5, keys.size());
    }

    @Test
    void keysStayApartWhereIntShiftsWouldMakeThemCollide() {
        int[][][] pairs = { { { 1, 0, 0 }, { 0, 0, 4 } }, // << 34 of an int is << 2
            { { 0, 64, 0 }, { 0, 0, 0 } }, // 64 << 26 overflows an int
            { { 0, 128, 0 }, { 0, 0, 0 } }, { { 8192, 64, 8192 }, { 8192, 192, 8192 } } };
        for (int[][] pair : pairs) {
            int[] a = pair[0], b = pair[1];
            String cells = Arrays.toString(a) + " / " + Arrays.toString(b);
            assertEquals(intKey(a[0], a[1], a[2]), intKey(b[0], b[1], b[2]), "int keys collide: " + cells);
            assertNotEquals(ElementGroups.key(a[0], a[1], a[2]), ElementGroups.key(b[0], b[1], b[2]), cells);
        }
    }

    @Test
    void aBlockTwoElementsCheckedBelongsToNeither() {
        ElementGroups.Visits v = walk(A, B, C);
        assertSame(A, v.elementAt(0));
        assertSame(B, v.elementAt(1));
        assertSame(A, v.elementAt(2));
        assertNull(v.elementAt(3));
        assertNull(v.elementAt(4));
        assertSame(C, v.elementAt(5));
        assertEquals(1, v.conflicts());
        assertEquals(5, v.visited());

        v.visit(3, C); // a third element on the conflict, then the first one again: still one conflict
        v.visit(3, A);
        assertNull(v.elementAt(3));
        assertEquals(1, v.conflicts());
        assertEquals(5, v.visited());
    }

    @Test
    void groupsComeInTheOrderOfTheirFirstBlockAndLeaveOutTheController() {
        List<ElementGroups.Group> groups = ElementGroups.groups(walk(A, B, C), 5); // C only on the controller
        assertEquals(2, groups.size());
        assertSame(A, groups.get(0).element);
        assertArrayEquals(new int[] { 0, 2 }, groups.get(0).blocks);
        assertSame(B, groups.get(1).element);
        assertArrayEquals(new int[] { 1 }, groups.get(1).blocks);

        ElementGroups.Visits late = new ElementGroups.Visits(3); // B is visited first, but on a later block
        late.visit(2, B);
        late.visit(0, A);
        List<ElementGroups.Group> byBlock = ElementGroups.groups(late, -1);
        assertEquals(2, byBlock.size());
        assertSame(A, byBlock.get(0).element);
        assertSame(B, byBlock.get(1).element);
    }

    @Test
    void aGroupIsProbedOnItsFirstBlockWithoutATileEntity() {
        ElementGroups.Group a = ElementGroups.groups(walk(A, B, C), 5)
            .get(0);
        assertEquals(2, ElementGroups.probeBlock(a, new boolean[] { true, false, false, false, false, false }));
        boolean[] everywhere = new boolean[6];
        Arrays.fill(everywhere, true);
        assertEquals(0, ElementGroups.probeBlock(a, everywhere));
    }

    @Test
    void twoWalksGroupAlikeWhenTheirGroupsHoldTheSameBlocks() {
        List<ElementGroups.Group> first = ElementGroups.groups(walk(A, B, C), 5);
        Object a2 = new Object(), b2 = new Object(), c2 = new Object();
        assertTrue(ElementGroups.sameGroups(first, ElementGroups.groups(walk(a2, b2, c2), 5)));

        ElementGroups.Visits moved = new ElementGroups.Visits(6); // block 2 visited by b2 instead of a2
        moved.visit(0, a2);
        moved.visit(1, b2);
        moved.visit(2, b2);
        moved.visit(3, a2);
        moved.visit(3, b2);
        moved.visit(1, b2);
        moved.visit(5, c2);
        List<ElementGroups.Group> movedGroups = ElementGroups.groups(moved, 5);
        assertArrayEquals(new int[] { 0 }, movedGroups.get(0).blocks);
        assertArrayEquals(new int[] { 1, 2 }, movedGroups.get(1).blocks);
        assertFalse(ElementGroups.sameGroups(first, movedGroups));

        ElementGroups.Visits wider = walk(a2, b2, c2); // block 4 also visited, by a2
        wider.visit(4, a2);
        assertFalse(ElementGroups.sameGroups(first, ElementGroups.groups(wider, 5)));
    }
}
