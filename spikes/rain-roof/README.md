# Rain and the roof over it (RUK-3026, design goal 7)

GT rains on machines that stand under open sky: a single-block machine, a transformer and an energy hatch each holds an
EU buffer, and rain on an exposed face shorts it (`docs/research/gt-mechanics.md` §3.4a "Planner use."). A line needs a
roof only over those faces, and today's build step (`src/server/layout/steps.ts:229-237`) asks for a full slab over the
whole footprint (`Box`) and counts no roof block. This spike asks what a roof that covers only the exposures costs, and where the gap can close. Measured
on `feat/optimal-layout-m3-RUK-3026` (the merged SP-K reach work), 132 benchmark layouts (33 lines × 4 modes).

Nothing here is promoted. `src/server/layout/rain.ts` is the one committed file: the pure exposure test and the three
roof rules, with `tests/unit/layout/rain.test.ts`. The score integration that measures the roof's cost is a throwaway
patch (`roof.patch`, `SPR_ROOF=1` Flat, `=2` Lowest), reverted before commit; `bench-roof.json` is the census.

## What a roof must cover

`rainChecked` picks the blocks rain is checked against: every `machine` block of a unit with `electric` true and
`multiblock` false (a GT singleblock, matched by its placed cell `at`), every `transformer`, and every `hatch` whose
hatch is `energy`. A multiblock controller (no buffer), a steam machine, and every unbuffered block (cable, pipe, bus,
item/fluid hatch, chest, interface, casing) are exempt. `rainExposures` reports the faces rain reaches: `top` when no
block sits anywhere above in the column, and each horizontal side whose neighbour column has nothing at that level. The
spike assumes open sky everywhere — a neighbour column outside the line's box is sky, so an edge machine has its outward
side exposed. Site cover and dimensions come later.

Three rules lay cells (`roofCells`), all at `H = size[1]` (one above the tallest block) unless stated:

- **Box** (`0`) — the footprint grown one cell on each side, at `H`: what today's build step asks for.
- **Flat** (`1`) — at `H`, only the columns that cover an exposure: each top-exposed machine's own column, each exposed
  side's neighbour column, deduplicated.
- **Lowest** (`2`) — the same columns as Flat, each at the lowest `y ≥` (the highest exposed block it covers + 1) that
  holds no block and is no reserved cell (`placement.reserved`: a muffler front, a steam vent, a multiblock hollow).

## The census (`bench-roof.json`, 132 rows)

Checked blocks, exposed faces, and the cells each rule lays, summed over the 33 lines of each mode:

| mode | checked: single / trans / energy hatch | exposed tops | exposed sides | Box | Flat | Lowest |
|---|---|---|---|---|---|---|
| direct | 227 / 60 / 9 | 160 | 210 | 2551 | 336 | 336 |
| routed | 227 / 67 / 9 | 190 | 400 | 3106 | 427 | 427 |
| ae2 | 227 / 67 / 9 | 184 | 383 | 2996 | 433 | 433 |
| enderio | 227 / 60 / 9 | 188 | 218 | 2551 | 368 | 368 |
| **all** | **908 / 254 / 36** | **722** | **1211** | **11204** | **1564** | **1564** |

- **Flat covers every exposure at ~14 % of Box's cells.** 1564 against 11204 — a **7.2×** reduction. Box pays for the
  air around the line (its slab is the whole footprint grown a cell each side, on a line up to 44 long); Flat pays only
  for the 1933 exposed faces (722 tops + 1211 sides), 1.6 faces per checked block, deduplicated into columns.
- **Lowest lays the same number of cells as Flat in all 132 rows — by construction.** Both rules cover the same
  columns with one cell each, so the count can never differ; only the cells' heights do. Lowest drops each column to
  `block y + 1` where it can (never into a block or a reserved cell), so its roof is stepped, not one slab at `H`
  (the 2 extra `read.test.ts` re-pins under `SPR_ROOF=2` are those lowered cells). Height, not count, is what Lowest
  changes; this census does not measure it.
