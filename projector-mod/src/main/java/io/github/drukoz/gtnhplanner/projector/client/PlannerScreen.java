package io.github.drukoz.gtnhplanner.projector.client;

import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.geom.OrbitCamera;
import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import io.github.drukoz.gtnhplanner.projector.view.AimRay;
import io.github.drukoz.gtnhplanner.projector.view.ViewFilter;
import java.nio.FloatBuffer;
import java.nio.IntBuffer;
import java.util.List;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.gui.ScaledResolution;
import net.minecraft.client.renderer.GLAllocation;
import net.minecraft.client.renderer.OpenGlHelper;
import net.minecraft.client.renderer.texture.TextureMap;
import net.minecraft.util.ResourceLocation;
import org.lwjgl.input.Mouse;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;

/**
 * The planner screen (spec §2.4 of the aim and screen design): on its left, a 3D model of the loaded line in the
 * ghosts' looks ({@link GhostLook}) and colours. The blocks the step/layer filter shows are drawn at the ghost opacity,
 * the rest at 0.3 × it (without their covers), and every block above the selected layer is cut away. Dragging turns
 * the model (0.5° per pixel), right-dragging pans it, the wheel zooms; hovering a block shows its name tag's lines,
 * and clicking one (a press and release without dragging) closes the screen and finds that ghost in the world. The
 * right part and the bottom row are left for the step list and the buttons.
 *
 * <p>The model's geometry is rebuilt only when the session's render version or the selected layer changes, and with
 * {@code useDisplayLists} it is compiled into display lists that hold only Tessellator geometry and colour, as the
 * ghosts' are. It is drawn into its own viewport and scissor box with its own projection, and every GL setting it
 * changes is put back before the rest of the screen draws. Anything that fails stops the model's drawing until the game
 * restarts, and the screen says why. The game is not paused while it is open. Used on the game thread only.
 */
public final class PlannerScreen extends GuiScreen {

    /** The view's height, in degrees, from its bottom edge to its top. */
    private static final double FOV = 70;
    /**
     * The near clipping plane sits this fraction of the camera's distance in front of the eye (at least 0.1 block, as
     * the distance is at least 2), which keeps the depth buffer fine enough for the covers; the far one at FAR.
     */
    private static final double NEAR_PER_DISTANCE = 0.05, FAR = 2048;
    /** The blocks the filter hides are drawn at this fraction of the shown blocks' opacity. */
    private static final float FAINT = 0.3f;
    private static final double TURN_DEGREES_PER_PIXEL = 0.5;
    /** A press that moves more than this many pixels is a drag, not a click. */
    private static final int DRAG_SLOP = 2;
    /** How far a hover looks along the mouse's ray, in blocks. */
    private static final double PICK_DISTANCE = 512;
    private static final AimRay.Stops NOTHING_STOPS = (x, y, z) -> false;
    /** The model's area: under the title row, above the bottom row, left of the right column (this fraction). */
    private static final int MARGIN = 6, TITLE_HEIGHT = 20, BOTTOM_HEIGHT = 30;
    private static final double RIGHT_COLUMN = 0.34;
    private static final int PANEL_COLOUR = 0xC0101018, FAILURE_COLOUR = 0xFFFF5555;
    private static final String FAILED = "The model could not be drawn: %s — try useDisplayLists=false in config/"
        + ProjectorConfig.FILE_NAME;

    /** Why the model failed, shown instead of it until the game restarts; null while it works. */
    private static String modelFailure;

    private final ProjectorSession session;
    private final ProjectorConfig config;
    private final GhostLook look;
    /** The filter's blocks with their covers on the block atlas, their covers on the item atlas, the rest faint. */
    private final QuadBatch shown = new QuadBatch(), covers = new QuadBatch(), faint = new QuadBatch();
    private final FloatBuffer matrix = GLAllocation.createDirectFloatBuffer(16);
    private final IntBuffer ints = GLAllocation.createDirectIntBuffer(16);
    private final FloatBuffer floats = GLAllocation.createDirectFloatBuffer(16);
    private final int[] savedViewport = new int[4], savedScissor = new int[4];

