package io.github.drukoz.gtnhplanner.export.sections;

import java.io.File;
import java.io.IOException;
import java.lang.invoke.MethodHandle;
import java.net.URI;
import java.net.URL;
import java.net.URLDecoder;
import java.security.CodeSource;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.function.Supplier;

import net.minecraft.item.ItemStack;
import net.minecraft.world.WorldProvider;
import net.minecraftforge.common.DimensionManager;
import net.minecraftforge.fluids.Fluid;
import net.minecraftforge.fluids.FluidStack;

import org.apache.commons.lang3.tuple.Pair;

import com.google.common.collect.BiMap;
import com.google.gson.stream.JsonWriter;

import bwcrossmod.galacticgreg.VoidMinerUtility;
import cpw.mods.fml.common.Loader;
import cpw.mods.fml.common.ModContainer;
import galacticgreg.api.ModDimensionDef;
import galacticgreg.api.enums.DimensionDef;
import gregtech.GTMod;
import gregtech.api.enums.Materials;
import gregtech.api.objects.GTUODimension;
import gregtech.api.objects.GTUODimensionList;
import gregtech.api.objects.GTUOFluid;
import gregtech.api.util.GTOreDictUnificator;
import gregtech.api.util.GTUtility;
import gregtech.common.WorldgenGTOreLayer;
import gregtech.common.WorldgenGTOreSmallPieces;
import gtnhintergalactic.recipe.AsteroidData;
import gtnhintergalactic.recipe.GasSiphonRecipes;
import gtnhintergalactic.recipe.SpaceMiningRecipes;
import gtnhintergalactic.recipe.SpacePumpingRecipes;
import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;
import io.github.drukoz.gtnhplanner.export.Reflect;
import toxiceverglades.dimension.DimensionEverglades;

/**
 * Where materials come from (materials-availability.md §1, §2, §8.5): dimensions, Galacticraft bodies, ore veins,
 * small ores, underground fluids, void-miner drops, gas siphons, the space pump and space-mining asteroids. Each part
 * writes its own file inside its own catch, so a part that fails is a warning {@code worldgen <part>: <error>} and an
 * empty (or partial) file, never a missing one. Nothing here needs a loaded world: providers come from
 * {@link DimensionManager#createProviderFor(int)}, never {@code getProvider}. Galacticraft is reached only through
 * {@link Reflect}, by class names in strings, each member by its exact name and type ({@link Galacticraft}).
 */
public final class WorldgenSection implements ExportSection {

    private static final String GALACTICRAFT_API = "micdoodle8.mods.galacticraft.api.";
    private static final String WORLD_PROVIDER_SPACE = GALACTICRAFT_API + "prefab.world.gen.WorldProviderSpace";

    /** One part: writes the lines of one file. */
    private interface Part {

        void write(JsonlWriter w) throws Exception;
    }

    @Override
    public String name() {
        return "worldgen";
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        Map<Integer, WorldProvider> providers = staticProviders(ctx);
        part(ctx, "dimensions", w -> writeDimensions(w, providers, ctx));
        part(ctx, "celestial", w -> writeCelestial(w, ctx));
        part(ctx, "oreVeins", w -> writeOreVeins(w, ctx));
        part(ctx, "smallOres", w -> writeSmallOres(w, ctx));
        part(ctx, "undergroundFluids", w -> writeUndergroundFluids(w, providers, ctx));
        part(ctx, "voidMiner", w -> writeVoidMiner(w, ctx));
        part(ctx, "gasSiphon", w -> writeGasSiphon(w, ctx));
        part(ctx, "spacePump", w -> writeSpacePump(w, ctx));
        part(ctx, "spaceAsteroids", w -> writeSpaceAsteroids(w, ctx));
    }

    /** Opens the part's file first, so it exists whatever the part does; a part that throws becomes a warning. */
    private static void part(ExportContext ctx, String countKey, Part part) throws IOException {
        try (JsonlWriter w = ctx.jsonl(countKey)) {
            try {
                part.write(w);
            } catch (Throwable t) {
                ctx.warn("worldgen " + countKey + ": " + t);
            }
        }
    }

    // ---- dimensions --------------------------------------------------------------------------------------------

