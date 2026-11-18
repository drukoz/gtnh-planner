# Spike SP-G: the packed AE2 line, one ME Interface per machine (RUK-2975)

Parent: RUK-2975 (M3 optimal layout), on the SP-C probe (`spikes/packed-candidate`) and SP-F's packed logistics
(`spikes/packed-logistics`).

SP-E laid a packed line: three machines hang off every cable cell of one lane, A at `[x, 0, 0]` (front north), B at
`[x, 0, 2]` (front south) and T at `[x, 1, 1]` (front north), and SP-F gave `direct` and `enderio` item logistics on
the lanes above them — one shared port cell `[x, 1, 2]` per column. **AE2 may not share it**: `PORT_SPACING.ae2` is 1,
so every machine needs its own interface. This spike lays that column: interfaces at `[x, 1, 0]` (A), `[x, 1, 2]` (B)
and `[x, 2, 1]` (T), each wrenched **down** into its own machine, ME glass cable on the rest of those three lanes, the
lanes joined at `[tailX, 1, 1]`, and the line's ME port at the south lane's tail cell `[tailX, 1, 2]` — on the box's
face. The prototype is `change.patch` next to this file; it **includes SP-C's probe lines** (`CandidateKind.Packed`,
the `PROBE_PACKED` gate, the packed candidate in the search) and applies to a clean tree on its own. `src/` in the
committed tree is untouched.

## Verdict

**Promote.** The packed candidate wins 4 of the 7 qualifying bench rows in `ae2` and loses none: over those 7 rows the
laid line goes **558 → 547 blocks (−2.0%)** and **4,365 → 4,273 EU/t**, and over the 4 rows it wins **154 → 143
(−7.1%)** and **1,415 → 1,323 EU/t (−6.5%)**. Every one of those rows, and every non-qualifying row, lays with **zero
overlaps, zero tier contacts, zero interface-target offenders and zero ME interfaces off the network**. On the
40-machine wiring line (`lossLine(40, 'ae2')`, the line the committed wiring checks measure) the win is large: **150 →
75 blocks (−50%)**, cable **87 → 20**, loss **1,687 → 958 EU/t (−43%)**, **10 unpowered machines → 0**, box **5×3×27 →
3×3×19**, with the same 40 interfaces. One committed test fails, and it fails because the line it pins got better (see
"The failing test").

Three conditions come with it:

1. **AE2 needs its own slot table.** `PACKED_SLOTS_AE2` gives T's machine `facing UP` (so its output pushes up into
   `[x, 2, 1]`, its own interface, and not south into B's) and its interface one cell higher than in `PACKED_SLOTS`;
   the box is therefore 3 high, not 2 (`buildLocalAt` counts the height from the laid blocks, as it does for the
   rising tail).
2. **The Wrench targets do the work.** A full-block ME Interface pushes into every neighbour unless wrenched, and A's
   and B's interfaces touch T's machine. Every interface gets `feed.interface.targets = [down]`, exactly its own
   machine: the harness checks every interface has one target, that it points into a machine, and that no machine has
   two interfaces aimed at it. 0 offenders on every row.
3. **`layout-bench.test.ts`'s weak-tier pin must be re-pinned** with the change: the 40-machine AE2 line is no longer
   weak-wired (see below).

## What was measured

A temporary harness (`tests/unit/layout/tmp-spike-g.test.ts`, not committed) lays all 33 `benchLines()` in `ae2`
through `layoutLine` twice — 66 rows — with `PROBE_PACKED=0` (BEFORE: the committed search) and `PROBE_PACKED=1`
(AFTER: the same search plus the packed candidate), and reports `lengthOf(layout)` per row (`total` = cable + pipe +
interface + chip + hookup blocks; chest and transformer are reported alongside, never counted). A row qualifies when
`packedLine(placement.units)` holds and all its electric units share one feed tier (`Math.min(u.tier,
stages.supplyTier)`): 7 of the 33.

`lossEUt`, `unpowered` and the layout's `mode` come from `lengthOf`; the chosen candidate and `search.rejected` from
`Layout.search`; the offenders from the laid layout:

