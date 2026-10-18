# Textures & Icons Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Show the pack's real textures and item/fluid icons: extract jar textures locally, dump GregTech's own texture data from the exporter mod, resolve blocks and items to layered texture descriptors on the server, and draw real icons wherever the UI shows an item or fluid.

**Architecture:** `npm run extract-assets` copies every `assets/*/textures/{blocks,items}/**` PNG (+ `.mcmeta`) from the server pack's mod jars and the vanilla 1.7.10 client jar into gitignored `data/assets/` and writes `data/assets/index.json`. The exporter mod (Plan 1) gains a `TextureExporter` that writes `textures.json.gz` (GT materials, meta-item tables, per-MTE face layers, casings, covers, fluids, texture names) into every export. A server resolver joins both, plus curated tables for non-GT blocks and an optional NEI icon dump, into `BlockFaces` / `IconDescriptor` (architecture §6.5), served by the `/api/assets/*` routes; the client's `ItemIcon` composites the layers on a canvas.

**Tech Stack:** TypeScript 6.0.3 on Node 24 (type stripping), yauzl 3.4.0 (jar reading, read-only), `node:zlib`, React 19 + `OffscreenCanvas`, vitest 5, Playwright 1.63; Java 8 bytecode (Jabel) in `exporter-mod/` with Gson (ships with Minecraft), ASM tree 9.4 and JUnit 5.

**Spec:** `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` (§3.8, §3.12). Contracts: `docs/superpowers/plans/2026-10-17-00-architecture.md` (§6.5, §7, §9, §10). Facts: `docs/research/textures-icons.md` (primary), `docs/research/export-mod.md`, `docs/research/web-stack.md` §8–§9.

## Global Constraints

- Node `>=24.10.0 <25`; TypeScript erasable syntax only (no `enum`, `namespace`, parameter properties, decorators, `<T>x`); relative imports name the real `.ts`/`.tsx` file; type-only imports use `import type`.
- npm dependencies: only architecture §4 pins. This plan uses `yauzl@3.4.0` and `@types/yauzl@3.4.0` (Task 2 installs them if missing) with `npm install --save-exact --before="$(date -v-14d +%F)" <pkg>@<ver>`, and commits `package-lock.json`. Test jars are written with `node:zlib` (`deflateRawSync`, `crc32`), not a new library.
- Java dependencies added to `exporter-mod/`: `org.ow2.asm:asm-tree:9.4` (compileOnly + test; the server pack ships it at run time under `libraries/org/ow2/asm/asm-tree/9.4/`, checked read-only while writing this plan, and FML itself depends on the ASM tree API), `org.junit.jupiter:junit-jupiter:5.11.4`, `org.junit.platform:junit-platform-launcher:1.11.4` and `com.google.code.gson:gson:2.2.4` (Minecraft's own Gson; test only). Java code uses Java 8 APIs only (`--release 8`) and only ASM tree classes that exist since ASM 5. Plan 1's rule "Java tasks have no unit tests" still holds for code that touches GregTech or Minecraft; this plan unit-tests only the pure-Java helpers (Tasks 4–5), and proves the rest with `javap` checks, the build, `check-reobf.sh` and the real run (Task 15).
- Spec §3.12: nothing game-derived is committed. Textures, icons, `textures.json.gz` and NEI dumps live only under gitignored `data/`; tests build synthetic PNGs, jars and dumps with `tests/helpers/`; checks against real data run only with `GTNH_LOCAL=1`.
- Never start, stop or write to the live server or its folder. Jars are opened read-only (yauzl opens with flag `'r'`); the exporter only ever runs inside Plan 1's export clone (`npm run export`).
- Official 1.7.10 client jar sha1: `e80d9b3bf5085002218d4be59e668bac718abbc6`.
- Icon name → file: `domain:name` → `<lower-case domain>/textures/<blocks|items>/<name>.png` (no domain → `minecraft`); paths inside jars are case-sensitive; `TextureLayer.path` is relative to `data/assets/`.
- Drawing rules (research §2.4, §2.5, §6.1): tint = multiply RGB, alpha untouched; overlays untinted; glow layers are full-bright (unlit in 3D, drawn normally in a flat icon); animated textures show frame 0, the top `h / frames` rows.
- Faces use ForgeDirection order down 0, up 1, north 2, south 3, west 4, east 5. Canonical orientation has the front on north; `facing` is the ForgeDirection index the front is turned to (default 2).
- Fallback (spec §3.8): a face or icon that cannot be resolved gets a plain colour — by machine kind for blocks (`KIND_COLORS`), material or fluid colour where known, else a stable hash colour per item.
- Asset routes are never `public`: textures are served only to logged-in group members.
- Commits use a conventional prefix and the message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Re-running `npm run extract-assets` while the app is running, or an extraction that dies halfway** (unreadable jar, full disk): the previous textures keep being served and the server switches to the new index on its next request, without a restart. Tests: Task 2 "leaves the previous assets in place…", Task 12 "reloads when index, dump or NEI index change".
2. **Jars updated (pack upgrade) but the export not re-run**, so `textures.json.gz` names files that no longer exist: those layers are dropped and the face shows its fallback colour; the browser never asks for a missing file. Tests: Task 7 "drops dump layers whose file was not extracted", Task 10 "reports partially resolved blocks".
3. **File URLs crafted to leave `data/assets`** (`%2e%2e`, encoded `/` or `\`, NUL, symlinks) or asking for non-PNG files: 400 or 404, never another file. Tests: Task 12 "refuses %s with 400 or 404" table and "answers 400 for traversal and 404 for files it does not serve".
4. **An NEI dump taken with a search filter or collapsed groups, or on the Mac's case-insensitive disk**: the import refuses on a row-order mismatch instead of mislabelling icons, and replays case-insensitive name collisions. Tests: Task 11.
5. **Long lists** (a 500-row materials list, fast typing in search): icon lookups are batched per tick, de-duplicated and split at the server cap; a 501-key request is refused rather than processed. Tests: Task 13 batcher tests, Task 12 cap test.

## Task outline

1. Shared asset types, PNG size and `.mcmeta` frames, synthetic PNG builder — `src/shared/types/assets.ts`, `src/server/assets/png.ts`, `tests/helpers/png.ts`.
2. Jar texture extraction: scan, duplicate winner rule, `index.json`, staged swap — `src/server/assets/extract.ts`, `src/server/assets/index.ts`, `tests/helpers/jar.ts`.
3. `npm run extract-assets` CLI: pack jars + sha1-verified client jar (config or flag), summary and conflict log — `src/server/cli/extract-assets.ts`.
4. Exporter: Java test setup, `TexturePaths`, `CasingIconParser` (casing `getIcon` table-switch parse) — `exporter-mod/…/export/textures/`.
5. Exporter: `TextureFlattener` (GT `ITexture` trees → flat layer records).
6. Exporter: `TextureExporter` section (materials, meta-item tables, MTE faces, casing pages, casing blocks, covers, fluids, texture names), appended to `Exporter.sections()`.
7. `textures.json.gz` format and loader, joined to the asset index — `src/server/assets/textures-dump.ts`, `tests/helpers/textures-dump.ts`.
8. GT machine faces, casings, covers, material / meta-item / fluid icons — `src/server/assets/gt-faces.ts`, `tests/helpers/gt-sample.ts`.
9. Curated non-GT block tables — `src/server/assets/curated.ts`.
10. Resolver: `BlockRef` → `BlockFaces`, `StuffKey` → `IconDescriptor`, fallback colours — `src/server/assets/resolve.ts`.
11. Optional NEI item-panel icon import — `src/server/assets/nei.ts`, `src/server/cli/import-nei-icons.ts`.
12. Asset service and `/api/assets/*` routes — `src/server/assets/service.ts`, `src/server/http/routes/assets.ts`, `ROUTE_MODULES`, `src/shared/types/api.ts`.
13. Client texture loading, compositing and icon batching — `src/client/assets/*.ts`.
14. Real `ItemIcon` component — `src/client/assets/icons.ts`, `src/client/components/ItemIcon.tsx`.
15. Real-data check (`GTNH_LOCAL=1`): texture dump from the export clone, extraction from the real pack, coverage report.
16. End-to-end check (Playwright) and README section.

## File map

| File | Responsibility |
|---|---|
| `src/shared/types/assets.ts` | §6.5 types, `FACES`, `rotateFaces`, `hashColor`, `KIND_COLORS`, pseudo block ids for parts |
| `src/shared/types/api.ts` (append) | `AssetIconsRequest`, `AssetBlocksRequest`, request caps |
| `src/server/assets/png.ts` | PNG size from IHDR, frame count from `.mcmeta` |
| `src/server/assets/index.ts` | `index.json` format, loader, `AssetIndex.layer()` |
| `src/server/assets/extract.ts` | jar scan, duplicate winner rule, staging + swap |
| `src/server/cli/extract-assets.ts` | `npm run extract-assets` |
| `src/server/assets/textures-dump.ts` | `textures.json.gz` format and loader |
| `src/server/assets/gt-faces.ts` | GT machine faces, casings, covers, material / meta-item / fluid icons |
| `src/server/assets/curated.ts` | non-GT block tables (Storage Drawers, JABBA, Iron Chests, Project Red, EnderIO, AE2, multi-texture vanilla blocks) |
| `src/server/assets/resolve.ts` | `BlockRef` → `BlockFaces`, `StuffKey` → `IconDescriptor`, fallback colours |
| `src/server/assets/nei.ts`, `src/server/cli/import-nei-icons.ts` | optional NEI item-panel icon import |
| `src/server/assets/service.ts` | reload on file change, `app.services.assets` |
| `src/server/http/routes/assets.ts` | `GET /api/assets/file/*`, `POST /api/assets/icons`, `POST /api/assets/blocks`, `POST /api/assets/covers` |
| `src/client/assets/{texture-image,composite,icon-batcher,icons}.ts` | layer loading (shared with Plan 5), compositing, batching, render cache |
| `src/client/components/ItemIcon.tsx` | real body for Plan 2's placeholder |
| `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/textures/*.java` | `TexturePaths`, `CasingIconParser`, `IconRef`, `TextureEnv`, `TextureFlattener`, `LayerRec`, `McTextureEnv`, `TextureExporter` |
| `exporter-mod/src/test/java/io/github/drukoz/gtnhplanner/export/textures/*.java`, `exporter-mod/addon.gradle` | JUnit tests of the pure-Java helpers |
| `tests/helpers/{png,jar,textures-dump,assets-dir,gt-sample,nei-dump}.ts` | synthetic fixtures (route tests use Plan 2's `tests/helpers/test-server.ts`) |
| `tests/e2e/assets-fixture.ts`, `tests/e2e/assets.spec.ts` | synthetic assets for the shared e2e server, Playwright check |
| `tests/unit/assets/real-assets.test.ts` | `GTNH_LOCAL=1` checklist against the real pack |

## What this plan uses from Plans 1 and 2

- Plan 1 (TypeScript): `parseItemKey`, `isFluidKey`, `StuffKey`, `ItemKey` (`src/shared/keys.ts`); `BlockRef`, `Pack`, `Machine`, `MachineKind`, `Item`, `GtMaterial` (`src/shared/types/pack.ts`); `AppConfig`, `loadConfig()`, `activeExportDir(cfg)` (`src/server/config.ts`), `loadPack` (`src/server/pack/load.ts`, Task 15 only). `Pack.machines` gives fallback colours by kind; `Pack.items[].gt` + `Pack.materials` give a material colour when no texture dump exists.
- Plan 1 (exporter mod, Plan 1 Task 9, package `io.github.drukoz.gtnhplanner.export`): `ExportSection` (`name()`, `export(ExportContext)`, `optional()`), `ExportContext` (`dir()`, `gzipJson(String fileName)` → Gson `JsonWriter` over one gzip'd JSON document, `warn(String)`, `count(String, long)`), `Exporter.sections()` (ordered list; Plan 1 says "Plan 3 appends TextureExporter last"), `scripts/check-reobf.sh`, the `$GTDEV` / Gradle conventions of Plan 1 ("Conventions for every task"), and `npm run export` (runs the mod on the APFS clone only). Plan 1's JSONL writer is not used: the dump is one gzip'd JSON document, written through `ctx.gzipJson("textures.json.gz")`.
- Plan 1 tests: `runCli(script, args, opts)` (`tests/helpers/run-cli.ts`; Tasks 3 and 11 add their script names to its union) and `snapshot(dir)` (`tests/helpers/fake-server.ts`).
- Plan 2: `Route`, `Handler`, `HttpError`, `sendJson`, `readJson` (`src/server/http/router.ts`), `AppContext` with `services` (`src/server/app.ts`), `ROUTE_MODULES` (`src/server/http/routes/index.ts`), `apiPost` (`src/client/api/client.ts`), the `ItemIcon` placeholder (`src/client/components/ItemIcon.tsx`, props `{ itemKey: StuffKey; size?: number }`; Plan 2's `tests/client/scaffold.test.tsx` expects `title="<key>"` and `width:32px` in its static markup, which the real body keeps), `startTestServer({ pack })` (`tests/helpers/test-server.ts`), and the shared Playwright harness `tests/e2e/{helpers,prepare}.ts` with the signatures of architecture §11.7: `login(page)`, `setName(page, name)`, `createProject(page, name)` (leaves the page on the new project); plans 3–5 extend `prepare.ts`.
- Plan 4 consumes from this plan: `POST /api/assets/blocks` (top faces for map colours), `GET /api/assets/file/<path>`, `BlockFaces`, `TextureLayer`. Plan 5 consumes `BlockFaces`, `TextureLayer`, `Face`, `IconDescriptor`, `FACES`, `rotateFaces`, `KIND_COLORS`, `Rgb`, `partBlockRef`, `ae2CableBlockRef`, the blocks/icons/file routes, and can use `loadLayerBitmap` (Task 13) and `POST /api/assets/covers` (Task 12).

---

### Task 1: Shared asset types, PNG size and `.mcmeta` frames

**Files:**
- Create: `src/shared/types/assets.ts`, `src/server/assets/png.ts`, `tests/helpers/png.ts`
- Test: `tests/unit/assets/types.test.ts`, `tests/unit/assets/png.test.ts`

**Interfaces:**
- Consumes: `BlockRef`, `MachineKind` (Plan 1, `src/shared/types/pack.ts`); `StuffKey` (Plan 1, `src/shared/keys.ts`).
- Produces:
  - `src/shared/types/assets.ts` — `TextureLayer`, `Face`, `BlockFaces`, `IconDescriptor` copied verbatim from architecture §6.5, plus:
    ```ts
    export type Rgb = [number, number, number];
    export const FACES: readonly Face[];                                   // ['down','up','north','south','west','east'] = ForgeDirection 0..5
    export function rotateFaces<T>(faces: Record<Face, T>, facing: number): Record<Face, T>;   // new object
    export function hashColor(s: string): Rgb;                             // stable colour for anything without a texture
    export const KIND_COLORS: Readonly<Record<MachineKind, Rgb>>;          // spec §3.8 fallback "plain color by machine kind"
    export function partBlockRef(partId: string): BlockRef;                // { id: `fmp:${partId}`, meta: 0 }   Forge Multipart part, e.g. 'pr_rinterface'
    export function conduitBlockRef(type: string): BlockRef;               // { id: `conduit:${type}`, meta: 0 } EnderIO conduit type (Plan 4 ConduitType)
    export function ae2CableBlockRef(center: string): BlockRef;            // { id: `ae2cable:${center}`, meta: 0 } 'glass' | 'covered' | 'smart' | 'dense' | 'dense_covered'
    export interface CoverLayers { item: StuffKey; layers: TextureLayer[] } // a GT cover's in-world overlay (Tasks 10 and 12)
    ```
    The pseudo ids exist because parts, conduits and AE2 cable types share one world block each; Plan 5 uses them for the line's pipes, and the resolver (Task 10) knows them.
  - `src/server/assets/png.ts`: `export interface PngSize { width: number; height: number }`, `export function pngSize(bytes: Uint8Array): PngSize | null`, `export function animationFrames(mcmeta: string, size: PngSize): number`.
  - `tests/helpers/png.ts`: `export type Rgba = [number, number, number, number]`; `export function makePng(width: number, height: number, color: Rgba | ((x: number, y: number) => Rgba)): Buffer` — a real 8-bit RGBA PNG (signature, `IHDR` colour type 6, one `IDAT` = `deflateSync` of rows each starting with filter byte 0, `IEND`; chunk CRCs from `zlib.crc32`).

Rules the signatures do not fix:
- `rotateFaces`: canonical faces have the front on north; `facing` is the ForgeDirection index the front is turned to. Result face ← canonical face: `2` identity; `3` north←south, south←north, west←east, east←west; `4` west←north, south←west, east←south, north←east; `5` east←north, south←east, west←south, north←west; `0` down←north, south←down, up←south, north←up; `1` up←north, south←up, down←south, north←down. Faces not named keep their value; any other `facing` returns an identity copy. Texture rotation inside a face is ignored.
- `hashColor`: FNV-1a 32-bit over UTF-16 code units (`h = 0x811c9dc5`; per unit `h ^= c; h = Math.imul(h, 0x01000193) >>> 0`), hue `h % 360`, then HSL(hue, 45 %, 55 %) → RGB, each channel rounded. This is the colour Plan 2's placeholder described (`hsl(hash % 360, 45%, 55%)`), now with a fixed hash.
- `KIND_COLORS`: basic `[96,125,139]`, multiblock `[69,90,100]`, steam `[176,124,72]`, generator `[251,140,0]`, boiler `[191,90,40]`, turbine `[120,144,156]`, battery_buffer `[67,160,71]`, transformer `[142,36,170]`, cable `[66,66,66]`, fluid_pipe `[30,136,229]`, item_pipe `[255,179,0]`, hatch `[121,85,72]`, casing `[158,158,158]`, other `[117,117,117]`.
- `pngSize`: `null` unless the 8-byte PNG signature is followed by a chunk whose type is `IHDR`; width and height are the big-endian u32 at byte offsets 16 and 20 (research §2.4 reads sizes the same way).
- `animationFrames` (research §2.4): `1` unless `mcmeta` parses as JSON with an object `animation`; frame height = `animation.height` when it is a positive integer, else the PNG width (square frames); result `max(1, floor(height / frameHeight))`. Frame 0 is the top `height / frames` rows (Global Constraints).

- [ ] **Step 1: Write the failing tests**

`tests/unit/assets/types.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { FACES, rotateFaces, hashColor, KIND_COLORS, partBlockRef, conduitBlockRef, ae2CableBlockRef, type Face } from '../../../src/shared/types/assets.ts';

const C: Record<Face, string> = { down: 'D', up: 'U', north: 'N', south: 'S', west: 'W', east: 'E' };

describe('asset types', () => {
  it('lists faces in ForgeDirection order', () => {
    expect(FACES).toEqual(['down', 'up', 'north', 'south', 'west', 'east']);
  });

  it('turns the canonical north front to each facing', () => {
    expect(rotateFaces(C, 2)).toEqual(C);
    expect(rotateFaces(C, 3)).toEqual({ down: 'D', up: 'U', north: 'S', south: 'N', west: 'E', east: 'W' });
    expect(rotateFaces(C, 4)).toEqual({ down: 'D', up: 'U', north: 'E', south: 'W', west: 'N', east: 'S' });
    expect(rotateFaces(C, 5)).toEqual({ down: 'D', up: 'U', north: 'W', south: 'E', west: 'S', east: 'N' });
    expect(rotateFaces(C, 0)).toEqual({ down: 'N', up: 'S', north: 'U', south: 'D', west: 'W', east: 'E' });
    expect(rotateFaces(C, 1)).toEqual({ down: 'S', up: 'N', north: 'D', south: 'U', west: 'W', east: 'E' });
    expect(rotateFaces(C, 7)).toEqual(C);
    expect(rotateFaces(C, 2)).not.toBe(C);
  });

  it('hashes to stable colours', () => {
    expect(hashColor('a')).toEqual([192, 89, 123]);
    expect(hashColor('fluid:water')).toEqual([89, 192, 106]);
    expect(hashColor('t:iron_ingot@0')).toEqual([89, 128, 192]);
  });

  it('has a colour for every machine kind', () => {
    expect(Object.keys(KIND_COLORS).sort()).toEqual(['basic', 'battery_buffer', 'boiler', 'cable', 'casing', 'fluid_pipe', 'generator',
      'hatch', 'item_pipe', 'multiblock', 'other', 'steam', 'transformer', 'turbine']);
    expect(KIND_COLORS.basic).toEqual([96, 125, 139]);
  });

  it('builds pseudo block refs for parts, conduits and AE2 cables', () => {
    expect(partBlockRef('pr_rinterface')).toEqual({ id: 'fmp:pr_rinterface', meta: 0 });
    expect(conduitBlockRef('item')).toEqual({ id: 'conduit:item', meta: 0 });
    expect(ae2CableBlockRef('smart')).toEqual({ id: 'ae2cable:smart', meta: 0 });
  });
});
```

`tests/unit/assets/png.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { makePng } from '../../helpers/png.ts';
import { pngSize, animationFrames } from '../../../src/server/assets/png.ts';

describe('png', () => {
  it('reads the size from IHDR', () => {
    expect(pngSize(makePng(16, 512, [255, 255, 255, 255]))).toEqual({ width: 16, height: 512 });
    expect(pngSize(makePng(32, 32, (x) => [x * 8, 0, 0, 255]))).toEqual({ width: 32, height: 32 });
    expect(pngSize(new TextEncoder().encode('definitely not a png file'))).toBeNull();
    expect(pngSize(makePng(4, 4, [0, 0, 0, 0]).subarray(0, 20))).toBeNull();
  });

  it('counts animation frames from .mcmeta', () => {
    expect(animationFrames('{"animation":{"frametime":2}}', { width: 16, height: 512 })).toBe(32);
    expect(animationFrames('{"animation":{}}', { width: 16, height: 64 })).toBe(4);
    expect(animationFrames('{"animation":{"height":8}}', { width: 16, height: 64 })).toBe(8);
    expect(animationFrames('{"animation":{"frametime":1}}', { width: 16, height: 16 })).toBe(1);
    expect(animationFrames('{"fullDrawers1":{"trimWidth":0.0625}}', { width: 16, height: 64 })).toBe(1);
    expect(animationFrames('{oops', { width: 16, height: 64 })).toBe(1);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/assets/types.test.ts tests/unit/assets/png.test.ts`
Expected: FAIL — `Cannot find module '../../../src/shared/types/assets.ts'` (and `png.ts`, `tests/helpers/png.ts`).

- [ ] **Step 3: Write `src/shared/types/assets.ts`, `src/server/assets/png.ts` and `tests/helpers/png.ts`** as specified above (`assets.ts` imports only types from Plan 1 with `import type`; it stays free of `node:*` and DOM, architecture §3).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/assets/types.test.ts tests/unit/assets/png.test.ts && npm run typecheck`
Expected: PASS (`Test Files  2 passed`), typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/assets.ts src/server/assets/png.ts tests/helpers/png.ts tests/unit/assets/types.test.ts tests/unit/assets/png.test.ts
git commit -m "feat(assets): shared asset types, PNG size and mcmeta frame count

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: Jar texture extraction with the duplicate winner rule and a staged swap

**Files:**
- Create: `src/server/assets/index.ts`, `src/server/assets/extract.ts`, `tests/helpers/jar.ts`
- Modify: `package.json`, `package-lock.json` (only if `yauzl@3.4.0` / `@types/yauzl@3.4.0` are not installed yet)
- Test: `tests/unit/assets/index.test.ts`, `tests/unit/assets/extract.test.ts`

**Interfaces:**
- Consumes: `pngSize`, `animationFrames` (Task 1); `TextureLayer`, `Rgb` (Task 1); yauzl 3.4.0 promise API (`yauzl.openPromise(path, { lazyEntries: true, autoClose: false })`, `for await (const e of zip.eachEntry())`, `zip.openReadStreamPromise(e)`; files are opened with flag `'r'`, web-stack §9.1).
- Produces:
  - `src/server/assets/index.ts`:
    ```ts
    export const ASSET_INDEX_FORMAT = 'gtnh-planner-assets/1';
    export const INDEX_FILE = 'index.json';                              // data/assets/index.json
    export interface AssetFileInfo { w: number; h: number; frames?: number /* only when > 1 */; jar: string /* basename of the winning jar */ }
    export interface AssetConflict { path: string; winner: string; losers: string[]; rule: 'mod-over-client' | 'override-over-home' | 'last-by-name' }
    export interface AssetIndexFile {
      format: typeof ASSET_INDEX_FORMAT; createdAt: string;
      sources: Array<{ jar: string; kind: 'client' | 'mod'; files: number /* paths it won */; sha1?: string /* client jar only */ }>;
      files: Record<string /* data/assets-relative PNG path */, AssetFileInfo>;
      conflicts: AssetConflict[] /* sorted by path */; identicalDuplicates: number;
    }
    export class AssetIndexError extends Error {}
    export interface AssetIndex {
      readonly size: number; readonly file: AssetIndexFile | null;
      has(path: string): boolean; info(path: string): AssetFileInfo | undefined;
      layer(path: string, opts?: { tint?: Rgb; glow?: boolean }): TextureLayer | null;
      firstLayer(paths: readonly string[], opts?: { tint?: Rgb; glow?: boolean }): TextureLayer | null;
    }
    export function assetIndexFrom(file: AssetIndexFile): AssetIndex;
    export function emptyAssetIndex(): AssetIndex;
    export function loadAssetIndex(assetsDir: string): Promise<AssetIndex>;   // no index.json → emptyAssetIndex(); other format or bad JSON → AssetIndexError
    export function iconPath(iconName: string, atlas: 'blocks' | 'items'): string;
    ```
  - `src/server/assets/extract.ts`:
    ```ts
    export interface JarSource { path: string; kind: 'client' | 'mod' }
    export interface ExtractOptions { jars: JarSource[]; dataDir: string; clientSha1?: string; now?: () => Date }
    export interface ExtractSummary { files: number /* PNGs indexed */; bytes: number /* bytes copied */; jars: number /* jars opened */; conflicts: AssetConflict[]; identicalDuplicates: number; skippedJars: Array<{ jar: string; error: string }>; ignoredEntries: number /* entries that are not block/item textures */ }
    export class ExtractError extends Error {}
    export function textureEntry(name: string): string | null;
    export function pickWinner(candidates: ReadonlyArray<{ jar: string; kind: 'client' | 'mod' }>, home: string | undefined): { winner: string; rule: AssetConflict['rule'] };
    export function extractAssets(opts: ExtractOptions): Promise<ExtractSummary>;
    ```
  - `tests/helpers/jar.ts`: `export type JarEntries = Record<string, Uint8Array | string>`; `export function jarBytes(entries: JarEntries, opts?: { corrupt?: string[] }): Buffer` (local headers + central directory + end record; method 8 via `deflateRawSync`, CRC-32 via `zlib.crc32`; entries named in `corrupt` get their compressed bytes replaced by `0xff` bytes of the same length, so inflating them fails while the central directory stays valid); `export function makeJar(file: string, entries: JarEntries, opts?: { corrupt?: string[] }): Promise<string>` (writes, returns `file`).

Rules the signatures do not fix:
- `iconPath` (research §2.1): split at the first `:`; the domain is lower-cased and defaults to `minecraft` when absent or empty; the rest is kept as is → `<domain>/textures/<atlas>/<rest>.png`.
- `layer`: `null` when the path is not in the index; copies `frames` when > 1; omits `tint` when absent or `[255, 255, 255]`; sets `glow: true` only when asked. `firstLayer` returns the layer of the first listed path that exists.
- `textureEntry`: accepts only `assets/<domain>/textures/(blocks|items)/<rest>` where `<domain>` matches `[a-z0-9_.-]+` (the game lower-cases domains before looking up a jar entry, so an upper-case folder is never used in game, research §2.1) and `<rest>` ends in `.png` or `.png.mcmeta` and has no empty, `.` or `..` segment, no `\`, NUL or control character; returns `<domain>/textures/<atlas>/<rest>` (the entry name without `assets/`), else `null`. Nothing outside `data/assets` can be written.
- **Duplicate winner rule** (decided here; research §2.2 shows the last resource pack wins, FML appends one pack per mod after vanilla, and the exact mod order per pair is unverified): (1) a mod jar's copy beats the client jar's (`mod-over-client`); (2) among mod jars, copies from jars other than the domain's *home jar* beat the home jar's copy (`override-over-home`): a jar ships another mod's texture path only to override it, e.g. `GTNewHorizonsCoreMod` over `gregtech`; the home jar of a domain is the mod jar with the most PNGs in it, ties to the first name case-insensitively; (3) any remaining tie goes to the jar whose basename sorts last case-insensitively (`last-by-name`, FML discovers mod files in name order). A duplicate whose candidates all have the same CRC-32 and size (central directory) is counted in `identicalDuplicates` and not listed as a conflict. The README (Task 16) states this rule; `index.json` keeps every conflict so a pair can be checked in game.
- `extractAssets` algorithm: pass 1 opens every jar (client first, then mods by case-insensitive basename) and reads only the central directory; a jar that cannot be opened is recorded in `skippedJars` and the run goes on. Choose winners (above); a `.png.mcmeta` is taken only from the jar that won its PNG. Pass 2 creates `<dataDir>/assets.staging-<pid>-<ms>/`, copies each winning entry (whole entry in memory, then `writeFile`), reads PNG sizes with `pngSize`, computes `frames` from the copied `.mcmeta`, and writes `index.json` (PNG paths only). Any error in pass 2 (corrupt entry, full disk) removes the staging folder and rejects with `ExtractError`, leaving `data/assets` untouched. On success: move `data/assets/nei` (Task 11's import) into the staging folder, rename `data/assets` to `data/assets.old-<ms>`, rename the staging folder to `data/assets`, then remove the old folder; if a rename fails, move what was moved back and reject.

- [ ] **Step 1: Install yauzl if needed**

Run: `npm ls yauzl @types/yauzl || npm install --save-exact --before="$(date -v-14d +%F)" yauzl@3.4.0 @types/yauzl@3.4.0`
Expected: `npm ls` lists `yauzl@3.4.0` and `@types/yauzl@3.4.0` afterwards (move `@types/yauzl` to `devDependencies` if npm put it elsewhere).

- [ ] **Step 2: Write the failing tests**

`tests/unit/assets/index.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assetIndexFrom, loadAssetIndex, iconPath, AssetIndexError, ASSET_INDEX_FORMAT, type AssetIndexFile } from '../../../src/server/assets/index.ts';

