package io.github.drukoz.gtnhplanner.projector.check;

import java.util.Collections;
import java.util.HashMap;
import java.util.Map;

/**
 * The planner's names of the EnderIO conduits a line lays ({@code ConduitKind} in {@code src/shared/types/layout.ts}, the
 * {@code parts} of a conduit bundle), by the class of the conduit in the bundle (EnderIO 2.10.46: the Item Conduit item
 * makes an {@code ItemConduit}, the fluid conduit item an {@code EnderLiquidConduit} and its tiers by meta 2 to 6; the
 * client reads each conduit of a bundle back as that class, {@code ConduitUtil.readConduitFromNBT}).
 */
public final class ConduitKinds {

    private static final String ITEM = "crazypants.enderio.conduit.item.", LIQUID = "crazypants.enderio.conduit.liquid.";
    private static final Map<String, String> KINDS;

    static {
        Map<String, String> kinds = new HashMap<>();
        kinds.put(ITEM + "ItemConduit", "item");
        kinds.put(LIQUID + "EnderLiquidConduit", "liquid_ender");
        kinds.put(LIQUID + "CrystallineEnderLiquidConduit", "liquid_crystalline");
        kinds.put(LIQUID + "CrystallinePinkSlimeEnderLiquidConduit", "liquid_pink_slime");
        kinds.put(LIQUID + "MelodicEnderLiquidConduit", "liquid_melodic");
        kinds.put(LIQUID + "StellarEnderLiquidConduit", "liquid_stellar");
        KINDS = Collections.unmodifiableMap(kinds);
    }

    private ConduitKinds() {}

    /**
     * The planner's kind of the conduit of class {@code className}; any other conduit keeps its class name, which no part
     * is.
     */
    public static String of(String className) {
        String kind = KINDS.get(className);
        return kind == null ? className : kind;
    }
}
