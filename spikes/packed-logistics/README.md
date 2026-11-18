# Spike SP-F: packed item logistics for `direct` and `enderio` (RUK-2900)

Parent: RUK-2900 (M3 optimal layout), on top of spike SP-E (`spikes/shared-cable`).

A packed line (SP-E) stacks machines three deep on one cable lane. This spike lays its **item logistics**: the two
lanes `[x, 1, 0]` and `[x, 1, 2]` run `firstX … tailX`, join at `[tailX, 1, 1]`, and end at the tail cell
`[tailX, 1, 2]` — the south lane's end cell, on the box's face — with the input chest below it at `[tailX, 0, 2]` and
output chest *i* east of the rising tail column at `[tailX + 1, 1 + i, 2]`. The prototype is `change.patch` next to
this file; it **includes SP-E's lines** (`placePacked`, `packedLine`, `PlacedUnit.powerSide`, the `SPIKE_PACKED`
switch) and applies to a clean tree on its own. `src/` in the committed tree is untouched.

## Verdict

**Promote.** Over the 14 qualifying rows (7 lines × `direct` + `enderio`) the laid packed logistics cut total
block count **695 → 526 (−24.3%)** — `loss-40` alone goes 117 → 55 (`direct`) and 131 → 59 (`enderio`). Every row
connects with **zero connection offenders and zero tier contacts**, and no row gains a warning code except
`transformer_bank` on `loss-10` — a power code the packed lane brings, explained under "What the spike found". Three
conditions carry over from the spike:

1. **The logistics port must sit on the box's face.** A logistics hookup goes *round* the line's box and never enters
   its columns (`inColumns`, `src/server/layout/hookups.ts:96-110`). The spec's chest below the join cell
   `[tailX, 1, 1]` stands in an interior column and failed with `no_path` on every `enderio` row; hanging it below
   the tail cell `[tailX, 1, 2]` (same lane, box face) routes it with **zero extra blocks**.
2. **Skip `itemRisers` when a spine is laid.** The committed modes' risers climb the spine column at `spineZ` to
   y-1 buses; a packed line's ports are the lane cells at y 1, and the risers would link the lane to cells no machine
   touches. The prototype passes `{ cells: [], ports: [], links: [] }` for risers when `placement.spine` is set.
3. **Packing pays from ~10 units up.** A packed line lays its lanes in every column, so a small line buys pipes it
   does not use: `mixed-09` (5 units, 3 risers) costs **+2** blocks. From `loss-10` (10 units) up the delta is
   −5 … −72 (see the table).

## What was measured

