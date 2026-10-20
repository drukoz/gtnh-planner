package io.github.drukoz.gtnhplanner.export;

import net.minecraft.item.ItemStack;

/**
 * The keys of {@link ItemTable} for a stack whose registry name is known. Free of GregTech classes and of the item
 * registry, so JUnit can test them with an item of its own.
 */
final class ItemKeys {

    private ItemKeys() {}

    /**
     * {@code id@damage}, plus {@code #SNBT} for a stack with NBT ({@link ItemTable#keyOf}). The NBT is read before the
     * damage, as for every export so far, because {@code Item.getDamage} of some items gives a stack without NBT a
     * compound: Botania's {@code ItemManaMirror} reads its mana through {@code ItemNBTHelper.getInt}, whose
     * {@code initNBT} adds an empty one, and GT++'s {@code BaseItemDamageable} (the Alkalus Disk) calls
     * {@code createNBT}. Read after the damage, the NBT would be in the key of the first stack of such an item, the one
     * the table seeds without NBT, so a later stack that has the NBT would get no row of its own: an export of GTNH
     * 2.9.0-RC-1 would lose four of the rows every earlier one has, and every index after the first of them would
     * shift.
     */
    static String keyOf(String id, ItemStack s) {
        String nbt = nbtOf(s); // before getItemDamage(), which may add it (above)
        return id + "@" + s.getItemDamage() + (nbt != null ? "#" + nbt : "");
    }

    /** {@code id@damage}: the key without its NBT ({@link ItemTable#plainKeyOf}). */
    static String plainKeyOf(String id, ItemStack s) {
        return id + "@" + s.getItemDamage();
    }

    /** The stack's NBT as SNBT, or {@code null} ({@link ItemTable#nbtOf}). */
    static String nbtOf(ItemStack s) {
        return s.hasTagCompound() ? s.getTagCompound().toString() : null;
    }
}
