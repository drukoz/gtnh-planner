# Add-on 20: Hatch Rules from the Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The exporter records, for every exported multiblock structure, which hatch kinds GregTech's own structure check takes on each cell, and the layout places every hatch by that record, so a line's multiblocks form in game; the hand table of the hatch-rules fix stays only as the fallback for exports without the record, plus the controller notes no structure probe can see.

**Architecture:** The structures section (exporter 0.6.0) builds each multiblock as today, then runs the controller's own `checkStructure` once with StructureLib's instrument switched on, which names the element (shape character) that checks every cell. For each element it puts one hatch of each of 17 kinds on one of its cells in turn, runs `checkStructure` again and asks whether GregTech filed that hatch in one of the controller's hatch lists; the answers go into two optional fields of the structure line (`elements`, `elementOf`). The loader turns them into `StructureInfo.elements`, and the layout's rule lookup uses them before the hand table: per-cell acceptance from the export, the table's controller notes (distillation layers, cracker sides and catalyst, casing minimums) on top when the table's shape still fits.

**Tech Stack:** Node 24 (type stripping) · TypeScript 6.0.3 · vitest 5.0.3 · the exporter mod's existing Java toolchain (GTNHGradle 2.0.33, Jabel to Java 8 bytecode, JUnit 5, Gson 2.2.4), GT5-Unofficial 5.09.54.183 and StructureLib 1.4.45 as the pack ships them — no new dependency anywhere.

**Spec:** `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` §3.6 (line layout, hatches and their logistics); contracts `docs/superpowers/plans/2026-10-17-00-architecture.md` §6.2 and §11 (this plan's entry is **49**); research `docs/research/gt-mechanics.md` §5 (this plan adds §5.5 from the evidence below) and the hatch-rules fix's research and table (branch `fix/hatch-rules`, merged before Task 5).

**Depends on.** Tasks 1–4 (wire format, exporter, loader) touch no file the hatch-rules fix changes and may run now, beside it; before Task 1, `git diff --name-only main...fix/hatch-rules` must list none of the files of Tasks 1–4 (`src/shared/types/pack.ts`, `src/shared/gt/hatch-kinds.ts`, `src/server/pack/*`, `src/server/cli/pack-info.ts`, `src/server/export/validate.ts`, `exporter-mod/**`), else start at Task 5's merge. Task 5 onward runs only after `fix/hatch-rules` is merged into main: Task 5 Step 1 merges main and checks the fix's names. The controller's sequencing for this add-on says "after fix/hatch-rules merges"; the user asked for parallel lanes — open question 1.

## Evidence and the choice of method

Read on 2026-10-20 with `javap` on copies of the server's `structurelib-1.4.45.jar`, `gregtech-5.09.54.183.jar` (which carries GT++, BartWorks, TecTech, GoodGenerator, KubaTech and KekzTech), `forge-1.7.10-10.13.4.1614-1.7.10-universal.jar` and the hydroenergy, cropsnh, matter-manipulator and vendingmachine jars; Task 1 copies these bullets into `gt-mechanics.md` §5.5.

1. **[jar] StructureLib can say which element checks which cell.** `StructureLibAPI.enableInstrument(Object)` / `disableInstrument()` set a thread-local token; `StructureUtility.iterateV2` (every check, build and hint walk) then calls `StructureEvent.StructureElementVisitedEvent.fireEvent(world, x, y, z, a, b, c, element)` for every non-navigating element whose block exists, before the walker's `visit`. `fireEvent` posts on `MinecraftForge.EVENT_BUS` inside `catch (Exception)`; the event has `getWorld`, `getX/Y/Z`, `getA/B/C`, `getElement` and `getInstrumentIdentifier`. FML 1.7.10's `EventBus` has `register(Object)` and `unregister(Object)`; `post` logs a listener's throwable and rethrows it.
2. **[jar] GregTech's check walks with those events.** `MTEEnhancedMultiBlockBase.checkPiece(piece, a, b, c, errors)` calls `IStructureDefinition.iterate(piece, world, getExtendedFacing(), x, y, z, a, b, c, new StructureChecker(this, forced, errors))`; `StructureChecker.visit` returns `element.check(...)`, so the walk of a piece stops at its first failing element (adding a `PositionedStructureError`). `MTEMultiBlockBase.checkStructure(boolean, IGregTechTileEntity)` (public, server side) runs `clearHatches()`, `structureErrors.clear()`, `checkMachine(base, mInventory[1], structureErrors)` and `mMachine = structureErrors.isEmpty()`.
3. **[jar] What a hatch element accepts is its adder.** `HatchElementBuilder$2.check` is `te instanceof IGregTechTileEntity && mAdder.apply(t, te, (short) mCasingIndex)`; `buildAndChain(...)` is an `IStructureElementChain` with fallbacks `[build(), casing…]`, tried in that order by `check` and `placeBlock`. The hatch elements given to `atLeast`/`anyOf` live only inside the lambdas `mAdder`, `mHatchItemFilter` and `mShouldSkip` — no field holds them.
4. **[jar] The hologram build fills hatch-only elements from a creative source.** A chained hatch element's `survivalPlaceBlock` rejects unless the trigger stack has `GTStructureChannels.HATCH` or the element is `exclusive()` (`newAny`); an exclusive one takes the first hatch `GTCreativeHatchSource` offers and calls `checkStructure(true, base)`. So the active export holds 115 hatches inside structures: Muffler Hatch 99 in 8 (the EBF 1000 among them), the ULV Dynamo 30 in 19 generators, Input Hatch (Debug) 11306 in 5, Input Bus (Debug) 11305 in 4, the Turbine hatch, ME output hatches and beamline hatches.
5. **[jar] Some adders only answer inside their controller's own check.** The Distillation Tower checks pieces `base` (`b`) and `layer` (`l`, `c`) but builds `layerHint`/`topHint` (`L`); its `addLayerOutputHatch` takes an `MTEHatchOutput` into `mOutputHatchesByLayer.get(mHeight - 1)`, `mHeight` being set by `checkMachine` (a call outside it indexes −1). The Oil Cracking Unit's `l`/`r` adders take an `MTEHatchInput` or an `MTEHatchOutput` and fix the input side by the first one found (`mInputOnSide`/`mOutputOnSide`); its `m` files input hatches in `mMiddleInputHatches`. Per-cell rules say what a cell can take; which combination forms stays the controller's code (the hatch-rules fix's notes).
6. **[jar] Reading the definitions would miss machines.** 219 GT-jar classes reference `buildHatchAdder`; 9 multiblock classes build hatch elements with the lambda-only `GTStructureUtility.ofHatchAdder`/`ofHatchAdderOptional` (`MTEAssemblyLine`, `MTEDistillationTower`, GGFab `MTEAdvAssLine`, GT++ `MTESpargeTower`, `MTEAdvDistillationTower`, `MTEPowerSubStation`, Intergalactic `TileEntityModuleBase`, TecTech `MTEMicrowave`, godforge `MTEBaseModule`); 10 multiblocks use `StructureWrapper` (`HatchInterceptor`); about 50 classes implement `IHatchElement`; the Vacuum Freezer and Implosion Compressor build their definition lazily in `getStructureDefinition()`.
7. **[jar] Hatch classes.** `MTEHatchSteamBusInput extends MTEHatchInputBus`, but `addInputBusToMachineList` tests `instanceof MTEHatchSteamBusInput` first, so steam buses are their own kind; TecTech's `MTEHatchEnergyMulti extends MTEHatch` (not `MTEHatchEnergy`), `MTEHatchEnergyTunnel extends MTEHatchEnergyMulti`, `MTEHatchDynamoMulti extends MTEHatchDynamo`; `MTEHatchCustomFluidBase` is the Steam Hatch (31040) and the Cryotheum (967) and Pyrotheum (968) hatches; the 2.9 Coke Oven (236, `MTECokeOven extends MTEEnhancedMultiBlockBase`) takes Coke Oven Hatches (237, `MTEHatchCokeOven`); the Bricked Blast Furnace (140) `extends MetaTileEntity` and has no hatch lists.
8. **[export] Who can be probed.** Of the 326 exported structures, 323 have an `MTEMultiBlockBase` controller and are not truncated (class-file superclass chains): the Bricked Blast Furnace is not one, 3013 and 15411 are truncated.

