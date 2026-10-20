package io.github.drukoz.gtnhplanner.export.textures;

import java.util.function.Function;

/**
 * Which still icon a GT fluid shows. {@code GTFluid.run()} (javap of GT 5.09.54.183) takes the icons of its
 * {@code iconsFrom} when that is a {@code GTFluid}, after running it first, and registers its own
 * {@code stillIconResourceLocation} only otherwise; so the cracked fluids show their source gas's still, not the one
 * their own location names. Plain objects only, so this is unit-tested without GT.
 */
public final class FluidStill {

    /** More than any real chain; ends a chain that loops (GT itself would recurse until the stack overflows). */
    private static final int MAX_STEPS = 4;

    private FluidStill() {}

    /**
     * The still location of the last fluid reached from {@code fluid} by following {@code borrowsFrom} (a fluid's
     * {@code iconsFrom} when that is a {@code GTFluid}, else null) at most {@value #MAX_STEPS} steps; a chain that
     * loops back to {@code fluid} ends there. {@code own} gives a fluid's {@code stillIconResourceLocation}.
     */
    public static Object location(Object fluid, Function<Object, Object> own, Function<Object, Object> borrowsFrom) {
        Object last = fluid;
        for (int step = 0; step < MAX_STEPS; step++) {
            Object next = borrowsFrom.apply(last);
            if (next == null) break;
            last = next;
            if (last == fluid) break;
        }
        return own.apply(last);
    }
}