    /**
     * Every static dimension id, ascending, with a provider made by {@code createProviderFor} (which instantiates the
     * provider class without a world). An id whose provider cannot be made maps to {@code null}, with a warning.
     */
    private static Map<Integer, WorldProvider> staticProviders(ExportContext ctx) {
        Map<Integer, WorldProvider> providers = new LinkedHashMap<>();
        Integer[] ids;
        try {
            ids = DimensionManager.getStaticDimensionIDs();
            Arrays.sort(ids);
        } catch (Throwable t) {
            ctx.warn("worldgen dimensions: static dimension ids: " + t);
            return providers;
        }
        for (Integer id : ids) {
            WorldProvider p = null;
            try {
                p = DimensionManager.createProviderFor(id);
                if (p == null) throw new IllegalStateException("createProviderFor returned null");
            } catch (Throwable t) {
                ctx.warn("worldgen dimensions: provider of dim " + id + ": " + t);
            }
            providers.put(id, p);
        }
        return providers;
    }

    private static void writeDimensions(JsonlWriter w, Map<Integer, WorldProvider> providers, ExportContext ctx)
        throws IOException {
        Map<File, List<ModContainer>> modsBySource = modsBySource(ctx);
        AirIntake air = new AirIntake(ctx);
        Set<String> written = new HashSet<>();
        Galacticraft gc = null; // found at the first space dimension, so a pack without Galacticraft never needs it
        for (Map.Entry<Integer, WorldProvider> e : providers.entrySet()) {
            int id = e.getKey();
            WorldProvider p = e.getValue();
            if (p == null) continue; // warned in staticProviders
            try {
                String name;
                String display;
                String body = null;
                if (Reflect.isInstance(p, WORLD_PROVIDER_SPACE)) {
                    // the same rule as GT's DimensionDef.getDimensionName(World)
                    if (gc == null) gc = new Galacticraft();
                    Object celestial = Reflect.invoke(gc.celestialBody, p);
                    name = (String) Reflect.invoke(gc.name, celestial);
                    display = (String) Reflect.invoke(gc.localizedName, celestial);
                    body = name;
                } else {
                    name = p.getDimensionName();
                    display = name;
                }
                if (name == null) throw new IllegalStateException("no dimension name");
                ModDimensionDef def = DimensionDef.getDefByName(name);

                JsonWriter j = w.begin();
                j.beginObject();
                j.name("id").value(id);
                j.name("provider").value(p.getClass().getName());
                j.name("name").value(name);
                j.name("display").value(display);
                j.name("mod").value(modOf(p.getClass(), modsBySource));
                if (def != null) writeOre(j, def);
                if (body != null) j.name("body").value(body);
                j.name("airIntake").value(air.gasFor(id));
                j.endObject();
                w.end();
                written.add(name);
            } catch (Throwable t) {
                ctx.warn("worldgen dimensions: dim " + id + ": " + t);
            }
        }
        // ore-gen names that are no dimension of their own, such as EndAsteroid (a region of DIM 1)
        for (DimensionDef d : DimensionDef.values()) {
            try {
                ModDimensionDef def = d.modDimensionDef;
                String name = def.getDimensionName();
                if (name == null) throw new IllegalStateException("no dimension name");
                if (written.contains(name)) continue;
                JsonWriter j = w.begin();
                j.beginObject();
                j.name("id").nullValue();
                j.name("name").value(name);
                writeOre(j, def);
                j.endObject();
                w.end();
                written.add(name);
            } catch (Throwable t) {
                ctx.warn("worldgen dimensions: ore-gen dimension " + d + ": " + t);
            }
        }
    }

    private static void writeOre(JsonWriter j, ModDimensionDef def) throws IOException {
        j.name("ore").beginObject();
        j.name("type").value(def.getDimensionType().name());
        j.name("veinChance").value(def.getOreVeinChance());
        j.name("voidMinable").value(def.canBeVoidMined());
        j.endObject();
    }

    /**
     * The gas GT++'s air intake hatch makes in a dimension ({@code MTEHatchAirIntake.getFluidToGenerate}): Toxic Air
     * in the Toxic Everglades, Nether Air in DIM -1, Air everywhere else, each taken from the same {@link Materials}
     * field the hatch reads (Nether Air is the material's fluid, not its gas). Each name is resolved once; one that
     * cannot be resolved is {@code null}, with a warning.
     */
    private static final class AirIntake {

        private final Integer evergladesId;
        private final String air;
        private final String netherAir;
        private final String toxicAir;

