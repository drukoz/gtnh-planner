package io.github.drukoz.gtnhplanner.export;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Collections;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.zip.GZIPOutputStream;

import com.google.gson.stream.JsonWriter;

/** State shared by all sections of one export: the output folder, the item table, names, counts and warnings. */
public final class ExportContext {

    /** Warnings beyond this many are only logged, not kept for the manifest. */
    static final int MAX_WARNINGS = 500;

    private static final int BUFFER = 1 << 16;

    private final File dir;
    private final ItemTable items;
    private final NameResolver names = new NameResolver();
    private final Map<String, Long> counts = new LinkedHashMap<>();
    private final List<String> warnings = new ArrayList<>();
    private long warningTotal;

    public ExportContext(File dir) {
        this.dir = dir;
        this.items = new ItemTable(this);
    }

    public File dir() {
        return dir;
    }

    public ItemTable items() {
        return items;
    }

    public NameResolver names() {
        return names;
    }

    /** Opens {@link ExportFiles#fileName(String)}; closing the writer sets {@code counts[countKey]} to its lines. */
    public JsonlWriter jsonl(String countKey) throws IOException {
        return new JsonlWriter(openGzip(new File(dir, ExportFiles.fileName(countKey))), this, countKey);
    }

    /** Opens one gzip'd JSON document (not counted). The caller writes exactly one value and closes the writer. */
    public JsonWriter gzipJson(String fileName) throws IOException {
        return new JsonWriter(openGzip(new File(dir, fileName)));
    }

    /** Sets {@code counts[key] = n}. */
    public void count(String key, long n) {
        counts.put(key, n);
    }

    /** Logs a warning; the first {@value #MAX_WARNINGS} are kept for the manifest. */
    public void warn(String message) {
        warningTotal++;
        ExporterMod.LOG.warn(message);
        if (warnings.size() < MAX_WARNINGS) warnings.add(message);
    }

    /** Logs a line, such as a section's measured cost; unlike a warning, it is not kept for the manifest. */
    public void info(String message) {
        ExporterMod.LOG.info(message);
    }

    public Map<String, Long> counts() {
        return Collections.unmodifiableMap(counts);
    }

    public List<String> warnings() {
        return Collections.unmodifiableList(warnings);
    }

    /** Every warning, including those not kept for the manifest. */
    long warningTotal() {
        return warningTotal;
    }

    private static Writer openGzip(File file) throws IOException {
        FileOutputStream fos = new FileOutputStream(file);
        try {
            return new BufferedWriter(
                new OutputStreamWriter(new GZIPOutputStream(fos, BUFFER), StandardCharsets.UTF_8),
                BUFFER);
        } catch (IOException | RuntimeException e) {
            fos.close();
            throw e;
        }
    }
}
