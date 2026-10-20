# Add-on 21: Feeding Checker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A pure checker, `checkFeeding({ pack, plan, layout, options }) → FeedingReport`, that reads a laid-out line in any logistics mode, runs cheap static rules and then a deterministic tick simulation of its machines and logistics as GT 5.09.54.183, EnderIO 2.10.46, Project Red 4.12.44-GTNH and AE2 rv3-beta-1073-GTNH behave, and reports for every machine input each overfill, deadlock, livelock, starvation and deletion it finds, with the item and the cause in plain words, so fix/feeding, add-on 12 Task 8 and add-on 15 Task 8 can gate a layout on it.

**Architecture:** New module `src/server/layout/feeding/`. `contract.ts` defines the structured layout config the checker reads (which fix/feeding and add-on 12 Task 6 will write) and the report; `facts.ts` holds the game constants with their evidence; `read.ts` turns a `Layout` + `Plan` + `Pack` into a `FeedModel` (machines, buses, benches, chests and one network model per logistics mode), reading today's layouts where the structured config is missing and listing what it could not know; `precheck.ts` runs the static rules; `sim/` is a tick engine (fixed one-tick step, fixed order, entities sleep until they are due) with one model per machine kind and per network kind; `check.ts` runs the static rules and five scenarios (steady, one supplier ten times faster, one input late, a server restart, Multi Stack Input On where the layout leaves it unset) and assembles the report.

**Tech Stack:** Node 24 (type stripping) · TypeScript 6.0.3 · vitest 5.0.3 — no new dependency.

**Spec:** `docs/research/machine-feeding.md` revision 2 (branch `research/feeding`, commit `2d6b5cf`; read it with `git show research/feeding:docs/research/machine-feeding.md` until it is on main): §7 is the design this plan implements, §1–§2 the behaviour every model follows, §3.6 the bench stock rule, §4 the audit Task 12 reproduces, §5 the counterexamples the tests use. The Evidence section below adds what the simulation needs beyond the research, from the same jars. Contracts: architecture `docs/superpowers/plans/2026-10-17-00-architecture.md` §6.2, §6.3, §6.7, §10 and §11 (this plan's entry is **50**).

**Runs beside every lane.** This plan adds new files only, so it merges into main in any order. Its users: fix/feeding (after merge train 1) writes the contract's structured config into main's routed and AE2 layouts and raises the static rules as layout warnings by calling `precheckFeeding` (research §6.4 items 1–4); add-on 12 Task 6 lays Auto Workbenches with the contract's bench config, chips, Limited Item Filter counts and patterns (research §6.1 items 1, 6); add-on 12 Task 8 and add-on 15 Task 8 gate on `checkFeeding` (research §6.1 item 10, §6.2 item 4). Until those lanes land, the checker reads today's layouts through its adapters and says what they leave unknown.

---

## Evidence this plan adds (read 2026-10-20, from the server's jars copied to a scratch folder, and the research's source extracts at the jars' tags)

Tags as in the research: **[jar]** bytecode, **[src]** source at the jar's tag. Line numbers are the source's.

- **E1 [jar, src] A GT basic machine's tick** (`MTEBasicMachine.onPostTick` 596–720; the jar's bytecode holds the same tests, with constants `600L` and `300`). A run counts one tick per tick; on its last tick each recipe output i goes into the output slots trying slot i, i + 1, … (mod the output slot count) with `addStackToSlot` (an empty slot, or the same item where the whole amount fits), and the machine looks for its next recipe in that same tick. An idle machine looks for a recipe only when its inventory changed since its last tick (`hasInventoryBeenModified`: any insert or extract by another block sets it, and it is cleared at the end of the machine's own tick), when its own timer is a multiple of 600, or when work was just enabled. That timer is the tile's `mTickTimer`, the number of updates since its chunk loaded, not world time: `BaseMetaTileEntity.updateEntity` increments it before it calls `onPostTick(this, mTickTimer)` [jar], so the `aTick` a tile sees is its age + 1 and starts again at every chunk load. `checkRecipe` (1096–1156) takes the cached last recipe first (`cachedRecipe(mLastRecipe)`), and when that recipe's outputs do not fit (`canOutput`, 774–785: output slot i against recipe output i at its full amount, chance ignored; a slot holding another item, or without room for the whole amount, blocks) it returns without trying another recipe; inputs are taken when a run starts. Item auto-output (`mItemTransfer`) is off on a new machine; when on, it pushes through gtnhlib's `ItemTransfer` with `dropItems` set, so with no inventory at its output side it drops the items into the world (E10).
- **E2 [src] Basic machine defaults and the slot test** (`MTEBasicMachine` 131–135, 994–1018; `MTEBasicMachineWithRecipe.allowPutStackValidated` 319–380): `mDisableFilter = true` (Input Filter Off), `mDisableMultiStack = true` (Multi Stack Input Off), `mAllowInputFromOutputSide = true`, `mItemTransfer = false`; `initDefaultModes` copies the placer's client preferences (research §1.1.4). With the Input Filter Off, `allowPutStack` returns before `allowPutStackValidated`, so a slot then takes an item when `canInsertItem`'s empty-or-same-item test (research §0) and the Multi Stack loop allow it. With it On: one input slot — the map must contain the item; two — both full, or both empty and the map contains it, or one full and a recipe of the map uses both stacks; three or more — the map contains it, or (assemblers and circuit assemblers) it has an ore name starting `circuit`.
- **E3 [src, jar] Input buses, controllers, output buses** (`MTEHatchInputBus` 65–67, 160–176, 253–264; `MTEMultiBlockBase.runMachine` 809–870, `shouldCheckRecipeThisTick` 755–787, `checkProcessing` 1195–1250; `MTEHatchOutputBus.onPostTick` 246–268). A new input bus has sorting on (`disableSort = false`: each change compacts its stacks into its first slots) and Limiting off; its Input Filter is off in the constructor, but `initDefaultModes` sets it from the placer's client preference (`disableFilter = !isInputBusInitialFilterEnabled()` [jar]), so a bus the layout leaves unset may have it either way. On a change a bus notifies its controller. An idle controller checks for a recipe only when pushed (a bus or hatch changed, an output bus drained; `doPeriodicChecks` is false) and again right after a run ends. Input Separation on: each input bus is checked alone; off: all buses together; either way a bus's items are listed from its last slot down (`for i = size − 1 … 0` in `doCheckRecipe` and `getStoredInputsForColor` [jar]), so a recipe takes its inputs from the highest slots first. An output bus pushes every stack out of its front by the neighbour's rules when its own timer is a multiple of 8 (`(aTick & 7) == 0`, `aTick` as in E1, not world time), skipping a stack the neighbour refuses (E4), and a drained output bus pushes a recipe check. A bus locked to an item (`lockedItem`, add-on 15's `lock`) stores only that item (`storePartial` returns false for any other [jar]), and a multiblock fills its buses in `OutputBusType` order (`ItemEjectionHelper` [jar]: Void, then the types filtered to the item, then the unfiltered ones), so an output goes into the buses locked to it first and into an unlocked bus only what they have no room for.
- **E4 [src, jar] Auto Workbench details** (`MTEElectricAutoWorkbench` 38–39, 98–118, 180–590). `mTicksUntilNextUpdate = 20`, `mCurrentSlot = 0`, `mLastCraftSuccessful = false` on a new bench and none of them is saved, so a restart resets them; `maxEUStore = max(2048, V[t] × t × V[t])` (LV 2,048, MV 32,768), `maxEUInput = V[t]`. The duplicates loop (565–573) runs only when the grid has a result and slot 18 is still empty; a stray ejection leaves that update's grid empty, so no craft, failed craft or duplicate move follows it; with an empty bench (`benchContent` empty) the craft test is skipped and `mLastCraftSuccessful` keeps its value. The push (`GTItemTransfer.outOfMachine` toward its back) is gtnhlib's `ItemTransfer.transfer()` with `stacksToTransfer = 1` and `maxItemsPerTransfer = 64` [jar]: it walks the source slots, extracts from one, gives back what the sink rejects, and goes on to the next slot when nothing moved, so it pushes the first stack the sink takes any of and skips the slots whose stack it refuses. Every GT transfer works this way, each with its own stack count: conveyor covers, the Item Filter cover, output buses, auto-output and GT pipes.
- **E5 [src, jar] EnderIO item conduit faces** (`NetworkedInventory` 104–520; `ItemConduit.getTickTimePerItem` 450–453; `ItemConduitNetwork.MAX_SLOT_CHECK_PER_TICK = 64` and `doNetworkTick` [jar]; EnderCore `RoundRobinIterator` [jar]). Each face ticks once per network tick, in the network's face order. It extracts only while its `tickDeficit` ≤ 0; after each tick `tickDeficit` is decremented, and below −1 it becomes 20, so a face that found nothing on two ticks running sleeps 20 ticks. A move of n items sets `tickDeficit = Math.round((float) n × (10f / maxExtracted))` in Java float arithmetic (`itemExtracted`: `i2f`, `fmul`, `Math.round(F)`; `getTickTimePerItem` = `10f / max` [jar]), `maxExtracted = 4 + 4 × min(upgrades, 15)`: 3 of 12 is exactly 2.5f and rounds to 3. A face checks up to 64 accessible slots starting after the slot it last moved from (after a move it starts at that same slot again), takes the first stack its extract filter passes and the inventory lets out, and offers up to `maxExtracted` of it to its targets: Insert sides of its channel colour on other faces (its own too with self feed), sorted sticky first, then priority high to low, then conduit distance (breadth-first hops over conduit links), stable in face order; each target applies its insert filter, then EnderCore's merge-then-first-empty-slot insertion. With round robin on, a persistent index starts each offer one target after the target it visited last. A Limited Item Filter on an Insert side inserts at most `limit − count`, `count` over every slot of the target (`getSizeInventory`, `getStackInSlot`); on an Extract side it extracts only what is above its limit (`getInsertLimitInv`), which the checker does not model (unknown `eio_limited_extract`).
- **E6 [src, jar] Project Red chips and payloads** (`ChipExtractor`, `ChipItemResponder`, `RoutedInterfacePipePart.getSyncResponse`, `ChipStockKeeper`, `ChipBroadcaster`/`TActiveBroadcastStack`, `netpipetraits.adjustSpeed`; `Priorities$`, `TNetworkPipe$class`, `PayloadPipePart`, `NetworkPayload`, MrTJPCore `ItemQueue` [jar]). Chip countdowns start full and act when they reach 0: extractor and broadcaster every 10 ticks (first at tick 9), stock keeper every `100 + min(10 × passes that requested nothing, 1200)` ticks (first at tick 99); none is saved, so after a chunk load every chip of a line counts down together. Priorities, most preferred first: Active Craft, Active Broadcast, Passive (Item Responder), Terminated (Item Terminator), Default (Overflow Responder), Wandering; within one, the chip's own priority setting, then distance. The extractor's `getAllItemStacks` is a hash map in the jar (the checker takes first-slot order: open question 5); its 64-item budget (`itemsToExtract`) is read inside the per-key closure, so it starts again for each item key, and a key that uses it up ends the whole act. A broadcaster promises what its inventory shows through its filter minus its promises; an order whose extraction fails is dropped (`timeOutOnFailedExtract`) and the stock keeper asks again on a later pass.
  **Payloads** [jar]. A chip's send only appends a payload to its own pipe's send queue (`queueStackToSend`). `TNetworkPipe.update` dispatches the queue's head, one payload per pipe per tick, at the start of the pipe's next update (`dispatchQueuedPayload`: `injectPayload` at the inventory side, then the destination's `itemExpected`), so a payload counts in its destination's transit only from its dispatch, and two chips acting in one tick both see a responder's whole room. A dispatched payload starts at progress 0 at the source pipe's inventory edge, first moves on the next tick, and goes into the target at the far end of the destination pipe: hops + 1 pipe lengths at its priority's boost in blocks per tick (Wandering 0.05, Default 0.1, Terminated 0.05, Passive 0.2, Active Broadcast and Active Craft 0.3; Java's float sums give ⌈(hops + 1) × 100 / boost⌉ ticks). A stack that does not all go in bounces (`endReached` → `bounceStack` → `resolveDestination`): while its destination's router exists it keeps that destination, stays in its transit and turns back to try the same inventory one pipe length later. Its count leaves the transit only when all that is left of it goes in at once (`passToInventory` copies the stack before inserting, and `itemReceived` takes that copy's size off, never below 0: `ItemQueue.remove`), so a payload that went in in parts leaves its earlier part counted. A payload with no destination re-routes each time it enters a pipe (`injectPayload` → `resolveDestination` with `destinationIP ≤ 0` → `reRoute`), and the pipe it re-routes to never counts it in its transit (`setDestination` does not call `itemExpected`); with no answer it wanders at Wandering speed and tries again at the next pipe; the pack's "Max Wander Distance" is 0, so a wanderer is never deleted. A pipe saves only its router id and statistics (`TNetworkPipe.save`): its send queue and its transit counts are lost on a restart, and with the queue the items in it; a payload saves its stack and travel data but not its destination.
