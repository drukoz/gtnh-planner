package io.github.drukoz.gtnhplanner.projector.view;

import static org.junit.jupiter.api.Assertions.*;
import io.github.drukoz.gtnhplanner.projector.model.*;
import java.util.*;
import org.junit.jupiter.api.Test;

class ViewFilterTest {
    private static List<Integer> shown(ProjectorData d, ViewFilter f) { List<Integer> r = new ArrayList<>(); for (int i = 0; i < d.blocks.size(); i++) if (f.shows(d.blocks.get(i))) r.add(i); return r; }

    @Test void filtersByLayerAndStep() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertEquals(10, shown(d, ViewFilter.ALL).size());
        assertEquals(Arrays.asList(7, 9), shown(d, ViewFilter.ALL.withLayer(65)));
        assertEquals(Arrays.asList(3, 4), shown(d, ViewFilter.ALL.withStep(1)));
        assertEquals(Collections.emptyList(), shown(d, ViewFilter.ALL.withLayer(65).withStep(1)));
        assertEquals("layer y=64, step 7: Lay 1× Tin Item Pipe along the middle r…", ViewFilter.ALL.withLayer(64).withStep(6).describe(d));
        assertEquals(ViewFilter.ALL.withLayer(64), new ViewFilter(64, -1));
        assertTrue(ViewFilter.ALL.withLayer(64).withLayer(null).isAll());
    }

    @Test void culledByDistanceFromTheBlockCentre() throws Exception {
        PlannedBlock b = PayloadParserTest.sample().blocks.get(3);   // 102 64 201
        assertTrue(ViewFilter.within(b, 102.5, 64.5, 297.5, 96));
        assertFalse(ViewFilter.within(b, 102.5, 64.5, 297.6, 96));
    }

    // Beyond the brief: each part of the description, value equality, a block without a step, straight-line distance.

    @Test void describesEachPartAndShortensOnlyALongStepText() throws Exception {
        ProjectorData d = PayloadParserTest.sample();
        assertEquals("", ViewFilter.ALL.describe(d));
        assertEquals("layer y=65", ViewFilter.ALL.withLayer(65).describe(d));
        assertEquals("step 8: Lay 1× Bronze Fluid Pipe for Water", ViewFilter.ALL.withStep(7).describe(d));
        assertEquals("step 2: Place 2× Basic Macerator facing the mid…", ViewFilter.ALL.withStep(1).describe(d));
    }

    @Test void filtersAreEqualByValueAndAnyNegativeStepMeansEveryStep() {
        assertEquals(new ViewFilter(200, 3), ViewFilter.ALL.withStep(3).withLayer(200));   // 200 is outside Integer's cache
        assertEquals(new ViewFilter(200, 3).hashCode(), ViewFilter.ALL.withLayer(200).withStep(3).hashCode());
        assertNotEquals(ViewFilter.ALL.withLayer(64), ViewFilter.ALL.withLayer(65));
        assertNotEquals(ViewFilter.ALL.withStep(1), ViewFilter.ALL.withStep(2));
        assertNotEquals(ViewFilter.ALL.withStep(1), ViewFilter.ALL.withLayer(1));
        assertNotEquals(ViewFilter.ALL, null);
        assertEquals(ViewFilter.ALL, new ViewFilter(null, -7)); assertEquals(-1, ViewFilter.ALL.withStep(-7).stepIndex);
        assertFalse(ViewFilter.ALL.withStep(0).isAll()); assertFalse(ViewFilter.ALL.withLayer(0).isAll());
    }

    @Test void aStepFilterHidesABlockThatNoStepPlaces() throws Exception {
        ProjectorData d = PayloadParser.parse(new java.io.StringReader(PayloadParserTest.mutate(o -> PayloadParserTest.block(o, 0).add("step", com.google.gson.JsonNull.INSTANCE))));
        assertTrue(ViewFilter.ALL.shows(d.blocks.get(0))); assertTrue(ViewFilter.ALL.withLayer(64).shows(d.blocks.get(0)));
        assertEquals(Collections.emptyList(), shown(d, ViewFilter.ALL.withStep(5)));   // block 0 was the only block of step 6
    }

    @Test void distanceIsAStraightLineFromTheBlockCentre() throws Exception {
        PlannedBlock b = PayloadParserTest.sample().blocks.get(3);   // centre 102.5 64.5 201.5
        assertTrue(ViewFilter.within(b, 105.5, 68.5, 201.5, 5));     // 3 across and 4 up: 5 away
        assertFalse(ViewFilter.within(b, 105.5, 68.5, 201.5, 4.999));
        assertTrue(ViewFilter.within(b, 102.5, 64.5, 201.5, 0));
    }
}
