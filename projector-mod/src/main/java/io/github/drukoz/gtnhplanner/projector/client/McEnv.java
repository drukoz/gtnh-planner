package io.github.drukoz.gtnhplanner.projector.client;

import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import net.minecraft.client.Minecraft;
import net.minecraft.client.multiplayer.ServerData;
import net.minecraft.util.ChatComponentText;
import net.minecraft.util.EnumChatFormatting;
import net.minecraft.util.IChatComponent;

/**
 * What the projector session reads from the game (spec §3.13): the server the client is connected to, the player's
 * name, the dimension, the clock, and the chat. Used on the game thread only, like the session.
 */
public final class McEnv implements ProjectorSession.Env {

    /**
     * The colour of the {@link ProjectorSession#PREFIX}. Looked up by name: a vanilla enum constant keeps its name in
     * the game's runtime (SRG) names, so reobfuscation leaves a {@code GOLD} field reference as it is, and
     * {@code exporter-mod/scripts/check-reobf.sh} refuses every {@code net/minecraft} member it does not see renamed.
     */
    private static final EnumChatFormatting PREFIX_COLOUR = EnumChatFormatting.valueOf("GOLD");

    private final Minecraft mc = Minecraft.getMinecraft();

    /** The address the player typed for the server the client is connected to; null in single player. */
    @Override
    public String serverAddress() {
        ServerData server = mc.func_147104_D(); // getCurrentServerData; leaving a world clears it
        return server == null ? null : server.serverIP;
    }

    @Override
    public String playerName() {
        return mc.getSession().getUsername();
    }

    /** The player's dimension; {@link Integer#MIN_VALUE}, which no line is in, while there is no world. */
    @Override
    public int dimension() {
        return mc.theWorld == null ? Integer.MIN_VALUE : mc.theWorld.provider.dimensionId;
    }

    @Override
    public long nowMs() {
        return System.currentTimeMillis();
    }

    /** Shows the line in the player's chat; dropped when there is no player (the main menu). */
    @Override
    public void chat(String message) {
        if (mc.thePlayer != null) mc.thePlayer.addChatMessage(line(message));
    }

    /**
     * A chat line: the {@link ProjectorSession#PREFIX} in gold when the message starts with it, then the rest in the
     * chat's own colour. The two parts are siblings under an empty root, so the rest does not inherit the gold.
     */
    static IChatComponent line(String message) {
        IChatComponent line = new ChatComponentText("");
        String rest = message;
        if (message.startsWith(ProjectorSession.PREFIX)) {
            IChatComponent prefix = new ChatComponentText(ProjectorSession.PREFIX);
            prefix.getChatStyle().setColor(PREFIX_COLOUR);
            line.appendSibling(prefix);
            rest = message.substring(ProjectorSession.PREFIX.length());
        }
        return line.appendSibling(new ChatComponentText(rest));
    }
}
