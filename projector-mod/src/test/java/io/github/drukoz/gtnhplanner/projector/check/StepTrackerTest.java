package io.github.drukoz.gtnhplanner.projector.check;

import static org.junit.jupiter.api.Assertions.*;
import io.github.drukoz.gtnhplanner.projector.model.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class StepTrackerTest {
    static final String S1 = "layout:place:s1";
    private static BlockState[] states(ProjectorData d, FakeWorld w) { BuildCheck c = new BuildCheck(d); c.run(w); return c.states(); }

    @Test void waitsForTwoCorrectChecks() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        StepTracker t = new StepTracker(d, new HashSet<>());
        BlockState[] ok = states(d, new FakeWorld().placeStepS1());
        assertTrue(t.complete(1, ok));
        assertEquals(Collections.emptyList(), t.due(ok, 0));
        assertEquals(Collections.singletonList(S1), t.due(ok, 1000));
        assertEquals(Collections.emptyList(), t.due(ok, 2000));            // in flight
    }

    @Test void sendsAStepOncePerSession() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        Set<String> sent = new HashSet<>();
        StepTracker t = new StepTracker(d, sent);
        BlockState[] ok = states(d, new FakeWorld().placeStepS1());
        t.due(ok, 0); t.due(ok, 1); t.sent(S1);
        assertTrue(t.isDone(S1)); assertEquals(Collections.singleton(S1), sent);
        StepTracker again = new StepTracker(d, sent);                       // after a reload
        again.due(ok, 2); assertEquals(Collections.emptyList(), again.due(ok, 3));
    }

    @Test void resetsWhenABlockBreaksBetweenChecks() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        StepTracker t = new StepTracker(d, new HashSet<>());
        FakeWorld w = new FakeWorld().placeStepS1();
        t.due(states(d, w), 0);
        t.due(states(d, w.remove(103, 64, 201)), 1);
        w.placeStepS1();
        assertEquals(Collections.emptyList(), t.due(states(d, w), 2));
        assertEquals(Collections.singletonList(S1), t.due(states(d, w), 3));
    }

    @Test void neverCompletesAStepWithUnloadedBlocks() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertFalse(new StepTracker(d, new HashSet<>()).complete(1, states(d, new FakeWorld().placeStepS1().unload(103, 64, 201))));
        assertFalse(new StepTracker(d, new HashSet<>()).complete(0, states(d, new FakeWorld())));   // layout:site has no blocks
    }

    @Test void neverCompletesAStepWithAnUncheckedBlock() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        FakeWorld w = new FakeWorld().put(103, 65, 203, "gregtech:gt.blockcasings", 11, -1, -1);   // block 9: a name this client does not know
        assertFalse(new StepTracker(d, new HashSet<>()).complete(2, states(d, w)));
        BlockState[] s = states(d, new FakeWorld().placeStepS1());
        s[4] = BlockState.UNCHECKED;
        assertFalse(new StepTracker(d, new HashSet<>()).complete(1, s));
    }

    @Test void doesNotSendAStepThePlannerAlreadyShowsDone() throws Exception {
        ProjectorData d = PayloadParserTest.sample();                        // layout:place:s2 is done in the sample
        FakeWorld w = new FakeWorld(); w.known.add("gregtech:gt.blockcasings"); w.put(103, 65, 203, "gregtech:gt.blockcasings", 11, -1, -1).placeStepS1();
        StepTracker t = new StepTracker(d, new HashSet<>());
        BlockState[] s = states(d, w);
        t.due(s, 0);
        assertEquals(Collections.singletonList(S1), t.due(s, 1));
        t.serverDone(new HashSet<>(Arrays.asList(S1, "layout:gone")));
        assertTrue(t.isDone(S1));
    }

    @Test void retriesAFailedSendAfterAMinute() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        StepTracker t = new StepTracker(d, new HashSet<>());
        BlockState[] ok = states(d, new FakeWorld().placeStepS1());
        t.due(ok, 0); t.due(ok, 1_000); t.failed(S1, 1_000);
        assertEquals(Collections.emptyList(), t.due(ok, 60_999));
        assertEquals(Collections.singletonList(S1), t.due(ok, 61_000));
    }

    @Test void ignoresIdsThatAreNotItsStepsAndNeverUnticks() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        Set<String> sent = new HashSet<>();
        StepTracker t = new StepTracker(d, sent);
        t.sent("layout:gone"); t.serverDone(Collections.singleton("layout:gone"));
        assertEquals(Collections.emptySet(), sent); assertFalse(t.isDone("layout:gone"));
        t.serverDone(Collections.emptySet());                                // a refresh that no longer shows layout:place:s2 ticked
        assertTrue(t.isDone("layout:place:s2"));
    }

    // The review of the EnderIO single pipe: since every GT basic machine's fluid conduit is in a bundle of the line, the
    // fluids step can lay conduits in bundles only. Fed such a payload with only the Item Conduits placed, the mod ticked
    // "Lay 2× Ender Fluid Conduit" on its second check.
    static final String LINE = "layout:logistics:line", FLUIDS = PayloadParserTest.FLUIDS_ID;

    @Test void ticksAnAllBundleFluidsStepOnlyOnceItsFluidConduitsAreIn() throws Exception {
        ProjectorData d = PayloadParserTest.bundleSample();
        StepTracker t = new StepTracker(d, new HashSet<>());
        FakeWorld w = new FakeWorld().placeLine("item");
        BlockState[] items = states(d, w);
        assertTrue(t.complete(PayloadParserTest.LINE, items)); assertFalse(t.complete(PayloadParserTest.FLUIDS, items));
        assertEquals(Collections.emptyList(), t.due(items, 0));
        assertEquals(Collections.singletonList(LINE), t.due(items, 1));                 // the line step's own conduits stand
        assertEquals(Collections.emptyList(), t.due(items, 2));
        t.sent(LINE);
        BlockState[] both = states(d, w.placeLine("item", "liquid_ender"));
        assertTrue(t.complete(PayloadParserTest.FLUIDS, both));
        assertEquals(Collections.emptyList(), t.due(both, 3));
        assertEquals(Collections.singletonList(FLUIDS), t.due(both, 4));
    }

    @Test void waitsForTheBundlesOfAFluidsStepThatAlsoPlacesConduitsOfItsOwn() throws Exception {
        // a riser cell of the fluids step's own (block 12, a single Ender Fluid Conduit) beside the line's bundles
        ProjectorData d = PayloadParser.parse(new java.io.StringReader(PayloadParserTest.mutateBundles(o -> {
            com.google.gson.JsonObject riser = new com.google.gson.JsonParser().parse("{\"pos\":[108,64,202],\"id\":\"EnderIO:blockConduitBundle\","
                + "\"part\":\"liquid_ender\",\"meta\":null,\"role\":\"pipe\",\"label\":\"Ender Fluid Conduit\",\"step\":\"" + FLUIDS + "\"}").getAsJsonObject();
            o.getAsJsonArray("blocks").add(riser);
            o.getAsJsonArray("steps").get(PayloadParserTest.FLUIDS).getAsJsonObject().getAsJsonArray("blocks").add(new com.google.gson.JsonPrimitive(12));
        })));
        StepTracker t = new StepTracker(d, new HashSet<>());
        FakeWorld w = new FakeWorld().placeLine("item").bundle(108, 64, 202, "liquid_ender");
        assertFalse(t.complete(PayloadParserTest.FLUIDS, states(d, w)));                // its own cell stands, its bundles lack the conduit
        assertTrue(t.complete(PayloadParserTest.FLUIDS, states(d, w.placeLine("item", "liquid_ender"))));
    }

    @Test void neverTicksABundleStepWhileTheModCannotSeeTheBundlesConduits() throws Exception {
        ProjectorData d = PayloadParserTest.bundleSample();
        StepTracker t = new StepTracker(d, new HashSet<>());
        FakeWorld blind = new FakeWorld().placeLine("item", "liquid_ender"); blind.conduitsUnreadable = true;
        BlockState[] s = states(d, blind);
        for (int i = 0; i < 4; i++) assertEquals(Collections.emptyList(), t.due(s, i));
        FakeWorld late = new FakeWorld().placeLine();                                      // bundles whose conduits have not reached the client
        assertFalse(t.complete(PayloadParserTest.LINE, states(d, late))); assertFalse(t.complete(PayloadParserTest.FLUIDS, states(d, late)));
    }

    @Test void aBundleStandsForTheStepThatPlacesItOnceItsOwnPartsAreIn() throws Exception {
        PlannedBlock bundle = PayloadParserTest.bundleSample().blocks.get(10);         // placed by step 6, its fluid conduit laid by step 10
        assertTrue(BlockState.INCOMPLETE.placedFor(bundle, PayloadParserTest.LINE));
        assertFalse(BlockState.INCOMPLETE.placedFor(bundle, PayloadParserTest.FLUIDS)); assertFalse(BlockState.INCOMPLETE.placedFor(bundle, -1));
        assertTrue(BlockState.CORRECT.placedFor(bundle, PayloadParserTest.FLUIDS)); assertTrue(BlockState.CORRECT.placedFor(bundle, -1));
        for (BlockState s : BlockState.values()) {
            if (s != BlockState.CORRECT && s != BlockState.INCOMPLETE) assertFalse(s.placedFor(bundle, PayloadParserTest.LINE), s.name());
        }
        // a block no step places is never placed for "every step" while INCOMPLETE
        PlannedBlock stray = PayloadParser.parse(new java.io.StringReader(PayloadParserTest.mutateBundles(o -> PayloadParserTest.block(o, 10)
            .add("step", com.google.gson.JsonNull.INSTANCE)))).blocks.get(10);
        assertFalse(BlockState.INCOMPLETE.placedFor(stray, -1));
    }

    @Test void returnsTheDueStepsInStepOrder() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        StepTracker t = new StepTracker(d, new HashSet<>());
        BlockState[] s = states(d, new FakeWorld().put(101, 64, 202, "gregtech:gt.blockmachines", 0, 21, 4).placeStepS1());   // block 2 is layout:power:stage:1's
        t.due(s, 0);
        assertEquals(Arrays.asList(S1, "layout:power:stage:1"), t.due(s, 1));
    }
}
