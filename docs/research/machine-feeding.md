# Feeding machines without overfill or deadlock (GTNH 2.9.0-RC-1)

Status: research reference, revision 2 (2026-10-20). Revision 1 was reviewed adversarially; this revision corrects its Project Red and tool claims, adds the cases the review broke it with (§5), and gives the rulings per lane (§6) and the design of a feeding checker (§7). It serves add-on 12 Task 6 (crafting steps on the GT++ Auto Workbench, shared machines), add-on 15 (machine to machine), add-on 19 (logistics parts and their cost), a fix lane on main and the build steps.

The user's request (2026-10-20): "remember that logistic pipes have to interact correctly with the machines so over filling lets say a workbench has to be taken into account". A push network keeps inserting what it holds while the target takes it. One ingredient can then fill every input slot and keep the others out (a deadlock), or a machine fills with a stack it cannot use. This page reads from the pack's jars what each machine kind accepts (§1) and how each logistics mode pushes into it (§2), and gives per machine kind and mode the cheapest configuration that can neither overfill nor deadlock, what it costs and what the steps must say (§3). It audits main's layouts (§4).

## How to read this page

- Jars (from the server's `mods` folder, read with `javap -c -p -l`): `gregtech-5.09.54.183.jar` (GT5-Unofficial with GT++ and GGFab folded in; a multi-release jar, so `javap --multi-release 17`), `EnderIO-2.10.46.jar` with `endercore-0.5.15.jar`, `appliedenergistics2-rv3-beta-1073-GTNH.jar` with `ae2fc-1.5.110-gtnh.jar`, `ProjRed-4.12.44-GTNH.jar` with `MrTJPCore-1.3.7.jar`, and `gtnhlib-0.11.51.jar` (the item transfer code GT and GTNH's AE2 share). TConstruct and TGregworks were read for one question (§2.3).
- Tags: **[jar]** read in the bytecode; **[src]** read in the mod's source at the tag the jar was built from (GT5-Unofficial `5.09.54.183`, Applied-Energistics-2-Unofficial `rv3-beta-1073-GTNH`, EnderIO `2.10.46`, ProjectRed `4.12.44-GTNH`, MrTJPCore `1.3.7`); where both were read, the jar's `LineNumberTable` matches the source lines quoted. **[cfg]** the pack's server config. **[export]** the planner's active export. **[probe]** main's layouts, planned and laid out with no world by a scratch script (not committed). **[model]** a scratch Python model of the Auto Workbench's mode-0 code (§1.3, line for line from the bytecode) fed by simplified network policies (not committed). **UNVERIFIED** = not checked in game or in code.
- "Insert" means an automated insertion. In 1.7.10 every network here asks `ISidedInventory.canInsertItem(slot, stack, side)` for each slot. For a GT tile that is the side's cover (`letsItemsIn(slot)`) and `CommonMetaTileEntity.canInsertItem`: a valid slot (`isValidSlot`), empty or holding the same item with the same NBT (`GTUtility.areStacksEqual`), and the machine's `allowPutStack(slot, side, stack)` **[jar]**. `isItemValidForSlot` is only the slot test, so the rules below hold for inserters that use `canInsertItem`; all four of the planner's networks do.

## 0. In brief

1. **The Auto Workbench takes anything, anywhere.** In "Normal Crafting Table" mode its nine input slots take any item from any face, 64 each, with no check against its grid. A network that keeps pushing one ingredient fills all nine. The bench then ejects stacks out of its back: where that face refuses them it stops for good, and where it takes them a bug in its clean-up loop **deletes** stacks (in the model, a Resistor bench fed through whitelist filters deleted 4,038 ingredients in 20 minutes, §1.3). Every mode must cap each ingredient at the bench: EnderIO a Limited Item Filter, Project Red an Item Stock Keeper Chip, AE2 an exact pattern with a Locking Card. Direct mode cannot cap it yet.
2. **GT tools cannot run on a bench.** Each craft damages the tool, the damaged tool no longer matches the grid, and the bench stops after one craft. GGFab's single-use tools (made 64 at a time in a Fluid Solidifier at MV) are ordinary ingredients and work. The planner must feed them as consumed inputs; the planner's first option for a file slot is already the Single Use File, but it counts it as a held one-off.
3. **GT machines fed two or more kinds of item are safe only with Multi Stack Input Off.** With it On, the first kind fills every free input slot. Off is the client default, but each machine takes its placer's client setting, and no step says which.
4. **Input buses fed two or more kinds need Limiting mode on.** One recipe's items must reach one bus, or Input Separation (on by default in the EBF) must be off.
5. **Routed lines on main move nothing.** A new Item Extractor Chip is an empty whitelist, and main lays them bare.
6. **AE2 patterns on main list piped fluids and fractional chance outputs.** As written they cannot be planned; encoded, a fluid becomes an item that jams the machine. Blocking mode must be on for GT machines and off for benches.
7. **Shared machines starve in push networks.** A GT machine reruns its last recipe and waits when that recipe's output is blocked, so on a routed line the other recipe never runs. AE2 with blocking mode on is fine.
8. **The user's Electronic Circuit line in EnderIO mode** is safe today as long as its Alloy Smelter and Circuit Assembler have Multi Stack Input Off.

| Machine kind | Direct (add-on 15) | Routed (Project Red) | AE2 | EnderIO |
|---|---|---|---|---|
| GT singleblock, 1 kind | as add-on 15 plans | Responder (whitelist inputs) + Extractor (whitelist outputs) | blocking mode on | Basic filter whitelist (as today) |
| GT singleblock, 2+ kinds | Multi Stack Input Off (add-on 15 plans it) | the same + Multi Stack Input Off | the same; Multi Stack Off advised | the same + Multi Stack Input Off |
| Input bus, 2+ kinds | Limiting mode on; one bus per recipe or Input Separation off | Limiting mode on; no Extractor on input buses | Limiting mode on | Limiting mode on |
| Machine shared by 2+ steps | never shared | never shared (§1.1.5) | blocking mode on | never shared |
| Auto Workbench | not fed yet (a pipe would flood it) | Stock Keeper + Extractor (result) + Broadcasters on its suppliers | blocking off, Locking Card, pattern = the grid | Limited Item Filter in, Basic filter out |

## 1. How each machine kind takes items

### 1.1 GT basic singleblock machines (`MTEBasicMachine`)

#### 1.1.1 Slots

- Inventory size is `5 + inputs + outputs + 1` **[jar]**. Slot 3 is the special slot (`getSpecialSlotIndex`), slot 4 the programmed circuit (`getCircuitSlot`), then the inputs (`getInputSlot` = 5), then the outputs. `isValidSlot` leaves out slot 0, the circuit slot and the last slot, so automation never reaches the circuit **[jar]**.
- Held items (molds, extruder shapes, schematics, lenses) sit in an input slot and take it; a programmed circuit does not (it is ghost slot 4).
- Input slot counts are set per machine and tier in `LoaderMetaTileEntities` (`setSlotsCount(in, out)`) **[src]**. The export does not carry them.

| Machine | LV | MV | HV | EV |
|---|---|---|---|---|
| Assembler | 6 | 9 | 9 | 9 |
| Circuit Assembler | 6 | 6 | 6 | 6 |
| Mixer | 6 | 6 | 6 | 9 |
| Forming Press | 2 | 2 | 4 | 4 |
| Laser Engraver | 2 | 2 | 2 | 4 |
| Alloy Smelter, Chemical Reactor, Arc Furnace, Extruder, Wiremill, Bending Machine, Cutting Machine, Canner, Centrifuge, Electrolyzer, Autoclave | 2 | 2 | 2 | 2 |
| Packager (`MTEBoxinator`, item + schematic) | 2 | 2 | 2 | 2 |
| Compressor, Extractor, Macerator, Lathe, Polarizer, Forge Hammer, Electric Furnace, Fluid Extractor, Fluid Solidifier, Chemical Bath, Electromagnetic Separator, Fluid Heater | 1 | 1 | 1 | 1 |

#### 1.1.2 What may go in, and where **[jar]**

