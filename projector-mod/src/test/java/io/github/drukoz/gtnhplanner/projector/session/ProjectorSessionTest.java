package io.github.drukoz.gtnhplanner.projector.session;

import static org.junit.jupiter.api.Assertions.*;
import com.google.gson.JsonArray;
import com.google.gson.JsonNull;
import com.google.gson.JsonObject;
import io.github.drukoz.gtnhplanner.projector.check.FakeWorld;
import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.model.*;
import io.github.drukoz.gtnhplanner.projector.net.*;
import io.github.drukoz.gtnhplanner.projector.view.ViewFilter;
import java.io.StringReader;
import java.nio.file.Path;
import java.util.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.io.TempDir;

class ProjectorSessionTest {
    static final class FakeApi implements PlannerApi {
        final List<String> calls = new ArrayList<>(); final Deque<Callback<ProjectorData>> fetches = new ArrayDeque<>(); final Deque<Callback<Integer>> marks = new ArrayDeque<>();
        public void fetchProjector(String base, String id, String token, String player, Callback<ProjectorData> cb) { calls.add("fetch " + base + " " + id + " " + token + " " + player); fetches.add(cb); }
        public void markStep(String base, String id, String token, String player, String stepId, Callback<Integer> cb) { calls.add("mark " + id + " " + stepId + " " + player); marks.add(cb); }
        long markCalls() { return calls.stream().filter(c -> c.startsWith("mark ")).count(); }
    }
    @TempDir Path dir;
    final List<String> chat = new ArrayList<>(); final FakeApi api = new FakeApi();
    int dim = 0; long now = 1_000_000;
    ProjectorSession s;
    final ProjectorSession.Env env = new ProjectorSession.Env() {
        public String serverAddress() { return "mc.example.org:25565"; } public String playerName() { return "Steve"; }
        public int dimension() { return dim; } public long nowMs() { return now; } public void chat(String m) { chat.add(m); } };

    @BeforeEach void setUp() { s = new ProjectorSession(ProjectorConfig.load(dir.resolve("c.properties").toFile()), api, env); }
    private void loadSample() throws Exception { s.run(Command.load("Pr0jectAb1", "gpt_abc")); api.fetches.poll().done(PayloadParserTest.sample()); }
    private String last() { return chat.get(chat.size() - 1); }
    private void placeAndCheck(FakeWorld w) { s.tick(w, 0); s.tick(w, 20); }

    @Test void loadSavesTheTokenAndShowsTheLine() throws Exception {
        loadSample();
        assertEquals("gpt_abc", ProjectorConfig.load(dir.resolve("c.properties").toFile()).token("Pr0jectAb1"));
        assertEquals("fetch http://mc.example.org:8765 Pr0jectAb1 gpt_abc Steve", api.calls.get(0));
        assertEquals(Arrays.asList("[Planner] Loading project Pr0jectAb1 from http://mc.example.org:8765…",
            "[Planner] Loaded \"Steel line\": 10 blocks in 7 build steps. Showing all layers."), chat);
        assertTrue(s.visibleHere());
        assertEquals(Collections.singletonList("Planner: Steel line — 0/10 placed, 0 wrong"), s.hudLines());
        s.run(Command.load("Pr0jectAb1", null));
        assertEquals("fetch http://mc.example.org:8765 Pr0jectAb1 gpt_abc Steve", api.calls.get(1));   // the saved token
    }

    @Test void loadWithoutATokenSaysWhereToGetOne() {
        s.run(Command.load("P9", null));
        assertEquals("[Planner] No token saved for project P9. Copy the /planner load command from the project's In-game projector panel.", last());
        assertTrue(api.calls.isEmpty());
    }

    @Test void drawsNothingInAnotherDimension() throws Exception {
        dim = 7;
        loadSample();
        assertTrue(last().endsWith(" The line is in dimension 0; you are in 7."));
        assertFalse(s.visibleHere());
        FakeWorld w = new FakeWorld();
        placeAndCheck(w);
        assertEquals(0, w.probes);
        assertEquals(Collections.singletonList("Planner: Steel line — the line is in dimension 0"), s.hudLines());
    }