        AirIntake(ExportContext ctx) {
            Integer everglades = null;
            try {
                everglades = DimensionEverglades.DIMID;
            } catch (Throwable t) {
                ctx.warn("worldgen dimensions: Toxic Everglades dimension id: " + t);
            }
            evergladesId = everglades;
            air = fluidName(ctx, "Air", () -> Materials.Air.getGas(1).getFluid());
            netherAir = fluidName(ctx, "NetherAir", () -> Materials.NetherAir.mFluid);
            toxicAir = fluidName(ctx, "ToxicAir", () -> Materials.ToxicAir.mGas);
        }

        String gasFor(int id) {
            if (evergladesId != null && id == evergladesId) return toxicAir;
            if (id == -1) return netherAir;
            return air;
        }

        private static String fluidName(ExportContext ctx, String label, Supplier<Fluid> fluid) {
            try {
                return fluid.get().getName();
            } catch (Throwable t) {
                ctx.warn("worldgen dimensions: gas of " + label + ": " + t);
                return null;
            }
        }
    }

    /**
     * Active mods by the canonical file they were loaded from. Several mods can share one jar (GT, BartWorks and
     * GT++; Galacticraft Core and Planets), so each file maps to a list.
     */
    private static Map<File, List<ModContainer>> modsBySource(ExportContext ctx) {
        Map<File, List<ModContainer>> bySource = new LinkedHashMap<>();
        try {
            for (ModContainer mod : Loader.instance().getActiveModList()) {
                try {
                    File source = mod.getSource();
                    if (source == null) continue;
                    File key = source.getCanonicalFile();
                    List<ModContainer> mods = bySource.get(key);
                    if (mods == null) bySource.put(key, mods = new ArrayList<>());
                    mods.add(mod);
                } catch (Throwable t) {
                    ctx.warn("worldgen dimensions: source of mod " + mod.getModId() + ": " + t);
                }
            }
        } catch (Throwable t) {
            ctx.warn("worldgen dimensions: mod list: " + t);
        }
        return bySource;
    }

    /**
     * {@code minecraft} for {@code net.minecraft.*}; else the id of the mod loaded from the file the class came from,
     * or {@code null}. When several mods share that file, the one whose mod class shares the longest package prefix
     * with {@code cls} wins (the first of them on a tie).
     */
    private static String modOf(Class<?> cls, Map<File, List<ModContainer>> modsBySource) {
        if (cls.getName().startsWith("net.minecraft.")) return "minecraft";
        File source = codeSourceFile(cls);
        List<ModContainer> mods = source != null ? modsBySource.get(source) : null;
        if (mods == null || mods.isEmpty()) return null;
        ModContainer best = mods.get(0);
        int bestShared = -1;
        for (ModContainer mod : mods) {
            Object instance = mod.getMod();
            int shared = instance != null ? sharedPackages(cls.getName(), instance.getClass().getName()) : 0;
            if (shared > bestShared) {
                best = mod;
                bestShared = shared;
            }
        }
        return best.getModId();
    }

    /** How many leading package segments two class names have in common. */
    private static int sharedPackages(String a, String b) {
        String[] pa = a.split("\\.");
        String[] pb = b.split("\\.");
        int n = 0;
        // the last segment is the simple class name, not a package
        while (n < pa.length - 1 && n < pb.length - 1 && pa[n].equals(pb[n])) n++;
        return n;
    }

    /**
     * The canonical jar file or directory a class was loaded from, or {@code null}. Mod class loaders may record the
     * class's own {@code jar:file:…!/…} URL as the code source, so a {@code jar:} URL is cut down to its file.
     */
    private static File codeSourceFile(Class<?> cls) {
        try {
            CodeSource cs = cls.getProtectionDomain().getCodeSource();
            if (cs == null || cs.getLocation() == null) return null;
            String url = cs.getLocation().toString();
            if (url.startsWith("jar:")) {
                int bang = url.indexOf("!/");
                url = url.substring("jar:".length(), bang >= 0 ? bang : url.length());
            }
            File file;
            try {
                file = new File(new URI(url));
            } catch (Exception e) {
                // a URL with unescaped characters (spaces) is no valid URI
                file = new File(URLDecoder.decode(new URL(url).getPath(), "UTF-8"));
            }
            return file.getCanonicalFile();
        } catch (Throwable t) {
            return null;
        }
    }

