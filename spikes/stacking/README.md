# SP-D — stacking one single-block machine on another (spike, RUK-2878)

A measuring spike for M3 (RUK-2571): place a compatible 1×1×1 single-block machine on top of a compatible lower machine
in the same row and measure the result across `direct`, `routed`, `ae2` and `enderio`. **Nothing here is production
code**: `src/` and `tests/` are untouched on this branch. The prototype is `change.patch` (apply it against `src/` at
this branch's HEAD with `git apply spikes/stacking/change.patch`); it edits only `src/server/layout/arrange.ts`
(+36 / −5).

## What was measured

All 132 benchmark rows (33 lines × 4 modes, `tests/helpers/layout-bench.ts`) were laid with `layoutLine(...)` and
measured with `lengthOf(layout)` before and after the prototype. A temporary measuring test (never committed) captured
every `LayoutDeps.localLine` candidate and chose the candidate whose machine cells match the final world blocks, so
middle-head candidates are measured as laid rather than the first west-head candidate. Each row records the number of
machines on top of another machine and the machines starved by wiring (`!powered && tier <= feedTier`). `runBench()`
was timed three times. The BEFORE pass matches `tests/fixtures/layout-bench/baseline.json` on total, cable, pipe,
interfaces, chips, hookup, loss, unpowered, route failures, weak tiers, transformer count, size and warnings for all
132 rows; it has 0 stacked machines and 0 starved machines.

## Prototype rule

The prototype is deliberately simple. A unit may stand on the unit placed immediately before it in the same row only
when:

- the lower slot is on the floor (`y = 0`) and has nothing on top;
- both units are 1×1×1 single blocks, non-multiblock, non-manual, non-vented and non-benched;
- both have no fluid input and no fluid output, leaving the lower top free;
- both have the same feed tier.

The upper unit keeps the lower unit's `x` and row and takes `y = 1`. The row cursor, kept cells and reach do not advance,
so stacking shortens the line. Its `portSpacing` neighbourhood test is skipped: its item port is the cell at `y = 1`,
which is not the lower unit's item-port cell at `y = 0`. `emit` shifts every cell, port, reserved cell and machine block
of a stacked slot up by `y`, and the line height now counts placed blocks as well as reserved cells.

Only one layer is allowed; a stacked slot is never used as a lower slot. The prototype does not search for compatible
neighbours, so a non-stackable unit between two compatible units prevents the second stack.

## Results

| (132 rows, sums)       | BEFORE | AFTER | Δ      |
| -----------------------|-------:|------:|-------:|
| cable+block `total`    |  8 053 | 7 704 | −349   |
| `lossEUt`              | 45 936 |43 230 | −2 706 |
| unpowered machines     |    156 |   176 | +20    |
| starved by wiring      |      0 |    20 | +20    |
| machines on top        |      0 |   260 | +260   |
| footprint (`size[0]`)  |  1 180 | 1 082 | −98    |
| height (`size[1]`)     |    411 |   426 | +15    |

The stacking prototype is **not a clean win**: 65 machines per mode, 260 in all, are stacked and 98 footprint cells are
saved, but it starves 10 machines on both `loss-40 routed` and `loss-40 ae2` and adds `transformer_bank` warnings to
four more rows. 45 full-suite tests fail with the patch applied, listed below.

**Stacked rows:** 22 rows per mode (88 row-mode pairs); 65 stacked machines per mode.

### Sums per mode over the 33 lines (BEFORE → AFTER)

| mode    | total         | cable         | pipe       | iface     | chip      | hookup       | lossEUt          | unpowered   | starved   | routeFailed | footprint  |
| --------|--------------:|--------------:|-----------:|----------:|----------:|-------------:|-----------------:|------------:|----------:|------------:|-----------:|
| direct  | 1 813 → 1 814 | 975 → 948     | 278 → 294  |     0 → 0 |     0 → 0 | 560 → 572    | 10 724 → 10 321 |     39 → 39 |     0 → 0 |       2 → 2 | 269 → 256 |
| routed  | 2 293 → 2 117 | 1 216 → 1 043 | 173 → 174  |     0 → 0 | 307 → 307 | 597 → 593    | 12 244 → 11 294 |     39 → 49 |     0 → 10|       2 → 2 | 319 → 285 |
| ae2     | 2 187 → 2 010 | 1 216 → 1 043 | 146 → 146  | 228 → 228 |     0 → 0 | 597 → 593    | 12 244 → 11 294 |     39 → 49 |     0 → 10|       2 → 2 | 319 → 285 |
| enderio | 1 760 → 1 763 | 972 → 945     | 199 → 218  |     0 → 0 |     0 → 0 | 589 → 600    | 10 724 → 10 321 |     39 → 39 |     0 → 0 |       0 → 0 | 273 → 256 |

### Every row whose total, loss and/or unpowered count changed

88 of 132 rows changed.

| row | mode | stacked | total B→A | lossEUt B→A | unpowered B→A | length B→A | starved B→A |
|---|---:|---:|---:|---:|---:|---:|---:|
| fluid-02 | ae2 | 1 | 76→72 | 478→450 | 4→4 | 11→10 | 0→0 |
| fluid-02 | direct | 1 | 68→65 | 464→441 | 4→4 | 9→8 | 0→0 |
| fluid-02 | enderio | 1 | 57→56 | 464→441 | 4→4 | 9→8 | 0→0 |
| fluid-02 | routed | 1 | 80→77 | 478→450 | 4→4 | 11→10 | 0→0 |
| fluid-03 | ae2 | 2 | 62→60 | 82→76 | 0→0 | 12→10 | 0→0 |
| fluid-03 | direct | 2 | 54→55 | 74→72 | 0→0 | 10→9 | 0→0 |
| fluid-03 | enderio | 2 | 54→55 | 74→72 | 0→0 | 10→9 | 0→0 |
| fluid-03 | routed | 2 | 65→63 | 82→76 | 0→0 | 12→10 | 0→0 |
| fluid-04 | ae2 | 1 | 77→74 | 174→168 | 0→0 | 12→11 | 0→0 |
| fluid-04 | direct | 1 | 68→68 | 164→160 | 0→0 | 10→10 | 0→0 |
| fluid-04 | enderio | 1 | 58→58 | 164→160 | 0→0 | 10→10 | 0→0 |
| fluid-04 | routed | 1 | 79→76 | 174→168 | 0→0 | 12→11 | 0→0 |
| fluid-09 | ae2 | 1 | 50→49 | 563→562 | 5→5 | 9→8 | 0→0 |
| fluid-09 | direct | 1 | 40→39 | 525→537 | 5→5 | 6→5 | 0→0 |
| fluid-09 | enderio | 1 | 34→34 | 525→537 | 5→5 | 6→5 | 0→0 |
| fluid-09 | routed | 1 | 54→53 | 563→562 | 5→5 | 9→8 | 0→0 |
| loss-10 | ae2 | 4 | 53→53 | 290→262 | 0→0 | 5→5 | 0→0 |
| loss-10 | direct | 4 | 35→36 | 252→242 | 0→0 | 5→7 | 0→0 |
| loss-10 | enderio | 4 | 41→45 | 252→242 | 0→0 | 9→7 | 0→0 |
| loss-10 | routed | 4 | 56→56 | 290→262 | 0→0 | 5→5 | 0→0 |
| loss-20 | ae2 | 9 | 119→73 | 636→588 | 0→0 | 5→5 | 0→0 |
| loss-20 | direct | 9 | 48→51 | 580→524 | 0→0 | 5→5 | 0→0 |
| loss-20 | enderio | 9 | 57→60 | 580→524 | 0→0 | 5→5 | 0→0 |
| loss-20 | routed | 9 | 122→76 | 636→588 | 0→0 | 5→5 | 0→0 |
| loss-40 | ae2 | 18 | 232→150 | 2052→1687 | 0→10 | 5→5 | 0→10 |
| loss-40 | direct | 18 | 117→110 | 1224→1120 | 0→0 | 5→5 | 0→0 |
| loss-40 | enderio | 18 | 131→120 | 1224→1120 | 0→0 | 5→5 | 0→0 |
| loss-40 | routed | 18 | 235→153 | 2052→1687 | 0→10 | 5→5 | 0→10 |
| mixed-00 | ae2 | 3 | 79→74 | 301→255 | 0→0 | 16→13 | 0→0 |
| mixed-00 | direct | 3 | 65→65 | 268→238 | 0→0 | 12→11 | 0→0 |
| mixed-00 | enderio | 3 | 65→65 | 268→238 | 0→0 | 12→11 | 0→0 |
| mixed-00 | routed | 3 | 82→77 | 301→255 | 0→0 | 16→13 | 0→0 |
| mixed-01 | ae2 | 1 | 40→38 | 399→374 | 3→3 | 8→7 | 0→0 |
| mixed-01 | direct | 1 | 36→37 | 387→369 | 3→3 | 7→7 | 0→0 |
| mixed-01 | enderio | 1 | 36→37 | 387→369 | 3→3 | 7→7 | 0→0 |
| mixed-01 | routed | 1 | 43→41 | 399→374 | 3→3 | 8→7 | 0→0 |
| mixed-03 | ae2 | 1 | 69→66 | 196→196 | 0→0 | 11→10 | 0→0 |
| mixed-03 | direct | 1 | 65→66 | 192→192 | 0→0 | 10→9 | 0→0 |
| mixed-03 | enderio | 1 | 65→66 | 192→192 | 0→0 | 10→9 | 0→0 |
| mixed-03 | routed | 1 | 72→69 | 196→196 | 0→0 | 11→10 | 0→0 |
| mixed-05 | ae2 | 3 | 46→43 | 657→628 | 4→4 | 10→7 | 0→0 |
| mixed-05 | direct | 3 | 35→36 | 614→608 | 4→4 | 6→5 | 0→0 |
| mixed-05 | enderio | 3 | 35→36 | 614→608 | 4→4 | 6→5 | 0→0 |
| mixed-05 | routed | 3 | 49→46 | 657→628 | 4→4 | 10→7 | 0→0 |
| mixed-06 | ae2 | 1 | 56→54 | 119→116 | 0→0 | 10→9 | 0→0 |
| mixed-06 | direct | 1 | 54→54 | 118→116 | 0→0 | 9→9 | 0→0 |
| mixed-06 | enderio | 1 | 54→54 | 118→116 | 0→0 | 9→9 | 0→0 |
| mixed-06 | routed | 1 | 59→57 | 119→116 | 0→0 | 10→9 | 0→0 |
| mixed-07 | ae2 | 1 | 64→62 | 251→245 | 0→0 | 11→10 | 0→0 |
| mixed-07 | direct | 1 | 63→62 | 249→245 | 0→0 | 11→10 | 0→0 |
| mixed-07 | enderio | 1 | 63→62 | 249→245 | 0→0 | 11→10 | 0→0 |
| mixed-07 | routed | 1 | 67→65 | 251→245 | 0→0 | 11→10 | 0→0 |
| mixed-08 | ae2 | 3 | 95→90 | 395→380 | 0→0 | 16→13 | 0→0 |
| mixed-08 | direct | 3 | 83→85 | 368→367 | 0→0 | 13→12 | 0→0 |
| mixed-08 | enderio | 3 | 83→85 | 368→367 | 0→0 | 13→12 | 0→0 |
| mixed-08 | routed | 3 | 98→93 | 395→380 | 0→0 | 16→13 | 0→0 |
| mixed-09 | ae2 | 1 | 34→33 | 381→391 | 3→3 | 6→5 | 0→0 |
| mixed-09 | direct | 1 | 29→30 | 361→381 | 3→3 | 4→4 | 0→0 |
| mixed-09 | enderio | 1 | 29→30 | 361→381 | 3→3 | 4→4 | 0→0 |
| mixed-09 | routed | 1 | 37→36 | 381→391 | 3→3 | 6→5 | 0→0 |
| mixed-10 | ae2 | 4 | 79→70 | 977→807 | 5→5 | 14→10 | 0→0 |
| mixed-10 | direct | 4 | 64→62 | 858→770 | 5→5 | 10→8 | 0→0 |
| mixed-10 | enderio | 4 | 64→62 | 858→770 | 5→5 | 10→8 | 0→0 |
| mixed-10 | routed | 4 | 82→73 | 977→807 | 5→5 | 14→10 | 0→0 |
| mixed-11 | ae2 | 1 | 60→58 | 103→100 | 0→0 | 11→10 | 0→0 |
| mixed-11 | direct | 1 | 56→56 | 100→98 | 0→0 | 10→9 | 0→0 |
| mixed-11 | enderio | 1 | 56→56 | 100→98 | 0→0 | 10→9 | 0→0 |
| mixed-11 | routed | 1 | 63→61 | 103→100 | 0→0 | 11→10 | 0→0 |
| mixed-13 | ae2 | 2 | 44→42 | 114→109 | 0→0 | 9→7 | 0→0 |
| mixed-13 | direct | 2 | 38→38 | 106→105 | 0→0 | 7→6 | 0→0 |
| mixed-13 | enderio | 2 | 38→38 | 106→105 | 0→0 | 7→6 | 0→0 |
| mixed-13 | routed | 2 | 47→45 | 114→109 | 0→0 | 9→7 | 0→0 |
| mixed-14 | ae2 | 2 | 39→35 | 327→297 | 2→2 | 7→5 | 0→0 |
| mixed-14 | direct | 2 | 31→31 | 291→286 | 2→2 | 5→4 | 0→0 |
| mixed-14 | enderio | 2 | 31→31 | 291→286 | 2→2 | 5→4 | 0→0 |
| mixed-14 | routed | 2 | 42→38 | 327→297 | 2→2 | 7→5 | 0→0 |
| mixed-17 | ae2 | 2 | 55→56 | 423→339 | 1→1 | 10→8 | 0→0 |
| mixed-17 | direct | 2 | 50→54 | 381→334 | 1→1 | 8→7 | 0→0 |
| mixed-17 | enderio | 2 | 50→54 | 381→334 | 1→1 | 8→7 | 0→0 |
| mixed-17 | routed | 2 | 58→59 | 423→339 | 1→1 | 10→8 | 0→0 |
| mixed-18 | ae2 | 1 | 49→48 | 477→485 | 2→2 | 10→9 | 0→0 |
| mixed-18 | direct | 1 | 42→43 | 450→462 | 2→2 | 7→7 | 0→0 |
| mixed-18 | enderio | 1 | 42→43 | 450→462 | 2→2 | 7→7 | 0→0 |
| mixed-18 | routed | 1 | 52→51 | 477→485 | 2→2 | 10→9 | 0→0 |
| mixed-19 | ae2 | 3 | 65→66 | 663→593 | 3→3 | 12→9 | 0→0 |
| mixed-19 | direct | 3 | 61→60 | 610→566 | 3→3 | 9→8 | 0→0 |
| mixed-19 | enderio | 3 | 61→60 | 610→566 | 3→3 | 9→8 | 0→0 |
| mixed-19 | routed | 3 | 68→69 | 663→593 | 3→3 | 12→9 | 0→0 |

### Warning-code deltas

No warning code disappears; two codes appear that were not present BEFORE:

```text
machine_unpowered   0 → 1 routed, 0 → 1 ae2
transformer_bank   0 → 2 routed, 0 → 2 ae2
```

Affected rows (AFTER codes in addition to their BEFORE codes):

| row     | mode   | stacked | new codes |
| --------|--------|--------:|-----------|
| loss-20 | routed |       9 | `transformer_bank` |
| loss-20 | ae2    |       9 | `transformer_bank` |
| loss-40 | routed |      18 | `machine_unpowered`, `transformer_bank` |
| loss-40 | ae2    |      18 | `machine_unpowered`, `transformer_bank` |

The full per-mode warning-code counts are:

```text
direct  cable_amps=32/32 cable_loss_high=30/30 no_path=30/30 power_tier_low=13/13
        route_failed=2/2 terrain_unknown=30/30 transformer_bank=2/2
routed  cable_amps=32/32 cable_loss_high=30/30 machine_unpowered=0/1 no_path=30/30
        power_tier_low=13/13 route_failed=2/2 routed_missing=30/30 terrain_unknown=30/30
        transformer_bank=0/2
ae2     ae2_missing=30/30 ae2_no_pattern=5/5 cable_amps=32/32 cable_loss_high=30/30
        machine_unpowered=0/1 no_path=30/30 power_tier_low=13/13 route_failed=2/2
        terrain_unknown=30/30 transformer_bank=0/2
enderio cable_amps=32/32 cable_loss_high=30/30 no_path=30/30 power_tier_low=13/13
        terrain_unknown=30/30 transformer_bank=2/2
```

### Starving and unpowered machines

The prototype creates starved machines on two rows:

| row     | mode   | starved | stacked | lossEUt | unpowered | weakTiers | transformers |
| --------|--------|---------|--------:|---------:|----------:|-----------|-------------:|
| loss-40 | routed |   0 → 10 |     18 | 2 052 → 1 687 |   0 → 10 | [] → [1] | 10 → 2 |
| loss-40 | ae2    |   0 → 10 |     18 | 2 052 → 1 687 |   0 → 10 | [] → [1] | 10 → 2 |

The 156 pre-existing unpowered machines remain exactly where they were. The only increases are the 10 newly starved
machines on each of the two rows above (20 in total). This is the prototype's clearest rule break: the benchmark
`m2-verify` promise "no benchmark row starves a machine" fails on `loss-40 routed`.

### Cell inspection: one stacked pair per mode

The probe inspected the chosen final layout of the first stacked pair on `loss-10` for each mode. In every case the
upper machine's `down` cell in the final layout is the lower machine. `tierContacts(blocks, cables, placement)` returned
no contacts in all 28 rows probed (`loss-10`, `loss-20`, `loss-40`, `mixed-10`, `mixed-05`, `fluid-02` and `fluid-09`
in all four modes).

#### `loss-10 direct`

Upper local `[3, 1, 1]`, upper world `[20, 65, 19]`; lower world `[20, 64, 19]` is `machine Basic Macerator`.

| world cell | final cell |
| ------------|------------|
| `[20, 64, 19]` | `machine Basic Macerator` (lower) |
| `[20, 65, 18]` | `cable 4x Tin Cable` (upper power port) |
| `[20, 65, 19]` | `machine Basic Macerator` (upper) |
| `[20, 65, 20]` | `pipe Tin Item Pipe` (upper item port) |
| `[20, 65, 21]` | `machine Basic Macerator` |

#### `loss-10 routed`

Upper local `[3, 1, 1]`, upper world `[19, 65, 21]`; lower world `[19, 64, 21]` is `machine Basic Macerator`.

| world cell | final cell |
| ------------|------------|
| `[19, 64, 21]` | `machine Basic Macerator` (lower) |
| `[19, 65, 19]` | `machine Basic Macerator` (west neighbour at same y) |
| `[18, 65, 21]` | `cable 4x Tin Cable` (upper power port) |
| `[19, 65, 21]` | `machine Basic Macerator` (upper) |
| `[20, 65, 21]` | `chip_pipe Routed Interface Pipe (Basic Macerator)` (upper item port) |

#### `loss-10 ae2`

Upper local `[3, 1, 1]`, upper world `[19, 65, 21]`; lower world `[19, 64, 21]` is `machine Basic Macerator`.

| world cell | final cell |
| ------------|------------|
| `[19, 64, 21]` | `machine Basic Macerator` (lower) |
| `[19, 65, 19]` | `machine Basic Macerator` (west neighbour at same y) |
| `[18, 65, 21]` | `cable 4x Tin Cable` (upper power port) |
| `[19, 65, 21]` | `machine Basic Macerator` (upper) |
| `[20, 65, 21]` | `interface ME Interface (Basic Macerator)` (upper item port) |

#### `loss-10 enderio`

Upper local `[3, 1, 1]`, upper world `[20, 65, 19]`; lower world `[20, 64, 19]` is `machine Basic Macerator`.

| world cell | final cell |
| ------------|------------|
| `[20, 64, 19]` | `machine Basic Macerator` (lower) |
| `[20, 65, 18]` | `cable 4x Tin Cable` (upper power port) |
| `[20, 65, 19]` | `machine Basic Macerator` (upper) |
| `[20, 65, 20]` | `pipe Item Conduit` (upper item port) |
| `[20, 65, 21]` | `machine Basic Macerator` |

### Timing

`runBench()` was run three times with the prototype applied:

```text
BEFORE: 549 / 548 / 537 ms, median 548 ms
AFTER:  550 / 545 / 526 ms, median 545 ms
probe:  547 / 540 / 526 ms, median 540 ms
```

The change is within run-to-run noise on this machine; the prototype's extra candidate-local placement work is not a
measurable `runBench()` cost.

## Full suite with the prototype applied

Command:

```sh
perl -e 'alarm shift; exec @ARGV' 900 npm test
```

Result of `npm test` with the prototype patch applied and the temporary spike test removed:

```text
files 296  tests 4677  failed 45  passed 4366  pending 0  todo 0
```

| failing file | failures | what the prototype changes |
| ------------|---------:| ----------------------------|
| `tests/client/m1-verify-panel.test.tsx` | 1 | chosen-loss-row panel data, `loss-10 enderio` row set changes |
| `tests/unit/layout/arrange.test.ts` | 3 | placement positions and unit counts per row change when a unit takes no column |
| `tests/unit/layout/head-choice.test.ts` | 2 | the 40-machine direct/enderio middle head no longer wins |
| `tests/unit/layout/internal.test.ts` | 1 | `loss-40 ae2` gains a `machine_unpowered` warning |
| `tests/unit/layout/layout-bench.test.ts` | 3 | `loss-10` totals grow and `loss-40 ae2` gains weak tier 1; the no-row-gets-worse invariant fails |
| `tests/unit/layout/m1-verify.test.ts` | 1 | `loss-40 ae2` starves machines |
| `tests/unit/layout/m2-verify.test.ts` | 1 | `loss-40 routed` starves 10 machines, breaking the M2 promise |
| `tests/unit/layout/middle-head.test.ts` | 2 | middle-head size and loss-path assertions change |
| `tests/unit/layout/mode-direct.test.ts` | 5 | direct pipe, cover, chest, filter and hookup positions change |
| `tests/unit/layout/mode-enderio.test.ts` | 3 | conduit filters, chest tap and channel behaviour change |
| `tests/unit/layout/mode-network.test.ts` | 2 | routed interface and AE2 interface positions/counts change |
| `tests/unit/layout/satellites.test.ts` | 19 | stacking changes starved counts so satellite tests lay no satellites / see unexpected baseline starved counts |
| `tests/unit/layout/score.test.ts` | 1 | 10 `loss-40 ae2` macerators remain unpowered after satellite expectations |
| `tests/unit/planner/build-acceptance.test.ts` | 1 | Project Red line's per-step interface placement changes |

`npx tsc -b` passes with the prototype applied.

## What the prototype changes in the code

`change.patch` edits only `src/server/layout/arrange.ts`:

- `PlacedSlot` gains `y: 0 | 1`.
- `stackable(u)` tests the 1×1×1, single-block, no-fluid, no-manual/vent/bench/multiblock condition.
- `placeSide` tracks `lastSlot[row]` and a `topped` set. A compatible next unit occupies the last slot's column at `y = 1`,
  marks the lower column topped, and continues without advancing `cursor[row]`.
- The normal path records the floor slot at `y = 0`.
- `emit` applies the slot's `y` in its local `pos` mapping, so all cells, ports and reserved cells of the upper unit
  shift up one layer.
- `placeUnits` height calculation includes placed block `y` values, so the site box grows from height 1 to 2 (and
  accordingly in the loss lines).

## Limitations for M3 design

- The prototype is a local greedy rule, not a placement optimiser: only the immediately preceding unit can be stacked,
  and a non-stackable unit between compatible machines blocks stacking.
- Only one machine layer is supported.
- The prototype stacks purely on local slot compatibility; it does not know the loss, transformer stage, cable reach or
  item-network topology that changes on the loss lines. The `loss-40 routed/ae2` result shows why placement and power
  planning cannot remain decoupled.
- `direct` and `enderio` total counts increase slightly even though footprint falls: shorter rows shift routing work to
  pipes, item conduits, hookups and ports, so cable saved is partly paid in item logistics.
- `portSpacing` is not rechecked for the stacked unit. The prototype relies on `unitPorts` placing the stacked unit's
  item port at `y = 1`; the probe confirms the observed ports occupy distinct cells. A production rule should make that
  dependency explicit and test all mode-specific item handling.
- The full-suite result is the strongest signal: the spike changes layout invariants relied on by 14 test files, so
  M3 cannot adopt this prototype as a local tweak without redefining benchmark expectations and power/satellite planning.

## Reproducing

```sh
git apply spikes/stacking/change.patch
# BEFORE/AFTER rows: run a temporary vitest file that lays all 132 rows, records lengthOf(),
# warnings, starved count and stacked units, and times runBench() three times.
# The chosen local candidate is the one whose machine cells match the final world blocks.
npx vitest run tests/unit/layout
perl -e 'alarm shift; exec @ARGV' 900 npm test
npx tsc -b
git checkout -- src
```
