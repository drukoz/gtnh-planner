# SP-I spike: a packed AE2 column that keeps every machine reachable (RUK-3016)

`spikes/reach/README.md` showed why the packed AE2 column loses to the reach scoring: the machine behind a packed
column's spine (`y=0`, interfaces at `y=0,1`, cable at `y=0,2`) is walled in on all six sides, so `reachScore` counts
it unreachable and the search keeps a spread-out line. This spike measures the two proposed columns that open a face
to air.

Both variants are measured on top of `spikes/reach/change.patch` (the reach scoring, staged in `src/`, not committed).
`i1.patch` and `i2.patch` are `git diff -- src` with that patch in the index: apply the reach patch first, then one
variant patch. Each patch ends with `const AE2_PACKED_REACH: 0 | 1 | 2 = <variant>` in `src/server/layout/layout.ts`,
the spike's measurement switch (`0` keeps today's packed column, which is the **reach-only baseline** every row below
is measured against).

How to reproduce: `git apply spikes/reach/change.patch && git add src && git apply spikes/reach-ae2/<variant>.patch`,
set the switch, run the throwaway harness (a Vitest file that writes the `*-reach.txt`/`*-i1.txt`/`*-i2.txt` tables,
the `bench-*.json` rows from `runBench()` and the `column-*` geometries; deleted before this commit), then
`npx vitest run`. `npx tsc -b` is not clean with the patch in `src/`: the committed `score.test.ts` calls `scoreLine`
with the pre-patch arity and pins a `LineScore` without `unreachable`; the spike does not touch committed tests.

## I1: T every other column

A+B+T, A+B, A+B+T, … so every T has an empty column on each side and `[x±1, 1, 1]` is air
(`placePacked` skips the T slot on alternating columns).

**The air does not reach the machines.** The pocket beside a T is walled by the interfaces at `[x,0,0]`/`[x,0,2]` and
by the lane cable at `[x,0,1]` below and `[x,2,1]` above: it is an enclosed pocket, not outside air, and
`unreachableMachines` floods from the world's outside in. Measured (`candidates-i1.txt`, the packed candidate's
`unreach`): loss-10 `1` (baseline `2`), loss-20 `3` (baseline `5`), loss-40 `7` (baseline `12`) — the alternating T
halves the count, it does not clear it. Only on **mixed-05**, where the baseline's column had a single unreachable
machine, does I1 reach `0`, and there the packed line is kept (bench `43→38`, `628→587 EU/t`). On the loss lines the
kept candidate stays `stacked`/`west` with `unreach=0`, exactly as under the reach patch alone.

## I2: interfaces in the floor, machines one level up

The box is z `0…4` (`placement.size[2]=5`, `spineZ=2`): interfaces on the outer faces (`[x,0,0]` for A, `[x,0,4]` for
B, `[x,2,2]` for T), machines at `y=0` (A z1, B z3) and the T at `[x,1,2]`, the cable lane `[x,0,2]`. Every machine
touches air through its interface row: A's north face through `[x,0,0]`, B's south face through `[x,0,4]`, the T's
west/east faces along the `y=1` lane. The tail is lifted to `[tailX,1,4]` so `inputSide: DOWN` puts the chest on the
`[x,0,4]` row, and three bridge cells (`[tailX,0,1]`, `[tailX,0,3]`, `[tailX,1,2]`) join the three lanes to the spine,
because `linkBits` links only face-adjacent cells.

**This opens the column.** The packed candidate scores `unreachable=0` on every row measured and is kept on all four
(`candidates-i2.txt`).

## The four report rows (full tables in `candidates-i1.txt` / `candidates-i2.txt`)

The `packed` candidate of each row, the kept line and `lengthOf` of the kept layout (`w` = west units,
`unpow` = unpowered):

