package io.github.drukoz.gtnhplanner.projector.client;

import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.model.PlannedStep;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import io.github.drukoz.gtnhplanner.projector.session.Command;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import io.github.drukoz.gtnhplanner.projector.view.HudText;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Objects;
import net.minecraft.client.audio.PositionedSoundRecord;
import net.minecraft.client.gui.GuiButton;
import net.minecraft.client.gui.GuiScreen;
import net.minecraft.client.settings.KeyBinding;
import net.minecraft.util.ResourceLocation;
import org.lwjgl.input.Mouse;
import org.lwjgl.opengl.GL11;
import org.lwjgl.opengl.GL12;

/**
 * The planner screen (spec §2.4 of the aim and screen design), laid out as the approved mockup:
 * <ul>
 * <li>a title row with the line's name and how far the build has got among the blocks shown;</li>
 * <li>on the left, a 3D model of the loaded line ({@link ScreenModel}): hovering a block shows its name tag's lines,
 * and clicking one (a press and release without dragging) closes the screen and finds that ghost in the world;</li>
 * <li>on the right, the build steps, which scroll with the wheel when they do not fit: {@code All steps}, then each
 * step's number and text, done steps green with a tick, steps without blocks grey and not clickable, the shown one
 * highlighted; under them, what the current step still needs, as on the HUD;</li>
 * <li>a bottom row with a layer slider, {@code All layers}, {@code X-ray: on/off}, {@code Reload} and
 * {@code Hide ghosts}/{@code Show ghosts}.</li>
 * </ul>
 * Each control does what its {@code /planner} command does, through the session, so the chat answers as it does for the
 * command; the ghosts button only hides or shows the ghosts. With nothing loaded the screen says how to load a line
 * and offers one button per project with a saved token; for a line that is not placed, or is in another dimension, the
 * HUD's first line takes the model's place.
 *
 * <p>Anything in the screen's own panels or controls that fails is logged once and shown in the right column instead of
 * the steps until the game restarts, as the model's failures are. The game is not paused while it is open. Used on the
 * game thread only.
 */
public final class PlannerScreen extends GuiScreen {

    /** The model's area: under the title row, above the bottom row, left of the right column (this fraction). */
    private static final int MARGIN = 6, TITLE_HEIGHT = 20, BOTTOM_HEIGHT = 30;
    /** The key code of a key binding that has no key. */
    private static final int UNBOUND = 0;
    private static final double RIGHT_COLUMN = 0.34;
    /** Padding inside a panel, a step row's height, a needs line's height, the space between buttons. */
    private static final int PAD = 3, ROW = 11, LINE = 10, GAP = 4, BUTTON_HEIGHT = 20;
    /** Steps scrolled per wheel notch; the narrowest the layer slider gets; the project buttons' and text's width. */
    private static final int SCROLL_ROWS = 3, MIN_SLIDER = 20, PROJECT_WIDTH = 150, TEXT_WIDTH = 300;
    private static final int PANEL_COLOUR = 0xC0101018, FAILURE_COLOUR = 0xFFFF5555, SELECTED_COLOUR = 0xFF4A6FA5,
        HOVER_COLOUR = 0x30FFFFFF, SCROLLBAR_COLOUR = 0x80FFFFFF;
    /** Text colours (the font draws them opaque). */
    private static final int WHITE = 0xFFFFFF, TEXT = 0xE0E0E0, DONE = 0x55FF55, NO_BLOCKS = 0x808080, HINT = 0x909090,
        HEADER = 0xFFFF55;
    private static final String TITLE = "GTNH Planner", LAYER = "Layer", ALL_STEPS = "All steps", TICK = "✓ ",
        ELLIPSIS = "…";
    private static final String NOTHING_LOADED =
        "Nothing loaded. Paste the /planner load line from the project's In-game projector panel into chat.";
    private static final String HINT_TEXT =
        "drag: turn · right-drag: pan · scroll: zoom · click a block: show it in the world";
    private static final String FAILED = "The planner screen failed: %s";
    /** The sound a button makes when pressed, made by a step row too. */
    private static final ResourceLocation BUTTON_SOUND = new ResourceLocation("gui.button.press");
    private static final String X_RAY_ON = "X-ray: on", X_RAY_OFF = "X-ray: off", HIDE = "Hide ghosts",
        SHOW = "Show ghosts";
    /** Button ids; the project buttons count up from the last. */
    private static final int ID_SLIDER = 1, ID_ALL_LAYERS = 2, ID_X_RAY = 3, ID_RELOAD = 4, ID_GHOSTS = 5,
        ID_PROJECT = 100;

