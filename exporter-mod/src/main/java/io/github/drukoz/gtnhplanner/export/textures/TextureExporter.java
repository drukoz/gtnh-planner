package io.github.drukoz.gtnhplanner.export.textures;

import java.io.IOException;
import java.lang.reflect.Array;
import java.lang.reflect.Field;
import java.lang.reflect.InvocationTargetException;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.IdentityHashMap;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;
import java.util.concurrent.Callable;

import net.minecraft.block.Block;
import net.minecraft.item.Item;
import net.minecraft.nbt.NBTTagCompound;
import net.minecraftforge.common.util.ForgeDirection;
import net.minecraftforge.fluids.Fluid;
import net.minecraftforge.fluids.FluidRegistry;

import com.google.gson.stream.JsonWriter;

import cpw.mods.fml.common.registry.GameData;
import cpw.mods.fml.relauncher.ReflectionHelper;
import gregtech.api.GregTechAPI;
import gregtech.api.covers.CoverRegistry;
import gregtech.api.enums.Materials;
import gregtech.api.enums.OrePrefixes;
import gregtech.api.enums.TextureSet;
import gregtech.api.enums.Textures;
import gregtech.api.interfaces.IIconContainer;
import gregtech.api.interfaces.ITexture;
import gregtech.api.interfaces.metatileentity.IMetaTileEntity;
import gregtech.api.interfaces.tileentity.ITexturedTileEntity;
import gregtech.api.items.MetaGeneratedItem;
import gregtech.api.items.MetaGeneratedItemX32;
import gregtech.api.metatileentity.BaseMetaPipeEntity;
import gregtech.api.metatileentity.BaseMetaTileEntity;
import gregtech.api.metatileentity.MetaPipeEntity;
import gregtech.api.objects.GTItemStack;
import gregtech.common.fluid.GTFluid;
import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.Tags;

/**
 * {@code textures.json.gz}: GregTech's own texture data, one gzip'd JSON document in the format {@value #FORMAT}
 * (the loader is {@code src/server/assets/textures-dump.ts}). Parts, in file order: {@code sets} and
 * {@code materials} (research §6.1), {@code metaItems} (§6.1–§6.2), {@code mte} (§3.5 A), {@code casingPages}
 * (§3.6), {@code blocks} (§3.7), {@code covers} (§3.8), {@code fluids} (§6.3), {@code textureNames} (§6.4),
 * {@code blockIds} and {@code stats}.
 *
 * <p>
 * Every element is computed fully before it is written, inside its own catch: a failed element is left out (a
 * machine is written with its {@code error} instead), and the first {@value #LISTED_FAILURES} failures of a part go
 * into one warning. {@code stats} holds, per part, {@code <part>} (elements written; for {@code mte} those with
 * faces) and {@code <part>Failed}, then {@code unknown:<class>} for each texture class the flattener could not read.
 *
 * <p>
 * Optional: a failing texture dump never fails the recipe export ({@code failedSections}), and
 * {@code -Dgtnhplanner.skipSections=textures} skips it.
 */
public final class TextureExporter implements ExportSection {

    private static final String FILE = "textures.json.gz", FORMAT = "gtnh-planner-textures/1";
    private static final String ATLAS = "blocks", MISSING_ICON = "MISSING_ICON_", VANILLA_PACKAGE = "net.minecraft.";
    private static final int SIDES = 6, LISTED_FAILURES = 20, LISTED_UNKNOWN = 10;
    /** A canonical machine has its front on north (ForgeDirection 2). */
    private static final byte NORTH = 2;
    /** Every side of a pipe connected, so it is drawn with all its connections. */
    private static final byte ALL_SIDES = 63;
    /** Covers are drawn on a machine's north face. */
    private static final int COVER_SIDE = 2;

    /** {@link #iconTables} value of a class that declares no {@code getIcon}. */
    private static final IconRef[][] NO_TABLE = new IconRef[0][];

    private final McTextureEnv env = new McTextureEnv();

