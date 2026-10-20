# Where GregTech takes each hatch: GT5-Unofficial 5.09.54.183 (GTNH 2.9.0-RC-1)

Status: research note behind `src/server/layout/hatch-rules.ts`. Date: 2026-10-20.

The line layout used to put a multiblock's hatches by one rule for every machine: buses on the front of the bottom
layer, energy and maintenance on its back, every fluid hatch on the top layer. GregTech checks each structure position
against the element at that position, so the rule was wrong for most machines: an Electric Blast Furnace that takes
oxygen got its input hatch on the top layer, where its structure takes an output hatch only, and never formed. This note
reads each machine's own rule from the pack's jar and maps it onto the exported structures.

## How to read this note

- `$GT` is `$PACK/mods/gregtech-5.09.54.183.jar` (GT5U with GT++, BartWorks, TecTech and friends folded in), `$SL` is
  `$PACK/mods/structurelib-1.4.45.jar`, as in gt-mechanics.md. `$GT` is a multi-release jar: a JVM loads a class from
  the highest `META-INF/versions/<n>` at or below its own version (17, 21 or 25 here), and the server this export came
  from runs Java 25 (the server pack takes Java 17 to 26). Of the classes the rows depend on, four have a Java 21 or 25
  variant: `MTEMultiBlockBase`, `GTPPMultiBlockBase` and `MTESteamMultiBlockBase` (21 and 25) and `MTEHatchCokeOven`
  (21). **[jar]** The three bases' hatch adders and checks are the same in all three versions: where a Java 17 class
  tests a hatch's type through a `jvmdowngrader$switch$…` helper (`addToMachineList`, `addOutputBusToMachineList`), the
  21 and 25 classes use `SwitchBootstraps.typeSwitch` over the same classes in the same order; the coke oven hatch
  differs only in the `MatchException` class it throws. So the reads are `javap --multi-release 17 -c -v -p -cp $GT
  <class>`, with `--multi-release 21` and `25` for those four.
- The structure definitions are builder chains in each class's `static {}` (or `getStructureDefinition`,
  `createStructureDefinition`, a constructor). They were turned back into readable calls with a small stack decoder over
  the `javap -c -v` output (bootstrap methods resolve the `::method` references); the decoder and its output stay in the
  session scratch folder, not committed. Strings in a shape lose their trailing spaces in `javap`; rows are padded back
  to the shape's width.
- **[jar]** means read from the bytecode; **[export]** means checked against `structures.jsonl.gz` of the active export
  (2.9.0-RC-1_20261019-221019); **[test]** means a test in this repository checks it.

## 1. What the structure check accepts

- **[jar]** `GTStructureUtility.buildHatchAdder(cls).atLeast(e1, e2, …)` builds an element whose `check`
  (`HatchElementBuilder$2.check`) only calls the combined adder of `e1, e2, …` on the tile at that cell;
  `buildAndChain(block, meta)` lets the cell be that casing instead. `allowOnly` / `disallowOnly` directions are read
  only by `survivalPlaceBlock` (auto-build), never by the check: a hatch's facing does not decide whether it forms.
- **[jar]** `HatchElement` (static init and bootstrap methods): `InputHatch` → `MTEHatchInput` via
  `MTEMultiBlockBase.addInputHatchToMachineList`, `OutputHatch` → `MTEHatchOutput` (`addOutputHatchToMachineList`),
  `InputBus` → `MTEHatchInputBus`, `OutputBus` → `MTEHatchOutputBus`, `Maintenance` → `MTEHatchMaintenance`, `Energy` →
  `MTEHatchEnergy`, `Muffler` → `MTEHatchMuffler`. `Muffler.newAny(…)` is a hatch-only element (no casing alternative).
- **[jar]** `MTEHatchMuffler.polluteEnvironment` needs air in front of the muffler (`getAirAtSide(getFrontFacing())`)
  and returns false without it, and `MTEMultiBlockBase` then calls `stopMachine(POLLUTION_FAIL)`: the cell a muffler
  faces must stay empty.
- **[jar]** Each class's `checkMachine` also asks for hatches whatever the recipe moves (`checkHasEnergyHatch`,
  `checkHasMaintenanceHatch`, `checkHasMufflerHatch`, `checkHasInputHatch`, `checkHasInputBus`, …); §4 lists them per
  class.

## 2. From shape strings to the exported structure

