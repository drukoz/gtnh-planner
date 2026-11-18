# Spike SP-E: one cable lane feeding machines on both sides and on top (RUK-2879)

Parent: RUK-2877 (M3 optimal layout), RUK-2571.

A line of plain 1×1×1 singleblocks is laid **packed**: one cable lane at `[x, 0, 1]` with three machines on every
cell — A at `[x, 0, 0]` (front north, output up), B at `[x, 0, 2]` (front south, output up) and T at `[x, 1, 1]`
(front north, output south) — so one cable cell feeds three machines. The prototype is `change.patch` next to this
file (`git apply spikes/shared-cable/change.patch` on this branch); `src/` in the committed tree is untouched.

## Verdict

**Promote, with two conditions.** Over the 20 qualifying benchmark lines the packed lane uses **63.2% fewer cable
blocks** in `direct` (717 → 264) and cuts line loss 14.0% (8,995 → 7,734 EU/t) — with the same cable types and amps,
because the sizer sizes per run and never looks at a cell. The two conditions come from where the prototype broke:

1. **Only lines fed at one tier.** On every qualifying line with two feed tiers the far tier's tree cannot reach its
   ports — its run grows along the same lane and the near tier's cable is in the way — so 2–3 machines per line come
   back `route_failed` ("connect it by hand"). A multi-tier packed line needs one lane per tier offset in z.
2. **Cap the lane length at its cable's volt drop.** `loss-60` (60 macerators, 24 columns on one LV lane) leaves 15
   machines unpowered at 14 V arriving; a 30 EU/t macerator at LV dies below 15 V. `loss-40` (14 columns, 16 V) is
   the longest line that stays powered.

## What was measured

`runBench()` (`tests/helpers/layout-bench.ts`) lays the 33 lines of `benchLines()` in all four logistics modes — 132
rows — against `tests/fixtures/layout-bench/baseline.json`, plus one extra line `loss-60` (`lossPlan(60)`, `direct`)
because more than three lines qualify. A temporary harness (`tests/unit/layout/tmp-spike.test.ts`, not committed)
lays every line through `layoutLine` and keeps the per-row numbers: BEFORE is the committed tree, AFTER is
`SPIKE_PACKED=1`. A line qualifies when every unit is a 1×1×1 singleblock, not a multiblock, not run by hand, not
venting, no workbench, and takes and makes no fluid. 20 lines qualify:

`loss-10, loss-20, loss-40, mixed-00, mixed-04, mixed-05, mixed-06, mixed-08, mixed-09, mixed-10, mixed-11,
mixed-12, mixed-13, mixed-14, mixed-16, mixed-17, mixed-19, fluid-01, fluid-03, loss-60`

A packed row lays power only (the spike skips `buildMode`), so its logistics cost is the spike's lanes,
`2 × (tailX − firstX) + 3` (`[x, 1, 0]`, `[x, 1, 2]`, joined at the tail through `[tailX, 1, 0..2]`); BEFORE rows
use the mode's own `pipe + iface + chip`.

## The prototype row: `loss-10`, `direct`, `SPIKE_PACKED=1`

Ten macerators fill four columns, A, B, T per column:

```
column x=3: 3 machine block(s)
column x=4: 3 machine block(s)
column x=5: 3 machine block(s)
column x=6: 1 machine block(s)
```

(x=0..2 is the MV head — supply, transformer, LV run; x=7 is the tail join. One cable cell per column at `[x, 0, 1]`.)

| | BEFORE | AFTER (packed) |
|---|---|---|
| cable | 20 | **10** |
| logistics (BEFORE pipe + iface + chip, AFTER lanes) | 6 | 11 |
| cable + logistics | 26 | **21** |
| loss EU/t | 252 | **176** |
| unpowered | 0 | 0 |
| starved by wiring | 0 | 0 |
| tier contacts | 0 | 0 |
| worst LV path (blocks / arriving V) | 10 / 22 | 6 / 26 |
| size (world x·y·z) | 5×1×9 | 3×2×8 |
| MV cable | 2x Annealed Copper, 5 cells / 3 runs / 6 A | 2x Annealed Copper, 3 cells / 3 runs / 6 A |
| LV cable | 4x Tin, 15 cells / 5 runs / 20 A | 4x Tin, 7 cells / 5 runs / 20 A |

## Cable and loss per qualifying row

BEFORE → AFTER. `worst path` is the row's lowest feed tier: blocks from supply to the furthest machine and the volts
arriving there. Rows with `0/Vmax` in AFTER have no reached machine at that tier — the packed layout left those
unwired (see Regressions).

