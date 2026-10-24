# Your base around the line, in the 3D tab — design

Status: draft for the user's review (2026-10-23). Project 2 of the four agreed on 2026-10-23 (1 shorter layouts,
2 this, 3 the flow builder, 4 the whole base on the World map).

## Why

The 3D tab of a project shows the planned line floating alone. The user's base appears only as at most two faded
"ghost" blocks where a hookup meets it. Yet the layout already reads the base from the world scan on every lay
(about half a million voxels around the base, `readAreaVoxels` over `siteSearchBox`) to pick the site and route the
hookups, and throws those voxels away.

The user wants to open a project's 3D tab and answer three questions there (their words, 2026-10-23):

- **Does it fit?** Where the line sits among their blocks, and what it bumps into: walls, floors, other machines.
- **Where do the hookups run?** The real path of the power cable, pipes and ME link out to the base, and their length.
- **Finding my way:** recognise the spot from their own buildings, so they know where to build it in game.

They also want to **move and turn the line right there**, among their blocks, not only on the Map tab.

They saw a mockup (faded base in their pack's textures, the line in colour, red clashes with a count, hookup runs
drawn in full with lengths, Base on/off, the layer slider, "Base as scanned 2 days ago", Move line / Rotate 90° /
Auto place in 3D, map and 3D always on the same spot) and said "looks great".

## Goals

1. **Your base around the line.** The 3D tab draws the user's blocks in the *view area*: the line's footprint plus a
   margin, and a tube around every hookup run and the tap it joins. Base blocks are drawn faded; the line, its roof and
   cleanroom (plan 22) and its hookup runs in colour.
2. **Fit, as a count that matches the server.** Every line cell that meets a base block is classed and coloured:
   - **clash** (red): the user's own things — machines, pipes, cables, conduits, storage, any placed block that is
     not natural terrain;
   - **dig** (amber): natural terrain the build has to dig out (stone, dirt, gravel, sand, ores, …);
   - **harmless** (not shown as a problem): blocks the line simply replaces (air, grass, flowers, snow layer, vines,
     torches, modded foliage, …).

   The side list says e.g. "2 clashes · 7 blocks to dig". Columns with nothing under the line say "no floor under
   N columns". Cells the scan does not hold (outside the copied regions, a missing chunk, an unknown block id) are
   drawn as "not scanned", never as open air. The rule is one shared function used by the server's site check and by
   the browser, so the red count in 3D always equals what the server reports after a drop.
3. **Hookup runs drawn in full.** Each power, item and fluid run is drawn from the line to the block it joins, with its
   length in blocks in the side list and on hover ("Power: 26 cables to your 16 A cable"). A run that found no path is
   drawn as the Map tab draws it: a dashed straight guide.
4. **Finding your way.**
   - Base blocks in the user's resource-pack textures (see Textures).
   - Hover names any block, base or line. One naming function for the whole app; GregTech ores are named by their
     material, not `gregtech:gt.blockores2`.
   - "Base: on/off" hides the base. The layer slider runs in world height and cuts the base and the line together.
   - The camera keeps its view when the layout changes (today every new layout resets it).
   - "Base as scanned N days ago" from the project's scan. When a newer scan of the same world exists, the note offers
     "Use newest scan" (one click; it re-lays the line on that scan).
5. **Move and turn in 3D.**
   - "Move line" enters a drag mode: the line follows the pointer over its floor plane, snapped to whole blocks. Its
     clashes, digs and no-floor columns update live, from voxels already in the browser. Nothing is sent to the server
     while dragging. The hookup runs are hidden during the drag and redrawn when the server has re-laid the line (a
     visible "laying out…" state in between).
   - Release sends the existing `placement` op, so the Map tab, the Steps, the Connections tab and the in-game projector
     all follow (one op per drop, as on the map).
   - "Rotate 90°" turns the line about its centre, in both tabs.
   - Page Up / Page Down move the line to the next floor level above or below: the nearest height where the line's
     footprint stands on blocks (not a single block step; a single step from an auto-placed line always floats or
     buries it). The canvas takes keyboard focus for this; R rotates and Escape cancels a drag.
   - The drag stops at the edge of the area the server accepts (96 blocks from the base centre) and says so.
   - "Undo move" takes back the last drop. "Auto place" stays as the reset.

## Textures from the user's resource packs

The user answered "use my packs" for the 3D view and the map (2026-10-23).

- The asset extraction (`npm run extract-assets`) gains a third source kind, a resource pack, ranked above every jar.
  It reads the user's GTNH 2.9.0-RC-1 client instance read-only (Prism Launcher on this Mac): the `resourcePacks` line
  of its `options.txt` once per run, and the enabled packs, folders and zips alike, in the game's priority order.
  Today that is UU-Tex-main (folder), Modernity-GTNH-Dark-UI (folder; GUI and items only) and
  Modernity-GTNH-2026-08-31.zip. Missing files fall back to the jars as today.
