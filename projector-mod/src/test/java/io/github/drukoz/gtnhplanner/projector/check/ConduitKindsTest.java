package io.github.drukoz.gtnhplanner.projector.check;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class ConduitKindsTest {
    // EnderIO 2.10.46: ItemItemConduit.createConduit makes an ItemConduit; ItemLiquidConduit.createConduit makes, by meta
    // 2 to 6, the ender fluid conduits the planner names liquid_ender to liquid_stellar (FLUID_CONDUITS)
    @Test void namesTheConduitsThePlannerLaysAsThePlannerDoes() {
        assertEquals("item", ConduitKinds.of("crazypants.enderio.conduit.item.ItemConduit"));
        assertEquals("liquid_ender", ConduitKinds.of("crazypants.enderio.conduit.liquid.EnderLiquidConduit"));
        assertEquals("liquid_crystalline", ConduitKinds.of("crazypants.enderio.conduit.liquid.CrystallineEnderLiquidConduit"));
        assertEquals("liquid_pink_slime", ConduitKinds.of("crazypants.enderio.conduit.liquid.CrystallinePinkSlimeEnderLiquidConduit"));
        assertEquals("liquid_melodic", ConduitKinds.of("crazypants.enderio.conduit.liquid.MelodicEnderLiquidConduit"));
        assertEquals("liquid_stellar", ConduitKinds.of("crazypants.enderio.conduit.liquid.StellarEnderLiquidConduit"));
    }

    @Test void keepsTheClassNameOfAnyOtherConduit() {
        // a pressurized or plain fluid conduit, a redstone conduit: none is a part the planner lays
        for (String other : new String[] {"crazypants.enderio.conduit.liquid.AdvancedLiquidConduit", "crazypants.enderio.conduit.liquid.LiquidConduit",
            "crazypants.enderio.conduit.redstone.InsulatedRedstoneConduit", ""}) {
            assertEquals(other, ConduitKinds.of(other));
        }
    }
}
