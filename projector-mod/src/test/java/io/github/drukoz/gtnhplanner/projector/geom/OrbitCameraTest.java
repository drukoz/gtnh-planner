package io.github.drukoz.gtnhplanner.projector.geom;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class OrbitCameraTest {
    static OrbitCamera line() { return OrbitCamera.framing(new int[] {99, 64, 200}, new int[] {7, 2, 4}); }

    static double[] minus(double[] a, double[] b) { return new double[] {a[0] - b[0], a[1] - b[1], a[2] - b[2]}; }
    static double dot(double[] a, double[] b) { return a[0] * b[0] + a[1] * b[1] + a[2] * b[2]; }
    static double length(double[] a) { return Math.sqrt(dot(a, a)); }
    static double[] normalise(double[] a) { double l = length(a); return new double[] {a[0] / l, a[1] / l, a[2] / l}; }
    static double degreesBetween(double[] a, double[] b) { return Math.toDegrees(Math.acos(dot(a, b) / (length(a) * length(b)))); }

    /** The column-major 4×4 matrix applied to the point (x, y, z, 1). */
    static double[] apply(float[] m, double[] p) {
        double[] out = new double[3];
        for (int row = 0; row < 3; row++) out[row] = m[row] * p[0] + m[4 + row] * p[1] + m[8 + row] * p[2] + m[12 + row];
        return out;
    }

    @Test void framesTheLine() {
        OrbitCamera c = OrbitCamera.framing(new int[] {99, 64, 200}, new int[] {7, 2, 4});
        assertArrayEquals(new double[] {102.5, 65, 202}, c.target(), 1e-9);
        assertEquals(18, c.distance(), 1e-9);
        double h = 18 * Math.cos(Math.toRadians(30)) * Math.sin(Math.toRadians(45));
        assertArrayEquals(new double[] {102.5 + h, 65 + 9, 202 + h}, c.eye(), 1e-9);
    }

    @Test void theCentreRayLooksAtTheTarget() {
        OrbitCamera c = line();
        assertArrayEquals(normalise(minus(c.target(), c.eye())), c.ray(0, 0, 70, 1.5), 1e-9);
    }

    @Test void theEdgeRayMatchesTheFieldOfView() {
        OrbitCamera c = line();
        double[] centre = c.ray(0, 0, 70, 1.5);
        assertEquals(1, length(c.ray(0, 1, 70, 1.5)), 1e-9);
        assertEquals(35, degreesBetween(centre, c.ray(0, 1, 70, 1.5)), 1e-9);
        assertEquals(Math.toDegrees(Math.atan(Math.tan(Math.toRadians(35)) * 1.5)), degreesBetween(centre, c.ray(1, 0, 70, 1.5)), 1e-9);
        assertTrue(c.ray(0, 1, 70, 1.5)[1] > centre[1], "up on the view is up in the world");
    }

    @Test void viewMatrixPutsTheEyeAtTheOriginAndTheTargetAhead() {
        OrbitCamera c = line();
        float[] m = c.viewMatrix();
        assertEquals(16, m.length);
        // float entries: at coordinates near 250 one float step is 1.5e-5, so 1e-6 only holds near the world's centre
        assertArrayEquals(new double[] {0, 0, 0}, apply(m, c.eye()), 1e-5);
        assertArrayEquals(new double[] {0, 0, -c.distance()}, apply(m, c.target()), 1e-5);
        assertArrayEquals(new float[] {0, 0, 0, 1}, new float[] {m[3], m[7], m[11], m[15]}, 0f);
    }

    @Test void viewMatrixPutsTheEyeAtTheOriginAndTheTargetAheadNearTheOrigin() {
        OrbitCamera c = OrbitCamera.framing(new int[] {-3, 1, 2}, new int[] {2, 2, 2});
        c.turn(30, -50);
        float[] m = c.viewMatrix();
        assertArrayEquals(new double[] {0, 0, 0}, apply(m, c.eye()), 1e-6);
        assertArrayEquals(new double[] {0, 0, -c.distance()}, apply(m, c.target()), 1e-6);
    }

    @Test void turningZoomingAndPanningStayInRange() {
        OrbitCamera c = line();
        c.turn(0, 200);
        assertEquals(18 * Math.sin(Math.toRadians(89)), c.eye()[1] - c.target()[1], 1e-9);
        c.turn(0, -400);
        assertEquals(-18 * Math.sin(Math.toRadians(89)), c.eye()[1] - c.target()[1], 1e-9);
        c.zoom(100);
        assertEquals(2, c.distance(), 1e-9);
        c.zoom(-100);
        assertEquals(256, c.distance(), 1e-9);
        c.zoom(1);
        assertEquals(256 * 0.9, c.distance(), 1e-9);

        OrbitCamera p = line();
        double[] before = p.target(), centre = p.ray(0, 0, 70, 1.5), right = p.ray(1, 0, 70, 1);
        // the camera's right: the right edge ray without its part along the centre ray
        double along = dot(right, centre);
        double[] rightAxis = normalise(minus(right, new double[] {centre[0] * along, centre[1] * along, centre[2] * along}));
        p.pan(1, 0);
        double[] moved = minus(p.target(), before);
        assertArrayEquals(rightAxis, moved, 1e-9);
        assertEquals(0, moved[1], 1e-9);
        assertEquals(18, p.distance(), 1e-9);
        assertEquals(18, length(minus(p.eye(), p.target())), 1e-9);
    }

    @Test void panningUpMovesAlongTheCamerasUp() {
        OrbitCamera p = line();
        double[] before = p.target(), centre = p.ray(0, 0, 70, 1.5), up = p.ray(0, 1, 70, 1.5);
        p.pan(0, 2);
        double[] moved = minus(p.target(), before);
        assertEquals(2, length(moved), 1e-9);
        assertEquals(0, dot(moved, centre), 1e-9);
        assertTrue(dot(moved, up) > 0);
    }

    @Test void aBigLineIsFramedAtTheFarthestZoom() {
        assertEquals(256, OrbitCamera.framing(new int[] {0, 0, 0}, new int[] {200, 10, 10}).distance(), 1e-9);
    }

    @Test void theAccessorsAreCopies() {
        OrbitCamera c = line();
        c.target()[0] = 0;
        c.eye()[0] = 0;
        assertEquals(102.5, c.target()[0], 1e-9);
    }
}
