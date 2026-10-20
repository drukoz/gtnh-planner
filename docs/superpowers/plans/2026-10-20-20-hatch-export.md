# Add-on 20: Hatch Rules from the Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** The exporter records, for every exported multiblock structure, which hatch kinds GregTech's own structure check takes on each cell, and the layout places every hatch only where that record allows it — and, for a machine the hatch-rules fix's hand table has a fitting row for, only where the row allows it too, because the row encodes what GregTech checks in the controller after the walk (cracker sides, tower layers) — so a line's multiblocks form in game; the table alone stays the fallback for exports without the record, and a machine ruled by the export alone says that GregTech checks more in its controller.

**Architecture:** The structures section (exporter 0.6.0) builds each multiblock as today, then runs the controller's own `checkStructure` once with StructureLib's instrument switched on, which names the element (shape character) that checks every cell. For each element it puts one hatch of each of 17 kinds on one of its cells in turn, runs `checkStructure` again and counts the kind as taken when GregTech filed that hatch in one of the controller's hatch lists — not counting `mSmartInputHatches`, which GT's input adders fill before they check a hatch's type — and recorded no structure error on that cell; the answers go into two optional fields of the structure line (`elements`, `elementOf`). The loader turns them into `StructureInfo.elements`, and the layout's rule lookup combines them with the hand table: where a table row fits the exported structure, a cell takes the kinds both the export and the row give it, with the row's controller notes (distillation layers, cracker sides and catalyst, casing minimums) on top; where none does, the export's kinds alone, with a warning (`hatch_rules_export_only` or `hatch_notes_unfit`).

**Tech Stack:** Node 24 (type stripping) · TypeScript 6.0.3 · vitest 5.0.3 · the exporter mod's existing Java toolchain (GTNHGradle 2.0.33, Jabel to Java 8 bytecode, JUnit 5, Gson 2.2.4), GT5-Unofficial 5.09.54.183 and StructureLib 1.4.45 as the pack ships them — no new dependency anywhere.

**Spec:** `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` §3.6 (line layout, hatches and their logistics); contracts `docs/superpowers/plans/2026-10-17-00-architecture.md` §6.2 and §11 (this plan's entry is **49**); research `docs/research/gt-mechanics.md` §5 (this plan adds §5.5 from the evidence below) and the hatch-rules fix's research and table (branch `fix/hatch-rules`, merged before Task 5).

**Depends on.** The hatch-rules fix is committed on `fix/hatch-rules` (its rule module `src/server/layout/hatch-rules.ts` and its placement in `arrange.ts` since 03:17, more commits since, still being built), and two other lanes touch files of this plan: add-on 17 (`plan/17-objectives`, exporter 0.5.1: `src/server/pack/format.ts`, `load.ts`, `src/shared/types/pack.ts`, `exporter-mod/…/Exporter.java`) and `fix/steam-primitive` (`unitsFromPlan` in `arrange.ts`, architecture entry 48, `README.md`). Tasks 1–4 (wire format, exporter, loader) touch no file of the hatch-rules fix and may run now, beside it: Task 1 Step 1 checks that `git diff --name-only main...fix/hatch-rules` lists none of the files of Tasks 1–4 (`src/shared/types/pack.ts`, `src/shared/gt/hatch-kinds.ts`, `src/server/pack/*`, `src/server/cli/pack-info.ts`, `src/server/export/validate.ts`, `exporter-mod/**`), else they wait for Task 5's merge; the files they share with add-on 17 and `fix/steam-primitive` are expected and merge as textual conflicts (keep both sides). Task 5 onward runs only after `fix/hatch-rules` is merged into main: Task 5 Step 1 merges main and checks the fix's names (expect conflicts in `arrange.ts` when `fix/steam-primitive` merged first). Task 7 runs only after add-on 17's crop exporter (0.5.1) is in main (Task 7 Step 1), so the one 0.6.0 export also carries `crops.jsonl.gz`. The controller's sequencing for this add-on says "after fix/hatch-rules merges"; the user asked for parallel lanes instead of a queue — open question 1.

## Evidence and the choice of method

Read on 2026-10-20 with `javap` on copies of the server's `structurelib-1.4.45.jar`, `gregtech-5.09.54.183.jar` (which carries GT++, BartWorks, TecTech, GoodGenerator, KubaTech and KekzTech), `forge-1.7.10-10.13.4.1614-1.7.10-universal.jar` and the hydroenergy, cropsnh, matter-manipulator and vendingmachine jars (bullets 9–13 from the plan review's second reading); Task 1 copies these bullets into `gt-mechanics.md` §5.5.

1. **[jar] StructureLib can say which element checks which cell.** `StructureLibAPI.enableInstrument(Object)` / `disableInstrument()` set a thread-local token; `StructureUtility.iterateV2` (every check, build and hint walk) then calls `StructureEvent.StructureElementVisitedEvent.fireEvent(world, x, y, z, a, b, c, element)` for every non-navigating element whose block exists, before the walker's `visit`. `fireEvent` posts on `MinecraftForge.EVENT_BUS` inside `catch (Exception)`; the event has `getWorld`, `getX/Y/Z`, `getA/B/C`, `getElement` and `getInstrumentIdentifier`. FML 1.7.10's `EventBus` has `register(Object)` and `unregister(Object)`; `post` logs a listener's throwable and rethrows it.
2. **[jar] GregTech's check walks with those events.** `MTEEnhancedMultiBlockBase.checkPiece(piece, a, b, c, errors)` calls `IStructureDefinition.iterate(piece, world, getExtendedFacing(), x, y, z, a, b, c, new StructureChecker(this, forced, errors))`; `StructureChecker.visit` returns `element.check(...)`, so the walk of a piece stops at its first failing element (adding a `PositionedStructureError`). `MTEMultiBlockBase.checkStructure(boolean, IGregTechTileEntity)` (public, server side) runs `clearHatches()`, `structureErrors.clear()`, `checkMachine(base, mInventory[1], structureErrors)` and `mMachine = structureErrors.isEmpty()`.
3. **[jar] What a hatch element accepts is its adder.** `HatchElementBuilder$2.check` is `te instanceof IGregTechTileEntity && mAdder.apply(t, te, (short) mCasingIndex)`; `buildAndChain(...)` is an `IStructureElementChain` with fallbacks `[build(), casing…]`, tried in that order by `check` and `placeBlock`. The hatch elements given to `atLeast`/`anyOf` live only inside the lambdas `mAdder`, `mHatchItemFilter` and `mShouldSkip` — no field holds them.
4. **[jar] The hologram build fills hatch-only elements from a creative source.** A chained hatch element's `survivalPlaceBlock` rejects unless the trigger stack has `GTStructureChannels.HATCH` or the element is `exclusive()` (`newAny`); an exclusive one takes the first hatch `GTCreativeHatchSource` offers and calls `checkStructure(true, base)`. So the active export holds 115 hatches inside structures: Muffler Hatch 99 in 8 (the EBF 1000 among them), the ULV Dynamo 30 in 19 generators, Input Hatch (Debug) 11306 in 5, Input Bus (Debug) 11305 in 4, the Turbine hatch, ME output hatches and beamline hatches.
5. **[jar] Some adders only answer inside their controller's own check.** The Distillation Tower checks pieces `base` (`b`) and `layer` (`l`, `c`) but builds `layerHint`/`topHint` (`L`); its `addLayerOutputHatch` takes an `MTEHatchOutput` into `mOutputHatchesByLayer.get(mHeight - 1)`, `mHeight` being set by `checkMachine` (a call outside it indexes −1). The Oil Cracking Unit's `l`/`r` adders take an `MTEHatchInput` or an `MTEHatchOutput` and fix the input side by the first one found (`mInputOnSide`/`mOutputOnSide`); its `m` files input hatches in `mMiddleInputHatches`. Per-cell rules say what a cell can take; which combination forms stays the controller's code (the hatch-rules fix's notes).
6. **[jar] Reading the definitions would miss machines.** 219 GT-jar classes reference `buildHatchAdder`; 9 multiblock classes build hatch elements with the lambda-only `GTStructureUtility.ofHatchAdder`/`ofHatchAdderOptional` (`MTEAssemblyLine`, `MTEDistillationTower`, GGFab `MTEAdvAssLine`, GT++ `MTESpargeTower`, `MTEAdvDistillationTower`, `MTEPowerSubStation`, Intergalactic `TileEntityModuleBase`, TecTech `MTEMicrowave`, godforge `MTEBaseModule`); 10 multiblocks use `StructureWrapper` (`HatchInterceptor`); about 50 classes implement `IHatchElement`; the Vacuum Freezer and Implosion Compressor build their definition lazily in `getStructureDefinition()`.
7. **[jar] Hatch classes.** `MTEHatchSteamBusInput extends MTEHatchInputBus`, but `addInputBusToMachineList` tests `instanceof MTEHatchSteamBusInput` first, so steam buses are their own kind; TecTech's `MTEHatchEnergyMulti extends MTEHatch` (not `MTEHatchEnergy`), `MTEHatchEnergyTunnel extends MTEHatchEnergyMulti`, `MTEHatchDynamoMulti extends MTEHatchDynamo`; `MTEHatchCustomFluidBase` is the Steam Hatch (31040) and the Cryotheum (967) and Pyrotheum (968) hatches; the 2.9 Coke Oven (236, `MTECokeOven extends MTEEnhancedMultiBlockBase`) takes Coke Oven Hatches (237, `MTEHatchCokeOven`); the Bricked Blast Furnace (140) `extends MetaTileEntity` and has no hatch lists.
8. **[export] Who can be probed.** Of the 326 exported structures, 323 have an `MTEMultiBlockBase` controller and are not truncated (class-file superclass chains): the Bricked Blast Furnace is not one, 3013 and 15411 are truncated.
9. **[jar] GT's input adders file a hatch before they check its type.** `MTEMultiBlockBase.addIfSmartInput` adds any `ISmartInputHatch` to the private list `mSmartInputHatches` (and makes the controller its watcher); `addInputHatchToMachineList` calls it at offsets 19–21, before its type checks (24, 97), `addInputBusToMachineList` at 28–30 (after the steam-bus test, before 33 and 84), `addToMachineList` at 47–49, and the Oil Cracking Unit's `addLeftHatchToMachineList`/`addRightHatchToMachineList` at 19–21; `addOutputHatchToMachineList` and `addOutputBusToMachineList` call it only after theirs. `MTEHatchInputBus`, `MTEHatchOutputBus`, `MTEHatchInput`, `MTEHatchOutput`, `MTEHatchDataAccess` and `MTEHatchCustomFluidBase` implement `ISmartInputHatch` (the steam buses extend the first two), so a probe of 8 of the 17 kinds that such an adder rejects still sits in a controller list after the check; `clearHatches()` empties that list at the start of each check.
10. **[jar] GT records where its check failed.** `StructureChecker.visit` adds a `PositionedStructureError(x, y, z, …)` (private `int` fields `x`, `y`, `z`, world coordinates) to the check's error list for every element that rejects a block; `checkStructure` hands it `MTEMultiBlockBase.structureErrors` (private, no getter). `MTEEnhancedMultiBlockBase.checkPiece(…, errors)` walks a piece a second time with its `centerWalker` when the check succeeds (offsets 78–131), so an accepted probe costs two walks.
11. **[jar] Some cells take hatches the controller cannot use.** The Oil Cracking Unit's `l` and `r` adders each take an input or an output hatch, the first one found fixing the side (`mInputOnSide`/`mOutputOnSide`); the Distillation Tower's top centre `c` takes output hatches and buses through `addOutputToMachineList` into `mOutputHatches`, which neither `addFluidOutputs` nor `getOutputHatches` reads (both use `mOutputHatchesByLayer`); the Assembly Line's `checkMachine(boolean)` ends the line at the first slice that holds an output bus (offsets 32–77). Per-cell acceptance is wider than what works: the hatch-rules fix's table rows, which encode that controller logic, narrow it (change request 3).
12. **[jar] The plain dynamo adder takes a small multi-amp dynamo.** `addDynamoToMachineList` takes any `MTEHatchDynamo` whose `maxAmperesOut()` is at most 4, and `MTEHatchDynamoMulti extends MTEHatchDynamo`: its lowest id, 15200 (`hatch.dynamomulti04.tier.05`), is a 4 A hatch; the 16 A ones start at 15210 (`hatch.dynamomulti16`). The multi-amp energy hatch (`MTEHatchEnergyMulti`, lowest 15100, 4 A) is no `MTEHatchEnergy`, so no plain energy adder takes it.
13. **[jar] Not every controller class can be read on a server.** TecTech's `MTEBECStorage` declares `pillar`, `torus` and `torusFar` of type `gregtech.client.GTSoundLoop` (`extends MovingSound`, a client class) without `@SideOnly`, so `getDeclaredFields()` on it throws on a dedicated server; about 20 classes of the controllers' hierarchies declare static `Collection`/`Map` fields (`MTETreeFarm.treeProductsMap`, `MTEChemicalPlant.mTieredBlockRegistry`, …), global registries that no probe needs.

