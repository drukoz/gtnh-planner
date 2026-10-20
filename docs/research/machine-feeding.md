# Feeding machines without overfill or deadlock (GTNH 2.9.0-RC-1)

Status: research reference for add-on 12 Task 6 (crafting steps on the GT++ Auto Workbench), add-on 15 (machine to machine) and the routed, AE2 and EnderIO modes. Date: 2026-10-20.

The user's request (2026-10-20): "remember that logistic pipes have to interact correctly with the machines so over filling lets say a workbench has to be taken into account". A push network keeps inserting what it holds while the target takes it, so one ingredient can fill every input slot and keep the others out (a deadlock), or a machine can fill with a stack it cannot use. This page establishes from the pack's jars what each machine kind accepts and how each logistics mode pushes into it (§1–§4), audits main's layouts (§5), and gives, per mode and machine kind, the cheapest configuration that can neither overfill nor deadlock, with what the layout and the build steps must say (§6–§7).

## How to read this page

- Jars (all in `$PACK/mods`, read with `javap -c -p`): `gregtech-5.09.54.183.jar` (`$GT`, GT5-Unofficial with GT++ folded in; a multi-release jar, so `javap --multi-release 17`, as in gt-mechanics), `EnderIO-2.10.46.jar` with `endercore-0.5.15.jar`, `appliedenergistics2-rv3-beta-1073-GTNH.jar` with `ae2fc-1.5.110-gtnh.jar`, `ProjRed-4.12.44-GTNH.jar` with `MrTJPCore-1.3.7.jar`, and `gtnhlib-0.11.51.jar` (the item-transfer code GT and GTNH's AE2 share).
- Tags: **[jar]** read in the bytecode; **[src]** read in the mod's source at the tag the jar was built from (GT5-Unofficial `5.09.54.183`, Applied-Energistics-2-Unofficial `rv3-beta-1073-GTNH`, EnderIO `2.10.46`, ProjectRed `4.12.44-GTNH`, MrTJPCore `1.3.7`); where both were read, the jar's `LineNumberTable` matches the source lines quoted; **[cfg]** the pack's server config; **[probe]** main's layouts, planned and laid out on the active export without a world by a scratch script (not committed); **UNVERIFIED** = not checked in game or in code.
- "Insert" means an automated insertion. In 1.7.10 every network here asks `ISidedInventory.canInsertItem(slot, stack, side)` for each slot (§4). For a GT tile that is `BaseMetaTileEntity.canInsertItem` = the side's cover `letsItemsIn(slot)` and `CommonMetaTileEntity.canInsertItem` = `isValidSlot(slot)` and (slot empty or the same item) and the machine's `allowPutStack(slot, side, stack)` **[jar]** (`CommonMetaTileEntity` line 456–459). `isItemValidForSlot` is only `isValidSlot` (line 418), so the rules below hold only for inserters that use `canInsertItem`; all four of the planner's networks do.

## 0. Summary for the planner

| Topic | Rule | § |
|---|---|---|
| GT basic machine inputs | Items go only into the input slots, through any face but the front, and through the output side only with Input from Output Side allowed. With **Multi Stack Input Off** an item kind already in an input slot goes only into that slot, so each kind holds at most one slot (64). With it **On** a kind takes every free input slot. | §1.2–1.3 |
| Who sets Multi Stack Input | Every placement copies the placer's client preference (`singleBlockInitialAllowMultiStack`, default false = Off), so machines of one line differ by who placed them. A sneaking Soldering Iron click on the front switches it; the chat says "Multi Stack Input On / Off". The planner's steps never mention it today. | §1.4 |
| Input Filter | A recipe-map check, off by default. On a 2-slot machine it also wants a recipe that uses both stacks; on 3+ slots it is the map check alone (assemblers also take anything ore-dictionaried `circuit*`). It is no slot limit. | §1.2 |
| Auto Workbench (mode "Normal Crafting Table") | Slots 0–8 take **any** item from **any** face, 64 each, with no check against the grid: one ingredient can fill all nine. A craft needs ≥ 2,048 EU, slots 17 and 18 empty and every grid item in slots 0–17. When it cannot craft it pushes the slot-8 stack, strays and duplicate stacks out of its back. Results leave only through its back (one stack per update) or by extraction from any face. | §2 |
| Auto Workbench and the networks | Its ghost grid (slots 19–27) and preview (28) are real inventory slots: AE2's blocking mode counts them, so a blocking interface **never** pushes into a bench; EnderIO's Limited Item Filter counts one per grid cell. Its back must face the line's logistics block and must not carry the power cable (the back takes no EU). | §2.6–2.7 |
| Input buses | Limiting mode (a GUI toggle "Limit insertion", or a sneaking Screwdriver click) is off on a new bus; on, each item kind holds one slot. With Input Separation on (the EBF's default) every bus is checked alone with its own circuit, so all items of one recipe must be in one bus. | §3 |
| EnderIO filters | Basic (5), Advanced (10) and Big (24) Item Filters are whitelists only. This EnderIO has the **Limited Item Filter** (`EnderIO:itemLimitedItemFilter@0`, assembler: Advanced Item Filter + Comparator, 120 EU/t): on an Insert side it caps each listed item's count in the whole target inventory at the number set (10 slots, 1–64 each, summed per item). | §4.1 |
| AE2 | GTNH's interface pushes each pattern stack into whatever fits and keeps the rest in its send list (busy until it is sent); there is no all-or-nothing check. Blocking mode (free) checks a GT machine's input slots without programmed circuits, molds, shapes and lenses. A full-block interface pushes into every neighbour. A plain interface turns a pattern's fluid into a Fluid Packet *item* (stack 1) and pushes it into the machine. A Locking Card can hold the next push "Until crafting result is returned". | §4.2 |
| Project Red | An Item Responder Chip whitelists and answers with all the room the target's accepting slots have, without counting items on the way. The Item Stock Keeper Chip keeps a set amount (≤ 255 per slot, counting stored, en-route and promised items) but is filled only by Item Broadcaster or crafting chips. Extractor chips pull 64 items per 10 ticks and never route back to their own inventory. | §4.3 |
| Audit (main) | Routed and EnderIO: every singleblock that takes 2+ item kinds is safe with Multi Stack Input Off and deadlocks with it On, and the steps never say which. Routed also lays Extractor chips on input buses and leaves items bound for steps without units with nowhere to go. AE2: patterns list piped fluids (pushed as Fluid Packet items), fluid-only outputs and fractional chance outputs. The Bricked Blast Furnace's buses never empty (known). No mode lays a crafting step today. | §5 |
| Fix | Multi Stack Input Off on every singleblock fed 2+ kinds; Limiting mode on every input bus fed 2+ kinds; AE2 blocking mode on for GT machines (off where a held item is not on AE2's ignore list, e.g. a Packager schematic) and item-only, whole-number patterns; the Auto Workbench back-to-the-line with a per-ingredient cap: EnderIO Limited Item Filter, Project Red Stock Keeper, AE2 blocking off (Locking Card optional). | §6 |

## 1. GT basic singleblock machines (`MTEBasicMachine`)

### 1.1 Slots

- Inventory size is `5 + inputs + outputs + 1` (constructor: `iconst_5 + aInputSlotCount + aOutputSlotCount + iconst_1`) **[jar]**. Slot 3 is the special slot (`getSpecialSlotIndex`), slot 4 the programmed circuit (`getCircuitSlot`), slots `5 … 4 + n` the inputs (`getInputSlot` = 5), then the outputs (`getOutputSlot` = 5 + n); `isValidSlot` excludes slot 0, the tank's display slot (`MTEBasicTank.isValidSlot`), the circuit slot and the last slot (line 326–329), so automation never reaches the circuit **[jar]**.
- Held items (extruder shapes, molds, schematics, lenses) sit in an input slot and take it; a programmed circuit does not (it is the ghost slot 4).
- Input slot counts are set per machine in `LoaderMetaTileEntities` (`setSlotsCount(in, out)`) **[src]**, and some change with the tier. The export does not carry them (`Machine` has no slot count), so the planner cannot see them yet.

| Machine | LV | MV | HV | EV |
|---|---|---|---|---|
| Assembler | 6 | 9 | 9 | 9 |
| Circuit Assembler | 6 | 6 | 6 | 6 |
| Mixer | 6 | 6 | 6 | 9 |
| Forming Press | 2 | 2 | 4 | 4 |
| Laser Engraver | 2 | 2 | 2 | 4 |
| Alloy Smelter, Chemical Reactor, Arc Furnace, Extruder, Wiremill, Bending Machine, Cutting Machine, Canner, Centrifuge, Electrolyzer, Autoclave | 2 | 2 | 2 | 2 |
| Packager (`MTEBoxinator`, its own class: item + schematic) | 2 | 2 | 2 | 2 |
| Compressor, Extractor, Macerator, Lathe, Polarizer, Forge Hammer, Electric Furnace, Fluid Extractor, Fluid Solidifier, Chemical Bath, Electromagnetic Separator, Fluid Heater | 1 | 1 | 1 | 1 |

### 1.2 What may go in, and where **[jar]**

`MTEBasicMachine.allowPutStack` (line 996–1007):

```java
if (side == mMainFacing) return false;                                  // never through the front
if (aIndex < getInputSlot() || aIndex >= getInputSlot() + mInputSlotCount) return false;   // input slots only
if (!mAllowInputFromOutputSide && side == base.getFrontFacing()) return false;              // output side needs the setting
for (int i = getInputSlot(), j = i + mInputSlotCount; i < j; i++)
    if (GTUtility.areStacksEqual(GTOreDictUnificator.get(aStack), mInventory[i]) && mDisableMultiStack)
        return i == aIndex;                                             // Multi Stack Input Off: only the slot it is in
return mDisableFilter || allowPutStackValidated(base, aIndex, side, aStack);
```

- `MTEBasicMachine.allowPutStackValidated` (line 1017) is `!mDisableMultiStack || mInventory[aIndex] == null`.
- The Input Filter is `MTEBasicMachineWithRecipe.allowPutStackValidated` (line 321–378): no input slot: refuse. One slot: with an empty tank `RecipeMap.containsInput(stack)`, else a full recipe search with the stack, the selected circuit, the tank's fluid and the machine's voltage. Two slots: both full → yes (merging); both empty → `containsInput`; one full → `containsInput` and a recipe that uses this stack together with the other slot's stack (stack sizes not checked, so a recipe whose only item input is that item matches too). Three or more slots: `containsInput` alone, and the LV–IV Assemblers, every Circuit Assembler and the LuV–UMV Assembling Machines also take any item with an ore-dictionary name starting `circuit`.
- So the filter keeps out items no recipe of the map uses, but it does not stop one kind filling several slots of a 3+ slot machine.

### 1.3 How many stacks of one item

- **Multi Stack Input Off** (`mDisableMultiStack = true`): a kind not yet present may enter any empty input slot (subject to the filter); once it is in slot k, every further insertion of it is allowed only into slot k. Every network asks `canInsertItem` per slot inside one insertion call (§4), so a second slot is refused as soon as the first holds the kind. Result: at most one slot per kind, up to 64 (`getInventoryStackLimit`) or the item's own stack size. The comparison uses the ore-dictionary-unified stack, so two variants of one material (another mod's ingot) could still take two slots.
- **Multi Stack Input On**: the loop never returns early; with the filter off any empty input slot takes the kind, so one kind can fill every input slot (a 2-slot Alloy Smelter with two stacks of Redstone has no room for Copper). With the filter on, see §1.2.
- A machine with N input slots, h of them holding held items, fed k kinds, cannot crowd itself out with Multi Stack Off when k ≤ N − h. With k > N − h some kind has no slot whatever the setting.

### 1.4 Defaults and the controls

- The constructor sets `mDisableFilter = true` and `mDisableMultiStack = true` (Input Filter Off, Multi Stack Input Off) and `mAllowInputFromOutputSide = true` **[jar]**.
- `ItemMachines.placeBlockAt` calls `initDefaultModes` on every placement **[jar]**, and `MTEBasicMachine.initDefaultModes` (line 519–534) then sets `mDisableFilter = !pref.isSingleBlockInitialFilterEnabled()` and `mDisableMultiStack = !pref.isSingleBlockInitialMultiStackEnabled()` from the placing player's `GTClientPreference`, which comes from the client's GregTech `Client.cfg`: `singleBlockInitialFilter` and `singleBlockInitialAllowMultiStack`, both `@DefaultBoolean(false)` in `gregtech.common.config.Client$Preference` **[jar]**. So with default client settings a placed machine has Filter Off and Multi Stack Off, but a group member who enabled either gets machines with it on, and nothing in the world shows which. They are saved as NBT `mDisableFilter` and `mDisableMultiStack`.
- Controls **[jar]**: a sneaking Soldering Iron right-click whose wrench-grid side is the front (`onSolderingToolRightClick`, line 973–977) switches Multi Stack Input, chat `GT5U.hatch.disableMultiStack.*` = "Multi Stack Input On" / "Multi Stack Input Off". A Screwdriver right-click on the output side or the front (`onScrewdriverRightClick`, line 956–968) switches Input from Output Side; sneaking, it switches the Input Filter ("Input Filter On" / "Input Filter Off"). Every click switches, so a step must say which chat line to stop at.
- Outputs leave only from the output slots (`allowPullStack`: output slots, any face but the front). Item auto-output (`mItemTransfer`) is off on a new machine.

## 2. The GT++ Electric Auto Workbench (`MTEElectricAutoWorkbench`)

All of this section is **[jar]**, with the source **[src]** at `5.09.54.183` (its line numbers match the jar; the key branches were also checked in the bytecode). gt-mechanics §8 (on add-on 12's branch) has its ids, tiers, energy and container items; this section adds what automation can do to it.

### 2.1 Slots

- 30 slots (`getSizeInventory`): 0–8 input buffer, 9–17 output buffer, 18 the result, 19–27 the 3×3 ghost grid (`getSlotLimit` 1, `isItemValidForPhantomSlot`), 28 the result preview.
- `isValidSlot(i)` is `i < 19` (line 68): automation never touches the grid or the preview.

### 2.2 What it takes (mode 0, "Normal Crafting Table")

- `allowPutStack` is `mMode == 0 ? aIndex < 9 : aIndex < 18` (line 717): **any item, from any face** (no side test, no filter, no grid test), up to 64 per slot. `allowPullStack` is `mMode == 0 ? aIndex >= 9 : aIndex >= 18` (line 711): slots 9–18 from any face.
- So a network can put nine stacks of one ingredient (576 items) into it, and then no other ingredient fits.

### 2.3 Updates, crafting and the anti-clog moves (`onPostTick`)

- An update runs when the machine may work, has at least 2,048 EU stored (line 184) and either was just enabled or its countdown ran out; it sets the countdown to 32 ticks (line 186), or to 1 tick after a craft or an ejection. Below 2,048 EU nothing at all happens, not even the push.
- Everything below happens only while slot 18 is empty (line 196).
- **Stray**: when the cycled slot (`mCurrentSlot`, 0–17) is one of slots 0–7 and holds an item that is neither in the grid nor the empty container of a grid item, it moves to slot 18 (`isStrayBeingEjectedInModeZero`, line 613–614).
- **Craft**: the result of the grid; it runs only when slot 17 is empty (line 506) and slots 0–17 hold every grid item in the grid's count; it takes them from the highest slot first, puts container items into 9–17, the result into 18 and draws 2,048 EU.
- **Failed craft**: when the grid has a result but an ingredient is missing, the **slot-8 stack moves to slot 18** (line 557), whatever it is.
- **Duplicates**: when the grid has a result and slot 18 is still empty after the above, the later of two stacks of one item in slots 0–8 moves to slot 18, for items that stack above 8 (line 563–569).
- **Push**: at throughput settings 0 and 1 (`mThroughPut < 2`) every update ends with `GTItemTransfer.outOfMachine(this, back)` (line 584): gtnhlib's `ItemTransfer` defaults move **one stack of up to 64 items** from the pullable slots (9–18, in slot order) into the block behind it, through that block's own insertion rules (`ItemTransfer` constructor: `stacksToTransfer = 1`, `maxItemsPerTransfer = 64` **[jar]**). At settings 2 and 3 nothing is pushed. A new bench is at setting 0; the GUI's throughput button shows only an icon.

### 2.4 Faces, power and orientation

- Results leave through the **back** (`isOutputFacing` = back, line 93); the back face carries the pipe overlay texture (`getBack`). Energy enters every face but the back (`isInputFacing = !isOutputFacing`, line 88), at 1 A of V[tier]; at throughput settings 0 and 2 it also sends V[tier] EU/t out of the back (`maxEUOutput`, line 108).
- Covers fit every face but the front and the back (line 173), so the AE2 and direct modes' output conveyor cover cannot go on its back. A plain Wrench click sets the front to the wrench-grid side (`MetaTileEntity.onWrenchRightClick`), and any face may be the front (`isFacingValid` true).
- So the bench's back must face the block the results go into (the line's conduit, ME interface or pipe), and the power cable must reach any other face. Laid like a basic machine (front along the row, the side away from the line as its power port, the planner's singleblock rule in `arrange.ts`), a bench whose back points away from the line gets the cable on the one face that takes no EU and pushes its results into that cable: it never crafts.

### 2.5 Deadlocks

1. **Result cannot leave**: nothing behind the back takes slot 18 (no inventory there, a filter that refuses it, settings 2–3 with no extractor) → no update ever crafts again.
2. **Ingredient flood**: a push network fills the input buffer with the ingredients that arrive first; the missing one has no room. The bench then ejects slot 8 on every failed update and duplicate stacks when idle; the ejected stack goes out of its back, usually back into the same network, which can hand the same ingredient straight back. Whether the missing ingredient ever gets in depends on timing: a livelock that, with a fast supplier of one ingredient, never ends, and leaks ingredients into whatever else takes them (other benches, the output chest).
3. **Pushed items it cannot hand on**: an ejected ingredient that the block behind refuses stays in slot 18 → case 1.
4. With every ingredient capped at about one stack and only grid items delivered, none of this happens: no stray, no duplicate above a stack size of 8, and slot 8 stays empty while the grid has at most 8 distinct items (inserters fill the lowest empty slot first, §4).

### 2.6 What the networks see

- `IMetaTileEntity.isIOSlot` defaults to true and the bench does not override it (nor does `MTEBasicTank` or `MetaTileEntity`) **[jar]**, so `GTItemSink.getStoredItemsInSink` counts all 30 slots, ghost grid and preview included. AE2's blocking mode uses exactly that count for `gt.blockmachines` tiles (§4.2), so **an interface in blocking mode (or smart blocking) never pushes into a bench whose grid is set**: it starves.
- `getStackInSlot` returns the ghost items too (`CommonMetaTileEntity.getStackInSlot`: any index below the array length) **[src]**, and EnderIO's Limited Item Filter counts every slot of the target (§4.1), so each grid cell holding an ingredient counts as one of it.
- Project Red's inventory wrapper uses `getAccessibleSlotsFromSide` (slots 0–18), so a Stock Keeper sees only real stock.

### 2.7 Throughput

- In mode 0 a craft needs 2,048 EU: 64 ticks at LV (0.3125/s), 16 at MV (1.25/s), 4 at HV (5/s), 1 tick from EV (gt-mechanics §8). One result stack leaves per update.

## 3. Multiblock input buses and hatches

- **Input bus** (`MTEHatchInputBus`) **[jar]**: `(tier + 1)²` slots (`MTEHatch.getSlots`) plus a circuit slot that automation never reaches (`isValidSlot`, `allowPutStack`). Items go in only through its front. `allowPutStack` (line 255–257) = front, not the circuit slot, the Input Filter (`mRecipeMap.containsInput`, only while the multiblock has set the map and the filter is on) and, unless `disableLimited`, `limitedAllowPutStack` (line 261–263): an item already in a slot goes only into that slot, else only into an empty slot. A new bus has `disableFilter = true` and `disableLimited = true` (constructors), then the filter follows the placer's `inputBusInitialFilter` (default false).
- **Limiting mode**: the GUI toggle with the tooltip "Limit insertion / Up to 1 stack of each item can be inserted" (`addOneStackLimitButton`), or a sneaking Screwdriver click, which steps Sorting and Limiting: from a new bus (Sorting On, Limiting Off) one click gives "Sorting mode On   Limiting mode On", the next both Off, the next Sorting On and Limiting Off **[src]** (line 222–243). With it on, each kind holds one slot; with it off one kind can fill every slot.
- The input bus **lets items be pulled out of its front** (`allowPullStack`: front, any slot but the circuit) **[jar]**, so an extractor on its front takes the inputs back out.
- **Input Separation** **[jar]**: `inputSeparation` starts as `getDefaultInputSeparationMode()` = `supportsInputSeparation()`, which the EBF returns true. With it on, `doCheckRecipe` tries each input bus alone (its slots and its own circuit, plus the controller slot); with it off it merges every bus of one colour (`getStoredInputsForColor`). So with it on, all items of a recipe must reach the same bus. It is the controller GUI's Input Separation button.
- **Output bus**: no automated input (`allowPutStack` false), pushes into the block its front faces every 8 ticks; it can be locked to one item (`IItemLockable`, the filter slot in its window), and a multiblock fills locked buses first (add-on 15's research).
- **Input hatch** (`MTEHatchInput`): one fluid, `8000 × 2^tier` L (gt-mechanics §3.8); its filter (`isFluidInputAllowed`) is the map check, off by default (`inputHatchInitialFilter` false).

## 4. What each network does when it pushes

### 4.1 EnderIO 2.10.46 item conduits

- **Insertion** **[jar]**: `NetworkedInventory.insertItem` asks the face's Insert-side filter, then `EnderCore ItemUtil.doInsertItem`, which for an `ISidedInventory` walks `getAccessibleSlotsFromSide`, asks `canInsertItem` per slot, merges into existing stacks and puts the rest into the **first** empty slot that takes it (one empty slot per insertion). So the GT rules of §1 and §3 hold, and an item enters the lowest free input slot.
- **Extraction**: an Extract (or In / Out) side pulls 4 + 4 × speed upgrades items from one source slot at a time (round robin over the source's slots), offers them to the Insert sides of its colour in priority and distance order (or round robin) and moves only what they take (`insertIntoTargets`). There is no amount limit beyond what the target takes.
- **Filters** (`crazypants.enderio.conduit.item.filter`) **[jar]**: Basic (5), Advanced (10) and Big (24) Item Filters are whitelists or blacklists, matching meta and NBT by default; the Existing Item Filter passes only items the target already holds; the Mod and Power filters do not count. None of them limits an amount.
- **Limited Item Filter** **[src]** (jar classes `ItemLimitedItemFilter`, `ItemFilterLimited`; method calls checked in the jar): 10 ghost slots, each with a count of 1–64 set in its window (a stack held on the slot, then Shift-click or the wheel adjusts by 10). `getMaxCountThatCanPassFilter(item)` = the sum of the counts of the slots that match it (so one item may be given more than 64 with two slots). As an Insert-side filter, `insertItem` inserts at most `max − count`, where `count` is every matching item in **every slot of the target** (`getInsertLimit` walks `getSizeInventory()` with `getStackInSlot`), and nothing when that is ≤ 0; an item the filter does not list has a max of 0, so the filter is also a whitelist. As an Extract-side filter it extracts only what the source holds above the count (`getInsertLimitInv`). The pack has it: `EnderIO:itemLimitedItemFilter@0`, made in the assembler from an Advanced Item Filter and a Comparator at 120 EU/t, 300 ticks (export).
  - For a GT basic machine the count is its stock (input slots; the circuit slot holds only a programmed circuit). For an Auto Workbench it includes one per ghost-grid cell holding the item (§2.6), so the number to set is the stock wanted plus the cells.
- **Machines pushing into a conduit**: a conduit bundle is a cofh `IItemDuct`; `ItemConduit.insertItem(face, stack)` takes a pushed stack only through a face whose mode accepts input (Extract or In / Out, `ConnectionMode.acceptsInput`) and whose Extract-side filter passes it, and sends it on like an extraction **[jar]**. gtnhlib's `ItemUtil.getItemSink` wraps an `IItemDuct` (`ItemDuctSink`) **[jar]**, so the Auto Workbench's back push reaches the conduit. Self feed off keeps a face from inserting into its own inventory (`updateInsertOrder`: `other != this`).

### 4.2 AE2 rv3-beta-1073-GTNH interfaces

- **How a GT tile is reached** **[src, jar]**: `InventoryAdaptor.getAdaptor` asks the tile's `InventoryAdaptor` capability (GT has none), then `ItemUtil.getItemIO`, which for a GT tile builds gtnhlib's `WrappedItemIO(InventoryItemSource, GTItemSink)` (`CommonMetaTileEntity.getItemSink`) **[jar]**. `InventoryItemSink.store` fills matching stacks first, then empty slots, asking `canInsertItem` per slot **[jar]**, so §1 and §3 hold.
- **`pushPattern`** (`DualityInterface` line 1216–1351) **[src, jar]**: refuses while the interface still has items to send or a crafting lock is on. For every target side: an `ICraftingMachine` that `acceptsPlans()` (a Molecular Assembler) gets the whole pattern; any other inventory first passes the blocking test (below), then gets each stack with `addStack`, leftovers moving on to the next side; whatever no side took goes to the interface's **send list** (`addToSendList`) and the push still counts as done. While the send list holds anything the interface is busy (`isBusy`, `hasItemsToSend`) and pushes nothing new. There is no "only if all of it fits" test, so a pattern can arrive in parts.
- **Targets**: a full-block ME Interface pushes into every neighbour (`TileInterface.getTargets`: all six sides unless rotated to point at one with a wrench, `setSide`) **[src]**; one pattern's stacks can spread over several machines. The probe found no interface of main's layouts touching a second inventory.
- **Blocking mode** (interface GUI "Blocking Mode", tooltip "Do not push crafting items if inventory contains items") **[src, jar]**: a side is skipped when `ad.containsItems()` and not `inventoryCountsAsEmpty`. For any `gt.blockmachines` tile `inventoryCountsAsEmpty` (line 1031–1050) asks `GTItemSink.getStoredItemsInSink` with a predicate that ignores the blocking-ignore registry, which GT fills with the programmed circuit, every mold and extruder shape and the lenses (`AE2Compat.registerBlockingModeIgnoreItems`) **[src]**; `GTItemSink` counts the slots `isIOSlot` names: a basic machine's input slots (`MTEBasicMachine.isIOSlot`, the only override in `$GT` **[jar]**), every slot of anything else (input buses, the Auto Workbench). So for a GT basic machine blocking means "push only when its inputs hold nothing but a circuit, mold, shape or lens": one set at a time; GT takes a run's inputs when the run starts, so the next set goes in while the run works and nothing idles. A held item that is not on the list keeps the machine from ever counting as empty: the Packager's schematic (`MTEBoxinator` holds it in its second input slot) is not registered, so a blocking interface never pushes into a Packager. For the Auto Workbench it is never empty either (§2.6). Smart blocking (tooltip "Allows inserting the same recipe") lets the same pattern be pushed again and blocks only a different one; its first push still needs an empty target.
- **Locking Card** (`appliedenergistics2:item.ItemMultiMaterial@65`, upgrade `LOCK_CRAFTING`): the interface's "Lock Crafting" setting gains "Until crafting result is returned" (`LOCK_UNTIL_RESULT`): after a push it intercepts the network's storage and pushes nothing more until the pattern's outputs have come back (`onPushPatternSuccess`, `injectItems`) **[src]**. That keeps one craft in flight.
- **Molecular Assembler** (`TileMolecularAssembler`) **[src]**: takes a crafting pattern only while its nine slots are empty (`pushPattern`), crafts in 100 progress points at 10–50 a tick (10 to 2 ticks with Acceleration Cards), pushes the result back toward the interface. It cannot be overfilled. Its recipe needs an Advanced Assembling Machine III and titanium plates (export), far above MV.
- **Fluids in a plain interface's pattern** **[src, jar]**: `pushPattern` turns a fluid stack into `Platform.stackConvertPacket` = an ae2fc `ItemFluidPacket` item (`setMaxStackSize(1)` **[jar]**) unless the interface is a Dual Interface. A GT machine with the Input Filter off takes the packet into a free input slot, where no recipe uses it; with the filter on, or no free slot, it waits in the send list and the interface is stuck.
- **Jobs**: a crafting CPU completes when the requested output arrives (`CraftingCPUCluster.completeJob`); a pattern whose output a later pattern needs must deliver that output into ME storage, or the job waits for ever. Fluids piped from machine to machine, and chanced outputs that come back short, never arrive.

### 4.3 Project Red 4.12.44-GTNH routed pipes

All **[src]** in Scala, with the chip classes' calls and constants checked in the jar.

- **Item Responder Chip** (`ChipItemResponder.getSyncResponse`): if its filter (9 slots) allows the item, answers with `room = InvWrapper.getSpaceForItem(item)` over the slots `getAccessibleSlotsFromSide` gives; `TDefWrapHandler.getSpaceForItem` (MrTJPCore) adds a full stack for every empty slot that passes `canInsertItem` and the rest of every matching stack. Items already on their way are not subtracted. The Dynamic Item Responder accepts only items the target already holds, the Overflow Responder is the low-priority catch-all, the Terminator a sink; none limits amounts.
- **Item Extractor Chip** (`ChipExtractor`): every 10 ticks, for each item the inventory offers through its side (a GT machine: its output slots; an input bus: every slot but the circuit), up to 64 items to responders found by `getLogisticPath(item, exclusions, true)`: the `true` excludes its own router, so it never routes back to its own machine.
- **Arrival** (`PayloadPipePart.passToInventory`): `injectItem` merges, then fills empty slots (each asking `canInsertItem`); what does not fit bounces back into the pipe and is routed again (`resolveDestination`), or wanders through the routed pipes until something has room. The pack's `ProjectRed.cfg` sets "Routed Pipes: Max Wander Distance" to 0 **[cfg]**, which `Configurator.maxPipesWandered` documents as "0 for unlimited" **[src]**, so wandering items are never erased.
- **Item Stock Keeper Chip** (`ChipStockKeeper`): every 100 ticks (up to 60 s slower while it requests nothing; a neighbour change resets it), for each of its 9 stock slots (counts up to 255) requests `min(stock − (stored + en route + promised), free space, 128)`; modes "when missing" (fill to the count), "when empty", "infinite". Only broadcasters and crafting chips fill requests.
- **Item Broadcaster Chip** (`ChipBroadcaster`): offers what its inventory holds through its side to requests and extracts on demand (≤ 64 per operation, never more than the requester has room for, `getActiveFreeSpace`).
- **Crafting Chip** (`ChipCrafting`): promises its recipe's result and requests exactly the ingredients for each order (UNVERIFIED in game for GT machines).
- **Pipes take no pushes**: no routed pipe part implements `IInventory` or `ISidedInventory` **[jar]**, so a machine's own push (GT auto-output, the Auto Workbench's back push) into a routed pipe moves nothing; only chips move items.

### 4.4 GT pipes and covers (machine to machine)

- A GT item pipe hands a stack to any block that takes it through its neighbour's own rules; the Filtered Conveyor Cover never stops a pipe (`letsItemsIn` true for every item); the Shutter Module Cover on "Only Input allowed" does; conveyor covers below mode 6 let items only out (export) or only in (import) (`CoverConveyor.letsItemsIn/Out`) **[src]** (add-on 15's research has the rest).
- None of them limits an amount. The Robot Arm cover (`CoverArm`) can import into one chosen slot of its host (`setSinkSlots(internalSlotId − 1)`, one stack per operation) **[src]**, which is the only GT part that can give an Auto Workbench ingredient a slot of its own (UNVERIFIED in game).

## 5. Audit of main's layouts [probe]

Method: a scratch worktree of main (`7c14d4f`), the active export, no world (`no-world` layouts), five lines in routed, AE2 and EnderIO: an Electronic Circuit line at MV (1/min, 12 MV machines and 4 crafting-table steps, also once with crafting automated), Red Alloy Ingot (60/min), the LV Electric Motor (6/min) and Vacuum Tube (30/min), MV. For every machine input the probe listed the machine's input slots (§1.1), its held items, and what the mode's part there lets in (chip whitelist, pattern, conduit insert filter). On main a crafting-table step is a pseudo machine (mteId −1 or −3) and is never laid out, so no Auto Workbench appears; §5.4 says what today's parts would do to one.

### 5.1 Every input that can overfill or deadlock

| Line | Machine (slots, held) | Fed kinds | Routed | AE2 | EnderIO |
|---|---|---|---|---|---|
| Electronic Circuit | Alloy Smelter (2, 0) | Copper Ingot, Redstone | F1 | F1*, — | F1 |
| Electronic Circuit | Circuit Assembler (6, 0) | Red Alloy Wire, Vacuum Tube, Resistor, Circuit Board (+ Molten Tin piped) | F1 | F1*, F4 | F1 |
| Electronic Circuit | Fluid Solidifier (1, mold) | (Molten Glass piped) | F3 (Glass Tube) | F4: the pattern's only input is a fluid | — |
| Electronic Circuit | Fluid Extractor ×2 (1, 0) | Tin Dust; Sand | — | F5 (Molten Tin, Molten Glass out) | — |
| Electronic Circuit | Centrifuge ×3 (2, 0) | Rubber Wood | — | F5 (Methane out), F6 | — |
| Electronic Circuit | Wiremill ×3, Extruder, Lathe, Compressor | one kind each | F3: Copper Wire, Fine Copper Wire, Red Alloy Bolt, Steel Rod and Wood Plank go only to hand-crafted steps | — | — |
| Red Alloy | Alloy Smelter ×2 (2, 0) | Copper Dust, Redstone | F1 | F1* | F1 |
| Electric Motor | Chemical Reactor (2, 0) | Raw Rubber Dust, Sulfur Dust | F1 | F1*, F5 (output 1,296 L Molten Rubber) | F1 |
| Electric Motor | Assembler (9, 0) | Magnetic Iron Rod, Iron Rod, Copper Wire, Tin Cable | F1 | F1* | F1 |
| Electric Motor | Assembler (9, 0), tin cable | Tin Wire (+ Molten Rubber piped) | — | F4 | — |
| Vacuum Tube | Mixer (6, 0) | Redstone, Raw Silicon Dust, Coal Dust | F1 | F1* | F1 |
| Vacuum Tube | Arc Furnace (2, 0) | Iron Dust, Charcoal Dust | F1 | F1* | F1 |
| Vacuum Tube | Arc Furnace (2, 0), annealing | Copper Ingot (+ Oxygen piped) | — | F4 | — |
| Vacuum Tube | Assembler (9, 0) | Glass Tube, Annealed Copper Wire, Steel Rod (+ Molten Redstone Alloy piped) | F1 | F1*, F4 | F1 |
| Vacuum Tube | EBF ×2 (Input Bus ULV, 1) | Redstone Alloy Dust | F2 | — | — |
| Vacuum Tube | EBF (Input Bus ULV, 1) | Cast Iron Dust (+ Oxygen piped) | F2 | F4, F6 (0.11× Ashes) | — |
| Vacuum Tube | Bricked Blast Furnace ×2 (Input Bus LV) | Chalcopyrite, Glass, Charcoal Dust | F7 | F7 | F7 |
| Vacuum Tube | Electrolyzer, Pyrolyse Oven | one kind each | — | F5 (Oxygen, Water out) | — |

Every other input of these layouts takes one kind into a machine with room for it and cannot overfill a second slot.

### 5.2 The findings

- **F1 — Multi Stack Input is left to chance (routed, EnderIO; AE2 only buffers).** No step mentions it; a machine has whatever its placer's client preference gave it (§1.4). With it Off every row above is safe: each kind holds one slot and the kinds fit. With it On, routed and EnderIO deadlock: the first kind to arrive takes every free input slot (Project Red's responder answers with the room of every empty slot; EnderIO merges, then fills the next empty slot), e.g. two stacks of Redstone in the Alloy Smelter and Copper never gets in. *AE2 pushes whole sets, every kind in each push, so its machines keep every kind present and do not deadlock; they only fill every free slot.
- **F2 — Routed lays an Item Extractor Chip on input-bus ports.** `routed.ts` gives every port of a unit that makes items `responder(inputs) + extractor`, buses included. The extractor pulls the inputs back out of the bus's front (§3) and sends them to any other responder that takes them: the two Redstone Alloy EBFs pass their dust back and forth every 10 ticks. Output-bus ports get a responder for the step's inputs that never answers (the bus takes nothing). Not a hard deadlock, but churn and starvation, and wasted chips.
- **F3 — Routed has no place for items that leave the line to a step without units.** Its output chest's responder whitelists only flows to out or sink (`finalItemOutputs`); EnderIO sends every flow that leaves the placed steps, and every stray, to an output chest (`edgeFlows`, `crossing`). In the Electronic Circuit line six items made by machines (Copper Wire, Fine Copper Wire, Glass Tube, Red Alloy Bolt, Steel Rod, Wood Plank) are taken only by hand-crafted steps, so no responder takes them: each maker stops when its output slot is full and must be emptied by hand.
- **F4 — AE2 patterns list fluids the line pipes.** The configure step's pattern reads, e.g., "1× Circuit Board + 2× Resistor + 2× 1x Red Alloy Wire + 2× Vacuum Tube + 144× Molten Tin → 1× Electronic Circuit" and "144× Molten Glass → 1× Glass Tube", but AE2 mode pipes fluids from machine to machine (GT fluid pipes and pump covers), so ME storage never holds them: the CPU cannot plan the job, and a pattern encoded as written makes the plain ME Interface push a Fluid Packet item into the machine (§4.2), which takes a free input slot for good (Input Filter off) or sticks in the interface (filter on, or a full machine such as the Fluid Solidifier, whose one slot holds the mold).
- **F5 — AE2 patterns with fluid-only or piped fluid outputs.** "1× Tin Dust → 144× Molten Tin" (Fluid Extractor), "9× Raw Rubber Dust + 1× Sulfur Dust → 1,296× Molten Rubber" (Chemical Reactor), and the Oxygen, Water and Methane outputs: the fluid goes into a pipe and never returns to ME (a plain interface takes no fluid), so a job that needs it waits for ever, and a step whose only output is a piped fluid cannot be a processing pattern at all.
- **F6 — AE2 patterns with chance outputs as fractions.** "1× Rubber Wood → 0.50× Sticky Resin + 0.38× Plantball + 0.25× Carbon Dust + 0.25× Wood Pulp + 60× Methane", "… + 0.11× Ashes": a pattern holds whole numbers, and a job that counts on a chanced output it pushed for gets fewer and stalls.
- **F7 — The Bricked Blast Furnace gets an input bus and an output bus with chips, a pattern or conduit faces.** It takes no hatches (add-on 15's research), so the bus fills and nothing runs. Known; the steam and primitive fix lane takes these machines out of the modes.
- **F8 — Blocking mode off.** Every AE2 configure step says "blocking mode off". For one recipe per machine with whole sets this is not a deadlock (F1*), but it lets the interface fill every free slot, and it mixes recipes in a shared machine (add-on 12's sharing pools).
- **F9 — Input slots are not known.** Add-on 12's routed split bounds a pool's distinct inputs with `itemSlots`, the most item inputs any recipe of the map takes; the machine's own slots can be fewer (LV Assembler 6 against the map's 9; LV and MV Mixer 6; LV and MV Forming Press 2) and held items take slots. The export carries no input slot count.
- EnderIO's whitelists keep every other item out, its priorities fill machines before chests, and every bus it feeds takes one kind (or is the Bricked Blast Furnace's).

### 5.3 The Electronic Circuit line in EnderIO mode

It is safe today exactly as long as the Alloy Smelter and the Circuit Assembler have Multi Stack Input Off, which is the client default but never stated or checked (F1). Its four crafting-table steps are hand-crafted on main; with add-on 12 they become four Auto Workbenches (Resistor: four kinds; Circuit Board: two; Vacuum Tube: five; Coated Circuit Board: two), all fed from the same Red channel, which is where §5.4's EnderIO flood would start.

### 5.4 Auto Workbenches with today's parts

When add-on 12 Task 6 lays the crafting steps on Auto Workbenches and each mode keeps today's part for a machine input:

- **Routed** (Item Responder Chip, whitelist = the grid): the responder answers with the room of all nine slots (§2.2), the extractor sends whatever ingredient comes first, it floods the bench, the bench ejects slot 8 into slot 18, its back push into the routed pipe moves nothing (§4.3), the Item Extractor Chip takes slot 18 only if another responder wants that ingredient, otherwise slot 18 stays full and the bench never crafts again (§2.5 cases 2 and 3). The Resistor bench (Sticky Resin, Fine Copper Wire, Copper Wire, Carbon Dust) and the Vacuum Tube bench (five kinds) fill with whichever wire arrives first.
- **AE2** (one processing pattern, blocking off as today): whole sets arrive and the bench crafts; its back must face the interface, which takes the results. With blocking on it would never push (§2.6). A pattern item that differs from the grid's (NBT, another ore-dictionary variant) is a stray: the bench pushes it back into storage and the job waits for a result that never comes.
- **EnderIO** (Basic Item Filter, whitelist = the grid): the first ingredient floods the bench; slot-8 and duplicate ejections go out through the In / Out face to the other benches and the output chest that take that ingredient: livelock and leaks (§2.5 case 2).
- **Machine to machine** (GT pipe, add-on 15 lanes): each lane pushes its ingredient until all nine slots hold it.
- **All modes**: laid like a basic machine (§2.4) it gets no power and pushes into its cable.

## 6. The configuration that cannot overfill or deadlock

Costs: a Soldering Iron or Screwdriver click and AE2 blocking mode are free; an EnderIO Limited Item Filter is an Advanced Item Filter and a Comparator (MV assembler) instead of a Basic Item Filter; an Item Stock Keeper or Item Broadcaster Chip is a circuit-assembler chip like the Responder; a Locking Card is one AE2 card.

| Machine kind | Every mode | Machine to machine | Routed | AE2 | EnderIO |
|---|---|---|---|---|---|
| GT singleblock fed 1 kind | nothing new | add-on 15 as planned | as today: Item Responder Chip, whitelist | blocking mode on (off if it holds an unlisted item, e.g. the Packager's schematic); item-only pattern (below) | as today: Basic Item Filter, whitelist |
| GT singleblock fed 2+ kinds | **Multi Stack Input Off**; kinds ≤ input slots − held items | add-on 15 (it already sets Multi Stack Input Off) | as today + Multi Stack Input Off | blocking mode on (same exception) + Multi Stack Input Off | as today + Multi Stack Input Off |
| Input bus fed 1 kind | nothing new | add-on 15 | responder only, **no Extractor Chip on an input bus**; extractor only on output buses | blocking mode on | as today |
| Input bus fed 2+ kinds | **Limiting mode on**; every item of a recipe into **one** bus, or Input Separation off | add-on 15 + one bus per step, or Input Separation off | as above + Limiting mode on | as above + Limiting mode on | as today + Limiting mode on |
| GT++ Auto Workbench | mode "Normal Crafting Table", the grid exactly the plan's recipe, **back on the line's logistics block**, front away from it, power to the front (never the back), throughput on its first (new) state | Robot Arm covers importing each ingredient into its own slot (≤ 4 kinds: the four coverable faces), else by hand (UNVERIFIED) | **Item Stock Keeper Chip** ("when missing", each ingredient's count = 2 crafts) + Item Extractor Chip; Item Broadcaster Chips on the input chest and on every machine that makes a bench ingredient; the output chest's responder never takes a bench ingredient (a GT consumer's responder may: it fills its one slot and leaves the rest for the broadcaster) | interface on its back, **blocking mode off**; a processing pattern of exactly the grid's items → the result (+ container returns); Locking Card on "Until crafting result is returned" to keep one craft in flight | In / Out face on its back: Insert side a **Limited Item Filter**, each ingredient at 2 crafts' worth **plus its grid cells** (e.g. 2 + 1 cell → 3 for an item used once; at most the item's stack size); Extract side a Basic Item Filter with the result and any container returns |
| AE2 Molecular Assembler | — | — | — | interface with the crafting pattern touching only the assembler | — |
| Machine shared by 2+ steps (add-on 12 pools) | kinds of all its steps ≤ input slots − held items at its tier | never pools | as above, Multi Stack Input Off | blocking mode on (one recipe's set at a time; smart blocking lets the same recipe repeat) | never pools |
| Steam and primitive machines | by hand (the steam and primitive fix) | | | | |

Line-wide rules:

- **Routed**: the output chest's responder whitelists every item that leaves the placed steps (to out, sink or a step without units) and every stray a placed machine makes, as EnderIO's `edgeFlows` and `crossing` do; an input-bus port gets no Extractor Chip and an output-bus port no Responder Chip.
- **AE2**: a pattern holds one run's **item** inputs (no programmed circuit, no held item, no fluid the line pipes) and only the **whole-number, guaranteed item** outputs (chanced byproducts left out: they still return to storage). A step whose outputs are only fluids or only chanced items is no pattern step: an ME Export Bus on the machine's spine face, filtered to its item inputs, keeps it fed (with Multi Stack Input Off it stops at one stack a kind). Each interface touches only its own machine (true today).
- **EnderIO**: nothing beyond the table.
- **Why two crafts' worth for the bench**: the cap must stay at one stack so the bench never holds a duplicate (§2.3), and above one craft so it does not wait for each delivery. EnderIO's insert side moves at most the cap at a time and refills as soon as a craft takes some; at MV (1.25 crafts/s) two crafts keep it busy as long as the makers keep up (UNVERIFIED in game).
- **Why the bench needs no Multi Stack setting**: it has none; the cap is the only limit, and only a network part can set it.

## 7. What the layout and the build steps must say

### 7.1 Layout data (planner)

- `BlockConfig` gains `multiStack: false` on every singleblock whose step takes 2+ item kinds (all modes; add-on 15 already plans the key) and `limited: true` on every input bus fed 2+ kinds (add-on 15's key, now in routed, AE2 and EnderIO too).
- The Auto Workbench unit (pack kind `other`, class `MTEElectricAutoWorkbench`): its facing is its **front, away from the spine**, so its back is the spine cell; no `mainFacing`, no Input from Output Side, no output cover (covers do not fit its back); its power port any face but the back.
- Routed (`routed.ts`): chips per port by bus kind (responder on singleblocks and input buses, extractor on singleblocks and output buses); for a bench: Item Stock Keeper Chip `stock: <item> ×n, …; mode when missing` + Item Extractor Chip, and an Item Broadcaster Chip on the input chest and on each maker of a bench ingredient; the output chest whitelists every leaving item and stray.
- AE2 (`ae2.ts`): `blockingMode: true` on GT machines and buses whose held items are all programmed circuits, molds, extruder or slicer shapes or lenses (AE2's ignore list, §4.2), `false` on benches and on machines holding anything else (the Packager's schematic); pattern text from item inputs and whole guaranteed item outputs only; an optional `lock: 'until result'` on a bench's interface; an export-bus feed for fluid-only or chance-only steps.
- EnderIO (`enderio.ts`, `conduits.ts`): a `limited` filter kind (`ConduitFilter.counts`, 10 slots) on a bench's Insert side; the bench's face In / Out on its back.
- Export: machine input slot counts per mteId (`mInputSlotCount`, or `setSlotsCount` read from the class) so the slot rule (kinds ≤ slots − held) and add-on 12's routed split use the machine's own slots.

### 7.2 Build-step wording

- Singleblock fed 2+ kinds: "Multi Stack Input Off: sneak-right-click its front with a Soldering Iron (where a neighbour covers the front, click the edge of the wrench grid toward it); stop when the chat says "Multi Stack Input Off" (each click switches it; a machine you placed with default client settings already has it off)."
- Input bus fed 2+ kinds: "Limiting mode on: in the bus window switch on "Limit insertion", or sneak-right-click the bus with a Screwdriver until the chat says "Limiting mode On"."
- Multiblock with 2+ input buses for one recipe: "Input Separation off (the controller window's button)", or lay one bus.
- Auto Workbench place step: "Place the Auto Workbench with its back (the face with the pipe opening) against the <conduit / ME interface / routed pipe>: with a Wrench, right-click the face away from the line to make that the front. Keep the power cable off its back."
- Auto Workbench configure step: "Set the mode to "Normal Crafting Table" and the grid to <recipe>; leave the top-left button on its first state."
- EnderIO bench face: "In / Out; insert on <colour> with a Limited Item Filter: <item> 3, <item> 6, …; extract on <colour> with a Basic Item Filter: <result>."
- Routed bench pipe: "Item Stock Keeper Chip (when missing): <item> 2, <item> 4, … + Item Extractor Chip", and on each supplier "+ Item Broadcaster Chip".
- AE2 bench interface: "1 processing pattern <grid items> → <result>; blocking mode off; (Locking Card: Lock Crafting "Until crafting result is returned")". AE2 machine interface: "blocking mode on" (but "blocking mode off" for a Packager or any machine holding an item that is no circuit, mold, shape or lens).

## 8. Open questions (UNVERIFIED)

- Game tests: a Limited Item Filter on an In / Out face toward a bench holding the planned counts; a Stock Keeper fed by broadcasters keeping a bench at its counts; a Locking Card's throughput on an HV bench; a Robot Arm cover importing into one bench slot.
- The Project Red Crafting Chip as a pull-based alternative for whole routed lines.
- Whether GTNH's Advanced Blocking Card ("Loose Mode") changes the bench case; this page did not trace where `ADVANCED_BLOCKING_MODE` is read.
- ae2fc Dual Interfaces (fluids into a machine's tank from a pattern) as an AE2 alternative to piping.
