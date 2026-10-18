package io.github.drukoz.gtnhplanner.export;

import java.io.File;
import java.io.IOException;
import java.io.PrintWriter;
import java.io.StringWriter;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;

import net.minecraft.server.MinecraftServer;

import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;

/**
 * Runs the export once, on the server thread, at the end of the {@code gtnhplanner.exportDelayTicks}-th server tick
 * (default 100) after {@code FMLServerStartedEvent}: by then GT's {@code onServerStarting} recipe rewrite and the
 * first-world-tick tasks are done (export-mod.md §5.5). Then it writes {@code EXPORT_OK} or {@code EXPORT_FAILED} and
 * shuts the server down unless {@code -Dgtnhplanner.exitAfterExport=false}.
 */
public final class ExportTrigger {

    public static final String MARKER_OK = "EXPORT_OK";
    public static final String MARKER_FAILED = "EXPORT_FAILED";

    private final File dir;
    private final int delayTicks;
    private final boolean exitAfterExport;
    private int endTicks;
    private boolean done;

    public ExportTrigger(File dir) {
        this.dir = dir;
        this.delayTicks = Integer.getInteger("gtnhplanner.exportDelayTicks", 100);
        this.exitAfterExport = !"false".equalsIgnoreCase(System.getProperty("gtnhplanner.exitAfterExport", "true").trim());
    }

    @SubscribeEvent
    public void onServerTick(TickEvent.ServerTickEvent e) {
        if (done || e.phase != TickEvent.Phase.END) return;
        if (++endTicks < delayTicks) return;
        done = true;
        runExport();
    }

    private void runExport() {
        ExporterMod.LOG.info("export to {} starts (server tick {})", dir, endTicks);
        long start = System.nanoTime();
        Throwable failure = null;
        try {
            dir.mkdirs();
            new Exporter(dir).runAll();
        } catch (Throwable t) {
            failure = t;
        }
        long ms = (System.nanoTime() - start) / 1_000_000L;
        try {
            if (failure == null) {
                writeMarker(MARKER_OK, "OK " + ms + "ms\n");
                ExporterMod.LOG.info("export finished in {} ms", ms);
            } else {
                writeMarker(MARKER_FAILED, "FAILED " + ms + "ms\n" + stackTrace(failure));
                ExporterMod.LOG.error("export failed after " + ms + " ms", failure);
            }
        } catch (Throwable t) {
            ExporterMod.LOG.error("could not write the export marker in " + dir, t);
        }
        if (exitAfterExport) {
            ExporterMod.LOG.info("shutting the server down (gtnhplanner.exitAfterExport)");
            MinecraftServer server = MinecraftServer.getServer();
            if (server != null) server.initiateShutdown();
        }
    }

    /** Writes the marker under a temporary name and renames it, so a reader never sees a half-written marker. */
    private void writeMarker(String name, String text) throws IOException {
        Path target = new File(dir, name).toPath();
        Path tmp = new File(dir, name + ".tmp").toPath();
        Files.write(tmp, text.getBytes(StandardCharsets.UTF_8));
        Files.move(tmp, target, StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
    }

    private static String stackTrace(Throwable t) {
        StringWriter s = new StringWriter();
        PrintWriter p = new PrintWriter(s);
        t.printStackTrace(p);
        p.flush();
        return s.toString();
    }
}
