package io.github.drukoz.gtnhplanner.projector.model;

import com.google.gson.Gson;
import java.io.Reader;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeSet;

/**
 * Reads the planner's projector payload ({@code ProjectorPayload} in {@code src/shared/types/projector.ts}): Gson
 * fills private classes that mirror it field for field, then the checks below turn them into the immutable
 * {@link ProjectorData}. The payload's optional values get fixed stand-ins: {@code meta} null, a missing
 * {@code mteId}, {@code facing} or {@code mainFacing}, and {@code step} null become −1; a missing {@code facingIsOutput}
 * becomes false; missing {@code covers} or {@code parts} become an empty list and a missing {@code part} null; missing
 * {@code partSteps} make every part the block's own step's. Each step also gets {@link PlannedStep#partBlocks}: the
 * blocks another step places that name it in their {@code partSteps}; and each block {@link PlannedBlock#steps}: its own
 * step, every step whose {@code blocks} list it and every step in its {@code partSteps}. Everything else the payload type
 * requires must be there, so later code never meets a null.
 */
public final class PayloadParser {

    public static final String FORMAT = "gtnh-planner-projector/1";

    private static final Gson GSON = new Gson();

    private PayloadParser() {}

    /**
     * Reads one payload, or says in plain words why it cannot be shown, checking in this order:
     * <ul>
     * <li>not JSON, not a JSON object, empty, without a {@code format}, or a value of the wrong type: {@code The planner
     * sent something that is not a projector layout (<Gson message>)};</li>
     * <li>another {@code format}: {@code The planner sends layout format <f>; this mod reads gtnh-planner-projector/1 —
     * update the projector mod};</li>
     * <li>a missing top-level field, or an {@code origin} or {@code size} that is not 3 numbers: {@code Bad projector
     * layout: <field>};</li>
     * <li>per block {@code i}: {@code pos} not 3 numbers ({@code pos at block <i>}); a missing {@code id}, {@code role}
     * or {@code label} ({@code <field> at block <i>}); {@code facing} or {@code mainFacing} outside 0…5
     * ({@code facing <n> at block <i>}, {@code mainFacing <n> at block <i>}); a null among {@code parts}
     * ({@code parts at block <i>}); {@code partSteps} not one per part ({@code partSteps at block <i>}); a cover without a
     * face, item or label ({@code cover <field> at block <i>}) or with a face outside 0…5 ({@code face <n> at block <i>});
     * a {@code step} id, or one in {@code partSteps}, that no step has ({@code unknown step <id> at block <i>});</li>
     * <li>per step: no id ({@code id at step <index>}); a missing {@code order}, {@code kind}, {@code text},
     * {@code blocks} or {@code done} ({@code <field> at step <id>}); a block index outside {@code blocks}
     * ({@code block <n> at step <id>}).</li>
     * </ul>
     * Each of the last three kinds starts with {@code Bad projector layout: }.
     */
    public static ProjectorData parse(Reader json) throws PayloadException {
        Payload p = read(json);
        if (!FORMAT.equals(p.format)) {
            throw new PayloadException(
                "The planner sends layout format " + p.format + "; this mod reads " + FORMAT + " — update the projector mod");
        }
        String projectId = need(p.projectId, "projectId");
        String name = need(p.name, "name");
        int rev = need(p.rev, "rev");
        String version = need(p.version, "version");
        String status = need(p.status, "status");
        int dim = need(p.dim, "dim");
        int[] origin = need(xyz(p.origin), "origin");
        int[] size = need(xyz(p.size), "size");
        List<Block> rawBlocks = need(p.blocks, "blocks");
        List<Step> rawSteps = need(p.steps, "steps");

        Map<String, Integer> stepIndex = new HashMap<>();
        for (int j = rawSteps.size() - 1; j >= 0; j--) { // backwards, so the first step with an id wins
            Step s = rawSteps.get(j);
            if (s != null && s.id != null) stepIndex.put(s.id, j);
        }
        List<PlannedBlock> blocks = new ArrayList<>(rawBlocks.size());
        for (int i = 0; i < rawBlocks.size(); i++) blocks.add(block(rawBlocks.get(i), i, stepIndex));
        List<PlannedStep> steps = new ArrayList<>(rawSteps.size());
        for (int j = 0; j < rawSteps.size(); j++) steps.add(step(rawSteps.get(j), j, blocks.size()));
        steps = withPartBlocks(blocks, steps);
        return new ProjectorData(projectId, name, version, status, p.message, rev, dim, origin, size,
            Collections.unmodifiableList(withSteps(blocks, steps)), Collections.unmodifiableList(steps));
    }

