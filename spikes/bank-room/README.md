# The bank room (RUK-2976)

Shallow packed lines fit 2–3 machines per row, so a 5-long head bank cannot hold the transformers its amps need:
the 20-machine direct line lays 5 LV transformers and warns `Put 5 more Low Voltage Transformer beside the bank`,
and the packed candidate loses on that hand work. This spike measures two fixes, behind one switch read in
`src/server/layout/internal.ts`:

- `SPIKE_BANK=1` — **H1, Hi-Amp bank**: when a bank's standard count does not fit (`count > placed`) and the export
  has a Hi-Amp Transformer for the stage's tier, size and lay that bank with Hi-Amps instead, at the larger of
  `ceil(ampsOut ÷ 16)` and `ceil(ampsIn ÷ 6)` (`HIAMP_AMPS_OUT`/`HIAMP_AMPS_IN`, gt-mechanics §3.6).
- `SPIKE_BANK=2` — **H2, taller bank**, on top of H1: when the (Hi-Amp) count still does not fit, stack the bank
  `ceil(count ÷ placed)` levels high, feeding each stacked row with the two runs' cells at the same (y, z).
  West-end heads only — crossing banks and satellites are out of scope.

`SPIKE_BANK` unset = 0 = today's behaviour. The probe from `spikes/packed-candidate` (packed candidate in
`buildLocal` for `direct`/`enderio`) is applied on top; `change.patch` is probe + H1 + H2 together.

## How to measure

```sh
git apply spikes/packed-candidate/probe.patch   # the packed candidate
# then, with the spike's temporary test in tests/unit/layout/tmp-spike-bank.test.ts:
SPIKE_BANK=1 npx vitest run tests/unit/layout/tmp-spike-bank.test.ts   # writes /tmp/bank-spike-1.jsonl
SPIKE_BANK=2 npx vitest run tests/unit/layout/tmp-spike-bank.test.ts   # + /tmp/bank-spike-2-bank.txt
SPIKE_BANK=1 npm test                                                 # the full suite
```

The temp test lays the 33 benchmark lines (plus one synthetic `short-64`, below) in all four modes = 136 layouts,
asserting every layout has zero overlapping blocks and zero tier-to-tier contacts (cables on `powerSide` ports),
and writes one row per layout: footprint, placed blocks, loss, chosen candidate kind, bank warnings and candidates.

## The numbers (`/tmp/bank-spike-{0,1,2}.jsonl`)

Sizes are `[x, y, z]`; `trans` is the laid transformer count; "hand" is the `transformer_bank` warning the layout
still reports. The same 6 `route_failed` and 156 starved machines (baseline bench conditions) appear in all three.

| line | mode | bank 0 | bank 1 (H1) | bank 2 (H1+H2) |
| --- | --- | --- | --- | --- |
| loss-10 | direct | WestHead 5x1x9 35 blk 252 EU/t | **Packed 3x2x9 29 blk 164 EU/t** | same as 1 |
| loss-20 | direct | WestHead 5x1x14 48 blk 580 EU/t, hand 5 | **Packed 3x2x12 38 blk 394 EU/t, hand 0** | same as 1 |
| loss-20 | routed | WestHead 5x4x24 122 blk 636 EU/t | **Stacked 5x2x15 76 blk 536 EU/t** | same as 1 |
| loss-20 | ae2 | WestHead 5x4x24 119 blk 636 EU/t | **Stacked 5x2x15 73 blk 536 EU/t** | same as 1 |
| loss-40 | direct | WestHead 5x4x24 117 blk 1224 EU/t, hand 5 | **Stacked 5x3x15 97 blk 1167 EU/t, hand 0** | same as 1 |
| loss-40 | enderio | WestHead 5x4x24 131 blk 1224 EU/t, hand 5 | **Stacked 5x3x15 106 blk 1167 EU/t** | same as 1 |
| loss-40 | routed/ae2 | WestHead 5x4x44 235/232 blk 2052 EU/t | unchanged | unchanged |
| short-64 | direct | Packed 6x2x3 22 blk 1044 EU/t, hand 32 | WestHead 5x1x5 25 blk 1736 EU/t, hand 5 | **WestHead 5x2x5 35 blk 2015 EU/t, hand 0** |
| short-64 | routed | WestHead 6x2x5 40 blk 1803 EU/t, hand 35 | WestHead 40 blk 1803 EU/t, hand 5 | WestHead 6x2x5 50 blk 2096 EU/t, hand 1 |
| **all 136 rows** | | 8066 blk, 50375 EU/t, 1125 ms | 7903 blk, 50856 EU/t, 2431 ms | 7943 blk, 52000 EU/t, 3279 ms |

