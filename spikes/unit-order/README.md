# SP-M (spike, RUK-3058): unit order within a feed tier

Spike only. Nothing under `src/` or `tests/` is committed — the whole change lives in the three
`o*.patch` files. Apply a patch with `git apply spikes/unit-order/o*.patch`, then `npx vitest run
tests/unit/layout/layout-bench.test.ts` (the M3 `layout-bench` passes with **no** patch, as it does today).

## What was measured

Three ways to reorder the machines inside a feed tier of the **best** laid line, laid again as extra
`CandidateKind.Reordered` candidates, then re-ranked by the unchanged `compareScore` / `replacesBaseline`
rule. `buildLocal` tracks a `lays` array parallel to `lines`/`kinds`, takes `best = finalists[0] ?? baseline`
after the initial ranking, re-lays it with `buildLocalAt({...input, units: reordered}, lay.westUnits, lay.stack, lay.packed)`,
and re-ranks. Only electric, non-manual units move, grouped by the tier `placeUnits` feeds them at
(`min(tier, supplyTier)`); steam and hand-run units stay put. The baseline (index 0, the west-end line) never moves.

- **O1 hungriest-first** — within each tier, `euPerTick` descending (stable). One extra line.
- **O2 fluid-groups** — within each tier, group units whose step shares a `fluid:` input/output (transitively),
  order groups by first appearance, keep flow order inside a group. One extra line.
- **O3 pair-swap** — swap two units in a tier (skipping a same-`stepId` pair), keep a swap only when the swapped
  line beats the current best (`compareScore` < 0) **and** replaces it (`replacesBaseline`), restart the scan after
  each accept, lay at most `SP_M_SWAP_CAP` (B) extra lines. Run at B = 8, 16, 32.

132 rows = the S1 `benchLines()` (loss-10..80, mixed-00..19, fluid-01..09) × 4 logistics modes. "better/worse"
is by `compareScore` (M3 → variant); `codes Δ` is the `machine_unreachable` warning-code delta. The `fin` columns
are the **finished** `lengthOf` (`total,hookup,lossEUt,weakTiers,unpowered,unreachable,roof`).

## Verdict

| variant | rows changed | better | worse | net total | net lossEUt | runBench median (Δ) | verdict |
| --- | --: | --: | --: | --: | --: | --: | --- |
| M3 (baseline) | — | — | — | — | — | 2339 ms | — |
| O1 hungriest-first | 16 | 14 | 2 | −1 | −52 | 2685 ms (+15%) | small, real, cheap; loss-only wins; 2 regressions |
| O2 fluid-groups | 2 | 0 | 2 | 0 | +10 | 2563 ms (+10%) | **pure regression — drop** |
| O3 pair-swap B=8 | 30 | 26 | 4 | −46 | −253 | 3116 ms (+33%) | **best**; big structural wins; 4 regressions |
| O3 pair-swap B=16 | 29 | 25 | 4 | −48 | −166 | 3434 ms (+47%) | churn, no gain over 8; regressions persist |
| O3 pair-swap B=32 | 29 | 25 | 4 | −44 | −198 | 4092 ms (+75%) | fixes mixed-18 reachability; most expensive |

(net total / net lossEUt = `all` row summed over the 4 modes, variant − M3; negative = improvement.)

O1 wins are loss-only (length never drops) and concentrated in routed/ae2; the two `mixed-14` direct/enderio
rows regress. O2 is strictly worse than M3 (it only displaces a good line, never wins). O3 is the only variant
with large, structural wins — `mixed-01` finishes 41→35 blocks / 387→335 lossEUt, `mixed-02` 102→95, `mixed-07`
70→68 — at the cost of ~+33% bench time and four guardrail regressions. B beyond 8 is churn: the same 25 wins,
and 16/32 regress the **finished** loss of `mixed-05 routed` (search loss falls, finished rises) with no new wins.

## Acceptance (variant vs M3)

The full per-row tables (changed rows, `compareScore` fields, finished `lengthOf` fields, warning-code delta,
and summed `total`/`lossEUt` per mode) are in `compare-o1.md`, `compare-o2.md`, `compare-o3-8.md`,
`compare-o3-16.md`, `compare-o3-32.md`. Regressions, in every variant that has them:

