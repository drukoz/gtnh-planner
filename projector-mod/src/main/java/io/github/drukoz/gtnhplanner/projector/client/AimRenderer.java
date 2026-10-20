package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.eventhandler.EventPriority;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.FontRenderer;
import net.minecraft.client.renderer.OpenGlHelper;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.client.renderer.entity.RenderManager;
import net.minecraft.entity.EntityLivingBase;
import net.minecraft.util.Vec3;
import net.minecraftforge.client.event.RenderWorldLastEvent;
import org.lwjgl.opengl.GL11;

/**
 * Shows where the player aims (spec §3.13): each frame it takes the camera's eye and look, as vanilla's crosshair does,
 * gives them to the session, and draws an outline and a name tag on the ghost under the crosshair and on the ghost
 * being found. Both are drawn without the depth test, so they read through walls. The found block is drawn even when
 * the ghosts are hidden or filtered out, at any distance; the aimed one only when the session aims at it (it does not
 * while the ghosts are hidden). Runs after {@link GhostRenderer}. Anything that fails stops this drawing until the game
 * restarts and says so on the HUD. Used on the render thread, which is the game thread.
 */
public final class AimRenderer {

    private static final float[] AIMED = {1f, 1f, 0.33f}, FOUND = {0.33f, 1f, 1f};
    private static final float LINE_WIDTH = 3f;
    /** The outline stands this far outside the block. */
    private static final double GROW = 0.01;
    /** The tag's bottom edge is this far above the block's top face. */
    private static final double TAG_RAISE = 0.25;
    private static final float TAG_SCALE = 0.025f;
    /** Beyond this many blocks the tag keeps the size it has here. */
    private static final double TAG_FULL_SIZE_DISTANCE = 12;
    /** The tag's pixels per text line, and the space around the text. */
    private static final int LINE_HEIGHT = 10, PADDING = 2;
    /** A block farther than this many blocks is drawn at this distance, scaled down, so the far clipping plane cannot cut it. */
    private static final double DRAW_CAP = 64;
    private static final String FAILED = "Aim outline drawing failed: %s";

    private final ProjectorSession session;
    private final Minecraft mc = Minecraft.getMinecraft();
    /** Set once anything failed: nothing is drawn any more. */
    private boolean failed;
    /** Set once aiming threw, so it is logged once. */
    private boolean aimFailed;

    public AimRenderer(ProjectorSession session) {
        this.session = session;
    }

    @SubscribeEvent(priority = EventPriority.LOW)
    public void onRenderLast(RenderWorldLastEvent e) {
        if (!session.visibleHere()) return;
        EntityLivingBase camera = mc.renderViewEntity;
        if (camera == null || mc.theWorld == null) return;
        // aiming goes on after a drawing failure, so the HUD's lists and the finding stay right
        try {
            Vec3 position = camera.getPosition(e.partialTicks);
            Vec3 look = camera.getLook(e.partialTicks);
            double[] eye = {position.xCoord, position.yCoord, position.zCoord};
            session.aim(eye, new double[] {look.xCoord, look.yCoord, look.zCoord}, new McAimStops(mc.theWorld));
        } catch (Throwable failure) {
            if (!aimFailed) ClientProxy.LOG.error("Aiming failed", failure);
            aimFailed = true;
            return;
        }
        if (failed) return;
        try {
            ProjectorData data = session.data();
            if (data == null) return;
            int found = session.found();
            int aimed = session.aimed();
            if (found < 0 && aimed < 0) return;
            double t = e.partialTicks;
            double[] cam = {
                camera.lastTickPosX + (camera.posX - camera.lastTickPosX) * t,
                camera.lastTickPosY + (camera.posY - camera.lastTickPosY) * t,
                camera.lastTickPosZ + (camera.posZ - camera.lastTickPosZ) * t};
            draw(data, found, aimed, cam, e.partialTicks);
        } catch (Throwable failure) {
            fail(failure);
        }
    }

