package io.github.drukoz.gtnhplanner.projector.config;

import java.io.File;
import java.io.FileInputStream;
import java.io.FileOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.StandardCopyOption;
import java.util.Properties;

/**
 * The projector's settings and saved tokens, in {@code config/gtnhplannerprojector.properties}: a plain
 * {@link Properties} file, so it is unit-tested without Minecraft. Reading never fails: a missing or unreadable file
 * gives the defaults, a value that does not parse gives its default and a number out of range is clamped into its
 * range. Keys this version does not know are kept and written back. Used on the game thread only (not thread-safe).
 */
public final class ProjectorConfig {

    public static final String FILE_NAME = "gtnhplannerprojector.properties";

    /** The comment at the top of the saved file. */
    private static final String HEADER = "GTNH Planner Projector. Each token gives access to one planner project: keep this file private.";

    private static final String PLANNER_URL = "plannerUrl";
    private static final String TOKEN_PREFIX = "token.";
    private static final String MAX_DISTANCE = "maxDistance";
    private static final String CHECK_INTERVAL_TICKS = "checkIntervalTicks";
    private static final String REFRESH_SECONDS = "refreshSeconds";
    private static final String GHOST_ALPHA = "ghostAlpha";
    private static final String SEE_THROUGH = "seeThrough";
    private static final String USE_DISPLAY_LISTS = "useDisplayLists";

    private final File file;
    /** The file's keys that are not settings, as read: {@code token.<projectId>} and keys this version does not know. */
    private final Properties others;
    private String plannerUrl;
    private final int maxDistance;
    private final int checkIntervalTicks;
    private final int refreshSeconds;
    private final float ghostAlpha;
    private boolean seeThrough;
    private final boolean useDisplayLists;

    private ProjectorConfig(File file, Properties read) {
        this.file = file;
        plannerUrl = trimmed(take(read, PLANNER_URL));
        maxDistance = intIn(take(read, MAX_DISTANCE), 96, 16, 512);
        checkIntervalTicks = intIn(take(read, CHECK_INTERVAL_TICKS), 20, 5, 200);
        refreshSeconds = intIn(take(read, REFRESH_SECONDS), 60, 15, 3600);
        ghostAlpha = floatIn(take(read, GHOST_ALPHA), 0.4f, 0.1f, 0.9f);
        seeThrough = bool(take(read, SEE_THROUGH), false);
        useDisplayLists = bool(take(read, USE_DISPLAY_LISTS), true);
        others = read;
    }

    /** Reads {@code file}; a missing or unreadable file gives the defaults. {@link #save()} writes back to it. */
    public static ProjectorConfig load(File file) {
        Properties read = new Properties();
        try (InputStream in = new FileInputStream(file)) {
            read.load(in);
        } catch (IOException | IllegalArgumentException e) { // missing, unreadable, or a malformed unicode escape
            read = new Properties();
        }
        return new ProjectorConfig(file, read);
    }

    /**
     * Writes every setting, every token and the kept unknown keys to {@code <file>.tmp}, then moves that over the
     * file, so an interrupted save never leaves a half-written config behind.
     */
    public void save() throws IOException {
        Properties out = new Properties();
        out.putAll(others);
        out.setProperty(PLANNER_URL, plannerUrl);
        out.setProperty(MAX_DISTANCE, Integer.toString(maxDistance));
        out.setProperty(CHECK_INTERVAL_TICKS, Integer.toString(checkIntervalTicks));
        out.setProperty(REFRESH_SECONDS, Integer.toString(refreshSeconds));
        out.setProperty(GHOST_ALPHA, Float.toString(ghostAlpha));
        out.setProperty(SEE_THROUGH, Boolean.toString(seeThrough));
        out.setProperty(USE_DISPLAY_LISTS, Boolean.toString(useDisplayLists));
        File tmp = new File(file.getPath() + ".tmp");
        try {
            try (OutputStream o = new FileOutputStream(tmp)) {
                out.store(o, HEADER);
            }
            moveOver(tmp, file);
        } catch (IOException e) {
            tmp.delete();
            throw e;
        }
    }

    /** The planner address the player set, or {@code ""} for automatic (the Minecraft server's host, port 8765). */
    public String plannerUrl() {
        return plannerUrl;
    }

    /** Sets the planner address; {@code ""} (or null) means automatic. */
    public void setPlannerUrl(String urlOrEmpty) {
        plannerUrl = trimmed(urlOrEmpty);
    }

    /** The token saved for a project (key {@code token.<projectId>}), or null when there is none. */
    public String token(String projectId) {
        String token = trimmed(others.getProperty(TOKEN_PREFIX + projectId));
        return token.isEmpty() ? null : token;
    }

    /** Keeps a project's token ({@link #save()} writes it); a null or blank token removes the saved one. */
    public void setToken(String projectId, String token) {
        String t = trimmed(token);
        if (t.isEmpty()) others.remove(TOKEN_PREFIX + projectId);
        else others.setProperty(TOKEN_PREFIX + projectId, t);
    }

    /** Blocks farther than this from the camera are not drawn: 16 to 512, default 96. */
    public int maxDistance() {
        return maxDistance;
    }

    /** Game ticks between two checks of the world: 5 to 200, default 20 (once a second). */
    public int checkIntervalTicks() {
        return checkIntervalTicks;
    }

    /** Seconds between two background refreshes of the loaded line: 15 to 3600, default 60. */
    public int refreshSeconds() {
        return refreshSeconds;
    }

    /** Opacity of a ghost block: 0.1 to 0.9, default 0.4. */
    public float ghostAlpha() {
        return ghostAlpha;
    }

    /** Whether ghosts show through other blocks ({@code /planner xray}); default false. */
    public boolean seeThrough() {
        return seeThrough;
    }

    public void setSeeThrough(boolean on) {
        seeThrough = on;
    }

    /** Whether the ghosts are compiled into GL display lists (default true); false draws them again every frame. */
    public boolean useDisplayLists() {
        return useDisplayLists;
    }

    private static void moveOver(File from, File to) throws IOException {
        try {
            Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING, StandardCopyOption.ATOMIC_MOVE);
        } catch (AtomicMoveNotSupportedException e) {
            Files.move(from.toPath(), to.toPath(), StandardCopyOption.REPLACE_EXISTING);
        }
    }

    /** Removes a key and returns its text, null when it was not there. */
    private static String take(Properties p, String key) {
        Object value = p.remove(key);
        return value == null ? null : value.toString();
    }

    private static String trimmed(String s) {
        return s == null ? "" : s.trim();
    }

    /** A whole number: missing or unparseable gives {@code def}, one outside {@code min..max} the nearest bound. */
    private static int intIn(String text, int def, int min, int max) {
        if (text == null) return def;
        try {
            return (int) Math.max(min, Math.min(max, Long.parseLong(text.trim())));
        } catch (NumberFormatException e) {
            return def;
        }
    }

    /** A number: missing, unparseable or NaN gives {@code def}, one outside {@code min..max} the nearest bound. */
    private static float floatIn(String text, float def, float min, float max) {
        if (text == null) return def;
        try {
            float value = Float.parseFloat(text.trim());
            return Float.isNaN(value) ? def : Math.max(min, Math.min(max, value));
        } catch (NumberFormatException e) {
            return def;
        }
    }

    /** {@code true} or {@code false} in any case; anything else gives {@code def}. */
    private static boolean bool(String text, boolean def) {
        String t = trimmed(text);
        if (t.equalsIgnoreCase("true")) return true;
        if (t.equalsIgnoreCase("false")) return false;
        return def;
    }
}
