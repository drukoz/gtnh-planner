package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;
import java.lang.reflect.Field;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.BitSet;
import java.util.Collection;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.TimeUnit;

import net.minecraft.block.Block;
import net.minecraft.init.Blocks;
import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.server.MinecraftServer;
import net.minecraft.tileentity.TileEntity;
import net.minecraft.world.World;
import net.minecraft.world.chunk.IChunkProvider;
import net.minecraft.world.chunk.storage.ExtendedBlockStorage;
import net.minecraftforge.common.util.ForgeDirection;

import com.google.gson.stream.JsonWriter;
import com.gtnewhorizon.structurelib.StructureLibAPI;
import com.gtnewhorizon.structurelib.alignment.IAlignment;
import com.gtnewhorizon.structurelib.alignment.constructable.IConstructable;
import com.gtnewhorizon.structurelib.alignment.enumerable.ExtendedFacing;
import com.gtnewhorizon.structurelib.structure.StructureDefinition;
import com.gtnewhorizon.structurelib.util.Vec3Impl;

import cpw.mods.fml.common.registry.GameData;
import gregtech.api.GregTechAPI;
import gregtech.api.interfaces.metatileentity.IMetaTileEntity;
import gregtech.api.interfaces.tileentity.IGregTechTileEntity;
import gregtech.api.metatileentity.MetaPipeEntity;
import gregtech.api.metatileentity.implementations.MTEHatch;
import gregtech.api.metatileentity.implementations.MTEMultiBlockBase;
import io.github.drukoz.gtnhplanner.export.ExportContext;
import io.github.drukoz.gtnhplanner.export.ExportSection;
import io.github.drukoz.gtnhplanner.export.JsonlWriter;

/**
 * {@code structures}: the blocks of every multiblock (machine kind {@code multiblock}: an {@link MTEMultiBlockBase} or
 * a StructureLib {@link IConstructable}) whose structure could be built, one line each (gt-mechanics.md §5.1–§5.3).
 * Each controller is placed at {@code C} in the export world (the clone's flat {@code export-world}), front facing
 * north, exactly as GT's {@code ItemMachines.placeBlockAt} places it; {@code construct(hologram × 1, false)} builds the
 * smallest variant, the way the hologram projector does; every non-air block in the scan box around {@code C} is
 * recorded. The cells of the {@code "main"} piece that must stay air come from StructureLib's private
 * {@code occupiedSpaces}. Then {@link HatchProbe} asks the controller's own structure check which hatch kinds each
 * element of the structure takes (exporter 0.6.0, gt-mechanics.md §5.5); its answers are the line's
 * {@code elements} and {@code elementOf}, and {@code counts.hatchRules} is the number of lines with them.
 * Coordinates are written in the canonical frame of the wire format (controller front faces north, origin = min
 * corner of blocks &cup; air). Everything placed is cleared again before the next machine. Optional: if the section
 * fails, the export goes on without structures.
 */
public final class StructuresSection implements ExportSection {

    /** The controller cell {@code C}: far from spawn and above the flat ground. */
    private static final int CX = 8192, CY = 128, CZ = 8192;

    /** The scan box: x and z within {@code C ± 64}, y from 64 to 224. */
    private static final Box BOX = new Box(CX - 64, 64, CZ - 64, CX + 64, 224, CZ + 64);

    /** How far beyond the scan box a truncated structure is cleared. */
    private static final int TRUNCATED_CLEAR_MARGIN = 96;

    /**
     * Chunks loaded around the scan box before the first build. World generation decorates a chunk only once its
     * neighbours exist, so after this nothing generated can appear in the box any more.
     */
    private static final int PRELOAD_MARGIN_CHUNKS = 2;

    private static final String MAIN_PIECE = "main";

    /**
     * The owner every controller gets, as a player's would on placement: a multiblock's {@code onRemoval} looks up
     * its owner's team (GT's powerfail tracker) and throws for a machine without an owner UUID.
     */
    private static final String OWNER_NAME = "gtnhplannerexport";
    private static final UUID OWNER_UUID = UUID.nameUUIDFromBytes(OWNER_NAME.getBytes(StandardCharsets.UTF_8));

    /** A {@code "main"} piece with more cells than this gets no air cells (the fit is quadratic). */
    private static final int MAX_PIECE_CELLS = 4096;

