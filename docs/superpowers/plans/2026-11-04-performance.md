# Performance plan (RUK-529)

Kind: **Program** (three milestones, one pull request each). The findings and measurements are in
`docs/superpowers/specs/2026-11-04-performance-review.md`.

## Assumptions

- "Make it faster when it comes to computing the 3D and more" means what the group waits for when it opens or revisits a
  project's 3D tab, and the other tabs on the same path. The measurements show that wait is the server's plan, not the
  3D itself (review F1), so the plan, its cache and the network come first and the 3D drawing last.
- Every speed-up keeps the plans and layouts byte for byte, except the surplus rule, which the user chose on
  2026-11-04: newer projects take from older ones (review F2).
- Plain HTTP stays: the group reaches the planner over a forwarded port, so compression is gzip, the only encoding
  Chrome and Firefox offer there.
- The projector mod is not changed. It sends no `Accept-Encoding`, so it keeps getting plain responses.

## Reuse ledger

| Capability | Candidate | Decision | Why |
| --- | --- | --- | --- |
| Compressed responses | `node:zlib` (Node 24, built in) | use | gzip is all browsers offer over plain HTTP. Express's `compression` middleware does not fit the hand-written router. |
| Solver threads | `solveLpAside` in `src/server/planner/lp.ts` (`node:worker_threads`, one HiGHS per thread) | use, as a pool | Already loads HiGHS on its own thread. A 4-thread pool gave byte-identical plans (prototype, 42.0 s to 36.4 s for the seven cold plans). A pool library would add a dependency for 30 lines. |
| "Same answer again" on refetch | JSON text of the shown plan or layout | build (about 15 lines) | An ETag would need server changes for the same effect. |
| Faster solves | `highs` 1.15.4 (newer than the pinned 1.15.3), a native HiGHS binding | spike in milestone 2 | Either may change the build MIPs' answers, so each needs the byte-for-byte check first. |
| Measurement and byte-for-byte check | the scratch scripts of the review | build in milestone 2 (`tools/perf/`) | Nothing in the repository measures the real projects. |

## Milestone 1: the revisit is instant and the bytes are small (`feat/perf-m1`)

What the group sees: coming back to a project answers from the cache (under 0.05 s instead of 1 to 12 s), plans no
longer change between visits, a friend on the forwarded port downloads about 15 times fewer bytes, a refresh that
changes nothing redraws nothing, and cold plans take about 13 % less time.

| Subtask | What | Files | Blocked by |
| --- | --- | --- | --- |
| A | The surplus rule: newer projects take from older ones, and from projects that read nothing of the board | `src/server/projects/surplus.ts`, its tests, `tests/unit/http/cross-project.test.ts`, README, design spec | — |
| B | A pool of solver threads; `standalonePrices` solves its LPs side by side | `src/server/planner/lp.ts`, `solve.ts`, new `tests/unit/planner/lp-pool.test.ts` | — |
| C | gzip for JSON answers and the client's files | new `src/server/http/compress.ts`, `router.ts`, `static.ts`, new `tests/unit/http/compress.test.ts` | — |
| D | Keep the shown plan and layout when a refetch brings the same one | new `src/client/state/same-json.ts`, `project-store.ts`, `use-layout.ts`, two client tests | — |
| QA | Verify the merged branch: suites, browser tests, compression and the revisit on the e2e data | tests only | A, B, C, D |

