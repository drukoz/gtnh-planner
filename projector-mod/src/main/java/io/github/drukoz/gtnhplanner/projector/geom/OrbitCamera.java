package io.github.drukoz.gtnhplanner.projector.geom;

/**
 * The planner screen's camera (spec §2.4 of the aim and screen design): it circles a target point, as the planner's 3D
 * tab does. The eye sits {@code distance} blocks from the target, turned {@code yaw} degrees around the vertical
 * (0 = south of the target, 90 = east) and raised {@code pitch} degrees (kept within −89…89, so it never looks straight
 * down and its right stays level). World coordinates throughout, y up. Not thread-safe; used on the game thread.
 */
public final class OrbitCamera {

    private static final double START_YAW = 45, START_PITCH = 30;
    private static final double MAX_PITCH = 89;
    private static final double MIN_DISTANCE = 2, MAX_DISTANCE = 256;
    /** Each wheel step towards the line multiplies the distance by this. */
    private static final double ZOOM_STEP = 0.9;

    private final double[] target;
    private double yaw, pitch, distance;

    private OrbitCamera(double[] target, double yaw, double pitch, double distance) {
        this.target = target;
        this.yaw = yaw;
        this.pitch = pitch;
        this.distance = distance;
    }

    /**
     * A camera looking at the middle of the line whose lowest corner is {@code origin} and whose size is {@code size}
     * (each {x, y, z}): from yaw 45° and pitch 30°, at twice the longest side plus 4 blocks (at most 256).
     */
    public static OrbitCamera framing(int[] origin, int[] size) {
        double[] middle = new double[3];
        int longest = 0;
        for (int a = 0; a < 3; a++) {
            middle[a] = origin[a] + size[a] / 2.0;
            longest = Math.max(longest, size[a]);
        }
        return new OrbitCamera(middle, START_YAW, START_PITCH, clampDistance(2.0 * longest + 4));
    }

    /** The point the camera circles and looks at; a copy. */
    public double[] target() {
        return target.clone();
    }

    /** Where the camera is: {@code target + distance · (cos pitch · sin yaw, sin pitch, cos pitch · cos yaw)}; a copy. */
    public double[] eye() {
        double[] back = back();
        return new double[] {
            target[0] + distance * back[0], target[1] + distance * back[1], target[2] + distance * back[2]};
    }

    /** How far the eye is from the target, in blocks. */
    public double distance() {
        return distance;
    }

    /** Circles the target by {@code yawDegrees} and raises the eye by {@code pitchDegrees}; the pitch stays within −89…89. */
    public void turn(double yawDegrees, double pitchDegrees) {
        yaw = (yaw + yawDegrees) % 360;
        pitch = Math.max(-MAX_PITCH, Math.min(MAX_PITCH, pitch + pitchDegrees));
    }

    /** Moves in by {@code wheelSteps} (out when negative): the distance × 0.9 per step, kept within 2…256. */
    public void zoom(int wheelSteps) {
        distance = clampDistance(distance * Math.pow(ZOOM_STEP, wheelSteps));
    }

    /** Moves the target (and the eye with it) {@code rightBlocks} along the camera's right and {@code upBlocks} along its up. */
    public void pan(double rightBlocks, double upBlocks) {
        double[] right = right(), up = up();
        for (int a = 0; a < 3; a++) target[a] += right[a] * rightBlocks + up[a] * upBlocks;
    }

    /**
     * The view transform as a column-major 4×4 matrix for {@code glMultMatrix}: it sends {@link #eye()} to the origin
     * and {@link #target()} to (0, 0, −distance), with the camera's right along +x and its up along +y. Its entries are
     * floats, so far from the world's centre a point lands within float precision (about 1e-5 block at 250 blocks).
     */
    public float[] viewMatrix() {
        double[] right = right(), up = up(), back = back(), eye = eye();
        double[][] rows = {right, up, back};
        float[] m = new float[16];
        for (int row = 0; row < 3; row++) {
            double[] axis = rows[row];
            m[row] = (float) axis[0];
            m[4 + row] = (float) axis[1];
            m[8 + row] = (float) axis[2];
            m[12 + row] = (float) -(axis[0] * eye[0] + axis[1] * eye[1] + axis[2] * eye[2]);
        }
        m[15] = 1;
        return m;
    }

    /**
     * The unit direction from {@link #eye()} through the point of the view at {@code ndcX, ndcY} (each −1…1 from edge to
     * edge, y up) for a perspective of {@code fovYDegrees} from the bottom edge to the top and width / height
     * {@code aspect}.
     */
    public double[] ray(double ndcX, double ndcY, double fovYDegrees, double aspect) {
        double tanHalf = Math.tan(Math.toRadians(fovYDegrees / 2));
        double x = ndcX * tanHalf * aspect, y = ndcY * tanHalf;
        double[] right = right(), up = up(), back = back();
        double[] d = new double[3];
        for (int a = 0; a < 3; a++) d[a] = -back[a] + right[a] * x + up[a] * y;
        double length = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
        for (int a = 0; a < 3; a++) d[a] /= length;
        return d;
    }

    /** The unit vector from the target to the eye (the camera looks the other way). */
    private double[] back() {
        double y = Math.toRadians(yaw), p = Math.toRadians(pitch);
        return new double[] {Math.cos(p) * Math.sin(y), Math.sin(p), Math.cos(p) * Math.cos(y)};
    }

    /** The camera's right: level, across the view. */
    private double[] right() {
        double y = Math.toRadians(yaw);
        return new double[] {Math.cos(y), 0, -Math.sin(y)};
    }

    /** The camera's up: square to its right and its look, leaning towards the world's up. */
    private double[] up() {
        double y = Math.toRadians(yaw), p = Math.toRadians(pitch);
        return new double[] {-Math.sin(p) * Math.sin(y), Math.cos(p), -Math.sin(p) * Math.cos(y)};
    }

    private static double clampDistance(double d) {
        return Math.max(MIN_DISTANCE, Math.min(MAX_DISTANCE, d));
    }
}