    // ---- Galacticraft bodies -----------------------------------------------------------------------------------

    /**
     * The Galacticraft members this section calls, each found once by its name and exact type as {@code javap -p -s}
     * shows them in {@code Galacticraft-3.4.34-GTNH.jar}, on the public class or interface of
     * {@code micdoodle8.mods.galacticraft.api} that declares it (see {@link Reflect} for why nothing asks a class for
     * its members): {@code world.IGalacticraftWorldProvider}'s {@code CelestialBody getCelestialBody()};
     * {@code galaxies.CelestialBody}'s {@code String getName()}, {@code String getLocalizedName()},
     * {@code int getTierRequirement()}, {@code boolean getReachable()}, {@code Class<? extends WorldProvider>
     * getWorldProvider()} and {@code int getDimensionID()}; {@code galaxies.Planet}'s
     * {@code SolarSystem getParentSolarSystem()}; {@code galaxies.IChildBody}'s {@code Planet getParentPlanet()} (moons
     * and satellites); {@code galaxies.SolarSystem}'s {@code String getName()}; and {@code galaxies.GalaxyRegistry}'s
     * static {@code Map<String, Planet> getRegisteredPlanets()}, {@code Map<String, Moon> getRegisteredMoons()} and
     * {@code Map<String, Satellite> getRegisteredSatellites()}.
     */
    private static final class Galacticraft {

        final MethodHandle celestialBody;
        final MethodHandle name;
        final MethodHandle localizedName;
        final MethodHandle tierRequirement;
        final MethodHandle reachable;
        final MethodHandle worldProvider;
        final MethodHandle dimensionId;
        final MethodHandle parentSolarSystem;
        final MethodHandle parentPlanet;
        final MethodHandle solarSystemName;
        final MethodHandle planets;
        final MethodHandle moons;
        final MethodHandle satellites;

        Galacticraft() {
            Class<?> body = Reflect.load(GALACTICRAFT_API + "galaxies.CelestialBody");
            Class<?> planet = Reflect.load(GALACTICRAFT_API + "galaxies.Planet");
            Class<?> solarSystem = Reflect.load(GALACTICRAFT_API + "galaxies.SolarSystem");
            Class<?> child = Reflect.load(GALACTICRAFT_API + "galaxies.IChildBody");
            Class<?> registry = Reflect.load(GALACTICRAFT_API + "galaxies.GalaxyRegistry");
            Class<?> provider = Reflect.load(GALACTICRAFT_API + "world.IGalacticraftWorldProvider");
            celestialBody = Reflect.method(provider, "getCelestialBody", body);
            name = Reflect.method(body, "getName", String.class);
            localizedName = Reflect.method(body, "getLocalizedName", String.class);
            tierRequirement = Reflect.method(body, "getTierRequirement", int.class);
            reachable = Reflect.method(body, "getReachable", boolean.class);
            worldProvider = Reflect.method(body, "getWorldProvider", Class.class);
            dimensionId = Reflect.method(body, "getDimensionID", int.class);
            parentSolarSystem = Reflect.method(planet, "getParentSolarSystem", solarSystem);
            parentPlanet = Reflect.method(child, "getParentPlanet", planet);
            solarSystemName = Reflect.method(solarSystem, "getName", String.class);
            planets = Reflect.staticMethod(registry, "getRegisteredPlanets", Map.class);
            moons = Reflect.staticMethod(registry, "getRegisteredMoons", Map.class);
            satellites = Reflect.staticMethod(registry, "getRegisteredSatellites", Map.class);
        }
    }

    private static void writeCelestial(JsonlWriter w, ExportContext ctx) throws IOException {
        Galacticraft gc = new Galacticraft();
        writeBodies(w, gc, gc.planets, "planet", gc.parentSolarSystem, gc.solarSystemName, ctx);
        writeBodies(w, gc, gc.moons, "moon", gc.parentPlanet, gc.name, ctx);
        writeBodies(w, gc, gc.satellites, "satellite", gc.parentPlanet, gc.name, ctx);
    }

