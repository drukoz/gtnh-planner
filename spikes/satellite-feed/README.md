# SP-K: keeping the satellite supply feed free on a packed box (RUK-3027)

SP-J (`spikes/satellites-packed/README.md`) found that on a packed placement every
satellite is planned in phase 1 and dropped in phase 2 (`satFail = true`): the
tier-1 tree grown in phase 2 occupies the cell next to the satellite's input
cable and walls the supply feed off, so the satellite starves and `routeInternal`
falls back to the no-satellite route. SP-K measures three flag-gated ways to
keep that feed free.

All three variants live in `k.patch` (26 added lines in
`src/server/layout/internal.ts`), gated on the `SPK` env var read at call time:

- **K1** (`SPK=1`): in `growTrees`, every cell adjacent to a satellite input
  (excluding the satellite cell itself) is impassable to trees of a *different*
  tier than the satellite's supply tier. The supply feed is the only thing
  allowed to enter that rim.
- **K2** (`SPK=2`): K1's rim plus, on packed placements with satellites, the
  tree bound grows 2 extra planes at the top so a tree walled in by the rim can
  detour over the box.
- **K3** (`SPK=3`): no `growTrees` change. In `planSatellites`, a candidate cell
  is skipped if the tier's phase-1 tree occupies a cell adjacent to the input.

Head: `58a22b8cf`. Line: loss-40 (157 LV macerators), `satellites: true`.
Columns: `unw` unpowered, `unr` unreachable, `ht` hookups missing tier,
`up` unpowered machines in phase-2 check, `tot` total blocks, `loss` EU/t,
`vol` placement volume. `chosen` lines are the layout the search returned.
`planned/kept/satFail` come from a per-candidate probe (phase-2 satellite count
and the `satFail` flag of that phase-2 `routePower` call).

## Step 1 — flag off (head baseline)

| mode | chosen | kind | size | tot | loss | unpow | weak | unr | satellites |
|---|---|---|---|---|---|---|---|---|---|
| ae2 | 0 | WestHead | 5x4x44 | 232 | 2052 | 0 | – | 0 | 5: `16,1,2 24,1,2 30,1,2 36,1,2 41,1,2` |
| direct | 5 | Stacked | 5x3x15 | 97 | 1167 | 0 | – | 0 | 1: `12,1,3` |
| enderio | 5 | Stacked | 5x3x15 | 106 | 1167 | 0 | – | 0 | 1: `12,1,3` |

