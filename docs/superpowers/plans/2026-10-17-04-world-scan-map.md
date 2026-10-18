# World Scan & Map Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Read the group's GTNH 2.9 world without ever disturbing the live server (newest complete backup zip, a snapshot copy, or a friend's upload), find bases, machines, power, logistics, storage, visited dimensions and prospected veins, feed that into the planner as a `PlanContext`, and draw it on a block-accurate top-down map with notes.

**Architecture:** A worker thread (`scan.worker.ts`) streams region files out of a zip or folder, skip-parses every chunk for `InhabitedTime` and whitelisted tile entities (never building objects for GT ore TEs), classifies them (`classify/*.ts`), clusters bases, builds power/logistics/storage graphs, copies the region files around bases into `data/scans/<id>/regions/`, and writes `scan.json` + `palette.json`. The main thread only tracks status; map tiles and `readArea` voxels are decoded on demand from the copied regions. The client gets a `map` project tab (canvas `MapView`, overlays, note pins, "Found in world" panel, base picker) and a top-level World page (sources, scans, uploads via folder picker or zip.js).

**Tech Stack:** TypeScript 6.0.3 on Node 24 (type stripping, `node:worker_threads`, `node:zlib`), yauzl 3.4.0, React 19 + canvas 2D, @zip.js/zip.js 2.22.1 (browser), vitest 5, Playwright 1.63.

**Spec:** `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` (§3.3b, §3.4, §3.5, §3.7, §5 anti-goals). Contracts: `docs/superpowers/plans/2026-10-17-00-architecture.md` (§2, §5, §6.6, §7, §7.1, §7.2, §9, §10) — authoritative. Facts: `docs/research/world-format.md` (primary), `docs/research/materials-availability.md` §6–§7, `docs/research/gt-mechanics.md` §3.2–§4.4 and §6.4, `docs/research/web-stack.md` §4.2, §4.5, §5.4, §9, `docs/research/textures-icons.md` §5.

## Global Constraints

- Node `>=24.10.0 <25`; TypeScript erasable syntax only (no `enum`, `namespace`, parameter properties, decorators, `<T>x`); relative imports name the real `.ts`/`.tsx` file; type-only imports use `import type`; enums are `as const` objects.
- npm dependencies: only architecture §4 pins. This plan uses `yauzl@3.4.0`, `@types/yauzl@3.4.0`, `@zip.js/zip.js@2.22.1`; install any that are missing with `npm install --save-exact --before="$(date -v-14d +%F)" <pkg>@<ver>` and commit `package-lock.json`. Test zips are written with `node:zlib` (`deflateRawSync`, `crc32`), not a new library.
- **Never disturb the live server** (spec §5): never start/stop it, never write, rename, lock or delete anything under `config.serverFolder`. Region data is parsed only from (a) a backup zip that is *complete* — yauzl opens its central directory — **and** whose mtime is at least `BACKUP_MIN_AGE_MS = 120_000` old, (b) a snapshot copy made with `fs.copyFile(src, dst, fs.constants.COPYFILE_FICLONE)` into `data/scans/<id>/snapshot/`, or (c) an upload in `data/uploads/<uploadId>/`. Small side files outside `World/` (VisualProspecting cache, `config/StorageDrawers.cfg`) are copied the same way before reading.
- Spec §3.12 / architecture §2.2: scans live in `data/scans/<scanId>/`, uploads in `data/uploads/<uploadId>/` (gitignored). Tests build synthetic worlds with `tests/helpers/make-world.ts`; checks on the real world run only with `GTNH_LOCAL=1`. No player names, UUIDs, coordinates or server addresses in code, tests or docs.
- Spec §5 "unusable on their real world (≈910 MB, ~54 dimensions)": every chunk pass runs in a `worker_thread`; region entries are streamed one at a time (≤ ~12 MB each); `GT_TileEntity_Ores` compounds are skipped without building objects; the main thread's event-loop lag stays below 100 ms during a scan.
- World format (world-format.md §1–§5): chunk format is decided **per section** (`Blocks16` present → legacy big-endian u16 `Blocks16`/`Data16`; else EndlessIDs `Blocks` | `Add`<<8 | `BlocksB2Hi`<<12 | `BlocksB3`<<16 with the cascade, meta `Data` | `Data1High`<<4 | `Data2`<<8); section index `y<<8 | z<<4 | x`; nibble = low half for even index; `Biomes16v2` = 256 little-endian u16 (null 65535), `Biomes` = 256 u8 (null 255), column index `z<<4 | x`; block and item id maps are **separate** (`FML.ItemData` `K` prefix `\u0001` block, `\u0002` item); item stack id = `idExt` (Int) else `id` (Int or Short) else a String registry name; `Damage < 0` → 0; Long tags decode to `number`.
- Directions are ForgeDirection ordinals: 0 down (−y), 1 up (+y), 2 north (−z), 3 south (+z), 4 west (−x), 5 east (+x); connection bit for side `s` is `1 << s`.
- Units and keys (architecture §5): tiers 0..14 with `V[t] = 8·4^t`; EU/t; ticks (20 t = 1 s); fluids in L; item keys `itemKey(registryName, damage)` (scan storage keys never carry the `#nbt` suffix); fluid keys `fluid:<FluidName>`; dimension = Minecraft dim id, folder `DIM<id>`, Overworld has no prefix; world positions `[x, y, z]` + `dim`.
- Spec §3.4: every logistics and storage kind is optional; a world with none of them scans fine and yields a valid `PlanContext`. Storage whose contents cannot be read reliably has `contents: null` (found-but-unknown), never a guess.
- Spec §3.3b / materials-availability §6.2: a dimension is "visited" only by `InhabitedTime > 0` in one of its chunks, a player's `Dimension` / `Spawns` / `ReturnPortals`, a completed BetterQuesting location quest, or team prospecting there — never by region files existing.
- Drawer reach (world-format §6.6): BFS over the 6 face neighbours from the controller, a position only if `max(|dx|,|dy|,|dz|) ≤ range` and its block is a Storage Drawers networked block; stop the whole search when the drawer count would pass `maxDrawers`. Values come from `config/StorageDrawers.cfg` in the server folder (`range=4`, `maxDrawers=50` in this pack) and fall back to those numbers.
- All `/api/world/*` routes require the auth cookie (no `public: true`). Upload paths are allow-listed (`level.dat`, `region/r.<int>.<int>.mca`, `DIM<int>/region/r.<int>.<int>.mca`, `world.zip`); limits `level.dat` 32 MiB, region file 128 MiB, `world.zip` 4 GiB, 4,096 files and 8 GiB per upload.
- Commits use a conventional prefix and the message ends with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **Negative coordinates and negative dimension ids** (`r.-1.-1.mca`, `DIM-1`, chunk `cx = -1`, blocks at `x = -1`, tiles at `tx = -1`): every block, TE, tile and BFS step lands on the right column with floor division, never truncation. Tests: Task 1 "maps negative chunk coordinates", Task 8 "renders a tile at negative tile coordinates", Task 11 "reaches drawers breadth-first within range, through trim, across the x = 0 / x = -1 border", Task 15 "round-trips negative world coordinates".
2. **A backup being written, rotated or deleted while a scan runs** (ServerUtilities writes a new zip every 30 minutes and prunes old ones): only complete zips at least 2 minutes old are offered; if the file vanishes or turns unreadable mid-scan, the scan ends `failed` with a clear message, the partial scan folder is removed, and the server folder is untouched. Tests: Task 2 "skips zips that are too new or truncated", Task 12 "fails with a clear message when the source is gone", Task 13 "fails cleanly when a queued backup disappears".
3. **Torn or corrupt chunks** (snapshot copied mid-write, truncated upload, bad sector offset): the chunk is skipped and counted, the scan finishes `done` with "N chunks skipped" in its message. Tests: Task 3 "skips a corrupt chunk and keeps the rest of the region", Task 12 "completes with skipped chunks reported".
4. **Hostile or careless upload paths and sizes** (`../level.dat`, `%2e%2e/`, absolute paths, `Region/` case, `.mca` outside `region/`, a 200 MiB "region", too many files, uploading to a completed upload): 400/413/409, nothing written outside `data/uploads/<uploadId>/`, partial files removed. Tests: Task 2 "upload path %s → %i" table and "enforces size and count limits and leaves no partial file", Task 14 "runs the upload flow and refuses bad paths", Task 17 "refuses an oversized region before uploading anything".
5. **Worlds without the optional parts, or a pack/world mismatch** (only `level.dat` + one region, no AE2/drawers/routed pipes/claims/VisualProspecting, mIDs the active export does not know, no export at all): the scan still finishes with empty arrays, unknown machines stay on the map as kind `unknown` without a tier, `topTier` ignores them and `contextFromScan` drops them from `ownedMachines`. Tests: Task 4 "keeps unknown mIDs as unknown", Task 12 "scans a minimal upload: level.dat and one region, no side files", Task 14 "builds a valid context from an empty scan" and "builds the context of another base and drops machines the export does not know"; Task 7 "findBase falls back to the anchor chunk after a rescan".

## File map

| File | Responsibility |
|---|---|
| `src/shared/types/world.ts` | architecture §6.6 types (+ optional fields listed in Task 1) |
| `src/shared/types/api.ts` (append) | `WorldSourcesResponse`, `WorldScanListItem`, `StartScanRequest`, upload responses |
| `src/server/world/nbt.ts` | NBT full parse + compound skip-scan primitives |
| `src/server/world/region.ts` | region header, chunk payload inflate, file name ↔ coordinates |
| `src/server/world/sections.ts` | per-section decode (legacy / EndlessIDs cascade), biomes |
| `src/server/world/level-dat.ts` | `level.dat`: separate block/item maps, spawn, mods, chunk managers |
| `src/server/world/files.ts` | `WorldFiles` interface, folder-backed implementation |
| `src/server/world/zip.ts` | yauzl-backed `WorldFiles`, newest complete backup |
| `src/server/world/sources.ts` | sources listing, source resolution (backup / snapshot / upload), upload storage |
| `src/server/world/tile-entities.ts` | TE whitelist, chunk skip-scan, item stack reading |
| `src/server/world/facts.ts` | `ScanPackFacts` (the slice of the Pack the worker needs) |
| `src/server/world/classify/*.ts` | `gt`, `gtchests`, `drawers`, `jabba`, `chests`, `projectred`, `enderio`, `ae2` |
| `src/server/world/bases.ts` | base clustering, stable ids, names, `baseAt` (`baseIdOf`/`findBase` live in `src/shared/types/world.ts`) |
| `src/server/world/dims.ts` | `DimSummary`, visit evidence (players, quests, teams) |
| `src/server/world/prospecting.ts` | VisualProspecting server cache + team discoveries |
| `src/server/world/area.ts` | `BlockReader` over region files, `readArea` → `Voxels` |
| `src/server/world/tiles.ts` | palette, `MapTile` render, tile encoding |
| `src/server/world/graph.ts` | union-find, smallest position, majority vote, tap picking (shared by power and logistics) |
| `src/server/world/power.ts` | cable + steam graphs, generators, calcification, clear/rain/average, taps |
| `src/server/world/logistics.ts` | routed / EnderIO / GT pipe / AE2 networks and taps |
| `src/server/world/storage.ts` | `StorageBlock`s, drawer reach, reachable flag, totals |
| `src/server/world/model.ts` | internal record types, positions and directions |
| `src/server/world/coils.ts` | EBF coil heat from the coil ring |
| `src/server/world/scan.worker.ts`, `scan.ts` | scan job passes; `WorldService` (queue, worker, cancel, cache, tiles, areas) |
| `src/server/world/context.ts` | `contextFromScan` |
| `src/server/cli/scan.ts` | `npm run scan` |
| `src/server/http/routes/world.ts` | architecture §7 world rows (+ cancel) |
| `src/client/map/*` | `types.ts` (§7.2), `api.ts`, `tile-cache.ts`, `palette.ts`, `render.ts`, `overlays.ts`, `summary.ts`, `FoundPanel.tsx` |
| `src/client/views/MapView.tsx`, `MapTab.tsx`, `WorldPage.tsx` | map canvas, project `map` tab, World page |
| `src/client/world/{pick-files,zip-pick,upload}.ts` | choosing world files in the browser and uploading them |
| `src/client/views/project-tabs.ts`, `top-pages.ts` (modify) | `map` tab first; `/world` page (Architecture change request 4) |
| `tests/helpers/{nbt-write,region-write,zip-write,make-world,world-tes,world-facts,sample-world,scan-fixture,serve-routes}.ts` | synthetic fixtures |

## What this plan uses from Plans 1–3

- Plan 1: `itemKey`, `fluidKey`, `parseItemKey` (`src/shared/keys.ts`); `TIER_NAMES`, `V`, `tierName` (`src/shared/gt/tiers.ts`); `Pack`, `Machine`, `MachineKind`, `BlockRef`, `DimensionInfo`, `Item` (`src/shared/types/pack.ts`); `AppConfig`, `loadConfig()` (`src/server/config.ts`); `loadPack`, `activeExportDir`.
- Plan 2: `PlanContext`, `emptyContext()` (`src/shared/types/plan.ts`, `src/server/planner/plan.ts`); `Project`, `ProjectOp`, `Note` (`src/shared/types/project.ts`); `Route`, `Handler`, `RequestContext`, `sendJson`, `readJson` (`src/server/http/router.ts`); `AppContext` (`src/server/app.ts`); `ROUTE_MODULES` (`src/server/http/routes/index.ts`); `app.services.planContext` hook; `ProjectViewProps`, `ProjectTab`, `PROJECT_TABS` (`src/client/views/project-tabs.ts`); the e2e helpers `login` and `createProject` in `tests/e2e/helpers.ts` (Architecture change request 7).
- Plan 3: `POST /api/assets/blocks {blocks}` → `BlockFaces[]` and `GET /api/assets/file/<path>` for top-face colours; `BlockFaces`, `TextureLayer` (`src/shared/types/assets.ts`). The map works without them (fallback colours).

## Tasks (outline)

1. NBT, region, section and `level.dat` decoding (+ shared world types)
2. World file sources: backup zips, snapshot copy, upload folders
3. Synthetic world builder and the chunk tile-entity skip-scan
4. Pack facts and the GregTech classifier (machines, pipes, buffers, boilers, super/quantum chests and tanks)
5. Storage-mod classifiers: Storage Drawers, JABBA, chests
6. Logistics-mod classifiers: Project Red, EnderIO, AE2
7. Bases, visited dimensions and prospecting
8. Block reader, `readArea` and map tiles
9. Power networks and the power estimate
10. Logistics networks and tap points
11. Storage: drawer reach, reachable flag, per-base totals
12. The scan job: passes, map extraction, EBF coils
13. World service: queue, worker thread, cancel, cache, tiles, areas and `npm run scan`
14. `contextFromScan`, the planner hook and the world routes
15. Client map core: tiles, palette colours, `MapView`
16. The `map` project tab: overlays, note pins, "Found in world", base picker
17. World page: sources, scans, uploads
18. End-to-end check and README

---

### Task 1: NBT, region, section and `level.dat` decoding (+ shared world types)

**Files:**
- Create: `src/shared/types/world.ts`, `src/server/world/nbt.ts`, `src/server/world/region.ts`, `src/server/world/sections.ts`, `src/server/world/level-dat.ts`
- Create: `tests/helpers/nbt-write.ts`, `tests/helpers/region-write.ts`
- Test: `tests/unit/world/nbt.test.ts`, `tests/unit/world/region.test.ts`, `tests/unit/world/sections.test.ts`, `tests/unit/world/level-dat.test.ts`, `tests/unit/world/tile-codec.test.ts`

**Interfaces:**
- Consumes: `BlockRef`, `MachineKind` (`src/shared/types/pack.ts`, Plan 1).
- Produces:
  - `src/shared/types/world.ts`: every architecture §6.6 type verbatim, with these optional additions (Architecture change request 6): `PlacedMachine.{kind?: MachineKind | 'unknown'; tier?: number; name?: string; recipeEUt?: number; coilHeat?: number}`, `PlacedPipe.{kind?: 'cable' | 'fluid' | 'item'; voltageTier?: number; amps?: number; networkId?: string}`, `PowerNetwork.{loadEUt?: number; solarShare?: number}`, `LogisticsNetwork.{parts?: Record<string, number>}`, `StorageBlock.{capacityStacks?: number | null; controller?: [number, number, number]}`, `WorldScan.{logisticsBlocks?: LogisticsBlock[]; warnings?: string[]; skippedChunks?: number}`. New exports: `interface LogisticsBlock { dim: number; pos: [number, number, number]; kind: LogisticsNetwork['kind']; networkId: string | null; connections: number }`, `type BBox = Base['bbox']` (inclusive), `interface Voxels { origin: [number, number, number]; size: [number, number, number]; blocks: Uint32Array; palette: BlockRef[] }` with index `(y·size[2] + z)·size[0] + x` relative to `origin`, `AIR_INDEX = 0`, `UNKNOWN_INDEX = 1`, `UNKNOWN_BLOCK: BlockRef = { id: 'gtnh-planner:unknown', meta: 0 }` (palette entries 0 and 1 of every palette), `TILE_SIZE = 64`, `tileOf(blockCoord: number): number` (`Math.floor(c / 64)`), `encodeMapTile(t: MapTile): Uint8Array` (20,480 bytes: u32 LE palette index × 4096, then u8 height × 4096; column `i = lz·64 + lx`), `decodeMapTile(bytes: Uint8Array, dim: number, tx: number, tz: number): MapTile`.
  - `nbt.ts`: `TAG` (`as const`, End 0 … LongArray 12); `type NbtValue = number | string | Uint8Array | Int32Array | number[] | NbtValue[] | NbtCompound` (Byte/Short/Int/Long/Float/Double → `number`; ByteArray → `Uint8Array` view without copy; IntArray → `Int32Array`; LongArray → `number[]`); `interface NbtCompound { [key: string]: NbtValue }`; `class NbtError extends Error`; `interface NbtCursor { buf: Uint8Array; view: DataView; pos: number }`; `cursor(buf: Uint8Array, pos?: number): NbtCursor`; `readName(c: NbtCursor): string`; `readPayload(c: NbtCursor, type: number): NbtValue`; `skipPayload(c: NbtCursor, type: number): void`; `parseNbt(buf: Uint8Array): NbtCompound` (root compound, root name ignored); `readGzipNbt(buf: Uint8Array): NbtCompound` (gunzips when the first bytes are `1f 8b`, else raw); small getters `num(v: NbtValue | undefined, fallback = 0): number`, `str(v: NbtValue | undefined): string | null`, `comp(v: NbtValue | undefined): NbtCompound | null`, `list(v: NbtValue | undefined): NbtValue[]`.
  - `region.ts`: `interface RegionChunkRef { index: number; localX: number; localZ: number; offset: number /* bytes */; sectors: number; timestamp: number }`; `regionChunkRefs(header: Uint8Array): RegionChunkRef[]`; `chunkPayload(region: Uint8Array, ref: RegionChunkRef): { compression: number; data: Uint8Array } | null` (null when length/offset overflow the file); `inflateChunk(p: { compression: number; data: Uint8Array }): Buffer` (2 zlib, 1 gzip, 3 none; throws otherwise); `chunkIndex(cx: number, cz: number): number` (`(cx & 31) + (cz & 31) * 32`); `regionOfChunk(c: number): number` (`c >> 5`); `parseRegionPath(rel: string): { dim: number; rx: number; rz: number } | null`; `regionPathOf(dim: number, rx: number, rz: number): string`.
  - `sections.ts`: `interface DecodedSection { ids: Uint32Array; meta: Uint16Array }`; `sectionIndex(x: number, y: number, z: number): number`; `isLegacySection(sec: NbtCompound): boolean`; `decodeSection(sec: NbtCompound): DecodedSection`; `biomeAt(level: NbtCompound, x: number, z: number): number` (−1 for null/absent).
  - `level-dat.ts`: `interface LevelInfo { levelName: string; spawn: [number, number, number]; blockNames: Map<number, string>; itemNames: Map<number, string>; blockIds: Map<string, number>; mods: Record<string, string>; managers: Record<string, string>; warnings: string[] }`; `KNOWN_MANAGERS = { 'endlessids:blockid': '1.7.4', 'endlessids:metadata': '1.7.4', 'endlessids:biome': 'endlessids', 'archaicfix:lighting': '1.0' }`; `readLevelDat(buf: Uint8Array): LevelInfo`.
  - Test helpers: `tests/helpers/nbt-write.ts` — tagged builders `byte, short, int, long (bigint), float, double, str, bytes, ints, longs, list(elemType, items), comp(record)` and `writeNbt(root, name = ''): Buffer`, `parseTag(t: Tag): NbtCompound` (= `parseNbt(writeNbt(t))`, used by classifier tests); `tests/helpers/region-write.ts` — `regionFile(chunks: Array<{ cx: number; cz: number; nbt: Uint8Array; timestamp?: number; compression?: 1 | 2; corrupt?: boolean }>): Buffer` (4 KiB-sector Anvil layout; `corrupt` writes 64 bytes of `0xff` as the payload).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/nbt.test.ts
it('parses every tag type', () => {
  const buf = writeNbt(comp({ b: byte(-1), s: short(-2), i: int(70000), l: long(1234567890123n), f: float(1.5), d: double(2.25),
    t: str('gregtech:gt.blockmachines'), ba: bytes([1, 255]), ia: ints([1, -1]), la: longs([5n]), li: list('int', [int(1), int(2)]),
    e: list('end', []), c: comp({ x: int(3) }), 'GT.ItemCharge': long(5n) }));
  const n = parseNbt(buf);
  expect([n.b, n.s, n.i, n.l, n.f, n.d, n.t]).toEqual([-1, -2, 70000, 1234567890123, 1.5, 2.25, 'gregtech:gt.blockmachines']);
  expect(Array.from(n.ba as Uint8Array)).toEqual([1, 255]);
  expect(Array.from(n.ia as Int32Array)).toEqual([1, -1]);
  expect([n.la, n.li, n.e, n.c, n['GT.ItemCharge']]).toEqual([[5], [1, 2], [], { x: 3 }, 5]);
});
it('skips a payload and lands on the next tag', () => { /* comp({ big: bytes(new Uint8Array(10000)), after: int(7) }): readName → skipPayload → next readName is 'after' */ });
it('throws NbtError on truncated input', () => expect(() => parseNbt(writeNbt(comp({ a: str('abcdef') })).subarray(0, 8))).toThrow(NbtError));
it('reads gzip and raw NBT alike', () => { const raw = writeNbt(comp({ a: int(1) })); expect(readGzipNbt(gzipSync(raw))).toEqual(readGzipNbt(raw)); });

// tests/unit/world/region.test.ts
it('maps negative chunk coordinates', () => {
  expect([chunkIndex(-1, -1), chunkIndex(-32, 0), regionOfChunk(-1), regionOfChunk(-33), regionOfChunk(31)]).toEqual([1023, 0, -1, -2, 0]);
});
it('parses only real region paths', () => {
  expect(parseRegionPath('region/r.-1.2.mca')).toEqual({ dim: 0, rx: -1, rz: 2 });
  expect(parseRegionPath('DIM-1/region/r.0.0.mca')).toEqual({ dim: -1, rx: 0, rz: 0 });
  expect(parseRegionPath('DIM7/region/r.3.-4.mca')).toEqual({ dim: 7, rx: 3, rz: -4 });
  for (const bad of ['DIM-1/region/r.0.0.mcr', 'Region/r.0.0.mca', 'DIM1/data/r.0.0.mca', '../region/r.0.0.mca', 'DIM1/region/r.a.0.mca'])
    expect(parseRegionPath(bad)).toBeNull();
  expect([regionPathOf(-1, 0, 0), regionPathOf(0, -1, 2)]).toEqual(['DIM-1/region/r.0.0.mca', 'region/r.-1.2.mca']);
});
it('lists present chunks with timestamps and inflates them', () => {
  const a = writeNbt(comp({ Level: comp({ xPos: int(0) }) })), b = writeNbt(comp({ Level: comp({ xPos: int(31) }) }));
  const reg = regionFile([{ cx: 0, cz: 0, nbt: a, timestamp: 1_700_000_000 }, { cx: 31, cz: 1, nbt: b, compression: 1 }]);
  const refs = regionChunkRefs(reg.subarray(0, 8192));
  expect(refs.map((r) => [r.index, r.localX, r.localZ])).toEqual([[0, 0, 0], [63, 31, 1]]);
  expect(refs[0].timestamp).toBe(1_700_000_000);
  expect(inflateChunk(chunkPayload(reg, refs[1])!)).toEqual(Buffer.from(b));
});
it('returns null for a payload that overflows the file', () => { /* header entry offset 2 sectors, count 1, file only 8192 bytes → null */ });

// tests/unit/world/sections.test.ts — sections built with nbt-write, arrays filled at i = sectionIndex(1, 2, 3) (odd i = 0x231 → high nibble)
it('decodes a legacy Blocks16/Data16 section as big-endian u16', () => { /* Blocks16[2i..] = 0x2B,0x11; Data16 = 0x01,0x31 */ expect([ids[i], meta[i]]).toEqual([11025, 305]); });
it('decodes EndlessIDs with the Add → BlocksB2Hi cascade', () => { /* Blocks 0x11, Add nib 0xB, BlocksB2Hi nib 0x2, Data nib 1, Data1High nib 3, Data2 1 */ expect([ids[i], meta[i]]).toEqual([11025, 305]); });
it('ignores BlocksB2Hi when Add is absent and Data2 when Data1High is absent', () => { expect([ids[i], meta[i]]).toEqual([0x11, 1]); });
it('reads Biomes16v2 little-endian at z<<4|x, 65535 = none', () => {
  // k = (5 << 4) | 3: bytes [2k] = 0x2A, [2k+1] = 0x01; k2 = 0: 0xFF, 0xFF
  expect([biomeAt(eid, 3, 5), biomeAt(eid, 19, -11), biomeAt(eid, 0, 0)]).toEqual([298, 298, -1]);
  expect([biomeAt(vanilla, 3, 5), biomeAt(vanilla, 0, 0), biomeAt({}, 0, 0)]).toEqual([7, -1, -1]);   // Biomes[k] = 7, Biomes[0] = 255
});

