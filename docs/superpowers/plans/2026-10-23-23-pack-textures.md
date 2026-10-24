# Add-on 23: Textures from the User's Resource Packs, Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** `npm run extract-assets` also reads the resource packs enabled in the user's GTNH client and lets them win
over every jar, as the game does, so the 3D view, the Map's colours and the item textures look like the user's game.

**Architecture:** A small reader (`src/server/assets/resource-packs.ts`) takes the enabled pack list from the client
instance's `options.txt`, once per run, plus each pack's `pack.mcmeta` version. A pure function
(`src/server/assets/pack-layer.ts`) puts the packs over the jars' winners: it picks each path's winner, its spelling
and its `.mcmeta`. `extract.ts` scans and copies the folder packs and the zip packs next to the jars. It records the
pack list in `index.json`. The CLI reports when the packs changed since the last run. Resolvers, routes and the client
do not change: they already read whatever `index.json` lists.

**Tech Stack:** Node `>=24.10.0 <25` running TypeScript directly (erasable syntax only), yauzl 3.4.0 (already a
dependency) for zips, `node:fs/promises` for folder packs, vitest 5.

**Spec:** `docs/superpowers/specs/2026-10-23-base-around-the-line-design.md`, section "Textures from the user's
resource packs" only. Read the whole spec for context: the base view, the fit classes and the 3D drag are **not** in
this plan; they build after plan 22. The user approved building this part first (2026-10-23).

## Global Constraints

- Packs rank above every jar. Among packs, the **last** name in `options.txt`'s `resourcePacks` line wins (Minecraft
  1.7.10 saves the selected list lowest priority first). The jars keep today's rule among themselves (`pickWinner`,
  `src/server/assets/extract.ts:102-117`), and `conflicts` still lists jar-against-jar decisions only.
- Folder packs match file names without regard to case (as the game does on this Mac's file system). Zip packs match
  exactly. No two indexed paths ever differ only in case: the Mac's disk would merge them on write.
- Blocks **and** items with their `.mcmeta`, plus the chest model sheets `textureEntry` already accepts. An `.mcmeta`
  pairs with its PNG as the game pairs them: it comes from the highest pack at or above the PNG's pack. A jar PNG takes
  a pack's `.mcmeta` if one exists, else its own jar's, as today. A pack PNG without such an `.mcmeta` is still.
- Item icons with an NEI dump icon keep it: the resolver order does not change. `data/assets/nei/` survives every
  extraction, and no pack is ever extracted into it.
- Connected textures (MCPatcher CTM, under `mcpatcher/`) are not drawn. Animated textures show frame 0, as today.
- The index records each file's source (`files[p].jar`: a jar's file name or a pack's name), every pack read (name,
  folder or zip, version from `pack.mcmeta`, its counts) and the enabled list as read (`packs.enabled`). A later run
  prints what changed.
- The instance path is the config key `clientInstance` (next to `clientJar`, `src/server/config.ts:18`) or the CLI flag
  `--instance <folder>`. It is never written into a committed file. With neither set, the extraction is today's.
- The instance is read **read-only**. Read `options.txt` once per run. Open zips with yauzl (read-only, as jars are
  today) and folder files with `readFile`. Nothing under the instance is written, renamed or locked.
- Nothing from a pack, and nothing game-derived, is ever committed. `data/`, `docs/local/` and `.local/` are gitignored.
  Committed files contain no absolute local path (`/Users/…`, `/private/tmp/…`) and no private data (player names,
  UUIDs, coordinates, server address). Public pack names in tests are fine.
- No new npm dependency. `src/shared/` is not touched. Erasable TypeScript only (`tsconfig.base.json`:
  `erasableSyntaxOnly`).
- The user's preference (binding): fewer moving parts, no slower site, never commit game-derived files.
- Real-data checks run only with `GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json`. That worktree-local
  config uses port 18794, host `127.0.0.1` and `dataDir` = this worktree's `data/`. There `export` and `scans` are
  symlinks to the main checkout's, read only. `data/assets` is a **real** worktree-local folder, never a symlink to
  the live assets, because the extraction writes it. Only `activeExportId`, `serverFolder` and `clientJar` are ever
  read from the main checkout's `data/config.json`, which holds secrets. Nothing from it is printed.
- Never write the main checkout or its `data/`. Never start, stop or modify the live Minecraft server. Never send a
  request to 127.0.0.1:8765 or 8766. Never touch the `plan-18-projector-aim-screen` worktree.
- Architecture §11 entry **54** (53 is reserved for plan 22; 39, 41, 44, 45 and 46 are reserved for add-ons still on
  branches). It amends entries 17 and 43 (i).
- The live extraction into the main checkout's `data/assets` is a **controller** step after the merge. It is written out
  at the end of this plan and is not an agent task.

## Review Focus

1. **A pack file whose name differs from the game's only in case.** Measured on 2026-10-23: 32 UU-Tex (folder) paths
   and 7 Modernity (zip) paths. A folder file must replace the jar's texture under the jar's spelling. A zip file must
   be left out and counted. Neither may add a second, case-variant path. Tests: Task 2 `case`, Task 3 `writes one file
   per path`.
2. **`pack.mcmeta` and `options.txt` as real users have them.** These include a UTF-8 byte-order mark (both
   Modernity packs' `pack.mcmeta` start with one), CRLF line endings, a listed pack that is gone, a pack without a
   valid `pack.mcmeta` and a name such as `../x`. Each must be read or skipped with a warning, never crash, and never
   be read outside `resourcepacks/`. Test: Task 1 `readPackSet`.
3. **A pack "PNG" that is not a PNG.** Modernity's `dreamcraft/textures/blocks/blockPixieDust.png` is a JPEG. It is
   left out with a warning that names it, as for jars today. It falls back to no jar copy, because the game draws the
   top pack's file or nothing. Test: Task 3 `not a PNG`.
4. **The pack changes while the extraction runs** (the client is open and the user switches packs). Each file must be
   copied exactly as scanned. Otherwise the run fails, and the previous textures stay in place. Test: Task 3
   `copyFromFolder refuses a file that changed`.
5. **A later run that is not the first.** It must say what changed (a pack added, removed, re-ordered, updated, its
   files edited) and print nothing about packs when nothing changed. `--no-packs` after a packs run must say the packs
   were removed. Tests: Task 1 `packChanges`, Task 4 `reports pack changes`.

---

## File Structure

| File | Task | Responsibility |
|---|---|---|
| `src/server/assets/resource-packs.ts` (new) | 1 | find the game folder, read `options.txt` and each enabled pack's `pack.mcmeta`, describe what changed |
| `src/server/assets/pack-layer.ts` (new) | 2 | pure: each path's winner, spelling and `.mcmeta` with packs over jars |
| `src/server/assets/index.ts` | 1, 3 | `AssetPacks` / `PackRecord` types (1), `packs` validation (3) |
| `src/server/assets/extract.ts` | 3 | scan and copy folder and zip packs, write `packs` and per-file sources |
| `src/server/assets/png.ts` | 3 | `animationFrames` tolerates a byte-order mark |
| `src/server/config.ts` | 4 | optional `clientInstance` key |
| `src/server/cli/extract-assets.ts` | 4 | `--instance`, `--no-packs`, pack lines, change report |
| `tests/unit/assets/resource-packs.test.ts` (new) | 1 | |
| `tests/unit/assets/pack-layer.test.ts` (new) | 2 | |
| `tests/unit/assets/extract.test.ts`, `index.test.ts`, `png.test.ts` | 3 | |
| `tests/unit/cli/extract-assets.test.ts`, `tests/unit/server/config.test.ts` | 4 | |
| `tests/unit/assets/real-assets.test.ts` (+ `real-coverage.test.ts` only if a bound moves) | 5 | re-baseline on the pack extraction |
| `README.md`, `docs/superpowers/plans/2026-10-17-00-architecture.md` | 6 | user docs, §11 entry 54 |

Facts the tasks rely on, checked on this tree (2026-10-23):

- `src/server/assets/extract.ts`: `JarSource` at :16, `pickWinner` at :102-117, `scanJar` (zips only, yauzl) at
  :123-140, `copyFromJar` at :152-206, `.mcmeta` paired within the winning jar at :348, `swapIn` (keeps `nei/`) at
  :234-268, `extractAssets` at :276-401.
- `src/server/assets/index.ts:11` `AssetFileInfo.jar`; :13-18 `AssetIndexFile`; :101-114 `checkFile`. `files[p].jar`
  is read nowhere but `checkFile`. `index.file.files` keys are read by `names.ts:64`.
- `src/server/assets/service.ts` reloads `index.json` (and the texture dump against it) within a second of a change. The
  client caches each decoded texture per page (`src/client/assets/texture-image.ts:47`). `GET /api/assets/file/*`
  sends `Cache-Control: private, max-age=3600` (`src/server/http/routes/assets.ts:19`).
- **The Map bakes no colours at scan time.** `data/scans/<id>/tiles/` holds palette indices and heights
  (`src/server/world/tiles.ts:1-2`). `src/client/map/palette.ts` averages each block's top texture in the browser on
  each page load. So the Map follows the new textures at the next page load. No scan needs a refresh.
- The user's client (read-only, 2026-10-23): Prism Launcher's GTNH 2.9.0-RC-1 instance, game folder `.minecraft`.
  `options.txt` line 18 reads `resourcePacks:["UU-Tex-main","Modernity-GTNH-Dark-UI","Modernity-GTNH-2026-08-31.zip"]`.
  The `pack.mcmeta` versions by this plan's rule are `2.0` (UU-Tex's `gtnh_resource_pack_updater.pack_version`),
  `Modrenity-GTNH-DARK-UI-v1.2.1` and `Modernity-GTNH-v1.5.6` (BOM-prefixed descriptions, `§b` removed). CTM files
  live under `assets/<domain>/mcpatcher/`, so `textureEntry` already ignores them. Neither pack has an
  `assets/nei/textures/` folder. Modernity ships chest sheets (`assets/minecraft/textures/entity/chest/normal.png`).
