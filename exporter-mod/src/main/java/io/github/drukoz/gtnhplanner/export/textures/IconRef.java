package io.github.drukoz.gtnhplanner.export.textures;

import java.lang.reflect.Field;

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

    /**
     * The static field this ref names, found as the JVM resolves {@code GETSTATIC owner.field} (JVMS §5.4.3.2): the
     * field {@code owner} declares, else one of its superinterfaces' (recursively), else its superclass's
     * (recursively); made accessible. {@code owner} is loaded through {@code loader} without being initialized.
     */
    public Field resolve(ClassLoader loader) throws ClassNotFoundException, NoSuchFieldException {
        Class<?> c = Class.forName(owner.replace('/', '.'), false, loader);
        Field f = lookUp(c);
        if (f == null) throw new NoSuchFieldException(c.getName() + "." + field);
        f.setAccessible(true);
        return f;
    }

    private Field lookUp(Class<?> c) {
        try {
            return c.getDeclaredField(field);
        } catch (NoSuchFieldException notHere) {
            // then the superinterfaces, then the superclass
        }
        for (Class<?> i : c.getInterfaces()) {
            Field f = lookUp(i);
            if (f != null) return f;
        }
        Class<?> s = c.getSuperclass();
        return s == null ? null : lookUp(s);
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
