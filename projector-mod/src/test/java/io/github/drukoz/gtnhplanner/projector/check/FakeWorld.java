package io.github.drukoz.gtnhplanner.projector.check;

import java.util.*;

public final class FakeWorld implements WorldProbe {
    private final Map<String, Object[]> blocks = new HashMap<>();
    private final Set<String> unloaded = new HashSet<>();
    public final Set<String> known = new HashSet<>(Arrays.asList("gregtech:gt.blockmachines", "minecraft:chest", "ForgeMultipart:block", "minecraft:stone"));
    public int probes;
    private static String k(int x, int y, int z) { return x + "," + y + "," + z; }
    public FakeWorld put(int x, int y, int z, String id, int meta, int mte, int facing) { blocks.put(k(x, y, z), new Object[] {id, meta, mte, facing}); return this; }
    public FakeWorld remove(int x, int y, int z) { blocks.remove(k(x, y, z)); return this; }
    public FakeWorld unload(int x, int y, int z) { unloaded.add(k(x, y, z)); return this; }
    public boolean isLoaded(int x, int y, int z) { probes++; return !unloaded.contains(k(x, y, z)); }
    public boolean isKnownBlock(String id) { return known.contains(id); }
    public String blockAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? null : (String) b[0]; }
    public int metaAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? 0 : (Integer) b[1]; }
    public int mteIdAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? NO_TILE : (Integer) b[2]; }
    public int facingAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? -1 : (Integer) b[3]; }
    /** both Basic Macerators of step "layout:place:s1" (blocks 3 and 4 of the sample), placed right */
    public FakeWorld placeStepS1() { return put(102, 64, 201, "gregtech:gt.blockmachines", 0, 201, 3).put(103, 64, 201, "gregtech:gt.blockmachines", 0, 201, 3); }
}
