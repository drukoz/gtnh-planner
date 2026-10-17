# Prior art: GTNH recipe export and production planning

Date: 2026-10-17 · Scope: GT New Horizons 2.9.0-RC-1 (gregtech 5.09.54.183, NotEnoughItems 2.8.145-GTNH) · Status: reference for the build plan

This document surveys existing recipe exporters and production planners for GTNH and 1.7.10, records how they model GregTech, and lists the traps they hit, so the planner can reuse their algorithms and avoid their bugs. Section 3 turns this into concrete recommendations for our data model and solver.

## How to read the evidence

Every load-bearing claim carries its evidence inline: a command with a trimmed output excerpt (`…` marks a cut), or a URL with a quote. Placeholders in commands:

- `PACK`: the folder of the GTNH 2.9.0-RC-1 server pack.
- `J`: `javap` from a JDK 25 install.
- `GT`: `$PACK/mods/gregtech-5.09.54.183.jar`. `NEI`: `$PACK/mods/NotEnoughItems-2.8.145-GTNH.jar`.
- GitHub files were read with `gh api repos/<owner>/<repo>/contents/<path>` (read-only) on 2026-10-17. URLs point at the default branch.

"Reported" means the claim comes from that project's own docs and we did not re-measure it. **UNVERIFIED** marks anything we could not check. No world data was needed for this topic.

## TL;DR

1. **The pack has no full recipe dump.** Nothing in the 2.9.0-RC-1 `mods/` folder exports GregTech machine recipes with EU/t, duration and chances. It has partial dumps: NEI's `/recipeid` (recipe identities only), NEI data dumps (items and rendered icons), GT's NEI dumpers (machine IDs, materials, multiblock features, turbine fuels), and MineTweaker's `/minetweaker recipes` (crafting and furnace only, server side). §1.1
2. **Only two exporters target 2.9 builds:** the ShadowTheAge fork of NESQL Exporter (LGPL-3.0, HSQLDB, built against 2.9.0-beta-2) and `gtnh-calc-oracle` inside GTNH Factory Flow (MIT, JSON, built against 2.9.0-beta-2, also used for RC-2). Upstream NESQL 0.5.2 cannot load on 2.9 because the class it imports, `gregtech.api.util.GT_Recipe`, no longer exists. **Every exporter that produces icons runs in a game client.** §1.2
3. **No GTNH planner picks recipes for you by cost.** In gtnh-flow, flow2, PlanNH, the ShadowTheAge calculator and GTNH Factory Flow, the user places the recipes and the tool only balances rates. Automatic recipe choice by cost is standard in Factorio calculators: FactorioLab pulls in every recipe for each needed item recursively and minimizes cost with an LP, and YAFC computes a cost for every item with one LP. §2
4. **What mature tools agree on:**
   - One "extent" variable per recipe (crafts per second) and one conservation row per item.
   - Explicit source and sink variables for anything entering or leaving the line.
   - Objectives solved in stages (lexicographic), not one weighted sum.
   - HiGHS as the solver.
   - Expected values for chanced outputs; amount 0 means an input is not consumed.
   - A hand-curated per-multiblock table on top of GT's own `OverclockCalculator`.
   - Recipe IDs built from recipe content, because export order changes between runs.

   §2.3, §2.4
5. **Risks to the approved objective (decision needed):**
   - With water, air, cobblestone and lava free and machines not counted, the cheapest route can be absurd. A verified 2.9 centrifuge recipe turns 3,600 L of lava into a gold ingot at 10% chance, so gold "costs" 0.
   - If ores and ingots are both base materials at cost 1, the LP will tend to pick ore processing, because one ore yields more than one ingot (reasoned, not yet checked on exported data).
   - "Batch mode" is already a GT multiblock feature (up to 128× batches), so our "batch mode" needs another name.

   §3.3, §3.4, §3.6

---

## 1. Recipe exporters

### 1.1 What the 2.9.0-RC-1 pack already offers

| Facility (mod) | How to run it | Side | Output | GT machine recipes? |
|---|---|---|---|---|
| NEI `/recipeid` (NotEnoughItems 2.8.145-GTNH) | `/recipeid dump <file>`, `fast-dump`, `diff` | client command | `recipeid/<file>.json`: one JSON object per recipe with `handlerName`, `ingredients`, `result` | No: handler name plus ingredient and result stacks, for identifying recipes; no EU/t, duration or chances |
| NEI data dumps (Options → Tools) | GUI buttons: item, block, potion, enchantment, biome, item panel, handlers | client | `dumps/…` in CSV, JSON or NBT; item panel icons as PNG in `dumps/itempanel_icons` | No; useful for item lists and **icons** |
| GT NEI dumpers (inside gregtech) | same NEI Tools page | client | machine (MTE) IDs and classes, materials, meta items, multiblock feature support, turbine fuels (EU/L), turbine rotors | No; useful side tables |
| NEIIntegration 1.5.3 dumpers | NEI Tools page | client | ore dictionary (with wildcard flag), fluids, fluid containers, recipe handler classes | No |
| MineTweaker 3 (CraftTweaker 3.4.8, MIT) | `/minetweaker recipes`, `recipes furnace`, `oredict`, `names`, `liquids` | **server** | ZenScript-style lines in `minetweaker.log` | No; crafting table and furnace only |
| BartWorks `/prltf <path>` (inside gregtech) | server command | **server** | `IRecipe.toString() + " = " + output name` per crafting recipe | No; prints object IDs, useless |
| GuideNH 1.3.36 (LGPL-3.0) | client commands `exportsite`, `exportstructure` | client | static HTML guide site with recipe grids for guide pages; 3D structure scenes | Only recipes shown on guide pages |

**Conclusion.** Nothing in the pack exports GT recipe maps, so we need an exporter mod: our own or a fork (§3.1). A side fact that lowers the risk of a load-time export missing late recipe edits: the pack's `scripts/` folder is empty, so no ZenScript changes recipes. Recipes come from Java code at load time.

Evidence (all local, read-only):

- **NEI `/recipeid`**: command name, usage string and client registration.
  ```
  $ J -cp $NEI -c -p codechicken.nei.commands.CommandRecipeId | grep 'String '
     0: ldc #26  // String recipeid
     0: ldc #30  // String /recipeid [dump|fast-dump] <filename> OR /recipeid diff <prev-filename> <curr-filename> <subset name>
  $ J -cp $NEI -c -p codechicken.nei.NEIController | grep -A3 registerClientCommands
     0: getstatic #111 // Field net/minecraftforge/client/ClientCommandHandler.instance …
    17: new       #120 // class codechicken/nei/commands/CommandRecipeId
  $ J -cp $NEI -c -p 'codechicken.nei.recipe.Recipe$RecipeId' | grep ldc
    // String handlerName … // String ingredients … // String result
  ```
- **NEI data dumps and icon dumper**:
  ```
  $ J -cp $NEI -c -p codechicken.nei.api.ItemInfo | grep 'String tools.dump'
    tools.dump.item, tools.dump.block, tools.dump.potion, tools.dump.enchantment, tools.dump.biome, tools.dump.itempanel, tools.dump.handlers
  $ J -cp $NEI -c -p codechicken.nei.config.ItemPanelDumper | grep ldc
    // String Item Name // String Item ID // String Item meta // String Has NBT // String Display Name … // String .csv // String .nbt // String .json
  $ J -cp $NEI -c -p codechicken.nei.config.GuiItemIconDumper | grep ldc
    12: ldc #37 // String dumps/itempanel_icons … // String .png
  ```
- **GT NEI dumpers**: all 11 that `NEIGTConfig.registerDumpers` creates.
  ```
  $ J -cp $GT -c -p gregtech.nei.NEIGTConfig | awk '/registerDumpers/,/return/' | grep new
    MetaTileEntityDumper MaterialDumper MetaItemDumper(x3) VoidProtectionSupportDumper InputSeparationSupportDumper
    BatchModeSupportDumper RecipeLockingSupportDumper TurbineFuelDumper TurbineRotorDumper
  $ J -cp $GT -c -p gregtech.nei.dumper.TurbineFuelDumper | grep ldc
    // String tools.dump.gt5u.fuels // String type // String name // String eu_l // String xlgt …
  ```
- **NEIIntegration dumpers**:
  ```
  $ J -cp $PACK/mods/NEIIntegration-1.5.3.jar -c -p tonius.neiintegration.mods.mcforge.dumpers.OreDictionaryDumper | grep -E 'extends|ldc'
    … extends codechicken.nei.config.DataDumper  // String Ore Name // String ItemStack // String Item ID // String Display Name // String Wildcard
  ```
- **MineTweaker commands** run on the server: `MCServer` is constructed in `onServerAboutToStart`, and the recipes command writes `toCommandString()` to the log.
  ```
  $ J -cp $PACK/mods/CraftTweaker-3.4.8.jar -c -p minetweaker.MineTweakerImplementationAPI | grep 'String /minetweaker recipes'
    // String /minetweaker recipes // String /minetweaker recipes hand // String /minetweaker recipes furnace
  $ J -cp $PACK/mods/CraftTweaker-3.4.8.jar -c -p 'minetweaker.MineTweakerImplementationAPI$6' | grep -E 'toCommandString|String Recipe list'
    // InterfaceMethod minetweaker/api/recipes/ICraftingRecipe.toCommandString … // String Recipe list generated; see minetweaker.log in your logs dir
  $ unzip -p $PACK/mods/CraftTweaker-3.4.8.jar LICENSE | head -1
    MIT License
  ```
- **BartWorks `/prltf`** is registered as a server command and prints `toString()`:
  ```
  $ J -cp $GT -c -p bartworks.common.commands.PrintRecipeListToFile | grep -E 'String|IRecipe'
    // String prltf // String prltf <FilePath> … IRecipe.toString … // String  =
  $ J -cp $GT -c -p bartworks.common.loaders.RegisterServerCommands | grep -E 'class|registerServerCommand'
    // class bartworks/common/commands/PrintRecipeListToFile … FMLServerStartingEvent.registerServerCommand
  ```