| | (a) read GT's definitions (HatchElementBuilder lists, dot hints) | (b) put each hatch kind on each element's cell and ask the controller's own check (**chosen**) |
|---|---|---|
| Coverage | builder elements only, through JVM lambda captures; misses the 9 `ofHatchAdder` multiblocks (the corpus's Distillation Tower among them), cannot evaluate state-dependent adders (tower layers, cracker sides) | every multiblock whose check walks StructureLib: 323 of 326 expected |
| Determinism | fixed, but rests on hidden-class field names | fixed walk, kinds in a fixed order, the lowest-id hatch of each kind, elements ordered by first cell, no hash order in the output |
| Cost | none | 17 `checkStructure` runs per element: Σ over structures of (elements × blocks) × 17 ≈ 13.6 M cell checks and about 20 k probe placements; estimate +3–8 s on today's 4.2–4.9 s structures section, under its own budget |
| Failure mode | wrong answers without a sign | GT side effects on a throwaway controller; caught per machine, the line then has no rules and the table applies |

## Global Constraints

- Node `>=24.10.0 <25`; `npm run typecheck` (`tsc -b`), `npx vitest run <files>`; real-data tests run only with `GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json` (worktree-local config: `dataDir` = the worktree's `data/`, whose `export` and `assets` are symlinks to `<repo>/data/export` and `<repo>/data/assets`; only `serverFolder` and `activeExportId` are copied from `<repo>/data/config.json`, which holds secrets — never print or copy anything else from it).
- TypeScript erasable syntax only (no `enum`, `namespace`, parameter properties, decorators); relative imports name the real `.ts` file; type-only imports use `import type`; `src/shared/` stays pure (no `node:*`, no DOM).
- Every new field of `StructureInfo`, `StructureLine`, `ManifestFile` and the fix's `HatchRule` is an optional addition (comment `// optional addition (add-on 20)`); an export without the new fields loads and lays out exactly as before this plan.
- Exporter: version **0.6.0** (the next minor after add-on 17's 0.5.0; if Task 1 Step 1 finds an exporter version ≥ 0.6.0 already, use the next minor and read every "0.6.0" below as that). Built from the worktree root with `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.6.0 ./gradlew …)`, where `.local/gradle-home` is a symlink to `<repo>/.local/gradle-home` as in the worktrees of plans 17 and 18; every installed jar passes `exporter-mod/scripts/check-reobf.sh`; Java 8 bytecode; JUnit only for helpers free of GregTech classes; no new Java dependency; Minecraft and Forge members called directly (reobfuscated), never by reflection.
- The 17 export hatch kinds, in this order, with GT's class (simple name) and, for one, a metaName prefix: `input_bus` MTEHatchInputBus · `output_bus` MTEHatchOutputBus · `input_hatch` MTEHatchInput · `output_hatch` MTEHatchOutput · `energy` MTEHatchEnergy · `energy_multi` MTEHatchEnergyMulti · `energy_laser` MTEHatchEnergyTunnel · `maintenance` MTEHatchMaintenance · `muffler` MTEHatchMuffler · `dynamo` MTEHatchDynamo · `dynamo_multi` MTEHatchDynamoMulti · `dynamo_laser` MTEHatchDynamoTunnel · `steam_input_bus` MTEHatchSteamBusInput · `steam_output_bus` MTEHatchSteamBusOutput · `steam_hatch` MTEHatchCustomFluidBase with metaName starting `hatch.steam.` · `data_access` MTEHatchDataAccess · `coke_oven_hatch` MTEHatchCokeOven. A kind's probe hatch is the lowest MTE id whose class has exactly that simple name (and metaName prefix).
- Wire names, exactly: structure line fields `elements` (array of `{ "ch"?: string, "hatches": string[] }`) and `elementOf` (one integer per `blocks` entry: its element's index, or −1); manifest count key `hatchRules` (structure lines with `elements`); system property `gtnhplanner.hatchProbeBudgetSeconds`, default `120`.
- Determinism: the exporter never lets hash order reach the output — elements in the order of their first block, kinds in the order above, an element's character the smallest one the definition maps to it; the same pack gives byte-identical `elements`/`elementOf` on every export.
- Exports: this plan runs exactly one, in Task 7, by the controller, through `npm run export -- --jar …` on the APFS clone; never start, stop or write the live Minecraft server or its folder; never write the main checkout's `data/config.json`, `data/export` (beyond the new export folder the CLI creates) or `data/assets`.
- Synthetic fixtures only in unit tests (invented names, except GT class names and MTE ids the code names); nothing game-derived is committed (`data/`, `.local/`, `docs/local/`, jars, exports); no absolute local paths in committed files.
- Commits use a conventional prefix and end with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use bare `git stash`.

## Review Focus

1. **An export where some multiblocks were probed and others not** (the probe budget ran out, a machine's probe threw, the Bricked Blast Furnace, a truncated structure): each multiblock follows its own source — export rules, else the table row, else the generic placement with `hatch_rules_unknown`; a structure without `elements` never reads as "takes no hatch". Tests: Task 4 (absent ≠ empty), Task 5 test 11.
2. **Cells the export does not cover** (GT's check stopped before them, or two elements checked them): they take no hatch; hatches go only on covered cells, and what does not fit warns `hatch_cells_short` — never a hatch on an uncovered cell. Test: Task 5 test 10.
3. **A planner and an exporter of different ages**: today's loader ignores both fields of a 0.6.0 line; the new loader drops a kind it does not know with one warning per structure and never fails on it, and fails with file and line only for a broken `elementOf`. Tests: Task 4.
4. **A tower built taller than the exported one** (a recipe with more fluid outputs than the exported layers): the inserted layers take the rules of the exported first layer above the bottom, the moved top keeps the top's. Tests: Task 5 tests 6 and 14.
5. **A cell only a hatch may fill** (the EBF's muffler, exclusive elements): the exported hatch stays there (the muffler at the lowest tier, as the hatch-rules fix does), no other kind is put on it, and a muffler is never put on a cell whose element takes none. Test: Task 5 test 12.

---

## Architecture change requests

All of these become one architecture §11 entry numbered **49** (reserved for this plan; 44 is add-on 15's, 45 add-on 17's, 46 add-on 19's; Task 1 Step 1 checks that 49 is still free and appends it after the last entry), appended in Task 1; its amendments to §6.2, §11.7 (the wire format's rules) and the hatch-rules fix's rule lookup stay inside entry 49:

1. **Hatch rules in the export** (exporter 0.6.0). A `structures.jsonl.gz` line may carry `elements: Array<{ ch?: string; hatches: string[] }>` and `elementOf: number[]`, always together: `elements[k]` is one element of GT's structure definition — `ch` its shape character when the definition is a `StructureDefinition` that maps one to it, `hatches` the export hatch kinds (`EXPORT_HATCH_KINDS`, in that order) whose probe hatch GT's own `checkStructure` filed in one of the controller's hatch lists when it stood on the element's probe cell; `elementOf[i]` is the element of `blocks[i]`, −1 for the controller, for a cell GT's check never reached and for one two elements checked. A line without them was not probed (an older exporter, a controller that is no `MTEMultiBlockBase`, a truncated structure, a machine whose probe failed, the probe budget used up). `manifest.counts.hatchRules` = lines with `elements`. Old loaders ignore both fields and the count.
2. **Pack types.** `src/shared/gt/hatch-kinds.ts` holds `EXPORT_HATCH_KINDS` (the 17 kinds of the Global Constraints), `type ExportHatchKind`, `EXPORT_HATCH_KIND_NAMES`, `EXPORT_HATCH_CLASSES` and `exportKindOfClass(simpleName, metaName)`. `StructureInfo.elements?: StructureElement[]` with `interface StructureElement { ch?: string; hatches: ExportHatchKind[]; cells: Array<[number, number, number]> }`; the loader drops kinds it does not know (one warning per structure) and fails with file and line for an `elementOf` that does not match `blocks` or `elements`.
3. **Where the layout's hatch rules come from**, in this order: the export's elements (per-cell acceptance), with the hatch-rules fix's table row for the same machine adding its controller notes (layer outputs, casing minimums, fluid input slots, hatch classes, power, "by hand" text) when the row's shape fits the exported structure; else the table row alone (an export without elements); else none (`hatch_rules_unknown`, generic placement). An export-ruled multiblock whose table row does not fit warns `hatch_notes_unfit` and follows the export alone. A cell whose element has no `ch` gets the character `#<element index>`. A layout kind is taken where any export kind of `KIND_SOURCES` is (`input_bus` ← `input_bus`, `steam_input_bus`; `output_bus` ← `output_bus`, `steam_output_bus`; `input_hatch`, `output_hatch`, `energy`, `maintenance`, `muffler` ← the same name; `steam` ← `steam_hatch`); a steam bus is placed where the machine takes no plain bus. An electric multiblock that takes only `energy_multi`/`energy_laser` energy hatches warns `hatch_energy_exotic` and gets no energy hatch.
4. **Research.** `docs/research/gt-mechanics.md` §5.5 "Hatch positions (exporter 0.6.0)": the evidence of this plan and the probe as built.

## File Structure

| File | Responsibility |
|---|---|
| `src/shared/gt/hatch-kinds.ts` (new) | the 17 export hatch kinds, their English names, GT classes and the class → kind lookup |
| `src/shared/types/pack.ts` | `StructureElement`, `StructureInfo.elements?` |
| `src/server/pack/format.ts` | `StructureElementLine`, `StructureLine.elements?/elementOf?`, the wire rule, the `hatchRules` count key |
| `src/server/pack/machines.ts`, `load.ts` | `toStructure(line, ctx)` reads and checks the elements |
| `src/server/cli/pack-info.ts`, `src/server/export/validate.ts` | "with hatch rules" in the summaries |
| `exporter-mod/…/export/sections/HatchKinds.java` (new) | the kinds and their probe hatches (pure) |
| `exporter-mod/…/export/sections/ElementGroups.java` (new) | which element checked which block, groups, probe cell (pure) |
| `exporter-mod/…/export/sections/ElementLine.java` (new) | one element and the JSON of `elements`/`elementOf` (pure) |
| `exporter-mod/…/export/sections/HatchLists.java` (new) | whether a controller's collection fields hold a hatch (pure reflection) |
| `exporter-mod/…/export/sections/StructureVisits.java` (new) | the StructureLib instrument listener |
| `exporter-mod/…/export/sections/HatchProbe.java` (new) | the probe of one built structure (GregTech calls) |
| `exporter-mod/…/export/sections/StructuresSection.java`, `ExporterMod.java`, `Exporter.java` | probe after each build, write the fields, summary warnings, count, budget; listener registration; the wire rule |
| `src/server/layout/hatch-export.ts` (new) | export elements → per-cell layout kinds, grown towers, power, steam bus classes |
| the hatch-rules fix's rule module (its draft: `src/server/layout/hatch-rules.ts`), `src/server/layout/arrange.ts` | `HatchRule.exported?`, `hatchRulesOf`, the export-first lookup, `hatch_notes_unfit`, `hatch_energy_exotic` |
| `tests/helpers/hatch-export-fixtures.ts` (new), `tests/helpers/real-corpus.ts` (new) | fixtures with elements; the plan 09 corpus shared by two real-data tests |
| `docs/research/gt-mechanics.md`, `docs/superpowers/plans/2026-10-17-00-architecture.md`, `README.md` | §5.5, entry 49, the user-facing lines |

## Measured costs

Measured for this plan (2026-10-20, on the active export `2.9.0-RC-1_20261019-221019` and its six predecessors):

- Structures section today: 4,199–4,902 ms (`sectionMillis.structures` of the last seven exports); whole export about 39–44 s wall clock (`docs/local/export-runs.md`).
- Probe work, from the active export: 326 structures, 133,630 blocks, 1,512 palette entries (1,186 besides the controllers, a stand-in for elements); Σ (palette entries − 1) × blocks = 800,745 cell checks per kind, × 17 kinds ≈ 13.6 M, plus about 1,186 × 17 ≈ 20 k probe placements and as many `checkStructure` runs. Estimate: +3–8 s; measured by Task 7's run (`sectionMillis.structures` and the log line `hatch probes on …`).
- File size: the same 326 structures with an `elements`/`elementOf` pair (palette entries as stand-in elements) make `structures.jsonl.gz` 353,570 bytes instead of 299,023 (+54.5 kB, about 1 % of the 5.8 MB export). A list of cell indices per element instead of `elementOf` would add 300 kB, so the plan uses `elementOf`.
- Loading: gunzip + parse + per-element cell lists of that file, Node 24, median of 10 warm runs: 12.4 ms against 10.1 ms today (+2.3 ms on a 1.6 s `loadPack`).

## Task outline

1. Contracts: export hatch kinds, pack and wire types, architecture entry 49, research §5.5.
2. Exporter helpers free of GregTech (kinds and probe hatches, element groups, the JSON, the hatch-list search), JUnit, and the Java/TypeScript vocabulary check.
3. The probe in the structures section (instrumented check, one probe per element and kind, restore, budget, summaries, count), exporter 0.6.0 and its jar checks.
4. Loader, `pack:info` and the validation summary.
5. The layout uses the export's rules first (after the hatch-rules fix is merged).
6. Every logistics mode with export-ruled multiblocks.
7. One re-export (controller), the real-data acceptance on the corpus in every mode, README.

---

### Task 1: Contracts — export hatch kinds, pack and wire types, entry 49, research §5.5

**Files:**
- Create: `src/shared/gt/hatch-kinds.ts`
- Modify: `src/shared/types/pack.ts` (`StructureElement`, `StructureInfo.elements?`), `src/server/pack/format.ts` (`StructureElementLine`, `StructureLine`, the header rule, `ManifestFile.counts`), `docs/superpowers/plans/2026-10-17-00-architecture.md` (append entry 49), `docs/research/gt-mechanics.md` (new §5.5; §5.1 gains one sentence pointing to it)
- Test: `tests/unit/shared/hatch-kinds.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces (`src/shared/gt/hatch-kinds.ts`, exact values; the Java table of Task 2 mirrors them):
  ```ts
  export const EXPORT_HATCH_KINDS = ['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'energy_multi', 'energy_laser',
    'maintenance', 'muffler', 'dynamo', 'dynamo_multi', 'dynamo_laser', 'steam_input_bus', 'steam_output_bus', 'steam_hatch',
    'data_access', 'coke_oven_hatch'] as const;
  export type ExportHatchKind = (typeof EXPORT_HATCH_KINDS)[number];
  export const EXPORT_HATCH_KIND_NAMES: Readonly<Record<ExportHatchKind, string>>;   // 'input bus', 'output bus', 'input hatch', 'output hatch',
    // 'energy hatch', 'multi-amp energy hatch', 'laser target hatch', 'maintenance hatch', 'muffler hatch', 'dynamo hatch', 'multi-amp dynamo hatch',
    // 'laser source hatch', 'steam input bus', 'steam output bus', 'steam hatch', 'data access hatch', 'Coke Oven Hatch'
  export const EXPORT_HATCH_CLASSES: Readonly<Record<ExportHatchKind, { cls: string; metaPrefix?: string }>>;   // the classes of the Global Constraints
  export function isExportHatchKind(s: string): s is ExportHatchKind;
  /** The kind whose class has simple name `simpleName` (and whose metaPrefix, when it has one, starts `metaName`); null for any other hatch. */
  export function exportKindOfClass(simpleName: string, metaName: string): ExportHatchKind | null;
  ```
- Produces (`src/shared/types/pack.ts`):
  ```ts
  /** One element of a structure (exporter 0.6.0+, architecture §11.49): a shape character of GT's definition, the hatch kinds GT's own check took on it, its cells. */
  export interface StructureElement { ch?: string; hatches: ExportHatchKind[]; cells: Array<[number, number, number]> }
  // in StructureInfo, after `truncated?`:
  // optional addition (add-on 20): GT's own hatch rules; absent from older exports and for multiblocks the exporter could not probe
  elements?: StructureElement[];
  ```
- Produces (`src/server/pack/format.ts`): `export interface StructureElementLine { ch?: string; hatches: string[] }`; `StructureLine` gains `elements?: StructureElementLine[]; elementOf?: number[]`; `ManifestFile.counts` becomes `Partial<Record<ExportFileKey | 'hatchRules', number>>` (`hatchRules`: structure lines with `elements`, exporter 0.6.0+). The header's rule list gains, after "Structure coordinates": `- Structure elements (exporter 0.6.0+): elements[k] is one element of GT's structure definition — ch its shape character when the definition names one, hatches the hatch kinds (src/shared/gt/hatch-kinds.ts, in that order) GT's own structure check took on the element's probe cell; elementOf[i] is the element of blocks[i], or -1 for the controller and for a cell GT's check never reached or that two elements checked. The two come together or not at all.`

- [ ] **Step 1: Pre-flight**

Run from the worktree root:
```bash
git diff --name-only main...fix/hatch-rules 2>/dev/null | grep -E '^(src/shared/types/pack\.ts|src/shared/gt/hatch-kinds\.ts|src/server/pack/|src/server/cli/pack-info\.ts|src/server/export/validate\.ts|exporter-mod/)' ; echo "overlap check done"
for m in <repo>/data/export/*/manifest.json; do python3 -I -c "import json,sys; print(json.load(open(sys.argv[1]))['exporterVersion'])" "$m"; done | sort -V | tail -1
grep -n -o '^4[0-9]\. \*\*[^*]*\*\*' docs/superpowers/plans/2026-10-17-00-architecture.md
```
Expected: no file listed before `overlap check done` (else stop: Tasks 1–4 wait for the fix's merge, Task 5 Step 1); the newest exporter version is `0.5.0` or a `0.5.x` (else apply the version rule of the Global Constraints); entry 49 is not among the numbers listed (else stop and ask the controller for a number).

- [ ] **Step 2: Write the failing test** `tests/unit/shared/hatch-kinds.test.ts`

```ts
import { describe, expect, it } from 'vitest';
import { EXPORT_HATCH_CLASSES, EXPORT_HATCH_KINDS, EXPORT_HATCH_KIND_NAMES, exportKindOfClass, isExportHatchKind } from '../../../src/shared/gt/hatch-kinds.ts';

describe('export hatch kinds', () => {
  it('lists the 17 kinds of exporter 0.6.0 in their order, each with a name', () => {
    expect(EXPORT_HATCH_KINDS).toEqual(['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'energy_multi', 'energy_laser',
      'maintenance', 'muffler', 'dynamo', 'dynamo_multi', 'dynamo_laser', 'steam_input_bus', 'steam_output_bus', 'steam_hatch', 'data_access', 'coke_oven_hatch']);
    for (const k of EXPORT_HATCH_KINDS) expect(EXPORT_HATCH_KIND_NAMES[k]).toMatch(/\S/);
    expect(isExportHatchKind('steam_hatch')).toBe(true);
    expect(isExportHatchKind('quantum_hatch')).toBe(false);
  });

  it('finds the kind of a hatch by its class, and the steam hatch also by its name', () => {
    expect(exportKindOfClass('MTEHatchInputBus', 'hatch.input_bus.tier.01')).toBe('input_bus');
    expect(exportKindOfClass('MTEHatchMuffler', 'hatch.muffler.tier.09')).toBe('muffler');
    expect(exportKindOfClass('MTEHatchCustomFluidBase', 'hatch.steam.input.tier.00')).toBe('steam_hatch');
    expect(exportKindOfClass('MTEHatchCustomFluidBase', 'hatch.cryotheum.input.tier.00')).toBeNull();
    expect(exportKindOfClass('MTEHatchInputBusME', 'hatch.input_bus.me')).toBeNull();
    expect(EXPORT_HATCH_CLASSES.steam_hatch).toEqual({ cls: 'MTEHatchCustomFluidBase', metaPrefix: 'hatch.steam.' });
    expect(EXPORT_HATCH_CLASSES.coke_oven_hatch).toEqual({ cls: 'MTEHatchCokeOven' });
  });
});
```

- [ ] **Step 3: Run it to verify it fails**

Run: `npx vitest run tests/unit/shared/hatch-kinds.test.ts`
Expected: FAIL — cannot resolve `src/shared/gt/hatch-kinds.ts`.

- [ ] **Step 4: Implement** `src/shared/gt/hatch-kinds.ts`, the `pack.ts` and `format.ts` additions of the Interfaces block (types only besides `hatch-kinds.ts`).

- [ ] **Step 5: Run the test and the type check**

Run: `npx vitest run tests/unit/shared/hatch-kinds.test.ts && npm run typecheck`
Expected: PASS, and `tsc -b` with no output.

- [ ] **Step 6: Entry 49 and research §5.5**

Append to architecture §11, after the last entry: `49. **Hatch rules from the export** (spec §3.6; plan \`2026-10-20-20-hatch-export.md\`, add-on 20; amends §6.2, the wire rules of §11.7's \`format.ts\` and the hatch-rules fix's rule lookup):` followed by this plan's four change requests, each as one sentence group in their order (1 the export, 2 pack types, 3 where the layout's rules come from, 4 research). In `gt-mechanics.md` add `### 5.5 Hatch positions (exporter 0.6.0)` after §5.4's table: this plan's eight Evidence bullets with their `[jar]`/`[export]` tags, then one paragraph "The probe" — the structures section runs the controller's `checkStructure` once with the instrument on to learn which element checks each block, then for each element puts the lowest-id hatch of each of the 17 kinds on its first block that holds no GT machine, runs `checkStructure` again and counts the kind as taken when the hatch is found, by identity, in a collection field of the controller (a list of lists or a map of lists one level down too); the cell is restored after every probe; controllers that are no `MTEMultiBlockBase` and truncated structures are not probed; the probe has its own budget (`gtnhplanner.hatchProbeBudgetSeconds`, 120 s). §5.1's "Verdict" gains: `Hatch positions are not in a definition one can read; exporter 0.6.0 asks the controller's own check (§5.5).`

- [ ] **Step 7: Commit**

```bash
git add src/shared/gt/hatch-kinds.ts src/shared/types/pack.ts src/server/pack/format.ts tests/unit/shared/hatch-kinds.test.ts docs/superpowers/plans/2026-10-17-00-architecture.md docs/research/gt-mechanics.md
git commit -m "feat(pack): export hatch kinds and structure elements; docs: architecture entry 49, gt-mechanics 5.5

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Exporter helpers free of GregTech, JUnit, and the Java/TypeScript vocabulary check

**Files:**
- Create: `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/sections/HatchKinds.java`, `ElementGroups.java`, `ElementLine.java`, `HatchLists.java` (same package)
- Test: `exporter-mod/src/test/java/io/github/drukoz/gtnhplanner/export/sections/HatchKindsTest.java`, `ElementGroupsTest.java`, `ElementLineTest.java`, `HatchListsTest.java`; `tests/unit/shared/hatch-kinds-java.test.ts`

**Interfaces:**
- Consumes: Task 1's `EXPORT_HATCH_KINDS`, `EXPORT_HATCH_CLASSES` (for the vocabulary check only).
- Produces (package-private, no GregTech, Minecraft or Forge class in any signature or body; Gson's `JsonWriter` is allowed):
  ```java
  final class HatchKinds {
      static final class Kind { final String name; final String cls; final String metaPrefix; /* null when none */ Kind(String name, String cls, String metaPrefix) }
      /** The 17 kinds of the Global Constraints, in order, each written on one line as `new Kind("input_bus", "MTEHatchInputBus", null),`. */
      static final List<Kind> ALL;
      static final class Candidate { Candidate(int id, String cls /* simple class name */, String metaName) }
      /** Kind name → the lowest candidate id whose cls equals the kind's and whose metaName starts with its metaPrefix (when set); in ALL's order; kinds without a candidate are left out. */
      static LinkedHashMap<String, Integer> representatives(Iterable<Candidate> candidates);
  }
  final class ElementGroups {
      /** A 60-bit key of a world cell, distinct for every x, z in ±2^25 and y in 0..255: ((x & 0x3FFFFFF) << 34) | ((y & 0xFF) << 26) | (z & 0x3FFFFFF). */
      static long key(int x, int y, int z);
      /** Which element checked each recorded block (0 … blocks − 1); a block that two different elements checked is a conflict and belongs to none. */
      static final class Visits {
          Visits(int blocks);
          void visit(int block, Object element);      // identity; the same element again changes nothing
          Object elementAt(int block);                 // null: never visited, or a conflict
          int visited();                               // blocks visited at least once (conflicts included)
          int conflicts();                             // blocks visited by two or more elements
      }
      static final class Group { final Object element; final int[] blocks; /* ascending */ }
      /** One group per element, ordered by its first block; block `skip` (the controller's) belongs to none. */
      static List<Group> groups(Visits visits, int skip);
      /** The block a group is probed on: its first block that holds no GT machine (`isMte[b]` false), else its first block. */
      static int probeBlock(Group group, boolean[] isMte);
  }
  final class ElementLine {
      ElementLine(String ch /* null when unknown */, List<String> hatches /* in HatchKinds.ALL order */);
      /** Writes the members `"elements":[…]` (one object per element, `ch` left out when null) and `"elementOf":[…]` into the object `j` is in. */
      static void write(JsonWriter j, List<ElementLine> elements, int[] elementOf) throws IOException;
  }
  final class HatchLists {
      /** Whether a field of type Collection or Map, declared by `machine`'s class or any superclass, holds `probe` or `probeBase` by identity — also as an element of a collection or map value inside it. A class whose fields cannot be read is skipped and remembered. */
      static boolean holds(Object machine, Object probe, Object probeBase);
      /** Simple names of the classes whose fields could not be read, sorted. */
      static List<String> unreadable();
  }
  ```

- [ ] **Step 1: Write the failing JUnit tests** (JUnit 5 Jupiter, as `BatteryBuffersTest`; `org.junit.jupiter.api.Test` and `Assertions`, never `org.junit.Test`)

- `HatchKindsTest`: `ALL`'s names are the 17 of Task 1 in order, `ALL.get(14)` is `steam_hatch` / `MTEHatchCustomFluidBase` / `hatch.steam.`; `representatives` of the candidates `(41, "MTEHatchEnergy", "hatch.energy.tier.01")`, `(40, "MTEHatchEnergy", "hatch.energy.tier.00")`, `(967, "MTEHatchCustomFluidBase", "hatch.cryotheum.input.tier.00")`, `(968, "MTEHatchCustomFluidBase", "hatch.pyrotheum.input.tier.00")`, `(31040, "MTEHatchCustomFluidBase", "hatch.steam.input.tier.00")`, `(2711, "MTEHatchInputBusME", "hatch.input_bus.me")`, `(71, "MTEHatchInputBus", "hatch.input_bus.tier.01")`, `(70, "MTEHatchInputBus", "hatch.input_bus.tier.00")` equals the map `{input_bus=70, energy=40, steam_hatch=31040}` and iterates in that order.
- `ElementGroupsTest`: `key(8192, 128, 8192)`, `key(8193, 128, 8192)`, `key(8192, 129, 8192)`, `key(8192, 128, 8193)` and `key(-5, 0, -5)` are five different values. With `Visits(6)` and elements `A`, `B`, `C` (plain `Object`s): visit (0, A), (1, B), (2, A), (3, A), (3, B), (1, B), (5, C) → `elementAt(3)` null, `conflicts()` 1, `visited()` 5 (block 4 never visited); `groups(visits, 5)` = `[A: {0, 2}, B: {1}]` (C only on the skipped block); `probeBlock(A's group, {true, false, false, …})` is 2 and with every block an MTE is 0.
- `ElementLineTest`: in a `JsonWriter` over a `StringWriter`, `beginObject(); write(j, [("b", ["input_bus", "energy"]), (null, [])], {-1, 0, 1, 0}); endObject()` gives exactly `{"elements":[{"ch":"b","hatches":["input_bus","energy"]},{"hatches":[]}],"elementOf":[-1,0,1,0]}`.
- `HatchListsTest`: classes `static class Base { protected final List<Object> fromBase = new ArrayList<>(); }` and `static class Fake extends Base { private final List<List<Object>> byLayer = new ArrayList<>(); final Map<String, Object> byName = new HashMap<>(); Object loose; int count; }`; a probe `p = new Object()`, its base `q = new Object()`: `holds(fake, p, q)` false when empty; true after `fromBase.add(p)` (a superclass field); true for `byLayer` holding `[[], [p]]`; true for `byName.put("x", q)` (the base counts); true for `byName.put("y", Arrays.asList(p))` (a list inside a map); false when only `loose = p` (no collection type); false for `fromBase.add(new String("x"))` when the probe is `"x"` (identity, not equality); `unreadable()` empty.

- [ ] **Step 2: Write the failing vocabulary check** `tests/unit/shared/hatch-kinds-java.test.ts`

`it('keeps the exporter\'s hatch kinds equal to the planner\'s')`: read `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/sections/HatchKinds.java` (`readFileSync`), collect every `new Kind("<name>", "<cls>", null | "<prefix>")` in order with `/new Kind\("([a-z_]+)", "(\w+)", (?:null|"([^"]+)")\)/g` → equals `EXPORT_HATCH_KINDS.map((k) => ({ name: k, cls: EXPORT_HATCH_CLASSES[k].cls, metaPrefix: EXPORT_HATCH_CLASSES[k].metaPrefix }))` (a `null` prefix read as `undefined`).

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/unit/shared/hatch-kinds-java.test.ts; (export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.6.0 ./gradlew test --tests '*HatchKindsTest' --tests '*ElementGroupsTest' --tests '*ElementLineTest' --tests '*HatchListsTest')`
Expected: FAIL — `HatchKinds.java` missing (ENOENT), and the Java classes do not compile.

- [ ] **Step 4: Implement the four classes** per the Interfaces block. `HatchLists` caches per class the fields whose type is assignable to `Collection` or `Map` (`getDeclaredFields()` in try/catch per class of the hierarchy, `setAccessible(true)` per field in try/catch; a failing class goes into `unreadable` and is skipped from then on); it compares by `==`, descends exactly one level into collection elements and map values; it never calls `getMethods()` (the 0.5.0 crop export failed on that: it resolves every public signature and one names a client-only class on a server).

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run tests/unit/shared && (export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.6.0 ./gradlew test)`
Expected: PASS; Gradle `BUILD SUCCESSFUL` with every test of `exporter-mod/build/test-results/test/` passing.

- [ ] **Step 6: Commit**

```bash
git add exporter-mod/src tests/unit/shared/hatch-kinds-java.test.ts
git commit -m "feat(exporter): hatch kinds, element groups, element JSON and hatch-list search for the hatch probe

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The probe in the structures section, exporter 0.6.0

**Files:**
- Create: `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/sections/StructureVisits.java`, `HatchProbe.java`
- Modify: `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/sections/StructuresSection.java` (`Placed` keeps its `Block`; `export`, `build`, `write`), `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/ExporterMod.java` (register the listener), `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/Exporter.java` (the rules table gains "Structure elements", the wording of Task 1's `format.ts` rule)

**Interfaces:**
- Consumes: Task 2's `HatchKinds`, `ElementGroups`, `ElementLine`, `HatchLists`; StructureLib's `StructureLibAPI.enableInstrument/disableInstrument`, `StructureEvent.StructureElementVisitedEvent`, `StructureDefinition.getElements()`; GT's `MTEMultiBlockBase.checkStructure(boolean, IGregTechTileEntity)`, `MTEHatch`, `GregTechAPI.METATILEENTITIES`, `GregTechAPI.sBlockMachines`, `IGregTechTileEntity.setInitialValuesAsNBT`.
- Produces: the wire fields of entry 49 on every structure line the probe answered; `manifest.counts.hatchRules`; `public final class StructureVisits` with `public static final StructureVisits INSTANCE`, package-private `static final Object TOKEN`, `void start(World world, Map<Long, Integer> blockAt, ElementGroups.Visits visits)`, `void stop()`, `@SubscribeEvent public void onVisit(StructureEvent.StructureElementVisitedEvent e)`; `final class HatchProbe` with `HatchProbe(World world, Map<String, Integer> kinds, long budgetNanos)`, `Result probe(int id, IConstructable machine, List<StructuresSection.Placed> blocks)` (null when the machine gets no rules), `Result skip(int id)` (a truncated structure: counted, returns null), `boolean failedLast()` (the last `probe` threw outside a single check), `int probed()`, `void summarize(ExportContext ctx)`; `static final class Result { final List<ElementLine> elements; final int[] elementOf; }`.

`StructureVisits` (short and safety-critical, so as written here):
```java
@SubscribeEvent
public void onVisit(StructureEvent.StructureElementVisitedEvent e) {
    try {
        ElementGroups.Visits v = visits;
        if (v == null || e.getInstrumentIdentifier() != TOKEN || e.getWorld() != world) return;
        Integer block = blockAt.get(ElementGroups.key(e.getX(), e.getY(), e.getZ()));
        if (block != null) v.visit(block, e.getElement());
    } catch (Throwable ignored) {
        // never into StructureLib's walk: FML's EventBus.post logs a listener's throwable and rethrows it
    }
}
```

`HatchProbe.probe` (not determined by a test; the order matters for determinism). `deadline` = the time of the first `probe` call + `budgetNanos`:
```text
if machine is not an MTEMultiBlockBase        → remember id under "not MTEMultiBlockBase", return null
if the budget is used up (now > deadline)     → remember id under "budget", return null
mb, base = mb.getBaseMetaTileEntity(); controller = the index of the block whose mte is this id
blockAt = key(pos) → index for every recorded block; visits = new Visits(blocks.size())
StructureVisits.INSTANCE.start(world, blockAt, visits); StructureLibAPI.enableInstrument(StructureVisits.TOKEN)
try mb.checkStructure(true, base) finally { StructureLibAPI.disableInstrument(); StructureVisits.INSTANCE.stop() }
if visits.visited() == 0                      → remember id under "no cell reached", return null
groups = ElementGroups.groups(visits, controller); count visits.conflicts() and the unreached blocks
   (blocks other than the controller never visited) for the summary
chars  = for a StructureDefinition: identity map element → its smallest character among getElements(); else empty
isMte  = per block: its recorded mte != null
for each group k (in order): cell = blocks[probeBlock(group, isMte)]; takes = []
   for each (kind, hatchId) of kinds (in ALL order):
      if now > deadline → remember id under "budget"; return null   (the cell holds its own block again: every probe
                          restores it; this machine and every later one get no rules)
      try   { probe = placeHatch(cell, hatchId); mb.checkStructure(true, base);
              if HatchLists.holds(mb, probe, probe.getBaseMetaTileEntity()) takes.add(kind) }
      catch (Throwable t) { count one check error for this id (keep the first message with its kind) }
      finally { restore(cell) }
   elements.add(new ElementLine(chars.get(group.element) as a String or null, takes)); elementOf[b] = k for b in group.blocks
elementOf = -1 everywhere else (the controller, unreached and conflicting blocks); probed += 1
return new Result(elements, elementOf)
anything thrown outside the per-check try (the baseline check, grouping, a restore) → failedLast = true,
   remember id under "failed" with the message, return null
placeHatch(cell, id): setBlock(cell, Blocks.air, 0, 2); setBlock(cell, GregTechAPI.sBlockMachines,
   METATILEENTITIES[id].getTileEntityBaseType(), 2) or throw; the IGregTechTileEntity there gets
   setInitialValuesAsNBT(null, (short) id); return its getMetaTileEntity()
restore(cell): setBlock(cell, Blocks.air, 0, 2); then the recorded block — a GT machine through placeHatch(cell, mte),
   else setBlock(cell, block, meta, 2)
```
Air first, both ways: `World.setBlock` with the block and meta already there changes nothing and would leave the old tile entity.

`StructuresSection` changes:
- `Placed` gains `final Block block` (set in `record`), package-private so `HatchProbe` reads `pos`, `block`, `meta`, `mte`.
- `export()`: after `multiblocks(…)`, `kinds = HatchKinds.representatives(candidates)` with one `Candidate(id, m.getClass().getSimpleName(), m.getMetaName())` per `METATILEENTITIES[id] instanceof MTEHatch`, in id order; one warning `structures: no hatch of class <cls> in this pack, hatch kind <name> not probed` per kind of `ALL` missing from it; `budgetNanos` from `Integer.getInteger("gtnhplanner.hatchProbeBudgetSeconds", 120)`; after the loop `ctx.count("hatchRules", probe.probed())` and `probe.summarize(ctx)`.
- `build(…)` gains the `HatchProbe`: after the air cells, `Result rules = truncated ? probe.skip(id) : probe.probe(id, machine, blocks)`; `write` writes `ElementLine.write(j, rules.elements, rules.elementOf)` after `air` when `rules != null`; when `probe.failedLast()`, the cells to clear are `nonAir(world, BOX)`, as for a failed build.
- `summarize` writes one warning per non-empty group, ids through the section's `listIds` (first 20, then `…`): `structures: hatch probe skipped for <n> multiblocks whose controller is not an MTEMultiBlockBase: <ids>`; `structures: hatch probe skipped for <n> truncated structures: <ids>`; `structures: GT's structure check of <n> multiblocks reached no cell, no hatch rules: <ids>`; `structures: <c> cells of <n> multiblocks were checked by two elements and take no hatch: <ids>`; `structures: <c> cells of <n> multiblocks were never reached by GT's structure check and take no hatch: <ids>`; `structures: <c> hatch probe checks threw and count as not taken, in <n> multiblocks: <ids>; first: <id> <kind>: <message>`; `structures: the hatch probe failed for <n> multiblocks, no hatch rules: <ids>; first: <id>: <message>`; `structures: hatch probe budget of <s> s (gtnhplanner.hatchProbeBudgetSeconds) used up, <n> multiblocks without hatch rules: <ids>`; `structures: fields of <names> could not be read; hatches filed there count as not taken` (`HatchLists.unreadable()`); and `ExporterMod.LOG.info("structures: hatch probes on {} multiblocks: {} checks in {} ms", …)`.
- `ExporterMod.onServerStarted`, inside the `exportDir` branch after the trigger: `MinecraftForge.EVENT_BUS.register(StructureVisits.INSTANCE);` (registering there, in an FML lifecycle event, gives the listener its mod container; registering later logs an FML error).

There is no failing unit test first in this task: these two classes and the section call GregTech, StructureLib and a server world, which only a running server has. Task 2 tests their pure parts; Task 7's export and its acceptance are this task's test.

- [ ] **Step 1: Implement** `StructureVisits`, `HatchProbe` and the changes above.

- [ ] **Step 2: Build, test and check the jar**

Run (worktree root):
```bash
(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.6.0 ./gradlew test assemble) \
  && exporter-mod/scripts/check-reobf.sh exporter-mod/build/libs/gtnhplannerexport-0.6.0.jar \
  && javap -v -cp exporter-mod/build/libs/gtnhplannerexport-0.6.0.jar io.github.drukoz.gtnhplanner.export.sections.StructureVisits | grep -c 'Lcpw/mods/fml/common/eventhandler/SubscribeEvent;' \
  && javap -v -p -cp exporter-mod/build/libs/gtnhplannerexport-0.6.0.jar io.github.drukoz.gtnhplanner.export.sections.HatchProbe io.github.drukoz.gtnhplanner.export.sections.StructureVisits io.github.drukoz.gtnhplanner.export.sections.StructuresSection | grep -c 'net/minecraft/client' \
  ; unzip -p exporter-mod/build/libs/gtnhplannerexport-0.6.0.jar mcmod.info | grep -c '"version": "0.6.0"'
```
Expected: `BUILD SUCCESSFUL`, `reobf OK: <n> classes`, then `1` (the listener is annotated), `0` (no client class referenced), `1` (the jar says 0.6.0). The jar is not installed anywhere by the implementer; Task 7 hands it to the controller.

- [ ] **Step 3: Commit**

```bash
git add exporter-mod/src
git commit -m "feat(exporter): 0.6.0 probes every multiblock's elements with GT's own structure check and writes the hatch kinds each takes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Loader, `pack:info` and the validation summary

**Files:**
- Modify: `src/server/pack/machines.ts` (`toStructure`), `src/server/pack/load.ts` (`readStructures` passes `ctx`), `src/server/cli/pack-info.ts` (`Machines:` line), `src/server/export/validate.ts` (`summarize`)
- Test: `tests/unit/pack/machines.test.ts`, `tests/unit/cli/pack-info.test.ts`, `tests/unit/export/validate.test.ts`

**Interfaces:**
- Consumes: Task 1's types and `isExportHatchKind`.
- Produces: `toStructure(line: StructureLine, ctx: LoadContext, n: number): StructureInfo` (`n` the line number, for warnings) — without `elements` and `elementOf` exactly as today (no `elements` key); with both: `elements[k] = { ch?, hatches: the known kinds of line.elements[k].hatches in their order, cells: the positions of the blocks i with elementOf[i] === k, in block order }`; throws a `RangeError` (the loader's `ExportFormatError` with file and line) when only one of the two is present, when `elementOf.length !== blocks.length`, when a value is not an integer in `[-1, elements.length)`, or when the controller's block has a value other than −1; unknown kinds give one `ctx.warn` per line: `structures.jsonl.gz:<n>: structure <id>: hatch kinds unknown to this planner ignored: <k>, <k>`. `pack:info`'s line: `Machines:   <n> (<m> multiblocks, <s> with structure, <h> with hatch rules)`, the last part only when `h > 0`; the validation summary: `structures <s> (<h> with hatch rules)` only when `h > 0` (`h` = machines whose structure has `elements`).

- [ ] **Step 1: Write the failing tests**

- `machines.test.ts`, with `const casing = { id: 'gregtech:gt.blockcasings', meta: 11 }`, `const ctrl = { id: 'gregtech:gt.blockmachines', meta: 0, mte: 1000 }`, `const machines = [{ id: 1000, name: 'multimachine.blastfurnace', cls: 'x', item: null, kind: 'multiblock' as const }]` and `const line = { id: 1000, size: [3, 2, 1], controller: [1, 0, 0], palette: [casing, ctrl], blocks: [[0, 0, 0, 0], [1, 0, 0, 1], [2, 0, 0, 0], [1, 1, 0, 0]], air: [] }`:
  - `it('reads the hatch rules of a structure (exporter 0.6.0)')`: `{ ...line, elements: [{ ch: 'b', hatches: ['input_bus', 'energy'] }, { ch: 'f', hatches: [] }], elementOf: [0, -1, 0, 1] }` → `structure.elements` equals `[{ ch: 'b', hatches: ['input_bus', 'energy'], cells: [[0, 0, 0], [2, 0, 0]] }, { ch: 'f', hatches: [], cells: [[1, 1, 0]] }]` and `pack.warnings` is `[]`.
  - `it('keeps an element without a character and a structure without rules as they were')`: elements `[{ hatches: ['muffler'] }]`, elementOf `[0, -1, -1, -1]` → `'ch' in structure.elements[0]` false; the sample export's EBF structure has no `elements` key (`'elements' in structure` false).
  - `it('ignores hatch kinds it does not know, with one warning')`: hatches `['input_bus', 'quantum_hatch', 'flux_hatch']` → `['input_bus']`; `pack.warnings` equals `['structures.jsonl.gz:1: structure 1000: hatch kinds unknown to this planner ignored: quantum_hatch, flux_hatch']`.
  - `it('rejects hatch rules that do not fit the blocks')`: each of `elementOf: [0, -1, 0]`; `elementOf: [0, -1, 0, 2]` with two elements; `elements` without `elementOf`; `elementOf` without `elements`; `elementOf: [0, 0, 0, 1]` (the controller in an element) → `makePack` rejects with `{ name: 'ExportFormatError', file: 'structures.jsonl.gz', line: 1 }`.
- `pack-info.test.ts`: `it('counts the multiblocks with hatch rules')` — the sample spec whose EBF structure line gets `elements: [{ ch: 'b', hatches: ['input_bus'] }]` and `elementOf: [0, -1, 0]` → stdout contains `1 with structure, 1 with hatch rules)`.
- `validate.test.ts`: `it('names the structures with hatch rules in the summary')` — the same EBF line, `fillerMaps: 140` → `r.summary` contains `structures 1 (1 with hatch rules) · veins 3`; the existing summary expectation stays as it is (no rules, no parentheses).

- [ ] **Step 2: Run them to verify they fail**

Run: `npx vitest run tests/unit/pack/machines.test.ts tests/unit/cli/pack-info.test.ts tests/unit/export/validate.test.ts`
Expected: FAIL — `elements` missing on the structure, no "with hatch rules".

- [ ] **Step 3: Implement** `toStructure(line, ctx, n)` and the two summaries per the Interfaces block; `readStructures` calls `toStructure(line, ctx, n)`.

- [ ] **Step 4: Run them to verify they pass, then the whole server suite**

Run: `npm run typecheck && npx vitest run tests/unit/pack tests/unit/cli tests/unit/export tests/unit/shared`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/pack src/server/cli/pack-info.ts src/server/export/validate.ts tests/unit/pack tests/unit/cli tests/unit/export
git commit -m "feat(pack): load the export's hatch rules into StructureInfo.elements; pack:info and the summary count them

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: The layout uses the export's hatch rules first (after the hatch-rules fix is merged)

**Files:**
- Create: `src/server/layout/hatch-export.ts`, `tests/helpers/hatch-export-fixtures.ts`, `tests/unit/layout/hatch-export.test.ts`
- Modify: the hatch-rules fix's rule module (its draft: `src/server/layout/hatch-rules.ts`; Step 1 finds the merged name), `src/server/layout/arrange.ts` (`multiblockUnit`)

**Interfaces:**
- Consumes (checked in Step 1, by role; the names are the fix's draft): the table lookup `hatchRuleFor(m: Machine): HatchRule | null`; `ruleFits(rule, controller, size, positions): boolean` (the row's shape fits the exported structure); `elementMap(rule, controller, size): Map<string, string>` (posKey → shape character); `elementTakes(rule, ch, kind): boolean`; `ruleTakes(rule, kind): boolean`; `rulePower(rule)` (`'eu' | 'steam' | …`); `HatchRule` with its notes (`layerOutputs`, `casingMin`, `classes`, `needs`, `fluidInputSlots`, `byHand`); `growLayers(shape, extra)`, `multiblockUnit(…)`, `ruledHatches(…)`, `genericHatches(…)` in `arrange.ts`; `HatchKind` with `'muffler'` and `'steam'`; `UnitCell.face`, `UnitCell.fluid`; warning codes `hatch_rules_unknown`, `hatch_not_taken`, `hatch_cells_short`, `steam_machine`; Task 4's `StructureInfo.elements`.
- Produces (`src/server/layout/hatch-export.ts`):
  ```ts
  /** The export kinds that give each layout kind, best first (architecture §11.49). */
  export const KIND_SOURCES: Readonly<Record<HatchKind, readonly ExportHatchKind[]>> = {
    input_bus: ['input_bus', 'steam_input_bus'], output_bus: ['output_bus', 'steam_output_bus'], input_hatch: ['input_hatch'],
    output_hatch: ['output_hatch'], energy: ['energy'], maintenance: ['maintenance'], muffler: ['muffler'], steam: ['steam_hatch'],
  };   // a HatchKind the merged fix adds beyond these maps to the export kind of its name when there is one, else []
  export interface ExportedCells {
    charOf: ReadonlyMap<string, string>;                 // posKey → the element's `ch`, else `#<element index>`
    takes: ReadonlyMap<string, ReadonlySet<HatchKind>>;   // character → layout kinds one of its export kinds gives
    anywhere: ReadonlySet<ExportHatchKind>;              // every export kind some element takes
    classes: Partial<Record<'input_bus' | 'output_bus', string>>;   // 'MTEHatchSteamBusInput' / 'MTEHatchSteamBusOutput' when no element takes the plain bus but one takes the steam bus
    height: number;                                      // the exported structure's height
  }
  export function exportedCells(m: Machine): ExportedCells | null;          // null without structure.elements
  /** The cells of a tower grown by `extra` layers, as `growLayers` grows its shape: rows below the top keep their character, the top moves up by `extra`, each inserted layer copies layer 1. */
  export function grownCells(cells: ExportedCells, extra: number): ExportedCells;   // extra ≤ 0 or height < 3: unchanged
  export function exportedPower(cells: ExportedCells): 'eu' | 'steam' | 'none';    // energy/energy_multi/energy_laser → eu; else steam_hatch/steam buses → steam; else none
  ```
- Produces (the rule module): `HatchRule.exported?: ExportedCells` (optional addition); `hatchRulesOf(m: Machine): { rule: HatchRule; notesUnfit: boolean } | null`. Behaviour: `cells = exportedCells(m)`, `row = hatchRuleFor(m)`, `fits = row !== null && ruleFits(row, structure.controller, structure.size, block positions)`; with `cells`: `{ rule: { ...(fits ? row : the empty rule), exported: cells, classes: { ...(fits ? row.classes : {}), ...cells.classes } }, notesUnfit: row !== null && !fits }` (the empty rule: the fix's `HatchRule` with every table part empty — no shape, no element table, no notes); without `cells`: `fits ? { rule: row, notesUnfit: false } : null`. For a rule with `exported`: `ruleFits` is true; `elementMap(rule, controller, size)` is `grownCells(rule.exported, size[1] − rule.exported.height).charOf`; `elementTakes(rule, ch, kind)` is `rule.exported.takes.get(ch)?.has(kind) ?? false`; `ruleTakes(rule, kind)` is true when some character takes it; `rulePower(rule)` is the row's when it fitted, else `exportedPower(rule.exported)`.
- Produces (`arrange.ts`): `multiblockUnit` takes its rule from `hatchRulesOf(m)` (null → `hatch_rules_unknown` and the generic placement, as before); `notesUnfit` → warning `hatch_notes_unfit` with text `` `${m.name}: the planner's notes for this machine do not fit its exported structure, so its hatches follow GregTech's rules from the export alone — check in game that it forms` ``; an electric unit whose `rule.exported.anywhere` has `energy_multi` or `energy_laser` but not `energy` → warning `hatch_energy_exotic` with text `` `${m.name} takes only multi-amp or laser energy hatches in GregTech: place one by hand` `` (it then gets no energy hatch, as the fix leaves an energy hatch no cell takes).
- Produces (`tests/helpers/hatch-export-fixtures.ts`): `interface ElementSpec { ch?: string; hatches: ExportHatchKind[]; where: (pos: Vec3) => boolean }`; `withElements(structure: StructureInfo, specs: readonly ElementSpec[]): StructureInfo` (a copy whose element k holds the non-controller blocks whose first matching spec is k, in block order; blocks no spec matches belong to none); `FRONT_BOX_ID = 4242`, `STEAM_BOX_ID = 4243`; `FRONT_BOX_STRUCTURE` (3×2×3 of `gregtech:gt.blockcasings4`@1, controller at (1, 0, 0), no air); `FRONT_BOX_ELEMENTS` = `a` (y 0, z 0) `['input_bus', 'output_bus']`, `k` (y 0, z 2) `['energy', 'maintenance']`, `u` (y 1, z 2) `['input_hatch', 'output_hatch']`, `c` (the rest) `[]`; `hatchExportPack(): Pack` = `layoutPack()` plus the multiblocks 4242 (`kind: 'multiblock'`, cls `gregtech.api.metatileentity.implementations.MTETestFrontBox`, structure `FRONT_BOX_STRUCTURE` without elements) and 4243 (the same, `kind: 'steam'`, cls `…MTETestSteamBox`), the hatches 31046 `MTEHatchSteamBusInput` (`hatch.input_bus.tier.steam`, tier 0), 31047 `MTEHatchSteamBusOutput` (`hatch.output_bus.tier.steam`), 31040 `MTEHatchCustomFluidBase` (`hatch.steam.input.tier.00`), the fluids `fluid:t1`…`fluid:t4` ("Test Fluid 1"…"4"), and — unless the fix's fixtures have them — the Muffler Hatch (LV) 91 (`MTEHatchMuffler`, `hatch.muffler.tier.01`, tier 1) and the Distillation Tower 1126 (`kind: 'multiblock'`, cls `gregtech.common.tileentities.machines.multi.MTEDistillationTower`, structure `TOWER_STRUCTURE`: 3×3×3 of `gregtech:gt.blockcasings4`@1 with the controller at (1, 0, 0) and the air cell (1, 1, 1)).

- [ ] **Step 1: Take in main and check the fix's names**

Run (worktree root): `git merge main` (the merge must contain `fix/hatch-rules`; `git branch --contains fix/hatch-rules | grep -c main` → `1`), then
`grep -rn -E "function (hatchRuleFor|ruleFits|elementMap|elementTakes|ruleTakes|rulePower|growLayers|multiblockUnit|ruledHatches|genericHatches)\b|interface HatchRule\b|'hatch_rules_unknown'|'hatch_not_taken'|'hatch_cells_short'" src/server/layout`
and `npx vitest run tests/unit/layout`.
Expected: every role found (record `name → file:line` for the commit message; where the merged fix named a role differently, use its name with the same role everywhere below); the layout suite passes. A role that is missing altogether → stop and report to the controller.

- [ ] **Step 2: Write the failing tests** `tests/unit/layout/hatch-export.test.ts`, with `hatchExportPack()`, `makePlan` and `unitsFromPlan`; `OX = 'fluid:oxygen'`, `MI = 'fluid:molten.iron'`; the FRONT_BOX step `{ id: 'f', mteId: 4242, count: 1, tier: 1, euPerTick: 30, inputs: [['t:in@0', 1], [OX, 1000]], outputs: [['t:dust@0', 1], [MI, 144]] }`; the EBF step `{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1], [MI, 144]] }`; "hatch cells" = the unit's cells with `hatch` set:

1. `it('puts every hatch on a cell whose element GregTech lets take it')` — FRONT_BOX with `FRONT_BOX_ELEMENTS` → its buses at y 0, z 0; energy and maintenance at y 0, z 2; input and output hatch at y 1, z 2; no warning `hatch_rules_unknown`, `hatch_cells_short` or `hatch_not_taken`.
2. `it('follows the export where it disagrees with the hand table')` — the EBF with elements `b` (y 0) `['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'maintenance']`, `C` (y 1–2) `[]`, `m` ((1, 3, 1)) `['muffler']`, `f` (the rest of y 3) `[]` → the output hatch's y is 0; no `hatch_rules_unknown`.
3. `it('uses the hand table for an export without hatch rules')` — the EBF as the fix's fixtures have it, no elements → the output hatch's y is 3 (the top ring takes output hatches); no `hatch_rules_unknown`.
4. `it('warns and places generically when neither the export nor the table knows the machine')` — FRONT_BOX without elements → one `hatch_rules_unknown` for step `f`.
5. `it('picks a steam bus and a steam hatch where GregTech takes only those')` — STEAM_BOX with `a` `['steam_input_bus', 'steam_output_bus']`, `k` `['steam_hatch']`, the rest `[]`, the step `{ id: 's', mteId: 4243, inputs: [['t:in@0', 1]], outputs: [['t:dust@0', 1]] }` → the input bus cell's `block.mteId` 31046, the output bus's 31047, a `steam` cell holding 31040 at y 0, z 2, no `energy` cell; warning codes include `steam_machine` and not `hatch_rules_unknown`.
6. `it('grows the exported cells with a taller tower')` — pure: a 3×3×3 tower's cells (y 0 `b` but the controller (1, 0, 0); y 1 ring `l`, centre absent; y 2 ring `l`, centre `c`), `grownCells(…, 2)` → height 5; y 1, 2 and 3 rings `l`; (1, 2, 1) and (1, 3, 1) absent; y 4 ring `l` and (1, 4, 1) `c`; y 0 unchanged; `grownCells(…, 0)` returns the same maps.
7. `it('says a needed hatch the export takes nowhere is not taken')` — FRONT_BOX with `u` `['output_hatch']` only → a `hatch_not_taken` warning whose text contains `input hatch`; no `input_hatch` cell.
8. `it('says when a machine takes only multi-amp or laser energy hatches')` — FRONT_BOX with `k` `['energy_multi', 'maintenance']` → one `hatch_energy_exotic`, no `energy` cell, no `hatch_not_taken` naming `energy`.
9. `it('gives an element without a character its own')` — `FRONT_BOX_ELEMENTS` without `ch` → the hatch cells (pos, kind, block) equal test 1's.
10. `it('places hatches only on the cells the export covers')` — FRONT_BOX with only `a` (y 0, z 0) `['input_bus', 'output_bus']` and `k` on the one cell (0, 0, 2) `['energy', 'maintenance']` (no other element), a step with items only → every hatch cell is (0, 0, 0), (2, 0, 0) or (0, 0, 2); exactly one of energy and maintenance is placed, at (0, 0, 2), and a `hatch_cells_short` warning names the other.
11. `it('keeps each multiblock of one line on its own source')` — `makePlan([FRONT_BOX step with FRONT_BOX_ELEMENTS, { id: 'a2', mteId: IDS.AIR_MULTI, count: 1, inputs: [['t:dust@0', 1]] }])` → exactly one `hatch_rules_unknown`, with `stepId` `a2`.
12. `it('keeps the muffler GregTech requires on its cell')` — the EBF with a muffler (91) block at (1, 3, 1) and the elements of test 2 except `f` (rest of y 3) `['output_hatch']` → (1, 3, 1) has `hatch: 'muffler'`; no other cell is a muffler; the output hatch is not at (1, 3, 1).
13. `it('drops table notes that do not fit the exported structure, and says so')` — the EBF structure with a fifth layer of casings on top (3×5×3) and elements `b` (y 0) as in test 2, `z` (the rest) `[]` → one `hatch_notes_unfit`, no `hatch_rules_unknown`, every hatch cell at y 0.
14. `it('builds a taller tower by the exported rules')` — the Distillation Tower 1126 (the fix's row applies) with `TOWER_STRUCTURE` (or the fix's tower fixture) and elements `b` (y 0) `['input_bus', 'output_bus', 'input_hatch', 'energy', 'maintenance']`, `l` (y ≥ 1, ring) `['output_hatch', 'energy', 'maintenance']`, `c` ((1, 2, 1)) `['output_hatch', 'output_bus', 'maintenance']`; the step `{ id: 'd', mteId: 1126, count: 1, tier: 3, euPerTick: 480, inputs: [['t:in@0', 1]], outputs: [['fluid:t1', 100], ['fluid:t2', 100], ['fluid:t3', 100], ['fluid:t4', 100]] }` → the unit's size is [3, 5, 3]; one output hatch on each of y 1, 2, 3, 4; each on a cell whose `grownCells(…, 2)` character takes `output_hatch`.
15. `it('reads the export elements into layout kinds')` — pure: `exportedCells` of a FRONT_BOX copy with elements `{ ch: 'a', hatches: ['input_bus', 'steam_input_bus', 'energy'], where: y 0 }` and `{ hatches: ['steam_output_bus'], where: y 1 }` → `charOf.get(posKey([0, 0, 0]))` `'a'`, `charOf.get(posKey([0, 1, 0]))` `'#1'`; `takes.get('a')` = {`input_bus`, `energy`}; `takes.get('#1')` = {`output_bus`}; `classes` = `{ output_bus: 'MTEHatchSteamBusOutput' }`; `exportedCells` of a machine without elements is `null`.
16. `it('tells the power from the export')` — `exportedPower` of cells taking `energy` → `'eu'`, only `energy_multi` → `'eu'`, only `steam_hatch` → `'steam'`, only `coke_oven_hatch` → `'none'`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/unit/layout/hatch-export.test.ts`
Expected: FAIL — `hatch-export.ts` missing.

- [ ] **Step 4: Implement** `hatch-export.ts`, the rule module's additions and `multiblockUnit`'s lookup per the Interfaces block.

- [ ] **Step 5: Run them, then the layout and planner suites**

Run: `npm run typecheck && npx vitest run tests/unit/layout tests/unit/planner tests/unit/projector`
Expected: PASS — the fix's own tests unchanged (their structures carry no elements).

- [ ] **Step 6: Commit**

```bash
git add src/server/layout tests/helpers/hatch-export-fixtures.ts tests/unit/layout/hatch-export.test.ts
git commit -m "feat(layout): hatches by GregTech's own rules from the export first, the table's notes on top, the table alone for older exports

<the role → name mapping of Step 1>

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Every logistics mode with export-ruled multiblocks

**Files:**
- Test: `tests/unit/layout/hatch-export-modes.test.ts`

**Interfaces:**
- Consumes: Task 5's fixtures and lookup; `layoutLine`, `emptyScan` (`src/server/layout/layout.ts`), `makePlan`, `makeProject`, `IDS` (`tests/helpers/layout-fixtures.ts`), `step` (`src/shared/layout/geometry.ts`).
- Produces: nothing new; `MODES = ['direct', 'routed', 'ae2', 'enderio'] as const`.

- [ ] **Step 1: Write the tests**

1. `it.each(MODES)('lays the EBF out the same from export rules as from the table when they agree (%s)')` — the EBF with elements that say exactly what the merged fix's EBF row says, character by character (read the row; for GT 5.09.54.183: `b` the six kinds, `f` `['output_hatch']`, `m` `['muffler']` when the fixture's top centre is a muffler, `C` `[]`), the line `makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 1]] }, the EBF step of Task 5])` (chained flows) → `layoutLine(pack, plan, emptyScan(), makeProject({ logistics: mode }))` with the elements deep-equals the one without them.
2. `it.each(MODES)('connects an export-ruled multiblock in %s mode')` — FRONT_BOX with `FRONT_BOX_ELEMENTS`, the line `makePlan([{ id: 'm', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 1]] }, { id: 'f', mteId: 4242, count: 1, tier: 1, euPerTick: 30, inputs: [['t:dust@0', 1], [OX, 1000]], outputs: [['t:ingot@0', 1], [MI, 144]] }], { flows: [raw → m `t:in@0`, m → f `t:dust@0`, raw → f OX, f → out `t:ingot@0`, f → out MI] })` (every flow `perSecond: 1`) → no warning `hatch_rules_unknown`, `hatch_cells_short` or `route_failed`; for every layout block of step `f` with role `hatch` whose machine's class is a bus, a fluid hatch or an energy hatch, the layout block at `step(b.pos, b.facing)` exists and its role is one of `pipe`, `chip_pipe`, `interface`, `chest` (a bus: the mode's item part, Project Red pipe, ME interface or conduit), `pipe` (a fluid hatch: GT fluid pipe or ender fluid conduit) or `cable` (the energy hatch).

- [ ] **Step 2: Run them**

Run: `npx vitest run tests/unit/layout/hatch-export-modes.test.ts`
Expected: PASS — these pin, mode by mode, what Task 5 built, so they pass at once. A failure in one mode is a defect of that mode's hookup to a hatch port: fix it in the mode with a unit test in its own test file, or, when it lies in the merged fix's port logic, stop and report it to the controller with the failing mode and block.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/layout/hatch-export-modes.test.ts
git commit -m "test(layout): export-ruled multiblocks in every logistics mode

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: One re-export, the real-data acceptance, README

**Files:**
- Create: `tests/helpers/real-corpus.ts` (`REAL_CORPUS` and `CORPUS_VARIANTS`, moved unchanged from `tests/unit/planner/real-corpus.test.ts`, which then imports them), `tests/unit/layout/real-hatch-export.test.ts`
- Modify: `tests/unit/planner/real-corpus.test.ts` (imports only), `README.md` ("Export your pack": one sentence after the 0.4.0 one; "Line layout and 3D view": a **Hatches** bullet), `docs/research/gt-mechanics.md` §5.5 (the measured lines)
- Local only, never committed: `data/` (symlinks and `real-config.json`), `docs/local/export-runs.md`

**Interfaces:**
- Consumes: everything above; `planLine`, `emptyContext` (`src/server/planner/plan.ts`), `defaultSettings`, `unitsFromPlan`, `layoutLine`, `emptyScan`, `makeProject`, `hatchRuleFor`/`ruleFits`/`elementMap`/`elementTakes` (the fix's names from Task 5 Step 1), `exportedCells`, `KIND_SOURCES`, `exportKindOfClass`.
- Produces: the 0.6.0 export (activated only in the worktree's `data/real-config.json`), its record, the acceptance test.

- [ ] **Step 1: Build the jar for the controller**

Run Task 3 Step 2's command again on the final branch, then `shasum exporter-mod/build/libs/gtnhplannerexport-0.6.0.jar`.
Expected: as in Task 3; report the jar's path and sha1 to the controller.

- [ ] **Step 2: Controller step (not the implementer's) — the one re-export on the APFS clone**

From the worktree root, once:
```bash
mkdir -p data && for d in export assets; do [ -e data/$d ] || ln -s <repo>/data/$d data/$d; done
python3 -I -c "import json,os; c=json.load(open('<repo>/data/config.json')); json.dump({'dataDir': os.path.abspath('data'), 'serverFolder': c['serverFolder'], 'activeExportId': c['activeExportId'], 'host': '127.0.0.1', 'port': 18800}, open('data/real-config.json','w'), indent=2)"
pgrep -f lwjgl3ify-forgePatches.jar; lsof -nP -iTCP:25566 -sTCP:LISTEN; mkdir -p .local && touch .local/run-start.marker
GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npm run export -- --jar exporter-mod/build/libs/gtnhplannerexport-0.6.0.jar
```
(only `serverFolder` and `activeExportId` are read from main's config; nothing is printed from it). Expected: the live server's pid before and after is the same, port 25566 free before; exit 0; one new folder in `data/export` (nothing existing changes), activated only in `data/real-config.json`; its manifest: `exporterVersion` `0.6.0`, `counts.hatchRules` ≥ 300, `failedSections` `[]` (or only sections the controller already knows to fail, such as add-on 17's `crops` before its fix is in main), `sectionMillis.structures` recorded; `export-run.log` has `structures: hatch probes on <n> multiblocks: <m> checks in <t> ms`. Afterwards `find <serverFolder>/mods <serverFolder>/config <serverFolder>/server.properties -newer .local/run-start.marker` prints nothing and the clone is gone. Write `docs/local/export-runs.md`'s new section: date, export id, jar sha1, wall clock (clone, boot, export, total), `sectionMillis`, every count, the probe log line, every `structures:` warning, the live-server checks. One run, never retried: a failed run is recorded and handed back. Main's active export is switched later, by the controller, only on the user's yes.

- [ ] **Step 3: Write the real-data acceptance** `tests/unit/layout/real-hatch-export.test.ts` (`describe.skipIf(process.env.GTNH_LOCAL !== '1')`, the pack loaded once in `beforeAll` with a 300 s timeout; `UNPROBED = new Set([140])`, the Bricked Blast Furnace; `takes(mteId, ch)` = the `hatches` of that machine's element with that character, failing when there is none):

1. `it('carries GregTech\'s hatch rules')` — `manifest.exporterVersion` is `'0.6.0'`; `manifest.counts.hatchRules` ≥ 300 and equals the number of machines whose structure has `elements`; machine 140 has a structure and no `elements`; 3013 and 15411 have none; logs that count and every manifest warning that starts `structures:`.
2. `it('matches the definitions read from the jars')` — EBF 1000: `takes('b')` ⊇ input_bus, output_bus, input_hatch, output_hatch, energy, maintenance; `takes('f')` contains output_hatch and none of input_bus, output_bus, input_hatch, energy, maintenance; `takes('m')` = `['muffler']`; `takes('C')` = `[]`. Large Chemical Reactor 1169: `c` and `x` ⊇ the six; `P` = `[]`. Oil Cracking Unit 1160: `l` and `r` ⊇ input_hatch, output_hatch, energy, maintenance; `m` ⊇ input_hatch, input_bus, energy, maintenance and lacks output_hatch. Distillation Tower 1126: `b` ⊇ input_bus, output_bus, input_hatch, energy, maintenance and lacks output_hatch; `l` ⊇ output_hatch, energy, maintenance and lacks input_hatch and input_bus; `c` ⊇ output_hatch, output_bus, maintenance. Pyrolyse Oven 15546: `F` ⊇ input_bus, input_hatch, muffler; `G` ⊇ output_bus, output_hatch, energy, maintenance. Coke Oven 236: some element takes coke_oven_hatch (logged with the rest of its elements).
3. `it('agrees with the hand table wherever both have rules, or names each difference')` — for every machine with `elements` whose table row fits: for each exported cell and each layout kind, the table's answer (`elementTakes(row, elementMap(row, …).get(cell), kind)`, on the row without `exported`) against the export's (`exportedCells`); no cell where the table takes a kind the export does not (that would make the table's layout fail in game); the cells where the export takes more are logged per machine (the cracker's sides, for one).
4. `it('forms every corpus multiblock by the exported rules in every logistics mode')` (timeout 1 800 000 ms) — each of `REAL_CORPUS` × `CORPUS_VARIANTS` planned as `tests/unit/planner/real-corpus.test.ts` plans it (`planLine(pack, { ...defaultSettings(), target: t.key, amount: t.amount, per: v.per, tier: t.tier, routeDerived: v.routeDerived }, emptyContext())`, `status` `ok`); for every multiblock unit of `unitsFromPlan`: its machine has `elements` unless it is in `UNPROBED` (whose units skip the cell checks); every cell with `hatch` set holds a hatch whose `exportKindOfClass(class, metaName)` is one of `KIND_SOURCES[cell.hatch]` and is taken by the element of that cell; every exported hatch cell (role `hatch`, no `hatch`) of a known kind is taken by its element. Then for each of the four modes, `layoutLine(pack, plan, emptyScan(), makeProject({ logistics: mode }))` warns no `hatch_rules_unknown`, `hatch_cells_short` or `hatch_notes_unfit` for a step whose machine is not in `UNPROBED`. Every problem is collected as `<target> <variant> <mode> <machine>: <problem>` and the list must be empty; the multiblocks met are logged with their counts and must include 1000, 1126, 1160, 1169, 1002, 15546, 236 and 140 (the EBF, Distillation Tower, Oil Cracking Unit, Large Chemical Reactor, Vacuum Freezer, Pyrolyse Oven, Coke Oven and Bricked Blast Furnace the corpus places). A failure is never fixed by loosening these assertions: record it and stop for the controller.

- [ ] **Step 4: Run the real-data checks**

Run: `GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npx vitest run tests/unit/layout/real-hatch-export.test.ts tests/unit/planner/real-corpus.test.ts`
Expected: PASS, with the logs above; `real-corpus.test.ts` passes as before the move.

- [ ] **Step 5: README and research**

README, "Export your pack", after the 0.4.0 sentence: `Exporter 0.6.0 also records, for every multiblock, which hatches GregTech's own structure check takes on each of its casings, so the layout puts each hatch where the machine forms; with an older export the planner falls back to its own notes for the common machines and says so elsewhere.` "Line layout and 3D view", a bullet after **Facing**: `**Hatches:** each multiblock's hatches go only on casings GregTech takes them on (exporter 0.6.0 and later); the planner's own notes add what GregTech checks in the controller itself — an output hatch on every layer of a distillation tower, a cracker's inputs on one side and outputs on the other with the catalyst in the middle. A machine that takes only multi-amp or laser energy hatches is flagged and not wired.` In `gt-mechanics.md` §5.5, a closing line "As measured (2026-…): `hatchRules` <n> of 326 structures; structures section <before> → <after> ms; <m> probe checks in <t> ms; `structures.jsonl.gz` <bytes>." with Step 2's numbers (no export id, no path).

- [ ] **Step 6: Full suite**

Run: `npm test`
Expected: PASS.

- [ ] **Step 7: Commit**

```bash
git add tests/helpers/real-corpus.ts tests/unit/planner/real-corpus.test.ts tests/unit/layout/real-hatch-export.test.ts README.md docs/research/gt-mechanics.md
git commit -m "test(layout): real-data acceptance of the 0.6.0 hatch rules on the corpus in every mode; docs: README and measured probe costs

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## In-game checklist (the user, after the controller has switched the active export to the 0.6.0 one with the user's yes)

Done in a creative single-player test world with the GTNH 2.9 client and the ghost projector; never on the live server. Expected results in brackets; results go into `docs/local/hatch-check.md` (local only).

1. In the planner, open a project for Advanced Circuit at HV, one a minute (the corpus line that places an Electric Blast Furnace, a Distillation Tower, a Large Chemical Reactor, an Oil Cracking Unit and a Vacuum Freezer). [The EBF's place step and the 3D view show the input and output buses, energy and maintenance hatches on the bottom layer, a fluid output hatch (if the recipe has one) on the top ring, the muffler at the top centre; no "hatch positions are not checked" warning.]
2. Build that EBF exactly as the projector shows it, power it and give it its inputs. [The controller shows no structure error and runs the recipe.]
3. Move the input bus up to the top ring. [GregTech refuses to form and names that cell.] Put it back. [It forms again.]
4. Build that line's Distillation Tower, Large Chemical Reactor, Oil Cracking Unit and Vacuum Freezer the same way. [Each forms as placed; the tower has one output hatch per layer, the k-th fluid on the k-th layer; the cracker's inputs sit on one side, its outputs on the other, the steam or hydrogen hatch in the middle.]
5. Build the Pyrolyse Oven of a Good Electronic Circuit line at MV with supporting lines. [It forms; its input bus, input hatch and muffler sit on the cells the export marks `F`, its outputs, energy and maintenance on `G`.]
6. Put a Coke Oven Hatch on a Coke Oven casing. [It forms with the hatch; note which casings take it, for the queued Coke Oven task.]
7. A failed check becomes a fix with a unit test (exporter: a JUnit-testable helper or Task 3's probe with a new re-export; planner: Task 5's lookup), or, when the export is right and the notes are wrong, a fix of the hatch-rules table.

## Open questions

1. **Start Tasks 1–4 now, beside the hatch-rules fix?** They touch none of its files and need none of its code; only Tasks 5–7 need it merged. The user asked for parallel lanes instead of a queue; the controller's sequencing put the whole add-on after the fix. *Recommendation:* run Tasks 1–4 now in a lane of their own, Task 5 onward after the fix merges.
2. **The controller notes stay hand-kept.** GregTech checks a distillation tower's output hatch per layer, the cracker's input side and catalyst hatch, casing minimums and steam power in each controller's own code after the walk; no structure probe sees them (Evidence 5). *Recommendation:* keep them in the fix's table as notes keyed by shape character (the export's characters are GT's own, so they line up); with an export the table's element lists are no longer read. Later, `StructureWrapper` machines' `minCasingCounts` could be exported too.
3. **Which hatch kinds to probe.** 17 kinds cost about 0.2–0.5 s each over all structures. ME hatches (stocking input bus and hatch, ME output bus and hatch, crafting input buffer), wireless energy, quadruple input hatches, TecTech data and parameter hatches and about 90 other hatch classes are not probed. *Recommendation:* add a kind when a planner feature places it (one line in `HatchKinds.ALL` and `EXPORT_HATCH_KINDS`, then a re-export).
4. **Hatch-only cells other than the muffler.** The hologram build fills them from GT's creative source: debug input hatches and buses in 9 structures, ULV dynamos in 19 generators, turbine hatches, ME output hatches. The export now says which kinds those cells take, but this plan keeps the exported hatch as today. *Recommendation:* a follow-up that turns each into the step's own hatch of a kind its element takes and counts it toward the step's needs, as the fix does for the muffler.
5. **One export for two add-ons.** Add-on 17's crop fix also waits for a re-export. *Recommendation:* merge that fix into main before Task 7, so the one 0.6.0 export carries the crop table and the hatch rules; switching main's active export stays the user's call.
6. **Facing.** The probe leaves each test hatch at its default facing; no adder of GT 5.09.54.183 reads a hatch's facing (`allowOnly`/`disallowOnly` act on auto-placement only). *Recommendation:* accept; the in-game checklist would show a counter-example.