| line | mode | cable | logistics | loss EU/t | unpowered | starved by wiring | worst path (blocks/V) | size |
|---|---|---|---|---|---|---|---|---|
| loss-10 | direct | 20 → 10 | 6 → 11 | 252 → 176 | 0 → 0 | 0 → 0 | T1 10/22 → 6/26 | 5x1x9 → 3x2x8 |
| loss-10 | enderio | 20 → 10 | 6 → 11 | 252 → 176 | 0 → 0 | 0 → 0 | T1 10/22 → 6/26 | 9x1x5 → 3x2x8 |
| loss-20 | direct | 30 → 13 | 11 → 17 | 580 → 394 | 0 → 0 | 0 → 0 | T1 15/17 → 9/23 | 5x1x14 → 3x2x11 |
| loss-20 | enderio | 30 → 13 | 11 → 17 | 580 → 394 | 0 → 0 | 0 → 0 | T1 15/17 → 9/23 | 5x1x14 → 3x2x11 |
| loss-40 | direct | 94 → 20 | 21 → 31 | 1224 → 982 | 0 → 0 | 0 → 0 | T1 15/17 → 16/16 | 5x4x24 → 3x2x18 |
| loss-40 | enderio | 94 → 20 | 21 → 31 | 1224 → 982 | 0 → 0 | 0 → 0 | T1 15/17 → 16/16 | 5x4x24 → 3x2x18 |
| mixed-00 | direct | 39 → 24 | 7 → 13 | 268 → 242 | 0 → 0 | 0 → 0 | T1 7/25 → 4/28 | 12x3x5 → 11x3x3 |
| mixed-00 | enderio | 39 → 24 | 7 → 13 | 268 → 242 | 0 → 0 | 0 → 0 | T1 7/25 → 4/28 | 12x3x5 → 11x3x3 |
| mixed-04 | direct | 19 → 6 | 3 → 5 | 78 → 62 | 0 → 0 | 0 → 0 | T2 4/124 → 0/128 | 6x3x5 → 5x1x3 |
| mixed-04 | enderio | 19 → 6 | 3 → 5 | 78 → 62 | 0 → 0 | 0 → 0 | T2 4/124 → 0/128 | 6x3x5 → 5x1x3 |
| mixed-05 | direct | 13 → 6 | 5 → 9 | 614 → 585 | 4 → 4 | 4 → 4 | T2 9/119 → 4/124 | 6x1x5 → 5x2x3 |
| mixed-05 | enderio | 13 → 6 | 5 → 9 | 614 → 585 | 4 → 4 | 4 → 4 | T2 9/119 → 4/124 | 6x1x5 → 5x2x3 |
| mixed-06 | direct | 33 → 19 | 4 → 7 | 118 → 94 | 0 → 0 | 0 → 0 | T1 4/28 → 0/32 | 9x3x5 → 8x3x3 |
| mixed-06 | enderio | 33 → 19 | 4 → 7 | 118 → 94 | 0 → 0 | 0 → 0 | T1 4/28 → 0/32 | 9x3x5 → 8x3x3 |
| mixed-08 | direct | 58 → 22 | 8 → 11 | 368 → 248 | 0 → 0 | 0 → 0 | T1 6/26 → 0/32 | 13x4x5 → 10x3x3 |
| mixed-08 | enderio | 58 → 22 | 8 → 11 | 368 → 248 | 0 → 0 | 0 → 0 | T1 6/26 → 0/32 | 13x4x5 → 10x3x3 |
| mixed-09 | direct | 9 → 5 | 3 → 7 | 361 → 362 | 3 → 3 | 3 → 3 | T2 7/121 → 3/125 | 4x1x5 → 4x2x3 |
| mixed-09 | enderio | 9 → 5 | 3 → 7 | 361 → 362 | 3 → 3 | 3 → 3 | T2 7/121 → 3/125 | 4x1x5 → 4x2x3 |
| mixed-10 | direct | 34 → 18 | 7 → 11 | 858 → 754 | 5 → 5 | 5 → 4 | T1 6/26 → 0/32 | 10x3x5 → 8x3x3 |
| mixed-10 | enderio | 34 → 18 | 7 → 11 | 858 → 754 | 5 → 5 | 5 → 4 | T1 6/26 → 0/32 | 10x3x5 → 8x3x3 |
| mixed-11 | direct | 32 → 17 | 5 → 7 | 100 → 86 | 0 → 0 | 0 → 0 | T1 4/28 → 0/32 | 10x3x5 → 8x3x3 |
| mixed-11 | enderio | 32 → 17 | 5 → 7 | 100 → 86 | 0 → 0 | 0 → 0 | T1 4/28 → 0/32 | 10x3x5 → 8x3x3 |
| mixed-12 | direct | 28 → 9 | 4 → 5 | 104 → 74 | 0 → 0 | 0 → 0 | T1 4/28 → 0/32 | 9x3x5 → 7x2x3 |
| mixed-12 | enderio | 28 → 9 | 4 → 5 | 104 → 74 | 0 → 0 | 0 → 0 | T1 4/28 → 0/32 | 9x3x5 → 7x2x3 |
| mixed-13 | direct | 15 → 8 | 4 → 7 | 106 → 93 | 0 → 0 | 0 → 0 | T1 6/26 → 4/28 | 7x1x5 → 6x2x3 |
| mixed-13 | enderio | 15 → 8 | 4 → 7 | 106 → 93 | 0 → 0 | 0 → 0 | T1 6/26 → 4/28 | 7x1x5 → 6x2x3 |
| mixed-14 | direct | 10 → 5 | 4 → 7 | 291 → 283 | 2 → 2 | 2 → 2 | T2 8/120 → 3/125 | 5x1x5 → 4x2x3 |
| mixed-14 | enderio | 10 → 5 | 4 → 7 | 291 → 283 | 2 → 2 | 2 → 2 | T2 8/120 → 3/125 | 5x1x5 → 4x2x3 |
| mixed-16 | direct | 25 → 6 | 4 → 5 | 234 → 169 | 2 → 2 | 2 → 0 | T1 4/28 → 0/32 | 7x3x5 → 5x2x3 |
| mixed-16 | enderio | 25 → 6 | 4 → 5 | 234 → 169 | 2 → 2 | 2 → 0 | T1 4/28 → 0/32 | 7x3x5 → 5x2x3 |
| mixed-17 | direct | 28 → 16 | 5 → 7 | 381 → 337 | 1 → 1 | 1 → 1 | T1 4/28 → 0/32 | 8x3x5 → 6x3x3 |
| mixed-17 | enderio | 28 → 16 | 5 → 7 | 381 → 337 | 1 → 1 | 1 → 1 | T1 4/28 → 0/32 | 8x3x5 → 6x3x3 |
| mixed-19 | direct | 32 → 16 | 6 → 9 | 610 → 513 | 3 → 3 | 3 → 2 | T1 7/25 → 0/32 | 9x3x5 → 7x3x3 |
| mixed-19 | enderio | 32 → 16 | 6 → 9 | 610 → 513 | 3 → 3 | 3 → 2 | T1 7/25 → 0/32 | 9x3x5 → 7x3x3 |
| fluid-01 | direct | 26 → 9 | 3 → 5 | 56 → 46 | 0 → 0 | 0 → 0 | T1 4/28 → 0/32 | 8x3x5 → 7x1x3 |
| fluid-01 | enderio | 26 → 9 | 3 → 5 | 56 → 46 | 0 → 0 | 0 → 0 | T1 4/28 → 0/32 | 8x3x5 → 7x1x3 |
| fluid-03 | direct | 30 → 9 | 5 → 7 | 74 → 59 | 0 → 0 | 0 → 0 | T1 6/26 → 0/32 | 10x3x5 → 8x2x3 |
| fluid-03 | enderio | 30 → 9 | 5 → 7 | 74 → 59 | 0 → 0 | 0 → 0 | T1 6/26 → 0/32 | 10x3x5 → 8x2x3 |
| loss-60 | direct | 142 → 26 | 31 → 43 | 2318 → 2175 | 0 → 15 | 0 → 15 | T1 15/17 → 22/10 | 5x4x34 → 3x2x24 |

