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
 * <li>a small {@code P} button on the survival inventory, just above the inventory panel's top-right corner, so it
 * stays clear of NEI's panels on either side and of the inventory tabs other mods put above the panel's left end. The
 * panel's edge is not where the inventory first put it: vanilla moves the panel right while potion effects show, and
 * GTNH's NEI moves it back to the centre before every frame it draws. So the button reads the panel's live edge
 * ({@code guiLeft}, {@code guiTop}, {@code xSize}) each time it is drawn or pressed and moves there. It is not added to
 * the creative inventory, whose tabs and page buttons fill every side of the panel.</li>
 * </ul>
 * Registered on both buses: FML's carries the client tick, Forge's the GUI events. If the button cannot be placed, the
 * log says why, once, the button goes away and only the key opens the screen. Used on the game thread only.
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
     * After the survival inventory lays out its controls (again after a resize): adds the planner button, with an id
     * none of the inventory's buttons has, at the panel's top-right corner as it is now (it follows the panel from
     * then on).
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
            InventoryButton button = new InventoryButton(freeId(e.buttonList), (GuiContainer) e.gui);
            button.place();
            e.buttonList.add(button);
        } catch (Throwable failure) {
            buttonFailed(failure, "The planner button could not be put on the inventory");
        }
    }

    /**
     * A click on the planner button closes the inventory as its key does (the server is told, and puts away what the
     * cursor held) and opens the planner screen. The inventory itself never sees the click.
     */
    @SubscribeEvent
    public void onAction(GuiScreenEvent.ActionPerformedEvent.Pre e) {
        if (!(e.button instanceof InventoryButton)) return;
        e.setCanceled(true);
        try {
            e.button.func_146113_a(mc.getSoundHandler());
            mc.thePlayer.closeScreen();
            open();
        } catch (Throwable failure) {
            e.button.visible = false;
            buttonFailed(failure, "The planner button could not open the planner screen");
        }
    }

    /** Shows a new planner screen. */
    void open() {
        mc.displayGuiScreen(new PlannerScreen(session, config, icons));
    }

    /** No more inventory buttons from now on; the first failure is logged. */
    private void buttonFailed(Throwable failure, String what) {
        if (!buttonFailed) {
            ClientProxy.LOG.error(what + "; the key binding still opens the planner screen", failure);
        }
        buttonFailed = true;
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

    /**
     * The planner button on one inventory: before it is drawn and before a press is checked, it moves to just above
     * the panel's top-right corner, wherever the panel is at that moment. If the panel's edge cannot be read, it hides.
     */
    private final class InventoryButton extends GuiButton {

        private final GuiContainer gui;

        InventoryButton(int id, GuiContainer gui) {
            super(id, 0, 0, BUTTON_SIZE, BUTTON_SIZE, BUTTON_LABEL);
            this.gui = gui;
        }

        /** Its right edge on the panel's right edge, its bottom just above the panel's top (never above the screen). */
        void place() throws IllegalAccessException {
            xPosition = guiLeft.getInt(gui) + xSize.getInt(gui) - BUTTON_SIZE;
            yPosition = Math.max(0, guiTop.getInt(gui) - BUTTON_GAP - BUTTON_SIZE);
        }

        @Override
        public void drawButton(Minecraft minecraft, int mouseX, int mouseY) {
            if (follow()) super.drawButton(minecraft, mouseX, mouseY);
        }

        @Override
        public boolean mousePressed(Minecraft minecraft, int mouseX, int mouseY) {
            return follow() && super.mousePressed(minecraft, mouseX, mouseY);
        }

        /** Moves to the panel's corner; false, and hidden from then on, when the panel's edge cannot be read. */
        private boolean follow() {
            if (!visible) return false;
            try {
                place();
                return true;
            } catch (Throwable failure) {
                visible = false;
                buttonFailed(failure, "The planner button could not follow the inventory panel");
                return false;
            }
        }
    }
}