// tests/unit/world/level-dat.test.ts
it('keeps separate block and item maps', () => {
  const info = readLevelDat(gzipSync(writeNbt(comp({ FML: comp({ ItemData: list('compound', [
    comp({ K: str('\u0001minecraft:reeds'), V: int(83) }), comp({ K: str('\u0002minecraft:reeds'), V: int(338) }),
    comp({ K: str('\u0001gregtech:gt.blockmachines'), V: int(4000) }), comp({ K: str('\u0002gregtech:gt.blockmachines'), V: int(4000) }) ]) }) }))));
  expect([info.blockNames.get(83), info.itemNames.get(338), info.itemNames.has(83), info.blockIds.get('gregtech:gt.blockmachines')])
    .toEqual(['minecraft:reeds', 'minecraft:reeds', false, 4000]);
  expect(info.blockNames.get(0)).toBe('minecraft:air');
});
it('reads level name, spawn and mods', () => { expect([info.levelName, info.spawn, info.mods.gregtech]).toEqual(['World', [10, 64, -20], '5.09.54.183']); });
it('warns about unknown chunk managers only', () => { expect(info.warnings).toEqual(['Unknown chunk manager endlessids:blockid 9.9 (expected 1.7.4)']); expect(noManagers.warnings).toEqual([]); });

