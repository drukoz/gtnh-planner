package io.github.drukoz.gtnhplanner.export;

import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.Map;

/**
 * File names of the export, by count key: the {@code EXPORT_FILES} table of {@code src/server/pack/format.ts}
 * without {@code manifest} (see {@link Manifest}). Both tables must stay identical.
 */
public final class ExportFiles {

    private static final Map<String, String> FILES;

    static {
        Map<String, String> m = new LinkedHashMap<>();
        m.put("items", "items.jsonl.gz");
        m.put("fluids", "fluids.jsonl.gz");
        m.put("fluidContainers", "fluid-containers.jsonl.gz");
        m.put("oreDict", "oredict.jsonl.gz");
        m.put("recipeMaps", "recipe-maps.jsonl.gz");
        m.put("recipesGt", "recipes-gt.jsonl.gz");
        m.put("recipesAssemblyLine", "recipes-assemblyline.jsonl.gz");
        m.put("recipesCrafting", "recipes-crafting.jsonl.gz");
        m.put("recipesFurnace", "recipes-furnace.jsonl.gz");
        m.put("machines", "machines.jsonl.gz");
        m.put("structures", "structures.jsonl.gz");
        m.put("materials", "materials.jsonl.gz");
        m.put("oreMaterials", "ore-materials.jsonl.gz");
        m.put("dimensions", "dimensions.jsonl.gz");
        m.put("celestial", "celestial.jsonl.gz");
        m.put("oreVeins", "ore-veins.jsonl.gz");
        m.put("smallOres", "small-ores.jsonl.gz");
        m.put("undergroundFluids", "underground-fluids.jsonl.gz");
        m.put("voidMiner", "void-miner.jsonl.gz");
        m.put("gasSiphon", "gas-siphon.jsonl.gz");
        m.put("spacePump", "space-pump.jsonl.gz");
        m.put("spaceAsteroids", "space-asteroids.jsonl.gz");
        FILES = Collections.unmodifiableMap(m);
    }

    private ExportFiles() {}

    /** The file name for a count key, e.g. {@code "fluidContainers"} → {@code "fluid-containers.jsonl.gz"}. */
    public static String fileName(String countKey) {
        String name = FILES.get(countKey);
        if (name == null) throw new IllegalArgumentException("unknown export file key: " + countKey);
        return name;
    }
}
