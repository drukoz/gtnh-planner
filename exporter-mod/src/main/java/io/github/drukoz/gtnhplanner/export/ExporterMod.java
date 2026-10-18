package io.github.drukoz.gtnhplanner.export;

import java.io.File;

import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

import cpw.mods.fml.common.FMLCommonHandler;
import cpw.mods.fml.common.Mod;
import cpw.mods.fml.common.event.FMLServerStartedEvent;

/**
 * GTNH Planner exporter. Inert unless the JVM is started with {@code -Dgtnhplanner.exportDir=<absolute path>}: then it
 * exports the pack's items, fluids, recipes, machines and worldgen into that folder and stops the server
 * ({@link ExportTrigger}). Meant only for a throwaway copy of a server, never a live one.
 */
@Mod(
    modid = "gtnhplannerexport",
    name = "GTNH Planner Exporter",
    version = Tags.VERSION,
    acceptableRemoteVersions = "*",
    dependencies = "required-after:gregtech")
public class ExporterMod {

    public static final String MODID = "gtnhplannerexport";

    static final Logger LOG = LogManager.getLogger(MODID);

    /** Registers the export trigger when {@code gtnhplanner.exportDir} is set; does nothing otherwise. */
    @Mod.EventHandler
    public void onServerStarted(FMLServerStartedEvent e) {
        String dir = System.getProperty("gtnhplanner.exportDir");
        if (dir == null || dir.trim().isEmpty()) return;
        File exportDir = new File(dir.trim()).getAbsoluteFile();
        LOG.info("gtnhplanner.exportDir is set: exporting to {}", exportDir);
        FMLCommonHandler.instance().bus().register(new ExportTrigger(exportDir));
    }
}
