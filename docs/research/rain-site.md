# RUK-3036: what the planner knows about where rain cannot fall (dimension, biome, cover above the site)

Research inventory for the CTO (RUK-2571 R-cover), read out of our own code with a `path:line` on every claim.
Since RUK-3032 every line lays a glass rain roof (`src/server/layout/layout.ts:438-440`, the roof step
`src/server/layout/steps.ts:224-236`). GT's three gates for rain — the world raining, a biome that can rain, and a
column with no movement-blocking block above — are documented in `docs/research/gt-mechanics.md` §3.4a
(`docs/research/gt-mechanics.md:369`, exposure test at :375, biome gate and weather flags at :376). This file says
what our scan and layout already hold for each gate. No code was changed.

## 1. Dimension

**Where a layout's dimension lives, and where the layout code reads it.**

- Every layout carries its dimension: `Layout.dim: number` (`src/shared/types/layout.ts:224`).
- `layoutLine` (the entry point, `src/server/layout/layout.ts:910`) derives it from the project's base:
  `const dim = base?.dim ?? 0` (`src/server/layout/layout.ts:932`), where `base` is
  `findBase(scan, project.world.baseId)` (`src/server/layout/layout.ts:927`) and the project stores
  `world: { scanId, baseId }` (`src/shared/types/project.ts:13`). It goes into every returned layout
  (`src/server/layout/layout.ts:915` empty plans pinned to 0, `src/server/layout/layout.ts:976`,
  `src/server/layout/layout.ts:1099`).
- `Base.dim` is part of the scan (`src/shared/types/world.ts:11`), so after the base is chosen the layout knows the
  numeric dimension id and nothing else about it. The site request carries the same id (`SiteRequest.dim`,
  `src/server/layout/site.ts:19`, set from `base.dim` at `src/server/layout/layout.ts:530`) and the voxels are read
  in it (`src/server/layout/layout.ts:547`).
- The scan's per-dimension summary is `DimSummary` (`src/shared/types/world.ts:10`), built by `dimSummaries`
  (`src/server/world/dims.ts:103`) and stored in `WorldScan.dims`
  (`src/shared/types/world.ts:40`). `keys` is every pack dimension id string sharing the numeric id and `name` the
  first of their names, falling back to `Overworld` / `DIM<id>` (`src/server/world/dims.ts:124`, doc comment
  `src/server/world/dims.ts:98-101`; the same fallback in the scan worker's namer,
  `src/server/world/scan.worker.ts:308-311`).
- The layout code itself never reads `scan.dims`: the only code occurrence of `dims` under `src/server/layout/` is the
  empty-scan constructor (`src/server/layout/layout.ts:79`), the one other hit of the same grep being that function's
  doc comment (`src/server/layout/layout.ts:76`). So a layout has the id, and the name/keys table exists in the scan it
  is given, but nothing on the layout path consults it.

**Does any of our code or data say whether a dimension has weather or a sky? Not found.**

- The pack's dimension table `DimensionInfo` has `key`, `id`, `name`, `mod`, `kind`
  (`'dimension' | 'planet' | 'moon' | 'asteroids' | 'station' | 'region'`), `rocketTier`, `defaultTier` and nothing
  else (`src/shared/types/pack.ts:129`; built into `Worldgen.dimensions` at `src/shared/types/pack.ts:139`). The
  scan's copy comes from `pack.worldgen.dimensions` (`src/server/world/facts.ts:52`, field
  `src/server/world/facts.ts:18`), and the layout-side facts the same (`src/server/world/facts.ts:52`).
- The exporter row it is built from, `DimensionLine`, carries `id`, `provider`, `name`, `display`, `mod`, `ore`,
  `body`, `airIntake` — no weather, sky, atmosphere or precipitation field
  (`src/server/pack/format.ts:82`); `buildDimensions` maps those and only those into `DimensionInfo`
  (`src/server/pack/worldgen.ts:168-172`). `airIntake` becomes a fluid source for machines
  (`src/server/pack/worldgen.ts:174`, `src/server/pack/worldgen.ts:244`), not a sky flag.