Sums over the qualifying rows: `direct` cable 717 → 264 (−63.2%), cable + logistics 863 → 488 (−43.5%), loss
8,995 → 7,734 (−14.0%); `enderio` cable 575 → 238 (−58.6%), loss 6,677 → 5,559 (−16.7%).

The `routed` and `ae2` rows carry their items in the mode's own blocks, which the spike skips, so only their power
is comparable:

| line | mode | cable B→A | loss EU/t B→A | unpowered B→A |
|---|---|---|---|---|
| loss-10 | routed | 29 → 10 | 290 → 176 | 0 → 0 |
| loss-10 | ae2 | 29 → 10 | 290 → 176 | 0 → 0 |
| loss-20 | routed | 85 → 13 | 636 → 394 | 0 → 0 |
| loss-20 | ae2 | 85 → 13 | 636 → 394 | 0 → 0 |
| loss-40 | routed | 158 → 20 | 2052 → 982 | 0 → 0 |
| loss-40 | ae2 | 158 → 20 | 2052 → 982 | 0 → 0 |
| mixed-00 | routed | 49 → 24 | 301 → 242 | 0 → 0 |
| mixed-00 | ae2 | 49 → 24 | 301 → 242 | 0 → 0 |
| mixed-04 | routed | 19 → 6 | 78 → 62 | 0 → 0 |
| mixed-04 | ae2 | 19 → 6 | 78 → 62 | 0 → 0 |
| mixed-05 | routed | 20 → 6 | 657 → 585 | 4 → 4 |
| mixed-05 | ae2 | 20 → 6 | 657 → 585 | 4 → 4 |
| mixed-06 | routed | 34 → 19 | 119 → 94 | 0 → 0 |
| mixed-06 | ae2 | 34 → 19 | 119 → 94 | 0 → 0 |
| mixed-08 | routed | 67 → 22 | 395 → 248 | 0 → 0 |
| mixed-08 | ae2 | 67 → 22 | 395 → 248 | 0 → 0 |
| mixed-09 | routed | 12 → 5 | 381 → 362 | 3 → 3 |
| mixed-09 | ae2 | 12 → 5 | 381 → 362 | 3 → 3 |
| mixed-10 | routed | 43 → 18 | 977 → 754 | 5 → 5 |
| mixed-10 | ae2 | 43 → 18 | 977 → 754 | 5 → 5 |
| mixed-11 | routed | 35 → 17 | 103 → 86 | 0 → 0 |
| mixed-11 | ae2 | 35 → 17 | 103 → 86 | 0 → 0 |
| mixed-12 | routed | 29 → 9 | 105 → 74 | 0 → 0 |
| mixed-12 | ae2 | 29 → 9 | 105 → 74 | 0 → 0 |
| mixed-13 | routed | 19 → 8 | 114 → 93 | 0 → 0 |
| mixed-13 | ae2 | 19 → 8 | 114 → 93 | 0 → 0 |
| mixed-14 | routed | 15 → 5 | 327 → 283 | 2 → 2 |
| mixed-14 | ae2 | 15 → 5 | 327 → 283 | 2 → 2 |
| mixed-16 | routed | 25 → 6 | 234 → 169 | 2 → 2 |
| mixed-16 | ae2 | 25 → 6 | 234 → 169 | 2 → 2 |
| mixed-17 | routed | 31 → 16 | 423 → 337 | 1 → 1 |
| mixed-17 | ae2 | 31 → 16 | 423 → 337 | 1 → 1 |
| mixed-19 | routed | 39 → 16 | 663 → 513 | 3 → 3 |
| mixed-19 | ae2 | 39 → 16 | 663 → 513 | 3 → 3 |
| fluid-01 | routed | 26 → 9 | 56 → 46 | 0 → 0 |
| fluid-01 | ae2 | 26 → 9 | 56 → 46 | 0 → 0 |
| fluid-03 | routed | 36 → 9 | 82 → 59 | 0 → 0 |
| fluid-03 | ae2 | 36 → 9 | 82 → 59 | 0 → 0 |

