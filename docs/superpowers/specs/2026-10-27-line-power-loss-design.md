# Line power loss — design

Status: in build (2026-10-27). Task RUK-112, branch `feat/line-power-loss`.

## Why

The user's report: *"For the planner the electrical wire is not very optimal — we run wire around the machines on both sides, which does not work: we waste power, since it is per wire −EU per tick unless it's lossless."*

They are right, and the waste is larger than the warning text suggests. Measured on the fixture pack (LV, 32 V, 1x/2x/4x Tin cable, loss 1 V per block), laying a line of identical 30 EU/t single-block machines:

| machines | footprint (local w×h×l) | cable cells | line draw | internal loss, best feed cell | internal loss, worst feed cell |
|---|---|---|---|---|---|
| 10 | 7×1×5 | 15 | 300 EU/t | 120 EU/t (40 %) | 160 EU/t (53 %) |
| 20 | 12×1×5 | 25 | 600 EU/t | 340 EU/t (57 %) | 420 EU/t (70 %) |
| 40 | 22×1×5 | 45 | 1 200 EU/t | 1 570 EU/t (131 %) | 1 778 EU/t (148 %) |

The same 20-machine plan laid end to end by `layoutLine` with an MV tap, in every logistics mode (local footprint, cable cells, all four raising `cable_loss_high`):

| mode | footprint | cable cells |
|---|---|---|
| direct | 14×1×5 | 30 |
| enderio | 14×1×5 | 30 |
| routed | 24×2×5 | 49 |
| ae2 | 43×1×5 | 86 |

A 40-machine LV line therefore spends more EU on cable loss than on the machines. The loss also feeds back into the sizing: an under-volted machine draws more amps (`ceil(EU/t ÷ delivered volts)`), which needs bigger cable and more transformers, which the build list then prices.

## What actually costs the EU

GregTech charges cable loss **per amp, per cable block, along the path the packet takes** — not per cable block in the network (docs/research/gt-mechanics.md §3.3: `mLoss` is the sum of `mCableLossPerMeter` over the cables of the path, and `PowerNodes.processNodeInject` delivers `aVoltage − tVoltLoss`). Loss is absolute volts, so it hurts low tiers most: 10 blocks of tin cable deliver 22 of 32 V (31 % lost); 10 blocks of silver at HV deliver 502 of 512 (2 %).

Two consequences, and they are not the same thing:

1. **Path length is what burns EU.** Today every tier's power enters the line at the power head, which stands at the **west end** (`placeUnits`, `headWidth` columns at x = 0 …), and the tier's cable tree then fans **east** along the line to the last machine. So the worst path is the whole length of the line, and the average is half of it. Feeding the same cable in its **middle** halves every path. That is the fix with the best ratio of win to risk, and it is the heart of this task.
2. **The wire on both sides costs blocks, not EU.** Machines stand in two rows facing a one-block logistics spine, and a single-block machine's power port is the face *away* from the spine (`placeUnits`: "the spine side is its output side, the side away from the spine its power port"). So a tier needs one cable row outside each machine row, joined through the head — the "wire around the machines on both sides" the user sees. Given today's geometry it is forced, and `growTree` lays close to the minimum number of cells for it. Removing it means putting the power run **on the spine**, between the two rows, and moving item logistics to the two outer rows (items and fluids lose nothing by travelling further). That is goal 2 of the *shorter layouts* design (docs/superpowers/specs/2026-10-23-shorter-layouts-design.md), it rewrites the item trunk of all four logistics modes, and it is **not** in this task. See "Left for the shorter-layouts project".

## Assumptions

Recorded because the report does not say, and the work does not need an answer to start:

1. The user wants less **EU wasted**, measured as EU/t, and is not asking for a specific geometry. So this task buys loss reduction wherever it is cheapest, and reports what is left honestly, rather than reshaping the line.
2. Nothing here may make a line longer, change its logistics, or change which machines it places. Footprints may move; the set of placed machines must not change.
3. Lossless cable (superconductors, ULV Red Alloy at loss 0) is suggested when the active export has one at the tier, never silently chosen over a normal cable the player can actually craft.
4. Determinism stays absolute: the same plan, export and scan must give byte-identical layouts (the existing rotation/repeat tests guard this).

## Goals

