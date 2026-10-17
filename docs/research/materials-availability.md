# Materials availability: ore, fluid and planet sources in GTNH 2.9.0-RC-1

Date: 2026-10-17 · Scope: GT New Horizons 2.9.0-RC-1 server pack (gregtech 5.09.54.183, Galacticraft 3.4.34-GTNH, GalaxySpace 1.1.142-GTNH, AmunRa-GC 0.8.14, visualprospecting 1.5.41, BetterQuesting 3.8.87-GTNH) · Status: research reference for spec §3.3b ("Where materials come from")

The spec says a base material is free only if the group can reach a place that has it at their current tier. This page answers eight questions to make that work:

1. Where the pack defines each ore source per dimension.
2. Which non-ore sources make basic fluids dimension-gated.
3. Where ore-processing byproduct lists live.
4. Which dimension ID is which planet.
5. What it takes to reach each dimension.
6. How to tell from a save which dimensions the group has been to.
7. What VisualProspecting stores.
8. A recommended availability model, the export it needs, and default and override rules.

It complements [export-mod.md](export-mod.md) (the exporter mod and its output format), [world-format.md](world-format.md) (save files), [gt-mechanics.md](gt-mechanics.md) and [prior-art.md](prior-art.md). Anything that belongs to one particular world (counts, which quests are done, folder IDs) is kept in `docs/local/research-ores.md`, which is never committed.

## How to read the evidence

- `PACK` means the server pack folder, opened read-only. `GT` is `$PACK/mods/gregtech-5.09.54.183.jar`, `GC` is `Galacticraft-3.4.34-GTNH.jar`, `GS` is `GalaxySpace-1.1.142-GTNH.jar`, `AR` is `AmunRa-GC-0.8.14.jar`, `VP` is `visualprospecting-1.5.41.jar` and `FORGE` is the Forge universal jar. `J` means JDK 25 `javap`. `DQ` means `$PACK/config/betterquesting/DefaultQuests`. `BACKUP` means a world backup zip from `$PACK/backups/`.
- **sim** means a symbolic stack simulation of a static initializer, run over `J -c -p -constants` output (scratch script `jvmsim.py`). It records every builder call (`name`, `heightRange`, `enableInDim`, …) per enum constant. The vein tables on this page come from it. No game code was run, and no server was started.
- World files were read only from a backup zip or, for small non-region files, in place and read-only. Scripts and raw outputs are in the session scratch folder. The local notes list them, and they are not committed.
- **UNVERIFIED** marks a claim that could not be checked against the jars, configs or data.

## TL;DR

1. **One registry holds every ore vein in 2.9, including BartWorks and GT++ veins.** It is the enum `gregtech.api.enums.OreMixes` (122 veins). Small ores are the enum `SmallOres` (55, one disabled by default). At load, `GTWorldgenloader` turns them into `WorldgenGTOreLayer.sList` and `WorldgenGTOreSmallPieces.sList`. Only enabled entries reach those lists, so at runtime they hold 122 veins and 54 small ores (*Corrected by reviewer*, §1.1). The old BartWorks and GT++ layer classes are gone. Ross128 and Toxic Everglades veins are plain enum entries. There is no per-vein config. §1.1
2. **Allow-lists are dimension *names*, not IDs.** Examples are `Overworld`, `moon`, `ross128b`, `iojupiter` and `dimensionDarkWorld`. They are kept in `OreMixBuilder.dimsEnabled` and `WorldgenGTOreLayer.getAllowedDimensions()`. GT gives a world its name from the Galacticraft body name (lower-cased), or else from `WorldProvider.getDimensionName()`. The End is split in two. Within 16 chunks of 0,0, or near HEE and Chaos islands, the `The End` list applies. Everywhere else in DIM 1 the `EndAsteroid` list applies. §1.2–1.3
3. **The rocket tier of every body is in code.** Moon 1. Mars, Phobos, Deimos 2. Asteroids, Ceres, Europa, Ganymede, Callisto, Ross128b 3. Io, Venus, Mercury 4. Enceladus, Titan, Miranda, Oberon, Ross128ba 5. Proteus, Triton 6. Pluto, Kuiper Belt, Haumea, Makemake 7. Barnard C/E/F, α Centauri Bb, T Ceti E, Vega B 8. The AmunRa bodies get 9, from config. Rockets cannot land on gas giants. A rocket of tier *t* may go to a body whose required tier is ≤ *t*. GT's own NEI ore plugin labels dimensions with the same tiers (T0…T10, with the Deep Dark as T10). §5.1
4. **The quest book ties rocket tiers to voltage tiers.** T1 is HV, T2 EV, T3 and T4 IV, and T5 LuV. T6 is ZPM with the GT++ assembler, otherwise UV. T7 is UV, T8 UHV, and AmunRa (mothership) UEV. (*Corrected by reviewer*: this said UHV. The quest that sends players to AmunRa, "The Final Frontier!", sits in the Tier10UEV line. The mothership can already be built at UHV. See §5.2.) Other dimensions: Nether at Steam, Twilight Forest at LV, the End (including End asteroids) at HV, Toxic Everglades at ZPM, and the Deep Dark at UIV, where ores come out only through a void miner. §5.2–5.3
5. **Several non-ore sources are dimension-gated:**
   - Underground fluids come from `config/GregTech/UndergroundFluids.cfg`. Oil and natural gas are in the Overworld only. Helium-3 is on the Moon, Mercury and Ross128ba, and so on.
   - Air depends on the dimension: Nether Air comes only from the Nether, and Toxic Air only from the Toxic Everglades.
   - Gas siphons work on gas-giant space stations (IV and up).
   - The Space Elevator pump module runs at UHV and up.
   - Void miners run at LuV and up. Each one draws only from its own dimension's veins, except in the Deep Dark, where it draws from every ore.
   - The Space Elevator mining modules run at UV, UHV and UEV.

   §1.6–1.7, §2
6. **Byproduct lists exist for GT and BartWorks materials.**
   - GT: `Materials.mOreByProducts`.
   - BartWorks: `Werkstoff.getOreByProduct(i, prefix)`.
   - GT++: derived from material composition.

   The exported ore-processing recipes should still be the ground truth for propagation. §3