Sums: `routed`/`ae2` cable 771 → 238 (−69.1%), loss 7,993 → 5,559 (−30.5%).

## Cable types, cells, runs and amps per tier

`internal.cables` with the stage amps per tier. The chosen cable type is identical BEFORE and AFTER on every
qualifying row: the packed lane carries the same current per tier as the tree it replaces, so `sizePower` picks the
same cable and buys cells with it. (cells = cable cells, runs = runs at the head, amps = the stage's amps at that
tier — per run at the head, not per cell.)

| line | mode | BEFORE | AFTER | tier contacts |
|---|---|---|---|---|
| loss-10 | direct | T2 2x Annealed Copper Cable 5c/3r/6A + T1 4x Tin Cable 15c/5r/20A | T2 2x Annealed Copper Cable 3c/3r/6A + T1 4x Tin Cable 7c/5r/20A | 0 |
| loss-10 | routed | T2 2x Annealed Copper Cable 5c/3r/6A + T1 4x Tin Cable 24c/5r/20A | T2 2x Annealed Copper Cable 3c/3r/6A + T1 4x Tin Cable 7c/5r/20A | 0 |
| loss-10 | ae2 | T2 2x Annealed Copper Cable 5c/3r/6A + T1 4x Tin Cable 24c/5r/20A | T2 2x Annealed Copper Cable 3c/3r/6A + T1 4x Tin Cable 7c/5r/20A | 0 |
| loss-10 | enderio | T2 2x Annealed Copper Cable 5c/3r/6A + T1 4x Tin Cable 15c/5r/20A | T2 2x Annealed Copper Cable 3c/3r/6A + T1 4x Tin Cable 7c/5r/20A | 0 |
| loss-20 | direct | T2 2x Annealed Copper Cable 5c/6r/12A + T1 4x Tin Cable 25c/10r/40A | T2 2x Annealed Copper Cable 3c/6r/12A + T1 4x Tin Cable 10c/10r/40A | 0 |
| loss-20 | routed | T2 2x Annealed Copper Cable 31c/7r/14A + T1 4x Tin Cable 54c/5r/20A | T2 2x Annealed Copper Cable 3c/6r/12A + T1 4x Tin Cable 10c/10r/40A | 0 |
| loss-20 | ae2 | T2 2x Annealed Copper Cable 31c/7r/14A + T1 4x Tin Cable 54c/5r/20A | T2 2x Annealed Copper Cable 3c/6r/12A + T1 4x Tin Cable 10c/10r/40A | 0 |
| loss-20 | enderio | T2 2x Annealed Copper Cable 5c/6r/12A + T1 4x Tin Cable 25c/10r/40A | T2 2x Annealed Copper Cable 3c/6r/12A + T1 4x Tin Cable 10c/10r/40A | 0 |
| loss-40 | direct | T2 2x Annealed Copper Cable 32c/14r/28A + T1 4x Tin Cable 62c/10r/40A | T2 2x Annealed Copper Cable 3c/12r/24A + T1 4x Tin Cable 17c/20r/80A | 0 |
| loss-40 | routed | T2 2x Annealed Copper Cable 54c/17r/33A + T1 4x Tin Cable 104c/5r/20A | T2 2x Annealed Copper Cable 3c/12r/24A + T1 4x Tin Cable 17c/20r/80A | 0 |
| loss-40 | ae2 | T2 2x Annealed Copper Cable 54c/17r/33A + T1 4x Tin Cable 104c/5r/20A | T2 2x Annealed Copper Cable 3c/12r/24A + T1 4x Tin Cable 17c/20r/80A | 0 |
| loss-40 | enderio | T2 2x Annealed Copper Cable 32c/14r/28A + T1 4x Tin Cable 62c/10r/40A | T2 2x Annealed Copper Cable 3c/12r/24A + T1 4x Tin Cable 17c/20r/80A | 0 |
| mixed-00 | direct | T3 2x Silver Cable 5c/2r/3A + T2 2x Annealed Copper Cable 23c/5r/10A + T1 4x Tin Cable 11c/2r/6A | T3 2x Silver Cable 3c/2r/3A + T2 2x Annealed Copper Cable 16c/5r/10A + T1 4x Tin Cable 5c/2r/6A | 0 |
| mixed-00 | routed | T3 2x Silver Cable 5c/2r/3A + T2 2x Annealed Copper Cable 28c/5r/10A + T1 4x Tin Cable 16c/2r/6A | T3 2x Silver Cable 3c/2r/3A + T2 2x Annealed Copper Cable 16c/5r/10A + T1 4x Tin Cable 5c/2r/6A | 0 |
| mixed-00 | ae2 | T3 2x Silver Cable 5c/2r/3A + T2 2x Annealed Copper Cable 28c/5r/10A + T1 4x Tin Cable 16c/2r/6A | T3 2x Silver Cable 3c/2r/3A + T2 2x Annealed Copper Cable 16c/5r/10A + T1 4x Tin Cable 5c/2r/6A | 0 |
| mixed-00 | enderio | T3 2x Silver Cable 5c/2r/3A + T2 2x Annealed Copper Cable 23c/5r/10A + T1 4x Tin Cable 11c/2r/6A | T3 2x Silver Cable 3c/2r/3A + T2 2x Annealed Copper Cable 16c/5r/10A + T1 4x Tin Cable 5c/2r/6A | 0 |
| mixed-04 | direct | T3 2x Silver Cable 13c/2r/3A + T2 1x Annealed Copper Cable 6c/1r/1A | T3 2x Silver Cable 3c/2r/3A + T2 1x Annealed Copper Cable 3c/1r/1A | 0 |
| mixed-04 | routed | T3 2x Silver Cable 13c/2r/3A + T2 1x Annealed Copper Cable 6c/1r/1A | T3 2x Silver Cable 3c/2r/3A + T2 1x Annealed Copper Cable 3c/1r/1A | 0 |
| mixed-04 | ae2 | T3 2x Silver Cable 13c/2r/3A + T2 1x Annealed Copper Cable 6c/1r/1A | T3 2x Silver Cable 3c/2r/3A + T2 1x Annealed Copper Cable 3c/1r/1A | 0 |
| mixed-04 | enderio | T3 2x Silver Cable 13c/2r/3A + T2 1x Annealed Copper Cable 6c/1r/1A | T3 2x Silver Cable 3c/2r/3A + T2 1x Annealed Copper Cable 3c/1r/1A | 0 |
| mixed-05 | direct | T2 2x Annealed Copper Cable 13c/14r/27A | T2 2x Annealed Copper Cable 6c/14r/27A | 0 |
| mixed-05 | routed | T2 2x Annealed Copper Cable 20c/14r/27A | T2 2x Annealed Copper Cable 6c/14r/27A | 0 |
| mixed-05 | ae2 | T2 2x Annealed Copper Cable 20c/14r/27A | T2 2x Annealed Copper Cable 6c/14r/27A | 0 |
| mixed-05 | enderio | T2 2x Annealed Copper Cable 13c/14r/27A | T2 2x Annealed Copper Cable 6c/14r/27A | 0 |
| mixed-06 | direct | T3 2x Silver Cable 22c/2r/4A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 1x Tin Cable 6c/1r/1A | T3 2x Silver Cable 13c/2r/4A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-06 | routed | T3 2x Silver Cable 23c/2r/4A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 1x Tin Cable 6c/1r/1A | T3 2x Silver Cable 13c/2r/4A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-06 | ae2 | T3 2x Silver Cable 23c/2r/4A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 1x Tin Cable 6c/1r/1A | T3 2x Silver Cable 13c/2r/4A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-06 | enderio | T3 2x Silver Cable 22c/2r/4A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 1x Tin Cable 6c/1r/1A | T3 2x Silver Cable 13c/2r/4A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-08 | direct | T3 2x Silver Cable 28c/4r/8A + T2 2x Annealed Copper Cable 21c/3r/6A + T1 4x Tin Cable 9c/2r/8A | T3 2x Silver Cable 16c/4r/8A + T2 2x Annealed Copper Cable 3c/3r/6A + T1 4x Tin Cable 3c/2r/8A | 0 |
| mixed-08 | routed | T3 2x Silver Cable 31c/4r/8A + T2 2x Annealed Copper Cable 24c/3r/6A + T1 4x Tin Cable 12c/2r/8A | T3 2x Silver Cable 16c/4r/8A + T2 2x Annealed Copper Cable 3c/3r/6A + T1 4x Tin Cable 3c/2r/8A | 0 |
| mixed-08 | ae2 | T3 2x Silver Cable 31c/4r/8A + T2 2x Annealed Copper Cable 24c/3r/6A + T1 4x Tin Cable 12c/2r/8A | T3 2x Silver Cable 16c/4r/8A + T2 2x Annealed Copper Cable 3c/3r/6A + T1 4x Tin Cable 3c/2r/8A | 0 |
| mixed-08 | enderio | T3 2x Silver Cable 28c/4r/8A + T2 2x Annealed Copper Cable 21c/3r/6A + T1 4x Tin Cable 9c/2r/8A | T3 2x Silver Cable 16c/4r/8A + T2 2x Annealed Copper Cable 3c/3r/6A + T1 4x Tin Cable 3c/2r/8A | 0 |
| mixed-09 | direct | T2 2x Annealed Copper Cable 9c/9r/17A | T2 2x Annealed Copper Cable 5c/9r/17A | 0 |
| mixed-09 | routed | T2 2x Annealed Copper Cable 12c/9r/17A | T2 2x Annealed Copper Cable 5c/9r/17A | 0 |
| mixed-09 | ae2 | T2 2x Annealed Copper Cable 12c/9r/17A | T2 2x Annealed Copper Cable 5c/9r/17A | 0 |
| mixed-09 | enderio | T2 2x Annealed Copper Cable 9c/9r/17A | T2 2x Annealed Copper Cable 5c/9r/17A | 0 |
| mixed-10 | direct | T2 2x Annealed Copper Cable 24c/15r/29A + T1 4x Tin Cable 10c/2r/5A | T2 2x Annealed Copper Cable 15c/14r/27A + T1 4x Tin Cable 3c/2r/5A | 0 |
| mixed-10 | routed | T2 2x Annealed Copper Cable 29c/15r/30A + T1 4x Tin Cable 14c/2r/5A | T2 2x Annealed Copper Cable 15c/14r/27A + T1 4x Tin Cable 3c/2r/5A | 0 |
| mixed-10 | ae2 | T2 2x Annealed Copper Cable 29c/15r/30A + T1 4x Tin Cable 14c/2r/5A | T2 2x Annealed Copper Cable 15c/14r/27A + T1 4x Tin Cable 3c/2r/5A | 0 |
| mixed-10 | enderio | T2 2x Annealed Copper Cable 24c/15r/29A + T1 4x Tin Cable 10c/2r/5A | T2 2x Annealed Copper Cable 15c/14r/27A + T1 4x Tin Cable 3c/2r/5A | 0 |
| mixed-11 | direct | T3 2x Silver Cable 5c/1r/2A + T2 2x Annealed Copper Cable 20c/2r/4A + T1 2x Tin Cable 7c/1r/2A | T3 2x Silver Cable 3c/1r/2A + T2 2x Annealed Copper Cable 11c/2r/4A + T1 2x Tin Cable 3c/1r/2A | 0 |
| mixed-11 | routed | T3 2x Silver Cable 5c/1r/2A + T2 2x Annealed Copper Cable 22c/2r/4A + T1 2x Tin Cable 8c/1r/2A | T3 2x Silver Cable 3c/1r/2A + T2 2x Annealed Copper Cable 11c/2r/4A + T1 2x Tin Cable 3c/1r/2A | 0 |
| mixed-11 | ae2 | T3 2x Silver Cable 5c/1r/2A + T2 2x Annealed Copper Cable 22c/2r/4A + T1 2x Tin Cable 8c/1r/2A | T3 2x Silver Cable 3c/1r/2A + T2 2x Annealed Copper Cable 11c/2r/4A + T1 2x Tin Cable 3c/1r/2A | 0 |
| mixed-11 | enderio | T3 2x Silver Cable 5c/1r/2A + T2 2x Annealed Copper Cable 20c/2r/4A + T1 2x Tin Cable 7c/1r/2A | T3 2x Silver Cable 3c/1r/2A + T2 2x Annealed Copper Cable 11c/2r/4A + T1 2x Tin Cable 3c/1r/2A | 0 |
| mixed-12 | direct | T3 2x Silver Cable 16c/2r/3A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 4x Tin Cable 7c/1r/3A | T3 2x Silver Cable 3c/2r/3A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 4x Tin Cable 3c/1r/3A | 0 |
| mixed-12 | routed | T3 2x Silver Cable 16c/2r/3A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 4x Tin Cable 8c/1r/3A | T3 2x Silver Cable 3c/2r/3A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 4x Tin Cable 3c/1r/3A | 0 |
| mixed-12 | ae2 | T3 2x Silver Cable 16c/2r/3A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 4x Tin Cable 8c/1r/3A | T3 2x Silver Cable 3c/2r/3A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 4x Tin Cable 3c/1r/3A | 0 |
| mixed-12 | enderio | T3 2x Silver Cable 16c/2r/3A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 4x Tin Cable 7c/1r/3A | T3 2x Silver Cable 3c/2r/3A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 4x Tin Cable 3c/1r/3A | 0 |
| mixed-13 | direct | T2 2x Annealed Copper Cable 5c/2r/3A + T1 4x Tin Cable 10c/2r/7A | T2 2x Annealed Copper Cable 3c/2r/3A + T1 4x Tin Cable 5c/2r/7A | 0 |
| mixed-13 | routed | T2 2x Annealed Copper Cable 5c/2r/3A + T1 4x Tin Cable 14c/2r/7A | T2 2x Annealed Copper Cable 3c/2r/3A + T1 4x Tin Cable 5c/2r/7A | 0 |
| mixed-13 | ae2 | T2 2x Annealed Copper Cable 5c/2r/3A + T1 4x Tin Cable 14c/2r/7A | T2 2x Annealed Copper Cable 3c/2r/3A + T1 4x Tin Cable 5c/2r/7A | 0 |
| mixed-13 | enderio | T2 2x Annealed Copper Cable 5c/2r/3A + T1 4x Tin Cable 10c/2r/7A | T2 2x Annealed Copper Cable 3c/2r/3A + T1 4x Tin Cable 5c/2r/7A | 0 |
| mixed-14 | direct | T2 2x Annealed Copper Cable 10c/7r/13A | T2 2x Annealed Copper Cable 5c/7r/13A | 0 |
| mixed-14 | routed | T2 2x Annealed Copper Cable 15c/7r/13A | T2 2x Annealed Copper Cable 5c/7r/13A | 0 |
| mixed-14 | ae2 | T2 2x Annealed Copper Cable 15c/7r/13A | T2 2x Annealed Copper Cable 5c/7r/13A | 0 |
| mixed-14 | enderio | T2 2x Annealed Copper Cable 10c/7r/13A | T2 2x Annealed Copper Cable 5c/7r/13A | 0 |
| mixed-16 | direct | T2 2x Annealed Copper Cable 19c/5r/9A + T1 1x Tin Cable 6c/1r/1A | T2 2x Annealed Copper Cable 3c/5r/9A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-16 | routed | T2 2x Annealed Copper Cable 19c/5r/9A + T1 1x Tin Cable 6c/1r/1A | T2 2x Annealed Copper Cable 3c/5r/9A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-16 | ae2 | T2 2x Annealed Copper Cable 19c/5r/9A + T1 1x Tin Cable 6c/1r/1A | T2 2x Annealed Copper Cable 3c/5r/9A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-16 | enderio | T2 2x Annealed Copper Cable 19c/5r/9A + T1 1x Tin Cable 6c/1r/1A | T2 2x Annealed Copper Cable 3c/5r/9A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-17 | direct | T2 2x Annealed Copper Cable 22c/7r/13A + T1 1x Tin Cable 6c/1r/1A | T2 2x Annealed Copper Cable 13c/7r/13A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-17 | routed | T2 2x Annealed Copper Cable 25c/7r/14A + T1 1x Tin Cable 6c/1r/1A | T2 2x Annealed Copper Cable 13c/7r/13A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-17 | ae2 | T2 2x Annealed Copper Cable 25c/7r/14A + T1 1x Tin Cable 6c/1r/1A | T2 2x Annealed Copper Cable 13c/7r/13A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-17 | enderio | T2 2x Annealed Copper Cable 22c/7r/13A + T1 1x Tin Cable 6c/1r/1A | T2 2x Annealed Copper Cable 13c/7r/13A + T1 1x Tin Cable 3c/1r/1A | 0 |
| mixed-19 | direct | T2 2x Annealed Copper Cable 22c/10r/19A + T1 4x Tin Cable 10c/3r/10A | T2 2x Annealed Copper Cable 13c/9r/18A + T1 4x Tin Cable 3c/3r/10A | 0 |
| mixed-19 | routed | T2 2x Annealed Copper Cable 25c/10r/19A + T1 4x Tin Cable 14c/3r/10A | T2 2x Annealed Copper Cable 13c/9r/18A + T1 4x Tin Cable 3c/3r/10A | 0 |
| mixed-19 | ae2 | T2 2x Annealed Copper Cable 25c/10r/19A + T1 4x Tin Cable 14c/3r/10A | T2 2x Annealed Copper Cable 13c/9r/18A + T1 4x Tin Cable 3c/3r/10A | 0 |
| mixed-19 | enderio | T2 2x Annealed Copper Cable 22c/10r/19A + T1 4x Tin Cable 10c/3r/10A | T2 2x Annealed Copper Cable 13c/9r/18A + T1 4x Tin Cable 3c/3r/10A | 0 |
| fluid-01 | direct | T3 2x Silver Cable 15c/1r/2A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 1x Tin Cable 6c/1r/1A | T3 2x Silver Cable 3c/1r/2A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 1x Tin Cable 3c/1r/1A | 0 |
| fluid-01 | routed | T3 2x Silver Cable 15c/1r/2A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 1x Tin Cable 6c/1r/1A | T3 2x Silver Cable 3c/1r/2A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 1x Tin Cable 3c/1r/1A | 0 |
| fluid-01 | ae2 | T3 2x Silver Cable 15c/1r/2A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 1x Tin Cable 6c/1r/1A | T3 2x Silver Cable 3c/1r/2A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 1x Tin Cable 3c/1r/1A | 0 |
| fluid-01 | enderio | T3 2x Silver Cable 15c/1r/2A + T2 1x Annealed Copper Cable 5c/1r/1A + T1 1x Tin Cable 6c/1r/1A | T3 2x Silver Cable 3c/1r/2A + T2 1x Annealed Copper Cable 3c/1r/1A + T1 1x Tin Cable 3c/1r/1A | 0 |
| fluid-03 | direct | T3 1x Silver Cable 5c/1r/1A + T2 2x Annealed Copper Cable 15c/2r/3A + T1 4x Tin Cable 10c/2r/5A | T3 1x Silver Cable 3c/1r/1A + T2 2x Annealed Copper Cable 3c/2r/3A + T1 4x Tin Cable 3c/2r/5A | 0 |
| fluid-03 | routed | T3 1x Silver Cable 5c/1r/1A + T2 2x Annealed Copper Cable 17c/2r/3A + T1 4x Tin Cable 14c/2r/5A | T3 1x Silver Cable 3c/1r/1A + T2 2x Annealed Copper Cable 3c/2r/3A + T1 4x Tin Cable 3c/2r/5A | 0 |
| fluid-03 | ae2 | T3 1x Silver Cable 5c/1r/1A + T2 2x Annealed Copper Cable 17c/2r/3A + T1 4x Tin Cable 14c/2r/5A | T3 1x Silver Cable 3c/1r/1A + T2 2x Annealed Copper Cable 3c/2r/3A + T1 4x Tin Cable 3c/2r/5A | 0 |
| fluid-03 | enderio | T3 1x Silver Cable 5c/1r/1A + T2 2x Annealed Copper Cable 15c/2r/3A + T1 4x Tin Cable 10c/2r/5A | T3 1x Silver Cable 3c/1r/1A + T2 2x Annealed Copper Cable 3c/2r/3A + T1 4x Tin Cable 3c/2r/5A | 0 |
| loss-60 | direct | T2 2x Annealed Copper Cable 46c/23r/45A + T1 4x Tin Cable 96c/10r/40A | T2 2x Annealed Copper Cable 3c/20r/40A + T1 4x Tin Cable 23c/34r/135A | 0 |