    // The export in progress: export() sets these afresh, so every export starts with empty caches and stats.
    private ExportContext ctx;
    private JsonWriter w;
    private TextureFlattener flattener;
    private Map<String, Integer> stats;
    /** Per class: its parsed {@code getIcon} table, or {@link #NO_TABLE}. */
    private Map<Class<?>, IconRef[][]> iconTables;
    private Map<IconRef, List<LayerRec>> iconLayers;
    /** The protected {@code MetaGeneratedItemX32.mGeneratedPrefixList}, looked up on first use. */
    private Field prefixList;
    /** The public {@code getCoverTexture()} of the package-private {@code CoverRegistration}. */
    private Method coverTexture;

    @Override
    public String name() {
        return "textures";
    }

    @Override
    public boolean optional() {
        return true;
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        this.ctx = ctx;
        flattener = new TextureFlattener(env);
        stats = new LinkedHashMap<>();
        iconTables = new HashMap<>();
        iconLayers = new HashMap<>();
        try (JsonWriter writer = ctx.gzipJson(FILE)) {
            w = writer;
            write();
        }
    }

    /** One element, computed and waiting to be written. */
    private interface Element {

        void write() throws IOException;
    }

    private void write() throws IOException {
        w.beginObject();
        w.name("format")
            .value(FORMAT);
        w.name("exporterVersion")
            .value(Tags.VERSION);
        setsAndMaterials();
        metaItems();
        mte();
        casingPages();
        blocks();
        covers();
        fluids();
        textureNames();
        blockIds();
        stats();
        w.endObject();
    }

    // --- sets and materials (research §6.1) ---

    /**
     * One material per distinct {@code mName}; each distinct {@code mIconSet} object (by identity, so the sets
     * {@code withCustomTextures} derives stay apart) gets the next {@code sets} index.
     */
    private void setsAndMaterials() throws IOException {
        Part setPart = new Part("sets"), materialPart = new Part("materials");
        Map<TextureSet, Integer> setIndices = new IdentityHashMap<>();
        List<Element> sets = new ArrayList<>(), materials = new ArrayList<>();
        Set<String> names = new HashSet<>();
        for (Materials m : Materials.getAll()) {
            if (m == null) continue;
            String name = m.mName;
            try {
                if (name == null) throw new IllegalStateException("material without mName");
                if (names.contains(name)) continue;
                int id = m.mMetaItemSubID;
                int[] rgba = { m.mRGBa[0], m.mRGBa[1], m.mRGBa[2], m.mRGBa[3] };
                int set = setIndex(m.mIconSet, setIndices, sets, setPart);
                materials.add(() -> {
                    w.beginObject();
                    w.name("name")
                        .value(name);
                    w.name("id")
                        .value(id);
                    w.name("rgba");
                    writeInts(rgba);
                    w.name("set")
                        .value(set);
                    w.endObject();
                });
                names.add(name);
            } catch (Throwable t) {
                materialPart.failed(name, t);
            }
        }
        w.name("sets");
        writeAll(sets, setPart);
        w.name("materials");
        writeAll(materials, materialPart);
        setPart.done();
        materialPart.done();
    }

    /**
     * The {@code sets} index of {@code set}, reading its icons the first time; throws when the material has no
     * set or its set could not be read.
     */
    private int setIndex(TextureSet set, Map<TextureSet, Integer> indices, List<Element> sets, Part part) {
        if (set == null) throw new IllegalStateException("material without mIconSet");
        Integer index = indices.get(set);
        if (index == null) {
            try {
                sets.add(textureSet(set));
                index = sets.size() - 1;
            } catch (Throwable t) {
                part.failed(set.mSetName, t);
                index = -1;
            }
            indices.put(set, index);
        }
        if (index < 0) throw new IllegalStateException("its icon set " + set.mSetName + " could not be read");
        return index;
    }