- **overlaps** — `overlaps(layout.blocks)`: no cell holds two of the line's blocks. **0** on every row.
- **tier contacts** — `tierContacts(...)` (`tests/helpers/power-loss.ts`), copied into the harness to read each
  machine at `u.powerSide` instead of `u.facing`, because a packed machine is fed from the side its lane runs on.
  **0** on every row.
- **interface targets** — every interface block has exactly one Wrench target, that target points face-to-face into a
  `role: 'machine'` cell, and every machine has exactly one interface aimed at it. **0** offenders on every row, on
  the packed rows and on the rows the search left alone.
- **ME grid** — cable and interface are grid nodes and adjacent grid nodes share a network (AE2 rv3-beta-1073-GTNH's
  grid helper joins adjacent grid tiles; a GT machine is not one), so every interface must reach the line's port cell.
  **0** offenders on every row, packed and not.

The same four checks ran on `lossLine(n, 'ae2')` for n = 10, 20, 40 (`tests/helpers/power-loss.ts`, satellites off,
stacking on — the lines the committed wiring checks measure).

## Per-row totals, qualifying rows (BEFORE → AFTER)

`pipe` is the mode's ME glass cable, `iface` the ME interfaces = the channels the line takes. Chosen kind is
`Layout.search.candidates[Layout.search.chosen].kind`.

| line | total | iface | cable | pipe | hookup | size |
|---|---|---|---|---|---|---|
| loss-10 | 53 → 53 | 10 → 10 | 25 → 25 | 1 → 1 | 17 → 17 | 5x2x10 → 5x2x10 |
| loss-20 | 119 → 119 | 20 → 20 | 85 → 85 | 1 → 1 | 13 → 13 | 5x4x24 → 5x4x24 |
| loss-40 | 232 → 232 | 40 → 40 | 158 → 158 | 1 → 1 | 33 → 33 | 5x4x44 → 5x4x44 |
| mixed-05 | 43 → **38** | 8 → 8 | 17 → 6 | 1 → 5 | 17 → 19 | 7x2x5 → 6x3x3 |
| mixed-09 | 34 → 34 | 4 → 4 | 12 → 5 | 1 → 6 | 17 → 19 | 6x1x5 → 5x3x3 |
| mixed-13 | 42 → **37** | 5 → 5 | 17 → 8 | 1 → 5 | 19 → 19 | 7x2x5 → 7x3x3 |
| mixed-14 | 35 → **34** | 5 → 5 | 12 → 5 | 1 → 5 | 17 → 19 | 5x2x5 → 5x3x3 |

### Power, warnings, channels

| line | lossEUt | unpowered | chosen AFTER | rejected |
|---|---|---|---|---|
| loss-10 | 262 → 262 | 0 → 0 | Stacked | — |
| loss-20 | 636 → 636 | 0 → 0 | WestHead | — |
| loss-40 | 2052 → 2052 | 0 → 0 | WestHead | — |
| mixed-05 | 628 → **585** | 4 → 4 | **Packed** | — |
| mixed-09 | 381 → **362** | 3 → 3 | **Packed** | — |
| mixed-13 | 109 → **93** | 0 → 0 | **Packed** | — |
| mixed-14 | 297 → **283** | 2 → 2 | **Packed** | — |

No row gains or loses a warning code: BEFORE and AFTER carry the same set on every qualifying row (`cable_amps`,
`cable_loss_high`, and on the `mixed-*` rows `ae2_missing`, `no_path`, `power_tier_low`, `terrain_unknown` — all site
and terrain codes the committed rows already carry). No `ae2_channels` warning appears on any row, packed or not: the
interfaces are the channels, and packing does not add one — 8 / 4 / 5 / 5 on the winning rows and 40 on `lossLine(40,
'ae2')`, the same count BEFORE and AFTER.

### Sums

