# Export mod: recipes, items, fluids and machines from the 2.9 pack

Date: 2026-10-17 · Scope: GT New Horizons 2.9.0-RC-1 server pack (gregtech 5.09.54.183, Forge 10.13.4.1614, lwjgl3ify 3.0.35 on Java 25) · Status: reference for the build plan

This page answers six questions: how to build a small Forge 1.7.10 exporter mod for this pack, which GregTech and Forge APIs it reads, how to run it on a headless **copy** of the server, and what it writes. It complements [prior-art.md](prior-art.md), which surveys existing exporters and planners, and [world-format.md](world-format.md), which covers the save files.

## How to read the evidence

Every load-bearing claim carries its evidence inline: a command with a trimmed output excerpt (`…` marks a cut), or a URL with a quote. Placeholders in commands:

- `PACK`: the folder of the GTNH 2.9.0-RC-1 server pack, read-only.
- `J`: `javap` from a JDK 25 install. `GT`: `$PACK/mods/gregtech-5.09.54.183.jar`. `FORGE`: `$PACK/forge-1.7.10-10.13.4.1614-1.7.10-universal.jar`.
- `MC`: `build/rfg/recompiled_minecraft-1.7.10.jar`, the Forge-patched Minecraft with MCP names that the RFG build in §1 produces.
- `MCPCSV`: `methods.csv` from `mcp_stable-12-1.7.10.zip` (https://maven.minecraftforge.net/de/oceanlabs/mcp/mcp_stable/12-1.7.10/mcp_stable-12-1.7.10.zip). Its `side` column is 0 = client only, 1 = server only, 2 = both.
- `SKEL`: the skeleton exporter built while researching this page (§1.4). It **compiles** against GT 5.09.54.183 and the excerpts in Appendix A come from it. It was **never run in a server**: no server process was started for this research.

**UNVERIFIED** marks anything not checked against the jars or not observed at run time. Where a section cites the live server's own log, only pack-level lines are quoted, never player data. World-specific samples are kept in `docs/local/research-export-mod.md`, which is not committed.

## TL;DR

1. **Build with the GTNH template (option a).** Use ExampleMod1.7.10 with the `com.gtnewhorizons.gtnhsettingsconvention` 2.0.33 plugin, Gradle 9.7.1, the Gradle daemon on the local JDK 25, and `enableModernJavaSyntax = jabel`. Jabel compiles with an auto-downloaded JDK 17 to Java 8 bytecode. Depend on `compileOnly("com.github.GTNewHorizons:GT5-Unofficial:5.09.54.183:dev")`. The GTNH maven's `GT5-Unofficial-5.09.54.183.jar` has the same SHA-1 as the pack's `gregtech-5.09.54.183.jar`. `VERSION=0.1.0 ./gradlew assemble` builds `build/libs/<modid>-0.1.0.jar`. That jar is reobfuscated to SRG names, which is what the server needs. Verified end to end: the first build took ~2 min, later builds ~6 s. §1
2. **Plain `javac` (option b) is not workable.** No local jar contains `net.minecraft.item.ItemStack`. The vanilla server jar and the Forge universal jar both ship in Notch names. Every vanilla type and member would need reflection plus hand-written stubs. §1.3
3. **GregTech API:**
   - Maps: `RecipeMap.ALL_RECIPE_MAPS` (`Map<String, RecipeMap<?>>`, keyed by `unlocalizedName`). Recipes: `map.getAllRecipes()`.
   - Recipe class: `gregtech.api.util.GTRecipe`. It has four chance arrays on the 1/10000 scale.
   - Not consumed = stack size 0.
   - Cleanroom and low gravity: recipe metadata, plus `mSpecialValue` sentinels −100 (low gravity), −200 (cleanroom) and −300 (both).
   - Coil heat and similar values are aliases of `mSpecialValue`.

   §2
4. **Machines:**
   - Registry: `GregTechAPI.METATILEENTITIES[id]` (an `IMetaTileEntity[32766]`).
   - Tier: `MTETieredMachineBlock.mTier`. Kind: `instanceof MTEBasicMachine` / `MTEMultiBlockBase`, plus `IConstructable` for the brick blast furnace.
   - Maps: `RecipeMapWorkable.getAvailableRecipeMaps()`. This reproduces the generic part of the catalyst list GT's own NEI plugin registers, not all of it: GT also hard-codes catalysts for three display maps, and NEI adds rows from its own `catalysts.csv` (§3.4; corrected by reviewer).
   - Cables and pipes: `MTECable`, `MTEFluidPipe`, `MTEItemPipe`. Some energy methods throw `NullPointerException` on prototypes, so compute them from `mTier`.

   §3
5. **Server-side English names work.** On a dedicated server, FML injects every mod's `assets/*/lang/en_US.lang` into the server translator. GregTech also pushes its runtime names into that translator by reflection. The live server's own `/give` log prints names such as `[Output Hatch (HV)]` and `[Dark Steel Dust]`. **Item variants cannot be listed with `getSubItems`**, which is `@SideOnly(CLIENT)`. Collect variants from recipes, the ore dictionary and GT's public meta-item bitsets instead. §4
6. **Run:**
   - Clone the needed files into a new folder (APFS `cp -c`, so no extra disk is used).
   - Change port, bind address, level name and world type. Add `-Dfml.queryResult=confirm` and `-Dgtnhplanner.exportDir=…`.
   - The mod exports 100 ticks after `FMLServerStartedEvent`, writes `EXPORT_OK` last, and calls `initiateShutdown()`. The JVM then exits with `System.exit(0)`.
   - The live server boots in ~20 s on this host. A fresh world adds spawn generation (**UNVERIFIED** duration).

   §5
7. **Output:** gzip'd JSON Lines, one file per kind. Items and fluids are referenced by index or name, and stacks are stored as `[item, amount, chance?]`.
   - Expect roughly 64 k crafting recipes (measured in the server log) and on the order of 10⁵ GT recipes (**UNVERIFIED**). That is an estimated 5–10 MB gzip'd.
   - Never key items by numeric ID. Use registry name + meta (+ NBT).

   §6

---

## 1. Build approach

### 1.1 Runtime naming (why the build approach matters)

At run time, Minecraft and Forge classes carry **MCP class names with SRG member names** (`net/minecraft/item/ItemStack.field_77994_a`). A mod must reference those exact names. The pack's own jars show it:

- **GregTech** (built by the same toolchain) references SRG members:
  ```
  $ J -cp $GT -p -c gregtech.api.recipe.RecipeMap | awk '/lambda\$getNonConsumedInputItemIds\$2/,/ireturn/'
     5: getfield      #401   // Field net/minecraft/item/ItemStack.field_77994_a:I
  ```
- **Forge universal and the vanilla server jar** are distributed in Notch names, which FML remaps when it loads them:
  ```
  $ J -cp $FORGE -p net.minecraftforge.oredict.ShapedOreRecipe | head -2
    public class net.minecraftforge.oredict.ShapedOreRecipe implements afg {
  $ J -cp $FORGE -p net.minecraftforge.oredict.OreDictionary | grep 'getOres(java.lang.String)'
    public static java.util.ArrayList<add> getOres(java.lang.String);
  $ unzip -l $PACK/minecraft_server.1.7.10.jar | awk '{print $4}' | grep -c '^[a-z]\{1,3\}\.class$'   → 1279
  $ unzip -l $PACK/minecraft_server.1.7.10.jar | awk '{print $4}' | grep -c 'net/minecraft/item/ItemStack'   → 0
  ```

*Verified by reviewer (2026-10-17).* The lines above reproduce. A wider scan (Python `zipfile`, run with `-I`) covered every `.jar`/`.zip` in `$PACK` outside `World/` and `backups/` (250 archives), plus the 562 jars of the 2.9 client instance and its launcher libraries. It found no `net/minecraft/item/ItemStack.class`. The only `net/minecraft/**` classes are launchwrapper's, one client GUI helper inside a mod, and the server jar's Main-Class. That class keeps its readable name, but its members are still obfuscated:

```
$ J -cp $PACK/minecraft_server.1.7.10.jar -p net.minecraft.server.MinecraftServer
  public abstract class net.minecraft.server.MinecraftServer implements ac,java.lang.Runnable,rk { … public void o(); public void r(); …
```

So the source must be written against readable names and then rewritten to SRG ("reobfuscated"). Alternatively, every vanilla call goes through reflection by SRG name.

### 1.2 Options compared

| | (a) GTNH template: RFG + GTNHGradle | (b) plain `javac` against local jars + reflection |
|---|---|---|
| Vanilla/Forge types at compile time | Real classes (RFG decompiles and remaps MC + Forge) | None exist with MCP names locally (§1.1): would need hand-written stub classes for every vanilla type touched, e.g. `ItemStack`, `IRecipe`, `ShapedRecipes` |
| GregTech types | `GT5-Unofficial:…:dev` jar from the GTNH maven, the same build as the pack | Pack jar works for GT types, but its signatures reference vanilla types that do not exist locally (above) |
| Runtime names | `reobfJar` rewrites MCP → SRG automatically (verified, §1.4) | Every vanilla field/method by SRG name via reflection, looked up by hand in MCP CSVs |
| Effort / risk | Standard for every GTNH mod; one-time ~2.3 GB Gradle cache | Fragile, hard to review, no compiler help |
| Verdict | **Chosen** | Rejected |

### 1.3 Why option (b) fails in practice

Take one expression, `recipe.mInputs[0].stackSize`. The field `mInputs` is typed `net.minecraft.item.ItemStack[]`:

```
$ J -cp $GT -p gregtech.api.util.GTRecipe | grep mInputs
  public net.minecraft.item.ItemStack[] mInputs;
```

`javac` needs `net/minecraft/item/ItemStack.class` to compile it, and no local jar provides that class (§1.1). Option (b) would need a stub `ItemStack` with a field named `field_77994_a`. It would need the same for `IRecipe`, `CraftingManager`, `StatCollector`, `FurnaceRecipes`, `NBTTagCompound` and every other vanilla type. Even GregTech method signatures drag those types in.

### 1.4 Chosen approach (a): exact files, versions, coordinates, command

**Template.** GTNewHorizons/ExampleMod1.7.10 at commit `6453dec5f5f5` (2026-09-29, "Update buildscript"):

```
$ curl -s https://api.github.com/repos/GTNewHorizons/ExampleMod1.7.10/commits/master \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["sha"], d["commit"]["committer"]["date"], d["commit"]["message"][:100])'
  6453dec5f5f534e604887d3505ddf7125889c6f9 2026-09-29T19:39:17Z Update buildscript
```

**Files** (new folder in our repo, e.g. `exporter-mod/`). Files described as "template" are copied unchanged from that commit; `gradle.properties` and `dependencies.gradle` are edited as shown:

| File | Content (verified values) |
|---|---|
| `settings.gradle.kts` | `pluginManagement` repos: GTNH Maven `https://nexus.gtnewhorizons.com/repository/public/` (groups `com.gtnewhorizons.*`), `gradlePluginPortal()`, `mavenCentral()`, `mavenLocal()`; `plugins { id("com.gtnewhorizons.gtnhsettingsconvention") version("2.0.33") }` |
| `build.gradle.kts` | `plugins { id("com.gtnewhorizons.gtnhconvention") }` (56 bytes, do not edit) |
| `gradle.properties` | template, changing only: `modName = GTNH Planner Exporter`, `modId = gtnhplannerexport`, `modGroup = <our package>`, `generateGradleTokenClass = <our package>.Tags`, `usesMavenPublishing = false`. Kept: `minecraftVersion = 1.7.10`, `forgeVersion = 10.13.4.1614`, `channel = stable`, `mappingsVersion = 12`, `enableModernJavaSyntax = jabel`, `gtnh.settings.blowdryerTag = 0.2.2` |
| `dependencies.gradle` | `dependencies { compileOnly("com.github.GTNewHorizons:GT5-Unofficial:5.09.54.183:dev") }` |
| `repositories.gradle` | empty block. The plugin adds the GTNH Maven itself: `repos.maven(mvn -> { mvn.setName("GTNH Maven"); mvn.setUrl("https://nexus.gtnewhorizons.com/repository/public/"); })` (GTNHGradle 2.0.33 `ToolchainModule.java`) |
| `gradle/wrapper/gradle-wrapper.properties` | `distributionUrl=https\://services.gradle.org/distributions/gradle-9.7.1-bin.zip` |
| `gradle/wrapper/gradle-wrapper.jar`, `gradlew`, `gradlew.bat` | from the template. The wrapper jar's SHA-256 `7a9ce74c…262c5d` equals `https://services.gradle.org/distributions/gradle-9.7.1-wrapper.jar.sha256` (checked) |
| `gradle/gradle-daemon-jvm.properties` | `toolchainVersion=25` (+ foojay download URLs). The daemon therefore runs on the local JDK 25 |
| `src/main/resources/mcmod.info` | template (`${modId}`, `${modName}`, `${modVersion}`, `${minecraftVersion}` are expanded) |
| `src/main/java/<pkg>/…` | our code (Appendix A) |

```
$ cat settings.gradle.kts | grep -A1 'plugins {'      →  id("com.gtnewhorizons.gtnhsettingsconvention") version("2.0.33")
$ grep distributionUrl gradle/wrapper/gradle-wrapper.properties  →  …/gradle-9.7.1-bin.zip
$ grep toolchainVersion gradle/gradle-daemon-jvm.properties      →  toolchainVersion=25
```

**Java versions.** The following come from GTNHGradle 2.0.33 `ToolchainModule.java` (https://github.com/GTNewHorizons/GTNHGradle/blob/2.0.33/src/main/java/com/gtnewhorizons/gtnhgradle/modules/ToolchainModule.java):

- `case FALSE -> 8; case JABEL -> 17; case JVM_DOWNGRADER, MODERN -> 25;`
- "For JABEL mode: set --release 8 to restrict to J8 APIs"

Keep `jabel`. The output is Java 8 bytecode (class version 52), which is what the pack's own base classes use. GregTech's classes are also version 52 (`JvmDowngrader-Downgrade-Target: 52` in its manifest). Its Java 17 classes live only under `META-INF/versions/17`.

```
$ unzip -p $GT META-INF/MANIFEST.MF | grep -E 'Multi-Release|JvmDowngrader-Downgrade-Target'   → JvmDowngrader-Downgrade-Target: 52 / Multi-Release: true
$ unzip -p $GT gregtech/api/recipe/RecipeMap.class | head -c 8 | xxd -p                           → cafebabe00000034
$ unzip -p build/libs/gtnhplannerexport-0.1.0.jar io/…/Exporter.class | head -c 8 | xxd -p      → cafebabe00000034
```

The `modern` mode would emit Java 25 bytecode (version 69). The pack ships ASM 9.4 (`$PACK/libraries/org/ow2/asm/asm/9.4/`), so FML's class scanning would likely reject it. That is reasoned, not tested, so keep Java 8 bytecode.

**The GT artifact exists on the GTNH maven and is byte-identical to the pack's jar.**

```
$ curl -s https://nexus.gtnewhorizons.com/repository/public/com/github/GTNewHorizons/GT5-Unofficial/maven-metadata.xml | grep -E '5.09.54.183|<latest>'
      <version>5.09.54.183</version>    <latest>5.09.54.234</latest>
$ B=https://nexus.gtnewhorizons.com/repository/public/com/github/GTNewHorizons/GT5-Unofficial/5.09.54.183
$ curl -s $B/GT5-Unofficial-5.09.54.183.jar.sha1        → 0189cf6620a37b6dab3aa15d46b35178e74058d9
$ shasum $PACK/mods/gregtech-5.09.54.183.jar           → 0189cf6620a37b6dab3aa15d46b35178e74058d9
$ for c in "" -dev -sources -api; do curl -s -o /dev/null -w "$c %{http_code}\n" -I $B/GT5-Unofficial-5.09.54.183$c.jar; done
  200 / -dev 200 / -sources 200 / -api 404
```

*Verified by reviewer (2026-10-17):* the maven plain jar was downloaded into an empty folder. `cmp` with the pack's jar prints nothing (both are 68,026,391 bytes). The maven `.sha256` (`70c76078…588a5bd0`) also equals `shasum -a 256` of the pack jar.

The Gradle module metadata (`GT5-Unofficial-5.09.54.183.module`) has these variants:

| Variant | Attribute `com.gtnewhorizons.retrofuturagradle.obfuscation` | File |
|---|---|---|
| `apiElements` | `mcp` | `-dev.jar` (67.6 MB), 27 transitive compile deps (StructureLib, IC2, NEI, GTNHLib, ModularUI, ModularUI2, AE2, …) |
| `reobfElements` | `srg` | the plain jar |

**Command** (from the exporter folder):

```
VERSION=0.1.0 ./gradlew assemble        # → build/libs/gtnhplannerexport-0.1.0.jar   (reobf, SRG: install this one)
                                        #   build/libs/gtnhplannerexport-0.1.0-dev.jar (MCP names, for dev only)
```

- `VERSION` (or a git tag) is required. GTNHGradle's `GitVersionModule` reads `System.getenv("VERSION")` and otherwise derives the version from the git tag ("…the VERSION override must be set!", falling back to `NO-GIT-TAG-SET`).
- `./gradlew build` also runs the `check` tasks. The template wires in Spotless and Checkstyle through Blowdryer: its `gradle.properties` offers `# disableSpotless = true` and `# disableCheckstyle = true`. Use `./gradlew spotlessApply build` for CI-style builds; `assemble` skips the checks. Only `assemble` was run here.

**What actually happened on this Mac** (GRADLE_USER_HOME pointed at a scratch folder):

```
$ VERSION=0.1.0 ./gradlew --max-workers=4 assemble
  Downloading https://services.gradle.org/distributions/gradle-9.7.1-bin.zip … Welcome to Gradle 9.7.1!
  Build script update from 2.0.33 to 2.0.34 available! …
  > Task :decompileSrgJar … > Task :compilePatchedMcJava … > Task :compileJava  Jabel: initialized
  > Task :reobfJar … BUILD SUCCESSFUL in 6s          (the first, cold run needed ~2 min of downloads + MC decompile
                                                    before reaching :compileJava: "BUILD FAILED in 2m 5s" on a typo, §1.5)
$ grep -o 'javaHome=[^,]*' $GRADLE_USER_HOME/daemon/9.7.1/daemon-*.out.log | head -1
  javaHome=/Library/Java/JavaVirtualMachines/jdk-25.jdk/Contents/Home
```

The toolchains Gradle provisioned on its own were listed with an init script that prints `JavaCompile.javaCompiler`:

| Task | Toolchain |
|---|---|
| `compileJava` (our code) | Eclipse Temurin **17 aarch64** |
| `compilePatchedMcJava`, `compileMcLauncherJava` | Eclipse Temurin **8 x86_64**. This runs under Rosetta 2, which is installed on this host (`pkgutil --pkgs` lists `com.apple.pkg.RosettaUpdateAuto`) |

```
  TOOLCHAIN compile compileJava -> 17 Eclipse Temurin $GRADLE_USER_HOME/jdks/eclipse_adoptium-17-aarch64-os_x.2/…
  TOOLCHAIN compile compilePatchedMcJava -> 8 Eclipse Temurin $GRADLE_USER_HOME/jdks/temurin-8-x86_64-os_x.2/jdk8u504-b01/…
```

*Verified by reviewer (2026-10-17).* The init script used for this check resolves only `JavaCompile` toolchains and never touches `JavaExec` launchers, so nothing large is downloaded. It printed:

```
PROBE daemon java.home=/Library/Java/JavaVirtualMachines/jdk-25.jdk/Contents/Home os.arch=aarch64
PROBE :compileJava -> lang=17 vendor=Eclipse Temurin …/eclipse_adoptium-17-aarch64-os_x.2/… release=8 source=17 target=1.8 procpath=[jabel-javac-plugin-1.0.2-GTNH.jar]
PROBE :compilePatchedMcJava -> lang=8 vendor=Eclipse Temurin …/temurin-8-x86_64-os_x.2/jdk8u504-b01/… release=null source=1.8 target=1.8
```

The plugin jar Gradle resolved (`caches/modules-2/…/gtnhgradle/2.0.33/…/gtnhgradle-2.0.33.jar`) has the same logic as the tag's source:

- `computeToolchainVersion` returns `bipush 17` on the JABEL branch.
- The `JavaCompile` lambda returns early for `compileMcLauncherJava`/`compilePatchedMcJava`. For other tasks it calls `setSourceCompatibility(String.valueOf(javaVersion))`, then `getRelease().set(Integer.valueOf(bipush 8))` when the mode is `JABEL`.

A Temurin 21 aarch64 was also provisioned during the first build. Which task used it is **UNVERIFIED** (not a `JavaCompile` task). After the first build, `GRADLE_USER_HOME` held about 2.3 GB.

**The reobfuscation works.** The same call sites appear in each jar's class files:

```
$ J -cp build/libs/gtnhplannerexport-0.1.0-dev.jar -c -p <pkg>.Exporter <pkg>.ExportTrigger | grep -oE 'Method net/minecraft/[A-Za-z/]+\.[A-Za-z0-9_]+' | sort -u
  …CraftingManager.getRecipeList  …ItemStack.getDisplayName  …MinecraftServer.initiateShutdown  …StatCollector.translateToLocal
$ J -cp build/libs/gtnhplannerexport-0.1.0.jar -c -p <pkg>.Exporter <pkg>.ExportTrigger | grep -oE '(Method|Field) net/minecraft/[A-Za-z/]+\.[A-Za-z0-9_]+' | sort -u
  Field …ItemStack.field_77994_a  Field …ShapedRecipes.field_77576_b  Method …CraftingManager.func_77592_b
  Method …ItemStack.func_82833_r  Method …MinecraftServer.func_71263_m  Method …StatCollector.func_74838_a  …
```

*Corrected by reviewer (2026-10-17):* the `MinecraftServer` calls are in `ExportTrigger`, not `Exporter`, so the commands now name both classes. With `Exporter` alone, no `MinecraftServer` line appears.

*Reproduced by reviewer:* the skeleton was rebuilt from a clean copy of its sources (no `build/` or `.gradle/`), using the same `GRADLE_USER_HOME`, with `VERSION=0.1.0 ./gradlew --offline --no-configuration-cache assemble`. Results:

- `BUILD SUCCESSFUL in 33s`.
- The new reobf jar has the same SHA-256 (`2497feb5…2ebb`) as the original build: the build is reproducible.
- All three classes start with `cafebabe00000034` in both jars.

Inherited vanilla methods called through Forge classes are renamed too (`FMLControlledNamespacedRegistry.getNameForObject` → `func_148750_c`).

### 1.5 Pitfalls found while building

- **MCP names in the dev environment are not always the newest MCP names.** `FurnaceRecipes.getSmeltingExperience` does not exist in the RFG dev jar, which still calls it `func_151398_b`, although `mcp_stable-12` names it. Check with `J -cp $MC -p net.minecraft.item.crafting.FurnaceRecipes` → `public float func_151398_b(net.minecraft.item.ItemStack);`. The build error was `cannot find symbol … method getSmeltingExperience(ItemStack)`.
- **Transitive compile dependencies differ slightly from the pack**, for example AE2 `rv3-beta-1070-GTNH` instead of the pack's 1073, and NEI `2.8.139` instead of `2.8.145` (`./gradlew dependencies --configuration compileClasspath`). This is harmless with `compileOnly`: the pack's jars are used at run time, and only GT's API is compiled against.
- **Do not resolve every `JavaExec` launcher in a probe script.** `runClient17`, `runClient21` and `runClient25` pull JetBrains Runtime builds of ~0.5 GB each.

---

## 2. GregTech recipe API (gregtech-5.09.54.183.jar)

### 2.1 Registry of all recipe maps

`gregtech.api.recipe.RecipeMap.ALL_RECIPE_MAPS` is a `public static final Map<String, RecipeMap<?>>`. Every map registers itself under its `unlocalizedName` in the constructor and refuses duplicates:

```
$ J -cp $GT -p gregtech.api.recipe.RecipeMap | grep -E 'ALL_RECIPE_MAPS|unlocalizedName|getAllRecipes|getAmperage|getFrontend|getBackend|getFromOldIdentifier'
  public static final java.util.Map<java.lang.String, gregtech.api.recipe.RecipeMap<?>> ALL_RECIPE_MAPS;
  public final java.lang.String unlocalizedName;
  public B getBackend();  public gregtech.api.recipe.RecipeMapFrontend getFrontend();
  public java.util.Collection<gregtech.api.util.GTRecipe> getAllRecipes();  public int getAmperage();
  public static gregtech.api.recipe.RecipeMap<?> getFromOldIdentifier(java.lang.String);
$ J -cp $GT -p -c gregtech.api.recipe.RecipeMap | awk '/RecipeMap\(java.lang.String, B, gregtech.api.recipe.RecipeMapFrontend\);/,/return/'
  46: getstatic ALL_RECIPE_MAPS … Map.containsKey … athrow (IllegalArgumentException) … 75: Map.put
```

*Verified by reviewer (2026-10-17):* `RecipeMap` is `public final` and this is its only constructor, so every map instance passes through it. `ALL_RECIPE_MAPS` is a plain `HashMap` (`<clinit>`: `new java/util/HashMap … putstatic ALL_RECIPE_MAPS`). A byte search of `mods/*.jar` found 17 classes that reference it. Only `RecipeMap`'s constructor writes to it; GTTweaker's `GTRecipeMap` copies `values()` into a map of its own.

Maps are created by `RecipeMapBuilder.…build()` in these holders: `gregtech.api.recipe.RecipeMaps` (about 140 maps: 140 `RecipeMapBuilder.of(…)` and 139 `build()` call sites, including the GT++ ones such as `gt.recipe.lftr` and `gt.recipe.multicentrifuge`), `bartworks.API.recipe.BartWorksRecipeMaps`, `goodgenerator.api.recipe.GoodGeneratorRecipeMaps`, `gtnhintergalactic.recipe.IGRecipeMaps`, `gtnhlanth.api.recipe.LanthanidesRecipeMaps`, `tectech.recipe.TecTechRecipeMaps`, `kubatech.loaders.DEFCRecipes` / `HTGRLoader`, and outside the GT jar `com.gtnewhorizon.cropsnh.recipes.CropsNHGTRecipeMaps` (cropsnh-2.0.129). Iterating `ALL_RECIPE_MAPS` at run time covers all of them.

```
$ for j in $PACK/mods/*.jar; do jargrep "$j" 'gregtech/api/recipe/RecipeMapBuilder'; done     (string search in class files)
  gregtech-5.09.54.183.jar!bartworks/API/recipe/BartWorksRecipeMaps.class … !tectech/recipe/TecTechRecipeMaps.class
  cropsnh-2.0.129.jar!com/gtnewhorizon/cropsnh/recipes/CropsNHGTRecipeMaps.class
$ J -cp $GT -c -constants gregtech.api.recipe.RecipeMaps | grep -c 'RecipeMapBuilder.of:'   → 140
```

### 2.2 Iterating recipes; categories; maps whose list is incomplete

- `map.getAllRecipes()` delegates to `getBackend().getAllRecipes()`. Per category: `getBackend().getRecipeCategoryMap()` (`Map<RecipeCategory, Collection<GTRecipe>>`).
- `recipe.getRecipeCategory().unlocalizedName` names sub-groups such as arc-furnace or macerator recycling. Predefined ones live in `gregtech.api.recipe.RecipeCategories`, with IDs `gt.recipe.category.arc_furnace_recycling`, `…macerator_recycling`, `…fluid_extractor_recycling`, `…alloy_smelter_recycling`, `…alloy_smelter_molding`, `…forge_hammer_recycling`, `…tic_part_extruding`, `…tic_bolt_molding` and `…abs_non_alloy_recipes` (`J -cp $GT -p -c -constants gregtech.api.recipe.RecipeCategories | grep 'String gt.recipe.category'`). A recipe in its map's default category has `category.unlocalizedName == map.unlocalizedName`. Planning should skip the recycling ones by default.
- **Code-generated maps.** Some backends build or change recipes at lookup time, so their `getAllRecipes()` can be incomplete or empty. Whether the lists are actually empty at run time is **UNVERIFIED**. There are three groups:

  | Kind written by the exporter | Test | Backends |
  |---|---|---|
  | `overwrite` | `RecipeMapBackend.doesOverwriteFindRecipe()` is true: `NonGTBackend` returns `iconst_1`, the base class `iconst_0` | `NonGTBackend` subclasses `FurnaceBackend`, `MicrowaveBackend`, `RecyclerBackend`, `EFRBlastingBackend`, `EFRSmokingBackend`; plus `ReplicatorBackend` and `ChiselBackend`, which override it |
  | `fallback` | the class declares `findFallback(…)`: a recipe is made when nothing static matches | `PrinterBackend`, `UnpackagerBackend`, `FluidCannerBackend`, `FormingPressBackend` |
  | `modify` | the class declares `modifyFoundRecipe(…)`: a found recipe is altered | `PrinterBackend`, `FormingPressBackend`, `AssemblerBackend` |

  The exporter writes this as `dynamic` per map, using reflection on GT's own method names, which are not obfuscated. The planner then synthesizes what it needs.
- Example: the GT electric furnace map takes any vanilla smelting result and builds a recipe at 128 ticks and 4 EU/t. The planner can derive those recipes from the furnace export.

```
$ J -cp $GT -p gregtech.api.recipe.RecipeMapBackend | grep -E 'getRecipeCategoryMap|doesOverwriteFindRecipe'
  public java.util.Map<gregtech.api.recipe.RecipeCategory, java.util.Collection<gregtech.api.util.GTRecipe>> getRecipeCategoryMap();
  public boolean doesOverwriteFindRecipe();
$ J -cp $GT -p -c gregtech.api.recipe.maps.NonGTBackend | awk '/doesOverwriteFindRecipe/,/ireturn/'   → 0: iconst_1  1: ireturn
$ for b in PrinterBackend ReplicatorBackend UnpackagerBackend ChiselBackend FluidCannerBackend FormingPressBackend AssemblerBackend; do
    J -cp $GT -p gregtech.api.recipe.maps.$b | grep -oE '(overwriteFindRecipe|findFallback|modifyFoundRecipe|doesOverwriteFindRecipe)\(' | sort -u; done
  Printer: findFallback modifyFoundRecipe | Replicator: doesOverwriteFindRecipe overwriteFindRecipe | Unpackager: findFallback
  Chisel: doesOverwriteFindRecipe overwriteFindRecipe | FluidCanner: findFallback | FormingPress: findFallback modifyFoundRecipe | Assembler: modifyFoundRecipe
(superclasses from the class-header index: Furnace/Microwave/Recycler/EFRBlasting/EFRSmoking → NonGTBackend; the others → RecipeMapBackend)
$ J -cp $GT -p -c -constants gregtech.api.recipe.maps.FurnaceBackend | awk '/overwriteFindRecipe/,/^$/' | grep -E 'getSmeltingOutput|sipush|iconst_4|duration|eut'
  GTModHandler.getSmeltingOutput … sipush 128 … GTRecipeBuilder.duration … iconst_4 … GTRecipeBuilder.eut
$ J -cp $GT -p gregtech.api.recipe.RecipeCategory | grep 'public final'
  public final java.lang.String unlocalizedName;  public final gregtech.api.recipe.RecipeMap<?> recipeMap;  public final cpw.mods.fml.common.ModContainer ownerMod; …
```

### 2.3 The recipe class: `gregtech.api.util.GTRecipe`

```
$ J -cp $GT -p gregtech.api.util.GTRecipe | grep -E '^  public [^(]*;$'
  public net.minecraft.item.ItemStack[] mInputs;   public net.minecraft.item.ItemStack[] mOutputs;
  public net.minecraftforge.fluids.FluidStack[] mFluidInputs;   public net.minecraftforge.fluids.FluidStack[] mFluidOutputs;
  public net.minecraftforge.fluids.FluidStack[][] mAltFluidInputs;
  public int[] mInputChances;  public int[] mOutputChances;  public int[] mFluidInputChances;  public int[] mFluidOutputChances;
  public java.lang.Object mSpecialItems;  public int mDuration;  public int mEUt;  public int mSpecialValue;
  public boolean mEnabled;  public boolean mHidden;  public boolean mFakeRecipe;  public boolean mCanBeBuffered;
  public boolean mNeedsEmptyOutput;  public boolean isNBTSensitive;
  public java.util.List<cpw.mods.fml.common.ModContainer> owners;  …
$ J -cp $GT -p gregtech.api.util.GTRecipe | grep -E 'getMetadata|getRecipeCategory|getNeiDesc'
  public <T> T getMetadata(gregtech.api.recipe.RecipeMetadataKey<T>);  public <T> T getMetadataOrDefault(…);
  public gregtech.api.recipe.metadata.IRecipeMetadataStorage getMetadataStorage();  public gregtech.api.recipe.RecipeCategory getRecipeCategory();
```

| Field | Meaning for the planner |
|---|---|
| `mInputs` / `mOutputs` | Item slots. A slot can be `null`. A stack size of 0 means not consumed (§2.4) |
| `mFluidInputs` / `mFluidOutputs` | Fluid slots. Amounts are in L (`FluidStack.amount`) |
| `mAltFluidInputs` | Per fluid-input slot, alternatives that are also accepted. When `mAltFluidInputs[i]` is non-null, `consumeInput` matches slot *i* against that whole array; otherwise it uses `{mFluidInputs[i]}` (bytecode: `getfield mAltFluidInputs … ifnull 59 … aaload … goto 87 / 59: … getfield mFluidInputs … anewarray FluidStack`) |
| `mInputChances`, `mFluidInputChances` | Chance that an input is consumed, on a 1/10000 scale. The input must still be present (§2.5) |
| `mOutputChances`, `mFluidOutputChances` | Chance that an output is produced, on a 1/10000 scale |
| `mDuration`, `mEUt` | Ticks and EU/t. Both are `int` (`mEUt` is not `long` in this build) |
| `mSpecialValue` | Means something different per map (§2.6, prior-art T3) |
| `mEnabled`, `mFakeRecipe` | The standard recipe lookup only matches `mEnabled && !mFakeRecipe` (evidence below). **Corrected by reviewer:** this does not hold for every machine, and "fake" does not mean "impossible" (see the note after the evidence). Planner: drop disabled recipes. Keep fake recipes, marked display-only: many describe a real process that a machine runs through its own code |
| `mHidden` | Hidden from NEI only. It does not affect lookup |
| `mNeedsEmptyOutput`, `mCanBeBuffered`, `isNBTSensitive` | Raw flags. If `isNBTSensitive`, keep the NBT of the inputs |
| `mSpecialItems` | Special-slot item. It is compared only in maps with `specialSlotSensitive` (evidence below) |
| `owners` | The mods that added the recipe. Only filled when `GTProxy.mNEIRecipeOwner` is true; config `NEIRecipeOwner=false` in `config/GregTech/Client.cfg` of this pack (`shouldCaptureRecipeOwnerInfo` reads `GTProxy.mNEIRecipeOwner`). Whether the dedicated server reads that client config file is **UNVERIFIED** |
| `GTRecipe.GTRecipe_WithAlt.mOreDictAlt` | `ItemStack[][]`: per input slot, accepted alternatives (assembler, assembly line display) |

```
$ J -cp $GT -p -c gregtech.api.recipe.RecipeMapBackend | awk '/protected boolean filterFindRecipe/,/^$/' | grep -E 'getfield|ifeq|ifne' | head -5
   1: getfield GTRecipe.mEnabled:Z   4: ifeq 57   8: getfield GTRecipe.mFakeRecipe:Z   11: ifne 57 … 30: getfield RecipeMapBackendProperties.specialSlotSensitive:Z
$ J -cp $GT -p 'gregtech.api.util.GTRecipe$GTRecipe_WithAlt' | grep 'public'
  public net.minecraft.item.ItemStack[][] mOreDictAlt;  public int[] mOreDictIds;
```

**Fake and disabled recipes (corrected by reviewer, 2026-10-17).** The original wording said fake and disabled recipes never run in a machine. The bytecode supports that only for the standard lookup:

- **The standard lookup filters both flags.** `RecipeMapBackend.matchRecipeStream` merges three candidate sources: the last recipe (if `mCanBeBuffered`), a hash cache and the item index. It then calls `.distinct().filter(filterFindRecipe)` (bootstrap `lambda$matchRecipeStream$3`), then `modifyFoundRecipe`. Recipes from `overwriteFindRecipe` (when `doesOverwriteFindRecipe()`) and from `findFallback` are new objects built at lookup time.
- **Some machines skip that lookup.** They iterate `map.getAllRecipes()` themselves and check neither flag. A disabled recipe in these maps would still run:
  - `MTELargeBoiler` (`dieselFuels`, `denseLiquidFuels`);
  - `MTEAlgaePond` and GT++ `MTEAlgaePondBaseLegacy` (`algaePondRecipes`, matched on `mSpecialValue`);
  - KekzTech `MTESOFuelCellMK1`/`MK2` (`gasTurbineFuels`);
  - `MTEUniversalChemicalFuelEngine` and GoodGenerator's `…Legacy` copy;
  - GT++ `MTELargeRocketEngine`;
  - `MTEThermalBoiler`'s processing logic.

  `MTETreeFarm` also reads its fake map, but only to count the entries it added for NEI.
- **Many fake recipes describe a real process.** They are the NEI view of something a machine does through its own code. Example: `MTERockBreaker.checkRecipe` tests the neighbouring blocks and reads its own static `ROCK_BREAKER_RECIPES`. Meanwhile, `MTERockBreaker$RockBreakerRecipe$Builder` adds `.fake()` copies to `rockBreakerFakeRecipes` for NEI.
- **Where `GTRecipeBuilder.fake()` is used** (among others): `rockBreakerFakeRecipes`, `scannerFakeRecipes`, `massFabFakeRecipes`, `replicatorRecipes`, `cannerRecipes`, `cauldronRecipe`, `largeBoilerFakeFuels`, `cutterFakeRecipes`, `assemblylineVisualRecipes`, TecTech `researchStationFakeRecipes`, `foundryFakeModuleCostRecipes`, and the Godforge maps.

```
$ J -cp $GT -p -c -v gregtech.api.recipe.RecipeMapBackend | awk '/BootstrapMethods:/,0' | grep 'lambda\$matchRecipeStream\$3'
  REF_invokeVirtual gregtech/api/recipe/RecipeMapBackend.lambda$matchRecipeStream$3:(…ZLgregtech/api/util/GTRecipe;)Z    (its body: invokevirtual filterFindRecipe)
$ J -cp $GT -p -c gregtech.api.recipe.RecipeMapBackend | awk '/ matchRecipeStream\(/,/^$/' | grep -E 'distinct|InvokeDynamic #9|Stream.map'
  281: Stream.distinct  293: InvokeDynamic #9:test (bootstrap → lambda$3, then 298: Stream.filter)  313: Stream.map (→ lambda$4 = modifyFoundRecipe)
$ J -cp $GT -c -p gregtech.common.tileentities.machines.multi.MTELargeBoiler | grep -B3 'RecipeMap.getAllRecipes' | grep getstatic
  74: getstatic RecipeMaps.dieselFuels  …  215: getstatic RecipeMaps.denseLiquidFuels
$ for c in <each machine class above>; do J -cp $GT -c -p $c | grep -cE 'GTRecipe\.(mEnabled|mFakeRecipe)'; done   → 0 for every class
$ J -cp $GT -c -p gregtech.common.tileentities.machines.basic.MTERockBreaker | awk '/public int checkRecipe\(\);/,/^$/' | grep ROCK_BREAKER
  105: getstatic ROCK_BREAKER_RECIPES:Lit/unimi/dsi/fastutil/ints/Int2ObjectMap;
$ J -cp $GT -c -p 'gregtech.common.tileentities.machines.basic.MTERockBreaker$RockBreakerRecipe$Builder' | grep -E 'fake|rockBreakerFakeRecipes|addTo'
  41: invokevirtual GTRecipeBuilder.fake  …  160: getstatic RecipeMaps.rockBreakerFakeRecipes  163: invokevirtual GTRecipeBuilder.addTo
```

### 2.4 Inputs that are not consumed

Programmed circuits, molds, lenses, shapes and catalysts appear as inputs with **stack size 0**. GT's own non-consumed list filters on exactly that:

```
$ J -cp $GT -p -c gregtech.api.recipe.RecipeMap | awk '/lambda\$getNonConsumedInputItemIds\$2/,/ireturn/'
   0: aload_0  1: ifnull 15  4: aload_0  5: getfield ItemStack.field_77994_a:I  8: ifne 15  11: iconst_1 …   (stackSize == 0 → non-consumed)
$ J -cp $GT -p -c gregtech.api.util.GTUtility | awk '/getIntegratedCircuit\(int\);/,/areturn/'
   0: getstatic ItemList.Circuit_Integrated … 6: iconst_0 … 10: ItemList.getWithDamage:(JJ[Ljava/lang/Object;)   (amount 0)
```

*Verified by reviewer (2026-10-17), consumption path:* `GTRecipe.consumeInput` takes each merged input's `RecipeItemInput.inputAmount` and multiplies it by the multiplier argument. `RecipeItemInput(ItemStack, boolean)` sets `inputAmount` from the stack's `field_77994_a`. The loop stops removing items once the remainder is ≤ 0, so a 0-size input removes nothing:

```
$ J -cp $GT -p -c gregtech.api.util.GTRecipe | awk '/public void consumeInput\(int, /,/^$/' | grep -E ' (589|594|610|611):'
  589: getfield RecipeItemInput.inputAmount:J  594: lmul  610: lcmp  611: ifle 705
```

There is no separate "NC" flag. NEI's "Does not get consumed in the process" text (`Interaction_DESCRIPTION_Index_151` in `GregTech.lang`) is driven by the same amount 0. An input chance of 0 behaves the same way (prior-art T7). The programmed circuit's English name is `gt.integrated_circuit.name=Programmed Circuit` (GT `en_US.lang`).

### 2.5 Chances: 10000 = 100 %

```
$ J -cp $GT -p -c gregtech.api.util.GTRecipe | awk '/public int getOutputChance\(int\);/,/ireturn/'
   1: getfield mOutputChances  4: ifnonnull 11  7: sipush 10000  10: ireturn … 33: iaload  34: ireturn     (null array or index out of range → 10000)
$ … awk '/public net.minecraft.item.ItemStack rollOutput\(gregtech.api.interfaces.tileentity.IGregTechTileEntity, int\);/,/areturn/'
   8: sipush 10000  11: IGregTechTileEntity.getRandomNumber:(I)I  17: rollOutput:(II)  …  rollOutput(int,int): if (roll < getOutputChance(i)) return output
$ … consumeInput: getfield mInputChances … chanceWeightedAmount / inputAmount * 10000.0 … ParallelHelper.calculateIntegralChancedOutputMultiplier
```

- Item output chances, fluid output chances, item input (consumption) chances and fluid input chances all use 10000 = 100 %.
- A `null` array means everything is 100 %.
- The expected amount is `amount × chance / 10000`.

### 2.6 Special value and metadata (coil heat, cleanroom, low gravity, …)

**Metadata storage.** Iterate `recipe.getMetadataStorage().getEntries()` (`Set<Map.Entry<RecipeMetadataKey<?>, Object>>`). The key's name is the private field `RecipeMetadataKey.identifier`. It is GT's own field (not obfuscated), so plain reflection on `"identifier"` works.

```
$ J -cp $GT -p gregtech.api.recipe.metadata.IRecipeMetadataStorage | grep getEntries
  public abstract java.util.Set<java.util.Map$Entry<gregtech.api.recipe.RecipeMetadataKey<?>, java.lang.Object>> getEntries();
$ J -cp $GT -p gregtech.api.recipe.RecipeMetadataKey | grep identifier      → private final java.lang.String identifier;
```

**Keys** (field → identifier, from `GTRecipeConstants.<clinit>`):

| Field | Identifier | Type |
|---|---|---|
| `LOW_GRAVITY` | `low_gravity` | Boolean |
| `CLEANROOM` | `cleanroom` | Boolean |
| `COIL_HEAT` | `coil_heat` | Integer |
| `FUSION_THRESHOLD` | `fusion_threshold` | Long |
| `FUEL_VALUE` / `FUEL_TYPE` | `fuel_value` / `fuel_type` | Integer |
| `ADDITIVE_AMOUNT` | `additives` | Integer |
| `RESEARCH_ITEM` / `SCANNING` | `research_item` / `scanning` | ItemStack / Scanning |
| `RECYCLE` | `recycle` | Boolean |
| `EXPLODE` / `ON_FIRE` | `explode` / `on_fire` | Boolean |
| `COMPRESSION_TIER` | `compression_tier` | Integer |
| `NANO_FORGE_TIER`, `PCB_NANITE_MATERIAL`, `FOG_*`, `DEFC_CASING_TIER`, `CHEMPLANT_CASING_TIER`, `ALGAE_POND_TIER`, `QFT_FOCUS_TIER`, `QFT_CATALYST`, `DISSOLUTION_TANK_RATIO`, `RTG_DURATION_IN_DAYS`, `LNG_BASIC_OUTPUT`, `NFR_COIL_TIER`, `NKE_RANGE`, `PRECISE_ASSEMBLER_CASING_TIER`, `COAL_CASING_TIER`, `LFTR_OUTPUT_POWER`, `SPARGE_MAX_BYPRODUCT`, `RESEARCH_STATION_DATA`, `SIEVERT`, `GLASS`, `MASS`, `NO_GAS`, `EU_MULTIPLIER`, `HALF_LIFE`, `DECAY_TYPE`, `NANITE_TIERS`, `CONDENSATE_INPUT`, `FOUNDRY_MODULE`, `CIRCUIT_CALIBRATION_TYPE`, … | lower-case (`SIEVERT`, `GLASS` upper-case) | various |

`COMPRESSION_TIER` is not created inline. It is the singleton `gregtech.api.recipe.metadata.CompressionTierKey.INSTANCE`, whose constructor passes `Integer` and `"compression_tier"`. The other keys are `SimpleRecipeMetadataKey.create(Class, String)` calls in `GTRecipeConstants.<clinit>`; some, like `PCBFactoryTierKey`, are their own classes in `gregtech.api.recipe.metadata`. Generic code should therefore iterate the entries rather than hard-code the list.

```
$ J -cp $GT -p -c -constants gregtech.api.recipe.metadata.CompressionTierKey | grep -E 'ldc'   → ldc class java/lang/Integer  ldc String compression_tier
```

```
$ J -cp $GT -p -c -constants gregtech.api.util.GTRecipeConstants | awk '/static \{\};/,0' | grep -E 'ldc|putstatic' | head
   ldc class java/lang/Boolean  ldc String low_gravity   putstatic LOW_GRAVITY
   ldc class java/lang/Boolean  ldc String cleanroom     putstatic CLEANROOM
   ldc class java/lang/Integer  ldc String additives     putstatic ADDITIVE_AMOUNT …  ldc String coil_heat  putstatic COIL_HEAT …
```

**Special-value aliases.** `GTRecipeMapUtil.SPECIAL_VALUE_ALIASES` is a `HashSet` filled by 17 `Set.add` calls in `GTRecipeConstants.<clinit>`. Sixteen of its keys are `Integer`-typed:

- `COIL_HEAT`, `FUEL_VALUE`, `NANO_FORGE_TIER`;
- `FOG_EXOTIC_TIER`, `FOG_PLASMA_TIER`;
- `DEFC_CASING_TIER`, `CHEMPLANT_CASING_TIER`, `ALGAE_POND_TIER`, `QFT_FOCUS_TIER`;
- `DISSOLUTION_TANK_RATIO`, `RTG_DURATION_IN_DAYS`, `LNG_BASIC_OUTPUT`, `NFR_COIL_TIER`;
- `NKE_RANGE`, `PRECISE_ASSEMBLER_CASING_TIER`, `COAL_CASING_TIER`.

The seventeenth, `RESEARCH_STATION_DATA`, is `Long`-typed.

*Corrected by reviewer (2026-10-17):* this list previously named only the first 13 keys.

When a recipe is built, `GTRecipeBuilder.applyDefaultSpecialValues` does the following, but only if `mSpecialValue == 0`:

1. start from 0;
2. if `LOW_GRAVITY`, add −100;
3. if `CLEANROOM`, add −200;
4. then overwrite with the value of the first alias key in `HashSet` iteration order (unspecified) whose value is a `Byte`, `Short`, `Integer` or `Long`, and stop there. A `Long` is clamped with `GTUtility.safeInt`. Any other value type is skipped;
5. store the result in `mSpecialValue`.

The metadata itself is kept: `build()` passes the builder's `IRecipeMetadataStorage` to the `GTRecipe` constructor. Machines read the sentinels: `MTEBasicMachine.checkRecipe` compares `mSpecialValue` with −100/−300 for low gravity and −200/−300 for cleanroom. The low-gravity comparison only runs when the config flag `GTMod.proxy.mLowGravProcessing` is set (`getfield GTProxy.mLowGravProcessing:Z; ifeq` just before it). The sentinel is not reliable: any alias value overwrites it, and none is written when a recipe sets its special value explicitly. That is why the rule below reads cleanroom and low gravity from the metadata.

```
$ J -cp $GT -p -c gregtech.api.util.GTRecipeConstants | grep -A2 'getstatic.*SPECIAL_VALUE_ALIASES' | grep -oE 'Field [A-Z_]+:Lgregtech/api/recipe/RecipeMetadataKey' | sed 's/Field //; s/:L.*//' | tr '\n' ' '
  COIL_HEAT FUEL_VALUE NANO_FORGE_TIER … NFR_COIL_TIER NKE_RANGE PRECISE_ASSEMBLER_CASING_TIER COAL_CASING_TIER RESEARCH_STATION_DATA     (17)
$ J -cp $GT -p -c -constants gregtech.api.util.GTRecipeConstants | awk '/static \{\};/,0' | grep -B3 'putstatic.*RESEARCH_STATION_DATA:' | grep ldc
  415: ldc_w class java/lang/Long  418: ldc_w String research_station_data
$ J -cp $GT -p -c gregtech.api.util.GTRecipeBuilder | awk '/private void applyDefaultSpecialValues/,/^$/' | grep -E 'instanceof|safeInt'
  102: instanceof Byte  126: instanceof Short  150: instanceof Integer  174: instanceof Long  192: GTUtility.safeInt:(J)I
``` The electric blast furnace (EBF) reads `mSpecialValue` as the recipe heat. A non-zero `COMPRESSION_TIER` blocks singleblock machines.

```
$ J -cp $GT -p -c gregtech.api.util.GTRecipeBuilder | awk '/private void applyDefaultSpecialValues/,/return$/' | grep -E 'iinc|SPECIAL_VALUE_ALIASES|putfield'
   30: iinc 2, -100   53: iinc_w 2, -200   59: getstatic GTRecipeMapUtil.SPECIAL_VALUE_ALIASES   204: putfield GTRecipe.mSpecialValue
$ J -cp $GT -p -c gregtech.api.metatileentity.implementations.MTEBasicMachine | awk '/public int checkRecipe\(boolean\);/,/^$/' | grep -E 'EXPLODE|ON_FIRE|COMPRESSION_TIER|bipush +-100|sipush +-[23]00'
   72: getstatic EXPLODE … 122: getstatic ON_FIRE … 160: getstatic COMPRESSION_TIER … 194: bipush -100 … 203: sipush -300 … 280: sipush -200
$ J -cp $GT -p -c 'gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace$1' | grep mSpecialValue
   6: getfield GTRecipe.mSpecialValue:I  9: OverclockCalculator.setRecipeHeat:(I) …
```

**Rule for the exporter:** write `mSpecialValue` raw, plus every metadata entry. Read cleanroom and low gravity from metadata, never from the special value (prior-art T2).

### 2.7 Map names, amperage, special-value meaning

- **Unlocalized name:** `map.unlocalizedName` (e.g. `gt.recipe.blastfurnace`).
- **English name:** `StatCollector.translateToLocal(map.unlocalizedName)`. The keys are in GT's `en_US.lang`, which the server loads (§4.6).
  ```
  $ unzip -p $GT assets/gregtech/lang/en_US.lang | grep -E '^gt\.recipe\.(orewasher|blastfurnace|lftr|multicentrifuge)='
    gt.recipe.orewasher=Ore Washer  gt.recipe.blastfurnace=Blast Furnace  gt.recipe.lftr=Liquid Fluoride Thorium Reactor  gt.recipe.multicentrifuge=Multiblock Centrifuge
  ```
- **Amperage:** `map.getAmperage()` returns `getFrontend().getUIProperties().amperage`. The builder default is 1. In `RecipeMaps`, only `gt.recipe.thermalcentrifuge` (2) and `gt.recipe.massfab` (8) set it.
  ```
  $ J -cp $GT -p -c gregtech.api.recipe.BasicUIPropertiesBuilder | awk '/BasicUIPropertiesBuilder\(\);/,/^$/' | grep -B1 amperage   → 173: iconst_1  174: putfield amperage
  $ grep -B2 'RecipeMapBuilder.amperage' RecipeMaps.c.txt   → iconst_2 … amperage (thermalcentrifuge)  /  bipush 8 … amperage (massfab)
  ```
- **I/O limits:** `ui.maxItemInputs`, `maxItemOutputs`, `maxFluidInputs`, `maxFluidOutputs` (`BasicUIProperties`, public final ints).
- **What the special value means** comes from `map.getFrontend().getNEIProperties().neiSpecialInfoFormatter`. Export its class name. The formatters set in `RecipeMaps`:

| Formatter (in `gregtech.nei.formatter`) | Maps (`RecipeMaps`) | Meaning of `mSpecialValue` (lang key) |
|---|---|---|
| `HeatingCoilSpecialValueFormatter` | blastfurnace, plasmaforge, vacfurnace | heat in K, `GT5U.nei.heat_capacity=Heat: %s K` |
| `FusionSpecialValueFormatter` | fusionreactor | start EU, `GT5U.nei.start_eu=Start: %s EU (Mk-%s)`. The Mk tier is computed from start-EU thresholds 160 M / 320 M / 640 M / 5,120 M (Mk1–Mk4, above that Mk5). The start EU itself is in the `fusion_threshold` metadata (Long) |
| `FuelSpecialValueFormatter` | diesel, extreme diesel, gas turbine, thermal, plasma, magic, semifluid, 5 naquadah fuel maps | `GT5U.nei.fuel=Fuel Density: %s EU/%s` (EU per fluid unit) |
| `SimpleSpecialValueFormatter("GT5U.nei.tier")` | nanoforge, quantumforcesmelter | tier |
| `SimpleSpecialValueFormatter("GT5U.nei.stages")` | fakespaceprojects | stages |
| `SimpleSpecialValueFormatter(…)` | RTGgenerators, algae_pond | map-specific |
| `DefaultSpecialValueFormatter` / none | everything else | usually unused or a sentinel |

```
$ J -cp $GT -p gregtech.api.recipe.NEIRecipeProperties | grep neiSpecialInfoFormatter
  public final gregtech.nei.formatter.INEISpecialInfoFormatter neiSpecialInfoFormatter;
$ J -cp $GT -p -c -constants gregtech.nei.formatter.FuelSpecialValueFormatter | grep -E 'ldc|mSpecialValue'   → ldc String GT5U.nei.fuel … getfield GTRecipe.mSpecialValue
```

The formatters' `format(RecipeDisplayInfo)` is NEI display code. Do not call it on the server. Export the class name and the `SimpleSpecialValueFormatter.translationKey` instead (a private field, read by reflection).

### 2.8 Assembly line

`GTRecipe.RecipeAssemblyLine.sAssemblylineRecipes` (`public static final ArrayList`) holds the data-stick recipes. Each has these fields:

- `mResearchItem`, `mResearchTime`, `mResearchVoltage`
- `mInputs`, `mOreDictAlt` (`ItemStack[][]`), `mFluidInputs`, `mOutput`
- `mDuration`, `mEUt`

The map `gt.recipe.fakeAssemblylineProcess` is the NEI view of the same recipes. Export both, and mark the map as a view.

```
$ J -cp $GT -p 'gregtech.api.util.GTRecipe$RecipeAssemblyLine' | grep -E 'public (static final|net|int)'
  public static final java.util.ArrayList<…RecipeAssemblyLine> sAssemblylineRecipes;  public net.minecraft.item.ItemStack mResearchItem;
  public int mResearchTime;  public int mResearchVoltage;  public net.minecraft.item.ItemStack[] mInputs; … public net.minecraft.item.ItemStack[][] mOreDictAlt;
```

---

## 3. Machines, cables, pipes, generators

### 3.1 Registry and ID

```
$ J -cp $GT -p -constants gregtech.api.GregTechAPI | grep -E 'MAXIMUM_METATILE_IDS|METATILEENTITIES'
  public static final short MAXIMUM_METATILE_IDS = 32766;
  public static final gregtech.api.interfaces.metatileentity.IMetaTileEntity[] METATILEENTITIES;
$ J -cp $GT -p -c -constants gregtech.api.GregTechAPI | awk '/static \{\};/,0' | grep -B2 'putstatic.*METATILEENTITIES'
  64: sipush 32766  67: anewarray IMetaTileEntity  70: putstatic METATILEENTITIES
$ J -cp $GT -p -c gregtech.api.metatileentity.CommonMetaTileEntity | awk '/CommonMetaTileEntity\(int, java.lang.String, int\);/,/^$/' | grep -E 'METATILEENTITIES|aastore|mName'
  36: getstatic METATILEENTITIES … 49: aastore … 112: putfield mName      (the constructor stores itself at [aID]; mName = basic name, spaces → "_", lower case)
```

- **The array index is the machine ID.** It is the `mID` stored in the world's `BaseMetaTileEntity` NBT (world-format §6.3), the meta of the item `gregtech:gt.blockmachines`, and the value in the `gregtech.api.enums.MetaTileEntityIDs` enum (2,033 constants in this build). The ID does not depend on the world. The join from world to export is by this number.
- **Prototypes:** each array slot holds a prototype instance with no tile entity attached (`getBaseMetaTileEntity()` is `null`). Read fields; avoid methods that touch the base tile entity (§3.5).

  *Verified by reviewer (2026-10-17):*
  - A world tile entity never uses the prototype itself. `CommonBaseMetaTileEntity.createNewMetatileEntity(short)` runs `METATILEENTITIES[id].newMetaEntity(this).setBaseMetaTileEntity(this)`, then `mID = id`. IDs ≤ 0 or empty slots are logged as "not loadable".
  - `MetaTileEntity.getBaseMetaTileEntity()` is `public final` (`getfield mBaseMetaTileEntity; areturn`), and the registering constructor `MetaTileEntity(int, String, String, int)` never writes that field. It therefore stays `null` on prototypes.
  - `CommonMetaTileEntity(int, String, int)` throws `IllegalArgumentException` when the slot is already taken (`41: ifnonnull 53` … `athrow`).

  ```
  $ J -cp $GT -p -c gregtech.api.metatileentity.CommonBaseMetaTileEntity | awk '/protected boolean createNewMetatileEntity\(short\);/,/^$/' | grep -E 'newMetaEntity|setBaseMetaTileEntity|putfield'
    56: setBaseMetaTileEntity (old MTE, null)  67: IMetaTileEntity.newMetaEntity  73: IMetaTileEntity.setBaseMetaTileEntity  80: putfield mTickTimer  85: putfield mID
  ```
- **Enumeration:** `for (int id = 0; id < METATILEENTITIES.length; id++) if (METATILEENTITIES[id] != null) …`

### 3.2 Names, tier, voltage

| What | API | Evidence |
|---|---|---|
| Internal name | `IMetaTileEntity.getMetaName()` (= `mName`) | `CommonMetaTileEntity.mName` public final String |
| English name | `IMetaTileEntity.getLocalName()` = `StatCollector.translateToLocal(getLocalNameKey())`, key `gt.blockmachines.<mName>.name` | `J -cp $GT -p -c -constants …IMetaTileEntity` → `getLocalNameKey … StatCollector.func_74838_a`; `MetaTileEntity` → `ldc "gt.blockmachines." … ".name"`. Lang: `gt.blockmachines.multimachine.blastfurnace.name=Electric Blast Furnace` |
| Item form | `getStackForm(1)` (block `GregTechAPI.sBlockMachines`, meta = ID) | `public net.minecraft.item.ItemStack getStackForm(long);` |
| Tier | `((MTETieredMachineBlock) m).mTier` (byte). Basic machines, boilers, generators and tanks extend it via `MTEBasicTank`; battery buffers and transformers extend it directly. Multiblocks have no tier (their voltage comes from hatches) | `public final byte mTier;`; superclass chains: `MTEBasicTank → MTETieredMachineBlock → MetaTileEntity`, `MTEBasicBatteryBuffer`/`MTETransformer extends MTETieredMachineBlock` |
| Voltage | `GTValues.V[tier]` = 8, 32, 128, 512, 2048, 8192, 32768, 131072, 524288, 2097152, 8388608, 33554432, 134217728, 536870912, 2147483640, 8589934592. Tier names `GTValues.VN` = ULV, LV, MV, HV, EV, IV, LuV, ZPM, UV, UHV, UEV, UIV, UMV, UXV, MAX, MAX+ | `GTValues.<clinit>` constants |
| Singleblock amperage | `MTEBasicMachine.mAmperage` (public int) | `public int mAmperage;` |

### 3.3 Kind: singleblock or multiblock

| Kind | Test | Class count (GT jar unless noted) |
|---|---|---|
| Multiblock controller | `instanceof MTEMultiBlockBase`, **or** `instanceof com.gtnewhorizon.structurelib.alignment.constructable.IConstructable`. The second case catches `MTEBrickedBlastFurnace`, which extends `MetaTileEntity` directly | 337 (+ hydroenergy 32, cropsnh 1, matter-manipulator 1, vendingmachine 1) |
| Hatch / bus | `instanceof MTEHatch` | 116 |
| Singleblock processing machine | `instanceof MTEBasicMachine` (most are instances of one class, `MTEBasicMachineWithRecipe`) | 33 classes |
| Generator | `instanceof MTEBasicGenerator` | 13 |
| Boiler | `instanceof gregtech.common.tileentities.boilers.MTEBoiler` | — |
| Pipe / cable | `instanceof MetaPipeEntity` (+ subtypes, §3.6) | 17 |

Counts come from parsing the class headers of every mod jar (superclass chains). `MTEBrickedBlastFurnace`'s declaration: `extends gregtech.api.metatileentity.MetaTileEntity implements com.gtnewhorizon.structurelib.alignment.IAlignment, …ISurvivalConstructable, gregtech.api.interfaces.tileentity.RecipeMapWorkable, …`.

### 3.4 Which machines run which map

`gregtech.api.interfaces.tileentity.RecipeMapWorkable` declares `getRecipeMap()` and `default Collection<RecipeMap<?>> getAvailableRecipeMaps()`. The default is a singleton of `getRecipeMap()`, or empty. Multi-mode machines override it (23 classes mention it). Every relevant class implements the interface:

- `MTEBasicMachine` implements it directly.
- `MTEMultiBlockBase` gets it through `IControllerWithOptionalFeatures` → `IRecipeLockable` → `RecipeMapWorkable`.
- `MTEBasicGenerator` and `MTEBrickedBlastFurnace` implement it too.

428 of the 620 MTE subclasses are `RecipeMapWorkable`.

**GT's NEI plugin builds the generic part of its catalyst list this way, but that is not the whole list** (corrected by reviewer, 2026-10-17; the original said "exactly").

How the generic part is built, in `gregtech.nei.NEIGTConfig`:

- `generateRecipeCatalystIndex` loops over `GregTechAPI.METATILEENTITIES`, starting at ID 1. For each `RecipeMapWorkable` prototype, for each map in `getAvailableRecipeMaps()`, and for each category in `map.getAssociatedCategories()`, it files the machine under that `RecipeCategory`. Machines are ordered by `getRecipeCatalystPriority()`.
- `registerCatalysts` then calls `API.addRecipeCatalyst(mte.getStackForm(1), category.unlocalizedName, priority)`.
- So the NEI handler ID is the category's name. For a map's default category that name equals the map's `unlocalizedName`.
- A machine is listed under every category of each map it runs, for example the recycling categories.

The server-side export reproduces this part, which answers prior-art T12 for most GT maps. It misses two sources:

1. **Hard-coded catalysts in the same `registerCatalysts` method.** No machine's `getAvailableRecipeMaps()` reports these maps, and no MTE class references them. The exporter must add them by hand:
   - IC2 `nuclearReactor` → `ic2NuclearFakeRecipes`;
   - the vanilla cauldron item (`Items.field_151066_bu`, MCP `cauldron`) → `cauldronRecipe`;
   - the LV–UMV single-block cutters (`ItemList.Machine_LV_Cutter` … `CuttingMachineUMV`), GT++ `Industrial_CuttingFactoryController` and `ItemList.IndustrialCuttingMachine` → `cutterFakeRecipes`.
2. **NEI's own catalyst list.** `NotEnoughItems-2.8.145-GTNH.jar` loads `/assets/nei/csv/catalysts.csv` (`codechicken.nei.recipe.RecipeCatalysts`: `ldc "/assets/nei/csv/catalysts.csv"`).
   - 693 rows name `gt.recipe.*` handlers, and 601 of those give a GT machine item (`gregtech:gt.blockmachines:<ID>`).
   - Rows are gated on mod IDs: 279 `gregtech` (excluded only when GT6's `gregapi_post` is present), 288 `dreamcraft`, 23 `miscutils`, plus a few BartWorks, GoodGenerator, TecTech and KekzTech rows. The other 91 rows need GT6 (`gregapi_post`).
   - Sampled rows name machines that the generic loop already registers (ID 106 `STEAM_MACERATOR` for `gt.recipe.macerator`; 10752 `PLASMA_GENERATOR_ZPM` for `gt.recipe.plasmageneratorfuels`), so they are probably duplicates. Whether any row adds a machine the loop does not is **UNVERIFIED**.
   - The exporter can read the CSV from the NEI jar as data and merge it in.

Other mods' NEI plugins (GT++ `NEIGTPPConfig`, `NEI_IG_Config`, kubatech `NEIConfig`) register catalysts only for their own handlers (`GTPP_Decayables`, `crafting`, the Intergalactic space-pump and gas-siphon handlers, `mobsinfo.mobhandler`), not for GT recipe maps.

```
$ J -cp $GT gregtech.api.interfaces.tileentity.RecipeMapWorkable
  public abstract gregtech.api.recipe.RecipeMap<?> getRecipeMap();  public default java.util.Collection<…RecipeMap<?>> getAvailableRecipeMaps();
  public default int getRecipeCatalystPriority();
$ J -cp $GT gregtech.api.interfaces.tileentity.IRecipeLockable | head -2   → … extends gregtech.api.interfaces.tileentity.RecipeMapWorkable
$ J -cp $GT -p -c gregtech.nei.NEIGTConfig | grep -E 'METATILEENTITIES|getAvailableRecipeMaps|getRecipeCatalystPriority|addRecipeCatalyst'
  getstatic GregTechAPI.METATILEENTITIES … RecipeMapWorkable.getAvailableRecipeMaps … RecipeMapWorkable.getRecipeCatalystPriority … codechicken/nei/api/API.addRecipeCatalyst
$ J -cp $GT -p -c gregtech.nei.NEIGTConfig | awk '/private static void generateRecipeCatalystIndex/,/^$/' | grep -E 'iconst_1|getAvailableRecipeMaps|getAssociatedCategories|Builder.put'
  21: iconst_1  50: RecipeMapWorkable.getAvailableRecipeMaps  86: RecipeMap.getAssociatedCategories  122: ImmutableListMultimap$Builder.put
$ J -cp $GT -p -c -constants gregtech.nei.NEIGTConfig | awk '/private void registerCatalysts/,/^$/' | grep -E 'String nuclearReactor|RecipeMaps\.|ItemList\.(Machine_LV_Cutter|CuttingMachineUMV|IndustrialCuttingMachine)|Industrial_CuttingFactoryController|field_151066_bu'
  61: ldc_w String nuclearReactor  69: getstatic RecipeMaps.ic2NuclearFakeRecipes
  82: getstatic net/minecraft/init/Items.field_151066_bu  88: getstatic RecipeMaps.cauldronRecipe
  104: getstatic ItemList.Machine_LV_Cutter … 176: getstatic ItemList.CuttingMachineUMV  217: getstatic RecipeMaps.cutterFakeRecipes
  229: getstatic GregtechItemList.Industrial_CuttingFactoryController  240: …cutterFakeRecipes  249: getstatic ItemList.IndustrialCuttingMachine  260: …cutterFakeRecipes
$ for m in cutterFakeRecipes ic2NuclearFakeRecipes cauldronRecipe; do jargrep $GT $m; done
  only RecipeMaps, recipe loaders/items (FakeCuttingRecipes, GTPostLoad, ItemBreederCell, ItemRadioactiveCellIC) and NEIGTConfig; no MTE class
$ unzip -p $PACK/mods/NotEnoughItems-2.8.145-GTNH.jar assets/nei/csv/catalysts.csv | grep -c '^gt\.recipe'   → 693
```

Some multiblocks choose their map from `machineMode` (`MTEMultiBlockBase.machineMode`, default 0). Use `getAvailableRecipeMaps()`, not `getRecipeMap()`. Wrap each call in `try/catch (Throwable)`: an override that touches the base tile entity would fail on a prototype (none observed, **UNVERIFIED**).

### 3.5 Prototype caveats (methods that throw on prototypes)

Some energy getters call `getBaseMetaTileEntity().isAllowedToWork()`. On a prototype that is a `NullPointerException`:

```
$ J -cp $GT -p -c gregtech.api.metatileentity.implementations.MTETransformer | awk '/public long maxEUInput\(\)/,/lreturn/'
   0: getstatic GTValues.V  4: invokevirtual getBaseMetaTileEntity  7: invokeinterface IGregTechTileEntity.isAllowedToWork …
$ J -cp $GT -p -c gregtech.api.metatileentity.implementations.MTEBasicGenerator | awk '/public long maxEUOutput\(\)/,/lreturn/'
   1: invokevirtual getBaseMetaTileEntity  4: invokeinterface IGregTechTileEntity.isAllowedToWork  … 16: getfield mTier … laload
```

Safe on prototypes, because they read only fields:

- `MTEBasicMachine.maxEUInput()` (= `V[mTier]`);
- `MTESteamTurbine.getEfficiency()` (= `6 + mTier`) and `consumedFluidPerOperation()` (= `getEfficiency()`);
- `MTEBoilerSolar.getMaxOutputPerSecond()` (field `maxOutputPerSecond`, set from `MachineStats` config in the constructor);
- `MTEBasicBatteryBuffer.maxAmperesIn()` (= `mChargeableCount × 2`) and `maxAmperesOut()` (= `mBatteryCount`).

`MTEBasicMachine.maxAmperesIn()` depends on the running `mEUt` and is meaningless on a prototype. Generators: export `mTier` and compute `V[tier]`; never call `maxEUOutput()`.

### 3.6 Cables and pipes

All of these extend `gregtech.api.metatileentity.MetaPipeEntity` (fields public final unless noted):

| Class | Fields → meaning (from the tooltip code) |
|---|---|
| `implementations.MTECable` | `mVoltage` (long, max V), `mAmperage` (long, max A), `mCableLossPerMeter` (long, EU lost per block per amp: "Loss/Meter/Ampere"), `mInsulated`, `mCanShock`, `mThickNess`, `mMaterial` (`Materials`, `.mName`) |
| `implementations.MTEFluidPipe` | `mCapacity` (int, L per tick per sub-pipe: the tooltip prints `mCapacity × 20` as "Fluid Capacity: %s L/sec"), `mPipeAmount` (number of sub-pipes in one block), `getCapacity()` = `mCapacity × 20 × mPipeAmount`, `mHeatResistance` (K), `mGasProof`, `mMaterial` |
| `gtPlusPlus…GTPPMTEFluidPipe` | subclass of `MTEFluidPipe` with `pipeStats` |
| `implementations.MTEItemPipe` | `getPipeCapacity()` (= `mInventory.length`, stacks per `mTickTime` ticks: "Item Capacity: %s Stacks/%s ticks"), `mTickTime`, `mStepSize` ("Routing Value"), `mIsRestrictive` (public, not final), `mMaterial` |
| others | `MTEFrame` (also a `MetaPipeEntity`); TecTech `MTEPipeData`/`MTEPipeLaser`/…; lanthanides `MTEBeamlinePipe`; long-distance pipelines `MTELongDistancePipelineFluid/Item`. The pipelines are not pipes: `MTELongDistancePipelineBase → MTEBasicHullNonElectric → MTEBasicHull → MTEBasicTank` |

```
$ J -cp $GT -p gregtech.api.metatileentity.implementations.MTECable | grep 'public final'
  public final float mThickNess;  public final gregtech.api.enums.Materials mMaterial;  public final long mCableLossPerMeter;
  public final long mAmperage;  public final long mVoltage;  public final boolean mInsulated;  public final boolean mCanShock;
$ unzip -p $GT assets/gregtech/lang/en_US.lang | grep -E '^gt\.blockmachines\.(cable\.desc|fluidpipe\.capacity\.desc|itempipe\.capacity\.tick)='
  gt.blockmachines.cable.desc=Max Voltage: %s\nMax Amperage: %s\nLoss/Meter/Ampere: %s
  gt.blockmachines.fluidpipe.capacity.desc=§9Fluid Capacity: %s L/sec§7     gt.blockmachines.itempipe.capacity.tick=Item Capacity: %s Stacks/%s ticks
$ J -cp $GT -p -c gregtech.api.metatileentity.implementations.MTEFluidPipe | awk '/public final int getCapacity\(\)/,/ireturn/'
   1: getfield mCapacity  4: bipush 20  6: imul  8: getfield mPipeAmount  11: imul
```

### 3.7 Generators, boilers, turbines, buffers, transformers

| Thing | Class | ID (enum `MetaTileEntityIDs`) | Useful fields/methods |
|---|---|---|---|
| Simple solar boiler | `gregtech.common.tileentities.boilers.MTEBoilerSolar` | 105 `SIMPLE_SOLAR_BOILER` | `getMaxOutputPerSecond()`, `getMinOutputPerSecond()` (calcified). Values from `config/GregTech/MachineStats.cfg` `bronzesolarboiler {…}` |
| High-pressure solar boiler | `…boilers.MTEBoilerSolarSteel` (extends `MTEBoilerSolar`) | 114 `HIGH_PRESSURE_SOLAR_BOILER` | same; config `steelsolarboiler {…}` |
| Coal / lava boilers | `…boilers.MTEBoilerBronze`, `MTEBoilerSteel`, `MTEBoilerLava` (base `MTEBoiler`) | 100, 101, 102 | `mSteam`, `getCapacity()` |
| Steam turbine LV/MV/HV | `gregtech.common.tileentities.generators.MTESteamTurbine` (extends `MTEBasicGenerator`) | 1120 / 1121 / 1122 `STEAM_TURBINE_*` | `mTier`, `getEfficiency()` = `6 + mTier`, `consumedFluidPerOperation()` = `getEfficiency()`, `getFuelValue(steam)` = 3. The EU-per-litre conversion is left to the power topic (**UNVERIFIED** here) |
| Other singleblock generators | `…generators.MTEDieselGenerator`, `MTEGasTurbine`, `MTEPlasmaGenerator`, `MTESolarGenerator`; bartworks `MTEAcidGenerator` | 1115-1119 gas turbines, … | `getRecipeMap()` = their fuel map |
| Large boilers | `…multi.MTELargeBoilerBronze/Steel/Titanium/TungstenSteel` (+ `…Legacy`), `MTEThermalBoiler` | 1020-1023 | multiblock |
| Large turbines | `…multi.turbines.MTELargeTurbineSteam/HPSteam/SCSteam/Gas/Plasma`, XL `…multi.xlturbines.*`, legacy `…multi.MTELargeTurbine*Legacy` | 1131, 1151-1153 | multiblock |
| Battery buffers | `gregtech.api.metatileentity.implementations.MTEBasicBatteryBuffer` | 60 IDs: 160-199 (1×1 … 4×4, ULV-UHV), 11240-11275 (UEV and up) | `mTier`, `mBatteryCount` (slots), `maxAmperesOut()` = `mBatteryCount`, `maxAmperesIn()` = `2 × mChargeableCount` |
| Transformers | `…implementations.MTETransformer` (+ `MTEWetTransformer`) | 20-28, 11220-11224; hi-amp `877-885` (`Transformer_HA_*`) | `mTier` only; `maxEU*` throw on prototypes (§3.5) |
| Chargers | `gregtech.common.tileentities.machines.basic.MTECharger`, `MTETurboCharger` | — | — |

```
$ J -cp $GT -p gregtech.common.tileentities.boilers.MTEBoilerSolarSteel | head -2   → … extends gregtech.common.tileentities.boilers.MTEBoilerSolar
$ J -cp $GT -p -c -constants gregtech.common.tileentities.generators.MTESteamTurbine | awk '/getEfficiency\(\)|getFuelValue\(net.minecraftforge.fluids.FluidStack\);/,/ireturn/'
   0: bipush 6  3: getfield mTier  6: iadd  …  GTModHandler.isAnySteam … iconst_3
$ J -cp $GT -p -c gregtech.common.tileentities.boilers.MTEBoilerSolar | grep maxOutputPerSecond   → getfield …MachineStats$BronzeSolarBoiler.maxOutputPerSecond … putfield maxOutputPerSecond
$ J -cp $GT -p -c gregtech.api.metatileentity.implementations.MTEBasicBatteryBuffer | awk '/maxAmperes(In|Out)\(\)/,/lreturn/'   → mChargeableCount … 2l lmul / mBatteryCount
```

The IDs come from `MetaTileEntityIDs` (pack-level constants, not world data). For the solar boilers and the steam turbine, the class-to-ID pairing was checked in GT's registration code:

```
$ J -cp $GT -p -c -constants gregtech.loaders.preload.LoaderMetaTileEntities | grep -E 'SOLAR_BOILER|STEAM_TURBINE_LV:|class .*(MTEBoilerSolar|MTESteamTurbine)'
  new …boilers/MTEBoilerSolar … getstatic MetaTileEntityIDs.SIMPLE_SOLAR_BOILER
  new …boilers/MTEBoilerSolarSteel … getstatic MetaTileEntityIDs.HIGH_PRESSURE_SOLAR_BOILER
  new …generators/MTESteamTurbine … getstatic MetaTileEntityIDs.STEAM_TURBINE_LV …
```

The other rows pair class and ID by enum name only (**UNVERIFIED** per row). The export settles it, because it writes `cls` for every ID. See world-format §6.4 for buffers in the world.

---

## 4. Vanilla and Forge data

### 4.1 Crafting table

- **List:** `CraftingManager.getInstance().getRecipeList()` (raw `List` of `IRecipe`). SRG names: `func_77594_a` / `func_77592_b`, both sides (`MCPCSV`: `func_77592_b,getRecipeList,2,…`).
- **Output:** `IRecipe.getRecipeOutput()` (`func_77571_b`, side 2). It can be `null` for dynamic recipes.
- **Size in this pack:** about **64.6 k crafting recipes** after NHCoreMod's script pass. The live server log reads `[GregTech GTNH/dreamcraft]: BulkRemoveRecipeByOutput: allRecipes: 64630; toRemove: 20` and then `BulkRemoveByRecipe: allRecipes: 64630; toRemove: 223`. The client log shows nearly the same count (64634). GT then removes recipes with empty ore-dictionary lists at server start (`GTMod: Cleaning up all OreDict Crafting Recipes, which have an empty List in them`).

**Shapes to handle** (by `instanceof`, most specific first):

| Class | Read | Notes |
|---|---|---|
| `net.minecraftforge.oredict.ShapedOreRecipe` | `getInput()` → `Object[]` (each `ItemStack` \| `ArrayList<ItemStack>` (an ore-dictionary list) \| `null`); private `width`, `height`, `mirrored` (Forge field names, reflection works unchanged in production) | Covers `gregtech.api.util.GTShapedRecipe` and NHCoreMod's `com.dreammaster.recipes.ShapedUniversalRecipe`, plus 24 more subclasses in the pack |
| `net.minecraftforge.oredict.ShapelessOreRecipe` | `getInput()` → `ArrayList<Object>` | Covers `GTShapelessRecipe`, `ShapelessUniversalRecipe` + 15 more |
| `net.minecraft.item.crafting.ShapedRecipes` | `recipeWidth`, `recipeHeight`, `recipeItems` (`ItemStack[]`) (SRG `field_77576_b/_77577_c/_77574_d`) | 9 subclasses in the pack |
| `net.minecraft.item.crafting.ShapelessRecipes` | `recipeItems` (`List`, `field_77579_b`) | 12 subclasses |
| `ic2.core.AdvRecipe` / `AdvShapelessRecipe` | public `input` (`Object[]`, elements checked with `instanceof ic2.api.recipe.IRecipeInput`), `inputWidth`, `inputHeight`, `masks`, `output`, `hidden` | Read `IRecipeInput.getInputs()` (`List<ItemStack>`) and `getAmount()`. AdvRecipe's own code calls `getInputs()`. **UNVERIFIED** how many survive GT's changes |
| `appeng.recipes.game.ShapedRecipe` / `ShapelessRecipe` | `getInput()` (`Object[]` / `ArrayList<Object>` of `appeng.api.recipes.IIngredient`: `getItemStackSet()`, `getItemStack()`, `isAir()`) | few |
| `minetweaker.mc1710.recipes.*` | CraftTweaker classes | `$PACK/scripts/` is empty in RC-1 (`ls $PACK/scripts` → nothing), so expect none |
| ~144 other `IRecipe` classes (dyeing, NBT copy, repair, Botania/Thaumcraft specials, …): 208 recipe classes in 61 jars, minus the 64 subclasses of the four shapes above | `getRecipeOutput()` only | Export as `opaque` with the class name |

The ore-dictionary name of a list input can be recovered by identity. `ShapedOreRecipe` stores the list instance returned by `OreDictionary.getOres(String)`, and that method returns cached per-ID lists (`idToStackUn.get(id)`). Build an `IdentityHashMap<List, String>` from `getOreNames()`. Skip empty lists, because unknown IDs share one `EMPTY_LIST`.

```
$ J -cp $FORGE -p -c net.minecraftforge.oredict.ShapedOreRecipe | awk '/ShapedOreRecipe\(add, java.lang.Object...\)/,/^$/' | grep OreDictionary   → OreDictionary.getOres:(Ljava/lang/String;)Ljava/util/ArrayList;
$ J -cp $FORGE -p -c net.minecraftforge.oredict.OreDictionary | awk '/getOres\(int\)/,/^$/' | grep -E 'idToStackUn|EMPTY_LIST'   → getstatic idToStackUn … List.get … getstatic EMPTY_LIST
$ J -cp $PACK/mods/industrialcraft-2-2.2.828-experimental.jar -p ic2.core.AdvRecipe | grep 'public final'
  public final net.minecraft.item.ItemStack output;  public final java.lang.Object[] input; … public final int inputWidth;  public final int inputHeight;
```

The subclass counts come from the superclass chains of all 92,201 classes in the 216 mod jars that could be indexed (`classhier.py`, in local notes). How many recipes of each class exist at run time is **UNVERIFIED**. Log a histogram from the exporter.

### 4.2 Furnace

`FurnaceRecipes.smelting().getSmeltingList()` returns `Map<ItemStack, ItemStack>`. The experience value comes from `FurnaceRecipes.smelting().func_151398_b(output)` (that name is used in the dev environment too, §1.5). SRG names are `func_77602_a` / `func_77599_b`, both sides. GT rewrites the outputs at server start ("GTMod: Smelting" in `onServerStarting`), so export after that (§5.6).

### 4.3 Ore dictionary

- `OreDictionary.getOreNames()` → `String[]`. `OreDictionary.getOres(name)` → the stacks; meta `32767` (`OreDictionary.WILDCARD_VALUE`) means "any meta".
- Per stack: `OreDictionary.getOreIDs(stack)` and `getOreName(id)`.
- GT's preferred item per ore name: `GTOreDictUnificator.get(Object oreName, long amount)`.
- GT material of a stack: `GTOreDictUnificator.getAssociation(ItemStack)` → `ItemData{mPrefix (OrePrefixes), mMaterial (MaterialStack{mMaterial, mAmount})}`. Prior-art §3.1 asks for this, plus `OrePrefixes.getMaterialAmount()`, for the cost model.

```
$ J -cp $FORGE -p net.minecraftforge.oredict.OreDictionary | grep -E 'getOreNames|getOreIDs|WILDCARD'
  public static final int WILDCARD_VALUE;  public static int[] getOreIDs(add);  public static java.lang.String[] getOreNames();
$ J -cp $GT -p gregtech.api.util.GTOreDictUnificator | grep -E 'getAssociation|ItemStack get\(java.lang.Object, long\)'
  public static gregtech.api.objects.ItemData getAssociation(net.minecraft.item.ItemStack);  public static net.minecraft.item.ItemStack get(java.lang.Object, long);
```

### 4.4 Items: registry and enumerating variants on the server

- **All items:** `GameData.getItemRegistry().typeSafeIterable()`. Name: `getNameForObject(item)` (`modid:name`). Numeric ID: `getId(item)`. These are Forge methods; `getNameForObject` is the inherited vanilla `func_148750_c`, and RFG remaps it.
- **Variants cannot be listed generically on a server.** `Item.getSubItems` is client-only, and GT marks its own overrides `@SideOnly(CLIENT)`, which FML strips from the server classes:
  ```
  $ grep '^func_150895_a,' $MCPCSV           → func_150895_a,getSubItems,0,"returns a list of items with the same ID, but different meta …"
  $ J -cp $GT -p -v gregtech.api.items.MetaGeneratedItem | sed -n '/func_150895_a(/,/func_94581_a/p' | grep -A2 RuntimeVisibleAnnotations
      RuntimeVisibleAnnotations:  …  cpw.mods.fml.relauncher.SideOnly( value=Lcpw/mods/fml/relauncher/Side;.CLIENT )
  ```
- **What to collect instead:**
  1. Meta 0 of every item whose `getHasSubtypes()` is false.
  2. Every stack seen in any exported recipe, ore-dictionary list, fluid container or machine `getStackForm`.
  3. GT meta-items, replicating the client-side `getSubItems` loop from public fields: `for i in [0, mEnabledItems.length()) if (mEnabledItems.get(i) && mVisibleItems.get(i)) → new ItemStack(item, 1, mOffset + i)`. The fields are `public final short mOffset; public final java.util.BitSet mEnabledItems; public final java.util.BitSet mVisibleItems;` (verified by disassembling `MetaGeneratedItem.getSubItems`).
  4. Optionally, a list of `registry@meta` pairs from the world scan, read from a file next to the export dir, so storage contents that appear in no recipe still get names.

  For a recipe planner this covers every item that matters. Items that appear nowhere (decor variants) are only missing from search.
- **Numeric IDs are per world.** A fresh world gets its own FML ID assignment, and the group's world was converted by EndlessIDs (world-format §4). Join on registry name + meta (+ NBT), never on `nid` (prior-art §3.1 item 4).

### 4.5 Fluids

- `FluidRegistry.getRegisteredFluids()` → `Map<String, Fluid>`.
- Per fluid: `getName()` (stable key, e.g. GT molten fluids are `molten.*`), `getID()` (per world), `getUnlocalizedName()`, `getLocalizedName(FluidStack)`, `getTemperature()`, `isGaseous()`, `getDensity()`, `getViscosity()`.
- Containers: `FluidContainerRegistry.getRegisteredFluidContainerData()` → `FluidContainerData{fluid, filledContainer, emptyContainer}` (cells, buckets, capsules).

```
$ J -cp $FORGE -p net.minecraftforge.fluids.FluidRegistry | grep getRegisteredFluids   → public static java.util.Map<java.lang.String, net.minecraftforge.fluids.Fluid> getRegisteredFluids();
$ J -cp $FORGE -p 'net.minecraftforge.fluids.FluidContainerRegistry$FluidContainerData' | grep 'public final'
  public final net.minecraftforge.fluids.FluidStack fluid;  public final add filledContainer;  public final add emptyContainer;
```

### 4.6 English names on a dedicated server (answers prior-art T13)

Three mechanisms put English names into the server's `StringTranslate`, which `StatCollector` and `ItemStack.getDisplayName()` read:

1. **FML injects every mod's `en_US.lang` on the server.** `FMLServerHandler.addModAsResource` calls `LanguageRegistry.loadLanguagesFor(container, Side.SERVER)`. For each jar entry matching `assets/(.*)/lang/(?:.+/|)([\w_-]+).lang`, `searchZipForLanguages` registers the file, and if the language is `en_US` and the side is `SERVER` it calls `StringTranslate.inject(InputStream)` (Notch class `de`).
   ```
   $ J -cp $FORGE -p -c cpw.mods.fml.server.FMLServerHandler | awk '/addModAsResource/,/return/'
      4: getstatic Side.SERVER  7: invokevirtual LanguageRegistry.loadLanguagesFor
   $ J -cp $FORGE -p -c -constants cpw.mods.fml.common.registry.LanguageRegistry | awk '/searchZipForLanguages/,/^$/' | grep -E 'en_US|Side.SERVER|de.inject'
      104: ldc String en_US … 115: getstatic Side.SERVER … 127: invokestatic de.inject:(Ljava/io/InputStream;)V
   ```
   *Verified by reviewer (2026-10-17):*
   - The call comes from `LoadController.buildModList`. It loops over the mod list and calls `FMLCommonHandler.addModToResourcePack` for each mod it activates.
   - The branch is `"en_US".equals(lang)` and then `side == Side.SERVER` (`111: ifeq 130`, `118: if_acmpne 130`).
   - The pattern constant in `LanguageRegistry.<clinit>` is the one quoted above.
   - No jar in the pack ships a replacement `cpw/mods/fml/server/FMLServerHandler.class` or `…/LanguageRegistry.class`.
   - The live server's own `logs/latest.log` (read-only) shows `[Server thread/INFO]: [<op>: Given [Output Hatch (HV)] * 1 to <player>]` (2×) and `… Given [Dark Steel Dust] * 1 …` (3×).

   GT's jar carries `assets/gregtech/lang/en_US.lang` (625 KB, 10,302 lines) plus `bartworks`, `goodgenerator`, `miscutils` (GT++), `tectech`, `kubatech`, `gtnhlanth` and `gtnhintergalactic` `en_US.lang` files.
2. **GT writes its runtime names straight into the vanilla table.** `GTLanguageManager` grabs `StringTranslate.languageList` by reflection (`ReflectionHelper.findField(StringTranslate.class, "languageList", "field_74816_c")`). `addStringLocalization` → `storeTranslation` → `writeToLangFile` → `addToMCLangList` puts each name there. This is where machine names such as `gt.blockmachines.*.name` come from. The same values are mirrored into `$PACK/GregTech.lang` (`languagefile { S:<key>=<value> … }`, 2,597 entries in this pack).
   ```
   $ J -cp $GT -p -c -constants gregtech.api.util.GTLanguageManager | grep -E 'String languageList|field_74816_c|ReflectionHelper|addToMCLangList'
     143: ldc_w class net/minecraft/util/StringTranslate … 152: ldc_w String languageList  158: ldc_w String field_74816_c
     162: invokestatic cpw/mods/fml/relauncher/ReflectionHelper.findField …        (static init)
     91: invokestatic addToMCLangList:(Ljava/lang/String;Ljava/lang/String;)V       (in writeToLangFile)
   ```
3. **The display-name code is common code.** `ItemStack.getDisplayName` (`func_82833_r`), `Item.getItemStackDisplayName` (`func_77653_i`), `getUnlocalizedName` (`func_77667_c`, `func_77658_a`) and `StatCollector.translateToLocal` (`func_74838_a`) are all side 2 in `MCPCSV`. GT's overrides of `func_77653_i` / `func_77667_c` in `MetaGeneratedItem`, `MetaGeneratedItemX32`, `GTGenericItem` and `ItemMachines` have no `@SideOnly` annotation (parsed from `javap -v`).

**Observed on the live server.** The server's own log prints English names that it resolved itself when an operator used `/give`: `[Server thread/INFO]: [<op>: Given [Output Hatch (HV)] * 1 to <player>]` and `… Given [Dark Steel Dust] * 1 …` (player names replaced). These are a GT machine name and a GT material item name.

**Remaining risk.** A mod whose `getItemStackDisplayName` calls client-only `net.minecraft.client.resources.I18n` fails on a server with `NoClassDefFoundError`. Catch `Throwable` per stack. Fall back to `StatCollector.translateToLocal(getUnlocalizedName(stack) + ".name")` when `canTranslate` is true, else `null`. Count the failures in the manifest. Which mods do this is **UNVERIFIED** until the first run.

### 4.7 Client-only calls to avoid

| Avoid | Why / evidence |
|---|---|
| `Item.getSubItems` (`func_150895_a`), `Block.getSubBlocks` (`func_149666_a`) | side 0 in `MCPCSV`; GT's overrides carry `@SideOnly(CLIENT)` |
| `Item.addInformation` (tooltips, `func_77624_a`) | side 0; GT `ItemMachines.func_77624_a` carries `@SideOnly(CLIENT)` |
| `Item.getCreativeTab` (`func_77640_w`), icons (`getIconFromDamage` `func_77617_a`, `getIconIndex`, `registerIcons` `func_94581_a`, `Block.getIcon` `func_149691_a`), colors (`getColorFromItemStack` `func_82790_a`), `hasEffect` | side 0 |
| Anything in `net.minecraft.client.*`, `IIconRegister`, `I18n` | not present in the server jar |
| GT: `IMetaTileEntity.registerIcons`, `getTexture`, UI builders (ModularUI), NEI formatters' `format(RecipeDisplayInfo)`, `RecipeMetadataKey.drawInfo` | display code; not needed |
| MTE energy getters on prototypes | NPE (§3.5) |

### 4.8 Other mods' recipe registries (optional second phase)

All of the following were checked for presence in the pack jars:

| Mod | Entry point | Evidence |
|---|---|---|
| Thaumcraft 4.2.3.5 | `thaumcraft.api.ThaumcraftApi.getCraftingRecipes()` → `List` (arcane, infusion, crucible) | `J -p` → `public static java.util.List getCraftingRecipes();` |
| Avaritia 1.99 | `fox.spiteful.avaritia.crafting.ExtremeCraftingManager.getInstance().getRecipeList()` → `List<IRecipe>` | `J -p` |
| Tinkers' Construct | `tconstruct.library.crafting.Smeltery.getSmeltingList()`, `getAlloyList()`; `LiquidCasting.getCastingRecipes()` | `J -p` |
| Botania | `vazkii.botania.api.BotaniaAPI.petalRecipes`, `pureDaisyRecipes`, `manaInfusionRecipes`, `runeAltarRecipes` | `J -p` |
| Blood Magic | `WayofTime.alchemicalWizardry.api.altarRecipeRegistry.AltarRecipeRegistry.altarRecipes` | `J -p` |
| AE2 | `appeng.api.features.IInscriberRegistry.getRecipes()` | `J -p` |
| Railcraft | `mods.railcraft.api.crafting.RailcraftCraftingManager.cokeOven / blastFurnace / rockCrusher / rollingMachine` | `J -p` |
| Forestry | `forestry.api.recipes.RecipeManagers.carpenterManager`, `centrifugeManager`, `fermenterManager`, … | `J -p` |
| IC2 machines | `ic2.api.recipe.Recipes.macerator / extractor / compressor …` | `J -p`. GT calls `GTModHandler.removeAllIC2Recipes()` in `onServerStarting`, and IC2 logs `Successfully loaded 0 out of 0 recipes for macerator recipes` etc. on this server |

---

## 5. Headless run on a copy of the server

**Hard rules:**

- Never start, stop or modify the live server, its `World/`, its config, or the game client.
- The copy is a separate folder with its own port and a fresh throwaway world.
- Everything below **reads** the live pack and writes only into the copy.

### 5.1 What to copy

APFS clones (`cp -c`) cost no disk space and do not change the source.

| Copy | Why |
|---|---|
| `mods/` (incl. `mods/ic2/EJML-core-0.26.jar`) + the exporter jar | the pack itself |
| `config/` (78 MB) | Recipes and machine stats depend on it, e.g. `config/GregTech/MachineStats.cfg` sets the solar boiler output |
| `libraries/` (launchwrapper, ASM 9.4, Scala, …), `lwjgl3ify-forgePatches.jar`, `forge-1.7.10-10.13.4.1614-1.7.10-universal.jar`, `minecraft_server.1.7.10.jar`, `java9args.txt` | the launcher chain (`-jar lwjgl3ify-forgePatches.jar`, `-Djava.system.class.loader=com.gtnewhorizons.retrofuturabootstrap.RfbSystemClassLoader`) |
| `scripts/` | CraftTweaker scripts. Empty in RC-1 (no world-level scripts in the backup either), but a future pack may ship some |
| `falsepattern/` | Libraries that FalsePatternLib already downloaded (brigadier, fastutil, joml, jvmdowngrader api, plus `fplib_deploader.jar`). Without them it presumably downloads them again on first boot (**UNVERIFIED**) |
| `eula.txt` | already `eula=true` (the owner accepted it for this server) |
| `server.properties` | then edit the **copy** (§5.2) |

| Leave out | Why |
|---|---|
| `World/`, `backups/`, `World-*.zip` | world data; the copy creates a fresh world |
| `logs/`, `crash-reports/`, `usercache.json`, `usernamecache.json`, `ops.json`, `banned-*.json`, `whitelist.json` (write `[]` instead) | player data |
| `journeymap/`, `visualprospecting/`, `serverutilities/`, `blueprints/` | per-server/world data, regenerated if needed |
| `coretweaks/` (transformer cache), `GregTech.lang`, `*.dylib` (OpenComputers natives), `server-icon.png`, `.healer.log` | regenerated or not needed (optional to copy) |
| `startserver-java9.sh` / `.bat` | **it loops forever** (`while true … Rebooting in: 12 … 1`), so the exporter's shutdown would just restart it |

### 5.2 `server.properties` of the copy

| Key | Live value | Copy | Why |
|---|---|---|---|
| `server-port` | 25565 | **25566** (any free port) | the port is bound before mods load. A clash makes the copy stop: `DedicatedServer.startServer` logs `**** FAILED TO BIND TO PORT!` and returns false |
| `server-ip` | (empty) | **127.0.0.1** | never reachable from the network |
| `level-name` | `World` | **`export-world`** | fresh world, deleted after the run |
| `level-type` | `rwg` | **`FLAT`** | far less spawn-area generation. Recipes do not depend on the world type. **UNVERIFIED** that every GTNH mod is happy on FLAT; fall back to `rwg` if not |
| `generate-structures` | true | false | less world generation |
| `spawn-animals` / `spawn-monsters` / `spawn-npcs` | true | false | nothing to tick |
| `white-list` | true | true, with `whitelist.json` = `[]` | nobody can join |
| `online-mode` | true | true (either works) | No player ever logs in, so no session check runs. `false` only adds a startup warning ("To change this, set "online-mode" to "true"…" in `startServer`) |
| `snooper-enabled` | true | false | no Mojang snooper traffic |
| `enable-query` / `enable-rcon` | false | false | — |
| `max-tick-time` | 0 | **0** | The export runs inside one server tick. ServerUtilities adds a hang watchdog that reads this key (mixin `MixinDedicatedServer_MaxTickTime`: `getLongProperty("max-tick-time", -1)`). `ServerHangWatchdog` only starts when the value is > 0 (`lcmp; ifle`), and the pack enables the feature (`serverutilities.cfg`: `B:enable_max_tick_time_property=true`). A positive value could kill the copy mid-export |
| `view-distance` | 8 | 3 | irrelevant without players |

### 5.3 Command

The flags are the live script's (`java -Xms6G -Xmx6G -Dfml.readTimeout=180 -Duser.language=en @java9args.txt -jar lwjgl3ify-forgePatches.jar nogui`), plus three additions:

```bash
cd "$COPY" && nice -n 10 /Library/Java/JavaVirtualMachines/jdk-25.jdk/Contents/Home/bin/java \
  -Xms6G -Xmx6G -Dfml.readTimeout=180 -Duser.language=en \
  -Dfml.queryResult=confirm \
  -Dgtnhplanner.exportDir="$COPY/export" \
  @java9args.txt -jar lwjgl3ify-forgePatches.jar nogui < /dev/null > "$COPY/export-run.log" 2>&1
echo "exit=$?"; test -f "$COPY/export/EXPORT_OK"
```

- **Java:** the live server runs on that JDK 25. Its log says `Java is Java HotSpot(TM) 64-Bit Server VM, version 25, running on Mac OS X:aarch64 … installed at /Library/Java/JavaVirtualMachines/jdk-25.jdk/Contents/Home`.
- **Heap:** keep 6 GB, the pack default. The exporter streams its output, and its own state is one intern table of a few hundred thousand stacks. Use 8 GB if the GC log complains (**UNVERIFIED** need).
- **`nice -n 10`** gives the live server priority for CPU.

### 5.4 Boot time

The live server's own logs on this host (pack-level lines only):

```
2026-10-12-2.log.gz:  [23:51:00] Starting minecraft server version 1.7.10 | [23:51:09] Starting Minecraft server on *:25565
                      [23:51:16] Preparing start region for level 0 | [23:51:17] Done (1.219s)! For help, type "help" or "?"
fml-server-latest.log: [23:50:57] … Forge Mod Loader version 7.99.40.1614 … | [23:51:15] Forge Mod Loader has successfully loaded 294 mods
2026-10-02-1.log.gz:  [21:30:10] Starting minecraft server version 1.7.10 | … | [21:42:59] Done (748.363s)!   ← first 2.9 boot, blocked ~12 min on two FML queries (§5.7)
```

That is about **20 s** from JVM start to "Done" with an existing world. A fresh world adds spawn-area generation for dimension 0, and the export itself adds time; both are **UNVERIFIED**. Expect a few minutes and use a **15-minute watchdog**.

### 5.5 Event order (why the trigger is `FMLServerStartedEvent` + ticks)

This order was verified in the Forge-patched `DedicatedServer.startServer()` and `MinecraftServer.run()` (`$MC`):

1. `Starting minecraft server version 1.7.10`
2. `FMLCommonHandler.onServerStart` (mods constructed / pre-init)
3. `eula.txt` check
4. the port is bound
5. `FMLCommonHandler.onServerStarted` (init / post-init / load complete)
6. `handleServerAboutToStart`. **CraftTweaker reloads scripts here**: `MineTweakerMod.onServerAboutToStart` → `MineTweakerImplementationAPI.onServerStart`.
7. `loadAllWorlds`
8. `Done (…)`
9. `handleServerStarting`. **GT rewrites recipes here.** `GTMod.onServerStarting` runs:
   - "Unificating outputs of all known Recipe Types";
   - "Crafting Recipes" and "Smelting" unification;
   - the IC2 machine pass and `GTModHandler.removeAllIC2Recipes()`;
   - "Cleaning up all OreDict Crafting Recipes, which have an empty List in them".
10. In `run()`: `handleServerStarted` (**`FMLServerStartedEvent`**), then the tick loop `while (serverRunning) tick()`.

```
$ J -cp $MC -p -c -constants net.minecraft.server.dedicated.DedicatedServer | awk '/protected boolean startServer\(\)/,/^$/' | grep -E 'FMLCommonHandler\.|loadAllWorlds|String (Starting|Done|eula)'
  String Starting minecraft server version 1.7.10 / FMLCommonHandler.onServerStart / String eula.txt / … / FMLCommonHandler.onServerStarted /
  FMLCommonHandler.handleServerAboutToStart / loadAllWorlds / String Done ( / … / FMLCommonHandler.handleServerStarting
$ J -cp $MC -p -c net.minecraft.server.MinecraftServer | awk '/public void run\(\);/,/^$/' | grep -oE 'startServer|handleServerStarted|serverRunning|tick:\(\)V|handleServerStopping|stopServer|handleServerStopped|systemExitNow' | uniq
  startServer handleServerStarted serverRunning tick:()V … handleServerStopping … stopServer … handleServerStopped systemExitNow
$ J -cp $PACK/mods/CraftTweaker-3.4.8.jar -p -c minetweaker.mc1710.MineTweakerMod | awk '/onServerAboutToStart/,/^$/' | grep onServerStart   → MineTweakerImplementationAPI.onServerStart
$ J -cp $FORGE -p -c cpw.mods.fml.server.FMLServerHandler | awk '/beginServerLoading|finishServerLoading/,/return/' | grep Loader
  beginServerLoading: Loader.loadMods  Loader.preinitializeMods      finishServerLoading: Loader.initializeMods
  (FMLCommonHandler.onServerStart → beginServerLoading; onServerStarted → finishServerLoading)
```

GT also runs `GregTechAPI.sFirstWorldTick` runnables on the first world tick. The only registration found, in `GTRecipe$RecipeAssemblyLine`, is behind a `Boolean.getBoolean(…)` debug switch. Waiting **100 ticks** after `FMLServerStartedEvent` covers that tick anyway.

### 5.6 Trigger, shutdown and completion

1. **Inert unless asked.** `@Mod.EventHandler onServerStarted(FMLServerStartedEvent)` does nothing unless `-Dgtnhplanner.exportDir` is set. If it is set, it registers a `TickEvent.ServerTickEvent` listener on `FMLCommonHandler.instance().bus()`. The mod is harmless if it ever lands in a real `mods/` folder.
2. **Export.** On the 100th `Phase.END` tick, run the export on the server thread. With `max-tick-time=0`, ServerUtilities' watchdog stays off (§5.2), so a long tick is fine.
3. **Markers.** Write `EXPORT_OK` (or `EXPORT_FAILED` with the stack trace) **after** every data file is closed. `manifest.json` carries the counts.
4. **Shutdown.** `MinecraftServer.getServer().initiateShutdown()` (`func_71263_m`) sets `serverRunning = false`. The loop then ends, and Minecraft runs `handleServerStopping` → `stopServer` (saves the throwaway world) → `handleServerStopped` → `DedicatedServer.systemExitNow()` → `System.exit(0)`.
   ```
   $ J -cp $MC -p -c net.minecraft.server.MinecraftServer | awk '/public void initiateShutdown\(\);/,/return/' | grep putfield   → putfield serverRunning:Z
   $ J -cp $MC -p -c net.minecraft.server.dedicated.DedicatedServer | awk '/protected void systemExitNow\(\);/,/return/'   → 0: iconst_0  1: invokestatic java/lang/System.exit:(I)V
   ```
5. **Done when** all three hold:
   1. `export/EXPORT_OK` exists;
   2. the process exited with code 0;
   3. `manifest.json` parses and its counts are non-zero.

   If there is no marker after 15 min, kill the process tree and report the tail of `export-run.log`. That the JVM really exits cleanly under lwjgl3ify is **UNVERIFIED**. The orchestrator should therefore treat the marker as the success signal and kill a process that is still alive 2 min after the marker appears.
6. **Clean up.** Delete `$COPY/export-world/` afterwards. Keep `$COPY` if you want faster re-runs.

### 5.7 First-boot prompts (FML `StartupQuery`) cannot block a fresh world

- FML reads `-Dfml.queryResult` (`confirm` / `cancel`) to answer any `StartupQuery` without console input:
  ```
  $ J -cp $FORGE -p -c -constants cpw.mods.fml.common.StartupQuery | grep -E 'fml.queryResult|confirm|cancel'
     ldc String fml.queryResult / System.getProperty / String Using fml.queryResult %s to answer the following query:\n%s / String confirm / String cancel
  ```
- The two queries that blocked the live server's first 2.9 boot were both about an existing world (log of 2026-10-02):
  1. FML's missing blocks/items list (IDs in `level.dat` that no longer exist, e.g. `gregtech:tile.gt.dronerender`);
  2. ChunkAPI's "The following data managers have been newly added: … endlessids … A world backup will be automatically created".

  Both ended with "Run the command /fml confirm or or /fml cancel to proceed. Alternatively start the server with -Dfml.queryResult=confirm …".
- ChunkAPI asks only while **reading an existing `level.dat`**: `com.falsepattern.chunk.internal.DataRegistryImpl.readLevelDat` → `StartupQuery.confirm` / `notify`. FML's missing-ID query is likewise about the saved ID map. A fresh world has neither, and `-Dfml.queryResult=confirm` covers anything unexpected.
  ```
  $ J -cp $PACK/mods/chunkapi-mc1.7.10-0.8.4.jar -p -c com.falsepattern.chunk.internal.DataRegistryImpl | grep -n 'StartupQuery\|public static void readLevelDat'
    1061: public static void readLevelDat(net.minecraft.nbt.NBTTagCompound);  1114: invokestatic StartupQuery.confirm … 1139: StartupQuery.notify
  ```
- The EULA is checked before any mod loads (`String eula.txt` / `ServerEula.func_154346_a` in `startServer`), so the copied `eula.txt` must be there.

---

## 6. Output format

### 6.1 Files

Everything lives in `-Dgtnhplanner.exportDir`. Files are UTF-8, gzip, JSON Lines (one JSON value per line). These are easy to stream from Java with Gson's `JsonWriter`, which ships with MC 1.7.10, and to read in Node with `zlib.createGunzip()` + `readline`.

| File | One line per | Key fields |
|---|---|---|
| `manifest.json` (plain JSON) | — | `format` (`gtnh-planner-export/1`), `exporterVersion`, `exportedAt`, `mods{modid: version}`, `counts{…}`. Proposed but not yet written by `SKEL`: `nameFailures`, `craftingClasses{class: n}` |
| `items.jsonl.gz` | item variant | `i` (index used by every other file), `id` (registry name), `m` (meta, 32767 = any), `nbt?` (SNBT string), `nid` (numeric ID **in the export world only**), `un`, `dn` (English), `od[]`, `gtPrefix?`, `gtMat?` |
| `fluids.jsonl.gz` | fluid | `id` (registry name, the key used everywhere), `nid`, `un`, `dn`, `temp`, `gas`, `density` |
| `fluid-containers.jsonl.gz` | container mapping | `container` (item index), `empty` (item index), `fluid`, `amount` |
| `oredict.jsonl.gz` | ore name | `ore`, `items[]` (indices; wildcard metas kept as 32767) |
| `recipe-maps.jsonl.gz` | GT map | `i`, `id` (`unlocalizedName`), `dn`, `amps`, `maxIn`, `maxOut`, `maxFIn`, `maxFOut`, `svFormatter?`, `dynamic?` (`overwrite` \| `fallback` \| `modify`, §2.2), `recipes` (count) |
| `recipes-gt.jsonl.gz` | GT recipe | §6.2 |
| `recipes-assemblyline.jsonl.gz` | assembly-line recipe | `research`, `researchTime`, `researchVoltage`, `in`, `inAlt?`, `fin`, `out`, `eut`, `dur` |
| `recipes-crafting.jsonl.gz` | crafting recipe | `cls`, `shape` (`shaped` \| `shapeless` \| `opaque`), `w?`, `h?`, `in[]`, `out` |
| `recipes-furnace.jsonl.gz` | smelting entry | `in`, `out`, `xp` |
| `machines.jsonl.gz` | MTE ID | `id`, `name`, `cls`, `dn`, `item`, `kind`, `tier?`, `voltage?`, `amps?`, `maps?[]`, and one of `cable{}` / `fluidPipe{}` / `itemPipe{}` / `batterySlots` / `steamPerSecondMax` |
| `EXPORT_OK` \| `EXPORT_FAILED` | — | written last |

### 6.2 JSON shapes

The values below are **illustrative** (no export was run). Field names are what `SKEL` writes. Boilers also get `tier`/`voltage`, because `MTEBoiler` extends `MTEBasicTank`. Ignore `voltage` for anything that is not electric.

```json
{"i":812,"id":"gregtech:gt.metaitem.01","nid":4101,"m":2032,"un":"gt.metaitem.01.2032","dn":"Iron Dust","od":["dustIron"],"gtPrefix":"dust","gtMat":"Iron"}
{"id":"molten.iron","nid":231,"un":"fluid.molten.iron","dn":"Molten Iron","temp":1811,"gas":false,"density":1000}
{"i":40,"id":"gt.recipe.blastfurnace","dn":"Blast Furnace","amps":1,"maxIn":6,"maxOut":6,"maxFIn":1,"maxFOut":1,"svFormatter":"gregtech.nei.formatter.HeatingCoilSpecialValueFormatter","recipes":2500}
{"i":7,"id":"gt.recipe.furnace","dn":"Furnace","amps":1,"maxIn":1,"maxOut":1,"maxFIn":0,"maxFOut":0,"dynamic":"overwrite","recipes":0}
{"map":40,"in":[[812,1],[9001,0]],"out":[[813,1]],"fin":[["oxygen",1000]],"fout":[],"eut":120,"dur":800,"sv":1000,"meta":{"coil_heat":1000}}
{"map":12,"in":[[700,1]],"out":[[701,1],[702,1,2500]],"fin":[],"fout":[["water",100,5000]],"eut":30,"dur":200,"cat":"gt.recipe.category.macerator_recycling","meta":{"recycle":true}}
{"cls":"gregtech.api.util.GTShapedRecipe","out":[3001,1],"shape":"shaped","w":3,"h":3,"in":[{"ore":"plateIron"},{"ore":"plateIron"},{"ore":"plateIron"},{"ore":"plateIron"},null,{"ore":"plateIron"},{"ore":"plateIron"},{"ore":"plateIron"},{"ore":"plateIron"}]}
{"in":812,"out":[813,1],"xp":0.0}
{"id":1000,"name":"multimachine.blastfurnace","cls":"gregtech.common.tileentities.machines.multi.MTEElectricBlastFurnace","dn":"Electric Blast Furnace","item":5000,"kind":"multiblock","maps":["gt.recipe.blastfurnace"]}
{"id":114,"name":"…","cls":"gregtech.common.tileentities.boilers.MTEBoilerSolarSteel","dn":"…","item":5001,"kind":"boiler","tier":…,"voltage":…,"steamPerSecondMax":…}
{"id":…,"kind":"cable","cable":{"voltage":32,"amps":1,"lossPerBlock":1,"insulated":true,"material":"Tin"}}
```

**Encoding rules for GT recipes:**

- **Item slot:** `null` or `[itemIndex, amount]`, or `[itemIndex, amount, chance]` when `chance != 10000`. `amount == 0` means not consumed. Slot order and `null`s are kept, because some maps use slot positions.
- **Fluid slot:** `[fluidName, litres]` or `[fluidName, litres, chance]`.
- **Alternatives:** `inAlt[i]` and `finAlt[i]` list accepted alternatives for slot `i` (`GTRecipe_WithAlt.mOreDictAlt`, `mAltFluidInputs`).
- **Flags** are written only when they are not the default: `disabled`, `hidden`, `fake`, `needsEmptyOut`, `nbtSensitive`.
- **Other fields:** `special` (the `mSpecialItems` item), `cat` (only when not the map's default category), `meta{identifier: value}` (every metadata entry, `ItemStack` values as item indices), `owners[]` (when captured).
- `sv` is `mSpecialValue` raw, omitted when 0.

**Crafting input slot:** `null` \| `itemIndex` \| `{"ore": name}` \| `[itemIndex, …]` (an anonymous list).

### 6.3 Keys and stability

| Thing | Stable key across exports and worlds | Never use |
|---|---|---|
| item | `id` + `m` (+ `nbt`) | `i` (valid inside one export only), `nid` (per world) |
| fluid | `id` (registry name) | `nid` |
| GT machine | `id` (the MTE ID, from the enum) | — |
| recipe map | `id` (`unlocalizedName`), with prior-art T4's alias table for renamed maps | `i` |
| recipe | content hash computed at import (prior-art T5) | file position |

### 6.4 Size estimate

| Data | Count | Source |
|---|---|---|
| Crafting recipes | ~64 k | measured in the server log, §4.1 |
| GT recipes | order of 10⁵ (**UNVERIFIED**) | see below |
| Item variants | tens of thousands up to ~150 k (**UNVERIFIED**) | NESQL's client export reports "~150k exported images" for GTNH (https://github.com/D-Cysteine/nesql-exporter, README) |

The GT estimate comes from a third-party client exporter that reports "226k+ 配方" (recipes) over "129 种 handler 类型" (handler types), meaning every NEI handler in GTNH (https://github.com/Nydixia233/NEIRecipeExporter, README). Removing ~64 k crafting recipes leaves well over 100 k, most of them GT.

With item indices and fluid names, a GT recipe line is roughly 100–200 bytes, so 150 k recipes come to ~15–30 MB raw. The total for all files is around 30–60 MB raw, or **~5–10 MB gzip'd** (typical 6–10× for this kind of JSON). That is small enough to load fully into the planner. Replace these estimates with `manifest.json` counts after the first run.

### 6.5 What the planner derives, not the exporter

- **Electric furnace / microwave recipes** from `recipes-furnace` for maps marked `"dynamic":"overwrite"` (§2.2). Maps marked `fallback` or `modify` (printer, unpackager, fluid canner, forming press, assembler) have a static list plus lookup-time extras. Treat them as "static list only" unless a missing recipe shows up.
- **Recipes in several maps:** merge them by content and keep every map (prior-art T10).
- **Overclocking:** GT's `gregtech.api.util.OverclockCalculator` is a plain calculator (`setRecipeEUt`, `setEUt`, `setDuration`, `setAmperage`, `setHeatOC`, `setRecipeHeat`, `setMachineHeat`, `enablePerfectOC`, `calculate()`, `getConsumption()`, `getDuration()`). The exporter could precompute per recipe × tier if the planner's own implementation needs a reference to test against. That is optional and **UNVERIFIED** in this role.

---

## 7. Open items

- **UNVERIFIED until the first run:**
  - fresh-world boot time and export time;
  - clean JVM exit under lwjgl3ify;
  - whether code-generated maps list any recipes;
  - which mods' display names fail on a server;
  - whether the server reads `NEIRecipeOwner` from `Client.cfg`;
  - real counts and sizes;
  - FLAT world compatibility;
  - whether NEI's `catalysts.csv` adds GT-map catalysts beyond GT's own loop (§3.4, added by reviewer).
- **First-run checklist:**
  1. `EXPORT_OK` present and exit code 0.
  2. `counts.recipesGt` > 0 and `recipeMaps` ≥ 140.
  3. `nameFailures` small, and spot names match NEI: Electric Blast Furnace, Iron Dust, Molten Iron.
  4. Every `mID` from the world scan exists in `machines`.
  5. Cleanroom recipes carry `meta.cleanroom = true`.
  6. A programmed-circuit input has amount 0.
  7. The live server's log shows nothing unusual during the run.
- **Not covered here:** icons and textures (a client topic; see prior-art T11), and power/overclock formulas (their own research topic).

---

## Appendix A. Exporter skeleton (compile-verified excerpts)

The skeleton has three classes:

- `ExporterMod` (`@Mod`, trigger);
- `ExportTrigger` (tick counter, markers, shutdown);
- `Exporter` (writers).

It compiles with the files in §1.4. The excerpts below show the load-bearing calls; the full source is kept locally (path in the local notes).

```java
@Mod(modid = "gtnhplannerexport", name = "GTNH Planner Exporter", version = Tags.VERSION,
     acceptableRemoteVersions = "*", dependencies = "required-after:gregtech")
public class ExporterMod {
    @Mod.EventHandler
    public void onServerStarted(FMLServerStartedEvent event) {
        String dir = System.getProperty("gtnhplanner.exportDir");
        if (dir == null || dir.isEmpty()) return;                       // inert in a normal server
        FMLCommonHandler.instance().bus().register(new ExportTrigger(new File(dir)));
    }
}

// ExportTrigger.onServerTick: after 100 END ticks → new Exporter(dir).runAll(); write EXPORT_OK/EXPORT_FAILED;
// then MinecraftServer.getServer().initiateShutdown();

// GT recipe maps and recipes
for (RecipeMap<?> map : RecipeMap.ALL_RECIPE_MAPS.values()) {
    BasicUIProperties ui = map.getFrontend().getUIProperties();
    String dynamic = map.getBackend().doesOverwriteFindRecipe() ? "overwrite" : /* else reflect: declares findFallback → "fallback", modifyFoundRecipe → "modify" */ null;
    for (GTRecipe r : map.getAllRecipes()) {
        stacks(w, r.mInputs, r.mInputChances);      // [idx, stackSize(0 = NC), chance?]
        stacks(w, r.mOutputs, r.mOutputChances);
        fluids(w, r.mFluidInputs, r.mFluidInputChances);
        fluids(w, r.mFluidOutputs, r.mFluidOutputChances);
        // r.mEUt, r.mDuration, r.mSpecialValue, r.mEnabled, r.mHidden, r.mFakeRecipe, r.mAltFluidInputs,
        // ((GTRecipe.GTRecipe_WithAlt) r).mOreDictAlt, r.getRecipeCategory().unlocalizedName
        for (Map.Entry<RecipeMetadataKey<?>, Object> e : r.getMetadataStorage().getEntries()) { /* identifier → value */ }
    }
}

// Machines
IMetaTileEntity[] mtes = GregTechAPI.METATILEENTITIES;
for (int id = 0; id < mtes.length; id++) {
    IMetaTileEntity mte = mtes[id]; if (mte == null) continue;
    mte.getMetaName(); mte.getLocalName(); mte.getStackForm(1);
    if (mte instanceof MTETieredMachineBlock) { byte tier = ((MTETieredMachineBlock) mte).mTier; long v = GTValues.V[tier]; }
    if (mte instanceof RecipeMapWorkable) ((RecipeMapWorkable) mte).getAvailableRecipeMaps();
    if (mte instanceof MTECable) { MTECable c = (MTECable) mte; /* c.mVoltage, c.mAmperage, c.mCableLossPerMeter */ }
}

// Crafting, furnace, items
for (Object o : CraftingManager.getInstance().getRecipeList()) { IRecipe r = (IRecipe) o; /* instanceof ShapedOreRecipe … */ }
Map<?, ?> smelt = FurnaceRecipes.smelting().getSmeltingList();   // xp: FurnaceRecipes.smelting().func_151398_b(out)
for (Item item : GameData.getItemRegistry().typeSafeIterable()) {
    if (item instanceof MetaGeneratedItem) { MetaGeneratedItem g = (MetaGeneratedItem) item;
        for (int i = 0; i < g.mEnabledItems.length(); i++)
            if (g.mEnabledItems.get(i) && g.mVisibleItems.get(i)) item(new ItemStack(item, 1, g.mOffset + i)); }   // item() interns
}
```

## Appendix B. Helper scripts used (local only)

These were run with `python3 -I`. They are kept in the session scratch folder and listed in the local notes:

- `jargrep.py`: byte-string search across the class files of jars.
- `classhier.py`: superclass and interface index of all mod jars, used for §3.3 and §4.1.
- An init script printing each Gradle task's toolchain (§1.4).
