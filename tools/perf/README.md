# `tools/perf`: plan the group's projects on a server of its own, time them, and check the bytes

`npm run perf` (RUK-563) measures the planner's cold and warm planning on a copy of the group's real data, and checks
that a change to the code changed nothing: it plans and lays out every project of that copy on a server it starts itself,
times every request and how long the server takes to answer `/api/health` in the meantime, and compares every plan and
layout byte for byte against a reference run. Exit 0 only when every request answered 200 and nothing differs.

## The command

```
npm run perf -- --source <copy of the data> --out <new folder> --reference <folder> [--restart] [--profile] [--threads N]
```

- `--source` (required): a copy of the group's data, as `/tmp/ruk529` holds it (milestone 2's corpus).
- `--out` (required): a folder that does not exist yet, or is empty. The tool refuses anything else and deletes nothing
  it did not create.
- `--reference`: a folder of reference passes to check against, as `/tmp/ruk563/reference` holds them.
- `--restart`: after the warm rounds, stop the server, start it again on the same run folder, and plan and lay out
  everything a second time.
- `--profile`: the server writes its main thread's CPU profile to `<out>/prof/<pass>` when it exits. Summarising it is
  your own work (`node --prof-process`, or DevTools).
- `--threads N` (default 4): `GTNH_LP_THREADS`, how many solver threads the server uses (1 to 64).

`node tools/perf/compare.ts <reference> <run>` runs just the check against an existing run folder.

## The source folder

`--source` needs `planner.sqlite.orig` (the project database, which the tool copies and never opens in place),
`config.json` (only its `activeExportId` is read), `data/export/` (the recipe export) and `data/scans/` (world scans).
A source without one of those is refused with exit 2, so a checkout's own `data/` can never be used by accident. The
corpus's `data/assets/` (80,000 texture files) is not copied: no plan or layout reads it.

## What a run makes

- `<out>/cold/plan-<id>.json` and `cold/layout-<id>.json`, `warm1/plan-<id>.json`, `warm2/plan-<id>.json`, and with
  `--restart` `restart/plan-<id>.json` and `restart/layout-<id>.json` — each answer's body exactly as it arrived.
- `<out>/run/`: the run's own server config, and the copies the server reads (`data/export`, `data/scans`,
  `data/planner.sqlite`, as APFS clones), deleted again when the server has stopped.
- `<out>/server.log`: everything the server printed.
- `<out>/prof/<pass>/*.cpuprofile`: only with `--profile`.
- `<out>/summary.json`: the numbers the table prints, plus:
  - `commit` and `dirty`: the code the run measured, from `git rev-parse HEAD` and `git status --porcelain`.
  - `threads`, and `loadavg.start` / `loadavg.end`: the solver threads and the machine's load at the start and end. A
    cold total only means something next to a load average: the solver threads and a busy Mac fight for the same cores.
  - `passes.<pass>`: `totalSeconds`, one row per project (`planSeconds`, `layoutSeconds` where the pass lays out,
    `healthMaxSeconds` = the longest `/api/health` answer during that project, and the HTTP `status` of each request),
    and `health` = the pass's probe answer times as `p50`, `p95` and `max`.
  - `compare`: what `compareRuns` found, with `compared`, `missing`, `differing` (each with the first differing byte's
    `offset` and 40 bytes of context from each file) and `skippedPasses`.

## Reading the table and the check

Projects are visited oldest first (`createdAt`, then `id`), because a plan reads the surplus other projects published,
which the database stores: a different order gives different bytes. The runs are on a fresh copy of the database every
time, so `cold` plans everything, and `warm1` and `warm2` answer every plan from the cache. `restart` shows what a fresh
server costs the group after a reboot.

- `cold total` is the number milestone 2 works on; `health max` is how long the server ignored a cheap request while it
  planned, which is what the whole group feels when one of them presses plan.
- `SKIPPED <pass>`: the run did not make that pass (no `--restart`, say) — its files are not counted and not missing.
- `MISSING <pass>/<name>`: the reference has a file the run did not write.
- `DIFF <pass>/<name> at byte <offset>`: the first byte where they differ, then 40 bytes of each file from there. A plan
  that changed at all shows here; that is the point, so read the pair before you believe it.

Files and passes only the run has are ignored, so you can add a project to the corpus and keep the reference.

## Dangers

- The tool starts its own server on a free port (config `port` 0, host `127.0.0.1`, `requirePassword` false) and stops
  only that child, through its handle. Never kill a planner by name or pattern: the group's own planner runs the same
  command line (`node … src/server/main.ts`) on this Mac.
- Never write under `--source`, the reference, or the CTO's scratch folder, and never point `--source` at a checkout's
  `data/`: it holds no `planner.sqlite.orig`, so the tool refuses it.
- The run server answers with no password on `127.0.0.1` only, for the length of the run.
- Do not run the tool twice into the same `--out`, and do not run two on one corpus with the same `--out`: the second is
  refused, which is the point of the check.