**G1. Feed each tier's cable where it loses least, not at the west end.**
   - the power hookup may land on **any** supply-tier cable cell on the line's outer boundary, not only on the `x = 0` head column;
   - the landing cell is chosen to minimise **total** loss — the hookup run outside the line plus the line's own cables — because a block of hookup cable costs exactly as much per amp as a block inside;
   - each step-down bank stands beside the machines it feeds instead of in the head, so the lower, lossier tier runs a short distance and the higher tier covers the length of the line (at HV a 1 V/block cable loses 0.2 % per block, at LV 3 %).

**G2. Say what the loss is.** The layout reports, per voltage tier: the cable, its loss per block, the worst path in blocks, the volts delivered and the EU/t lost; plus the hookup's own loss and the banks' emitter loss. The power card shows the total. Today the loss is folded into one number and one vague sentence.

**G3. Make `cable_loss_high` actionable.** Name the EU/t being lost and the remedy that exists in this export: a lower-loss cable at this tier, a lossless cable, a higher-tier tap with a local step-down, or a shorter line.

**G4. Never regress.** A loss budget per fixture line, asserted in tests, so a later change cannot quietly give the EU back.

## Non-goals

- Power on the spine, packed shapes, stacking, cleanrooms, roofs, machine reuse: the *shorter layouts* project.
- Changing any logistics mode's item or fluid trunk.
- Changing `pickCable`'s ordering (it already prefers the lowest loss among the cables rated for the volts) or part prices (add-on 19 owns them).
- Laying parallel cable runs when one cable is short of amps (`cable_amps` today only warns). Separate defect, noted below.

## Anti-goals (a failure even if the EU number improves)

- A layout that cannot be built: two tiers' cables touching, a machine fed above its tier, a bank in a cell a machine needs.
- A hookup that lands somewhere the player cannot reach, or that routes a long way outside the line to save a shorter distance inside it (G1's objective is the **total**, which forbids this).
- A different layout for the same plan on a second run.
- Reporting a lower loss than the line really has.

## The work

Five changes. **B** fixes the shape of the data the others need and lands first.

- **A — report and explain the loss** (G2, G3). A per-tier loss breakdown on the layout, the total in the power detail, and a `cable_loss_high` text that names the EU/t and the remedy available in the export.
- **B — landing candidates** (G1). `InternalResult.supplyRun` becomes every supply-tier cable cell on the line's outer boundary, and `SupplyLoss.consumers[].blocks` is indexed by that candidate list instead of by the run's z. No change in which cell is picked yet: the hookup router still takes the cheapest route it finds.
- **C — pick the landing cell that loses least** (G1), after B. Score every candidate by `supplyAmps × hookupBlocks × lossPerBlock + internal loss(candidate)` and route to the best; deterministic tie-breaks.
- **D — the bank beside the machines it feeds** (G1), after B. A step-down bank moves from the head to the middle of its tier's machine columns, with the higher tier's run extended along the line to reach it.
- **E — loss budgets and verification** (G4), after A–D: fixture lines of 10, 20 and 40 machines in all four modes, asserting the loss per line and that it never rises.

Expected effect of C alone, on the measured lines: the worst path drops from the length of the line to half of it, so roughly 2–3× less internal loss. D adds to it on every line whose tap is above the machines' tier.

## Left for the shorter-layouts project

The remaining waste, once C and D have landed, is the length of the line itself: a 40-machine LV line is 22 columns long, so even fed from the middle a machine at the end is ~11 cable blocks from the power, or 34 % of 32 V. Cutting that needs the shape work already designed on 2026-10-23: the cable run between the two machine rows (so one run feeds both and the item trunks move outside), up to three machines per cable block, stacking single-block machines, and L/U shapes. That design is still waiting for the user to read it; this task does not pre-empt it, and nothing here blocks it — A's loss report is exactly the score the shape search needs.

Also noted while measuring, not fixed here:
- `ae2` mode lays a 43-column line for 20 machines (`portSpacing` 2) and `routed` a 24-column one, against 14 for `direct` and `enderio`. Three times the line length is three times the loss. Worth its own task.
- `cable_amps` warns "run N parallel lines" and lays one. The loss model prices one run's amps, which is right for one run, but the player builds N.

## Decided

By the designer (the user can overrule any of these in PR review):
- buy loss reduction by moving where the power enters, not by reshaping the line;
- the objective is total loss, hookup included, not the loss inside the line;
- the two-sided wire stays for now, and is explained rather than removed, because removing it is the shorter-layouts geometry;
- loss is reported per tier, in EU/t and as a share of the tier's volts;
- a lossless cable is suggested, never chosen for the player.
