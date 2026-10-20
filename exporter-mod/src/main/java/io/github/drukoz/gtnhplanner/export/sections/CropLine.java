package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.io.StringWriter;
import java.util.Comparator;
import java.util.List;

import com.google.gson.stream.JsonWriter;

/**
 * One line of {@code crops.jsonl.gz} ({@code CropLine} in format.ts): a crop card's values as numbers, strings and item
 * indices, which {@link CropsSection} reads from CropsNH. Free of Minecraft and CropsNH classes, so JUnit can test it.
 * Lines are written through a {@link JsonWriter}, because Minecraft's Gson 2.2.4 cannot put ready JSON text into
 * another writer's value.
 */
final class CropLine {

    /** The seed index of a card without a seed item, written as {@code null}. */
    static final int NO_SEED = -1;

    /** The likeliest drop first, then by item key, then the larger stack first. */
    private static final Comparator<Drop> DROP_ORDER = (a, b) -> {
        if (a.chance != b.chance) return Integer.compare(b.chance, a.chance);
        int byKey = a.key.compareTo(b.key);
        return byKey != 0 ? byKey : Integer.compare(b.count, a.count);
    };

    private CropLine() {}

    /**
     * One entry of a card's drop table: its item's table key ({@code ItemTable.keyOf}, the same in every export of one
     * pack, unlike the index; only {@link #sortDrops} reads it), the item's index, the stack size and the chance out of
     * 10000.
     */
    static final class Drop {

        final String key;
        final int item;
        final int count;
        final int chance;

        Drop(String key, int item, int count, int chance) {
            this.key = key;
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
     * Sorts {@code drops} into the order of a line: the likeliest first, then by item key, then the larger stack first.
     * CropsNH keeps a card's drop table in a {@code HashMap} keyed by {@code ItemStack}, which has no hash of its own,
     * so the table comes in a different order on every run; sorted, two exports of one pack agree.
     */
    static void sortDrops(List<Drop> drops) {
        drops.sort(DROP_ORDER);
    }

    /** What {@link #write} writes for these values, as JSON text. */
    static String json(String id, String name, int tier, int duration, double dropChance, List<Drop> drops,
        List<String> liked, List<Integer> soils, List<String> requirements, int seed, int minSeedBedTier)
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
     * {@link #valid}) and {@link #NO_SEED} as {@code null}.
     */
    static void write(JsonWriter w, String id, String name, int tier, int duration, double dropChance, List<Drop> drops,
        List<String> liked, List<Integer> soils, List<String> requirements, int seed, int minSeedBedTier)
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
            w.name("item").value(d.item);
            w.name("count").value(d.count);
            w.name("chance").value(d.chance);
            w.endObject();
        }
        w.endArray();
        strings(w, "liked", liked);
        w.name("soils").beginArray();
        for (int soil : soils) w.value(soil);
        w.endArray();
        strings(w, "requirements", requirements);
        w.name("seed");
        if (seed == NO_SEED) w.nullValue();
        else w.value(seed);
        w.name("minSeedBedTier").value(minSeedBedTier);
        w.endObject();
    }

    private static void strings(JsonWriter w, String name, List<String> values) throws IOException {
        w.name(name).beginArray();
        for (String v : values) w.value(v);
        w.endArray();
    }
}
