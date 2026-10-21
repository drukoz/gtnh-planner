package io.github.drukoz.gtnhplanner.export.sections;

import java.lang.reflect.Field;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.HashMap;
import java.util.IdentityHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.TimeUnit;

import net.minecraft.init.Blocks;
import net.minecraft.tileentity.TileEntity;
import net.minecraft.world.World;

import com.gtnewhorizon.structurelib.StructureLibAPI;
import com.gtnewhorizon.structurelib.alignment.constructable.IConstructable;
import com.gtnewhorizon.structurelib.structure.StructureDefinition;

import gregtech.api.GregTechAPI;
import gregtech.api.interfaces.metatileentity.IMetaTileEntity;
import gregtech.api.interfaces.tileentity.IGregTechTileEntity;
import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import io.github.drukoz.gtnhplanner.export.ExportContext;

/**
 * The hatch probe of the structures section (exporter 0.6.0, architecture §11.49, gt-mechanics.md §5.5): asks a
 * built multiblock's own controller which hatch kinds each element of its structure takes. It runs the controller's
 * {@code checkStructure} once with StructureLib's instrument on ({@link StructureVisits}) to learn which element
 * checks each recorded block, then, for each element, stands the probe hatch of every kind ({@link HatchKinds}) on
 * one of the element's blocks in turn, runs the check again and keeps the kinds GT took ({@link HatchLists#taken}).
 * The cell gets its own block back after every probe, and GT's check is walked once more after each element: a
 * machine whose walk then groups its blocks differently gets no rules, as does one whose probe throws outside a
 * single check, one whose check reaches no cell, one with a class whose fields cannot be read, one that is no
 * {@code MTEMultiBlockBase} and every machine after the probe's own time budget is used up. A check that throws
 * counts as "not taken". All of it is summed up in the {@code structures:} warnings of {@link #summarize}. Runs on
 * the server thread, on the structures the section built in its export world.
 */
final class HatchProbe {

    /** The probe's own time budget in seconds, counted from the first {@link #probe}; and its default. */
    static final String BUDGET_PROPERTY = "gtnhplanner.hatchProbeBudgetSeconds";
    static final int DEFAULT_BUDGET_SECONDS = 120;

    /** One probed structure's hatch rules, as its structure line carries them. */
    static final class Result {

        /** In the order of their first block. */
        final List<ElementLine> elements;
        /** Per recorded block, the index of its element; −1 for the controller, unreached and conflicting blocks. */
        final int[] elementOf;

        Result(List<ElementLine> elements, int[] elementOf) {
            this.elements = elements;
            this.elementOf = elementOf;
        }
    }

    private final World world;
    /** The probed kinds, in the order of {@link HatchKinds#ALL}, and the MTE id of each one's probe hatch. */
    private final String[] kindNames;
    private final int[] kindIds;
    private final long budgetNanos;
    /** GT's private {@code MTEMultiBlockBase.structureErrors}; null when it cannot be read, for the reason below. */
    private final Field structureErrorsField;
    private final String structureErrorsMissing;

    private boolean started;
    private long deadline;
    private boolean failedLast;
    private int probed;
    /** Multiblocks the probe ran GT's check on, every {@code checkStructure} run and the time of all probes. */
    private int walked;
    private long checks;
    private long nanos;

    private final Tally notMultiBlockBase = new Tally();
    private final Tally truncated = new Tally();
    private final Tally noCell = new Tally();
    private final Tally conflicts = new Tally();
    private final Tally unreached = new Tally();
    private final Tally threw = new Tally();
    private final Tally failed = new Tally();
    private final Tally overBudget = new Tally();

    /**
     * @param kinds       kind name → MTE id of its probe hatch ({@link HatchKinds#representatives}); probed in the
     *                    order of {@link HatchKinds#ALL}, whatever the map's order
     * @param budgetNanos the time all probes together may take, from the first {@link #probe} on
     */
    HatchProbe(World world, Map<String, Integer> kinds, long budgetNanos) {
        this.world = world;
        this.budgetNanos = budgetNanos;
        List<HatchKinds.Kind> present = new ArrayList<>();
        for (HatchKinds.Kind kind : HatchKinds.ALL) {
            if (kinds.get(kind.name) != null) present.add(kind);
        }
        kindNames = new String[present.size()];
        kindIds = new int[present.size()];
        for (int k = 0; k < kindNames.length; k++) {
            kindNames[k] = present.get(k).name;
            kindIds[k] = kinds.get(kindNames[k]);
        }
        Field errors;
        String missing = null;
        try {
            errors = MTEMultiBlockBase.class.getDeclaredField("structureErrors");
            errors.setAccessible(true);
        } catch (ReflectiveOperationException | RuntimeException | LinkageError e) {
            errors = null;
            missing = "MTEMultiBlockBase.structureErrors cannot be read here: " + e;
        }
        structureErrorsField = errors;
        structureErrorsMissing = missing;
    }

