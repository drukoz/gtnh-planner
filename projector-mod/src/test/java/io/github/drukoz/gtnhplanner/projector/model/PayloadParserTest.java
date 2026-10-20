package io.github.drukoz.gtnhplanner.projector.model;

import static org.junit.jupiter.api.Assertions.*;
import com.google.gson.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;

public class PayloadParserTest {
    public static String sampleText() throws IOException {
        try (InputStream in = PayloadParserTest.class.getResourceAsStream("/projector-sample.json")) {
            ByteArrayOutputStream out = new ByteArrayOutputStream(); byte[] b = new byte[8192]; int n;
            while ((n = in.read(b)) > 0) out.write(b, 0, n);
            return new String(out.toByteArray(), StandardCharsets.UTF_8);
        }
    }
    public static ProjectorData sample() throws Exception { return PayloadParser.parse(new StringReader(sampleText())); }
    public static String mutate(Consumer<JsonObject> f) throws IOException { JsonObject o = new JsonParser().parse(sampleText()).getAsJsonObject(); f.accept(o); return o.toString(); }
    private static String error(String json) { return assertThrows(PayloadException.class, () -> PayloadParser.parse(new StringReader(json))).getMessage(); }
    public static JsonObject block(JsonObject o, int i) { return o.getAsJsonArray("blocks").get(i).getAsJsonObject(); }

    /** The step index and id of {@link #bundleSample}'s fluids step, and the positions x of its two bundles (y 64, z 202). */
    public static final int FLUIDS = 10, LINE = 6, BUNDLE_A = 106, BUNDLE_B = 107;
    public static final String FLUIDS_ID = "layout:logistics:fluids", BUNDLE_LABEL = "Conduit bundle (Item Conduit + Ender Fluid Conduit)";
    private static JsonArray strings(String... values) { JsonArray a = new JsonArray(); for (String v : values) a.add(new JsonPrimitive(v)); return a; }
    /**
     * The sample with an all-bundle fluids step, as the planner sends an EnderIO line whose fluids all pass GT basic
     * machines' output sides (the review of the EnderIO single pipe): blocks 10 and 11 are conduit bundles at 106 and 107
     * 64 202 holding the Item Conduit, which the line step (6) places and lays, and the Ender Fluid Conduit, which step 10
     * (layout:logistics:fluids, order 11) lays; that step places no block of its own.
     */
    public static String bundleText() throws IOException {
        return mutate(o -> {
            for (int x : new int[] {BUNDLE_A, BUNDLE_B}) {
                JsonObject b = new JsonObject();
                JsonArray pos = new JsonArray(); pos.add(new JsonPrimitive(x)); pos.add(new JsonPrimitive(64)); pos.add(new JsonPrimitive(202));
                b.add("pos", pos); b.addProperty("id", "EnderIO:blockConduitBundle"); b.addProperty("part", "item"); b.add("meta", JsonNull.INSTANCE);
                b.add("parts", strings("item", "liquid_ender")); b.add("partSteps", strings("layout:logistics:line", FLUIDS_ID));
                b.addProperty("role", "pipe"); b.addProperty("label", BUNDLE_LABEL); b.addProperty("step", "layout:logistics:line");
                o.getAsJsonArray("blocks").add(b);
            }
            JsonArray line = o.getAsJsonArray("steps").get(LINE).getAsJsonObject().getAsJsonArray("blocks");
            line.add(new JsonPrimitive(10)); line.add(new JsonPrimitive(11));
            JsonObject fluids = new JsonObject();
            fluids.addProperty("id", FLUIDS_ID); fluids.addProperty("order", 11); fluids.addProperty("kind", "logistics");
            fluids.addProperty("text", "Lay 2× Ender Fluid Conduit along the middle row to the output side of each electric single-block machine that moves "
                + "fluids; 2 of them go in the same bundle as the Item Conduit");
            fluids.add("blocks", new JsonArray()); fluids.addProperty("done", false);
            o.getAsJsonArray("steps").add(fluids);
        });
    }
    public static ProjectorData bundleSample() throws Exception { return PayloadParser.parse(new StringReader(bundleText())); }
    public static String mutateBundles(Consumer<JsonObject> f) throws IOException { JsonObject o = new JsonParser().parse(bundleText()).getAsJsonObject(); f.accept(o); return o.toString(); }

