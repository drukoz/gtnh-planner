package io.github.drukoz.gtnhplanner.export;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import net.minecraft.item.Item;
import net.minecraft.item.ItemStack;
import net.minecraft.nbt.NBTTagCompound;

import org.junit.jupiter.api.Test;

class ItemKeysTest {

    /**
     * An item whose damage read gives a stack without NBT an empty compound, as Botania's mana mirror
     * ({@code ItemNBTHelper.initNBT}) and GT++'s Alkalus Disk ({@code BaseItemDamageable.createNBT}) do.
     */
    private static final class NbtOnDamageItem extends Item {

        @Override
        public int getDamage(ItemStack stack) {
            if (!stack.hasTagCompound()) stack.setTagCompound(new NBTTagCompound());
            return super.getDamage(stack);
        }
    }

    @Test
    void keysAStackByTheNbtItHadBeforeItsDamageWasRead() {
        ItemStack mirror = new ItemStack(new NbtOnDamageItem(), 1, 1000);
        assertFalse(mirror.hasTagCompound());
        // as every export so far keyed it: the stack the item table seeds for such an item keeps its row
        assertEquals("t:mirror@1000", ItemKeys.keyOf("t:mirror", mirror));
        // the damage read gave it the NBT, so a stack that has it is a variant of its own, as in those exports
        assertTrue(mirror.hasTagCompound());
        assertEquals("t:mirror@1000#{}", ItemKeys.keyOf("t:mirror", mirror));
    }

    @Test
    void keysAStackWithNbtByItsSnbtAndItsPlainKeyWithoutIt() {
        NBTTagCompound crop = new NBTTagCompound();
        crop.setString("crop", "cropsnh:stickyCane");
        ItemStack seed = new ItemStack(new Item(), 1, 3);
        seed.setTagCompound(crop);
        assertEquals("t:seed@3#{crop:\"cropsnh:stickyCane\",}", ItemKeys.keyOf("t:seed", seed));
        assertEquals("t:seed@3", ItemKeys.plainKeyOf("t:seed", seed));
        assertEquals("{crop:\"cropsnh:stickyCane\",}", ItemKeys.nbtOf(seed));
        assertEquals("t:stick@0", ItemKeys.keyOf("t:stick", new ItemStack(new Item(), 1, 0)));
        assertNull(ItemKeys.nbtOf(new ItemStack(new Item(), 1, 0)));
    }
}
