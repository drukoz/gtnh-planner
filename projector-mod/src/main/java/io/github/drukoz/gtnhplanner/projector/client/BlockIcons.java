package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.registry.GameData;
import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import java.util.HashMap;
import java.util.Map;
import net.minecraft.block.Block;
import net.minecraft.init.Blocks;
import net.minecraft.util.IIcon;

/**
 * How each planned block looks as a ghost (spec §3.13: real textures, plain colour by kind only where a texture
 * cannot be resolved, as §3.8 says for the 3D view). A GT machine shows the faces GT draws for it with its front
 * facing (a single-block machine's output side) where the planner puts it; any other block the client knows shows its
 * own face icons; a multipart, conduit or ME cable part (only its container block is known), a block the client does
 * not know, and anything whose icons are missing show white stained clay tinted by the block's role. Used on the game
 * thread only.
 */
public final class BlockIcons {

    private static final int SIDES = 6;
    /** The front a GT machine is drawn with when the planner does not compare its front: south. */
    private static final int DEFAULT_FRONT = 3;

    /**
     * The icons found for each {@code id@meta@mteId@facing}; null when there are none, so the block shows its role's
     * colour. The colour is not part of the key: blocks with the same key may have different roles.
     */
    private final Map<String, FaceIcons> found = new HashMap<>();
    /** The plain-colour look of each role. */
    private final Map<String, FaceIcons> fallbacks = new HashMap<>();

    /** How {@code b} looks: its own icons where the game gives them, else its role's colour on every face. */
    public FaceIcons forBlock(PlannedBlock b) {
        if (b.part != null) return fallback(b.role);
        String key = b.id + "@" + b.meta + "@" + b.mteId + "@" + b.facing;
        FaceIcons icons = found.get(key);
        if (icons == null && !found.containsKey(key)) {
            icons = lookUp(b);
            found.put(key, icons);
        }
        return icons != null ? icons : fallback(b.role);
    }

    /**
     * Forgets every look found so far. Done on a disconnect, so icons from before a resource-pack reload (which makes
     * new ones) are not kept past it.
     */
    public void clear() {
        found.clear();
        fallbacks.clear();
    }

    /** The white icon of every plain-colour face and of a cover whose icon is unknown: white stained clay. */
    static IIcon white() {
        return Blocks.stained_hardened_clay.getIcon(0, 0);
    }

    /** {@code b}'s own icons, or null when the game cannot give one for every face. */
    private static FaceIcons lookUp(PlannedBlock b) {
        IIcon[][] faces;
        try {
            if (b.mteId >= 0) {
                faces = GtMachineIcons.faces(b.mteId, b.facing < 0 ? DEFAULT_FRONT : b.facing);
            } else if (GameData.getBlockRegistry().containsKey(b.id)) {
                faces = blockFaces(GameData.getBlockRegistry().getObject(b.id), Math.max(b.meta, 0));
            } else {
                faces = null;
            }
        } catch (Throwable t) {
            faces = null;
        }
        return complete(faces) ? new FaceIcons(faces, 1f, 1f, 1f) : null;
    }

    /** One icon per side, as the block gives them for {@code meta}. */
    private static IIcon[][] blockFaces(Block block, int meta) {
        IIcon[][] faces = new IIcon[SIDES][];
        for (int side = 0; side < SIDES; side++) faces[side] = new IIcon[] {block.getIcon(side, meta)};
        return faces;
    }

    /** Whether every side has at least one icon and none is missing. */
    private static boolean complete(IIcon[][] faces) {
        if (faces == null || faces.length != SIDES) return false;
        for (IIcon[] side : faces) {
            if (side == null || side.length == 0) return false;
            for (IIcon icon : side) {
                if (icon == null) return false;
            }
        }
        return true;
    }

    /** White stained clay on every face, tinted by the role's colour. */
    private FaceIcons fallback(String role) {
        FaceIcons look = fallbacks.get(role);
        if (look != null) return look;
        IIcon white = white();
        IIcon[][] faces = new IIcon[SIDES][];
        for (int side = 0; side < SIDES; side++) faces[side] = new IIcon[] {white};
        int[] rgb = roleColour(role);
        look = new FaceIcons(faces, rgb[0] / 255f, rgb[1] / 255f, rgb[2] / 255f);
        if (white != null) fallbacks.put(role, look); // before the block atlas is made there is no icon to keep
        return look;
    }

    /** The plain colour of each kind of block, as {r, g, b} 0…255. */
    private static int[] roleColour(String role) {
        switch (role == null ? "" : role) {
            case "machine":
                return new int[] {70, 130, 180};
            case "hatch":
                return new int[] {150, 150, 90};
            case "casing":
                return new int[] {120, 120, 120};
            case "transformer":
                return new int[] {200, 140, 40};
            case "cable":
                return new int[] {60, 60, 60};
            case "pipe":
                return new int[] {140, 140, 160};
            case "interface":
                return new int[] {126, 87, 194};
            case "chip_pipe":
                return new int[] {255, 112, 67};
            case "chest":
                return new int[] {160, 110, 50};
            default:
                return new int[] {200, 200, 200};
        }
    }
}
