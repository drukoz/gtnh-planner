package io.github.drukoz.gtnhplanner.projector.view;

import static io.github.drukoz.gtnhplanner.projector.check.BlockState.*;
import static org.junit.jupiter.api.Assertions.*;
import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.model.*;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;

class HudTextTest {
    static final BlockState[] STATES = {CORRECT, CORRECT, WRONG_BLOCK, CORRECT, WRONG_FACING, MISSING, MISSING, UNLOADED, UNCHECKED, MISSING};

    @Test void summarizesWhatIsShown() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertEquals("Planner: Steel line — 3/10 placed, 2 wrong, 1 can't be checked", HudText.summary(d, STATES, ViewFilter.ALL));
        assertEquals("Planner: Steel line — 3/10 placed, 2 wrong, 1 can't be checked · ghosts hidden", HudText.summary(d, STATES, ViewFilter.ALL, true));
        assertEquals("Planner: Steel line — 0/2 placed, 0 wrong · showing layer y=65 · ghosts hidden", HudText.summary(d, STATES, ViewFilter.ALL.withLayer(65), true));
        assertEquals("Planner: Steel line — 1/2 placed, 1 wrong · showing step 2: Place 2× Basic Macerator facing the mid…", HudText.summary(d, STATES, ViewFilter.ALL.withStep(1)));
        assertEquals("Planner: Steel line — 0/2 placed, 0 wrong · showing layer y=65", HudText.summary(d, STATES, ViewFilter.ALL.withLayer(65)));
        assertEquals("Planner: Steel line — the line is in dimension 0", HudText.otherDimension(d));
    }

    @Test void countsAreTheSummaryWithoutTheNameOrTheFilter() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertEquals("3/10 placed, 2 wrong, 1 can't be checked", HudText.counts(d, STATES, ViewFilter.ALL));
        assertEquals("1/2 placed, 1 wrong", HudText.counts(d, STATES, ViewFilter.ALL.withStep(1)));
        assertEquals("0/2 placed, 0 wrong", HudText.counts(d, STATES, ViewFilter.ALL.withLayer(65)));
    }

    @Test void mentionsBlocksThatCantBeChecked() throws Exception {
        assertTrue(HudText.summary(PayloadParserTest.sample(), STATES, ViewFilter.ALL.withStep(6)).contains("0/3 placed, 0 wrong, 1 can't be checked"));
    }

    @Test void shortensLongStepText() {
        assertEquals("Place 2× Basic Macerator facing the mid…", HudText.shorten("Place 2× Basic Macerator facing the middle row", 40));
    }

    // Beyond the brief: shortening by characters, which states are wrong, several covers, a layer and a step together.

    @Test void shortensByCharactersAndNeverSplitsOne() {
        assertEquals("abcde", HudText.shorten("abcde", 5)); assertEquals("abc…", HudText.shorten("abcdef", 4)); assertEquals("…", HudText.shorten("ab", 1));
        String smiles = "😀😀😀";   // three characters, six UTF-16 units
        assertEquals(smiles, HudText.shorten(smiles, 3)); assertEquals("😀…", HudText.shorten(smiles, 2));
        assertThrows(IllegalArgumentException.class, () -> HudText.shorten("abc", 0));
    }

    @Test void onlyAWrongBlockOrAWrongFacingIsWrong() {
        for (BlockState s : BlockState.values()) assertEquals(s == WRONG_BLOCK || s == WRONG_FACING, s.wrong(), s.name());
    }

    // The review of the EnderIO single pipe: a bundle with only its Item Conduit was "placed correctly". It is placed for the
    // step that places it (the line step), and not yet for the fluids step or the whole line.
    @Test void countsABundleWithoutItsFluidConduitAsPlacedOnlyForItsOwnStep() throws Exception {
        ProjectorData d = PayloadParserTest.bundleSample();
        BlockState[] s = {MISSING, MISSING, MISSING, MISSING, MISSING, CORRECT, CORRECT, MISSING, CORRECT, MISSING, INCOMPLETE, INCOMPLETE};
        assertEquals("Planner: Steel line — 3/12 placed, 0 wrong", HudText.summary(d, s, ViewFilter.ALL));
        assertTrue(HudText.summary(d, s, ViewFilter.ALL.withStep(PayloadParserTest.LINE)).startsWith("Planner: Steel line — 5/5 placed, 0 wrong · showing step 7: "));
        assertTrue(HudText.summary(d, s, ViewFilter.ALL.withStep(PayloadParserTest.FLUIDS)).startsWith("Planner: Steel line — 0/2 placed, 0 wrong · showing step 11: "));
    }

    @Test void namesEveryCoverAndBothFilters() throws Exception {
        ProjectorData d = PayloadParser.parse(new java.io.StringReader(PayloadParserTest.mutate(o -> {
            com.google.gson.JsonObject up = new com.google.gson.JsonObject();
            up.addProperty("face", 1); up.addProperty("item", "gregtech:gt.metaitem.01@32749"); up.addProperty("label", "Shutter Module");
            PayloadParserTest.block(o, 3).getAsJsonArray("covers").add(up);
        })));
        assertEquals(Arrays.asList("cover: Conveyor Module (LV) on the south face", "cover: Shutter Module on the up face"),
            HudText.blockLines(d.blocks.get(3), WRONG_FACING).subList(2, 4));
        assertEquals("Planner: Steel line — 1/2 placed, 1 wrong · showing layer y=64, step 2: Place 2× Basic Macerator facing the mid…",
            HudText.summary(d, STATES, ViewFilter.ALL.withLayer(64).withStep(1)));
    }

    @Test void tagLinesSayWhatTheBlockIsAndWhichWayItGoes() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertEquals(Arrays.asList("Basic Macerator", "not placed yet", "front should face west, output side south", "cover: Conveyor Module (LV) on the south face"), HudText.blockLines(d.blocks.get(3), MISSING));
        assertEquals(Arrays.asList("Basic Macerator", "placed correctly"), HudText.blockLines(d.blocks.get(4), CORRECT));
        assertEquals(Arrays.asList("Basic Macerator", "wrong facing, its front should face west and its output side south"), HudText.blockLines(d.blocks.get(4), WRONG_FACING));
        assertEquals(Arrays.asList("Basic Macerator", "wrong block here", "front should face west, output side south"), HudText.blockLines(d.blocks.get(4), WRONG_BLOCK));
        assertEquals(Arrays.asList("Basic Macerator", "can't be checked by the mod", "front should face west, output side south"), HudText.blockLines(d.blocks.get(4), UNCHECKED));
        assertEquals(Arrays.asList("Low Voltage Transformer", "not placed yet", "front should face west"), HudText.blockLines(d.blocks.get(2), MISSING));
        assertEquals(Arrays.asList("1x Tin Cable", "not checked yet"), HudText.blockLines(d.blocks.get(0), UNLOADED));
    }

    @Test void tagLinesNameOnlyTheOutputSideWhenThereIsNoFront() throws Exception {
        ProjectorData d = PayloadParser.parse(new java.io.StringReader(PayloadParserTest.mutate(o -> PayloadParserTest.block(o, 4).remove("mainFacing"))));
        assertEquals(Arrays.asList("Basic Macerator", "wrong facing, its output side should face south"), HudText.blockLines(d.blocks.get(4), WRONG_FACING));
        assertEquals(Arrays.asList("Basic Macerator", "not placed yet", "output side should face south"), HudText.blockLines(d.blocks.get(4), MISSING));
    }

    @Test void listsStackedGhostsNearestFirst() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertTrue(HudText.stacked(d, Arrays.asList(new AimRay.Hit(3, 5.2))).isEmpty());
        assertEquals(Arrays.asList("Behind the crosshair (2):", "> Basic Macerator 5 m", "  Heat Proof Machine Casing 6 m"),
            HudText.stacked(d, Arrays.asList(new AimRay.Hit(3, 5.2), new AimRay.Hit(9, 6.4))));
        List<AimRay.Hit> eight = new ArrayList<>(); for (int i = 0; i < 8; i++) eight.add(new AimRay.Hit(i, i + 1));
        List<String> lines = HudText.stacked(d, eight);
        assertEquals("Behind the crosshair (8):", lines.get(0)); assertEquals(8, lines.size()); assertEquals("… and 2 more", lines.get(7));
    }

    @Test void listsWhatTheStepStillNeeds() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertEquals(Arrays.asList("Still needed for step 2:", "1× Basic Macerator"), HudText.needs(d, STATES, 1));
        assertEquals(Arrays.asList("Still needed for step 7:", "1× Chest (input)", "1× Tin Item Pipe", "1× Routed Interface Pipe (input chest) (can't check)"), HudText.needs(d, STATES, 6));
        assertTrue(HudText.needs(d, STATES, -1).isEmpty());
        BlockState[] done = STATES.clone(); done[4] = CORRECT;
        assertTrue(HudText.needs(d, done, 1).isEmpty());
    }

    @Test void needsListStopsAtEightNames() throws Exception {
        ProjectorData d = PayloadParser.parse(new java.io.StringReader(PayloadParserTest.mutate(o -> {
            com.google.gson.JsonArray all = new com.google.gson.JsonArray();
            for (int i = 0; i < 10; i++) {
                com.google.gson.JsonObject b = PayloadParserTest.block(o, i);
                b.addProperty("label", "Block " + i); b.addProperty("step", "layout:place:s1"); b.remove("parts"); b.remove("partSteps");
                all.add(new com.google.gson.JsonPrimitive(i));
            }
            for (com.google.gson.JsonElement s : o.getAsJsonArray("steps")) s.getAsJsonObject().add("blocks", new com.google.gson.JsonArray());
            o.getAsJsonArray("steps").get(1).getAsJsonObject().add("blocks", all);
        })));
        BlockState[] missing = new BlockState[10]; Arrays.fill(missing, MISSING);
        List<String> lines = HudText.needs(d, missing, 1);
        assertEquals(10, lines.size()); assertEquals("Still needed for step 2:", lines.get(0)); assertEquals("1× Block 0", lines.get(1));
        assertEquals("1× Block 7", lines.get(8)); assertEquals("… and 2 more kinds", lines.get(9));
    }

    @Test void needsCountsABundleForTheStepThatLaysItsOtherConduit() throws Exception {
        ProjectorData d = PayloadParserTest.bundleSample();
        BlockState[] s = new BlockState[12]; Arrays.fill(s, CORRECT); s[10] = INCOMPLETE; s[11] = CORRECT;
        assertTrue(HudText.needs(d, s, PayloadParserTest.LINE).isEmpty());
        assertEquals(Arrays.asList("Still needed for step 11:", "1× " + PayloadParserTest.BUNDLE_LABEL), HudText.needs(d, s, PayloadParserTest.FLUIDS));
    }

    @Test void saysWhereABlockIs() {
        assertEquals("23 blocks NE, 2 up", HudText.direction(16, 2, -17));
        assertEquals("5 blocks S, 3 down", HudText.direction(0, -3, 5));
        assertEquals("1 block E", HudText.direction(1, 0, 0));
        assertEquals("10 blocks W", HudText.direction(-10, 0, -1));
        assertEquals("here, 4 up", HudText.direction(0, 4, 0));
    }
}