- **E7 [jar] Settles research §8's second question.** GT tiles never notify their neighbours when their inventory changes: `BaseTileEntity.func_70296_d` (markDirty) only marks the chunk modified (`Chunk.func_76630_e`), `CommonBaseMetaTileEntity.func_70296_d` adds `mInventoryChanged = true`, and none of `BaseTileEntity`, `CoverableTileEntity`, `CommonBaseMetaTileEntity`, `BaseMetaTileEntity`, `MetaTileEntity`, `CommonMetaTileEntity` calls `World.func_147453_f`, the call that reaches ForgeMultipart's `onNeighborTileChanged`. So a Stock Keeper beside a GT machine or an Auto Workbench never has its idle slowdown reset by that machine; only its own requesting passes reset it.
- **E8 [jar, src] AE2 crafting** (`TickRates.Interface` = 5 to 120 ticks [jar]; `CraftingCPUCluster.updateCraftingLogic` 745–795 and `executeCrafting` 800–1040 [src]). A CPU with c co-processors may push `c + 1 − (pushes of its last three updates)` patterns in an update, so without co-processors one push every 4 ticks. It walks its tasks and each task's interfaces, skips a busy one, takes the pattern's inputs from its own store and pushes; unless the interface blocks, it may push the same pattern into the same interface again in that update. The interface's push is research §2.3's `pushPattern`, with one refinement read in `DualityInterface` 1352–1366: when no side takes any of the stacks, `pushPattern` returns false and nothing enters the send list, so a Fluid Packet that no input slot takes leaves the CPU retrying, while a packet left over beside stacks that did go in waits in the send list and keeps the interface busy. An interface ticks at AE2's adaptive rate, not every 5 ticks [jar]: a `TickTracker` starts at (5 + 120) / 2 = 62 ticks and is held between 5 and 120; a tick that moved something returns URGENT (5 ticks), one that moved nothing SLOWER (one tick longer); a stack added to its send list alerts it to tick at once (`addToSendList` → `alertDevice`; `TickManagerCache` ticks a tracker when `currentTick − lastTick ≥ rate`).
- **E9 [src, jar] GT item pipes and their covers** (`MTEItemPipe.onPostTick` 219–254, `sendItemStack`, `insertItemStackIntoTileEntity`, `pipeCapacityCheck`, `allowPutStack`; `IMetaTileEntityItemPipe$Util.scanPipes`; `CoverItemFilter.letsItemsIn/Out` 181–188; `CoverShutter` 28–107). Every 10 ticks of its own timer (`(aTick − mCurrentTransferStartTick) % 10 == 0`, `aTick` as in E1) a pipe holding items sends only when the side it last received from is the one it had at its previous check (`oLastReceivedFrom == mLastReceivedFrom` [jar]: a fresh stack waits one check; at the end of every check it keeps that side, `UNKNOWN` once it is empty). It offers its items to the network's pipes sorted by distance (`scanPipes` over step sizes, the sending pipe itself first; with one pipe material the distance is the hop count), each trying its connected sides from a random start (the checker uses side order 0–5: open question 6), the sending pipe never back out of the side it received them from; each send is one stack through gtnhlib's `ItemTransfer` (E4), never into another pipe. A side passes items only when its cover lets them out: GT's Item Filter cover always does (`letsItemsOut` is true; so it never stops a pipe, research §2.4), a Shutter Module Cover only in "Only Output allowed" (so "Only Input allowed" stops the pipe there). A send counts against the transfer counter of every pipe the scan tried up to the taker, the sender included, and a pipe moves at most its capacity (its slot count) in stacks per 20 ticks. A pipe takes a pushed stack only into an empty slot, and while it holds items only from the side it first received from (`allowPutStack` [jar]): it never merges. The Item Filter cover acts every tick and moves up to 64 stacks (`setStacksToTransfer(64)` [jar]). Covers act only once their host's timer passes 10 (`mTickTimer > 10` before `doCoverThings` [jar]: nothing in the first 10 ticks after a chunk load) and on server ticks that are multiples of their tick rate (`MinecraftServer.getTickCounter() % tickRate` [jar]), so a cover's phase is the server's, not its host's.
- **E10 [src, jar] Conveyor covers** (`CoverConveyor.doTransfer`, `letsItemsIn/Out`): every `tickRate` ticks one moves up to `stacksPerTransfer` stacks of up to `itemsPerStack` items out of (export) or into (import) its host, through the neighbour's own rules (skipping refused stacks, E4): LV 16 per 100 ticks, MV 64/100, HV 64/20, EV 64/4, IV 64/1, LuV 4 × 64/1, ZPM 16 × 64/1 (gt-mechanics §3.8, the `COVER_RATES` comments in `src/server/layout/parts.ts`). `doTransfer` always sets `dropItems` [jar]: an export conveyor with no inventory at its side (air, a routed pipe, a cable) drops what it moves into the world (gtnhlib's `DroppingItemSink`).
- **E11 [src] Slot counts** (`LoaderMetaTileEntities` builders, `setSlotsCount(in, out)`, joined by mteId with the export's meta names): Task 1's table. Tiers ZPM to UMV equal IV for every kind; LuV was not captured and is taken as IV. The Packager (`MTEBoxinator` constructor) has 2 inputs and 1 output.
- **E12 [src, jar, export] AE2's blocking-ignore list** (`AE2Compat.registerBlockingModeIgnoreItems` 81–139; AE2's `BlockingModeIgnoreItemRegistry.registerDefault` [jar]): the programmed circuit (as an item: every meta), 31 molds, 28 extruder shapes, 2 slicer blades, GT lenses (registered by `ProcessingLens`), BartWorks' lens item (`bartworks:gt.bwMetaGeneratedlens`, as an item: every meta), GT++'s Wood's Glass Lens (`miscutils:MU-metaitem.01@32140`) and Special lens, the four NH lenses (`dreamcraft:ReinforcedGlassLense@0`, `dreamcraft:MysteriousCrystalLens@0`, `dreamcraft:RadoxPolymerLens@0`, `dreamcraft:ChromaticLens@0`), the blood orbs (`AWWayofTime:` `weakBloodOrb`, `apprenticeBloodOrb`, `magicianBloodOrb`, `masterBloodOrb`, `archmageBloodOrb`, `transcendentBloodOrb`, `BloodArsenal:transparent_orb`, `ForbiddenMagic:EldritchOrb`, `Avaritia:Orb_Armok`, each `@0`), the Division Sigil (`ExtraUtilities:divisionSigil@0`) and the Twilight Forest trophies (`TwilightForest:item.trophy`, every meta); AE2 adds its five inscriber presses (`appliedenergistics2:item.ItemMultiMaterial` 13, 14, 15, 19 and 21) and the Blood Magic orbs. Research §2.3 gives GT's metas (`gregtech:gt.metaitem.01` 32301–32331, 32350–32377, 32398–32399). Every key above is in the export but the Special lens (no export entry) and the Name Press (meta 21, read from AE2's `MaterialType` [jar]).
- **E13 What stays UNVERIFIED in game** (research §8): the Limited Item Filter on an In / Out face toward a bench, a Stock Keeper fed by Broadcasters, the Locking Card's throughput — the checker models the code as read; Robot Arm covers are not modelled (unknown `robot_arm`), as no lane lays them yet. C16 (Sticky Resin both a surplus and a bench ingredient: slower, not stuck) is what the simulation measures on a line that has it (`feed_slow` where it is slow), first on add-on 12 Task 8's bench lines.
- **E14 [jar] The Locking Card counts every injection into the network.** On a push with Lock Crafting "Until crafting result is returned", `DualityInterface.onPushPatternSuccess` sets `unlockStacks` to copies of the pattern's condensed outputs (result and container returns alike) and registers the interface as a storage interceptor of the network's item monitor (`addInterception` → `NetworkMonitor.addStorageInterceptor`). `NetworkMonitor.injectItems` hands every matching injection (`canAccept`), from any source, to every interceptor; each counts its own list down (`injectItems` on MODULATE, returning the stack untouched, so the next interceptor sees it too), and the lock clears only when its whole list is empty (`shouldRemoveInterceptor`). So a pattern with a result and a container return stays locked until both are back, and one bench's result counts down every interface waiting on the same item (a step of two benches, or the same item made elsewhere).
- **E15 [jar] Which controllers start with Input Separation on.** `MTEMultiBlockBase`'s constructor sets `inputSeparation = getDefaultInputSeparationMode()`, which `IControllerWithOptionalFeatures` defaults to `supportsInputSeparation()` (`MTEExoFoundry` overrides both to true). Resolved through the superclasses of every multiblock controller class in the GT jar (GT, GT++, BartWorks, GoodGenerator, TecTech, KubaTech, GTNH-Lanth and the rest), 69 concrete classes return true (Task 1's `INPUT_SEPARATION_DEFAULT`); `MTECircuitAssemblyLine` computes it from its mode, 0 on a new one (false); every other controller returns false.
- **E16 [jar] The ME Export Bus** (`PartBaseExportBus.doBusWork`, `PartExportBus.calculateAmountToSend`, `TickRates.ExportBus`, `TickTracker`). Each operation moves up to its amount (1 item; 8, 32, 64 or 96 with one to four Acceleration Cards), shared over its config slots in order, each from ME storage into the block it faces through that block's own insertion (for a GT machine gtnhlib's `GTItemSink`: merge, then empty slots, by `canInsertItem`). It ticks between 5 and 60 ticks, starting at (5 + 60) / 2 = 32; after an operation that moved something 2 ticks sooner (FASTER), after one that did not 1 tick later (SLOWER). Main lays it today only as a hookup end (`me_export_bus`, `appliedenergistics2:item.ItemMultiPart@260`, config `exportFilter`: item names); research §3.5 and §6.4 item 3 have fix/feeding lay one in front of each AE2 step that has no encodable pattern.
- **E17 [cfg, main] Connections and steam machines as main lays them.** The pack's `GregTech.cfg` sets `gt6Cable=true` and `gt6Pipe=true`: a GT cable, fluid pipe or item pipe touches only the neighbours its connection bits point at, so a cable that runs past a block unconnected gives it no EU. Main's bench step (laid like a basic machine) has its only connected cable on the bench's back (probe of `main`'s `layoutLine`: the cable north of the bench has a bit toward it, the one west of it runs north–south past it). Since merge train 1 (`8375372`, architecture entry 48) main lays a steam singleblock (kind `steam`, `MTEBasicMachineBronze`, which keeps `MTEBasicMachine`'s slot rules) in the routed, AE2 and EnderIO modes with its output side up (`facing` 1, `mainFacing` along the row) and its items on its middle-row side: a routed interface pipe (probe: "Item Responder Chip (whitelist: Alpha) + Item Extractor Chip"), an EnderIO `in_out` face, or an ME interface whose machine's outputs are taken out by hand (`steam_items`: `doesAutoOutput` is false and no cover fits, `allowCoverOnSide` admitting only primitive covers). Only the Bricked Blast Furnace (`NO_AUTOMATION`) and the Coke Oven (`OWN_HATCH`) are run by hand (`manualReasonOf` in `src/server/layout/multiblock-rules.ts`); what they make reaches the line through its input chest.

## Global Constraints

- `<repo>` below is the main checkout: `dirname "$(git rev-parse --path-format=absolute --git-common-dir)"` from the worktree. Task 1 Step 0 merges `main` into the lane when the lane lacks merge train 1 (`8375372`: architecture entries 47 and 48, `src/server/layout/multiblock-rules.ts`, main's steam and hand-run layouts) and runs `npm ci` in the worktree.
- New files only: `src/server/layout/feeding/**`, `tests/unit/layout/feeding/**`, `tests/helpers/feeding-fixtures.ts`, `tests/unit/layout/real-feeding.test.ts`. No existing file is modified, so the lane merges with no conflict; architecture entry 50 is appended by the merge commit that brings this lane into main, nothing else.
- The module is pure: no `node:*`, no I/O, no `Date`, no `Math.random`. It imports only `src/shared/**`, and from the server only `stepItemInputs`, `stepItemOutputs` (`src/server/layout/modes/mode.ts`), `stepDepths` (`src/server/layout/arrange.ts`), `busSlots` (`src/server/layout/parts.ts`) and `manualReasonOf` (`src/server/layout/multiblock-rules.ts`, main's own rule for the multiblocks a line runs by hand, E17).
- TypeScript erasable syntax only (no `enum`, `namespace`, parameter properties, decorators); `import type` for types; relative imports name the real `.ts` file; `as const` objects for enumerations.
- Determinism: the same inputs give a deep-equal report every run. Every order is taken in the line's local frame: positions by x, y, z of the cell turned back by `layout.rotation` (`fromWorld`, Task 2), sides in local ForgeDirection order 0–5, item keys in code-unit order. The scheduled engine gives the same report as running every entity on every tick (`exhaustive: true`).
- Time constants (`contract.ts`): `TICKS_PER_SECOND = 20`, `DEFAULT_TICKS = 24_000` (20 minutes per scenario), restart at `restartAt` (default `Math.floor(ticks / 2)`), rates over the second half `[⌊ticks/2⌋, ticks)`, `STALL_TICKS = 1_200`, `LATE_TICKS = 1_200`, `FAST_FACTOR = 10`, `SLOW_TOLERANCE = 0.1`, `CHURN_ITEMS = 64`, `BURST_TICKS = 1_200`.
- Tile timers (E1, E3, E9): the line's chunk loads at tick 0 and again at `restartAt` in `restart`; a GT tile's age is the ticks since its last load and the `aTick` it sees is age + 1, so its 600-tick check, an output bus's 8-tick push and a pipe's 10-tick check follow its age, not the tick number. Covers act from age 10 on server ticks that are multiples of their tick rate; the model counts the server's ticks from the same load (true when the line's chunk loads with the server, as after a restart; a chunk that loads later starts covers at another phase, which the model does not try).
- Every item stacks to 64 except `ae2fc:fluid_packet@0` and `gregtech:gt.metatool.01@*` (1 each): the export carries no stack sizes (unknown `stack_sizes`, once per report; open question 7).
- Not modelled, each an unknown and never a finding: power (every machine is fed, a steam machine's steam too; benches gain `V[tier]` EU a tick), fluid routing (a fluid the line makes is one pool per fluid, filled at a run's end and drawn at a run's start; a fluid from outside is always there; only an AE2 pattern's fluids travel as items), the multiblocks main runs by hand (`manualReasonOf`: the Bricked Blast Furnace and the Coke Oven, `hand_run`), a steam machine's outputs that AE2 mode leaves to the player (`steam_by_hand`: taken into ME as each run ends), Robot Arm covers, Molecular Assemblers, Logistics Pipes, maintenance, cleanrooms. Steam singleblocks are modelled as GT basic machines (E17).
- Assumed and not checked: the player or a hookup takes the line's products, so an item the plan sends out leaves an output chest as it arrives, while anything else stays in it (Task 4 rule 9; open question 15).
- Performance: `checkFeeding` with default options on Task 11's 1,200-block fixture line takes under 1,000 ms (median of 3 warm runs on this host); each real-data line under 5,000 ms.
- Real data (Task 12) only with `GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json` (worktree config: `dataDir` = the worktree's `data/`, whose `export` and `assets` are symlinks to `<repo>/data/export` and `<repo>/data/assets`; only `serverFolder` and `activeExportId` are copied from `<repo>/data/config.json`, which holds secrets — never print or copy anything else). The user's Electronic Circuit settings are read at run time from `docs/local/circuit-reference/reference.json` (`docs/local` a symlink to `<repo>/docs/local`, gitignored): private, never printed, never copied into a committed file. Real-data tests print counts and codes only.
- Unit tests use synthetic fixtures only (invented names, apart from the GT class names, mteIds and item ids the code names); nothing game-derived is committed; no absolute local paths in committed files.
- Commits use a conventional prefix and end with a blank line and then `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. Never use bare `git stash`.

## Codes

| Code | Kind | Raised by | Gate |
|---|---|---|---|
| `feed_crowded` | deadlock | static (certain: kinds > free slots, or Multi Stack Input set On on a 2+ kind machine in a push mode; risk: Multi Stack Input not set there, or 2+ input buses with Input Separation on) · sim (a kind cannot enter while its recipe waits for it; a set split over separated buses) | yes |
| `feed_overfill` | overfill | static (risk: bus fed 2+ kinds without Limiting; certain: bench without its mode's cap; risk: bench stock out of the §3.6 bounds, fluid face) · sim (a kind in two slots of a machine that takes 2+ kinds; a bench above its cap or holding a non-grid item) | no |
| `feed_bench_eject` | overfill | sim (any stack moved to slot 18 that is not a craft result) | yes |
| `feed_bench_delete` | deletion | sim (the duplicates loop overwrote slot 18) | yes |
| `feed_bench_stuck` | deadlock | static (certain: a GT tool in a grid cell; certain: its back not on the line's logistics block) · sim (slot 18 refused by its back for `STALL_TICKS`) | yes |
| `feed_no_route` | deadlock | static (certain: an Extractor Chip that does not whitelist an output; an output nothing in the network takes) · sim (an output blocked for `STALL_TICKS` in a row with nothing taken out of it meanwhile) | yes |
| `feed_pool_starve` | starvation | static (certain: a machine of 2+ steps outside AE2; risk: AE2 with blocking off) · sim (a recipe of a shared machine that never ran while its inputs were there for `STALL_TICKS`) | yes |
| `feed_fluid_packet` | deadlock | static (risk: a pattern with a fluid input on a plain interface) · sim (a Fluid Packet in a machine slot, or held by an interface for `STALL_TICKS`) | yes |
| `feed_pattern_unencodable` | deadlock | static (certain: a pattern with a fluid the line pipes, a fraction, a held item or a circuit) | yes |
| `feed_starved` | starvation | static (certain: AE2 blocking toward a held item off the ignore list or toward a bench; a bench whose only connected cable is on its back) · sim (a planned input never delivered) | yes |
| `feed_slow` | starvation | sim (delivered below `(1 − slowTolerance)` × planned while the recipe waited for it more than 10 % of the window) | no |
| `feed_leak` | starvation | static (risk: an ME interface touching two inventories) · sim (an item planned for a machine reaching a chest) | no |
| `feed_churn` | livelock | static (certain: an Extractor Chip on an input bus) · sim (≥ `CHURN_ITEMS` pulled back out of an input bus, bounced and circling their pipe, or wandering) | no |

`report.ok` is true when no `certain` finding has a gate code. The gate is research §7's acceptance list (`feed_crowded`, `feed_bench_*`, `feed_pool_starve`, `feed_fluid_packet`) plus `feed_no_route`, `feed_pattern_unencodable` and `feed_starved`, so a line that moves nothing — today's routed lines — or whose AE2 job cannot run does not pass (open question 3). A static finding has `certainty: 'certain'` (it will happen) or `'risk'` (it can, under a schedule or a setting the layout does not fix) and a risk never gates: the scenarios test it (Multi Stack Input left unset gates through `multistack_on`'s `feed_crowded`); every simulation finding is `certain` for its scenario.

## Review Focus

1. **A line laid out in any rotation, or dragged anywhere**: the same findings, by step and local cell, as at rotation 0 — the adapters and every order use the local frame. Tests: Task 2 "reads a rotated line in the local frame", Task 11 "reports the same findings in every rotation".
2. **A layout older than its plan**: a machine block whose `stepId` (or a `stepIds` entry) the plan lacks, a step without units, a layout with status `empty` or `no-world`, a plan with status `empty` or `infeasible` — never a crash; the machine is skipped with unknown `step_missing`; an empty line is `ok: true` with no findings. Tests: Task 2 "skips a machine whose step the plan lacks", Task 11 "checks an empty layout".
3. **A machine kind without slot data** (not in the table, no exported counts — a CropsNH or GT++ singleblock, a steam machine): slots from its recipes with unknown `slots_unknown`; the static slot rule is skipped for it; the simulation runs. Tests: Task 2 "falls back to the recipes for slots", Task 3 "skips the slot rule where slots are unknown".
4. **Structured config and today's text on one block** (fix/feeding half done): the structured one wins and unknown `text_ignored` says so; text the adapter cannot read gives `text_unread` and the plan-derived reading. Test: Task 2 "prefers the structured config over the text".
5. **Fractional amounts** (chanced outputs, inputs consumed by chance, the plan's expected per-run amounts below 1): deterministic accumulators, never a fraction of an item in a slot; an AE2 pattern with a fraction is unencodable and never pushed. Tests: Task 4 "rolls chances deterministically", Task 9 "never encodes a fraction".

---

## Architecture change requests

One architecture §11 entry numbered **50** (reserved for this plan; 39 add-on 12, 41 add-on 14, 44 add-on 15, 45 add-on 17, 46 add-on 19, 47 the multiblock hatch rules, 48 `fix/steam-primitive` (47 and 48 on main since merge train 1) and 49 add-on 20 are reserved or taken), appended by the merge commit that brings this lane into main (the lane itself adds new files only):

1. **The feeding checker** (`src/server/layout/feeding/`, plan `2026-10-20-21-feeding-checker.md`; research `machine-feeding.md` §7): `checkFeeding({ pack, plan, layout, options? }) → FeedingReport` (`check.ts`) and `precheckFeeding(model, pack) → FeedFinding[]` (`precheck.ts`, the static rules; fix/feeding raises them as layout warnings with the same `feed_*` codes), `readLine({ pack, plan, layout }) → FeedModel` (`read.ts`), `FEED_GATE_CODES` and the report types (`contract.ts`). Pure: no I/O, deterministic. Add-on 15 Task 8 and add-on 12 Task 8 gate on `report.ok`.
2. **`LayoutBlock.feed?: FeedSpec`** (an optional addition to §6.7, written by fix/feeding on routed interface pipes, ME interfaces and ME Export Buses, and by add-on 12 Task 6 on Auto Workbenches and their logistics blocks): `FeedSpec { chips?: RoutedChipSpec[]; interface?: InterfaceSpec; bench?: BenchSpec; exportBus?: ExportBusSpec }` as `contract.ts` defines them (Task 1); `InterfaceSpec.targets` are world faces like `CoverSpec.face` (the writer turns them with the line's rotation, as `layoutLine` turns covers). Until a lane adds the field to `src/shared/types/layout.ts`, the checker reads it structurally (`FeedBlock = LayoutBlock & { feed?: FeedSpec; stepIds?: string[] }`); the lane that adds it moves the `FeedSpec` types unchanged to `src/shared/types/feed.ts` and leaves `contract.ts` re-exporting them (open question 1).
3. **`ConduitFilter.limits?: Array<{ key: StuffKey; count: number }>`** (an optional addition to the EnderIO types of entry 38): the Limited Item Filter's counts in slot order, present when `item` is `EnderIO:itemLimitedItemFilter@0`, each count the stock wanted plus the item's grid cells (research §2.1, §3.6); written by add-on 12 Task 6.
4. **Flat `BlockConfig` keys the checker reads** (add-on 15's words, entry 44; fix/feeding writes them on main): `multiStack`, `inputFilter`, `inputFromOutputSide`, `autoOutput` and `circuit` on singleblocks, `limited` and `inputFilter` on input buses, `lock` on output buses (add-on 15: the name of the item the bus is locked to), `exportFilter` on an ME Export Bus (main's hookup key: item names), and new **`inputSeparation`** (boolean) on a multiblock controller (`false` = "Input buses aren't separated", research §6.2 item 2). A key the layout leaves out means GT's default plus an unknown.
5. **`Machine.itemInSlots?` / `itemOutSlots?`** (add-on 20's optional additions to §6.2): when the export carries them they replace `facts.ts`'s slot table (research §7 "the exporter then replaces the slot table").
6. **Layout warning codes** reserved for fix/feeding's warnings: the thirteen `feed_*` codes of this plan's Codes table, with the static texts of Task 3.

## File Structure

| File | Responsibility |
|---|---|
| `src/server/layout/feeding/contract.ts` | the input contract (`FeedSpec`, `RoutedChipSpec`, `InterfaceSpec`, `PatternSpec`, `BenchSpec`, `ExportBusSpec`, `FeedConduitFilter`, `FeedBlock`, `CONFIG_KEYS`), the report (`FeedingReport`, `FeedFinding`, `FeedUnknown`, `InputReport`, `ScenarioSummary`), codes, kinds, scenarios, options and the time constants |
| `src/server/layout/feeding/facts.ts` | game constants with their evidence: slot table and `basicSlots`, stack limits, AE2's blocking-ignore test, the controllers that start with Input Separation on, conveyor operations, EnderIO rates, Project Red cadences and travel, AE2 tick rates and export amounts, bench constants, part ids |
| `src/server/layout/feeding/model.ts` | the normalized line (`FeedModel` and its node, network and recipe types) |
| `src/server/layout/feeding/frame.ts` | the line's local frame: `fromWorld`, `localSide`, `nodeId`, `compareLocal` |
| `src/server/layout/feeding/read.ts` | `readLine`: nodes, recipes, settings, supply and sinks; dispatch to the four network readers |
| `src/server/layout/feeding/read-networks.ts` | `readRouted`, `readAe2`, `readEnderio`, `readGtPipes` (structured config first, today's text and the plan second, unknowns) |
| `src/server/layout/feeding/precheck.ts` | `precheckFeeding`: the static rules R1–R12 |
| `src/server/layout/feeding/sim/core.ts` | key table, `SimInv`, insertion policies, `SimEntity`, the scheduler (`Sim`), `SimStats` |
| `src/server/layout/feeding/sim/machine.ts` | GT basic machine model (`BasicMachine`) |
| `src/server/layout/feeding/sim/storage.ts` | chests (27 slots: input chests kept stocked, products taken out of output chests) |
| `src/server/layout/feeding/sim/multi.ts` | input bus, output bus, multiblock controller |
| `src/server/layout/feeding/sim/bench.ts` | the Auto Workbench, mode 0, line for line |
| `src/server/layout/feeding/sim/enderio.ts` | EnderIO item networks |
| `src/server/layout/feeding/sim/routed.ts` | Project Red routed networks |
| `src/server/layout/feeding/sim/ae2.ts` | AE2: ME storage, crafting CPU, interfaces, ME Export Buses |
| `src/server/layout/feeding/sim/covers.ts` | GT conveyor, Item Filter and Shutter covers acting in their host's tick |
| `src/server/layout/feeding/sim/gtpipe.ts` | GT item pipes |
| `src/server/layout/feeding/text.ts` | the shared wording helpers (`amountText`, `listText`, `slotWord`) |
| `src/server/layout/feeding/sim/detect.ts` | stats → findings, texts |
| `src/server/layout/feeding/sim/run.ts` | `runScenario`: builds the entities of a model for one scenario and runs it |
| `src/server/layout/feeding/check.ts` | `checkFeeding`: precheck, scenarios, report assembly and ordering |
| `tests/helpers/feeding-fixtures.ts` | fixture pack with recipe maps, recipes and an Auto Workbench; hand-built blocks; laid-out lines; a feeder entity |
| `tests/unit/layout/feeding/*.test.ts` | one test file per task (named in each task) |
| `tests/unit/layout/real-feeding.test.ts` | the five probe lines in routed, AE2 and EnderIO on the real export (`GTNH_LOCAL`) |

## Task outline

1. Contract, codes and facts (slot table, stack limits, AE2 ignore list, cover, EnderIO and Project Red constants).
2. Reading a line: frame, nodes, recipes, settings, supply, sinks and the four network readers, with unknowns.
3. Static pre-check: rules R1–R12.
4. Simulation core and the GT basic machine: inventories, insertion policies, scheduler, covers, chests, stats and the first detectors.
5. Multiblocks: input buses (Limiting, sorting, Input Separation), output buses, the controller.
6. The Auto Workbench, mode 0, line for line.
7. EnderIO item conduits.
8. Project Red routed pipes: send queues, transit from dispatch, bounces that retry, wanderers that re-route.
9. AE2: storage, crafting CPU, interfaces, blocking, Locking Card, Fluid Packets, ME Export Buses.
10. GT item pipes (machine to machine).
11. Scenarios, `checkFeeding`, the report, determinism and the 1,200-block performance bound.
12. Real data: the research's five probe lines in routed, AE2 and EnderIO as today's main lays them out.

---

### Task 1: Contract, codes and facts

**Files:**
- Create: `src/server/layout/feeding/contract.ts`, `src/server/layout/feeding/facts.ts`, `tests/helpers/feeding-fixtures.ts` (first part: `feedPack`)
- Test: `tests/unit/layout/feeding/facts.test.ts`

**Interfaces:**
- Consumes: `StuffKey` (`src/shared/keys.ts`), `Vec3` (`src/shared/layout/geometry.ts`), `Face` (`src/shared/types/assets.ts`), `ConduitFilter`, `LayoutBlock` (`src/shared/types/layout.ts`), `Machine`, `Pack` (`src/shared/types/pack.ts`), `LogisticsMode` (`src/shared/types/plan.ts`), `ITEM_CONDUIT` (`src/shared/layout/enderio.ts`); `layoutPack`, `addLineParts`, `EBF_STRUCTURE` (`tests/helpers/layout-fixtures.ts`).
- Produces (`contract.ts`, exactly these names and fields — fix/feeding and add-on 12 Task 6 write the first block):

```ts
// ---- The layout config the checker reads (architecture entry 50) ----
export interface ItemFilterSpec { mode: 'whitelist' | 'blacklist'; keys: StuffKey[] }
export type ChipKind = 'responder' | 'extractor' | 'broadcaster' | 'stock_keeper' | 'terminator' | 'overflow';
/** One chip of a Routed Interface Pipe, in chip-slot order (at most 4). A new chip: responder and extractor whitelist [], broadcaster blacklist []. */
export interface RoutedChipSpec {
  kind: ChipKind;
  filter?: ItemFilterSpec;                              // responder, extractor, broadcaster, terminator
  stock?: Array<{ key: StuffKey; count: number }>;      // stock keeper: up to 9, counts 1–255
  requestMode?: 'when_missing' | 'when_empty' | 'infinite';   // stock keeper; default 'when_missing'
  priority?: number;                                    // the chip's own priority setting; default 0
}
/** A processing pattern: whole amounts per craft; item keys only once encodable. */
export interface PatternSpec { inputs: Array<{ key: StuffKey; amount: number }>; outputs: Array<{ key: StuffKey; amount: number }> }
export interface InterfaceSpec {
  patterns: PatternSpec[]; blocking: boolean; smartBlocking?: boolean;
  lock?: 'none' | 'until_result';                       // Locking Card on "Until crafting result is returned"
  targets?: Face[];                                     // a wrench target, in world faces like CoverSpec.face; absent = every neighbour
  dual?: boolean;                                       // ae2fc Dual Interface: fluids go in as fluids
}
/** Auto Workbench: mode 'normal' = GT++ mode 0; grid top row first, the planner's concrete items. */
export interface BenchSpec { mode: 'normal'; grid: Array<StuffKey | null>; throughput: 0 | 1 | 2 | 3 }
/** An ME Export Bus feeding a step without an encodable pattern (research §3.5): its config slots in order, its Acceleration Cards. */
export interface ExportBusSpec { keys: StuffKey[]; cards?: 0 | 1 | 2 | 3 | 4 }
export interface FeedSpec { chips?: RoutedChipSpec[]; interface?: InterfaceSpec; bench?: BenchSpec; exportBus?: ExportBusSpec }
/** A conduit side's filter that may be a Limited Item Filter (`item` = PART_KEYS.limitedFilter). */
export type FeedConduitFilter = ConduitFilter & { limits?: Array<{ key: StuffKey; count: number }> };
/** A layout block that may carry the structured config and add-on 12's shared-machine steps. */
export type FeedBlock = LayoutBlock & { feed?: FeedSpec; stepIds?: string[] };
export const CONFIG_KEYS = { multiStack: 'multiStack', inputFilter: 'inputFilter', inputFromOutputSide: 'inputFromOutputSide',
  autoOutput: 'autoOutput', limited: 'limited', inputSeparation: 'inputSeparation', circuit: 'circuit',
  lock: 'lock' /* output bus: the item's name, add-on 15 */, exportFilter: 'exportFilter' /* ME Export Bus: item names */ } as const;

// ---- What the checker reports ----
export type FeedKind = 'overfill' | 'deadlock' | 'livelock' | 'starvation' | 'deletion';
export type FeedCode = 'feed_crowded' | 'feed_overfill' | 'feed_bench_eject' | 'feed_bench_delete' | 'feed_bench_stuck' | 'feed_no_route'
  | 'feed_pool_starve' | 'feed_fluid_packet' | 'feed_pattern_unencodable' | 'feed_starved' | 'feed_slow' | 'feed_leak' | 'feed_churn';
export const FEED_KINDS: Readonly<Record<FeedCode, FeedKind>>;   // the Codes table
export const FEED_GATE_CODES: readonly FeedCode[];               // the Codes table's "yes" rows, in table order
export type ScenarioName = 'steady' | 'fast_supplier' | 'late_input' | 'restart' | 'multistack_on';
export const SCENARIOS: readonly ScenarioName[];                 // in that order
export interface FeedFinding {
  code: FeedCode; kind: FeedKind; phase: 'static' | 'sim'; certainty: 'certain' | 'risk'; scenario?: ScenarioName;
  stepId?: string; machine: string /* `${name} at ${x} ${y} ${z}`, world position */; pos: Vec3; key?: StuffKey;
  text: string; tick?: number; count?: number;
}
export interface FeedUnknown { code: string; text: string; pos?: Vec3; stepId?: string }
export interface InputReport {
  stepId: string; machine: string; pos: Vec3; key: StuffKey; plannedPerSecond: number;
  deliveredPerSecond: Partial<Record<ScenarioName, number>>; burst?: { before: number; after: number };
}
export interface ScenarioSummary { name: ScenarioName; ticks: number; runs: Record<string, number> /* by stepId */; out: Record<StuffKey, number> /* reached output chests or ME */ }
export interface FeedingOptions {
  ticks?: number; scenarios?: readonly ScenarioName[]; restartAt?: number; ae2Coprocessors?: number /* 0 */;
  ae2FluidStock?: boolean /* false: ME holds no fluid */; slowTolerance?: number; exhaustive?: boolean /* tests: every entity every tick */;
}
export interface FeedingReport { ok: boolean; findings: FeedFinding[]; inputs: InputReport[]; unknowns: FeedUnknown[]; scenarios: ScenarioSummary[] }
export const TICKS_PER_SECOND = 20, DEFAULT_TICKS = 24_000, STALL_TICKS = 1_200, LATE_TICKS = 1_200, FAST_FACTOR = 10,
  SLOW_TOLERANCE = 0.1, CHURN_ITEMS = 64, BURST_TICKS = 1_200;
```

- Produces (`facts.ts`): `basicSlots(m: Pick<Machine, 'metaName' | 'tier'> & { itemInSlots?: number; itemOutSlots?: number }): { in: number; out: number; source: 'export' | 'table' } | null`; `BASIC_SLOT_TABLE`; `stackLimit(key: StuffKey): number`; `ignoredByBlocking(pack: Pack, key: StuffKey): boolean`; `conveyorOp(coverKey: StuffKey): { tier: number; tickRate: number; stacks: number; items: number } | null`; `eioMaxExtracted(upgrades: number): number`; `eioDeficit(moved: number, max: number): number`; `PR` (`{ extractorDelay: 10, broadcasterDelay: 10, stockKeeperDelay: 100, throttleStep: 10, throttleMax: 1200, extractPerKey: 64, broadcastStacks: 8, broadcastItems: 64, maxRequest: 128, chipSlots: 4, stockSlots: 9 }`); `PrPriority` = `'wandering' | 'default' | 'terminated' | 'passive' | 'active_broadcast' | 'active_craft'` and `PR_PRIORITY_ORDER` (that order = ordinal 0–5, higher preferred); `prTravelTicks(hops: number, p: PrPriority): number` (the ticks from a payload's dispatch to its arrival, `hops` + 1 pipe lengths; `prTravelTicks(0, p)` is one pipe length, a bounce's or a wanderer's retry); `stockKeeperDelay(idlePasses: number): number`; `BENCH` (`{ craftEU: 2048, euPerItem: 10, idleTicks: 32, busyTicks: 1, firstTicks: 20, inputSlots: 9, resultSlot: 18, gridFrom: 19, slots: 30 }`), `benchEnergyCap(tier: number): number`; `EIO = { maxSlotChecks: 64, sleepTicks: 20 }`; `AE2 = { ifaceMinTicks: 5, ifaceMaxTicks: 120, exportMinTicks: 5, exportMaxTicks: 60, exportAmounts: [1, 8, 32, 64, 96], cpuWindow: 3 }` (E8, E16; a `TickTracker` starts at (min + max) / 2); `CHEST_SLOTS = 27`; `PART_KEYS` (`limitedFilter: 'EnderIO:itemLimitedItemFilter@0'`, `fluidPacket: 'ae2fc:fluid_packet@0'`, `shutter: 'gregtech:gt.metaitem.01@32749'`, `itemFilterCover: 'gregtech:gt.metaitem.01@32270'`, `circuitId: 'gregtech:gt.integrated_circuit'`, `gtToolId: 'gregtech:gt.metatool.01'`, `meExportBus: 'appliedenergistics2:item.ItemMultiPart@260'`); `BENCH_CLASS = 'MTEElectricAutoWorkbench'`; `INPUT_SEPARATION_DEFAULT: ReadonlySet<string>` (the 69 controller class simple names of E15); `BLOCKING_IGNORED: { keys: ReadonlySet<StuffKey>; ids: ReadonlySet<string> }` (E12's exact keys, and the ids registered as items, every meta). The multiblocks a line runs by hand are main's `manualReasonOf` (Task 2), not a list here.
- Produces (`tests/helpers/feeding-fixtures.ts`): `feedPack(): Pack` — `layoutPack()` plus: maps on the fixture machines (`IDS.MACERATOR` `gt.recipe.macerator`, `IDS.ASSEMBLER` `gt.recipe.assembler`, `IDS.CHEM_HV` `gt.recipe.chemicalreactor`, `IDS.EXTRACTOR` `gt.recipe.fluidextractor`, `IDS.SOLIDIFIER` `gt.recipe.fluidsolidifier`, `IDS.EBF` `gt.recipe.blastfurnace`); fixture machines `FEED_IDS.SMELTER` 2020 "Advanced Alloy Smelter" (`basicmachine.alloysmelter.tier.02`, tier 2, `gt.recipe.alloysmelter`), `FEED_IDS.MIXER` 2021 "Basic Mixer" (`basicmachine.mixer.tier.01`, tier 1, `gt.recipe.mixer`), `FEED_IDS.BENCH` 31092 "Auto Workbench (MV)" (`basicmachine.automation.autoworkbench.02`, cls `gtPlusPlus.xmod.gregtech.common.tileentities.automation.MTEElectricAutoWorkbench`, kind `other`, tier 2, maps `[]`), `FEED_IDS.ODD` 2022 "Seed Thing" (`cropsnh.seedthing.tier.01`, cls `com.example.MTESeedThing`, kind `basic`, tier 1, map `t.recipe.seed`), `FEED_IDS.STEAM` 2023 "Steam Macerator" (`bronzemachine.macerator`, cls `gregtech.common.tileentities.machines.steam.MTESteamMaceratorBronze`, kind `steam`, tier 1, map `gt.recipe.macerator`), `FEED_IDS.COKE` 2024 "Coke Oven" (`multimachine.cokeoven`, cls `gregtech.common.tileentities.machines.multi.MTECokeOven`, kind `multiblock`, map `gt.recipe.cokeoven`, a copy of the fixture EBF's structure); items `t:a@0` "Alpha", `t:b@0` "Beta", `t:c@0` "Gamma", `t:x@0` "Ex", `t:y@0` "Why", `t:lens@0` "Test Lens" (`gt: { prefix: 'lens', material: 'Glass', amount: 3628800 }`), and the part items of `PART_KEYS`. The fixture's existing machines keep their ids (`IDS`) and names.

- [ ] **Step 0: Worktree setup**

Run: `git merge-base --is-ancestor 8375372 HEAD || git merge main -m "merge: main (merge train 1) into the feeding checker lane" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"`, then `npm ci && git show research/feeding:docs/research/machine-feeding.md | head -3 && grep -c "^50\. " docs/superpowers/plans/2026-10-17-00-architecture.md && grep -c "export function manualReasonOf" src/server/layout/multiblock-rules.ts`
Expected: the lane has merge train 1 (the merge is conflict-free: the lane's only own file is this plan); install succeeds; the research's title line; `0` (entry 50 still free); `1` (main's `manualReasonOf`, E17). If `src/shared/types/pack.ts` already has `itemInSlots` (add-on 20 merged), note it in the commit message: `basicSlots` reads it either way.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/facts.test.ts
import { describe, expect, it } from 'vitest';
import { FEED_GATE_CODES, FEED_KINDS, SCENARIOS } from '../../../../src/server/layout/feeding/contract.ts';
import {
  INPUT_SEPARATION_DEFAULT, basicSlots, benchEnergyCap, conveyorOp, eioDeficit, eioMaxExtracted, ignoredByBlocking, prTravelTicks, stackLimit,
  stockKeeperDelay,
} from '../../../../src/server/layout/feeding/facts.ts';
import { feedPack } from '../../../helpers/feeding-fixtures.ts';

const slots = (metaName: string, tier: number) => basicSlots({ metaName, tier });

describe('feeding facts', () => {
  it('reads the slot table by kind and tier', () => {
    expect(slots('basicmachine.assembler.tier.01', 1)).toEqual({ in: 6, out: 1, source: 'table' });
    expect(slots('basicmachine.assembler.tier.02', 2)).toEqual({ in: 9, out: 1, source: 'table' });
    expect(slots('basicmachine.mixer.tier.04', 4)).toEqual({ in: 9, out: 4, source: 'table' });
    expect(slots('basicmachine.macerator.tier.03', 3)).toEqual({ in: 1, out: 2, source: 'table' });
    expect(slots('basicmachine.press.tier.05', 5)).toEqual({ in: 6, out: 1, source: 'table' });
    expect(slots('basicmachine.laserengraver.tier.04', 4)).toEqual({ in: 4, out: 1, source: 'table' });
    expect(slots('basicmachine.arcfurnace.tier.04', 4)).toEqual({ in: 2, out: 9, source: 'table' });
    expect(slots('basicmachine.circuitassembler.tier.07', 7)).toEqual({ in: 6, out: 1, source: 'table' });
    expect(slots('basicmachine.boxinator.tier.01', 1)).toEqual({ in: 2, out: 1, source: 'table' });
  });

  it('prefers exported slot counts and knows nothing of other machines', () => {
    expect(basicSlots({ metaName: 'basicmachine.assembler.tier.02', tier: 2, itemInSlots: 5, itemOutSlots: 2 })).toEqual({ in: 5, out: 2, source: 'export' });
    expect(slots('cropsnh.seedthing.tier.01', 1)).toBeNull();
    expect(slots('basicmachine.assembler.tier.00', 0)).toBeNull();
    expect(basicSlots({ metaName: 'basicmachine.assembler.tier.01', tier: undefined })).toBeNull();
  });

  it('stacks to 64 but for Fluid Packets and GT tools', () => {
    expect(['minecraft:redstone@0', 'ae2fc:fluid_packet@0', 'gregtech:gt.metatool.01@170'].map(stackLimit)).toEqual([64, 1, 1]);
  });

  it('knows what AE2 blocking mode ignores', () => {
    const pack = feedPack();
    const yes = ['gregtech:gt.integrated_circuit@3', 'gregtech:gt.metaitem.01@32301', 'gregtech:gt.metaitem.01@32331', 'gregtech:gt.metaitem.01@32350',
      'gregtech:gt.metaitem.01@32377', 'gregtech:gt.metaitem.01@32398', 'gregtech:gt.metaitem.01@32399', 't:lens@0',
      'miscutils:MU-metaitem.01@32140', 'dreamcraft:ReinforcedGlassLense@0', 'dreamcraft:ChromaticLens@0', 'bartworks:gt.bwMetaGeneratedlens@4',
      'appliedenergistics2:item.ItemMultiMaterial@13', 'appliedenergistics2:item.ItemMultiMaterial@19', 'appliedenergistics2:item.ItemMultiMaterial@21',
      'AWWayofTime:weakBloodOrb@0', 'AWWayofTime:transcendentBloodOrb@0', 'Avaritia:Orb_Armok@0', 'TwilightForest:item.trophy@2'];
    const no = ['gregtech:gt.metaitem.01@32300', 'gregtech:gt.metaitem.01@32332', 'gregtech:gt.metaitem.01@32349', 'gregtech:gt.metaitem.01@32378', 't:a@0',
      'miscutils:MU-metaitem.01@32142', 'appliedenergistics2:item.ItemMultiMaterial@20', 'appliedenergistics2:item.ItemMultiMaterial@22'];
    expect(yes.map((k) => ignoredByBlocking(pack, k))).toEqual(yes.map(() => true));
    expect(no.map((k) => ignoredByBlocking(pack, k))).toEqual(no.map(() => false));
  });

  it('knows which controllers start with Input Separation on', () => {
    expect(INPUT_SEPARATION_DEFAULT.size).toBe(69);
    expect(['MTEElectricBlastFurnace', 'MTEPyrolyseOven', 'MTEIndustrialMixer', 'MTEIndustrialCentrifuge', 'MTEAdvEBF', 'MTEMegaChemicalReactor',
      'MTEExoFoundry', 'MTEPlasmaModule'].map((c) => INPUT_SEPARATION_DEFAULT.has(c))).toEqual(Array(8).fill(true));
    expect(['MTEVacuumFreezer', 'MTEDistillationTower', 'MTELargeChemicalReactor', 'MTECircuitAssemblyLine', 'MTECokeOven']
      .map((c) => INPUT_SEPARATION_DEFAULT.has(c))).toEqual(Array(5).fill(false));
  });

  it('gives covers, conduit faces, payloads, stock keepers and benches their rates', () => {
    expect([32630, 32631, 32632, 32633, 32634, 32635, 32636].map((m) => conveyorOp(`gregtech:gt.metaitem.01@${m}`))).toEqual([
      { tier: 1, tickRate: 100, stacks: 1, items: 16 }, { tier: 2, tickRate: 100, stacks: 1, items: 64 }, { tier: 3, tickRate: 20, stacks: 1, items: 64 },
      { tier: 4, tickRate: 4, stacks: 1, items: 64 }, { tier: 5, tickRate: 1, stacks: 1, items: 64 }, { tier: 6, tickRate: 1, stacks: 4, items: 64 },
      { tier: 7, tickRate: 1, stacks: 16, items: 64 }]);
    expect(conveyorOp('t:x@0')).toBeNull();
    expect([0, 1, 3, 15, 20].map(eioMaxExtracted)).toEqual([4, 8, 16, 64, 64]);
    expect([[4, 4], [1, 4], [3, 8], [3, 12], [12, 12]].map(([n, m]) => eioDeficit(n!, m!))).toEqual([10, 3, 4, 3, 10]);
    expect(([[3, 'passive'], [3, 'active_broadcast'], [1, 'wandering'], [0, 'passive'], [7, 'default']] as const).map(([h, p]) => prTravelTicks(h, p)))
      .toEqual([20, 14, 40, 5, 80]);
    expect([0, 1, 120, 200].map(stockKeeperDelay)).toEqual([100, 110, 1300, 1300]);
    expect([1, 2, 3].map(benchEnergyCap)).toEqual([2048, 32768, 786432]);
  });

  it('names a kind for every code and gates the research acceptance', () => {
    expect(FEED_GATE_CODES).toEqual(['feed_crowded', 'feed_bench_eject', 'feed_bench_delete', 'feed_bench_stuck', 'feed_no_route', 'feed_pool_starve',
      'feed_fluid_packet', 'feed_pattern_unencodable', 'feed_starved']);
    expect(Object.keys(FEED_KINDS)).toHaveLength(13);
    expect(new Set(Object.values(FEED_KINDS))).toEqual(new Set(['overfill', 'deadlock', 'livelock', 'starvation', 'deletion']));
    expect(SCENARIOS).toEqual(['steady', 'fast_supplier', 'late_input', 'restart', 'multistack_on']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/facts.test.ts`
Expected: FAIL — cannot find module `src/server/layout/feeding/contract.ts`.

- [ ] **Step 3: Implement `contract.ts`, `facts.ts` and `feedPack`**

- `contract.ts`: the Produces block verbatim, with `FEED_KINDS` and `FEED_GATE_CODES` from the Codes table; a header comment naming architecture entry 50 and research §7.
- `facts.ts`: every constant with its evidence item in a comment (E1–E17, research section). `BASIC_SLOT_TABLE` holds `[in, out]` per kind, each a number (every tier) or the values for LV, MV, HV, EV, IV (E11):

```ts
export const BASIC_SLOT_TABLE = {
  alloysmelter: [2, 1], amplifab: [1, 1], arcfurnace: [2, [4, 4, 4, 9, 9]], assembler: [[6, 9, 9, 9, 9], 1], autoclave: [2, [2, 2, 3, 4, 4]],
  bender: [2, 1], boxinator: [2, 1], canner: [2, 2], centrifuge: [2, 6], chemicalbath: [1, [3, 3, 6, 6, 6]], chemicalreactor: [2, 2],
  circuitassembler: [6, 1], compressor: [1, 1], cutter: [2, [2, 2, 4, 4, 4]], distillery: [1, 1], e_furnace: [1, 1], e_oven: [1, 1],
  electrolyzer: [2, 6], electromagneticseparator: [1, 3], extractor: [1, 1], extruder: [2, 1], fermenter: [1, 1], fluidcanner: [1, 1],
  fluidextractor: [1, 1], fluidheater: [1, 1], fluidsolidifier: [1, 1], hammer: [1, 1], laserengraver: [[2, 2, 2, 4, 4], 1], lathe: [1, 2],
  macerator: [1, [1, 1, 2, 3, 4]], microwave: [1, 1], mixer: [[6, 6, 6, 9, 9], [1, 1, 4, 4, 4]], orewasher: [1, 3],
  plasmaarcfurnace: [2, [4, 4, 4, 9, 9]], polarizer: [1, 1], press: [[2, 2, 4, 4, 6], 1], printer: [1, 1], recycler: [1, 1], sifter: [1, 9],
  thermalcentrifuge: [1, 3], unboxinator: [1, 2], wiremill: [2, 1],
} as const;
```

  `basicSlots`: exported counts when both `itemInSlots` and `itemOutSlots` are numbers; else the kind from `/^basicmachine\.([a-z_]+)\.tier\.\d+$/` and the value at `min(tier, 5) − 1` (tier ≥ 1); else `null` (a steam machine's `bronzemachine.*` and `hpmachine.*` names among them: its slots come from its recipes, Task 2). `ignoredByBlocking` (E12): the key's id in `BLOCKING_IGNORED.ids` (registered as items, every meta: `gregtech:gt.integrated_circuit`, `bartworks:gt.bwMetaGeneratedlens`, `TwilightForest:item.trophy`), the key in `BLOCKING_IGNORED.keys` (`gregtech:gt.metaitem.01` metas 32301–32331, 32350–32377, 32398–32399, and the exact keys E12 lists: the Wood's Glass Lens, the four NH lenses, AE2's presses 13, 14, 15, 19 and 21, the nine blood orbs, the Division Sigil), or `pack.items.get(key)?.gt?.prefix === 'lens'` (GT's lenses, `ProcessingLens`); GT++'s Special lens has no export key and is not listed (a machine holding it raises R9's `feed_starved`: open question 13). `conveyorOp` by the cover's meta 32630–32636 (E10). `eioMaxExtracted(u) = ITEM_CONDUIT.baseExtract + ITEM_CONDUIT.perUpgrade × min(u, ITEM_CONDUIT.maxUpgrades)`. `eioDeficit(n, max) = Math.round(Math.fround(n * Math.fround(10 / max)))` — Java's float arithmetic, as the bytecode does it (E5): keep the `Math.fround`s, which the test's 3-of-12 case pins. `prTravelTicks(hops, p) = ⌈(hops + 1) × 100 / boost⌉` with boosts in hundredths `wandering 5, default 10, terminated 5, passive 20, active_broadcast 30, active_craft 30` (E6: a payload covers hops + 1 pipe lengths from its dispatch; Java's float sums of the boost give the same ticks for every hop count the tests use). `stockKeeperDelay(i) = 100 + min(10 i, 1200)`. `benchEnergyCap(t) = max(2048, V[t] × t × V[t])` (`V` from `src/shared/gt/tiers.ts`, E4). `INPUT_SEPARATION_DEFAULT` (E15, read from the GT jar's bytecode: the controllers whose `supportsInputSeparation()` resolves to true):

```ts
export const INPUT_SEPARATION_DEFAULT: ReadonlySet<string> = new Set([
  'MTEAdvEBF', 'MTEAdvImplosionCompressor', 'MTEAlloyBlastSmelter', 'MTEAmazonPackagerLegacy', 'MTEAutoCrafter',
  'MTEBECIONode', 'MTEBeamCrafter', 'MTEComponentAssemblyLine', 'MTECryogenicFreezer', 'MTEDEFusionCrafter',
  'MTEDigester', 'MTEDissolutionTank', 'MTEElectricBlastFurnace', 'MTEEndothermicFridge', 'MTEEntropicProcessor',
  'MTEExoFoundry', 'MTEExothermicHearth', 'MTEExoticModule', 'MTEFrothFlotationCell', 'MTEHIPCompressor',
  'MTEIndustrialArcFurnace', 'MTEIndustrialBendingMachine', 'MTEIndustrialBrewery', 'MTEIndustrialCentrifuge',
  'MTEIndustrialChemicalBath', 'MTEIndustrialChisel', 'MTEIndustrialCokeOven', 'MTEIndustrialCompressor',
  'MTEIndustrialCuttingMachine', 'MTEIndustrialElectrolyzer', 'MTEIndustrialElectromagneticSeparator',
  'MTEIndustrialExtractor', 'MTEIndustrialExtruder', 'MTEIndustrialForgeHammer', 'MTEIndustrialFormingPress',
  'MTEIndustrialLaserEngraver', 'MTEIndustrialMixer', 'MTEIndustrialMixerLegacy', 'MTEIndustrialMolecularTransformer',
  'MTEIndustrialPackager', 'MTEIndustrialRockBreaker', 'MTEIndustrialSifter', 'MTEIndustrialThermalCentrifuge',
  'MTEIndustrialWireMill', 'MTEIndustrialWireMillLegacy', 'MTELatex', 'MTEMassSolidifier', 'MTEMegaAlloyBlastSmelter',
  'MTEMegaBlastFurnaceLegacy', 'MTEMegaChemicalReactor', 'MTEMegaChemicalReactorLegacy', 'MTEMegaDistillationTower',
  'MTEMoltenModule', 'MTEMultiAutoclave', 'MTEMultiCanner', 'MTEMultiLathe', 'MTENanoForge', 'MTENeutroniumCompressor',
  'MTENuclearSaltProcessingPlant', 'MTEOreWashingPlant', 'MTEPCBFactory', 'MTEPlasmaModule', 'MTEPyrolyseOven',
  'MTEPyrolyseOvenLegacy', 'MTEQuantumForceTransformer', 'MTESmeltingModule', 'MTESolarFactory', 'MTESpinmatron',
  'MTEThermalBoiler',
]);
```

- `feedPack` as the Produces line says; machines through the fixture's own `Machine` shape (copy `gtMachine`'s fields: `itemKey` `gregtech:gt.blockmachines@<mteId>`, its item added to `pack.items`).

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding/facts.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding/contract.ts src/server/layout/feeding/facts.ts tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/facts.test.ts
git commit -m "feat(feeding): contract, codes and game facts for the feeding checker

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Reading a line

**Files:**
- Create: `src/server/layout/feeding/model.ts`, `src/server/layout/feeding/frame.ts`, `src/server/layout/feeding/read.ts`, `src/server/layout/feeding/read-networks.ts`; extend `tests/helpers/feeding-fixtures.ts`
- Test: `tests/unit/layout/feeding/read.test.ts`

**Interfaces:**
- Consumes: Task 1's contract and facts; `stepItemInputs`, `stepItemOutputs` (`src/server/layout/modes/mode.ts`); `busSlots` (`src/server/layout/parts.ts`); `manualReasonOf` (`src/server/layout/multiblock-rules.ts`, E17); `FACES`, `OPPOSITE`, `rotateFacing`, `rotatedSize`, `toWorld`, `posKey` (shared); `layoutLine`, `emptyScan` (`src/server/layout/layout.ts`), `makePlan`, `makeProject`, `IDS`, `EBF_STRUCTURE` (layout fixtures), `lineScan`, `lineGround` (`tests/helpers/enderio-fixtures.ts`) in tests.
- Produces (`model.ts`; local positions and sides are the line's own frame, `pos` the world cell):

```ts
export type NodeId = string;                                  // `${x},${y},${z}` of the local cell
export interface SimRecipe {
  stepId: string; ticks: number;                              // the plan step's durationTicks, at least 1
  inputs: Array<{ key: StuffKey; amount: number; chance: number }>;   // consumed items per run (chance = probability consumed)
  held: StuffKey[];                                           // not consumed, not a programmed circuit: each sits in an input slot
  outputs: Array<{ key: StuffKey; amount: number; chance: number }>;  // item outputs in recipe order (output i ↔ output slot i)
  fluidsIn: Array<{ key: StuffKey; amount: number }>; fluidsOut: Array<{ key: StuffKey; amount: number }>;
}
export interface MachineSettings { multiStack: boolean | null; inputFilter: boolean | null; inputFromOutputSide: boolean | null; autoOutput: boolean | null }
interface NodeBase {
  id: NodeId; pos: Vec3; local: Vec3; name: string; label: string /* `${name} at x y z` */; stepIds: string[]; recipes: SimRecipe[];
  kinds: StuffKey[];                                          // the item kinds it takes: distinct consumed item keys of its recipes, sorted
}
export interface BasicNode extends NodeBase {
  kind: 'basic'; mteId: number; tier: number; inSlots: number; outSlots: number; outputSide: number; front: number; maps: string[]; settings: MachineSettings;
  steam: boolean;                                             // pack kind `steam` (E17): no cover, no auto-output, AE2 outputs by hand
}
export interface BusNode { id: NodeId; pos: Vec3; local: Vec3; label: string; front: number; slots: number; limited: boolean | null; inputFilter: boolean | null; maps: string[] }
export interface OutBusNode { id: NodeId; pos: Vec3; local: Vec3; label: string; front: number; slots: number; lock: StuffKey | null /* `config.lock` */ }
export interface MultiNode extends NodeBase { kind: 'multi'; mteId: number; inBuses: BusNode[]; outBuses: OutBusNode[]; inputSeparation: boolean | null; separationDefault: boolean }
export interface BenchNode extends NodeBase {
  kind: 'bench'; mteId: number; tier: number; front: number; back: number; grid: Array<StuffKey | null>; result: { key: StuffKey; amount: number };
  containers: Record<StuffKey, StuffKey>; throughput: number;
  fluidSides: number[]; powerSides: number[]; itemPipeSides: number[];   // sides whose neighbour connects toward it (GT6-style, E17)
}
export interface ChestNode { kind: 'chest'; id: NodeId; pos: Vec3; local: Vec3; label: string; side: 'input' | 'output'; keys: StuffKey[] /* an input chest's stocked keys */ }
export type FeedNode = BasicNode | MultiNode | BenchNode | ChestNode;
export interface InvRef { node: NodeId; bus?: NodeId; side: number /* the inventory's own side that faces the network */ }
export interface EioFace {
  id: string /* `${conduit}:${side}` */; conduit: NodeId; side: number; target: InvRef | null; label: string;
  extract?: { color: DyeColor; filter: FeedConduitFilter | null; max: number; roundRobin: boolean; selfFeed: boolean; redstone: RedstoneMode };
  insert?: { color: DyeColor; filter: FeedConduitFilter | null; priority: number };
}
export interface EioNet { kind: 'enderio'; faces: EioFace[]; hops: Record<NodeId, Record<NodeId, number>> }
export interface RoutedPipe { id: NodeId; label: string; chips: RoutedChipSpec[]; target: InvRef | null }
export interface RoutedNet { kind: 'routed'; pipes: RoutedPipe[]; hops: Record<NodeId, Record<NodeId, number>> }
export interface Ae2Iface { id: NodeId; label: string; spec: InterfaceSpec; targets: InvRef[] }
export interface Ae2ExportBus { id: NodeId; label: string; keys: StuffKey[] /* config slots in order */; amount: number /* per operation, E16 */; target: InvRef | null }
export interface Ae2Net { kind: 'ae2'; interfaces: Ae2Iface[]; exportBuses: Ae2ExportBus[] }
export interface GtPipe { id: NodeId; label: string; capacity: number /* stacks per 20 ticks */; links: number /* local bits 1 << side */; sides: Array<{ side: number; target: InvRef }> }
export interface GtPipeNet { kind: 'gtpipe'; pipes: GtPipe[] }
export type FeedNetwork = EioNet | RoutedNet | Ae2Net | GtPipeNet;
export interface GtCover {
  host: NodeId; side: number; kind: 'conveyor' | 'filter' | 'shutter';
  export: boolean; allowInput: boolean; op?: { tickRate: number; stacks: number; items: number }; filter?: ItemFilterSpec;
  shutter?: 'input_only' | 'output_only' | 'open';
}
export interface FeedModel {
  mode: LogisticsMode; nodes: FeedNode[]; networks: FeedNetwork[]; covers: GtCover[];
  supply: StuffKey[]; sinks: StuffKey[];                      // into the line from outside; out of it (sorted)
  planned: Record<string, Record<StuffKey, number>>;          // stepId → item → per second for each machine of the step
  makers: Record<StuffKey, string[]>;                         // laid-out stepIds whose flows carry the item
  laid: string[];                                             // stepIds with at least one machine node, plan order
  fed: Record<string, StuffKey[]>; made: Record<string, StuffKey[]>;   // stepItemInputs / stepItemOutputs of every plan step (text fallbacks only: "takes 2+ kinds" is `node.kinds`)
  itemFlows: PlanFlow[];                                      // the plan's item flows, plan order
  unknowns: FeedUnknown[]; nameOf(key: StuffKey): string; stepName(stepId: string): string;   // main output's name, else the machine's
  mapTakes(map: string, key: StuffKey): boolean;              // some recipe of the map takes the item (GT's containsInput)
  mapPair(map: string, a: StuffKey, b: StuffKey): boolean;    // some recipe of the map takes both
  circuitOre(key: StuffKey): boolean;                         // the item has an ore name starting `circuit`
}
```

- Produces (`frame.ts`): `fromWorld(p: Vec3, layout: Pick<Layout, 'origin' | 'rotation' | 'size'>): Vec3`, `localSide(side: number, rotation: Rotation): number`, `nodeId(local: Vec3): NodeId`, `compareLocal(a: Vec3, b: Vec3): number`.
- Produces (`read.ts`): `readLine(input: { pack: Pack; plan: Plan; layout: Layout }): FeedModel`. (`read-networks.ts`): `readRouted`, `readAe2`, `readEnderio`, `readGtPipes`, `readCovers`, each `(ctx: ReadContext) => …`, `ReadContext` private to the two files.
- Produces (`tests/helpers/feeding-fixtures.ts`): `FeedStep = StepSpec & { ticks?: number; held?: StuffKey[]; chances?: Record<StuffKey, number>; consumeChance?: Record<StuffKey, number>; craft?: { width: number; cells: Array<StuffKey | null> } }`; `feedPlan(steps: FeedStep[], flows?: PlanFlow[], pack?: Pack): { pack: Pack; plan: Plan }` (makePlan with `durationTicks = ticks ?? 20`, flows chained by `makePlan` when not given, the plan step's `inputs` and `outputs` at `amount × chance` — the planner's expected per-run amounts — and a pack recipe per step (added to `pack.recipes`, `recipeById`, `producers` and `consumers`), id = step id, `maps` = the machine's maps, inputs consumed with `consumeChance[key] ?? 1` in the step's order, held items as `consumed: false`, outputs with `chances[key] ?? 1`; with `craft`, a `crafting` recipe instead: `source: 'crafting'`, `maps: ['crafting']`, `flags.shaped`, `meta.width`, one ingredient per non-null cell with `slot` = its index); `chain2()` = `feedPlan([{ id: 's1', mteId: IDS.MACERATOR, count: 2, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] }, { id: 's2', mteId: IDS.ASSEMBLER, tier: 2, count: 1, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] }])` with flows raw → s1 `t:a@0`, s1 → s2 `t:x@0`, s2 → out `t:y@0`, 1/s each; `layFeed(pack, plan, mode, at?: { origin: Vec3; rotation: Rotation }): Promise<Layout>` (no world unless `at`, then `lineScan()` / `lineGround()`).

**Reading rules** (each unknown is `{ code, text, pos?, stepId? }`, at most once per code and block):
1. **Frame.** `fromWorld` inverts `toWorld` with the local size `rotatedSize(layout.size, layout.rotation)`; `localSide` turns a world side back by the rotation (`rotateFacing(side, (360 − r) % 360)`). Every list the model holds is sorted by local position, then local side. Blocks with `role: 'ghost'` or a `hookup` index are not read (the base's own network is outside the line).
2. **Machines.** A `machine` block with a `stepId`: its steps are `stepIds ?? [stepId]`; a step the plan lacks → `step_missing`, the block is skipped (Review Focus 2). Its pack machine by `block.mteId`, else `machine_unknown` and skipped. Class simple name `MTEElectricAutoWorkbench` → `BenchNode`; a machine `manualReasonOf` names (main's rule: the Bricked Blast Furnace, `no_automation`, and the Coke Oven, `own_hatch`; E17) → `hand_run` with the reason, skipped, and its step does not count as laid (rule 9), so what it makes reaches the line as supply, as main lays it (its outputs are in the input chest's `tail.keys`); kind `multiblock` → `MultiNode` with the `hatch` blocks of its step whose class is `MTEHatchInputBus` (`inBuses`) or `MTEHatchOutputBus` (`outBuses`), each with `slots = busSlots(tier)` and `front = localSide(facing)`, an output bus's `lock` from `config.lock` (an item name, resolved as rule 12 resolves chip text; one that resolves to no key or to two gives `text_unread` and a lock no output of the line matches); kind `steam` → `BasicNode` with `steam: true` (E17: GT's basic-machine slot rules, items on its middle-row side, output side up); any other kind → `BasicNode` (`steam: false`). `separationDefault` = the controller's class simple name is in `INPUT_SEPARATION_DEFAULT` (E15: 69 classes, the EBF, the Pyrolyse Oven and GT++'s industrial multiblocks among them; open question 8 keeps the export of `supportsInputSeparation` as the real source).
3. **Slots.** `basicSlots(machine)`; when null (a steam machine's `bronzemachine.*`/`hpmachine.*` name, a CropsNH or GT++ singleblock), `inSlots` = the largest (distinct consumed item keys + held items) and `outSlots` = the largest item output count over its recipes, with `slots_unknown` (Review Focus 3).
4. **Faces.** A singleblock's `outputSide = localSide(facing)` (GT's output side, where every mode's logistics block stands — except at a steam machine, whose output side main turns up while its items are met on its middle-row side, E17) and `front = localSide(mainFacing)` (`front_unknown` and −1 when absent). A bench's `front = localSide(facing)` and `back = OPPOSITE[front]` (research §6.1 item 5).
5. **Kinds and settings.** A node's `kinds` = the distinct item keys its recipes consume (rule 6's `inputs`, held items and the programmed circuit left out), sorted; "takes 2+ item kinds" means `kinds.length ≥ 2` everywhere in this plan (these reading rules, R2, R3, Task 4 rule 11, Task 5 rule 4, Task 11 rule 3, Task 12), whatever item flows the plan carries into the step (`model.fed`, `stepItemInputs`, is used only where a chip's text cannot be read, rule 12; `feedPlan`'s chained flows carry only a step's first input); R1 counts the kinds of each recipe on its own. Settings from `config` (`CONFIG_KEYS`): a boolean, else `null`. Unknowns: `multistack_unset` on a basic machine taking 2+ item kinds without `multiStack`; `limited_unset` on an input bus whose controller takes 2+ item kinds without `limited`; `separation_unset` on a controller with 2+ input buses without `inputSeparation`.
6. **Recipes.** For each step, the pack recipe `step.recipeId`: per item ingredient, the option whose key the step's `inputs` list (else the first); consumed → `{ key, amount, chance }`; not consumed → `held` unless its id is `PART_KEYS.circuitId`; fluid ingredients → `fluidsIn`; item outputs in order with their chances; fluid outputs → `fluidsOut`; same-key consumed inputs of chance 1 are summed. Without the recipe (`recipe_missing`): items from `step.inputs` (amount rounded up, `amount_fraction` when not whole) and `step.outputs` (a whole amount a → `{ a, 1 }`, else `{ ⌈a⌉, a / ⌈a⌉ }`). `ticks = max(1, step.durationTicks)`.
7. **Bench.** `grid` = `feed.bench.grid` (9 cells), else the crafting recipe laid into the grid (shaped: slot s at row ⌊s / width⌋, column s mod width, `recipe.meta.width`; shapeless: cells 0… in slot order) with each cell's option as in rule 6, and `bench_grid_derived`; `result` = the recipe's first output; `containers` from `pack.fluidContainers` (filled → empty) for grid items that have one; `throughput` = `feed.bench.throughput ?? 0` (`bench_mode_unset` without `feed.bench`). GT cables and pipes connect GT6-style in this pack (E17), so a side counts only when the neighbour's `connections` bit points at the bench: `fluidSides` = sides whose neighbour is a GT fluid pipe connected toward it, or a conduit bundle with a fluid conduit face toward it; `powerSides` = sides whose neighbour is a `cable` block connected toward it; `itemPipeSides` = sides whose neighbour is a GT item pipe connected toward it (R10c).
8. **Chests.** `side` from `tail.side`, else `'output'` with `chest_side_unknown`; an input chest's `keys` = the supply keys its `tail.keys` lists (rule 9), an output chest's `[]`.
9. **Supply and sinks.** `laid` = steps with at least one machine node. `supply` = item keys of flows into a laid step from `raw` or from a step not laid; `sinks` = item keys of flows from a laid step to `out`, `sink` or a step not laid, plus each item a laid step's recipes make that no flow carries (a stray). A supply key no input chest's `tail.keys` lists (where there is an input chest) → `supply_not_listed`: the checker supplies it anyway, from the first input chest in local order (its `keys` gain it).
10. **Plan rates.** `planned[stepId][key]` = Σ item flows into the step of that key ÷ `step.count`; `makers[key]` = laid steps with a flow of that key out of them.
11. **Covers** (every mode): a block's `covers` by item key — `conveyorOp(item)` → `conveyor` (`export` = `settings.mode === 'export'`, `allowInput` = `settings.allowInput === true`); `PART_KEYS.itemFilterCover` → `filter` (`export: true`, `filter` from `cover.filter` and `settings.mode`); `PART_KEYS.shutter` → `shutter` (`settings.mode`: `'input_only'`, `'output_only'`, else `'open'`); anything else, or any cover on a steam machine (it takes only primitive covers, E17), → `cover_unknown` and not read. `side = localSide(FACES.indexOf(face))` (cover faces are world faces: `layoutLine` turns them with the line).
12. **Routed** (`readRouted`): cells whose `item` starts `ProjRed|Transportation:projectred.transportation.pipe@`, linked by their `connections`; `hops` = breadth-first pipe distances. A chip pipe's `target` = its linked neighbour that is a node, a bus or a chest (`side` = the inventory's side toward the pipe). `chips` = `feed.chips` (with `text_ignored` when `config.chips` is there too, Review Focus 4), else `config.chips` split on ` + `: `Item Responder Chip (whitelist: …)` → responder, `Item Extractor Chip` alone → extractor with `{ mode: 'whitelist', keys: [] }` and `extractor_new` ("a new Item Extractor Chip is a whitelist with an empty filter, so it extracts nothing", research §2.2), `Item Extractor Chip (whitelist: …)` → extractor, `Item Broadcaster Chip (…)`, `Item Terminator Chip (…)`, `Item Stock Keeper Chip, keep in stock: …` (stock 64 of each name) likewise; names → keys through the names of every item key of the plan's steps and flows (`plan.names`, else `pack.nameOf`), splitting `A, B and C`; a name that resolves to no key, or to two, gives `text_unread`, and the whitelist then is the target's own (a machine's `stepItemInputs` for a responder, `stepItemOutputs` for the others; a chest's `tail.keys`). Each pipe read from text adds `routed_text`.
13. **AE2** (`readAe2`): each `interface` block that is not an ME Export Bus (`block` = `PART_KEYS.meExportBus`, `appliedenergistics2:item.ItemMultiPart` meta 260, which main also lays with role `interface`); `targets` = its six neighbours that are nodes, buses or chests, or, when `feed.interface.targets` is given, the neighbours on those faces, each turned back into the local frame with `localSide(FACES.indexOf(face), rotation)` (world faces, like cover faces). `spec` = `feed.interface`, else from `config`: `patterns` (count), `pattern`, `pattern2` … (add-on 12's keys) each taken from the plan step it was written for — the target machine's k-th step — as `step.inputs` → `step.outputs`, fluids and fractions included (what main writes as text, `amountList` in `ae2.ts`), `blocking = config.blockingMode === true`, `lock: 'none'`, and `ae2_pattern_text`. Each ME Export Bus block outside the hookup (E16; fix/feeding lays one in front of an AE2 step without an encodable pattern, research §3.5) → an `Ae2ExportBus`: `target` = the neighbour on its `facing` side when that is a node, bus or chest, else its one neighbouring node, bus or chest (`export_target_unknown` and `null` with none or several); `keys` = `feed.exportBus.keys`, else `config.exportFilter`'s names resolved as rule 12 resolves chip text (`export_bus_text`; `text_unread` for a name that resolves to no key or two, which is left out); `amount = AE2.exportAmounts[feed.exportBus.cards ?? 0]`.
14. **EnderIO** (`readEnderio`): blocks with `conduits`; the `item` conduit of each, linked by its `connections`; one `EioNet` per linked group; every face whose mode is not `disabled` → `EioFace` with its target (the neighbour on that side), `extract` (`max = eioMaxExtracted(speed?.count ?? 0)`, `selfFeed ?? false`) and `insert` (`priority ?? 0`). A filter whose `item` is the Limited Item Filter without `limits` → `limited_counts_missing` (read as a whitelist of its keys); a Limited filter on an extract side → `eio_limited_extract`.
15. **GT pipes** (`readGtPipes`): cells whose pack machine has kind `item_pipe`; `capacity = itemPipe.stacksPerSecond`; `links` from `connections`; `sides` = linked sides whose neighbour is a node, bus or chest; one `GtPipeNet` per linked group.
16. **Recipe maps**: `mapTakes(map, k)` = some `pack.consumers.get(k)` recipe lists the map; `mapPair(map, a, b)` = some recipe of the map takes both a and b; `circuitOre(k)` = an ore name of `pack.items.get(k)` starts `circuit`. Each lookup is memoized per map and key.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/read.test.ts — the cases below; positions are rotation 0 at origin [0, 64, 0] unless a case says otherwise
import { describe, expect, it } from 'vitest';
import { readLine } from '../../../../src/server/layout/feeding/read.ts';
import { fromWorld } from '../../../../src/server/layout/feeding/frame.ts';
import type { RoutedNet, Ae2Net, EioNet, GtPipeNet, BasicNode } from '../../../../src/server/layout/feeding/model.ts';
import { rotateFace } from '../../../../src/shared/layout/geometry.ts';
import { chain2, feedPlan, layFeed, FEED_IDS } from '../../../helpers/feeding-fixtures.ts';
import { IDS } from '../../../helpers/layout-fixtures.ts';

describe('readLine', () => {
  it('reads a routed line from its chip text', async () => {
    const { pack, plan } = chain2();
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'routed') });
    expect(m.nodes.map((n) => `${n.kind} ${n.id}`)).toEqual(['basic 3,0,1', 'basic 4,0,3', 'basic 5,0,1', 'chest 6,0,1', 'chest 6,0,3']);
    const net = m.networks.find((n): n is RoutedNet => n.kind === 'routed')!;
    expect(net.pipes.find((p) => p.id === '3,0,2')).toMatchObject({
      target: { node: '3,0,1', side: 3 },
      chips: [{ kind: 'responder', filter: { mode: 'whitelist', keys: ['t:a@0'] } }, { kind: 'extractor', filter: { mode: 'whitelist', keys: [] } }],
    });
    expect(net.pipes.find((p) => p.id === '6,1,1')).toMatchObject({ target: { node: '6,0,1', side: 1 }, chips: [{ kind: 'extractor', filter: { mode: 'whitelist', keys: [] } }] });
    expect(net.hops['3,0,2']!['6,1,3']).toBe(5);
    expect(m.unknowns.filter((u) => u.code === 'extractor_new').map((u) => u.pos)).toEqual([[3, 64, 2], [4, 64, 2], [5, 64, 2], [6, 65, 1]]);
    expect([m.supply, m.sinks, m.planned]).toEqual([['t:a@0'], ['t:y@0'], { s1: { 't:a@0': 0.5 }, s2: { 't:x@0': 1 } }]);
    expect((m.nodes[0] as BasicNode)).toMatchObject({ inSlots: 1, outSlots: 1, outputSide: 3, front: 4, settings: { multiStack: null, inputFromOutputSide: true } });
  });
  // and, each its own `it`:
});
```

The other cases of `read.test.ts`, each its own `it` with these assertions:
- *reads AE2 patterns from the plan steps*: `chain2()` in `ae2` → one `Ae2Net` of 3 interfaces, in local order `3,0,2`, `5,0,2`, `7,0,2`; the last has `targets: [{ node: '7,0,1', side: 3 }]` and `spec: { patterns: [{ inputs: [{ key: 't:x@0', amount: 1 }], outputs: [{ key: 't:y@0', amount: 1 }] }], blocking: false, lock: 'none' }`; `m.covers` holds `{ host: '7,0,1', side: 3, kind: 'conveyor', export: true, allowInput: true, op: { tickRate: 100, stacks: 1, items: 16 } }`; one `ae2_pattern_text` per interface; no chest nodes.
- *reads EnderIO faces*: `chain2()` in `enderio` → one `EioNet`; the face `'6,0,2:2'` has `target: { node: '6,0,1', side: 3 }` and `extract: { color: 'red', filter: { whitelist: true, keys: ['t:a@0'] }, max: 4, roundRobin: true, selfFeed: false, redstone: 'ignore' }` (1 item/s needs no speed upgrade); `'3,0,2:2'` and `'3,0,2:3'` (the two macerators) each have `insert: { priority: 1 }` with keys `['t:a@0']` and `extract` keys `['t:x@0']`; `hops['3,0,2']['6,0,2']` is 3.
- *reads machine-to-machine pipes*: `chain2()` in `direct` → one `GtPipeNet` of 4 pipes `3,0,2` … `6,0,2`, capacity 1; pipe `6,0,2` has `sides: [{ side: 2, target: { node: '6,0,1', side: 3 } }, { side: 3, target: { node: '6,0,3', side: 2 } }]`; `m.covers` holds the tail pipe's import conveyor (`host: '6,0,2'`, side 2, `export: false`) and its filter cover (side 3, `filter: { mode: 'whitelist', keys: ['t:y@0'] }`); every machine has `settings.inputFilter: true`.
- *prefers the structured config over the text* (Review Focus 4): the routed `chain2()` layout with the block at `[3, 64, 2]` given `feed: { chips: [{ kind: 'extractor', filter: { mode: 'whitelist', keys: ['t:x@0'] } }] }` (its `config.chips` kept) and the block at `[5, 64, 2]` given `config: { chips: 'Item Responder Chip (whitelist: Nothing Known)' }` → pipe `3,0,2` has exactly the feed's chip, with `text_ignored` at `[3, 64, 2]`; pipe `5,0,2` has a responder whitelisting `['t:x@0']` (the assembler's input), with `text_unread` at `[5, 64, 2]`.
- *reads a rotated line in the local frame* (Review Focus 1): `chain2()` in each mode laid with `at` = `{ origin: [30, 64, 10], rotation: r }` for r = 0, 90, 180, 270 → the lists of `nodes` (`kind`, `id`, and for basic nodes `outputSide`, `front`) and of each network's pipe ids, face ids and interface ids are equal for all four; `fromWorld(n.pos, layout)` equals `n.local` for every node; and in `ae2`, with the assembler's interface given `feed.interface.targets` = `[rotateFace('north', r)]` (the world face toward the assembler, as the writer turns it with the line), its `targets` are `[{ node: '7,0,1', side: 3 }]` in all four.
- *reads a steam machine as a basic machine* (E17): `feedPlan([{ id: 's1', mteId: FEED_IDS.STEAM, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] }, { id: 's2', mteId: IDS.ASSEMBLER, tier: 2, count: 1, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] }], <raw → s1 t:a@0, s1 → s2 t:x@0, s2 → out t:y@0, 1/s each>)` in `routed` → node `1,0,1` is a `BasicNode` with `steam: true`, `outputSide: 1`, `front: 4`, `inSlots: 1`, `outSlots: 1` and `slots_unknown`; the pipe `1,0,2` has `target: { node: '1,0,1', side: 3 }` and the chips `Item Responder Chip (whitelist: Alpha) + Item Extractor Chip`; `supply` is `['t:a@0']` (Ex is made on the line).
- *runs main's hand-run multiblocks by hand* (E17): the same plan with `s1` on `FEED_IDS.COKE` (inputs `t:a@0`) in `routed` → no node for the Coke Oven's block, an unknown `hand_run` at it naming `own_hatch`, `laid` `['s2']`, `supply` `['t:x@0']` (the input chest lists it) and no `supply_not_listed`.
- *reads output bus locks*: the EBF step of the multiblock case in `routed`, its output bus block given `config.lock: 'Ex'` → `outBuses[0].lock` is `'t:x@0'`; given `config.lock: 'Nothing Known'` → a lock no output matches and `text_unread` at the bus.
- *reads an ME Export Bus* (E16): the `ae2` `chain2()` layout with a block `{ id: 'appliedenergistics2:item.ItemMultiPart', meta: 260 }` of role `interface` added at the cell above the first macerator, `config: { exportFilter: 'Alpha' }` → one `Ae2ExportBus` `{ keys: ['t:a@0'], amount: 1, target: { node: '3,0,1', side: 1 } }` with `export_bus_text`, and the three interfaces as before (the bus is not one of them).
- *skips a machine whose step the plan lacks* (Review Focus 2): the routed `chain2()` layout read with a plan without step `s2` → no node `5,0,1`, one unknown `{ code: 'step_missing', pos: [5, 64, 1], stepId: 's2' }`, and readLine does not throw.
- *falls back to the recipes for slots* (Review Focus 3): `feedPlan([{ id: 'q', mteId: FEED_IDS.ODD, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 2]], held: ['t:c@0'], outputs: [['t:x@0', 1]] }])` in `enderio` → its node has `inSlots: 3`, `outSlots: 1`, `recipes[0].held: ['t:c@0']`, and unknown `slots_unknown` for step `q`.
- *reads recipes, chances and circuits*: a step whose recipe has a programmed circuit (`gregtech:gt.integrated_circuit@2`, not consumed), an input consumed by chance 0.5 and an output of chance 0.25 → `inputs` holds the chanced input with `chance: 0.5`, `held` is `[]`, `outputs` the chanced output with `chance: 0.25`; the same step with its pack recipe removed → `outputs` from the plan's expected 0.25 → `{ amount: 1, chance: 0.25 }`, with `recipe_missing`.
- *reads a multiblock and its buses*: `feedPlan([{ id: 'e', mteId: IDS.EBF, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 1]], outputs: [['t:x@0', 1]] }])` in `routed` → a `MultiNode` with `kinds: ['t:a@0', 't:b@0']` (from its recipe, though the chained flows carry only `t:a@0`), one input bus of `slots` `busSlots(<its tier>)`, one output bus (`lock: null`), `separationDefault: true` (`MTEElectricBlastFurnace` is on the list), `inputSeparation: null`, and `limited_unset` for its input bus.
- *reads a bench*: `feedPlan` with a crafting step on `FEED_IDS.BENCH` (shaped 2 × 2 recipe `t:a t:b / t:b t:a` → 1 `t:x`) laid in `enderio`, its machine block given `feed.bench` = `{ mode: 'normal', grid: ['t:a@0', 't:b@0', null, 't:b@0', 't:a@0', null, null, null, null], throughput: 0 }` → a `BenchNode` with that grid, `result: { key: 't:x@0', amount: 1 }`, `back` = OPPOSITE of its `front`, and `powerSides` `[back]`: of the two cables beside it only the one north of it has a connection bit toward it (E17), and main turns the bench's front to the middle row, so north is its back; without `feed.bench` the same grid is derived (`bench_grid_derived`, `bench_mode_unset`).

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/read.test.ts`
Expected: FAIL — cannot find module `src/server/layout/feeding/read.ts`.

- [ ] **Step 3: Implement `model.ts`, `frame.ts`, `read.ts`, `read-networks.ts` and the fixtures by the reading rules**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/read.test.ts
git commit -m "feat(feeding): read a laid-out line into the feeding model, today's text and the structured config alike

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Static pre-check

**Files:**
- Create: `src/server/layout/feeding/precheck.ts`, `src/server/layout/feeding/text.ts`
- Test: `tests/unit/layout/feeding/precheck.test.ts`

**Interfaces:**
- Consumes: Task 2's `FeedModel` and `readLine`; Task 1's `FEED_KINDS`, `ignoredByBlocking`, `stackLimit`, `PART_KEYS`; `fmtInt` (`src/shared/layout/format.ts`).
- Produces: `precheckFeeding(model: FeedModel, pack: Pack): FeedFinding[]` (every finding `phase: 'static'`, `kind` from `FEED_KINDS`, `machine` = the node's label, `pos` its world cell; ordered by node local order, then rule number, then key); `text.ts`: `amountText(n: number): string` (whole numbers with thousands separators, else two decimals, as `mode.ts`'s), `listText(names: readonly string[]): string` (`joinNames`), `slotWord(n: number): string` (`'1 input slot'`, `'2 input slots'`). fix/feeding turns each finding into a layout warning `{ code, text, stepId, key }`.

**The rules** (M = the node's label, names through `model.nameOf`; "push mode" = `direct`, `routed`, `enderio`):

| # | Applies to | Code, certainty | Text |
|---|---|---|---|
| R1 | basic node with table or exported slots; k = most distinct consumed item kinds of one recipe, h = most held items | `feed_crowded` certain when k > inSlots − h | `${M} takes ${k} kinds of item but has ${slotWord(inSlots − h)} free${h > 0 ? ` (${h} held: ${heldNames})` : ''}: one kind always waits` |
| R2 | basic node in a push mode taking 2+ item kinds, `multiStack` not `false` | `feed_crowded`: risk when unset, certain when `true` | unset: `${M} takes ${k} kinds of item and the layout does not set Multi Stack Input Off: with it On, the first kind to arrive fills every free input slot`; true: `${M} has Multi Stack Input On and takes ${k} kinds of item: the first kind to arrive fills every free input slot` |
| R3 | an input bus whose controller takes 2+ item kinds (`kinds`, Task 2 rule 5), `limited` not `true` | `feed_overfill` risk | `${bus} of ${M} takes ${k} kinds of item without Limiting mode: one kind can fill every slot of the bus` |
| R4 | a multiblock with 2+ input buses, Input Separation `inputSeparation ?? separationDefault` | `feed_crowded` risk | `${M} has ${n} input buses with Input Separation on: each bus is checked alone, so a recipe whose items arrive on different buses never starts` |
| R5a | routed: an Extractor Chip on a machine's pipe whose filter does not pass an item the machine makes | `feed_no_route` certain, per item | `Nothing takes ${item} out of ${M}: its Item Extractor Chip ${empty ? 'has an empty whitelist (a new chip extracts nothing)' : 'does not list it'}` |
| R5b | routed: an Extractor Chip whose filter passes an item its machine takes | `feed_starved` risk, per item | `The Item Extractor Chip on ${M} also lists ${item}, which it cannot take back out: each time it tries it first, it gives up the whole update` |
| R5c | routed: an Extractor Chip on an input bus's pipe | `feed_churn` certain | `The Item Extractor Chip on ${bus} pulls ${M}'s inputs back out of its input bus` |
| R5d | routed: a supply item the input chest's chips do not let out | `feed_starved` certain, on each machine that takes it | `${M} never gets ${item}: the Item Extractor Chip on ${chest} ${empty ? 'has an empty whitelist (a new chip extracts nothing)' : 'does not list it'}` |
| R6 | routed: an item a laid step makes with a flow out of it that no responder, terminator, overflow responder or stock keeper of the network takes | `feed_no_route` certain | `Nothing on the routed network takes ${item} from ${M}: no Item Responder Chip lists it${toUnlaid ? ` (it goes to ${stepName}, which has no machine)` : ''}` |
| R7 | routed: a Broadcaster Chip that is not a whitelist of its machine's outputs | `feed_starved` risk | `The Item Broadcaster Chip on ${M} offers its inputs too: an order for one of them fails and is dropped` |
| R8a | AE2: a pattern listing a fluid | `feed_pattern_unencodable` certain | input: `The pattern for ${M} lists ${fluid}, a fluid the line pipes: ME never holds it, so AE2 cannot plan with it`; output: `The pattern for ${M} makes ${fluid}, which the line pipes away: it never comes back to ME` |
| R8b | AE2: a pattern amount that is not whole | `feed_pattern_unencodable` certain | `The pattern for ${M} holds ${amountText(a)}× ${item}: a pattern holds whole items` |
| R8c | AE2: a pattern input that is a held item or a programmed circuit | `feed_pattern_unencodable` certain | `The pattern for ${M} lists ${item}, which ${M} keeps and does not use up` |
| R8d | AE2: a plain interface (`dual` not true) whose pattern lists a fluid input | `feed_fluid_packet` risk | `${iface} turns ${fluid} into a Fluid Packet item, which ${M} can take into an input slot for good` |
| R9 | AE2: blocking on toward a basic machine holding an item `ignoredByBlocking` is false for, or toward a bench | `feed_starved` certain | machine: `${iface} has blocking mode on and ${M} holds ${held}, which blocking mode does not ignore: it never pushes into it`; bench: `${iface} has blocking mode on and ${M}'s crafting grid counts as items: it never pushes into it` |
| R10a | bench: its insert side is not capped for its mode (EnderIO: no Limited Item Filter listing every grid item; routed: an Item Responder Chip, or no Stock Keeper; AE2: no Locking Card on "Until crafting result is returned") | `feed_overfill` certain (AE2: risk) | EnderIO: `${M} takes its ingredients through a ${filterName}, which does not cap amounts: one ingredient can fill all nine input slots`; routed: `${M} is fed by an Item Responder Chip, which answers with the room of all nine input slots`; AE2: `${iface} has no Locking Card: a pattern that differs from ${M}'s grid pushes the whole job into it` |
| R10b | bench: a stock out of research §3.6's bounds (EnderIO `limit − grid cells`, routed Stock Keeper counts): s < a or s > stack size, or Σ ⌈s / stack⌉ > 8 | `feed_overfill` risk | `${M} keeps ${s}× ${item} for ${a} a craft: …` with `less than one craft` / `more than a stack` / `its stock needs ${n} input slots, more than 8, so a failed craft throws out its last input slot` |
| R10c | bench: no logistics block on its back; its only connected cable on its back (`powerSides` = `[back]`, GT6-style connections, E17); a fluid face (`fluidSides`); a GT tool in a grid cell; a GT item pipe connected toward it (`itemPipeSides`) | `feed_bench_stuck` certain; `feed_starved` certain; `feed_overfill` risk; `feed_bench_stuck` certain; `feed_overfill` certain | `${M}'s back, where it puts out its result, does not touch the line's logistics`; `${M}'s only power cable touches its back, which takes no EU`; `${M} has a fluid ${pipe or conduit} on its ${side}: its tank takes any fluid and fills containers into its input slots`; `${M}'s grid holds ${tool}: a GT tool wears with each craft and stops matching the grid after one (use a single-use tool)`; `A GT item pipe touches ${M}: it fills all nine input slots with whatever it carries` |
| R11 | a node of 2+ steps (`stepIds`) | `feed_pool_starve`: certain in a push mode; risk on AE2 when an interface toward it has blocking off | push: `${M} runs ${n} recipes in ${mode name}: it reruns its last recipe while that recipe's output waits, so ${other step names} can starve`; AE2: `${M} runs ${n} recipes and ${iface} has blocking mode off: it mixes the recipes' sets` |
| R12 | AE2: an interface with 2+ targets | `feed_leak` risk | `${iface} pushes into ${n} inventories (${names}): its pattern's items can reach the wrong one` |

Mode names in R11: `machine-to-machine`, `Project Red`, `EnderIO`. R10a's filter names: Basic, Advanced or Big Item Filter by the filter's `item`.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/precheck.test.ts
import { describe, expect, it } from 'vitest';
import { precheckFeeding } from '../../../../src/server/layout/feeding/precheck.ts';
import { readLine } from '../../../../src/server/layout/feeding/read.ts';
import { chain2, feedPlan, layFeed, FEED_IDS } from '../../../helpers/feeding-fixtures.ts';
import { IDS } from '../../../helpers/layout-fixtures.ts';

const brief = (f: { code: string; certainty: string; key?: string; machine: string }) => `${f.code} ${f.certainty} ${f.key ?? '-'} ${f.machine}`;

describe('precheckFeeding', () => {
  it('finds today\'s routed lines move nothing', async () => {
    const { pack, plan } = chain2();
    const m = readLine({ pack, plan, layout: await layFeed(pack, plan, 'routed') });
    // node order, then rule order (R5a before R5d)
    expect(precheckFeeding(m, pack).map(brief)).toEqual([
      'feed_no_route certain t:x@0 Basic Macerator at 3 64 1', 'feed_starved certain t:a@0 Basic Macerator at 3 64 1',
      'feed_no_route certain t:x@0 Basic Macerator at 4 64 3', 'feed_starved certain t:a@0 Basic Macerator at 4 64 3',
      'feed_no_route certain t:y@0 Advanced Assembler at 5 64 1',
    ]);
    expect(precheckFeeding(m, pack)[0]!.text).toBe('Nothing takes Ex out of Basic Macerator at 3 64 1: its Item Extractor Chip has an empty whitelist (a new chip extracts nothing)');
    expect(precheckFeeding(m, pack)[1]!.text).toBe('Basic Macerator at 3 64 1 never gets Alpha: the Item Extractor Chip on Chest (input) at 6 64 1 has an empty whitelist (a new chip extracts nothing)');
  });
  // and the cases below
});
```

The other cases of `precheck.test.ts`:
- *counts kinds against free slots* (R1): `feedPlan([{ id: 'big', mteId: IDS.ASSEMBLER, tier: 2, count: 1, inputs: <10 keys t:k0@0 … t:k9@0, 1 each> }])` in `enderio` → one `feed_crowded` certain with text `` `${label} takes 10 kinds of item but has 9 input slots free: one kind always waits` `` (label from the model's node); `feedPlan([{ id: 'sm', mteId: FEED_IDS.SMELTER, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 4]], held: ['t:c@0'], outputs: [['t:x@0', 1]] }])` → `` `${label} takes 2 kinds of item but has 1 input slot free (1 held: Gamma): one kind always waits` ``.
- *skips the slot rule where slots are unknown* (Review Focus 3): `FEED_IDS.ODD` taking 3 kinds → no R1 finding, and the R2 risk still raised.
- *flags Multi Stack Input left to chance* (R2): the smelter step (no held item) in `enderio` → one `feed_crowded` risk (the unset text); the same layout with `config.multiStack: false` on the smelter block → none; with `multiStack: true` → certain with the "has Multi Stack Input On" text; in `ae2` → none.
- *flags buses without Limiting mode* (R3): the EBF step of Task 2 in `enderio` → one `feed_overfill` risk naming its input bus; with `config.limited: true` on the bus block → none.
- *finds items with nowhere to go* (R6): `feedPlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1]] }, { id: 'h', mteId: -1, count: 1, handCraft: true, inputs: [['t:x@0', 1]], outputs: [['t:y@0', 1]] }])` in `routed`, the macerator pipe given `feed.chips` = a responder for `t:a@0` and an extractor whitelisting `t:x@0`, the input chest pipe an extractor whitelisting `t:a@0` → exactly one finding, `feed_no_route` certain `t:x@0` whose text ends `(it goes to Why, which has no machine)`.
- *flags input-bus extractors and blacklist chips* (R5b, R5c, R7): the routed EBF line (today's text: its input bus pipe has a responder and an extractor) → `feed_churn` certain on the EBF; a macerator pipe with `feed.chips` = `[{ kind: 'extractor', filter: { mode: 'blacklist', keys: [] } }, { kind: 'broadcaster', filter: { mode: 'blacklist', keys: [] } }]` → `feed_starved` risk `t:a@0` (R5b) and `feed_starved` risk (R7).
- *finds patterns AE2 cannot encode* (R8): `feedPlan([{ id: 'f', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], held: ['gregtech:gt.metaitem.01@32301'], outputs: [['t:x@0', 1]] }])` in `ae2` → `feed_pattern_unencodable` certain with text `` `The pattern for ${label} lists Molten Iron, a fluid the line pipes: ME never holds it, so AE2 cannot plan with it` `` and `feed_fluid_packet` risk; `feedPlan([{ id: 'c', mteId: IDS.MACERATOR, count: 1, inputs: [['t:a@0', 1]], outputs: [['t:x@0', 1], ['t:y@0', 1]], chances: { 't:y@0': 0.5 } }])` (the plan step's expected output 0.5) in `ae2` → `` `The pattern for ${label} holds 0.50× Why: a pattern holds whole items` ``.
- *knows what blocking mode skips* (R9): the solidifier step in `ae2` with its interface given `feed.interface` = `{ patterns: [{ inputs: [], outputs: [{ key: 't:x@0', amount: 1 }] }], blocking: true }` → no R9 finding (mold 32301 is ignored); the same with `held: ['t:mold@0']` → `feed_starved` certain naming `t:mold@0`'s name.
- *checks a bench's cap and faces* (R10): the bench step of Task 2 in `enderio` with today's faces → `feed_overfill` certain (`... through a Basic Item Filter, which does not cap amounts: ...`), `feed_bench_stuck` certain (its back does not touch the logistics: today's layout turns its front, `facing`, to the middle row) and `feed_starved` certain with the power text (main lays the bench like a basic machine: the only cable whose connection bit points at it is the one north of it, on its back; the cable west of it runs north–south past it, E17); the same bench block given `facing` away from the middle row (so the north cable is on its front) and its conduit face's insert filter `{ item: 'EnderIO:itemLimitedItemFilter@0', whitelist: true, keys: ['t:a@0', 't:b@0'], limits: [{ key: 't:a@0', count: 6 }, { key: 't:b@0', count: 6 }] }` → no R10a or R10c finding; with `'gregtech:gt.metatool.01@170'` in grid cell 8 → `feed_bench_stuck` certain (the tool text).
- *flags shared machines outside AE2* (R11): `feedPlan` with steps `p1` and `p2` on `IDS.MACERATOR` laid in `routed`, the `p1` machine block given `stepIds: ['p1', 'p2']` and the `p2` block removed → `feed_pool_starve` certain; the same in `ae2` (blocking off) → risk.
- *flags an interface touching two inventories* (R12): the `ae2` `chain2()` layout with a chest block added at the cell above the assembler's interface → `feed_leak` risk.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/precheck.test.ts`
Expected: FAIL — cannot find module `src/server/layout/feeding/precheck.ts`.

