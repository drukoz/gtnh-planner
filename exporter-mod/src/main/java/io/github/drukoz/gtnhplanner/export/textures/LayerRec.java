package io.github.drukoz.gtnhplanner.export.textures;

import java.io.IOException;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.List;
import java.util.Objects;

import com.google.gson.stream.JsonWriter;

/**
 * One layer of a face or icon, as the {@code DumpLayer} of the {@code textures.json.gz} wire format:
 * {@code {"p":[…],"rgb":[r,g,b],"glow":1}} (candidate paths, first extracted one wins),
 * {@code {"ts":[base,baseFallback,overlay,overlayFallback],"rgb":[…]}} (a GT texture set, {@code ""} = none),
 * {@code {"copy":[block,meta,side]}} (looks like another block's face) or {@code {"err":"<class>"}} (a texture class
 * the exporter could not read). {@code rgb} is a multiply tint and is left out when null (untinted).
 */
public final class LayerRec {

    private enum Kind {
        PATHS,
        TEXTURE_SET,
        COPY,
        ERROR
    }

    private final Kind kind;
    /** PATHS: candidate data/assets-relative paths. TEXTURE_SET: base, base fallback, overlay, overlay fallback. */
    private final List<String> parts;
    private final int[] rgb;
    private final boolean glow;
    /** COPY: block registry name. ERROR: class name. */
    private final String name;
    private final int meta, side;

    private LayerRec(Kind kind, List<String> parts, int[] rgb, boolean glow, String name, int meta, int side) {
        if (rgb != null && rgb.length != 3) throw new IllegalArgumentException("rgb needs 3 values");
        this.kind = kind;
        this.parts = parts;
        this.rgb = rgb == null ? null : rgb.clone();
        this.glow = glow;
        this.name = name;
        this.meta = meta;
        this.side = side;
    }

    /** Candidate paths, first extracted one wins; {@code rgb} null = untinted; {@code glow} = full-bright. */
    public static LayerRec paths(List<String> candidates, int[] rgb, boolean glow) {
        List<String> copy = Collections.unmodifiableList(new ArrayList<>(candidates));
        return new LayerRec(Kind.PATHS, copy, rgb, glow, null, 0, 0);
    }

    /** A GT texture set; null parts are written as {@code ""}. */
    public static LayerRec textureSet(String base, String baseFallback, String overlay, String overlayFallback,
        int[] rgb) {
        List<String> ts = Collections.unmodifiableList(Arrays.asList(base, baseFallback, overlay, overlayFallback));
        return new LayerRec(Kind.TEXTURE_SET, ts, rgb, false, null, 0, 0);
    }

    /**
     * Looks like block {@code block} (registry name; null when it could not be named) meta {@code meta}, face
     * {@code side}.
     */
    public static LayerRec copy(String block, int meta, int side) {
        return new LayerRec(Kind.COPY, Collections.<String>emptyList(), null, false, block, meta, side);
    }

    /** A texture object of class {@code className} that the exporter could not read. */
    public static LayerRec error(String className) {
        return new LayerRec(Kind.ERROR, Collections.<String>emptyList(), null, false, className, 0, 0);
    }

    /**
     * The base image candidates when this layer stands in as a fallback: a paths layer's candidates, or a texture
     * set's base and base fallback; nothing for copy and error layers.
     */
    List<String> baseCandidates() {
        if (kind == Kind.PATHS) return parts;
        List<String> base = new ArrayList<>();
        if (kind == Kind.TEXTURE_SET) {
            for (String p : parts.subList(0, 2)) if (p != null) base.add(p);
        }
        return base;
    }

    /** Writes this layer as one JSON object. */
    public void write(JsonWriter w) throws IOException {
        w.beginObject();
        switch (kind) {
            case PATHS:
                w.name("p");
                w.beginArray();
                for (String p : parts) w.value(p);
                w.endArray();
                writeRgb(w);
                if (glow) {
                    w.name("glow");
                    w.value(1);
                }
                break;
            case TEXTURE_SET:
                w.name("ts");
                w.beginArray();
                for (String p : parts) w.value(p == null ? "" : p);
                w.endArray();
                writeRgb(w);
                break;
            case COPY:
                w.name("copy");
                w.beginArray();
                w.value(name);
                w.value(meta);
                w.value(side);
                w.endArray();
                break;
            default:
                w.name("err");
                w.value(name);
        }
        w.endObject();
    }

    private void writeRgb(JsonWriter w) throws IOException {
        if (rgb == null) return;
        w.name("rgb");
        w.beginArray();
        for (int c : rgb) w.value(c);
        w.endArray();
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof LayerRec)) return false;
        LayerRec r = (LayerRec) o;
        return kind == r.kind && glow == r.glow
            && meta == r.meta
            && side == r.side
            && parts.equals(r.parts)
            && Arrays.equals(rgb, r.rgb)
            && Objects.equals(name, r.name);
    }

    @Override
    public int hashCode() {
        return Objects.hash(kind, parts, Arrays.hashCode(rgb), glow, name, meta, side);
    }

    /** The JSON form, as {@link #write} gives it. */
    @Override
    public String toString() {
        StringWriter s = new StringWriter();
        try {
            JsonWriter w = new JsonWriter(s);
            write(w);
            w.flush();
        } catch (IOException e) {
            throw new IllegalStateException(e); // a StringWriter does not throw
        }
        return s.toString();
    }
}
