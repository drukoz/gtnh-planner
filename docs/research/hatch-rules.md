# Where GregTech takes each hatch: GT5-Unofficial 5.09.54.183 (GTNH 2.9.0-RC-1)

Status: research note behind `src/server/layout/hatch-rules.ts`. Date: 2026-10-20.

The line layout used to put a multiblock's hatches by one rule for every machine: buses on the front of the bottom
layer, energy and maintenance on its back, every fluid hatch on the top layer. GregTech checks each structure position
against the element at that position, so the rule was wrong for most machines: an Electric Blast Furnace that takes
oxygen got its input hatch on the top layer, where its structure takes an output hatch only, and never formed. This note
reads each machine's own rule from the pack's jar and maps it onto the exported structures.

## How to read this note

- `$GT` is `$PACK/mods/gregtech-5.09.54.183.jar` (GT5U with GT++, BartWorks, TecTech and friends folded in), `$SL` is
  `$PACK/mods/structurelib-1.4.45.jar`, as in gt-mechanics.md. `$GT` is a multi-release jar that the pack's Java 17–26
  runs from `META-INF/versions/17`, so every read is `javap --multi-release 17 -c -v -p -cp $GT <class>`.
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
- **[jar]** `MTEHatchMuffler.polluteEnvironment` needs air in front of the muffler (`getAirAtSide(getFrontFacing())`),
  so the cell a muffler faces must stay empty.

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
  structure of its class.

## 3. Which multiblocks matter

