package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

import net.minecraft.item.ItemStack;

import com.google.gson.stream.JsonWriter;

import bartworks.system.material.Werkstoff;
import gregtech.api.enums.Materials;
import gregtech.api.enums.OrePrefixes;
import gregtech.api.interfaces.IOreMaterial;
import gregtech.api.interfaces.ISubTagContainer;
import gregtech.common.WorldgenGTOreLayer;
import gregtech.common.WorldgenGTOreSmallPieces;
import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;

/**
 * {@code materials}: one line per distinct GT {@link Materials#mName}; {@code oreMaterials}: one line per GT,
 * BartWorks or GT++ material that an enabled ore vein or small ore places (materials-availability.md §1.1, §3).
 * Ore materials are named by {@link #key(IOreMaterial)}, the key every worldgen file uses.
 */
public final class MaterialsSection implements ExportSection {

    @Override
    public String name() {
        return "materials";
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        writeMaterials(ctx);
        writeOreMaterials(ctx);
    }

    /** {@code gt}, {@code bw} or {@code gtpp} + {@code ":"} + {@link IOreMaterial#getInternalName()}. */
    static String key(IOreMaterial m) {
        return family(m) + ":" + m.getInternalName();
    }

    /** {@code gt} for GT {@link Materials}, {@code bw} for a BartWorks {@link Werkstoff}, else {@code gtpp}. */
    static String family(IOreMaterial m) {
        if (m instanceof Materials) return "gt";
        if (m instanceof Werkstoff) return "bw";
        return "gtpp";
    }

    private static void writeMaterials(ExportContext ctx) throws IOException {
        Set<String> written = new HashSet<>();
        try (JsonlWriter w = ctx.jsonl("materials")) {
            for (Materials m : Materials.getAll()) {
                if (m == null) continue;
                String name = m.mName;
                try {
                    if (name == null) throw new IllegalStateException("material without mName");
                    if (written.contains(name)) continue;
                    writeMaterial(w, m);
                    written.add(name);
                } catch (Throwable t) {
                    ctx.warn("material " + name + ": " + t);
                }
            }
        }
    }

    private static void writeMaterial(JsonlWriter w, Materials m) throws IOException {
        String dn;
        try {
            dn = m.getLocalizedName();
        } catch (Throwable t) {
            dn = m.mDefaultLocalName;
        }
        JsonWriter j = w.begin();
        j.beginObject();
        j.name("name").value(m.mName);
        j.name("dn").value(dn);
        j.name("rgba").beginArray();
        for (int i = 0; i < 4; i++) j.value(m.mRGBa[i]);
        j.endArray();
        j.name("iconSet").value(m.mIconSet.mSetName);
        j.name("byproducts").beginArray();
        if (m.mOreByProducts != null) {
            for (Materials b : m.mOreByProducts) {
                if (b != null) j.value(b.mName);
            }
        }
        j.endArray();
        j.name("oreMultiplier").value(m.mOreMultiplier);
        j.name("byproductMultiplier").value(m.mByProductMultiplier);
        j.endObject();
        w.end();
    }

    private static void writeOreMaterials(ExportContext ctx) throws IOException {
        Map<String, OrePrefixes> parts = new LinkedHashMap<>();
        parts.put("ore", OrePrefixes.ore);
        parts.put("rawOre", OrePrefixes.rawOre);
        parts.put("crushed", OrePrefixes.crushed);
        parts.put("dust", OrePrefixes.dust);
        parts.put("ingot", OrePrefixes.ingot);
        parts.put("gem", OrePrefixes.gem);
        try (JsonlWriter w = ctx.jsonl("oreMaterials")) {
            for (Map.Entry<String, IOreMaterial> e : oreMaterials(ctx).entrySet()) {
                try {
                    writeOreMaterial(w, e.getKey(), e.getValue(), parts, ctx);
                } catch (Throwable t) {
                    ctx.warn("ore material " + e.getKey() + ": " + t);
                }
            }
        }
    }

    /**
     * Every distinct material of {@link WorldgenGTOreLayer#sList} ({@code mPrimary}, {@code mSecondary},
     * {@code mBetween}, {@code mSporadic}) and {@link WorldgenGTOreSmallPieces#sList}, by key, in first-use order.
     * Both lists hold only enabled entries.
     */
    private static Map<String, IOreMaterial> oreMaterials(ExportContext ctx) {
        Map<String, IOreMaterial> byKey = new LinkedHashMap<>();
        for (WorldgenGTOreLayer vein : WorldgenGTOreLayer.sList) {
            if (vein == null) continue;
            try {
                add(byKey, vein.mPrimary);
                add(byKey, vein.mSecondary);
                add(byKey, vein.mBetween);
                add(byKey, vein.mSporadic);
            } catch (Throwable t) {
                ctx.warn("ore materials of vein " + vein.mWorldGenName + ": " + t);
            }
        }
        for (WorldgenGTOreSmallPieces small : WorldgenGTOreSmallPieces.sList) {
            if (small == null) continue;
            try {
                add(byKey, small.getMaterial());
            } catch (Throwable t) {
                ctx.warn("ore material of small ore " + small.mWorldGenName + ": " + t);
            }
        }
        return byKey;
    }