- **GuideNH**: client command strings `export`, `exportsite`, `exportstructure` (`J -cp $PACK/mods/guidenh-1.3.36.jar -c -p com.hfstudio.guidenh.client.command.GuideNhClientCommand | grep String`). The license is LGPL-3.0 per https://github.com/GTNewHorizons/GuideNH ("Code: LGPL-3.0").
- **No other dump classes in the pack**: across all 215 jars in `mods/`, only GuideNH matched.
  ```
  $ for j in $PACK/mods/*.jar; do unzip -l "$j" | grep -iE 'recipe.?dump|dump.?recipe|recipe.?export|export.?recipe'; done
    guidenh-1.3.36.jar: com/hfstudio/guidenh/guide/siteexport/site/GuideSiteRecipeExporter.class   (only hit)
  ```
- **GT's own `/gt` and `/gtdebug` commands** have no recipe dump. Their strings are about global energy, ore vein patterns and the ore showroom (`J -cp $GT -c -p gregtech.common.misc.GTMiscCommand | grep String`).
- **Empty scripts folder**: `ls $PACK/scripts | wc -l` prints `0`.

### 1.2 External exporters

| Exporter | Side | Built against (≈ GTNH) | Output | License | Icons | State |
|---|---|---|---|---|---|---|
| [NESQL Exporter](https://github.com/D-Cysteine/nesql-exporter), upstream 0.5.2 | client only | GT 5.09.45.161, NEI 2.5.27 (≈ 2.6.0) | HSQLDB database (PostgreSQL optional); ~600 MB, ~60 min (reported) | LGPL-3.0 | yes, ~150k PNG (reported) | last push 2024-05; **does not load on 2.9** |
| [GTNewHorizons/nesql-exporter](https://github.com/GTNewHorizons/nesql-exporter) fork | client only | GT 5.09.52.342, NEI 2.8.74 (2.9 development, before beta-1) | same | LGPL-3.0 | yes | last commit 2026-05-05 |
| [ShadowTheAge/nesql-exporter](https://github.com/ShadowTheAge/nesql-exporter) fork 0.5.7 | client only | GT 5.09.54.20, NEI 2.8.111 (= 2.9.0-beta-2); commit "Update for GTNH 2.9.0" on 2026-07-19 | same, plus recipe metadata and special value | LGPL-3.0 | yes | feeds the ShadowTheAge calculator |
| `gtnh-calc-oracle` in [jackwrichards/gtnh-factory-flow](https://github.com/jackwrichards/gtnh-factory-flow) | client; starts itself at the main menu; headless in Docker with Xvfb | GT 5.09.54.20; datasets for 2.9, including "local-2.9.0-rc-2" | JSON (`oracle-export.json`) plus `rendered-icons/` | MIT (code) | yes | active (pushed 2026-10-17) |
| [RecEx](https://github.com/bigbass1997/RecEx) | client (GUI, key `K`) | GT 5.09.33.31 (2019) | minimized JSON | GPL-3.0 | no | archived; drops chances |
| [NEIDataDump](https://github.com/NamesAreAPain/NEIDataDump) | client; reads NEI handlers | old GT (`GT_NEI_DefaultHandler`) | JSON | none stated | no | 2022, dormant |

PlanNH (§2.2) has no exporter. It reads NEI live inside the client.

**NESQL Exporter (upstream).**

- What it exports, per the [README](https://github.com/D-Cysteine/nesql-exporter/blob/main/README.md): "NEI item list · Forge ore dictionary · Forge fluids and fluid container data · Minecraft crafting table and furnace recipes · GTNH GT5 recipe maps · BetterQuesting quests · Thaumcraft aspects". Also: "For GTNH, the exported database file is ~600 MB, and the export process takes my computer ~60 min. There are ~150k exported images, which take up a total of ~90 MB raw".
- **Client only.** `Main.java` declares `acceptableRemoteVersions = "*",  // Client-side-only mod.`, and each event handler starts with `if (event.getSide() != Side.CLIENT) { return; }`. It registers `/nesql` with `event.registerServerCommand(new ExportCommand())` only inside a client, that is, on the single-player integrated server. Icons are rendered into a `Framebuffer` and read back with `GL11.glReadPixels` (`Renderer.java`), which needs an OpenGL client.
- **Version.** `gradle.properties` has `nesqlExporterVersion=0.5.2`, `gregTech5Version=5.09.45.161` and `neiVersion=2.5.27-GTNH`.
- **Why it breaks on 2.9.** It imports `gregtech.api.util.GT_Recipe`, which the 2.9 jar no longer has:
  ```
  $ unzip -l $GT | awk '{print $4}' | grep -c GT_Recipe            → 0
  $ unzip -l $GT | awk '{print $4}' | grep -c '^gregtech/api/util/GT_'  → 0
  $ unzip -l $GT | grep 'gregtech/api/util/GTRecipe.class'          → present
  ```
- **GT fields it reads** (`GregTechRecipeProcessor.java`, `GregTechRecipeFactory.java`):
  - `voltage = recipe.mEUt / recipeMap.getAmperage()`.
  - Item inputs go through `GT_OreDictUnificator.getNonUnifiedStacks`, so each input becomes a group of equivalent items.
  - Output chance from `getOutputChance(i)`; `chance == 100_00` means certain.
  - Fluid inputs and outputs with no chance at all.
  - `mSpecialItems` and `mDuration`.
  - Cleanroom from `mSpecialValue == -200 || mSpecialValue == -300`, and low gravity from `-100 / -300`. On 2.9 this is a trap (§1.4 T2).
  - EBF heat and fusion start-up energy from `mSpecialValue`.
- **Usage traps from the README:**
  - Remove BugTorch, or enchanted items render as blank icons. BugTorch is in this pack: `bugtorch-1.3.1.jar`.
  - Open the NEI item list before exporting, "If you forget to do this, some items might not be exported".
  - Use a new creative world, because "the exporter uses your current player state".
  - Unlock all Thaumcraft research first.

**ShadowTheAge fork (2.9).**

- It uses the new class names (`import gregtech.api.util.GTRecipe;`) and walks `gregtech.api.recipe.RecipeMap.ALL_RECIPE_MAPS`.
- It takes the machines for each map from NEI: `getRecipeCatalysts(oriGTRecipeMap.unlocalizedName)`.
- Commit "Add recipe metadata export" (2025-10-16) dumps `gregTechRecipe.getMetadataStorage().getEntries()`.
- It still reads cleanroom from the `mSpecialValue` sentinels (`GregTechRecipeFactory.java` lines 45–47).
- **Static compatibility with RC-1.** Every GT and NEI symbol its GT plugin uses exists in the RC-1 jars:
  ```
  $ J -cp $GT -p gregtech.api.recipe.metadata.IRecipeMetadataStorage | grep getEntries
    public abstract java.util.Set<java.util.Map$Entry<gregtech.api.recipe.RecipeMetadataKey<?>, java.lang.Object>> getEntries();
  $ J -cp $NEI -p codechicken.nei.recipe.RecipeCatalysts | grep 'getRecipeCatalysts(java.lang.String)'
    public static java.util.List<codechicken.nei.PositionedStack> getRecipeCatalysts(java.lang.String);
  ```
  Whether it actually runs on RC-1 is **UNVERIFIED**.
- **Downstream.** The calculator's [export/README.md](https://github.com/ShadowTheAge/gtnh/blob/main/export/README.md) says: "Build the NESQL Exporter mod from ShadowTheAge/nesql-exporter fork … The project will process the exported NESQL data and generate: `atlas.webp` … `data.bin`".

**gtnh-calc-oracle (GTNH Factory Flow).**

- **What it exports.** From [tools/dataset-pipeline/CLAUDE.md](https://github.com/jackwrichards/gtnh-factory-flow/blob/main/tools/dataset-pipeline/CLAUDE.md): "A Forge mod (`gtnh-calc-oracle`) running inside a real GTNH 2.9 client exports every recipe map, NEI layout, catalyst, multiblock config and rendered icon". In `GtnhCalcOracleExporter.java`:
  - It iterates `RecipeMap.ALL_RECIPE_MAPS.values()`, sorted by `unlocalizedName`.
  - It skips `!recipe.mEnabled`.
  - It clamps duration with `Math.max(1, recipe.mDuration)`, because "Zero-duration recipes are real: BartWorks autogenerates werkstoff solidifier/extraction recipes with duration = mass".
  - It exports `mEUt`, `mSpecialValue`, input chances, `mOreDictAlt` and `mAltFluidInputs` alternatives, and `mSpecialItems`.
  - It reads `FUSION_THRESHOLD` metadata for fusion, plus "wearing inputs" for `gtpp.recipe.fluidchemicaleactor` and `gtpp.recipe.oremill`.
  - It adds a `runtimeCalculation` per recipe × tier × coil, computed by GT's own `gregtech.api.util.OverclockCalculator`.
- **Non-consumed inputs.** An input with `stackSize` 0, or an input chance ≤ 0, is exported with `"consumed": false`.
- **Recipe IDs are by position:** `sha1(map.unlocalizedName + ":" + index + ":" + recipe.toString())`. Their notes say this is unstable (§1.4 T5).
- **Client only, no world needed.** `ClientAutorunHandler` fires on `TickEvent.ClientTickEvent` after `gtnh.oracle.autorunDelayTicks` (default 220), once the texture manager and font renderer exist. That is the main menu, not a world.
- **Headless.** `run-gtnh-oracle-export.sh` wraps the launch in `xvfb-run -a` when `DISPLAY` is unset. The Docker image installs `xvfb`, `libgl1-mesa-dri` and `mesa-utils`, plus JDK 17 and 25. `run-dataset-in-docker.sh` defaults to a 6 GB heap (`GTNH_EXPORT_MAX_MEMORY:-6G`) and a 6-hour timeout (`GTNH_EXPORT_TIMEOUT_SECONDS:-21600`).
- **Build.** `dependencies.gradle` contains `implementation("com.github.GTNewHorizons:GT5-Unofficial:5.09.54.20:dev")`, with the comment "Track the GregTech the pack actually ships (GTNH 2.9.0-beta-2 loads gregtech-5.09.54.20.jar)".

**RecEx.**

- From the [README](https://github.com/bigbass1997/RecEx/blob/master/README.md): "The default keybind to open the exporter's GUI is 'k' … Recipes are exported into a minimized JSON format". Support table: "Oredict Shapeless | None".
- `build.gradle` pins `gregtech-5.09.33.31-dev.jar`.
- The GT section of `RecipeExporter.java` writes only `en`, `dur`, `eut`, `iI`, `iO`, `fI`, `fO`. There are **no chances and no special value**, so chanced outputs become certain and generator fuel values are lost.
- The Greginator recipe data uses the same schema, and its generator "recipes" show `"dur":0,"eut":0` (`data/exported_recipes/2022-10-07_15-16-48/Acid Generator.json`: `{"n":"Acid Generator","recs":[{"en":true,"dur":0,"eut":0,"iI":[…"Diluted Sulfuric Acid Cell"…`).

**NEIDataDump.** It scrapes NEI handlers. `DumpCommand.java` has the usage `/neidatadump [i]tems [r]ecipes [o]redict [a]spects`, and `GT_NEI_DefaultHandlerHandler.java` casts handlers to `GT_NEI_DefaultHandler`, a class the RC-1 jar no longer has (it is `gregtech/nei/GTNEIDefaultHandler.class` now; see T1). It is the generic "read whatever NEI shows" approach. That approach covers non-GT mods, but has none of GT's numbers unless the handler exposes them. NEI positioned stacks do carry chances, which helps for non-GT recipe types:

```
$ J -cp $NEI -p -constants codechicken.nei.PositionedStack | grep -i chance
  public static final int CHANCE_FULL = 10000;   public int getChance();
```

### 1.3 Version map: GTNH ↔ GregTech ↔ NEI

Use this table to judge what "built against" means for each exporter. The source is GTNH's release manifests: `gh api repos/GTNewHorizons/DreamAssemblerXXL/contents/releases/manifests/<version>.json`, reading the `github_mods` fields `GT5-Unofficial.version` and `NotEnoughItems.version`.

| GTNH | GT5-Unofficial | NotEnoughItems | manifest `last_updated` |
|---|---|---|---|
| 2.5.1 | 5.09.44.110 | 2.4.13-GTNH | 2023-12-20 |
| 2.6.0 | 5.09.45.163 | 2.5.27-GTNH | 2024-04-28 |
| 2.7.0 | 5.09.50.103 | 2.6.51-GTNH | 2024-12-08 |
| 2.7.4 | 5.09.50.119 | 2.6.54-GTNH | 2025-04-13 |
| 2.8.0 | 5.09.51.470 | 2.7.91-GTNH | 2025-09-27 |
| 2.8.4 | 5.09.51.482 | 2.8.44-GTNH | 2025-12-23 |
| 2.9.0-beta-1 | 5.09.52.594 | 2.8.101-GTNH | 2026-06-07 |
| 2.9.0-beta-2 | 5.09.54.20 | 2.8.111-GTNH | 2026-07-05 |
| 2.9.0-beta-3 | 5.09.54.133 | 2.8.130-GTNH | 2026-09-06 |
| **2.9.0-RC-1 (ours)** | **5.09.54.183** | **2.8.145-GTNH** | 2026-09-24 |
| 2.9.0-RC-2 | 5.09.54.205 | 2.8.155-GTNH | 2026-10-04 |

The RC-1 row matches the jars in our pack: `gregtech-5.09.54.183.jar` and `NotEnoughItems-2.8.145-GTNH.jar` in `$PACK/mods`. RC-2 is already out, so a re-export will be needed before 2.9.0 final arrives.

### 1.4 Exporter-side traps (verified against the RC-1 jars unless marked)

**T1. Class renames.** The old underscore names are gone: `GT_Recipe` is now `GTRecipe`, `GT_OreDictUnificator` is now `GTOreDictUnificator`, `GT_Values` is now `GTValues`, `GT_NEI_DefaultHandler` is now `GTNEIDefaultHandler`. Anything compiled against GTNH 2.6 or older fails with `NoClassDefFoundError`.

```
$ unzip -l $GT | awk '{print $4}' | grep -c -E 'GT_NEI_DefaultHandler|gregtech/api/enums/GT_Values\.class|GT_OreDictUnificator'   → 0
$ unzip -l $GT | awk '{print $4}' | grep -E '(enums/GTValues|util/GTOreDictUnificator|nei/GTNEIDefaultHandler)\.class$'
  gregtech/api/enums/GTValues.class  gregtech/api/util/GTOreDictUnificator.class  gregtech/nei/GTNEIDefaultHandler.class
```

The `GT_Recipe` counts are in §1.2.

**T2. Cleanroom and low-gravity flags live in recipe metadata, not in the special value.**
- `GTRecipeBuilder.requiresCleanRoom()` calls `metadata(GTRecipeConstants.CLEANROOM, true)`.
- `applyDefaultSpecialValues` writes the legacy sentinels −100 (low gravity) and −200 (cleanroom) into `mSpecialValue` **only if `mSpecialValue == 0`**.
- It then **overwrites** that value with the first "special value alias" metadata found: `COIL_HEAT`, `FUEL_VALUE`, `NANO_FORGE_TIER`, `DEFC_CASING_TIER`, `CHEMPLANT_CASING_TIER`, `QFT_FOCUS_TIER`, ….

So reading cleanroom from `mSpecialValue`, as both NESQL versions do, misses the flag on any recipe that also has one of those aliases. Read `getMetadataOrDefault(CLEANROOM, false)` instead.

```
$ J -cp $GT -c -p gregtech.api.util.GTRecipeBuilder | awk '/private void applyDefaultSpecialValues/,/return$/'
   1: getfield GTRecipe.mSpecialValue   4: ifeq 8   7: return
  11: getstatic GTRecipeConstants.LOW_GRAVITY … 30: iinc 2, -100
  34: getstatic GTRecipeConstants.CLEANROOM … 53: iinc_w 2, -200
  59: getstatic GTRecipeMapUtil.SPECIAL_VALUE_ALIASES … 117: invokevirtual Number.intValue 120: istore_2 …
 204: putfield GTRecipe.mSpecialValue
$ J -cp $GT -c -p gregtech.api.util.GTRecipeConstants | grep -A1 SPECIAL_VALUE_ALIASES | grep 'Field [A-Z_]*:'
  COIL_HEAT FUEL_VALUE NANO_FORGE_TIER FOG_EXOTIC_TIER FOG_PLASMA_TIER DEFC_CASING_TIER CHEMPLANT_CASING_TIER ALGAE_POND_TIER QFT_FOCUS_TIER …
```

**T3. `mSpecialValue` means something different in each recipe map.** It can be heat, a fuel value, a casing tier or a sentinel. GTNH Factory Flow warns: "A recipe's special value means different things per map; never read it as heat globally" and "A special value of 0 can be a real heat requirement (dehydrators)" ([src/lib/machines/CLAUDE.md](https://github.com/jackwrichards/gtnh-factory-flow/blob/main/src/lib/machines/CLAUDE.md)). Export the full metadata map, and keep `mSpecialValue` only as a raw field.

**T4. Recipe map IDs change between 2.9 pre-releases.**
- RC-1 uses `gt.recipe.lftr.sparging`, `gt.recipe.oremill` and `gt.recipe.fluidchemicaleactor` (sic).
- The beta-2 oracle code still tests for `"gtpp.recipe.lftr.sparging"`, and Factory Flow's notes say "GT++'s `gtpp.recipe.*` read as RC-2's `gt.recipe.*`".
- GT's `RecipeMap.getFromOldIdentifier` only strips an old numeric suffix (pattern `(.+)_[0-9]+_[0-9]+_[0-9]+_[0-9]+_[0-9]+`). It does **not** translate `gtpp.*` names.

So we need our own alias table, stored alongside the dataset.

```
$ (extract $GT classes) ; grep -rhoa -E 'gtpp\.recipe\.[a-z0-9_.]+' classes | sort -u | wc -l     → 0
$ grep -rhoa -E '[a-z]+\.recipe\.(lftr[a-z0-9_.]*|oremill|fluidchemica[a-z]*)' classes | sort -u
  gt.recipe.fluidchemicaleactor  gt.recipe.lftr  gt.recipe.lftr.sparging  gt.recipe.oremill
$ J -cp $GT -c -p gregtech.api.recipe.RecipeMap | awk '/static \{\};/,/return$/' | grep ldc
  // String (.+)_[0-9]+_[0-9]+_[0-9]+_[0-9]+_[0-9]+
```

**T5. Export order changes between runs.** Factory Flow: "A fresh export is NOT deterministic: crafting, furnace, bee, crop and essentia recipes reorder, re-minting ~37,000 ids" (reported). They now carry old IDs forward by matching content: "same map …, slots, amounts, chances, ticks and EU keep the old id" (`scripts/carry-recipe-ids.mjs`). Give each recipe an ID that is a hash of its normalized content, and keep a mapping report from the old export to the new one.

**T6. Chances exist on all four sides.** At tag 5.09.54.183, `GTRecipe.java` documents "Values range from 1 to 10000 (10000 = 100%) … If an array is null, all corresponding items/fluids default to 100% chance … mInputChances … (Input must always be present to start the recipe; chance controls whether it is consumed.)" (https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.183/src/main/java/gregtech/api/util/GTRecipe.java). Upstream NESQL ignores fluid output chances, and RecEx ignores every chance.

```
$ J -cp $GT -p gregtech.api.util.GTRecipe | grep Chances
  public int[] mInputChances;  public int[] mOutputChances;  public int[] mFluidInputChances;  public int[] mFluidOutputChances;
$ J -cp $GT -c -p gregtech.api.util.GTRecipe | awk '/public int getOutputChance\(int\);/,/ireturn/'
  1: getfield mOutputChances  4: ifnonnull 11  7: sipush 10000  10: ireturn …
```

**T7. "Not consumed" means amount 0.**
- The programmed circuit is created with stack size 0.
- GT's parallel logic skips inputs whose consumption is 0 ("// For non-consumed inputs / if (consume == 0) continue;", `GTRecipe.java` at tag 5.09.54.183).
- An input chance of 0 means the same thing.

Molds, lenses, shapes and catalysts follow the same convention. **UNVERIFIED** per item type; the export will show it.

```
$ J -cp $GT -c -p gregtech.api.util.GTUtility | awk '/getIntegratedCircuit\(int\);/,/areturn/'
  0: getstatic ItemList.Circuit_Integrated  3: lconst_0  4: iload_0 … invokevirtual ItemList.getWithDamage:(JJ[Ljava/lang/Object;)
```

**T8. `mSpecialItems` is only for NEI display.** The source comment says it "is only useful for Fake Recipes in NEI, since findRecipe() and containsInput() don't give a shit about this Field" (same file). Do not treat it as an input.

**T9. Flags and special maps.**
- `mFakeRecipe`: "doesn't get found by the findRecipe Function".
- `mHidden`: "hidden from NEI".
- `mEnabled`, `mNeedsEmptyOutput`, `isNBTSensitive`.

All of these come from the same source file at the same tag. 2.9 also has maps whose recipes are generated by code or exist only for display: `massFabFakeRecipes`, `scannerFakeRecipes`, `replicatorRecipes` (`ReplicatorBackend`) and `recyclerRecipes` (`RecyclerBackend`). There is also a `GTRecipeConstants.RECYCLE` metadata key for item-to-material recycling recipes. Tag all of these in the export, and leave them out of planning by default (§3.4).

```
$ J -cp $GT -p gregtech.api.recipe.RecipeMaps | grep -iE 'massfab|replicator|scanner|recycl'
  …RecipeMap<…RecyclerBackend> recyclerRecipes; …scannerFakeRecipes; …RecipeMap<…ReplicatorBackend> replicatorRecipes; …massFabFakeRecipes; …multiblockMassFabricatorRecipes;
```

Whether `getAllRecipes()` lists anything for the code-generated backends is **UNVERIFIED**.

**T10. The same recipe can sit in several maps.** Examples: `centrifugeRecipes` and `centrifugeNonCellRecipes`, `electrolyzerRecipes` and `electrolyzerNonCellRecipes`. "Dispatch" maps such as `GTRecipeConstants.UniversalChemical` and `BlastFurnaceWithGas` add one recipe to several maps (`J -cp $GT -p gregtech.api.recipe.RecipeMaps`; `J -cp $GT -p gregtech.api.util.GTRecipeConstants | grep IRecipeMap`). Merge recipes by content and keep the list of maps, so that the set of machines able to run a recipe is right.

**T11. Material icons are grayscale templates.**
- GT tints them at draw time. PlanNH's `GTHooks.java` notes: "GT MetaGeneratedItem (dusts, ingots, cells, circuits, etc.) colors are added at draw time … need to use `.getRGBA` and not Minecraft `.getColorFromItemStack`".
- Texture sets fall back to a parent set: the DULL set has no `dust.png`.

Copying icons straight out of the jar therefore needs tinting and fallback logic. Rendering them in a client, as NESQL and the oracle do, avoids both problems but brings its own: faint fluids ("repair only captures under 20% mean opacity", Factory Flow, reported) and blank enchanted items when BugTorch is installed (NESQL README).

```
$ J -cp $GT -p gregtech.api.items.MetaGeneratedItem | grep getRGBa       → public short[] getRGBa(net.minecraft.item.ItemStack);
$ unzip -l $GT | grep -E 'materialicons/(NONE|DULL|METALLIC)/dust(_OVERLAY)?\.png'
  …/materialicons/METALLIC/dust.png   …/materialicons/NONE/dust.png        (no DULL/dust.png)
$ python3 -I pngcheck.py METALLIC/ingot.png NONE/dust.png METALLIC/dust.png   (a palette PNG reader in $SCRATCH)
  METALLIC/ingot.png 16x16 colortype=3 bitdepth=4 distinct_rgb=11 all_gray=True
  NONE/dust.png 16x16 colortype=3 bitdepth=8 distinct_rgb=20 all_gray=True
```

**T12. Which machines run a map.**
- The reliable client-side source is NEI's catalyst list, `RecipeCatalysts.getRecipeCatalysts(mapId)`, which the ShadowTheAge fork uses.
- Factory Flow: "Singleblock tiers come from real catalysts (`availableTiers`). Never interpolate a machine that doesn't exist (Cold Trap has IV and ZPM, no LuV)" (reported).
- Factory Flow also: "Multiblock-ness comes from the exported `multiblock` flag, the source class or a 'Controller Block' tooltip line …, never from the map", and "Never parse tooltips globally".

**T13. Display names.** Every exporter above takes English names inside a client. Whether a dedicated server returns the same localized names for all mods is **UNVERIFIED**. This matters if we export on a server copy (§3.1).

---

## 2. Planners and calculators

### 2.1 Overview

| Tool | Form | Recipe data | Who picks recipes | Solver | Overclock model | License |
|---|---|---|---|---|---|---|
| [gtnh-flow](https://github.com/OrderedSet86/gtnh-flow) | Python CLI → Graphviz | hand-written YAML (I/O, EU/t, duration in s) | user | SymPy `linsolve`: exact linear system, no objective | hard-coded per-machine table plus formulas | MIT |
| [flow2](https://github.com/OrderedSet86/flow2) (research rewrite) | Python | gtnh-flow YAML | user | 4-stage lexicographic MILP with HiGHS | uses the v1 data | GPL-3.0 |
| [PlanNH](https://github.com/sbancuz/PlanNH) | client mod, in game (F8) | live NEI | user (canvas) | ojAlgo LP/MILP in staged chains | calls GT's own `OverclockCalculator`, with per-map settings | MIT |
| [GTNH Calculator (ShadowTheAge)](https://github.com/ShadowTheAge/gtnh) | static web app, TypeScript | NESQL export → `data.bin` | user (YAFC-style production table) | `javascript-lp-solver`: minimize total recipe runs | curated `machines.ts` | MIT (code) |
| [GTNH Factory Flow](https://github.com/jackwrichards/gtnh-factory-flow) (gtnhplanner.com) | Next.js web app | `gtnh-calc-oracle` | user (Build, Solve); Pool mode wires connections | HiGHS (WASM) or its own simplex; staged LPs | curated table (from ShadowTheAge) plus oracle runs of `OverclockCalculator` | MIT (code) |
| [Greginator](https://github.com/divran/greginator) | static web page | RecEx-format export (2022-10-07) | n/a | n/a | overclock calculator (with GT batch mode), recipe conflict checker | MIT |
| NEI bookmark recipe chain (in our pack) | in game | NEI | user (bookmarks) | integer tree expansion (`RecipeChainMath`), loops removed | none | LGPL-3.0 |
| gtcalc.app | web | "every GT New Horizons 2.8 recipe" | claims a "Best Route … all the way down to raw resources" | **UNVERIFIED** | "Overclocks, parallel hatches, multiblocks" | not stated |
| [YAFC](https://github.com/ShadowTheAge/yafc) / [yafc-ce](https://github.com/shpaass/yafc-ce) (Factorio) | desktop | Factorio Lua data | user, plus automatic item cost analysis | Google OR-Tools LP | n/a | GPL-3.0 |
| [FactorioLab](https://github.com/factoriolab/factoriolab) | web | per-game data | **automatic**: every recipe for each needed item, recursively | GLPK (`glpk.js`) LP, minimum cost | n/a | MIT (glpk.js is GPL-3.0) |
| [NotEnoughProduction](https://github.com/bigbass1997/NotEnoughProduction) | desktop (LibGDX) | RecEx JSON | user | **UNVERIFIED** | **UNVERIFIED** | GPL-3.0, archived |

Repository metadata comes from `gh api repos/<owner>/<repo> --jq '{license:.license.spdx_id, pushed:.pushed_at}'`:

| Repository | License | Last push |
|---|---|---|
| gtnh-flow | MIT | 2024-10-25 |
| flow2 | GPL-3.0 | 2026-07-06 |
| PlanNH | MIT | 2026-10-13 |
| ShadowTheAge/gtnh | MIT | 2026-08-09 |
| gtnh-factory-flow | MIT | 2026-10-17 |
| Greginator | MIT | 2024-08-21 |
| FactorioLab | MIT | 2026-10-13 |
| yafc-ce | GPL-3.0 | 2026-10-17 |

For gtcalc.app, https://gtcalc.app/ says it is a "free GregTech calculator and factory planner for GT New Horizons (GTNH) and GTCEu", with "every GT New Horizons 2.8 recipe". It names no solver and no data source, and states no license.

### 2.2 Notes per tool

**gtnh-flow (MIT).**

- **Input is typed by hand.** From the [README](https://github.com/OrderedSet86/gtnh-flow/blob/master/README.md): "you need to specify exact I/O and eut/duration in seconds … at least one machine will need a `number` or `target` argument". Durations are in **seconds**, unlike GT's ticks.
- **Solver.** It builds one equation per machine ratio plus one per edge, then calls `res = linsolve(self.system, self.variables)`. An `EmptySet` result logs `'EmptySet response - likely overdetermined'`, and multiple solutions raise `NotImplementedError('Multiple solutions - no code written to deal with this scenario yet')` (`src/graph/_solver.py`).
- **Documented limits** (README):
  - "`gtnh-flow` cannot solve certain parallel edge product situations".
  - Workaround: "renaming the ingredient slightly, like `chlorine 1` and `chlorine 2`".
  - The author's position on objective values: "I am trying to avoid the way Factorio solvers work, which is to define an 'objective' value for every item in the game. This is impractical to do and permanently maintain for GTNH."
- **Overclocking.** `data/overclock_data.yaml` holds coil heat (`cupronickel: 1801 …`) and coil multipliers, plus a `GTpp_stats` table of "[speed X, EU/t discount, parallels per tier]" for each GT++ multiblock. The default rule is `eut * 4**oc_count`, `dur / 2**oc_count`, and the perfect rule `dur / 4**oc_count` (`src/gtnh/overclocks.py`).
- **This table has drifted from GT.** The EBF uses `actual_heat = coil_heat + 100 * min(0, user_voltage - 2)`, with `user_voltage` counted from LV = 0. GT 2.9 instead uses coil heat + 100 × (tier − 2) with LV = 1:
  ```
  $ J -cp $GT -c -p gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace | grep -A10 'bipush 100'
    68: getCoilLevel … 71: HeatingCoilLevel.getHeat … 75: bipush 100 … 78: getMaxInputVoltage 81: GTUtility.getTier 84: iconst_2 85: isub 86: imul 87: iadd 88: putfield mHeatingCapacity
  $ J -cp $GT -c -p gregtech.api.enums.HeatingCoilLevel | awk '/getHeat/,/lreturn/'   → 1 + 900 × ordinal (None → 0)
  ```
  gtnh-flow therefore under-counts heat by one tier at LV and MV and gives no bonus at all from HV up. This is the textbook reason not to hand-copy GT formulas.
- **Catalyst wear.** The chemical plant code computes `catalyst_cost` from "50 durability per catalyst", then adds the *full* catalyst (`recipe.I += known_catalysts[recipe.catalyst]`), so the computed cost is never used (`overclocks.py`, `modifyChemPlant`).

**flow2 (GPL-3.0, learn only).** A rigorous study of why GTNH flows break linear algebra. Its `research.md` was committed as "ai research on solvers and layout engines - see research.md" (2026-07-06). Every claim in it is backed by runnable tests in that repo; we did not re-run them.

- **Why a plain linear system fails** ([math.md](https://github.com/OrderedSet86/flow2/blob/main/math.md)):
  - (1) "non-fully recycling loops".
  - (2) "If 'parallel' output ratios of a machine are used later in different ratios, then either excess will need to be discarded, or more product added".
- **Why one-objective LPs fail:**
  - Minimizing what is pulled from outside leads to "it could instead solve it by pulling 2 of product A from source and setting everything to 0. 2 < 1000".
  - Rewarding internal flow is "unbounded" on positive loops.
- **The answer** ([research/research.md](https://github.com/OrderedSet86/flow2/blob/main/research/research.md)): "yes — as a small mixed-integer program". The stages are:
  - Stage 0: "every machine runs".
  - Stage 1: "minimize the number of open gates", where a gate is a binary switch on an outside source or sink.
  - Stage 2: "minimize total external quantity".
  - Stage 3: "minimize total internal flow".
- **Solver results (reported).** "HiGHS — the only backend inside budget everywhere (worst case 1.4s)". "CBC — DNFs on palladium_line AND returns conservation-violating solutions". The 394-machine nanocircuits chart solves in 0.49 s with HiGHS (`research/q1_milp/bench_results.md`).
- **Engineering traps (reported):**
  - "Big-M × integrality tolerance leak: a binary at 3e-7 passes M·tol units through a 'closed' gate".
  - "PuLP silently resets `Binary` variable bounds to (0,1)".
  - "HiGHS presolve falsely reports infeasibility on tight cardinality-cap rows".
  - "Row scaling is mandatory — recipe quantities span 0.05 dust to 20000 L".
- **Diagnostics.** When a chart is infeasible, it reports a minimal conflicting set of constraints (an "IIS", via a deletion filter) and explains it in plain terms.
- **Layout (relevant to our flow diagram):**
  - "OGDF orthogonal (planarization) is the crossing champion at every size".
  - For ELK: "the decisive option is `cycleBreaking.strategy=DEPTH_FIRST`, which halves crossings on recycle-loop-heavy charts".
  - "shuffling the order moved [Source] PMP from the top of 230_platline to 75% down": layout depends on input order, so fix the order first (`canonicalize_order`).

**PlanNH (MIT).**

- From the [README](https://github.com/sbancuz/PlanNH/blob/master/README.md): "In-game flowchart-based production planner … Recipes can be added using NEI … Production balancer … uses ojAlgo … Client side only. No server binary required!"
- **Build.** `dependencies.gradle` has `compileOnly("com.github.GTNewHorizons:GT5-Unofficial:5.09.54.221:dev")` and `api("com.github.GTNewHorizons:NotEnoughItems:2.8.159-GTNH:dev")`. Both are newer than our RC-1, so whether it runs on RC-1 is **UNVERIFIED**.
- **Overclocking.** It calls GT's code directly, from `data/effect/steps/GTOverclockStep.java`:
  ```java
  final OverclockCalculator calc = new OverclockCalculator().setRecipeEUt(eut).setEUt(voltage)
      .setDuration(duration).setAmperage(amp).setDurationModifier(100.0 / speed)
      .setParallel(parallels).setAmperageOC(true);
  … if (forcePerfectOC) calc.enablePerfectOC(); … calc.setHeatOC(true).setRecipeHeat(…).setMachineHeat(machineHeat); …
  calc.calculate(); current.durationTicks(calc.getDuration()); current.energyPerT(calc.getConsumption());
  ```
  Which settings apply to which machine is still configured by hand, per recipe map (`route(recipeMapId, …)`). Voltage per tier is `8L * (long) Math.pow(4, i)`, starting at ULV.
- **Balancer modes** (`BalanceMode.java`):
  - `OUTPUT` and `INPUT` modes use `ExtentMinStage`.
  - `AUTO` = `GateCountStage` → `ExternalMinStage` → `FlowMinStage`, with a zero-gate fast path and an "every machine runs" check.
- **Numerics** (`Numerics.java`): a relative big-M (`bigMFactor = 1e3`, `maxMGrowths = 3`) and a 20 s total budget (`solveBudgetMillis = 20_000`).
- **Chances** come from NEI stacks: `(float) ps.getChance() / CHANCE_FULL` (`Port.java`), so they are expected values.

**GTNH Calculator by ShadowTheAge (MIT code).** Written by the author of YAFC. The README is candid: "Large parts of this project were written using AI assistance … After this goal is done, it won't be an actively maintained project". Its `Other versions.md` lists "Current main version: **2.8.0**". The data repository has a `2.9.0-v7` branch (`gh api repos/ShadowTheAge/gtnh-data/branches` → `2.8.0-v4 2.8.0-v5 2.8.0-v6 2.9.0-v7 main`).

- **Solver** (`src/solver.ts`): `optimize: "obj", opType: "min"`, with `model.variables[varName] = {"obj":1}` for each recipe. It minimizes the total number of recipe runs, subject to equality links between producers and consumers. Unlinked goods become external inputs and outputs.
- **Chances** are expected values: `let amount = slot.amount * slot.probability;`.
- **Ore dictionary.** The first member of an oredict slot that is produced inside the group gets linked: `for (const item of oreDict.items) … CreateLinkByAlgorithm(…); break`.
- **Fluid containers.** A cell is automatically split into its fluid plus the empty cell: `collection.AddInput(container.fluid, amount * container.amount, …); collection.AddInput(container.empty, amount, …)`.
- **Rounding.** "// Handle duration rounding. It always truncates decimals, i.e. favoring the player. In case of subtick processing we assume no rounding is taking place … Some machines round after parallels, for example Advanced Assembly Line".
- **Overclocking for multiblocks.** `overclockTiers = isSingleblock ? tierDifference : Math.min(tierDifference, Math.floor(Math.log2(maxParallels / parallels) / 2))`: power spent on parallels is not available for overclocks.
- **Curated machine table.** `src/machines.ts` contains 118 `machines["…"] =` assignment lines (`grep -c '^machines\["' src_machines.ts` → `118`), and some lines cover several machines. Steam machines carry `info: "Steam machine: Steam consumption not calculated"`.
- **Circuit conflicts** (`export/RecipeConflictsCalculator.cs`): it reads circuits as `input.amount == 0 && input.goods.unlocalizedName == "gt.integrated_circuit"`, then `if (outherCircuit != circuit && otherIngredients.IsSubsetOf(ingredients)) recipe.gtInfo.circuitConflicts |= (1 << outherCircuit);`. In words: it flags recipes that another recipe in the same machine could wrongly pick up.
- **Hard-coded fixes** (`export/HardcodeFixes.cs`): the canner's fluid slots and the Eye of Harmony's fluid inputs are patched by hand.

**GTNH Factory Flow (MIT code).** This is the closest existing project to ours. It has its own exporter, a web UI, an LP solver and project sharing with task lists.

- **Doctrine** ([docs/solver-equations.md](https://github.com/jackwrichards/gtnh-factory-flow/blob/main/docs/solver-equations.md)): "nothing from nowhere, nothing into nowhere … If it would fail in game, it fails in the planner".
- **Why it moved away from iteration:** "a machine cannot tell 'my neighbour is genuinely limited' from 'my neighbour's number has not finished settling.'"
- **Formulation:**
  - Variables: `act[m]` per machine, `flow[e] >= 0` per wire, `pull[s]` per source, `catch[d]` per drain.
  - Stages for Build mode: "Everything runs", then "Fairness (progressive max-min)", then "Minimize source pulls", then "Ship before banking", then "Canonicalize (minimize total flow)".
- **Solve mode** (counts unknown; [src/lib/solver/CLAUDE.md](https://github.com/jackwrichards/gtnh-factory-flow/blob/main/src/lib/solver/CLAUDE.md)): "Objective: least machinery, then least imports, fill and flow". Engines: "`lp-engine.ts` uses HiGHS (WASM) when loaded, else the homegrown simplex".
- **Determinism**, learned from PlanNH: "a pinned test that solves the same chart twelve times and asserts the answers AGREE".
- **Machine math** ([src/lib/machines/CLAUDE.md](https://github.com/jackwrichards/gtnh-factory-flow/blob/main/src/lib/machines/CLAUDE.md)):
  - "Engine truth is `OverclockCalculator`, `ParallelHelper`, `ProcessingLogic` and each MTE's `createProcessingLogic`; GT++ `*Legacy` classes are fossils. Java `int *= float` computes in float: replicate it".
  - "Parallels are paid for with power BEFORE overclocks".
  - "Heat overclocks: only the `HEAT_OVERCLOCK` entries (EBF, Mega EBF, Volcanus, Exothermic Hearth, Zyngen, Utupu-Tanuri)".
  - "Recipes run in whole ticks. Over one tick GT truncates. Under one tick a multiblock banks leftover speed as parallels and a singleblock wastes it".
  - "`runtimeCalculation` in the dataset is `OverclockCalculator` alone (never saw `GTParallelHelper`), so it is not authoritative for multiblocks".
  - "Steam … EU stays zero on steam cards; litres are billed instead, never both".
  - "Crafting maps run on GT++'s Auto Workbench (… flat 2048 EU per craft) with instant hand-craft as the second handler".
- **Data model** ([src/lib/model/CLAUDE.md](https://github.com/jackwrichards/gtnh-factory-flow/blob/main/src/lib/model/CLAUDE.md)):
  - "A filled cell is an ordinary ITEM; it never satisfies its fluid's slot or the reverse … Never auto-convert at a guessed 1000 L per cell: it hid a real machine, its empty cells and its power".
  - "A recipe picked from a concrete item keeps that concrete item in its slots … (Spruce Log never silently becomes Oak Log)".
  - Shared machines: "the ONLY coupling is a time row …: sections' acts sum to at most one". Its task board has per-line checklist items "so two people can tick two at once".
- The GT classes those notes name exist in RC-1:
  ```
  $ unzip -l $GT | grep -E '(ParallelHelper|ProcessingLogic|OverclockCalculator)\.class$'
    gregtech/api/logic/ProcessingLogic.class  gregtech/api/util/OverclockCalculator.class  gregtech/api/util/ParallelHelper.class
  $ J -cp $GT -p gregtech.api.logic.ProcessingLogic | grep -E 'create(Parallel|Overclock)'
    protected gregtech.api.util.ParallelHelper createParallelHelper(gregtech.api.util.GTRecipe);
    protected gregtech.api.util.OverclockCalculator createOverclockCalculator(gregtech.api.util.GTRecipe);
  ```

**Greginator (MIT).** A set of small calculators. Its overclock calculator models GT multiblock batch mode (`var MAX_BATCH_MODE_TICK_TIME = 128;`, `js/greginator/overclock-calculator.js`) and cites GT's own functions ("SOURCE: calculateAmountOfNeededOverclocks function in GT_OverclockCalculator.java"). Its recipe conflict checker reads the RecEx-format data (`recipe.iI.concat(recipe.fI)…`).

**NEI bookmark recipe chain (in our pack).** GTNH NEI can already total up a chain of bookmarked recipes using whole numbers: `RecipeChainMath` with `removeLoop`, `requiredAmount: Map<BookmarkItem, Long>`, container-item handling, and `getGTToolDamagePerContainerCraft`. The results are labelled `INGREDIENT`, `RESULT` and `REMAINDER`. Players can use it to cross-check our batch counts.

```
$ J -cp $NEI -p codechicken.nei.recipe.chain.RecipeChainMath | grep -E 'removeLoop|requiredAmount|ToolDamage|containerItems'
  private void removeLoop(…);  public final java.util.Map<…BookmarkItem, java.lang.Long> requiredAmount;
  public final java.util.List<net.minecraft.item.ItemStack> containerItemsCrafting; … private int getGTToolDamagePerContainerCraft(net.minecraft.item.ItemStack);
$ J -cp $NEI -p 'codechicken.nei.bookmark.RecipeChainDetails$CalculatedType'   → INGREDIENT, RESULT, REMAINDER
```

**YAFC cost analysis (GPL-3.0, learn only).** One LP gives every item a cost. It is the dual of a least-cost production problem: the variables are item costs, `objective.SetMaximization()`, and for each recipe there is one constraint `MakeConstraint(double.NegativeInfinity, 0, recipe.name)` with product costs × amount at +, ingredient costs × amount at −, and `constraint.SetUb(logisticsCost)`. Cost variables are bounded, `MakeVar(CostLowerLimit, CostLimitWhenGeneratesOnMap / mapGeneratedAmount, …)` with `CostLowerLimit = -10f`, so loops and "free" sources cannot make the problem unbounded. The engine is `using Google.OrTools.LinearSolver;` (`Yafc.Model/Analysis/CostAnalysis.cs` in yafc-ce). This is the algorithm behind our "alternatives sorted by raw material use" (§3.4).

**FactorioLab (MIT).** It chooses recipes automatically:

- **Recipe pool.** "/** Look for recipes that output a passed item, recursively */ private parseItemRecursively(…)".
- **Model.** A minimum-cost LP, `const m = new Model({ sense: 'min' })`, with separate variables for recipes, "items that cannot be produced by any recipe" (unproduceable), excluded items, surplus and maximize targets (`src/solver/solver.ts`).
- **Cost settings** (`src/state/settings/cost-settings.ts` and `settings-state.ts`):
  - Keys: `factor`, `machine`, `footprint`, `unproduceable`, `excluded`, `surplus`, `maximize`, `recycling`.
  - Defaults: `unproduceable: rational(100000000n)`, `excluded: rational.zero`, `surplus: rational.zero`.
- **Fluids** get a fixed cost ratio: "/** In Factorio, one item ~= ten fluid units */ FACTORIO_FLUID_COST_RATIO = rational(1n, 10n)". This is the same idea as our "1,000 L = 1".

### 2.3 How they model GregTech

| Aspect | gtnh-flow / flow2 | PlanNH | ShadowTheAge calc | GTNH Factory Flow | NEI chain | YAFC / FactorioLab |
|---|---|---|---|---|---|---|
| Overclocking | hand table + formulas (has drifted, see EBF) | GT `OverclockCalculator` called live; per-map settings | curated `machines.ts`; standard, perfect, or none | curated table + `OverclockCalculator` run per recipe × tier in the exporter | none | n/a |
| Non-consumed inputs | user leaves them out | from NEI | amount 0 kept; drives circuit-conflict flags | `consumed:false` (amount 0 or input chance ≤ 0), left out of flows | containers and GT tool damage | n/a |
| Chanced outputs | user pre-multiplies | expected value (NEI chance / 10000) | expected value | exported per slot; expected value | **UNVERIFIED** | expected value |
| Byproducts and loops | v1: removes back edges, fails on parallel outputs; flow2: native via gates | native (gated sources and sinks) | links Match or Ignore; free external outputs | native: conservation rows, drains, trash | `removeLoop` | native LP; surplus variables |
| Ore dictionary | plain names | NEI stacks | first member produced in the group | concrete item picks plus oredict membership | preferred items | n/a |
| Recipe choice | user | user | user | user (Pool only wires) | user | FactorioLab: automatic; YAFC: user plus cost ranking |
| Objective | none (v1); lexicographic gates → external → flow (v2) | lexicographic chain | min Σ recipe runs | Build: max act → fairness → min pulls → min fill → min flow; Solve: least machinery → imports → flow | n/a | min Σ cost (recipe/machine cost, unproduceable 1e8, surplus 0) |
| Engine | SymPy; HiGHS (v2) | ojAlgo | javascript-lp-solver | HiGHS WASM or own simplex | none | OR-Tools / GLPK |

### 2.4 Pitfalls the prior art documents

| # | Pitfall | Source (quote or evidence above) | What it means for us |
|---|---|---|---|
| P1 | A plain linear system fails on loops and on mismatched output ratios | gtnh-flow README; flow2 math.md | Use an LP with explicit source and sink variables |
| P2 | One weighted objective degenerates ("2 < 1000") or becomes unbounded | flow2 math.md | Solve lexicographically, in stages; bound or zero-cost the sinks |
| P3 | Solver numerics: unscaled rows, big-M leaks, PuLP binary bounds, HiGHS presolve, wrong CBC answers | flow2 research.md | HiGHS, row scaling, check residuals; avoid binaries where possible |
| P4 | Tied optima wander between runs | Factory Flow solver-equations.md | Final canonicalizing stage plus a repeated-solve test |
| P5 | Hand-copied overclock and heat formulas drift from GT | gtnh-flow EBF bug (verified above) | Run GT's `OverclockCalculator` in the exporter; curate only the multiblock extras |
| P6 | Whole-tick and sub-tick rounding; parallels before overclocks; Java float maths | Factory Flow machines notes; ShadowTheAge `solver.ts` | Take numbers from GT's code, not a re-derivation (see the bytecode note in §3.5) |
| P7 | `OverclockCalculator` alone is wrong for multiblocks | Factory Flow machines notes | Add `ParallelHelper` and per-machine logic, or a curated table, for the multiblocks we support |
| P8 | Cells versus fluids: converting at 1000 L per cell hides the canner | Factory Flow model notes (ShadowTheAge auto-expands) | Keep cells as items; put canning in the plan explicitly |
| P9 | An oredict slot silently switching to another item | Factory Flow model notes | Store concrete picks; let the solver choose among oredict members but report the pick |
| P10 | Circuit conflicts when one machine runs several recipes | ShadowTheAge `RecipeConflictsCalculator.cs`; Greginator | Flag them in batch mode (shared owned machines) and in machine-to-machine lines |
| P11 | Steam machines: steam use missing or double-counted | ShadowTheAge `info` string; Factory Flow ("litres are billed instead, never both") | Model steam as a fluid input with 0 EU |
| P12 | Catalyst and tool wear | gtnh-flow chemical plant; oracle "wearing inputs"; NEI GT tool damage | Cost per use = item cost ÷ uses |
| P13 | Export order changes; map IDs renamed between RCs | Factory Flow pipeline notes; T4, T5 | Content-hash IDs; alias table; mapping report |
| P14 | Layout depends on input order | flow2 Q3 | Fix the node order before running ELK |
| P15 | Per-item "objective values" are hard to maintain for GTNH | gtnh-flow README | Cost only base materials by rule; derive all other costs (§3.3) |

---

## 3. Recommendations for our planner

These follow from the approved design: least raw material counted as items (144 L molten = 1 ingot, 1,000 L of any other fluid = 1, water/air/cobblestone/lava free, per-project editable costs), a tier limit, rate mode, and batch mode on owned machines.

### 3.1 Export (input to the export-mod decision)

1. **Write a small exporter of our own (MIT), modeled on `gtnh-calc-oracle`'s approach.** Don't adopt upstream NESQL: it fails on 2.9 (T1), brings Hibernate and HSQLDB, produces ~600 MB, takes ~60 min, and reads cleanroom wrongly (T2). If we need data fast, the ShadowTheAge NESQL fork is the quickest working route on 2.9 (LGPL; we run it as a tool and don't vendor its code), but its runtime on RC-1 is **UNVERIFIED**. Everything we need to read exists on the common (non-client) side of the RC-1 jar:
   ```
   $ J -cp $GT -p gregtech.api.recipe.RecipeMap | grep -E 'ALL_RECIPE_MAPS|unlocalizedName|getAllRecipes|getAmperage'
     public static final java.util.Map<java.lang.String, gregtech.api.recipe.RecipeMap<?>> ALL_RECIPE_MAPS;
     public final java.lang.String unlocalizedName;  public java.util.Collection<gregtech.api.util.GTRecipe> getAllRecipes();  public int getAmperage();
   ```
2. **Plan for a client copy.** Every prior exporter that makes icons, NEI layouts or machine-per-map lists (catalysts) runs in a client. The oracle shows that a client at the main menu, started headless, is enough for recipes, with no world needed. Recipe maps, the crafting manager, furnace recipes and the ore dictionary are common-side, so a server copy can export recipes too. Icons, NEI catalysts and possibly display names (T13) need a client copy. **Decision for the export topic:** either one client-side export on a separate copy of the client instance, or a server copy for recipes plus a client copy for icons.
3. **Must-export fields**, beyond what NESQL had:
   - all four chance arrays (T6);
   - input consumption as amount 0 or chance 0 (T7);
   - the full metadata map, and cleanroom / low gravity from metadata (T2, T3);
   - `mOreDictAlt` and `mAltFluidInputs`;
   - flags (T9);
   - every map a recipe belongs to (T10);
   - the machines for each map and their available tiers (T12);
   - an `OverclockCalculator` result per recipe × tier × profile, as the oracle does;
   - English names;
   - GT material association per item: `GTOreDictUnificator.getAssociation(ItemStack) → ItemData{mPrefix, mMaterial, …}` and `OrePrefixes.getMaterialAmount()`, for the cost model;
   - crafting container items and tool wear (NEI's `hasContainerItem` and GT tool damage);
   - the pack and GT versions in the dataset header.
   ```
   $ J -cp $GT -p gregtech.api.objects.ItemData | grep 'public final'
     public final gregtech.api.enums.OrePrefixes mPrefix;  public final gregtech.api.objects.MaterialStack mMaterial;  public final gregtech.api.objects.MaterialStack[] mByProducts;
   $ J -cp $GT -p gregtech.api.enums.OrePrefixes | grep getMaterialAmount   → public long getMaterialAmount();
   $ J -cp $GT -p -constants gregtech.api.enums.GTValues | grep -E ' (L|M|W) ='
     public static final long M = 3628800l;  public static final long L = 144l;  public static final short W = 32767;
   ```
4. **Stable identity.**
   - Recipe ID = hash of the normalized content (T5).
   - Item key = registry name + meta (+ an NBT hash when `isNBTSensitive`). Never numeric IDs: the 2.9 worlds are EndlessIDs-converted, and IDs differ from world to world.
   - Keep a map-alias table (T4) and write a mapping report on every re-export.

### 3.2 Data model

A minimal shape; the names are suggestions.

```text
Good       { key: "i:<registry>:<meta>[#nbt]" | "f:<fluidName>", name, kind: item|fluid,
             oredict: string[], gt?: { prefix, material, amountM }, isMolten (fluid name "molten.*"), free?: bool }
OreSlot    { key: "o:<oredictName>", members: Good.key[] }        // members with meta W=32767 already expanded
RecipeMap  { id: unlocalizedName, aliases: string[], name, amperage, handlers: Handler[] }
Handler    { machine, kind: single|multi|steam|crafting|furnace, tiers: int[], ocProfile, extras? (parallels, speed, EU factor), footprint? }
Recipe     { id: contentHash, maps: string[], euPerTick: long, durationTicks: int>=1, specialValue: int,
             meta: { cleanroom, lowGravity, coilHeat?, fusionStartEu?, … raw }, circuit?: int,
             inItems: Slot[], inFluids: Slot[], outItems: Out[], outFluids: Out[],
             flags: { enabled, hidden, fake, nbtSensitive, recycle, dynamicMap }, owners: string[] }
Slot       { accepts: Good.key | OreSlot.key | Good.key[], amount, consumeChance: 0..10000 }   // 0 amount or 0 chance → not consumed
Out        { good: Good.key, amount, chance: 1..10000 }
Crafting   { shaped|shapeless, slots with alternatives, returns: container items, tools: { good, wearPerCraft } }
```

GT registers molten fluids under the `molten.` prefix, so `isMolten` can be computed from the fluid name:

```
$ J -cp $GT -c -p gregtech.common.GTProxy | grep -E 'String (molten|plasma)\.'
  // String molten.autogenerated … // String molten. … // String plasma.
```

Other mods' molten fluids (for example Tinkers') would need their own rule. **UNVERIFIED** whether any appear in the recipes we plan with.

### 3.3 Material cost model

- **Store costs per material, not per item.** For an item with a GT association, cost = `costPerIngot(material) × prefix.getMaterialAmount() / M`. A molten fluid costs `costPerIngot × litres / 144` (`GTValues.L = 144`, verified above). Any other fluid costs 1 per 1,000 L. Water, air, cobblestone and lava cost 0. Users then edit "silver = 5" once, and it covers ingots, dusts, nuggets, blocks and molten silver. This avoids gtnh-flow's worry about maintaining a value for every item (P15).
- **Base materials are the only goods the solver may buy.** Anything else must be produced. "We already make this" adds an item to the buyable set at its normal cost. Define that normal cost as the item's computed raw cost (the YAFC-style value from §3.4), still editable. The solver is then indifferent between buying and making, and the tie-break (power) makes it buy.
- **Risk: ores against ingots** (reasoned, to check on the export). If ores and ingots both cost 1, the LP will tend to run ore processing, because one ore yields more than one ingot's worth of product. Options:
  - (a) price an ore at its default processing yield;
  - (b) leave ores out of the default buyable set;
  - (c) ask the user.

  This needs a decision before building the solver.
- **Risk: free inputs make degenerate routes** (verified example). 2.9 centrifuges 3,600 L of lava with programmed circuit 20 into 5 SiO₂ dust (90%), 1 magnesia (90%), 1 quicklime (90%), 1 gold ingot (10%), 3 sapphire dust (37.5%) and 1 tantalite dust (45%), in 2,880 ticks at 80 EU/t. With lava free, a raw-material-only objective prices gold at 0, at roughly 24 base-speed centrifuges per gold per minute. Any tie-break on power cannot fix this, because 0 beats every positive cost. §3.4 lists the guards.
  ```
  $ J -cp $GT -c -p gregtech.loaders.postload.recipes.CentrifugeRecipes   (excerpt, offsets 5217–5366)
    bipush 20 → circuit(I) … SiliconDioxide iconst_5 getDust … Magnesia iconst_1 … Quicklime iconst_1 … Gold iconst_1 getIngots … Sapphire iconst_3 … Tantalite iconst_1 → itemOutputs
    sipush 9000, 9000, 9000, 1000, 3750, 4500 → outputChances … Materials.Lava ldc2_w 3600 → getFluid → fluidInputs … sipush 2880 → duration … bipush 80 → eut … RecipeMaps.centrifugeRecipes → addTo
  ```
- **Byproduct credit.** Byproducts used elsewhere in the line reduce purchases automatically in the LP, which is the "savings" in the design. Excess byproducts leave through sink variables at cost 0. Give an excess byproduct a value only when the user sets one explicitly, and cap the credit. Otherwise "make X only for its byproduct" solutions appear (FactorioLab's default surplus cost is 0; YAFC bounds costs at −10).

### 3.4 Solver for rate mode

1. **Candidate recipes.** Search backwards from the target over recipes that are enabled, not fake, not in a code-generated map, not recycling (`RECYCLE`), feasible at the tier (§3.5), and not blocked by special conditions:
   - drop low gravity unless the group has space access;
   - cleanroom recipes add a cleanroom to the build list.

   GTNH's recipe graph is very large, so prune with item costs.
2. **Item costs (dual LP, YAFC-style).** For the current (tier, cost table), solve one LP over all candidate recipes: maximize Σ cost(g) × weight subject to Σ out·cost − Σ in·cost ≤ 0 for each recipe, and cost(base) ≤ its price, with lower and upper bounds as in YAFC. The result is a raw cost per unit for every good, which serves three purposes:
   - it ranks alternatives in the flow-diagram "swap recipe" list, cheapest first (design §3.9);
   - it prunes recipes whose cost is far above the cheapest alternative;
   - it gives the "normal cost" of "we already make this" items.

   One caveat: when a recipe has co-products, the split of its cost between them is not unique, because it depends on the weights. Use these costs for ranking and pruning only; the actual plan always comes from the main LP below.
3. **Main LP (extent form).**
   - Variables: x_r ≥ 0 crafts per second per recipe; buy_g ≥ 0 for buyable goods; sink_g ≥ 0 for every good.
   - One row per good: Σ_r a_rg·x_r + buy_g − sink_g = demand_g.
   - a_rg = amount × chance / 10000 for outputs, and −amount × consumeChance / 10000 for consumed inputs. Non-consumed inputs (amount 0 or chance 0) get no coefficient; they become one-off build items per machine.
   - Each oredict slot becomes a virtual good `o:<name>`, fed by free conversion recipes from each member.
   - Scale each row by 1/max(1, qty) (PlanNH and flow2 practice), because quantities range from 0.05 dust to 20,000 L.
4. **Lexicographic stages,** each locking the previous optimum within a tolerance:
   - S1: minimize Σ cost_g·buy_g (the design objective).
   - S2: minimize power, Σ EU/t_r · duration_r · x_r. This is only a tie-break; machines, power and speed stay displayed, not optimized, as the design requires.
   - S3 (optional, MILP on the small fixed model): minimize the number of distinct recipes, for simpler lines.
   - S4: canonicalize (minimize Σ x_r, with a fixed variable order).
5. **Guards against degenerate free routes** (§3.3), offered per project:
   - Leave risky recipe classes out by default: recycling, the mass fabricator, the replicator, scrap/recycler, and "lava/stone dust centrifuging" as a named exclusion list, with toggles.
   - An optional cap on machines per step, or a total EU/t budget taken from the power estimate. A degenerate route then becomes infeasible instead of chosen.
   - Always show "this route uses free inputs at N machines" in the alternatives list.
6. **Engine.** HiGHS (MIT): `highs-js` (MIT) in Node, or `highspy` in Python. Both flow2's benchmarks and Factory Flow's production choice point to it. `javascript-lp-solver` (Unlicense) is acceptable only for tiny models. Keep GLPK (`glpk.js`, GPL-3.0) out of our MIT code. After solving, recompute machine counts in exact rational arithmetic and check residuals. The [gtnh-shadow-convert README](https://github.com/MrBruh/gtnh-shadow-convert) explains why: "every rate is a `Fraction` and the LP is an exact simplex (`lp.py`), so a machine count that is exactly 2 stays 2 when it is rounded up".
7. **When it is infeasible,** report a minimal conflicting set of constraints in plain words, as flow2 does with a deletion filter. For example: "nothing at ≤ MV makes X".

### 3.5 Tier limit and overclocking

- **Recipe tier.** The recipe's voltage per amp is `mEUt / map.getAmperage()` (NESQL's rule). Its minimum tier is the first `GTValues.V[i]` at or above it:
  ```
  $ J -cp $GT -c -p gregtech.api.enums.GTValues | awk '/static \{\};/,0' | grep ldc2_w | head -15
    8 32 128 512 2048 8192 32768 131072 524288 2097152 8388608 33554432 134217728 536870912 2147483640 …
  ```
  Note that index 14 is 2,147,483,640, not 2³¹. A recipe is usable when its tier ≤ the current tier **and** a handler machine exists at a tier ≤ current (T12).
- **Overclocking.** Take overclocked numbers from GT's own `OverclockCalculator`, computed in the exporter as the oracle does, or called at runtime like PlanNH. Do not re-derive them. The RC-1 defaults are standard ×4 EU / ÷2 duration, perfect ÷4, heat overclock thresholds 900 and 1800, and heat discount 0.95:
  ```
  $ J -cp $GT -p -constants gregtech.api.util.OverclockCalculator | grep -E 'HEAT_|durationDecreasePerHeatOC'
    protected final double durationDecreasePerHeatOC = 4.0d;  protected static final int HEAT_DISCOUNT_THRESHOLD = 900;  protected static final int HEAT_OVERCLOCK_THRESHOLD = 1800;
  $ J -cp $GT -c -p gregtech.api.util.OverclockCalculator | awk '/public gregtech.api.util.OverclockCalculator\(\);/,/return/' | grep -B1 -E 'PerOC|heatDiscountExponent'
    ldc2_w 4.0d → eutIncreasePerOC; ldc2_w 2.0d → durationDecreasePerOC; … ldc2_w 0.95d → heatDiscountExponent
  $ … | awk '/enablePerfectOC/,/areturn/'   → ldc2_w 4.0d → durationDecreasePerOC
  ```
  The rounding is subtle. `calculateOverclock` uses `Math.ceil` + `d2i` on one path and `Math.max` + `d2i` (truncation) on others, so "always truncates" (ShadowTheAge) is an approximation. Which path is which is **UNVERIFIED**, so calling GT's code is safer than re-implementing it.
- **Multiblocks.** Keep a small curated table of the multiblocks the group actually uses at their tier, starting with the EBF (heat = coil + 100 × (tier − 2), verified above). Extend it from ShadowTheAge's `machines.ts` (MIT), which Factory Flow also uses as its reference, and check every entry against GT source.

### 3.6 Batch mode on owned machines

- **Rename it.** GT multiblocks already have a "batch mode" toggle that merges up to 128 runs into one longer run. Our "batch mode" means "make N once", so the UI should say something like "One-off batch" or "Make N".
  ```
  $ J -cp $GT -c -p gregtech.api.metatileentity.implementations.MTEMultiBlockBase | awk '/getMaxBatchSize/,/ireturn/'  → sipush 128
  $ J -cp $GT -p -constants gregtech.api.util.ParallelHelper | grep BATCH   → MAX_BATCH_MODE_TICK_TIME = 128.0d
  $ J -cp $GT -p -constants gregtech.api.metatileentity.implementations.MTEMultiBlockBase | grep BATCH_MODE_NBT_KEY → "batchMode"
  ```
  The world scan can read the `batchMode` NBT key on owned multiblock controllers, because it changes throughput. Where the key sits inside the tile-entity NBT is **UNVERIFIED**.
- **Algorithm** (new: no GTNH tool schedules work):
  - (1) Run the same LP with demand N to choose recipes.
  - (2) Round crafts up to whole numbers per recipe and track the leftovers (the NEI chain's `REMAINDER` idea).
  - (3) Assign crafts to owned machines by map and tier, using overclocked durations at the owned machine's tier. Machines shared between steps get a time row (Σ crafts × duration ≤ available time; Factory Flow's shared-machine idea).
  - (4) Estimate time as roughly the slowest step plus the time to fill the chain once.
  - (5) Add machines only for maps that no owned machine can run at a sufficient tier, and show their build cost.
- **Chances in small batches.** With few crafts, expected values under-deliver. Show the expected amount plus a margin, for example a 95% binomial quantile.
- **Conflicts.** Flag circuit conflicts (P10) when one owned machine serves several recipes in the batch.

### 3.7 Testing and validation

- **Golden fixtures.** Reuse the community plans in gtnh-flow (`projects/`, MIT) and ShadowTheAge's `tests/*.gtnh` (MIT repository) as solver test inputs, after converting them to our format. flow2's corpus is GPL, so use it as a reference only.
- **Determinism.** Run the same solve 12 times and assert identical results (Factory Flow / PlanNH practice). Check residuals; recompute final counts in rational arithmetic.
- **Overclock oracle.** Compare our per-tier durations with the exporter's `OverclockCalculator` output and with the in-game NEI overclock tooltip for a few singleblocks and the EBF.

### 3.8 What to reuse versus only learn from (licenses)

- **Reuse is fine (MIT-compatible):**
  - gtnh-flow (MIT) and PlanNH (MIT);
  - ShadowTheAge calculator code (MIT), including its machine table;
  - GTNH Factory Flow code, including `gtnh-calc-oracle` (MIT);
  - Greginator (MIT) and FactorioLab (MIT);
  - HiGHS and highs-js (MIT), ojAlgo (MIT), jsLPSolver (Unlicense), OR-Tools (Apache-2.0).
- **Learn only; don't copy code into our MIT repository:** flow2 and YAFC (GPL-3.0), RecEx and NotEnoughProduction (GPL-3.0), glpk.js (GPL-3.0).
- **LGPL-3.0, so run as separate tools or depend on unmodified:** NESQL Exporter and its forks, NotEnoughItems, GT5-Unofficial, GuideNH.
- **Never import game-derived data repositories**, such as ShadowTheAge/gtnh-data (no license stated, contains icon atlases). This is consistent with our rule that exported data and icons are generated locally and never committed.

License evidence:

```
$ for r in ERGO-Code/HiGHS lovasoa/highs-js JWally/jsLPSolver jvail/glpk.js optimatika/ojAlgo google/or-tools; do gh api repos/$r --jq .license.spdx_id; done
  MIT  MIT  Unlicense  GPL-3.0  MIT  Apache-2.0
$ gh api repos/ShadowTheAge/nesql-exporter/contents/LICENSE.md -H 'Accept: application/vnd.github.raw' | head -1   → ### GNU LESSER GENERAL PUBLIC LICENSE
$ gh api repos/jackwrichards/gtnh-factory-flow/contents/LICENSE -H 'Accept: application/vnd.github.raw' | head -1  → MIT License
$ gh api repos/OrderedSet86/flow2/contents/LICENSE -H 'Accept: application/vnd.github.raw' | head -2             → GNU GENERAL PUBLIC LICENSE
```

---

## 4. Open questions and UNVERIFIED items

1. **The ShadowTheAge NESQL fork on RC-1.** It is built against beta-2 (GT 5.09.54.20) and its GT symbols resolve against RC-1, but it has not been run.
2. **Main-menu exports.** Does a client at the main menu see every recipe, or do some mods add recipes at server start? `scripts/` is empty, which lowers but does not remove the risk. Compare recipe counts from the main menu and from inside a world once.
3. **Display names on a dedicated server** (T13).
4. **Code-generated maps.** Does `getAllRecipes()` list anything for `ReplicatorBackend`, `RecyclerBackend` and the fake maps (T9)?
5. **Default ore pricing** and the free-input guard policy (§3.3, §3.4). These are design decisions for the group.
6. **PlanNH on RC-1.** It is built against NEI 2.8.159 and GT 5.09.54.221, both newer than RC-1.
7. **Unidentified "neidatadump".** The data source "neidatadump (dev by atlantisspy)" named in OrderedSet86's `neidatadump_processing` README could not be found. NamesAreAPain/NEIDataDump may or may not be the same project.
8. **Reported numbers not re-measured:** gtcalc's method; flow2's solver benchmarks; Factory Flow's "~37,000 ids" and its machine-specific rules.
9. **Rounding paths** inside `OverclockCalculator.calculateOverclock` (§3.5).

## 5. Sources

Exporters:

- NESQL Exporter (upstream): https://github.com/D-Cysteine/nesql-exporter
- NESQL Server: https://github.com/D-Cysteine/nesql-server
- NESQL Exporter, GTNH fork: https://github.com/GTNewHorizons/nesql-exporter
- NESQL Exporter, ShadowTheAge fork: https://github.com/ShadowTheAge/nesql-exporter
- RecEx: https://github.com/bigbass1997/RecEx
- NEIDataDump: https://github.com/NamesAreAPain/NEIDataDump
- GTNH Factory Flow (with `gtnh-calc-oracle`): https://github.com/jackwrichards/gtnh-factory-flow; original: https://github.com/Samiracle64/gtnh-factory-flow

Planners and calculators:

- gtnh-flow: https://github.com/OrderedSet86/gtnh-flow
- flow2: https://github.com/OrderedSet86/flow2
- PlanNH: https://github.com/sbancuz/PlanNH
- GTNH Calculator (ShadowTheAge): https://github.com/ShadowTheAge/gtnh
- gtnh-shadow-convert: https://github.com/MrBruh/gtnh-shadow-convert
- Greginator: https://github.com/divran/greginator
- NotEnoughProduction: https://github.com/bigbass1997/NotEnoughProduction
- YAFC: https://github.com/ShadowTheAge/yafc; yafc-ce: https://github.com/shpaass/yafc-ce
- FactorioLab: https://github.com/factoriolab/factoriolab
- gtcalc: https://gtcalc.app/

GTNH references:

- GT5-Unofficial source at our tag: https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.183/src/main/java/gregtech/api/util/GTRecipe.java
- GTNH release manifests: https://github.com/GTNewHorizons/DreamAssemblerXXL/tree/master/releases/manifests
- GuideNH: https://github.com/GTNewHorizons/GuideNH
- GTNH wiki tool list: https://wiki.gtnewhorizons.com/wiki/Quick_Links

Solvers:

- HiGHS: https://github.com/ERGO-Code/HiGHS
- highs-js: https://github.com/lovasoa/highs-js
- jsLPSolver: https://github.com/JWally/jsLPSolver
- glpk.js: https://github.com/jvail/glpk.js
- ojAlgo: https://github.com/optimatika/ojAlgo