| rows | total | cable | pipe | iface | hookup | lossEUt |
|---|---|---|---|---|---|---|
| 7 qualifying | 558 → 547 (−2.0%) | 326 → 292 | 7 → 24 | 92 → 92 | 133 → 139 | 4,365 → 4,273 (−2.1%) |
| the 4 it wins | 154 → **143** (−7.1%) | 58 → 24 | 4 → 21 | 22 → 22 | 70 → 76 | 1,415 → **1,323** (−6.5%) |
| all 33 rows | 2,138 → 2,127 | — | — | — | — | 11,843 → 11,751 |

The 26 non-qualifying rows are byte-identical to BEFORE: the gate leaves them on the committed path. The columns do
not add to `total`: `lengthOf` counts `cable + pipe + interface + chip + hookup`, chest and transformer alongside
(`tests/helpers/layout-bench.ts`).

## The wiring lines: `lossLine(n, 'ae2')` (satellites off, stacking on)

These are the lines the committed wiring checks measure. The packed line's three machines per cable cell pay here
most:

| line | total | cable | pipe | iface | hookup | lossEUt | unpowered | size | chosen |
|---|---|---|---|---|---|---|---|---|---|
| loss-10 | 53 → 53 | 25 → 25 | 1 → 1 | 10 → 10 | 17 → 17 | 262 → 262 | 0 → 0 | 5x2x10 → 5x2x10 | Stacked |
| loss-20 | 73 → 73 | 40 → 40 | 1 → 1 | 20 → 20 | 12 → 12 | 588 → 588 | 0 → 0 | 5x2x15 → 5x2x15 | Stacked |
| loss-40 | 150 → **75** | 87 → 20 | 5 → 6 | 40 → 40 | 18 → 9 | 1,687 → 958 | 10 → 0 | 5x3x27→3x3x19 | **Packed** |

`loss-40` BEFORE warns `machine_unpowered` (10 machines the LV run could not feed) and its tier-1 run is flagged weak;
AFTER carries `cable_amps`, `cable_loss_high` and `transformer_bank` only, powers all 40 machines, and its tier-1 run
arrives at 16 V over 16 blocks — no longer weak (that is the failing test). Zero offenders on both rows.

## The laid column, cell by cell

`mixed-14` AFTER: 5 machines, `origin 26,64,19`, `rotation 0`, `size 5x3x3`, tail
`{"cell":[3,1,2],"inputSide":0,"outputSide":5}`. Cells are the placement's **local** cells; `conns` are the laid
blocks' connection bits (1 down, 2 up, 4 north, 8 south, 16 west, 32 east); `targets` are the Wrench faces of the
interface.

```
 0,0,0  cable      2x Annealed Copper Cable        conns=8    (power run, head column)
 0,0,1  cable      2x Annealed Copper Cable        conns=44
 0,0,2  cable      2x Annealed Copper Cable        conns=4
 1,0,0  machine    Advanced Assembler              facing up / main north      A
 1,0,1  cable      2x Annealed Copper Cable        conns=62                    the lane the machines hang off
 1,0,2  machine    Advanced Assembler              facing up / main south      B
 1,1,0  interface  ME Interface (Assembler)        targets=down                A's interface, into A
 1,1,1  machine    Advanced Assembler              facing up / main north      T
 1,1,2  interface  ME Interface (Assembler)        targets=down                B's interface, into B
 1,2,1  interface  ME Interface (Assembler)        targets=down                T's interface, into T
 2,0,0  machine    Advanced Chemical Reactor       facing up / main north      A
 2,0,1  cable      2x Annealed Copper Cable        conns=28
 2,0,2  machine    Advanced Chemical Reactor       facing up / main south      B
 2,1,0  interface  ME Interface (Reactor)          targets=down
 2,1,2  interface  ME Interface (Reactor)          targets=down
 2,2,1  pipe       ME Glass Cable - Fluix          conns=48  west+east         T's lane
 3,1,0  pipe       ME Glass Cable - Fluix          conns=24  west+south        north lane's tail
 3,1,1  pipe       ME Glass Cable - Fluix          conns=14  up+north+south    the join
 3,1,2  pipe       ME Glass Cable - Fluix          conns=20  north+west        the port, on the box's south face
 3,2,1  pipe       ME Glass Cable - Fluix          conns=17  down+west         T's lane to the join
```

