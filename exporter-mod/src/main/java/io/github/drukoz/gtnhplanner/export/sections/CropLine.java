package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.io.StringWriter;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;
import java.util.function.IntUnaryOperator;

import net.minecraftforge.oredict.OreDictionary;

import com.google.gson.stream.JsonWriter;

/**
 * One line of {@code crops.jsonl.gz} ({@code CropLine} in format.ts): a crop card's values as numbers, strings and the
 * items it names ({@link ItemRef}), which {@link CropsSection} reads from CropsNH. Free of Minecraft and CropsNH classes
 * (the wildcard is a compile-time constant), so JUnit can test it. Lines are written through a {@link JsonWriter},
 * because Minecraft's Gson 2.2.4 cannot put ready JSON text into another writer's value.
 */
final class CropLine {

    /** What {@link #soilMeta} is given for a stack whose item places no block. */
    static final int NOT_A_BLOCK = -1;

    /** The likeliest drop first, then by item key, then the larger stack first. */
    private static final Comparator<Drop> DROP_ORDER = (a, b) -> {
        if (a.chance != b.chance) return Integer.compare(b.chance, a.chance);
        int byKey = a.item.key.compareTo(b.item.key);
        return byKey != 0 ? byKey : Integer.compare(b.count, a.count);
    };

    private CropLine() {}

    /**
     * An item a line names (format.ts {@code CropItemRef}): by its index in {@code items.jsonl.gz} when the item table
     * has it, else inline as {@code {key, name, nbt?}}, so the crop table never adds an item to the table.
     */
    static final class ItemRef {

        /** The {@link #index} of an inline item. */
        static final int INLINE = -1;

        /**
         * The item's table key ({@code ItemTable.keyOf}: {@code registry@damage}, plus {@code #SNBT} with NBT), the same
         * in every export of one pack, unlike the index: it orders drops and soils and names a soil once.
         */
        final String key;
        /** Its index in {@code items.jsonl.gz}, or {@link #INLINE}. */
        final int index;
        /** Inline only: {@code registry@damage}, the key without NBT; its NBT as SNBT or {@code null}; its name. */
        final String plainKey;
        final String nbt;
        final String name;

        private ItemRef(String key, int index, String plainKey, String nbt, String name) {
            this.key = key;
            this.index = index;
            this.plainKey = plainKey;
            this.nbt = nbt;
            this.name = name;
        }

        /** The item of the item table at {@code index}, whose table key is {@code key}. */
        static ItemRef indexed(String key, int index) {
            if (index < 0) throw new IllegalArgumentException("item index " + index + " of " + key);
            return new ItemRef(key, index, null, null, null);
        }

        /**
         * An item the item table lacks: {@code plainKey} = {@code registry@damage}, {@code nbt} its SNBT or {@code null},
         * {@code name} its English name.
         */
        static ItemRef inline(String plainKey, String nbt, String name) {
            return new ItemRef(nbt != null ? plainKey + "#" + nbt : plainKey, INLINE, plainKey, nbt, name);
        }

        boolean isInline() {
            return index == INLINE;
        }

        /** The index as a number, an inline item as {@code {"key", "name", "nbt"}} ({@code nbt} only with NBT). */
        void write(JsonWriter w) throws IOException {
            if (!isInline()) {
                w.value(index);
                return;
            }
            w.beginObject();
            w.name("key").value(plainKey);
            w.name("name").value(name);
            if (nbt != null) w.name("nbt").value(nbt);
            w.endObject();
        }
    }

    /**
     * One entry of a card's drop table: its item, the stack size and the chance out of 10000, CropsNH's own value (not
     * clamped: Water Lily's are 80000 and 20000).
     */
    static final class Drop {

        final ItemRef item;
        final int count;
        final int chance;

        Drop(ItemRef item, int count, int chance) {
            this.item = item;
            this.count = count;
            this.chance = chance;
        }
    }

    /**
     * Whether a card with this id and drop chance makes a line the loader can use: it needs an id and a drop chance
     * that is a finite number ({@link #write} writes any other as {@code null}).
     */
    static boolean valid(String id, double dropChance) {
        return id != null && !id.isEmpty() && Double.isFinite(dropChance);
    }

    /**
     * The name of a crop's seed: CropsNH's own format ({@code cropsnh_genericSeeds.format=%1$s Seeds}), which the game
     * shows once a seed is analyzed. A seed without stats, as {@code getSeedItem(null)} makes it, is "Unknown Seeds".
     */
    static String seedName(String cropName) {
        return cropName + " Seeds";
    }

