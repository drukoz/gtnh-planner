# Multi-mod import — Phase 1: namespaced machine identity

**Goal:** machine identity in the pack becomes a namespaced string (`MachineId`, `"gt:1001"`, `"mc:furnace"`) instead of
a GregTech MTE id, so a later phase can put a non-GT machine in the pack at all. **No new mod, no new feature, and no
change in behaviour:** the same export gives byte-identical plans, layouts, world reads and HTTP responses before and
after, and every saved project keeps working untouched.

**Design:** `docs/superpowers/specs/2026-10-24-multi-mod-import-design.md` — §5 Layer A is this phase; §3 lists the
couplings; §6 the six phases. **Contracts:** `docs/superpowers/plans/2026-10-17-00-architecture.md` §6.2 (`Pack`,
`Machine`), its "Machine id" row (line 91) and pack conventions (entry 4) change in Task 9 — the architecture doc is
edited there, not before.

**Why ten tasks and not one rename:** `mteId` appears in 68 source files and 60 test files. The order below keeps
`npm test` green at every commit: first the id vocabulary (Task 1), then *additive* accessors over today's numeric maps
(Task 2), then each consumer layer moves to the accessors (Tasks 3–8), and only then does the storage flip (Task 9),
which by that point touches five files. The export format bump is last (Task 10) because nothing before it needs the
format to change.

## Global constraints

1. **Behaviour identical.** Any plan, layout, BOM, build list, world scan, map payload, projector payload and HTTP
   response is the same before and after every task, for the same export and settings. Machine *ordering* included:
   where code today breaks a tie with `a.mteId - b.mteId`, it must break it with `compareMachineId(a.id, b.id)`
   (Task 1), which reproduces that order exactly for GT and pseudo machines. Do not "improve" an order, a name or a
   message while moving it.
2. **No stored-data change.** `PlanSettings.ownedManual`, `declineReuse`, `avoidReuse` and every other persisted field
   keep their numeric `mteId`, and `SETTINGS_VERSION` does not move. Convert at the planner's entry with
   `machineIdOfLegacy`. A project saved before Phase 1 must load after it with no migration.
3. **No wire change.** Every type in `src/shared/types/{api,plan,projector,world}.ts` keeps its `mteId: number`
   fields, so `src/client/**` is untouched in this whole phase. Server code that fills those fields converts with
   `legacyMteId(id)` at the boundary.
4. **`Machine.mteId` stays required** through Phase 1. Making it optional (what a real non-GT machine needs) is Phase 4
   Task 1; it is a small change once everything reads identity through `Machine.id` and the accessors.
5. **Process ids are defined, not renamed.** Task 1 declares `ProcessId` and the implicit-namespace rule, but recipe map
   ids keep their current spelling (`gt.recipe.macerator`, `crafting`, `furnace`, `assemblyline`, `pump`) everywhere:
   in `Pack.maps`, `Recipe.maps`, `PlanStep.mapId`, `map-aliases.ts` and saved projects. Prefixing them buys nothing
   until an adapter contributes a map (Phase 4) and would churn recipe pins.
6. **Every commit:** `npm test` green (it runs `tsc -b` first). Tasks 3–9 also run `npm run e2e` green. Conventional
   commit, ending with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
7. **Nothing game-derived is committed** (architecture §2.2). Tests use the existing synthetic fixtures under
   `tests/helpers/`.
8. **Erasable TypeScript only** (no enums, no parameter properties, no namespaces), and `src/shared/**` imports nothing
   from `node:*`.

## Review focus

1. **A tie between two machines.** The lexicographic order of `"gt:1001"` and `"gt:999"` is the reverse of the numeric
   order of 1001 and 999. Every tie-break must go through `compareMachineId`, or plans silently pick another machine →
   Task 1 `tests/unit/shared/ids.test.ts`, Tasks 3–5 plan parity.
2. **A saved project.** `ownedManual`/`declineReuse` hold numbers; if any of them is compared against a `MachineId`
   string the comparison is always false and reuse quietly stops working → Task 4 and Task 5 acceptance.
3. **The pseudo machines.** Hand (−3), furnace (−2) and crafting table (−1) sort *before* every GT machine today;
   `compareMachineId` must keep the `mc` namespace first and keep hand < furnace < crafting_table.