- `level.dat` is read for the level name, spawn, the FML block/item id maps, mod versions and ChunkAPI managers
  (`src/shared/world/level-dat.ts:7-11`, return at `src/shared/world/level-dat.ts:52-56`); the `Data` compound is
  read only for `LevelName` and `SpawnX/Y/Z` (`src/shared/world/level-dat.ts:53-54`). Vanilla `Data.raining`,
  `rainTime`, `thundering`, `thunderTime` are never touched
  (`src/server/world/level-dat.ts:8-10` is the whole server-side reader).
- The only weather numbers in the codebase are global constants for the overworld weather cycle used by the power
  estimate: `WEATHER = { meanRainTicks: 18_000, meanClearTicks: 96_000, ... }`
  (`src/server/world/power.ts:32`, doc `src/server/world/power.ts:29-31`), consumed for the solar rain outage
  (`src/server/world/power.ts:34-37`, used at `src/server/layout/layout.ts:166`). They are not per-dimension.
- Searches run: `grep -rn -i biome src`;
  `grep -rn -iE '\b(rain|rainfall|precip|weather|thunder|sky|snow)\b|hasNoSky|isSurfaceWorld|rainTime|isRaining' src`
  → 70 hits, and every one of them is in a category that says nothing about a dimension: the rain roof and its rule
  (`src/server/layout/rain.ts:1-6`, `src/server/layout/parts.ts:58`, `src/server/layout/steps.ts:224`), the rain
  outage in the power estimate (`src/server/world/power.ts:32`, `src/server/layout/power.ts:145`,
  `src/server/cli/scan.ts:62`), the farm planner's crop "open sky" flag, its comment on the biome's float rainfall
  (§2; `src/server/planner/farms/crops.ts:53`) and the same flag's UI label
  (`src/shared/types/farm.ts:34`, `src/shared/project/apply-op.ts:320`, `src/client/views/SettingsPanel.tsx:790`), the
  resource table's `minecraft:snow`/`minecraft:snowball` overworld keys (`src/server/planner/availability.ts:143`) and
  the word "sky" in a CSS comment (`src/client/styles.css:1790`);
  `grep -rn -i 'rain' src` → 92 hits: those 70 plus 12 that match inside the word "constraints" — a substring artefact
  of the looser grep, not a weather fact (`src/client/views/flow-model.ts:256`,
  `src/client/connections/model.ts:500`, `src/server/db/db.ts:148`, `src/server/layout/feeding/read.ts:14`,
  `src/server/planner/machine-options.ts:189`);
  `grep -rn -i 'hasNoSky\|isSurfaceWorld\|rainTime\|thunderTime\|raining' src tests` → no hits.

**`DimSummary.name` / `keys` in the test fixtures.**

- Hand-built map fixture: `{ dim: 0, keys: ['Overworld'], name: 'Overworld', ... }` and
  `{ dim: 7, keys: ['TwilightForest'], name: 'Twilight Forest', ... }` (`tests/helpers/scan-fixture.ts:20-21`);
  layout fixtures: `{ dim: 0, keys: ['overworld'], name: 'Overworld', ... }`
  (`tests/helpers/layout-fixtures.ts:419`).
- The world tests' pack table (fed to `dimSummaries` as `facts.dimensions`) is
  `overworld/0, nether/-1, theend/1, endasteroid/1, twilightforest/7, moon/28, ross128b/64`
  (`tests/helpers/world-facts.ts:53-61`); the mini pack used by layout tests has
  `overworld/0, nether/-1, moon/28` (`tests/helpers/mini-gt.ts:99-101`).
- What `dimSummaries` produces from it (assertions):   `[-1, ['nether']], [0, ['overworld']], [7, ['twilightforest']],
  [28, ['moon']], [64, ['ross128b']]` (`tests/unit/world/dims.test.ts:16-18`), a DIM 1 id yielding
  `keys: ['theend', 'endasteroid']` (`tests/unit/world/dims.test.ts:22`, `tests/unit/world/dims.test.ts:30`), and an
  unknown id 99 yielding `name: 'DIM99', keys: []` (`tests/unit/world/dims.test.ts:31`).
