# Performance review (RUK-529)

What the planner spends its time on when a project's line is planned, laid out and drawn in 3D, measured on the group's
own data, and what we change. The plan of work is `docs/superpowers/plans/2026-11-04-performance.md`.

## How it was measured

- A read-only copy of the group's data (the 2.9 export `2.9.0-RC-1_20261020-204809`, three scans, the project database
  and the textures) in a scratch folder, served by a scratch planner on 127.0.0.1:18790 at `759a117`. The group's own
  planner and its `data/` were not touched.
- The seven live projects, all EnderIO lines on a scan with a base: Circuit, diamond, MV circuit, test, Duty plate,
  poly and HV Circuit.
- "Cold" means a freshly started server, so nothing is cached. Server CPU from `node --cpu-prof`; solver calls timed by
  a wrapper round `solveLp`; browser times from headless Chromium (Playwright 1.63) with a CDP CPU profile.
- Every run starts from a fresh copy of the database (the surplus board is stored in it). Two such runs of the current
  code gave byte-identical plans and layouts for all seven projects, so any change below can be checked byte for byte.

## Findings, biggest first

### F1. The 3D view waits for the plan, not for the 3D

Opening a project on its 3D tab on a cold server:

| Project | Plan answered | Layout answered | First 3D frame |
| --- | ---: | ---: | ---: |
| Circuit | 6.9 s | 6.1 s | 7.1 s (first visit, includes the export still loading) |
| diamond | 2.4 s | 0.8 s | 2.4 s |
| MV circuit | 5.6 s | 4.2 s | 5.7 s |
| test | 7.3 s | 5.6 s | 7.4 s |
| Duty plate | 11.6 s | 9.0 s | 11.7 s |
| poly | 1.5 s | 0.3 s | 1.5 s |
| HV Circuit | 9.2 s | 8.4 s | 9.3 s |

The layout route asks for the plan first, so both wait for it. Of the server's 43 s of CPU over these plans, laying the
lines out (site, machines, wiring, hookups, parts) took 1.2 s, about 0.2 s a line. In the browser, building the scene
and drawing it took under 0.2 s of main-thread work per project, and about 0.2 s with Show connections on. The Flow, Map,
Connections and Materials tabs had no main-thread task over 50 ms once the plan was there.

### F2. Projects that share surplus re-plan on every visit, and their plans flip

Six of the seven projects read other projects' surplus (add-on 17). Visiting the seven in a fixed order, round after
round, gives each of them a different read of the board every round, alternating between two states, so the plan cache
(keyed by what the plan read) misses and the plan is made again: 11 to 19 s per round of visits instead of 6 to 46 ms
for a real cache hit. A fixed order settles into a two-state cycle that the cache can hold after two rounds; any other
order (several people, edits, the Compare card) keeps finding new states.

The plans flip with it, and anyone can see it. Between two visits, MV circuit takes 2.5 L/s of woodgas from Duty plate,
then buys medium oil instead, then takes the woodgas again. HV Circuit takes its nitrogen from Duty plate, then from
MV circuit. Steps, raw inputs and build lists change with each flip. The cause is the circle check (`drawsReach` in
`src/server/projects/surplus.ts`). A project may read another's surplus unless that other one's current draws reach
back to it, and those draws change with every plan. The fan-out's 60 s rounds stop the notifications looping, not the
re-planning.

Any rule that ends the flip-flop has to make sharing one-way where two projects could feed each other. That changes
what some plans take from whom, so it was the user's decision. On 2026-11-04 the user chose **newer projects take
from older ones**. A project takes another's surplus only when that project is older, or when it reads nothing of the
board itself ("Use other projects' surplus" off and not "Best multi-output"), so nothing it plans can depend on the
reader. Both conditions hold whatever the plans draw. So the projects' reads depend only on older projects' plans, and
the board settles after one pass in age order.

Prototype of that rule on the same seven projects, with the database reset and plans visited in the fixed order for four
rounds, then in reverse order for two:

| Round | Slowest plan | Plans answered from the cache |
| --- | ---: | ---: |
| 1 (cold) | 12.0 s (Duty plate) | 0 of 7 |
| 2 | 7.0 s (Duty plate) | 4 of 7 |
| 3 and 4 | 0.045 s | 7 of 7 |
| 5 and 6 (reverse order) | 0.041 s | 7 of 7 |

Under the old rule, rounds 2 and 3 still took 1 to 7 s a project. What changes in the plans (the database's board as
of 2026-11-03):

- MV circuit, the oldest, takes nothing from the others. It took Circuit's gt.metaitem.01@2010 and Duty plate's resin
  and woodgas.
- test takes MV circuit's carbon dioxide only, no longer Duty plate's, poly's or HV Circuit's goods.
- poly takes MV circuit's carbon dioxide and test's oxygen, no longer Duty plate's woodgas.
- HV Circuit takes from Circuit, MV circuit, poly and test, no longer Duty plate's nitrogen (it takes MV circuit's
  hydrogen now).
