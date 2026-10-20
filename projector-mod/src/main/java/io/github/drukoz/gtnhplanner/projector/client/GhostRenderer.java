package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.registry.GameData;
import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.geom.Quads;
import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.PlannedCover;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import io.github.drukoz.gtnhplanner.projector.view.ViewFilter;
import java.util.Arrays;
import net.minecraft.client.Minecraft;
import net.minecraft.client.renderer.GLAllocation;
import net.minecraft.client.renderer.OpenGlHelper;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.client.renderer.texture.TextureMap;
import net.minecraft.entity.EntityLivingBase;
import net.minecraft.item.Item;
import net.minecraft.util.IIcon;
import net.minecraft.util.ResourceLocation;
import net.minecraftforge.client.event.RenderWorldLastEvent;
import org.lwjgl.opengl.GL11;

/**
 * Draws the loaded line's ghosts after the world (spec §3.13), with our own quads from the blocks' icons: every shown
 * block within {@code maxDistance} of the camera as a translucent cube, coloured by what the build check found there
 * (not placed: faint with its own look; can't be checked: bluish; placed right: green; wrong block or front: red),
 * and every cover as its item's icon on the face it goes on.
 *
 * <p>The geometry is rebuilt only when the session's render version, the camera's 8-block cell or the ghost opacity
 * changes. With {@code useDisplayLists} it is compiled into two display lists (blocks on the block atlas, covers on
 * the item atlas) that hold only Tessellator geometry and colour, no GL state, so Angelica's display-list recorder can
 * replay them; without it the same quads are sent every frame. Anything that fails stops the projector's drawing until
 * the game restarts and says so on the HUD. Used on the render thread, which is the game thread.
 */
public final class GhostRenderer {

    /** A placed block's coloured shell sits this far outside the real block, so the two do not flicker. */
    private static final double SHELL_GROW = 0.004;
    private static final float CORRECT_R = 0.3f, CORRECT_G = 1f, CORRECT_B = 0.3f, CORRECT_ALPHA = 0.45f;
    private static final float WRONG_R = 1f, WRONG_G = 0.25f, WRONG_B = 0.25f, WRONG_ALPHA = 0.65f;
    /** What a block the mod cannot check is tinted with, on top of its own tint: bluish. */
    private static final float UNCHECKED_R = 0.6f, UNCHECKED_G = 0.75f, UNCHECKED_B = 1f;
    /** A cover's square spans the middle of its face, just outside the block's shell. */
    private static final double COVER_LO = 0.15, COVER_HI = 0.85, COVER_OUT = 0.012;
    private static final float COVER_ALPHA = 0.85f;
    /** A cover whose icon cannot be found: a light-blue square. */
    private static final float UNKNOWN_COVER_R = 0.55f, UNKNOWN_COVER_G = 0.75f, UNKNOWN_COVER_B = 1f,
        UNKNOWN_COVER_ALPHA = 0.8f;
    /** The camera may move within one cell of this many blocks before the culled geometry is rebuilt. */
    private static final int CELL = 8;
    /** {@code Item.getSpriteNumber()} of an item whose icons are on the item atlas (0 = the block atlas). */
    private static final int ITEM_ATLAS = 1;
    private static final String FAILED = "Ghost drawing failed: %s — try useDisplayLists=false in config/"
        + ProjectorConfig.FILE_NAME;

