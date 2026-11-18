package io.github.drukoz.gtnhplanner.export.sections;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.io.StringWriter;

import org.junit.jupiter.api.Test;

import com.google.gson.stream.JsonWriter;

class BiomeLineTest {

    private static String json(int id, String name, float rainfall, boolean snow, boolean lightning)
        throws IOException {
        StringWriter text = new StringWriter();
        JsonWriter w = new JsonWriter(text);
        BiomeLine.write(w, id, name, rainfall, snow, lightning);
        w.close();
        return text.toString();
    }

    @Test
    void writesADesertWithNoRainAsOneLineOfTheBiomeTable() throws IOException {
        // a desert fails GregTech's rain check on both halves of it: no rainfall, and no snow and no lightning bolt
        assertEquals(
            "{\"id\":2,\"name\":\"Desert\",\"rainfall\":0.0,\"snow\":false,\"lightning\":false}",
            json(2, "Desert", 0.0f, false, false));
    }

    @Test
    void writesAnIcePlainsWithItsSnowAsOneLineOfTheBiomeTable() throws IOException {
        assertEquals(
            "{\"id\":12,\"name\":\"Ice Plains\",\"rainfall\":0.5,\"snow\":true,\"lightning\":false}",
            json(12, "Ice Plains", 0.5f, true, false));
    }
}