The real-data corpus (the targets of `tests/unit/planner/real-*.test.ts`: 16 targets × 3 variants, 9 acceptance lines,
4 of the user's project; 60 plans) places 9 multiblocks:

| Multiblock (mte) | Class | Corpus lines | Steps | Units |
|---|---|---|---|---|
| Electric Blast Furnace (1000) | `MTEElectricBlastFurnace` | 18 | 53 | 85 |
| Bricked Blast Furnace (140) | `MTEBrickedBlastFurnace` | 14 | 14 | 212 |
| Coke Oven (236) | `MTECokeOven` | 8 | 8 | 154 |
| Distillation Tower (1126) | `MTEDistillationTower` | 7 | 27 | 27 |
| Oil Cracking Unit (1160) | `MTEOilCracker` | 7 | 12 | 12 |
| Large Chemical Reactor (1169) | `MTELargeChemicalReactor` | 7 | 59 | 59 |
| Pyrolyse Oven (15546) | `MTEPyrolyseOven` | 7 | 7 | 7 |
| Vacuum Freezer (1002) | `MTEVacuumFreezer` | 6 | 7 | 7 |
| Steam Blender (31084) | `MTESteamMixer` | 2 | 2 | 2 |

Every recipe a group can run at LV, MV or HV (`acceptRecipe`), put on the machine `pickMachine` chooses, adds four more:
Implosion Compressor (1001, 1096 recipes), Large Bronze Boiler (15529, 150), Bacterial Vat (12712, 71) and Solar
Factory (367, 4). All 13 have a row.

## 4. The rows

Element characters are GT's. "Bottom", "top" and coordinates are the export frame (x west → east, y up, z front → back).

| Class (shape, checkPiece) | Where each hatch goes | Also |
|---|---|---|
| `MTEElectricBlastFurnace` ("main" transposed, 1, 3, 0) | `b`, the bottom layer but the controller: input and output hatch, input and output bus, maintenance, energy. `f`, the top layer but its middle: output hatch only. `m`, the top middle: muffler only. `C`: coils. | An input hatch never goes on top. The top output hatches are ordinary ones in this version (`OutputHatch` with the default adder). |
| `MTEDistillationTower` ("base" at 1, 0, 0, then "layer" at 1, h, 0 for h = 1 … up to 11) | `b`, the bottom: energy, output bus, input hatch, input bus, maintenance. `l`, every layer above: an output hatch (`addLayerOutputHatch`), energy, maintenance. `c`, a layer's middle: air, or a block on the top layer. | `addFluidOutputs` gives the k-th fluid output to layer k; `missingOutputHatchDT` for a layer without one; at least 3 layers; `checkCasingMin(7 × layers − 5)`. |
| `MTELargeChemicalReactor` (1, 1, 0) | `c` and `x`: all six; `x` also holds the one coil; `P`: PTFE pipe casing. | `need_exactly_one_coil`; `checkCasingMin(8)`. |
| `MTEOilCracker` (2, 1, 0) | `l` (x = 4): input hatch (`addLeftHatchToMachineList`), energy, maintenance. `r` (x = 0): output hatch (`addRightHatchToMachineList`), energy, maintenance. `m` (x = 2): the middle input hatch, input bus, energy, maintenance. `c`: coils. | The side adders take inputs on one side and outputs on the other, either way round; the table puts inputs on `l`. `getStoredFluidsForColor` reads only catalysts from the middle hatches and only other fluids from the sides; `OilCrackerBackend` makes a recipe's second fluid input a catalyst. `checkCasingMin(18)`. |
| `MTEVacuumFreezer` (1, 1, 0) | `C`: all six. | `checkCasingMin(16)`. |
| `MTEImplosionCompressor` (1, 1, 0) | `C`: input and output bus, maintenance, energy, muffler. | No fluid hatch; `checkHasMufflerHatch`; `checkCasingMin(16)`. |
| `MTEPyrolyseOven` ("main" raw, 3, 4, 0) | `F` (levels y = 2 and 3): input bus, input hatch, muffler. `G`, the bottom layer: output bus, output hatch, energy, maintenance. | Its input bus can never stand on the bottom. `checkHasMufflerHatch`; `checkCasingMin(60)`. |
| `MTEBioVat` (2, 3, 0) | `c`, top and bottom layers: all six (and a radio hatch). | `checkOneOutputHatch`; `checkCasingMin(19)`. |
| `MTESolarFactory` ("t1", 2, 4, 0) | `A`: input hatch, input bus, output bus, maintenance, energy. | No output hatch; `checkCasingMin(15)`. |
| `MTESteamMixer` ("main", 2, 2, 0) | `A`: the steam input hatch (`MTEHatchCustomFluidBase` with steam), steam input and output buses (`MTEHatchSteamBusInput`, `MTEHatchSteamBusOutput`), input and output hatch. | No energy or maintenance hatch (`getDefaultHasMaintenanceChecks` false); `checkHasSteamInput`. |
| `MTELargeBoilerBronze` (`MTELargeBoilerBase`, "main" raw, 2, 4, 0) | `C` and `F`: input hatch, input bus, output hatch, maintenance, muffler. | `checkHasMufflerHatch`; `checkCasingMin(20)` casings and `(5)` fireboxes. |
| `MTEBrickedBlastFurnace` (1, 2, 0) | No hatch at all (a `MetaTileEntity`): firebricks and lava. | `allowPutStack` and `allowPullStack` are false: it is loaded and emptied by hand. |
| `MTECokeOven` (1, 1, 0) | `C`: the Coke Oven Hatch (`MTEHatchCokeOven`) only. | No maintenance (`getDefaultHasMaintenanceChecks` false); the controller takes items from no side. |

## 5. How the layout uses the rows

- A hatch goes only on a cell whose element takes it and that holds its element's usual block (so never on the LCR's
  coil), and it faces an open cell, its port, that no other hatch of the unit faces: buses the spine (on it, or above it
  for the pyrolyse oven's input bus, where every mode climbs the spine's column), energy and maintenance the back, fluid
  hatches up where they may (as before), else a side, else the back. A port beside a unit keeps a column of its own,
  off the power head and the tail. The fluid pipes, ender fluid conduits, pump covers and cable trees follow the port.
- The distillation tower gets one output hatch per layer, the recipe's fluids in its own order, and is built taller
  (copies of its first layer) for a recipe with more fluids, up to 12 layers. A layer no fluid reaches still gets one.
- The cracker's second fluid input goes in its middle hatch. A needed muffler is placed (the export's UHV one becomes
  the lowest tier) with the cell it faces kept as air. A casing minimum is kept.
- No energy hatch on a machine GT feeds no EU (the bricked blast furnace, the coke oven, the large boiler, the steam
  mixer); the steam mixer gets a Steam Hatch and steam buses. What a step needs that GT takes nowhere on the machine
  warns `hatch_not_taken`; a multiblock without a row keeps the old placement and warns `hatch_rules_unknown`.

## 6. Open questions

- The coke oven takes only Coke Oven Hatches, which the layout does not place: its items and creosote are moved by hand.
- Multiblocks outside §3 (the Assembly Line with its fixed bus and data-hatch slots, most GT++ and BartWorks machines)
  have no row yet. Many GT++ machines take any hatch on any casing (`addToMachineList`), but each needs its own read.
- The pack loader drops a recipe's empty fluid output slots, so a distillation recipe with an empty slot between two
  fluids would shift the later fluids down a layer; none was seen.
