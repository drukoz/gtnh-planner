# GTNH Line Planner: project guide

A web app that plans automation lines for **GregTech: New Horizons 2.9** and fits them into a player's existing base:
the recipe chain, where the line stands in the world, how it hooks into power and logistics, a 3D view, and the build
list. A small group of players runs it on one of their computers and shares it over the network behind one password.
Everything it knows comes from the user's own copy of the pack and world: a recipe export made by `exporter-mod/`,
textures from their mod jars, and scans of their world backups. `projector-mod/` is an in-game ghost projector for
the planned build. User-facing documentation is in `README.md`.

## Layout

- `src/server/`: the Node HTTP server (`main.ts`, `app.ts`, `http/`, `db/`) and the CLIs behind the npm scripts (`cli/`).
  - `planner/`: the recipe-chain solver (linear programs on `highs`).
  - `layout/`: lays a planned line out in the world. `layout.ts` runs the stages: site search (`site.ts`), machine
    placement (`arrange.ts`), the line's own wiring and its loss (`internal.ts`, `power.ts`), hookups to the base's
    power and logistics (`hookups.ts`, `path.ts`), parts and the build list (`parts.ts`), logistics modes (`modes/`).
  - `pack/` reads an export, `export/` makes one, `world/` reads world backups, plus `projects/` and `projector/`.
- `src/client/`: the React 19 and three.js UI (`views/`, `map/`, `three/`, `state/`), built by Vite.
- `src/shared/`: types and code both sides use (`types/`, `layout/`, `plan/`, `gt/`).
- `tests/unit/` (Vitest on Node), `tests/client/` (Vitest, `*.test.tsx`), `tests/e2e/` (Playwright), and
  `tests/helpers/` (fixtures: `layout-fixtures.ts` has `makeScan`, `makePlan`, `flatVoxels`, `layoutPack` and `IDS`;
  `power-loss.ts` is the line-loss harness).
- `docs/superpowers/specs/`: designs; the main one is `2026-10-17-gtnh-planner-design.md`.
  `docs/superpowers/plans/2026-10-17-00-architecture.md` is the "architecture §…" that code comments cite, and
  `docs/research/` holds the game mechanics (for example `gt-mechanics.md`).

## Commands

Run them from the repository root.

- Setup: `npm ci`. A new worktree has no `node_modules/`.
- Typecheck: `npx tsc -b`. No output means clean. Node runs the `.ts` sources directly, so this is the only compile
  step for the server.
- All tests: `npm test` (`tsc -b && vitest run`, about 20 s). At `093dda3cf` it gives 240 files passed | 18 skipped,
  3984 tests passed | 188 skipped.
- One file or folder: `npx vitest run tests/unit/layout/power-loss.test.ts`, or `npx vitest run tests/unit/layout`.
- Browser tests: `npm run e2e`. It builds the client, then runs Chromium against a real server on 127.0.0.1:18787,
  with data that `tests/e2e/prepare.ts` writes to `data/e2e/`. It needs Playwright's Chromium
  (`npx playwright install chromium`).
- See the app with test data: `npm run build`, then
  `node --disable-warning=ExperimentalWarning tests/e2e/prepare.ts`, then
  `GTNH_PLANNER_CONFIG=data/e2e/config.json npm start`, and open `http://127.0.0.1:18787`. The password is
  `E2E_PASSWORD` in `tests/e2e/helpers.ts`.
- Projector mod jar: `cd projector-mod && VERSION=0.2.0 ./gradlew assemble`; the jar lands in
  `projector-mod/build/libs/`. The exporter mod is built by `npm run export` (see Dangers).

## Toolchain

- Node `>=24.10.0 <25` (`engines` in `package.json`). TypeScript 6.0.3, Vite 8.3.2, Vitest 5.0.3, Playwright 1.63.0,
  React 19.3.0, three 0.186.1, highs 1.15.3. Every version is pinned exactly in `package.json`. Add no dependency
  unless your task says so.
- Mods: Minecraft 1.7.10 on the GTNH buildscript (blowdryer 0.2.2), the Gradle 9.7.1 wrapper, and Jabel for modern
  Java syntax (`enableModernJavaSyntax`). The export also needs the Java the user's GTNH server runs on; Java 25 works.

## Conventions

- TypeScript ESM with `strict`, `noUncheckedIndexedAccess` and `erasableSyntaxOnly`: no `enum`, no `namespace`, no
  constructor parameter properties, and no `any`. Imports are relative and end in `.ts`; type-only imports use
  `import type`; Node built-ins use the `node:` prefix.
- Every exported symbol has a doc comment in the plain style of the file around it. Update the comment when the
  behaviour changes. Comments cite the design they implement ("spec §3.5", "architecture §11", "gt-mechanics §3.2").
- Determinism is a hard requirement: the same inputs give the same layout, block for block. Sort every list you
  build with the comparator the code around it already uses (for example `compareBlocks` in `layout/layout.ts`, or
  `compareMachineId` in `src/shared/ids.ts`). Never iterate a `Set` or `Map` whose insertion order depends on
  something unordered.
- Keep diffs tight: do not reformat code you are not changing.
- Tests stay quiet: no `console.log` in committed tests. To measure something, write a temporary test that writes
  its numbers to a file under `/tmp`, read them, and delete the test before you commit.
- The loss budgets in `tests/unit/layout/power-loss.test.ts` may only ever be lowered. A line that loses more means
  the routing got worse; report it instead of raising the number.
- Commit messages usually start with a lowercase type (`test:`, `fix(layout):`, `feat(layout):`, `docs:`) and end
  with the task id, for example `test: re-baseline the loss harness on Layout.loss.totalEUt (RUK-124)`.

## Git

- The default branch is `main`. Work goes onto a feature branch (`feat/…`), and each task commits on the branch its
  worktree is already on. Never switch or create branches, never push to `main`, and never force-push.

## Dangers

- Wherever the planner runs, `data/` holds the user's real data: pack exports, world scans, uploads, the project
  database, and `data/config.json` with the password hash and session secret. It is git-ignored. Never commit it,
  and never edit or delete anything in it except `data/e2e/`, which the tests rebuild on every run.
- Do not run `npm run export`, `npm run scan`, `npm run extract-assets`, `npm run import-nei-icons` or
  `npm run set-password` unless your task says so. `export` clones the user's GTNH server folder and starts a copy
  of the Minecraft server on 127.0.0.1:25566; `set-password -- --rotate-sessions` logs the whole group out.
- `npm start` and `npm run dev:server` without `GTNH_PLANNER_CONFIG` listen on 0.0.0.0:8765, the port the group
  uses. Always start the server with a scratch config such as `data/e2e/config.json`.
- Nothing game-made goes into the repository: no textures, recipes, jars or exports. They come from the user's own
  pack and stay on their machine.

## Known flaky tests

Two wall-clock assertions fail at random under load: `tests/unit/layout/feed-ae2.test.ts` and
`tests/unit/layout/path.test.ts` (RUK-125). Re-run the file before you chase a failure there.