| row | reach only (`AE2_PACKED_REACH=0`) | I1 | I2 |
|---|---|---|---|
| loss-10 | packed `unreach=2` total=26 vol=81; kept stacked total=36; bench `53 / 262 / weak- / unpow 0 / 5x2x10` | packed `unreach=1` total=26 vol=81; kept stacked total=36; bench `53 / 262 / weak- / unpow 0 / 5x2x10` | packed `unreach=0` **kept**, total=34 vol=135; bench `52 / 196 / weak- / unpow 0 / 5x3x9` |
| loss-20 | packed `unreach=5` total=38 vol=108; kept stacked total=61; bench `73 / 536 / weak- / unpow 0 / 5x2x15` | packed `unreach=3` total=42 vol=117; kept stacked total=61; bench `73 / 536 / weak- / unpow 0 / 5x2x15` | packed `unreach=0` **kept**, total=46 vol=180; bench `61 / 394 / weak- / unpow 0 / 5x3x12` |
| loss-40 | packed `unreach=12` hand=2 total=66 vol=171; kept west total=199; bench `232 / 2052 / weak- / unpow 0 / 5x4x44` | packed `unreach=7` hand=3 unpow=2 total=74 vol=189; kept west total=199; bench `232 / 2052 / weak- / unpow 0 / 5x4x44` | packed `unreach=0` **kept**, total=74 vol=285; bench `82 / 1062 / weak[1] / unpow 0 / 5x3x19` |
| mixed-05 | packed `unreach=1` total=19 vol=54; kept stacked total=26; bench `43 / 628 / weak- / unpow 4 / 7x2x5` | packed `unreach=0` **kept**, total=19 vol=54; bench `38 / 587 / weak- / unpow 4 / 6x3x3` | packed `unreach=0` **kept**, total=25 vol=90; bench `44 / 585 / weak- / unpow 4 / 6x3x5` |

