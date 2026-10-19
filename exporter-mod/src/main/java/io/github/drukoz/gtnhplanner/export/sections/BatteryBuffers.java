package io.github.drukoz.gtnhplanner.export.sections;

/**
 * The amps {@link MachinesSection} writes for a battery buffer prototype ({@code MTEBasicBatteryBuffer} and its
 * subclasses), from plain numbers the prototype gives without a world (gt-mechanics.md §4.3). Free of GregTech
 * classes, so JUnit can test it.
 */
final class BatteryBuffers {

    private BatteryBuffers() {}

    /**
     * Amps out of a buffer with a battery of its tier in every one of its {@code slots}. The base class's
     * {@code maxAmperesOut()} counts the batteries the buffer holds, none on a prototype, so a {@code prototypeAmpsOut}
     * of 0 gives one amp per slot; a non-zero one comes from an override that a prototype can answer (chargers at least
     * 2, turbo chargers 4 per slot) and is kept.
     */
    static long ampsOut(int slots, long prototypeAmpsOut) {
        return prototypeAmpsOut != 0 ? prototypeAmpsOut : slots;
    }
}
