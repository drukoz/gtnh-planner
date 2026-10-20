# GregTech mechanics reference: GT5-Unofficial 5.09.54.183 (GTNH 2.9.0-RC-1)

Status: research reference for the planner's calculations. Date: 2026-10-17.

This page collects the exact GregTech numbers and rules the planner computes with: voltage tiers, overclocking, power delivery (cables, transformers, explosions), the generators and storage used at steam/LV–HV, multiblock footprints, and parallel/batch/heat mechanics. Everything was checked against the pack's own `gregtech-5.09.54.183.jar` and the GT5-Unofficial source at the matching tag. Numbers that belong to one particular world (counts, machine states) are kept in the local notes file, which is never committed.

## How to read this page

- `$PACK` is the GTNH 2.9.0-RC-1 server pack folder. `$GT` is `$PACK/mods/gregtech-5.09.54.183.jar` (GT5U 5.09.54.183 with GT++, BartWorks, TecTech, GoodGenerator, KubaTech, KekzTech folded in). `$SL` is `$PACK/mods/structurelib-1.4.45.jar`.
- `javap` is the JDK 25 `javap`. `$GT` is a **multi-release jar** (`unzip -p $GT META-INF/MANIFEST.MF` → `Multi-Release: true`, `JvmDowngrader-Version: 2.0.1`, `JvmDowngrader-Downgrade-Target: 52`). The root classes are a Java 8 downgrade; on Java 17+ (this pack runs on Java 17–26) the JVM loads `META-INF/versions/17/...`. So every `javap` here is `javap -cp $GT --multi-release 17 -c -p -constants -l <class>`.
- Source links point at the tag `5.09.54.183` (`gh api repos/GTNewHorizons/GT5-Unofficial/git/refs/tags/5.09.54.183` → commit `f8453bce28793713d314f6dcfa5ac551d700efd6`). `SRC/` below means `https://github.com/GTNewHorizons/GT5-Unofficial/blob/5.09.54.183/src/main/java/`. Where both were checked, the source line numbers match the jar's `LineNumberTable` (e.g. `OverclockCalculator.calculateOverclock` is lines 369–419 in both).
- Tags on claims: **[jar]** read from `$GT` bytecode; **[src]** read in the tagged source; **[test]** GT's own unit test at the tag; **[script]** re-computed by a script that ports the code (the scripts are in the session scratch folder listed in the local notes; not committed); **UNVERIFIED** = not checked.
- Units: V = volts (EU per amp packet), A = amps (packets per tick), EU/t = EU per tick, 20 ticks = 1 s, L = litres (mB).

## 0. Summary for the planner

