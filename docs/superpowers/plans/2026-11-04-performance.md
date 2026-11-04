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
| The hot loops of `buildCandidates` and `estimateCosts` | The profile above. | Subtask: settle each good through an index of the slots it fills (exact: the same estimates in the same order), then measure what is left. |

### Subtasks

| Subtask | What | Files | Blocked by |
| --- | --- | --- | --- |
| `tools/perf` | The scratch runner made a tool: a fresh copy of the data, a server on a free port, the passes above, the `/api/health` probe, timings, and a byte-for-byte check against a reference (`npm run perf`). | new `tools/perf/`, `tests/unit/tools/perf-compare.test.ts`, `package.json`, `tsconfig.server.json`, `CLAUDE.md` | |
| Settle index | `estimateCosts` settles each good through the slots it fills instead of scanning every input of every consumer; byte-identical, measured. | `src/server/planner/candidates.ts` | |
| Worker | Planning in a worker thread, and the solver pool's shared queue (below). | to be specified after the two above report | `tools/perf` |
| Disk cache | The plan cache kept on disk (below). | to be specified after the two above report | `tools/perf` |
| QA | Verify the merged branch: suites, browser tests, `tools/perf` with `--restart` against the reference. | tests only | all |

Until `tools/perf` is merged, a task measures with the CTO's scratch runner (`/tmp/ruk563/bin/run.mjs`, compared by
`/tmp/ruk563/bin/compare.sh`), which `tools/perf` replaces.

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
Check: `tools/perf` byte-identical, and the longest `/api/health` wait during a cold plan under 0.2 s.

**The plan cache on disk.** `PlanCache` keeps 32 plans in memory; a store under `<dataDir>/cache/plans/` (one gzip file
per key, the key hashed) is read on a memory miss and written after a computation, at most 64 files, the oldest
dropped. The key gains the code's version (a hash of `src/server/**/*.ts`, `src/shared/**/*.ts` and
`package-lock.json`, taken at start), so a pulled change never serves an old plan. Seven test files count
`PlanCache.computations` (38 uses); each one's data folder must be checked before the spec says a disk hit does not
count. Check: `tools/perf --restart`, the `restart/` pass byte-identical and every plan in it under 0.2 s.

### The milestone's check

`tools/perf --restart` on the merged branch against the reference: 42 of 42 files byte-identical, the cold total, the
restart pass, and the longest `/api/health` wait, beside the table above.

## Milestone 3: smoother 3D on big lines

Picking by the block grid instead of raycasting every instance, the connections' link geometry off the main thread,
and a faster path search for Move line (F7).