    /**
     * The bodies of one of {@code GalaxyRegistry}'s maps ({@code registry}); {@code parentOf} gives a body's parent and
     * {@code parentName} that parent's name.
     */
    private static void writeBodies(JsonlWriter w, Galacticraft gc, MethodHandle registry, String kind,
        MethodHandle parentOf, MethodHandle parentName, ExportContext ctx) throws IOException {
        Map<?, ?> bodies = (Map<?, ?>) Reflect.invoke(registry);
        if (bodies == null) return;
        for (Map.Entry<?, ?> e : bodies.entrySet()) {
            Object body = e.getValue();
            try {
                if (body == null) throw new IllegalStateException("null body");
                Object parent = Reflect.invoke(parentOf, body);
                JsonWriter j = w.begin();
                j.beginObject();
                j.name("name").value((String) Reflect.invoke(gc.name, body));
                j.name("display").value((String) Reflect.invoke(gc.localizedName, body));
                j.name("kind").value(kind);
                j.name("parent").value(parent != null ? (String) Reflect.invoke(parentName, parent) : null);
                j.name("tier").value((Integer) Reflect.invoke(gc.tierRequirement, body));
                j.name("dim").value(dimensionOf(gc, body));
                j.name("reachable").value((Boolean) Reflect.invoke(gc.reachable, body));
                j.endObject();
                w.end();
            } catch (Throwable t) {
                ctx.warn("worldgen celestial: " + kind + " " + e.getKey() + ": " + t);
            }
        }
    }

    /**
     * The body's dimension id, or {@code null} when it has none: Galacticraft sets the id together with the provider
     * class ({@code setDimensionInfo}), so a body without a provider class has none (its id field is a meaningless
     * 0), and a satellite's id is a provider type rather than a registered dimension.
     */
    private static Integer dimensionOf(Galacticraft gc, Object body) {
        if (Reflect.invoke(gc.worldProvider, body) == null) return null;
        int id = (Integer) Reflect.invoke(gc.dimensionId, body);
        return DimensionManager.isDimensionRegistered(id) ? id : null;
    }

    // ---- ore veins and small ores ------------------------------------------------------------------------------

    private static void writeOreVeins(JsonlWriter w, ExportContext ctx) throws IOException {
        for (WorldgenGTOreLayer vein : WorldgenGTOreLayer.sList) {
            if (vein == null) continue;
            try {
                Set<String> dims = vein.getAllowedDimensions();
                JsonWriter j = w.begin();
                j.beginObject();
                j.name("name").value(vein.mWorldGenName);
                j.name("weight").value(vein.mWeight);
                j.name("density").value(vein.mDensity);
                j.name("size").value(vein.mSize);
                j.name("dims").beginArray();
                for (String dim : dims) j.value(dim);
                j.endArray();
                j.name("yByDim").beginObject();
                for (String dim : dims) {
                    j.name(dim).beginArray();
                    j.value(vein.getMinY(dim));
                    j.value(vein.getMaxY(dim));
                    j.endArray();
                }
                j.endObject();
                j.name("primary").value(MaterialsSection.key(vein.mPrimary));
                j.name("secondary").value(MaterialsSection.key(vein.mSecondary));
                j.name("between").value(MaterialsSection.key(vein.mBetween));
                j.name("sporadic").value(MaterialsSection.key(vein.mSporadic));
                j.name("stoneSpecific").value(vein.isStoneSpecific());
                j.endObject();
                w.end();
            } catch (Throwable t) {
                ctx.warn("worldgen oreVeins: " + vein.mWorldGenName + ": " + t);
            }
        }
    }

    private static void writeSmallOres(JsonlWriter w, ExportContext ctx) throws IOException {
        for (WorldgenGTOreSmallPieces small : WorldgenGTOreSmallPieces.sList) {
            if (small == null) continue;
            try {
                JsonWriter j = w.begin();
                j.beginObject();
                j.name("name").value(small.mWorldGenName);
                j.name("amount").value(small.mAmount);
                j.name("y").beginArray();
                j.value(small.mMinY);
                j.value(small.mMaxY);
                j.endArray();
                j.name("dims").beginArray();
                for (String dim : small.getAllowedDimensions()) j.value(dim);
                j.endArray();
                j.name("material").value(MaterialsSection.key(small.getMaterial()));
                j.endObject();
                w.end();
            } catch (Throwable t) {
                ctx.warn("worldgen smallOres: " + small.mWorldGenName + ": " + t);
            }
        }
    }

    // ---- underground fluids ------------------------------------------------------------------------------------