| Topic | Rule the planner should use | Section |
|---|---|---|
| Tier voltages | `V[t] = 8·4^t` for ULV..UXV (t = 0..13), MAX = 2,147,483,640. Recipe EU/t convention `VP[t] = V[t]·30/32` (7, 30, 120, 480, 1920, 7680, ...). | §1 |
| Recipe acceptance | Singleblock tier t runs a recipe iff `EUt ≤ V[t] × recipeMapAmperage` (1 for almost all maps; 2 for the thermal centrifuge). Multiblock: `EUt·mods ≤ Vavg·A` and `EUt ≤ Vavg·4`. | §1.2 |
| Standard OC | Each overclock: EU/t ×4, duration ÷2 (floored, minimum 1 tick). Number of OCs `n = floor(log4(machinePower / max(recipePower, 32)))`. Recipes under 32 EU/t are treated as 32 EU/t for counting OCs (ULV gets no OC in an LV machine). | §2 |
| Singleblock OC | `machinePower = V[tier] × mAmperage`. `mAmperage` is the recipe map's amperage unless the machine overrides it: 1 for most machines, **2 for the thermal centrifuge**, and 3 for the arc furnace, whose recipe EU/t is also ×3. The singleblock Mass Fabricator is special: 8 A, ×2 EU per OC, at most tier − 1 OCs. **Does not stop at 1 tick**: a 1-tick recipe keeps paying ×4 EU/t per extra OC. *Corrected by reviewer: this row used to say `V[tier]` with ×3 only for the arc furnace; see §2.2.* | §2.2 |
| Multiblock OC | Amperage OC: `machinePower = Vavg × A`, with `A = 1` for exactly one energy hatch, else the sum of the hatches' amps (2 per normal hatch). Parallels are filled first, the remaining power overclocks. Overclocks past 1 tick become extra parallels. | §2.3 |
| Perfect OC | EU/t ×4, duration ÷4 (LCR, IsaMill, Froth Flotation Cell, Circuit Assembly Line, ...). EBF-type heat: one perfect OC per full 1,800 K above the recipe, and EU ×0.95 per full 900 K (multiplicative, i.e. **5 %**, not 4 %). | §2.4, §6.4 |
| Delivery losses | Every emitter (generator, battery buffer, transformer) pays `V + 2^max(0, t−1)` EU per amp sent (ULV +1, LV +1, MV +2, HV +4, EV +8, IV +16; *reviewer: `max(0, …)` as in the code, so ULV pays +1, not +0.5*). Cables drop the voltage by the sum of their per-block loss along the path, per amp. | §3.2, §3.3 |
| Damage | A GT machine explodes when a packet **arrives** with more volts than its tier. A cable burns instantly when a packet's volts exceed its rating, and burns when the amps it carried, minus its rated amps per tick, pile up past 40 × its rated amps. | §3.3, §3.4 |
| Power shortage | Singleblock: progress reset and a 100-tick pause, inputs kept. Multiblock: shuts down (`POWER_LOSS`), **the running recipe's outputs are voided**, and it stays off until something re-enables it: a player (soft mallet or GUI), or a Machine Controller cover in a non-safe mode (*refined by reviewer*, §3.5). | §3.5 |
| Line parts | Conveyor covers move 3.2 / 12.8 / 64 / 320 / 1,280 / 5,120 / 20,480 items/s (LV–ZPM). Pump covers move 640 L/s at LV, ×4 per tier. A bus has `(tier + 1)²` slots and a fluid hatch holds `8000 × 2^tier` L. A basic machine's input filter is off by default. AE2 interfaces and export buses idle at 1 AE/t, cables at 0, and 1 EU = 2 AE. Not yet re-checked against the jars. | §3.8 |
| Steam turbines | LV/MV/HV give 3 EU per 7/8/9 L of steam (85.7/75/66.7 %), 1 A out. Full output needs 1,540 / 6,933 / 30,960 L/s. | §4.1 |
| HP ("Advanced") solar boiler | 360 L/s whenever above 100 °C. In clear weather that is ≈94–95 % of every Minecraft day (≈58–71 s per day with no steam, depending on the boiler's own tick phase; *refined by reviewer*, §4.2), so "no steam at night" is wrong for this boiler. Rain stops it in ≈7 min, thunder in ≈5.3 min. Calcification on plain water: full output for 1,080,000 producing ticks, then linear down to 120 L/s at 1,800,000. Distilled water never calcifies; breaking and replacing the boiler descales it. | §4.2 |
| Battery buffer | Amps out = number of batteries **of exactly the buffer's tier** that can provide energy (no matching battery: 0 A). Capacity = the batteries' charge plus an internal `64·V·slots`. The chargers, battery-buffer subclasses with 4 slots each, store more and send other amps: `MTECharger` `256·V·slots` and `max(4 × batteries, 2)` A, `MTETurboCharger` `6,144·V·slots` and `4·slots` A. | §4.3 |
| Footprints | Computable at export time from StructureLib (`StructureDefinition.occupiedSpaces`) or by building each multiblock in a void world, as the in-pack NEI preview does. Tooltip dimensions are not reliable. | §5 |

## 1. Voltage tiers and recipe tier

### 1.1 Tier table

| t | `VN[t]` | `V[t]` | `VP[t]` = `TierEU.RECIPE_*` | `VOLTAGE_NAMES[t]` |
|---|---|---|---|---|
| 0 | ULV | 8 | 7 | Ultra Low Voltage |
| 1 | LV | 32 | 30 | Low Voltage |
| 2 | MV | 128 | 120 | Medium Voltage |
| 3 | HV | 512 | 480 | High Voltage |
| 4 | EV | 2,048 | 1,920 | Extreme Voltage |
| 5 | IV | 8,192 | 7,680 | Insane Voltage |
| 6 | LuV | 32,768 | 30,720 | Ludicrous Voltage |
| 7 | ZPM | 131,072 | 122,880 | ZPM Voltage |
| 8 | UV | 524,288 | 491,520 | Ultimate Voltage |
| 9 | UHV | 2,097,152 | 1,966,080 | Ultimate High Voltage |
| 10 | UEV | 8,388,608 | 7,864,320 | Ultimate Extreme Voltage |
| 11 | UIV | 33,554,432 | 31,457,280 | Ultimate Insane Voltage |
| 12 | UMV | 134,217,728 | 125,829,120 | Ultimate Mega Voltage |
| 13 | UXV | 536,870,912 | 503,316,480 | Ultimate Extended Mega Voltage |
| 14 | MAX | 2,147,483,640 | 2,013,265,912 | Maximum Voltage |
| 15 | MAX+ | 8,589,934,592 | 8,053,063,680 | Error Voltage, report this (sentinel, "not really a real tier") |

- **[jar]** `javap ... gregtech.api.enums.GTValues` static initializer: `ldc2_w long 8l, 32l, 128l, 512l, 2048l, 8192l, 32768l, ... 536870912l, 2147483640l, 8589934592l` → `putstatic V:[J`; the strings `ULV, LV, MV, HV, EV, IV, LuV, ZPM, UV, UHV, UEV, UIV, UMV, UXV, MAX, MAX+` → `putstatic VN`. `VP` is built by `lambda$static$0`: `BigInteger.valueOf(i).multiply(30).divide(32).longValueExact()`.
- **[src]** `SRC/gregtech/api/enums/GTValues.java#L92-L108`: "`V = { 8L, 32L, ..., Integer.MAX_VALUE - 7, // Error tier ... 8_589_934_592L }`" and "The Voltage Practical. These are recipe voltage you should use if you expect the recipe to use a full amp of that tier ... // this will correctly map ULV to 7."
- **[jar]** `gregtech.api.enums.TierEU`: `ULV..MAX = GTValues.V[i]`, `RECIPE_ULV..RECIPE_MAX = GTValues.VP[i]` (`getstatic GTValues.VP ... putstatic RECIPE_LV`). `gregtech.api.enums.VoltageIndex`: `ULV = 0 ... UXV = 13, MAX = 14`.
- There is no `VA` array any more in this version. The `GTValues` field list is `B, M, L, W, V, VP, AatV, VN, VOLTAGE_NAMES, TIER_COLORS, ...` (**[jar]** `javap -p gregtech.api.enums.GTValues`).

### 1.2 How a recipe's tier is derived

GregTech uses four different "tier of a recipe" rules. The planner needs the acceptance rules (b) and (c). (a) is only for display.

**(a) Displayed tier.** `GTUtility.getTier(eut)` is the smallest t with `V[t] ≥ eut`: 0 if `eut ≤ 8`, 15 if `eut > V[14]`, otherwise `(ceil(log2(eut)) − 2) / 2`. NEI shows `max(1, getTier(eut))`, so ULV recipes are labelled LV.
- **[src]** `SRC/gregtech/api/util/GTUtility.java#L442-L452`: `if (l > V[14]) return 15; if (l <= V[0]) return 0; int log2L = 64 - Long.numberOfLeadingZeros(l - 1); return (byte) ((log2L - 2) / 2);`. Lines 520–522: `byte tier = getTier(voltage); tier = tier < 1 ? 1 : tier;` (`getTierNameWithParentheses`). **[jar]** same bytecode (`bipush 14 ... laload ... lcmp ... Long.numberOfLeadingZeros ... iconst_2 isub iconst_2 idiv`).
- Examples: 30 → LV, 32 → LV, 33 → MV, 120 → MV, 128 → MV, 129 → HV.

**(b) Singleblock acceptance.** A basic machine of tier t looks recipes up with `voltage = V[t]`, and the lookup keeps a recipe only if `V[t] × recipeMap.getAmperage() ≥ recipe.mEUt`. The map amperage is 1 except for the thermal centrifuge (2) and the mass fabricator's internal map (8). So an LV thermal centrifuge accepts recipes up to 64 EU/t; a 48 EU/t recipe would draw 1.5 A on average.
- **[jar]** `MTEBasicMachine.checkRecipe(boolean)`: `getstatic GTValues.V ... getfield mTier ... laload ... invokevirtual FindRecipeQuery.voltage(J)`.
- **[src]** `SRC/gregtech/api/recipe/FindRecipeQuery.java#L91`: `.filter(recipe -> voltage * recipeMap.getAmperage() >= recipe.mEUt && filter.test(recipe))`. `SRC/gregtech/api/recipe/RecipeMaps.java#L164-L168`: `thermalCentrifugeRecipes = RecipeMapBuilder ... .amperage(2)`. `grep -n '.amperage(' RecipeMaps.java` finds only lines 168 and 1493 (`massFabFakeRecipes`, `.amperage(8)`).

**(c) Multiblock acceptance** (machines using `ProcessingLogic`, i.e. almost all modern multiblocks):
- `ceil(EUt × euModifier × heatDiscount) ≤ availableVoltage × availableAmperage`, else "insufficient power"; and
- `EUt ≤ availableVoltage × 4^maxTierSkips`, else "insufficient voltage". `maxTierSkips` defaults to 1, so a recipe may be at most one tier above the energy hatches, as long as the hatches together supply enough amps.
- **[src]** `SRC/gregtech/api/util/ParallelHelper.java#L399-L407`: `final long tRecipeEUt = (long) Math.ceil(recipe.mEUt * eutModifier * heatDiscountMultiplier); if (availableEUt < tRecipeEUt) { result = insufficientPower ... } if (recipe.mEUt > calculator.getMaxAllowedRecipeEUt()) { result = insufficientVoltage ...`. `OverclockCalculator.getMaxAllowedRecipeEUt` = `floor(machineVoltage · 4^maxTierSkip)` (`SRC/gregtech/api/util/OverclockCalculator.java#L312-L315`). `availableVoltage`/`availableAmperage` are set as in §2.3.
- **[jar]** `ProcessingLogic.<init>`: `iconst_1 putfield maxTierSkips`. A few machines set 0 (Precise Auto-Assembler, KubaTech Industrial Arc Furnace: `logic.setMaxTierSkips(0)` at `SRC/goodgenerator/blocks/tileEntity/MTEPreciseAssembler.java#L228` and `SRC/kubatech/tileentity/gregtech/multiblock/MTEIndustrialArcFurnace.java#L601`).

**(d) Overclock "voltage tier".** Inside the overclock calculator the recipe tier is `max(1, log4ceil(EUt / 8))` (integer division), and the machine tier is `max(1, log4ceil(V / 8))`. ULV therefore counts as LV. This only matters for the voltage-tier cap in §2.2.
- **[src]** `SRC/gregtech/api/util/OverclockCalculator.java#L375`: "Treat ULV (tier 0) as LV (tier 1) for overclocking calculations." and lines 402–403. `GTUtility.log4(a) = a ≤ 1 ? 0 : (63 − nlz(a)) >> 1` (floor) and `log4ceil(a) = a ≤ 1 ? 0 : (65 − nlz(a − 1)) >> 1` (ceil): `SRC/gregtech/api/util/GTUtility.java#L3607-L3618`, **[jar]** same.

## 2. Overclocking

### 2.1 The calculator

Every electric machine (singleblock and multiblock) computes overclocks with `gregtech.api.util.OverclockCalculator`. The non-laser path, as it is in this version:

```java
// SRC/gregtech/api/util/OverclockCalculator.java#L367-L419 (bytecode identical, [jar])
double duration = durationUnderOneTickSupplier != null ? durationUnderOneTickSupplier.get()
    : this.duration * durationModifier;
currentParallel = Math.max(currentParallel, parallel);
double recipePower = recipeEUt * parallel * eutModifier * calculateHeatDiscountMultiplier();
double machinePower = machineVoltage * (amperageOC ? machineAmperage : Math.min(machineAmperage, parallel));
int tiersAbove = (int) GTUtility.log4((long) machinePower / Math.max((long) Math.ceil(recipePower), 32));
if (noOverclock) { calculatedConsumption = (long) Math.ceil(recipePower); calculatedDuration = (int) Math.ceil(duration); return; }
if (laserOC) { ... }                                    // TecTech laser hatches only
overclocks = Math.min(maxOverclocks, tiersAbove);
if (!amperageOC) {
    int voltageTierMachine = (int) Math.max(GTUtility.log4ceil(machineVoltage / 8), 1);
    int voltageTierRecipe = (int) Math.max(GTUtility.log4ceil(recipeEUt / 8), 1);
    overclocks = Math.min(overclocks, voltageTierMachine - voltageTierRecipe);
}
overclocks = Math.max(overclocks, 0);
int heatOverclocks = Math.min(heatOC ? (machineHeat - recipeHeat) / HEAT_OVERCLOCK_THRESHOLD : 0, overclocks);
int regularOverclocks = overclocks - heatOverclocks;
calculatedConsumption = (long) Math.ceil(recipePower * GTUtility.powInt(eutIncreasePerOC, overclocks));
duration /= GTUtility.powInt(durationDecreasePerHeatOC, heatOverclocks);
duration /= GTUtility.powInt(durationDecreasePerOC, regularOverclocks);
calculatedDuration = (int) Math.max(duration, 1);
```

*Verified by reviewer:* `javap -cp $GT --multi-release 17 -c -p -constants -l gregtech.api.util.OverclockCalculator` matches this listing line for line (LineNumberTable 369–419). Examples: `ldc2_w 32l … Math.max:(JJ)J … ldiv … GTUtility.log4:(J)J` for `tiersAbove`, `sipush 1800 … idiv` for the heat OCs, `dconst_1 … Math.max:(DD)D … d2i` for the 1-tick floor, and `max(log4ceil(V/8), 1)` (`ldc2_w 8l ldiv … log4ceil … lconst_1 … Math.max`) for "ULV counts as LV". A separate Python port written from that bytecode (`oc_port.py`, session scratch) passes **all 46 non-laser tests** in `GT_OverclockCalculator_UnitTest.java` at the tag (77/77 assertions). That includes `correctWhenOneTicking_Test` (`PASS correctWhenOneTicking dur got 1 expected 1`, `… eut got 30720 expected 30720.0`).

Defaults ([jar] constructor bytecode `OverclockCalculator.<init>` and `static final` constants):

| Field | Default | Meaning |
|---|---|---|
| `eutIncreasePerOC` | 4.0 | EU/t multiplier per OC |
| `durationDecreasePerOC` | 2.0 (4.0 after `enablePerfectOC()`) | duration divisor per regular OC |
| `durationDecreasePerHeatOC` | 4.0 (final) | duration divisor per heat OC |
| `HEAT_OVERCLOCK_THRESHOLD` / `HEAT_DISCOUNT_THRESHOLD` | 1800 / 900 | K per heat OC / per discount step |
| `heatDiscountExponent` | 0.95 | EU multiplier per discount step |
| `machineAmperage`, `parallel`, `maxTierSkip` | 1, 1, 1 | |
| `maxOverclocks`, `maxRegularOverclocks` | `Integer.MAX_VALUE` | no OC limit |

Consequences:
- **No limit at one tick.** Nothing caps the overclock count by duration. The duration is floored at 1 tick, but `EU/t` keeps growing ×4 per OC. **[test]** `correctWhenOneTicking_Test` (`src/test/java/gregtech/overclock/GT_OverclockCalculator_UnitTest.java#L246-L253`): a 30 EU/t, 1-tick recipe at LuV voltage gives duration 1 and `VP[1] * 4^5` = 30,720 EU/t. Multiblocks turn the excess into parallels (§2.3). Singleblocks waste it.
- **Durations are floored, not rounded.** `(int)` truncates: 200 ticks after 4 OCs is 12 ticks, not 12.5 or 13. **[test]** `weirdTimeOC_Test`: 77 ticks at 5 OCs → `(int)(77/32)` = 2.
- **The 32 EU/t floor.** `max(ceil(recipePower), 32)` means recipes under 32 EU/t count as 32 EU/t when the OCs are counted, but are charged their real EU/t. A ULV recipe gets no OC in an LV machine and one OC in MV (**[script]** 8 EU/t × 200 t: LV → 8 EU/t × 200 t, MV → 32 EU/t × 100 t). **[test]** the `ulvRecipeDoesntOverclockExtra...` family (lines 432–537) pins the ULV behaviour, e.g. Version5 (line 481): 8 EU/t × 16 parallel at HV without amperage OC → `(8*16) * 4^1`.
- **Energy per operation.** A standard OC multiplies EU per operation by 2 (×4 EU/t, ÷2 time). A perfect OC keeps EU per operation the same.

### 2.2 Singleblock basic machines

`MTEBasicMachine` builds the calculator from the recipe and its own tier:

- `recipeEUt = recipe.mEUt`, `duration = recipe.mDuration`, `machineVoltage = V[mTier] × mAmperage`. The calculator's own amperage (`setAmperage`) stays at the default 1, parallel 1, `amperageOC` false (never set, so the field default `false`), no perfect OC. *Verified by reviewer:* [jar] `MTEBasicMachine.calculateCustomOverclock` = `new OverclockCalculator().setRecipeEUt(recipe.mEUt).setDuration(recipe.mDuration)`, then `overclockDescriber.createCalculator(…)`, `calculate()`, `mEUt = (int) getConsumption()`, `mMaxProgresstime = getDuration()`. `EUOverclockDescriber.createCalculator` = `getstatic GTValues.V … getfield tier laload … getfield amperage i2l lmul … Ints.saturatedCast … setEUt`. **[src]** `SRC/gregtech/api/metatileentity/implementations/MTEBasicMachine.java#L733-L741` (`calculateCustomOverclock`) and `SRC/gregtech/api/objects/overclockdescriber/EUOverclockDescriber.java#L28-L30`: `return template.setEUt(Ints.saturatedCast(V[tier] * amperage));`. **[jar]** `MTEBasicMachine.createOverclockDescriber` → `new EUOverclockDescriber(mTier, mAmperage)`.
- **Corrected by reviewer.** This page used to say "`mAmperage` is 1 for every basic machine except the arc furnace". That is wrong. Every recipe-map singleblock (`MTEBasicMachineWithRecipe`, built by `MTEBasicMachineWithRecipeBuilder`) starts with **its recipe map's amperage** as `mAmperage`, and `newMetaEntity` copies it to the in-world machine. Results:
  - **Thermal centrifuge, all 12 tiers: `mAmperage = 2`**, so the overclock uses machine voltage `2 × V[tier]`. Its map is `.amperage(2)`, and its 12 builder chains do not override the amperage.
  - **Arc furnace, 12 tiers:** `setMachineAmperage(3)` and `setMachineEUtMultiplier(3)`. The recipe EU/t is tripled and the machine voltage is `3 × V[tier]` (`MTEBasicMachineWithRecipe.java#L526-L539`: `template.setRecipeEUt(saturatingMultiply(recipe.mEUt, multiplier))`). These are the only 12 `setMachineAmperage` and the only 12 `setMachineEUtMultiplier` calls in the jar.
  - Every other recipe map keeps the default amperage of 1. `RecipeMapBuilder.amperage` is called only for `thermalCentrifugeRecipes` (2), `massFabFakeRecipes` (8) and GTNH-Lanthanides `sourceChamberRecipes` (1).
  - Hand-written `MTEBasicMachine` subclasses pass their own amperage:
    - Mass Fabricator: 8. Its describer also sets `setEUtIncreasePerOC(2.0)` and `setMaxOverclocks(tier − 1)`.
    - Industrial Apiary: 4.
    - GT++ Atmospheric Reconditioner: 2.
    - Every other one checked passes 1: Replicator, Scanner, Rock Breaker, Pump, Miner, Boxinator, Potion Brewer, Name Remover, Ice Cream Machine, Better Jukebox, Drawer Framer, Advanced Seismic Prospector, Auto-Chisel and BartWorks Bio Lab.
  - **[jar]** `MTEBasicMachineWithRecipe.<init>(int, String, String, int, String[], RecipeMap, int, int, boolean, boolean, int, SoundResource, SpecialEffects, ITexture[], Object[])`: `aload 6; invokevirtual RecipeMap.getAmperage:()I` is passed as the 5th argument (`aAmperage`) of `invokespecial MTEBasicMachine."<init>":(ILjava/lang/String;Ljava/lang/String;II[Ljava/lang/String;II[Lgregtech/api/interfaces/ITexture;)V`.
  - **[jar]** `RecipeMap.getAmperage` = `frontend.getUIProperties().amperage`, and `BasicUIPropertiesBuilder.<init>` has `iconst_1 putfield amperage` (default 1). `RecipeMaps.<clinit>` pushes `iconst_2` before `RecipeMapBuilder.amperage` for `gt.recipe.thermalcentrifuge` and `bipush 8` for `gt.recipe.massfab`.
  - **[jar]** `LoaderMetaTileEntities` makes 479 builder chains. The 12 that `getstatic RecipeMaps.arcFurnaceRecipes` each call `setMachineAmperage` and `setMachineEUtMultiplier` after `iconst_3`. The 12 that use `RecipeMaps.thermalCentrifugeRecipes` call neither.
  - **[jar]** A constant-pool scan of `$GT` (`cp_scan.py … '*.setMachineAmperage'`) finds callers only in `LoaderMetaTileEntities` and the builder.
  - **[jar]** Constructor arguments: `MTEMassfabricator` passes `bipush 8`, `MTEIndustrialApiary` `iconst_4`, `MTEAtmosphericReconditioner` `iconst_2`.
  - **[src]** `SRC/gregtech/api/metatileentity/implementations/MTEBasicMachineWithRecipe.java#L72-L85` (`super(aID, aName, aNameRegional, aTier, aRecipes.getAmperage(), …)`) and `#L286-L300` (`newMetaEntity` passes `this.mAmperage`).
  - **[src]** `SRC/gregtech/common/tileentities/machines/basic/MTEBasicMachineWithRecipeBuilder.java#L191-L194`, `SRC/gregtech/api/recipe/RecipeMaps.java#L164-L168` and `SRC/gregtech/common/tileentities/machines/basic/MTEMassfabricator.java#L70-L75` and `#L216-L221`.
  - **Impact.** The crushed-ore thermal centrifuge recipe is 48 EU/t × 500 t (**[jar]** `ProcessingCrushedOre`: `sipush 500 … GTRecipeBuilder.duration … bipush 48 … GTRecipeBuilder.eut … getstatic RecipeMaps.thermalCentrifugeRecipes`). From MV up it gets **one more OC** than a 1 A model would give ([script] reviewer port, `tc_example.py`):

    | Tier | Real machine (2 A) | A 1 A model would give |
    |---|---|---|
    | MV | 192 EU/t × 250 t | 48 EU/t × 500 t |
    | HV | 768 EU/t × 125 t | 192 EU/t × 250 t |
    | EV | 3,072 EU/t × 62 t | 768 EU/t × 125 t |
    | IV | 12,288 EU/t × 31 t | 3,072 EU/t × 62 t |
- So for a singleblock, with `A = mAmperage` and `E` = the recipe EU/t (×3 for the arc furnace): `n = max(0, min(floor(log4(A·V[t] / max(E, 32))), max(1, log4ceil(A·V[t]/8)) − max(1, log4ceil(E/8))))`. The second term, the voltage-tier cap, never binds harder than the first for a recipe the machine can start. **[script]** brute force over EUt 1..200,000 at tiers ULV..UV: 0 cases for 1 A machines, 0 for the 3 A ×3 arc furnace, and 0 for the 2 A thermal centrifuge (*reviewer re-run, `tc_example.py`: "amps 2 xEU 1 map amperage 2 : voltage cap binds harder in 0 cases"*). In practice `n = floor(log4(A·V[t] / max(E, 32)))`. The Mass Fabricator is the exception: ×2 EU per OC, capped at tier − 1 OCs.

**Worked example: 30 EU/t, 200-tick recipe in an MV machine** (a 1 A machine, V = 128):

1. `recipePower = 30`, `machinePower = 128 × min(1, 1) = 128`.
2. `tiersAbove = log4(128 / max(30, 32)) = log4(4) = 1`.
3. Voltage-tier cap: machine `max(log4ceil(128/8 = 16), 1) = 2`, recipe `max(log4ceil(30/8 = 3), 1) = 1` → cap 1. So `n = 1`.
4. `EU/t = ceil(30 × 4) = 120`, `duration = max(200 / 2, 1) = 100` ticks = 5 s, EU per operation 12,000 (LV: 6,000).

The same recipe across tiers in a 1 A machine ([script], port validated in §2.5; *reviewer re-ran this table with `examples.py` and got identical rows*):

| Machine | OCs | EU/t | Ticks | EU per op |
|---|---|---|---|---|
| LV (32) | 0 | 30 | 200 | 6,000 |
| MV (128) | 1 | 120 | 100 | 12,000 |
| HV (512) | 2 | 480 | 50 | 24,000 |
| EV (2,048) | 3 | 1,920 | 25 | 48,000 |
| IV (8,192) | 4 | 7,680 | 12 | 92,160 |

ULV recipe (8 EU/t × 200 t): LV 8 EU/t × 200 t (no OC), MV 32 EU/t × 100 t, HV 128 EU/t × 50 t.

Steam (bronze/steel) singleblocks use a separate steam describer; they were not studied here (**UNVERIFIED** for the planner; the class is `gregtech.api.objects.overclockdescriber.SteamOverclockDescriber`).

### 2.3 Multiblocks

Multiblocks that use `ProcessingLogic` (practically all of them in this version) set the calculator as follows:

```java
// SRC/gregtech/api/metatileentity/implementations/MTEMultiBlockBase.java#L1146-L1151 ([jar] same)
boolean useSingleAmp = !debugEnergyPresent && mEnergyHatches.size() == 1 && mExoticEnergyHatches.isEmpty();
logic.setAvailableVoltage(getAverageInputVoltage());
logic.setAvailableAmperage(useSingleAmp ? 1 : getMaxInputAmps());
logic.setAmperageOC(true);

// SRC/gregtech/api/logic/ProcessingLogic.java#L578-L589
return new OverclockCalculator().setRecipeEUt(recipe.mEUt).setAmperage(availableAmperage).setEUt(availableVoltage)
    .setMaxTierSkips(maxTierSkips).setDuration(recipe.mDuration).setDurationModifier(speedBoost)
    .setEUtDiscount(euModifier).setAmperageOC(amperageOC)
    .setDurationDecreasePerOC(overClockTimeReduction).setEUtIncreasePerOC(overClockPowerIncrease);
```

- `ProcessingLogic` defaults ([jar] `<init>`): `maxParallel 1`, `batchSize 1`, `euModifier 1.0`, `speedBoost 1.0`, `maxTierSkips 1`, `overClockTimeReduction 2.0`, `overClockPowerIncrease 4.0`, `amperageOC true`.
- *Verified by reviewer:*
  - [jar] `MTEMultiBlockBase.setProcessingLogicPower`: `getfield mEnergyHatches … ArrayList.size … iconst_1 if_icmpne`, then `mExoticEnergyHatches … isEmpty`, then `getAverageInputVoltage → setAvailableVoltage`, `lconst_1` or `getMaxInputAmps → setAvailableAmperage`, and `iconst_1 → setAmperageOC`.
  - It is called on every recipe check through `setupProcessingLogic` (`SRC/…/MTEMultiBlockBase.java#L1132-L1139`).
  - `ProcessingLogic.createOverclockCalculator` passes `availableAmperage`, `availableVoltage`, `maxTierSkips`, `amperageOC`, `overClockTimeReduction` and `overClockPowerIncrease` into the calculator.
  - `ExoticEnergyInputHelper.getAverageInputVoltageMulti` does a `ladd` per valid hatch and then `ldiv` by `Collection.size`, so the average is integer-floored and an invalid hatch still counts in the divisor.
  - `MTEExtendedPowerMultiBlockBase` (the EBF extends it via `MTEAbstractMultiFurnace`) overrides only which hatch list these helpers read: normal plus exotic hatches.
  - 29 classes mention `setProcessingLogicPower` (`utf8_scan.py`), mostly mega, fusion and Godforge machines. Check a multiblock against that list before assuming the default.
- `getAverageInputVoltage()` = sum of the hatches' input voltages ÷ number of hatches. `getMaxInputAmps()` = sum of `maxWorkingAmperesIn()` = 2 per normal energy hatch. **[src]** `SRC/gregtech/api/util/ExoticEnergyInputHelper.java#L76-L103`; **[jar]** `MTEHatch.maxWorkingAmperesIn()` returns `maxAmperesIn()`, and `MTEHatchEnergy.maxAmperesIn()` is `ldc2_w 2l`.
- With amperage OC there is no voltage-tier cap. `n = floor(log4(Vavg × A / max(EUt × parallel × mods, 32)))`.
- **One energy hatch counts as 1 A**, even though the hatch accepts 2 A. **Two or more hatches count as all their amps.** Two hatches of tier t give 4 A, the same overclock power as one hatch of tier t+1.

| Hatches (30 EU/t × 200 t recipe) | A used for OC | OCs | EU/t | Ticks |
|---|---|---|---|---|
| 1 × MV | 1 | 1 | 120 | 100 |
| 2 × MV | 4 | 2 | 480 | 50 |
| 2 × LV | 4 | 1 | 120 | 100 |
| 1 × HV | 1 | 2 | 480 | 50 |

([script] port of the calculator, §2.5.)

Avoid mixing hatch tiers. The average voltage of one LV and one MV hatch is 80 V, which then drives both the OC power (80 × 4) and the recipe voltage limit (80 × 4).

**Overclocks below one tick become parallels (multiblocks only).** Before counting parallels, `ParallelHelper` multiplies the machine's max parallel by `calculator.calculateMultiplierUnderOneTick()`. That is the speed-up that would have been lost below 1 tick, rounded up. The recipe then runs 1 tick with `EU/t = recipeEUt × 4^n` and that many parallels, so EU per item follows the normal OC rule.
- **[src]** `SRC/gregtech/api/util/ParallelHelper.java#L409-L425`: `maxParallel = GTUtility.safeInt((long) (maxParallel * calculator.calculateMultiplierUnderOneTick()), 0);`; `OverclockCalculator.java#L424-L497` (`calculateMultiplierUnderOneTick`).
- Example ([script]): 30 EU/t, 2-tick recipe, one IV hatch: 4 OCs, multiplier 8, so 8 parallels per 1-tick operation at 7,680 EU/t, i.e. 960 EU per item (= 60 × 2⁴).
- **[test]** `testCorrectEUtWhenOverclockingUnderOneTick_Test` and `stopsCorrectlyWhenOverclockingUnderOneTick` (lines 363–423).

**Order of operations.** `ParallelHelper.determineParallel()` first checks the power limits from §1.2(c). Then it sets the parallel count to `min(maxParallel, availableEUt / ceil(EUt·mods), what the inputs allow)`. Only then does it overclock with `parallel = min(originalMaxParallel, currentParallel)` (**[src]** `ParallelHelper.java#L476-L508`). Parallels take the power headroom first. Example ([script]): a 12-parallel machine with one HV hatch, a 16 EU/t recipe and a 0.75 EU modifier runs 12 × 16 × 0.75 = 144 EU/t with **no** OC, because `log4(512/144) = 0`.

### 2.4 Which machines use which overclock

- **Standard (×4 EU, ÷2 time):** all singleblocks and every multiblock that does not change it. *Corrected by reviewer:* the singleblock Mass Fabricator (`MTEMassfabricator`) is an exception. Its `MassfabricatorOverclockDescriber.createCalculator` uses ×2 EU per OC and at most tier − 1 OCs at 8 A. **[jar]** `ldc2_w 2.0d … setEUtIncreasePerOC`, `getfield tier … iconst_1 isub … setMaxOverclocks`.
- **Perfect (×4 EU, ÷4 time)** via `ProcessingLogic.enablePerfectOverclock()` = `setOverclock(4.0, 4.0)`. **[jar]** constant-pool scan of `$GT` for `enablePerfectOverclock`: `MTELargeChemicalReactor`, `MTEMegaChemicalReactor` (+ BartWorks legacy), `MTEFrothFlotationCell` (+ GT++ legacy), `MTEIsaMill`, `MTECircuitAssemblyLine` (BartWorks), `MTENaquadahFuelRefinery` (+ GoodGenerator legacy), `MTEElementalDuplicator`, `MTEMassFabricator` (GT++), `MTEAdvFusionMk4/Mk5`. `enablePerfectOC` (calculator directly): `MTELargeEssentiaSmeltery`. **[src]** `SRC/gregtech/common/tileentities/machines/multi/MTELargeChemicalReactor.java#L155`: `return new ProcessingLogic().enablePerfectOverclock();`.
- **Heat-based perfect OCs + heat discount** (`setHeatOC(true)`, `setHeatDiscount(true)`). **[jar]** scan for `setHeatOC`: `MTEElectricBlastFurnace`, `MTEAdvEBF` (Volcanus), `MTEIndustrialAlloySmelter` (Zyngen), `MTEIndustrialDehydrator` (Utupu-Tanuri), `MTEExothermicHearth`, `MTEEndothermicFridge`, `MTEEntropicProcessor`, BartWorks legacy Mega EBF / Mega Vacuum Freezer, KubaTech `MTEDEFusionCrafter`, two Godforge modules. Details in §6.4.
- **Custom ratios:** KubaTech `MTEIndustrialArcFurnace` (`logic.setOverclock(electrode.OCSpeedFactor, electrode.OCPowerFactor)`, `SRC/kubatech/tileentity/gregtech/multiblock/MTEIndustrialArcFurnace.java#L595-L601`), Godforge modules, fusion. **Laser OC** (TecTech laser hatches) is out of scope (`OverclockCalculator.calculateLaserOCs`, lines 345–365).

### 2.5 Validation vectors and a port

A Python port of `calculateOverclock` and `calculateMultiplierUnderOneTick` passed 21/21 checks taken from GT's own `GT_OverclockCalculator_UnitTest` at the tag ([script]; checks include heat OC, perfect OC, 4 A amperage OC, ULV with and without amperage OC, 1-tick recipes, under-one-tick parallels, EU discount precision). The planner's port (TypeScript) should be tested against the same file, `src/test/java/gregtech/overclock/GT_OverclockCalculator_UnitTest.java` at the tag. Reference pseudo-code:

```text
oc(recipeEUt, duration, V, A=1, parallel=1, ampOC, eutPerOC=4, durPerOC=2, eutMod=1, durMod=1,
   heatOC=false, heatDiscount=false, recipeHeat=0, machineHeat=0, currentParallel=None):
  if currentParallel given: parallel = min(parallel, currentParallel)
  d   = duration * durMod
  hdx = heatDiscount ? trunc((machineHeat - recipeHeat) / 900) : 0
  rp  = recipeEUt * parallel * eutMod * 0.95^hdx
  mp  = V * (ampOC ? A : min(A, parallel))
  n   = floorlog4( trunc(mp) div max(ceil(rp), 32) )          # integer division
  if !ampOC: n = min(n, max(1, ceillog4(V div 8)) - max(1, ceillog4(recipeEUt div 8)))
  n   = max(n, 0)
  h   = min(heatOC ? trunc((machineHeat - recipeHeat) / 1800) : 0, n)
  eut = ceil(rp * eutPerOC^n)
  d   = d / 4^h / durPerOC^(n - h)
  return eut, max(trunc(d), 1), n
```

For a singleblock, call it with `V = V[tier] × mAmperage`, `A = 1` and `ampOC = false`, using the machine's real `mAmperage` from §2.2 (2 for the thermal centrifuge). For the arc furnace also pass `recipeEUt × 3` (*reviewer note*).

## 3. Power delivery

### 3.1 Singleblock draw and internal buffer

| Property (`MTEBasicMachine`) | Value |
|---|---|
| `maxEUInput()` (highest safe voltage) | `V[tier]` |
| `maxAmperesIn()` | `(mEUt × 2) / V[tier] + 1` (integer); 1 A when idle, 2 A at a full-amp recipe |
| `maxEUStore()` | `64 × V[tier]` |
| `getMinimumStoredEU()` | `16 × V[tier]`; a recipe is only checked when at least `8 × V[tier]` is stored |
| Energy use | `mEUt` drained from the internal buffer every tick while running |

- **[src]** `SRC/gregtech/api/metatileentity/implementations/MTEBasicMachine.java#L370-L388` and `#L722-L724` (`isUniversalEnergyStored(getMinimumStoredEU() / 2)`). **[jar]** `maxAmperesIn`: `getfield mEUt ... ldc2_w 2l lmul ... laload ldiv ... ladd`; `getMinimumStoredEU`: `ldc2_w 16l`; `maxEUStore`: `ldc2_w 64l`.
- Average draw is simply the overclocked EU/t. For cable sizing, count `ceil(EU/t ÷ delivered volts)` amps per machine. A machine can briefly pull up to `maxAmperesIn` amps to refill.
- The OC depends only on the machine's own tier, never on the supply voltage. An MV machine on an LV supply still overclocks to MV power and then runs short of energy (§3.5).

### 3.2 Emitter loss (generators, battery buffers, transformers)

Every GT tile that sends EU (`isEnetOutput()`) sends `oldOutput` volts per packet but pays `oldOutput + 2^max(0, getTier(oldOutput) − 1)` EU per amp out of its buffer. It only sends amps it can pay while staying above `getMinimumStoredEU()`.

```java
// SRC/gregtech/api/metatileentity/BaseMetaTileEntity.java#L452-L468 ([jar] same)
int voltageTier = Math.max(0, GTUtility.getTier(oldOutput) - 1);
// voltage + output loss
long outputVoltage = Math.max(oldOutput, oldOutput + (1L << voltageTier));
long availableAmperage = (getStoredEU() - mMetaTileEntity.getMinimumStoredEU()) / outputVoltage;
long usableAmperage = Math.min(getOutputAmperage(), availableAmperage);
...
final long eu = outputVoltage * Util.emitEnergyToNetwork(oldOutput, usableAmperage, this);
decreaseStoredEU(eu, true);
```

| Output tier | Packet volts | EU paid per amp | Loss |
|---|---|---|---|
| ULV | 8 | 9 | 11.1 % |
| LV | 32 | 33 | 3.0 % |
| MV | 128 | 130 | 1.5 % |
| HV | 512 | 516 | 0.78 % |
| EV | 2,048 | 2,056 | 0.39 % |
| IV | 8,192 | 8,208 | 0.20 % |

Each hop through a buffer or transformer pays this again on its output side.

*Verified by reviewer:* [jar] `BaseMetaTileEntity.handleEUOutput` has `iconst_0 … getfield oldOutput … GTUtility.getTier … iconst_1 isub … Math.max(II)`, then `lconst_1 iload_1 lshl ladd … Math.max(JJ)` (cost per amp). Next comes `(getStoredEU − getMinimumStoredEU) / outputVoltage`, then `Math.min(getOutputAmperage, …)`, then `IEnergyConnected$Util.emitEnergyToNetwork(oldOutput, amps, this)`, which sends the packet at `oldOutput` volts. `oldOutput` is set from `getOutputVoltage()` = `maxEUOutput()` while `isEnetOutput()`.

### 3.3 Cables and wires

**Model** (`gregtech.api.graphs`). The cable network is split into paths between junctions. Each path stores `mMaxAmps` = the smallest amperage of its cables, `mMaxVoltage` = the smallest voltage rating, and `mLoss` = the **sum** of `mCableLossPerMeter` over its cables (**[src]** `SRC/gregtech/api/graphs/paths/PowerNodePath.java#L156-L168`, **[jar]** `processPipes`: `Math.min(... mAmperage ...)`, `mCableLossPerMeter ... ladd`, `Math.min(... mVoltage ...)`).
- **Voltage loss:** a packet that crosses a path has `mLoss` subtracted from its volts. The consumer receives `V_source − Σloss` EU per amp, while the source still paid for the full packet. **[src]** `SRC/gregtech/api/graphs/PowerNodes.java#L165-L181`: `tPath.applyVoltage(aVoltage - tVoltLoss, true); tVoltLoss += tPath.getLoss(); long tAmps = aConsumer.injectEnergy(aVoltage - tVoltLoss, aMaxAmps);`.
- **Over-voltage burns at once:** `if (aVoltage > mMaxVoltage)` every cable on the path rated below the packet's voltage is set on fire (`BaseMetaPipeEntity.setToFire()` = `world.setBlock(x, y, z, Blocks.fire)`, so the cable block is destroyed). **[src]** `PowerNodePath.java#L57-L67`; **[jar]** `BaseTileEntity.setToFire` (`public final`; `BaseMetaPipeEntity` extends `CommonBaseMetaTileEntity` extends `CoverableTileEntity` extends `BaseTileEntity`): `getstatic Blocks.field_150480_ab ... World.func_147449_b`. *Corrected by reviewer:* the method is declared in `BaseTileEntity`, not `CommonBaseMetaTileEntity`. `javap -p` of `CommonBaseMetaTileEntity` and `BaseMetaPipeEntity` lists no `setToFire`; **[src]** `SRC/gregtech/api/metatileentity/BaseTileEntity.java#L556-L558`.
- **Over-amperage burns after a buffer:** `mAmps` is reduced by `mMaxAmps` for every tick that passed and increased by every amp carried. When `mAmps > 40 × mMaxAmps`, cables with `40 × mAmperage < mAmps` burn. A cable rated a amps that carries a + x amps every tick burns after about `40·a / x` ticks. A 1 A cable carrying 2 A lasts about 40 ticks (2 s). Short spikes are tolerated. GT does not throttle amps to the cable rating: sources send what consumers accept. **[src]** `PowerNodePath.java#L70-L95`; **[jar]** `addAmps`: `getfield mMaxAmps ... ldc2_w 40l lmul`. *Verified by reviewer:*
  - [jar] `addAmps` checks `mAmps > mMaxAmps·40` and then, per cable, `MTECable.mAmperage … ldc2_w 40l lmul … mAmps lcmp ifge … setToFire`.
  - `reset(int)` does `bipush 100` (more than 100 ticks idle resets to 0), then `mMaxAmps × ticks … lsub … Math.max`.
  - `applyVoltage` does `mMaxVoltage lcmp` and then, per cable, `MTECable.mVoltage … mVoltage lcmp … setToFire`.
  - `processPipes` takes `Math.min` of `mAmperage` and `mVoltage` and `ladd`s `mCableLossPerMeter`.
  - `PowerNodes.processNodeInject` delivers `aConsumer.injectEnergy(aVoltage - tVoltLoss, …)`, with `tVoltLoss` summed over the self-path and the path (`SRC/gregtech/api/graphs/PowerNodes.java#L165-L181`).
- Loss is per amp and absolute, so it hurts low voltages most: 10 blocks of tin cable (loss 1) deliver 22 of 32 V (31 % lost); 10 blocks of annealed copper at MV deliver 118 of 128 V (7.8 %); silver at HV 502 of 512 (2 %).

**Cable table** (LV–IV conductors, plus superconductors up to IV). `lossCable` is for insulated cables, `lossWire` for bare wires (bare wires also shock players). Amps scale ×1, 2, 4, 8, 12, 16 for 1x … 16x. MTE IDs: wire 1x/2x/4x/8x/12x/16x = `start + 0..5`, cable 1x … 16x = `start + 6..11`.

| Tier (V) | Material | 1x amps | Loss/block cable | Loss/block wire | MTE ID start |
|---|---|---|---|---|---|
| ULV (8) | Red Alloy | 1 | 0 | 1 | 2000 |
| LV (32) | Cobalt | 2 | 1 | 2 | 1200 |
| LV | Lead | 2 | 2 | 4 | 1220 |
| LV | Tin | 1 | 1 | 2 | 1240 |
| LV | Zinc | 1 | 1 | 2 | 1260 |
| LV | Soldering Alloy | 1 | 1 | 2 | 1280 |
| MV (128) | Iron | 2 | 3 | 6 | 1300 |
| MV | Nickel | 3 | 3 | 6 | 1320 |
| MV | Cupronickel | 4 | 3 | 6 | 1340 |
| MV | Copper | 1 | 2 | 4 | 1360 |
| MV | Annealed Copper | 1 | 1 | 2 | 1380 |
| HV (512) | Kanthal | 5 | 3 | 6 | 1400 |
| HV | Gold | 3 | 2 | 4 | 1420 |
| HV | Electrum | 2 | 1 | 2 | 1440 |
| HV | Silver | 1 | 1 | 2 | 1460 |
| HV | Blue Alloy | 2 | 1 | 2 | 1480 |
| EV (2,048) | Nichrome | 6 | 4 | 8 | 1500 |
| EV | Steel | 2 | 3 | 6 | 1520 |
| EV | Black Steel | 4 | 1 | 2 | 1540 |
| EV | Titanium | 4 | 2 | 4 | 1560 |
| EV | Aluminium | 1 | 1 | 2 | 1580 |
| EV | TPV-Alloy | 6 | 1 | 2 | 1840 |
| IV (8,192) | Graphene (wire only, no shock) | 1 | — | 2 | 1600 |
| IV | Platinum | 2 | 1 | 2 | 1640 |
| IV | Tungstensteel | 4 | 4 | 8 | 1660 |
| IV | Tungsten | 6 | 2 | 4 | 1680 |
| MV / HV / EV / IV | Superconductor Base (wire only) | 1 / 2 / 3 / 4 | — | 2 / 8 / 16 / 64 | 2200 / 2220 / 2240 / 2260 |
| MV / HV / EV / IV | Superconductor (wire only, no shock) | 4 / 6 / 8 / 12 | — | 0 | 2320 / 2340 / 2360 / 2380 |

- **[src]** `SRC/gregtech/loaders/preload/LoaderMetaPipeEntities.java#L68-L570` (`WireCableBuilder ... .startId(1240).lossCable(1).lossWire(2).amperage(1).voltage(TierEU.LV)`) and `#L939-L1122` (`new MTECable(startId + 0, ... lossWire, 1L * amperage, ...)` … `new MTECable(startId + 11, ... lossCable, 16L * amperage, voltage, true, false)`). **[jar]** decoding the `registerWiresAndCables` bytecode gives the same **58** builder calls (e.g. `Tin {'startId': 1240, 'lossCable': 1, 'lossWire': 2, 'amperage': 1, 'voltage': 'LV'}`). *Corrected by reviewer:* this said 57. The reviewer's decoder prints `build() calls in registerWiresAndCables: 58`, the tagged source has 58 `WireCableBuilder.builder()` chains, and every LV–IV row in the table above matches both. **[jar]** `MTECable.<init>(int, String, String, float, Materials, long, long, long, boolean, boolean)` stores argument 6 → `mCableLossPerMeter`, 8 → `mAmperage` and 10 → `mVoltage`, the fields `PowerNodePath.processPipes` reads.

### 3.4 Over-voltage: what explodes

- A GT tile explodes when an injected packet's volts **after cable loss** exceed `getInputVoltage()` (= `maxEUInput()`, i.e. `V[tier]` for machines, hatches and buffers). It explodes even for a single amp. *Reviewer note:* in `injectEnergyUnits` the voltage check comes **after** the early returns. A tile that does not accept input on that side, is already full (`getStoredEU() >= getEUCapacity()`), or has used its amps for the tick returns 0 without the check. It explodes on the next packet it does accept. **[jar]** `injectEnergyUnits(ForgeDirection, long, long)`: `inputEnergyFrom … ifeq 65`, `getStoredEU … getEUCapacity … lcmp ifge 65`, `maxAmperesIn … mAcceptedAmperes … lcmp ifgt 67`, `65: lconst_0 lreturn`, `67: lload_2 … getInputVoltage … lcmp ifle 100 … doExplosion(J)V`. Plan as if any over-voltage connection will explode the machine. **[src]** `SRC/gregtech/api/metatileentity/BaseMetaTileEntity.java#L1842-L1855`: `if (aVoltage > getInputVoltage()) { GTLog.writeExplosionLog(..., "Energy Explosion, injected " + aVoltage + ...); doExplosion(aVoltage); return 0; }`; **[jar]** `injectEnergyUnits`: `getInputVoltage ... lcmp ... doExplosion(J)V`.
- The explosion removes the block (`setBlock(..., Blocks.air)`). If `machineExplosions` is true it also calls `createExplosion` with a strength from `getExplosionPowerForVoltage(voltage)`: < 8 V → 1, < 32 → 2, < 128 → 3, < 512 → 4, < 2,048 → 5, < 4,096 → 6, < 8,192 → 7, < 32,768 → 8, ... up to 20 (**[src]** `MetaTileEntity.java#L672-L688`, `GTValues.java#L463-L475`).
- If `machineWireFire` is true, an exploding electric machine first dumps its stored EU into its cables as IV packets (`emitEnergyToNetwork(V[5], max(1, stored / V[5]))`), which burns any cable rated below IV (**[src]** `BaseMetaTileEntity.java#L1340-L1351`).
- Environment, checked every tick for electric tiles (`handleElectricUpdates` → `handleEnvironmentalEffects`):
  - With `machineRainExplosions`, a machine that `willExplodeInRain()` passes a 1/1000 roll each tick. Then, if it is raining and the machine is exposed, 1 in 10 of those rolls explode it and the rest set it on fire.
  - With `machineThunderExplosions`, during thunder the same 1/1000 roll also explodes an exposed machine with probability 1/3.
  - `machineFireExplosions` gives a 1/1000 roll per tick to explode when a random neighbouring block is fire.
  - **[src]** `BaseMetaTileEntity.java#L319`, `#L424-L433`, `#L490-L551`. The pack's `config/GregTech/GregTech.cfg` has all of these at their default `true` (`B:machineExplosions=true`, `B:machineFireExplosions=true`, `B:machineRainExplosions=true`, `B:machineThunderExplosions=true`, `B:machineWireFire=true`). The planner should place new machines under a roof or check `willExplodeInRain` per machine type (**UNVERIFIED**: which machine types return true).

### 3.5 Under-voltage and power shortage

There is no under-voltage damage. A tile accepts any packet up to its rated voltage and stores it. What happens when the stored energy runs out:

- **Singleblock:** if `drainEnergyForProcess(mEUt)` fails, the machine "stutters". If `canHaveInsufficientEnergy()` (true by default), it sets `mProgresstime = -100`. The progress made so far is lost and the machine waits 100 ticks before progressing again. The recipe's outputs are kept, so items are not lost. **[src]** `MTEBasicMachine.java#L606-L635`, `#L921-L923`; **[jar]** `onPostTick`: `invokevirtual canHaveInsufficientEnergy ... bipush -100`.
- **Multiblock:** if `drainEnergyInput(EU)` fails, `stopMachine(POWER_LOSS)` runs. It clears `mOutputItems`/`mOutputFluids` (the inputs were consumed when the recipe started, so **the recipe is lost**), sets progress to 0 and calls `disableWorking()`. **[src]** `MTEMultiBlockBase.java#L1052-L1064` and `#L1428-L1452`; `MTEExtendedPowerMultiBlockBase.java` `onRunningTick` does the same.
  - *Verified by reviewer:*
    - [jar] `MTEMultiBlockBase.onRunningTick` and `MTEExtendedPowerMultiBlockBase.onRunningTick` both do `getActualEnergyUsage → drainEnergyInput`, then on failure `getstatic ShutDownReasonRegistry.POWER_LOSS → stopMachine`.
    - `MTEMultiBlockBase.stopMachine` does `aconst_null putfield mOutputItems`, `aconst_null putfield mOutputFluids`, then `IGregTechTileEntity.disableWorking`. The extended override only zeroes `lEUt` and calls super.
    - Inputs are consumed when the recipe starts: `ProcessingLogic` builds `ParallelHelper.setConsumption(true)`, and `inputConsumer.consume(…)` runs in `determineParallel` (`SRC/gregtech/api/util/ParallelHelper.java#L486-L497`).
  - *Refined by reviewer: what turns it back on.* This used to say "until a player turns it back on". A player can (soft mallet, `BaseMetaTileEntity.java#L1497-L1515`, or the GUI power button: a constant-pool scan finds `gregtech/common/gui/modularui/multiblock/base/MTEMultiBlockBaseGui` among the `enableWorking` callers). So can a cover:
    - `POWER_LOSS` is a **critical** reason: [jar] `ShutDownReasonRegistry.<clinit>`: `ldc "power_loss" … invokestatic SimpleShutDownReason.ofCritical`.
    - A **Machine Controller cover** (`CoverControlsWork`) in a non-safe "enable/disable with redstone" mode calls `machine.enableWorking()` on every tick its redstone condition holds. That restarts the multiblock without a player.
    - In the cover's safe modes, a critical shutdown sets the cover to `DISABLED`, so the machine stays off. **[src]** `SRC/gregtech/common/covers/CoverControlsWork.java#L96-L130`.
    - A constant-pool scan of `$GT` for `enableWorking` callers also finds `CoverWirelessController` and `CoverAdvancedRedstoneReceiverInternal`.
    - Planner impact: a non-safe Machine Controller cover is a way to auto-restart after brownouts. Each restart still loses the recipe that was running.
- A multiblock decides recipe and overclock from its **hatch** voltage, not the supply. An HV hatch fed at MV still overclocks to HV power, receives at most 2 A × 128 V = 256 EU/t, and shuts down. The planner must make sure each hatch is fed at its own tier with enough amps.
- Multiblock maintenance: energy actually drawn is `EUt × 10000 / max(1000, mEfficiency)`, where `mEfficiency = 10000 − 1000 × (missing maintenance tools)` at recipe start. Each open maintenance problem costs about 11 % more EU. **[src]** `MTEMultiBlockBase.java#L1066-L1068`, `#L1110`.

### 3.6 Transformers

A transformer between tiers t+1 and t has `mTier` = t, the lower tier. The enum name is `transformer_<higher>_<lower>`. The display name is "<long name of tier t> Transformer" (`gt.blockmachines.transformer.name=%1$s Transformer`), so the MV↔LV transformer shows as "Low Voltage Transformer". Its mode follows `isAllowedToWork()`, which the soft mallet toggles (`BaseMetaTileEntity.java#L1497-L1515`).

| `MTETransformer` (tier t) | Step-down (allowed to work, default) | Step-up (disabled) |
|---|---|---|
| Input face(s) | front only | the 5 non-front faces |
| Input volts / max amps accepted | `V[t+1]`, 2 A (GUI shows 1 A) | `V[t]`, 5 A (GUI shows 4 A) |
| Output face(s) | the 5 non-front faces | front only |
| Output volts / amps | `V[t]`, 4 A | `V[t+1]`, 1 A |
| Buffer | `max(512, 2^(t+2)) + 4 × V[t+1]` EU, minimum stored `V[t+1]` | same |

- **[src]** `SRC/gregtech/api/metatileentity/implementations/MTETransformer.java#L124-L177`; **[jar]** `maxEUInput`/`maxEUOutput` (`isAllowedToWork ... iconst_1 iadd`), `maxAmperesOut` (`4l` / `lconst_1`), `maxAmperesIn` (`2l` / `5l`). IDs: `transformer_LV_ULV` = 20 (t = 0) … `transformer_UHV_UV` = 28 (**[jar]** `MetaTileEntityIDs`: `bipush 20` for `transformer_LV_ULV`).
- **NBT:** `BaseMetaTileEntity` saves `mWorks` **inverted**: `nbt.setBoolean("mWorks", !mWorks)` and loads `mWorks = !nbt.getBoolean("mWorks")`. A saved `mWorks: 0b` means *allowed to work* (step-down for a transformer). **[src]** `BaseMetaTileEntity.java#L148`, `#L196`; **[jar]** `... getfield mWorks:Z ifne 185 iconst_1 goto 186 iconst_0 ... func_74757_a` (setBoolean).
- Hi-Amp Transformer (GT++ `MTETransformerHiAmp`, tiers 0–8): step-down 16 A out / up to 6 A in (shows 4 A), step-up 4 A out / up to 24 A in (shows 16 A). Half mode: 8 / 3 and 2 / 12. Buffer `(512 + 2·V[t+1]) × 8`. **[src]** `SRC/gtPlusPlus/xmod/gregtech/api/metatileentity/implementations/base/MTETransformerHiAmp.java#L42-L70`.
- Power Transformer (`MTEWetTransformer`): step-down 64 A out / 20 A in (shows 16 A), step-up 16 A out / 80 A in (shows 64 A). Half mode: 32 / 10 and 8 / 40. Buffer `512 + 128·V[t+1]`. **[src]** `SRC/gregtech/api/metatileentity/implementations/MTEWetTransformer.java#L92-L119`.
- A transformer is an emitter, so it pays the §3.2 loss on its output side: an MV→LV step-down spends 4 × 33 = 132 EU from its buffer to send 4 × 32 = 128 EU. That is why it accepts up to 2 MV amps.

### 3.7 Energy hatches

Normal energy hatch (`MTEHatchEnergy`): `maxEUInput = V[tier]`, `maxAmperesIn = 2`, buffer `512 + 8·V[tier]`. **[src]** `SRC/gregtech/api/metatileentity/implementations/MTEHatchEnergy.java#L76-L88`; **[jar]** `ldc2_w 2l`, `ldc2_w 512l ... ldc2_w 8l lmul`. Multi-amp and laser hatches (TecTech) exist from EV up; they appear as "exotic" hatches in §2.3 and were not studied further.

### 3.8 Line parts

These are the parts the line layout sizes besides machines, cables and transformers: conveyor and pump covers, the item filter cover, bus and hatch sizes, a basic machine's input filter, and the idle power of AE2 parts. Plan 5's `src/server/layout/parts.ts` uses them.

*Provenance:* these facts were recorded for Plan 5 Task 3. Each one names the class and method it comes from. `$GT` and the AE2 jar were **not** re-read when this section was written, so none of its claims carries a **[jar]** or **[src]** tag yet. Treat them as **UNVERIFIED** against the jars until someone checks them. Plan 5's `GTNH_LOCAL` check runs against a real export and prints every part key that does not resolve.

**Conveyor covers.**
- `gregtech.common.items.MetaGeneratedItem01.registerCovers` builds `new CoverConveyor(ctx, tickRate, stacksPerTransfer, itemsPerStack, texture)`.
- `CoverConveyor.doTransfer` moves up to `stacksPerTransfer` stacks of at most `itemsPerStack` items every `tickRate` ticks. That gives `stacksPerTransfer × itemsPerStack × 20 / tickRate` items/s.
- The items are `IDMetaItem01.Conveyor_Module_<T>`, ids 630…636, which are `gregtech:gt.metaitem.01@32630…32636`.

**Pump covers.**
- They are built as `new CoverPump(ctx, litresPerTick, texture)`.
- `CoverPump.transferFluid` moves `mTransferRate × tickRate` L per run, so `litresPerTick × 20` L/s.
- The rate is 32 L/t at LV and grows ×4 per tier, up to 131,072 L/t at ZPM.
- The items are `Electric_Pump_<T>`, ids 610…616, which are `@32610…32616`.

| Tier | Conveyor item | `(tickRate, stacksPerTransfer, itemsPerStack)` | Items/s | Pump item | L/t | L/s |
|---|---|---|---|---|---|---|
| LV | `@32630` Conveyor Module (LV) | (100, 1, 16) | 3.2 | `@32610` Electric Pump (LV) | 32 | 640 |
| MV | `@32631` Conveyor Module (MV) | (100, 1, 64) | 12.8 | `@32611` Electric Pump (MV) | 128 | 2,560 |
| HV | `@32632` Conveyor Module (HV) | (20, 1, 64) | 64 | `@32612` Electric Pump (HV) | 512 | 10,240 |
| EV | `@32633` Conveyor Module (EV) | (4, 1, 64) | 320 | `@32613` Electric Pump (EV) | 2,048 | 40,960 |
| IV | `@32634` Conveyor Module (IV) | (1, 1, 64) | 1,280 | `@32614` Electric Pump (IV) | 8,192 | 163,840 |
| LuV | `@32635` Conveyor Module (LuV) | (1, 4, 64) | 5,120 | `@32615` Electric Pump (LuV) | 32,768 | 655,360 |
| ZPM | `@32636` Conveyor Module (ZPM) | (1, 16, 64) | 20,480 | `@32616` Electric Pump (ZPM) | 131,072 | 2,621,440 |

- Planner use: `COVER_RATES` holds this table. `pickConveyor` and `pickPump` take the smallest cover at or below the line's tier (never below LV) that carries the flow. When none does, they take the biggest one and the layout warns `cover_rate`.

**Item filter cover.**
- The cover items are `ItemFilter_Export` (270, `@32270`, "Filtered Conveyor Cover (Export)") and `ItemFilter_Import` (271, `@32271`).
- `CoverItemFilter` holds one filter item (`LimitingItemStackHandler(1, 1)`) and has a whitelist toggle. It actively moves the items that match.
- It does **not** block other items. `letsItemsIn` and `letsItemsOut` are true for every item, and `MTEItemPipe` asks only its own side cover's `letsItemsOut(-1)`. So the cover never stops a pipe from delivering other items into the machine it sits on.
- `@32729` is `Component_Filter`, a crafting component, not the cover.

**Buses and hatches.**
- A bus has `MTEHatch.getSlots(tier) = (tier + 1)²` item slots. Input buses have one more slot, for a programmed circuit.
- A fluid hatch holds `MTEHatchInput` / `MTEHatchOutput.getCapacity() = 8000 << tier` L.

| Tier | ULV | LV | MV | HV | EV | IV |
|---|---|---|---|---|---|---|
| Bus slots `(tier + 1)²` | 1 | 4 | 9 | 16 | 25 | 36 |
| Fluid hatch L `8000 × 2^tier` | 8,000 | 16,000 | 32,000 | 64,000 | 128,000 | 256,000 |

- Planner use: `busSlots`, `hatchLitres` and `pickHatch` take the lowest tier that holds what one run needs. When no hatch is big enough, the layout warns `hatch_small`.

**Machine input filter.**
- `MTEBasicMachine.mDisableFilter` starts `true`. The GUI shows "Input Filter Off" (lang key `GT5U.hatch.disableFilter.true`).
- `allowPutStack` calls `allowPutStackValidated` (the recipe-map check) only when the filter is on.
- So by default a basic machine takes any item a pipe offers. It takes items through its output side only while its "Input from Output Side" is allowed.

**Input from Output Side (`mAllowInputFromOutputSide`, GT 5.09.54).**
- It starts **on**: every `MTEBasicMachine` constructor does `iconst_1; putfield mAllowInputFromOutputSide`. `ItemMachines.placeBlockAt` hands the item's NBT to `setInitialValuesAsNBT`, and a newly crafted item has none, so a newly placed machine keeps it on.
- It is saved as the NBT key `mAllowInputFromOutputSide`, and `loadNBTData` reads a missing key as false. An item that carries other NBT (a machine broken with a cover or paint on it: `BaseMetaTileEntity` writes `mColor`, the covers and the upgrades into the drop) therefore places a machine with it **off**.
- `allowPutStack` refuses items on the output side (`getFrontFacing()`) while it is off; `isLiquidInput` does the same for fluids. The front (`mMainFacing`) takes nothing either way.
- The GUI has no button for it. The only control is a **Screwdriver** right-click on the machine's output side or its front (`onScrewdriverRightClick`, on the side clicked, not the wrench grid's side). Each click switches it and says the new state in chat: "Input from Output Side allowed" / "Input from Output Side forbidden" (`gt.interact.desc.input_from_output_on`/`_off`). A sneaking click switches the Input Filter instead. The same click also works the cover on the side clicked (`Cover.onCoverScrewdriverClick`; a conveyor cover changes its mode), so a covered output side is the wrong place to click.
- Since the front faces along the row (below), it touches the machine beside it once the row is built, and the Screwdriver has no wrench grid to reach past it: the only side a builder can click is the output side, the middle-row side, and only before a pipe, conduit, ME interface (a full block) or cover goes there.
- Planner use: a step that needs it says "Input from Output Side allowed" and that a click on the middle-row side switches it, so a builder who clicks once to "set" it does not switch it off. The place step of a machine that takes items adds the check while the middle row is still empty: a newly crafted machine has it; for one broken and placed again, one Screwdriver click on the middle-row side, and one more if the chat says "Input from Output Side forbidden". An EnderIO face that inserts through the output side says to click that side beside the conduit.

