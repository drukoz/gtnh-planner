package io.github.drukoz.gtnhplanner.projector.model;

/** A cover on one face of a planned block: drawn there with its item's icon, never checked. */
public final class PlannedCover {

    /** The face it goes on, as ForgeDirection: down 0, up 1, north 2, south 3, west 4, east 5. */
    public final int face;
    /** The cover item's planner key, for example {@code gregtech:gt.metaitem.01@32630}. */
    public final String item;
    /** The cover's name for the player, for example {@code Conveyor Module (LV)}. */
    public final String label;

    PlannedCover(int face, String item, String label) {
        this.face = face;
        this.item = item;
        this.label = label;
    }
}