    /**
     * Replicates {@code GTUODimensionList.GetDimension(id)} for every static dimension without a loaded world
     * (materials-availability.md §2.1): a blacklisted id has no entry; else the entry keyed
     * {@code Integer.toString(id)}; else the first entry, in the list's own order, whose key is contained in the
     * provider's class name; else the entry {@code "Default"}, if any. One line per entry, with the ids it serves.
     */
    private static void writeUndergroundFluids(JsonlWriter w, Map<Integer, WorldProvider> providers,
        ExportContext ctx) throws IOException {
        GTUODimensionList list = GTMod.proxy.mUndergroundOil;
        BiMap<String, GTUODimension> entries = list.getDimensionList();
        Map<String, List<Integer>> dimsByKey = new LinkedHashMap<>();
        for (String key : entries.keySet()) dimsByKey.put(key, new ArrayList<>());
        for (Map.Entry<Integer, WorldProvider> e : providers.entrySet()) {
            int id = e.getKey();
            if (blacklisted(list.blackList, id)) continue;
            String key = uoKey(entries, id, e.getValue());
            if (key != null) dimsByKey.get(key).add(id);
        }
        for (Map.Entry<String, GTUODimension> e : entries.entrySet()) {
            try {
                JsonWriter j = w.begin();
                j.beginObject();
                j.name("key").value(e.getKey());
                j.name("dims").beginArray();
                for (int id : dimsByKey.get(e.getKey())) j.value(id);
                j.endArray();
                j.name("fluids").beginArray();
                for (GTUOFluid f : e.getValue().getFluids().values()) {
                    j.beginObject();
                    j.name("fluid").value(f.Registry);
                    j.name("chance").value(f.Chance);
                    j.name("min").value(f.MinAmount);
                    j.name("max").value(f.MaxAmount);
                    j.name("decrease").value(f.DecreasePerOperationAmount);
                    j.endObject();
                }
                j.endArray();
                j.endObject();
                w.end();
            } catch (Throwable t) {
                ctx.warn("worldgen undergroundFluids: " + e.getKey() + ": " + t);
            }
        }
    }

    /** GT's {@code CheckBlackList}: a binary search of the (sorted) blacklist, {@code false} when that throws. */
    private static boolean blacklisted(int[] blackList, int id) {
        try {
            return Arrays.binarySearch(blackList, id) >= 0;
        } catch (Exception e) {
            return false;
        }
    }

    /** The key of the entry GT would pick for {@code id}; a missing provider can only match by id. */
    private static String uoKey(BiMap<String, GTUODimension> entries, int id, WorldProvider provider) {
        String byId = Integer.toString(id);
        if (entries.containsKey(byId)) return byId;
        if (provider != null) {
            String cls = provider.getClass().getName();
            for (String key : entries.keySet()) {
                if (cls.contains(key)) return key;
            }
        }
        return entries.containsKey("Default") ? "Default" : null;
    }

    // ---- void miners -------------------------------------------------------------------------------------------

    /**
     * {@code dropMapsByDimName} with the matching {@code extraDropsByDimName}, plus any dimension that only has extra
     * drops (a void miner reads both maps). A drop whose item cannot be interned is left out; such drops are reported
     * in one warning per dimension.
     */
    private static void writeVoidMiner(JsonlWriter w, ExportContext ctx) throws IOException {
        Map<String, VoidMinerUtility.DropMap> drops = VoidMinerUtility.dropMapsByDimName;
        Map<String, VoidMinerUtility.DropMap> extras = VoidMinerUtility.extraDropsByDimName;
        Set<String> dims = new LinkedHashSet<>(drops.keySet());
        dims.addAll(extras.keySet());
        for (String dim : dims) {
            try {
                List<String> failed = new ArrayList<>();
                JsonWriter j = w.begin();
                j.beginObject();
                j.name("dim").value(dim);
                j.name("drops");
                writeDrops(j, drops.get(dim), failed, ctx.items());
                j.name("extra");
                writeDrops(j, extras.get(dim), failed, ctx.items());
                j.endObject();
                w.end();
                if (!failed.isEmpty()) {
                    ctx.warn("worldgen voidMiner: " + dim + ": " + failed.size() + " drop(s) left out, first: "
                        + failed.get(0));
                }
            } catch (Throwable t) {
                ctx.warn("worldgen voidMiner: " + dim + ": " + t);
            }
        }
    }