- **Every checked block that is exposed is covered by every rule.** For all 132 rows × 3 rules, after laying the rule's
  cells as blocks, no checked block has any exposed face left (asserted), and no roof cell lands on an existing block or
  a reserved cell.

The 10 rows with the most roof cells (by `Flat`; `Lowest` ties every one, and each row's `Box` is its footprint × 1 slab):

| line (mode) | size | tops | sides | Box | Flat | Lowest |
|---|---|---|---|---|---|---|
| loss-40 (ae2) | 44×4×5 | 35 | 90 | 322 | 78 | 78 |
| loss-40 (routed) | 44×4×5 | 35 | 89 | 322 | 77 | 77 |
| loss-20 (routed) | 15×2×5 | 14 | 40 | 119 | 28 | 28 |
| loss-40 (direct) | 15×3×5 | 23 | 5 | 119 | 28 | 28 |
| loss-40 (enderio) | 15×3×5 | 23 | 5 | 119 | 28 | 28 |
| loss-20 (direct) | 12×2×3 | 9 | 18 | 70 | 27 | 27 |
| loss-20 (enderio) | 12×2×3 | 9 | 18 | 70 | 27 | 27 |
| mixed-00 (ae2) | 13×3×5 | 10 | 21 | 105 | 22 | 22 |
| mixed-00 (routed) | 13×3×5 | 10 | 20 | 105 | 21 | 21 |
| loss-10 (routed) | 10×2×5 | 11 | 20 | 84 | 20 | 20 |

The two `loss-40` rows that stack their machines two-high (ae2, routed) pay the most: Box grows with the 44×5 footprint,
Flat grows with the 35 stacked tops and ~90 side faces, and the gap to Box widens (322 → 77).

## Thin-only covers (step 3)

GT's rain test reads real blocks; a stone pipe in a column covers the exposure beside it. Counting an exposure as covered
only because a thin block (`pipe`, `chip_pipe`) sits in the covering column: **zero** tops and **zero** sides across the
132 rows are covered by a thin block alone. Every exposure a neighbour covers is covered by a solid block, so the census
roof is not inflated by counting a thin-block cover as an exposure — no thin-cover discount was needed.

## Reach with the roof on (step 4, design goal 3)

`unreachableMachines` over each laid line, and again with each rule's cells added as blocks (spine at y 1, machines at
y 0, roof at `H ≥ 2`):

| mode | none | Box | Flat | Lowest |
|---|---|---|---|---|
| direct | 0 | 0 | 0 | 0 |
| routed | 0 | 0 | 0 | 0 |
| ae2 | 6 | 6 | 6 | 6 |
| enderio | 0 | 0 | 0 | 0 |

A roof adds **no** machine to the unreachable set in any row (the 6 in `ae2` are the pre-existing packed-AE2 walled
machines, unchanged). A cover at `H`, one above the tallest block, is never the block beside a machine face, so it never
closes the side a builder needs. Lowest drops covers to `block y + 1` and still changes nothing: the lowered cells land
in columns beside machines at `y ≥ machine top + 1`, above the builder's reach at the machine's own level.

## The roof in the score (`roof.patch`, throwaway, `SPR_ROOF`)

`roof.patch` lays each candidate's roof as casings in its own grid and re-scores it with the roof cells added to the
length the search ranks by (`SPR_ROOF=1` Flat, `=2` Lowest; unset = no roof). Run over the 132 rows:

- **Unset is inert:** all 132 rows are byte-identical to `baseline.json` (total and size), so the integration changes
  nothing when the flag is off.
- **Flat and Lowest add 1564 casings each** (the laid count 2572 minus the 1008 multiblock casings the `EBF` lines already
  lay) — **20 %** on top of the benchmark's 7747 length, ~12 blocks a line, up to **78** on `loss-40` and **72–75** on
  `mixed-02`. Counting Box's 11204 (a 145 % increase) is why today's slab is avoided.
- **The roof changes no chosen line.** No row's `size` moves, and no row gains a weak tier, an unpowered machine, or an
  unreachable machine, in Flat or Lowest. The roof cost falls on every candidate in a line's search in proportion to its
  machine count, so the ranking is untouched — the roof is a cost added to the winner, not a reason to pick a winner.

