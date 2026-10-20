package io.github.drukoz.gtnhplanner.projector.client;

import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiButton;
import org.lwjgl.opengl.GL11;

/**
 * The planner screen's layer slider (spec §2.4 of the aim and screen design): a bar over the line's Y range, drawn like
 * the game's option sliders, with a knob on the layer the filter shows ({@code y=<y> (<n> of <count>)}), or at the top
 * layer reading {@code all} when every layer is shown. While the knob is dragged it follows the mouse and names the
 * layer under it; only on release is that layer handed to the screen, so dragging across the line sends one
 * {@code /planner layer} and not one per layer. Used on the game thread only.
 */
final class LayerSlider extends GuiButton {

    /** Takes the layer a press and release on the slider picked. */
    interface Listener {
        void picked(int y);
    }

    /** The knob's width, in GUI pixels, drawn as two 4-pixel halves of the button texture. */
    private static final int KNOB = 8;

    private final Listener listener;
    /** The line's lowest and highest layer. */
    private int min, max;
    /** The layer the knob is on: the dragged one while dragging, else the filter's; null for every layer. */
    private Integer layer;
    private boolean dragging;

    LayerSlider(int id, int x, int y, int width, int height, Listener listener) {
        super(id, x, y, width, height, "");
        this.listener = listener;
    }

    /**
     * The line's Y range ({@code min} to {@code max}, both included) and the layer the filter shows (null: every
     * layer); left alone while the knob is dragged.
     */
    void show(int min, int max, Integer layer) {
        if (dragging) return;
        this.min = min;
        this.max = Math.max(min, max);
        this.layer = layer;
        displayString = text();
    }

    /** The bar is always drawn as the game draws a slider's bar: the disabled button look. */
    @Override
    public int getHoverState(boolean mouseOver) {
        return 0;
    }

    /** Called by {@link #drawButton} every frame: follows the mouse while dragging, then draws the knob. */
    @Override
    protected void mouseDragged(Minecraft mc, int mouseX, int mouseY) {
        if (!visible) return;
        if (dragging) pick(mouseX);
        int knob = xPosition + (int) (fraction() * Math.max(0, width - KNOB));
        GL11.glColor4f(1f, 1f, 1f, 1f);
        drawTexturedModalRect(knob, yPosition, 0, 66, KNOB / 2, height);
        drawTexturedModalRect(knob + KNOB / 2, yPosition, 200 - KNOB / 2, 66, KNOB / 2, height);
    }

    /** A press on the bar starts a drag with the knob under the mouse. */
    @Override
    public boolean mousePressed(Minecraft mc, int mouseX, int mouseY) {
        if (!super.mousePressed(mc, mouseX, mouseY)) return false;
        dragging = true;
        pick(mouseX);
        return true;
    }

    /** Releasing the left button ends the drag and hands the layer under the mouse to the listener. */
    @Override
    public void mouseReleased(int mouseX, int mouseY) {
        if (!dragging) return;
        dragging = false;
        pick(mouseX);
        listener.picked(layer);
    }

    /** Puts the knob on the layer under the mouse. */
    private void pick(int mouseX) {
        double f = (mouseX - (xPosition + KNOB / 2)) / (double) Math.max(1, width - KNOB);
        layer = min + (int) Math.round(Math.max(0, Math.min(1, f)) * (max - min));
        displayString = text();
    }

    /** Where the knob is along the bar, from 0 (lowest layer) to 1 (highest, or every layer). */
    private double fraction() {
        if (layer == null) return 1;
        if (max == min) return 0;
        return Math.max(0, Math.min(1, (layer - min) / (double) (max - min)));
    }

    private String text() {
        if (layer == null) return "all";
        if (layer < min || layer > max) return "y=" + layer;
        return "y=" + layer + " (" + (layer - min + 1) + " of " + (max - min + 1) + ")";
    }
}