const FILE: AssetIndexFile = {
  format: ASSET_INDEX_FORMAT, createdAt: '2026-10-17T00:00:00.000Z', sources: [], conflicts: [], identicalDuplicates: 0,
  files: {
    'gregtech/textures/blocks/fluids/fluid.water.png': { w: 16, h: 64, frames: 4, jar: 'gregtech.jar' },
    'minecraft/textures/blocks/stone.png': { w: 16, h: 16, jar: 'client.jar' },
  },
};

describe('asset index', () => {
  it('maps icon names to files', () => {
    expect(iconPath('StorageDrawers:drawers_oak_front_1', 'blocks')).toBe('storagedrawers/textures/blocks/drawers_oak_front_1.png');
    expect(iconPath('stone', 'blocks')).toBe('minecraft/textures/blocks/stone.png');
    expect(iconPath('gregtech:gt.metaitem.01/123', 'items')).toBe('gregtech/textures/items/gt.metaitem.01/123.png');
    expect(iconPath(':apple', 'items')).toBe('minecraft/textures/items/apple.png');
  });

  it('builds layers only for extracted files', () => {
    const ix = assetIndexFrom(FILE);
    expect(ix.size).toBe(2);
    expect(ix.layer('gregtech/textures/blocks/fluids/fluid.water.png', { tint: [255, 255, 255] }))
      .toEqual({ path: 'gregtech/textures/blocks/fluids/fluid.water.png', frames: 4 });
    expect(ix.layer('minecraft/textures/blocks/stone.png', { tint: [10, 20, 30], glow: true }))
      .toEqual({ path: 'minecraft/textures/blocks/stone.png', tint: [10, 20, 30], glow: true });
    expect(ix.layer('gregtech/textures/blocks/iconsets/NOPE.png')).toBeNull();
    expect(ix.firstLayer(['a/textures/blocks/x.png', 'minecraft/textures/blocks/stone.png'])).toEqual({ path: 'minecraft/textures/blocks/stone.png' });
    expect(ix.firstLayer(['a/textures/blocks/x.png'])).toBeNull();
  });

  it('loads from disk, empty when missing, error on a foreign file', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-ix-'));
    expect((await loadAssetIndex(dir)).size).toBe(0);
    await writeFile(join(dir, 'index.json'), JSON.stringify(FILE));
    expect((await loadAssetIndex(dir)).has('minecraft/textures/blocks/stone.png')).toBe(true);
    await writeFile(join(dir, 'index.json'), JSON.stringify({ ...FILE, format: 'other/1' }));
    await expect(loadAssetIndex(dir)).rejects.toBeInstanceOf(AssetIndexError);
  });
});
```

`tests/unit/assets/extract.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeJar } from '../../helpers/jar.ts';
import { makePng } from '../../helpers/png.ts';
import { extractAssets, textureEntry, pickWinner, ExtractError } from '../../../src/server/assets/extract.ts';

const RED = makePng(16, 16, [255, 0, 0, 255]);
const BLUE = makePng(16, 16, [0, 0, 255, 255]);
const GREY = makePng(16, 16, [128, 128, 128, 255]);
const P = (dir: string, rel: string) => join(dir, 'assets', rel);

async function pack() {
  const dir = await mkdtemp(join(tmpdir(), 'gp-ex-'));
  const jars = join(dir, 'jars');
  await mkdir(jars);
  const client = await makeJar(join(jars, 'minecraft-1.7.10-client.jar'), {
    'assets/minecraft/textures/blocks/stone.png': GREY, 'assets/minecraft/textures/blocks/sponge.png': RED,
    'assets/minecraft/textures/items/apple.png': RED, 'assets/minecraft/lang/en_US.lang': 'x=y', 'net/minecraft/client/Main.class': 'cafebabe' });
  const gt = await makeJar(join(jars, 'gregtech-5.09.54.183.jar'), {
    'assets/gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png': GREY,
    'assets/gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png': RED,
    'assets/gregtech/textures/blocks/fluids/fluid.water.png': makePng(16, 64, [40, 60, 200, 255]),
    'assets/gregtech/textures/blocks/fluids/fluid.water.png.mcmeta': '{"animation":{"frametime":2}}',
    'assets/gregtech/textures/items/gt.metaitem.01/606.png': GREY,
    'assets/gregtech/textures/gui/background.png': GREY,
    'assets/x/textures/blocks/../../../../evil.png': RED });
  const core = await makeJar(join(jars, 'GTNewHorizonsCoreMod-2.9.76.jar'), {
    'assets/gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png': BLUE,
    'assets/gregtech/textures/items/gt.metaitem.01/606.png': GREY,
    'assets/dreamcraft/textures/items/item.Foo.png': BLUE });
  const vn = await makeJar(join(jars, 'VillageNames-4.jar'), { 'assets/minecraft/textures/blocks/sponge.png': BLUE });
  const broken = join(jars, 'broken.jar');
  await writeFile(broken, 'this is not a zip');
  return { dir, jars: [{ path: client, kind: 'client' as const }, ...[gt, core, vn, broken].map((path) => ({ path, kind: 'mod' as const }))] };
}

describe('textureEntry and pickWinner', () => {
  it('accepts only block and item textures under a lower-case domain', () => {
    expect(textureEntry('assets/gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png')).toBe('gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png');
    expect(textureEntry('assets/gregtech/textures/blocks/fluids/fluid.water.png.mcmeta')).toBe('gregtech/textures/blocks/fluids/fluid.water.png.mcmeta');
    for (const bad of ['assets/gregtech/textures/gui/x.png', 'assets/StorageDrawers/textures/blocks/a.png', 'assets/x/textures/blocks/../../../evil.png',
      'assets/x/textures/items/a\\b.png', 'assets/x/textures/items/', 'assets/x/textures/blocks/a.txt', 'assets/x/textures/blocks//a.png'])
      expect(textureEntry(bad)).toBeNull();
  });

  it('applies the winner rule', () => {
    expect(pickWinner([{ jar: 'minecraft-1.7.10-client.jar', kind: 'client' }, { jar: 'VillageNames-4.jar', kind: 'mod' }], undefined))
      .toEqual({ winner: 'VillageNames-4.jar', rule: 'mod-over-client' });
    expect(pickWinner([{ jar: 'gregtech-5.09.54.183.jar', kind: 'mod' }, { jar: 'GTNewHorizonsCoreMod-2.9.76.jar', kind: 'mod' }], 'gregtech-5.09.54.183.jar'))
      .toEqual({ winner: 'GTNewHorizonsCoreMod-2.9.76.jar', rule: 'override-over-home' });
    expect(pickWinner([{ jar: 'B.jar', kind: 'mod' }, { jar: 'a.jar', kind: 'mod' }], 'home.jar')).toEqual({ winner: 'B.jar', rule: 'last-by-name' });
    expect(pickWinner([{ jar: 'CoFHCore.jar', kind: 'mod' }, { jar: 'ThermalFoundation.jar', kind: 'mod' }, { jar: 'zzz.jar', kind: 'mod' }], 'CoFHCore.jar'))
      .toEqual({ winner: 'zzz.jar', rule: 'last-by-name' });
  });
});

describe('extractAssets', () => {
  it('copies winners, indexes sizes and frames, logs conflicts and skips broken jars', async () => {
    const { dir, jars } = await pack();
    const before = await Promise.all(jars.map((j) => stat(j.path)));
    const s = await extractAssets({ jars, dataDir: dir, clientSha1: 'e80d9b3bf5085002218d4be59e668bac718abbc6' });
    expect(s.files).toBe(8);
    expect(s.identicalDuplicates).toBe(1);
    expect(s.skippedJars.map((j) => j.jar)).toEqual(['broken.jar']);
    expect(s.conflicts).toEqual([
      { path: 'gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png', winner: 'GTNewHorizonsCoreMod-2.9.76.jar', losers: ['gregtech-5.09.54.183.jar'], rule: 'override-over-home' },
      { path: 'minecraft/textures/blocks/sponge.png', winner: 'VillageNames-4.jar', losers: ['minecraft-1.7.10-client.jar'], rule: 'mod-over-client' },
    ]);
    expect(await readFile(P(dir, 'gregtech/textures/blocks/iconsets/OVERLAY_ACCELERATOR.png'))).toEqual(BLUE);
    expect(existsSync(P(dir, 'gregtech/textures/blocks/fluids/fluid.water.png.mcmeta'))).toBe(true);
    expect(existsSync(P(dir, 'gregtech/textures/gui/background.png'))).toBe(false);
    expect(existsSync(P(dir, 'minecraft/lang/en_US.lang'))).toBe(false);
    expect(existsSync(join(dir, 'evil.png'))).toBe(false);
    const ix = JSON.parse(await readFile(P(dir, 'index.json'), 'utf8'));
    expect(ix.files['gregtech/textures/blocks/fluids/fluid.water.png']).toEqual({ w: 16, h: 64, frames: 4, jar: 'gregtech-5.09.54.183.jar' });
    expect(ix.files['minecraft/textures/blocks/stone.png']).toEqual({ w: 16, h: 16, jar: 'minecraft-1.7.10-client.jar' });
    expect(ix.sources.find((x: { kind: string }) => x.kind === 'client').sha1).toBe('e80d9b3bf5085002218d4be59e668bac718abbc6');
    const after = await Promise.all(jars.map((j) => stat(j.path)));
    expect(after.map((a) => a.mtimeMs)).toEqual(before.map((b) => b.mtimeMs));
  });

  it('replaces old files but keeps the NEI import', async () => {
    const { dir, jars } = await pack();
    await mkdir(P(dir, 'nei/icons'), { recursive: true });
    await writeFile(P(dir, 'nei/index.json'), '{}');
    await writeFile(P(dir, 'nei/icons/a.png'), RED);
    await writeFile(P(dir, 'stale.png'), RED);
    await extractAssets({ jars, dataDir: dir });
    expect(existsSync(P(dir, 'nei/icons/a.png'))).toBe(true);
    expect(existsSync(P(dir, 'stale.png'))).toBe(false);
    expect((await readdir(dir)).filter((n) => n.startsWith('assets.'))).toEqual([]);
  });

  it('leaves the previous assets in place when copying fails', async () => {
    const { dir, jars } = await pack();
    await extractAssets({ jars, dataDir: dir });
    const first = await readFile(P(dir, 'index.json'), 'utf8');
    const bad = await makeJar(join(dir, 'jars', 'bad.jar'), { 'assets/bad/textures/blocks/a.png': RED }, { corrupt: ['assets/bad/textures/blocks/a.png'] });
    await expect(extractAssets({ jars: [...jars, { path: bad, kind: 'mod' }], dataDir: dir })).rejects.toBeInstanceOf(ExtractError);
    expect(await readFile(P(dir, 'index.json'), 'utf8')).toBe(first);
    expect((await readdir(dir)).filter((n) => n.startsWith('assets.'))).toEqual([]);
  });
});
```

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/assets/index.test.ts tests/unit/assets/extract.test.ts`
Expected: FAIL — missing modules `src/server/assets/index.ts`, `extract.ts`, `tests/helpers/jar.ts`.