    /**
     * Draws the found block, then the aimed one (when it is another), without lighting, the lightmap, texturing for the
     * outline, face culling, the alpha test, depth writes or the depth test. Every GL flag it changes is put back as it
     * was, the lightmap only if it was on, as {@link GhostRenderer} does.
     */
    private void draw(ProjectorData data, int found, int aimed, double[] cam, float partialTicks) {
        boolean blend = GL11.glIsEnabled(GL11.GL_BLEND);
        boolean lighting = GL11.glIsEnabled(GL11.GL_LIGHTING);
        boolean cull = GL11.glIsEnabled(GL11.GL_CULL_FACE);
        boolean depth = GL11.glIsEnabled(GL11.GL_DEPTH_TEST);
        boolean alphaTest = GL11.glIsEnabled(GL11.GL_ALPHA_TEST);
        boolean texture = GL11.glIsEnabled(GL11.GL_TEXTURE_2D);
        OpenGlHelper.setActiveTexture(OpenGlHelper.lightmapTexUnit);
        boolean lightmap = GL11.glIsEnabled(GL11.GL_TEXTURE_2D);
        OpenGlHelper.setActiveTexture(OpenGlHelper.defaultTexUnit);
        mc.entityRenderer.disableLightmap(partialTicks);
        try {
            GL11.glEnable(GL11.GL_BLEND);
            OpenGlHelper.glBlendFunc(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, 1, 0);
            GL11.glDisable(GL11.GL_LIGHTING);
            GL11.glDisable(GL11.GL_CULL_FACE);
            GL11.glDisable(GL11.GL_ALPHA_TEST);
            GL11.glDisable(GL11.GL_DEPTH_TEST);
            GL11.glDepthMask(false);
            if (found >= 0) drawBlock(data, found, FOUND, cam);
            if (aimed >= 0 && aimed != found) drawBlock(data, aimed, AIMED, cam);
        } finally {
            restore(GL11.GL_BLEND, blend);
            restore(GL11.GL_LIGHTING, lighting);
            restore(GL11.GL_CULL_FACE, cull);
            restore(GL11.GL_DEPTH_TEST, depth);
            restore(GL11.GL_ALPHA_TEST, alphaTest);
            restore(GL11.GL_TEXTURE_2D, texture);
            GL11.glDepthMask(true);
            GL11.glLineWidth(1f);
            GL11.glColor4f(1f, 1f, 1f, 1f);
            if (lightmap) mc.entityRenderer.enableLightmap(partialTicks);
        }
    }

    private void drawBlock(ProjectorData data, int index, float[] colour, double[] cam) {
        PlannedBlock b = data.blocks.get(index);
        double dx = b.x - cam[0], dy = b.y - cam[1], dz = b.z - cam[2];
        double distance = Math.sqrt((dx + 0.5) * (dx + 0.5) + (dy + 0.5) * (dy + 0.5) + (dz + 0.5) * (dz + 0.5));
        GL11.glPushMatrix();
        try {
            if (distance > DRAW_CAP) {
                // pulled in along the line of sight and shrunk by the same factor: the same look, never clipped
                double k = DRAW_CAP / distance;
                GL11.glTranslated(dx * k, dy * k, dz * k);
                GL11.glScaled(k, k, k);
            } else {
                GL11.glTranslated(dx, dy, dz);
            }
            outline(colour);
            tag(session.tagLines(index), distance);
        } finally {
            GL11.glPopMatrix();
        }
    }

