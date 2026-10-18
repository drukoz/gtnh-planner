package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;

import net.minecraftforge.fluids.Fluid;
import net.minecraftforge.fluids.FluidContainerRegistry;
import net.minecraftforge.fluids.FluidRegistry;
import net.minecraftforge.fluids.FluidStack;

import com.google.gson.stream.JsonWriter;

import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.ItemTable;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;

/** {@code fluids}: every registered Forge fluid; {@code fluidContainers}: every filled/empty container mapping. */
public final class FluidsSection implements ExportSection {

    @Override
    public String name() {
        return "fluids";
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        writeFluids(ctx);
        writeContainers(ctx);
    }

    private static void writeFluids(ExportContext ctx) throws IOException {
        try (JsonlWriter w = ctx.jsonl("fluids")) {
            for (Fluid f : FluidRegistry.getRegisteredFluids().values()) {
                try {
                    String dn;
                    try {
                        dn = f.getLocalizedName(new FluidStack(f, 1000));
                    } catch (Throwable t) {
                        dn = null;
                    }
                    JsonWriter j = w.begin();
                    j.beginObject();
                    j.name("id").value(f.getName());
                    j.name("nid").value(f.getID());
                    j.name("un").value(f.getUnlocalizedName());
                    j.name("dn").value(dn);
                    j.name("temp").value(f.getTemperature());
                    j.name("gas").value(f.isGaseous());
                    j.name("density").value(f.getDensity());
                    j.endObject();
                    w.end();
                } catch (Throwable t) {
                    ctx.warn("fluid " + fluidName(f) + ": " + t);
                }
            }
        }
    }

    private static void writeContainers(ExportContext ctx) throws IOException {
        ItemTable items = ctx.items();
        try (JsonlWriter w = ctx.jsonl("fluidContainers")) {
            for (FluidContainerRegistry.FluidContainerData d : FluidContainerRegistry
                .getRegisteredFluidContainerData()) {
                try {
                    if (d == null || d.fluid == null || d.fluid.getFluid() == null) continue;
                    int container = items.intern(d.filledContainer);
                    Integer empty = d.emptyContainer != null ? items.intern(d.emptyContainer) : null;
                    JsonWriter j = w.begin();
                    j.beginObject();
                    j.name("container").value(container);
                    j.name("empty").value(empty);
                    j.name("fluid").value(d.fluid.getFluid().getName());
                    j.name("amount").value(d.fluid.amount);
                    j.endObject();
                    w.end();
                } catch (Throwable t) {
                    ctx.warn("fluid container " + (d != null && d.fluid != null ? fluidName(d.fluid.getFluid()) : "?")
                        + ": " + t);
                }
            }
        }
    }

    private static String fluidName(Fluid f) {
        try {
            return f != null ? f.getName() : "null";
        } catch (Throwable t) {
            return "?";
        }
    }
}