- [ ] **Step 4: Implement `tests/helpers/jar.ts`, `src/server/assets/index.ts` and `src/server/assets/extract.ts`** as specified (no other module may write under `data/assets`).

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/assets/index.test.ts tests/unit/assets/extract.test.ts && npm run typecheck`
Expected: PASS (`Test Files  2 passed`), typecheck exits 0.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/server/assets/index.ts src/server/assets/extract.ts tests/helpers/jar.ts tests/unit/assets/index.test.ts tests/unit/assets/extract.test.ts
git commit -m "feat(assets): extract jar textures into data/assets with a duplicate winner rule

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: `npm run extract-assets`

**Files:**
- Create: `src/server/cli/extract-assets.ts`
- Modify: `package.json` (script `"extract-assets": "node --disable-warning=ExperimentalWarning src/server/cli/extract-assets.ts"`), `tests/helpers/run-cli.ts` (Plan 1; add `'extract-assets'` to the `script` union)
- Test: `tests/unit/cli/extract-assets.test.ts`

**Interfaces:**
- Consumes: `extractAssets`, `ExtractError`, `ExtractSummary` (Task 2); `AppConfig`, `loadConfig()` (`src/server/config.ts`; `clientJar` per Architecture change request 1); `runCli` (Plan 1), `snapshot` (Plan 1, `tests/helpers/fake-server.ts`).
- Produces (`src/server/cli/extract-assets.ts`):
  ```ts
  export const CLIENT_JAR_SHA1 = 'e80d9b3bf5085002218d4be59e668bac718abbc6';
  export const CLIENT_JAR_CANDIDATES: readonly string[];   // relative to the home folder, in order:
    // 'Library/Application Support/PrismLauncher/libraries/com/mojang/minecraft/1.7.10/minecraft-1.7.10-client.jar'
    // 'Library/Application Support/minecraft/versions/1.7.10/1.7.10.jar'
  export function listModJars(serverFolder: string): Promise<string[]>;   // <server>/mods/*.jar and <server>/mods/1.7.10/*.jar, sorted case-insensitively by basename
  export function findClientJar(opts: { flag: string | null; config: string | null | undefined; home: string }): string | null;   // the flag when given (even if missing, so a typo is reported); else config, else a candidate, whichever exists first
  export function sha1File(path: string): Promise<string>;
  export function main(argv: string[], deps?: { config?: AppConfig; home?: string; clientSha1?: string; out?: (line: string) => void; err?: (line: string) => void }): Promise<number>;
  ```
  The file ends with `if (import.meta.main) process.exitCode = await main(process.argv.slice(2));`.

Behaviour (decided here):
- Flags (`node:util` `parseArgs`, strict): `--server <folder>`, `--client-jar <path>`, `--no-client`, `--help` (prints `Usage: npm run extract-assets -- [--server <folder>] [--client-jar <path> | --no-client]`, exit 0).
- Server folder = `--server`, else `config.serverFolder`; none → exit 2 with `No server folder: set "serverFolder" in data/config.json or pass --server <folder>`. No `<server>/mods` → exit 2 `No mods folder in <server>`. The server folder is only read (jars opened read-only), never written.
- Client jar: `--no-client` skips it (prints `warning: no client jar - vanilla block and item textures will be missing`); otherwise `findClientJar`; a flag path that does not exist → exit 2 `Client jar not found: <path>`; none → exit 2 with `No Minecraft 1.7.10 client jar found. Pass --client-jar <path> or set "clientJar" in data/config.json (Prism Launcher keeps it at ~/<candidate 1>), or use --no-client.` A sha1 other than `deps.clientSha1 ?? CLIENT_JAR_SHA1` → exit 2 with `<path> is not the official Minecraft 1.7.10 client jar (sha1 <got>, expected <expected>)`.
- Runs `extractAssets({ jars, dataDir: config.dataDir, clientSha1 })` and prints `Extracted <files> textures (<MB, one decimal> MB) from <jars> jars into <dataDir>/assets`, then `<identical> identical duplicates, <n> conflicting paths (winner: mod over vanilla, then an overriding jar over the texture's own mod, then the last jar by name):`, up to 20 lines `  <path>: <winner> over <losers joined by ', '>` and `  … <rest> more in <dataDir>/assets/index.json`, then `warning: skipped <jar>: <error>` per skipped jar → exit 0. `ExtractError` → `Extraction failed; the previous textures are still in place: <message>` → exit 1.

- [ ] **Step 1: Write the failing tests**

`tests/unit/cli/extract-assets.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, mkdir, writeFile, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { makeJar } from '../../helpers/jar.ts';
import { makePng } from '../../helpers/png.ts';
import { snapshot } from '../../helpers/fake-server.ts';
import { runCli } from '../../helpers/run-cli.ts';
import { main, listModJars, findClientJar, sha1File, CLIENT_JAR_CANDIDATES } from '../../../src/server/cli/extract-assets.ts';
import type { AppConfig } from '../../../src/server/config.ts';

const PNG = makePng(16, 16, [90, 90, 90, 255]);

async function setup() {
  const dir = await mkdtemp(join(tmpdir(), 'gp-xa-'));
  const srv = join(dir, 'srv');
  await mkdir(join(srv, 'mods', '1.7.10'), { recursive: true });
  await makeJar(join(srv, 'mods', 'gregtech-5.09.54.183.jar'), { 'assets/gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png': PNG });
  await makeJar(join(srv, 'mods', '1.7.10', 'Extra.jar'), { 'assets/extra/textures/items/thing.png': PNG });
  await writeFile(join(srv, 'mods', 'notes.txt'), 'not a jar');
  const client = await makeJar(join(dir, 'client.jar'), { 'assets/minecraft/textures/blocks/stone.png': PNG });
  const config = { dataDir: join(dir, 'data'), serverFolder: srv, activeExportId: null, clientJar: null } as unknown as AppConfig;
  const lines: string[] = [];
  return { dir, srv, client, config, lines, deps: { config, home: join(dir, 'home'), out: (l: string) => lines.push(l), err: (l: string) => lines.push(l) } };
}

describe('extract-assets CLI', () => {
  it('lists mod jars, including mods/1.7.10, by name', async () => {
    const { srv } = await setup();
    expect((await listModJars(srv)).map((p) => p.slice(srv.length + 1))).toEqual(['mods/1.7.10/Extra.jar', 'mods/gregtech-5.09.54.183.jar']);
  });

  it('finds the client jar from the flag, the config, then the launcher folders', async () => {
    const { dir, client } = await setup();
    const home = join(dir, 'home');
    expect(findClientJar({ flag: client, config: '/nope.jar', home })).toBe(client);
    expect(findClientJar({ flag: null, config: client, home })).toBe(client);
    expect(findClientJar({ flag: null, config: null, home })).toBeNull();
    await makeJar(join(home, CLIENT_JAR_CANDIDATES[0]!), {});
    expect(findClientJar({ flag: null, config: null, home })).toBe(join(home, CLIENT_JAR_CANDIDATES[0]!));
  });

  it('refuses a client jar that is not the official one', async () => {
    const { client, deps, lines } = await setup();
    expect(await main(['--client-jar', client], deps)).toBe(2);
    expect(lines.join('\n')).toContain('is not the official Minecraft 1.7.10 client jar');
  });

  it('extracts mods and the client jar without touching the server folder', async () => {
    const { srv, client, config, deps, lines } = await setup();
    const before = await snapshot(srv);
    expect(await main(['--client-jar', client], { ...deps, clientSha1: await sha1File(client) })).toBe(0);
    expect(lines[0]).toMatch(/^Extracted 3 textures \(\d+\.\d MB\) from 3 jars into .*data\/assets$/);
    const ix = JSON.parse(await readFile(join(config.dataDir, 'assets', 'index.json'), 'utf8'));
    expect(Object.keys(ix.files).sort()).toEqual(['extra/textures/items/thing.png', 'gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png', 'minecraft/textures/blocks/stone.png']);
    expect(await snapshot(srv)).toEqual(before);
  });

  it('explains what is missing', async () => {
    const { deps, lines } = await setup();
    expect(await main([], { ...deps, config: { ...deps.config, serverFolder: null } })).toBe(2);
    expect(lines.at(-1)).toContain('No server folder');
    expect(await main([], deps)).toBe(2);
    expect(lines.at(-1)).toContain('No Minecraft 1.7.10 client jar found');
    expect(await main(['--no-client'], deps)).toBe(0);
    expect(lines.join('\n')).toContain('warning: no client jar');
  });

  it('runs as a script', async () => {
    const r = await runCli('extract-assets', ['--help'], { cwd: (await setup()).dir });
    expect(r.code).toBe(0);
    expect(r.stdout).toContain('Usage: npm run extract-assets');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/cli/extract-assets.test.ts`
Expected: FAIL — `Cannot find module '../../../src/server/cli/extract-assets.ts'`.

- [ ] **Step 3: Implement `src/server/cli/extract-assets.ts`, add the npm script and extend the `runCli` script union**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/cli/extract-assets.test.ts && npm run typecheck`
Expected: PASS (`Test Files  1 passed`), typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json src/server/cli/extract-assets.ts tests/helpers/run-cli.ts tests/unit/cli/extract-assets.test.ts
git commit -m "feat(assets): npm run extract-assets with a verified 1.7.10 client jar

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Exporter — Java test setup, `TexturePaths`, `CasingIconParser`

GT casing blocks pick their face in `getIcon(side, meta)` (`func_149691_a`), which is client-only and stripped on the server (research §2.3, §3.7). The raw class file in the jar still has it, so the exporter reads the class bytes and follows that method for each side and meta, the way research §3.7 option 2 parsed it with `javap`.

**Files:**
- Modify: `exporter-mod/dependencies.gradle`
- Create: `exporter-mod/addon.gradle`; under `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/textures/`: `TexturePaths.java`, `IconRef.java`, `CasingIconParser.java`
- Test: under `exporter-mod/src/test/java/io/github/drukoz/gtnhplanner/export/textures/`: `TexturePathsTest.java`, `CasingIconParserTest.java`

**Interfaces:**
- Consumes: Plan 1's exporter project and build conventions (Task 9 "Conventions for every task").
- Produces (no Minecraft or GT imports in any of these):
  ```java
  public final class TexturePaths {
      /** ResourceLocation parts → data/assets-relative path; a path under "textures/" is a file (".png" added if missing), anything else is an icon name on `atlas`. Null path → null. */
      public static String fromResource(String domain, String path, String atlas);
      /** "domain:name" → "<lower-case domain>/textures/<atlas>/<name>.png"; no or empty domain → "minecraft" (research §2.1). */
      public static String fromIconName(String iconName, String atlas);
  }
  public final class IconRef {                       // a static field (or one element of a static array field) holding an icon container
      public final String owner; public final String field; public final int index;   // owner = internal class name; index -1 = plain field
      public IconRef(String owner, String field, int index);   // equals, hashCode, toString "owner.field[index]"
  }
  public final class CasingIconParser {
      public static final String SRG_NAME = "func_149691_a", DEV_NAME = "getIcon", DESC = "(II)Lnet/minecraft/util/IIcon;";
      /** result[meta][side] for meta 0..15, side 0..5; an entry is null where the method cannot be followed. Null when the class does not declare the method. */
      public static IconRef[][] parse(byte[] classBytes);
  }
  ```

`exporter-mod/dependencies.gradle` becomes (Plan 1's line kept):
```groovy
dependencies {
    compileOnly("com.github.GTNewHorizons:GT5-Unofficial:5.09.54.183:dev")
    // Plan 3: casing icon parser. FML depends on the ASM tree API and the pack ships asm-tree 9.4, so nothing is bundled.
    compileOnly("org.ow2.asm:asm-tree:9.4")
    testImplementation("org.ow2.asm:asm-tree:9.4")
    testImplementation("com.google.code.gson:gson:2.2.4")          // same Gson as Minecraft 1.7.10, for LayerRec JSON tests (Task 5)
    testImplementation("org.junit.jupiter:junit-jupiter:5.11.4")
    testRuntimeOnly("org.junit.platform:junit-platform-launcher:1.11.4")
}
```
`exporter-mod/addon.gradle` (applied by GTNHGradle after the main build script): `tasks.named('test') { useJUnitPlatform() }`.

`CasingIconParser.parse` algorithm (decided here): read with `ClassReader.accept(node, SKIP_FRAMES | SKIP_DEBUG)`; take the non-static method named `SRG_NAME` or `DEV_NAME` with descriptor `DESC`. For every (meta, side) run a tiny interpreter from the first instruction with local 1 = side, local 2 = meta and an operand stack of `Int(n)`, `Ref(IconRef)`, `Arr(owner, field)` or `Unknown`:
- labels, line numbers, frames, `NOP`, `CHECKCAST` → skip; `DUP`, `POP` → as the JVM does.
- `ILOAD`/`ISTORE` on int locals; `ICONST_M1..5`, `BIPUSH`, `SIPUSH`, `LDC` Integer → `Int`; `ALOAD`/other loads → `Unknown`.
- `IADD ISUB IMUL IDIV IREM IAND IOR ISHL ISHR` on two `Int`s → `Int` (division by zero ends the run).
- `GETSTATIC`: descriptor `L…;` → `Ref(owner, name, -1)`; `[L…;` → `Arr(owner, name)`; `AALOAD` on `Arr` + `Int` → `Ref(owner, name, index)`.
- `INVOKEINTERFACE`/`INVOKEVIRTUAL` with descriptor `()Lnet/minecraft/util/IIcon;` on a `Ref` → keeps the `Ref` (the container's `getIcon()`).
- `TABLESWITCH`, `LOOKUPSWITCH`, `IF_ICMPxx`, `IFxx` on `Int`s and `GOTO` → follow the branch.
- `ARETURN` of a `Ref` → the result; anything else (other invokes, `GETFIELD`, `NEW`, `ATHROW`, a branch on `Unknown`, more than 1,000 steps) → `null` for that (meta, side).

- [ ] **Step 1: Write the failing tests**

`TexturePathsTest.java`:

```java
package io.github.drukoz.gtnhplanner.export.textures;

import static org.junit.jupiter.api.Assertions.*;
import org.junit.jupiter.api.Test;

class TexturePathsTest {
    @Test void resourceLocations() {
        assertEquals("gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png", TexturePaths.fromResource("gregtech", "textures/blocks/iconsets/MACHINE_LV_SIDE.png", "blocks"));
        assertEquals("gregtech/textures/items/materialicons/NONE/dust.png", TexturePaths.fromResource("GregTech", "textures/items/materialicons/NONE/dust", "items"));
        assertEquals("gregtech/textures/blocks/fluids/fluid.water.png", TexturePaths.fromResource("gregtech", "fluids/fluid.water", "blocks"));
        assertNull(TexturePaths.fromResource("gregtech", null, "blocks"));
    }
    @Test void iconNames() {
        assertEquals("jabba/textures/blocks/barrel_side_0.png", TexturePaths.fromIconName("JABBA:barrel_side_0", "blocks"));
        assertEquals("minecraft/textures/blocks/stone.png", TexturePaths.fromIconName("stone", "blocks"));
        assertEquals("gregtech/textures/items/gt.metaitem.01/606.png", TexturePaths.fromIconName("gregtech:gt.metaitem.01/606", "items"));
    }
}
```

`CasingIconParserTest.java` (classes are generated with ASM and only parsed, never loaded, so no stack map frames are needed):

```java
package io.github.drukoz.gtnhplanner.export.textures;

import static org.junit.jupiter.api.Assertions.*;
import static org.objectweb.asm.Opcodes.*;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import org.objectweb.asm.*;

class CasingIconParserTest {
    static final String BI = "gregtech/api/enums/Textures$BlockIcons";
    static final String IC = "gregtech/api/interfaces/IIconContainer";

    static byte[] casing(String method, Consumer<MethodVisitor> body) {
        ClassWriter cw = new ClassWriter(ClassWriter.COMPUTE_MAXS);
        cw.visit(V1_8, ACC_PUBLIC, "test/Casing", null, "java/lang/Object", null);
        if (method != null) {
            MethodVisitor mv = cw.visitMethod(ACC_PUBLIC, method, CasingIconParser.DESC, null, null);
            mv.visitCode(); body.accept(mv); mv.visitMaxs(0, 0); mv.visitEnd();
        }
        cw.visitEnd();
        return cw.toByteArray();
    }
    static void ret(MethodVisitor mv, String field) {
        mv.visitFieldInsn(GETSTATIC, BI, field, "L" + IC + ";");
        mv.visitMethodInsn(INVOKEINTERFACE, IC, "getIcon", "()Lnet/minecraft/util/IIcon;", true);
        mv.visitInsn(ARETURN);
    }
    static void retArr(MethodVisitor mv, String array) {
        mv.visitFieldInsn(GETSTATIC, BI, array, "[L" + IC + ";");
        mv.visitVarInsn(ILOAD, 2); mv.visitInsn(AALOAD);
        mv.visitMethodInsn(INVOKEINTERFACE, IC, "getIcon", "()Lnet/minecraft/util/IIcon;", true);
        mv.visitInsn(ARETURN);
    }
    static IconRef ref(String f, int i) { return new IconRef(BI, f, i); }

    static Consumer<MethodVisitor> tableSwitch() {
        return mv -> {
            Label l0 = new Label(), l1 = new Label(), l2 = new Label(), dflt = new Label();
            mv.visitVarInsn(ILOAD, 2); mv.visitTableSwitchInsn(0, 2, dflt, l0, l1, l2);
            mv.visitLabel(l0); ret(mv, "MACHINE_CASING_SOLID_STEEL");
            mv.visitLabel(l1); ret(mv, "MACHINE_CASING_FROST_PROOF");
            mv.visitLabel(l2); ret(mv, "MACHINE_CASING_GEARBOX_BRONZE");
            mv.visitLabel(dflt); ret(mv, "MACHINE_CASING_SOLID_STEEL");
        };
    }

    @Test void metaTableSwitch() {
        IconRef[][] r = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, tableSwitch()));
        assertEquals(16, r.length);
        for (int side = 0; side < 6; side++) assertEquals(ref("MACHINE_CASING_SOLID_STEEL", -1), r[0][side]);
        assertEquals(ref("MACHINE_CASING_FROST_PROOF", -1), r[1][3]);
        assertEquals(ref("MACHINE_CASING_GEARBOX_BRONZE", -1), r[2][0]);
        assertEquals(ref("MACHINE_CASING_SOLID_STEEL", -1), r[9][5]);
        assertEquals(ref("MACHINE_CASING_FROST_PROOF", -1), CasingIconParser.parse(casing(CasingIconParser.DEV_NAME, tableSwitch()))[1][0]);
    }

    @Test void sideDependentArrays() {
        IconRef[][] r = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, mv -> {
            Label notBottom = new Label(), notTop = new Label();
            mv.visitVarInsn(ILOAD, 1); mv.visitJumpInsn(IFNE, notBottom); retArr(mv, "MACHINECASINGS_BOTTOM");
            mv.visitLabel(notBottom); mv.visitVarInsn(ILOAD, 1); mv.visitInsn(ICONST_1); mv.visitJumpInsn(IF_ICMPNE, notTop); retArr(mv, "MACHINECASINGS_TOP");
            mv.visitLabel(notTop); retArr(mv, "MACHINECASINGS_SIDE");
        }));
        assertEquals(ref("MACHINECASINGS_BOTTOM", 3), r[3][0]);
        assertEquals(ref("MACHINECASINGS_TOP", 3), r[3][1]);
        assertEquals(ref("MACHINECASINGS_SIDE", 3), r[3][4]);
    }

    @Test void lookupSwitchOnALocal() {
        IconRef[][] r = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, mv -> {
            Label a = new Label(), c = new Label(), dflt = new Label();
            mv.visitVarInsn(ILOAD, 2); mv.visitInsn(ICONST_4); mv.visitInsn(IREM); mv.visitVarInsn(ISTORE, 3);
            mv.visitVarInsn(ILOAD, 3); mv.visitLookupSwitchInsn(dflt, new int[] { 1, 3 }, new Label[] { a, c });
            mv.visitLabel(a); ret(mv, "A"); mv.visitLabel(c); ret(mv, "C"); mv.visitLabel(dflt); ret(mv, "D");
        }));
        assertEquals(ref("A", -1), r[5][2]);
        assertEquals(ref("C", -1), r[7][2]);
        assertEquals(ref("D", -1), r[0][2]);
    }

    @Test void givesUpOnWhatItCannotFollow() {
        IconRef[][] fieldRead = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, mv -> {
            mv.visitVarInsn(ALOAD, 0); mv.visitFieldInsn(GETFIELD, "test/Casing", "icons", "[Lnet/minecraft/util/IIcon;");
            mv.visitVarInsn(ILOAD, 2); mv.visitInsn(AALOAD); mv.visitInsn(ARETURN);
        }));
        assertNull(fieldRead[0][0]);
        assertNull(fieldRead[15][5]);
        IconRef[][] loop = CasingIconParser.parse(casing(CasingIconParser.SRG_NAME, mv -> {
            Label top = new Label(); mv.visitLabel(top); mv.visitJumpInsn(GOTO, top);
        }));
        assertNull(loop[4][2]);
        assertNull(CasingIconParser.parse(casing(null, null)));
    }
}
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && ./gradlew test --tests '*.textures.*')`
Expected: FAIL — compilation errors `cannot find symbol: class TexturePaths` / `CasingIconParser` / `IconRef`.

- [ ] **Step 3: Write `TexturePaths`, `IconRef`, `CasingIconParser`**, the `dependencies.gradle` lines and `addon.gradle` as specified.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && ./gradlew test --tests '*.textures.*') && ls exporter-mod/build/test-results/test/`
Expected: `BUILD SUCCESSFUL`; the listing contains `TEST-io.github.drukoz.gtnhplanner.export.textures.TexturePathsTest.xml` and `TEST-io.github.drukoz.gtnhplanner.export.textures.CasingIconParserTest.xml` (if Gradle says no tests ran, `addon.gradle` was not applied: move the `useJUnitPlatform()` line to the end of `dependencies.gradle` instead).

- [ ] **Step 5: Build and check reobfuscation**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.1.0 ./gradlew assemble) && exporter-mod/scripts/check-reobf.sh exporter-mod/build/libs/gtnhplannerexport-0.1.0.jar && unzip -l exporter-mod/build/libs/gtnhplannerexport-0.1.0.jar | grep -c 'org/objectweb'`
Expected: `BUILD SUCCESSFUL`, `reobf OK: <n> classes`, and `0` (ASM is not bundled).

- [ ] **Step 6: Commit**

```bash
git add exporter-mod/dependencies.gradle exporter-mod/addon.gradle exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/textures exporter-mod/src/test/java/io/github/drukoz/gtnhplanner/export/textures
git commit -m "feat(exporter): texture paths and casing getIcon parser with JUnit tests

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Exporter — `TextureFlattener` (GT texture trees to flat layers)

**Files:**
- Create: under `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/textures/`: `TextureEnv.java`, `LayerRec.java`, `TextureFlattener.java`
- Test: `exporter-mod/src/test/java/io/github/drukoz/gtnhplanner/export/textures/TextureFlattenerTest.java`

**Interfaces:**
- Consumes: `TexturePaths` (Task 4).
- Produces (no Minecraft or GT imports; GT classes are recognised by simple class name and read by reflection, research §3.5 A, so stand-ins with the same simple and field names test it):
  ```java
  public interface TextureEnv {
      String[] resource(Object o);      // {domain, path} when o is a ResourceLocation, else null
      String blockName(Object block);   // registry name when block is a Block, else null
  }
  public final class LayerRec {         // one DumpLayer of the textures.json.gz wire format (Task 6)
      public static LayerRec paths(List<String> candidates, int[] rgb /* null = untinted */, boolean glow);
      public static LayerRec textureSet(String base, String baseFallback, String overlay, String overlayFallback, int[] rgb);   // null parts allowed
      public static LayerRec copy(String block, int meta, int side);
      public static LayerRec error(String className);
      public void write(com.google.gson.stream.JsonWriter w) throws java.io.IOException;
      // equals, hashCode, toString
  }
  public final class TextureFlattener {
      public TextureFlattener(TextureEnv env);
      public List<LayerRec> flatten(Object texture, int side);                   // an ITexture, ITexture[] or null, drawn on side 0..5; never throws
      public List<LayerRec> container(Object iconContainer, int[] rgb, boolean glow);
      public Map<String, Integer> unknownClasses();                               // class name → times seen
  }
  ```

