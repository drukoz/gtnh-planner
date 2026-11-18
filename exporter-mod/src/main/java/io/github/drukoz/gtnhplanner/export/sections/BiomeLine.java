package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;

import com.google.gson.stream.JsonWriter;

/**
 * One line of {@code biomes.jsonl.gz} ({@code BiomeLine} in format.ts): a biome's raw weather fields, from which the
 * planner works out GregTech's rain check on its own ({@code gt-mechanics.md} §3.4a: {@code rainfall > 0} and
 * {@code canSpawnLightningBolt()} or {@code getEnableSnow()}), so a line in a biome that fails it needs no rain roof.
 * Free of Minecraft classes, so JUnit can test it.
 */
final class BiomeLine {

    private BiomeLine() {}

    /**
     * Writes one line: a JSON object with the fields of format.ts's {@code BiomeLine} in its order. {@code rainfall} is
     * written as a {@link Float}, so it prints the way {@code Float.toString} writes it ({@code 0.4}, {@code 0.0}).
     */
    static void write(JsonWriter j, int id, String name, float rainfall, boolean snow, boolean lightning)
        throws IOException {
        j.beginObject();
        j.name("id").value(id);
        j.name("name").value(name);
        j.name("rainfall").value(Float.valueOf(rainfall));
        j.name("snow").value(snow);
        j.name("lightning").value(lightning);
        j.endObject();
    }
}
