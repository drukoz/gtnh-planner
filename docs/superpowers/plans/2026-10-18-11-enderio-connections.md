# EnderIO Conduits and Connections View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the fourth logistics mode, **EnderIO conduits** — item and ender fluid conduits in bundles, every face that touches a machine or chest set to Extract (EnderIO `INPUT`), Insert (`OUTPUT`), In / Out or Disabled, each with its own extract filter, insert filter, extract colour and insert colour, plus speed upgrades, priority, round robin, self feed and redstone mode — and a **Connections** project tab that draws any planned line, in all four modes, as a schematic graph whose boxes and faces show every part's exact configuration.

**Architecture:** A new mode module (`src/server/layout/modes/enderio.ts`) lays an Item Conduit on Plan 5's spine and an Ender Fluid Conduit network from every fluid port, sharing cells as one bundle block; a pure planner (`src/server/layout/conduits.ts`) sizes speed upgrades, filters and the fluid conduit tier and hands out channel colours by the plan's flows. Every conduit's per-face settings live in a new optional `LayoutBlock.conduits`, which the steps, parts list, map overlay, 3D scene and the new Connections model (`src/client/connections/model.ts`) all read through one shared formatter, so the build steps, hover text and Connections panel say the same words.

**Tech Stack:** TypeScript 6.0.3 (erasable syntax), Node 24, React 19.3.0, three 0.186.1, elkjs 0.12.0, vitest 5.0.3, Playwright 1.63.0 — no new dependencies.

**Spec:** `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` §3.6 (mode 4 "EnderIO conduits", piping first-class), §3.7, §3.8, §3.8c (Connections view), §3.10; architecture `docs/superpowers/plans/2026-10-17-00-architecture.md` §6.7, §7.1–§7.2, §10, §11.13, §11.14, §11.30; Plan 5 `docs/superpowers/plans/2026-10-17-05-line-layout-3d.md` ("How a layout is built", Tasks 7–8, 10, 13–16). The spec lines for mode 4 and §3.8c and architecture §11.29–§11.30 are on `main` (commit 8b6ce71 and its neighbours); Task 1 Step 1 brings them here.

## Global Constraints

- Never touch the live server: no start, stop or writes to its folder; world reads are read-only. The pack's EnderIO jar and `config/enderio/EnderIO.cfg` were read only to pin the numbers below; nothing from them is committed (architecture §2.1).
- Nothing game-derived or private is committed: exports, textures, world scans, project data, config, local notes. Tests use synthetic fixtures from `tests/helpers/` only; real-data checks are guarded by `process.env.GTNH_LOCAL === '1'` and print only counts and codes (architecture §2.2, §10).
- TypeScript erasable syntax only: no `enum`, `namespace`, parameter properties, decorators or `<T>x`; enums are `as const` objects; real `.ts` extensions in imports; `import type` for types (architecture §2.3, §4).
- Node `>=24.10.0 <25`; no new npm dependencies (three 0.186.1, elkjs 0.12.0, react 19.3.0 are already pinned).
- Commits are conventional (`feat:`, `fix:`, `test:`, `docs:`) and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Nothing in the architecture is renamed or reshaped: only optional additions, each listed under "Architecture change requests" at the end.
- `src/shared/` stays pure TypeScript for both sides: no `node:*`, no DOM.
- Every order and tie-break is fixed: the same plan and pack give the same layout, colours, steps and graph (Plan 5 rule).
- Spec §3.6 mode 4, verbatim: "item conduits (and fluid conduits for fluids) in conduit bundles along the line, each machine face set to extract / insert / both with a channel colour, EnderIO item filters (basic/advanced, whitelist/blacklist, the exact items) where a face must only pass certain items, and redstone control where needed. Power still runs over GT cables (GT machines take EU)."
- Spec §3.6 piping first-class: every conduit, filter and upgrade is (1) in the build cost (`Layout.bom`, group `logistics`) with its exact configuration in the build steps, (2) sized to the rates it carries, (3) in the build steps, (4) drawn on the map and in the 3D view.
- Spec §3.8c: the Connections view shows every placed machine, chest, interface, conduit run and hookup, which output goes into which input and over what, and every face's configuration.
- User requirement (binding): EnderIO has both input and output — every conduit face is modelled with a separate extract side and insert side (own filter, own colour); the EnderIO GUI calls them "Extract" (code `INPUT`) and "Insert" (code `OUTPUT`).
- The plan ends with `npm run typecheck && npm test` green and its own end-to-end check (architecture §10).

## Review Focus

The input classes the spec implies that are most likely to bite, each pinned by a test in the task that owns the code:

1. **One item, several consumers plus surplus** (a dust two machines take and the rest goes to the output chest): every planned consumer must be reachable on one channel and fed before the chest — machine insert faces priority 1, chest faces 0, and round robin off on the extracting face, because EnderIO's round robin takes turns over every target whatever its priority (see "As built"). Tests: Task 3 "joins a shared item into one channel and fills machines before the chest" and "round robins only between machine faces, so a surplus for the output chest never takes a machine's share".
2. **A step whose machines are all reused (owned, not placed), or an output no flow carries** (a chance byproduct): its items must still leave through the output chest or arrive through the input chest, so no machine clogs. Test: Task 3 "sends items for owned machines and unplanned byproducts through the chests".
3. **Many different items on one face** (an assembler with 6–12 inputs): the filter grows Basic (5 slots) → Advanced (10) → Big (24); more than 24 keeps 24 and warns `filter_full`. Tests: Task 2 "picks the smallest item filter that holds the keys", Task 3 "uses an Advanced Item Filter for six inputs and warns past 24".
4. **A rotated line** (90/180/270°): every conduit face, its links and its configure-step text turn with the line. Test: Task 5 "turns every conduit face with the line".
5. **An extract face left at EnderIO's unset redstone default**: `ItemConduit.getExtractionRedstoneMode` falls back to `ON` ("Active with signal"), so a face nobody sets never extracts. Such a face is Extract (`INPUT`: `ItemConduit` and `AbstractLiquidConduit` override `AbstractConduit`'s `IN_OUT` in `getDefaultConnectionMode`) and Green on both sides (`getInputColor` and `getOutputColor` fall back to `GREEN`), so it never inserts and extracts only with a signal. Every extract face is written with redstone `ignore` ("Always active") and its step says so. Tests: Task 3 "sets every extract face to Always active", Task 2 face text.

## As built

The code differs from the first version of this plan where a ruling of its execution (pre-flight rulings R1–R25, the task reviews, the final whole-branch review) changed or read it. The lines below that stated a superseded value now state the built one; in brief:

- **Base and merge (R1–R7, R25).** Built on Plan 5 Tasks 1–14: Task 1 Step 1 merged only `main`, and what needed Plan 5 Tasks 15–16 waited for the final merge of `main`, which applied it: `meshOf` places each 3D instance by `instanceTranslation` and `loadSceneInputs` asks for every block's `sceneBlockRefs` (F1, F2), the end-to-end test checks the 3D block list again (F3), the tabs read Map, 3D, Connections (F5) and the README keeps both sections (F6). F4 (the e2e line parts read `PART_ITEMS`) and F7 (§11.38 is free on `main`) needed nothing. The granted change requests are architecture §11.38 "EnderIO conduits, granted change requests (add-on 11)", cited by title (R3); Plan 5's part-count pin is 24 (R4); at the merge, the hookup keep-off below is checked in Plan 5's `clearOfLine`, beside its line box.
- **Round robin (final review).** EnderIO's round robin turns over every target of a face whatever its priority (`NetworkedInventory.getTargetIterator` hands out EnderCore 0.5.15's `RoundRobinIterator` over the priority-sorted targets, whose index only moves on), and a face's targets are every other face whose insert colour is its extract colour, the filter deciding (`NetworkedInventory.updateInsertOrder`). So an item extract side round robins only when it can hand to two or more insert sides of its colour that pass one of its items and all of them are machine faces of one priority, never toward a chest; a fluid extract side, whose faces have no priority (without round robin the face that took fluid last is tried first, `EnderLiquidConduitNetwork$TankIterator.rewind`), round robins for any two or more; and a fluid a face hands both to machines and to an open end gets `conduit_share`.
- **Hookup (R13, R14 and its Task 5 widening, final review).** The hookup's end face inserts into the input chest at priority 1, above the base network's own Insert faces (EnderIO's default 0), and the storage-tap step says "Extract (In / Out if it already inserts)", since a storage face that inserts stops storing when set to Extract alone. The hookup keeps off every cell next to a line Item Conduit, machine, hatch or chest but the input chest (`RouteWorld.keepOff`), goal cells included; only a last cell that touches the port gets the end face.
- **Items (R9, R10, R11, R15, Task 3 review).** The input chest's face warns `conduit_rate` too, without a `stepId`; every input-bus face of a multiblock takes all of the step's item inputs and every output-bus face gives all of its outputs; a face text reads "with an Advanced Item Filter"; the `layout:conduit:…` steps follow Plan 5's configure steps and come before the configure drafts; a tail chest face is rated by the flows that cross the line there.
- **Fluids (Task 4 rulings).** No GT fluid pipe or pump cover is laid (`fluids: []` under `ownsFluids`, with no extra keep-off for cables); pruning drops cells with at most one link; an open end is laid only for a fluid whose flow crosses the line's edge; the fluids step says "1 of them goes"; an insert-only `conduit_rate` names Stellar's 1,600,000 L/s max IO; an ender fluid conduit's `filter_full` says "holds 5 fluids"; `route_failed` is raised once per step and text; the tanks step names the open ends' side by the line's shape, not by compass.
- **Steps (R12).** The power head of Task 5's test line is 3 columns wide, so its spine starts at local x 3; with Plan 5's tier spacing (from the merge) x 4 stays empty, and the conduit step ids are those of Task 5's test 1 below.
- **Connections (R18–R23, Task 7 and 8 rulings).** `raw` and `out` exist when a link or a loose conduit face row needs them; a chest box carries its tail side; a logistics hookup's link goes to the box its end block points at, else the input chest, else `raw`, else nowhere (R20 as amended); hookup boxes are ELK `FIRST_SEPARATE`; a picked link with no label is titled by its first line; an interface's config is its lines, not a face; `connectionsFromElk` lives in `model.ts`; boxes stay 260 px wide with a `<title>` tooltip and cut texts ending in '…'; the picture's svg is `role="group"`.
- **Checks and docs (R8, R16, R17, R22, R24, Task 9 review).** The real-data check runs on a worktree-local config without secrets, and the look of the line on real data is left to the user; the plan's fixtures are copied into `tests/helpers/enderio-fixtures.ts`; the curated case is in `curated.test.ts`; the README says the line plans no redstone signal control; the real-data test prints the pack's part rows; the end-to-end link check is `[data-edge^="flow:"]:has(polyline[stroke])`, because Chromium gives a straight polyline an empty box.

---

## How the EnderIO mode works (read once; every task refers to it)

Plan 5's grid is unchanged: units in rows N and S face the spine (`z = spineZ`, `y = 0`), the power head is `x < firstX`, the tail is `x = tailX`, fluid ports sit on the cell above a singleblock or above a multiblock's fluid hatch (`UnitPorts.fluidIn/fluidOut`). Power stays on Plan 5's GT cable runs and transformer banks.

```
 local z ↓   x →   0      1 … (units) …            tailX
 1  row N       [run]  [M][M][M]                     [in chest]
 2  spine       [run]  [≡][≡][≡][≡][≡][≡][≡][≡][≡]   [≡] → east face: open fluid end ("your tank")
 3  row S       [run]  [M][M]                        [out chest] (more stacked above, one per 24 items)
 ≡ = Item Conduit; a bundle where the Ender Fluid Conduit shares the cell. Fluid risers run up to the fluid ports.
```

**Items.** One Item Conduit on every spine cell `[firstX … tailX] × (0, spineZ)` when any unit moves items. Every spine cell's face toward a unit's item port is configured:

| Neighbour behind the port | Mode | Extract side | Insert side |
|---|---|---|---|
| singleblock that takes and makes items | In / Out (`in_out`) | its item outputs (all of `step.outputs` item keys) | its item inputs (`stepItemInputs`) |
| singleblock that only takes / only makes | Insert / Extract | — / outputs | inputs / — |
| multiblock input bus / output bus | Insert / Extract | all of the step's item outputs, on every output bus (ruling R10) | all of its item inputs, on every input bus (R10) |
| input chest (north of the tail cell) | Extract | the input-chest keys | — |
| output chest `j` (south of tail cell `j`) | Insert | — | its 24-key slice of the output-chest keys |
| any other machine, item bus or chest it touches | Disabled | — | — |

A singleblock that takes items gets `config.inputFromOutputSide = true` (its front is its output side). Input-chest keys = item keys of flows from outside the line (`raw` or a step without placed units) into a placed step. Output-chest keys = item keys of flows from a placed step to outside (`out`, `sink`, a step without placed units) plus item outputs of placed steps that no flow carries.

**Each side's settings.** Filter: the exact keys, whitelist, smallest of Basic Item Filter (5 slots, `EnderIO:itemBasicFilterUpgrade@0`), Advanced Item Filter (10, `@1`), Big Item Filter (24, `EnderIO:itemBigFilterUpgrade@0`); match meta on, match NBT only when a key carries an NBT suffix (`#…`), ore dictionary off, sticky off (EnderIO's own defaults are meta on, NBT on, `ItemFilter.DEFAULT_MBT`). Extract: speed upgrades = the fewest Item Conduit Speed Upgrades (`EnderIO:itemExtractSpeedUpgrade@0`) for the face's rate, round robin on only when it can hand to two or more insert faces (the insert faces of its colour whose filter passes one of its items) and all of them are machine faces of one priority, self feed off, redstone Always active. Insert: priority 1 on machines, 0 on chests (higher is filled first: `NetworkedInventory$Target.compareTo` orders sticky targets, then priority descending, then distance), so consumers are fed before surplus reaches a chest.