### What does the code put on the cell that feeds three machines?

Nothing — it never looks at a cell. `sizePower` (`src/server/layout/internal.ts`) sizes **per run per tier** from
the stage's `ampsOut`: on `loss-10` the LV stage feeds 5 macerators at 4 A, so the tier is sized at 20 A and picks
4× Tin (32 A), and the warnings it adds are per run (a run over its ampacity, a machine at a tier below its feed).
There is no per-cell current anywhere in `InternalResult`, and `InternalGrid` has no ampacity check at all, so the
packed lane's cell feeding three machines (6 A on `loss-10`) passes silently — exactly the spike's question. A
promoted packed line must add the check the sizer lacks: a cell fed by a run of amps `a` serving `k` machines needs
the run's ampacity ≥ the machines' summed draw, which for a full packed column is 3× what a tree cell of the same
tier carries. Note the `loss-60` AFTER row: one lane forces all 60 macerators onto one LV tier, its stage `ampsOut`
135 A, and the lane is still sized from the *runs*, so the 4× Tin cells never see the 135 A the lane carries.

## Tier contacts

The packed rows' power ports sit on a shared lane cell, so `tierContacts` (`tests/helpers/power-loss.ts:115`,
reading `powerSide ?? facing` where the spike sets it) was re-run on all 77 packed rows: **zero contacts on every
row**. The one empty column between tier groups keeps a tier's lane cells away from other tiers' cable and
machines, and a packed cell touches only its own tier's cable and its own three machines (the T machine at
`[x, 1, 1]` sits above the lane, touching its feed cell through its bottom).