    private static final String BUDGET_PROPERTY = "gtnhplanner.structureBudgetSeconds";
    private static final int DEFAULT_BUDGET_SECONDS = 300;

    /** How many machine ids a summary warning lists. */
    private static final int LISTED_IDS = 20;

    @Override
    public String name() {
        return "structures";
    }

    @Override
    public boolean optional() {
        return true;
    }

    @Override
    public void export(ExportContext ctx) throws IOException {
        long start = System.nanoTime();
        int budgetSeconds = Integer.getInteger(BUDGET_PROPERTY, DEFAULT_BUDGET_SECONDS);
        long budgetNanos = TimeUnit.SECONDS.toNanos(budgetSeconds);
        World world = MinecraftServer.getServer().worldServerForDimension(0);
        Item hologram = StructureLibAPI.getDefaultHologramItem();
        if (hologram == null) throw new IllegalStateException("StructureLib has no hologram item");
        Field occupiedSpaces = occupiedSpacesField(ctx);

        List<Integer> ids = new ArrayList<>();
        List<Integer> notConstructable = new ArrayList<>();
        multiblocks(ids, notConstructable);
        if (!notConstructable.isEmpty()) {
            ctx.warn("structures: " + notConstructable.size() + " multiblocks are not IConstructable and get no structure: "
                + listIds(notConstructable));
        }
        Map<String, Integer> kinds = HatchKinds.representatives(hatches());
        for (HatchKinds.Kind kind : HatchKinds.ALL) {
            if (!kinds.containsKey(kind.name)) {
                ctx.warn("structures: no hatch of class " + kind.cls + " in this pack, hatch kind " + kind.name
                    + " not probed");
            }
        }
        int probeSeconds = Integer.getInteger(HatchProbe.BUDGET_PROPERTY, HatchProbe.DEFAULT_BUDGET_SECONDS);
        HatchProbe probe = new HatchProbe(world, kinds, TimeUnit.SECONDS.toNanos(probeSeconds));

        prepareArea(world, ctx);
        try {
            try (JsonlWriter w = ctx.jsonl("structures")) {
                for (int k = 0; k < ids.size(); k++) {
                    if (System.nanoTime() - start > budgetNanos) {
                        List<Integer> rest = ids.subList(k, ids.size());
                        ctx.warn("structures: time budget of " + budgetSeconds + " s (" + BUDGET_PROPERTY
                            + ") used up, " + rest.size() + " multiblocks not built: " + listIds(rest));
                        break;
                    }
                    build(world, ids.get(k), hologram, occupiedSpaces, probe, w, ctx);
                }
            }
        } finally { // the lines written so far, also when a scan box could not be emptied and the section fails
            ctx.count("hatchRules", probe.probed());
            probe.summarize(ctx);
        }
    }

    /**
     * Machine ids of kind {@code multiblock} as MachinesSection decides it (pipes are checked first there), split into
     * those StructureLib can build and those it cannot.
     */
    private static void multiblocks(List<Integer> constructable, List<Integer> notConstructable) {
        IMetaTileEntity[] all = GregTechAPI.METATILEENTITIES;
        for (int id = 0; id < all.length; id++) {
            IMetaTileEntity m = all[id];
            if (m == null || m instanceof MetaPipeEntity) continue;
            if (m instanceof IConstructable) constructable.add(id);
            else if (m instanceof MTEMultiBlockBase) notConstructable.add(id);
        }
    }

    /** Every GT hatch of the pack, in id order: the candidates for the probe hatches of {@link HatchKinds}. */
    private static List<HatchKinds.Candidate> hatches() {
        List<HatchKinds.Candidate> hatches = new ArrayList<>();
        IMetaTileEntity[] all = GregTechAPI.METATILEENTITIES;
        for (int id = 0; id < all.length; id++) {
            IMetaTileEntity m = all[id];
            if (m instanceof MTEHatch) {
                hatches.add(new HatchKinds.Candidate(id, m.getClass().getSimpleName(), m.getMetaName()));
            }
        }
        return hatches;
    }

    /** StructureLib's private per-piece cell sets; {@code null} with one warning when they cannot be read. */
    private static Field occupiedSpacesField(ExportContext ctx) {
        try {
            Field f = StructureDefinition.class.getDeclaredField("occupiedSpaces");
            f.setAccessible(true);
            return f;
        } catch (Throwable t) {
            ctx.warn("structures: StructureDefinition.occupiedSpaces unavailable, no air cells: " + t);
            return null;
        }
    }