**Rates (EnderIO 2.10.46, checked in the jar).** An item conduit face extracts `SpeedUpgrade.BASE_MAX_EXTRACTED` = 4 items plus 4 per speed upgrade (at most `maxStackSize` 15) per extraction and then waits `round(n × 10 / max)` ticks (`ItemConduit.getTickTimePerItem` = 10 / max, `NetworkedInventory.itemExtracted`), so a face moves `2 × (4 + 4·min(n, 15))` items/s: 8 with none, 128 with 15. Ender fluid conduits (`Config` defaults, unchanged in the pack's `EnderIO.cfg`): extract / max IO per face in mB per tick — Ender 200 / 800 (`EnderIO:itemLiquidConduit@2`), Crystalline Ender 1000 / 4000 (`@3`), Crystalline Pink Slime Ender 2000 / 8000 (`@4`), Melodic Ender 10000 / 40000 (`@5`), Stellar Ender 20000 / 80000 (`@6`). The basic and pressurized fluid conduits (`@0`, `@1`) carry one fluid per network and have no channels, so the mode never uses them.

**Channels.** Ends = every extract side and insert side, in order of conduit position (x, y, z), then face (`FACES` order), extract before insert. Links follow the plan's flows: each flow of key `k` links every extract end that carries `k` at its source (the producing step's faces, or the input chest / open fluid end) to every insert end that takes `k` at its target (the consuming step's faces, or the output chest / open fluid end); a stray output links its machine to its output chest. Linked ends form one channel. Channels get `CHANNEL_PALETTE` colours in order of their first end — red, blue, yellow, orange, purple, cyan, magenta, lime, pink, light blue, brown, white, black, gray, light gray — never green, EnderIO's default (`ItemConduit.getInputColor` falls back to `GREEN`), so a base network's unconfigured faces never trade with the line. Past 15 channels a colour is reused only by a channel that shares no key with the channels already on it; if every colour shares a key, the colour with the fewest shared keys is reused and `conduit_channels` names them. Item and fluid conduits are separate networks with their own channel sets.

**Fluids.** When any unit moves fluids the mode lays one Ender-family fluid network and Plan 5's internal routing lays no GT fluid pipes and no pump covers (`ModeResult.ownsFluids`). Open ends: one per fluid that enters or leaves the line, that is whose flow crosses the line's edge (`FluidNet.atTail` less the nets whose only flows outside the line pass it by), in key order, at `[tailX, i, spineZ]`, each with its east face toward "your tank". The network starts as the spine cells (linked along x) plus the open-end column (linked up from the tail cell); `growTree` (Plan 5 Task 2) adds a riser from every fluid port to the nearest network cell (passable: inside the box, `x ≥ firstX`, free or holding an Item Conduit, not a power port); then cells with at most one link that are neither a port nor an open end are dropped until none is left. A cell that also holds the Item Conduit becomes a bundle. A port's face toward its unit (the side down) is Extract, Insert or In / Out by which fluids the unit makes and takes there; an open end is Extract for a raw fluid, Insert for a fluid that leaves, In / Out for both. Fluid filters are the conduit's own 5-slot `FluidFilter` (no item). The tier is the first in the table whose `extract × 20` covers the busiest extract face (L/s) and whose `maxIo × 20` covers the busiest insert face; faces toward singleblock machines and fluid hatches that are not ports are Disabled. A fluid extract face round robins when it can hand to two or more faces (fluid conduits have no priority, and without round robin the face that took fluid last is tried first), and a fluid it hands both to machines and to an open end gets a `conduit_share` warning.

**Hookup.** With an EnderIO item network at the base (`chooseLogisticsNetwork(…, 'enderio')`), Plan 5's logistics hookup lays Item Conduits from the tap to the input chest; its last cell inserts into the chest on Green with the input-chest whitelist at priority 1, above the Insert faces already on the base's network (EnderIO's default 0), so the raw inputs come to the line before any other storage on Green; the base's storage face is a drafted configure step ("set to Extract (In / Out if it already inserts); extract on Green with …"), and its filter is a parts line. Without one, a step says to fill the input chest by hand. The line never uses Green, and the hookup keeps off every cell next to the line's Item Conduits, machines, hatches and chests but the input chest (rulings R14 and its Task 5 widening): touching item conduits join one network, and an item conduit joins any inventory it touches with an unset face of its own.

**Not placed:** conduit facades (they only hide conduits), basic or pressurized fluid conduits, power or redstone conduits.

## File map

| File | Responsibility |
|---|---|
| `src/shared/types/plan.ts` | `LogisticsMode.EnderIO = 'enderio'` |
| `src/shared/types/layout.ts` | EnderIO face types (`ConduitSpec`, `ConduitFace`, …), `TailChest`, optional `LayoutBlock.conduits` and `LayoutBlock.tail` |
| `src/shared/layout/enderio.ts` | EnderIO facts and names: dye colours, channel palette, mode / redstone names, item face rate, fluid conduit table, filter slots, conduit names; `hookupNetworkKind` (Task 6) |
| `src/shared/layout/configure-text.ts` | + the words for a conduit face and filter (`conduitFaceText`, `conduitSideText`, `conduitLines`) |
| `src/shared/world/storage-totals.ts` | `ReachMode` + `'enderio'` |
| `src/server/layout/parts.ts` | + advanced / big filters, speed upgrade, the five ender fluid conduits |
| `src/server/layout/conduits.ts` | speed upgrades, filters, fluid conduit tier, channel colours (pure) |
| `src/server/layout/modes/enderio.ts` | the EnderIO mode: item spine, faces, tail chests, open fluid ends, fluid network, bundles, hookup end face, drafts |
| `src/server/layout/modes/mode.ts`, `arrange.ts`, `layout.ts`, `hookups.ts`, `steps.ts`, `modes/direct.ts`, `modes/routed.ts` | dispatch and port spacing; `LocalBlock` mirrors; `ownsFluids` and world rotation of conduits; hookup end face and `MODE_KINDS`; one configure step per conduit face and the conduit parts; `tail` on the other modes' chests |
| `src/server/planner/steps.ts` | Plan 2's logistics step text for `enderio` |
| `src/server/assets/curated.ts` | pseudo blocks for the ender fluid conduits and the three connector textures |
| `src/client/views/SettingsPanel.tsx` | the "EnderIO conduits" choice |
| `src/client/map/layout-overlay.ts` | conduit columns in the EnderIO colour, configured-face dots, EnderIO hookup colour |
| `src/client/three/scene-data.ts`, `load-textures.ts`, `renderer.ts` | bundles as side-by-side cores and arms with connector arms, `sceneBlockRefs`, conduit lines in hover/click and the block list, instance offsets |
| `src/client/connections/model.ts` | the Connections graph of a layout and plan, its ELK graph, picking (pure) |
| `src/client/views/ConnectionsView.tsx`, `project-tabs.ts`, `styles.css` | the `connections` tab |
| `tests/helpers/layout-fixtures.ts` | + the new part items |
| `tests/unit/layout/{enderio-facts,conduits,mode-enderio,mode-enderio-fluids,enderio-layout,connections-graph,real-enderio}.test.ts`, `tests/unit/assets/curated.test.ts`, `tests/client/{scene-conduits,connections-model,connections-view}.test.tsx`, `tests/e2e/connections.spec.ts` | tests |

## Task outline

1. The `enderio` mode value end to end, EnderIO types, facts and parts
2. Conduit sizing, channel colours and the words for a face (pure)
3. EnderIO mode — item conduits, faces, chests, hookup end face
4. EnderIO mode — fluid conduits, bundles and open ends
5. Layout integration — rotation, one configure step per face, parts list, hookup, chest tails
6. Map overlay and 3D view of conduits
7. Connections graph model for all four modes (pure)
8. Connections tab
9. End-to-end check, real-data check, README

---
### Task 1: The `enderio` mode value end to end, EnderIO types, facts and parts

**Files:**
- Merge (Step 1): `plan/05-line-layout-3d` (Plan 5 complete: `View3D`, `load-textures.ts`, `renderer.ts`, `tests/e2e/layout.spec.ts`, `tests/helpers/line-parts-export.ts`) and `main` (spec §3.6 mode 4, §3.8c; architecture §11.29–§11.30)
- Create: `src/shared/layout/enderio.ts`
- Modify: `src/shared/types/plan.ts:8` (`LogisticsMode`), `src/shared/types/layout.ts` (types below, `LayoutBlock`), `src/server/layout/arrange.ts:22-25` (`LocalBlock` mirrors the two new fields), `src/shared/world/storage-totals.ts:9-25`, `src/server/planner/steps.ts:19-23` (`LOGISTICS_TEXT`), `src/server/layout/hookups.ts:42-44` (`MODE_KINDS`), `src/server/layout/modes/mode.ts:57` (`PORT_SPACING`), `src/server/layout/parts.ts:22-57` (`PartId`, `PART_DEFS`), `src/client/views/SettingsPanel.tsx:37-41` (`LOGISTICS`), `tests/helpers/layout-fixtures.ts:152-171` (`PART_ITEMS`)
- Test: `tests/unit/layout/enderio-facts.test.ts`, `tests/client/settings.test.tsx`

**Interfaces:**
- Consumes: Plan 5 `resolveParts`, `partDef`, `PART_DEFS`, `Part`, `Parts`, `PartId` (`src/server/layout/parts.ts`), `chooseLogisticsNetwork` (`hookups.ts`), `PORT_SPACING` (`modes/mode.ts`), `LocalBlock` (`arrange.ts`); Plan 3 `conduitBlockRef`, `Face`, `FACES` (`src/shared/types/assets.ts`); Plan 2 `validateOp`, `LogisticsMode`; Plan 4 `reachKinds`; fixtures `layoutPack`, `makeScan`.
- Produces (every later task uses these names):
  ```ts
  // src/shared/types/layout.ts — optional additions (architecture change request 1)
  /** The conduits a line lays; `conduit:<kind>` is the pseudo block of Plan 3's curated table. */
  export type ConduitKind = 'item' | 'liquid_ender' | 'liquid_crystalline' | 'liquid_pink_slime' | 'liquid_melodic' | 'liquid_stellar';
  /** EnderIO `ConnectionMode` (NBT `conModes`): extract = INPUT (1), insert = OUTPUT (2), in_out = IN_OUT (0), disabled = DISABLED (3). */
  export type ConduitMode = 'extract' | 'insert' | 'in_out' | 'disabled';
  /** EnderIO `DyeColor` in ordinal order (NBT `inSC.<DIR>` / `outSC.<DIR>`). */
  export type DyeColor = 'black' | 'red' | 'green' | 'brown' | 'blue' | 'purple' | 'cyan' | 'silver' | 'gray' | 'pink' | 'lime' | 'yellow' | 'light_blue' | 'magenta' | 'orange' | 'white';
  /** EnderIO `RedstoneControlMode` IGNORE, ON, OFF, NEVER (NBT `extRM.<DIR>`). */
  export type RedstoneMode = 'ignore' | 'on' | 'off' | 'never';
  export interface ConduitFilter {
    /** The filter upgrade in the slot; absent for an ender fluid conduit's own fluid filter. */
    item?: StuffKey;
    whitelist: boolean; keys: StuffKey[];
    /** Item filters only. */
    matchMeta?: boolean; matchNbt?: boolean; oreDict?: boolean; sticky?: boolean;
  }
  export interface ConduitExtract {
    color: DyeColor; filter: ConduitFilter | null; /** items/s or L/s the face must move */ rate: number; roundRobin: boolean; redstone: RedstoneMode;
    /** Item conduits only; `speed` is absent when no upgrade is needed. */
    selfFeed?: boolean; speed?: { item: StuffKey; count: number };
  }
  export interface ConduitInsert { color: DyeColor; filter: ConduitFilter | null; rate: number; /** item conduits only; higher is filled first */ priority?: number }
  /** `extract` iff mode is extract or in_out, `insert` iff insert or in_out; `target` names what is on that side. */
  export interface ConduitFace { face: Face; mode: ConduitMode; target: string; extract?: ConduitExtract; insert?: ConduitInsert }
  /** `connections`: links to the same kind in neighbouring cells, bits `1 << side`; `faces` in `FACES` order. */
  export interface ConduitSpec { kind: ConduitKind; item: StuffKey; connections: number; faces: ConduitFace[] }
  /** A tail chest: where raw inputs go in, or which final outputs it collects. */
  export interface TailChest { side: 'input' | 'output'; keys: StuffKey[] }
  // LayoutBlock (and LocalBlock in arrange.ts) gain:
  //   /** A conduit bundle's conduits, item first; the block's `connections` = OR of each conduit's links and its non-disabled face bits. */
  //   conduits?: ConduitSpec[];
  //   tail?: TailChest;
  ```
  ```ts
  // src/shared/layout/enderio.ts
  export const DYE_COLORS: readonly DyeColor[];               // ordinal order, as the type
  export const DYE_NAMES: Readonly<Record<DyeColor, string>>; // 'Black', 'Red', 'Green', 'Brown', 'Blue', 'Purple', 'Cyan', 'Light Gray' (silver), 'Gray', 'Pink', 'Lime', 'Yellow', 'Light Blue', 'Magenta', 'Orange', 'White'
  export const DYE_HEX: Readonly<Record<DyeColor, string>>;   // black #1d1d21, red #b02e26, green #5e7c16, brown #835432, blue #3c44aa, purple #8932b8, cyan #169c9c, silver #9d9d97, gray #474f52, pink #f38baa, lime #80c71f, yellow #fed83d, light_blue #3ab3da, magenta #c74ebd, orange #f9801d, white #f9fffe
  export const DEFAULT_CHANNEL: DyeColor;                     // 'green'
  export const CHANNEL_PALETTE: readonly DyeColor[];          // red, blue, yellow, orange, purple, cyan, magenta, lime, pink, light_blue, brown, white, black, gray, silver
  export const CONDUIT_MODE_NAMES: Readonly<Record<ConduitMode, string>>;   // Extract, Insert, In / Out, Disabled (en_US.lang gui.conduit.ioMode.*)
  export const REDSTONE_NAMES: Readonly<Record<RedstoneMode, string>>;      // Always active, Active with signal, Active without signal, Never active
  export const CONDUIT_NAMES: Readonly<Record<ConduitKind, string>>;        // Item Conduit, Ender Fluid Conduit, Crystalline Ender Fluid Conduit, Crystalline Pink Slime Ender Fluid Conduit, Melodic Ender Fluid Conduit, Stellar Ender Fluid Conduit
  export const ITEM_CONDUIT: { readonly baseExtract: 4; readonly perUpgrade: 4; readonly maxUpgrades: 15; readonly ticksPerExtraction: 10 };
  /** Items/s one face moves with `upgrades` speed upgrades: 20 / 10 × (4 + 4 × min(upgrades, 15)). */
  export function itemFaceRate(upgrades: number): number;
  export interface FluidConduitRow { kind: ConduitKind; meta: number; extractPerTick: number; maxIoPerTick: number }   // mB per tick
  export const FLUID_CONDUITS: readonly FluidConduitRow[];    // ender 2/200/800, crystalline 3/1000/4000, pink slime 4/2000/8000, melodic 5/10000/40000, stellar 6/20000/80000
  export const ITEM_FILTER_SLOTS: { readonly basic: 5; readonly advanced: 10; readonly big: 24 };
  export const FLUID_FILTER_SLOTS: 5;
  ```
  - `PartId` gains `'eio_advanced_filter' | 'eio_big_filter' | 'eio_speed_upgrade' | 'eio_fluid_ender' | 'eio_fluid_crystalline' | 'eio_fluid_pink_slime' | 'eio_fluid_melodic' | 'eio_fluid_stellar'`, with `PART_DEFS` rows `partDef('Advanced Item Filter', 'EnderIO:itemBasicFilterUpgrade@1', 'item')`, `partDef('Big Item Filter', 'EnderIO:itemBigFilterUpgrade@0', 'item')`, `partDef('Item Conduit Speed Upgrade', 'EnderIO:itemExtractSpeedUpgrade@0', 'item')`, and, for each of the five fluid conduits, `partDef(CONDUIT_NAMES[kind], 'EnderIO:itemLiquidConduit@<meta>', conduitBlockRef(kind))` (metas 2–6 from `FLUID_CONDUITS`; the names are the pack's item names).
  - `LogisticsMode.EnderIO = 'enderio'`; `PORT_SPACING.enderio = 0`; `MODE_KINDS.enderio = ['enderio']`; `ReachMode` gains `'enderio'` with `reachKinds('enderio')` = `{'enderio'}`.

- [ ] **Step 1: Bring Plan 5 and the current spec onto this branch**

```bash
git merge --no-edit plan/05-line-layout-3d   # a no-op once Plan 5 is on main
git merge --no-edit main
```

If either merge conflicts outside `docs/`, stop and report it instead of resolving source code here; conflicts in `docs/` keep both sides (the spec and architecture are append-only).

Run: `test -f src/client/three/renderer.ts && test -f src/client/views/View3D.tsx && test -f tests/e2e/layout.spec.ts && grep -c 'EnderIO conduit logistics mode and the Connections view' docs/superpowers/plans/2026-10-17-00-architecture.md && npm run typecheck && npm test`
Expected: `1`, `tsc -b` exit 0, every vitest file PASS.

- [ ] **Step 2: Write the failing tests**

`tests/unit/layout/enderio-facts.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import {
  CHANNEL_PALETTE, CONDUIT_MODE_NAMES, CONDUIT_NAMES, DEFAULT_CHANNEL, DYE_COLORS, DYE_NAMES, FLUID_CONDUITS, FLUID_FILTER_SLOTS,
  ITEM_FILTER_SLOTS, REDSTONE_NAMES, itemFaceRate,
} from '../../../src/shared/layout/enderio.ts';
import { LogisticsMode } from '../../../src/shared/types/plan.ts';
import { validateOp } from '../../../src/shared/project/apply-op.ts';
import { reachKinds } from '../../../src/shared/world/storage-totals.ts';
import { PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { chooseLogisticsNetwork } from '../../../src/server/layout/hookups.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { layoutPack, makeScan } from '../../helpers/layout-fixtures.ts';

describe('EnderIO 2.10.46 facts', () => {
  it('moves 8 items/s through a face and 8 more per Item Conduit Speed Upgrade, at most 15', () => {
    expect([0, 1, 2, 7, 15, 16].map(itemFaceRate)).toEqual([8, 16, 24, 64, 128, 128]);
  });
  it('lists the dye colours in EnderIO order and hands out 15 channels, never the default green', () => {
    expect(DYE_COLORS).toEqual(['black', 'red', 'green', 'brown', 'blue', 'purple', 'cyan', 'silver', 'gray', 'pink', 'lime', 'yellow', 'light_blue', 'magenta', 'orange', 'white']);
    expect(CHANNEL_PALETTE).toEqual(['red', 'blue', 'yellow', 'orange', 'purple', 'cyan', 'magenta', 'lime', 'pink', 'light_blue', 'brown', 'white', 'black', 'gray', 'silver']);
    expect(DEFAULT_CHANNEL).toBe('green');
    expect([DYE_NAMES.silver, DYE_NAMES.light_blue]).toEqual(['Light Gray', 'Light Blue']);
  });
  it('names modes and redstone settings as the EnderIO GUI does', () => {
    expect(CONDUIT_MODE_NAMES).toEqual({ extract: 'Extract', insert: 'Insert', in_out: 'In / Out', disabled: 'Disabled' });
    expect(REDSTONE_NAMES).toEqual({ ignore: 'Always active', on: 'Active with signal', off: 'Active without signal', never: 'Never active' });
    expect([CONDUIT_NAMES.item, CONDUIT_NAMES.liquid_ender]).toEqual(['Item Conduit', 'Ender Fluid Conduit']);
  });
  it('rates the ender fluid conduits per face in L/s and sizes the filters', () => {
    expect(FLUID_CONDUITS.map((c) => [c.kind, c.meta, c.extractPerTick * 20, c.maxIoPerTick * 20])).toEqual([
      ['liquid_ender', 2, 4000, 16000], ['liquid_crystalline', 3, 20000, 80000], ['liquid_pink_slime', 4, 40000, 160000],
      ['liquid_melodic', 5, 200000, 800000], ['liquid_stellar', 6, 400000, 1600000]]);
    expect([ITEM_FILTER_SLOTS.basic, ITEM_FILTER_SLOTS.advanced, ITEM_FILTER_SLOTS.big, FLUID_FILTER_SLOTS]).toEqual([5, 10, 24, 5]);
  });
});

describe('the enderio logistics mode', () => {
  it('is a mode a project can choose, with machine ports that may share a spine cell', () => {
    expect(LogisticsMode.EnderIO).toBe('enderio');
    expect(validateOp({ op: 'settings', patch: { logistics: 'enderio' } })).toBeNull();
    expect(PORT_SPACING.enderio).toBe(0);
  });
  it('counts storage on the base EnderIO network as reachable', () => {
    expect([...reachKinds('enderio')]).toEqual(['enderio']);
  });
  it('hooks only into an EnderIO item network', () => {
    const scan = makeScan({ logistics: [{ kind: 'routed', taps: [[0, 64, 0]] }, { kind: 'enderio', taps: [[2, 64, 0]] }] });
    expect(chooseLogisticsNetwork(scan, scan.bases[0]!, 'enderio')?.kind).toBe('enderio');
    scan.logistics[1]!.id = 'e:liquid:0:5';
    expect(chooseLogisticsNetwork(scan, scan.bases[0]!, 'enderio')).toBeNull();
  });
  it('resolves the new EnderIO parts against the pack', () => {
    const parts = resolveParts(layoutPack());
    expect([parts.eio_advanced_filter, parts.eio_big_filter, parts.eio_speed_upgrade, parts.eio_fluid_ender, parts.eio_fluid_stellar]
      .map((p) => [p.key, p.name, p.found])).toEqual([
      ['EnderIO:itemBasicFilterUpgrade@1', 'Advanced Item Filter', true], ['EnderIO:itemBigFilterUpgrade@0', 'Big Item Filter', true],
      ['EnderIO:itemExtractSpeedUpgrade@0', 'Item Conduit Speed Upgrade', true], ['EnderIO:itemLiquidConduit@2', 'Ender Fluid Conduit', true],
      ['EnderIO:itemLiquidConduit@6', 'Stellar Ender Fluid Conduit', true]]);
    expect(parts.eio_fluid_ender.block).toEqual({ id: 'conduit:liquid_ender', meta: 0 });
  });
});
```

In `tests/client/settings.test.tsx`, add to the `renders every section` case's list of expected strings: `'EnderIO conduits'`.

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/layout/enderio-facts.test.ts tests/client/settings.test.tsx`
Expected: FAIL — `src/shared/layout/enderio.ts` cannot be resolved; `EnderIO conduits` not in the settings markup.

- [ ] **Step 4: Implement**

- `src/shared/types/plan.ts`: `LogisticsMode = { Direct: 'direct', Routed: 'routed', AE2: 'ae2', EnderIO: 'enderio' } as const` (Plan 2's `LOGISTICS_MODES = Object.values(LogisticsMode)` then accepts it).
- `src/shared/types/layout.ts`: the types above, with the doc comments; `LayoutBlock` gains `conduits?` and `tail?` under its "optional additions". `src/server/layout/arrange.ts` `LocalBlock` gains the same two fields.
- `src/shared/layout/enderio.ts`: the constants and `itemFaceRate` above, `Object.freeze`d, with a header comment citing the jar classes named in "How the EnderIO mode works".
- `src/shared/world/storage-totals.ts`: `ReachMode = 'direct' | 'routed' | 'ae2' | 'enderio'`; `const ENDERIO_ONLY = new Set<NetworkKind>(['enderio'])`; `reachKinds` returns it for `'enderio'` (in enderio mode the line's hookup joins that network and any storage face on it can be set to Extract).
- `src/server/planner/steps.ts` `LOGISTICS_TEXT.enderio = 'Connect every machine to an EnderIO conduit face set to Extract, Insert or In / Out, with its channel colours and filters; only raw inputs and the final outputs touch storage'`.
- `src/server/layout/hookups.ts` `MODE_KINDS.enderio = ['enderio']`; `src/server/layout/modes/mode.ts` `PORT_SPACING.enderio = 0` (each face of a conduit is set on its own, so the N and S machines may share a spine cell). `buildMode` keeps throwing for `enderio` until Task 3.
- `src/server/layout/parts.ts`: the new `PartId`s and `PART_DEFS` rows above.
- `src/client/views/SettingsPanel.tsx` `LOGISTICS` gains `{ value: LogisticsMode.EnderIO, label: 'EnderIO conduits' }` last.
- `tests/helpers/layout-fixtures.ts` `PART_ITEMS` gains `['EnderIO:itemBasicFilterUpgrade@1', 'Advanced Item Filter']`, `['EnderIO:itemBigFilterUpgrade@0', 'Big Item Filter']`, `['EnderIO:itemExtractSpeedUpgrade@0', 'Item Conduit Speed Upgrade']`, `['EnderIO:itemLiquidConduit@2', 'Ender Fluid Conduit']`, `['EnderIO:itemLiquidConduit@3', 'Crystalline Ender Fluid Conduit']`, `['EnderIO:itemLiquidConduit@4', 'Crystalline Pink Slime Ender Fluid Conduit']`, `['EnderIO:itemLiquidConduit@5', 'Melodic Ender Fluid Conduit']`, `['EnderIO:itemLiquidConduit@6', 'Stellar Ender Fluid Conduit']`. If `tests/helpers/line-parts-export.ts` (Plan 5 Task 16) lists part items itself instead of reading `PART_ITEMS`, add the same rows there.
- Fix every other `Record<LogisticsMode, …>` or `ReachMode` user `npm run typecheck` names.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/layout/enderio-facts.test.ts tests/client/settings.test.tsx && npm run typecheck`
Expected: PASS; `tsc -b` exit 0.

- [ ] **Step 6: Commit**

```bash
git add src/shared/types/plan.ts src/shared/types/layout.ts src/shared/layout/enderio.ts src/shared/world/storage-totals.ts src/server/planner/steps.ts src/server/layout/hookups.ts src/server/layout/modes/mode.ts src/server/layout/parts.ts src/server/layout/arrange.ts src/client/views/SettingsPanel.tsx tests/helpers/layout-fixtures.ts tests/unit/layout/enderio-facts.test.ts tests/client/settings.test.tsx
git commit -m "feat(layout): EnderIO logistics mode value, conduit face types, EnderIO facts and parts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Conduit sizing, channel colours and the words for a face (pure)

**Files:**
- Create: `src/server/layout/conduits.ts`
- Modify: `src/shared/layout/configure-text.ts` (append the conduit functions)
- Test: `tests/unit/layout/conduits.test.ts`

**Interfaces:**
- Consumes: Task 1 (`ConduitFilter`, `ConduitExtract`, `ConduitInsert`, `ConduitFace`, `ConduitKind`, `ConduitSpec`, `DyeColor`, `CHANNEL_PALETTE`, `ITEM_CONDUIT`, `itemFaceRate`, `FLUID_CONDUITS`, `ITEM_FILTER_SLOTS`, `FLUID_FILTER_SLOTS`, `DYE_NAMES`, `CONDUIT_MODE_NAMES`, `REDSTONE_NAMES`, `CONDUIT_NAMES`, the new `PartId`s); Plan 5 `Parts`, `Part` (`parts.ts`), `faceName` (`configure-text.ts`), `fmtInt`, `fmtRate`, `joinNames` (`src/shared/layout/format.ts`).
- Produces:
  ```ts
  // src/server/layout/conduits.ts
  /** The fewest Item Conduit Speed Upgrades (0..15) whose `itemFaceRate` covers the rate; `short` when even 15 do not. */
  export function speedUpgradesFor(itemsPerSecond: number): { count: number; short: boolean };
  /** Exact keys (sorted, each once) as a whitelist in the smallest filter that holds them: Basic ≤ 5, Advanced ≤ 10, Big ≤ 24; past 24 the first 24 and the rest `dropped`. */
  export function itemFilterFor(parts: Parts, keys: readonly StuffKey[]): { filter: ConduitFilter; dropped: StuffKey[] };
  /** An ender fluid conduit's own filter (no item): whitelist of at most 5 fluids, the rest `dropped`. */
  export function fluidFilterFor(keys: readonly StuffKey[]): { filter: ConduitFilter; dropped: StuffKey[] };
  /** The first row of `FLUID_CONDUITS` with extract × 20 ≥ need.extract and maxIo × 20 ≥ need.insert (L/s per face), else Stellar `short`. */
  export function pickFluidConduit(parts: Parts, need: { extract: number; insert: number }): { part: Part; kind: ConduitKind; short: boolean };
  export interface ChannelEnd { id: string; keys: readonly StuffKey[] }
  export interface ChannelLink { from: string; to: string }
  export interface ChannelPlan { colors: Map<string, DyeColor>; shared: Array<{ color: DyeColor; keys: StuffKey[] }> }
  /** Linked ends share a channel; channels coloured in order of their first end (rules in "How the EnderIO mode works"). Throws `RangeError` for a link to an unknown end. */
  export function assignChannels(ends: readonly ChannelEnd[], links: readonly ChannelLink[]): ChannelPlan;
  ```
  ```ts
  // src/shared/layout/configure-text.ts (additions)
  export function conduitFilterText(filter: ConduitFilter, nameOf: (k: StuffKey) => string): string;
  export function conduitSideText(side: 'extract', s: ConduitExtract, nameOf: (k: StuffKey) => string): string;
  export function conduitSideText(side: 'insert', s: ConduitInsert, nameOf: (k: StuffKey) => string): string;
  export function conduitFaceText(kind: ConduitKind, face: ConduitFace, nameOf: (k: StuffKey) => string): string;
  /** One text per face of every conduit of the block, conduits in bundle order, faces in stored order. */
  export function conduitLines(block: Pick<LayoutBlock, 'conduits'>, nameOf: (k: StuffKey) => string): Array<{ kind: ConduitKind; face: Face; text: string }>;
  ```

Words (exact; the build steps, 3D hover/click and Connections panel all print these):
- filter with an item: `<filter name> (<whitelist|blacklist>: <names joined by joinNames>; <match meta|ignore meta>, <match NBT|ignore NBT>[, ore dictionary][, sticky])`; without an item: `fluid filter (<whitelist|blacklist>: <names>)`.
- extract side: `extract on <colour>[ with a|an <filter>][, <n>× <upgrade name>], round robin <on|off>[, self feed <on|off>], redstone <redstone name>` (self feed only when set; "an" before a filter name that starts with a vowel, ruling R11).
- insert side: `insert on <colour>[ with a|an <filter>][, priority <n>]`.
- face: `<conduit name>, <faceName> face to <target>: <mode name>[; <extract side>][; <insert side>]`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/layout/conduits.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { assignChannels, fluidFilterFor, itemFilterFor, pickFluidConduit, speedUpgradesFor } from '../../../src/server/layout/conduits.ts';
import { resolveParts } from '../../../src/server/layout/parts.ts';
import { conduitFaceText, conduitLines } from '../../../src/shared/layout/configure-text.ts';
import type { ConduitFace } from '../../../src/shared/types/layout.ts';
import { layoutPack } from '../../helpers/layout-fixtures.ts';

const parts = resolveParts(layoutPack());
const BASIC = 'EnderIO:itemBasicFilterUpgrade@0';
const SPEED = 'EnderIO:itemExtractSpeedUpgrade@0';
const names: Record<string, string> = { [BASIC]: 'Basic Item Filter', [SPEED]: 'Item Conduit Speed Upgrade', 't:dust@0': 'Titanium Dust', 't:in@0': 'Raw Input', 'fluid:molten.iron': 'Molten Iron' };
const nameOf = (k: string) => names[k] ?? k;
const keys = (n: number) => Array.from({ length: n }, (_, i) => `t:i${String(i).padStart(2, '0')}@0`);

describe('conduit sizing', () => {
  it('adds the fewest speed upgrades that move the rate', () => {
    expect([0, 8, 8.01, 64, 128, 129].map(speedUpgradesFor)).toEqual([
      { count: 0, short: false }, { count: 0, short: false }, { count: 1, short: false }, { count: 7, short: false },
      { count: 15, short: false }, { count: 15, short: true }]);
  });
  it('picks the smallest item filter that holds the keys', () => {
    expect(itemFilterFor(parts, ['t:b@0', 't:a@0', 't:a@0'])).toEqual({ dropped: [], filter: {
      item: BASIC, whitelist: true, keys: ['t:a@0', 't:b@0'], matchMeta: true, matchNbt: false, oreDict: false, sticky: false } });
    expect(itemFilterFor(parts, keys(6)).filter.item).toBe('EnderIO:itemBasicFilterUpgrade@1');
    expect(itemFilterFor(parts, keys(11)).filter.item).toBe('EnderIO:itemBigFilterUpgrade@0');
    const full = itemFilterFor(parts, keys(25));
    expect([full.filter.item, full.filter.keys.length, full.dropped]).toEqual(['EnderIO:itemBigFilterUpgrade@0', 24, ['t:i24@0']]);
    expect(itemFilterFor(parts, ['t:a@0#0123456789ab']).filter.matchNbt).toBe(true);
  });
  it('holds at most five fluids in a fluid conduit filter', () => {
    expect(fluidFilterFor(['fluid:b', 'fluid:a'])).toEqual({ filter: { whitelist: true, keys: ['fluid:a', 'fluid:b'] }, dropped: [] });
    expect(fluidFilterFor(['fluid:a', 'fluid:b', 'fluid:c', 'fluid:d', 'fluid:e', 'fluid:f']).dropped).toEqual(['fluid:f']);
  });
  it('picks the first ender fluid conduit that carries the busiest face', () => {
    const pick = (extract: number, insert: number) => { const p = pickFluidConduit(parts, { extract, insert }); return [p.kind, p.part.key, p.short]; };
    expect(pick(1, 1)).toEqual(['liquid_ender', 'EnderIO:itemLiquidConduit@2', false]);
    expect(pick(4000, 0)).toEqual(['liquid_ender', 'EnderIO:itemLiquidConduit@2', false]);
    expect(pick(4001, 0)).toEqual(['liquid_crystalline', 'EnderIO:itemLiquidConduit@3', false]);
    expect(pick(10, 20000)).toEqual(['liquid_crystalline', 'EnderIO:itemLiquidConduit@3', false]);
    expect(pick(1e6, 0)).toEqual(['liquid_stellar', 'EnderIO:itemLiquidConduit@6', true]);
  });
});

describe('channel colours', () => {
  it('gives linked ends one colour and each channel the next colour of the palette', () => {
    const plan = assignChannels([{ id: 'a', keys: ['k1'] }, { id: 'b', keys: ['k1'] }, { id: 'c', keys: ['k2'] }, { id: 'd', keys: ['k2'] }],
      [{ from: 'a', to: 'b' }, { from: 'c', to: 'd' }]);
    expect(Object.fromEntries(plan.colors)).toEqual({ a: 'red', b: 'red', c: 'blue', d: 'blue' });
    expect(plan.shared).toEqual([]);
  });
  it('reuses a colour past 15 channels only for a channel with no item in common', () => {
    const ends = [...Array.from({ length: 16 }, (_, i) => ({ id: `e${i}`, keys: [`k${i}`] })), { id: 'e16', keys: ['k0'] }];
    const plan = assignChannels(ends, []);
    expect([plan.colors.get('e14'), plan.colors.get('e15'), plan.colors.get('e16')]).toEqual(['silver', 'red', 'blue']);
    expect(plan.shared).toEqual([]);
  });
  it('shares the least-shared colour and says so when every colour carries the item', () => {
    const plan = assignChannels(Array.from({ length: 16 }, (_, i) => ({ id: `e${i}`, keys: ['k'] })), []);
    expect(plan.colors.get('e15')).toBe('red');
    expect(plan.shared).toEqual([{ color: 'red', keys: ['k'] }]);
  });
  it('refuses a link to an end it does not know', () => {
    expect(() => assignChannels([{ id: 'a', keys: [] }], [{ from: 'a', to: 'x' }])).toThrow(RangeError);
  });
});

describe('the words for a conduit face', () => {
  const filter = (k: string) => ({ item: BASIC, whitelist: true, keys: [k], matchMeta: true, matchNbt: false, oreDict: false, sticky: false });
  it('says both sides of an In / Out face, each with its own colour and filter', () => {
    const face: ConduitFace = { face: 'north', mode: 'in_out', target: 'Basic Macerator',
      extract: { color: 'red', filter: filter('t:dust@0'), rate: 20, roundRobin: false, selfFeed: false, redstone: 'ignore', speed: { item: SPEED, count: 2 } },
      insert: { color: 'blue', filter: filter('t:in@0'), rate: 20, priority: 1 } };
    expect(conduitFaceText('item', face, nameOf)).toBe('Item Conduit, north face to Basic Macerator: In / Out; '
      + 'extract on Red with a Basic Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), 2× Item Conduit Speed Upgrade, round robin off, self feed off, redstone Always active; '
      + 'insert on Blue with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT), priority 1');
  });
  it('says a fluid face and a disabled face', () => {
    expect(conduitFaceText('liquid_ender', { face: 'down', mode: 'extract', target: 'Basic Fluid Extractor',
      extract: { color: 'red', filter: { whitelist: true, keys: ['fluid:molten.iron'] }, rate: 1, roundRobin: false, redstone: 'ignore' } }, nameOf))
      .toBe('Ender Fluid Conduit, bottom face to Basic Fluid Extractor: Extract; extract on Red with a fluid filter (whitelist: Molten Iron), round robin off, redstone Always active');
    expect(conduitFaceText('liquid_ender', { face: 'up', mode: 'disabled', target: 'Basic Fluid Extractor' }, nameOf))
      .toBe('Ender Fluid Conduit, top face to Basic Fluid Extractor: Disabled');
  });
  it('lists every face of every conduit in a bundle, item first', () => {
    const lines = conduitLines({ conduits: [
      { kind: 'item', item: 'EnderIO:itemItemConduit@0', connections: 32, faces: [{ face: 'north', mode: 'disabled', target: 'A' }] },
      { kind: 'liquid_ender', item: 'EnderIO:itemLiquidConduit@2', connections: 2, faces: [{ face: 'south', mode: 'disabled', target: 'B' }] }] }, nameOf);
    expect(lines.map((l) => [l.kind, l.face])).toEqual([['item', 'north'], ['liquid_ender', 'south']]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/layout/conduits.test.ts`
Expected: FAIL — `src/server/layout/conduits.ts` cannot be resolved.

- [ ] **Step 3: Implement `src/server/layout/conduits.ts` and the configure-text additions**

`speedUpgradesFor`: `count = max(0, ceil(rate / 8) − 1)`; above 15 → `{ count: 15, short: true }`. Filters: sort and de-duplicate first; the item filter part is `eio_basic_filter`, `eio_advanced_filter` or `eio_big_filter` by size; `matchNbt` is true when any kept key contains `#`. `pickFluidConduit` maps each `FLUID_CONDUITS` kind to its `eio_fluid_*` part.

`assignChannels` (the colouring is not fixed by the signature):

```ts
// union-find over ends (index order); a link joins its two ends
// channels ordered by their smallest end index; keys(channel) = sorted union of its ends' keys
// channel i < 15 → CHANNEL_PALETTE[i]
// channel i ≥ 15 → the first palette colour whose channels share no key with this one;
//   else the colour whose channels share the fewest keys with it (ties: palette order), and push
//   { color, keys: the shared keys, sorted } onto `shared`
```

Append the four text functions to `configure-text.ts` with the exact words above; `faceName` is the module's own.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/layout/conduits.test.ts && npm run typecheck`
Expected: PASS; `tsc -b` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/conduits.ts src/shared/layout/configure-text.ts tests/unit/layout/conduits.test.ts
git commit -m "feat(layout): conduit speed upgrades, filters, fluid conduit tier, channel colours and face texts

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: EnderIO mode — item conduits, faces, chests, hookup end face

**Files:**
- Create: `src/server/layout/modes/enderio.ts`, `tests/helpers/enderio-fixtures.ts`
- Modify: `src/server/layout/modes/mode.ts` (dispatch, `ModeHookup.endConduit`, `stepItemOutputs`)
- Test: `tests/unit/layout/mode-enderio.test.ts`

**Interfaces:**
- Consumes: Task 1 (types, `DEFAULT_CHANNEL`, `CONDUIT_NAMES`, parts), Task 2 (`speedUpgradesFor`, `itemFilterFor`, `assignChannels`, `conduitSideText`); Plan 5 `ModeInput`, `ModeResult`, `ModeHookup`, `StepDraft`, `emptyModeResult`, `placedStepIds`, `itemPorts`, `unitItemRate`, `stepItemInputs`, `nameList`, `buildMode` (`modes/mode.ts`), `Placement`, `PlacedUnit`, `LocalBlock`, `HostConfig` (`arrange.ts`), `linkBits` (`path.ts`), `comparePos` (`world/graph.ts`), `posKey`, `step`, `sideToward`, `OPPOSITE` (`shared/layout/geometry.ts`), `FACES`, `fmtRate`, `joinNames`.
- Produces:
  ```ts
  // src/server/layout/modes/enderio.ts
  export function enderioMode(input: ModeInput): ModeResult;
  // src/server/layout/modes/mode.ts
  export interface ModeHookup { part: PartId; end: PartId | null; endConfig?: BlockConfig;
    /** The conduit face the hookup's last cell turns toward the port; Task 5 fills in `face`. */
    endConduit?: { kind: ConduitKind; face: Omit<ConduitFace, 'face'> } }
  /** The item keys of `step.outputs`, sorted, each once. */
  export function stepItemOutputs(plan: Plan, stepId: string): StuffKey[];
  // buildMode: case 'enderio' → enderioMode(input)
  ```
  ```ts
  // tests/helpers/enderio-fixtures.ts — shared by Tasks 3–7
  export const ITEM: 'EnderIO:itemItemConduit@0'; export const BASIC: 'EnderIO:itemBasicFilterUpgrade@0'; export const ENDER: 'EnderIO:itemLiquidConduit@2';
  export function basic(keys: string[]): ConduitFilter;          // Basic Item Filter whitelist, match meta, ignore NBT, no ore dict, not sticky
  export function keysN(n: number): string[];                      // t:i00@0 … in order
  export function twoStep(): Plan;                                 // s1 = 2× MACERATOR, s2 = 1× ASSEMBLER (tier 2, 120 EU/t), chained flows
  export const fluidSteps: StepSpec[];                             // x = EXTRACTOR making fluid:molten.iron 144, y = SOLIDIFIER taking it, making t:out_y@0
  export function fluidPlan(flows?: PlanFlow[]): Plan;
  export function setup(plan?: Plan, spacing?: 0 | 1 | 2): { pack: Pack; plan: Plan; placement: Placement; parts: Parts };   // headWidth 1, spacing PORT_SPACING.enderio
  export function faces(r: { blocks: ReadonlyArray<{ pos: Vec3; conduits?: ConduitSpec[] }> }): Array<ConduitFace & { pos: Vec3; kind: ConduitKind }>;
  export function lineScan(extra?: Pick<ScanSpec, 'logistics'>): WorldScan;   // the scan of tests/unit/layout/layout.test.ts (base at 20 64 20, MV tap at 16 64 30) plus `extra`
  export function lineGround(): LayoutDeps;                       // the `ground()` voxels of layout.test.ts
  ```
  (`StepSpec` and `ScanSpec` must be exported from `tests/helpers/layout-fixtures.ts`; export them if they are not.)

Rules this task implements are the "Items", "Each side's settings", "Rates", "Channels" and "Hookup" paragraphs of "How the EnderIO mode works". Details the paragraphs leave open:
- Ends are listed in conduit position order (x, y, z), then `FACES` order, extract before insert; end ids are `${posKey(pos)}:${side}:${extract|insert}`.
- A unit's extract rate per face is `unitItemRate(plan, stepId) / (its number of extract faces)`; its insert rate per face is Σ item flows into the step ÷ `step.count` ÷ its number of insert faces. The input chest face extracts Σ the flows that enter the line; output chest `j` takes Σ the flows of its keys that leave it (from a placed step to outside the line), so dust the line's own machines take is not counted.
- Round robin is on when an extract end can hand to two or more insert ends — the insert ends of its colour whose keys share one of its keys, linked to it or not — and all of them are machine faces of one priority; never with a tail chest among them.
- Disabled faces: an Item Conduit cell's side that is neither a conduit link nor a configured face and touches a singleblock machine, a multiblock controller, an input or output bus, or a chest.
- Output chests: `m = ceil(keys / 24)`; chest `j` at `[tailX, j, spineZ + 1]`, its conduit at `[tailX, j, spineZ]` (`j ≥ 1` stacked above the tail cell and linked to the one below); `tailFluidY = max(1, m)`.
- A multiblock's port is an input bus when the placed block behind it has the `mteId` of one of the unit's `input_bus` cells (output bus likewise), as `direct.ts` `spineContacts` tells them apart.
- `LocalBlock.connections` = OR over the cell's conduits of (conduit links | bits of its non-disabled faces); labels: `Item Conduit` for one conduit (Task 4 adds bundles).
- Warnings: `conduit_rate` (`No item conduit face moves <rate> items/s out of <name>: 15 Item Conduit Speed Upgrades move 128 items/s, so the line runs slower`, once per step, with `stepId`, and once for the input chest's face as `out of the input chest`, without one); `filter_full` (`The <extract|insert> filter toward <target> holds 24 items, so <names> <is|are> left out: move <it|them> by hand`, with `stepId` when the face is a machine's); `conduit_channels` (`More than 15 conduit channels are needed: <colour> also carries <names>, so they can reach a machine that does not take them`).
- Drafts: `layout:logistics:line` (pin site) `Lay <n>× Item Conduit along the middle row so it touches every machine's front[, with <chests> at the end]` (the chests phrase as in `direct.ts`); with a hookup `layout:configure:conduit-tap` (pin logistics) `At the storage tap set the conduit face toward your storage to Extract (In / Out if it already inserts); <conduitSideText('extract', …)>` for an extract side on Green with the input-chest whitelist and the speed upgrades the input rate needs, and `extraParts` for its filter (`why: 'filter at the storage tap'`) and upgrades (`'speed upgrades at the storage tap'`), group `logistics`; without one, when there is an input chest, `layout:logistics:inputs` (pin site) `Put the raw inputs in the input chest: <names>`.
- `configs`: `{ inputFromOutputSide: true }` on every singleblock unit cell that takes items. `covers` stay empty. `logisticsPort` = the input chest when hooked, else null.

- [ ] **Step 1: Write the shared fixtures and the failing tests**

Write `tests/helpers/enderio-fixtures.ts` with the exports above (`lineScan`/`lineGround` copy the `scan()` and `ground()` helpers of `tests/unit/layout/layout.test.ts` lines 11–21; `lineScan` appends `extra.logistics`).

`tests/unit/layout/mode-enderio.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMode, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { OPPOSITE, posKey, step } from '../../../src/shared/layout/geometry.ts';
import { makePlan, makeScan, IDS } from '../../helpers/layout-fixtures.ts';
import { ITEM, basic, faces, keysN, setup, twoStep } from '../../helpers/enderio-fixtures.ts';

const sharedPlan = () => makePlan([
  { id: 'a', mteId: IDS.MACERATOR, count: 1, outputs: [['t:dust@0', 3]] },
  { id: 'b', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] },
  { id: 'c', mteId: IDS.CHEM_HV, count: 1, tier: 3, inputs: [['t:dust@0', 1]], outputs: [['t:out_c@0', 1]] },
], { flows: [{ from: 'raw', to: 'a', key: 't:in@0', perSecond: 3 }, { from: 'a', to: 'b', key: 't:dust@0', perSecond: 1 },
  { from: 'a', to: 'c', key: 't:dust@0', perSecond: 1 }, { from: 'a', to: 'out', key: 't:dust@0', perSecond: 1 },
  { from: 'b', to: 'out', key: 't:ingot@0', perSecond: 1 }, { from: 'c', to: 'out', key: 't:out_c@0', perSecond: 1 }] });
const manyInputs = (n: number) => makePlan([{ id: 's1', mteId: IDS.ASSEMBLER, count: 1, tier: 2, inputs: keysN(n).map((k): [string, number] => [k, 1]) }],
  { flows: [...keysN(n).map((key) => ({ from: 'raw', to: 's1', key, perSecond: 1 })), { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 1 }] });

describe('EnderIO mode — items', () => {
  it('lays an Item Conduit along the spine and sets every machine face to In / Out with its own filters and colours', () => {
    const r = buildMode('enderio', { ...setup(), network: null });
    expect(r.blocks.filter((b) => b.conduits !== undefined).map((b) => [b.pos, b.role, b.block.id, b.label, b.item, b.connections])).toEqual([
      [[1, 0, 2], 'pipe', 'conduit:item', 'Item Conduit', ITEM, 4 | 8 | 32],
      [[2, 0, 2], 'pipe', 'conduit:item', 'Item Conduit', ITEM, 4 | 16 | 32],
      [[3, 0, 2], 'pipe', 'conduit:item', 'Item Conduit', ITEM, 4 | 8 | 16]]);
    const s1 = { mode: 'in_out', target: 'Basic Macerator',
      extract: { color: 'red', filter: basic(['t:out_s1@0']), rate: 0.5, roundRobin: false, selfFeed: false, redstone: 'ignore' },
      insert: { color: 'blue', filter: basic(['t:in@0']), rate: 0.5, priority: 1 } };
    expect(r.blocks.find((b) => posKey(b.pos) === '1,0,2')!.conduits).toEqual([
      { kind: 'item', item: ITEM, connections: 32, faces: [{ face: 'north', ...s1 }, { face: 'south', ...s1 }] }]);
    expect(faces(r).filter((f) => posKey(f.pos) !== '1,0,2').map(({ pos: _pos, kind: _kind, ...f }) => f)).toEqual([
      { face: 'north', mode: 'in_out', target: 'Advanced Assembler',
        extract: { color: 'yellow', filter: basic(['t:out_s2@0']), rate: 1, roundRobin: false, selfFeed: false, redstone: 'ignore' },
        insert: { color: 'red', filter: basic(['t:out_s1@0']), rate: 1, priority: 1 } },
      { face: 'north', mode: 'extract', target: 'Chest (input)',
        extract: { color: 'blue', filter: basic(['t:in@0']), rate: 1, roundRobin: true, selfFeed: false, redstone: 'ignore' } },
      { face: 'south', mode: 'insert', target: 'Chest (output)', insert: { color: 'yellow', filter: basic(['t:out_s2@0']), rate: 1, priority: 0 } }]);
    expect(r.configs).toEqual([{ pos: [1, 0, 1], config: { inputFromOutputSide: true } }, { pos: [1, 0, 3], config: { inputFromOutputSide: true } },
      { pos: [2, 0, 1], config: { inputFromOutputSide: true } }]);
    expect(r.blocks.filter((b) => b.role === 'chest').map((b) => [b.pos, b.label, b.tail])).toEqual([
      [[3, 0, 1], 'Chest (input)', { side: 'input', keys: ['t:in@0'] }], [[3, 0, 3], 'Chest (output)', { side: 'output', keys: ['t:out_s2@0'] }]]);
    expect([r.covers, r.logisticsPort, r.hookup, r.tailFluidY, r.warnings, r.extraParts]).toEqual([[], null, null, 1, [], []]);
    expect(r.drafts).toEqual([
      { id: 'layout:logistics:line', kind: 'logistics', pin: 'site',
        text: "Lay 3× Item Conduit along the middle row so it touches every machine's front, with an input chest and an output chest at the end" },
      { id: 'layout:logistics:inputs', kind: 'logistics', pin: 'site', text: 'Put the raw inputs in the input chest: Raw Input' }]);
  });

  it('feeds the input chest from an EnderIO item network on the default Green channel', () => {
    const network = makeScan({ logistics: [{ kind: 'enderio', taps: [[0, 64, 0]] }] }).logistics[0]!;
    const r = buildMode('enderio', { ...setup(), network });
    expect(r.logisticsPort).toEqual([3, 0, 1]);
    expect(r.hookup).toEqual({ part: 'eio_item_conduit', end: null, endConduit: { kind: 'item',
      face: { mode: 'insert', target: 'Chest (input)', insert: { color: 'green', filter: basic(['t:in@0']), rate: 1, priority: 1 } } } });
    expect(r.extraParts).toEqual([{ key: 'EnderIO:itemBasicFilterUpgrade@0', amount: 1, why: 'filter at the storage tap', group: 'logistics' }]);
    expect(r.drafts.map((d) => [d.id, d.pin])).toEqual([['layout:logistics:line', 'site'], ['layout:configure:conduit-tap', 'logistics']]);
    expect(r.drafts[1]!.text).toBe('At the storage tap set the conduit face toward your storage to Extract (In / Out if it already inserts); '
      + 'extract on Green with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT), round robin off, self feed off, redstone Always active');
  });

  it('joins a shared item into one channel and fills machines before the chest', () => {
    const r = buildMode('enderio', { ...setup(sharedPlan()), network: null });
    const at = (target: string) => faces(r).find((f) => f.target === target)!;
    const [a, b, c, out] = [at('Basic Macerator'), at('Advanced Assembler'), at('Advanced Chemical Reactor'), at('Chest (output)')];
    expect([a.extract!.color, b.insert!.color, c.insert!.color, out.insert!.color]).toEqual(['red', 'red', 'red', 'red']);
    expect([a.extract!.roundRobin, a.extract!.rate, b.insert!.priority, c.insert!.priority, out.insert!.priority]).toEqual([false, 3, 1, 1, 0]);
    expect(out.insert!.filter!.keys).toEqual(['t:dust@0', 't:ingot@0', 't:out_c@0']);
  });

  it('sends items for owned machines and unplanned byproducts through the chests', () => {
    const plan = makePlan([
      { id: 'p', mteId: IDS.ASSEMBLER, count: 1, owned: 1, tier: 2, outputs: [['t:dust@0', 1]] },
      { id: 'q', mteId: IDS.MACERATOR, count: 1, inputs: [['t:dust@0', 1]], outputs: [['t:out_q@0', 1], ['t:ingot@0', 1]] },
    ], { flows: [{ from: 'raw', to: 'p', key: 't:in@0', perSecond: 1 }, { from: 'p', to: 'q', key: 't:dust@0', perSecond: 1 },
      { from: 'q', to: 'out', key: 't:out_q@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    expect(r.blocks.filter((b) => b.role === 'chest').map((b) => b.tail)).toEqual([
      { side: 'input', keys: ['t:dust@0'] }, { side: 'output', keys: ['t:ingot@0', 't:out_q@0'] }]);
    const q = faces(r).find((f) => f.target === 'Basic Macerator')!;
    expect([q.extract!.filter!.keys, q.insert!.filter!.keys]).toEqual([['t:ingot@0', 't:out_q@0'], ['t:dust@0']]);
  });

  it('uses an Advanced Item Filter for six inputs and warns past 24', () => {
    const six = faces(buildMode('enderio', { ...setup(manyInputs(6)), network: null })).find((f) => f.target === 'Advanced Assembler')!;
    expect(six.insert!.filter!.item).toBe('EnderIO:itemBasicFilterUpgrade@1');
    const r = buildMode('enderio', { ...setup(manyInputs(25)), network: null });
    expect(r.warnings).toContainEqual({ code: 'filter_full', stepId: 's1',
      text: 'The insert filter toward Advanced Assembler holds 24 items, so t:i24@0 is left out: move it by hand' });
  });

  it('adds speed upgrades to a fast face and warns past 128 items/s', () => {
    const fast = (rate: number) => makePlan([{ id: 's1', mteId: IDS.MACERATOR, count: 1 }], { flows: [
      { from: 'raw', to: 's1', key: 't:in@0', perSecond: rate }, { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: rate }] });
    const f = faces(buildMode('enderio', { ...setup(fast(20)), network: null })).find((g) => g.target === 'Basic Macerator')!;
    expect(f.extract!.speed).toEqual({ item: 'EnderIO:itemExtractSpeedUpgrade@0', count: 2 });
    expect(buildMode('enderio', { ...setup(fast(200)), network: null }).warnings).toContainEqual({ code: 'conduit_rate', stepId: 's1',
      text: 'No item conduit face moves 200 items/s out of Basic Macerator: 15 Item Conduit Speed Upgrades move 128 items/s, so the line runs slower' });
  });

  it('inserts into a multiblock input bus and extracts from its output bus', () => {
    const plan = makePlan([{ id: 'e', mteId: IDS.EBF, count: 1, tier: 2, inputs: [['t:dust@0', 1]], outputs: [['t:ingot@0', 1]] }],
      { flows: [{ from: 'raw', to: 'e', key: 't:dust@0', perSecond: 1 }, { from: 'e', to: 'out', key: 't:ingot@0', perSecond: 1 }] });
    const s = setup(plan);
    const r = buildMode('enderio', { ...s, network: null });
    const unit = s.placement.units[0]!;
    const busKind = (mteId: number | undefined) => unit.cells.find((c) => c.block.mteId === mteId)?.hatch;
    for (const port of unit.ports.items) {
      const behind = step(port, OPPOSITE[unit.facing]!);
      const hatch = busKind(s.placement.blocks.find((b) => posKey(b.pos) === posKey(behind))!.block.mteId);
      const face = faces(r).find((f) => posKey(f.pos) === posKey(port) && f.mode !== 'disabled')!;
      expect(face.mode).toBe(hatch === 'input_bus' ? 'insert' : 'extract');
    }
    expect(r.configs).toEqual([]);
  });

  it('disables the face toward a machine that moves no items', () => {
    const plan = makePlan([
      { id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['fluid:oxygen', 10]], outputs: [['fluid:molten.iron', 144]] },
      { id: 's2', mteId: IDS.MACERATOR, count: 1 },
    ], { flows: [{ from: 'raw', to: 'x', key: 'fluid:oxygen', perSecond: 10 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 144 },
      { from: 'raw', to: 's2', key: 't:in@0', perSecond: 1 }, { from: 's2', to: 'out', key: 't:out_s2@0', perSecond: 1 }] });
    const f = faces(buildMode('enderio', { ...setup(plan), network: null })).find((g) => g.kind === 'item' && g.target === 'Basic Fluid Extractor')!;
    expect([f.mode, f.extract, f.insert]).toEqual(['disabled', undefined, undefined]);
  });

  it('sets every extract face to Always active (EnderIO falls back to Active with signal)', () => {
    for (const plan of [twoStep(), sharedPlan(), manyInputs(6)]) {
      for (const f of faces(buildMode('enderio', { ...setup(plan), network: null }))) if (f.extract !== undefined) expect(f.extract.redstone).toBe('ignore');
    }
  });

  it('lays nothing when no machine moves items', () => {
    const plan = makePlan([{ id: 'x', mteId: IDS.EXTRACTOR, count: 1, inputs: [['fluid:oxygen', 10]], outputs: [['fluid:molten.iron', 144]] }],
      { flows: [{ from: 'raw', to: 'x', key: 'fluid:oxygen', perSecond: 10 }, { from: 'x', to: 'out', key: 'fluid:molten.iron', perSecond: 144 }] });
    expect(buildMode('enderio', { ...setup(plan, PORT_SPACING.enderio), network: null }).blocks.filter((b) => b.conduits?.some((c) => c.kind === 'item'))).toEqual([]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/layout/mode-enderio.test.ts`
Expected: FAIL — `unknown logistics mode enderio` thrown by `buildMode`.

- [ ] **Step 3: Implement `enderioMode` and the `mode.ts` additions**

`enderioMode(input)` builds, in this order: the face plan of every item port and tail face (ends with keys and rates); the links from the plan's flows and the stray outputs; `assignChannels`; the filters, speed upgrades, priorities and round robin of every side; the disabled faces; the conduit blocks (sorted by `comparePos`, each with `conduits` and `connections` from `linkBits` of the spine and tail-riser links plus face bits); chests with `tail`; configs, hookup, drafts, warnings. With no unit that moves items it returns `emptyModeResult()` (Task 4 adds the fluid-only case). A link's ends are found by key: a source's extract ends whose keys include the flow's key, a target's insert ends whose keys include it.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/layout/mode-enderio.test.ts tests/unit/layout/mode-direct.test.ts tests/unit/layout/mode-network.test.ts && npm run typecheck`
Expected: PASS; `tsc -b` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/modes/enderio.ts src/server/layout/modes/mode.ts tests/helpers/enderio-fixtures.ts tests/helpers/layout-fixtures.ts tests/unit/layout/mode-enderio.test.ts
git commit -m "feat(layout): EnderIO mode item conduits with per-face extract and insert filters, colours, upgrades and the hookup face

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: EnderIO mode — fluid conduits, bundles and open ends

**Files:**
- Modify: `src/server/layout/modes/enderio.ts`, `src/server/layout/modes/mode.ts` (`ModeResult.ownsFluids`), `src/server/layout/layout.ts:94-112` (`buildLocal`)
- Test: `tests/unit/layout/mode-enderio-fluids.test.ts`

**Interfaces:**
- Consumes: Task 3 (`enderioMode`, its ends/links/channels machinery, fixtures); Task 2 (`fluidFilterFor`, `pickFluidConduit`, `assignChannels`); Plan 5 `fluidNets`, `FluidNet` (`internal.ts`), `growTree`, `linkBits`, `PathBounds` (`path.ts`), `UnitPorts.fluidIn/fluidOut/power`, `Placement.reserved`, `layoutLine`.
- Produces:
  ```ts
  // src/server/layout/modes/mode.ts
  export interface ModeResult { /* … */
    /** The mode lays the line's fluid network itself: internal routing then gets no fluid nets (no GT fluid pipes, no pump covers). */
    ownsFluids?: boolean }
  ```
  - `buildLocal` passes `fluids: modeResult.ownsFluids === true ? [] : fluidNets(pack, plan, placement)` to `routeInternal`.
  - Bundle cells: `label` = `Conduit bundle (<names joined with ' + '>)`, `block` = `conduitBlockRef` of the first conduit, `item` = the first conduit's item; a single conduit keeps its own name, block and item.

Rules: the "Fluids" paragraph of "How the EnderIO mode works". Details it leaves open:
- Network cells start as the spine `[firstX … tailX] × (0, spineZ)` linked along x, plus the open-end column `[tailX, i, spineZ]` for `i = 1 … n − 1` linked upward from the tail cell. `growTree(roots: those cells, terminals: the fluid ports sorted by posKey, { bounds: { min: [0, 0, 0], max: [w − 1, max(h, n − 1), l − 1] }, passable })` with `passable(p)` = `x ≥ firstX`, not a placement block, not a reserved air cell, not a unit's power port, not a chest, free or holding the Item Conduit. Then drop cells with at most one link that are neither a port nor an open end, until none is left.
- A port's ends: extract with the fluids whose `FluidNet.producers` hold the port, insert with those whose `consumers` hold it. Extract rate at a port = Σ `FluidNet.faces[].rate` whose face opens onto it (`step(face.pos, face.side)`); insert rate = Σ the fluid's flows into the step ÷ `step.count`. An open end's rate = Σ the fluid's flows that cross the line's edge in that direction.
- Fluid ends join fluid links only (flows of fluid keys, sources and targets as for items with the open end of the key in place of the chests) and get their own `assignChannels`.
- Faces: `extract { color, filter: fluidFilterFor(keys).filter, rate, roundRobin, redstone: 'ignore' }`, `insert { color, filter, rate }` (no self feed, speed or priority on fluid conduits). Disabled: a fluid conduit's side toward a singleblock machine or an input/output fluid hatch that is not one of its configured faces. An open end's `target` is `your tank`.
- Warnings: `conduit_rate` (`No fluid conduit moves <rate> L/s through one face: the Stellar Ender Fluid Conduit moves 400,000 L/s, so the line runs slower`, naming the side that is short: an insert-only shortfall names its 1,600,000 L/s max IO); `filter_full` as for items, but `holds 5 fluids`; `conduit_share` (`<machines> share(s) <fluid> with the open end for your tank turn by turn (ender fluid conduits have no priority), so it/they can run short: if it does/they do, take the tank off that end`); `route_failed` once per step and text for the unreached ports (`Could not lay the <conduit name> to <unit name> — connect it by hand`, with `stepId`).
- Drafts (both pin site): `layout:logistics:fluids` `Lay <n>× <conduit name> from every machine's fluid port[, with an open end | <k> open ends at the tail for your tanks][; 1 of them goes | <b> of them go in the same bundle as the Item Conduit]`; when there are open ends, `layout:logistics:tanks` `Connect a tank to the side of each open conduit end at the tail that faces out of the end of the line, from the bottom: <fluid names in key order>` (the side by the line's shape, never by compass: a draft becomes its step word for word and is not turned with the line).
- A line whose units move fluids but no items lays fluid conduits only (no item spine, no chests).

- [ ] **Step 1: Write the failing tests**

`tests/unit/layout/mode-enderio-fluids.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { buildMode, type ModeResult } from '../../../src/server/layout/modes/mode.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { posKey } from '../../../src/shared/layout/geometry.ts';
import { layoutPack, makePlan, makeProject, IDS } from '../../helpers/layout-fixtures.ts';
import { ENDER, ITEM, basic, fluidPlan, fluidSteps, lineGround, lineScan, setup } from '../../helpers/enderio-fixtures.ts';

const iron = { whitelist: true, keys: ['fluid:molten.iron'] };
const fluidKinds = (r: ModeResult) => [...new Set(r.blocks.flatMap((b) => (b.conduits ?? []).map((c) => c.kind)).filter((k) => k !== 'item'))];

describe('EnderIO mode — fluids', () => {
  it('lays one Ender Fluid Conduit from the machine that makes a fluid to the one that takes it', () => {
    const r = buildMode('enderio', { ...setup(fluidPlan()), network: null });
    expect(r.ownsFluids).toBe(true);
    const fluid = r.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender'));
    expect(fluid.map((b) => [b.pos, b.label, b.block.id, b.connections])).toEqual([
      [[1, 1, 1], 'Ender Fluid Conduit', 'conduit:liquid_ender', 8 | 1], [[1, 1, 2], 'Ender Fluid Conduit', 'conduit:liquid_ender', 4 | 8],
      [[1, 1, 3], 'Ender Fluid Conduit', 'conduit:liquid_ender', 4 | 1]]);
    expect(fluid.map((b) => b.conduits)).toEqual([
      [{ kind: 'liquid_ender', item: ENDER, connections: 8, faces: [{ face: 'down', mode: 'extract', target: 'Basic Fluid Extractor',
        extract: { color: 'red', filter: iron, rate: 1, roundRobin: false, redstone: 'ignore' } }] }],
      [{ kind: 'liquid_ender', item: ENDER, connections: 12, faces: [] }],
      [{ kind: 'liquid_ender', item: ENDER, connections: 4, faces: [{ face: 'down', mode: 'insert', target: 'Basic Fluid Solidifier',
        insert: { color: 'red', filter: iron, rate: 1 } }] }]]);
    expect(r.drafts.find((d) => d.id === 'layout:logistics:fluids')!.text).toBe("Lay 3× Ender Fluid Conduit from every machine's fluid port");
  });

  it('shares the spine with the Item Conduit as one bundle and opens a fluid that enters the line at the tail', () => {
    const plan = makePlan([{ id: 's1', mteId: IDS.SOLIDIFIER, count: 1, inputs: [['fluid:molten.iron', 144]], outputs: [['t:out_s1@0', 1]] }],
      { flows: [{ from: 'raw', to: 's1', key: 'fluid:molten.iron', perSecond: 1 }, { from: 's1', to: 'out', key: 't:out_s1@0', perSecond: 1 }] });
    const r = buildMode('enderio', { ...setup(plan), network: null });
    const at = new Map(r.blocks.map((b) => [posKey(b.pos), b]));
    expect(r.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender')).map((b) => [b.pos, b.label])).toEqual([
      [[1, 0, 2], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)'], [[1, 1, 1], 'Ender Fluid Conduit'], [[1, 1, 2], 'Ender Fluid Conduit'],
      [[2, 0, 2], 'Conduit bundle (Item Conduit + Ender Fluid Conduit)']]);
    expect(at.get('1,0,2')!.conduits).toEqual([
      { kind: 'item', item: ITEM, connections: 32, faces: [{ face: 'north', mode: 'extract', target: 'Basic Fluid Solidifier',
        extract: { color: 'red', filter: basic(['t:out_s1@0']), rate: 1, roundRobin: false, selfFeed: false, redstone: 'ignore' } }] },
      { kind: 'liquid_ender', item: ENDER, connections: 2 | 32, faces: [{ face: 'north', mode: 'disabled', target: 'Basic Fluid Solidifier' }] }]);
    expect([at.get('1,0,2')!.connections, at.get('1,0,2')!.block.id, at.get('1,0,2')!.item]).toEqual([32 | 4 | 2, 'conduit:item', ITEM]);
    expect(at.get('2,0,2')!.conduits!.map((c) => [c.kind, c.connections, c.faces.map((f) => [f.face, f.mode, f.target])])).toEqual([
      ['item', 16, [['south', 'insert', 'Chest (output)']]], ['liquid_ender', 16, [['east', 'extract', 'your tank']]]]);
    expect(at.get('2,0,2')!.conduits![1]!.faces[0]!.extract).toEqual({ color: 'red', filter: iron, rate: 1, roundRobin: false, redstone: 'ignore' });
    expect(at.get('1,1,1')!.conduits![0]!.faces).toEqual([{ face: 'down', mode: 'insert', target: 'Basic Fluid Solidifier', insert: { color: 'red', filter: iron, rate: 1 } }]);
    expect(r.drafts.map((d) => d.id)).toEqual(['layout:logistics:line', 'layout:logistics:fluids', 'layout:logistics:tanks']);
    expect(r.drafts[1]!.text).toBe("Lay 4× Ender Fluid Conduit from every machine's fluid port, with an open end at the tail for your tanks; 2 of them go in the same bundle as the Item Conduit");
    expect(r.drafts[2]!.text).toBe('Connect a tank to the side of each open conduit end at the tail that faces out of the end of the line, from the bottom: Molten Iron');
  });

  it('sizes the fluid conduit to the busiest face and warns when none is big enough', () => {
    const flows = (litres: number) => [{ from: 'raw', to: 'x', key: 't:in@0', perSecond: 1 }, { from: 'x', to: 'y', key: 'fluid:molten.iron', perSecond: litres },
      { from: 'y', to: 'out', key: 't:out_y@0', perSecond: 1 }];
    expect(fluidKinds(buildMode('enderio', { ...setup(makePlan(fluidSteps, { flows: flows(5000) })), network: null }))).toEqual(['liquid_crystalline']);
    const r = buildMode('enderio', { ...setup(makePlan(fluidSteps, { flows: flows(500000) })), network: null });
    expect(fluidKinds(r)).toEqual(['liquid_stellar']);
    expect(r.warnings).toContainEqual({ code: 'conduit_rate',
      text: 'No fluid conduit moves 500,000 L/s through one face: the Stellar Ender Fluid Conduit moves 400,000 L/s, so the line runs slower' });
  });

  it('leaves no GT fluid pipe or pump cover in a laid-out enderio line', async () => {
    const layout = await layoutLine(layoutPack(), fluidPlan(), lineScan(), makeProject({ logistics: 'enderio' }), lineGround());
    expect(layout.blocks.some((b) => b.block.mteId === IDS.SMALL_BRONZE_PIPE || b.block.mteId === IDS.BRONZE_PIPE)).toBe(false);
    expect(layout.blocks.flatMap((b) => b.covers ?? []).some((c) => c.item === 'gregtech:gt.metaitem.01@32610')).toBe(false);
    expect(layout.blocks.filter((b) => b.conduits?.some((c) => c.kind === 'liquid_ender'))).toHaveLength(3);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/layout/mode-enderio-fluids.test.ts`
Expected: FAIL — `ownsFluids` undefined and no `liquid_ender` conduit laid.

- [ ] **Step 3: Implement the fluid network in `enderioMode`, `ModeResult.ownsFluids` and the `buildLocal` switch**

Merge fluid cells into the item conduit blocks by position (a cell holding both is one block with `conduits: [item, fluid]`), recompute each block's `connections`, label, block and item, and keep `blocks` sorted by `comparePos`. `ownsFluids` is true whenever `fluidNets` is not empty.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/unit/layout/mode-enderio-fluids.test.ts tests/unit/layout/mode-enderio.test.ts tests/unit/layout/internal.test.ts tests/unit/layout/layout.test.ts && npm run typecheck`
Expected: PASS; `tsc -b` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/modes/enderio.ts src/server/layout/modes/mode.ts src/server/layout/layout.ts tests/unit/layout/mode-enderio-fluids.test.ts
git commit -m "feat(layout): EnderIO mode ender fluid conduit network, bundles with the item conduit and open fluid ends

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Layout integration — rotation, one configure step per face, parts list, hookup, chest tails

**Files:**
- Modify: `src/server/layout/layout.ts:201-211` (`worldBlock`), the `logisticsHookup` call in `buildHookups` (`layout.ts:~276`), `src/server/layout/hookups.ts:335-371` (`logisticsHookup`), `src/server/layout/steps.ts` (`configureSteps` neighbour, `layoutSteps`, `assignBuildSteps`, `bomFromBlocks`), `src/server/layout/modes/direct.ts` and `src/server/layout/modes/routed.ts` (`tail` on their chests)
- Test: `tests/unit/layout/enderio-layout.test.ts`

**Interfaces:**
- Consumes: Tasks 1–4; Plan 5 `rotateFace`, `rotateConnections`, `sideToward` (`geometry.ts`), `layoutLine`, `buildMode`, `PORT_SPACING`, `StepsInput`, `layoutSteps`, `assignBuildSteps`, `bomFromBlocks`, `logisticsHookup`; Task 2 `conduitFaceText`, `faceName`.
- Produces:
  - `logisticsHookup(input: { …; endConduit?: ModeHookup['endConduit'] })`: the last cell gets `conduits: [{ kind, item: parts[part].key, connections: <its link bits> & ~(1 << side), faces: [{ face: FACES[side], ...endConduit.face }] }]`, `side` = `portSide(pos, ports)`, and no `conduits` when the last cell touches no port (the end of a straight guide, ruling R13); `buildHookups` passes `line.mode.hookup.endConduit`.
  - `worldBlock` copies `tail` and turns `conduits`: each conduit's `connections` by `rotateConnections`, each face by `rotateFace`, faces re-sorted in `FACES` order.
  - Build steps: after Plan 5's configure steps, one `configure` step per face of every conduit of every non-ghost block (block order, bundle order, face order): id `layout:conduit:<posKey(pos − origin)>:<kind>:<face>`, text `conduitFaceText(kind, face, nameOf)`, pin = logistics pin for a hookup block, else the site pin.
  - `assignBuildSteps`: a block whose conduits are all fluid conduits belongs to `layout:logistics:fluids` (before the `layout:logistics:line` rule).
  - `bomFromBlocks`: a non-ghost block with `conduits` counts each conduit's `item` once (`why` `conduits`, or `logistics hookup` on a hookup block; group `logistics`) instead of `b.item`; every side's `filter.item` once (`conduit filters`) and every `extract.speed` `count` times (`conduit speed upgrades`), group `logistics`.
  - `direct.ts`: input chest `tail: { side: 'input', keys: rawItemInputs(…) }`, output chest `i` `tail: { side: 'output', keys: [outputs[i]] }`; `routed.ts`: input chest `{ side: 'input', keys: rawItemInputs(…) }`, output chest `{ side: 'output', keys: finalItemOutputs(…) }`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/layout/enderio-layout.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { buildMode, PORT_SPACING } from '../../../src/server/layout/modes/mode.ts';
import { faceName } from '../../../src/shared/layout/configure-text.ts';
import { rotateConnections, rotateFace, sideToward } from '../../../src/shared/layout/geometry.ts';
import { FACES, type Face } from '../../../src/shared/types/assets.ts';
import type { Layout } from '../../../src/shared/types/layout.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';
import { BASIC, ITEM, basic, fluidPlan, lineGround, lineScan, setup, twoStep } from '../../helpers/enderio-fixtures.ts';

const placed = (rotation: 0 | 90 | 180 | 270) => makeProject({ logistics: 'enderio', placement: { origin: [30, 64, 10], rotation } });
const faceList = (l: Layout, turn: (f: Face) => Face) =>
  l.blocks.flatMap((b) => (b.conduits ?? []).flatMap((c) => c.faces.map((f) => `${c.kind} ${turn(f.face)} ${f.mode} ${f.target}`))).sort();
const linkList = (l: Layout, turn: (n: number) => number) => l.blocks.flatMap((b) => (b.conduits ?? []).map((c) => `${c.kind} ${turn(c.connections)}`)).sort();

describe('an EnderIO line in the layout', () => {
  it('puts every conduit and filter in the parts list and gives every configured face its own configure step', async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), lineScan(), placed(0), lineGround());
    expect([layout.status, layout.mode, layout.rotation]).toEqual(['ok', 'enderio', 0]);
    expect(layout.bom).toContainEqual({ key: ITEM, amount: 4, why: 'conduits', group: 'logistics' });
    expect(layout.bom).toContainEqual({ key: BASIC, amount: 8, why: 'conduit filters', group: 'logistics' });
    const steps = layout.buildSteps.filter((s) => s.id.startsWith('layout:conduit:'));
    // ruling R12: the power head is 3 columns wide, so the spine starts at local x 3; Plan 5's tier spacing leaves x 4
    // empty between the LV macerators and the MV assembler, and the tail is x 6
    expect(steps.map((s) => s.id)).toEqual(['layout:conduit:3,0,2:item:north', 'layout:conduit:3,0,2:item:south', 'layout:conduit:5,0,2:item:north',
      'layout:conduit:6,0,2:item:north', 'layout:conduit:6,0,2:item:south']);
    expect(steps.every((s) => s.kind === 'configure' && s.pin === layout.pins.find((p) => p.kind === 'site')!.n)).toBe(true);
    expect(steps[3]!.text).toBe('Item Conduit, north face to Chest (input): Extract; extract on Blue with a Basic Item Filter '
      + '(whitelist: Raw Input; match meta, ignore NBT), round robin on, self feed off, redstone Always active');
    expect(layout.buildSteps.find((s) => s.id === 'layout:configure:s1')!.text).toContain('allow input from the output side');
    expect(layout.blocks.filter((b) => b.conduits !== undefined).every((b) => b.buildStep === 'layout:logistics:line')).toBe(true);
  });

  it('turns every conduit face with the line', async () => {
    const pack = layoutPack();
    const flat = await layoutLine(pack, twoStep(), lineScan(), placed(0), lineGround());
    const turned = await layoutLine(pack, twoStep(), lineScan(), placed(90), lineGround());
    expect(turned.rotation).toBe(90);
    expect(faceList(turned, (f) => f)).toEqual(faceList(flat, (f) => rotateFace(f, 90)));
    expect(linkList(turned, (n) => n)).toEqual(linkList(flat, (n) => rotateConnections(n, 90)));
    const chestStep = turned.buildSteps.find((s) => s.text.includes('to Chest (input)'))!;
    expect(chestStep.text.startsWith(`Item Conduit, ${faceName(rotateFace('north', 90))} face to Chest (input): Extract`)).toBe(true);
  });

  it("ends an EnderIO hookup on an Insert face into the input chest and asks for the storage tap's Extract face", async () => {
    const layout = await layoutLine(layoutPack(), twoStep(), lineScan({ logistics: [{ kind: 'enderio', taps: [[26, 64, 12]] }] }), placed(0), lineGround());
    const hookup = layout.hookups.findIndex((h) => h.kind === 'logistics');
    expect(layout.hookups[hookup]!.found).toBe(true);
    const end = layout.blocks.find((b) => b.hookup === hookup && b.conduits !== undefined)!;
    const chest = layout.blocks.find((b) => b.tail?.side === 'input')!;
    expect(end.conduits![0]!.faces).toEqual([{ face: FACES[sideToward(end.pos, chest.pos)], mode: 'insert', target: 'Chest (input)',
      insert: { color: 'green', filter: basic(['t:in@0']), rate: 1, priority: 1 } }]);
    expect(layout.buildSteps.find((s) => s.id === 'layout:configure:conduit-tap')!.text).toBe('At the storage tap set the conduit face toward your storage '
      + 'to Extract (In / Out if it already inserts); extract on Green with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT), '
      + 'round robin off, self feed off, redstone Always active');
    expect(layout.bom).toContainEqual({ key: BASIC, amount: 10, why: 'conduit filters; filter at the storage tap', group: 'logistics' });
    const endStep = layout.buildSteps.find((s) => s.id.startsWith('layout:conduit:') && s.text.includes('insert on Green'))!;
    expect(endStep.pin).toBe(layout.pins.find((p) => p.kind === 'logistics')!.n);
  });

  it('gives the fluid conduits to the fluid step', async () => {
    const layout = await layoutLine(layoutPack(), fluidPlan(), lineScan(), placed(0), lineGround());
    const fluidOnly = layout.blocks.filter((b) => b.conduits !== undefined && b.conduits.every((c) => c.kind !== 'item'));
    expect(fluidOnly.length).toBeGreaterThan(0);
    expect(fluidOnly.every((b) => b.buildStep === 'layout:logistics:fluids')).toBe(true);
  });

  it('marks the tail chests of the other modes too', () => {
    const chests = (mode: 'direct' | 'routed') =>
      buildMode(mode, { ...setup(twoStep(), PORT_SPACING[mode]), network: null }).blocks.filter((b) => b.role === 'chest').map((b) => b.tail);
    expect(chests('direct')).toEqual([{ side: 'input', keys: ['t:in@0'] }, { side: 'output', keys: ['t:out_s2@0'] }]);
    expect(chests('routed')).toEqual([{ side: 'input', keys: ['t:in@0'] }, { side: 'output', keys: ['t:out_s2@0'] }]);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/layout/enderio-layout.test.ts`
Expected: FAIL — no `layout:conduit:` steps, the BOM has no `conduits` line, chests have no `tail`.

- [ ] **Step 3: Implement the changes listed under Interfaces**

- [ ] **Step 4: Run the layout tests to verify they pass**

Run: `npx vitest run tests/unit/layout && npm run typecheck`
Expected: every layout test file PASS (Plan 5's included); `tsc -b` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/layout/layout.ts src/server/layout/hookups.ts src/server/layout/steps.ts src/server/layout/modes/direct.ts src/server/layout/modes/routed.ts tests/unit/layout/enderio-layout.test.ts
git commit -m "feat(layout): conduit faces turn with the line, one configure step per face, conduit parts in the build list, EnderIO hookup face

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Map overlay and 3D view of conduits

**Files:**
- Create: `tests/client/enderio-fixture.ts`, `tests/client/scene-conduits.test.tsx`
- Modify: `src/server/assets/curated.ts:45-48` (`CONDUITS`), `src/shared/layout/enderio.ts` (`hookupNetworkKind`), `src/client/three/scene-data.ts`, `src/client/three/load-textures.ts` (`loadSceneInputs`), `src/client/three/renderer.ts` (`meshOf`), `src/client/map/layout-overlay.ts`
- Test: `tests/unit/assets/curated.test.ts` (one case), `tests/client/scene-conduits.test.tsx`, `tests/client/layout-map.test.tsx` (one case)

**Interfaces:**
- Consumes: Task 1 types, `CONDUIT_NAMES`; Task 2 `conduitLines`; Plan 5 `buildScene`, `SceneInstance`, `blockKey`, `blockList`, `pickInfo`, `hoverText`, `PIPE_ROLES` handling (`scene-data.ts`), `loadSceneInputs` (`load-textures.ts`), `meshOf` (`renderer.ts`), `overlayShapes`, `ROLE_COLORS`, `configured` (`layout-overlay.ts`), `LOGISTICS_COLORS` (`map/overlays.ts`, `enderio: '#26c6da'`); Plan 3 `conduitBlockRef`, `curatedBlock`, `curatedIds`.
- Produces:
  ```ts
  // src/client/three/scene-data.ts
  export interface SceneInstance { /* … */ /** Shift from the cell centre, in blocks: conduits of one bundle side by side. */ offset?: Vec3 }
  /** The refs a block is drawn with: its own, then per conduit `conduit:<kind>` and `conduit:connector_<mode>` for each non-disabled face; each once, in that order. */
  export function sceneBlockRefs(b: LayoutBlock): BlockRef[];
  // src/client/three/renderer.ts
  /** Where an instance sits: its cell centre plus `offset`. */
  export function instanceTranslation(inst: SceneInstance): Vec3;
  // src/shared/layout/enderio.ts (shared, so the Connections model of Task 7 can use it from the server test project too)
  /** The network a hookup joins: null for power; a `pipe` tap is EnderIO in enderio mode or when its network id starts with `e:` (Plan 4's `e:item:…`), else a GT pipe. */
  export function hookupNetworkKind(h: Hookup, mode: LogisticsMode): LogisticsNetwork['kind'] | null;
  ```
  `layout-overlay.ts` imports it for the hookup colour.
  ```ts
  // tests/client/enderio-fixture.ts (client tests only; no server imports)
  export const ITEM: string; export const ENDER: string; export const BASIC: string; export const SPEED: string;   // the four EnderIO keys
  export function basic(keys: string[]): ConduitFilter;
  export const E: (name: string) => TextureLayer;              // enderio/textures/blocks/<name>.png
  export const bundle: LayoutBlock;                            // the bundle below
  export const bundleLayout: Layout;                           // origin [10, 64, 20], size [1, 1, 1], mode enderio, blocks [bundle]
  export const enderioNames: Record<string, string>;           // BASIC, SPEED, t:dust@0, t:in@0, fluid:molten.iron
  ```

Rules:
- `curated.ts` `CONDUITS` gains `liquid_ender: 'liquidConduitEnder'`, `liquid_crystalline: 'liquidConduitCrystallineEnder'`, `liquid_pink_slime: 'liquidConduitCrystallinePinkSlimeEnder'`, `liquid_melodic: 'liquidConduitMelodicEnder'`, `liquid_stellar: 'liquidConduitStellarEnder'`, `connector_extract: 'itemConduitInput'`, `connector_insert: 'itemConduitOutput'`, `connector_in_out: 'itemConduitInOut_Out'` (the textures `ItemConduit` and `AbstractEnderLiquidConduit` draw for those modes; all are in the EnderIO 2.10.46 jar, so `npm run extract-assets` already copied them).
- `buildScene`: a block with `conduits` draws, for conduit `i` of `n`, a `core` and an `arm` for every side (ascending) that is one of its links (tile: the conduit's `north` face) or one of its non-disabled faces (tile: `conduit:connector_<mode>`'s `north` face); with `n ≥ 2` every one of those instances has `offset: [0, (i − (n − 1) / 2) × 6/16, 0]`. Any other block draws as before.
- `pickInfo` / `hoverText`: after the `configuredLines`, one line per `conduitLines` entry.
- `blockList`: a block with `conduits` gives a `pipe` row per conduit named `CONDUIT_NAMES[kind]` (not its own label); each side's `filter.item` and each `extract.speed` (`count` of them) add to a `cover`-role row named `names[item] ?? item`.
- `loadSceneInputs` asks for `sceneBlockRefs(b)` of every block instead of `b.block` alone; `meshOf` translates by `instanceTranslation(inst)`.
- `overlayShapes`: a column whose chosen block holds `conduits` fills with `LOGISTICS_COLORS.enderio`; `configured(b)` is also true when any conduit has a face; a logistics hookup's colour is `LOGISTICS_COLORS[hookupNetworkKind(h, layout.mode)]`.

- [ ] **Step 1: Write the fixture and the failing tests**

`tests/client/enderio-fixture.ts` builds `bundle`:

```ts
export const bundle: LayoutBlock = { pos: [10, 64, 20], block: { id: 'conduit:item', meta: 0 }, role: 'pipe',
  label: 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', item: ITEM, connections: 4 | 32 | 2 | 16, conduits: [
    { kind: 'item', item: ITEM, connections: 32, faces: [{ face: 'north', mode: 'in_out', target: 'Basic Macerator',
      extract: { color: 'red', filter: basic(['t:dust@0']), rate: 20, roundRobin: false, selfFeed: false, redstone: 'ignore', speed: { item: SPEED, count: 2 } },
      insert: { color: 'blue', filter: basic(['t:in@0']), rate: 20, priority: 1 } }] },
    { kind: 'liquid_ender', item: ENDER, connections: 16, faces: [
      { face: 'up', mode: 'extract', target: 'Basic Fluid Extractor',
        extract: { color: 'red', filter: { whitelist: true, keys: ['fluid:molten.iron'] }, rate: 1, roundRobin: false, redstone: 'ignore' } },
      { face: 'south', mode: 'disabled', target: 'Basic Macerator' }] }] };
```

`tests/client/scene-conduits.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { blockKey, blockList, buildScene, hoverText, pickInfo, sceneBlockRefs, type SceneInstance } from '../../src/client/three/scene-data.ts';
import { instanceTranslation } from '../../src/client/three/renderer.ts';
import type { BlockFaces } from '../../src/shared/types/assets.ts';
import type { Plan } from '../../src/shared/types/plan.ts';
import { E, bundle, bundleLayout, enderioNames } from './enderio-fixture.ts';

const faceSet = (id: string, name: string): [string, BlockFaces] => {
  const block = { id, meta: 0 };
  return [blockKey(block), { block, resolved: true, fallbackColor: [1, 2, 3],
    faces: { down: [E(name)], up: [E(name)], north: [E(name)], south: [E(name)], west: [E(name)], east: [E(name)] } }];
};
const faces = new Map([faceSet('conduit:item', 'itemConduit'), faceSet('conduit:liquid_ender', 'liquidConduitEnder'),
  faceSet('conduit:connector_in_out', 'itemConduitInOut_Out'), faceSet('conduit:connector_extract', 'itemConduitInput')]);
const plan = { names: enderioNames } as unknown as Plan;

describe('conduits in the 3D view', () => {
  it('names the conduit and connector textures a bundle needs', () => {
    expect(sceneBlockRefs(bundle).map((r) => r.id)).toEqual(['conduit:item', 'conduit:connector_in_out', 'conduit:liquid_ender', 'conduit:connector_extract']);
  });
  it('draws each conduit of a bundle side by side, with connector arms on its configured faces', () => {
    const scene = buildScene(bundleLayout, faces, new Map(), new Map());
    const texture = (tile: number) => (JSON.parse(scene.tiles[tile]!.key) as Array<{ path: string }>)[0]!.path.replace(/^.*\/(\w+)\.png$/, '$1');
    expect(scene.instances.map((i) => [i.shape, i.side, i.offset, texture(i.tiles[2])])).toEqual([
      ['core', -1, [0, -0.1875, 0], 'itemConduit'], ['arm', 2, [0, -0.1875, 0], 'itemConduitInOut_Out'], ['arm', 5, [0, -0.1875, 0], 'itemConduit'],
      ['core', -1, [0, 0.1875, 0], 'liquidConduitEnder'], ['arm', 1, [0, 0.1875, 0], 'itemConduitInput'], ['arm', 4, [0, 0.1875, 0], 'liquidConduitEnder']]);
  });
  it('lists each conduit and every filter and upgrade in the block list', () => {
    expect(blockList(bundleLayout, enderioNames).place).toEqual([
      { label: 'Basic Item Filter', role: 'cover', count: 2 }, { label: 'Item Conduit Speed Upgrade', role: 'cover', count: 2 },
      { label: 'Ender Fluid Conduit', role: 'pipe', count: 1 }, { label: 'Item Conduit', role: 'pipe', count: 1 }]);
  });
  it('shows every conduit face in the click info and the hover text', () => {
    expect(pickInfo(bundleLayout, plan, 0)).toEqual({ title: 'Conduit bundle (Item Conduit + Ender Fluid Conduit)', lines: [
      'Item Conduit, north face to Basic Macerator: In / Out; extract on Red with a Basic Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), '
        + '2× Item Conduit Speed Upgrade, round robin off, self feed off, redstone Always active; insert on Blue with a Basic Item Filter '
        + '(whitelist: Raw Input; match meta, ignore NBT), priority 1',
      'Ender Fluid Conduit, top face to Basic Fluid Extractor: Extract; extract on Red with a fluid filter (whitelist: Molten Iron), round robin off, redstone Always active',
      'Ender Fluid Conduit, south face to Basic Macerator: Disabled'] });
    expect(hoverText(bundleLayout, plan, 0).startsWith('Conduit bundle (Item Conduit + Ender Fluid Conduit) — Item Conduit, north face')).toBe(true);
  });
  it('moves an offset instance off its cell centre', () => {
    const inst: SceneInstance = { block: 0, shape: 'core', pos: [1, 2, 3], side: -1, tiles: [0, 0, 0, 0, 0, 0], ghost: false };
    expect(instanceTranslation(inst)).toEqual([1.5, 2.5, 3.5]);
    expect(instanceTranslation({ ...inst, offset: [0, 0.1875, 0] })).toEqual([1.5, 2.6875, 3.5]);
  });
});
```

In `tests/client/layout-map.test.tsx` add (using the file's existing viewport fixture as `view`; imports `hookupNetworkKind` from `src/shared/layout/enderio.ts` and `bundleLayout` from `./enderio-fixture.ts`):

```tsx
it('draws an EnderIO line in the EnderIO colour with a dot on its configured conduits', () => {
  const hookup = { kind: 'logistics' as const, from: { pos: [8, 64, 20] as [number, number, number], dim: 0, kind: 'pipe' as const, networkId: 'enderio:0:0' },
    path: [[8, 64, 20], [9, 64, 20]] as Array<[number, number, number]>, parts: [] };
  const shapes = overlayShapes({ ...bundleLayout, hookups: [hookup] }, view, null, []);
  expect(shapes.find((s) => s.kind === 'rect' && s.fill !== null)).toMatchObject({ fill: '#26c6da' });
  expect(shapes.filter((s) => s.kind === 'dot')).toHaveLength(1);
  expect(shapes.find((s) => s.kind === 'path')).toMatchObject({ stroke: '#26c6da' });
  expect([hookupNetworkKind(hookup, 'direct'), hookupNetworkKind({ ...hookup, from: { ...hookup.from, networkId: 'e:item:0:1' } }, 'direct'),
    hookupNetworkKind({ ...hookup, kind: 'power' }, 'enderio')]).toEqual(['gtpipe', 'enderio', null]);
});
```

In `tests/unit/assets/curated.test.ts` add:

```ts
it('draws the ender fluid conduits and the connector of each conduit mode', () => {
  expect(curatedBlock('conduit:liquid_ender', 0)!.faces.north).toEqual(['enderio/textures/blocks/liquidConduitEnder.png']);
  expect(curatedBlock('conduit:liquid_stellar', 0)!.faces.up).toEqual(['enderio/textures/blocks/liquidConduitStellarEnder.png']);
  expect(['connector_extract', 'connector_insert', 'connector_in_out'].map((k) => curatedBlock(`conduit:${k}`, 0)!.faces.north)).toEqual([
    ['enderio/textures/blocks/itemConduitInput.png'], ['enderio/textures/blocks/itemConduitOutput.png'], ['enderio/textures/blocks/itemConduitInOut_Out.png']]);
  expect(curatedIds()).toEqual(expect.arrayContaining(['conduit:liquid_crystalline', 'conduit:liquid_pink_slime', 'conduit:liquid_melodic']));
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/client/scene-conduits.test.tsx tests/client/layout-map.test.tsx tests/unit/assets/curated.test.ts`
Expected: FAIL — `sceneBlockRefs`, `instanceTranslation` and `hookupNetworkKind` are not exported; `conduit:liquid_ender` is not curated.

- [ ] **Step 3: Implement the rules above**

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/client tests/unit/assets && npm run typecheck`
Expected: PASS (Plan 5's `scene-data`, `view3d` and `layout-map` cases included); `tsc -b` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/server/assets/curated.ts src/shared/layout/enderio.ts src/client/three/scene-data.ts src/client/three/load-textures.ts src/client/three/renderer.ts src/client/map/layout-overlay.ts tests/client/enderio-fixture.ts tests/client/scene-conduits.test.tsx tests/client/layout-map.test.tsx tests/unit/assets/curated.test.ts
git commit -m "feat(client): conduit bundles in 3D with connector arms per face mode, EnderIO colours and configured marks on the map

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Connections graph model for all four modes (pure)

**Files:**
- Create: `src/client/connections/model.ts`, `tests/client/connections-fixture.ts`
- Modify: `src/shared/layout/format.ts` (`NETWORK_NAMES`, moved from `src/server/layout/pins.ts`, which then imports it)
- Test: `tests/client/connections-model.test.tsx`, `tests/unit/layout/connections-graph.test.ts`

**Interfaces:**
- Consumes: Task 1 types and `DYE_NAMES`, `CONDUIT_NAMES`; Task 2 `conduitFaceText`; Task 6 `hookupNetworkKind`; Plan 5 `coverText`, `configTexts`, `faceName` (`configure-text.ts`), `posKey`, `step`, `OPPOSITE` (`geometry.ts`), `fmtInt`, `fmtRate` (`format.ts`), `TIER_NAMES`, `isFluidKey`, `Layout`, `Plan`, `ElkNode`/`ElkExtendedEdge` types (`elkjs/lib/elk-api.js`, type-only).
- Produces:
  ```ts
  // src/client/connections/model.ts — no DOM, no browser APIs (the server test project imports it too)
  export type ConnNodeKind = 'machine' | 'chest' | 'interface' | 'hookup' | 'source' | 'sink';
  export interface ConnFace { id: string; title: string; lines: string[] }
  export interface ConnNode { id: string; kind: ConnNodeKind; title: string; lines: string[]; faces: ConnFace[]; blocks: number[] /* indices into layout.blocks */; width: number; height: number }
  export type ConnVia = 'gt_pipe' | 'fluid_pipe' | 'routed' | 'ae2' | 'item_conduit' | 'fluid_conduit' | 'attached' | 'hookup';
  export interface ConnEdge { id: string; from: string; to: string; via: ConnVia; key: StuffKey | null; perSecond: number; label: string; lines: string[];
    color: DyeColor | null; fromFace: string | null; toFace: string | null }
  export interface ConnGraph { nodes: ConnNode[]; edges: ConnEdge[] }
  export const CONN_NODE_WIDTH = 260; export const CONN_TITLE_HEIGHT = 28; export const CONN_LINE_HEIGHT = 16;
  export function connectionsGraph(layout: Layout, plan: Plan, per: 'min' | 'hour'): ConnGraph;
  export function connectionsElk(g: ConnGraph): ElkNode;
  export interface ConnLayout { width: number; height: number; nodes: Array<ConnNode & { x: number; y: number }>;
    edges: Array<ConnEdge & { points: Array<[number, number]>; labelAt?: [number, number] }> }
  export function connectionsFromElk(g: ConnGraph, laid: ElkNode): ConnLayout;
  export type ConnPick = { node: string; face?: string } | { edge: string };
  export function pickDetails(g: ConnGraph, pick: ConnPick): { title: string; lines: string[] } | null;
  ```
  ```ts
  // tests/client/connections-fixture.ts
  export const CONV: string; export const FILTER: string;      // the GT conveyor and filtered conveyor cover keys
  export const connPlan: Plan;                                  // steps a (Basic Macerator, LV, 2 EU/t) and b (Advanced Assembler, MV, 30 EU/t); flows raw→a t:in@0, a→b t:dust@0, b→out t:ingot@0, 1/s each; names for every key used
  export function connLayout(mode: LogisticsMode): Layout;      // the four layouts below
  ```

Graph rules (exact; `nameOf(k)` = `plan.names?.[k] ?? k`):
- **Nodes**, in this order: one `machine` per plan step (plan order) with a non-ghost, non-hookup block of its `stepId` — id `step:<stepId>`, title `<n>× <machine name>` (n = its `machine`-role blocks, at least 1), lines `[<TIER_NAMES[tier]> · <fmtInt(euPerTick)> EU/t]`; one `chest` per non-ghost, non-hookup chest — id `chest:<posKey>`, title its label, lines `Takes in: <names>` (input tail) or `Collects: <names>` (output tail); one `interface` per non-ghost `interface` or `chip_pipe` block — id `iface:<posKey>`, title its label, lines `configTexts(config ?? {})`; one `hookup` per `layout.hookups[i]` — id `hookup:<i>`, title `Power tap at <x> <y> <z>` or `<NETWORK_NAMES[kind]> tap at <x> <y> <z>`, lines `<n> block(s) to lay`, then `<fmtInt(amount)>× <name>` per part, then `No free route was found: the path is a straight guide line` when `found === false`; `source` `raw` (`Raw inputs`) and `sink` `out` (`Final outputs`) only when a link or a loose conduit face row needs them (a face toward no box goes to `raw` when it extracts, else to `out`).
- **Faces** of a node, by its blocks in index order: each own cover `{ id: '<node>#cover:<posKey>:<face>', title: '<label>, <faceName> face', lines: [coverText] }`; its config `{ id: '<node>#config:<posKey>', title: '<label> settings', lines: configTexts }`; each cover of a `pipe`-role block whose face points at the block (same id and title shapes, with the pipe's pos and label); each conduit face of any block that points at the block `{ id: '<node>#conduit:<conduit posKey>:<kind>:<face>', title: '<label>, <faceName(opposite)> side · <conduit name>', lines: [conduitFaceText] }`. A conduit face pointing at no node block goes to `raw` when it extracts and `out` when it only inserts (an open fluid end).
- **Flow edges**, in plan flow order, merged per (from, to, key) by summing `perSecond`: from = `step:<from>` when that step has a node, else the input chest whose tail keys hold the key, else `raw`; to = `step:<to>`, else the output chest holding the key, else `out`; flows with neither end placed are skipped. id `flow:<from>><to>:<key>`; via: a fluid key → `fluid_conduit` (enderio) or `fluid_pipe`; an item → `gt_pipe` / `routed` / `ae2` / `item_conduit` by mode. `fromFace` = the source node's first conduit face whose extract filter holds the key, `toFace` = the target's first whose insert filter holds it; `color` = that extract colour, else that insert colour, else null. label `<name> <fmtRate(perSecond × 60 | 3600)>/<min|h>[ · <colour name>]`; lines `[<via text>[, channel <colour>], From <from title>[ — <fromFace title>], …fromFace lines, To <to title>[ — <toFace title>], …toFace lines]`, via texts `Shared GT item pipe`, `GT fluid pipe`, `Project Red routed network`, `ME network`, `Item Conduit`, `Ender fluid conduit`.
- **Attached edges**: each interface → each machine or chest node one of whose blocks touches it, id `attach:<iface>><node>`, via `attached`, label `` (no ELK label), lines `[Attached to <node title>]`. **Hookup edges**: each logistics hookup → (1) the node holding the block its end block points at (its `facing`, or a conduit face that is not Disabled; never its own end interface), else (2) the input chest node (`tail === 'input'`), else (3) `raw` when the graph has it, else none (ruling R20 as amended in Task 7: an AE2 tap joins `Raw inputs`); id `hookup:<i>><node>`, via `hookup`, label `hookup`, lines `[Joins the line at <node title>]`. Edge order: flows, attached, hookups.
- Node size: width `CONN_NODE_WIDTH`, height `CONN_TITLE_HEIGHT + CONN_LINE_HEIGHT × (lines + faces) + 8`.
- `connectionsElk`: flow-model's layout options (layered, RIGHT, orthogonal, 60 between layers); `elk.layered.layering.layerConstraint` `FIRST` for `raw` and input chests, `FIRST_SEPARATE` for hookups (ELK 0.12.0 refuses a link between two `FIRST` boxes, and a hookup's link always ends in one), `LAST` for `out` and output chests; a label box per non-empty label (`ceil(length × 6.5) + 8` × 14). `connectionsFromElk` reads positions and first sections back as flow-model's `fromElk` does, with the same straight fallback.
- `pickDetails`: a node → `{ title, lines: [...lines, ...faces.flatMap((f) => [f.title, ...f.lines])] }`; a node and face → the face's title and lines; an edge → its label (its first line when the label is empty, as for an attached link) and its lines; anything unknown → null.

The fixture layouts (origin `[0, 64, 0]`, size `[3, 1, 3]`, rotation 0, status ok; machine a at `[0, 64, 0]`, b at `[1, 64, 0]`, both facing south; input chest `[2, 64, 0]` (tail `t:in@0`), output chest `[2, 64, 2]` (tail `t:ingot@0`) except in AE2):
- `enderio`: Item Conduits at `[0, 64, 1]` (north In / Out to Basic Macerator: extract red `[t:dust@0]`, insert blue `[t:in@0]` priority 1), `[1, 64, 1]` (north In / Out to Advanced Assembler: extract yellow `[t:ingot@0]`, insert red `[t:dust@0]` priority 1) and `[2, 64, 1]` (north Extract to Chest (input): blue `[t:in@0]`; south Insert to Chest (output): yellow `[t:ingot@0]` priority 0), all Basic filters, rates 1, round robin off, self feed off, redstone ignore.
- `direct`: each machine has a `CONV` export cover on its south face (`{ mode: 'export', allowInput: true, rate: 1, unit: 'items/s' }`) and config `{ inputFilter: true, inputFromOutputSide: true }`; Tin Item Pipes at `[0..2, 64, 1]`, the last with a `CONV` import cover north (`{ mode: 'import', allowInput: false, rate: 1, unit: 'items/s' }`) and a `FILTER` whitelist cover south with filter `[t:ingot@0]`.
- `routed`: chip pipes `Routed Interface Pipe (Basic Macerator)` at `[0, 64, 1]` (chips `Item Responder Chip (whitelist: Raw Input) + Item Extractor Chip`) and `Routed Interface Pipe (Advanced Assembler)` at `[1, 64, 1]` (chips `Item Responder Chip (whitelist: Titanium Dust) + Item Extractor Chip`), a `Routed Request Pipe` at `[2, 64, 1]`.
- `ae2`: the direct mode's export covers; ME interfaces `ME Interface (Basic Macerator)` at `[0, 64, 1]` (`{ patterns: 1, pattern: '1× Raw Input → 1× Titanium Dust', blockingMode: false }`) and `ME Interface (Advanced Assembler)` at `[1, 64, 1]`; ME glass cable at `[2, 64, 1]`; no chests; one logistics hookup from an `ae2` tap at `[3, 64, 1]` with one hookup cable block there and parts `[{ key: 'appliedenergistics2:item.ItemMultiPart@16', amount: 1 }]`.

- [ ] **Step 1: Write the fixture and the failing tests**

`tests/client/connections-model.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { connectionsElk, connectionsFromElk, connectionsGraph, pickDetails } from '../../src/client/connections/model.ts';
import { connLayout, connPlan } from './connections-fixture.ts';

const MACERATOR_FACE = 'Item Conduit, north face to Basic Macerator: In / Out; extract on Red with a Basic Item Filter (whitelist: Titanium Dust; match meta, ignore NBT), '
  + 'round robin off, self feed off, redstone Always active; insert on Blue with a Basic Item Filter (whitelist: Raw Input; match meta, ignore NBT), priority 1';

describe('the Connections graph', () => {
  it('draws an EnderIO line: machines and chests with their conduit faces, flows on their channels', () => {
    const g = connectionsGraph(connLayout('enderio'), connPlan, 'min');
    expect(g.nodes.map((n) => [n.id, n.kind, n.title, n.lines])).toEqual([
      ['step:a', 'machine', '1× Basic Macerator', ['LV · 2 EU/t']], ['step:b', 'machine', '1× Advanced Assembler', ['MV · 30 EU/t']],
      ['chest:2,64,0', 'chest', 'Chest (input)', ['Takes in: Raw Input']], ['chest:2,64,2', 'chest', 'Chest (output)', ['Collects: Titanium Ingot']]]);
    expect(g.nodes[0]!.faces).toEqual([{ id: 'step:a#conduit:0,64,1:item:north', title: 'Basic Macerator, south side · Item Conduit', lines: [MACERATOR_FACE] }]);
    expect([g.nodes[0]!.width, g.nodes[0]!.height]).toEqual([260, 68]);
    expect(g.edges.map((e) => [e.id, e.via, e.label, e.color, e.fromFace, e.toFace])).toEqual([
      ['flow:chest:2,64,0>step:a:t:in@0', 'item_conduit', 'Raw Input 60/min · Blue', 'blue', 'chest:2,64,0#conduit:2,64,1:item:north', 'step:a#conduit:0,64,1:item:north'],
      ['flow:step:a>step:b:t:dust@0', 'item_conduit', 'Titanium Dust 60/min · Red', 'red', 'step:a#conduit:0,64,1:item:north', 'step:b#conduit:1,64,1:item:north'],
      ['flow:step:b>chest:2,64,2:t:ingot@0', 'item_conduit', 'Titanium Ingot 60/min · Yellow', 'yellow', 'step:b#conduit:1,64,1:item:north', 'chest:2,64,2#conduit:2,64,1:item:south']]);
    expect(g.edges[1]!.lines.slice(0, 3)).toEqual(['Item Conduit, channel Red', 'From 1× Basic Macerator — Basic Macerator, south side · Item Conduit', MACERATOR_FACE]);
  });

  it('draws a machine-to-machine line with its covers and settings on the boxes', () => {
    const g = connectionsGraph(connLayout('direct'), connPlan, 'hour');
    expect(g.nodes.find((n) => n.id === 'step:a')!.faces).toEqual([
      { id: 'step:a#cover:0,64,0:south', title: 'Basic Macerator, south face', lines: ['Conveyor Module (LV) on the south face: Export, allow input, 1 items/s'] },
      { id: 'step:a#config:0,64,0', title: 'Basic Macerator settings', lines: ['Input Filter on', 'allow input from the output side'] }]);
    expect(g.nodes.find((n) => n.id === 'chest:2,64,2')!.faces).toEqual([
      { id: 'chest:2,64,2#cover:2,64,1:south', title: 'Tin Item Pipe, south face', lines: ['Filtered Conveyor Cover (Export) on the south face: whitelist Titanium Ingot'] }]);
    expect(g.edges.map((e) => [e.from, e.to, e.via, e.label, e.color])).toEqual([
      ['chest:2,64,0', 'step:a', 'gt_pipe', 'Raw Input 3,600/h', null], ['step:a', 'step:b', 'gt_pipe', 'Titanium Dust 3,600/h', null],
      ['step:b', 'chest:2,64,2', 'gt_pipe', 'Titanium Ingot 3,600/h', null]]);
  });

  it('draws a routed line with an interface box on every machine', () => {
    const g = connectionsGraph(connLayout('routed'), connPlan, 'min');
    expect(g.nodes.filter((n) => n.kind === 'interface').map((n) => [n.id, n.title, n.lines])).toEqual([
      ['iface:0,64,1', 'Routed Interface Pipe (Basic Macerator)', ['chips: Item Responder Chip (whitelist: Raw Input) + Item Extractor Chip']],
      ['iface:1,64,1', 'Routed Interface Pipe (Advanced Assembler)', ['chips: Item Responder Chip (whitelist: Titanium Dust) + Item Extractor Chip']]]);
    expect(g.edges.filter((e) => e.via === 'attached').map((e) => [e.from, e.to])).toEqual([['iface:0,64,1', 'step:a'], ['iface:1,64,1', 'step:b']]);
    expect(g.edges.filter((e) => e.key !== null).map((e) => e.via)).toEqual(['routed', 'routed', 'routed']);
  });

  it('draws an AE2 line from and to the ME network, with each interface pattern and the tap', () => {
    const g = connectionsGraph(connLayout('ae2'), connPlan, 'min');
    expect(g.nodes.map((n) => n.id)).toEqual(['step:a', 'step:b', 'iface:0,64,1', 'iface:1,64,1', 'hookup:0', 'raw', 'out']);
    expect(g.nodes.find((n) => n.id === 'iface:0,64,1')!.lines).toEqual(['1 processing pattern', 'pattern 1× Raw Input → 1× Titanium Dust', 'blocking mode off']);
    expect(g.nodes.find((n) => n.id === 'hookup:0')).toMatchObject({ kind: 'hookup', title: 'AE2 tap at 3 64 1',
      lines: ['1 block to lay', '1× appliedenergistics2:item.ItemMultiPart@16'] });
    expect(g.edges.filter((e) => e.key !== null).map((e) => [e.from, e.to, e.via])).toEqual([['raw', 'step:a', 'ae2'], ['step:a', 'step:b', 'ae2'], ['step:b', 'out', 'ae2']]);
  });

  it('tells the full configuration of a picked box, face or link', () => {
    const g = connectionsGraph(connLayout('enderio'), connPlan, 'min');
    const face = g.nodes[0]!.faces[0]!;
    expect(pickDetails(g, { node: 'step:a' })).toEqual({ title: '1× Basic Macerator', lines: ['LV · 2 EU/t', face.title, ...face.lines] });
    expect(pickDetails(g, { node: 'step:a', face: face.id })).toEqual({ title: face.title, lines: face.lines });
    expect(pickDetails(g, { edge: 'flow:step:a>step:b:t:dust@0' })!.title).toBe('Titanium Dust 60/min · Red');
    expect(pickDetails(g, { node: 'nope' })).toBeNull();
  });

  it('lays inputs first and outputs last, with a label box on every flow', () => {
    const g = connectionsGraph(connLayout('enderio'), connPlan, 'min');
    const elk = connectionsElk(g);
    const constraint = (id: string) => elk.children!.find((c) => c.id === id)!.layoutOptions?.['elk.layered.layering.layerConstraint'];
    expect([constraint('chest:2,64,0'), constraint('chest:2,64,2'), constraint('step:a')]).toEqual(['FIRST', 'LAST', undefined]);
    expect(elk.edges!.map((e) => e.labels?.[0]?.text)).toEqual(['Raw Input 60/min · Blue', 'Titanium Dust 60/min · Red', 'Titanium Ingot 60/min · Yellow']);
    const pic = connectionsFromElk(g, { ...elk, width: 900, height: 300, children: elk.children!.map((c, i) => ({ ...c, x: i * 300, y: 10 })), edges: [] });
    expect([pic.width, pic.nodes[1]!.x, pic.edges[0]!.points.length]).toEqual([900, 300, 2]);
  });
});
```

`tests/unit/layout/connections-graph.test.ts` (the server project, real layouts):

```ts
import { describe, it, expect } from 'vitest';
import { connectionsGraph } from '../../../src/client/connections/model.ts';
import { layoutLine } from '../../../src/server/layout/layout.ts';
import { posKey } from '../../../src/shared/layout/geometry.ts';
import { layoutPack, makeProject } from '../../helpers/layout-fixtures.ts';
import { lineGround, lineScan, twoStep } from '../../helpers/enderio-fixtures.ts';

const placement = { origin: [30, 64, 10] as [number, number, number], rotation: 0 as const };

describe('Connections of laid-out lines', () => {
  it('shows every conduit face of an EnderIO line exactly once, a link per flow and the hookup', async () => {
    const plan = twoStep();
    const layout = await layoutLine(layoutPack(), plan, lineScan({ logistics: [{ kind: 'enderio', taps: [[26, 64, 12]] }] }),
      makeProject({ logistics: 'enderio', placement }), lineGround());
    const g = connectionsGraph(layout, plan, 'min');
    const faceCount = layout.blocks.reduce((n, b) => n + (b.conduits ?? []).reduce((m, c) => m + c.faces.length, 0), 0);
    expect(g.nodes.flatMap((n) => n.faces).filter((f) => f.id.includes('#conduit:'))).toHaveLength(faceCount);
    const chest = (side: 'input' | 'output') => `chest:${posKey(layout.blocks.find((b) => b.tail?.side === side)!.pos)}`;
    expect(g.edges.filter((e) => e.via === 'item_conduit').map((e) => [e.from, e.to])).toEqual([
      [chest('input'), 'step:s1'], ['step:s1', 'step:s2'], ['step:s2', chest('output')]]);
    expect(g.edges.filter((e) => e.via === 'item_conduit').every((e) => e.color !== null && e.fromFace !== null && e.toFace !== null)).toBe(true);
    const hookup = layout.hookups.findIndex((h) => h.kind === 'logistics');
    expect(g.edges.find((e) => e.via === 'hookup')).toMatchObject({ from: `hookup:${hookup}`, to: chest('input') });
  });

  it('builds a link per flow in the other three modes', async () => {
    for (const mode of ['direct', 'routed', 'ae2'] as const) {
      const layout = await layoutLine(layoutPack(), twoStep(), lineScan(), makeProject({ logistics: mode, placement }), lineGround());
      expect(connectionsGraph(layout, twoStep(), 'min').edges.filter((e) => e.key !== null)).toHaveLength(3);
    }
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/client/connections-model.test.tsx tests/unit/layout/connections-graph.test.ts`
Expected: FAIL — `src/client/connections/model.ts` cannot be resolved.

- [ ] **Step 3: Implement `model.ts` and move `NETWORK_NAMES`**

`NETWORK_NAMES: Readonly<Record<LogisticsNetwork['kind'], string>>` = `{ routed: 'Project Red routed', ae2: 'AE2', gtpipe: 'GT pipe', enderio: 'EnderIO' }` moves to `src/shared/layout/format.ts`; `pins.ts` `networkName` reads it. The model finds "points at" with `step(pos, FACES.indexOf(face))` and a posKey → block-index map.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run tests/client/connections-model.test.tsx tests/unit/layout/connections-graph.test.ts tests/unit/layout/pins-steps.test.ts && npm run typecheck`
Expected: PASS; `tsc -b` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/client/connections/model.ts src/shared/layout/format.ts src/server/layout/pins.ts tests/client/connections-fixture.ts tests/client/connections-model.test.tsx tests/unit/layout/connections-graph.test.ts
git commit -m "feat(client): Connections graph of a line in every logistics mode, with each face's configuration and each flow's link

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Connections tab

**Files:**
- Create: `src/client/views/ConnectionsView.tsx`
- Modify: `src/client/views/project-tabs.ts` (`ProjectTab.id`, `PROJECT_TABS`), `src/client/styles.css`
- Test: `tests/client/connections-view.test.tsx`

**Interfaces:**
- Consumes: Task 7 (`connectionsGraph`, `connectionsElk`, `connectionsFromElk`, `pickDetails`, `ConnGraph`, `ConnLayout`, `ConnPick`), Task 1 `DYE_HEX`; Plan 5 `useLayout` (`src/client/state/use-layout.ts`); Plan 2 `layoutFlow` (`src/client/workers/elk.worker.ts`), `ProjectViewProps`, `PROJECT_TABS`, `tabFromHash`, `messageOf` (`src/client/api/client.ts`).
- Produces:
  ```ts
  // src/client/views/ConnectionsView.tsx
  export interface ConnectionsShellProps {
    plan: Plan | null; layout: Layout | null; loading: boolean; error: string | null /* layout fetch */;
    graph: ConnGraph | null; picture: ConnLayout | null; layoutError: string | null /* ELK */; pick: ConnPick | null; onPick(pick: ConnPick | null): void;
  }
  /** Everything the tab shows, from its state (pure markup; tested with renderToStaticMarkup). */
  export function ConnectionsShell(props: ConnectionsShellProps): ReactElement;
  export function ConnectionsView(props: ProjectViewProps): ReactElement;
  // project-tabs.ts: ProjectTab['id'] gains 'connections'; PROJECT_TABS gets { id: 'connections', label: 'Connections', component: ConnectionsView } right after '3d'
  ```

Rules (exact copy):
- Messages, first that applies: plan null → `Planning…`; plan status `empty` → `Pick something to make in the settings`; `infeasible` → `This line cannot be planned yet, so there is nothing to connect`; no layout and a fetch error → alert `Could not load the layout: <error>`; no layout → `Laying out the line…`; layout status `empty` or a graph without nodes → `Nothing to connect yet: the line places no new machines`; no picture and an ELK error → alert `Could not lay out the connections: <error>`; no picture → `Drawing the connections…`.
- The picture: `<div className="connections" data-testid="connections">` holding `<svg role="group" aria-label="Connections of the line">` sized to the picture (`group`, not `img`, whose children are presentational: the boxes, rows and links are what a click picks); edges first, each `<g data-edge={id} className={`conn-edge conn-via-${via}`}>` with a `<polyline>` whose `stroke` is `DYE_HEX[color]` when the edge has a channel (else the via class colours it) and its label `<text>` at `labelAt`; then nodes, each `<g data-node={id} className={`conn-node conn-${kind}`}>` (plus ` selected` when picked) starting with a `<title>` that holds all of its texts, with a `<rect>`, the title, one `<text className="conn-line">` per line and one `<text className="conn-face" data-face={face.id}>` per face (its title); boxes stay `CONN_NODE_WIDTH` (260) wide, so a title longer than 32 characters, or a line or face row longer than 38, shows its first 32 or 38 and '…' (the tooltip and the panel keep it whole). Clicking a rect picks `{ node }`, a face row `{ node, face }`, an edge `{ edge }`.
- A legend `<ul className="conn-legend">` with one item per via present except `attached`: `Shared GT item pipe`, `GT fluid pipe`, `Project Red routed network`, `ME network`, `Item Conduit (line colour = channel)`, `Ender fluid conduit (line colour = channel)`, `Hookup to the base`.
- With a pick whose `pickDetails` is not null: `<aside className="conn-panel" data-testid="conn-panel">` with the title as `<h3>`, the lines as a list, and a `Close` button that picks null.
- `ConnectionsView`: `useLayout(project.id, plan, project)`; `per` = `hour` in Make N mode, else `settings.per`; the graph is memoised on (layout, plan, per); `layoutFlow(connectionsElk(graph))` → `connectionsFromElk`, keeping the previous picture until the new one is laid out and ignoring answers for an older graph (as `FlowView` does); a pick that no longer resolves is dropped.
- `styles.css`: `.connections` scrolls both ways; boxes, face rows (pointer, underline on hover), the selected box and the panel follow the `.flow*` look; via colours match the map's `LOGISTICS_COLORS` (`gt_pipe` `#9ccc65`, `routed` `#ff7043`, `ae2` `#7e57c2`, `fluid_pipe` `#1e88e5`, conduits `#26c6da` when no channel colour, `hookup` dashed).

- [ ] **Step 1: Write the failing tests**

`tests/client/connections-view.test.tsx`:

```tsx
import { describe, it, expect } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { connectionsElk, connectionsFromElk, connectionsGraph } from '../../src/client/connections/model.ts';
import { ConnectionsShell, type ConnectionsShellProps } from '../../src/client/views/ConnectionsView.tsx';
import { PROJECT_TABS, tabFromHash } from '../../src/client/views/project-tabs.ts';
import { connLayout, connPlan } from './connections-fixture.ts';

const graph = connectionsGraph(connLayout('enderio'), connPlan, 'min');
const elk = connectionsElk(graph);
const picture = connectionsFromElk(graph, { ...elk, width: 900, height: 300, children: elk.children!.map((c, i) => ({ ...c, x: i * 300, y: 10 })), edges: [] });
const shell = (over: Partial<ConnectionsShellProps> = {}) => renderToStaticMarkup(<ConnectionsShell plan={connPlan} layout={connLayout('enderio')}
  loading={false} error={null} graph={graph} picture={picture} layoutError={null} pick={null} onPick={() => {}} {...over} />);

describe('the Connections tab', () => {
  it('comes right after 3D', () => {
    expect(PROJECT_TABS.map((t) => t.id)).toEqual(['map', '3d', 'connections', 'flow', 'materials', 'notes']);
    expect(PROJECT_TABS.find((t) => t.id === 'connections')!.label).toBe('Connections');
    expect(tabFromHash('#connections')).toBe('connections');
  });
  it('draws every box, face row and link with its channel colour', () => {
    const html = shell();
    expect(html).toContain('data-testid="connections"');
    for (const id of ['step:a', 'step:b', 'chest:2,64,0', 'chest:2,64,2']) expect(html).toContain(`data-node="${id}"`);
    expect(html).toContain('data-face="step:a#conduit:0,64,1:item:north"');
    expect(html).toContain('Titanium Dust 60/min · Red');
    expect(html).toContain('stroke="#b02e26"');
    expect(html).toContain('Item Conduit (line colour = channel)');
    expect(html).not.toContain('data-testid="conn-panel"');
  });
  it('shows the picked face in the side panel', () => {
    const html = shell({ pick: { node: 'step:a', face: 'step:a#conduit:0,64,1:item:north' } });
    expect(html).toContain('data-testid="conn-panel"');
    expect(html).toContain('<h3>Basic Macerator, south side · Item Conduit</h3>');
    expect(html).toContain('In / Out; extract on Red');
  });
  it('says why there is nothing to draw', () => {
    expect(shell({ plan: null })).toContain('Planning…');
    expect(shell({ layout: null, graph: null, picture: null, loading: true })).toContain('Laying out the line…');
    expect(shell({ layout: null, graph: null, picture: null, error: 'boom' })).toContain('Could not load the layout: boom');
    expect(shell({ layout: { ...connLayout('enderio'), status: 'empty', blocks: [] }, graph: null, picture: null })).toContain('Nothing to connect yet');
    expect(shell({ picture: null })).toContain('Drawing the connections…');
    expect(shell({ picture: null, layoutError: 'elk' })).toContain('Could not lay out the connections: elk');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/client/connections-view.test.tsx`
Expected: FAIL — `src/client/views/ConnectionsView.tsx` cannot be resolved.

- [ ] **Step 3: Implement `ConnectionsView.tsx`, the tab entry and the styles**

- [ ] **Step 4: Run the client tests and typecheck**

Run: `npx vitest run tests/client && npm run typecheck`
Expected: PASS (Plan 2's tab and scaffold tests updated only if they list the tab ids); `tsc -b` exit 0.

- [ ] **Step 5: Commit**

```bash
git add src/client/views/ConnectionsView.tsx src/client/views/project-tabs.ts src/client/styles.css tests/client/connections-view.test.tsx
git commit -m "feat(client): Connections tab — boxes, faces and links of the planned line with their full configuration

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: End-to-end check, real-data check, README

**Files:**
- Create: `tests/e2e/world-upload.ts`, `tests/e2e/connections.spec.ts`, `tests/unit/layout/real-enderio.test.ts`
- Modify: `README.md` (section "EnderIO conduits and the Connections view")
- Local only, never committed: `data/real-config.json`, a world scan under this worktree's `data/scans/`

**Interfaces:**
- Consumes: everything above; Plan 2 e2e harness (`login`, `setName`, `createProject`, `prepare.ts`); Plan 4 `makeSampleWorld` (`tests/helpers/sample-world.ts`), world upload routes, `createWorldService`, `packFacts`, `contextFromScan`, `npm run scan -- --backup <file>`; Plan 1 `loadConfig`, `loadPack`, `activeExportDir`; Plan 2 `planLine`, `defaultSettings`; Plan 5 `layoutLine`, `overlaps`, `PART_DEFS`, the e2e export with the line parts (`withLineParts`, Task 16).
- Produces: `tests/e2e/world-upload.ts`: `export async function uploadSampleWorld(page: Page): Promise<string /* scanId, scan done */>` — Plan 5's `layout.spec.ts` upload loop (sample world in a temp dir, `level.dat` and region files through the upload routes, poll the scan status until `done`).

- [ ] **Step 1: Write the end-to-end test**

`tests/e2e/connections.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import { createProject, login, setName } from './helpers.ts';
import { uploadSampleWorld } from './world-upload.ts';

test('plan an EnderIO line, read its conduit faces in the Connections tab and see the conduits in 3D', async ({ page }) => {
  await login(page);
  await setName(page, 'E2E');
  const scanId = await uploadSampleWorld(page);
  const id = await createProject(page, 'E2E conduits');
  const ops = [{ op: 'settings', patch: { target: 't:iron_plate@0', amount: 24, per: 'min', logistics: 'enderio' } }, { op: 'world', scanId, baseId: '0:0:0' }];
  expect((await page.request.post(`/api/projects/${id}/ops`, { data: { ops }, headers: { 'X-Planner-Name': 'E2E' } })).ok()).toBe(true);
  const layoutOf = async () => (await page.request.get(`/api/projects/${id}/layout`)).json();
  await expect.poll(async () => (await layoutOf()).status, { timeout: 30_000 }).toBe('ok');

  const layout = await layoutOf();
  expect(layout.mode).toBe('enderio');
  const faces = layout.blocks.flatMap((b: { conduits?: Array<{ faces: Array<{ mode: string }> }> }) => (b.conduits ?? []).flatMap((c) => c.faces));
  expect(faces.filter((f: { mode: string }) => f.mode === 'in_out')).toHaveLength(2);           // two bending machines take ingots and make plates
  expect(layout.buildSteps.filter((s: { id: string }) => s.id.startsWith('layout:conduit:'))).toHaveLength(faces.length);
  const plan = await (await page.request.get(`/api/projects/${id}/plan`)).json();
  expect(plan.buildList.find((l: { key: string }) => l.key === 'EnderIO:itemItemConduit@0')).toMatchObject({ group: 'logistics' });

  await expect(page.getByRole('radio', { name: 'EnderIO conduits' })).toBeChecked();
  await page.getByRole('tab', { name: 'Connections' }).click();
  const view = page.getByTestId('connections');
  await expect(view).toContainText('2× Basic Bending Machine');
  // the link, not its line: Chromium gives a straight line an empty box, which Playwright counts as hidden
  await expect(view.locator('[data-edge^="flow:"]:has(polyline[stroke])').first()).toBeVisible();
  await view.locator('.conn-machine rect').first().click();
  await expect(page.getByTestId('conn-panel')).toContainText('In / Out');

  await page.getByRole('tab', { name: '3D' }).click();
  await expect(page.getByTestId('block-list')).toContainText('Item Conduit');
});
```

(The sample world has no EnderIO network at its base, so the line has no logistics hookup and its input chest is filled by hand; Tasks 3 and 5 test the hookup.)

- [ ] **Step 2: Run the whole suite and the end-to-end tests**

Run: `npm run typecheck && npm test && npm run e2e`
Expected: `tsc -b` exit 0; every vitest file PASS (server and client projects); Playwright `connections.spec.ts` passes with Plans 2–5's specs.

- [ ] **Step 3: Write the real-data check**

`tests/unit/layout/real-enderio.test.ts`, guarded by `describe.skipIf(process.env.GTNH_LOCAL !== '1')`, built like Plan 5's `real-layout.test.ts`: `loadConfig()`, `loadPack(activeExportDir(config))`, `createWorldService({ config, facts: async () => packFacts(pack), useWorker: false })`, the newest `done` scan and its first base; plan `GTNH_TARGET` (default `gregtech:gt.metaitem.01@17032`, Iron Plate) at 60/min with `logistics: 'enderio'` through `planLine(pack, settings, contextFromScan(scan, pack, base.id, 'enderio'))`; `layoutLine(pack, plan, scan, project, { readArea: (dim, bbox) => world.readArea(scan.id, dim, bbox) })`. Assert: status `ok`, mode `enderio`; no overlaps among non-ghost blocks; laid out in under 5 s; every `eio_*` part of `PART_DEFS` is in `pack.items` (print `<partId> <key> <pack name>` — pack data — so the keys and names of Task 1 can be re-checked); no `part_unknown` warning; the number of `layout:conduit:` steps equals the number of conduit faces; every BOM line has a group and every conduit, filter and speed-upgrade line is `logistics`; every extract face is `ignore`; either at most 15 item channel colours are used or a `conduit_channels` warning exists; `connectionsGraph(layout, plan, 'min')` has an edge for every flow with a placed end. Print only counts and codes: conduit blocks, bundles, faces per mode, filters per kind, speed upgrades, colours used, whether a logistics hookup was found, warning codes, milliseconds — never positions or names from the world.

- [ ] **Step 4: Run the real-data check (local only)**

With the planner app stopped (opening the world service marks unfinished scans as interrupted), from the worktree root:

```bash
node -e "const fs=require('node:fs');const m=JSON.parse(fs.readFileSync('../../data/config.json','utf8'));fs.writeFileSync('data/real-config.json',JSON.stringify({dataDir:'data',activeExportId:m.activeExportId,serverFolder:m.serverFolder},null,2),{mode:0o600})"
GTNH_PLANNER_CONFIG=data/real-config.json npm run scan -- --backup "<the newest complete backup zip name>"
GTNH_LOCAL=1 GTNH_PLANNER_CONFIG=data/real-config.json npx vitest run tests/unit/layout/real-enderio.test.ts
```

The scan only reads the backup zip (never the live world or server folder beyond it); pick the newest *complete* zip (the World page lists them; skip one still being written). Expected: PASS with one summary line and the part table. Then start the app on this config and check by eye: the Connections tab draws the real line with readable boxes and coloured links, a click shows a face's full settings, the 3D view shows the item and ender fluid conduit textures and connector arms, and the map marks the conduits in the EnderIO colour. Record anything surprising in `docs/local/` only.

- [ ] **Step 5: Write the README section**

Add "## EnderIO conduits and the Connections view" to `README.md` (user-facing, about 15 lines, no local paths): choose **EnderIO conduits** under Logistics; the line gets an Item Conduit along its middle row and Ender Fluid Conduits from every fluid port, sharing cells as one bundle; every conduit face that touches a machine or chest is set to Extract, Insert or In / Out (Disabled where it must not connect), with its own extract filter and insert filter (Basic, Advanced or Big Item Filter with the exact items, match meta, NBT only when the item has it) and its own extract and insert channel colours, so each machine's outputs reach only the machines that take them — consumers first (priority 1), surplus to the output chest (priority 0), round robin where one face feeds several machines, speed upgrades where a face must move more than 8 items/s; every extract face is set to Always active, because a conduit left at its default waits for a redstone signal; Green is left to your base network, which the line joins at the input chest when the scan found one; power still runs over GT cables; the parts list counts every conduit, filter and upgrade and the build steps set every face; the **Connections** tab draws any line (all four modes) as boxes and links with every face's settings — click a box, a face or a link for the details; limits: rates follow EnderIO's default conduit config (a server that changes `EnderIO.cfg` conduit rates may need more upgrades or a bigger fluid conduit), a face holds at most 24 filtered items (more are flagged), and the line plans no redstone signal control (every extract face is simply set to Always active; ruling R22).

- [ ] **Step 6: Commit**

```bash
git add tests/e2e/world-upload.ts tests/e2e/connections.spec.ts tests/unit/layout/real-enderio.test.ts README.md
git commit -m "test(layout): end-to-end EnderIO line and Connections tab, real-data check; docs: EnderIO and Connections README

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

## Architecture change requests

All are additive; nothing in the architecture is renamed or reshaped. §11.30 already grants the mode, `modes/enderio.ts` and `ConnectionsView.tsx`.

1. **§6.7 `LayoutBlock`** gains optional `conduits?: ConduitSpec[]` and `tail?: TailChest`, with the EnderIO types `ConduitKind`, `ConduitMode`, `DyeColor`, `RedstoneMode`, `ConduitFilter`, `ConduitExtract`, `ConduitInsert`, `ConduitFace`, `ConduitSpec`, `TailChest` in `src/shared/types/layout.ts` (Task 1). No new `BlockRole`: a conduit bundle is a `pipe`; filters and speed upgrades are face settings (counted in `Layout.bom`, group `logistics`), not blocks; facades are not placed.
2. **§7.2 `ProjectTab.id`** gains `'connections'`; `PROJECT_TABS` gets `{ id: 'connections', label: 'Connections', component: ConnectionsView }` right after `3d` (Task 8); the pure graph lives in `src/client/connections/model.ts` (Task 7).
3. **§11.21 reach**: `ReachMode` (`src/shared/world/storage-totals.ts`) gains `'enderio'`; storage on the base's EnderIO network counts as reachable in that mode (Task 1).
4. **§11.17 curated pseudo blocks**: `conduit:liquid_ender`, `conduit:liquid_crystalline`, `conduit:liquid_pink_slime`, `conduit:liquid_melodic`, `conduit:liquid_stellar`, `conduit:connector_extract`, `conduit:connector_insert`, `conduit:connector_in_out` (Task 6).
5. **Plan 5 internals** (not architecture, recorded so Plan 5's owners know): `ModeResult.ownsFluids?` (the mode lays its own fluid network; `buildLocal` then gives internal routing no fluid nets), `ModeHookup.endConduit?`, `stepItemOutputs` (`modes/mode.ts`); `SceneInstance.offset?` with `sceneBlockRefs` and `instanceTranslation` (3D); `NETWORK_NAMES` moves from `pins.ts` to `src/shared/layout/format.ts`; `hookupNetworkKind` in `src/shared/layout/enderio.ts`; the chests of `direct` and `routed` carry `tail`.
