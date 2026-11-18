# Promoting the open AE2 packed column (CTO probe after SP-I, RUK-2877)

SP-I (`spikes/reach-ae2/`, RUK-3016) found that column I2 reaches every machine but would not promote it: four mixed AE2
rows got worse, `loss-40` gained a weak LV tier, and satellites found no room on a packed box. This probe explains the
first two, and gives two patches that promote I2 with **2 benchmark rows lower and none worse**. Measured on
`feat/optimal-layout-m3` at `26df5005f` (reach in the score, RUK-3015, already merged).

## Why the mixed rows got worse

1. **I2 replaced the SP-G column instead of joining it.** On short lines (`mixed-09`, `mixed-13`, `mixed-14`) the
   SP-G column walls nothing in and is the better line. With I2 instead of it, the search fell back to an unpacked
   line. Offering both columns (I2 laid after SP-G, as its own candidate) puts all three rows back.
2. **The finished-layout check judged only one finalist.** On `mixed-05` the search ranks the I2 line first on its
   in-line score (25 blocks against the stacked line's 26) and `layoutLine` finishes only that line and the baseline.
   Hooked up, I2 is 44 blocks and the stacked runner-up 43. Finishing the **two** best candidates that replace the
   baseline, and keeping the better finished one, keeps the stacked line. Three or all finalists change no row (`K` 2,
   3 and 99 give byte-identical benchmarks).
3. **`loss-40`'s weak tier is the satellite gap**, not a geometry fault: with satellites on, the spread line lays 5 and
   has no weak tier; the packed box has no room for one (`planSatellites` searches inside `placement.size`). Until
   satellites can stand beside a packed box (spike SP-J), `finalReplaces` refuses a finished line with more weak tiers
   than the baseline unless it powers more machines. `loss-40` then keeps today's line (232 blocks) with satellites on;
   with satellites off, the open column still wins it (it powers all 40, the baseline starves some).

## A GT fault in the spike's geometry

I2's slots gave A and B the same front and output side (`facing: NORTH, mainFacing: NORTH` and `SOUTH, SOUTH`). GT
never allows that: `setMainFacing` turns the output side away from the new front (`docs/research/gt-mechanics.md`,
"Front and output side"). `b.patch` turns A's and B's fronts west, toward the head, as on today's rows. No benchmark
number moves. The spec adds a test that no laid machine has its front on its output side.

## The patches (apply in order on `26df5005f`)

- `a.patch` — `score.ts`: `FinalMeasure.weakTiers`, `finalReplaces`'s weak-tier rule, `compareFinal`; `layout.ts`:
  `buildLocal` returns its `finalists` (`FINALISTS = 2`), `layoutLine` finishes the baseline and every finalist and
  keeps the best finished one that replaces the finished baseline; `LayoutSearch.rejected` doc. **Changes no benchmark
  row** (`bench-a.json`). It does change `lossLine(40, 'direct' | 'enderio')` with satellites off: the stacked line the
  search ranks first is 78 blocks / 1 176 EU/t once hooked up, the packed runner-up 55 / 958 (direct) and 59 / 958
  (EnderIO), so the runner-up is kept and `rejected` names the stacked line.
- `b.patch` — `CandidateKind.PackedOpen = 4`; `placePacked(..., { open })` and `Placement.open`; the `ae2` mode's open
  lanes, bridge cells and lifted tail cell; the open column's logistics words; the candidate label in `View3D.tsx`.

## Benchmark (`bench-ab.json`, both patches; against `tests/fixtures/layout-bench/baseline.json`)

| row | today | both patches |
|---|---|---|
| loss-10 ae2 | 53 blocks / 262 EU/t / `5x2x10` | **52 / 196** / `5x3x9` |
| loss-20 ae2 | 73 / 536 / `5x2x15` | **61 / 394** / `5x3x12` |

No other row of the 132 moves. Per mode: direct 1 765, routed 2 199, EnderIO 1 710 (unchanged), AE2 2 086 → 2 073
blocks and 11 694 → 11 486 EU/t. `runBench` 1.6 s before and after.

## Whole suite (`npx vitest run`)

`a.patch` alone: 4 failures, all pins of the old rule. Both patches: those 4 and 3 more:

| test | why it moves | new pin |
|---|---|---|
| `score.test.ts` helper `measure` and "measures a finished layout as the benchmark does" | `FinalMeasure` has `weakTiers` | `weakTiers: 0` in the helper and in the expected object |
| `score.test.ts` "replaces the finished baseline only to power a machine…" and "reach in the score… gives the finished baseline the same two answers" | the helper's missing `weakTiers` makes every comparison `NaN` | fixed by the helper alone |
| `layout-search.test.ts:80` "lays the line the search reports as chosen" | `rejected` may now be set with the runner-up chosen | `rejected === undefined \|\| rejected !== chosen` |
| `packed.test.ts:13` "lays one packed candidate, last, in direct and enderio only" | AE2 lays `Packed` then `PackedOpen` | AE2: kinds end `[Packed, PackedOpen]`; direct/EnderIO one `Packed`, last; routed none |
| `packed.test.ts:68` "keeps the 40-machine AE2 line reachable…" | the open column is kept | `Packed` candidate `unreachable` 12, `PackedOpen` 0, chosen kind `PackedOpen` |
| `layout-bench.test.ts:33` "keeps the 40-machine AE2 line reachable, at one weak tier and one starved machine" | the open column powers all 40 | `unreachable` 0, `weakTiers` `[1]`, no `machine_unpowered` warning |

`lossLine(n, 'ae2')` with both patches (default options, satellites off): n = 10 keeps `PackedOpen` (52 / 196), n = 20
`PackedOpen` (61 / 394), n = 40 `PackedOpen` (82 / 1 062, weak `[1]`, 0 unpowered, 0 unreachable; its `Packed`
candidate has 12 unreachable). With satellites on, n = 40 keeps the west line (232 / 2 052) and `rejected` names the
open column.