    /** Why the screen's panels failed, shown instead of the steps until the game restarts; null while they work. */
    private static String panelFailure;

    private final ProjectorSession session;
    private final ScreenModel model;
    /** The key binding that opened the screen; its key closes it too. */
    private final KeyBinding openKey;

    private LayerSlider slider;
    private GuiButton allLayers, xRay, reload, ghosts;
    /** The project buttons shown when nothing is loaded, and the project id of each. */
    private final List<GuiButton> projectButtons = new ArrayList<>();
    private final List<String> projectIds = new ArrayList<>();
    /** The nothing-loaded text, wrapped, and where it starts. */
    private List<String> nothingLoaded = Collections.emptyList();
    private int nothingLoadedTop;

    /** The right column's left and right edges. */
    private int columnLeft, columnRight;
    /** The step list as last drawn: whether it was, its top and bottom, how many rows fit, and the most it scrolls. */
    private boolean listShown;
    private int listTop, listBottom, listRows, maxScroll;
    /** The row at the top of the step list (0 is {@code All steps}). */
    private int scroll;

    public PlannerScreen(ProjectorSession session, ProjectorConfig config, BlockIcons icons, KeyBinding openKey) {
        this.session = session;
        this.openKey = openKey;
        this.model = new ScreenModel(session, config, icons);
    }

