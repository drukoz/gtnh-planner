package io.github.drukoz.gtnhplanner.projector.check;

import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import java.util.Arrays;
import java.util.List;

/**
 * The build check of one loaded line (spec §3.13): what {@link Matcher} last found for each planned block, and a
 * version that goes up whenever a run changes any of it, so the ghosts are rebuilt only then. Every block starts
 * {@link BlockState#UNLOADED}, as nothing has been checked yet.
 */
public final class BuildCheck {

    private final List<PlannedBlock> blocks;
    /** {@code states[i]} is the state of {@code blocks.get(i)}. */
    private final BlockState[] states;
    private int version;

    /** A check of {@code data}'s blocks, each {@link BlockState#UNLOADED} until the first {@link #run}. */
    public BuildCheck(ProjectorData data) {
        blocks = data.blocks;
        states = new BlockState[blocks.size()];
        Arrays.fill(states, BlockState.UNLOADED);
    }

    /** Checks every block against the world; true when any block's state changed, which adds 1 to {@link #version}. */
    public boolean run(WorldProbe w) {
        boolean changed = false;
        for (int i = 0; i < states.length; i++) {
            BlockState s = Matcher.check(blocks.get(i), w);
            if (s != states[i]) {
                states[i] = s;
                changed = true;
            }
        }
        if (changed) version++;
        return changed;
    }

    /** The state of the block at index {@code block} of {@link ProjectorData#blocks}. */
    public BlockState state(int block) {
        return states[block];
    }

    /** Every block's state, by index into {@link ProjectorData#blocks}: the live array, which callers must not modify. */
    public BlockState[] states() {
        return states;
    }

    /** How many runs have changed a state so far. */
    public int version() {
        return version;
    }
}
