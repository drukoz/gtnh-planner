# Projector Aim, Name Tag and Planner Screen Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In the projector mod, the crosshair names any ghost (with an outline and a floating name tag), the top left lists stacked ghosts and what the current step still needs, and a planner screen opened from the inventory shows the line in 3D with buttons that replace the everyday `/planner` commands.

**Architecture:** All decisions live in the pure packages and are unit-tested: a voxel ray walk (`view.AimRay`), the text of tags, lists and directions (`view.HudText`), a camera for the model (`geom.OrbitCamera`), and the session's new state (aim hits, found block, hidden ghosts, current step). The `client` package only feeds the session (eye, look, which real blocks stop the aim) and draws what it says: outlines and tags after the ghosts, and a `GuiScreen` whose model reuses the ghosts' quads.

**Tech Stack:** Java 8 bytecode (Jabel) on the GTNH ExampleMod1.7.10 template (GTNHGradle, Forge 10.13.4.1614), GT5-Unofficial `:dev` compileOnly, JUnit 5.11.4, GL11 through Minecraft's `Tessellator`/`OpenGlHelper`.

**Spec:** `docs/superpowers/specs/2026-10-19-projector-aim-and-screen-design.md` (approved by drukoz 2026-10-19). It extends §3.13 of `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md`; Plan 6 (`docs/superpowers/plans/2026-10-17-06-ghost-projector.md`) built the mod.

**Branch / worktree:** `plan/18-projector-aim-screen` in `.worktrees/plan-18-projector-aim-screen`. Run Gradle from the worktree root as `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd projector-mod && ./gradlew <task>)`.

## Global Constraints

- `projector-mod/` only; no change to the planner server, payload or web app. Client-only: no items, blocks or packets; `CommonProxy` stays empty.
- Pure packages `config`, `net`, `model`, `geom`, `view`, `check`, `session` import nothing from `net.minecraft`, `net.minecraftforge`, `cpw.mods` or `gregtech` (`PurePackagesTest`). Only `client` touches the game.
- Every `net/minecraft` member used must survive reobfuscation: `exporter-mod/scripts/check-reobf.sh projector-mod/build/libs/gtnhplannerprojector-0.2.0.jar` passes. Use the GL11 calls and Minecraft helpers the mod already uses; no LWJGL 2-only utility classes (`org.lwjgl.util.*`).
- Refresh stays at `refreshSeconds` (default 60). Every existing `/planner` command keeps working unchanged.
- Never change what the vanilla crosshair targets or what a click does.
- Anything that fails while drawing or in the screen is caught, logged once, and reported on the HUD (as `GhostRenderer.fail` does); it is never thrown into the game.
- Exact numbers from the spec: aim and drawing distance = `maxDistance` (default 96); stacked list ≥ 2 hits, at most 6 entries then `… and N more`; needs list at most 8 names then `… and N more kinds`; finding lasts at most 60 000 ms; aim outline yellow, found outline cyan.
- Player-facing text is plain English in the style of the existing chat/HUD lines. Exact strings are the ones in the tests below.
- Nothing private committed: no home paths, coordinates, player or server names from `docs/local/` in code, tests or docs (examples use `Steve`, `mc.example.org`, coordinates near `100 64 200`).
- Commits use a conventional prefix (`feat(projector-mod): …`, `docs: …`) and end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **The player's head is inside a ghost's cell** (standing where a block goes): that ghost must not stick to the crosshair. Pinned by Task 1 `skipsTheEyesOwnCell`.
2. **Looking straight down, straight along an axis, or exactly through cell corners**: no skipped cells, no NaN, no endless loop. Pinned by Task 1 `walksStraightDownAndExactDiagonals` and `aZeroLookHitsNothing`.
3. **The line is refreshed (moved, re-planned) while aiming, finding or with the screen open**: old block indices must never be used on the new data; a found block follows its position or ends. Pinned by Task 3 `refreshDropsTheAimAndRefindsByPosition`.
4. **The inventory looks different** (potion effects shift it right, creative inventory, GUI scale changed, NEI panels shown): the button stays on the inventory panel's edge and never covers NEI. Checked by hand in Task 6 Step 4.
5. **A line of a few thousand blocks with the screen open**: the model geometry is rebuilt only when the session's `renderVersion`, the layer cut or the faint set changes, never per frame. Checked in Task 5's review and by hand (no visible frame drop) in Task 7.

---

## File map

