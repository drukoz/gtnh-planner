package io.github.drukoz.gtnhplanner.projector.check;

/**
 * What the build check found where a planned block goes (spec §3.13): the ghost's colour, the HUD's counts, and whether
 * the block lets its build step be ticked (only when every block of the step is {@link #CORRECT}).
 */
public enum BlockState {

    /** Nothing is there yet (air or a replaceable block): a faint ghost. */
    MISSING,
    /** The planned block, with the planned meta, GT machine and front wherever those are compared: green. */
    CORRECT,
    /** Another block, meta or GT machine: red. */
    WRONG_BLOCK,
    /** The planned block with its front the wrong way: red. */
    WRONG_FACING,
    /** The client does not know the planned registry name, so it cannot be checked: neutral, never ticks its step. */
    UNCHECKED,
    /**
     * Not known yet (a chunk the client has not loaded, or a GT machine whose data has not reached the client): neither
     * right nor wrong.
     */
    UNLOADED;

    /** Whether the check found something other than the plan there: {@link #WRONG_BLOCK} or {@link #WRONG_FACING}. */
    public boolean wrong() {
        return this == WRONG_BLOCK || this == WRONG_FACING;
    }
}
