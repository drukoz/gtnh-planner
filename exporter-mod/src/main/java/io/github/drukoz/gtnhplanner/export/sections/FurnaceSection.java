package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.util.Map;

import net.minecraft.item.ItemStack;
import net.minecraft.item.crafting.FurnaceRecipes;
import net.minecraftforge.oredict.OreDictionary;

import com.google.gson.stream.JsonWriter;

import gregtech.api.enums.GTValues;
import gregtech.api.recipe.RecipeMap;
import gregtech.api.recipe.RecipeMaps;
import gregtech.api.util.GTRecipe;
import gregtech.api.util.GTRecipeConstants;
import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;

/**
 * {@code recipesFurnace}: every vanilla smelting entry, {@code {in, out, xp, ef?, mw?}}. {@code ef} / {@code mw} are
 * the first output GT's own electric furnace / microwave lookup returns for that input at LV; {@code mw} is left out
 * where GT's microwave explodes (metal or explosive material) or catches fire (flammable material), which it marks
 * with {@code EXPLODE} / {@code ON_FIRE} on an output-less recipe. Runs after GT's server-start smelting rewrite,
 * because the export starts ticks after the server has started.
 */
public final class FurnaceSection implements ExportSection {

    @Override
    public String name() {
        return "recipesFurnace";
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        ItemTable items = ctx.items();
        FurnaceRecipes furnace = FurnaceRecipes.smelting();
        Map<?, ?> smelting = furnace.getSmeltingList();
        long voltage = GTValues.V[1];
        try (JsonlWriter w = ctx.jsonl("recipesFurnace")) {
            int position = 0;
            for (Map.Entry<?, ?> e : smelting.entrySet()) {
                try {
                    if (!(e.getKey() instanceof ItemStack) || !(e.getValue() instanceof ItemStack)) {
                        throw new IllegalArgumentException("not an item stack pair");
                    }
                    ItemStack in = (ItemStack) e.getKey();
                    ItemStack out = (ItemStack) e.getValue();
                    int inIndex = items.intern(in);
                    float xp = furnace.func_151398_b(out);
                    int[] ef = probe(RecipeMaps.furnaceRecipes, in, inIndex, voltage, items, ctx);
                    int[] mw = probe(RecipeMaps.microwaveRecipes, in, inIndex, voltage, items, ctx);

                    JsonWriter j = w.begin();
                    j.beginObject();
                    j.name("in").value(inIndex);
                    j.name("out");
                    Stacks.stack(j, out, items);
                    // Float.toString keeps the value as written (0.7, not 0.699999988079071)
                    j.name("xp").value(Double.parseDouble(Float.toString(xp)));
                    if (ef != null) j.name("ef").beginArray().value(ef[0]).value(ef[1]).endArray();
                    if (mw != null) j.name("mw").beginArray().value(mw[0]).value(mw[1]).endArray();
                    j.endObject();
                    w.end();
                } catch (Throwable t) {
                    ctx.warn("smelting entry " + position + ": " + t);
                } finally {
                    position++;
                }
            }
        }
    }

    /**
     * {@code [index, stackSize]} of the first output GT's lookup in {@code map} returns for one of {@code input}
     * (damage 0 for a wildcard), or {@code null} when it finds nothing, the recipe has no output, or it explodes or
     * burns. A failing lookup is a warning and {@code null}, never a lost smelting entry.
     */
    private static int[] probe(RecipeMap<?> map, ItemStack input, int inIndex, long voltage, ItemTable items,
        ExportContext ctx) {
        try {
            ItemStack one = input.copy();
            one.stackSize = 1;
            if (one.getItemDamage() == OreDictionary.WILDCARD_VALUE) one.setItemDamage(0);
            GTRecipe r = map.findRecipeQuery().items(one).voltage(voltage).find();
            if (r == null || r.mOutputs == null || r.mOutputs.length == 0 || r.mOutputs[0] == null) return null;
            if (Boolean.TRUE.equals(r.getMetadataOrDefault(GTRecipeConstants.EXPLODE, false))
                || Boolean.TRUE.equals(r.getMetadataOrDefault(GTRecipeConstants.ON_FIRE, false))) {
                return null;
            }
            ItemStack out = r.mOutputs[0];
            return new int[] { items.intern(out), out.stackSize };
        } catch (Throwable t) {
            ctx.warn(map.unlocalizedName + " lookup for item " + inIndex + ": " + t);
            return null;
        }
    }
}