- **[jar]** `ExtendedFacing(String)` (`$SL`): for a controller facing north the axes are a → WEST, b → DOWN, c → SOUTH
  (the `$SwitchMap` gives NORTH case 3, whose locals are `WEST, DOWN, SOUTH`). The exporter builds every multiblock
  facing north (`ExtendedFacing.NORTH_NORMAL_NONE`, `StructuresSection.placeController`) and shifts the blocks so that
  the minimum corner is the origin. So a shape cell (a, b, c) of a piece checked with `checkPiece(name, a0, b0, c0)`
  lands on the export cell **controller + (−(a − a0), −(b − b0), c − c0)**: x runs west as a grows, y up as b falls, z
  back. A shape built with `StructureUtility.transpose` is written `shape[b][c]` (layers from the top, rows from the
  front); a raw one `shape[c][b]`.
- **[export]** Proof, cell by cell, for every row of §4 and for the Assembly Line: every shape cell other than `' '`
  lands on an exported block, `'~'` on the export's controller, `'-'` on a cell without a block, and every exported block
  on a shape cell.
  - EBF (1000): `checkPiece("main", 1, 3, 0)`; the export's controller is (1, 0, 0) in a 3×4×3 box; `fff/fmf/fff` lands
    on y = 3 with the exported muffler (mte 99) at (1, 3, 1); `b~b` on y = 0; the coil rings' `'-'` on the two exported
    air cells (1, 1, 1) and (1, 2, 1).
  - Assembly Line (1170), the axis direction: `construct` builds `"first"` at (0, 1, 0) and `"later"` at (−1 … −4, 1, 0);
    the export's controller is at x = 4 of a 5-wide box and the line runs to x = 0, which only a → west gives.
  - Large Bronze Boiler (15529), asymmetric along a: its chimney (`'   C'`, a = 3) lands on x = 1, the controller on
    x = 2.
- **[test]** `tests/unit/layout/real-hatch-rules.test.ts` (with `GTNH_LOCAL=1`) checks that every row fits the exported
  structure of its class, and lays out the corpus of §3 in every logistics mode: every hatch on an element its row
  takes it on, every class's `checkMachine` needs, element facts and casing minimum as §4 gives them (kept in the test
  apart from the table), and every fluid and bus port joined to its pipe, conduit face or interface, or warned
  `route_failed`.

## 3. Which multiblocks matter