Rules (field names checked with `javap -p` against the pack's GT jar while writing this plan):
- `LayerRec.write`: `{"p":[…],"rgb":[r,g,b],"glow":1}` (rgb and glow only when set) · `{"ts":[base,baseFallback,overlay,overlayFallback],"rgb":[…]}` (missing parts as `""`) · `{"copy":[block,meta,side]}` · `{"err":"<class>"}`.
- Dispatch walks the object's class and superclasses and uses the first simple name that matches:
  - arrays → each element in order.
  - `GTMultiTextureRender` → field `mTextures`, each element in order.
  - `GTSidedTextureRender` → `mTextures[side]`; if that element is an icon container rather than a texture, `container(element, rgb(mRGBa), false)`.
  - `GTRenderedTexture` → `container(mIconContainer, rgb(mRGBa), glow)`.
  - `GTCopiedBlockTextureRender`, `GTCopiedCTMBlockTexture` → `copy(env.blockName(mBlock), mMeta, mSide == 6 ? side : mSide)` (GT draws the render side when `mSide` is 6, `javap -c` of `getIcon(int, ISBRContext)`).
  - Containers: names starting `GTTextureSet` → `textureSet(iconResource, iconFallbackResource, iconOverlayResource, iconOverlayFallbackResource, rgb)`; `GTCustomAlphaFallbackBlockIconContainer` → `paths([iconResource, …the fallback container's base candidates], rgb, glow)` plus `paths([overlayResource], null, glow)` when set; names starting `GTCustom` → `paths([iconResource], rgb, glow)` plus `paths([overlayResource], null, glow)` when set; `InvisibleIcon` → nothing; any class with a field `iconResource` → `paths([iconResource], rgb, glow)`; any class with a `String` field `mIconName` → `paths([fromIconName((mModID ?? "gregtech") + ":" + mIconName, "blocks")], rgb, glow)` (GT++ `TexturesGtBlock$CustomIcon`).
  - A resolved path ending in `/VOID.png` or `/RENDERING_ERROR.png` is dropped (GT draws nothing or an error mark there).
  - Anything else → `error(className)` and `unknownClasses` +1.
- Resources become paths with `TexturePaths.fromResource(domain, path, "blocks")`. `rgb(mRGBa)` is `null` when the array is null or its first three values are all 255 (GT's tint is a multiply with alpha ignored, research §2.5).
- Fields are found on the class or a superclass, made accessible once and cached per (class, name); a failed read counts as a missing field.

- [ ] **Step 1: Write the failing test**

`TextureFlattenerTest.java`:

```java
package io.github.drukoz.gtnhplanner.export.textures;

import static org.junit.jupiter.api.Assertions.*;
import com.google.gson.stream.JsonWriter;
import java.io.StringWriter;
import java.util.*;
import org.junit.jupiter.api.Test;

class TextureFlattenerTest {
    // Stand-ins: same simple names and field names as GT's classes.
    static final class FakeLocation { final String d, p; FakeLocation(String d, String p) { this.d = d; this.p = p; } }
    static final class FakeBlock { final String name; FakeBlock(String n) { name = n; } }
    static class GTBlockIconContainer { final String mIconName = "x"; final Object iconResource; GTBlockIconContainer(String path) { iconResource = path == null ? null : new FakeLocation("gregtech", path); } }
    static final class GTOptionalBlockIconContainer extends GTBlockIconContainer { GTOptionalBlockIconContainer(String p) { super(p); } }
    static final class GTCustomBlockIconContainer { final Object iconResource, overlayResource; GTCustomBlockIconContainer(Object i, Object o) { iconResource = i; overlayResource = o; } }
    static final class GTCustomAlphaFallbackBlockIconContainer { final Object iconResource, overlayResource, fallback; GTCustomAlphaFallbackBlockIconContainer(Object i, Object o, Object f) { iconResource = i; overlayResource = o; fallback = f; } }
    static final class GTTextureSetItemIconContainer { final Object iconResource, iconFallbackResource, iconOverlayResource, iconOverlayFallbackResource;
        GTTextureSetItemIconContainer(String set, String suffix) { iconResource = loc(set, suffix); iconFallbackResource = loc("NONE", suffix); iconOverlayResource = loc(set, suffix + "_OVERLAY"); iconOverlayFallbackResource = loc("NONE", suffix + "_OVERLAY"); }
        static FakeLocation loc(String set, String s) { return new FakeLocation("gregtech", "textures/items/materialicons/" + set + "/" + s + ".png"); } }
    static final class InvisibleIcon {}
    static final class CustomIcon { final String mIconName, mModID; CustomIcon(String n, String m) { mIconName = n; mModID = m; } }
    static final class GTRenderedTexture { final Object mIconContainer; final short[] mRGBa; final boolean glow; GTRenderedTexture(Object c, short[] rgba, boolean g) { mIconContainer = c; mRGBa = rgba; glow = g; } }
    static final class GTMultiTextureRender { final Object[] mTextures; GTMultiTextureRender(Object... t) { mTextures = t; } }
    static final class GTSidedTextureRender { final Object[] mTextures; final short[] mRGBa = { 255, 255, 255, 0 }; GTSidedTextureRender(Object... t) { mTextures = t; } }
    static final class GTCopiedBlockTextureRender { final Object mBlock; final byte mSide; final int mMeta; GTCopiedBlockTextureRender(Object b, int s, int m) { mBlock = b; mSide = (byte) s; mMeta = m; } }

    static final TextureEnv ENV = new TextureEnv() {
        public String[] resource(Object o) { return o instanceof FakeLocation ? new String[] { ((FakeLocation) o).d, ((FakeLocation) o).p } : null; }
        public String blockName(Object b) { return b instanceof FakeBlock ? ((FakeBlock) b).name : null; }
    };
    static final String SIDE = "textures/blocks/iconsets/MACHINE_LV_SIDE.png", FRONT = "textures/blocks/basicmachines/macerator/OVERLAY_FRONT.png";
    static final short[] WHITE = { 255, 255, 255, 0 };
    static LayerRec p(String path, int[] rgb, boolean glow) { return LayerRec.paths(Collections.singletonList("gregtech/" + path), rgb, glow); }
    static GTRenderedTexture tex(String path) { return new GTRenderedTexture(new GTBlockIconContainer(path), WHITE, false); }

    @Test void renderedAndMultiTextures() {
        TextureFlattener f = new TextureFlattener(ENV);
        assertEquals(Collections.singletonList(p(SIDE, null, false)), f.flatten(tex(SIDE), 2));
        Object multi = new GTMultiTextureRender(tex(SIDE), new GTRenderedTexture(new GTOptionalBlockIconContainer(FRONT), new short[] { 200, 100, 50, 0 }, true));
        assertEquals(Arrays.asList(p(SIDE, null, false), p(FRONT, new int[] { 200, 100, 50 }, true)), f.flatten(multi, 2));
        assertEquals(Collections.singletonList(p(SIDE, null, false)), f.flatten(new Object[] { null, tex(SIDE) }, 0));
    }

    @Test void sidedAndCopiedTextures() {
        TextureFlattener f = new TextureFlattener(ENV);
        Object sided = new GTSidedTextureRender(tex("textures/blocks/iconsets/B.png"), tex("textures/blocks/iconsets/T.png"), tex(SIDE), tex(SIDE), tex(SIDE), tex(SIDE));
        assertEquals(Collections.singletonList(p("textures/blocks/iconsets/T.png", null, false)), f.flatten(sided, 1));
        FakeBlock casings2 = new FakeBlock("gregtech:gt.blockcasings2");
        assertEquals(Collections.singletonList(LayerRec.copy("gregtech:gt.blockcasings2", 0, 4)), f.flatten(new GTCopiedBlockTextureRender(casings2, 6, 0), 4));
        assertEquals(Collections.singletonList(LayerRec.copy("gregtech:gt.blockcasings2", 0, 1)), f.flatten(new GTCopiedBlockTextureRender(casings2, 1, 0), 4));
    }

    @Test void iconContainers() {
        TextureFlattener f = new TextureFlattener(ENV);
        String m = "gregtech/textures/items/materialicons/";
        assertEquals(Collections.singletonList(LayerRec.textureSet(m + "METALLIC/ingot.png", m + "NONE/ingot.png", m + "METALLIC/ingot_OVERLAY.png", m + "NONE/ingot_OVERLAY.png", new int[] { 200, 200, 200 })),
            f.container(new GTTextureSetItemIconContainer("METALLIC", "ingot"), new int[] { 200, 200, 200 }, false));
        FakeLocation a = new FakeLocation("gregtech", "textures/blocks/a.png"), b = new FakeLocation("gregtech", "textures/blocks/b.png");
        assertEquals(Arrays.asList(LayerRec.paths(Collections.singletonList("gregtech/textures/blocks/a.png"), null, false), LayerRec.paths(Collections.singletonList("gregtech/textures/blocks/b.png"), null, false)),
            f.container(new GTCustomBlockIconContainer(a, b), null, false));
        assertEquals(Collections.singletonList(LayerRec.paths(Arrays.asList("gregtech/textures/blocks/a.png", "gregtech/" + SIDE), null, false)),
            f.container(new GTCustomAlphaFallbackBlockIconContainer(a, null, new GTBlockIconContainer(SIDE)), null, false));
        assertEquals(Collections.singletonList(LayerRec.paths(Collections.singletonList("miscutils/textures/blocks/TileEntities/MACHINE_CASING_X.png"), null, false)),
            f.container(new CustomIcon("TileEntities/MACHINE_CASING_X", "miscutils"), null, false));
        assertEquals(Collections.emptyList(), f.container(new InvisibleIcon(), null, false));
        assertEquals(Collections.emptyList(), f.container(new GTBlockIconContainer("textures/blocks/iconsets/VOID.png"), null, false));
    }

    @Test void unknownClassesBecomeErrors() {
        TextureFlattener f = new TextureFlattener(ENV);
        assertEquals(Collections.singletonList(LayerRec.error("java.lang.Object")), f.flatten(new Object(), 0));
        assertEquals(Collections.singletonMap("java.lang.Object", 1), f.unknownClasses());
    }

    @Test void writesTheWireFormat() throws Exception {
        assertEquals("{\"p\":[\"a.png\",\"b.png\"],\"rgb\":[1,2,3],\"glow\":1}", json(LayerRec.paths(Arrays.asList("a.png", "b.png"), new int[] { 1, 2, 3 }, true)));
        assertEquals("{\"ts\":[\"a\",\"b\",\"\",\"\"]}", json(LayerRec.textureSet("a", "b", null, null, null)));
        assertEquals("{\"copy\":[\"gregtech:gt.blockcasings2\",0,4]}", json(LayerRec.copy("gregtech:gt.blockcasings2", 0, 4)));
        assertEquals("{\"err\":\"x.Y\"}", json(LayerRec.error("x.Y")));
    }
    static String json(LayerRec r) throws Exception { StringWriter s = new StringWriter(); JsonWriter w = new JsonWriter(s); r.write(w); w.flush(); return s.toString(); }
}
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && ./gradlew test --tests '*.TextureFlattenerTest')`
Expected: FAIL — compilation errors `cannot find symbol: class TextureFlattener` / `LayerRec` / `TextureEnv`.

- [ ] **Step 3: Write `TextureEnv`, `LayerRec`, `TextureFlattener`** as specified.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && ./gradlew test --tests '*.textures.*')`
Expected: `BUILD SUCCESSFUL`, and `exporter-mod/build/test-results/test/` now also has `TEST-…TextureFlattenerTest.xml` with `failures="0"`.

- [ ] **Step 5: Commit**

```bash
git add exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/textures exporter-mod/src/test/java/io/github/drukoz/gtnhplanner/export/textures
git commit -m "feat(exporter): flatten GT texture trees into layer records

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Exporter — `TextureExporter` section writes `textures.json.gz`

**Files:**
- Create: under `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/textures/`: `McTextureEnv.java`, `TextureExporter.java`
- Modify: `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/Exporter.java` (`sections()` appends `new TextureExporter()` last)

**Interfaces:**
- Consumes: Plan 1 Task 9 `ExportSection`, `ExportContext` (`gzipJson`, `warn`), `Exporter.sections()`; `TexturePaths`, `IconRef`, `CasingIconParser` (Task 4); `TextureEnv`, `LayerRec`, `TextureFlattener` (Task 5).
- Produces:
  - `final class McTextureEnv implements TextureEnv` (real `ResourceLocation` / block registry) with `static byte[] classBytes(Class<?> c)` (raw bytes through `c.getClassLoader().getResourceAsStream(<internal name> + ".class")`; on a dedicated server these still contain the client-only `getIcon` that FML strips from the loaded class; `null` when absent).
  - `public final class TextureExporter implements ExportSection` — `name()` = `"textures"`, `optional()` = `true` (a failing texture dump never fails the recipe export; Plan 1 records it in `failedSections`; `-Dgtnhplanner.skipSections=textures` skips it).
  - The file `textures.json.gz` in the export dir, written through `ctx.gzipJson("textures.json.gz")`. Wire format (TypeScript notation; Task 7 copies these types verbatim):
    ```ts
    export type DumpLayer =
      | { p: string[]; rgb?: [number, number, number]; glow?: 1 }                  // candidate data/assets-relative paths, first extracted one wins
      | { ts: [string, string, string, string]; rgb?: [number, number, number] }   // GT texture set: base, base fallback, overlay, overlay fallback ('' = none)
      | { copy: [string, number, number] }                                         // looks like block <registry name> meta <m> on face <side 0..5>
      | { err: string };                                                           // texture class the exporter could not read
    export type DumpFaces = DumpLayer[][];                                         // 6 lists, ForgeDirection order
    export interface TexturesDumpFile {
      format: 'gtnh-planner-textures/1'; exporterVersion: string;
      sets: Array<{ name: string; icons: Record<string /* texture index */, DumpLayer[]> }>;
      materials: Array<{ name: string; id: number /* mMetaItemSubID */; rgba: [number, number, number, number]; set: number /* index into sets */ }>;
      metaItems: Array<{ id: string /* registry name */; offset: number; unlocalized: string; prefixes: Array<{ i: number /* meta / 1000 */; prefix: string; texture: number }> }>;
      mte: Array<{ id: number; cls: string; pipe?: true; inactive?: DumpFaces; active?: DumpFaces /* omitted when equal to inactive */; error?: string }>;
      casingPages: Array<{ id: number /* page << 7 | index */; faces: DumpFaces }>;
      blocks: Array<{ id: string; metas: Record<string /* meta */, DumpFaces> }>;
      covers: Array<{ item: string /* registry@meta */; layers: DumpLayer[] }>;
      fluids: Array<{ name: string; color: number /* Fluid.getColor(), 0xAARRGGBB as a signed int */; still?: string }>;
      textureNames: { blocks: Record<string, string>; items: Record<string, string> };   // registry name → Block.textureName / Item.iconString
      blockIds: string[];                                                            // every block registry name, sorted
      stats: Record<string, number>;                                                 // counts per part, '<part>Failed', 'unknown:<class>'
    }
    ```

What `export(ctx)` writes, part by part (each element is computed fully before it is written, inside its own `try { … } catch (Throwable t)`; a failed element is left out, counted in `stats`, and the first 20 per part go into one `ctx.warn("textures <part>: …")`):
1. `format`, `exporterVersion` (`Tags.VERSION`).
2. `sets` and `materials` (research §6.1): `Materials.getAll()`, one entry per distinct `mName`: `{name: mName, id: mMetaItemSubID, rgba: mRGBa as 4 ints, set}`; each distinct `mIconSet` object (identity, so `withCustomTextures` sets stay apart) gets the next `sets` index with `{name: mSetName, icons}`, where `icons[i]` = `flattener.container(mTextures[i], null, false)` for every non-null slot whose result is not empty (`/void` slots flatten to nothing).
3. `metaItems` (§6.1–§6.2): every item in the item registry (iterate as Plan 1's `ItemTable.seed()` does) that is a `gregtech.api.items.MetaGeneratedItem`: `{id: registry name, offset: mOffset, unlocalized: item.getUnlocalizedName(), prefixes}`; for `MetaGeneratedItemX32`, `prefixes` lists each non-null slot of the protected `mGeneratedPrefixList` (reflection) as `{i, prefix: name(), texture: getTextureIndex()}`, else `[]`.
4. `mte` (§3.5 A): for every non-null `GregTechAPI.METATILEENTITIES[id]`, `id ≥ 1`: a `MetaPipeEntity` gets `new BaseMetaPipeEntity()`, `setInitialValuesAsNBT(new NBTTagCompound(), (short) id)` and `mConnections = 63` (drawn connected on all sides); anything else gets `new BaseMetaTileEntity()`, `setInitialValuesAsNBT(nbt, (short) id)` with `nbt` bytes `mFacing = 2` and `mMainFacing = 2` (front on north, the canonical orientation of Global Constraints), then `setFrontFacing(ForgeDirection.NORTH)` in its own ignored `try`. For `active` in `false, true` (`setActive`; pipes only `false`): faces = `flatten(te.getTexture(GregTechAPI.sBlockMachines, ForgeDirection.getOrientation(side)), side)` for sides 0..5. A failure writes `{id, cls, error: t.toString()}`.
5. `casingPages` (§3.6): every non-null `Textures.BlockIcons.casingTexturePages[page][index]` → `{id: page << 7 | index, faces: flatten(texture, side) for sides 0..5}`.
6. `blocks` (§3.7): for every registered block, walk its class and superclasses (stop before `net.minecraft.*`) until `CasingIconParser.parse(McTextureEnv.classBytes(c))` is non-null (cache per class). Each `IconRef` resolves by reflection — `Class.forName(owner with '.', false, the block class's loader)`, declared field made accessible, `get(null)`, then `Array.get` for `index ≥ 0` within bounds — and becomes `flattener.container(value, null, false)` (cache per `IconRef`). Write `{id, metas}` with only the metas that have at least one non-empty face, and only blocks that have such a meta.
7. `covers` (§3.8): the private static `CoverRegistry.covers` map (reflection): `{item: <registry name of mItem>@<mMetaData>, layers: flatten(registration.getCoverTexture(), 2)}`.
8. `fluids` (§6.3): every `FluidRegistry.getRegisteredFluids()` value: `{name: getName(), color: getColor()}`, plus `still` for a `GTFluid`: its private `stillIconResourceLocation`, or when that is null, the one of its private `iconsFrom` fluid if that is a `GTFluid`; converted with `TexturePaths.fromResource(domain, path, "blocks")` (gives `gregtech/textures/blocks/fluids/fluid.<name>.png`).
9. `textureNames` (§6.4): `ReflectionHelper.getPrivateValue(Block.class, block, "textureName", "field_149768_d")` and `ReflectionHelper.getPrivateValue(Item.class, item, "iconString", "field_111218_cA")`; null values and values starting `MISSING_ICON_` are left out.
10. `blockIds`, then `stats` (including `flattener.unknownClasses()` as `unknown:<class>`; when it is not empty, one `ctx.warn` with the ten most frequent).

- [ ] **Step 1: Check the GT members this task uses** (variables from Plan 1 "Conventions for every task"; every member was also checked read-only against the pack's own GT jar while writing this plan)

Run:
```bash
javap -cp "$GTDEV" -p gregtech.api.metatileentity.BaseMetaTileEntity gregtech.api.metatileentity.BaseMetaPipeEntity | grep -oE 'BaseMeta(Tile|Pipe)Entity\(\);|setInitialValuesAsNBT\(net.minecraft.nbt.NBTTagCompound, short\)|getTexture\(net.minecraft.block.Block, net.minecraftforge.common.util.ForgeDirection\)|void setActive\(boolean\)|void setFrontFacing\(net.minecraftforge.common.util.ForgeDirection\)|byte mConnections' | sort -u | wc -l
javap -cp "$GTDEV" -p 'gregtech.api.enums.Textures$BlockIcons' gregtech.api.enums.Materials gregtech.api.enums.TextureSet gregtech.api.items.MetaGeneratedItem gregtech.api.items.MetaGeneratedItemX32 gregtech.api.enums.OrePrefixes gregtech.common.fluid.GTFluid gregtech.api.covers.CoverRegistry gregtech.api.covers.CoverRegistration gregtech.api.objects.GTItemStack | grep -oE 'ITexture\[\]\[\] casingTexturePages|Collection<gregtech.api.enums.Materials> getAll\(\)|short\[\] mRGBa|TextureSet mIconSet|int mMetaItemSubID|String mName;|IIconContainer\[\] mTextures|String mSetName|short mOffset|OrePrefixes\[\] mGeneratedPrefixList|int getTextureIndex\(\)|ResourceLocation stillIconResourceLocation|Fluid iconsFrom|CoverRegistration> covers|ITexture getCoverTexture\(\)|Item mItem|short mMetaData' | sort -u | wc -l
javap -cp "$GTDEV" -p gregtech.common.render.GTRenderedTexture gregtech.common.render.GTMultiTextureRender gregtech.common.render.GTSidedTextureRender gregtech.common.render.GTCopiedBlockTextureRender gregtech.common.render.GTCopiedCTMBlockTexture gregtech.client.iconContainers.blocks.GTBlockIconContainer gregtech.client.iconContainers.blocks.GTCustomBlockIconContainer gregtech.client.iconContainers.blocks.GTCustomAlphaFallbackBlockIconContainer gregtech.client.iconContainers.items.GTTextureSetItemIconContainer 'gtPlusPlus.xmod.gregtech.common.blocks.textures.TexturesGtBlock$CustomIcon' | grep -oE ' (mIconContainer|mRGBa|glow|mTextures|mBlock|mSide|mMeta|iconResource|overlayResource|fallback|iconFallbackResource|iconOverlayResource|iconOverlayFallbackResource|mIconName|mModID);' | sort -u | wc -l
javap -c -p -constants -cp "$GTDEV" gregtech.api.metatileentity.implementations.MTEBasicMachine | grep -c 'String mMainFacing'
```
Expected: `7`, `17`, `15`, `2`.

- [ ] **Step 2: Write `McTextureEnv` and `TextureExporter`, and append `new TextureExporter()` to `Exporter.sections()`** as specified (Minecraft and Forge members are called directly so reobfuscation renames them; GT members directly where public, by reflection where private or protected).

- [ ] **Step 3: Build, run the helper tests, check reobfuscation**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.1.0 ./gradlew test assemble) && exporter-mod/scripts/check-reobf.sh exporter-mod/build/libs/gtnhplannerexport-0.1.0.jar`
Expected: `BUILD SUCCESSFUL`, `reobf OK: <n> classes`.

- [ ] **Step 4: Check that the vanilla calls were renamed**

Run: `javap -c -p -cp exporter-mod/build/libs/gtnhplannerexport-0.1.0.jar io.github.drukoz.gtnhplanner.export.textures.McTextureEnv io.github.drukoz.gtnhplanner.export.textures.TextureExporter | grep -oE 'Method net/minecraft/[A-Za-z/]+\.[A-Za-z0-9_]+' | sort -u`
Expected: only SRG names, including `net/minecraft/util/ResourceLocation.func_110624_b`, `net/minecraft/util/ResourceLocation.func_110623_a`, `net/minecraft/nbt/NBTTagCompound.func_74774_a` and `net/minecraft/item/Item.func_77658_a`.

- [ ] **Step 5: Commit**

```bash
git add exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export
git commit -m "feat(exporter): texture dump section (materials, meta items, machine faces, casings, covers, fluids)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

The section runs for real in Task 15 (`npm run export` on the APFS clone, never the live server).

### Task 7: `textures.json.gz` loader joined to the asset index

**Files:**
- Create: `src/server/assets/textures-dump.ts`, `tests/helpers/textures-dump.ts`, `tests/helpers/assets-dir.ts`
- Test: `tests/unit/assets/textures-dump.test.ts`

**Interfaces:**
- Consumes: the wire format of Task 6 (copy `DumpLayer`, `DumpFaces`, `TexturesDumpFile` verbatim into `textures-dump.ts`); `AssetIndex`, `assetIndexFrom`, `AssetIndexFile`, `ASSET_INDEX_FORMAT` (Task 2); `TextureLayer`, `Rgb` (Task 1); `makePng`, `Rgba` (Task 1).
- Produces:
  - `src/server/assets/textures-dump.ts`:
    ```ts
    export const TEXTURES_FILE = 'textures.json.gz';
    export const TEXTURES_FORMAT = 'gtnh-planner-textures/1';
    export type DumpLayer = …; export type DumpFaces = …; export interface TexturesDumpFile { … }   // verbatim from Task 6
    export interface CopyRef { copy: [string, number, number] }               // block registry name, meta, side
    export type FaceLayer = TextureLayer | CopyRef;
    export type ResolvedFaces = FaceLayer[][];                                 // 6 lists, ForgeDirection order
    export interface DumpMte { cls: string; pipe: boolean; inactive: ResolvedFaces | null; active: ResolvedFaces | null; error?: string }
    export interface DumpMaterial { name: string; id: number; rgb: Rgb; set: number }
    export interface DumpStats { droppedLayers: number; errorLayers: number }
    export interface TexturesDump {
      exporterVersion: string;
      sets: Array<Map<number, DumpLayer[]>>;                                  // raw: the tint comes from the material at lookup time (Task 8)
      materialsById: Map<number, DumpMaterial>; materialsByName: Map<string, DumpMaterial>;
      metaItems: Map<string, { offset: number; unlocalized: string; prefixes: Map<number, { prefix: string; texture: number }> }>;
      mte: Map<number, DumpMte>; casingPages: Map<number, ResolvedFaces>; blocks: Map<string, Map<number, ResolvedFaces>>;
      covers: Map<string, FaceLayer[]>; fluids: Map<string, { color: Rgb; still: TextureLayer | null }>;
      textureNames: { blocks: Map<string, string>; items: Map<string, string> }; blockIds: Set<string>; stats: DumpStats;
    }
    export class TexturesDumpError extends Error {}
    export function textureSetLayers(ts: readonly [string, string, string, string], rgb: Rgb | undefined, index: AssetIndex): TextureLayer[];
    export function resolveDumpLayers(layers: readonly DumpLayer[], index: AssetIndex, stats: DumpStats): FaceLayer[];
    export function buildTexturesDump(file: TexturesDumpFile, index: AssetIndex): TexturesDump;
    export function loadTexturesDump(exportDir: string, index: AssetIndex): Promise<TexturesDump | null>;
    ```
  - `tests/helpers/assets-dir.ts`: `export type AssetSpec = Record<string /* data/assets-relative path */, { w?: number; h?: number; frames?: number; color?: Rgba }>` (defaults 16×16, colour `[128, 128, 128, 255]`); `export function indexFileOf(spec: AssetSpec): AssetIndexFile`; `export function indexOf(spec: AssetSpec): AssetIndex` (in memory); `export function writeAssetsDir(dataDir: string, spec: AssetSpec): Promise<AssetIndex>` (writes every PNG with `makePng` and `index.json` under `<dataDir>/assets`).
  - `tests/helpers/textures-dump.ts`: `export function dumpFile(part?: Partial<TexturesDumpFile>): TexturesDumpFile` (format, `exporterVersion: 'test'`, empty arrays and maps, then `part`); `export function writeTexturesDump(exportDir: string, file: TexturesDumpFile): Promise<void>` (creates `exportDir` if needed, writes gzip'd JSON to `<exportDir>/textures.json.gz`).

Rules the signatures do not fix:
- `textureSetLayers` replays GT's client rule (research §6.1): base = `ts[0]` if extracted (override) else `ts[1]` if extracted (fallback) else none; overlay likewise from `ts[2]`/`ts[3]`; an override base drops a fallback overlay, a fallback base drops an override overlay; the base gets `rgb` as tint, the overlay none. Empty strings never match.
- `resolveDumpLayers`: `p` → `index.firstLayer(p, { tint: rgb, glow: glow === 1 })`, else `droppedLayers + 1`; `ts` → `textureSetLayers` (none left → `droppedLayers + 1`); `copy` → kept as a `CopyRef` (resolved by Task 10, which knows the other tables); `err` → `errorLayers + 1`.
- `buildTexturesDump`: every face list goes through `resolveDumpLayers` once; an MTE without `active` reuses its resolved `inactive`; an MTE with `error` keeps `inactive: null, active: null`; fluid `color` is the signed ARGB int → `[(c >> 16) & 255, (c >> 8) & 255, c & 255]` and `still` = `index.layer(still, { tint: color })` (white is no tint, Task 2).
- `loadTexturesDump`: `null` when `textures.json.gz` is missing, or when `<exportDir>/manifest.json` lists `textures` in `failedSections` or `skippedSections` (a failed section can leave a truncated file); gunzip or JSON errors and a `format` other than `TEXTURES_FORMAT` → `TexturesDumpError` naming the file.

- [ ] **Step 1: Write the failing test**

`tests/unit/assets/textures-dump.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { indexOf } from '../../helpers/assets-dir.ts';
import { dumpFile, writeTexturesDump } from '../../helpers/textures-dump.ts';
import { buildTexturesDump, loadTexturesDump, textureSetLayers, TexturesDumpError } from '../../../src/server/assets/textures-dump.ts';

const I = 'gregtech/textures/blocks/iconsets/';
const M = 'gregtech/textures/items/materialicons/';
const FLUID = 'gregtech/textures/blocks/fluids/fluid.water.png';
const ix = indexOf({ [I + 'MACHINE_LV_SIDE.png']: {}, [I + 'MACHINE_LV_TOP.png']: {}, [M + 'METALLIC/ingot.png']: {}, [M + 'NONE/ingot.png']: {},
  [M + 'NONE/ingot_OVERLAY.png']: {}, [M + 'NONE/gearGt.png']: {}, [M + 'NONE/dust.png']: {}, [M + 'SHINY/dust_OVERLAY.png']: {}, [FLUID]: { w: 16, h: 64, frames: 4 } });
const ts = (set: string, s: string): [string, string, string, string] => [`${M}${set}/${s}.png`, `${M}NONE/${s}.png`, `${M}${set}/${s}_OVERLAY.png`, `${M}NONE/${s}_OVERLAY.png`];

const FILE = dumpFile({
  mte: [
    { id: 301, cls: 'MTEBasicMachineWithRecipe', inactive: [
      [{ p: [I + 'MACHINE_LV_BOTTOM.png'] }], [{ p: [I + 'MACHINE_LV_TOP.png'] }],
      [{ p: [I + 'MACHINE_LV_SIDE.png'] }, { p: [I + 'NOT_EXTRACTED.png'] }], [{ p: [I + 'MACHINE_LV_SIDE.png'] }],
      [{ p: [I + 'MACHINE_LV_SIDE.png'] }], [{ err: 'x.Unknown' }, { copy: ['gregtech:gt.blockcasings2', 0, 5] }]] },
    { id: 999, cls: 'Broken', error: 'java.lang.NullPointerException' },
  ],
  fluids: [{ name: 'water', color: -16776961, still: FLUID }, { name: 'oil', color: -14540254 }],
});

describe('texture-set rule (research §6.1)', () => {
  it('keeps override and fallback pairs the way GT draws them', () => {
    expect(textureSetLayers(ts('METALLIC', 'ingot'), [200, 200, 200], ix)).toEqual([{ path: M + 'METALLIC/ingot.png', tint: [200, 200, 200] }]);
    expect(textureSetLayers(ts('METALLIC', 'gearGt'), [200, 200, 200], ix)).toEqual([{ path: M + 'NONE/gearGt.png', tint: [200, 200, 200] }]);
    expect(textureSetLayers(ts('SHINY', 'dust'), [1, 2, 3], ix)).toEqual([{ path: M + 'SHINY/dust_OVERLAY.png' }]);
    expect(textureSetLayers(ts('DULL', 'ingot'), [1, 2, 3], ix)).toEqual([{ path: M + 'NONE/ingot.png', tint: [1, 2, 3] }, { path: M + 'NONE/ingot_OVERLAY.png' }]);
    expect(textureSetLayers(ts('DULL', 'plate'), [1, 2, 3], ix)).toEqual([]);
  });
});

describe('buildTexturesDump', () => {
  it('drops dump layers whose file was not extracted', () => {
    const d = buildTexturesDump(FILE, ix);
    const m = d.mte.get(301)!;
    expect(m.inactive![0]).toEqual([]);
    expect(m.inactive![2]).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }]);
    expect(m.inactive![5]).toEqual([{ copy: ['gregtech:gt.blockcasings2', 0, 5] }]);
    expect(m.active).toEqual(m.inactive);
    expect(d.mte.get(999)).toEqual({ cls: 'Broken', pipe: false, inactive: null, active: null, error: 'java.lang.NullPointerException' });
    expect(d.stats).toEqual({ droppedLayers: 2, errorLayers: 1 });
  });

  it('turns fluid colours into RGB and tints the still texture', () => {
    const d = buildTexturesDump(FILE, ix);
    expect(d.fluids.get('water')).toEqual({ color: [0, 0, 255], still: { path: FLUID, tint: [0, 0, 255], frames: 4 } });
    expect(d.fluids.get('oil')).toEqual({ color: [34, 34, 34], still: null });
  });
});

describe('loadTexturesDump', () => {
  it('loads the file, ignores a missing or failed dump, rejects anything else', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-td-'));
    expect(await loadTexturesDump(dir, ix)).toBeNull();
    await writeTexturesDump(dir, FILE);
    expect((await loadTexturesDump(dir, ix))!.mte.size).toBe(2);
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ failedSections: ['textures'], skippedSections: [] }));
    expect(await loadTexturesDump(dir, ix)).toBeNull();
    await writeFile(join(dir, 'manifest.json'), JSON.stringify({ failedSections: [], skippedSections: [] }));
    await writeTexturesDump(dir, { ...FILE, format: 'other/1' as never });
    await expect(loadTexturesDump(dir, ix)).rejects.toBeInstanceOf(TexturesDumpError);
    await writeFile(join(dir, 'textures.json.gz'), 'not gzip');
    await expect(loadTexturesDump(dir, ix)).rejects.toBeInstanceOf(TexturesDumpError);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/assets/textures-dump.test.ts`
Expected: FAIL — missing modules `src/server/assets/textures-dump.ts`, `tests/helpers/assets-dir.ts`, `tests/helpers/textures-dump.ts`.

- [ ] **Step 3: Implement `textures-dump.ts` and the two helpers** as specified.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/assets/textures-dump.test.ts && npm run typecheck`
Expected: PASS (`Test Files  1 passed`), typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/assets/textures-dump.ts tests/helpers/textures-dump.ts tests/helpers/assets-dir.ts tests/unit/assets/textures-dump.test.ts
git commit -m "feat(assets): load the exporter's texture dump against the extracted files

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: GT machine faces, casings, covers, material and meta-item icons, GT fluids

**Files:**
- Create: `src/server/assets/gt-faces.ts`, `tests/helpers/gt-sample.ts`
- Test: `tests/unit/assets/gt-faces.test.ts`

**Interfaces:**
- Consumes: `TexturesDump`, `ResolvedFaces`, `FaceLayer`, `DumpLayer`, `textureSetLayers`, `buildTexturesDump` (Task 7); `AssetIndex` (Task 2); `FACES`, `Face`, `TextureLayer`, `Rgb` (Task 1); `parseItemKey`, `ItemKey` (Plan 1); `dumpFile`, `indexOf`, `AssetSpec` (Task 7 helpers).
- Produces:
  - `src/server/assets/gt-faces.ts`:
    ```ts
    export type CopyResolver = (block: string, meta: number, side: number) => TextureLayer[];   // supplied by Task 10, which owns the cycle guard
    export function facesFrom(faces: ResolvedFaces, copy: CopyResolver): Record<Face, TextureLayer[]>;   // CopyRefs replaced by copy(...)
    export function gtMachineFaces(dump: TexturesDump, mteId: number, copy: CopyResolver, active?: boolean): Record<Face, TextureLayer[]> | null;   // canonical, front on north
    export function gtBlockFaces(dump: TexturesDump, id: string, meta: number, copy: CopyResolver): Record<Face, TextureLayer[]> | null;
    export function casingFaces(dump: TexturesDump, casingId: number, copy: CopyResolver): Record<Face, TextureLayer[]> | null;
    export function coverLayers(dump: TexturesDump, item: ItemKey, copy: CopyResolver): TextureLayer[] | null;
    export function gtItemIcon(dump: TexturesDump, index: AssetIndex, key: ItemKey): TextureLayer[] | null;
    export function gtFluidIcon(dump: TexturesDump, name: string): { layers: TextureLayer[]; color: Rgb } | null;
    ```
  - `tests/helpers/gt-sample.ts`: `export const I = 'gregtech/textures/blocks/iconsets/'`, `export const BM = 'gregtech/textures/blocks/basicmachines/macerator/'`, `export const MI = 'gregtech/textures/items/materialicons/'`, `export const GT_SAMPLE_ASSETS: AssetSpec`, `export function gtSampleFile(): TexturesDumpFile`, `export function gtSample(): { index: AssetIndex; dump: TexturesDump }` (used again by Tasks 10, 12 and 16). Content:
    - assets: `I` + `MACHINE_LV_SIDE` (colour `[150,150,160,255]`), `MACHINE_LV_TOP`, `MACHINE_LV_BOTTOM`, `MACHINE_CASING_SOLID_STEEL` (`[180,180,180,255]`), `OVERLAY_PIPE_IN`, `OVERLAY_CONVEYOR`; `BM` + `OVERLAY_FRONT` (`[40,40,40,255]`), `OVERLAY_FRONT_ACTIVE` and `OVERLAY_FRONT_ACTIVE_GLOW` (16×64, 4 frames); `MI` + `METALLIC/ingot`, `NONE/ingot`, `NONE/ingot_OVERLAY`, `NONE/dust`; `gregtech/textures/items/gt.metaitem.01/606`; `gregtech/textures/blocks/fluids/fluid.water` (16×64, 4 frames) — all `.png`, 16×16 unless stated.
    - dump: set 0 `METALLIC` with icons `11` (ingot) and `2` (dust) as `ts` quadruples (`<set>/<suffix>`, `NONE/<suffix>`, `<set>/<suffix>_OVERLAY`, `NONE/<suffix>_OVERLAY`); material `Iron` id 32 rgba `[200,200,220,0]` set 0; meta item `gregtech:gt.metaitem.01` offset 32000, unlocalized `gt.metaitem.01`, prefixes `{i:2, dust, texture 2}`, `{i:11, ingot, texture 11}`; MTE 301 (idle: down `MACHINE_LV_BOTTOM`, up `MACHINE_LV_TOP`, north `MACHINE_LV_SIDE` + `OVERLAY_FRONT`, other sides `MACHINE_LV_SIDE`; running: north `MACHINE_LV_SIDE` + `OVERLAY_FRONT_ACTIVE` + `OVERLAY_FRONT_ACTIVE_GLOW` with `glow: 1`, rest as idle); MTE 50 (every side `{copy: ['gregtech:gt.blockcasings2', 0, side]}`, north adds `OVERLAY_PIPE_IN`); MTE 999 `{cls: 'Broken', error: 'java.lang.NullPointerException'}`; casing page id 16 = every side `{copy: ['gregtech:gt.blockcasings2', 0, side]}`; block `gregtech:gt.blockcasings2` meta 0 = `MACHINE_CASING_SOLID_STEEL` on every side; cover `gregtech:gt.metaitem.01@32630` = `OVERLAY_CONVEYOR`; fluid `water` colour `-16776961` with the still texture; `blockIds` `['gregtech:gt.blockcasings2', 'gregtech:gt.blockmachines', 'minecraft:stone']`.

Rules the signatures do not fix:
- `gtMachineFaces`: `null` when the id is unknown or has `error`; `active` (default `false`) picks the running faces.
- `gtItemIcon` (research §6.1–§6.2): look up `metaItems` by the key's registry name; `meta < offset` → slot `floor(meta / 1000)`, material id `meta % 1000`; the set's layers for the prefix's texture index become `textureSetLayers(ts, material.rgb)` for `ts` layers, and for `p` layers the first is tinted with the material colour and later ones are not; `meta ≥ offset` → `index.firstLayer(['gregtech/textures/items/<unlocalized>/<n>.png', '…/<n>/0.png', '…/<n>/1.png'])` with `n = meta − offset` (electric items only ship charge-level sub-icons). `null` when nothing resolves.
- `gtFluidIcon`: `null` for a fluid the dump does not know; `layers` is `[]` when it has no still texture (non-GT fluid: colour only).

- [ ] **Step 1: Write the failing test**

`tests/unit/assets/gt-faces.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gtSample, I, BM, MI } from '../../helpers/gt-sample.ts';
import { FACES } from '../../../src/shared/types/assets.ts';
import { gtMachineFaces, gtBlockFaces, casingFaces, coverLayers, gtItemIcon, gtFluidIcon, type CopyResolver } from '../../../src/server/assets/gt-faces.ts';

const { index, dump } = gtSample();
const copy: CopyResolver = (block, meta, side) => gtBlockFaces(dump, block, meta, copy)?.[FACES[side]!] ?? [];

describe('GT faces', () => {
  it('gives a machine its canonical faces, idle and running', () => {
    const idle = gtMachineFaces(dump, 301, copy)!;
    expect(idle.north).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }, { path: BM + 'OVERLAY_FRONT.png' }]);
    expect(idle.up).toEqual([{ path: I + 'MACHINE_LV_TOP.png' }]);
    expect(idle.east).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }]);
    expect(gtMachineFaces(dump, 301, copy, true)!.north).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' },
      { path: BM + 'OVERLAY_FRONT_ACTIVE.png', frames: 4 }, { path: BM + 'OVERLAY_FRONT_ACTIVE_GLOW.png', glow: true, frames: 4 }]);
    expect(gtMachineFaces(dump, 999, copy)).toBeNull();
    expect(gtMachineFaces(dump, 12345, copy)).toBeNull();
  });

  it('draws hatches and casing pages with the casing block they copy', () => {
    const hatch = gtMachineFaces(dump, 50, copy)!;
    expect(hatch.south).toEqual([{ path: I + 'MACHINE_CASING_SOLID_STEEL.png' }]);
    expect(hatch.north).toEqual([{ path: I + 'MACHINE_CASING_SOLID_STEEL.png' }, { path: I + 'OVERLAY_PIPE_IN.png' }]);
    expect(casingFaces(dump, 16, copy)!.up).toEqual([{ path: I + 'MACHINE_CASING_SOLID_STEEL.png' }]);
    expect(casingFaces(dump, 17, copy)).toBeNull();
    expect(gtBlockFaces(dump, 'gregtech:gt.blockcasings2', 1, copy)).toBeNull();
  });

  it('resolves cover overlays', () => {
    expect(coverLayers(dump, 'gregtech:gt.metaitem.01@32630', copy)).toEqual([{ path: I + 'OVERLAY_CONVEYOR.png' }]);
    expect(coverLayers(dump, 'gregtech:gt.metaitem.01@1', copy)).toBeNull();
  });
});

