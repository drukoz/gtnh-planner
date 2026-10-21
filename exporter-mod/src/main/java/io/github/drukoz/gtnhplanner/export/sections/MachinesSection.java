package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.util.Arrays;
import java.util.Collection;
import java.util.Collections;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.Set;

import net.minecraftforge.fluids.FluidStack;

import com.google.gson.stream.JsonWriter;
import com.gtnewhorizon.structurelib.alignment.constructable.IConstructable;

import gregtech.api.GregTechAPI;
import gregtech.api.enums.GTValues;
import gregtech.api.enums.Materials;
import gregtech.api.interfaces.metatileentity.IMetaTileEntity;
import gregtech.api.interfaces.tileentity.RecipeMapWorkable;
import gregtech.api.metatileentity.MetaPipeEntity;
import gregtech.api.metatileentity.implementations.MTEBasicBatteryBuffer;
import gregtech.api.metatileentity.implementations.MTEBasicGenerator;
import gregtech.api.metatileentity.implementations.MTEBasicMachine;
import gregtech.api.metatileentity.implementations.MTEBasicMachineBronze;
import gregtech.api.metatileentity.implementations.MTECable;
import gregtech.api.metatileentity.implementations.MTEFluidPipe;
import gregtech.api.metatileentity.implementations.MTEHatch;
import gregtech.api.metatileentity.implementations.MTEItemPipe;
import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import gregtech.api.metatileentity.implementations.MTETieredMachineBlock;
import gregtech.api.metatileentity.implementations.MTETransformer;
import gregtech.api.recipe.RecipeMap;
import gregtech.api.recipe.RecipeMaps;
import gregtech.api.util.GTModHandler;
import gregtech.common.tileentities.boilers.MTEBoiler;
import gregtech.common.tileentities.boilers.MTEBoilerSolar;
import gregtech.common.tileentities.generators.MTESteamTurbine;
import io.github.drukoz.gtnhplanner.export.ClassScan;
import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;

/**
 * {@code machines}: one line per registered GT meta tile entity, {@code id} = its index in
 * {@link GregTechAPI#METATILEENTITIES} (the {@code mID} a world stores), with its kind, tier, recipe maps, power or
 * pipe stats, a basic machine's item slot counts ({@link ItemSlots}) and overclock flags (export-mod.md §3,
 * gt-mechanics.md §2.4, §4.1). Every slot holds a prototype with no world behind it, so only fields and field-only
 * getters are read; {@code maxEUInput()} / {@code maxEUOutput()} of generators and transformers are never called
 * (export-mod.md §3.5).
 */
public final class MachinesSection implements ExportSection {

    /** Calls that switch a machine's processing logic or calculator to perfect overclocks. */
    private static final Set<String> PERFECT_OC = Collections
        .unmodifiableSet(new HashSet<>(Arrays.asList("enablePerfectOverclock", "enablePerfectOC")));

    /** The call that turns on heat-based overclocks. */
    private static final String HEAT_OC = "setHeatOC";

    private static final Set<String> OC_NAMES;

    static {
        Set<String> names = new HashSet<>(PERFECT_OC);
        names.add(HEAT_OC);
        OC_NAMES = Collections.unmodifiableSet(names);
    }

    @Override
    public String name() {
        return "machines";
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        ItemTable items = ctx.items();
        FluidStack steam = steam(ctx);
        Set<Class<?>> unscannable = new HashSet<>();
        IMetaTileEntity[] all = GregTechAPI.METATILEENTITIES;
        try (JsonlWriter w = ctx.jsonl("machines")) {
            for (int id = 0; id < all.length; id++) {
                IMetaTileEntity m = all[id];
                if (m == null) continue;
                try {
                    write(w, id, m, steam, items, unscannable, ctx);
                } catch (Throwable t) {
                    ctx.warn("machine " + id + ": " + t);
                }
            }
        }
    }

