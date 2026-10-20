package io.github.drukoz.gtnhplanner.projector.session;

import io.github.drukoz.gtnhplanner.projector.check.BlockState;
import io.github.drukoz.gtnhplanner.projector.check.BuildCheck;
import io.github.drukoz.gtnhplanner.projector.check.StepTracker;
import io.github.drukoz.gtnhplanner.projector.check.WorldProbe;
import io.github.drukoz.gtnhplanner.projector.config.ProjectorConfig;
import io.github.drukoz.gtnhplanner.projector.model.PlannedBlock;
import io.github.drukoz.gtnhplanner.projector.model.PlannedStep;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import io.github.drukoz.gtnhplanner.projector.net.Callback;
import io.github.drukoz.gtnhplanner.projector.net.PlannerApi;
import io.github.drukoz.gtnhplanner.projector.net.PlannerUrl;
import io.github.drukoz.gtnhplanner.projector.view.AimRay;
import io.github.drukoz.gtnhplanner.projector.view.HudText;
import io.github.drukoz.gtnhplanner.projector.view.ViewFilter;
import java.io.IOException;
import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * The projector for one game run (spec §3.13): the line loaded with {@code /planner load}, which of its blocks are
 * shown, its build check and step ticks, and what the chat and the HUD say. The {@code client} package feeds it the
 * commands, the client ticks and the disconnect, and reads it to draw.
 *
 * <p>Each request goes to the planner address in effect when it is sent: the one the player set, else the Minecraft
 * server's host on the planner port. Only the latest fetch's answer counts: a load, reload, clear or disconnect makes
 * the answers still on their way stale, and they are dropped. A tick's answer always goes to the tracker that asked
 * for it, even when another layout has been loaded since. Used on the game thread only: commands, ticks and every
 * answer, which the {@link PlannerApi} hands back there.
 */
public final class ProjectorSession {

    /** What the session needs from the game; the {@code client} package answers it from Minecraft. */
    public interface Env {

        /** The address of the Minecraft server the client is connected to, as typed; null or blank in single player. */
        String serverAddress();

        /** The player's name: every request carries it, so steps are ticked in that name. */
        String playerName();

        /** The dimension the player is in. */
        int dimension();

        /** The wall clock, in milliseconds. */
        long nowMs();

        /** Shows one line in the player's chat. */
        void chat(String message);
    }

    /** The start of every chat line the session sends. */
    public static final String PREFIX = "[Planner] ";

    private static final String NOTHING_LOADED = "Nothing loaded. Use /planner load <project>.";
    /** How much of a step's text the chat line that says it was ticked shows. */
    private static final int TICKED_TEXT_LENGTH = 60;
    /** How much of the last error the HUD shows. */
    private static final int ERROR_TEXT_LENGTH = 90;

    /** What a fetch is for, which decides what its answer does. */
    private enum Fetch { LOAD, RELOAD, REFRESH }

    private final ProjectorConfig config;
    private final PlannerApi api;
    private final Env env;
    /**
     * The steps this session has ticked, per project id. Step ids repeat between projects (every line has a
     * {@code layout:place:s1}), so each project has its own set; they last as long as the session.
     */
    private final Map<String, Set<String>> sentByProject = new HashMap<>();

    // The loaded line; data, projectId, token, check and tracker are all null when nothing is loaded.
    private ProjectorData data;
    /** The project id and token the loaded line was fetched with; its refreshes and ticks use them. */
    private String projectId, token;
    private BuildCheck check;
    private StepTracker tracker;
    /** {@code "x,y,z"} → the index in {@link ProjectorData#blocks} of the first block there. */
    private final Map<String, Integer> blockAt = new HashMap<>();
    /** The failed-tick lines told since the line was loaded, so a retry that fails the same way stays quiet. */
    private final Set<String> toldFailures = new HashSet<>();

    private ViewFilter filter = ViewFilter.ALL;
    private int renderVersion;
    /** Why the last background refresh failed, shown on the HUD until a fetch works; null when it did not fail. */
    private String lastError;
    private String renderError;

    /** How long a find lasts at most, in milliseconds. */
    private static final long FIND_MS = 60_000;

