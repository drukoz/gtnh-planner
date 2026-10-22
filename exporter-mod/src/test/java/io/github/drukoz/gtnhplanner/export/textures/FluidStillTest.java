package io.github.drukoz.gtnhplanner.export.textures;

import static org.junit.jupiter.api.Assertions.assertEquals;

import java.util.HashMap;
import java.util.Map;
import org.junit.jupiter.api.Test;

public class FluidStillTest {
    private static Map<String, String> map(String... kv) {
        Map<String, String> m = new HashMap<>();
        for (int i = 0; i < kv.length; i += 2) m.put(kv[i], kv[i + 1]);
        return m;
    }
    private static Object run(Map<String, String> own, Map<String, String> from, String start) {
        return FluidStill.location(start, own::get, f -> from.get(f));
    }
    @Test public void ownLocationWithoutIconsFrom() { assertEquals("a.png", run(map("a", "a.png"), map(), "a")); }
    @Test public void followsIconsFromToTheEnd() {
        assertEquals("gas.png", run(map("cracked", "cracked.png", "gas", "gas.png"), map("cracked", "gas"), "cracked"));
        assertEquals("c.png", run(map("a", "a.png", "b", "b.png", "c", "c.png"), map("a", "b", "b", "c"), "a"));
    }
    @Test public void aLoopEndsOnTheStartingFluid() { assertEquals("a.png", run(map("a", "a.png", "b", "b.png"), map("a", "b", "b", "a"), "a")); }
}
