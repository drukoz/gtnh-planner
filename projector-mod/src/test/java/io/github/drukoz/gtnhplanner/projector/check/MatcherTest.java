package io.github.drukoz.gtnhplanner.projector.check;

import static io.github.drukoz.gtnhplanner.projector.check.BlockState.*;
import static org.junit.jupiter.api.Assertions.*;
import io.github.drukoz.gtnhplanner.projector.model.*;
import org.junit.jupiter.api.Test;

class MatcherTest {
    static final String GT = "gregtech:gt.blockmachines";
    private static PlannedBlock b(int i) throws Exception { return PayloadParserTest.sample().blocks.get(i); }

    @Test void gtMachinesAreCheckedByIdAndFront() throws Exception {
        PlannedBlock mac = b(3);   // 102 64 201, mteId 201, facing 3
        assertEquals(CORRECT, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 5, 201, 3)));        // block meta is not compared
        assertEquals(WRONG_BLOCK, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 202, 3)));
        assertEquals(WRONG_FACING, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 201, 2)));
        assertEquals(CORRECT, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 201, -1)));
        assertEquals(WRONG_BLOCK, Matcher.check(mac, new FakeWorld().put(102, 64, 201, "minecraft:stone", 0, WorldProbe.NO_TILE, -1)));
        assertEquals(MISSING, Matcher.check(mac, new FakeWorld()));
    }

    @Test void aGtMachineWhoseTileDataIsNotSyncedCountsAsUnloaded() throws Exception {
        assertEquals(UNLOADED, Matcher.check(b(3), new FakeWorld().put(102, 64, 201, GT, 0, WorldProbe.NOT_SYNCED, -1)));
    }

    @Test void anUnloadedBlockIsNeitherRightNorWrong() throws Exception {
        assertEquals(UNLOADED, Matcher.check(b(3), new FakeWorld().put(102, 64, 201, "minecraft:stone", 0, -1, -1).unload(102, 64, 201)));
    }

    @Test void metaCountsOnlyWhereThePlannerAsks() throws Exception {
        FakeWorld w = new FakeWorld(); w.known.add("gregtech:gt.blockcasings");
        assertEquals(CORRECT, Matcher.check(b(9), w.put(103, 65, 203, "gregtech:gt.blockcasings", 11, -1, -1)));
        assertEquals(WRONG_BLOCK, Matcher.check(b(9), w.put(103, 65, 203, "gregtech:gt.blockcasings", 12, -1, -1)));
        assertEquals(CORRECT, Matcher.check(b(6), new FakeWorld().put(104, 64, 202, "minecraft:chest", 3, -1, -1)));
        assertEquals(CORRECT, Matcher.check(b(8), new FakeWorld().put(105, 64, 202, "ForgeMultipart:block", 0, -1, -1)));
    }

    @Test void aBlockTheClientDoesNotKnowCantBeChecked() throws Exception {
        assertEquals(UNCHECKED, Matcher.check(b(9), new FakeWorld().put(103, 65, 203, "minecraft:stone", 0, -1, -1)));
    }

    @Test void buildCheckReportsChanges() throws Exception {
        BuildCheck c = new BuildCheck(PayloadParserTest.sample());
        assertEquals(UNLOADED, c.state(0));
        FakeWorld w = new FakeWorld().placeStepS1();
        assertTrue(c.run(w)); assertEquals(1, c.version()); assertEquals(CORRECT, c.state(3)); assertEquals(MISSING, c.state(0));
        assertFalse(c.run(w)); assertEquals(1, c.version());
        assertTrue(c.run(w.remove(103, 64, 201))); assertEquals(MISSING, c.state(4)); assertEquals(2, c.version());
    }

    @Test void comparesTheFrontOnlyWhereThePlannerAsksAndTheMachineBeforeIt() throws Exception {
        assertEquals(CORRECT, Matcher.check(b(0), new FakeWorld().put(100, 64, 201, GT, 0, 1180, 2)));                    // block 0's front is not compared
        assertEquals(WRONG_BLOCK, Matcher.check(b(3), new FakeWorld().put(102, 64, 201, GT, 0, WorldProbe.NO_TILE, 3)));  // a GT block without its machine
        assertEquals(WRONG_BLOCK, Matcher.check(b(3), new FakeWorld().put(102, 64, 201, GT, 0, 202, 2)));                // another machine, turned too
    }

    // The review of the EnderIO In / Out fix: a single-block machine's own front is where the payload says, or GT takes
    // no energy there (isInputFacing) and the ghost, the 3D view and the place step disagree with the machine.
    @Test void checksASingleBlockMachinesOwnFrontToo() throws Exception {
        PlannedBlock mac = b(3);   // output side south (3), front west (4)
        assertEquals(CORRECT, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 201, 3, 4)));
        assertEquals(WRONG_FACING, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 201, 3, 5)));
        assertEquals(WRONG_FACING, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 201, 2, 4)));
        assertEquals(CORRECT, Matcher.check(mac, new FakeWorld().put(102, 64, 201, GT, 0, 201, 3, -1)));                    // not known yet
        assertEquals(CORRECT, Matcher.check(b(2), new FakeWorld().put(101, 64, 202, GT, 0, 21, 4, 5)));                     // a transformer has none to check
    }

    @Test void anUnloadedBlockIsNotCalledUncheckable() throws Exception {
        assertEquals(UNLOADED, Matcher.check(b(9), new FakeWorld().unload(103, 65, 203)));   // block 9's name is unknown to this client
    }

    // The review of the EnderIO single pipe: the mod compared a bundle by its block alone, so a bundle of the line with only
    // its Item Conduit was "placed correctly", for the fluids step as well, before any Ender Fluid Conduit was placed.
    @Test void checksEveryConduitOfABundle() throws Exception {
        PlannedBlock bundle = PayloadParserTest.bundleSample().blocks.get(10);   // 106 64 202: Item Conduit (line step), Ender Fluid Conduit (fluids step)
        assertEquals(INCOMPLETE, Matcher.check(bundle, new FakeWorld().bundle(106, 64, 202, "item")));        // its own step's conduit only
        assertEquals(CORRECT, Matcher.check(bundle, new FakeWorld().bundle(106, 64, 202, "liquid_ender", "item")));
        assertEquals(CORRECT, Matcher.check(bundle, new FakeWorld().bundle(106, 64, 202, "item", "liquid_ender", "crazypants.enderio.conduit.redstone.InsulatedRedstoneConduit")));
        assertEquals(MISSING, Matcher.check(bundle, new FakeWorld().bundle(106, 64, 202, "liquid_ender")));   // the conduit its own step lays is missing
        assertEquals(INCOMPLETE, Matcher.check(bundle, new FakeWorld().bundle(106, 64, 202, "item", "liquid_crystalline")));   // another tier is not the planned conduit
        assertEquals(UNLOADED, Matcher.check(bundle, new FakeWorld().bundle(106, 64, 202)));                  // its conduits have not reached the client
        FakeWorld blind = new FakeWorld().bundle(106, 64, 202, "item", "liquid_ender"); blind.conduitsUnreadable = true;
        assertEquals(UNCHECKED, Matcher.check(bundle, blind));
        assertEquals(MISSING, Matcher.check(bundle, new FakeWorld()));
        assertEquals(WRONG_BLOCK, Matcher.check(bundle, new FakeWorld().put(106, 64, 202, "minecraft:stone", 0, WorldProbe.NO_TILE, -1)));
        // a block with one part is still checked by its container block only
        assertEquals(CORRECT, Matcher.check(b(8), new FakeWorld().put(105, 64, 202, "ForgeMultipart:block", 0, -1, -1)));
        // parts the planner sent without their steps are all its own step's
        PlannedBlock own = PayloadParser.parse(new java.io.StringReader(PayloadParserTest.mutateBundles(o -> PayloadParserTest.block(o, 10).remove("partSteps")))).blocks.get(10);
        assertEquals(MISSING, Matcher.check(own, new FakeWorld().bundle(106, 64, 202, "item")));
    }

    @Test void buildCheckFollowsABundlesConduits() throws Exception {
        BuildCheck c = new BuildCheck(PayloadParserTest.bundleSample());
        FakeWorld w = new FakeWorld().placeLine("item");
        c.run(w); assertEquals(INCOMPLETE, c.state(10)); assertEquals(INCOMPLETE, c.state(11));
        assertTrue(c.run(w.placeLine("item", "liquid_ender"))); assertEquals(CORRECT, c.state(10)); assertEquals(CORRECT, c.state(11));
    }
}