Every machine has one interface directly above it, wrenched down into it; the three lanes carry cable only where no
interface stands, and meet at `[3,1,1]`; the port `[3,1,2]` is on the box's face.

The 40-machine `lossLine(40, 'ae2')` AFTER, head and tail (local cells; `origin 19,64,11`, `rotation 270`, world
`3x3x19`):

```
 0,0,0..2  cable       2x Annealed Copper Cable          the head's supply run
 1,0,0..2  transformer Low Voltage Transformer ×3        facing west
 2,0,0..2  cable       4x Tin Cable                      the lane, one cell per column
 3,0,0     machine     Basic Macerator   up / north      A    3,1,0  interface targets=down
 3,0,1     cable       4x Tin Cable      conns=62             3,1,1  machine   Basic Macerator  up / north  (T)
 3,0,2     machine     Basic Macerator   up / south      B    3,1,2  interface targets=down
 3,2,1     interface   ME Interface      targets=down         T's interface
   …       columns 3 … 15 are all this shape: 3 machines, 3 interfaces, 1 cable cell
15,0,0..2  machine / cable / machine                      15,1,0 / 15,1,2  interfaces, 15,2,1 interface
16,0,0     machine     Basic Macerator   up / north      A    16,1,0  interface targets=down
16,0,1     cable       4x Tin Cable      conns=20             (the last column takes one machine: 13×3 + 1 = 40)
16,1,2     pipe        ME Glass Cable    conns=48             south lane
16,2,1     pipe        ME Glass Cable    conns=48             T's lane
17,1,0     pipe        ME Glass Cable    conns=24  west+south  north lane's tail
17,1,1     pipe        ME Glass Cable    conns=14  up+north+south  the join
17,1,2     pipe        ME Glass Cable    conns=20  north+west      the port, on the box's south face
17,2,1     pipe        ME Glass Cable    conns=17  down+west       T's lane to the join
```

109 laid blocks: 40 machines, 40 interfaces (the 40 channels), 20 GT cables, 6 ME glass, 3 transformers.

## The failing test

`npx vitest run tests/unit/layout/layout.test.ts tests/unit/layout/layout-bench.test.ts` with the patch applied: **35
pass, 1 fails.** With `PROBE_PACKED=0` the same run is 36/36.

