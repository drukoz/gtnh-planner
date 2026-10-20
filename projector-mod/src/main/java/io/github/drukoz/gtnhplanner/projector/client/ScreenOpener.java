package io.github.drukoz.gtnhplanner.projector.client;

import cpw.mods.fml.client.registry.ClientRegistry;
import cpw.mods.fml.common.eventhandler.SubscribeEvent;
import cpw.mods.fml.common.gameevent.TickEvent;
import cpw.mods.fml.relauncher.ReflectionHelper;
import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import java.lang.reflect.Field;
import java.util.List;
import net.minecraft.client.Minecraft;
import net.minecraft.client.gui.GuiButton;
import net.minecraft.client.gui.inventory.GuiContainer;
import net.minecraft.client.gui.inventory.GuiInventory;
import net.minecraft.client.settings.KeyBinding;
import net.minecraftforge.client.event.GuiScreenEvent;

/**
 * Opens the {@link PlannerScreen} (spec §2.4 of the aim and screen design) in two ways:
 * <ul>
 * <li>a key binding in Minecraft's Controls menu, {@code Open the planner screen} under {@code GTNH Planner}, unbound
 * by default because GTNH's keys are crowded;</li>
 * <li>a small {@code P} button on the survival inventory, just above the inventory panel's top-right corner. It is
 * placed from the panel's actual left edge, which moves right while potion effects show, so it stays clear of NEI's
 * panels on either side and of the inventory tabs other mods put above the panel's left end. It is not added to the
 * creative inventory, whose tabs and page buttons fill every side of the panel.</li>
 * </ul>
 * Registered on both buses: FML's carries the client tick, Forge's the GUI events. If the button cannot be placed, the
 * log says why, once, and only the key opens the screen. Used on the game thread only.
 */
public final class ScreenOpener {

    private static final String KEY_NAME = "Open the planner screen", KEY_CATEGORY = "GTNH Planner";
    /** No key: the player picks one in the Controls menu. */
    private static final int UNBOUND = 0;
    /** The inventory button's id, or the next one no button of the inventory has. */
    private static final int BUTTON_ID = 0x4750;
    /** The inventory button's width and height, and the space between it and the panel. */
    private static final int BUTTON_SIZE = 20, BUTTON_GAP = 2;
    private static final String BUTTON_LABEL = "P";

    private final ProjectorSession session;
    private final ProjectorConfig config;
    private final BlockIcons icons;
    private final KeyBinding key = new KeyBinding(KEY_NAME, UNBOUND, KEY_CATEGORY);
    private final Minecraft mc = Minecraft.getMinecraft();

    /** The button on the last inventory opened, or null. */
    private GuiButton inventoryButton;
    /** {@code GuiContainer}'s protected panel edge and width, by their development and game names; null until found. */
    private Field guiLeft, guiTop, xSize;
    /** Whether the inventory button failed: none is added any more and the failure is not logged again. */
    private boolean buttonFailed;

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

    /**
     * After the survival inventory lays out its controls (again after a resize): adds the planner button, its right
     * edge on the panel's right edge and its bottom just above the panel's top, with an id none of the inventory's
     * buttons has.
     */
    @SubscribeEvent
    public void onInitGui(GuiScreenEvent.InitGuiEvent.Post e) {
        // a creative player's inventory switches to the creative one inside its own layout; that one gets no button
        if (buttonFailed || !(e.gui instanceof GuiInventory) || e.gui != mc.currentScreen) return;
        try {
            if (guiLeft == null) {
                guiLeft = ReflectionHelper.findField(GuiContainer.class, "guiLeft", "field_147003_i");
                guiTop = ReflectionHelper.findField(GuiContainer.class, "guiTop", "field_147009_r");
                xSize = ReflectionHelper.findField(GuiContainer.class, "xSize", "field_146999_f");
            }
            int right = guiLeft.getInt(e.gui) + xSize.getInt(e.gui);
            int top = guiTop.getInt(e.gui);
            inventoryButton = new GuiButton(freeId(e.buttonList), right - BUTTON_SIZE,
                Math.max(0, top - BUTTON_GAP - BUTTON_SIZE), BUTTON_SIZE, BUTTON_SIZE, BUTTON_LABEL);
            e.buttonList.add(inventoryButton);
        } catch (Throwable failure) {
            buttonFailed = true;
            inventoryButton = null;
            ClientProxy.LOG.error("The planner button could not be put on the inventory; the key binding still"
                + " opens the planner screen", failure);
        }
    }

    /**
     * A click on the planner button closes the inventory as its key does (the server is told, and puts away what the
     * cursor held) and opens the planner screen. The inventory itself never sees the click.
     */
    @SubscribeEvent
    public void onAction(GuiScreenEvent.ActionPerformedEvent.Pre e) {
        if (inventoryButton == null || e.button != inventoryButton) return;
        e.setCanceled(true);
        try {
            e.button.func_146113_a(mc.getSoundHandler());
            mc.thePlayer.closeScreen();
            open();
        } catch (Throwable failure) {
            if (!buttonFailed) ClientProxy.LOG.error("The planner button could not open the planner screen", failure);
            buttonFailed = true;
            inventoryButton = null;
        }
    }

    /** Shows a new planner screen. */
    void open() {
        mc.displayGuiScreen(new PlannerScreen(session, config, icons));
    }

    /** {@link #BUTTON_ID}, or the first id after it that none of the buttons has. */
    private static int freeId(List<?> buttons) {
        int id = BUTTON_ID;
        while (taken(buttons, id)) id++;
        return id;
    }

    private static boolean taken(List<?> buttons, int id) {
        for (Object b : buttons) {
            if (b instanceof GuiButton && ((GuiButton) b).id == id) return true;
        }
        return false;
    }
}