    /**
     * Loads the chunks of the scan box plus {@link #PRELOAD_MARGIN_CHUNKS} (StructureLib skips cells in chunks that are
     * not loaded), then clears whatever the box already holds: a leftover of an earlier run or something world
     * generation put there.
     */
    private static void prepareArea(World world, ExportContext ctx) {
        IChunkProvider chunks = world.getChunkProvider();
        int m = PRELOAD_MARGIN_CHUNKS;
        for (int cx = (BOX.minX >> 4) - m; cx <= (BOX.maxX >> 4) + m; cx++) {
            for (int cz = (BOX.minZ >> 4) - m; cz <= (BOX.maxZ >> 4) + m; cz++) chunks.loadChunk(cx, cz);
        }
        List<int[]> leftovers = nonAir(world, BOX);
        if (!leftovers.isEmpty()) {
            ctx.warn("structures: cleared " + leftovers.size() + " blocks from the scan box before the first build");
            clear(world, leftovers);
        }
    }

    /**
     * Builds one machine, probes its hatch rules, writes its line and clears everything it placed. A failure for this
     * machine is a warning; only a scan box that cannot be emptied again throws, because its blocks would end up in
     * every later structure.
     */
    private static void build(World world, int id, Item hologram, Field occupiedSpaces, HatchProbe probe,
        JsonlWriter w, ExportContext ctx) {
        List<Placed> blocks = null;
        boolean truncated = false;
        boolean failed = false;
        try {
            IConstructable machine = placeController(world, id);
            machine.construct(new ItemStack(hologram, 1), false);
            blocks = record(world);
            if (blocks.size() < 2) throw new IllegalStateException("construct placed no blocks");
            for (Placed b : blocks) truncated |= BOX.onBoundary(b.pos);
            List<int[]> air;
            try {
                air = airCells(world, id, machine, blocks, occupiedSpaces, ctx);
            } catch (Throwable t) {
                ctx.warn("structure " + id + ": no air cells: " + t);
                air = new ArrayList<>();
            }
            HatchProbe.Result rules = truncated ? probe.skip(id) : probe.probe(id, machine, blocks);
            write(w, id, blocks, air, truncated, rules);
        } catch (Throwable t) {
            failed = true;
            ctx.warn("structure " + id + ": " + t);
        }
        List<int[]> placed;
        if (truncated) placed = nonAir(world, BOX.widen(TRUNCATED_CLEAR_MARGIN));
        else if (failed || probe.failedLast()) placed = nonAir(world, BOX); // the probe may have left a cell changed
        else placed = positions(blocks);
        clear(world, placed);
    }

    /**
     * Places the controller as {@code ItemMachines.placeBlockAt} does, owner included, and turns it to face north.
     * Throws unless the machine is buildable and really sits in the canonical orientation.
     */
    private static IConstructable placeController(World world, int id) {
        IMetaTileEntity prototype = GregTechAPI.METATILEENTITIES[id];
        if (!world.setBlock(CX, CY, CZ, GregTechAPI.sBlockMachines, prototype.getTileEntityBaseType(), 3)) {
            throw new IllegalStateException("the controller block was not placed");
        }
        TileEntity te = world.getTileEntity(CX, CY, CZ);
        if (!(te instanceof IGregTechTileEntity)) {
            throw new IllegalStateException("no GT tile entity in the controller cell: " + te);
        }
        IGregTechTileEntity gt = (IGregTechTileEntity) te;
        gt.setInitialValuesAsNBT(null, (short) id);
        gt.setOwnerName(OWNER_NAME);
        gt.setOwnerUuid(OWNER_UUID);
        gt.setFrontFacing(ForgeDirection.NORTH);
        IMetaTileEntity machine = gt.getMetaTileEntity();
        if (!(machine instanceof IConstructable)) {
            throw new IllegalStateException("the placed machine is not IConstructable: " + machine);
        }
        if (gt.getFrontFacing() != ForgeDirection.NORTH) {
            throw new IllegalStateException("the controller refused to face NORTH, it faces " + gt.getFrontFacing());
        }
        if (machine instanceof IAlignment) {
            ExtendedFacing facing = ((IAlignment) machine).getExtendedFacing();
            if (facing != ExtendedFacing.NORTH_NORMAL_NONE) {
                throw new IllegalStateException("the controller's alignment is " + facing + ", not NORTH_NORMAL_NONE");
            }
        }
        return (IConstructable) machine;
    }