## Can energy enter a basic machine through its output side?

The docs at hand (`docs/research/gt-mechanics.md:459-466`, `docs/research/machine-feeding.md:55-60`) say: a basic
machine's **front never accepts items** (`MTEBasicMachine.allowPutStack`); its **output side accepts items only
with** `mAllowInputFromOutputSide` (on by default, `gt.machines.main`); and items, fluids and energy **never pass
the front** (`gt-mechanics.md:478`). None of them says energy is blocked on the **output side** — the documented
output-side gate is the item/fluid one. Conclusion: the docs leave energy on the output side **allowed**, and the
spike's table is safe under either reading: A and B take power from the lane cell north/south of them (their sides,
not front, not output), T takes it from the cell below its bottom, and no packed unit feeds power through its front
or output side. GTNH's real per-face energy table (the side-EU panel of `MTEEnergy`) is not in this repo and would
settle the open question exactly.

## Regressions the prototype found

- **Multi-tier lines break.** On `mixed-04, -06, -08, -10, -11, -12, -16, -17, -19, fluid-01, fluid-03` the line goes
  from `route_failed = 0` to 2–3: "Could not wire Advanced Assembler inside the line — connect it by hand". The far
  tier's cable tree grows along the lane and the near tier's cable cells are in the way — the gap between tier
  groups is in x, not in z, so the tree has no way round. Cable and loss on those rows still "improve", which is
  the trap: the broken machines are simply left unwired, so they contribute nothing to loss, and the machine counts
  stay at the BEFORE values.
