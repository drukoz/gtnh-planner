package io.github.drukoz.gtnhplanner.projector;

import cpw.mods.fml.common.Mod;
import cpw.mods.fml.common.SidedProxy;
import cpw.mods.fml.common.event.FMLInitializationEvent;

/**
 * GTNH Planner projector: loads a planner project's layout with a per-project token and shows it in the world as
 * ghost blocks. Client-side only, through {@link SidedProxy} (FML 1.7.10's {@code @Mod} has no client-only flag): on
 * a dedicated server the {@link CommonProxy} does nothing, and {@code acceptableRemoteVersions = "*"} lets the client
 * join servers that do not have the mod.
 */
@Mod(
    modid = ProjectorMod.MODID,
    name = "GTNH Planner Projector",
    version = Tags.VERSION,
    acceptableRemoteVersions = "*",
    dependencies = "after:gregtech")
public class ProjectorMod {

    public static final String MODID = "gtnhplannerprojector";

    @SidedProxy(
        clientSide = "io.github.drukoz.gtnhplanner.projector.client.ClientProxy",
        serverSide = "io.github.drukoz.gtnhplanner.projector.CommonProxy")
    public static CommonProxy proxy;

    @Mod.EventHandler
    public void init(FMLInitializationEvent e) {
        proxy.init(e);
    }
}
