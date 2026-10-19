package io.github.drukoz.gtnhplanner.projector.check;

/**
 * What the build check reads from the world the client already has (spec §3.13), one planned block position at a
 * time; it never changes the world. The {@code client} package answers it from Minecraft, tests from a fake world.
 */
public interface WorldProbe {

    /** {@link #mteIdAt}'s answer where there is no GT machine tile. */
    int NO_TILE = -1;
    /** {@link #mteIdAt}'s answer for a GT machine tile whose data has not reached the client yet. */
    int NOT_SYNCED = -2;

    /** Whether the client has this position's chunk, and {@code 0 ≤ y < 256}. */
    boolean isLoaded(int x, int y, int z);

    /** Whether the client's block registry has this name. */
    boolean isKnownBlock(String registryName);

    /** The registry name of the block there; null for air and replaceable blocks (tall grass, a snow layer, water). */
    String blockAt(int x, int y, int z);

    /** The block meta there. */
    int metaAt(int x, int y, int z);

    /**
     * The GT MetaTileEntity id there; {@link #NO_TILE} when it is not a GT tile, {@link #NOT_SYNCED} when the GT tile
     * has no data yet.
     */
    int mteIdAt(int x, int y, int z);

    /** The GT front there, as ForgeDirection 0…5; −1 when it is unknown. */
    int facingAt(int x, int y, int z);
}
