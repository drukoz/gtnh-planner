package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;

import net.minecraft.item.ItemStack;
import net.minecraftforge.fluids.FluidStack;

import com.google.gson.stream.JsonWriter;

import io.github.drukoz.gtnhplanner.export.ItemTable;

/**
 * Slot writers shared by the recipe, machine and worldgen sections. An item slot is {@code null},
 * {@code [index, stackSize]} or {@code [index, stackSize, chance]}; a fluid slot is {@code null},
 * {@code [fluidName, litres]} or {@code [fluidName, litres, chance]}. Chances are on GT's 1/10000 scale and written
 * only when the chance array is non-null, has that index and the value is not {@value #FULL_CHANCE}. A stack that
 * cannot be written (an item missing from the registry, a fluid stack without a fluid) throws, so the caller's
 * per-element catch drops the whole element instead of writing it with a slot missing.
 */
public final class Stacks {

    /** GT's 100 %. */
    static final int FULL_CHANCE = 10000;

    private Stacks() {}

    /** An array of item slots; a {@code null} array is written as {@code []}, a {@code null} stack as {@code null}. */
    public static void items(JsonWriter w, ItemStack[] stacks, int[] chances, ItemTable t) throws IOException {
        w.beginArray();
        if (stacks != null) {
            for (int i = 0; i < stacks.length; i++) {
                ItemStack s = stacks[i];
                if (s == null) {
                    w.nullValue();
                    continue;
                }
                w.beginArray();
                w.value(t.intern(s));
                w.value(s.stackSize);
                writeChance(w, chances, i);
                w.endArray();
            }
        }
        w.endArray();
    }

    /** An array of fluid slots; a {@code null} array is written as {@code []}, a {@code null} stack as {@code null}. */
    public static void fluids(JsonWriter w, FluidStack[] stacks, int[] chances) throws IOException {
        w.beginArray();
        if (stacks != null) {
            for (int i = 0; i < stacks.length; i++) {
                FluidStack s = stacks[i];
                if (s == null) {
                    w.nullValue();
                    continue;
                }
                if (s.getFluid() == null) throw new IllegalArgumentException("fluid stack without a fluid");
                w.beginArray();
                w.value(s.getFluid().getName());
                w.value(s.amount);
                writeChance(w, chances, i);
                w.endArray();
            }
        }
        w.endArray();
    }

    /** One item as {@code [index, stackSize]}, or {@code null}. */
    public static void stack(JsonWriter w, ItemStack s, ItemTable t) throws IOException {
        if (s == null) {
            w.nullValue();
            return;
        }
        w.beginArray();
        w.value(t.intern(s));
        w.value(s.stackSize);
        w.endArray();
    }

    /**
     * Per-slot item alternatives ({@code inAlt}): one entry per slot, {@code null} where the slot has none. Writes
     * {@code name} only when at least one slot has an alternative.
     */
    public static void itemAlternatives(JsonWriter w, String name, ItemStack[][] alts, ItemTable t)
        throws IOException {
        if (!hasAny(alts)) return;
        w.name(name).beginArray();
        for (ItemStack[] slot : alts) {
            if (slot == null) w.nullValue();
            else items(w, slot, null, t);
        }
        w.endArray();
    }

    /** Per-slot fluid alternatives ({@code finAlt}), written like {@link #itemAlternatives}. */
    public static void fluidAlternatives(JsonWriter w, String name, FluidStack[][] alts) throws IOException {
        if (!hasAny(alts)) return;
        w.name(name).beginArray();
        for (FluidStack[] slot : alts) {
            if (slot == null) w.nullValue();
            else fluids(w, slot, null);
        }
        w.endArray();
    }

    private static boolean hasAny(Object[][] alts) {
        if (alts == null) return false;
        for (Object[] slot : alts) {
            if (slot != null && slot.length > 0) return true;
        }
        return false;
    }

    private static void writeChance(JsonWriter w, int[] chances, int i) throws IOException {
        if (chances != null && i < chances.length && chances[i] != FULL_CHANCE) w.value(chances[i]);
    }
}