`MTEBasicMachine.allowPutStack`:

```java
if (side == mMainFacing) return false;                                  // never through the front
if (aIndex < getInputSlot() || aIndex >= getInputSlot() + mInputSlotCount) return false;   // input slots only
if (!mAllowInputFromOutputSide && side == base.getFrontFacing()) return false;              // output side needs the setting
for (int i = getInputSlot(), j = i + mInputSlotCount; i < j; i++)
    if (GTUtility.areStacksEqual(GTOreDictUnificator.get(aStack), mInventory[i]) && mDisableMultiStack)
        return i == aIndex;                                             // Multi Stack Input Off: only the slot it is in
return mDisableFilter || allowPutStackValidated(base, aIndex, side, aStack);
```

- `MTEBasicMachine.allowPutStackValidated` is `!mDisableMultiStack || mInventory[aIndex] == null`.
- The Input Filter is `MTEBasicMachineWithRecipe.allowPutStackValidated`. One input slot: the map must contain the item (with fluid in the tank, a full recipe search). Two slots: with one full, a recipe must use both stacks. Three or more: the map check alone; assemblers and circuit assemblers also take anything ore-dictionaried `circuit*`. It keeps out items no recipe of the map uses; it does not stop one kind filling several slots of a 3+ slot machine.

#### 1.1.3 How many stacks of one item

- **Multi Stack Input Off** (`mDisableMultiStack = true`): a kind not yet present may enter any empty input slot; once it is in slot k, more of it goes only into slot k. So each kind holds at most one slot (64, or the item's own stack size). The comparison uses the ore-dictionary-unified stack.
- **Multi Stack Input On**: any empty input slot takes the kind, so one kind can fill every input slot (two stacks of Redstone in a 2-slot Alloy Smelter leave no room for Copper).
- A machine with N input slots, h of them holding held items, fed k kinds, cannot crowd itself out with Multi Stack Off when k ≤ N − h.

#### 1.1.4 Defaults and the controls **[jar]**

- The constructor sets Input Filter Off, Multi Stack Input Off and Input from Output Side allowed. `ItemMachines.placeBlockAt` then calls `initDefaultModes`, which copies the placing player's client preferences (`singleBlockInitialFilter`, `singleBlockInitialAllowMultiStack` in GregTech's `Client.cfg`, both default false). So machines of one line can differ by who placed them, and nothing in the world shows which. They are saved as NBT `mDisableFilter` and `mDisableMultiStack`.
- A sneaking Soldering Iron right-click on the front (`onSolderingToolRightClick`) switches Multi Stack Input; the chat says "Multi Stack Input On" or "Multi Stack Input Off". A Screwdriver right-click on the output side or the front switches Input from Output Side; sneaking, the Input Filter. Every click switches, so a step must name the chat line to stop at.
- Outputs leave only from the output slots (`allowPullStack`). Item auto-output is off on a new machine.

#### 1.1.5 Which recipe runs, and a blocked output **[src]**

`MTEBasicMachine.checkRecipe` asks the map for one recipe (`findRecipeQuery().items(getAllInputs())...cachedRecipe(mLastRecipe).find()`), the last recipe first. If that recipe's output does not fit (`!canOutput`), it counts `mOutputBlocked` and returns without trying another recipe. Inputs are taken when a run starts (`isRecipeInputEqual(true, ...)`).

So a machine that runs two recipes keeps running the last one while its inputs are there, and when that recipe's output cannot leave it waits, even if the other recipe's inputs are present. In a push network producers always run ahead of consumers, so outputs back up as a matter of course; a responder keeps the waiting recipe's inputs topped up, and the other recipe starves. If anything downstream needs the starved recipe, the line deadlocks. AE2 with blocking mode on avoids this: it pushes one recipe's set only into an empty machine, and the outputs go into ME storage.

### 1.2 Multiblock input buses (`MTEHatchInputBus`) and Input Separation

- An input bus has `(tier + 1)²` slots plus a circuit slot automation never reaches **[jar]**. Items go in only through its front. `allowPutStack` = the front, not the circuit slot, the Input Filter (a recipe-map check, off by default) and, unless `disableLimited`, `limitedAllowPutStack`: an item already in a slot goes only into that slot.
- **Limiting mode** is off on a new bus. The bus window's button (tooltip "Limit insertion") or a sneaking Screwdriver click turns it on; the Screwdriver steps through Sorting and Limiting, and the chat names both ("Sorting mode On", "Limiting mode On") **[jar, src]**. With it on, each kind holds one slot; with it off, one kind can fill every slot.
- The input bus lets items be pulled out of its front (`allowPullStack`), so an extractor there takes the inputs back out **[jar]**.
- **Input Separation** **[jar]**: `MTEMultiBlockBase` starts `inputSeparation` from `IControllerWithOptionalFeatures.getDefaultInputSeparationMode()`, which is `supportsInputSeparation()`; the EBF returns true, so a new EBF has it on. With it on, each input bus is checked alone with its own circuit, so all items of a recipe must reach one bus. The controller window has the button; on the EBF a Screwdriver click on the controller also switches it, and the chat says "Input buses are separated" or "Input buses aren't separated".
- Output buses take no automated input and push into the block their front faces. Input hatches take one fluid.
- Main lays one input bus per multiblock, so Input Separation matters only where a layout gives one recipe two or more buses (add-on 15's lanes).

### 1.3 The GT++ Electric Auto Workbench (`MTEElectricAutoWorkbench`)

All of this section is **[jar]** with the source **[src]** at `5.09.54.183`; source line numbers match the jar's. gt-mechanics §8 (on add-on 12's branch) has its ids, tiers and energy.

#### 1.3.1 Slots and what it takes

- 30 slots: 0–8 input buffer, 9–17 output buffer, 18 the result, 19–27 the 3×3 ghost grid, 28 the result preview. `isValidSlot(i)` is `i < 19`, so automation never touches the grid or the preview.
- In mode 0 ("Normal Crafting Table") `allowPutStack` is `aIndex < 9` and `allowPullStack` is `aIndex >= 9` (lines 711, 717): **any item, from any face, into any of the nine input slots**, 64 each, with no check against the grid. A network can put nine stacks of one ingredient into it.

#### 1.3.2 One update, in order (`onPostTick`, lines 182–589)

An update runs only while at least 2,048 EU is stored, and only when a countdown runs out; the countdown counts down only while the EU is there. After an update with no craft it is 32 ticks, after a craft or an ejection 1 tick. Steps 1–4 run only while slot 18 is empty; step 5 runs every update.

1. **Stray** (line 240): if the slot the bench is looking at is one of slots 0–7 and holds an item that is neither in the grid nor the empty container of a grid item, it moves to slot 18.
2. **Craft** (lines 502–554): the grid's result, if slot 17 is empty and slots 0–17 hold every grid item in the grid's count. It takes them from the highest slot first, so the output buffer counts too. Container items go into slots 9–17, the result into 18, and 2,048 EU are drawn.
3. **Failed craft** (lines 557–560): if the grid has a result but something is missing, the **slot-8 stack moves to slot 18**, whatever it is.
4. **Duplicates** (lines 565–573): if slot 18 is still empty, for each pair of equal stacks in slots 0–8 (items that stack above 8) the later one moves to slot 18. The loop checks slot 18 only once, before it starts. With two or more pairs, each move **overwrites** the stack the previous one put in slot 18, and that stack is gone. A bench holding stacks of one ingredient in slots 0–7 loses all but one of the moved stacks in a single update.
5. **Push** (lines 581–586): at throughput settings 0 and 1 it moves one stack, up to 64 items, from slots 9–18 in slot order into the block behind it, through that block's own insertion rules, at 10 EU per item moved. Nothing is pushed at settings 2 and 3.

So once slot 18 holds something the block behind refuses, the bench does nothing more.

#### 1.3.3 What it matches