    /** {@code {name, icons}}: texture index → layers, for every slot that flattens to something. */
    private Element textureSet(TextureSet set) {
        String name = set.mSetName;
        IIconContainer[] textures = set.mTextures;
        Map<Integer, List<LayerRec>> icons = new TreeMap<>();
        for (int i = 0; i < textures.length; i++) {
            if (textures[i] == null) continue;
            List<LayerRec> layers = flattener.container(textures[i], null, false);
            if (!layers.isEmpty()) icons.put(i, layers); // "/void" slots flatten to nothing
        }
        return () -> {
            w.beginObject();
            w.name("name")
                .value(name);
            w.name("icons");
            w.beginObject();
            for (Map.Entry<Integer, List<LayerRec>> e : icons.entrySet()) {
                w.name(String.valueOf(e.getKey()));
                writeLayers(e.getValue());
            }
            w.endObject();
            w.endObject();
        };
    }

    // --- meta items (research §6.1–§6.2) ---

    private void metaItems() throws IOException {
        Part part = new Part("metaItems");
        w.name("metaItems");
        w.beginArray();
        for (Item item : GameData.getItemRegistry()
            .typeSafeIterable()) {
            if (item instanceof MetaGeneratedItem) element(part, describe(item), () -> metaItem(item));
        }
        w.endArray();
        part.done();
    }

    /** {@code {id, offset, unlocalized, prefixes}}; {@code prefixes} lists the X32 prefix slots, else empty. */
    private Element metaItem(Item item) throws IllegalAccessException, NoSuchFieldException {
        String id = itemId(item);
        int offset = ((MetaGeneratedItem) item).mOffset;
        String unlocalized = item.getUnlocalizedName();
        List<Element> prefixes = new ArrayList<>();
        if (item instanceof MetaGeneratedItemX32) {
            OrePrefixes[] list = (OrePrefixes[]) prefixList().get(item);
            for (int i = 0; i < list.length; i++) {
                if (list[i] != null) prefixes.add(prefix(i, list[i]));
            }
        }
        return () -> {
            w.beginObject();
            w.name("id")
                .value(id);
            w.name("offset")
                .value(offset);
            w.name("unlocalized")
                .value(unlocalized);
            w.name("prefixes");
            w.beginArray();
            for (Element p : prefixes) p.write();
            w.endArray();
            w.endObject();
        };
    }

    /** {@code {i, prefix, texture}} for prefix slot {@code i} (meta / 1000). */
    private Element prefix(int i, OrePrefixes prefix) {
        String name = prefix.getName(); // what the deprecated name() returns
        int texture = prefix.getTextureIndex();
        return () -> {
            w.beginObject();
            w.name("i")
                .value(i);
            w.name("prefix")
                .value(name);
            w.name("texture")
                .value(texture);
            w.endObject();
        };
    }

    private Field prefixList() throws NoSuchFieldException {
        if (prefixList == null) prefixList = accessible(MetaGeneratedItemX32.class, "mGeneratedPrefixList");
        return prefixList;
    }

    // --- machines (research §3.5 A) ---

    /**
     * Every machine id ≥ 1 in a tile entity of its own, outside any world: front on north, inactive and active
     * ({@code active} left out when it equals {@code inactive}); a pipe connected on all sides, inactive only.
     * A machine that fails is written as {@code {id, cls, error}}.
     */
    private void mte() throws IOException {
        Part part = new Part("mte");
        w.name("mte");
        w.beginArray();
        IMetaTileEntity[] all = GregTechAPI.METATILEENTITIES;
        for (int id = 1; id < all.length; id++) {
            IMetaTileEntity m = all[id];
            if (m == null) continue;
            String cls = m.getClass()
                .getName();
            boolean pipe = m instanceof MetaPipeEntity;
            List<List<LayerRec>> inactive = null, active = null;
            String error = null;
            try {
                if (pipe) {
                    BaseMetaPipeEntity te = new BaseMetaPipeEntity();
                    te.setInitialValuesAsNBT(new NBTTagCompound(), (short) id);
                    te.mConnections = ALL_SIDES;
                    te.setActive(false);
                    inactive = machineFaces(te);
                } else {
                    BaseMetaTileEntity te = machine(id);
                    te.setActive(false);
                    inactive = machineFaces(te);
                    te.setActive(true);
                    active = machineFaces(te);
                }
            } catch (Throwable t) {
                error = t.toString();
                part.failed(id + " " + cls, t);
            }
            w.beginObject();
            w.name("id")
                .value(id);
            w.name("cls")
                .value(cls);
            if (error != null) {
                w.name("error")
                    .value(error);
            } else {
                if (pipe) {
                    w.name("pipe")
                        .value(true);
                }
                w.name("inactive");
                writeFaces(inactive);
                if (active != null && !active.equals(inactive)) {
                    w.name("active");
                    writeFaces(active);
                }
                part.wrote();
            }
            w.endObject();
        }
        w.endArray();
        part.done();
    }

