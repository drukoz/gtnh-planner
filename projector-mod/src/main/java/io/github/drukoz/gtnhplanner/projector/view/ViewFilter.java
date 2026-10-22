package io.github.drukoz.gtnhplanner.projector.view;

import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.PlannedStep;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import java.util.Objects;

/**
 * Which planned blocks the projector shows (spec §3.13: all layers, one Y layer, or only one build step; a layer and a
 * step together show the step's blocks on that layer), and whether a block is near enough to draw. Immutable and equal
 * by value, so the renderer can tell from it whether its geometry is still right.
 */
public final class ViewFilter {

    /** Every layer and every step. */
    public static final ViewFilter ALL = new ViewFilter(null, -1);

    /** The longest step text {@link #describe} shows before it shortens it. */
    private static final int STEP_TEXT_LENGTH = 40;

    /** The one Y layer shown, or null for every layer. */
    public final Integer layerY;
    /** The index in {@link ProjectorData#steps} of the one build step shown, or −1 for every step. */
    public final int stepIndex;

    /** One layer ({@code null} = every layer) and one step index (any negative number = every step, kept as −1). */
    public ViewFilter(Integer layerY, int stepIndex) {
        this.layerY = layerY;
        this.stepIndex = stepIndex < 0 ? -1 : stepIndex;
    }

    /** The same step, on layer {@code y} ({@code null} = every layer). */
    public ViewFilter withLayer(Integer y) {
        return new ViewFilter(y, stepIndex);
    }

    /** The same layer, for the step at {@code stepIndex} (negative = every step). */
    public ViewFilter withStep(int stepIndex) {
        return new ViewFilter(layerY, stepIndex);
    }

    /** Whether it shows every block: no layer and no step. */
    public boolean isAll() {
        return layerY == null && stepIndex < 0;
    }

    /**
     * Whether the block is on the layer and built by the step, where those are set (distance aside): a step shows every
     * block it builds ({@link PlannedBlock#inStep}), a conduit bundle under the step that places it and each step that
     * lays one of its conduits ({@link PlannedBlock#partSteps}).
     */
    public boolean shows(PlannedBlock b) {
        return (layerY == null || b.y == layerY) && (stepIndex < 0 || b.inStep(stepIndex));
    }

    /** Whether the block's centre is at most {@code maxDistance} from the point (the camera), in a straight line. */
    public static boolean within(PlannedBlock b, double px, double py, double pz, double maxDistance) {
        double dx = b.x + 0.5 - px, dy = b.y + 0.5 - py, dz = b.z + 0.5 - pz;
        return dx * dx + dy * dy + dz * dz <= maxDistance * maxDistance;
    }

    /**
     * What it shows, for the HUD: {@code layer y=<y>} and {@code step <order>: <text, shortened to 40 characters>},
     * joined by {@code ", "} when both are set; {@code ""} for {@link #ALL}. A step index must be one of {@code d}'s.
     */
    public String describe(ProjectorData d) {
        StringBuilder text = new StringBuilder();
        if (layerY != null) text.append("layer y=").append(layerY);
        if (stepIndex >= 0) {
            PlannedStep step = d.steps.get(stepIndex);
            if (text.length() > 0) text.append(", ");
            text.append("step ").append(step.order).append(": ").append(HudText.shorten(step.text, STEP_TEXT_LENGTH));
        }
        return text.toString();
    }

    @Override
    public boolean equals(Object o) {
        if (!(o instanceof ViewFilter)) return false;
        ViewFilter f = (ViewFilter) o;
        return Objects.equals(layerY, f.layerY) && stepIndex == f.stepIndex;
    }

    @Override
    public int hashCode() {
        return 31 * Objects.hashCode(layerY) + stepIndex;
    }

    @Override
    public String toString() {
        return "ViewFilter{layerY=" + layerY + ", stepIndex=" + stepIndex + "}";
    }
}