- Grid items and stored items must be `GTUtility.areStacksEqual`: the same item, the same damage (or a wildcard) and **exactly the same NBT**.
- At each update, grid items that are vanilla-damageable (`isItemStackDamageable`) and have a container item get a wildcard damage (lines 188–192). GT tools are not vanilla-damageable: `MetaGeneratedTool` keeps its wear in NBT and leaves the item's max damage at 0.
- Ore-dictionary cells of a recipe hold one concrete item in the grid, and only that item is used. The pattern of a shaped recipe must be in its shape.

#### 1.3.4 Tools

- **GT tools**: `MetaGeneratedTool.getContainerItem` returns a copy with new wear in its NBT. The bench puts it into the output buffer, where it no longer matches the grid, so the next craft fails. One craft per fresh tool.
- **GGFab single-use tools** (`ggfab:gt.ggfab.d1`, class `GGMetaItemDumbItems`): File, Wrench, Crowbar, Wire Cutter, Hard Hammer, Screwdriver, Saw and Soft Mallet, ore-dictionaried `craftingToolFile` and so on. They have no container item (`GTGenericItem.getContainerItem` returns null) and stack to 64 (`MetaBaseItem.getItemStackLimit`), so a craft uses one up like any ingredient. They are made in the Fluid Solidifier at 120 EU/t with a non-consumed Mold (Single Use …), e.g. 144 L Molten Steel → 64 Single Use Files in 1 s **[export]**. Each mold is crafted from a Hard Hammer, an Empty Shape Plate and the tool.
- In the export, 26,870 of the 60,417 crafting recipes take a tool (a `craftingTool*` ore slot, or a slot that only takes a GT tool item). In 24,674 of them every tool slot is one of the eight single-use kinds. The rest need a Mortar (145), Knife (56), Rolling Pin (4), Soldering Iron (1) or Scoop (1), or take a GT tool item directly (1,989) **[export]**.
- The planner's loader marks every tool slot not consumed (`isToolSlot`, `TOOL_ORE_PREFIX`), and names the slot after its first option, which for a file slot is the Single Use File. On a bench that is wrong: a single-use tool is used up each craft.

#### 1.3.5 Faces, power, covers, tank and buttons

- Results leave through the **back** (`isOutputFacing` = back), the face with the pipe overlay. Energy enters every face but the back (`isInputFacing`), at 1 A of V[tier]. At throughput settings 0 and 2 it also emits V[tier] out of its back.
- Covers fit every face but the front and the back (`allowCoverOnSide`), so no conveyor cover on its back. A Wrench click on a face makes that face the front (`MetaTileEntity.onWrenchRightClick`); any face may be the front.
- It has a 16,000 L tank that any face fills (`canTankBeFilled`). With fluid in it, it fills empty containers in slots 0–17 and puts them into slots 0–8, where they are strays unless the grid uses them. Keep fluid pipes and fluid conduit faces off it.
- GUI: the bottom-left button is the mode (tooltip "Mode: Normal Crafting Table" for mode 0); the top-left button is the throughput setting (icons only; a new bench is at 0).

#### 1.3.6 What the networks see

- `IMetaTileEntity.isIOSlot` defaults to true and the bench does not override it (only `MTEBasicMachine` does in the GT jar), so `GTItemSink.getStoredItemsInSink` counts all 30 slots, ghost grid and preview included. AE2's blocking mode uses that count for `gt.blockmachines` tiles (§2.3), so **a blocking interface never pushes into a bench whose grid is set**.
- `getStackInSlot` returns the ghost items too, so EnderIO's Limited Item Filter counts one item per grid cell (§2.1).
- Project Red sees slots 0–18 (`getAccessibleSlotsFromSide`): its Stock Keeper counts real stock, the output buffer and slot 18 included.

#### 1.3.7 Throughput

A craft needs 2,048 EU: 64 ticks at LV (0.31/s), 16 at MV (1.25/s), 4 at HV, 1 from EV. A recipe that returns a container (a bucket, a cell) crafts at most every second update, because the push moves the container stack first and slot 18 must be empty to craft (0.61/s at MV in the model).

#### 1.3.8 When a bench is safe (the cap rule)

A bench never strays, ejects or deletes when, for every ingredient i with a_i per craft:

- only grid items ever reach slots 0–8 (a whitelist, or exact AE2 patterns);
- its stock s_i (what sits in slots 0–8) stays between a_i and its stack size, so it always merges into one slot: no duplicate pairs;
- Σ ⌈s_i / stack size_i⌉ ≤ 8, so slot 8 stays empty: inserters fill the lowest empty slot first, so a failed craft (a missing ingredient) has nothing to eject;
- the block behind takes the result and the container returns (AE2 interface, EnderIO extract filter, or the routed Extractor pulling them).

A recipe that needs all nine input slots for one craft (nine kinds, or unstackable ingredients filling nine slots) cannot meet the third rule: each shortage ejects slot 8. Only AE2 with a Locking Card (one whole set at a time) or hand crafting fits it.

#### 1.3.9 Model runs [model]

A Resistor bench at MV (grid: Sticky Resin, Fine Copper Wire, Sticky Resin / 1x Copper Wire, Carbon Dust, 1x Copper Wire / –, Fine Copper Wire, –), 20 minutes, suppliers at full speed: Sticky Resin 1/s, each wire 2/s, Carbon Dust 0.1/s from the 60th second.

| Feed | Crafts | Ejections | Deleted | End state |
|---|---|---|---|---|
| EnderIO Basic Item Filter (whitelist of the grid), extract filter = Resistor | 0 | 2 | 3 | slot 18 holds Copper Wire the face refuses: dead |
| The same, extract filter passing everything | 113 | 2,320 | 4,038 | runs, but 1,084 ingredients leak to other faces |
| EnderIO Limited Item Filter, 2 crafts + grid cells (6, 6, 6, 3) | 113 | 0 | 0 | runs at the Carbon Dust rate |
| Project Red Item Responder (whitelist of the grid) | 0 | 2 | 2 | dead, as the first row |
| Project Red Item Stock Keeper, 2 crafts | 113 | 0 | 0 | runs |
| AE2, blocking off, pattern = grid, jobs of 10 / 200 / 2,000 | all, at the EU limit | 0 | 0 | a big job fills all nine slots, harmlessly |
| AE2, pattern holding another Fine Copper Wire item than the grid, job of 500 | 0 | 1,241 | 1,816 | the whole job pushed and churned |
| The same with a Locking Card | 0 | 1 | 0 | one set pushed, the job waits visibly |

With every supplier fast, the Stock Keeper's 100-tick cadence caps the bench: 2 crafts of stock gave 0.40 crafts/s, 4 gave 0.80, 8 gave 1.24 (the MV maximum). The Limited Item Filter refills at once, and 2 crafts gave 1.24. The Locking Card cost AE2 no throughput in the model, whichever of the interface and the bench ticked first.

### 1.4 The AE2 Molecular Assembler

It takes a crafting pattern only while its nine slots are empty, so it cannot be overfilled **[src]**. Its recipe is an HV assembler recipe (480 EU/t: an Advanced Assembling Machine III, 4 Titanium Plates, a Formation Core, an Annihilation Core and 288 L Molten Glass) **[export]**, so an MV group cannot build it. It has the same tool problem as the bench: a pattern holds exact items, so tool recipes need single-use tools there too.

## 2. How each mode pushes

### 2.1 EnderIO 2.10.46 item conduits

