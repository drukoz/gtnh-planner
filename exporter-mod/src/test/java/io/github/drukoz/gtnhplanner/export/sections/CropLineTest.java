package io.github.drukoz.gtnhplanner.export.sections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.Test;

class CropLineTest {

    @Test
    void writesACardAsOneLineOfTheCropTable() throws IOException {
        // Sticky Cane (farms.md §2.8); the item indices are invented
        String line = CropLine.json(
            "cropsnh:stickyCane",
            "Sticky Cane",
            4,
            200,
            0.81450625,
            Collections.singletonList(new CropLine.Drop("IC2:itemHarz@0", 2588, 1, 10000)),
            Arrays.asList("HOT", "SANDY", "WET"),
            Arrays.asList(12, 40),
            Collections.<String>emptyList(),
            CropLine.NO_SEED,
            0);
        assertEquals(
            "{\"id\":\"cropsnh:stickyCane\",\"name\":\"Sticky Cane\",\"tier\":4,\"duration\":200,"
                + "\"dropChance\":0.81450625,\"drops\":[{\"item\":2588,\"count\":1,\"chance\":10000}],"
                + "\"liked\":[\"HOT\",\"SANDY\",\"WET\"],\"soils\":[12,40],\"requirements\":[],\"seed\":null,"
                + "\"minSeedBedTier\":0}",
            line);
    }

    @Test
    void keepsTheOrderOfItsDropsAndWritesRequirementsAndTheSeed() throws IOException {
        String line = CropLine.json(
            "cropsnh:testBonsai",
            "Test Bonsai",
            1,
            1200,
            0.95,
            Arrays.asList(
                new CropLine.Drop("t:wood@0", 7, 10, 3000),
                new CropLine.Drop("t:sapling@0", 3, 1, 6000),
                new CropLine.Drop("t:resin@0", 9, 2, 500)),
            Collections.<String>emptyList(),
            Collections.<Integer>emptyList(),
            Arrays.asList("SubSoilRequirement", "MinLightLevelGrowthRequirement"),
            41,
            -1);
        assertEquals(
            "{\"id\":\"cropsnh:testBonsai\",\"name\":\"Test Bonsai\",\"tier\":1,\"duration\":1200,\"dropChance\":0.95,"
                + "\"drops\":[{\"item\":7,\"count\":10,\"chance\":3000},{\"item\":3,\"count\":1,\"chance\":6000},"
                + "{\"item\":9,\"count\":2,\"chance\":500}],\"liked\":[],\"soils\":[],"
                + "\"requirements\":[\"SubSoilRequirement\",\"MinLightLevelGrowthRequirement\"],\"seed\":41,"
                + "\"minSeedBedTier\":-1}",
            line);
    }

    @Test
    void writesADropChanceThatIsNoNumberAsNullAndCallsSuchACardInvalid() throws IOException {
        String line = CropLine.json(
            "cropsnh:broken",
            "Broken",
            1,
            600,
            Double.NaN,
            Collections.<CropLine.Drop>emptyList(),
            Collections.<String>emptyList(),
            Collections.<Integer>emptyList(),
            Collections.<String>emptyList(),
            CropLine.NO_SEED,
            -1);
        assertTrue(line.contains(",\"dropChance\":null,"), line);
        assertFalse(CropLine.valid("cropsnh:broken", Double.NaN));
        assertFalse(CropLine.valid("cropsnh:broken", Double.POSITIVE_INFINITY));
        assertFalse(CropLine.valid(null, 0.95));
        assertFalse(CropLine.valid("", 0.95));
        assertTrue(CropLine.valid("cropsnh:stickyCane", 0.81450625));
    }

    @Test
    void ordersADropTableTheSameWhateverOrderItArrivesIn() {
        // CropsNH keeps a card's drops in a HashMap keyed by ItemStack: they arrive in a different order on every run
        CropLine.Drop wood = new CropLine.Drop("t:wood@0", 7, 10, 6000);
        CropLine.Drop sapling = new CropLine.Drop("t:sapling@0", 3, 1, 3000);
        CropLine.Drop resin = new CropLine.Drop("t:resin@0", 9, 2, 3000);
        CropLine.Drop moreResin = new CropLine.Drop("t:resin@0", 9, 4, 3000);
        List<CropLine.Drop> expected = Arrays.asList(wood, moreResin, resin, sapling);
        for (List<CropLine.Drop> arrival : Arrays.asList(
            Arrays.asList(resin, sapling, moreResin, wood),
            Arrays.asList(sapling, wood, resin, moreResin))) {
            List<CropLine.Drop> drops = new ArrayList<>(arrival);
            CropLine.sortDrops(drops);
            assertEquals(expected, drops); // the likeliest first, then by item key, then the larger stack first
        }
    }
}
