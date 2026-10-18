package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;

import com.google.gson.stream.JsonWriter;

import gregtech.api.util.GTRecipe;
import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;

/**
 * {@code recipesAssemblyLine}: every data-stick recipe of {@link GTRecipe.RecipeAssemblyLine#sAssemblylineRecipes},
 * {@code {research, researchTime, researchVoltage, in, inAlt, fin, out, eut, dur}}. The map
 * {@code gt.recipe.fakeAssemblylineProcess} is only GT's NEI view of the same recipes.
 */
public final class AssemblyLineSection implements ExportSection {

    @Override
    public String name() {
        return "recipesAssemblyLine";
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        ItemTable items = ctx.items();
        try (JsonlWriter w = ctx.jsonl("recipesAssemblyLine")) {
            int position = 0;
            for (GTRecipe.RecipeAssemblyLine r : GTRecipe.RecipeAssemblyLine.sAssemblylineRecipes) {
                try {
                    if (r == null) continue;
                    if (r.mOutput == null) throw new IllegalArgumentException("no output");
                    JsonWriter j = w.begin();
                    j.beginObject();
                    j.name("research");
                    if (r.mResearchItem != null) j.value(items.intern(r.mResearchItem));
                    else j.nullValue();
                    j.name("researchTime").value(r.mResearchTime);
                    j.name("researchVoltage").value(r.mResearchVoltage);
                    j.name("in");
                    Stacks.items(j, r.mInputs, null, items);
                    Stacks.itemAlternatives(j, "inAlt", r.mOreDictAlt, items);
                    j.name("fin");
                    Stacks.fluids(j, r.mFluidInputs, null);
                    j.name("out");
                    Stacks.stack(j, r.mOutput, items);
                    j.name("eut").value(r.mEUt);
                    j.name("dur").value(r.mDuration);
                    j.endObject();
                    w.end();
                } catch (Throwable t) {
                    ctx.warn("assembly line recipe " + position + ": " + t);
                } finally {
                    position++;
                }
            }
        }
    }
}