- **A long single lane starves its far end.** `loss-60`: 15 of 60 macerators unpowered at 14 V arriving (30 EU/t at
  LV needs ≥ 15 V at the 2 amps a macerator draws). One lane is one long run; the committed layout splits 60
  macerators over 10 runs of ~6 so no path exceeds ~15 blocks. `loss-40` at 14 columns / 16 V is the longest
  packed line that stays powered.
- Everything else holds: unpowered and route failures unchanged (0 → 0) on every other qualifying row, and
  `mixed-09`'s three starved long-line reactors are unchanged (112.2 V arriving against 109.2 V before).

## Face and placement notes for promotion

- `PlacedUnit.powerSide` is the side from `ports.power` into the machine; `internal.ts` uses it at `powerCell`
  (:335) and when linking a port cell to its machine (:862). Everywhere else it is unset and `facing` rules.
- `PlacedUnit.row` is required by the type and has no consumer in `src/`; `placePacked` sets `row: 'N'` for every
  unit, so a promoted packed line must not key off `row`.
- Non-electric 1×1×1 singleblocks in a packed line get `ports.power = null` and share the columns, fed on the lanes.
- The spike's gate is `SPIKE_PACKED=1` with `westUnits === 0` and `packedLine(units)` in `buildLocalAt`
  (`src/server/layout/layout.ts`); `buildMode` is skipped with `emptyModeResult()`, so items, fluids and networks
  are left to the builder — the packed rows' logistics numbers are the spike's lane formula, not built blocks.

