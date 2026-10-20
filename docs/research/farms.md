# Farms and other renewable sources in GTNH 2.9.0-RC-1

Date: 2026-10-19 · Scope: GT New Horizons 2.9.0-RC-1 server pack (gregtech 5.09.54.183 with GT++ and KubaTech folded in, cropsnh 2.0.129, Forestry 4.11.38, industrialcraft-2 2.2.828-experimental) · Status: research reference for add-on 17 (planning objectives: "best multi-output / fewest raw sources")

Add-on 17 wants a planning objective such as "best multi-output" or "fewest raw sources", and for that the planner must treat renewable sources (tree farms, crop farms, algae ponds) as inputs it can build, not as items that appear from nothing. The user's example: "1 rubber tree farm with the crop manager could be centrifuged into rubber dust, wood pulp and carbon which takes care of half of the mats". This page answers five questions:

1. How the Tree Growth Simulator really runs: inputs, tools and their wear, power, duration, parallels, tier, what the export row means and what it leaves out, and how to price one operation.
2. What the CropsNH Crop Manager does, how drops per harvest are decided, where crop data lives, and which crops matter for GT lines.
3. Which other farms are in the pack, as far as they matter for GT lines.
4. What the Algae Farm takes and gives.
5. A planner model per source (inputs, outputs as expected values, power, machine, what to ask the user, what is uncertain), with the rubber example worked end to end.

It complements [gt-mechanics.md](gt-mechanics.md) (power, overclocks, multiblock amperage), [materials-availability.md](materials-availability.md) (where raw materials come from) and [export-mod.md](export-mod.md) (the export format).

## How to read the evidence

- `$PACK` is the GTNH 2.9.0-RC-1 server pack folder, opened read-only. `$GT` is `$PACK/mods/gregtech-5.09.54.183.jar` (GT5U with GT++, KubaTech, BartWorks folded in). `$CNH` is `$PACK/mods/cropsnh-2.0.129.jar`. `$FOR` is `$PACK/mods/Forestry-4.11.38.jar`.
- `J` is JDK 25 `javap -c -p -constants -l`. `$GT` is a multi-release jar, so every `$GT` class was read with `J --multi-release 17` (as in gt-mechanics.md). `$CNH` has no `Multi-Release` line in its manifest and was read without that flag. GTNH sources were not available offline, so the jars are the only source of truth; there are no **[src]** tags on this page.
- `$EX` is the planner export `data/export/2.9.0-RC-1_20261019-010938`, read-only. Rows are quoted as the exporter wrote them (`[item index, count, chance/10000]`); a decoded form follows with display names. Map index 107 is `gt.recipe.treefarm`, 155 is `gt.recipe.centrifuge`, 159 is `gt.recipe.algae_pond`.
- Tags: **[jar]** read from bytecode; **[export]** read from `$EX`; **[config]** read from `$PACK/config`; **[script]** computed by a Python port of the quoted bytecode (scripts `farm_model.py`, `rubber_example.py` in the session scratch folder, not committed; no game code was run); **UNVERIFIED** = not confirmed.
- No server was started, the live Minecraft server and the planner on port 8765 were not touched, and only the `serverFolder` field of `data/config.json` was read.
- Units: t = tick (20 t = 1 s), "op" = one machine operation, L = litres, EU/t = EU per tick, `V[t]` and `VP[t]` as in gt-mechanics.md §1.1 (`VP` = 30, 120, 480, 1920, 7680, ... for LV, MV, HV, EV, IV, ...).

## 0. Summary for the planner

| Topic | Rule the planner should use | Section |
|---|---|---|
| TGS operation | Fixed 100 t, no overclock, no parallel, no batch. Output of mode k = `row.out[k] × (2t² − 2t + 5) × toolMultiplier[k]`, only for modes whose tool sits in an input bus. The sapling stays in the controller. No water, no fertilizer. | §1.3 |
| TGS tier and power | `t = max(1, getTierExtended(Vavg × A))` (A = 1 for one normal hatch, else total amps): one hatch = its tier, 2 hatches or 4 A = one tier up. Draws `VP[t]` EU/t (LV 30, MV 120, HV 480). Amp counts that are not a power of 4 round the tier up and starve. | §1.4 |
| TGS tools | Logs: saw ×1, buzzsaw ×2, chainsaw ×4. Saplings: branch cutter ×1, grafter ×4. Leaves: shears ×1, wire cutter ×2, electric wire cutter ×4. Fruit: knife ×1. One use per mode per op at any tier: a GT tool lasts `floor(durability × multiplier)` ops (Steel saw 512, Steel branch cutter 128); electric tools pay 100 EU per op and lose one use per 25 ops. | §1.3, §1.5 |
| TGS export row | `gt.recipe.treefarm` rows are `fake` NEI rows: outputs at tier multiplier 1 and ×1 tools (product × 5/5/2/1), `eut 0`, `special` = the sapling, `sv` = row index. 251 rows; 132 are Forestry species at their default genome. The TGS controller is an IV craft (4 × Field Generator IV). | §1.1, §1.6 |
| Crop growth | One growth tick per 256 t. Rate = `(6 + growth) × (100 + 5N − 10·tier) / 100` when `5N ≥ 10·tier` (else a 4× steeper penalty), N = nutrients 5–55. A harvest every `256 × ceil(duration / rate)` t. Stats 1–31, default 1/1/1. | §2.2 |
| Crop drops | Expected per harvest, entry j: `dropChance × 1.03^gain × mult × chance_j/10000 × (stackSize_j + (gain + 1)/100)`; `dropChance` = `0.95^tier` unless overridden; mult = 1 + 0.05 × manager tier for the Crop Manager. No seeds come back; the plant stays. | §2.3 |
| Crop Manager | LV–UMV singleblock; harvests (does not plant) every 50 t in `(7 + 4m)² × 5` blocks; `V/8` EU per harvest, `V/32` per water / Weed-EX / fertilizer action. Machine-only crops cannot be harvested by it. | §2.4 |
| Industrial Farm | MV multiblock; deterministic expected drops per 100 t cycle for up to `(4b + 7)²` identical seeds (b = Seed Bed tier 2–13), at `VP[b]` EU/t plus upgrades, `ceil((4b+7)² × 0.390625)` L water per cycle, optional fertilizer; one sub-soil block per seed. | §2.5 |
| Crop data | Only partly in the export (`meta.cropsnh_crop` on 179 crops: chances and liked biomes, but no tier, duration, drop chance or stack sizes). Add a `crops.jsonl.gz` from the `ICropCard` API. | §2.7, §5.7 |
| Ore crops | Material leaves are ore boosters: 1 leaf + 1 crushed ore + 1,000 L water → 4 purified ore (+144 L byproduct), 24 EU/t, 96 t; or 4 leaves + 384 L acid → 4 purified ore without ore (Forge Hammer map). Sticky resin comes from Sticky Cane (tier 4, 200 t, 1 resin @100 %). | §2.8 |
| Algae Farm | One energy hatch of tier t; `V[t] × 9/10` EU/t; the fixed row of tier t (t + 1 with `compostForTier(t)` compost); no overclock; water is placed by the structure itself. The 16 export rows are real but say `eut 0`. | §4 |
| Other farms | Forestry multifarm, EnderIO Farming Station, treetaps, bees: world-dependent, model as user-entered rates. EIG (KubaTech): IV build, vanilla-style seeds only for GT purposes; its IC2 mode is deprecated. No MineFactory Reloaded, no IC2 Crop-Matron. | §3 |
| Rubber example | LV TGS, saw + knife: 25 Rubber Wood + 5 Sticky Resin per 5 s for 30 EU/t. Centrifuged and macerated, that covers the glue, carbon and planks of about 92 Electronic Circuits per minute, but needs about 98 LV centrifuges; a knife alone gives 60 resin per minute. The farm covers 3 of the line's 8 raw kinds (resin, wood, carbon), not the metals. | §5.8 |

## 1. Tree Growth Simulator

### 1.1 Two controllers, one logic

| mteId | Class | Structure | How you get it |
|---|---|---|---|
| 15541 | `gregtech.common.tileentities.machines.multi.MTETreeFarm` (extends `MTEExtendedPowerMultiBlockBase`) | 7×7×7, controller front bottom centre | crafted (below) |
| 836 | `gtPlusPlus...production.MTETreeFarmLegacy` (extends `GTPPMultiBlockBase`) | 3×3×3 legacy GT++ shape | not crafted; converts to 15541 |

- **[export]** `machines.jsonl.gz`: `{"id":15541,"name":"treefarm.controller.tier.single","cls":"gregtech.common.tileentities.machines.multi.MTETreeFarm","dn":"Tree Growth Simulator",...,"maps":["gt.recipe.treefarm"]}` and `{"id":836,...,"cls":"gtPlusPlus.xmod.gregtech.common.tileentities.machines.multi.production.MTETreeFarmLegacy",...}`.
- **The new controller is an IV-era build.** **[export]** `recipes-crafting.jsonl.gz`: `{"cls":"gregtech.api.util.GTShapedRecipe",...,"in":[6033,8075,6033,7924,39644,7924,6033,37047,6033],"out":[84313,1]}` = 4 × Field Generator (IV) (`gt.metaitem.01:32674`), Incoloy-MA956 Rotor, 2 × Nitinol 60 Plate, Integral Framework I, Inconel-792 Fluid Pipe. A shapeless row `"in":[102787],"out":[84313,1]` turns a legacy controller into the new one.
- **Both controllers run the same code.** **[jar]** The bytecode of `process()` in `MTETreeFarm$1` and `MTETreeFarmLegacy$1`, and of `getTierMultiplier`, `useToolForMode`, `getToolMultiplier` and `getOutputsForForestrySapling`, is instruction-for-instruction identical once class names and constant-pool indices are masked (`diff` of the normalised `J` dumps: "SAME" for all five; only `addFakeRecipeToNEI` differs, by using `Mode.values()` instead of `Mode.VALUES`).
- **[jar]** `RecipeLoaderTreeFarm.registerTreeProducts(5 args)` calls `MTETreeFarmLegacy.registerTreeProducts` and then `MTETreeFarm.registerTreeProducts`, so both have the same product table. Only the new class's version calls `addFakeRecipeToNEI`, which is why the map holds one row per tree (251), not two.

### 1.2 What it needs

