package io.github.drukoz.gtnhplanner.projector.client;

import io.github.drukoz.gtnhplanner.projector.session.CommandException;
import io.github.drukoz.gtnhplanner.projector.session.CommandParser;
import io.github.drukoz.gtnhplanner.projector.session.ProjectorSession;
import java.util.List;
import java.util.Locale;
import net.minecraft.command.CommandBase;
import net.minecraft.command.ICommandSender;

/**
 * The client-side {@code /planner} command (spec §3.13): the client handles it before anything is sent to the
 * server, so it works on any server, for any player. The words after it are read by {@link CommandParser} and carried
 * out by the session; a mistake is answered in the chat.
 */
public final class PlannerCommand extends CommandBase {

    private static final String[] SUBCOMMANDS = {"load", "clear", "layer", "step", "reload", "url", "xray"};

    private final ProjectorSession session;

    public PlannerCommand(ProjectorSession session) {
        this.session = session;
    }

    @Override
    public String getCommandName() {
        return "planner";
    }

    @Override
    public String getCommandUsage(ICommandSender sender) {
        return CommandParser.USAGE;
    }

    @Override
    public void processCommand(ICommandSender sender, String[] args) {
        try {
            session.run(CommandParser.parse(args));
        } catch (CommandException mistake) {
            sender.addChatMessage(McEnv.line(ProjectorSession.PREFIX + mistake.getMessage()));
        }
    }

    /** Every player may use it: it only reads the world the client has and talks to the planner. */
    @Override
    public boolean canCommandSenderUseCommand(ICommandSender sender) {
        return true;
    }

    @Override
    public int getRequiredPermissionLevel() {
        return 0;
    }

    /**
     * The sub-commands for the first word; then {@code all} and {@code next} after {@code step}, {@code all} after
     * {@code layer}, and {@code on} and {@code off} after {@code xray}; nothing otherwise.
     */
    @Override
    public List<String> addTabCompletionOptions(ICommandSender sender, String[] args) {
        if (args.length == 1) return getListOfStringsMatchingLastWord(args, SUBCOMMANDS);
        if (args.length != 2) return null;
        switch (args[0].toLowerCase(Locale.ROOT)) {
            case "step":
                return getListOfStringsMatchingLastWord(args, "all", "next");
            case "layer":
                return getListOfStringsMatchingLastWord(args, "all");
            case "xray":
                return getListOfStringsMatchingLastWord(args, "on", "off");
            default:
                return null;
        }
    }
}