    /** 1 L of steam, the fluid the steam turbine numbers are read for; {@code null} with a warning if GT has none. */
    @SuppressWarnings("deprecation") // GTModHandler.getSteam is deprecated in GT 5.09.54; it still returns GT's steam
    private static FluidStack steam(ExportContext ctx) {
        try {
            return GTModHandler.getSteam(1);
        } catch (Throwable t) {
            ctx.warn("steam fluid unavailable, no turbine efficiencies: " + t);
            return null;
        }
    }

    private static void write(JsonlWriter w, int id, IMetaTileEntity m, FluidStack steam, ItemTable items,
        Set<Class<?>> unscannable, ExportContext ctx) throws IOException {
        String name = m.getMetaName();
        String cls = m.getClass().getName();
        String dn;
        try {
            dn = m.getLocalName();
        } catch (Throwable t) {
            dn = null;
        }
        Integer item;
        try {
            item = items.intern(m.getStackForm(1));
        } catch (Throwable t) {
            item = null;
        }
        Set<String> maps = null;
        String mapsError = null;
        if (m instanceof RecipeMapWorkable) {
            try {
                maps = mapNames(((RecipeMapWorkable) m).getAvailableRecipeMaps());
            } catch (Throwable t) {
                mapsError = t.toString();
            }
        }
        Set<String> oc = ocNames(m.getClass(), unscannable, ctx);

        JsonWriter j = w.begin();
        j.beginObject();
        j.name("id").value(id);
        j.name("name").value(name);
        j.name("cls").value(cls);
        j.name("dn").value(dn);
        j.name("item").value(item);
        j.name("kind").value(kind(m));
        if (m instanceof MTETieredMachineBlock) {
            int tier = ((MTETieredMachineBlock) m).mTier;
            j.name("tier").value(tier);
            if (tier >= 0 && tier < GTValues.V.length) j.name("voltage").value(GTValues.V[tier]);
        }
        if (m instanceof MTEBasicMachine) {
            MTEBasicMachine basic = (MTEBasicMachine) m;
            j.name("amps").value(basic.mAmperage);
            // the slot counts GT's MTEBasicMachineWithRecipeBuilder slots step gave the constructor
            ItemSlots.write(j, basic.mInputSlotCount, basic.mOutputItems);
        } else if (m instanceof MTEBasicBatteryBuffer) {
            MTEBasicBatteryBuffer b = (MTEBasicBatteryBuffer) m;
            j.name("amps").value(BatteryBuffers.ampsOut(b.mInventory.length, b.maxAmperesOut()));
        }
        if (maps != null && !maps.isEmpty()) {
            j.name("maps").beginArray();
            for (String map : maps) j.value(map);
            j.endArray();
        }
        if (mapsError != null) j.name("mapsError").value(mapsError);
        if (!Collections.disjoint(oc, PERFECT_OC)) j.name("perfectOC").value(true);
        if (oc.contains(HEAT_OC)) j.name("heatOC").value(true);
        writeStats(j, m, steam);
        j.endObject();
        w.end();
    }

    /**
     * The first matching kind of format.ts {@code MachineKind}; StructureLib's {@code IConstructable} also counts as a
     * multiblock, which catches {@code MTEBrickedBlastFurnace} (a plain {@code MetaTileEntity}).
     */
    private static String kind(IMetaTileEntity m) {
        if (m instanceof MTECable) return "cable";
        if (m instanceof MTEFluidPipe) return "fluid_pipe";
        if (m instanceof MTEItemPipe) return "item_pipe";
        if (m instanceof MetaPipeEntity) return "other";
        if (m instanceof MTEMultiBlockBase || m instanceof IConstructable) return "multiblock";
        if (m instanceof MTEHatch) return "hatch";
        if (m instanceof MTEBoiler) return "boiler";
        if (m instanceof MTESteamTurbine) return "turbine";
        if (m instanceof MTEBasicGenerator) return "generator";
        if (m instanceof MTEBasicBatteryBuffer) return "battery_buffer";
        if (m instanceof MTETransformer) return "transformer";
        if (m instanceof MTEBasicMachineBronze) return "steam";
        if (m instanceof MTEBasicMachine) return "basic";
        return "other";
    }