- **[jar]** `MTETreeFarm.createTooltip` strings: "Farms and harvests trees using EU", "Place a sapling in the controller slot", "Place a tool in an input bus", "Different tools are required for different outputs", "Advanced tools multiply output amount", "  Logs: Saw (1x), Buzzsaw (2x), Chainsaw (4x)", "  Saplings: Branch Cutter (1x), Grafter (4x)", "  Leaves: Shears (1x), Wire Cutter (2x), Electric Wire Cutter (4x)", "  Fruit: Knife (1x)", "Multiple tools can be used at the same time", "Work time is fixed at 5 seconds", "Energy input tier multiplies output further", "Output multiplier is equal to: 2*tier^2 - 2*tier + 5".
- **The sapling is not consumed.** It sits in the controller slot. `findSapling()` takes the controller slot if `isValidSapling`, otherwise moves one sapling from the input buses into slot 1 (`getfield mInventory iconst_1 aload_3 iconst_1 invokevirtual ItemStack.func_77979_a` (splitStack) `aastore`). `isValidSapling` = the `"registryName:meta"` key is in `treeProductsMap`, or the item is `"Forestry:sapling"`. NEI says the same: `gt.nei.tgs.1=The sapling is not consumed.` (`$GT` `assets/gregtech/lang/en_US.lang`).
- **No water, no fertilizer, no other item input.** `process()` reads only the sapling and the tools (§1.3). The structure blocks `D` (dirt/grass), `F` (air or oak leaves) and `G` (air or oak log) are filled by `onPostTick` every 20 ticks (`Blocks.dirt → Blocks.grass`, air → `Blocks.leaves`, air → `Blocks.log`): decoration, not a resource.
- **Hatches.** `checkMachine`: `checkCasingMin(errors, casingAmount, 8)`, `checkHasEnergyHatch`, `checkHasMaintenanceHatch`, `checkHasMufflerHatch`, `checkHasInputBus`, `checkHasOutputBus`. The hatch element is `HatchElement.Energy.or(HatchElement.MultiAmpEnergy)`, so TecTech multi-amp hatches fit. Casings: tooltip "60 Steel Frame Box", "57 Any Tiered Glass", "45-55 Sterile Farm Casing", "25 Dirt or Grass".
- **Bus restrictions.** `addInputBusToMachineList` returns false for `MTEHatchInputBusME`; `supportsCraftingMEBuffer()` returns false; `supportsBatchMode()` false; `supportsVoidProtection()` true.
- **Pollution.** `getPollutionPerSecond` = `PollutionConfig.pollutionPerSecondMultiTreeFarm`; **[config]** `config/GregTech/Pollution.cfg`: `I:pollutionPerSecondMultiTreeFarm=100`.

### 1.3 One operation

`MTETreeFarm$1.process()` (**[jar]**, LineNumberTable 404–462), in order:

```java
sapling = findSapling();                      // "no_sapling" if none
outputPerMode = getOutputsForSapling(sapling);  // "no_output_for_sapling" if unknown
tier = Math.max(1, GTUtility.getTierExtended(availableVoltage * availableAmperage));
tierMultiplier = getTierMultiplier(tier);     // 2*t*t - 2*t + 5
for (mode : LOG, SAPLING, LEAVES, FRUIT) {
    product = outputPerMode.get(mode); if (product == null) continue;
    toolMultiplier = useToolForMode(mode, false);  // test only; -1 = no tool for this mode
    if (toolMultiplier < 0) continue;
    out = product.copy(); out.stackSize *= tierMultiplier * modeMultiplier.get(mode) * toolMultiplier;
    outputs.add(out);
}
if (outputs.isEmpty()) return "no_tools";
duration = 100; calculatedEut = GTValues.VP[tier];
for (mode : ...) if (outputPerMode.get(mode) != null) useToolForMode(mode, true);   // wear
return "growing_trees";
```

- Bytecode for the key lines: `aload_0 getfield availableVoltage aload_0 getfield availableAmperage lmul invokestatic GTUtility.getTierExtended:(J)I invokestatic Math.max:(II)I` (`iconst_1` first); `aload 13 dup getfield stackSize iload 4 getstatic modeMultiplier ... intValue imul iload 12 imul imul putfield stackSize`; `bipush 100 putfield duration`; `getstatic GTValues.VP iload_3 laload putfield calculatedEut`.
- `getTierMultiplier`: `iconst_2 iload_0 iload_0 imul imul iconst_2 iload_0 imul isub iconst_5 iadd ireturn` = `2t² − 2t + 5`.
- `modeMultiplier` (static init, lines 366–371): `LOG iconst_5`, `SAPLING iconst_5`, `LEAVES iconst_2`, `FRUIT iconst_1`.
- **A mode only produces if its tool is present.** You choose the outputs by choosing the tools: a knife alone gives only fruit, a saw alone only logs.
- **No overclock, no parallel, no batch.** The duration is the constant 100; the OC calculator is never called; output grows only through `tierMultiplier` and `toolMultiplier`. "Work time is fixed at 5 seconds".

| Energy tier t | LV 1 | MV 2 | HV 3 | EV 4 | IV 5 | LuV 6 | ZPM 7 | UV 8 |
|---|---|---|---|---|---|---|---|---|
| Output multiplier `2t²−2t+5` | 5 | 9 | 17 | 29 | 45 | 65 | 89 | 117 |
| EU/t `VP[t]` | 30 | 120 | 480 | 1,920 | 7,680 | 30,720 | 122,880 | 491,520 |
| EU per op (100 t) | 3,000 | 12,000 | 48,000 | 192,000 | 768,000 | 3.07 M | 12.3 M | 49.2 M |

**[script]** `farm_model.py`. Output per EU falls with tier (multiplier ÷ EU per op: LV 5 / 3,000, MV 9 / 12,000, HV 17 / 48,000), so LV gives the most items per EU and higher tiers the most items per machine.

**Tool multipliers** (`getToolMultiplier`, **[jar]** lines 511–569):

| Mode | ×1 | ×2 | ×4 |
|---|---|---|---|
| LOG | `SAW`, `POCKET_SAW`, `POCKET_MULTITOOL` | `BUZZSAW_LV/MV/HV` | `CHAINSAW_LV/MV/HV` |
| SAPLING | `BRANCHCUTTER`, `POCKET_BRANCHCUTTER`, `POCKET_MULTITOOL` | — | Forestry `IToolGrafter` that `isDamageable()` (Grafter, Proven Grafter) |
| LEAVES | vanilla `ItemShears` (damageable), `POCKET_MULTITOOL` | `WIRECUTTER`, `POCKET_WIRECUTTER` | `WIRECUTTER_LV/MV/HV` |
| FRUIT | `KNIFE`, `POCKET_KNIFE`, `POCKET_MULTITOOL` | — | — |

`useToolForMode` walks `getStoredInputs()` from the end and uses the **first** stack that answers for the mode, so extra tools of the same mode are spares, not extra output.

### 1.4 Power and tier come from the energy hatches

- `availableVoltage` and `availableAmperage` are set by `MTEMultiBlockBase.setProcessingLogicPower` (gt-mechanics.md §2.3): voltage = average hatch voltage; amperage = **1 if there is exactly one normal energy hatch and no exotic hatch**, otherwise the sum of the hatches' amps (2 per normal hatch). **[jar]** neither `MTEExtendedPowerMultiBlockBase`, `GTPPMultiBlockBase` nor either tree farm class declares `setProcessingLogicPower` (their method lists); `MTEMultiBlockBase.setProcessingLogicPower`: `getfield mEnergyHatches ... size iconst_1 if_icmpne ... mExoticEnergyHatches isEmpty ... lconst_1 / getMaxInputAmps → setAvailableAmperage`.
- `GTUtility.getTierExtended(x)` = 0 if `x ≤ 8`, else `(bitLength(x−1) − 2) / 2` (**[jar]** `bipush 64 lload_0 lconst_1 lsub Long.numberOfLeadingZeros isub ... iconst_2 isub iconst_2 idiv`): the smallest t with `V[t] ≥ x`, rounding **up**.
- The machine then draws `VP[tier]` (**[jar]** `MTEExtendedPowerMultiBlockBase.setEnergyUsage`: `getCalculatedEut → putfield lEUt`, negated when positive).

| Hatches | `V × A` | tier | EU/t drawn | Works? |
|---|---|---|---|---|
| 1 × LV | 32 | LV | 30 | yes |
| 1 × MV | 128 | MV | 120 | yes |
| 2 × LV | 32 × 4 = 128 | MV | 120 | yes (2 hatches = one tier up) |
| 1 × 4 A LV (exotic) | 128 | MV | 120 | yes |
| 3 × LV | 32 × 6 = 192 | HV | 480 | **no**: draws more than the 192 EU/t the hatches bring; the machine runs out of power (UNVERIFIED in game, follows from the two lines above) |
| 1 × 16 A LV (exotic) | 512 | HV | 480 | yes |

**[script]** `farm_model.py` (`tgs_tier`). Rule for the planner: a TGS is at hatch tier `t` with one hatch, `t + k` with `4^k` amps in total; other amp counts round up and starve.

Why the export says `eut 0`: the map is NEI-only (§1.6); the machine computes its own EU/t from the hatches as above.

### 1.5 Tool wear per operation

`useToolForMode(mode, true)` calls `GTModHandler.damageOrDechargeItem(stack, 1, 32, null)` (**[jar]** `aload 6 iconst_1 bipush 32 aconst_null invokestatic`), once per mode that has a product, every operation, whatever the tier. Then, if the call failed or an electric tool cannot give 32 EU (`isElectricItem && !canUseElectricItem(stack, 32)`), it moves the tool to the output bus (`addOutputAtomic`, `depleteInput`).

What one call costs (**[jar]**):