- A scan of the sample world (fixture worlds for dims 0, −1 and 7, `tests/helpers/sample-world.ts:76-87`) ends with
  dims `[-1, 0, 7, 28]` with visit evidence (`tests/unit/world/scan-job.test.ts:133-137`) and dim 7 unvisited
  (`tests/unit/world/scan-job.test.ts:100`).

## 2. Biome

**Does the world reader read the chunk `Biomes` array?** There is a decoder, and production code never calls it.

- `biomeAt(level, x, z)` reads the per-column biome id from a chunk's `Level` compound: `Biomes16v2` (256
  little-endian u16, null 65535) when present, else vanilla `Biomes` (256 u8, null 255), −1 for null/absent
  (`src/shared/world/sections.ts:81-96`, doc `src/shared/world/sections.ts:76-80`).
- The only callers anywhere are its unit tests (`tests/unit/world/sections.test.ts:79-96`;
  `grep -rn 'biomeAt' src tests` finds the definition and the tests, nothing else — the server re-export
  `src/server/world/sections.ts:1` re-exports the shared module, which is how the tests import it).
- The voxel reader that the site search runs on decodes `Level.Sections` only: "tile entities, entities and biomes
  are never built" (`src/server/world/area.ts:2-3`), and `decodeChunk` reads just `level.Sections`
  (`src/server/world/area.ts:55-67`).
- The scan's chunk pass likewise: it reads `xPos`, `zPos`, `InhabitedTime` and `TileEntities`, and "everything else,
  `Sections`, `Entities` and biomes included, is skipped by length" (`src/server/world/tile-entities.ts:1-5`); what
  it keeps per chunk is `ChunkStat { dim, cx, cz, inhabitedTime, timestamp, teCount, oreTes }`
  (`src/server/world/model.ts:15`) — no biome.
- The test world writer writes no `Biomes` array (`grep -rn 'Biomes' src tests` matches only
  `src/shared/world/sections.ts`, `tests/unit/world/sections.test.ts` and unrelated `BiomesOPlenty` block names).

**Can the layout look up the biome id of a world column? No.** The site search's whole view of the world is
`Voxels` — a palette of `BlockRef` block states per cell (`src/shared/types/world.ts:61`) — and `SiteRequest` carries
dim, footprint, base, floor, ports, taps, avoid (`src/server/layout/site.ts:18-23`). No type on the layout path
holds a biome.

**Does any code map a biome id to a name or to rainfall? Not found.** Searches: `grep -rn -i biome src` and
`grep -rn -i 'rainfall\|humidity' src`. The hits are: the block-name curated table's `biomesoplenty` mod id
(`src/server/assets/curated.ts:88`), Forge biome-dictionary tag *strings* on crop definitions (`likedBiomes`,
`src/shared/types/pack.ts:157`), and the farm planner's assumed humidity: it "assumes" a neutral 0.5 and never reads
a biome (`src/server/planner/farms/crops.ts:29-30`, the rainfall bonus it ignores at
`src/server/planner/farms/crops.ts:53-55`).

## 3. Cover above the site

**What the site search knows about blocks above the line's box.**

- The box the search reads, `siteSearchBox` (`src/server/layout/site.ts:83-101`): x/z is the base bbox ±24
  (`SITE_MARGIN`, `src/server/layout/site.ts:11`, applied at `src/server/layout/site.ts:85-86`), grown ±2 around
  each tap (`TAP_REACH`, `src/server/layout/site.ts:37`, `src/server/layout/site.ts:88-92`), capped at a 192-block
  span (`MAX_SITE_SPAN`, `src/server/layout/site.ts:14`, `src/server/layout/site.ts:98-99`). Y is
  `floorY − 1 − 8` to `floorY + footprint.h + 8` (`src/server/layout/site.ts:87`; `SITE_HEADROOM = 8`,
  `src/server/layout/site.ts:15`), clamped to world 0..255 (`clampY`, `src/server/layout/site.ts:75-77`;
  `WORLD_TOP_Y = 255`, `src/server/layout/site.ts:35`; applied `src/server/layout/site.ts:100`).