- Block and item textures with their `.mcmeta` (item icons with an NEI dump icon keep it; the item textures matter
  where an item has none). An `.mcmeta` pairs with its PNG the way the game pairs them. In `options.txt` the last
  listed pack wins, as in the game (Minecraft 1.7.10 saves the selected list lowest priority first). Folder packs
  match file names without regard to case, as the game does on this Mac's file system; zip packs match exactly.
- The index records each file's pack (name and version from `pack.mcmeta`) and the pack list it was extracted with, so
  the app can say "textures from Modernity …" and a later run can tell that the packs changed.
- Connected textures (the packs' MCPatcher CTM files) are not drawn: each block shows its own base tile, so a wall of
  casings looks tiled rather than seamless. Animated textures show their first frame, as today.
- Everything stays in `data/assets/` (gitignored). Nothing from a pack is ever committed.
- The Map tab's colours come from block tops, so the map changes look too, as intended.
- Expect most of what the base shows to change: 849 of 978 vanilla block textures, 179 of 202 GT casings and 982 of
  988 GT machine overlays are overridden by the two block packs.

## Non-goals

- The whole base (project 4, on the World map).
- What is attached to the machines a line reuses (the user did not pick it; fix wave 4 adds the "busy until freed"
  rule for reuse).
- Covers, settings and contents of base blocks: the scan does not hold them.
- Live world data: the view is as fresh as the project's scan.
- Changing how hookups pick their taps (the weak-power-feed fix is separate).
- Showing pack textures to friends: that is decided in the user-accounts project (see Constraints).

## Anti-goals (it fails even if it "works")

- The red count in 3D disagrees with the server's count after the drop.
- The camera jumps back after every move.
- Hover or drag stutters on the user's projects.
- Any request reaches the server while the user is still dragging.
- A project without a scan or base behaves differently from today.
- A pack texture, or anything game-derived, gets committed.

## Constraints

- **Sequencing.** The base view and the 3D drag build after plan 22 (shorter layouts) lands in main. Plan 22 rewrites
  the code this touches: placement becomes a path (Task 5), one voxel read shared by every shape candidate (Task 12),
  dragged placements and the "already holds the block the line wants" exemption (Task 13), roof and cleanroom blocks
  that count as line blocks (Tasks 11, 14), and a shape list in the 3D tab's side column (Task 17). The resource-pack
  textures do not depend on plan 22 and can be built first.
- **Plan 22 Task 13 conflict.** Under plan 22, a dragged spot with any blocked cell is dropped and the line re-placed
  automatically ("placement_refit"). On 4 of the user's 5 projects even the auto spot counts 1–7 blocked cells today
  (terrain the site plans to dig). This design's three cell classes and per-line-cell count change what "blocked"
  means; plan 22's rule must be re-read against them before either is built (see the open question below).
- **Base voxels are not part of the Layout.** Layouts sit in a 16-entry cache shared by all projects and are sent to
  the 3D, Map and Connections tabs and the projector route. The base comes from its own cacheable route keyed by scan,
  box and texture-pack version, so the base mesh survives layout changes.
- **Limits that stay:** a dragged spot is kept within 96 blocks of the base centre; one read is at most 192 blocks
  across and 8,388,608 voxels; region files are copied only within 128 blocks of a base.
- **Code rules:** `src/shared/` stays pure; erasable TypeScript; no new npm dependency; three.js as today.
- **Friends and licences.** UU-Tex and Dark-UI are CC BY-NC-SA 3.0; Modernity states no licence of its own. Using them
  on this Mac is fine. Serving them to friends is sharing them: the user-accounts project decides that (for example
  pack textures for the owner, stock for others), before the site leaves this Mac.

## Measured on the user's data (2026-10-23, read-only copies)

- 5 live projects, one base (89 × 42 × 119), all auto-placed, scans 3–4 days old (a newer scan from tonight exists).
- Today's site read: 137 × 20–25 × 167 voxels per project, read in 7–122 ms; a whole lay 35–161 ms.
- The view area (line + 8, plus 8 around every run and tap): 8.5k–23.9k base blocks, 4.1k–7.7k of them touching air,
  156–187 distinct block states. The whole site read holds 251k–269k base blocks, 78k–83k touching air.
- Drawing is cheap (750k cubes at 3.7 ms a frame on this Mac); picking by ray over instances is not (20 ms at 339k
  instances, run on every pointer move today). A spot check against voxels already read takes 0.01–0.14 ms.
- Each drop today costs a full re-lay plus 206–294 ms of plan expansion and a 0.5–2 MB plan download; the new runs
  appear 0.35–0.7 s after release (about 1 s or more after plan 22).
- Hookup runs today stay within 1–3 blocks of the line's floor, and nothing stands over auto-placed lines; multi-floor
  cases appear only once the user drags a line indoors or up and down.

## Acceptance (what "done" looks like)

On this Mac, with the user's 5 projects and their newest scan:

- Opening a project's 3D tab with the base takes at most 1.5 s the first time; the base payload is at most 500 KB
  compressed.
- Hover and click answer within 2 ms; a drag's live check within 1 ms per pointer move; 60 frames a second at
  the screen's full resolution.
- After every drop, the 3D tab's clash, dig and no-floor counts equal the server's.
- The tile set fits the WebGL2 minimum of 256 texture layers for every view area, or degrades to plain colours without
  breaking; the faded base does not shimmer at the default distance (mipmaps or equivalent).
- A project with no scan or base shows exactly today's 3D tab.

## Calls made by the designer (the user may overrule any)

1. View area: the line's footprint plus 8 blocks, plus 8 blocks around every hookup run and tap; from 4 blocks below
   the line's floor to 8 above its top, deeper where a run goes lower.
2. Three cell classes (clash / dig / harmless). Torches and modded foliage move from "in the way" to harmless, which
   changes the server's site choice slightly and some pinned layout figures.
3. Counts come from the line's own cells (and its runs), not from its whole bounding box as today (the box count is
   2.5–4.7 times larger).
