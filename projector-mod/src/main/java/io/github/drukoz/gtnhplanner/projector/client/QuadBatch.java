package io.github.drukoz.gtnhplanner.projector.client;

import io.github.drukoz.gtnhplanner.projector.geom.Quads;
import java.util.Arrays;
import net.minecraft.client.renderer.Tessellator;
import net.minecraft.util.IIcon;
import org.lwjgl.opengl.GL11;

/**
 * Quads waiting to be drawn, as the ghosts and the planner screen's model build them: per quad its colour, then 4
 * corners of x, y, z and atlas u, v. Drawing goes through the Tessellator and sets no GL state, so a display list
 * compiled from it holds only geometry and colour. Used on the render thread, which is the game thread.
 */
final class QuadBatch {

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

    /** Compiles the batch into {@code list}: Tessellator geometry and colour only. */
    void compile(int list) {
        GL11.glNewList(list, GL11.GL_COMPILE);
        try {
            if (!isEmpty()) draw();
        } finally {
            GL11.glEndList();
        }
    }

    /** Sends the batch through the Tessellator; it is left ready for the game's own drawing even when this fails. */
    void draw() {
        Tessellator tessellator = Tessellator.instance;
        tessellator.startDrawingQuads();
        try {
            emit(tessellator);
        } finally {
            tessellator.draw();
        }
    }

    private void emit(Tessellator tessellator) {
        for (int q = 0; q < size; q += QUAD) {
            tessellator.setColorRGBA_F((float) values[q], (float) values[q + 1], (float) values[q + 2],
                (float) values[q + 3]);
            for (int i = q + 4; i < q + QUAD; i += CORNER) {
                tessellator.addVertexWithUV(values[i], values[i + 1], values[i + 2], values[i + 3], values[i + 4]);
            }
        }
    }
}