- Above that box nothing is known: a cell outside the voxels reads UNKNOWN
  (`src/server/layout/site.ts:131-134`), and a column whose topmost known cell is UNKNOWN has no top and is not
  ground (`src/server/layout/site.ts:156-157`), which fails the search's all-columns-ground rule
  (`src/server/layout/site.ts:180`). Cover above the read box is invisible, not protection.
- **A block above the box inside the read range becomes the column's "top" and blocks the site — cover is currently
  an obstacle, never a shelter.** `topAt` scans from the top of the box down and returns the first cell that is not
  air/replaceable (`src/server/layout/site.ts:136-141`); `columnsOf` stores that as the column top, marking it
  ground only when that top is SOLID (`src/server/layout/site.ts:152-163`, ground rule
  `src/server/layout/site.ts:160`). `levelAt` then demands every footprint column be ground, its top within ±1 of
  the mode (`src/server/layout/site.ts:178-191`), the clearance ring no higher than `y0 + 1`
  (`src/server/layout/site.ts:194-199`), and room `y0 + h ≤ maxY` for the line
  (`src/server/layout/site.ts:192`). A roof two blocks over the footprint makes every covered column's top the
  roof, so the flatness and clearance rules reject the spot; nothing in `findSite`
  (`src/server/layout/site.ts:219-255`) distinguishes "block in the way of the line" from "block above the line".
- `checkPlacement` (`src/server/layout/site.ts:296-298`) runs `measure`
  (`src/server/layout/site.ts:263-293`): `blocked` counts SOLID/FLUID/MACHINE cells only *inside the line's volume*
  (`src/server/layout/site.ts:274-278`) and the floor cell one below it
  (`src/server/layout/site.ts:281-283`); y is clamped to 1..256−h (`src/server/layout/site.ts:266`). Cells above
  the volume are never counted as blocked — and the column top from `topAt` feeds `dig`
  (`src/server/layout/site.ts:284-288`), so a cover block inside the box above the floor is counted as dirt to dig
  out, again as an obstacle.
- The scan's per-column height, `MapTile.height`: a `Uint8Array` of 64×64 columns beside `top`
  (`src/shared/types/world.ts:47`). `renderTile` scans each column down from `min(255, maxY)`
  (`src/server/world/tiles.ts:83`) and stops at the first block whose id is not 0
  (`src/server/world/tiles.ts:94-98`), storing its y in `height` and its palette index in `top`
  (`src/server/world/tiles.ts:112-113`); an unavailable chunk is UNKNOWN at height 0
  (`src/server/world/tiles.ts:92`), an all-air column air at height 0 (`src/server/world/tiles.ts:93`, doc
  `src/server/world/tiles.ts:76-78`). So `height` is the **highest non-air block**, from *all* block types — no
  movement-blocking notion, flowers and water count, unlike GT's `blocksMovement()`/`isLiquid()` set
  (`docs/research/gt-mechanics.md:375`). The scan draws tiles with `maxY = SURFACE_Y = 255`
  (`src/server/world/scan.worker.ts:71`, `src/server/world/scan.worker.ts:359`; the on-demand path clamps the same
  way, `src/server/world/scan.ts:33`, `src/server/world/scan.ts:565-566`). Its consumers are the map hover readout
  (`src/client/map/hover.ts:255-261`); the layout path never reads `MapTile`
  (`grep -rn 'MapTile' src/server/layout` → no hits) — the layout re-reads raw voxels through
  `deps.readArea` (`src/server/layout/layout.ts:55-56`).
- The roof rule itself assumes open sky everywhere: "the spike assuming open sky everywhere (site cover and
  dimensions come later)" (`src/server/layout/rain.ts:5-6`); `rainExposures` consults only the line's own laid
  blocks, and a neighbour column outside the line's box is open sky
  (`src/server/layout/rain.ts:56-74`, open-sky edge rule `src/server/layout/rain.ts:53`).

