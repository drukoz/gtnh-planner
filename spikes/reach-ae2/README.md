# SP-I spike: a packed AE2 column that keeps every machine reachable (RUK-3016)

`spikes/reach/README.md` showed why the packed AE2 column loses to the reach scoring: the machine behind a packed
column's spine (`y=0`, interfaces at `y=0,1`, cable at `y=0,2`) is walled in on all six sides, so `reachScore` counts
it unreachable and the search keeps a spread-out line. This spike measures the two proposed columns that open a face
to air.

Both variants are measured on top of `spikes/reach/change.patch` (the reach scoring, staged in `src/`, not committed).
`i1.patch` and `i2.patch` are `git diff -- src` with that patch in the index: apply the reach patch first, then one
variant patch. Each patch ends with `const AE2_PACKED_REACH: 0 | 1 | 2 = <variant>` in `src/server/layout/layout.ts`,
the spike's measurement switch (`0` keeps today's packed column).

## I1: T every other column

A+B+T, A+B, A+B+T, … so every T has an empty column on each side and `[x±1, 1, 1]` is air
(`placePacked` skips the B slot on alternating columns).

**The air does not reach the machine.** The pocket beside a T is walled by the interfaces at `[x,0,0]`/`[x,0,2]` and by
the T's own lane cable at `[x,0,1]` below and the lane cable at `[x,2,1]` above: it is an enclosed pocket, not outside
air, and `reachScore` floods from the world's outside in. Only the first T (whose west neighbour is the head column,
open above) gets out. Measured: the packed candidate keeps **1 unreachable machine** per line (`unreach=1` in
`candidates-i1.txt`), everywhere the baseline kept 2, so it never wins and the search keeps `stacked`/`west` as under
the reach patch alone.

## I2: interfaces in the floor, machines one level up

The box is z `0…4` (`placement.size[2]=5`, `spineZ=2`): interfaces on the outer faces (`[x,0,0]` for A, `[x,0,4]` for
B, `[x,2,2]` for T), machines at `y=0` (A z1, B z3) and the T at `[x,1,2]`, the cable lane `[x,0,2]`. Every machine
touches air through its interface row: A's north face through `[x,0,0]`, B's south face through `[x,0,4]`, the T's
west/east faces along the `y=1` lane. The tail is lifted to `[tailX,1,4]` so `inputSide: DOWN` puts the chest on the
`[x,0,4]` row, and three bridge cells (`[tailX,0,1]`, `[tailX,0,3]`, `[tailX,1,2]`) join the three lanes to the spine,
because `linkBits` links only face-adjacent cells.

**This opens the column.** The packed candidate scores `unreachable=0` on every row and wins every AE2 line measured.

## The four report rows (full tables in `candidates-i1.txt` / `candidates-i2.txt`)

The `packed` row of each row (`w` = west units, `unpow` = unpowered, `bench` = `lengthOf` of the kept layout):

| row | reach only | I1 | I2 |
|---|---|---|---|
| loss-10 | packed kept? no (stacked wins): packed `unreach=2` total=26 vol=81; kept stacked total=36; bench `52 / 262 EU/t / weak- / unpow 0` | packed `unreach=1` total=26 vol=81; kept stacked; bench `53 / 262 / weak- / unpow 0` | packed `unreach=0` **kept**, total=34 vol=135; bench `52 / 196 / weak- / unpow 0` |
| loss-20 | packed `unreach=2`; kept stacked total=61; bench `61 / 394 / weak- / unpow 0` | packed `unreach=1`; kept stacked; bench `73 / 536 / weak- / unpow 0` | packed `unreach=0` **kept**, total=46 vol=180; bench `61 / 394 / weak- / unpow 0` |
| loss-40 | packed `unreach=2`; kept stacked total=111 `unpow=17`; bench `82 / 1062 / weak[1] / unpow 0` | packed `unreach=1`; kept stacked; bench `232 / 2052 / weak- / unpow 0` | packed `unreach=0` **kept**, total=74 vol=285; bench `82 / 1062 / weak[1] / unpow 0` |
| mixed-05 | packed `unreach=2`; kept west total=29 `unpow=4`; bench `44 / 585 / weak- / unpow 4` | packed `unreach=1`; kept west; bench `38 / 587 / weak- / unpow 4` | packed `unreach=0` **kept**, total=25 vol=90; bench `44 / 585 / weak- / unpow 4` |

(mixed-05's 4 unpowered machines are the row's own HV-on-MV supply: every candidate, and the committed baseline, has
them.)

## The 40-machine line, satellites off (`line40-*.txt`)

| | kept | unpowered | `machine_unpowered` warnings | unreachable |
|---|---|---|---|---|
| reach only | stacked | 10 | 1 | 0 |
| I1 | stacked | 10 | 1 | 0 |
| I2 | **packed** | **0** | **0** | **0** |