    /**
     * Each step with the blocks another step places that name it in their {@code partSteps} and that it does not list
     * itself ({@link PlannedStep#partBlocks}), ascending.
     */
    private static List<PlannedStep> withPartBlocks(List<PlannedBlock> blocks, List<PlannedStep> steps) {
        List<TreeSet<Integer>> laid = new ArrayList<>(steps.size());
        for (int j = 0; j < steps.size(); j++) laid.add(new TreeSet<>());
        for (int i = 0; i < blocks.size(); i++) {
            PlannedBlock b = blocks.get(i);
            for (int j : b.partSteps) {
                if (j >= 0 && j != b.step) laid.get(j).add(i);
            }
        }
        List<PlannedStep> out = new ArrayList<>(steps.size());
        for (int j = 0; j < steps.size(); j++) {
            PlannedStep s = steps.get(j);
            for (int i : s.blocks) laid.get(j).remove(i);
            out.add(s.withPartBlocks(ints(laid.get(j))));
        }
        return out;
    }

    /**
     * Each block with every step that builds it ({@link PlannedBlock#steps}): its own step, every step whose
     * {@code blocks} list it and every step that lays one of its parts, ascending.
     */
    private static List<PlannedBlock> withSteps(List<PlannedBlock> blocks, List<PlannedStep> steps) {
        List<TreeSet<Integer>> member = new ArrayList<>(blocks.size());
        for (PlannedBlock b : blocks) {
            TreeSet<Integer> own = new TreeSet<>();
            if (b.step >= 0) own.add(b.step);
            for (int j : b.partSteps) {
                if (j >= 0) own.add(j);
            }
            member.add(own);
        }
        for (int j = 0; j < steps.size(); j++) {
            for (int i : steps.get(j).blocks) member.get(i).add(j);
        }
        List<PlannedBlock> out = new ArrayList<>(blocks.size());
        for (int i = 0; i < blocks.size(); i++) out.add(blocks.get(i).withSteps(ints(member.get(i))));
        return out;
    }

    /** The numbers in iteration order. */
    private static int[] ints(Collection<Integer> numbers) {
        int[] out = new int[numbers.size()];
        int k = 0;
        for (int n : numbers) out[k++] = n;
        return out;
    }

    /** Gson's reading of the answer: it must be a JSON object of the payload's shape that names a format. */
    private static Payload read(Reader json) throws PayloadException {
        Payload p;
        try {
            p = GSON.fromJson(json, Payload.class);
        } catch (RuntimeException e) { // JsonParseException: not JSON, or a value of the wrong type
            throw notALayout(e.getMessage() == null ? e.toString() : e.getMessage());
        }
        if (p == null) throw notALayout("empty answer"); // Gson reads an empty document or a bare null as null
        if (p.format == null) throw notALayout("it has no format");
        return p;
    }

    private static PlannedBlock block(Block b, int i, Map<String, Integer> stepIndex) throws PayloadException {
        String at = " at block " + i;
        int[] pos = need(b == null ? null : xyz(b.pos), "pos" + at); // a null block has no pos either
        String id = need(b.id, "id" + at);
        String role = need(b.role, "role" + at);
        String label = need(b.label, "label" + at);
        int facing = b.facing == null ? -1 : b.facing;
        if (b.facing != null && !isFace(facing)) throw bad("facing " + facing + at);
        int mainFacing = b.mainFacing == null ? -1 : b.mainFacing;
        if (b.mainFacing != null && !isFace(mainFacing)) throw bad("mainFacing " + mainFacing + at);
        List<String> parts = parts(b.parts, at);
        List<PlannedCover> covers = covers(b.covers, at);
        int step = b.step == null ? -1 : stepOf(b.step, stepIndex, at);
        int[] partSteps = partSteps(b.partSteps, parts.size(), step, stepIndex, at);
        return new PlannedBlock(pos[0], pos[1], pos[2], id, b.meta == null ? -1 : b.meta,
            b.mteId == null ? -1 : b.mteId, facing, Boolean.TRUE.equals(b.facingIsOutput), mainFacing, b.part, parts, partSteps,
            role, label, step, new int[0], covers);
    }

