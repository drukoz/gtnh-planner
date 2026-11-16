# SP-C — satellite step-down banks along long LV lines (spike, RUK-351 / RUK-2669)

A measuring spike for M2 (RUK-2571 / RUK-2668): lay small MV→LV step-down banks ("satellites") out along a line
where its LV wiring gets too weak, and measure what that costs and saves on the layout benchmark. **Nothing here is
production code**: `src/` and `tests/` are untouched on this branch. The prototype is `change.patch` (apply against
`src/` at this branch's HEAD, `git apply spikes/satellite-banks/change.patch`); it edits only
`src/server/layout/internal.ts` (+283 / −56).

## What was measured

All 132 benchmark rows (33 lines × 4 logistics modes, `tests/helpers/layout-bench.ts`) were laid with
`layoutLine(...)` and measured with `lengthOf(layout)` after a BEFORE pass (unmodified `src/`) and an AFTER pass (the
patch applied). Each row also records the machines starved by wiring (`!powered && tier <= feedTier`) and the
satellites laid (`InternalResult.satellites`, added by the patch). `runBench()` was timed three times per pass.
The BEFORE pass equals `tests/fixtures/layout-bench/baseline.json` on `total`, `lossEUt` and `unpowered` for all 132
rows, and reproduces the CTO's starved counts (loss-10 ae2 4, loss-20 routed 8 / ae2 11, loss-40 direct 7 / routed 22 /
ae2 31 / enderio 7 — 90 machines on 7 rows).

## Results

| (132 rows, sums)        | BEFORE | AFTER | Δ      |
| ------------------------|-------:|------:|-------:|
| cable+block `total`     |  8 500 | 8 797 | +297   |
| `lossEUt` (line losses) | 75 143 | 47 568 | −27 575 |
| `unpowered` machines    |    246 |   156 | −90    |
| starved by wiring       |     90 |     0 | −90    |
| satellites laid         |      0 |    20 | +20    |

Every satellite landed on the 7 known starved rows (1× loss-10 ae2, 2× loss-20 routed, 3× loss-20 ae2, 2× loss-40
direct, 4× loss-40 routed, 6× loss-40 ae2, 2× loss-40 enderio); the other 125 rows are byte-identical to the
baseline. The remaining 156 unpowered machines are all HV machines fed from the MV supply — untouched, out of scope.

| row       | mode     | sat | total     | lossEUt       | unpowered | starved |
| ----------|----------|----:|----------:|--------------:|----------:|--------:|
| loss-10   | ae2      |   1 |  78 →  97 |    489 →  298 |      4 → 0 |    4 → 0 |
| loss-20   | routed   |   2 |  86 → 139 |  1 053 →  636 |      8 → 0 |    8 → 0 |
| loss-20   | ae2      |   3 | 169 → 194 |  1 908 →  788 |     11 → 0 |   11 → 0 |
| loss-40   | direct   |   2 |  99 → 139 |  1 470 → 1280 |      7 → 0 |    7 → 0 |
| loss-40   | routed   |   4 | 181 → 242 |  4 412 → 1454 |     22 → 0 |   22 → 0 |
| loss-40   | ae2      |   6 | 295 → 354 | 24 988 → 2479 |     31 → 0 |   31 → 0 |
| loss-40   | enderio  |   2 | 113 → 153 |  1 470 → 1280 |      7 → 0 |    7 → 0 |

**Starved by wiring: 7 rows / 90 machines → 0 rows / 0 machines.** The AE2 lines' worst loss collapses (loss-40 ae2:
24 988 → 2 479 EU/t, −90%); the cost is satellite cable and transformers (+297 blocks over the whole benchmark, +11
to +61 on the seven rows).

**Timing** (`runBench()`, full benchmark 3× per pass, seconds): BEFORE 5.9 / 5.6 / 5.7 (median **5.7**), AFTER
6.6 / 6.3 / 6.2 (median **6.3**) — the two-phase route (plan from an unmodified dry run, re-route with satellites)
costs ~11%.

## Layout tests that fail with the patch applied (`npx vitest run tests/unit/layout`)

18 of 940, all in tests that assert today's loss-line behaviour — each is a direct consequence of the spike:

- `power-loss.test.ts` (5) "the N-machine routed/ae2 line wires every machine from its own tier at 1 V or more":
  group ports are fed from the satellite, so `hopsToRun` no longer reaches the tier's head run.
- `middle-head.test.ts` (5): "wires a middle head in … mode" (same head-run-reachability assertion) and "drops the
  worst LV path below the west head" (the west head's worst LV loss fell 44 → 14 with satellites, so the head-choice
  numbers move).
