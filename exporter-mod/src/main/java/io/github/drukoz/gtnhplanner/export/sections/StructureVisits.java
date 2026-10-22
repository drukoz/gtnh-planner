package io.github.drukoz.gtnhplanner.export.sections;

import java.util.Map;

import net.minecraft.world.World;

import com.gtnewhorizon.structurelib.StructureEvent;

import cpw.mods.fml.common.eventhandler.SubscribeEvent;

/**
 * The hatch probe's StructureLib listener (gt-mechanics.md §5.5, bullet 1): while {@link HatchProbe} runs one of GT's
 * structure checks with the instrument token {@link #TOKEN} switched on, StructureLib posts a
 * {@code StructureElementVisitedEvent} for every cell an element checks, and this records which element checked which
 * of the structure's recorded blocks. Registered once on Forge's event bus, by {@code ExporterMod} during the
 * server-started event (an FML lifecycle event gives a listener its mod container); between {@link #stop()} and the
 * next {@link #start} it records nothing. It never throws into StructureLib's walk.
 */
public final class StructureVisits {

    public static final StructureVisits INSTANCE = new StructureVisits();

    /** The instrument token of the probe's walks; an event of any other instrument is not the probe's. */
    static final Object TOKEN = new Object();

    private World world;
    private Map<Long, Integer> blockAt;
    private ElementGroups.Visits visits;

    private StructureVisits() {}

    /**
     * Records into {@code visits} each cell of {@code world} that {@code blockAt} ({@link ElementGroups#key} of the
     * cell → its block's index) knows, until {@link #stop()}.
     */
    void start(World world, Map<Long, Integer> blockAt, ElementGroups.Visits visits) {
        this.world = world;
        this.blockAt = blockAt;
        this.visits = visits;
    }

    /** Records nothing more until the next {@link #start}. */
    void stop() {
        visits = null;
        blockAt = null;
        world = null;
    }

    @SubscribeEvent
    public void onVisit(StructureEvent.StructureElementVisitedEvent e) {
        try {
            ElementGroups.Visits v = visits;
            if (v == null || e.getInstrumentIdentifier() != TOKEN || e.getWorld() != world) return;
            Integer block = blockAt.get(ElementGroups.key(e.getX(), e.getY(), e.getZ()));
            if (block != null) v.visit(block, e.getElement());
        } catch (Throwable ignored) {
            // never into StructureLib's walk: FML's EventBus.post logs a listener's throwable and rethrows it
        }
    }
}