## Re-pins a promotion needs (step 6)

The whole suite with the probe applied: `SPR_ROOF=1 npx vitest run --maxWorkers=2` fails **19 tests in 6 files**;
`SPR_ROOF=2` fails **21** — the same 19 plus 2. With the flag unset the suite passes (4461 tests, 277 files).

| file | failing tests (flag on) | why |
|---|---|---|
| `head-choice.test.ts` | 12 — lays the 10- and 20-machine {direct, routed, ae2, enderio} line with the west head, the 40-machine … line with the middle head | the pinned head placement re-reads the line with roof casings in the grid |
| `layout-bench.test.ts` | 2 — measures the 10-machine direct loss line; no benchmark line gets longer, lossier or weaker than the baseline | the baseline's `total` has no roof; the roof is the whole 20 % delta |
| `layout-search.test.ts` | 1 — the layout search keeps the runner-up when it is shorter once hooked up | the ranked lengths gain roof cells, so the runner-up's margin moves |
| `layout.test.ts` | 1 — layoutLine lays out a two-step line next to the base, wired from the tap through a transformer | the pinned block list gains the roof casings |
| `packed.test.ts` | 1 — lays a packed line with two products up its tail column | the pinned layout includes the roof |
| `scene-links.test.ts` | 2 — draws each of many links … as an arc of its own …, clear of every block; draws no link through a solid block of the line, in every mode and at every turn | the 3D view must draw links clear of the new roof blocks |
| `read.test.ts` (`SPR_ROOF=2` only) | 2 — readLine reads an ME Export Bus; reads ME Export Bus cards and facing, and a bus that feeds nothing | Lowest drops a cover to `y+1` beside a packed bus, changing the cell the reader reads next to it |

`runBench()` (the bench file, 6 tests) runs in **4.25 s flag off** and **5.21 s with `SPR_ROOF=1`** (+1 s, ~23 %; the 2
bench re-pins fail inside the flag-on run).

## What the laid roof does to each goal

- **Goal 1, the score** — the roof counts in `total` (+1564 casings, +20 %) and changes no chosen line: the cost falls
  on every candidate in proportion to its machines, so the ranking is untouched.
- **Goal 2, shared cable** — the roof adds no cable: it is casings only, and no roof cell lands on an existing block,
  so no cable count moves (tiers never touch: a roof cell never touches a run).
- **Goal 3, reach** — a cover at `H` is never the block beside a machine face: the unreachable set is unchanged in all
  132 rows (the 6 pre-existing ae2 machines stay exactly the 6).
- **Goal 4, machine reuse** — untouched: sharing is decided at placement; the roof lands in air cells above the line.
- **Goal 5, cleanrooms** — untouched: roof cells land at `H` above the line, never inside a shell, and cover the room's
  machines by the same rule as every other exposed one.
- **Goal 6, wall sharing** — untouched: the roof only adds new air cells and claims no block, so it creates no shared-wall
  demand, and every reserved cell (muffler front, vent, `-` hollow) stays air — asserted, no roof cell in a reserved cell.
- **Goal 7, rain** — this spike is its measurement: Flat covers every rain exposure at ~14 % of Box, reserved cells stay
  clear, and the roof counts in the score — the goal's "covers … and counts those blocks" now has numbers.
- **Goal 8, existing projects** — no re-layout: the roof changes no chosen line, so existing projects keep their layouts;
  only the build list grows.
- **Goal 9, the machine estimate** — the estimate has no roof term; the roof scales with rain-exposed machines
  (~1.3 cells per checked block), so a promotion adds a roof line to the BOM, not a per-machine constant.
- **Goal 10, what the user sees** — the 3D view must learn the roof: the 2 `scene-links` re-pins are exactly the view
  drawing links clear of the new blocks; the build steps' words stay out of scope.

Anti-goals:

- **A machine left open to rain** (a layout unbuildable as drawn) — the roof is what fixes it: today's flag-off line
  leaves every checked block's top and outward side open; with the roof, none stays exposed.