    @Test void readsTheSharedSample() throws Exception {
        ProjectorData d = sample();
        assertEquals("Pr0jectAb1", d.projectId); assertEquals("Steel line", d.name); assertEquals(7, d.rev); assertEquals(0, d.dim);
        assertTrue(d.placed()); assertNull(d.message); assertTrue(d.version.matches("[0-9a-f]{16}"));
        assertArrayEquals(new int[] {99, 64, 200}, d.origin);
        assertEquals(10, d.blocks.size()); assertEquals(10, d.steps.size());
        PlannedBlock mac = d.blocks.get(3);
        assertArrayEquals(new int[] {102, 64, 201}, new int[] {mac.x, mac.y, mac.z});
        assertEquals("gregtech:gt.blockmachines", mac.id); assertEquals(-1, mac.meta); assertEquals(201, mac.mteId); assertEquals(3, mac.facing);
        assertTrue(mac.facingIsOutput); assertFalse(d.blocks.get(2).facingIsOutput);   // a single-block machine; a transformer
        assertEquals(4, mac.mainFacing); assertEquals(-1, d.blocks.get(2).mainFacing);   // its own front faces west; a transformer has none
        assertTrue(mac.parts.isEmpty()); assertArrayEquals(new int[] {1}, mac.steps);
        assertEquals("machine", mac.role); assertEquals("Basic Macerator", mac.label); assertEquals("layout:place:s1", d.steps.get(mac.step).id);
        assertEquals(1, mac.covers.size()); assertEquals(3, mac.covers.get(0).face); assertEquals("Conveyor Module (LV)", mac.covers.get(0).label);
        assertEquals(-1, d.blocks.get(0).facing); assertEquals(11, d.blocks.get(9).meta);
        assertEquals("ForgeMultipart:block", d.blocks.get(8).id); assertEquals("pr_rinterface", d.blocks.get(8).part);
        assertNull(d.blocks.get(4).part); assertTrue(d.blocks.get(4).covers.isEmpty());
        assertEquals(1, d.stepByOrder(2)); assertEquals(-1, d.stepByOrder(11));
        assertArrayEquals(new int[] {5, 6, 8}, d.steps.get(6).blocks);
        assertEquals(Collections.singleton("layout:place:s2"), d.doneStepIds());
    }

    @Test void readsAProjectThatIsNotPlacedYet() throws Exception {
        ProjectorData d = PayloadParser.parse(new StringReader(mutate(o -> { o.addProperty("status", "no-world"); o.addProperty("message", "Not placed"); o.add("blocks", new JsonArray()); o.add("steps", new JsonArray()); })));
        assertFalse(d.placed()); assertEquals("Not placed", d.message); assertTrue(d.blocks.isEmpty());
    }

    @Test void rejectsBrokenLayoutsInPlainWords() throws Exception {
        assertTrue(error("{").startsWith("The planner sent something that is not a projector layout ("));
        assertEquals("The planner sends layout format gtnh-planner-projector/2; this mod reads gtnh-planner-projector/1 — update the projector mod",
            error(mutate(o -> o.addProperty("format", "gtnh-planner-projector/2"))));
        assertEquals("Bad projector layout: facing 7 at block 2", error(mutate(o -> block(o, 2).addProperty("facing", 7))));
        assertEquals("Bad projector layout: pos at block 1", error(mutate(o -> { JsonArray p = new JsonArray(); p.add(new JsonPrimitive(1)); block(o, 1).add("pos", p); })));
        assertEquals("Bad projector layout: label at block 0", error(mutate(o -> block(o, 0).remove("label"))));
        assertEquals("Bad projector layout: unknown step layout:nope at block 0", error(mutate(o -> block(o, 0).addProperty("step", "layout:nope"))));
        assertEquals("Bad projector layout: block 42 at step layout:place:s2",
            error(mutate(o -> o.getAsJsonArray("steps").get(2).getAsJsonObject().getAsJsonArray("blocks").add(new JsonPrimitive(42)))));
    }

