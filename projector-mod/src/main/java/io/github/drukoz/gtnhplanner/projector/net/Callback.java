package io.github.drukoz.gtnhplanner.projector.net;

/** The answer to one planner request: exactly one of the two is called, on the game thread. */
public interface Callback<T> {

    void done(T value);

    /** {@code message} says in plain words what went wrong and, where it can, what to do about it. */
    void failed(String message);
}
