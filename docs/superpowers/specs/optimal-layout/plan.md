# Optimal layout (RUK-2571): plan

Kind: **Program** (placement and wiring searched together; touches placement, internal routing, all four logistics
modes and their tests; well over 15 subtasks).

Status: **direction draft**, 2026-11-16. Phase 0 research and the measurement spike are running; the milestones below
are firmed up (and this file rewritten) when they land. Nothing here waits for approval: correct any assumption in a
comment on the pull request.

## Assumptions (my reading of the request)

1. "The wiring algorithm" means everything that connects the line: the power cables and transformer banks first, and the
   pipes, conduits and logistics cells too, since they compete for the same cells. "Always including machine placement"
   means the placement is part of the search, never fixed first and routed around afterwards.
2. This program carries out the core of the shorter-layouts design you agreed on 2026-10-22/23
   (`docs/superpowers/specs/2026-10-23-shorter-layouts-design.md`): goal 1 (shape search scored by laying the
   cables), goal 2 (one shared cable run per tier, a cable block feeding the machines on its sides and on top), goal 3
   (reach) and goal 7 (rain cover, needed once machines are stacked). Its goals 4 (machine reuse across steps),
   5 (cleanrooms) and 6 (wall sharing) are separate features and stay for a later program.
3. **"Most optimal" is measured, in this order:**
   1. buildable: every rule of today's layout holds (tiers never touch, hatches, reach, hand-run units untouched);
   2. **every machine actually powered**: no tier whose worst path loses all its volts (RUK-351 is a hard failure,
      not a warning);
   3. least **total length**: cable + pipe + conduit + logistics cells + transformer blocks + hookup runs, every block 1
      (the design's measure);
   4. least cable loss (EU/t);
   5. smallest bounding volume, then a fixed order, so the same plan always gives the same layout.
   A true optimum is out of reach for lines of 40+ machines (placement with routing is NP-hard), so "optimal" means: the
   best of a deterministic search over shapes, orders and splits, every candidate laid and routed for real, within a
   time budget (about a second for the user's real line), and **never worse than today's layout** on any line, which
   stays a candidate.
4. RUK-351 (far LV machines unpowered but reported fed) is folded into this program.
5. AE2 lines get port spacing 1 with Wrench targets on every interface (RUK-119's finding: −43 % cable on AE2 lines).

## Phases

- **Phase 0, now:** system map (`system-map.md`), four read-only inventories (R1–R4) and the measurement spike (S1),
  in parallel.
- **Phase 1:** reuse ledger (`reuse-ledger.md`): search algorithms and libraries (highs, already a dependency, for
  placement MIPs; Steiner-tree heuristics; prior block-game layout optimizers), each proven by a spike before the plan
  depends on it.
- **Phase 2:** the milestones, each a working slice the user can see in the 3D tab. The likely shape, to be confirmed by
  the measurements:
  - **M1 — the search loop and an honest score.** The measured objective above; dead tiers become a hard failure
    (RUK-351); `buildLocal` lays several candidates of today's geometry (orders, row splits, head positions) and keeps
    the best by the score; the 3D tab shows the chosen candidate's total length beside today's.
  - **M2 — better wiring on a fixed placement.** Shared cable runs per tier (one block feeds up to three machines),
    Steiner-tree improvement over `growTree`'s nearest-first greedy, AE2 spacing 1 with Wrench targets.
  - **M3 — new shapes.** A placement contract that is not tied to the two-rows spine, then single row, L, U and stacked
    candidates, with reach and rain cover.
  - **M4 — calibration.** The planner's per-machine logistics estimate updated to the new layouts (design goal 9).

## Risks

- The geometry is pinned by many tests; R1 sizes how much of the code assumes the spine. If it is most of it, M3 is
  the largest milestone and M1–M2 are delivered first on today's geometry.
- Search time: every candidate is laid and routed (1–11 ms on fixture lines, ~145 ms on the user's real line). M1
  sets the budget per line size.
- No real pack export is on this Mac, so the real-line checks (`GTNH_LOCAL=1` tests) run only where the user's planner
  runs; the benchmark here uses the fixture pack.
