package io.github.drukoz.gtnhplanner.export;

import java.io.IOException;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraftforge.oredict.OreDictionary;

import com.google.gson.stream.JsonWriter;

import cpw.mods.fml.common.registry.GameData;
import gregtech.api.items.MetaGeneratedItem;
import gregtech.api.objects.ItemData;
import gregtech.api.util.GTOreDictUnificator;
import ic2.api.item.IElectricItem;

/**
 * Every item variant the export mentions. A variant's index is its line in {@code items.jsonl.gz}; sections refer to
 * items only by {@link #intern(ItemStack)}. Written by {@link Exporter} after every section has run.
 */
public final class ItemTable {

    private static final int WILDCARD = OreDictionary.WILDCARD_VALUE;

    private final ExportContext ctx;
    private final Map<String, Integer> byKey = new HashMap<>();
    private final List<Entry> entries = new ArrayList<>();

    ItemTable(ExportContext ctx) {
        this.ctx = ctx;
    }

    /**
     * The index of this variant (registry name, damage and NBT; the stack size is ignored), adding a 1-count copy on
     * first sight. Throws {@link IllegalArgumentException} for a stack without a registered item.
     */
    public int intern(ItemStack s) {
        String key = keyOf(s);
        Integer known = byKey.get(key);
        if (known != null) return known;
        ItemStack copy = s.copy();
        copy.stackSize = 1;
        int index = entries.size();
        entries.add(new Entry(copy, registryName(s), s.getItemDamage(), nbtOf(s)));
        byKey.put(key, index);
        return index;
    }

    /**
     * The variant's table key, {@code registryName@damage} plus {@code #SNBT} for a stack with NBT, without adding
     * it: the same for every export of one pack, unlike an index. Throws like {@link #intern(ItemStack)}.
     */
    public static String keyOf(ItemStack s) {
        if (s == null || s.getItem() == null) throw new IllegalArgumentException("empty item stack");
        String id = registryName(s);
        if (id == null) throw new IllegalArgumentException("item not in the item registry: " + s);
        String nbt = nbtOf(s);
        return id + "@" + s.getItemDamage() + (nbt != null ? "#" + nbt : "");
    }

    private static String nbtOf(ItemStack s) {
        return s.hasTagCompound() ? s.getTagCompound().toString() : null;
    }

    /**
     * Seeds the table with the variants a server can list (export-mod.md §4.4): meta 0 of every item without
     * subtypes, and every enabled, visible meta of each GT {@link MetaGeneratedItem}. {@code getSubItems} is
     * client-only and never called.
     */
    public void seed() {
        for (Item item : GameData.getItemRegistry().typeSafeIterable()) {
            try {
                if (!item.getHasSubtypes()) intern(new ItemStack(item, 1, 0));
            } catch (Throwable t) {
                ctx.warn("item seed " + describe(item) + ": " + t);
            }
            if (item instanceof MetaGeneratedItem) seedMetaItems((MetaGeneratedItem) item);
        }
    }

    private void seedMetaItems(MetaGeneratedItem g) {
        for (int i = 0; i < g.mEnabledItems.length(); i++) {
            try {
                if (g.mEnabledItems.get(i) && g.mVisibleItems.get(i)) intern(new ItemStack(g, 1, g.mOffset + i));
            } catch (Throwable t) {
                ctx.warn("item seed " + describe(g) + "@" + (g.mOffset + i) + ": " + t);
            }
        }
    }

    public int size() {
        return entries.size();
    }

    /**
     * Writes {@code items.jsonl.gz}, one line per index in order. Every index gets its line: when the full line
     * fails, a minimal one ({@code i}, {@code id}, {@code m}, {@code nbt}) is written instead. A wildcard line
     * (meta 32767) gets its {@code dn} too, but a missing name there is not counted in {@code nameFailures}: a
     * wildcard is never an item of its own, and the failure ratio is taken over concrete items.
     */
    public void write(ExportContext ctx) throws IOException {
        NameResolver names = ctx.names();
        try (JsonlWriter w = ctx.jsonl("items")) {
            for (int i = 0; i < entries.size(); i++) {
                Entry e = entries.get(i);
                try {
                    writeFull(w, i, e, names, ctx);
                } catch (Throwable t) {
                    ctx.warn("item " + e.id + "@" + e.meta + ": " + t);
                    JsonWriter j = w.begin();
                    j.beginObject();
                    writeKey(j, i, e);
                    j.endObject();
                    w.end();
                }
            }
        }
    }