A, B, C and D touch different files and run in parallel. A and B hand the engineer a patch I verified on `main`
(`docs/ruk-529/reference/`, removed before the pull request is marked ready). C and D are specified in full in their
tasks. At the end I run the seven real projects (on a copy of the group's data) through the merged branch: rounds of
visits as in the review, the cold total, and a byte-for-byte check against the prototype's plans.

## Milestone 2: faster cold plans and a server that keeps answering (`feat/perf-m2`, RUK-563)

Builds on milestone 1 (`feat/perf-m1`, PR #11). Every change keeps the plans and layouts byte for byte.

### Where it starts (measured 2026-11-04 on `c922fc180`)

The RUK-529 copy of the group's data (`/tmp/ruk529`: the 2.9 export, three scans, `planner.sqlite.orig`), a fresh copy
of the database for every run, a server on its own port, `GTNH_LP_THREADS=4`. Every live project, oldest first: its
plan and layout cold, then its plan in two warm rounds, then, after a restart on the same data, its plan and layout
again. Three runs gave the same bytes, 42 files: `cold/` (7 plans, 7 layouts), `warm1/` and `warm2/` (7 plans each),
`restart/` (7 plans, 7 layouts). That is the milestone's reference, kept read-only in `/tmp/ruk563/reference`.

- Oldest first, the board settles in one pass: both warm rounds answer every plan from the cache (8 to 46 ms). In
  another order a project can plan before an older one it takes from, and plans again the round after (id order: Duty
  plate took 34.7 s cold and 33.5 s again in round 1).
- The warm plans differ from the cold ones by `drawnBy` (who draws on a project changes as newer projects plan). After
  the restart, the plans equal `warm1/` and the layouts `cold/`, but every plan is cold again.

| | MV circuit | Circuit | test | poly | HV Circuit | Duty plate | diamond | all seven |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Cold plan (s) | 9.32 | 2.80 | 7.66 | 3.30 | 6.95 | 8.30 | 1.63 | 39.98 |
| Plan after a restart (s) | 8.28 | 2.57 | 6.64 | 3.36 | 6.78 | 8.02 | 1.63 | 37.28 |
| Longest wait for `/api/health` meanwhile (s) | 1.59 | 0.85 | 1.43 | 0.85 | 2.09 | 3.15 | 0.61 | |

(Load average 11 to 16 from other agents' work on the Mac; the review's 42.0 s was measured before milestone 1.)

Where the server's main thread spends a cold pass and two warm rounds (CPU profile, 47.8 s sampled):
`buildCandidates` 15.9 s, of which `estimateCosts` 14.5 s (5.6 s in its own body: the settle loop scans every input
of every consumer for each good it settles); HiGHS on the main thread 14.5 s (`mainLp` and the other `solveLp` calls the
pool does not take); `availability.ts` 2.6 s; loading the pack 2.4 s; garbage collection 1.7 s; idle 2.2 s.
`buildCandidates` by caller: the line's walk (`settle`, pricing.ts) 5.4 s, the build list's recipe book
(`recipeBook`, bom.ts) 3.2 s, build costs (build-cost.ts) 3.0 s, `aloneGraph` 2.5 s, `analyze` 1.8 s.

### The spikes the plan named, answered before any engineer started

| Spike | What was measured | Decision |
| --- | --- | --- |
| `highs` 1.15.4 | It changes 9 lines of highs-js's bridge, for the `mipUserSolution` callback, which the planner does not use; HiGHS stays 1.15.1. All 42 files byte-identical; the seven cold plans 41.6 s against 40.0 s (noise). | Not adopted here: nothing to gain. A later dependency task can take it. |
| A native HiGHS binding | On npm, `highs-addon` 0.10.3 wraps HiGHS 1.11.0 without callbacks (the build MIP needs `mipInterrupt` and `mipImprovingSolution`), and `ortools-node` reaches HiGHS through OR-Tools. So the question was whether native HiGHS 1.15.1 gives our solves' answers at all. Every solve of three cold plans (428) was dumped from highs-js and solved again with highspy 1.15.1 (the same HiGHS, native): the PyPI wheel matched 77 of 421 LPs bit for bit; a source build with `-ffp-contract=off` (no fused multiply-add, as WASM) matched 421 of 421 LPs and solved them 2.5 times faster (5.1 s to 2.1 s), but none of the 3 MIPs it could replay (also with `threads=1`). | Dropped. The build MIPs decide the plans and come out different. Native LPs alone would save about 4 s of the seven cold plans (their LPs take about 7 s) for a C++ toolchain and a HiGHS build in every install. The probe is in `spikes/native-highs/`. |
| The hot loops of `buildCandidates` and `estimateCosts` | The profile above. | Subtask (RUK-565, merged): settle each good through an index of the slots it fills (exact: the same estimates in the same order), then measure what is left: below, under "The settle index, measured". |

### Subtasks

| Subtask | What | Files | Blocked by |
| --- | --- | --- | --- |
| `tools/perf` (RUK-564, merged) | The scratch runner made a tool: a fresh copy of the data, a server on a free port, the passes above, the `/api/health` probe, timings, and a byte-for-byte check against a reference (`npm run perf`). | new `tools/perf/`, `tests/unit/tools/perf-compare.test.ts`, `package.json`, `tsconfig.server.json`, `CLAUDE.md` | |
| Settle index (RUK-565, merged) | `estimateCosts` settles each good through the slots it fills instead of scanning every input of every consumer; byte-identical, measured. | `src/server/planner/candidates.ts` | |
| Solver pool queue (RUK-575, merged) | The solver pool hands each job to a thread only when that thread is idle, from one queue (below). | `src/server/planner/lp.ts`, `tests/unit/planner/lp-pool.test.ts` | |
| Planning thread (RUK-579, merged) | Plans, line goods, breakdowns, build prices and step wording on a worker thread of their own, each answer equal to the call on the main thread (tested on the Mini-GT export). Nothing uses it yet. | new `src/server/planner/thread.ts`, `thread-worker.ts`, `tests/unit/planner/thread.test.ts` | |
| Wiring (RUK-580, merged) | The plan route and the layout service plan on the thread `main.ts` starts, and the main thread's pack loads before the ready line. Gate: 42 of 42 files and the longest `/api/health` wait under 0.5 s in every pass. | `src/server/http/routes/projects.ts`, `src/server/layout/service.ts`, `src/server/main.ts` | RUK-579 |
| Disk store (RUK-576, merged) | A cache of JSON values on disk: one gzip file per key under a code version (`codeVersion`), at most N files, the least recently used dropped. Nothing uses it yet. | new `src/server/planner/disk-cache.ts`, `tests/unit/planner/disk-cache.test.ts` | |
| Disk cache (RUK-602, merged) | What a restart redoes, kept on disk with the store: the plans, the lines' goods, and each finished layout's expansion, cost and worded steps, in three `diskCache` folders under `<dataDir>/cache/`; and the worded steps kept in the layout entry (below). Gate: 42 of 42 files, the restart pass under 4 s with each plan under 1 s, the warm rounds under 0.2 s. | new `src/server/planner/plan-store.ts`, `tests/unit/planner/plan-store.test.ts`; `src/server/main.ts`, `src/server/http/routes/projects.ts`, `src/server/layout/service.ts`, `tests/unit/layout/service.test.ts`, `CLAUDE.md` | RUK-580, RUK-576 |
| QA (RUK-622, merged) | Verify the merged branch: suites, browser tests, `tools/perf` with `--restart` against the reference, and the server's memory with the planning thread against `374680441` (the branch before RUK-580, one pack). | `CLAUDE.md`'s test counts | all |

`tools/perf` is merged: the tasks that follow measure with `npm run perf` (`tools/perf/README.md`). RUK-565 predates it
and was measured with the CTO's scratch runner (`/tmp/ruk563/bin/run.mjs`, compared by `/tmp/ruk563/bin/compare.sh`).

### The settle index, measured (RUK-565)

While it walks, `estimateCosts` now records each consumed slot of a reached recipe under every good the slot can take
(`slotsOf`), and settles a good through those slots alone instead of scanning every input of every consumer. It finds
the same estimates in the same order: 42 of 42 files byte-identical in all sixteen runs of the review, and on the merged
branch (`npm run perf -- --restart` on `9be5b962d`: cold 40.3 s, restart 41.9 s, longest `/api/health` wait 3.0 s and
3.2 s, load average 15.7 to 17.6).

Its CPU effect is smaller than the prototype's single pair showed (own time 5.00 s to 3.83 s cold), and smaller than one
pair of runs on this Mac can show. Eight back-to-back pairs; each cell is `estimateCosts`' own time as a share of the
main thread's sampled time, weighted by the time between samples as `prof.mjs` counts it (own / all sampled):

| Pair | Cold, base | Cold, change | Restart, base | Restart, change |
| --- | ---: | ---: | ---: | ---: |
| Engineer 1, base first | 11.99 % (5.27 / 44.0 s) | 11.51 % (4.62 / 40.1 s) | 11.87 % (5.10 / 43.0 s) | 10.38 % (4.25 / 40.9 s) |
| Tech Lead 1, change first | 11.00 % (4.84 / 44.0 s) | 11.67 % (5.17 / 44.3 s) | 12.31 % (5.49 / 44.6 s) | 11.05 % (4.28 / 38.7 s) |
| Tech Lead 2, change first | 10.93 % (4.10 / 37.6 s) | 13.42 % (6.85 / 51.0 s) | 12.12 % (4.91 / 40.5 s) | 10.41 % (4.89 / 46.9 s) |
| Engineer q1, change first | 14.03 % (6.79 / 48.4 s) | 10.62 % (4.10 / 38.6 s) | 11.45 % (4.63 / 40.4 s) | 10.68 % (4.01 / 37.6 s) |
| Engineer q2, change first | 10.76 % (4.34 / 40.3 s) | 10.98 % (4.21 / 38.4 s) | 11.89 % (4.77 / 40.1 s) | 10.97 % (4.02 / 36.7 s) |
| Engineer q3, change first | 11.28 % (4.50 / 39.9 s) | 11.07 % (4.21 / 38.0 s) | 12.25 % (5.01 / 40.9 s) | 10.62 % (4.02 / 37.8 s) |
| Engineer q4, change first | 11.71 % (4.65 / 39.7 s) | 10.76 % (4.88 / 45.3 s) | 12.36 % (6.22 / 50.3 s) | 10.88 % (5.43 / 49.9 s) |
| Engineer q5, change first | 12.91 % (5.57 / 43.1 s) | 10.08 % (3.96 / 39.3 s) | 10.80 % (5.26 / 48.7 s) | 10.22 % (3.90 / 38.2 s) |
| Pooled | 11.89 % | 11.34 % (−4.6 %) | 11.87 % | 10.65 % (−10.3 %) |

- The change is lower in all 8 restart pairs but in only 5 of 8 cold ones. Over both passes its share falls 7.4 %: about
  0.3 s (cold) and 0.8 s (restart) of `estimateCosts`' own time per pass of the seven plans, 1 to 2 % of a cold pass.
- The same base code's share moved between 10.8 % and 14.0 % across these runs, so one pair cannot resolve an effect of
  this size. In this milestone a timing is reported, and gated only when its expected effect is several times the
  spread of the same code run twice.
- Under this load V8's sampler ticks every 2 to 4 ms instead of 1 ms, and some runs get bursts (q1's base, cold: 50,405
  samples, 83 % of them in `estimateCosts`). Compare time-weighted figures only, never sample counts.

What is left (q3, the change, cold pass, 38.0 s sampled): `buildCandidates` 12.3 s in all, 11.2 s of it in
`estimateCosts`, whose own body (the walk and the settle loop) takes 4.2 s; the rest is spread over `usable` (accepting
each recipe the walk meets, 1.8 s), `settleSteps` (1.8 s), `run` (1.3 s) and `carried` (0.9 s), each including what it
calls. No single loop like the old settle scan remains. The larger lever is how often `buildCandidates` runs per plan
(five callers, listed under "Where it starts"); whether some of those calls repeat the same work is a question for after
the worker and disk-cache tasks, not a task yet.

### Design notes for the two tasks that follow

**Planning in a worker thread (F4).** One planning thread, so the solver pool stays one pool, inside it. It loads its
own pack (`loadPack(activeExportDir(config))`, once per export id) and runs `planLine(pack, settings, ctx, { offers,
needs })`; the settings, the `PlanContext` (its `storage` is a `Map`, which structured cloning keeps), the offers and the
needs go in, the plan (0.8 to 4.3 MB) comes back. The main thread also prices the line today, and must stop: the line's
goods (`lineGoods`, routes/projects.ts) and the layout service's `linePack`, `expand` and `layoutCost`
(layout/service.ts) call `linePricing`, which hits the memo the plan filled on the same thread; after the move they
would price the line again on the main thread, so the planning thread answers them too. The solver pool then hands each
job, from one shared queue, to a thread only when that thread is idle: milestone 1's pool hands a job to a thread as
soon as it is asked for, so when two plans run at once (two compares, or a compare beside a background replan), some of
one plan's price LPs can wait behind the other plan's build MIP (usually 1.6 to 2 s, at most its 30 s limit) while
another thread is free. A single plan is not affected: its prices are solved before its build stage (RUK-540 review).
Merged (RUK-575): one plan at a time it changes nothing measurable. Three runs gave the same 42 files; the seven cold
plans took 39.2 to 39.8 s against 40.3 s before, and after a restart 37.9 s and 38.0 s against 41.9 s (a third run, at
load average 21, had one plan at twice its time there, 55.2 s in all).
Check, as measured below: `tools/perf` byte-identical, and the longest `/api/health` wait in every pass under 0.5 s.

**The plan cache on disk.** `PlanCache` keeps 32 plans in memory; a store under `<dataDir>/cache/plans/` (one gzip file
per key, the key hashed) is read on a memory miss and written after a computation, at most 64 files, the oldest
dropped. The key gains the code's version (a hash of `src/server/**/*.ts`, `src/shared/**/*.ts` and
`package-lock.json`, taken at start), so a pulled change never serves an old plan. Seven test files count
`PlanCache.computations` (38 uses); each one's data folder must be checked before the spec says a disk hit does not
count. Its check is set when it is specified: a plan cache alone cannot make a restart fast (below).

