package io.github.drukoz.gtnhplanner.export.textures;

/**
 * A static field, or one element of a static array field, that holds an icon container (for GT a
 * {@code Textures.BlockIcons} constant or an {@code IIconContainer[]} element). Only names, so the exporter resolves
 * it by reflection later and nothing here touches Minecraft or GT.
 */
public final class IconRef {

    /** Internal name of the class that declares the field, e.g. {@code gregtech/api/enums/Textures$BlockIcons}. */
    public final String owner;
    public final String field;
    /** The array element, or -1 for a plain (non-array) field. */
    public final int index;

    public IconRef(String owner, String field, int index) {
        if (owner == null || field == null) throw new NullPointerException("IconRef needs an owner and a field");
        this.owner = owner;
        this.field = field;
        this.index = index;
    }

    @Override
    public boolean equals(Object o) {
        if (this == o) return true;
        if (!(o instanceof IconRef)) return false;
        IconRef r = (IconRef) o;
        return index == r.index && owner.equals(r.owner) && field.equals(r.field);
    }

    @Override
    public int hashCode() {
        return (owner.hashCode() * 31 + field.hashCode()) * 31 + index;
    }

    @Override
    public String toString() {
        return owner + "." + field + "[" + index + "]";
    }
}
