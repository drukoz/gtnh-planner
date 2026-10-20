package io.github.drukoz.gtnhplanner.export.sections;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.function.IntUnaryOperator;

import org.junit.jupiter.api.Test;

class CropLineTest {

    private static CropLine.ItemRef indexed(String key, int index) {
        return CropLine.ItemRef.indexed(key, index);
    }

    @Test
    void writesACardAsOneLineOfTheCropTable() throws IOException {
        // Sticky Cane (farms.md §2.8); the item indices are invented
        String line = CropLine.json(
            "cropsnh:stickyCane",
            "Sticky Cane",
            4,
            200,
            0.81450625,
            Collections.singletonList(new CropLine.Drop(indexed("IC2:itemHarz@0", 2588), 1, 10000)),
            Arrays.asList("HOT", "SANDY", "WET"),
            Arrays.asList(indexed("t:soil@0", 12), indexed("t:soil@1", 40)),
            Collections.<String>emptyList(),
            null,
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
                new CropLine.Drop(indexed("t:wood@0", 7), 10, 3000),
                new CropLine.Drop(indexed("t:sapling@0", 3), 1, 6000),
                new CropLine.Drop(indexed("t:resin@0", 9), 2, 500)),
            Collections.<String>emptyList(),
            Collections.<CropLine.ItemRef>emptyList(),
            Arrays.asList("SubSoilRequirement", "MinLightLevelGrowthRequirement"),
            indexed("t:seed@0", 41),
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
    void writesAnItemTheItemTableLacksInlineWithItsKeyNameAndNbt() throws IOException {
        // the item table has the pad (index 76) but neither the berry, the soil nor the seed; the pad's chance is
        // written as it is, above 10000, as CropsNH's Water Lily has it
        CropLine.ItemRef seed = CropLine.ItemRef
            .inline("t:seed@0", "{crop:\"cropsnh:testBerry\"}", CropLine.seedName("Test Berry"));
        String line = CropLine.json(
            "cropsnh:testBerry",
            "Test Berry",
            2,
            500,
            0.9025,
            Arrays.asList(
                new CropLine.Drop(indexed("t:pad@0", 76), 2, 80000),
                new CropLine.Drop(CropLine.ItemRef.inline("t:berry@2", null, "Big Berry"), 1, 2500)),
            Collections.<String>emptyList(),
            Collections.singletonList(CropLine.ItemRef.inline("t:farmland@0", null, "Farmland")),
            Collections.<String>emptyList(),
            seed,
            0);
        assertEquals(
            "{\"id\":\"cropsnh:testBerry\",\"name\":\"Test Berry\",\"tier\":2,\"duration\":500,\"dropChance\":0.9025,"
                + "\"drops\":[{\"item\":76,\"count\":2,\"chance\":80000},"
                + "{\"item\":{\"key\":\"t:berry@2\",\"name\":\"Big Berry\"},\"count\":1,\"chance\":2500}],"
                + "\"liked\":[],\"soils\":[{\"key\":\"t:farmland@0\",\"name\":\"Farmland\"}],\"requirements\":[],"
                + "\"seed\":{\"key\":\"t:seed@0\",\"name\":\"Test Berry Seeds\",\"nbt\":\"{crop:\\\"cropsnh:testBerry\\\"}\"},"
                + "\"minSeedBedTier\":0}",
            line);
        // an inline item sorts by the key the item table would give it, NBT included, as an indexed one does
        assertEquals("t:seed@0#{crop:\"cropsnh:testBerry\"}", seed.key);
        assertTrue(seed.isInline());
        assertFalse(indexed("t:pad@0", 76).isInline());
    }

    @Test
    void namesASeedAfterItsCrop() {
        // CropsNH's own format, cropsnh_genericSeeds.format=%1$s Seeds, which an analyzed seed shows
        assertEquals("Sticky Cane Seeds", CropLine.seedName("Sticky Cane"));
    }

    @Test
    void writesASoilTheItemTableLacksAsTheVariantItsBlockDrops() {
        // a log block that drops meta & 3, but 1 for 2, the shape of Thaumcraft's BlockMagicalLog.damageDropped:
        // 4 and 8 are log 0 lying along x and along z, 5 and 9 are log 1
        IntUnaryOperator logDrops = meta -> (meta & 3) == 2 ? 1 : meta & 3;
        assertEquals(0, CropLine.soilMeta(4, logDrops.applyAsInt(4)));
        assertEquals(1, CropLine.soilMeta(5, logDrops.applyAsInt(5)));
        assertEquals(0, CropLine.soilMeta(8, logDrops.applyAsInt(8)));
        assertEquals(1, CropLine.soilMeta(9, logDrops.applyAsInt(9)));
        assertEquals(1, CropLine.soilMeta(1, logDrops.applyAsInt(1)));
        // a block registered without a meta: CropsNH writes the wildcard, any variant counts, and the line names variant 0
        assertEquals(0, CropLine.soilMeta(32767, CropLine.NOT_A_BLOCK));
        assertEquals(0, CropLine.soilMeta(32767, 5));
        // a stack whose item places no block keeps its meta
        assertEquals(3, CropLine.soilMeta(3, CropLine.NOT_A_BLOCK));
    }

    @Test
    void keepsTheMetaOfASoilWhoseBlockCannotSayWhatItDrops() {
        IntUnaryOperator logDrops = meta -> (meta & 3) == 2 ? 1 : meta & 3;
        assertEquals(1, CropLine.droppedMeta(logDrops, 9));
        // a mod's array lookup by meta, and a method that needs a class the dedicated server lacks (a LinkageError)
        IntUnaryOperator twoVariants = meta -> new int[] { 0, 1 }[meta];
        IntUnaryOperator clientClass = meta -> {
            throw new NoClassDefFoundError("net/minecraft/client/renderer/texture/IIconRegister");
        };
        for (IntUnaryOperator broken : Arrays.asList(twoVariants, clientClass)) {
            assertEquals(CropLine.NOT_A_BLOCK, CropLine.droppedMeta(broken, 6));
            assertEquals(6, CropLine.soilMeta(6, CropLine.droppedMeta(broken, 6)));
        }
    }

    @Test
    void namesEachSoilOnceInTheOrderOfItsKey() throws IOException {
        CropLine.ItemRef log0 = indexed("t:log@0", 10);
        CropLine.ItemRef log1 = indexed("t:log@1", 11);
        CropLine.ItemRef rotatedLog0 = indexed("t:log@0", 10); // CropsNH's log 4, written as the log it drops
        CropLine.ItemRef farmland = CropLine.ItemRef.inline("t:farmland@0", null, "Farmland");
        CropLine.ItemRef dirt = indexed("t:dirt@0", 5);
        List<CropLine.ItemRef> soils = CropLine.soils(Arrays.asList(log1, rotatedLog0, farmland, log0, dirt));
        List<String> keys = new ArrayList<>();
        for (CropLine.ItemRef soil : soils) keys.add(soil.key);
        assertEquals(Arrays.asList("t:dirt@0", "t:farmland@0", "t:log@0", "t:log@1"), keys);
        String line = CropLine.json(
            "cropsnh:testFern",
            "Test Fern",
            1,
            600,
            0.95,
            Collections.<CropLine.Drop>emptyList(),
            Collections.<String>emptyList(),
            soils,
            Collections.<String>emptyList(),
            null,
            -1);
        assertTrue(line.contains(",\"soils\":[5,{\"key\":\"t:farmland@0\",\"name\":\"Farmland\"},10,11],"), line);
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
            Collections.<CropLine.ItemRef>emptyList(),
            Collections.<String>emptyList(),
            null,
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
        CropLine.Drop wood = new CropLine.Drop(indexed("t:wood@0", 7), 10, 6000);
        CropLine.Drop sapling = new CropLine.Drop(indexed("t:sapling@0", 3), 1, 3000);
        CropLine.Drop resin = new CropLine.Drop(indexed("t:resin@0", 9), 2, 3000);
        CropLine.Drop moreResin = new CropLine.Drop(indexed("t:resin@0", 9), 4, 3000);
        CropLine.Drop berry = new CropLine.Drop(CropLine.ItemRef.inline("t:berry@2", null, "Big Berry"), 1, 3000);
        List<CropLine.Drop> expected = Arrays.asList(wood, berry, moreResin, resin, sapling);
        for (List<CropLine.Drop> arrival : Arrays.asList(
            Arrays.asList(resin, sapling, berry, moreResin, wood),
            Arrays.asList(sapling, wood, resin, moreResin, berry))) {
            List<CropLine.Drop> drops = new ArrayList<>(arrival);
            CropLine.sortDrops(drops);
            assertEquals(expected, drops); // the likeliest first, then by item key, then the larger stack first
        }
    }
}
