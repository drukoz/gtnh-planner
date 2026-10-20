package io.github.drukoz.gtnhplanner.projector.client;

import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import java.util.List;
import net.minecraft.client.gui.GuiScreen;
import org.lwjgl.input.Mouse;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;

/**
 * The planner screen (spec §2.4 of the aim and screen design): on its left, a 3D model of the loaded line
 * ({@link ScreenModel}). Hovering a block shows its name tag's lines, and clicking one (a press and release without
 * dragging) closes the screen and finds that ghost in the world. The right part and the bottom row are left for the
 * step list and the buttons. The game is not paused while it is open. Used on the game thread only.
 */
public final class PlannerScreen extends GuiScreen {

    /** The model's area: under the title row, above the bottom row, left of the right column (this fraction). */
    private static final int MARGIN = 6, TITLE_HEIGHT = 20, BOTTOM_HEIGHT = 30;
    private static final double RIGHT_COLUMN = 0.34;
    private static final int PANEL_COLOUR = 0xC0101018, FAILURE_COLOUR = 0xFFFF5555;

    private final ProjectorSession session;
    private final ScreenModel model;

    public PlannerScreen(ProjectorSession session, ProjectorConfig config, BlockIcons icons) {
        this.session = session;
        this.model = new ScreenModel(session, config, icons);
    }

    /** Opening the screen ends the finding of a ghost; the model gets its area for this screen size. */
    @Override
    public void initGui() {
        session.screenOpened();
        model.setArea(MARGIN, TITLE_HEIGHT, (int) (width * (1 - RIGHT_COLUMN)) - MARGIN, height - BOTTOM_HEIGHT);
    }

    @Override
    public boolean doesGuiPauseGame() {
        return false;
    }

    @Override
    public void onGuiClosed() {
        model.close();
    }

    @Override
    public void drawScreen(int mouseX, int mouseY, float partialTicks) {
        drawDefaultBackground();
        int hover = -1;
        if (session.visibleHere()) {
            drawRect(model.left(), model.top(), model.right(), model.bottom(), PANEL_COLOUR);
            hover = model.draw(mouseX, mouseY, partialTicks);
            if (ScreenModel.failure() != null) drawFailure();
        }
        super.drawScreen(mouseX, mouseY, partialTicks);
        if (hover >= 0) {
            try {
                tooltip(session.tagLines(hover), mouseX, mouseY);
            } catch (Throwable failure) {
                model.fail(failure);
            }
        }
    }

    /** A press on the model starts a drag; a press anywhere else is the screen's as usual. */
    @Override
    protected void mouseClicked(int mouseX, int mouseY, int button) {
        super.mouseClicked(mouseX, mouseY, button);
        model.press(mouseX, mouseY, button);
    }

    /** Left-drag turns the model, right-drag pans it. */
    @Override
    protected void mouseClickMove(int mouseX, int mouseY, int button, long sinceClick) {
        super.mouseClickMove(mouseX, mouseY, button, sinceClick);
        model.drag(mouseX, mouseY, button);
    }

    /** Releasing the left button without dragging, over a block of the model, finds that block and closes the screen. */
    @Override
    protected void mouseMovedOrUp(int mouseX, int mouseY, int button) {
        super.mouseMovedOrUp(mouseX, mouseY, button);
        int block = model.release(mouseX, mouseY, button);
        if (block < 0) return;
        session.find(block);
        mc.displayGuiScreen(null);
    }

    /** The wheel over the model zooms it. */
    @Override
    public void handleMouseInput() {
        super.handleMouseInput();
        int wheel = Mouse.getEventDWheel();
        if (wheel == 0) return;
        int x = Mouse.getEventX() * width / mc.displayWidth;
        int y = height - Mouse.getEventY() * height / mc.displayHeight - 1;
        model.wheel(x, y, wheel);
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
            ScreenModel.restore(GL11.GL_LIGHTING, lighting);
            ScreenModel.restore(GL11.GL_DEPTH_TEST, depth);
            ScreenModel.restore(GL12.GL_RESCALE_NORMAL, rescale);
        }
    }

    /** The failure's text, wrapped, in the middle of the model's area. */
    private void drawFailure() {
        int w = model.right() - model.left() - 2 * MARGIN;
        if (w <= 0) return;
        List<String> lines = fontRendererObj.listFormattedStringToWidth(ScreenModel.failure(), w);
        int y = (model.top() + model.bottom()) / 2 - lines.size() * fontRendererObj.FONT_HEIGHT / 2;
        for (String line : lines) {
            drawCenteredString(fontRendererObj, line, (model.left() + model.right()) / 2, y, FAILURE_COLOUR);
            y += fontRendererObj.FONT_HEIGHT;
        }
    }
}