4. **A structure's `BlockRef.mteId`.** That is a *block's* GT tile id read from a world or a structure, not a machine
   key; it stays a number and is resolved with `machineByMteId` → Tasks 4, 6, 8.
5. **The world scan.** It finds machines by GT's NBT `mID`; it must keep doing exactly that (design §7). It only stops
   calling `pack.machines.get(n)` directly and calls `machineByMteId(pack, n)` instead.

## File map

| File | Tasks | Change |
|---|---|---|
| `src/shared/ids.ts` (new) | 1 | the id vocabulary: types, builders, parsers, `compareMachineId`, legacy bridge |
| `tests/unit/shared/ids.test.ts` (new) | 1 | its unit tests |
| `src/shared/types/pack.ts` | 2, 9 | `Machine.id`; then `Pack.machines`/`machinesByMap` key types |
| `src/server/pack/machines.ts` | 2 | `toMachine` and the pseudo entries fill `id` |
| `src/server/pack/lookup.ts` (new) | 2, 9 | the only way other modules reach machines |
| `src/server/planner/{candidates,machine-options,machines}.ts` | 3 | machine selection on `MachineId` |
| `src/server/planner/{solve,build-mip,build-cost,bom,benches,availability,owned}.ts` | 4 | solver and cost on `MachineId` |
| `src/server/planner/{plan,steps,make-n}.ts` | 5 | plan assembly; converts to `mteId` at the wire |
| `src/server/layout/{layout,arrange,site,parts,pins,hookups,internal,steps,power,feed-rules}.ts` | 6 | layout core |
| `src/server/layout/feeding/*.ts`, `src/server/layout/modes/*.ts` | 7 | feeding checker and logistics modes |
| `src/server/world/*.ts`, `src/server/projector/payload.ts`, `src/server/http/routes/{pack,world,assets}.ts`, `src/server/assets/{gt-faces,resolve}.ts`, `src/server/cli/pack-info.ts` | 8 | GT-only readers move to `machineByMteId` |
| `src/server/pack/{load,indices,supply}.ts`, `src/shared/types/pack.ts`, `src/server/pack/lookup.ts`, architecture doc | 9 | the storage flip |
| `src/server/pack/format.ts`, `src/server/pack/load.ts`, `src/shared/types/pack.ts`, `exporter-mod/**` | 10 | `gtnh-planner-export/2` |
| `src/client/**` | — | untouched in Phase 1 (constraint 3) |

Each task is one commit on its own branch off `main`, reviewed before the next starts.

---

## Task 1: the id vocabulary

**Files:** create `src/shared/ids.ts` and `tests/unit/shared/ids.test.ts`. Nothing else changes.

**Module header** (follow `src/shared/keys.ts`): *Namespaced machine and process ids (architecture §5, §6.1). Pure
TypeScript shared by server and browser: nothing from `node:*` may be imported here.*

**API** — exactly these exports, with these behaviours:

```ts
export type Namespace = string;   // lower case: /^[a-z][a-z0-9_]*$/ — a mod id, or 'mc' for vanilla
export type MachineId = string;   // `${ns}:${local}` — "gt:1001", "mc:furnace", "ic2:macerator"
export type ProcessId = string;   // `${ns}:${local}` — the recipe-map namespace of a later phase

export const GT_NS = 'gt';
export const MC_NS = 'mc';

/** `${ns}:${local}`. Throws RangeError for a namespace that is not /^[a-z][a-z0-9_]*$/ or an empty local part. */
export function makeId(ns: Namespace, local: string): string;
/** The part before the first ':'. Throws Error for a value without one. */
export function nsOf(id: string): Namespace;
/** Everything after the first ':' — a local part may itself contain ':' (a registry name). */
export function localOf(id: string): string;
/** A well-formed `${ns}:${local}`. */
export function isId(v: unknown): v is string;

/** `gt:${mteId}` for a GT MTE id (a non-negative safe integer; RangeError otherwise). */
export function gtMachineId(mteId: number): MachineId;
/** The pseudo machines of recipes no GT machine runs. */
export const MC_MACHINES: { readonly HAND: MachineId; readonly FURNACE: MachineId; readonly CRAFTING_TABLE: MachineId };
//   = { HAND: 'mc:hand', FURNACE: 'mc:furnace', CRAFTING_TABLE: 'mc:crafting_table' }
/** True for a machine with nothing to build or place: namespace 'mc' (what PSEUDO_IDS.has(mteId) answered). */
export function isPseudoMachineId(id: MachineId): boolean;

/** The number the old `mteId` held: `gt:<n>` → n, 'mc:hand' → −3, 'mc:furnace' → −2, 'mc:crafting_table' → −1.
 *  Throws Error for any other id — only GT and the three pseudo machines have a legacy number. */
export function legacyMteId(id: MachineId): number;
/** The inverse, for data saved before Phase 1 and for GT tile ids read from a world. */
export function machineIdOfLegacy(mteId: number): MachineId;

/** The order today's `a.mteId - b.mteId` gave, for any pair of ids:
 *  namespace rank first ('mc' 0, 'gt' 1, anything else 2 then its namespace by `<`), then within
 *  'mc' by `legacyMteId` (hand, furnace, crafting table), within 'gt' by the numeric local part,
 *  and in any other namespace by the local part with `<`. Returns a negative number, 0 or a positive number. */
export function compareMachineId(a: MachineId, b: MachineId): number;
```

