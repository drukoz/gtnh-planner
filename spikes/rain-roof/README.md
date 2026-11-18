# Rain and the roof over it (RUK-3026, design goal 7)

GT rains on machines that stand under open sky: a single-block machine, a transformer and an energy hatch each holds an
EU buffer, and rain on an exposed face shorts it (`docs/research/gt-mechanics.md` §3.4a "Planner use."). A line needs a
roof only over those faces, and today's `roof.ts` step lays a full slab over the whole footprint (`Box`) with a fixed
one-block gap. This spike asks what a roof that covers only the exposures costs, and where the gap can close. Measured
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

- **Box** (`0`) — the footprint grown one cell on each side, at `H`: what today's `roof.ts` lays.
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
- **Lowest lays the same number of cells as Flat in all 132 rows.** The gap Flat leaves (one block above the tallest
  machine) is free: no column in this benchmark has a machine tall enough under a low exposure to force the cover lower.
  Lowest drops each column to `block y + 1` where it can, never under a block or into a reserved cell, and the count is
  identical — the roof is one slab at the same height here.
- **Every checked block that is exposed is covered by every rule.** For all 132 rows × 3 rules, after laying the rule's
  cells as blocks, no checked block has any exposed face left (asserted), and no roof cell lands on an existing block or
  a reserved cell.

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

## Verdict

A Flat (or Lowest) roof costs ~14 % of Box's blocks, covers every rain exposure, never lands on a block, a reserved cell,
or a machine's builder side, and does not change which line the search picks. The roof belongs in the length, not in the
line search: lay it after the line is chosen, one slab at `H`. Lowest buys nothing over Flat on this benchmark, so Flat
is the rule to promote; keep Lowest's per-column drop for tall lines where a low exposure sits under a high machine.
The next step (a later RUK) folds `roofCells` into `roof.ts` and the final measure, behind the site's own cover.
