package io.github.drukoz.gtnhplanner.projector.model;

/** The planner's answer is not a projector layout this mod can show; the message says why, in plain words. */
public final class PayloadException extends Exception {

    private static final long serialVersionUID = 1L;

    public PayloadException(String message) {
        super(message);
    }
}