    /** The camera and the line it was framed for; null until a placed line in this dimension is first drawn. */
    private OrbitCamera camera;
    private ProjectorData framed;
    /** Goes up by 1 whenever the camera moves, so the hovered block is looked up again. */
    private int cameraChanges;

    /** The first of the three display lists (shown, covers, faint); 0 until the first build that uses them. */
    private int lists;
    /** What the current geometry was built for. */
    private boolean built;
    private int builtVersion;
    private Integer builtLayer;

    /** The mouse button dragging the model (0 turns, 1 pans), or −1; where it was pressed and last seen. */
    private int dragButton = -1;
    private int pressX, pressY, lastX, lastY;
    private boolean dragged;

    /** The block under the mouse (its index in the line), or −1, and what that was looked up for. */
    private int hovered = -1;
    private int hoverX, hoverY, hoverCamera = -1, hoverVersion = -1;

    public PlannerScreen(ProjectorSession session, ProjectorConfig config, BlockIcons icons) {
        this.session = session;
        this.config = config;
        this.look = new GhostLook(icons);
    }

    /** Opening the screen ends the finding of a ghost. */
    @Override
    public void initGui() {
        session.screenOpened();
    }

    @Override
    public boolean doesGuiPauseGame() {
        return false;
    }

    @Override
    public void onGuiClosed() {
        if (lists != 0) {
            GLAllocation.deleteDisplayLists(lists);
            lists = 0;
        }
    }

    @Override
    public void drawScreen(int mouseX, int mouseY, float partialTicks) {
        drawDefaultBackground();
        int hover = -1;
        if (session.visibleHere()) {
            drawRect(modelLeft(), modelTop(), modelRight(), modelBottom(), PANEL_COLOUR);
            if (modelFailure == null) {
                try {
                    ProjectorData data = session.data();
                    frame(data);
                    rebuildIfStale(data);
                    drawModel(data, partialTicks);
                    hover = hover(mouseX, mouseY);
                } catch (Throwable failure) {
                    fail(failure);
                }
            }
            if (modelFailure != null) drawFailure();
        }
        super.drawScreen(mouseX, mouseY, partialTicks);
        if (hover >= 0) {
            try {
                tooltip(session.tagLines(hover), mouseX, mouseY);
            } catch (Throwable failure) {
                fail(failure);
            }
        }
    }

    /** A press on the model starts a drag; a press anywhere else is the screen's as usual. */
    @Override
    protected void mouseClicked(int mouseX, int mouseY, int button) {
        super.mouseClicked(mouseX, mouseY, button);
        if ((button == 0 || button == 1) && modelShown() && inModel(mouseX, mouseY)) {
            dragButton = button;
            pressX = lastX = mouseX;
            pressY = lastY = mouseY;
            dragged = false;
        }
    }

    /** Left-drag turns the model, right-drag pans it so the line follows the mouse. */
    @Override
    protected void mouseClickMove(int mouseX, int mouseY, int button, long sinceClick) {
        super.mouseClickMove(mouseX, mouseY, button, sinceClick);
        if (button != dragButton || camera == null) return;
        int dx = mouseX - lastX, dy = mouseY - lastY;
        lastX = mouseX;
        lastY = mouseY;
        if (Math.abs(mouseX - pressX) > DRAG_SLOP || Math.abs(mouseY - pressY) > DRAG_SLOP) dragged = true;
        if (dx == 0 && dy == 0) return;
        if (button == 0) {
            camera.turn(-dx * TURN_DEGREES_PER_PIXEL, dy * TURN_DEGREES_PER_PIXEL);
        } else {
            // blocks per pixel at the target's distance, so the point under the mouse stays under it
            double blocks = 2 * camera.distance() * Math.tan(Math.toRadians(FOV / 2))
                / Math.max(1, modelBottom() - modelTop());
            camera.pan(-dx * blocks, dy * blocks);
        }
        cameraChanges++;
    }