    /**
     * Every non-air block in the scan box with its block, registry name, metadata, GT machine id and whether it held a
     * tile entity, in layer order.
     */
    private static List<Placed> record(World world) {
        List<Placed> placed = new ArrayList<>();
        for (int[] p : nonAir(world, BOX)) {
            Block block = world.getBlock(p[0], p[1], p[2]);
            int meta = world.getBlockMetadata(p[0], p[1], p[2]);
            String name = GameData.getBlockRegistry().getNameForObject(block);
            if (name == null) throw new IllegalStateException("unregistered block " + block + " at " + Arrays.toString(p));
            // null for a block without a tile entity; nothing is created for one
            TileEntity te = world.getTileEntity(p[0], p[1], p[2]);
            Integer mte = te instanceof IGregTechTileEntity ? ((IGregTechTileEntity) te).getMetaTileID() : null;
            placed.add(new Placed(p, block, name, meta, mte, te != null));
        }
        placed.sort((a, b) -> layerOrder(a.pos, b.pos));
        return placed;
    }

    /**
     * The cells of the {@code "main"} piece that are air in the world, in layer order; empty (with a warning) when they
     * cannot be found. The controller's cell in the piece is unknown, so every cell {@code c} is tried: the piece is
     * mapped with {@code C + NORTH_NORMAL_NONE.getWorldOffset(p − c)}, and the {@code c} that puts the most cells on
     * recorded blocks wins, if it covers at least half of them.
     */
    private static List<int[]> airCells(World world, int id, IConstructable machine, List<Placed> blocks,
        Field occupiedSpaces, ExportContext ctx) throws IllegalAccessException {
        List<int[]> air = new ArrayList<>();
        if (occupiedSpaces == null) return air; // warned once
        Object definition = machine.getStructureDefinition();
        if (!(definition instanceof StructureDefinition)) {
            ctx.warn("structure " + id + ": no StructureDefinition ("
                + (definition == null ? "null" : definition.getClass().getName()) + "), no air cells");
            return air;
        }
        Object pieces = occupiedSpaces.get(definition);
        Object piece = pieces instanceof Map ? ((Map<?, ?>) pieces).get(MAIN_PIECE) : null;
        if (!(piece instanceof Collection) || ((Collection<?>) piece).isEmpty()) {
            ctx.warn("structure " + id + ": no \"" + MAIN_PIECE + "\" piece, no air cells");
            return air;
        }
        Collection<?> cells = (Collection<?>) piece;
        if (cells.size() > MAX_PIECE_CELLS) {
            ctx.warn("structure " + id + ": the \"" + MAIN_PIECE + "\" piece has " + cells.size() + " cells (more than "
                + MAX_PIECE_CELLS + "), no air cells");
            return air;
        }

        // Sorted (any fixed order), so that a tie between two fits always goes to the same cell: the set is a HashSet.
        int n = cells.size();
        int[][] abc = new int[n][];
        int i = 0;
        for (Object cell : cells) {
            Vec3Impl v = (Vec3Impl) cell;
            abc[i++] = new int[] { v.get0(), v.get1(), v.get2() };
        }
        Arrays.sort(abc, StructuresSection::layerOrder);
        // getWorldOffset is a matrix product (IntegerAxisSwap.inverseTranslate), so offset(p − c) = offset(p) − offset(c).
        int[][] offset = new int[n][3];
        for (i = 0; i < n; i++) ExtendedFacing.NORTH_NORMAL_NONE.getWorldOffset(abc[i], offset[i]);

        BitSet recorded = new BitSet();
        for (Placed b : blocks) recorded.set(BOX.index(b.pos[0], b.pos[1], b.pos[2]));
        int best = 0;
        int bestHits = -1;
        for (int c = 0; c < n; c++) {
            int hits = 0;
            for (int p = 0; p < n; p++) {
                int cell = BOX.index(
                    CX + offset[p][0] - offset[c][0],
                    CY + offset[p][1] - offset[c][1],
                    CZ + offset[p][2] - offset[c][2]);
                if (cell >= 0 && recorded.get(cell)) hits++;
            }
            if (hits > bestHits) {
                bestHits = hits;
                best = c;
            }
        }
        if (2L * bestHits < blocks.size()) {
            ctx.warn("structure " + id + ": the \"" + MAIN_PIECE + "\" piece covers at most " + bestHits + " of "
                + blocks.size() + " blocks, no air cells");
            return air;
        }
        for (int p = 0; p < n; p++) {
            int x = CX + offset[p][0] - offset[best][0];
            int y = CY + offset[p][1] - offset[best][1];
            int z = CZ + offset[p][2] - offset[best][2];
            if (BOX.contains(x, y, z) && world.isAirBlock(x, y, z)) air.add(new int[] { x, y, z });
        }
        air.sort(StructuresSection::layerOrder);
        return air;
    }

