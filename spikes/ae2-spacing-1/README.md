# SP-A spike: AE2 lines at port spacing 1, each ME Interface wrenched at its machine

Task RUK-2615 (spike). Patch: [`change.patch`](change.patch). Base: `origin/feat/optimal-layout`.

The AE2 mode places an ME Interface every 2 columns (`PORT_SPACING.ae2 = 2`) and lets each interface
push into every inventory beside it; `docs/research/machine-feeding.md:207` records that the spacing
keeps an interface from touching two machines at once, which rule R12 (`feed_leak`) forbids. This
spike measures what happens if interfaces sit in every column (`ae2: 1`, halving the cable) and the
interface is instead pointed at exactly one machine with a Wrench target — the Export-Bus cover
pattern `FACES[sideToward(pos, behind)]`.

## The patch (3 changes, all in `src/`)

1. `src/server/layout/modes/ae2.ts` — the Auto Workbench interface and every pattern-machine
   interface feed gets `targets: [FACES[sideToward(pos, behind)]!]` (the face of the machine behind
   it, the same cover pattern the ME Export Bus uses). `worldFeed` rotates targets with the line.
2. `src/server/layout/feed-rules.ts` — `inventoriesBeside` for an interface with `targets` set keeps
   only the neighbours on the target faces, so rule R12 sees one inventory, not two.
3. `src/server/layout/modes/mode.ts:75` — `PORT_SPACING.ae2: 2 → 1`.

## Method

A temporary vitest test (not committed) laid all 33 AE2 benchmark lines from
`tests/helpers/layout-bench.ts` and dumped, per line, `size`, `total`, `cable`, `iface`, `lossEUt`,
`weakTiers`, `routeFailed` and the count of warnings with code starting `feed_`; it also timed
`runBench()` (all 132 lines, 4 modes). "Before" is the unmodified tree (and matches
`tests/fixtures/layout-bench/baseline.json`); "after" is all 3 changes.

## Results (before → after)

| name | size | total | lossEUt | weak tiers | feed warnings |
| --- | --- | --- | --- | --- | --- |
| loss-10 | 5x1x23 → 5x1x14 | 78 → 53 | 489 → 290 | 1 → - | 0 → 0 |
| loss-20 | 5x3x43 → 5x1x24 | 169 → 83 | 1,908 → 1,053 | 1 → 1 | 0 → 0 |
| loss-40 | 5x3x83 → 5x3x45 | 295 → 178 | 24,988 → 4,412 | 1 → 1 | 0 → 0 |
| mixed-00 | 25x3x5 → 16x3x5 | 108 → 79 | 376 → 301 | - → - | 0 → 0 |
| mixed-01 | 10x5x7 → 8x5x7 | 46 → 40 | 441 → 399 | - → - | 0 → 0 |
| mixed-02 | 21x5x9 → 14x5x9 | 104 → 89 | 319 → 246 | - → - | 0 → 0 |
| mixed-03 | 17x5x9 → 11x5x9 | 85 → 69 | 233 → 196 | - → - | 0 → 0 |
| mixed-04 | 7x3x5 → 6x3x5 | 41 → 39 | 80 → 78 | - → - | 0 → 0 |
| mixed-05 | 16x2x5 → 10x1x5 | 64 → 46 | 818 → 657 | - → - | 0 → 0 |
| mixed-06 | 13x3x5 → 10x3x5 | 63 → 56 | 125 → 119 | - → - | 0 → 0 |
| mixed-07 | 15x5x7 → 11x5x7 | 75 → 64 | 273 → 251 | - → - | 0 → 0 |
| mixed-08 | 25x4x5 → 16x4x5 | 126 → 95 | 470 → 395 | - → - | 0 → 0 |
| mixed-09 | 8x2x5 → 6x1x5 | 40 → 34 | 406 → 381 | - → - | 0 → 0 |
| mixed-10 | 23x3x5 → 14x3x5 | 112 → 79 | 1,271 → 977 | - → - | 0 → 0 |
| mixed-11 | 15x3x5 → 11x3x5 | 70 → 60 | 113 → 103 | - → - | 0 → 0 |
| mixed-12 | 11x3x5 → 9x3x5 | 55 → 50 | 110 → 105 | - → - | 0 → 0 |
| mixed-13 | 13x1x5 → 9x1x5 | 55 → 44 | 127 → 114 | - → - | 0 → 0 |
| mixed-14 | 10x2x5 → 7x2x5 | 46 → 39 | 354 → 327 | - → - | 0 → 0 |
| mixed-15 | 9x5x7 → 8x5x7 | 47 → 45 | 80 → 78 | - → - | 0 → 0 |
| mixed-16 | 9x3x5 → 7x3x5 | 55 → 50 | 247 → 234 | - → - | 0 → 0 |
| mixed-17 | 15x3x5 → 10x3x5 | 68 → 55 | 464 → 423 | - → - | 0 → 0 |
| mixed-18 | 16x5x9 → 10x5x9 | 63 → 49 | 540 → 477 | - → - | 0 → 0 |
| mixed-19 | 19x3x5 → 12x3x5 | 87 → 65 | 853 → 663 | - → - | 0 → 0 |
| fluid-00 | 13x3x5 → 9x3x5 | 82 → 66 | 290 → 263 | - → - | 0 → 0 |
| fluid-01 | 9x3x5 → 8x3x5 | 48 → 46 | 57 → 56 | - → - | 0 → 0 |
| fluid-02 | 17x3x5 → 11x3x5 | 100 → 76 | 532 → 478 | - → - | 0 → 0 |
| fluid-03 | 17x3x5 → 12x3x5 | 79 → 62 | 97 → 82 | - → - | 0 → 0 |
| fluid-04 | 17x3x5 → 12x3x5 | 97 → 77 | 201 → 174 | - → - | 0 → 0 |
| fluid-05 | 17x3x5 → 11x3x5 | 101 → 74 | 821 → 689 | - → - | 0 → 0 |
| fluid-06 | 13x2x5 → 9x2x5 | 65 → 51 | 123 → 112 | - → - | 0 → 0 |
| fluid-07 | 13x3x5 → 9x3x5 | 87 → 70 | 174 → 162 | - → - | 0 → 0 |
| fluid-08 | 13x3x5 → 9x3x5 | 82 → 64 | 180 → 163 | - → - | 0 → 0 |
| fluid-09 | 14x2x5 → 9x2x5 | 67 → 50 | 622 → 563 | - → - | 0 → 0 |
| **all AE2 (sum)** | — | **2,760 → 2,097** | **38,182 → 15,021** | **3 → 2** | **0 → 0** |