## 4. The layout's view of the world

- `layoutLine(pack, plan, scan, project, deps)` (`src/server/layout/layout.ts:910`) gets the scan as a parameter —
  the layout service fetches it by `project.world.scanId` and binds `deps.readArea` to the same scan id
  (`src/server/layout/service.ts:143-155`, fetch + bind at `src/server/layout/service.ts:151-153`, interface
  `src/server/layout/layout.ts:55-56`, service interface `src/server/layout/service.ts:56`).
- The site's origin: `chooseSite` (`src/server/layout/layout.ts:507-573`) builds the search box
  (`src/server/layout/layout.ts:545`), reads the voxels (`src/server/layout/layout.ts:547`, `base.dim`), then
  returns a `Site` from `checkPlacement` of the dragged placement (`src/server/layout/layout.ts:558`), `findSite`
  (`src/server/layout/layout.ts:564`) or `fallbackSite` (`src/server/layout/layout.ts:566`); `Site.origin` is set
  at `src/server/layout/site.ts:239` / `src/server/layout/site.ts:267`. `frameAt` copies it into the world frame
  (`src/server/layout/layout.ts:585-587`).
- The dimension: `const dim = base?.dim ?? 0` (`src/server/layout/layout.ts:932`), returned as `Layout.dim`
  (`src/server/layout/layout.ts:1099`).
- **The roof is decided before the site exists.** `roofCells` runs inside `buildLocalAt`
  (`src/server/layout/layout.ts:439`, in `buildLocalAt` `src/server/layout/layout.ts:417`, roof blocks appended at
  `src/server/layout/layout.ts:440`), which is stages 3–5, driven from `buildLocal`
  (`src/server/layout/layout.ts:1108`) — all before any site is chosen. The roof is glass
  (`src/server/layout/parts.ts:58`) and gets its build step from the roof rule text
  (`src/server/layout/steps.ts:224-236`, step label `src/server/layout/steps.ts:590`).
- **The first point after the site is chosen where the roof could be dropped** is in `finishLine`
  (`src/server/layout/layout.ts:987`) immediately after `chooseSite` returns
  (`src/server/layout/layout.ts:1000-1001`): at that point `chosen.site`, `chosen.vox` (the read voxels), the
  frame (`src/server/layout/layout.ts:1002`) and `dim` (`src/server/layout/layout.ts:932`) are all in hand, and the
  line's local blocks — roof included — are mapped to world positions one statement later at
  `src/server/layout/layout.ts:1009` (`const lineBlocks = line.blocks.map((b) => worldBlock(b, frame))`).
  Filtering roof-role blocks there is where a "no roof needed" rule would hook in, and the BOM and the build steps do
  recompute from the filtered `blocks` downstream: `bomFromBlocks(blocks, ...)` (`src/server/layout/layout.ts:1037`)
  and `layoutSteps(stepsInput)` (`src/server/layout/layout.ts:1095`) with `blocks` inside `stepsInput`
  (`src/server/layout/layout.ts:1091`). The size does not — it is footprint-derived, not block-derived: `Layout.size`
  is `worldSize` (`src/server/layout/layout.ts:1099`, field at `src/shared/types/layout.ts:224`), where
  `worldSize = rotatedSize(extent, frame.rotation)` (`src/server/layout/layout.ts:1005`) and
  `extent = farmExtent(line.size, boxAreas)` (`src/server/layout/layout.ts:992`) is the line's own footprint grown to
  every farm area (`src/server/layout/farms.ts:69-70`); `stepsInput.size` is the footprint alone
  (`lineSize = rotatedSize(line.size, frame.rotation)`, `src/server/layout/layout.ts:1008`) and `siteSize` is the same
  `worldSize` (`src/server/layout/layout.ts:1084`). So filtering roof-role blocks leaves `Layout.size` and `siteSize`
  untouched: a no-roof rule does not shrink the layout box for free. Named, not changed.

