package io.github.drukoz.gtnhplanner.projector.view;

import java.util.ArrayList;
import java.util.List;

/** Walks a look ray cell by cell and names the ghost blocks it passes through, nearest first. */
public final class AimRay {

    private AimRay() {}

    /** The shown ghost block at a cell. */
    @FunctionalInterface
    public interface Ghosts {
        /** The block index of the shown ghost at this cell, or −1 when there is none. */
        int at(int x, int y, int z);
    }

    /** The real blocks that stop the aim. */
    @FunctionalInterface
    public interface Stops {
        /** Whether a real block at this cell stops the aim. */
        boolean at(int x, int y, int z);
    }

    /** A ghost block the ray enters, and how far along the look that happens. */
    public static final class Hit {
        public final int block;
        public final double distance;

        public Hit(int block, double distance) {
            this.block = block;
            this.distance = distance;
        }
    }

    /**
     * The ghosts along the ray from {@code eye} in direction {@code look}, nearest first. {@code distance} is how far
     * along the (normalised) look the ray enters the ghost's cell. The eye's own cell is skipped. The walk ends after
     * the first cell where {@code stops} is true (that cell's ghost still counts) and never goes past
     * {@code maxDistance}. A look of all zeros, or an eye, look or {@code maxDistance} that is not a finite number,
     * gives an empty list.
     */
    public static List<Hit> walk(double[] eye, double[] look, double maxDistance, Ghosts ghosts, Stops stops) {
        List<Hit> hits = new ArrayList<>();
        for (int a = 0; a < 3; a++) {
            if (!Double.isFinite(eye[a]) || !Double.isFinite(look[a])) return hits;
        }
        if (!Double.isFinite(maxDistance)) return hits;
        double len = Math.sqrt(look[0] * look[0] + look[1] * look[1] + look[2] * look[2]);
        if (len == 0) return hits;
        int[] cell = new int[3];
        int[] step = new int[3];
        double[] tMax = new double[3];
        double[] tDelta = new double[3];
        for (int a = 0; a < 3; a++) {
            double d = look[a] / len;
            cell[a] = (int) Math.floor(eye[a]);
            if (d > 0) {
                step[a] = 1;
                tDelta[a] = 1 / d;
                tMax[a] = (cell[a] + 1 - eye[a]) / d;
            } else if (d < 0) {
                step[a] = -1;
                tDelta[a] = -1 / d;
                tMax[a] = (cell[a] - eye[a]) / d;
            } else {
                tMax[a] = Double.POSITIVE_INFINITY;
                tDelta[a] = Double.POSITIVE_INFINITY;
            }
        }
        while (true) {
            int a = tMax[0] <= tMax[1] ? (tMax[0] <= tMax[2] ? 0 : 2) : (tMax[1] <= tMax[2] ? 1 : 2);
            double t = tMax[a];
            if (!(t <= maxDistance)) break;
            cell[a] += step[a];
            tMax[a] += tDelta[a];
            int block = ghosts.at(cell[0], cell[1], cell[2]);
            if (block >= 0) hits.add(new Hit(block, t));
            if (stops.at(cell[0], cell[1], cell[2])) break;
        }
        return hits;
    }
}