    /** The ghosts under the crosshair, nearest first, and where the eye was; not saved. */
    private List<AimRay.Hit> hits = Collections.emptyList();
    private double[] eye;
    /** Whether {@code G} hid every ghost; lasts the game run and survives {@code /planner clear}. */
    private boolean ghostsHidden;
    /** The block being found (index in {@link ProjectorData#blocks}), −1 for none, and when it ends. */
    private int foundIndex = -1;
    private long foundUntil;

    /** Numbers the fetches: an answer to any but the latest is stale. */
    private int fetchNumber;
    /** Whether the latest fetch is still waiting for its answer. */
    private boolean fetching;
    private long lastFetchStart;

    public ProjectorSession(ProjectorConfig config, PlannerApi api, Env env) {
        this.config = config;
        this.api = api;
        this.env = env;
    }

    /** Carries out one command; every answer goes to the chat as {@link #PREFIX} + text. */
    public void run(Command c) {
        switch (c.kind) {
            case LOAD:
                load(c.projectId, c.token);
                break;
            case CLEAR:
                forget();
                chat("Ghosts cleared.");
                break;
            case LAYER:
                layer(c.layer);
                break;
            case STEP:
                step(c.step);
                break;
            case RELOAD:
                reload();
                break;
            case URL:
                url(c.url);
                break;
            case XRAY:
                xray(c.on);
                break;
            case HELP:
                chat("Usage: " + CommandParser.USAGE);
                break;
        }
    }

    /**
     * Every client tick (END phase), in this order: nothing loaded, nothing to do; a quiet refresh when no fetch is
     * running and the last one started at least {@code refreshSeconds} ago; nothing more for a line that is not placed
     * or is in another dimension, or on a tick that is not a multiple of {@code checkIntervalTicks}; else the build
     * check (a changed block state adds 1 to {@link #renderVersion()}) and a tick for every step that is due.
     */
    public void tick(WorldProbe probe, long tick) {
        if (data == null) return;
        long now = env.nowMs();
        if (!fetching && now - lastFetchStart >= config.refreshSeconds() * 1000L) {
            fetch(Fetch.REFRESH, base(), projectId, token);
        }
        if (!visibleHere() || tick % config.checkIntervalTicks() != 0) return;
        if (check.run(probe)) renderVersion++;
        for (String stepId : tracker.due(check.states(), now)) mark(stepId);
    }

    /** The client left the server: forgets the loaded line, keeps the config and the steps this session ticked. */
    public void disconnected() {
        forget();
    }

    /** The loaded line, or null when nothing is loaded. */
    public ProjectorData data() {
        return data;
    }

    /**
     * What the build check last found for each block of {@link #data()}, by the same index, or null when nothing is
     * loaded: the live array, which callers must not change.
     */
    public BlockState[] states() {
        return check == null ? null : check.states();
    }

    /** Which blocks are shown: {@link ViewFilter#ALL} after a load and when nothing is loaded. */
    public ViewFilter filter() {
        return filter;
    }

    /** Whether ghosts show through other blocks ({@code /planner xray}, saved in the config). */
    public boolean seeThrough() {
        return config.seeThrough();
    }

    /** Whether there is something to draw: a placed line in the player's dimension. */
    public boolean visibleHere() {
        return data != null && data.placed() && data.dim == env.dimension();
    }

    /** Goes up by 1 whenever the loaded line, the filter, a block state or see-through changes. */
    public int renderVersion() {
        return renderVersion;
    }

