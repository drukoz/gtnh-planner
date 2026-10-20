package io.github.drukoz.gtnhplanner.projector.check;

import java.util.*;

public final class FakeWorld implements WorldProbe {
    static final String BUNDLE = "EnderIO:blockConduitBundle";
    private final Map<String, Object[]> blocks = new HashMap<>();
    private final Map<String, Set<String>> conduits = new HashMap<>();
    private final Set<String> unloaded = new HashSet<>();
    public final Set<String> known = new HashSet<>(Arrays.asList("gregtech:gt.blockmachines", "minecraft:chest", "ForgeMultipart:block", "minecraft:stone", BUNDLE));
    /** A client that cannot read conduit bundles at all: {@link #conduitKindsAt} answers null. */
    public boolean conduitsUnreadable;
    public int probes;
    private static String k(int x, int y, int z) { return x + "," + y + "," + z; }
    /** A block whose main facing is not known (−1), as for anything that is no GT basic machine. */
    public FakeWorld put(int x, int y, int z, String id, int meta, int mte, int facing) { return put(x, y, z, id, meta, mte, facing, -1); }
    public FakeWorld put(int x, int y, int z, String id, int meta, int mte, int facing, int mainFacing) { blocks.put(k(x, y, z), new Object[] {id, meta, mte, facing, mainFacing}); return this; }
    public FakeWorld remove(int x, int y, int z) { blocks.remove(k(x, y, z)); conduits.remove(k(x, y, z)); return this; }
    public FakeWorld unload(int x, int y, int z) { unloaded.add(k(x, y, z)); return this; }
    /** A conduit bundle holding conduits of these kinds; with none, one whose conduits have not reached the client yet. */
    public FakeWorld bundle(int x, int y, int z, String... kinds) { conduits.put(k(x, y, z), new HashSet<>(Arrays.asList(kinds))); return put(x, y, z, BUNDLE, 0, NO_TILE, -1); }
    public boolean isLoaded(int x, int y, int z) { probes++; return !unloaded.contains(k(x, y, z)); }
    public boolean isKnownBlock(String id) { return known.contains(id); }
    public String blockAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? null : (String) b[0]; }
    public int metaAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? 0 : (Integer) b[1]; }
    public int mteIdAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? NO_TILE : (Integer) b[2]; }
    public int facingAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? -1 : (Integer) b[3]; }
    public int mainFacingAt(int x, int y, int z) { Object[] b = blocks.get(k(x, y, z)); return b == null ? -1 : (Integer) b[4]; }
    public Set<String> conduitKindsAt(int x, int y, int z) { if (conduitsUnreadable) return null; Set<String> c = conduits.get(k(x, y, z)); return c == null ? Collections.<String>emptySet() : c; }
    /** both Basic Macerators of step "layout:place:s1" (blocks 3 and 4 of the sample), placed right: output side south, front west */
    public FakeWorld placeStepS1() { return put(102, 64, 201, "gregtech:gt.blockmachines", 0, 201, 3, 4).put(103, 64, 201, "gregtech:gt.blockmachines", 0, 201, 3, 4); }
    /**
     * The line step of the bundle sample (step 6): the Tin Item Pipe, the input chest and the routed interface pipe of the
     * sample (blocks 5, 6 and 8), and its two conduit bundles (blocks 10 and 11) holding conduits of these kinds.
     */
    public FakeWorld placeLine(String... bundleKinds) {
        put(102, 64, 202, "gregtech:gt.blockmachines", 0, 5110, -1).put(104, 64, 202, "minecraft:chest", 0, NO_TILE, -1).put(105, 64, 202, "ForgeMultipart:block", 0, NO_TILE, -1);
        return bundle(106, 64, 202, bundleKinds).bundle(107, 64, 202, bundleKinds);
    }
}