- `mixed-14` direct/enderio — the search keeps `WestHead` over M3's `Stacked`: lossEUt 286→291.
- `fluid-09` routed/ae2 — `Stacked`→`WestHead`: total 62→64 (59→61 ae2), lossEUt 562→563.
- `fluid-02` direct (O3) — a search win (`compareScore` loss 83→82) whose **finished** line is lossier: 441→444.
- `mixed-05` routed (O3 B≥16) — search loss 124→105/109, finished loss 628→643/649: final-stage churn.

The wins that matter (O3 B=8): `mixed-01` (both feed modes) 41→35 finished blocks, `mixed-02` all modes,
`mixed-07` 70→68, `mixed-18` ae2. `mixed-18` ae2 at B=32 also drops `unreachable` 2→0 — reordering un-shuts-in
a machine, the design-goal-3 direction.

## Timing (step 7)

`runBench()` median of 3 (whole 132-row bench). The per-size loss columns are the recorded probe's `layoutLine`
**best-of-3** (loss-10..80 × `direct`/`ae2`, from `time-*.json`); `laid` = `search.candidates.length` (the
candidates the search keeps), `ms` the best of 3 lays. Largest mixed line = `mixed-10` (10 machines, one tier).

| variant | runBench median | mixed-10 lines laid | mixed-10 layoutLine (direct/ae2 ms) |
| --- | --: | --: | --: |
| M3 | 2339 ms | 6 | 16.9 / 19.8 |
| O1 | 2685 ms | 7 | 18.2 / 21.8 |
| O2 | 2563 ms | 7 | 21.2 / 25.1 |
| O3 B=8 | 3116 ms | 6 | 22.8 / 28.0 |
| O3 B=16 | 3434 ms | 6 | 25.8 / 32.5 |
| O3 B=32 | 4092 ms | 6 | 25.3 / 30.7 |

`lossLine(n, mode)` — **lines laid / `layoutLine` ms**, M3 against each variant, per size (d = direct):

| variant | 10 d | 10 ae2 | 20 d | 20 ae2 | 40 d | 40 ae2 | 60 d | 60 ae2 | 80 d | 80 ae2 |
| --- | --: | --: | --: | --: | --: | --: | --: | --: | --: | --: |
| M3 | 7 / 32.4 | 8 / 50.8 | 11 / 52.0 | 12 / 89.6 | 11 / 78.4 | 12 / 202.2 | 11 / 117.3 | 12 / 335.5 | 11 / 187.5 | 12 / 531.3 |
| O1 | 8 / 36.2 | 9 / 52.1 | 12 / 52.2 | 13 / 87.4 | 12 / 87.7 | 13 / 206.0 | 12 / 126.5 | 13 / 361.8 | 12 / 197.1 | 13 / 522.3 |
| O2 | 8 / 34.6 | 9 / 54.0 | 12 / 53.5 | 13 / 89.9 | 12 / 87.7 | 13 / 210.2 | 12 / 127.0 | 13 / 354.0 | 12 / 199.7 | 13 / 550.7 |
| O3 B=8 | 7 / 37.8 | 8 / 57.5 | 11 / 60.2 | 12 / 97.7 | 11 / 99.1 | 12 / 228.7 | 11 / 178.6 | 12 / 522.2 | 11 / 285.8 | 12 / 825.8 |
| O3 B=16 | 7 / 43.4 | 8 / 64.3 | 11 / 63.4 | 12 / 103.1 | 11 / 120.1 | 12 / 276.6 | 11 / 248.6 | 12 / 749.9 | 11 / 412.2 | 12 / 1144.5 |
| O3 B=32 | 7 / 54.5 | 8 / 78.3 | 11 / 78.8 | 12 / 122.3 | 11 / 166.8 | 12 / 358.7 | 11 / 407.1 | 12 / 1158.9 | 11 / 650.4 | 12 / 1844.4 |

O1/O2 add exactly one reorder candidate on every line (`laid` +1) and cost a few ms. On the loss lines all
machines are identical, so O3 keeps **no** swap (`laid` = M3, mixed-10 `laid` = 6) — no reorder is *retained*.
The added ms is the pair-swap search laying and scoring swap candidates it then discards, and that cost is **not**
bounded: it grows with line size and B. `loss-80 ae2` goes 531 ms (M3) → 826 (B=8) → 1144 (B=16) → **1844 ms**
(B=32). This is the large-line performance cost the recommendation flags — the reorder search is paid on every
line it explores, not only where a swap wins, so a merge needs a size/effort bound on the search.