- `tests/unit/layout/layout-bench.test.ts > layout benchmark > flags the 40-machine AE2 line's LV wiring as weak` —
  `expect(lengthOf(layout).weakTiers).toEqual([1])` gets `[]`. It measures `lossLine(40, 'ae2')`, which the packed
  candidate now wins (150 → 75 blocks), and the packed line's tier-1 run arrives at 16 V over 16 blocks: the weak test
  is `worstVolts × 2 < 8 × 4^tier`, and 32 is not below 32. The test pins a defect the packed line fixes, so promotion
  re-pins it (the honest assertion is now "the 40-machine AE2 line is wired without a weak tier and without
  `machine_unpowered`"). `tests/unit/layout/layout.test.ts` passes in full — including the probe patch's own change
  there, which reads a machine's power port on any face but the front, as GT allows, because a packed machine is fed
  from the side its lane runs on (`PlacedUnit.powerSide`).

## What the spike found

- **The interface count does not drop — it cannot.** `PORT_SPACING.ae2` is 1, so the committed spine already stands
  one interface at every machine: `iface` is 92 → 92 over the qualifying rows and 40 → 40 on `loss-40`. The packed
  column wins on **cable, hookup length and volume** — three machines share one cable cell, so the power run is a
  third of the length (87 → 20 cable on `loss-40`) and the power hookup halves (18 → 9), which is also what feeds the
  10 machines the long LV run starved (`unpowered` 10 → 0).
- **The head column's interfaces touch no glass cable, and that is the committed AE2 rule.** `[1,1,0]`, `[1,1,2]` and
  `[1,2,1]` stand in a column whose lane cells are all interfaces. The committed spine does the same thing at
  `PORT_SPACING.ae2` 1: interfaces stand side by side, and the grid joins adjacent grid tiles, so the network runs
  through them. The harness's ME-grid check (cable and interface nodes, adjacency, GT machines not nodes) reaches
  every interface from the port on every row, packed and committed. Laying cable west of the head fixes a problem AE2
  does not have and costs 3 blocks a lane: it made `mixed-09` lose its win and `loss-40`'s win 3 blocks.
- **`targets` is what makes T stand in a packed column.** With `PACKED_SLOTS` (SP-E) T faces south and shares B's port
  cell; AE2 cannot share it, so T faces up, its interface is the cell above it, and its Wrench target is `down`. A's
  and B's interfaces touch T's machine block face to face; without the target each would push its pattern into T as
  well (`feed-rules.ts` feeds every machine a target touches). Every target offender in the harness is 0 because of
  that field.
- **SP-F's box-face rule carries over unchanged.** The port is `Placement.tail.cell` = `[tailX, 1, 2]`, on the box's
  south face; the join cell `[tailX, 1, 1]` stands in an interior column, and a logistics hookup goes round the box's
  columns (`inColumns`, `src/server/layout/hookups.ts`). The packed rows pay **+2 hookup blocks** for the face port
  (17 → 19), which the 11-block win per row pays for many times over.
- **Risers are skipped, as in SP-F.** `itemRisers` climbs the spine column at `spineZ` to y-1 buses; on a packed line
  the ports are the lane cells, so the risers would link the lanes to cells no machine touches.
- **Small lines break even.** `mixed-09` (4 units) ties on blocks (34 → 34) and wins on loss (381 → 362) and volume
  (6×1×5 → 5×3×3): the search keeps the packed line on the replace rule, not on a block win. `loss-10` and `loss-20`
  (bench rows, satellites on) and the two short wiring lines keep their committed line: with satellites the long
  macerator rows are laid out by the satellite code, and the packed candidate loses there — no regression, no win.

## Reproducing

```bash
npm ci
npx tsc -b
git apply spikes/packed-ae2/change.patch   # SP-C's probe + SP-G's packed AE2 column
npx vitest run tests/unit/layout/tmp-spike-g.test.ts    # the temporary harness, /tmp/spike-g*.json
npx vitest run tests/unit/layout/layout.test.ts tests/unit/layout/layout-bench.test.ts
git checkout -- src/                                    # drop the prototype
```

The harness is temporary and is not committed. It keeps `lengthOf`, the chosen kind and `search.rejected`, the four
offender checks and the per-row dumps above, and writes `/tmp/spike-g.json` (33 rows × 2), `/tmp/spike-g-loss.json`
(`lossLine` 10/20/40 × 2) and `/tmp/spike-g-loss40-dump.txt` (the 109 cells of the 40-machine packed line).

## The patch

`change.patch` (SP-C's probe + SP-G's packed AE2 column, one diff on a clean tree):

- `src/shared/types/layout.ts` — `CandidateKind.Packed = 3` (SP-C).
- `src/server/layout/arrange.ts` — `PACKED_SLOTS_AE2` (T facing up, own interface cell `[x, 2, 1]`), `placePacked`'s
  `ownPorts` option, and `Placement.packed` telling the mode.
- `src/server/layout/layout.ts` — the packed candidate in `buildLocal` for `direct`, `enderio` **and `ae2`** (SP-C's
  gate, `PROBE_PACKED !== '0'`, `packedLine`, one feed tier) and `buildLocalAt`'s `packed: boolean | 'own'` (`'own'` =
  AE2).
- `src/server/layout/modes/ae2.ts` — `PACKED_LANES`, the three lanes with their join, the riser skip, the port on the
  box's face, and the draft text ("on the lanes above the machines").
- `tests/unit/layout/layout.test.ts` — SP-C's probe change: a machine is fed by a cable of its feed tier on any face
  but the front, linked into it (`isInputFacing`, packed machines feed from their lane's side).
