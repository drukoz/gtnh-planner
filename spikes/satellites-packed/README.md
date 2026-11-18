# Satellites on a packed box (spike SP-J, RUK-3023)

`spikes/reach-ae2-promote/` closed with "the packed box has no room for a satellite — until satellites can stand
beside a packed box (spike SP-J)". This spike measures why there is no room, tries the two variants the spec lists
(J1, J2), and finds the premise is not quite the fault: `planSatellites` **does** find cells on the packed box and
**does** plan a satellite there. The satellite is then dropped by the power route, because its supply input is
rimmed in. Nothing here promotes: no variant lowers a benchmark row.

Measured on `feat/optimal-layout-m3` at `13e124a04` with `spikes/reach-ae2-promote/a.patch` + `b.patch` applied
(the state `spikes/reach-ae2-promote/README.md` describes; its 7 test pins are the RUK-3021 test commit, which this
branch is 3 commits behind).

## What was measured (`loss-40`, satellites on, `lossLine(40, mode, { satellites: true })`)

| mode | chosen | size | loss EU/t | unpowered | weak tiers | unreachable | satellites laid |
|---|---|---|---|---|---|---|---|
| ae2 | 0 (west line) | 5x4x44 | 2 052 | 0 | — | 0 | 5 at `16,1,2 24,1,2 30,1,2 36,1,2 41,1,2` |
| direct | 5 | 5x3x15 | 1 167 | 0 | — | 0 | 1 at `12,1,3` |
| enderio | 5 | 5x3x15 | 1 167 | 0 | — | 0 | 1 at `12,1,3` |

The kept line is never a packed box, so no satellite of the packed candidate is ever laid. Both packed candidates
`loss-40` builds do plan one (`spikes/reach-ae2/README.md`, Satellites, gives the phase-1/phase-2 split):

| candidate | far ports | satellite planned | skips in the cell search | phase 1 | phase 2 |
|---|---|---|---|---|---|
| `Packed 19x2x3` (direct, EnderIO, AE2) | 1, x=16 | cell `16,2,1`, input `16,3,1`, output `15,2,1` (west) | cell taken 4, input taken 1, outside box 4, output taken 4, no free output side 1 | satFail **false**, 734 EU/t | satFail **true**, 724 |
| `PackedOpen 19x2x5` (AE2) | 4, x 15..16 | cell `15,1,1`, input `15,2,1`, output `14,1,1` (west) | cell taken 6, outside box 4 | satFail **false**, 814, weak 1 | satFail **true**, 778 |

## GT checks, per satellite on the packed box

The GT rule (`docs/research/gt-mechanics.md`, "Transformers"): the input is the cell above the transformer, the front
faces it, the other five faces are LV, and no lower-tier machine may touch an LV face. Measured on the candidates
above, over all 58 satellite routings of the three `loss-40` lines:

| check | result |
|---|---|
| input is the cell above, front faces it | ok — every planned satellite is `cell`, `input = cell + up` |
| no lower-tier machine touches the LV faces | ok — every packed candidate reports `lowerTierMachines = 0` |
| the satellite's LV tree reaches its group's ports | ok — 0 port failures in 58 routings |
| the supply (MV) tree reaches the satellite's input | **fails on every packed candidate** — 58 supply failures; the 5 satellites of the kept AE2 line all pass |

So the box's top row is not the problem: it is free, it is searched, and it is chosen. The failure is one leg, in
`growTrees` (`src/server/layout/internal.ts`, "the satellites' supply inputs hang off this tier's tree").

## Why the supply feed is rimmed in (`Packed 19x2x3`, direct, loss-40)

The satellite stands at `16,2,1` (the box's top row) and its input is `16,3,1`. The MV tree's reachable region from
the head covers 198 cells, reaches x 18 and the planes y 3, 4 and 5 — the bounds (`h + 1 + 2 + 2` with satellites)
are not the limit. The input itself is refused: of its six neighbours, `16,2,1` is the satellite's own cell (the one
neighbour `passInput` waives) and `16,3,0` is **the tier-1 lane tree's cell** — taken, and in the tier-2 tree's
`avoid` set. `passInput` refuses any input that touches another tier's cable, so the input is walled.

The tier-1 tree is on y 3 because every plane under it is rimmed: y 1 is the item lanes' row and y 2 touches the
macerator faces (`powerCell` of every tier-1 machine joins `avoid`). On a normal row the tier-1 tree stays at y 1, the
satellite's input at y 2, and the MV feed has y 3 — one plane each, which is what the bounds' `+ 2` pays for. On a
packed box the tier-1 tree needs two planes above the box, so the satellite's input lands on the tier-1 tree's plane
and there is no plane left for its feed.

## J1 — fix the cell rule that blocks the box's top row

Measured: no rule blocks it. The search's skips on the packed candidates are only `cell taken`, `outside box`,
`input taken`, `output taken` and `no free output side`, all of which are the box's edges and its own machines; the
top-row cell is picked in both columns (`16,2,1` and `15,1,1`). **No patch** — there is nothing to fix, and the
premise "one group with no cell makes `planSatellites` return `[]`" did not reproduce (`planSatellites` returns a
satellite, and `routePower` phase 2 drops it).