## Reproducing

```bash
npm ci
npx tsc -b
git apply spikes/shared-cable/change.patch
npx vitest run tests/unit/layout/tmp-spike.test.ts                  # BEFORE: $TMPDIR/before.json
SPIKE_PACKED=1 npx vitest run tests/unit/layout/tmp-spike.test.ts   # AFTER:  $TMPDIR/after.json
git checkout -- src/                                                # drop the prototype
```

The harness `tests/unit/layout/tmp-spike.test.ts` is temporary and not committed; it lays every `benchLines()` line
in all four modes plus `lossPlan(60)` through `layoutLine`, keeps `lengthOf` per row, the packed lanes
(`2 × (tailX − firstX) + 3`), `tierContacts` over `powerSide ?? facing`, per-tier cable cells/runs/stage amps,
`route_failed` texts and starved machines, and prints the `loss-10`/`direct` per-column block counts.

Spike timing, `runBench()` (132 layouts) three times, median: **BEFORE 544 ms, AFTER 571 ms** — the packed path is
not a slowdown; the mode's item routing is skipped but the power search is the same work.

## The patch

`change.patch`: `PlacedUnit.powerSide`, `packedLine` and `placePacked` in `src/server/layout/arrange.ts`; the two
`powerSide ?? facing` reads in `src/server/layout/internal.ts` (`:335`, `:862`); the `SPIKE_PACKED` branch in
`buildLocalAt` in `src/server/layout/layout.ts`. 78 insertions, 8 deletions, 3 files.
