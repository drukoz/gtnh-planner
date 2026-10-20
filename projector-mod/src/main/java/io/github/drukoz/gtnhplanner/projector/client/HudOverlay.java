package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import java.util.List;
import net.minecraftforge.client.event.RenderGameOverlayEvent;

/**
 * The projector's lines at the top left of the screen (spec §3.13): how far the build has got, the last refresh or
 * drawing failure, the block being found, the ghosts under the crosshair and what the current step still needs.
 */
public final class HudOverlay {

    private final ProjectorSession session;
    private boolean failureLogged;

    public HudOverlay(ProjectorSession session) {
        this.session = session;
    }

    /**
     * Adds the session's HUD lines: the build summary, the finding, the ghosts under the crosshair and what the
     * current step still needs.
     */
    @SubscribeEvent
    public void onText(RenderGameOverlayEvent.Text e) {
        try {
            List<String> lines = session.hudLines();
            if (lines.isEmpty()) return;
            e.left.addAll(lines);
        } catch (RuntimeException failure) {
            if (!failureLogged) ClientProxy.LOG.error("The projector's HUD lines failed", failure);
            failureLogged = true;
        }
    }
}
