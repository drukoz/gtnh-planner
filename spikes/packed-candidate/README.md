# Probe: the packed line as a search candidate (RUK-2877, CTO, 2026-11-18)

`probe.patch` (on `feat/optimal-layout-m3` at `9421dfde3`) adds `CandidateKind.Packed = 3` and lays one packed
candidate (`placePacked`, west head only) in `buildLocal` when the mode is `direct` or `enderio`, `packedLine(units)`
holds and every electric unit has the same feed tier (`Math.min(u.tier, supplyTier)`). `PROBE_PACKED=0` turns it off.
It also generalises the power check in `tests/unit/layout/layout.test.ts` (see "Tests it re-pins"). M3-P2 turns this
into the real change, with a `LayoutDeps.packing` switch instead of the environment variable.

## Benchmark (132 rows)

6 rows change, all better, none worse; no row gains or loses a warning code. Per mode, total and loss:
direct 1 806 → 1 801, 10 521 → 10 477; enderio 1 755 → 1 750, 10 521 → 10 477; routed and AE2 unchanged
(they get no packed candidate).

| row | chosen kind | total | cable | pipe | hookup | lossEUt | size |
|---|---|---|---|---|---|---|---|
| mixed-05 direct, enderio | WestHead → Packed | 35 → 34 | 13 → 6 | 5 → 9 | 17 → 19 | 614 → 585 | 6x1x5 → 6x2x3 |
| mixed-13 direct, enderio | Stacked → Packed | 38 → 34 | 15 → 8 | 4 → 7 | 19 → 19 | 105 → 93 | 6x2x5 → 7x2x3 |
| mixed-14 direct, enderio | Stacked → Packed | 31 → 31 | 10 → 5 | 4 → 7 | 17 → 19 | 286 → 283 | 4x2x5 → 5x2x3 |

`loss-10` and `mixed-09` (direct, enderio): the search ranks the packed line best, but its finished layout is worse
than the baseline's, so `finalReplaces` keeps the baseline (`search.rejected` is the packed index).

## Why the loss lines do not take it: the transformer bank has no room

On `loss-20` and `loss-40` the packed line is far shorter in-line, but it leaves more transformers to place by
hand, and `compareScore` ranks `handTransformers` before everything but `unwired`:

| line (direct = enderio) | baseline: hand transformers, total, loss | packed: hand transformers, total, loss |
|---|---|---|
| loss-10 | 0, 26, 198 | 2, 21, 116 |
| loss-20 | 5, 41, 496 | 7, 30, 298 |
| loss-40 | 5, 115, 1 100 | 17, 51, 862 |

The cause is `bankRows` (`src/server/layout/internal.ts:500`): a bank places at most one transformer per row of the
box's depth (`placed = Math.min(count, length)` at the west head). A packed box is 3 deep, so a bank holds at most 3
transformers; `loss-40` needs 20. Stacked candidates hit the same limit (stacked `loss-40` west head: 14 by hand).
Today only 4 of 132 rows leave transformers by hand (`loss-20`, `loss-40` in direct and EnderIO). Spike SP-H
measures a bank with room for them.

## Tests it re-pins (full suite with the probe: 3 files, 6 tests)

- `tests/unit/layout/layout.test.ts`, the two random mixed-tier tests: `powerProblems` looks for the power cable
  only behind the machine (`step(m.pos, OPPOSITE[m.facing])`). A packed machine takes its power through `powerSide`
  (A from the south, B from the north, T from below), which GT allows: energy passes any face but the front
  (`docs/research/gt-mechanics.md:478`). With the check generalised to "a cable of the feed tier on a face other than
  `mainFacing`, linked into the machine", the file passes, so the packed lines are wired right.
- `tests/unit/layout/head-choice.test.ts`, 40 direct and 40 enderio, and `tests/unit/layout/satellites.test.ts`,
  "the 40-machine direct/enderio line keeps today's layout with the switch off": with satellites off, the packed
  line starves 0 machines where today's middle head starves 7, so it wins. These tests pin today's head rule and
  already pass `stacking: false`; they need `packing: false` too.

Not caught by any test but wrong for packed lines: `tierContacts` in `tests/helpers/power-loss.ts` finds each
machine at `step(u.ports.power, u.facing)`; it must use `u.powerSide`.

## A packed line with two or three products (the tail column)

6 macerators, one step making `t:o0@0`, `t:o1@0` (and `t:o2@0`), each flowing to `out`, on `lossScan`/`lossGround`:
the packed line is chosen in both modes, with no overlaps, no tier contacts and no warning beyond the cable ones the
one-product line has too. Direct, two products, world positions (origin `17,64,19`, rotation 0): input chest
`22,64,21` (`{ side: 'input', keys: ['t:in@0'] }`), output chests `23,65,21` (`['t:o0@0']`) and `23,66,21`
(`['t:o1@0']`); the layout is `7x3x3`, total 26 against 31 unpacked. Three products add `23,67,21` (`['t:o2@0']`),
size `7x4x3`. EnderIO keeps one output chest holding every product (`21,65,17`).
