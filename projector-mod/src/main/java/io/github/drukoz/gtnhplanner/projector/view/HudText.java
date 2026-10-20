package io.github.drukoz.gtnhplanner.projector.view;

import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.geom.Facing;
import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.PlannedCover;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;

/** The projector's HUD lines, in plain words (spec §3.13). */
public final class HudText {

    private HudText() {}

    /**
     * {@code s} when it has at most {@code max} characters, else its first {@code max − 1} characters and {@code …}.
     * Characters are counted as code points, so a cut never splits one.
     *
     * @throws IllegalArgumentException when {@code max} is less than 1
     */
    public static String shorten(String s, int max) {
        if (max < 1) throw new IllegalArgumentException("Cannot shorten text to " + max + " characters");
        if (s.codePointCount(0, s.length()) <= max) return s;
        return s.substring(0, s.offsetByCodePoints(0, max - 1)) + "…";
    }

    /**
     * How far the build has got among the blocks the filter shows (wherever the player stands):
     * {@code Planner: <name> — <correct>/<shown> placed, <wrong> wrong}, then {@code , <n> can't be checked} when there
     * are such blocks, then {@code  · showing <f.describe(d)>} unless the filter shows every block. A block that is not
     * loaded counts only among the shown ones. {@code states[i]} is the state of {@code d.blocks.get(i)}.
     */
    public static String summary(ProjectorData d, BlockState[] states, ViewFilter f) {
        int shown = 0, correct = 0, wrong = 0, unchecked = 0;
        for (int i = 0; i < d.blocks.size(); i++) {
            if (!f.shows(d.blocks.get(i))) continue;
            shown++;
            BlockState s = states[i];
            if (s == BlockState.CORRECT) correct++;
            else if (s.wrong()) wrong++;
            else if (s == BlockState.UNCHECKED) unchecked++;
        }
        StringBuilder text = new StringBuilder("Planner: ").append(d.name).append(" — ").append(correct).append('/')
            .append(shown).append(" placed, ").append(wrong).append(" wrong");
        if (unchecked > 0) text.append(", ").append(unchecked).append(" can't be checked");
        if (!f.isAll()) text.append(" · showing ").append(f.describe(d));
        return text.toString();
    }

    /**
     * What the player is looking at: {@code <label>: <what the check found>}, then
     * {@code ; cover: <label> on the <side> face} for each cover; null for a block that is not loaded, which is neither
     * right nor wrong. A wrong facing names the side to turn: a single-block machine's own front and output side, both
     * checked ({@code its front should face <side> and its output side <side>}), or its output side alone when the
     * planner sent no front; else the front.
     */
    public static String lookingAt(PlannedBlock b, BlockState s) {
        String found;
        switch (s) {
            case CORRECT:
                found = "placed correctly";
                break;
            case WRONG_BLOCK:
                found = "wrong block here";
                break;
            case WRONG_FACING:
                if (b.facingIsOutput && b.mainFacing >= 0) {
                    found = "wrong facing, its front should face " + Facing.name(b.mainFacing) + " and its output side "
                        + Facing.name(b.facing);
                } else {
                    found = "wrong facing, its " + (b.facingIsOutput ? "output side" : "front") + " should face "
                        + Facing.name(b.facing);
                }
                break;
            case MISSING:
                found = "not placed yet";
                break;
            case UNCHECKED:
                found = "can't be checked by the mod";
                break;
            case UNLOADED:
                return null;
            default:
                throw new IllegalArgumentException("Unknown block state " + s);
        }
        StringBuilder text = new StringBuilder(b.label).append(": ").append(found);
        for (PlannedCover c : b.covers) {
            text.append("; cover: ").append(c.label).append(" on the ").append(Facing.name(c.face)).append(" face");
        }
        return text.toString();
    }

    /** For a player in another dimension than the line: {@code Planner: <name> — the line is in dimension <dim>}. */
    public static String otherDimension(ProjectorData d) {
        return "Planner: " + d.name + " — the line is in dimension " + d.dim;
    }
}
