package io.github.drukoz.gtnhplanner.export.sections;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.io.StringWriter;
import java.util.Arrays;
import java.util.Collections;

import org.junit.jupiter.api.Test;

import com.google.gson.stream.JsonWriter;

class ElementLineTest {

    @Test
    void writesTheElementsAndTheElementOfEveryBlockIntoTheLine() throws IOException {
        StringWriter s = new StringWriter();
        JsonWriter j = new JsonWriter(s);
        j.beginObject();
        ElementLine.write(
            j,
            Arrays.asList(
                new ElementLine("b", Arrays.asList("input_bus", "energy")),
                new ElementLine(null, Collections.<String>emptyList())),
            new int[] { -1, 0, 1, 0 });
        j.endObject();
        j.flush();
        assertEquals(
            "{\"elements\":[{\"ch\":\"b\",\"hatches\":[\"input_bus\",\"energy\"]},{\"hatches\":[]}],"
                + "\"elementOf\":[-1,0,1,0]}",
            s.toString());
    }
}