**Tests** (`tests/unit/shared/ids.test.ts`), in the style of `tests/unit/shared/tiers.test.ts`:
- `makeId`/`nsOf`/`localOf` round-trip, including a local part with a colon (`makeId('ic2', 'te:macerator')`).
- `makeId` throws for `''`, `'GT'`, `'1ic2'`, `'ic 2'` as namespace and for an empty local part; `nsOf('nope')` throws.
- `gtMachineId(1001) === 'gt:1001'`; `gtMachineId(-1)` and `gtMachineId(1.5)` throw.
- `MC_MACHINES` equals `{ HAND: 'mc:hand', FURNACE: 'mc:furnace', CRAFTING_TABLE: 'mc:crafting_table' }`.
- `legacyMteId` and `machineIdOfLegacy` are inverses over `[-3, -2, -1, 0, 1, 1001, 31091]`; `legacyMteId('ic2:macerator')`
  throws; `machineIdOfLegacy(-4)` throws.
- **The ordering guard:** for the id list of `[-3, -2, -1, 0, 1, 2, 9, 10, 999, 1001, 31091]` mapped through
  `machineIdOfLegacy`, sorting with `compareMachineId` gives the same sequence as sorting the numbers ascending.
  Build it as a shuffled copy sorted both ways and compare. Add `'ic2:macerator'` and `'te:pulverizer'` to show they
  land after every GT id, in that order.

**Verify:** `npx vitest run tests/unit/shared/ids.test.ts`, then `npm test`.

**Acceptance:**
- [ ] `src/shared/ids.ts` exports exactly the API above, with a doc comment per export.
- [ ] No file outside the two new ones changed.
- [ ] `npm test` green.

**Out of scope:** touching `tiers.ts`, `PSEUDO_MACHINES`, `PSEUDO_IDS` or any consumer. They stay until Tasks 3–5.

---

## Task 2: `Machine.id`, and the accessors every other module will use

**Files:** modify `src/shared/types/pack.ts`, `src/server/pack/machines.ts`; create `src/server/pack/lookup.ts` and
`tests/unit/pack/lookup.test.ts`. Additive only — no existing call site changes.

**`Machine.id`** — add as the *first* field of `Machine` (`src/shared/types/pack.ts:92`), keeping `mteId`:

```ts
export interface Machine {
  /** This machine's identity: `gt:<mteId>` for a GT machine, `mc:*` for a pseudo one (ids.ts). */
  id: MachineId;
  mteId: number; metaName: string; /* … unchanged … */
}
```

Fill it in `src/server/pack/machines.ts`: `toMachine` sets `id: gtMachineId(line.id)` beside `mteId: line.id`, and
`pseudoMachine(mteId, …)` sets `id: machineIdOfLegacy(mteId)`. Nothing else in the loader changes — the maps stay
keyed by number in this task.

**`src/server/pack/lookup.ts`** — the single door to the pack's machines. Implement it over today's numeric maps; Task 9
reimplements the bodies without changing a signature:

