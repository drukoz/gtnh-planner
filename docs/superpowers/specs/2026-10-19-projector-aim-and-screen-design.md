# Projector: aim at ghosts, name tag, needs list and the planner screen

Date: 2026-10-19. Status: design, decided with drukoz in conversation. It extends §3.13 of
`2026-10-17-gtnh-planner-design.md` (the in-game ghost projector, Plan 6).

## 1. Why

drukoz built a line with the projector and found it very hard to tell **what each ghost block is**. Today the only
way is the top-left "looking at" line, and that only works when the crosshair is on a **real** block within **arm's
reach** (`mc.objectMouseOver`, about 5 blocks). It names either that block's ghost or the ghost in front of the face
being looked at. A ghost floating in the air with nothing real next to it cannot be named at all. Parts (cables, pipes,
conduits, ME parts) are drawn as plain tinted clay, so their look does not help either.

drukoz also wants to stop driving the projector by typing commands: they want **a 3D view inside Minecraft** they can
open from the inventory and click around in.

Success: standing anywhere near the build, drukoz can point at any ghost and read what it is. They can see at a glance
what the current step still needs, and do everything except the first connection from a screen instead of chat
commands.

## 2. What gets built

Four parts, all in `projector-mod/`. Nothing changes in the planner server or web app.

### 2.1 Aim at ghosts (decided)

- The crosshair "hits" **ghosts themselves**, including ghosts floating in mid-air, at any distance up to
  `maxDistance` (the same distance ghosts are drawn to, 96 by default). It no longer needs a real block or arm's
  reach.
- Only ghosts that are drawn count: in the player's dimension, kept by the current layer/step filter, and within
  `maxDistance`. Ghosts hidden with "Hide ghosts" (§2.4) never count.