## 5. Summary table

| Case | Known today | Where | What is missing |
|---|---|---|---|
| (a) Dimension that never weathers | **Partly** — the layout knows the numeric id, and the scan carries name/keys per id | `Layout.dim` `src/shared/types/layout.ts:224`, set `src/server/layout/layout.ts:932`; `DimSummary` `src/shared/types/world.ts:10`, built `src/server/world/dims.ts:103` | No weather/sky fact anywhere: `DimensionInfo`/`DimensionLine` have no such field (`src/shared/types/pack.ts:129`, `src/server/pack/format.ts:82`), level.dat weather fields are never read (`src/shared/world/level-dat.ts:7-11`), and the layout never reads `scan.dims` (only `src/server/layout/layout.ts:79`) |
| (b) Biome that cannot rain | **No** | biome id decoder exists (`src/shared/world/sections.ts:81-96`), tested (`tests/unit/world/sections.test.ts:79-96`) | Nobody calls it; the site's voxels and every layout type carry no biome (`src/server/world/area.ts:2-3`, `src/server/layout/site.ts:18-23`); no biome-id→rainfall table exists (searches in §2) |
| (c) Cover above the site | **Partly, and backwards** — the scan knows the highest non-air block per column; the site search reads up to `floorY + h + 8` | `MapTile.height` `src/shared/types/world.ts:47` from `src/server/world/tiles.ts:94-113`; box `src/server/layout/site.ts:83-101` | The layout never reads those tiles (§3); within the box a block above the line is treated as an obstacle/`dig` (`src/server/layout/site.ts:152-163`, `src/server/layout/site.ts:284-288`), and above the box nothing is known (`src/server/layout/site.ts:131-134`); the roof rule assumes open sky (`src/server/layout/rain.ts:5-6`); `height` is highest-non-air, not GT's movement-blocking set (`docs/research/gt-mechanics.md:375`) |

## Open questions for the CTO

Game-side facts below are questions, not claims — nothing outside our code and `docs/research/` was used.

1. **Dimension → weather.** Our data has no flag for "this dimension rains" (§1). Is the intended source the
   exporter (`DimensionLine`, `src/server/pack/format.ts:82` — a new field there?) or a hand-maintained table keyed
   by `DimensionInfo.key` like the quest table (`src/server/world/dims.ts:14-21`)? Which GTNH dimensions are in
   fact weatherless is a game fact we do not have; §3.4a only says a world that never weathers is safe
   (`docs/research/gt-mechanics.md:376`).
2. **Biome.** Reading biomes means wiring `biomeAt` (exists, `src/shared/world/sections.ts:81`) into the scan and
   carrying per-column biome ids to the site — and a biome-id → rainfall/can-snow table, which the pack export does
   not carry today (§2). Is that table to be exported from the game, hand-maintained, or is the biome gate out of
   scope (a desert base being the rare case)?
3. **Cover.** If "under an existing cover" may drop the roof, the rule needs: (i) GT's movement-blocking material
   set (plants and snow layers do *not* shield, glass and leaves do — `docs/research/gt-mechanics.md:375`) mapped
   onto our block palette, which today only distinguishes replaceable/fluid/machine/solid
   (`src/server/layout/site.ts:27-31`, `src/server/layout/site.ts:104-115`); and (ii) inverting today's site logic,
   where a block above the line's footprint kills the spot (§3). Which columns must be checked — GT uses the
   machine's own column and the 4 horizontal neighbours (`docs/research/gt-mechanics.md:375`) — and how far above
   the read box (`SITE_HEADROOM = 8`, `src/server/layout/site.ts:15`) is enough to answer that?
4. **Live weather (`worldObj.isRaining()`).** The scan is an offline snapshot; level.dat's `raining`/`rainTime` are
   vanilla world state we do not read (§1). Should a scan capture them as a hint (weather cycles, so a snapshot says
   little), or is the roof rule to be built on the two static gates (dimension, biome) plus cover only?