(mixed-05's 4 unpowered machines are the row's own HV-on-MV supply: every candidate, and the committed baseline, has
them. I2's loss-40 keeps a weak LV tier — see the satellite finding.)

## The 40-machine line, satellites off (`line40-*.txt`)

| | kept | unpowered | `machine_unpowered` warnings | unreachable | size |
|---|---|---|---|---|---|
| reach only | stacked | 10 | 1 | 0 | `5x3x27` |
| I1 | stacked | 10 | 1 | 0 | `5x3x27` |
| I2 | **packed** | **0** | **0** | **0** | `5x3x19` |

## Every ME Interface wrenched into its own machine (`column-*.txt`)

All three columns (40 units): `interfaces=40`, each port's `behind` cell is its own machine, no shared cells
(`notWrenched=0`), `overlaps=0`. Reach-only box `17x2x3` (`lastColumn=14`, tail `15 1 2`, `spineZ=1`); I1 `19x2x3`
(two columns longer, tail `17 1 2`); I2 `17x2x5` (same length, 2 deeper, 1 taller, tail `15 1 4`, `spineZ=2`).

## Satellites (`sat-*.txt`)

Reach-only and I1 keep the spread-out line, so the satellite feature runs as before: 5 satellite transformers,
5 banks, 5 satellite blocks, one `layout:power:satellites:1` build step, cells `20 65 0/5/11/17/25`. I2 keeps the
packed line and lays **no** satellites (`satelliteBlocks=0`, no build step, 5 transformer blocks) while keeping the
weak LV tier (`bench: 82 / 1062 / weak[1]`): `planSatellites` (`src/server/layout/internal.ts:1133`, search at
1195–1232) places banks only **inside `placement.size`**, and a packed box is fully occupied, so it finds no cell.

## Full benchmark (`runBench`, 33 lines × 4 modes; `bench-*.json`)

- **The reach patch alone regresses 3 AE2 rows against the committed HEAD baseline**: loss-10 `44→53` / `164→262`,
  loss-20 `54→73` / `394→536`, mixed-05 `38→43` / `585→628`. The packed candidate is no longer kept on those rows,
  which is the regression the two variants are meant to answer. AE2 sums `2053→2086`, `11411→11694 EU/t`.
- **I1 vs reach-only: 1 row changes** — mixed-05 `43→38` / `628→587` (size `7x2x5→6x3x3`); no row gets worse. AE2
  sums `2086→2081`, `11694→11653`. Against HEAD, I1 keeps mixed-05's length (38) but not its loss (587 vs 585) and
  leaves the loss-10/loss-20 regressions in place.
- **I2 vs reach-only: 7 rows change, all AE2** — lowered: loss-10 `53→52` / `262→196`, loss-20 `73→61` / `536→394`,
  loss-40 `232→82` / `2052→1062`; **made worse**: mixed-05 total `43→44` (loss `628→585`), mixed-09 loss `362→381`,
  mixed-13 `37→42` / `93→109`, mixed-14 `34→35` / `283→297`, and loss-40 gains a weak tier (`[]→[1]`). AE2 sums
  `2086→1930`, `11694→10502`, rows with a weak tier `0→1`. Against HEAD, loss-40 is the only lowered row.

## Test suite with each variant applied (`npx vitest run`)

| run | fails |
|---|---|
| reach patch alone | 5 content failures: `layout-bench` "lays the 40-machine AE2 line packed with no weak tier and no starved machine" (`weakTiers [1]`, stacked kept), `layout-bench` "no benchmark line gets longer, lossier or weaker" (the 3 regressions above), `packed.test:55` "lays the 40-machine AE2 line packed" (`expected 2 to be 3`: stacked chosen, not packed), `score.test` "scores blocks, warnings and machines" (the score now carries `unreachable`), `score.test` "replaces the finished baseline…" (the patch's `finalReplaces` rule) |
| I1 | the same 5 content failures (4430 passed); no additional failure |
| I2 | 8 content failures: the same 5 — `packed.test` now fails a later pin, an interface at `18 64 13` targeting `east` where the test pins `down` — plus the three below |

I2's three extra failures:

1. `layout-bench` "runs the 40-machine AE2 line's LV wiring with no weak tier once satellites are laid" —
   `expected [1] to deeply equal []`.
2. `satellites.test` "the 40-machine ae2 line lays a satellite step every satellite transformer points at" — no
   `layout:power:satellites` build step.
3. `feeding/precheck.test` "flags shared machines outside AE2" — the flagged machine's position pin,
   `1 64 0` → `1 64 1` (reproduces in isolation: a content failure, not a flake).

1 and 2 are one **real integration gap**, not a re-pin: with I2 winning the 40-machine row, the satellite feature runs
on a packed line for the first time, and `planSatellites` only places banks inside `placement.size`, which a packed
box fills. Satellite support beside the box is the follow-up; it is a power-router change, outside this spike's
geometry. 3 is a position re-pin: the T machine sits at `y=1`, so the fed line's machines shift up one.

The five reach-patch failures (all three runs) are the patch's own, not the variants': `score.test` pins predate the
`unreachable` field, and `packed.test`/`layout-bench` encode "the search keeps packed", which the reach patch breaks
until a column like I2 is adopted. None is caused by I1.

**Flaky under load, green in isolation, in every run of this spike**: `export/run.test.ts` "stops the JVM when
aborted", `scene-links.test.ts` "draws no link through a solid block", and `layout.test` "random LV, MV and HV lines"
(the timeout seen in earlier runs). They are not counted in the tables above; none is layout-geometry sensitive.

## What the change needed (shared by both patches)

- `placePacked` takes `reachable: 1 | 2`; `Placement.packed` widens to `true | 1 | 2`; `packs()` returns the variant,
  switched by `AE2_PACKED_REACH` for measurement.
- I2's `PACKED_SLOTS_AE2_I2`, the `ae2` mode's `PACKED_LANES_I2` + `PACKED_BRIDGE_I2`, the lifted tail cell, and
  `spineZ = 2` so the power router feeds `[x,0,2]`.
- A latent bug fixed on the way: the first I2 draft moved the baseline packed spine's north lane to `z=1`, which made
  direct/enderio packed lines link `[tailX,1,1]` to itself (`RangeError: a link joins face-adjacent cells`). The
  patches keep that lane at `z=0`.

## Verdict

The acceptance rule: a variant is promotable only if it lowers at least one benchmark row and makes none worse
(measured against the reach-only baseline, `bench-reach.json`).

- **I1 meets the rule** (mixed-05 `43→38` / `628→587`, no row worse) **and fails its purpose.** The alternating T's
  air pockets are sealed by cable and interfaces, so the packed line keeps 1/3/7 unreachable machines on the loss
  rows, never wins there, and costs 2 columns of length (`17x2x3 → 19x2x3`). It does not recover the reach patch's
  loss-10/loss-20 regressions.
- **I2 achieves the goal and fails the rule.** Every machine is reachable (`unreachable=0`), the packed column is kept
  on all four rows, all 40 interfaces wrench into their own machine and nothing is unpowered, at the cost of 2 depth
  and 1 height (40-machine line `5x3x19`, `17x2x5` column). It lowers the three loss rows and AE2's sums, and makes
  four mixed rows worse (mixed-05's total, mixed-09, mixed-13, mixed-14), adds a weak LV tier on loss-40 and exposes
  the satellite gap (2 failures) plus one test re-pin before it can be promoted.

**Recommendation: promote neither as it stands.** I2 is the geometry to carry forward — it is the only one that
clears `unreachable` — with three follow-ups before promotion: satellite banks beside packed boxes in the power
router, an explanation of the mixed-row regressions, and the `packed.test`/`precheck.test` re-pins. I1 is measured and
rejected: it satisfies the narrow rule by winning a single row and does not deliver the reachable column.