| | (a) read GT's definitions (HatchElementBuilder lists, dot hints) | (b) put each hatch kind on each element's cell and ask the controller's own check (**chosen**) |
|---|---|---|
| Coverage | builder elements only, through JVM lambda captures; misses the 9 `ofHatchAdder` multiblocks (the corpus's Distillation Tower among them), cannot evaluate state-dependent adders (tower layers, cracker sides) | every multiblock whose check walks StructureLib: 323 of 326 expected, less any whose fields cannot be read |
| Determinism | fixed, but rests on hidden-class field names | fixed walk, kinds in a fixed order, the lowest-id hatch of each kind (a 16 A one for `dynamo_multi`), elements ordered by first cell, no hash order in the output |
| Cost | none | 17 `checkStructure` runs per element and one more walk after it: Σ over structures of (elements × blocks) × 18, an accepted probe walking its piece twice; estimate +10–30 s on today's 4.2–5.1 s structures section, inside the probe's own 120 s budget |
| Failure mode | wrong answers without a sign | GT side effects on a throwaway controller; caught per machine (a throw, a walk that changed after an element, a class whose fields cannot be read), the line then has no rules and the table applies |

The verdict needs both signals: list membership alone counts what an adder filed before rejecting it (Evidence 9), and a missing error alone would count elements that take any block (`notAir`) and every check that records no positioned errors (only `checkPiece(…, errors)` does); with both, a list GT fills before a type check can only mislead where the check records no positioned error, which is why `mSmartInputHatches` is left out by name as well. Not chosen: calling the visited element's own `check()` on the probe cell after the baseline walk (one call instead of a walk) — elements and adders then run outside the walk whose state they read (`addLayerOutputHatch` reads `mHeight`, the cracker's sides `mInputOnSide`, casing counters and wrapper elements their walk's context), so its answers would rest on what the baseline left behind; the measured cost of the full walks decides whether that optimization is ever worth it.

## Global Constraints

- `<repo>` below is the main checkout, `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` from the worktree; Task 1 Step 0 installs the worktree's `node_modules` and links its `.local/gradle-home`.
- Node `>=24.10.0 <25`; `npm run typecheck` (`tsc -b`), `npx vitest run <files>`; real-data tests run only with `GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json` (worktree-local config: `dataDir` = the worktree's `data/`, whose `export` and `assets` are symlinks to `<repo>/data/export` and `<repo>/data/assets`; only `serverFolder` and `activeExportId` are copied from `<repo>/data/config.json`, which holds secrets — never print or copy anything else from it).
- TypeScript erasable syntax only (no `enum`, `namespace`, parameter properties, decorators); relative imports name the real `.ts` file; type-only imports use `import type`; `src/shared/` stays pure (no `node:*`, no DOM).
- Every new field of `StructureInfo`, `StructureLine`, `ManifestFile` and the fix's `HatchRule` is an optional addition (comment `// optional addition (add-on 20)`); an export without the new fields loads and lays out exactly as before this plan.
- Exporter: version **0.6.0** (the next minor after add-on 17's 0.5.0, whose crop fix is 0.5.1; if Task 1 Step 1 finds an exporter version ≥ 0.6.0 already, use the next minor and read every "0.6.0" below as that). Built from the worktree root with `(export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.6.0 ./gradlew …)`, where `.local/gradle-home` is a symlink to `<repo>/.local/gradle-home` as in the worktrees of plans 17 and 18 (Task 1 Step 0 makes it); every installed jar passes `exporter-mod/scripts/check-reobf.sh`; Java 8 bytecode; JUnit only for helpers free of GregTech classes; no new Java dependency; Minecraft and Forge members called directly (reobfuscated), never by reflection (GregTech's own fields — its hatch lists, `structureErrors`, `PositionedStructureError`'s coordinates — are read by reflection: mod classes keep their names).
- The 17 export hatch kinds, in this order, with GT's class (simple name) and, for two, a metaName prefix: `input_bus` MTEHatchInputBus · `output_bus` MTEHatchOutputBus · `input_hatch` MTEHatchInput · `output_hatch` MTEHatchOutput · `energy` MTEHatchEnergy · `energy_multi` MTEHatchEnergyMulti · `energy_laser` MTEHatchEnergyTunnel · `maintenance` MTEHatchMaintenance · `muffler` MTEHatchMuffler · `dynamo` MTEHatchDynamo · `dynamo_multi` MTEHatchDynamoMulti with metaName starting `hatch.dynamomulti16.` · `dynamo_laser` MTEHatchDynamoTunnel · `steam_input_bus` MTEHatchSteamBusInput · `steam_output_bus` MTEHatchSteamBusOutput · `steam_hatch` MTEHatchCustomFluidBase with metaName starting `hatch.steam.` · `data_access` MTEHatchDataAccess · `coke_oven_hatch` MTEHatchCokeOven. A kind's probe hatch is the lowest MTE id whose class has exactly that simple name (and metaName prefix): `energy_multi` probes a 4 A hatch (15100), `dynamo_multi` a 16 A one (15210), because GT's plain dynamo adder also takes multi-amp dynamos of at most 4 A (Evidence 12).
- Wire names, exactly: structure line fields `elements` (array of `{ "ch"?: string, "hatches": string[] }`) and `elementOf` (one integer per `blocks` entry: its element's index, or −1); manifest count key `hatchRules` (structure lines with `elements`); system property `gtnhplanner.hatchProbeBudgetSeconds`, default `120`.
- Determinism: the exporter never lets hash order reach the output — elements in the order of their first block, kinds in the order above, an element's character the smallest one the definition maps to it; the same pack gives byte-identical `elements`/`elementOf` on every export.
- Exports: this plan runs exactly one, in Task 7, by the controller, through `npm run export -- --jar …` on the APFS clone; never start, stop or write the live Minecraft server or its folder; never write the main checkout's `data/config.json`, `data/export` (beyond the new export folder the CLI creates) or `data/assets`.
- Synthetic fixtures only in unit tests (invented names, except GT class names and MTE ids the code names); nothing game-derived is committed (`data/`, `.local/`, `docs/local/`, jars, exports); no absolute local paths in committed files.
- Commits use a conventional prefix and end with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use bare `git stash`.

## Review Focus

1. **An export where some multiblocks were probed and others not** (the probe budget ran out, a machine's probe threw or its walk changed, a controller class that cannot be read, the Bricked Blast Furnace, a truncated structure): each multiblock follows its own source — the export narrowed by the table row where one fits, else the export alone (`hatch_rules_export_only`, or `hatch_notes_unfit` for a row that does not fit), else the table row, else the generic placement with `hatch_rules_unknown`; a structure without `elements` never reads as "takes no hatch". Tests: Task 4 (absent ≠ empty), Task 5 tests 11 and 18.
2. **Cells the export does not cover** (GT's check stopped before them, or two elements checked them): they take no hatch, also under a fitting table row; hatches go only on covered cells, and what does not fit warns `hatch_cells_short` — never a hatch on an uncovered cell. Test: Task 5 test 10.
3. **A planner and an exporter of different ages**: today's loader ignores both fields of a 0.6.0 line; the new loader drops a kind it does not know with one warning per structure and never fails on it, and fails with file and line only for a broken `elementOf`. Tests: Task 4.
4. **A tower built taller than the exported one** (a recipe with more fluid outputs than the exported layers): the inserted layers take the rules of the exported first layer above the bottom, the moved top keeps the top's. Tests: Task 5 tests 6 and 14.
5. **A cell only a hatch may fill** (the EBF's muffler, exclusive elements): the exported hatch stays there (the muffler at the lowest tier, as the hatch-rules fix does), no other kind is put on it, and a muffler is never put on a cell whose element takes none. Test: Task 5 test 12.
6. **A probe GT files and then rejects, and a cell GT takes but its controller cannot use** (Evidence 9 and 11): the first never counts as taken (Task 2's `HatchLists.taken`; Task 7 test 2's exact sets); the second is kept off the layout by the table row (cracker sides, the tower's top centre; Task 5 tests 14 and 17), and where no row exists the layout says so (`hatch_rules_export_only`). Where the export takes less than a row, the row is wrong: Task 7 test 3 fails.

---

## Architecture change requests

All of these become one architecture §11 entry numbered **49** (reserved for this plan; 44 is add-on 15's, 45 add-on 17's, 46 add-on 19's; Task 1 Step 1 checks that 49 is still free and appends it after the last entry), appended in Task 1; its amendments to §6.2, §11.7 (the wire format's rules) and the hatch-rules fix's rule lookup stay inside entry 49:

1. **Hatch rules in the export** (exporter 0.6.0). A `structures.jsonl.gz` line may carry `elements: Array<{ ch?: string; hatches: string[] }>` and `elementOf: number[]`, always together: `elements[k]` is one element of GT's structure definition — `ch` its shape character when the definition is a `StructureDefinition` that maps one to it, `hatches` the export hatch kinds (`EXPORT_HATCH_KINDS`, in that order) whose probe hatch, standing on the element's probe cell, GT's own `checkStructure` filed in one of the controller's hatch lists (`mSmartInputHatches`, which GT's input adders fill before they check a hatch's type, and static fields never count) without recording a structure error on that cell; `elementOf[i]` is the element of `blocks[i]`, −1 for the controller, for a cell GT's check never reached and for one two elements checked. A line without them was not probed (an older exporter, a controller that is no `MTEMultiBlockBase`, a controller class whose fields this server cannot read, a truncated structure, a machine whose probe failed or whose check walked differently after a probe, the probe budget used up). `manifest.counts.hatchRules` = lines with `elements`. Old loaders ignore both fields and the count.
2. **Pack types.** `src/shared/gt/hatch-kinds.ts` holds `EXPORT_HATCH_KINDS` (the 17 kinds of the Global Constraints), `type ExportHatchKind`, `EXPORT_HATCH_KIND_NAMES`, `EXPORT_HATCH_CLASSES` and `exportKindOfClass(simpleName, metaName)`. `StructureInfo.elements?: StructureElement[]` with `interface StructureElement { ch?: string; hatches: ExportHatchKind[]; cells: Array<[number, number, number]> }`; the loader drops kinds it does not know (one warning per structure) and fails with file and line for an `elementOf` that does not match `blocks` or `elements`.
3. **Where the layout's hatch rules come from**, per multiblock: where the export has elements and the hatch-rules fix's table row for the machine fits the exported structure, a cell takes a kind only when both give it — the row's character there and the export's element of that cell (the row's element lists narrowed per character to what the export gives on every covered cell of it; a cell the export does not cover takes none) — and the row's controller notes (layer outputs, casing minimums, fluid input slots, needs, hatch classes, power, "by hand" texts) apply on top; where the export has elements and no row fits, the export's kinds alone, with `hatch_rules_export_only` (no row: the export holds GT's per-casing rules, and GT checks more in the controller — sides, layers, line length) or `hatch_notes_unfit` (a row that does not fit); where the export has none (an older export, an unprobed machine), the table row alone; else none (`hatch_rules_unknown`, generic placement). Where the export takes less than a fitting row, the row is wrong (Task 7 test 3 fails); where it takes more, the difference is the controller's own logic (Evidence 11), listed in that test. A cell whose element has no `ch` gets the character `#<element index>`. A layout kind is taken where any export kind of `KIND_SOURCES` is (`input_bus` ← `input_bus`, `steam_input_bus`; `output_bus` ← `output_bus`, `steam_output_bus`; `input_hatch`, `output_hatch`, `energy`, `maintenance`, `muffler` ← the same name; `steam` ← `steam_hatch`); a steam bus is placed where the machine takes no plain bus. An electric multiblock that takes only `energy_multi`/`energy_laser` energy hatches warns `hatch_energy_exotic` and gets no energy hatch.
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
| `exporter-mod/…/export/sections/ElementGroups.java` (new) | which element checked which block, groups, probe cell, whether two walks grouped alike (pure) |
| `exporter-mod/…/export/sections/ElementLine.java` (new) | one element and the JSON of `elements`/`elementOf` (pure) |
| `exporter-mod/…/export/sections/HatchLists.java` (new) | the verdict of one probe: filed in a controller's collection fields (static fields and `mSmartInputHatches` left out) and no structure error on its cell; whether a controller's classes can be read (pure reflection) |
| `exporter-mod/…/export/sections/StructureVisits.java` (new) | the StructureLib instrument listener |
| `exporter-mod/…/export/sections/HatchProbe.java` (new) | the probe of one built structure (GregTech calls) |
| `exporter-mod/…/export/sections/StructuresSection.java`, `ExportContext.java`, `ExporterMod.java`, `Exporter.java` | probe after each build, write the fields, summary warnings, count, budget, `listIds` package-private; `info(…)` for the sections' log lines; listener registration; the wire rule |
| `src/server/layout/hatch-export.ts` (new) | export elements → per-cell layout kinds, grown towers, power, steam bus classes |
| `src/server/layout/hatch-rules.ts` (the hatch-rules fix's rule module), `src/server/layout/arrange.ts` | `HatchRule.exported?`, `hatchRulesOf` (export ∩ row, export alone, row alone), `hatch_rules_export_only`, `hatch_notes_unfit`, `hatch_energy_exotic` in `multiblockShape` |
| `tests/helpers/hatch-export-fixtures.ts` (new, on the fix's `tests/helpers/hatch-fixtures.ts`), `tests/helpers/real-corpus.ts` (new) | fixtures with elements; the plan 09 corpus (`CORPUS`, `VARIANTS`) shared by two real-data tests |
| `docs/research/gt-mechanics.md`, `docs/superpowers/plans/2026-10-17-00-architecture.md`, `README.md` | §5.5, entry 49, the user-facing lines |

## Measured costs

Measured for this plan (2026-10-20, on main's active export `2.9.0-RC-1_20261019-221019` and the seven other exports so far, the newest `2.9.0-RC-1_20261020-064351`, exporter 0.5.0):

- Structures section today: 4,199–5,072 ms (`sectionMillis.structures` of all eight exports; 5,072 ms the newest); whole export about 39–53 s wall clock (`docs/local/export-runs.md`; 53 s the newest).
- Probe work, the same in both exports: 326 structures, 133,630 blocks, 1,512 palette entries (1,186 besides the controllers); Σ (palette entries − 1) × blocks = 800,745 cell checks per kind, × 17 kinds ≈ 13.6 M, plus about 1,186 × 17 ≈ 20 k probe placements and as many `checkStructure` runs. Palette entries undercount elements (the EBF has 3 besides its controller but 4 elements, the Distillation Tower 1 but 3), every accepted probe walks its piece twice (Evidence 10) and every element adds one more walk (Task 3); so the estimate is +10–30 s, far inside the probe's own 120 s budget, the structures section's 300 s (`gtnhplanner.structureBudgetSeconds`) and the CLI's 15-minute export timeout (`EXPORT_TIMEOUT_MS`, `src/server/export/run.ts`); no budget changes. Measured by Task 7's run (`sectionMillis.structures` and the log line `hatch probes on …`).
- File size: the same 326 structures with an `elements`/`elementOf` pair (palette entries as stand-in elements) make `structures.jsonl.gz` 353,570 bytes instead of 299,023 (+54.5 kB, about 1 % of the 5.8 MB export). A list of cell indices per element instead of `elementOf` would add 300 kB, so the plan uses `elementOf`.
- Loading: gunzip + parse + per-element cell lists of that file, Node 24, median of 10 warm runs: 12.4 ms against 10.1 ms today (+2.3 ms on a 1.6 s `loadPack`).

## Task outline

1. Contracts: export hatch kinds, pack and wire types, architecture entry 49, research §5.5.
2. Exporter helpers free of GregTech (kinds and probe hatches, element groups, the JSON, the hatch-list search), JUnit, and the Java/TypeScript vocabulary check.
3. The probe in the structures section (instrumented check, one probe per element and kind, restore, budget, summaries, count), exporter 0.6.0 and its jar checks.
4. Loader, `pack:info` and the validation summary.
5. The layout uses the export's rules, narrowed by a fitting table row (after the hatch-rules fix is merged).
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
    // 'energy hatch', 'multi-amp energy hatch (4 A)', 'laser target hatch', 'maintenance hatch', 'muffler hatch', 'dynamo hatch',
    // 'multi-amp dynamo hatch (16 A)', 'laser source hatch', 'steam input bus', 'steam output bus', 'steam hatch', 'data access hatch', 'Coke Oven Hatch'
  export const EXPORT_HATCH_CLASSES: Readonly<Record<ExportHatchKind, { cls: string; metaPrefix?: string }>>;   // the classes and the two prefixes of the Global Constraints
  export function isExportHatchKind(s: string): s is ExportHatchKind;
  /** The kind whose class has simple name `simpleName` (and, when the kind has a metaPrefix, for a `metaName` that starts with it); null for any other hatch. */
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

- [ ] **Step 0: Set up the worktree** (it has neither `node_modules` nor `.local/gradle-home`, so the first `vitest` and `gradlew` runs would fail)

Run from the worktree root:
```bash
REPO="$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")"
npm ci
mkdir -p .local && { [ -e .local/gradle-home ] || ln -s "$REPO/.local/gradle-home" .local/gradle-home; }
test -x node_modules/.bin/vitest && test -d .local/gradle-home/ && echo "worktree ready"
```
Expected: `npm ci` exits 0, then `worktree ready`. Both folders are git-ignored; nothing to commit.

- [ ] **Step 1: Pre-flight**

Run from the worktree root:
```bash
F='^(src/shared/types/pack\.ts|src/shared/gt/hatch-kinds\.ts|src/server/pack/|src/server/cli/pack-info\.ts|src/server/export/validate\.ts|exporter-mod/)'
git diff --name-only main...fix/hatch-rules 2>/dev/null | grep -E "$F" ; echo "overlap check done"
E='^(src/shared/types/pack\.ts|src/server/pack/(format|machines|load)\.ts|src/server/cli/pack-info\.ts|src/server/export/validate\.ts|exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/(Exporter|ExporterMod|ExportContext|sections/StructuresSection)\.java|tests/unit/(pack/machines|cli/pack-info|export/validate)\.test\.ts|docs/superpowers/plans/2026-10-17-00-architecture\.md|docs/research/gt-mechanics\.md)$'
for b in plan/17-objectives fix/steam-primitive; do echo "== shared with $b:"; git diff --name-only main...$b 2>/dev/null | grep -E "$E"; done
for m in <repo>/data/export/*/manifest.json; do python3 -I -c "import json,sys; print(json.load(open(sys.argv[1]))['exporterVersion'])" "$m"; done | sort -V | tail -1
git log plan/17-objectives --format=%s | grep -o 'exporter 0\.[0-9]*\.[0-9]*' | sort -V | tail -1
grep -n -o '^4[0-9]\. \*\*[^*]*\*\*' docs/superpowers/plans/2026-10-17-00-architecture.md
git show fix/steam-primitive:docs/superpowers/plans/2026-10-17-00-architecture.md | grep -n -o '^4[0-9]\. \*\*[^*]*\*\*'
```
Expected: no file listed before `overlap check done` (else stop: Tasks 1–4 wait for the fix's merge, Task 5 Step 1). Shared with `plan/17-objectives` (2026-10-20): `exporter-mod/…/export/Exporter.java`, `src/server/pack/format.ts`, `src/server/pack/load.ts`, `src/shared/types/pack.ts` — add-on 17's crop table, whose lines sit next to this plan's (the header rules, `OPTIONAL_EXPORT_FILES` just above `ManifestFile`, the rules table of `Exporter.java`); shared with `fix/steam-primitive`: the architecture file (its entry 48). Record both lists in the Task 1 commit message; they merge as textual conflicts, resolved by keeping both sides, at the first merge of main that brings them (Task 5 Step 1 or Task 7 Step 1); a shared file beyond these → note it there too. The newest exported version is `0.5.0` or a `0.5.x`, and add-on 17's newest is `exporter 0.5.1` (else apply the version rule of the Global Constraints); entry 49 is not among the numbers listed on this branch or on `fix/steam-primitive` (else stop and ask the controller for a number).

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

  it('probes multi-amp dynamos with a 16 A hatch, which the plain dynamo adder refuses', () => {
    expect(EXPORT_HATCH_CLASSES.dynamo_multi).toEqual({ cls: 'MTEHatchDynamoMulti', metaPrefix: 'hatch.dynamomulti16.' });
    expect(exportKindOfClass('MTEHatchDynamoMulti', 'hatch.dynamomulti16.tier.05')).toBe('dynamo_multi');
    expect(exportKindOfClass('MTEHatchDynamoMulti', 'hatch.dynamomulti04.tier.05')).toBeNull();
    expect(exportKindOfClass('MTEHatchEnergyMulti', 'hatch.energymulti04.tier.05')).toBe('energy_multi');
    expect(EXPORT_HATCH_KIND_NAMES.dynamo_multi).toContain('16 A');
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

Append to architecture §11, after the last entry: `49. **Hatch rules from the export** (spec §3.6; plan \`2026-10-20-20-hatch-export.md\`, add-on 20; amends §6.2, the wire rules of §11.7's \`format.ts\` and the hatch-rules fix's rule lookup):` followed by this plan's four change requests, each as one sentence group in their order (1 the export, 2 pack types, 3 where the layout's rules come from, 4 research). In `gt-mechanics.md` add `### 5.5 Hatch positions (exporter 0.6.0)` after §5.4's table: this plan's thirteen Evidence bullets with their `[jar]`/`[export]` tags, then one paragraph "The probe" — the structures section runs the controller's `checkStructure` once with the instrument on to learn which element checks each block, then for each element puts the lowest-id hatch of each of the 17 kinds (a 16 A one for `dynamo_multi`, a 4 A one for `energy_multi`) on its first block that held no tile entity, runs `checkStructure` again and counts the kind as taken when the hatch is found, by identity, in a non-static collection field of the controller other than `MTEMultiBlockBase.mSmartInputHatches` (a list of lists or a map of lists one level down too) and GT's check recorded no `PositionedStructureError` on the probe cell; the cell is restored after every probe and GT's check is walked once more after each element, a machine whose walk then groups its blocks differently getting no rules; controllers that are no `MTEMultiBlockBase`, controllers with a class whose fields cannot be read on the server and truncated structures are not probed; the probe has its own budget (`gtnhplanner.hatchProbeBudgetSeconds`, 120 s). A closing sentence: per-cell acceptance is wider than what forms (Evidence 11), so the layout narrows it by the hatch-rules table where a row fits. §5.1's "Verdict" gains: `Hatch positions are not in a definition one can read; exporter 0.6.0 asks the controller's own check (§5.5).`

- [ ] **Step 7: Commit**

```bash
git add src/shared/gt/hatch-kinds.ts src/shared/types/pack.ts src/server/pack/format.ts tests/unit/shared/hatch-kinds.test.ts docs/superpowers/plans/2026-10-17-00-architecture.md docs/research/gt-mechanics.md
git commit -m "feat(pack): export hatch kinds and structure elements; docs: architecture entry 49, gt-mechanics 5.5

<the files Step 1 found shared with plan/17-objectives and fix/steam-primitive>

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
      /**
       * A 60-bit key of a world cell, distinct for every x, z in ±2^25 and y in 0..255, in long arithmetic — exactly
       * ((long) (x & 0x3FFFFFF) << 34) | ((long) (y & 0xFF) << 26) | (z & 0x3FFFFFF): written without the casts, Java shifts an
       * int by the distance's low 5 bits only (<< 34 is << 2) and (y & 0xFF) << 26 overflows for y ≥ 64, so keys would collide.
       */
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
      /**
       * The block a group is probed on: its first block that held no tile entity when it was recorded (`tile[b]` false), else
       * its first block. Restoring a cell re-places only block, meta and GT machine id, so a cell without a tile entity is the
       * one a restore gives back exactly.
       */
      static int probeBlock(Group group, boolean[] tile);
      /** Whether two walks grouped the blocks alike: as many groups, each with the same blocks (the elements may be other instances). */
      static boolean sameGroups(List<Group> a, List<Group> b);
  }
  final class ElementLine {
      ElementLine(String ch /* null when unknown */, List<String> hatches /* in HatchKinds.ALL order */);
      /** Writes the members `"elements":[…]` (one object per element, `ch` left out when null) and `"elementOf":[…]` into the object `j` is in. */
      static void write(JsonWriter j, List<ElementLine> elements, int[] elementOf) throws IOException;
  }
  final class HatchLists {
      /**
       * Fields no verdict reads, as "<declaring class's simple name>.<field name>": GT's input-hatch, input-bus and generic
       * adders and the cracker's side adders file every ISmartInputHatch there before they check its type (Evidence 9).
       */
      static final Set<String> EXCLUDED = Collections.singleton("MTEMultiBlockBase.mSmartInputHatches");
      /**
       * Whether a non-static field of type Collection or Map, declared by `machine`'s class or any superclass and not named in
       * `excluded`, holds `probe` or `probeBase` by identity — also as an element of a collection or map value inside it.
       */
      static boolean holds(Object machine, Object probe, Object probeBase, Set<String> excluded);
      /** Whether `errors` holds an object of a class whose simple name is PositionedStructureError and whose int fields x, y, z (private, read by reflection) are this cell. */
      static boolean rejectedAt(Iterable<?> errors, int x, int y, int z);
      /** One probe's verdict: taken when `holds(machine, probe, probeBase, excluded)` and not `rejectedAt(errors, x, y, z)`. */
      static boolean taken(Object machine, Object probe, Object probeBase, Set<String> excluded, Iterable<?> errors, int x, int y, int z);
      /** The simple name of the first class of `machine`'s hierarchy (its class up to Object) whose declared fields cannot be read, else null; cached per class. */
      static String unreadableClass(Object machine);
  }
  ```

- [ ] **Step 1: Write the failing JUnit tests** (JUnit 5 Jupiter, as `BatteryBuffersTest`; `org.junit.jupiter.api.Test` and `Assertions`, never `org.junit.Test`)

- `HatchKindsTest`: `ALL`'s names are the 17 of Task 1 in order, `ALL.get(14)` is `steam_hatch` / `MTEHatchCustomFluidBase` / `hatch.steam.`, `ALL.get(10)` is `dynamo_multi` / `MTEHatchDynamoMulti` / `hatch.dynamomulti16.`; `representatives` of the candidates `(41, "MTEHatchEnergy", "hatch.energy.tier.01")`, `(40, "MTEHatchEnergy", "hatch.energy.tier.00")`, `(967, "MTEHatchCustomFluidBase", "hatch.cryotheum.input.tier.00")`, `(968, "MTEHatchCustomFluidBase", "hatch.pyrotheum.input.tier.00")`, `(31040, "MTEHatchCustomFluidBase", "hatch.steam.input.tier.00")`, `(2711, "MTEHatchInputBusME", "hatch.input_bus.me")`, `(15211, "MTEHatchDynamoMulti", "hatch.dynamomulti16.tier.06")`, `(15200, "MTEHatchDynamoMulti", "hatch.dynamomulti04.tier.05")`, `(15210, "MTEHatchDynamoMulti", "hatch.dynamomulti16.tier.05")`, `(71, "MTEHatchInputBus", "hatch.input_bus.tier.01")`, `(70, "MTEHatchInputBus", "hatch.input_bus.tier.00")` equals the map `{input_bus=70, energy=40, dynamo_multi=15210, steam_hatch=31040}` and iterates in that order (the 4 A dynamo 15200 is no candidate for `dynamo_multi`).
- `ElementGroupsTest`: `key(8192, 128, 8192)`, `key(8193, 128, 8192)`, `key(8192, 129, 8192)`, `key(8192, 128, 8193)` and `key(-5, 0, -5)` are five different values, and none of these pairs collide (each would with int shifts): `key(1, 0, 0)` / `key(0, 0, 4)`, `key(0, 64, 0)` / `key(0, 0, 0)`, `key(0, 128, 0)` / `key(0, 0, 0)`, `key(8192, 64, 8192)` / `key(8192, 192, 8192)`. With `Visits(6)` and elements `A`, `B`, `C` (plain `Object`s): visit (0, A), (1, B), (2, A), (3, A), (3, B), (1, B), (5, C) → `elementAt(3)` null, `conflicts()` 1, `visited()` 5 (block 4 never visited); `groups(visits, 5)` = `[A: {0, 2}, B: {1}]` (C only on the skipped block); `probeBlock(A's group, {true, false, false, …})` is 2 and with a tile entity on every block is 0. `sameGroups`: the groups of a second `Visits(6)` with the same visits by other instances `A2`, `B2`, `C2` equal the first's (true); with block 2 visited by `B2` instead (`[A2: {0}, B2: {1, 2}]`) false; with block 4 also visited by `A2` false.
- `ElementLineTest`: in a `JsonWriter` over a `StringWriter`, `beginObject(); write(j, [("b", ["input_bus", "energy"]), (null, [])], {-1, 0, 1, 0}); endObject()` gives exactly `{"elements":[{"ch":"b","hatches":["input_bus","energy"]},{"hatches":[]}],"elementOf":[-1,0,1,0]}`.
- `HatchListsTest`, the search: classes `static class Base { protected final List<Object> fromBase = new ArrayList<>(); }` and `static class Fake extends Base { private final List<List<Object>> byLayer = new ArrayList<>(); final Map<String, Object> byName = new HashMap<>(); Object loose; int count; static final List<Object> REGISTRY = new ArrayList<>(); }`; a probe `p = new Object()`, its base `q = new Object()`, `none = Collections.emptySet()`: `holds(fake, p, q, none)` false when empty; true after `fromBase.add(p)` (a superclass field); true for `byLayer` holding `[[], [p]]`; true for `byName.put("x", q)` (the base counts); true for `byName.put("y", Arrays.asList(p))` (a list inside a map); false when only `loose = p` (no collection type); false when only `Fake.REGISTRY.add(p)` (a static field; clear it after the test); false for `fromBase.add(new String("x"))` when the probe is `"x"` (identity, not equality); `unreadableClass(fake)` null.
- `HatchListsTest`, the verdict, on fakes named like GT's: `static class MTEMultiBlockBase { private final ArrayList<Object> mSmartInputHatches = new ArrayList<>(); final ArrayList<Object> mInputHatches = new ArrayList<>(); final List<Object> structureErrors = new ArrayList<>(); }`, `static final class PositionedStructureError { private final int x, y, z; PositionedStructureError(int x, int y, int z) {…} }`, and `static class FakeCracker extends MTEMultiBlockBase { boolean addSideHatch(Object h) { mSmartInputHatches.add(h); if (h instanceof FakeInputHatch) { mInputHatches.add(h); return true; } return false; } }` (the order of GT's `addLeftHatchToMachineList`); the probe cell (8192, 65, 8193):
  - an output-hatch probe `addSideHatch` files in `mSmartInputHatches` and rejects, the check then recording `PositionedStructureError(8192, 65, 8193)` → `taken(cracker, probe, base, EXCLUDED, structureErrors, 8192, 65, 8193)` false;
  - the same rejection with no recorded error (a check that records none) → false (the excluded field alone), while `holds(cracker, probe, base, Collections.emptySet())` is true (the exclusion is what drops it);
  - a `FakeInputHatch` probe `addSideHatch` takes, with an error recorded at (8192, 66, 8193) only → true;
  - the taken input hatch with an error recorded on the probe cell → false;
  - `rejectedAt` ignores an error object of another class (a plain `Object`, a `String`) and one whose cell differs in a single coordinate.

- [ ] **Step 2: Write the failing vocabulary check** `tests/unit/shared/hatch-kinds-java.test.ts`

`it('keeps the exporter\'s hatch kinds equal to the planner\'s')`: read `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/sections/HatchKinds.java` (`readFileSync`), collect every `new Kind("<name>", "<cls>", null | "<prefix>")` in order with `/new Kind\("([a-z_]+)", "(\w+)", (?:null|"([^"]+)")\)/g` → equals `EXPORT_HATCH_KINDS.map((k) => ({ name: k, cls: EXPORT_HATCH_CLASSES[k].cls, metaPrefix: EXPORT_HATCH_CLASSES[k].metaPrefix }))` (a `null` prefix read as `undefined`).

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/unit/shared/hatch-kinds-java.test.ts; (export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.6.0 ./gradlew test --tests '*HatchKindsTest' --tests '*ElementGroupsTest' --tests '*ElementLineTest' --tests '*HatchListsTest')`
Expected: FAIL — `HatchKinds.java` missing (ENOENT), and the Java classes do not compile.

- [ ] **Step 4: Implement the four classes** per the Interfaces block. `ElementGroups.key` exactly as its comment spells it, with the `long` casts. `HatchLists` caches per class the non-static fields (`Modifier.isStatic` false) whose type is assignable to `Collection` or `Map`, minus the `excluded` names (`getDeclaredFields()` in try/catch per class of the hierarchy, `setAccessible(true)` per field in try/catch; a class whose `getDeclaredFields()` throws is cached as unreadable, and `unreadableClass` names the first such class of a hierarchy — the probe then gives that machine no rules instead of partial ones, Task 3); it compares by `==`, descends exactly one level into collection elements and map values; `rejectedAt` reads `x`, `y`, `z` with `getDeclaredField` on the error's class, once per class; it never calls `getMethods()` (the 0.5.0 crop export failed on that: it resolves every public signature and one names a client-only class on a server).

- [ ] **Step 5: Run them to verify they pass**

Run: `npx vitest run tests/unit/shared && (export GRADLE_USER_HOME="$PWD/.local/gradle-home"; cd exporter-mod && VERSION=0.6.0 ./gradlew test)`
Expected: PASS; Gradle `BUILD SUCCESSFUL` with every test of `exporter-mod/build/test-results/test/` passing.

- [ ] **Step 6: Commit**

```bash
git add exporter-mod/src tests/unit/shared/hatch-kinds-java.test.ts
git commit -m "feat(exporter): hatch kinds, element groups, element JSON and the probe's verdict (hatch lists without mSmartInputHatches, no error on the cell)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: The probe in the structures section, exporter 0.6.0

**Files:**
- Create: `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/sections/StructureVisits.java`, `HatchProbe.java`
- Modify: `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/sections/StructuresSection.java` (`Placed` keeps its `Block` and whether the cell held a tile entity; `export`, `build`, `write`; `listIds` becomes package-private), `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/ExportContext.java` (`info`), `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/ExporterMod.java` (register the listener), `exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/Exporter.java` (the rules table gains "Structure elements", the wording of Task 1's `format.ts` rule)

**Interfaces:**
- Consumes: Task 2's `HatchKinds`, `ElementGroups`, `ElementLine`, `HatchLists`; StructureLib's `StructureLibAPI.enableInstrument/disableInstrument`, `StructureEvent.StructureElementVisitedEvent`, `StructureDefinition.getElements()`; GT's `MTEMultiBlockBase.checkStructure(boolean, IGregTechTileEntity)`, its private `structureErrors` (`List<StructureError>`, read by reflection: one `Field` from `MTEMultiBlockBase.class.getDeclaredField("structureErrors")` with `setAccessible(true)`, found once), `MTEHatch`, `GregTechAPI.METATILEENTITIES`, `GregTechAPI.sBlockMachines`, `IGregTechTileEntity.setInitialValuesAsNBT`.
- Produces: `ExportContext.info(String message)` (public: logs through `ExporterMod.LOG.info`, which stays package-private in `export`, and keeps nothing for the manifest — `HatchProbe` lives in `export.sections` and cannot reach `LOG`); `StructuresSection.listIds(List<Integer>)` package-private static (it is private today; `HatchProbe` is in the same package); the wire fields of entry 49 on every structure line the probe answered; `manifest.counts.hatchRules`; `public final class StructureVisits` with `public static final StructureVisits INSTANCE`, package-private `static final Object TOKEN`, `void start(World world, Map<Long, Integer> blockAt, ElementGroups.Visits visits)`, `void stop()`, `@SubscribeEvent public void onVisit(StructureEvent.StructureElementVisitedEvent e)`; `final class HatchProbe` with `HatchProbe(World world, Map<String, Integer> kinds, long budgetNanos)`, `Result probe(int id, IConstructable machine, List<StructuresSection.Placed> blocks)` (null when the machine gets no rules), `Result skip(int id)` (a truncated structure: counted, returns null), `boolean failedLast()` (the last `probe` failed after touching the world: it threw outside a single check, or GT's check walked differently after an element), `int probed()`, `void summarize(ExportContext ctx)`; `static final class Result { final List<ElementLine> elements; final int[] elementOf; }`.

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
mb = machine as an MTEMultiBlockBase
if the budget is used up (now > deadline)     → remember id under "budget", return null
if HatchLists.unreadableClass(mb) != null     → remember id under "failed" with "fields of <class> cannot be read here",
                                                return null (no partial rules; nothing in the world was touched)
base = mb.getBaseMetaTileEntity(); controller = the index of the block whose mte is this id
blockAt = key(pos) → index for every recorded block
walk() = { visits = new Visits(blocks.size());
           StructureVisits.INSTANCE.start(world, blockAt, visits); StructureLibAPI.enableInstrument(StructureVisits.TOKEN)
           try mb.checkStructure(true, base) finally { StructureLibAPI.disableInstrument(); StructureVisits.INSTANCE.stop() }
           return visits }
visits = walk()
if visits.visited() == 0                      → remember id under "no cell reached", return null
groups = ElementGroups.groups(visits, controller); count visits.conflicts() and the unreached blocks
   (blocks other than the controller never visited) for the summary
chars  = for a StructureDefinition: identity map element → its smallest character among getElements(); else empty
tile   = per block: the cell held a tile entity when it was recorded
for each group k (in order): cell = blocks[probeBlock(group, tile)]; takes = []
   for each (kind, hatchId) of kinds (in ALL order):
      if now > deadline → remember id under "budget"; return null   (the cell holds its own block again: every probe
                          restores it; this machine and every later one get no rules)
      try   { probe = placeHatch(cell, hatchId); mb.checkStructure(true, base);
              if HatchLists.taken(mb, probe, probe.getBaseMetaTileEntity(), HatchLists.EXCLUDED,
                                  structureErrors(mb), cell.x, cell.y, cell.z) takes.add(kind) }
      catch (Throwable t) { count one check error for this id (keep the first message with its kind) }
      finally { restore(cell) }
   if !ElementGroups.sameGroups(groups, ElementGroups.groups(walk(), controller))
                        → failedLast = true, remember id under "failed" with "GT's check walked differently after
                          probing element <k>", return null   (a restore that did not give the cell back, Review Focus 1)
   elements.add(new ElementLine(chars.get(group.element) as a String or null, takes)); elementOf[b] = k for b in group.blocks
elementOf = -1 everywhere else (the controller, unreached and conflicting blocks); probed += 1
return new Result(elements, elementOf)
anything thrown outside the per-check try (the baseline check, grouping, a restore, a re-walk) → failedLast = true,
   remember id under "failed" with the message, return null
structureErrors(mb): the List in mb's private field MTEMultiBlockBase.structureErrors, as checkStructure left it
placeHatch(cell, id): setBlock(cell, Blocks.air, 0, 2); setBlock(cell, GregTechAPI.sBlockMachines,
   METATILEENTITIES[id].getTileEntityBaseType(), 2) or throw; the IGregTechTileEntity there gets
   setInitialValuesAsNBT(null, (short) id); return its getMetaTileEntity()
restore(cell): setBlock(cell, Blocks.air, 0, 2); then the recorded block — a GT machine through placeHatch(cell, mte),
   else setBlock(cell, block, meta, 2)
```
Air first, both ways: `World.setBlock` with the block and meta already there changes nothing and would leave the old tile entity. A restore gives a tile entity its default state, so the probe prefers a cell that has none (`probeBlock`), and the re-walk after each element catches a cell that came back different.

`StructuresSection` changes:
- `Placed` gains `final Block block` and `final boolean tile` (set in `record`: `world.getTileEntity(x, y, z) != null`), package-private so `HatchProbe` reads `pos`, `block`, `meta`, `mte`, `tile`.
- `export()`: after `multiblocks(…)`, `kinds = HatchKinds.representatives(candidates)` with one `Candidate(id, m.getClass().getSimpleName(), m.getMetaName())` per `METATILEENTITIES[id] instanceof MTEHatch`, in id order; one warning `structures: no hatch of class <cls> in this pack, hatch kind <name> not probed` per kind of `ALL` missing from it; `budgetNanos` from `Integer.getInteger("gtnhplanner.hatchProbeBudgetSeconds", 120)`; after the loop `ctx.count("hatchRules", probe.probed())` and `probe.summarize(ctx)`.
- `build(…)` gains the `HatchProbe`: after the air cells, `Result rules = truncated ? probe.skip(id) : probe.probe(id, machine, blocks)`; `write` writes `ElementLine.write(j, rules.elements, rules.elementOf)` after `air` when `rules != null`; when `probe.failedLast()`, the cells to clear are `nonAir(world, BOX)`, as for a failed build.
- `summarize` writes one warning per non-empty group, ids through `StructuresSection.listIds` (first 20, then `…`): `structures: hatch probe skipped for <n> multiblocks whose controller is not an MTEMultiBlockBase: <ids>`; `structures: hatch probe skipped for <n> truncated structures: <ids>`; `structures: GT's structure check of <n> multiblocks reached no cell, no hatch rules: <ids>`; `structures: <c> cells of <n> multiblocks were checked by two elements and take no hatch: <ids>`; `structures: <c> cells of <n> multiblocks were never reached by GT's structure check and take no hatch: <ids>`; `structures: <c> hatch probe checks threw and count as not taken, in <n> multiblocks: <ids>; first: <id> <kind>: <message>`; `structures: the hatch probe failed for <n> multiblocks, no hatch rules: <ids>; first: <id>: <message>` (a throw, a walk that changed after an element, a class whose fields cannot be read — each message names which); `structures: hatch probe budget of <s> s (gtnhplanner.hatchProbeBudgetSeconds) used up, <n> multiblocks without hatch rules: <ids>`; and `ctx.info("structures: hatch probes on <n> multiblocks: <m> checks in <t> ms")`.
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

### Task 5: The layout uses the export's hatch rules, narrowed by a fitting table row (after the hatch-rules fix is merged)

**Files:**
- Create: `src/server/layout/hatch-export.ts`, `tests/helpers/hatch-export-fixtures.ts`, `tests/unit/layout/hatch-export.test.ts`
- Modify: `src/server/layout/hatch-rules.ts` (the fix's rule module), `src/server/layout/arrange.ts` (`multiblockShape`)

**Interfaces:**
- Consumes (the fix's committed names, as of `fix/hatch-rules` `6ba6374`; lines move while the fix is built, so Step 1 checks them by role on the merged main): in `src/server/layout/hatch-rules.ts` `hatchRuleFor(m): HatchRule | null` (276), `rulePower(rule): RulePower` (281, `'eu' | 'steam' | 'none'`), `ruleNeeds(rule): HatchNeed[]` (286), `elementMap(rule, controller, size): Map<string, string>` (293, posKey → shape character), `ruleFits(rule, controller, size, blocks): boolean` (319), `elementTakes(rule, char, kind): boolean` (326), `ruleTakes(rule, kind): boolean` (331); `HatchRule` with its notes (`pieces`, `elements`, `needs`, `handNote`, `power`, `casingMin`, `layerOutputs`, `fluidInputSlots`, `classes`, `byHand`); in `src/server/layout/arrange.ts` `genericHatches(…)` (311), `growLayers(shape, extra)` (456), `ruledHatches(…)` (486, which reads a rule only through those functions and its notes), `multiblockShape(pack, m, s, io, circuit, warnings): MultiblockShape` (642, `{ shape, io, electric }`; `electric` = `m.kind !== 'steam' && rulePower(rule) === 'eu'`, `steam_machine` when the power is steam), and `unitsFromPlan`, which sends only `m.kind === 'multiblock'` to `multiblockShape` (692; a `'steam'` machine is a singleblock); `HatchKind` with `'muffler'` and `'steam'`; `UnitCell.face`, `UnitCell.fluid`; warning codes `hatch_rules_unknown`, `hatch_not_taken`, `hatch_cells_short`, `hatch_by_hand`, `steam_machine`; the fix's fixtures `hatchPack()`, `HATCH_IDS` (DT 1126, CRACKER 1160, PYRO 15546, BBF 140, STEAM_MIXER 31084, STEAM_BUS_IN 31046, STEAM_BUS_OUT 31047, STEAM_HATCH 31040), `dtStructure()` and `fluidRecipe(id, fluidIn, outputs)` in `tests/helpers/hatch-fixtures.ts`, `IDS.MUFFLER` (91) in `tests/helpers/layout-fixtures.ts`; Task 4's `StructureInfo.elements`.
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
- Produces (the rule module, `src/server/layout/hatch-rules.ts`): `HatchRule.exported?: ExportedCells` (optional addition (add-on 20)); `type HatchSource = 'both' | 'export' | 'table'`; `hatchRulesOf(m: Machine): { rule: HatchRule; source: HatchSource; rowUnfit: boolean } | null`. Behaviour: `cells = exportedCells(m)`, `row = hatchRuleFor(m)`, `fits = row !== null && ruleFits(row, st.controller, st.size, st.blocks' positions)`:
  - `cells` and `fits` → source `'both'`: `{ ...row, elements: narrowed, exported: cells }`, where `narrowed[ch]` keeps, in the row's order, the kinds of `row.elements[ch]` that `cells` gives on every covered exported cell whose character in `elementMap(row, st.controller, st.size)` is `ch` (a character with no covered cell keeps none) — per cell the export ∩ the row, since one character is one element of GT's definition (a character whose cells the export treats differently is a row error, which Task 7 test 3 reports); the row's pieces and notes (`needs`, `handNote`, `power`, `casingMin`, `layerOutputs`, `fluidInputSlots`, `classes`, `byHand`) unchanged. Where the export takes more than the row (the cracker's sides, the tower's top centre: Evidence 11) the row wins; nothing is said at run time, since the layout stays inside both.
  - `cells` and not `fits` → source `'export'`, `rowUnfit: row !== null`: `{ cls: the controller's simple class name, evidence: 'exporter 0.6.0 structure elements', pieces: [], elements: the export's characters → their layout kinds (from `cells.takes`), classes: cells.classes, power: exportedPower(cells), exported: cells }` — no needs, notes or casing minimums.
  - no `cells` and `fits` → source `'table'`: `row` as it is. Otherwise null.
  - For a rule with `exported`: `ruleFits` is true; `elementMap(rule, controller, size)` is, for a rule with pieces (`'both'`), the row's map restricted to the cells `grownCells(rule.exported, size[1] − rule.exported.height).charOf` has, keeping the controller's `~` and the air `-` entries (a cell the export does not cover takes nothing, Review Focus 2), and, for one without pieces (`'export'`), `grownCells(…).charOf` itself; `elementTakes`, `ruleTakes`, `rulePower` and `ruleNeeds` read the rule's own `elements`, `power` and `needs` as for any row, so `ruledHatches` needs no change.
- Produces (`arrange.ts`): `multiblockShape` takes its rule from `hatchRulesOf(m)` (null → `hatch_rules_unknown` and the generic placement, as before; `'both'` and `'table'` → no new warning); source `'export'` → warning `hatch_notes_unfit` when `rowUnfit`, with text `` `${m.name}: the planner's notes for this machine do not fit its exported structure, so its hatches follow GregTech's per-casing rules from the export alone; GregTech checks more in the controller — check in game that it forms` ``, else `hatch_rules_export_only` with text `` `${m.name}: its hatches go where GregTech's structure check takes them on each casing; GregTech checks more in the controller (sides, layers, line length) than the planner has notes for here — check in game that it forms` `` (every export-ruled machine without a row: the Assembly Line, the Advanced Assembly Line, the Sparge Tower and the Advanced Distillation Tower among them); an electric unit whose `rule.exported.anywhere` has `energy_multi` or `energy_laser` but not `energy` → warning `hatch_energy_exotic` with text `` `${m.name} takes only multi-amp or laser energy hatches in GregTech: place one by hand` `` (it then gets no energy hatch, as the fix leaves an energy hatch no cell takes). `unitsFromPlan` stays as the fix has it: only `kind: 'multiblock'` machines reach `multiblockShape`.
- Produces (`tests/helpers/hatch-export-fixtures.ts`): `interface ElementSpec { ch?: string; hatches: ExportHatchKind[]; where: (pos: Vec3) => boolean }`; `withElements(structure: StructureInfo, specs: readonly ElementSpec[]): StructureInfo` (a copy whose element k holds the non-controller blocks whose first matching spec is k, in block order; blocks no spec matches belong to none); `rowElements(m: Machine, kinds: Readonly<Record<string, readonly ExportHatchKind[]>>): ElementSpec[]` (one spec per character of `kinds`, in its order: `ch` that character, `where` the cells whose character in `elementMap(hatchRuleFor(m)!, controller, size)` of `m`'s structure it is); `FRONT_BOX_ID = 4242`, `STEAM_BOX_ID = 4243`; `FRONT_BOX_STRUCTURE` (3×2×3 of `gregtech:gt.blockcasings4`@1, controller at (1, 0, 0), no air); `FRONT_BOX_ELEMENTS` = `a` (y 0, z 0) `['input_bus', 'output_bus']`, `k` (y 0, z 2) `['energy', 'maintenance']`, `u` (y 1, z 2) `['input_hatch', 'output_hatch']`, `c` (the rest) `[]`; `hatchExportPack(): Pack` = the fix's `hatchPack()` (`layoutPack()` with the EBF 1000, the Muffler Hatch (LV) 91, the Distillation Tower 1126 on `dtStructure()`, the Oil Cracking Unit 1160, the Pyrolyse Oven, the steam hatches 31040, 31046 and 31047 and their fluids) plus the multiblocks 4242 (`kind: 'multiblock'`, cls `gregtech.api.metatileentity.implementations.MTETestFrontBox`, structure `FRONT_BOX_STRUCTURE` without elements) and 4243 (the same structure, also `kind: 'multiblock'` — as the export gives GT++'s steam multiblocks, 31041 `MTESteamMacerator` and 31084 `MTESteamMixer` — cls `…MTETestSteamBox`), and the fluids `fluid:t1`…`fluid:t4` ("Test Fluid 1"…"4").

- [ ] **Step 1: Take in main and check the fix's names**

Run (worktree root): `git merge main` (the merge must contain `fix/hatch-rules`; `git branch --contains fix/hatch-rules | grep -c main` → `1`; when `fix/steam-primitive` or add-on 17 merged into main first, resolve the conflicts in `arrange.ts`, the architecture file, `format.ts`, `load.ts`, `pack.ts` or `Exporter.java` by keeping both sides), then
`grep -rn -E "function (hatchRuleFor|rulePower|ruleNeeds|elementMap|ruleFits|elementTakes|ruleTakes|growLayers|multiblockShape|ruledHatches|genericHatches|unitsFromPlan)\b|interface HatchRule\b|'hatch_rules_unknown'|'hatch_not_taken'|'hatch_cells_short'|'steam_machine'" src/server/layout`
and `npm run typecheck && npx vitest run tests/unit/layout`.
Expected: every role found (record `name → file:line` for the commit message; where the merged fix named a role differently, use its name with the same role everywhere below); the layout suite passes. A role that is missing altogether → stop and report to the controller.

- [ ] **Step 2: Write the failing tests** `tests/unit/layout/hatch-export.test.ts`, with `hatchExportPack()`, `makePlan` and `unitsFromPlan`; `OX = 'fluid:oxygen'`, `MI = 'fluid:molten.iron'`; the FRONT_BOX step `{ id: 'f', mteId: 4242, count: 1, tier: 1, euPerTick: 30, inputs: [['t:in@0', 1], [OX, 1000]], outputs: [['t:dust@0', 1], [MI, 144]] }`; the EBF step `{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, euPerTick: 120, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1], [MI, 144]] }`; "hatch cells" = the unit's cells with `hatch` set:

1. `it('puts every hatch on a cell whose element GregTech lets take it')` — FRONT_BOX with `FRONT_BOX_ELEMENTS` → its buses at y 0, z 0; energy and maintenance at y 0, z 2; input and output hatch at y 1, z 2; exactly one `hatch_rules_export_only` (step `f`, as no row knows the machine), no warning `hatch_rules_unknown`, `hatch_cells_short` or `hatch_not_taken`.
2. `it('takes only what both the export and the hand table allow')` — the EBF with elements `b` (y 0) `['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'maintenance']`, `C` (y 1–2) `[]`, `m` ((1, 3, 1)) `['muffler']`, `f` (the rest of y 3) `[]` → the output hatch's y is 0 (the row's top ring takes output hatches, this export does not); no `hatch_rules_unknown` or `hatch_rules_export_only`.
3. `it('uses the hand table for an export without hatch rules')` — the EBF as the fix's fixtures have it, no elements → the output hatch's y is 3 (the top ring takes output hatches); no `hatch_rules_unknown`.
4. `it('warns and places generically when neither the export nor the table knows the machine')` — FRONT_BOX without elements → one `hatch_rules_unknown` for step `f`.
5. `it('picks a steam bus and a steam hatch where GregTech takes only those')` — STEAM_BOX (`kind: 'multiblock'`) with `a` `['steam_input_bus', 'steam_output_bus']`, `k` `['steam_hatch']`, the rest `[]`, the step `{ id: 's', mteId: 4243, inputs: [['t:in@0', 1]], outputs: [['t:dust@0', 1]] }` → the input bus cell's `block.mteId` 31046, the output bus's 31047, a `steam` cell holding 31040 at y 0, z 2, no `energy` cell, the unit not `electric` (its power is `exportedPower`'s `'steam'`); warning codes include `steam_machine` and `hatch_rules_export_only` and not `hatch_rules_unknown`.
6. `it('grows the exported cells with a taller tower')` — pure: a 3×3×3 tower's cells (y 0 `b` but the controller (1, 0, 0); y 1 ring `l`, centre absent; y 2 ring `l`, centre `c`), `grownCells(…, 2)` → height 5; y 1, 2 and 3 rings `l`; (1, 2, 1) and (1, 3, 1) absent; y 4 ring `l` and (1, 4, 1) `c`; y 0 unchanged; `grownCells(…, 0)` returns the same maps.
7. `it('says a needed hatch the export takes nowhere is not taken')` — FRONT_BOX with `u` `['output_hatch']` only → a `hatch_not_taken` warning whose text contains `input hatch`; no `input_hatch` cell.
8. `it('says when a machine takes only multi-amp or laser energy hatches')` — FRONT_BOX with `k` `['energy_multi', 'maintenance']` → one `hatch_energy_exotic`, no `energy` cell, no `hatch_not_taken` naming `energy`.
9. `it('gives an element without a character its own')` — `FRONT_BOX_ELEMENTS` without `ch` → the hatch cells (pos, kind, block) equal test 1's.
10. `it('places hatches only on the cells the export covers')` — FRONT_BOX with only `a` (y 0, z 0) `['input_bus', 'output_bus']` and `k` on the one cell (0, 0, 2) `['energy', 'maintenance']` (no other element), a step with items only → every hatch cell is (0, 0, 0), (2, 0, 0) or (0, 0, 2); exactly one of energy and maintenance is placed, at (0, 0, 2), and a `hatch_cells_short` warning names the other.
11. `it('keeps each multiblock of one line on its own source')` — `makePlan([FRONT_BOX step with FRONT_BOX_ELEMENTS, { id: 'a2', mteId: IDS.AIR_MULTI, count: 1, inputs: [['t:dust@0', 1]] }])` → exactly one `hatch_rules_unknown`, with `stepId` `a2`, and exactly one `hatch_rules_export_only`, with `stepId` `f`.
12. `it('keeps the muffler GregTech requires on its cell')` — the EBF with a muffler (91) block at (1, 3, 1) and the elements of test 2 except `f` (rest of y 3) `['output_hatch']` → (1, 3, 1) has `hatch: 'muffler'`; no other cell is a muffler; the output hatch is not at (1, 3, 1).
13. `it('drops table notes that do not fit the exported structure, and says so')` — the EBF structure with a fifth layer of casings on top (3×5×3) and elements `b` (y 0) as in test 2, `z` (the rest) `[]` → one `hatch_notes_unfit`, no `hatch_rules_unknown` or `hatch_rules_export_only`, every hatch cell at y 0.
14. `it('builds a taller tower by the exported rules and keeps its top centre free')` — the Distillation Tower 1126 of `hatchExportPack()` (the fix's row fits its `dtStructure()`) with `rowElements` `b` `['input_bus', 'output_bus', 'input_hatch', 'energy', 'maintenance']`, `l` `['output_hatch', 'energy', 'maintenance']`, `c` `['output_bus', 'output_hatch', 'maintenance']` (what GT takes there: Evidence 11); the step `{ id: 'd', mteId: 1126, count: 1, tier: 3, euPerTick: 480, inputs: [['t:in@0', 1]], outputs: [['fluid:t1', 100], ['fluid:t2', 100], ['fluid:t3', 100], ['fluid:t4', 100]] }` and `pack.recipeById.set('d', fluidRecipe('d', [], those outputs))` (a step's recipe id is its id) → the unit's size is [3, 5, 3]; exactly one output hatch on each of y 1, 2, 3, 4, `fluid:tk` on layer k; each on a ring cell (row character `l`); no hatch on the centre column (x 1, z 1), whose `c` the row keeps free though GT's casing takes output hatches there.
15. `it('reads the export elements into layout kinds')` — pure: `exportedCells` of a FRONT_BOX copy with elements `{ ch: 'a', hatches: ['input_bus', 'steam_input_bus', 'energy'], where: y 0 }` and `{ hatches: ['steam_output_bus'], where: y 1 }` → `charOf.get(posKey([0, 0, 0]))` `'a'`, `charOf.get(posKey([0, 1, 0]))` `'#1'`; `takes.get('a')` = {`input_bus`, `energy`}; `takes.get('#1')` = {`output_bus`}; `classes` = `{ output_bus: 'MTEHatchSteamBusOutput' }`; `exportedCells` of a machine without elements is `null`.
16. `it('tells the power from the export')` — `exportedPower` of cells taking `energy` → `'eu'`, only `energy_multi` → `'eu'`, only `steam_hatch` → `'steam'`, only `coke_oven_hatch` → `'none'`.
17. `it("keeps a cracker's inputs on one side and its outputs on the other where GregTech takes both on each side")` — the Oil Cracking Unit 1160 of `hatchExportPack()` with `rowElements` `l` and `r` `['input_hatch', 'output_hatch', 'energy', 'maintenance']` (Evidence 11), `m` `['input_bus', 'input_hatch', 'energy', 'maintenance']`, `c` `[]`; `pack.recipeById.set('k', fluidRecipe('k', ['fluid:heavyfuel', 'fluid:steam'], [['fluid:crackedheavy', 100], ['fluid:woodtar', 100]]))` (the fix's own cracker test, with a second output) and the step `{ id: 'k', mteId: 1160, count: 1, tier: 3, inputs: [['fluid:heavyfuel', 100], ['fluid:steam', 100]], outputs: [['fluid:crackedheavy', 100], ['fluid:woodtar', 100]] }` → the heavy fuel's input hatch at x 4 (row character `l`), the steam's at x 2 (`m`), both output hatches at x 0 (`r`); no `hatch_rules_unknown` or `hatch_rules_export_only`.
18. `it('narrows a fitting row by the export, and names each source')` — pure, `hatchRulesOf`: the cracker of test 17 → source `'both'`, `rule.elements.l` `['input_hatch', 'energy', 'maintenance']`, `rule.elements.r` `['output_hatch', 'energy', 'maintenance']`, `rule.fluidInputSlots` the row's; the EBF of test 2 → `'both'` with `rule.elements.f` `[]` and `rule.elements.b` the row's six; FRONT_BOX with `FRONT_BOX_ELEMENTS` → `'export'`, `rowUnfit` false, `rulePower` `'eu'`; the EBF of test 13 → `'export'`, `rowUnfit` true; the EBF without elements → `'table'`; FRONT_BOX without elements → `null`.

- [ ] **Step 3: Run them to verify they fail**

Run: `npx vitest run tests/unit/layout/hatch-export.test.ts`
Expected: FAIL — `hatch-export.ts` missing.

- [ ] **Step 4: Implement** `hatch-export.ts`, the rule module's additions (`hatchRulesOf`, `elementMap` and `ruleFits` for a rule with `exported`) and `multiblockShape`'s lookup and warnings per the Interfaces block; `ruledHatches` and `unitsFromPlan` keep the fix's code.

- [ ] **Step 5: Run them, then the layout and planner suites**

Run: `npm run typecheck && npx vitest run tests/unit/layout tests/unit/planner tests/unit/projector`
Expected: PASS — the fix's own tests unchanged (their structures carry no elements).

- [ ] **Step 6: Commit**

```bash
git add src/server/layout tests/helpers/hatch-export-fixtures.ts tests/unit/layout/hatch-export.test.ts
git commit -m "feat(layout): hatches where both GregTech's rules from the export and a fitting table row allow them, the export alone with a warning, the table alone for older exports

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
- Create: `tests/helpers/real-corpus.ts` (`CORPUS`, `VARIANTS` and their `Target` type, moved under their current names from `tests/unit/planner/real-corpus.test.ts`, which then imports them), `tests/unit/layout/real-hatch-export.test.ts`
- Modify: `tests/unit/planner/real-corpus.test.ts` (imports only), `README.md` ("Export your pack": one sentence after the 0.4.0 one; "Line layout and 3D view": a **Hatches** bullet), `docs/research/gt-mechanics.md` §5.5 (the measured lines)
- Local only, never committed: `data/` (symlinks and `real-config.json`), `docs/local/export-runs.md`

**Interfaces:**
- Consumes: everything above; `planLine`, `emptyContext` (`src/server/planner/plan.ts`), `defaultSettings`, `unitsFromPlan`, `layoutLine`, `emptyScan`, `makeProject`, `hatchRuleFor`/`ruleFits`/`elementMap`/`elementTakes` (the fix's names from Task 5 Step 1), `hatchRulesOf`, `exportedCells`, `KIND_SOURCES`, `exportKindOfClass`, `simpleClassName`; the fix's real-data test `tests/unit/layout/real-hatch-rules.test.ts` (it checks every placed hatch against the table row and logs the layout's warning codes per mode).
- Produces: the table-ruled baseline of the current export, the 0.6.0 export (activated only in the worktree's `data/real-config.json`), its record, the acceptance test.

- [ ] **Step 1: Preconditions, the jar for the controller and the table-ruled baseline**

Precondition: add-on 17's crop exporter fix is in main — `git log main --format=%s | grep -c 'exporter 0\.5\.1'` ≥ 1 (add-on 17's commit "fix(exporter): the crop table adds no items; items the table lacks are inline (exporter 0.5.1)"); else stop and report to the controller: the one export of this plan would ship without `crops.jsonl.gz` (the 0.5.0 crop section fails). Then, when main moved since Task 5, `git merge main` (add-on 17's conflicts in `format.ts`, `load.ts`, `pack.ts` and `Exporter.java`: keep both sides) and `npm run typecheck && npx vitest run tests/unit/pack tests/unit/shared tests/unit/layout`. Run Task 3 Step 2's command again on the final branch, then `shasum exporter-mod/build/libs/gtnhplannerexport-0.6.0.jar`; report the jar's path and sha1 to the controller.

The baseline, from the worktree root, before the export (the fix's own real-data test on main's active export, whose structures have no `elements`):
```bash
mkdir -p data && for d in export assets; do [ -e data/$d ] || ln -s <repo>/data/$d data/$d; done
python3 -I -c "import json,os; c=json.load(open('<repo>/data/config.json')); json.dump({'dataDir': os.path.abspath('data'), 'serverFolder': c['serverFolder'], 'activeExportId': c['activeExportId'], 'host': '127.0.0.1', 'port': 18800}, open('data/real-config.json','w'), indent=2)"
GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npx vitest run tests/unit/layout/real-hatch-rules.test.ts
```
(only `serverFolder` and `activeExportId` are read from main's config; nothing is printed from it). Expected: PASS (a failure is the hatch-rules fix's, reported to the controller before any export); keep its `real-hatch-rules:` log line (placed multiblock steps with and without a row, the layout's warning codes per mode, `hatch_cells_short` among them) in `docs/local/export-runs.md` under a heading "table-ruled baseline before the 0.6.0 export", with the export id. Nobody has shown that the table-ruled corpus layout is free of `hatch_cells_short`, so test 4 below asserts "no new ones", comparing with the same table-ruled layout computed on the 0.6.0 export.

- [ ] **Step 2: Controller step (not the implementer's) — the one re-export on the APFS clone**

From the worktree root, once (`data/real-config.json` from Step 1):
```bash
pgrep -f lwjgl3ify-forgePatches.jar; lsof -nP -iTCP:25566 -sTCP:LISTEN; mkdir -p .local && touch .local/run-start.marker
GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npm run export -- --jar exporter-mod/build/libs/gtnhplannerexport-0.6.0.jar
```
Expected: the live server's pid before and after is the same, port 25566 free before; exit 0; one new folder in `data/export` (nothing existing changes), activated only in `data/real-config.json`; its manifest: `exporterVersion` `0.6.0`, `counts.hatchRules` ≥ 300, `failedSections` `[]` and `crops.jsonl.gz` present (add-on 17's 0.5.1 crop section is in the jar, Step 1), `sectionMillis.structures` recorded; `export-run.log` has `structures: hatch probes on <n> multiblocks: <m> checks in <t> ms`. Afterwards `find <serverFolder>/mods <serverFolder>/config <serverFolder>/server.properties -newer .local/run-start.marker` prints nothing and the clone is gone. Write `docs/local/export-runs.md`'s new section: date, export id, jar sha1, wall clock (clone, boot, export, total), `sectionMillis`, every count, the probe log line, every `structures:` warning, the live-server checks. One run, never retried: a failed run is recorded and handed back. Main's active export is switched later, by the controller, only on the user's yes.

- [ ] **Step 3: Write the real-data acceptance** `tests/unit/layout/real-hatch-export.test.ts` (`describe.skipIf(process.env.GTNH_LOCAL !== '1')`, the pack loaded once in `beforeAll` with a 300 s timeout; `UNPROBED = new Set([140])`, the Bricked Blast Furnace; `takes(mteId, ch)` = the `hatches` of that machine's element with that character, failing when there is none):

1. `it('carries GregTech\'s hatch rules')` — `manifest.exporterVersion` is `'0.6.0'`; `manifest.counts.hatchRules` ≥ 300 and equals the number of machines whose structure has `elements`; machine 140 has a structure and no `elements`; 3013 and 15411 have none; logs that count and every manifest warning that starts `structures:`.
2. `it('matches the definitions read from the jars')` — exact lists (`toEqual`, in `EXPORT_HATCH_KINDS` order), so a probe GT filed and then rejected (Evidence 9) fails here: EBF 1000: `takes('b')` = `['input_bus', 'output_bus', 'input_hatch', 'output_hatch', 'energy', 'maintenance']`, `takes('f')` = `['output_hatch']`, `takes('m')` = `['muffler']`, `takes('C')` = `[]`. Distillation Tower 1126: `b` = `['input_bus', 'output_bus', 'input_hatch', 'energy', 'maintenance']`; `l` = `['output_hatch', 'energy', 'maintenance']`; `c` = `['output_bus', 'output_hatch', 'maintenance']`. Oil Cracking Unit 1160: `l` = `r` = `['input_hatch', 'output_hatch', 'energy', 'maintenance']`; `m` = `['input_bus', 'input_hatch', 'energy', 'maintenance']`. Pyrolyse Oven 15546: `F` = `['input_bus', 'input_hatch', 'muffler']`; `G` = `['output_bus', 'output_hatch', 'energy', 'maintenance']`. Large Chemical Reactor 1169: `c` = `x` = the EBF's `b` list; `P` = `[]`. Coke Oven 236: some element takes `coke_oven_hatch` (logged with the rest of its elements, for the queued Coke Oven task). It also logs, for review and without asserting, the machines with an element that takes a steam kind (`steam_input_bus`, `steam_output_bus`, `steam_hatch`) or `data_access`: with the verdict of Task 2 these are steam multiblocks and data-stick machines (the Assembly Lines), where before it they were nearly every machine with an input adder.
3. `it('agrees with the hand table wherever both have rules, apart from the listed controller logic')` — for every machine with `elements` whose table row fits its exported structure: for each exported cell the export covers and each layout kind, the row's answer (`elementTakes(row, elementMap(row, st.controller, st.size).get(cell), kind)`, `row = hatchRuleFor(m)`) against the export's (`exportedCells(m).takes` of the cell's character). A cell where the row takes a kind the export does not is a problem (`<cls> '<ch>' <kind> at <x,y,z>: the table takes it, GregTech's check does not` — a row error, to fix in the hatch-rules table). A cell where the export takes a kind the row does not is a problem unless `EXPORT_WIDER` lists that class, row character and kind — the documented controller logic of Evidence 11, kept in the test with its evidence: `MTEOilCracker` `l` `output_hatch` and `r` `input_hatch` (each side adder takes either hatch; the first one found fixes the side, `mInputOnSide`); `MTEDistillationTower` `c` `output_bus`, `output_hatch`, `maintenance` (the top centre files into `mOutputHatches`, which no layer reads; the row keeps the centre free). The problem list must be empty; the covered and uncovered cell counts per machine and every `EXPORT_WIDER` entry with the number of cells it matched are logged (an entry that matched none is logged as stale).
4. `it('forms every corpus multiblock by the exported rules in every logistics mode')` (timeout 1 800 000 ms) — each of `CORPUS` × `VARIANTS` (from `tests/helpers/real-corpus.ts`) planned as `tests/unit/planner/real-corpus.test.ts` plans it (`planLine(pack, { ...defaultSettings(), target: t.key, amount: t.amount, per: v.per, tier: t.tier, routeDerived: v.routeDerived }, emptyContext())`, `status` `ok`); for every multiblock unit of `unitsFromPlan(pack, plan)`: its machine has `elements` unless it is in `UNPROBED` (whose units skip the cell checks); every cell with `hatch` set holds a hatch whose `exportKindOfClass(class, metaName)` is one of `KIND_SOURCES[cell.hatch]`, is taken by the export's element of that cell (`exportedCells`, grown with the unit as `grownCells` grows it) and, when the machine's row fits, by the row's character there (`elementTakes(row, elementMap(row, controller, u.size).get(cell), cell.hatch)`); every exported hatch cell (role `hatch`, no `hatch`) of a known kind is taken by its element. Then for each of the four modes, `layoutLine(pack, plan, emptyScan(), makeProject({ logistics: mode }))` against the table-ruled layout of the same plan and mode, `layoutLine(tablePack, …)` with `tablePack = { ...pack, machines: a copy of pack.machines whose structures lack elements }` (the hatch-rules fix's own behaviour on this export, as Step 1's baseline records it on the previous one): no `hatch_rules_unknown` for a step whose machine is not in `UNPROBED`, and per step no more `hatch_cells_short` or `hatch_notes_unfit` warnings than the table-ruled layout gives that step. A unit run by hand (`Unit.manual`, when `fix/steam-primitive` is in main) has no hatch cells to check. Every problem is collected as `<target> <variant> <mode> <machine>: <problem>` and the list must be empty; the multiblocks met are logged with their counts and must include 1000, 1126, 1160, 1169, 1002, 15546, 236 and 140 (the EBF, Distillation Tower, Oil Cracking Unit, Large Chemical Reactor, Vacuum Freezer, Pyrolyse Oven, Coke Oven and Bricked Blast Furnace the corpus places), and the warning codes of both layouts are logged per mode. A failure is never fixed by loosening these assertions: record it and stop for the controller.

- [ ] **Step 4: Run the real-data checks**

Run: `GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npx vitest run tests/unit/layout/real-hatch-export.test.ts tests/unit/layout/real-hatch-rules.test.ts tests/unit/planner/real-corpus.test.ts` (the 0.6.0 export active in `data/real-config.json`)
Expected: PASS, with the logs above; `real-hatch-rules.test.ts` (the fix's) passes on the export-ruled layout, so every placed hatch is also where the table puts it; `real-corpus.test.ts` passes as before the move. Add the `real-hatch-rules:` log line to `docs/local/export-runs.md` beside Step 1's baseline.

- [ ] **Step 5: README and research**

README, "Export your pack", after the 0.4.0 sentence: `Exporter 0.6.0 also records, for every multiblock, which hatches GregTech's own structure check takes on each of its casings, so the layout puts each hatch where the machine forms; with an older export the planner falls back to its own notes for the common machines and says so elsewhere.` "Line layout and 3D view", a bullet after **Facing**: `**Hatches:** each multiblock's hatches go only on casings GregTech takes them on (exporter 0.6.0 and later); for the common machines the planner's own notes add what GregTech checks in the controller itself and keep the hatches inside it — an output hatch on every layer of a distillation tower and none on its top centre, a cracker's inputs on one side and outputs on the other with the catalyst in the middle. A multiblock the planner has no notes for is placed by GregTech's per-casing rules alone, with a note to check in game that it forms; one that takes only multi-amp or laser energy hatches is flagged and not wired.` In `gt-mechanics.md` §5.5, a closing line "As measured (2026-…): `hatchRules` <n> of 326 structures; structures section <before> → <after> ms; <m> probe checks in <t> ms; `structures.jsonl.gz` <bytes>." with Step 2's numbers (no export id, no path).

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

1. **Start Tasks 1–4 now, beside the hatch-rules fix?** They touch none of its files and need none of its code; only Tasks 5–7 need it merged. The user asked for parallel lanes instead of a queue; the controller's sequencing put the whole add-on after the fix. Tasks 1–4 share four files with add-on 17 and the architecture file with `fix/steam-primitive`; those are textual conflicts at the next merge of main, not a reason to wait. *Recommendation:* run Tasks 1–4 now in a lane of their own, Task 5 onward after the fix merges.
2. **The controller notes stay hand-kept, and the table's element lists keep counting.** GregTech checks a distillation tower's output hatch per layer, the cracker's input side and catalyst hatch, casing minimums and steam power in each controller's own code after the walk, and some casings take hatches the controller then cannot use (Evidences 5 and 11); no structure probe sees that. *Recommendation:* keep the fix's table as it is: where its row fits, the layout uses the export ∩ the row, so the row's element lists still narrow GT's per-casing acceptance (the cracker's sides, the tower's top centre), and Task 7 test 3 catches a row that takes more than GT does. Later, `StructureWrapper` machines' `minCasingCounts` could be exported too.
3. **Which hatch kinds to probe.** 17 kinds cost about 0.6–1.8 s each over all structures (the +10–30 s estimate of Measured costs). ME hatches (stocking input bus and hatch, ME output bus and hatch, crafting input buffer), wireless energy, quadruple input hatches, TecTech data and parameter hatches and about 90 other hatch classes are not probed. *Recommendation:* add a kind when a planner feature places it (one line in `HatchKinds.ALL` and `EXPORT_HATCH_KINDS`, then a re-export).
4. **Hatch-only cells other than the muffler.** The hologram build fills them from GT's creative source: debug input hatches and buses in 9 structures, ULV dynamos in 19 generators, turbine hatches, ME output hatches. The export now says which kinds those cells take, but this plan keeps the exported hatch as today. *Recommendation:* a follow-up that turns each into the step's own hatch of a kind its element takes and counts it toward the step's needs, as the fix does for the muffler.
5. **One export for two add-ons.** Add-on 17's crop fix (exporter 0.5.1) also waits for a re-export, and Task 7 Step 1 now requires it in main. *Recommendation:* merge that fix into main before Task 7 (it is in review), so the one 0.6.0 export carries the crop table and the hatch rules; switching main's active export stays the user's call.
6. **Facing.** The probe leaves each test hatch at its default facing; no adder of GT 5.09.54.183 reads a hatch's facing (`allowOnly`/`disallowOnly` act on auto-placement only). *Recommendation:* accept; the in-game checklist would show a counter-example.
7. **Which export-ruled machines warn `hatch_rules_export_only`.** The exporter cannot tell which controllers check more after the walk (layered, sided or length-dependent adders such as the Assembly Line's, the Sparge Tower's or the Advanced Distillation Tower's), so the plan warns on every export-ruled multiblock without a fitting row. *Recommendation:* accept; a machine leaves that warning by getting a row in the hatch-rules table, which Task 7 test 3 then checks against the export.
