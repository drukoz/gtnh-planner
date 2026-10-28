# Shorter layouts — design

Status: draft for the user's approval (2026-10-23). Project 1 of 4 agreed with the user: (1) shorter layouts, (2) the base around the line in each project's 3D tab, (3) the flow builder, (4) the whole base in 3D on the World map. Projects 2–4 get their own designs later.

## Why

The user builds GTNH lines by hand the compact way: machines packed around one shared cable line, so every block of cable feeds a machine beside it and one on top, in a row, an L or whatever shape fits. Their words: "the machines I might put on the same cable line in an L formation and other configurations; we need to find the most optimal for this … so that it has less length."

Today the layout has one fixed geometry (`placeUnits`, src/server/layout/arrange.ts, called once from `buildLocal`, src/server/layout/layout.ts): two rows of machines facing a one-block middle row, the power head at the west end and a tail column at the east end. Each machine gets its own stretch of cable. Multiblocks keep a one-column gap and never share walls. Cleanrooms are priced by the planner but never laid out. A machine is reused across steps only on AE2 lines in rate mode (`sharesMachines`, src/server/planner/machine-options.ts; Project Red steps are kept apart by ruling P7), and the user's lines run on EnderIO.

## Goals

1. **Shape search.** For every line, lay out several shapes and keep the one with the least total length:
   - the shapes: a straight row; an L; a U; two rows facing a middle row (today's shape, always a candidate); single-block machines stacked two high along the cable;
   - total length = cable blocks + pipe and conduit blocks + middle-row and other logistics cells + the hookup runs to the base's power tap and storage. Every block counts 1 (the user's measure is length; prices stay add-on 19's and are shown separately);
   - rank candidates by actually laying out their cables and pipes, not by distance estimates (prior art found estimates misjudge cable length);
   - a tie goes to the smaller bounding volume, then to a fixed shape order, so the same plan always gives the same layout;
   - because today's shape stays a candidate, no line ever gets longer than it is today. The comparison is like for like: the chosen shape is never longer than the two-rows candidate laid with the same new rules (the cleanroom, the roof, separate tier runs, reuse). The tests assert that. The real-line log also prints today's old layout length, for information only;
   - the roof (goal 7) counts in the score. Candidates are scored assuming open sky unless the columns the site search reads show cover. After the site is chosen, the roof is dropped where the site is covered or the dimension never rains (the Nether, the End, space dimensions); anything unknown is treated as open sky.
2. **Shared cable.** One cable run per voltage tier. Each cable block powers every machine touching it on a connected side:
   - a basic GT machine takes power on every face except its main (GUI) face (GT `MTEBasicMachine.isInputFacing`);
   - this server uses GT6-style cables (`gt6Cable = true`): a cable feeds only the sides it is connected on. The build steps tell the player to connect the whole run with one sneak + right-click of the wire cutter (GT's multi-connect);
   - that same click links anything of another voltage that touches the run, and an over-voltage machine explodes. So runs of different tiers never touch each other or each other's machines. The layout checks this, and the build steps warn about it;
   - packing: up to three machines per cable block (left, right, on top). The default face order is cable on a machine's left and top, logistics on its right, and the main face toward a reachable side. The shape search decides per line whether a cable block's right side holds a third machine or the logistics, whichever gives the shorter line.
3. **Reach.** Every machine has at least one face next to an air cell that connects to the outside: from a side, from above or from below (the user's rule; they fly, so a cell above or below counts).
4. **Machine reuse across steps** (the user's rule): steps that run on the same machine type with the same programmed circuit, the same non-consumed items (molds, lenses, shapes) and the same fluids share one machine, in every logistics mode:
   - AE2 lines share as today (blocking mode);
   - Project Red (routed) lines share too, with the same warning, except where one step of the shared machine would consume what another of its steps makes: Project Red never routes an item back to the machine it came from (add-on 12's amendment OQ1), so those steps keep their own machines. This replaces ruling P7's keep-apart rule (`keptApart`, src/server/planner/machines.ts) for everything else;
   - direct (machine-to-machine) lines share too, with outputs always extracted and the warning. GT item pipes cannot cap ingredients, so the warning says the jam risk is higher there. Auto Workbenches stay filled by hand in direct mode, as add-on 15 rules;
   - EnderIO and direct lines share too, including single-block machines (the user's choice, 2026-10-23, knowing the risk). GT tries the recipe a basic machine ran last first, and once that recipe's output is blocked the machine stops without trying the other recipe (GT `MTEBasicMachine.checkRecipe`). So:
     - the layout keeps a shared machine's output from ever backing up: its outputs are always extracted (an extraction face into an output chest with room) and each ingredient is capped (EnderIO Limited Item Filter counts), so two recipes' inputs cannot flood it;
     - the plan warns on every such machine, in plain words: it runs two recipes over EnderIO (or pipes), it can jam if its output backs up, and how to clear it in game;
   - a shared multiblock on EnderIO or direct runs with void protection on and one output bus per product locked to that product;
   - a cleanroom recipe never shares a machine with an ordinary one: the cleanroom flag joins the sharing key, so cleanroom pools stay inside the room and the room stays small;
   - the planner's sharing key already matches the user's rule (`sharingKey`, src/server/planner/machine-options.ts). Its gate (`sharesMachines`, same file) opens for EnderIO and direct, and the EnderIO and direct layout code learns that one unit can serve several steps (it reads `unitSteps`/`stepIds` instead of a single `stepId`: modes/enderio.ts `unitOf`, modes/direct.ts).
5. **Cleanrooms.** Steps whose recipe needs a cleanroom and that run on a single-block machine go together inside one cleanroom built as part of the line. Only single-block machines check for a room (GT `MTEBasicMachine`, lines 1126-1129); on this export that is seven machine kinds: Laser Engraver, Cutting Machine, Circuit Assembler, Chemical Reactor, Assembler, Autoclave and Bio Lab. Multiblocks never need one. The room follows GT's `MTECleanroom`:
   - outer size 3–15 wide and long, 4–15 tall (floor and ceiling included), the controller in the middle of the ceiling;
   - the ceiling inside its edge ring is Filter Machine Casings only; the edge ring, walls and floor are plascrete;
   - at least 20 plascrete blocks; at most 30 % of the shell may be other allowed blocks: EV+ glass, IC2 doors (wall interiors only), and exactly one energy hatch and one maintenance hatch (LV or higher), plus machine hulls and diodes;
   - pipes, conduits and AE2 cables cannot pass through the shell: items go in and out through machine hulls, and power through diodes, all within the 30 %;
   - machines must stand strictly inside;
   - the room's blocks count in the line's length and footprint, and in the build list (add-on 14's build steps).

   Planner fix that comes with it: a step is marked as needing a cleanroom only when its chosen machine is a single-block machine (today src/server/planner/machines.ts marks multiblock steps too, and bom.ts prices a room for them).
6. **Wall sharing.** Two multiblocks built side by side share a wall wherever both structures want the same block at the same position: the same block and meta, the same tier for tiered parts, or a hatch both controllers accept. GregTech never claims a block, so a shared casing or hatch counts for every controller around it (StructureLib's `ofBlock` check and GT's hatch adders keep no owner). The rules:
   - share freely: casings, mufflers (the block in front of a muffler stays air), output buses and output hatches;
   - energy hatches only when no recipe of either machine draws more than 1 A (a shared hatch gives each about half), and never on the Electric Blast Furnace, Mega Chemical Reactor, Mega Alloy Blast Smelter, Integrated Ore Factory, Industrial Arc Furnace or Large Thermal Refinery;
   - maintenance hatches only when they are auto-maintenance (a manual repair fixes one controller);
   - never an input bus between steps with different recipes, never a turbine's input hatch, never Railcraft multiblocks;
   - never a cleanroom with another multiblock (its walls take no GT casings), and no two cleanrooms sharing a wall until the user has tested one in a creative world (a hatch in a shared wall counts for both rooms);
   - where sharing applies, the one-column gap between multiblocks goes, and the tests that forbid two blocks in one cell (tests/unit/layout/hatch-placement.test.ts, real-enderio.test.ts) change to "the same block, wanted by both".
7. **Rain.** Machines with an EU buffer can explode or burn when rain or thunder reaches them from above or through an open side column (GT `BaseMetaTileEntity.isRainExposed`). Packed and stacked shapes expose more machines than today's rows. When the site is open to the sky, the layout covers every exposed machine with a one-block roof, or covers on its exposed faces where that is cheaper, and counts those blocks in the build list. Multiblock controllers, cables and steam machines are exempt. Muffler fronts, steam vents and every '-' (must-be-air) cell of a multiblock stay clear, as today.
8. **Existing projects** (the user's answer, 2026-10-23): every existing project switches to the new layout automatically on its next plan; nothing stays pinned to today's shape. A saved dragged placement (origin and rotation) is kept when the new footprint fits there. Otherwise the site search picks a new site and the plan says so once.
9. **The planner's machine estimate follows.** Add-on 19 gives the build model a per-machine logistics estimate (its trunk cells per amp and spine cells per unit), sized for today's cable per machine. With shared cable runs and packed shapes each extra machine costs much less cable. This project ends with a calibration task: measure the cable and pipe blocks per machine on the fixture lines and the user's real lines under the new layouts, then update the estimate's constants to match, so the planner weighs machines the way the layout will build them. No change to the build MIP's structure.
10. **What the user sees.** The 3D tab shows the chosen shape, each candidate shape's total length beside it, and a choice to pin a shape for the project. The line's steps say how to connect the cable run, where the roof goes and how the cleanroom is built.

## Non-goals

- Projects 2–4: the base around the line in 3D, the flow builder, the whole base in 3D.
- Part prices and cable or pipe picks: add-on 19 owns them; the shape search counts blocks.
- Splitting one voltage tier into separately fed groups (backlog), unless a shape needs it to stay buildable.
- Stacking multiblocks: only single-block machines stack (a muffler, a vent or a '-' air cell is never covered).
- Placing machines into a cleanroom the group already owns: later, when the user points at one.

## Anti-goals (a failure even if it technically works)

- A layout that cannot be built as drawn: a shared wall that is invalid for one of its controllers, cables of two tiers touching, a cleanroom that does not form, a machine left open to rain.
- A machine the player cannot reach.
- Feeding that overfills or deadlocks, beyond the shared-machine jam the user accepted with its warning.
- A different layout for the same plan on another run, or a line that takes much longer to lay out than today (the user's real line should stay around a second).
- Any test line longer than today's layout.

## Constraints

- **Where it plugs in:** `buildLocal` (layout.ts) replaces its single `placeUnits` call with a loop over the candidate shapes. Each candidate is placed and its stages 3–5 laid (power, logistics, feeding), then scored. Only the best one or two get the site search and real hookups, with hookup length estimated for ranking. Placement takes about 0.1 ms and routing 1–11 ms on fixture lines and about 145 ms on the user's real line, so five candidates cost roughly 0.7 s there. Long lines may lay fewer candidates.
- **Feeding:** add-on 21's checker (when it lands) can break ties and reject a shape that would jam; until then the static feeding rules (feed-rules.ts) must stay clean on every candidate.
- **Other lanes:**
  - add-on 19 (priced parts, runs per tier) is built and lands first; the shape search builds on its runs;
  - add-on 15 (direct-mode lanes) is still a plan. It waits until this lands and is re-baselined onto the shape loop, so it lays its lanes on whatever placement it gets. Today it assumes the two-rows geometry, which would be the costliest thing to rebase later;
  - add-on 17's farm areas are placed after the shape is chosen (they need its bounding box);
  - add-on 14's build steps list the roof, the cleanroom and each shared wall block once;
  - the hookup route (architecture §11 entry 52) stays as merged.
- **Architecture:** one new §11 entry, 53 ("Shorter layouts, as built"), states the shape search, cable sharing, reuse in every mode, the cleanroom, wall sharing and the rain roof. It amends entry 39's NETWORKED_LOGISTICS rule (reuse now in every mode).
- **Tests:** synthetic fixtures for each shape and rule, the random-line and rotation checks extended to every shape, and the user's real lines logged with today's and the new total length.

## Decided

By the user:
- least total length is the measure; shapes include rows, L, U and stacking, and a cable block feeds machines on several sides (2026-10-22/23);
- a machine is reachable from one side, from above or from below;
- machines are reused across steps with the same circuit in every mode, EnderIO included, with a jam warning (2026-10-23);
- existing projects switch to the new layouts automatically (2026-10-23);
- cleanrooms and wall sharing are part of the layout;
- the order of the four projects.

By the designer (the user can overrule any of these when reading):
- every block counts 1 in the score, prices shown separately;
- flight counts for reach (a free cell above or below is enough);
- the face order (cable left and top, logistics right, main face reachable), with the right side decided per line;
- one cable run per voltage tier, the lowest tier nearest the power head, as today;
- the jam mitigation on shared EnderIO machines (outputs always extracted, ingredients capped);
- cleanroom recipes get their own shared machines; one minimal room per line;
- the wall-sharing hatch rules above, and no shared cleanroom walls for now;
- a one-block roof (or covers) over exposed machines when the site is open to the sky;
- only single-block machines stack;
- add-on 15 waits and is re-baselined onto the shape loop;
- "never longer than today" means like for like against the two-rows candidate under the new rules;
- the roof counts in the score, assuming open sky until the site shows cover;
- Project Red and direct lines share machines too (Project Red keeps steps that feed each other apart; direct warns that pipes cannot cap);
- a dragged placement is kept when the new footprint fits there;
- the calibration of add-on 19's per-machine estimate is part of this project.

## Left to the builder

- How each shape is generated (where an L bends, how wide a U opens, how rows split), the search order and pruning, and the data structures.
- The roof's material and form (full blocks, slabs or covers), as long as it stops rain and is counted.
- Warning and step wording, in the app's existing plain style.
- Performance tactics within the budget above.

## For the user to check in game later

- A wall-shared pair of multiblocks forms and runs.
- A cleanroom laid out by the planner forms (size, hatches, hulls and diodes).
- A shared single-block machine on EnderIO: how often it jams, and that clearing it works as the warning says.
- Two cleanrooms sharing a wall, in a creative world, before the planner ever does it.
