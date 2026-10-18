package io.github.drukoz.gtnhplanner.export;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

import net.minecraft.item.ItemStack;
import net.minecraft.util.StatCollector;

/**
 * English names on the dedicated server (export-mod.md §4.6). FML and GT put the {@code en_US} names into the
 * server's translation table, so {@link ItemStack#getDisplayName()} works for almost every item; the few mods that
 * call the client-only {@code I18n} there fall back to the translation table, and what is still unnamed is counted.
 */
public final class NameResolver {

    /** At most this many {@code registry@meta} samples of failed names are kept for the manifest. */
    static final int MAX_SAMPLES = 50;

    private final List<String> samples = new ArrayList<>();
    private int failures;

    /** The English name, or {@code null} (counted as a failure) when neither the item nor the table has one. */
    public String itemName(ItemStack s) {
        try {
            String name = s.getDisplayName();
            if (name != null) return name;
        } catch (Throwable t) {
            // client-only code in the item's name method: fall back to the translation table
        }
        try {
            String name = translate(s.getUnlocalizedName() + ".name");
            if (name != null) return name;
        } catch (Throwable t) {
            // the unlocalized name failed as well
        }
        failures++;
        if (samples.size() < MAX_SAMPLES) samples.add(sample(s));
        return null;
    }

    /** The translation of {@code key}, or {@code null} when the server's table has none. */
    public String translate(String key) {
        if (key == null || !StatCollector.canTranslate(key)) return null;
        return StatCollector.translateToLocal(key);
    }

    public int failures() {
        return failures;
    }

    public List<String> failureSamples() {
        return Collections.unmodifiableList(samples);
    }

    private static String sample(ItemStack s) {
        try {
            return ItemTable.registryName(s) + "@" + s.getItemDamage();
        } catch (Throwable t) {
            return "<unknown item>";
        }
    }
}
