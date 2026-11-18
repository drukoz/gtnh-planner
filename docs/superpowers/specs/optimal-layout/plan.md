# Optimal layout (RUK-2571): plan

Kind: **Program** (placement and wiring searched together; touches placement, internal routing, all four logistics
modes, the build steps and their tests; well over 15 subtasks).

Status: **M1 done (merged `7d0eac9a0`), M2 done (merged `dab26f5f7`), M3 running: M3-1, M3-2, SP-F, M3-3, M3-4, M3-5, M3-P1, M3-P2, SP-G and SP-H merged; M3-P3 (RUK-3005) running, M3-P4 (RUK-3006) after it**, 2026-11-18. Phase 2 plan written from the system map, the reuse ledger, R1–R4 (RUK-2581 to RUK-2585) and
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
   1. buildable: no connection left to make by hand (`route_failed`), no transformer without room in its bank (ranked as
      "any at all"; how many ranks after step 2, since placing two more transformers is easier than feeding a starved
      machine: RUK-2976, M3-P4);
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
7. The packed shape (design goal 2) is SP-E's 3-wide, 2-high column: machines A and B beside the cable lane, T on top
   of it, logistics at y 1 above A and B. The design's 5-wide `logistics | machine | cable | machine | logistics` leaves
   the machine on top with no face onto the logistics. (Added 2026-11-18, M3.)

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

### M2 — every machine powered, AE2 at spacing 1 — RUK-2668, **done**, branch `feat/optimal-layout-m2`

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

### M3 — new shapes (stacking, the packed shape, then the placement contract) — RUK-2877, branch `feat/optimal-layout-m3`

M2's result: 0 machines starved by wiring (90 before), AE2 total −21 %, loss over 132 rows 75 143 → 45 936 EU/t.

**What the spikes measured** (RUK-121 rule: no spec before the numbers):
- **SP-D** RUK-2878, stacking single-block machines two high (`spikes/stacking/`). Forced on every line it saves 349
  blocks and 98 footprint columns but starves 20 machines on `loss-40` routed/AE2. **As a scored candidate** (CTO probe,
  addendum in the README) it improves 52 of 132 rows and makes none worse, **but only once the finished layout judges
  the finalists**: the in-line score cannot see the hookup, and 14 rows got worse without that check (`mixed-17 direct`:
  hookup 17 → 21). Per mode: direct 1 813 → 1 806 blocks, routed 2 293 → 2 245, AE2 2 187 → 2 138, EnderIO
  1 760 → 1 755; loss −1.9 % (direct, EnderIO) and −3.3 % (routed, AE2); no warning code added; `runBench` 0.65 → 1.1 s.
- **SP-E** RUK-2879, the packed shape: one cable lane, a machine on each side and one on top (`spikes/shared-cable/`).
  On the 20 lines of plain single-block machines, direct cable −63 % and loss −14 %, cable + logistics (counted, not
  laid) −44 %. Three limits: lines with two feed tiers cannot be wired (the far tier has no way past the near tier's
  lane); one lane of 24 columns starves its far end (`loss-60`: 15 machines), which the score already rejects; and two
  machines share one item port, which only direct and EnderIO allow (`PORT_SPACING` 0). Routed and AE2 need a cell per
  port, so a different column.

The packed shape follows Assumption 7.

| subtask | what | depends on |
|---|---|---|
| M3-1 RUK-2899 | the finished layout judges the finalists: when the search keeps another line, `layoutLine` finishes the baseline too and keeps the chosen line only if it is no worse with its hookups (`finalReplaces`). Changes no row today | — |
| M3-2 RUK-2901 | stacking as a candidate: a stacked twin of every head candidate (`CandidateKind.Stacked = 2`); baseline lowered on 52 rows | M3-1 |
| SP-F RUK-2900 | spike: the packed shape with its pipes, conduits, tail chests and hookups laid for real in direct and EnderIO, one-feed-tier lines; writes down the `Placement` fields the modes need (`spine` cells, `tail` cell and sides) | — |
| M3-3 RUK-2945 | the placement contract: `Placement.spine` (item spine cells in lay order), `Placement.tail` (`LineTail`: cell, input side, output side; `tailColumn`) and `PlacedUnit.powerSide`, filled by `placeUnits` with today's geometry; the power code reads `powerSide`; `itemRisers` skips a port on the spine. Changes no row | SP-F |
| M3-4 RUK-2946 | the direct mode lays along `spine`/`tail`, no packed branch. Changes no row | M3-3 |
| M3-5 RUK-2947 | EnderIO's `itemLine` lays along `spine`/`tail`, no packed branch. Changes no row | M3-3 |
| M3-P1 RUK-2948 | `packedLine` and `placePacked` (SP-E/SP-F geometry, tail on the box's south face), not yet called | M3-3 |
| M3-P2 RUK-2974 | the packed line as a scored candidate in direct and EnderIO (`CandidateKind.Packed = 3`, `LayoutDeps.packing`), one feed tier, west head only; baseline lowered on 6 rows; the power checks read `powerSide`; a two-product tail column tested. From the CTO probe (`spikes/packed-candidate/`) | M3-4, M3-5, M3-P1 |
| SP-G RUK-2975 | spike: a packed column for AE2 with one ME Interface per machine, each wrenched at its own (T turned to output up, its interface on top). Routed waits: no research says whether a Project Red interface pipe may touch two machines | M3-P1 |
| SP-H RUK-2976 | spike: room in the head bank for a shallow line's transformers (H1 Hi-Amp Transformers where standard ones do not fit; H2 a bank two or more high). The probe found `loss-20`/`loss-40` reject the packed line only on `handTransformers` (`bankRows` lays at most one per row of the box's depth: 3 when packed; `loss-40` needs 20) | — |
| M3-P3 RUK-3005 | AE2 packed column promoted from SP-G (`spikes/packed-ae2/change.patch` + `repins.diff`): 4 AE2 rows lower; 8 tests re-pinned, not 2 (the spike ran 3 files) | SP-G |
| M3-P4 RUK-3006 | H1 promoted from SP-H (`spikes/bank-room/h1.patch` + `h1-repins.diff`): Hi-Amp banks where standard ones do not fit, and `compareScore` ranks "any hand transformer" before `unpowered` and the count after it (the CTO addendum in `spikes/bank-room/README.md`); 9 rows lower. H2 parked | M3-P3 |
| later in M3 | build-step words from each unit's own facing (`steps.ts`); reach and rain cover counted in the score (goals 3, 7) | the shapes they describe |
| M3-V | QA verification of the milestone branch | all above |

Deferred from M3, with the reason: **L and U shapes** and a single row. Nothing has measured them, they need the
power-head and hookup seams of the contract (R1: `planHead`, `bankRows`, `chooseSite`), and the two measured shapes
already take the cable where it pays. A spike for them comes after the packed shape lands, if you still want them.

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