Cable sum 1,505 → 1,128 (−25.0 %); interface sum 228 → 228 (every machine keeps its interface).
Sums: total blocks −24.0 %, cable −25.0 %, lossEUt −60.7 % (the shorter cable paths cut voltage drop,
so `loss-40` loses 4,412 EU/t instead of 24,988 and `loss-10` sheds its weak LV tier entirely).

**Rows that got longer, lossier, weaker, or gained a feed warning: none.** All 33 rows shrank and
every row's loss fell. `route_failed` is unchanged at 2 (fluid-02 and fluid-07, one each, from the
committed baseline). Feed warnings are 0 before and 0 after: with targets set, an interface touches
one inventory, so R12 never fires (this is the rule's purpose, preserved by the Wrench target).

RUK-119 estimated ≈ −43 % cable on the 20-machine loss fixture; here `loss-20` cable is 100 → 49
(−51 %), in the same ballpark.

`runBench()` (all 132 lines, 4 modes): **736 ms → 504 ms** (single sample each, shorter lines).

## Tests it breaks

With changes 1+2 only (`targets`, spacing still 2): 8 failures, 809 passed — no layout numbers
change (`layout-bench.test.ts` passes); every failure is a test asserting the exact feed content.

With all 3 changes (spacing 1): **16 failed, 800 passed, 105 skipped** (`npx vitest run
tests/unit/layout`, 14.4 s):

| test | first line of failure | cause |
| --- | --- | --- |
| `bench.test.ts > the Auto Workbench in a line > AE2: one pattern exactly equal to the grid, blocking mode off and a Locking Card` | `AssertionError: expected { interface: { …(4) } } to deeply equal { interface: { …(3) } }` | feed now carries `targets: ['south']` |
| `feed-ae2.test.ts > AE2 feeding > writes patterns of the item inputs used up and the whole item outputs every run gives` | `AssertionError: expected [ [ …(3) ] ] to deeply equal [ [ …(3) ] ]` | feed now carries `targets: ['north']` |
| `feed-rules.test.ts > static feeding rules > AE2 patterns (R8, R9, R12) > finds patterns AE2 cannot encode, blocking mode toward a held item it does not ignore, and an interface touching two inventories` | `AssertionError: expected [] to deeply equal [ { code: 'feed_leak', …(2) } ]` | R12 suppressed by the target (intended effect) |
| `head-choice.test.ts > power head choice > lays the 20-machine ae2 line with the middle head` | `AssertionError: 20 ae2: headX: expected false to be true // Object.is equality` | the spacing-1 line is short enough that the west head now wins |
| `middle-head.test.ts > middle power head > drops the worst LV path below the west head` | `AssertionError: expected 25 to be 44 // Object.is equality` | hard-coded spacing-2 path lengths (worst LV path is 25 at spacing 1) |
| `mode-network.test.ts > AE2 mode > puts an ME interface in front of every machine, cable between, and counts channels` | `AssertionError: expected [ [ 1, 'interface', …(1) ], …(3) ] to deeply equal [ [ 1, 'interface', …(1) ], …(5) ]` | interfaces now adjacent, no cable column between |
| `mode-network.test.ts > AE2 mode > puts no interface in front of a machine that moves only fluids, and an ME Export Bus in front of one that makes only fluids` | `AssertionError: expected [ [ 1, 'interface', undefined ], …(3) ] to deeply equal [ [ 1, 'interface', undefined ], …(5) ]` | same spacing geometry |
| `mode-network.test.ts > AE2 mode > gives a shared machine one ME interface with a pattern per step` | `AssertionError: expected { interface: { …(3) } } to deeply equal { interface: { …(2) } }` | feed now carries `targets: ['north']` |
| `feeding/precheck.test.ts > precheckFeeding > flags an interface touching two inventories` | `AssertionError: expected [] to deeply equal [ Array(1) ]` | R12 suppressed by the target (intended effect) |
| `feeding/precheck.test.ts > precheckFeeding, the other branches > names the buses an interface touches` | `AssertionError: expected [] to deeply equal [ Array(1) ]` | R12 suppressed by the target (intended effect) |
| `feeding/read.test.ts > readLine > reads AE2 patterns from the plan steps` | `AssertionError: expected [ '3,0,2', '4,0,2', '5,0,2' ] to deeply equal [ '3,0,2', '5,0,2', '7,0,2' ]` | interface ids at spacing 1 |
| `feeding/read.test.ts > readLine > reads a rotated line in the local frame` | `TypeError: Cannot set properties of undefined (setting 'feed')` | test looks up an interface at a spacing-2 position |
| `feeding/read.test.ts > readLine > reads an ME Export Bus` | `AssertionError: expected [ '3,0,2', '4,0,2', '5,0,2' ] to deeply equal [ '3,0,2', '5,0,2', '7,0,2' ]` | interface ids at spacing 1 |
| `feeding/read.test.ts > readLine > reads ME Export Bus cards and facing, and a bus that feeds nothing` | `AssertionError: expected [ { id: '3,2,1', …(4) }, …(1) ] to deeply equal [ { id: '3,2,1', …(4) }, …(1) ]` | hand-built bus at 5,1,3 no longer has an inventory behind it in the new row packing |
| `feeding/read.test.ts > readLine > reads the structured patterns of an AE2 line as main lays it` | `AssertionError: expected [ [ '3,0,2', …(2) ], …(2) ] to deeply equal [ [ '3,0,2', …(2) ], …(2) ]` | ids shifted + `targets` added |
| `feeding/read.test.ts > readLine > reads the ME Export Bus main lays on the cable in front of a machine that makes only fluid` | `AssertionError: expected [ { id: '2,0,2', …(4) } ] to deeply equal [ { id: '3,0,2', …(4) } ]` | bus id at spacing 1 |

## Verdict

Spacing 1 + per-machine Wrench targets is a clean win on the benchmark: every AE2 line shorter,
cable −25 %, loss −61 %, one weak tier cured, no feed warnings, no longer/lossier/weaker row, and
the bench runs 32 % faster. Nothing regressed. The 16 broken tests are all spacing-2/feed-content
assertions (positions, exact feed objects, hard-coded R12 and LV-path numbers) — updating them is
out of scope for this spike (it is the M2 task's work).

## Applying

`git apply --check spikes/ae2-spacing-1/change.patch` passes on `origin/feat/optimal-layout`.
The patch alone changes layout output: AE2 lines get interfaces in every column, so apply it
together with the 16 test updates, not on its own.