- [ ] **Step 3: Implement `precheckFeeding` and `text.ts` by the rule table**

Which network touches a node comes from the model's networks (an EnderIO face, routed pipe, ME interface, ME Export Bus or GT pipe side whose `target.node` is the node). A node "takes 2+ item kinds" when `node.kinds.length ≥ 2` (Task 2 rule 5): the recipe decides, not the plan's flows, so `feedPlan`'s chained flows (one raw flow, for the first input) do not hide a second kind. R6's "takes": a responder, terminator or overflow responder whose filter passes the item and whose target is not the maker, or a stock keeper listing it.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding/precheck.ts src/server/layout/feeding/text.ts tests/unit/layout/feeding/precheck.test.ts
git commit -m "feat(feeding): static feeding rules for slots, Multi Stack, buses, chips, patterns, benches and shared machines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Simulation core and the GT basic machine

**Files:**
- Create: `src/server/layout/feeding/sim/core.ts`, `sim/machine.ts`, `sim/covers.ts`, `sim/storage.ts`, `sim/detect.ts`, `sim/run.ts`; extend `tests/helpers/feeding-fixtures.ts`
- Test: `tests/unit/layout/feeding/machine.test.ts`

**Interfaces:**
- Consumes: Tasks 1–2 (`FeedModel`, nodes, `GtCover`, `stackLimit`, the time constants); Task 3's `text.ts`.
- Produces (`sim/core.ts`):