- **GT tool, not electric.** `damageOrDechargeItem` → `IDamagableItem.doDamageToItem(stack, 1)` → `MetaGeneratedTool.doDamageToItem`: `i2l ldc2_w 100l lmul invokevirtual doDamage`. `doDamage` without electric stats adds 100 to the tool damage and breaks the tool (`getBrokenItem` or `stackSize--`) when damage ≥ `GT.ToolStats.MaxDamage`. `getToolWithStats` writes `MaxDamage = 100 × (long)(material.mDurability × toolStats.getMaxDurabilityMultiplier())` (`ldc2_w 100l ... getfield Materials.mDurability i2f ... getMaxDurabilityMultiplier fmul f2l lmul`). So **a GT tool lasts `floor(durability × multiplier)` operations**.
- **GT tool, electric** (buzzsaw, chainsaw, electric wire cutter). `doDamage` → `use(stack, 100.0, null)`, which discharges 100 EU from the tool's battery; then `ThreadLocalRandom.current().nextInt(0, 25) == 0` adds 100 damage. So **100 EU per operation, plus 1/25 of a use**; the TGS ejects the tool once it cannot pay.
- **Vanilla shears and the Forestry grafter** (not `IDamagableItem`): the vanilla branch `setItemDamage(damage + 1)` and destroy at `damage ≥ getMaxDamage()`. Shears: 238 uses (vanilla, UNVERIFIED value: not read from the Minecraft jar). Forestry: `ItemRegistryArboriculture` builds `new ItemGrafter(4)` ("grafter") and `new ItemGrafter(149)` (proven grafter); `ItemGrafter(int)` passes it to `setMaxDamage`. So 4 and 149 uses.

Durability multipliers (`getMaxDurabilityMultiplier`, **[jar]**): `GTTool` default `fconst_1` (1.0), inherited by `ToolSaw`, `ToolKnife`, `ToolWireCutter`, `ToolWireCutterLV`, `ToolBuzzSawLV/MV/HV`, `ToolChainsawLV`; `ToolBranchCutter` 0.25; `ToolChainsawMV` and `ToolWireCutterMV` 2.0; `ToolChainsawHV` and `ToolWireCutterHV` 4.0; every pocket tool 4.0.

Tool durability of common materials (`MaterialsInit.loadX`: `MaterialBuilder.setTool(durability, quality, speed)`, e.g. `loadSteel`: `sipush 512 iconst_3 ldc 6.0f invokevirtual setTool:(IIF)`): Wood 16, Bronze 192, Iron 256, Invar 256, Stainless Steel 480, Steel 512, Black Steel 768, Diamond 1,280, Damascus Steel 1,280, Titanium 1,600, Vanadiumsteel 1,920, Tungstensteel 2,560, HSS-G 4,000, HSS-E 10,240.

Uses per tool, for a Steel tool:

| Tool | Multiplier | Uses (Steel) | Material per tool (recipe, **[jar]** `ProcessingToolHead` / `ProcessingToolOther`) |
|---|---|---|---|
| Saw | 1 | 512 | saw blade `toolHeadSaw` (material amount `7257600` = 2 ingots) + stick |
| Branch Cutter | 0.25 | 128 | shaped `"PfP","PdP","STS"`: 4 plates, 1 screw, 2 sticks |
| Wire Cutter | 1 | 512 | shaped `"PfP","hPd","STS"`: 3 plates, 1 screw, 2 sticks |
| Knife | 1 | 512 | shaped `"fPh"," S"`: 1 plate, 1 stick |
| Chainsaw (LV) | 1, electric | 512 × 25 expected, plus 100 EU per op | tool head + LV motor and battery (UNVERIFIED recipe detail) |

**Pricing one operation.** For each mode with a tool: `1 / uses` of that tool (non-electric), or `1 / (25 × uses)` of the tool plus 100 EU (electric). Wear does not grow with tier, so per item it shrinks by the output multiplier. Example, LV rubber tree with Steel saw and Steel knife: per op `1/512` saw + `1/512` knife = (2 + 1) / 512 ≈ 0.0059 ingots of steel (sticks aside) for 25 logs and 5 resin: about 0.0002 ingots per item. The planner can price wear but may treat it as noise; the machine's 3,000 EU per op dominates.

### 1.6 What the export row means and what it leaves out

**[export]** the rubber row (map 107):

```
{"map":107,"in":[],"out":[[116,5],[122,5],[121,2],[2588,1]],"fin":[],"fout":[],"eut":0,"dur":100,"sv":8,
 "inAlt":[[saws...],[branch cutters, grafter],[shears, wire cutters],[knives]],"fake":true,"special":122}
 = out 5 Rubber Wood, 5 Rubber Tree Sapling, 2 Rubber Tree Leaves, 1 Sticky Resin; special = Rubber Tree Sapling
```

`addFakeRecipeToNEI` builds it (**[jar]** lines 847–898): `specialStack = sapling.copy(); specialStack.stackSize = 0`; for each mode with a product, `inputStacks[ordinal] = altToolsForNEI[ordinal]` and `outputStacks[ordinal] = product × modeMultiplier[mode]`; then `new GTRecipe_WithAlt(false, null, outputStacks, specialStack, null, null, null, null, null, null, bipush 100, iconst_0, iload 5 /*recipeCount*/, inputStacks, null)` and `RecipeMap.addFakeRecipe(false, ...)`.

| Row field | Meaning |
|---|---|
| `out[k]` | product of mode k × `modeMultiplier` (5, 5, 2, 1), i.e. tier multiplier 1 and ×1 tools. Mode order LOG, SAPLING, LEAVES, FRUIT; a missing product has `inAlt[k] = null` and no output. |
| `inAlt[k]` | the tools NEI shows for mode k (`altToolsForNEI`): saws, cutters, shears, knives. They are not consumed per op. |
| `special` | the sapling, stack size 0: it stays in the controller. |
| `eut 0`, `dur 100` | constants of the fake row. The real EU/t is `VP[tier]` (§1.4), the real duration 100. |
| `sv` | the index of the row in the map (`recipeCount`), meaningless. |
| `fake: true` | NEI display only. The planner rejects it today (`src/server/planner/candidates.ts`: `if (r.flags.fake === true) return { ok: false, why: 'fake' }`). |

What the row leaves out: the tier multiplier (`2t²−2t+5`), the tool multipliers (×2, ×4), the choice of modes (tools present), tool wear, the EU/t, and, for Forestry saplings, the genome. **[jar]** `getOutputsForForestrySapling` scales the default products by the tree's genome: logs × `(max(3·(height − 1), 0) + 1) × girth`, saplings `max(1, count × fertility × 10)`, fruit `max(1, count × yield × 10)`, leaves unchanged (`ldc 3.0f ... getHeight fconst_1 fsub fmul fconst_0 Math.max fconst_1 fadd`, `getGirth i2d`, `getFertility ldc 10.0f fmul`, `getYield ldc 10.0f fmul`). 132 of the 251 rows are Forestry saplings (`special` id `Forestry:sapling`), shown with the species' default genome; a bred tree gives other numbers.

The real output of one operation is therefore `row.out[k] × (2t² − 2t + 5) × toolMultiplier[k]` for every mode k whose tool is in a bus.

### 1.7 Trees that matter for GT lines

From the 251 rows (**[export]**, decoded; per-op output at LV = row × 5):

| Sapling | Row output (× tier multiplier) | Why it matters |
|---|---|---|
| Rubber Tree Sapling (IC2) | 5 Rubber Wood, 5 saplings, 2 leaves, **1 Sticky Resin** | resin (glue, rubber), rubber wood (centrifuge: resin, carbon, pulp; macerator: pulp) |
| Slimy Sapling (TConstruct) | 5 Congealed Green Slime, 5 saplings, 2 leaves, 1 Gelatinous Slime | **[export]** centrifuge: 1 Congealed Green Slime → 8 Raw Rubber Dust + 200 L Refined Glue (5 EU/t, 300 t); Gelatinous Slime → 144 L Glue (fluid extractor) |
| Blood Sapling (Natura) | 5 Bloodwood, 5 saplings, 2 leaves, **1 Redstone** | renewable redstone (red alloy, circuits) |
| Paperbark Sapling (HarvestCraft) | 5 Paperbark Wood, ..., 1 Paper | paper |
| Redwood Sapling (Natura), Rainforest Oak (GT++), Robust Twilight Oak | 25 Redwood (+ 10 saplings, 4 leaves, 2 Redwood Bark); 15 Rainforest Oak; 20 Twilight Oak Wood | more logs per op than the usual 5 or 10 |
| any log | logs | **[export]** macerator `logWood` (159 alternatives, Rubber Wood among them): 6 Wood Pulp + 1 @80 % (2 EU/t, 400 t); coke oven / pyrolyse oven: charcoal, creosote, wood gas |

The rubber tree's base products are all 1: **[jar]** `RecipeLoaderTreeFarm.generateIC2Trees`: `getModItem(IC2, "blockRubSapling", 1)`, `"blockRubWood", 1`, `"blockRubLeaves", 1`, `"itemHarz", 1` → `registerTreeProducts`.

## 2. CropsNH: Crop Manager, Industrial Farm and crop drops

### 2.1 CropsNH replaced IC2 crops

- `cropsnh-2.0.129.jar` (package `com.gtnewhorizon.cropsnh`) brings its own crop sticks (`TileEntityCropSticks`), seeds (`cropsnh:genericSeed` with NBT), 179 crop cards and six GT machines. **[export]** `machines.jsonl.gz`: Crop Manager 28001–28012 (LV–UMV, `kind: other`, no map), Seed Generator 28013–28024 (`cropsnh.recipes.seedGenerator`), Crop Breeder 28025–28036 (`cropsnh.recipes.cropBreeder`), Crop Gene Extractor 28037–28045 (IV–UMV), Crop Synthesizer 28046–28054 (IV–UMV, `amps 3`), Industrial Farm 28055 (`multimachine.industrialfarm`, `com.gtnewhorizon.cropsnh.tileentity.multi.MTEIndustrialFarm`).
- **[config]** `config/cropsnh/Configuration.cfg`: `B:"Enable Migrations"=true` ("Enable the automatic conversion of existing IC2 crops into CropsNH's equivalent crops"), `S:"Growth rate multiplier"=1.0`, `B:"Enable weeds"=true`.
- No IC2 Crop-Matron: of the 106,154 items in `$EX` `items.jsonl.gz`, the only display name containing "matron" is the GT++ `Spinmatron-2737` (a multiblock, `gt.blockmachines:1033`). The Extreme Industrial Greenhouse's IC2 mode is marked `{red:DEPRECATED}` (§3.3).

### 2.2 How a crop grows

`TileEntityCropSticks` (**[jar]**):