// tests/unit/world/tile-codec.test.ts
it('round-trips a tile in 20,480 little-endian bytes', () => {
  const t: MapTile = { dim: -1, tx: -1, tz: 2, size: 64, top: new Uint32Array(4096).fill(70000), height: new Uint8Array(4096).fill(200) };
  const bytes = encodeMapTile(t);
  expect([bytes.length, bytes[0], bytes[1], bytes[2], bytes[16384]]).toEqual([20480, 0x70, 0x11, 0x01, 200]);
  expect(decodeMapTile(bytes, -1, -1, 2)).toEqual(t);
  expect([tileOf(-1), tileOf(-64), tileOf(-65), tileOf(63)]).toEqual([-1, -1, -2, 0]);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/`
Expected: FAIL — `Cannot find module '…/src/server/world/nbt.ts'` (and the same for the other new modules).

- [ ] **Step 3: Implement the five modules**

`nbt.ts` is an iterative-or-recursive big-endian reader over a `DataView` (strings via `TextDecoder('utf-8')`; every key here is ASCII); `skipPayload` advances by length for arrays/strings and recurses only into lists of compounds/lists. `sections.ts` follows world-format §3.3 and §9 exactly (decide per section by the `Blocks16` key; cascade `Add` → `BlocksB2Hi` → `BlocksB3`, `Data1High` → `Data2`). `readLevelDat` warns once per manager whose version differs from `KNOWN_MANAGERS` and never refuses a world.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/ && npm run typecheck`
Expected: PASS (5 files), `tsc -b` exits 0.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/world.ts src/server/world/nbt.ts src/server/world/region.ts src/server/world/sections.ts src/server/world/level-dat.ts tests/helpers/nbt-write.ts tests/helpers/region-write.ts tests/unit/world/
git commit -m "feat(world): NBT, region, section and level.dat decoding" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 2: World file sources: backup zips, snapshot copy, upload folders

**Files:**
- Create: `src/server/world/files.ts`, `src/server/world/zip.ts`, `src/server/world/sources.ts`, `tests/helpers/zip-write.ts`
- Modify: `src/shared/types/api.ts` (append the world request/response types below)
- Test: `tests/unit/world/zip.test.ts`, `tests/unit/world/sources.test.ts`

**Interfaces:**
- Consumes: `AppConfig` (`dataDir`, `serverFolder`) from `src/server/config.ts`; `WorldSource` (Task 1); yauzl 3.4.0 promise API (`openPromise(path, { lazyEntries: true, autoClose: false })`, `eachEntry()`, `openReadStreamPromise`).
- Produces:
  - `src/shared/types/api.ts` (append): `interface WorldSourcesResponse { server: boolean; backups: string[] }`, `interface StartScanRequest { source: WorldSource }`, `interface StartScanResponse { scanId: string }`, `interface WorldScanListItem extends ScanStatus { source: WorldSource; levelName: string | null }`, `interface CreateUploadResponse { uploadId: string }`.
  - `files.ts`: `interface WorldEntry { path: string /* world-relative, '/' separators */; size: number }`; `interface WorldFiles { readonly label: string; list(): Promise<WorldEntry[]>; read(rel: string): Promise<Buffer | null>; close(): Promise<void> }`; `isScanPath(rel: string): boolean` — true only for `level.dat`, region files (`parseRegionPath` ≠ null), `playerdata/<name>.dat`, `serverutilities/teams/claimedchunks/<name>.dat`, `gtnhteams/<name>.json`, `betterquesting/QuestProgress/<name>.json`, `data/visualprospecting.dat`; `openDirWorld(root: string, label?: string): Promise<WorldFiles>` (lists only scan paths; `read` of an unlisted path returns `null`).
  - `zip.ts`: `BACKUP_MIN_AGE_MS = 120_000`; `class ZipWorldError extends Error`; `isCompleteZip(path: string): Promise<boolean>`; `listCompleteBackups(backupsDir: string, now?: number): Promise<string[]>` (basenames of `*.zip`, complete and `mtime ≤ now − BACKUP_MIN_AGE_MS`, newest first); `openZipWorld(zipPath: string, label?: string): Promise<WorldFiles>` (world root = directory of the shallowest `level.dat` entry; entries outside it are ignored; one entry inflated at a time).
  - `sources.ts`: `interface ServerLayout { serverDir: string; worldDir: string; backupsDir: string }`; `serverLayout(serverFolder: string): ServerLayout` (`level-name` from `server.properties`, default `World`; backups in `<serverDir>/backups`); `class SourceError extends Error { status: number }`; `listSources(cfg: AppConfig, now?: number): Promise<WorldSourcesResponse>`; `type ResolvedSource = { kind: 'zip'; path: string; label: string } | { kind: 'snapshot'; worldDir: string; label: string } | { kind: 'dir'; path: string; label: string }`; `resolveSource(cfg: AppConfig, source: WorldSource, now?: number): Promise<ResolvedSource>` (`server` → newest complete backup, else snapshot of the world folder; `backup` → only a name in `listCompleteBackups`; `upload` → a completed upload, `world.zip` inside it opens as a zip); `openResolved(src: ResolvedSource, scanDir: string): Promise<WorldFiles>` (snapshot = every `isScanPath` file cloned with `fs.copyFile(src, dst, fs.constants.COPYFILE_FICLONE)` into `<scanDir>/snapshot/`, then `openDirWorld`); `copyServerSideFiles(serverDir: string, worldId: string | null, scanDir: string): Promise<{ vpDir: string | null; drawersCfg: string | null }>` (clones `visualprospecting/server/<worldId>/DIM*.dat` and `config/StorageDrawers.cfg` into `<scanDir>/side/`); uploads: `UPLOAD_LIMITS = { levelDat: 32 MiB, region: 128 MiB, zip: 4 GiB, files: 4096, total: 8 GiB }`, `type UploadLimits = typeof UPLOAD_LIMITS`, `uploadKind(rel: string): 'level' | 'region' | 'zip' | null`, `isUploadId(s: string): boolean` (`/^[0-9a-f]{32}$/`), `createUpload(dataDir: string, by: string | null): Promise<string>`, `storeUploadFile(dataDir: string, uploadId: string, rel: string, body: Readable, declaredLength: number | null, limits?: UploadLimits): Promise<void>`, `completeUpload(dataDir: string, uploadId: string): Promise<WorldSource>`. Upload layout: `data/uploads/<uploadId>/upload.json` (`{ createdAt, by, complete, files, bytes }`) and the files under `data/uploads/<uploadId>/files/<rel>`, each written to `.<uuid>.part` and renamed on success.
  - `tests/helpers/zip-write.ts`: `zipBuffer(entries: Array<{ name: string; data: Uint8Array }>): Buffer` (method 8 via `deflateRawSync`, CRC via `zlib.crc32`) and `writeZip(path: string, entries, opts?: { truncateBytes?: number; mtime?: Date }): Promise<void>`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/zip.test.ts
it('opens a backup zip and lists world-relative scan entries', async () => {
  await writeZip(zipPath, [{ name: 'World/level.dat', data: LEVEL }, { name: 'World/region/r.0.0.mca', data: REG },
    { name: 'World/DIM-1/region/r.-1.0.mca', data: REG }, { name: 'World/session.lock', data: B1 }, { name: 'serverutilities/a.txt', data: B1 }]);
  const w = await openZipWorld(zipPath);
  expect((await w.list()).map((e) => e.path).sort()).toEqual(['DIM-1/region/r.-1.0.mca', 'level.dat', 'region/r.0.0.mca']);
  expect(await w.read('level.dat')).toEqual(Buffer.from(LEVEL));
  expect(await w.read('session.lock')).toBeNull();
});
it('finds the world root at any depth', async () => { /* 'saves/My World/level.dat' → list() contains 'level.dat' */ });
it('throws ZipWorldError when the zip has no level.dat', async () => { await expect(openZipWorld(noLevel)).rejects.toThrow(ZipWorldError); });
it('skips zips that are too new or truncated', async () => {
  const now = Date.parse('2026-10-17T12:00:00Z');
  await writeZip(join(dir, '2026-10-17-11-00-00.zip'), ok, { mtime: new Date(now - 3_600_000) });
  await writeZip(join(dir, '2026-10-17-11-30-00.zip'), ok, { mtime: new Date(now - 1_800_000) });
  await writeZip(join(dir, '2026-10-17-11-58-00.zip'), ok, { mtime: new Date(now - 60_000) });             // < 2 min old
  await writeZip(join(dir, '2026-10-17-11-45-00.zip'), ok, { mtime: new Date(now - 900_000), truncateBytes: 100 });  // no central directory
  expect(await listCompleteBackups(dir, now)).toEqual(['2026-10-17-11-30-00.zip', '2026-10-17-11-00-00.zip']);
});

// tests/unit/world/sources.test.ts  (server folder = tmp/srv with server.properties "level-name=World", World/level.dat, World/region/r.0.0.mca)
it('lists server availability and complete backups', async () => {
  expect(await listSources(cfgWith(srv), NOW)).toEqual({ server: true, backups: ['2026-10-17-11-00-00.zip'] });
  expect(await listSources(cfgWith(null), NOW)).toEqual({ server: false, backups: [] });
});
it('resolves {kind: server} to the newest complete backup, else a snapshot', async () => {
  expect(await resolveSource(cfgWith(srv), { kind: 'server' }, NOW)).toMatchObject({ kind: 'zip', path: join(srv, 'backups', '2026-10-17-11-00-00.zip') });
  expect(await resolveSource(cfgWith(srvNoBackups), { kind: 'server' }, NOW)).toMatchObject({ kind: 'snapshot', worldDir: join(srvNoBackups, 'World') });
});
it.each(['../../etc/passwd', 'fresh.zip', 'missing.zip', 'a/b.zip'])('refuses backup %s with 400', async (file) => {
  await expect(resolveSource(cfgWith(srv), { kind: 'backup', file }, NOW)).rejects.toMatchObject({ status: 400 });
});
it('snapshot copies never write into the server folder', async () => {
  const before = await treeWithMtimes(srv);
  await chmodTree(srv, 'read-only');                         // a write would now fail with EACCES
  const w = await openResolved({ kind: 'snapshot', worldDir: join(srv, 'World'), label: 'snapshot' }, scanDir);
  expect((await w.list()).map((e) => e.path).sort()).toEqual(['level.dat', 'region/r.0.0.mca']);
  await chmodTree(srv, 'writable');
  expect(await treeWithMtimes(srv)).toEqual(before);
});
it.each([
  ['level.dat', 204], ['region/r.0.0.mca', 204], ['DIM-1/region/r.-1.2.mca', 204], ['world.zip', 204],
  ['../level.dat', 400], ['/level.dat', 400], ['Region/r.0.0.mca', 400], ['DIM-1/r.0.0.mca', 400], ['region/../level.dat', 400],
  ['region/r.0.0.mca/x', 400], ['playerdata/a.dat', 400], ['region\\r.0.0.mca', 400], ['level.dat\0', 400],
])('upload path %s → %i', async (rel, status) => {
  const id = await createUpload(dataDir, 'Ann');
  const r = storeUploadFile(dataDir, id, rel, Readable.from([Buffer.from('x')]), 1);
  if (status === 204) await expect(r).resolves.toBeUndefined(); else await expect(r).rejects.toMatchObject({ status });
  expect(await listTree(join(dataDir, 'uploads'))).not.toContain('..');
});
it('enforces size and count limits and leaves no partial file', async () => {
  const limits = { ...UPLOAD_LIMITS, region: 1000, files: 2 };
  await expect(storeUploadFile(dataDir, id, 'region/r.0.0.mca', Readable.from([Buffer.alloc(1001)]), null, limits)).rejects.toMatchObject({ status: 413 });
  await expect(storeUploadFile(dataDir, id, 'region/r.0.0.mca', Readable.from([Buffer.alloc(10)]), 5000, limits)).rejects.toMatchObject({ status: 413 });   // declared length checked first
  expect((await readdir(join(dataDir, 'uploads', id, 'files', 'region')).catch(() => []))).toEqual([]);
  // two small files accepted, the third → 413
});
it('completes only uploads with level.dat or world.zip; refuses writes after completion', async () => {
  await expect(completeUpload(dataDir, empty)).rejects.toMatchObject({ status: 400, message: 'level.dat is missing' });
  expect(await completeUpload(dataDir, withLevel)).toEqual({ kind: 'upload', uploadId: withLevel });
  await expect(storeUploadFile(dataDir, withLevel, 'region/r.0.0.mca', Readable.from([B1]), 1)).rejects.toMatchObject({ status: 409 });
  await expect(storeUploadFile(dataDir, 'f'.repeat(32), 'level.dat', Readable.from([B1]), 1)).rejects.toMatchObject({ status: 404 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/zip.test.ts tests/unit/world/sources.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/zip.ts'`.

- [ ] **Step 3: Implement `files.ts`, `zip.ts`, `sources.ts`, the api types and `zip-write.ts`**

Upload paths are checked with `uploadKind` *before* any filesystem call: exactly `level.dat`, `world.zip`, or `parseRegionPath(rel) !== null` and `rel === regionPathOf(...)` of the parsed values (so no `..`, no backslash, no NUL, no case variants). The byte limit is a counting `Transform` in `pipeline(body, meter, createWriteStream(tmp))`; any error removes the `.part` file. `upload.json` is rewritten with the new file count and byte total after each stored file. Every server-folder access in this file is a read (`readFile`, `readdir`, `stat`, `copyFile` *from* it).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/zip.test.ts tests/unit/world/sources.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/files.ts src/server/world/zip.ts src/server/world/sources.ts src/shared/types/api.ts tests/helpers/zip-write.ts tests/unit/world/zip.test.ts tests/unit/world/sources.test.ts
git commit -m "feat(world): read-only world sources (backups, snapshot, uploads)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 3: Synthetic world builder and the chunk tile-entity skip-scan

**Files:**
- Create: `tests/helpers/make-world.ts`, `tests/helpers/world-tes.ts`, `src/server/world/model.ts`, `src/server/world/tile-entities.ts`
- Test: `tests/unit/world/make-world.test.ts`, `tests/unit/world/tile-entities.test.ts`

**Interfaces:**
- Consumes: Task 1 (`parseNbt`, `cursor`, `readName`, `skipPayload`, `readPayload`, `regionChunkRefs`, `chunkPayload`, `inflateChunk`, `decodeSection`), Task 2 (`openDirWorld`, `zipBuffer`), `itemKey` (Plan 1).
- Produces:
  - `model.ts` (internal types shared by Tasks 4–13): `type Vec3 = [number, number, number]`; `interface RawTe { dim: number; id: string; x: number; y: number; z: number; nbt: NbtCompound }`; `interface ChunkStat { dim: number; cx: number; cz: number; inhabitedTime: number; timestamp: number; teCount: number; oreTes: number }`; `interface ChunkScanResult { stat: ChunkStat; tes: RawTe[] }`; `interface ItemCount { key: StuffKey; count: number }`; `posKey(dim: number, x: number, y: number, z: number): string` (`"dim:x:y:z"`); `DIRS: readonly Vec3[]` (ForgeDirection 0..5 = `[0,-1,0] [0,1,0] [0,0,-1] [0,0,1] [-1,0,0] [1,0,0]`); `OPPOSITE = [1, 0, 3, 2, 5, 4] as const`; `step(p: Vec3, side: number): Vec3`.
  - `tile-entities.ts`: `TE_WHITELIST: ReadonlySet<string>` = `BaseMetaTileEntity`, `BaseMetaPipeEntity`, `TileEntityBarrel`, `Chest`, `savedMultipart`, `blockConduitBundleTileEntity`, `BlockCableBus`, `BlockController`, `BlockDrive`, `BlockChest`, `BlockInterface`; `TE_PREFIXES = ['IronChest.', 'StorageDrawers:']`; `isWantedTe(id: string): boolean` (false for `GT_TileEntity_Ores`); `scanChunk(nbt: Uint8Array, dim: number, timestamp: number): ChunkScanResult` (skip-parse: reads `Level.xPos`, `zPos`, `InhabitedTime`; walks `TileEntities`, finds each element's `id` wherever it sits, re-parses wanted ones fully from the element start, skips the rest; skips `Sections`, `Entities`, biomes and everything else by length); `scanRegionBuffer(region: Uint8Array, dim: number): { chunks: ChunkScanResult[]; skipped: number }` (a chunk that fails to inflate or parse is counted in `skipped`); `readStack(t: NbtCompound, itemNames: Map<number, string>): { key: ItemKey; count: number; tag: NbtCompound | null } | null` (world-format §5: `idExt` Int, else `id` Int/Short, else `id` String registry name; `Damage < 0` → 0; `Count` Byte or Int; unknown numeric id → `null`).
  - `tests/helpers/world-tes.ts`: `te(id: string, pos: Vec3, fields: Record<string, Tag>): Tag` plus `gtMachine({ pos, mID, facing = 2, mainFacing?, color = 0, storedEU = 0, works = true, extra = {} })` (writes `mWorks` **inverted**, `mFacing` Short, `mID` Int, `mStoredEnergy` Long), `gtPipe({ pos, mID, connections, kind: 'cable' | 'fluid' | 'item' })` (fluid → `mDisableInput`, item → `mLastReceivedFrom`), `stack(id: number, count: number, damage = 0, extra?: Record<string, Tag>)` (a vanilla stack compound: `id` Short, `Count` Byte, `Damage` Short), `stackFields(id: number, count: number, damage = 0): Record<string, Tag>` (the same fields, to spread into slot compounds), `chest(pos, items: Array<[slot: number, stack: Tag]>)`, `oreTe(pos)`. Tasks 5 and 6 add the mod builders listed there.
  - `tests/helpers/make-world.ts`: `interface FillBox { from: Vec3; to: Vec3; block: string; meta?: number }`; `interface ChunkSpec { cx: number; cz: number; format?: 'eid' | 'legacy'; inhabitedTime?: number; timestamp?: number; fill?: FillBox[]; tileEntities?: Tag[]; oreTes?: number; corrupt?: boolean }`; `interface WorldSpec { levelName?: string; spawn?: Vec3; blocks?: Record<string, number>; items?: Record<string, number>; dims: Record<number, ChunkSpec[]>; players?: Array<{ file: string; dim: number; pos: Vec3; spawnDims?: number[]; portals?: Array<[from: number, to: number]> }>; claims?: Record<string, Record<number, Array<[number, number]>>>; teams?: Record<string, Array<{ dim: number; veins: Array<[number, number]>; depleted?: Array<[number, number]> }>>; quests?: Record<string, number[]>; vp?: { worldId: string; dims: Record<number, Array<{ chunkX: number; chunkZ: number; vein: string; depleted?: boolean }>> }; drawersCfg?: string }`; `DEFAULT_BLOCK_IDS` (includes `minecraft:air` 0, `minecraft:stone` 1, `minecraft:grass` 2, `minecraft:dirt` 3, `minecraft:water` 9, `minecraft:chest` 54, `gregtech:gt.blockmachines` 4000, `gregtech:gt.blockcasings5` 4001, `gregtech:gt.blockores` 4002, `StorageDrawers:fullDrawers4` 4100, `StorageDrawers:controller` 4101, `StorageDrawers:trim` 4102, `StorageDrawers:controllerSlave` 4103, `StorageDrawers:framingTable` 4104, `StorageDrawersBop:fullDrawers2` 4105, `JABBA:barrel` 4200, `IronChest:BlockIronChest` 4300, `ForgeMultipart:block` 4400, `EnderIO:blockConduitBundle` 4500, `appliedenergistics2:tile.BlockController` 4600, `appliedenergistics2:tile.BlockDrive` 4601, `appliedenergistics2:tile.BlockCableBus` 4602, `appliedenergistics2:tile.BlockInterface` 4603, `cropsnh:cropSticks` 11025); `DEFAULT_ITEM_IDS` (`minecraft:cobblestone` 4, `minecraft:iron_ingot` 265, `minecraft:reeds` 338, `gregtech:gt.metaitem.01` 5000, `StorageDrawers:upgrade` 5100, `StorageDrawers:upgradeDowngrade` 5101, `StorageDrawers:upgradeCreative` 5102, `ProjRed|Transportation:projectred.transportation.routingchip` 5200, `appliedenergistics2:item.ItemMultiPart` 5300, `appliedenergistics2:item.ItemBasicStorageCell.1k` 5301, `test:big_item` 40000); `chunkNbt(spec: ChunkSpec, ids: Record<string, number>): Buffer`; `makeWorld(dir: string, spec: WorldSpec): Promise<{ serverDir: string; worldDir: string }>` (writes `server.properties`, `<levelName>/level.dat` with separate block/item `ItemData`, region files in `region/` and `DIM<n>/region/`, `playerdata/<file>.dat`, `serverutilities/teams/claimedchunks/<team>.dat`, `gtnhteams/<team>.json`, `betterquesting/QuestProgress/<file>.json`, `data/visualprospecting.dat`, and outside the world folder `visualprospecting/server/<worldId>/DIM<n>.dat` and `config/StorageDrawers.cfg`); `makeBackup(serverDir: string, name: string, opts?: { mtime?: Date; truncateBytes?: number }): Promise<string>` (zip entries `World/…` regardless of the level name, plus `serverutilities/backup.txt`). EndlessIDs sections write `Add` only when an id > 255, `BlocksB2Hi` only when an id > 4095, `Data1High` only when a meta > 15, `Data2` only when a meta > 255; legacy sections write `Blocks16`/`Data16`; EID chunks carry `Biomes16v2` and `POSTEA` 1234, legacy chunks `Biomes` and `POSTEA` 0; ore filler TEs are `{ id: 'GT_TileEntity_Ores', x, y, z, m: Short, n: Byte }`. The file formats of the side files are the ones in materials-availability §6–§7 and world-format §7.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/make-world.test.ts — the builder must agree with Task 1's readers
it('writes both chunk formats that decode to the same blocks', async () => {
  const { worldDir } = await makeWorld(tmp, { dims: {
    0: [{ cx: 0, cz: 0, format: 'eid', inhabitedTime: 100, fill: [{ from: [0, 60, 0], to: [15, 60, 15], block: 'minecraft:stone' },
                                                                 { from: [1, 61, 2], to: [1, 61, 2], block: 'cropsnh:cropSticks', meta: 305 }] }],
    [-1]: [{ cx: -1, cz: -1, format: 'legacy', fill: [{ from: [-16, 10, -16], to: [-1, 10, -1], block: 'cropsnh:cropSticks', meta: 305 }] }] } });
  expect(await blockAtFile(worldDir, 0, 1, 61, 2)).toEqual({ name: 'cropsnh:cropSticks', meta: 305 });   // Add + BlocksB2Hi + Data1High + Data2
  expect(await blockAtFile(worldDir, 0, 15, 60, 15)).toEqual({ name: 'minecraft:stone', meta: 0 });
  expect(await blockAtFile(worldDir, -1, -1, 10, -1)).toEqual({ name: 'cropsnh:cropSticks', meta: 305 });   // Blocks16/Data16
  expect(await blockAtFile(worldDir, 0, 0, 61, 0)).toEqual({ name: 'minecraft:air', meta: 0 });
});   // blockAtFile = a 15-line test-local reader built from Task 1 functions

// tests/unit/world/tile-entities.test.ts
const ids = { ...DEFAULT_BLOCK_IDS };
it('returns wanted TEs and InhabitedTime, skipping ore TEs', () => {
  const r = scanChunk(chunkNbt({ cx: -1, cz: 2, format: 'legacy', inhabitedTime: 1_440_000, oreTes: 500,
    tileEntities: [gtMachine({ pos: [-5, 64, 40], mID: 1121 }), chest([-6, 64, 40], [])] }, ids), 0, 1_700_000_000);
  expect(r.stat).toEqual({ dim: 0, cx: -1, cz: 2, inhabitedTime: 1_440_000, timestamp: 1_700_000_000, teCount: 502, oreTes: 500 });
  expect(r.tes.map((t) => [t.id, t.x, t.y, t.z])).toEqual([['BaseMetaTileEntity', -5, 64, 40], ['Chest', -6, 64, 40]]);
  expect(r.tes[0].nbt.mID).toBe(1121);
});
it('finds the id when it is the last key of the TE compound', () => { /* te('Chest', pos, {...}) built with id appended last → still returned */ });
it('skips a corrupt chunk and keeps the rest of the region', () => {
  const reg = regionFile([{ cx: 0, cz: 0, nbt: chunkNbt({ cx: 0, cz: 0 }, ids) }, { cx: 1, cz: 0, nbt: Buffer.alloc(0), corrupt: true }]);
  const out = scanRegionBuffer(reg, 0);
  expect([out.chunks.length, out.skipped]).toEqual([1, 1]);
});
it.each([
  [{ id: short(265), Count: byte(3), Damage: short(-1) }, { key: 'minecraft:iron_ingot@0', count: 3 }],
  [{ id: short(0), idExt: int(40000), Count: byte(1), Damage: short(7) }, { key: 'test:big_item@7', count: 1 }],
  [{ id: int(265), Count: int(300), Damage: short(0) }, { key: 'minecraft:iron_ingot@0', count: 300 }],
  [{ id: str('minecraft:cobblestone'), Count: byte(2), Damage: short(0) }, { key: 'minecraft:cobblestone@0', count: 2 }],
])('reads item stack %#', (fields, want) => expect(readStack(parseTag(comp(fields)), itemNames)).toMatchObject(want));
it('returns null for an unknown numeric item id', () => expect(readStack(parseTag(comp({ id: short(9999), Count: byte(1) })), itemNames)).toBeNull());
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/make-world.test.ts tests/unit/world/tile-entities.test.ts`
Expected: FAIL — `Cannot find module '…/tests/helpers/make-world.ts'` / `…/src/server/world/tile-entities.ts`.

- [ ] **Step 3: Implement the builder, `model.ts` and `tile-entities.ts`**

`scanChunk` uses the Task 1 cursor primitives only (no `parseNbt` of the whole chunk): for each `TileEntities` element remember the start offset, scan its keys for `id` (a String tag) while skipping other payloads, count ore TEs by id, and call `readPayload` from the start offset only when `isWantedTe(id)`. Element order in `tes` is chunk order.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/model.ts src/server/world/tile-entities.ts tests/helpers/make-world.ts tests/helpers/world-tes.ts tests/unit/world/make-world.test.ts tests/unit/world/tile-entities.test.ts
git commit -m "feat(world): synthetic world builder and chunk tile-entity skip-scan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 4: Pack facts and the GregTech classifier

**Files:**
- Create: `src/server/world/facts.ts`, `src/server/world/classify/gt.ts`, `src/server/world/classify/gtchests.ts`, `tests/helpers/world-facts.ts`
- Modify: `src/server/world/model.ts` (add `StorageRec`)
- Test: `tests/unit/world/classify-gt.test.ts`

**Interfaces:**
- Consumes: `Pack`, `Machine`, `MachineKind`, `DimensionInfo`, `Item` (Plan 1); `V` (Plan 1 tiers); `fluidKey` (Plan 1 keys); Task 3 (`RawTe`, `ItemCount`, `readStack`).
- Produces:
  - `facts.ts`: `type FactMachine = Omit<Machine, 'structure'>`; `interface ScanPackFacts { exportId: string | null; machines: Map<number, FactMachine>; dimensions: DimensionInfo[]; electric: Map<ItemKey, { maxCharge: number; tier: number }> }` (structured-clone safe, passed to the worker); `packFacts(pack: Pack | null): ScanPackFacts` (electric entries from `Item.electric`, Architecture change request 1; empty when absent); `emptyFacts(): ScanPackFacts`.
  - `model.ts` (add): `interface StorageRec { dim: number; pos: Vec3; kind: StorageBlock['kind']; contents: ItemCount[] | null; capacityStacks?: number | null }`.
  - `classify/gt.ts`: `interface GtMachineRec { dim: number; pos: Vec3; mteId: number; facing: number; mainFacing?: number; color: number; storedEU: number; works: boolean; kind: MachineKind | 'unknown'; tier: number | null; name: string | null; cls: string | null; multiblock: boolean; recipeEUt: number; running: boolean; boiler?: { runTime: number; temperature: number }; batteries?: Array<{ key: ItemKey; charge: number }>; inventory: Array<ItemCount & { slot: number }> }`; `interface GtPipeRec { dim: number; pos: Vec3; mteId: number; connections: number; pipeKind: 'cable' | 'fluid' | 'item'; color: number; cable?: { voltage: number; amps: number; loss: number }; voltageTier?: number }`; `classifyGtMachine(te: RawTe, facts: ScanPackFacts, itemNames: Map<number, string>): GtMachineRec`; `classifyGtPipe(te: RawTe, facts: ScanPackFacts): GtPipeRec`; `voltageTier(volts: number): number` (smallest `t` with `V[t] ≥ volts`, min 0); `TIER_KINDS: ReadonlySet<MachineKind>` = basic, generator, turbine, battery_buffer, transformer; `countsForTopTier(r: GtMachineRec): boolean` (`TIER_KINDS` or kind `hatch` with `/Energy/` in `cls`; never `unknown`); `toPlacedMachine(r: GtMachineRec, baseId: string | null): PlacedMachine`; `toPlacedPipe(r: GtPipeRec, networkId?: string): PlacedPipe`.
  - `classify/gtchests.ts`: `GT_CHEST_IDS` = 125–129 and 135–139, `GT_TANK_IDS` = 120–124 and 130–134; `classifyGtStorage(te: RawTe, facts: ScanPackFacts, itemNames: Map<number, string>): StorageRec | null` (chest when the id is in `GT_CHEST_IDS`, the export class is `MTEQuantumChest`/`MTESuperChest`, or the NBT has `mItemCount`; tank when in `GT_TANK_IDS` or class `MTEQuantumTank`/`MTESuperTank`).
  - `tests/helpers/world-facts.ts`: `testFacts(): ScanPackFacts`, `testPack(): Pack` (a full `Pack` object literal with empty recipe maps) and `packWithout(pack: Pack, mteId: number): Pack`, built from one table — 105 Simple Solar Boiler (`boiler`, cls `MTEBoilerSolar`, steamPerSecondMax 120); 114 High Pressure Solar Boiler (`boiler`, `MTEBoilerSolarSteel`, 360); 1120/1121/1122 Basic/Advanced/Turbo Steam Turbine (`turbine`, tier 1/2/3, voltage 32/128/512, amps 1, `MTESteamTurbine`); 1130 Combustion Generator (`generator`, tier 1, 32 V, 1 A); 161 Battery Buffer 1x1 LV (`battery_buffer`, tier 1, batterySlots 1); 193 Battery Buffer 4x4 HV (tier 3, 16 slots); 21 Transformer MV/LV (`transformer`, tier 1); 1246 1x Tin Cable (`cable`, 32 V, 1 A, loss 1); 1386 1x Annealed Copper Cable (128 V, 1 A, loss 1); 1466 1x Silver Cable (512 V, 1 A, loss 1); 5120 Bronze Fluid Pipe (`fluid_pipe`); 5600 Tin Item Pipe (`item_pipe`); 2001 Basic Macerator (`basic`, tier 1); 2002 Advanced Assembler (`basic`, tier 2); 2003 Chemical Reactor HV (`basic`, tier 3); 1000 Electric Blast Furnace (`multiblock`, `MTEElectricBlastFurnace`, heatOC true); 42 Energy Hatch MV (`hatch`, tier 2, `MTEHatchEnergy`); 125 Quantum Chest LV (`other`, `MTEQuantumChest`); 130 Super Tank I (`other`, `MTESuperTank`). Dimensions: overworld 0, nether −1, theend 1, endasteroid 1, twilightforest 7, moon 28, ross128b 64. Electric: `gregtech:gt.metaitem.01@32539` → `{ maxCharge: 1_600_000, tier: 3 }` (Large Lithium Battery), `gregtech:gt.metaitem.01@32519` → `{ maxCharge: 100_000, tier: 1 }` (Small Lithium Battery). Dimension names: Overworld, Nether, The End, End Asteroids, Twilight Forest, Moon, Ross 128b.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/classify-gt.test.ts — RawTe built as { dim: 0, id, x, y, z, nbt: parseTag(builder(...)) }
const facts = testFacts();
it('classifies a basic machine with facing, colour, tier and running recipe', () => {
  const r = classifyGtMachine(raw(gtMachine({ pos: [-3, 70, 5], mID: 2002, facing: 5, mainFacing: 3, color: 4, storedEU: 1000,
    extra: { mEUt: int(30), mMaxProgresstime: int(200) } })), facts, itemNames);
  expect(r).toMatchObject({ pos: [-3, 70, 5], mteId: 2002, facing: 5, mainFacing: 3, color: 4, storedEU: 1000, works: true,
    kind: 'basic', tier: 2, name: 'Advanced Assembler', recipeEUt: 30, running: true, multiblock: false });
});
it('reads mWorks inverted', () => expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 21, works: false })), facts, itemNames).works).toBe(false));
it('keeps unknown mIDs as unknown', () => {
  const r = classifyGtMachine(raw(gtMachine({ pos: P, mID: 31999 })), facts, itemNames);
  expect([r.kind, r.tier, r.name, countsForTopTier(r), toPlacedMachine(r, null).kind]).toEqual(['unknown', null, null, false, 'unknown']);
});
it('detects a multiblock by its maintenance keys when the export does not know the id', () => {
  expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 31998, extra: { mWrench: byte(1), mCrowbar: byte(1) } })), facts, itemNames).multiblock).toBe(true);
});
it('reads boiler calcification and temperature', () => {
  expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 114, extra: { mRunTime: int(1_440_000), mTemperature: int(500) } })), facts, itemNames).boiler)
    .toEqual({ runTime: 1_440_000, temperature: 500 });
});
it('reads battery charge from GT and IC2 tags', () => {
  const inv = list('compound', [
    comp({ IntSlot: int(0), ...stackFields(5000, 1, 32539), tag: comp({ 'GT.ItemCharge': long(1_600_000n) }) }),
    comp({ IntSlot: int(1), ...stackFields(5000, 1, 32540), tag: comp({ charge: double(10_000) }) }) ]);
  expect(classifyGtMachine(raw(gtMachine({ pos: P, mID: 193, extra: { Inventory: inv } })), facts, itemNames).batteries).toEqual([
    { key: 'gregtech:gt.metaitem.01@32539', charge: 1_600_000 }, { key: 'gregtech:gt.metaitem.01@32540', charge: 10_000 }]);
});
it('classifies pipes by export kind, else by NBT keys', () => {
  expect(classifyGtPipe(raw(gtPipe({ pos: P, mID: 1246, connections: 48, kind: 'cable' })), facts))
    .toMatchObject({ pipeKind: 'cable', connections: 48, cable: { voltage: 32, amps: 1, loss: 1 }, voltageTier: 1 });
  expect(classifyGtPipe(raw(gtPipe({ pos: P, mID: 30001, connections: 3, kind: 'fluid' })), facts).pipeKind).toBe('fluid');
  expect(classifyGtPipe(raw(gtPipe({ pos: P, mID: 30002, connections: 3, kind: 'item' })), facts).pipeKind).toBe('item');
  expect(classifyGtPipe(raw(gtPipe({ pos: P, mID: 30003, connections: 3, kind: 'cable' })), facts)).toMatchObject({ pipeKind: 'cable', voltageTier: undefined });
});
it('counts a quantum chest as stored item × (mItemCount + slots 0 and 1)', () => {
  const s = classifyGtStorage(raw(gtMachine({ pos: P, mID: 125, extra: { mItemStack: stack(265, 1), mItemCount: int(1_000_000),
    Inventory: list('compound', [comp({ IntSlot: int(0), ...stackFields(265, 64) }), comp({ IntSlot: int(1), ...stackFields(265, 10) })]) } })), facts, itemNames);
  expect(s).toEqual({ dim: 0, pos: P, kind: 'gt_chest', contents: [{ key: 'minecraft:iron_ingot@0', count: 1_000_074 }] });
});
it('reads a super tank', () => {
  expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 130, extra: { mFluid: comp({ FluidName: str('water'), Amount: int(500_000) }) } })), facts, itemNames))
    .toEqual({ dim: 0, pos: P, kind: 'gt_tank', contents: [{ key: 'fluid:water', count: 500_000 }] });
});
it('ignores machines that are not GT storage', () => expect(classifyGtStorage(raw(gtMachine({ pos: P, mID: 2002 })), facts, itemNames)).toBeNull());
it('voltageTier maps volts to the smallest covering tier', () => expect([8, 32, 33, 128, 512].map(voltageTier)).toEqual([0, 1, 2, 2, 3]));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/classify-gt.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/facts.ts'`.

- [ ] **Step 3: Implement `facts.ts`, `classify/gt.ts`, `classify/gtchests.ts` and the facts helper**

Field rules come from world-format §6.1–§6.5: `mFacing` Short, `mMainFacing` Int (basic machines only), `mColor` Byte, `mWorks` saved inverted, `mEUt` Int or Long (use `Math.abs`), multiblock = export kind `multiblock` or any of `mWrench … mCrowbar` present, battery charge = `tag['GT.ItemCharge']` else `tag.charge`, pipe kind from the export kind (`cable`/`fluid_pipe`/`item_pipe`) else `mDisableInput` → fluid, `mLastReceivedFrom` → item, neither → cable.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/classify-gt.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/facts.ts src/server/world/model.ts src/server/world/classify/gt.ts src/server/world/classify/gtchests.ts tests/helpers/world-facts.ts tests/unit/world/classify-gt.test.ts
git commit -m "feat(world): classify GregTech machines, pipes and digital storage" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 5: Storage-mod classifiers: Storage Drawers, JABBA, chests

**Files:**
- Create: `src/server/world/classify/drawers.ts`, `src/server/world/classify/jabba.ts`, `src/server/world/classify/chests.ts`
- Modify: `tests/helpers/world-tes.ts` (add `drawer`, `drawerController`, `drawerSlave`, `barrel`, `ironChest`)
- Test: `tests/unit/world/classify-storage.test.ts`

**Interfaces:**
- Consumes: Task 3 (`RawTe`, `readStack`), Task 4 (`StorageRec`).
- Produces:
  - `classify/drawers.ts`: `interface DrawerConfig { range: number; maxDrawers: number; upgradeMult: Record<number, number>; creativeUnlimited: boolean }`; `DEFAULT_DRAWER_CONFIG = { range: 4, maxDrawers: 50, upgradeMult: { 2: 2, 3: 4, 4: 8, 5: 16, 6: 32, 7: 64, 8: 128 }, creativeUnlimited: true }`; `readDrawerConfig(text: string | null): DrawerConfig` (Forge cfg: `controller { I:range I:maxDrawers }`, `upgrades { I:level<N>Mult }`, `B:enableCreativeUpgrades`; missing keys keep the defaults); `slotCapacityStacks(cap: number, upgrades: Array<{ name: string; damage: number }>, cfg: DrawerConfig): number | null` (world-format §6.6 corrected rule; `null` = unlimited); `classifyDrawer(te: RawTe, itemNames: Map<number, string>, cfg: DrawerConfig): StorageRec | null` (`tileDrawersStandard` → `drawer` with `capacityStacks = slotCapacity × slot count`; `tileDrawersComp` → `drawer` with `contents: null`; `tileController` → `drawer_controller` with `contents: []`; other Storage Drawers TEs → `null`); `isNetworkedDrawerBlock(name: string): boolean` and `countsAsDrawer(name: string): boolean` (domain `StorageDrawers` or `StorageDrawersBop|Forestry|Misc|Natura`; networked paths match `/^(full|half)(Drawers|Custom)\d|^compDrawers|^controller(Slave)?$|^trim(Custom)?$/`; drawers are the first two alternatives only).
  - `classify/jabba.ts`: `classifyBarrel(te: RawTe, itemNames: Map<number, string>): StorageRec` (`kind: 'barrel'`, contents from `storage.current_item` × `storage.amount`, `capacityStacks = storage.maxstacks`; `ender` or `linked` set → `contents: null`).
  - `classify/chests.ts`: `IRON_CHEST_SLOTS = { IRON: 54, GOLD: 81, DIAMOND: 108, COPPER: 45, STEEL: 72, CRYSTAL: 108, OBSIDIAN: 108, NETHERITE: 135, DARKSTEEL: 135, SILVER: 72 }`; `classifyChest(te: RawTe, itemNames: Map<number, string>): StorageRec | null` (`Chest` → `chest`, 27 stacks; `IronChest.<TYPE>` → `iron_chest`, capacity from the table, omitted for other types; `Slot` read as `& 0xFF`).
  - Shared rule for every classifier in this task: contents are summed per key in first-seen order; if any non-empty stack cannot be read (`readStack` → `null`) the block's `contents` is `null` (found-but-unknown).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/classify-storage.test.ts
const cfg = DEFAULT_DRAWER_CONFIG;
it('reads drawer slots with Int counts and base capacity', () => {
  expect(classifyDrawer(raw(drawer({ pos: P, slots: [[265, 1000], null, [4, 64], null], cap: 16 })), itemNames, cfg)).toEqual({
    dim: 0, pos: P, kind: 'drawer', capacityStacks: 64,
    contents: [{ key: 'minecraft:iron_ingot@0', count: 1000 }, { key: 'minecraft:cobblestone@0', count: 64 }] });
});
it.each([
  [[{ name: 'StorageDrawers:upgrade', damage: 3 }, { name: 'StorageDrawers:upgrade', damage: 8 }], 16 * 132],
  [[{ name: 'StorageDrawers:upgrade', damage: 3 }, { name: 'StorageDrawers:upgradeDowngrade', damage: 0 }], 4],
  [[{ name: 'StorageDrawers:upgrade', damage: 9 }], 16],            // damage outside 2..8 adds 1
  [[{ name: 'StorageDrawers:upgradeCreative', damage: 1 }], null],  // vending variant is unlimited too
])('slot capacity with upgrades %j is %s stacks', (ups, want) => expect(slotCapacityStacks(16, ups, cfg)).toBe(want));
it('creative upgrades are limited when the config disables them', () =>
  expect(slotCapacityStacks(16, [{ name: 'StorageDrawers:upgradeCreative', damage: 0 }], { ...cfg, creativeUnlimited: false })).toBe(16));
it('reads legacy Item/Meta slots', () => { /* slot comp({ Item: short(265), Meta: short(0), Count: int(5) }) → [{ key: 'minecraft:iron_ingot@0', count: 5 }] */ });
it('marks compacting drawers found-but-unknown and controllers empty', () => {
  expect(classifyDrawer(raw(drawer({ pos: P, slots: [[265, 9]], comp: true })), itemNames, cfg)!.contents).toBeNull();
  expect(classifyDrawer(raw(drawerController(P)), itemNames, cfg)).toEqual({ dim: 0, pos: P, kind: 'drawer_controller', contents: [] });
  expect(classifyDrawer(raw(drawerSlave(P, [0, 64, 0])), itemNames, cfg)).toBeNull();
});
it('parses the pack config and falls back to defaults', () => {
  const text = 'blocks {\n  controller {\n    I:maxDrawers=30\n    I:range=6\n  }\n}\nupgrades {\n  I:level2Mult=3\n}\ngeneral {\n  B:enableCreativeUpgrades=false\n}\n';
  expect(readDrawerConfig(text)).toEqual({ range: 6, maxDrawers: 30, upgradeMult: { ...cfg.upgradeMult, 2: 3 }, creativeUnlimited: false });
  expect(readDrawerConfig(null)).toEqual(cfg);
});
it('knows which blocks are networked and which count as drawers', () => {
  expect(['StorageDrawers:fullDrawers4', 'StorageDrawersBop:fullDrawers2', 'StorageDrawers:trim', 'StorageDrawers:controllerSlave',
    'StorageDrawers:framingTable', 'minecraft:chest'].map(isNetworkedDrawerBlock)).toEqual([true, true, true, true, false, false]);
  expect(['StorageDrawers:halfCustom2', 'StorageDrawers:trim', 'StorageDrawers:controller'].map(countsAsDrawer)).toEqual([true, false, false]);
});
it('reads a JABBA barrel, and hides linked barrels', () => {
  expect(classifyBarrel(raw(barrel({ pos: P, item: 265, amount: 3000, maxstacks: 64 })), itemNames))
    .toEqual({ dim: 0, pos: P, kind: 'barrel', capacityStacks: 64, contents: [{ key: 'minecraft:iron_ingot@0', count: 3000 }] });
  expect(classifyBarrel(raw(barrel({ pos: P, item: 265, amount: 10, linked: true })), itemNames).contents).toBeNull();
  expect(classifyBarrel(raw(barrel({ pos: P, amount: 0 })), itemNames).contents).toEqual([]);
});
it('reads chests, unsigned slots and merges duplicate stacks', () => {
  expect(classifyChest(raw(chest(P, [[0, stack(265, 64)], [200, stack(265, 32)]])), itemNames))
    .toEqual({ dim: 0, pos: P, kind: 'chest', capacityStacks: 27, contents: [{ key: 'minecraft:iron_ingot@0', count: 96 }] });
  expect(classifyChest(raw(ironChest(P, 'DIAMOND', [])), itemNames)).toMatchObject({ kind: 'iron_chest', capacityStacks: 108 });
  expect(classifyChest(raw(ironChest(P, 'WOOD', [])), itemNames)!.capacityStacks).toBeUndefined();
  expect(classifyChest(raw(chest(P, [[0, stack(9999, 1)]])), itemNames)!.contents).toBeNull();     // unknown item id
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/classify-storage.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/classify/drawers.ts'`.

- [ ] **Step 3: Implement the three classifiers and the builders**

The builders write exactly the NBT shapes of world-format §6.6–§6.8 (`Slots` list of `{}` or `{ItemStack, Count: Int}`, `Cap` Int, `Upgrades` list of `{Slot} + stack`; barrel `storage` compound with `current_item` Count 0; chests `Items` with `Slot` Byte, so slot 200 is written as byte −56).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/classify-storage.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/classify/drawers.ts src/server/world/classify/jabba.ts src/server/world/classify/chests.ts tests/helpers/world-tes.ts tests/unit/world/classify-storage.test.ts
git commit -m "feat(world): classify drawers, barrels and chests" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 6: Logistics-mod classifiers: Project Red, EnderIO, AE2

**Files:**
- Create: `src/server/world/classify/projectred.ts`, `src/server/world/classify/enderio.ts`, `src/server/world/classify/ae2.ts`
- Modify: `tests/helpers/world-tes.ts` (add `prPipe`, `otherMultipart`, `conduit`, `ae2Controller`, `ae2Drive`, `ae2CableBus`, `ae2Interface`)
- Test: `tests/unit/world/classify-logistics.test.ts`

**Interfaces:**
- Consumes: Task 3 (`RawTe`, `ItemCount`, `readStack`), Task 1 getters.
- Produces:
  - `classify/projectred.ts`: `type PrPipeType = 'basic' | 'junction' | 'interface' | 'crafting' | 'request' | 'extension' | 'firewall' | 'pressure' | 'resistance' | 'valve' | 'latency'`; `PR_PIPES: Record<string, { type: PrPipeType; routed: boolean }>` (`pr_pipe` basic, `pr_rbasic` junction, `pr_rinterface` interface, `pr_rcrafting` crafting, `pr_rrequest` request, `pr_rextension` extension, `pr_rfire` firewall — routed; `pr_pt` pressure, `pr_rpt` resistance, `pr_netvalve` valve, `pr_netlatency` latency — not routed); `ROUTING_CHIPS = ['responder', 'dyn_responder', 'overflow', 'terminator', 'extractor', 'broadcaster', 'stock_keeper', 'crafting', 'extension'] as const`; `interface PrPipeRec { dim: number; pos: Vec3; type: PrPipeType; routed: boolean; connMap: number; io: number | null; chips: string[] }`; `classifyMultipart(te: RawTe): PrPipeRec | null` (first part of `parts` whose `id` is in `PR_PIPES`; chip type = `ROUTING_CHIPS[stack Damage]` or `'unknown'`; `io` 6 or absent → `null`); `prConnects(connMap: number, side: number): boolean` (`(connMap & (0x41 << side)) !== 0`).
  - `classify/enderio.ts`: `type ConduitType = 'item' | 'liquid' | 'power' | 'redstone' | 'me' | 'gas' | 'oc' | 'other'`; `interface ConduitRec { dim: number; pos: Vec3; conduits: Array<{ type: ConduitType; connections: number; external: number }> }` (both bitmasks `1 << side` from the `connections` / `externalConnections` ordinal IntArrays); `conduitType(className: string): ConduitType` (by the package segment after `crazypants.enderio.conduit.`); `classifyConduitBundle(te: RawTe): ConduitRec`.
  - `classify/ae2.ts`: `type Ae2BlockKind = 'controller' | 'drive' | 'chest' | 'interface' | 'cable_bus'`; `interface Ae2Rec { dim: number; pos: Vec3; block: Ae2BlockKind; center: 'glass' | 'covered' | 'smart' | 'dense' | 'dense_covered' | null; parts: Array<{ side: number; type: string }>; channels: number; cells: ItemCount[] | null }`; `PART_BASES: ReadonlyArray<[number, string]>` (world-format §6.11 table, ascending); `partType(damage: number): string` (largest base ≤ damage); `classifyAe2(te: RawTe, itemNames: Map<number, string>): Ae2Rec | null` (TE ids `BlockController`, `BlockDrive`, `BlockChest`, `BlockInterface`, `BlockCableBus`; `def:6` is the centre cable, `def:0..5` the side parts; `channels` = 1 for a drive, ME chest or interface block, plus 1 per side part whose type does not match `/^Cable|^CableAnchor$|^QuartzFiber$|Monitor$|ToggleBus$/`; `cells` from `inv` `#<slot>` cell stacks: item cells sum `@<n>` (else `Cnt`) of each `#<n>` AE stack; any fluid cell (`ft`/`fc`) or unreadable stack → `null`; blocks other than drive/chest have `cells: []`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/classify-logistics.test.ts
it('reads a routed interface pipe with chips and its inventory side', () => {
  const connMap = 0x41 | (0x41 << 3);
  const r = classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rinterface', connMap, io: 2, chips: [stack(5200, 1, 0), stack(5200, 1, 4)] })));
  expect(r).toEqual({ dim: 0, pos: P, type: 'interface', routed: true, connMap, io: 2, chips: ['responder', 'extractor'] });
  expect([prConnects(connMap, 0), prConnects(connMap, 3), prConnects(connMap, 1)]).toEqual([true, true, false]);
});
it('treats io 6 as no inventory and ignores multiparts without a pipe', () => {
  expect(classifyMultipart(raw(prPipe({ pos: P, part: 'pr_rbasic', connMap: 1, io: 6 })))!.io).toBeNull();
  expect(classifyMultipart(raw(otherMultipart(P, 'mc_torch')))).toBeNull();
});
it('reads conduit bundles as per-type bitmasks', () => {
  expect(classifyConduitBundle(raw(conduit({ pos: P, conduits: [
    { cls: 'crazypants.enderio.conduit.item.ItemConduit', connections: [2, 3], external: [4] },
    { cls: 'crazypants.enderio.conduit.power.PowerConduit', connections: [0], external: [] } ] }))).conduits)
    .toEqual([{ type: 'item', connections: 12, external: 16 }, { type: 'power', connections: 1, external: 0 }]);
  expect(['crazypants.enderio.conduit.liquid.EnderLiquidConduit', 'crazypants.enderio.conduit.me.MEConduit', 'x.y.Z'].map(conduitType))
    .toEqual(['liquid', 'me', 'other']);
});
it('maps AE2 part damage to part types, colour offsets included', () =>
  expect([0, 16, 60, 76, 220, 281, 440, 465, 520].map(partType))
    .toEqual(['CableGlass', 'CableGlass', 'CableDense', 'CableDense', 'StorageBus', 'AdvancedLevelEmitter', 'Interface', 'P2PTunnelEU', 'CableDenseCovered']));
it('reads a cable bus with a dense centre and a storage bus', () => {
  expect(classifyAe2(raw(ae2CableBus({ pos: P, center: 60, parts: { 2: 220 } })), itemNames))
    .toEqual({ dim: 0, pos: P, block: 'cable_bus', center: 'dense', parts: [{ side: 2, type: 'StorageBus' }], channels: 1, cells: [] });
});
it('reads drive cells, and hides drives holding fluid cells', () => {
  expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [{ items: [[265, 0, 500]] }] })), itemNames))
    .toMatchObject({ block: 'drive', channels: 1, cells: [{ key: 'minecraft:iron_ingot@0', count: 500 }] });
  expect(classifyAe2(raw(ae2Drive({ pos: P, cells: [{ items: [[265, 0, 5]] }, { fluid: true }] })), itemNames)!.cells).toBeNull();
  expect(classifyAe2(raw(ae2Controller(P)), itemNames)).toMatchObject({ block: 'controller', channels: 0 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/classify-logistics.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/classify/projectred.ts'`.

- [ ] **Step 3: Implement the three classifiers and the builders**

Builders follow world-format §6.9–§6.11: `savedMultipart` with `parts: [{ id, meta: Byte, connMap: Int, io: Byte, chipsitems: [{ index: Int } + stack], chipsitemsCount: Int(4) }]`; conduit bundles `conduits: [{ conduitType, conduit: { connections: IntArray, externalConnections: IntArray, conModes: ByteArray(6) } }]`, `facadeId: "null"`; AE2 cable bus `def:<side>` stacks of `appliedenergistics2:item.ItemMultiPart` with the part damage, drives `inv: { '#0': cellStack }` with the cell tag `{ it, ic, '#0': aeStack, '@0': Long }` (fluid cells use `ft`/`fc`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/classify-logistics.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/classify/projectred.ts src/server/world/classify/enderio.ts src/server/world/classify/ae2.ts tests/helpers/world-tes.ts tests/unit/world/classify-logistics.test.ts
git commit -m "feat(world): classify routed pipes, conduits and AE2 blocks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 7: Bases, visited dimensions and prospecting

**Files:**
- Create: `src/server/world/bases.ts`, `src/server/world/dims.ts`, `src/server/world/prospecting.ts`
- Modify: `src/shared/types/world.ts` (add the pure helpers `baseIdOf` and `findBase`, used by server and client)
- Test: `tests/unit/world/bases.test.ts`, `tests/unit/world/dims.test.ts`, `tests/unit/world/prospecting.test.ts`

**Interfaces:**
- Consumes: Task 1 (`readGzipNbt`, getters), Task 3 (`ChunkStat`, `Vec3`, `makeWorld` side files), Task 4 (`ScanPackFacts.dimensions`), `Base`, `DimSummary`, `WorldScan` (Task 1).
- Produces:
  - `bases.ts`: `interface BaseSignal { dim: number; pos: Vec3; seed: boolean; machine: boolean; tier: number | null }` (seeds = every classified record except vanilla `Chest`; `machine` = GT machine; `tier` only when `countsForTopTier`); `interface BaseHints { claims: Array<{ team: string; dim: number; cx: number; cz: number }>; beds: Array<{ dim: number; x: number; z: number }> }`; `LINK_CHUNKS = 3`, `MIN_SEEDS = 4`, `INHABITED_KEEP_TICKS = 72_000`; `findBases(signals: BaseSignal[], chunks: ChunkStat[], hints: BaseHints, dimName: (dim: number) => string): Base[]`; `baseAt(bases: Base[], dim: number, pos: Vec3): Base | null`. In `src/shared/types/world.ts`: `baseIdOf(dim: number, cx: number, cz: number): string` (`"dim:cx:cz"`) and `findBase(scan: Pick<WorldScan, 'bases'>, baseId: string | null): Base | null`.
  - Clustering rule (the plan's decision; spec §8 leaves it to the builder): per dimension, chunks holding ≥ 1 seed are linked when their Chebyshev chunk distance ≤ `LINK_CHUNKS`; a cluster is kept when it has ≥ `MIN_SEEDS` seeds, or a chunk with `InhabitedTime ≥ INHABITED_KEEP_TICKS`, or a claimed chunk or bed spawn inside its chunk bounds. `bbox` covers every signal (seed or not) inside those chunk bounds; `center` = floor of the bbox midpoint; `machineCount` = GT machines in it; `topTier` = highest `tier`, 0 when none. **Stable id** = `baseIdOf` of the cluster chunk with the highest `InhabitedTime` (ties: more seeds, then lower `cx`, then lower `cz`) — inhabited time only grows, so the id survives rescans. `findBase` falls back to the base of the same dimension whose bbox contains that anchor chunk's centre. **Name** = `"<team> base (x, z)"` when a team's claim overlaps, else `"<dimension name> base (x, z)"` with `x, z` = centre. Bases are sorted by `machineCount` descending, then id.
  - `dims.ts`: `LOCATION_QUESTS = { 479: { dim: -1, name: 'THE NETHER' }, 225: { dim: 7, name: 'Searching for Answers' }, 986: { dim: 1, name: 'Is This the End?' }, 1072: { dim: 28, name: 'Moon Arrival' }, 2311: { dim: 64, name: 'Ross128b Trip' }, 2634: { dim: 227, name: 'A Vision of the Future' } }` (questIDHigh 0); `interface VisitHint { dim: number; why: string }`; `playerHints(player: NbtCompound): { visits: VisitHint[]; beds: BaseHints['beds'] }` (`Dimension` → `player location`, `Spawns[].Dim` → `bed spawn`, `ForgeData.PlayerPersisted.ReturnPortals[].FromDim/ToDim` → `portal use`; beds from `Spawns[].SpawnX/SpawnZ`); `questVisits(progress: unknown): VisitHint[]` (BetterQuesting JSON with `:<type>` key suffixes; lists may be arrays or `"<i>:10"`-keyed objects; a quest counts when its `completed` has ≥ 1 entry); `claimHints(team: string, claims: NbtCompound): BaseHints['claims']` (`ClaimedChunks: { "<dim>": [{ x, z }] }`); `dimSummaries(chunks: ChunkStat[], hints: VisitHint[], dims: DimensionInfo[]): DimSummary[]` (one entry per dim that has chunks or hints, sorted by dim id; `keys` = every `DimensionInfo.key` with that id; `name` = first such info's name, else `Overworld` for 0, else `DIM<id>`; `visitEvidence` = `inhabited chunks: <n>` when n > 0, then each distinct `why` with ` (×<count>)` when repeated); `visitedKeys(s: DimSummary[]): string[]` (all keys of visited dims, in dim order). Evidence strings never contain player names or UUIDs.
  - `prospecting.ts`: `interface VpVein { dim: number; chunkX: number; chunkZ: number; vein: string; depleted: boolean }`; `vpWorldId(visualprospectingDat: Uint8Array): string | null` (first String under `data` matching `/_[0-9a-f-]{36}$/`); `readVpDimension(buf: Uint8Array): VpVein[]` (gzip NBT version 3; `chunkX`/`chunkZ`/`veinTypeIndex` as IntArray or List<Int>, `depleted` ByteArray); `interface TeamDiscoveries { dim: number; veins: Array<[number, number]>; depleted: Array<[number, number]> }`; `teamBlobOf(json: unknown): string | null` (`TeamData.visualprospecting.blob`); `decodeTeamBlob(b64: string): TeamDiscoveries[]` (gzip, big-endian `int nDims; { int dim; LongSet veins; LongSet fluidFields; LongSet depleted }`, key = `chunkX << 32 | chunkZ & 0xffffffff`); `joinDiscoveries(cache: VpVein[], teams: TeamDiscoveries[][]): { prospected: WorldScan['prospected']; unmatched: number }` (block coordinates of the vein chunk centre `x = chunkX·16 + 8`, `z = chunkZ·16 + 8`; de-duplicated across teams; sorted by dim, x, z).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/bases.test.ts — sig(dim, pos, opts) builds a BaseSignal; stat(dim, cx, cz, inhabited) a ChunkStat
it('clusters nearby machines into one base and ignores a lone dungeon chest', () => {
  const signals = [sig(0, [1, 64, 1], { tier: 1 }), sig(0, [2, 64, 2]), sig(0, [17, 65, 3], { tier: 3 }), sig(0, [18, 64, 4]),
    sig(0, [50, 70, 5]), sig(0, [51, 64, 6]), sig(0, [640, 30, 640], { seed: false, machine: false })];
  const bases = findBases(signals, [stat(0, 0, 0, 100), stat(0, 1, 0, 500_000), stat(0, 3, 0, 10)], NO_HINTS, () => 'Overworld');
  expect(bases).toEqual([{ id: '0:1:0', dim: 0, name: 'Overworld base (26, 3)', center: [26, 67, 3],
    bbox: { minX: 1, minY: 64, minZ: 1, maxX: 51, maxY: 70, maxZ: 6 }, machineCount: 6, topTier: 3 }]);
});
it('splits clusters more than 3 chunks apart', () => { /* 4 machines in chunk (0,0), 4 in chunk (5,0) → 2 bases */ });
it('keeps a small cluster when claimed, inhabited or with a bed; drops it otherwise', () => {
  const one = (cx: number) => sig(0, [cx * 16 + 1, 64, 1]);
  const hints = { claims: [{ team: 'Alpha', dim: 0, cx: 20, cz: 0 }], beds: [{ dim: 0, x: 40 * 16 + 3, z: 2 }] };
  const names = findBases([one(20), one(30), one(40), one(60)], [stat(0, 30, 0, 80_000)], hints, () => 'Overworld').map((b) => b.name).sort();
  expect(names).toEqual(['Alpha base (321, 1)', 'Overworld base (481, 1)', 'Overworld base (641, 1)']);
});
it('handles negative coordinates', () => {
  const bases = findBases([sig(0, [-1, 64, -1]), sig(0, [-17, 64, -1]), sig(0, [-33, 64, -20]), sig(0, [-2, 60, -2])], [], NO_HINTS, () => 'Overworld');
  expect(bases[0]).toMatchObject({ id: '0:-1:-1', bbox: { minX: -33, maxX: -1, minZ: -20, maxZ: -1 } });
});
it('findBase falls back to the anchor chunk after a rescan', () => {
  const scan = { bases: [{ ...BASE, id: '0:2:0', bbox: { minX: 0, minY: 0, minZ: 0, maxX: 63, maxY: 255, maxZ: 15 } }] };
  expect(findBase(scan, '0:1:0')!.id).toBe('0:2:0');
  expect([findBase(scan, '7:1:0'), findBase(scan, null), findBase(scan, 'junk')]).toEqual([null, null, null]);
});

// tests/unit/world/dims.test.ts
it('judges visits by InhabitedTime, players, quests and prospecting — never by region files alone', () => {
  const chunks = [stat(0, 0, 0, 500), stat(7, 0, 0, 0), stat(7, 1, 0, 0), stat(7, 2, 0, 0), stat(-1, 0, 0, 0)];
  const hints = [{ dim: -1, why: 'player location' }, { dim: 28, why: 'quest: Moon Arrival' }, { dim: 64, why: 'team prospecting' }, { dim: 64, why: 'team prospecting' }];
  const s = dimSummaries(chunks, hints, testFacts().dimensions);
  expect(s.map((d) => [d.dim, d.keys, d.chunks, d.inhabitedChunks, d.visited, d.visitEvidence])).toEqual([
    [-1, ['nether'], 1, 0, true, ['player location']], [0, ['overworld'], 1, 1, true, ['inhabited chunks: 1']],
    [7, ['twilightforest'], 3, 0, false, []], [28, ['moon'], 0, 0, true, ['quest: Moon Arrival']],
    [64, ['ross128b'], 0, 0, true, ['team prospecting (×2)']]]);
  expect(visitedKeys(s)).toEqual(['nether', 'overworld', 'moon', 'ross128b']);
});
it('a visited DIM 1 marks both End keys', () => expect(visitedKeys(dimSummaries([stat(1, 0, 0, 5)], [], testFacts().dimensions))).toEqual(['theend', 'endasteroid']));
it('reads player location, bed spawns and portal use', () => {
  const p = parseTag(comp({ Dimension: int(-1), Spawns: list('compound', [comp({ Dim: int(7), SpawnX: int(5), SpawnY: int(70), SpawnZ: int(-9) })]),
    ForgeData: comp({ PlayerPersisted: comp({ ReturnPortals: list('compound', [comp({ FromDim: int(0), ToDim: int(-1) })]) }) }) }));
  expect(playerHints(p)).toEqual({ visits: [{ dim: -1, why: 'player location' }, { dim: 7, why: 'bed spawn' }, { dim: 0, why: 'portal use' }, { dim: -1, why: 'portal use' }],
    beds: [{ dim: 7, x: 5, z: -9 }] });
});
it('counts only completed location quests', () => {
  const progress = { 'questProgress:9': {
    '0:10': { 'questIDHigh:4': 0, 'questIDLow:4': 1072, 'completed:9': { '0:10': { 'uuid:8': 'x', 'timestamp:4': 1 } } },
    '1:10': { 'questIDHigh:4': 0, 'questIDLow:4': 479, 'completed:9': {} },
    '2:10': { 'questIDHigh:4': 0, 'questIDLow:4': 88, 'completed:9': [{ 'uuid:8': 'x' }] } } };
  expect(questVisits(progress)).toEqual([{ dim: 28, why: 'quest: Moon Arrival' }]);
});

// tests/unit/world/prospecting.test.ts — files written by makeWorld({ vp: { worldId: 'World_0f0e…', dims: { 0: [{ chunkX: -3, chunkZ: 5, vein: 'ore.mix.copper' }] } },
//                                                                   teams: { Alpha: [{ dim: 0, veins: [[-3, 5], [10, 10]] }] } })
it('finds the world id, decodes the server cache and joins team discoveries', async () => {
  expect(vpWorldId(await readFile(join(worldDir, 'data/visualprospecting.dat')))).toBe(WORLD_ID);
  const cache = readVpDimension(await readFile(join(serverDir, 'visualprospecting/server', WORLD_ID, 'DIM0.dat')));
  expect(cache).toEqual([{ dim: 0, chunkX: -3, chunkZ: 5, vein: 'ore.mix.copper', depleted: false }]);
  const team = decodeTeamBlob(teamBlobOf(JSON.parse(await readFile(join(worldDir, 'gtnhteams/Alpha.json'), 'utf8')))!);
  expect(team).toEqual([{ dim: 0, veins: [[-3, 5], [10, 10]], depleted: [] }]);
  expect(joinDiscoveries(cache, [team, team])).toEqual({ prospected: [{ dim: 0, x: -40, z: 88, vein: 'ore.mix.copper' }], unmatched: 1 });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/bases.test.ts tests/unit/world/dims.test.ts tests/unit/world/prospecting.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/bases.ts'`.

- [ ] **Step 3: Implement `bases.ts`, `dims.ts`, `prospecting.ts`**

Use a union-find over seed chunks (sorting by `cx` and checking only neighbours within `LINK_CHUNKS` keeps it near-linear). Chunk coordinates are `Math.floor(x / 16)` (`x >> 4`), never truncation.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/bases.test.ts tests/unit/world/dims.test.ts tests/unit/world/prospecting.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/shared/types/world.ts src/server/world/bases.ts src/server/world/dims.ts src/server/world/prospecting.ts tests/unit/world/bases.test.ts tests/unit/world/dims.test.ts tests/unit/world/prospecting.test.ts
git commit -m "feat(world): find bases, visited dimensions and prospected veins" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 8: Block reader, `readArea` and map tiles

**Files:**
- Create: `src/server/world/area.ts`, `src/server/world/tiles.ts`
- Test: `tests/unit/world/area-tiles.test.ts`

**Interfaces:**
- Consumes: Task 1 (`regionChunkRefs`, `chunkPayload`, `inflateChunk`, `parseNbt`, `decodeSection`, `DecodedSection`, `chunkIndex`, `regionOfChunk`, `regionPathOf`, `Voxels`, `MapTile`, `BBox`, `AIR_INDEX`, `UNKNOWN_INDEX`, `UNKNOWN_BLOCK`, `tileOf`), Task 2 (`WorldFiles`), `BlockRef` (Plan 1).
- Produces:
  - `area.ts`: `interface RegionStore { readRegion(dim: number, rx: number, rz: number): Promise<Uint8Array | null> }`; `regionStoreFromFiles(files: WorldFiles): RegionStore`; `regionStoreFromDir(regionsDir: string): RegionStore` (files at `<regionsDir>/<regionPathOf(dim, rx, rz)>`); `interface DecodedChunk { cx: number; cz: number; sections: Array<DecodedSection | null> /* length 16, by section Y */ }`; `interface BlockReader { chunk(dim: number, cx: number, cz: number): Promise<DecodedChunk | null>; blockAt(dim: number, x: number, y: number, z: number): Promise<{ id: number; meta: number } | null> }` (`null` = chunk not available; a missing section or `y` outside 0..255 is air); `createBlockReader(store: RegionStore, opts?: { maxChunks?: number /* 128 */; maxRegions?: number /* 4 */ }): BlockReader` (LRU caches; a chunk that fails to inflate/parse reads as missing); `type MteLookup = (dim: number, x: number, y: number, z: number) => number | undefined`; `interface AreaInput { reader: BlockReader; blockNames: Map<number, string>; mteAt: MteLookup }`; `MAX_AREA_VOXELS = 8_388_608`; `readAreaVoxels(input: AreaInput, dim: number, bbox: BBox): Promise<Voxels>` (local palette, `[0]` air, `[1]` `UNKNOWN_BLOCK` for columns of missing chunks; `RangeError` above the limit; yields with `setImmediate` after each chunk).
  - `tiles.ts`: `GT_MACHINE_BLOCK = 'gregtech:gt.blockmachines'`; `refAt(name: string, meta: number, mteId: number | undefined): BlockRef` (`mteId` kept only on `GT_MACHINE_BLOCK`); `interface Palette { refs: BlockRef[]; index(ref: BlockRef): number }`; `createPalette(initial?: BlockRef[], opts?: { frozen?: boolean }): Palette` (`refs[0]` air, `refs[1]` unknown; de-duplicated by `id|meta|mteId`; a frozen palette returns `UNKNOWN_INDEX` for new states); `addChunkToPalette(input: AreaInput, palette: Palette, dim: number, cx: number, cz: number): Promise<void>`; `renderTile(input: AreaInput, palette: Palette, dim: number, tx: number, tz: number, maxY: number): Promise<MapTile>` (per column the first non-air block at or below `maxY`, scanning down; column `i = lz·64 + lx` with `lx = x − tx·64`; missing chunk → `UNKNOWN_INDEX`, height 0; all air → `AIR_INDEX`, height 0; yields after each chunk).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/area-tiles.test.ts
// World: chunk (0,0) EID with stone at y=60 (x 0..15, z 0..15) and gt.blockmachines meta 0 at (1,61,0);
//        chunk (-1,-1) legacy with stone at y=10 (x -16..-1, z -16..-1). Nothing else exists.
const mteAt: MteLookup = (d, x, y, z) => (d === 0 && x === 1 && y === 61 && z === 0 ? 2002 : undefined);
it('reads blocks in both formats, across the 0/-1 border, and reports missing chunks', async () => {
  const r = createBlockReader(regionStoreFromFiles(await openDirWorld(worldDir)));
  expect(await r.blockAt(0, -1, 10, -1)).toEqual({ id: 1, meta: 0 });
  expect(await r.blockAt(0, -1, 11, -1)).toEqual({ id: 0, meta: 0 });
  expect(await r.blockAt(0, 0, 60, 0)).toEqual({ id: 1, meta: 0 });
  expect(await r.blockAt(0, 100, 60, 100)).toBeNull();
});
it('reads an area into voxels with a local palette and GT machine ids', async () => {
  const v = await readAreaVoxels(input, 0, { minX: -2, minY: 59, minZ: -1, maxX: 1, maxY: 61, maxZ: 0 });
  const at = (x: number, y: number, z: number) => v.palette[v.blocks[((y - 59) * 2 + (z + 1)) * 4 + (x + 2)]];
  expect([v.origin, v.size]).toEqual([[-2, 59, -1], [4, 3, 2]]);
  expect(at(1, 61, 0)).toEqual({ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2002 });
  expect(at(0, 60, 0)).toEqual({ id: 'minecraft:stone', meta: 0 });
  expect(at(-1, 60, -1)).toEqual({ id: 'minecraft:air', meta: 0 });
  expect([at(-1, 60, 0), at(0, 60, -1)]).toEqual([UNKNOWN_BLOCK, UNKNOWN_BLOCK]);
});
it('refuses areas above MAX_AREA_VOXELS', async () => {
  await expect(readAreaVoxels(input, 0, { minX: 0, minY: 0, minZ: 0, maxX: 256, maxY: 255, maxZ: 256 })).rejects.toThrow(RangeError);
});
it('renders a tile at negative tile coordinates', async () => {
  const pal = createPalette();
  const t = await renderTile(input, pal, 0, -1, -1, 255);
  const stone = pal.index({ id: 'minecraft:stone', meta: 0 });
  expect([t.top[4095], t.height[4095]]).toEqual([stone, 10]);   // x = -1, z = -1
  expect([t.top[3120], t.height[3120]]).toEqual([stone, 10]);   // x = -16, z = -16
  expect([t.top[0], t.height[0]]).toEqual([UNKNOWN_INDEX, 0]);  // x = -64, z = -64: chunk (-4,-4) missing
});
it('cuts columns at maxY', async () => {
  const pal = createPalette();
  const col = async (maxY: number) => { const t = await renderTile(input, pal, 0, 0, 0, maxY); return [pal.refs[t.top[1]], t.height[1]]; };   // x = 1, z = 0
  expect(await col(255)).toEqual([{ id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2002 }, 61]);
  expect(await col(60)).toEqual([{ id: 'minecraft:stone', meta: 0 }, 60]);
  expect(await col(59)).toEqual([{ id: 'minecraft:air', meta: 0 }, 0]);
});
it('a frozen palette maps unseen states to unknown', () =>
  expect(createPalette([AIR, UNKNOWN_BLOCK, STONE], { frozen: true }).index({ id: 'minecraft:dirt', meta: 0 })).toBe(UNKNOWN_INDEX));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/area-tiles.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/area.ts'`.

- [ ] **Step 3: Implement `area.ts` and `tiles.ts`**

`DecodedChunk` parses only `Level.Sections` of the inflated chunk (`parseNbt` on the chunk, then `decodeSection` per element, placed by its `Y`). Region buffers and decoded chunks sit in small LRU maps keyed by `dim:rx:rz` / `dim:cx:cz`. Chunk and tile coordinates always use `>> 4`, `>> 5` and `Math.floor(x / 64)`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/area-tiles.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/area.ts src/server/world/tiles.ts tests/unit/world/area-tiles.test.ts
git commit -m "feat(world): block reader, voxel areas and map tiles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: Power networks and the power estimate

**Files:**
- Create: `src/server/world/graph.ts`, `src/server/world/power.ts`
- Test: `tests/unit/world/power.test.ts`

**Interfaces:**
- Consumes: Task 3 (`Vec3`, `posKey`, `DIRS`, `OPPOSITE`, `step`), Task 4 (`GtMachineRec`, `GtPipeRec`, `ScanPackFacts`, `voltageTier`), `V` (Plan 1), `PowerNetwork`, `TapPoint` (Task 1).
- Produces:
  - `graph.ts` (shared with Task 10): `class UnionFind { find(k: string): string; union(a: string, b: string): void; groups(): Map<string, string[]> }`; `comparePos(a: Vec3, b: Vec3): number` (x, then y, then z, numeric); `smallestPos(ps: Vec3[]): Vec3`; `majority(ids: Array<string | null>): string | null` (most common non-null, ties → smallest string); `pickTaps(cands: Vec3[], max: number): Vec3[]` (one per 16×16×16 cell, the smallest position of each cell, sorted with `comparePos`, first `max`).
  - Constants (gt-mechanics §4.2; weather timing is vanilla 1.7.10 `World.updateWeatherBody` — rain lasts 12,000–23,999 ticks, clear spells 12,000–179,999, see open risks): `SOLAR_BOILERS = { MTEBoilerSolar: { max: 120, min: 40, calcTicks: 1_080_000, hotFraction: 16_843 / 24_000 }, MTEBoilerSolarSteel: { max: 360, min: 120, calcTicks: 1_080_000, hotFraction: 22_577 / 24_000 } }` (also matched by mteId 105 / 114 when the export has no class); `WEATHER = { meanRainTicks: 18_000, meanClearTicks: 96_000, solarRainHoldTicks: 8_399 }`; `RAIN_OUTAGE_SECONDS = 480`; `RAIN_OUTAGE_FRACTION = 9_601 / 114_000`; `ENERGY_HATCH_RE = /Energy/`; `HATCH_LINK_RANGE = 8`; `MAX_TAPS_PER_NETWORK = 12`.
  - `solarOutput(b: { max: number; min: number; calcTicks: number }, runTime: number): number` (L/s: `max` while `runTime ≤ calcTicks`; then `max − Math.floor(max·(runTime − calcTicks)/calcTicks)` but never below `min`); `turbineSteamForFull(tier: number): number` (`(V[t] + 2^max(0, t−1)) × (6 + t) × 20 / 3` L/s, one division last); `turbineEUt(tier: number, steamLps: number): number` (`min(V[t], steam × 3 × V[t] / (20 × (6 + t) × (V[t] + 2^max(0, t−1))))`, one division, so a full turbine gives exactly `V[t]`).
  - `interface PowerInput { machines: GtMachineRec[]; pipes: GtPipeRec[]; facts: ScanPackFacts; baseOf: (dim: number, pos: Vec3) => string | null; occupied: (dim: number, pos: Vec3) => boolean }`; `interface PowerResult { networks: PowerNetwork[]; cableNetwork: Map<string, string> /* posKey → network id */; cableTier: Map<string, number> /* posKey → voltage tier on that cable */ }`; `buildPower(input: PowerInput): PowerResult`.
  - Model (the plan's decisions; each is pinned by a test below):
    1. Cable sub-networks: union-find over `pipeKind: 'cable'`; adjacent cables join when either has the bit toward the other. A cable whose bit points at an adjacent GT machine attaches that machine.
    2. Emitter outputs: turbines, `generator`s and battery buffers output on their front (`facing`); transformers on the 5 non-front faces when `works` (step-down, output tier `t`), else on the front (step-up, output tier `t + 1`). An emitter output face touching another GT machine directly attaches both.
    3. A power network is the union of sub-networks and machines through shared machines (energy flows through buffers and transformers). Id = `p:<dim>:<x>:<y>:<z>` of its smallest node position (x, then y, then z); `baseId` = most common `baseOf` among nodes (ties → smallest id), else `null`. Networks with no generator, buffer or consumer are dropped.
    4. Steam: union-find over `fluid` pipes (bits), a boiler joins through the block in front of it, a turbine through any fluid pipe whose bit points at it (or a boiler front touching it). Per steam component, supply per figure is shared among its turbines in proportion to `turbineSteamForFull`, capped at full; each turbine's EU/t counts toward its own power network.
    5. Figures per solar boiler: `clear = solarOutput(rt) × hotFraction`, `rain = 0`, `average = clear × (1 − RAIN_OUTAGE_FRACTION)`. Other boilers: `steamPerSecondMax` in all three. Non-steam `generator`s: `V[tier] × (amps ?? 1)` in all three (assumed fuelled).
    6. `voltageTier` = highest emitter output tier, else highest cable rating tier. `storedEU` = Σ buffers (`storedEU` + battery charges); `capacityEU` = Σ buffers (`V[t]·64·batterySlots` + `maxCharge` of batteries known in `facts.electric`).
    7. `consumersMaxEUt` = Σ basic machines `V[tier]` + Σ energy hatches (`kind: 'hatch'`, class matching `ENERGY_HATCH_RE`) `2 × V[tier]`; `loadEUt` = Σ running basic machines' `recipeEUt` + for each running multiblock controller its `recipeEUt`, counted once at the nearest energy hatch within `HATCH_LINK_RANGE` (Chebyshev); `solarShare` = solar part of `clear`.
    8. Taps: cables with at least one side whose bit is unset and whose neighbour is not `occupied`; one per 16×16×16 cell (smallest `posKey`), at most `MAX_TAPS_PER_NETWORK`, sorted by position; `voltageTier` = that cable's tier from `cableTier`; `freeAmps = min(cable amps, max(0, floor((average − loadEUt) / V[tier])))`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/power.test.ts — m(mteId, pos, opts) and c(mteId, pos, bits, kind) build GtMachineRec / GtPipeRec via testFacts()
it('computes solar output with calcification (integer maths, never below min)', () => {
  const hp = SOLAR_BOILERS.MTEBoilerSolarSteel, lo = SOLAR_BOILERS.MTEBoilerSolar;
  expect([0, 1_080_000, 1_440_000, 1_800_000, 2_000_000].map((rt) => solarOutput(hp, rt))).toEqual([360, 360, 240, 120, 120]);
  expect(solarOutput(lo, 1_440_000)).toBe(80);
});
it('turbine steam and EU follow gt-mechanics §4.1', () => {
  expect(turbineSteamForFull(1)).toBe(1540);
  expect(turbineSteamForFull(2)).toBeCloseTo(6933.33, 2);
  expect(turbineSteamForFull(3)).toBe(30960);
  expect([turbineEUt(1, 1540), turbineEUt(1, 3000)]).toEqual([32, 32]);
  expect(turbineEUt(1, 360 * 22_577 / 24_000)).toBeCloseTo(7.037, 3);
});
it('one clean HP boiler → LV turbine → tin cable → LV machine', () => {
  const r = buildPower(input([m(114, [0, 64, 0], { facing: 5 }), m(1120, [1, 64, 0], { facing: 5 }), m(2001, [3, 64, 0], { running: true, recipeEUt: 2 })],
                             [c(1246, [2, 64, 0], 16 | 32, 'cable')]));
  expect(r.networks).toHaveLength(1);
  const n = r.networks[0];
  expect(n).toMatchObject({ id: 'p:0:1:64:0', voltageTier: 1, consumersMaxEUt: 32, loadEUt: 2, storedEU: 0, capacityEU: 0, solarShare: 1 });
  expect(n.generatorEUt.clear).toBeCloseTo(7.037, 3);
  expect(n.generatorEUt.rain).toBe(0);
  expect(n.generatorEUt.average).toBeCloseTo(6.444, 3);
  expect(n.taps).toEqual([{ pos: [2, 64, 0], dim: 0, kind: 'power', voltageTier: 1, freeAmps: 0, networkId: 'p:0:1:64:0' }]);   // the boiler is only in the steam graph
});
it('shares piped steam, counts calcified boilers and caps turbines at full output', () => {
  // 3 clean + 1 calcified (rt 1,440,000) HP boilers → fluid pipe line → one LV turbine
  expect(oneTurbine.networks[0].generatorEUt.clear).toBeCloseTo(25.802, 3);
  // 10 clean HP boilers → two LV turbines: supply 3,386.6 L/s ≥ demand 3,080 → both full, even on average
  expect(twoTurbines.networks[0].generatorEUt).toEqual({ clear: 64, rain: 0, average: 64 });
});
it('sums buffer charge and capacity, known batteries only for capacity', () => {
  const buf = m(193, [0, 64, 0], { facing: 2, storedEU: 1000, batteries: [{ key: 'gregtech:gt.metaitem.01@32539', charge: 1_600_000 }, { key: 'x:unknown@0', charge: 10_000 }] });
  const n = buildPower(input([buf, m(2003, [0, 64, -1], {})], [])).networks[0];
  expect([n.storedEU, n.capacityEU, n.voltageTier]).toEqual([1_611_000, 512 * 64 * 16 + 1_600_000, 3]);
});
it('counts a running multiblock once, at its nearest energy hatch', () => {
  const n = buildPower(input([m(1130, [0, 64, 0], { facing: 5 }), m(42, [1, 64, 0], {}), m(1000, [2, 63, 3], { running: true, recipeEUt: 120 })],
                             [])).networks[0];   // generator front touches the hatch directly
  expect([n.consumersMaxEUt, n.loadEUt, n.generatorEUt.clear]).toEqual([256, 120, 32]);
});
it('a step-up transformer outputs one tier higher on its front', () => {
  const r = buildPower(input([m(1130, [0, 64, 0], { facing: 5 }), m(21, [1, 64, 0], { facing: 5, works: false }), m(2002, [3, 64, 0], {})],
                             [c(1386, [2, 64, 0], 16 | 32, 'cable')]));
  expect([r.cableTier.get(posKey(0, 2, 64, 0)), r.networks[0].voltageTier, r.networks.length]).toEqual([2, 2, 1]);
});
it('returns no networks for a world without power', () => expect(buildPower(input([], [])).networks).toEqual([]));
it('rain outage constants', () => { expect(RAIN_OUTAGE_SECONDS).toBe(480); expect(RAIN_OUTAGE_FRACTION).toBeCloseTo(0.08422, 5); });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/power.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/power.ts'`.

- [ ] **Step 3: Implement `power.ts`**

Positions are looked up through one `Map<posKey, record>` per dimension; networks come from `graph.ts`'s `UnionFind` and taps from `pickTaps`; all floating-point figures are left unrounded (the UI rounds).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/power.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/graph.ts src/server/world/power.ts tests/unit/world/power.test.ts
git commit -m "feat(world): power networks, steam chains and clear/rain/average estimate" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 10: Logistics networks and tap points

**Files:**
- Create: `src/server/world/logistics.ts`
- Test: `tests/unit/world/logistics.test.ts`

**Interfaces:**
- Consumes: Task 3 (`Vec3`, `posKey`, `DIRS`, `OPPOSITE`, `step`), Task 4 (`GtPipeRec`), Task 6 (`PrPipeRec`, `prConnects`, `ConduitRec`, `Ae2Rec`), `LogisticsNetwork`, `LogisticsBlock`, `TapPoint` (Task 1).
- Produces:
  - `interface LogisticsInput { prPipes: PrPipeRec[]; conduits: ConduitRec[]; gtPipes: GtPipeRec[]; ae2: Ae2Rec[]; baseOf: (dim: number, pos: Vec3) => string | null; occupied: (dim: number, pos: Vec3) => boolean }`; `type Attachments = Map<string /* posKey of an inventory */, Array<{ networkId: string; kind: LogisticsNetwork['kind'] }>>`; `interface LogisticsResult { networks: LogisticsNetwork[]; blocks: LogisticsBlock[]; attachments: Attachments }`; `buildLogistics(input: LogisticsInput): LogisticsResult`; `MAX_TAPS_PER_NETWORK` (re-exported from Task 9's value, 12).
  - Model (the plan's decisions, each pinned below):
    - **routed** — union-find over all Project Red pipes; neighbours join when either connects toward the other (`prConnects`). Kept only if it holds ≥ 1 routed pipe. Id `r:<dim>:<x>:<y>:<z>`. A pipe attaches the inventory on side `s` when `connMap & (1 << s)` is set and that neighbour is not a pipe, and on its `io` side.
    - **enderio** — one network per conduit type `item` and `liquid` (other types are not logistics); bundles join when both carry the type and either has the connection bit toward the other. Id `e:<type>:<dim>:<x>:<y>:<z>`. External-connection sides attach inventories.
    - **gtpipe** — GT `item` and `fluid` pipes, never mixed; join by either bit. Id `g:<item|fluid>:<dim>:<x>:<y>:<z>`. A bit toward a non-pipe neighbour attaches it.
    - **ae2** — AE2 blocks join when both connect toward each other: a cable bus connects on side `s` only with a centre cable and no part on `s`; controllers, drives, ME chests and interfaces connect on every side. Id `a:<dim>:<x>:<y>:<z>`. `channelsUsed` = Σ `channels`; `channelsMax` = 32 × controller faces touching a connected AE2 block, or 8 with no controller (estimate; world-format §6.11 marks capacities UNVERIFIED). Storage-bus parts attach the inventory they face; every drive and ME chest attaches itself.
    - `parts` counts what the network is made of: routed — pipe types (`interface`, `request`, `junction`, …) and `chip:<type>` per installed chip; enderio — `item`/`liquid` bundles; gtpipe — `item`/`fluid` pipes; ae2 — block kinds and part types.
    - Ids use the smallest member position (x, then y, then z, numeric); `nodes` = member count; `baseId` = most common `baseOf` (ties → smallest id); taps = members with a side that is not connected and whose neighbour is not `occupied`, one per 16×16×16 cell (smallest position), at most 12, kind `routed` / `ae2` / `pipe` (for enderio and gtpipe); `blocks` lists every member with its network id and connection bits (Project Red: sides where `prConnects`; conduits: connections | external of the logistics types; GT pipes: bits; AE2: connecting sides).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/logistics.test.ts — pr(), cb(), gp(), ae() build records directly; occupied() = any record or listed inventory position
const W = 1 << 4, E = 1 << 5;
it('joins routed pipes, attaches the interface inventory and offers one tap per cell', () => {
  const r = buildLogistics(input({ prPipes: [
    pr('interface', [0, 64, 0], (0x41 << 5), 4), pr('junction', [1, 64, 0], (0x41 << 4) | (0x41 << 5)), pr('request', [2, 64, 0], 0x41 << 4)] }));
  expect(r.networks).toEqual([{ id: 'r:0:0:64:0', baseId: null, kind: 'routed', nodes: 3, parts: { interface: 1, junction: 1, request: 1 },
    taps: [{ pos: [0, 64, 0], dim: 0, kind: 'routed', networkId: 'r:0:0:64:0' }] }]);
  expect(r.attachments.get(posKey(0, -1, 64, 0))).toEqual([{ networkId: 'r:0:0:64:0', kind: 'routed' }]);   // io side 4 = west
  expect(r.blocks.find((b) => b.pos[0] === 1)!.connections).toBe(W | E);
});
it('a basic-pipe-only Project Red line is not a routed network', () =>
  expect(buildLogistics(input({ prPipes: [pr('basic', [0, 64, 0], 0x41 << 5), pr('basic', [1, 64, 0], 0x41 << 4)] })).networks).toEqual([]));
it('conduits form one network per logistics type; power conduits are ignored', () => {
  const r = buildLogistics(input({ conduits: [cb([0, 64, 0], [{ type: 'item', connections: E, external: W }, { type: 'power', connections: E, external: 0 }]),
                                              cb([1, 64, 0], [{ type: 'item', connections: W, external: 0 }, { type: 'power', connections: W, external: 0 }])] }));
  expect(r.networks.map((n) => [n.id, n.kind, n.nodes])).toEqual([['e:item:0:0:64:0', 'enderio', 2]]);
  expect(r.attachments.get(posKey(0, -1, 64, 0))).toEqual([{ networkId: 'e:item:0:0:64:0', kind: 'enderio' }]);
});
it('GT item and fluid pipes never join each other', () => {
  const r = buildLogistics(input({ gtPipes: [gp([0, 64, 0], E, 'item'), gp([1, 64, 0], W, 'fluid')] }));
  expect(r.networks.map((n) => n.id).sort()).toEqual(['g:fluid:0:1:64:0', 'g:item:0:0:64:0']);
});
it('AE2: channels used, controller capacity, storage bus and drive attachments', () => {
  const r = buildLogistics(input({ ae2: [ae('controller', [0, 64, 0]), ae('cable_bus', [1, 64, 0], { center: 'dense', parts: [{ side: 5, type: 'StorageBus' }], channels: 1 }),
                                         ae('drive', [1, 65, 0], { channels: 1 })] }));
  expect(r.networks).toMatchObject([{ id: 'a:0:0:64:0', kind: 'ae2', nodes: 3, channelsUsed: 2, channelsMax: 32 }]);
  expect(r.attachments.get(posKey(0, 2, 64, 0))).toEqual([{ networkId: 'a:0:0:64:0', kind: 'ae2' }]);   // chest faced by the storage bus
  expect(r.attachments.get(posKey(0, 1, 65, 0))).toEqual([{ networkId: 'a:0:0:64:0', kind: 'ae2' }]);   // the drive itself
});
it('a world without logistics yields nothing', () => expect(buildLogistics(input({}))).toEqual({ networks: [], blocks: [], attachments: new Map() }));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/logistics.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/logistics.ts'`.

- [ ] **Step 3: Implement `logistics.ts`**

Use Task 9's `graph.ts` helpers (`UnionFind`, `smallestPos`, `majority`, `pickTaps`) for every network kind.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/logistics.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/logistics.ts tests/unit/world/logistics.test.ts
git commit -m "feat(world): routed, conduit, GT pipe and AE2 logistics networks" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 11: Storage: drawer reach, reachable flag, per-base totals

**Files:**
- Create: `src/server/world/storage.ts`
- Test: `tests/unit/world/storage.test.ts`

**Interfaces:**
- Consumes: Task 4 (`StorageRec`), Task 5 (`DrawerConfig`, `isNetworkedDrawerBlock`, `countsAsDrawer`), Task 6 (`Ae2Rec`), Task 8 (`BlockReader`), Task 10 (`Attachments`), `StorageBlock`, `LogisticsNetwork` (Task 1).
- Produces:
  - `REQUEST_KINDS: ReadonlySet<LogisticsNetwork['kind']>` = `routed`, `ae2` — the networks a line can order arbitrary items from; enderio and GT pipe networks only move items point to point, so storage on them is "found" but not "reachable" (spec §3.4 "flags what the line's chosen logistics can reach automatically").
  - `drawerReach(reader: BlockReader, blockNames: Map<number, string>, dim: number, controller: Vec3, cfg: DrawerConfig): Promise<{ drawers: Vec3[]; members: Vec3[] }>` — world-format §6.6: FIFO queue from the controller; dequeue a position, skip if seen, skip if `max(|dx|,|dy|,|dz|) > cfg.range`, skip unless `isNetworkedDrawerBlock(name)` (a missing chunk is not networked); a `countsAsDrawer` block that would make `drawers.length > cfg.maxDrawers` ends the whole search; otherwise record it (`members` holds every networked position incl. controller, slaves and trim) and enqueue the neighbours in the order x−1, x+1, z−1, z+1, y−1, y+1.
  - `interface StorageInput { recs: StorageRec[]; ae2: Ae2Rec[]; attachments: Attachments; networks: LogisticsNetwork[]; reader: BlockReader; blockNames: Map<number, string>; drawerCfg: DrawerConfig; baseOf: (dim: number, pos: Vec3) => string | null }`; `buildStorage(input: StorageInput): Promise<StorageBlock[]>` — one block per record plus `ae2_drive` blocks for AE2 drives and ME chests (`contents` = `cells`); `id = s:<dim>:<x>:<y>:<z>`; drawers reached by a controller get `controller` = its position and share one `networkId`: the first attachment of a `REQUEST_KINDS` network on any member position, else the first attachment of any kind, else `null`; every other block takes its own attachments by the same preference; sorted by id.
  - `storageTotals(storage: StorageBlock[], networks: LogisticsNetwork[], baseId: string | null): Map<StuffKey, { total: number; reachable: number }>` (only blocks of that base, all blocks when `baseId` is `null`; blocks with `contents: null` are skipped; `reachable` counts blocks whose network kind is in `REQUEST_KINDS`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/storage.test.ts
// rec(kind, pos, contents) = a StorageRec in dim 0 (contents as [key, count] pairs or null); NETS = [routed 'r:0:0:65:0', enderio 'e:item:0:9:64:0'];
// EMPTY_INPUT = no records, no attachments, an empty world reader. reader/names = a BlockReader and block-name map over this world:
// World (both chunks EID): StorageDrawers:controller at (0,64,0); fullDrawers4 at (-1,64,0), (1,64,0), (2,64,0), (4,64,0), (5,64,0);
// StorageDrawers:trim at (3,64,0); minecraft:stone at (0,64,1) and a fullDrawers4 behind it at (0,64,2).
it('reaches drawers breadth-first within range, through trim, across the x = 0 / x = -1 border', async () => {
  expect((await drawerReach(reader, names, 0, [0, 64, 0], DEFAULT_DRAWER_CONFIG)).drawers)
    .toEqual([[-1, 64, 0], [1, 64, 0], [2, 64, 0], [4, 64, 0]]);   // (5,64,0) is 5 away; (0,64,2) sits behind stone
});
it('stops the whole search when maxDrawers would be passed', async () => {
  expect((await drawerReach(reader, names, 0, [0, 64, 0], { ...DEFAULT_DRAWER_CONFIG, maxDrawers: 2 })).drawers).toEqual([[-1, 64, 0], [1, 64, 0]]);
});
it('gives reached drawers the controller network and flags only request networks as reachable', async () => {
  const recs = [rec('drawer_controller', [0, 64, 0], []), rec('drawer', [1, 64, 0], [['minecraft:iron_ingot@0', 1000]]),
    rec('drawer', [5, 64, 0], [['minecraft:iron_ingot@0', 50]]), rec('chest', [10, 64, 0], [['minecraft:iron_ingot@0', 30]]),
    rec('drawer', [4, 64, 0], null)];
  const attachments: Attachments = new Map([[posKey(0, 0, 64, 0), [{ networkId: 'r:0:0:65:0', kind: 'routed' }]],
                                            [posKey(0, 10, 64, 0), [{ networkId: 'e:item:0:9:64:0', kind: 'enderio' }]]]);
  const storage = await buildStorage({ recs, ae2: [], attachments, networks: NETS, reader, blockNames: names, drawerCfg: DEFAULT_DRAWER_CONFIG, baseOf: () => '0:0:4' });
  expect(storage.find((s) => s.pos[0] === 1)).toMatchObject({ id: 's:0:1:64:0', networkId: 'r:0:0:65:0', controller: [0, 64, 0], baseId: '0:0:4' });
  expect(storage.find((s) => s.pos[0] === 5)!.networkId).toBeNull();
  expect(storage.find((s) => s.pos[0] === 10)!.networkId).toBe('e:item:0:9:64:0');
  expect(storageTotals(storage, NETS, '0:0:4').get('minecraft:iron_ingot@0')).toEqual({ total: 1080, reachable: 1000 });
  expect(storageTotals(storage, NETS, 'other-base').size).toBe(0);
});
it('adds AE2 drives as reachable storage', async () => { /* ae2 drive with cells [[iron, 500]] attached to 'a:0:…' → kind 'ae2_drive', reachable 500 */ });
it('handles a base with no storage at all', async () =>
  expect(storageTotals(await buildStorage({ ...EMPTY_INPUT }), [], null)).toEqual(new Map()));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/storage.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/storage.ts'`.

- [ ] **Step 3: Implement `storage.ts`**

`blockAt` results are resolved to names through `blockNames`; the BFS awaits the reader per position (at most `(2·range + 1)^3` lookups, cached by chunk).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/storage.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/storage.ts tests/unit/world/storage.test.ts
git commit -m "feat(world): storage contents, drawer reach and reachable totals" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 12: The scan job: passes, map extraction, EBF coils

**Files:**
- Create: `src/server/world/scan.worker.ts`, `src/server/world/coils.ts`, `tests/helpers/sample-world.ts`
- Test: `tests/unit/world/coils.test.ts`, `tests/unit/world/scan-job.test.ts`

**Interfaces:**
- Consumes: everything from Tasks 1–11; `itemKey` (Plan 1).
- Produces:
  - `coils.ts`: `COIL_BLOCK = 'gregtech:gt.blockcasings5'`; `COIL_HEAT_BY_META = { 0: 1801, 1: 2701, 2: 3601, 3: 4501, 4: 5401, 5: 7201, 6: 8101, 7: 9901, 8: 10801, 9: 6301, 10: 9001, 11: 11701, 12: 12601, 13: 13501 }` (heats from gt-mechanics §6.4; the meta order is GT's `BlockCasings5.getCoilHeat`, checked by the `GTNH_LOCAL` step of Task 18); `isEbf(m: GtMachineRec): boolean` (class `MTEElectricBlastFurnace` or mteId 1000); `ebfCoilHeat(reader: BlockReader, blockNames: Map<number, string>, dim: number, controller: Vec3, facing: number): Promise<number | null>` (centre = controller − `DIRS[facing]`; the 8 ring blocks around the centre at y+1 and y+2 must all be coils with a known meta; result = the lowest heat, else `null`).
  - `scan.worker.ts`: `MAP_MARGIN = 128`; `interface ScanJob { scanId: string; scanDir: string; request: WorldSource; source: ResolvedSource; serverDir: string | null; facts: ScanPackFacts }`; `type WorkerMessage = { type: 'progress'; progress: number; message: string } | { type: 'done'; summary: string } | { type: 'error'; message: string }`; `runScanJob(job: ScanJob, report: (progress: number, message: string) => void): Promise<WorldScan>`; `scanSummary(scan: WorldScan): string` (`"Done: 2 bases, 7 machines"` + `" (1 chunk skipped)"` / `" (3 chunks skipped)"`; singular "1 base", "1 machine"); a bootstrap that runs only when `!isMainThread && workerData?.scanJob`, posting `WorkerMessage`s.
  - Passes inside `runScanJob` (progress values are fixed so the UI moves steadily): open source (0.02) → `level.dat` (missing → throws `Error('level.dat is missing')`) and side files: players, claims, quests, team files, `data/visualprospecting.dat`, then `copyServerSideFiles` + VisualProspecting cache + `readDrawerConfig` (0.05) → every region entry in (dim, rx, rz) order through `scanRegionBuffer` and the classifiers, progress by bytes up to 0.80, message `"Scanning <dim name> r.<rx>.<rz>"` → bases (0.82) → copy every region file intersecting a base bbox expanded by `MAP_MARGIN` into `<scanDir>/regions/<regionPathOf(...)>` (0.85) → palette from every present chunk of the copied regions + surface tiles (`maxY` 255) for every tile holding ≥ 1 present chunk into `<scanDir>/tiles/<dim>/<tx>_<tz>.bin` (0.95) → EBF coils, power, logistics, storage (`occupied` = any classified record's position; `baseOf` = `baseAt`), dims (visit hints from players, quests and — one `team prospecting` hint per dimension with team discoveries), prospecting, `topTier` (highest `countsForTopTier` tier, else `null`), `coilHeat` (highest EBF coil heat, else `null`) (0.98) → write `scan.json`, `palette.json` and `meta.json` (`{ source: WorldSource; levelName: string; blockNames: Array<[number, string]> }`) each via a temp file + rename, close the source, delete `<scanDir>/snapshot` and `<scanDir>/side`.
  - `WorldScan` assembly: `machines` = `toPlacedMachine` with `baseId = baseAt(...)?.id ?? null` and `coilHeat` on EBFs; `pipes` = `toPlacedPipe` with `voltageTier` from `cableTier` (else the cable rating) and `networkId` from `PowerResult.cableNetwork` (cables) or the logistics network holding the pipe (item/fluid); `logisticsBlocks`, `warnings` (level.dat manager warnings, `"<n> prospected veins had no vein type"`), `skippedChunks`.
  - `tests/helpers/sample-world.ts`: `sampleSpec(): WorldSpec`, `makeSampleWorld(dir: string): Promise<{ serverDir: string; worldDir: string }>` (= `makeWorld(dir, sampleSpec())` + one backup `2026-10-17-11-00-00.zip` with mtime 10 minutes ago) and `SAMPLE` (expected values) for one rich world reused by Tasks 13, 14 and 18:
    - DIM 0, EID chunks (0,0) [InhabitedTime 500,000], (1,0), (0,1), (1,1) with a stone floor at y 63 over x/z 0..31, and an empty chunk (3,3): HP solar boiler 114 at (0,64,0) facing east → LV turbine 1120 at (1,64,0) facing east → tin cable 1246 at (2,64,0) bits W|E|UP → LV macerator 2001 at (3,64,0) running 2 EU/t, and LV buffer 161 at (2,65,0) facing up with one Small Lithium Battery (`@32519`, charge 100,000) and `mStoredEnergy` 1,000; EBF 1000 at (8,64,8) facing north with a Kanthal (meta 1) coil ring around (8,·,9) at y 65–66; drawer controller at (0,64,10), drawers at (1,64,10) (iron × 1,000) and (3,64,10) (cobblestone × 640), trim at (2,64,10); routed interface pipe at (0,65,10) (`io` 0, connects down and east) and request pipe at (1,65,10) (connects west); JABBA barrel at (5,64,10) (iron × 3,000); vanilla chest at (6,64,10) (cobblestone × 64); quantum chest 125 at (7,64,10) (iron × 500). Claimed by team `Alpha`: chunks (0,0), (0,1).
    - Every tile entity stands on its owner block (`gregtech:gt.blockmachines` for GT machines and pipes, `StorageDrawers:controller` / `fullDrawers4`, `ForgeMultipart:block`, `JABBA:barrel`, `minecraft:chest`), as in a real world (world-format §3.3), so tiles, areas and the drawer BFS see them.
    - DIM −1, legacy chunk (−1,−1) [InhabitedTime 72,000, 300 ore TEs]: MV assemblers 2002 at (−2..−5, 64, −2).
    - DIM 7, EID chunks (0,0), (1,0), InhabitedTime 0, no TEs.
    - One player in DIM 0 with a portal use 0 → −1; quest 1072 (Moon Arrival) completed; VisualProspecting world id `World_00000000-0000-4000-8000-000000000000` with vein `ore.mix.copper` at chunk (−3,5) in DIM 0; team `Alpha` discovered (−3,5).
    - `SAMPLE` = `{ baseIds: ['0:0:0', '-1:-1:-1'], baseNames: ['Alpha base (4, 5)', 'Nether base (-4, -2)'], machineCount: [6, 4], topTier: 2, baseTopTier: [1, 2], coilHeat: 2701, visitedDims: ['nether', 'overworld', 'moon'], routedId: 'r:0:0:65:10', power: { clear: 7.037, storedEU: 101_000, capacityEU: 102_048 }, totals: { 'minecraft:iron_ingot@0': { total: 4500, reachable: 1000 }, 'minecraft:cobblestone@0': { total: 704, reachable: 640 } }, prospected: [{ dim: 0, x: -40, z: 88, vein: 'ore.mix.copper' }] }`.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/coils.test.ts
it('reads EBF coil heat from a full ring and rejects a broken one', async () => {
  expect(await ebfCoilHeat(reader(fullKanthalRing), names, 0, [8, 64, 8], 2)).toBe(2701);
  expect(await ebfCoilHeat(reader(ringMissingOne), names, 0, [8, 64, 8], 2)).toBeNull();
  expect(await ebfCoilHeat(reader(mixedNichromeKanthal), names, 0, [8, 64, 8], 2)).toBe(2701);   // lowest coil wins
});

// tests/unit/world/scan-job.test.ts — runScanJob in-process on makeSampleWorld; job = its ScanJob with source { kind: 'snapshot', worldDir, label: 'snapshot' },
// request { kind: 'server' }, serverDir = the sample server folder, facts = testFacts(), scanDir = a fresh temp folder;
// jobFor(path, { kind }) builds the same job for another world folder, upload folder or zip path
it('scans the sample world end to end', async () => {
  const progress: number[] = [];
  const scan = await runScanJob(job, (p) => progress.push(p));
  expect(scan.bases.map((b) => [b.id, b.name, b.machineCount, b.topTier])).toEqual([
    ['0:0:0', 'Alpha base (4, 5)', 6, 1], ['-1:-1:-1', 'Nether base (-4, -2)', 4, 2]]);
  expect([scan.topTier, scan.coilHeat, scan.visitedDims, scan.prospected, scan.skippedChunks])
    .toEqual([2, 2701, ['nether', 'overworld', 'moon'], SAMPLE.prospected, 0]);
  expect(scan.power).toHaveLength(1);
  expect(scan.power[0].generatorEUt.clear).toBeCloseTo(7.037, 3);
  expect([scan.power[0].storedEU, scan.power[0].capacityEU, scan.power[0].baseId]).toEqual([101_000, 102_048, '0:0:0']);
  expect(scan.logistics.map((n) => [n.id, n.kind, n.nodes])).toEqual([['r:0:0:65:10', 'routed', 2]]);
  expect(scan.storage.filter((s) => s.networkId === 'r:0:0:65:10').map((s) => s.pos)).toEqual([[0, 64, 10], [1, 64, 10], [3, 64, 10]]);
  expect(scan.dims.find((d) => d.dim === 7)).toMatchObject({ chunks: 2, inhabitedChunks: 0, visited: false });
  expect(scan.machines.find((m) => m.mteId === 1000)!.coilHeat).toBe(2701);
  expect(progress.every((p, i) => i === 0 || p >= progress[i - 1])).toBe(true);
  expect(await exists(join(scanDir, 'tiles/0/0_0.bin'))).toBe(true);
  expect(await exists(join(scanDir, 'tiles/-1/-1_-1.bin'))).toBe(true);
  expect(await exists(join(scanDir, 'regions/region/r.0.0.mca'))).toBe(true);
  expect(await exists(join(scanDir, 'regions/DIM7'))).toBe(false);
  expect(await exists(join(scanDir, 'snapshot'))).toBe(false);
  expect(JSON.parse(await readFile(join(scanDir, 'scan.json'), 'utf8')).id).toBe(job.scanId);
});
it('completes with skipped chunks reported', async () => {
  const scan = await runScanJob(jobFor(worldWithOneCorruptChunk), () => {});
  expect([scan.skippedChunks, scanSummary(scan)]).toEqual([1, 'Done: 1 base, 4 machines (1 chunk skipped)']);
});
it('scans a minimal upload: level.dat and one region, no side files', async () => {
  const scan = await runScanJob(jobFor(uploadDirWithLevelAndOneRegion, { kind: 'dir' }), () => {});
  expect([scan.bases, scan.power, scan.logistics, scan.storage, scan.prospected]).toEqual([[], [], [], [], []]);
  expect(scan.dims.map((d) => d.dim)).toEqual([0]);
});
it('fails with a clear message when the source is gone', async () => {
  await rm(zipPath);
  await expect(runScanJob(jobFor(zipPath, { kind: 'zip' }), () => {})).rejects.toThrow(/Source unavailable/);
});
it('fails when level.dat is missing', async () => {
  await expect(runScanJob(jobFor(dirWithoutLevel, { kind: 'dir' }), () => {})).rejects.toThrow('level.dat is missing');
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/coils.test.ts tests/unit/world/scan-job.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/coils.ts'`.

- [ ] **Step 3: Implement `coils.ts`, `scan.worker.ts` and the sample world**

`runScanJob` holds only the classified records (never raw chunk data) between passes; region buffers are read one at a time. Opening the source maps `ENOENT` to `Error('Source unavailable: <label>')`. The drawer BFS and coil checks use a `BlockReader` over the source's region files; palette and tiles use one over `<scanDir>/regions`.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/coils.test.ts tests/unit/world/scan-job.test.ts && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/scan.worker.ts src/server/world/coils.ts tests/helpers/sample-world.ts tests/unit/world/coils.test.ts tests/unit/world/scan-job.test.ts
git commit -m "feat(world): scan job with base areas, palette, tiles and EBF coils" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 13: World service: queue, worker thread, cancel, cache, tiles, areas and `npm run scan`

**Files:**
- Create: `src/server/world/scan.ts`, `src/server/cli/scan.ts`
- Modify: `package.json` (script `"scan": "node --disable-warning=ExperimentalWarning src/server/cli/scan.ts"`)
- Test: `tests/unit/world/scan-service.test.ts`, `tests/unit/world/scan-perf.test.ts`, `tests/unit/world/scan-cli.test.ts`

**Interfaces:**
- Consumes: Task 2 (`listSources`, `resolveSource`, `serverLayout`, `SourceError`), Task 8 (`createBlockReader`, `regionStoreFromDir`, `readAreaVoxels`, `renderTile`, `createPalette`), Task 12 (`ScanJob`, `WorkerMessage`, `runScanJob`, `scanSummary`), `AppConfig`, `loadConfig`, `loadPack`, `activeExportDir` (Plan 1), Task 4 (`packFacts`, `emptyFacts`).
- Produces (`scan.ts`):
  - `newScanId(now: Date): string` (`YYYYMMDDTHHMMSSZ-<6 hex>`), `isScanId(s: string): boolean` (`/^\d{8}T\d{6}Z-[0-9a-f]{6}$/`).
  - `interface WorldServiceOptions { config: AppConfig; facts: () => Promise<ScanPackFacts>; useWorker?: boolean /* default true */ }`.
  - `interface WorldService { listSources(): Promise<WorldSourcesResponse>; startScan(source: WorldSource): Promise<string>; cancelScan(id: string): boolean; hasScan(id: string): boolean; scanStatus(id: string): ScanStatus; listScans(): Promise<WorldScanListItem[]>; getScan(id: string): Promise<WorldScan | null>; palette(id: string): Promise<BlockRef[] | null>; tile(id: string, dim: number, tx: number, tz: number, maxY: number): Promise<Uint8Array | null>; readArea(scanId: string, dim: number, bbox: BBox): Promise<Voxels>; idle(): Promise<void> }` — the architecture §6.6 functions are these methods (`app.services.world`, Task 14).
  - `createWorldService(opts: WorldServiceOptions): WorldService`. Behaviour:
    - `startScan` resolves the source first (`SourceError` propagates), returns the id of an already queued/running scan with an equal source, else creates `data/scans/<id>/status.json` (`queued`) and runs scans one at a time. With `useWorker` the job runs in `new Worker(new URL('./scan.worker.ts', import.meta.url), { workerData: { scanJob }, execArgv: ['--disable-warning=ExperimentalWarning'] })`; without it `runScanJob` runs in-process (tests only).
    - Status: progress messages update memory at once and `status.json` at most once per second; `done` → `progress: 1`, `finishedAt`, `message` = the worker's summary; an error message, worker `error` or non-zero exit → `failed` with that message, and the scan folder is emptied except `status.json`.
    - `cancelScan`: queued → `failed` / `Cancelled`; running → `worker.terminate()`, then the same; unknown or finished → `false`.
    - On creation every `status.json` still `queued` or `running` becomes `failed` / `Interrupted by a server restart`.
    - `scanStatus` returns memory, else `status.json`, else `{ id, state: 'failed', progress: 0, message: 'Unknown scan', startedAt: '1970-01-01T00:00:00.000Z' }`; `hasScan` is true when the folder has a `status.json`.
    - `getScan` / `palette` return `null` unless the scan is `done`; the last 2 parsed scans stay in memory.
    - `tile`: `maxY ≥ 255` serves `tiles/<dim>/<tx>_<tz>.bin` when present; anything else renders from `regions/` with the saved palette frozen and GT machine ids from the scan's machines and pipes; an LRU of 256 rendered tiles; `null` unless `done`. `readArea` renders from `regions/` (`RangeError` above `MAX_AREA_VOXELS`).
- Produces (`cli/scan.ts`): `npm run scan -- [--backup <file> | --upload <uploadId>] [--json]` (default source `{ kind: 'server' }`), progress lines `"[ 42%] Scanning Overworld r.0.0"` on stderr, then a summary on stdout (`scanSummary`, one line per base `"<name>: <machines> machines, top tier <tier>"`, power per network `"clear/rain/average EU/t, stored EU"`), or the `WorldScan` JSON with `--json`; exit code 0 when done, 1 when failed. Testable entry: `runScanCli(argv: string[], io: { config: AppConfig; facts: () => Promise<ScanPackFacts>; stdout: (s: string) => void; stderr: (s: string) => void }): Promise<number>`; the module calls it with `loadConfig()` only when run directly (`import.meta.filename === realpathSync(process.argv[1])`), loading the pack through `activeExportDir` when an export exists, else scanning with `emptyFacts()` after printing a warning.

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/scan-service.test.ts — config.dataDir = tmp/data, config.serverFolder = makeSampleWorld(tmp/srv) with a backup made by makeBackup (mtime 10 min ago)
it('queues, runs and caches a scan; identical sources share one scan', async () => {
  const svc = createWorldService({ config, facts: async () => testFacts(), useWorker: false });
  const [a, b] = await Promise.all([svc.startScan({ kind: 'server' }), svc.startScan({ kind: 'server' })]);
  expect(a).toBe(b);
  await svc.idle();
  expect(svc.scanStatus(a)).toMatchObject({ id: a, state: 'done', progress: 1, message: 'Done: 2 bases, 10 machines' });
  expect((await svc.getScan(a))!.bases.map((x) => x.id)).toEqual(SAMPLE.baseIds);
  expect((await svc.listScans())[0]).toMatchObject({ id: a, state: 'done', source: { kind: 'server' }, levelName: 'World' });
});
it('serves cached surface tiles and renders Y-cut tiles and areas on demand', async () => {
  const surface = decodeMapTile((await svc.tile(id, 0, 0, 0, 255))!, 0, 0, 0);
  const cut = decodeMapTile((await svc.tile(id, 0, 0, 0, 63))!, 0, 0, 0);
  const pal = (await svc.palette(id))!;
  expect([pal[surface.top[3]].id, surface.height[3]]).toEqual(['gregtech:gt.blockmachines', 64]);   // macerator at (3,64,0)
  expect([pal[cut.top[3]].id, cut.height[3]]).toEqual(['minecraft:stone', 63]);
  const v = await svc.readArea(id, 0, { minX: 0, minY: 64, minZ: 0, maxX: 3, maxY: 64, maxZ: 0 });
  expect(v.blocks.length).toBe(4);
  expect(await svc.tile('20991231T000000Z-abcdef', 0, 0, 0, 255)).toBeNull();
});
it('marks scans interrupted by a restart as failed', async () => {
  await writeStatus(dataDir, '20261017T120000Z-aaaaaa', { state: 'running', progress: 0.4 });
  const svc = createWorldService({ config, facts: async () => testFacts(), useWorker: false });
  expect(svc.scanStatus('20261017T120000Z-aaaaaa')).toMatchObject({ state: 'failed', message: 'Interrupted by a server restart' });
});
it('fails cleanly when a queued backup disappears', async () => {
  const a = await svc.startScan({ kind: 'backup', file: NEWER });   // two complete backups of the sample world
  const b = await svc.startScan({ kind: 'backup', file: OLDER });   // queued behind a; sources are opened only when a job starts
  await rm(join(srv, 'backups', OLDER));
  await svc.idle();
  expect(svc.scanStatus(a).state).toBe('done');
  expect(svc.scanStatus(b)).toMatchObject({ state: 'failed', message: expect.stringMatching(/^Source unavailable/) });
  expect(await readdir(join(dataDir, 'scans', b))).toEqual(['status.json']);
});
it('refuses unknown sources with SourceError', async () =>
  await expect(svc.startScan({ kind: 'backup', file: '../x.zip' })).rejects.toMatchObject({ status: 400 }));

// tests/unit/world/scan-perf.test.ts — real worker thread; world = sampleSpec() plus legacy filler chunks for the rest of DIM 0 r.0.0
// (1,019 chunks, 2 stone sections and 64 ore TEs each), and a backup of it
it('scans in a worker without blocking the main thread, and can be cancelled', { timeout: 120_000 }, async () => {
  const svc = createWorldService({ config, facts: async () => testFacts() });          // useWorker defaults to true
  const lag = monitorEventLoopDelay({ resolution: 10 }); lag.enable();
  const id = await svc.startScan({ kind: 'server' });
  await svc.idle();
  lag.disable();
  expect(svc.scanStatus(id).state).toBe('done');
  expect(lag.max / 1e6).toBeLessThan(100);                                             // ms
  expect((await svc.getScan(id))!.dims.find((d) => d.dim === 0)!.chunks).toBeGreaterThanOrEqual(1024);
  const id2 = await svc.startScan({ kind: 'backup', file: BACKUP });
  await waitFor(() => svc.scanStatus(id2).state === 'running');
  expect(svc.cancelScan(id2)).toBe(true);
  await svc.idle();
  expect(svc.scanStatus(id2)).toMatchObject({ state: 'failed', message: 'Cancelled' });
  expect(await readdir(join(dataDir, 'scans', id2))).toEqual(['status.json']);
});

// tests/unit/world/scan-cli.test.ts — io collects stdout/stderr into strings; config points at the sample server
it('prints the scan as JSON and exits 0', async () => {
  expect(await runScanCli(['--json'], io)).toBe(0);
  expect(JSON.parse(io.out).bases.map((b: Base) => b.id)).toEqual(SAMPLE.baseIds);
});
it('exits 1 with a message when the backup is unknown', async () => {
  expect(await runScanCli(['--backup', 'nope.zip'], io)).toBe(1);
  expect(io.err).toContain('nope.zip');
});
```


- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/scan-service.test.ts tests/unit/world/scan-perf.test.ts tests/unit/world/scan-cli.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/scan.ts'`.

- [ ] **Step 3: Implement `scan.ts`, the CLI and the npm script**

Status writes use temp file + rename. The queue is a promise chain; `idle()` resolves when the chain is empty. The machine count in the summary comes from the worker (`scanSummary`), so the service never parses `scan.json` just to report.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/ && npm run typecheck`
Expected: PASS (the perf test logs its max event-loop lag).

- [ ] **Step 5: Commit**

```bash
git add src/server/world/scan.ts src/server/cli/scan.ts package.json tests/unit/world/scan-service.test.ts tests/unit/world/scan-perf.test.ts tests/unit/world/scan-cli.test.ts
git commit -m "feat(world): scan service with worker thread, cancel, cache and npm run scan" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 14: `contextFromScan`, the planner hook and the world routes

**Files:**
- Create: `src/server/world/context.ts`, `src/server/http/routes/world.ts`, `tests/helpers/serve-routes.ts`
- Modify: `src/server/http/routes/index.ts` (append `worldRoutes` to `ROUTE_MODULES`); `src/server/http/server.ts` only if Architecture change request 3 is not already met
- Test: `tests/unit/world/context.test.ts`, `tests/unit/world/routes-world.test.ts`

**Interfaces:**
- Consumes: `PlanContext`, `emptyContext()` (Plan 2), `Pack` (Plan 1), `Project` (Plan 2), `Route`, `RequestContext`, `sendJson`, `readJson` (Plan 2 router), `AppContext` (Plan 2), Task 7 (`findBase`), Task 9 (`RAIN_OUTAGE_SECONDS`, `ENERGY_HATCH_RE`), Task 4 (`TIER_KINDS`, `packFacts`, `emptyFacts`), Task 11 (`storageTotals`), Task 2 (uploads, `SourceError`, `isUploadId`), Task 13 (`WorldService`, `createWorldService`, `isScanId`).
- Produces:
  - `context.ts`: `contextFromScan(scan: WorldScan, pack: Pack, baseId: string | null): PlanContext` — `base = findBase(scan, baseId)`; machines of that base (all when no base); `ownedMachines` = counts per `mteId` present in `pack.machines`, sorted by `mteId`; `storage = storageTotals(scan.storage, scan.logistics, base?.id ?? null)`; `visitedDims = scan.visitedDims`; `topTier` = highest `pack.machines` tier among those machines whose export kind is in `TIER_KINDS` or is a `hatch` with class matching `ENERGY_HATCH_RE`, else `null`; `coilHeat` = highest `coilHeat`, else `null`; `prospected = scan.prospected`; `power` (omitted when the base has no network) = `{ averageEUt: Σ average, spareEUt: Σ average − Σ loadEUt, voltageTier: tier of the network with the largest average, storedEU: Σ storedEU, rainOutageSeconds: any solarShare > 0 ? RAIN_OUTAGE_SECONDS : 0 }`.
  - `routes/world.ts`: `worldService(app: AppContext): WorldService` (get-or-create `app.services.world`; facts = `packFacts(await app.pack())`, or `emptyFacts()` when no export loads); `planContextHook(app: AppContext): (project: Project) => Promise<PlanContext>` (no scan id or scan not done → `emptyContext()`); `worldRoutes(app: AppContext): Route[]` (sets `app.services.world` and `app.services.planContext` once). Routes (none `public`; errors are `{ error: string }`):
    - `GET /api/world/sources` → `WorldSourcesResponse`
    - `POST /api/world/scans` `StartScanRequest` → `StartScanResponse` (body shape checked: `kind` is `server`, `backup` with a string `file`, or `upload` with an `isUploadId` id → else 400; `SourceError` → its status)
    - `GET /api/world/scans` → `WorldScanListItem[]`; `GET /api/world/scans/:id` → `WorldScan`; `GET /api/world/scans/:id/status` → `ScanStatus`; `GET /api/world/scans/:id/palette` → `BlockRef[]` — 400 when `!isScanId(id)`, 404 when `!hasScan`, 409 `Scan is not finished` while not `done`
    - `POST /api/world/scans/:id/cancel` → 204, 409 when not queued/running, 404 when unknown (Architecture change request 5)
    - `GET /api/world/scans/:id/tiles/:dim/:tx/:tz?y=<0..255>` → `application/octet-stream`, 20,480 bytes, `Cache-Control: private, max-age=3600`; integers only (`/^-?\d{1,8}$/`), `y` default 255 → else 400
    - `POST /api/world/uploads` → `CreateUploadResponse` (records `ctx.me`)
    - `PUT /api/world/uploads/:uploadId/files/*` → raw body to `storeUploadFile` (path = `decodeURIComponent(params['*'])`, malformed → 400; declared `Content-Length` passed for the early 413) → 204; a client abort is not answered and leaves no partial file
    - `POST /api/world/uploads/:uploadId/complete` → `completeUpload` then `startScan` → `StartScanResponse`
  - `tests/helpers/serve-routes.ts`: `serveRoutes(routes: Route[]): Promise<{ url: string; close(): Promise<void> }>` (plain `node:http` server matching `:param` and trailing `/*` like architecture §7.1, `ctx = { me: decoded X-Planner-Name or null, authed: true }`, `requestTimeout: 0`).

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/world/context.test.ts — scan = runScanJob on the sample world (Task 12), pack = testPack()
it('builds the context of the main base', () => {
  const ctx = contextFromScan(scan, testPack(), '0:0:0');
  expect(ctx.ownedMachines).toEqual([{ mteId: 114, count: 1 }, { mteId: 125, count: 1 }, { mteId: 161, count: 1 },
    { mteId: 1000, count: 1 }, { mteId: 1120, count: 1 }, { mteId: 2001, count: 1 }]);
  expect(Object.fromEntries(ctx.storage)).toEqual(SAMPLE.totals);
  expect([ctx.topTier, ctx.coilHeat, ctx.visitedDims, ctx.prospected]).toEqual([1, 2701, SAMPLE.visitedDims, SAMPLE.prospected]);
  expect(ctx.power).toMatchObject({ voltageTier: 1, storedEU: 101_000, rainOutageSeconds: 480 });
  expect(ctx.power!.averageEUt).toBeCloseTo(6.444, 3);
  expect(ctx.power!.spareEUt).toBeCloseTo(4.444, 3);
});
it('builds the context of another base and drops machines the export does not know', () => {
  expect(contextFromScan(scan, testPack(), '-1:-1:-1')).toMatchObject({ ownedMachines: [{ mteId: 2002, count: 4 }], topTier: 2, coilHeat: null, power: undefined });
  expect(contextFromScan(scan, packWithout(testPack(), 2002), '-1:-1:-1').ownedMachines).toEqual([]);
});
it('builds a valid context from an empty scan', () =>
  expect(contextFromScan(EMPTY_SCAN, testPack(), null)).toEqual({ ...emptyContext(), storage: new Map(), power: undefined }));

// tests/unit/world/routes-world.test.ts — app = { config, services: {}, pack: async () => testPack() } as unknown as AppContext, served with serveRoutes(worldRoutes(app));
// getJson/postJson/call(method, path, body?) wrap fetch; put(uploadId, path, bytes) PUTs to /files/<path exactly as given>; putDeclared sends only a
// Content-Length header; DONE = id of a finished scan of the sample backup; EMPTY_SCAN = a WorldScan whose arrays are all empty
it('lists sources, runs a scan and serves scan, palette and tiles', async () => {
  expect(await getJson('/api/world/sources')).toEqual({ server: true, backups: [BACKUP] });
  const { scanId } = await postJson('/api/world/scans', { source: { kind: 'server' } });
  await waitFor(async () => (await getJson(`/api/world/scans/${scanId}/status`)).state === 'done');
  expect((await getJson(`/api/world/scans/${scanId}`)).bases.map((b: Base) => b.id)).toEqual(SAMPLE.baseIds);
  const tile = await fetch(`${url}/api/world/scans/${scanId}/tiles/0/0/0?y=63`);
  expect([tile.status, tile.headers.get('content-type'), (await tile.arrayBuffer()).byteLength]).toEqual([200, 'application/octet-stream', 20480]);
});
it.each([
  ['GET', '/api/world/scans/20991231T000000Z-abcdef', 404], ['GET', '/api/world/scans/..%2f..', 400],
  ['GET', `/api/world/scans/${DONE}/tiles/0/x/0`, 400], ['GET', `/api/world/scans/${DONE}/tiles/0/0/0?y=300`, 400],
  ['POST', '/api/world/scans', 400, { source: { kind: 'backup' } }], ['POST', `/api/world/scans/${DONE}/cancel`, 409],
])('%s %s → %i', async (method, path, status, body?) => expect((await call(method, path, body)).status).toBe(status));
it('answers 409 while a scan is not finished', async () => { /* app.services.world = stub with hasScan → true, getScan → null, set before worldRoutes(app) */ });
it('runs the upload flow and refuses bad paths', async () => {
  const { uploadId } = await postJson('/api/world/uploads', {});
  expect((await put(uploadId, 'level.dat', LEVEL_BYTES)).status).toBe(204);
  expect((await put(uploadId, 'region%2Fr.0.0.mca', REGION_BYTES)).status).toBe(204);
  for (const bad of ['..%2Flevel.dat', '%2e%2e/level.dat', 'Region/r.0.0.mca', 'DIM-1/r.0.0.mca', '%E0%A4%A'])
    expect((await put(uploadId, bad, B1)).status).toBe(400);
  expect((await putDeclared(uploadId, 'region/r.1.0.mca', 134_217_729)).status).toBe(413);   // declared Content-Length only
  const { scanId } = await postJson(`/api/world/uploads/${uploadId}/complete`, {});
  expect((await put(uploadId, 'region/r.2.0.mca', REGION_BYTES)).status).toBe(409);
  await waitFor(async () => (await getJson(`/api/world/scans/${scanId}/status`)).state === 'done');
  expect((await getJson(`/api/world/scans/${scanId}`)).source).toEqual({ kind: 'upload', uploadId });
});
it('sets the planner hook', async () => {
  worldRoutes(app);
  const hook = app.services.planContext as (p: Project) => Promise<PlanContext>;
  expect((await hook(projectWith(DONE, '0:0:0'))).topTier).toBe(1);
  expect(await hook(projectWith(null, null))).toEqual(emptyContext());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project server tests/unit/world/context.test.ts tests/unit/world/routes-world.test.ts`
Expected: FAIL — `Cannot find module '…/src/server/world/context.ts'`.

- [ ] **Step 3: Implement `context.ts`, `routes/world.ts`, `serve-routes.ts`; append to `ROUTE_MODULES`**

Every handler catches `SourceError` → its status, `RangeError` → 400, anything else → 500 with a generic message (details only in the server log). Check that Plan 2's HTTP server sets `requestTimeout: 7_200_000` (Architecture change request 3); add it in `src/server/http/server.ts` if missing.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project server tests/unit/world/ && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/world/context.ts src/server/http/routes/world.ts src/server/http/routes/index.ts tests/helpers/serve-routes.ts tests/unit/world/context.test.ts tests/unit/world/routes-world.test.ts
git commit -m "feat(world): plan context from scans, world routes and uploads" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 15: Client map core: tiles, palette colours, `MapView`

**Files:**
- Create: `src/client/map/types.ts`, `src/client/map/api.ts`, `src/client/map/tile-cache.ts`, `src/client/map/palette.ts`, `src/client/map/render.ts`, `src/client/views/MapView.tsx`
- Test: `tests/client/map-render.test.tsx`, `tests/client/map-palette.test.tsx`, `tests/client/map-tile-cache.test.tsx`, `tests/client/map-view.test.tsx`

**Interfaces:**
- Consumes: `decodeMapTile`, `AIR_INDEX`, `UNKNOWN_INDEX`, `tileOf`, world types (Task 1); API types (Task 2); `BlockFaces`, `TextureLayer` (Plan 3 `src/shared/types/assets.ts`); `POST /api/assets/blocks`, `GET /api/assets/file/<path>` (Plan 3).
- Produces:
  - `map/types.ts` — architecture §7.2 verbatim: `MapViewport`, `MapOverlay`, `MapMarker`, plus `interface MapViewProps { scanId: string; dim: number; focus?: [number, number]; overlays?: MapOverlay[]; markers?: MapMarker[]; onMarkerClick?: (m: MapMarker) => void }`.
  - `map/api.ts`: `class ApiError extends Error { status: number }`; `getJson<T>(path: string): Promise<T>`; `postJson<T>(path: string, body: unknown): Promise<T>`; `worldApi = { sources, scans, scan(id), status(id), start(source), cancel(id), palette(id), tile(scanId, dim, tx, tz, y): Promise<MapTile>, createUpload(): Promise<string>, putFile(uploadId, rel, body: Blob): Promise<void> /* each path segment encodeURIComponent'd */, completeUpload(uploadId): Promise<string>, blockFaces(blocks: BlockRef[]): Promise<BlockFaces[]> }`.
  - `map/tile-cache.ts`: `interface TileKey { scanId: string; dim: number; tx: number; tz: number; y: number }`; `interface TileCache { get(k: TileKey): MapTile | undefined; load(k: TileKey): Promise<MapTile>; surfaceY(scanId: string, dim: number, x: number, z: number): number | null; clear(): void }`; `createTileCache(fetchTile: (k: TileKey) => Promise<MapTile>, max?: number /* 512 */): TileCache` (LRU; concurrent loads of one key share one fetch; `surfaceY` reads a cached `y = 255` tile, `null` when not cached or height 0); `tileCache` singleton over `worldApi.tile`.
  - `map/palette.ts`: `type Rgb = [number, number, number]`; `interface LayerPixels { data: Uint8ClampedArray; width: number; height: number; tint?: Rgb }`; `averageTopColor(layers: LayerPixels[]): Rgb | null` (frame 0 = the top `width × width` rows; layers composited bottom to top with alpha; tint multiplies RGB; mean of pixels with alpha > 0, rounded); `OVERRIDE_COLORS: Record<string, Rgb>` (`minecraft:grass` [127,178,56], `minecraft:leaves`/`leaves2` [72,181,24], `minecraft:tallgrass`/`vine` [72,181,24], `minecraft:waterlily` [32,128,48], `minecraft:water`/`flowing_water` [63,118,228], `minecraft:lava`/`flowing_lava` [255,106,0], `gtnh-planner:unknown` [32,32,36]); `fallbackColor(ref: BlockRef): Rgb` (override, else name rules `/stone|cobble|ore/` [125,125,125], `/log|wood|planks/` [143,119,72], `/sand/` [219,207,163], `/dirt/` [134,96,67], `/glass/` [192,220,235], `gregtech:gt.blockmachines` [96,125,139], `/casing/` [158,158,158], else an FNV-1a hash colour of `id@meta`); `packRgb(c: Rgb): number`, `unpackRgb(n: number): Rgb`; `FACES_BATCH = 200`; `interface PaletteDeps { faces(blocks: BlockRef[]): Promise<BlockFaces[]>; image(path: string): Promise<LayerPixels | null> }`; `resolvePaletteColors(palette: BlockRef[], deps: PaletteDeps, onUpdate?: (colors: Uint32Array) => void): Promise<Uint32Array>` (fallback colours first and `onUpdate` at once; then `faces` in batches of `FACES_BATCH`; per entry: override > average of the `up` face layers > `BlockFaces.fallbackColor` when `resolved` is false > `fallbackColor`; any assets error keeps fallbacks and never throws).
  - `map/render.ts`: `MIN_PPB = 0.25`, `MAX_PPB = 32`; `worldToScreen(v: MapViewport, x: number, z: number): [number, number]` (`(x − centerX)·ppb + width/2`); `screenToWorld(v, px, py): [number, number]`; `visibleTiles(v): Array<[number, number]>` (tiles covering `[left, right) × [top, bottom)`, row-major by tz then tx); `zoomAt(v, px, py, factor): MapViewport` (keeps the world point under the cursor, clamps ppb); `panBy(v, dxPx, dyPx): MapViewport`; `shadeTile(tile: MapTile, colors: Uint32Array, out: Uint8ClampedArray): void` (RGBA 64×64; air → alpha 0; unknown → its colour; brightness ×1.12 when higher than the column to the north (`lz − 1`), ×0.86 when lower, ×1 on row 0, clamped, rounded); `chunkGridLines(v): { xs: number[]; zs: number[] }` (screen positions of chunk borders `16k` within the view; empty below 2 px/block).
  - `views/MapView.tsx`: `MapView(props: MapViewProps)` — canvas sized to its container (ResizeObserver, devicePixelRatio), `role="img"` and `aria-label="Map of <dimension>"`; starts at `focus` (else 0, 0), 4 px/block, `y = 255`; draws visible tiles from `tileCache` at the current `y` (each shaded tile cached as an `OffscreenCanvas` per tile key and palette version), the chunk grid, `overlays` in order, then `markers` (circle radius 9 px with `n`, `label` as tooltip). Pointer events go to overlays in reverse order with world coordinates (`Math.floor`ed blocks); unconsumed drags pan; wheel zooms by `1.2^(−deltaY/100)` at the cursor; a click within 10 px of a marker calls `onMarkerClick`. Controls: Y slider `<input type="range" min="0" max="255" aria-label="Y level">` labelled "Y ≤ <y>" ("surface" at 255), zoom buttons, "Re-centre" when `focus` is set.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/client/map-render.test.tsx
const v: MapViewport = { dim: 0, centerX: -100.5, centerZ: 200, pixelsPerBlock: 4, width: 800, height: 600, y: 255 };
it('round-trips negative world coordinates', () => {
  expect(worldToScreen(v, -100.5, 200)).toEqual([400, 300]);
  expect(screenToWorld(v, 0, 0)).toEqual([-200.5, 125]);
  const [px, py] = worldToScreen(v, -1234.25, -7);
  expect(screenToWorld(v, px, py)).toEqual([-1234.25, -7]);
});
it('lists the tiles covering the view', () =>
  expect(visibleTiles({ ...v, centerX: 0, centerZ: 0, pixelsPerBlock: 1, width: 128, height: 128 })).toEqual([[-1, -1], [0, -1], [-1, 0], [0, 0]]));
it('zooms around the cursor and clamps', () => {
  const before = screenToWorld(v, 100, 100), z = zoomAt(v, 100, 100, 2);
  expect(z.pixelsPerBlock).toBe(8);
  expect(screenToWorld(z, 100, 100)[0]).toBeCloseTo(before[0], 9);
  expect(zoomAt({ ...v, pixelsPerBlock: 32 }, 0, 0, 2).pixelsPerBlock).toBe(32);
});
it('shades by height against the north neighbour; air is transparent', () => {
  const tile = tileWithRows([64, 65, 63], 2);   // top = palette 2 (grey) everywhere; row r height from the list, later rows 64
  tile.top[5] = AIR_INDEX; tile.height[5] = 0;   // row 0, column 5 is air
  const colors = new Uint32Array([0, packRgb([32, 32, 36]), packRgb([128, 128, 128])]);
  const out = new Uint8ClampedArray(64 * 64 * 4); shadeTile(tile, colors, out);
  expect(Array.from(out.subarray(0, 4))).toEqual([128, 128, 128, 255]);                 // row 0
  expect(Array.from(out.subarray(64 * 4, 64 * 4 + 4))).toEqual([143, 143, 143, 255]);   // row 1: higher
  expect(Array.from(out.subarray(128 * 4, 128 * 4 + 4))).toEqual([110, 110, 110, 255]); // row 2: lower
  expect(out[5 * 4 + 3]).toBe(0);                                                       // air column
});
it('draws chunk borders only from 2 px/block', () => {
  expect(chunkGridLines({ ...v, centerX: 0, centerZ: 0, pixelsPerBlock: 2, width: 64, height: 64 }).xs).toEqual([0, 32, 64]);
  expect(chunkGridLines({ ...v, pixelsPerBlock: 1 })).toEqual({ xs: [], zs: [] });
});

// tests/client/map-palette.test.tsx
it('averages opaque pixels, applies tint, uses frame 0 only and alpha-composites overlays', () => {
  const px = (...a: number[]) => new Uint8ClampedArray(a);
  expect(averageTopColor([{ data: px(255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255), width: 2, height: 2 }])).toEqual([170, 85, 170]);
  expect(averageTopColor([{ data: px(255, 0, 0, 255, 0, 0, 255, 255, 0, 0, 0, 0, 255, 255, 255, 255), width: 2, height: 2, tint: [128, 255, 255] }])).toEqual([85, 85, 170]);
  expect(averageTopColor([{ data: px(100, 100, 100, 255), width: 1, height: 1 }, { data: px(200, 0, 0, 128), width: 1, height: 1 }])).toEqual([150, 50, 50]);
  expect(averageTopColor([{ data: px(10, 10, 10, 255, 250, 250, 250, 255), width: 1, height: 2 }])).toEqual([10, 10, 10]);   // 2 frames
});
it('resolves colours in batches with overrides and fallbacks, and survives a failing assets API', async () => {
  const palette = [AIR, UNKNOWN_BLOCK, { id: 'minecraft:stone', meta: 0 }, { id: 'gregtech:gt.blockmachines', meta: 0, mteId: 2001 }, { id: 'minecraft:grass', meta: 0 },
                   ...Array.from({ length: 445 }, (_, i) => ({ id: `mod:b${i}`, meta: 0 }))];
  const deps = fakeDeps({ 'minecraft:stone': { path: 'minecraft/textures/blocks/stone.png', pixels: [120, 120, 120, 255] },
                          'gregtech:gt.blockmachines': { unresolved: [10, 20, 30] }, 'minecraft:grass': { path: 'g.png', pixels: [90, 90, 90, 255] } });
  const updates: number[] = [];
  const c = await resolvePaletteColors(palette, deps, () => updates.push(1));
  expect([unpackRgb(c[2]), unpackRgb(c[3]), unpackRgb(c[4])]).toEqual([[120, 120, 120], [10, 20, 30], [127, 178, 56]]);
  expect(deps.facesCalls).toEqual([200, 200, 50]);
  expect(updates.length).toBeGreaterThanOrEqual(2);
  const broken = await resolvePaletteColors(palette, { faces: async () => { throw new Error('404'); }, image: async () => null });
  expect(unpackRgb(broken[2])).toEqual(fallbackColor({ id: 'minecraft:stone', meta: 0 }));
});

// tests/client/map-tile-cache.test.tsx
it('shares concurrent loads, evicts least recently used, answers surfaceY from cached surface tiles', async () => {
  const fetchTile = vi.fn(async (k: TileKey) => ({ ...emptyTile(k), height: heightsWith(4095, 70) }));
  const cache = createTileCache(fetchTile, 2);
  const k = { scanId: 's', dim: 0, tx: -1, tz: -1, y: 255 };
  await Promise.all([cache.load(k), cache.load(k)]);
  expect(fetchTile).toHaveBeenCalledTimes(1);
  expect([cache.surfaceY('s', 0, -1, -1), cache.surfaceY('s', 0, 500, 500)]).toEqual([70, null]);
  await cache.load({ ...k, tx: 0 }); await cache.load({ ...k, tx: 1 });
  expect(cache.get(k)).toBeUndefined();
});

// tests/client/map-view.test.tsx
it('renders a labelled canvas and the Y slider', () => {
  const html = renderToStaticMarkup(<MapView scanId="s" dim={0} />);
  expect(html).toContain('role="img"');
  for (const attr of ['type="range"', 'min="0"', 'max="255"', 'aria-label="Y level"']) expect(html).toContain(attr);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project client tests/client/map-render.test.tsx tests/client/map-palette.test.tsx tests/client/map-tile-cache.test.tsx tests/client/map-view.test.tsx`
Expected: FAIL — `Failed to resolve import "../../src/client/map/render.ts"`.

- [ ] **Step 3: Implement the five modules and `MapView`**

`MapView` loads the palette once per `scanId` (`worldApi.palette`, then `resolvePaletteColors` with `deps.faces = worldApi.blockFaces` and `deps.image` = fetch `/api/assets/file/<path>` → `createImageBitmap` → `OffscreenCanvas.getContext('2d').getImageData`), redraws on `onUpdate`, and requests tiles only for `visibleTiles` (most recent view first, at most 6 in flight).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project client tests/client/map-*.test.tsx && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/map/types.ts src/client/map/api.ts src/client/map/tile-cache.ts src/client/map/palette.ts src/client/map/render.ts src/client/views/MapView.tsx tests/client/map-render.test.tsx tests/client/map-palette.test.tsx tests/client/map-tile-cache.test.tsx tests/client/map-view.test.tsx
git commit -m "feat(map): canvas map view with tiles, texture colours, zoom, pan and Y level" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 16: The `map` project tab: overlays, note pins, "Found in world", base picker

**Files:**
- Create: `src/client/map/overlays.ts`, `src/client/map/summary.ts`, `src/client/map/FoundPanel.tsx`, `src/client/views/MapTab.tsx`, `tests/helpers/scan-fixture.ts`
- Modify: `src/client/views/project-tabs.ts` (insert `{ id: 'map', label: 'Map', component: MapTab }` as the first entry of `PROJECT_TABS`)
- Test: `tests/client/map-overlays.test.tsx`, `tests/client/map-summary.test.tsx`, `tests/client/map-tab.test.tsx`

**Interfaces:**
- Consumes: Task 15 (`MapView`, `MapOverlay`, `MapMarker`, `MapViewport`, `worldToScreen`, `worldApi`, `tileCache`), `findBase` (Task 7, shared), `Project`, `Note`, `ProjectOp`, `ProjectViewProps`, `PROJECT_TABS` (Plan 2), `ItemIcon` (Plans 2/3), `tierName` (Plan 1), `GET /api/pack/stuff/:key` for item names (Plan 2).
- Produces:
  - `map/overlays.ts`: `VOLTAGE_COLORS` (15 entries, ULV…MAX: `#8a8a8a #3fa34d #1e88e5 #fdd835 #8e24aa #e53935 #00acc1 #fb8c00 #6d4c41 #d81b60 #43a047 #5e35b1 #00897b #c0ca33 #212121`); `LOGISTICS_COLORS = { routed: '#ff7043', enderio: '#26c6da', gtpipe: '#9ccc65', ae2: '#7e57c2' }`; `STORAGE_COLOR = '#ffca28'`, `MACHINE_COLOR = '#90a4ae'`, `BASE_OUTLINE_COLOR = '#ffffff'`, `NOTE_COLOR = '#ffb300'`; `machinesOverlay(scan: WorldScan): MapOverlay` (id `machines`, a filled 1×1-block square per machine of `view.dim`); `cablesOverlay(scan)` (id `cables`, pipes of kind `cable`: line from the block centre toward each connected horizontal side, `VOLTAGE_COLORS[voltageTier ?? 0]`, a dot for up/down-only links); `logisticsOverlay(scan)` (id `logistics`, the same drawing over `logisticsBlocks` in `LOGISTICS_COLORS[kind]`); `storageOverlay(scan)` (id `storage`, outlined square, filled when the block's network kind is `routed` or `ae2`); `baseOutlineOverlay(base: Base)` (id `outline`, dashed `[6, 4]` bbox rectangle); `noteClickOverlay(onPick: (x: number, z: number) => void): MapOverlay` (id `note-click`; never consumes `down`/`move`; consumes `up` and calls `onPick` with the `up` block when it is within 1 block of the `down` block); `noteMarkers(notes: Note[], dim: number): MapMarker[]` (pinned notes numbered 1… by their order among **all** pinned notes, so numbers do not change between dimensions; only those in `dim`; colour `NOTE_COLOR`; `label` = text).
  - `map/summary.ts`: `interface FoundSummary { machineCount: number; topTier: number | null; machines: Array<{ name: string; tier: number | null; count: number }>; power: Array<{ id: string; voltageTier: number; clear: number; rain: number; average: number; storedEU: number; capacityEU: number; spare: number }>; logistics: Array<{ id: string; kind: LogisticsNetwork['kind']; nodes: number; channels: string | null; parts: string | null }>; storage: { blocks: Array<{ kind: StorageBlock['kind']; count: number; unknown: number }>; barrelBanks: Array<{ barrels: number; pos: [number, number, number] }>; topItems: Array<{ key: StuffKey; total: number; reachable: number; where: Array<{ kind: StorageBlock['kind']; pos: [number, number, number]; count: number; reachable: boolean }> }> }; dims: Array<{ name: string; visited: boolean; evidence: string[] }>; prospected: Array<{ vein: string; x: number; z: number; distance: number }> }`; `summarize(scan: WorldScan, baseId: string | null): FoundSummary` (machines grouped by name + tier, unknown names as `Unknown machine #<mteId>`, sorted by count desc then name; `topTier` = the base's; `spare = average − (loadEUt ?? 0)`; `channels` = `"<used> / <max>"` for AE2; `parts` = the network's `parts` as `"1 interface, 1 request, 2 chip:responder"` (keys sorted), `null` when absent; storage kinds in a fixed order `drawer_controller, drawer, barrel, chest, iron_chest, gt_chest, gt_tank, ae2_drive`, `unknown` = blocks with `contents: null`; `barrelBanks` = face-adjacent JABBA barrels grouped into one bank each (spec §3.4: shown as a storage bank), `pos` = smallest position, largest bank first; top 10 items by total, each with `where` = its storage blocks by count desc (at most 5) — spec §3.4 "broken down by where it sits"; prospected veins in the base's dimension, nearest 10 by horizontal distance to the base centre, rounded).
  - `map/FoundPanel.tsx`: `FoundPanel(props: { summary: FoundSummary; notes: Note[]; onFocusNote: (n: number) => void })` — sections "Machines" (count, top tier via `tierName`), "Power" (per network: clear / rain / average EU/t, stored EU, spare EU/t, with the rain caveat "solar boilers stop ≈7 min into rain"), "Logistics", "Storage" (block counts per kind, "JABBA bank: <n> barrels" per bank, rows `data-key=<key>` with `ItemIcon`, name, total and "<n> reachable", expandable to the `where` list with a "show on map" button per block), "Dimensions", "Prospected veins", "Notes" (numbered pinned notes). Empty sections say "None found" — all optional (spec §3.4). Numbers use `toLocaleString('en-US')` with EU/t rounded to 0.1.
  - `views/MapTab.tsx`: `MapTab(props: ProjectViewProps)` — without `project.world.scanId`: a picker of done scans (`worldApi.scans`) and their bases that sends `[{ op: 'world', scanId, baseId }]`, plus a link to `/world` ("Scan the world"); with one: loads the scan, `findBase`, renders `MapView` (`dim` = base dim, `focus` = base centre x/z + 0.5 so the view is centred on a block, not on a block edge, overlays from five toggles persisted per viewer in `localStorage` key `gtnh-planner:map-overlays` inside try/catch, plus `noteClickOverlay`) beside `FoundPanel`, a base `<select>` and a scan `<select>` that send the `world` op. A map click opens "Add note at x, y, z" (y = `tileCache.surfaceY(...)` else the slider y) whose Save sends `[{ op: 'addNote', note: { id: crypto.randomUUID(), text, pin: { dim, x, y, z } } }]`; marker clicks highlight the note in the panel. Plan 5 adds its own overlays and markers through `MapView`'s props.
  - `tests/helpers/scan-fixture.ts`: `SCAN_FIXTURE: WorldScan` — a hand-written scan with one base `0:0:0` centred at (4, 64, 5) (machines: 2 × "Basic Macerator" LV, 1 × "Basic Steam Turbine" LV, 1 unknown mteId 31999; one LV cable at (2,64,0) with connections W|E; one routed network `r:0:0:65:10` with two `logisticsBlocks`; storage: a drawer at (1,64,10) (iron × 1,000, network `r:0:0:65:10`), a chest at (6,64,10) (iron × 30, no network), a compacting drawer at (3,64,10) (`contents: null`), two empty JABBA barrels at (5,64,10) and (5,65,10); one power network clear 7.037 / rain 0 / average 6.444, loadEUt 2, stored 101,000, capacity 102,048; dims Overworld visited, Twilight Forest not; prospected `ore.mix.copper` at (−40, 88)).

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/client/map-overlays.test.tsx — fakeCtx() records calls; view = { dim: 0, centerX: 0, centerZ: 0, pixelsPerBlock: 8, width: 160, height: 160, y: 255 }
it('draws cables in their voltage colour from the block centre toward connected sides', () => {
  const ctx = fakeCtx(); cablesOverlay(SCAN_FIXTURE).draw(ctx as unknown as CanvasRenderingContext2D, view);
  expect(ctx.strokeStyles).toContain(VOLTAGE_COLORS[1]);
  expect(ctx.segments).toEqual([[[100, 84], [96, 84]], [[100, 84], [104, 84]]]);   // centre of (2,64,0) at 8 px/block, west and east halves
});
it('fills storage only when a request network reaches it', () => {
  const ctx = fakeCtx(); storageOverlay(SCAN_FIXTURE).draw(ctx as unknown as CanvasRenderingContext2D, view);
  expect([ctx.fillRects.length, ctx.strokeRects.length]).toEqual([1, 5]);
});
it('draws the base outline dashed', () => {
  const ctx = fakeCtx(); baseOutlineOverlay(SCAN_FIXTURE.bases[0]).draw(ctx as unknown as CanvasRenderingContext2D, view);
  expect(ctx.lineDashes).toContainEqual([6, 4]);
});
it('picks a note position on a click but not on a drag', () => {
  const picks: Array<[number, number]> = [], o = noteClickOverlay((x, z) => picks.push([x, z]));
  expect(o.onPointer!({ kind: 'down', x: 10, z: 10 })).toBe(false);
  expect(o.onPointer!({ kind: 'up', x: 11, z: 10 })).toBe(true);
  o.onPointer!({ kind: 'down', x: 10, z: 10 });
  expect(o.onPointer!({ kind: 'up', x: 14, z: 10 })).toBe(false);
  expect(picks).toEqual([[11, 10]]);
});
it('numbers pinned notes across dimensions and filters by dimension', () => {
  const notes = [note('a', 'Build here', { dim: 0, x: 1, y: 64, z: 2 }), note('b', 'no pin'), note('c', 'Nether', { dim: -1, x: 0, y: 64, z: 0 }), note('d', 'Tap', { dim: 0, x: 5, y: 64, z: 5 })];
  expect(noteMarkers(notes, 0)).toEqual([{ n: 1, pos: [1, 64, 2], color: NOTE_COLOR, label: 'Build here' }, { n: 3, pos: [5, 64, 5], color: NOTE_COLOR, label: 'Tap' }]);
});

// tests/client/map-summary.test.tsx
it('summarizes what was found at the base', () => {
  const s = summarize(SCAN_FIXTURE, '0:0:0');
  expect(s.machines).toEqual([{ name: 'Basic Macerator', tier: 1, count: 2 }, { name: 'Basic Steam Turbine', tier: 1, count: 1 }, { name: 'Unknown machine #31999', tier: null, count: 1 }]);
  expect(s.power[0]).toMatchObject({ voltageTier: 1, storedEU: 101_000, capacityEU: 102_048 });
  expect(s.power[0].spare).toBeCloseTo(4.444, 3);
  expect(s.logistics).toEqual([{ id: 'r:0:0:65:10', kind: 'routed', nodes: 2, channels: null, parts: null }]);
  expect(s.storage.blocks).toEqual([{ kind: 'drawer', count: 2, unknown: 1 }, { kind: 'barrel', count: 2, unknown: 0 }, { kind: 'chest', count: 1, unknown: 0 }]);
  expect(s.storage.barrelBanks).toEqual([{ barrels: 2, pos: [5, 64, 10] }]);
  expect(s.storage.topItems).toEqual([{ key: 'minecraft:iron_ingot@0', total: 1030, reachable: 1000, where: [
    { kind: 'drawer', pos: [1, 64, 10], count: 1000, reachable: true }, { kind: 'chest', pos: [6, 64, 10], count: 30, reachable: false }] }]);
  expect(s.prospected).toEqual([{ vein: 'ore.mix.copper', x: -40, z: 88, distance: 94 }]);
});
it('says nothing was found for an empty base', () => { /* summarize(EMPTY_SCAN, null) → zero counts, empty lists, topTier null */ });

// tests/client/map-tab.test.tsx — server-side render only (effects do not run)
it('offers a scan picker and a link to the World page when the project has no scan', () => {
  const html = renderToStaticMarkup(<MapTab project={projectWithWorld(null, null)} plan={null} send={() => {}} me="Ann" />);
  expect(html).toContain('Choose a world scan');
  expect(html).toContain('href="/world"');
});
it('is the first project tab', () => expect(PROJECT_TABS[0]).toMatchObject({ id: 'map', label: 'Map' }));
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project client tests/client/map-overlays.test.tsx tests/client/map-summary.test.tsx tests/client/map-tab.test.tsx`
Expected: FAIL — `Failed to resolve import "../../src/client/map/overlays.ts"`.

- [ ] **Step 3: Implement overlays, summary, panel, tab and the tab registration**

Overlays skip records of other dimensions and anything outside the view (cheap bounds test before drawing). Item names for the top items come from `GET /api/pack/stuff/:key` (`name` field), fetched once per key; the key is shown until then.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project client && npm run typecheck`
Expected: PASS (all client tests, including Plan 2's tab tests with `map` now first).

- [ ] **Step 5: Commit**

```bash
git add src/client/map/overlays.ts src/client/map/summary.ts src/client/map/FoundPanel.tsx src/client/views/MapTab.tsx src/client/views/project-tabs.ts tests/helpers/scan-fixture.ts tests/client/map-overlays.test.tsx tests/client/map-summary.test.tsx tests/client/map-tab.test.tsx
git commit -m "feat(map): project map tab with overlays, note pins and found-in-world panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 17: World page: sources, scans, uploads

**Files:**
- Create: `src/client/world/pick-files.ts`, `src/client/world/zip-pick.ts`, `src/client/world/upload.ts`, `src/client/views/WorldPage.tsx`
- Modify: `src/client/views/top-pages.ts` (append `{ path: '/world', label: 'World', component: WorldPage }`, Architecture change request 4)
- Test: `tests/client/world-pick.test.tsx`, `tests/client/world-upload.test.tsx`, `tests/client/world-page.test.tsx`

**Interfaces:**
- Consumes: Task 15 (`worldApi`, `ApiError`), Task 2 (`zipBuffer` test helper, `UPLOAD_LIMITS` values), `@zip.js/zip.js` 2.22.1 (`ZipReader`, `BlobReader`, `BlobWriter`, `type Entry`, `type FileEntry`), `ScanStatus`, `WorldScanListItem` (Tasks 1–2).
- Produces:
  - `world/pick-files.ts`: `interface PickedEntry { path: string; size: number }`; `interface WorldPick { root: string | null; files: Array<{ path: string; rel: string; dim: number | null; size: number }>; dims: Array<{ dim: number; files: number; bytes: number }> }`; `uploadRel(worldRelative: string): string | null` (the server allow-list mirrored: `level.dat`, `region/r.<int>.<int>.mca`, `DIM<int>/region/r.<int>.<int>.mca`); `pickWorldFiles(entries: PickedEntry[]): WorldPick` (root = folder of the shallowest `level.dat`, `''` at top level, `null` when none; only allow-listed files under the root; `dims` sorted by dim); `selectDims(pick: WorldPick, dims: number[]): WorldPick['files']` (`level.dat` first, then the region files of those dims); `dimLabel(dim: number): string` (0 `Overworld`, −1 `Nether`, 1 `The End`, else `DIM<n>` — the browser has no pack data).
  - `world/zip-pick.ts`: `interface ZipWorld { entries: Array<PickedEntry & { read(): Promise<Blob> }>; close(): Promise<void> }`; `openZipInBrowser(file: Blob): Promise<ZipWorld>` (central directory via `File.slice`; directories skipped).
  - `world/upload.ts`: `interface UploadItem { rel: string; size: number; blob: () => Promise<Blob> }`; `interface UploadProgress { done: number; total: number; bytesDone: number; bytesTotal: number; current: string }`; `uploadWorld(items: UploadItem[], api: Pick<typeof worldApi, 'createUpload' | 'putFile' | 'completeUpload'>, onProgress: (p: UploadProgress) => void, signal?: AbortSignal): Promise<string /* scanId */>` (one upload, `level.dat` first, then the rest with at most 2 in flight, then `completeUpload`; refuses before uploading when a file exceeds the server limits — 32 MiB `level.dat`, 128 MiB region — naming the file; an aborted signal rejects with an `AbortError`; a failed file rejects with `"<rel>: <server error>"`).
  - `views/WorldPage.tsx`: `WorldPage()` — "Server folder": when `sources.server`, a "Scan newest backup" button (`{ kind: 'server' }`) and the complete backups newest first, each with "Scan"; otherwise "No server folder configured — set `serverFolder` in `data/config.json`, or upload below". "Scans": rows (`data-testid="scan-row"`, `data-state`) with start time, source, a progress bar, message and "Cancel" while queued/running; polled every 1,000 ms while any scan is queued or running. "Upload a world": a folder picker (`<input type="file" webkitdirectory multiple data-testid="world-folder-input">`, preferred) and a zip picker (`<input type="file" accept=".zip" data-testid="world-zip-input">`); after picking, a checklist of dimensions labelled with `dimLabel`, file counts and sizes (Overworld ticked), the total, "Upload and scan" (`data-testid="upload-button"`), a progress bar and errors in plain words. After upload the new scan appears in "Scans". A footer explains that scans never touch the live server and that a scan is chosen on a project's Map tab.

- [ ] **Step 1: Write the failing tests**

```tsx
// tests/client/world-pick.test.tsx
it('finds the world root and keeps only the files a scan needs', () => {
  const pick = pickWorldFiles([
    { path: 'MyWorld/level.dat', size: 300 }, { path: 'MyWorld/region/r.0.0.mca', size: 4096 }, { path: 'MyWorld/region/r.-1.0.mca', size: 8192 },
    { path: 'MyWorld/DIM-1/region/r.-1.0.mca', size: 1000 }, { path: 'MyWorld/session.lock', size: 8 }, { path: 'MyWorld/playerdata/a.dat', size: 9 },
    { path: 'MyWorld/DIM7/data/x.dat', size: 1 }, { path: 'MyWorld/Region/r.0.0.mca', size: 1 } ]);
  expect(pick.root).toBe('MyWorld/');
  expect(pick.files.map((f) => f.rel)).toEqual(['level.dat', 'region/r.0.0.mca', 'region/r.-1.0.mca', 'DIM-1/region/r.-1.0.mca']);
  expect(pick.dims).toEqual([{ dim: -1, files: 1, bytes: 1000 }, { dim: 0, files: 2, bytes: 12288 }]);
  expect(selectDims(pick, [-1]).map((f) => f.rel)).toEqual(['level.dat', 'DIM-1/region/r.-1.0.mca']);
});
it('picks the shallowest level.dat and returns nothing without one', () => {
  expect(pickWorldFiles([{ path: 'saves/World/level.dat', size: 1 }, { path: 'saves/World/backup/level.dat', size: 1 }]).root).toBe('saves/World/');
  expect(pickWorldFiles([{ path: 'x/region/r.0.0.mca', size: 1 }])).toEqual({ root: null, files: [], dims: [] });
});
it.each(['level.dat', 'region/r.0.0.mca', 'DIM-1/region/r.-1.2.mca'])('allows %s', (p) => expect(uploadRel(p)).toBe(p));
it.each(['../level.dat', 'Region/r.0.0.mca', 'DIM-1/r.0.0.mca', 'region/r.0.0.mcr', 'playerdata/a.dat'])('refuses %s', (p) => expect(uploadRel(p)).toBeNull());
it('lists a zipped world in the browser and extracts one entry', async () => {
  const zip = await openZipInBrowser(new Blob([zipBuffer([{ name: 'World/level.dat', data: LEVEL }, { name: 'World/region/r.0.0.mca', data: REG }])]));
  expect(zip.entries.map((e) => e.path)).toEqual(['World/level.dat', 'World/region/r.0.0.mca']);
  expect(new Uint8Array(await (await zip.entries[0].read()).arrayBuffer())).toEqual(LEVEL);
});

// tests/client/world-upload.test.tsx — api = fake recording calls
it('uploads level.dat first, then regions, then completes', async () => {
  const progress: UploadProgress[] = [];
  const scanId = await uploadWorld([item('region/r.0.0.mca', 10), item('level.dat', 5), item('DIM-1/region/r.0.0.mca', 10)], api, (p) => progress.push(p));
  expect(scanId).toBe('20261017T120000Z-abcdef');
  expect(api.calls).toEqual(['create', 'put level.dat', 'put region/r.0.0.mca', 'put DIM-1/region/r.0.0.mca', 'complete']);
  expect(progress.at(-1)).toMatchObject({ done: 3, total: 3, bytesDone: 25, bytesTotal: 25 });
});
it('refuses an oversized region before uploading anything', async () => {
  await expect(uploadWorld([item('level.dat', 5), item('region/r.0.0.mca', 128 * 2 ** 20 + 1)], api, () => {})).rejects.toThrow('region/r.0.0.mca');
  expect(api.calls).toEqual([]);
});
it('stops on abort and reports the failing file', async () => {
  const ac = new AbortController(); ac.abort();
  await expect(uploadWorld([item('level.dat', 5)], api, () => {}, ac.signal)).rejects.toMatchObject({ name: 'AbortError' });
  await expect(uploadWorld([item('level.dat', 5)], failingApi(413, 'too large'), () => {})).rejects.toThrow('level.dat: too large');
});

// tests/client/world-page.test.tsx
it('renders the three sections and the pickers', () => {
  const html = renderToStaticMarkup(<WorldPage />);
  for (const t of ['Server folder', 'Scans', 'Upload a world', 'data-testid="world-folder-input"', 'webkitdirectory', 'data-testid="world-zip-input"']) expect(html).toContain(t);
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run --project client tests/client/world-pick.test.tsx tests/client/world-upload.test.tsx tests/client/world-page.test.tsx`
Expected: FAIL — `Failed to resolve import "../../src/client/world/pick-files.ts"`.

- [ ] **Step 3: Implement the three modules, the page and the page registration**

The folder picker maps `File.webkitRelativePath` to `PickedEntry.path`; the zip picker uses `openZipInBrowser`. Only `selectDims(...)` files are sent — never the whole folder (spec §6: partial uploads must work for a ~1 GB world).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run --project client && npm run typecheck`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/world/pick-files.ts src/client/world/zip-pick.ts src/client/world/upload.ts src/client/views/WorldPage.tsx src/client/views/top-pages.ts tests/client/world-pick.test.tsx tests/client/world-upload.test.tsx tests/client/world-page.test.tsx
git commit -m "feat(world): world page with scans, backups and partial uploads" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 18: End-to-end check and README

**Files:**
- Create: `tests/e2e/world.spec.ts`, `tests/unit/world/real-world.test.ts`
- Modify: `README.md` (section "World map")

**Interfaces:**
- Consumes: Plan 2's `tests/e2e/helpers.ts` (`login(page: Page): Promise<void>`, `createProject(page: Page, name: string): Promise<string>` — leaves the page on the new project; Architecture change request 7), `makeSampleWorld` + `SAMPLE` (Task 12), everything this plan ships.
- Produces: no new code interfaces.

- [ ] **Step 1: Write the end-to-end test**

```ts
// tests/e2e/world.spec.ts
test.beforeAll(async () => { tmp = await mkdtemp(join(tmpdir(), 'gp-e2e-world-')); await makeSampleWorld(tmp); });
test('upload a world, scan it, pick a base, read the map and pin a note', async ({ page }) => {
  await login(page);
  await page.goto('/world');
  await page.setInputFiles('[data-testid=world-folder-input]', join(tmp, 'World'));
  for (const name of ['Overworld', 'Nether', 'DIM7']) await page.getByLabel(new RegExp(name)).check();
  await page.getByTestId('upload-button').click();
  await expect(page.getByTestId('scan-row').first()).toHaveAttribute('data-state', 'done', { timeout: 60_000 });

  await createProject(page, 'E2E map');
  await page.getByText('Map', { exact: true }).first().click();     // the first project tab (Task 16)
  await page.getByLabel('World scan').selectOption({ index: 1 });
  await page.getByLabel('Base').selectOption({ label: 'Overworld base (4, 5)' });   // claim files are not uploaded, so no team name
  await page.getByRole('button', { name: 'Use this base' }).click();

  const panel = page.getByTestId('found-panel');
  await expect(panel.getByTestId('machine-count')).toHaveText('6');
  await expect(panel.locator('[data-key="minecraft:iron_ingot@0"]')).toContainText('4,500');
  await expect(panel.locator('[data-key="minecraft:iron_ingot@0"]')).toContainText('1,000 reachable');
  await expect(panel.getByText('Routed network')).toBeVisible();
  await page.waitForFunction(() => {                                      // tiles are drawn at the base centre
    const c = document.querySelector<HTMLCanvasElement>('canvas[role=img]')!;
    return c.getContext('2d')!.getImageData(c.width / 2, c.height / 2, 1, 1).data[3] > 0;
  });

  const box = (await page.locator('canvas[role=img]').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByText('Add note at 4, 63, 5')).toBeVisible();
  await page.getByLabel('Note').fill('Build here');
  await page.getByRole('button', { name: 'Save note' }).click();
  await expect(panel.getByTestId('note-1')).toContainText('Build here');
  await page.reload();
  await expect(page.getByTestId('found-panel').getByTestId('note-1')).toContainText('Build here');

  const { uploadId } = await (await page.request.post('/api/world/uploads', { data: {} })).json();
  expect((await page.request.put(`/api/world/uploads/${uploadId}/files/..%2Flevel.dat`, { data: 'x' })).status()).toBe(400);
});
```

`data-testid`s used here (`found-panel`, `machine-count`, `note-<n>`) and the labels `World scan`, `Base`, `Use this base`, `Note`, `Save note` and the dimension checkboxes labelled with dimension names are part of Tasks 16–17's markup; add any that are missing there.

- [ ] **Step 2: Run the whole suite and the end-to-end test**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: `tsc -b` exit 0; vitest all files PASS (server and client projects); Playwright `world.spec.ts` passes together with Plans 2–3's specs.

- [ ] **Step 3: Real-world check (local only, never committed output)**

`tests/unit/world/real-world.test.ts` runs only with `GTNH_LOCAL=1` (`describe.skipIf(process.env.GTNH_LOCAL !== '1')`): it loads the real config and pack, scans `{ kind: 'server' }` with a real worker, and asserts the scan is `done` within 180 s, the main thread's event-loop lag stayed under 100 ms, there is at least one base and at least five dimension summaries, every EBF `coilHeat` is a value of `COIL_HEAT_BY_META`, and `scan.warnings` holds no unknown-manager warning. It prints only counts (`scanSummary`, dims, networks, storage blocks).

Run: `GTNH_LOCAL=1 npx vitest run --project server tests/unit/world/real-world.test.ts`
Expected: PASS; the printed summary shows the group's bases, steam power and routed drawer network (compare by eye with `docs/local/research-world.md`; record timings and anything surprising in `docs/local/` only). Then start the app (`npm run build && npm start`), open a project's Map tab on the new scan and check by eye: the base outline sits on the base, cables are coloured by tier, the drawer wall is outlined and filled where the routed pipes reach it, the Y slider cuts through floors, and a pinned note survives a reload. During the scan the live server's TPS and the game must be unaffected (it only reads the newest complete backup).

- [ ] **Step 4: Write the README section**

Add "## World map" to `README.md` (user-facing, ~25 lines, no local paths): what it reads (the newest *complete* backup in `<server>/backups`, else a snapshot copy; never the live world files; nothing is written to the server folder); setting `serverFolder` in `data/config.json`; `npm run scan` (`--backup <file>`, `--json`); scanning from the World page; friends uploading from their browser (pick the world folder, tick the dimensions they need — only `level.dat` and those region files are sent — or pick a zip); where scans live (`data/scans/<id>/`, safe to delete old folders while the app is stopped); choosing a scan and base on a project's Map tab; what the map shows and how to add notes; that power figures are estimates (clear, rain, average) and storage that cannot be read reliably is shown as unknown.

- [ ] **Step 5: Commit**

```bash
git add tests/e2e/world.spec.ts tests/unit/world/real-world.test.ts README.md
git commit -m "test(world): end-to-end world upload, scan and map; docs: world map README" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Architecture change requests

The tasks above assume each request is granted. All are additive; none renames or reshapes an existing contract.

1. **Battery stats in the export (Plan 1, §6.2).** Add `electric?: { maxCharge: number; tier: number; canProvideEnergy: boolean }` to `Item`, filled by the exporter through `ic2.api.item.IElectricItem` (`getMaxCharge`, `getTier`, `canProvideEnergy`) for every electric item. *Why:* battery max charge is not stored in the world (world-format §6.4), so buffer capacity — and with it "battery buffers cover a rain outage" (spec §3.5) — cannot be computed otherwise. *Without it:* `capacityEU` counts only the buffers' internal storage (Task 9 already handles a missing entry). Diff: `pack.ts` `Item` + one optional field; exporter `ItemsSection` writes it.
2. **Plan cache key includes the base (Plan 2, §7 plan route).** `planCacheKey` must include `project.world.baseId` next to the scan id, and an applied `world` op must emit the SSE `plan` event. *Why:* picking another base of the same scan changes `PlanContext` (owned machines, storage, tier, power); the current key (settings hash + export id + scan id) would serve the old plan.
3. **Upload timeout (Plan 2, `src/server/http/server.ts`).** `createServer({ requestTimeout: 7_200_000 })` (web-stack §4.2: the 300 s default cuts off a 1 GB upload on a home uplink; SSE is unaffected). Task 14 adds it if Plan 2 has not.
4. **Top-level client pages (Plan 2, §7.2).** Plan 2 creates `src/client/views/top-pages.ts` with `export interface TopPage { path: string; label: string; component: ComponentType }` and `export const TOP_PAGES: TopPage[]` (Plan 2: projects list), read by its router and header navigation — the same append-only pattern as `PROJECT_TABS`. Plan 4 appends `{ path: '/world', label: 'World', component: WorldPage }`. *Why:* a world scan belongs to the whole group, not to one project, and the architecture has no other place for a top-level page.
5. **Two world API additions (§7).** `POST /api/world/scans/:id/cancel` → 204 / 404 / 409 (spec anti-goal: a slow scan must be stoppable), and an optional `?y=<0..255>` query on `GET /api/world/scans/:id/tiles/:dim/:tx/:tz` (default 255 = surface) for the map's Y-level control (spec §3.7).
6. **§6.6 additions (optional fields and helpers, listed for visibility).** `PlacedMachine.{kind?, tier?, name?, recipeEUt?, coilHeat?}`, `PlacedPipe.{kind?, voltageTier?, amps?, networkId?}`, `PowerNetwork.{loadEUt?, solarShare?}`, `LogisticsNetwork.{parts?}`, `StorageBlock.{capacityStacks?, controller?}`, `WorldScan.{logisticsBlocks?, warnings?, skippedChunks?}`; new exports in `src/shared/types/world.ts`: `LogisticsBlock`, `BBox`, `Voxels` (moved here from the prose of §6.6 so Plan 5 can import it; index `(y·size[2] + z)·size[0] + x`, palette entry 0 = air and 1 = `UNKNOWN_BLOCK` for unscanned blocks), `AIR_INDEX`, `UNKNOWN_INDEX`, `UNKNOWN_BLOCK`, `TILE_SIZE`, `tileOf`, `encodeMapTile`, `decodeMapTile` (column `i = lz·64 + lx`), `baseIdOf`, `findBase`. The §6.6 server functions are the methods of `WorldService` (`src/server/world/scan.ts`), registered as `app.services.world`; `contextFromScan` is exported from `src/server/world/context.ts`.
7. **Plan 2's e2e helpers.** `tests/e2e/helpers.ts` exports `login(page: Page): Promise<void>` and `createProject(page: Page, name: string): Promise<string>` (returns the id and leaves the page on the new project). Task 18 relies on exactly these.