```ts
export class KeyTable { constructor(keys: Iterable<StuffKey>); id(key: StuffKey): number; key(id: number): StuffKey; get size(): number }   // ids in sorted key order
export interface Stack { key: number; count: number }
/** One inventory as the networks see it (ISidedInventory); sides are the inventory's own local sides. */
export interface SimInv {
  readonly id: string; readonly label: string;
  slotCount(): number; stack(slot: number): Readonly<Stack> | null; sideSlots(side: number): readonly number[];
  canInsert(slot: number, key: number, side: number): boolean; canExtract(slot: number, key: number, side: number): boolean;
  insert(slot: number, key: number, n: number, by: SimEntity | null): number;   // at most what fits the stack limit; marks the change
  extract(slot: number, n: number, by: SimEntity | null): number;
  countAll(key: number): number;          // every slot, ghost slots included (EnderIO's Limited filter)
  countsAsEmpty(): boolean;               // AE2 blocking: nothing in its IO slots that ignoredByBlocking does not cover
}
/** Something a GT transfer (cover, output bus, bench, auto-output) can push into: a pipe, a conduit face, an ME interface. */
export interface PushTarget { accept(key: number, n: number, side: number, by: SimEntity | null): number }
/** A GT transfer (E4): walks `slots` in order, skips a stack `into` takes none of, moves up to `items` of each of at most `stacks` stacks. */
export function gtTransfer(from: SimInv, slots: readonly number[], side: number, into: PushTarget | SimInv, intoSide: number, stacks: number, items: number,
  by: SimEntity | null, accept?: (key: number) => boolean): number;
export function insertOneEmpty(inv: SimInv, key: number, n: number, side: number, by: SimEntity | null): number;   // EnderCore ItemUtil.doInsertItem
export function insertEmpties(inv: SimInv, key: number, n: number, side: number, by: SimEntity | null): number;   // gtnhlib sinks, PR injectItem
export function roomFor(inv: SimInv, key: number, side: number): number;                                          // PR getSpaceForItem
export const NEVER = Number.POSITIVE_INFINITY;
export interface SimEntity { readonly phase: number; readonly order: number; tick(t: number): number }   // returns the next tick it must run
export class Sim {
  constructor(ticks: number, exhaustive: boolean);
  readonly ticks: number; t: number;
  add(e: SimEntity, firstTick: number): void;
  wake(e: SimEntity, by: SimEntity | null): void;           // run e this tick if it comes after `by` in this tick's order, else next tick
  wakeAt(e: SimEntity, tick: number): void;
  run(endOfTick?: (t: number) => void): void;
}
export const PHASE = { feed: 0, power: 1, tile: 2, conduits: 3, grid: 4, arrivals: 5 } as const;
```

