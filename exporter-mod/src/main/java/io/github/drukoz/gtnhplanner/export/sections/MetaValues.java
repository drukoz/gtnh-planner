package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.io.StringWriter;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.Modifier;
import java.math.BigDecimal;
import java.math.BigInteger;
import java.util.AbstractMap;
import java.util.ArrayList;
import java.util.Collection;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.UUID;

import net.minecraft.block.Block;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NBTBase;
import net.minecraftforge.fluids.Fluid;
import net.minecraftforge.fluids.FluidStack;

import com.google.gson.stream.JsonWriter;

import cpw.mods.fml.common.registry.GameData;
import gregtech.api.enums.Materials;
import io.github.drukoz.gtnhplanner.export.ItemTable;

/**
 * Recipe metadata values as JSON that comes out the same on every export of one pack, because the loader hashes the
 * meta into the recipe id (architecture §5: ids are stable across re-exports). Nothing goes through
 * {@code Object.toString}, which carries identity hash codes ({@code Sievert@6942eb29}).
 * <ul>
 * <li>{@code null} → {@code null}; {@code Boolean} and finite numbers as they are, other numbers as their text;</li>
 * <li>text, {@code Character} and {@code UUID} → their text; an enum → {@code name()}; a {@code Class} → its name;</li>
 * <li>{@code ItemStack} → {@code {"item": index}}; {@code FluidStack} → {@code [fluid name, amount]}; {@code Fluid}
 * → its name; {@code Item}, {@code Block} → registry name; GT {@code Materials} → {@code mName}; NBT → SNBT;</li>
 * <li>arrays and lists element by element; other collections sorted by the text of their elements; maps as objects
 * keyed by the text of their keys;</li>
 * <li>any other object: its instance fields (superclasses included; static, transient and synthetic ones, caches and
 * {@code null} values left out) as an object sorted by field name. A cache is a field whose name starts with
 * {@code cache} (any case): it holds data derived from the other fields, filled in whatever order its source had
 * (CropsNH's {@code cachedBreedingMachineCatalystsForNEI} lists the catalysts in hash order).</li>
 * </ul>
 * An object of a JDK class the list does not name, one without fields, one already on the path from the value (a
 * cycle) and one {@value #MAX_DEPTH} levels down become their class name (a lambda's without its run-time suffix). A
 * value with more than {@value #MAX_NODES} nodes is {@link Oversized}. The text used for sorting names items by
 * {@link ItemTable#keyOf} rather than by index, and items are interned only while writing, in the written order, so
 * neither the written value nor the items it adds to the table depend on a hash order.
 */
final class MetaValues {

    /** Levels below the value that are still expanded (the value itself is level 0). */
    static final int MAX_DEPTH = 4;
    /** Nodes one value may have: arrays, objects and leaves, counted over the whole value. */
    static final int MAX_NODES = 2000;

    private static final String LAMBDA = "$$Lambda";

    /** The value has more than {@link #MAX_NODES} nodes. */
    static final class Oversized extends RuntimeException {

        Oversized() {
            super("more than " + MAX_NODES + " nodes", null, false, false);
        }
    }

    /** An item stack, written as its index and sorted by its key. */
    private static final class ItemRef {

        final ItemStack stack;
        final String key;

        ItemRef(ItemStack stack) {
            this.stack = stack;
            this.key = ItemTable.keyOf(stack);
        }
    }

    private final IdentityHashMap<Object, Boolean> path = new IdentityHashMap<>();
    private int nodes;

    private MetaValues() {}

    /**
     * Writes {@code value} as JSON. Throws for a stack the item table cannot hold, a fluid stack without a fluid, and
     * {@link Oversized}; nothing is written to {@code j} before the whole value has been converted.
     */
    static void write(JsonWriter j, Object value, ItemTable items) throws IOException {
        Object tree = new MetaValues().tree(value, 0);
        writeTree(j, tree, items);
    }

    // ---- conversion ------------------------------------------------------------------------------------------------