    private static void writeFull(JsonlWriter w, int i, Entry e, NameResolver names, ExportContext ctx)
        throws IOException {
        ItemStack s = e.stack;
        Integer nid = null;
        try {
            nid = Item.getIdFromItem(s.getItem());
        } catch (Throwable t) {
            ctx.warn("item " + e.id + "@" + e.meta + " numeric id: " + t);
        }
        String un = null;
        try {
            un = s.getUnlocalizedName();
        } catch (Throwable t) {
            // written as null
        }
        boolean concrete = e.meta != WILDCARD;
        String dn = concrete ? names.itemName(s) : names.uncountedName(s);
        List<String> od = concrete ? oreNames(s, e, ctx) : null;
        ItemData gt = concrete ? association(s, e, ctx) : null;
        Electric electric = concrete ? electric(s, e, ctx) : null;

        JsonWriter j = w.begin();
        j.beginObject();
        writeKey(j, i, e);
        if (nid != null) j.name("nid").value(nid);
        j.name("un").value(un);
        j.name("dn").value(dn);
        if (od != null && !od.isEmpty()) {
            j.name("od").beginArray();
            for (String name : od) j.value(name);
            j.endArray();
        }
        if (gt != null) {
            // OrePrefixes is a class now; its deprecated name() just returns getName()
            if (gt.mPrefix != null) j.name("gtPrefix").value(gt.mPrefix.getName());
            if (gt.mMaterial != null && gt.mMaterial.mMaterial != null) {
                j.name("gtMat").value(gt.mMaterial.mMaterial.mName);
                j.name("gtAmt").value(gt.mMaterial.mAmount);
            }
        }
        if (electric != null) {
            j.name("electric").beginObject();
            j.name("maxCharge").value(electric.maxCharge);
            j.name("tier").value(electric.tier);
            j.name("canProvideEnergy").value(electric.canProvideEnergy);
            j.endObject();
        }
        j.endObject();
        w.end();
    }

    /** {@code i}, {@code id}, {@code m} and {@code nbt}: the fields that come from the table itself. */
    private static void writeKey(JsonWriter j, int i, Entry e) throws IOException {
        j.name("i").value(i);
        j.name("id").value(e.id);
        j.name("m").value(e.meta);
        if (e.nbt != null) j.name("nbt").value(e.nbt);
    }

    private static List<String> oreNames(ItemStack s, Entry e, ExportContext ctx) {
        try {
            int[] ids = OreDictionary.getOreIDs(s);
            List<String> out = new ArrayList<>(ids.length);
            for (int id : ids) out.add(OreDictionary.getOreName(id));
            return out;
        } catch (Throwable t) {
            ctx.warn("item " + e.id + "@" + e.meta + " ore names: " + t);
            return null;
        }
    }

    private static ItemData association(ItemStack s, Entry e, ExportContext ctx) {
        try {
            return GTOreDictUnificator.getAssociation(s);
        } catch (Throwable t) {
            ctx.warn("item " + e.id + "@" + e.meta + " GT association: " + t);
            return null;
        }
    }

    /**
     * IC2 battery data, only for an {@link IElectricItem} with a finite capacity above 0 (GT's meta items implement
     * the interface for every meta, with capacity 0 for all but the batteries). Each call is guarded on its own.
     */
    private static Electric electric(ItemStack s, Entry e, ExportContext ctx) {
        if (!(s.getItem() instanceof IElectricItem)) return null;
        IElectricItem item = (IElectricItem) s.getItem();
        double maxCharge;
        try {
            maxCharge = item.getMaxCharge(s);
        } catch (Throwable t) {
            ctx.warn("item " + e.id + "@" + e.meta + " getMaxCharge: " + t);
            return null;
        }
        if (!(maxCharge > 0) || Double.isInfinite(maxCharge)) return null;
        int tier;
        try {
            tier = item.getTier(s);
        } catch (Throwable t) {
            ctx.warn("item " + e.id + "@" + e.meta + " getTier: " + t);
            return null;
        }
        boolean canProvideEnergy;
        try {
            canProvideEnergy = item.canProvideEnergy(s);
        } catch (Throwable t) {
            ctx.warn("item " + e.id + "@" + e.meta + " canProvideEnergy: " + t);
            return null;
        }
        return new Electric(maxCharge, tier, canProvideEnergy);
    }

    /** The registry name ({@code modid:name}) of the stack's item, or {@code null} when it is not registered. */
    static String registryName(ItemStack s) {
        return GameData.getItemRegistry().getNameForObject(s.getItem());
    }

    private static String describe(Item item) {
        try {
            String name = GameData.getItemRegistry().getNameForObject(item);
            return name != null ? name : String.valueOf(item);
        } catch (Throwable t) {
            return String.valueOf(item);
        }
    }

    private static final class Entry {

        final ItemStack stack;
        final String id;
        final int meta;
        final String nbt;

        Entry(ItemStack stack, String id, int meta, String nbt) {
            this.stack = stack;
            this.id = id;
            this.meta = meta;
            this.nbt = nbt;
        }
    }

    private static final class Electric {

        final double maxCharge;
        final int tier;
        final boolean canProvideEnergy;

        Electric(double maxCharge, int tier, boolean canProvideEnergy) {
            this.maxCharge = maxCharge;
            this.tier = tier;
            this.canProvideEnergy = canProvideEnergy;
        }
    }
}