- **Insertion** **[jar]**: `NetworkedInventory.insertItem` applies the face's Insert-side filter, then EnderCore's `ItemUtil.doInsertItem` walks `getAccessibleSlotsFromSide`, asks `canInsertItem` per slot, merges into existing stacks and puts the rest into the **first** empty slot (one per insertion). So §1's rules hold, and an item enters the lowest free slot.
- **Extraction**: an Extract or In / Out side pulls 4 items, plus 4 per speed upgrade, every 10 ticks, from one source slot at a time, and offers them to the Insert sides of its channel colour in priority and distance order (or round robin). It moves only what they take.
- **Filters**: Basic (5), Advanced (10) and Big (24) Item Filters are whitelists or blacklists that match meta and NBT by default; none limits an amount. An empty whitelist passes nothing.
- **Limited Item Filter** (`ItemFilterLimited`, item `EnderIO:itemLimitedItemFilter@0`) **[src, jar]**: 10 slots, each with a count of 1 up to the item's stack size (shift-click or the wheel steps by 10). Its limit for an item is the sum of the counts of the slots that match it. On an Insert side, `NetworkedInventory.insertItem` inserts at most `limit − count`, where `count` is that item in **every slot of the target** (`getInsertLimit` walks `getSizeInventory()` with `getStackInSlot`), and nothing at or below 0. An item it does not list has a limit of 0, so it is also a whitelist. For an Auto Workbench the count includes one per grid cell holding the item, so the number to set is the stock wanted plus its grid cells. Recipe: an Advanced Item Filter and a Comparator in an assembler, 120 EU/t, 15 s **[export]**.
- **Pushes into a conduit**: a conduit takes a stack a machine pushes (`ItemConduit.insertItem`) only through a face that extracts (Extract or In / Out) and whose Extract-side filter passes it; gtnhlib wraps the conduit (`ItemDuctSink`), so the bench's push reaches it. Self feed off keeps a face from inserting into the inventory it took from.

### 2.2 Project Red 4.12.44-GTNH routed pipes

All **[src]** in Scala, with the chip classes' defaults and returns checked in the jar.

- **Item Responder Chip** (`ChipItemResponder.getSyncResponse`): if its filter allows the item, it answers with the room `InvWrapper.getSpaceForItem` finds: a full stack for every slot that is empty and passes `canInsertItem`, plus what fits on matching stacks. The interface pipe (`RoutedInterfacePipePart.getSyncResponse`) then subtracts what is already on its way there (`transitQueue`): the same item's count, and a full stack per slot that other items in transit will need. Revision 1 said it did not; it does. It still overshoots on an empty machine with Multi Stack Input Off: each empty slot counts a stack, the machine takes one; the extra bounces and is routed again.
- **Item Extractor Chip** (`ChipExtractor`): a new chip is a **whitelist with an empty filter** (`TChipFilter.$init$`: `filterExclude = false`), and it extracts only items with `filter.hasItem(item) != filterExclude`, so a bare chip extracts nothing **[jar]**. Every 10 ticks it lists every item in every slot the machine shows that side (inputs included), and for each one it finds a route (never back to its own machine) and extracts up to 64. When an extraction finds nothing to take (an input item, which GT does not let out), it **abandons the whole update** (Scala `return` inside the loop; a `NonLocalReturnControl` throw in the jar). So it must whitelist the machine's outputs.
- **Item Broadcaster Chip** (`ChipBroadcaster`): a new chip is a **blacklist** with an empty filter (`filterExclude = true`), so it offers everything the machine shows, inputs included. It promises what a request asks for and extracts it every 10 ticks (up to 8 stacks or 64 items, never more than the requester has room for); when its extraction fails it drops the order (`timeOutOnFailedExtract`), and the requester asks again later. It must whitelist the machine's outputs.
- **Item Stock Keeper Chip** (`ChipStockKeeper`, trait `TChipStock`): 9 stock slots, counts up to 255, mode "when missing" by default. Every 100 ticks, plus 10 ticks per earlier pass that requested nothing (at most 1,200 more), it requests for each stock item `min(stock − (stored + en route + promised), room, 128)`. A change next to it resets the slowdown (`onNeighborTileChanged`). Only Broadcaster and Crafting Chips fill its requests.
- **Item Terminator Chip**: a filtered responder at priority "Terminated", below every Item Responder ("Passive") and above the Overflow Responder ("Default"). Routing prefers the higher priority.
- **Arrival** (`PayloadPipePart.passToInventory`): `injectItem` merges, then fills empty slots; what does not fit bounces back and is routed again, or wanders. The pack's `ProjectRed.cfg` sets "Routed Pipes: Max Wander Distance" to 0, which means unlimited **[cfg]**: a wandering item is never erased.
- **Restart**: an item in a pipe saves only its stack and travel data (`AbstractPipePayload.save`); its destination and every pipe's in-transit count are not saved. After a restart, items whose only destination was a request (not a responder) wander, and Stock Keepers ask again.
- **Pipes take no pushes**: no routed pipe part is an inventory **[jar]**, so a machine's own push into a routed pipe moves nothing; only chips move items.

### 2.3 AE2 rv3-beta-1073-GTNH interfaces

- **How a GT tile is reached** **[src, jar]**: GT has no `InventoryAdaptor` capability, so AE2 uses gtnhlib's `WrappedItemIO` over GT's `GTItemSink`, which fills matching stacks first, then empty slots, asking `canInsertItem` per slot.
- **`pushPattern`** (`DualityInterface`) **[src, jar]**: it refuses while the interface still has items to send or a crafting lock is on. For each target side, a machine that accepts whole patterns (a Molecular Assembler) gets the pattern; any other inventory first passes the blocking test, then gets each stack, leftovers moving on. What no side took goes to the interface's send list, and the push still counts as done; the interface retries the list on its own tick and is busy until it is empty. There is no "only if it all fits" test.
- **Targets**: a full-block ME Interface pushes into every neighbour unless a Wrench points it at one. On main no interface touches a second inventory **[probe]**.
- **Blocking mode** ("Do not push crafting items if inventory contains items"): a side is skipped unless it counts as empty. For a `gt.blockmachines` tile, empty means `GTItemSink.getStoredItemsInSink` finds nothing outside AE2's blocking-ignore registry. `GTItemSink` counts the slots `isIOSlot` names: a basic machine's input slots, and every slot of anything else (input buses, the Auto Workbench). GT registers (`AE2Compat.registerBlockingModeIgnoreItems`) the programmed circuit, its 31 molds (`gregtech:gt.metaitem.01` 32301–32331), 28 extruder shapes (32350–32377), 2 slicer blades (32398–32399), its own and BartWorks' lenses and a few special lenses; AE2 adds its inscriber presses and blood orbs **[src, export]**. Not registered, so a blocking interface **never** pushes into a machine holding one: the Packager's schematic, GGFab's single-use tool molds, TGregworks' Shard Casts and TConstruct's casts (neither jar registers anything **[jar]**). Smart blocking skips the test when the pattern is the one pushed last, so its first push still needs an empty target. The Advanced Blocking Card only matters when the target is another interface.
- For a basic machine with blocking on, the next set goes in when the run starts (GT takes the inputs then), so nothing idles and every kind holds one set at most.
- **Locking Card** (`appliedenergistics2:item.ItemMultiMaterial@65`, upgrade `LOCK_CRAFTING`): adds Lock Crafting "Until crafting result is returned" (`LOCK_UNTIL_RESULT`): after a push the interface pushes nothing more until the pattern's result has entered the network **[src]**. The export has only an opaque crafting recipe for it **[export]**.
- **Fluids in a plain interface's pattern** **[src, jar]**: `pushPattern` turns a fluid stack into an ae2fc Fluid Packet item (stack size 1) unless the interface is a Dual Interface. A GT machine with the Input Filter off takes the packet into a free input slot for good; with the filter on, or no free slot, it waits in the send list and the interface is stuck.
- **Jobs**: a crafting CPU completes when the requested outputs arrive. A pattern whose output a later pattern needs must deliver that output into ME storage, or the job waits for ever. Fluids piped from machine to machine, and chance outputs that come back short, never arrive.

### 2.4 GT pipes and covers (machine to machine)

- A GT item pipe hands a stack to any block that takes it, by the block's own rules. The Filtered Conveyor Cover never stops a pipe; the Shutter Module Cover on "Only Input allowed" does; conveyor covers below mode 6 let items only out or only in (add-on 15's research has the rest). None limits an amount.
- The Robot Arm cover (`CoverArm`) can import into one chosen slot of its host (`setSinkSlots`, one stack per operation; the chat says "Grabs in for own Slot #n" for slot n − 1) **[src]**. Its `letsItemsIn` is true for every slot, so a pipe touching the same face still pushes anywhere: an arm can only give a bench ingredient its own slot by pulling from a buffer inventory that does not push (UNVERIFIED in game).