    /** A machine tile entity for {@code id} in the canonical orientation (front and main facing north). */
    private static BaseMetaTileEntity machine(int id) {
        NBTTagCompound nbt = new NBTTagCompound();
        nbt.setByte("mFacing", NORTH);
        nbt.setByte("mMainFacing", NORTH);
        BaseMetaTileEntity te = new BaseMetaTileEntity();
        te.setInitialValuesAsNBT(nbt, (short) id);
        try {
            te.setFrontFacing(ForgeDirection.NORTH);
        } catch (Throwable t) {
            // without a world some machines cannot turn; the NBT above already faces north
        }
        return te;
    }

    /** The six faces of a GT tile entity, as {@code BaseMetaTileEntity.getTexture} draws them. */
    private List<List<LayerRec>> machineFaces(ITexturedTileEntity te) {
        List<List<LayerRec>> faces = new ArrayList<>(SIDES);
        for (int side = 0; side < SIDES; side++) {
            ITexture[] texture = te.getTexture(GregTechAPI.sBlockMachines, ForgeDirection.getOrientation(side));
            faces.add(flattener.flatten(texture, side));
        }
        return faces;
    }

    // --- casing pages (research §3.6) ---

    private void casingPages() throws IOException {
        Part part = new Part("casingPages");
        w.name("casingPages");
        w.beginArray();
        ITexture[][] pages = Textures.BlockIcons.casingTexturePages;
        for (int page = 0; page < pages.length; page++) {
            ITexture[] textures = pages[page];
            if (textures == null) continue;
            for (int index = 0; index < textures.length; index++) {
                ITexture texture = textures[index];
                if (texture == null) continue;
                int id = page << 7 | index;
                element(part, id, () -> {
                    List<List<LayerRec>> faces = new ArrayList<>(SIDES);
                    for (int side = 0; side < SIDES; side++) faces.add(flattener.flatten(texture, side));
                    return () -> {
                        w.beginObject();
                        w.name("id")
                            .value(id);
                        w.name("faces");
                        writeFaces(faces);
                        w.endObject();
                    };
                });
            }
        }
        w.endArray();
        part.done();
    }

    // --- casing blocks (research §3.7) ---

    private void blocks() throws IOException {
        Part part = new Part("blocks");
        w.name("blocks");
        w.beginArray();
        for (Block block : GameData.getBlockRegistry()
            .typeSafeIterable()) {
            element(part, describe(block), () -> block(block));
        }
        w.endArray();
        part.done();
    }

    /**
     * {@code {id, metas}} from the {@code getIcon} table of the block's class or nearest superclass that has
     * one; only metas with a non-empty face. Null when no meta has one.
     */
    private Element block(Block block) throws ReflectiveOperationException {
        Class<?> cls = block.getClass();
        IconRef[][] table = iconTable(cls);
        if (table == null) return null;
        Map<Integer, List<List<LayerRec>>> metas = new TreeMap<>();
        for (int meta = 0; meta < table.length; meta++) {
            List<List<LayerRec>> faces = new ArrayList<>(SIDES);
            boolean drawn = false;
            for (int side = 0; side < SIDES; side++) {
                IconRef ref = table[meta][side];
                List<LayerRec> layers = ref == null ? Collections.<LayerRec>emptyList()
                    : iconLayers(ref, cls.getClassLoader());
                drawn |= !layers.isEmpty();
                faces.add(layers);
            }
            if (drawn) metas.put(meta, faces);
        }
        if (metas.isEmpty()) return null;
        String id = blockId(block);
        return () -> {
            w.beginObject();
            w.name("id")
                .value(id);
            w.name("metas");
            w.beginObject();
            for (Map.Entry<Integer, List<List<LayerRec>>> e : metas.entrySet()) {
                w.name(String.valueOf(e.getKey()));
                writeFaces(e.getValue());
            }
            w.endObject();
            w.endObject();
        };
    }

