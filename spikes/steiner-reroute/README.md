# SP-B: shorter power trees than nearest-first `growTree`

## Verdict

The spike wins on 9 of the 132 benchmark rows: variant A and variant B both save 25 cable blocks, and the same 9 rows each lose total blocks. No row gets longer, weaker, or has more route failures.

It is not mergeable. The same 9 rows get higher `lossEUt`, and `tests/unit/layout/layout-bench.test.ts > layout benchmark > no benchmark line gets longer, lossier or weaker than the baseline` fails under variant B. The benchmark guard treats the loss regression as a hard failure. Variant B is also slower than variant A on every benchmark run and finds no additional saving on these rows.

## Exact commands

The spike code was applied to the real power-tree call site in `src/server/layout/internal.ts`, then the 132-row benchmark was measured through a temporary unit test:

```sh
GTNH_SP_B_MODE=baseline npx vitest run tests/unit/layout/sp-b-measure.test.ts
GTNH_SP_B_MODE=orders npx vitest run tests/unit/layout/sp-b-measure.test.ts
GTNH_SP_B_MODE=reroute npx vitest run tests/unit/layout/sp-b-measure.test.ts
```

Three timing runs were collected for each mode:

```sh
rm -f /tmp/sp-b-baseline.json /tmp/sp-b-baseline.md /tmp/sp-b-baseline-times.txt
for i in 1 2 3; do GTNH_SP_B_MODE=baseline npx vitest run tests/unit/layout/sp-b-measure.test.ts > /dev/null 2>&1 || echo "baseline run $i FAILED"; done

rm -f /tmp/sp-b-orders.json /tmp/sp-b-orders.md /tmp/sp-b-orders-times.txt
for i in 1 2 3; do GTNH_SP_B_MODE=orders npx vitest run tests/unit/layout/sp-b-measure.test.ts > /dev/null 2>&1 || echo "orders run $i FAILED"; done

rm -f /tmp/sp-b-reroute.json /tmp/sp-b-reroute.md /tmp/sp-b-reroute-times.txt
for i in 1 2 3; do GTNH_SP_B_MODE=reroute npx vitest run tests/unit/layout/sp-b-measure.test.ts > /dev/null 2>&1 || echo "reroute run $i FAILED"; done
```

The temporary test wrote row JSON to `/tmp/sp-b-<mode>.json`, Markdown tables to `/tmp/sp-b-<mode>.md`, and wall-clock milliseconds to `/tmp/sp-b-<mode>-times.txt`.

## What the spike tried

`growTreeBest` in the patch has three modes:

- `baseline`: current `growTree`, nearest-terminal-first greedy join.
- `orders`: variant A. Grow the same tree with four fixed terminal orders: `nearest`, `farthest`, `xz`, and `zx`. Keep the tree with the fewest cells.
- `reroute`: variant B. Run variant A, then rip up and reroute each terminal's branch in the chosen tree. A rerouted branch is kept only when it has fewer cells and every remaining live cell still reaches a root.

The reroute machinery is not dead: in a 40,000-case random search over small boxes, blocked cells, roots, and terminals, it shortened the tree in 1,721 cases. It did not find an additional win on the 132 real benchmark rows after variant A had already picked the best of the four orders.

## Per-mode sums

Baseline, variant A (`orders`), and variant B (`reroute`) over all 132 benchmark rows:

| Mode | Cable blocks | Total placed blocks | Loss EU/t | Weak rows | Route failures |
|---|---:|---:|---:|---:|---:|
| baseline | 4528 | 8500 | 75143 | 7 | 6 |
| A: orders | 4503 | 8475 | 75299 | 7 | 6 |
| B: reroute | 4503 | 8475 | 75299 | 7 | 6 |

## Rows shortened by B

All 9 rows where B changes the result, sorted by cable saved:

| Line | Mode | Baseline cable | A cable | B cable | Cable saved |
|---|---|---:|---:|---:|---:|
| mixed-02 | routed | 61 | 56 | 56 | 5 |
| mixed-02 | ae2 | 69 | 65 | 65 | 4 |
| mixed-02 | direct | 59 | 55 | 55 | 4 |
| mixed-02 | enderio | 59 | 55 | 55 | 4 |
| mixed-03 | ae2 | 56 | 53 | 53 | 3 |
| mixed-03 | routed | 46 | 44 | 44 | 2 |
| mixed-00 | ae2 | 69 | 68 | 68 | 1 |
| mixed-08 | ae2 | 89 | 88 | 88 | 1 |
| mixed-11 | ae2 | 41 | 40 | 40 | 1 |

There is no top-20 cutoff effect: only 9 rows change at all.

## Rows made worse

No row gets longer. No row gets weaker. No row gets more route failures.

Nine rows get lossier. The full list under B, with baseline loss and B loss:

| Line | Mode | Baseline loss EU/t | B loss EU/t | Loss delta |
|---|---|---:|---:|---:|
| mixed-00 | ae2 | 376 | 384 | +8 |
| mixed-02 | direct | 241 | 285 | +44 |
| mixed-02 | routed | 246 | 286 | +40 |
| mixed-02 | ae2 | 319 | 331 | +12 |
| mixed-02 | enderio | 241 | 285 | +44 |
| mixed-03 | routed | 196 | 198 | +2 |
| mixed-03 | ae2 | 233 | 235 | +2 |
| mixed-08 | ae2 | 470 | 472 | +2 |
| mixed-11 | ae2 | 113 | 115 | +2 |

Variant A has the same nine worsening rows and the same loss values.

## Failing tests with B

`GTNH_SP_B_MODE=reroute npx vitest run tests/unit/layout`

Failing tests:

- `tests/unit/layout/layout-bench.test.ts > layout benchmark > no benchmark line gets longer, lossier or weaker than the baseline`

The offense list is exactly the nine loss regressions above.

`GTNH_SP_B_MODE=reroute npx vitest run tests/unit/layout/path.test.ts` passes: all 7 existing `growTree` tests pass with the patch applied.

## Runtime

`runBench()` wall-clock times from the temporary measurement test:

| Mode | Runs (ms) | Median |
|---|---:|---:|
| baseline | 677, 700, 711 | 700 ms |
| A: orders | 981, 998, 1014 | 998 ms |
| B: reroute | 1280, 1284, 1297 | 1284 ms |

Variant A costs about 1.43x baseline. Variant B costs about 1.83x baseline and about 1.29x variant A.

## Recommendation

Do not promote the patch as-is. The 25-block cable saving is real, but it is paid for by loss regressions that break the benchmark guard. If this direction is continued, tree selection must optimize the benchmark's actual guard, not cable cells alone: select by loss first, cable cells second, or add a reroute/order-acceptance rule that rejects any tree whose per-row loss exceeds baseline.