## 3. Per machine kind and mode: what to lay, what it costs, what the steps say

Free settings cost a tool click. Prices of the new parts: the Item Stock Keeper, Broadcaster and Terminator Chips are circuit-assembler recipes like the Responder (4 chips per LV circuit, a plate and two Illumar; 30 EU/t); the Limited Item Filter is an Advanced Item Filter and a Comparator (MV assembler); the Locking Card has only an opaque recipe in the export; a Robot Arm cover is an LV Robot Arm (2 LV motors, an LV piston, 2 steel rods, an LV circuit, 3 tin cables) **[export]**.

### 3.1 GT singleblock machines

| Mode | Fed 1 kind | Fed 2+ kinds | Cost |
|---|---|---|---|
| Direct | as add-on 15 plans | Multi Stack Input Off (add-on 15 plans it); kinds ≤ input slots − held at the machine's tier | free |
| Routed | Item Responder Chip (whitelist: its inputs) + Item Extractor Chip (whitelist: its outputs) | the same + Multi Stack Input Off | the Extractor whitelist is free; same chips as today |
| AE2 | one processing pattern of item inputs → whole guaranteed item outputs; blocking mode on, unless it holds an item off AE2's ignore list | the same; Multi Stack Input Off advised (blocking keeps one set anyway) | free |
| EnderIO | as today (Basic, Advanced or Big Item Filter whitelists) | as today + Multi Stack Input Off | free |

Overfill and deadlock risk without it: with Multi Stack Input On, routed and EnderIO deadlock (the first kind to arrive takes every free input slot); AE2 does not, because each push brings every kind.

### 3.2 Input buses and multiblocks