    /**
     * The parsed {@code getIcon} of {@code blockClass} or its nearest superclass that declares one, stopping
     * before Minecraft's own classes; null when none does. Parsed once per class.
     */
    private IconRef[][] iconTable(Class<?> blockClass) {
        for (Class<?> c = blockClass; c != null && !c.getName()
            .startsWith(VANILLA_PACKAGE); c = c.getSuperclass()) {
            IconRef[][] table = iconTables.get(c);
            if (table == null) {
                table = CasingIconParser.parse(McTextureEnv.classBytes(c));
                if (table == null) table = NO_TABLE;
                iconTables.put(c, table);
            }
            if (table != NO_TABLE) return table;
        }
        return null;
    }

    /**
     * The layers of the icon container {@code ref} names: its static field (array element when
     * {@code index ≥ 0}; nothing when out of bounds), read by reflection. Resolved once per ref.
     */
    private List<LayerRec> iconLayers(IconRef ref, ClassLoader loader) throws ReflectiveOperationException {
        List<LayerRec> layers = iconLayers.get(ref);
        if (layers == null) {
            Class<?> owner = Class.forName(ref.owner.replace('/', '.'), false, loader);
            Object value = accessible(owner, ref.field).get(null);
            if (ref.index >= 0) {
                boolean inBounds = value != null && value.getClass()
                    .isArray() && ref.index < Array.getLength(value);
                value = inBounds ? Array.get(value, ref.index) : null;
            }
            layers = flattener.container(value, null, false);
            iconLayers.put(ref, layers);
        }
        return layers;
    }

    // --- covers (research §3.8) ---

    private void covers() throws IOException {
        Part part = new Part("covers");
        w.name("covers");
        w.beginArray();
        Map<?, ?> covers = null;
        try {
            covers = (Map<?, ?>) accessible(CoverRegistry.class, "covers").get(null);
        } catch (Throwable t) {
            part.failed("CoverRegistry.covers", t);
        }
        if (covers != null) {
            for (Map.Entry<?, ?> e : covers.entrySet()) {
                element(part, describeCover(e.getKey()), () -> cover((GTItemStack) e.getKey(), e.getValue()));
            }
        }
        w.endArray();
        part.done();
    }

    /** {@code {item: <registry name>@<meta>, layers}}: the cover's texture as drawn on a north face. */
    private Element cover(GTItemStack stack, Object registration) throws ReflectiveOperationException {
        String item = itemId(stack.mItem) + "@" + stack.mMetaData;
        if (coverTexture == null) {
            Method m = registration.getClass()
                .getMethod("getCoverTexture");
            m.setAccessible(true); // CoverRegistration is package-private
            coverTexture = m;
        }
        List<LayerRec> layers = flattener.flatten(coverTexture.invoke(registration), COVER_SIDE);
        return () -> {
            w.beginObject();
            w.name("item")
                .value(item);
            w.name("layers");
            writeLayers(layers);
            w.endObject();
        };
    }

    private static String describeCover(Object key) {
        if (!(key instanceof GTItemStack)) return String.valueOf(key);
        GTItemStack stack = (GTItemStack) key;
        return describe(stack.mItem) + "@" + stack.mMetaData;
    }

    // --- fluids (research §6.3) ---

    /**
     * {@code {name, color}} for every fluid, plus {@code still} for a {@code GTFluid}: its own still icon, or
     * that of the {@code GTFluid} it borrows its icons from.
     */
    private void fluids() throws IOException {
        Part part = new Part("fluids");
        Field still = gtFluidField("stillIconResourceLocation", part);
        Field iconsFrom = gtFluidField("iconsFrom", part);
        w.name("fluids");
        w.beginArray();
        for (Fluid fluid : FluidRegistry.getRegisteredFluids()
            .values()) {
            element(part, describeFluid(fluid), () -> fluid(fluid, still, iconsFrom));
        }
        w.endArray();
        part.done();
    }