**Fluids through the output side (GT 5.09.54, javap of `MTEBasicMachine` in the base class and `META-INF/versions/17` and `/21`, `BaseMetaTileEntity`, `MTEBasicTank`).**
- `isLiquidOutput(side)` is `side != mMainFacing`, and `isLiquidInput(side)` is `side != mMainFacing && (mAllowInputFromOutputSide || side != getFrontFacing())`: the rule `allowPullStack` and `allowPutStack` give items. `BaseMetaTileEntity.fill` / `canFill` ask `isLiquidInput` and the side's cover (`letsFluidIn`), `drain` / `canDrain` ask `isLiquidOutput` (`letsFluidOut`), then `MTEBasicTank.fill` takes a fluid the recipe map uses into the one input tank (`isFluidInputAllowed`) and `drain` gives the output tank (`getDrainableStack` = `mFluidOut`).
- No basic machine in the jar overrides these (`javap -p` of all 34 `MTEBasicMachine` subclasses in it, BartWorks' and GT++'s included: only the ice cream machine and the industrial apiary change their item rules). `MTEBasicMachineBronze` (steam) overrides `isLiquidInput` to `side != mMainFacing`; its tank takes steam, and its output side must stay clear to vent (`allowToCheckRecipe` refuses while a cover or a block with a hitbox is there).
- EnderIO 2.10.46's liquid conduits join a GT tile only when `getMetaTileEntity().getCapacity() > 0` (`AbstractLiquidConduit.canConnectToExternal`); `MTEBasicMachineWithRecipe` has a tank (`getCapacityForTier`) exactly when its recipes use fluids. Each conduit of a bundle connects to its neighbour on its own.
- Planner use: in EnderIO mode a GT basic machine (pack kind `basic`) has one connection: the conduit bundle at its output side holds its Item Conduit face and its Ender Fluid Conduit face, and a machine that takes fluids there gets Input from Output Side too (its place step says so, naming fluids). A multiblock's fluid hatches, and any other single-block machine's top, keep a riser.

