# Why the satellite shuts a machine in (RUK-3031, SP-L, design goal 3)

A satellite bank is a transformer laid in the air row beside the spine, facing up into a supply cable, with a clean
output cell beside it (`spikes/satellite-banks`, promoted by `spikes/satellite-feed`). On the 40-machine **AE2** line the
`PackedOpen` candidate lays one at `15,1,1` — and that line scores `unreachable 1` while every other candidate scores 0,
so it loses the search. This spike finds the machine, names the block that shuts it in, measures a `planSatellites`
check that refuses such a cell, and prices the result. Measured on `feat/optimal-layout-m3-RUK-3031` with
`spikes/satellite-feed/k1-fallback.patch` and `spikes/rain-roof/promote.patch` applied and staged.

Nothing here is promoted. `l.patch` is the throwaway (`SPL=1`), reverted before commit; the probe that read the machine's
six sides is deleted, not patched.

## The shut-in (step 2)

`lossLine(40, 'ae2', { satellites: true })` picks `Stacked` (score `total 186`, `unreachable 0`). `PackedOpen` is the
cheapest candidate at `total 130` and carries `unreachable 1`. The search ranks reach before length
(`compareScore`: `unwired`, `unreachable`, hand transformers, `unpowered`, then `total`, then `lossEUt`), so that one
shut-in puts it behind every clean candidate; Stacked then wins on length by 56. Its satellite is:

```
bank 0: cell 15,1,1 (transformer, faces up)  input 15,2,1 (2x Annealed Copper Cable)  output 14,1,1 (4x Tin Cable)
```

The probe (`SPL_PROBE=1`, in `buildLocal`) names the unreachable machine and its six sides:

| side | block at | what it is |
|---|---|---|
| `[-1,0,0]` | `14,0,1` | `machine` Basic Macerator |
| `[1,0,0]` | `16,0,1` | `machine` Basic Macerator |
| `[0,-1,0]` | `15,-1,1` | nothing — below the floor; the ground is solid, so no builder stands there |
| `[0,1,0]` | `15,1,1` | **`transformer` LV Hi-Amp Transformer — the satellite's own cell** |
| `[0,0,-1]` | `15,0,0` | `interface` ME Interface (Basic Macerator) |
| `[0,0,1]` | `15,0,2` | `cable` 4x Tin Cable |

So yes: **the satellite transformer (its `cell`) is the block that closes the machine in.** The bank's input cable
(`15,2,1`) is two cells away and touches none of the machine's faces. The `4x Tin Cable` on `+z` is a `THIN_ROLES`
cable, which reach can walk through — but its own cell reaches no outside air: above it is a machine, west and east are
the spine's tin-cable run, `±z` are machines, and below is under the floor. A thin cable that never touches the outside
is no door. With `satellites: false` the same line scores `unreachable 0` and lays no bank, which pins the cause on the
satellite and not on the packed spine.

`unreachableMachines` (`src/server/layout/reach.ts`) counts a machine face as workable when the cell beside it is air
connected to the outside of the box grown by one, or a thin block (`THIN_ROLES`: `cable`, `pipe`, `chip_pipe`) whose own
cell touches such air; full blocks — machines, casings, hatches, transformers, ME Interfaces, chests — close a face, and
the ground under the floor is solid. `15,0,1` has five closed faces and one thin face that never touches the outside, so
it is unreachable.

## The fix (`l.patch`, throwaway, `SPL=1`)

The satellite search already walks candidate cells (`cell` on the row above the spine, `inp` above it, a clean `out`
beside the transformer). `l.patch` adds one rejection to that loop, in `planSatellites`
(`src/server/layout/internal.ts`), after the existing output/`satCells` checks:

```ts
const spl = process.env.SPL === '1';
const splBase: Array<{ pos: Vec3; role: string }> = [...input.occupied, ...grid.blocks];
const splUnreachable = spl ? unreachableMachines(splBase).length : 0;
// per candidate cell, before accepting it:
if (spl && unreachableMachines([...splBase, { pos: cell, role: 'transformer' }, { pos: inp, role: 'cable' }]).length > splUnreachable) continue;
```

It is the reach rule the search already ranks by, applied to the satellite's own cells: a bank is accepted only if
adding it does not raise the line's unreachable count above what the line already has. It is a `continue`, not a
failure — the search walks on to the next cell; a line whose every cell shuts something in loses its satellite
(`satFail`) exactly as it does today when no cell is free.

With `SPL=1` the `15,1,1` cell is rejected and the next accepted one is two cells down the spine:

```
bank 0: cell 15,1,3  input 15,2,3  output 14,1,3     unreachable 0
```

## What the flag changes, line by line (step 4)

`lossLine(n, mode, { satellites: true })` with the flag off, then `SPL=1`. `total` is the search's ranked length,
`lossEUt` the scored estimate, `vol` the scored volume.

