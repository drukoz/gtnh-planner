package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Collections;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

import net.minecraft.item.ItemStack;
import net.minecraft.item.crafting.CraftingManager;
import net.minecraft.item.crafting.IRecipe;
import net.minecraft.item.crafting.ShapedRecipes;
import net.minecraft.item.crafting.ShapelessRecipes;
import net.minecraftforge.oredict.OreDictionary;
import net.minecraftforge.oredict.ShapedOreRecipe;
import net.minecraftforge.oredict.ShapelessOreRecipe;

import com.google.gson.stream.JsonWriter;

import cpw.mods.fml.common.FMLLog;
import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;

/**
 * {@code recipesCrafting}: every crafting-table recipe, {@code {cls, shape, w?, h?, mirrored?, in?, out}}. The four
 * shapes it can read are taken most specific first; any other class is {@code opaque} (output only). An input slot is
 * {@code null}, an item index, {@code {"ore": name}} for a list that is the ore dictionary's own list of that name, or
 * {@code [index, …]} for any other list. Recipes without an output are skipped.
 */
public final class CraftingSection implements ExportSection {

    /** How many opaque recipe classes the summary warning names. */
    private static final int TOP_OPAQUE = 10;

    @Override
    public String name() {
        return "recipesCrafting";
    }

    @Override
    public void export(ExportContext ctx) throws Exception {
        // Forge's own private fields (not obfuscated, checked with javap); a missing one fails the export loudly
        Field width = accessible(ShapedOreRecipe.class.getDeclaredField("width"));
        Field height = accessible(ShapedOreRecipe.class.getDeclaredField("height"));
        Field mirrored = accessible(ShapedOreRecipe.class.getDeclaredField("mirrored"));
        Map<List<?>, String> oreLists = oreLists(ctx);
        ItemTable items = ctx.items();
        Map<String, Integer> classes = new HashMap<>();
        Map<String, Integer> opaque = new HashMap<>();
        int total = 0;
        int noOutput = 0;

        List<?> recipes = CraftingManager.getInstance().getRecipeList();
        try (JsonlWriter w = ctx.jsonl("recipesCrafting")) {
            for (Object o : recipes) {
                String cls = o != null ? o.getClass().getName() : "null";
                try {
                    if (!(o instanceof IRecipe)) throw new IllegalArgumentException("not an IRecipe");
                    IRecipe r = (IRecipe) o;
                    increment(classes, cls);
                    ItemStack out = r.getRecipeOutput();
                    if (out == null || out.getItem() == null) {
                        noOutput++;
                        continue;
                    }
                    boolean isOpaque = false;
                    JsonWriter j = w.begin();
                    j.beginObject();
                    j.name("cls").value(cls);
                    if (r instanceof ShapedOreRecipe) {
                        j.name("shape").value("shaped");
                        j.name("w").value(width.getInt(r));
                        j.name("h").value(height.getInt(r));
                        j.name("mirrored").value(mirrored.getBoolean(r));
                        writeSlots(j, ((ShapedOreRecipe) r).getInput(), oreLists, items);
                    } else if (r instanceof ShapelessOreRecipe) {
                        j.name("shape").value("shapeless");
                        writeSlots(j, ((ShapelessOreRecipe) r).getInput(), oreLists, items);
                    } else if (r instanceof ShapedRecipes) {
                        ShapedRecipes s = (ShapedRecipes) r;
                        j.name("shape").value("shaped");
                        j.name("w").value(s.recipeWidth);
                        j.name("h").value(s.recipeHeight);
                        writeSlots(j, s.recipeItems, oreLists, items);
                    } else if (r instanceof ShapelessRecipes) {
                        j.name("shape").value("shapeless");
                        writeSlots(j, ((ShapelessRecipes) r).recipeItems, oreLists, items);
                    } else {
                        j.name("shape").value("opaque");
                        isOpaque = true;
                    }
                    j.name("out");
                    Stacks.stack(j, out, items);
                    j.endObject();
                    w.end();
                    if (isOpaque) increment(opaque, cls);
                } catch (Throwable t) {
                    ctx.warn("crafting recipe " + total + " (" + cls + "): " + t);
                } finally {
                    total++;
                }
            }
        }

        logHistogram(classes, total);
        if (noOutput > 0) ctx.warn("crafting: skipped " + noOutput + " recipes without an output");
        if (!opaque.isEmpty()) {
            ctx.warn("crafting: " + sum(opaque) + " opaque recipes, most common classes: " + top(opaque));
        }
    }