**Front and output side (`mMainFacing`, `mFacing`).**
- `isValidMainFacing` allows only the four sides, never up or down, and `setMainFacing` refuses any other. `initDefaultModes` makes the side the machine was placed facing (toward the player) the front, else west, and `setMainFacing` turns the output side to the opposite side when it was on the new front.
- A sneaking Wrench click calls `setMainFacing` on the side the wrench grid picks (`GTUtility.determineWrenchingSide`: the centre of a face picks that face, an edge picks the side beyond it, a corner the back). A plain Wrench click makes that side the output side (`MetaTileEntity.onWrenchRightClick`), allowed anywhere but the front.
- Items, fluids and energy never pass the front (`allowPullStack`, `allowPutStack`, `isLiquidInput`, `isLiquidOutput`, `isInputFacing`).
- Planner use: a singleblock's front faces along the row toward the power head (local west), its output side the middle row, and its place step says which wrench click sets each, naming the front by the compass (turned with the line), since the place steps come before the power head is built. The 3D view and the in-game ghost draw the face overlay on that front; the projector mod checks both sides.

**AE2 idle draw (rv3-beta-1073-GTNH).**
- `AENetworkProxy.idleDraw` defaults to 1.0 AE/t.
- `PartCable` sets it to 0.0.
- `TileInterface` / `DualityInterface` and `PartExportBus` keep the default of 1 AE/t.
- `AEConfig` `PowerRatios.IC2` defaults to 2.0, and GTNH's `AppliedEnergistics2.cfg` keeps `D:IC2=2.0`. So 1 EU = 2 AE.
- Planner use: `ae2IdleEUt` = Σ idle AE/t of the placed ME interfaces, ME cables and export buses ÷ 2. The result is added to the line's power before the power fit.