    @Test void givesOptionalValuesTheirStandInsAndCannotBeChanged() throws Exception {
        ProjectorData d = PayloadParser.parse(new StringReader(mutate(o -> {
            block(o, 0).add("step", JsonNull.INSTANCE); block(o, 2).add("facing", JsonNull.INSTANCE);
            block(o, 3).remove("facingIsOutput"); block(o, 4).add("facingIsOutput", JsonNull.INSTANCE);
        })));
        assertEquals(-1, d.blocks.get(0).step); assertEquals(-1, d.blocks.get(0).meta);
        assertEquals(-1, d.blocks.get(2).facing); assertEquals(21, d.blocks.get(2).mteId);
        assertFalse(d.blocks.get(3).facingIsOutput); assertFalse(d.blocks.get(4).facingIsOutput); assertEquals(3, d.blocks.get(3).facing);
        assertEquals("minecraft:chest", d.blocks.get(6).id); assertEquals(-1, d.blocks.get(6).mteId);
        assertThrows(UnsupportedOperationException.class, () -> d.blocks.clear());
        assertThrows(UnsupportedOperationException.class, () -> d.steps.clear());
        assertThrows(UnsupportedOperationException.class, () -> d.blocks.get(3).covers.clear());
        assertThrows(UnsupportedOperationException.class, () -> d.blocks.get(3).parts.add("item"));
        d.doneStepIds().add("layout:site");
        assertEquals(Collections.singleton("layout:place:s2"), d.doneStepIds());
    }

    // The review and audit of the EnderIO In / Out fix: a single-block machine's own front, every part of a bundle, and a
    // block that more than one step builds (a conduit bundle: the line step and the fluids step).
    @Test void readsAMachinesFrontEveryPartOfABundleAndEveryStepThatBuildsABlock() throws Exception {
        ProjectorData d = PayloadParser.parse(new StringReader(mutate(o -> {
            block(o, 4).remove("mainFacing");
            JsonArray parts = new JsonArray(); parts.add(new JsonPrimitive("item")); parts.add(new JsonPrimitive("liquid_ender"));
            block(o, 8).add("parts", parts);
            o.getAsJsonArray("steps").get(7).getAsJsonObject().getAsJsonArray("blocks").add(new JsonPrimitive(8));
        })));
        assertEquals(4, d.blocks.get(3).mainFacing); assertEquals(-1, d.blocks.get(4).mainFacing);
        PlannedBlock bundle = d.blocks.get(8);
        assertEquals(java.util.Arrays.asList("item", "liquid_ender"), bundle.parts); assertEquals("pr_rinterface", bundle.part);
        assertEquals(6, bundle.step); assertArrayEquals(new int[] {6, 7}, bundle.steps);   // its own step first, then by step order
        assertTrue(bundle.inStep(6)); assertTrue(bundle.inStep(7)); assertFalse(bundle.inStep(5));
        assertArrayEquals(new int[] {7}, d.blocks.get(7).steps);
        // a block listed by no step keeps its own
        ProjectorData unlisted = PayloadParser.parse(new StringReader(mutate(o -> o.getAsJsonArray("steps").get(1).getAsJsonObject().add("blocks", new JsonArray()))));
        assertArrayEquals(new int[] {1}, unlisted.blocks.get(3).steps); assertTrue(unlisted.blocks.get(3).inStep(1));
        assertEquals("Bad projector layout: mainFacing 6 at block 3", error(mutate(o -> block(o, 3).addProperty("mainFacing", 6))));
        assertEquals("Bad projector layout: parts at block 8", error(mutate(o -> { JsonArray p = new JsonArray(); p.add(JsonNull.INSTANCE); block(o, 8).add("parts", p); })));
    }

