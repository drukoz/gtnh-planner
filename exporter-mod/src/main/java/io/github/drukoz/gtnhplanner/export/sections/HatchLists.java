package io.github.drukoz.gtnhplanner.export.sections;

import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The verdict of one hatch probe (gt-mechanics.md §5.5, bullets 9 and 10): GT's structure check took the probe hatch
 * when it filed it in one of the controller's hatch lists and recorded no structure error on the probe's cell. A hatch
 * list is any non-static field of type Collection or Map that the controller's class or a superclass declares. These
 * are GregTech's own fields, read by reflection (mod classes keep their names), as are its private
 * {@code structureErrors} and {@code PositionedStructureError}'s coordinates. Only declared fields are ever asked for,
 * never {@code getMethods()}: that resolves every public signature, and on a dedicated server one names a client-only
 * class. Free of GregTech classes, so JUnit can test it.
 */
final class HatchLists {

    private HatchLists() {}

    /**
     * Fields no verdict reads, as {@code "<declaring class's simple name>.<field name>"}: GT's input-hatch, input-bus
     * and generic adders and the cracker's side adders file every ISmartInputHatch there before they check its type
     * (gt-mechanics.md §5.5, bullet 9).
     */
    static final Set<String> EXCLUDED = Collections.singleton("MTEMultiBlockBase.mSmartInputHatches");

    /** The simple name of the class of GT's errors that name a cell. */
    private static final String POSITIONED_ERROR = "PositionedStructureError";

    private static final ClassValue<Declared> DECLARED = new ClassValue<Declared>() {

        @Override
        protected Declared computeValue(Class<?> type) {
            return Declared.of(type);
        }
    };

    private static final ClassValue<Cell> CELLS = new ClassValue<Cell>() {

        @Override
        protected Cell computeValue(Class<?> type) {
            return Cell.of(type);
        }
    };

    /**
     * Whether a non-static field of type Collection or Map, declared by {@code machine}'s class or any superclass and
     * not named in {@code excluded}, holds {@code probe} or {@code probeBase} by identity — also as an element of a
     * collection or map value inside it (one level down: GT keeps lists of lists, such as the distillation tower's
     * output hatches by layer). A machine with a class whose fields cannot be read ({@link #unreadableClass}) gets no
     * answer rather than a partial one: {@link IllegalStateException}.
     */
    static boolean holds(Object machine, Object probe, Object probeBase, Set<String> excluded) {
        for (Class<?> c = machine.getClass(); c != null; c = c.getSuperclass()) {
            Throwable unreadable = DECLARED.get(c).unreadable;
            if (unreadable != null) {
                throw new IllegalStateException(
                    "the fields of " + c.getSimpleName() + " cannot be read: " + unreadable,
                    unreadable);
            }
        }
        for (Class<?> c = machine.getClass(); c != null; c = c.getSuperclass()) {
            Declared declared = DECLARED.get(c);
            for (int k = 0; k < declared.fields.length; k++) {
                if (excluded.contains(declared.names[k])) continue;
                if (filedIn(read(declared.fields[k], machine), probe, probeBase, true)) return true;
            }
        }
        return false;
    }

    /**
     * Whether {@code errors} holds an object of a class whose simple name is PositionedStructureError and whose int
     * fields x, y, z (private, read by reflection) are this cell. An error of that name without such fields throws
     * {@link IllegalStateException}: where GT failed is then unknown, and no verdict may guess it.
     */
    static boolean rejectedAt(Iterable<?> errors, int x, int y, int z) {
        for (Object error : errors) {
            if (error == null || !POSITIONED_ERROR.equals(error.getClass().getSimpleName())) continue;
            Cell cell = CELLS.get(error.getClass());
            if (cell.missing != null) throw new IllegalStateException(cell.missing);
            try {
                if (cell.x.getInt(error) == x && cell.y.getInt(error) == y && cell.z.getInt(error) == z) return true;
            } catch (IllegalAccessException e) {
                throw new IllegalStateException("the cell of " + error.getClass().getName() + " cannot be read", e);
            }
        }
        return false;
    }