- `head-choice.test.ts` (3): "lays the 20-machine routed line with the west head" (the middle head now wins) and
  "lays the 20- / 40-machine ae2 line with the middle head" (satellites cut the west head's loss, so the west head
  now wins).
- `internal.test.ts` (1) "warns which LV machines the 40-machine AE2 line cannot run" — no starved machines, no
  `machine_unpowered` warning.
- `m1-verify.test.ts` (1) "names every machine the warning counts" — same, warning gone.
- `layout-bench.test.ts` (1) "flags the 40-machine AE2 line's LV wiring as weak" — `weakTiers` is now empty.
- `score.test.ts` (1) "reports the far macerators of the 40-machine AE2 loss line as unpowered" — none are.
- `layout.test.ts` (1) "keeps the west head when a middle head would leave transformers to place by hand" — a
  satellite on the middle-head candidate of the loss-8 ae2 line adds a `transformer_bank` warning (satellite groups
  needing more transformers than the one block laid), and `handWork` counts the satellite's laid transformer as a
  bank transformer.

`npx tsc -b` passes with the patch applied.

## What the prototype does (change.patch, `src/server/layout/internal.ts` only)

`routeInternal` became two-phase when `stages` exist: phase 1 routes the line exactly as today (dry run); satellites
are planned from its sizing; phase 2 re-routes the line on a fresh grid with the satellites claimed, and the satellite
pass is kept only when every satellite wires up (its input reaches the supply tree, every group port reaches its
output cell). `InternalResult` gains `satellites: number`.

- **Far machines** per stage fed off the supply run: `reach = floor((V[T] − need) / lossPerBlock(T)) − 2`, `need` the
  tier's max `ceil(EU/t ÷ maxAmps)`; a wired machine whose packets cross more than `reach` blocks is far.
- **Groups**: far ports sorted by x, z; new group on crossing the head's side (east/west of `headX`) or when a port
  stands farther than `reach − 4` from its group's first port.
- **Placement**: one satellite per group at the group's middle x; candidates x = `xc, xc−1, xc+1, xc−2, xc+2 …`,
  y = 0…h, z = spine outward. The cell must be free (not a power port, not a machine, in bounds), the cell above free
  for the MV input, and it needs a free side neighbour (west, east, north, south in order) touching no supply-tier
  cell for the LV output. The transformer cell and the input cell are taken; the output cell is laid as LV cable.
- **Trees**: the head's tier-T tree feeds only the near ports; each group's ports are fed by a tree grown from the
  satellite's output cell and merged into that tier's tree. The supply tree is grown after (lowest tier first) and
  each satellite's input cell is added as a terminal (kept out of `cells`, so no cable is laid on it).
- **Sizing**: after `sizePower`, a group machine's loss is `lossPerBlock(T) × (blocks from the satellite output + 1)`;
  the satellite counts its group's amps at those volts over the transformer ratio (`TRANSFORMER_AMPS_OUT` 4 /
  `_AMPS_IN` 2 from power.ts, mirrored) and is added to `supply.consumers` at its input cell, so the hookup's landing
  prices the satellite's MV feed. One transformer block is laid facing the output; `Put N more …` warns for the rest.
- **Skipped rows**: a row whose groups have no room, no free input, no linked group, or a supply path that fails
  keeps its phase-1 (today's) layout. No benchmark row took this path; all 7 starved rows got satellites.

**Limitations** (for the M2 design to weigh): satellites are only planned for banks fed directly off the supply tier
(the 7 starved rows); an intermediate stage's bank would hang off a run whose loss is priced through the banks. The
head bank is sized as if every machine were fed from the head (never lowered, so safe, slightly oversized). The
laid satellite transformer inflates `handWork.transformers` (layout.ts:281 counts placed transformer blocks against
the head bank's `needed`), which is what moves the head-choice tests. Cable-cell reachability assertions
(`hopsToRun`, `reaches`) no longer hold across a satellite — tests written against "every port traces to the tier's
head run" need rethinking.

## Reproducing

```sh
git apply spikes/satellite-banks/change.patch   # prototype into src/server/layout/internal.ts
# BEFORE/AFTER tables above: lay the 132 rows with a temporary measuring test that captures
# `localLine` (internal.satellites / starved counts) and writes JSON per row, and runBench() 3×;
# compare against tests/fixtures/layout-bench/baseline.json (total, lossEUt, unpowered).
npx vitest run tests/unit/layout                # 18 failures, listed above; npx tsc -b passes
git checkout -- src                              # restore
```