**40 machines, AE2 — the flag flips the chosen line:**

| # | kind | ht | unp | unr off/on | total off/on | lossEUt off/on | vol off/on |
|---|---|---|---|---|---|---|---|
| 0 | WestHead | 0 | 0 | 0/0 | 277/277 | 1527/1527 | 1540/1540 |
| 1 | MiddleHead@10 | 0 | 0 | 0/0 | 302/302 | 1477/1477 | 1656/1656 |
| 2 | MiddleHead@12 | 0 | 0 | 0/0 | 316/316 | 1456/1456 | 1656/1656 |
| 3 | MiddleHead@16 | 0 | 0 | 0/0 | 303/303 | 1419/1419 | 1656/1656 |
| 4 | MiddleHead@20 | 0 | 0 | 0/0 | 314/314 | 1381/1381 | 1656/1656 |
| **5** | **Stacked** | 0 | 0 | 0/0 | **186**/186 | 1164/1164 | 750/750 |
| 6 | Stacked@10 | 1 | 0 | 0/0 | 226/226 | 1193/1193 | 1176/1176 |
| 7 | Stacked@12 | 1 | 0 | 0/0 | 197/197 | 1161/1161 | 1008/1008 |
| 8 | Stacked@16 | 5 | 12 | 0/0 | 181/181 | 1704/1704 | 672/672 |
| 9 | Stacked@20 | 5 | 14 | 0/0 | 181/181 | 2066/2066 | 672/672 |
| 10 | Packed | 2 | 0 | 12/12 | 136/136 | 883/883 | 665/665 |
| **11** | **PackedOpen** | 0 | 0 | **1/0** | **130/142** | 1048/1056 | 931/798 |
| chosen | | | | | **Stacked (5)** → **PackedOpen (11)** | | | |

The move costs `PackedOpen` 12 blocks of cable (130 → 142) and 8 EU/t (1048 → 1056). It pays 56: `total 142` beats
Stacked's `186` with the same zero hand transformers, zero unpowered and zero unreachable. The laid line goes from
`5x6x25`, 200 blocks, 1300 EU/t to `7x6x19`, 148 blocks, 1170 EU/t — 26 % shorter and 10 % less lossy.

**The other three cases are byte-identical**, which is the control: `40 routed` has no packed candidate at all
(chosen Stacked, satellites `14,1,1 18,1,1 21,1,3` off and on); `20 ae2` lays no satellite (no tier starvation, chosen
PackedOpen both times); `80 ae2` keeps `MiddleHead@40` and its 11 satellites at the same 11 cells (its `PackedOpen`
loses on `handTransformers 13` and `unpowered 38`, not on reach — `unreachable 0` off and on).

## The 132-row benchmark (step 5)

`runBench()` with the flag off is **byte-identical to `spikes/rain-roof/baseline-promote.json`: 132 of 132 rows** —
the flag is inert.

`SPL=1` changes **1 of 132 rows**:

| row | mode | size | total | cable | pipe | iface | trans | roof | hookup | lossEUt | weak | unp | unr |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| off | loss-40 ae2 | 5x6x25 | 200 | 119 | 1 | 40 | 6 | 26 | 14 | 1300 | none | 0 | 0 |
| on | loss-40 ae2 | 7x6x19 | 148 | 62 | 10 | 40 | 6 | 30 | 6 | 1170 | none | 0 | 0 |

Per-mode sums (total / lossEUt), flag off → on:

| mode | total | lossEUt | roof | unpowered | unreachable |
|---|---|---|---|---|---|
| direct | 2098 → 2098 | 10176 → 10176 | 331 → 331 | 39 → 39 | 0 → 0 |
| routed | 2509 → 2509 | 10837 → 10837 | 366 → 366 | 39 → 39 | 0 → 0 |
| ae2 | 2385 → **2333** | 10537 → **10407** | 367 → 371 | 39 → 39 | 6 → 6 |
| enderio | 2075 → 2075 | 10176 → 10176 | 363 → 363 | 39 → 39 | 0 → 0 |

No row gets longer, lossier, weaker, more unpowered or more unreachable. `runBench()` runs in **2.02 s** flag off and
**2.35 s** with `SPL=1` (+0.33 s, ~16 %): one extra reach flood-fill per candidate satellite cell.

## The suite and the GT checks (step 6)

