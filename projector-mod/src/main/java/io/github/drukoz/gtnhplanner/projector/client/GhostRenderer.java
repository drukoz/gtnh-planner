package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import io.github.drukoz.gtnhplanner.projector.view.ViewFilter;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GLAllocation;
import net.minecraft.client.renderer.OpenGlHelper;
import net.minecraft.client.renderer.texture.TextureMap;
import net.minecraft.entity.EntityLivingBase;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.client.event.RenderWorldLastEvent;
import org.lwjgl.opengl.GL11;

/**
 * Draws the loaded line's ghosts after the world (spec §3.13), with our own quads from the blocks' icons
 * ({@link GhostLook}): every shown block within {@code maxDistance} of the camera as a translucent cube, coloured by
 * what the build check found there (not placed: faint with its own look; can't be checked: bluish; placed right:
 * green; wrong block or front: red), and every cover as its item's icon on the face it goes on.
 *
 * <p>The geometry is rebuilt only when the session's render version, the camera's 8-block cell or the ghost opacity
 * changes. With {@code useDisplayLists} it is compiled into two display lists (blocks on the block atlas, covers on
 * the item atlas) that hold only Tessellator geometry and colour, no GL state, so Angelica's display-list recorder can
 * replay them; without it the same quads are sent every frame. Anything that fails stops the projector's drawing until
 * the game restarts and says so on the HUD. Used on the render thread, which is the game thread.
 */
public final class GhostRenderer {

    /** The camera may move within one cell of this many blocks before the culled geometry is rebuilt. */
    private static final int CELL = 8;
    private static final String FAILED = "Ghost drawing failed: %s — try useDisplayLists=false in config/"
        + ProjectorConfig.FILE_NAME;

    private final ProjectorSession session;
    private final ProjectorConfig config;
    private final GhostLook look;
    private final Minecraft mc = Minecraft.getMinecraft();
    private final QuadBatch blockQuads = new QuadBatch(), coverQuads = new QuadBatch();

    /** The first of the two display lists (blocks, then covers); 0 until the first build that uses them. */
    private int lists;
    /** What the current geometry was built for. */
    private boolean built;
    private int builtVersion, builtCellX, builtCellY, builtCellZ;
    private float builtAlpha;
    /** Set once anything failed: nothing is drawn any more. */
    private boolean failed;

    public GhostRenderer(ProjectorSession session, ProjectorConfig config, BlockIcons icons) {
        this.session = session;
        this.config = config;
        this.look = new GhostLook(icons);
    }

    @SubscribeEvent
    public void onRenderLast(RenderWorldLastEvent e) {
        if (failed || !session.visibleHere() || session.ghostsHidden()) return;
        EntityLivingBase camera = mc.renderViewEntity;
        if (camera == null) return;
        double t = e.partialTicks;
        double cx = camera.lastTickPosX + (camera.posX - camera.lastTickPosX) * t;
        double cy = camera.lastTickPosY + (camera.posY - camera.lastTickPosY) * t;
        double cz = camera.lastTickPosZ + (camera.posZ - camera.lastTickPosZ) * t;
        ProjectorData data = session.data();
        try {
            rebuildIfStale(data, cx, cy, cz);
            if (!blockQuads.isEmpty() || !coverQuads.isEmpty()) draw(data, cx, cy, cz, e.partialTicks);
        } catch (Throwable failure) {
            fail(failure);
        }
    }

    private void rebuildIfStale(ProjectorData data, double cx, double cy, double cz) {
        int version = session.renderVersion();
        int cellX = cell(cx), cellY = cell(cy), cellZ = cell(cz);
        float alpha = config.ghostAlpha();
        if (built && version == builtVersion && cellX == builtCellX && cellY == builtCellY && cellZ == builtCellZ
            && alpha == builtAlpha) {
            return;
        }
        built = false; // a build that fails half-way leaves nothing to draw from
        build(data, cx, cy, cz, alpha);
        built = true;
        builtVersion = version;
        builtCellX = cellX;
        builtCellY = cellY;
        builtCellZ = cellZ;
        builtAlpha = alpha;
    }

    private static int cell(double coordinate) {
        return (int) Math.floor(coordinate / CELL);
    }

