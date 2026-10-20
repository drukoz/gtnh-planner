package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import com.google.gson.stream.JsonWriter;

/**
 * One element of a probed structure, as its structure line carries it (wire rule "Structure elements", architecture
 * §11.49): its shape character when the definition names one, and the hatch kinds GT's own structure check took on
 * the element's probe cell. Free of GregTech classes, so JUnit can test it.
 */
final class ElementLine {

    /** The element's shape character; {@code null} when unknown. */
    final String ch;
    /** Kind names, in the order of {@link HatchKinds#ALL}. */
    final List<String> hatches;

    ElementLine(String ch, List<String> hatches) {
        this.ch = ch;
        this.hatches = Collections.unmodifiableList(new ArrayList<>(hatches));
    }

    /**
     * Writes the members {@code "elements":[…]} (one object per element, {@code ch} left out when null) and
     * {@code "elementOf":[…]} (one integer per block of the line: its element's index, or −1) into the object
     * {@code j} is in.
     */
    static void write(JsonWriter j, List<ElementLine> elements, int[] elementOf) throws IOException {
        j.name("elements").beginArray();
        for (ElementLine e : elements) {
            j.beginObject();
            if (e.ch != null) j.name("ch").value(e.ch);
            j.name("hatches").beginArray();
            for (String kind : e.hatches) j.value(kind);
            j.endArray();
            j.endObject();
        }
        j.endArray();
        j.name("elementOf").beginArray();
        for (int element : elementOf) j.value(element);
        j.endArray();
    }
}