    /**
     * The HUD lines, none when nothing is loaded: {@code Planner: <name> — <why>} for a line that is not placed,
     * {@link HudText#otherDimension} in another dimension, else {@link HudText#summary}; then the last refresh failure
     * (shortened to 90 characters) and the renderer's failure, each as {@code Planner: <text>}. While a line is
     * {@link #visibleHere}: then {@code Finding: <label> — <direction>} while a block is being found,
     * {@link HudText#stacked} for the aim and {@link HudText#needs} for the {@link #currentStep}. A new list each call.
     */
    public List<String> hudLines() {
        List<String> lines = new ArrayList<>(3);
        if (data == null) return lines;
        if (!data.placed()) lines.add("Planner: " + data.name + " — " + whyNotPlaced(data));
        else if (data.dim != env.dimension()) lines.add(HudText.otherDimension(data));
        else lines.add(HudText.summary(data, check.states(), filter));
        if (lastError != null) lines.add("Planner: " + HudText.shorten(lastError, ERROR_TEXT_LENGTH));
        if (renderError != null) lines.add("Planner: " + renderError);
        if (!visibleHere()) return lines;
        int f = found();
        if (f >= 0 && eye != null) {
            PlannedBlock b = data.blocks.get(f);
            lines.add("Finding: " + b.label + " — " + HudText.direction(b.x - (int) Math.floor(eye[0]), b.y - (int) Math.floor(eye[1]), b.z - (int) Math.floor(eye[2])));
        }
        lines.addAll(HudText.stacked(data, hits));
        lines.addAll(HudText.needs(data, check.states(), currentStep()));
        return lines;
    }

    /**
     * The lines of the name tag and tooltip of block {@code blockIndex} ({@link HudText#blockLines}); a block placed for
     * the shown step ({@link BlockState#placedFor}: a conduit bundle without the fluids step's conduit, under the line
     * step) reads as placed correctly, as its ghost is green and the HUD counts it. Empty when nothing is loaded or the
     * index is not a block's.
     */
    public List<String> tagLines(int blockIndex) {
        if (data == null || blockIndex < 0 || blockIndex >= data.blocks.size()) return Collections.emptyList();
        PlannedBlock b = data.blocks.get(blockIndex);
        BlockState state = check.state(blockIndex);
        return HudText.blockLines(b, state.placedFor(b, filter.stepIndex) ? BlockState.CORRECT : state);
    }

    /**
     * Takes where the player looks: the drawn ghosts on the ray from {@code eye} along {@code look}, up to
     * {@code maxDistance}, nearest first. A ghost is drawn when the line is {@link #visibleHere}, the ghosts are not
     * hidden, the filter shows it and it is within {@code maxDistance} of the eye. {@code stops} (a real block in the
     * way) is ignored while {@link #seeThrough}. Aiming at the block being found ends the finding.
     */
    public void aim(double[] eye, double[] look, AimRay.Stops stops) {
        this.eye = eye.clone();
        hits = Collections.emptyList();
        if (!visibleHere() || ghostsHidden) return;
        final double[] from = this.eye;
        final double max = config.maxDistance();
        AimRay.Ghosts ghosts = (x, y, z) -> {
            Integer i = blockAt.get(key(x, y, z));
            if (i == null) return -1;
            PlannedBlock b = data.blocks.get(i);
            return filter.shows(b) && ViewFilter.within(b, from[0], from[1], from[2], max) ? i : -1;
        };
        hits = Collections.unmodifiableList(AimRay.walk(from, look, max, ghosts, seeThrough() ? (x, y, z) -> false : stops));
        if (!hits.isEmpty() && hits.get(0).block == foundIndex) foundIndex = -1;
    }

    /** The ghosts under the crosshair, nearest first; unmodifiable. */
    public List<AimRay.Hit> aimHits() {
        return hits;
    }

    /** The nearest ghost under the crosshair (its index in {@link ProjectorData#blocks}), or −1. */
    public int aimed() {
        return hits.isEmpty() ? -1 : hits.get(0).block;
    }

    /** Starts finding block {@code blockIndex}: the HUD says where it is until it is aimed at, 60 s pass or a screen opens. */
    public void find(int blockIndex) {
        if (data == null || blockIndex < 0 || blockIndex >= data.blocks.size()) return;
        foundIndex = blockIndex;
        foundUntil = env.nowMs() + FIND_MS;
    }

    /** The block being found, or −1 when none is, or its 60 seconds are over. */
    public int found() {
        if (foundIndex >= 0 && env.nowMs() >= foundUntil) foundIndex = -1;
        return foundIndex;
    }

    /** The planner screen was opened: the finding ends. */
    public void screenOpened() {
        foundIndex = -1;
    }

