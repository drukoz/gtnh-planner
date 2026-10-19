package io.github.drukoz.gtnhplanner.projector.client;

import net.minecraft.util.IIcon;

/** How a ghost block looks: the icons of each of its faces, bottom layer first, and one tint over all of them. */
public final class FaceIcons {

    /** {@code [side][layer]}, sides in ForgeDirection order; every side has at least one icon. */
    public final IIcon[][] layers;
    /** The tint, each 0…1; 1 = none. */
    public final float r, g, b;

    FaceIcons(IIcon[][] layers, float r, float g, float b) {
        this.layers = layers;
        this.r = r;
        this.g = g;
        this.b = b;
    }
}
