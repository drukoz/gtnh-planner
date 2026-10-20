package io.github.drukoz.gtnhplanner.export.sections;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.io.IOException;
import java.io.StringWriter;

import org.junit.jupiter.api.Test;

import com.google.gson.stream.JsonWriter;

class ItemSlotsTest {

    /** The members ItemSlots writes, in an object of their own. */
    private static String slots(int inputSlotCount, Object[] outputSlots) throws IOException {
        StringWriter s = new StringWriter();
        JsonWriter j = new JsonWriter(s);
        j.beginObject();
        ItemSlots.write(j, inputSlotCount, outputSlots);
        j.endObject();
        j.flush();
        return s.toString();
    }

    @Test
    void writesTheInputSlotCountAndTheNumberOfOutputSlots() throws IOException {
        assertEquals("{\"itemInSlots\":1,\"itemOutSlots\":1}", slots(1, new Object[1])); // the Advanced Macerator (302)
        assertEquals("{\"itemInSlots\":6,\"itemOutSlots\":1}", slots(6, new Object[1])); // the LV Assembler (211)
        assertEquals("{\"itemInSlots\":9,\"itemOutSlots\":1}", slots(9, new Object[1])); // the MV Assembler (212)
        assertEquals("{\"itemInSlots\":2,\"itemOutSlots\":4}", slots(2, new Object[4])); // several output slots
    }

    @Test
    void noOutputArrayCountsNoOutputSlot() throws IOException {
        assertEquals("{\"itemInSlots\":2,\"itemOutSlots\":0}", slots(2, null));
    }
}