    /**
     * The hatch rules of one built, untruncated multiblock, whose recorded blocks are {@code blocks} (the controller
     * among them); null when the machine gets no rules, with the reason kept for {@link #summarize}. Every cell holds
     * its own block again when this returns, unless {@link #failedLast()} says otherwise.
     */
    Result probe(int id, IConstructable machine, List<StructuresSection.Placed> blocks) {
        long start = System.nanoTime();
        if (!started) {
            started = true;
            deadline = start + budgetNanos;
        }
        failedLast = false;
        try {
            return probeOnce(id, machine, blocks);
        } finally {
            nanos += System.nanoTime() - start;
        }
    }

    /** A truncated structure: not probed, only counted. */
    Result skip(int id) {
        failedLast = false;
        truncated.add(id);
        return null;
    }

    /**
     * Whether the last {@link #probe} failed after it had touched the world: it threw outside a single check, or GT's
     * check walked differently after an element. Its cells may then hold something else than their recorded blocks.
     */
    boolean failedLast() {
        return failedLast;
    }

    /** Multiblocks probed so far that got hatch rules. */
    int probed() {
        return probed;
    }

    /** One warning per kind of skipped or odd multiblock, then the probe's cost as a log line. */
    void summarize(ExportContext ctx) {
        if (!notMultiBlockBase.ids.isEmpty()) {
            ctx.warn("structures: hatch probe skipped for " + notMultiBlockBase.ids.size()
                + " multiblocks whose controller is not an MTEMultiBlockBase: " + ids(notMultiBlockBase));
        }
        if (!truncated.ids.isEmpty()) {
            ctx.warn("structures: hatch probe skipped for " + truncated.ids.size() + " truncated structures: "
                + ids(truncated));
        }
        if (!noCell.ids.isEmpty()) {
            ctx.warn("structures: GT's structure check of " + noCell.ids.size()
                + " multiblocks reached no cell, no hatch rules: " + ids(noCell));
        }
        if (!conflicts.ids.isEmpty()) {
            ctx.warn("structures: " + conflicts.count + " cells of " + conflicts.ids.size()
                + " multiblocks were checked by two elements and take no hatch: " + ids(conflicts));
        }
        if (!unreached.ids.isEmpty()) {
            ctx.warn("structures: " + unreached.count + " cells of " + unreached.ids.size()
                + " multiblocks were never reached by GT's structure check and take no hatch: " + ids(unreached));
        }
        if (!threw.ids.isEmpty()) {
            ctx.warn("structures: " + threw.count + " hatch probe checks threw and count as not taken, in "
                + threw.ids.size() + " multiblocks: " + ids(threw) + "; first: " + threw.first);
        }
        if (!failed.ids.isEmpty()) {
            ctx.warn("structures: the hatch probe failed for " + failed.ids.size() + " multiblocks, no hatch rules: "
                + ids(failed) + "; first: " + failed.first);
        }
        if (!overBudget.ids.isEmpty()) {
            ctx.warn("structures: hatch probe budget of " + TimeUnit.NANOSECONDS.toSeconds(budgetNanos) + " s ("
                + BUDGET_PROPERTY + ") used up, " + overBudget.ids.size() + " multiblocks without hatch rules: "
                + ids(overBudget));
        }
        ctx.info("structures: hatch probes on " + walked + " multiblocks: " + checks + " checks in "
            + TimeUnit.NANOSECONDS.toMillis(nanos) + " ms");
    }

    private Result probeOnce(int id, IConstructable machine, List<StructuresSection.Placed> blocks) {
        if (!(machine instanceof MTEMultiBlockBase)) {
            notMultiBlockBase.add(id);
            return null;
        }
        MTEMultiBlockBase mb = (MTEMultiBlockBase) machine;
        if (overBudget()) {
            overBudget.add(id);
            return null;
        }
        // nothing in the world is touched for these two: no rules rather than partial ones
        String unreadable = HatchLists.unreadableClass(mb);
        if (unreadable != null) {
            failed.add(id, "fields of " + unreadable + " cannot be read here");
            return null;
        }
        if (structureErrorsField == null) {
            failed.add(id, structureErrorsMissing);
            return null;
        }
        walked++;
        try {
            return probeElements(id, machine, mb, blocks);
        } catch (Throwable t) { // the baseline check, grouping, a restore, a re-walk
            failedLast = true;
            failed.add(id, t.toString());
            return null;
        }
    }

