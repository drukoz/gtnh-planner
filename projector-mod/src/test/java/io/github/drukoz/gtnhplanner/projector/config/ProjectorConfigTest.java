package io.github.drukoz.gtnhplanner.projector.config;

import static org.junit.jupiter.api.Assertions.*;
import java.io.*;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.Arrays;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class ProjectorConfigTest {
    @TempDir Path dir;

    @Test void defaultsWhenTheFileIsMissing() {
        ProjectorConfig c = ProjectorConfig.load(dir.resolve("none.properties").toFile());
        assertEquals("", c.plannerUrl());
        assertNull(c.token("P1"));
        assertEquals(96, c.maxDistance()); assertEquals(20, c.checkIntervalTicks()); assertEquals(60, c.refreshSeconds());
        assertEquals(0.4f, c.ghostAlpha(), 1e-6); assertFalse(c.seeThrough()); assertTrue(c.useDisplayLists());
    }

    @Test void savesAndLoadsTokensPerProject() throws IOException {
        File f = dir.resolve(ProjectorConfig.FILE_NAME).toFile();
        ProjectorConfig c = ProjectorConfig.load(f);
        c.setToken("P1", "gpt_one"); c.setToken("P2", "gpt_two"); c.setPlannerUrl("https://planner.example.org"); c.setSeeThrough(true);
        c.save();
        ProjectorConfig back = ProjectorConfig.load(f);
        assertEquals("gpt_one", back.token("P1")); assertEquals("gpt_two", back.token("P2"));
        assertEquals("https://planner.example.org", back.plannerUrl()); assertTrue(back.seeThrough());
        assertFalse(new File(f.getPath() + ".tmp").exists());
        assertTrue(new String(Files.readAllBytes(f.toPath()), StandardCharsets.ISO_8859_1).contains("keep this file private"));
    }

    @Test void badNumbersFallBackAndOutOfRangeValuesAreClamped() throws IOException {
        File f = dir.resolve("c.properties").toFile();
        Files.write(f.toPath(), Arrays.asList("maxDistance=lots", "checkIntervalTicks=1", "refreshSeconds=99999", "ghostAlpha=2"), StandardCharsets.ISO_8859_1);
        ProjectorConfig c = ProjectorConfig.load(f);
        assertEquals(96, c.maxDistance()); assertEquals(5, c.checkIntervalTicks()); assertEquals(3600, c.refreshSeconds());
        assertEquals(0.9f, c.ghostAlpha(), 1e-6);
    }

    @Test void savesEverySettingKeepsUnknownKeysAndForgetsBlankTokens() throws IOException {
        File f = dir.resolve("c.properties").toFile();
        Files.write(f.toPath(), Arrays.asList("token.P1=gpt_one", "token.P2=", "futureSetting=kept", "useDisplayLists=off", "ghostAlpha=NaN", "maxDistance=99999999999"), StandardCharsets.ISO_8859_1);
        ProjectorConfig c = ProjectorConfig.load(f);
        assertNull(c.token("P2")); assertTrue(c.useDisplayLists()); assertEquals(0.4f, c.ghostAlpha(), 1e-6); assertEquals(512, c.maxDistance());
        c.setToken("P1", null); c.setToken("P3", "  ");
        c.save();
        List<String> lines = Files.readAllLines(f.toPath(), StandardCharsets.ISO_8859_1);
        assertEquals("#GTNH Planner Projector. Each token gives access to one planner project: keep this file private.", lines.get(0));
        for (String line : new String[] {"plannerUrl=", "maxDistance=512", "checkIntervalTicks=20", "refreshSeconds=60", "ghostAlpha=0.4", "seeThrough=false", "useDisplayLists=true", "futureSetting=kept"})
            assertTrue(lines.contains(line), line);
        assertFalse(lines.stream().anyMatch(l -> l.startsWith("token.P1") || l.startsWith("token.P3")), lines.toString());
        ProjectorConfig back = ProjectorConfig.load(f);
        assertNull(back.token("P1")); assertNull(back.token("P2")); assertNull(back.token("P3"));
    }
}