## 4. Generators and storage

### 4.1 Basic steam turbines

`MTESteamTurbine` (extends `MTEBasicGenerator`). Every 10 ticks it converts steam to EU in whole "operations". Each operation turns `consumedFluidPerOperation = getEfficiency() = 6 + tier` litres of any steam into `getFuelValue = 3` EU, limited by free buffer space. It outputs 1 A of `V[tier]` (the `MetaTileEntity.maxAmperesOut()` default of 1) from its **front face only**.

| Tier | MTE ID | Name | Out | Steam → EU | Efficiency (tooltip) | Steam for full output (incl. emitter loss) | Steam tank | EU buffer |
|---|---|---|---|---|---|---|---|---|
| LV | 1120 | Basic Steam Turbine | 32 V × 1 A | 7 L → 3 EU (0.4286 EU/L) | 85 % | 33 EU/t = 77 L/t = **1,540 L/s** | 24,000 L | 3,072 |
| MV | 1121 | Advanced Steam Turbine | 128 V × 1 A | 8 L → 3 EU (0.375 EU/L) | 75 % | 130 EU/t = 346.7 L/t = **6,933 L/s** | 48,000 L | 10,752 |
| HV | 1122 | Turbo Steam Turbine | 512 V × 1 A | 9 L → 3 EU (0.333 EU/L) | 66 % | 516 EU/t = 1,548 L/t = **30,960 L/s** | 72,000 L | 41,472 |

- **[src]** `SRC/gregtech/common/tileentities/generators/MTESteamTurbine.java#L51-L99`: `isOutputFacing: side == getFrontFacing()`, `getCapacity: 24000 * mTier`, `getEfficiency: 6 + mTier`, `getFuelValue: GTModHandler.isAnySteam(aLiquid) ? 3 : 0`, `consumedFluidPerOperation: getEfficiency()`. **[jar]** `sipush 24000 ... imul`, `bipush 6 ... iadd`, `iconst_3`. `SRC/gregtech/api/metatileentity/implementations/MTEBasicGenerator.java#L204-L219`: `tFluidAmountToUse = min(mFluid.amount / tConsumed, (maxEUStore() - stored) / tFuelValue)`, `maxEUOutput = V[mTier]` (when enabled), `maxEUStore = max(EUVar, V[mTier] * 80 + getMinimumStoredEU())` with the default minimum of 512 (`MetaTileEntity.java#L457-L459`).
- Lang (`assets/gregtech/lang/en_US.lang` line 9964): "Converts Steam into EU\nBase rate: 2L of Steam -> 1 EU\nFuel Efficiency: %s%%\nConsumes up to %sL of Steam per second". The tooltip numbers use the integer efficiency `600 / (6 + tier)` and `4000 × (V[t] + 2^(t−1)) / eff`, which gives 1,552 / 6,933 / 31,272 L/s. The exact values in the table come from the per-operation code.
- *Verified by reviewer:*
  - [jar] `MTESteamTurbine`: `getEfficiency` = `bipush 6 … mTier iadd`; `getFuelValue` = `GTModHandler.isAnySteam … iconst_3`; `getCapacity` = `sipush 24000 … imul`; `consumedFluidPerOperation` = `getEfficiency`; `isOutputFacing` = `getFrontFacing if_acmpne`.
  - [jar] `MTEBasicGenerator.maxEUOutput` = `isAllowedToWork ? V[mTier] : 0`, and `maxEUStore` = `max(getEUVar, V[mTier]·ldc2_w 80l + getMinimumStoredEU)`.
  - [jar] `MetaTileEntity.maxAmperesOut` = `lconst_1` and `getMinimumStoredEU` = `ldc2_w 512l`. `javap -p` shows no override of either in `MTESteamTurbine`, `MTEBasicGenerator`, `MTEBasicTank` or `MTETieredMachineBlock`.
  - [jar] `MTEBasicGenerator.onPostTick` runs on `ldc2_w 10l lrem`, then `min(amount / consumed, (maxEUStore − stored) / fuelValue)`.
  - A read-only scan of the newest world backup agrees: no turbine holds more than `V·80 + 512`, LV and HV turbines sit exactly at 3,072 and 41,472 when full, and full tanks are 24,000 / 48,000 / 72,000 L. The samples are in the local notes.
- **The lower tier is the more efficient one** (85.7 % > 75 % > 66.7 %).
- Superheated steam is rejected **and deleted**: `isFluidInputAllowed` sets `aFluid.amount = 0` for superheated steam (`MTESteamTurbine.java#L219-L225`). Do not route it into basic turbines.
- Delivered EU per litre after the emitter loss: LV 0.4156, MV 0.3692, HV 0.3307 ([script]).

### 4.2 Solar boilers

Both solar boilers are `MTEBoiler` subclasses. Their numbers come from `MachineStats` config. The pack's `config/GregTech/MachineStats.cfg` keeps the defaults: `bronzesolarboiler {calcificationTicks=1080000, cooldownTicks=45, maxOutputPerSecond=120, minOutputPerSecond=40}`, `steelsolarboiler {calcificationTicks=1080000, cooldownTicks=75, maxOutputPerSecond=360, minOutputPerSecond=120}`. Defaults: **[src]** `SRC/gregtech/common/config/MachineStats.java#L36-L80`.

| | Simple Solar Boiler | Advanced ("high pressure") Solar Boiler |
|---|---|---|
| Class / MTE ID | `MTEBoilerSolar` / 105 | `MTEBoilerSolarSteel` / 114 (`HIGH_PRESSURE_SOLAR_BOILER`, `ItemList.Machine_HP_Solar`) |
| Steam output while hot | 120 L/s | 360 L/s |
| Fully calcified output | 40 L/s | 120 L/s |
| Water / steam tank | 16,000 L / 16,000 L | 32,000 L / 32,000 L |
| Cooling | 1 °C per 10 ticks | 1 °C per 16 ticks |

Mechanics (**[src]** `MTEBoiler.java#L251-L422`, `MTEBoilerSolar.java#L118-L221`, `MTEBoilerSolarSteel.java#L26-L56`; **[jar]** `MTEBoilerSolar.updateFuel`: `ldc2_w 240l`, `World.func_72911_I` (isThundering), `getSkyAtSide`, `func_72896_J` (isRaining), `BiomeGenBase.field_76751_G` (rainfall), `World.field_73008_k` (skylightSubtracted) `iconst_4`, `func_72935_r` (isDaytime), `bipush 40` / `iconst_5`; `getMaxTemperature`: `sipush 500`; `getCooldownInterval`: `getCooldownTicks() / 5`):

- Temperature runs from 20 to 500 °C. Every 10 ticks, if the temperature is **above 100 °C** and there is water, it makes `getProductionPerSecond() / 2` steam. Output is flat: full rate at 101 °C and at 500 °C.
- Heating: only when the stored "processing energy" is used up, and only on ticks divisible by 240. If it is thundering, or the block's top face cannot see the sky, nothing is added. Clear weather (or a biome with rainfall 0) adds 40 by day (`world.isDaytime()`) and 5 by night. Rain adds 5 if `skylightSubtracted < 4`, otherwise nothing. Every 12 ticks, 5 energy turns into +5 °C.
- Cooling: −1 °C every `cooldownTicks / 5 + 1` ticks (16 for the advanced boiler, 10 for the simple one), every tick, whether or not it is producing. *Verified by reviewer:* [jar] `MTEBoiler.calculateCooldown` is `bipush 20 if_icmpgt …`, then `mLossTimer iconst_1 iadd … getCooldownInterval if_icmple … iconst_1 isub`, i.e. `++mLossTimer > 75/5`. That fires every 16th tick. The config comment "Number of ticks it takes to lose 1°C" for `cooldownTicks` (75) does not describe what the code does.
- Steam goes out of the **front face only** (`pushSteamToSide(front)`). If the steam tank goes over capacity it vents down to ¾.
- If it is above 100 °C with no water and water is added later, it explodes (`doExplosion(2048)`). Never let a hot boiler run dry.
- Vanilla daytime: `isDaytime()` is `skylightSubtracted < 4`. **[jar]** `minecraft_server.1.7.10.jar` `ahb.w()` = `getfield j iconst_4 if_icmpge` (World), `ahb.a(F)` = the cos/×11 brightness formula, `aqo.a(JF)` = celestial angle. That makes 13,081 of 24,000 ticks "day" (world time 23,459 → 12,540). Forge patches `World.isDaytime` to ask the dimension's `WorldProvider`. For the Overworld this should give the same answer, but that and any pack mod that changes the day cycle are **UNVERIFIED**. Other dimensions (planets) may differ.

Simulated steady state ([script], a tick-by-tick port of the rules above plus the vanilla day formula, clear weather, sky visible, water always present):

| | Advanced (360 L/s) | Simple (120 L/s) |
|---|---|---|
| Ticks per Minecraft day above 100 °C | 22,842 / 24,000 (95.2 %) | 17,293 / 24,000 (72.1 %) |
| Steam per Minecraft day | 410,940 L | 103,680 L |
| Average over the whole day | 342.4 L/s | 86.4 L/s |
| When steam stops / restarts (world time) | goes cold at ≈22,640 (≈10,100 ticks after dusk), hot again at ≈23,796 (≈340 ticks after dawn) | |
| Cold start at sunrise → first steam | 793 ticks | |
| Rain from 500 °C (rain all day) | stops after 8,399 ticks (≈7 min) | |
| Thunder from 500 °C | stops after 6,399 ticks (≈5.3 min) | |

*Refined by reviewer.* An independent tick-by-tick port (`solar_sim_verify.py`) emulates float32 for the jar's `aqo.a(JF)`, `ahb.a(F)`, `ahb.w()` and `qh.b(F)`, the latter being MathHelper's 65,536-entry sine table, `qh.<clinit>`. It reproduces the table: HP 22,842 hot ticks, 410,940 L and 342.4 L/s per day; simple 17,293 ticks, 103,680 L and 86.4 L/s; rain 8,399 ticks, thunder 6,399 ticks.

The result depends on the boiler's own tick counter. `aTick % 240`, `% 12` and `% 10` count from when the chunk was loaded, not from world time. Across all 240 phases:

| Boiler | Phases | Hot ticks/day | Average | No-steam gap |
|---|---|---|---|---|
| HP | 179 of 240 (most) | 22,577 | **338.2 L/s** | ≈71 s |
| HP | 61 of 240 | 22,842 | 342.4 L/s | ≈58 s |
| Simple | 118 of 240 | 16,843 | 84.2 L/s | |
| Simple | 122 of 240 | 17,293 | 86.4 L/s | |

So plan with **≈338 L/s** per clean HP boiler as the clear-weather day average.

Smaller differences: the reviewer counts 13,082 `isDaytime` ticks (edges 12,541 / 23,459) against 13,081 above, an off-by-one in the partial-tick convention. A cold start at sunrise gives first steam after 789–793 ticks.

Design impact: for advanced solar boilers the "night" gap is about **58–71 s per 20-minute day** in clear weather. Weather is the real risk: rain or thunder lasting more than a few minutes. Size battery buffers for weather, not for the night.

**Calcification** (`MTEBoilerSolar.java#L119-L176`):
- `mRunTime` (NBT int `mRunTime`) goes up by 10 for each 10-tick steam batch, but only while the tank holds plain `water`. **Distilled water never calcifies.** Only producing ticks count, and only while the chunk is loaded. *Verified by reviewer:*
  - [jar] `MTEBoilerSolar.produceSteam` checks `FluidStack.isFluidEqual(Water.getFluid(1))` before `mRunTimeTicks … bipush 10 iadd`.
  - `MTEBoiler.canNotCreateSteam` accepts either fluid through `GTModHandler.isWater`: `isFluidEqual(Water) || isFluidEqual(getDistilledWater(1))`, `SRC/gregtech/api/util/GTModHandler.java#L185-L188`.
  - `getProductionPerSecond` and `getMaxRuntimeTicks` are integer `imul`/`idiv` exactly as written below: `(360−120)·1,080,000/360 + 1,080,000 = 1,800,000`.
  - The pack's `config/GregTech/MachineStats.cfg` has `steelsolarboiler` `I:calcificationTicks=1080000`, `I:cooldownTicks=75`, `I:maxOutputPerSecond=360` and `I:minOutputPerSecond=120`.
- Output per second = `max` while `mRunTime ≤ calcificationTicks`. Between `calcificationTicks` and `getMaxRuntimeTicks() = (max−min)·calc/max + calc` it is `max − max·(mRunTime − calc)/calc` (integer maths). After that it is `min`. For the advanced boiler that is full output up to 1,080,000 producing ticks (15 h), linear down to 120 L/s at 1,800,000 (25 h). For the simple boiler: 1,080,000 → 1,440,000. The config comment "minimal output will be reached at 2 times this" is wrong; the code gives 1.67× and 1.33×.
- Planner estimate: `output(mRunTime)` per boiler from the world scan. For example, an advanced boiler at `mRunTime = 1,440,000` makes `360 − 360·360,000/1,080,000 = 240` L/s.
- Descaling: the lang text says "Calcifies over time, reducing Steam output to %sL/s\nBreak and replace to descale" (`en_US.lang` line 252). Only `MTEBoilerSolar` references `mRunTime` (**[jar]** constant-pool scan), so picking the boiler up does not carry it over.
- NBT keys the scan can read: `mTemperature`, `mProcessingEnergy`, `mLossTimer`, `mRunTime`, `mSteam` and `mFluid` (`{FluidName, Amount}`), `mExcessWater`, `fuelMaxEnergy` (`MTEBoiler.java#L198-L220`).

### 4.3 Battery buffers and batteries

`MTEBasicBatteryBuffer`, registered as 1×1, 2×2, 3×3 and 4×4 (1, 4, 9, 16 slots). MTE IDs: `160 + t`, `170 + t`, `180 + t`, `190 + t` for t = 0 (ULV) … 9 (UHV); UEV and up are in the 11240–11275 range (**[jar]** `MetaTileEntityIDs`, e.g. `BATTERY_BUFFER_1_BY_1_LV` → `sipush 161`, `BATTERY_BUFFER_4_BY_4_HV` → `sipush 193`; **[src]** `LoaderMetaTileEntities.java#L8502-L8691` (`registerBatteryBuffer1x1` … `registerBatteryBuffer4x4`), `new MTEBasicBatteryBuffer(BATTERY_BUFFER_1_BY_1_LV.ID, "batterybuffer.01.tier.01", "", 1, "", 1)` … `new MTEBasicBatteryBuffer(BATTERY_BUFFER_4_BY_4_UHV.ID, "batterybuffer.16.tier.09", "", 9, "", 16)`).

| Property (tier t, s slots) | Value |
|---|---|
| Voltage in / out | `V[t]` (explodes above it) |
| Output face | front only; input on the other 5 faces |
| Amps out | `mBatteryCount` = number of items with IC2 tier **== t** that can provide energy |
| Amps in | `2 × mChargeableCount` (items with tier == t) |
| Internal buffer | `64 × V[t] × s`, minimum kept `16 × V[t] × s` |
| Charge / discharge | charges the batteries when internal storage > 2/3 full, drains them into the buffer when < 1/3 |
| Total capacity | internal buffer + the sum of the batteries' max charge |

