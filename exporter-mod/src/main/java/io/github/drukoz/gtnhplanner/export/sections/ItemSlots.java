package io.github.drukoz.gtnhplanner.export.sections;

import java.io.IOException;

import com.google.gson.stream.JsonWriter;

/**
 * The item slot counts on a GT basic machine's line of {@code machines.jsonl.gz} ({@code MTEBasicMachine}, kinds
 * {@code basic} and {@code steam}; architecture §11.49 (5)): {@code itemInSlots} is its {@code mInputSlotCount} and
 * {@code itemOutSlots} the length of its {@code mOutputItems}, both as GT's {@code MTEBasicMachineWithRecipeBuilder}
 * slots step sets them. The output slots come as any array, so no Minecraft class is needed and JUnit can test it.
 */
final class ItemSlots {

    private ItemSlots() {}

    /**
     * Writes the members {@code "itemInSlots"} and {@code "itemOutSlots"} into the object {@code j} is in; a
     * {@code null} array counts no output slot.
     */
    static void write(JsonWriter j, int inputSlotCount, Object[] outputSlots) throws IOException {
        j.name("itemInSlots").value(inputSlotCount);
        j.name("itemOutSlots").value(outputSlots == null ? 0 : outputSlots.length);
    }
}
