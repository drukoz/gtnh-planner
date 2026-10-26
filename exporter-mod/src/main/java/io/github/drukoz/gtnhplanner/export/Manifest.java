package io.github.drukoz.gtnhplanner.export;

import java.io.BufferedWriter;
import java.io.File;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.OutputStreamWriter;
import java.io.Writer;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.time.temporal.ChronoUnit;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import net.minecraftforge.common.ForgeVersion;

import com.google.gson.stream.JsonWriter;

import cpw.mods.fml.common.Loader;
import cpw.mods.fml.common.ModContainer;

/** {@code manifest.json}: plain UTF-8 JSON with every field of {@code ManifestFile} in format.ts. */
public final class Manifest {

    public static final String FORMAT = "gtnh-planner-export/2";
    public static final String FILE_NAME = "manifest.json";

    private Manifest() {}

    public static void write(ExportContext ctx, Map<String, Long> sectionMillis, List<String> failedSections,
        List<String> skippedSections) throws IOException {
        Map<String, String> mods = new TreeMap<>();
        for (ModContainer mod : Loader.instance().getModList()) {
            mods.put(mod.getModId(), mod.getVersion() != null ? mod.getVersion() : "unknown");
        }
        String gtVersion = mods.containsKey("gregtech") ? mods.get("gregtech") : "unknown";
        // Forge's own values, both readable on a dedicated server: the Minecraft dummy container of the mod list
        // carries the running MC version, ForgeVersion the Forge version
        ModContainer mcContainer = Loader.instance().getMinecraftModContainer();
        String mcVersion = mcContainer != null && mcContainer.getVersion() != null ? mcContainer.getVersion() : "unknown";
        String loader = "forge-" + ForgeVersion.getVersion();
        NameResolver names = ctx.names();

        Writer out = new BufferedWriter(
            new OutputStreamWriter(new FileOutputStream(new File(ctx.dir(), FILE_NAME)), StandardCharsets.UTF_8));
        try (JsonWriter w = new JsonWriter(out)) {
            w.setIndent("  ");
            w.beginObject();
            w.name("format").value(FORMAT);
            w.name("exportId").value(ctx.dir().getName());
            w.name("exporterVersion").value(Tags.VERSION);
            w.name("exportedAt").value(Instant.now().truncatedTo(ChronoUnit.SECONDS).toString());
            w.name("packVersion").value(System.getProperty("gtnhplanner.packVersion", "unknown"));
            w.name("gtVersion").value(gtVersion);
            w.name("mcVersion").value(mcVersion);
            w.name("loader").value(loader);
            w.name("mods").beginObject();
            for (Map.Entry<String, String> e : mods.entrySet()) w.name(e.getKey()).value(e.getValue());
            w.endObject();
            w.name("counts").beginObject();
            for (Map.Entry<String, Long> e : ctx.counts().entrySet()) w.name(e.getKey()).value(e.getValue());
            w.endObject();
            w.name("nameFailures").value(names.failures());
            strings(w, "nameFailureSamples", names.failureSamples());
            w.name("sectionMillis").beginObject();
            for (Map.Entry<String, Long> e : sectionMillis.entrySet()) w.name(e.getKey()).value(e.getValue());
            w.endObject();
            strings(w, "failedSections", failedSections);
            strings(w, "skippedSections", skippedSections);
            strings(w, "warnings", ctx.warnings());
            w.endObject();
            w.flush();
            out.write('\n');
        }
    }

    private static void strings(JsonWriter w, String name, Iterable<String> values) throws IOException {
        w.name(name).beginArray();
        for (String v : values) w.value(v);
        w.endArray();
    }
}