    /** Releasing the left button without dragging, over a block of the model, finds that block and closes the screen. */
    @Override
    protected void mouseMovedOrUp(int mouseX, int mouseY, int button) {
        super.mouseMovedOrUp(mouseX, mouseY, button);
        if (button < 0 || button != dragButton) return;
        boolean click = button == 0 && !dragged;
        dragButton = -1;
        if (!click || !modelShown() || !inModel(mouseX, mouseY)) return;
        int block;
        try {
            block = pick(mouseX, mouseY);
        } catch (Throwable failure) {
            fail(failure);
            return;
        }
        if (block < 0) return;
        session.find(block);
        mc.displayGuiScreen(null);
    }

    /** The wheel over the model zooms it: up moves in, down moves out, one step per notch. */
    @Override
    public void handleMouseInput() {
        super.handleMouseInput();
        int wheel = Mouse.getEventDWheel();
        if (wheel == 0 || !modelShown()) return;
        int x = Mouse.getEventX() * width / mc.displayWidth;
        int y = height - Mouse.getEventY() * height / mc.displayHeight - 1;
        if (!inModel(x, y)) return;
        camera.zoom(wheel > 0 ? 1 : -1);
        cameraChanges++;
    }

    private int modelLeft() {
        return MARGIN;
    }

    private int modelTop() {
        return TITLE_HEIGHT;
    }

    private int modelRight() {
        return (int) (width * (1 - RIGHT_COLUMN)) - MARGIN;
    }

    private int modelBottom() {
        return height - BOTTOM_HEIGHT;
    }

    private boolean inModel(int x, int y) {
        return x >= modelLeft() && x < modelRight() && y >= modelTop() && y < modelBottom();
    }

    /** Whether the model is on the screen: a placed line in this dimension, drawn at least once, and no failure. */
    private boolean modelShown() {
        return camera != null && modelFailure == null && session.visibleHere();
    }

    /** Points the camera at the line when it is first drawn and when the planner sends another line. */
    private void frame(ProjectorData data) {
        if (data == framed) return;
        camera = OrbitCamera.framing(data.origin, data.size);
        framed = data;
        cameraChanges++;
    }

    /** The layer the model is cut above: the filter's, or null for none. */
    private Integer cutLayer() {
        return session.filter().layerY;
    }

    private void rebuildIfStale(ProjectorData data) {
        int version = session.renderVersion();
        Integer layer = cutLayer();
        if (built && version == builtVersion && (layer == null ? builtLayer == null : layer.equals(builtLayer))) return;
        built = false; // a build that fails half-way leaves nothing to draw from
        build(data, layer);
        built = true;
        builtVersion = version;
        builtLayer = layer;
    }

    /**
     * Every block up to {@code layer} (all of them when it is null), at its position relative to the line's origin: the
     * ones the filter shows at the ghost opacity with their covers, the rest faint, without covers.
     */
    private void build(ProjectorData data, Integer layer) {
        shown.clear();
        covers.clear();
        faint.clear();
        BlockState[] states = session.states();
        ViewFilter filter = session.filter();
        float alpha = config.ghostAlpha();
        for (int i = 0; i < data.blocks.size(); i++) {
            PlannedBlock b = data.blocks.get(i);
            if (layer != null && b.y > layer) continue;
            double x = b.x - data.origin[0], y = b.y - data.origin[1], z = b.z - data.origin[2];
            // green where it stands as the shown step needs it, as on the ghosts
            BlockState s = states[i].placedFor(b, filter.stepIndex) ? BlockState.CORRECT : states[i];
            if (filter.shows(b)) {
                look.addBlock(shown, b, s, x, y, z, alpha);
                look.addCovers(shown, covers, b, x, y, z);
            } else {
                look.addBlock(faint, b, s, x, y, z, alpha, FAINT);
            }
        }
        if (config.useDisplayLists()) {
            if (lists == 0) {
                lists = GLAllocation.generateDisplayLists(3);
                if (lists == 0) throw new IllegalStateException("OpenGL gave no display lists");
            }
            shown.compile(lists);
            covers.compile(lists + 1);
            faint.compile(lists + 2);
        }
    }