- **A machine the player cannot reach** — the roof adds none, in any row, under any rule.
- **Feeding that overfills or deadlocks** — untouched: roof cells are new air cells, never a reserved or feed cell.
- **A different layout per run, or a much longer layout** — the rules are deterministic (sorted cells, no state), and
  the bench costs +1 s (+23 %) with the roof scored.
- **Any test line longer than today's** — no row's chosen size moves; the roof grows the total, not the line.

## Verdict

A Flat (or Lowest) roof costs ~14 % of Box's blocks, covers every rain exposure, never lands on a block, a reserved cell,
or a machine's builder side, and does not change which line the search picks. The roof belongs in the length, not in the
line search: lay it after the line is chosen, one slab at `H`. Lowest lays the same cell count as Flat (always: same columns) and costs
2 more re-pins (21 vs 19), so **Flat is the rule to promote**; keep Lowest's per-column drop for tall lines where a low
exposure sits under a high machine. A promotion re-pins the 19 tests above (block lists, bench totals, the 3D view). The
next step (a later RUK) folds `roofCells` into the line's final measure and the roof build step, behind the site's own cover.

## CTO addendum: the promotion (`promote.patch`, for M3-13)

**A correction to "the roof changes no chosen line".** `roof.patch` laid the roof as `casing` blocks, but `scoreLine`
counts only `LENGTH_ROLES` (`cable`, `pipe`, `interface`, `chip_pipe`), so the search never saw the roof: only the
benchmark's `total` did. Counted in the score for real, the roof changes the chosen line on 11 of 132 rows.

**The overhang.** Flat covers an outward side from the column beside it. On a machine (or head transformer) at the
box's west, north or south edge that column is outside the box: about 10 % of all roof cells over the benchmark's
candidates (x < 0: 406, z < 0: 322, z ≥ L: 113, inside: 8280). So the line's box grows by one cell on each side where
the roof overhangs, and a `shift` carries local cells into the grown box.

What `promote.patch` does (on top of `k1-fallback.patch`):
- `BlockRole` gains `'roof'`; `PART_DEFS.roof` is `Glass` (`minecraft:glass@0`): any block that blocks movement covers
  a face (gt-mechanics §3.4a), and glass keeps the line in view. The 3D colour and map colour get a `roof` entry.
- `buildLocalAt` lays `roofCells(..., RoofRule.Flat)` as `roof` blocks, one above the tallest block, and the line is one
  taller. `LocalLine.shift` is `[1 or 0, 0, 1 or 0]` (overhang west, north) and `size` includes the overhang on all sides.
- `Frame.shift`: `worldPos` adds it, `worldBoxOf` spans the grown box. The site request's power and logistics ports and
  the farm areas move by it. Hookups keep out of the placement's own box only (`cornersBox`); the overhang's blocks are
  obstacles like every other line block. `LayoutDeps.localLine` also gets `shift`.
- `LENGTH_ROLES` gains `'roof'`, so the roof counts in the search's `total` and in the finished check.
- The bench's `LengthReport` gets `roof`, counted in `total`. BOM: `roof` → "rain roof", group `one-off`.
- Every roof block belongs to the `layout:roof` build step. The roof step names the height under the roof.
- The 3D links treat a roof block as see-through (`solidColumns`, `arcsThroughBlocks`).

Measured at `ba25edeff` + `k1-fallback.patch` + `promote.patch` (`baseline-promote.json`):
- Per mode, total / roof / loss: direct 1765 → 2098 / 331 / 10146 → 10176; routed 2141 → 2509 / 366 / 10991 → 10837;
  ae2 2015 → 2385 / 367 / 10734 → 10537; enderio 1710 → 2075 / 363 / 10146 → 10176.
- 121 rows: `total` grows by exactly the row's roof and `lossEUt` is unchanged. 11 rows choose another line:
  `mixed-05` (direct, ae2, enderio), `mixed-14` (direct, enderio), `mixed-17` (routed, ae2), `mixed-19` (routed, ae2),
  `fluid-03` (direct, enderio). No row gains an unpowered or unreachable machine, a failed route or a weak tier.
- Whole suite: 10 tests fail, all pins (listed in RUK M3-13's spec). `npx tsc -b` clean.