    private static void writeDrops(JsonWriter j, VoidMinerUtility.DropMap map, List<String> failed, ItemTable items)
        throws IOException {
        j.beginArray();
        if (map != null) {
            for (Map.Entry<GTUtility.ItemId, Float> e : map.getInternalMap().entrySet()) {
                int item;
                try {
                    item = items.intern(e.getKey().getItemStack());
                } catch (Throwable t) {
                    failed.add(t.toString());
                    continue;
                }
                j.beginObject();
                j.name("item").value(item);
                j.name("weight").value(e.getValue());
                j.endObject();
            }
        }
        j.endArray();
    }

    // ---- space -------------------------------------------------------------------------------------------------

    private static void writeGasSiphon(JsonlWriter w, ExportContext ctx) throws IOException {
        for (GasSiphonRecipes.GasSiphonRecipe r : GasSiphonRecipes.RECIPES.values()) {
            if (r == null) continue;
            try {
                JsonWriter j = w.begin();
                j.beginObject();
                j.name("planet").value(r.planet);
                j.name("tier").value(r.tier);
                j.name("depths").beginArray();
                for (Map.Entry<Integer, FluidStack> d : r.depths.entrySet()) {
                    FluidStack fluid = d.getValue();
                    if (fluid.getFluid() == null) throw new IllegalArgumentException("fluid stack without a fluid");
                    j.beginArray();
                    j.value(d.getKey());
                    j.value(fluid.getFluid().getName());
                    j.value(fluid.amount);
                    j.endArray();
                }
                j.endArray();
                j.endObject();
                w.end();
            } catch (Throwable t) {
                ctx.warn("worldgen gasSiphon: " + r.planet + ": " + t);
            }
        }
    }

    private static void writeSpacePump(JsonlWriter w, ExportContext ctx) throws IOException {
        for (Map.Entry<Pair<Integer, Integer>, FluidStack> e : SpacePumpingRecipes.RECIPES.entrySet()) {
            try {
                Pair<Integer, Integer> key = e.getKey();
                FluidStack fluid = e.getValue();
                if (fluid.getFluid() == null) throw new IllegalArgumentException("fluid stack without a fluid");
                JsonWriter j = w.begin();
                j.beginObject();
                j.name("planetType").value(key.getLeft());
                j.name("gasType").value(key.getRight());
                j.name("fluid").value(fluid.getFluid().getName());
                j.name("amount").value(fluid.amount);
                j.endObject();
                w.end();
            } catch (Throwable t) {
                ctx.warn("worldgen spacePump: " + e.getKey() + ": " + t);
            }
        }
    }

    /**
     * {@code uniqueAsteroidList}. Outputs are the asteroid's own items, or {@code orePrefixes} of each output
     * material; an output without an item drops the whole asteroid, because {@code outputs[i]} pairs with
     * {@code chances[i]}.
     */
    private static void writeSpaceAsteroids(JsonlWriter w, ExportContext ctx) throws IOException {
        ItemTable items = ctx.items();
        for (AsteroidData a : SpaceMiningRecipes.uniqueAsteroidList) {
            if (a == null) continue;
            try {
                JsonWriter j = w.begin();
                j.beginObject();
                j.name("name").value(a.asteroidName);
                j.name("outputs").beginArray();
                if (a.outputItems != null) {
                    for (ItemStack s : a.outputItems) j.value(items.intern(s));
                } else {
                    for (Materials m : a.output) j.value(items.intern(GTOreDictUnificator.get(a.orePrefixes, m, 1L)));
                }
                j.endArray();
                j.name("chances").beginArray();
                if (a.chances != null) {
                    for (int c : a.chances) j.value(c);
                }
                j.endArray();
                j.name("moduleTier").value(a.requiredModuleTier);
                j.name("droneTiers").beginArray();
                j.value(a.minDroneTier);
                j.value(a.maxDroneTier);
                j.endArray();
                j.name("distance").beginArray();
                j.value(a.minDistance);
                j.value(a.maxDistance);
                j.endArray();
                j.name("weight").value(a.recipeWeight);
                j.endObject();
                w.end();
            } catch (Throwable t) {
                ctx.warn("worldgen spaceAsteroids: " + a.asteroidName + ": " + t);
            }
        }
    }
}