    @Test void ticksAStepAfterTwoChecksAndTellsThePlayer() throws Exception {
        loadSample();
        FakeWorld w = new FakeWorld().placeStepS1();
        s.tick(w, 0); s.tick(w, 10);
        assertEquals(0, api.markCalls());
        s.tick(w, 20);
        assertEquals("mark Pr0jectAb1 layout:place:s1 Steve", api.calls.get(1));
        api.marks.poll().done(8);
        assertEquals("[Planner] Step 2 done: Place 2× Basic Macerator facing the middle row (ticked as Steve)", last());
        s.tick(w, 40); s.tick(w, 60);
        assertEquals(1, api.markCalls());
        assertTrue(s.hudLines().get(0).startsWith("Planner: Steel line — 2/10 placed"));
        assertEquals("Basic Macerator: placed correctly; cover: Conveyor Module (LV) on the south face", s.lookingAt(102, 64, 201));
        assertNull(s.lookingAt(0, 0, 0));
    }

    @Test void keepsTheLoadedGhostsWhenARefreshFails() throws Exception {
        loadSample();
        now += 60_000;
        s.tick(new FakeWorld(), 1);
        assertEquals("fetch http://mc.example.org:8765 Pr0jectAb1 gpt_abc Steve", api.calls.get(1));
        api.fetches.poll().failed("Cannot reach the planner at http://mc.example.org:8765 (ConnectException: Connection refused). Is it running? Set its address with /planner url <url>");
        assertTrue(s.visibleHere());
        assertTrue(s.hudLines().get(1).startsWith("Planner: Cannot reach the planner at http://mc.example.org:8765"));
        int chatted = chat.size();
        now += 1_000; s.tick(new FakeWorld(), 2);
        assertEquals(2, api.calls.size());                          // no retry loop
        assertEquals(chatted, chat.size());                         // a background refresh never spams chat
    }

    @Test void replacesTheLayoutWhenTheVersionChangesAndDropsMarksForVanishedSteps() throws Exception {
        loadSample();
        FakeWorld w = new FakeWorld().placeStepS1();
        placeAndCheck(w);                                           // the mark for layout:place:s1 is in flight
        ProjectorData changed = PayloadParser.parse(new StringReader(PayloadParserTest.mutate(o -> {
            o.addProperty("version", "ffffffffffffffff");
            JsonArray steps = o.getAsJsonArray("steps"), kept = new JsonArray();   // ruling R11: Gson 2.2.4 has no JsonArray.remove(int)
            for (int i = 0; i < steps.size(); i++) if (i != 1) kept.add(steps.get(i));
            o.add("steps", kept);
            PayloadParserTest.block(o, 3).add("step", JsonNull.INSTANCE);
            PayloadParserTest.block(o, 4).add("step", JsonNull.INSTANCE);
        })));
        now += 60_000;
        s.tick(w, 21);
        api.fetches.poll().done(changed);
        assertEquals("[Planner] The line changed in the planner: reloaded \"Steel line\".", last());
        api.marks.poll().done(9);                                   // the old answer arrives late: nothing breaks
        s.tick(w, 40); s.tick(w, 60); s.tick(w, 80);
        assertEquals(1, api.markCalls());
        assertEquals(-1, s.data().stepByOrder(2));
    }