## Whole-suite run — best variant (O3 B=8), 6 failures

`npx vitest run` with `o3.patch` applied: **4533 passed, 6 failed, 266 skipped**. All six are expected
consequences of adding reorder candidates; none is a source bug. They are reported, not fixed (the tests live
under `tests/`, out of scope for a spike).

1. `layout-bench.test.ts > no benchmark line gets longer, lossier or weaker than the baseline` — the design-goal
   guardrail, broken by the regressions above: `mixed-14` dir/end loss 286→291, `fluid-02` direct loss 441→444,
   `fluid-09` routed total 62→64 & loss 562→563, `fluid-09` ae2 total 59→61 & loss 562→563.
2. `m3-verify.test.ts > promise 2: packed lines are chosen only where a shared item port is legal` —
   `KIND[CandidateKind.Reordered]` is `undefined`: the verification's kind table has no entry for the new kind 5.
3. `m3-verify.test.ts > promise 4: a row has unreachable machines exactly when it warns machine_unreachable` —
   `mixed-02 ae2` now has **1** shut-in machine (was 2): a reorder improvement, frozen to the "2 machines" text.
4. `reach-warning.test.ts > warns once for mixed-02 in AE2…` — same `mixed-02 ae2` improvement: warns "1 machine"
   where the frozen `AE2_TEXT` says "2 machines".
5. `feeding/check.test.ts > names the cause of the stops on the lines main lays…` — **timed out (60 s)**: the
   reorder search's extra lays on the big `main` lines exceed the per-test budget.
6. `feeding/check.test.ts > checks a 1,200-block line in under a second` — **timed out (120 s)**: the performance
   guardrail is broken by the reorder search on 1,200-block lines.

Failures 2–4 are the frozen expectations of a spike's new candidate kind / the `mixed-02` reachability win;
1 and 5–6 are the two things a follow-up must resolve before merge: the **guardrail regressions** (`mixed-14`,
`fluid-09`, `fluid-02`) and the **large-line performance budget**.

## Design goals (checked on the laid blocks, best variant O3 B=8)

- **Every machine reachable (`unreachable`)** — no changed row gains a shut-in machine in any variant. Two rows
  *improve*: `mixed-02 ae2` 2→1 and `mixed-18 ae2` 2→1 (2→0 at B=32). `m3-verify` promise 4 (unreachable ⇔
  `machine_unreachable`) passes on every row except the frozen "2 machines" text of the improved `mixed-02 ae2`.
- **No rain exposure under the roof** — `m3-verify` promise 5 (the roof covers every block GT rains on; a dry
  biome lays none) passes with `o3.patch` applied. On changed rows the `roof` column drops or holds
  (`mixed-01` 5→3, `mixed-02` 16→13, `mixed-07` 8→7); it grows only on the two regressed `fluid-09` rows
  (9→10, 10→11), where the chosen line itself got 2 blocks longer — more line, more roof, still full cover.
- **No new warning code** — across all 106 changed rows in the five `compare-*.md` files (16+2+30+29+29), `codes Δ`
  adds no code anywhere; of those 106, 105 are `-` and the single non-empty entry is `-machine_unreachable` on
  `mixed-18 ae2` at B=32, a code *removed* by the reachability win. The only warning-related test failures are a changed *count* inside frozen text
  (`mixed-02 ae2` now warns "1 machine" where `AE2_TEXT` says "2 machines"), not a new code.
- **No machine front on its output side** — `m3-verify` promise 3 (front ≠ output side on >100 GT singleblocks,
  no cable-tier contacts, no starved machines) passes with `o3.patch` applied.

## Recommendation

Do not merge as-is — this is a spike. Adopting reorder candidates needs, at minimum, (a) eliminating the
`mixed-14` / `fluid-09` / `fluid-02` regressions so the layout-bench guardrail holds, and (b) bounding the
reorder search's cost on 1,200-block lines so the feeding performance tests pass. On the measured evidence:

- **O3 pair-swap at B=8** is the variant to pursue: it is the only one with large structural wins (`mixed-01` 6 blocks
  shorter and ~50 EU/t less lossy, 41→35 blocks and 387→335 EU/t; `mixed-18` reachability) and pays them for ~+33% bench time.
- **O1 hungriest-first** is a cheap (loss-only, +15%) fallback if the pair-swap search's cost cannot be bounded;
  it needs the same `mixed-14` regression handled.
- **O2 fluid-groups** should be dropped — it is never better than M3 and regresses two rows.

