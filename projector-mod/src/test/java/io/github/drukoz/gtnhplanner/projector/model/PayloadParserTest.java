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
        d.doneStepIds().add("layout:site");
        assertEquals(Collections.singleton("layout:place:s2"), d.doneStepIds());
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
