# RUK-3059 (SP-N): blocks per machine of the lines the layout now chooses

How many cable, pipe, interface, chip-pipe, hookup and rain-roof blocks a laid line costs **per machine**, in each of
the four logistics modes, on M2's layouts and on this branch's (`feat/optimal-layout-m4`). A future per-machine
logistics estimate in the build model (add-on 19, `plan/19-logistics-cost`, which never reached `main` — the build model
has no such estimate today) can read its numbers from here. This is a measurement: nothing under `src/` or `tests/`
changed.

- M4 rows: `spikes/blocks-per-machine/rows-m4.txt`, laid at `b84f2e686` (this branch, before the unit-order search).
- M4 rows with the unit-order search (RUK-3068): `spikes/blocks-per-machine/rows-m4-reorder.txt`, laid at `cd493333b`
  by the M4 verification (RUK-3072). See "After the unit-order search" below.
- M2 rows: `spikes/blocks-per-machine/rows-m2.txt`, laid at `dab26f5f7` (M2 merged into the program branch).
- The test that produced both: `spikes/blocks-per-machine/measure.test.ts.txt`.

Every number in every table is summed out of the two rows files. Each file has **140 rows** — the 33 benchmark lines of
`tests/helpers/layout-bench.ts` (`benchLines()`: `loss-10`, `loss-20`, `loss-40`, `mixed-00`…`mixed-19`,
`fluid-00`…`fluid-09`) in all four modes = 132 rows, plus `lossLine(60, mode)` and `lossLine(80, mode)` in all four
modes = 8 rows. Each row carries the line's name, mode, machines, the chosen candidate's kind, and every count
`lengthOf` reports. Machines come from the plan, not from blocks: the sum of the plan steps' `count`, so a multiblock
counts once however many blocks it stands on.

