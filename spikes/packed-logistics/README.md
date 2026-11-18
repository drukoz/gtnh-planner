# Spike SP-F: packed item logistics for `direct` and `enderio` (RUK-2900)

Parent: RUK-2900 (M3 optimal layout), on top of spike SP-E (`spikes/shared-cable`).

A packed line (SP-E) stacks machines three deep on one cable lane. This spike lays its **item logistics**: the two
lanes `[x, 1, 0]` and `[x, 1, 2]` run `firstX … tailX`, join at `[tailX, 1, 1]`, and end at the tail cell
`[tailX, 1, 2]` — the south lane's end cell, on the box's face — with the input chest below it at `[tailX, 0, 2]` and
output chest *i* east of the rising tail column at `[tailX + 1, 2 + i, 2]`. The prototype is `change.patch` next to
this file; it **includes SP-E's lines** (`placePacked`, `packedLine`, `PlacedUnit.powerSide`, the `SPIKE_PACKED`
switch) and applies to a clean tree on its own. `src/` in the committed tree is untouched.

## Verdict

**Promote.** Over the 14 qualifying rows (7 lines × `direct` + `enderio`) the laid packed logistics cut total
block count **695 → 526 (−24.3%)** — `loss-40` alone goes 117 → 55 (`direct`) and 131 → 59 (`enderio`). Every row
connects with **zero connection offenders and zero tier contacts**, and no row gains a logistics warning code. Three
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
`direct` and `enderio` through `layoutLine` — 66 rows — with `lengthOf(layout)` per row (cable + pipe + chest +
hookup blocks). BEFORE is the SP-E patch only (`SPIKE_PACKED` unset: normal placement, the modes' own logistics);
AFTER is `SPIKE_PACKED=1`: the packed placement with the lanes laid. A row qualifies when `packedLine(placement.units)`
holds and all its electric units share one feed tier (`Math.min(u.tier, stages.supplyTier)`). 14 rows qualify:

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

Sums over the 14 qualifying rows: **695 → 526 (−24.3%)**; over all 66 rows **3,573 → 3,404 (−4.7%)** (the other rows
are unchanged, the gate leaving them on the committed path). Pipes rise 108 → 178 on qualifying rows — the lanes
cover every column — while cable (the SP-E lane) and the modes' per-unit risers and long hookups fall far more.

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

- `mixed-09` (5 units): +2 blocks — 3 short risers were cheaper than 7 lane cells. Small lines should stay unpacked
  (the promotion gate is the packed line's own, so a 5-unit packed line is already the promoter's choice).
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
empty on every qualifying row. The full suite (`npx vitest run`, 4,412 tests) passes with the prototype applied:
the packed path is env-gated (`SPIKE_PACKED=1`, `westUnits === 0`, `packedLine`, one feed tier, `direct`/`enderio`)
and the new `Placement` fields are inert otherwise.

## The patch

`change.patch` (SP-E's packed placement + SP-F's logistics, one diff on a clean tree):
`Placement.spine`/`Placement.tail` and the lane/tail geometry in
`src/server/layout/arrange.ts`; the packed switch in `buildLocalAt` (`oneFeedTier`, packed `direct`/`enderio`) in
`src/server/layout/layout.ts`; spine laying, riser skip and the generalized tail in
`src/server/layout/modes/direct.ts`; the same in `itemLine` of `src/server/layout/modes/enderio.ts`.