No packed candidate is chosen in any mode. Packed candidate totals at this
head: ae2 `Packed` 66, `PackedOpen` 74; direct/enderio `Packed` 51 (the spec's
82/55/59 were measured at SP-J's older head; numbers here are re-measured).
Phase-2 probe on the packed candidates (flag off, and identically under K3):
planned 1, kept 0, `satFail true` — SP-J's wall reproduces at head on every
packed candidate, in every mode. Satellite cells planned: `16,2,0` (ae2
Packed), `15,1,1` (PackedOpen), `16,2,1` (direct/enderio Packed, SP-J's cell).

## Step 2 — per-candidate probes per variant

### K1 (`SPK=1`)

```
K1 ae2: chosen 5 (Stacked), baseline 0, rejected -, size 5x5x25, total 174, loss 1300, unpowered 0, weak -, unreachable 0, sats 3 [14,1,1 18,1,1 21,1,3]
  0:WestHead unw 0 unr 0 ht 0 up 0 tot 199 loss 1527 vol 880 | planned 5 kept 5 satFail false cells [16,1,2 24,1,2 30,1,2 36,1,2 41,1,2] kept [16,1,2 24,1,2 30,1,2 36,1,2 41,1,2]
  1:MiddleHead@10 unw 0 unr 0 ht 0 up 0 tot 224 loss 1477 vol 1125 | planned 4 kept 4 satFail false cells [3,1,2 28,1,2 36,1,2 41,1,2] kept [3,1,2 28,1,2 36,1,2 41,1,2]
  2:MiddleHead@12 unw 0 unr 0 ht 0 up 0 tot 239 loss 1456 vol 1125 | planned 5 kept 5 satFail false cells [3,1,2 10,1,2 30,1,2 38,1,2 42,1,2] kept [3,1,2 10,1,2 30,1,2 38,1,2 42,1,2]
  3:MiddleHead@16 unw 0 unr 0 ht 0 up 0 tot 225 loss 1419 vol 1125 | planned 4 kept 4 satFail false cells [3,1,2 10,1,2 34,1,2 41,1,2] kept [3,1,2 10,1,2 34,1,2 41,1,2]
  4:MiddleHead@20 unw 0 unr 0 ht 0 up 0 tot 237 loss 1381 vol 1125 | planned 5 kept 5 satFail false cells [3,1,2 11,1,2 18,1,2 38,1,2 43,0,1] kept [3,1,2 11,1,2 18,1,2 38,1,2 43,0,1]
  5:Stacked unw 0 unr 0 ht 0 up 0 tot 160 loss 1164 vol 625 | planned 3 kept 3 satFail false cells [14,1,1 18,1,1 21,1,3] kept [14,1,1 18,1,1 21,1,3]
  6:Stacked@10 unw 0 unr 0 ht 1 up 0 tot 188 loss 1193 vol 810 | planned 3 kept 3 satFail false cells [2,1,1 21,1,1 24,1,2] kept [2,1,1 21,1,1 24,1,2]
  7:Stacked@12 unw 0 unr 0 ht 1 up 0 tot 170 loss 1161 vol 675 | planned 2 kept 2 satFail false cells [2,1,3 22,1,1] kept [2,1,3 22,1,1]
  8:Stacked@16 unw 0 unr 0 ht 5 up 12 tot 132 loss 1704 vol 405 | planned 3 kept 0 satFail true cells [2,1,3 5,1,1 22,1,1] kept []
  9:Stacked@20 unw 0 unr 0 ht 5 up 14 tot 132 loss 2066 vol 405 | planned 3 kept 0 satFail true cells [2,1,3 6,1,3 22,1,1] kept []
  10:Packed unw 0 unr 12 ht 2 up 0 tot 103 loss 883 vol 342 | planned 1 kept 1 satFail false cells [16,2,0] kept [16,2,0]
  11:PackedOpen unw 0 unr 1 ht 0 up 0 tot 111 loss 1048 vol 570 | planned 1 kept 1 satFail false cells [15,1,1] kept [15,1,1]
K1 direct: chosen 5 (Stacked), baseline 0, rejected -, size 5x3x15, total 97, loss 1167, unpowered 0, weak -, unreachable 0, sats 1 [12,1,3]
  0:WestHead unw 0 unr 0 ht 0 up 0 tot 115 loss 1048 vol 480 | planned 3 kept 3 satFail false cells [14,1,2 18,1,2 21,1,2] kept [14,1,2 18,1,2 21,1,2]
  1:MiddleHead@10 unw 0 unr 0 ht 2 up 0 tot 145 loss 1102 vol 625 | planned 3 kept 3 satFail false cells [1,1,2 20,1,2 23,1,2] kept [1,1,2 20,1,2 23,1,2]
  2:MiddleHead@12 unw 0 unr 0 ht 2 up 0 tot 136 loss 1110 vol 625 | planned 2 kept 2 satFail false cells [2,1,2 21,1,2] kept [2,1,2 21,1,2]
  3:MiddleHead@16 unw 0 unr 0 ht 2 up 0 tot 149 loss 1125 vol 625 | planned 3 kept 3 satFail false cells [1,1,2 6,1,2 21,1,2] kept [1,1,2 6,1,2 21,1,2]
  4:MiddleHead@20 unw 0 unr 0 ht 2 up 0 tot 148 loss 1116 vol 625 | planned 3 kept 3 satFail false cells [1,1,2 6,1,2 22,1,2] kept [1,1,2 6,1,2 22,1,2]
  5:Stacked unw 0 unr 0 ht 0 up 0 tot 91 loss 1017 vol 225 | planned 1 kept 1 satFail false cells [12,1,3] kept [12,1,3]
  6:Stacked@10 unw 0 unr 0 ht 3 up 0 tot 94 loss 896 vol 320 | planned 1 kept 1 satFail false cells [1,2,2] kept [1,2,2]
  7:Stacked@12 unw 0 unr 0 ht 3 up 0 tot 96 loss 892 vol 340 | planned 1 kept 1 satFail false cells [2,2,2] kept [2,2,2]
  8:Stacked@16 unw 0 unr 0 ht 2 up 0 tot 101 loss 886 vol 340 | planned 1 kept 1 satFail false cells [2,2,2] kept [2,2,2]
  9:Stacked@20 unw 0 unr 0 ht 2 up 0 tot 108 loss 892 vol 425 | planned 2 kept 2 satFail false cells [2,2,2 5,2,2] kept [2,2,2 5,2,2]
  10:Packed unw 0 unr 0 ht 2 up 0 tot 84 loss 878 vol 285 | planned 1 kept 1 satFail false cells [16,2,1] kept [16,2,1]
K1 enderio: chosen 5 (Stacked), baseline 0, rejected -, size 5x3x15, total 106, loss 1167, unpowered 0, weak -, unreachable 0, sats 1 [12,1,3]
  (candidates 0-10 identical to K1 direct except tot on the chosen line: 5:Stacked tot 106, chosen size 5x3x15)
```

K1 keeps the packed satellite in every mode: direct/enderio Packed keeps the
SP-J cell `16,2,1` (`tot 51→84`, `vol 114→285`), ae2 Packed keeps `16,2,0`
(`66→103`), PackedOpen keeps `15,1,1` (`74→111`). The satellite's own output
tree is **not** blocked: every candidate that plans satellites in flag-off
keeps them (`satFail false`), the only failures are `Stacked@16/@20` (ae2)
whose rows are byte-identical to flag-off — they fail without K1 too, and K1
does not change them. Side effects: the rim forces phase-2 trees to detour, so
non-chosen candidates grow; ae2 `PackedOpen` gains 1 unreachable machine
(0→1, a losing candidate that loses on other fields anyway); the chosen ae2
line flips from WestHead to Stacked (`232/2052 → 174/1300`), direct and
enderio chosen rows are byte-identical to flag-off.

### K2 (`SPK=2`)

**Byte-identical to K1 in every row of every mode** (full tables in
`/tmp`-transcript, same numbers in `bench-k2.json` = `bench-k1.json`). The 2
extra top planes on packed placements are never used: the rim pushes phase-2
trees sideways, not up, and the boxes here are 2 tall, so the grown trees never
touch the enlarged bound.

### K3 (`SPK=3`)

```
K3 ae2: chosen 0 (WestHead), baseline 0, rejected 11, size 5x4x44, total 232, loss 2052, unpowered 0, weak -, unreachable 0, sats 5 [16,1,2 24,1,2 30,1,2 36,1,2 41,1,2]
  0:WestHead unw 0 unr 0 ht 0 up 0 tot 199 loss 1527 vol 880 | planned 5 kept 5 satFail false cells [16,1,2 24,1,2 30,1,2 36,1,2 41,1,2] kept [16,1,2 24,1,2 30,1,2 36,1,2 41,1,2]
  1:MiddleHead@10 unw 0 unr 0 ht 15 up 22 tot 151 loss 7770 vol 675 | planned 4 kept 0 satFail true cells [3,1,2 28,1,2 36,1,2 41,1,2] kept []
  2:MiddleHead@12 unw 0 unr 0 ht 12 up 22 tot 151 loss 5836 vol 675 | planned 5 kept 0 satFail true cells [3,1,2 10,1,2 30,1,2 38,1,2 42,1,2] kept []
  3:MiddleHead@16 unw 0 unr 0 ht 9 up 22 tot 151 loss 4106 vol 675 | planned 4 kept 0 satFail true cells [3,1,2 10,1,2 34,1,2 41,1,2] kept []
  4:MiddleHead@20 unw 0 unr 0 ht 10 up 22 tot 151 loss 5041 vol 675 | planned 5 kept 0 satFail true cells [3,1,2 11,1,2 18,1,2 38,1,2 43,0,1] kept []
  5:Stacked unw 0 unr 0 ht 2 up 17 tot 111 loss 2102 vol 250 | planned 3 kept 0 satFail true cells [14,1,1 18,1,1 21,1,3] kept []
  6:Stacked@10 unw 0 unr 0 ht 4 up 11 tot 132 loss 1585 vol 405 | planned 3 kept 0 satFail true cells [2,1,1 21,1,1 24,1,2] kept []
  7:Stacked@12 unw 0 unr 0 ht 4 up 10 tot 132 loss 1513 vol 405 | planned 2 kept 0 satFail true cells [2,1,3 22,1,1] kept []
  8:Stacked@16 unw 0 unr 0 ht 5 up 12 tot 132 loss 1704 vol 405 | planned 3 kept 0 satFail true cells [2,1,3 5,1,1 22,1,1] kept []
  9:Stacked@20 unw 0 unr 0 ht 5 up 14 tot 132 loss 2066 vol 405 | planned 3 kept 0 satFail true cells [2,1,3 6,1,3 22,1,1] kept []
  10:Packed unw 0 unr 12 ht 2 up 0 tot 66 loss 862 vol 171 | planned 1 kept 0 satFail true cells [16,2,0] kept []
  11:PackedOpen unw 0 unr 0 ht 0 up 0 tot 74 loss 966 vol 285 | planned 1 kept 0 satFail true cells [15,1,1] kept []
K3 direct: chosen 5 (Stacked), baseline 0, rejected -, size 5x3x15, total 97, loss 1167, unpowered 0, weak -, unreachable 0, sats 1 [12,1,3]
  5:Stacked unw 0 unr 0 ht 0 up 0 tot 91 loss 1017 vol 225 | planned 1 kept 1 satFail false cells [12,1,3] kept [12,1,3]
  10:Packed unw 0 unr 0 ht 2 up 0 tot 51 loss 862 vol 114 | planned 1 kept 0 satFail true cells [16,2,1] kept []
K3 enderio: chosen 5 (Stacked), baseline 0, rejected -, size 5x3x15, total 106, loss 1167, unpowered 0, weak -, unreachable 0, sats 1 [12,1,3]
  5:Stacked unw 0 unr 0 ht 0 up 0 tot 91 loss 1017 vol 225 | planned 1 kept 1 satFail false cells [12,1,3] kept [12,1,3]
  10:Packed unw 0 unr 0 ht 2 up 0 tot 51 loss 862 vol 114 | planned 1 kept 0 satFail true cells [16,2,1] kept []
```

K3 changes **nothing**: every candidate row in every mode is byte-identical to
flag-off, and the planned satellite cells are the same cells (`16,2,0`,
`15,1,1`, `16,2,1`) — the adjacency skip never rejects a cell the search
reaches. Reason: the wall that starves the satellite is grown by the
**phase-2** tier-1 tree, and the phase-2 trees grow differently than the
phase-1 trees K3 inspects (the satellite's reserved cells change where the
tree spreads). K3's premise — phase-1 tree shape predicts the phase-2 wall —
does not hold.

## Step 3 — bench, 132 rows (44 lines x 3 modes + routed)

`runBench()` with the flag off reproduces `tests/fixtures/layout-bench/baseline.json`
exactly (132/132 rows identical).

| variant | rows changed | loss-40 routed | loss-40 ae2 |
|---|---|---|---|
| K1 | 2 | 5x4x44 tot 235 loss 2052 → **5x5x25 tot 177 loss 1300** | 5x4x44 tot 232 loss 2052 → **5x5x25 tot 174 loss 1300** |
| K2 | 2 | same as K1 | same as K1 |
| K3 | 0 | – | – |

Per-mode sums (`total` / `lossEUt`), baseline → variant:

| mode | baseline | K1/K2 |
|---|---|---|
| direct | 1765 / 10146 | 1765 / 10146 (unchanged) |
| routed | 2199 / 11743 | **2141 / 10991** |
| ae2 | 2073 / 11486 | **2015 / 10734** |
| enderio | 1710 / 10146 | 1710 / 10146 (unchanged) |

Both changed rows keep `weakTiers`, `unpowered`, `unreachable` at 0. Full row
sets: `bench-k1.json`, `bench-k2.json` (identical). K3 changed no rows, so no
`bench-k3.json`. No row is worse on `total`, `lossEUt`, `weakTiers`,
`unpowered` or `unreachable` under any variant.

## Step 4 — GT checks (satellites.test.ts:64–104 checks, run on chosen lines of every variant, 16 runs)

For every satellite on every chosen line, for off + K1 + K2 + K3 x
ae2/direct/enderio/routed: transformer at the bank cell facing UP, input cable
above with the `fromTier` cable, output cable with the `toTier = fromTier - 1`
cable, no alien cable on the other four faces, no lower-tier machine touching
the output faces, `tierContacts` empty. **16/16 runs: all checks ok.**

## Step 5 — design goals on the changed rows (loss-40 routed + ae2, K1/K2)

- `unreachable` did not rise: 0 → 0 on both rows (and 0 on all 132 rows).
- `placement.reserved`: 0 reserved cells on these singleblock lines, 0 of them
  occupied — the goal is satisfied vacuously here; no variant reserves cells.
- Tiers never touch: `tierContacts` empty on all 16 step-4 runs.

## Step 6 — whole suite with the best variant (`SPK=1`)

`SPK=1 npx vitest run --maxWorkers=2`: **4468 passed, 266 skipped, 0 failures**
(including the 6 throwaway measurement tests). No benchmark re-pins are needed
for K1 — nothing that is pinned today moves. Flag-off run at head: also clean
(4468/266/0).

## Verdict

**Promote K1.** It is the only variant that answers SP-J's question: with the
input-adjacent rim, the packed-box satellite's supply feed stays free, the
phase-2 check keeps every satellite it plans, and all three packed candidates
keep their satellite in all modes. It improves the two rows that have packed
pressure (loss-40 ae2 and routed, `232/2052 → 174/1300`, `235/2052 → 177/1300`)
and regresses **no** row on **any** of the five acceptance columns, with zero
test failures and zero re-pins. Costs are candidate-level and only on losing
candidates: packed candidates grow (direct Packed `51→84`, `vol 114→285`;
PackedOpen `unr 0→1`), which is the price of routing phase-2 trees around the
rim. K2 is K1 with dead code (the extra 2 top planes never bind on 2-tall
boxes; results byte-identical) — ship K1 without the bound change. K3 is inert
(phase-1 trees don't predict the phase-2 wall) — drop it.

## Reproducing

```sh
git apply spikes/satellite-feed/k.patch   # on top of 58a22b8cf
SPK=1 npx vitest run tests/unit/layout/layout-bench.test.ts
# per-candidate probes: the throwaway test from this spike (not committed);
# step-2 columns come from a probe patching phase-2 planned/kept/satFail per
# candidate, recorded in this README's tables.
git checkout -- src/
```

## CTO note on the goal question (review)

The spike asked whether `loss-40` can keep a **packed** line with satellites on. Under K1 the packed satellite is kept,
but no mode chooses a packed line: direct/EnderIO `Packed` (tot 84) loses to `Stacked` on `handTransformers` (2 vs 0),
and AE2 `Packed`/`PackedOpen` lose on `unreachable` (12 and 1). K1's bench gain comes from the AE2 `Stacked` candidate
(index 5), whose three satellites starve without K1 (`satFail true`, 17 unpowered) and survive with it. So K1 is a
general fix for satellite supply starvation, not yet a packed-line win; the packed gap is now `handTransformers`/reach.

## CTO addendum: K1 as a fallback (`k1-fallback.patch`, for M3-12)

K1 as measured above lays the rim on every phase-2 route, so trees detour even where the satellites would have
survived. On `lossLine(60, 'routed' | 'ae2', { satellites: true })` that made the WestHead candidate longer.
`k1-fallback.patch` routes phase 2 as today first, and lays the rim (a `satRim` flag on `routePower` and `growTrees`)
only when that route starves a satellite (`satFail`). A candidate whose satellites survive today is routed exactly as
today.

Measured at `ba25edeff` with the patch (no env flag):
- `runBench()`: the same 2 rows as K1, `loss-40 routed` 235/2052 → 177/1300 and `loss-40 ae2` 232/2052 → 174/1300,
  both `[5,5,25]`, 0 unpowered, 0 unreachable, no weak tier (`baseline-k1.json`). No other row moves.
- Whole suite (`npx vitest run`): 4467 passed, 0 failed, 0 re-pins. `npx tsc -b` clean.
- `lossLine(n, mode, { satellites: true })`, chosen line, satellites, unpowered machines:

| n | direct | routed | ae2 | enderio |
|---|---|---|---|---|
| 40 | Stacked 97, 1 sat, 0 | Stacked 177, 3 sats, 0 | Stacked 174, 3 sats, 0 | Stacked 106, 1 sat, 0 |
| 60 | WestHead 180, 6 sats, 0 | MiddleHead 368, 7 sats, 0 | MiddleHead 365, 7 sats, 0 | WestHead 199, 6 sats, 0 |
| 80 | WestHead 245, 9 sats, 0 | MiddleHead 491, 11 sats, 0 | MiddleHead 488, 11 sats, 0 | WestHead 269, 9 sats, 0 |

  Without the patch, 80 routed and 80 ae2 lay **no** satellite and starve 50 and 38 machines (`Stacked` 260 blocks,
  `PackedOpen` 143). 60 routed/ae2 keep WestHead (354/351 blocks, 5092 EU/t); with the patch the finished check keeps
  MiddleHead (368/365, 2667 EU/t).
- On every chosen line above, no cable of a tier other than the satellite's `fromTier` stands on the 6 cells beside
  a satellite's `input` (its own `cell` excepted).
