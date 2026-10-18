package io.github.drukoz.gtnhplanner.export.textures;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class TexturePathsTest {
    @Test void resourceLocations() {
        assertEquals("gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png", TexturePaths.fromResource("gregtech", "textures/blocks/iconsets/MACHINE_LV_SIDE.png", "blocks"));
        assertEquals("gregtech/textures/items/materialicons/NONE/dust.png", TexturePaths.fromResource("GregTech", "textures/items/materialicons/NONE/dust", "items"));
        assertEquals("gregtech/textures/blocks/fluids/fluid.water.png", TexturePaths.fromResource("gregtech", "fluids/fluid.water", "blocks"));
        assertNull(TexturePaths.fromResource("gregtech", null, "blocks"));
    }
    @Test void iconNames() {
        assertEquals("jabba/textures/blocks/barrel_side_0.png", TexturePaths.fromIconName("JABBA:barrel_side_0", "blocks"));
        assertEquals("minecraft/textures/blocks/stone.png", TexturePaths.fromIconName("stone", "blocks"));
        assertEquals("gregtech/textures/items/gt.metaitem.01/606.png", TexturePaths.fromIconName("gregtech:gt.metaitem.01/606", "items"));
    }
}