    private final ProjectorSession session;
    private final ProjectorConfig config;
    private final BlockIcons icons;
    private final Minecraft mc = Minecraft.getMinecraft();
    private final Batch blockQuads = new Batch(), coverQuads = new Batch();

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
        this.icons = icons;
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
            addBlock(b, states[i].placedFor(b, filter.stepIndex) ? BlockState.CORRECT : states[i], x, y, z, alpha);
            for (PlannedCover c : b.covers) addCover(c, x, y, z);
        }
        if (config.useDisplayLists()) {
            if (lists == 0) {
                lists = GLAllocation.generateDisplayLists(2);
                if (lists == 0) throw new IllegalStateException("OpenGL gave no display lists");
            }
            compile(lists, blockQuads);
            compile(lists + 1, coverQuads);
        }
    }

    /** The block's six faces, each with every layer of its look, in the colour of what the check found. */
    private void addBlock(PlannedBlock b, BlockState state, double x, double y, double z, float ghostAlpha) {
        FaceIcons look = icons.forBlock(b);
        float r, g, bl, a;
        double grow = 0;
        switch (state) {
            case CORRECT:
                r = CORRECT_R;
                g = CORRECT_G;
                bl = CORRECT_B;
                a = CORRECT_ALPHA;
                grow = SHELL_GROW;
                break;
            case WRONG_BLOCK:
            case WRONG_FACING:
                r = WRONG_R;
                g = WRONG_G;
                bl = WRONG_B;
                a = WRONG_ALPHA;
                grow = SHELL_GROW;
                break;
            case UNCHECKED:
                r = look.r * UNCHECKED_R;
                g = look.g * UNCHECKED_G;
                bl = look.b * UNCHECKED_B;
                a = ghostAlpha;
                break;
            default: // MISSING, INCOMPLETE, UNLOADED: a faint ghost of the block
                r = look.r;
                g = look.g;
                bl = look.b;
                a = ghostAlpha;
                break;
        }
        for (int side = 0; side < look.layers.length; side++) {
            double[] quad = Quads.face(side, grow);
            for (IIcon icon : look.layers[side]) blockQuads.add(quad, icon, x, y, z, r, g, bl, a);
        }
    }

    /**
     * A square with the cover item's own icon on the cover's face: {@code registry@meta} (any {@code #…} suffix
     * dropped) through the item registry and {@code getIconFromDamage}, drawn with the item atlas (or the block atlas
     * for an item whose icons are there, such as a block's item). A cover whose icon cannot be found is a light-blue
     * square with the white icon.
     */
    private void addCover(PlannedCover c, double x, double y, double z) {
        double[] quad = Quads.marker(c.face, COVER_LO, COVER_HI, COVER_OUT);
        String key = c.item;
        int hash = key.indexOf('#');
        if (hash >= 0) key = key.substring(0, hash);
        int at = key.lastIndexOf('@');
        try {
            if (at > 0) {
                Item item = GameData.getItemRegistry().getObject(key.substring(0, at));
                IIcon icon = item == null ? null : item.getIconFromDamage(Integer.parseInt(key.substring(at + 1)));
                if (icon != null) {
                    Batch batch = item.getSpriteNumber() == ITEM_ATLAS ? coverQuads : blockQuads;
                    batch.add(quad, icon, x, y, z, 1f, 1f, 1f, COVER_ALPHA);
                    return;
                }
            }
        } catch (Throwable unknown) {
            // an item that cannot give this icon: drawn as an unknown cover
        }
        blockQuads.add(quad, BlockIcons.white(), x, y, z, UNKNOWN_COVER_R, UNKNOWN_COVER_G, UNKNOWN_COVER_B,
            UNKNOWN_COVER_ALPHA);
    }

    /** Compiles the batch into {@code list}: Tessellator geometry and colour only. */
    private static void compile(int list, Batch batch) {
        GL11.glNewList(list, GL11.GL_COMPILE);
        try {
            if (!batch.isEmpty()) drawQuads(batch);
        } finally {
            GL11.glEndList();
        }
    }

    /** Sends the batch through the Tessellator; it is left ready for the game's own drawing even when this fails. */
    private static void drawQuads(Batch batch) {
        Tessellator tessellator = Tessellator.instance;
        tessellator.startDrawingQuads();
        try {
            batch.emit(tessellator);
        } finally {
            tessellator.draw();
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

    private void drawBatch(ResourceLocation atlas, Batch batch, int list) {
        if (batch.isEmpty()) return;
        mc.getTextureManager().bindTexture(atlas);
        if (config.useDisplayLists()) GL11.glCallList(list);
        else drawQuads(batch);
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

    /** Quads waiting to be drawn: per quad its colour, then 4 corners of x, y, z and atlas u, v. */
    private static final class Batch {

        private static final int CORNERS = 4, CORNER = 5, QUAD = 4 + CORNERS * CORNER;

        private double[] values = new double[QUAD * 256];
        private int size;

        void clear() {
            size = 0;
        }

        boolean isEmpty() {
            return size == 0;
        }

        /**
         * One quad of {@code corners} ({@link Quads}' 4 × x, y, z, u, v, with u and v as fractions of the icon) at
         * {@code x, y, z}, textured with {@code icon} and coloured {@code r, g, b, a}; nothing without an icon.
         */
        void add(double[] corners, IIcon icon, double x, double y, double z, float r, float g, float b, float a) {
            if (icon == null) return;
            if (size + QUAD > values.length) values = Arrays.copyOf(values, values.length * 2);
            values[size++] = r;
            values[size++] = g;
            values[size++] = b;
            values[size++] = a;
            double u0 = icon.getMinU(), du = icon.getMaxU() - u0, v0 = icon.getMinV(), dv = icon.getMaxV() - v0;
            for (int i = 0; i < CORNERS * CORNER; i += CORNER) {
                values[size++] = x + corners[i];
                values[size++] = y + corners[i + 1];
                values[size++] = z + corners[i + 2];
                values[size++] = u0 + du * corners[i + 3];
                values[size++] = v0 + dv * corners[i + 4];
            }
        }

        void emit(Tessellator tessellator) {
            for (int q = 0; q < size; q += QUAD) {
                tessellator.setColorRGBA_F((float) values[q], (float) values[q + 1], (float) values[q + 2],
                    (float) values[q + 3]);
                for (int i = q + 4; i < q + QUAD; i += CORNER) {
                    tessellator.addVertexWithUV(values[i], values[i + 1], values[i + 2], values[i + 3], values[i + 4]);
                }
            }
        }
    }
}