describe('GT item and fluid icons', () => {
  it('composes material items from the texture set and the material colour', () => {
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@11032')).toEqual([{ path: MI + 'METALLIC/ingot.png', tint: [200, 200, 220] }]);
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@2032')).toEqual([{ path: MI + 'NONE/dust.png', tint: [200, 200, 220] }]);
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@11999')).toBeNull();
  });

  it('uses the numbered icon for meta items at or above the offset', () => {
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@32606')).toEqual([{ path: 'gregtech/textures/items/gt.metaitem.01/606.png' }]);
    expect(gtItemIcon(dump, index, 'gregtech:gt.metaitem.01@32607')).toBeNull();
    expect(gtItemIcon(dump, index, 'minecraft:apple@0')).toBeNull();
  });

  it('gives GT fluids their tinted still texture', () => {
    expect(gtFluidIcon(dump, 'water')).toEqual({ layers: [{ path: 'gregtech/textures/blocks/fluids/fluid.water.png', tint: [0, 0, 255], frames: 4 }], color: [0, 0, 255] });
    expect(gtFluidIcon(dump, 'nope')).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/assets/gt-faces.test.ts`
Expected: FAIL — missing modules `src/server/assets/gt-faces.ts`, `tests/helpers/gt-sample.ts`.

- [ ] **Step 3: Implement `gt-faces.ts` and `tests/helpers/gt-sample.ts`** as specified.

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/assets/gt-faces.test.ts && npm run typecheck`
Expected: PASS (`Test Files  1 passed`), typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/assets/gt-faces.ts tests/helpers/gt-sample.ts tests/unit/assets/gt-faces.test.ts
git commit -m "feat(assets): GT machine, casing, cover, material item and fluid textures

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Curated tables for non-GT blocks

These mods choose their icons in client-only code, so a dedicated server cannot report them (research §2.3, §5). Paths are data/assets-relative; each face lists candidates and the first extracted one wins (Task 10). Task 15 checks every entry against the real pack and fails on any entry with no extracted candidate, so a wrong guess here cannot ship silently.

**Files:**
- Create: `src/server/assets/curated.ts`
- Test: `tests/unit/assets/curated.test.ts`

**Interfaces:**
- Consumes: `Face`, `FACES`, `Rgb` (Task 1).
- Produces:
  ```ts
  export interface CuratedBlock { faces: Record<Face, readonly string[]>; tint?: Partial<Record<Face, Rgb>> }
  export function curatedBlock(id: string, meta: number): CuratedBlock | null;
  export function curatedIds(): string[];      // every registry name and pseudo id the tables answer
  export function curatedPaths(): string[];    // every candidate path in the tables (Task 15 checks them)
  ```

The tables (decided here from research §5; `<x>` below is `<domain>/textures/blocks/<x>.png`; "front" = north, the canonical orientation; faces not listed use the "others" value):

| Id(s) | Meta | Faces |
|---|---|---|
| `StorageDrawers:fullDrawers1` / `2` / `4` | wood `w` = `['oak','spruce','birch','jungle','acacia','big_oak'][meta]`, else `oak` | front `drawers_<w>_front_<1/2/4>`; others `drawers_<w>_side` (domain `storagedrawers`) |
| `StorageDrawers:halfDrawers2` / `4` | wood as above | front `drawers_<w>_front_<2/4>`; up, down `drawers_<w>_side_h`; west, east `drawers_<w>_side_v`; south `drawers_<w>_side` |
| `StorageDrawers:compDrawers` | — | front candidates `drawers_comp_front_2`, `drawers_comp_front_1`, `drawers_comp_front_0`; others `drawers_comp_side` |
| `StorageDrawers:controller` / `controllerSlave` / `trim` | wood for trim | controller: front `drawers_controller_front`, others `drawers_comp_side`; slave: all `drawers_comp_side`; trim: all `drawers_<w>_trim` |
| `JABBA:barrel` | — | front `barrel_label_0`; up, down `barrel_top_0`; others `barrel_side_0` (domain `jabba`; structural levels above 0 are generated at run time and use these too) |
| `IronChest:BlockIronChest` | type `t` = `['iron','gold','diamond','copper','silver','crystal','obsidian','dirtchest9000','netherite','darksteel','silver'][meta]` (meta 4 STEEL reuses `silver`), else `iron` | front `<t>_front`; up, down `<t>_top`; others `<t>_side` (domain `ironchest`) |
| `fmp:<part>` (Project Red, all faces, domain `projectred`, `mechanical/pipes/<x>`) | — | `pr_pipe` basic · `pr_rbasic` routedjunc · `pr_rinterface` routedint · `pr_rcrafting` routedcrafting · `pr_rrequest` routedrequest · `pr_rextension` routedextension · `pr_rfire` routedfire · `pr_pt` pressuretube · `pr_rpt` resistancetube · `pr_netvalve` netvalve_inout · `pr_netlatency` netlatency; the world block `ForgeMultipart:block` uses `basic` |
| `conduit:<type>` (EnderIO, all faces, domain `enderio`) | — | `item` itemConduit · `liquid` liquidConduit · `power` powerConduit · `redstone` redstoneConduit · `me` meConduit · `gas` gasConduit · `oc` ocConduit · `other` conduitConnector; the world block `EnderIO:blockConduitBundle` uses conduitConnector |
| `appliedenergistics2:tile.BlockController` | — | all: `BlockControllerPowered`, then `BlockController` (domain `appliedenergistics2`) |
| `appliedenergistics2:tile.BlockDrive` | — | front `BlockDriveFront`; up `BlockDrive`; down `BlockDriveBottom`; others `BlockDriveSide` |
| `appliedenergistics2:tile.BlockInterface` | — | all `BlockInterface` |
| `ae2cable:<center>` and `appliedenergistics2:tile.BlockCableBus` (= `glass`) | — | all faces, candidates `appliedenergistics2/textures/items/ItemPart.<Part>.png`, `appliedenergistics2/textures/blocks/ItemPart.<Part>.png`, `appliedenergistics2/textures/blocks/<Family>_Grey.png` with (center → Part, Family): glass → CableGlass, MECable · covered → CableCovered, MECovered · smart → CableSmart, MESmart · dense → CableDense, MEDense · dense_covered → CableDenseCovered, MEDenseCovered |
| `minecraft:grass` | — | up `grass_top` tinted `[145,189,89]`; down `dirt`; others `grass_side` |
| `minecraft:sand` | 1 = red | all `sand` / `red_sand` |
| `minecraft:planks` | wood as Storage Drawers | all `planks_<w>` |
| `minecraft:log` / `log2` | `meta & 3` → `oak, spruce, birch, jungle` / `acacia, big_oak` | up, down `log_<w>_top`; others `log_<w>` |
| `minecraft:leaves` | `meta & 3` → `oak, spruce, birch, jungle` | all `leaves_<w>` tinted `[119,171,47]` |
| `minecraft:wool` | colour `['white','orange','magenta','light_blue','yellow','lime','pink','gray','silver','cyan','purple','blue','brown','green','red','black'][meta & 15]` | all `wool_colored_<c>` |
| `minecraft:stonebrick` | `['stonebrick','stonebrick_mossy','stonebrick_cracked','stonebrick_carved'][meta & 3]` | all that name |
| `minecraft:sandstone` | — | up `sandstone_top`; down `sandstone_bottom`; others `sandstone_normal` |
| `minecraft:quartz_block` | — | up `quartz_block_top`; down `quartz_block_bottom`; others `quartz_block_side` |
| `minecraft:chest` | — | all `planks_oak` (the real chest is an entity model, research §5.7) |
| `minecraft:crafting_table` | — | front `crafting_table_front`; up `crafting_table_top`; down `planks_oak`; others `crafting_table_side` |
| `minecraft:furnace` / `lit_furnace` | — | front `furnace_front_off` / `furnace_front_on`; up, down `furnace_top`; others `furnace_side` |
| `minecraft:hopper` | — | up `hopper_top`; others `hopper_outside` |
| `minecraft:water` / `flowing_water` / `lava` / `flowing_lava` | — | all `water_still` / `lava_still` |

Every other vanilla block with a single texture comes from `Block.textureName` in the dump (Task 10), so it is not listed here.

- [ ] **Step 1: Write the failing test**

`tests/unit/assets/curated.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { curatedBlock, curatedIds, curatedPaths } from '../../../src/server/assets/curated.ts';

const SD = 'storagedrawers/textures/blocks/';
const MC = 'minecraft/textures/blocks/';

describe('curated block tables', () => {
  it('maps Storage Drawers by wood and drawer count', () => {
    const b = curatedBlock('StorageDrawers:fullDrawers2', 1)!;
    expect(b.faces.north).toEqual([SD + 'drawers_spruce_front_2.png']);
    expect(b.faces.east).toEqual([SD + 'drawers_spruce_side.png']);
    const h = curatedBlock('StorageDrawers:halfDrawers4', 9)!;
    expect(h.faces.north).toEqual([SD + 'drawers_oak_front_4.png']);
    expect(h.faces.up).toEqual([SD + 'drawers_oak_side_h.png']);
    expect(h.faces.west).toEqual([SD + 'drawers_oak_side_v.png']);
    expect(curatedBlock('StorageDrawers:controller', 0)!.faces.north).toEqual([SD + 'drawers_controller_front.png']);
    expect(curatedBlock('StorageDrawers:compDrawers', 0)!.faces.north).toEqual([SD + 'drawers_comp_front_2.png', SD + 'drawers_comp_front_1.png', SD + 'drawers_comp_front_0.png']);
  });

  it('maps barrels, iron chests, routed pipes, conduits and AE2 blocks', () => {
    expect(curatedBlock('JABBA:barrel', 0)!.faces.north).toEqual(['jabba/textures/blocks/barrel_label_0.png']);
    expect(curatedBlock('IronChest:BlockIronChest', 4)!.faces.north).toEqual(['ironchest/textures/blocks/silver_front.png']);
    expect(curatedBlock('IronChest:BlockIronChest', 9)!.faces.up).toEqual(['ironchest/textures/blocks/darksteel_top.png']);
    expect(curatedBlock('fmp:pr_rinterface', 0)!.faces.west).toEqual(['projectred/textures/blocks/mechanical/pipes/routedint.png']);
    expect(curatedBlock('ForgeMultipart:block', 0)!.faces.up).toEqual(['projectred/textures/blocks/mechanical/pipes/basic.png']);
    expect(curatedBlock('conduit:item', 0)!.faces.down).toEqual(['enderio/textures/blocks/itemConduit.png']);
    expect(curatedBlock('appliedenergistics2:tile.BlockDrive', 0)!.faces.north).toEqual(['appliedenergistics2/textures/blocks/BlockDriveFront.png']);
    expect(curatedBlock('ae2cable:smart', 0)!.faces.up).toEqual(['appliedenergistics2/textures/items/ItemPart.CableSmart.png',
      'appliedenergistics2/textures/blocks/ItemPart.CableSmart.png', 'appliedenergistics2/textures/blocks/MESmart_Grey.png']);
  });

  it('maps the vanilla blocks that need more than one texture', () => {
    const g = curatedBlock('minecraft:grass', 0)!;
    expect(g.faces.up).toEqual([MC + 'grass_top.png']);
    expect(g.faces.down).toEqual([MC + 'dirt.png']);
    expect(g.tint).toEqual({ up: [145, 189, 89] });
    expect(curatedBlock('minecraft:log', 6)!.faces.up).toEqual([MC + 'log_birch_top.png']);
    expect(curatedBlock('minecraft:wool', 14)!.faces.north).toEqual([MC + 'wool_colored_red.png']);
    expect(curatedBlock('minecraft:furnace', 0)!.faces.north).toEqual([MC + 'furnace_front_off.png']);
  });

  it('answers nothing else and lists what it knows', () => {
    expect(curatedBlock('minecraft:stone', 0)).toBeNull();
    expect(curatedBlock('nope:nope', 0)).toBeNull();
    expect(curatedIds()).toEqual(expect.arrayContaining(['StorageDrawers:fullDrawers1', 'JABBA:barrel', 'fmp:pr_pipe', 'conduit:oc', 'ae2cable:smart', 'minecraft:hopper']));
    expect(curatedPaths()).toContain('jabba/textures/blocks/barrel_top_0.png');
    expect(curatedPaths().every((p) => /^[a-z0-9_.-]+\/textures\/(blocks|items)\/.+\.png$/.test(p))).toBe(true);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/assets/curated.test.ts`
Expected: FAIL — `Cannot find module '../../../src/server/assets/curated.ts'`.

- [ ] **Step 3: Implement `curated.ts`** with exactly the table above (data plus small meta functions).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/assets/curated.test.ts && npm run typecheck`
Expected: PASS (`Test Files  1 passed`), typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/assets/curated.ts tests/unit/assets/curated.test.ts
git commit -m "feat(assets): curated textures for drawers, barrels, iron chests, pipes, conduits, AE2 and vanilla

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Resolver — `BlockRef` → `BlockFaces`, `StuffKey` → `IconDescriptor`

**Files:**
- Create: `src/server/assets/resolve.ts`
- Test: `tests/unit/assets/resolve.test.ts`

**Interfaces:**
- Consumes: `AssetIndex`, `iconPath` (Task 2); `TexturesDump`, `buildTexturesDump` (Task 7); `gtMachineFaces`, `gtBlockFaces`, `gtItemIcon`, `gtFluidIcon`, `CopyResolver` (Task 8); `curatedBlock` (Task 9); `BlockFaces`, `IconDescriptor`, `CoverLayers`, `TextureLayer`, `FACES`, `rotateFaces`, `hashColor`, `KIND_COLORS`, `Rgb` (Task 1); `Pack`, `Machine`, `MachineKind`, `Item`, `BlockRef` (Plan 1); `isFluidKey`, `parseItemKey`, `StuffKey` (Plan 1); `coverLayers` (Task 8); test helpers `gtSampleFile`, `GT_SAMPLE_ASSETS`, `I`, `BM`, `MI` (Task 8), `indexOf`, `dumpFile` (Task 7). Tests build the three pack maps the resolver reads directly, so they do not depend on a pack builder.
- Produces (`src/server/assets/resolve.ts`):
  ```ts
  export interface IconSource { icon(key: StuffKey): TextureLayer | null }       // Task 11's NEI index implements it
  export type PackView = Pick<Pack, 'items' | 'machines' | 'materials'>;         // all the resolver reads; a full Pack fits
  export interface AssetSources { index: AssetIndex; dump: TexturesDump | null; nei: IconSource | null; pack: PackView | null }
  export function resolveBlocks(src: AssetSources, refs: readonly BlockRef[], facing?: number): BlockFaces[];   // same order and length as refs
  export function resolveIcons(src: AssetSources, keys: readonly StuffKey[]): IconDescriptor[];                 // same order and length as keys
  export function resolveCovers(src: AssetSources, items: readonly StuffKey[]): CoverLayers[];                  // same order; layers [] when the dump has no such cover
  export function blockFallbackColor(ref: BlockRef, pack: PackView | null): Rgb;
  export function iconFallbackColor(key: StuffKey, src: AssetSources): Rgb;
  ```

Rules (decided here):
- **Blocks**, first match wins: (1) `ref.mteId` set → `gtMachineFaces` (idle); (2) `gtBlockFaces(id, meta)`; (3) `curatedBlock(id, meta)`, each face = `index.firstLayer(candidates, { tint: tint?.[face] })`; (4) `dump.textureNames.blocks.get(id)` → `index.layer(iconPath(name, 'blocks'))` on all six faces; (5) all faces empty. The faces are then turned with `rotateFaces(faces, facing ?? 2)`. `resolved` = every face has at least one layer (a face without layers is drawn in `fallbackColor`).
- **Copies** (`CopyRef` inside GT faces) resolve through steps (2)–(4) for `{ id: block, meta }` and take the face `FACES[side]`; nesting deeper than 4 returns `[]`, so a block that copies itself ends instead of recursing.
- `blockFallbackColor`: `mteId` set → `KIND_COLORS[pack.machines.get(mteId)?.kind ?? 'other']`; an id containing `casing` (case-insensitive) → `KIND_COLORS.casing`; else `hashColor(`${id}@${meta}`)` (spec §3.8: plain colour by machine kind).
- **Icons**, first match wins: (1) `src.nei?.icon(key)` → `source: 'nei'`; (2) a fluid key → `gtFluidIcon(name)` with layers → `'gt'`; (3) `gtItemIcon` → `'gt'`; (4) `dump.textureNames.items.get(id)` → `index.layer(iconPath(name, 'items'))` → `'jar'`; (5) the item as a block — `gregtech:gt.blockmachines@<mteId>` → `gtMachineFaces(meta)`; otherwise the block steps (2)–(4) for `{ id, meta }` — taking the `north` face, else `up` → `'gt'` when the faces came from the dump, `'jar'` when from the curated table or a texture name; (6) `layers: []`, `source: 'fallback'`.
- `iconFallbackColor` (always filled, also when layers exist, so the client can paint while loading): a fluid → the dump's fluid colour, else `hashColor(key)`; an item → `pack.materials.get(pack.items.get(key)?.gt?.material)?.rgba` (first three), else the dump material of that name, else `hashColor(key)`.
- `resolveCovers` (architecture §11.14: the 3D view draws covers on their faces): `coverLayers(dump, item, copy)` — GT's own in-world cover overlay, e.g. `OVERLAY_CONVEYOR` for the LV Conveyor Module — as `{ item, layers }` (`CoverLayers`, Task 1); `layers: []` without a dump or for an unknown cover (the 3D view then uses the item icon).

- [ ] **Step 1: Write the failing test**

`tests/unit/assets/resolve.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { gtSampleFile, GT_SAMPLE_ASSETS, I, BM, MI } from '../../helpers/gt-sample.ts';
import { indexOf } from '../../helpers/assets-dir.ts';
import { dumpFile } from '../../helpers/textures-dump.ts';
import { buildTexturesDump } from '../../../src/server/assets/textures-dump.ts';
import { resolveBlocks, resolveIcons, resolveCovers, type AssetSources, type PackView } from '../../../src/server/assets/resolve.ts';
import { hashColor, KIND_COLORS } from '../../../src/shared/types/assets.ts';
import type { Item, Machine, MachineKind } from '../../../src/shared/types/pack.ts';

const index = indexOf({ ...GT_SAMPLE_ASSETS, 'storagedrawers/textures/blocks/drawers_oak_front_1.png': {}, 'storagedrawers/textures/blocks/drawers_oak_side.png': {},
  'jabba/textures/blocks/barrel_side_0.png': {}, 'minecraft/textures/blocks/stone.png': {}, 't/textures/items/iron_ingot.png': {} });
const dump = buildTexturesDump({ ...gtSampleFile(), textureNames: { blocks: { 'minecraft:stone': 'stone' }, items: { 't:iron_ingot': 't:iron_ingot' } } }, index);
const machine = (mteId: number, kind: MachineKind): Machine => ({ mteId, metaName: `m${mteId}`, name: `M${mteId}`, cls: 'X', itemKey: `gregtech:gt.blockmachines@${mteId}`, kind, maps: [] });
const item = (key: string, material?: string): Item => ({ key, id: key.split('@')[0]!, meta: 0, name: key, oreDict: [], ...(material ? { gt: { prefix: 'ingot', material, amount: 3628800 } } : {}) });
const pack: PackView = {
  machines: new Map([[301, machine(301, 'basic')], [77, machine(77, 'steam')]]),
  items: new Map([['t:iron_ingot@0', item('t:iron_ingot@0', 'Iron')], ['t:mystery@0', item('t:mystery@0', 'Copper')], ['t:plain@0', item('t:plain@0')]]),
  materials: new Map([['Copper', { name: 'Copper', rgba: [255, 100, 0, 0], iconSet: 'SHINY', oreByproducts: [] }]]),
};
const src: AssetSources = { index, dump, nei: null, pack };
const GT = 'gregtech:gt.blockmachines';

describe('resolveBlocks', () => {
  it('resolves GT machines, turns them, and falls back by machine kind', () => {
    const [m] = resolveBlocks(src, [{ id: GT, meta: 0, mteId: 301 }]);
    expect(m!.resolved).toBe(true);
    expect(m!.faces.north).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }, { path: BM + 'OVERLAY_FRONT.png' }]);
    const [east] = resolveBlocks(src, [{ id: GT, meta: 0, mteId: 301 }], 5);
    expect(east!.faces.east).toEqual(m!.faces.north);
    expect(east!.faces.north).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }]);
    expect(resolveBlocks(src, [{ id: GT, meta: 0, mteId: 999 }])[0]).toMatchObject({ resolved: false, fallbackColor: KIND_COLORS.other });
    expect(resolveBlocks(src, [{ id: GT, meta: 0, mteId: 77 }])[0]!.fallbackColor).toEqual(KIND_COLORS.steam);
  });

  it('resolves casing blocks, curated blocks and plain texture names', () => {
    expect(resolveBlocks(src, [{ id: 'gregtech:gt.blockcasings2', meta: 0 }])[0]!.faces.up).toEqual([{ path: I + 'MACHINE_CASING_SOLID_STEEL.png' }]);
    const sd = resolveBlocks(src, [{ id: 'StorageDrawers:fullDrawers1', meta: 0 }])[0]!;
    expect(sd.faces.north).toEqual([{ path: 'storagedrawers/textures/blocks/drawers_oak_front_1.png' }]);
    expect(sd.resolved).toBe(true);
    expect(resolveBlocks(src, [{ id: 'minecraft:stone', meta: 0 }])[0]!.faces.west).toEqual([{ path: 'minecraft/textures/blocks/stone.png' }]);
  });

  it('reports partially resolved blocks', () => {
    const j = resolveBlocks(src, [{ id: 'JABBA:barrel', meta: 0 }])[0]!;
    expect(j.resolved).toBe(false);
    expect(j.faces.east).toEqual([{ path: 'jabba/textures/blocks/barrel_side_0.png' }]);
    expect(j.faces.north).toEqual([]);
    expect(j.fallbackColor).toEqual(hashColor('JABBA:barrel@0'));
  });

  it('ends copy cycles and gives unknown blocks their fallback colour', () => {
    const loop = buildTexturesDump(dumpFile({ blocks: [{ id: 'x:loop', metas: { '0': [0, 1, 2, 3, 4, 5].map((s) => [{ copy: ['x:loop', 0, s] as [string, number, number] }]) } }] }), index);
    expect(resolveBlocks({ ...src, dump: loop }, [{ id: 'x:loop', meta: 0 }])[0]).toMatchObject({ resolved: false, faces: { up: [] } });
    expect(resolveBlocks(src, [{ id: 'mod:thing', meta: 3 }])[0]).toEqual({ block: { id: 'mod:thing', meta: 3 },
      faces: { down: [], up: [], north: [], south: [], west: [], east: [] }, fallbackColor: hashColor('mod:thing@3'), resolved: false });
    expect(resolveBlocks(src, [{ id: 'gregtech:gt.blockcasings9', meta: 0 }])[0]!.fallbackColor).toEqual(KIND_COLORS.casing);
  });
});

