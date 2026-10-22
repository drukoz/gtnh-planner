package io.github.drukoz.gtnhplanner.export.fixtures;

import java.util.List;

/**
 * Stands for CropsNH's {@code ICropCard}: the public interface of cards whose classes need not be public, with a member
 * that names a client class and has no {@code @SideOnly} ({@code registerSprites(IIconRegister)}).
 */
public interface FakeCropCard {

    String getId();

    int getTier();

    float getDropChance();

    /** The soils, or none unless {@code cached}. */
    List<String> getSoilsForNEI(boolean cached);

    /** The seed of this crop; {@code null} stats give the plain seed. */
    String getSeedItem(FakeSeedStats stats);

    void registerSprites(FakeClientOnly register);
}