### The worker and the disk cache, measured before they were specified (RUK-564's approval)

**What is left on the main thread.** The main thread's CPU profile of a base run (`c51560e05`, the RUK-565 Tech Lead's
runs), its samples grouped by the source folder that drives them (a profile loses a function's async callers after an
`await`, so names alone undercount `planLine` and `layoutLine`):

| | Cold: total | Cold: longest unbroken | Restart: total | Restart: longest unbroken |
| --- | ---: | ---: | ---: | ---: |
| `planner/` and HiGHS (moves to the thread) | 35.2 s | 5.8 s | 36.3 s | 6.9 s |
| Loading the pack (`pack/`) | 2.9 s | 1.3 s | 2.7 s | 1.3 s |
| `layout/` (`layoutLine` and its stages) | 0.34 s | 0.10 s | 0.32 s | 0.12 s |
| `layout/service.ts` (merging, step wording) | 0.50 s | 0.09 s | 0.36 s | 0.08 s |
| `world/` (the scan reads) | 0.51 s | 0.17 s | 0.29 s | 0.08 s |

With every `planner/` and HiGHS sample off the main thread, its longest busy stretch would be 0.19 to 0.24 s (laying a
line out, then reading its area of the scan), apart from the pack's own load at first use, 1.0 to 2.4 s. That load
now happens before the server prints that it is ready (RUK-580). So the worker's check is 0.5 s, a little over twice
what stays, and the measured value is reported beside it.

