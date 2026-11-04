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

## Milestone 2: faster cold plans and a server that keeps answering

1. `tools/perf/`: plans and lays out the seven projects on a copy of the data, cold, and checks every plan and layout
   byte for byte against a reference run.
2. Planning in a worker thread, so the server keeps answering pages, textures and tiles while a plan is made (F4).
   The solver pool then hands each job, from one shared queue, to a thread only when that thread is idle. Milestone 1's
   pool hands a job to a thread as soon as it is asked for, so when two plans run at once (two compares, or a compare
   beside a background replan), some of one plan's price LPs can wait behind the other plan's build MIP (usually 1.6
   to 2 s, at most its 30 s limit) while another thread is free. A single plan is not affected: its prices are solved
   before its build stage (RUK-540 review).
3. Spikes, each kept only with byte-identical plans: `highs` 1.15.4, a native HiGHS binding, and the hot loops of
   `buildCandidates` and `estimateCosts` (F3).
4. The plan cache kept on disk, so a restart does not make every plan cold again.

## Milestone 3: smoother 3D on big lines

Picking by the block grid instead of raycasting every instance, the connections' link geometry off the main thread,
and a faster path search for Move line (F7).