    private static void add(Map<String, IOreMaterial> byKey, IOreMaterial m) {
        if (m == null) return;
        String key = key(m);
        if (!byKey.containsKey(key)) byKey.put(key, m);
    }

    private static void writeOreMaterial(JsonlWriter w, String key, IOreMaterial m, Map<String, OrePrefixes> parts,
        ExportContext ctx) throws IOException {
        String family = family(m);
        String name = m.getInternalName();
        // optional display fields: a failing getter leaves the field out instead of losing the material
        Integer id = orNull(m::getId);
        String dn = orNull(() -> localizedName(m));
        short[] rgba = orNull(m::getRGBA);
        String iconSet = orNull(() -> m.getTextureSet().mSetName);
        List<String> byproducts = byproducts(m, family, key, ctx);
        Map<String, Integer> partItems = parts(m, key, parts, ctx);

        JsonWriter j = w.begin();
        j.beginObject();
        j.name("key").value(key);
        j.name("family").value(family);
        j.name("name").value(name);
        if (id != null) j.name("id").value(id);
        if (dn != null) j.name("dn").value(dn);
        if (rgba != null && rgba.length >= 4) {
            j.name("rgba").beginArray();
            for (int i = 0; i < 4; i++) j.value(rgba[i]);
            j.endArray();
        }
        if (iconSet != null) j.name("iconSet").value(iconSet);
        j.name("byproducts").beginArray();
        for (String b : byproducts) j.value(b);
        j.endArray();
        j.name("parts").beginObject();
        for (Map.Entry<String, Integer> e : partItems.entrySet()) j.name(e.getKey()).value(e.getValue());
        j.endObject();
        j.endObject();
        w.end();
    }

    /** {@link IOreMaterial#getLocalizedName()}, or the default English name when that throws. */
    private static String localizedName(IOreMaterial m) {
        try {
            return m.getLocalizedName();
        } catch (Throwable t) {
            return m.getDefaultLocalName();
        }
    }

    /**
     * Byproduct keys: GT's {@code mOreByProducts}; BartWorks' {@code getOreByProductRaw(i)} for every
     * {@code i < getNoOfByProducts()} that is an {@link IOreMaterial}; none for GT++, which derives byproducts from
     * the composition (materials-availability.md §3). A failure is warned and leaves the list empty.
     */
    private static List<String> byproducts(IOreMaterial m, String family, String key, ExportContext ctx) {
        List<String> out = new ArrayList<>();
        try {
            if (m instanceof Materials) {
                List<Materials> list = ((Materials) m).mOreByProducts;
                if (list != null) {
                    for (Materials b : list) {
                        if (b != null) out.add(key(b));
                    }
                }
            } else if (m instanceof Werkstoff) {
                Werkstoff werkstoff = (Werkstoff) m;
                for (int i = 0; i < werkstoff.getNoOfByProducts(); i++) {
                    ISubTagContainer b = werkstoff.getOreByProductRaw(i);
                    if (b instanceof IOreMaterial) out.add(key((IOreMaterial) b));
                }
            }
        } catch (Throwable t) {
            ctx.warn("ore material " + key + " (" + family + ") byproducts: " + t);
            return Collections.emptyList();
        }
        return out;
    }

    /**
     * {@code getPart(prefix, 1)} interned for each part name, each lookup on its own; parts without an item are left
     * out, and the lookups that throw are reported in one warning per material.
     */
    private static Map<String, Integer> parts(IOreMaterial m, String key, Map<String, OrePrefixes> parts,
        ExportContext ctx) {
        ItemTable items = ctx.items();
        Map<String, Integer> out = new LinkedHashMap<>();
        StringBuilder failed = null;
        for (Map.Entry<String, OrePrefixes> e : parts.entrySet()) {
            try {
                ItemStack s = m.getPart(e.getValue(), 1);
                if (s != null) out.put(e.getKey(), items.intern(s));
            } catch (Throwable t) {
                failed = failed == null ? new StringBuilder() : failed.append("; ");
                failed.append(e.getKey()).append(": ").append(t);
            }
        }
        if (failed != null) ctx.warn("ore material " + key + " parts: " + failed);
        return out;
    }

    /** {@code get.get()}, or {@code null} when it throws. */
    private static <T> T orNull(Supplier<T> get) {
        try {
            return get.get();
        } catch (Throwable t) {
            return null;
        }
    }
}