    private Result probeElements(int id, IConstructable machine, MTEMultiBlockBase mb,
        List<StructuresSection.Placed> blocks) {
        IGregTechTileEntity base = mb.getBaseMetaTileEntity();
        int controller = controllerIndex(id, blocks);
        Map<Long, Integer> blockAt = new HashMap<>(blocks.size() * 2);
        for (int b = 0; b < blocks.size(); b++) {
            int[] p = blocks.get(b).pos;
            blockAt.put(ElementGroups.key(p[0], p[1], p[2]), b);
        }

        ElementGroups.Visits visits = walk(mb, base, blockAt, blocks.size());
        List<ElementGroups.Group> groups = ElementGroups.groups(visits, controller);
        // no element owns a cell (visits.visited() == 0 among them): an empty element list would say "takes no hatch"
        if (groups.isEmpty()) {
            noCell.add(id);
            return null;
        }
        if (visits.conflicts() > 0) conflicts.add(id, visits.conflicts(), null);
        int never = 0;
        for (int b = 0; b < blocks.size(); b++) {
            if (b != controller && !visits.visited(b)) never++;
        }
        if (never > 0) unreached.add(id, never, null);

        Map<Object, Character> chars = characters(machine);
        boolean[] tile = new boolean[blocks.size()];
        for (int b = 0; b < tile.length; b++) tile[b] = blocks.get(b).tile;
        List<ElementLine> elements = new ArrayList<>(groups.size());
        int[] elementOf = new int[blocks.size()];
        Arrays.fill(elementOf, -1);
        for (int k = 0; k < groups.size(); k++) {
            ElementGroups.Group group = groups.get(k);
            StructuresSection.Placed cell = blocks.get(ElementGroups.probeBlock(group, tile));
            List<String> takes = new ArrayList<>();
            for (int h = 0; h < kindIds.length; h++) {
                // the cell holds its own block again (every probe restores it); this machine and every later one
                // get no rules
                if (overBudget()) {
                    overBudget.add(id);
                    return null;
                }
                try {
                    IMetaTileEntity hatch = placeMachine(cell.pos, kindIds[h]);
                    check(mb, base);
                    if (HatchLists.taken(mb, hatch, hatch.getBaseMetaTileEntity(), HatchLists.EXCLUDED,
                        structureErrors(mb), cell.pos[0], cell.pos[1], cell.pos[2])) {
                        takes.add(kindNames[h]);
                    }
                } catch (Throwable t) {
                    threw.add(id, 1, id + " " + kindNames[h] + ": " + t);
                } finally {
                    restore(cell);
                }
            }
            // a restore that did not give the cell back would change the walk
            if (!ElementGroups.sameGroups(groups, ElementGroups.groups(walk(mb, base, blockAt, blocks.size()),
                controller))) {
                failedLast = true;
                failed.add(id, "GT's check walked differently after probing element " + k);
                return null;
            }
            Character ch = chars.get(group.element);
            elements.add(new ElementLine(ch == null ? null : String.valueOf(ch.charValue()), takes));
            for (int b : group.blocks) elementOf[b] = k;
        }
        probed++;
        return new Result(elements, elementOf);
    }

    /** Runs GT's check of {@code mb} with the instrument on and returns which element checked which block. */
    private ElementGroups.Visits walk(MTEMultiBlockBase mb, IGregTechTileEntity base, Map<Long, Integer> blockAt,
        int blocks) {
        ElementGroups.Visits visits = new ElementGroups.Visits(blocks);
        StructureVisits.INSTANCE.start(world, blockAt, visits);
        try {
            StructureLibAPI.enableInstrument(StructureVisits.TOKEN);
            try {
                check(mb, base);
            } finally {
                StructureLibAPI.disableInstrument();
            }
        } finally {
            StructureVisits.INSTANCE.stop();
        }
        return visits;
    }

    private void check(MTEMultiBlockBase mb, IGregTechTileEntity base) {
        checks++;
        mb.checkStructure(true, base);
    }

    /** The list GT's last check of {@code mb} left in its private {@code MTEMultiBlockBase.structureErrors}. */
    private List<?> structureErrors(MTEMultiBlockBase mb) throws IllegalAccessException {
        return (List<?>) structureErrorsField.get(mb);
    }