**The whole change, prototyped** (the pool's queue, the thread and the wiring, exactly as RUK-575, RUK-579 and RUK-580
specify them; `npm run perf -- --restart` on `cd5e71640`, load average 5.9 to 7.8): 42 of 42 files byte-identical, every
request 200.

| | Base (`9be5b962d`, load 15.7 to 17.6) | Planning thread |
| --- | ---: | ---: |
| Cold total | 40.3 s | 42.0 s |
| Restart total | 41.9 s | 39.3 s |
| Warm rounds | about 0.17 s each | 0.27 s each |
| Longest `/api/health` wait: cold / warm / restart | 3.0 s / – / 3.2 s | 0.166 s / 0.020 s / 0.095 s |

The warm rounds grew because each warm answer now sends `partSteps` to the thread (about 10 ms a plan); the disk cache
keeps its result with the layout's other parts. The pack is loaded twice, once per thread; RUK-622 measured the memory
that costs ("The milestone's check", below).

**What a restart redoes.** On a fresh server the plan route prices the line for its goods (`lineGoods` → `linePricing`)
before it reads the plan cache, and `finishPlan` breaks the build down (`expandBomLines`), prices the layout's parts
(`bomBuildCost`) and words its steps (`partSteps`, on the line's farm pack), none of which is kept past a restart. A disk
cache of plans alone would still leave about 1.5 to 2 s a project. So the disk cache keeps, under one code version
(`codeVersion`, RUK-576): the plans (by their cache key), the lines' goods (by the plan key), and each finished layout's
expansion, cost and worded steps (by `layoutKey`). It is specified once the wiring has landed, from a profile of the
restart pass (RUK-602, below).

### The disk cache, measured and prototyped (RUK-580's approval)

**Merged (RUK-580).** `npm run perf -- --restart` on `1d40fd332`, at load average 3.9 to 4.3:
- 42 of 42 files byte-identical.
- Cold took 36.4 s, the restart pass 36.0 s, and each warm round 0.25 s.
- The longest `/api/health` wait was 0.062 s cold, 0.011 s and 0.014 s warm, and 0.124 s after the restart.

**Where a restart's time goes.** The restart pass on the same commit, with each planning-thread job timed from the main
thread, in ms:

| | MV circuit | Circuit | test | poly | HV Circuit | Duty plate | diamond |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| The line's goods (`goods`) | 4250 | 624 | 2403 | 1302 | 1349 | 663 | 420 |
| The plan (`plan`) | 3746 | 1688 | 3944 | 1830 | 4985 | 6891 | 889 |
| Finishing it (the layout, `expand`, `layoutCost`, `partSteps`) | 602 | 325 | 422 | 349 | 415 | 556 | 339 |
| of which the layout itself, on the main thread | 315 | 73 | 190 | 46 | 123 | 174 | 43 |

The main thread was idle for 36.7 s of the pass's 40.9 s sampled. A plan-only cache would still leave 1.0 to 4.9 s a
project (the goods and the finish), as the note above expected.

**RUK-602, prototyped** on `1d40fd332`. It keeps the plans, the goods, and each finished layout's expansion, cost and
worded steps in three `diskCache` folders under `<dataDir>/cache/`. The main thread reads and writes them: `JSON.parse`
of the largest plan (4.3 MB) takes 15 ms, and a restart that finds everything on disk never starts the planning thread.
The worded steps also stay in the layout entry, so warm answers send nothing to the thread. Measured back to back with
the base, at load average 19 to 28:

| | Base (`1d40fd332`) | Disk cache |
| --- | ---: | ---: |
| Restart total | 64.4 s | 2.0 s |
| Slowest plan after the restart | 19.6 s | 0.54 s |
| Warm rounds | 0.28 s each | 0.13 s and 0.12 s |
| Longest `/api/health` wait: cold / restart | 0.453 s / 0.135 s | 0.166 s / 0.141 s |

Both runs gave 42 of 42 files. After a restart, the server still lays each line out again (0.04 to 0.32 s, on the main
thread).

RUK-602's check, with the change:
- the restart total is under 4 s, and each restart plan under 1 s;
- each warm round is under 0.2 s, or under 60 % of the base's;
- every health wait is under 0.5 s, or within 0.1 s of the base's own on a loaded Mac (the base's reached 0.453 s at
  load average 28).

