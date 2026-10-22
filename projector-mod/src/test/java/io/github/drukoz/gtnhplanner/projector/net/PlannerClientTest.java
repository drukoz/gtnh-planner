package io.github.drukoz.gtnhplanner.projector.net;

import static java.nio.charset.StandardCharsets.UTF_8;
import static org.junit.jupiter.api.Assertions.*;
import com.sun.net.httpserver.HttpServer;
import io.github.drukoz.gtnhplanner.projector.model.*;
import java.io.*;
import java.net.*;
import java.util.*;
import org.junit.jupiter.api.*;

class PlannerClientTest {
    static final class Result<T> implements Callback<T> { T value; String error; public void done(T v) { value = v; } public void failed(String m) { error = m; } }
    HttpServer server; String base; final List<String> seen = new ArrayList<>();
    final MainThreadQueue main = new MainThreadQueue();
    final PlannerClient client = new PlannerClient(Runnable::run, main, "gtnhplannerprojector/test");
    volatile int status = 200; volatile String body;

    @BeforeEach void start() throws IOException {
        body = PayloadParserTest.sampleText();
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", ex -> {
            ByteArrayOutputStream in = new ByteArrayOutputStream(); byte[] b = new byte[4096]; int n;
            while ((n = ex.getRequestBody().read(b)) > 0) in.write(b, 0, n);
            seen.add(ex.getRequestMethod() + " " + ex.getRequestURI() + " auth=" + ex.getRequestHeaders().getFirst("Authorization")
                + " name=" + ex.getRequestHeaders().getFirst("X-Planner-Name") + " type=" + ex.getRequestHeaders().getFirst("Content-Type")
                + " body=" + new String(in.toByteArray(), UTF_8));
            byte[] out = body.getBytes(UTF_8);
            ex.sendResponseHeaders(status, out.length); ex.getResponseBody().write(out); ex.close();
        });
        server.start();
        base = "http://127.0.0.1:" + server.getAddress().getPort();
    }
    @AfterEach void stop() { server.stop(0); }
    private String fetchError(String b, String id) { Result<ProjectorData> r = new Result<>(); client.fetchProjector(b, id, "gpt_abc", "Steve", r); main.drain(); return r.error; }

    @Test void fetchesTheLayoutWithTheTokenAndAnswersOnTheGameThread() {
        Result<ProjectorData> r = new Result<>();
        client.fetchProjector(base, "Pr0jectAb1", "gpt_abc", "Steve", r);
        assertNull(r.value);
        assertEquals(1, main.drain());
        assertEquals("Steel line", r.value.name);
        assertEquals("GET /api/projects/Pr0jectAb1/projector auth=Bearer gpt_abc name=Steve type=null body=", seen.get(0));
    }

    @Test void ticksAStepWithOneMarkOp() {
        body = "{\"rev\":8}";
        Result<Integer> r = new Result<>();
        client.markStep(base, "Pr0jectAb1", "gpt_abc", "Steve Two", "layout:place:s1", r);
        main.drain();
        assertEquals(Integer.valueOf(8), r.value);
        assertEquals("POST /api/projects/Pr0jectAb1/ops auth=Bearer gpt_abc name=Steve%20Two type=application/json; charset=utf-8 "
            + "body={\"ops\":[{\"op\":\"mark\",\"row\":\"step:layout:place:s1\",\"on\":true}]}", seen.get(0));
    }

    @Test void mapsARevokedTokenAnUnknownProjectAndADeadAddressToPlainMessages() throws IOException {
        status = 401; body = "{\"error\":\"auth\"}";
        assertEquals("The planner refused this token for project P1. Create a new one in the project's In-game projector panel and run /planner load P1 <token>", fetchError(base, "P1"));
        status = 404; body = "{\"error\":\"not-found\",\"message\":\"x\"}";
        assertEquals("Project P1 was not found at " + base, fetchError(base, "P1"));
        status = 503; body = "{\"error\":\"no-export\",\"message\":\"No recipe export yet — run npm run export\"}";
        assertEquals("The planner is not ready: No recipe export yet — run npm run export", fetchError(base, "P1"));
        status = 500; body = "{\"error\":\"layout-failed\",\"message\":\"The line layout failed: boom\"}";
        assertEquals("The planner answered HTTP 500: The line layout failed: boom", fetchError(base, "P1"));
        int dead; try (ServerSocket s = new ServerSocket(0, 1, InetAddress.getByName("127.0.0.1"))) { dead = s.getLocalPort(); }
        String deadBase = "http://127.0.0.1:" + dead, e = fetchError(deadBase, "P1");
        assertTrue(e.startsWith("Cannot reach the planner at " + deadBase + " (ConnectException: "), e);
        assertTrue(e.endsWith("). Is it running? Set its address with /planner url <url>"), e);
    }

    private String markError(String id) { Result<Integer> r = new Result<>(); client.markStep(base, id, "gpt_abc", "Steve", "layout:place:s1", r); main.drain(); return r.error; }
    private static String filler(int n) { char[] c = new char[n]; Arrays.fill(c, 'x'); return new String(c); }

    @Test void passesOnThePlannersOwnWordsForOtherAnswers() {
        status = 403; body = "{\"error\":\"token-scope\",\"message\":\"A projector token can only tick build steps\"}";
        assertEquals("A projector token can only tick build steps", markError("P1"));
        status = 401; body = "{\"error\":\"auth\",\"message\":\"Log in first\"}";                       // a tick is refused in the same words
        assertEquals("The planner refused this token for project P1. Create a new one in the project's In-game projector panel and run /planner load P1 <token>", markError("P1"));
        status = 502; body = "<html>" + filler(300) + "</html>";
        assertEquals("The planner answered HTTP 502: <html>" + filler(194), fetchError(base, "P1"));
        body = "";
        assertEquals("The planner answered HTTP 502: Bad Gateway", fetchError(base, "P1"));
        status = 200; body = "{";
        assertTrue(fetchError(base, "P1").startsWith("The planner sent something that is not a projector layout ("));
        body = "{}";
        assertEquals("The planner did not confirm the tick (its answer has no rev)", markError("P1"));
        String e = fetchError("http://127.0.0.1:99999", "P1");                                         // the JDK throws a RuntimeException here
        assertTrue(e.startsWith("Cannot reach the planner at http://127.0.0.1:99999 (") && e.contains("port out of range"), e);
    }

    @Test void refusesAnAnswerLargerThan8MiB() {
        body = filler(PlannerClient.MAX_BODY_BYTES + 1);
        assertEquals("The planner's answer is larger than 8 MiB", fetchError(base, "P1"));
        server.createContext("/api/projects/Chunked/", ex -> {
            ex.sendResponseHeaders(200, 0);                                                             // no length up front
            byte[] kib = filler(1024).getBytes(UTF_8);
            try (OutputStream out = ex.getResponseBody()) { for (int i = 0; i <= 8 * 1024; i++) out.write(kib); }
        });
        assertEquals("The planner's answer is larger than 8 MiB", fetchError(base, "Chunked"));
        body = filler(PlannerClient.MAX_BODY_BYTES);                                                    // 8 MiB itself is read
        assertTrue(fetchError(base, "P1").startsWith("The planner sent something that is not a projector layout ("));
    }

    @Test void neverFollowsARedirectAndSendsItsOwnHeaders() {
        List<String> headers = new ArrayList<>();
        server.createContext("/api/projects/Moved/", ex -> {
            headers.add(ex.getRequestHeaders().getFirst("Accept") + " | " + ex.getRequestHeaders().getFirst("User-Agent"));
            ex.getResponseHeaders().set("Location", base + "/api/projects/Pr0jectAb1/projector");
            ex.sendResponseHeaders(302, -1); ex.close();
        });
        String e = fetchError(base, "Moved");
        assertTrue(e.startsWith("The planner answered HTTP 302: "), e);                                 // then the server's reason phrase
        assertEquals(Collections.emptyList(), seen);                                                     // the token went nowhere else
        assertEquals(Collections.singletonList("application/json | gtnhplannerprojector/test"), headers);
    }

    @Test void drainRunsWhatWasQueuedWhenItStartedAndOutlivesAThrowingTask() {
        List<String> ran = new ArrayList<>();
        main.post(() -> { ran.add("a"); main.post(() -> ran.add("posted while draining")); });
        main.post(() -> { throw new IllegalStateException("boom"); });
        main.post(() -> ran.add("c"));
        ByteArrayOutputStream err = new ByteArrayOutputStream(); PrintStream old = System.err;
        System.setErr(new PrintStream(err, true));
        try { assertEquals(3, main.drain()); } finally { System.setErr(old); }
        assertEquals(Arrays.asList("a", "c"), ran);
        assertTrue(err.toString().contains("java.lang.IllegalStateException: boom"), err.toString());
        assertEquals(1, main.drain());
        assertEquals(Arrays.asList("a", "c", "posted while draining"), ran);
        assertEquals(0, main.drain());
    }
}