- Produces (`sim/machine.ts`): `class BasicMachine implements SimInv, SimEntity` built by `basicMachine(node: BasicNode, env: SimEnv): BasicMachine`; `SimEnv = { sim: Sim; keys: KeyTable; stats: SimStats; scenario: ScenarioName; model: FeedModel; push: (from: NodeId, side: number) => PushTarget | SimInv | null; fastSteps: ReadonlySet<string>; heldBack: ReadonlySet<StuffKey>; heldUntil: number; loadedAt: number /* 0, then restartAt */ }` and `aTick(env, t) = t − env.loadedAt + 1` (rule 3a).
- Produces (`sim/storage.ts`): `inputChest(node, env)`, `outputChest(node, env)`. (`sim/covers.ts`): `coverTicks(host: SimInv & SimEntity, covers: GtCover[], env: SimEnv): (t: number) => void`, called first in every host's tick (machines here; buses, benches and pipes in later tasks).
- Produces (`sim/detect.ts`): `class SimStats` with `delivered(node, key, n, t)`, `extracted(node, key, n, t)`, `waiting(node, recipe, missing: number[], crowdedBy: number | null, t)`, `started(node, recipe, t)`, `blocked(node, recipe, t)`, `occupancy(node, key, slots, t)`, `arrived(chest, key, n, t)`, `spilled(node, key, n, t)` (items a conveyor or auto-output dropped into the world), the readers `spilledTotal(node)`, `arrivals(chest: NodeId): Array<[tick: number, key: StuffKey, count: number]>` (in order) and `final(node): Array<[StuffKey, number] | null>` (slot contents at the end), and the counters later tasks add; `detect(model: FeedModel, stats: SimStats, run: { scenario: ScenarioName; ticks: number; explain: Explain }): FeedFinding[]`; `type Explain = (kind: 'in' | 'out', node: NodeId, key: StuffKey) => string | null` (a network's reason, or null).
- Produces (`sim/run.ts`): `runScenario(model: FeedModel, scenario: ScenarioName, opts: { ticks: number; restartAt: number; exhaustive?: boolean; ae2Coprocessors?: number; ae2FluidStock?: boolean; slowTolerance?: number; extra?: (env: SimEnv) => SimEntity[]; initial?: Record<NodeId, Array<[slot: number, key: StuffKey, count: number]>> /* tests only: contents at tick 0 */ }): ScenarioRun` with `ScenarioRun = { name: ScenarioName; ticks: number; findings: FeedFinding[]; stats: SimStats; runs: Record<string, number>; out: Record<StuffKey, number> }`; `NETWORK_MODELS: Partial<Record<FeedNetwork['kind'], (net, env) => { entities: SimEntity[]; explain: Explain; receivers: Array<{ at: NodeId; side: number; target: PushTarget }>; restart?: () => void }>>`, empty here and filled by Tasks 7–10; `env.push(from, side)` resolves to the receiver registered at the neighbouring cell for that side, else the neighbouring node's (or bus's) `SimInv`, else null.
- Produces (fixtures): `handModel(nodes: FeedNode[], more?: Partial<FeedModel>): FeedModel`; `smelterNode(over?: Partial<BasicNode>): BasicNode` (FEED_IDS.SMELTER at local 0,0,0: inSlots 2, outSlots 1, outputSide 3, front 4, recipe `sm`: 1 `t:a@0` + 4 `t:b@0` → 1 `t:c@0`, 100 ticks); `feeder(env, target: NodeId, side: number, keys: StuffKey[], n: number, every: number, from?: number): SimEntity` (phase `feed`: at each due tick offers n of each key in turn by `insertEmpties`); `taker(env, target, side, n, at: number[]): SimEntity` (extracts n from the first output slot at the given ticks); `oneSlotNode(id: NodeId, over?: Partial<BasicNode>): BasicNode` (one input and one output slot, `outputSide` 3, `front` 4, recipe `one`: 1 `t:a@0` → 1 `t:x@0`, 20 ticks); `sinkNode(id: NodeId, inSlots: number, side = 2): BasicNode` (step `n`, `outputSide` = side, `front` 4, one recipe needing `t:z@0`, which never comes, so it never runs); `inputChestNode(id: NodeId, keys: StuffKey[]): ChestNode` (its `keys`; `model.supply` gets them too); `outputChestNode(id: NodeId): ChestNode`; `hvExport(host: NodeId, side: number): GtCover` (`op` `{ tickRate: 20, stacks: 1, items: 64 }`).

