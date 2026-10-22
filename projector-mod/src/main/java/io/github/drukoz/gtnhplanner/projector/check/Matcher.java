package io.github.drukoz.gtnhplanner.projector.check;

import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import java.util.Set;

/**
 * Compares one planned block with what the world has where it goes (spec §3.13). The planner decides what is
 * compared: the registry name always, then {@link PlannedBlock#meta}, {@link PlannedBlock#mteId},
 * {@link PlannedBlock#facing} and {@link PlannedBlock#mainFacing} where they are not −1, and every one of
 * {@link PlannedBlock#parts} (a conduit bundle's conduits, {@link WorldProbe#conduitKindsAt}). A block with a single pseudo
 * part ({@link PlannedBlock#part} set, no {@code parts}) is therefore checked by its container block only.
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
     * <li>where the front is compared and the world's front is known, another front, and likewise a single-block
     * machine's own front (its main facing): {@link BlockState#WRONG_FACING};</li>
     * <li>where parts are compared (the review of the EnderIO single pipe: a bundle with only its Item Conduit counted as
     * placed for the fluids step too), the client cannot read them: {@link BlockState#UNCHECKED}; it does not know them
     * yet: {@link BlockState#UNLOADED}; a part the block's own step lays is missing: {@link BlockState#MISSING}; a part
     * another step lays is missing: {@link BlockState#INCOMPLETE};</li>
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
        if (b.mainFacing >= 0) {
            int main = w.mainFacingAt(b.x, b.y, b.z);
            if (main >= 0 && main != b.mainFacing) return BlockState.WRONG_FACING;
        }
        return b.parts.isEmpty() ? BlockState.CORRECT : parts(b, w.conduitKindsAt(b.x, b.y, b.z));
    }

    /** What the parts rule finds for {@code b}, whose block stands, given the parts the client sees there ({@code held}). */
    private static BlockState parts(PlannedBlock b, Set<String> held) {
        if (held == null) return BlockState.UNCHECKED;
        if (held.isEmpty()) return BlockState.UNLOADED;
        BlockState state = BlockState.CORRECT;
        for (int k = 0; k < b.parts.size(); k++) {
            if (held.contains(b.parts.get(k))) continue;
            if (b.partSteps[k] == b.step) return BlockState.MISSING;
            state = BlockState.INCOMPLETE;
        }
        return state;
    }
}