- `TICK_RATE = 256`. `updateEntity` (`func_145845_h`): `ticker = (ticker + 1) % 256; if (ticker == 0) onGrowthTick()` (`sipush 256 irem ... ifne`). A crop grows only once every 256 ticks (12.8 s).
- `onGrowthTick`: if rain falls on the block, `addWater(11, 100, 101, false)`; if the crop is sick, `spreadDisease()`; if `canGrow()`, `doGrowth()`; weeds may spread or spawn; then `fertilizerStorage--` and `waterStorage--` (each if > 0).
- `doGrowth`: if `growthProgress < crop.getGrowthDuration()`: `rate = calcGrowthRate()`; if `rate ≤ 0` the crop may get sick (`passesResistanceCheck`: `resistance > nextInt(31)`); otherwise `growthProgress += (int)(rate × ConfigurationHandler.growthMultiplier)`, capped at the duration. `isMature()` = `growthProgress ≥ duration`; `canGrow()` is false once mature.
- `calcGrowthRate()` = `getGrowthRate(getNutrientScore(), crop.getTier(), stats.getGrowth())`:

```java
// getGrowthRate(int nutrientPoints, int tier, int growth)   [jar, bytecode]
nutrientPoints *= 5; int need = tier * 10; if (need < 0) return 0;
int base = 6 + growth;
if (nutrientPoints >= need) return base * (100 + nutrientPoints - need) / 100;
return Math.max(0, base * (100 - (need - nutrientPoints) * 4) / 100);

// getNutrientsPerCycle(int likedTags, float humidity, boolean sky, int water, int fertilizer)
likedTags = min(2, likedTags); water = min(100, water); fertilizer = min(100, fertilizer);
int n = 5 + (water + 9) / 10 + (fertilizer + 9) / 10 + (sky ? 2 : 0);
float humidityBonus = max(0, min(1, (humidity - 0.5f) / 0.3f)) * 14f;
return n + max((int) humidityBonus, likedTags * 14);
```

- `getNutrientScore()` feeds it the number of the crop's liked `BiomeDictionary` tags present in the crop's biome, the biome's humidity (`BiomeGenBase.field_76751_G`, rainfall), `canBlockSeeTheSky(x, y + 1, z)`, and the stick's water and fertilizer storage. Range 5 (dry biome, no water, no fertilizer, no sky) to 55. With a Crop Manager keeping water and fertilizer above 100 and open sky: 27, plus the larger of the humidity bonus (up to 14) and 14 per liked tag (up to 2 tags, 28).
- **Cycle length**: a crop reset to 0 needs `ceil(duration / rate)` growth ticks, i.e. `256 × ceil(duration / rate)` ticks per harvest, as long as it is harvested before its next growth tick (the Crop Manager looks every 50 ticks, §2.4).
- Defaults: `CropCard.getTier()` = 1, `NHCropCard.getGrowthDuration()` = `600 × getTier()` (`sipush 600 ... imul`); most crops override both (§2.8).
- Stats: `SeedStats(byte growth, byte gain, byte resistance)` clamps each to `max(1, min(31, x))` (`iconst_1 bipush 31 ... Math.min ... Math.max`); a new `SeedStats()` is 1/1/1.

Example rates per growth tick (**[script]** `farm_model.py`, `getGrowthRate` port):

| Nutrients N | Sticky Cane (tier 4), growth 1 / 16 / 31 | Rubber Bonsai (tier 1) | Ferrofern (tier 6) |
|---|---|---|---|
| 17 (water, sky, no fertilizer) | 10 / 31 / 53 | 12 / 38 / 64 | 8 / 27 / 46 |
| 27 (+ fertilizer) | 13 / 42 / 72 | 15 / 49 / 83 | 12 / 38 / 64 |
| 55 (+ 2 liked tags) | 23 / 73 / 123 | 25 / 80 / 135 | 22 / 69 / 116 |

### 2.3 Drops per harvest

`TileEntityCropSticks.harvest(double dropMultiplier)` (**[jar]**):

```java
crop.onHarvest(this); growthProgress = 0;                 // the plant stays; it regrows from 0
double rounds = getAvgDropRounds(crop, gain) * dropMultiplier;   // crop.getDropChance() * 1.03^gain
int n = (int) rounds; if (rand.nextDouble() <= rounds % 1) n++;
for ((stack, chance) : crop.getDropTable()) {             // chance in 1/10000
    int count = 0, gainBonus = 0;
    for (i < n) if (rand.nextInt(10000) < chance) { if (rand.nextInt(100) <= gain) gainBonus++; count++; }
    if (count > 0) drop(count * stack.stackSize + gainBonus);
}
```

- `getAvgDropRounds(cc, gain)` = `cc.getDropChance() × Math.pow(1.03, gain)` (`ldc2_w 1.03d ... Math.pow ... dmul`). `getAvgDropCountIncrease(gain)` = `(gain + 1) / 100.0` (`iconst_1 iadd i2d ldc2_w 100.0d ddiv`), the chance that `nextInt(100) ≤ gain`.
- `CropCard.getDropChance()` default = `Math.pow(0.95, getTier())`; some crops override it (§2.8).
- **Expected drops of entry j per harvest**: `dropChance × 1.03^gain × dropMultiplier × (chance_j / 10000) × (stackSize_j + (gain + 1) / 100)`.
- No seed comes back: the drop table is all a harvest gives; the crop stays on its sticks.
- `canHarvest()` is false for weeds, immature crops, crops whose growth requirements fail, and **any crop with a `MachineOnlyGrowthRequirement`** (`instanceof MachineOnlyGrowthRequirement → iconst_0`). Those crops (Iridine, Osmianth, Platina, Reactoria, Scheelinium, Titania, Star Wart, Stargatium, Space Flower, Transformium, God of Thunder, Magical Nightshade; §2.8) grow only in the Industrial Farm.

### 2.4 Crop Manager

`com.gtnewhorizon.cropsnh.tileentity.singleblock.MTECropManager` (**[jar]**):

- **It harvests and maintains; it does not plant.** The method list has `harvest`, `applyHydration`, `applyWeedEX`, `applyFertilizer`, `refillWeedEX` and no planting. Seeds go on crop sticks by hand; the plants regrow after each harvest (§2.3).
- **Rhythm.** `onPostTick` returns unless `tick % 50 == 0` (or work was just enabled) and the stored EU ≥ `maxEUInput()` = `V[tier]`. The crop cache (every `ICropStickTile` in range) is rebuilt every 600 ticks (100 when empty). Then `processSecondaryFunctions` and `harvest`.
- **Range.** `getHorizontalRadius(t)` = `3 + max(0, 2t)`, `getVerticalRadius()` = 2: an LV manager covers 11 × 5 × 11 blocks, MV 15 × 5 × 15, HV 19, EV 23, IV 27 (tooltip `cropsnh_tooltip.cropManager.tooltip.4=Range: %1$sx%2$sx%1$s blocks`).
- **Harvest.** For every crop with `canHarvest()`: `crop.harvest(1.0 + getHarvestBonusChance())` with `getHarvestBonusChance()` = `0.05 × mTier` (`ldc2_w 0.05d ... dmul`), and `decreaseStoredEnergyUnits(powerUsage())` with `powerUsage()` = `maxEUInput() / 8`. So `dropMultiplier` = 1.05 at LV, 1.10 at MV, ...; **EU per harvest** = `V/8` (LV 4 EU). Drops go to 15 output slots; what does not fit waits in `dropOverflow` and harvesting pauses.
- **Secondary functions** cost `V/32` EU each (`powerUsageSecondary()`), per crop: water tops a stick up to 200 when it has ≤ 180 (`applyHydration`: `sipush 180 ... sipush 200`); Weed-EX adds 75 when the stick has ≤ 75, using 10 of the manager's Weed-EX (`bipush 75 ... bipush 10`); fertilizer tops up to 200 from liquid fertilizer, or uses one fertilizer item when the stick is at or below `max(100, 200 − potency/2)`. Each is a GUI toggle; defaults `harvestEnabled = true`, the three others false.
- **Consumables.** A stick loses 1 water and 1 fertilizer per growth tick, so a maintained crop eats about 1 water point and 1 fertilizer point per 256 ticks. **[jar]** `FertilizerLoader`: water potency 1, distilled water 2; CropsNH Weed-EX fluid 1, Weed-EX 9000 10; CropsNH fertilizer fluid 1, enriched fertilizer 10; bone meal 5, CropsNH fertilizer item 100, two Forestry fertilizers 25 and 50 (which is which: UNVERIFIED). Tanks: water `32000 × tier` L, Weed-EX `1500 × tier`, liquid fertilizer `36864 × tier`.
- **Build.** **[export]** crafting: Robot Arm (LV) ×2, Sensor (LV), 2 steel plates, LV Machine Hull, 2 tin cables, Input Hatch (ULV) → Basic Crop Manager.

### 2.5 Industrial Farm

`MTEIndustrialFarm` (**[jar]**) simulates crops instead of placing them, and computes expected drops.

- **Build.** **[export]** crafting: Robot Arm (MV), Watering Can, Sensor (MV), 3 × `ore:circuitGood`, Advanced Crop Manager, 2 × Input Bus (MV) → Industrial Farm: an MV machine.
- **Seed Bed tier t** (2 = MV … 13 = UXV) sets everything (`BlockSeedBed`): seed capacity `getCapacity(t)` = `(2 × getHorizontalRadius(t) + 1)²` = `(4t + 7)²` (MV 225, HV 361, EV 529, IV 729, LuV 961, ZPM 1,225; the same area as one layer of a Crop Manager of that tier); `t − 1` middle slices (clamped 1–12); base EU/t `getBaseEUt(t)` = `VP[t]`; harvest-round bonus `0.2 × t`; water per cycle `WATER_CONSUMPTION_LOOKUP[t − 2]` = `ceil(capacity × 0.390625)` (MV 88, HV 142, EV 207, IV 285); optional fertilizer per cycle the same amount (`getFertilizerConsumption` returns `getWaterConsumption`).
- **Upgrades** (counts from `checkMachine`: `SE_EEU_COUNT` > 2, `SE_FU_COUNT` > 1, `SE_AHU_COUNT` > 2, `SE_OCGAU_COUNT` > 1, `SE_OCGAU_EXCLUSIVITY` with a normal GAU): Environmental Enhancement Unit (≤ 2; each enables one Environmental Module slot, a biome tag), Fertilization Unit (≤ 1; requires enriched fertilizer), Advanced Harvesting Unit (≤ 2), Growth Acceleration Unit (no count check found; UNVERIFIED how many the structure holds), Overclocked GAU (≤ 1, ZPM and up, not with a GAU; allows one multi-amp hatch and overclocks).
- **Power** (`getPowerUsage`): `base + 0.5·base·EEU + 1.25·base·GAU + 0.5·base·FU + 0.5·base·AHU` (`ldc2_w 0.5d`, `1.25d`, `ldc 0.5f`). With an OC unit, `expectedOCs`/`expectedEUt` come from a standard `OverclockCalculator` at the max input EU, and growth, water and fertilizer all scale by `2^OCs` ("Each overclock doubles production and input consumption without affecting recipe time").
- **Simulated environment** (`getNutrientScore(seed)`): `getNutrientsPerCycle(liked, biome.rainfall, true, 200, fert)` with water 200 and sky always, `fert = 200` if fertilizer was supplied this cycle or a Fertilization Unit is present, else 0; liked tags = crop tags found among the controller biome's tags plus the modules' tags. So N = 17 without fertilizer, 27 with, + biome bonus.
- **One cycle = 100 ticks** (`mMaxProgresstime = 100`; `CYCLE_DURATION = 100`). Expected drops per cycle (`getDropsPerCycle`, `getGrowthProgressPerCycle`, `getHarvestRoundMultiplier`):