describe('resolveIcons', () => {
  it('prefers NEI, then GT, then jar texture names, then block faces', () => {
    const nei = { icon: (k: string) => (k === 't:iron_ingot@0' ? { path: 'nei/icons/adc999ea62bc5836.png' } : null) };
    const [a, b, c, d, e] = resolveIcons({ ...src, nei }, ['t:iron_ingot@0', 'gregtech:gt.metaitem.01@11032', 't:iron_ingot@1', `${GT}@301`, 'StorageDrawers:fullDrawers1@0']);
    expect(a).toMatchObject({ source: 'nei', layers: [{ path: 'nei/icons/adc999ea62bc5836.png' }] });
    expect(b).toMatchObject({ source: 'gt', layers: [{ path: MI + 'METALLIC/ingot.png', tint: [200, 200, 220] }] });
    expect(c).toMatchObject({ source: 'jar', layers: [{ path: 't/textures/items/iron_ingot.png' }] });
    expect(d).toMatchObject({ source: 'gt', layers: [{ path: I + 'MACHINE_LV_SIDE.png' }, { path: BM + 'OVERLAY_FRONT.png' }] });
    expect(e).toMatchObject({ source: 'jar', layers: [{ path: 'storagedrawers/textures/blocks/drawers_oak_front_1.png' }] });
  });

  it('gives fluids their texture or a colour, and items a material or hash colour', () => {
    const [water, oil, copper, plain] = resolveIcons(src, ['fluid:water', 'fluid:oil', 't:mystery@0', 't:plain@0']);
    expect(water).toEqual({ key: 'fluid:water', source: 'gt', layers: [{ path: 'gregtech/textures/blocks/fluids/fluid.water.png', tint: [0, 0, 255], frames: 4 }], fallbackColor: [0, 0, 255] });
    expect(oil).toEqual({ key: 'fluid:oil', source: 'fallback', layers: [], fallbackColor: hashColor('fluid:oil') });
    expect(copper).toEqual({ key: 't:mystery@0', source: 'fallback', layers: [], fallbackColor: [255, 100, 0] });
    expect(plain).toEqual({ key: 't:plain@0', source: 'fallback', layers: [], fallbackColor: hashColor('t:plain@0') });
  });

  it('gives covers their in-world overlay', () => {
    expect(resolveCovers(src, ['gregtech:gt.metaitem.01@32630', 'x:y@0'])).toEqual([
      { item: 'gregtech:gt.metaitem.01@32630', layers: [{ path: I + 'OVERLAY_CONVEYOR.png' }] }, { item: 'x:y@0', layers: [] }]);
  });

  it('works without a dump and keeps request order and duplicates', () => {
    expect(resolveCovers({ ...src, dump: null }, ['gregtech:gt.metaitem.01@32630'])).toEqual([{ item: 'gregtech:gt.metaitem.01@32630', layers: [] }]);
    expect(resolveIcons({ ...src, dump: null }, ['fluid:water', 'fluid:water']).map((d) => [d.key, d.source])).toEqual([['fluid:water', 'fallback'], ['fluid:water', 'fallback']]);
    expect(resolveBlocks({ ...src, dump: null }, [{ id: 'minecraft:stone', meta: 0 }])[0]!.resolved).toBe(false);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run tests/unit/assets/resolve.test.ts`
Expected: FAIL — `Cannot find module '../../../src/server/assets/resolve.ts'`.

- [ ] **Step 3: Implement `resolve.ts`** as specified (pure functions; no file access).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run tests/unit/assets/resolve.test.ts && npm run typecheck`
Expected: PASS (`Test Files  1 passed`), typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/assets/resolve.ts tests/unit/assets/resolve.test.ts
git commit -m "feat(assets): resolve blocks to faces and items or fluids to icons with fallback colours

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Optional NEI item-panel icon import

The one-time client-side dump (research §6.5.1) gives real icons for everything the server cannot describe. It is taken by hand in a *copy* of the client instance (README, Task 16); this task only joins the files it produced.

**Files:**
- Create: `src/server/assets/nei.ts`, `src/server/cli/import-nei-icons.ts`, `tests/helpers/nei-dump.ts`
- Modify: `package.json` (script `"import-nei-icons": "node --disable-warning=ExperimentalWarning src/server/cli/import-nei-icons.ts"`), `tests/helpers/run-cli.ts` (add `'import-nei-icons'` to the `script` union)
- Test: `tests/unit/assets/nei.test.ts`, `tests/unit/cli/import-nei-icons.test.ts`

**Interfaces:**
- Consumes: `IconSource` (Task 10); `TextureLayer` (Task 1); `makePng` (Task 1); `AppConfig`, `loadConfig()` (Plan 1/2); `runCli` (Plan 1).
- Produces:
  - `src/server/assets/nei.ts`:
    ```ts
    export const NEI_INDEX_FORMAT = 'gtnh-planner-nei/1';
    export const NEI_HEADER = ['Item Name', 'Item ID', 'Item meta', 'Has NBT', 'Display Name'] as const;
    export interface NeiRow { name: string; meta: number; hasNbt: boolean; display: string }
    export interface NeiIndexFile { format: typeof NEI_INDEX_FORMAT; importedAt: string; rows: number; icons: Record<string /* StuffKey */, string /* data/assets-relative path */> }
    export class NeiImportError extends Error {}
    export function parseCsv(text: string): string[][];                       // RFC 4180: quoted fields, doubled quotes, LF or CRLF, no empty last row
    export function parseNeiCsv(text: string): NeiRow[];                      // header must equal NEI_HEADER, else NeiImportError
    export function neiFileBase(display: string): string;                     // NEI's cleanFileName
    export function assignNeiFiles(rows: readonly NeiRow[], caseInsensitive: boolean): string[];
    export function fluidNames(jsonDump: string): Array<string | null>;       // per line
    export interface NeiImportResult { rows: number; imported: number; skippedNbt: number; fluids: number; duplicates: number; caseInsensitive: boolean }
    export function importNeiIcons(opts: { csv: string /* file */; json?: string | null /* file */; pngDir: string; dataDir: string; now?: () => Date }): Promise<NeiImportResult>;
    export interface NeiIndex extends IconSource { readonly size: number }
    export function loadNeiIndex(assetsDir: string): Promise<NeiIndex | null>; // null when nei/index.json is absent
    ```
  - `src/server/cli/import-nei-icons.ts`: `export function main(argv: string[], deps?: { config?: AppConfig; out?: (l: string) => void; err?: (l: string) => void }): Promise<number>`; flags `--csv <file>` (required), `--png <folder>` (required), `--json <file>` (optional), `--help`; ends with `if (import.meta.main) process.exitCode = await main(process.argv.slice(2));`.
  - `tests/helpers/nei-dump.ts`: `export interface NeiDumpRow { name: string; meta: number; nbt?: boolean; display: string; fluid?: string }`; `export function writeNeiDump(dir: string, rows: NeiDumpRow[], opts: { caseInsensitive: boolean }): Promise<{ csv: string; json: string; pngDir: string; files: string[] }>` — writes `itempanel.csv` (header `NEI_HEADER`, ids `9000 + i`, `true`/`false`, display names quoted when needed), `itempanel.json` (one line per row, `{"tag":{"FluidName":"<fluid>","Amount":1000}}` when `fluid` is set, else `{}`) and `itempanel_icons/<file>` with `makePng(16, 16, [20 * (i + 1), 0, 0, 255])` for row `i`, file names from `assignNeiFiles`.

Rules (research §6.5.1):
- `neiFileBase`: every `" < > | : * ? \ /` and U+0000–U+001F becomes `_`.
- `assignNeiFiles`: row by row, `<base>.png`; if taken, `<base>_2.png`, `<base>_3.png`, … (first free); "taken" compares lower-cased names when `caseInsensitive` (the dump folder may live on a case-insensitive disk).
- `importNeiIcons`: parse the CSV (and the JSON, when given, whose line count must equal the row count); list the PNG folder; the number of PNGs must equal the row count, else `NeiImportError('The CSV has <r> rows but <pngDir> has <n> PNGs …')`. Try the case-sensitive assignment, then the case-insensitive one; use the first whose every file exists; otherwise `NeiImportError` naming the first row the better assignment misses: `Row <n> (<name>@<meta> "<display>") expects "<file>", which is not in <pngDir>. Dump again with an empty search box and every collapsible group expanded, CSV and PNG in the same session.` Keys: a row without NBT → `<name>@<meta>`; `NotEnoughItems:neiFluidDisplay` with a fluid name from `fluidNames` (regex `/"?FluidName"?\s*:\s*"([^"]+)"/` on its JSON line) → `fluid:<name>`; other NBT rows are skipped (`skippedNbt`); a key already taken keeps its first icon (`duplicates`). Each icon is copied to `nei/icons/<first 16 hex of sha1(key)>.png`; `index.json` lists them. Everything is written to `<dataDir>/assets/nei.staging-<ms>/` and swapped in only when complete (previous `nei/` renamed away, then removed); any error removes the staging folder and leaves the previous import in place.
- CLI output on success: `Imported <imported> NEI icons (<fluids> fluids) from <rows> rows; skipped <skippedNbt> rows with NBT; file names matched <case-sensitively|case-insensitively>` → exit 0; `NeiImportError` → its message, exit 1; missing flags → usage, exit 2.

- [ ] **Step 1: Write the failing tests**

`tests/unit/assets/nei.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdtemp, readFile, rename, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeNeiDump, type NeiDumpRow } from '../../helpers/nei-dump.ts';
import { makePng } from '../../helpers/png.ts';
import { parseCsv, neiFileBase, assignNeiFiles, importNeiIcons, loadNeiIndex, NeiImportError, type NeiRow } from '../../../src/server/assets/nei.ts';

const ROWS: NeiDumpRow[] = [
  { name: 'minecraft:stone', meta: 0, display: 'Stone' },
  { name: 'minecraft:stone', meta: 1, display: 'Granite' },
  { name: 'gregtech:gt.metaitem.01', meta: 11032, display: 'Iron Ingot' },
  { name: 't:iron_ingot', meta: 0, display: 'Iron Ingot' },
  { name: 't:iron', meta: 0, display: 'iron ingot' },
  { name: 'NotEnoughItems:neiFluidDisplay', meta: 0, nbt: true, display: 'Water', fluid: 'water' },
  { name: 'minecraft:written_book', meta: 0, nbt: true, display: 'Book: "A", B' },
  { name: 't:weird', meta: 0, display: 'a/b:c*d' },
];
const asRows = (r: NeiDumpRow[]): NeiRow[] => r.map((x) => ({ name: x.name, meta: x.meta, hasNbt: !!x.nbt, display: x.display }));

describe('NEI dump rules', () => {
  it('parses CSV with quotes and CRLF', () => {
    expect(parseCsv('a,"b ""c"", d"\r\n1,2\n')).toEqual([['a', 'b "c", d'], ['1', '2']]);
  });

  it('cleans file names like NEI', () => {
    expect(neiFileBase('a/b:c*d?e<f>g|h"i\\j\u0001')).toBe('a_b_c_d_e_f_g_h_i_j_');
  });

  it('replays the _2, _3 collision rule on either kind of disk', () => {
    expect(assignNeiFiles(asRows(ROWS), false)).toEqual(['Stone.png', 'Granite.png', 'Iron Ingot.png', 'Iron Ingot_2.png', 'iron ingot.png', 'Water.png', 'Book_ _A_, B.png', 'a_b_c_d.png']);
    expect(assignNeiFiles(asRows(ROWS), true)[4]).toBe('iron ingot_3.png');
  });
});

describe('importNeiIcons', () => {
  it('joins rows to PNGs by order and indexes them by key', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), ROWS, { caseInsensitive: false });
    const r = await importNeiIcons({ csv: d.csv, json: d.json, pngDir: d.pngDir, dataDir: join(dir, 'data') });
    expect(r).toEqual({ rows: 8, imported: 7, skippedNbt: 1, fluids: 1, duplicates: 0, caseInsensitive: false });
    const nei = (await loadNeiIndex(join(dir, 'data', 'assets')))!;
    expect(nei.size).toBe(7);
    expect(nei.icon('t:iron_ingot@0')).toEqual({ path: 'nei/icons/adc999ea62bc5836.png' });
    expect(nei.icon('fluid:water')).toEqual({ path: 'nei/icons/79da7cf2c0480a76.png' });
    expect(nei.icon('minecraft:written_book@0')).toBeNull();
    expect(await readFile(join(dir, 'data', 'assets', 'nei', 'icons', 'adc999ea62bc5836.png'))).toEqual(makePng(16, 16, [80, 0, 0, 255]));
  });

  it('detects a dump written on a case-insensitive disk', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const d = await writeNeiDump(join(dir, 'dumps'), ROWS, { caseInsensitive: true });
    expect((await importNeiIcons({ csv: d.csv, pngDir: d.pngDir, dataDir: join(dir, 'data') })).caseInsensitive).toBe(true);
  });

  it('refuses a row-order mismatch and keeps the previous import', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-nei-'));
    const good = await writeNeiDump(join(dir, 'good'), ROWS, { caseInsensitive: false });
    await importNeiIcons({ csv: good.csv, pngDir: good.pngDir, dataDir: join(dir, 'data') });
    const bad = await writeNeiDump(join(dir, 'bad'), ROWS, { caseInsensitive: false });
    await rename(join(bad.pngDir, 'Granite.png'), join(bad.pngDir, 'Andesite.png'));
    await expect(importNeiIcons({ csv: bad.csv, pngDir: bad.pngDir, dataDir: join(dir, 'data') })).rejects.toThrow(/Row 2 \(minecraft:stone@1 "Granite"\) expects "Granite.png"/);
    await writeFile(join(dir, 'short.json'), '{}\n');
    await expect(importNeiIcons({ csv: good.csv, json: join(dir, 'short.json'), pngDir: good.pngDir, dataDir: join(dir, 'data') })).rejects.toBeInstanceOf(NeiImportError);
    expect((await loadNeiIndex(join(dir, 'data', 'assets')))!.size).toBe(7);
  });

  it('returns null before any import', async () => {
    expect(await loadNeiIndex(await mkdtemp(join(tmpdir(), 'gp-nei-')))).toBeNull();
  });
});
```

`tests/unit/cli/import-nei-icons.test.ts`: with `writeNeiDump` of the same rows and `config = { dataDir: <tmp>/data, … }`: `main(['--csv', d.csv, '--png', d.pngDir, '--json', d.json], deps)` → `0` and the output line `Imported 7 NEI icons (1 fluids) from 8 rows; skipped 1 rows with NBT; file names matched case-sensitively`; `main(['--csv', d.csv], deps)` → `2` with a line starting `Usage: npm run import-nei-icons`; after renaming one PNG, `main(...)` → `1` with the `Row 2 (…)` message; `runCli('import-nei-icons', ['--help'], { cwd })` → code 0.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/assets/nei.test.ts tests/unit/cli/import-nei-icons.test.ts`
Expected: FAIL — missing modules `src/server/assets/nei.ts`, `src/server/cli/import-nei-icons.ts`, `tests/helpers/nei-dump.ts`.

- [ ] **Step 3: Implement `nei.ts`, the CLI, the helper, the npm script and the `runCli` union entry** as specified.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/assets/nei.test.ts tests/unit/cli/import-nei-icons.test.ts && npm run typecheck`
Expected: PASS (`Test Files  2 passed`), typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json src/server/assets/nei.ts src/server/cli/import-nei-icons.ts tests/helpers/nei-dump.ts tests/helpers/run-cli.ts tests/unit/assets/nei.test.ts tests/unit/cli/import-nei-icons.test.ts
git commit -m "feat(assets): optional NEI item-panel icon import joined by row order

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: Asset service and the `/api/assets/*` routes

**Files:**
- Create: `src/server/assets/service.ts`, `src/server/http/routes/assets.ts`
- Modify: `src/server/http/routes/index.ts` (append `assetRoutes` to `ROUTE_MODULES`), `src/shared/types/api.ts` (append below)
- Test: `tests/unit/assets/service.test.ts`, `tests/unit/http/assets-routes.test.ts`

**Interfaces:**
- Consumes: `loadAssetIndex`, `emptyAssetIndex`, `INDEX_FILE` (Task 2); `loadTexturesDump`, `TEXTURES_FILE` (Task 7); `loadNeiIndex` (Task 11); `resolveBlocks`, `resolveIcons`, `resolveCovers`, `AssetSources`, `PackView` (Task 10); `CoverLayers` (Task 1); Plan 2: `Route`, `HttpError`, `sendJson`, `readJson` (`router.ts`), `AppContext` (`app.ts`), `ROUTE_MODULES`; Plan 1: `activeExportDir` (`config.ts`); test helpers `startTestServer`, `TestServer` (Plan 2), `writeAssetsDir` (Task 7), `writeTexturesDump` (Task 7; creates the folder if needed), `gtSampleFile`, `GT_SAMPLE_ASSETS`, `I` (Task 8), `makePng` (Task 1).
- Produces:
  - `src/shared/types/api.ts` (append): `export interface AssetIconsRequest { keys: StuffKey[] }`, `export interface AssetBlocksRequest { blocks: BlockRef[]; facing?: number }`, `export interface AssetCoversRequest { items: StuffKey[] }`, `export const ASSET_KEYS_MAX = 500`, `export const ASSET_BLOCKS_MAX = 500`.
  - `src/server/assets/service.ts`:
    ```ts
    export interface AssetServiceOptions { dataDir: string; exportDir: () => string | null; pack: () => Promise<PackView | null>; checkEveryMs?: number /* 1000 */; log?: (line: string) => void /* console.warn */ }
    export class AssetService {
      constructor(opts: AssetServiceOptions);
      readonly assetsDir: string;                                        // <dataDir>/assets
      sources(): Promise<AssetSources>;
      icons(keys: readonly StuffKey[]): Promise<IconDescriptor[]>;
      blocks(refs: readonly BlockRef[], facing?: number): Promise<BlockFaces[]>;
      covers(items: readonly StuffKey[]): Promise<CoverLayers[]>;
    }
    export function assetService(app: AppContext): AssetService;       // created once and kept in app.services.assets
    ```
  - `src/server/http/routes/assets.ts`: `export function assetRoutes(app: AppContext): Route[]`, `export function isValidAssetRel(rel: string): boolean`, `export function safeAssetFile(assetsDir: string, rel: string): Promise<string | null>`.

Rules (decided here):
- `sources()` checks, at most once per `checkEveryMs`, the `mtimeMs` and size of `<assets>/index.json`, `<exportDir()>/textures.json.gz` (and whether `exportDir()` changed) and `<assets>/nei/index.json`, and reloads what changed (a new index also rebuilds the dump, whose layers are resolved against it). Concurrent callers share one reload. A reload that throws keeps the previous sources, calls `log` once per changed signature, and is retried only when the file changes again. `assetService(app)` wires `dataDir = app.config.dataDir`, `exportDir` = `activeExportDir(app.config)` or `null` when it throws, and `pack` = `app.pack()` or `null` on rejection (assets work before any export).
- `GET /api/assets/file/*`: `rel = params['*']` (already URI-decoded by Plan 2's `matchRoute`). `isValidAssetRel` is false for an empty or over-512-character path, a leading `/`, any `\`, NUL or other control character, and any empty, `.` or `..` segment → 400 `{error:'bad-path'}`. A valid path that does not end in `.png`, does not exist, or whose `realpath` is not inside `realpath(<assets>)` (symlinks) → 404 `{error:'not-found'}`. Otherwise 200 with `Content-Type: image/png`, `Cache-Control: private, max-age=3600`, `ETag: "<size>-<mtimeMs>"`, streamed; a matching `If-None-Match` → 304.
- `POST /api/assets/icons` (`readJson`, default 1 MiB limit): `keys` must be an array of strings of at most 300 characters each, else 400 `{error:'bad-request'}`; more than `ASSET_KEYS_MAX` → 400 `{error:'too-many', message:'At most 500 keys per request'}`; → `IconDescriptor[]` in request order.
- `POST /api/assets/blocks`: each block `{ id: string ≤ 200 characters, meta: integer 0..32767, mteId?: integer ≥ 0 }`, `facing` absent or an integer 0..5, else 400; more than `ASSET_BLOCKS_MAX` blocks → 400 `too-many`; → `BlockFaces[]` in request order. `facing` applies to every block of the request (architecture §6.5), so a caller with several facings sends one request per facing.
- `POST /api/assets/covers` (Architecture change request 7): `items` validated like `keys` above → `CoverLayers[]` in request order.
- None of the routes is `public`: textures are served to logged-in group members only (Global Constraints).

- [ ] **Step 1: Write the failing tests**

`tests/unit/assets/service.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { writeAssetsDir } from '../../helpers/assets-dir.ts';
import { writeTexturesDump } from '../../helpers/textures-dump.ts';
import { gtSampleFile, GT_SAMPLE_ASSETS } from '../../helpers/gt-sample.ts';
import { AssetService } from '../../../src/server/assets/service.ts';

describe('AssetService', () => {
  it('reloads when index, dump or NEI index change', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'gp-svc-'));
    const exportDir = join(dir, 'export', 'e1');
    await writeAssetsDir(dir, { 'minecraft/textures/blocks/stone.png': {} });
    const logs: string[] = [];
    const svc = new AssetService({ dataDir: dir, exportDir: () => exportDir, pack: async () => null, checkEveryMs: 0, log: (l) => logs.push(l) });
    expect((await svc.icons(['fluid:water']))[0]!.source).toBe('fallback');
    await writeAssetsDir(dir, GT_SAMPLE_ASSETS);
    await writeTexturesDump(exportDir, gtSampleFile());
    expect((await svc.icons(['fluid:water']))[0]!.source).toBe('gt');
    await mkdir(join(dir, 'assets', 'nei', 'icons'), { recursive: true });
    await writeFile(join(dir, 'assets', 'nei', 'index.json'), JSON.stringify({ format: 'gtnh-planner-nei/1', importedAt: 't', rows: 1, icons: { 'fluid:water': 'nei/icons/79da7cf2c0480a76.png' } }));
    expect((await svc.icons(['fluid:water']))[0]!.source).toBe('nei');
    await writeFile(join(dir, 'assets', 'index.json'), '{broken');
    expect((await svc.icons(['fluid:water']))[0]!.source).toBe('nei');
    expect(await svc.icons(['fluid:water'])).toHaveLength(1);
    expect(logs).toHaveLength(1);
  });

  it('works with no assets, no export and no pack', async () => {
    const svc = new AssetService({ dataDir: await mkdtemp(join(tmpdir(), 'gp-svc-')), exportDir: () => null, pack: async () => null });
    expect((await svc.blocks([{ id: 'minecraft:stone', meta: 0 }]))[0]!.resolved).toBe(false);
  });
});
```

`tests/unit/http/assets-routes.test.ts`:

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { request as httpRequest } from 'node:http';
import { mkdtemp, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer, type TestServer } from '../../helpers/test-server.ts';
import { makePng } from '../../helpers/png.ts';
import { writeAssetsDir } from '../../helpers/assets-dir.ts';
import { writeTexturesDump } from '../../helpers/textures-dump.ts';
import { gtSampleFile, GT_SAMPLE_ASSETS, I } from '../../helpers/gt-sample.ts';
import { activeExportDir } from '../../../src/server/config.ts';
import { ASSET_KEYS_MAX } from '../../../src/shared/types/api.ts';

let s: TestServer;
const OUTSIDE = makePng(16, 16, [1, 2, 3, 255]);

beforeAll(async () => {
  s = await startTestServer({ pack: null });   // the asset routes work without a recipe pack
  await writeAssetsDir(s.app.config.dataDir, GT_SAMPLE_ASSETS);
  s.app.config.activeExportId = 'e1';
  await writeTexturesDump(activeExportDir(s.app.config), gtSampleFile());
  const outside = await mkdtemp(join(tmpdir(), 'gp-out-'));
  await writeFile(join(outside, 'x.png'), OUTSIDE);
  await symlink(join(outside, 'x.png'), join(s.app.config.dataDir, 'assets', 'link.png'));
  await symlink(outside, join(s.app.config.dataDir, 'assets', 'linkdir'));
});
afterAll(() => s.close());

// Raw request: fetch() would normalise "..", "%2e%2e" and "//" before sending.
function rawGet(path: string, headers: Record<string, string> = {}): Promise<{ status: number; headers: Record<string, unknown>; body: Buffer }> {
  const u = new URL(s.url);
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: u.hostname, port: u.port, path, headers: { cookie: s.cookie, ...headers } }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode!, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

describe('GET /api/assets/file/*', () => {
  it('serves extracted PNGs with caching headers', async () => {
    const r = await rawGet('/api/assets/file/' + I + 'MACHINE_LV_SIDE.png');
    expect(r.status).toBe(200);
    expect(r.headers['content-type']).toBe('image/png');
    expect(r.body).toEqual(makePng(16, 16, [150, 150, 160, 255]));
    expect((await rawGet('/api/assets/file/' + I + 'MACHINE_LV_SIDE.png', { 'if-none-match': String(r.headers.etag) })).status).toBe(304);
  });

  it.each([
    '/api/assets/file/%2e%2e/%2e%2e/config.json', '/api/assets/file/gregtech%2f..%2f..%2fconfig.json', '/api/assets/file/a%5cb.png',
    '/api/assets/file/a%00.png', '/api/assets/file//etc/hosts', '/api/assets/file/%E0%A4%A.png', '/api/assets/file/index.json',
    '/api/assets/file/link.png', '/api/assets/file/linkdir/x.png', '/api/assets/file/nope/missing.png',
  ])('refuses %s with 400 or 404', async (path) => {
    const r = await rawGet(path);
    expect([400, 404]).toContain(r.status);
    expect(r.body.includes(OUTSIDE)).toBe(false);
  });

  it('answers 400 for traversal and 404 for files it does not serve', async () => {
    expect((await rawGet('/api/assets/file/%2e%2e/%2e%2e/config.json')).status).toBe(400);
    expect((await rawGet('/api/assets/file/a%5cb.png')).status).toBe(400);
    expect((await rawGet('/api/assets/file/index.json')).status).toBe(404);
    expect((await rawGet('/api/assets/file/link.png')).status).toBe(404);
  });

  it('needs a session', async () => {
    expect((await rawGet('/api/assets/file/' + I + 'MACHINE_LV_SIDE.png', { cookie: '' })).status).toBe(401);
  });
});

describe('POST /api/assets/icons and /api/assets/blocks', () => {
  it('answers icons in request order', async () => {
    const r = await s.request('/api/assets/icons', { method: 'POST', body: { keys: ['fluid:water', 'gregtech:gt.metaitem.01@11032', 'x:y@0'] } });
    expect(r.status).toBe(200);
    expect((await r.json()).map((d: { key: string; source: string }) => [d.key, d.source]))
      .toEqual([['fluid:water', 'gt'], ['gregtech:gt.metaitem.01@11032', 'gt'], ['x:y@0', 'fallback']]);
  });

  it('answers block faces turned to the requested facing', async () => {
    const r = await s.request('/api/assets/blocks', { method: 'POST', body: { blocks: [{ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 301 }], facing: 3 } });
    const [b] = await r.json();
    expect(b.faces.south).toEqual([{ path: I + 'MACHINE_LV_SIDE.png' }, { path: 'gregtech/textures/blocks/basicmachines/macerator/OVERLAY_FRONT.png' }]);
    expect(b.resolved).toBe(true);
  });

  it('answers cover overlays', async () => {
    const r = await s.request('/api/assets/covers', { method: 'POST', body: { items: ['gregtech:gt.metaitem.01@32630'] } });
    expect(await r.json()).toEqual([{ item: 'gregtech:gt.metaitem.01@32630', layers: [{ path: I + 'OVERLAY_CONVEYOR.png' }] }]);
  });

  it('refuses bad or oversized requests', async () => {
    const keys = (n: number) => Array.from({ length: n }, (_, i) => `x:y@${i}`);
    expect((await s.request('/api/assets/icons', { method: 'POST', body: { keys: keys(ASSET_KEYS_MAX + 1) } })).status).toBe(400);
    expect((await s.request('/api/assets/icons', { method: 'POST', body: { keys: keys(ASSET_KEYS_MAX) } })).status).toBe(200);
    expect((await s.request('/api/assets/icons', { method: 'POST', body: { keys: 'x' } })).status).toBe(400);
    expect((await s.request('/api/assets/blocks', { method: 'POST', body: { blocks: [{ id: 'a:b', meta: -1 }] } })).status).toBe(400);
    expect((await s.request('/api/assets/blocks', { method: 'POST', body: { blocks: [], facing: 9 } })).status).toBe(400);
    expect((await s.request('/api/assets/covers', { method: 'POST', body: { items: keys(ASSET_KEYS_MAX + 1) } })).status).toBe(400);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/assets/service.test.ts tests/unit/http/assets-routes.test.ts`
Expected: FAIL — missing `src/server/assets/service.ts`; the route tests get 404 `{error:'not-found'}` from the router.

- [ ] **Step 3: Implement `service.ts`, `routes/assets.ts`, the `api.ts` additions and the `ROUTE_MODULES` entry** as specified.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/assets/service.test.ts tests/unit/http/assets-routes.test.ts && npm run typecheck`
Expected: PASS (`Test Files  2 passed`), typecheck exits 0. (The `%E0%A4%A` case relies on Architecture change request 2; until it is granted the server answers 500 and that case fails.)

- [ ] **Step 5: Commit**

```bash
git add src/server/assets/service.ts src/server/http/routes/assets.ts src/server/http/routes/index.ts src/shared/types/api.ts tests/unit/assets/service.test.ts tests/unit/http/assets-routes.test.ts
git commit -m "feat(assets): asset service with live reload and /api/assets file, icon, block and cover routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: Client texture loading, compositing and icon batching

**Files:**
- Create: `src/client/assets/texture-image.ts`, `src/client/assets/composite.ts`, `src/client/assets/icon-batcher.ts`
- Test: `tests/client/assets.test.tsx` (the client vitest project runs in `node`, Plan 2 Task 15, so DOM calls are injected)

**Interfaces:**
- Consumes: `TextureLayer`, `IconDescriptor`, `hashColor`, `Rgb` (Task 1); `ASSET_KEYS_MAX` (Task 12); `StuffKey` (Plan 1).
- Produces:
  - `src/client/assets/texture-image.ts` — the small shared loader Plan 5's 3D view also uses:
    ```ts
    export function assetFileUrl(path: string): string;                                  // '/api/assets/file/' + every segment encodeURIComponent'd
    export function frameHeight(width: number, height: number, frames?: number): number; // frames > 1 → floor(height / frames), else min(width, height)
    export interface LayerImageDeps { fetch: typeof fetch; createImageBitmap: typeof createImageBitmap }
    export function loadLayerBitmap(layer: TextureLayer, size?: number, deps?: LayerImageDeps): Promise<ImageBitmap | null>;
    ```
    `loadLayerBitmap`: `fetch(assetFileUrl(layer.path), { credentials: 'same-origin' })`; non-2xx or any error → `null`; `createImageBitmap(blob)` to learn the size, then `createImageBitmap(decoded, 0, 0, width, frameHeight(width, height, layer.frames), size ? { resizeWidth: size, resizeHeight: size, resizeQuality: 'pixelated' } : undefined)` — frame 0 only (Global Constraints). Results (including `null`) are cached per `path|size` as promises; the tint is not applied here (the 3D view tints in its shader, icons in `compositeLayers`).
  - `src/client/assets/composite.ts` (pure):
    ```ts
    export interface LayerPixels { data: Uint8ClampedArray; width: number; height: number; tint?: Rgb }
    export function compositeLayers(size: number, layers: readonly LayerPixels[]): Uint8ClampedArray;   // every layer is size×size RGBA
    export function solidPixels(size: number, rgb: Rgb): Uint8ClampedArray;
    ```
    Layers are drawn bottom to top with straight-alpha source-over (`outA = sa + da·(1 − sa)`, `outC = (sc·sa + dc·da·(1 − sa)) / outA`, all in 0..1, rounded to 0..255; `outA = 0` gives `[0,0,0,0]`); a layer's `tint` first multiplies its RGB (`c · t / 255`), alpha untouched. Glow layers are drawn like any other layer in a flat icon.
  - `src/client/assets/icon-batcher.ts`:
    ```ts
    export interface IconBatcher { get(key: StuffKey): Promise<IconDescriptor> }
    export function createIconBatcher(fetchBatch: (keys: StuffKey[]) => Promise<IconDescriptor[]>, opts?: { max?: number /* ASSET_KEYS_MAX */; schedule?: (run: () => void) => void /* fn => setTimeout(fn, 0) */ }): IconBatcher;
    ```
    Keys asked for before the scheduled run are collected (each distinct key once) and sent in chunks of at most `max`, one `fetchBatch` call per chunk. A descriptor is cached for the life of the page (later `get`s return the same promise without a request). Keys missing from a response resolve to `{ key, layers: [], source: 'fallback', fallbackColor: hashColor(key) }`. A failed chunk rejects its keys' promises and forgets them, so a later `get` asks again.

- [ ] **Step 1: Write the failing test**

`tests/client/assets.test.tsx`:

```tsx
import { describe, it, expect, vi } from 'vitest';
import { compositeLayers, solidPixels } from '../../src/client/assets/composite.ts';
import { createIconBatcher } from '../../src/client/assets/icon-batcher.ts';
import { assetFileUrl, frameHeight, loadLayerBitmap } from '../../src/client/assets/texture-image.ts';
import { hashColor, type IconDescriptor } from '../../src/shared/types/assets.ts';

const one = (rgba: number[], tint?: [number, number, number]) => ({ data: new Uint8ClampedArray(rgba), width: 1, height: 1, ...(tint ? { tint } : {}) });

describe('compositeLayers', () => {
  it('tints by multiplying RGB and leaves alpha alone', () => {
    expect([...compositeLayers(1, [one([200, 100, 50, 255], [128, 255, 0])])]).toEqual([100, 100, 0, 255]);
  });
  it('draws later layers over earlier ones with straight alpha', () => {
    expect([...compositeLayers(1, [one([0, 0, 255, 255]), one([255, 0, 0, 128])])]).toEqual([128, 0, 127, 255]);
    expect([...compositeLayers(1, [one([0, 0, 255, 128]), one([255, 0, 0, 128])])]).toEqual([170, 0, 85, 192]);
    expect([...compositeLayers(1, [one([9, 9, 9, 0])])]).toEqual([0, 0, 0, 0]);
  });
  it('fills a solid colour', () => {
    expect([...solidPixels(2, [1, 2, 3])]).toEqual([1, 2, 3, 255, 1, 2, 3, 255, 1, 2, 3, 255, 1, 2, 3, 255]);
  });
});

describe('createIconBatcher', () => {
  const desc = (key: string): IconDescriptor => ({ key, layers: [], source: 'gt', fallbackColor: [1, 2, 3] });
  function harness(max = 500, fail = false) {
    const calls: string[][] = [];
    let pending: (() => void) | null = null;
    const b = createIconBatcher(async (keys) => {
      calls.push(keys);
      if (fail) throw new Error('boom');
      return keys.filter((k) => k !== 'missing').map(desc);
    }, { max, schedule: (fn) => { pending = fn; } });
    return { b, calls, flush: () => { const f = pending; pending = null; f?.(); } };
  }

  it('collects one tick of requests, de-duplicated, and caches the answers', async () => {
    const h = harness();
    const p = [h.b.get('a'), h.b.get('b'), h.b.get('a')];
    h.flush();
    expect((await Promise.all(p)).map((d) => d.key)).toEqual(['a', 'b', 'a']);
    expect(h.calls).toEqual([['a', 'b']]);
    expect((await h.b.get('a')).key).toBe('a');
    expect(h.calls).toHaveLength(1);
  });

  it('splits large batches at the server cap', async () => {
    const h = harness(500);
    const p = Array.from({ length: 1201 }, (_, i) => h.b.get(`k${i}`));
    h.flush();
    await Promise.all(p);
    expect(h.calls.map((c) => c.length)).toEqual([500, 500, 201]);
  });

  it('answers keys the server left out with a fallback', async () => {
    const h = harness();
    const p = h.b.get('missing');
    h.flush();
    expect(await p).toEqual({ key: 'missing', layers: [], source: 'fallback', fallbackColor: hashColor('missing') });
  });

  it('forgets failed keys so a later request retries', async () => {
    const h = harness(500, true);
    const p = h.b.get('a');
    h.flush();
    await expect(p).rejects.toThrow('boom');
    const q = h.b.get('a');
    h.flush();
    await expect(q).rejects.toThrow('boom');
    expect(h.calls).toEqual([['a'], ['a']]);
  });
});

describe('texture images', () => {
  it('builds file URLs segment by segment', () => {
    expect(assetFileUrl('nei/icons/a b#c.png')).toBe('/api/assets/file/nei/icons/a%20b%23c.png');
  });

  it('takes frame 0 of animated strips', () => {
    expect(frameHeight(16, 64, 4)).toBe(16);
    expect(frameHeight(16, 512, 32)).toBe(16);
    expect(frameHeight(32, 32)).toBe(32);
    expect(frameHeight(16, 48)).toBe(16);
  });

  it('loads, crops, resizes and caches a layer; null when it cannot', async () => {
    const calls: unknown[][] = [];
    const bitmap = (width: number, height: number) => ({ width, height, close() {} }) as unknown as ImageBitmap;
    const deps = {
      fetch: vi.fn(async (url: string) => (url.endsWith('missing.png') ? new Response('', { status: 404 }) : new Response(new Uint8Array([1])))) as unknown as typeof fetch,
      createImageBitmap: vi.fn(async (...args: unknown[]) => { calls.push(args); return args.length > 1 ? bitmap(16, 16) : bitmap(16, 64); }) as unknown as typeof createImageBitmap,
    };
    const b = await loadLayerBitmap({ path: 'x/textures/blocks/a.png', frames: 4 }, 16, deps);
    expect(b).not.toBeNull();
    expect(calls[1]!.slice(1)).toEqual([0, 0, 16, 16, { resizeWidth: 16, resizeHeight: 16, resizeQuality: 'pixelated' }]);
    expect(await loadLayerBitmap({ path: 'x/textures/blocks/a.png', frames: 4 }, 16, deps)).toBe(b);
    expect(deps.fetch).toHaveBeenCalledTimes(1);
    expect(await loadLayerBitmap({ path: 'x/textures/blocks/missing.png' }, 16, deps)).toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project client tests/client/assets.test.tsx`
Expected: FAIL — missing modules under `src/client/assets/`.

- [ ] **Step 3: Implement the three modules** as specified (`src/client/**` uses browser APIs only; `ASSET_KEYS_MAX` comes from `src/shared/types/api.ts`).

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run --project client tests/client/assets.test.tsx && npm run typecheck`
Expected: PASS (`Test Files  1 passed`), typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/client/assets/texture-image.ts src/client/assets/composite.ts src/client/assets/icon-batcher.ts tests/client/assets.test.tsx
git commit -m "feat(client): texture layer loading, icon compositing and batched icon lookups

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: Real `ItemIcon`

**Files:**
- Create: `src/client/assets/icons.ts`
- Modify: `src/client/components/ItemIcon.tsx` (Plan 2 placeholder → real body, same export and props)
- Test: `tests/client/item-icon.test.tsx` (Plan 2's `tests/client/scaffold.test.tsx` must keep passing unchanged)

**Interfaces:**
- Consumes: `createIconBatcher`, `IconBatcher` (Task 13), `loadLayerBitmap`, `compositeLayers`, `LayerPixels` (Task 13); `apiPost` (Plan 2, `src/client/api/client.ts`); `IconDescriptor`, `hashColor` (Task 1); `StuffKey` (Plan 1).
- Produces:
  - `src/client/assets/icons.ts`:
    ```ts
    export const iconBatcher: IconBatcher;                                            // fetchBatch = keys => apiPost<IconDescriptor[]>('/api/assets/icons', { keys })
    export function iconPixelSize(cssSize: number): number;                           // max(16, round(cssSize × (globalThis.devicePixelRatio || 1)))
    export function iconImageUrl(desc: IconDescriptor, px: number): Promise<string | null>;
    export function useItemIcon(key: StuffKey, cssSize: number): { desc: IconDescriptor | null; url: string | null };
    ```
    `iconImageUrl`: each layer → `loadLayerBitmap(layer, px)` → drawn on an `OffscreenCanvas(px, px)` and read back with `getImageData` (the layer's `tint` kept) → `compositeLayers(px, …)` → `putImageData` → `convertToBlob({ type: 'image/png' })` → `URL.createObjectURL`; cached per `key|px`; `null` when no layer loads. `useItemIcon` starts with `{ desc: null, url: null }`, then (in an effect, cancelled when the key or size changes) asks `iconBatcher.get(key)` and, when the descriptor has layers, `iconImageUrl(desc, iconPixelSize(cssSize))`; errors leave the placeholder.
  - `src/client/components/ItemIcon.tsx`: `export function ItemIcon(props: { itemKey: StuffKey; size?: number }): ReactElement` (unchanged signature, `size` default 24) and `export function placeholderLetters(key: StuffKey): string` (the first two letters or digits of the part after the last `:` of the registry name — for fluids the part after `fluid:` — upper-cased). Root `<span>` with `title={itemKey}`, `data-item-key={itemKey}`, `data-icon-source={desc?.source ?? 'loading'}`, inline style `width`/`height` = `size` px, `display: 'inline-flex'`, rounded corners; inside, the composited `<img src={url} width={size} height={size} alt="" style={{ imageRendering: 'pixelated' }} />` once `url` is set, else the placeholder: background `rgb(r, g, b)` of `desc?.fallbackColor ?? hashColor(itemKey)` with `placeholderLetters(itemKey)` (so a fallback icon is the spec §3.8 plain colour).

- [ ] **Step 1: Write the failing test**

`tests/client/item-icon.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { ItemIcon, placeholderLetters } from '../../src/client/components/ItemIcon.tsx';
import { iconPixelSize } from '../../src/client/assets/icons.ts';

describe('ItemIcon', () => {
  it('renders the placeholder until the icon is ready', () => {
    const html = renderToStaticMarkup(<ItemIcon itemKey="fluid:water" size={16} />);
    expect(html).toContain('data-item-key="fluid:water"');
    expect(html).toContain('data-icon-source="loading"');
    expect(html).toContain('title="fluid:water"');
    expect(html).toContain('width:16px');
    expect(html).toContain('rgb(89, 192, 106)');
    expect(html).toContain('>WA<');
  });

  it('keeps the placeholder letters', () => {
    expect(placeholderLetters('gregtech:gt.metaitem.01@2032')).toBe('GT');
    expect(placeholderLetters('fluid:molten.iron')).toBe('MO');
    expect(placeholderLetters('t:iron_ingot@0')).toBe('IR');
  });

  it('renders at least 16 device pixels', () => {
    expect(iconPixelSize(8)).toBe(16);
    expect(iconPixelSize(24)).toBe(24);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run --project client tests/client/item-icon.test.tsx`
Expected: FAIL — `placeholderLetters` is not exported and `src/client/assets/icons.ts` is missing.

- [ ] **Step 3: Implement `icons.ts` and the new `ItemIcon` body** as specified.

- [ ] **Step 4: Run the client tests to verify they pass**

Run: `npx vitest run --project client && npm run typecheck`
Expected: PASS — every client test file, including Plan 2's `scaffold.test.tsx` (`title="gregtech:gt.metaitem.01@2032"`, `width:32px`); typecheck exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/client/assets/icons.ts src/client/components/ItemIcon.tsx tests/client/item-icon.test.tsx
git commit -m "feat(client): ItemIcon draws the game's item and fluid icons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Real-data check (`GTNH_LOCAL=1`)

**Files:**
- Create: `tests/unit/assets/real-assets.test.ts` (committed; skips unless `GTNH_LOCAL=1`; holds only public pack facts from the research docs)
- Create, never commit: `docs/local/asset-runs.md`

**Interfaces:**
- Consumes: everything above; Plan 1's `npm run export` (APFS clone on port 25566, never the live server), `loadPack`, `activeExportDir`, `loadConfig`; the server folder path from `docs/local/environment.md` (typed on the command line only).
- Produces: a real export with `textures.json.gz`, a filled `data/assets/`, the run record in `docs/local/asset-runs.md`, and fixes for whatever the run exposes (each in its own commit, with a test where TypeScript is involved; curated-table fixes come from the real `data/assets/index.json`).

Rules for this task: never start, stop or restart the live server; its folder is only read (jars opened read-only, `ls`, `find -newer`, `tail` of its log).

- [ ] **Step 1: Write the real-data checklist** `tests/unit/assets/real-assets.test.ts`

```ts
import { beforeAll, describe, expect, it } from 'vitest';
import { join } from 'node:path';
import { activeExportDir, loadConfig } from '../../../src/server/config.ts';
import { loadPack } from '../../../src/server/pack/load.ts';
import { loadAssetIndex, type AssetIndex } from '../../../src/server/assets/index.ts';
import { loadTexturesDump } from '../../../src/server/assets/textures-dump.ts';
import { loadNeiIndex } from '../../../src/server/assets/nei.ts';
import { curatedIds } from '../../../src/server/assets/curated.ts';
import { resolveBlocks, resolveIcons, type AssetSources } from '../../../src/server/assets/resolve.ts';
import { FACES } from '../../../src/shared/types/assets.ts';

const GT = 'gregtech/textures/blocks/';

describe.skipIf(process.env.GTNH_LOCAL !== '1')('real assets (GTNH 2.9.0-RC-1)', () => {
  let index: AssetIndex;
  let src: AssetSources;
  beforeAll(async () => {
    const cfg = loadConfig();
    index = await loadAssetIndex(join(cfg.dataDir, 'assets'));
    const exportDir = activeExportDir(cfg);
    src = { index, dump: await loadTexturesDump(exportDir, index), nei: await loadNeiIndex(join(cfg.dataDir, 'assets')), pack: await loadPack(exportDir) };
  }, 300_000);

  it('extracted the mod jars and the official client jar', () => {
    expect(index.size).toBeGreaterThan(50_000);                                           // research §2.2: 50,205 mod PNGs + 563 vanilla
    expect(index.file!.sources.find((s) => s.kind === 'client')!.sha1).toBe('e80d9b3bf5085002218d4be59e668bac718abbc6');
    expect(index.has('minecraft/textures/blocks/stone.png')).toBe(true);
    expect(index.info(GT + 'fluids/fluid.autogenerated.png')).toMatchObject({ w: 16, h: 512, frames: 32 });   // research §2.4
    expect(index.file!.conflicts.find((c) => c.path === 'gregtech/textures/items/gt.metaitem.01/606.png')!.winner).toMatch(/^GTNewHorizonsCoreMod/);
  });

  it('has a texture dump that reconstructs GT machines and casings', () => {
    const d = src.dump!;
    expect(d.mte.size).toBeGreaterThan(2_000);
    expect([...d.mte.values()].filter((m) => m.error).length / d.mte.size).toBeLessThan(0.05);
    const [mac] = resolveBlocks(src, [{ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 301 }]);       // MACERATOR_LV, research §3.3
    expect(mac!.faces.north.map((l) => l.path)).toEqual([GT + 'iconsets/MACHINE_LV_SIDE.png', GT + 'basicmachines/macerator/OVERLAY_FRONT.png']);
    expect(mac!.faces.up.map((l) => l.path)).toEqual([GT + 'iconsets/MACHINE_LV_TOP.png', GT + 'basicmachines/macerator/OVERLAY_TOP.png']);
    expect(mac!.faces.down.map((l) => l.path)).toEqual([GT + 'iconsets/MACHINE_LV_BOTTOM.png']);
    expect(resolveBlocks(src, [{ id: 'gregtech:gt.blockcasings2', meta: 0 }])[0]!.faces.up.map((l) => l.path)).toEqual([GT + 'iconsets/MACHINE_CASING_SOLID_STEEL.png']);
    expect(resolveBlocks(src, [{ id: 'gregtech:gt.blockcasings2', meta: 1 }])[0]!.faces.north.map((l) => l.path)).toEqual([GT + 'iconsets/MACHINE_CASING_FROST_PROOF.png']);   // research §3.7
  });

  it('draws GT material items and GT fluids from the game files', () => {
    const [ingot, molten] = resolveIcons(src, ['gregtech:gt.metaitem.01@11032', 'fluid:molten.iron']);
    expect(ingot).toMatchObject({ source: 'gt', layers: [{ tint: [200, 200, 200] }] });
    expect(ingot!.layers[0]!.path).toMatch(/^gregtech\/textures\/items\/materialicons\//);
    expect(molten!.source).toBe('gt');
    expect(molten!.layers[0]!.path).toBe(GT + 'fluids/fluid.molten.autogenerated.png');
  });

  it('every curated entry names a real block and an extracted texture', () => {
    const pseudo = /^(fmp|conduit|ae2cable):/;
    expect(curatedIds().filter((id) => !pseudo.test(id) && !src.dump!.blockIds.has(id))).toEqual([]);
    const broken = curatedIds().flatMap((id) => {
      const b = resolveBlocks(src, [{ id, meta: 0 }])[0]!;
      return FACES.filter((f) => b.faces[f].length === 0).map((f) => `${id} ${f}`);
    });
    expect(broken).toEqual([]);
  });

  it('reports coverage', () => {
    const machines = [...src.pack!.machines.keys()].map((mteId) => ({ id: 'gregtech:gt.blockmachines', meta: 0, mteId }));
    const blocks = resolveBlocks(src, machines);
    const keys = [...src.pack!.items.keys(), ...src.pack!.fluids.keys()];
    const icons = resolveIcons(src, keys);
    const machineShare = blocks.filter((b) => b.resolved).length / blocks.length;
    const iconShare = icons.filter((i) => i.source !== 'fallback').length / icons.length;
    console.log(`machines fully textured ${(100 * machineShare).toFixed(1)} %, icons from the game ${(100 * iconShare).toFixed(1)} % of ${keys.length}`);
    expect(machineShare).toBeGreaterThan(0.9);
    expect(iconShare).toBeGreaterThan(src.nei ? 0.9 : 0.25);
  });
});
```
Run: `npx vitest run tests/unit/assets/real-assets.test.ts`
Expected: the file reports `skipped` (no `GTNH_LOCAL`).

- [ ] **Step 2: Preflight (read-only)**

Run: `lsof -nP -iTCP:25566 -sTCP:LISTEN; df -h .; pgrep -fl lwjgl3ify-forgePatches.jar; touch .local/assets-start.marker`
Expected: nothing listening on 25566; tens of GB free; note whether the live server process is listed (it must be the same after the run).

- [ ] **Step 3: Build the exporter with the texture section**

Run: `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.2.0 ./gradlew test assemble) && exporter-mod/scripts/check-reobf.sh exporter-mod/build/libs/gtnhplannerexport-0.2.0.jar`
Expected: `BUILD SUCCESSFUL`, `reobf OK: <n> classes`.

- [ ] **Step 4: Export on the clone**

Run: `npm run export -- --server "<server folder from docs/local/environment.md>" --jar exporter-mod/build/libs/gtnhplannerexport-0.2.0.jar && ls -l "data/export/$(node -p "require('./data/config.json').activeExportId")/textures.json.gz" && node -p "const c=require('./data/config.json');const m=require('./data/export/'+c.activeExportId+'/manifest.json');JSON.stringify({failed:m.failedSections,ms:m.sectionMillis.textures,warn:m.warnings.filter(w=>w.startsWith('textures')).slice(0,5)})"`
Expected: `Active export: …`, exit 0; `textures.json.gz` exists (a few MB); `failed` does not contain `textures`. If the texture section failed, read `export-run.log` and the `textures …` warnings, fix the exporter, rebuild and re-run.

- [ ] **Step 5: Extract the pack's textures**

Run: `npm run extract-assets -- --server "<server folder>"` (add `--client-jar <path>` when the client jar is not in Prism's default library folder)
Expected: `Extracted <≈50,000+> textures (<n> MB) from <≈220> jars into data/assets`, a conflict list naming `GTNewHorizonsCoreMod-…jar over gregtech-…jar` entries, exit 0.

- [ ] **Step 6: Confirm the live server was not touched**

Run: `S="<server folder>"; find "$S/mods" "$S/config" "$S/server.properties" "$S/World" -newer .local/assets-start.marker | head; pgrep -fl lwjgl3ify-forgePatches.jar; tail -n 40 "$S/logs/latest.log"`
Expected: `find` prints nothing; the process list matches Step 2; no lag or crash lines from the run window.

- [ ] **Step 7: Run the checklist on the real data**

Run: `GTNH_LOCAL=1 npx vitest run tests/unit/assets/real-assets.test.ts`
Expected: 5 passed and the coverage line. A failing expectation is a finding: fix the code (exporter, resolver or curated table, looking names up in `data/assets/index.json` and the dump's `blockIds`); change an expectation only when the pack itself differs from the research, and note the evidence in `docs/local/asset-runs.md`.

- [ ] **Step 8: Record the run (local only)**

Write `docs/local/asset-runs.md`: date, `exportId`, exporter version, `sectionMillis.textures`, size of `textures.json.gz`, `stats` from the dump (MTE failures with the first ids and errors, `unknown:<class>` counts), extraction time and file count, the conflict list, curated fixes made, the coverage line. Then `git status --short docs/local data .local` → prints nothing.

- [ ] **Step 9: Commit the checklist (and any fixes made above)**

```bash
git add tests/unit/assets/real-assets.test.ts
git commit -m "test(assets): GTNH_LOCAL checklist for real textures and icons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: End-to-end check and README section

**Files:**
- Create: `tests/e2e/assets-fixture.ts`, `tests/e2e/assets.spec.ts`
- Modify: `tests/e2e/prepare.ts` (Plan 2; after the export and config are written, call `prepareAssets('data/e2e', 'data/e2e/export/e2e')`), `README.md` (section "Textures and icons")

**Interfaces:**
- Consumes: Plan 2's Playwright harness (`login(page)`, `setName(page, name)`, `createProject(page, name)` from `tests/e2e/helpers.ts`, architecture §11.7; `prepare.ts`; base URL `http://127.0.0.1:18787`; the project page's `Search items and fluids` box, `Tier` select and `Materials & steps` tab; `MINI_GT` items `t:iron_ingot@0` "Iron Ingot", `t:copper_wire@0` "1x Copper Wire", `t:iron_plate@0`); `writeAssetsDir` (Task 7), `writeTexturesDump` (Task 7), `gtSampleFile`, `GT_SAMPLE_ASSETS` (Task 8); everything this plan ships.
- Produces: `tests/e2e/assets-fixture.ts`: `export const E2E_INGOT_RGBA: [number, number, number, number] = [200, 60, 60, 255]`; `export function prepareAssets(dataDir: string, exportDir: string): Promise<void>` — `writeAssetsDir(dataDir, { ...GT_SAMPLE_ASSETS, 't/textures/items/iron_ingot.png': { color: E2E_INGOT_RGBA } })` and `writeTexturesDump(exportDir, { ...gtSampleFile(), textureNames: { blocks: {}, items: { 't:iron_ingot': 't:iron_ingot' } } })` (all synthetic, under the gitignored `data/e2e/`).

- [ ] **Step 1: Write the end-to-end spec**

`tests/e2e/assets.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { login, setName, createProject } from './helpers.ts';
import { E2E_INGOT_RGBA } from './assets-fixture.ts';

function centrePixel(img: HTMLImageElement): number[] {
  const c = document.createElement('canvas');
  c.width = img.naturalWidth; c.height = img.naturalHeight;
  const g = c.getContext('2d')!;
  g.drawImage(img, 0, 0);
  return [...g.getImageData(c.width >> 1, c.height >> 1, 1, 1).data];
}

test('search results and the materials list show the pack textures, with a plain colour where there is none', async ({ page }) => {
  await login(page); await setName(page, 'Ann');
  await createProject(page, 'Icons');
  const search = page.getByPlaceholder('Search items and fluids');
  await search.fill('Iron Ingot');
  const ingot = page.getByRole('option', { name: /Iron Ingot/ }).locator('[data-item-key="t:iron_ingot@0"]');
  await expect(ingot).toHaveAttribute('data-icon-source', 'jar');
  await expect(ingot.locator('img')).toBeVisible();
  expect(await ingot.locator('img').evaluate(centrePixel)).toEqual(E2E_INGOT_RGBA);
  await search.fill('Copper Wire');
  const wire = page.getByRole('option', { name: /Copper Wire/ }).locator('[data-item-key="t:copper_wire@0"]');
  await expect(wire).toHaveAttribute('data-icon-source', 'fallback');
  await expect(wire.locator('img')).toHaveCount(0);
  await search.fill('Iron Plate');
  await page.getByRole('option', { name: /Iron Plate/ }).click();
  await page.getByLabel('Tier').selectOption('LV');
  await page.getByRole('tab', { name: 'Materials & steps' }).click();
  await expect(page.locator('[data-row="run:t:iron_ingot@0"] [data-item-key="t:iron_ingot@0"] img')).toBeVisible();
});

test('asset routes answer logged-in users only and describe GT fluids and machines', async ({ page, browser }) => {
  await login(page);
  const file = await page.request.get('/api/assets/file/t/textures/items/iron_ingot.png');
  expect(file.status()).toBe(200);
  expect(file.headers()['content-type']).toBe('image/png');
  const [water] = await (await page.request.post('/api/assets/icons', { data: { keys: ['fluid:water'] } })).json();
  expect(water).toMatchObject({ source: 'gt', layers: [{ path: 'gregtech/textures/blocks/fluids/fluid.water.png', tint: [0, 0, 255], frames: 4 }] });
  const [mac] = await (await page.request.post('/api/assets/blocks', { data: { blocks: [{ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 301 }], facing: 5 } })).json();
  expect(mac.faces.east.map((l: { path: string }) => l.path)).toEqual(['gregtech/textures/blocks/iconsets/MACHINE_LV_SIDE.png', 'gregtech/textures/blocks/basicmachines/macerator/OVERLAY_FRONT.png']);
  const stranger = await browser.newContext({ baseURL: 'http://127.0.0.1:18787' });
  expect((await stranger.request.get('/api/assets/file/t/textures/items/iron_ingot.png')).status()).toBe(401);
  await stranger.close();
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `npm run e2e -- tests/e2e/assets.spec.ts`
Expected: FAIL — `Cannot find module './assets-fixture.ts'` (then, once the fixture exists but `prepare.ts` does not call it, the icon stays `fallback`).

- [ ] **Step 3: Write `assets-fixture.ts` and call `prepareAssets` from `prepare.ts`**

- [ ] **Step 4: Run the whole suite**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: typecheck exits 0; every vitest file passes (the `GTNH_LOCAL` checklists report skipped); every Playwright spec passes, Plan 2's included.

- [ ] **Step 5: Check that nothing game-derived is tracked** (spec §3.12)

Run: `git status --short data .local docs/local; git ls-files | grep -E '\.(png|mcmeta|jar|gz)$' | grep -v '^exporter-mod/gradle/wrapper/gradle-wrapper.jar$'`
Expected: both print nothing.

- [ ] **Step 6: Write the README section "Textures and icons"** (after Plan 1's "Export your pack"), with this content:
  - The planner draws blocks and items with your own pack's textures; nothing game-made is in the repository — it is extracted into `data/assets/` (gitignored) and served only to people logged in to the planner.
  - `npm run extract-assets` reads `mods/*.jar` of the server folder in `data/config.json` (or `--server <folder>`), read-only, plus the official Minecraft 1.7.10 client jar: Prism Launcher keeps it at `~/Library/Application Support/PrismLauncher/libraries/com/mojang/minecraft/1.7.10/minecraft-1.7.10-client.jar`, the official launcher at `~/Library/Application Support/minecraft/versions/1.7.10/1.7.10.jar`; otherwise pass `--client-jar <path>` or set `"clientJar"` in `data/config.json`. Its SHA-1 must be `e80d9b3bf5085002218d4be59e668bac718abbc6`.
  - `npm run export` also writes `textures.json.gz`, which tells the planner how GregTech draws each machine, casing, cover, material item and fluid. After a pack update, run both again; a running planner picks the new files up on its next request, and a failed extraction keeps the previous textures.
  - When two jars ship the same texture: a mod beats vanilla, then a jar that overrides another mod's texture beats that mod's own jar (GTNewHorizonsCoreMod over gregtech), then the jar whose name sorts last; `data/assets/index.json` lists every conflict.
  - Optional icons for everything else: in a **copy** of the client instance (never the one you play with), in a creative single-player world, open NEI options → Tools → Data Dumps → Item Panel; with an empty search box and every collapsible group expanded, dump CSV, then Json, then PNG in the same session; then `npm run import-nei-icons -- --csv <copy>/.minecraft/dumps/itempanel.csv --json <copy>/.minecraft/dumps/itempanel.json --png <copy>/.minecraft/dumps/itempanel_icons`. A dump whose rows and images do not line up is refused.
  - Anything without a texture is drawn in a plain colour: by machine kind for blocks, by material for GT items, otherwise a fixed colour per item.

- [ ] **Step 7: Commit**

```bash
git add tests/e2e/assets-fixture.ts tests/e2e/assets.spec.ts tests/e2e/prepare.ts README.md
git commit -m "test(e2e): real icons in search and materials lists; docs: textures and icons

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

## Architecture change requests

The tasks above assume these are granted. Each is additive; nothing in the architecture is renamed.

1. **`AppConfig.clientJar` (architecture §9, Plan 1/2 `src/server/config.ts`).** Why: `npm run extract-assets` takes the 1.7.10 client jar "from config or flag", and a friend's clone may keep it outside the launcher folders. Diff: `clientJar?: string | null` in `AppConfig`; `loadConfig()` fills `null` when absent; nothing else reads it.
2. **Malformed percent-encoding is a 400 (Plan 2 `matchRoute`).** Why: `GET /api/assets/file/*` must answer 400 or 404 to crafted URLs (Review Focus 3); today a param such as `%E0%A4%A` makes `decodeURIComponent` throw a `URIError`, which the server turns into a 500. Diff: `matchRoute` catches the `URIError` and throws `HttpError(400, 'bad-path', 'Malformed URL')`.
3. **Java test setup in Plan 1's exporter project.** Why: the casing parser and the texture flattener are pure Java and worth unit tests, while Plan 1's convention ("Java tasks have no unit tests") was written for code that needs a running server. Diff (Task 4): `exporter-mod/dependencies.gradle` gains `compileOnly`/`testImplementation` `org.ow2.asm:asm-tree:9.4`, `testImplementation` `com.google.code.gson:gson:2.2.4` and `org.junit.jupiter:junit-jupiter:5.11.4`, `testRuntimeOnly` `org.junit.platform:junit-platform-launcher:1.11.4`; new `exporter-mod/addon.gradle` with `useJUnitPlatform()`. ASM is not bundled (the pack ships asm-tree 9.4; FML uses the tree API).
4. **Export folder gains `textures.json.gz` (granted in architecture §11.3; one point to confirm).** The optional section `textures` writes one gzip'd JSON document through `ExportContext.gzipJson`; it is not a JSONL table and is not counted, so `EXPORT_FILES` does not change. Please confirm that Plan 1's validation ignores files outside `EXPORT_FILES` and that `textures` in `failedSections` does not block activation, as for `structures`.
5. **Pseudo block ids for parts (architecture §6.5 helpers).** Why: Project Red pipes, EnderIO conduits and AE2 cable types share one world block each, but the 3D view and block list must draw them apart. Diff: `src/shared/types/assets.ts` exports `partBlockRef(partId)` → `{ id: 'fmp:<partId>', meta: 0 }`, `conduitBlockRef(type)` → `{ id: 'conduit:<type>', meta: 0 }` and `ae2CableBlockRef(center)` → `{ id: 'ae2cable:<center>', meta: 0 }`, plus `FACES`, `rotateFaces`, `hashColor`, `KIND_COLORS`; Plan 5 builds `LayoutBlock.block` for routed pipes, conduits and AE2 cables with them (Plan 4's `PrPipeType`, `ConduitType` and `Ae2Rec.center` values map onto the part ids, conduit types and centres listed in Task 9).
6. **Shared end-to-end harness (granted in architecture §11.7).** Plan 3 uses `login(page)`, `setName(page, name)` and `createProject(page, name)` as defined there and extends `tests/e2e/prepare.ts` with `prepareAssets(...)` (Task 16); it starts no second server.
7. **`POST /api/assets/covers` (architecture §6.5 and §7, new row).** Why: granted change request 14 (§11.14) has the 3D view draw covers on machine faces, and the in-world overlay of a GT cover (for example `OVERLAY_CONVEYOR`) is known only from the exporter's cover table, not from the cover item's icon. Diff: `POST /api/assets/covers {items: StuffKey[]}` → `CoverLayers[]` with `interface CoverLayers { item: StuffKey; layers: TextureLayer[] }` in `src/shared/types/assets.ts`, `AssetCoversRequest` in `api.ts`, at most `ASSET_KEYS_MAX` items, logged-in users only; `layers` is `[]` for an unknown cover, and the 3D view then falls back to the item icon.
