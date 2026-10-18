package io.github.drukoz.gtnhplanner.export;

import java.io.File;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

import io.github.drukoz.gtnhplanner.export.sections.AssemblyLineSection;
import io.github.drukoz.gtnhplanner.export.sections.CraftingSection;
import io.github.drukoz.gtnhplanner.export.sections.FluidsSection;
import io.github.drukoz.gtnhplanner.export.sections.FurnaceSection;
import io.github.drukoz.gtnhplanner.export.sections.MachinesSection;
import io.github.drukoz.gtnhplanner.export.sections.OreDictSection;
import io.github.drukoz.gtnhplanner.export.sections.RecipeMapsSection;
import io.github.drukoz.gtnhplanner.export.sections.StructuresSection;

/**
 * Runs every {@link ExportSection} in order, then writes {@code items.jsonl.gz} and {@code manifest.json}. The wire
 * format is {@code src/server/pack/format.ts} (format {@value Manifest#FORMAT}); file names come from
 * {@link ExportFiles}. The markers are written afterwards by {@link ExportTrigger}.
 *
 * <p>
 * Rules every section must follow (the contract with the loader, format.ts):
 * <table border="1">
 * <caption>Export rules</caption>
 * <tr><th>Rule</th><th>Meaning</th></tr>
 * <tr><td>Item index</td><td>{@code i} = 0-based line position in {@code items.jsonl.gz}; every index used in any
 * file exists there</td></tr>
 * <tr><td>{@code m == 32767}</td><td>wildcard (only from ore-dictionary lists or recipe stacks with wildcard damage);
 * never a real variant</td></tr>
 * <tr><td>Item slot</td><td>{@code null} keeps the slot position; amount {@code 0} = not consumed; chance on GT's
 * 1/10000 scale, omitted when 10000</td></tr>
 * <tr><td>Fluid slot</td><td>litres; chance as for items</td></tr>
 * <tr><td>{@code inAlt[i]}, {@code finAlt[i]}</td><td>alternatives for slot {@code i} of {@code in}/{@code fin};
 * {@code null} or {@code []} = none</td></tr>
 * <tr><td>{@code meta}</td><td>every GT metadata entry by identifier; {@code ItemStack} values as
 * {@code { "item": index }}, other non-primitive values as {@code String.valueOf}</td></tr>
 * <tr><td>Dimension names</td><td>GT ore-gen names exactly as GT stores them ({@code Overworld}, {@code The End},
 * {@code EndAsteroid}, {@code moon}, {@code Underdark}); the loader normalizes</td></tr>
 * <tr><td>Material keys</td><td>{@code gt:} / {@code bw:} / {@code gtpp:} +
 * {@code IOreMaterial.getInternalName()}</td></tr>
 * <tr><td>Structure coordinates</td><td>canonical orientation (controller front faces north, &minus;z); x east, y up,
 * z south; origin = min corner of blocks &cup; air cells, so every coordinate is &ge; 0</td></tr>
 * <tr><td>Furnace {@code ef} / {@code mw}</td><td>output GT's own electric furnace / microwave lookup returned for
 * that input; {@code mw} is omitted when the microwave would explode, burn or reject it</td></tr>
 * <tr><td>Item {@code electric}</td><td>only for a non-wildcard item that is an IC2 {@code IElectricItem} with a
 * finite {@code maxCharge} &gt; 0</td></tr>
 * <tr><td>Markers</td><td>{@code EXPORT_OK} or {@code EXPORT_FAILED} is written after every other file is
 * closed</td></tr>
 * </table>
 */
public final class Exporter {

    private final File dir;

    public Exporter(File dir) {
        this.dir = dir;
    }

    /**
     * Every section, in run order. New sections are appended here; the texture export, an optional section, stays
     * last.
     */
    public static List<ExportSection> sections() {
        List<ExportSection> sections = new ArrayList<>();
        sections.add(new FluidsSection());
        sections.add(new OreDictSection());
        sections.add(new RecipeMapsSection());
        sections.add(new AssemblyLineSection());
        sections.add(new CraftingSection());
        sections.add(new FurnaceSection());
        sections.add(new MachinesSection());
        sections.add(new StructuresSection());
        return sections;
    }

    /**
     * Seeds the item table, runs every section not named in {@code -Dgtnhplanner.skipSections}, then writes the items
     * and the manifest. A required section that throws aborts the export with that error; an optional one is
     * recorded in {@code failedSections} with a warning.
     */
    public void runAll() throws Exception {
        ExportContext ctx = new ExportContext(dir);
        Set<String> skip = skipSections();
        Map<String, Long> sectionMillis = new LinkedHashMap<>();
        List<String> failedSections = new ArrayList<>();
        List<String> skippedSections = new ArrayList<>();

        long start = System.nanoTime();
        ctx.items().seed();
        ExporterMod.LOG.info("seeded {} items in {} ms", ctx.items().size(), millisSince(start));

        List<ExportSection> sections = sections();
        Set<String> known = new LinkedHashSet<>();
        for (ExportSection section : sections) known.add(section.name());
        for (String name : skip) {
            if (!known.contains(name)) ctx.warn("skipSections: no section named " + name);
        }

        for (ExportSection section : sections) {
            String name = section.name();
            if (skip.contains(name)) {
                skippedSections.add(name);
                ExporterMod.LOG.info("section {} skipped", name);
                continue;
            }
            long t0 = System.nanoTime();
            try {
                section.export(ctx);
            } catch (Throwable t) {
                if (!section.optional()) {
                    ExporterMod.LOG.error("required section " + name + " failed", t);
                    throw t;
                }
                failedSections.add(name);
                ctx.warn("section " + name + " failed: " + t);
            } finally {
                sectionMillis.put(name, millisSince(t0));
            }
            ExporterMod.LOG.info("section {} done in {} ms", name, sectionMillis.get(name));
        }

        start = System.nanoTime();
        ctx.items().write(ctx);
        ExporterMod.LOG.info("wrote {} items in {} ms", ctx.items().size(), millisSince(start));
        Manifest.write(ctx, sectionMillis, failedSections, skippedSections);
        ExporterMod.LOG.info(
            "export written to {}: {} warnings, {} name failures",
            dir,
            ctx.warningTotal(),
            ctx.names().failures());
    }

    private static Set<String> skipSections() {
        Set<String> names = new LinkedHashSet<>();
        for (String name : System.getProperty("gtnhplanner.skipSections", "").split(",")) {
            if (!name.trim().isEmpty()) names.add(name.trim());
        }
        return names;
    }

    private static long millisSince(long nanoStart) {
        return (System.nanoTime() - nanoStart) / 1_000_000L;
    }
}
