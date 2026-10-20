package io.github.drukoz.gtnhplanner.projector.client;

import io.github.drukoz.gtnhplanner.projector.view.AimRay;
import net.minecraft.block.Block;
import net.minecraft.world.World;

/**
 * The real blocks that stop the aim, as they stop vanilla's own crosshair: a block that is not air and that
 * {@code canCollideCheck(meta, false)} says can be targeted. Every lookup that fails answers "does not stop".
 */
public final class McAimStops implements AimRay.Stops {

    private final World world;

    public McAimStops(World world) {
        this.world = world;
    }

    @Override
    public boolean at(int x, int y, int z) {
        try {
            if (world.isAirBlock(x, y, z)) return false;
            Block block = world.getBlock(x, y, z);
            return block.canCollideCheck(world.getBlockMetadata(x, y, z), false);
        } catch (Throwable t) {
            return false;
        }
    }
}