- Duty plate, which nothing older could take from before, now takes HV Circuit's nitrogen (69.7 L/s) and rubber wood,
  and poly's nitric oxide and charcoal.
- Circuit and diamond take nothing, as before.

A line in "Best multi-output" still reads every project's needs, so lines in that mode can still change each other's
plans; none of the group's lines uses it.

### F3. A cold plan takes 1.5 to 12.6 s, mostly in the solver and the candidate graph

| Project | LP/MIP solves | Solver time | Build-cost MIPs | MIP time |
| --- | ---: | ---: | ---: | ---: |
| Circuit | 132 | 1.2 s | 2 | 0.2 s |
| diamond | 68 | 0.5 s | 3 | 0.0 s |
| MV circuit | 126 | 2.8 s | 2 | 1.8 s |
| test | 169 | 2.7 s | 3 | 1.3 s |
| Duty plate | 180 | 14.2 s | 5 | 12.3 s |
| poly | 27 | 0.1 s | 3 | 0.1 s |
| HV Circuit | 195 | 7.3 s | 3 | 5.7 s |

(Solver time adds up solves that overlap on the two threads, so it can exceed the plan's wall time.)

- The build-cost MIPs (up to 6,111 columns by 5,518 rows) stop at their node and simplex-iteration limits, so they are
  deterministic. They take up to 4.6 s each and decide the plan, so their limits and options stay as they are.
- `standalonePrices` (`src/server/planner/solve.ts`) solves about 90 small LPs per cold plan, one after another, though
  each is independent of the others: 622 solves and 6.9 s over the seven plans.
- The JavaScript is spread out: `buildCandidates` and `estimateCosts` (`src/server/planner/candidates.ts`) walk the
  reachable recipe graph many times per plan, about 12.7 s over the seven, mostly string-keyed map lookups. No single
  line is over 1 s.
- Measured and dropped: a cache of solver results keyed by the model. Only 125 of 1,068 solves repeat a model exactly.
  It would save 0.8 s and cost 2.6 s of hashing.

A prototype that runs the standalone prices side by side on a pool of solver threads (the module already has one
solver thread, `solveLpAside`) gave byte-identical plans and layouts. Total cold time for the seven plans: 42.0 s
today, 39.9 s with 1 thread, 36.4 s with 4, 36.9 s with 8.

### F4. While a plan is made, the server answers nothing else

Planning runs on the server's one thread, apart from the solves sent to the solver thread. Requests that arrive
meanwhile wait: on a cold Circuit, the page's icon request took 6.9 s. With several people on the planner, one plan
holds up everyone's pages, textures and map tiles.

### F5. Nothing is compressed

A plan is 0.8 to 4.1 MB of JSON and a layout 20 to 260 KB, sent as they are, and so are the JavaScript files
(0.6 MB for the main one). For a friend on the forwarded port, 4 MB is about 3 s at 10 Mbit/s. The largest plan
compresses 15× with gzip (267 KB in 20 ms) and 30× with brotli at quality 4 (137 KB in 6 ms). Over plain HTTP, the
way the group reaches the planner, Chrome and Firefox offer gzip only. 2.9 MB of that plan is `buildList`'s nested
breakdown, which compresses well.

### F6. The 3D, Map and Connections tabs rebuild on every plan refresh

Every `plan` event (an edit, or another project's change reaching this one) gives the page a new plan object. The tab
then fetches the layout again and gets a new object even when nothing changed. The 3D tab disposes its viewer, asks for
the block faces again, composites every tile, rebuilds the meshes and, with Show connections on, the link geometry.

### F7. Smaller ones

- Hovering in 3D raycasts three.js's instanced meshes, which tests every instance: fine at these sizes (a 1,000-block
  line picks in under 6 ms), linear in the line's size.
- Show connections builds its geometry in one 180 to 220 ms task on the main thread.
- The hookups' path search (`findPath`, `src/server/layout/path.ts`) is most of the layout's 0.2 s a line. It matters
  for Move line, which lays the line out again on every move.
- The plan cache keeps 32 plans in memory and the layout cache 16 layouts. After a restart everything is cold again.

## What is not slow

- Laying the line out, building the 3D scene, drawing it, and the Flow, Map, Connections and Materials tabs on the
  group's lines.
- The recipe export already loads in the background at start (`src/server/main.ts`).

## What we change

Milestone 1, the first pull request: the surplus rule the user chose (F2), compressed responses (F5), the tabs keep the
plan and layout they have when a refetch brings the same one (F6), and a pool of solver threads with the standalone
prices solved side by side (F3, F4: the main thread is free while they solve).

Milestone 2: faster cold plans and a server that keeps answering (F3, F4). First a repeatable measurement and
byte-for-byte check of the seven projects (`tools/perf/`), then planning off the main thread. We try faster HiGHS
builds and the candidate-graph JavaScript, each measured on the same seven projects and kept only if it gives
byte-identical plans or the user accepts the changes. The plan cache survives a restart.

Milestone 3: smoother 3D on big lines (F7). Picking by the block grid, link geometry off the main thread, and a faster
path search for Move line.
