package io.github.drukoz.gtnhplanner.projector.check;

import io.github.drukoz.gtnhplanner.projector.model.PlannedStep;
import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

/**
 * Decides when the projector ticks a build step in the planner's shared checklist (spec §3.13): a step is due once it
 * has at least one block, every one of them {@link BlockState#CORRECT} for {@link #STABLE_CHECKS} checks in a row, the
 * planner does not show it ticked and this session has not sent it. A failed send is tried again no sooner than
 * {@link #RETRY_MS} later. Nothing ever unticks: steps only ever become done.
 *
 * <p>One tracker per loaded {@link ProjectorData}. The set of steps sent this session belongs to the session and
 * outlives reloads, so no layout sends a step twice; answers and refreshes that name steps this tracker's data does not
 * have are ignored. Used on the game thread only.
 */
public final class StepTracker {

    /** How many checks in a row must find every block of a step correct before it is due. */
    public static final int STABLE_CHECKS = 2;
    /** How long after a failed send the step may be sent again, in milliseconds. */
    public static final long RETRY_MS = 60_000;

    private final List<PlannedStep> steps;
    /** The ids of {@link #steps}. */
    private final Set<String> stepIds = new HashSet<>();
    /** The session's set of steps it has sent; shared with the trackers of earlier and later layouts. */
    private final Set<String> sentThisSession;
    /** The steps the planner shows ticked: the payload's own ticks, then those later refreshes see. */
    private final Set<String> plannerDone;
    /** The steps {@link #due} handed out whose send has not been answered yet. */
    private final Set<String> inFlight = new HashSet<>();
    /** When each step whose last send failed may be sent again (ms). */
    private final Map<String, Long> retryAt = new HashMap<>();
    /** {@code stable[i]}: how many checks in a row have found step {@code i} complete. */
    private final int[] stable;

    /**
     * A tracker for {@code data}'s steps, taking the steps the payload shows done as done. {@code sentThisSession} is
     * kept, not copied: the session owns it and hands the same set to the tracker of every layout it loads.
     */
    public StepTracker(ProjectorData data, Set<String> sentThisSession) {
        steps = data.steps;
        for (PlannedStep s : steps) stepIds.add(s.id);
        this.sentThisSession = sentThisSession;
        plannerDone = data.doneStepIds();
        stable = new int[steps.size()];
    }

    /**
     * Whether the step at {@code stepIndex} of {@link ProjectorData#steps} has at least one block and every one of them
     * is {@link BlockState#CORRECT} in {@code states} (indexed like {@link ProjectorData#blocks}).
     */
    public boolean complete(int stepIndex, BlockState[] states) {
        int[] blocks = steps.get(stepIndex).blocks;
        if (blocks.length == 0) return false;
        for (int b : blocks) {
            if (states[b] != BlockState.CORRECT) return false;
        }
        return true;
    }

    /**
     * Counts one check and returns the ids of the steps to send now, in step order; call it once per check. Steps that
     * are done, in flight or without blocks are skipped. For every other step the count of checks in a row that found
     * it {@link #complete} goes up by one, or back to 0 when this one did not, and the step is due once the count is
     * at least {@link #STABLE_CHECKS} and its retry time, if any, has come. Returned ids are in flight until
     * {@link #sent} or {@link #failed} answers them.
     */
    public List<String> due(BlockState[] states, long nowMs) {
        List<String> ids = new ArrayList<>();
        for (int i = 0; i < steps.size(); i++) {
            PlannedStep s = steps.get(i);
            if (isDone(s.id) || inFlight.contains(s.id) || s.blocks.length == 0) continue;
            stable[i] = complete(i, states) ? stable[i] + 1 : 0;
            if (stable[i] < STABLE_CHECKS) continue;
            Long retry = retryAt.get(s.id);
            if (retry != null && nowMs < retry) continue;
            inFlight.add(s.id);
            ids.add(s.id);
        }
        return ids;
    }

    /** The planner accepted the mark: the step is done, for every later layout of this session too. */
    public void sent(String stepId) {
        if (!stepIds.contains(stepId)) return;
        inFlight.remove(stepId);
        sentThisSession.add(stepId);
    }

    /** The mark was not accepted: the step is no longer in flight and may be sent again from {@code nowMs + RETRY_MS}. */
    public void failed(String stepId, long nowMs) {
        if (!stepIds.contains(stepId)) return;
        inFlight.remove(stepId);
        retryAt.put(stepId, nowMs + RETRY_MS);
    }

    /** The steps a refresh shows ticked in the planner; they become done here (a step missing from them stays done). */
    public void serverDone(Set<String> doneIds) {
        for (String id : doneIds) {
            if (stepIds.contains(id)) plannerDone.add(id);
        }
    }

    /** Whether the planner shows the step ticked or this session has sent it. */
    public boolean isDone(String stepId) {
        return plannerDone.contains(stepId) || sentThisSession.contains(stepId);
    }
}