    /**
     * Draws the model in its area with a perspective of {@link #FOV}, without lighting, the lightmap, fog or face
     * culling, with the depth test. Each set of blocks (the shown ones, then the faint ones) is drawn twice: first only
     * into the depth buffer, then in colour where it is the nearest, so only its front surface is blended in, whatever
     * order the blocks come in. The shown blocks' covers go between the two sets. The viewport, scissor box, both
     * matrices and every GL setting it changes (the alpha test's function and reference too) are put back, and the
     * depth buffer in its area is cleared again, so the rest of the screen draws as before; the lightmap is turned back
     * on only if it was on.
     */
    private void drawModel(ProjectorData data, float partialTicks) {
        int left = modelLeft(), top = modelTop(), right = modelRight(), bottom = modelBottom();
        if (right <= left || bottom <= top) return;
        int scale = new ScaledResolution(mc, mc.displayWidth, mc.displayHeight).getScaleFactor();
        int pixelWidth = (right - left) * scale, pixelHeight = (bottom - top) * scale;
        int pixelX = left * scale, pixelY = mc.displayHeight - bottom * scale;
        boolean scissor = GL11.glIsEnabled(GL11.GL_SCISSOR_TEST);
        read(GL11.GL_VIEWPORT, savedViewport);
        read(GL11.GL_SCISSOR_BOX, savedScissor);
        int matrixMode = read(GL11.GL_MATRIX_MODE);
        int depthFunc = read(GL11.GL_DEPTH_FUNC);
        boolean blend = GL11.glIsEnabled(GL11.GL_BLEND);
        boolean lighting = GL11.glIsEnabled(GL11.GL_LIGHTING);
        boolean cull = GL11.glIsEnabled(GL11.GL_CULL_FACE);
        boolean depth = GL11.glIsEnabled(GL11.GL_DEPTH_TEST);
        boolean alphaTest = GL11.glIsEnabled(GL11.GL_ALPHA_TEST);
        int alphaFunc = read(GL11.GL_ALPHA_TEST_FUNC);
        float alphaRef = readFloat(GL11.GL_ALPHA_TEST_REF);
        boolean texture = GL11.glIsEnabled(GL11.GL_TEXTURE_2D);
        boolean fog = GL11.glIsEnabled(GL11.GL_FOG);
        OpenGlHelper.setActiveTexture(OpenGlHelper.lightmapTexUnit);
        boolean lightmap = GL11.glIsEnabled(GL11.GL_TEXTURE_2D);
        OpenGlHelper.setActiveTexture(OpenGlHelper.defaultTexUnit);
        mc.entityRenderer.disableLightmap(partialTicks);
        try {
            GL11.glViewport(pixelX, pixelY, pixelWidth, pixelHeight);
            GL11.glScissor(pixelX, pixelY, pixelWidth, pixelHeight);
            GL11.glEnable(GL11.GL_SCISSOR_TEST);
            GL11.glDepthMask(true);
            GL11.glClear(GL11.GL_DEPTH_BUFFER_BIT);
            GL11.glMatrixMode(GL11.GL_PROJECTION);
            GL11.glPushMatrix();
            try {
                GL11.glLoadIdentity();
                double near = camera.distance() * NEAR_PER_DISTANCE;
                double halfHeight = near * Math.tan(Math.toRadians(FOV / 2));
                double halfWidth = halfHeight * pixelWidth / pixelHeight;
                GL11.glFrustum(-halfWidth, halfWidth, -halfHeight, halfHeight, near, FAR);
                GL11.glMatrixMode(GL11.GL_MODELVIEW);
                GL11.glPushMatrix();
                try {
                    GL11.glLoadIdentity();
                    matrix.clear();
                    matrix.put(camera.viewMatrix());
                    matrix.flip();
                    GL11.glMultMatrix(matrix);
                    GL11.glTranslated(data.origin[0], data.origin[1], data.origin[2]);
                    GL11.glEnable(GL11.GL_BLEND);
                    OpenGlHelper.glBlendFunc(GL11.GL_SRC_ALPHA, GL11.GL_ONE_MINUS_SRC_ALPHA, 1, 0);
                    GL11.glDisable(GL11.GL_LIGHTING);
                    GL11.glDisable(GL11.GL_FOG);
                    GL11.glDisable(GL11.GL_CULL_FACE);
                    // off for the colour passes, where it would drop every texel of a faint block; the depth-only
                    // passes turn it on with this function, so a fully clear texel writes no depth
                    GL11.glDisable(GL11.GL_ALPHA_TEST);
                    GL11.glAlphaFunc(GL11.GL_GREATER, 0f);
                    GL11.glEnable(GL11.GL_TEXTURE_2D);
                    GL11.glEnable(GL11.GL_DEPTH_TEST);
                    GL11.glDepthFunc(GL11.GL_LEQUAL);
                    drawSurface(shown, lists);
                    drawBatch(TextureMap.locationItemsTexture, covers, lists + 1);
                    drawSurface(faint, lists + 2);
                } finally {
                    GL11.glMatrixMode(GL11.GL_MODELVIEW);
                    GL11.glPopMatrix();
                }
            } finally {
                GL11.glMatrixMode(GL11.GL_PROJECTION);
                GL11.glPopMatrix();
            }
        } finally {
            GL11.glColorMask(true, true, true, true);
            GL11.glDepthMask(true);
            GL11.glClear(GL11.GL_DEPTH_BUFFER_BIT); // still inside the scissor box: only the model's area
            GL11.glMatrixMode(matrixMode);
            restore(GL11.GL_BLEND, blend);
            restore(GL11.GL_LIGHTING, lighting);
            restore(GL11.GL_CULL_FACE, cull);
            restore(GL11.GL_DEPTH_TEST, depth);
            restore(GL11.GL_ALPHA_TEST, alphaTest);
            GL11.glAlphaFunc(alphaFunc, alphaRef);
            restore(GL11.GL_TEXTURE_2D, texture);
            restore(GL11.GL_FOG, fog);
            GL11.glDepthFunc(depthFunc);
            GL11.glColor4f(1f, 1f, 1f, 1f);
            GL11.glViewport(savedViewport[0], savedViewport[1], savedViewport[2], savedViewport[3]);
            GL11.glScissor(savedScissor[0], savedScissor[1], savedScissor[2], savedScissor[3]);
            restore(GL11.GL_SCISSOR_TEST, scissor);
            if (lightmap) mc.entityRenderer.enableLightmap(partialTicks);
        }
    }

