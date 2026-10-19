package io.github.drukoz.gtnhplanner.projector.session;

/**
 * One {@code /planner} command, as {@link CommandParser} reads it and {@link ProjectorSession#run} carries it out.
 * Only the fields of its {@link #kind} are set; the others are null.
 */
public final class Command {

    public enum Kind { LOAD, CLEAR, LAYER, STEP, RELOAD, URL, XRAY, HELP }

    public final Kind kind;
    /**
     * LOAD: the project id, and the token typed with it (null: the one saved for that project). STEP: a number from 1,
     * {@code all} or {@code next}. URL: a planner address, or {@code auto} for the Minecraft server's host.
     */
    public final String projectId, token, step, url;
    /** LAYER: the one Y layer to show, or null for every layer. */
    public final Integer layer;
    /** XRAY: see-through ghosts on or off, or null to switch them over. */
    public final Boolean on;

    private Command(Kind kind, String projectId, String token, String step, String url, Integer layer, Boolean on) {
        this.kind = kind;
        this.projectId = projectId;
        this.token = token;
        this.step = step;
        this.url = url;
        this.layer = layer;
        this.on = on;
    }

    public static Command load(String projectId, String tokenOrNull) {
        return new Command(Kind.LOAD, projectId, tokenOrNull, null, null, null, null);
    }

    public static Command clear() {
        return new Command(Kind.CLEAR, null, null, null, null, null, null);
    }

    public static Command layer(Integer yOrNull) {
        return new Command(Kind.LAYER, null, null, null, null, yOrNull, null);
    }

    public static Command step(String nAllOrNext) {
        return new Command(Kind.STEP, null, null, nAllOrNext, null, null, null);
    }

    public static Command reload() {
        return new Command(Kind.RELOAD, null, null, null, null, null, null);
    }

    public static Command url(String urlOrAuto) {
        return new Command(Kind.URL, null, null, null, urlOrAuto, null, null);
    }

    public static Command xray(Boolean onOrNullToToggle) {
        return new Command(Kind.XRAY, null, null, null, null, null, onOrNullToToggle);
    }

    public static Command help() {
        return new Command(Kind.HELP, null, null, null, null, null, null);
    }
}