    /**
     * Map names in the machine's order without duplicates, plus GT's hard-coded NEI cutter catalysts: every machine
     * that runs {@code cutterRecipes} also shows {@code cutterFakeRecipes} (export-mod.md §3.4).
     */
    private static Set<String> mapNames(Collection<RecipeMap<?>> maps) {
        Set<String> names = new LinkedHashSet<>();
        if (maps == null) return names;
        for (RecipeMap<?> map : maps) {
            if (map != null) names.add(map.unlocalizedName);
        }
        if (names.contains(RecipeMaps.cutterRecipes.unlocalizedName)) {
            names.add(RecipeMaps.cutterFakeRecipes.unlocalizedName);
        }
        return names;
    }

    /**
     * Which overclock calls the machine's class files name ({@link ClassScan}); a class whose bytes cannot be read
     * gets no flags and one warning, however many machines share it.
     */
    private static Set<String> ocNames(Class<?> cls, Set<Class<?>> unscannable, ExportContext ctx) {
        try {
            return ClassScan.referencedNames(cls, OC_NAMES);
        } catch (Throwable t) {
            if (unscannable.add(cls)) {
                ctx.warn("class scan of " + cls.getName() + " failed, no perfectOC/heatOC: " + t);
            }
            return Collections.emptySet();
        }
    }

    /** Cable, pipe, buffer, solar boiler and steam turbine numbers; nothing for other machines. */
    private static void writeStats(JsonWriter j, IMetaTileEntity m, FluidStack steam) throws IOException {
        if (m instanceof MTECable) {
            MTECable c = (MTECable) m;
            j.name("cable").beginObject();
            j.name("voltage").value(c.mVoltage);
            j.name("amps").value(c.mAmperage);
            j.name("lossPerBlock").value(c.mCableLossPerMeter);
            j.name("insulated").value(c.mInsulated);
            j.name("material").value(materialName(c.mMaterial));
            j.endObject();
        } else if (m instanceof MTEFluidPipe) {
            MTEFluidPipe p = (MTEFluidPipe) m;
            j.name("fluidPipe").beginObject();
            j.name("capacityPerSecond").value(p.getCapacity());
            j.name("pipes").value(p.mPipeAmount);
            j.name("maxTemp").value(p.mHeatResistance);
            j.name("gasProof").value(p.mGasProof);
            j.name("material").value(materialName(p.mMaterial));
            j.endObject();
        } else if (m instanceof MTEItemPipe) {
            MTEItemPipe p = (MTEItemPipe) m;
            j.name("itemPipe").beginObject();
            j.name("slots").value(p.getPipeCapacity());
            j.name("tickTime").value(p.mTickTime);
            j.name("stepSize").value(p.mStepSize);
            j.name("restrictive").value(p.mIsRestrictive);
            j.name("material").value(materialName(p.mMaterial));
            j.endObject();
        }
        // the slot count the constructor sized the inventory with (the base class's maxEUStore() is V × 64 × slots);
        // mBatteryCount counts the batteries a placed buffer holds, 0 on a prototype
        if (m instanceof MTEBasicBatteryBuffer) j.name("batterySlots").value(((MTEBasicBatteryBuffer) m).mInventory.length);
        if (m instanceof MTEBoilerSolar) j.name("steamPerSecondMax").value(((MTEBoilerSolar) m).getMaxOutputPerSecond());
        if (m instanceof MTESteamTurbine && steam != null) {
            MTESteamTurbine t = (MTESteamTurbine) m;
            int litres = t.consumedFluidPerOperation(steam);
            // EU per litre of steam: 3 EU per 6 + tier litres (3/7 at LV)
            if (litres > 0) j.name("turbineEfficiency").value(t.getFuelValue(steam) / (double) litres);
        }
    }

    private static String materialName(Materials material) {
        return material == null ? null : material.mName;
    }
}
