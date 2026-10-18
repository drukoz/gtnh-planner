package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collection;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;

import net.minecraft.init.Items;
import net.minecraft.item.ItemStack;

import com.google.gson.stream.JsonWriter;

import cpw.mods.fml.common.ModContainer;
import gregtech.api.recipe.BasicUIProperties;
import gregtech.api.recipe.RecipeCategory;
import gregtech.api.recipe.RecipeMap;
import gregtech.api.recipe.RecipeMapBackend;
import gregtech.api.recipe.RecipeMaps;
import gregtech.api.recipe.RecipeMetadataKey;
import gregtech.api.recipe.metadata.IRecipeMetadataStorage;
import gregtech.api.util.GTModHandler;
import gregtech.api.util.GTRecipe;
import gregtech.nei.formatter.INEISpecialInfoFormatter;
import gregtech.nei.formatter.SimpleSpecialValueFormatter;
import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;

/**
 * {@code recipeMaps}: one line per GT recipe map, {@code i} = its position in {@link RecipeMap#ALL_RECIPE_MAPS};
 * {@code recipesGt}: every recipe of every map, {@code map} = that position. Fake and disabled recipes are written with
 * their flags (the loader decides what to keep). A map whose own line fails is skipped together with its recipes, so
 * every {@code map} index in {@code recipesGt} exists in {@code recipeMaps}.
 */
public final class RecipeMapsSection implements ExportSection {

    @Override
    public String name() {
        return "recipeMaps";
    }

    @Override
    public void export(ExportContext ctx) throws Exception {
        // GT's own private fields (not obfuscated, checked with javap); a missing one fails the export loudly
        Field identifier = accessible(RecipeMetadataKey.class.getDeclaredField("identifier"));
        Field translationKey = accessible(SimpleSpecialValueFormatter.class.getDeclaredField("translationKey"));
        Map<RecipeMap<?>, Integer> catalysts = hardCodedCatalysts(ctx);
        ItemTable items = ctx.items();

        try (JsonlWriter maps = ctx.jsonl("recipeMaps"); JsonlWriter recipes = ctx.jsonl("recipesGt")) {
            int index = -1;
            for (RecipeMap<?> map : RecipeMap.ALL_RECIPE_MAPS.values()) {
                index++;
                Collection<GTRecipe> all;
                try {
                    all = map.getAllRecipes();
                    writeMap(maps, index, map, all, catalysts.get(map), translationKey, ctx);
                } catch (Throwable t) {
                    ctx.warn("recipe map " + map.unlocalizedName + ": " + t);
                    continue;
                }
                int position = 0;
                try {
                    for (GTRecipe r : all) {
                        try {
                            writeRecipe(recipes, index, map, r, identifier, items);
                        } catch (Throwable t) {
                            ctx.warn("recipe " + position + " of " + map.unlocalizedName + ": " + t);
                        }
                        position++;
                    }
                } catch (Throwable t) {
                    ctx.warn("recipes of " + map.unlocalizedName + " after " + position + ": " + t);
                }
            }
        }
    }

    /**
     * Item indices of the catalysts GT's NEI plugin hard-codes in {@code NEIGTConfig.registerCatalysts} for maps that
     * no machine reports. The cutter ones are machines and come with the machines section.
     */
    private static Map<RecipeMap<?>, Integer> hardCodedCatalysts(ExportContext ctx) {
        Map<RecipeMap<?>, Integer> out = new IdentityHashMap<>();
        try {
            ItemStack reactor = GTModHandler.getIC2Item("nuclearReactor", 1L);
            if (reactor != null) out.put(RecipeMaps.ic2NuclearFakeRecipes, ctx.items().intern(reactor));
            else ctx.warn("catalyst: IC2 item nuclearReactor not found");
        } catch (Throwable t) {
            ctx.warn("catalyst IC2 nuclearReactor: " + t);
        }
        try {
            out.put(RecipeMaps.cauldronRecipe, ctx.items().intern(new ItemStack(Items.cauldron)));
        } catch (Throwable t) {
            ctx.warn("catalyst cauldron: " + t);
        }
        return out;
    }

    private static void writeMap(JsonlWriter out, int index, RecipeMap<?> map, Collection<GTRecipe> all,
        Integer catalyst, Field translationKey, ExportContext ctx) throws IOException, IllegalAccessException {
        BasicUIProperties ui = map.getFrontend().getUIProperties();
        INEISpecialInfoFormatter formatter = map.getFrontend().getNEIProperties().neiSpecialInfoFormatter;
        String svKey = null;
        if (formatter instanceof SimpleSpecialValueFormatter) {
            Object key = translationKey.get(formatter);
            if (key != null) svKey = String.valueOf(key);
        }
        List<String> cats = new ArrayList<>();
        for (RecipeCategory c : map.getAssociatedCategories()) {
            if (c != null) cats.add(c.unlocalizedName);
        }
        String dynamic = dynamicKind(map, ctx);

        JsonWriter j = out.begin();
        j.beginObject();
        j.name("i").value(index);
        j.name("id").value(map.unlocalizedName);
        j.name("dn").value(ctx.names().translate(map.unlocalizedName));
        j.name("amps").value(map.getAmperage());
        j.name("maxIn").value(ui.maxItemInputs);
        j.name("maxOut").value(ui.maxItemOutputs);
        j.name("maxFIn").value(ui.maxFluidInputs);
        j.name("maxFOut").value(ui.maxFluidOutputs);
        if (formatter != null) j.name("svFormatter").value(formatter.getClass().getName());
        if (svKey != null) j.name("svKey").value(svKey);
        if (dynamic != null) j.name("dynamic").value(dynamic);
        if (!cats.isEmpty()) {
            j.name("cats").beginArray();
            for (String c : cats) j.value(c);
            j.endArray();
        }
        if (catalyst != null) j.name("catalysts").beginArray().value(catalyst).endArray();
        j.name("recipes").value(all.size());
        j.endObject();
        out.end();
    }

