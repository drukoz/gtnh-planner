package io.github.drukoz.gtnhplanner.projector.session;

/** A {@code /planner} command that cannot be read; the message tells the player, in plain words, what to type. */
public final class CommandException extends Exception {

    private static final long serialVersionUID = 1L;

    public CommandException(String message) {
        super(message);
    }
}