    /** Whether every ghost is hidden ({@code G}); not saved. */
    public boolean ghostsHidden() {
        return ghostsHidden;
    }

    /** Hides or shows every ghost; a change redraws and clears the aim. */
    public void setGhostsHidden(boolean hidden) {
        if (hidden == ghostsHidden) return;
        ghostsHidden = hidden;
        hits = Collections.emptyList();
        renderVersion++;
    }

    /**
     * The step the HUD and the planner screen are about: the filter's, else the lowest-numbered step with blocks
     * ({@link PlannedStep#hasBlocks}) that is not done, else −1. Says nothing in the chat.
     */
    public int currentStep() {
        if (data == null) return -1;
        return filter.stepIndex >= 0 ? filter.stepIndex : openStep();
    }

    private int openStep() {
        int next = -1;
        for (int i = 0; i < data.steps.size(); i++) {
            PlannedStep s = data.steps.get(i);
            if (!s.hasBlocks() || tracker.isDone(s.id)) continue;
            if (next < 0 || s.order < data.steps.get(next).order) next = i;
        }
        return next;
    }

    /** Whether the step (an index in {@link ProjectorData#steps}) is done; false when nothing is loaded. */
    public boolean stepDone(int stepIndex) {
        return data != null && stepIndex >= 0 && stepIndex < data.steps.size() && tracker.isDone(data.steps.get(stepIndex).id);
    }

    /** The index of the first block at that position, whatever the filter, or −1. */
    public int blockIndexAt(int x, int y, int z) {
        Integer i = data == null ? null : blockAt.get(key(x, y, z));
        return i == null ? -1 : i;
    }

    /** The ids of the projects with a saved token, sorted. */
    public List<String> savedProjects() {
        return config.projectIds();
    }

    /** Why the last background refresh failed, or null. */
    public String lastError() {
        return lastError;
    }

    /** The renderer's failure text, shown on the HUD; null when drawing works. */
    public void setRenderError(String messageOrNull) {
        renderError = messageOrNull;
    }

    private void load(String id, String typedToken) {
        String t = typedToken != null ? typedToken : config.token(id);
        if (t == null) {
            chat("No token saved for project " + id + ". Copy the /planner load command from the project's In-game projector panel.");
            return;
        }
        if (typedToken != null) {
            config.setToken(id, typedToken);
            save();
        }
        String base = baseOrTell();
        if (base == null) return;
        chat("Loading project " + id + " from " + base + "…");
        fetch(Fetch.LOAD, base, id, t);
    }

    private void reload() {
        if (data == null) {
            chat(NOTHING_LOADED);
            return;
        }
        String base = baseOrTell();
        if (base == null) return;
        chat("Reloading \"" + data.name + "\"…");
        fetch(Fetch.RELOAD, base, projectId, token);
    }

    /** Asks for the line; when the latest fetch is answered, {@link #fetched} (or the failure branch) takes it. */
    private void fetch(final Fetch kind, String base, final String id, final String t) {
        final int number = ++fetchNumber;
        fetching = true;
        lastFetchStart = env.nowMs();
        api.fetchProjector(base, id, t, env.playerName(), new Callback<ProjectorData>() {
            @Override
            public void done(ProjectorData d) {
                if (number != fetchNumber) return; // a later fetch, a clear or a disconnect overtook it
                fetching = false;
                fetched(kind, id, t, d);
            }

            @Override
            public void failed(String message) {
                if (number != fetchNumber) return;
                fetching = false;
                if (kind == Fetch.REFRESH) lastError = message; // quietly: the HUD says it, the ghosts stay
                else chat(message);
            }
        });
    }

    /**
     * A load shows the new line with every layer and step. A refresh or reload with the version already loaded only
     * takes the planner's ticks (and, as the planner answered, clears the last error); with another version it shows
     * the new line on the same layer, but every step, as the step indices may have changed.
     */
    private void fetched(Fetch kind, String id, String t, ProjectorData d) {
        if (kind == Fetch.LOAD) {
            install(d, id, t, ViewFilter.ALL);
            toldFailures.clear();
            chat(loadedText(d));
        } else if (d.version.equals(data.version)) {
            tracker.serverDone(d.doneStepIds());
            lastError = null;
            if (kind == Fetch.RELOAD) chat("No changes.");
        } else {
            install(d, id, t, ViewFilter.ALL.withLayer(filter.layerY));
            if (kind == Fetch.REFRESH) chat("The line changed in the planner: reloaded \"" + d.name + "\".");
            else chat(d.placed() ? "Updated \"" + d.name + "\": " + sizeText(d) + "." : notPlacedText(d));
        }
    }

