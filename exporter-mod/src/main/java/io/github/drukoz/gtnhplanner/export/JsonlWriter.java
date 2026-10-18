package io.github.drukoz.gtnhplanner.export;

import java.io.Closeable;
import java.io.IOException;
import java.io.StringWriter;
import java.io.Writer;

import com.google.gson.stream.JsonWriter;

/**
 * One gzip'd JSON Lines file. Each {@link #begin()}/{@link #end()} pair writes one top-level JSON value and then
 * {@code '\n'}. The value is buffered until {@code end()}, so an element that throws half-way leaves no broken line:
 * the next {@code begin()} drops the partial value. On {@link #close()} the context's count for this file is set to
 * the number of lines written.
 */
public final class JsonlWriter implements Closeable {

    private final Writer out;
    private final ExportContext ctx;
    private final String countKey;
    private final StringWriter line = new StringWriter(256);
    private JsonWriter current;
    private long lines;
    private boolean closed;

    JsonlWriter(Writer out, ExportContext ctx, String countKey) {
        this.out = out;
        this.ctx = ctx;
        this.countKey = countKey;
    }

    /** Starts a new line and returns the writer for its one JSON value (an object or an array). */
    public JsonWriter begin() {
        if (closed) throw new IllegalStateException(countKey + ": writer is closed");
        line.getBuffer().setLength(0);
        current = new JsonWriter(line);
        return current;
    }

    /** Appends the value started by {@link #begin()} as one line; fails if the value is incomplete. */
    public void end() throws IOException {
        JsonWriter w = current;
        if (w == null) throw new IllegalStateException(countKey + ": end() without begin()");
        current = null;
        w.close(); // throws "Incomplete document" unless exactly one complete top-level value was written
        out.append(line.getBuffer());
        out.write('\n');
        lines++;
    }

    /** Lines written so far. */
    public long lines() {
        return lines;
    }

    @Override
    public void close() throws IOException {
        if (closed) return;
        closed = true;
        current = null;
        out.close();
        ctx.count(countKey, lines);
    }
}