**Merged (RUK-602, `f7c225c1a`).** `npm run perf -- --restart` at load average 12 to 15: 42 of 42 files. Cold took
45.2 s, the warm rounds 0.109 s and 0.111 s, and the restart pass 1.287 s (each plan 0.05 to 0.32 s). The longest
`/api/health` wait was 0.159 s cold and 0.081 s after the restart. The Tech Lead's back-to-back pair: restart 47.2 s →
1.42 s, warm 0.27 s → 0.11 s.

One gap is left, reachable only through the API (the Map tab offers only finished scans). A project pointed at a
running scan is planned in an empty world and kept in memory under the key its finished scan's plan will have, as
before. If a new layout entry is made for that plan after the scan finished, the disk cache keeps the finished layout
worked out from it, and after a restart the real plan is shown with that plan's build list, steps and layout cost. The
fix, if the group needs it: plans and layouts made while the scan is not done get the "no scan" key, or are dropped
when the scan finishes.

### The milestone's check

`npm run perf -- --restart` on the merged branch against the reference: 42 of 42 files byte-identical, the cold total,
the restart pass, and the longest `/api/health` wait in every pass (under 0.5 s), beside the tables above.

**Passed (RUK-622, on `f7c225c1a`, merged as `a87e4a5ce`).** QA Engineer 1 and the Tech Lead each ran the merged branch
and, right after it, `374680441` (the branch before RUK-580: it plans on the main thread, with one pack), with each
server's memory sampled by `ps` every 0.5 s. All four runs gave 42 of 42 files.