## Files

- `o1.patch`, `o2.patch`, `o3.patch` — `git diff -- src` for each variant (self-contained: the
  `CandidateKind.Reordered = 5` enum member, its `LayoutCandidate` doc, the `buildLocal` `lays` plumbing + reorder
  hook, and the variant's permute; `o3.patch` also carries `SP_M_SWAP_CAP = 8` at the top of `layout.ts`).
- `bench-*.txt` — the `benchTable()` for M3 and each variant run (`o3` at B = 8/16/32).
- `compare-*.md` — per-variant acceptance tables and per-changed-row detail vs M3.
- `order-probe.test.ts.txt` — the throwaway probe (never committed) that lays all 132 rows, dumps the rich per-row
  JSON, writes the `benchTable`, and takes the step-7 timings; it reads `SPM_JSON`/`SPM_BENCH`/`SPM_TIME` paths from env.

## Promotion prototype (CTO, 2026-11-18): `promote.patch`

`promote.patch` is O3 pair-swap with two changes that remove both blockers above. It is a whole `git diff -- src`
against `feat/optimal-layout-m4` at `0b6c6dd5d`, and it still carries the spike's O1/O2 helpers, which M4-1 deletes.

1. **The reordered line never takes a finalist's place.** `buildLocal` ranks the finalists exactly as M3 does, runs
   the swap pass from the best of them (the baseline when there is none), and returns the last accepted swap as a
   separate `reordered` index. A swap must also `replacesBaseline` the baseline itself. `layoutLine` finishes M3's
   finalists exactly as before. It then finishes the reordered line and keeps it only when it `finalReplaces` the
   finished baseline **and** the line kept so far, and `compareFinal` puts it strictly ahead of that line. The search
   record's `chosen` is the reordered line when there is one (it beats `finalists[0]` on the score). Each finished
   line names `chosen`, or `rejected` when it is not that line. This fixes
   `mixed-14`, `fluid-09` and `mixed-05`, which lost M3's runner-up from the two finalist slots. It also fixes
   `fluid-02` direct, which is 1 block shorter but 3 EU/t lossier: Assumption 4 does not trade loss for length.
2. **The swap cap is set by work, not by a count.** `cap = min(8, floor(160 / movable units))`. Lines of up to 20
   movable machines get 8 swaps, `loss-40` gets 4, `loss-80` gets 2, and the 1,200-block feeding lines (hundreds of
   units) get none. Every benchmark win is on a line of 10 machines or fewer.

Measured on this Mac, with M3 on the same machine and the same load:

| check | M3 | promote.patch |
| --- | --: | --: |
| `layout-bench` guardrail | passes | **passes** (no row worse) |
| bench total, direct / routed / ae2 / enderio | 2098 / 2509 / 2333 / 2075 | **2083 / 2501 / 2322 / 2060** |
| bench lossEUt, same order | 10176 / 10837 / 10407 / 10176 | **10100 / 10790 / 10353 / 10100** |
| AE2 shut-in machines (bench) | 6 | **4** (`mixed-02` 2→1, `mixed-18` 2→1) |
| `runBench()` median of 3 | — | 2766 ms |
| `layoutLine` best of 3, loss-80 direct / ae2 | 65.7 / 145.7 ms | 61.8 / 136.8 ms (noise) |
| `bigLine` all four modes (`feeding/check` helper) | 86 s | 88 s |
| `npx vitest run` | — | 4536 passed, **3 failed** (all expected re-pins, below) |

The three failures: `m3-verify` promise 2 (its `KIND` table has no `Reordered`), `m3-verify` promise 4 (with 1
machine shut in it expects the plural "1 machines are closed in", and `SHUT_IN` freezes "2 ×"), and `reach-warning`
"warns once for mixed-02 in AE2" (frozen to "2 machines"). Changed benchmark rows are in `bench-promote.txt`
(diff it against `bench-m3.txt`). The re-pinned values: promise 4's list is `mixed-02 ae2: 1 ×`, `mixed-03 ae2: 2 ×`,
`mixed-18 ae2: 1 × Electric Blast Furnace`. The `mixed-02` AE2 warning reads "1 machine is closed in by the blocks
around it, so you cannot reach it once the line is built: 1× Electric Blast Furnace. Set up each one (circuit, covers,
wrench) before you place the blocks beside it." and is pinned at `[35, 64, 21]`.
