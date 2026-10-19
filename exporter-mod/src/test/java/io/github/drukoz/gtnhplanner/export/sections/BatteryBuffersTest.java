package io.github.drukoz.gtnhplanner.export.sections;

import static org.junit.jupiter.api.Assertions.assertEquals;

import org.junit.jupiter.api.Test;

class BatteryBuffersTest {

    @Test
    void aPrototypeThatCountsNoBatteriesSendsOneAmpPerSlot() {
        assertEquals(1, BatteryBuffers.ampsOut(1, 0)); // MTEBasicBatteryBuffer 1x1
        assertEquals(16, BatteryBuffers.ampsOut(16, 0)); // MTEBasicBatteryBuffer 4x4, MTETeslaCoil of 16 slots
    }

    @Test
    void aPrototypeWithAmpsOfItsOwnKeepsThem() {
        assertEquals(2, BatteryBuffers.ampsOut(4, 2)); // MTECharger: at least 2 A
        assertEquals(16, BatteryBuffers.ampsOut(4, 16)); // MTETurboCharger: 4 A per slot
    }
}
