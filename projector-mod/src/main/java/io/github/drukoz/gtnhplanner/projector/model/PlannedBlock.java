package io.github.drukoz.gtnhplanner.projector.model;

import java.util.List;

/**
 * One block of the line where the layout puts it, and what the build check compares there: the registry name always,
 * then {@link #meta}, {@link #mteId}, {@link #facing} and {@link #mainFacing} where they are not −1.
 */
public final class PlannedBlock {

    /** The world position. */
    public final int x, y, z;
    /** The registry name to find there, for example {@code gregtech:gt.blockmachines} (for a part, its container block). */
    public final String id;
    /** The block meta, or −1 when meta is not compared (GT machines, chests, parts). */
    public final int meta;
    /** The GT meta tile entity id, or −1 when the block has none. */
    public final int mteId;
    /**
     * GT's front facing, as ForgeDirection 0…5, or −1 when it is not compared. On a single-block machine this is its
     * output side (see {@link #facingIsOutput}).
     */
    public final int facing;
    /**
     * Whether {@link #facing} is the block's output side: true for a single-block machine, whose GT front facing is
     * where its output goes, while its face overlay is on another side, its own front ({@link #mainFacing}).
     */
    public final boolean facingIsOutput;
    /**
     * A single-block machine's own front (GT's {@code mMainFacing}), as ForgeDirection 0…5, where GT draws its face
     * overlay and takes no energy, items or fluids; −1 when the planner did not send it (then it is not compared, and
     * the ghost puts the overlay opposite the output side, where GT puts it on a machine placed facing you).
     */
    public final int mainFacing;
    /** The multipart, conduit or ME cable part inside the {@link #id} block, or null for a plain block. */
    public final String part;
    /**
     * Every part the block holds when it holds two or more (a conduit bundle's conduits, in bundle order, the first
     * being {@link #part}); never null, empty otherwise.
     */
    public final List<String> parts;
    /** What the block is in the line: {@code machine}, {@code casing}, {@code hatch}, {@code cable}, {@code pipe}, … */
    public final String role;
    /** The block's name for the player, for example {@code Basic Macerator}. */
    public final String label;
    /** The index in {@link ProjectorData#steps} of the build step that places it, or −1 when no step does. */
    public final int step;
    /**
     * The indices in {@link ProjectorData#steps} of every build step that builds it, ascending: its own {@link #step}
     * and every step that lists it (a conduit bundle's cell is in the line step and the fluids step both). Never null;
     * empty when no step does. Read only.
     */
    public final int[] steps;
    /** The covers on its faces; never null, empty when it has none. */
    public final List<PlannedCover> covers;

    PlannedBlock(int x, int y, int z, String id, int meta, int mteId, int facing, boolean facingIsOutput, int mainFacing,
        String part, List<String> parts, String role, String label, int step, int[] steps, List<PlannedCover> covers) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.id = id;
        this.meta = meta;
        this.mteId = mteId;
        this.facing = facing;
        this.facingIsOutput = facingIsOutput;
        this.mainFacing = mainFacing;
        this.part = part;
        this.parts = parts;
        this.role = role;
        this.label = label;
        this.step = step;
        this.steps = steps;
        this.covers = covers;
    }

    /** The same block, built by the steps at {@code steps} (ascending). */
    PlannedBlock withSteps(int[] steps) {
        return new PlannedBlock(x, y, z, id, meta, mteId, facing, facingIsOutput, mainFacing, part, parts, role, label, step, steps,
            covers);
    }

    /** Whether the step at {@code stepIndex} of {@link ProjectorData#steps} builds it (see {@link #steps}). */
    public boolean inStep(int stepIndex) {
        if (stepIndex == step) return stepIndex >= 0;
        for (int s : steps) {
            if (s == stepIndex) return true;
        }
        return false;
    }
}
