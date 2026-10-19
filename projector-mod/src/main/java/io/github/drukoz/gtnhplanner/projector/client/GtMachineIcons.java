package io.github.drukoz.gtnhplanner.projector.client;

import gregtech.api.GregTechAPI;
import gregtech.api.enums.Textures;
import gregtech.api.interfaces.IIconContainer;
import gregtech.api.interfaces.ITexture;
import gregtech.api.interfaces.metatileentity.IMetaTileEntity;
import gregtech.api.metatileentity.BaseMetaPipeEntity;
import gregtech.api.metatileentity.BaseMetaTileEntity;
import gregtech.api.metatileentity.MetaPipeEntity;
import gregtech.api.metatileentity.implementations.MTEBasicMachine;
import gregtech.common.render.GTCopiedBlockTextureRender;
import gregtech.common.render.GTMultiTextureRender;
import gregtech.common.render.GTRenderedTexture;
import gregtech.common.render.GTSidedTextureRender;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.List;
import net.minecraft.block.Block;
import net.minecraft.util.IIcon;
import net.minecraftforge.common.util.ForgeDirection;

/**
 * The faces of a GT machine as icons (research textures-icons §3.5, the tree the planner's 3D view reads too): a
 * prototype tile entity, never put into a world, is asked for each side's {@code ITexture} tree, and the tree is
 * flattened to its icons, bottom layer first. GT's own renderer, which needs its block-rendering context, is never
 * called. GT's colour modulation of a layer is not kept: ghosts are drawn with the icons as they are.
 */
final class GtMachineIcons {

    private static final int SIDES = 6;
    /** The side a copied block texture has when it draws whichever side is being drawn (as GT's own code reads it). */
    private static final int DRAWN_SIDE = 6;
    /** Every side connected (ForgeDirection flags): a pipe drawn as a whole cube, the way the exporter dumps pipes. */
    private static final int ALL_SIDES = 63;
    /** Deeper than any real GT texture tree; stops one that contains itself. */
    private static final int MAX_DEPTH = 16;
    /** Package-private in GT, so it is found by name. */
    private static final String CTM_TEXTURE = "gregtech.common.render.GTCopiedCTMBlockTexture";

    // The texture fields, looked up once (the javap check of Task 11 Step 1 pins their names and types).
    private static Field multiTextures, sidedTextures, iconContainer, copiedBlock, copiedSide, copiedMeta;
    private static Class<?> ctmTexture;
    private static Field ctmBlock, ctmSide, ctmMeta;
    private static boolean fieldsFound;

    private GtMachineIcons() {}

    /**
     * The icons of each side ({@code [side][layer]}, ForgeDirection order) of GT machine {@code mteId} with its
     * front facing on side {@code facing} (0…5); null when GT cannot draw it this way (no such machine, or anything
     * fails).
     *
     * <p>{@code facing} is GT's front facing, which {@code getTexture} is given as its facing. On a basic (single-block)
     * machine that is its output side, where GT draws the output overlay; the face overlay goes on the machine's own
     * main facing, which a prototype has unknown (the constructor {@code newMetaEntity} copies through ends with
     * {@code mMainFacing = UNKNOWN}), so it would draw no face overlay at all. The prototype gets the main facing a
     * placed machine has with that output side: the opposite side, where GT puts it when the machine is placed (it
     * sets the main facing to the side the front was put on and moves the front facing, the output side, opposite),
     * and never the output side itself. GT allows only north, south, west and east as a main facing, so with an
     * output side up or down it stays unknown. A pipe or cable is drawn by GT through its own pipe base with every
     * side connected: a plain machine base refuses it, and its machine-style {@code getTexture} is GT's error texture.
     */
    static IIcon[][] faces(int mteId, int facing) {
        try {
            IMetaTileEntity proto = GregTechAPI.METATILEENTITIES[mteId];
            if (proto == null) return null;
            findFields();
            ForgeDirection front = ForgeDirection.getOrientation(facing);
            IIcon[][] faces = new IIcon[SIDES][];
            if (proto instanceof MetaPipeEntity) {
                BaseMetaPipeEntity te = new BaseMetaPipeEntity();
                te.setInitialValuesAsNBT(null, (short) mteId);
                MetaPipeEntity pipe = (MetaPipeEntity) te.getMetaTileEntity();
                for (int s = 0; s < SIDES; s++) {
                    ForgeDirection side = ForgeDirection.getOrientation(s);
                    faces[s] = icons(pipe.getTexture(te, side, ALL_SIDES, -1, true, false), s);
                }
            } else {
                BaseMetaTileEntity te = new BaseMetaTileEntity();
                te.setInitialValuesAsNBT(null, (short) mteId);
                IMetaTileEntity mte = te.getMetaTileEntity();
                if (mte instanceof MTEBasicMachine) ((MTEBasicMachine) mte).mMainFacing = mainFacing(front);
                for (int s = 0; s < SIDES; s++) {
                    ForgeDirection side = ForgeDirection.getOrientation(s);
                    faces[s] = icons(mte.getTexture(te, side, front, -1, false, false), s);
                }
            }
            return faces;
        } catch (Throwable t) {
            ClientProxy.LOG.warn("GT machine {} is drawn in a plain colour: GT did not give its faces ({})", mteId, t);
            return null;
        }
    }