    /**
     * One {@code StructureLine}: shifted so that the min corner of blocks &cup; air is the origin; palette entries in
     * first-seen order; the hatch rules after the air cells when the probe gave some ({@code rules} not null).
     */
    private static void write(JsonlWriter w, int id, List<Placed> blocks, List<int[]> air, boolean truncated,
        HatchProbe.Result rules) throws IOException {
        int[] min = { Integer.MAX_VALUE, Integer.MAX_VALUE, Integer.MAX_VALUE };
        int[] max = { Integer.MIN_VALUE, Integer.MIN_VALUE, Integer.MIN_VALUE };
        for (Placed b : blocks) extend(min, max, b.pos);
        for (int[] a : air) extend(min, max, a);

        Map<List<Object>, Integer> paletteIndex = new LinkedHashMap<>();
        List<Placed> palette = new ArrayList<>();
        int[] entry = new int[blocks.size()];
        for (int k = 0; k < blocks.size(); k++) {
            Placed b = blocks.get(k);
            List<Object> key = Arrays.<Object>asList(b.name, b.meta, b.mte);
            Integer index = paletteIndex.get(key);
            if (index == null) {
                index = palette.size();
                paletteIndex.put(key, index);
                palette.add(b);
            }
            entry[k] = index;
        }

        JsonWriter j = w.begin();
        j.beginObject();
        j.name("id").value(id);
        j.name("size");
        triple(j, max[0] - min[0] + 1, max[1] - min[1] + 1, max[2] - min[2] + 1);
        j.name("controller");
        triple(j, CX - min[0], CY - min[1], CZ - min[2]);
        j.name("palette").beginArray();
        for (Placed p : palette) {
            j.beginObject();
            j.name("id").value(p.name);
            j.name("meta").value(p.meta);
            if (p.mte != null) j.name("mte").value(p.mte.intValue());
            j.endObject();
        }
        j.endArray();
        j.name("blocks").beginArray();
        for (int k = 0; k < blocks.size(); k++) {
            int[] pos = blocks.get(k).pos;
            j.beginArray();
            j.value(pos[0] - min[0]).value(pos[1] - min[1]).value(pos[2] - min[2]).value(entry[k]);
            j.endArray();
        }
        j.endArray();
        j.name("air").beginArray();
        for (int[] a : air) triple(j, a[0] - min[0], a[1] - min[1], a[2] - min[2]);
        j.endArray();
        if (rules != null) ElementLine.write(j, rules.elements, rules.elementOf);
        if (truncated) j.name("truncated").value(true);
        j.endObject();
        w.end();
    }

    /**
     * Every non-air block of the region. Chunks that are not loaded and 16³ sections a chunk has never stored a block in
     * are skipped: within one tick, nothing this section placed can be there.
     */
    private static List<int[]> nonAir(World world, Box r) {
        IChunkProvider chunks = world.getChunkProvider();
        int minY = Math.max(r.minY, 0);
        int maxY = Math.min(r.maxY, world.getHeight() - 1);
        List<int[]> found = new ArrayList<>();
        for (int cx = r.minX >> 4; cx <= r.maxX >> 4; cx++) {
            for (int cz = r.minZ >> 4; cz <= r.maxZ >> 4; cz++) {
                if (!chunks.chunkExists(cx, cz)) continue;
                ExtendedBlockStorage[] sections = chunks.provideChunk(cx, cz).getBlockStorageArray();
                int x0 = Math.max(r.minX, cx << 4), x1 = Math.min(r.maxX, (cx << 4) | 15);
                int z0 = Math.max(r.minZ, cz << 4), z1 = Math.min(r.maxZ, (cz << 4) | 15);
                for (int sy = minY >> 4; sy <= maxY >> 4 && sy < sections.length; sy++) {
                    if (sections[sy] == null) continue;
                    int y0 = Math.max(minY, sy << 4), y1 = Math.min(maxY, (sy << 4) | 15);
                    for (int y = y0; y <= y1; y++) {
                        for (int z = z0; z <= z1; z++) {
                            for (int x = x0; x <= x1; x++) {
                                if (!world.isAirBlock(x, y, z)) found.add(new int[] { x, y, z });
                            }
                        }
                    }
                }
            }
        }
        return found;
    }

