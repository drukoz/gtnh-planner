package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

import net.minecraft.item.ItemStack;

import com.google.gson.stream.JsonWriter;

import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;
import io.github.drukoz.gtnhplanner.export.Reflect;

/**
 * {@code crops}: one line per CropsNH crop card ({@link CropLine}), in the crop registry's registration order, for the
 * planner's crop farms (farms.md §2.7, §5.7). CropsNH is not on the compile classpath, so its own members are called
 * through {@link Reflect}, by the names {@code javap -c -p -constants} shows in {@code cropsnh-2.0.129.jar}:
 * <ul>
 * <li>{@code com.gtnewhorizon.cropsnh.farming.registries.CropRegistry}: the public static field {@code instance} and
 * its {@code LinkedList<ICropCard> getAllInRegistrationOrder()};</li>
 * <li>{@code com.gtnewhorizon.cropsnh.api.ICropCard}: {@code String getId()}, {@code String getUnlocalizedName()} (the
 * en_US key of its name), {@code int getTier()}, {@code int getGrowthDuration()}, {@code float getDropChance()},
 * {@code int getMinSeedBedTier()}, {@code Map<ItemStack, Integer> getDropTable()} (each stack with its chance out of
 * 10000), {@code Set<BiomeDictionary.Type> getLikedBiomeTags()}, {@code List<ItemStack> getSoilsForNEI(boolean)} (the
 * soil blocks as items; {@code true} takes the card's cached list), {@code Collection<IGrowthRequirement>
 * getGrowthRequirements()} and {@code ItemStack getSeedItem(ISeedStats)}, called with {@code null} stats: the seed
 * whose NBT names only its crop ({@code NHCropCard.writeNBT} leaves the stats out).</li>
 * </ul>
 * Minecraft and Forge members (stack sizes, enum names, translations) are called directly. The drop table and the liked
 * tags are a {@code HashMap} and a {@code HashSet} whose keys have no hash of their own, and the soils come from a hash
 * map of blocks, so CropsNH hands them over in a different order on every run: the line has the drops in
 * {@link CropLine#sortDrops} order, the tags by name and the soils by item key, each soil once, so two exports of one
 * pack agree. The growth requirements keep the card's order (a list). The drop chance is CropsNH's {@code float}
 * widened exactly, the value a harvest multiplies by. Without CropsNH the section writes no file and no count; a card
 * whose call throws, or that is not {@link CropLine#valid}, is left out with a warning.
 */
public final class CropsSection implements ExportSection {

    private static final String CROP_REGISTRY = "com.gtnewhorizon.cropsnh.farming.registries.CropRegistry";

    @Override
    public String name() {
        return "crops";
    }

    /** The export goes on without the crop table, which only the planner's crop farms need. */
    @Override
    public boolean optional() {
        return true;
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        if (!Reflect.hasClass(CROP_REGISTRY)) {
            ctx.warn("crops: CropsNH is not installed, so the export has no crop table");
            return;
        }
        Object registry = Reflect.getStatic(CROP_REGISTRY, "instance");
        Iterable<?> cards = (Iterable<?>) Reflect.call(registry, "getAllInRegistrationOrder");
        try (JsonlWriter w = ctx.jsonl("crops")) {
            for (Object card : cards) {
                try {
                    writeCard(w, card, ctx);
                } catch (Throwable t) {
                    ctx.warn("crop " + describe(card) + ": " + t);
                }
            }
        }
    }

    /** Reads every value of the card, then writes its line; a call that throws leaves no line. */
    private static void writeCard(JsonlWriter w, Object card, ExportContext ctx) throws IOException {
        String id = (String) Reflect.call(card, "getId");
        double dropChance = number(card, "getDropChance").doubleValue();
        if (!CropLine.valid(id, dropChance)) {
            ctx.warn(
                "crop " + id + ": left out, a card needs an id and a finite drop chance (it has " + dropChance + ")");
            return;
        }
        String unlocalized = (String) Reflect.call(card, "getUnlocalizedName");
        String name = ctx.names().translate(unlocalized);
        if (name == null) name = unlocalized != null ? unlocalized : id;
        int tier = number(card, "getTier").intValue();
        int duration = number(card, "getGrowthDuration").intValue();
        int minSeedBedTier = number(card, "getMinSeedBedTier").intValue();
        ItemTable items = ctx.items();
        List<CropLine.Drop> drops = drops((Map<?, ?>) Reflect.call(card, "getDropTable"), items);
        List<String> liked = new ArrayList<>();
        for (Object tag : (Iterable<?>) Reflect.call(card, "getLikedBiomeTags")) liked.add(((Enum<?>) tag).name());
        Collections.sort(liked);
        List<Integer> soils = soils((Iterable<?>) Reflect.call(card, "getSoilsForNEI", true), items);
        List<String> requirements = new ArrayList<>();
        for (Object r : (Iterable<?>) Reflect.call(card, "getGrowthRequirements")) {
            requirements.add(r.getClass().getSimpleName());
        }
        ItemStack seedStack = (ItemStack) Reflect.call(card, "getSeedItem", (Object) null);
        int seed = seedStack != null ? items.intern(seedStack) : CropLine.NO_SEED;

        JsonWriter j = w.begin();
        CropLine
            .write(j, id, name, tier, duration, dropChance, drops, liked, soils, requirements, seed, minSeedBedTier);
        w.end();
    }

    /** What a numeric getter of the card returns: CropsNH's return {@code int} or {@code float}. */
    private static Number number(Object card, String method) {
        return (Number) Reflect.call(card, method);
    }

    /** The drop table as drops in {@link CropLine#sortDrops} order; each stack's item is interned. */
    private static List<CropLine.Drop> drops(Map<?, ?> table, ItemTable items) {
        List<CropLine.Drop> drops = new ArrayList<>(table.size());
        for (Map.Entry<?, ?> e : table.entrySet()) {
            ItemStack stack = (ItemStack) e.getKey();
            int chance = ((Number) e.getValue()).intValue();
            drops.add(new CropLine.Drop(ItemTable.keyOf(stack), items.intern(stack), stack.stackSize, chance));
        }
        CropLine.sortDrops(drops);
        return drops;
    }

    /** The soils' item indices in the order of their item keys, each soil once. */
    private static List<Integer> soils(Iterable<?> stacks, ItemTable items) {
        Map<String, ItemStack> byKey = new TreeMap<>();
        for (Object s : stacks) byKey.putIfAbsent(ItemTable.keyOf((ItemStack) s), (ItemStack) s);
        List<Integer> soils = new ArrayList<>(byKey.size());
        for (ItemStack stack : byKey.values()) soils.add(items.intern(stack));
        return soils;
    }

    /** The card's id for a warning, or its class when even that call fails. */
    private static String describe(Object card) {
        try {
            return String.valueOf(Reflect.call(card, "getId"));
        } catch (Throwable t) {
            return card == null ? "null" : card.getClass().getName();
        }
    }
}