    /** Makes {@code d} the loaded line: a new build check and step tracker, its block map, no last error. */
    private void install(ProjectorData d, String id, String t, ViewFilter f) {
        PlannedBlock finding = found() >= 0 ? data.blocks.get(foundIndex) : null;
        hits = Collections.emptyList();
        data = d;
        projectId = id;
        token = t;
        check = new BuildCheck(d);
        tracker = new StepTracker(d, sentByProject.computeIfAbsent(id, project -> new HashSet<>()));
        blockAt.clear();
        for (int i = 0; i < d.blocks.size(); i++) {
            PlannedBlock b = d.blocks.get(i);
            blockAt.putIfAbsent(key(b.x, b.y, b.z), i);
        }
        foundIndex = -1;
        if (finding != null) {
            int again = blockIndexAt(finding.x, finding.y, finding.z);
            if (again >= 0 && d.blocks.get(again).id.equals(finding.id)) foundIndex = again;
        }
        filter = f;
        lastError = null;
        renderVersion++;
    }

    /** Forgets the loaded line and drops the fetch answers still on their way; the config and the ticked steps stay. */
    private void forget() {
        fetchNumber++;
        fetching = false;
        if (data != null) renderVersion++;
        data = null;
        projectId = null;
        token = null;
        check = null;
        tracker = null;
        blockAt.clear();
        hits = Collections.emptyList();
        foundIndex = -1;
        toldFailures.clear();
        filter = ViewFilter.ALL;
        lastError = null;
    }

    /** Ticks a due step; the answer goes to the tracker that asked, whatever is loaded by then. */
    private void mark(final String stepId) {
        final StepTracker asked = tracker;
        final PlannedStep step = stepWithId(stepId);
        final String player = env.playerName();
        api.markStep(base(), projectId, token, player, stepId, new Callback<Integer>() {
            @Override
            public void done(Integer rev) {
                asked.sent(stepId);
                chat("Step " + step.order + " done: " + HudText.shorten(step.text, TICKED_TEXT_LENGTH) + " (ticked as " + player + ")");
            }

            @Override
            public void failed(String message) {
                asked.failed(stepId, env.nowMs());
                String text = "Could not tick step " + step.order + ": " + message;
                if (toldFailures.add(text)) chat(text);
            }
        });
    }

    /** The loaded line's first step with that id; the tracker only hands out ids of its own steps. */
    private PlannedStep stepWithId(String id) {
        for (PlannedStep s : data.steps) {
            if (s.id.equals(id)) return s;
        }
        throw new IllegalStateException("The loaded line has no step " + id);
    }

    private void layer(Integer y) {
        if (!canFilter()) return;
        showOnly(filter.withLayer(y));
        if (y == null) chat("Showing all layers.");
        else chat("Showing layer y=" + y + " (" + shownBlocks() + " blocks).");
    }

    private void step(String which) {
        if (!canFilter()) return;
        if ("all".equalsIgnoreCase(which)) {
            showOnly(filter.withStep(-1));
            chat("Showing all steps.");
            return;
        }
        int index = "next".equalsIgnoreCase(which) ? nextOpenStep() : numberedStep(which);
        if (index < 0) return; // already told why
        PlannedStep s = data.steps.get(index);
        showOnly(filter.withStep(index));
        chat("Showing step " + s.order + ": " + s.text);
    }

    /**
     * The index of the lowest-numbered step with blocks ({@link PlannedStep#hasBlocks}) that is not done, or −1 after
     * saying there is none.
     */
    private int nextOpenStep() {
        int next = openStep();
        if (next < 0) chat("Every build step with blocks is done.");
        return next;
    }

