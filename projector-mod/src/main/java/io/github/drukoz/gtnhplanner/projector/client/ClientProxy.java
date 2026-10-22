package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.FMLCommonHandler;
import cpw.mods.fml.common.Loader;
import cpw.mods.fml.common.event.FMLInitializationEvent;
import io.github.drukoz.gtnhplanner.projector.CommonProxy;
import io.github.drukoz.gtnhplanner.projector.ProjectorMod;
import io.github.drukoz.gtnhplanner.projector.Tags;
import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.net.MainThreadQueue;
import io.github.drukoz.gtnhplanner.projector.net.PlannerClient;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import java.io.File;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import net.minecraftforge.client.ClientCommandHandler;
import net.minecraftforge.common.MinecraftForge;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

/**
 * The client side of the projector, where it is wired into the game (spec §3.13). A dedicated server never gets
 * here: its {@link CommonProxy} does nothing.
 */
public class ClientProxy extends CommonProxy {

    /** The projector's lines in the game log. */
    static final Logger LOG = LogManager.getLogger(ProjectorMod.MODID);

    /** The one thread every planner request runs on; a daemon, so it never keeps the game from closing. */
    private static final String HTTP_THREAD = "GTNH Planner projector HTTP";

    /**
     * Reads {@code config/gtnhplannerprojector.properties}, starts the HTTP thread, and registers the
     * {@code /planner} command, the ghost renderer, the aim outline and name tag, and the HUD lines on Forge's bus, and the tick and disconnect
     * handler on FML's bus (which carries tick and network events); the planner screen's opener goes on both, for its
     * key binding (a tick event) and its inventory button (GUI events).
     */
    @Override
    public void init(FMLInitializationEvent e) {
        File configFile = new File(Loader.instance().getConfigDir(), ProjectorConfig.FILE_NAME);
        ProjectorConfig config = ProjectorConfig.load(configFile);
        ExecutorService io = Executors.newSingleThreadExecutor(task -> {
            Thread thread = new Thread(task, HTTP_THREAD);
            thread.setDaemon(true);
            return thread;
        });
        MainThreadQueue queue = new MainThreadQueue();
        PlannerClient client = new PlannerClient(io, queue, "gtnhplannerprojector/" + Tags.VERSION);
        ProjectorSession session = new ProjectorSession(config, client, new McEnv());
        BlockIcons icons = new BlockIcons();
        ClientCommandHandler.instance.registerCommand(new PlannerCommand(session));
        MinecraftForge.EVENT_BUS.register(new GhostRenderer(session, config, icons));
        MinecraftForge.EVENT_BUS.register(new AimRenderer(session));
        MinecraftForge.EVENT_BUS.register(new HudOverlay(session));
        FMLCommonHandler.instance().bus().register(new ClientEvents(queue, session, icons));
        ScreenOpener opener = new ScreenOpener(session, config, icons);
        FMLCommonHandler.instance().bus().register(opener);
        MinecraftForge.EVENT_BUS.register(opener);
    }
}