`npx vitest run --maxWorkers=2` fails **10 tests** with the flag off and the **same 10** with `SPL=1`
(4459 passed, 266 skipped, 302 files). The sets are identical (`diff` empty), so the variant re-pins nothing: those 10
are the pins the two patches this spike sits on already need (M3-12's `k1-fallback` and M3-13's roof promotion — the
`PART_DEFS` count, the roof role's tile colour, the bench baseline, the pinned layouts and placements):
`scene-data.test.tsx` (1), `feeding/precheck.test.ts` (1), `head-choice.test.ts` (1), `layout-bench.test.ts` (2),
`layout-search.test.ts` (1), `layout.test.ts` (2), `packed.test.ts` (1), `parts.test.ts` (1).

The promoted satellite checks (`tests/unit/layout/satellites.test.ts`, 48 tests) pass under `SPL=1`. The chosen
`SPL=1` line was re-checked directly: no overlapping blocks, `tierContacts` empty, the bank's transformer faces up into
the tier-2 supply cable (`2x Annealed Copper Cable`), its output carries the tier-1 cable (`4x Tin Cable`), no foreign
cable on the five output faces, and a second run lays byte-identical blocks.

## What the flag does to each goal

Read against the goals (`spikes/rain-roof/README.md` § "What the laid roof does to each goal"), on the one changed row
(`loss-40 ae2`):

- **Goal 1, the score** — the flag moves a candidate, not the score: `PackedOpen` pays +12 total and +8 EU/t for the
  satellite's 2-cell detour, drops `unreachable 1 → 0`, and wins 142 vs Stacked's 186. The chosen line is 200 → 148.
- **Goal 2, shared cable** — the packed spine's sharing is what makes it cheap: the row's cable 119 → 62, pipe 1 → 10,
  and the satellite's cables stay tier-clean (`tierContacts` empty; the transformer touches its own input above and its
  own output on one face).
- **Goal 3, reach** — this spike is its measurement: the shut-in the search already scored is now refused at the cell
  that causes it, 1 → 0, in the satellite search itself. The ae2 bench sum stays 6: the 6 closed packed-AE2 machines
  (candidate 10, `unreachable 12` on the 40-line) are the packed spine's own doing, out of scope here.
- **Goal 4, machine reuse** — untouched: placement, unit cells and the packing choice are decided before the satellite
  step; the flag only rejects air cells.
- **Goal 5, cleanrooms** — untouched: the satellite lives in the air row above the spine; no shell is entered, and no
  benchmark row on this line lays a cleanroom.
- **Goal 6, wall sharing** — untouched: the flag claims no cell that `placement.reserved` holds (a muffler front, a vent,
  a hollow); it only refuses a satellite cell, exactly as `satCells` already does.
- **Goal 7, rain** — the row's roof grows 26 → 30 (+4 slabs) because the winning line's footprint changed to `7x6x19`;
  the roof rule is untouched.
- **Goal 8, existing projects** — **this is the one goal the flag is not neutral on**: an AE2 40-machine project
  re-layouts from `Stacked` to `PackedOpen`, 52 blocks shorter. Every other row keeps its layout byte for byte.
- **Goal 9, the machine estimate** — no per-machine term changes (40 interfaces, 6 transformers, 0 chests both ways);
  the BOM shifts cable 119 → 62, pipe 1 → 10, hookup 14 → 6, roof +4.
- **Goal 10, what the user sees** — no new role and no client change: the view draws the packed spine with its satellite
  two cells off the head; no scene test moves.

Anti-goals:

- **A machine left open to rain** — unchanged: the roof rule is untouched; the +4 cells follow the narrower footprint.
- **A machine the player cannot reach** — the flag's whole point: it removes 1 shut-in and adds none in 132 rows.
- **Feeding that overfills or deadlocks** — untouched: no feed, interface or reserved cell moves (interfaces 40 → 40).
- **A different layout per run, or a much longer layout** — deterministic (sorted cells, no state; a re-run lays
  byte-identical blocks and the same satellite cells), and the one row that moves gets 26 % **shorter**.
- **Any test line longer than today's** — no row grows; `loss-40 ae2` drops 200 → 148.

## Verdict

**Promote `l.patch`.** The shut-in is the satellite's own transformer closing a packed machine's top face — five solid
faces and a thin cable with no path to air — and the satellite search is exactly where to refuse it. The check is the
rule the search already ranks by, costs 12 blocks on the candidate that needed it, removes the only reach failure in the
benchmark, flips one line to a 26 % shorter and 10 % less lossy layout, leaves 131 of 132 rows byte-identical, breaks no
test the tree does not already break, and costs 16 % on the bench. A promotion re-pins nothing new; it does re-layout
AE2 lines where a packed spine beats a stack, so it lands as a change of chosen layout, with the satellite's
"tier-correct, faces up, output clean" contract unchanged.

The open edge: the check runs on the phase-1 grid (`grid.blocks` plus `input.occupied`), the same proxy `satCells`
uses, and the satellite cells it adds are the only phase-2 blocks it models. On this row phase 2's re-route kept
`unreachable 0` and the satellite survived, so the proxy held; a promotion should keep an eye on candidates that lose
their satellite entirely (`satFail`) under the flag — none did in the 132 rows measured.