    /**
     * Sets every position to air with flag 2 (no neighbour updates). Throws when one stays non-air: a block left in the
     * scan box would become part of every later structure.
     */
    private static void clear(World world, List<int[]> positions) {
        int failed = 0;
        String first = null;
        Throwable firstError = null;
        for (int[] p : positions) {
            Throwable error = null;
            try {
                world.setBlock(p[0], p[1], p[2], Blocks.air, 0, 2);
            } catch (Throwable t) {
                error = t;
            }
            if (error != null || !world.isAirBlock(p[0], p[1], p[2])) {
                if (failed++ == 0) first = Arrays.toString(p) + (error != null ? ": " + error : "");
                if (firstError == null) firstError = error;
            }
        }
        if (failed > 0) {
            throw new IllegalStateException(
                "structures: " + failed + " blocks could not be cleared, the first at " + first,
                firstError);
        }
    }

    private static List<int[]> positions(List<Placed> blocks) {
        List<int[]> positions = new ArrayList<>(blocks.size());
        for (Placed b : blocks) positions.add(b.pos);
        return positions;
    }

    /** Layer order: by y, then z, then x. */
    private static int layerOrder(int[] a, int[] b) {
        if (a[1] != b[1]) return Integer.compare(a[1], b[1]);
        if (a[2] != b[2]) return Integer.compare(a[2], b[2]);
        return Integer.compare(a[0], b[0]);
    }

    private static void extend(int[] min, int[] max, int[] pos) {
        for (int i = 0; i < 3; i++) {
            min[i] = Math.min(min[i], pos[i]);
            max[i] = Math.max(max[i], pos[i]);
        }
    }

    private static void triple(JsonWriter j, int a, int b, int c) throws IOException {
        j.beginArray();
        j.value(a).value(b).value(c);
        j.endArray();
    }

    /** The first {@value #LISTED_IDS} ids, then {@code …} when there are more. */
    static String listIds(List<Integer> ids) {
        StringBuilder s = new StringBuilder();
        for (int k = 0; k < ids.size() && k < LISTED_IDS; k++) {
            if (k > 0) s.append(", ");
            s.append(ids.get(k));
        }
        if (ids.size() > LISTED_IDS) s.append(", …");
        return s.toString();
    }

    /**
     * One recorded block: world position, block, registry name, metadata, GT machine id ({@code null} for other
     * blocks) and whether the cell held a tile entity. {@link HatchProbe} reads them to put the block back.
     */
    static final class Placed {

        final int[] pos;
        final Block block;
        final String name;
        final int meta;
        final Integer mte;
        final boolean tile;

        Placed(int[] pos, Block block, String name, int meta, Integer mte, boolean tile) {
            this.pos = pos;
            this.block = block;
            this.name = name;
            this.meta = meta;
            this.mte = mte;
            this.tile = tile;
        }
    }

    /** An inclusive block region. */
    private static final class Box {

        final int minX, minY, minZ, maxX, maxY, maxZ;

        Box(int minX, int minY, int minZ, int maxX, int maxY, int maxZ) {
            this.minX = minX;
            this.minY = minY;
            this.minZ = minZ;
            this.maxX = maxX;
            this.maxY = maxY;
            this.maxZ = maxZ;
        }

        Box widen(int d) {
            return new Box(minX - d, minY - d, minZ - d, maxX + d, maxY + d, maxZ + d);
        }

        boolean contains(int x, int y, int z) {
            return x >= minX && x <= maxX && y >= minY && y <= maxY && z >= minZ && z <= maxZ;
        }

        boolean onBoundary(int[] p) {
            return p[0] == minX || p[0] == maxX || p[1] == minY || p[1] == maxY || p[2] == minZ || p[2] == maxZ;
        }

        /** A distinct index for each cell of the box; −1 outside. */
        int index(int x, int y, int z) {
            if (!contains(x, y, z)) return -1;
            return ((x - minX) * (maxY - minY + 1) + (y - minY)) * (maxZ - minZ + 1) + (z - minZ);
        }
    }
}