```java
rate        = getGrowthRate(N, tier, growth);                  // same as crop sticks; <= 0 → "cannot grow"
growthTicks = ceil(duration / rate);
progress    = (1.0 / growthTicks) * 0.390625                    // CYCLE_TICK_RATE_SCALAR = 100/256
              * (1 + GAU) * (1 + 0.5 * FU) * 2^OCs;
rounds      = dropChance * 1.03^gain * (1 + 0.2 * bedTier + 0.5 * FU) * (1 + 0.2 * AHU);
perCycle[j] = (stackSize_j + (gain + 1) / 100.0) * (chance_j / 10000.0) * rounds * progress;
total[j]   += perCycle[j] * seedCount;                           // IFDropTable.addTo(tracker, seedStack.stackSize)
```

  Fractions accumulate in `outputTracker` and leave as whole items. Each cycle needs the full water amount (`NOT_ENOUGH_WATER` otherwise); fertilizer is optional unless a Fertilization Unit is installed (`NOT_ENOUGH_Enriched_FERTILIZER`).
- **Seeds and sub-soil.** One seed stack (`getSeedStack`), all with the same stats, up to the capacity. A crop with a sub-soil requirement needs **one sub-soil item per seed** (`tryAddNewSeeds`: `subSoilInMachineIfAllConsumed`, `maxAmountAfterIngest = min(availableSeeds, subSoilInMachine)`), e.g. 225 iron blocks or iron ores for 225 Ferrofern seeds; they stay in the machine and come back in output mode. Modes input / farm / output switch with a screwdriver. `getMinSeedBedTier()` > bed tier → "Seed Bed tier too low".

Example, MV Seed Bed, 225 seeds, no upgrades (**[script]** `farm_model.py`, port of the code above):

| Crop, stats (growth = gain) | N | Output per minute | EU/t | Water per 100 t |
|---|---|---|---|---|
| Sticky Cane 1/1/1 | 17 | 63 Sticky Resin | 120 | 88 L |
| Sticky Cane 1/1/1 | 27 (fertilizer) | 79 Sticky Resin | 120 | 88 L (+ 88 fertilizer) |
| Sticky Cane 31/31/31 | 27 | 1,323 Sticky Resin | 120 | 88 L (+ 88) |
| Rubber Bonsai 1/1/1 | 27 | 109 Rubber Wood, 5.5 saplings, 1.8 resin | 120 | 88 L (+ 88) |
| Ferrofern 31/31/31 (225 iron sub-soil) | 27 | 81 Ferrofern Leaf | 120 | 88 L (+ 88) |

### 2.6 Seeds and breeding are a one-time cost

- **Seed Generator** (LV+, `cropsnh.recipes.seedGenerator`): copies a seed. **[jar]** `MTESeedGenerator.FERTILIZER_PER_STAT = 36`, `BASE_RECIPE_DURATION = 160`; tooltip `cost = %1$s * (growth + gain + resistance)` of enriched fertilizer, plus the crop's duplication catalyst. **[export]** row: `0x Sticky Cane Seeds + 1x Sticky Resin + 3348 L Enriched Fertilizer → 0x Sticky Cane Seeds`, 30 EU/t, 160 t (3,348 = 36 × 93, a 31/31/31 seed).
- **Crop Breeder** (LV+) breeds deterministically ("The stats of the output seed will be the average of the parents'"; fluid cost `OutputTier * x + (growth + gain + resistance) * y`); **Crop Gene Extractor** and **Crop Synthesizer** (IV+) read stats onto data orbs and print seeds from UUM.
- **[config]** in-world breeding: `I:"Breeding Range High"=4`, `I:"Breeding Range Low"=-2`, `I:"Breeding Chance"=3`.
- For the planner a seed bank is a build cost, like a machine: the farm's rate depends on stats the user already has.

### 2.7 Where crop data lives

- **In the jar.** Every crop card is a class under `com.gtnewhorizon.cropsnh.crops` (or a parameterised `CropBonsai`, `CropOreBerry`, ... built in `CropLoader`), registered in `CropRegistry.instance`. The constructor calls `addDrop(ItemStack, chanceOutOf10000)`, `addLikedBiomes(...)` and `addSubSoilRequirement(...)`/`addGrowthRequirement(...)`; `getTier()`, `getGrowthDuration()`, `getDropChance()`, `getMinSeedBedTier()` and `getSoilTypes()` are overridden methods. **[jar]** `CropRegistry.dumpCrops()` writes a CSV with columns ID, Name, ..., Soil Type, Tier, Min Seed Bed Tier, Liked Biomes, Growth Duration, Breeding Threshold, Crossing Threshold, Starts Spreading Weeds If Growth Above, Growth Requirements, Drop Count Multiplier, Drop Table, Alternate Seeds; NEI exposes it in game as the data dumper `tools.dump.cropsnh.cropRegistry` (`.csv`). The tables on this page were extracted from the bytecode instead (scratch script `crops.py`).
- **In the export.** The CropsNH NEI rows carry the crop as `meta.cropsnh_crop` for **179 crops** (`cropGeneExtractor` 179, `seedGenerator` 178, `cropSynthesizer` 179). **[export]** excerpt (some keys left out): `{"dropTable":{"{\"item\":\"IC2:blockRubSapling@0\"}":3000,"{\"item\":\"IC2:blockRubWood@0\"}":6000,"{\"item\":\"IC2:itemHarz@0\"}":500},"growthRequirements":[],"id":"cropsnh:bonsaiRubber","likedBiomes":["CONIFEROUS","FOREST"],"numericId":9,"tier":1,...}`. It is a dump of the card's fields, so it **lacks every method value**: growth duration, drop chance, min seed bed tier, soil, and the drop **stack sizes** (the rubber bonsai's 10 logs show as a bare key); `tier` appears only for the 8 cards that store it in a field (the bonsais: `bonsaiOak`, `bonsaiRubber`, ...; Ferrofern and Sticky Cane have none). The planner needs an exporter addition (§5.7).

### 2.8 Crops that matter for GT lines

No crop makes rubber directly; **Sticky Resin** comes from Sticky Cane and, a little, from the Rubber Bonsai. Data from the crop classes (**[jar]**; tier, growth duration and drop-chance overrides; drops as `count × item @ chance/10000`; dc = `0.95^tier` unless stated; sub-soil = block under the soil, one per seed in the Industrial Farm):

| Crop | Tier | Duration | Drops | Needs |
|---|---|---|---|---|
| Sticky Cane | 4 | 200 | 1 Sticky Resin @10000 | sugarcane soils; likes WET HOT SANDY |
| Rubber Bonsai (`CropBonsai`, tier argument 1) | 1 | 1200 | 1 Rubber Sapling @3000, **10** Rubber Wood @6000, 2 Sticky Resin @500 | dirt/grass |
| Ferrofern | 6 | 2800 | 1 Ferrofern Leaf @10000 | sub-soil iron |
| Coppon | 6 | 1200 | 1 Coppon Fiber | sub-soil copper |
| Tine | 5 | 1000 | 1 Tine Twig | sub-soil tin |
| Plumbilia | 6 | 1200 | 1 Plumbilia Leaf | sub-soil lead |
| Argentia | 7 | 1400 | 1 Argentia Leaf | sub-soil silver |
| Auronia | 8 | 3700 | 1 Auronia Leaf | sub-soil gold |
| Bauxia | 6 | 1200 | 1 Bauxia Leaf | sub-soil bauxite/aluminium |
| Galvania / Nickelback | 6 / 5 | 1200 / 1000 | 1 leaf | sub-soil zinc / nickel |
| Titania, Scheelinium, Reactoria, Platina, Iridine, Osmianth, Stargatium, God of Thunder | 9–12 | 1800–7200 | 1 leaf (Iridine @7500, Osmianth @2500; Reactoria and Stargatium add a second drop @2500) | ore sub-soil; machine only; min bed tier 3–5 |
| Pyrolusium, Micadia, Thiosulfine | 12, 9, 6 | 2400, 1800, 1200 | 1 leaf/flower | sub-soil manganese / mica / sulfur |
| Cassitine, Malaxia, Plumbshade, Silviscus | 6, 6, 6, 8 | 2800, 2800, 2800, 3700 | 1 tiny dust of tin / copper / lead / silver | ore sub-soil |
| Olivia, Rubyne, Sapphirum | 2, 4, 4 | 400, 800, 800 | dust @7500, gem @2500 | gem sub-soil |
| Garnydinia | 7 | 850 | red/yellow garnet dust and gem @2250 each, exquisite and purified @250 | garnet sub-soil |
| Lazulia, Diareed, Bobs-Yer-Uncle-Ranks | 7, 12, 6 | 2800, 7200, 3000 | lapis dust/dye; diamond @7500 + dust @2500; berry @7500 + emerald @2500 | gem sub-soil |
| Redstraw | 6 | 1500 | 1 Redstone; dc 0.85 | sub-soil redstone; light 5–12 |
| Glowheat | 4 | 1500 | 1 Glowstone Dust; **dc 1.5** | netherrack soil; sub-soil glowstone |
| Withereed | 8 | 4800 | Coal Dust @6667, Coal @3333, skulls | sub-soil coal |
| Evil Ore | 8 | 1600 | Nether Quartz dust @6666, Certus Quartz dust @1667, quartz @1667 | netherrack soil |
| Fertilia | 3 | 1800 | Calcite dust @6250, Phosphate, Apatite, CropsNH Fertilizer @1250 each | — |
| Salty Root | 4 | 1600 | 1 Salty Root; **dc 4.0** | — |
| Oil Berry | 4 | 1200 | **2** Oil Berry | oil soil |
| Trollplant | 6 | 4800 | Spinel gem @6250, Plutonium-241 dust, Plantball, Scrap @1250 each | brick soil |
| Stone lilies (stone, basalt, marble, granites, netherrack, ...) | 1 | 600 | **9** dust of the stone @10000 (`getDust(9)`) | that stone as sub-soil |
| Ore berries (iron, gold, copper, tin, aluminium, essence; ardite, cobalt, thaumium, void, knightmetal, thauminite) | 5 (some 4–8) | 6000 (some 3000–5500) | 6 TConstruct oreberries (iron, gold, copper, tin, aluminium, essence); 1 nugget (`getNuggets(1)`: ardite, cobalt, thaumium, void); 4 armor shards (knightmetal) | ore sub-soil; max light 10 |
| Transformium | 12 | 7200 | UUA Berry @9000, UUM Berry @1000 | machine only |

