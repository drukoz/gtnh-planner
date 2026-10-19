package io.github.drukoz.gtnhplanner.projector.net;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class PlannerUrlTest {
    @Test void defaultIsTheMinecraftServerHostOnPort8765() {
        assertEquals("http://mc.example.org:8765", PlannerUrl.defaultFor("mc.example.org:25565"));
        assertEquals("http://mc.example.org:8765", PlannerUrl.defaultFor("mc.example.org"));
        assertEquals("http://192.0.2.10:8765", PlannerUrl.defaultFor("192.0.2.10:25566"));
        assertEquals("http://[2001:db8::1]:8765", PlannerUrl.defaultFor("[2001:db8::1]:25565"));
        assertEquals("http://[2001:db8::1]:8765", PlannerUrl.defaultFor("2001:db8::1"));
        assertEquals("http://127.0.0.1:8765", PlannerUrl.defaultFor(null));
        assertEquals("http://127.0.0.1:8765", PlannerUrl.defaultFor("  "));
    }

    @Test void anOverrideWins() {
        assertEquals("https://planner.example.org/gp", PlannerUrl.effective(" https://planner.example.org/gp/ ", "mc.example.org"));
        assertEquals("http://mc.example.org:8765", PlannerUrl.effective("", "mc.example.org"));
    }

    @Test void normalizesTypedAddresses() {
        assertEquals("http://192.0.2.10:9000", PlannerUrl.normalize("192.0.2.10:9000"));
        assertEquals("https://planner.example.org", PlannerUrl.normalize("https://planner.example.org/"));
        assertEquals("Not a planner address: ftp://x", assertThrows(IllegalArgumentException.class, () -> PlannerUrl.normalize("ftp://x")).getMessage());
        assertThrows(IllegalArgumentException.class, () -> PlannerUrl.normalize("http://"));
    }

    @Test void buildsProjectPaths() {
        assertEquals("http://h:8765/api/projects/P%20x/projector", PlannerUrl.projectPath("http://h:8765", "P x", "/projector"));
        assertEquals("A%20B%C3%A9", PlannerUrl.encode("A Bé"));
    }

    @Test void readsOddServerAddressesAndRefusesNonAddresses() {
        assertEquals("127.0.0.1", PlannerUrl.hostOf(":25565"));
        assertEquals("mc.example.org", PlannerUrl.hostOf(" mc.example.org:25565 "));
        assertEquals("[::1]", PlannerUrl.hostOf("[::1]"));
        assertEquals("http://planner.example.org:9000/gp", PlannerUrl.normalize(" planner.example.org:9000/gp// "));
        assertEquals("Not a planner address: not an address", assertThrows(IllegalArgumentException.class, () -> PlannerUrl.normalize("not an address")).getMessage());
        assertEquals("Not a planner address: ftp://x", assertThrows(IllegalArgumentException.class, () -> PlannerUrl.effective("ftp://x", "mc.example.org")).getMessage());
    }
}
