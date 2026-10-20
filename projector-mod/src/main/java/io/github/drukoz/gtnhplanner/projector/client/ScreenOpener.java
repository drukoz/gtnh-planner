package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.client.registry.ClientRegistry;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;
import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import net.minecraft.client.Minecraft;
import net.minecraft.client.settings.KeyBinding;

/**
 * Opens the {@link PlannerScreen} (spec §2.4 of the aim and screen design) with a key binding in Minecraft's Controls
 * menu, {@code Open the planner screen} under {@code GTNH Planner}, unbound by default because GTNH's keys are crowded.
 * On FML's bus, which carries the client tick. Used on the game thread only.
 */
public final class ScreenOpener {

    private static final String KEY_NAME = "Open the planner screen", KEY_CATEGORY = "GTNH Planner";
    /** No key: the player picks one in the Controls menu. */
    private static final int UNBOUND = 0;

    private final ProjectorSession session;
    private final ProjectorConfig config;
    private final BlockIcons icons;
    private final KeyBinding key = new KeyBinding(KEY_NAME, UNBOUND, KEY_CATEGORY);
    private final Minecraft mc = Minecraft.getMinecraft();

    /** Registers the key binding with the game. */
    public ScreenOpener(ProjectorSession session, ProjectorConfig config, BlockIcons icons) {
        this.session = session;
        this.config = config;
        this.icons = icons;
        ClientRegistry.registerKeyBinding(key);
    }

    /**
     * At the end of each client tick: opens the screen when the key was pressed in a world with no screen open. Every
     * press is taken, so one made while another screen opened does not open this one later.
     */
    @SubscribeEvent
    public void onTick(TickEvent.ClientTickEvent e) {
        if (e.phase != TickEvent.Phase.END) return;
        boolean pressed = false;
        while (key.isPressed()) pressed = true;
        if (pressed && mc.currentScreen == null && mc.theWorld != null) open();
    }

    /** Shows a new planner screen. */
    void open() {
        mc.displayGuiScreen(new PlannerScreen(session, config, icons));
    }
}