    /**
     * Places a fresh GT machine {@code id} (default facing, no owner) in the cell and returns it. Air first:
     * {@code World.setBlock} with the block and meta already there changes nothing and would leave the old tile
     * entity.
     */
    private IMetaTileEntity placeMachine(int[] pos, int id) {
        int x = pos[0], y = pos[1], z = pos[2];
        world.setBlock(x, y, z, Blocks.air, 0, 2);
        IMetaTileEntity prototype = GregTechAPI.METATILEENTITIES[id];
        if (!world.setBlock(x, y, z, GregTechAPI.sBlockMachines, prototype.getTileEntityBaseType(), 2)) {
            throw new IllegalStateException("GT machine " + id + " was not placed at " + Arrays.toString(pos));
        }
        TileEntity te = world.getTileEntity(x, y, z);
        if (!(te instanceof IGregTechTileEntity)) {
            throw new IllegalStateException("no GT tile entity at " + Arrays.toString(pos) + ": " + te);
        }
        IGregTechTileEntity gt = (IGregTechTileEntity) te;
        gt.setInitialValuesAsNBT(null, (short) id);
        IMetaTileEntity placed = gt.getMetaTileEntity();
        if (placed == null) {
            throw new IllegalStateException("GT machine " + id + " has no meta tile entity at " + Arrays.toString(pos));
        }
        return placed;
    }

    /**
     * Gives the cell its recorded block back, air first: a GT machine through {@link #placeMachine}, any other block
     * with its meta. A tile entity comes back in its default state, which is why a group is probed on a block that
     * held none when one exists. Throws when the cell does not hold the recorded block and meta afterwards.
     */
    private void restore(StructuresSection.Placed cell) {
        int x = cell.pos[0], y = cell.pos[1], z = cell.pos[2];
        if (cell.mte != null) {
            placeMachine(cell.pos, cell.mte);
        } else {
            world.setBlock(x, y, z, Blocks.air, 0, 2);
            world.setBlock(x, y, z, cell.block, cell.meta, 2);
        }
        if (world.getBlock(x, y, z) != cell.block || world.getBlockMetadata(x, y, z) != cell.meta) {
            throw new IllegalStateException("the cell at " + Arrays.toString(cell.pos) + " was not restored");
        }
    }

    /** Whether the probe's own budget is used up (nanoTime differences, which survive an overflow). */
    private boolean overBudget() {
        return System.nanoTime() - deadline > 0;
    }

    /** The index of the controller's block: the one recorded block that holds machine {@code id}. */
    private static int controllerIndex(int id, List<StructuresSection.Placed> blocks) {
        int found = -1;
        for (int b = 0; b < blocks.size(); b++) {
            Integer mte = blocks.get(b).mte;
            if (mte == null || mte != id) continue;
            if (found >= 0) throw new IllegalStateException("two recorded blocks hold machine " + id);
            found = b;
        }
        if (found < 0) throw new IllegalStateException("no recorded block holds machine " + id);
        return found;
    }

    /**
     * Each element of the machine's {@link StructureDefinition}, by identity, with the smallest character the
     * definition maps to it, so that no hash order reaches the export; empty for any other definition.
     */
    private static Map<Object, Character> characters(IConstructable machine) {
        Map<Object, Character> chars = new IdentityHashMap<>();
        Object definition = machine.getStructureDefinition();
        if (!(definition instanceof StructureDefinition)) return chars;
        for (Map.Entry<Character, ?> e : ((StructureDefinition<?>) definition).getElements().entrySet()) {
            Character ch = e.getKey();
            Object element = e.getValue();
            if (ch == null || element == null) continue;
            Character seen = chars.get(element);
            if (seen == null || ch < seen) chars.put(element, ch);
        }
        return chars;
    }

    private static String ids(Tally tally) {
        return StructuresSection.listIds(tally.ids);
    }

    /**
     * The multiblocks of one summary warning (each once, in probe order), what they add up to (cells or checks) and
     * the first one's message.
     */
    private static final class Tally {

        final List<Integer> ids = new ArrayList<>();
        long count;
        String first;

        void add(int id) {
            add(id, 1, null);
        }

        /** {@code message} is kept as {@code "<id>: <message>"} when it is the first. */
        void add(int id, String message) {
            add(id, 1, id + ": " + message);
        }

        void add(int id, long n, String firstMessage) {
            if (ids.isEmpty() || ids.get(ids.size() - 1) != id) ids.add(id);
            count += n;
            if (first == null) first = firstMessage;
        }
    }
}