    /**
     * One probe's verdict: taken when {@code holds(machine, probe, probeBase, excluded)} and not
     * {@code rejectedAt(errors, x, y, z)}.
     */
    static boolean taken(Object machine, Object probe, Object probeBase, Set<String> excluded, Iterable<?> errors,
        int x, int y, int z) {
        return holds(machine, probe, probeBase, excluded) && !rejectedAt(errors, x, y, z);
    }

    /**
     * The simple name of the first class of {@code machine}'s hierarchy (its class up to Object) whose declared fields
     * cannot be read, else null; cached per class. TecTech's {@code MTEBECStorage} is one on a dedicated server: it
     * declares fields of a client-only class (gt-mechanics.md §5.5, bullet 13).
     */
    static String unreadableClass(Object machine) {
        for (Class<?> c = machine.getClass(); c != null; c = c.getSuperclass()) {
            if (DECLARED.get(c).unreadable != null) return c.getSimpleName();
        }
        return null;
    }

    /** Whether {@code value}, a collection or a map, holds the probe as an element or a value, or one level down. */
    private static boolean filedIn(Object value, Object probe, Object probeBase, boolean descend) {
        Collection<?> members;
        if (value instanceof Collection) members = (Collection<?>) value;
        else if (value instanceof Map) members = ((Map<?, ?>) value).values();
        else return false;
        for (Object member : members) {
            if (member == null) continue;
            if (member == probe || member == probeBase) return true;
            if (descend && filedIn(member, probe, probeBase, false)) return true;
        }
        return false;
    }

    private static Object read(Field field, Object machine) {
        try {
            return field.get(machine);
        } catch (IllegalAccessException e) {
            throw new IllegalStateException(
                field.getDeclaringClass().getSimpleName() + "." + field.getName() + " cannot be read",
                e);
        }
    }

    /**
     * One class's own non-static fields of type Collection or Map, made accessible, each with its name as
     * {@link #EXCLUDED} spells it; or why they cannot be read.
     */
    private static final class Declared {

        final Field[] fields;
        final String[] names;
        /** Why the class's fields cannot be read; {@code null} when they can. */
        final Throwable unreadable;

        private Declared(Field[] fields, String[] names, Throwable unreadable) {
            this.fields = fields;
            this.names = names;
            this.unreadable = unreadable;
        }

        static Declared of(Class<?> type) {
            Field[] all;
            try {
                all = type.getDeclaredFields();
            } catch (Throwable t) { // a field of a type this side lacks, such as a client class on a dedicated server
                return unreadable(t);
            }
            List<Field> lists = new ArrayList<>();
            for (Field f : all) {
                if (Modifier.isStatic(f.getModifiers())) continue;
                Class<?> t = f.getType();
                if (!Collection.class.isAssignableFrom(t) && !Map.class.isAssignableFrom(t)) continue;
                try {
                    f.setAccessible(true);
                } catch (RuntimeException e) { // a list the verdict could not look into: no partial answers
                    return unreadable(e);
                }
                lists.add(f);
            }
            Field[] fields = lists.toArray(new Field[0]);
            String[] names = new String[fields.length];
            String declarer = type.getSimpleName() + ".";
            for (int k = 0; k < fields.length; k++) names[k] = declarer + fields[k].getName();
            return new Declared(fields, names, null);
        }

        private static Declared unreadable(Throwable why) {
            return new Declared(new Field[0], new String[0], why);
        }
    }

    /** An error class's int fields x, y, z, made accessible; or why it has none. */
    private static final class Cell {

        final Field x, y, z;
        /** Why the cell cannot be read; {@code null} when it can. */
        final String missing;

        private Cell(Field x, Field y, Field z, String missing) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.missing = missing;
        }

        static Cell of(Class<?> type) {
            try {
                return new Cell(coordinate(type, "x"), coordinate(type, "y"), coordinate(type, "z"), null);
            } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
                return new Cell(null, null, null, type.getName() + " has no readable int fields x, y, z: " + e);
            }
        }

        private static Field coordinate(Class<?> type, String name) throws NoSuchFieldException {
            Field f = type.getDeclaredField(name);
            if (f.getType() != int.class || Modifier.isStatic(f.getModifiers())) {
                throw new NoSuchFieldException(name + " is no int field of an instance");
            }
            f.setAccessible(true);
            return f;
        }
    }
}