**Formula.** A table's "per machine" figure is `(sum of that role's blocks over the group's rows) / (sum of the group's
machines)`; `sum` is the same ratio for the six roles together. M2's `lengthOf` has no `roof` field (the rain roof is
RUK-2877, M3), so its roof column is 0 by definition, and its search knows no kind beyond `WestHead` and `MiddleHead`
(`spikes/blocks-per-machine/rows-m2.txt` uses the numbers 0 and 1 only).

`CandidateKind` (`src/shared/types/layout.ts:185`) numbers the line the layout search chose: `WestHead` 0,
`MiddleHead` 1, `Stacked` 2, `Packed` 3, `PackedOpen` 4, `Reordered` 5 (RUK-3068; only `rows-m4-reorder.txt` has it).
The rows files give the numbers; the tables give the names.

## Table 1 — per mode, M2 against M4

All 140 rows, 35 rows and 376 machines per mode.

| mode | rev | rows | machines | cable | pipe | iface | chip | hookup | roof | sum |
|---|---|---|---|---|---|---|---|---|---|---|
| direct | M2 | 35 | 376 | 3.11 | 0.95 | 0.00 | 0.00 | 1.52 | 0.00 | 5.59 |
| direct | M4 | 35 | 376 | 2.93 | 1.01 | 0.00 | 0.00 | 1.54 | 1.11 | 6.59 |
| routed | M2 | 35 | 376 | 4.12 | 0.49 | 0.00 | 1.20 | 1.75 | 0.00 | 7.56 |
| routed | M4 | 35 | 376 | 3.57 | 0.48 | 0.00 | 1.20 | 1.70 | 1.39 | 8.34 |
| ae2 | M2 | 35 | 376 | 4.12 | 0.41 | 0.98 | 0.00 | 1.75 | 0.00 | 7.26 |
| ae2 | M4 | 35 | 376 | 2.72 | 0.55 | 0.98 | 0.00 | 1.64 | 1.28 | 7.16 |
| enderio | M2 | 35 | 376 | 3.11 | 0.74 | 0.00 | 0.00 | 1.72 | 0.00 | 5.56 |
| enderio | M4 | 35 | 376 | 2.92 | 0.81 | 0.00 | 0.00 | 1.68 | 1.20 | 6.60 |

M4 lays fewer cable blocks per machine in every mode (ae2 the most: 4.12 → 2.72) and adds a rain roof, so its `sum`
rises everywhere except ae2, where the cable saving outweighs the roof. Routed keeps its 1.20 chip pipes per machine
and AE2 its 0.98 interfaces: those are set by the mode, not by the layout.

## Table 2 — per mode and chosen kind, M4

All 140 rows. `rows` is how many of the 140 layouts chose that kind in that mode.

| mode | chosen kind | rows | machines | cable | pipe | iface | chip | hookup | roof | sum |
|---|---|---|---|---|---|---|---|---|---|---|
| direct | WestHead (0) | 18 | 89 | 5.49 | 1.69 | 0.00 | 0.00 | 3.48 | 1.57 | 12.24 |
| direct | MiddleHead (1) | 1 | 6 | 3.17 | 1.17 | 0.00 | 0.00 | 2.67 | 0.67 | 7.67 |
| direct | Stacked (2) | 13 | 246 | 2.28 | 0.76 | 0.00 | 0.00 | 0.88 | 0.90 | 4.83 |
| direct | Packed (3) | 3 | 35 | 0.89 | 1.00 | 0.00 | 0.00 | 1.00 | 1.54 | 4.43 |
| routed | WestHead (0) | 12 | 49 | 7.04 | 1.86 | 0.00 | 1.49 | 4.31 | 2.02 | 16.71 |
| routed | MiddleHead (1) | 1 | 6 | 3.83 | 0.50 | 0.00 | 1.67 | 2.67 | 1.33 | 10.00 |
| routed | Stacked (2) | 22 | 321 | 3.03 | 0.27 | 0.00 | 1.15 | 1.29 | 1.29 | 7.03 |
| ae2 | WestHead (0) | 11 | 45 | 7.40 | 1.84 | 0.76 | 0.00 | 4.31 | 2.27 | 16.58 |
| ae2 | MiddleHead (1) | 1 | 6 | 3.83 | 0.33 | 1.33 | 0.00 | 2.67 | 1.50 | 9.67 |
| ae2 | Stacked (2) | 14 | 93 | 5.15 | 0.54 | 1.01 | 0.00 | 2.86 | 1.82 | 11.38 |
| ae2 | Packed (3) | 3 | 14 | 1.29 | 1.14 | 1.00 | 0.00 | 4.07 | 1.29 | 8.79 |
| ae2 | PackedOpen (4) | 6 | 218 | 0.77 | 0.25 | 1.00 | 0.00 | 0.39 | 0.84 | 3.25 |
| enderio | WestHead (0) | 18 | 89 | 5.46 | 1.03 | 0.00 | 0.00 | 3.48 | 1.84 | 11.82 |
| enderio | MiddleHead (1) | 1 | 6 | 3.17 | 1.17 | 0.00 | 0.00 | 2.67 | 0.67 | 7.67 |
| enderio | Stacked (2) | 13 | 246 | 2.28 | 0.69 | 0.00 | 0.00 | 1.03 | 0.93 | 4.93 |
| enderio | Packed (3) | 3 | 35 | 0.89 | 1.00 | 0.00 | 0.00 | 1.46 | 1.54 | 4.89 |

Routed never chooses a packed line (a `Packed` candidate is laid in direct, EnderIO and AE2 only, see the
`LayoutCandidate` comment at `src/shared/types/layout.ts:204`), so its kinds are `WestHead`, `MiddleHead` and
`Stacked` only. The cheap-in-blocks kinds win where they are allowed: `Stacked` carries 246 of the 376 direct machines
and 321 of routed's, and AE2's `PackedOpen` 218 of 376 — the whole loss family (10 to 80 machines) and `mixed-05`. The
head kinds are the small lines' fallback: direct's 18 `WestHead` rows are small mixed and fluid lines averaging 5
machines each, and they cost 1.5 to 5 times the blocks per machine of the stacked and packed kinds the same mode can
choose (16.58 against 3.25 in AE2).

## Table 3 — per line family

The 140 rows split by family, all four modes together. `bench loss 60/80` is `lossLine(60, mode)` and
`lossLine(80, mode)`: 8 rows carrying 560 machines, against the 132 bench rows' 944 — 1 504 machines in all, the same
total Table 1's four modes add up to.

| family | rev | rows | machines | cable | pipe | iface | chip | hookup | roof | sum |
|---|---|---|---|---|---|---|---|---|---|---|
| bench loss (10/20/40) | M2 | 12 | 280 | 2.97 | 0.30 | 0.25 | 0.27 | 0.65 | 0.00 | 4.45 |
| bench loss (10/20/40) | M4 | 12 | 280 | 1.65 | 0.48 | 0.25 | 0.27 | 0.54 | 1.00 | 4.19 |
| mixed (20 lines) | M2 | 80 | 444 | 5.46 | 0.65 | 0.27 | 0.36 | 3.24 | 0.00 | 9.99 |
| mixed (20 lines) | M4 | 80 | 444 | 5.14 | 0.73 | 0.27 | 0.36 | 3.28 | 1.80 | 11.58 |
| fluid (10 lines) | M2 | 40 | 220 | 5.10 | 1.91 | 0.17 | 0.32 | 3.27 | 0.00 | 10.78 |
| fluid (10 lines) | M4 | 40 | 220 | 5.02 | 1.89 | 0.17 | 0.32 | 3.27 | 1.59 | 12.27 |
| bench loss 60/80 | M2 | 8 | 560 | 1.89 | 0.33 | 0.25 | 0.26 | 0.34 | 0.00 | 3.06 |
| bench loss 60/80 | M4 | 8 | 560 | 1.28 | 0.35 | 0.25 | 0.26 | 0.24 | 0.79 | 3.17 |

The families split in two. The single-tier macerator chains (the loss lines) run 3-4 blocks per machine on M4, while
the mixed and fluid lines run 10-12: their cable (5.0-5.1 per machine) and their hookup runs (3.3) are almost all of it,
because machines of several tiers and the fluids between them each need their own run out to the base. Length is what
makes a line cheap per machine: the 60/80-machine loss lines are the lowest of all, 3.17 per machine on M4.

## Raw sums behind the tables

Summed blocks and summed machines, straight out of the rows files; every per-machine figure above is the matching
cell divided by the row's `machines`.

| rev mode | rows | machines | cable | pipe | iface | chip | hookup | roof | blocks |
|---|---|---|---|---|---|---|---|---|---|
| M2 direct | 35 | 376 | 1171 | 358 | 0 | 0 | 573 | 0 | 2102 |
| M2 routed | 35 | 376 | 1548 | 185 | 0 | 451 | 659 | 0 | 2843 |
| M2 ae2 | 35 | 376 | 1548 | 156 | 368 | 0 | 659 | 0 | 2731 |
| M2 enderio | 35 | 376 | 1168 | 279 | 0 | 0 | 645 | 0 | 2092 |
| M4 direct | 35 | 376 | 1101 | 380 | 0 | 0 | 578 | 419 | 2478 |
| M4 routed | 35 | 376 | 1341 | 182 | 0 | 451 | 640 | 522 | 3136 |
| M4 ae2 | 35 | 376 | 1021 | 206 | 368 | 0 | 618 | 481 | 2694 |
| M4 enderio | 35 | 376 | 1098 | 303 | 0 | 0 | 630 | 451 | 2482 |

| family | rev | rows | machines | cable | pipe | iface | chip | hookup | roof | blocks |
|---|---|---|---|---|---|---|---|---|---|---|
| bench loss (10/20/40) | M2 | 12 | 280 | 832 | 85 | 70 | 76 | 183 | 0 | 1246 |
| bench loss (10/20/40) | M4 | 12 | 280 | 461 | 135 | 70 | 76 | 151 | 281 | 1174 |
| mixed (20 lines) | M2 | 80 | 444 | 2426 | 290 | 120 | 160 | 1440 | 0 | 4436 |
| mixed (20 lines) | M4 | 80 | 444 | 2280 | 323 | 120 | 160 | 1458 | 801 | 5142 |
| fluid (10 lines) | M2 | 40 | 220 | 1121 | 421 | 38 | 71 | 720 | 0 | 2371 |
| fluid (10 lines) | M4 | 40 | 220 | 1105 | 416 | 38 | 71 | 720 | 349 | 2699 |
| bench loss 60/80 | M2 | 8 | 560 | 1056 | 182 | 140 | 144 | 193 | 0 | 1715 |
| bench loss 60/80 | M4 | 8 | 560 | 715 | 197 | 140 | 144 | 137 | 442 | 1775 |

## After the unit-order search

Tables 1-3 above were laid at `b84f2e686`, before M4's unit-order search (RUK-3068) was merged. The M4 verification
(RUK-3072) re-ran the same harness on `cd493333b`, which has the search, into `rows-m4-reorder.txt`. It differs from
`rows-m4.txt` on **22 of 140 rows**, all of them mixed lines: `mixed-01` (direct, enderio), `mixed-02` and `mixed-03`
(all four modes), `mixed-07` (direct, routed, enderio), `mixed-09` (direct, ae2, enderio), `mixed-13` routed,
`mixed-14` (routed, ae2), `mixed-17` (routed, ae2) and `mixed-18` ae2. Every changed row chose a `Reordered` line.
No loss or fluid row changed, and neither did `lossLine(60)` or `lossLine(80)`: the search's cap,
`min(8, floor(160 / movable machines))`, gives the long lines few or no swaps, and no fluid line's reordered candidate
beat the line M3 kept.

### Table 4: per mode, before and after the search

| mode | rev | rows | machines | cable | pipe | iface | chip | hookup | roof | sum |
|---|---|---|---|---|---|---|---|---|---|---|
| direct | M4 before | 35 | 376 | 2.93 | 1.01 | 0.00 | 0.00 | 1.54 | 1.11 | 6.59 |
| direct | M4 after | 35 | 376 | 2.91 | 1.01 | 0.00 | 0.00 | 1.54 | 1.10 | 6.55 |
| routed | M4 before | 35 | 376 | 3.57 | 0.48 | 0.00 | 1.20 | 1.70 | 1.39 | 8.34 |
| routed | M4 after | 35 | 376 | 3.55 | 0.48 | 0.00 | 1.20 | 1.70 | 1.38 | 8.32 |
| ae2 | M4 before | 35 | 376 | 2.72 | 0.55 | 0.98 | 0.00 | 1.64 | 1.28 | 7.16 |
| ae2 | M4 after | 35 | 376 | 2.70 | 0.55 | 0.98 | 0.00 | 1.64 | 1.26 | 7.14 |
| enderio | M4 before | 35 | 376 | 2.92 | 0.81 | 0.00 | 0.00 | 1.68 | 1.20 | 6.60 |
| enderio | M4 after | 35 | 376 | 2.90 | 0.80 | 0.00 | 0.00 | 1.68 | 1.18 | 6.56 |

The search saves 15 / 8 / 11 / 15 blocks across the four modes (direct / routed / ae2 / enderio), the same numbers the
benchmark gives (2098 / 2509 / 2333 / 2075 → 2083 / 2501 / 2322 / 2060 on its 132 rows). Over 376 machines a mode,
that is 0.02-0.04 blocks per machine. The saving is cable and roof: a reordered line puts machines that share a feed
next to each other, which shortens the cable run and narrows the roof. Pipes, interfaces, chip pipes and hookup runs
barely move.

On the mixed family alone (Table 3's grouping) it is 11.58 → **11.47** blocks per machine (5142 → 5093 blocks over
444 machines). The other three families are unchanged.

### Table 5: per mode and chosen kind, after the search

| mode | chosen kind | rows | machines | cable | pipe | iface | chip | hookup | roof | sum |
|---|---|---|---|---|---|---|---|---|---|---|
| direct | WestHead (0) | 14 | 70 | 5.20 | 1.80 | 0.00 | 0.00 | 3.47 | 1.54 | 12.01 |
| direct | MiddleHead (1) | 1 | 6 | 3.17 | 1.17 | 0.00 | 0.00 | 2.67 | 0.67 | 7.67 |
| direct | Stacked (2) | 12 | 241 | 2.19 | 0.75 | 0.00 | 0.00 | 0.82 | 0.88 | 4.64 |
| direct | Packed (3) | 3 | 35 | 0.89 | 1.00 | 0.00 | 0.00 | 1.00 | 1.54 | 4.43 |
| direct | Reordered (5) | 5 | 24 | 6.33 | 1.25 | 0.00 | 0.00 | 3.62 | 1.42 | 12.62 |
| routed | WestHead (0) | 11 | 43 | 6.60 | 2.07 | 0.00 | 1.47 | 4.47 | 1.88 | 16.49 |
| routed | MiddleHead (1) | 1 | 6 | 3.83 | 0.50 | 0.00 | 1.67 | 2.67 | 1.33 | 10.00 |
| routed | Stacked (2) | 17 | 295 | 2.84 | 0.26 | 0.00 | 1.12 | 1.09 | 1.27 | 6.58 |
| routed | Reordered (5) | 6 | 32 | 5.94 | 0.41 | 0.00 | 1.53 | 3.47 | 1.75 | 13.09 |
| ae2 | WestHead (0) | 10 | 39 | 6.97 | 2.10 | 0.67 | 0.00 | 4.49 | 2.13 | 16.36 |
| ae2 | Stacked (2) | 12 | 82 | 4.98 | 0.59 | 0.99 | 0.00 | 2.80 | 1.85 | 11.21 |
| ae2 | Packed (3) | 1 | 5 | 1.60 | 1.00 | 1.00 | 0.00 | 3.80 | 1.80 | 9.20 |
| ae2 | PackedOpen (4) | 6 | 218 | 0.77 | 0.25 | 1.00 | 0.00 | 0.39 | 0.84 | 3.25 |
| ae2 | Reordered (5) | 6 | 32 | 4.94 | 0.56 | 1.19 | 0.00 | 3.41 | 1.50 | 11.59 |
| enderio | WestHead (0) | 14 | 70 | 5.16 | 0.97 | 0.00 | 0.00 | 3.47 | 1.89 | 11.49 |
| enderio | MiddleHead (1) | 1 | 6 | 3.17 | 1.17 | 0.00 | 0.00 | 2.67 | 0.67 | 7.67 |
| enderio | Stacked (2) | 12 | 241 | 2.19 | 0.67 | 0.00 | 0.00 | 0.97 | 0.92 | 4.74 |
| enderio | Packed (3) | 3 | 35 | 0.89 | 1.00 | 0.00 | 0.00 | 1.46 | 1.54 | 4.89 |
| enderio | Reordered (5) | 5 | 24 | 6.33 | 1.25 | 0.00 | 0.00 | 3.62 | 1.42 | 12.62 |

`Reordered` rows look expensive per machine (11.6-13.1) because the search only wins on small mixed lines, which cost
10-12 blocks per machine whatever kind they choose (Table 3). None of those lines uses more blocks than before, and each
uses fewer blocks or loses less power: `mixed-09` and `mixed-14` in AE2 keep 38 and 39 blocks and lose 3 and 8 EU/t
less. Compare the same line before and after, not the `Reordered` row with the `Stacked` one. AE2 has no `MiddleHead` row after the search:
the one line that chose it before (`mixed-18`) now chooses `Reordered` (58 → 56 blocks).

### Raw sums after the search

| rev mode | rows | machines | cable | pipe | iface | chip | hookup | roof | blocks |
|---|---|---|---|---|---|---|---|---|---|
| M4 after direct | 35 | 376 | 1094 | 378 | 0 | 0 | 578 | 413 | 2463 |
| M4 after routed | 35 | 376 | 1336 | 182 | 0 | 451 | 640 | 519 | 3128 |
| M4 after ae2 | 35 | 376 | 1014 | 208 | 368 | 0 | 618 | 475 | 2683 |
| M4 after enderio | 35 | 376 | 1091 | 301 | 0 | 0 | 630 | 445 | 2467 |
| mixed (20 lines) | 80 | 444 | 2254 | 321 | 120 | 160 | 1458 | 780 | 5093 |

### What the search costs

Timed by RUK-3072 on this Mac, each run on its own: the 132 benchmark rows take 2208 ms on M3 and 2957 ms on M4, about
5.7 ms more per row. `lossLine(80)` is unchanged (76-189 ms on M3, 78-181 ms on M4, by mode).

## How this was measured

Two commits, one harness. M4 is this branch at `b84f2e686`; M2 is `dab26f5f7`, measured in a detached scratch worktree
(`git worktree add --detach "$TMPDIR/spn-m2" dab26f5f7`, `npm ci`, removed after the run). The measuring test is
`spikes/blocks-per-machine/measure.test.ts.txt`: it lays each of the 33 lines of `benchLines()` in each of the four
modes exactly as `runBench()` does — `layoutLine(layoutPack(), line.plan, line.scan(mode), makeProject({ logistics:
mode }), line.deps)` (`tests/helpers/layout-bench.ts:132`) — and then the four modes of `lossLine(60, mode)` and
`lossLine(80, mode)` (`tests/helpers/power-loss.ts:93`), 140 layouts in all with a 600 s test timeout. Each layout is
measured with the harness's own `lengthOf` (`tests/helpers/layout-bench.ts:74`), whose field names the rows files use
verbatim (`cable`, `pipe`, `iface`, `chip`, `roof`, `hookup`, `total`, plus `transformer`, `chest`, `lossEUt`,
`routeFailed`, `unpowered`, `unreachable` and the weak tiers), and counted with the plan's machines
(`Σ steps[].count`, `PlanStep.count` in `src/shared/types/plan.ts:283`) and the chosen candidate's
`layout.search.candidates[layout.search.chosen].kind`. The M2 copy of the test drops the two fields M2's `lengthOf`
does not have, `roof` and `unreachable`; `transformer` and `chest` are reported and, as in `lengthOf`, never counted in
a `sum`. Each per-machine number is summed blocks over summed machines of the group, never an average of per-row
ratios, so a long line's weight is its size. The tables above are read straight out of `rows-m2.txt` and `rows-m4.txt`;
the raw sums are in the last section, so any cell can be checked by hand.