**Engine rules** (`Sim`):
1. One step is one tick. Each tick runs the due entities sorted by `(phase, order)`; `order` is the entity's index in the model's local-position order (a node, a pipe, a face …), so the order is the same in every rotation. Phases: `feed` (test feeders), `power` (bench energy), `tile` (every block that is a tile entity: GT machines with their covers, buses, controllers, benches, chests, GT pipes, routed pipes with their chips, ME interfaces), `conduits` (EnderIO networks), `grid` (the AE2 crafting CPU), `arrivals` (routed payloads reaching their pipe).
2. An entity returns the next tick it must run; it is also run earlier when `wake` is called. `wake(e, by)` schedules e for the current tick when `(e.phase, e.order)` comes after `by`'s, else for the next tick — exactly when GT would see `hasInventoryBeenModified` (set by the change, cleared at the end of the owner's own tick, E1). Every `SimInv.insert`/`extract` sets the inventory's changed flag and wakes its owner.
3. `exhaustive: true` runs every entity on every tick in the same order; every test that has a scheduled run also has an exhaustive one, and the two give deep-equal stats and findings (the scheduler must never change a result).
3a. **Tile timers** (Global Constraints; E1, E3, E9): `env.loadedAt` is 0, and `restartAt` from the start of that tick in `restart`; a GT tile's `aTick` is `t − loadedAt + 1`. A basic machine's periodic check and auto-output test `aTick % 600 === 0`, an output bus pushes when `aTick % 8 === 0`, a GT pipe checks when `aTick % 10 === 0` (Task 10). A cover acts when `t − loadedAt ≥ 10` and `(t − loadedAt) % tickRate === 0` (the server's counter taken from the same load).

**Inventory rules:**
4. `insertOneEmpty`: over `sideSlots(side)` in order, fill stacks of the key that `canInsert` up to `stackLimit`, then put the rest into the first empty slot that `canInsert`, and stop (E5). `insertEmpties`: the same merge pass, then every empty slot that `canInsert`, in order, until done (research §2.3, §2.2). `roomFor`: Σ over `sideSlots(side)` of `stackLimit` for each empty slot that `canInsert` and `stackLimit − count` for each stack of the key (research §2.2). `gtTransfer` (E4, every GT transfer: covers, auto-output, output buses, the bench, GT pipes): over the given source slots in order, a slot whose stack `canExtract` refuses, `accept` refuses or the target takes none of (`insertEmpties` into a `SimInv` from `intoSide`, `accept` of a `PushTarget`) is skipped; from the others it moves up to `items` each, until `stacks` slots have moved something.

**GT basic machine** (`BasicMachine`; slots 0 … inSlots − 1 are inputs, then outSlots outputs; held items stand in input slots 0, 1, … at tick 0, one each):
5. `sideSlots(s)` = every input and output slot. `canInsert(slot, k, s)`: s is not `front`; slot is an input; s is not `outputSide` unless `inputFromOutputSide !== false`; the cover on s (from `model.covers`) lets items in; the slot is empty or holds k below its limit; Multi Stack — Off (`settings.multiStack !== true`, except that `null` counts as On in `multistack_on`): when some input slot holds k, only that slot; Input Filter (`settings.inputFilter === true`) by E2's slot-count rule, through `model.mapTakes(map, k)` and `model.mapPair(map, a, b)` over `node.maps`. `canExtract(slot, k, s)`: s is not `front`, slot is an output, the cover on s lets items out. A conveyor lets items in when `!export || allowInput` and out when `export || allowInput` (E10); a filter cover both ways (E9); a shutter in for `input_only`, out for `output_only`, both for `open`. A steam node (`steam: true`) has no covers (Task 2 rule 11) and never auto-outputs (`doesAutoOutput` is false, E17).
5a. **Covers act** (`sim/covers.ts`, `coverTicks`) in their host's tile tick, before the host's own update, when rule 3a lets them (an Item Filter cover's tick rate is 1), E9–E10. An export conveyor moves, by `gtTransfer`, up to `stacks` stacks of up to `items` items from the host's extractable slots (`canExtract` from its side), in slot order, skipping refused stacks, into what `env.push(host, side)` returns (a node — through `insertEmpties` from the node's side facing the host — or a `PushTarget`: a pipe, a conduit face, an ME interface); an import conveyor moves them from the neighbour's extractable slots into the host. An Item Filter cover moves up to 64 stacks of up to 64 items each of its filter's items out of the host the same way. A shutter moves nothing. Where `env.push` returns null (no inventory at that side: air, a routed pipe, a cable), an export conveyor drops what it moves into the world (`dropItems`, E10: `stats.spilled`, lost to the line, with unknown `items_dropped`, once per host and key) and an Item Filter cover moves nothing.
6. Each tick the machine runs (E1): (a) a run in progress counts a tick; on its last tick each output i (its rolled amount) goes into output slot i, i + 1, … mod outSlots, the first that is empty or holds the item with room for all of it; (b) with `autoOutput === true` (never on a steam node), when a run just ended, `outputBlocked % 300 === 1`, the inventory changed, or `aTick % 600 === 0` (rule 3a), `gtTransfer` pushes up to outSlots stacks of up to 64 out of `outputSide` into `env.push(id, outputSide)`, skipping refused stacks; with nothing there it drops them into the world (`dropItems`, E1: `stats.spilled`, unknown `items_dropped`); (c) `outputBlocked` resets to 0 when every output slot is empty, else grows by 1 while not 0; (d) when idle and (a run just ended, or the inventory changed since its last tick, or `aTick % 600 === 0`), it looks for a recipe: the cached recipe when its inputs and held items are present, else the first of its recipes (in `stepIds` order) whose are; none → `stats.waiting` for the cached recipe, else the first, with its missing keys and, when some missing key cannot enter (no input slot `canInsert`s it from `outputSide`), `crowdedBy` = the kind that holds the most input slots (ties: the lowest slot), the finding naming the first such key in key order; a found recipe becomes the cached one, and when `canOutput` fails (output slot i non-empty and another item, or without room for output i's full amount) it counts `outputBlocked` and stops — it never tries another recipe; else it takes the inputs (each from the input slots in slot order, lowest first [jar: `GTRecipe.consumeInput`]), rolls the outputs and starts. A run lasts `ticks`, or `max(1, ⌈ticks / FAST_FACTOR⌉)` when its step is in `env.fastSteps`; a machine whose recipe makes a key in `env.heldBack` starts no run before `env.heldUntil` (both are empty outside `fast_supplier` and `late_input`, Task 11).
7. Chances (Review Focus 5) are deterministic accumulators per machine and item: a run adds `amount × chance` and yields `⌊total⌋ − ⌊total before⌋`; consumption by chance likewise (the full amount must still be present to start). Nothing fractional ever enters a slot.
7a. Fluids are not routed, but they are counted: a fluid some laid step makes (`model.makers`) is one pool per fluid key for the whole line — a run's fluid outputs go into it when the run ends, a run takes its fluid inputs out of it when it starts and the machine waits while the pool lacks them (`stats.waiting` with the fluid key, never `crowdedBy`); every other fluid (one the line takes from outside) is always there. So a step fed by a piped fluid runs only as fast as the fluid's maker.
8. Next tick: a running machine is due on its last tick; an idle one at the next tick with `aTick % 600 === 0`; a change wakes it (rule 2). With `autoOutput === true` it runs every tick.

**Chests** (a vanilla chest, `CHEST_SLOTS` = 27; research §7's "chests as unlimited" would hide a chest that fills):
9. Every chest has 27 slots, takes what any network pushes into it on any side (a cover or a face may refuse first) by the inserter's own rule (merge, then empty slots), and counts each arrival in `stats.arrived`. An input chest holds a full stack of each of its `keys` in its first slots (key order; past 27 keys only the first 27, with unknown `input_chest_full`), each refilled at once after an extraction (the hookup or the player keeps it stocked); in `late_input` the slots of `env.heldBack` keys stay empty until `env.heldUntil`; its other slots start empty and keep what is pushed into them. An output chest starts empty; an item the plan sends out of the line (`model.sinks`) leaves it as soon as it arrives (the player or a hookup takes the line's products), anything else stays, so it fills only with items the plan did not send there and then refuses what has no room — in a 27-stack chest full of a leaked raw input the line's own products find no room either.

**Detectors** (`detect`; per finding `phase: 'sim'`, `certainty: 'certain'`, `scenario`, `tick` = the first tick of the condition, `count` only where named; findings ordered by node local order, then the Codes table's order, then key):
10. `feed_crowded`: a recipe waiting with `crowdedBy` set for `STALL_TICKS` ticks in a row (from the first such check to the next check that differs, or the end) → `` `${key} cannot get into ${M}: ${by} fills ${n} of its ${inSlots} input slots${multiOn ? ' (Multi Stack Input On)' : ''} while its recipe waits for ${key}` ``, count = the longest such stretch in ticks.
11. `feed_overfill`: a machine taking 2+ item kinds with one kind in 2+ input slots → `` `${key} fills ${n} input slots of ${M}, which takes ${k} kinds of item` `` (n = the most, tick = the first).
12. `feed_starved`: an item `model.planned` gives the machine's step that was never delivered in the scenario → `` `${M} never gets ${key}: ${explain('in', …) ?? 'nothing on the line hands it over'}` ``.
13. `feed_slow`: delivered in the second half below `(1 − slowTolerance)` × planned × the half's seconds, while the machine's recipe waited for it more than 10 % of the half's ticks → `` `${M} gets ${key} at ${rate}/s, below the ${planned}/s the plan needs` `` (rates `fmtRate`).
14. `feed_no_route`: a machine blocked on its output for `STALL_TICKS` in a row with nothing extracted from its output slots in that stretch (a line that drained it before and then stopped counts: Task 10's full chest; slow backpressure does not, as its consumer takes some every run) → `` `Nothing takes ${key} out of ${M}: ${explain('out', …) ?? 'nothing on the line takes it'}` ``.
15. `feed_pool_starve`: a machine of 2+ recipes with a recipe that never started while its inputs were present at its checks over `STALL_TICKS` → `` `${M} never ran its recipe for ${stepName}: it kept waiting on its last recipe's blocked output (${outputNames})` ``.
16. `feed_leak`: a chest (input or output) receiving an item `model.planned` gives some machine and `model.sinks` lacks → `` `${key} meant for ${M} reached ${chest}` `` (M = the first such machine), count = items. Items dropped into the world are not a finding: the unknown `items_dropped` names the host, the key and the count.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/machine.test.ts
import { describe, expect, it } from 'vitest';
import type { ScenarioName } from '../../../../src/server/layout/feeding/contract.ts';
import { runScenario } from '../../../../src/server/layout/feeding/sim/run.ts';
import { feeder, handModel, smelterNode, taker } from '../../../helpers/feeding-fixtures.ts';

const ticks = 1_000;
const run = (model: ReturnType<typeof handModel>, extra: Parameters<typeof runScenario>[2]['extra'], scenario: ScenarioName = 'steady') =>
  [false, true].map((exhaustive) => runScenario(model, scenario, { ticks, restartAt: 500, exhaustive, extra }));

describe('the GT basic machine', () => {
  it('runs its recipe as GT does', () => {
    const model = handModel([smelterNode()]);
    const [scheduled, exhaustive] = run(model, (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 64, NEVER_AGAIN, 0)]);
    expect(scheduled).toEqual(exhaustive);
    // the feeder fills both slots at tick 0, before the machine's tile phase: runs start at 0, 100, …, 900; nine end before tick 1,000
    expect(scheduled!.runs).toEqual({ sm: 10 });
    expect(slotsOf(scheduled!, '0,0,0')).toEqual([['t:a@0', 54], ['t:b@0', 24], ['t:c@0', 9]]);
  });
});
```

(`NEVER_AGAIN` = a period past the run; `slotsOf(run, node)` reads the machine's slots from `run.stats`'s final snapshot — `SimStats.final(node): Array<[StuffKey, number] | null>`, produced here.) The other cases of `machine.test.ts`, each with its scheduled and exhaustive runs deep-equal:
- *takes items as GT does* (rule 5, on `basicMachine(smelterNode(…), env)` directly): Multi Stack Off — after 64 `t:a@0` in slot 0, `canInsert(1, a, 3)` false, `canInsert(1, b, 3)` true, `canInsert(0, a, 3)` false; `canInsert(1, b, 4)` false (front); with `inputFromOutputSide: false`, `canInsert(1, b, 3)` false and `canInsert(1, b, 2)` true; Multi Stack On — `canInsert(1, a, 3)` true; Input Filter on with slot 0 holding `t:a@0` — `canInsert(1, 't:b@0', 3)` true (recipe `sm` uses both) and `canInsert(1, 't:x@0', 3)` false; `canExtract(0, a, 3)` false, `canExtract(2, c, 3)` true, `canExtract(2, c, 4)` false.
- *waits on a blocked output and starts again when it is emptied*: `initial` 64 `t:c@0` in the output slot (slot 2) and both inputs fed at tick 0 → no run until a `taker` takes 64 at tick 300 (phase `feed`, so the machine sees the change that same tick); runs start at 300, 400, …, 900: `runs` `{ sm: 7 }`, 6 `t:c@0` at the end.
- *rolls chances deterministically* (Review Focus 5): a node with `outSlots: 2` and recipe 1 `t:a@0` → 1 `t:x@0` + 1 `t:y@0` at chance 0.5 (20 ticks), fed 64 `t:a@0`, over 170 ticks → 8 completed runs, 8 `t:x@0` and 4 `t:y@0`, the `t:y@0` from runs 2, 4, 6, 8; with `t:a@0` consumed at chance 0.5, the 9 started runs use 4 `t:a@0` (60 left).
- *keeps its last recipe while its output waits* (research §1.1.5, rule 6's "never tries another recipe"): a node of recipes `r1` (1 `t:a@0` → 1 `t:x@0`, 20 ticks) and `r2` (1 `t:b@0` → 1000 L `fluid:molten.iron` and no item, so its outputs always fit), `initial` 63 `t:x@0` in its one output slot, fed `t:a@0` and `t:b@0` at tick 0, over 3,000 ticks → `r1` runs once (to 64), then neither runs: `runs` `{ r1: 1, r2: 0 }`, one `feed_pool_starve` naming `r2`'s step and one `feed_no_route` for `t:x@0`.
- *finds a crowded machine*: `smelterNode({ settings: { multiStack: true, … } })` fed 64 `t:a@0` at ticks 0 and 20 and `t:b@0` from tick 40 (two feeders), over 2,000 ticks → `t:a@0` takes both input slots at tick 20: one `feed_overfill` (`` `Alpha fills 2 input slots of ${label}, which takes 2 kinds of item` ``, tick 20) and one `feed_crowded` (tick 20) with text `` `Beta cannot get into ${label}: Alpha fills 2 of its 2 input slots (Multi Stack Input On) while its recipe waits for Beta` ``; with `multiStack: null` the same run has neither, and in `multistack_on` it has both.
- *finds items that never come and outputs nothing takes*: `smelterNode()` fed only `t:a@0`, with `model.planned` `{ sm: { 't:a@0': 1, 't:b@0': 4 } }` → `feed_starved` `t:b@0` with text `` `${label} never gets Beta: nothing on the line hands it over` ``; fed both, with `initial` 60 `t:c@0` in its output slot and nothing taking it, over 3,000 ticks → `feed_no_route` `t:c@0` (blocked from tick 400).
- *finds a leak*: an output chest node beside the smelter and a feeder that inserts `t:a@0` into the chest → `feed_leak` `t:a@0` with count = the items.
- *moves 16 items every 100 ticks with an LV conveyor* (rules 3a, 5a, E9, E10): `oneSlotNode('0,0,0')` with `initial` 64 `t:x@0` in its output slot, an LV export conveyor (`{ tickRate: 100, stacks: 1, items: 16 }`) on its side 3 and an output chest at `0,0,1`, over 450 ticks → the chest's arrivals are `[[100, 't:x@0', 16], [200, …, 16], [300, …, 16], [400, …, 16]]` (covers do nothing in the first 10 ticks after a load, so not at 0; 64 moved; the machine makes no more); with `export: true, allowInput: false`, a feeder on side 3 cannot insert (the cover lets nothing in).
- *drops what a conveyor pushes into nothing* (E10): the same without the output chest → the four operations drop their 16 `t:x@0` into the world (`spilledTotal('0,0,0')` 64), the output slot is empty at the end, and the unknown `items_dropped` names the machine, Ex and 64; no finding.
- *skips a stack its target refuses* (E4): `oneSlotNode('0,0,0', { outSlots: 2 })` with `initial` 10 `t:x@0` in output slot 1 and 10 `t:y@0` in output slot 2, `hvExport('0,0,0', 3)` and `sinkNode('0,0,1', 2)` south of it with `initial` 64 `t:x@0` in its slot 0 and 1 `t:y@0` in its slot 1, over 30 ticks → at tick 20 the conveyor moves the 10 `t:y@0` (the sink refuses Ex: Multi Stack Off keeps Ex to its full slot 0), and the 10 `t:x@0` stay.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/machine.test.ts`
Expected: FAIL — cannot find module `src/server/layout/feeding/sim/run.ts`.

- [ ] **Step 3: Implement the core, the machine, the chests, the detectors and `runScenario` by the rules above**

`runScenario` builds a `KeyTable` over every key the model names, one entity per node (basic machines and chests here; other kinds by later tasks — until then a node kind without a model is skipped with unknown `not_simulated`), the network entities from `NETWORK_MODELS`, `opts.extra`, runs the `Sim` and calls `detect`. Hot loops use the `KeyTable` ids and plain arrays; no allocation per tick.

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding/sim tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/machine.test.ts
git commit -m "feat(feeding): tick engine, GT basic machine and chests, with the first feeding detectors

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Multiblocks — input buses, output buses, the controller

**Files:**
- Create: `src/server/layout/feeding/sim/multi.ts`; modify `sim/run.ts` (build multiblock entities), `sim/detect.ts` (bus findings); extend `tests/helpers/feeding-fixtures.ts`
- Test: `tests/unit/layout/feeding/multi.test.ts`

**Interfaces:**
- Consumes: Task 4's core, `SimEnv`, `SimStats`, `detect`, `runScenario`, `gtTransfer`; Task 3's `precheckFeeding` and Task 1's `feedPack` in the R4 test.
- Produces: `multiblock(node: MultiNode, env: SimEnv): { controller: SimEntity; buses: Array<SimInv & SimEntity>; outBuses: Array<SimInv & SimEntity> }`; `SimStats.separated(node, recipe, t)`; fixtures `ebfNode(over?: Partial<MultiNode>): MultiNode` — controller at local `1,0,0`, input bus at `0,0,0` (LV, 4 slots, front 3), output bus at `2,0,0` (LV, 4 slots, front 3, `lock: null`), recipe `e` 1 `t:a@0` + 1 `t:b@0` → 1 `t:x@0`, 100 ticks, `separationDefault: true` — and `twoBusNode()` (the same with a second input bus at `0,1,0`, front 3).

**Rules** (E3, research §1.2):
1. **Input bus** (`SimInv`, a tile entity of its own): `canInsert(slot, k, s)` = s is its `front`; the slot is empty or holds k below its limit; Input Filter (`inputFilter === true`; unset is read as off, the constructor's default, though a placed bus has the placer's preference, E3): `model.mapTakes(map, k)` over the controller's maps; Limiting (`limited === true`): when some slot holds k, only that slot, else only an empty one. `canExtract(slot, k, s)` = s is its `front`. `countsAsEmpty` over every slot. On a change it ticks (rule 2 of Task 4): it compacts its stacks into its first slots (sorting is on: same items merged, in slot order) and wakes its controller.
2. **Output bus**: takes no automated input; `canExtract` from its `front`; a bus with `lock` stores only that item (`storePartial`, E3). When its `aTick % 8 === 0` (Task 4 rule 3a) it pushes, by `gtTransfer`, up to every stack (its slot count, 64 each) out of its front into `env.push(id, front)`, skipping stacks the target refuses (E4); with nothing there it moves nothing (no `dropItems` on a bus). Whenever it loses items it wakes its controller.
3. **Controller**: looks for a recipe when woken by a bus, when a run ends, and at tick 0. With Input Separation on (`inputSeparation ?? separationDefault`, the class list of E15) a recipe needs all its inputs on one input bus (buses in local order); off, on all of them together. Its outputs must fit its output buses, each output into the buses locked to it first and then into the unlocked ones (`ItemEjectionHelper`'s order, E3), local order within each group, merging, then empty slots; when they do not fit, it waits for a drain (E3: void protection keeps items). Inputs come out of the matched bus (or the buses in local order), each bus from its highest slot down (E3: GT lists a bus's slots from the last one); a run lasts `ticks` (with `env.fastSteps` and `env.heldBack` as for a basic machine, Task 4 rule 6); outputs go into the output buses by the same locked-first, merge-then-empty rule.
4. **Detectors**: `feed_overfill` for a bus holding one kind in 2+ slots while its controller takes 2+ kinds (`kinds`) (`` `${key} fills ${n} slots of ${bus} of ${M}, which takes ${k} kinds of item` ``); `feed_crowded` when, for `STALL_TICKS` in a row, every input of the recipe is on the controller's buses but no one bus holds them all and Input Separation is on (`` `${M} has every input of its recipe but on different input buses, and Input Separation checks each bus alone` ``), or a missing kind cannot enter any input bus from its front (the Task 4 text, counting the bus's slots); `feed_starved`, `feed_no_route`, `feed_slow` as for a basic machine, per bus.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/multi.test.ts
import { describe, expect, it } from 'vitest';
import { runScenario } from '../../../../src/server/layout/feeding/sim/run.ts';
import { ebfNode, feeder, handModel, outputChestNode, twoBusNode } from '../../../helpers/feeding-fixtures.ts';

describe('multiblocks', () => {
  it('starts when a set reaches its bus and pushes out every 8 ticks', () => {
    const model = handModel([ebfNode(), outputChestNode('2,0,1')]);
    const runs = [false, true].map((exhaustive) => runScenario(model, 'steady', { ticks: 700, restartAt: 350, exhaustive,
      extra: (env) => [feeder(env, '0,0,0', 3, ['t:a@0', 't:b@0'], 1, Number.POSITIVE_INFINITY, 500)] }));
    expect(runs[0]).toEqual(runs[1]);
    // the feeder fills the bus at 500; the bus (order 0) wakes the controller (order 1) that same tick; the run ends at 600,
    // and the output bus (order 2) pushes at 607, when its own timer (aTick = age + 1 = 608) is a multiple of 8
    expect(runs[0]!.runs).toEqual({ e: 1 });
    expect(runs[0]!.stats.arrivals('2,0,1')).toEqual([[607, 't:x@0', 1]]);
  });
});
```

The other cases of `multi.test.ts` (scheduled and exhaustive runs deep-equal in each):
- *takes items through its front, with Limiting mode as GT does* (on the bus directly): `canInsert(0, a, 3)` true, `canInsert(0, a, 2)` false; with `limited: null`, after 64 `t:a@0` in slot 0, `canInsert(1, a, 3)` true; with `limited: true` false, while `canInsert(1, b, 3)` is true; 5 `t:a@0` inserted into slot 2 of an empty bus sit in slot 0 after the bus's tick.
- *waits while a set is split over separated buses* (`twoBusNode()`): 64 `t:a@0` fed into bus `0,0,0` and 64 `t:b@0` into bus `0,1,0` at tick 0, over 2,000 ticks → no run and one `feed_crowded` (tick 0) with the Input Separation text; with `inputSeparation: false` → `runs` `{ e: 20 }` (starts 0, 100, …, 1,900; the outputs stay in the output bus, which faces nothing).
- *waits for a drain when its output buses are full* (`handModel([ebfNode(), outputChestNode('2,0,1')])`): `initial` 64 `t:x@0` in each of the output bus's 4 slots and a set fed into the input bus at tick 0 → the controller's check at tick 0 finds no room; the output bus (order 2) first pushes at tick 7 (its `aTick` 8) and empties its 4 stacks into the chest (27 slots), which wakes the controller for tick 8: the run starts at tick 8.
- *fills the bus locked to an item first* (E3, add-on 15's `lock`): `ebfNode` with a second output bus at `2,1,0` (front 3, `lock: 't:x@0'`), the first unlocked, recipe `e` making 1 `t:x@0` + 1 `t:y@0`, a set fed at tick 0, neither bus facing anything → after the run (tick 100) the locked bus holds the `t:x@0` and the unlocked bus the `t:y@0` (local order alone would have put both into `2,0,0`); with `initial` 64 `t:x@0` in each slot of the locked bus, the run's `t:x@0` goes into the unlocked bus instead, and the locked bus never takes `t:y@0`.
- *raises R4 from the controller's class* (E15, on `precheckFeeding(handModel([twoBusNode()]), feedPack())` directly): one `feed_crowded` risk with R4's text (beside R3's `feed_overfill` risks for the two unset buses); with `separationDefault: false` (a controller off `INPUT_SEPARATION_DEFAULT`) and `inputSeparation: null` → no R4 finding; with `inputSeparation: true` → the risk again.
- *overfills a bus without Limiting mode*: `t:a@0` fed 64 every 20 ticks from tick 0 and `t:b@0` never, over 2,000 ticks → with `limited: null`, one `feed_overfill` (tick 20, text `` `Alpha fills 4 slots of ${bus} of ${M}, which takes 2 kinds of item` ``: n is the most it reached) and one `feed_crowded` for `t:b@0` from tick 60, when the fourth slot fills; with `limited: true`, neither, and `t:a@0` stays in slot 0.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/multi.test.ts`
Expected: FAIL — `multiblock` is not exported from `sim/multi.ts` (module missing).

- [ ] **Step 3: Implement `multi.ts`, wire it into `runScenario`, add the bus detectors**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding/sim tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/multi.test.ts
git commit -m "feat(feeding): multiblock input buses with Limiting and sorting, Input Separation, output buses

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: The Auto Workbench, mode 0, line for line

**Files:**
- Create: `src/server/layout/feeding/sim/bench.ts`; modify `sim/run.ts` (benches, the power phase, the restart reset), `sim/detect.ts` (bench findings); extend `tests/helpers/feeding-fixtures.ts`
- Test: `tests/unit/layout/feeding/bench.test.ts`

**Interfaces:**
- Consumes: Task 4's core, `SimEnv` and `gtTransfer`; Task 1's `BENCH`, `benchEnergyCap`, `V`.
- Produces: `bench(node: BenchNode, env: SimEnv): SimInv & SimEntity & { restart(): void }` and its power entity (phase `power`, gains `min(V[tier], cap − stored)` a tick); `SimStats.benchMoved(node, key, n, why: 'stray' | 'failed' | 'duplicate', t)`, `benchLost(node, key, n, t)`, `benchCrafted(node, t)`, `benchStuck(node, key, t)`, `benchCrafts(node): number[]` (craft ticks); fixtures `benchNode(over?: Partial<BenchNode>): BenchNode` — MV (tier 2) at local `0,0,0`, `front` 2, `back` 3, `grid` `['t:resin@0', 't:fine@0', 't:resin@0', 't:wire@0', 't:carbon@0', 't:wire@0', null, 't:fine@0', null]` (the research's Resistor grid, §1.3.9), `result` 1 `t:resistor@0`, `containers` `{}`, throughput 0 — with items `t:resin@0` "Resin", `t:fine@0` "Fine Wire", `t:wire@0` "Wire", `t:carbon@0` "Carbon Dust", `t:resistor@0` "Resistor", `t:wet@0` "Wet Cell", `t:dry@0` "Dry Cell" added to `feedPack`.

**Model** (E4, research §1.3; every name the source's):
1. Slots 0–8 input buffer, 9–17 output buffer, 18 result, 19–27 the grid (ghost: never stored, `countAll` counts one per grid cell holding the key), 28 the preview. `canInsert(slot, k, side)` = slot < 9 (any item, any face, mode 0 `allowPutStack`) and empty-or-same below the limit; `canExtract(slot, k, side)` = 9 ≤ slot ≤ 18; `sideSlots` = 0–18; `countsAsEmpty` false whenever the grid holds an item (`isIOSlot` is true for all 30 slots, research §1.3.6). Its back (`node.back`) is where it pushes; energy enters every face but the back.
2. Fields: `stored` EU (0 at tick 0), `countdown = 20`, `cur = 0`, `lastOk = false`; `restart()` sets `countdown = 20`, `cur = 0`, `lastOk = false` (none of them saved).
3. Each tick (phase `tile`), when `stored ≥ 2048` and `--countdown < 1` (the decrement only happens while `stored ≥ 2048`), one update:

```ts
countdown = 32;
if (inv[18] === null) {
  if (!lastOk) { cur = (cur + 1) % 18; for (let i = 0; i < 17 && inv[cur] === null; i++) cur = (cur + 1) % 18; }
  const stray = inv[cur] !== null && !inGridOrContainer(inv[cur].key) && cur < 8 && throughput < 2;
  if (stray) { inv[18] = inv[cur]; inv[cur] = null; countdown = 1; moved(inv[18], 'stray'); lastOk = false; }   // the grid is empty this update
  else if (gridHasResult) {
    if (contentOf(0..17) is not empty) {
      if (inv[17] === null && every grid item i has a content stack (merged over 0–17) of at least its grid count) {
        lastOk = true;
        for (cell = 8 … 0) for (j = 17 … 0) if (inv[j] holds the cell's item) { take 1 from j; container → first slot 9–17 empty or holding it with room; break; }
        inv[18] = result; stored -= 2048; countdown = 1; crafted();
      } else {
        lastOk = false;
        if (inv[8] !== null && throughput < 2) { inv[18] = inv[8]; inv[8] = null; countdown = 1; moved(inv[18], 'failed'); }
      }
    }
    if (inv[18] === null && throughput < 2)
      for (i = 0 … 7) for (j = i + 1 … 8) if (inv[i] and inv[j] hold one item whose limit > 8) {
        if (inv[18] !== null) lost(inv[18]);                 // the overwrite: the stack moved before is gone
        inv[18] = inv[j]; inv[j] = null; countdown = 1; moved(inv[18], 'duplicate'); break;
      }
  } else lastOk = false;
}
if (throughput < 2) { const n = gtTransfer(slots 9–18, into env.push(id, back), 1 stack, 64 items); stored = max(0, stored − 10 n); }   // E4: skips refused slots
```

   `inGridOrContainer(k)`: a grid cell holds k, or k is the container (`node.containers`) of a grid item. `gridHasResult`: the grid holds an item, and its result is not in `env.heldBack` before `env.heldUntil`. The push (gtnhlib's `ItemTransfer`, E4) moves the first stack in slots 9–18, in slot order, that the target takes any of, up to 64 items, skipping each slot whose stack it refuses entirely; it moves nothing only when the target refuses them all, or nothing is behind the bench (no `dropItems` here). So a refused container return does not hold up the result in slot 18, and crafting goes on until a container stands in slot 17 (the craft test needs it empty). A slot-18 stack refused for `STALL_TICKS` in a row is `benchStuck`.
4. In the `restart` scenario, at the start of tick `restartAt` (before any phase), every bench's `restart()` runs (Task 11 adds the other restart effects).
5. **Detectors**: `feed_bench_eject` — items moved to slot 18 that were not a craft result, per bench: `` `${M} threw ${n} items out of its input slots (${counts}): ${reasons}` `` with reasons, in this order, from `stray` "it took items that are not in its grid", `failed` "a failed craft empties its last input slot", `duplicate` "its clean-up moves the second of two stacks of one ingredient to its result slot", joined by `; `; `feed_bench_delete` — `` `${M} destroyed ${n} items (${counts}): its clean-up of stacks of one ingredient overwrites the stack it already moved to its result slot` ``; `feed_bench_stuck` — `` `${M} stopped: ${item} sits in its result slot and the block behind it does not take it` ``; `feed_overfill` — the first tick two input slots hold one item (`` `${item} fills ${n} input slots of ${M}` ``) or an input slot holds an item not in its grid (`` `${M} took ${item}, which is not in its grid` ``). `counts` = `${n}× ${name}` per item, largest first, `, `.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/bench.test.ts
import { describe, expect, it } from 'vitest';
import { runScenario } from '../../../../src/server/layout/feeding/sim/run.ts';
import { benchNode, handModel, outputChestNode } from '../../../helpers/feeding-fixtures.ts';

const flood = Array.from({ length: 8 }, (_, slot) => [slot, 't:fine@0', 64] as [number, string, number]);

describe('the Auto Workbench', () => {
  it('deletes stacks when flooded with one ingredient', () => {
    const model = handModel([benchNode(), outputChestNode('0,0,1')]);
    const [run, again] = [false, true].map((exhaustive) => runScenario(model, 'steady', { ticks: 100, restartAt: 50, exhaustive, initial: { '0,0,0': flood } }));
    expect(run).toEqual(again);
    // MV: 2,048 EU after the gain of tick 15, then 20 counted ticks: the first update at 34. Tick 34 moves slots 1, 3, 5, 7 to
    // slot 18 (three overwritten) and pushes one stack; tick 35 moves 2 and 6 (one overwritten); tick 36 moves 4; 64 stay in slot 0
    expect(run!.stats.arrivals('0,0,1')).toEqual([[34, 't:fine@0', 64], [35, 't:fine@0', 64], [36, 't:fine@0', 64]]);
    expect(run!.findings.map((f) => [f.code, f.count])).toEqual([['feed_overfill', undefined], ['feed_bench_eject', 448], ['feed_bench_delete', 256]]);
    expect(run!.findings[2]!.text).toBe('Auto Workbench (MV) at 0 0 0 destroyed 256 items (256× Fine Wire): its clean-up of stacks of one ingredient overwrites the stack it already moved to its result slot');
  });
});
```

The other cases of `bench.test.ts` (scheduled and exhaustive runs deep-equal in each):
- *crafts from the highest slot first and pushes its result*: `initial` slot 0 2× `t:resin@0`, slot 1 2× `t:fine@0`, slot 2 2× `t:wire@0`, slot 3 1× `t:carbon@0`, a chest behind → `benchCrafts` `[34]` (one cell after another, slot 1's Fine Wire for cell 7 first), the chest gets 1 `t:resistor@0` at tick 34, slots 0–3 empty at the end; no finding.
- *throws out a stray*: `initial` slot 3 5× `t:x@0` → at tick 34 the update looks at slot 3 (slots 1 and 2 are empty), moves it to slot 18 and pushes it into the chest: `feed_bench_eject` 5 (stray reason) and `feed_overfill` (`took Ex, which is not in its grid`); without the chest, over 2,000 ticks, also `feed_bench_stuck` (`Auto Workbench (MV) at 0 0 0 stopped: Ex sits in its result slot and the block behind it does not take it`).
- *empties its last slot on a failed craft*: `initial` slot 0 2× `t:resin@0`, 1 2× `t:fine@0`, 2 2× `t:wire@0`, 8 1× `t:wire@0` (no carbon) → tick 34 moves slot 8 to slot 18 and pushes it: `feed_bench_eject` 1, the failed-craft reason; nothing else moves at 35.
- *crafts as fast as its energy allows*: `benchNode({ tier: 1 })` (LV: 2,048 EU at most, 32 a tick) with ingredients for 3 crafts → `benchCrafts` `[82, 146, 210]` (64 ticks a craft: research §1.3.7's 0.31/s).
- *crafts every 33 ticks when a container comes back*: a grid `['t:wet@0', 't:a@0', null, …]`, result 1 `t:x@0`, `containers: { 't:wet@0': 't:dry@0' }`, `initial` 4× `t:wet@0` in slot 0 and 4× `t:a@0` in slot 1, a chest behind → `benchCrafts` `[34, 67, 100, 133]` (the push moves the Dry Cell first, the result waits a tick, and that tick's update starts the 32-tick countdown); the same grid without `containers` → `[34, 35, 48, 64]` (then the energy limits it).
- *forgets its countdown on a restart*: the container bench of the previous case with 64 of each, in `restart` at 500 → its crafts before 500 are `[34, 67, …, 496]`, and the first after it is at 519 (countdown 20 from tick 500), not 529.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/bench.test.ts`
Expected: FAIL — `sim/bench.ts` does not exist.

- [ ] **Step 3: Implement `bench.ts`, the power phase, the restart hook and the bench detectors**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding/sim tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/bench.test.ts
git commit -m "feat(feeding): the GT++ Auto Workbench in mode 0, line for line: strays, failed crafts, the duplicates overwrite, energy and containers

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: EnderIO item conduits

**Files:**
- Create: `src/server/layout/feeding/sim/enderio.ts`; modify `sim/run.ts` (`NETWORK_MODELS.enderio`); extend `tests/helpers/feeding-fixtures.ts`
- Test: `tests/unit/layout/feeding/enderio.test.ts`

**Interfaces:**
- Consumes: Task 2's `EioNet`, `EioFace`; Task 4's core, `Explain`; Task 1's `eioDeficit`, `EIO`, `PART_KEYS.limitedFilter`.
- Produces: `NETWORK_MODELS.enderio = enderioModel(net: EioNet, env: SimEnv)` — one entity per network (phase `conduits`, order = its first face's), an `Explain`, and a `PushTarget` receiver per extract-capable face; fixture `eioModel(nodes: FeedNode[], faces: Array<{ conduit: NodeId; side: number; mode?: ConduitMode; extract?: Partial<NonNullable<EioFace['extract']>>; insert?: Partial<NonNullable<EioFace['insert']>> }>, links?: Array<[NodeId, NodeId]>): FeedModel` (one network of the given conduit cells, linked in a chain in the given order unless `links`; each face's `target` is the node on its side, colour `red`, `max` 4, priority 0, round robin off, self feed off, redstone `ignore` unless given).

**Rules** (E5, research §2.1):
1. Each tick the network's faces run in face order. A face extracts only while `deficit ≤ 0`, it is in `extract` or `in_out` mode and its redstone mode is `ignore` or `off` (`on` and `never` need a signal the line never gives); then `deficit -= 1`, and below −1 it becomes `EIO.sleepTicks` (20).
2. An extraction: the slots its target shows from the face's side (`sideSlots(target.side)`), at most `EIO.maxSlotChecks`, starting after `fromSlot` (−1 at first); the first stack whose key its extract filter passes and `canExtract` allows offers `min(max, count)` to the targets; when any are taken, that many leave the slot, `fromSlot` = that slot − 1 (the next extraction starts at it again) and `deficit = eioDeficit(taken, max)`; when none are taken it goes on to the next slot.
3. Targets: every other face of the network (its own too when `selfFeed`) with an insert side of the extract side's colour, sorted sticky first, priority high to low, conduit hops (breadth-first over the links) low to high, then face order. Without round robin they are tried in that order until the offer is taken; with it, a persistent index (−1 at first) moves one target on before each try and stays where the offer was used up. A target takes what its insert filter passes and `insertOneEmpty` puts into its inventory from its side; a Limited Item Filter caps that at `limit − countAll(key)` (the counts of the slots matching the key, summed), and nothing at or below 0.
4. Filters: whitelist or blacklist of keys; `matchNbt: false` compares keys without their `#…` part, `matchMeta: false` compares ids only, `oreDict: true` is read as exact with unknown `eio_oredict`. An empty whitelist passes nothing.
5. A push into a conduit cell (a GT transfer from a machine's cover, an output bus, a bench's back, auto-output) is taken only through a face of that side in `extract` or `in_out` mode whose extract filter passes the key, and it is offered to that face's targets at once, as rule 3; what no target takes is refused (E5, research §2.1 "Pushes into a conduit").
6. `restart()`: every face's `deficit = 0`, `fromSlot = −1`, round-robin index −1 (the network is rebuilt when its chunk loads).
7. `explain('in', node, key)`: none of the faces toward the node has an insert side → `no conduit face toward it inserts`; an insert side whose filter refuses the key → `its conduit face's Insert filter lists ${names or 'nothing'}`; no extract side elsewhere passes the key → `no conduit face extracts ${key} anywhere on the line`; else null. `explain('out', node, key)`: no face toward the node extracts → `no conduit face toward it extracts`; its extract filter refuses the key → `its conduit face's Extract filter lists ${names or 'nothing'}`; no insert side elsewhere of that colour passes the key → `no conduit face on the line inserts ${key}`; else null.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/enderio.test.ts
import { describe, expect, it } from 'vitest';
import { runScenario } from '../../../../src/server/layout/feeding/sim/run.ts';
import { eioModel, inputChestNode, outputChestNode, sinkNode } from '../../../helpers/feeding-fixtures.ts';

const both = (model: Parameters<typeof runScenario>[0], ticks: number) =>
  [false, true].map((exhaustive) => runScenario(model, 'steady', { ticks, restartAt: ticks, exhaustive }));

describe('EnderIO item conduits', () => {
  it('moves 4 items every 10 ticks, 16 with three speed upgrades', () => {
    // chest 0,0,0 → conduit 0,0,1 → a one-slot machine 0,0,2 that never runs (its recipe needs t:z@0)
    const at = (max: number) => eioModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode('0,0,2', 1)], [
      { conduit: '0,0,1', side: 2, mode: 'extract', extract: { filter: { whitelist: true, keys: ['t:a@0'] }, max } },
      { conduit: '0,0,1', side: 3, mode: 'insert', insert: { filter: { whitelist: true, keys: ['t:a@0'] }, priority: 1 } }]);
    const [four, again] = both(at(4), 100);
    expect(four).toEqual(again);
    expect(four!.stats.deliveries('0,0,2')).toEqual([0, 10, 20, 30, 40, 50, 60, 70, 80, 90].map((t) => [t, 't:a@0', 4]));
    expect(both(at(16), 100)[0]!.stats.deliveries('0,0,2')).toEqual([0, 10, 20, 30].map((t) => [t, 't:a@0', 16]));
  });
});
```

(`inputChestNode`, `sinkNode` — side 2 by default, toward a conduit north of it — and `outputChestNode` are Task 4's fixtures; `SimStats.deliveries(node): Array<[tick, key, count]>` — what `delivered` recorded, in order — is produced here.) The other cases of `enderio.test.ts`, each with deep-equal scheduled and exhaustive runs:
- *fills machines before chests* (rule 3): the chest's extract face, a one-slot sink machine 3 hops away (priority 1) and an output chest 1 hop away (priority 0) → the machine gets 4 at ticks 0, 10, …, 150 (64), the output chest its first 4 at tick 160.
- *takes turns with round robin*: the chest's face with `roundRobin: true` and two one-slot sinks B (1 hop) and C (2 hops), both priority 1 → B at ticks 0, 20, 40, C at 10, 30, 50 (over 60 ticks).
- *starts each extraction at the slot it last moved from*: an input chest holding `t:a@0` (slot 0) and `t:b@0` (slot 1) and an output chest taking anything → every delivery is `t:a@0`; with the output chest's insert filter `['t:b@0']` → every delivery is `t:b@0`.
- *caps a bench with a Limited Item Filter* (research §2.1, §3.6): `benchNode()` (Resin in grid cells 0 and 2) on a conduit cell at its back, fed from an input chest of `t:resin@0` on that conduit; the face toward the bench `in_out`, its insert filter `{ item: PART_KEYS.limitedFilter, whitelist: true, keys: ['t:resin@0'], limits: [{ key: 't:resin@0', count: 6 }] }` and its extract filter `['t:resistor@0']` → over 2,000 ticks the bench gets 4 at tick 0 and nothing more (6 − 2 grid cells − 4), and no finding; the same with a Basic Item Filter (`item` `EnderIO:itemBasicFilterUpgrade@0`, no `limits`) → slot 0 fills by tick 150, slot 1 gets Resin at 160, the bench's update at 162 moves slot 1 to slot 18 and the extract filter refuses it: exactly `feed_overfill` (tick 160), `feed_bench_eject` (count 4) and `feed_bench_stuck` (tick 162).
- *takes a push only through an extracting face* (rule 5): the crafting bench of Task 6's second case with its back on a conduit cell whose face toward it is `in_out` (insert `t:resin@0` …, extract `['t:resistor@0']`) and an output chest face on the same conduit → the Resistor reaches the output chest at tick 34; with the extract filter `['t:x@0']` it is refused and the bench reports `feed_bench_stuck` over 2,000 ticks.
- *pushes its result past a refused container* (E4): the container bench of Task 6 (grid `['t:wet@0', 't:a@0', null, …]`, result 1 `t:x@0`, `containers: { 't:wet@0': 't:dry@0' }`) with `initial` 4× `t:wet@0` in slot 0, 2× `t:a@0` in slot 8 and 64× `t:dry@0` in each of slots 9–16, its back on a conduit cell whose face toward it is `in_out` (insert filter `['t:wet@0', 't:a@0']`, extract filter `['t:x@0']`: the result only) and an output chest face on the same conduit, over 2,000 ticks → `benchCrafts` `[34]` and the chest gets 1 `t:x@0` at tick 34 (the push skips slots 9–16, whose Dry Cells the face refuses); that craft put its Dry Cell into slot 17, so at 35 the bench cannot craft and its failed-craft step moves slot 8's last Alpha to slot 18, which the face refuses too: `feed_bench_eject` 1 (the failed-craft reason) and `feed_bench_stuck` (tick 35). A real line gets there after slots 9–17 fill with returned containers: 8 × 64 + 1 crafts.
- *explains what does not arrive*: `chain2()` laid in `enderio` and read (Task 2), the assembler's insert filter keys set to `[]`, run 2,000 ticks → `feed_starved` `t:x@0` with text `` `${assembler} never gets Ex: its conduit face's Insert filter lists nothing` ``.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/enderio.test.ts`
Expected: FAIL — no EnderIO model: `deliveries` is empty.

- [ ] **Step 3: Implement `enderio.ts` and register it**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding/sim tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/enderio.test.ts
git commit -m "feat(feeding): EnderIO item conduit faces: cadence, sleep, sticky start slot, priority, round robin, Limited Item Filter

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Project Red routed pipes

**Files:**
- Create: `src/server/layout/feeding/sim/routed.ts`; modify `sim/run.ts` (`NETWORK_MODELS.routed`, the restart hook), `sim/detect.ts` (`feed_churn`); extend `tests/helpers/feeding-fixtures.ts`
- Test: `tests/unit/layout/feeding/routed.test.ts`

**Interfaces:**
- Consumes: Task 2's `RoutedNet`, `RoutedPipe`, `RoutedChipSpec`; Task 4's core, `insertEmpties`, `roomFor`, `Explain`; Task 1's `PR`, `prTravelTicks`, `stockKeeperDelay`, `PR_PRIORITY_ORDER`, `stackLimit`.
- Produces: `NETWORK_MODELS.routed = routedModel(net, env)` — one entity per chip pipe (phase `tile`, the pipe's order: its send queue, then its chips), one arrivals entity (phase `arrivals`: arrivals, bounces' retries, re-routes and wanderers), an `Explain`, a `restart()`; `SimStats.bounced(node, key, n, t)`, `wandered(node, key, n, t)` (node = where the payload was heading), `pulledBack(node, key, n, t)`, `prDropped(pipe, key, n, t)`, `queueLost(pipe, key, n, t)`, and their readers `bouncedTotal(node)`, `wanderedTotal(node)`, `pulledBackTotal(node)`, `droppedTotal(pipe)`, `queueLostTotal(pipe)`, `dispatches(pipe): number[]` (dispatch ticks); fixture `prModel(nodes: FeedNode[], pipes: Array<{ id: NodeId; chips?: RoutedChipSpec[]; target?: InvRef }>, links?: Array<[NodeId, NodeId]>): FeedModel` (pipes linked in a chain in the given order unless `links`).

**Rules** (E6, research §2.2):
1. **Chips and pipes.** Each chip has a countdown (extractor and broadcaster 10, stock keeper 100) that its pipe's tick lowers by 1; at 0 the chip acts (chips in slot order) and its countdown starts again (10, 10, or `stockKeeperDelay(idle)`). A pipe's tick first dispatches its send queue's head (rule 5), then runs its chips. A pipe is due at its chips' next act and on every tick while its send queue is not empty.
2. **Responses.** For an item k (excluding some pipes): every pipe with a responder (Passive), terminator (Terminated) or overflow responder (Default, any item) whose filter passes k answers with `roomFor(target, k, side)` minus its transit: the in-transit count of k, and `stackLimit(k) × ⌈transit(k′) / stackLimit(k′)⌉` for each other key k′ in transit to it (`RoutedInterfacePipePart.getSyncResponse`). Its transit is what has been dispatched to it and not yet taken off (rule 5): a payload still in a send queue is not in it, so chips that act in the same tick all see the same room (E6). A pipe answers only when that room is above 0. The best answer: the higher priority (`PR_PRIORITY_ORDER`), then the chip's own `priority`, then fewer hops, then pipe order.
3. **Extractor.** Its target's items as `getAllItemStacks` lists them — each key once, its total over the side's slots, in the order of the slot it first appears in (open question 5) — and for each key its filter passes (whitelist: listed; blacklist: not listed), with a budget of `PR.extractPerKey` (64) started again for each key (E6): the best answer excluding its own pipe; while there is one, `n = min(budget, the listed total, stackLimit, room)`; n ≤ 0 ends the whole act; take up to n from the target's slots in order (`canExtract`); taking 0 ends the whole act (the jar's `return` inside the loop); queue what was taken (rule 5); the budget drops by it, and at 0 the whole act ends (the same `return`); the next best answer for the key excludes the pipes used so far for it.
4. **Stock keeper.** For each stock entry in slot order (each key once): `space = roomFor(target, k, side)` (≤ 0 → skip); `stored` = k in the target's side slots (`when_empty` and stored > 0 → skip); `enroute` = k in transit to this pipe (rule 2's transit); stored + enroute ≥ stock → skip; `pending` = the broadcaster orders for this pipe and k; request `min(stock − stored − enroute − pending, space, PR.maxRequest)` when above 0: broadcasters of the network in hops order (then pipe order) promise each `min(missing, available)`, available = k in their target's side slots that their filter passes minus their open orders for k, and each promise becomes an order (this pipe, k, n) at that broadcaster. The act counts as requesting when it asked and was promised something; `idle` resets to 0 then, else grows by 1 (E7: nothing else resets it).
5. **Send queue, dispatch and arrival** (E6). A chip's send appends a payload (n of k, its destination pipe, its priority: Passive, Terminated or Default by the answer; Active Broadcast for a broadcaster's delivery) to its own pipe's send queue. At the start of its tile tick a pipe dispatches the queue's head — one payload per pipe per tick: from that tick its count is in the destination's transit, and it reaches the destination's inventory edge `prTravelTicks(hops, priority)` ticks later (hops + 1 pipe lengths), in phase `arrivals`, in dispatch order (ties: the source pipe's order). It keeps its route, the breadth-first path to its destination (ties by pipe order), and enters the j-th pipe after its own at `dispatch + prTravelTicks(j − 1, priority)` (the model leaves out a payload moving twice in one tick where a pipe hands it to one that updates later in that tick). On arrival `insertEmpties` puts it into the destination's target from its side. When all that is left of it goes in, the destination's transit of k drops by that count, never below 0 (`itemReceived`), so a payload that went in in parts takes only its last part off. What does not go in bounces (`bounced`, counted once per payload): it keeps its destination while that pipe exists, stays in its transit and tries the same inventory again one pipe length later (`prTravelTicks(0, priority)` ticks), as often as it takes.
6. **Re-routes and wanderers** (E6). A payload without a destination (after a restart, rule 8) re-routes when it enters the next pipe of its route: to the best answer from that pipe (no exclusion), whose transit does not count it (`setDestination` without `itemExpected`), and it reaches that answer's inventory edge `prTravelTicks(hops from that pipe, the answer's priority)` ticks after it entered. With no answer it wanders (`wandered`, counted once per payload) and tries again every `prTravelTicks(0, 'wandering')` ticks (20: it re-routes at each pipe it enters at Wandering speed), the model keeping it at the pipe where it lost its way (its random path is not modelled: unknown `pr_wander_path`); "Max Wander Distance" 0 keeps it for ever.
7. **Broadcaster.** Each act: up to 8 orders and 64 items from the head of its order list: `x = min(order count, items left, stackLimit)`, cut to the requester's `roomFor` (≤ 0: the order moves to the back and the act ends); take up to x from its target's side slots that its filter passes and `canExtract` allows; nothing taken drops the order (`prDropped`, `timeOutOnFailedExtract`); else queue it (rule 5, Active Broadcast) and lower the order (removed at 0, else moved to the back when it was cut). Up to 8 payloads queued in one act leave over the next 8 ticks.
8. **Restart** (at the start of `restartAt`, E6, research §2.2 "Restart"): every pipe's send queue is lost with its items (`queueLost`; unknown `pr_queue_lost` with the count: a restart right after a chip's act deletes what it queued); every transit count is cleared; every payload in flight loses its destination: one not yet in its destination pipe re-routes when it enters its next pipe (rule 6), one already in it goes in on arrival if it fits and re-routes there if not; broadcaster orders are dropped; every chip's countdown starts again (10, 10, 100), all together, and stock keepers' `idle` is 0.
9. Items an extractor takes out of an input bus count `pulledBack` (research §3.2).
10. **Detectors**: `feed_churn` when a node's `bounced` reaches `CHURN_ITEMS` (`` `${n} ${key} sent to ${M} did not fit and circle its pipe, trying again every pipe length until there is room (its responder counted every empty slot as a stack, or a restart lost the count of what was on its way)` ``), when `wandered` reaches it (`` `${n} ${key} lost their way and wander the routed pipes until a responder answers` ``, on the node the payloads were heading for), and when a bus's `pulledBack` reaches it (`` `${n} ${key} were pulled back out of ${bus} of ${M} by its Item Extractor Chip` ``).
11. `explain('in', node, key)`: no responder, terminator or stock keeper on its pipe lists the key → `no Item Responder Chip on its pipe lists ${key}`; the only sources are extractors whose filter refuses it → `the Item Extractor Chip on ${source} ${empty ? 'has an empty whitelist (a new chip extracts nothing)' : 'does not list it'}` (the first source in node order); else null. `explain('out', node, key)`: its extractor refuses it → `its Item Extractor Chip …` (as R5a's words); no answer for it on the network → `no Item Responder Chip on the line lists it`; else null.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/routed.test.ts
import { describe, expect, it } from 'vitest';
import { runScenario } from '../../../../src/server/layout/feeding/sim/run.ts';
import { inputChestNode, prModel, sinkNode } from '../../../helpers/feeding-fixtures.ts';

// chest 0,0,0 under its pipe 0,1,0; junctions; a sink machine h,0,0 under its pipe h,1,0 (h hops: h + 1 pipe lengths, 5 (h + 1) ticks at Passive speed)
const line = (extractor: string[] | null, sinkSlots = 1, h = 2) => prModel([inputChestNode('0,0,0', ['t:a@0']), sinkNode(`${h},0,0`, sinkSlots, 1)], [
  { id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [{ kind: 'extractor', filter: { mode: 'whitelist', keys: extractor ?? [] } }] },
  ...Array.from({ length: h - 1 }, (_, i) => ({ id: `${i + 1},1,0` })),
  { id: `${h},1,0`, target: { node: `${h},0,0`, side: 1 }, chips: [{ kind: 'responder', filter: { mode: 'whitelist', keys: ['t:a@0'] } }] }]);

describe('Project Red routed pipes', () => {
  it('moves one stack and counts it in transit', () => {
    const runs = [false, true].map((exhaustive) => runScenario(line(['t:a@0']), 'steady', { ticks: 1_000, restartAt: 1_000, exhaustive }));
    expect(runs[0]).toEqual(runs[1]);
    // the extractor acts at 9, 19, …; the 64 it queues at 9 leave the chest's pipe at 10 (one payload a tick, counted in the
    // sink's transit from then) and reach the sink at 25 (2 hops: 3 pipe lengths, 15 ticks); the act at 19 sees them in transit
    expect(runs[0]!.stats.dispatches('0,1,0')).toEqual([10]);
    expect(runs[0]!.stats.deliveries('2,0,0')).toEqual([[25, 't:a@0', 64]]);
  });
});
```

The other cases of `routed.test.ts` (scheduled and exhaustive runs deep-equal in each):
- *moves nothing with a new Item Extractor Chip*: `line(null)` with `planned` `{ <sink step>: { 't:a@0': 1 } }` over 1,000 ticks → no delivery, and `feed_starved` with text `` `${sink} never gets Alpha: the Item Extractor Chip on Chest (input) at 0 0 0 has an empty whitelist (a new chip extracts nothing)` ``.
- *overshoots an empty two-slot machine* (research §2.2, C19): `line(['t:a@0'], 2)` → 64 queued at 9 (room 128) and dispatched at 10, 64 queued at 19 (room 128 − 64 in transit) and dispatched at 20; the first reach the sink at 25 and fill slot 0; the second, at 35, do not fit (Multi Stack Off keeps `t:a@0` to slot 0), stay in the sink's transit and circle its pipe, trying again every 5 ticks: deliveries `[[25, 't:a@0', 64]]`, `bounced` 64 at 35, `wanderedTotal` 0, and `feed_churn` for the bounce.
- *sends twice in one tick from two extractors* (E6: transit counts from dispatch): `prModel([inputChestNode('0,0,0', ['t:a@0']), inputChestNode('4,0,0', ['t:a@0']), sinkNode('2,0,0', 1, 1)], [{ id: '0,1,0', target: { node: '0,0,0', side: 1 }, chips: [<extractor whitelisting t:a@0>] }, { id: '1,1,0' }, { id: '2,1,0', target: { node: '2,0,0', side: 1 }, chips: [<responder for t:a@0>] }, { id: '3,1,0' }, { id: '4,1,0', target: { node: '4,0,0', side: 1 }, chips: [<extractor whitelisting t:a@0>] }])` over 200 ticks → both extractors act at 9 and both see the sink's whole room (neither payload is dispatched yet), both payloads leave at 10 and reach the sink at 25 (2 hops each): the first in dispatch order (the lower pipe's) fills the one slot, the other bounces and circles: deliveries `[[25, 't:a@0', 64]]`, `bounced` 64 at 25 and `feed_churn`.
- *gives up its act on an input item* (research C3): a machine node `M` at `2,0,0` with `initial` 10 `t:a@0` in its input slot and 5 `t:x@0` in its output slot, its pipe holding an extractor with `{ mode: 'blacklist', keys: [] }`; another sink taking `t:a@0` (responder) and an output chest taking `t:x@0` (responder) → over 1,000 ticks nothing moves (each act lists `t:a@0` first, cannot take it out of the input slot and stops); with the extractor's filter `{ mode: 'whitelist', keys: ['t:x@0'] }` → the output chest gets the 5 `t:x@0`, queued at 9, dispatched at 10 and delivered `prTravelTicks(<its hops>, 'passive')` ticks later.
- *keeps a stock with a Stock Keeper and a Broadcaster*: the input chest's pipe holding a broadcaster `{ mode: 'whitelist', keys: ['t:a@0'] }`, the sink's pipe a stock keeper `stock: [{ key: 't:a@0', count: 16 }]` → at tick 99 the broadcaster (lower pipe order) acts first with no order, then the stock keeper asks for 16; the broadcaster's act at 109 serves it and the payload leaves at 110 (Active Broadcast, 2 hops: 3 pipe lengths, 10 ticks): deliveries `[[120, 't:a@0', 16]]` over 2,000 ticks, and nothing more (the stock stays at 16).
- *drops an order its broadcaster cannot fill* (research C4): the broadcaster on a machine whose only `t:a@0` is 10 in its input slot, blacklist `[]` → it promises 10, takes 0 and drops the order at every try: no delivery over 2,000 ticks, `droppedTotal(<its pipe>)` > 0.
- *loses its transit on a restart* (research C5): `line(['t:a@0'], 1, 6)` (6 hops: 7 pipe lengths, 35 ticks) in `restart` at tick 15 → the payload queued at 9 and dispatched at 10 loses its destination at 15 and re-routes as it enters its second pipe that tick, to the same sink, whose transit no longer counts it (it still arrives at 45); the extractor's countdown starts again at 15 and it acts at 24 with nothing counted, queuing 64 more (dispatched at 25, arriving at 60); the first goes in at 45 and takes its 64 off the transit, which held only the second's; the second does not fit at 60 and circles: deliveries `[[45, 't:a@0', 64]]`, `bounced` 64 at 60, `feed_churn`; in `steady` the same model gives `[[45, 't:a@0', 64]]` and no `feed_churn`.
- *loses what a send queue holds at a restart* (E6): `line(['t:a@0'])` in `restart` at tick 10 → the 64 queued at 9 are still in the chest pipe's queue at the start of tick 10 and are lost (`queueLostTotal('0,1,0')` 64, unknown `pr_queue_lost`); the extractor's countdown starts again at 10, it acts at 19, the payload leaves at 20 and arrives at 35: deliveries `[[35, 't:a@0', 64]]`.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/routed.test.ts`
Expected: FAIL — no routed model: no dispatch, no delivery.

- [ ] **Step 3: Implement `routed.ts`, register it, add the restart hook and `feed_churn`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding/sim tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/routed.test.ts
git commit -m "feat(feeding): Project Red chips and payloads: send queues, transit from dispatch, extractors that give up, stock keepers, broadcasters, bounces that retry, re-routes and restarts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: AE2 — storage, the crafting CPU, interfaces

**Files:**
- Create: `src/server/layout/feeding/sim/ae2.ts`; modify `sim/run.ts` (`NETWORK_MODELS.ae2`), `sim/detect.ts` (`feed_fluid_packet`); extend `tests/helpers/feeding-fixtures.ts`
- Test: `tests/unit/layout/feeding/ae2.test.ts`

**Interfaces:**
- Consumes: Task 2's `Ae2Net`, `Ae2Iface`, `Ae2ExportBus`, `InterfaceSpec`, `PatternSpec`; Task 4's core, `insertEmpties`, `Explain`; Task 1's `AE2`, `ignoredByBlocking`, `PART_KEYS.fluidPacket`; `stepDepths` (`src/server/layout/arrange.ts`).
- Produces: `NETWORK_MODELS.ae2 = ae2Model(net, env)` — the CPU (phase `grid`), one entity per interface (phase `tile`, its send list) and per ME Export Bus (phase `tile`), a `PushTarget` per interface (what machines push into it enters ME), an `Explain`; `SimStats.ae2Pushes(iface): number[]` (push ticks), `unlocked(iface): number[]` (the ticks its Locking Card's lock cleared), `starts(node): number[]` (run start ticks, produced here for every machine model), `packet(node, iface, fluid, how: 'slot' | 'send_list' | 'no_slot', t)`; fixture `ae2Model(nodes: FeedNode[], ifaces: Array<{ id: NodeId; spec: InterfaceSpec; targets: InvRef[] }>, more?: Partial<FeedModel> & { exportBuses?: Ae2ExportBus[] }): FeedModel` (with Task 4's `oneSlotNode` and `hvExport`).

**Rules** (E8, E14, E16, research §2.3, §3.4, §3.5, §4.2):
1. **Storage.** ME holds every `model.supply` key without limit (in `late_input`, `env.heldBack` keys from `env.heldUntil`); with `ae2FluidStock`, every fluid a pattern lists too. Anything an interface takes in (a machine's cover or output bus pushing into it, a bench's back) enters ME at once: the CPU's store when its job waits for it, else storage; every such injection also counts down the Locking Cards (rule 5). In `ae2` mode a steam node's outputs are taken out by hand (main's `steam_items`, E17): the model moves them into ME at the end of each of its runs, as an injection, with unknown `steam_by_hand`.
1a. **ME Export Bus** (E16, research §3.5). Its first operation is 32 ticks after the line starts, then its interval drops by 2 ticks after an operation that moved something and grows by 1 after one that did not, between `AE2.exportMinTicks` and `AE2.exportMaxTicks`. An operation moves up to `amount` items, shared over its `keys` in order, each from ME storage (supply keys always; another key only what ME holds) into its target through `insertEmpties` from the target's side toward it (GT's `GTItemSink`), recorded as `delivered`. A bus with no target or no keys does nothing.
2. **Encodable patterns.** A pattern is a pattern only when every amount is whole and it lists no held item or programmed circuit (fluids are fine: ae2fc fluid patterns). Others are skipped (Review Focus 5); `precheckFeeding` already names them.
3. **The job.** One job, planned at tick 0: for each item flowing to `out`, `⌈perSecond × ticks / 20 × 2⌉` of it (twice the run, so the job outlasts it). A needed key is taken from storage when it is a supply key (also a held-back one in `late_input`: the job is planned, and tasks needing it wait until it is there) or a stocked fluid; else from the first interface's pattern (interface order) that outputs it: `⌈need / output⌉` crafts, its inputs needed in turn; a key that a laid step without an encodable pattern makes while an ME Export Bus feeds it (research §3.5: the line relies on stock) is taken from storage as that step makes it — the job counts on it, and tasks needing it wait until ME holds it; a key that none of these yields fails the plan, and no machine is pushed into for the whole run (`explain` names the key and why: no pattern, or its only pattern is not encodable). Tasks are ordered by `stepDepths` of their steps (raw-fed first), then interface order.
4. **The CPU** (each tick, phase `grid`): `ops = coprocessors + 1 − (pushes of its last 3 updates)`; it walks the tasks with crafts left and each task's interfaces in order, stopping at 0 ops; an interface is busy while its send list is not empty, while it is locked, or — with `blocking` and not `smartBlocking` — while none of its targets `countsAsEmpty`; a task whose inputs are not in its store (supply and stock keys always are; others come back as rule 1 says) waits. A successful push takes the inputs from the store, lowers the task by 1, adds the pattern's item outputs to what the job waits for (fluid outputs never come back: the line pipes them) and uses an op; a blocking interface then gives the turn to the next interface, a non-blocking one is pushed into again while crafts and ops last.
5. **`pushPattern`**: refused while the send list is not empty or the interface is locked. Its stacks are the pattern's inputs, a fluid becoming one `PART_KEYS.fluidPacket` item unless `dual`. Targets in order; with `blocking` (and not `smartBlocking` on the pattern pushed last) a target that does not `countsAsEmpty` is skipped. Into each target every stack by `insertEmpties` from the target's side; what is left goes to the next target. Nothing taken anywhere → false (no send list: E8); something taken → true, the rest into the send list. A packet that goes into a slot is `packet(…, 'slot')`; one left in the send list `'send_list'`; a push refused while its only stacks are packets `'no_slot'`. With `lock: 'until_result'` a push locks the interface with the list of the pattern's condensed outputs (each item key with its amount: result and container returns alike; fluid outputs too, which never come back); every injection into ME of a listed key (rule 1), from any source, counts down the list of every locked interface that lists it, each by the full amount injected; the lock clears when its whole list is down to 0 (E14: so one bench's result unlocks every interface waiting on the same item, and a pattern with a container return stays locked until both are back).
6. **The interface** (phase `tile`): a stack added to its send list makes it try the list on the next tick (`alertDevice`); after that it tries at AE2's adaptive interval (E8): 62 ticks when the line starts, 5 after a try that moved something, one tick more after each try that moved nothing, up to 120.
7. **Restart**: nothing resets — the CPU's job, send lists, locks and their lists are saved (`unlockStacks` is written to NBT).
8. **Detectors**: `feed_fluid_packet` once per machine and fluid — `'slot'`: `` `${iface} pushed a Fluid Packet (${fluid}) into ${M}: it stays in an input slot for good` ``; `'send_list'` for `STALL_TICKS`: `` `${iface} cannot push the Fluid Packet (${fluid}) into ${M}, so it is stuck with it` ``; `'no_slot'` for `STALL_TICKS`: `` `${iface} cannot push ${fluid} into ${M}: as a Fluid Packet item it needs a free input slot, and ${M} has none` ``.
9. `explain('in', node, key)`: a failed plan → `the AE2 job cannot be planned: ${why}` (`nothing makes ${k} and ME holds none`, or `the pattern for ${maker} ${R8 words}`); a task waiting on a key that never comes back → `the AE2 job waits for ${k}, which ${maker} makes but the line pipes away, so it never comes back to ME`; blocking toward a held item off the ignore list or a bench → R9's words; else null.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/ae2.test.ts
import { describe, expect, it } from 'vitest';
import { runScenario } from '../../../../src/server/layout/feeding/sim/run.ts';
import { ae2Model, hvExport, oneSlotNode } from '../../../helpers/feeding-fixtures.ts';

// M: a one-slot machine at 0,0,0 (1 t:a@0 → 1 t:x@0, 20 ticks) with an HV export conveyor on side 3; its interface at 0,0,1
const line = (blocking: boolean) => ae2Model([oneSlotNode('0,0,0')], [{ id: '0,0,1', targets: [{ node: '0,0,0', side: 3 }],
  spec: { patterns: [{ inputs: [{ key: 't:a@0', amount: 1 }], outputs: [{ key: 't:x@0', amount: 1 }] }], blocking } }],
  { covers: [hvExport('0,0,0', 3)] });

describe('AE2', () => {
  it('pushes one set at a time with blocking mode on', () => {
    const runs = [false, true].map((exhaustive) => runScenario(line(true), 'steady', { ticks: 70, restartAt: 70, exhaustive }));
    expect(runs[0]).toEqual(runs[1]);
    // the CPU pushes at 0 (M sees it at 1 and starts); at 4 into the empty input slot; then only when M takes that set, at 21, 41, 61
    expect(runs[0]!.stats.ae2Pushes('0,0,1')).toEqual([0, 4, 21, 41, 61]);
    expect(runs[0]!.stats.starts('0,0,0')).toEqual([1, 21, 41, 61]);
  });
});
```

(`oneSlotNode(id)`: a basic node with one input and one output slot, `outputSide` 3, `front` 4 and the recipe above; `hvExport(host, side)`: an HV export conveyor cover, `op` `{ tickRate: 20, stacks: 1, items: 64 }`; `ae2Model` sets `supply` `['t:a@0']` and an item flow to `out` of `t:x@0` at 1/s.) The other cases of `ae2.test.ts` (scheduled and exhaustive runs deep-equal in each):
- *pushes as fast as the CPU allows without blocking mode*: `line(false)` → pushes at 0, 4, 8, 12, 16 in the first 20 ticks; with `ae2Coprocessors: 3`, four pushes at tick 0 and four at tick 4 (`[0, 0, 0, 0, 4, 4, 4, 4]`).
- *jams on a Fluid Packet* (research §2.3, §4.2): a one-slot solidifier holding its mold (`held: ['gregtech:gt.metaitem.01@32301']`) whose pattern lists 144 L `fluid:molten.iron` → `x`, `ae2FluidStock: true`, 2,000 ticks → no push ever, one `feed_fluid_packet` with the `'no_slot'` text; a two-slot machine (Input Filter unset) whose pattern lists 1 `t:a@0` + 144 L `fluid:molten.iron` → the first push puts the packet in its second slot: one `feed_fluid_packet` (tick 0) with the `'slot'` text, and the next push leaves its packet in the send list (the interface busy for the rest of the run).
- *never pushes into a bench with blocking mode on* (research §1.3.6): `benchNode()` and an interface at its back with the grid's pattern (2 Resin, 2 Fine Wire, 2 Wire, 1 Carbon Dust → 1 Resistor), `blocking: true` → no push over 2,000 ticks and `feed_starved` for its inputs with the R9 bench words; with `blocking: false` and `lock: 'until_result'`, and the pattern's Fine Wire replaced by `t:fine2@0` "Other Fine Wire" (research C11): one push at tick 0, the bench throws out the 2 strays at 34 (`feed_bench_eject` count 2; they enter ME, but the lock waits for the Resistor), no `feed_bench_delete`, and no second push (the interface stays locked); the same without the lock → more pushes and `feed_bench_eject` above 2.
- *unlocks every interface waiting on the same result* (E14): two benches, A = `benchNode()` (MV) and B = an LV `benchNode` at `2,0,0` (`tier: 1`), each with an interface at its back holding the grid's exact pattern, `lock: 'until_result'`, `blocking: false`, ME holding the grid's ingredients and the job asking for Resistors → A's interface is pushed at 0 and B's at 4 (one push every 4 ticks, E8); A crafts at 34 and its Resistor enters ME through its interface, which counts down both lists: `unlocked(<B's interface>)[0]` is 34, and B's interface gets its second push (`ae2Pushes(<B's interface>)[1]`) before B's first craft at 82 (B then holds two sets; nothing is thrown out, as the pattern matches its grid).
- *stays locked until the container comes back too* (E14): the container bench of Task 6 (grid `['t:wet@0', 't:a@0', null, …]`, result 1 `t:x@0`, `containers: { 't:wet@0': 't:dry@0' }`) under an interface with the pattern 1 `t:wet@0` + 1 `t:a@0` → 1 `t:x@0` + 1 `t:dry@0`, `lock: 'until_result'`, `blocking: false` → pushed at 0; the bench crafts at 34 and pushes the Dry Cell into the interface at 34 and the result at 35 (Task 6: slot 9 first): `unlocked` is `[35, …]` and `ae2Pushes` starts `[0, 35]`.
- *feeds a step without a pattern through an ME Export Bus* (E16, research §3.5): `ae2Model([oneSlotNode('0,0,0')], [], { exportBuses: [{ id: '0,1,0', label: 'ME Export Bus at 0 65 0', keys: ['t:a@0'], amount: 1, target: { node: '0,0,0', side: 1 } }] })` over 400 ticks → the machine gets 1 `t:a@0` at ticks 32, 62, 90, 116, 140, … (each operation that moved something brings the next 2 ticks sooner, down to 5), it runs, the job counts on its `t:x@0` from stock rather than failing, and there is no `feed_starved`.
- *takes a steam machine's outputs by hand* (E17): `line(true)` with `oneSlotNode('0,0,0', { steam: true })` and no cover → each run's `t:x@0` enters ME when the run ends (the job counts it), the output slot stays empty, and the unknown `steam_by_hand`.
- *never encodes a fraction* (Review Focus 5): `line(true)` with the pattern's outputs `[{ key: 't:x@0', amount: 1 }, { key: 't:y@0', amount: 0.5 }]` → no push, and `feed_starved` `t:a@0` with text `` `${M} never gets Alpha: the AE2 job cannot be planned: the pattern for ${M} holds 0.50× Why: a pattern holds whole items` `` (planned `t:a@0` for M's step).
- *waits for a fluid the line pipes away* (research §4.2 item 2): an extractor E (1 `t:a@0` → 144 L `fluid:molten.iron`) and a solidifier S (144 L → 1 `t:x@0`), each with its interface and pattern, target `t:x@0` → E's pattern is pushed, S's never (`ae2Pushes(S's interface)` is `[]`: its input never reaches the CPU), while S still runs from the fluid pool (Task 4 rule 7a): `starts(S)` is not empty.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/ae2.test.ts`
Expected: FAIL — no AE2 model: `ae2Pushes` is empty.

- [ ] **Step 3: Implement `ae2.ts`, register it, add `feed_fluid_packet`**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding/sim tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/ae2.test.ts
git commit -m "feat(feeding): AE2 crafting CPU, interfaces and export buses: blocking, smart blocking, Locking Card lists, send lists, Fluid Packets

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: GT item pipes (machine to machine)

**Files:**
- Create: `src/server/layout/feeding/sim/gtpipe.ts`; modify `sim/run.ts` (`NETWORK_MODELS.gtpipe`); extend `tests/helpers/feeding-fixtures.ts`
- Test: `tests/unit/layout/feeding/gtpipe.test.ts`

**Interfaces:**
- Consumes: Task 2's `GtPipeNet`, `GtPipe`, `GtCover`; Task 4's core, `insertEmpties`, `coverTicks`, `Explain`, `SimEnv.push`.
- Produces: `NETWORK_MODELS.gtpipe = gtPipeModel(net, env)` — one entity per pipe (phase `tile`; its covers run first through `coverTicks`), a `PushTarget` per pipe (what is pushed into it enters an empty slot of it, rule 1), an `Explain`; fixture `pipeModel(nodes: FeedNode[], pipes: Array<{ id: NodeId; capacity?: number /* 1 */; links: number }>, covers?: GtCover[], more?: Partial<FeedModel>): FeedModel` (a pipe's `sides` = its linked sides whose neighbour is a node).

**Rules** (E9, research §2.4):
1. **A pipe** has `capacity` slots and takes a pushed stack only into an empty slot, and while it holds items only from the side it first received from (`allowPutStack`: it never merges); it remembers that side. When its `aTick % 10 === 0` (Task 4 rule 3a) and it holds items, it sends only if that side is the one it had at its previous check (`oLastReceivedFrom == mLastReceivedFrom`: a fresh stack waits one check), and then keeps the side for its next check (`UNKNOWN` once it is empty). A send offers its stacks, one at a time through `gtTransfer` (one stack, up to 64), to the network's pipes by distance — the sending pipe itself first, then breadth-first pipe hops, then pipe order — each trying its sides that touch a node in side order 0–5; the sending pipe never sends back out of the side it received from, and no pipe sends into another pipe. A side passes items only when the pipe's own cover on it lets them out (a Shutter on `input_only` does not; an Item Filter cover always does), and the node takes them by its own rules (`insertEmpties` from its side toward the pipe). A send counts against the transfer counter of every pipe the scan tried up to the taker, the sender included; a pipe whose counter has reached its capacity sends no more until its 20-tick window starts again.
2. `explain('out', node, key)`: no export conveyor or filter cover on the node's sides that touch a pipe → `no conveyor cover pushes it out of ${M}`; a cover whose filter refuses it → `its Item Filter cover lists ${names}`; the only nodes on the network that take the key are chests with no room → `its pipe's only taker for ${key}, ${chest}, is full`; no node on the network takes it → `nothing on its pipe takes ${key}`; else null. `explain('in', node, key)`: no pipe touches it → `no pipe touches it`; its Input Filter refuses the key → `its Input Filter keeps ${key} out (no recipe of its machine uses it)`; nothing pushes the key into its network → `nothing pushes ${key} into its pipe`; another node on the network nearer the pipe that carries the key received it → `its pipe hands ${key} to ${nearer} first, which is nearer`; else null.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/gtpipe.test.ts
import { describe, expect, it } from 'vitest';
import type { GtCover } from '../../../../src/server/layout/feeding/model.ts';
import { readLine } from '../../../../src/server/layout/feeding/read.ts';
import { runScenario } from '../../../../src/server/layout/feeding/sim/run.ts';
import { chain2, inputChestNode, layFeed, outputChestNode, pipeModel, sinkNode } from '../../../helpers/feeding-fixtures.ts';

// an input chest 0,0,0 north of pipe P1 0,0,1 (HV import conveyor on P1's side 2); P1 – P2 1,0,1 – P3 2,0,1;
// a one-slot machine N 1,0,2 south of P2 (planned to take t:x@0); an output chest 2,0,2 south of P3
const tail = (p3South?: GtCover) => pipeModel([inputChestNode('0,0,0', ['t:x@0']), sinkNode('1,0,2', 1, 2), outputChestNode('2,0,2')],
  [{ id: '0,0,1', links: 0b100100 }, { id: '1,0,1', links: 0b111000 }, { id: '2,0,1', links: 0b011000 }],
  [{ host: '0,0,1', side: 2, kind: 'conveyor', export: false, allowInput: false, op: { tickRate: 20, stacks: 1, items: 64 } }, ...(p3South ? [p3South] : [])],
  { planned: { n: { 't:x@0': 1 } } });

describe('GT item pipes', () => {
  it('hands items to the nearest taker, then to the next', () => {
    const runs = [false, true].map((exhaustive) => runScenario(tail(), 'steady', { ticks: 120, restartAt: 120, exhaustive }));
    expect(runs[0]).toEqual(runs[1]);
    // P1's conveyor imports a stack at 20, 40, … (covers wait 10 ticks after a load); P1 checks at 9, 19, 29, … (aTick % 10)
    // and holds a fresh stack for one check, so it sends at 39, 59, …; N (1 hop) takes the first, then is full; the chest (2 hops) the rest
    expect(runs[0]!.stats.deliveries('1,0,2')).toEqual([[39, 't:x@0', 64]]);
    expect(runs[0]!.stats.arrivals('2,0,2')).toEqual([59, 79, 99, 119].map((t) => [t, 't:x@0', 64]));
    expect(runs[0]!.findings.map((f) => f.code)).toEqual(['feed_leak']);
  });
});
```

(`sinkNode(id, inSlots, side)`'s step is `n`; links are bit sets `1 << side`: P1 north and east, P2 west, east and south, P3 west and south.) The other cases of `gtpipe.test.ts` (scheduled and exhaustive runs deep-equal in each):
- *never pushes through a shutter on Only Input allowed*: `tail({ host: '2,0,1', side: 3, kind: 'shutter', export: false, allowInput: false, shutter: 'input_only' })` → the chest gets nothing; with an Item Filter cover there instead (`{ host: '2,0,1', side: 3, kind: 'filter', export: true, allowInput: true, filter: { mode: 'whitelist', keys: ['t:y@0'] } }`) → the chest gets `t:x@0` from tick 59 (a filter cover never stops a pipe).
- *keeps out what an Input Filter refuses*: N with `settings.inputFilter: true` and `maps` whose recipes do not take `t:x@0` → N gets nothing, the chest gets a stack at 39, 59, 79, 99, 119 (120 ticks), and `feed_starved` for N with text `` `${N} never gets Ex: its Input Filter keeps Ex out (no recipe of its machine uses it)` ``.
- *takes a stack only into an empty slot, from one side* (E9, on P2's `PushTarget` directly, `capacity` 2): `accept(x, 10, 4)` → 10; `accept(x, 10, 4)` again → 10, into its other slot (never onto the first stack); `accept(x, 10, 5)` → 0 (it holds items from the west); with `capacity` 1, the second `accept(x, 10, 4)` → 0.
- *finds today's machine-to-machine tail leaking* (research §2.4): `chain2()` laid in `direct` (Plan 5's shared pipe) and read (Task 2). The tail pipe `6,0,2` imports Alpha from the input chest through an LV conveyor on its north side and has the Item Filter cover on its south side toward the output chest, so the nearest taker of Alpha is the output chest on the sending pipe itself. Over 2,000 ticks → the output chest gets 16 `t:a@0` at 119, 219, …, 1,919 (the conveyor acts every 100 ticks from tick 100; each stack waits one check in the pipe); `feed_leak` `t:a@0` (count 304) with text `` `Alpha meant for Basic Macerator at 3 64 1 reached Chest (output) at 6 64 3` ``; `feed_starved` `t:a@0` for both macerators, with text `` `${macerator} never gets Alpha: its pipe hands Alpha to Chest (output) at 6 64 3 first, which is nearer` ``, and `feed_starved` `t:x@0` for the assembler. Over 24,000 ticks (the default) the chest holds 27 stacks of Alpha from tick 10,819 (its 108th arrival); then Alpha reaches the macerators (3 hops) and Ex the assembler, but the assembler's Why finds no room in the full chest: its first stack stays in the pipe in front of it, the assembler's output slot fills, and the run reports `feed_no_route` `t:y@0` with text `` `Nothing takes Why out of Advanced Assembler at 5 64 1: its pipe's only taker for Why, Chest (output) at 6 64 3, is full` ``.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/gtpipe.test.ts`
Expected: FAIL — no pipe model: N gets nothing.

- [ ] **Step 3: Implement `gtpipe.ts` and register it**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding/sim tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/gtpipe.test.ts
git commit -m "feat(feeding): GT item pipes for machine-to-machine lines: empty-slot intake, the one-check hold, nearest taker first, shutters, capacity

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Scenarios, `checkFeeding`, the report, determinism and the 1,200-block bound

**Files:**
- Create: `src/server/layout/feeding/check.ts`; modify `sim/run.ts` (scenario parameters); extend `tests/helpers/feeding-fixtures.ts`
- Test: `tests/unit/layout/feeding/check.test.ts`

**Interfaces:**
- Consumes: Tasks 1–10 (`readLine`, `precheckFeeding`, `runScenario`, every model, `FEED_GATE_CODES`, `fromWorld`).
- Produces: `checkFeeding(input: { pack: Pack; plan: Plan; layout: Layout; options?: FeedingOptions }): FeedingReport`; `scenarioParams(model: FeedModel, scenario: ScenarioName): { fastSteps: Set<string>; heldBack: Set<StuffKey>; heldUntil: number }`; fixture `bigLine(mode: LogisticsMode): Promise<{ pack: Pack; plan: Plan; layout: Layout }>`.

**Rules:**
1. **Options**: `ticks` 24,000, `scenarios` `SCENARIOS`, `restartAt` `⌊ticks / 2⌋`, `ae2Coprocessors` 0, `ae2FluidStock` false, `slowTolerance` 0.1, `exhaustive` false. `scenarios: []` runs the static rules only.
2. **Empty lines** (Review Focus 2): a plan with status `empty` or `infeasible`, a layout with status `empty`, or a model without machine nodes → `{ ok: true, findings: [], inputs: [], scenarios: [], unknowns: [{ code: 'empty_line', text: 'Nothing to check: the layout places no machine' }, …model unknowns] }`.
3. **Scenarios** (research §7; `scenarioParams`): the "2+ kind machines" are the machine nodes whose recipes take two or more item kinds (`node.kinds.length ≥ 2`, Task 2 rule 5: the recipes, not the plan's flows). `steady`: none. `fast_supplier`: `fastSteps` = the `model.makers` of each such machine's first kind (`kinds[0]`, key order) — their runs last `⌈ticks / FAST_FACTOR⌉`. `late_input`: `heldBack` = each such machine's last kind (key order), not also a first kind of another; supplies (input chests, ME storage) hold none of them before `heldUntil = LATE_TICKS`, and a machine whose step makes one starts no run before it. `restart`: at the start of tick `restartAt` the line's chunk loads again — `env.loadedAt = restartAt`, so every GT tile's timer and the covers' server counter start again (Task 4 rule 3a) — and every model's `restart()` runs (benches, EnderIO, Project Red; AE2 keeps everything). `multistack_on`: a basic machine with `settings.multiStack === null` has Multi Stack Input On.
4. **Findings**: the static ones (Task 3's order), then each scenario's in `SCENARIOS` order; a scenario other than `steady` reports only findings whose `(code, node, key)` `steady` does not have — what that schedule adds. `ok` = no `certain` finding with a code in `FEED_GATE_CODES`.
5. **Inputs**: one `InputReport` per machine node and planned item (node order, then key): `plannedPerSecond` from `model.planned`, `deliveredPerSecond[scenario]` = what the scenario delivered over `[⌊ticks/2⌋, ticks)` divided by that window's seconds, and in `restart` `burst` = the items delivered over `[restartAt − BURST_TICKS, restartAt)` and over `[restartAt, restartAt + BURST_TICKS)`.
6. **Unknowns**: the model's, then each scenario's (`stack_sizes` once per report, `not_simulated`), each `(code, pos, stepId)` once, in first-seen order.
7. **Speed**: the scheduler lets idle entities sleep (Task 4 rule 2); each face, pipe and interface sorts its targets once when built; hot loops use `KeyTable` ids and plain arrays and allocate nothing per tick.

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/layout/feeding/check.test.ts
import { describe, expect, it } from 'vitest';
import { checkFeeding } from '../../../../src/server/layout/feeding/check.ts';
import { fromWorld } from '../../../../src/server/layout/feeding/frame.ts';
import { bigLine, chain2, feedPlan, layFeed, FEED_IDS } from '../../../helpers/feeding-fixtures.ts';

describe('checkFeeding', () => {
  it('runs every scenario the same way twice, scheduled or tick by tick', async () => {
    for (const mode of ['direct', 'routed', 'ae2', 'enderio'] as const) {
      const { pack, plan } = chain2();
      const layout = await layFeed(pack, plan, mode);
      const a = checkFeeding({ pack, plan, layout, options: { ticks: 2_000 } });
      expect(JSON.parse(JSON.stringify(checkFeeding({ pack, plan, layout, options: { ticks: 2_000 } })))).toEqual(JSON.parse(JSON.stringify(a)));
      expect(checkFeeding({ pack, plan, layout, options: { ticks: 2_000, exhaustive: true } })).toEqual(a);
      expect(a.scenarios.map((s) => s.name)).toEqual(['steady', 'fast_supplier', 'late_input', 'restart', 'multistack_on']);
    }
  });
});
```

The other cases of `check.test.ts`:
- *finds today's routed line stuck and says why*: `chain2()` in `routed` → `ok` false (`feed_no_route` and `feed_starved` gate), static findings exactly as Task 3's first case, `steady` findings exactly `feed_starved` `t:a@0` for both macerators (the input chest's new extractor) and `feed_starved` `t:x@0` for the assembler (the macerators' new extractors), no finding in the other scenarios (rule 4), and `inputs` with `deliveredPerSecond.steady` 0 for all three.
- *finds today's EnderIO smelter crowded only when Multi Stack Input is On* (research §4.3): `feedPlan([{ id: 'sm', mteId: FEED_IDS.SMELTER, count: 1, inputs: [['t:a@0', 1], ['t:b@0', 4]], outputs: [['t:c@0', 1]], ticks: 100 }], [<raw → sm t:a@0 1/s>, <raw → sm t:b@0 4/s>, <sm → out t:c@0 1/s>])` in `enderio` → static `feed_crowded` risk, no `steady` finding, a `multistack_on` `feed_crowded` `t:b@0` (the input chest's one face starts again at its slot of `t:a@0` after each move, so `t:a@0` takes both slots by tick 310) and `ok` false; the same layout with `config.multiStack: false` on the smelter → no `feed_crowded` anywhere and `ok` true.
- *adds what a fast supplier adds*: `feedPlan` with `m1` (macerator: 1 `t:a@0` → 1 `t:x@0`, 100 ticks), `m2` (macerator: 1 `t:b@0` → 1 `t:y@0`, 100 ticks) and `c` (`FEED_IDS.SMELTER`: 1 `t:x@0` + 1 `t:y@0` → 1 `t:z@0`, 20 ticks) and their flows, laid in `enderio`, with `config.multiStack: true` on `c`'s block → `fast_supplier` (m1 runs in 10 ticks) has `feed_crowded` `t:y@0` on `c` (Ex fills its slot and then the slot Why leaves empty), `steady` and `late_input` do not.
- *adds what a late input adds*: `eioModel` of `c` (two slots, `multiStack: true`, recipe 1 `t:x@0` + 1 `t:y@0` → 1 `t:z@0`, 20 ticks) fed by two input chests, one of `t:x@0` and one of `t:y@0`, each through its own extract face into `c`'s insert face → `late_input` has `feed_crowded` `t:y@0` (Ex takes both slots by tick 310, before Why may come at 1,200); `steady` and `fast_supplier` do not.
- *reports the restart's burst*: `chain2()` in `routed` with every Item Extractor Chip given `feed.chips` whitelisting its machine's outputs (the input chest's: `t:a@0`) → in `restart` each macerator's `burst` is reported, and every `steady` finding is absent from `restart`'s list (rule 4).
- *reports the same findings in every rotation* (Review Focus 1): `chain2()` in each mode laid at `{ origin: [30, 64, 10], rotation: r }`, r = 0, 90, 180, 270 → the findings mapped to `[code, phase, certainty, scenario, stepId, fromWorld(pos, layout), key, tick, count]` are equal for all four rotations.
- *checks an empty layout* (Review Focus 2): a plan with status `empty` and its `empty` layout → `{ ok: true, findings: [], inputs: [], scenarios: [] }` with unknown `empty_line`; a layout whose only machine's step the plan lacks → the same `ok` and `step_missing`.
- *checks a 1,200-block line in under a second* (Global Constraints): `bigLine(mode)` for `direct`, `routed`, `ae2` and `enderio` — each with `layout.blocks.length ≥ 1_200` — and the median of three warm `checkFeeding` runs with default options under 1,000 ms.

`bigLine(mode)` grows `feedPlan` chains one step at a time — step i on `IDS.MACERATOR` (i even) or `IDS.ASSEMBLER` (tier 2, i odd), 8 machines, 200-tick recipes, taking the previous step's output and, for odd i, also `t:a@0` from outside; an `IDS.EBF` step (2 machines) every fourth step — until `layFeed(pack, plan, mode)` places at least 1,200 blocks.

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/unit/layout/feeding/check.test.ts`
Expected: FAIL — cannot find module `src/server/layout/feeding/check.ts`.

- [ ] **Step 3: Implement `checkFeeding`, `scenarioParams` and `bigLine` by the rules above**

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run typecheck && npx vitest run tests/unit/layout/feeding`
Expected: PASS, the timing case printing its three medians.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/feeding tests/helpers/feeding-fixtures.ts tests/unit/layout/feeding/check.test.ts
git commit -m "feat(feeding): checkFeeding: five scenarios, the report, determinism, rotations and the 1,200-block bound

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Real data — the research's probe lines as today's main lays them out

**Files:**
- Create: `tests/unit/layout/real-feeding.test.ts`
- Test: the same (runs only with `GTNH_LOCAL=1`)

**Interfaces:**
- Consumes: `checkFeeding`, `readLine`; `loadConfig`, `activeExportDir` (`src/server/config.ts`), `loadPack`, `planLine`, `emptyContext`, `layoutLine`, `emptyScan`, `defaultSettings`, `makeProject`, `stepItemInputs`.
- Produces: nothing for other tasks; the console lines `real-feeding <line> <mode>: <blocks> blocks, <machines> machines, static <code×n …>, <scenario> <code×n …> …, ok <bool>, <ms> ms` (codes and counts only).

**Setup (once per worktree, not committed):** `mkdir -p data && ln -s "<repo>/data/export" data/export && ln -s "<repo>/data/assets" data/assets && ln -s "<repo>/docs/local" docs/local`; write `data/real-config.json` with `dataDir` = the worktree's `data` and only `serverFolder` and `activeExportId` copied from `<repo>/data/config.json` (`node -e` reading those two keys; never print the file).

**The lines** (research §4's probe, planned with `emptyContext()` and laid out with `emptyScan()` and `makeProject({ scanId: null, baseId: null })`, over `defaultSettings()`): `ec-user` — the user's Electronic Circuit settings, read at run time from `process.env.GTNH_FEED_REFERENCE || 'docs/local/circuit-reference/reference.json'` (its `settings` object; when the file is missing these two lines are skipped with a console note); `ec-user-auto` — the same with `automateCrafting: true`; `red-alloy` — `{ target: 'gregtech:gt.metaitem.01@11308', amount: 60, per: 'min', tier: 2 }`; `motor-lv` — `{ target: 'gregtech:gt.metaitem.01@32600', amount: 6, per: 'min', tier: 2 }`; `vacuum-tube` — `{ target: 'gregtech:gt.metaitem.01@32700', amount: 30, per: 'min', tier: 2 }`; each in `routed`, `ae2` and `enderio`, checked with default options (and once more with `ae2FluidStock: true` in `ae2`).

- [ ] **Step 1: Write the test**

Each `it` below loads the pack once (`beforeAll`, 300 s), plans and lays out its lines, and prints its console line per line and mode.
- *checks every line in every mode in under 5 s*: for each line and mode, `checkFeeding` returns, its report survives `JSON.parse(JSON.stringify(…))` unchanged, its static findings are `phase: 'static'` and come first, and it takes under 5,000 ms.
- *finds that today's routed lines move nothing* (research §4.1 items 1, 3, 4; Global Constraints' gate): for each line in `routed` — for every machine node, a static `feed_no_route` certain for each item its steps make (its new Item Extractor Chip) and a static `feed_starved` certain for each supply item it takes (the input chest's); the static R6 `feed_no_route` findings name exactly the items laid steps make whose every flow goes to a step without machines (computed from the plan: in `ec-user` the research names Copper Wire, Fine Copper Wire, Glass Tube, Red Alloy Bolt, Steel Rod and Wood Plank); a static `feed_churn` certain for every input bus whose pipe has an Item Extractor Chip (the `vacuum-tube` Electric Blast Furnaces); a static `feed_crowded` risk for every basic machine taking 2+ item kinds; in `steady`, a `feed_starved` for every planned input of every machine; `ok` false.
- *runs Red Alloy on AE2 cleanly and finds the others stuck* (research §4.2): for each line in `ae2`, the static `feed_pattern_unencodable` findings are exactly the interfaces whose plan step lists a fluid or an item amount that is not whole (computed from the plan steps); `red-alloy` has no finding at all and `ok` true; `motor-lv` in `steady` has `feed_starved` for the 1x Tin Wire of the machine whose step makes 1x Tin Cable, its text ending `which Advanced Chemical Reactor makes but the line pipes away, so it never comes back to ME`, and with `ae2FluidStock: true` that machine has `feed_fluid_packet` (the `'slot'` text, Molten Rubber); `vacuum-tube`, `ec-user` and `ec-user-auto` in `steady` have `feed_starved` for every planned input of every AE2 machine, with the cause `the AE2 job cannot be planned: the pattern for … holds …× …: a pattern holds whole items`.
- *crowds EnderIO machines only with Multi Stack Input On* (research §4.3): for each line in `enderio`, no `feed_crowded` in `steady`; in `multistack_on`, a `feed_crowded` on every basic machine taking 2+ item kinds that all come from the input chest (every item flow into its step comes from `raw` or a step without machines: in `red-alloy` both Alloy Smelters, in `ec-user` its Alloy Smelter); the console lists the other machines with `feed_crowded` there (the research also names the Circuit Assembler).
- *previews fix/feeding's routed chips* (research §6.4 item 1): each `routed` layout with every Extractor Chip's whitelist set to its machine's outputs (the input chest's: its supply) through `feed.chips` → no static `feed_no_route` from R5a, no `feed_starved` whose cause names a new Extractor Chip, and in `multistack_on` a `feed_crowded` on every input-chest-fed 2+ kind machine, as in EnderIO; R6's findings stay (fix/feeding also widens the output chest's whitelist).

- [ ] **Step 2: Run it on the real export**

Run: `GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=$PWD/data/real-config.json npx vitest run tests/unit/layout/real-feeding.test.ts`
Expected: PASS, 15 console lines for the default runs (9 without the reference file) and one more per AE2 line for `ae2FluidStock`. A failure is a finding: where the checker disagrees with research §4 or with an assertion here, reread the evidence (the research's tags, then this plan's E1–E17) and decide which is wrong. A model bug: fix the model and say which in the commit message — never loosen an assertion to let a model bug pass. A wrong prediction: several assertions above are hand predictions (that `vacuum-tube` and `ec-user` starve every planned input of every AE2 machine, for instance, assumes each line's fractional key is one its job needs); when the evidence shows the prediction was wrong, correct the assertion to what the evidence shows and give the evidence and the reason in the commit message.

- [ ] **Step 3: Run the whole suite**

Run: `npm run typecheck && npm test`
Expected: PASS, the real-data file skipped without `GTNH_LOCAL`.

- [ ] **Step 4: Commit**

```bash
git add tests/unit/layout/real-feeding.test.ts
git commit -m "test(feeding): the research's probe lines in routed, AE2 and EnderIO as main lays them out

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Open questions (each with a recommendation)

1. **Where the contract lives.** The rule "new files only, in `src/server/layout/feeding/`" puts `FeedSpec` in `contract.ts`, which shared code cannot import. *Recommendation:* the lane that adds `LayoutBlock.feed?` (fix/feeding) moves the `FeedSpec` types unchanged to `src/shared/types/feed.ts` and leaves `contract.ts` re-exporting them, so the Connections view and the 3D view can show chips, patterns and bench grids from the same types.
2. **Who writes the static rules.** Research §7 gives them to the fix lane; this plan builds them as `precheckFeeding` beside the simulation. *Recommendation:* fix/feeding calls `precheckFeeding` from `layoutLine` and turns each finding into a layout warning, rather than writing the rules a second time; if fix/feeding lands first, it writes its warnings from Task 3's rule table with the same codes and texts and switches to the import when this lane merges.
3. **The gate.** Research §7's acceptance list alone lets a line that moves nothing pass (today's routed lines raise only `feed_starved` and `feed_no_route`). *Recommendation:* gate on the research's six codes plus `feed_no_route`, `feed_pattern_unencodable` and `feed_starved`, `certain` findings only, as the Codes table says; `feed_slow`, `feed_leak`, `feed_overfill` and `feed_churn` stay warnings.
4. **Exported slot counts.** add-on 20's committed plan does not yet name the fields. *Recommendation:* add-on 20 adds `Machine.itemInSlots?` and `itemOutSlots?` with exactly these names (architecture entry 50 item 5); `basicSlots` already prefers them.
5. **Project Red's listing order.** The extractor's `getAllItemStacks` is a hash map in the jar; the checker uses first-slot order, so a run is reproducible. *Recommendation:* accept: the order only matters when an extractor lists an input item, which static rule R5b reports whatever the order.
6. **GT pipes' random start side.** `sendItemStack` starts at a random side; the checker uses sides 0–5 in order. *Recommendation:* accept: it only matters when two sides of one pipe cell take the same item, which add-on 15's lanes and its rules checker never allow.
7. **Stack sizes.** The export has none, so every item stacks to 64 here (Fluid Packets and GT tools 1), which is wrong for buckets, ender pearls and the like and moves research §3.6's 8-slot rule for them. *Recommendation:* the exporter's next minor writes an optional `maxStack` per item that differs from 64; the checker reads it when present (one line in `stackLimit`), and names `stack_sizes` as unknown until then.
8. **Input Separation defaults.** `separationDefault` comes from `INPUT_SEPARATION_DEFAULT`, the 69 controller classes whose `supportsInputSeparation()` resolves to true in this pack's GT jar (E15), which a pack update can leave stale. *Recommendation:* the exporter records `supportsInputSeparation()` per controller (an optional machine field) before add-on 15 lays two or more buses on a multiblock in a later pack; `separationDefault` then reads it and keeps the list as the fallback. R4 stays a risk (the layout can set `inputSeparation`), and the simulation's `feed_crowded` gates the deadlock either way.
9. **Fluids.** Piped fluids are pooled per fluid, not routed, so a mis-set fluid conduit face or pipe is not found here. *Recommendation:* accept for item feeding; if a fluid misroute appears, extend the checker with EnderIO fluid faces and GT fluid pipes in a later add-on.
10. **AE2 assumptions.** One job sized for twice the run, a CPU without co-processors, ME holding no line fluid (`ae2FluidStock` false). *Recommendation:* accept; a world scan that finds the base's crafting CPUs can pass `ae2Coprocessors` later.
11. **The cost of a check.** Five scenarios of 20 minutes each, under 1 s for 1,200 blocks on this host. *Recommendation:* keep the defaults for the gates (add-on 12 Task 8, add-on 15 Task 8); an on-demand check from the UI, if one is added, may pass a smaller `ticks`.
12. **What stays UNVERIFIED in game** (research §8; E7 settled the Stock Keeper reset question from the bytecode). *Recommendation:* the user checks once in game, when convenient: an EnderIO input chest face with two items keeps pushing the first while a target takes it (E5); a Limited Item Filter on an In / Out face toward a bench stops at its count; a bench flooded with one ingredient in slots 0–7 loses stacks in one update (§1.3.2); a Stock Keeper beside an Auto Workbench keeps its slowdown while the bench's contents change (E7). A difference goes back to the research and the model it concerns.
13. **Blocking-ignore items the export lacks.** GT++'s Special lens has no export key, and AE2's Name Press (`appliedenergistics2:item.ItemMultiMaterial@21`) is not in the export, though its meta is read from the jar (E12). *Recommendation:* the exporter's next minor lists what AE2's `BlockingModeIgnoreItemRegistry` holds once the pack has loaded (exact stacks and whole items); `ignoredByBlocking` then reads that list and keeps E12's as the fallback. Until then a machine holding the Special lens raises R9's `feed_starved`; no plan holds one today.
14. **A raw input reaching an output chest** (Task 10's last case). `feed_leak` does not gate, and on main's machine-to-machine tail every raw input goes to the output chest first. *Recommendation:* keep `feed_leak` a warning: what it causes gates already — the machines it starves raise `feed_starved` while the chest still has room, and the full chest raises `feed_no_route` once it holds 27 stacks; add-on 15's lanes remove the case. Revisit if a line leaks without either.
15. **Output chests are emptied of the line's products.** The model takes an item the plan sends out of an output chest as it arrives, so a correct line never fills its chest in 20 minutes, and only items the plan did not send there fill it (Task 4 rule 9). *Recommendation:* accept: a full output chest is the player's to empty or hook up, not a feeding fault; the 27 slots matter only for leaked items, where the stop is real.
16. **Approximations in Project Red's timing.** The model gives a payload ⌈(hops + 1) × 100 / boost⌉ ticks from dispatch, leaving out the extra move a payload can make in a tick when a pipe hands it to one that updates later in that tick, and it keeps a wanderer at the pipe where it lost its way instead of following its random walk (`pr_wander_path`). *Recommendation:* accept: arrivals can come a tick or so early per pipe in game, and the findings (transit counted from dispatch, overshoot, bounces, lost queues) do not depend on it.
