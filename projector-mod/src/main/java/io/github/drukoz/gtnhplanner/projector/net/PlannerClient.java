package io.github.drukoz.gtnhplanner.projector.net;

import com.google.gson.Gson;
import com.google.gson.GsonBuilder;
import com.google.gson.JsonArray;
import com.google.gson.JsonObject;
import io.github.drukoz.gtnhplanner.projector.model.PayloadException;
import io.github.drukoz.gtnhplanner.projector.model.PayloadParser;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import java.io.ByteArrayInputStream;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.io.OutputStream;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.concurrent.Executor;

/**
 * The planner's HTTP API as the projector uses it (spec §3.13), with a project token: fetch the line, tick a build
 * step. Each request runs on {@code io}, and its answer — the value, or what went wrong in plain words — is posted to
 * {@code main}, which the game thread drains every tick: the game never waits for the network, callbacks run on the
 * game thread, and every request gets exactly one answer.
 */
public final class PlannerClient {

    public static final int CONNECT_TIMEOUT_MS = 5000, READ_TIMEOUT_MS = 15000, MAX_BODY_BYTES = 8 << 20;

    private static final Gson GSON = new GsonBuilder().disableHtmlEscaping().create();
    /** How much of an error answer that is not the planner's {@code {error, message}} the player gets to see. */
    private static final int MESSAGE_MAX_CHARACTERS = 200;
    private static final String TOO_LARGE = "The planner's answer is larger than 8 MiB";

    private final Executor io;
    private final MainThreadQueue main;
    private final String userAgent;

    public PlannerClient(Executor io, MainThreadQueue main, String userAgent) {
        this.io = io;
        this.main = main;
        this.userAgent = userAgent;
    }

    /** {@code GET <base>/api/projects/<id>/projector}: the line, as {@link PayloadParser} reads it. */
    public void fetchProjector(String base, String projectId, String token, String player, Callback<ProjectorData> cb) {
        submit(base, cb, () -> {
            byte[] answer = exchange("GET", base, projectId, "/projector", token, player, null);
            return PayloadParser.parse(new InputStreamReader(new ByteArrayInputStream(answer), StandardCharsets.UTF_8));
        });
    }

    /**
     * {@code POST <base>/api/projects/<id>/ops} with the single op {@code {"op":"mark","row":"step:<stepId>","on":true}},
     * ticked in the player's name; the value is the project's new revision from the answer {@code {"rev":n}}.
     */
    public void markStep(String base, String projectId, String token, String player, String stepId, Callback<Integer> cb) {
        submit(base, cb, () -> revOf(exchange("POST", base, projectId, "/ops", token, player, markBody(stepId))));
    }

    /**
     * Runs {@code request} on the IO thread and posts its one answer to the game thread: the value; a refusal or a
     * layout the parser refused, in their own words; and for anything else that went wrong on the way (an
     * {@link IOException}, or a runtime failure such as a port out of range), {@code Cannot reach the planner at …}.
     */
    private <T> void submit(String base, Callback<T> cb, Request<T> request) {
        io.execute(() -> {
            Runnable answer;
            try {
                T value = request.run();
                answer = () -> cb.done(value);
            } catch (Failure | PayloadException e) {
                String message = e.getMessage();
                answer = () -> cb.failed(message);
            } catch (IOException | RuntimeException e) {
                String message = cannotReach(base, e);
                answer = () -> cb.failed(message);
            }
            main.post(answer);
        });
    }

    /**
     * One request to {@code <base>/api/projects/<id><tail>} with the token, the player's name and this client's
     * headers; the body of a 2xx answer, else a {@link Failure} saying what the status means. Redirects are not
     * followed, so the token never goes anywhere but the planner address the player set.
     */
    private byte[] exchange(String method, String base, String projectId, String tail, String token, String player,
        byte[] body) throws IOException, Failure {
        HttpURLConnection c = (HttpURLConnection) new URL(PlannerUrl.projectPath(base, projectId, tail)).openConnection();
        try {
            c.setRequestMethod(method);
            c.setConnectTimeout(CONNECT_TIMEOUT_MS);
            c.setReadTimeout(READ_TIMEOUT_MS);
            c.setInstanceFollowRedirects(false);
            c.setUseCaches(false);
            c.setRequestProperty("Authorization", "Bearer " + token);
            c.setRequestProperty("X-Planner-Name", PlannerUrl.encode(player));
            c.setRequestProperty("Accept", "application/json");
            c.setRequestProperty("User-Agent", userAgent);
            if (body != null) {
                // Buffered, not streamed: in a streaming mode the JDK meets a 401 with an HttpRetryException.
                c.setDoOutput(true);
                c.setRequestProperty("Content-Type", "application/json; charset=utf-8");
                try (OutputStream out = c.getOutputStream()) {
                    out.write(body);
                }
            }
            int status = c.getResponseCode();
            InputStream in = status >= 400 ? c.getErrorStream() : c.getInputStream(); // the error stream may be null
            byte[] answer = in == null ? new byte[0] : readAll(in, c.getContentLengthLong());
            if (status < 200 || status > 299) {
                String text = new String(answer, StandardCharsets.UTF_8);
                throw new Failure(statusMessage(status, text, c.getResponseMessage(), base, projectId));
            }
            return answer;
        } finally {
            c.disconnect();
        }
    }

