package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.common.registry.GameData;
import gregtech.api.interfaces.tileentity.IGregTechTileEntity;
import gregtech.api.metatileentity.BaseMetaTileEntity;
import io.github.drukoz.gtnhplanner.projector.check.WorldProbe;
import net.minecraft.block.Block;
import net.minecraft.tileentity.TileEntity;
import net.minecraft.world.World;
import net.minecraftforge.common.util.ForgeDirection;

/**
 * The build check's view of one client world (spec §3.13): only what the client already has loaded, never changed.
 * A dimension change brings a new world, and with it a new probe. Every answer that fails is the answer for a block
 * that is not loaded: {@link #isLoaded} false, {@link #isKnownBlock} false, {@link #blockAt} null, {@link #metaAt} −1,
 * {@link #mteIdAt} {@link #NO_TILE} and {@link #facingAt} −1.
 */
public final class McWorldProbe implements WorldProbe {

    /** GT's machine block: its tile entity says which machine it is and where its front is. */
    private static final String GT_MACHINES = "gregtech:gt.blockmachines";
    /** Blocks live at {@code 0 ≤ y < 256}. */
    private static final int WORLD_HEIGHT = 256;

    private final World world;

    public McWorldProbe(World world) {
        this.world = world;
    }

    /**
     * Whether the client has the chunk. The client's chunk provider answers {@code chunkExists} with true for every
     * chunk and hands out an empty chunk for one it has not received, so the empty-chunk test is the real one.
     */
    @Override
    public boolean isLoaded(int x, int y, int z) {
        try {
            return y >= 0 && y < WORLD_HEIGHT && !world.getChunkFromChunkCoords(x >> 4, z >> 4).isEmpty();
        } catch (Throwable t) {
            return false;
        }
    }

    @Override
    public boolean isKnownBlock(String registryName) {
        try {
            return GameData.getBlockRegistry().containsKey(registryName);
        } catch (Throwable t) {
            return false;
        }
    }

    /**
     * The block's registry name; null for air and for a block that is replaced by placing another (tall grass, a snow
     * layer, water). {@code world.isAirBlock} is Forge's {@code block.isAir(world, x, y, z)} for the block there,
     * called through vanilla's own method so the reobfuscated jar names only vanilla members.
     */
    @Override
    public String blockAt(int x, int y, int z) {
        try {
            Block block = world.getBlock(x, y, z);
            if (world.isAirBlock(x, y, z) || block.getMaterial().isReplaceable()) return null;
            return GameData.getBlockRegistry().getNameForObject(block);
        } catch (Throwable t) {
            return null;
        }
    }

    @Override
    public int metaAt(int x, int y, int z) {
        try {
            return world.getBlockMetadata(x, y, z);
        } catch (Throwable t) {
            return -1;
        }
    }

    /**
     * The GT machine id of the tile there. A GT tile whose data has not reached the client yet has no machine, and
     * neither has a GT machine block whose tile is still missing: both are {@link #NOT_SYNCED}.
     */
    @Override
    public int mteIdAt(int x, int y, int z) {
        try {
            TileEntity tile = world.getTileEntity(x, y, z);
            if (tile instanceof IGregTechTileEntity) {
                IGregTechTileEntity gt = (IGregTechTileEntity) tile;
                return gt.getMetaTileEntity() == null ? NOT_SYNCED : gt.getMetaTileID();
            }
            if (tile != null) return NO_TILE;
            String block = GameData.getBlockRegistry().getNameForObject(world.getBlock(x, y, z));
            return GT_MACHINES.equals(block) ? NOT_SYNCED : NO_TILE;
        } catch (Throwable t) {
            return NO_TILE;
        }
    }

    /** The GT machine's front, as ForgeDirection 0…5; −1 for anything else and for a front that is no side. */
    @Override
    public int facingAt(int x, int y, int z) {
        try {
            TileEntity tile = world.getTileEntity(x, y, z);
            if (!(tile instanceof BaseMetaTileEntity)) return -1;
            ForgeDirection front = ((BaseMetaTileEntity) tile).getFrontFacing();
            int side = front == null ? -1 : front.ordinal();
            return side >= 0 && side <= 5 ? side : -1;
        } catch (Throwable t) {
            return -1;
        }
    }
}
