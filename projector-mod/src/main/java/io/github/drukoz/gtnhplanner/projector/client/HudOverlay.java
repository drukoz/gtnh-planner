package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import io.github.drukoz.gtnhplanner.projector.geom.Facing;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.util.MovingObjectPosition;
import net.minecraftforge.client.event.RenderGameOverlayEvent;

/**
 * The projector's lines at the top left of the screen (spec §3.13): how far the build has got, the last refresh or
 * drawing failure, and what the planned block under the crosshair needs.
 */
public final class HudOverlay {

    /**
     * A crosshair on a block. Looked up by name: a vanilla enum constant keeps its name in the game's runtime (SRG)
     * names, and {@code exporter-mod/scripts/check-reobf.sh} refuses every {@code net/minecraft} member it does not
     * see renamed.
     */
    private static final MovingObjectPosition.MovingObjectType BLOCK_HIT =
        MovingObjectPosition.MovingObjectType.valueOf("BLOCK");

    private final ProjectorSession session;
    private final Minecraft mc = Minecraft.getMinecraft();
    private boolean failureLogged;

    public HudOverlay(ProjectorSession session) {
        this.session = session;
    }

    /**
     * Adds the session's HUD lines, then, while the crosshair is on a block, what the planned block there needs, or
     * else the planned block in front of the face looked at (where a block that is not placed yet goes).
     */
    @SubscribeEvent
    public void onText(RenderGameOverlayEvent.Text e) {
        try {
            List<String> lines = session.hudLines();
            if (lines.isEmpty()) return;
            e.left.addAll(lines);
            String looking = lookingAt(mc.objectMouseOver);
            if (looking != null) e.left.add(looking);
        } catch (RuntimeException failure) {
            if (!failureLogged) ClientProxy.LOG.error("The projector's HUD lines failed", failure);
            failureLogged = true;
        }
    }

    private String lookingAt(MovingObjectPosition hit) {
        if (hit == null || hit.typeOfHit != BLOCK_HIT) return null;
        String text = session.lookingAt(hit.blockX, hit.blockY, hit.blockZ);
        if (text != null) return text;
        int[] step = Facing.offset(hit.sideHit); // sideHit is numbered like ForgeDirection
        return session.lookingAt(hit.blockX + step[0], hit.blockY + step[1], hit.blockZ + step[2]);
    }
}