    // The review of the EnderIO single pipe: a step lists only the blocks it places, so a mod that checks a bundle by its
    // block alone (0.1) never ticks the fluids step for it; the steps that lay a bundle's conduits come with each part.
    @Test void readsTheStepThatLaysEachPartAndListsTheBundlesAStepLaysAPartIn() throws Exception {
        ProjectorData d = bundleSample();
        PlannedBlock bundle = d.blocks.get(10);
        assertEquals(java.util.Arrays.asList("item", "liquid_ender"), bundle.parts); assertArrayEquals(new int[] {LINE, FLUIDS}, bundle.partSteps);
        assertEquals(LINE, bundle.step); assertArrayEquals(new int[] {LINE, FLUIDS}, bundle.steps); assertTrue(bundle.inStep(FLUIDS));
        assertArrayEquals(new int[0], d.steps.get(FLUIDS).blocks); assertArrayEquals(new int[] {10, 11}, d.steps.get(FLUIDS).partBlocks);
        assertTrue(d.steps.get(FLUIDS).hasBlocks()); assertFalse(d.steps.get(0).hasBlocks()); assertTrue(d.steps.get(1).hasBlocks());
        assertArrayEquals(new int[0], d.steps.get(LINE).partBlocks);                  // the line step places its bundles
        assertArrayEquals(new int[0], d.blocks.get(3).partSteps);                      // no parts, no part steps
        assertThrows(UnsupportedOperationException.class, () -> d.blocks.get(10).parts.clear());
        // a part no step lays; parts sent without their steps are all laid by the block's own step
        ProjectorData loose = PayloadParser.parse(new StringReader(mutateBundles(o -> {
            JsonArray steps = new JsonArray(); steps.add(new JsonPrimitive("layout:logistics:line")); steps.add(JsonNull.INSTANCE);
            block(o, 10).add("partSteps", steps);
            block(o, 11).remove("partSteps");
        })));
        assertArrayEquals(new int[] {LINE, -1}, loose.blocks.get(10).partSteps); assertArrayEquals(new int[] {LINE, LINE}, loose.blocks.get(11).partSteps);
        assertArrayEquals(new int[0], loose.steps.get(FLUIDS).partBlocks); assertFalse(loose.steps.get(FLUIDS).hasBlocks());
        assertArrayEquals(new int[] {LINE}, loose.blocks.get(10).steps);
        assertEquals("Bad projector layout: partSteps at block 10", error(mutateBundles(o -> block(o, 10).add("partSteps", strings("layout:logistics:line")))));
        assertEquals("Bad projector layout: unknown step layout:nope at block 11",
            error(mutateBundles(o -> block(o, 11).add("partSteps", strings("layout:logistics:line", "layout:nope")))));
    }

    @Test void refusesWrongTypesMissingFieldsAndOutOfRangeFacesToo() throws Exception {
        String wrongType = error(mutate(o -> block(o, 1).addProperty("pos", "101 64 201")));
        assertTrue(wrongType.startsWith("The planner sent something that is not a projector layout (") && wrongType.contains("Expected BEGIN_ARRAY but was STRING"), wrongType);
        assertTrue(error("[]").startsWith("The planner sent something that is not a projector layout ("));
        assertEquals("The planner sent something that is not a projector layout (empty answer)", error(""));
        assertEquals("The planner sent something that is not a projector layout (it has no format)", error(mutate(o -> o.remove("format"))));
        assertEquals("Bad projector layout: origin", error(mutate(o -> o.remove("origin"))));
        assertEquals("Bad projector layout: id at block 4", error(mutate(o -> block(o, 4).remove("id"))));
        assertEquals("Bad projector layout: role at block 5", error(mutate(o -> block(o, 5).remove("role"))));
        assertEquals("Bad projector layout: pos at block 6", error(mutate(o -> {
            JsonArray p = new JsonArray(); p.add(new JsonPrimitive(104)); p.add(JsonNull.INSTANCE); p.add(new JsonPrimitive(202)); block(o, 6).add("pos", p); })));
        assertEquals("Bad projector layout: facing -1 at block 3", error(mutate(o -> block(o, 3).addProperty("facing", -1))));
        assertEquals("Bad projector layout: face 6 at block 3", error(mutate(o -> block(o, 3).getAsJsonArray("covers").get(0).getAsJsonObject().addProperty("face", 6))));
        assertEquals("Bad projector layout: cover label at block 3", error(mutate(o -> block(o, 3).getAsJsonArray("covers").get(0).getAsJsonObject().remove("label"))));
        assertEquals("Bad projector layout: block -1 at step layout:place:s1",
            error(mutate(o -> o.getAsJsonArray("steps").get(1).getAsJsonObject().getAsJsonArray("blocks").add(new JsonPrimitive(-1)))));
        assertEquals("Bad projector layout: done at step layout:site", error(mutate(o -> o.getAsJsonArray("steps").get(0).getAsJsonObject().remove("done"))));
        assertEquals("Bad projector layout: id at step 9", error(mutate(o -> o.getAsJsonArray("steps").get(9).getAsJsonObject().remove("id"))));
    }
}
