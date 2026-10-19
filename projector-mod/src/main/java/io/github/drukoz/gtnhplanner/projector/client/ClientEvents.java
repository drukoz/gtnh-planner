package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;
import cpw.mods.fml.common.network.FMLNetworkEvent;
import io.github.drukoz.gtnhplanner.projector.net.MainThreadQueue;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import net.minecraft.client.Minecraft;
import net.minecraft.world.World;

/**
 * The projector's clock and connection (on FML's bus, which carries tick and network events): the planner's answers
 * and the session's tick run on the game thread at the end of every client tick, and leaving a server forgets the
 * loaded line.
 */
public final class ClientEvents {

    private final MainThreadQueue queue;
    private final ProjectorSession session;
    private final BlockIcons icons;
    private final Minecraft mc = Minecraft.getMinecraft();

    /** The world the probe reads: one probe per world instance, so a dimension change gets a new one. */
    private World probeWorld;
    private McWorldProbe probe;
    /** Client ticks counted while in a world; the session checks the world every {@code checkIntervalTicks} of them. */
    private long tickCounter;
    private boolean failureLogged;

    public ClientEvents(MainThreadQueue queue, ProjectorSession session, BlockIcons icons) {
        this.queue = queue;
        this.session = session;
        this.icons = icons;
    }

    /** At the end of each client tick: the answers that arrived, then, in a world, the session's tick. */
    @SubscribeEvent
    public void onTick(TickEvent.ClientTickEvent e) {
        if (e.phase != TickEvent.Phase.END) return;
        queue.drain();
        World world = mc.theWorld;
        if (world == null || mc.thePlayer == null) {
            probeWorld = null; // no world kept alive from the main menu
            probe = null;
            return;
        }
        try {
            session.tick(probeFor(world), tickCounter++);
        } catch (RuntimeException failure) {
            if (!failureLogged) ClientProxy.LOG.error("The projector's tick failed", failure);
            failureLogged = true;
        }
    }

    /**
     * Fires on the network thread, so it only hands the work to the game thread: the session forgets the loaded line
     * and the block looks are found again for the next one.
     */
    @SubscribeEvent
    public void onDisconnect(FMLNetworkEvent.ClientDisconnectionFromServerEvent e) {
        queue.post(() -> {
            session.disconnected();
            icons.clear();
        });
    }

    private McWorldProbe probeFor(World world) {
        if (world != probeWorld) {
            probeWorld = world;
            probe = new McWorldProbe(world);
        }
        return probe;
    }
}