    private Object tree(Object v, int depth) {
        if (++nodes > MAX_NODES) throw new Oversized();
        if (v == null || v instanceof Boolean || v instanceof String) return v;
        if (v instanceof Number) return number((Number) v);
        if (v instanceof CharSequence || v instanceof Character || v instanceof UUID) return v.toString();
        if (v instanceof Enum) return ((Enum<?>) v).name();
        if (v instanceof Class) return typeName((Class<?>) v);
        if (v instanceof ItemStack) return new ItemRef((ItemStack) v);
        if (v instanceof FluidStack) return fluidStack((FluidStack) v);
        if (v instanceof Fluid) return ((Fluid) v).getName();
        if (v instanceof Item) return registered(GameData.getItemRegistry().getNameForObject(v), v);
        if (v instanceof Block) return registered(GameData.getBlockRegistry().getNameForObject(v), v);
        if (v instanceof Materials) return ((Materials) v).mName;
        if (v instanceof NBTBase) return v.toString();
        if (depth >= MAX_DEPTH || path.containsKey(v)) return typeName(v.getClass());
        path.put(v, Boolean.TRUE);
        try {
            if (v.getClass().isArray()) return array(v, depth);
            if (v instanceof List) return list((List<?>) v, depth);
            if (v instanceof Collection) return sorted((Collection<?>) v, depth);
            if (v instanceof Map) return map((Map<?, ?>) v, depth);
            if (isJdk(v.getClass())) return typeName(v.getClass());
            return fields(v, depth);
        } finally {
            path.remove(v);
        }
    }

    private static Object number(Number n) {
        double d = n.doubleValue();
        if (Double.isNaN(d) || Double.isInfinite(d)) return String.valueOf(n);
        boolean plain = n instanceof Integer || n instanceof Long || n instanceof Short || n instanceof Byte
            || n instanceof Double || n instanceof Float || n instanceof BigInteger || n instanceof BigDecimal;
        return plain ? n : Double.valueOf(d); // another Number's toString need not be a JSON number
    }

    private static List<Object> fluidStack(FluidStack s) {
        if (s.getFluid() == null) throw new IllegalArgumentException("fluid stack without a fluid");
        List<Object> out = new ArrayList<>(2);
        out.add(s.getFluid().getName());
        out.add(s.amount);
        return out;
    }

    private static String registered(String name, Object v) {
        return name != null ? name : typeName(v.getClass());
    }

    private List<Object> array(Object v, int depth) {
        int n = Array.getLength(v);
        List<Object> out = new ArrayList<>(n);
        for (int i = 0; i < n; i++) out.add(tree(Array.get(v, i), depth + 1));
        return out;
    }

    private List<Object> list(List<?> v, int depth) {
        List<Object> out = new ArrayList<>(v.size());
        for (Object e : v) out.add(tree(e, depth + 1));
        return out;
    }

    /** A collection without an order of its own (a set, possibly hash-ordered): sorted by the text of its elements. */
    private List<Object> sorted(Collection<?> v, int depth) {
        List<Map.Entry<String, Object>> byText = new ArrayList<>(v.size());
        for (Object e : new ArrayList<Object>(v)) {
            Object t = tree(e, depth + 1);
            byText.add(new AbstractMap.SimpleImmutableEntry<>(sortText(t), t));
        }
        byText.sort(Map.Entry.comparingByKey());
        List<Object> out = new ArrayList<>(byText.size());
        for (Map.Entry<String, Object> e : byText) out.add(e.getValue());
        return out;
    }

    /** Keys by their text (a key that is not text by its sort text); of two keys with one text, the smaller value. */
    private Map<String, Object> map(Map<?, ?> v, int depth) {
        TreeMap<String, Object> out = new TreeMap<>();
        for (Map.Entry<?, ?> e : new ArrayList<Map.Entry<?, ?>>(v.entrySet())) {
            Object key = tree(e.getKey(), depth + 1);
            Object value = tree(e.getValue(), depth + 1);
            String name = key instanceof String ? (String) key : sortText(key);
            if (!out.containsKey(name) || sortText(value).compareTo(sortText(out.get(name))) < 0) out.put(name, value);
        }
        return out;
    }