- `tests/unit/assets/real-assets.test.ts` already fails on main (backlog): the Iron Ore icon resolves to `nei`
  (`:58-61` expects `gt`), and the icon coverage is 42.3 % against `> 0.9` (`:94`). With packs, the LV Macerator's
  faces (`:45-46`) gain `OVERLAY_FRONT_GLOW` and `OVERLAY_TOP_GLOW`. Both packs ship them, and GT draws its
  `customOptional` glow icons when the file exists (`docs/research/textures-icons.md` line 153).

---

### Task 0: Base check and the worktree's data

No commit. Nothing here changes a tracked file.

**Files:** none tracked. Creates the gitignored `data/` (symlinks, a real `data/assets`, `data/real-config.json`) and
`.local/pack-runs.md`.

- [ ] **Step 1: Check the base**

```bash
git status --short && git log --oneline -2 && git branch --show-current
```
Expected: clean, `21d55b6 docs(spec): your base around the line …` on top of `cfaa05b`, branch
`plan/23-pack-textures`.

- [ ] **Step 2: Install and run the suite**

```bash
npm ci && npm test
```
Expected: green (real-data tests skipped). Write the pass/skip counts at the top of `.local/pack-runs.md`.

- [ ] **Step 3: Set up the worktree's data**

```bash
REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
mkdir -p data .local
ln -s "$REPO/data/export" data/export
ln -s "$REPO/data/scans" data/scans                  # read only: real-coverage reads the newest done scan
mkdir data/assets                                    # a REAL folder: the extraction writes it
cp -Rc "$REPO/data/assets/nei" data/assets/nei       # APFS clone of the NEI import; the main checkout is only read
python3 -I -c "import json,os,sys; c=json.load(open(sys.argv[1])); json.dump({'dataDir': os.path.abspath('data'), 'serverFolder': c.get('serverFolder'), 'activeExportId': c.get('activeExportId'), 'clientJar': c.get('clientJar'), 'host': '127.0.0.1', 'port': 18794}, open('data/real-config.json', 'w'), indent=2)" "$REPO/data/config.json"
chmod 600 data/real-config.json
test -L data/assets && echo WRONG || echo ok
```
Expected: `ok`. Nothing is printed from the main config.

- [ ] **Step 4: A stock extraction with today's code, as the baseline**

```bash
time GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npm run extract-assets
```
Expected: exit 0, `Extracted 44… textures (… MB) from 21… jars into …/data/assets`. `data/assets/nei/index.json`
still exists.

- [ ] **Step 5: Baseline the real-data tests and the load time**

```bash
GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npx vitest run tests/unit/assets/real-assets.test.ts tests/unit/assets/real-coverage.test.ts
GTNH_PLANNER_CONFIG=$PWD/data/real-config.json node --disable-warning=ExperimentalWarning --input-type=module -e "
const { loadConfig, activeExportDir } = await import('./src/server/config.ts');
const { loadAssetIndex } = await import('./src/server/assets/index.ts');
const { loadTexturesDump } = await import('./src/server/assets/textures-dump.ts');
const c = loadConfig(); const t0 = performance.now();
const ix = await loadAssetIndex(c.dataDir + '/assets'); const t1 = performance.now();
const d = await loadTexturesDump(activeExportDir(c), ix); const t2 = performance.now();
console.log(JSON.stringify({ files: ix.size, indexMs: Math.round(t1 - t0), dumpMs: Math.round(t2 - t1), droppedLayers: d?.stats.droppedLayers }));"
du -sh data/assets
```
Expected: `real-assets` fails exactly the two known ways: `:59` source `nei` and `:94` icon share about 0.42.
`real-coverage` passes, or its failures are written down. Record in `.local/pack-runs.md`: each failure, the printed
coverage line(s), the JSON line, `du`, and the extraction's wall time. If anything else fails, stop and report to the
controller.

---

### Task 1: Reading the client instance

**Files:**
- Create: `src/server/assets/resource-packs.ts`, `tests/unit/assets/resource-packs.test.ts`
- Modify: `src/server/assets/index.ts:13-18` (types only)

**Interfaces:**
- Consumes: `snapshot(dir)` from `tests/helpers/fake-server.ts:90`, `makeJar` from `tests/helpers/jar.ts`.
- Produces:
  - `index.ts`:
    `export interface PackRecord { name: string; format: 'folder' | 'zip'; version: string; entries: number /* texture entries scanned: PNG + .mcmeta */; bytes: number /* their total size */; files: number /* PNG paths it supplied */ }`;
    `export interface AssetPacks { enabled: string[] /* options.txt's resourcePacks as read, lowest priority first */; read: PackRecord[] /* the packs read, lowest first */ }`;
    `AssetIndexFile.packs?: AssetPacks` (present only when the run read an instance).
  - `resource-packs.ts`:
    - `export interface PackSource { name: string; path: string; format: 'folder' | 'zip'; version: string }`
    - `export interface PackSet { enabled: string[]; packs: PackSource[] }` (both lowest priority first)
    - `export interface SkippedPack { name: string; reason: string }`
    - `export function parseResourcePacks(optionsTxt: string): string[]`: the strings of the JSON array after
      `resourcePacks:` on its own line (CRLF or LF). Non-strings are dropped. Returns `[]` when the line is missing
      or not a JSON array.
    - `export function packVersion(mcmetaText: string): string | null`: `null` unless the text, without a leading
      U+FEFF, parses to an object with a `pack` object (the game skips such a pack). Otherwise:
      `gtnh_resource_pack_updater.pack_version` when it is a non-empty string; else `pack.description` as a string
      with every `§x` code removed and trimmed; else `''`.
    - `export function gameDirOf(folder: string): string | null`: the first of `folder`, `folder/.minecraft` and
      `folder/minecraft` that holds an `options.txt` file.
    - `export async function readPackSet(gameDir: string): Promise<{ set: PackSet; skipped: SkippedPack[] }>`
    - `export function packChanges(prev: AssetPacks | undefined, next: AssetPacks | undefined): string[]`