    @Test void stepAndLayerFilters() throws Exception {
        loadSample();
        s.run(Command.step("next"));
        assertEquals("[Planner] Showing step 2: Place 2× Basic Macerator facing the middle row", last());
        assertEquals(1, s.filter().stepIndex);
        placeAndCheck(new FakeWorld().placeStepS1()); api.marks.poll().done(8);
        s.run(Command.step("next"));                                // step 3 is done in the sample, step 2 now too
        assertEquals("[Planner] Showing step 4: Place 1× Low Voltage Transformer between the MV and LV cables, front (input) toward MV", last());
        s.run(Command.step("1"));
        assertEquals("[Planner] Step 1 has no blocks to show: Clear a 7×4 spot (2 high) and keep a 1-block path around it", last());
        s.run(Command.step("12"));
        assertEquals("[Planner] There is no step 12 (the steps are numbered 1 to 10).", last());
        s.run(Command.step("all")); s.run(Command.layer(65));
        assertEquals("[Planner] Showing layer y=65 (2 blocks).", last());
    }

    @Test void showsARenderFailureOnTheHud() throws Exception {
        loadSample();
        s.setRenderError("Ghost drawing failed: boom");
        assertEquals("Planner: Ghost drawing failed: boom", s.hudLines().get(s.hudLines().size() - 1));
        s.setRenderError(null);
        assertEquals(1, s.hudLines().size());
    }

    @Test void urlXrayReloadAndClear() throws Exception {
        s.run(Command.reload());
        assertEquals("[Planner] Nothing loaded. Use /planner load <project>.", last());
        s.run(Command.url("192.0.2.10:9000"));
        assertEquals("[Planner] Planner address: http://192.0.2.10:9000", last());
        assertEquals("http://192.0.2.10:9000", ProjectorConfig.load(dir.resolve("c.properties").toFile()).plannerUrl());
        s.run(Command.url("auto"));
        assertEquals("[Planner] Planner address: http://mc.example.org:8765", last());
        int v = s.renderVersion();
        s.run(Command.xray(null));
        assertEquals("[Planner] See-through ghosts on.", last());
        assertTrue(s.seeThrough()); assertTrue(s.renderVersion() > v);
        loadSample();
        s.run(Command.reload());
        assertEquals("[Planner] Reloading \"Steel line\"…", last());
        api.fetches.poll().done(PayloadParserTest.sample());
        assertEquals("[Planner] No changes.", last());
        s.run(Command.clear());
        assertEquals("[Planner] Ghosts cleared.", last());
        assertNull(s.data()); assertEquals(Collections.emptyList(), s.hudLines());
    }

    // Beyond the brief: one sent-steps set per project, answers that were overtaken, a refresh that works again, a late
    // tick answer, a tick that fails, a line that is not placed, the crosshair, renderVersion, commands that cannot run,
    // a config that cannot be saved.

    private static ProjectorData sampleWith(Consumer<JsonObject> change) throws Exception {
        return PayloadParser.parse(new StringReader(PayloadParserTest.mutate(change)));
    }

    @Test void ticksTheSameStepIdOnceInEachProject() throws Exception {      // step ids such as layout:place:s1 repeat between projects
        loadSample();
        FakeWorld w = new FakeWorld().placeStepS1();
        placeAndCheck(w); api.marks.poll().done(8);
        s.run(Command.load("Pr0jectCd2", "gpt_def"));
        api.fetches.poll().done(sampleWith(o -> o.addProperty("projectId", "Pr0jectCd2")));
        placeAndCheck(w);
        assertEquals("mark Pr0jectCd2 layout:place:s1 Steve", api.calls.get(api.calls.size() - 1));
        api.marks.poll().done(3);
        s.disconnected();
        s.run(Command.load("Pr0jectAb1", null)); api.fetches.poll().done(PayloadParserTest.sample());
        placeAndCheck(w); s.tick(w, 40);
        assertEquals(2, api.markCalls());                                       // never twice in one project, not even after a disconnect
    }