| | QA: base | QA: merged | Tech Lead: base | Tech Lead: merged |
| --- | ---: | ---: | ---: | ---: |
| Load average, start → end | 13.7 → 35.1 | 14.0 → 14.6 | 34.6 → 19.5 | 44.2 → 35.2 |
| Cold total | 83.9 s | 38.8 s | 39.6 s | 53.9 s |
| Warm rounds | 0.216 s, 0.193 s | 0.097 s, 0.097 s | 0.175 s, 0.172 s | 0.103 s, 0.111 s |
| Restart total | 59.5 s | 1.16 s | 39.9 s | 1.20 s |
| Longest `/api/health` wait: cold / warm / restart | 4.02 / 0.027 / 6.01 s | 0.079 / 0.018 / 0.068 s | 3.18 / 0.021 / 3.17 s | 0.328 / 0.019 / 0.078 s |
| Peak memory (RSS), the server of the cold and warm passes | 2,552 MB | 3,480 MB | 2,690 MB | 3,750 MB |
| Peak memory (RSS), the server of the restart pass | 2,777 MB | 1,045 MB | 2,686 MB | 1,062 MB |

- On the merged branch, every pass's longest health wait is under 0.5 s (0.328 s at worst, at load average 44), and
  the restart pass is under 4 s.
