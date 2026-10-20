package io.github.drukoz.gtnhplanner.projector.view;

import static io.github.drukoz.gtnhplanner.projector.check.BlockState.*;
import static org.junit.jupiter.api.Assertions.*;
import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.model.*;
import org.junit.jupiter.api.Test;

class HudTextTest {
    static final BlockState[] STATES = {CORRECT, CORRECT, WRONG_BLOCK, CORRECT, WRONG_FACING, MISSING, MISSING, UNLOADED, UNCHECKED, MISSING};

    @Test void summarizesWhatIsShown() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertEquals("Planner: Steel line — 3/10 placed, 2 wrong, 1 can't be checked", HudText.summary(d, STATES, ViewFilter.ALL));
        assertEquals("Planner: Steel line — 1/2 placed, 1 wrong · showing step 2: Place 2× Basic Macerator facing the mid…", HudText.summary(d, STATES, ViewFilter.ALL.withStep(1)));
        assertEquals("Planner: Steel line — 0/2 placed, 0 wrong · showing layer y=65", HudText.summary(d, STATES, ViewFilter.ALL.withLayer(65)));
        assertEquals("Planner: Steel line — the line is in dimension 0", HudText.otherDimension(d));
    }

    @Test void mentionsBlocksThatCantBeChecked() throws Exception {
        assertTrue(HudText.summary(PayloadParserTest.sample(), STATES, ViewFilter.ALL.withStep(6)).contains("0/3 placed, 0 wrong, 1 can't be checked"));
    }

    @Test void explainsTheBlockUnderTheCrosshair() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        PlannedBlock plain = d.blocks.get(4), covered = d.blocks.get(3);
        assertEquals("Basic Macerator: placed correctly", HudText.lookingAt(plain, CORRECT));
        assertEquals("Basic Macerator: wrong block here", HudText.lookingAt(plain, WRONG_BLOCK));
        // a single-block machine names both its sides (the review of the EnderIO In / Out fix): the check compares both
        assertEquals("Basic Macerator: wrong facing, its front should face west and its output side south", HudText.lookingAt(plain, WRONG_FACING));
        assertEquals("Low Voltage Transformer: wrong facing, its front should face west", HudText.lookingAt(d.blocks.get(2), WRONG_FACING));
        assertEquals("Basic Macerator: can't be checked by the mod", HudText.lookingAt(plain, UNCHECKED));
        assertNull(HudText.lookingAt(plain, UNLOADED));
        assertEquals("Basic Macerator: not placed yet; cover: Conveyor Module (LV) on the south face", HudText.lookingAt(covered, MISSING));
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
        assertEquals(PayloadParserTest.BUNDLE_LABEL + ": not all its conduits placed yet", HudText.lookingAt(d.blocks.get(10), INCOMPLETE));
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
        assertEquals("Basic Macerator: wrong facing, its front should face west and its output side south; cover: Conveyor Module (LV) on the south face; "
            + "cover: Shutter Module on the up face", HudText.lookingAt(d.blocks.get(3), WRONG_FACING));
        ProjectorData noFront = PayloadParser.parse(new java.io.StringReader(PayloadParserTest.mutate(o -> PayloadParserTest.block(o, 4).remove("mainFacing"))));
        assertEquals("Basic Macerator: wrong facing, its output side should face south", HudText.lookingAt(noFront.blocks.get(4), WRONG_FACING));
        assertEquals("Planner: Steel line — 1/2 placed, 1 wrong · showing layer y=64, step 2: Place 2× Basic Macerator facing the mid…",
            HudText.summary(d, STATES, ViewFilter.ALL.withLayer(64).withStep(1)));
    }
}