| Mode | Configuration | Risk without it |
|---|---|---|
| Every mode, bus fed 2+ kinds | Limiting mode on | one kind fills every slot of the bus |
| Every mode, one recipe through 2+ buses | all its items on one bus, or Input Separation off | each bus is checked alone: no bus ever holds a whole set |
| Routed | Responder only on an input bus (never an Extractor); Extractor (whitelist: outputs) only on an output bus | an extractor on an input bus pulls the inputs back out (two EBFs pass dust back and forth) |
| AE2 | blocking mode on (the circuit slot's programmed circuit is ignored) | the interface fills every free slot |

### 3.3 A machine shared by two or more steps (add-on 12's sharing pools)

- **Routed**: never share. §1.1.5: the machine reruns one recipe and waits on its blocked output while responders top up its inputs; the other recipe starves.
- **AE2**: share, with blocking mode on (one recipe's set at a time; outputs go to ME, never blocked). Only machines whose held items are all on AE2's ignore list; the kinds of the largest recipe must fit the machine's own input slots at its tier, minus held items.
- **Direct, EnderIO**: never share (add-on 12 already rules so).

### 3.4 The Auto Workbench

| Mode | How it takes items there | Configuration | Cost per bench |
|---|---|---|---|
| Every mode | — | mode "Normal Crafting Table"; the grid exactly the recipe, cell by cell in its shape, single-use tools in tool cells; the back (pipe overlay) against the line's logistics block, the front away from it; power to the front or a side, never the back; no fluid face; the top-left button on its first state | free |
| Direct | a pipe or conveyor fills all nine slots with whatever it carries | no pipe until add-on 15 tests Robot Arms: one arm per ingredient (at most 4: covers fit neither front nor back), each pulling from a buffer chest at its lane's end into a slot of its own | per ingredient: 1 Robot Arm cover + 1 chest (UNVERIFIED) |
| Routed | a responder answers with the room of all nine slots | Item Stock Keeper Chip (each ingredient at its stock, §3.6) + Item Extractor Chip (whitelist: its container returns, and its result when a machine's responder or the output chest takes it); + Item Broadcaster Chip (whitelist: the result) when another bench takes it. Each maker of a bench ingredient: + Item Broadcaster Chip (whitelist: its outputs that benches take). A bench-only item (one no responder takes) is on no Extractor's whitelist, only on Broadcasters'. The input chest: + Item Broadcaster Chip for raw inputs benches take. The output chest: + Item Terminator Chip (whitelist: the bench-only items), which catches them only when they lose their way, after a restart | 1 Stock Keeper instead of a Responder; 1 Broadcaster per supplier; 1 Terminator per line |
| AE2 | blocking never pushes into a bench (its grid counts); blocking off pushes whole sets until the slots are full | blocking mode off; a **Locking Card** on "Until crafting result is returned"; one processing pattern of exactly the grid's items (single-use tools included) → the result (+ container returns); no conveyor cover (the bench pushes into the interface itself) | 1 interface, 1 pattern, 1 Locking Card |
| EnderIO | a whitelist filter lets one ingredient fill all nine slots | the face on its back In / Out; Insert: a **Limited Item Filter**, each ingredient at its stock plus its grid cells; Extract: a Basic Item Filter with the result and container returns | a Limited Item Filter instead of a Basic one |

Why the Locking Card is required in AE2: with exact patterns a flood is harmless (crafts never fail, §1.3.9), but a pattern holding another variant of an ingredient than the grid makes the bench churn the whole job and delete stacks; with the card it stops after one set and the job waits where the player can see it.

### 3.5 AE2 steps without a whole item output, or without an item input

- A step whose item outputs are none or only chanced (a Fluid Extractor, a Centrifuge whose outputs are all chanced): no pattern. An ME Export Bus on its middle-row face, filtered to its item inputs, keeps it fed (with Multi Stack Input Off it stops at one stack a kind); it runs whenever storage has them, and its chanced outputs return through its conveyor cover.
- A step whose only input is a piped fluid (the Fluid Solidifier making Glass Tubes): no pattern and no feed; it runs from its pipe and its output returns to ME. Jobs then rely on stock.
- Every other pattern: item inputs only (no fluid the line pipes, no held item, no circuit) → whole, guaranteed item outputs only (chanced byproducts still return to storage).

### 3.6 Sizing a bench's stock

For ingredient i with a_i per craft, r the bench's planned crafts per second and t the travel time from its suppliers:

- EnderIO: s_i = 2 a_i (the Limited Item Filter refills at once). The Limited count is s_i plus the item's grid cells.
- Routed: s_i = a_i × max(2, ⌈r × (5 s + t)⌉), because the Stock Keeper asks every 100 ticks at best.
- Either: s_i ≤ the item's stack size, and Σ ⌈s_i / stack size⌉ ≤ 8; else the recipe is not safe on that mode (AE2 with a Locking Card, or by hand).
- Example, the Electronic Circuit line's benches at 1 per minute (counts in a Limited Item Filter): Resistor — Sticky Resin 6, Fine Copper Wire 6, 1x Copper Wire 6, Carbon Dust 3; Circuit Board — 1x Copper Wire 24, Coated Circuit Board 3; Vacuum Tube — 1x Copper Wire 9, Fine Copper Wire 6, Glass Tube 3, Steel Rod 6, Red Alloy Bolt 3; Coated Circuit Board — Sticky Resin 18, Wood Plank 9; Steel Rod by file — Single Use File 3, Steel Ingot 3.

### 3.7 Build and configure step wording

- GT singleblock fed 2+ kinds: "Multi Stack Input off: sneak-right-click its front with a Soldering Iron (where a neighbour covers the front, the edge of the wrench grid toward it) until the chat says "Multi Stack Input Off"" (add-on 15's words).
- Input bus fed 2+ kinds: "Limiting mode on: sneak-right-click it with a Screwdriver until the chat says "Limiting mode On"" (add-on 15's words).
- Multiblock with one recipe through 2+ buses: "Input Separation off: the controller window's Input Separation button (on the EBF, a Screwdriver right-click on the controller) until the chat says "Input buses aren't separated"".
- Auto Workbench, place: "Place 1× Auto Workbench (MV) with its back, the face with the pipe opening (the front shows a crafting grid), against the <conduit / ME interface / routed pipe>: with a Wrench, right-click its side away from the middle row to make that its front. Run its power cable to the front or a side, never the back, and keep fluid pipes off it."
- Auto Workbench, configure: "Mode Normal Crafting Table (the bottom-left button; its tooltip names the mode). Grid, top row first: Sticky Resin, Fine Copper Wire, Sticky Resin / 1x Copper Wire, Carbon Dust, 1x Copper Wire / empty, Fine Copper Wire, empty. Leave the top-left button on its first state."
- EnderIO bench face: "In / Out. Insert on Red with a Limited Item Filter: Sticky Resin 6, Fine Copper Wire 6, 1x Copper Wire 6, Carbon Dust 3 (each count includes the item's cells in the grid). Extract on Red with a Basic Item Filter: Resistor."
- Routed bench pipe: "Item Stock Keeper Chip (when missing): Sticky Resin 4, Fine Copper Wire 4, 1x Copper Wire 4, Carbon Dust 2 + Item Extractor Chip (whitelist: Resistor)". Supplier: "+ Item Broadcaster Chip (whitelist: …; a new one is a blacklist, so switch its filter to whitelist)". Output chest: "+ Item Terminator Chip (whitelist: …)". Every machine: "Item Extractor Chip (whitelist: <its outputs>)".
- AE2 bench interface: "1 processing pattern: <grid items> → <result>; blocking mode off; Locking Card, Lock Crafting: Until crafting result is returned". AE2 machine interface: "blocking mode on" ("blocking mode off" for a Packager, a Fluid Solidifier with a single-use mold, or any machine holding a cast).

## 4. Audit of main's layouts [probe]

Method: a scratch worktree of main (`7c14d4f`), the active export, no world: an Electronic Circuit line at MV (1 per minute; also with crafting automated), Red Alloy Ingot (60/min), the LV Electric Motor (6/min) and the Vacuum Tube (30/min), each in routed, AE2 and EnderIO. For every machine input the probe listed its slots (§1.1.1), held items and what the mode's part there lets in. On main a crafting step is a pseudo machine that is never laid out, so no Auto Workbench appears. No machine is fed more kinds than its free slots.

### 4.1 Routed, worst first

1. **No item moves.** Every Item Extractor Chip is laid bare, and a new one is an empty whitelist (§2.2): nothing leaves the input chest or any machine. A builder who flips them to blacklist meets the next trap: the chip also lists input items, and when the first one it tries could go to another machine, the extraction fails and the chip gives up that update. Machines that share an input (the Alloy Smelter and the two Wiremills on Copper Ingot; the three Centrifuges on Rubber Wood) then let their outputs out only when every sibling is full.
2. **Multi Stack Input left to chance**: with it On, the first kind fills every input slot of the Alloy Smelter, Circuit Assembler, Chemical Reactor, Assemblers, Mixer and Arc Furnaces, and the line deadlocks. Off (the client default) is safe.
3. **Items bound for steps without units have no responder.** In the Electronic Circuit line, Copper Wire, Fine Copper Wire, Glass Tube, Red Alloy Bolt, Steel Rod and Wood Plank go only to hand-crafted steps, so each maker stops when its output slot fills.
4. **Input-bus ports get an Extractor Chip** (once configured, it pulls the inputs back out: the two Redstone Alloy EBFs pass dust back and forth), and output-bus ports a Responder that never answers.
5. Empty Multi-Stack-Off machines are credited a stack per empty slot; the overshoot bounces and is routed again (churn, no deadlock).
6. The Bricked Blast Furnaces get buses they cannot use (known; the steam and primitive fix lane).

### 4.2 AE2, worst first

1. **Patterns list fluids the line pipes** (Molten Tin, Molten Glass, Molten Rubber, Oxygen, Molten Redstone Alloy). ME never holds them, so the CPU cannot plan the job; encoded as written, the interface pushes a Fluid Packet item into the machine. That jams the Fluid Solidifier's interface for good (its only slot holds the mold), and takes an input slot of the others for good.
2. **Fluid-only outputs never return to ME** ("1× Tin Dust → 144× Molten Tin", the Chemical Reactor's Molten Rubber, the Oxygen, Water and Methane outputs): jobs that need them stall, and a step whose only input is a piped fluid ("144× Molten Glass → 1× Glass Tube") has no item to put in a pattern.
3. **Chance outputs written as fractions** ("0.50× Sticky Resin + 0.38× Plantball + …", "0.11× Ashes"): a pattern holds whole numbers, and a job that counts on a chanced output gets fewer and stalls.
4. **Blocking mode off everywhere**: with one recipe per machine and whole sets this only buffers more (no deadlock); with add-on 12's pools it mixes recipes.
5. The Bricked Blast Furnaces (known).

### 4.3 EnderIO, worst first

1. **Multi Stack Input left to chance**, as routed item 2: EnderIO merges, then fills the first empty slot, so with it On the first kind takes every free slot of a 2+ kind machine. The Electronic Circuit line is safe exactly as long as its Alloy Smelter and Circuit Assembler have it Off.
2. The Bricked Blast Furnaces (known).

Everything else holds: whitelists keep strays out, machines fill before chests, every bus takes one kind, and strays leave through output chests.

### 4.4 Direct

Main's direct mode lays one shared pipe with each machine's Input Filter on; add-on 15 replaces it. The Input Filter does not limit slots on a 3+ slot machine, so item 2 of §4.1 applies there too.

### 4.5 Every input that can overfill or deadlock

| Line | Machine (slots, held) | Fed kinds | Routed | AE2 | EnderIO |
|---|---|---|---|---|---|
| Electronic Circuit | Alloy Smelter (2, 0) | Copper Ingot, Redstone | 1, 2 | — | 1 |
| Electronic Circuit | Circuit Assembler (6, 0) | Red Alloy Wire, Vacuum Tube, Resistor, Circuit Board (+ Molten Tin piped) | 1, 2 | 1 | 1 |
| Electronic Circuit | Fluid Solidifier (1, mold) | (Molten Glass piped) | 1, 3 (Glass Tube) | 1, 2 | — |
| Electronic Circuit | Fluid Extractor ×2 (1, 0) | Tin Dust; Sand | 1 | 2 | — |
| Electronic Circuit | Centrifuge ×3 (2, 0) | Rubber Wood | 1 | 2, 3 | — |
| Electronic Circuit | Wiremill ×3, Extruder, Lathe, Compressor | one kind each | 1, 3 | — | — |
| Red Alloy | Alloy Smelter ×2 (2, 0) | Copper Dust, Redstone | 1, 2 | — | 1 |
| Electric Motor | Chemical Reactor (2, 0) | Raw Rubber Dust, Sulfur Dust | 1, 2 | 2 | 1 |
| Electric Motor | Assembler (9, 0) | Magnetic Iron Rod, Iron Rod, Copper Wire, Tin Cable | 1, 2 | — | 1 |
| Electric Motor | Assembler (9, 0), tin cable | Tin Wire (+ Molten Rubber piped) | 1 | 1 | — |
| Vacuum Tube | Mixer (6, 0) | Redstone, Raw Silicon Dust, Coal Dust | 1, 2 | — | 1 |
| Vacuum Tube | Arc Furnace (2, 0) | Iron Dust, Charcoal Dust | 1, 2 | — | 1 |
| Vacuum Tube | Arc Furnace (2, 0), annealing | Copper Ingot (+ Oxygen piped) | 1 | 1 | — |
| Vacuum Tube | Assembler (9, 0) | Glass Tube, Annealed Copper Wire, Steel Rod (+ Molten Redstone Alloy piped) | 1, 2 | 1 | 1 |
| Vacuum Tube | EBF ×2 (Input Bus ULV) | Redstone Alloy Dust | 1, 4 | — | — |
| Vacuum Tube | EBF (Input Bus ULV) | Cast Iron Dust (+ Oxygen piped) | 1, 4 | 1, 3 | — |
| Vacuum Tube | Bricked Blast Furnace ×2 | Chalcopyrite, Glass, Charcoal Dust | 6 | 5 | 2 |
| Vacuum Tube | Electrolyzer, Pyrolyse Oven | one kind each | 1 | 2 | — |

The numbers are the items of §4.1, §4.2 and §4.3 for that mode.

### 4.6 Auto Workbenches with today's parts

With crafting automated, the Electronic Circuit line has five crafting steps: Resistor, Circuit Board, Vacuum Tube, Coated Circuit Board, and Steel Rod from a Steel Ingot and a file (it replaces the Lathe). If add-on 12 Task 6 laid them with each mode's current part: routed responders and EnderIO whitelist filters flood them and they die or delete (§1.3.9); AE2 with blocking off works only while every pattern matches its grid exactly; direct's pipe floods them; and laid like a basic machine, a bench's power cable lands on its back, which takes no EU. The Steel Rod bench stops after its first craft: the planner holds the Single Use File as a one-off instead of feeding one per craft.

## 5. Counterexamples and their fixes

| # | Case | What happens (evidence) | Fix (lane) |
|---|---|---|---|
| C1 | Tool recipes on a bench (all modes) | A GT tool's wear goes into its NBT, so it no longer matches the grid after one craft; a single-use tool the planner holds as a one-off is used up by the first craft (§1.3.4) | Bench steps consume a GGFab single-use tool per craft; other tool kinds are by hand with the reason (add-on 12) |
| C2 | A flooded bench whose back takes what it ejects | The duplicates loop overwrites slot 18: 4,038 items deleted in the model (§1.3.2, §1.3.9) | Never lay a bench without its mode's cap (add-on 12) |
| C3 | Routed machines sharing an input | A blacklist Extractor tries an input item first, fails and gives up the update; a bare one extracts nothing (§2.2) | Extractor whitelist = the machine's outputs (fix lane) |
| C4 | Routed bench fed by a bench | A default Broadcaster offers the Sticky Resin in its own bench's input slots, fails, drops the order; the requester waits (§2.2) | Broadcaster whitelist = the machine's outputs (add-on 12) |
| C5 | Routed restart | Destinations and transit counts are not saved; bench-only ingredients in pipes wander for ever (wander limit 0) and Stock Keepers ask again (§2.2) | Item Terminator Chip on the output chest whitelisting bench-only items, which no Extractor may then list (add-on 12) |
| C6 | Routed bench needed faster than its Stock Keeper refills | 2 crafts of stock cap an MV bench at 0.40 crafts/s (§1.3.9) | Size stock by §3.6; warn when it cannot fit (add-on 12) |
| C7 | Routed shared machine | It reruns the last recipe and waits on its blocked output; the other recipe starves (§1.1.5) | No routed pools (add-on 12) |
| C8 | AE2 machine holding an item off the ignore list (Packager schematic, GGFab single-use mold, TGregworks or TConstruct cast) | Blocking mode never pushes (§2.3) | Decide blocking by the held items' ids against GT's list (fix lane) |
| C9 | AE2 step whose only input is a piped fluid | The pattern would be empty; it cannot be encoded (§2.3) | No pattern; it runs from its pipe (fix lane) |
| C10 | A recipe that needs all nine input slots on EnderIO or routed | Every shortage ejects slot 8, which the result-only filter refuses: the bench dies (§1.3.8) | Such recipes go to AE2 with a Locking Card or by hand (add-on 12) |
| C11 | AE2 pattern holding another variant than the grid, no Locking Card | Strays churn back to ME, the whole job is pushed, 1,816 items deleted in the model (§1.3.9) | Locking Card on every bench interface (add-on 12) |
| C12 | A fluid pipe or fluid conduit face on a bench | Its tank takes any fluid and it fills containers into its input slots (§1.3.5) | No fluid face on a bench (add-on 12) |
| C13 | Shaped recipes and ore-dictionary cells | A grid in the wrong shape has no result; another variant in a cell never matches (§1.3.3) | The configure step gives the grid cell by cell with the planner's concrete items (add-on 12) |
| C14 | Container returns (buckets, cells) | They land in slots 9–17; if the extract filter refuses them, the buffer fills and crafting stops (slot 17 must be empty); they also halve the craft rate (§1.3.7) | Extract filters, Extractor whitelists and AE2 pattern outputs include them; the rate counts them (add-on 12) |
| C15 | Routed Stock Keeper after a fault | It counts slot 18 and the output buffer as stock, so an ejected ingredient there is never replaced (§1.3.6) | Prevented by the caps; the checker flags any ejection (checker) |
| C16 | Routed item that is both a surplus and a bench ingredient (Sticky Resin) | The maker's Extractor sends it to the output chest every 10 ticks while the bench's request races it: slower, not stuck (UNVERIFIED) | The checker measures it; more stock if slow (checker) |
| C17 | Direct-mode bench | A lane pipe touching it fills all nine slots (§2.4) | No pipe; Robot Arms from buffer chests, after an in-game test (add-on 15) |
| C18 | One recipe through two input buses with Input Separation on | No bus ever holds a whole set (§1.2) | One bus per recipe, or Input Separation off (add-on 15) |
| C19 | Routed overshoot into empty Multi-Stack-Off machines | Each empty slot is credited a stack; extras bounce and are routed again (§2.2) | Accepted as churn; the checker counts bounces (checker) |

## 6. Rulings per lane

### 6.1 Add-on 12 (Task 6 lays out shared machines and Auto Workbenches)

1. **Blocking: no bench without its cap.** Task 6 lays an Auto Workbench only with its mode's configuration of §3.4: EnderIO a Limited Item Filter, routed a Stock Keeper with Broadcasters on its suppliers, AE2 a pattern equal to the grid plus a Locking Card. In direct mode, until add-on 15 adopts Robot Arms, the bench gets no pipe and a warning "Fill this Auto Workbench by hand: machine-to-machine lines cannot cap its ingredients yet".
2. **Blocking: tools.** Before Task 6 lays benches (it changes Task 3's options and the loader): a crafting recipe whose tool slots are all of the eight single-use kinds runs on a bench as a variant whose tool slots are consumed inputs of the matching GGFab single-use tool, one per craft; the grid shows the single-use tool. The hand recipe keeps the tool held. Any other tool slot (Mortar, Knife, Rolling Pin, Soldering Iron, Scoop, or a slot that only takes GT tool items) has no bench option: the step is by hand, saying "needs a <tool>, which an Auto Workbench cannot keep using". The loader can add the variant as its own recipe (same outputs, map `crafting`, bench only), so the solve weighs it against the Lathe and the hand recipe on cost.
3. **Routed pools off.** `BuildModel.share` only on AE2 lines (§1.1.5). Task 6's routed pool test changes accordingly.
4. **AE2 pools with blocking on.** A pooled interface's config is `blockingMode: true` (Task 6's text says `false`); pool only machines whose held items are all on AE2's ignore list; size a pool by the machine's own input slots at its tier minus held items (the largest recipe, since blocking sends one set at a time), not by the map's largest recipe (`itemSlots`).
5. **Bench layout.** `facing` is the bench's front, away from the middle row, so its back is the middle-row cell; no `mainFacing`, no `inputFromOutputSide`, no output cover (covers fit neither front nor back); power at the existing away-side port (the front takes EU); no fluid face toward it.
6. **Bench config** (structured, so the steps, the 3D view and the checker read the same thing): `mode: 'normal'`, `grid` as nine cells in the recipe's shape with the planner's concrete items, `throughput: 0`; per mode the chips, filter counts or pattern of §3.4, with stock sized by §3.6, container returns from the export's fluid-container table.
7. **Recipes that cannot meet the cap rule** (one craft needs all nine slots): not on EnderIO or routed benches; on AE2 with the Locking Card; else by hand with the reason.
8. **The bench's rate**: EU-limited as Task 3 has it, halved for recipes with container returns, and on routed lines capped by the Stock Keeper's cadence (§3.6): add benches or warn when the stock cannot fit in a stack.
9. **Molecular Assembler**: offered only where its HV recipe can be built; it needs the same single-use tools.
10. Task 6 builds on the fix lane's chip and pattern text (§6.4), and Task 8's acceptance runs the feeding checker (§7) on the user's Electronic Circuit settings in every mode: no ejection, deletion, stuck bench or starved pool.

### 6.2 Add-on 15 (direct mode)

1. Keep `multiStack: false` for 2+ kinds and `limited: true` for buses fed 2+ kinds; they match §1.1 and §1.2. The fix lane uses add-on 15's words verbatim, so the merge keeps one copy.
2. **Input Separation**: a multiblock step whose items come in through two or more input buses (one per lane network) deadlocks with the EBF's default. Put one recipe's items on one bus, or set `inputSeparation: false` with the step text of §3.7.
3. **Benches**: a lane pipe must never touch an Auto Workbench. Feed one only through Robot Arm covers set to "Grabs in for own Slot #n", one per ingredient (at most four), each pulling from a buffer chest that ends its lane; else leave it by hand with add-on 12's warning. Adopt the arms only after the in-game test of §8.
4. Its rules checker should use the machine's real input slots at its tier and the feeding checker's slot model (§7).

### 6.3 Add-on 19 (logistics parts and cost)

1. New parts to price and count: Item Stock Keeper, Item Broadcaster and Item Terminator Chips (routed), the Limited Item Filter (EnderIO; priced only where the Advanced Item Filter is, its open question 4), the Locking Card (AE2; only an opaque recipe, so an unpriced gap with a warning), the ME Export Bus for AE2 steps without a pattern (§3.5), and, if add-on 15 adopts them, Robot Arm covers and buffer chests.
2. The per-unit estimate gets a bench row per mode: routed interface pipe + Stock Keeper + Extractor (+ Broadcaster when a bench takes its result), and a Broadcaster on each supplier of a bench ingredient, a Terminator per line; AE2 interface + pattern + Locking Card and no conveyor cover; EnderIO a Limited Item Filter (insert) + a Basic Item Filter (extract).
3. "Cheapest adequate filter" never picks a Basic, Advanced or Big Item Filter for a bench's insert side: only the Limited Item Filter is adequate there.
4. Single-use tools and their molds are recipe cost (consumed inputs and one-off held items), not logistics.

### 6.4 Fix lane on main for routed, AE2 and EnderIO — needed now

Routed lines on the live site move nothing as written, and AE2 patterns cannot be encoded as written. Suggested branch `fix/feeding`, merged before add-on 12 Task 6 starts (or Task 6 follows these texts and add-on 12 merges main before Task 8). Scope, main's current single-recipe layouts only:

1. **Routed**: Item Extractor Chip whitelist = the unit's item outputs (the input chest's: its raw inputs); no Extractor on input-bus ports and no Responder on output-bus ports; the output chest's whitelist = every item that leaves the placed steps (to out, sink or a step without units) and every stray, as EnderIO's `edgeFlows` and `crossing` do.
2. **All three modes**: `multiStack: false` on singleblocks fed 2+ item kinds; `limited: true` on input buses fed 2+ kinds; with add-on 15's words.
3. **AE2**: pattern text with item inputs only and whole, guaranteed item outputs only; steps without either get no pattern (§3.5: an ME Export Bus for item-in, fluid-out steps; nothing for fluid-in steps) and a warning that AE2 cannot plan them, so the line relies on stock; `blockingMode: true` for machines and buses whose held items are all on AE2's ignore list, `false` otherwise.
4. **The static rules of the feeding checker** (§7) as layout warnings and unit tests on the five probe lines.
5. Out of scope: benches and pools (add-on 12), direct (add-on 15), prices (add-on 19), Bricked Blast Furnaces (the steam and primitive lane).

### 6.5 Projector and build steps

1. The step words are §3.7's, written by the fix lane (settings) and add-on 12 Task 6 (benches); add-on 14's build list carries them unchanged.
2. Projector: a unit without `mainFacing` (the bench) is checked on its GT front facing only, which must point away from the line; nothing in plan 18's worktree changes now. A client cannot read Multi Stack Input, Limiting mode, Input Separation, chip and filter settings, patterns or a bench's mode and grid, so these stay checklist steps with the chat line to stop at.

## 7. Feeding checker design

A pure module, `src/server/layout/feeding/`, `checkFeeding({ pack, plan, layout, options }) → FeedingReport`.

- **Machine models**: a GT basic machine (input slots by recipe map and tier, from a table built from `LoaderMetaTileEntities` until the export carries slot counts; held items from the recipe's non-consumed inputs; Multi Stack, Input Filter, Input from Output Side; inputs taken at run start; output slots; a cached last recipe that waits on a blocked output); an input bus with Limiting mode and its controller's Input Separation; the Auto Workbench's mode-0 update line for line from §1.3.2 (EU threshold, countdown, stray, craft, failed craft, duplicates with the overwrite, one-stack push to its back); chests as unlimited.
- **Network models**, read from the layout's structured config (chips with filter mode and items, filter kind and counts, patterns with inputs and outputs, blocking and lock, conduit faces and channels): EnderIO 4 + 4 × upgrades items per 10 ticks per extract face, filters, priority and round robin, merge then first empty slot; routed extractors every 10 ticks up to 64 to the best responder (room minus transit), Stock Keepers every 100 ticks plus the idle slowdown, Broadcasters on orders, bounces and wanderers; AE2 a CPU job pushing sets with the send list, blocking, smart blocking and the Locking Card; direct GT pipe pushes from add-on 15's lanes.
- **Static rules** (exact and cheap, in every `layoutLine` as layout warnings): kinds ≤ input slots − held; `multiStack` set where 2+ kinds; `limited` and Input Separation on buses; routed Extractors whitelisting outputs and nowhere on input buses, every made item with a destination, Broadcasters as whitelists; AE2 patterns encodable and blocking set by the ignore list; every bench with its mode's cap, stock within §3.6 and the 8-slot rule, its back on the logistics block, power off its back, no fluid face, single-use tools in tool cells; pools only on AE2 with blocking on.
- **Simulation** (tests and an on-demand check): ticks over 20 minutes of game time with every machine running flat out until its output backs up (the normal state of a push network), under adversarial schedules: one supplier ten times faster, one input delayed, a server restart (routed transit lost), and Multi Stack Input On wherever the layout does not set it. Codes: `feed_crowded` (a kind that cannot enter while its recipe waits for it), `feed_overfill` (a kind in two slots of a capped machine, a bench above its cap or holding a non-grid item), `feed_bench_eject`, `feed_bench_delete`, `feed_bench_stuck`, `feed_no_route` (an output with nowhere to go), `feed_pool_starve`, `feed_fluid_packet`, `feed_pattern_unencodable`, `feed_slow` (a rate below the plan's), `feed_leak` (an item reaching a chest the plan sends to a machine).
- **Acceptance**: no `feed_crowded`, `feed_bench_*`, `feed_pool_starve` or `feed_fluid_packet` on the five probe lines and the user's Electronic Circuit settings in every mode; `feed_slow` only where the plan asks for more than the parts can move.
- **Who builds it**: the static rules in the fix lane (§6.4), as its tests and warnings; the simulation in a new lane (add-on 21 suggested), pure new files, in parallel with add-on 12 Task 6, merged before add-on 12 Task 8, which uses it as a gate, as does add-on 15's Task 8. The exporter then replaces the slot table with exported counts.

## 8. Open questions (UNVERIFIED in game)

- A Limited Item Filter on an In / Out face toward a bench holding the counts of §3.6; a Stock Keeper fed by Broadcasters keeping a bench at its stock; the Locking Card's throughput on an MV bench; Robot Arm covers feeding a bench from buffer chests.
- Whether a GT machine's inventory change resets a Stock Keeper's idle slowdown (`onNeighborTileChanged`), which decides how fast an idle routed bench restarts.
- The Locking Card's recipe (opaque in the export).
- ae2fc Dual Interfaces (fluids into a machine's tank from a pattern) as an AE2 alternative to piping, and an ME Level Emitter to stop free-running AE2 steps (§3.5) at a stock.
- The Project Red Crafting Chip as a pull-based alternative for whole routed lines.
- The pack also has Logistics Pipes (`logisticspipes-1.5.36-GTNH`, with supplier and crafting pipes); the planner does not lay it, and this page did not read it. A supplier pipe that keeps set amounts in a target would suit benches.
