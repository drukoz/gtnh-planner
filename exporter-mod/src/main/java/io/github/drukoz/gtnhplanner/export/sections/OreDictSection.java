package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.util.ArrayList;
import java.util.List;

import net.minecraft.item.ItemStack;
import net.minecraftforge.oredict.OreDictionary;

import com.google.gson.stream.JsonWriter;

import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;

/**
 * {@code oreDict}: one line per ore-dictionary name with at least one item, {@code {ore, items: [index…]}}. Wildcard
 * stacks keep meta 32767; the loader expands them.
 */
public final class OreDictSection implements ExportSection {

    @Override
    public String name() {
        return "oreDict";
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        ItemTable items = ctx.items();
        try (JsonlWriter w = ctx.jsonl("oreDict")) {
            for (String ore : OreDictionary.getOreNames()) {
                try {
                    List<ItemStack> stacks = OreDictionary.getOres(ore);
                    if (stacks == null || stacks.isEmpty()) continue;
                    List<Integer> indices = new ArrayList<>(stacks.size());
                    for (ItemStack s : stacks) {
                        try {
                            if (s != null) indices.add(items.intern(s));
                        } catch (Throwable t) {
                            ctx.warn("ore " + ore + ": item " + t);
                        }
                    }
                    if (indices.isEmpty()) {
                        ctx.warn("ore " + ore + ": no usable item");
                        continue;
                    }
                    JsonWriter j = w.begin();
                    j.beginObject();
                    j.name("ore").value(ore);
                    j.name("items").beginArray();
                    for (int index : indices) j.value(index);
                    j.endArray();
                    j.endObject();
                    w.end();
                } catch (Throwable t) {
                    ctx.warn("ore " + ore + ": " + t);
                }
            }
        }
    }
}