Decisive lines, for example: `CropStickyCane.<init>`: `getstatic ItemList.IC2_Resin lconst_1 ... get sipush 10000 invokevirtual addDrop`, `getTier`: `iconst_4`, `getGrowthDuration`: `sipush 200`; `CropLoader.registerBonsais`: `ldc "bonsaiRubber" ... iconst_1 ... getModItem(IC2, "blockRubSapling") ... getModItem(IC2, "blockRubWood") ... invokespecial CropBonsai.<init>`, then `ItemList.IC2_Resin ldc2_w 2l ... sipush 500 addDrop`; `CropBonsai.<init>(..., int)`: `addDrop(sapling, sipush 3000)`, `log.stackSize = bipush 10; addDrop(log, sipush 6000)`, `getGrowthDuration`: `sipush 1200`; `CropFerrofern`: `bipush 6` tier, `sipush 2800` duration, `addGrowthRequirement(CropsNHSubSoilTypes.iron)`. `addSubSoilRequirement` and `addGrowthRequirement` both append to `growthRequirements` (`NHCropCard.addSubSoilRequirement`: `getfield growthRequirements ... ArrayList.add`).

**Material leaves are ore boosters first, ore sources second.** **[export]** for each leaf (script `leafuse.py` over `recipes-gt.jsonl.gz`):

- In a Chemical Reactor or Large Chemical Reactor: `{"map":47,"in":[[34156,1],[11956,1],[37880,0]],"out":[[11971,4]],"fin":[["water",1000]],"fout":[["molten.nickel",144]],"eut":24,"dur":96}` = 1 Ferrofern Leaf + 1 Crushed Iron Ore + 1,000 L water → **4** Purified Iron Ore + 144 L Molten Nickel (24 EU/t, 96 t). Every ore leaf has such rows for its family of ores (Ferrofern Leaf appears in 64 rows: iron, magnetite, the limonites, ...; Coppon Fiber in 41: copper, chalcopyrite, tetrahedrite, malachite, pyrite, ...). Normal ore washing turns 1 crushed into 1 purified, so one leaf adds 3 purified ores.
- In the Forge Hammer map (`gt.recipe.hammer`, map 166) with a fluid: `{"map":166,"in":[[34156,4],[37880,0]],"out":[[11971,4]],"fin":[["sulfuricacid",384]],"fout":[],"eut":24,"dur":96}` = 4 leaves + 384 L Sulfuric Acid → 4 Purified Iron Ore, without any ore (Auronia uses Hydrochloric Acid; Reactoria, Thunder Flower and Star Wart need 1,536 L of an acid at 1,536 EU/t). Which machines of that map accept the fluid (singleblock Forge Hammers or only the Industrial Sledgehammer) is UNVERIFIED.
- Extractor: 9 leaves → 1 dust @5000 (a poor route). Compressor: 4 leaves → 1 Plantball.
- Others: Oil Berry → oil-grade swaps and distillation; Salty Root → Salt, Rock Salt, Saltpeter (chemical bath); Hemp Stem → 6 String; Canola Flower → 125 L Seed Oil; Milk Wart → milk; UUA/UUM berries → 4 L UU amplifier / matter.

## 3. Other farms in the pack

