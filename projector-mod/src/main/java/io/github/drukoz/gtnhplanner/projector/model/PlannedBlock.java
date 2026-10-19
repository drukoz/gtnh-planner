package io.github.drukoz.gtnhplanner.projector.model;

import java.util.List;

/**
 * One block of the line where the layout puts it, and what the build check compares there: the registry name always,
 * then {@link #meta}, {@link #mteId} and {@link #facing} where they are not −1.
 */
public final class PlannedBlock {

    /** The world position. */
    public final int x, y, z;
    /** The registry name to find there, for example {@code gregtech:gt.blockmachines} (for a part, its container block). */
    public final String id;
    /** The block meta, or −1 when meta is not compared (GT machines, chests, parts). */
    public final int meta;
    /** The GT meta tile entity id, or −1 when the block has none. */
    public final int mteId;
    /** The front, as ForgeDirection 0…5, or −1 when the front is not compared. */
    public final int facing;
    /** The multipart, conduit or ME cable part inside the {@link #id} block, or null for a plain block. */
    public final String part;
    /** What the block is in the line: {@code machine}, {@code casing}, {@code hatch}, {@code cable}, {@code pipe}, … */
    public final String role;
    /** The block's name for the player, for example {@code Basic Macerator}. */
    public final String label;
    /** The index in {@link ProjectorData#steps} of the build step that places it, or −1 when no step does. */
    public final int step;
    /** The covers on its faces; never null, empty when it has none. */
    public final List<PlannedCover> covers;

    PlannedBlock(int x, int y, int z, String id, int meta, int mteId, int facing, String part, String role, String label,
        int step, List<PlannedCover> covers) {
        this.x = x;
        this.y = y;
        this.z = z;
        this.id = id;
        this.meta = meta;
        this.mteId = mteId;
        this.facing = facing;
        this.part = part;
        this.role = role;
        this.label = label;
        this.step = step;
        this.covers = covers;
    }
}