`readPackSet` reads `options.txt` once. `enabled` is `parseResourcePacks` of it, as listed. For each name it checks, in
order:
- the name is empty, `.` or `..`, or holds `/`, `\` or a control character: skipped with `not a pack name`;
- the name was listed before: skipped with `listed twice`;
- `<gameDir>/resourcepacks/<name>` (followed with `stat`) is neither a folder nor a file: skipped with
  `not in resourcepacks/`;
- a folder's `pack.mcmeta` (`readFile`), or a zip's top-level `pack.mcmeta` entry (yauzl, `lazyEntries`, closed in
  `finally`), cannot be read or `packVersion` gives `null`: skipped with
  `no valid pack.mcmeta (the game skips it too)`;
- a zip that yauzl cannot open: skipped with yauzl's message.

`packChanges` compares packs by name, both `undefined` → `[]`, `undefined` counts as `{ enabled: [], read: [] }`.
Lines, in this order:
1. For each pack of `next.read`, lowest first, at most one line: `added <name> (<version>)`, or
   `<name>: <old version> → <new version>`, or `<name>: same version, different files` when `entries` or `bytes`
   differ.
2. For each pack of `prev.read` missing from `next`, lowest first: `removed <name>`.
3. When the names in both keep a different relative order: `order changed, last wins: <next names, highest first,
   joined by ', '>`.

- [ ] **Step 1: Write the failing tests** (`tests/unit/assets/resource-packs.test.ts`)

```ts
it('parseResourcePacks', () => {
  expect(parseResourcePacks('version:0\r\nresourcePacks:["UU-Tex-main","Modernity-GTNH-Dark-UI","Modernity-GTNH-2026-08-31.zip"]\r\nlang:en_US\r\n'))
    .toEqual(['UU-Tex-main', 'Modernity-GTNH-Dark-UI', 'Modernity-GTNH-2026-08-31.zip']);
  expect(['lang:en_US', 'resourcePacks:[oops', 'resourcePacks:{}', 'resourcePacks:[]'].map(parseResourcePacks)).toEqual([[], [], [], []]);
  expect(parseResourcePacks('resourcePacks:["a",3,"b"]')).toEqual(['a', 'b']);
});

it('packVersion', () => {
  expect(packVersion('{"pack":{"pack_format":1,"description":"UU-Tex for 2.9.X"},"gtnh_resource_pack_updater":{"pack_version":"2.0"}}')).toBe('2.0');
  expect(packVersion('﻿{"pack":{"pack_format":1,"description":"§bModernity-GTNH-v1.5.6"}}')).toBe('Modernity-GTNH-v1.5.6');
  expect(packVersion('{"pack":{}}')).toBe('');
  expect(['{}', '{"pack":3}', 'nope', ''].map(packVersion)).toEqual([null, null, null, null]);
});

it('gameDirOf', async () => {
  // inst/.minecraft/options.txt exists; other/ has none
  expect(gameDirOf(inst)).toBe(join(inst, '.minecraft'));
  expect(gameDirOf(join(inst, '.minecraft'))).toBe(join(inst, '.minecraft'));
  expect(gameDirOf(other)).toBeNull();
});

it('readPackSet reads the enabled packs read-only and skips the rest', async () => {
  // <game>/options.txt: 'resourcePacks:["Folder Pack","b.zip","gone","../escape","nometa","b.zip"]\r\n'
  // resourcepacks/Folder Pack/pack.mcmeta = '﻿{"pack":{"description":"§aF 1"}}'
  // resourcepacks/b.zip = makeJar({ 'pack.mcmeta': '{"pack":{"description":"B 2"}}' })
  // resourcepacks/nometa/ (folder, no pack.mcmeta); a file escape.zip next to resourcepacks/
  const before = await snapshot(game);
  const { set, skipped } = await readPackSet(game);
  expect(set.enabled).toEqual(['Folder Pack', 'b.zip', 'gone', '../escape', 'nometa', 'b.zip']);
  expect(set.packs).toEqual([
    { name: 'Folder Pack', path: join(game, 'resourcepacks', 'Folder Pack'), format: 'folder', version: 'F 1' },
    { name: 'b.zip', path: join(game, 'resourcepacks', 'b.zip'), format: 'zip', version: 'B 2' },
  ]);
  expect(skipped).toEqual([
    { name: 'gone', reason: 'not in resourcepacks/' },
    { name: '../escape', reason: 'not a pack name' },
    { name: 'nometa', reason: 'no valid pack.mcmeta (the game skips it too)' },
    { name: 'b.zip', reason: 'listed twice' },
  ]);
  expect(await snapshot(game)).toEqual(before);
});