- The cold total moves with the load, not with the change: cold plans are bound by HiGHS, and the settle index
  (RUK-565) saves about 0.3 s of them.
- The memory is the milestone's cost. The planning thread loads its own pack at its first job and keeps it until the
  server stops (`thread-worker.ts` keeps the pack of the export it planned on last, and nothing in the server closes
  the thread). So once it has planned, the server holds about 1,000 MB more than before (928 and 1,060 MB in the two
  runs): 3,480 to 3,750 MB at its peak, against 2,552 to 2,777 MB. A restarted server that finds everything on disk
  gives the thread no job and stays at about 1,050 MB (about 2,700 MB before), until a plan is not on disk. If the
  computer that runs the server is short of memory, the thread can be closed after some idle minutes: a closed thread
  starts again at its next job (RUK-579's test), and that job first waits for the pack's load, 1 to 3 s, on the
  planning thread. Not built: the group decides (PR #12's risks).
- `npm test` on `a87e4a5ce`: 261 files and 4263 tests passed. `npm run e2e` (QA and the Tech Lead): 366 passed.

## Milestone 3: measured, and not built

The review's three smaller costs in the 3D (F7) were measured on the group's seven lines on 2026-11-04, before any task
was made. None of them is a wait the group can notice, so milestone 3 is not built and the program ends with milestone 2.
It comes back if the group's lines grow several times bigger.

| Cost | Measured | Why nothing is built |
| --- | --- | --- |
| Hovering raycasts every block of the scene | The biggest scenes are Duty plate (401 blocks and 190 hookup cells) and HV Circuit (429 and 108). The review measured a pick at under 6 ms for 1,000 blocks. | About 3 ms a pointer move. Picking by the block grid starts to matter at about 5,000 blocks (about 30 ms). |
| Show connections builds its geometry on the main thread | In the review's browser profiles of four lines, with and without Show connections, the planner's own code for it (`connectionsGraph`, `linkGeometry`) took 9 to 15 ms. On three of them, turning it on added 190 to 230 ms of the browser's own native work (the profiles' "(program)"; the fourth already had 235 ms of it without), in a headless browser that draws without a graphics card. | A worker could take only the 9 to 15 ms. The native work stays on the canvas's thread. |
| The path search when a line is moved | Three drops each on Duty plate and HV Circuit (a scratch server on a copy of the group's data, `feat/perf-m2` at `fac4cfccb`). The new layout answered in 0.08 to 0.10 s. The plan the tabs fetch next took 0.18 to 0.25 s, because it is finished again with the new hookups (power, build list, costs). | The path search is part of the 0.1 s. A drop answers in about 0.3 s in all. |
