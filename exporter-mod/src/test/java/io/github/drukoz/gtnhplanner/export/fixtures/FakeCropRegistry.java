package io.github.drukoz.gtnhplanner.export.fixtures;

import java.util.Collections;
import java.util.LinkedList;
import java.util.List;

/**
 * Stands for CropsNH's {@code CropRegistry}: the public static field {@code instance}, the cards in registration order,
 * and a public member without {@code @SideOnly} whose parameter is a client class
 * ({@code registerIcons(IIconRegister)}), which a dedicated server never calls.
 */
public class FakeCropRegistry {

    public static final FakeCropRegistry instance = new FakeCropRegistry();

    /** Public but not static. */
    public int cropIdCounter = 2;

    private final LinkedList<FakeCropCard> registrationOrder = new LinkedList<>();

    public FakeCropRegistry() {
        registrationOrder.add(new Card("fakecrops:stickyCane", 4, 0.81450625f));
        registrationOrder.add(new Card("fakecrops:testBonsai", 1, 0.95f));
    }

    public LinkedList<FakeCropCard> getAllInRegistrationOrder() {
        return registrationOrder;
    }

    public void registerIcons(FakeClientOnly register) {}

    /** A card class that is not public, as a mod's card classes need not be. */
    static final class Card implements FakeCropCard {

        private final String id;
        private final int tier;
        private final float dropChance;

        Card(String id, int tier, float dropChance) {
            this.id = id;
            this.tier = tier;
            this.dropChance = dropChance;
        }

        @Override
        public String getId() {
            return id;
        }

        @Override
        public int getTier() {
            return tier;
        }

        @Override
        public float getDropChance() {
            return dropChance;
        }

        @Override
        public List<String> getSoilsForNEI(boolean cached) {
            return cached ? Collections.singletonList("minecraft:sand") : Collections.<String>emptyList();
        }

        @Override
        public String getSeedItem(FakeSeedStats stats) {
            return id + (stats == null ? " seed" : " seed with stats");
        }

        @Override
        public void registerSprites(FakeClientOnly register) {}
    }
}
