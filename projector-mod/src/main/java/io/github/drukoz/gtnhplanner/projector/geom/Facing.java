package io.github.drukoz.gtnhplanner.projector.geom;

/**
 * Block sides as ForgeDirection numbers, the planner's numbering for fronts and cover faces: down 0, up 1,
 * north 2 (−z), south 3 (+z), west 4 (−x), east 5 (+x). Any other number is no side, like ForgeDirection's
 * {@code UNKNOWN}.
 */
public final class Facing {

    /** The sides' names for the player, by number. */
    public static final String[] NAMES = {"down", "up", "north", "south", "west", "east"};

    /** The step from a block to its neighbour on each side, as {dx, dy, dz}. */
    private static final int[][] OFFSETS = {{0, -1, 0}, {0, 1, 0}, {0, 0, -1}, {0, 0, 1}, {-1, 0, 0}, {1, 0, 0}};

    private Facing() {}

    /** Whether {@code side} is a side: 0…5. */
    public static boolean valid(int side) {
        return side >= 0 && side < OFFSETS.length;
    }

    /** The side across the block (down/up, north/south, west/east): {@code side ^ 1}, so no side stays no side. */
    public static int opposite(int side) {
        return side ^ 1;
    }

    /** The side's name, for example {@code south}; {@code unknown} when it is no side. */
    public static String name(int side) {
        return valid(side) ? NAMES[side] : "unknown";
    }

    /** A new {dx, dy, dz} from a block to its neighbour on that side; {0, 0, 0} when it is no side. */
    public static int[] offset(int side) {
        return valid(side) ? OFFSETS[side].clone() : new int[3];
    }
}