    /** A private field of {@code GTFluid}; null (fluids are then written without {@code still}) when absent. */
    private static Field gtFluidField(String name, Part part) {
        try {
            return accessible(GTFluid.class, name);
        } catch (Throwable t) {
            part.failed("GTFluid." + name + " (fluids written without still)", t);
            return null;
        }
    }

    private Element fluid(Fluid fluid, Field still, Field iconsFrom) throws IllegalAccessException {
        String name = fluid.getName();
        int color = fluid.getColor();
        String path = stillPath(fluid, still, iconsFrom);
        return () -> {
            w.beginObject();
            w.name("name")
                .value(name);
            w.name("color")
                .value(color);
            if (path != null) {
                w.name("still")
                    .value(path);
            }
            w.endObject();
        };
    }

    /** The data/assets path of a {@code GTFluid}'s still icon (block atlas); null for other fluids. */
    private String stillPath(Fluid fluid, Field still, Field iconsFrom) throws IllegalAccessException {
        if (!(fluid instanceof GTFluid) || still == null) return null;
        Object location = still.get(fluid);
        if (location == null && iconsFrom != null) {
            Object from = iconsFrom.get(fluid);
            if (from instanceof GTFluid) location = still.get(from);
        }
        String[] r = env.resource(location);
        return r == null ? null : TexturePaths.fromResource(r[0], r[1], ATLAS);
    }

    private static String describeFluid(Fluid fluid) {
        try {
            return fluid.getName();
        } catch (Throwable t) {
            return String.valueOf(fluid);
        }
    }

    // --- texture names (research §6.4) ---

    /** Registry name → {@code Block.textureName} / {@code Item.iconString}, when set and not a missing icon. */
    private void textureNames() throws IOException {
        w.name("textureNames");
        w.beginObject();
        Part blocks = new Part("blockTextureNames");
        w.name("blocks");
        w.beginObject();
        for (Block block : GameData.getBlockRegistry()
            .typeSafeIterable()) {
            element(
                blocks,
                describe(block),
                () -> textureName(
                    blockId(block),
                    ReflectionHelper.getPrivateValue(Block.class, block, "textureName", "field_149768_d")));
        }
        w.endObject();
        blocks.done();
        Part items = new Part("itemTextureNames");
        w.name("items");
        w.beginObject();
        for (Item item : GameData.getItemRegistry()
            .typeSafeIterable()) {
            element(
                items,
                describe(item),
                () -> textureName(
                    itemId(item),
                    ReflectionHelper.getPrivateValue(Item.class, item, "iconString", "field_111218_cA")));
        }
        w.endObject();
        items.done();
        w.endObject();
    }

    /** One {@code "<id>": "<texture name>"} member; null for an unset or missing-icon name. */
    private Element textureName(String id, Object textureName) {
        if (!(textureName instanceof String) || ((String) textureName).startsWith(MISSING_ICON)) return null;
        return () -> w.name(id)
            .value((String) textureName);
    }

    // --- block ids and stats ---

    private void blockIds() throws IOException {
        Part part = new Part("blockIds");
        Set<String> ids = new TreeSet<>();
        for (Block block : GameData.getBlockRegistry()
            .typeSafeIterable()) {
            try {
                ids.add(blockId(block));
            } catch (Throwable t) {
                part.failed(describe(block), t);
            }
        }
        w.name("blockIds");
        w.beginArray();
        for (String id : ids) {
            w.value(id);
            part.wrote();
        }
        w.endArray();
        part.done();
    }