| File | Change |
|------|--------|
| `view/AimRay.java` | new: voxel walk along the crosshair |
| `view/HudText.java` | `blockLines`, `stacked`, `needs`, `direction` (Task 2); `lookingAt` removed (Task 3) |
| `geom/OrbitCamera.java` | new: the screen model's camera, view matrix and mouse rays |
| `config/ProjectorConfig.java` | `projectIds()` |
| `session/ProjectorSession.java` | aim, find, hidden, current step, new HUD lines; `lookingAt` removed |
| `client/AimRenderer.java` | new: per-frame aim, outlines, name tags |
| `client/McAimStops.java` | new: which real blocks stop the aim |
| `client/QuadBatch.java`, `client/GhostLook.java` | new: `GhostRenderer`'s batch and block/cover quads, moved out so the screen reuses them |
| `client/GhostRenderer.java` | uses `GhostLook`/`QuadBatch`; draws nothing while hidden |
| `client/HudOverlay.java` | only `session.hudLines()` (the looking-at lookup goes) |
| `client/PlannerScreen.java` | new: the screen (model, tooltip, panels, buttons) |
| `client/ScreenOpener.java` | new: key binding and inventory button |
| `client/ClientProxy.java` | registers the new handlers |

(All paths under `projector-mod/src/main/java/io/github/drukoz/gtnhplanner/projector/`; tests mirror them under `src/test/java/…`.)

---

### Task 1: Walk the crosshair through ghost cells

**Files:**
- Create: `view/AimRay.java`
- Test: `view/AimRayTest.java`

**Interfaces:**
- Produces:
  - `AimRay.Ghosts` — `@FunctionalInterface int at(int x, int y, int z)`: the shown ghost's block index there, or −1.
  - `AimRay.Stops` — `@FunctionalInterface boolean at(int x, int y, int z)`: whether a real block there stops the aim.
  - `AimRay.Hit` — `public final int block; public final double distance;` public constructor `Hit(int block, double distance)`.
  - `static List<Hit> walk(double[] eye, double[] look, double maxDistance, Ghosts ghosts, Stops stops)` — nearest first; `distance` = how far along the (normalised) look the ray enters that cell; skips the eye's own cell; stops after the first cell where `stops` is true (that cell's ghost still counts); never goes past `maxDistance`; an all-zero `look` gives an empty list.

- [ ] **Step 1: Write the failing tests** (helper: `Ghosts` from a `Map<String,Integer>` keyed `"x,y,z"`; `Stops none = (x, y, z) -> false`)

```java
@Test void hitsAFloatingGhostFarAway() {   // eye (0.5, 65.62, 0.5), look +x, ghost 7 at (40,65,0)
    List<AimRay.Hit> h = AimRay.walk(new double[] {0.5, 65.62, 0.5}, new double[] {1, 0, 0}, 96, ghosts("40,65,0", 7), none);
    assertEquals(1, h.size()); assertEquals(7, h.get(0).block); assertEquals(39.5, h.get(0).distance, 1e-9);
}
@Test void aRealBlockStopsTheAimButItsOwnGhostCounts() {   // ghosts 1 at (5,65,0), 2 at (8,65,0)
    assertEquals(Arrays.asList(1), blocks(walkX(stopAt("5,65,0"))));
    assertEquals(Arrays.asList(1), blocks(walkX(stopAt("6,65,0"))));
    assertEquals(Arrays.asList(1, 2), blocks(walkX(none)));               // x-ray: nothing stops
    assertEquals(4.5, walkX(none).get(0).distance, 1e-9); assertEquals(7.5, walkX(none).get(1).distance, 1e-9);
}
@Test void neverGoesPastMaxDistance() {   // eye x = 0.5, look +x
    assertTrue(AimRay.walk(eye, plusX, 96, ghosts("100,65,0", 3), none).isEmpty());
    assertEquals(1, AimRay.walk(eye, plusX, 96, ghosts("96,65,0", 3), none).size());   // enters at 95.5
}
@Test void skipsTheEyesOwnCell() {   // ghost 4 at the eye's cell (0,65,0), ghost 5 at (3,65,0)
    assertEquals(Arrays.asList(5), blocks(AimRay.walk(eye, plusX, 96, ghosts("0,65,0", 4, "3,65,0", 5), none)));
}
@Test void walksStraightDownAndExactDiagonals() {
    List<AimRay.Hit> down = AimRay.walk(new double[] {0.5, 70.5, 0.5}, new double[] {0, -1, 0}, 96, ghosts("0,68,0", 1, "0,66,0", 2), none);
    assertEquals(Arrays.asList(1, 2), blocks(down)); assertEquals(1.5, down.get(0).distance, 1e-9); assertEquals(3.5, down.get(1).distance, 1e-9);
    List<AimRay.Hit> diag = AimRay.walk(new double[] {0.5, 65.5, 0.5}, new double[] {1, 0, 1}, 96, ghosts("2,65,2", 9), none);
    assertEquals(Arrays.asList(9), blocks(diag)); assertEquals(1.5 * Math.sqrt(2), diag.get(0).distance, 1e-9);
}
@Test void aZeroLookHitsNothing() { assertTrue(AimRay.walk(eye, new double[] {0, 0, 0}, 96, ghosts("1,65,0", 1), none).isEmpty()); }
```