    /** The whole body, refused when the answer says or turns out to be larger than {@link #MAX_BODY_BYTES}. */
    private static byte[] readAll(InputStream in, long declaredLength) throws IOException, Failure {
        try (InputStream s = in) {
            if (declaredLength > MAX_BODY_BYTES) throw new Failure(TOO_LARGE);
            ByteArrayOutputStream out = new ByteArrayOutputStream(declaredLength > 0 ? (int) declaredLength : 8192);
            byte[] chunk = new byte[8192];
            for (int n; (n = s.read(chunk)) != -1; ) {
                if (out.size() + n > MAX_BODY_BYTES) throw new Failure(TOO_LARGE);
                out.write(chunk, 0, n);
            }
            return out.toByteArray();
        }
    }

    /** What a status other than 2xx means for the player. */
    private static String statusMessage(int status, String body, String reason, String base, String projectId) {
        switch (status) {
            case 401:
                return "The planner refused this token for project " + projectId
                    + ". Create a new one in the project's In-game projector panel and run /planner load " + projectId
                    + " <token>";
            case 403:
                return messageOf(body, reason);
            case 404:
                return "Project " + projectId + " was not found at " + base;
            case 503:
                return "The planner is not ready: " + messageOf(body, reason);
            default:
                return "The planner answered HTTP " + status + ": " + messageOf(body, reason);
        }
    }

    /**
     * The planner's own {@code message} when the body is its error answer {@code {error, message}}; else the body's
     * first 200 characters, trimmed; for an empty body, the status line's reason (for example {@code Bad Gateway}).
     */
    private static String messageOf(String body, String reason) {
        ErrorAnswer e = null;
        try {
            e = GSON.fromJson(body, ErrorAnswer.class);
        } catch (RuntimeException notTheErrorShape) {
            // not JSON, or not an object of strings: the text below is what the player sees
        }
        if (e != null && e.error != null && e.message != null) return e.message;
        String text = body.trim();
        if (text.isEmpty()) return reason == null || reason.trim().isEmpty() ? "no details" : reason.trim();
        if (text.codePointCount(0, text.length()) <= MESSAGE_MAX_CHARACTERS) return text;
        return text.substring(0, text.offsetByCodePoints(0, MESSAGE_MAX_CHARACTERS));
    }

    /** {@code {"ops":[{"op":"mark","row":"step:<stepId>","on":true}]}}, its keys in that order. */
    private static byte[] markBody(String stepId) {
        JsonObject op = new JsonObject();
        op.addProperty("op", "mark");
        op.addProperty("row", "step:" + stepId);
        op.addProperty("on", true);
        JsonArray ops = new JsonArray();
        ops.add(op);
        JsonObject body = new JsonObject();
        body.add("ops", ops);
        return GSON.toJson(body).getBytes(StandardCharsets.UTF_8);
    }

    /** The project's new revision from the ops answer {@code {"rev":n}}. */
    private static Integer revOf(byte[] answer) throws Failure {
        RevAnswer a;
        try {
            a = GSON.fromJson(new String(answer, StandardCharsets.UTF_8), RevAnswer.class);
        } catch (RuntimeException e) { // JsonParseException
            throw new Failure("The planner did not confirm the tick (" + e.getMessage() + ")");
        }
        if (a == null || a.rev == null) throw new Failure("The planner did not confirm the tick (its answer has no rev)");
        return a.rev;
    }

    private static String cannotReach(String base, Exception e) {
        String what = e.getClass().getSimpleName() + (e.getMessage() == null ? "" : ": " + e.getMessage());
        return "Cannot reach the planner at " + base + " (" + what + "). Is it running? Set its address with /planner url <url>";
    }

    /** One request's work on the IO thread. */
    private interface Request<T> {
        T run() throws IOException, Failure, PayloadException;
    }

    /** The planner answered, but not with what was asked for; the message is for the player. */
    private static final class Failure extends Exception {
        private static final long serialVersionUID = 1L;

        Failure(String message) {
            super(message);
        }
    }

    /** The planner's error answer. */
    private static final class ErrorAnswer {
        String error, message;
    }

    /** The planner's answer to an ops request. */
    private static final class RevAnswer {
        Integer rev;
    }
}