    /** The instance fields of {@code v} and its superclasses below the JDK; a shadowed name gets its class prefixed. */
    private Object fields(Object v, int depth) {
        TreeMap<String, Object> out = new TreeMap<>();
        for (Class<?> c = v.getClass(); c != null && !isJdk(c); c = c.getSuperclass()) {
            Field[] declared;
            try {
                declared = c.getDeclaredFields();
            } catch (Throwable t) {
                return typeName(v.getClass()); // a field type the server lacks (client-only classes)
            }
            for (Field f : declared) {
                int m = f.getModifiers();
                if (Modifier.isStatic(m) || Modifier.isTransient(m) || f.isSynthetic()) continue;
                if (isCache(f.getName())) continue;
                Object value;
                try {
                    f.setAccessible(true);
                    value = f.get(v);
                } catch (Throwable t) {
                    continue; // the same field fails on every export, so leaving it out keeps the output stable
                }
                if (value == null) continue;
                String name = out.containsKey(f.getName()) ? c.getName() + "." + f.getName() : f.getName();
                out.put(name, tree(value, depth + 1));
            }
        }
        return out.isEmpty() ? typeName(v.getClass()) : out;
    }

    private static boolean isCache(String field) {
        return field.regionMatches(true, 0, "cache", 0, 5);
    }

    private static boolean isJdk(Class<?> c) {
        String n = c.getName();
        return n.startsWith("java.") || n.startsWith("javax.") || n.startsWith("sun.") || n.startsWith("jdk.")
            || n.startsWith("com.sun.");
    }

    /**
     * The class name; for a lambda class without its run-time suffix
     * ({@code Foo$$Lambda$12/0x…} → {@code Foo$$Lambda}).
     */
    static String typeName(Class<?> c) {
        String n = c.getName();
        int i = n.indexOf(LAMBDA);
        return i >= 0 ? n.substring(0, i + LAMBDA.length()) : n;
    }

    // ---- output ----------------------------------------------------------------------------------------------------

    private static void writeTree(JsonWriter j, Object t, ItemTable items) throws IOException {
        if (t == null) j.nullValue();
        else if (t instanceof Boolean) j.value(((Boolean) t).booleanValue());
        else if (t instanceof Number) j.value((Number) t);
        else if (t instanceof String) j.value((String) t);
        else if (t instanceof ItemRef) {
            j.beginObject().name("item").value(items.intern(((ItemRef) t).stack)).endObject();
        } else if (t instanceof List) {
            j.beginArray();
            for (Object e : (List<?>) t) writeTree(j, e, items);
            j.endArray();
        } else {
            j.beginObject();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) t).entrySet()) {
                j.name((String) e.getKey());
                writeTree(j, e.getValue(), items);
            }
            j.endObject();
        }
    }

    /** The JSON text of a converted value with items named by key: what sets and colliding map keys sort by. */
    private static String sortText(Object t) {
        StringWriter s = new StringWriter();
        JsonWriter j = new JsonWriter(s);
        j.setLenient(true); // a bare top-level value
        try {
            writeSortTree(j, t);
            j.flush();
        } catch (IOException e) {
            throw new IllegalStateException(e); // a StringWriter does not fail
        }
        return s.toString();
    }

    private static void writeSortTree(JsonWriter j, Object t) throws IOException {
        if (t instanceof ItemRef) {
            j.beginObject().name("item").value(((ItemRef) t).key).endObject();
        } else if (t instanceof List) {
            j.beginArray();
            for (Object e : (List<?>) t) writeSortTree(j, e);
            j.endArray();
        } else if (t instanceof Map) {
            j.beginObject();
            for (Map.Entry<?, ?> e : ((Map<?, ?>) t).entrySet()) {
                j.name((String) e.getKey());
                writeSortTree(j, e.getValue());
            }
            j.endObject();
        } else if (t == null) {
            j.nullValue();
        } else if (t instanceof Boolean) {
            j.value(((Boolean) t).booleanValue());
        } else if (t instanceof Number) {
            j.value((Number) t);
        } else {
            j.value((String) t);
        }
    }
}