- [ ] **Step 2: Run to verify they fail** — `./gradlew test --tests '*.AimRayTest'` → FAIL (no `AimRay`).
- [ ] **Step 3: Implement `AimRay`** as an Amanatides–Woo grid walk (per-axis `tMax`/`tDelta`, an axis with zero look never steps; on a tie step any one axis).
- [ ] **Step 4: Run** `./gradlew test` → all pass, including `PurePackagesTest`.
- [ ] **Step 5: Commit** — `feat(projector-mod): walk the crosshair through ghost cells`.

---

### Task 2: Text for the name tag, stacked list, needs list and directions

**Files:**
- Modify: `view/HudText.java` (add four methods; `lookingAt` stays until Task 3)
- Test: `view/HudTextTest.java`

**Interfaces:**
- Consumes: `AimRay.Hit` (Task 1).
- Produces:
  - `static List<String> blockLines(PlannedBlock b, BlockState s)` — the tag and tooltip lines: label; status; facing line; one line per cover.
  - `static List<String> stacked(ProjectorData d, List<AimRay.Hit> hits)` — empty for fewer than 2 hits.
  - `static List<String> needs(ProjectorData d, BlockState[] states, int stepIndex)` — empty for `stepIndex < 0` or nothing needed.
  - `static String direction(int dx, int dy, int dz)` — from the player to the block.

