# Optimal layout (RUK-2571): plan

Kind: **Program** (placement and wiring searched together; touches placement, internal routing, all four logistics
modes, the build steps and their tests; well over 15 subtasks).

Status: **M1 done (merged `7d0eac9a0`), M2 running**, 2026-11-16. Phase 2 plan written from the system map, the reuse ledger, R1–R4 (RUK-2581 to RUK-2585) and
the S1 benchmark (RUK-2580). Nothing here waits for approval: correct any assumption in a comment on PR #18.

## Assumptions (my reading of the request)

1. "The wiring algorithm" means everything that connects the line: the power cables and transformer banks first, and the
   pipes, conduits and logistics cells too, since they compete for the same cells. "Always including machine placement"
   means the placement is part of the search, never fixed first and routed around afterwards.
2. This program carries out the core of the shorter-layouts design you agreed on 2026-10-22/23
   (`docs/superpowers/specs/2026-10-23-shorter-layouts-design.md`): goal 1 (shape search scored by laying the cables),
   goal 2 (one shared cable run per tier, a cable block feeding the machines on its sides and on top), goal 3 (reach),
   goal 7 (rain cover, needed once machines are stacked) and goal 9 (calibration). Goals 4 (machine reuse across steps),
   5 (cleanrooms) and 6 (wall sharing) are separate features and stay for a later program.
3. **"Most optimal" is measured, in this order** (`LineScore`, M1):
   1. buildable: no connection left to make by hand (`route_failed`), no transformer without room in its bank;
   2. **every machine actually powered**: the volts that reach a machine, times the amps it may draw
      (`floor(2·EU/t ÷ V[machine tier]) + 1` for a singleblock, gt-mechanics §3.1; 2 per energy hatch for a multiblock), cover its
      EU/t. RUK-351's far LV machines fail this today while the layout says `ok`;
   3. least **total length**: cable + pipe + conduit + interface and chip-pipe cells + hookup runs, every block 1;
   4. least cable loss (EU/t);
   5. smallest bounding volume, then a fixed candidate order, so the same plan always gives the same layout.
   A true optimum is out of reach for lines of 40+ machines (placement with routing is NP-hard), so "optimal" means:
   the best of a deterministic search in which every candidate is laid and routed for real, within about a second for
   the user's real line.
4. **Never worse than today, structurally.** Today's rule's line is always a candidate. Another candidate replaces it
   only when it is better by the score **and** either powers more machines or is no longer and no lossier. So a line
   gets longer or lossier only to power a machine that today gets nothing usable. The S1 ratchet and the loss
   budgets in `power-loss.test.ts` keep that true: a row may get longer or lossier only where its `unpowered` count
   drops, and the commit names the row. (When shapes arrive in M3 and the shortest shape loses more, this rule is what
   I will ask you about in the PR, with the numbers.)
5. RUK-351 is folded into this program: M1 reports unpowered machines honestly, M2 powers them.
6. AE2 lines get port spacing 1 with Wrench targets on every interface (RUK-119; proven first by spike SP-A).

## Target architecture

```
layoutLine (layout.ts)
 └─ buildLocal ── candidates ──► buildLocalAt(candidate)   placement → mode → routeInternal
        │                                   │
        │                                   └─ InternalResult.machines  (M1: volts, amps, powered per machine)
        └─ score.ts  scoreLine / compareScore / replacesBaseline  (M1)
              └─ Layout.search: every candidate's score and which was kept (M1) → 3D tab panel (M1)
```

- **`score.ts`** (new, M1): `LineScore`, `scoreLine(line)`, `compareScore(a, b)`, `replacesBaseline(c, base)`. Pure.
- **The candidate loop** (`buildLocal`, M1): today's head choice becomes "the baseline candidate"; every line laid is
  scored and recorded; M2–M4 only add candidates (feeding options, shapes, orders) to the same loop.