The real-data corpus (`tests/helpers/real-corpus-lines.ts`: every line the planner's real-data tests plan, as
settings) has 67 lines: `real-corpus.test.ts`'s 16 targets × 3 variants; the 15 further lines of
`real-acceptance.test.ts`, with its pinned solder and recipe and its six avoid lists (its LV Machine Hull at LV is the
corpus's per minute with supporting lines); and `real-user-project.test.ts`'s stored settings per hour, per minute,
with supporting lines and for an Advanced Circuit. Aluminium Ingot at LV plans nothing (`infeasible`), so 66 plans,
placing 9 multiblocks (steps and units summed over the lines):

| Multiblock (mte) | Class | Corpus lines | Steps | Units |
|---|---|---|---|---|
| Electric Blast Furnace (1000) | `MTEElectricBlastFurnace` | 24 | 72 | 104 |
| Bricked Blast Furnace (140) | `MTEBrickedBlastFurnace` | 17 | 17 | 215 |
| Distillation Tower (1126) | `MTEDistillationTower` | 11 | 39 | 39 |
| Oil Cracking Unit (1160) | `MTEOilCracker` | 11 | 17 | 17 |
| Large Chemical Reactor (1169) | `MTELargeChemicalReactor` | 11 | 86 | 86 |
| Pyrolyse Oven (15546) | `MTEPyrolyseOven` | 10 | 10 | 10 |
| Coke Oven (236) | `MTECokeOven` | 8 | 8 | 154 |
| Vacuum Freezer (1002) | `MTEVacuumFreezer` | 6 | 7 | 7 |
| Steam Blender (31084) | `MTESteamMixer` | 3 | 3 | 3 |

Every recipe a group can run at LV, MV or HV (`acceptRecipe`), put on the machine `pickMachine` chooses, adds four more:
Implosion Compressor (1001, 1096 recipes), Large Bronze Boiler (15529, 150), Bacterial Vat (12712, 71) and Solar
Factory (367, 4). All 13 have a row.

## 4. The rows

Element characters are GT's. "Bottom", "top" and coordinates are the export frame (x west → east, y up, z front → back).

| Class (shape, checkPiece) | Where each hatch goes | Also |
|---|---|---|
| `MTEElectricBlastFurnace` ("main" transposed, 1, 3, 0) | `b`, the bottom layer but the controller: input and output hatch, input and output bus, maintenance, energy. `f`, the top layer but its middle: output hatch only. `m`, the top middle: muffler only (hatch-only). `C`: coils. | An input hatch never goes on top. The top output hatches are ordinary ones in this version (`OutputHatch` with the default adder). `checkMachine`: energy, maintenance, any input, any output. |
| `MTEDistillationTower` ("base" at 1, 0, 0, then "layer" at 1, h, 0 for h = 1 … up to 11) | `b`, the bottom: energy, output bus, input hatch, input bus, maintenance. `l`, every layer above: an output hatch (`addLayerOutputHatch`), energy, maintenance. `c`, a layer's middle: air below the top; on the top layer a casing, an output hatch or output bus (`addOutputToMachineList`, so no layer's output) or a maintenance hatch, any of which marks the top (`mTopLayerFound`). | `addFluidOutputs` gives the k-th fluid output to layer k; `missingOutputHatchDT` for a layer without one; at least 3 layers; `missing_top`; `checkCasingMin(7 × layers − 5)`; `checkHasEnergyHatch`, `checkHasMaintenanceHatch` and `checkHasInputHatch` whatever the recipe moves (the export's 4 Oil Berry recipes take an item and a circuit and no fluid). |
| `MTELargeChemicalReactor` (1, 1, 0) | `c` and `x`: all six; `x` also holds the one coil; `P`: PTFE pipe casing. | `need_exactly_one_coil`; `checkCasingMin(8)`; `checkMachine`: energy, maintenance, any input, any output. |
| `MTEOilCracker` (2, 1, 0) | `l` (x = 4): input hatch (`addLeftHatchToMachineList`), energy, maintenance. `r` (x = 0): output hatch (`addRightHatchToMachineList`), energy, maintenance. `m` (x = 2): the middle input hatch, input bus, energy, maintenance. `c`: coils. | The side adders take inputs on one side and outputs on the other, either way round; the table puts inputs on `l`. `getStoredFluidsForColor` reads only catalysts from the middle hatches and only other fluids from the sides; `OilCrackerBackend` makes a recipe's second fluid input a catalyst. `checkMachine`, whatever the recipe moves: a side input hatch and a side output hatch (`missingHatch(InputHatch)`, `missingHatch(OutputHatch)`), a middle input hatch (`cracker_missing_middle_input_hatch`), maintenance, energy; `checkCasingMin(18)`. |
| `MTEVacuumFreezer` (1, 1, 0) | `C`: all six. | `checkCasingMin(16)`; `checkMachine`: energy, maintenance, any input, any output. |
| `MTEImplosionCompressor` (1, 1, 0) | `C`: input and output bus, maintenance, energy, muffler. | No fluid hatch; `checkHasMufflerHatch`, `checkHasInputBus`, `checkHasOutputBus`, energy, maintenance; `checkCasingMin(16)`. |
| `MTEPyrolyseOven` ("main" raw, 3, 4, 0) | `F` (levels y = 2 and 3): input bus, input hatch, muffler. `G`, the bottom layer: output bus, output hatch, energy, maintenance. `D` (the controller's level): casings. | Its input bus can never stand on the bottom. `checkHasMufflerHatch`, energy, maintenance, any input, any output; `checkCasingMin(60)`. |
| `MTEBioVat` (2, 3, 0) | `c`, top and bottom layers: all six (and a radio hatch). `g`: glass. | `checkHasInputHatch`, `checkOneOutputHatch` (exactly one output hatch), energy, maintenance, at most one radio hatch; `checkCasingMin(19)`. |
| `MTESolarFactory` ("t1", 2, 4, 0) | `A`, top and bottom layers: input hatch, input bus, output bus, maintenance, energy. | No output hatch; `checkHasInputBus`, `checkHasInputHatch`, `checkHasOutputBus`, `checkHasAnyEnergy`, maintenance; `checkCasingMin(15)`. |
| `MTESteamMixer` ("main", 2, 2, 0) | `A`: the steam input hatch (`MTEHatchCustomFluidBase` with steam), steam input and output buses (`MTEHatchSteamBusInput`, `MTEHatchSteamBusOutput`), input and output hatch. | No energy or maintenance hatch (`getDefaultHasMaintenanceChecks` false); `checkHasSteamInput`, any input, any output; `checkCasingMin(25)`. |
| `MTELargeBoilerBronze` (`MTELargeBoilerBase`, "main" raw, 2, 4, 0) | `C` and `F`: input hatch, input bus, output hatch, maintenance, muffler. | `checkHasMaintenanceHatch`, `checkHasMufflerHatch`, `checkHasInputHatch`, `checkHasOutputHatch`; `checkCasingMin(20)` casings and `(5)` fireboxes. `onRunningTick` boils water from its input hatches into steam (`addOutputPartial`) and calls `explodeMultiblock` when `consumeWater` fails ("Boiler had no water"); its recipes (`largeboilerfakefuels`) name only the fuel, so the water and the steam each need a hatch of their own. |
| `MTEBrickedBlastFurnace` (1, 2, 0) | No hatch at all (a `MetaTileEntity`): firebricks and lava. | `allowPutStack` and `allowPullStack` are false: it is loaded and emptied by hand. |
| `MTECokeOven` (1, 1, 0) | `C`: the Coke Oven Hatch (`MTEHatchCokeOven`) only. | No maintenance (`getDefaultHasMaintenanceChecks` false); the controller takes items from no side. |

## 5. How the layout uses the rows

- A hatch goes only on a cell whose element takes it and that holds its element's usual block (so never on the LCR's
  coil), and it faces an open cell, its port, that no other hatch of the unit faces: buses the spine (on it, or above it
  for the pyrolyse oven's input bus, where every mode climbs the spine's column), energy and maintenance the back, fluid
  hatches up where they may (as before), else a side, else the back, first onto a column (x, z) that holds no other
  port of the unit: ports stacked in one column wall each other in. A port beside a unit keeps a column of its own,
  off the power head and the tail. The fluid pipes, ender fluid conduits, pump covers and cable trees follow the port.
- The distillation tower gets one output hatch per layer, the recipe's fluids in its own order, and is built taller
  (copies of its first layer) for a recipe with more fluids, up to 12 layers. A layer no fluid reaches still gets one.
  Its layer ports take columns of their own, so they alternate west, east and back instead of stacking in its front
  corner (on the 66 plans of §3, distillation tower `route_failed` warnings fell from 19, 17 and 21 to 4, 7 and 3 in the
  direct, routed and AE2 modes).
- The cracker's second fluid input goes in its middle hatch. What a row's `needs` names (the `checkMachine` checks of §4
  that ask for a hatch whatever the recipe moves) is added, empty, where the recipe's hatches give none: the tower's
  input hatch, the cracker's side and middle hatches, the implosion compressor's and the solar factory's buses, the
  bacterial vat's input and output hatch, a muffler (the export's UHV one becomes the lowest tier). A large boiler
  always gets a water input hatch and a steam output hatch, which no recipe names, and `hatch_by_hand` says to keep
  water in it and take the steam by hand. A casing minimum is kept.