Only the parts that matter for GT lines. MineFactory Reloaded is not in the pack: `find $PACK/mods -iname '*minefactory*'` finds nothing, and the only manifest mod ids with "factory" are `BuildCraft|Factory` and `StevesFactoryManager` (Forestry's `minefactoryreloaded` switch in `modules.cfg` is a compat flag, not the mod).

### 3.1 Forestry multifarm

- **[config]** `config/forestry/modules.cfg`: `B:farming=true` ("Adds automatic farms and harvesters for a wide variety of products"); `config/forestry/common.cfg`: `farms { I:size=2 B:square=false ... }` and no disabled farm structures (`farm3x3 ... farm5x5` all allowed).
- **[jar]** `$FOR` farm logics: `FarmLogicArboreal`, `FarmLogicCrops`, `FarmLogicRubber`, `FarmLogicPeat`, `FarmLogicReeds`, `FarmLogicGourd`, `FarmLogicCocoa`, `FarmLogicInfernal`, `FarmLogicOrchard`, `FarmLogicEnder`, `FarmLogicIC2Crops`, among others. `CropRubber.harvestBlock` returns one `PluginIC2.resin` and sets the rubber log's meta to `meta + 6` (a tapped spot), so a rubber farm circuit taps resin spots on rubber trees standing in the world.
- **[jar]** CropsNH adds its own Forestry circuit: `ForestryCompatHandler` registers `CropsNHFarmLogic` as a manual circuit (`CircuitFarmLogic.setManual`, `"manualIC2Crop"`), and `CropsNHFarmLogic$CropBasicCropsNHCrop.harvestBlock` calls `ICropStickTile.harvest(dconst_1)`: drop multiplier 1.0, no Crop Manager bonus.
- Rates depend on the world: real trees and crops grow by random ticks or by the CropsNH growth tick, resin spots refill on their own. The bytecode gives no per-operation table. UNVERIFIED: energy, water and fertilizer per harvest.

### 3.2 EnderIO Farming Station, IC2 treetap

- **[jar]** `EnderIO-2.10.46.jar` has `crazypants.enderio.machine.farm.farmers.RubberTreeFarmerIC2`, which looks up `IC2:blockRubSapling`, `IC2:blockRubWood`, `IC2:itemTreetap` and `IC2:itemHarz`: the Farming Station (`EnderIO:blockFarmStation`, in the export) taps rubber trees with a treetap, besides cutting trees and harvesting crops. World-dependent like §3.1; UNVERIFIED rates.
- The IC2 Treetap and Electric Treetap (`IC2:itemTreetap`, `IC2:itemTreetapElectric`) are the manual version.
- Other sticky resin sources in the export, for completeness (**[export]** producers of `IC2:itemHarz`): Sticky Resin Comb (`gt.comb:2`, centrifuge @5000), Amber Comb and Propolis (bees), and the GT++ Chemical Plant `8 Cellulose Pulp + 144 L liquid resin → 32 Sticky Resin`. Bees are out of scope here.

### 3.3 Extreme Industrial Greenhouse (KubaTech, mteId 12792)

- **[export]** crafting: 4 × Advanced World Accelerator IV, 2 × `ore:circuitUltimate`, 2 × Clean Stainless Steel Machine Casing, EnderIO Farming Station: an IV-era machine.
- **[jar]** `$GT` `assets/gregtech/lang/en_US/tooltip/extreme-industrial-greenhouse*.md`: "Uses 1000L of water per seed per operation"; normal mode "Base process time: 5 sec", "Process time is divided by number of tiers past {var:minVoltageTierMinus1} (Minimum 1 sec)", "All crops are grown at the end of the operation", "Does not drop seeds"; IC2 mode is `{red:DEPRECATED}`. `EIGNormalMode`: `getMinVoltageTier` 4 (EV), `getStartingSlotCount` 1, `getSlotPerTierMultiplier` 2, `getSeedCapacityPerSlot` 64, `getMaxFertilizerUsagePerSeed` 2, `getFertilizerBoost` 2.0. `EIGIC2Mode`: min tier 6 (LuV), min glass 6, 4 slots × 4 per tier, 1 seed per slot.
- Its buckets (`EIGSeedBucket`, `EIGStemBucket`, `EIGFlowerBucket`, `EIGRainbowCactusBucket`, `EIGIC2Bucket`) cover vanilla-style seeds, stems, flowers and the rainbow cactus; the drops are simulated per seed type at runtime. Judging by the bucket names, none of them is a resin or ore source for GT lines; the drop math was not read (UNVERIFIED).

### 3.4 Apiaries, fishing, mob farms

- **[export]** `machines.jsonl.gz`: Industrial Apiary (9399), Industrial Apicultural Acclimatiser and Drone Domestication Station (14202, the mega apiary), Zhuhai Fishing Port (15544, legacy 829, map `gt.recipe.fishpond`), Extreme Entity Crusher (14201).
- Bees give GT combs (centrifuge to ores, resin, wax). They need bee genetics; their own research. Not modelled here.

## 4. Algae Farm

### 4.1 Two controllers

| mteId | Class | Power | Tier from |
|---|---|---|---|
| 15545 | `gregtech.common.tileentities.machines.multi.MTEAlgaePond` | `V[tier] × 9 / 10` EU/t | the one energy hatch |
| 997 | `gtPlusPlus...algae.MTEAlgaePondBaseLegacy` | none | the machine casings |

- **[export]** crafting the new one: assembler, 120 EU/t, 1,200 t: 4 Integral Encasement I, 12 Aluminium Rods, 32 Wood Planks, 16 Steel Bolts, 32 Redstone, 1,152 L Molten Potin, circuit 21 → Algae Farm (15545). An MV build.
- **[jar]** Legacy tooltip: "Does not require power or maintenance", "All Machine Casings must be the same tier, this dictates machine speed", "Fill Input Hatch with Water to fill the inside of the multiblock". Not crafted; kept for old worlds. **[export]** a shapeless row `"in":[102788],"out":[39619,1]` turns it into the new controller, as for the tree farm.

### 4.2 How the new Algae Farm runs

**[jar]** `MTEAlgaePond`:

- Tooltip: "Grows Algae!", "Provide compost to boost production by one tier", `addGlassEnergyLimitInfo`, "Accepts exactly 1 Energy Hatch"; structure 3 × 6 × 10 (`beginStructureBlock(3, 6, 10, false)`): 64 tiered glass, 20–25 Algae Casing, 6 Stainless Steel Frame Box, 5 Filter Machine Casing, exactly one energy hatch, a maintenance hatch, at least one output bus, optional input bus and hatch.
- `checkMachine`: `checkHatchExact(errors, HatchElement.Energy, 1)`; `tier = getInputVoltageTier()`; error if `glassTier < tier`. Water: the inside is filled with water blocks automatically (`GTStructureUtility.fillStructureWithWater` every 20 ticks while `needsWaterFill`); there is no water input per run.
- `getRecipeEUt()` = `V[tier] × 9 / 10` (`ldc2_w 9l lmul ldc2_w 10l ldiv`): ULV 7, LV 28, MV 115, HV 460, EV 1,843, IV 7,372.
- `MTEAlgaePond$1` (processing logic): `findRecipeMatches` → `getRecipe(tier, inputItems)`; `validateRecipe` fails if `getRecipeEUt() > availableVoltage × availableAmperage`; `createOverclockCalculator` = `OverclockCalculator.ofNoOverclock(getRecipeEUt(), recipe.mDuration)`. **No overclock, no parallel.**
- `getRecipe(tier, inputs)`: if the input buses hold at least `compostForTier(tier)` Compost (`GregtechItemList.Compost`), the recipe of tier + 1 is used and that compost is consumed (`recipe.mInputs = [Compost × compostForTier(tier)]`, `iinc 0, 1`); then the recipe whose `mSpecialValue == tier`. `compostForTier(t)` = 1 for t ≤ 1, else `min(64, 2^(t−1))`: LV 1, MV 2, HV 4, EV 8, IV 16, LuV 32, ZPM+ 64 per run.
- `RecipeLoaderAlgaePond.generate()` has no random calls (`grep` for Random/XSTR/nextInt: 0 hits), so the 16 rows in the export are the real recipes.

### 4.3 Outputs

**[export]** `gt.recipe.algae_pond` (map 159), 16 rows, **not** `fake`, `in: []`, `eut: 0`, `meta.algae_pond_tier` = 0…15:

```
{"map":159,"in":[],"out":[[51428,6],[34080,2,9000]],"fin":[],"fout":[],"eut":0,"dur":2000,"meta":{"algae_pond_tier":0}}
{"map":159,"in":[],"out":[[51428,10],[34080,2],[34080,6,9000]],"fin":[],"fout":[],"eut":0,"dur":1800,"sv":1,"meta":{"algae_pond_tier":1}}
```

| Tier | Duration | Outputs (Algae Biomass, Green, Brown, Golden-Brown, Red; `@` = 90 %) |
|---|---|---|
| 0 ULV | 2000 | 6 Algae, 2 Green @ |
| 1 LV | 1800 | 10 Algae, 2 Green, 6 Green @ |
| 2 MV | 1600 | 10 Algae, 7 Green, 14 Green @ |
| 3 HV | 1400 | 10 Algae, 11 Green, 1 Brown, 14 Green @, 4 Brown @ |
| 4 EV | 1200 | 10 Algae, 11 Green, 6 Brown, 14 Green @, 4 Brown @, 4 Golden-Brown @ |
| 5 IV | 1000 | 10 Algae, 11 Green, 10 Brown, 2 Golden-Brown, 14 Green @, 4 Brown @, 4 Golden-Brown @, 4 Red @ |
| 6 LuV | 512 | 10 Algae, 15 Green, 13 Brown, 8 Golden-Brown, 3 Red, + the 90 % set (14 Green, 4 Brown, 4 Golden-Brown, 12 Red) |
| 7 ZPM … 15 | 256, 128, 64, 32, 16, 8, 4, 2, 1 | growing counts, same 90 % set |

The planner must charge `V[tier] × 0.9` EU/t itself: the row says 0. Today the row would pass `acceptRecipe` as an input-free, power-free source once an Algae Farm counts as built (it is not `fake`), which would make algae free.

GT uses of the biomass (**[export]**): Green Algae → Cellulose Fiber (dehydrator, 10 → 5), → Compost (macerator, 4 → 1); 10 Green + 6 Brown + 5,000 L distilled water → 5,000 L Sulfuric Acid (Chemical Plant, 60 EU/t, 1,000 t); 10 Algae Biomass + 500 L distilled water → 500 L Methane (Chemical Plant); 40 Brown + 2,000 L distilled water → 20 Sodium Carbonate (chemical reactor); 4 Brown → 1 Lithium Chloride (EBF) or 144 L molten; 5 Brown → 1 Alginic Acid (extractor); 16 Green + 8 Compost + 200 L Urea Mix → 32 Fertilizer (Forestry or CropsNH); 32 Red Algae + 32 Certus Quartz Dust + 8,000 L Grade 1 purified water → 8 Prismarine Shard (autoclave, 30,720 EU/t, LuV).

## 5. Planner models

### 5.1 One shape for every renewable source

None of the farm rows in the export can be used as they are: the tree farm rows are `fake` and lack tier, tools and power (§1.6), the algae rows say `eut 0` (§4.3), and crops have no rows at all, only partial metadata (§2.7). The planner should build a **synthetic farm recipe** per source, the way `src/server/pack/supply.ts` already builds the real recipe behind a display-only rock breaker row:

| Part | Content |
|---|---|
| machine | mteId and tier (TGS 15541, Industrial Farm 28055, Crop Manager 28001–28012, Algae Farm 15545) |
| duration | ticks per operation (TGS 100, Industrial Farm 100, Algae Farm the row's `dur`, crop sticks `256 × ceil(duration / rate)`) |
| consumed per op | EU (EU/t × duration), water, fertilizer, compost, tool wear as fractions of a tool |
| produced per op | expected counts (chances folded in), fractional |
| build once | controller and hatches (add-on 12), the sapling, the seed stack with its stats, one sub-soil block per seed, the tools in stock, upgrades and environmental modules |
| parameters | what the user must say (below); defaults marked "assumed" in the UI |

For "fewest raw sources", a farm's outputs count as made, not as raw sources; only what it consumes (fertilizer, compost, tools; water is free) counts as raw. A farm can run below 100 % of the time like any machine, so oversized farms are fine.

### 5.2 Tree Growth Simulator

- **Inputs per op (100 t):** `VP[t] × 100` EU; per mode with a tool, `1 / uses` of that tool (non-electric, `uses = floor(durability × multiplier)`) or `1 / (25 × uses)` of it plus 100 EU (electric).
- **Outputs per op:** for each mode k with a tool: `row.out[k] × (2t² − 2t + 5) × toolMultiplier[k]` (row = the `gt.recipe.treefarm` row of the sapling). Forestry saplings: the row is the species default; a bred tree scales by its genome (§1.6).
- **Tier:** `max(1, getTierExtended(Vavg × A))`, A = 1 for one normal hatch, else total amps (§1.4). Offer "one hatch of tier t" or "2 hatches / 4 A of tier t → tier t + 1"; refuse amp counts that are not a power of 4.
- **Build:** controller (4 × Field Generator IV, ...), 1 sapling, tools, energy/maintenance/muffler hatches, input and output bus (no ME input bus).
- **Ask:** sapling; tools per mode (none / basic / ×2 / ×4, and tool material); energy hatches; for a Forestry sapling, the genome (or accept the default).
- **Uncertain:** starvation with 3 or 6 hatches (UNVERIFIED in game); maintenance assumed perfect; the vanilla shears' 238 uses (not read from the Minecraft jar); output bus space.

### 5.3 Industrial Farm

- **Inputs per op (100 t):** EU/t from `getPowerUsage` (§2.5) × 100; water `ceil((4b+7)² × 0.390625) × 2^OCs` potency (L of water, half as much distilled water); if fertilizing, the same potency of fertilizer (liquid fertilizer 1 per L, enriched 10 per L; with a Fertilization Unit enriched fertilizer is mandatory).
- **Outputs per op:** `seedCount × Σ_j (stackSize_j + (gain + 1)/100) × chance_j/10000 × dropChance × 1.03^gain × (1 + 0.2b + 0.5·FU) × (1 + 0.2·AHU) × 0.390625 × (1 + GAU) × (1 + 0.5·FU) × 2^OCs / ceil(duration / rate)`, with `rate = getGrowthRate(N, tier, growth)` and N from §2.5 (17 without fertilizer, 27 with, plus the larger of the humidity bonus and 14 per liked tag, up to 2 tags).
- **Build:** controller, Seed Bed of tier b (and `b − 1` slices), upgrades, modules, `seedCount ≤ (4b+7)²` seeds, as many sub-soil blocks if the crop has a sub-soil requirement.
- **Ask:** crop; seed stats (growth, gain, resistance; default 1/1/1); seed count; bed tier; upgrades; fertilizer yes/no; the controller's biome (its `BiomeDictionary` tags and rainfall) and modules.
- **Uncertain:** how many Growth Acceleration Units fit; whether soil type matters (no soil check found in the farm code, so it seems not; UNVERIFIED in game).

### 5.4 Crop Manager and crop sticks

- **Per crop stick:** one harvest every `256 × ceil(duration / rate)` ticks, giving `dropChance × 1.03^gain × (1 + 0.05·m) × chance_j/10000 × (stackSize_j + (gain + 1)/100)` of each entry (m = manager tier); `V[m]/8` EU per harvest, `V[m]/32` EU per watering, Weed-EX or fertilizing action; about 1 water and 1 fertilizer point per stick per 256 ticks when those toggles are on.
- **Build:** the manager, crop sticks, soil and sub-soil blocks in the world, seeds. Capacity: up to `(2r+1)² × 5` positions, r = `3 + 2m`, in practice one or two layers.
- **Ask:** crop, stats, number of sticks, biome tags and humidity, sky access, which toggles are on.
- **Uncertain:** weeds and disease (they depend on Weed-EX and resistance; the Weed-EX use rate per stick was not traced), chunk loading, harvest timing within the 50-tick rhythm. Treat results as estimates; the Industrial Farm is the deterministic version of the same math.

### 5.5 Algae Farm

- **Per op:** the `gt.recipe.algae_pond` row of tier t (one energy hatch of tier t; glass ≥ t), or of t + 1 with `compostForTier(t)` Compost consumed; EU/t `V[t] × 9/10`; duration = the row's `dur`; chanced outputs at 90 %.
- **Ask:** hatch tier, compost yes/no. Nothing else varies.
- **Fix needed:** today these rows would count as free, power-free sources (§4.3).

### 5.6 World farms

Forestry multifarms, the EnderIO Farming Station, treetaps and bees have no fixed per-operation table (§3). Model them as a user-entered rate ("this farm gives 20 Sticky Resin per minute"), with no derived inputs.

### 5.7 What the export should add

1. **`crops.jsonl.gz`** from `CropRegistry.instance.getAllInRegistrationOrder()` and the `ICropCard` methods: id, name, `getTier()`, `getGrowthDuration()`, `getDropChance()`, `getMinSeedBedTier()`, the drop table **with stack sizes**, liked biome tags, soil items, growth requirements by kind (sub-soil materials and ore names, light levels, machine-only), the seed item. The `meta.cropsnh_crop` blob lacks most of these (§2.7). CropsNH's own `dumpCrops()` columns are a ready checklist.
2. **Tool durability** per GT material (`Materials.mDurability`) and the tool multipliers per `IDMetaTool01` id, to price tree farm wear; or hard-code §1.5 for the handful of tools.
3. Nothing more for the tree farm or the algae pond: their rows plus the rules on this page are enough.

### 5.8 The rubber example end to end

**Source.** TGS at LV (one LV energy hatch), Rubber Tree Sapling, Steel saw and Steel knife, no branch cutter and no shears (saplings and leaves are not wanted). Per op of 100 t (**[script]** `rubber_example.py`, from §1.3 and the row in §1.6): `1 × 5 × 5 × 1` = **25 Rubber Wood** and `1 × 5 × 1 × 1` = **5 Sticky Resin**, for 3,000 EU and `1/512` saw + `1/512` knife. At MV (two LV hatches or one MV hatch): 45 and 9 for 12,000 EU.

**Processing rows (**[export]**):**

- Centrifuge, `{"map":155,"in":[[11825,1],[37883,0]],"out":[[2588,1,5000],[2715,1,3750],[11834,1,2500],[12476,1,2500]],"fin":[],"fout":[["methane",60]],"eut":20,"dur":200,"inAlt":[[[11825,1]]]}`: 1 Rubber Wood (+ circuit 2) → expected 0.5 Sticky Resin, 0.375 Plantball, 0.25 Carbon Dust, 0.25 Wood Pulp, 60 L Methane. Raw Rubber Dust does not come from this row; the extractor gives 1 Raw Rubber Dust per Rubber Wood (`2 EU/t, 300 t`).
- Centrifuge, `{"map":155,"in":[[2588,1]],"out":[[14610,3],[2715,1,1000]],"fin":[],"fout":[["refinedglue",100]],"eut":5,"dur":300}`: 1 Sticky Resin → 3 Raw Rubber Dust, 0.1 Plantball, 100 L Refined Glue.
- Macerator `logWood` (Rubber Wood is one of its 159 alternatives): 1 log → 6.8 Wood Pulp (`2 EU/t, 400 t`).

**What one Electronic Circuit needs** (**[export]**): circuit assembler `1 Circuit Board + 2 Resistor + 2 Red Alloy Wire + 2 Vacuum Tube + 72 L Soldering Alloy` (15 EU/t, 200 t); Circuit Board: assembler `8 Wood Plank + 32 Copper Foil + 576 L Refined Glue → 8` (or 1,152 L Glue); Resistor: assembler `1 Coal Dust + 4 Fine Copper Wire + 4 Copper Wire + 288 L Refined Glue → 4`, where the dust slot also takes Carbon, Charcoal or Lignite dust (`inAlt[0]`); Wood Plank: compressor `8 Wood Pulp → 1`, or assembler `64 Wood Pulp + 72 L Refined Glue → 32`. Per circuit: **216 L Refined Glue** (= 2.16 Sticky Resin centrifuged), **0.5 carbon-type dust**, **1 Wood Plank** (8 pulp, or 2 pulp + 2.25 L glue). Vacuum tubes, red alloy, solder and copper do not come from trees.

**Coverage per TGS op** (**[script]**):

| Use of the 25 logs | Resin | Refined Glue | Carbon | Pulp | Circuits' worth of glue / carbon / planks (compressor; assembler) |
|---|---|---|---|---|---|
| all centrifuged | 17.5 | 1,750 L | 6.25 | 6.25 | 8.1 / 12.5 / 0.8; 3.1 |
| all macerated | 5 | 500 L | 0 | 170 | 2.3 / 0 / 21.3; 85 |
| best split (23.6 centrifuged, 1.4 macerated, assembler planks) | 16.8 | 1,680 L | 5.9 | 15.4 | **7.7 circuits per op = 92 per minute** |

The best split needs about 9,760 centrifuge ticks per 100 ticks of farm (23.6 logs × 200 t + 16.8 resin × 300 t): about 98 LV centrifuges or 49 MV ones (one overclock halves the time). The tree farm is cheap; the centrifuging is the real machine cost, and the planner's step count will show it.

**Smaller lines.** One Electronic Circuit per minute needs 2.16 Sticky Resin, 0.5 carbon dust and 1 plank per minute. A knife-only TGS at LV gives 60 Sticky Resin per minute (enough glue for 27.8 circuits per minute) and runs 4 % of the time. Before IV, the same resin comes from an MV Industrial Farm with 225 Sticky Cane seeds at 1/1/1 (79 per minute with fertilizer, §2.5) or from crop sticks under an LV Crop Manager with watering and fertilizing on and open sky (N = 27: 0.26 resin per stick per minute at 1/1/1, 4.41 at 31/31/31; 121 sticks in one 11 × 11 layer).

**"Half of the mats."** The line's raw materials by kind are copper (foil, wires, fine wire), red alloy (copper and redstone), glass (glass tubes), steel (rods), solder metals (tin, lead, antimony), sticky resin (glue), wood (planks) and a coal-type dust (resistors). The rubber farm covers the last three: **3 of 8 kinds**, all of the line's organic inputs. By amount the metals dominate (UNVERIFIED share; the planner's raw-material totals give it). The Blood Sapling's redstone fruit (§1.7) and a Ferrofern or Coppon leaf farm (ore boosters, §2.8) are the next renewable levers for the same line.

## Appendix: how the evidence was gathered

- Disassembly: `J --multi-release 17 -cp $GT` for `gregtech.common.tileentities.machines.multi.MTETreeFarm` (+ `$1`, `$Mode`), `gtPlusPlus.xmod.gregtech.common.tileentities.machines.multi.production.MTETreeFarmLegacy` (+ `$1`), `gtPlusPlus.xmod.gregtech.loaders.recipe.RecipeLoaderTreeFarm`, `gregtech.api.recipe.maps.TGSFrontend`, `gregtech.common.tileentities.machines.multi.MTEAlgaePond` (+ `$1`), `...algae.MTEAlgaePondBaseLegacy`, `gtPlusPlus.xmod.gregtech.loaders.recipe.RecipeLoaderAlgaePond`, `gregtech.api.util.GTUtility`, `gregtech.api.util.GTModHandler`, `gregtech.api.items.MetaGeneratedTool`, `gregtech.api.items.MetaBaseItem`, the `gregtech.common.tools.Tool*` classes, `gregtech.loaders.materials.MaterialsInit`, `gregtech.api.enums.MaterialBuilder`, `gregtech.api.enums.OrePrefixes`, `gregtech.loaders.oreprocessing.ProcessingToolHead` and `ProcessingToolOther`, `MTEMultiBlockBase`, `MTEExtendedPowerMultiBlockBase`, `GTPPMultiBlockBase`, `kubatech.tileentity.gregtech.multiblock.eigmodes.EIGNormalMode` and `EIGIC2Mode`.
- `J -cp $CNH` for all 454 non-shaded classes of `com.gtnewhorizon.cropsnh` (crop cards, `TileEntityCropSticks`, `MTECropManager`, `MTEIndustrialFarm`, `BlockSeedBed`, `MTESeedGenerator`, `SeedStats`, `CropRegistry`, loaders, NEI dumpers, Forestry compat). `$CNH` `assets/cropsnh/lang/en_US.lang` for tooltips.
- `J -cp $FOR` for `forestry.farming.logic.CropRubber`, `FarmLogicRubber`, `FarmLogicArboreal`, `forestry.farming.multiblock.FarmController`, `forestry.arboriculture.items.ItemGrafter` and `ItemRegistryArboriculture`; `javap -cp EnderIO-2.10.46.jar crazypants.enderio.machine.farm.farmers.RubberTreeFarmerIC2`.
- Same-logic check of the two tree farm controllers: the `J` dumps of `process`, `getTierMultiplier`, `useToolForMode`, `getToolMultiplier` and `getOutputsForForestrySapling`, with `#nnn` constant indices and class names masked by `sed`, compared with `diff`.
- Export reads (Python, `-I`, read-only gzip): `recipes-gt.jsonl.gz` (maps 107, 155, 159, 166, 47, the CropsNH maps, producers and users of Sticky Resin, Rubber Wood, the material leaves, Electronic Circuit and its parts), `recipes-crafting.jsonl.gz` (controller and tool recipes), `items.jsonl.gz`, `machines.jsonl.gz`, `recipe-maps.jsonl.gz`, `manifest.json`.
- Scratch scripts (session folder, not committed): `exp.py` (export decoder), `tgs_all.py`, `leafuse.py`, `producers.py`, `crops.py` (crop card extraction from `J` dumps), `farm_model.py` (ports of `getTierMultiplier`, `getTierExtended`, `getGrowthRate`, `getNutrientsPerCycle`, `harvest`, `getDropsPerCycle`), `rubber_example.py`.
- Planner code read for context only: `src/server/planner/candidates.ts` (`acceptRecipe`), `src/server/pack/supply.ts` (rock breaker precedent).