    /** The block's twelve edges, grown by {@link #GROW}. */
    private static void outline(float[] colour) {
        double x0 = -GROW, y0 = -GROW, z0 = -GROW;
        double x1 = 1 + GROW, y1 = 1 + GROW, z1 = 1 + GROW;
        GL11.glDisable(GL11.GL_TEXTURE_2D);
        GL11.glLineWidth(LINE_WIDTH);
        Tessellator t = Tessellator.instance;
        t.startDrawing(GL11.GL_LINES);
        try {
            t.setColorRGBA_F(colour[0], colour[1], colour[2], 1f);
            edge(t, x0, y0, z0, x1, y0, z0);
            edge(t, x0, y1, z0, x1, y1, z0);
            edge(t, x0, y0, z1, x1, y0, z1);
            edge(t, x0, y1, z1, x1, y1, z1);
            edge(t, x0, y0, z0, x0, y1, z0);
            edge(t, x1, y0, z0, x1, y1, z0);
            edge(t, x0, y0, z1, x0, y1, z1);
            edge(t, x1, y0, z1, x1, y1, z1);
            edge(t, x0, y0, z0, x0, y0, z1);
            edge(t, x1, y0, z0, x1, y0, z1);
            edge(t, x0, y1, z0, x0, y1, z1);
            edge(t, x1, y1, z0, x1, y1, z1);
        } finally {
            t.draw();
        }
    }

    private static void edge(Tessellator t, double x0, double y0, double z0, double x1, double y1, double z1) {
        t.addVertex(x0, y0, z0);
        t.addVertex(x1, y1, z1);
    }

    /**
     * The lines centred above the block (in block-local coordinates, its corner at the origin), the first at the top, turned to face the camera like a player's name tag, on a
     * dark background. Its scale is {@link #TAG_SCALE} × max(1, distance / 12), so it stops shrinking beyond 12 blocks.
     */
    private void tag(List<String> lines, double distance) {
        if (lines.isEmpty()) return;
        FontRenderer font = mc.fontRenderer;
        double bottom = 1 + TAG_RAISE;
        float scale = (float) (TAG_SCALE * Math.max(1, distance / TAG_FULL_SIZE_DISTANCE));
        int width = 0;
        for (String line : lines) width = Math.max(width, font.getStringWidth(line));
        int height = lines.size() * LINE_HEIGHT;
        GL11.glPushMatrix();
        try {
            GL11.glTranslated(0.5, bottom, 0.5);
            GL11.glRotatef(-RenderManager.instance.playerViewY, 0f, 1f, 0f);
            GL11.glRotatef(RenderManager.instance.playerViewX, 1f, 0f, 0f);
            GL11.glScalef(-scale, -scale, scale);
            // text space: x right, y down; the tag's bottom edge is y = PADDING - 1 below the origin line
            int left = -width / 2;
            int top = -height - PADDING;
            GL11.glDisable(GL11.GL_TEXTURE_2D);
            Tessellator t = Tessellator.instance;
            t.startDrawingQuads();
            try {
                t.setColorRGBA_F(0f, 0f, 0f, 0.25f);
                t.addVertex(left - PADDING, top, 0);
                t.addVertex(left - PADDING, 0, 0);
                t.addVertex(left + width + PADDING, 0, 0);
                t.addVertex(left + width + PADDING, top, 0);
            } finally {
                t.draw();
            }
            GL11.glEnable(GL11.GL_TEXTURE_2D);
            for (int i = 0; i < lines.size(); i++) {
                font.drawString(lines.get(i), left, top + PADDING + i * LINE_HEIGHT, 0xFFFFFFFF);
            }
        } finally {
            GL11.glPopMatrix();
        }
    }

    private static void restore(int flag, boolean enabled) {
        if (enabled) GL11.glEnable(flag);
        else GL11.glDisable(flag);
    }

    /** Stops the aim drawing for the rest of the game and tells the player on the HUD and the log why. */
    private void fail(Throwable failure) {
        failed = true;
        String why = failure.getMessage() == null ? failure.toString() : failure.getMessage();
        session.setRenderError(String.format(FAILED, why));
        ClientProxy.LOG.error("Aim drawing failed; the projector draws no outline or name tag until the game restarts", failure);
    }
}
