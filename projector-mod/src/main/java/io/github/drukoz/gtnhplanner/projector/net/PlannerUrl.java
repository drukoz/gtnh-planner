package io.github.drukoz.gtnhplanner.projector.net;

import java.io.UnsupportedEncodingException;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.URLEncoder;

/**
 * Where the planner is (spec §3.13): by default the host of the Minecraft server the client is connected to, on the
 * planner's port ({@code http://127.0.0.1:8765} in single player); a planner address the player set wins.
 */
public final class PlannerUrl {

    public static final int PLANNER_PORT = 8765;

    private static final String LOOPBACK = "127.0.0.1";

    private PlannerUrl() {}

    /**
     * The host of a Minecraft server address as the player typed it ({@code host}, {@code host:port},
     * {@code [ipv6]:port} or a bare IPv6 address), ready for a URL: blank or null gives {@code 127.0.0.1} (single
     * player); starting with {@code [}, the part up to and including {@code ]} (all of it without one); with exactly
     * one {@code :}, the part before it ({@code 127.0.0.1} when that is empty, as Minecraft reads {@code :25565});
     * otherwise the whole address, in brackets when it contains {@code :} (a bare IPv6 address).
     */
    public static String hostOf(String serverAddress) {
        String a = serverAddress == null ? "" : serverAddress.trim();
        if (a.isEmpty()) return LOOPBACK;
        if (a.startsWith("[")) {
            int close = a.indexOf(']');
            return close < 0 ? a : a.substring(0, close + 1);
        }
        int colon = a.indexOf(':');
        if (colon < 0) return a;
        if (colon == a.lastIndexOf(':')) return colon == 0 ? LOOPBACK : a.substring(0, colon);
        return "[" + a + "]";
    }

    /** The planner's address on that Minecraft server: {@code http://<hostOf(serverAddress)>:8765}. */
    public static String defaultFor(String serverAddress) {
        return "http://" + hostOf(serverAddress) + ":" + PLANNER_PORT;
    }

    /**
     * The address to use: the player's {@code override} normalized when it is not blank, else
     * {@link #defaultFor defaultFor(serverAddress)}.
     *
     * @throws IllegalArgumentException when the override is not a planner address (see {@link #normalize})
     */
    public static String effective(String override, String serverAddress) {
        return override == null || override.trim().isEmpty() ? defaultFor(serverAddress) : normalize(override);
    }

    /**
     * A typed planner address made usable: surrounding spaces trimmed, {@code http://} added when it has no scheme
     * (no {@code ://}), trailing {@code /} dropped; any port and path are kept.
     *
     * @throws IllegalArgumentException {@code Not a planner address: <url>} unless {@link URI} reads it as http or
     *                                  https with a non-empty host
     */
    public static String normalize(String url) {
        String typed = url == null ? "" : url.trim();
        String full = typed.contains("://") ? typed : "http://" + typed;
        try {
            URI uri = new URI(full);
            String scheme = uri.getScheme();
            String host = uri.getHost();
            if (("http".equalsIgnoreCase(scheme) || "https".equalsIgnoreCase(scheme)) && host != null
                && !host.isEmpty()) {
                int end = full.length();
                while (full.charAt(end - 1) == '/') end--; // stops at the host, which is not empty
                return full.substring(0, end);
            }
        } catch (URISyntaxException e) {
            // not an address: refused below
        }
        throw new IllegalArgumentException("Not a planner address: " + typed);
    }

    /** {@code <base>/api/projects/<projectId, encoded><tail>}, for example tail {@code /projector}. */
    public static String projectPath(String base, String projectId, String tail) {
        return base + "/api/projects/" + encode(projectId) + tail;
    }

    /**
     * JavaScript's {@code encodeURIComponent} as far as the planner's {@code decodeURIComponent} can tell: UTF-8
     * {@link URLEncoder} with its {@code +} for a space turned into {@code %20}.
     */
    public static String encode(String s) {
        try {
            return URLEncoder.encode(s, "UTF-8").replace("+", "%20");
        } catch (UnsupportedEncodingException e) {
            throw new IllegalStateException("UTF-8 is always supported", e);
        }
    }
}
