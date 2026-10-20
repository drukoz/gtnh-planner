package io.github.drukoz.gtnhplanner.export.sections;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

class HatchKindsTest {

    @Test
    void listsTheSeventeenKindsOfThePlannerInItsOrder() {
        List<String> names = new ArrayList<>();
        for (HatchKinds.Kind k : HatchKinds.ALL) names.add(k.name);
        assertEquals(
            Arrays.asList("input_bus", "output_bus", "input_hatch", "output_hatch", "energy", "energy_multi",
                "energy_laser", "maintenance", "muffler", "dynamo", "dynamo_multi", "dynamo_laser", "steam_input_bus",
                "steam_output_bus", "steam_hatch", "data_access", "coke_oven_hatch"),
            names);
    }

    @Test
    void theSteamHatchAndTheSixteenAmpDynamoAlsoNeedAMetaNamePrefix() {
        HatchKinds.Kind steam = HatchKinds.ALL.get(14);
        assertEquals("steam_hatch", steam.name);
        assertEquals("MTEHatchCustomFluidBase", steam.cls);
        assertEquals("hatch.steam.", steam.metaPrefix);
        HatchKinds.Kind dynamoMulti = HatchKinds.ALL.get(10);
        assertEquals("dynamo_multi", dynamoMulti.name);
        assertEquals("MTEHatchDynamoMulti", dynamoMulti.cls);
        assertEquals("hatch.dynamomulti16.", dynamoMulti.metaPrefix);
    }

    @Test
    void eachKindIsProbedWithTheLowestIdOfItsClassAndPrefix() {
        List<HatchKinds.Candidate> candidates = Arrays.asList(
            new HatchKinds.Candidate(41, "MTEHatchEnergy", "hatch.energy.tier.01"),
            new HatchKinds.Candidate(40, "MTEHatchEnergy", "hatch.energy.tier.00"),
            new HatchKinds.Candidate(967, "MTEHatchCustomFluidBase", "hatch.cryotheum.input.tier.00"),
            new HatchKinds.Candidate(968, "MTEHatchCustomFluidBase", "hatch.pyrotheum.input.tier.00"),
            new HatchKinds.Candidate(31040, "MTEHatchCustomFluidBase", "hatch.steam.input.tier.00"),
            new HatchKinds.Candidate(2711, "MTEHatchInputBusME", "hatch.input_bus.me"),
            new HatchKinds.Candidate(15211, "MTEHatchDynamoMulti", "hatch.dynamomulti16.tier.06"),
            new HatchKinds.Candidate(15200, "MTEHatchDynamoMulti", "hatch.dynamomulti04.tier.05"),
            new HatchKinds.Candidate(15210, "MTEHatchDynamoMulti", "hatch.dynamomulti16.tier.05"),
            new HatchKinds.Candidate(71, "MTEHatchInputBus", "hatch.input_bus.tier.01"),
            new HatchKinds.Candidate(70, "MTEHatchInputBus", "hatch.input_bus.tier.00"));

        LinkedHashMap<String, Integer> probes = HatchKinds.representatives(candidates);

        // The 4 A dynamo 15200 is no candidate for dynamo_multi, the Cryotheum and Pyrotheum hatches none for
        // steam_hatch, the ME input bus none for input_bus; kinds without a candidate are left out.
        Map<String, Integer> expected = new LinkedHashMap<>();
        expected.put("input_bus", 70);
        expected.put("energy", 40);
        expected.put("dynamo_multi", 15210);
        expected.put("steam_hatch", 31040);
        assertEquals(expected, probes);
        assertEquals(Arrays.asList("input_bus", "energy", "dynamo_multi", "steam_hatch"), new ArrayList<>(probes.keySet()));
    }
}