it('packChanges', () => {
  const rec = (name: string, version: string, entries = 10, bytes = 100) => ({ name, format: 'zip' as const, version, entries, bytes, files: 5 });
  const a = { enabled: ['A', 'B'], read: [rec('A', '1'), rec('B', '1')] };
  expect(packChanges(undefined, undefined)).toEqual([]);
  expect(packChanges(a, a)).toEqual([]);
  expect(packChanges(undefined, a)).toEqual(['added A (1)', 'added B (1)']);
  expect(packChanges(a, undefined)).toEqual(['removed A', 'removed B']);
  expect(packChanges(a, { enabled: ['B', 'A', 'C'], read: [rec('B', '2'), rec('A', '1', 11), rec('C', 'x')] }))
    .toEqual(['B: 1 → 2', 'A: same version, different files', 'added C (x)', 'order changed, last wins: C, A, B']);
  expect(packChanges(a, { enabled: ['A'], read: [rec('A', '1')] })).toEqual(['removed B']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/assets/resource-packs.test.ts`
Expected: FAIL, because `resource-packs.ts` does not exist.

- [ ] **Step 3: Implement** `resource-packs.ts` and the two types in `index.ts`, as specified in Interfaces. Give the file
  a header comment like its neighbours: what it reads, that it never writes, and that it follows Minecraft 1.7.10's
  `ResourcePackRepository`.

- [ ] **Step 4: Run to verify they pass, then the type check**

Run: `npx vitest run tests/unit/assets/resource-packs.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/assets/resource-packs.ts src/server/assets/index.ts tests/unit/assets/resource-packs.test.ts
git commit -m "feat(assets): read the client instance's enabled resource packs (read-only)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Layering packs over the jars (pure)

**Files:**
- Create: `src/server/assets/pack-layer.ts`, `tests/unit/assets/pack-layer.test.ts`

**Interfaces:**
- Consumes: nothing (pure; no import from `extract.ts`).
- Produces:
  - `export type LayerFrom = { kind: 'jar'; jar: number } | { kind: 'pack'; pack: number; entry: string /* as the pack spells it */ }`
  - `export interface PackEntries { format: 'folder' | 'zip'; entries: ReadonlySet<string> /* data/assets-relative PNG and .png.mcmeta names, as spelled in the pack */ }`
  - `export interface LayerInput { jarPngs: ReadonlyMap<string, number> /* each PNG path the jars hold → the jar pickWinner chose */; jarHasMcmeta: (jar: number, png: string) => boolean; packs: readonly PackEntries[] /* lowest priority first */ }`
  - `export interface LayerResult { png: Map<string, LayerFrom> /* indexed PNG path → its source */; mcmeta: Map<string, LayerFrom> /* PNG path → source of its .mcmeta, only when it has one */; caseOnly: Array<{ pack: number; entry: string }> /* zip entries left out */ }`
  - `export function layerPacks(input: LayerInput): LayerResult`

The algorithm. The signature does not fix it, so here it is:
1. **Spelling.** Keep `canon: Map<lower-case path, spelling>`. Fill it from the jars' PNG paths first. Then fill it
   from the zip packs' PNG entries, highest pack first. Then from the folder packs' PNG entries, highest first. The
   first spelling set for a lower-case path stays.
2. **PNG.** For each pack, highest first, and each PNG entry `e`: `t = canon.get(lower(e))`. A zip with `t !== e`
   goes to `caseOnly`. Otherwise, if no higher pack already took `t`, then `png[t] = { kind: 'pack', pack, entry: e }`.
   Every jar path no pack took keeps `{ kind: 'jar', jar }`.
3. **`.mcmeta`.** An entry `m` ending in `.png.mcmeta` belongs to `t = canon.get(lower(m without '.mcmeta'))`. Skip it
   when `t` is undefined. A zip entry with `t + '.mcmeta' !== m` goes to `caseOnly`. For each `t`, find the highest
   pack `h` that holds an `.mcmeta`. If the PNG comes from pack `w`, use `h` only when `h >= w`. If the PNG comes from
   jar `j`, use `h` if there is one, else `{ kind: 'jar', jar: j }` when `jarHasMcmeta(j, t)`.

- [ ] **Step 1: Write the failing tests** (`tests/unit/assets/pack-layer.test.ts`)

```ts
const B = 'a/textures/blocks/';
const input: LayerInput = {
  jarPngs: new Map([[B + 'stone.png', 0], [B + 'Fancy.png', 1], [B + 'anim.png', 1], [B + 'still.png', 1], [B + 'jaronly.png', 1], [B + 'jaranim.png', 1]]),
  jarHasMcmeta: (jar, png) => jar === 1 && (png === B + 'anim.png' || png === B + 'jaranim.png'),
  packs: [
    { format: 'folder', entries: new Set([B + 'fancy.png', B + 'still.png', B + 'still.png.mcmeta', B + 'p0only.png', B + 'stone.png.mcmeta', B + 'jaronly.png.mcmeta']) },
    { format: 'zip', entries: new Set([B + 'stone.png', B + 'fancy.png', B + 'still.png', B + 'New.png']) },
    { format: 'folder', entries: new Set([B + 'new.png', B + 'anim.png']) },
  ],
};

it('the last pack wins over every jar, and the jars keep their winner elsewhere', () => {
  const r = layerPacks(input);
  expect(Object.fromEntries(r.png)).toEqual({
    [B + 'stone.png']: { kind: 'pack', pack: 1, entry: B + 'stone.png' },
    [B + 'Fancy.png']: { kind: 'pack', pack: 0, entry: B + 'fancy.png' },   // folder: any case, under the jar's spelling
    [B + 'anim.png']: { kind: 'pack', pack: 2, entry: B + 'anim.png' },
    [B + 'still.png']: { kind: 'pack', pack: 1, entry: B + 'still.png' },
    [B + 'jaronly.png']: { kind: 'jar', jar: 1 },
    [B + 'jaranim.png']: { kind: 'jar', jar: 1 },
    [B + 'p0only.png']: { kind: 'pack', pack: 0, entry: B + 'p0only.png' },
    [B + 'New.png']: { kind: 'pack', pack: 2, entry: B + 'new.png' },      // no jar has it: the zip's spelling
  });
});

it('pairs an .mcmeta as the game does', () => {
  const r = layerPacks(input);
  expect(Object.fromEntries(r.mcmeta)).toEqual({
    [B + 'jaronly.png']: { kind: 'pack', pack: 0, entry: B + 'jaronly.png.mcmeta' },   // a pack's .mcmeta animates a jar PNG
    [B + 'jaranim.png']: { kind: 'jar', jar: 1 },
  });   // stone and still: the .mcmeta sits below the PNG's pack; anim: a pack PNG without one is still
});

it('case', () => {
  const r = layerPacks(input);
  expect(r.caseOnly).toEqual([{ pack: 1, entry: B + 'fancy.png' }]);
  const lower = [...r.png.keys()].map((k) => k.toLowerCase());
  expect(new Set(lower).size).toBe(lower.length);
});

it('no packs: the jars as before', () => {
  const r = layerPacks({ ...input, packs: [] });
  expect([...r.png.values()].every((f) => f.kind === 'jar')).toBe(true);
  expect([...r.mcmeta.keys()].sort()).toEqual([B + 'anim.png', B + 'jaranim.png']);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/assets/pack-layer.test.ts`
Expected: FAIL, because the module does not exist.

- [ ] **Step 3: Implement `layerPacks`** following the three-step algorithm above.

- [ ] **Step 4: Run to verify they pass**

Run: `npx vitest run tests/unit/assets/pack-layer.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/assets/pack-layer.ts tests/unit/assets/pack-layer.test.ts
git commit -m "feat(assets): layer resource packs over the jars as Minecraft 1.7.10 does

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Extraction with pack sources

**Files:**
- Modify: `src/server/assets/extract.ts` (header comment, :16-22 types, :146-206 copy, :276-401 `extractAssets`),
  `src/server/assets/index.ts:11` (doc of `jar`), `:101-114` (`checkFile` validates `packs`),
  `src/server/assets/png.ts:19-21`
- Test: `tests/unit/assets/extract.test.ts`, `tests/unit/assets/index.test.ts`, `tests/unit/assets/png.test.ts`

**Interfaces:**
- Consumes: `PackSet`, `PackSource` (Task 1); `layerPacks`, `LayerFrom` (Task 2); `AssetPacks`, `PackRecord`
  (Task 1, `index.ts`).
- Produces (all in `extract.ts`):
  - `ExtractOptions.packs?: PackSet`. When absent, the run, the index and every existing test are exactly today's.
  - `export function folderEntry(name: string): string | null`: for a folder pack's file named relative to the pack
    folder (`/`-separated). It is `textureEntry` matched without regard to case. Acceptance is decided on the
    lower-cased name. The result keeps the file's own spelling, except that the domain, the
    `textures/<blocks|items>/` part and the `.png` / `.png.mcmeta` ending are lower case, and a chest sheet is lower
    case as a whole.
  - `export interface FolderEntry { crc: number; size: number; file: string }`
  - `export async function scanFolderPack(dir: string): Promise<{ entries: Map<string, FolderEntry>; ignored: number }>`:
    walks `<dir>/assets/` (`readdir` with `recursive` and `withFileTypes`). Only regular files count, so symbolic
    links are skipped. Each file is keyed by `folderEntry` and read once for its CRC-32. The `nei` domain is left out,
    as for jars. A folder without `assets/` gives an empty map.
  - `export interface CopyResult { sizes: Map<string, PngSize> /* target PNG → size */; mcmetas: Map<string, Buffer> /* target PNG → .mcmeta bytes */; bytes: number; notPng: string[] /* target paths */ }`.
    The copy functions no longer write `.mcmeta` files or count frames. `extractAssets` writes each `.mcmeta` whose
    PNG was copied, from any source, and sets `frames` from it.
  - `export async function copyFromFolder(entries: ReadonlyMap<string, FolderEntry>, wanted: ReadonlyMap<string /* entry */, string /* target */>, root: string, madeDirs: Set<string>): Promise<CopyResult>`:
    reads each file and throws `Error('<file> changed during the extraction')` when its CRC-32 or size differs from
    the scan.
  - `ExtractSummary` gains `packFiles: number` (indexed PNGs taken from packs), `packReplaced: number` (those a jar
    also had), `caseOnly: number`, `notPngInPacks: Array<{ pack: string; path: string }>` and
    `packs: AssetPacks | null`.

How `extractAssets` changes:
- **Scan.** Jars are scanned and decided as today: `pickWinner`, `conflicts`, `identicalDuplicates` and the "no mod
  jar" check, which never counts a pack. Then each `opts.packs.packs` entry is scanned in order: a zip with `scanJar`,
  a folder with `scanFolderPack`. A pack that cannot be scanned, or whose name equals a jar's file name, goes to
  `skippedJars` (`{ jar: <pack name>, error }`).
- **Layer.** `layerPacks` gets `jarPngs` (each PNG path → the jar that won it) and
  `jarHasMcmeta = (j, p) => scanned[j].entries.has(p + '.mcmeta')`.
- **Copy.** Each source gets its copy list. Each list maps entry → target for the PNGs it won and the `.mcmeta`
  files chosen from it. Jars and zip packs go through the existing zip copy, extended with the entry → target map.
  Folder packs go through `copyFromFolder`. At most one zip is open at a time.
- **Not a PNG.** A pack PNG that is not a PNG goes to `notPngInPacks`, and its path is not indexed: there is no
  fallback to a jar. A jar's still counts in `ignoredEntries`, as today.
- **Index.** `files[p].jar` is the source's name (a jar's file name or a pack's name). `sources` lists the jars only,
  with `files` = the PNGs each still supplied. `packs` is written only when `opts.packs` was given:
  `{ enabled, read: [{ name, format, version, entries: entries.size, bytes: sum of sizes, files }] }`.
- **Swap.** `swapIn` is unchanged.

- [ ] **Step 1: Write the failing tests**

`png.test.ts`, in "counts animation frames":
```ts
expect(animationFrames('﻿{"animation":{}}', { width: 16, height: 32 })).toBe(2);
```

`index.test.ts`:
```ts
it('accepts a packs record and refuses a malformed one', async () => {
  const packs = { enabled: ['P'], read: [{ name: 'P', format: 'zip', version: '1', entries: 2, bytes: 9, files: 1 }] };
  expect((await loadAssetIndex(await writeIndex({ ...FILE, packs }))).file!.packs).toEqual(packs);
  for (const bad of [{ enabled: 'P', read: [] }, { enabled: [], read: [{ name: 'P' }] }, { enabled: [], read: [{ ...packs.read[0], format: 'tar' }] }])
    await expect(loadAssetIndex(await writeIndex({ ...FILE, packs: bad }))).rejects.toThrow(/bad "packs"/);
});
```
(`writeIndex(file)` is a local helper that writes `index.json` into a fresh temp folder and returns that folder; cast
the malformed values with `as unknown as AssetIndexFile`.)

`extract.test.ts`, a new `describe('extractAssets with resource packs')`. The fixture `withPacks()` builds:
- `pack()`'s jars;
- a folder pack `P1` with `pack.mcmeta`, holding:
  - `assets/minecraft/textures/blocks/STONE.png` (green, 16×16; the client jar's `stone.png` in another case),
  - `assets/gregtech/textures/blocks/fluids/fluid.water.png.mcmeta` (`{"animation":{}}`),
  - `assets/p/textures/items/only.png` (green),
  - `assets/nei/textures/items/n.png`,
  - a symbolic link `assets/p/textures/blocks/link.png` to a PNG outside the pack;
- a zip pack `P2.zip` (`makeJar`) holding:
  - `assets/gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png` (16×32, purple) and its `.mcmeta`
    `{"animation":{}}`,
  - `assets/minecraft/textures/blocks/Sponge.png` (only the case differs from the jars'),
  - `assets/gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png` with JPEG bytes (`'\xff\xd8\xff\xe0 not a png'`);
- `packs: { enabled: ['P1', 'gone', 'P2.zip'], packs: [<P1 folder, version 'v1'>, <P2.zip zip, version 'v2'>] }`;
- `assets/nei/index.json` written before the run.

```ts
it('packs win over every jar, the last listed first', async () => {
  const { dir, jars, packs, folder } = await withPacks();
  const before = await snapshot(folder);
  const s = await extractAssets({ jars, packs, dataDir: dir });
  const ix = JSON.parse(await readFile(P(dir, 'index.json'), 'utf8'));
  expect(ix.files['gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png']).toEqual({ w: 16, h: 32, frames: 2, jar: 'P2.zip' });
  expect(ix.files['minecraft/textures/blocks/stone.png']).toEqual({ w: 16, h: 16, jar: 'P1' });
  expect(ix.files['p/textures/items/only.png'].jar).toBe('P1');
  expect(ix.files['gregtech/textures/blocks/fluids/fluid.water.png']).toEqual({ w: 16, h: 64, frames: 4, jar: 'gregtech-5.09.54.183.jar' });
  expect(await readFile(P(dir, 'gregtech/textures/blocks/fluids/fluid.water.png.mcmeta'), 'utf8')).toBe('{"animation":{}}');   // P1's, over the jar's
  expect(ix.conflicts).toEqual(/* exactly today's two jar conflicts */);
  expect(ix.packs).toEqual({ enabled: ['P1', 'gone', 'P2.zip'], read: [
    { name: 'P1', format: 'folder', version: 'v1', entries: 3, bytes: expect.any(Number), files: 2 },
    { name: 'P2.zip', format: 'zip', version: 'v2', entries: 4, bytes: expect.any(Number), files: 1 } ] });
  expect(ix.sources.map((x: { jar: string }) => x.jar)).not.toContain('P1');
  expect(s).toMatchObject({ packFiles: 3, packReplaced: 2, caseOnly: 1 });
  expect(await snapshot(folder)).toEqual(before);
});

it('writes one file per path', async () => {   // Review Focus 1
  const { dir, jars, packs } = await withPacks();
  await extractAssets({ jars, packs, dataDir: dir });
  expect((await readdir(P(dir, 'minecraft/textures/blocks'))).sort()).toEqual(['sponge.png', 'stone.png']);
  expect(await readFile(P(dir, 'minecraft/textures/blocks/sponge.png'))).toEqual(BLUE);   // VillageNames' as before: the zip's Sponge.png is left out
});

it('not a PNG', async () => {   // Review Focus 3
  const { dir, jars, packs } = await withPacks();
  const s = await extractAssets({ jars, packs, dataDir: dir });
  expect(s.notPngInPacks).toEqual([{ pack: 'P2.zip', path: 'gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png' }]);
  expect(JSON.parse(await readFile(P(dir, 'index.json'), 'utf8')).files['gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png']).toBeUndefined();
});

it('keeps the NEI import and never extracts a pack into nei/ or through a link', async () => {   // Global Constraints: NEI
  const { dir, jars, packs } = await withPacks();
  await extractAssets({ jars, packs, dataDir: dir });
  expect(await readFile(P(dir, 'nei/index.json'), 'utf8')).toBe('{}');
  expect(existsSync(P(dir, 'nei/textures'))).toBe(false);
  expect(existsSync(P(dir, 'p/textures/blocks/link.png'))).toBe(false);
});

it('copyFromFolder refuses a file that changed', async () => {   // Review Focus 4
  const { folder } = await withPacks();
  const { entries } = await scanFolderPack(folder);
  const rel = 'p/textures/items/only.png';
  await writeFile(entries.get(rel)!.file, RED);
  await expect(copyFromFolder(entries, new Map([[rel, rel]]), await mkdtemp(join(tmpdir(), 'gp-cp-')), new Set()))
    .rejects.toThrow(/changed during the extraction/);
});

it('folderEntry', () => {
  expect(folderEntry('assets/GregTech/Textures/Blocks/iconsets/MACHINE_LV_SIDE.PNG')).toBe('gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png');
  expect(folderEntry('assets/gregtech/textures/blocks/a.png.MCMETA')).toBe('gregtech/textures/blocks/a.png.mcmeta');
  expect(folderEntry('assets/minecraft/textures/entity/chest/Normal.png')).toBe('minecraft/textures/entity/chest/normal.png');
  for (const bad of ['assets/x/textures/gui/a.png', 'assets/x/textures/blocks/../../a.png', 'pack.mcmeta', 'assets/x/mcpatcher/ctm/glass/0.png'])
    expect(folderEntry(bad)).toBeNull();
});
```
Fill in the `conflicts` expectation with the two entries of the existing test at `extract.test.ts:80-83`.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/assets/extract.test.ts tests/unit/assets/index.test.ts tests/unit/assets/png.test.ts`
Expected: FAIL: `folderEntry`, `scanFolderPack` and `copyFromFolder` are not exported, `packs` is ignored, and the
BOM gives 1 frame.

- [ ] **Step 3: Implement** as described in Interfaces and the list above. `checkFile` refuses a `packs` that is not
  `{ enabled: string[]; read: PackRecord[] }` (`format` is `folder` or `zip`, counts are integers ≥ 0) with
  `AssetIndexError('<file>: bad "packs". Run \`npm run extract-assets\` again.')`. `animationFrames` drops a leading
  U+FEFF before `JSON.parse`. Update `extract.ts`'s header comment and `index.ts:11`'s doc of `jar`.

- [ ] **Step 4: Run the asset tests and the suite**

Run: `npx vitest run tests/unit/assets && npm test`
Expected: PASS. Every existing extract test passes unchanged.

- [ ] **Step 5: Commit**

```bash
git add src/server/assets/extract.ts src/server/assets/index.ts src/server/assets/png.ts tests/unit/assets/extract.test.ts tests/unit/assets/index.test.ts tests/unit/assets/png.test.ts
git commit -m "feat(assets): extract folder and zip resource packs above every jar; index records each pack

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: The CLI and the config key

**Files:**
- Modify: `src/server/config.ts:7-19` (`clientInstance?: string | null`, not in `DEFAULT_CONFIG`, so no saved config
  changes), `:58-65` (`checkFields`: when present, a string or null), `src/server/cli/extract-assets.ts`
- Test: `tests/unit/cli/extract-assets.test.ts`, `tests/unit/server/config.test.ts`

**Interfaces:**
- Consumes: `gameDirOf`, `readPackSet`, `packChanges` (Task 1); `ExtractOptions.packs` and the new `ExtractSummary`
  fields (Task 3); `loadAssetIndex` (`index.ts:117`).
- Produces: `npm run extract-assets -- [--server <folder>] [--client-jar <path> | --no-client] [--instance <folder> | --no-packs]`
  (the new `USAGE`).

The behaviour, in order:
1. `--instance` with `--no-packs` → exit 2:
   `--instance and --no-packs cannot be used together` plus `USAGE`. An empty `--instance` value → exit 2 with
   `--instance needs a value`, as for `--server`.
2. With `--no-packs` there are no packs. Otherwise the instance is `--instance ?? config.clientInstance`. With neither,
   there are no packs.
3. An instance whose `gameDirOf(resolve(instance))` is null → exit 2 with
   `No options.txt in <folder> or its .minecraft folder`.
4. `readPackSet(gameDir)` runs before the extraction. The previous index's `packs` comes from
   `loadAssetIndex(<dataDir>/assets)` (any error → none). Remember its `createdAt` too.
5. After a successful extraction, the existing summary lines and skipped-jar warnings come first, unchanged. Their first line gains
   ` and 1 resource pack` / ` and <n> resource packs` before ` into` only when packs were read. Then these lines, each only when it applies:
   - `<packFiles> of them from resource packs (<packReplaced> replace a jar's texture)`
   - `<caseOnly> files of zip packs left out: their names differ from the game's only in case`
   - `Resource packs, last wins: <name> (<version>), …` (highest first), or `Resource packs: none enabled in options.txt`
   - `Resource packs: off (--no-packs)`
   - `No client instance set: textures from the jars only (set "clientInstance" in data/config.json or pass --instance <folder>)`
   - `Resource packs changed since the last extraction (<previous createdAt>):`, followed by each `packChanges` line
     indented two spaces. This needs a previous index; nothing is printed when no line results.
   - On `err`: `warning: resource pack <name> skipped: <reason>` for each skipped pack, and
     `warning: <pack>: <path> is not a PNG; left out (the game cannot draw it either)`.
6. The exit codes are unchanged. An extraction failure still prints only the failure line.

- [ ] **Step 1: Write the failing tests**

`config.test.ts`:
```ts
it('checks clientInstance when present', () => {
  const f = file();
  saveConfig({ ...DEFAULT_CONFIG }, f);
  writeFileSync(f, JSON.stringify({ dataDir: 'd', clientInstance: 5 }));
  expect(() => loadConfig(f)).toThrow(/clientInstance must be a string or null/);
  writeFileSync(f, JSON.stringify({ dataDir: 'd', clientInstance: '/x/inst' }));
  expect(loadConfig(f).clientInstance).toBe('/x/inst');
});
```

`extract-assets.test.ts`. The helper `instance(dir)` makes `<dir>/inst/.minecraft/options.txt` with
`resourcePacks:["P.zip"]` and `resourcepacks/P.zip` (`makeJar`) holding `pack.mcmeta`
`{"pack":{"description":"P 1"}}` and `assets/extra/textures/items/thing.png` (another colour):
```ts
it('extracts the enabled packs from --instance or the config, read-only', async () => {
  const { dir, config, deps, lines } = await setup();
  const inst = await instance(dir);
  const before = await snapshot(inst);
  expect(await main(['--no-client', '--instance', inst], deps)).toBe(0);
  expect(lines).toContain('Resource packs, last wins: P.zip (P 1)');
  expect(lines.find((l) => l.startsWith('Extracted '))).toMatch(/ from 2 jars and 1 resource pack into /);
  const ix = JSON.parse(await readFile(join(config.dataDir, 'assets', 'index.json'), 'utf8'));
  expect(ix.files['extra/textures/items/thing.png'].jar).toBe('P.zip');
  expect(await snapshot(inst)).toEqual(before);
  lines.length = 0;
  expect(await main(['--no-client'], { ...deps, config: { ...config, clientInstance: inst } })).toBe(0);
  expect(lines).toContain('Resource packs, last wins: P.zip (P 1)');
});

it('reports pack changes', async () => {   // Review Focus 5
  const { dir, deps, lines } = await setup();
  const inst = await instance(dir);
  await main(['--no-client', '--instance', inst], deps);
  expect(lines.some((l) => l.startsWith('Resource packs changed'))).toBe(false);   // nothing before it
  lines.length = 0;
  await main(['--no-client', '--instance', inst], deps);
  expect(lines.some((l) => l.startsWith('Resource packs changed'))).toBe(false);   // unchanged
  lines.length = 0;
  expect(await main(['--no-client', '--no-packs'], deps)).toBe(0);
  expect(lines).toContain('Resource packs: off (--no-packs)');
  expect(lines.find((l) => l.startsWith('Resource packs changed since the last extraction ('))).toBeDefined();
  expect(lines).toContain('  removed P.zip');
});

it('explains a bad instance', async () => {
  const { dir, deps, lines } = await setup();
  expect(await main(['--no-client', '--instance', join(dir, 'nowhere')], deps)).toBe(2);
  expect(lines.at(-1)).toMatch(/^No options\.txt in .*nowhere or its \.minecraft folder$/);
  expect(await main(['--instance', 'x', '--no-packs'], deps)).toBe(2);
  expect(lines.join('\n')).toContain('--instance and --no-packs cannot be used together');
  expect(await main(['--no-client'], deps)).toBe(0);
  expect(lines.at(-1)).toBe('No client instance set: textures from the jars only (set "clientInstance" in data/config.json or pass --instance <folder>)');
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run tests/unit/cli/extract-assets.test.ts tests/unit/server/config.test.ts`
Expected: FAIL: the flags are unknown, and `clientInstance` is not checked.

- [ ] **Step 3: Implement** the config key and the CLI as above. Update the CLI's header comment (flags, the read-only
  instance) and `USAGE`.

- [ ] **Step 4: Run the suite**

Run: `npm test`
Expected: PASS. The existing CLI tests pass unchanged: `lines[0]` is still the `Extracted …` line, and
`lines.at(-1)` on failure is still the failure.

- [ ] **Step 5: Commit**

```bash
git add src/server/config.ts src/server/cli/extract-assets.ts tests/unit/cli/extract-assets.test.ts tests/unit/server/config.test.ts
git commit -m "feat(assets): extract-assets reads the client instance (clientInstance, --instance, --no-packs) and reports pack changes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Real extraction in the worktree and the real-data re-baseline

**Files:**
- Modify: `tests/unit/assets/real-assets.test.ts` (and `tests/unit/assets/real-coverage.test.ts:278-279, 306-307` only
  if a bound moves)
- Local only, never committed: `data/real-config.json`, `.local/pack-runs.md`

**Interfaces:**
- Consumes: everything above; Task 0's baseline in `.local/pack-runs.md`.
- Produces: green real-data asset tests on a pack extraction; the figures the controller needs.

- [ ] **Step 1: Point the worktree config at the client instance (local only)**

Find the GTNH 2.9.0-RC-1 instance read-only under Prism Launcher's `instances/` folder: the one whose name holds
`2.9.0-RC-1`, with its `.minecraft`. Add only that key to `data/real-config.json`:
```bash
python3 -I -c "import json,sys; p='data/real-config.json'; c=json.load(open(p)); c['clientInstance']=sys.argv[1]; json.dump(c, open(p,'w'), indent=2)" "<the instance's .minecraft folder>"
```

- [ ] **Step 2: Extract with packs**

```bash
time GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npm run extract-assets
```
Expected: exit 0. Among the lines:
- `… from 21… jars and 3 resource packs into …`
- `Resource packs, last wins: Modernity-GTNH-2026-08-31.zip (Modernity-GTNH-v1.5.6), Modernity-GTNH-Dark-UI (Modrenity-GTNH-DARK-UI-v1.2.1), UU-Tex-main (2.0)`
- `Resource packs changed since the last extraction (<Task 0's createdAt>):`, then
  `  added UU-Tex-main (2.0)`, `  added Modernity-GTNH-Dark-UI (Modrenity-GTNH-DARK-UI-v1.2.1)` and
  `  added Modernity-GTNH-2026-08-31.zip (Modernity-GTNH-v1.5.6)`
- a `… files of zip packs left out …` line (7 PNGs were counted on 2026-10-23)
- `warning: Modernity-GTNH-2026-08-31.zip: dreamcraft/textures/blocks/blockPixieDust.png is not a PNG; left out (the game cannot draw it either)`

`data/assets/nei/index.json` still exists. `test -L data/assets` prints nothing. Run it a second time: no
`Resource packs changed` line. Record both wall times.

- [ ] **Step 3: Re-baseline `real-assets.test.ts`**

- `:58-61` (Iron Ore). Keep the GT drawing check on a source without NEI: `resolveIcons({ ...src, nei: null }, …)`.
  Add `expect(resolveIcons(src, ['gregtech:gt.blockores2@32'])[0]!.source).toBe('nei')` with the comment
  `// item icons with an NEI dump icon keep it (spec, 2026-10-23)`.
- `:45-46` (the LV Macerator). The north and up faces gain the pack-provided glow overlay:
  `[…, GT + 'basicmachines/macerator/OVERLAY_FRONT_GLOW.png']` and `[…, GT + 'basicmachines/macerator/OVERLAY_TOP_GLOW.png']`.
  Assert that the last layer has `glow: true`. If the run shows anything else, stop and report it; do not guess.
- `:94`. Set the icon bound to the share this run prints, rounded down to the whole percent and minus one point
  (e.g. 42.3 % → `0.41`), with the comment `// measured 2026-10-2x with NEI and the user's packs; the old 0.9 predates the NEI import`.
- Add a log of `src.dump!.stats.droppedLayers` to the `reports coverage` line.
- Add the block below at the end of the file. Its facts were read from the user's instance on 2026-10-23.

```ts
const PACKS = { uu: 'UU-Tex-main', mod: 'Modernity-GTNH-2026-08-31.zip' };
describe.skipIf(process.env.GTNH_LOCAL !== '1' || !loadConfig().clientInstance)('real resource packs', () => {
  let index: AssetIndex;
  beforeAll(async () => { index = await loadAssetIndex(join(loadConfig().dataDir, 'assets')); });

  it('recorded the enabled packs and what each supplied', () => {
    const packs = index.file!.packs!;
    expect(packs.read.map((p) => p.name)).toEqual(packs.enabled.filter((n) => packs.read.some((p) => p.name === n)));
    const supplied = new Map<string, number>();
    for (const info of Object.values(index.file!.files)) supplied.set(info.jar, (supplied.get(info.jar) ?? 0) + 1);
    for (const p of packs.read) expect(supplied.get(p.name) ?? 0, p.name).toBe(p.files);
  });

  it('layers the packs as the game does', () => {
    const read = new Set(index.file!.packs!.read.map((p) => p.name));
    if (read.has(PACKS.mod)) {
      expect(index.info('minecraft/textures/blocks/stone.png')!.jar).toBe(PACKS.mod);
      expect(index.info('ae2fc/textures/blocks/fluid_packet_decoder.png')).toMatchObject({ jar: PACKS.mod, frames: 22 });   // still in the jar
      expect(index.has('dreamcraft/textures/blocks/blockPixieDust.png')).toBe(false);   // a JPEG named .png
      expect(index.has('goodgenerator/textures/items/plasticcase.png')).toBe(false);   // the zip's spelling differs only in case
    }
    if (read.has(PACKS.uu)) {
      expect(index.info('gregtech/textures/blocks/iconsets/MACHINE_CASING_FIREBOX_BRONZE_TOP.png')!.jar).toBe(PACKS.uu);
      expect(index.info('littletiles/textures/items/LTRecipe.png')!.jar).toBe(PACKS.uu);   // the folder spells it ltrecipe.png
      expect(index.info('goodgenerator/textures/items/plasticCase.png')!.jar).toBe(PACKS.uu);
    }
  });
});
```

- [ ] **Step 4: Run the real-data asset tests**

```bash
GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npx vitest run tests/unit/assets/real-assets.test.ts tests/unit/assets/real-coverage.test.ts
```
Expected: `real-assets` passes, including the existing `:29-35` (the client sha1, `fluid.autogenerated` 16×512 with 32
frames from Modernity's file, the jar conflict for `gt.metaitem.01/606.png`), the curated check and the case check.
`real-coverage` passes as at Task 0. If one of its asset bounds (`:278-279` plain icons, `:306-307` faces) moved
because of the packs, set it to the measured value plus 2 % head-room with a dated comment. Write down why it moved
in `.local/pack-runs.md`. Do not touch any other bound.

- [ ] **Step 5: Measure load time and size**

Run Task 0 Step 5's `node` one-liner and `du -sh data/assets` again. Record both next to the baseline. A
`droppedLayers` drop is expected: the packs' `_GLOW` and overlay files now resolve. The check: `indexMs + dumpMs`
is within 1.5× of the stock figure. If it is not, report to the controller before the commit.

- [ ] **Step 6: Run the suite and commit**

```bash
npm test
git add tests/unit/assets/real-assets.test.ts tests/unit/assets/real-coverage.test.ts
git commit -m "test(assets): re-baseline the real-data asset checks on the user's resource packs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
(Add `real-coverage.test.ts` only if it changed.) Report to the controller from `.local/pack-runs.md`: file counts,
`packFiles` / `packReplaced` / `caseOnly`, the warnings, the wall times, load times, `droppedLayers` and `du`, before
and after.

---

### Task 6: README, architecture entry 54, and the controller's live-extraction steps

**Files:**
- Modify: `README.md` (a bullet after line 28), `docs/superpowers/plans/2026-10-17-00-architecture.md` (entry 54
  after entry 52, the last line of §11)

**Interfaces:**
- Consumes: the behaviour of Tasks 1–5.
- Produces: user docs and the contract record.

- [ ] **Step 1: README.** After the `npm run extract-assets` bullet (line 28), add:

  `- To draw textures as your game does, set "clientInstance" in data/config.json to your GTNH client instance's folder (in Prism Launcher, the instance folder under instances/, or its .minecraft), or pass --instance <folder>. The resource packs enabled in the game then win over the jars, the one at the top of the game's list first; files a pack lacks come from the jars. The instance is only read. --no-packs leaves the packs out for one run. Each run lists the packs it used and says what changed since the last run, so run it again after you change packs in the game. Connected textures are not drawn (a wall of casings looks tiled, not seamless), and animated textures show their first frame. The Map's colours follow the new textures. Reload the page once with Cmd+Shift+R afterwards: the browser keeps texture files for up to an hour. Resource packs have their own licences: like every texture, they stay in data/assets/ on your machine and are never committed.`

- [ ] **Step 2: Architecture entry 54.** Append after entry 52:

  `54. **Textures from the user's resource packs** (spec 2026-10-23-base-around-the-line-design.md, "Textures from the user's resource packs"; plan 2026-10-23-23-pack-textures.md, add-on 23; amends 17 and 43 (i)): (1) AppConfig.clientInstance?: string | null, not in DEFAULT_CONFIG; it is the game folder holding options.txt and resourcepacks/, or an instance folder holding it as .minecraft or minecraft. It replaces 43 (i)'s pair: useResourcePacks is not built, and a set clientInstance turns packs on. extract-assets --instance <folder> sets it for one run, --no-packs turns packs off for one run. (2) src/server/assets/resource-packs.ts reads options.txt's resourcePacks once per run, lowest priority first as 1.7.10 saves it, and each enabled pack's pack.mcmeta. A BOM is tolerated. version = gtnh_resource_pack_updater.pack_version, else the description without § codes. A pack that is missing, listed twice, badly named or without a valid pack.mcmeta is skipped with a warning, as the game skips it. Nothing under the instance is written. (3) src/server/assets/pack-layer.ts layerPacks: the jars keep pickWinner and conflicts (jar-against-jar only); then the last enabled pack holding a path wins over every jar. Spelling is the jars', else the highest zip pack's, else the highest folder pack's. Folder packs match without regard to case, zip packs exactly; a zip entry differing only in case is left out and counted. An .mcmeta comes from the highest pack at or above the PNG's pack, and for a jar PNG with none, from its winning jar. A pack file that is not a PNG is left out with a warning, with no fallback to a jar. Chest model sheets are layered too; nei/ never. (4) index.json keeps format gtnh-planner-assets/1. files[p].jar is the winning source's name, a jar's file name or a pack's name. sources lists jars only. The optional packs: { enabled: string[]; read: Array<{ name, format: 'folder' | 'zip', version, entries, bytes, files }> } is present when the run read an instance; the base view (project 2) may name the packs from it. packChanges(prev, next) lines are printed by the CLI when the packs differ from the previous index's. (5) No CTM, frame 0 as before. Resolvers, routes and client are unchanged. The Map's colours follow at the next page load: scan tiles hold palette indices, not colours. (6) Serving pack textures to anyone but the owner is decided by the user-accounts project, before the site leaves this Mac.`

- [ ] **Step 3: Check that nothing private or absolute was written**

```bash
git diff main --stat && git diff main -- . ':(exclude)docs/superpowers/plans/2026-10-23-23-pack-textures.md' | grep -nE '/Users/|/private/tmp|PrismLauncher/instances/GT_' || echo clean
```
Expected: `clean` (this plan is excluded because it names the patterns). Only source, tests, README and the two docs changed. No PNG, no `data/`.

- [ ] **Step 4: Commit**

```bash
git add README.md docs/superpowers/plans/2026-10-17-00-architecture.md
git commit -m "docs: resource-pack textures (README, architecture §11 entry 54)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Controller: the live extraction after the merge (not an agent task)

Do this in the main checkout after `plan/23-pack-textures` is merged, with no other lane extracting. Plan 22's
worktree symlinks its `data/assets` to the live one, so do it between plan 22's real-data runs. Tell that lane its
asset coverage figures may move.

1. **Backup** (an APFS clone, instant; keep it until the user has looked):
   ```bash
   cd "$REPO" && cp -Rc data/assets "data/assets.pre-packs-$(date +%Y%m%d-%H%M%S)"
   ```
2. **Set the instance** (adds one key and never prints the file, which holds secrets):
   ```bash
   python3 -I -c "import json,os,sys; p='data/config.json'; c=json.load(open(p)); c['clientInstance']=sys.argv[1]; t=p+'.tmp'; fd=os.open(t, os.O_WRONLY|os.O_CREAT|os.O_EXCL, 0o600); os.write(fd, (json.dumps(c, indent=2)+'\n').encode()); os.close(fd); os.replace(t, p)" "<the GTNH 2.9.0-RC-1 instance's .minecraft folder>"
   ```
3. **Extract**: `npm run extract-assets`. The lines should match Task 5 Step 2's: 3 resource packs, the `added …`
   lines, the `blockPixieDust` warning. Then `test -f data/assets/nei/index.json && echo nei-kept`.
4. **Check**: `GTNH_LOCAL=1 npx vitest run tests/unit/assets/real-assets.test.ts` with the main checkout's own
   config. It reads only.
5. **Restart the site** on port 8765 the way it runs now, only if the user has it up. The asset service would pick up
   the new index within a second anyway; the restart also clears server-side caches. Tell the user: reload once with
   Cmd+Shift+R (the browser keeps texture files for up to an hour). Open a project's 3D tab and the Map: the blocks
   and colours are the packs'. The Map needs no rescan.
6. **Rollback**, if the user prefers stock: stop the site, then run
   `rm -rf data/assets && mv data/assets.pre-packs-<stamp> data/assets`. Remove `clientInstance` the same way as
   step 2, or extract with `--no-packs`. Then restart the site. Delete the backup only after the user says the new
   look is fine.