    /** The index of the step {@code id}. */
    private static int stepOf(String id, Map<String, Integer> stepIndex, String at) throws PayloadException {
        Integer j = stepIndex.get(id);
        if (j == null) throw bad("unknown step " + id + at);
        return j;
    }

    /** The step that lays each of the block's {@code count} parts: {@code own} for every part when the planner sent none. */
    private static int[] partSteps(List<String> raw, int count, int own, Map<String, Integer> stepIndex, String at)
        throws PayloadException {
        int[] out = new int[count];
        if (raw == null) {
            Arrays.fill(out, own);
            return out;
        }
        if (raw.size() != count) throw bad("partSteps" + at);
        for (int k = 0; k < count; k++) out[k] = raw.get(k) == null ? -1 : stepOf(raw.get(k), stepIndex, at);
        return out;
    }

    private static List<String> parts(List<String> raw, String at) throws PayloadException {
        if (raw == null || raw.isEmpty()) return Collections.emptyList();
        for (String part : raw) {
            if (part == null) throw bad("parts" + at);
        }
        return Collections.unmodifiableList(new ArrayList<>(raw));
    }

    private static List<PlannedCover> covers(List<Cover> raw, String at) throws PayloadException {
        if (raw == null || raw.isEmpty()) return Collections.emptyList();
        List<PlannedCover> out = new ArrayList<>(raw.size());
        for (Cover c : raw) {
            if (c == null || c.face == null) throw bad("cover face" + at);
            if (!isFace(c.face)) throw bad("face " + c.face + at);
            out.add(new PlannedCover(c.face, need(c.item, "cover item" + at), need(c.label, "cover label" + at)));
        }
        return Collections.unmodifiableList(out);
    }

    private static PlannedStep step(Step s, int j, int blockCount) throws PayloadException {
        if (s == null || s.id == null) throw bad("id at step " + j);
        String at = " at step " + s.id;
        int order = need(s.order, "order" + at);
        String kind = need(s.kind, "kind" + at);
        String text = need(s.text, "text" + at);
        List<Integer> members = need(s.blocks, "blocks" + at);
        boolean done = need(s.done, "done" + at);
        int[] blocks = new int[members.size()];
        for (int k = 0; k < blocks.length; k++) {
            Integer n = members.get(k);
            if (n == null || n < 0 || n >= blockCount) throw bad("block " + n + at);
            blocks[k] = n;
        }
        return new PlannedStep(s.id, order, kind, text, blocks, new int[0], done);
    }

    /** {x, y, z} from a list of exactly three numbers, else null. */
    private static int[] xyz(List<Integer> v) {
        if (v == null || v.size() != 3 || v.contains(null)) return null;
        return new int[] {v.get(0), v.get(1), v.get(2)};
    }

    /** A ForgeDirection: down 0, up 1, north 2, south 3, west 4, east 5. */
    private static boolean isFace(int f) {
        return f >= 0 && f <= 5;
    }

    private static <T> T need(T value, String what) throws PayloadException {
        if (value == null) throw bad(what);
        return value;
    }

    private static PayloadException bad(String what) {
        return new PayloadException("Bad projector layout: " + what);
    }

    private static PayloadException notALayout(String why) {
        return new PayloadException("The planner sent something that is not a projector layout (" + why + ")");
    }

    // The payload field for field, as Gson fills it: null wherever the planner left a key out or sent null.

    private static final class Payload {
        String format, projectId, name;
        Integer rev;
        String version, status, message;
        Integer dim;
        List<Integer> origin, size;
        List<Block> blocks;
        List<Step> steps;
    }

    private static final class Block {
        List<Integer> pos;
        String id;
        Integer meta, mteId, facing, mainFacing;
        Boolean facingIsOutput;
        String part, role, label, step;
        List<String> parts, partSteps;
        List<Cover> covers;
    }

    private static final class Cover {
        Integer face;
        String item, label;
    }

    private static final class Step {
        String id;
        Integer order;
        String kind, text;
        List<Integer> blocks;
        Boolean done;
    }
}