    /**
     * The batch's nearest faces only, blended: first into the depth buffer alone, then in colour where they match it.
     * The depth-only pass skips fully clear texels (the alpha test, with {@code drawModel}'s function), so through a
     * frame box, glass or the gaps of a cover the blocks behind still show, as in the world.
     */
    private void drawSurface(QuadBatch batch, int list) {
        if (batch.isEmpty()) return;
        GL11.glColorMask(false, false, false, false);
        GL11.glDepthMask(true);
        GL11.glEnable(GL11.GL_ALPHA_TEST);
        drawBatch(TextureMap.locationBlocksTexture, batch, list);
        GL11.glDisable(GL11.GL_ALPHA_TEST);
        GL11.glColorMask(true, true, true, true);
        GL11.glDepthMask(false);
        drawBatch(TextureMap.locationBlocksTexture, batch, list);
    }

    private void drawBatch(ResourceLocation atlas, QuadBatch batch, int list) {
        if (batch.isEmpty()) return;
        mc.getTextureManager().bindTexture(atlas);
        if (config.useDisplayLists()) GL11.glCallList(list);
        else batch.draw();
    }

    /** The block under the mouse, looked up again only when the mouse, the camera or the line's drawing changed. */
    private int hover(int mouseX, int mouseY) {
        if (!inModel(mouseX, mouseY) || (dragButton >= 0 && dragged)) return -1;
        int version = session.renderVersion();
        if (mouseX != hoverX || mouseY != hoverY || cameraChanges != hoverCamera || version != hoverVersion) {
            hovered = pick(mouseX, mouseY);
            hoverX = mouseX;
            hoverY = mouseY;
            hoverCamera = cameraChanges;
            hoverVersion = version;
        }
        return hovered;
    }

