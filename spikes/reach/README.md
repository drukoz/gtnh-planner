# Reach in the score (RUK-2877, design goal 3): CTO probe, 2026-11-18

Design goal 3 (`docs/superpowers/specs/2026-10-23-shorter-layouts-design.md`, "Reach"): every machine keeps at least
one face next to an air cell that connects to the outside, from a side, above or below. The anti-goals call "a machine
the player cannot reach" a failure even if it technically works.

## Two readings, measured on the 132 benchmark layouts (`bench-reach.txt`)

The probe flood-fills air from the edge of each finished layout's box grown by one (the ground under the floor is
solid) and checks every `machine` block (a singleblock, or a multiblock's controller) for a face onto that air.

| reading | unreachable machines (of 944) | where |
|---|---|---|
| strict: the neighbour cell must be air | 113 | 64 under stacked machines, 33 on today's rows (multiblock controllers facing the spine, fluid machines under their pipes), 8 packed AE2 |
| **thin blocks count**: the neighbour is air, or a cable, pipe, conduit or chip pipe whose own cell touches outside air (a builder clicks past it) | **14** | all AE2: 8 top machines of the packed AE2 column (RUK-3005), 6 multiblock controllers behind full-block ME Interfaces on today's AE2 rows |

We use the second reading (plan Assumption 8). The strict one would condemn today's rows, which the user builds.
Full blocks close a face: machines, casings, hatches, transformers, ME Interfaces and chests.

## Why the packed AE2 column fails it

`PACKED_SLOTS_AE2` (`arrange.ts`): A `[x,0,0]` with its interface at `[x,1,0]`, B `[x,0,2]` with its interface at
`[x,1,2]`, and T `[x,1,1]` with its interface at `[x,2,1]`. T's six neighbours are three full ME Interfaces (north,
south, up), the cable cell below, and the T of the next column on each side. Only the Ts of the first and last columns
keep an air face, so a packed AE2 line of 7 or more machines shuts its middle Ts in.

## The prototype (`change.patch`, on `feat/optimal-layout-m3` at `36040b251`+M3-P3/P4, i.e. `dabb83d97`)

- `src/server/layout/reach.ts` (new): `THIN_ROLES` and `unreachableMachines(blocks)` over a line's local blocks (floor
  at y 0).
- `LineScore.unreachable`, filled by `scoreLine`. `compareScore`: unwired, **unreachable**, any hand transformer,
  unpowered, hand-transformer count, total, loss, volume. `replacesBaseline` refuses a candidate with more unreachable
  machines than the baseline, and lets one with fewer replace it even when longer.
- `FinalMeasure.unreachable` (from the local line's score; `finalMeasure(layout, unreachable)`) and `finalReplaces`
  with the same two rules, so the finished-layout check cannot put an unreachable line back.

## What it moves (whole suite, `npx vitest run`)

Every candidate's score on the four AE2 loss rows it touches is in `ae2-candidates.txt`. Packed AE2 loses on reach
alone: it is better or equal on every other field. Unreachable on the packed candidate: `loss-10` 2, `loss-20` 5,
`loss-40` 12, `mixed-05` 1; `lossLine(4..6, 'ae2')` 0 (still packed), `lossLine(7, 'ae2')` 1.

Benchmark rows that go up (the search keeps a reachable line instead), none in direct, EnderIO or routed:

| row | total | loss EU/t |
|---|---|---|
| loss-10 ae2 | 44 → 53 | 164 → 262 |
| loss-20 ae2 | 54 → 73 | 394 → 536 |
| mixed-05 ae2 | 38 → 43 | 585 → 628 |

AE2 total 2 053 → 2 086. `mixed-09`, `mixed-13` and `mixed-14` stay packed (no T is shut in). No `unpowered`,
`routeFailed` or weak-tier value changes in the benchmark.

Tests that move: `score.test.ts` (the field list at :77, and the `measure()` helper of the `finalReplaces` test at :96,
which needs `unreachable: 0`), `packed.test.ts:53` (the 40-machine AE2 line is no longer laid packed),
`layout-bench.test.ts:29` (same line: stacked, weak tier `[1]`, 1 `machine_unpowered` warning) and the ratchet with
`baseline.json`. `layout.test.ts:455` timed out once at 20 s (the known M3-V flake), not a reach failure.

On `lossLine(40, 'ae2')` (satellites off) the trade is plain: the packed line powers all 40 machines and shuts 12 in;
the stacked line the search now keeps reaches every machine and leaves 1 starved once finished. Spike SP-I looks for an
AE2 column that does both.