```ts
/** The machine of an id, or undefined when the pack has none. */
export function machineOf(pack: Pack, id: MachineId): Machine | undefined;
/** The machine of a GT MTE id or a legacy pseudo id, for a world scan, a structure block or saved settings. */
export function machineByMteId(pack: Pack, mteId: number): Machine | undefined;
/** The ids of the machines of a recipe map, in `machinesByMap` order (tier, then `compareMachineId`). */
export function machineIdsForMap(pack: Pack, mapId: string): readonly MachineId[];
/** Those machines themselves, in the same order, skipping an id the pack no longer has. */
export function machinesForMap(pack: Pack, mapId: string): Machine[];
/** Every machine id in `compareMachineId` order. */
export function allMachineIds(pack: Pack): MachineId[];
```

Rules: `machineOf` converts with `legacyMteId` and returns `undefined` (never throws) for an id the pack cannot hold —
including a non-GT, non-`mc` id. `machineIdsForMap` maps the stored `number[]` through `machineIdOfLegacy`. No caching.

**Tests** (`tests/unit/pack/lookup.test.ts`): build a pack with the existing `tests/helpers/mini-gt.ts` fixture and
check that `machineOf(pack, gtMachineId(n))` and `machineByMteId(pack, n)` return the same object; that
`machineOf(pack, 'ic2:macerator')` is `undefined`; that `machineIdsForMap(pack, 'crafting')` holds
`MC_MACHINES.CRAFTING_TABLE`; and that `machineIdsForMap` is in the same order as `pack.machinesByMap` read directly.
Extend `tests/unit/pack/*` where a fixture builds a `Machine` literal and now needs `id`.

**Verify:** `npm test` — every existing test must pass unchanged except for fixtures that construct a `Machine`.

**Acceptance:**
- [ ] `Machine.id` is set for every machine the loader builds, pseudo machines included, and `id`/`mteId` always agree
      (`legacyMteId(m.id) === m.mteId` — assert it once in the test).
- [ ] `lookup.ts` has the six functions above and no other export.
- [ ] No module outside `src/server/pack/` and `tests/` changed.
- [ ] `npm test` green.

**Out of scope:** changing any `pack.machines.get(...)` call site; changing the map key types.

---

## Task 3: machine selection on `MachineId`

**Files:** `src/server/planner/candidates.ts`, `machine-options.ts`, `machines.ts`, and their tests under
`tests/unit/planner/`.

**The move, mechanically:**
1. Every local variable, field and parameter that holds a machine identity becomes `id: MachineId` where the value
   comes from `machineIdsForMap`/`Machine.id`. Rename the field `mteId` to `id` in the planner's own interfaces
   (`MachinePick` in `machines.ts:22`, `MachineOption` in `machine-options.ts:45`, `OwnedClaim`/`OwnedAssignment`
   `machines.ts:539,546`), keeping every other field.
2. `pack.machines.get(x)` → `machineOf(pack, id)`; `pack.machinesByMap.get(map)` → `machineIdsForMap(pack, map)` or
   `machinesForMap(pack, map)`.
3. `PSEUDO_IDS.has(x)` → `isPseudoMachineId(id)`; `PSEUDO_MACHINES.HAND|FURNACE|CRAFTING_TABLE` →
   `MC_MACHINES.HAND|FURNACE|CRAFTING_TABLE`.
4. **Every** `a.mteId - b.mteId` tie-break → `compareMachineId(a.id, b.id)`, and every `a.mteId < b.mteId` →
   `compareMachineId(a.id, b.id) < 0` (`machine-options.ts:188,374,448,465,509,589`, `machines.ts:90,146,727`).
5. Where a function still has to hand a number to a caller this task does not own (`PlanStep.machine.mteId` in
   `machines.ts:509`, `StepTier.mteId` at `:752`, `others[].mteId` at `:854`, `machines.ts:373`), convert at that line
   with `legacyMteId(...)` and leave the consumer alone — Task 5 moves those.
6. Settings that arrive as numbers (`declineReuse`, `ownedManual`) are converted once, where they enter the module,
   with `machineIdOfLegacy`; never compare a number with an id.

**Verify:** `npm test`; then `npm run e2e`.

**Acceptance:**
- [ ] `candidates.ts`, `machine-options.ts` and `machines.ts` contain no `pack.machines`, no `machinesByMap`, no
      `PSEUDO_IDS` and no `mteId` arithmetic; the only `mteId` left is in a `legacyMteId(...)` conversion or a comment.