    /** The part counts, then {@code unknown:<class>}; one warning names the most frequent unknown classes. */
    private void stats() throws IOException {
        Map<String, Integer> unknown = flattener.unknownClasses();
        w.name("stats");
        w.beginObject();
        for (Map.Entry<String, Integer> e : stats.entrySet()) {
            w.name(e.getKey())
                .value(e.getValue());
        }
        for (Map.Entry<String, Integer> e : unknown.entrySet()) {
            w.name("unknown:" + e.getKey())
                .value(e.getValue());
        }
        w.endObject();
        if (unknown.isEmpty()) return;
        List<Map.Entry<String, Integer>> byCount = new ArrayList<>(unknown.entrySet());
        byCount.sort((a, b) -> b.getValue() - a.getValue()); // stable: equal counts stay in name order
        List<String> top = new ArrayList<>();
        for (Map.Entry<String, Integer> e : byCount.subList(0, Math.min(LISTED_UNKNOWN, byCount.size()))) {
            top.add(e.getKey() + " (" + e.getValue() + ")");
        }
        ctx.warn(
            "textures: " + unknown.size()
                + " texture classes could not be read (error layers), most frequent: "
                + String.join(", ", top));
    }

    // --- helpers ---

    /**
     * Computes one element; a failure is counted and the element left out, null means nothing to write. Only the
     * computation is guarded: a write error ends the section.
     */
    private void element(Part part, Object what, Callable<Element> compute) throws IOException {
        Element element;
        try {
            element = compute.call();
        } catch (Throwable t) {
            part.failed(what, t);
            return;
        }
        if (element == null) return;
        element.write();
        part.wrote();
    }

    private void writeAll(List<Element> elements, Part part) throws IOException {
        w.beginArray();
        for (Element e : elements) {
            e.write();
            part.wrote();
        }
        w.endArray();
    }

    private void writeLayers(List<LayerRec> layers) throws IOException {
        w.beginArray();
        for (LayerRec layer : layers) layer.write(w);
        w.endArray();
    }

    private void writeFaces(List<List<LayerRec>> faces) throws IOException {
        w.beginArray();
        for (List<LayerRec> face : faces) writeLayers(face);
        w.endArray();
    }

    private void writeInts(int[] values) throws IOException {
        w.beginArray();
        for (int v : values) w.value(v);
        w.endArray();
    }

    /** Declared field {@code name} of {@code c}, made accessible. */
    private static Field accessible(Class<?> c, String name) throws NoSuchFieldException {
        Field f = c.getDeclaredField(name);
        f.setAccessible(true);
        return f;
    }

    private static String blockId(Block block) {
        String id = GameData.getBlockRegistry()
            .getNameForObject(block);
        if (id == null) throw new IllegalStateException("block not in the block registry: " + block);
        return id;
    }

    private static String itemId(Item item) {
        String id = GameData.getItemRegistry()
            .getNameForObject(item);
        if (id == null) throw new IllegalStateException("item not in the item registry: " + item);
        return id;
    }

    /** The registry name of a block or item for a message; never throws. */
    private static String describe(Object blockOrItem) {
        try {
            String id;
            if (blockOrItem instanceof Block) {
                id = GameData.getBlockRegistry()
                    .getNameForObject(blockOrItem);
            } else {
                id = GameData.getItemRegistry()
                    .getNameForObject(blockOrItem);
            }
            return id != null ? id : String.valueOf(blockOrItem);
        } catch (Throwable t) {
            return String.valueOf(blockOrItem);
        }
    }

    /** Counts and the first failures of one part; {@link #done()} adds them to {@code stats}. */
    private final class Part {

        private final String name;
        private final List<String> listed = new ArrayList<>();
        private int written, failed;

        Part(String name) {
            this.name = name;
        }

        void wrote() {
            written++;
        }

        void failed(Object what, Throwable t) {
            failed++;
            Throwable cause = t instanceof InvocationTargetException && t.getCause() != null ? t.getCause() : t;
            if (listed.size() < LISTED_FAILURES) listed.add(what + ": " + cause);
        }

        void done() {
            stats.put(name, written);
            stats.put(name + "Failed", failed);
            if (failed == 0) return;
            String first = failed > listed.size() ? " (first " + listed.size() + ")" : "";
            ctx.warn("textures " + name + ": " + failed + " failed" + first + ": " + String.join("; ", listed));
        }
    }
}
