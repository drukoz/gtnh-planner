package io.github.drukoz.gtnhplanner.projector.check;

import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;

/**
 * What the build check found where a planned block goes (spec §3.13): the ghost's colour, the HUD's counts, and whether
 * the block lets its build steps be ticked (only when every block of a step is placed for it, {@link #placedFor}).
 */
public enum BlockState {

    /**
     * Nothing is there yet (air or a replaceable block), or a conduit bundle lacks a conduit its own step lays: a faint
     * ghost.
     */
    MISSING,
    /** The planned block, with the planned meta, GT machine, front and parts wherever those are compared: green. */
    CORRECT,
    /**
     * The planned block with every part its own step lays, but not yet a part another step lays (a conduit bundle of the
     * line with its Item Conduit and without the fluid conduit the fluids step lays): placed for its own step only, a
     * faint ghost elsewhere.
     */
    INCOMPLETE,
    /** Another block, meta or GT machine: red. */
    WRONG_BLOCK,
    /** The planned block with its front the wrong way: red. */
    WRONG_FACING,
    /**
     * The client does not know the planned registry name, or cannot read what the block holds (a conduit bundle's
     * conduits), so it cannot be checked: neutral, never ticks its step.
     */
    UNCHECKED,
    /**
     * Not known yet (a chunk the client has not loaded, or a GT machine or conduit bundle whose data has not reached the
     * client): neither right nor wrong.
     */
    UNLOADED;

    /** Whether the check found something other than the plan there: {@link #WRONG_BLOCK} or {@link #WRONG_FACING}. */
    public boolean wrong() {
        return this == WRONG_BLOCK || this == WRONG_FACING;
    }

    /**
     * Whether a block in this state stands as the step at {@code stepIndex} needs it ({@code −1}: the whole line):
     * {@link #CORRECT}, or {@link #INCOMPLETE} when that step is the one that places it ({@link PlannedBlock#step}), whose
     * parts are in.
     */
    public boolean placedFor(PlannedBlock b, int stepIndex) {
        return this == CORRECT || (this == INCOMPLETE && stepIndex >= 0 && stepIndex == b.step);
    }
}