    /**
     * {@code overwrite} when the backend replaces the lookup; else {@code fallback} when a backend class below
     * {@link RecipeMapBackend} declares {@code findFallback}, else {@code modify} when one declares
     * {@code modifyFoundRecipe}; else {@code null}. GT's own method names are not obfuscated.
     */
    private static String dynamicKind(RecipeMap<?> map, ExportContext ctx) {
        RecipeMapBackend backend = map.getBackend();
        if (backend.doesOverwriteFindRecipe()) return "overwrite";
        boolean fallback = false;
        boolean modify = false;
        try {
            for (Class<?> c = backend.getClass(); c != null && c != RecipeMapBackend.class; c = c.getSuperclass()) {
                for (Method m : c.getDeclaredMethods()) {
                    if ("findFallback".equals(m.getName())) fallback = true;
                    else if ("modifyFoundRecipe".equals(m.getName())) modify = true;
                }
            }
        } catch (Throwable t) {
            // getDeclaredMethods resolves every signature type; a class missing on the server ends up here
            ctx.warn("recipe map " + map.unlocalizedName + " dynamic: " + t);
            return null;
        }
        return fallback ? "fallback" : modify ? "modify" : null;
    }

    private static void writeRecipe(JsonlWriter out, int mapIndex, RecipeMap<?> map, GTRecipe r, Field identifier,
        ItemTable items) throws IOException, IllegalAccessException {
        JsonWriter j = out.begin();
        j.beginObject();
        j.name("map").value(mapIndex);
        j.name("in");
        Stacks.items(j, r.mInputs, r.mInputChances, items);
        j.name("out");
        Stacks.items(j, r.mOutputs, r.mOutputChances, items);
        j.name("fin");
        Stacks.fluids(j, r.mFluidInputs, r.mFluidInputChances);
        j.name("fout");
        Stacks.fluids(j, r.mFluidOutputs, r.mFluidOutputChances);
        j.name("eut").value(r.mEUt);
        j.name("dur").value(r.mDuration);
        if (r.mSpecialValue != 0) j.name("sv").value(r.mSpecialValue);
        if (r instanceof GTRecipe.GTRecipe_WithAlt) {
            Stacks.itemAlternatives(j, "inAlt", ((GTRecipe.GTRecipe_WithAlt) r).mOreDictAlt, items);
        }
        Stacks.fluidAlternatives(j, "finAlt", r.mAltFluidInputs);
        flag(j, "disabled", !r.mEnabled);
        flag(j, "hidden", r.mHidden);
        flag(j, "fake", r.mFakeRecipe);
        flag(j, "needsEmptyOut", r.mNeedsEmptyOutput);
        flag(j, "nbtSensitive", r.isNBTSensitive);
        if (r.mSpecialItems instanceof ItemStack) j.name("special").value(items.intern((ItemStack) r.mSpecialItems));
        RecipeCategory category = r.getRecipeCategory();
        if (category != null && !map.unlocalizedName.equals(category.unlocalizedName)) {
            j.name("cat").value(category.unlocalizedName);
        }
        writeMeta(j, r, identifier, items);
        writeOwners(j, r.owners);
        j.endObject();
        out.end();
    }

    /**
     * Every metadata entry by its identifier: {@code Boolean} and finite {@code Number} values as they are,
     * {@code ItemStack} as {@code {"item": index}}, anything else as {@code String.valueOf}. Null values are left out:
     * the wire format has no null meta value.
     */
    private static void writeMeta(JsonWriter j, GTRecipe r, Field identifier, ItemTable items)
        throws IOException, IllegalAccessException {
        IRecipeMetadataStorage storage = r.getMetadataStorage();
        if (storage == null) return;
        boolean open = false;
        for (Map.Entry<RecipeMetadataKey<?>, Object> e : storage.getEntries()) {
            Object value = e.getValue();
            if (e.getKey() == null || value == null) continue;
            if (!open) {
                j.name("meta").beginObject();
                open = true;
            }
            j.name(String.valueOf(identifier.get(e.getKey())));
            if (value instanceof Boolean) {
                j.value(((Boolean) value).booleanValue());
            } else if (value instanceof Number && isFinite((Number) value)) {
                j.value((Number) value);
            } else if (value instanceof ItemStack) {
                j.beginObject().name("item").value(items.intern((ItemStack) value)).endObject();
            } else {
                j.value(String.valueOf(value));
            }
        }
        if (open) j.endObject();
    }

    private static void writeOwners(JsonWriter j, List<ModContainer> owners) throws IOException {
        if (owners == null || owners.isEmpty()) return;
        List<String> ids = new ArrayList<>(owners.size());
        for (ModContainer mod : owners) {
            if (mod != null) ids.add(mod.getModId());
        }
        if (ids.isEmpty()) return;
        j.name("owners").beginArray();
        for (String id : ids) j.value(id);
        j.endArray();
    }

    private static void flag(JsonWriter j, String name, boolean set) throws IOException {
        if (set) j.name(name).value(true);
    }

    private static boolean isFinite(Number n) {
        double d = n.doubleValue();
        return !Double.isNaN(d) && !Double.isInfinite(d);
    }

    private static Field accessible(Field f) {
        f.setAccessible(true);
        return f;
    }
}