    /** Every non-empty ore-dictionary list by identity; unknown ore ids all share one empty list, which is left out. */
    private static Map<List<?>, String> oreLists(ExportContext ctx) {
        Map<List<?>, String> out = new IdentityHashMap<>();
        for (String name : OreDictionary.getOreNames()) {
            try {
                List<ItemStack> ores = OreDictionary.getOres(name);
                if (ores != null && !ores.isEmpty()) out.put(ores, name);
            } catch (Throwable t) {
                ctx.warn("crafting: ore list " + name + ": " + t);
            }
        }
        return out;
    }

    private static void writeSlots(JsonWriter j, Object[] inputs, Map<List<?>, String> oreLists, ItemTable items)
        throws IOException {
        writeSlots(j, inputs != null ? Arrays.asList(inputs) : null, oreLists, items);
    }

    /** {@code in}: one slot per input, in order. An input of any other type throws, which skips the recipe. */
    private static void writeSlots(JsonWriter j, List<?> inputs, Map<List<?>, String> oreLists, ItemTable items)
        throws IOException {
        j.name("in").beginArray();
        if (inputs != null) {
            for (Object in : inputs) {
                if (in == null) {
                    j.nullValue();
                } else if (in instanceof ItemStack) {
                    j.value(items.intern((ItemStack) in));
                } else if (in instanceof List) {
                    String ore = oreLists.get(in);
                    if (ore != null) {
                        j.beginObject().name("ore").value(ore).endObject();
                    } else {
                        j.beginArray();
                        for (Object option : (List<?>) in) {
                            if (option == null) continue;
                            if (!(option instanceof ItemStack)) throw unsupported(option);
                            j.value(items.intern((ItemStack) option));
                        }
                        j.endArray();
                    }
                } else {
                    throw unsupported(in);
                }
            }
        }
        j.endArray();
    }

    private static IllegalArgumentException unsupported(Object input) {
        return new IllegalArgumentException("unsupported input type " + input.getClass().getName());
    }

    /** Logs how many recipes of each class the crafting manager holds, most common first. */
    private static void logHistogram(Map<String, Integer> classes, int total) {
        List<Map.Entry<String, Integer>> sorted = byCount(classes);
        StringBuilder sb = new StringBuilder("[gtnhplannerexport] crafting recipes by class (")
            .append(total)
            .append(" entries, ")
            .append(sorted.size())
            .append(" classes):");
        for (Map.Entry<String, Integer> e : sorted) {
            sb.append("\n  ").append(e.getValue()).append("  ").append(e.getKey());
        }
        FMLLog.info("%s", sb);
    }

    /** The {@value #TOP_OPAQUE} most common classes as {@code name (count), …}. */
    private static String top(Map<String, Integer> counts) {
        List<Map.Entry<String, Integer>> sorted = byCount(counts);
        StringBuilder sb = new StringBuilder();
        for (int i = 0; i < Math.min(TOP_OPAQUE, sorted.size()); i++) {
            if (i > 0) sb.append(", ");
            sb.append(sorted.get(i).getKey()).append(" (").append(sorted.get(i).getValue()).append(')');
        }
        return sb.toString();
    }

    /** Entries by count, highest first, then by name. */
    private static List<Map.Entry<String, Integer>> byCount(Map<String, Integer> counts) {
        List<Map.Entry<String, Integer>> sorted = new ArrayList<>(counts.entrySet());
        Collections.sort(sorted, (a, b) -> {
            int c = Integer.compare(b.getValue(), a.getValue());
            return c != 0 ? c : a.getKey().compareTo(b.getKey());
        });
        return sorted;
    }

    private static int sum(Map<String, Integer> counts) {
        int n = 0;
        for (int c : counts.values()) n += c;
        return n;
    }

    private static void increment(Map<String, Integer> counts, String key) {
        Integer n = counts.get(key);
        counts.put(key, n == null ? 1 : n + 1);
    }

    private static Field accessible(Field f) {
        f.setAccessible(true);
        return f;
    }
}
