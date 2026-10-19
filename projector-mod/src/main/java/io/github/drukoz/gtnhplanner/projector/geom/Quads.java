package io.github.drukoz.gtnhplanner.projector.geom;

/**
 * The quads the ghosts are drawn with, in a block's own coordinates (its lowest corner at 0, 0, 0). Each quad is
 * 4 corners × {@code x, y, z, u, v} = 20 values, in the corner order of vanilla {@code RenderBlocks}' face methods and
 * with their texture corners, so an icon lands on a ghost face the way the game puts it on the real block. {@code u}
 * and {@code v} are fractions of the icon: 0 = its min, 1 = its max.
 */
public final class Quads {

    /** Values per corner: x, y, z, u, v. */
    private static final int STRIDE = 5;

    /** The unit cube's faces as {@code RenderBlocks} draws them unrotated, by side: 4 corners of x, y, z, u, v. */
    private static final int[][] UNIT = {
        {0, 0, 1, 0, 1, 0, 0, 0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 1, 1, 1}, // 0 down: renderFaceYNeg
        {1, 1, 1, 1, 1, 1, 1, 0, 1, 0, 0, 1, 0, 0, 0, 0, 1, 1, 0, 1}, // 1 up: renderFaceYPos
        {0, 1, 0, 1, 0, 1, 1, 0, 0, 0, 1, 0, 0, 0, 1, 0, 0, 0, 1, 1}, // 2 north: renderFaceZNeg
        {0, 1, 1, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 1, 1, 1, 1, 1, 1, 0}, // 3 south: renderFaceZPos
        {0, 1, 1, 1, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0, 1, 0, 0, 1, 1, 1}, // 4 west: renderFaceXNeg
        {1, 0, 1, 0, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 0}, // 5 east: renderFaceXPos
    };

    /** The coordinate each side's face lies across (0 = x, 1 = y, 2 = z); the other two run along the face. */
    private static final int[] ACROSS = {1, 1, 2, 2, 0, 0};

    private Quads() {}

    /**
     * The face on {@code side} of the block grown by {@code grow} on every side: every 0 becomes {@code −grow} and
     * every 1 becomes {@code 1 + grow}, so a small grow draws just outside a real block there.
     *
     * @throws IllegalArgumentException when {@code side} is not 0…5
     */
    public static double[] face(int side, double grow) {
        return marker(side, -grow, 1 + grow, grow);
    }

    /**
     * A square on the face on {@code side}, {@code out} off the block: along the face 0 becomes {@code lo} and 1
     * becomes {@code hi}, and across it the face sits where {@link #face} puts it with {@code grow = out}. The texture
     * corners are the face's, so the whole icon fills the square.
     *
     * @throws IllegalArgumentException when {@code side} is not 0…5
     */
    public static double[] marker(int side, double lo, double hi, double out) {
        if (!Facing.valid(side)) throw new IllegalArgumentException("Not a block side: " + side);
        int[] unit = UNIT[side];
        double[] quad = new double[unit.length];
        for (int i = 0; i < unit.length; i++) {
            int value = i % STRIDE; // 0 x, 1 y, 2 z, 3 u, 4 v
            boolean one = unit[i] == 1;
            if (value >= 3) quad[i] = unit[i];
            else if (value == ACROSS[side]) quad[i] = one ? 1 + out : -out;
            else quad[i] = one ? hi : lo;
        }
        return quad;
    }
}