## Every ME Interface wrenched into its own machine (`column-*.txt`)

All three columns (40 units): `interfaces=40`, each port's `behind` cell is its own machine, no shared cells,
`overlaps(placement.blocks)=[]`. I1's box is `19x2x3` (two columns longer than today's `17x2x3`); I2's is `17x2x5`
(same length, 2 deeper, 1 taller; the kept layout is `5x3x19`).

## Full benchmark (`runBench`, 33 lines × 4 modes; `bench-*.json`)

- **I1 vs reach-only: 7 rows change, all AE2** — loss-10 `52→53`, loss-20 `61→73`, loss-40 `82→232`, mixed-05 `44→38`,
  mixed-09 `34→34` (shape `6x1x5→5x3x3`), mixed-13 `42→37`, mixed-14 `35→34`. AE2 sums: total `1930→2081` (+151),
  loss `10502→11653` (+1151 EU/t), rows with a weak tier `1→0`, unpowered `39→39`. The three loss lines get longer
  because I1 never wins and the search falls back to spread-out lines with the patch's scoring.
- **I2 vs reach-only: 0 rows change.** In `runBench`'s path the reach patch alone already keeps the packed candidate
  for loss-40, so the rows are equal. The satellite run through `lossLine` (the path the satellites tests use) shows
  the real difference: reach-only keeps `west` with 5 satellite banks and no weak tier; I2 keeps packed, lays
  **no** satellites, and keeps the weak tier (see the finding below).

## Test suite with each variant applied (`npx vitest run`)

| run | fails |
|---|---|
| reach patch alone | 6 (+1 flaky): `layout-bench` "40-machine AE2 packed, no weak tier/starved" (`weakTiers [1]`), `layout-bench` "no line gets longer/lossier/weaker" (worsened rows), `packed.test` "lays the 40-machine AE2 line packed" (`expected 2 to be 3`: packed not chosen), `score.test` ×2 (the patch adds `unreachable` to the score), and `layout.test` "random LV, MV and HV lines" — a **timeout** (27.5 s vs the 20 s limit), not a content failure; it passed in the two variant runs |
| I1 | 5: the same 5 content failures, the timeout test passed |
| I2 | 8: the same 5, plus the three below |

I2's three extra failures:

1. `layout-bench` "runs the 40-machine AE2 line's LV wiring with no weak tier once satellites are laid" —
   `expected [1] to deeply equal []`.
2. `satellites.test` "the 40-machine ae2 line lays a satellite step every satellite transformer points at" — no
   `layout:power:satellites` build step.
3. `feeding/precheck.test` "flags shared machines outside AE2" — the flagged machine's position pin,
   `1 64 0` → `1 64 1`.

1 and 2 are one **real integration gap**, not a re-pin: with I2 winning the 40-machine row, the satellite feature runs
on a packed line for the first time, and `planSatellites` (`src/server/layout/internal.ts:1133`, search at 1195–1232)
only places banks **inside `placement.size`** — a packed box is fully occupied (interfaces, machines, lane), so it
finds no cell, lays zero banks, and the LV line keeps its weak tier. Satellite support beside the box (outside
`placement.size`) is the follow-up; it is a power-router change, outside this spike's geometry. 3 is a position
re-pin: the T machine sits at `y=1`, so the fed line's machines shift up one.

The reach-patch failures (both variants, and the patch alone) are the patch's own: `score.test` pins predate the
`unreachable` field, and `packed.test`/`layout-bench` encode "the search keeps packed", which the reach patch breaks
until a column like I2 is adopted. None is caused by I1.

## What the change needed (shared by both patches)

- `placePacked` takes `reachable: 1 | 2`; `Placement.packed` widens to `true | 1 | 2`; `packs()` returns the variant,
  switched by `AE2_PACKED_REACH` for measurement.
- I2's `PACKED_SLOTS_AE2_I2`, the `ae2` mode's `PACKED_LANES_I2` + `PACKED_BRIDGE_I2`, the lifted tail cell, and
  `spineZ = 2` so the power router feeds `[x,0,2]`.
- A latent bug fixed on the way: the first I2 draft moved the baseline packed spine's north lane to `z=1`, which made
  direct/enderio packed lines link `[tailX,1,1]` to itself (`RangeError: a link joins face-adjacent cells`). The
  patches keep that lane at `z=0`.

## Verdict

**I1 fails its purpose**: the alternating T's air pockets are sealed by cable and interfaces, one machine per line
stays unreachable, and the packed column never wins a row. **I2 achieves the goal**: every machine reachable
(`unreachable=0`), the packed column wins every AE2 row with the lowest score, all 40 interfaces wrench into their own
machine, nothing unpowered, at the cost of 2 depth and 1 height (40-machine line: `5x3x19`), and it exposes the
satellite feature's missing support for packed lines (2 test failures to fix in the power router, plus one position
re-pin) before it can be promoted.
