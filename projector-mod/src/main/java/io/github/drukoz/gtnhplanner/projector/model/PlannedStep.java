package io.github.drukoz.gtnhplanner.projector.model;

/** One build step of the project's checklist, with the planned blocks it places. */
public final class PlannedStep {

    /** The build step id, for example {@code layout:place:s1}; its checklist row is {@code step:<id>}. */
    public final String id;
    /** Its number in the checklist. */
    public final int order;
    /** {@code place}, {@code power}, {@code logistics}, {@code configure}, {@code test}, … */
    public final String kind;
    /** What to do, as the checklist says it. */
    public final String text;
    /** Indices into {@link ProjectorData#blocks} of the blocks this step places; empty when it places none. */
    public final int[] blocks;
    /** Whether the planner's checklist shows it ticked. */
    public final boolean done;

    PlannedStep(String id, int order, String kind, String text, int[] blocks, boolean done) {
        this.id = id;
        this.order = order;
        this.kind = kind;
        this.text = text;
        this.blocks = blocks;
        this.done = done;
    }
}