- [ ] The e2e suite and every planner unit test pass with **no expectation edited** except where a test constructs a
      `MachinePick`/`MachineOption` literal and must now pass `id`.
- [ ] Plan parity: on the e2e Mini-GT fixture, the plan for its reference line is unchanged (the existing e2e
      assertions are the guard; do not add a snapshot).

**Out of scope:** `plan.ts`, `steps.ts`, `make-n.ts`, `solve.ts`, `build-*.ts` — Tasks 4 and 5.

---

## Task 4: the solver, build cost and the BOM

**Files:** `src/server/planner/solve.ts`, `build-mip.ts`, `build-cost.ts`, `bom.ts`, `benches.ts`, `availability.ts`,
`owned.ts`, and their tests.

Same six rules as Task 3, plus:
- `build-cost.ts:301,302,457` and `bom.ts:46` read a **block's** `BlockRef.mteId` from an exported structure. That
  stays a number; resolve it with `machineByMteId(pack, block.mteId)` and compare machines with
  `block.mteId === legacyMteId(m.id)`.
- `owned.ts`'s pools are keyed by machine identity; the key becomes a `MachineId` string, and the pool order uses
  `compareMachineId`. Owned counts coming from `PlanContext.ownedMachines` and `PlanSettings.ownedManual` (both
  numeric) are converted with `machineIdOfLegacy` as they enter.
- `solve.ts:1235`'s comparator chain keeps its earlier terms and ends with `compareMachineId(a.id, b.id)`.

**Verify:** `npm test`; `npm run e2e`.

**Acceptance:**
- [ ] None of the seven files mentions `pack.machines`, `machinesByMap` or `PSEUDO_IDS`.
- [ ] Owned-machine reuse still works for a project whose saved `ownedManual` holds numbers — add one unit case that
      plans with `ownedManual: [{ mteId: <a GT id in the fixture>, count: 2 }]` and expects the step to report
      `reused.count` 2, i.e. the number was matched to the machine.
- [ ] `npm test` and `npm run e2e` green with no expectation loosened.

---

## Task 5: plan assembly and Make N, with the wire boundary

**Files:** `src/server/planner/plan.ts`, `steps.ts`, `make-n.ts`, and their tests.

Same rules again, and this is where the phase's boundary is drawn:
- Everything inside these modules holds `MachineId`.
- Every field of `src/shared/types/plan.ts` and `api.ts` keeps `mteId: number` and is filled with
  `legacyMteId(id)`: `PlanStep.machine.mteId`, `StepTier.mteId`, `reused.others[].mteId`, `NewMachines.mteId`
  (`plan.ts:1524`), the Make N build list and the step panel's lists.
- `plan.ts:1534`'s `steps.find((s) => s.machine.mteId === mteId)` and every other comparison inside the module
  compares ids, not numbers.
- `src/shared/types/plan.ts` and `api.ts` are **not edited** in this task.

**Verify:** `npm test`; `npm run e2e`.

**Acceptance:**
- [ ] `src/shared/types/*` unchanged; `src/client/**` unchanged.
- [ ] Every `mteId` written into a plan or API payload comes from `legacyMteId`, and the whole planner no longer reads
      `pack.machines` directly (`grep -rn "pack.machines" src/server/planner` is empty).
- [ ] `npm test` and `npm run e2e` green, no expectation edited.

---

## Task 6: layout core

**Files:** `src/server/layout/layout.ts`, `arrange.ts`, `site.ts`, `parts.ts`, `pins.ts`, `hookups.ts`, `internal.ts`,
`steps.ts`, `power.ts`, `feed-rules.ts`, and their tests under `tests/unit/layout/`.

Same mechanical rules. Notes:
- The layout reads a step's machine from the plan (`step.machine.mteId`, a number on the wire) — convert once with
  `machineIdOfLegacy` where the step enters the layout, then work in ids.
- Structure blocks keep `BlockRef.mteId` as a number (`machineByMteId`).
- The layout's own output types (`src/shared/types/layout.ts:83` — a placed block is a `BlockRef` plus a role) are
  **not** edited: a placed block is identified by its registry id, meta and GT tile id, which is a block fact, not a
  machine key.

**Verify:** `npm test`; `npm run e2e`.