Rules the tests pin: status words are today's (`placed correctly`, `wrong block here`, `wrong facing, its <output side|front> should face <side>`, `not placed yet`, `can't be checked by the mod`) plus `not checked yet` for `UNLOADED`. The facing line (`front should face <side>`, or `output side should face <side>` when `facingIsOutput`) appears when `b.facing >= 0` and the state is `MISSING`, `WRONG_BLOCK`, `UNLOADED` or `UNCHECKED`. Distances in `stacked` are `Math.round(distance)` + ` m`. `needs` counts blocks of the step that are not `CORRECT`, by label, `UNCHECKED` ones separately as `<n>× <label> (can't check)` after the rest; order count descending then label; 8 names at most. `direction`: horizontal `n = Math.round(Math.hypot(dx, dz))`; `n == 0` → `here`, else `<n> block(s) <compass>`, compass from `atan2(dx, -dz)` in 8 sectors `N NE E SE S SW W NW`; then `, <dy> up` / `, <-dy> down` unless `dy == 0`.

- [ ] **Step 1: Write the failing tests** (sample = `PayloadParserTest.sample()`, `STATES` as in `HudTextTest`)

```java
@Test void tagLinesSayWhatTheBlockIsAndWhichWayItGoes() throws Exception {
    ProjectorData d = PayloadParserTest.sample();
    assertEquals(Arrays.asList("Basic Macerator", "not placed yet", "output side should face south", "cover: Conveyor Module (LV) on the south face"), HudText.blockLines(d.blocks.get(3), MISSING));
    assertEquals(Arrays.asList("Basic Macerator", "placed correctly"), HudText.blockLines(d.blocks.get(4), CORRECT));
    assertEquals(Arrays.asList("Basic Macerator", "wrong facing, its output side should face south"), HudText.blockLines(d.blocks.get(4), WRONG_FACING));
    assertEquals(Arrays.asList("Basic Macerator", "wrong block here", "output side should face south"), HudText.blockLines(d.blocks.get(4), WRONG_BLOCK));
    assertEquals(Arrays.asList("Basic Macerator", "can't be checked by the mod", "output side should face south"), HudText.blockLines(d.blocks.get(4), UNCHECKED));
    assertEquals(Arrays.asList("Low Voltage Transformer", "not placed yet", "front should face west"), HudText.blockLines(d.blocks.get(2), MISSING));
    assertEquals(Arrays.asList("1x Tin Cable", "not checked yet"), HudText.blockLines(d.blocks.get(0), UNLOADED));
}
@Test void listsStackedGhostsNearestFirst() throws Exception {
    ProjectorData d = PayloadParserTest.sample();
    assertTrue(HudText.stacked(d, Arrays.asList(new AimRay.Hit(3, 5.2))).isEmpty());
    assertEquals(Arrays.asList("Behind the crosshair (2):", "> Basic Macerator 5 m", "  Heat Proof Machine Casing 6 m"),
        HudText.stacked(d, Arrays.asList(new AimRay.Hit(3, 5.2), new AimRay.Hit(9, 6.4))));
    List<AimRay.Hit> eight = new ArrayList<>(); for (int i = 0; i < 8; i++) eight.add(new AimRay.Hit(i, i + 1));
    List<String> lines = HudText.stacked(d, eight);
    assertEquals("Behind the crosshair (8):", lines.get(0)); assertEquals(8, lines.size()); assertEquals("… and 2 more", lines.get(7));
}
@Test void listsWhatTheStepStillNeeds() throws Exception {
    ProjectorData d = PayloadParserTest.sample();
    assertEquals(Arrays.asList("Still needed for step 2:", "1× Basic Macerator"), HudText.needs(d, STATES, 1));
    assertEquals(Arrays.asList("Still needed for step 7:", "1× Chest (input)", "1× Tin Item Pipe", "1× Routed Interface Pipe (input chest) (can't check)"), HudText.needs(d, STATES, 6));
    assertTrue(HudText.needs(d, STATES, -1).isEmpty());
    BlockState[] done = STATES.clone(); done[4] = CORRECT;
    assertTrue(HudText.needs(d, done, 1).isEmpty());
}
@Test void needsListStopsAtEightNames() throws Exception { /* via PayloadParserTest.mutate: one step holding ten blocks with ten different labels, all MISSING → 9 lines + "… and 2 more kinds" */ }
@Test void saysWhereABlockIs() {
    assertEquals("23 blocks NE, 2 up", HudText.direction(16, 2, -17));
    assertEquals("5 blocks S, 3 down", HudText.direction(0, -3, 5));
    assertEquals("1 block E", HudText.direction(1, 0, 0));
    assertEquals("10 blocks W", HudText.direction(-10, 0, -1));
    assertEquals("here, 4 up", HudText.direction(0, 4, 0));
}
```

`needsListStopsAtEightNames`: build the ten-label step with `PayloadParserTest.mutate` (move every block into step `layout:place:s1` and its `blocks` list, relabel `Block 0`…`Block 9`); expect 1 header + 8 names + `… and 2 more kinds`.

- [ ] **Step 2: Run to verify they fail** — `./gradlew test --tests '*.HudTextTest'` → FAIL.
- [ ] **Step 3: Implement** the four methods in `HudText`.
- [ ] **Step 4: Run** `./gradlew test` → all pass.
- [ ] **Step 5: Commit** — `feat(projector-mod): name tag, stacked list, needs list and direction text`.

---

### Task 3: Session state for aim, finding, hidden ghosts and the new HUD lines

**Files:**
- Modify: `session/ProjectorSession.java`, `config/ProjectorConfig.java`, `view/HudText.java` (remove `lookingAt`), `client/HudOverlay.java` (`onText` adds only `session.hudLines()`; the looking-at lookup and its `BLOCK_HIT` go)
- Test: `session/ProjectorSessionTest.java`, `config/ProjectorConfigTest.java`, `view/HudTextTest.java` (drop the `lookingAt` assertions; `blockLines` covers them)

**Interfaces:**
- Consumes: `AimRay.walk/Ghosts/Stops/Hit` (Task 1); `HudText.stacked/needs/direction/blockLines` (Task 2).
- Produces (all on the game thread):
  - `ProjectorConfig.projectIds()` → `List<String>`: ids with a saved token, sorted.
  - `void aim(double[] eye, double[] look, AimRay.Stops stops)` — walks over the ghosts that are drawn (`visibleHere()`, not hidden, `filter.shows`, `ViewFilter.within(b, eye…, maxDistance)`); `stops` is ignored when `seeThrough()`. Keeps the hits and the eye; when the nearest hit is the found block, finding ends.
  - `List<AimRay.Hit> aimHits()` (unmodifiable, nearest first) and `int aimed()` (nearest hit's block index, or −1).
  - `void find(int blockIndex)`, `int found()` (−1 once 60 000 ms have passed by `env.nowMs()`, or after it ended), `void screenOpened()` (ends finding).
  - `boolean ghostsHidden()`, `void setGhostsHidden(boolean)` — a change adds 1 to `renderVersion()` and clears the aim; not saved, not reset by `/planner clear`.
  - `int currentStep()` — the filter's step, else the lowest-numbered step with blocks that is not done, else −1; says nothing in chat (`nextOpenStep` keeps its chat line and uses it).
  - `boolean stepDone(int stepIndex)`, `int blockIndexAt(int x, int y, int z)` (any block, filter ignored; −1), `List<String> savedProjects()` (= `config.projectIds()`).
  - `hudLines()` now: the existing lines, then, only when `visibleHere()`: `Finding: <label> — <HudText.direction from floor(eye) to the block>` while finding (and an eye is known), then `HudText.stacked(data, aimHits())`, then `HudText.needs(data, states(), currentStep())`.
  - Removed: `lookingAt(int, int, int)`.
  - On a new layout (`install`): hits cleared; the found block is looked up again by the same `x,y,z` and `id` in the new data (its new index), else finding ends. `forget()` clears hits and finding.

- [ ] **Step 1: Write the failing tests** (sample origin `99 64 200`; blocks 0 `(100,64,201)`, 1 `(101,64,201)`, 3 `(102,64,201)`, 4 `(103,64,201)`, 9 `(103,65,203)`; `none = (x, y, z) -> false`)

```java
@Test void aimsAtGhostsAndListsTheStackedOnes() throws Exception {
    loadSample();
    s.aim(new double[] {99.5, 64.5, 201.5}, new double[] {1, 0, 0}, none);
    assertEquals(0, s.aimed());
    List<String> hud = s.hudLines();
    assertEquals(Arrays.asList("Behind the crosshair (4):", "> 1x Tin Cable 1 m", "  1x Tin Cable 2 m", "  Basic Macerator 3 m", "  Basic Macerator 4 m"),
        hud.subList(1, 6));
}
@Test void aRealBlockStopsTheAimUnlessXrayIsOn() throws Exception {
    loadSample();
    AimRay.Stops wall = (x, y, z) -> x == 101 && y == 64 && z == 201;
    s.aim(new double[] {99.5, 64.5, 201.5}, new double[] {1, 0, 0}, wall);
    assertEquals(2, s.aimHits().size());
    s.run(Command.xray(true));
    s.aim(new double[] {99.5, 64.5, 201.5}, new double[] {1, 0, 0}, wall);
    assertEquals(4, s.aimHits().size());
}
@Test void filteredHiddenAndFarGhostsAreNotAimedAt() throws Exception {
    loadSample();
    s.run(Command.step("2"));
    s.aim(new double[] {99.5, 64.5, 201.5}, new double[] {1, 0, 0}, none);
    assertEquals(Arrays.asList(3, 4), blocks(s.aimHits()));
    int v = s.renderVersion();
    s.setGhostsHidden(true);
    assertTrue(s.ghostsHidden()); assertEquals(v + 1, s.renderVersion()); assertTrue(s.aimHits().isEmpty());
    s.aim(new double[] {99.5, 64.5, 201.5}, new double[] {1, 0, 0}, none);
    assertTrue(s.aimHits().isEmpty());
    s.setGhostsHidden(false); s.run(Command.step("all"));
    s.aim(new double[] {-100.5, 64.5, 201.5}, new double[] {1, 0, 0}, none);   // 200 blocks away, maxDistance 96
    assertTrue(s.aimHits().isEmpty());
}
@Test void needsListFollowsTheCurrentStep() throws Exception {
    loadSample();
    assertEquals(1, s.currentStep());
    assertTrue(s.hudLines().containsAll(Arrays.asList("Still needed for step 2:", "2× Basic Macerator")));
    FakeWorld w = new FakeWorld().placeStepS1();
    placeAndCheck(w); api.marks.poll().done(8);
    assertEquals(3, s.currentStep());                                      // step 4: the transformer
    assertTrue(s.hudLines().containsAll(Arrays.asList("Still needed for step 4:", "1× Low Voltage Transformer")));
    s.run(Command.step("7"));
    assertEquals(6, s.currentStep());
}
@Test void findingSaysWhereTheBlockIsAndEnds() throws Exception {
    loadSample();
    s.aim(new double[] {99.5, 64.5, 190.5}, new double[] {0, 0, 1}, none);   // nothing on this ray
    s.find(9);
    assertEquals(9, s.found());
    assertTrue(s.hudLines().contains("Finding: Heat Proof Machine Casing — 14 blocks S, 1 up"));
    now += 60_001;
    assertEquals(-1, s.found());
    s.find(9);
    s.aim(new double[] {103.5, 65.5, 201.5}, new double[] {0, 0, 1}, none);  // aims at block 9 itself
    assertEquals(-1, s.found()); assertEquals(9, s.aimed());
    s.find(9); s.screenOpened(); assertEquals(-1, s.found());
    s.find(9); s.run(Command.clear()); assertEquals(-1, s.found());
}
@Test void refreshDropsTheAimAndRefindsByPosition() throws Exception {
    // load, aim (hits non-empty), find(3); a refresh with a new version that keeps block 3's position and id:
    //   aimHits() empty, found() == the new index of (102,64,201); a later refresh that moves that block to (102,66,201): found() == -1.
    // Trigger refreshes the way the existing "replaces the layout when the version changes" test does.
}
@Test void listsTheProjectsWithASavedToken() throws Exception { loadSample(); assertEquals(Collections.singletonList("Pr0jectAb1"), s.savedProjects()); }
```

`ProjectorConfigTest`: tokens for `b2` and `A1` set and saved → `projectIds()` is `["A1", "b2"]` after a reload; a blank token removes its id.

Existing tests that call `s.lookingAt(...)` assert the same facts through `HudText.blockLines(s.data().blocks.get(i), s.states()[i])` instead.

- [ ] **Step 2: Run to verify they fail** — `./gradlew test --tests '*.ProjectorSessionTest' --tests '*.ProjectorConfigTest'` → FAIL.
- [ ] **Step 3: Implement** the Produces list; the `Ghosts` passed to `AimRay.walk` reads `blockAt` and returns −1 for blocks the filter hides, out of `maxDistance`, or while hidden.
- [ ] **Step 4: Run** `./gradlew test && VERSION=0.2.0 ./gradlew assemble` → all pass and the jar builds (the `HudOverlay` change compiles).
- [ ] **Step 5: Commit** — `feat(projector-mod): session aims at ghosts, finds blocks, hides ghosts and lists what a step needs`.

---

### Task 4: Outline and name tag in the world

**Files:**
- Create: `client/AimRenderer.java`, `client/McAimStops.java`
- Modify: `client/GhostRenderer.java` (draw nothing while `session.ghostsHidden()`), `client/ClientProxy.java` (register `AimRenderer` on `MinecraftForge.EVENT_BUS`)

**Interfaces:**
- Consumes: `session.aim/aimHits/aimed/found/ghostsHidden/data/states/visibleHere/seeThrough` (Task 3), `HudText.blockLines` (Task 2).
- Produces: `AimRenderer(ProjectorSession session)` with `@SubscribeEvent(priority = EventPriority.LOW) onRenderLast(RenderWorldLastEvent)`; `McAimStops(World world) implements AimRay.Stops`.

Behaviour: each frame (when `visibleHere()`), take the eye and look from `mc.renderViewEntity` at `partialTicks` (`getPosition(t)`, `getLook(t)`), call `session.aim(…)` with `McAimStops` (a non-air block whose `canCollideCheck(meta, false)` is true, as vanilla's crosshair stops), then draw:
- the aimed block (`aimed()`, unless hidden): an outline box grown by 0.01, colour (1, 1, 0.33), line width 3, depth test off, and its tag;
- the found block (`found()`, drawn even when hidden or filtered out, at any distance): outline colour (0.33, 1, 1) and its tag.
- Tag: `blockLines(...)` centred above the block (bottom edge 0.25 above its top face), facing the camera like a player name tag (rotate by `-playerViewY`, `playerViewX` of `RenderManager.instance`), dark background (0, 0, 0, 0.25), white text, depth test off. Scale `0.025 × max(1, distance / 12)`, so beyond 12 blocks it keeps the size it has at 12. Restore every GL flag it touches, as `GhostRenderer.draw` does; any failure goes through a `fail` like `GhostRenderer.fail`.

- [ ] **Step 1: Implement** `McAimStops`, `AimRenderer`, the hidden check in `GhostRenderer`, and the registration.
- [ ] **Step 2: Verify the build** — `./gradlew test` → pass; `VERSION=0.2.0 ./gradlew assemble` → BUILD SUCCESSFUL; `exporter-mod/scripts/check-reobf.sh projector-mod/build/libs/gtnhplannerprojector-0.2.0.jar` → passes.
- [ ] **Step 3: Commit** — `feat(projector-mod): outline and name tag on the aimed and the found ghost`.

---

### Task 5: The planner screen's 3D model

**Files:**
- Create: `geom/OrbitCamera.java`, `client/QuadBatch.java`, `client/GhostLook.java`, `client/PlannerScreen.java`, `client/ScreenOpener.java`
- Modify: `client/GhostRenderer.java` (use `QuadBatch` and `GhostLook`; no change in what it draws), `client/ClientProxy.java`
- Test: `geom/OrbitCameraTest.java`

**Interfaces:**
- Consumes: `AimRay.walk` (picking), `HudText.blockLines` (tooltip), `session.blockIndexAt/find/screenOpened/data/states/filter/renderVersion` (Task 3), `BlockIcons`.
- Produces:
  - `OrbitCamera.framing(int[] origin, int[] size)` → camera with target = the line's centre (`origin + size / 2`), yaw 45°, pitch 30°, distance `2 × longest side + 4`.
  - `double[] target()`, `double[] eye()` = `target + d·(cos p·sin y, sin p, cos p·cos y)`, `double distance()`.
  - `void turn(double yawDegrees, double pitchDegrees)` (pitch kept within −89…89), `void zoom(int wheelSteps)` (distance × 0.9^steps, kept within 2…256), `void pan(double rightBlocks, double upBlocks)` (moves the target in the camera's right/up plane).
  - `float[] viewMatrix()` (column-major, for `glMultMatrix`): sends `eye()` to (0,0,0) and `target()` to (0,0,−distance).
  - `double[] ray(double ndcX, double ndcY, double fovYDegrees, double aspect)` → unit direction from `eye()` through that point of the view (ndc −1…1, y up).
  - `QuadBatch` (the old `GhostRenderer.Batch`, package-private) and `GhostLook(BlockIcons icons)` with `void addBlock(QuadBatch blocks, PlannedBlock b, BlockState s, double x, double y, double z, float ghostAlpha)` and `void addCovers(QuadBatch blocks, QuadBatch covers, PlannedBlock b, double x, double y, double z)` (the bodies of `GhostRenderer.addBlock/addCover`).
  - `PlannerScreen(ProjectorSession session, ProjectorConfig config, BlockIcons icons) extends GuiScreen`; `doesGuiPauseGame()` false; `initGui` calls `session.screenOpened()`.
  - `ScreenOpener` — key binding `Open the planner screen`, category `GTNH Planner`, default key 0 (unbound), registered with `ClientRegistry.registerKeyBinding`; on `ClientTickEvent` END with no screen open and the key pressed, opens `PlannerScreen`.

- [ ] **Step 1: Write the failing tests** for `OrbitCamera`

```java
@Test void framesTheLine() {
    OrbitCamera c = OrbitCamera.framing(new int[] {99, 64, 200}, new int[] {7, 2, 4});
    assertArrayEquals(new double[] {102.5, 65, 202}, c.target(), 1e-9);
    assertEquals(18, c.distance(), 1e-9);
    double h = 18 * Math.cos(Math.toRadians(30)) * Math.sin(Math.toRadians(45));
    assertArrayEquals(new double[] {102.5 + h, 65 + 9, 202 + h}, c.eye(), 1e-9);
}
@Test void theCentreRayLooksAtTheTarget() { /* ray(0,0,70,1.5) == normalise(target − eye) within 1e-9 */ }
@Test void theEdgeRayMatchesTheFieldOfView() { /* angle between ray(0,1,70,1.5) and the centre ray == 35°; ray(1,0,70,1.5): atan(tan 35° × 1.5) */ }
@Test void viewMatrixPutsTheEyeAtTheOriginAndTheTargetAhead() { /* M·eye = (0,0,0); M·target = (0,0,−distance), within 1e-6 */ }
@Test void turningZoomingAndPanningStayInRange() {
    /* turn(0, 200) → pitch 89 (eye.y − target.y == d·sin 89°); zoom(100) → distance 2; zoom(−100) → 256;
       pan(1, 0) moves target by 1 along the camera's right, distance unchanged */
}
```

- [ ] **Step 2: Run to verify they fail** — `./gradlew test --tests '*.OrbitCameraTest'` → FAIL.
- [ ] **Step 3: Implement `OrbitCamera`**, then move `Batch` → `QuadBatch` and the block/cover quads → `GhostLook`, with `GhostRenderer` using them (it must draw exactly as before).
- [ ] **Step 4: Implement the model part of `PlannerScreen`.** The model fills the left part (the right ~34 % and a bottom row are left for Task 6). It is drawn into its own viewport and scissor (scaled by the GUI scale), with `glFrustum` at fov 70° and `viewMatrix()`, depth test on, ghost colours from `GhostLook` (blocks the filter shows at `config.ghostAlpha()`; the rest at 0.3 × that alpha), cut away above the selected layer. Geometry is rebuilt only when `session.renderVersion()` or the layer changes. Left-drag turns (0.5° per pixel), right-drag pans, wheel zooms. Hover: `AimRay.walk(camera.eye(), camera.ray(mouse…), 512, blockIndexAt over the blocks not cut away, none)`; the first hit's `blockLines` are drawn as a tooltip at the mouse (`drawHoveringText`). Left click on a block (a press and release without dragging): `session.find(i)` and close the screen. Draw failures stop the model's drawing and show the error in the screen, logged once.
- [ ] **Step 5: Register** `ScreenOpener` on FML's bus in `ClientProxy`.
- [ ] **Step 6: Verify** — `./gradlew test` → pass; `VERSION=0.2.0 ./gradlew assemble` → success; `check-reobf.sh` → passes.
- [ ] **Step 7: Commit** — `feat(projector-mod): planner screen with a 3D model of the line`.

---

### Task 6: Screen panels, buttons and the inventory button

**Files:**
- Modify: `client/PlannerScreen.java`, `client/ScreenOpener.java`

**Interfaces:**
- Consumes: `session.run(Command…)`, `session.stepDone/currentStep/savedProjects/ghostsHidden/setGhostsHidden/visibleHere/hudLines`, `HudText.summary/needs` (Tasks 2–3).
- Produces: nothing new for other tasks.

Layout as in the approved mockup (`.superpowers/brainstorm/*/content/screen-3d.html` in the main checkout, if present; otherwise the spec's §2.4):
- Title row: `data.name` and the counts part of `HudText.summary` for what is shown.
- Right column: a scrolling step list: `All steps`, then each step `<order>. <text>` (shortened to fit), done steps green with a tick; a step with no blocks is grey and not clickable; the selected one highlighted. Click → `session.run(Command.step(String.valueOf(order)))`; `All steps` → `Command.step("all")`. Under it, `HudText.needs(data, states, currentStep())`.
- Bottom row: a layer slider over `origin[1] … origin[1] + size[1] − 1` (`Command.layer(y)`), `All layers` (`Command.layer(null)`), `X-ray: on/off` (`Command.xray(null)`), `Reload` (`Command.reload()`), `Hide ghosts` / `Show ghosts` (`setGhostsHidden(!ghostsHidden())`).
- Nothing loaded: the text `Nothing loaded. Paste the /planner load line from the project's In-game projector panel into chat.` and one button per `savedProjects()` id → `Command.load(id, null)`. Line not placed, or another dimension: the first of `hudLines()` instead of the model; the step list and buttons stay.
- Inventory button: on `GuiScreenEvent.InitGuiEvent.Post` for `GuiInventory` (and `GuiContainerCreative` if it fits), a 20×20 button just outside the inventory panel's top-right corner, positioned from the GUI's actual left edge (which moves with potion effects) and never over NEI's panels; on `ActionPerformedEvent.Pre` for that button, open `PlannerScreen`.

- [ ] **Step 1: Implement** the panels, buttons, empty/not-placed states and the inventory button.
- [ ] **Step 2: Verify the build** — `./gradlew test` → pass; `VERSION=0.2.0 ./gradlew assemble` → success; `check-reobf.sh` → passes.
- [ ] **Step 3: Commit** — `feat(projector-mod): screen step list, needs, layer slider, buttons and an inventory button`.
- [ ] **Step 4: Hand check list** — add to `docs/local/projector-check.md` (local, never committed) checks for: inventory button with and without potion effects, at GUI scales 2 and 3, with NEI shown; creative inventory; key binding; each screen control matches its command.

---

### Task 7: Docs, build and install

**Files:**
- Modify: `README.md` ("In-game ghost projector": the screen, aiming and the tag, stacked and needs lists; remove the old "looking at" wording from Colours and Troubleshooting), `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` §3.13 (one bullet pointing to the new spec), `docs/local/projector-check.md` (aim, tag, stacked list, needs list, finding, hide, refresh while the screen is open, frame rate on the largest line).

- [ ] **Step 1: Write the docs.**
- [ ] **Step 2: Verify** — `./gradlew test && VERSION=0.2.0 ./gradlew assemble` → success; `exporter-mod/scripts/check-reobf.sh projector-mod/build/libs/gtnhplannerprojector-0.2.0.jar` → passes; `git grep -n -E '/Users/|Application Support/PrismLauncher/instances' -- projector-mod README.md docs/superpowers` → no matches.
- [ ] **Step 3: Commit** — `docs: projector aim, name tag and planner screen`.
- [ ] **Step 4: Install (drukoz asked for it).** Replace the old jar in the GTNH 2.9.0-RC-1 client instance's `mods` folder (path in `docs/local/environment.md`): remove `gtnhplannerprojector-0.1.0.jar`, copy `projector-mod/build/libs/gtnhplannerprojector-0.2.0.jar` (not `-dev` or `-sources`). Then `ls` that folder shows exactly one `gtnhplannerprojector-*.jar`. Tell drukoz to restart the game; the in-game checks are theirs.
