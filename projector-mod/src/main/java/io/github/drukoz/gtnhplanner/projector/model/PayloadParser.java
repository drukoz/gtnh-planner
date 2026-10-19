package io.github.drukoz.gtnhplanner.projector.model;

import com.google.gson.Gson;
import java.io.Reader;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * Reads the planner's projector payload ({@code ProjectorPayload} in {@code src/shared/types/projector.ts}): Gson
 * fills private classes that mirror it field for field, then the checks below turn them into the immutable
 * {@link ProjectorData}. The payload's optional values get fixed stand-ins: {@code meta} null, a missing
 * {@code mteId} or {@code facing}, and {@code step} null become −1; a missing {@code facingIsOutput} becomes false;
 * missing {@code covers} become an empty list and a missing {@code part} null. Everything else the payload type
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
     * or {@code label} ({@code <field> at block <i>}); {@code facing} outside 0…5 ({@code facing <n> at block <i>}); a
     * cover without a face, item or label ({@code cover <field> at block <i>}) or with a face outside 0…5
     * ({@code face <n> at block <i>}); a {@code step} id no step has ({@code unknown step <id> at block <i>});</li>
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
        return new ProjectorData(projectId, name, version, status, p.message, rev, dim, origin, size,
            Collections.unmodifiableList(blocks), Collections.unmodifiableList(steps));
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
        List<PlannedCover> covers = covers(b.covers, at);
        int step = -1;
        if (b.step != null) {
            Integer j = stepIndex.get(b.step);
            if (j == null) throw bad("unknown step " + b.step + at);
            step = j;
        }
        return new PlannedBlock(pos[0], pos[1], pos[2], id, b.meta == null ? -1 : b.meta,
            b.mteId == null ? -1 : b.mteId, facing, Boolean.TRUE.equals(b.facingIsOutput), b.part, role, label, step, covers);
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
        return new PlannedStep(s.id, order, kind, text, blocks, done);
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
        Integer meta, mteId, facing;
        Boolean facingIsOutput;
        String part, role, label, step;
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
