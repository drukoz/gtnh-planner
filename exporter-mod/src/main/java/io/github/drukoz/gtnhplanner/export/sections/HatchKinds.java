package io.github.drukoz.gtnhplanner.export.sections;

import java.util.Arrays;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;

/**
 * The hatch kinds the structures section probes on every element of a multiblock (exporter 0.6.0, architecture
 * §11.49, gt-mechanics.md §5.5) and the hatch of the pack that stands in for each. A kind is one GT hatch class,
 * matched by its exact simple name, so a subclass is never its superclass's kind (the steam buses extend the plain
 * ones, the laser target hatch the multi-amp energy hatch); two kinds also need a metaName prefix. Free of GregTech
 * classes, so JUnit can test it.
 */
final class HatchKinds {

    private HatchKinds() {}

    /** One kind: its wire name, GT's class (simple name) and the prefix the hatch's metaName must start with. */
    static final class Kind {

        final String name;
        final String cls;
        /** {@code null} when any metaName will do. */
        final String metaPrefix;

        Kind(String name, String cls, String metaPrefix) {
            this.name = name;
            this.cls = cls;
            this.metaPrefix = metaPrefix;
        }
    }

    /**
     * The 17 kinds, in the order a structure element lists them: the planner's {@code EXPORT_HATCH_KINDS} with the
     * classes and prefixes of its {@code EXPORT_HATCH_CLASSES} (src/shared/gt/hatch-kinds.ts), which
     * tests/unit/shared/hatch-kinds-java.test.ts compares with the lines below, one kind per line.
     * {@code MTEHatchCustomFluidBase} is the Steam Hatch and also the Cryotheum and Pyrotheum hatches, so
     * {@code steam_hatch} is only the one named {@code hatch.steam.…}; GT's plain dynamo adder also takes multi-amp
     * dynamos of at most 4 A, so {@code dynamo_multi} is only the 16 A ones.
     */
    static final List<Kind> ALL = Collections.unmodifiableList(Arrays.asList(new Kind[] {
        new Kind("input_bus", "MTEHatchInputBus", null),
        new Kind("output_bus", "MTEHatchOutputBus", null),
        new Kind("input_hatch", "MTEHatchInput", null),
        new Kind("output_hatch", "MTEHatchOutput", null),
        new Kind("energy", "MTEHatchEnergy", null),
        new Kind("energy_multi", "MTEHatchEnergyMulti", null),
        new Kind("energy_laser", "MTEHatchEnergyTunnel", null),
        new Kind("maintenance", "MTEHatchMaintenance", null),
        new Kind("muffler", "MTEHatchMuffler", null),
        new Kind("dynamo", "MTEHatchDynamo", null),
        new Kind("dynamo_multi", "MTEHatchDynamoMulti", "hatch.dynamomulti16."),
        new Kind("dynamo_laser", "MTEHatchDynamoTunnel", null),
        new Kind("steam_input_bus", "MTEHatchSteamBusInput", null),
        new Kind("steam_output_bus", "MTEHatchSteamBusOutput", null),
        new Kind("steam_hatch", "MTEHatchCustomFluidBase", "hatch.steam."),
        new Kind("data_access", "MTEHatchDataAccess", null),
        new Kind("coke_oven_hatch", "MTEHatchCokeOven", null),
    }));

    /** A hatch of the pack: its MTE id, the simple name of its class and its metaName. */
    static final class Candidate {

        final int id;
        final String cls;
        final String metaName;

        Candidate(int id, String cls, String metaName) {
            this.id = id;
            this.cls = cls;
            this.metaName = metaName;
        }
    }

    /**
     * Each kind's probe hatch: kind name → the lowest id among the candidates whose class is the kind's and whose
     * metaName starts with its prefix (when it has one), in the order of {@link #ALL}; a kind without a candidate is
     * left out. So {@code energy_multi} gets a 4 A hatch and {@code dynamo_multi} a 16 A one.
     */
    static LinkedHashMap<String, Integer> representatives(Iterable<Candidate> candidates) {
        Integer[] lowest = new Integer[ALL.size()];
        for (Candidate c : candidates) {
            for (int k = 0; k < lowest.length; k++) {
                if (isOf(ALL.get(k), c) && (lowest[k] == null || c.id < lowest[k])) lowest[k] = c.id;
            }
        }
        LinkedHashMap<String, Integer> probes = new LinkedHashMap<>();
        for (int k = 0; k < lowest.length; k++) {
            if (lowest[k] != null) probes.put(ALL.get(k).name, lowest[k]);
        }
        return probes;
    }

    private static boolean isOf(Kind kind, Candidate c) {
        return kind.cls.equals(c.cls)
            && (kind.metaPrefix == null || (c.metaName != null && c.metaName.startsWith(kind.metaPrefix)));
    }
}