    /**
     * The damage a soil the item table lacks is written with. CropsNH writes the wildcard for a block it registered
     * without a meta, so any variant counts: variant 0. Else {@code dropped}, the variant the soil's block drops
     * ({@code Block.damageDropped}, which pick block uses too): a log lying along x or z is its log. A stack whose item
     * places no block ({@link #NOT_A_BLOCK}, or any negative {@code dropped}) keeps its own.
     */
    static int soilMeta(int meta, int dropped) {
        if (meta == OreDictionary.WILDCARD_VALUE) return 0;
        return dropped < 0 ? meta : dropped;
    }

    /**
     * What a soil's block drops for {@code meta} ({@code damageDropped}: {@code Block.damageDropped} of that block), or
     * {@link #NOT_A_BLOCK} when the block's method throws anything (a mod's array lookup by meta, a class the dedicated
     * server lacks), so that {@link #soilMeta} keeps the soil's own.
     */
    static int droppedMeta(IntUnaryOperator damageDropped, int meta) {
        try {
            return damageDropped.applyAsInt(meta);
        } catch (Throwable t) {
            return NOT_A_BLOCK;
        }
    }

    /**
     * The soils of a line: by item key, each once (two variants of one block can be written as the same item). The
     * soils come from a hash map of blocks in a different order on every run; sorted, two exports of one pack agree.
     */
    static List<ItemRef> soils(List<ItemRef> soils) {
        Map<String, ItemRef> byKey = new TreeMap<>();
        for (ItemRef soil : soils) byKey.putIfAbsent(soil.key, soil);
        return new ArrayList<>(byKey.values());
    }

    /**
     * Sorts {@code drops} into the order of a line: the likeliest first, then by item key, then the larger stack first.
     * CropsNH keeps a card's drop table in a {@code HashMap} keyed by {@code ItemStack}, which has no hash of its own,
     * so the table comes in a different order on every run; sorted, two exports of one pack agree.
     */
    static void sortDrops(List<Drop> drops) {
        drops.sort(DROP_ORDER);
    }

    /** What {@link #write} writes for these values, as JSON text. */
    static String json(String id, String name, int tier, int duration, double dropChance, List<Drop> drops,
        List<String> liked, List<ItemRef> soils, List<String> requirements, ItemRef seed, int minSeedBedTier)
        throws IOException {
        StringWriter text = new StringWriter();
        JsonWriter w = new JsonWriter(text);
        write(w, id, name, tier, duration, dropChance, drops, liked, soils, requirements, seed, minSeedBedTier);
        w.close();
        return text.toString();
    }

    /**
     * Writes one line: a JSON object with the fields of format.ts's {@code CropLine} in its order, the lists in the
     * order given, a drop chance that is no finite number as {@code null} (JsonWriter rejects it; such a card is not
     * {@link #valid}) and a {@code null} seed (a card without a seed item) as {@code null}.
     */
    static void write(JsonWriter w, String id, String name, int tier, int duration, double dropChance, List<Drop> drops,
        List<String> liked, List<ItemRef> soils, List<String> requirements, ItemRef seed, int minSeedBedTier)
        throws IOException {
        w.beginObject();
        w.name("id").value(id);
        w.name("name").value(name);
        w.name("tier").value(tier);
        w.name("duration").value(duration);
        w.name("dropChance");
        if (Double.isFinite(dropChance)) w.value(dropChance);
        else w.nullValue();
        w.name("drops").beginArray();
        for (Drop d : drops) {
            w.beginObject();
            w.name("item");
            d.item.write(w);
            w.name("count").value(d.count);
            w.name("chance").value(d.chance);
            w.endObject();
        }
        w.endArray();
        strings(w, "liked", liked);
        w.name("soils").beginArray();
        for (ItemRef soil : soils) soil.write(w);
        w.endArray();
        strings(w, "requirements", requirements);
        w.name("seed");
        if (seed == null) w.nullValue();
        else seed.write(w);
        w.name("minSeedBedTier").value(minSeedBedTier);
        w.endObject();
    }

    private static void strings(JsonWriter w, String name, List<String> values) throws IOException {
        w.name(name).beginArray();
        for (String v : values) w.value(v);
        w.endArray();
    }
}
