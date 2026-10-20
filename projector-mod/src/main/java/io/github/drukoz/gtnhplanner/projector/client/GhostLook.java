package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.registry.GameData;
import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.geom.Quads;
import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.PlannedCover;
import net.minecraft.item.Item;
import net.minecraft.util.IIcon;

/**
 * The quads a ghost is drawn with (spec §3.13), shared by the ghosts in the world and the planner screen's model: a
 * block as a cube with its own look ({@link BlockIcons}), coloured by what the build check found there (not placed:
 * faint with its own look; can't be checked: bluish; placed right: green; wrong block or front: red), and each cover
 * as its item's icon on the face it goes on. Used on the render thread, which is the game thread.
 */
final class GhostLook {

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
    /** {@code Item.getSpriteNumber()} of an item whose icons are on the item atlas (0 = the block atlas). */
    private static final int ITEM_ATLAS = 1;

    private final BlockIcons icons;

    GhostLook(BlockIcons icons) {
        this.icons = icons;
    }

    /**
     * The block's six faces at {@code x, y, z}, each with every layer of its look, in the colour of {@code s}; a block
     * not placed (or not checkable) at {@code ghostAlpha}. Goes on the block atlas.
     */
    void addBlock(QuadBatch blocks, PlannedBlock b, BlockState s, double x, double y, double z, float ghostAlpha) {
        addBlock(blocks, b, s, x, y, z, ghostAlpha, 1f);
    }

    /**
     * As {@link #addBlock(QuadBatch, PlannedBlock, BlockState, double, double, double, float)}, with every opacity,
     * the green and red shells' too, times {@code fade}: the planner screen draws the blocks its filter hides this way.
     */
    void addBlock(QuadBatch blocks, PlannedBlock b, BlockState s, double x, double y, double z, float ghostAlpha,
        float fade) {
        FaceIcons look = icons.forBlock(b);
        float r, g, bl, a;
        double grow = 0;
        switch (s) {
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
        a *= fade;
        for (int side = 0; side < look.layers.length; side++) {
            double[] quad = Quads.face(side, grow);
            for (IIcon icon : look.layers[side]) blocks.add(quad, icon, x, y, z, r, g, bl, a);
        }
    }

    /**
     * Each of the block's covers at {@code x, y, z}: a square with the cover item's own icon on the cover's face,
     * {@code registry@meta} (any {@code #…} suffix dropped) through the item registry and {@code getIconFromDamage},
     * in {@code covers} for an item whose icons are on the item atlas, else in {@code blocks} (the block atlas, such as
     * a block's item). A cover whose icon cannot be found is a light-blue square with the white icon, in
     * {@code blocks}.
     */
    void addCovers(QuadBatch blocks, QuadBatch covers, PlannedBlock b, double x, double y, double z) {
        for (PlannedCover c : b.covers) addCover(blocks, covers, c, x, y, z);
    }

    private static void addCover(QuadBatch blocks, QuadBatch covers, PlannedCover c, double x, double y, double z) {
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
                    QuadBatch batch = item.getSpriteNumber() == ITEM_ATLAS ? covers : blocks;
                    batch.add(quad, icon, x, y, z, 1f, 1f, 1f, COVER_ALPHA);
                    return;
                }
            }
        } catch (Throwable unknown) {
            // an item that cannot give this icon: drawn as an unknown cover
        }
        blocks.add(quad, BlockIcons.white(), x, y, z, UNKNOWN_COVER_R, UNKNOWN_COVER_G, UNKNOWN_COVER_B,
            UNKNOWN_COVER_ALPHA);
    }
}