    /** The index of the step numbered {@code which}, or −1 after saying why it cannot be shown. */
    private int numberedStep(String which) {
        int order;
        try {
            order = Integer.parseInt(which);
        } catch (NumberFormatException e) {
            chat(CommandParser.BAD_STEP);
            return -1;
        }
        int index = data.stepByOrder(order);
        if (index < 0) {
            int last = 0;
            for (PlannedStep s : data.steps) last = Math.max(last, s.order);
            chat("There is no step " + order + " (the steps are numbered 1 to " + last + ").");
        } else if (!data.steps.get(index).hasBlocks()) {
            chat("Step " + order + " has no blocks to show: " + data.steps.get(index).text);
            index = -1;
        }
        return index;
    }

    /** Whether the loaded line has blocks to filter; otherwise says why not. */
    private boolean canFilter() {
        if (data == null) {
            chat(NOTHING_LOADED);
            return false;
        }
        if (!data.placed()) {
            chat(notPlacedText(data));
            return false;
        }
        return true;
    }

    private void showOnly(ViewFilter f) {
        if (f.equals(filter)) return;
        filter = f;
        renderVersion++;
    }

    private int shownBlocks() {
        int n = 0;
        for (PlannedBlock b : data.blocks) {
            if (filter.shows(b)) n++;
        }
        return n;
    }

    private void url(String typed) {
        String override;
        if ("auto".equalsIgnoreCase(typed)) {
            override = "";
        } else {
            try {
                override = PlannerUrl.normalize(typed);
            } catch (IllegalArgumentException notAnAddress) {
                chat(notAnAddress.getMessage());
                return;
            }
        }
        config.setPlannerUrl(override);
        save();
        chat("Planner address: " + base());
    }

    private void xray(Boolean on) {
        boolean seeThrough = on == null ? !config.seeThrough() : on;
        if (seeThrough != config.seeThrough()) {
            config.setSeeThrough(seeThrough);
            renderVersion++;
        }
        save();
        chat(seeThrough ? "See-through ghosts on." : "See-through ghosts off.");
    }

    /** Writes the config; a failure is told, and the setting still holds until the game closes. */
    private void save() {
        try {
            config.save();
        } catch (IOException e) {
            chat("Could not save the projector config: " + (e.getMessage() == null ? e.toString() : e.getMessage()));
        }
    }

    /**
     * The planner address in effect. It throws only while the config file's {@code plannerUrl} is not an address: that
     * stops every load at {@link #baseOrTell} before anything is fetched, and {@code /planner url} only ever stores an
     * address, so a loaded line's refreshes and ticks always have one.
     */
    private String base() {
        return PlannerUrl.effective(config.plannerUrl(), env.serverAddress());
    }

    /** {@link #base()}, or null after telling the player that the address they set is not one. */
    private String baseOrTell() {
        try {
            return base();
        } catch (IllegalArgumentException notAnAddress) {
            chat(notAnAddress.getMessage());
            return null;
        }
    }

    private String loadedText(ProjectorData d) {
        if (!d.placed()) return notPlacedText(d);
        String text = "Loaded \"" + d.name + "\": " + sizeText(d) + ". Showing all layers.";
        int here = env.dimension();
        return d.dim == here ? text : text + " The line is in dimension " + d.dim + "; you are in " + here + ".";
    }

    /** {@code <n> blocks in <k> build steps}, counting the steps that build blocks ({@link PlannedStep#hasBlocks}). */
    private static String sizeText(ProjectorData d) {
        int steps = 0;
        for (PlannedStep s : d.steps) {
            if (s.hasBlocks()) steps++;
        }
        return d.blocks.size() + " blocks in " + steps + " build steps";
    }

    private static String notPlacedText(ProjectorData d) {
        return "\"" + d.name + "\": " + whyNotPlaced(d);
    }

    /** The planner's reason the line is not placed (its status when it sent none). */
    private static String whyNotPlaced(ProjectorData d) {
        return d.message == null ? d.status : d.message;
    }

    private static String key(int x, int y, int z) {
        return x + "," + y + "," + z;
    }

    private void chat(String text) {
        env.chat(PREFIX + text);
    }
}