## J2 — one satellite row beside the box (`j2.patch`)

`placePacked(..., { satRow })` stands the box, its lanes, its tail and its item ports one cell north, leaving z 0
free; `Placement.satRow` tells the AE2 mode to shift its lane, join and bridge cells by the same amount (direct and
EnderIO read the shifted `Placement.spine`, so they need nothing). Laid behind `SPJ2_SATROW=1` in `buildLocalAt`, so
the search offers the deeper box as its packed candidate in all three modes. It routes cleanly (no overlap, no
`route_failed`, no new warning code).

Full benchmark (`runBench()`, `bench-j2.json`, against the same run with the flag off; 117 of the 132 rows are
byte-identical):

| row | mode | base | J2 |
|---|---|---|---|
| loss-10 | direct | 29 blocks / 164 / `3x2x9` | 31 / 164 / `4x2x9` |
| loss-10 | ae2 | 52 / 196 / `5x3x9` | 53 / **262** / `5x2x10` |
| loss-10 | enderio | 38 / 164 / `3x2x9` | 40 / 164 / `4x2x9` |
| loss-20 | direct | 38 / 394 / `3x2x12` | 40 / 394 / `4x2x12` |
| loss-20 | ae2 | 61 / 394 / `5x3x12` | 63 / **404** / `6x3x12` |
| loss-20 | enderio | 45 / 394 / `3x2x12` | 47 / 394 / `4x2x12` |
| mixed-05 | direct | 34 / 585 / `6x2x3` | 35 / 585 / `6x2x4` |
| mixed-05 | enderio | 34 / 585 / `6x2x3` | 35 / 585 / `6x2x4` |
| mixed-09 | ae2 | 34 / 362 / `5x3x3` | 34 / **381** / `6x1x5` |
| mixed-13 | direct | 34 / 93 / `7x2x3` | 36 / 93 / `7x2x4` |
| mixed-13 | ae2 | 37 / 93 / `7x3x3` | 39 / 93 / `7x3x4` |
| mixed-13 | enderio | 34 / 93 / `7x2x3` | 36 / 93 / `7x2x4` |
| mixed-14 | direct | 31 / 283 / `5x2x3` | 31 / **286** / `4x2x5` |
| mixed-14 | ae2 | 34 / 283 / `5x3x3` | 35 / 283 / `5x3x4` |
| mixed-14 | enderio | 31 / 283 / `5x2x3` | 31 / **286** / `4x2x5` |

**0 rows better, 4 lossier, 13 longer or deeper, and `loss-40`'s chosen lines in all three modes unchanged** (same
chosen index, size, loss and satellite list as the table above). The free row buys the box a cell of depth it never
uses, and on the short AE2 rows it pushes the search onto the packed column, which is what the spike has been
avoiding all along. A free row beside the box is not where the satellite's plane is lost — the loss is in y, not z.

## Whole suite (`npx vitest run --maxWorkers=2`)

4 445 passed, 7 failed, 266 skipped (4718), 85 s. All 7 are the pins `spikes/reach-ae2-promote/README.md` lists for
`a.patch` + `b.patch` (`score.test.ts` ×3 `weakTiers`/the weak-tier guard, `packed.test.ts` ×2 AE2 packed candidates,
`layout-search.test.ts` ×1 the runner-up, `layout-bench.test.ts` ×1 the 40-machine AE2 numbers) — they are re-pinned
in `52c0b4526`/`61b894322`, which `origin/feat/optimal-layout-m3` has and this branch does not. Real faults caused
here: 0. With the J2 change stashed the four files pass at HEAD (33/33), so none of the 7 is J2's.

## Verdict

Nothing to promote: J1 has no rule to fix, J2 is measured and worse on every row it touches. The blocker for
satellites on a packed box is not the box's footprint and not the cell search — it is that a packed box pushes its
tier-1 tree two planes above the casing, onto the plane where a satellite's supply input has to sit, and
`growTrees`' `passInput` rightly refuses a satellite input that touches the tier-1 cable.

**Follow-up (SP-K?):** give the satellite feed a plane of its own on a packed box, in `growTrees` — either open the
bounds by the plane the tier-1 tree really occupies (measure it per line instead of `h + 1 + 2·runs`) or grow the
satellite inputs off a riser that comes down from above the tier-1 plane. Box geometry needs nothing: J2's free row
is pure cost.

## Reproducing

`j2.patch` applies after `a.patch` + `b.patch`. With it applied, `SPJ2_SATROW=1` lays the packed candidate one cell
deeper with z 0 free; without it, every number is the promoted baseline. The measurements above came from throwaway
files (`SPJ_TRACE` logging in `planSatellites` and `routeInternal`'s satellite legs, plus a `lossLine`/`runBench`
report test), all deleted before this commit; `bench-j2.json` is `runBench()` with the flag on, 132 rows.