    /**
     * The nearest block of the model (shown or faint, not cut away) on the ray from the eye through the mouse, or −1:
     * the cells along it, as the crosshair's aim walks them.
     */
    private int pick(int mouseX, int mouseY) {
        double ndcX = (mouseX + 0.5 - modelLeft()) / (modelRight() - modelLeft()) * 2 - 1;
        double ndcY = 1 - (mouseY + 0.5 - modelTop()) / (modelBottom() - modelTop()) * 2;
        double aspect = (double) (modelRight() - modelLeft()) / (modelBottom() - modelTop());
        final Integer layer = cutLayer();
        AimRay.Ghosts blocks = (x, y, z) -> layer != null && y > layer ? -1 : session.blockIndexAt(x, y, z);
        List<AimRay.Hit> hits = AimRay.walk(camera.eye(), camera.ray(ndcX, ndcY, FOV, aspect), PICK_DISTANCE, blocks,
            NOTHING_STOPS);
        return hits.isEmpty() ? -1 : hits.get(0).block;
    }

    /**
     * The block's lines as a tooltip at the mouse, with the game's tooltip drawing; the lighting, depth test and normal
     * rescaling it turns on are put back as they were.
     */
    private void tooltip(List<String> lines, int mouseX, int mouseY) {
        if (lines.isEmpty()) return;
        boolean lighting = GL11.glIsEnabled(GL11.GL_LIGHTING);
        boolean depth = GL11.glIsEnabled(GL11.GL_DEPTH_TEST);
        boolean rescale = GL11.glIsEnabled(GL12.GL_RESCALE_NORMAL);
        try {
            func_146283_a(lines, mouseX, mouseY);
        } finally {
            restore(GL11.GL_LIGHTING, lighting);
            restore(GL11.GL_DEPTH_TEST, depth);
            restore(GL12.GL_RESCALE_NORMAL, rescale);
        }
    }

    /** The failure's text, wrapped, in the middle of the model's area. */
    private void drawFailure() {
        int w = modelRight() - modelLeft() - 2 * MARGIN;
        if (w <= 0) return;
        List<String> lines = fontRendererObj.listFormattedStringToWidth(modelFailure, w);
        int y = (modelTop() + modelBottom()) / 2 - lines.size() * fontRendererObj.FONT_HEIGHT / 2;
        for (String line : lines) {
            drawCenteredString(fontRendererObj, line, (modelLeft() + modelRight()) / 2, y, FAILURE_COLOUR);
            y += fontRendererObj.FONT_HEIGHT;
        }
    }

    private void read(int name, int[] into) {
        ints.clear();
        GL11.glGetInteger(name, ints);
        for (int i = 0; i < into.length; i++) into[i] = ints.get(i);
    }

    private int read(int name) {
        ints.clear();
        GL11.glGetInteger(name, ints);
        return ints.get(0);
    }

    private float readFloat(int name) {
        floats.clear();
        GL11.glGetFloat(name, floats);
        return floats.get(0);
    }

    private static void restore(int flag, boolean enabled) {
        if (enabled) GL11.glEnable(flag);
        else GL11.glDisable(flag);
    }

    /** Stops the model's drawing until the game restarts; the screen shows why and the log has the details, once. */
    private void fail(Throwable failure) {
        String why = failure.getMessage() == null ? failure.toString() : failure.getMessage();
        modelFailure = String.format(FAILED, why);
        hovered = -1;
        dragButton = -1;
        ClientProxy.LOG.error("The planner screen's model failed; it is not drawn until the game restarts", failure);
    }
}