    @Test void ignoresTheAnswerToARequestThatWasOvertaken() throws Exception {
        s.run(Command.load("Pr0jectAb1", "gpt_abc"));
        s.run(Command.clear());
        api.fetches.poll().done(PayloadParserTest.sample());                   // the load comes back after the clear
        assertNull(s.data()); assertEquals("[Planner] Ghosts cleared.", last());
        s.run(Command.load("Pr0jectAb1", null));
        s.run(Command.load("Pr0jectCd2", "gpt_def"));
        api.fetches.poll().failed("Project Pr0jectAb1 was not found at http://mc.example.org:8765");   // the older load
        assertEquals("[Planner] Loading project Pr0jectCd2 from http://mc.example.org:8765…", last());
        api.fetches.poll().done(sampleWith(o -> o.addProperty("projectId", "Pr0jectCd2")));
        assertEquals("Pr0jectCd2", s.data().projectId);
    }

    @Test void aRefreshThatWorksAgainClearsTheErrorAndANewVersionKeepsOnlyTheLayer() throws Exception {
        loadSample();
        s.run(Command.layer(64)); s.run(Command.step("2"));
        now += 60_000; s.tick(new FakeWorld(), 1);
        now += 60_000; s.tick(new FakeWorld(), 2);                              // that refresh has not answered yet: no second one
        assertEquals(2, api.calls.size());
        api.fetches.poll().failed("Cannot reach the planner at http://mc.example.org:8765 (SocketTimeoutException: Read timed out). Is it running? Set its address with /planner url <url>");
        assertEquals("Planner: Cannot reach the planner at http://mc.example.org:8765 (SocketTimeoutException: Read time…", s.hudLines().get(1));
        s.tick(new FakeWorld(), 3);                                             // a minute after the failed one started
        api.fetches.poll().done(PayloadParserTest.sample());                   // the same version: only the ticks are read
        assertNull(s.lastError()); assertEquals(1, s.hudLines().size());
        assertEquals(new ViewFilter(64, 1), s.filter());
        now += 60_000; s.tick(new FakeWorld(), 4);
        api.fetches.poll().done(sampleWith(o -> o.addProperty("version", "ffffffffffffffff")));
        assertEquals(ViewFilter.ALL.withLayer(64), s.filter());                 // step indices may have changed
        s.run(Command.reload());
        api.fetches.poll().done(sampleWith(o -> o.addProperty("version", "eeeeeeeeeeeeeeee")));
        assertEquals("[Planner] Updated \"Steel line\": 10 blocks in 7 build steps.", last());
    }

    @Test void aLoadStartsOverWithEveryLayerAndStepAndNoError() throws Exception {
        loadSample();
        s.run(Command.layer(64)); s.run(Command.step("2"));
        now += 60_000; s.tick(new FakeWorld(), 1);
        api.fetches.poll().failed("Cannot reach the planner at http://mc.example.org:8765 (ConnectException: Connection refused). Is it running? Set its address with /planner url <url>");
        loadSample();
        assertEquals(ViewFilter.ALL, s.filter()); assertNull(s.lastError());
        assertEquals("[Planner] Loaded \"Steel line\": 10 blocks in 7 build steps. Showing all layers.", last());
    }

    @Test void aLateTickAnswerStillCountsWhenTheStepComesBack() throws Exception {
        loadSample();
        FakeWorld w = new FakeWorld().placeStepS1();
        placeAndCheck(w);                                                       // the tick of layout:place:s1 is on its way
        now += 60_000; s.tick(w, 21);
        api.fetches.poll().done(sampleWith(o -> {                              // meanwhile the step left the layout
            o.addProperty("version", "ffffffffffffffff");
            JsonArray steps = o.getAsJsonArray("steps"), kept = new JsonArray();
            for (int i = 0; i < steps.size(); i++) if (i != 1) kept.add(steps.get(i));
            o.add("steps", kept);
            PayloadParserTest.block(o, 3).add("step", JsonNull.INSTANCE);
            PayloadParserTest.block(o, 4).add("step", JsonNull.INSTANCE);
        }));
        api.marks.poll().done(9);
        assertEquals("[Planner] Step 2 done: Place 2× Basic Macerator facing the middle row (ticked as Steve)", last());
        now += 60_000; s.tick(w, 41);
        api.fetches.poll().done(PayloadParserTest.sample());                   // and came back
        placeAndCheck(w); s.tick(w, 40);
        assertEquals(1, api.markCalls());
    }