**Acceptance:**
- [ ] The ten files no longer read `pack.machines`/`machinesByMap`/`PSEUDO_IDS`.
- [ ] `tests/unit/layout/**` passes with no expectation edited (fixture literals may gain `id`).
- [ ] `npm test` and `npm run e2e` green.

---

## Task 7: the feeding checker and the logistics modes

**Files:** `src/server/layout/feeding/{facts,model,precheck,read,read-networks}.ts`,
`src/server/layout/modes/{mode,direct,routed,ae2,enderio,by-hand}.ts`, and their tests.

Same rules. Notes:
- `feeding/read*.ts` reads a **world**: every `mteId` it takes from a scan record stays a number and is resolved with
  `machineByMteId`.
- `modes/*.ts` compares the machine of a step with the machine of a placed block; compare `MachineId` against
  `machineIdOfLegacy(scanRecord.mteId)`, never a number against an id.
- `modes/mode.ts`'s shared interface is the contract for the five modes: change it once, then each mode.

**Verify:** `npm test`; `npm run e2e`.

**Acceptance:**
- [ ] No `pack.machines`/`machinesByMap`/`PSEUDO_IDS` left anywhere under `src/server/layout/`.
- [ ] The feeding-checker tests pass with no expectation edited.
- [ ] `npm test` and `npm run e2e` green.

---

## Task 8: the world reader, projector, assets, HTTP and the CLI

**Files:** `src/server/world/{scan,scan.worker,classify/gt,classify/gtchests,coils,context,facts,power,tiles}.ts`,
`src/server/projector/payload.ts`, `src/server/http/routes/{pack,world,assets}.ts`,
`src/server/assets/{gt-faces,resolve}.ts`, `src/server/cli/pack-info.ts`, and their tests.

These are the **GT-only** readers, and they stay GT-only (design §7): the scan keeps finding machines by GT's NBT
`mID`, the projector keeps sending `mteId`, `gt-faces.ts` keeps keying textures by MTE id. The only change is that
`pack.machines.get(n)` becomes `machineByMteId(pack, n)`, and where such a reader needs a machine's identity for
something that is not the wire (a name, a lookup) it uses `machine.id`.

**Verify:** `npm test`; `npm run e2e`.

**Acceptance:**
- [ ] `grep -rn "pack\.machines\b\|machinesByMap" src/` returns hits only in `src/server/pack/`.
- [ ] The projector payload, `GET /api/pack/...`, `GET /api/world/scans/:id/palette?names=1` and the asset routes
      return byte-identical responses for the fixture pack (the existing route tests are the guard).
- [ ] `npm test` and `npm run e2e` green.

---

## Task 9: the storage flip, and the architecture contract

**Files:** `src/shared/types/pack.ts`, `src/server/pack/{load,indices,supply,lookup}.ts`,
`docs/superpowers/plans/2026-10-17-00-architecture.md`, and the pack tests.

**The flip:**
```ts
// src/shared/types/pack.ts
machines: Map<MachineId, Machine>; machinesByMap: Map<string, MachineId[]>;
/** Only GT machines and the pseudo ones: what a world scan's `mID` and a structure's `BlockRef.mteId` resolve through. */
machineByMteId: Map<number, Machine>;
```
- `load.ts:490-496` keys `pack.machines` by `machine.id` and keeps its duplicate-id warning (now naming the id);
  it fills `machineByMteId` in the same pass. `load.ts:503,548` look up by id.
- `indices.ts:66` `buildMachinesByMap(machines: ReadonlyMap<MachineId, Machine>): Map<string, MachineId[]>`, sorting
  by `(a.tier ?? 0) - (b.tier ?? 0) || compareMachineId(a.id, b.id)` — the same order as today.
- `supply.ts` takes the new map type.
- `lookup.ts`'s six functions keep their signatures and become one-liners; `machineIdsForMap` no longer converts.
- `load.ts:338`'s empty-pack literal gains `machineByMteId: new Map()`.

**Architecture doc edits** (the contract rule of its own §1: the change is made here):
- Line 91 "Machine id" row → *a namespaced `MachineId` string, `` `gt:<mteId>` `` for a GT machine (same number as world
  `mID`, kept in `Machine.mteId` and in every wire and stored field) and `mc:hand` / `mc:furnace` /
  `mc:crafting_table` for the pseudo machines (`src/shared/ids.ts`).*