    /**
     * Opening the screen ends the finding of a ghost. Lays out the model, the right column, the bottom row's buttons
     * (right-aligned, the slider taking the rest) and the project buttons, in a grid under the nothing-loaded text.
     */
    @Override
    public void initGui() {
        session.screenOpened();
        int modelRight = (int) (width * (1 - RIGHT_COLUMN)) - MARGIN;
        model.setArea(MARGIN, TITLE_HEIGHT, modelRight, height - BOTTOM_HEIGHT);
        columnLeft = modelRight + MARGIN;
        columnRight = width - MARGIN;

        int y = height - BOTTOM_HEIGHT + (BOTTOM_HEIGHT - BUTTON_HEIGHT) / 2;
        ghosts = button(ID_GHOSTS, width - MARGIN, y, HIDE, SHOW);
        reload = button(ID_RELOAD, ghosts.xPosition - GAP, y, "Reload");
        xRay = button(ID_X_RAY, reload.xPosition - GAP, y, X_RAY_OFF, X_RAY_ON);
        allLayers = button(ID_ALL_LAYERS, xRay.xPosition - GAP, y, "All layers");
        int sliderLeft = MARGIN + fontRendererObj.getStringWidth(LAYER) + GAP;
        slider = new LayerSlider(ID_SLIDER, sliderLeft, y, Math.max(MIN_SLIDER, allLayers.xPosition - GAP - sliderLeft),
            BUTTON_HEIGHT, this::layerPicked);
        buttonList.add(slider);

        int textWidth = Math.min(TEXT_WIDTH, width - 2 * MARGIN);
        nothingLoaded = fontRendererObj.listFormattedStringToWidth(NOTHING_LOADED, textWidth);
        nothingLoadedTop = TITLE_HEIGHT + 2 * MARGIN;
        projectButtons.clear();
        projectIds.clear();
        List<String> ids = session.savedProjects();
        int top = nothingLoadedTop + nothingLoaded.size() * fontRendererObj.FONT_HEIGHT + 2 * MARGIN;
        int w = Math.min(PROJECT_WIDTH, width - 2 * MARGIN);
        int perColumn = Math.max(1, (height - MARGIN - top + GAP) / (BUTTON_HEIGHT + GAP));
        int fitting = (width - 2 * MARGIN + GAP) / (w + GAP);
        int columns = Math.max(1, Math.min((ids.size() + perColumn - 1) / perColumn, fitting));
        int rows = Math.min(perColumn, (ids.size() + columns - 1) / columns);
        int left = (width - columns * w - (columns - 1) * GAP) / 2;
        for (int i = 0; i < ids.size() && i < rows * columns; i++) {
            int bx = left + i / rows * (w + GAP), by = top + i % rows * (BUTTON_HEIGHT + GAP);
            GuiButton b = new GuiButton(ID_PROJECT + i, bx, by, w, BUTTON_HEIGHT, fit(ids.get(i), w - 8));
            buttonList.add(b);
            projectButtons.add(b);
            projectIds.add(ids.get(i));
        }
        updateButtons();
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
        updateButtons();
        listShown = false;
        int hover = -1;
        ProjectorData data = session.data();
        if (data == null) {
            drawTitle(TITLE, null);
            int y = nothingLoadedTop;
            for (String line : nothingLoaded) {
                drawCenteredString(fontRendererObj, line, width / 2, y, TEXT);
                y += fontRendererObj.FONT_HEIGHT;
            }
        } else {
            boolean here = session.visibleHere();
            drawRect(model.left(), model.top(), model.right(), model.bottom(), PANEL_COLOUR);
            if (here) {
                hover = model.draw(mouseX, mouseY, partialTicks);
                if (ScreenModel.failure() != null) drawInModel(ScreenModel.failure(), FAILURE_COLOUR);
                else drawHint();
            } else {
                List<String> hud = session.hudLines();
                drawInModel(hud.isEmpty() ? "" : hud.get(0), TEXT);
            }
            drawPanels(data, here, mouseX, mouseY);
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

    /** Esc (as usual), the planner key when it is bound, or the inventory key closes the screen. */
    @Override
    protected void keyTyped(char typed, int keyCode) {
        int opener = openKey.getKeyCode();
        if (keyCode == mc.gameSettings.keyBindInventory.getKeyCode() || (opener != UNBOUND && keyCode == opener)) {
            mc.displayGuiScreen(null);
            return;
        }
        super.keyTyped(typed, keyCode);
    }

    /** A click on a step picks it, a press on the model starts a drag, and the buttons work as usual. */
    @Override
    protected void mouseClicked(int mouseX, int mouseY, int button) {
        super.mouseClicked(mouseX, mouseY, button);
        if (button == 0) clickStep(mouseX, mouseY);
        model.press(mouseX, mouseY, button);
    }

    /** Left-drag turns the model, right-drag pans it. */
    @Override
    protected void mouseClickMove(int mouseX, int mouseY, int button, long sinceClick) {
        super.mouseClickMove(mouseX, mouseY, button, sinceClick);
        model.drag(mouseX, mouseY, button);
    }

    /** Releasing the left button without dragging, over a block of the model, finds it and closes the screen. */
    @Override
    protected void mouseMovedOrUp(int mouseX, int mouseY, int button) {
        super.mouseMovedOrUp(mouseX, mouseY, button);
        int block = model.release(mouseX, mouseY, button);
        if (block < 0) return;
        session.find(block);
        mc.displayGuiScreen(null);
    }

    /** The wheel scrolls the step list under the mouse, or zooms the model under it. */
    @Override
    public void handleMouseInput() {
        super.handleMouseInput();
        int wheel = Mouse.getEventDWheel();
        if (wheel == 0) return;
        int x = Mouse.getEventX() * width / mc.displayWidth;
        int y = height - Mouse.getEventY() * height / mc.displayHeight - 1;
        if (inList(x, y)) scroll = Math.max(0, Math.min(maxScroll, scroll - Integer.signum(wheel) * SCROLL_ROWS));
        model.wheel(x, y, wheel);
    }

    /** The bottom row's buttons and the project buttons each run their command; the slider acts on release. */
    @Override
    protected void actionPerformed(GuiButton button) {
        try {
            int project = projectButtons.indexOf(button);
            if (button == allLayers) session.run(Command.layer(null));
            else if (button == xRay) session.run(Command.xray(null));
            else if (button == reload) session.run(Command.reload());
            else if (button == ghosts) session.setGhostsHidden(!session.ghostsHidden());
            else if (project >= 0) session.run(Command.load(projectIds.get(project), null));
        } catch (Throwable failure) {
            fail(failure);
        }
    }

    /** The slider picked layer {@code y}: shows only that layer, unless it already is the one shown. */
    private void layerPicked(int y) {
        try {
            if (!Objects.equals(session.filter().layerY, y)) session.run(Command.layer(y));
        } catch (Throwable failure) {
            fail(failure);
        }
    }

    /**
     * Shows the bottom row with a line loaded and the project buttons without one, and puts the X-ray and ghosts
     * buttons' words and the slider's range and layer to what the session holds now. The slider works only for a placed
     * line, the only kind with a Y range.
     */
    private void updateButtons() {
        ProjectorData data = session.data();
        boolean loaded = data != null;
        for (GuiButton b : projectButtons) b.visible = !loaded;
        slider.visible = allLayers.visible = xRay.visible = reload.visible = ghosts.visible = loaded;
        if (!loaded) return;
        xRay.displayString = session.seeThrough() ? X_RAY_ON : X_RAY_OFF;
        ghosts.displayString = session.ghostsHidden() ? SHOW : HIDE;
        slider.enabled = data.placed() && data.size[1] > 0;
        slider.show(data.origin[1], data.origin[1] + data.size[1] - 1, session.filter().layerY);
    }

    /**
     * The title row's name and counts, the step list, what the current step still needs (only for a line placed here,
     * as on the HUD) and the slider's label; or, after a failure, the failure in the right column.
     */
    private void drawPanels(ProjectorData data, boolean here, int mouseX, int mouseY) {
        drawString(fontRendererObj, LAYER, MARGIN, slider.yPosition + (BUTTON_HEIGHT - 8) / 2, TEXT);
        int top = TITLE_HEIGHT, bottom = height - BOTTOM_HEIGHT;
        if (panelFailure == null) {
            try {
                drawTitle(data.name, here ? HudText.counts(data, session.states(), session.filter()) : null);
                if (columnRight - columnLeft <= 2 * PAD || bottom - top <= 2 * PAD) return;
                List<String> needs = here ? HudText.needs(data, session.states(), session.currentStep())
                    : Collections.<String>emptyList();
                int needsLines = Math.min(needs.size(), Math.max(0, ((bottom - top) / 2 - 2 * PAD) / LINE));
                int needsTop = needsLines == 0 ? bottom : bottom - needsLines * LINE - 2 * PAD;
                drawSteps(data, top, needsLines == 0 ? bottom : needsTop - GAP, mouseX, mouseY);
                if (needsLines > 0) {
                    drawRect(columnLeft, needsTop, columnRight, bottom, PANEL_COLOUR);
                    for (int i = 0; i < needsLines; i++) {
                        drawString(fontRendererObj, fit(needs.get(i), columnRight - columnLeft - 2 * PAD),
                            columnLeft + PAD, needsTop + PAD + i * LINE, i == 0 ? HEADER : TEXT);
                    }
                }
                return;
            } catch (Throwable failure) {
                fail(failure);
                listShown = false;
            }
        }
        drawTitle(data.name, null);
        drawRect(columnLeft, top, columnRight, bottom, PANEL_COLOUR);
        int y = top + PAD, w = Math.max(1, columnRight - columnLeft - 2 * PAD);
        for (String line : fontRendererObj.listFormattedStringToWidth(panelFailure, w)) {
            drawString(fontRendererObj, line, columnLeft + PAD, y, FAILURE_COLOUR);
            y += LINE;
        }
    }

    /** The name on the left of the title row (shortened to fit) and the counts, when given, on its right. */
    private void drawTitle(String name, String counts) {
        int y = (TITLE_HEIGHT - 8) / 2;
        int countsWidth = counts == null ? 0 : fontRendererObj.getStringWidth(counts);
        if (counts != null) drawString(fontRendererObj, counts, width - MARGIN - countsWidth, y, TEXT);
        int room = width - 2 * MARGIN - (counts == null ? 0 : countsWidth + 2 * GAP);
        drawString(fontRendererObj, fit(name, room), MARGIN, y, WHITE);
    }

    /**
     * The step list between {@code top} and {@code bottom}: the rows that fit from {@link #scroll} on, the shown one
     * highlighted, a clickable one under the mouse lit, and a scroll bar when they do not all fit.
     */
    private void drawSteps(ProjectorData data, int top, int bottom, int mouseX, int mouseY) {
        drawRect(columnLeft, top, columnRight, bottom, PANEL_COLOUR);
        int total = 1 + data.steps.size();
        listTop = top;
        listBottom = bottom;
        listRows = Math.max(0, (bottom - top - 2 * PAD) / ROW);
        maxScroll = Math.max(0, total - listRows);
        scroll = Math.max(0, Math.min(maxScroll, scroll));
        listShown = true;
        int bar = maxScroll > 0 ? 4 : 0;
        int rowRight = columnRight - 1 - bar, textWidth = columnRight - columnLeft - 2 * PAD - bar;
        int selected = session.filter().stepIndex + 1;
        int hovered = inList(mouseX, mouseY) ? rowAt(mouseY) : -1;
        for (int k = 0; k < listRows && scroll + k < total; k++) {
            int row = scroll + k, y = top + PAD + k * ROW;
            PlannedStep step = row == 0 ? null : data.steps.get(row - 1);
            boolean clickable = step == null || step.hasBlocks();
            if (row == selected) drawRect(columnLeft + 1, y - 1, rowRight, y + ROW - 1, SELECTED_COLOUR);
            else if (row == hovered && clickable) drawRect(columnLeft + 1, y - 1, rowRight, y + ROW - 1, HOVER_COLOUR);
            String text;
            int colour;
            if (step == null) {
                text = ALL_STEPS;
                colour = row == selected ? WHITE : TEXT;
            } else {
                boolean done = session.stepDone(row - 1);
                text = (done ? TICK : "") + step.order + ". " + step.text;
                colour = !clickable ? NO_BLOCKS : done ? DONE : row == selected ? WHITE : TEXT;
            }
            drawString(fontRendererObj, fit(text, textWidth), columnLeft + PAD, y + 1, colour);
        }
        if (bar > 0) {
            int trackTop = top + PAD, trackHeight = bottom - top - 2 * PAD;
            int thumb = Math.max(ROW, trackHeight * listRows / total);
            int thumbTop = trackTop + (trackHeight - thumb) * scroll / maxScroll;
            drawRect(columnRight - PAD - 2, thumbTop, columnRight - PAD, thumbTop + thumb, SCROLLBAR_COLOUR);
        }
    }

    /** A left click on a step row shows that step, or every step, as {@code /planner step} does; grey rows don't. */
    private void clickStep(int mouseX, int mouseY) {
        if (!inList(mouseX, mouseY)) return;
        try {
            ProjectorData data = session.data();
            int row = rowAt(mouseY);
            if (data == null || row < 0 || row > data.steps.size()) return;
            if (row == 0) {
                session.run(Command.step("all"));
            } else {
                PlannedStep step = data.steps.get(row - 1);
                if (!step.hasBlocks()) return;
                session.run(Command.step(String.valueOf(step.order)));
            }
            mc.getSoundHandler().playSound(PositionedSoundRecord.func_147674_a(BUTTON_SOUND, 1f));
        } catch (Throwable failure) {
            fail(failure);
        }
    }

    /** Whether the point is on the step list as last drawn. */
    private boolean inList(int x, int y) {
        return listShown && x >= columnLeft && x < columnRight && y >= listTop && y < listBottom;
    }

    /** The step row (0 is {@code All steps}) at height {@code y} of the step list as last drawn, or −1. */
    private int rowAt(int y) {
        int k = Math.floorDiv(y - listTop - PAD, ROW);
        return k < 0 || k >= listRows ? -1 : scroll + k;
    }

    /** How to move the model, in grey along the bottom of its area, shortened to fit. */
    private void drawHint() {
        int w = model.right() - model.left() - 2 * PAD;
        if (w <= 0) return;
        drawString(fontRendererObj, fit(HINT_TEXT, w), model.left() + PAD, model.bottom() - PAD - 8, HINT);
    }

    /** The text, wrapped, in the middle of the model's area. */
    private void drawInModel(String text, int colour) {
        int w = model.right() - model.left() - 2 * MARGIN;
        if (w <= 0) return;
        List<String> lines = fontRendererObj.listFormattedStringToWidth(text, w);
        int y = (model.top() + model.bottom()) / 2 - lines.size() * fontRendererObj.FONT_HEIGHT / 2;
        for (String line : lines) {
            drawCenteredString(fontRendererObj, line, (model.left() + model.right()) / 2, y, colour);
            y += fontRendererObj.FONT_HEIGHT;
        }
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

    /**
     * A button {@code BUTTON_HEIGHT} high and as wide as the widest of its labels (it shows the first), whose right
     * edge is at {@code right}; added to the screen.
     */
    private GuiButton button(int id, int right, int y, String... labels) {
        int w = 0;
        for (String label : labels) w = Math.max(w, fontRendererObj.getStringWidth(label));
        w += 10;
        GuiButton b = new GuiButton(id, right - w, y, w, BUTTON_HEIGHT, labels[0]);
        buttonList.add(b);
        return b;
    }

    /** The text, or as much of it as fits in {@code w} pixels followed by {@code …}. */
    private String fit(String text, int w) {
        if (fontRendererObj.getStringWidth(text) <= w) return text;
        int room = w - fontRendererObj.getStringWidth(ELLIPSIS);
        return room <= 0 ? "" : fontRendererObj.trimStringToWidth(text, room) + ELLIPSIS;
    }

    /** Stops drawing the panels until the game restarts; the right column shows why, the log has the details once. */
    private void fail(Throwable failure) {
        if (panelFailure != null) return;
        String why = failure.getMessage() == null ? failure.toString() : failure.getMessage();
        panelFailure = String.format(FAILED, why);
        ClientProxy.LOG.error("The planner screen's panels failed; they are not drawn until the game restarts",
            failure);
    }
}