    /** Every shown block near the camera and its covers, at its position relative to the line's origin. */
    private void build(ProjectorData data, double cx, double cy, double cz, float alpha) {
        blockQuads.clear();
        coverQuads.clear();
        BlockState[] states = session.states();
        ViewFilter filter = session.filter();
        int maxDistance = config.maxDistance();
        for (int i = 0; i < data.blocks.size(); i++) {
            PlannedBlock b = data.blocks.get(i);
            if (!filter.shows(b) || !ViewFilter.within(b, cx, cy, cz, maxDistance)) continue;
            double x = b.x - data.origin[0], y = b.y - data.origin[1], z = b.z - data.origin[2];
            // green where it stands as the shown step needs it: a bundle without the fluids step's conduit, under the
            // line step
            look.addBlock(blockQuads, b, states[i].placedFor(b, filter.stepIndex) ? BlockState.CORRECT : states[i], x, y,
                z, alpha);
            look.addCovers(blockQuads, coverQuads, b, x, y, z);
        }
        if (config.useDisplayLists()) {
            if (lists == 0) {
                lists = GLAllocation.generateDisplayLists(2);
                if (lists == 0) throw new IllegalStateException("OpenGL gave no display lists");
            }
            blockQuads.compile(lists);
            coverQuads.compile(lists + 1);
        }
    }

    /**
     * Draws both batches, translucent, without lighting, the lightmap, face culling or alpha test, without writing
     * depth (and without the depth test for see-through ghosts), at the line's origin relative to the camera. Every
     * GL flag it changes is put back as it was. That includes the lightmap (texture unit 1's 2D texture), which
     * vanilla has already turned off when {@code RenderWorldLastEvent} fires: it is turned back on only if it was on,
     * so whatever draws after the ghosts is not lit by it.
     */
    private void draw(ProjectorData data, double cx, double cy, double cz, float partialTicks) {
        boolean blend = GL11.glIsEnabled(GL11.GL_BLEND);
        boolean lighting = GL11.glIsEnabled(GL11.GL_LIGHTING);
        boolean cull = GL11.glIsEnabled(GL11.GL_CULL_FACE);
        boolean depth = GL11.glIsEnabled(GL11.GL_DEPTH_TEST);
        boolean alphaTest = GL11.glIsEnabled(GL11.GL_ALPHA_TEST);
        OpenGlHelper.setActiveTexture(OpenGlHelper.lightmapTexUnit);
        boolean lightmap = GL11.glIsEnabled(GL11.GL_TEXTURE_2D);
        OpenGlHelper.setActiveTexture(OpenGlHelper.defaultTexUnit);
        mc.entityRenderer.disableLightmap(partialTicks);
        try {
            GL11.glEnable(GL11.GL_BLEND);
            OpenGlHelper.glBlendFunc(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, 1, 0);
            GL11.glDisable(GL11.GL_LIGHTING);
            GL11.glDisable(GL11.GL_CULL_FACE);
            GL11.glDisable(GL11.GL_ALPHA_TEST); // the game's alpha test would drop every texel of a 0.1-opacity ghost
            GL11.glDepthMask(false);
            if (session.seeThrough()) GL11.glDisable(GL11.GL_DEPTH_TEST);
            GL11.glPushMatrix();
            try {
                GL11.glTranslated(data.origin[0] - cx, data.origin[1] - cy, data.origin[2] - cz);
                drawBatch(TextureMap.locationBlocksTexture, blockQuads, lists);
                drawBatch(TextureMap.locationItemsTexture, coverQuads, lists + 1);
            } finally {
                GL11.glPopMatrix();
            }
        } finally {
            restore(GL11.GL_BLEND, blend);
            restore(GL11.GL_LIGHTING, lighting);
            restore(GL11.GL_CULL_FACE, cull);
            restore(GL11.GL_DEPTH_TEST, depth);
            restore(GL11.GL_ALPHA_TEST, alphaTest);
            GL11.glDepthMask(true);
            GL11.glColor4f(1f, 1f, 1f, 1f);
            if (lightmap) mc.entityRenderer.enableLightmap(partialTicks);
        }
    }

    private void drawBatch(ResourceLocation atlas, QuadBatch batch, int list) {
        if (batch.isEmpty()) return;
        mc.getTextureManager().bindTexture(atlas);
        if (config.useDisplayLists()) GL11.glCallList(list);
        else batch.draw();
    }

    private static void restore(int flag, boolean enabled) {
        if (enabled) GL11.glEnable(flag);
        else GL11.glDisable(flag);
    }

    /** Stops the projector's drawing for the rest of the game and tells the player on the HUD and the log why. */
    private void fail(Throwable failure) {
        failed = true;
        String why = failure.getMessage() == null ? failure.toString() : failure.getMessage();
        session.setRenderError(String.format(FAILED, why));
        ClientProxy.LOG.error("Ghost drawing failed; the projector draws no ghosts until the game restarts", failure);
    }
}
