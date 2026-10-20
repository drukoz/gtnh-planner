package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.lang.invoke.MethodHandle;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Set;

import net.minecraft.block.Block;
import net.minecraft.init.Blocks;
import net.minecraft.item.ItemStack;
import net.minecraftforge.oredict.OreDictionary;

import com.google.gson.stream.JsonWriter;

import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;
import io.github.drukoz.gtnhplanner.export.NameResolver;
import io.github.drukoz.gtnhplanner.export.Reflect;

/**
 * {@code crops}: one line per CropsNH crop card ({@link CropLine}), in the crop registry's registration order, for the
 * planner's crop farms (farms.md §2.7, §5.7). CropsNH is not on the compile classpath, so its own members are called
 * through {@link Reflect}, each found once by its name and exact type as {@code javap -p -s} shows them in
 * {@code cropsnh-2.0.129.jar}, on the public class or interface that declares it:
 * <ul>
 * <li>{@code com.gtnewhorizon.cropsnh.farming.registries.CropRegistry}: the public static field
 * {@code CropRegistry instance} and its {@code LinkedList<ICropCard> getAllInRegistrationOrder()};</li>
 * <li>{@code com.gtnewhorizon.cropsnh.api.ICropCard}, whatever class a card has: {@code String getId()},
 * {@code String getUnlocalizedName()} (the en_US key of its name), {@code int getTier()},
 * {@code int getGrowthDuration()}, {@code float getDropChance()}, {@code int getMinSeedBedTier()},
 * {@code Map<ItemStack, Integer> getDropTable()} (each stack with its chance out of 10000),
 * {@code Set<BiomeDictionary.Type> getLikedBiomeTags()}, {@code List<ItemStack> getSoilsForNEI(boolean)} (the soil
 * blocks as items; {@code true} takes the card's cached list), {@code Collection<IGrowthRequirement>
 * getGrowthRequirements()} and {@code ItemStack getSeedItem(com.gtnewhorizon.cropsnh.api.ISeedStats)}, called with
 * {@code null} stats: the seed whose NBT names only its crop ({@code NHCropCard.writeNBT} leaves the stats out).</li>
 * </ul>
 * Both have public members without {@code @SideOnly} whose parameter is a client class
 * ({@code CropRegistry.registerIcons(IIconRegister)}, {@code ICropCard.registerSprites(IIconRegister)}), so asking
 * either for its methods throws {@link NoClassDefFoundError} on a dedicated server, while a handle resolves only its
 * own member. Minecraft and Forge members (stack sizes, enum names, translations, blocks) are called directly.
 *
 * <p>
 * The section adds nothing to the item table: it looks items up ({@link ItemTable#find}) and never interns one, so
 * {@code items.jsonl.gz}, and with it every wildcard's options, ore name and recipe id, is what an export without the
 * crop table has. (Exporter 0.5.0 interned them: 199 more items, and four rotated logs joined {@code logWood} and the
 * options of 56 recipes.) An item the table has is written by its index; one it lacks is written inline
 * ({@link CropLine.ItemRef#inline}: its key without NBT, its NBT, and its English name, which
 * {@link NameResolver#uncountedName} gives without counting a name failure, since it is no line of the item table):
 * <ul>
 * <li>a drop: the stack of the drop table as it is (a berry variant and six mana beans with an aspect each are not in
 * the item table of GTNH 2.9.0-RC-1);</li>
 * <li>a soil: CropsNH's stack when the table has it. Otherwise the variant {@link CropLine#soilMeta} gives, by index
 * when the table has that one. For a block registered without a meta, CropsNH writes the wildcard
 * ({@code SoilList.lambda$getNEIItemList$1}: {@code new ItemStack(item, 1, meta == null ? 32767 : meta)}): any variant
 * counts, and the line names variant 0. Any other soil is the variant its block drops, {@code Block.damageDropped(meta)}
 * (Forge's pick block takes the same: {@code Block.getDamageValue} returns it), so a log lying along x or z is its log:
 * Thaumcraft's {@code BlockMagicalLog.func_149692_a} returns {@code (meta & 3) == 2 ? 1 : meta & 3}, so Greatwood Log 4
 * and 8 are 0 and Silverwood Log 5 and 9 are 1, as {@code BlockRotatedPillar.damageDropped} ({@code meta & 3}) does for
 * vanilla logs;</li>
 * <li>the seed: inline, named after its crop ({@link CropLine#seedName}), unless the table has it. Its own name on a
 * server is "Unknown Seeds": {@code ItemGenericSeed.func_77667_c} names a seed without analyzed stats
 * {@code cropsnh_genericSeeds.unknown}.</li>
 * </ul>
 * The drop table and the liked tags are a {@code HashMap} and a {@code HashSet} whose keys have no hash of their own,
 * and the soils come from a hash map of blocks, so CropsNH hands them over in a different order on every run: the line
 * has the drops in {@link CropLine#sortDrops} order, the tags by name and the soils by item key
 * ({@link CropLine#soils}), each soil once, so two exports of one pack agree. The growth requirements keep the card's
 * order (a list). The drop chance is CropsNH's {@code float} widened exactly, the value a harvest multiplies by, and a
 * drop's chance is CropsNH's as it is, never clamped (Water Lily: 80000 and 20000). Without CropsNH the section writes
 * no file and no count; a card whose call throws, or that is not {@link CropLine#valid}, is left out with a warning.
 */