- **[src]** `SRC/gregtech/api/metatileentity/implementations/MTEBasicBatteryBuffer.java#L114-L157`, `#L199-L212`; `GTModHandler.java#L2280-L2298`: `isElectricItem(stack, tier)` requires `electricItem.getTier(aStack) == aTier`.
- *Verified by reviewer:*
  - [jar] `MTEBasicBatteryBuffer.onPostTick` (server side) zeroes both counters. Then, per slot, `getfield mTier … GTModHandler.isElectricItem:(Lnet/minecraft/item/ItemStack;B)Z` → `GTModHandler.isChargerItem` → `mBatteryCount++`, and `mChargeableCount++` for any tier match.
  - `isElectricItem(stack, byte)` is `instanceof ic2/api/item/IElectricItem … IElectricItem.getTier … if_icmpne` (exact equality). `isChargerItem` is `IElectricItem.canProvideEnergy`.
  - `maxAmperesOut` = `getfield mBatteryCount i2l`, read by `BaseMetaTileEntity.getOutputAmperage` = `maxAmperesOut()`.
  - So a buffer with no batteries, or only items of another tier, or only items that cannot provide energy, **outputs 0 A** (an `MTEBasicBatteryBuffer`; the chargers below differ).
  - `maxEUStore` = `V[mTier] · ldc2_w 64l · mInventory.length`. A world sample shows up to one packet more than this, because `injectEnergyUnits` accepts `1 + (capacity − stored) / voltage` amps. **[jar]** `maxAmperesOut`: `getfield mBatteryCount i2l`; `maxAmperesIn`: `mChargeableCount ... 2l lmul`; `maxEUStore`: `... 64l lmul ... arraylength i2l lmul`.
- Example: a 4×4 LV buffer full of Small Lithium Batteries holds 16 × 100,000 + 32,768 EU and can send 16 A × 32 V = 512 EU/t, paying 16 × 33 EU/t (§3.2).

Subclasses (*added in plan 10*). GT's chargers `MTECharger` (`batterycharger.16.tier.TT`, IDs 690–699 and 11280–11283) and `MTETurboCharger` (`batteryturbocharger.16.tier.TT`, IDs 12040–12049; it extends `MTECharger`), and TecTech's `MTETeslaCoil`, all extend `MTEBasicBatteryBuffer`, so the export lists them as battery buffers. Every charger and turbo charger has 4 slots: the `16` in its name is not a slot count. The chargers override the store and the amps; the Tesla coil overrides neither:

| Class (tier t, s slots) | Internal buffer (`maxEUStore`) | Minimum kept (`getMinimumStoredEU`) | Amps out | Amps in |
|---|---|---|---|---|
| `MTEBasicBatteryBuffer` (the table above) | `64 × V[t] × s` | `16 × V[t] × s` | `mBatteryCount` | `2 × mChargeableCount` |
| `MTECharger` | `256 × V[t] × s` | `64 × V[t] × s` | `max(4 × mBatteryCount, 2)` | `max(8 × mChargeableCount, 4)` |
| `MTETurboCharger` | `6,144 × V[t] × s` | `1,536 × V[t] × s` | `4 × s` | `16 × s` |
| `MTETeslaCoil` (TecTech) | inherited (`64 × V[t] × s`) | inherited | inherited | inherited |

- **[jar]**, read from `GT5-Unofficial-5.09.54.183-dev.jar`, the deobfuscated jar of the same GT version that the exporter compiles against (`javap --multi-release 17 -c -p -constants`; `MTECharger` and `MTETurboCharger` exist only as root classes, `MTEBasicBatteryBuffer` and `MTETeslaCoil` also under `META-INF/versions/17`, and both copies agree):
  - `MTECharger.maxEUStore` = `GTValues.V … mTier laload`, `ldc2_w 256l lmul`, `mInventory arraylength i2l lmul`; `getMinimumStoredEU` the same with `64l`; `maxAmperesOut` = `mBatteryCount i2l`, `4l lmul`, `2l`, `Math.max:(JJ)J`; `maxAmperesIn` = `mChargeableCount i2l`, `8l lmul`, `4l`, `Math.max`.
  - `MTETurboCharger` (`extends …basic.MTECharger`): `maxEUStore` with `6144l`, `getMinimumStoredEU` with `1536l`, `maxAmperesOut` = `4l`, `mInventory arraylength i2l lmul`, `maxAmperesIn` = `16l`, `mInventory arraylength i2l lmul`.
  - `MTEBasicBatteryBuffer`: `maxEUStore` with `64l` and `getMinimumStoredEU` with `16l`, in the root and the `META-INF/versions/17` class alike. `javap -p` of both `MTETeslaCoil` classes lists no `maxEUStore`, `getMinimumStoredEU`, `maxAmperesIn` or `maxAmperesOut`.
  - Slots: `LoaderMetaTileEntities.registerCharger4x4` and `registerTurboCharger4By4` pass slot count `iconst_4` to all 14 `MTECharger` and all 10 `MTETurboCharger` constructors (e.g. `new MTECharger(BATTERY_CHARGER_4_BY_4_LV.ID, "batterycharger.16.tier.01", "", 1, "", 4)`), and both constructors hand it on to `MTEBasicBatteryBuffer` unchanged.
- Example: an HV charger stores `256 × 512 × 4` = 524,288 EU of its own, an HV turbo charger `6,144 × 512 × 4` = 12,582,912 EU. A charger without a battery of its tier still has `maxAmperesOut()` = 2; a turbo charger's is 16 with or without batteries.

Batteries (tier = IC2 tier; max charge in EU):

| Tier | Item | Max charge | Notes |
|---|---|---|---|
| ULV | Tantalum Capacitor | 1,000 | |
| LV | Small Sodium / Cadmium / Lithium Battery | 50,000 / 75,000 / 100,000 | rechargeable |
| LV | Small Acid / Mercury Battery | 18,000 / 32,000 | single use |
| LV | RE-Battery (IC2) | 10,000 | |
| MV | Medium Sodium / Cadmium / Lithium Battery | 200,000 / 300,000 / 400,000 | |
| MV | Advanced RE-Battery (IC2) | 100,000 | |
| HV | Large Sodium / Cadmium / Lithium Battery | 800,000 / 1,200,000 / 1,600,000 | |
| HV | Energy Crystal (IC2) | 1,000,000 | |
| EV | Small Sunnarium Battery (`BatteryHull_EV_Full`) | 6,400,000 | |
| EV | Lapotron Crystal (IC2) | 10,000,000 | |
| IV | Medium Sunnarium Battery / Lapotronic Energy Orb | 25,600,000 / 100,000,000 | |

- **[jar]** `MetaGeneratedItem01.setAllElectricStats` decoded: `Battery_RE_LV_Lithium 100000 V[1] tier 1 special -3`, `Battery_RE_MV_Lithium 400000 V[2] 2 -3`, `Battery_RE_HV_Lithium 1600000 V[3] 3 -3`, `BatteryHull_EV_Full 6400000 V[4] 4 -3`, `Energy_Lapotronic_Orb 100000000 V[5] 5 -3`, ... (parameters `aMetaValue, aMaxCharge, aTransferLimit, aTier, aSpecialData, aUseAnimations`; `-3` rechargeable, `-2` single use). **[src]** `SRC/gregtech/common/items/MetaGeneratedItem01.java#L5209-L5247`. Names: `en_US.lang` lines 5080–5126 (`gt.item.battery.re.lv.lithium.name=Small Lithium Battery`, ...).
- **[jar]** IC2 (`$PACK/mods/industrialcraft-2-2.2.828-experimental.jar`, `ic2.core.init.BlocksItems`): `ItemBattery(itemBatRE, 10000.0, 32.0, 1)`, `(itemAdvBat, 100000.0, 256.0, 2)`, `(itemBatCrystal, 1000000.0, 2048.0, 3)`, `(itemBatLamaCrystal, 1.0E7, 8092.0, 4)`.
- Charge NBT: GT items store a long `GT.ItemCharge` in the item tag (**[jar]** `MetaBaseItem.getRealCharge`: `ldc "GT.ItemCharge" ... ItemStackNBT.getLong`). IC2 items store a double `charge` (**[jar]** `ic2.core.item.ElectricItemManager`: `ldc "charge" ... func_74769_h` getDouble). The exporter can also read max charge/tier at runtime through `ic2.api.item.IElectricItem.getMaxCharge/getTier/canProvideEnergy`, which covers items not listed here.

### 4.4 Steam power chain, end to end

For one advanced solar boiler feeding basic turbines of tier t (clear weather, no calcification):

`delivered EU/t = (steam L/s ÷ 20) × 3/(6+t) × V[t]/(V[t] + 2^(t−1)) − cable/transformer/buffer losses`

- One advanced boiler while hot (18 L/t): LV 7.48, MV 6.65, HV 5.95 EU/t delivered at the turbine face. Day average ×0.952.
- Boilers per turbine at full output: LV 4.28 (4.5 using the day average), MV 19.3 (20.3), HV 86 (90.4). With fully calcified boilers (120 L/s): LV 12.8.
- Steam a turbine cannot take fills its tank, then backs up into the boilers, which vent it. Spare turbine capacity costs nothing, spare boilers waste steam.

## 5. Multiblock footprints

### 5.1 Verdict

**Feasible.** StructureLib 1.4.45 keeps, for every structure piece, the exact set of cells the shape occupies. There are two ways to get bounding boxes at export time, and both have precedents in the pack:

1. **Static:** read each multiblock's `IStructureDefinition` (from `GregTechAPI.METATILEENTITIES[id]` instances that are `IConstructable`, e.g. every `MTEEnhancedMultiBlockBase`) and take the min/max of `StructureDefinition.occupiedSpaces` per piece. No world is needed.
2. **Dynamic:** on the throwaway export server, place each controller in a void area and call `IConstructable.construct(triggerStack, false)`, the same call the hologram projector uses, then scan the blocks it placed. The in-pack NEI preview mod, BlockRenderer6343, does exactly this in a dummy world and reads the bounding box from it. This also gives real block IDs per cell for the 3D view, and handles variable-size and multi-piece machines at their default size.

Use (2) for footprints and block lists, and (1) to find the cells that must stay **air** (see §5.3), which (2) cannot show. Hatch positions are not in a definition one can read; exporter 0.6.0 asks the controller's own check (§5.5).

### 5.2 Where the shape lives (StructureLib 1.4.45)

- **[jar]** `javap -cp $SL -p com.gtnewhorizon.structurelib.structure.StructureDefinition`:
  `private final Map<Character, IStructureElement<T>> elements;` `private final Map<String, String> shapes;` `private final Map<String, IStructureElement<T>[]> structures;` `private final Map<String, Set<Vec3Impl>> occupiedSpaces;` plus public `getElements()`, `getShapes()`, `getStructures()`, `getStructureFor(String)`, `isContainedInStructure(String, int, int, int)`. `occupiedSpaces` has no getter: read it by reflection, or probe `isContainedInStructure(piece, a, b, c)` over a box.
- **[jar]** `StructureDefinition$Builder.addShape(String, String[][])` bytecode:
  - It joins the strings with separator characters U+B000 (next row, B+1) and U+C000 (next layer, C+1). In the bytecode these are `ldc int 45056` and `ldc int 49152`; the A-step character is U+A000 (`int 40960`).
  - Then it walks the characters with a cursor (a, b, c). `' '` becomes an A-step (skip, not occupied). `'~'` (the controller) also becomes a step but **its cell is added** to the occupied set. Every other character (`'-'` must-be-air, `'+'` any-non-air, and element letters) adds `Vec3Impl(a, b, c)` to the occupied set.
  - Runs of steps are compressed into `StructureUtility.step(Vec3Impl)` navigation elements.
  - The finished set goes in `occupiedSpaces.put(name, set)`.
