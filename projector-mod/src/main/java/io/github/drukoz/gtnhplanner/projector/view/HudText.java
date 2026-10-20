package io.github.drukoz.gtnhplanner.projector.view;

import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.geom.Facing;
import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.PlannedCover;
import io.github.drukoz.gtnhplanner.projector.model.PlannedStep;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

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
     * {@code Planner: <name> — <placed>/<shown> placed, <wrong> wrong}, then {@code , <n> can't be checked} when there
     * are such blocks, then {@code  · showing <f.describe(d)>} unless the filter shows every block. A block counts as
     * placed when it is placed for the filter's step, or for the whole line without one ({@link BlockState#placedFor}: a
     * conduit bundle without the fluid conduit the fluids step lays is placed for the line step only). A block that is
     * not loaded counts only among the shown ones. {@code states[i]} is the state of {@code d.blocks.get(i)}.
     */
    public static String summary(ProjectorData d, BlockState[] states, ViewFilter f) {
        StringBuilder text = new StringBuilder("Planner: ").append(d.name).append(" — ").append(counts(d, states, f));
        if (!f.isAll()) text.append(" · showing ").append(f.describe(d));
        return text.toString();
    }

    /**
     * The counts part of {@link #summary}, for the planner screen's title: {@code <placed>/<shown> placed, <wrong> wrong},
     * then {@code , <n> can't be checked} when there are such blocks, counted as {@link #summary} counts them.
     */
    public static String counts(ProjectorData d, BlockState[] states, ViewFilter f) {
        int shown = 0, placed = 0, wrong = 0, unchecked = 0;
        for (int i = 0; i < d.blocks.size(); i++) {
            PlannedBlock b = d.blocks.get(i);
            if (!f.shows(b)) continue;
            shown++;
            BlockState s = states[i];
            if (s.placedFor(b, f.stepIndex)) placed++;
            else if (s.wrong()) wrong++;
            else if (s == BlockState.UNCHECKED) unchecked++;
        }
        StringBuilder text = new StringBuilder().append(placed).append('/').append(shown).append(" placed, ")
            .append(wrong).append(" wrong");
        if (unchecked > 0) text.append(", ").append(unchecked).append(" can't be checked");
        return text.toString();
    }

    /** For a player in another dimension than the line: {@code Planner: <name> — the line is in dimension <dim>}. */
    public static String otherDimension(ProjectorData d) {
        return "Planner: " + d.name + " — the line is in dimension " + d.dim;
    }

    /**
     * The lines of a block's name tag and tooltip: its label; what the check found ({@code placed correctly},
     * {@code wrong block here}, {@code wrong facing, its <output side|front> should face <side>}, {@code not placed yet},
     * {@code not all its conduits placed yet}, {@code can't be checked by the mod}, {@code not checked yet} for a block
     * that is not loaded); {@code front should face <side>} (or {@code output side should face <side>}) when the block
     * has a facing and is not placed right yet; then {@code cover: <label> on the <side> face} for each cover.
     */
    public static List<String> blockLines(PlannedBlock b, BlockState s) {
        String found;
        boolean facingLine = false;
        switch (s) {
            case CORRECT:
                found = "placed correctly";
                break;
            case WRONG_BLOCK:
                found = "wrong block here";
                facingLine = true;
                break;
            case WRONG_FACING:
                found = wrongFacing(b);
                break;
            case MISSING:
                found = "not placed yet";
                facingLine = true;
                break;
            case INCOMPLETE:
                found = "not all its conduits placed yet";
                break;
            case UNCHECKED:
                found = "can't be checked by the mod";
                facingLine = true;
                break;
            case UNLOADED:
                found = "not checked yet";
                facingLine = true;
                break;
            default:
                throw new IllegalArgumentException("Unknown block state " + s);
        }
        List<String> lines = new ArrayList<>();
        lines.add(b.label);
        lines.add(found);
        if (facingLine && b.facing >= 0) lines.add(facingText(b));
        for (PlannedCover c : b.covers) lines.add("cover: " + c.label + " on the " + Facing.name(c.face) + " face");
        return lines;
    }

    /** {@code wrong facing, its front should face <side> and its output side <side>}, or the one side that is checked. */
    private static String wrongFacing(PlannedBlock b) {
        if (b.facingIsOutput && b.mainFacing >= 0) {
            return "wrong facing, its front should face " + Facing.name(b.mainFacing) + " and its output side "
                + Facing.name(b.facing);
        }
        return "wrong facing, its " + (b.facingIsOutput ? "output side" : "front") + " should face " + Facing.name(b.facing);
    }

    /** The side(s) the block should face, for a block with a facing. */
    private static String facingText(PlannedBlock b) {
        if (b.facingIsOutput && b.mainFacing >= 0) {
            return "front should face " + Facing.name(b.mainFacing) + ", output side " + Facing.name(b.facing);
        }
        return (b.facingIsOutput ? "output side" : "front") + " should face " + Facing.name(b.facing);
    }

    /** Ghost blocks listed behind the header of {@link #stacked} before {@code … and <n> more}. */
    private static final int STACKED_SHOWN = 6;
    /** Names listed by {@link #needs} before {@code … and <n> more kinds}. */
    private static final int NEEDS_NAMES = 8;

    /**
     * The ghost blocks along the crosshair, nearest first: {@code Behind the crosshair (<n>):}, then
     * {@code > <label> <m> m} for the nearest (distances rounded) and {@code   <label> <m> m} for the rest, at most six,
     * then {@code … and <n> more}. Empty for fewer than two hits, when there is nothing to choose between.
     */
    public static List<String> stacked(ProjectorData d, List<AimRay.Hit> hits) {
        if (hits.size() < 2) return Collections.emptyList();
        List<String> lines = new ArrayList<>();
        lines.add("Behind the crosshair (" + hits.size() + "):");
        for (int k = 0; k < hits.size() && k < STACKED_SHOWN; k++) {
            AimRay.Hit h = hits.get(k);
            lines.add((k == 0 ? "> " : "  ") + d.blocks.get(h.block).label + " " + Math.round(h.distance) + " m");
        }
        if (hits.size() > STACKED_SHOWN) lines.add("… and " + (hits.size() - STACKED_SHOWN) + " more");
        return lines;
    }

    /**
     * What a step still needs: {@code Still needed for step <order>:}, then {@code <n>× <label>} for the step's blocks
     * that the step builds (places or lays a part in) and that are not placed for it
     * ({@link BlockState#placedFor}), most first then by label, and after those
     * {@code <n>× <label> (can't check)} for the ones the mod cannot check; at most eight names, then
     * {@code … and <n> more kinds}. Empty for {@code stepIndex < 0} and when nothing is needed.
     */
    public static List<String> needs(ProjectorData d, BlockState[] states, int stepIndex) {
        if (stepIndex < 0) return Collections.emptyList();
        PlannedStep step = d.steps.get(stepIndex);
        Map<String, Integer> open = new TreeMap<>(), unchecked = new TreeMap<>();
        for (int i = 0; i < d.blocks.size(); i++) {
            PlannedBlock b = d.blocks.get(i);
            if (!b.inStep(stepIndex) || states[i].placedFor(b, stepIndex)) continue;
            (states[i] == BlockState.UNCHECKED ? unchecked : open).merge(d.blocks.get(i).label, 1, Integer::sum);
        }
        List<String> names = new ArrayList<>();
        counted(open, "", names);
        counted(unchecked, " (can't check)", names);
        if (names.isEmpty()) return Collections.emptyList();
        List<String> lines = new ArrayList<>();
        lines.add("Still needed for step " + step.order + ":");
        lines.addAll(names.subList(0, Math.min(NEEDS_NAMES, names.size())));
        if (names.size() > NEEDS_NAMES) lines.add("… and " + (names.size() - NEEDS_NAMES) + " more kinds");
        return lines;
    }

    /** {@code <n>× <label><suffix>} for each label, the highest count first and then by label (the map is by label). */
    private static void counted(Map<String, Integer> counts, String suffix, List<String> out) {
        List<Map.Entry<String, Integer>> entries = new ArrayList<>(counts.entrySet());
        entries.sort((a, b) -> b.getValue().compareTo(a.getValue())); // stable: equal counts stay by label
        for (Map.Entry<String, Integer> e : entries) out.add(e.getValue() + "× " + e.getKey() + suffix);
    }

    private static final String[] COMPASS = {"N", "NE", "E", "SE", "S", "SW", "W", "NW"};

    /**
     * Where a block is from the player, given the offset to it: {@code <n> block(s) <compass>} for the horizontal
     * distance (north is −z, east +x), or {@code here} within half a block, then {@code , <n> up} or {@code , <n> down}
     * unless it is level.
     */
    public static String direction(int dx, int dy, int dz) {
        long n = Math.round(Math.hypot(dx, dz));
        String text;
        if (n == 0) {
            text = "here";
        } else {
            int sector = (int) Math.round(Math.toDegrees(Math.atan2(dx, -dz)) / 45.0);
            text = n + (n == 1 ? " block " : " blocks ") + COMPASS[Math.floorMod(sector, 8)];
        }
        if (dy > 0) text += ", " + dy + " up";
        else if (dy < 0) text += ", " + -dy + " down";
        return text;
    }
}