- Line 165 `Pack` block → the three lines above.
- Line 143 `Machine` block → `id: MachineId;` first.
- Entry 4's sentence about pseudo ids −1 and −2 → the `mc:` ids, and add: *`Pack.machines` is keyed by `MachineId`;
  `Pack.machineByMteId` resolves a GT tile id; plans, the HTTP API and stored projects keep `mteId` numbers.*
- Add a new numbered entry at the end of §11 recording Phase 1: what changed, that behaviour and stored data did not,
  and that `Machine.mteId` becomes optional in Phase 4.

**Verify:** `npm test`; `npm run e2e`; and load a real export if one is at hand (`npm run pack:info`) to see the same
summary as before.

**Acceptance:**
- [ ] `Pack.machines` is keyed by `MachineId`, `machinesByMap` holds `MachineId[]`, `machineByMteId` exists and holds
      exactly the machines with a legacy number.
- [ ] `lookup.ts`'s signatures are unchanged from Task 2, so no consumer is edited in this task.
- [ ] The architecture doc states the new contract in the five places above.
- [ ] `npm test` and `npm run e2e` green; `pack:info` output unchanged.

---

## Task 10: `gtnh-planner-export/2`

**Files:** `src/server/pack/format.ts`, `src/server/pack/load.ts`, `src/shared/types/pack.ts`,
`exporter-mod/src/main/java/io/github/drukoz/gtnhplanner/export/Manifest.java` (and `Exporter.java` only if it holds
the format string), and the pack tests.

**Format changes — additive only:**
1. `EXPORT_FORMAT = 'gtnh-planner-export/2'`.
2. `ManifestFile` gains `mcVersion: string` (e.g. `"1.7.10"`) and `loader: string` (e.g. `"forge-10.13.4.1614"`), so a
   later pack on another Minecraft version is recognisable rather than silently mis-read (the user's answer of
   2026-10-24: keep newer versions in mind; a 1.12/1.20 exporter is still out of scope).
3. `MachineLine` gains an optional `ns?: string` — the namespace of a machine a future adapter contributes. When it is
   absent the loader reads the machine as GT, exactly as today.
4. **The loader reads both versions.** `load.ts:125` accepts `gtnh-planner-export/1` and `/2`. For `/1` it synthesises
   `mcVersion: '1.7.10'` and `loader: 'unknown'` and treats every machine line as GT. `PackManifest.format` becomes
   `'gtnh-planner-export/1' | 'gtnh-planner-export/2'` and gains the two optional fields. **An export already on disk
   must keep loading** — re-exporting a pack costs the user hours.
5. The Java side writes the two manifest fields from Forge's own values and bumps the format string. No new section, no
   `ns` written (nothing but GT contributes machines yet).

**Tests:** one case that a `/1` manifest fixture still loads and reports `mcVersion: '1.7.10'`; one that a `/2`
manifest with `ns: 'ic2'` on a machine line loads that machine with id `ic2:<name>`; one that an unknown format
(`/3`) is still rejected with the existing error.

**Verify:** `npm test`; `npm run e2e`; and, if a Java toolchain is available, `cd exporter-mod && ./gradlew build`.
If it is not, say so in the report rather than skipping silently.

**Acceptance:**
- [ ] A `/1` export loads unchanged, with a synthesised `mcVersion`/`loader`.
- [ ] A `/2` export loads, including a machine line with `ns`.
- [ ] An unknown format is rejected with the existing message.
- [ ] `npm test` and `npm run e2e` green.

**Out of scope:** writing an adapter, writing `ns` from Java, any non-GT section, any second exporter for a newer
Minecraft version.

---

## After Phase 1

Phase 2 moves GT's curated machine rules into `machine-profiles/gt.json` with the precedence *exported facts → profile
→ curated rows* (design §5 Layer C), and reports per-pack coverage from the manifest's own `mods` map — with the user's
answer of 2026-10-24 ("all mods, but really focus on mod packs"), the pack's mod list is what the planner measures
itself against: *your pack has N mods; the planner has rules for these, recipes for those, nothing for the rest.*
Phase 3 makes rates optional, which is the gate for every recipes-only mod. Only then does an adapter land.