- Axes: the outer array index is **C** (depth, the controller's front layer is c = 0), the second index is **B** (vertical, **downward**), and the character index is **A** (horizontal across the front). Most GT shapes are written as `transpose(new String[][]{...})` (`transpose(arr)[j][i] = arr[i][j]`), so in the source text the outer groups are horizontal slices from top to bottom. Checked against the EBF: its `'~'` lands at (a, b, c) = (1, 3, 0), the same as `checkPiece(STRUCTURE_PIECE_MAIN, 1, 3, 0, ...)` (`SRC/gregtech/common/tileentities/machines/multi/MTEElectricBlastFurnace.java#L226`). The tooltip says "Front bottom center". Whether +A points left or right as you face the controller is **UNVERIFIED**. Use `ExtendedFacing.getWorldOffset` (what `StructureUtility.iterateV2` calls) to map to world coordinates rather than guessing.
- Walking a piece: `IStructureDefinition.iterate(piece, world, extendedFacing, x, y, z, offA, offB, offC, IStructureWalker)` hands the walker `visit(element, world, x, y, z, a, b, c)` for every element. It calls `world.blockExists` per cell (**[jar]** `StructureUtility.iterateV2` → `World.func_72899_e`), so it needs a real `World` (fine on the export server).
- Controller offsets (`checkPiece(piece, horizontalOffset, verticalOffset, depthOffset)` in `MTEEnhancedMultiBlockBase`) are hard-coded in each machine's `checkMachine`/`construct`. For single-piece machines they equal the `'~'` cell. Multi-piece and variable machines (Distillation Tower layers, Assembly Line slices, Cleanroom, LSC, PCB Factory upgrades, Industrial Coke Oven slices) compose pieces in Java code, so only method (2) gives their real size.
- **[jar]** BlockRenderer6343 (`$PACK/mods/blockrenderer6343-1.4.23.jar`): `GTGuiMultiblockHandler` calls `ISurvivalConstructable.survivalConstruct(ItemStack, int, ISurvivalBuildEnvironment)` or `IConstructable.construct(ItemStack, boolean)`. `GuiMultiblockHandler` then uses `TrackedDummyWorld.getSize()` / `getMinPos()` to frame the preview. **[jar]** `IConstructable`: `construct(ItemStack, boolean)`, `getStructureDefinition()`, `getStructureDescription(ItemStack)`.
- *Verified by reviewer:*
  - `javap -cp $SL -p …StructureDefinition` lists `private final java.util.Map<java.lang.String, java.util.Set<com.gtnewhorizon.structurelib.util.Vec3Impl>> occupiedSpaces;` and no getter for it.
  - In `StructureDefinition$Builder.addShape`, a space (`bipush 32`) becomes U+A000 (`ldc 40960`) with no `Set.add`. `'~'` (`bipush 126`) becomes U+A000 **and** does `Vec3Impl.getFromPool … Set.add`. Other characters `Set.add`, then `occupiedSpaces.put`.
  - `StructureUtility.transpose` is `rv[j][i] = arr[i][j]`.
  - Parsing the tagged EBF shape this way gives `W(A)=3 H(B)=4 D(C)=3 cells=36 controller(a,b,c)=(1, 3, 0)`, matching `checkPiece(STRUCTURE_PIECE_MAIN, 1, 3, 0, errors)` (`MTEElectricBlastFurnace.java#L226`).
  - `javap -c` of `blockrenderer6343.integration.gregtech.GTGuiMultiblockHandler` shows `ISurvivalConstructable.survivalConstruct` and `IConstructable.construct:(Lnet/minecraft/item/ItemStack;Z)V`. `…integration.nei.GuiMultiblockHandler` shows `TrackedDummyWorld.getSize:()Lorg/joml/Vector3f;` and `getMinPos`.
  - Note that `TrackedDummyWorld` sits in BlockRenderer6343's **client** package. A server-side export has to do method (2) in a real (void) world, not with that class.

### 5.3 Pitfalls

- **Air-clearance cells.** `'-'` cells must be air and are part of `occupiedSpaces`. The 2.9 Large Steam/Gas/HP turbines need a full 3×3 layer of air in front of the controller (shape 3×3×7, solid blocks 3×3×6). The 2.9 Large Combustion Engine needs air over its intakes (8×3×4, solid 8×3×3). The layout packer must keep these cells empty.
- **Tooltips are wrong sometimes.** `MultiblockTooltipBuilder.beginStructureBlock(w, h, l, hollow)` prints "Dimensions: L×W×H" (`SRC/gregtech/api/util/MultiblockTooltipBuilder.java#L415-L446`), and the numbers are typed by hand. Examples: the legacy `MTELargeBoiler` shape is 3×5×3, but its tooltip says `beginStructureBlock(5, 6, 3, ...)` (copied from the 2.9 boiler, `MTELargeBoiler.java#L155`). The Industrial Extrusion Machine shape is 9 wide × 4 deep, while the tooltip says w = 4, l = 9. The Industrial Wire Factory shape is 7 wide × 3 deep, while the tooltip says w = 3, l = 7. Do not use tooltips as data.
- **2.9 rewrote many multiblocks and kept the old ones as `...Legacy` classes with the old MTE IDs**, so upgraded worlds can contain both. Example: Large Steam Turbine new = ID 15524 (`MTELargeTurbineSteam`, 3×3×6 + air layer), legacy = ID 1131 (`MTELargeTurbineSteamLegacy`, 3×3×4 + air row). Both have the same internal name `multimachine.largeturbine` (**[src]** `LoaderMetaTileEntities.java`, `new MTELargeTurbineSteam(SteamTurbine.ID, "multimachine.largeturbine", "Large Steam Turbine")` and `new MTELargeTurbineSteamLegacy(LARGE_STEAM_TURBINE_CONTROLLER.ID, "multimachine.largeturbine", ...)`). The world scan must key on the MTE ID (NBT `mID`), not the name. New builds should use the new ID.
- Tiered or variable machines: Industrial Maceration Stack has T1/T2 shapes. The PCB Factory has tier 1/2/3 pieces. Distillation Tower height 3–12, Assembly Line length 5–16, Cleanroom 3–15 in each direction (`MTECleanroom.MAX_WIDTH = 15`, `MAX_HEIGHT = 15`), LSC height 4–50.

### 5.4 Reference table (common multiblocks to about IV)

"Shape" = bounding box of the literal `addShape` array in the tagged source, computed by script as W (A, across) × H (B, height) × D (C, depth). "+air" gives the box including required air cells, when it differs. "Tooltip" = the `beginStructureBlock(w, h, l)` arguments shown as W × H × D. "—" means the shape is built in code (not a literal), so only the tooltip is shown; check those with method (2). Paths are under `SRC/`; line = the `addShape(` call.

| Machine (MTE ID) | Class | Shape W×H×D | Tooltip W×H×D | Source |
|---|---|---|---|---|
| Electric Blast Furnace (1000) | `MTEElectricBlastFurnace` | 3×4×3 | 3×4×3 | `gregtech/common/tileentities/machines/multi/MTEElectricBlastFurnace.java#L77` |
| Vacuum Freezer (1002) | `MTEVacuumFreezer` | 3×3×3 | 3×3×3 | `.../multi/MTEVacuumFreezer.java#L90` |
| Implosion Compressor (1001) | `MTEImplosionCompressor` | 3×3×3 | 3×3×3 | `.../multi/MTEImplosionCompressor.java#L87` |
| Large Chemical Reactor (1169) | `MTELargeChemicalReactor` | 3×3×3 | 3×3×3 | `.../multi/MTELargeChemicalReactor.java#L66` |
| Multi Smelter (1003) | `MTEMultiFurnace` | 3×3×3 | 3×3×3 | `.../multi/MTEMultiFurnace.java#L71` |
| Oil Cracking Unit (1160) | `MTEOilCracker` | 5×3×3 | 5×3×3 | `.../multi/MTEOilCracker.java#L67` |
| Distillation Tower (1126) | `MTEDistillationTower` | 3×1×3 per layer | 3×(3–12)×3 | `.../multi/MTEDistillationTower.java#L74` |
| Pyrolyse Oven, 2.9 (15546) / legacy (1159) | `MTEPyrolyseOven` / `...Legacy` | 7×6×5 / 5×4×5 | 7×6×5 / 5×4×5 | `.../multi/MTEPyrolyseOven.java#L64`, `MTEPyrolyseOvenLegacy.java#L58` |
| Large Bronze/Steel/Titanium/Tungstensteel Boiler, 2.9 (15529–15532) / legacy (1020–1023) | `MTELargeBoilerBase` / `MTELargeBoiler` | 5×6×3 / 3×5×3 | 5×6×3 / (5×6×3, wrong) | `.../multi/MTELargeBoilerBase.java#L134`, `MTELargeBoiler.java#L72` |
| Large Steam / HP Steam / Gas Turbine, 2.9 (15524 / 15525 / 15527) | `MTELargeTurbineBase` subclasses | 3×3×6 (+air 3×3×7) | 3×3×6 | `.../multi/turbines/MTELargeTurbineBase.java#L62` |
| Large Steam / Gas Turbine, legacy (1131 / 1151; HP 1152) | `MTELargeTurbineLegacy` | 3×3×4 (+air 3×3×5) | — | `.../multi/MTELargeTurbineLegacy.java#L73` |
| Large Combustion Engine, 2.9 (15533) | `MTELargeCombustionEngine` | 8×3×3 (+air 8×3×4) | 8×3×3 | `.../multi/MTELargeCombustionEngine.java#L73` |
| Extreme Combustion Engine, 2.9 (15534) | `MTEExtremeCombustionEngine` | 10×5×5 | 10×5×5 | `.../multi/MTEExtremeCombustionEngine.java#L83` |
| Assembly Line (1170) | `MTEAssemblyLine` | 1×4×3 per slice | (5–16)×4×3 | `.../multi/MTEAssemblyLine.java#L79` |
| Cleanroom (1172) | `MTECleanroom` | — | (3–15)×(4–15)×(3–15) | `.../multi/MTECleanroom.java#L145` (tooltip) |
| Fluid Drilling Rig I–IV (1157, 141, …) | `MTEOilDrillBase` | — | 3×7×3 | `.../multi/MTEOilDrillBase.java#L283` (tooltip) |
| Ore Drilling Plant I–IV (1158, 1177, …) | `MTEOreDrillingPlantBase` | — | 3×7×3 | `.../multi/MTEOreDrillingPlantBase.java#L517` (tooltip) |
| Bricked Blast Furnace (140) | `MTEBrickedBlastFurnace` | 3×4×3 | 3×4×3 | `.../multi/MTEBrickedBlastFurnace.java#L77` |
| Coke Oven (236) | `MTECokeOven` | — | 3×3×3 | `.../multi/MTECokeOven.java#L88` (tooltip) |
| Charcoal Pile Igniter (1155) | `MTECharcoalPit` | — | (3–13)×(3–7)×(3–13) | `.../multi/MTECharcoalPit.java#L234` (tooltip) |
| Large Heat Exchanger (1154) | `MTEHeatExchanger` | 3×4×3 | 3×4×3 | `.../multi/MTEHeatExchanger.java#L69` |
| PCB Factory (356) | `MTEPCBFactory` | 7×6×7 (tier 1) | 7×6×7 | `.../multi/pcb/MTEPCBFactory.java#L132` |
| Industrial Centrifuge, 2.9 (15512) / GT++ legacy (790) | `MTEIndustrialCentrifuge` / `...Legacy` | 5×5×5 / 3×3×3 | 5×5×5 / 3×3×3 | `.../multi/MTEIndustrialCentrifuge.java`, `gtPlusPlus/.../processing/MTEIndustrialCentrifugeLegacy.java#L114` |
| Industrial Electrolyzer, 2.9 (15514) | `MTEIndustrialElectrolyzer` | 5×5×5 | 5×5×5 | `.../multi/MTEIndustrialElectrolyzer.java` |
| Industrial Maceration Stack, 2.9 (15539) / legacy (797) | `MTEIndustrialMacerator` | T1 3×6×3, T2 5×7×5 | 5×7×5 | `.../multi/MTEIndustrialMacerator.java#L146` |
| Industrial Mixing Machine, 2.9 (15566) | `MTEIndustrialMixer` | 5×7×5 | 5×7×5 | `.../multi/MTEIndustrialMixer.java` |
| Large Sifter, 2.9 (15542) | `MTEIndustrialSifter` | 5×6×5 | 5×6×5 | `.../multi/MTEIndustrialSifter.java#L94` |
| Large Thermal Refinery, 2.9 (15538) | `MTEIndustrialThermalCentrifuge` | — | 5×8×6 | `.../multi/MTEIndustrialThermalCentrifuge.java#L105` (tooltip) |
| Ore Washing Plant, 2.9 (15550) | `MTEOreWashingPlant` | — | 5×4×9 | `.../multi/MTEOreWashingPlant.java#L116` (tooltip) |
| Industrial Wire Factory, 2.9 (15511) | `MTEIndustrialWireMill` | **7×3×3** | 3×3×7 (W/D swapped) | `.../multi/MTEIndustrialWireMill.java` |
| Industrial Cutting Factory, 2.9 (15540) | `MTEIndustrialCuttingMachine` | 9×4×3 | 9×4×3 | `.../multi/MTEIndustrialCuttingMachine.java#L204` |
| Industrial Extrusion Machine, 2.9 (15549) | `MTEIndustrialExtruder` | **9×4×4** | 4×4×9 (W/D swapped) | `.../multi/MTEIndustrialExtruder.java#L60` |
| Industrial Sledgehammer, 2.9 (15555) | `MTEIndustrialForgeHammer` | 5×9×5 | 5×9×5 | `.../multi/MTEIndustrialForgeHammer.java#L105` |
| Industrial Forming Press, 2.9 (15552) | `MTEIndustrialFormingPress` | 5×5×3 | 5×5×3 | `.../multi/MTEIndustrialFormingPress.java#L55` |
| Industrial Bending Machine, 2.9 (15553) | `MTEIndustrialBendingMachine` | 6×3×3 | 6×3×3 | `.../multi/MTEIndustrialBendingMachine.java#L54` |
| Industrial Chemical Bath, 2.9 (15551) | `MTEIndustrialChemicalBath` | — | 4×5×5 | `.../multi/MTEIndustrialChemicalBath.java#L91` (tooltip) |
| Industrial Coke Oven, 2.9 (15543) | `MTEIndustrialCokeOven` | 6×7×5 first + 4×7×5 per slice | (6–36)×7×5 | `.../multi/MTEIndustrialCokeOven.java#L158` |
| Hyper-Intensity Laser Engraver (3004) | `MTEIndustrialLaserEngraver` | — | 5×5×5 | `.../multi/MTEIndustrialLaserEngraver.java#L240` (tooltip) |
| Amazon Warehousing Depot (packager) (15513) | `MTEIndustrialPackager` | 5×3×3 | 5×3×3 | `.../multi/MTEIndustrialPackager.java` |
| Industrial Autoclave (687) | `MTEMultiAutoclave` | 7×7×9 | 7×7×9 | `.../multi/MTEMultiAutoclave.java#L136` |
| Industrial Precision Lathe (686) | `MTEMultiLathe` | — | 7×5×5 | `.../multi/MTEMultiLathe.java#L181` (tooltip) |
| TurboCan Pro (360) | `MTEMultiCanner` | — | 7×5×7 | `.../multi/MTEMultiCanner.java#L105` (tooltip) |
| Mass Solidifier (368) | `MTEMassSolidifier` | 5×6×9 | 5×6×9 | `.../multi/MTEMassSolidifier.java#L87` |
| Large Fluid Extractor (2730) | `MTELargeFluidExtractor` | 5×9×5 | 5×9×5 | `.../multi/MTELargeFluidExtractor.java#L80` |
| Dissection Apparatus (extractor) (3010) | `MTEIndustrialExtractor` | — | 5×5×5 | `.../multi/MTEIndustrialExtractor.java#L145` (tooltip) |
| Magnetic Flux Exhibitor (358) | `MTEIndustrialElectromagneticSeparator` | — | 7×6×7 | `.../multi/MTEIndustrialElectromagneticSeparator.java#L213` (tooltip) |
| Big Barrel Brewery (3011) | `MTEIndustrialBrewery` | 3×5×3 | 3×5×3 | `.../multi/MTEIndustrialBrewery.java` |
| Flotation Cell Regulator, 2.9 (15560) | `MTEFrothFlotationCell` | — | 11×5×11 | `.../multi/MTEFrothFlotationCell.java#L126` (tooltip) |
| Cryogenic Freezer, 2.9 (15565) | `MTECryogenicFreezer` | 5×4×7 | 5×4×7 | `.../multi/MTECryogenicFreezer.java#L105` |
| Thermal Boiler, 2.9 (15557) | `MTEThermalBoiler` | 5×5×5 | 5×5×5 | `.../multi/MTEThermalBoiler.java#L300` |
| Industrial Arc Furnace, KubaTech 2.9 (15548) | `MTEIndustrialArcFurnace` | 17×11×19 | 17×11×19 | `kubatech/tileentity/gregtech/multiblock/MTEIndustrialArcFurnace.java#L191` |
| Zyngen (alloy smelter) (31023) | `MTEIndustrialAlloySmelter` | 3×5×3 | 3×5×3 | `gtPlusPlus/.../processing/MTEIndustrialAlloySmelter.java#L150` |
| Utupu-Tanuri (dehydrator) (995) | `MTEIndustrialDehydrator` | 3×5×3 | 3×5×3 | `gtPlusPlus/.../processing/MTEIndustrialDehydrator.java#L141` |
| Thermic Heating Device (31077) | `MTEIndustrialFluidHeater` | 5×6×5 | 5×6×5 | `gtPlusPlus/.../processing/MTEIndustrialFluidHeater.java#L88` |
| Alloy Blast Smelter (810) | `MTEAlloyBlastSmelter` | 3×4×3 | 3×4×3 | `gtPlusPlus/.../production/MTEAlloyBlastSmelter.java#L109` |
| Chemical Plant (998) | `MTEChemicalPlant` | 7×7×7 | 7×7×7 | `gtPlusPlus/.../production/chemplant/MTEChemicalPlant.java#L212` |
| IsaMill Grinding Machine (31027) | `MTEIsaMill` | 3×3×7 | 3×3×7 | `gtPlusPlus/.../processing/MTEIsaMill.java#L113` |
| Volcanus (963) | `MTEAdvEBF` | 3×4×3 | 3×4×3 | `gtPlusPlus/.../processing/advanced/MTEAdvEBF.java#L154` |
| Dangote Distillus (31021) | `MTEAdvDistillationTower` | 3×1×3 per layer | 3×(3–12)×3 | `gtPlusPlus/.../processing/advanced/MTEAdvDistillationTower.java#L106` |
| Bacterial Vat (12712) | `MTEBioVat` | 5×4×5 | 5×4×5 | `bartworks/common/tileentities/multis/MTEBioVat.java#L141` |
| Circuit Assembly Line (12735) | `MTECircuitAssemblyLine` | 1×3×3 per slice | (2–7)×3×3 | `bartworks/common/tileentities/multis/MTECircuitAssemblyLine.java#L125` |
| Precise Auto-Assembler MT-3662 (32018) | `MTEPreciseAssembler` | 9×5×5 | 9×5×5 | `goodgenerator/blocks/tileEntity/MTEPreciseAssembler.java#L120` |
| Lapotronic Supercapacitor | `MTELapotronicSuperCapacitor` | 5×2×5 base + 5×1×5 per layer | 5×(4–50)×5 | `kekztech/common/tileentities/MTELapotronicSuperCapacitor.java#L186` |
| Steam Grinder (31041) | `MTESteamMacerator` | 3×4×3 (legacy piece 3×3×3) | 3×4×3 | `gregtech/common/tileentities/machines/multi/steam/MTESteamMacerator.java#L180` |
| Steam Squasher (31078) | `MTESteamCompressor` | 3×3×7 (legacy piece 3×3×4) | 3×3×7 | `.../multi/steam/MTESteamCompressor.java#L196` |
| Steam Presser (31083) | `MTESteamForgeHammer` | — | 5×7×5 | `.../multi/steam/MTESteamForgeHammer.java#L321` (tooltip) |

- MTE IDs: **[jar]** `MetaTileEntityIDs` enum (e.g. `EBF_CONTROLLER` → `sipush 1000`, `LCR_CONTROLLER` → `sipush 1169`, `SteamTurbine` → `sipush 15524`). Names: `LoaderMetaTileEntities.java` and GT++ `registration/gregtech/*.java` constructors (e.g. `new MTEAdvEBF(Machine_Adv_BlastFurnace.ID, "multimachine.adv.blastfurnace", "Volcanus")`). The class name is the authoritative key. Which of these are actually available below IV is a recipe question and was not checked (**UNVERIFIED**).

### 5.5 Hatch positions (exporter 0.6.0)

Read on 2026-10-20 with `javap` on copies of `$SL`, `$GT`, the server's `forge-1.7.10-10.13.4.1614-1.7.10-universal.jar` and the pack's hydroenergy, cropsnh, matter-manipulator and vendingmachine jars; **[export]** marks a count from the active export of that day (exporter 0.5.0).

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
11. **[jar] Some cells take hatches the controller cannot use.** The Oil Cracking Unit's `l` and `r` adders each take an input or an output hatch, the first one found fixing the side (`mInputOnSide`/`mOutputOnSide`); the Distillation Tower's top centre `c` takes output hatches and buses through `addOutputToMachineList` into `mOutputHatches`, which neither `addFluidOutputs` nor `getOutputHatches` reads (both use `mOutputHatchesByLayer`); the Assembly Line's `checkMachine(boolean)` ends the line at the first slice that holds an output bus (offsets 32–77). Per-cell acceptance is wider than what works: the hatch-rules fix's table rows, which encode that controller logic, narrow it (architecture §11.49 (3)).
12. **[jar] The plain dynamo adder takes a small multi-amp dynamo.** `addDynamoToMachineList` takes any `MTEHatchDynamo` whose `maxAmperesOut()` is at most 4, and `MTEHatchDynamoMulti extends MTEHatchDynamo`: its lowest id, 15200 (`hatch.dynamomulti04.tier.05`), is a 4 A hatch; the 16 A ones start at 15210 (`hatch.dynamomulti16`). The multi-amp energy hatch (`MTEHatchEnergyMulti`, lowest 15100, 4 A) is no `MTEHatchEnergy`, so no plain energy adder takes it.
13. **[jar] Not every controller class can be read on a server.** TecTech's `MTEBECStorage` declares `pillar`, `torus` and `torusFar` of type `gregtech.client.GTSoundLoop` (`extends MovingSound`, a client class) without `@SideOnly`, so `getDeclaredFields()` on it throws on a dedicated server; about 20 classes of the controllers' hierarchies declare static `Collection`/`Map` fields (`MTETreeFarm.treeProductsMap`, `MTEChemicalPlant.mTieredBlockRegistry`, …), global registries that no probe needs.

**The probe.** The structures section runs the controller's `checkStructure` once with the instrument on to learn which element checks each block, then for each element puts the lowest-id hatch of each of the 17 kinds (a 16 A one for `dynamo_multi`, a 4 A one for `energy_multi`) on its first block that held no tile entity (else its first block), runs `checkStructure` again and counts the kind as taken when the hatch is found, by identity, in a non-static collection field of the controller other than `MTEMultiBlockBase.mSmartInputHatches` (a list of lists or a map of lists one level down too) and GT's check recorded no `PositionedStructureError` on the probe cell. The cell is restored after every probe, and GT's check is walked once more after each element: a machine whose walk then groups its blocks differently gets no rules. Controllers that are no `MTEMultiBlockBase`, controllers with a class whose fields cannot be read on the server and truncated structures are not probed. The probe has its own budget (`gtnhplanner.hatchProbeBudgetSeconds`, 120 s). Its answers are the structure line's `elements` and `elementOf` (architecture §11.49).

Per-cell acceptance is wider than what forms (bullet 11), so the layout narrows it by the hatch-rules table where a row fits.

As measured (2026-10-20, the first 0.6.0 export of this pack): `hatchRules` 304 of 326 structures; structures section 4,656 → 4,310 ms against the 0.5.1 export before it (the probe included: earlier exports took 4,199–5,072 ms, so its cost is inside the section's run-to-run spread); 23,398 probe checks on 321 multiblocks in 812 ms; `structures.jsonl.gz` 349,660 bytes (299,023 before).

## 6. Parallels, batch mode and heat

### 6.1 How parallels are decided (`ParallelHelper.determineParallel`)

1. Power checks from §1.2(c) (insufficient power / voltage).
2. `maxParallel` = the machine's `getTrueParallel()` × the under-one-tick multiplier (§2.3). With batch mode on, a second cap of `maxParallel × 128` applies only to the batch extras in step 5 (§6.2).
3. Void protection can lower it (output space).
4. `currentParallel = min(maxParallel, availableEUt / ceil(EUt·mods), parallels the inputs allow)`. Inputs are consumed here.
5. Overclock with that parallel (§2.3), then batch extras (§6.2), then roll the outputs. Chanced outputs over many parallels are rolled as a binomial (normal approximation when the mean is more than 3σ from both ends).
- **[src]** `SRC/gregtech/api/util/ParallelHelper.java#L375-L535`, `#L593-L631`.
- `getTrueParallel() = max(1, alwaysMaxParallel ? getMaxParallelRecipes() : min(getMaxParallelRecipes(), powerPanelMaxParallel))`. The default is `alwaysMaxParallel = true`. Players can cap parallels in the controller's power panel; NBT keys `alwaysMaxParallel`, `powerPanelMaxParallel` (`MTEMultiBlockBase.java#L203`, `#L414-L415`, `#L3236-L3241`). The base `getMaxParallelRecipes()` returns 1.

### 6.2 Batch mode

- Machines that `supportsBatchMode()` (false in the base class) have a batch toggle (NBT `batchMode`). When it is on, `ProcessingLogic.setBatchSize(getMaxBatchSize())` = 128 (**[jar]** `getMaxBatchSize`: `sipush 128`).
- After overclocking, if the duration is under `MAX_BATCH_MODE_TICK_TIME = 128` ticks (**[jar]** `ParallelHelper`: `MAX_BATCH_MODE_TICK_TIME = 128.0d`), the machine adds up to `currentParallel × min(128/duration − 1, batchSize − 1)` extra parallels, limited by inputs. It stretches the duration by `1 + extra/current` (`ParallelHelper.java#L510-L527`).
- Throughput is about the same (more parallels per run, proportionally longer runs). It needs inputs for the whole batch at once and runs up to about 128 ticks. For planning, treat batch mode as rate-neutral. Show it only as a latency or buffer-size effect.

### 6.3 Parallels and bonuses of common 2.9 multiblocks

`tier` below is `GTUtility.getTier(getMaxInputVoltage())`. **Warning:** `getMaxInputVoltage()` is the **sum** of the energy hatches' voltages (`MTEMultiBlockBase.java#L1633-L1638`: "Sums up voltage of energy hatches. Amperage does not matter."; `ExoticEnergyInputHelper.getMaxInputVoltageMulti`). So two HV hatches (1,024 V) count as EV here.

| Machine | Max parallel | Speed | EU | Source (`SRC/gregtech/common/tileentities/machines/multi/` unless noted) |
|---|---|---|---|---|
| Large Sifter | 4 × tier | `setSpeedBonus(1/5)` (5× faster) | ×0.75 | `MTEIndustrialSifter.java#L209-L216` |
| Ore Washing Plant | 4 × tier | 1/5 | — | `MTEOreWashingPlant.java#L229-L235` |
| Industrial Chemical Bath | 4 × tier | 1/5 | — | `MTEIndustrialChemicalBath.java#L217-L223` |
| Industrial Electrolyzer | 4 × tier (`PARALLEL_PER_TIER = 4`) | 1/2.8 | ×0.9 | `MTEIndustrialElectrolyzer.java#L52-L54`, `#L169-L171` |
| Industrial Centrifuge | 4–8 × tier (`BASE_PARALLEL_PER_TIER = 4`) | 2–3× | ×0.9 | `MTEIndustrialCentrifuge.java#L78-L82` |
| Industrial Maceration Stack | 2 × max(1, tier) (T1 controller), 8 × max(1, tier) (after the upgrade chip) | 1/1.6 (T1 structure), 1/6.4 (T2 structure) | — | `MTEIndustrialMacerator.java#L90-L91`, `#L402-L405`, `#L468-L470` |
| Industrial Mixing Machine | 8 × tier | 1× + casing bonus | — | `MTEIndustrialMixer.java#L65-L67` |
| Industrial Wire Factory | 4 × tier | casing bonus | ×0.75 | `MTEIndustrialWireMill.java#L54-L56` |
| Industrial Extrusion Machine | 6 × tier | 1/3.5 | — | `MTEIndustrialExtruder.java#L197-L203` |
| Industrial Forming Press / Bending Machine | 6 × tier | 1/6 | — | `MTEIndustrialFormingPress.java#L196-L202`, `MTEIndustrialBendingMachine.java#L179-L185` |
| Industrial Sledgehammer | 6 × solenoid level × tier | 1/2 | — | `MTEIndustrialForgeHammer.java#L199-L205` |
| TurboCan Pro | 8 × tier | 1/2 | — | `MTEMultiCanner.java#L148-L154` |
| Mass Solidifier | 10 × tier | 1/`speedup`; `speedup` starts at 1, grows by 0.025 per step while working and decays when idle (NBT `speedup`) | ×0.8 | `MTEMassSolidifier.java#L78`, `#L193-L212`, `#L288-L327` |
| Big Barrel Brewery | 4 × tier | 1/1.5 | — | `MTEIndustrialBrewery.java#L177-L183` |
| Large Thermal Refinery | 8 × tier + 2 × solenoid level | 1/(2.5 + 0.05 × coil tier) | ×0.8 × 0.95^coil tier | `MTEIndustrialThermalCentrifuge.java#L64-L70`, `#L235-L280` |
| Large Fluid Extractor | max(1, 8 × solenoid level) | 1/(1.5 + 0.1 × coil tier) | ×0.8 × 0.9^coil tier | `MTELargeFluidExtractor.java#L70-L75`, `#L362-L379` |
| Thermic Heating Device (GT++) | 8 × tier | 1/2.2 | ×0.9 | `gtPlusPlus/.../processing/MTEIndustrialFluidHeater.java#L172-L179` |
| Utupu-Tanuri (GT++) | (code) | 1/2.2 | ×0.5 | `gtPlusPlus/.../processing/MTEIndustrialDehydrator.java#L237-L263` |
| Zyngen (GT++) | (coil tier + 1) × tier (Cupronickel = coil tier 0) | heat OC | — | `gtPlusPlus/.../processing/MTEIndustrialAlloySmelter.java#L187-L204`, `#L222` |
| Volcanus (GT++) | (code) | 1/2.2 + heat OC | ×0.9 | `gtPlusPlus/.../processing/advanced/MTEAdvEBF.java#L270-L313` |
| Dangote Distillus | 12 (tower mode) / 2·floor((h+1)/3)·tier (distillery) | 1/3 / 1/2 | ×1 / ×0.15 | `gtPlusPlus/.../advanced/MTEAdvDistillationTower.java#L74`, `#L397-L404` |
| Large Chemical Reactor | 1 | perfect OC | — | `MTELargeChemicalReactor.java#L155` |

("Speed 1/x" means `setSpeedBonus(1/x)`, i.e. duration × 1/x. Entries marked "(code)" or "casing/coil bonus" are computed at runtime and were not traced in detail.)

### 6.4 EBF heat (Electric Blast Furnace and the heat-OC family)

- Coil heat (`HeatingCoilLevel.getHeat() = 1 + 900 × ordinal`, **[src]** `SRC/gregtech/api/enums/HeatingCoilLevel.java#L7-L34`): Cupronickel 1,801 K, Kanthal 2,701, Nichrome 3,601, TPV-Alloy 4,501, HSS-G 5,401, HSS-S 6,301, Naquadah 7,201, Naquadah Alloy 8,101, Trinium 9,001, Fluxed Electrum 9,901 (enum comment `ELECTRUMFLUX`), Awakened Draconium 10,801, Infinity 11,701, Hypogen 12,601, Eternal 13,501.
- EBF heat = coil heat + `100 × (GTUtility.getTier(getMaxInputVoltage()) − 2)` (**[src]** `MTEElectricBlastFurnace.java#L237`). This is +100 K per tier above MV of the **summed** hatch voltage: one HV hatch +100, one EV hatch +200, two MV hatches (256 V → HV) +100. One LV hatch gives −100.
- A recipe runs only if `recipe heat (mSpecialValue) ≤ EBF heat` (`validateRecipe`, lines 213–215).
- **EU discount:** `recipePower × 0.95^floor((EBF heat − recipe heat) / 900)`. That is 5 % per full 900 K, compounding (`OverclockCalculator.calculateHeatDiscountMultiplier`, lines 340–343; `heatDiscountExponent = 0.95`). The EBF tooltip agrees: "Reduces EU Usage by 5% every 900K above the recipe requirement" (`MTEElectricBlastFurnace.java#L129-L139`). So the discount is 5 % per step in this version, not 4 %. It is applied before the OCs are counted, so it can buy an extra OC.
- **Heat OCs:** `min(floor((EBF heat − recipe heat) / 1800), total OCs)` of the OCs are perfect (duration ÷4). The rest are normal (÷2). EU/t is ×4 for every OC.
- *Verified by reviewer:*
  - [jar] `MTEElectricBlastFurnace.checkMachine` has `getCoilLevel … HeatingCoilLevel.getHeat … l2i bipush 100 … getMaxInputVoltage … GTUtility.getTier … iconst_2 isub imul iadd putfield mHeatingCapacity`.
  - Its `ProcessingLogic` subclass (`MTEElectricBlastFurnace$1.createOverclockCalculator`) calls `setRecipeHeat(recipe.mSpecialValue)`, `setMachineHeat(mHeatingCapacity)`, `setHeatOC(true)` and `setHeatDiscount(true)`.
  - In the calculator, `calculateHeatDiscountMultiplier` is `sipush 900 idiv … heatDiscountExponent … powInt`, with `ldc2_w 0.95d` in `<init>`. Coil heat is `HeatingCoilLevel.getHeat` = `lconst_1 + 900 × ordinal()`.
  - Tooltip strings in the class constant pool (`javap -v`): "Reduces \u0001 by \u00015%\u0001 every \u0001900K\u0001 above the recipe requirement" and "Every \u00011800K\u0001 over the recipe requirement grants 1 \u0001Perfect Overclock".
  - The reviewer's port reproduces all four examples below exactly: 114 × 1,000; 412 × 250; 1,647 × 125; 434 × 250.
- Examples ([script]; recipe 120 EU/t, 1,000 ticks, 1,000 K):
  - Kanthal + one MV hatch (2,701 K, Δ 1,701): 1 discount step → 114 EU/t, no OC → **114 EU/t × 1,000 t**.
  - Nichrome + one HV hatch (3,701 K, Δ 2,701): 3 discount steps (×0.857), 1 OC, which is a heat OC → **412 EU/t × 250 t**.
  - Nichrome + one EV hatch (3,801 K, Δ 2,801): 3 steps, 2 OCs (1 heat, 1 normal) → **1,647 EU/t × 125 t**.
  - Kanthal + two MV hatches (2,801 K, 4 A at 128 V): 2 steps, 1 heat OC → **434 EU/t × 250 t**.

### 6.5 Large Chemical Reactor

Perfect OC, 1 parallel, normal hatch rules: 30 EU/t × 200 t with one MV hatch → 120 EU/t × 50 t; with one EV hatch → 1,920 EU/t × 3 t ([script]; `200/64 = 3.125` floored).

## 7. Open questions (UNVERIFIED)

- Whether +A in StructureLib points to the controller's left or right (mirror handedness). Use `ExtendedFacing` or a real build instead of assuming.
- Steam-machine (bronze/steel singleblock and steam multiblock) overclock and steam use: not studied.
- `willExplodeInRain()` per machine type: not enumerated.
- TecTech multi-amp and laser hatches: they feed the "exotic hatch" path (`amperageOC`, `laserOC`) and were not studied.
- Which multiblocks in §5.4 can actually be built at or below IV in this pack's recipes.
- Vanilla weather timing (how often rain and thunder occur): not checked in the jar. The rain/thunder rows in §4.2 assume the weather lasts the whole simulated period.
- Forge's `WorldProvider.isDaytime` route and possible day-cycle changes by pack mods (§4.2). The solar simulation assumes the vanilla Overworld cycle.

## Appendix: script runs behind the [script] numbers

The scripts are local (session scratch, see the local notes). They are listed here so the numbers can be reproduced.

- `python3 -I oc.py`: port of `OverclockCalculator`. Output excerpt: `PASS one tick got (1, 30720) expected (1, 30720)`, `PASS perfect 3t->1t got (1, 7680) expected (1, 7680)`, `PASS float precision (double) got 42467328 expected 42467328` (21/21 PASS). Worked examples: `singleblock tier 2 V 128 -> OCs 1 EU/t 120 ticks 100 EU/op 12000`, `hatch tier 2 x 2 -> amps 4 OCs 2 EU/t 480 ticks 50`, `Multiblock sub-tick parallels: 30 EU/t x 2 t, 1 IV hatch: multiplier 8 EU/t 7680 ticks 1 OCs 4`.
- `python3 -I solar_sim.py`: day/night/weather simulation. Output excerpt: `isDaytime ticks per 24000: 13081 fraction 0.5450 edges(worldTime): [12540, 23459]`, `steel ticks above 100C per day: [21952, 22842, 22842, ...] avg L/s over full day (last day): 342.4`, `bronze ... [16443, 17293, ...] avg L/s ...: 86.4`, `steel cold start at sunrise: first steam after 793 ticks`, `steel 24000 ticks of rain from hot @noon: ... hot ticks 8399`, `... thunder ...: hot ticks 6399`.
- `python3 -I shapes.py`: literal `addShape` bounding boxes (§5.4). Output excerpt: `MTEElectricBlastFurnace STRUCTURE_PIECE_MAIN line 77 transpose W(A)=3 H(B)=4 D(C)=3 cells=36 controller(a,b,c)=(1, 3, 0)`, `MTELargeTurbineBase STRUCTURE_PIECE_MAIN line 62 raw W(A)=3 H(B)=3 D(C)=7` (solid-only run: `D(C)=6`), `MTEIndustrialExtruder STRUCTURE_PIECE_MAIN line 60 raw W(A)=9 H(B)=4 D(C)=4`.
- `python3 -I jar_grep.py $GT enablePerfectOverclock setHeatOC`: constant-pool scan behind the lists in §2.4.

## Appendix: independent review (2026-10-17)

A second reviewer re-checked 11 load-bearing claims. The sources were the bytecode in `$GT`, `$SL`, BlockRenderer6343 and the vanilla server jar (`javap --multi-release 17` where it applies), the source at tag `5.09.54.183`, and the newest world backup zip opened read-only. Each claim's evidence is inline in the section listed.

| # | Claim | Verdict | Where |
|---|---|---|---|
| 1 | Overclock algorithm: OC count, ×4 EU, ÷2 or ÷4 duration, 1-tick floor with no OC stop, 32 EU/t floor, ULV treated as LV | Confirmed. The bytecode matches, and a separate port passes all 46 non-laser unit tests (77/77 assertions). | §2.1 |
| 2 | Singleblock machine voltage `V[tier]·mAmperage` with `amperageOC` false; only the arc furnace is 3 A and ×3 EU | **Corrected.** The formula holds, but `mAmperage` comes from the recipe map: the thermal centrifuge is 2 A. The Mass Fabricator is 8 A with ×2 EU per OC. | §0, §2.2, §2.4, §2.5 |
| 3 | Multiblock power: average voltage; A = 1 for exactly one hatch, else the summed amps; `amperageOC` true; `maxTierSkips` 1 | Confirmed | §2.3 |
| 4 | EBF heat: 5 % per 900 K compounding, 1 perfect OC per 1,800 K, +100 K per tier of the summed hatch voltage above MV | Confirmed | §6.4 |
| 5 | Emitter loss `V + 2^max(0, t−1)`; a machine explodes when the arriving voltage is above `V[tier]` | Confirmed. The check is skipped while the tile cannot accept the packet. | §3.2, §3.4 |
| 6 | Cables: loss summed along the path, instant burn on over-voltage, burn past 40 × rated amps | Confirmed. Two evidence slips fixed: the class that declares `setToFire`, and 58 builder calls, not 57. | §3.3 |
| 7 | Steam turbine: 3 EU per (6+t) L, 1 A from the front, tank 24,000·t, buffer V·80+512 | Confirmed; the world backup agrees | §4.1 |
| 8 | HP solar boiler mechanics | Confirmed. The day average is refined to 338–342 L/s depending on tick phase. | §0, §4.2 |
| 9 | Multiblock power loss voids the recipe and disables the machine | Confirmed. "Until a player restarts it" is refined: a Machine Controller cover can restart it. | §0, §3.5 |
| 10 | Footprints can be computed from StructureLib at export time | Confirmed | §5.2 |
| 11 | Battery buffer amps out = number of batteries of exactly the buffer's tier | Confirmed. The items must also report `canProvideEnergy`. | §4.3 |

The reviewer's scripts are in the session scratch folder named in the local notes, not committed:

| Script | What it does |
|---|---|
| `oc_port.py` | Overclock port plus every non-laser unit-test vector (`77/77 PASS`) |
| `examples.py` | The §2.2 and §2.3 tables |
| `tc_example.py` | Thermal centrifuge at 1 A versus 2 A, plus the voltage-cap brute force |
| `cp_scan.py`, `utf8_scan.py` | Constant-pool scans of `$GT` |
| `solar_sim_verify.py` | Day cycle and boilers, including the 240-phase sweep |
| `scan_gt_tes.py` | Read-only scan of the backup zip; prints no coordinates |