A temporary harness (`tests/unit/layout/tmp-spike.test.ts`, not committed) lays all 33 `benchLines()` lines in
`direct` and `enderio` through `layoutLine` — 66 rows — with `lengthOf(layout)` per row (`total` = cable + pipe +
interface + chip + hookup blocks; chest and transformer are reported alongside, never counted). BEFORE is the SP-E
patch only (`SPIKE_PACKED` unset: normal placement, the modes' own logistics); AFTER is `SPIKE_PACKED=1`: the packed
placement with the lanes laid. A row qualifies when `packedLine(placement.units)` holds and all its electric units
share one feed tier (`Math.min(u.tier, stages.supplyTier)`). 14 rows qualify:

`loss-10, loss-20, loss-40, mixed-05, mixed-09, mixed-13, mixed-14` — in `direct` and `enderio`

Each AFTER row is checked three ways, all **0 on every qualifying row**:

- **machine port cell not laid** — every `ports.items` cell, rotated into the world, is a laid block;
- **links end on laid blocks** — every set bit of a block's `connections` faces a laid block, and every laid pipe has
  a link to a laid pipe. Blocks carrying `hookup` are exempt: a hookup's last link runs to the base tap, a block the
  export never lays (this dangling link exists in BEFORE too — the committed rows show the same single offender);
- **tier contacts** — `tierContacts(internal.blocks, internal.cables, placement)` over the packed power.

## Per-row totals (BEFORE → AFTER)

`pipe` counts the mode's item blocks: the GT pipes / EnderIO conduits of the spine, risers and tail, per `lengthOf`.

| line | mode | total | cable | pipe | chest | hook | size |
|---|---|---|---|---|---|---|---|
| loss-10 | direct | 35 → **30** | 20 → 10 | 6 → 11 | 2 → 2 | 9 → 9 | 5x1x9 → 3x2x9 |
| loss-10 | enderio | 41 → **39** | 20 → 10 | 6 → 11 | 2 → 2 | 15 → 18 | 9x1x5 → 3x2x9 |
| loss-20 | direct | 48 → **38** | 30 → 13 | 11 → 17 | 2 → 2 | 7 → 8 | 5x1x14 → 3x2x12 |
| loss-20 | enderio | 57 → **45** | 30 → 13 | 11 → 17 | 2 → 2 | 16 → 15 | 5x1x14 → 3x2x12 |
| loss-40 | direct | 117 → **55** | 94 → 20 | 21 → 31 | 2 → 2 | 2 → 4 | 5x4x24 → 3x2x19 |
| loss-40 | enderio | 131 → **59** | 94 → 20 | 21 → 31 | 2 → 2 | 16 → 8 | 5x4x24 → 3x2x19 |
| mixed-05 | direct | 35 → **34** | 13 → 6 | 5 → 9 | 2 → 2 | 17 → 19 | 6x1x5 → 6x2x3 |
| mixed-05 | enderio | 35 → **34** | 13 → 6 | 5 → 9 | 2 → 2 | 17 → 19 | 6x1x5 → 6x2x3 |
| mixed-09 | direct | 29 → 31 | 9 → 5 | 3 → 7 | 2 → 2 | 17 → 19 | 4x1x5 → 5x2x3 |
| mixed-09 | enderio | 29 → 31 | 9 → 5 | 3 → 7 | 2 → 2 | 17 → 19 | 4x1x5 → 5x2x3 |
| mixed-13 | direct | 38 → **34** | 15 → 8 | 4 → 7 | 2 → 2 | 19 → 19 | 7x1x5 → 7x2x3 |
| mixed-13 | enderio | 38 → **34** | 15 → 8 | 4 → 7 | 2 → 2 | 19 → 19 | 7x1x5 → 7x2x3 |
| mixed-14 | direct | 31 → 31 | 10 → 5 | 4 → 7 | 2 → 2 | 17 → 19 | 5x1x5 → 5x2x3 |
| mixed-14 | enderio | 31 → 31 | 10 → 5 | 4 → 7 | 2 → 2 | 17 → 19 | 5x1x5 → 5x2x3 |

### Power, warnings, and the replace rule

`lossEUt`, `unpowered` and `routeFailed` are mode-independent on these rows — the packed logistics touch no power
block — so one row per line covers both modes. Replace rule: AFTER has no more `routeFailed`, and fewer `unpowered`,
or as many with `total` and `lossEUt` both no higher.

| line | lossEUt | unpowered | routeFailed | replaces BEFORE |
|---|---|---|---|---|
| loss-10 | 252 → 170 | 0 → 0 | 0 → 0 | yes |
| loss-20 | 580 → 394 | 0 → 0 | 0 → 0 | yes |
| loss-40 | 1224 → 958 | 0 → 0 | 0 → 0 | yes |
| mixed-05 | 614 → 585 | 4 → 4 | 0 → 0 | yes |
| mixed-09 | 361 → 362 | 3 → 3 | 0 → 0 | **NO** (total +2, lossEUt +1) |
| mixed-13 | 106 → 93 | 0 → 0 | 0 → 0 | yes |
| mixed-14 | 291 → 283 | 2 → 2 | 0 → 0 | yes |

`mixed-09` is the only row the rule rejects, and it fails on both counts — the packed line is not a drop-in for a
5-unit line under the rule as written (see Regressions).

### Sums over the 14 qualifying rows, per mode

| mode | total | cable | pipe | chest | hook |
|---|---|---|---|---|---|
| direct | 333 → 253 (−24.0%) | 191 → 67 | 54 → 89 | 14 → 14 | 88 → 97 |
| enderio | 362 → 273 (−24.6%) | 191 → 67 | 54 → 89 | 14 → 14 | 117 → 117 |

The columns deliberately do not add to `total`: `lengthOf` counts `cable + pipe + interface + chip + hookup`, with
`chest` and `transformer` reported alongside (`tests/helpers/layout-bench.ts:69-83`).

Combined **695 → 526 (−24.3%)**; over all 66 rows **3,573 → 3,404 (−4.7%)** (the other rows are unchanged, the gate
leaving them on the committed path). Pipes rise 108 → 178 on qualifying rows — the lanes cover every column — while
cable (the SP-E lane) and the modes' per-unit risers and long hookups fall far more.

## The laid line: `loss-10 direct` (AFTER)

The line exports at `origin 19,64,16`, `rotation 270`, so world cells are rotated; cells below are the placement's
**local** cells, and a block's `connections` bits are the rotated (world) bits.
`tail={"cell":[7,1,2],"inputSide":0,"outputSide":5}`,
`spine` = `[3,1,0]…[7,1,0]`, `[7,1,1]`, `[7,1,2]…[3,1,2]`.

First two columns (local x 3…4):

```
local 3,0,0  machine Basic Macerator   facing UP/NORTH   step s1
local 3,0,1  cable   4x Tin Cable
local 3,0,2  machine Basic Macerator   facing UP/SOUTH   step s1
local 3,1,0  pipe    Tin Item Pipe
local 3,1,1  machine Basic Macerator   facing SOUTH/NORTH step s1
local 3,1,2  pipe    Tin Item Pipe
local 4,0,0  machine Basic Macerator   facing UP/NORTH   step s2
local 4,0,1  cable   4x Tin Cable
local 4,0,2  machine Basic Macerator   facing UP/SOUTH   step s2
local 4,1,0  pipe    Tin Item Pipe
local 4,1,1  machine Basic Macerator   facing SOUTH/NORTH step s2
local 4,1,2  pipe    Tin Item Pipe
```

The tail (local x ≥ `tailX` = 7):

```
local 7,1,0  pipe  Tin Item Pipe
local 7,1,1  pipe  Tin Item Pipe        (the join)
local 7,1,2  pipe  Tin Item Pipe        (tail cell, on the box's face)
local 7,0,2  chest Chest (input)        (below the tail cell, tail:input)
local 8,1,2  chest Chest (output)       (east of the tail cell, tail:output)
```

## What the spike found

- **The box-face rule is the spike's hard finding.** The spec put the input chest below the join cell `[tailX, 1, 1]`;
  every `enderio` row then warned `no_path` ("route it around obstacles") because the router keeps off the box's
  whole column at any height. The tail cell moved to the south lane's end `[tailX, 1, 2]`: the lanes, join, tail and
  both chest columns are all still one pipe wide, one chest per item, and the hookup routes.
- **The modes generalize without a packed branch.** `Placement` gains `spine?: Vec3[]` (the lane cells in lay order)
  and `tail?: { cell, inputSide, outputSide }`; `placePacked` fills both. `direct` lays the spine, links consecutive
  cells, and hangs its tail chests through `step(tail.cell, side)`; `enderio`'s `itemLine` builds its cells/runs and
  face plans from the same fields. With `spine` unset every expression reduces to the committed geometry, cell for
  cell (the 52 non-qualifying rows are byte-identical to BEFORE, warnings included).
- **Both modes cost the same to pack.** `direct` GT pipes and `enderio` item conduits lay identical block counts on
  every row (the spine is one long 2·(tailX−firstX)+1 conduit run with face plans at the ports); `enderio` keeps its
  own hookup/warning profile (`no_path` on the `mixed-*` rows is the site's terrain, present in BEFORE).
- **Chests stay at 2.** The packed tail keeps one input chest and one filter chest per output item; the riser
  columns it replaces were pipes, not chests.
- **`transformer_bank` is power, not logistics.** It is the only code new in AFTER (both modes, `loss-10`): the
  SP-E packed lane concentrates the column's draw on one transformer stage, exactly as SP-E reported. The `mixed-*`
  rows show no new codes at all.

## Regressions

- `mixed-09` (5 units): +2 blocks and lossEUt +1 (361 → 362) — the replace rule rejects this row on both counts
  (see the table): the packed line is not a drop-in for a 5-unit line under the rule as written. 3 short risers were
  cheaper than 7 lane cells. Small lines should stay unpacked (the promotion gate is the packed line's own, so a
  5-unit packed line is already the promoter's choice).
- No connection offenders, tier contacts, `no_path`, `route_failed` or unpowered regressions on any qualifying row.

## Reproducing

```bash
npm ci
npx tsc -b
git apply spikes/packed-logistics/change.patch    # includes SP-E's lines
npx vitest run tests/unit/layout/tmp-spike.test.ts                          # BEFORE: $TMPDIR/before.json
SPIKE_PACKED=1 SPIKE_OUT=after.json npx vitest run tests/unit/layout/tmp-spike.test.ts   # AFTER: $TMPDIR/after.json
git checkout -- src/                                                        # drop the prototypes
```

The harness is temporary and not committed. It keeps `lengthOf` per row, the qualifying gate, the three connection
and tier checks above, and prints the qualifying rows as a table; with `SPIKE_PACKED=1` it asserts both checks are
empty on every qualifying row. The full suite (`npx vitest run`) passes with the prototype applied — 4,412 tests, of
which the committed baseline is 4,411 and the 4,412th is this spike's own temporary harness:
the packed path is env-gated (`SPIKE_PACKED=1`, `westUnits === 0`, `packedLine`, one feed tier, `direct`/`enderio`)
and the new `Placement` fields are inert otherwise.

## The patch

`change.patch` (SP-E's packed placement + SP-F's logistics, one diff on a clean tree):
`Placement.spine`/`Placement.tail` and the lane/tail geometry in
`src/server/layout/arrange.ts`; the packed switch in `buildLocalAt` (`oneFeedTier`, packed `direct`/`enderio`) in
`src/server/layout/layout.ts`; spine laying, riser skip and the generalized tail in
`src/server/layout/modes/direct.ts`; the same in `itemLine` of `src/server/layout/modes/enderio.ts`.
