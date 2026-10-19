package io.github.drukoz.gtnhplanner.projector.model;

import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;

/**
 * A project's line as the projector shows it (spec §3.13): the planner's {@code GET /api/projects/:id/projector}
 * answer, read by {@link PayloadParser}. It is never changed after reading; newer data from the planner is a new
 * object. Every text field except {@link #message} and {@link PlannedBlock#part} is non-null.
 */
public final class ProjectorData {

    /** The project's id and name, and the content version of the blocks and steps (ticking a step keeps it). */
    public final String projectId, name, version;
    /** {@code ok} when the line is placed in the world; otherwise there are no blocks and {@link #message} says why. */
    public final String status;
    /** Why there is nothing to show, for a line that is not placed; null when it is. */
    public final String message;
    /** The project's revision and the dimension the line is in. */
    public final int rev, dim;
    /** The line's origin (the corner of its site) and its size in blocks, each as {x, y, z}. */
    public final int[] origin, size;
    /** The planned blocks; unmodifiable. */
    public final List<PlannedBlock> blocks;
    /** The build steps in checklist order; unmodifiable. */
    public final List<PlannedStep> steps;

    ProjectorData(String projectId, String name, String version, String status, String message, int rev, int dim,
        int[] origin, int[] size, List<PlannedBlock> blocks, List<PlannedStep> steps) {
        this.projectId = projectId;
        this.name = name;
        this.version = version;
        this.status = status;
        this.message = message;
        this.rev = rev;
        this.dim = dim;
        this.origin = origin;
        this.size = size;
        this.blocks = blocks;
        this.steps = steps;
    }

    /** Whether the line is placed in the world, so there is something to draw and check. */
    public boolean placed() {
        return "ok".equals(status);
    }

    /** The index in {@link #steps} of the step numbered {@code order}, or −1 when there is none. */
    public int stepByOrder(int order) {
        for (int i = 0; i < steps.size(); i++) {
            if (steps.get(i).order == order) return i;
        }
        return -1;
    }

    /** The ids of the steps the planner's checklist shows ticked, in step order, as a new set the caller may change. */
    public Set<String> doneStepIds() {
        Set<String> done = new LinkedHashSet<>();
        for (PlannedStep s : steps) {
            if (s.done) done.add(s.id);
        }
        return done;
    }
}
