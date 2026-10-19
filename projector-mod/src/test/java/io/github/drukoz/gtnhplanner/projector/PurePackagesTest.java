package io.github.drukoz.gtnhplanner.projector;

import static org.junit.jupiter.api.Assertions.assertEquals;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.*;
import java.util.*;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

class PurePackagesTest {
    @Test void purePackagesDoNotTouchTheGame() throws IOException {
        Path root = Paths.get("src/main/java/io/github/drukoz/gtnhplanner/projector");
        List<String> bad = new ArrayList<>();
        for (String pkg : new String[] {"config", "net", "model", "geom", "view", "check", "session"}) {
            Path dir = root.resolve(pkg);
            if (!Files.isDirectory(dir)) continue;
            try (Stream<Path> files = Files.walk(dir)) {
                for (Path f : (Iterable<Path>) files.filter(p -> p.toString().endsWith(".java"))::iterator)
                    for (String line : Files.readAllLines(f, StandardCharsets.UTF_8))
                        if (line.matches("^import (static )?(net\\.minecraft|net\\.minecraftforge|cpw\\.mods|gregtech)\\..*")) bad.add(f.getFileName() + ": " + line);
            }
        }
        assertEquals(Collections.emptyList(), bad);
    }
}
