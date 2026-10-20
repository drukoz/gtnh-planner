package io.github.drukoz.gtnhplanner.export.sections;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

/**
 * Which element of a structure definition checked which recorded block of a built multiblock, as StructureLib's
 * instrument reports every cell a structure check walks (gt-mechanics.md §5.5): the groups of blocks one element
 * checked, the block a group is probed on and whether two walks grouped the blocks alike. An element is any object,
 * compared by identity. Free of GregTech, StructureLib and Minecraft classes, so JUnit can test it.
 */
final class ElementGroups {

    private ElementGroups() {}

    /**
     * A 60-bit key of a world cell (x in bits 34–59, y in 26–33, z in 0–25), distinct for every x and z from −2^25 to
     * 2^25 − 1 and y from 0 to 255, in long arithmetic — exactly
     * {@code ((long) (x & 0x3FFFFFF) << 34) | ((long) (y & 0xFF) << 26) | (z & 0x3FFFFFF)}: written without the casts,
     * Java shifts an int by the distance's low 5 bits only ({@code << 34} is {@code << 2}) and {@code (y & 0xFF) << 26}
     * overflows for y ≥ 64, so keys would collide.
     */
    static long key(int x, int y, int z) {
        return ((long) (x & 0x3FFFFFF) << 34) | ((long) (y & 0xFF) << 26) | (z & 0x3FFFFFF);
    }

    /**
     * Which element checked each recorded block ({@code 0 … blocks − 1}) during one walk. A block that two different
     * elements checked is a conflict and belongs to neither.
     */
    static final class Visits {

        /** The first element that checked each block; {@code null} for a block no element checked. */
        private final Object[] first;
        private final boolean[] conflict;
        private int visited;
        private int conflicts;

        Visits(int blocks) {
            first = new Object[blocks];
            conflict = new boolean[blocks];
        }

        /** {@code element} checked {@code block}; the same element again changes nothing, and a null one is no visit. */
        void visit(int block, Object element) {
            if (element == null) return;
            Object seen = first[block];
            if (seen == null) {
                first[block] = element;
                visited++;
            } else if (seen != element && !conflict[block]) {
                conflict[block] = true;
                conflicts++;
            }
        }

        /** The element that checked {@code block}; {@code null} when none did, or when two did. */
        Object elementAt(int block) {
            return conflict[block] ? null : first[block];
        }

        /** Blocks checked at least once, conflicts included. */
        int visited() {
            return visited;
        }

        /** Whether some element checked {@code block}, a conflict included. */
        boolean visited(int block) {
            return first[block] != null;
        }

        /** Blocks checked by two or more elements. */
        int conflicts() {
            return conflicts;
        }
    }

    /** The blocks one element checked. */
    static final class Group {

        final Object element;
        /** Ascending. */
        final int[] blocks;

        Group(Object element, int[] blocks) {
            this.element = element;
            this.blocks = blocks;
        }
    }

    /**
     * One group per element, ordered by its first block, so no hash order reaches the export; block {@code skip} (the
     * controller's) belongs to none, and neither does a conflict.
     */
    static List<Group> groups(Visits visits, int skip) {
        Map<Object, List<Integer>> blocksOf = new IdentityHashMap<>();
        List<Object> elements = new ArrayList<>();
        for (int b = 0; b < visits.first.length; b++) {
            Object element = b == skip ? null : visits.elementAt(b);
            if (element == null) continue;
            List<Integer> blocks = blocksOf.get(element);
            if (blocks == null) {
                blocks = new ArrayList<>();
                blocksOf.put(element, blocks);
                elements.add(element);
            }
            blocks.add(b);
        }
        List<Group> groups = new ArrayList<>(elements.size());
        for (Object element : elements) {
            List<Integer> blocks = blocksOf.get(element);
            int[] ascending = new int[blocks.size()];
            for (int i = 0; i < ascending.length; i++) ascending[i] = blocks.get(i);
            groups.add(new Group(element, ascending));
        }
        return groups;
    }

    /**
     * The block a group is probed on: its first block that held no tile entity when it was recorded ({@code tile[b]}
     * false), else its first block. Restoring a cell re-places only block, meta and GT machine id, so a cell without a
     * tile entity is the one a restore gives back exactly.
     */
    static int probeBlock(Group group, boolean[] tile) {
        for (int b : group.blocks) {
            if (!tile[b]) return b;
        }
        return group.blocks[0];
    }

    /**
     * Whether two walks grouped the blocks alike: as many groups, each with the same blocks (the elements may be other
     * instances).
     */
    static boolean sameGroups(List<Group> a, List<Group> b) {
        if (a.size() != b.size()) return false;
        for (int g = 0; g < a.size(); g++) {
            if (!Arrays.equals(a.get(g).blocks, b.get(g).blocks)) return false;
        }
        return true;
    }
}