7. **Recipes can be location-gated too.** A low-gravity GT recipe runs in a singleblock only inside a space station, the Asteroids dimension or a mothership. The check is on the provider class name. §5.4
8. **A region file in a save does not prove a visit.** Dimensions can hold chunks that were generated at world creation and never inhabited. Use `Level.InhabitedTime > 0`, completed BetterQuesting location and rocket quests, player spawns and portals, and team prospecting data. §6
9. **VisualProspecting keeps two different things:**
   - The **server cache** (`visualprospecting/server/World_<id>/DIM<n>.dat`, gzip NBT v3) lists every vein generated or rescanned in that world. Use it for "where is X", not for "what we found". (*Corrected by reviewer*: "generated" covers only GT's normal vein pass. Asteroid-field ores, in the Far End asteroids, Asteroids, Kuiper Belt and Mehen Belt, are never recorded. See §7.1.)
   - **Team discoveries** (Base64 + GZIP blob in `World/gtnhteams/<team>.json`) are what the group actually prospected.

   Both were decoded read-only to confirm the format. §7
10. **Recommendation.** Compute availability as a fixpoint over the exported recipes, restricted to the current tier:
    - Seeds come from the reachable dimensions: ores, small ores, underground fluids, air and other dimension sources.
    - Capabilities unlocked at the tier are added: void miner, Space Elevator modules, gas siphon.
    - Reachable dimensions are the tier default (§8.2), plus visited dimensions, plus or minus a per-project checklist.

    Base items are leaves only when their material is mined directly or as a byproduct. Anything not in the fixpoint is not a leaf, and the planner names what unlocks it. The exporter needs ten more files (§8.5).

---

## 1. Ore sources per dimension

### 1.1 One registry for GT, BartWorks and GT++ ores

- **Veins and small ores are two enums that GT registers at load.**
  - Evidence: `J -cp $GT -c -p gregtech.loaders.postload.GTWorldgenloader | grep -E 'OreMixes|SmallOres'` printed:
    - `getstatic … Field gregtech/api/enums/OreMixes.VALUES`
    - `invokevirtual … OreMixes.addGTOreLayer:()Lgregtech/common/WorldgenGTOreLayer;`
    - `invokestatic … SmallOres.values`
    - `invokevirtual … SmallOres.addGTSmallOre:()Lgregtech/common/WorldgenGTOreSmallPieces;`
  - The constructors add a layer to the static `sList` **only when it is enabled**. `J -p gregtech.common.WorldgenGTOreLayer` shows `public static final java.util.ArrayList<gregtech.common.WorldgenGTOreLayer> sList;`, and `WorldgenGTOreSmallPieces` has `public static final java.util.List<…> sList;`.
  - **Corrected by reviewer** (this used to say that every layer is added):
    - `J -c gregtech.api.world.GTWorldgen` shows the constructor `GTWorldgen(String, List, boolean)` doing `getfield mEnabled; ifeq 40` around `List.add`. `WorldgenGTOreLayer.<init>` passes its own `sList` to it.
    - `WorldgenGTOreSmallPieces.<init>` passes `GregTechAPI.sWorldgenList` to that constructor. It then does `getfield mEnabled; ifeq 127` around `sList.add`.
    - No config is read first. `SmallOres.addGTSmallOre` is just `new WorldgenGTOreSmallPieces(smallOreBuilder)`.
    - So at runtime `WorldgenGTOreSmallPieces.sList` holds 54 small ores. The disabled `ore.small.infinity` exists only in the enum.
    - The jar has one other layer constructor call: `GTWorldgenerator`'s static placeholder `NoOresInVein`, built with `disabledByDefault()`. For the same reason it is not in `WorldgenGTOreLayer.sList`.
- **There are 122 veins and 55 small ores. One small ore is disabled by default, and no vein is.**
  - Evidence (on the `J -c -p -constants` dumps of the two enums):

    | Count | Result |
    |---|---|
    | `grep -c 'invokespecial.*OreMixBuilder."<init>"'` | 122 |
    | `grep -c 'invokespecial.*SmallOreBuilder."<init>"'` | 55 |
    | `SmallOreBuilder.disabledByDefault` | 1 |
    | `OreMixBuilder.disabledByDefault` | 0 |

  - The disabled one is `ore.small.infinity`, and it has no dimensions (sim).
- **BartWorks and GT++ veins are entries of the same enum.**
  - Evidence: counting material references in the `OreMixes` static initializer gave:

    | Material class | References |
    |---|---|
    | `bartworks/system/material/WerkstoffLoader.` | 52 |
    | `gtPlusPlus/core/material/MaterialsOres.` | 69 |
    | `gtPlusPlus/core/material/nuclear/MaterialsFluorides.` | 3 |
    | `gtPlusPlus/core/material/MaterialsElements$STANDALONE.` | 4 |
    | `gregtech/api/enums/Materials.` (the rest) | 397 |

  - The old layer classes are absent: `unzip -l $GT | grep -c -i -E 'BWOreLayer|BWWorldGenRoss|WorldGen_GT_Ore_Layer'` printed `0`.
  - The 20 Toxic Everglades veins and the Ross128 veins (for example `ore.mix.ross128.bismuth`, `ore.mix.ross128ba.tib`) are ordinary `OreMixes` constants (sim).
- **No config lists, adds or removes veins.**
  - `config/GregTech/WorldGeneration.cfg` (44 lines) has only global switches: `B:disableVanillaOres=true`, the `generate…Ores` stone switches and the `endasteroids {…}` block.
  - `GregTech.cfg` tunes vein placement globally: `I:oreveinPercentage=100`, `I:oreveinAttempts=64`, `B:oreveinPlacerOres=true`.
  - `GalacticGreg.cfg` has no per-dimension ore settings.
- **Every material in a vein implements one interface, `gregtech.api.interfaces.IOreMaterial`.**
  - Evidence: `J -p` shows `class gregtech.api.enums.Materials implements …,IOreMaterial`, `class bartworks.system.material.Werkstoff implements …,IOreMaterial` and `class gtPlusPlus.core.material.Material implements IOreMaterial`.
  - The interface has `getId()`, `getInternalName()`, `getDefaultLocalName()`, `getLocalizedName()`, `getPart(OrePrefixes, int)`, `getGTMaterial()` and `getValidStones()`.
- **The jar is multi-release, and the versioned classes hold the same data.**
  - `META-INF/MANIFEST.MF` has `Multi-Release: true` and `JvmDowngrader-Downgrade-Target: 52`.
  - `META-INF/versions/17/` carries its own copies of `DimensionDef` and `WorldgenGTOreLayer`.
  - `J --multi-release 17` versus the base class showed the same string and class constants (`DimensionDef`) and the same members (`WorldgenGTOreLayer`).

### 1.2 Which fields hold the dimension list and the materials

| Builder field (`OreMixBuilder`, public) | Runtime (`WorldgenGTOreLayer`) | Meaning |
|---|---|---|
| `oreMixName` (`name("ore.mix.…")`) | `mWorldGenName`, `getName()` | Vein name. VisualProspecting uses the same name (§7.1). |
| `enabledByDefault` | `mEnabled` | Always true in this pack |
| `dimsEnabled : Set<String>` | `getAllowedDimensions()` (private `mAllowedDimensions`) | **Dimension allow-list, by name** |
| `minY`, `maxY` (`heightRange`) | `veinHeight`, `getMinY(dim)`, `getMaxY(dim)` | Y range |
| `dimVeinHeights : Map<String, ShortShortPair>` (`heightRangeOverride`) | `dimVeinHeights` | Per-dimension Y override (for example the Twilight Forest coal vein uses 15–40 instead of 30–80) |
| `weight` | `mWeight`, `getWeight()` | Chance of this vein among the veins allowed in a dimension |
| `density` | `mDensity`, `getDensity()` | Ore density inside the vein |
| `size` | `mSize` | Vein size |
| `primary`, `secondary`, `between`, `sporadic` (`IOreMaterial`) | `mPrimary`, `mSecondary`, `mBetween`, `mSporadic` | The four materials |
| `stoneCategories` | private `mAllowedStone`, `canGenerateIn(IStoneCategory)`, `isStoneSpecific()` | Only the five "ice" veins (`nitrogenice`, `hydrocarbonice`, `carbonice`, `hhoice`, `sulfurice`) restrict stone (`StoneCategory.Ice`) |

- Evidence: `J -p gregtech.common.OreMixBuilder` shows these public fields:
  - `public java.util.Set<java.lang.String> dimsEnabled;`
  - `public java.util.Map<java.lang.String, it.unimi.dsi.fastutil.shorts.ShortShortPair> dimVeinHeights;`
  - `public int minY; public int maxY; public int weight; public int density; public int size;`
  - `public gregtech.api.interfaces.IOreMaterial primary;` and the same for `secondary`, `between`, `sporadic`.
- Evidence: `J -p gregtech.common.WorldgenGTOreLayer` shows `public final short mWeight; public final short mDensity; public final short mSize; public final …IOreMaterial mPrimary; …; private final java.util.Set<java.lang.String> mAllowedDimensions; public int getMinY(java.lang.String); … public java.util.Set<java.lang.String> getAllowedDimensions();`.
- Small ores (`SmallOreBuilder` → `WorldgenGTOreSmallPieces`):
  - `smallOreName` becomes `mWorldGenName`.
  - `enabledByDefault` becomes `mEnabled`.
  - `dimsEnabled` becomes `getAllowedDimensions()`.
  - `minY`/`maxY` become `mMinY`/`mMaxY`.
  - `amount` becomes `mAmount` (per chunk).
  - `ore` becomes `getMaterial()`.
  - Evidence: `J -p` of both classes. The constructor passes `SmallOreBuilder.enabledByDefault` to `GTWorldgen.<init>(String, List, boolean)`, which stores it in `mEnabled`.
- **How `enableInDim(DimensionDef…)` becomes a name.** It adds `modDimensionDef.getDimensionName()` to `dimsEnabled`. Evidence: `J -c gregtech.common.OreMixBuilder` shows `getfield dimsEnabled … getfield DimensionDef.modDimensionDef … invokevirtual ModDimensionDef.getDimensionName … Set.add`. The `enableInDim(String…)` overload adds the string as is (`"Overworld"`, `"Nether"`, `"The End"`, `"Twilight Forest"`).

### 1.3 Dimension names, the End split, and per-dimension flags

`galacticgreg.api.enums.DimensionDef` (43 constants) holds every dimension name GT ore generation knows. Its `DimNames` constants are:

```
OW="Overworld" NETHER="Nether" THE_END="The End" ENDASTEROID="EndAsteroid" TWILIGHT_FOREST="Twilight Forest"
EVERGLADES="dimensionDarkWorld" MOON="moon" MARS="mars" ASTEROIDS="asteroids" PLUTO="pluto" TRITON="triton"
PROTEUS="proteus" OBERON="oberon" TITAN="titan" ROSS128B="ross128b" ROSS128BA="ross128ba" CALLISTO="callisto"
GANYMEDE="ganymed" CERES="ceres" DEIMOS="deimos" ENCELADUS="enceladus" IO="iojupiter" EUROPA="europa"
PHOBOS="phobos" VENUS="venus" MERCURY="mercury" MAKEMAKE="makemake" HAUMEA="haumea" CENTAURIBB="centauribb"
VEGAB="vega1" BARNARDC="barnarda2" BARNARDE="barnarda4" BARNARDF="barnarda5" TCETIE="tcetie" MIRANDA="miranda"
KUIPERBELT="kuiperbelt" NEPER="neper" MAAHES="maahes" ANUBIS="anubis" HORUS="horus" SETH="seth"
MEHENBELT="asteroidbeltmehen" DEEPDARK="Underdark"
```
(Evidence: `J -p -constants 'galacticgreg.api.enums.DimensionDef$DimNames'`.)

- **How GT names a world.** `DimensionDef.getDimensionName(World)` first checks Galacticraft. If the provider is a `WorldProviderSpace`, it returns `getCelestialBody().getName()`. Otherwise it returns `world.provider.getDimensionName()`.
  - Evidence: `J -c galacticgreg.api.enums.DimensionDef` shows `instanceof …/WorldProviderSpace … getCelestialBody … CelestialBody.getName`, then the fallback `WorldProvider.func_80007_l` (`getDimensionName`).
  - Galacticraft lower-cases body names. The `CelestialBody(String)` constructor calls `String.toLowerCase(Locale)` before `putfield bodyName` (`J -c -p … CelestialBody` on `GC`). That is why GalaxySpace's `new Moon("ioJupiter")` becomes `iojupiter`.
- **The End holds two ore lists.** `DimensionDef.getEffectiveDefForChunk(world, cx, cz)` picks between them:
  - It keeps `TheEnd` when `cx*cx + cz*cz <= 256` (within 16 chunks of 0,0).
  - It also keeps `TheEnd` when `HEEIslandScanner.isWithinRangeOfIsland(cx, cz)` (Hardcore Ender Expansion) or `ChaosIslandLocator.isWithinRange(cx, cz, ChaosIslandExclusionRadius)` (Draconic Evolution) is true.
  - Everywhere else it returns `EndAsteroids`.
  - Evidence: `J -c … DimensionDef`: `iload_1 iload_1 imul iload_2 iload_2 imul iadd sipush 256 if_icmpgt`, the two locator calls, then `getstatic EndAsteroids`.
  - `EndAsteroid` is therefore a region of DIM 1, not a dimension of its own.
- **Some dimensions carry generation flags** (sim of the `DimensionDef` static initializer):
  - `Everglades` → `setOreVeinChance(66)`.
  - `Asteroids`, `KuiperBelt`, `MehenBelt` → `disableVoidMining()`.
  - `TheEnd` → `setGeneratesAsteroids(Worldgen.endAsteroids.generateEndAsteroids)` and `disableOreVeinHeightChecks()`.
  - `EndAsteroids`, `Asteroids`, `KuiperBelt`, `MehenBelt` have type `Asteroid`. Their veins are placed inside asteroids by `galacticgreg.WorldGeneratorSpace` through the same `IWorldgenLayer.getOre(float)`, and Y comes from the asteroid bounds (`AsteroidPropertyBuilder.asteroidYBounds`) instead of the vein's range.
  - `DeepDark` (`Underdark`) is defined with an empty chunk provider. No vein lists it (§1.6).

### 1.4 What the pack defines, per dimension

Vein and small-ore counts come from the sim. Rocket tiers come from code (§5.1). Default GT tiers come from the quest book (§5.2–5.3). Underground fluids come from config (§2.1).

| Ore-gen name | Shown as | DIM | Mod | Rocket tier | Default GT tier | Veins | Small ores | Underground fluids (config) |
|---|---|---|---|---|---|---|---|---|
| `Overworld` | Overworld | 0 | vanilla | — | ULV | 21 | 11 | natural gas, light, medium, heavy oil, oil (20 % each) |
| `Nether` | Nether | -1 | vanilla | — | Steam/ULV | 11 | 13 | none (blacklisted) |
| `Twilight Forest` | Twilight Forest | 7 | TwilightForest | — | LV | 18 | 18 | none |
| `The End` | The End | 1 (centre, islands) | vanilla + HEE | — | HV | 7 | 8 | none (blacklisted) |
| `EndAsteroid` | Far End Asteroids | 1 (rest) | GT | — | HV | 13 | 6 | none |
| `moon` | Moon | 28 | Galacticraft | 1 | HV | 8 | 1 | helium-3 (83 %), salt water (17 %) |
| `mars` | Mars | 29 | GC Planets | 2 | EV | 14 | 15 | salt water, chlorobenzene |
| `phobos` | Phobos | 38 | GalaxySpace | 2 | EV | 12 | 10 | — |
| `deimos` | Deimos | 40 | GalaxySpace | 2 | EV | 10 | 11 | — |
| `asteroids` | Asteroids | 30 | GC Planets | 3 | IV | 13 | 8 | — |
| `ceres` | Ceres | 42 | GalaxySpace | 3 | IV | 13 | 11 | — |
| `europa` | Europa | 35 | GalaxySpace | 3 | IV | 5 | 0 | salt water, extra heavy oil, distilled water |
| `ganymed` | Ganymede | 43 | GalaxySpace | 3 | IV | 11 | 11 | — |
| `callisto` | Callisto | 45 | GalaxySpace | 3 | IV | 9 | 10 | oxygen, liquid air |
| `ross128b` | Ross128b | 64 | BartWorks | 3 | IV | 10 | 0 | extra heavy oil, lava, natural gas, distilled water |
| `iojupiter` | Io | 36 | GalaxySpace | 4 | IV | 13 | 15 | molten lead, sulfuric acid, CO₂ |
| `venus` | Venus | 39 | GalaxySpace | 4 | IV | 14 | 14 | molten lead, sulfuric acid, CO₂ |
| `mercury` | Mercury | 37 | GalaxySpace | 4 | IV | 11 | 13 | helium-3, molten iron |
| `enceladus` | Enceladus | 41 | GalaxySpace | 5 | LuV | 9 | 11 | — |
| `titan` | Titan | 44 | GalaxySpace | 5 | LuV | 14 | 12 | methane, ethane |
| `miranda` | Miranda | 86 | GalaxySpace | 5 | LuV | 10 | 6 | `liquid_hydricsulfur` |
| `oberon` | Oberon | 46 | GalaxySpace | 5 | LuV | 9 | 10 | carbon monoxide |
| `ross128ba` | Ross128ba | 63 | BartWorks | 5 | LuV | 8 | 0 | salt water, helium-3 |
| `dimensionDarkWorld` | Toxic Everglades | 227 | GT++ (in the gregtech jar) | — (portal) | ZPM | 20 (66 % vein chance) | 0 | none |
| `proteus` | Proteus | 47 | GalaxySpace | 6 | ZPM | 12 | 14 | deuterium |
| `triton` | Triton | 48 | GalaxySpace | 6 | ZPM | 11 | 12 | nitrogen, ethylene |
| `pluto` | Pluto | 49 | GalaxySpace | 7 | UV | 15 | 14 | nitrogen, oxygen, liquid air, fluorine |
| `kuiperbelt` | Kuiper Belt | 33 | GalaxySpace | 7 | UV | 17 | 10 | — |
| `haumea` | Haumea | 83 | GalaxySpace | 7 | UV | 12 | 11 | — |
| `makemake` | Makemake | 25 | GalaxySpace | 7 | UV | 13 | 12 | hydrofluoric acid |
| `centauribb` | α Centauri Bb | 31 | GalaxySpace | 8 | UHV | 13 | 0 | molten copper |
| `barnarda2` | Barnard C | 32 | GalaxySpace | 8 | UHV | 10 | 0 | extra heavy oil, `unknowwater` |
| `barnarda4` | Barnard E | 81 | GalaxySpace | 8 | UHV | 13 | 8 | liquid air |
| `barnarda5` | Barnard F | 82 | GalaxySpace | 8 | UHV | 16 | 10 | molten tin |
| `tcetie` | T Ceti E | 85 | GalaxySpace | 8 | UHV | 14 | 3 | extra heavy oil, hydrogen, distilled water |
| `vega1` | Vega B | 84 | GalaxySpace | 8 | UHV | 17 | 9 | — |
| `neper`, `maahes`, `anubis`, `horus`, `seth`, `asteroidbeltmehen` | AmunRa bodies | 90, 91, 92, 93, 94, 95 | AmunRa | 9 | UEV (*corrected by reviewer*, was UHV, §5.2) | 12, 11, 12, 13, 11, 12 | 0, 0, 1, 18, 2, 7 | — |
| `Underdark` | Deep Dark | 100 | ExtraUtilities | — ("T10" in NEI) | UIV | 0 | 0 | — (a void miner yields every ore, §1.6) |

**Example: what a tier-1 rocket opens (the Moon).** These are its 8 veins (sim):

| Vein | Weight | Y | Primary, secondary, between, sporadic |
|---|---|---|---|
| `cassiterite` | 50 | 60–220 | Tin, Tin, Cassiterite, Tin |
| `copper` | 80 | 5–60 | Chalcopyrite, Iron, Pyrite, Copper |
| `bauxite` | 80 | 10–80 | Bauxite, Ilmenite, Aluminium, Ilmenite |
| `monazite` | 30 | 20–40 | Bastnasite, Bastnasite, Monazite, Neodymium |
| `molybdenum` | 5 | 20–50 | Wulfenite, Molybdenite, Molybdenum, Powellite |
| `galena` | 40 | 5–45 | Galena, Galena, Silver, Lead |
| `titaniumchrome` | 16 | 10–70 | Ilmenite, Chromite, Uvarovite, Perlite |
| `quartzspace` | 20 | 40–80 | Quartzite, Barite, CertusQuartz, CertusQuartz |

The Moon also has one small ore, meteoric iron (Y 50–70).

This matches the quest book's HV goal: "HV is about getting to the moon so you can get Titanium" (quest #162, Tier3HV). Appendix A lists every ore material by the first default tier whose dimensions contain it.

### 1.5 Exporter: dumping veins, small ores and dimensions

Everything below is readable on a headless server copy after `FMLServerStartedEvent`, the trigger [export-mod.md §5.6](export-mod.md) already uses. No dimension other than the ones the server loads anyway needs to be loaded. A sketch:

```java
// veins
for (WorldgenGTOreLayer l : WorldgenGTOreLayer.sList) {
  w.name(l.mWorldGenName).enabled(l.mEnabled).weight(l.mWeight).density(l.mDensity).size(l.mSize);
  for (String dim : l.getAllowedDimensions()) w.dimY(dim, l.getMinY(dim), l.getMaxY(dim));
  w.mats(key(l.mPrimary), key(l.mSecondary), key(l.mBetween), key(l.mSporadic)).stoneSpecific(l.isStoneSpecific());
}
// small ores
for (WorldgenGTOreSmallPieces s : WorldgenGTOreSmallPieces.sList)
  w.name(s.mWorldGenName).enabled(s.mEnabled).y(s.mMinY, s.mMaxY).amount(s.mAmount)
   .dims(s.getAllowedDimensions()).mat(key(s.getMaterial()));
// material key: family prefix + internal name, so GT, BartWorks and GT++ names never collide
static String key(IOreMaterial m) {
  return (m instanceof Materials ? "gt:" : m instanceof Werkstoff ? "bw:" : "gtpp:") + m.getInternalName();
}
// dimensions: never DimensionManager.getProvider(id), which dereferences a loaded world
for (int id : DimensionManager.getStaticDimensionIDs()) {
  WorldProvider p = DimensionManager.createProviderFor(id);           // instantiates, no world needed
  String gtName = (p instanceof WorldProviderSpace)
      ? ((WorldProviderSpace) p).getCelestialBody().getName()         // same rule as DimensionDef.getDimensionName
      : p.getDimensionName();
  ModDimensionDef def = DimensionDef.getDefByName(gtName);            // null when GT has no ores there
  w.dim(id, p.getClass().getName(), gtName, def == null ? null : def.getDimensionType(),
        def == null ? null : def.getOreVeinChance(), def != null && def.canBeVoidMined());
}
// celestial bodies: GalaxyRegistry.getRegisteredPlanets/Moons/Satellites()
//   -> getName(), getUnlocalizedName(), getTierRequirement(), getDimensionID(), getReachable(), parent
```

- **Why not `getProvider`.** `DimensionManager.getProvider(int)` is `getWorld(id).provider`, while `createProviderFor(int)` instantiates the provider class and calls `setDimension(id)`.
  - Evidence: `J -c net.minecraftforge.common.DimensionManager` on `FORGE` shows `getProvider: invokestatic getWorld … getfield …provider`, and `createProviderFor: providers.get(getProviderType(id)) … Class.newInstance … setDimension`.
- **Wrap each provider in try/catch.** Mod providers may misbehave without a world (**UNVERIFIED** per mod).
- **`sList` holds only enabled layers** (*corrected by reviewer*, §1.1). `s.mEnabled` is therefore always true in the loop above, and the loop sees 54 small ores. To list the disabled `ore.small.infinity` as well, iterate `SmallOres.values()` and read the public `smallOreBuilder` field (`enabledByDefault`, `dimsEnabled`, `ore`, `amount`, `minY`, `maxY`).
- **Labels and a cross-check.** Also dump GT's NEI ore plugin registry `gtneioreplugin.util.DimensionHelper.REGISTRY`, which is public and static. Each entry has the full name, internal (ore-gen) name, trimmed name, abbreviation, tier key and stone types (§5.1).
- **A ready-made CSV exists but is client-only.** The NEI plugin can write `GTNH-Oresheet.csv` and `GTNH-Small-Ores-Sheet.csv` (`config/gtneioreplugin.cfg`, `B:printCsv=false`). It does so only on a client: `GTNEIOrePlugin.onLoadComplete` checks `event.getSide() == Side.CLIENT && Config.printCsv` before `new CSVMaker().run()`. Use it as an independent check, not as the export.
- **Vein names match VisualProspecting.** VP stores the same names as `OreMixes`. In a decoded server cache, every Overworld, Nether and Twilight Forest vein name appeared in the sim's vein list: 21, 11 and 18 types, which is all the veins those dimensions allow.

### 1.6 Void miners and the Deep Dark

- **Drop maps are built from the same layers.** `bwcrossmod.galacticgreg.VoidMinerUtility.generateDropMaps()` iterates `WorldgenGTOreLayer.sList` (only `mEnabled` layers). For each allowed dimension where `DimensionDef.getDefByName(dim).canBeVoidMined()`, it adds:
  - `mPrimary` and `mSecondary` at weight `mWeight`;
  - `mBetween` and `mSporadic` at `mWeight / 8f`;
  - each small ore at weight `mAmount`.
  - The result is `dropMapsByDimName : Map<String, DropMap>`.
  - Evidence: `J -c` of the class shows `getfield mWeight; i2f; addDrop` for the primary and secondary, `ldc 8.0f; fdiv; addDrop` for the sporadic and in-between, and `getfield WorldgenGTOreSmallPieces.mAmount; i2f; addDrop` for small ores.
  - It runs at `FMLLoadCompleteEvent` (`bartworks.MainMod.onModLoadingComplete` → `VoidMinerUtility.generateDropMaps`), so the maps exist when an exporter runs.
- **A void miner reads the map of the world it stands in.** `MTEVoidMinerBase.calculateDropMap()` (run on its first tick) does `DimensionDef.getDefForWorld(world)` and then `dropMapsByDimName.getOrDefault(def.getDimensionName(), new DropMap())`, plus `extraDropsByDimName` (`J -c`). In DIM 1 that is the `The End` map, not `EndAsteroid`, because `getDefForWorld` uses the world's name, not the per-chunk split of §1.3.
- **Consequence.** In ordinary dimensions a void miner yields only that dimension's own vein and small-ore materials, plus `extraDropsByDimName`. It adds availability only in a dimension that is already reachable.
- **Three dimensions cannot be void-mined:** Asteroids, Kuiper Belt and Mehen Belt (`disableVoidMining`, §1.3).
- **The Deep Dark is the exception.** `VoidMinerLoader` adds every GT, BartWorks and GT++ material that has an ore to the dimension name `"Underdark"`.
  - Evidence: `J -c … VoidMinerLoader` shows `ldc "Underdark" … addMaterialToDimensionList` inside loops over `Materials.getAll()`, `Werkstoff.werkstoffHashSet` and `gtPlusPlus…Material.mMaterialMap`.
  - The weights come from `GregTech.cfg` `voidminers { "Deep Dark GT/BW/GT++ Ore Weights" }`. All three lists are empty in this pack, which means weight 1 for everything.
  - Quest #2413 "The Darkness of Choice for Edgelords" (Tier11UIV): "…every ore imaginable… You'll need to use a Void Miner to get them out… If there is ever an ore that you need but cannot find, it's guaranteed to be gatherable from this dimension."
- **Minimum tiers.** Void Miner I, II and III need LuV, ZPM and UV. `MTEVoidMinerBase.getMinTier()` returns `TIER_MULTIPLIER + 5`. The base constructor stores `TIER_MULTIPLIER = max(arg4, 1)`, and `VMLUV`, `VMZPM` and `VMUV` pass 1, 2 and 3 as `arg4` (`J -c` of each class). Their English names are "Void Miner I/II/III" (GT `en_US.lang`).

### 1.7 Space mining (Space Elevator miner modules)

- **Recipes.** Space-mining recipes are a real GT recipe map, `gtnhintergalactic.recipe.IGRecipeMaps.spaceMiningRecipes`. Their metadata keys are `MODULE_TIER` and `SPACE_MINING_DATA`, so the recipe exporter already captures them.
- **Source list.** The source definitions are `SpaceMiningRecipes.uniqueAsteroidList` (`AsteroidData`: `outputs`/`output`+`orePrefixes`, `chances`, `requiredModuleTier`, `minDroneTier`, `maxDroneTier`, `minDistance`, `maxDistance`, `computation`, `recipeWeight`). `addAsteroids()` defines **43 asteroid types**. The parameter names come from the `LocalVariableTable` of `addRecipesToDrones`: `asteroidName, aItemInputs, aFluidInputs, aChances, ores, orePrefixes, minSize, maxSize, minDistance, maxDistance, computationRequiredPerSec, minModuleTier, duration, EUt, startDroneTier, endDroneTier, recipeWeight`.
- **Module tiers.** Mining modules MK-I, MK-II and MK-III have `MODULE_VOLTAGE_TIER` 8, 9 and 10, which is UV, UHV and UEV (`J -p -constants …TileEntityModuleMiner$TileEntityModuleMinerT1/T2/T3`). The Space Elevator quest (#3283) is in Tier8UV.
- **Outputs no vein or small ore provides.** Some asteroid outputs appear in no ore list at all (sim, compared with every vein and small-ore material): Americium, Barium, Cheese, Cobalt, Electrum Flux, Europium, Holmium, Ichorium, Indium, Lutetium, Magnesium, Manyullyn, Phosphate, Rhodium, Ruthenium, Shadow, Silicon (solar grade), Strontium, Tantalum, Tellurium, Thaumium, Thulium, Void, Ytterbium, the naquadah earths, orundum, GT++ Koboldite and rare-earth mixes. **Most of these are also made chemically**, for example Cobalt from Cobaltite, Tantalum from Tantalite, Europium from monazite processing and Rhodium/Ruthenium from the platinum line. Only the recipe fixpoint (§8.1) can tell which are truly space-only.

### 1.8 Ore sources to ignore by default

| Source | Setting | Where |
|---|---|---|
| Galacticraft's own ores | `"Enable Copper/Tin/Aluminum/Silicon Ore Gen"=false`, `"Disable Cheese/Tin/Copper Ore Gen on Moon"=true` | `config/Galacticraft/core.conf` |
| Galacticraft's own Mars ores | `"Disable Iron/Copper/Tin/Desh Ore Gen on Mars"=true` | `config/Galacticraft/planets.conf` |
| GalaxySpace ores | `B:enableOresGeneration=false` | `config/GalaxySpace/core.conf` |
| AmunRa ores | `B:generateOres=false` | `config/GalacticraftAmunRa.cfg` |

- The Toxic Everglades also places vanilla ore blocks (coal, iron, gold, redstone, diamond, lapis) through `toxiceverglades.biome.CustomBiomeGenerator` → `WorldGenMinableCustom` (`J -c`). These are minor and already available elsewhere.
- The ThaumicTinkerer bedrock dimension (DIM 60, KAMI) spawns ore-dictionary ores: `"Bedrock Dimension ore density"=1`, blacklist `oreFirestone`. Which GT ores can appear there is **UNVERIFIED**. Ignore it by default.

---

## 2. Non-ore sources of base fluids

### 2.1 Underground fluids (Fluid Drilling Rigs)

- **Source.** The table in §1.4 comes from `config/GregTech/UndergroundFluids.cfg`. It has one block per dimension (`S:Dimension=…`) with fluids, each with `I:Chance` (a weight), `MinAmount`, `MaxAmount`, `DecreasePerOperationAmount` and `S:Registry`.
  - Evidence: the file starts `undergroundfluid { I:DimBlackList < -1 1 > overworld { S:Dimension=0 naturalgas { I:Chance=20 … S:Registry=gas_natural_gas } …`. A read-only parse (`parse_uf.py`) gives 22 dimension blocks: `overworld`, `moon`, `mercury`, `venus`, `mars`, `io`, `europa`, `callisto`, `titan`, `miranda`, `oberon`, `triton`, `proteus`, `pluto`, `makemake`, `alphacentauribb`, `barnardac`, `barnardae`, `barnardaf`, `tcetie`, `ross128b`, `ross128ba`.
- **How GT finds the entry for a dimension.** `GTUODimensionList.GetDimension(int id)` returns:
  1. nothing if `id` is blacklisted (-1, 1);
  2. the entry keyed `Integer.toString(id)` (only the Overworld uses an ID, `0`);
  3. otherwise the first entry whose `Dimension` string is **contained in the provider's class name** (`DimensionManager.getProvider(id).getClass().getName().contains(entry.Dimension)`);
  4. otherwise the entry `"Default"`, which this config does not have, so nothing.
  - Evidence: `J -c gregtech.api.objects.GTUODimensionList` shows `CheckBlackList`, `BiMap.containsKey(Integer.toString)`, `DimensionManager.getProvider … getClass … getName … String.contains`, `ldc "Default"`.
- **The live list.** The instance is `GTMod.proxy.mUndergroundOil` (`public final gregtech.api.objects.GTUODimensionList mUndergroundOil;` in `GTProxy`).
- **Exporter.** `GetDimension` needs a loaded world, through `getProvider`. Replicate it instead: iterate `getDimensionList().entrySet()` on the same instance, in the same order, and test the class name from `createProviderFor(id)`. Also dump `gtneioreplugin.util.GT5UndergroundFluidHelper.getAllEntries()`. It is built at load on both sides, maps each fluid to `(dimension, chance, max, min)`, and is what NEI shows.
- **Watch the substring rule.** The `Dimension` string `Ross128b` is a substring of the Ross128ba provider class name (`…WorldProviderRoss128ba`). Which entry wins for DIM 63 depends on map iteration order. That is **UNVERIFIED**, and only the runtime replication settles it.
  - **Reviewer note (resolved): DIM 63 gets its own `Ross128ba` entry.**
    - The map is `HashBiMap.create()` (`J -c` of the `GTUODimensionList` constructor).
    - The pack's only Guava is 17.0 (`libraries/com/google/guava/guava/17.0/guava-17.0.jar`). The `HashBiMap`, `HashBiMap$Itr` and `Hashing` classes bundled in `minecraft_server.1.7.10.jar` are byte-identical to it.
    - Guava 17's `HashBiMap` iterates by hash bucket, not by insertion order. The keys are the 22 `Dimension` strings, inserted in config-file order: Forge's `ConfigCategory.getChildren()` is `ImmutableSet.copyOf(children)` over an `ArrayList`.
    - Replaying those keys into a real Guava 17 `HashBiMap` gave `Ross128ba, BarnardaC, oberon, Io, Miranda, aCentauriBb, Titan, Mars, Europa, Venus, Moon, TCetiE, Pluto, Makemake, BarnardaF, Callisto, Ross128b, BarnardaE, 0, Proteus, Triton, Mercury`. `Ross128ba` also came before `Ross128b` in 40 of 40 random insertion orders.
    - Matching every provider class name in `$PACK/mods` against the keys found no other class with two matches. One side effect: the GalaxySpace station providers `WorldProviderMarsSS` and `WorldProviderVenusSS` match `Mars` and `Venus`, so those stations get the planet's fluids.
    - Keep the exporter's runtime replication as the regression check after pack updates.
- **Machines.** The Fluid Drilling Rig I, II, III and IV and the Infinite Fluid Drilling Rig (`gt.blockmachines.multimachine.oildrill1..4`, `…oildrillinfinite` in `en_US.lang`) need MV, HV, EV, IV and UHV. `getMinTier()` returns `iconst_2`, `iconst_3`, `iconst_4`, `iconst_5` and `bipush 9` in `MTEOilDrill1..4` and `MTEOilDrillInfinite`. For completeness, the Ore Drilling Plants (`MTEOreDrillingPlant1..4`) need MV to IV and mine whatever veins are below them.

### 2.2 Oil outside underground fluids

| Source | Setting | Where |
|---|---|---|
| Galacticraft oil | `D:"Oil Generation Factor"=0` (`"Oil gen in external dimensions" < 0 >`) | `config/Galacticraft/core.conf` |
| BuildCraft oil | `D:oilWellGenerationRate=0`, `B:spawnOilSprings=false` | `config/buildcraft/main.cfg` |
| GTNH core mod oil spheres | `I:OilDimensionWhitelist < 0 >` | `config/GTNewHorizons/dreamcraft.cfg` |

- The only oil-sand vein is `ore.mix.oilsand`, in the Overworld only (sim).
- **Crude oil, its light, medium and heavy fractions, and natural gas are Overworld resources.** The exceptions are extra-heavy oil and natural gas on some planets (§1.4), and the Space Elevator pump at UHV and up (§2.5).

### 2.3 Air

- **The GT++ Air Intake Hatch** (`MTEHatchAirIntake.getFluidToGenerate`) returns:
  - Toxic Air when the dimension ID equals `DimensionEverglades.DIMID`;
  - Nether Air in dimension -1;
  - plain Air everywhere else.
  - Evidence: `J -c` shows `getstatic …DimensionEverglades.DIMID … if_icmpne … Materials.ToxicAir … iconst_m1 if_icmpne … Materials.NetherAir … Materials.Air`.
- **Nether Air and Toxic Air are dimension-gated basic fluids.**
- **There is no "Ender Air" in this pack.** No class in any mod jar contains `EnderAir`, except an unrelated Botania bottle entity (scan of every jar in `$PACK/mods`).

### 2.4 Gas siphon (gas giants)

- **Placement.** The Planetary Gas Siphon (`gtnhintergalactic.tile.multi.MTEPlanetaryGasSiphon`) must stand in an `IOrbitDimension`, that is a space station. It looks up `GasSiphonRecipes.RECIPES` by `IOrbitDimension.getPlanetToOrbit()`.
  - Evidence: `J -c` shows `instanceof …IOrbitDimension … getPlanetToOrbit … GasSiphonRecipes.RECIPES`.
  - The quest text agrees: "You just need to build a space station around a gas planet… While operational, the multiblock needs d*4^(T+2) EU/t where T is the tier of the space station and d is the depth." (quest #3037 "Space Pumping", SpaceRace).
  - `GasSiphonRecipes.calculateEUt(d, T)` computes `d * (4 << (2T + 2))`, the same formula.
- **What each giant gives** (sim of `GasSiphonRecipes.addPumpingRecipes`; amounts per operation):

| Planet | Station tier | Depth 1 | Depth 2 | Depth 3 | Depth 4 |
|---|---|---|---|---|---|
| Jupiter | 3 | hydrogen 15000 | helium 500 | nitrogen 300 | oxygen 200 |
| Saturn | 5 | hydrogen 18000 | helium 800 | oxygen 500 | liquid oxygen 150 |
| Uranus | 5 | deuterium 5000 | neon 450 | argon 250 | krypton 100 |
| Neptune | 6 | tritium 3000 | helium-3 500 | ammonia 400 | xenon 350 |

- Station tiers come from `SolarSystemPlanets` (`setTierRequired` on `jupiterSpaceStation`, `saturnSpaceStation`, `uranusSpaceStation`, `neptuneSpaceStation`).
- **Nobody lands on a gas giant.** `canSpaceshipTierPass` returns `iconst_0` in `WorldProviderJupiter`, `Saturn`, `Uranus` and `Neptune` (`J -c` on `GS`).

### 2.5 Space Elevator pump module

- **Recipes.** `gtnhintergalactic.recipe.SpacePumpingRecipes.RECIPES` is a `Map<Pair<planetType, gasType>, FluidStack>`. It has planet types 2–8, for example:
  - 2: chlorobenzene;
  - 3: Ender goo, extra heavy oil, lava, natural gas;
  - 4: sulfuric acid, iron, oil, heavy, medium and light oil, lead, CO₂;
  - 5: CO, helium-3, salt water, helium, liquid oxygen, neon, argon, krypton, methane, hydrogen sulfide, ethane;
  - 6: deuterium, tritium, ammonia, xenon, ethylene;
  - 7: hydrofluoric acid, fluorine, nitrogen, oxygen;
  - 8: hydrogen, liquid air, copper, radon, tin, `unknowwater`.

  Evidence: sim of `addPumpingRecipes`.
- **Selection.** Planet type and gas type are machine parameters (`IntegerParameter` `planetType`, `gasType`), so no visit is needed. Whether a module tier limits the planet type is **UNVERIFIED**.
- **Module tiers.** Pump modules MK-I, MK-II and MK-III have `MODULE_VOLTAGE_TIER` 9, 10 and 13, which is UHV, UEV and UXV.

### 2.6 Pumps, free fluids, and which basic fluids are dimension-gated

- **Free fluids.** The spec makes water, air, cobblestone and lava free. BuildCraft pumps are allowed everywhere (`S:pumpDimensionControl=+/*/*,+/-1/lava`).
- **Candidate dimension-gated basic fluids:**
  - Overworld: crude oil and its fractions, natural gas;
  - Nether: Nether Air;
  - Toxic Everglades: Toxic Air;
  - Moon, Mercury, Ross128ba, the Neptune siphon and the pump module: helium-3;
  - Mars: chlorobenzene;
  - Titan: methane and ethane;
  - Miranda: hydrogen sulfide;
  - Proteus and the Uranus siphon: deuterium.
- **Many of these also have a chemical route**, for example deuterium from centrifuged hydrogen, chlorobenzene from benzene and chlorine, salt water from salt and water, and liquid air from air. Which fluids are *really* gated is a question for the recipe fixpoint (§8.1), not for this list. **UNVERIFIED** until the first export.

---

## 3. Ore-processing byproducts

- **GT.** `gregtech.api.enums.Materials.mOreByProducts : List<Materials>` is the resolved list.
  - `MaterialBuilder.addOreByproduct(Supplier<Materials>)` (used throughout `MaterialsInit`) fills `mPendingOreByproducts`.
  - `Materials.setOreByproducts()` resolves it, right after `MaterialsInit.load()` in the `Materials` static initializer.
  - Evidence: `J -c gregtech.api.enums.Materials` shows `invokestatic MaterialsInit.load; invokestatic setOreByproducts; …`. `setOreByproducts` maps `mPendingOreByproducts` through `Supplier.get`, keeps distinct values, and does `putfield mOreByProducts`.
  - Related public fields are `mOreMultiplier`, `mByProductMultiplier`, `mSmeltingMultiplier`, `mSmeltInto`, `mMacerateInto`, `mArcSmeltInto`, `mDirectSmelting`, `mOreReplacement` and `mOreReRegistrations`.
- **How GT's ore processing uses the list.** `ProcessingOre`, `ProcessingCrushedOre`, `ProcessingDirty`, `ProcessingPure` and `ProcessingDust` read `mOreByProducts` through `GTUtility.selectItemInList(index, material, list)`. That method returns:
  - the material itself if the list is null or empty;
  - the last entry if the index is too large;
  - the first entry if the index is negative.

  Evidence: `J -c gregtech.api.util.GTUtility` (`List.isEmpty … aload_1 areturn … List.size … isub … List.get`) and `J -c` of each `Processing*` class.
- **BartWorks.** `bartworks.system.material.Werkstoff` has a private `mOreByProducts : List<ISubTagContainer>`, exposed as `getNoOfByProducts()`, `getOreByProductRaw(int)` and `getOreByProduct(int, OrePrefixes)`. Its users are `werkstoff_loaders/recipe/CrushedLoader` and `RawOreLoader`.
- **GT++.** `gtPlusPlus.core.material.Material` has no byproduct list. `gtPlusPlus.xmod.gregtech.loaders.RecipeGenOre` derives byproducts from `Material.getComposites()` (`J -c` shows `getComposites`, `getCrushed`, `getDustImpure`, …).
- **Recommendation.** Use the exported ore-processing recipes (macerator, ore washer, thermal centrifuge, centrifuge, sifter, chemical bath, electrolyzer) as the ground truth for "byproduct of a reachable ore". Use the lists to explain a result ("Gallium: byproduct of Sphalerite ore") and as a cheap first pass. The lists alone miss GT++ and chemistry steps.

---

## 4. Dimension catalogue

IDs are config values, so the exporter must export them and the planner must not hard-code them. Sources: `config/Galacticraft/core.conf` and `planets.conf`, `GalaxySpace/dimensions.conf`, `GalacticraftAmunRa.cfg`, `bartworks.cfg`, `GTPlusPlus/GTPlusPlus.cfg`, `TwilightForest.cfg`, `ExtraUtilities.cfg`, `witchery.cfg`, `Thaumcraft.cfg`, `ThaumicTinkerer.cfg`, `ThaumicHorizons.cfg`, `gadomancy.cfg`, `RandomThings.cfg` and `personalspace.cfg`.

| DIM | Dimension | Mod | GT ores? | Config key |
|---|---|---|---|---|
| -1 | Nether | vanilla | yes | — |
| 0 | Overworld | vanilla | yes | — |
| 1 | The End (HEE) + Far End Asteroids | vanilla, HEE, GT | yes (two lists, §1.3) | — |
| 2 | Spectre dimension | RandomThings | no | `SpectreDimensionID=2` |
| 7 | Twilight Forest | TwilightForest | yes | `dimensionID=7` |
| 25 | Makemake | GalaxySpace | yes | `dimensionIDMakemake=25` |
| 28 | Moon | Galacticraft | yes | `idDimensionMoon=28` |
| 29 / 30 | Mars / Asteroids | Galacticraft Planets | yes | `dimensionIDMars=29`, `dimensionIDAsteroids=30` |
| 31, 32, 33 | α Centauri Bb, Barnard C, Kuiper Belt | GalaxySpace | yes | `dimensionIDCentauriBb`, `…BarnardaC`, `…KuiperBelt` |
| 35–49 | Europa 35, Io 36, Mercury 37, Phobos 38, Venus 39, Deimos 40, Enceladus 41, Ceres 42, Ganymede 43, Titan 44, Callisto 45, Oberon 46, Proteus 47, Triton 48, Pluto 49 | GalaxySpace | yes | `dimensionID<Name>` |
| 50 | Outer Lands | Thaumcraft | no | `outer_lands_dim=50` |
| 51, 71, 74, 77 | Uranus, Jupiter, Neptune, Saturn (gas giants, no landing) | GalaxySpace | no | `dimensionIDUranus`, `…Jupiter`, `…Neptune`, `…Saturn` |
| 55, 56, 70 | Spirit World (Dream), Torment, Mirror | Witchery | no | `DreamDimensionID`, `TormentDimensionID`, `MirrorDimensionID` |
| 60 | Bedrock dimension (KAMI) | ThaumicTinkerer | ore-dictionary ores, §1.8 | `"Bedrock dimension id"=60` |
| 63 / 64 | Ross128ba / Ross128b | BartWorks | yes | `ross128BAID=63`, `ross128BID=64` |
| 69 | Pocket Plane | ThaumicHorizons | no | `pocket_plane_dim=69` |
| 81–86 | Barnard E 81, Barnard F 82, Haumea 83, Vega B 84, T Ceti E 85, Miranda 86 | GalaxySpace | yes | `dimensionID<Name>` |
| 90–95 | Neper 90, Maahes 91, Anubis 92, Horus 93, Seth 94, Mehen Belt 95 | AmunRa | yes | `dimension_ids { … }` |
| 100 | Deep Dark (`Underdark`) | ExtraUtilities | void miner only | `deepDarkDimensionID=100` |
| 112 | Last Millenium | ExtraUtilities | no | `lastMilleniumDimensionID=112` |
| 173 | Eldritch mazes | Gadomancy | no | `dimOuterId=173` |
| 227 | Toxic Everglades | GT++ | yes | `EVERGLADES_ID=227` |
| dynamic | Space stations, motherships, spatial storage, personal dimensions | GC, GalaxySpace, AmunRa, AE2, personalspace | no ores; low gravity applies to stations and motherships, §5.4 | Provider IDs: GC Overworld station 27 (static 26). GalaxySpace stations Mars 34/80, Venus 87/88, Jupiter 72/73, Saturn 78/79, Uranus 52/53, Neptune 75/76. AmunRa mothership `-39`. AE2 `storageProviderID=-11`. Personal space from `firstDimensionId=180`. |

Notes:

- `idDimensionOverworldOrbit=27` is commented "WorldProvider ID for Overworld Space Stations" in `core.conf`. These numbers are provider types. Each station gets its own dimension ID when it is built.
- Every registered dimension gets a `DIM<n>` folder in the save, whether or not anyone went there ([world-format.md §1.2](world-format.md)).

---

## 5. Access gating

### 5.1 Rocket tier per body (code)

- **How a rocket's tier is checked.** `WorldUtil.getPossibleDimensionsForSpaceshipTier(tier, player)` lists the destinations whose `IGalacticraftWorldProvider.canSpaceshipTierPass(tier)` is true (`J -c micdoodle8.mods.galacticraft.core.util.WorldUtil`).
  - GalaxySpace planets (`WorldProviderSpaceGS`): `tier >= getCelestialBody().getTierRequirement()` (`iload_1 … getTierRequirement … if_icmplt`).
  - The Moon: `tier > 0` (`WorldProviderMoon`).
  - Mars: `tier >= 2` (`WorldProviderMars`: `iload_1 iconst_2 if_icmplt`).
  - Asteroids: `tier >= 3` (`WorldProviderAsteroids`: `iload_1 iconst_3 if_icmplt`).
  - Ross128b: `Ross128b.getTierRequirement() <= tier` (`WorldProviderRoss128b`).
  - Gas giants: always false (§2.4).
- **Required tiers.** Read from each `setTierRequired` call with `J -c -p -constants` on the registering classes, extracted by the scratch script `gc_tiers.py`:

| Tier | Bodies | Where it is set |
|---|---|---|
| 1 | Moon; Overworld space station | `GalacticraftCore` (`moon | Moon | tier=1`, `spaceStation.overworld | tier=1`) |
| 2 | Mars; Phobos, Deimos; Mars station | `MarsModule` (`mars | tier=2`), GS `SolarSystemPlanets` |
| 3 | Asteroids; Ceres; Europa, Ganymede, Callisto; Jupiter station; Ross128b | `AsteroidsModule`, `SolarSystemPlanets`, BartWorks `Ross128SolarSystem` static `iconst_3 → ross128btier` (`@Config.Ignore`, so it cannot be changed) |
| 4 | Io, Venus, Mercury; Venus station | `SolarSystemPlanets` (`ioJupiter | tier=4`, `venus | tier=4`, `mercury | tier=4`) |
| 5 | Enceladus, Titan, Miranda, Oberon; Saturn and Uranus stations; Ross128ba | `SolarSystemPlanets`; BartWorks static `iconst_5 → ross128batier` |
| 6 | Proteus, Triton; Neptune station | `SolarSystemPlanets` |
| 7 | Pluto, Kuiper Belt, Haumea, Makemake | `SolarSystemPlanets` (`bipush 7`) |
| 8 | Barnard C/E/F, α Centauri Bb, T Ceti E, Vega B | `BarnardsPlanets`, `ACentauriPlanets` (`bipush 8`), `TCetiPlanets`, `VegaPlanets` |
| 9 | Neper, Maahes, Anubis, Horus, Seth, Mehen Belt | `de.katzenpapst.amunra.AmunRa` uses `ARConfig.planetDefaultTier`, which `GalacticraftAmunRa.cfg` sets with `I:default_tier=9`. No GalaxySpace rocket goes above T8. AmunRa's motherships reach them (`maxMothershipTier=10`). |

- **GT's NEI ore plugin uses the same tiers.** `gtneioreplugin.util.DimensionHelper` registers every ore dimension with a tier key. Evidence: sim of its static initializer, for example:
  - `['GalacticraftCore_Moon','moon','Moon','Mo','gtnop.tier.1',…]`
  - `['Ross128b','ross128b','Ross128b','Rb','gtnop.tier.3',…]`
  - `['Ross128ba','ross128ba','Ross128ba','Ra','gtnop.tier.5',…]`
  - `['GalacticraftAmunRa_Neper','neper','Neper','Np','gtnop.tier.9',…]`
  - `['Underdark','Underdark','Underdark','DD','gtnop.tier.10',…]`
  - `tier.0` for Overworld, Nether, Twilight Forest, The End, End Asteroids and the Toxic Everglades.
  - The lang file has `gtnop.tier.1=T1: %s` … `gtnop.tier.10=T10: %s` (`unzip -p $GT assets/gtneioreplugin/lang/en_US.lang`).
  - The NEI tiers match the code tiers for every space body.

### 5.2 Rocket tier to voltage tier (quest book)

These come from `$DQ` (BetterQuesting default quests, 3,814 quests, indexed by `bq_scan.py`). "Line" is the quest line folder. "Earliest by prerequisites" is the highest `Tier N (V)` quest in the quest's prerequisite closure.

| Rocket tier | Default GT tier | Earliest by prerequisites | Quest-book evidence |
|---|---|---|---|
| T1 (Moon) | **HV** | HV | "Dimensional Goal: Moon" (#162, Tier3HV): "HV is about getting to the moon so you can get Titanium, used to make EV and AE2 machines." "Rocket Tier 1" (#810) |
| T2 (Mars, Phobos, Deimos) | **EV** | HV | "Tier 4 (EV)" (#176): "The main goal here is to get a tier 2 rocket and reach Mars". "Nano Mainframe" (Tier4EV): "To craft the Tier 2 Rocket and reach Mars, Phobos and Deimos, you need to reach this circuit…" |
| T3 (Asteroids, Ceres, Europa, Ganymede, Callisto, Ross128b) | **IV** | EV | "On Your Way to Asteroids and Other Rocket Tier 3 DIMs" (#215, Tier5IV, prerequisite "Tier 5 (IV)"). "Ross128b Trip" (#2311, Tier5IV) |
| T4 (Io, Venus, Mercury) | **IV** | IV | "On Your Way to Tier 4 DIMs" (#1715, Tier5IV): "Tier 4 Planets are Jupiter's Moon Io…, Venus (needs a SpaceSuit) and Mercury." |
| T5 (Enceladus, Titan, Miranda, Oberon, Ross128ba) | **LuV** | IV | "Getting Europium" (Tier6LuV): "To make a mk2 reactor, ender quarry, T5 rocket, unlock ZPM, or other things, you will need europium". "Fetching Prasiolite" (Tier6LuV): "If you have a T5 rocket, you can get the ore from Ross128ba directly" |
| T6 (Proteus, Triton) | **ZPM** (UV without the GT++ assembler) | ZPM | "Rocket Tier 6" (#2640): "If you want to make this rocket in ZPM, you'll need to use the GT++ Assembler multi." "Making Tritanium" (Tier7ZPM): "Tritanium is used for the T6 rocket…". "UV Assembling" (Tier8UV): "And to make the T6 Rocket" |
| T7 (Pluto, Kuiper Belt, Haumea, Makemake) | **UV** | ZPM | "Wasn't This Only Found in the Center of Neutron Stars?" (Tier7ZPM): "You'll need Neutronium for UV and the T7 rocket". "All Good Things..." (Tier8UV): "So you've built your T7 rocket" |
| T8 (Barnard C/E/F, α Centauri Bb, T Ceti E, Vega B) | **UHV** | UHV | "UHV Energy Hatch" (Tier9UHV): "If you want to make the T8 Rocket or the mkIV reactor, you'll need this" |
| T9 (AmunRa, by mothership or shuttle) | **UEV** (*corrected by reviewer*, was UHV) | UHV | "The Final Frontier!" (Tier10UEV, questIDHigh 6871186703039940952, questIDLow −5095508056809418717; its only prerequisite is "Tier 10 (UEV)"): "With the Mothership (see the Space Race tab for how to build one) you can visit the truly last system: the Amun-Ra system." "The Final Frontier?" (Tier9UHV) says only that the mothership comes after the T8 rocket: "After this is there is only the Mothership for the T9 system and the Deep Dark, which has all the ores+more". The prerequisite closure of "Can I Build A Mothership For My Father?" (SpaceRace) reaches Tier9UHV ("It's Not Going Bad, I Swear!"), which is why UHV is the earliest. |

The default uses the line a quest sits in, which is never earlier than "earliest by prerequisites". The per-project checklist (§8.4) covers groups that go earlier.

### 5.3 Dimensions without rockets

| Dimension | What it takes | Default GT tier | Evidence |
|---|---|---|---|
| Nether (-1) | Obsidian portal | Steam (ULV) | "THE NETHER" (#479, Tier05Steam), location task `dimension: -1` |
| Twilight Forest (7) | Twilight portal | LV | "Searching for Answers" (#225, location task `dimension: 7`). Its prerequisite closure reaches LV. |
| The End (1), including the Far End Asteroids | Eyes of Ender, an HV chemical-reactor recipe in this pack | HV | "Is This the End? No, it's the END Dimension" (#986, location task `dimension: 1`) needs "Ender Eyes" (#1233, Tier3HV) ← "Performing Chemical Experiments at HV Level" |
| Toxic Everglades (227) | 10 Containment Frames + Alkalus Disk (Activated) | ZPM | "A Vision of the Future (FPS Drop Not Included)" (#2634, Tier7ZPM): "To get to the Toxic Everglades, you'll need 10 Containment Frames and an Alkalus Disk (Activated)… The dim itself is filled with GT++ ores." |
| Deep Dark (100) | Deep Dark portal, and a void miner for its ores | UIV | "The Darkness of Choice for Edgelords" (#2413, Tier11UIV) |
| Spirit World, Torment, Mirror, Outer Lands, Eldritch mazes, Pocket Plane, Spectre, Last Millenium, Bedrock dimension | Magic or utility portals | — | Not ore sources. `DimensionDef` has no entry for them. |

Galacticraft also forbids launching rockets from the Nether, the End and the Twilight Forest: `I:"Dimensions where rockets cannot launch" < -1 1 7 >` in `core.conf`.

### 5.4 Location gates on machines and recipes

- **Low-gravity recipes.** A GT singleblock checks `GTProxy.mLowGravProcessing` (`GregTech.cfg`: `B:lowGravProcessing=true`). For a recipe with `mSpecialValue` −100 or −300, the low-gravity sentinels from [export-mod.md §2.6](export-mod.md), it then calls `MTEBasicMachine.isValidForLowGravity(recipe, dimId)`. That method is true only if the provider class name:
  - contains `Orbit`;
  - ends with `Space`;
  - ends with `Asteroids`;
  - ends with `SS`;
  - contains `SpaceStation`; or
  - contains `Mothership`.

  So a low-gravity recipe needs a space station (GC Overworld station: T1 rocket, quest #1067 "Space Station", prerequisites reach HV), the Asteroids dimension (T3) or a mothership. **The Moon and planets do not qualify.**
  - Evidence: `J -c gregtech.api.metatileentity.implementations.MTEBasicMachine` shows `getfield mLowGravProcessing … bipush -100 … sipush -300 … invokestatic isValidForLowGravity`. That method compares `DimensionManager.getProvider(id).getClass().getName()` with `ldc "Orbit"`, `"Space"`, `"Asteroids"`, `"SS"`, `"SpaceStation"` and `"Mothership"`.
  - `MTEBasicMachine` is the only class that calls it (scan of `$GT`). Multiblocks do not check low gravity. That is consistent with every caller found, but **UNVERIFIED** in game.
  - **Reviewer notes.**
    - All 69 classes in `$GT` that read `GTRecipe.mSpecialValue` were scanned. Only `MTEBasicMachine` and the NEI formatter `DefaultSpecialValueFormatter` compare it with −100 or −300.
    - `isValidForLowGravity` first returns true when `FakeCleanroom.isLowGravBypassEnabled()`. That flag (`LOWGRAV_BYPASS`) is false by default, and only the admin command class `GTMiscCommand` sets it.
- **Other location-bound machines:**
  - gas siphon: only on a gas-giant station (§2.4);
  - void miners: only in their own dimension, Deep Dark ores only there (§1.6);
  - Fluid Drilling Rigs: only the fluid of their own chunks (§2.1).

---

## 6. What the save says about where the group has been

### 6.1 Signals

| Signal | File (in `World/` or a backup) | Field | Proves | Notes |
|---|---|---|---|---|
| Region data present | `DIM<n>/region/*.mca` | — | **nothing** | A dimension can hold hundreds of chunks saved at world creation with `InhabitedTime = 0` in every chunk. One world checked for this page had that in two dimensions. Details are in the local notes. |
| Chunk inhabited time | region chunks | `Level.InhabitedTime` (Long, ticks a player was nearby) | presence in that dimension | The best visit signal. `dim_visits.py` reads it for every non-Overworld region in ~6 s with Python. |
| Player location | `playerdata/<uuid>.dat` | `Dimension` (Int) | current dimension only | Gzip NBT ([world-format.md §1.4](world-format.md)) |
| Bed spawns | same | `Spawns[].Dim` | the player slept there | |
| Portal use | same | `ForgeData.PlayerPersisted.ReturnPortals[]` (`FromDim`, `ToDim`, positions) | the player used a portal in that dimension | Written by netherportalfix |
| Galacticraft stats | same, **at the root of the player NBT** (`World/galacticraft/` holds only `chunkloaders.dat` and `overworldMap/`) | `SpaceshipTier` (default 1), `Schematics` (default `[0, 2147483647]`), `spaceStationDimensionInfo`, `RocketItems`, `FuelLevel`, `LaunchpadStack`, `ShownSpaceRace` | Schematics beyond the default mean dungeon loot. Stations mean the player is in space. | A `SpaceshipTier` of 1 is the default, not proof of a launch. |
| GC space race | `data/GCSpaceRaceData.dat` | `SpaceRaceList` | bodies a team reached | Per team, the GC class reads `SpaceRaceID`, `TeamName`, `PlayerList`, `CelestialBodyList[CelestialBodyName, TimeTaken]` and `TicksSpent` (`J -c … SpaceRace`, ldc strings). Not seen with data (**UNVERIFIED** shape). |
| GT space projects | `data/GT_SpaceProjectData.dat` | `spaceTeams`, `spaceTeamProjects` | built projects (asteroid outpost and similar) | |
| BetterQuesting progress | `betterquesting/QuestProgress/<uuid>.json`, `QuestingParties.json` | `questProgress[].{questIDHigh, questIDLow, completed[].{uuid, timestamp, claimed}}` | milestone completion, including location tasks | Party members share completion. See §6.3. |
| Team prospecting | `gtnhteams/<team>.json` | `TeamData.visualprospecting.blob` | veins and fluids the team prospected, per dimension | §7.2 |
| ServerUtilities | `serverutilities/players/<name>.dat` | `Data.serverutilities.TeleportTracker.*.dimension`, `Homes` | teleports and homes per dimension | |
| VP server cache | `$PACK/visualprospecting/server/World_<id>/DIM<n>.dat` | — | **nothing about visits** | Holds veins of generated chunks, including pre-generated ones (§7.1) |
| Rockets owned | storage scan ([world-format.md §6](world-format.md)) | item registry names | rocket tier owned | `GalacticraftCore:item.spaceship` (T1), `GalacticraftMars:item.spaceshipTier2`, `GalacticraftMars:item.itemTier3Rocket`, `GalaxySpace:item.Tier4Rocket` … `Tier8Rocket` (the items the "Rocket Tier N" quests retrieve) |

### 6.2 Rule for "visited"

A dimension counts as visited if any of these holds:

- `InhabitedTime > 0` in at least one of its chunks;
- any player's `Dimension`, `Spawns` or `ReturnPortals` names it;
- a completed BetterQuesting location task names it;
- team prospecting has discoveries there;
- for a Galacticraft body, the GC space race lists it.

A dimension counts as unlocked (reachable even if never visited) if it is visited, or if it is a Galacticraft body with `tierRequired ≤` the highest rocket tier the group owns. The highest rocket tier owned comes from completed "Rocket Tier N" quests or rockets found in storage. A region file alone is never enough.

### 6.3 BetterQuesting milestones

The world's own `betterquesting/QuestDatabase.json` and `$DQ` both use these IDs. Match by ID and confirm by name. Format: one JSON per player under `QuestProgress/`. Keys carry `:<NBT type>` suffixes (`"questIDLow:4"`, `"completed:9"`), the same convention as `$DQ`. A party (`QuestingParties.json`, `parties[].members`) shares completion. In one checked world, every party member had identical completions.

| Quest (ID) | Line | Meaning for availability |
|---|---|---|
| Welcome to Tier 0.5, Steam! (44), Welcome to Tier 1, LV (88), Tier 2 (MV) (1148), Tier 3 (HV) (160), Tier 4 (EV) (176), Tier 5 (IV) (213), Tier 6 (LuV) (1493), Tier 7 (ZPM) (2610), Tier 8 (UV) (2613), Tier 9 (UHV) (2616); UEV+ use 128-bit IDs | Tier lines | Cross-check for the tier detected from machines |
| THE NETHER (479) | Tier05Steam | Location: Nether |
| Searching for Answers (225) | NoviceThaumaturg | Location: Twilight Forest |
| Is This the End? (986) | HardcoreEnderExp | Location: End |
| Rocket Tier 1–8 (810, 1429, 1454, 1535, 1726, 2640, 2642, 2644) | SpaceRace | Rocket tier owned |
| Moon Arrival (1072) | SpaceRace | Location: Moon (28) |
| Space Station (1067) | SpaceRace | Low-gravity location exists |
| Ross128b Trip (2311) | Tier5IV | Location: Ross128b (64) |
| A Vision of the Future (2634) | Tier7ZPM | Location: Toxic Everglades (227) |
| Space Pumping (3037) | SpaceRace | Gas siphon |
| Space Elevator (3283) | Tier8UV | Space Elevator built |
| Something From Nothing (2668) | MultiblockGoals | Void miner |
| Can I Build A Mothership For My Father? (questIDHigh −3089697472671825287, questIDLow −4765124701548164912) | SpaceRace | T9 access |
| The Darkness of Choice for Edgelords (2413) | Tier11UIV | Deep Dark portal |

---

## 7. VisualProspecting saved data

### 7.1 Server cache: `$PACK/visualprospecting/server/World_<id>/DIM<n>.dat`

- **Picking the right folder.** The folder name is the world ID. `WorldIdHandler` (a `WorldSavedData` named `"visualprospecting"`) stores it in `World/data/visualprospecting.dat` as `MinecraftServer.getFolderName() + "_" + <random UUID>`. That is `World_<uuid>` here (`J -c com.sinthoras.visualprospecting.database.WorldIdHandler`). A server folder can also hold `World_*` folders left over from other worlds that ran in it. **Read only the folder whose name matches `data/visualprospecting.dat`.**
- **Format: gzip NBT, version 3.** `DimensionCache` has `CURRENT_FORMAT_VERSION = 3`, and `saveOres` and `loadFluids` use these keys (`J -c -p -constants …DimensionCache`):

```
{ dim: Int, version: Int (3),
  ores:   { palette: List<String> (vein names, "ore.mix.…"),
            chunkX: Int[], chunkZ: Int[], veinTypeIndex: Int[] (index into palette),
            depleted: Byte[], source: Byte[] },
  fluids: { palette: List<String> (fluid names), chunkX: Int[], chunkZ: Int[],
            fluidTypeIndex: Int[], chunkData: Int[], chunkDataSize: Int } }
```

  - A read-only decode of the current world's `DIM0.dat`, `DIM-1.dat`, `DIM7.dat` and `DIM64.dat` (`vp_decode.py`) printed `shape {'dim': 0, 'fluids': {}, 'version': 3, 'ores': {'source': 'bytes[…]', 'chunkZ': 'list[…] of int', 'veinTypeIndex': 'list[…] of int', 'chunkX': 'list[…] of int', 'palette': 'list[21] of str', 'depleted': 'bytes[…]'}}`. Counts are in the local notes.
  - One entry per vein, keyed by the chunk of the vein's centre (`OreVeinPosition.chunkX/chunkZ`). Fluids are stored per 8×8-chunk field (`UndergroundFluidPosition.chunks : int[][]`).
- **`source` bytes are `VeinSource` IDs:** 0 `UNKNOWN`, 1 `GENERATED`, 2 `RESCAN`, 3 `API`.
  - Evidence: the `VeinSource(String, int, int id, int trustLevel)` constructor stores `id` then `trustLevel`. The static initializer passes `UNKNOWN (0,0)`, `RESCAN (2,1)`, `API (3,2)` and `GENERATED (1,3)`.
- **What it contains: every vein that GT's normal vein pass placed in generated chunks, plus rescans** (*corrected by reviewer*: this said every vein in generated chunks).
  - `ServerCache.onVeinGenerated(VeinGenerateEvent)` → `notifyOreVeinGeneration(…, VeinSource.GENERATED)` records each vein GT generates.
  - The region-file rescan (`cachebuilder/DimensionAnalysis`) adds `RESCAN`.
  - Legacy migrations come in as `UNKNOWN`.
  - It is per world, not per player or team. Use it for "where is the nearest known vein of X". It does not say what the group found.
  - **Corrected by reviewer: asteroid fields have no entries.**
    - `VeinGenerateEvent` is constructed only in `gregtech.common.GTWorldgenerator$WorldGenContainer`, the normal vein pass. Evidence: `J -c` of every class in `$GT` that references the event.
    - `ServerCache.onVeinGenerated` records an event only when `result == 3` (ore placed) and the layer is not `NoOresInVein` (`iconst_3 if_icmpne`, `ldc "NoOresInVein"`).
    - Ores in asteroid-type dimensions are placed by `galacticgreg.WorldGeneratorSpace$AsteroidGenerator`, which posts no event. That covers the `EndAsteroid` part of DIM 1, Asteroids, Kuiper Belt and Mehen Belt.
    - Those dimensions therefore never get `GENERATED` entries. Whether a VP rescan (`RESCAN`) finds their ores is **UNVERIFIED**.
- **Vein positions follow GT's ore-vein grid.** That grid depends on `World/data/GregTech_OregenPattern.dat` (`{data:{version:1, oregenPattern:"AXISSYMMETRICAL"|"EQUAL_SPACING"}}`, enum `GTWorldgenerator$OregenPattern`). VP refuses to save when the pattern is unconfirmed ("This cache is read-only for the session… confirm with /gt oregenpattern set <pattern> confirm").

### 7.2 Team discoveries: `World/gtnhteams/<team>.json` → `TeamData.visualprospecting`

- **Format.** `{ "version": 1, "blob": <Base64> }`. The blob is GZIP, then a `DataOutputStream` stream:

```
int nDims; repeat nDims × { int dim;
  LongSet discoveredVeins; LongSet discoveredFluidFields; LongSet depletedVeins }   // LongSet = int n; n × long (sorted)
vein key  = ((long) chunkX << 32) | (chunkZ & 0xffffffffL)            // TeamProspectionData.packVein
fluid key = ((long)(chunkX >> 3) << 32) | ((chunkZ >> 3) & 0xffffffffL) // packFluid (8×8-chunk fields)
```

  - Evidence: `J -c -p -constants …teams.TeamProspectionData` (`FORMAT_VERSION = 1`, `TAG_BLOB = "blob"`, `encodeBlob`: `GZIPOutputStream`, then `DataOutputStream.writeInt(nDims)`, then per dimension `writeInt(dim)` and `writeLongSet` ×3, then `Base64.getEncoder`). A read-only decode of real team files (`vp_team.py`) consumed every byte (`assert i == len(buf)` held).
- **Getting the vein type.** The team blob has keys only. Join each key to the server cache entry with the same chunk to get the vein type. In the decoded files, every discovered key had a server-cache entry.
- **Scope.** The data is per GTNHLib team. `config/visualprospecting.cfg` has `B:enableTeamSharing=true` and `B:keepProspectionOnTeamLeave=true`. A group whose players sit in separate teams has separate discovery sets, so union all teams the project trusts.

### 7.3 Client caches

Each client keeps its own cache in `visualprospecting/client/<playerName>_<playerUUID>/` under the game instance (`ClientCache.getStorageDirectory`: `ldc "visualprospecting/client/" … getDisplayName … "_" … getPersistentID`). These caches are not on the server and are not needed when team data exists.

### 7.4 Use in the planner

- **"Where to find X" in a reachable dimension.** From the server cache: the veins whose palette name has X in any of its four roles. Sort by distance to the base (world-specific, local only) and flag `depleted`. Asteroid-type dimensions have no entries (§7.1), so show only their vein list there (*added by reviewer*).
- **"The group already found X here".** From team discoveries joined to the server cache.
- **Underground fluids.** From the server cache's `fluids`, or the team's `discoveredFluidFields`.

---

## 8. Recommendation

### 8.1 Availability model: a fixpoint over reachable sources

Inputs:

- the exported recipes ([export-mod.md](export-mod.md));
- the source exports (§8.5);
- the project tier *T*;
- the reachable dimensions *D* (§8.2–8.4);
- the capabilities *C* (§8.4).

**Seed set S₀:**

- Free items: water, air (`Air` everywhere, `Nether Air` only if DIM −1 ∈ *D*, `Toxic Air` only if DIM 227 ∈ *D*), cobblestone, lava.
- For every *d* ∈ *D* and every enabled vein or small ore allowed in *d*, the material's ore items: `getPart(OrePrefixes.ore)` and the raw ore.
- Underground fluids of *d*, if *T* ≥ MV (Fluid Drilling Rig I).
- Capability sources:
  - gas-siphon fluids for each reachable gas-giant station;
  - Space Elevator mining recipes up to the owned module tier;
  - pump-module fluids;
  - Deep Dark void-miner drops if DIM 100 ∈ *D* and *T* ≥ LuV.

**Closure.** Run forward chaining over the recipes allowed at *T*:

- Skip recipes above *T*. Use the recipe's voltage tier from its EU/t, as in [gt-mechanics.md §1.2](gt-mechanics.md), and the machine's own minimum tier for maps such as void miners and drilling rigs.
- Skip recipes flagged `disabled` or `fake`, which are display-only. Keep `hidden` ones: they are real recipes that NEI does not show (**UNVERIFIED** for every map).
- Skip low-gravity recipes on singleblocks unless a low-gravity location is reachable.
- Space-mining recipes need the module tier.
- A recipe fires when every input slot (consumed or not) has at least one available alternative.
- All of its outputs, chanced outputs included, then become available.
- Keep `why[item] = first recipe that made it` for explanations.

This is the standard queue algorithm:

```
need[r] = number of input slots of r
consumers[x] = recipes with a slot that x satisfies
queue = S₀; avail = S₀
while queue: x = pop(queue)
  for (r, slot) in consumers[x]: if slot not yet satisfied: mark it; need[r] -= 1
    if need[r] == 0: for y in outputs(r): if y ∉ avail: avail.add(y); why[y] = r; push(queue, y)
```

It is linear in the total recipe size. With ~10⁵ GT recipes and ~6.4·10⁴ crafting recipes ([export-mod.md §6.4](export-mod.md)) that is a few hundred milliseconds or less. YAFC computes the same kind of accessibility with a work-queue walk (`Milestones.WalkAccessibilityGraph`: `while (accessibleQueue.TryDequeue(out FactorioId node)) {`), in yafc-ce `Yafc.Model/Analysis/Milestones.cs`, GPL-3.0, learn only (https://raw.githubusercontent.com/shpaass/yafc-ce/master/Yafc.Model/Analysis/Milestones.cs).

**Classes of base materials.** A base item is a dust, ingot, gem or basic fluid, as in the spec.

| Class | Rule | Leaf? |
|---|---|---|
| **direct** | Its material has a vein or small ore in *D*, or the fluid has a dimension source in *D* | Yes, at the editable cost |
| **byproduct** | Not direct, but an ore-processing recipe from a direct ore outputs it (cross-checked with `mOreByProducts` / `Werkstoff` lists) | Yes, flagged "byproduct of X ore (dimension)" |
| **derived** | In `avail`, but only through other recipes (for example Titanium from Moon Ilmenite at HV) | Yes by default, flagged with the derivation. A project toggle can make the planner route it instead (my call). |
| **unavailable** | Not in `avail` | **Never a leaf** |

This keeps the earlier decision that chains stop at base items, now limited to what is reachable. Recipes needing an unavailable item are dropped. If the target needs one, the planner shows what unlocks it.

**Unlock hints.**

- Rerun the closure once per voltage tier above *T*, with the default dimensions and capabilities of that tier. That is at most 13 runs. Record the first tier where each item appears.
- For the hint, walk `why[]` back to the seeds that first appear at that tier. Example: "Tungstate: needs the End asteroids (HV, needs the End) or Mars (T2 rocket, EV)".
- The same runs give the "what does checking this dimension add" preview in §8.4.

### 8.2 Default reachable dimensions per tier

Cumulative. Each row adds to the rows above it.

| Project tier | Dimensions added | Capabilities added |
|---|---|---|
| ULV / Steam | Overworld, Nether | — |
| LV | Twilight Forest | — |
| MV | — | Fluid Drilling Rig I (underground fluids) |
| HV | The End and Far End Asteroids (DIM 1), Moon (T1) | Overworld space station (low gravity) |
| EV | Mars, Phobos, Deimos (T2) | Mars station |
| IV | Asteroids, Ceres, Europa, Ganymede, Callisto, Ross128b (T3); Io, Venus, Mercury (T4) | Jupiter and Venus stations, gas siphon on the Jupiter station |
| LuV | Enceladus, Titan, Miranda, Oberon, Ross128ba (T5) | Saturn and Uranus stations, Void Miner I (own dimension only) |
| ZPM | Proteus, Triton (T6), Toxic Everglades | Neptune station |
| UV | Pluto, Kuiper Belt, Haumea, Makemake (T7) | Space Elevator, mining module MK-I |
| UHV | Barnard C/E/F, α Centauri Bb, T Ceti E, Vega B (T8) | Mining module MK-II, pump module MK-I, Infinite Fluid Drilling Rig |
| UEV | Neper, Maahes, Anubis, Horus, Seth, Mehen Belt (T9, mothership; *corrected by reviewer*, was UHV, §5.2) | Mining module MK-III, pump module MK-II |
| UIV | Deep Dark | Void miner draws on every ore |
| UXV | — | Pump module MK-III |

This table should ship as hand-maintained data in the repository. It is our own derived data, with the quest IDs as evidence. The exporter supplies the dimension IDs, names and body tiers, so a config change cannot silently break it. Three rows are policy choices the group can override: T6 at ZPM rather than UV, the End at HV, and AmunRa at UEV rather than UHV (the mothership's prerequisites only reach UHV; *added by reviewer*).

### 8.3 Visited and unlocked dimensions are added on top

- Add every dimension that §6.2 marks visited or unlocked.
- If the group owns a rocket of tier *t*, add every body with `tierRequired ≤ t`, even above the voltage default.
- Show the reason per dimension: "default for HV", "visited (inhabited chunks)", "rocket T2 found in storage", "quest Moon Arrival done".

### 8.4 Per-project overrides

Store this with the project, and make every field editable by anyone in the group:

```json
{"availability": {
  "policy": "progression",
  "dims": {"moon": "auto", "EndAsteroid": "off", "mars": "on"},
  "capabilities": {"voidMiner": "auto", "seMiner": "auto", "sePump": "auto", "gasSiphon": {"jupiter": "auto"}, "lowGravity": "auto"},
  "derivedLeaves": true
}}
```

- `policy`: `"progression"` is the spec default, from §8.2 ∪ §8.3. `"visited-only"` uses §8.3 only.
- `auto` follows the policy. `on` and `off` force a dimension or capability in or out.
- Key dimensions by their GT ore-gen name (`moon`, `ross128b`, `EndAsteroid`), not by ID. Display names and IDs come from `dimensions.jsonl`.
- **UI.** A checklist grouped by rocket tier. Each row shows its state, the reason, and what it adds (the new materials from the per-tier closure runs). The materials list (spec §3.10) shows each leaf's class and source dimensions. When VP data exists, it also shows "found here" counts.

### 8.5 What the exporter must add

These use the same conventions as [export-mod.md §6](export-mod.md): gzip JSON Lines, items by index, fluids by registry name.

| File | One line per | Key fields |
|---|---|---|
| `dimensions.jsonl.gz` | registered dimension ID | `id`, `provider` (class), `name` (GT ore-gen name, §1.5), `body?` {`name`, `unlocalized`, `kind`, `parent`, `tier`, `reachable`}, `ore?` {`type`, `veinChance`, `voidMinable`, `veinHeights`}, `nei?` {`abbr`, `tierKey`, `display`}, `uo?` (underground-fluid entry, resolved with GT's rule) |
| `celestial.jsonl.gz` | Galacticraft body, including stations | `name`, `unlocalized`, `kind`, `parent`, `tier`, `dim`, `reachable` (`GalaxyRegistry`) |
| `ore-veins.jsonl.gz` | `WorldgenGTOreLayer` | `name`, `enabled`, `weight`, `density`, `size`, `y`, `yByDim{}`, `dims[]`, `primary`, `secondary`, `between`, `sporadic` (material keys), `stoneSpecific` |
| `small-ores.jsonl.gz` | `WorldgenGTOreSmallPieces` | `name`, `enabled`, `amount`, `y`, `dims[]`, `material` |
| `ore-materials.jsonl.gz` | `IOreMaterial` with ores (veins, small ores, Deep Dark list) | `key` (`gt:`/`bw:`/`gtpp:` + internal name), `id`, `dn`, `byproducts[]` (GT and BW lists), `oreMultiplier`, `byproductMultiplier`, `smeltInto?`, `directSmelting?`, `parts{ore, rawOre, crushed, dust, ingot, gem}` (item indices from `getPart`) |
| `underground-fluids.jsonl.gz` | config entry | `key`, `match`, `fluids[]` {`fluid`, `chance`, `min`, `max`, `decrease`}, `dims[]` (resolved IDs), plus the NEI helper's view |
| `void-miner.jsonl.gz` | ore-gen dimension name | `dim`, `drops[]` {`item`, `weight`}, `extra[]` (from `dropMapsByDimName`, `extraDropsByDimName`) |
| `gas-siphon.jsonl.gz` | gas giant | `planet`, `tier`, `depths{1..4: [fluid, amount]}` |
| `space-pump.jsonl.gz` and `space-asteroids.jsonl.gz` | pump entry / `AsteroidData` | `planetType`, `gasType`, `fluid`, `amount` / `name`, `outputs[]`, `chances[]`, `moduleTier`, `drones[]`, `distance[]`, `weight` |

Illustrative lines (shapes only; the values were taken from the sim, not from an export):

```json
{"name":"ore.mix.bauxite","enabled":true,"weight":80,"density":3,"size":24,"y":[10,80],"yByDim":{},"dims":["seth","moon","asteroids","ganymed","haumea","kuiperbelt","makemake","mercury","phobos","pluto","proteus","tcetie","titan"],"primary":"gt:Bauxite","secondary":"gt:Ilmenite","between":"gt:Aluminium","sporadic":"gt:Ilmenite","stoneSpecific":false}
{"name":"ore.small.titanium","enabled":true,"amount":32,"y":[10,180],"dims":["mars","phobos","deimos","asteroids","ceres","callisto","ganymed","iojupiter","venus","mercury","…"],"material":"gt:Titanium"}
{"id":28,"provider":"micdoodle8.mods.galacticraft.core.dimension.WorldProviderMoon","name":"moon","body":{"name":"moon","kind":"moon","parent":"overworld","tier":1},"ore":{"type":"Planet","voidMinable":true},"nei":{"abbr":"Mo","tierKey":"gtnop.tier.1","display":"Moon"},"uo":"Moon"}
```

The world reader (not the exporter) adds the visit signals of §6 and the VP data of §7.

### 8.6 Validation

- **Export counts.** 122 veins and 54 small ores when read from the two `sList`s, all enabled. Reading the `SmallOres` enum instead gives 55, with 1 disabled. (*Corrected by reviewer*: this used to expect 55 small ores with 1 disabled from the export, but disabled entries never reach `sList`, §1.1.)
- **Tiers.** Every GC body's `tier` matches the NEI `tierKey`. Ross128b is 3, Ross128ba 5, the AmunRa bodies 9 and the Deep Dark 10.
- **VP names.** Every VP palette name in a real world is an exported vein name. That held for the Overworld, Nether and Twilight Forest of the checked world.
- **Closure against the quest book.**
  - Titanium appears at HV: its seeds are Moon Ilmenite and Bauxite.
  - Titanium appears as a *direct* material at EV: Mars has a titanium small ore.
  - Aluminium is *derived* well before HV, from Overworld minerals. Ore-only Aluminium (Bauxite) is Moon.
  - Naquadah first appears at HV through End asteroids, and in space at IV.
- **Fluids.** The fixpoint lists which basic fluids end up gated. Compare that list with §2.6 by hand after the first export.

---

## 9. Open items and UNVERIFIED

- **Quest-book tiers are a policy, not a rule of the game.** The rows to watch are T6 (ZPM or UV), the End at HV, T3 at IV even though its prerequisites only reach EV, and AmunRa at UEV even though the mothership's prerequisites only reach UHV (*added by reviewer*). Keep them as overrides.
- **Underground-fluid matching.** Resolved by reviewer: with the pack's Guava 17, DIM 63 (Ross128ba) gets its own `Ross128ba` entry (§2.1). Keep the runtime replication as a regression check.
- **Pump module.** Whether pump module tiers limit `planetType`.
- **Low gravity on multiblocks.** No multiblock class calls `isValidForLowGravity`. Not tested in game.
- **Which basic fluids are really gated** (§2.6) needs exported recipes and the fixpoint.
- **ThaumicTinkerer bedrock dimension** ores (§1.8).
- **Why some dimensions get chunks at world creation.** Seen in the checked world (local notes); the cause is not known. It does not matter for the model, because §6.2 never trusts region presence.
- **GC space race data** has not been seen non-empty.
- **Mod providers without a world.** `createProviderFor` plus `getDimensionName()` may throw for some mod providers. Wrap each call.
- **Pack updates.** GTNH 2.9.0-RC-2 and 2.9.0 final may change veins, tiers or quests. Everything above except the §8.2 table is re-derived by the export. Re-check the §8.2 quest IDs on upgrade.

## Appendix A. Ore materials by first default tier (ore lists only)

This table puts every vein and small-ore material at the lowest §8.2 tier whose dimensions contain it (`availability.py`; 268 materials). It ignores recipes. **The fixpoint makes many of these available earlier through chemistry or byproducts.** Gallium, for example, is a Sphalerite byproduct in the Overworld. At UIV, the Deep Dark void miner makes every ore material available. Names are internal material names.

| First tier | Count | Materials |
|---|---|---|
| ULV / Steam (Overworld, Nether) | 83 | Alunite, Andradite, Apatite, Asbestos, BandedIron, Barite, BasalticMineralSand, Beryllium, Bismuth, BrownLimonite, Calcite, Cassiterite, CassiteriteSand, CertusQuartz, Chalcopyrite, Cinnabar, Coal, Copper, Diamond, Diatomite, Dolomite, Electrotine, Emerald, FullersEarth, GarnetSand, Glauconite, GlauconiteSand, Gold, GraniticMineralSand, Graphite, Grossular, Gypsum, Iron, Kaolinite, Kyanite, Lapis, Lazurite, Lead, Lepidolite, Lignite, Magnetite, Malachite, Mica, Molybdenite, Molybdenum, NetherQuartz, Nickel, Oilsands, Pentlandite, Pollucite, Powellite, Pyrite, Pyrochlore, Pyrolusite, Quartzite, Realgar, Redstone, RockSalt, Ruby, Salt, Saltpeter, Silver, Soapstone, Sodalite, Spessartine, Sphalerite, Spodumene, Stibnite, Sulfur, Talc, Tantalite, Tetrahedrite, Thorium, Tin, TricalciumPhosphate, Trona, VanadiumMagnetite, Vermiculite, Wollastonite, Wulfenite, YellowLimonite, Zeolite, Zinc |
| LV (Twilight Forest) | 28 | Almandine, Amber, Amethyst, Bentonite, BlueTopaz, Cobaltite, Cryolite, Galena, GarnetRed, GarnetYellow, Garnierite, GreenSapphire, InfusedAir, InfusedEarth, InfusedEntropy, InfusedFire, InfusedOrder, InfusedWater, Jade, Jasper, Magnesite, Olivine, Opal, Pyrope, Sapphire, Spinel, Tanzanite, Topaz |
| HV (End, End asteroids, Moon) | 19 | Aluminium, Bastnasite, Bauxite, Chromite, Cooperite, Ilmenite, Iridium, Lithium, MeteoricIron, Monazite, Naquadah, NaquadahEnriched, Neodymium, Palladium, Perlite, Platinum, Scheelite, Tungstate, Uvarovite |
| EV (Mars, Phobos, Deimos) | 12 | Antimony, Arsenic, Desh, Draconium, Mirabilite, Oriharukon, Pitchblende, Titanium, Uraninite, Uranium, Vinteum, Vyroxeres |
| IV (T3 and T4 bodies) | 50 | Alduorite, Ammonia, Ardite, Arsenopyrite, Bismuthinit, Bismutite, Bornite, CallistoIce, Carbon, CarbonDioxide, Ceruclase, Chrome, ChromoAluminoPovondrait, DeepIron, DescloiziteCUVO4, DescloiziteZNVO4, Djurleit, Fayalit, Ferberite, Firestone, FluorBuergerit, Forsterit, FuchsitAL, FuchsitCR, Hedenbergit, Huebnerit, Hydrogen, InfusedGold, Ledox, Loellingit, Manganese, Methane, Mithril, Mytryl, Nitrogen, Olenit, Orichalcum, Oxygen, Plutonium, Quantium, RedZircon, Roquesit, Rubracium, Rutile, SulfurDioxide, Thorianit, Tungsten, VanadioOxyDravit, Vulcanite, Wittichenit (the gas and carbon "ores" are the five `…ice` veins on Asteroids and the Kuiper Belt) |
| LuV (T5 bodies) | 9 | BArTiMaEuSNeK, Fluorspar, Neutronium, Osmium, Prasiolite, ShadowIron, Silicon, Tiberium, Vanadium |
| ZPM (T6 bodies, Toxic Everglades) | 47 | Adamantium, BlackPlutonium, Gallium, Niobium, Plutonium241, Uranium235, Yttrium, plus GT++ ores AGARDITE_CD/LA/ND/Y, ALBURNITE, CERITE, CROCROITE, CRYOLITE, DEMICHELEITE_BR, FLORENCITE, FLUORCAPHITE, FLUORITE, GADOLINITE_CE/Y, GEIKIELITE, HIBONITE, HONEAITE, IRARSITE, KASHINITE, LAFOSSAITE, LANTHANITE_CE/LA, LAUTARITE, LEPERSONNITE, MIESSIITE, NICHROMITE, PERROUDITE, POLYCRASE, RADIOBARITE, RUNITE, SAMARSKITE_Y/YB, TITANITE, XENOTIME, YTTRIALITE, YTTROCERITE, ZIMBABWEITE, ZIRCON, ZIRCONILITE, ZIRKELITE |
| UV (T7 bodies) | 3 | Borax, Chrysotile, NetherStar |
| UHV (T8) | 9 | Bedrockium, Cadmium, Caesium, Cerium, DraconiumAwakened, InfinityCatalyst, Lanthanum, Samarium, Tartarite |
| UEV (AmunRa, mothership) | 8 | CertusQuartzCharged, CosmicNeutronium, Dilithium, MysteriousCrystal, Naquadria, QuartzSand, TengamRaw, Trinium |

*Corrected by reviewer:* the last two rows used to be one UHV row of 17 materials, for T8 and AmunRa together. They were split when AmunRa moved to UEV (§5.2). The split comes from the reviewer's own parse of the `OreMixes`, `SmallOres` and `DimensionDef` static initializers. That parse reproduced every other row of this table: 268 materials, split 83, 28, 19, 12, 50, 9, 47 and 3.

## Appendix B. Scripts (session scratch, not committed)

| Script | What it does |
|---|---|
| `jvmsim.py` | Symbolic stack machine over `javap -c` output. Records builder calls per enum constant. |
| `flatten_ores.py` | Turns the `OreMixes`, `SmallOres` and `DimensionDef` sims into `ores.json` and `dimdefs.json` |
| `gc_tiers.py` | Celestial body → `setTierRequired`, plus the dimension-ID config field |
| `parse_uf.py` | `UndergroundFluids.cfg` → per-dimension fluids |
| `space_ast.py` | `SpaceMiningRecipes.addAsteroids` → asteroid table |
| `availability.py` | First default tier per ore material (Appendix A) |
| `bq_scan.py`, `bq_progress.py` | Quest index from `$DQ`; completed milestones from a backup |
| `nbt.py`, `vp_decode.py`, `vp_team.py` | Read-only NBT reader; VP server cache and team blob decoders. They print counts only, never coordinates or IDs. |
| `world_progress.py`, `dim_visits.py` | playerdata keys and GC stats; `InhabitedTime` per dimension, from a backup zip |