    @Test void tellsAFailedTickOncePerLoadAndTriesAgainAMinuteLater() throws Exception {
        loadSample();
        FakeWorld w = new FakeWorld().placeStepS1();
        placeAndCheck(w);
        api.marks.poll().failed("The planner answered HTTP 500: database is locked");
        assertEquals("[Planner] Could not tick step 2: The planner answered HTTP 500: database is locked", last());
        now += 59_999; s.tick(w, 40);
        assertEquals(1, api.markCalls());
        now += 1; s.tick(w, 60);                                                // a minute after the failure (a refresh starts too)
        assertEquals(2, api.markCalls());
        int told = chat.size();
        api.marks.poll().failed("The planner answered HTTP 500: database is locked");
        assertEquals(told, chat.size());
        api.fetches.poll().done(PayloadParserTest.sample());                   // that refresh
        loadSample();                                                           // after a new load the failure is news again
        placeAndCheck(w);
        api.marks.poll().failed("The planner answered HTTP 500: database is locked");
        assertEquals("[Planner] Could not tick step 2: The planner answered HTTP 500: database is locked", last());
    }

    @Test void aLineThatIsNotPlacedSaysWhyAndIsRefreshedButNotChecked() throws Exception {
        Consumer<JsonObject> offTheMap = o -> { o.addProperty("status", "no-world"); o.addProperty("message", "Not placed"); o.add("blocks", new JsonArray()); o.add("steps", new JsonArray()); };
        s.run(Command.load("Pr0jectAb1", "gpt_abc"));
        api.fetches.poll().done(sampleWith(offTheMap));
        assertEquals("[Planner] \"Steel line\": Not placed", last());
        assertFalse(s.visibleHere());
        assertEquals(Collections.singletonList("Planner: Steel line — Not placed"), s.hudLines());
        s.run(Command.step("next"));
        assertEquals("[Planner] \"Steel line\": Not placed", last());
        FakeWorld w = new FakeWorld();
        placeAndCheck(w);
        assertEquals(0, w.probes);
        now += 60_000; s.tick(w, 1);                                            // still refreshed, to see it once it is placed
        assertEquals(2, api.calls.size());
        api.fetches.poll().done(sampleWith(offTheMap));
        s.run(Command.reload());
        api.fetches.poll().done(sampleWith(offTheMap.andThen(o -> o.addProperty("version", "ffffffffffffffff"))));
        assertEquals("[Planner] \"Steel line\": Not placed", last());          // not "Updated …: 0 blocks in 0 build steps."
    }