public final class CropsSection implements ExportSection {

    private static final String CROP_REGISTRY = "com.gtnewhorizon.cropsnh.farming.registries.CropRegistry";
    private static final String CROP_CARD = "com.gtnewhorizon.cropsnh.api.ICropCard";
    private static final String SEED_STATS = "com.gtnewhorizon.cropsnh.api.ISeedStats";

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
        CropsNh nh = new CropsNh();
        Object registry = Reflect.invoke(nh.instance);
        Iterable<?> cards = (Iterable<?>) Reflect.invoke(nh.allInRegistrationOrder, registry);
        try (JsonlWriter w = ctx.jsonl("crops")) {
            for (Object card : cards) {
                try {
                    writeCard(w, nh, card, ctx);
                } catch (Throwable t) {
                    ctx.warn("crop " + describe(nh, card) + ": " + t);
                }
            }
        }
    }

    /** The CropsNH members this section calls (see the class comment), each found once. */
    private static final class CropsNh {

        final MethodHandle instance;
        final MethodHandle allInRegistrationOrder;
        final MethodHandle id;
        final MethodHandle unlocalizedName;
        final MethodHandle tier;
        final MethodHandle growthDuration;
        final MethodHandle dropChance;
        final MethodHandle minSeedBedTier;
        final MethodHandle dropTable;
        final MethodHandle likedBiomeTags;
        final MethodHandle soilsForNei;
        final MethodHandle growthRequirements;
        final MethodHandle seedItem;

        CropsNh() {
            Class<?> registry = Reflect.load(CROP_REGISTRY);
            Class<?> card = Reflect.load(CROP_CARD);
            instance = Reflect.staticGetter(registry, "instance", registry);
            allInRegistrationOrder = Reflect.method(registry, "getAllInRegistrationOrder", LinkedList.class);
            id = Reflect.method(card, "getId", String.class);
            unlocalizedName = Reflect.method(card, "getUnlocalizedName", String.class);
            tier = Reflect.method(card, "getTier", int.class);
            growthDuration = Reflect.method(card, "getGrowthDuration", int.class);
            dropChance = Reflect.method(card, "getDropChance", float.class);
            minSeedBedTier = Reflect.method(card, "getMinSeedBedTier", int.class);
            dropTable = Reflect.method(card, "getDropTable", Map.class);
            likedBiomeTags = Reflect.method(card, "getLikedBiomeTags", Set.class);
            soilsForNei = Reflect.method(card, "getSoilsForNEI", List.class, boolean.class);
            growthRequirements = Reflect.method(card, "getGrowthRequirements", Collection.class);
            seedItem = Reflect.method(card, "getSeedItem", ItemStack.class, Reflect.load(SEED_STATS));
        }
    }

    /** Reads every value of the card, then writes its line; a call that throws leaves no line. */
    private static void writeCard(JsonlWriter w, CropsNh nh, Object card, ExportContext ctx) throws IOException {
        String id = (String) Reflect.invoke(nh.id, card);
        double dropChance = number(nh.dropChance, card).doubleValue();
        if (!CropLine.valid(id, dropChance)) {
            ctx.warn(
                "crop " + id + ": left out, a card needs an id and a finite drop chance (it has " + dropChance + ")");
            return;
        }
        String unlocalized = (String) Reflect.invoke(nh.unlocalizedName, card);
        String name = ctx.names().translate(unlocalized);
        if (name == null) name = unlocalized != null ? unlocalized : id;
        int tier = number(nh.tier, card).intValue();
        int duration = number(nh.growthDuration, card).intValue();
        int minSeedBedTier = number(nh.minSeedBedTier, card).intValue();
        ItemTable items = ctx.items();
        NameResolver names = ctx.names();
        List<CropLine.Drop> drops = drops((Map<?, ?>) Reflect.invoke(nh.dropTable, card), items, names);
        List<String> liked = new ArrayList<>();
        for (Object tag : (Iterable<?>) Reflect.invoke(nh.likedBiomeTags, card)) liked.add(((Enum<?>) tag).name());
        Collections.sort(liked);
        List<CropLine.ItemRef> soils = soils((Iterable<?>) Reflect.invoke(nh.soilsForNei, card, true), items, names);
        List<String> requirements = new ArrayList<>();
        for (Object r : (Iterable<?>) Reflect.invoke(nh.growthRequirements, card)) {
            requirements.add(r.getClass().getSimpleName());
        }
        ItemStack seedStack = (ItemStack) Reflect.invoke(nh.seedItem, card, null);
        CropLine.ItemRef seed = seedStack != null ? seed(seedStack, name, items) : null;

        JsonWriter j = w.begin();
        CropLine
            .write(j, id, name, tier, duration, dropChance, drops, liked, soils, requirements, seed, minSeedBedTier);
        w.end();
    }

    /** What a numeric getter of the card returns: CropsNH's {@code int} or {@code float}, boxed. */
    private static Number number(MethodHandle getter, Object card) {
        return (Number) Reflect.invoke(getter, card);
    }

    /** The drop table as drops in {@link CropLine#sortDrops} order. */
    private static List<CropLine.Drop> drops(Map<?, ?> table, ItemTable items, NameResolver names) {
        List<CropLine.Drop> drops = new ArrayList<>(table.size());
        for (Map.Entry<?, ?> e : table.entrySet()) {
            ItemStack stack = (ItemStack) e.getKey();
            int chance = ((Number) e.getValue()).intValue();
            drops.add(new CropLine.Drop(item(stack, items, names), stack.stackSize, chance));
        }
        CropLine.sortDrops(drops);
        return drops;
    }

    /** The soils as the line names them (class comment), in the order of their item keys, each once. */
    private static List<CropLine.ItemRef> soils(Iterable<?> stacks, ItemTable items, NameResolver names) {
        List<CropLine.ItemRef> soils = new ArrayList<>();
        for (Object s : stacks) soils.add(soil((ItemStack) s, items, names));
        return CropLine.soils(soils);
    }

    /**
     * One soil: CropsNH's stack by its index when the item table has it; else the variant {@link CropLine#soilMeta}
     * gives (wildcard: variant 0; else the variant its block drops), by index or inline.
     */
    private static CropLine.ItemRef soil(ItemStack stack, ItemTable items, NameResolver names) {
        int index = items.find(stack);
        if (index != ItemTable.ABSENT) return CropLine.ItemRef.indexed(ItemTable.keyOf(stack), index);
        int meta = stack.getItemDamage();
        int dropped = meta == OreDictionary.WILDCARD_VALUE ? CropLine.NOT_A_BLOCK : droppedMeta(stack, meta);
        ItemStack variant = stack.copy();
        variant.setItemDamage(CropLine.soilMeta(meta, dropped));
        return item(variant, items, names);
    }

    /**
     * {@code Block.damageDropped(meta)} on the block the stack's item places ({@link CropLine#droppedMeta}), or
     * {@link CropLine#NOT_A_BLOCK} when it places none or the block's method throws: the soil then keeps its own.
     */
    private static int droppedMeta(ItemStack stack, int meta) {
        Block block = Block.getBlockFromItem(stack.getItem());
        if (block == null || block == Blocks.air) return CropLine.NOT_A_BLOCK;
        return CropLine.droppedMeta(m -> block.damageDropped(m), meta);
    }

    /** The seed: by its index when the item table has it, else inline and named after its crop. */
    private static CropLine.ItemRef seed(ItemStack stack, String cropName, ItemTable items) {
        int index = items.find(stack);
        if (index != ItemTable.ABSENT) return CropLine.ItemRef.indexed(ItemTable.keyOf(stack), index);
        return CropLine.ItemRef.inline(ItemTable.plainKeyOf(stack), ItemTable.nbtOf(stack), CropLine.seedName(cropName));
    }

    /**
     * {@code stack} by its index when the item table has it, else inline with its English name (its key without NBT
     * when it has none, since the loader needs a name); the table is never added to.
     */
    private static CropLine.ItemRef item(ItemStack stack, ItemTable items, NameResolver names) {
        int index = items.find(stack);
        if (index != ItemTable.ABSENT) return CropLine.ItemRef.indexed(ItemTable.keyOf(stack), index);
        String plainKey = ItemTable.plainKeyOf(stack);
        String name = names.uncountedName(stack);
        return CropLine.ItemRef
            .inline(plainKey, ItemTable.nbtOf(stack), name != null && !name.isEmpty() ? name : plainKey);
    }

    /** The card's id for a warning, or its class when even that call fails. */
    private static String describe(CropsNh nh, Object card) {
        try {
            return String.valueOf(Reflect.invoke(nh.id, card));
        } catch (Throwable t) {
            return card == null ? "null" : card.getClass().getName();
        }
    }
}
