package io.github.drukoz.gtnhplanner.projector.model;

/** One build step of the project's checklist, with the planned blocks it places and those it lays a part in. */
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
    /**
     * Indices into {@link ProjectorData#blocks} of the blocks another step places that this step lays a part in
     * ({@link PlannedBlock#partSteps}: a conduit bundle of the line, for the fluids step), ascending; empty when there are
     * none. Read only.
     */
    public final int[] partBlocks;
    /** Whether the planner's checklist shows it ticked. */
    public final boolean done;

    PlannedStep(String id, int order, String kind, String text, int[] blocks, int[] partBlocks, boolean done) {
        this.id = id;
        this.order = order;
        this.kind = kind;
        this.text = text;
        this.blocks = blocks;
        this.partBlocks = partBlocks;
        this.done = done;
    }

    /** The same step, laying a part in the blocks at {@code partBlocks} (ascending). */
    PlannedStep withPartBlocks(int[] partBlocks) {
        return new PlannedStep(id, order, kind, text, blocks, partBlocks, done);
    }

    /** Whether the step builds a block: one it places ({@link #blocks}) or one it lays a part in ({@link #partBlocks}). */
    public boolean hasBlocks() {
        return blocks.length > 0 || partBlocks.length > 0;
    }
}