- **A real block in the way stops the aim**, the same way it blocks your view, but a ghost at that real block's own
  spot still counts. So aiming at a placed block names its ghost ("placed correctly" or "wrong block here"), and a
  ghost behind a wall is not aimed at. **With x-ray on** (`/planner xray on` or the screen's button), real blocks do
  not stop the aim.
  - *Builder's call:* exactly which real blocks stop it. Suggested: whatever vanilla's crosshair would stop at, so
    tall grass stops it like it stops the vanilla crosshair.
- The aimed ghost (the **nearest** one along the crosshair) gets a **yellow outline**, drawn so it is visible even
  when the ghost is partly inside other ghosts.
- This never changes what vanilla targets. Right-click still places on the real block the vanilla crosshair is on;
  breaking and using blocks are untouched.

### 2.2 Name tag on the aimed ghost (decided: option B of the mockup)

- A **floating name tag above the aimed ghost**, like a player's name tag: it faces the camera, sits just above the
  block, has a dark translucent background, and is drawn on top of everything so it is always readable. It shows
  **only while that ghost is aimed at** (or while it is "found" from the screen, §2.4).
- Line 1: the block's name (`PlannedBlock.label`). Line 2: its status, the same words `HudText.lookingAt` uses today
  (`not placed yet`, `placed correctly`, `wrong block here`, `wrong facing, its output side should face north`,
  `can't be checked by the mod`). *My call, from the approved screen mockup:* when the block has a facing to check and
  is not yet placed (or is the wrong block), line 3 says which way it goes: `front should face north`, or for a
  single-block machine `output side should face north`. It is left out when the block is placed correctly, and when
  the facing is already wrong (line 2 says it). Then one line per cover: `cover: <label> on the <side> face`.
- The tag and the screen's hover tooltip (§2.4) use the same lines, built in one place in `view`.
- It shrinks with distance like a player tag. *My call:* it never gets smaller than a readable minimum size on screen,
  since a tag at 96 blocks would otherwise be unreadable.
- It replaces the old top-left "looking at" line, which goes away.

### 2.3 Top-left lines (decided, except where marked)

The existing summary line stays first (`Planner: Steel line — 12/40 placed, 1 wrong`, plus the error lines). Under it:

- **Stacked ghosts.** When the crosshair goes through **two or more** drawn ghosts, the top left lists them, nearest
  first, with their distance in blocks, and `>` marks the one with the tag (always the nearest):

  ```
  Behind the crosshair (2):
  > Steel Pipe Casing 5 m
    LV Input Bus 6 m
  ```

  Nothing is listed for a single ghost (the tag says it all). *My call:* at most 6 entries, then `… and N more`.
  drukoz confirmed they do **not** want a way to move the tag to a block behind; the list is for reading only.
- **What the step still needs.** For "the step you're on", the top left lists the blocks of that step that are not
  placed correctly yet, grouped by name, with counts:

  ```
  Still needed for step 2:
  3× Steel Pipe Casing
  1× LV Input Bus
  ```

  - "The step you're on" = the step picked with `/planner step` or in the screen; when every step is shown, the
    lowest-numbered step with blocks that is not done (the same step `/planner step next` picks).
  - Counts drop as blocks are placed correctly. A wrong block or wrong facing still counts as needed.
  - *My call:* a block in a chunk the game has not loaded counts as needed (not known to be placed). A block the mod
    cannot check is listed after the rest as `2× Item Conduit (can't check)`, since it never becomes "correct".
  - *My call:* ordered by count, largest first, then by name; at most 8 names, then `… and N more kinds`. When the
    step is complete the list goes away (the step ticks itself as today).
  - It is not shown when nothing is loaded, the line is not placed, or the player is in another dimension.
  - Covers are not counted (covers and settings are the hand-ticked **configure** steps, which have no blocks).

### 2.4 The planner screen (decided, except where marked)

A screen inside Minecraft with a 3D model of the line and buttons that replace the everyday commands. It follows the
"planner screen" mockup drukoz approved.

**Opening it**

- A **small planner button on the inventory screen** (E). It must stay client-only, so no item: an item would need
  the mod on the server and on every player's game. drukoz confirmed a button works.
- A **key binding** in Minecraft's Controls menu. *My call:* unbound by default, because GTNH's keys are crowded.
- *Builder's call:* where exactly the button sits; it must not cover NEI's panels or the vanilla inventory. Showing it
  on the creative inventory too is optional.

**Layout** (as in the mockup)

- Title row: the line's name, and `12/40 placed, 1 wrong` for what is shown.
- **3D model** on the left, in the pack's textures, built from the same looks the ghosts use (`BlockIcons`:
  GT machines with their faces and front, other blocks with their own icons, parts as tinted blocks). Coloured like
  the ghosts: faint = not placed, green = right, red = wrong, bluish = can't be checked. Covers shown as on the
  ghosts.
  - Drag to turn, right-drag to pan, scroll to zoom (the same controls as the planner's 3D tab).
  - *My call:* the blocks the current step/layer filter shows are drawn normally and the rest very faint, so the
    selected part stands out without losing the whole line. The layer slider cuts away everything above the chosen
    layer, as the web 3D tab does.
  - **Hovering a block** shows a tooltip with its name, its status and which way it should face (the same lines as
    the name tag, §2.2). Faint blocks (outside the filter) can be hovered and clicked too.
  - **Clicking a block** closes the screen and "finds" that ghost in the world: it gets an outline and its name tag
    even when not aimed at, and *(my call)* the top left shows `Finding: LV Input Bus — 23 blocks NE, 2 up` with live
    distance and direction. All of the following are *my calls*:
    - The found block's outline is a **different colour from the aim outline** (cyan rather than yellow), so the two
      can be told apart.
    - It is drawn **through walls and at any distance**, whatever the step/layer filter, x-ray or "Hide ghosts" say,
      because the point is to locate a block you cannot see. Clicking it does not change the filter.
    - Aiming keeps working normally while finding: the aimed ghost still gets its yellow outline and its own tag, so
      two tags can show at once.
    - Finding ends when the player **aims at the found ghost itself**, opens the screen again, runs `/planner clear`,
      or after 60 seconds, whichever comes first. If a refresh brings a line without that block, finding ends.
- **Step list** on the right: `All steps`, then every build step in checklist order with its number and text, done
  steps ticked. Clicking a step shows only that step's ghosts, in the model and in the world, exactly like
  `/planner step <n>`; `All steps` is `/planner step all`. Steps without blocks (configure steps) are listed but
  cannot be picked, as `/planner step` refuses them today. The list scrolls when it is long.
- **"Still needed for step N"** under the step list: the same list as §2.3.
- Bottom row: a **layer slider** over the line's Y range and an **All layers** button (`/planner layer`), an
  **X-ray: on/off** button (`/planner xray`), **Reload** (`/planner reload`) and **Hide ghosts / Show ghosts**.
  - *My call:* "Hide ghosts" is a toggle that hides the ghosts, outline and tag in the world while keeping the line
    loaded (the top-left lines stay), not `/planner clear`, which forgets the line. It lasts until shown again or the
    game restarts; it is not saved.
- Whatever the screen changes is the same state the commands change: picking step 3 in the screen and then typing
  `/planner step all` works as expected, and the top-left `showing …` text follows.

**Nothing loaded, or not placed**

- *My call:* with nothing loaded, the screen says how to connect (paste the `/planner load …` line from the project's
  **In-game projector** panel) and lists the projects already connected (those with a saved token in
  `gtnhplannerprojector.properties`), each a button that loads it like `/planner load <project>`. Only the project id
  is known until it loads, so the button shows the id.
- When the line is not placed in the world, or the player is in another dimension, the screen shows the same reason
  the top left gives instead of the model.

**Live updates**

- The refresh stays as it is: the mod re-fetches the line **every 60 seconds** (`refreshSeconds`). drukoz asked to keep
  that. When the planner's line changed (moved, rotated, re-planned), the ghosts, the model on an open screen, the
  aimed ghost and the needs list all follow the new data. A "found" ghost whose block is gone simply stops being
  found.
- The build check keeps running while the screen is open, so the model's colours change as blocks are placed.
  *My call:* the screen does not pause a single-player game.

### 2.5 Commands stay

Every `/planner` command keeps working as today. `/planner load <project> <token>` (pasted from the website) and
`/planner url …` remain the way to connect the first time and to set the planner address; the screen does not take a
token.

## 3. Non-goals

- No item, block, or anything that needs the mod on the server.
- No change to the planner server, its payload, or the web app.
- No faster refresh (it stays at 60 seconds).
- No switching the tag to a ghost behind the nearest one.
- No editing the line from Minecraft (moving, rotating, ticking steps by hand). The screen only views and filters.

## 4. Anti-goals (a failure even if it works)

- Anything that changes what the vanilla crosshair hits or what a click does: building must feel exactly as without
  the mod.
- Noticeable frame drops while aiming or with the screen open on a line of a few thousand blocks.
- Breaking under GTNH's renderer (Angelica): the ghosts already avoid GL state in display lists for this; the new
  drawing must be as careful.
- A screen that fights NEI (covered panels, stolen clicks or keys).
- A crash. As today, anything that fails in drawing or the screen is caught, logged once, and reported on the HUD,
  not thrown into the game.

## 5. Constraints

- Forge 1.7.10, GTNH 2.9.0-RC-1 client (Java 17–26 via lwjgl3ify, Angelica), client-only (`ClientProxy` wiring; the
  dedicated server's `CommonProxy` stays empty).
- Logic stays out of game classes where it can: the pure packages (`config`, `net`, `model`, `geom`, `view`,
  `check`, `session`) must not import Minecraft, Forge, FML or GregTech (`PurePackagesTest`). The ray walk through
  ghost cells, the stacked list, the needs list, the tag lines and the screen's state (selected step, layer, hidden,
  found block) belong there, with JUnit tests. The game-facing parts (rendering, the GUI, input) go in `client`.
- Vanilla members are reached the way the mod does now: anything under `net/minecraft` must survive reobfuscation
  (`exporter-mod/scripts/check-reobf.sh`; see the comment on `HudOverlay.BLOCK_HIT`).
- LWJGL: the instance runs lwjgl3ify. Use the GL11 calls and Minecraft helpers the mod already uses; do not rely on
  LWJGL 2-only utility classes unless lwjgl3ify is known to provide them.
- Text in the game and in the README is plain English with no jargon, in the style of the existing chat and HUD
  lines.

## 6. Delivery

- README: the "In-game ghost projector" section gains the screen (how to open it, what each part does), aiming and the
  name tag, the stacked list and the needs list; the colours and troubleshooting text are updated where they mention
  the old "looking at" line.
- Version `0.2.0`. Build the jar and replace `gtnhplannerprojector-0.1.0.jar` in the
  `GT_New_Horizons_2.9.0-RC-1_Java_17-26` Prism instance's `mods` folder with the new one (only one projector jar in
  that folder). The game must be restarted to load it.
- The in-game checks in `docs/local/projector-check.md` (local, not committed) gain steps for aiming, the tag, the
  stacked list, the needs list and the screen, so they can be checked by hand in the real client.

## 7. Left to the builder

- How the ray walks the cells, and whether the aim is worked out per frame or per tick (it must look smooth).
- How the model is drawn in the screen (projection, display lists or not, picking the hovered block), within §4–§5.
- Exact sizes, colours and positions of the button, tag, outline and screen widgets, matching the mockups in spirit.
- How long lines in the top left and the tooltip are shortened.