    /**
     * The main facing (face overlay) of a basic machine whose output side is {@code output}: the opposite side when
     * GT allows it as a main facing (north, south, west or east), else unknown.
     */
    private static ForgeDirection mainFacing(ForgeDirection output) {
        ForgeDirection main = output.getOpposite();
        return main != ForgeDirection.UNKNOWN && main.offsetY == 0 ? main : ForgeDirection.UNKNOWN;
    }

    /** The icons of one side's texture tree, in drawing order. */
    private static IIcon[] icons(ITexture[] textures, int side) throws IllegalAccessException {
        List<IIcon> out = new ArrayList<>();
        flatten(textures, side, out, 0);
        return out.toArray(new IIcon[0]);
    }

    /**
     * Appends the icons of {@code texture} on {@code side}: each of a multi-texture's layers in order, the side's
     * texture of a sided one, a rendered texture's icon and then its overlay, and a copied block's face (the side being
     * drawn when the copy's side is {@link #DRAWN_SIDE}, as GT's own {@code getIcon} reads it). Anything else draws
     * nothing, and so do GT's {@code VOID} and {@code RENDERING_ERROR} icons (as in the exporter's dump for the 3D
     * view): a side GT can only draw as its error texture has no icons, so the block shows its plain colour.
     */
    private static void flatten(Object texture, int side, List<IIcon> out, int depth) throws IllegalAccessException {
        if (texture == null || depth > MAX_DEPTH) return;
        if (texture instanceof ITexture[]) {
            for (ITexture t : (ITexture[]) texture) flatten(t, side, out, depth + 1);
        } else if (texture instanceof GTMultiTextureRender) {
            flatten(multiTextures.get(texture), side, out, depth + 1);
        } else if (texture instanceof GTSidedTextureRender) {
            ITexture[] bySide = (ITexture[]) sidedTextures.get(texture);
            if (bySide != null && side < bySide.length) flatten(bySide[side], side, out, depth + 1);
        } else if (texture instanceof GTRenderedTexture) {
            IIconContainer container = (IIconContainer) iconContainer.get(texture);
            if (container != null && container != Textures.BlockIcons.VOID
                && container != Textures.BlockIcons.RENDERING_ERROR) {
                add(out, container.getIcon());
                add(out, container.getOverlayIcon());
            }
        } else if (texture instanceof GTCopiedBlockTextureRender) {
            copiedFace(texture, copiedBlock, copiedSide, copiedMeta, side, out);
        } else if (ctmTexture.isInstance(texture)) {
            copiedFace(texture, ctmBlock, ctmSide, ctmMeta, side, out);
        }
    }

    private static void copiedFace(Object texture, Field block, Field copySide, Field meta, int side, List<IIcon> out)
        throws IllegalAccessException {
        Block copied = (Block) block.get(texture);
        if (copied == null) return;
        int s = ((Number) copySide.get(texture)).intValue();
        add(out, copied.getIcon(s == DRAWN_SIDE ? side : s, ((Number) meta.get(texture)).intValue()));
    }

    private static void add(List<IIcon> out, IIcon icon) {
        if (icon != null) out.add(icon);
    }

    /** Finds the texture fields the first time; a failure is tried again next time (and makes that machine plain). */
    private static void findFields() throws ReflectiveOperationException {
        if (fieldsFound) return;
        multiTextures = field(GTMultiTextureRender.class, "mTextures");
        sidedTextures = field(GTSidedTextureRender.class, "mTextures");
        iconContainer = field(GTRenderedTexture.class, "mIconContainer");
        copiedBlock = field(GTCopiedBlockTextureRender.class, "mBlock");
        copiedSide = field(GTCopiedBlockTextureRender.class, "mSide");
        copiedMeta = field(GTCopiedBlockTextureRender.class, "mMeta");
        ctmTexture = Class.forName(CTM_TEXTURE, false, GTRenderedTexture.class.getClassLoader());
        ctmBlock = field(ctmTexture, "mBlock");
        ctmSide = field(ctmTexture, "mSide");
        ctmMeta = field(ctmTexture, "mMeta");
        fieldsFound = true;
    }

    private static Field field(Class<?> owner, String name) throws NoSuchFieldException {
        Field f = owner.getDeclaredField(name);
        f.setAccessible(true);
        return f;
    }
}
