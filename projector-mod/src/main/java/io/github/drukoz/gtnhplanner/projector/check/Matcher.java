package io.github.drukoz.gtnhplanner.projector.check;

import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;

/**
 * Compares one planned block with what the world has where it goes (spec §3.13). The planner decides what is
 * compared: the registry name always, then {@link PlannedBlock#meta}, {@link PlannedBlock#mteId} and
 * {@link PlannedBlock#facing} where they are not −1. A pseudo part ({@link PlannedBlock#part} set) is therefore checked
 * by its container block only.
 */
public final class Matcher {

    private Matcher() {}

    /**
     * What the check finds at {@code b}'s position; the first rule that applies wins:
     * <ol>
     * <li>its chunk is not loaded: {@link BlockState#UNLOADED};</li>
     * <li>the client's registry does not know {@code b.id}: {@link BlockState#UNCHECKED};</li>
     * <li>air or a replaceable block there: {@link BlockState#MISSING};</li>
     * <li>another registry name, or another meta where the meta is compared: {@link BlockState#WRONG_BLOCK};</li>
     * <li>where the GT machine is compared: a GT tile without data yet is {@link BlockState#UNLOADED}, another machine
     * or no GT tile is {@link BlockState#WRONG_BLOCK};</li>
     * <li>where the front is compared and the world's front is known, another front: {@link BlockState#WRONG_FACING};</li>
     * <li>otherwise {@link BlockState#CORRECT}.</li>
     * </ol>
     */
    public static BlockState check(PlannedBlock b, WorldProbe w) {
        if (!w.isLoaded(b.x, b.y, b.z)) return BlockState.UNLOADED;
        if (!w.isKnownBlock(b.id)) return BlockState.UNCHECKED;
        String found = w.blockAt(b.x, b.y, b.z);
        if (found == null) return BlockState.MISSING;
        if (!found.equals(b.id)) return BlockState.WRONG_BLOCK;
        if (b.meta >= 0 && w.metaAt(b.x, b.y, b.z) != b.meta) return BlockState.WRONG_BLOCK;
        if (b.mteId >= 0) {
            int mteId = w.mteIdAt(b.x, b.y, b.z);
            if (mteId == WorldProbe.NOT_SYNCED) return BlockState.UNLOADED;
            if (mteId != b.mteId) return BlockState.WRONG_BLOCK;
        }
        if (b.facing >= 0) {
            int facing = w.facingAt(b.x, b.y, b.z);
            if (facing >= 0 && facing != b.facing) return BlockState.WRONG_FACING;
        }
        return BlockState.CORRECT;
    }
}
