# Spike: a native HiGHS instead of highs-js (RUK-563)

Question: can a native build of HiGHS replace `highs` (highs-js, HiGHS compiled to WebAssembly) and keep every plan
byte for byte? The planner's plans are decided by its LPs and build-cost MIPs, so a native solver must give the same
bits, not just the same objective.

## What exists

- `highs` 1.15.3 (the pinned highs-js) wraps HiGHS 1.15.1 (`HiGHS` submodule at `04024d7`).
- npm: `highs-addon` 0.10.3 (opvious/highs.ts, Apache-2.0, last push 2025-12) wraps HiGHS 1.11.0 and has no callbacks.
  The build MIP needs two (`mipInterrupt` for `maxIterations` and `stopOnRootLpFailure`, `mipImprovingSolution` for
  `keepImproving`; `src/server/planner/lp.ts`). `ortools-node` reaches HiGHS only through OR-Tools' MPSolver.
- PyPI: `highspy` 1.15.1 is HiGHS 1.15.1, with wheels for macOS arm64. Its callback output has no
  `mip_total_lp_iterations` (HiGHS's C struct does), so it cannot replay the solves that read it.

## The probe

1. `dump-solves.patch` (not for merging) makes `solveLp` append every solve it makes to
   `$RUK563_DUMP/solves-<pid>-<thread>.jsonl`: the exact arrays passed to HiGHS (after row scaling), the options, the
   start, the callback settings, highs-js's result and its solve time. Plans made with it stay byte-identical.
2. Three cold plans of the group's projects (MV circuit, Circuit, test; 428 solves) were dumped.
3. `compare_native.py <dump dir> ['{"threads": 1}']` solves each one again with highspy, skipping those that need
   `mip_total_lp_iterations`, and compares status, objective and every value bit for bit (0 and -0 count as equal).

## Results (2026-11-04)

| highspy 1.15.1 | LPs bit-identical | MIPs bit-identical | LP solve time (highs-js → native) |
| --- | ---: | ---: | --- |
| PyPI wheel | 77 of 421 | 0 of 3 | 5.1 s → 2.2 s |
| built from source with `-ffp-contract=off` | 421 of 421 | 0 of 3 (also with `threads=1`) | 5.1 s → 2.1 s |

Clang on arm64 fuses multiply and add by default; WebAssembly has no fused multiply-add, so only the build without it
gives the LPs' bits. The MIPs differ even then (same start, one thread), so something in HiGHS's MIP search differs
between the two builds.

Decision: no native HiGHS in milestone 2. The build MIPs decide the plans. Native LPs alone would save about 4 s of the
seven cold plans (their LPs take about 7 s) for a C++ toolchain and a HiGHS build in every install.

## Reproduce

```bash
# a scratch worktree of the branch, with the patch
git worktree add --detach /tmp/native-probe origin/feat/perf-m2 && cd /tmp/native-probe
npm ci && git apply spikes/native-highs/dump-solves.patch
# plan a few projects with RUK563_DUMP=/tmp/native-dump in the server's environment (mkdir it first)
# then, in Python 3.11:
python3.11 -m venv /tmp/hpy && /tmp/hpy/bin/pip install numpy highspy==1.15.1
/tmp/hpy/bin/python -I spikes/native-highs/compare_native.py /tmp/native-dump '{"threads": 1}'
# the build without fused multiply-add (several minutes):
python3.11 -m venv /tmp/hpy-nofma && /tmp/hpy-nofma/bin/pip install numpy
/tmp/hpy-nofma/bin/pip install --no-binary highspy highspy==1.15.1 \
  -C cmake.define.CMAKE_CXX_FLAGS=-ffp-contract=off -C cmake.define.CMAKE_C_FLAGS=-ffp-contract=off
```
