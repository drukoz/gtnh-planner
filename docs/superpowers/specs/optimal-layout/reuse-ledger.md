# Optimal layout (RUK-2571): reuse ledger

Status: phase 1, 2026-11-16; rows 5, 8 and 13 revised after SP-A and SP-B, 2026-11-16. Built from R4's survey (RUK-2585: 31 repositories and packages, licences and last commits
read on 2026-11-16), R1–R3 (RUK-2581 to RUK-2584) and the S1 benchmark (RUK-2580, merged at `1efbca040`).

**Bottom line.** Nothing on the shelf searches machine placement and cable routing together on a 3D voxel grid with
the planner's rules (tiers that never touch, GT6 cables that connect only drawn sides, hand-run units, muffler air).
The search driver and the score are ours to write; the parts they stand on are already ours and proven in
production (`findPath`, `growTree`, `feed-rules.ts`, `highs`, the S1 benchmark). **No new dependency is added**, so
the toolchain stays as the guide pins it (Node 24, TypeScript 6.0.3, Vitest 5.0.3, highs 1.15.3). Two of the plan's
numeric claims are proven by spikes before the milestone that depends on them (SP-A, SP-B below).

## Capabilities

| # | capability | candidates looked at (R4 row) | pin / licence / last commit | decision | why |
|---|---|---|---|---|---|
| 1 | Measure a line: total length, loss, weak tiers, route failures, for a fixed set of lines in four modes | S1 `tests/helpers/layout-bench.ts` (ours) | `1efbca040`, merged | **use** | 33 lines × 4 modes, ~0.65 s; the never-worse ratchet every milestone must pass. M1 adds an `unpowered` column. |
| 2 | Score one candidate (buildable, every machine powered, length, loss, volume) | none: the rules are ours | — | **build** (`src/server/layout/score.ts`, M1) | the order is the user's (design goal 1 + plan Assumption 3); no library knows GT's power rules. |
| 3 | Search driver over placements | `@joaker/simulated-annealing` (15); QAP GA / tabu (13, 14); `binpackingjs` (12); analytic placement DREAMPlace / easyPlace / Coloquinte (7, 8, 10) | 15: MIT, 2026-03-18; 13/14: no licence; 12: MIT, 2026-05-14; 7: BSD-3, 2026-11-10 | **build** | 15 calls `Math.random()` with no injected seed, so it cannot give the same layout twice (determinism is a hard rule). 13/14 have no licence: ideas only (delta evaluation, a tabu list of recent swaps). 12 packs boxes but knows no ports, rows or spines. 7–10 need a smooth wirelength surrogate a voxel grid lacks. Ours: a deterministic enumeration of candidates (head position, shape, row split, order), each laid and routed for real (design: "rank by actually laying out the cables"), then a first-improvement swap pass in a fixed move order. No randomness at all. |
| 4 | One cable's path through the voxel grid | `findPath` (`path.ts:113`, ours); PathFinding.js (11) | ours in production; 11: MIT, 2024-06-20 | **use ours** | `findPath` already has the turn cost, vertical cost, lane planes, node budget and fixed tie-breaks the layout needs (R2 Table A); PathFinding.js has none of the lanes or tie-break guarantees and would duplicate it. |
| 5 | One tier's cable tree (Steiner tree in the grid) | `growTree` (`path.ts:209`, ours, nearest-first greedy); exact DP wata-orz (16), Dreyfus–Wagner (17); key-path local search ms-steiner-puw (19); Hanan grid rsmt-ts (21), hanan_router (22); `grid-router` (26) | 16: MIT, 2018; 17: MIT, 2017; 19: NOASSERTION; 21: npm MIT, repo none; 22: BSL-1.0; 26: MIT, 2026-07-25 | **use ours unchanged** (decided 2026-11-16 from SP-B) | No TS library handles 3D, obstacles and tiers that must not touch. **SP-B (RUK-2616) measured the improvement and it is not worth it:** four terminal orders save 25 cable blocks on 9 of 132 rows (0.6 % of cable), make `runBench` 1.43× slower, and every one of those 9 rows loses 2–44 EU/t more; rip-up and reroute adds nothing on top (1.83×). A tree with less cable can carry power further to each machine. Dropped from M2; M4's order search may revisit tree choice, and only by loss first, cable second. |
| 6 | Several tiers' trees that must not touch | `growTrees` keep-away sets (ours); negotiated congestion OpenROAD FastRoute (23), AutoRoute (25), freerouting (24) | 23: BSD-3; 25: MIT, 2026-09-27; 24: GPL-3.0 | **use ours**; learn 25 if needed | Today's per-tier avoid sets already enforce the rule (R2). A congestion-priced rip-up loop (25's, MIT) is the fallback if M2/M3 trees start failing to route; 24 is GPL: ideas only. |
| 7 | Check a candidate's feeding is legal | `feed-rules.ts` (ours, R1–R12) | in production | **use** | Every candidate the search keeps must stay clean of new feed warnings (design Constraints). |
| 8 | AE2 interfaces at spacing 1 | `InterfaceSpec.targets` (`src/shared/types/feed.ts:36`, ours, never filled); the feeding reader already honours it (`feeding/read-networks.ts:331`) | in production, unused | **use** (M2, proven by SP-A) | SP-A (RUK-2615): on all 33 AE2 lines, total blocks 2,760 → 2,097 (−24 %), cable −25 %, loss 38,182 → 15,021 EU/t (−61 %), weak rows 3 → 2, no row longer, lossier or weaker, no feed warning. A full-block ME Interface pushes into every neighbour unless a Wrench points it at one (`docs/research/machine-feeding.md:207`, from AE2's source); the build text must say so. 16 tests move. |
| 9 | Exact optimisation (MIP / CP) for placement | `highs` (28, ours); `cpsat-js` (29); `z3-solver` (30); `javascript-lp-solver` (31) | 28: MIT, 1.15.3 pinned; 29: Apache-2.0 (repo MIT), 2026-10-25; 30: MIT; 31: Unlicense | **not used in this program** | The plan never depends on a solver: candidates are scored by real routing, which no MIP sees. `highs` stays the planner's. `cpsat-js` is the one to spike **only if** M4's search misses the 1 s budget or leaves measurable length on the table; z3 and the JS simplex are weaker than what we have. |
| 10 | Rain exposure of a site | the world scan's columns read by `site.ts` (ours) | in production | **use** (M3) | Goal 7's roof is decided from the columns the site search already reads. |
| 11 | Show the search in the UI | `View3DShell` side panel (`src/client/views/View3D.tsx:227`, ours) | in production | **use** (M1) | The client reads only `Layout` (R1: zero client or projector changes for new shapes); a new optional `Layout.search` field carries the candidates. |
| 12 | Randomness | — | — | **none** | Every choice is a fixed enumeration with fixed tie-breaks, so no PRNG is needed. |
| 13 | Feed far machines of a low tier (RUK-351) | the head's one bank per stage (`internal.ts` `planHead`, `bankRows`, ours); a middle head (RUK-121, ours); a lower-loss cable (`lowerLossCable`, ours) | in production | **build** (M2, after SP-C) | Measured 2026-11-16 on the M1 branch: only 7 rows are starved by wiring (the long LV macerator lines: 90 machines), and the other 52 rows with `unpowered > 0` are HV machines on an MV supply that `power_tier_low` already reports and no wiring can fix. No head position cures the 7 (the best middle head still leaves 7 of 40 starved in direct, 31 in AE2), and 32 V cannot cross ~17 blocks of tin cable. A GT transformer sends packets at its full output voltage whatever it receives, so a step-down transformer placed out along the line, fed by the higher tier, resets the low tier's volts there. **Spike SP-C** measures it before it is specced. |

## Spikes

| spike | proves | branch | runs in parallel with |
|---|---|---|---|
| **SP-A** (RUK-2615) AE2 spacing 1 with Wrench targets | the per-row length, loss and weak-tier change on all 33 benchmark lines in AE2 mode, the feed-rule warnings (R12) it adds or removes, and the tests it breaks | `feat/optimal-layout-RUK-2615`, patch and report under `spikes/ae2-spacing-1/` | M1 |
| **SP-B** (RUK-2616) a shorter cable tree than `growTree` | cable cells, loss and time per benchmark row for a rip-up-and-reroute pass over each tier's tree, and whether any row gets longer | `feat/optimal-layout-RUK-2616`, patch and report under `spikes/steiner-reroute/` | M1 |

| **SP-C** (RUK-2669) satellite step-down banks out along the line | unpowered machines, total blocks, loss, transformers and parallel runs on the 7 starved rows and the other 125, and the time | `feat/optimal-layout-m2-RUK-2669`, patch and report under `spikes/satellite-banks/` | M2's AE2 work |

A spike that fails is an answer too: the plan then drops that item from M2 and says so. **Results:** SP-A holds (row 8, M2). SP-B does not pay (row 5, dropped).

## Not used, and why (from R4)

- Factorio-SAT (1, GPL-3.0), FLG (2, no licence): the encodings and port-facing ideas are read only, never copied.
- SC-ProductionPlanner, Factorio-Blueprint-Generator, factorio-layout-designer, gtnh-flow (3–6): they plan recipes or
  compose fixed blueprints; none places machines against wiring.
- SCIPJack (18): academic licence; its reduction rules are worth knowing, but no code or runtime use.
- pcst_fast (20): prize-collecting trees matter only if a machine may be left unwired, which the layout never allows.
- Lee/A* maze router (27): covered by our `findPath`.