Every bank-1/bank-2 row has zero overlaps and zero tier contacts, and no row regressed into a route failure.

### H1 (bank 1)

The bank swap is the whole story: with a bank that fits, the hand-work penalty disappears and the short packed
heads win. loss-20 direct goes 48 → 38 blocks and 580 → 394 EU/t; loss-40 direct 117 → 97 and 1224 → 1167; routed
and ae2 (which never get a packed candidate) also improve — their WestHead/Stacked banks stop starving, so
loss-20 routed drops 122 → 76 blocks. Only `loss-40 routed/ae2` are untouched (their 44-long banks already fit),
and `short-64` (125 amps, Hi-Amp count 8, no head that long) keeps a `Put 5 more` warning at 1.

### H2 (bank 2)

H2 never fires on the 33 benchmark lines: the Hi-Amp count is ≤ 5 everywhere (`ceil(38 ÷ 16) = 3` for loss-20,
`≤ 5` for loss-40), and a west head's bank is 5 rows long (packed head: 3), so H1's count always fits on one
level. It needs a line whose amps outgrow every head — the synthetic `short-64` (2 macerators at 2000 EU/t,
125 A, Hi-Amp count 8) is the demonstration: at 2 the head is 5x2x5 and lays both levels, no warning —

```
cable        0,0,0 … 0,0,4   2x Annealed Copper (MV supply, level 0)
cable        0,1,0 … 0,1,4   2x Annealed Copper (MV feed, stacked by planHead)
transformer  1,0,0 … 1,0,4   LV Hi-Amp Transformer facing west
transformer  1,1,0 … 1,1,4   LV Hi-Amp Transformer facing west (the stacked row)
cable        2,0,0 … 2,0,4   4x Tin (LV, level 0)
cable        2,1,0 …         4x Tin (LV feed, level 1)
```

— but it pays for that with 5 more transformers, 10 more blocks (35 vs 25), 279 more EU/t (2015 vs 1736) and a
box 2 high: on the benchmark suite bank 2 is **net worse than bank 1** (+40 blocks, +1144 EU/t), the extra only
coming from `short-64`, where H2 trades hand work for blocks and loss. In `routed`/`ae2` modes a level-1 feed
cell collides with logistics blocks and is skipped, so the stack lays 9 of 10 and keeps a `Put 1 more` warning —
the guard works, the bank is blocked.

## The full suite

| switch | failures | what |
| --- | --- | --- |
| unset (probe only) | 4 | the probe's known packed-candidate flips: `head-choice` and `satellites` loss-40 direct/enderio |
| 1 | 16 | those 4 + 12 H1 repins |
| 2 | 16 | the same 16 — no layout in the suite reaches H2 |

The 12 H1 repins (all "layout got better, numbers pinned to the old layout"):
`layout-bench` loss-10 direct (35 → 29, 252 → 164); `internal.test` "fills the bank column and asks for parallel
runs" (Hi-Amps fit, no parallel runs asked); `m1-verify-panel` "the laid line is the chosen candidate";
`satellites` × 8 on the 20-machine routed/ae2 lines (banks fit, satellites and layouts shift) and the stacking-off case;
the 20-machine `no bank warning, no starved machine` tests keep passing. No test fails for overlap, tier contact,
starvation or route failure.

## What this says

H1 is the fix: it deletes the bank-starvation hand work that kept packed heads from winning, on every mode and
every line with a too-short bank, and costs nothing on lines whose banks fit. It is ready to productise, with:
the 12 + 4 test repins, the satellites interplay (the 20-machine satellite tests shift and need re-pinning),
the `transformer_bank` warning text and `handTransformers` scoring (already carried through `Stage.layCount`),
and the bench baseline + panel re-pins. Hi-Amp selection is a straight `pickHiAmpTransformer` swap — the
transformer-loss model (`bankLossEUt`) charges per amp, not per transformer, so counts and kinds do not move it.

H2 is parked: on every measured line H1's count fits the head's bank, the stacking path is only reachable by a
synthetic line, and there it trades hand work for blocks, loss and head height (a 2-high box). A crossing bank,
if it is built, should probably stack Hi-Amps the same way, but nothing in the benchmark needs it yet.

## Files

`change.patch` is the whole prototype (probe + H1 + H2, `git diff` of `src/` and `tests/unit/layout/layout.test.ts`)
against `origin/feat/optimal-layout-m3`; the temp test is not in it. Verify with
`git apply --check spikes/bank-room/change.patch` in a clean checkout of that branch. The switch is read in one
place (`SPIKE_BANK` in `src/server/layout/internal.ts`): 1 turns H1 on, 2 adds H2.
