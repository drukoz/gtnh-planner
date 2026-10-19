package io.github.drukoz.gtnhplanner.projector.net;

import io.github.drukoz.gtnhplanner.projector.model.ProjectorData;

/**
 * The planner requests the projector session makes (spec §3.13): {@link PlannerClient} sends them over HTTP, tests
 * answer them by hand. Every request gets exactly one answer through its {@link Callback}, on the game thread.
 */
public interface PlannerApi {

    /** The project's line, read with its token; {@code player} is sent as the name of who asks. */
    void fetchProjector(String base, String projectId, String token, String player, Callback<ProjectorData> cb);

    /** Ticks the build step {@code stepId} in the project's checklist in {@code player}'s name; the value is the new revision. */
    void markStep(String base, String projectId, String token, String player, String stepId, Callback<Integer> cb);
}