    // The review of the EnderIO single pipe: a fluids step that lays its conduits in the line's bundles only places no block
    // of its own, and is still a step with blocks to show, and to tick once its fluid conduits are in.
    @Test void showsAndTicksAStepThatOnlyLaysConduitsInBundles() throws Exception {
        s.run(Command.load("Pr0jectAb1", "gpt_abc")); api.fetches.poll().done(PayloadParserTest.bundleSample());
        assertEquals("[Planner] Loaded \"Steel line\": 12 blocks in 8 build steps. Showing all layers.", last());
        s.run(Command.step("11"));
        assertEquals("[Planner] Showing step 11: " + PayloadParserTest.bundleSample().steps.get(PayloadParserTest.FLUIDS).text, last());
        FakeWorld w = new FakeWorld().placeLine("item");
        placeAndCheck(w);
        assertEquals(Collections.singletonList("mark Pr0jectAb1 layout:logistics:line Steve"), marks());   // not the fluids step
        assertEquals(PayloadParserTest.BUNDLE_LABEL + ": not all its conduits placed yet", s.lookingAt(106, 64, 202));
        assertTrue(s.hudLines().get(0).startsWith("Planner: Steel line — 0/2 placed, 0 wrong · showing step 11"), s.hudLines().get(0));
        s.run(Command.step("7"));                                              // the line step, whose conduit the bundle holds
        assertEquals(PayloadParserTest.BUNDLE_LABEL + ": placed correctly", s.lookingAt(106, 64, 202));
        assertTrue(s.hudLines().get(0).startsWith("Planner: Steel line — 5/5 placed, 0 wrong · showing step 7"), s.hudLines().get(0));
        s.run(Command.step("all"));
        assertEquals(PayloadParserTest.BUNDLE_LABEL + ": not all its conduits placed yet", s.lookingAt(106, 64, 202));
        api.marks.poll().done(8);
        placeAndCheck(w.placeLine("item", "liquid_ender"));
        assertEquals(Arrays.asList("mark Pr0jectAb1 layout:logistics:line Steve", "mark Pr0jectAb1 layout:logistics:fluids Steve"), marks());
        assertEquals(PayloadParserTest.BUNDLE_LABEL + ": placed correctly", s.lookingAt(106, 64, 202));
    }
    private List<String> marks() { List<String> m = new ArrayList<>(); for (String c : api.calls) if (c.startsWith("mark ")) m.add(c); return m; }

    @Test void describesOnlyAShownBlockUnderTheCrosshair() throws Exception {
        loadSample();
        placeAndCheck(new FakeWorld().placeStepS1());
        s.run(Command.layer(65));
        assertNull(s.lookingAt(102, 64, 201));                                  // hidden by the layer filter
        s.run(Command.layer(null));
        assertEquals("[Planner] Showing all layers.", last());
        assertNotNull(s.lookingAt(102, 64, 201));
        dim = -1;                                                               // the player went to the Nether
        assertFalse(s.visibleHere()); assertNull(s.lookingAt(102, 64, 201));
        assertEquals(Collections.singletonList("Planner: Steel line — the line is in dimension 0"), s.hudLines());
    }

    @Test void renderVersionChangesOnlyWithWhatIsDrawn() throws Exception {
        int v = s.renderVersion();
        loadSample();
        assertTrue(s.renderVersion() > v); v = s.renderVersion();
        FakeWorld w = new FakeWorld();
        s.tick(w, 0);                                                           // the first check finds what is there
        assertTrue(s.renderVersion() > v); v = s.renderVersion();
        s.tick(w, 20); s.run(Command.layer(null)); s.run(Command.xray(false));
        assertEquals(v, s.renderVersion());                                     // nothing drawn changed
        s.run(Command.step("2"));
        assertTrue(s.renderVersion() > v);
    }

    @Test void explainsCommandsThatCannotRun() {
        s.run(Command.help());
        assertEquals("[Planner] Usage: " + CommandParser.USAGE, last());
        s.run(Command.layer(64));
        assertEquals("[Planner] Nothing loaded. Use /planner load <project>.", last());
        s.run(Command.step("next"));
        assertEquals("[Planner] Nothing loaded. Use /planner load <project>.", last());
        s.run(Command.url("ftp://planner.example.org"));
        assertEquals("[Planner] Not a planner address: ftp://planner.example.org", last());
        assertEquals("", ProjectorConfig.load(dir.resolve("c.properties").toFile()).plannerUrl());
    }

    @Test void tellsWhenTheConfigCannotBeSavedAndLoadsAnyway() {
        s = new ProjectorSession(ProjectorConfig.load(dir.resolve("missing/c.properties").toFile()), api, env);
        s.run(Command.load("Pr0jectAb1", "gpt_abc"));
        assertTrue(chat.get(0).startsWith("[Planner] Could not save the projector config: "), chat.get(0));
        assertEquals("[Planner] Loading project Pr0jectAb1 from http://mc.example.org:8765…", chat.get(1));
        assertEquals("fetch http://mc.example.org:8765 Pr0jectAb1 gpt_abc Steve", api.calls.get(0));
    }
}