- A muffler's front cell is kept as air, and the line's height counts it: a muffler facing up from the top of the
  tallest multiblock (every EBF-only line) stands one block above the blocks, so the site, its clearance and
  obstruction checks and the site step's "(N high)" keep that block free, and the multiblock's place step and the roof
  step say to keep it empty.
- No energy hatch on a machine GT feeds no EU (the bricked blast furnace, the coke oven, the large boiler, the steam
  mixer); the steam mixer gets a Steam Hatch and steam buses. What a step needs that GT takes nowhere on the machine
  warns `hatch_not_taken`; a multiblock without a row keeps the old placement and warns `hatch_rules_unknown`.

## 6. Open questions

- The coke oven takes only Coke Oven Hatches, which the layout does not place: its items and creosote are moved by hand.
- Multiblocks outside §3 (the Assembly Line with its fixed bus and data-hatch slots, most GT++ and BartWorks machines)
  have no row yet. Many GT++ machines take any hatch on any casing (`addToMachineList`), but each needs its own read.
- The pack loader drops a recipe's empty fluid output slots, so a distillation recipe with an empty slot between two
  fluids would shift the later fluids down a layer; none was seen.
- The bacterial vat takes exactly one output hatch (`checkOneOutputHatch`); the layout places one per fluid output, and
  every vat recipe of the export has one.
- The tower's top middle (`c`) may hold an output hatch or bus that is no layer's output; the layout puts nothing there.