- **The placement contract** (M3): `Placement` gains what R1 found hard-coded in three seams: a spine path of cells and
  tail cells (the four modes), the head's run cells (`runX`/`planHead`/`bankRows`/`sizePower`), and each unit's service
  cell and power-landing port (`chooseSite`, `buildHookups`, `steps.ts`). `placeUnits` keeps producing today's shape
  through it, cell for cell, before any new shape is added.
- **What we write vs reuse:** see the reuse ledger. No new dependency. The client and the projector read only
  `Layout.blocks`/`buildSteps` (R1): new shapes need no client or projector change; the only client work is M1's panel
  and M3's shape label.

## What we do not build, and why

- No general-purpose placement solver (MIP, CP-SAT, annealing library): candidates are judged by real routing, which no
  solver sees, and determinism rules out the annealing libraries (ledger rows 3 and 9).
- No change to the client renderer or the projector (R1: they read blocks only).
- Machine reuse across steps, cleanrooms and wall sharing (design goals 4–6): separate features.
- Pinning a shape per project (design goal 10's last clause): after M3, if you still want it once you have seen the shapes.

## Milestones

Each milestone is a parent task under RUK-2571 with its own branch (`feat/optimal-layout-m<N>`, cut from the one
before), merged into `feat/optimal-layout` when verified. One pull request for the whole program: #18.

### M1 — an honest score and the search loop (today's geometry) — RUK-2613, **done**, branch `feat/optimal-layout-m1`

What you see: a line whose far machines get too few volts to run is no longer silently `ok`: it says which machines,
on which tier. The 3D tab says how many wiring and logistics blocks the line takes and how many layouts were tried,
with today's rule's line beside the chosen one.

| subtask | what | depends on |
|---|---|---|
| M1-1 RUK-2614 | contract: `InternalResult.machines` (per-machine volts, amps, powered); `score.ts`; shared types `LayoutSearch`, `LayoutCandidate`, `CandidateKind` | — |
| M1-2 RUK-2617 | `machine_unpowered` warning per tier; the S1 benchmark gains `unpowered`, and its ratchet the "only to power a machine" rule | M1-1 |
| M1-3 RUK-2618 | `buildLocal` as a scored candidate loop with the never-worse rule; `Layout.search` filled by `layoutLine` | M1-1 |
| M1-4 RUK-2619 | 3D tab panel "Layout search" from `Layout.search` | M1-1 (types only) |
| M1-V RUK-2621 | verification: QA on the milestone branch (benchmark, the user's view, determinism) | M1-2, M1-3, M1-4 |

M1 changes no chosen layout except where a candidate is better by the never-worse rule; with only today's head
candidates in the loop that is expected to be rare. Its value is the honest report and the frame M2–M4 fill.

### M2 — every machine powered, AE2 at spacing 1 — RUK-2668, branch `feat/optimal-layout-m2`

Measured on the M1 branch (2026-11-16) before planning it: of the 59 benchmark rows with `unpowered > 0`, only 7 are
starved by wiring (`loss-10 ae2`, `loss-20 routed/ae2`, `loss-40` in all four modes: 90 LV macerators). The other 52
are HV machines on an MV supply, which `power_tier_low` already names and no wiring can fix. No head position cures
the 7 (the best middle head still leaves 7 of 40 starved in direct, 31 in AE2).

| subtask | what | depends on |
|---|---|---|
| M2-1 RUK-2670 | every ME Interface gets a Wrench target at its own machine; R12 looks only at target faces; the build text says to wrench it | — |
| M2-2 RUK-2671 | `PORT_SPACING.ae2` 2 → 1, the 16 geometry tests SP-A listed, baseline lowered (SP-A: AE2 total −24 %, loss −61 %) | M2-1 |
| SP-C RUK-2669 | spike: satellite step-down banks out along the line, fed by the higher tier (a GT transformer re-sends at its full output voltage) | — |
| M2-3… | the satellite banks as a search candidate, specced from SP-C's numbers (or dropped, with the reason, if SP-C fails) | SP-C |
| M2-V | QA verification of the milestone branch | all above |

Dropped from M2: **shorter trees (SP-B)**. Four terminal orders save 25 cable blocks on 9 of 132 rows, every one of
them lossier, for 1.43× the time; rip-up and reroute adds nothing (reuse ledger row 5).

### M3 — new shapes (the placement contract, then rows, L, U and stacking)

1. **Contract, no behaviour change**: `Placement` gains the spine path, tail cells, head runs, service cells and power
   port (R1's 40 locations: 24 S, 16 M; the client and projector untouched). Direct and routed lay along the path (S each,
   R3a), AE2 (M, R3b), EnderIO (L: tail, chests, open ends, fluid roots). The benchmark must give **identical** rows.
2. **Shapes as candidates**: a single row, an L, a U, single-block machines stacked two high (direct, routed and EnderIO
   already lay a port at y 1, R3; AE2 needs the Wrench targets of M2), each laid and scored in the loop.
3. **Shared cable runs** (design goal 2): one cable block feeds up to three machines (left, right, on top); tiers still
   never touch.
4. **Reach and rain** (goals 3 and 7): every machine has a face onto an air cell open to the outside; exposed machines
   get a roof or covers when the site is open to the sky, counted in the score.
5. Build-step words relative to each unit's own facing, not "the middle row" (`steps.ts`, R1 addendum).

### M4 — search the orders, and calibrate

- A first-improvement swap pass over unit order within the chosen shape, under a time budget set per line size.
- Timing on the user's real line (`GTNH_LOCAL=1` tests on their planner): about a second.
- Design goal 9: the planner's per-machine logistics estimate updated to the new layouts' measured blocks per machine.

## Spikes

- **SP-A** (RUK-2615) AE2 spacing 1 with Wrench targets: holds; M2-1 and M2-2 (ledger row 8).
- **SP-B** (RUK-2616) shorter cable trees: does not pay; dropped (ledger row 5).
- **SP-C** (RUK-2669) satellite step-down banks for long low-tier lines (ledger row 13): running beside M2-1.

## Checklist (programs.md) before implementation subtasks

- [x] Two sentences: the planner lays a GTNH automation line out block by block next to a player's base, for a small
      group of players who then build it by hand; this program makes it choose the placement and wiring that power
      every machine with the least cable, pipe and logistics blocks.
- [x] External systems: none at layout time (system map §5).
- [x] Every capability is in the ledger as use or build, and every build says why.
- [x] Nothing we write by hand could come from a generator or a library (ledger: no candidate handles the 3D grid, the
      GT rules and determinism together).
- [x] Every "use" has a passing proof at a pinned version: each is our own code in production or already a dependency
      (`highs` 1.15.3); no new dependency is added. The plan's two unproven claims (SP-A, SP-B) gate M2 items only.
- [x] The first milestone ends in something a user can run: the 3D tab's search panel and the unpowered warning.

Rules from `lessons.md` copied into this program's approvals: prototype every geometric or numeric claim on the
standard fixtures before the spec (RUK-121); when code chooses between layouts, print every warning and hand-work
count of each candidate and compare the final output, not only the stage that chooses (RUK-509); value sets are
integer enums in the `as const` form (RUK-744); every new test that lays many lines gets an explicit timeout;
after merging a subtask into a branch another merge touched, run the full `npm test` in the merge worktree.

## Risks

- **Length against loss.** Assumption 4 forbids trading loss for length until you say otherwise. If M3's shortest
  shapes lose more, the PR will show both columns per line and ask.
- **Search time.** Every candidate is laid and routed (≈11 ms per fixture line, ~145 ms on the user's real line).
  M1 adds no candidate beyond today's; M2–M4 each report the benchmark's time and the real-line time.
- **The spine is pinned by tests**: ~16 of the 60 layout test files re-anchor in M3 (R1 Table B).
- No real pack export is on this Mac, so the real-line checks run only where the user's planner runs; the benchmark
  here uses the fixture pack.