4. "No floor under N columns" for a line that floats.
5. Rotate turns about the line's centre, on the Map tab too.
6. Page Up / Page Down jump to the next floor level, not one block.
7. One-step "Undo move".
8. "Use newest scan" is offered, never automatic.
9. The faded base is drawn as an opaque pale tint, not see-through, so thousands of overlapping faces do not turn
   murky; clicks prefer line blocks over base blocks.
10. Harmless decor (grass, flowers, torches, foliage) is not drawn; slabs are drawn half height; other shapes as full
    cubes.
11. Hookup runs are hidden while dragging and redrawn after the re-lay.
12. Connected textures are not drawn; animated textures show frame 0.
13. The resource-pack textures are built first, on their own, because nothing else waits for them.

## Settled after the builder check (designer calls; the user may overrule any)

14. **What counts as natural terrain.** "Dig" is a fixed list of world-generation blocks (stone, dirt, grass block,
    gravel, sand, sandstone, clay, the ores, netherrack, end stone and the like). Every other placed block is "clash".
    Bedrock is never dug: it counts as clash ("cannot build here").
15. **Fluids.** A water or lava cell (source or flowing, vanilla or modded) inside the line counts with "dig" (drain
    or fill it); a fluid under the line counts as "no floor".
16. **Only red cells can stop a drop.** Dig, fluid, no-floor and not-scanned cells never refuse or move a dropped line:
    they are reported (dig and fill as a build step, as today; no floor and not scanned as warnings). What happens on
    red is the open question below. Plan 22 Task 13's refit rule ("any blocked cell moves the line") is narrowed the
    same way by this project's plan.
17. **Auto place never picks a spot with red cells.** Today `findSite` treats the user's own walls and floors as
    terrain it may level; with the classes it must not build into them. Dig keeps today's scoring. This changes site
    choice and pinned figures, which are re-measured after plan 22.
18. **A drop keeps the shape on screen.** The stored placement records the shape that was dragged (plan 22 may pick a
    different shape at a new spot otherwise); "Auto place" clears it and lets the shape search run again.
19. **What the browser holds during a drag.** Two things: the drawn view area (block ids, for drawing and naming), and
    a compact class grid (air-like, fluid, natural, placed, not scanned) over the whole drag range — 96 blocks around
    the base centre and the base's full height plus margins, for Page Up / Page Down — used only for the live counts.
    The faded base stays drawn around where it was loaded while dragging; after a drop the drawn view area reloads
    around the new spot.
20. **"Use newest scan"** uses the existing `world` op: the project moves to that scan, so its owned machines, power
    and storage update too, and the plan may change. The button says so.
21. **Who can see the textures today.** The live site and the preview listen on 127.0.0.1 only (checked 2026-10-23),
    so nobody else sees the pack textures until the user-accounts project opens the site.
22. **"Undo move"** puts back the placement from before the last drop (or Auto place, if the line was auto-placed).

## Left to the builder

- The mesh technique (culled faces on instanced cubes, or merged meshes per chunk), as long as the acceptance figures
  hold.
- The payload encoding (palette-indexed with run-length coding, or only blocks that touch air).
- Picking (a voxel grid walk is the measured way to stay under 2 ms).
- Colours, the tint, and how the side list fits beside plan 22's shape list.
- The floor-level rule for Page Up / Page Down (how much of the footprint must stand on blocks).
- Where the shared cell-class rule lives in `src/shared/`, and how the existing replaceable list and the two
  block-name functions merge into it.
- How the extraction finds the client instance (a config key next to the existing client jar, plus a CLI flag).

## Open question for the user

- When you drop the line where it hits some of your blocks (red), should the planner keep it there and list the
  blocks to clear in the build steps, or refuse the drop and leave the line where it was?
