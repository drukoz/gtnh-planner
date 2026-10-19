# Planner Quality Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the planner return plans a GTNH group would build: nothing taken from solver tolerance, one process per product unless a second one pays, gathered blocks imported instead of crafted from free cobblestone, generators for free inputs, a supporting line behind every complex material, a step charge against marginal chains, and a flow diagram that shows where every item comes from.

**Architecture:** Server: the rate solver works at unit demand with a residual check and a step-charge MIP stage (root node, warm-started from the least-raw solution); the leaf oracle gains gathered world blocks, reach-only fluids, material-line-only ores, shallow-only derived imports and loader-derived supply recipes (rock breaker, pump, compressed air); post-processing adds integrity warnings from a shared `indexPlan`, ingredient-option explanations and supporting-line tags. Client: one shared number formatter, integrity notes, item ports and focus mode in the flow diagram, and panels for options, supply, lines and imports.

**Tech Stack:** Node 24 (type stripping) · TypeScript 6.0.3 · highs 1.15.3 · React 19.3.0 · elkjs 0.12.0 · vitest 5.0.3 · @playwright/test 1.63.0 (no new dependency).

**Spec:** `docs/superpowers/specs/2026-10-19-planner-quality-fix.md` (committed in Task 1 Step 1 from `docs/local/planner-audit/fix-spec.md`; this plan cites it as "spec": §-numbers are its sections, D-numbers its defects, R-numbers its rules). Contracts: `docs/superpowers/plans/2026-10-17-00-architecture.md` §11.25–§11.30 (on main) and §11.31–§11.37 (added in Task 1). Background: `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` §3.3, §3.9, §3.10; `docs/research/prior-art.md` §3.4; `docs/research/materials-availability.md` §8.

`audit/` below means `docs/local/planner-audit/` (a gitignored folder holding the audit reports and patches; ask the controller if it is missing).

## Global Constraints

- Build on main at `46067df` or later (plan 08 "materials to avoid" and the world scan are merged). The spec's line numbers are from `cd6fcce`; find code by function name. The audit patches `docs/local/planner-audit/patches/{A-numerics,C-sand,D-molten,E-containers,F-source-text,G-bom-containers}.patch` apply cleanly to `46067df` (`git apply --check`); where a step names one, apply it with `git apply --3way` and edit from there.
- Node `>=24.10.0 <25`; scripts `npm run typecheck` (`tsc -b`), `npx vitest run <files>`, `npm run e2e` (`vite build && playwright test`); real-data tests need `GTNH_LOCAL=1`.
- TypeScript erasable syntax only (no `enum`, `namespace`, parameter properties, decorators); relative imports name the real `.ts`/`.tsx` file; type-only imports use `import type`.
- No new npm dependency. `src/shared/` stays pure: no `node:*`, no DOM.
- Rates are per second inside the server; people read them through `src/shared/format.ts` (Task 1). Items in items, fluids in litres.
- Every new field of `PlanSettings`, `Plan`, `PlanStep`, `RawInput`, `BomLine`, `PlanWarning`, `LpModel`, `LpRecipe`, `StepLine` is an optional addition (comment `// optional addition`); `defaultSettings()` and `normalizeSettings()` fill every new setting, and every new setting gets a `SETTING_CHECKS` entry in `src/shared/project/apply-op.ts`.
- Constants exactly as spec §3: `DEFAULT_STEP_CHARGE = 0.05`, `MAX_STEP_CHARGE = 0.5`, `STEP_CHARGE_CAP = 0.25`, `HAND_STEP_WEIGHT = 3`, `STEP_BIG_M = 100`, `STEP_MIP_MAX_NODES = 1`, `CANON_RANK_S3 = 1e-6`, `CANON_RANK_S4 = 1e-3`, `SIGNIFICANT_DIGITS = 9`, `RESIDUAL_REL = 1e-6`, `RESIDUAL_ABS = 1e-9`, `FLOW_DROP_REL = 1e-9`, `DERIVED_LEAF_MAX_DEPTH = 4`, `MAX_EXTRA_PRODUCER_STEPS = 6`, `ORPHAN_REL = 1e-6`, `SHORT_INPUT_SHARE = 0.995`, `PIN_DOMINATED_SHARE = 1.01`; pump recipe 1,000 L / 80 ticks / 8 EU/t; `routeDerived` default `true`; `stepCharge` default `0.05`, `haveSupply` default `[]`, `optionChoice` default `{}`.
- Determinism: the same pack, settings and context give the same plan. MIPs use node limits, never time limits.
- Performance: every real-data plan < 5 s with a warm pack (`PLAN_SECONDS`).
- Nothing game-derived or private is committed; real-data tests run only with `GTNH_LOCAL=1`. Never write `data/config.json`, `data/export` or `data/assets` (symlinks to the real data), and never start, stop or write to the live Minecraft server or its folder.
- Plan 08 (architecture §11.25): keep its avoid handling, `Plan.avoided` and the `avoid-unavoidable` warning working; Task 4 changes only how often `avoidingLine` solves fully.
- `tests/unit/planner/real-acceptance.test.ts` and `real-pack.test.ts` pin old behaviour (cobblestone glass, `ORDINARY`); with `GTNH_LOCAL=1` they may fail from Task 2 until Task 8 rewrites them. Do not edit them before Task 8.
- Commits use a conventional prefix and end with the line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Review Focus

1. **A project stored before this plan** (no `stepCharge`, `haveSupply`, `optionChoice`; stored `routeDerived: false`) opens, plans with the new defaults, keeps its `routeDerived` and shows "Balanced (5%)": Task 4 and Task 5 `apply-op.test.ts` "fills the new settings of an old project", Task 6 `settings.test.tsx` "shows Balanced for a project without stepCharge".
2. **A re-export removed a pinned option or recipe**: the plan still comes out `ok` with a `stale-option` (or the existing `stale-choice`) warning: Task 5 `options.test.ts` "ignores a stale option pin with a warning".
3. **No supply machine at the tier, or Make N**: free inputs are bought free, with no supply step and no error: Task 3 `supply.test.ts` "buys cobblestone free at ULV" and "plans no supply step in Make N".
4. **A line that runs on free inputs only** (Nitrogen from air): the loop guard keeps the supply recipes and the plan is `ok`: Task 3 `supply.test.ts` "plans nitrogen from air with nothing bought".
5. **An avoid list (plan 08) with the step charge**: avoided goods stay out or are flagged as before, and a plan with an avoid list costs one full solve, so it stays < 5 s: Task 4 `avoid.test.ts` "plans the plain line when it uses nothing avoided" and Task 8's plan-08 tests in `real-acceptance.test.ts` (5 s each).

---

### Task 1: Numerics, integrity warnings and main outputs

**Files:**
- Create: `docs/superpowers/specs/2026-10-19-planner-quality-fix.md` (copy of `docs/local/planner-audit/fix-spec.md`), `docs/superpowers/plans/2026-10-19-09-planner-quality.md` (this plan)
- Modify: `docs/superpowers/plans/2026-10-17-00-architecture.md` (append §11.31–§11.37 after §11.30, spec §8), `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` (spec §8 amendments)
- Create: `src/server/planner/round.ts`, `src/shared/format.ts`, `src/shared/plan/balance.ts`
- Modify: `src/server/planner/solve.ts`, `src/server/planner/machines.ts`, `src/server/planner/make-n.ts`, `src/server/planner/plan.ts`, `src/shared/types/plan.ts`, `tests/helpers/pack-spec.ts` (`PackSpec.fluidContainers?`)
- Copy, then edit: `audit/wt/tests/helpers/plan-invariants.ts` → `tests/helpers/plan-invariants.ts`; `audit/wt/tests/unit/planner/plan-invariants.test.ts` → `tests/unit/planner/plan-invariants.test.ts` (the copies pass on `46067df` before the edits of Step 2)
- Test: create `tests/unit/planner/numerics.test.ts`, `tests/unit/shared/balance.test.ts`, `tests/unit/shared/format.test.ts`, `tests/unit/planner/real-rate.test.ts` (from `docs/local/planner-audit/patches/A-numerics.patch`); modify `tests/unit/planner/machines.test.ts`, `tests/unit/planner/plan.test.ts`

**Interfaces:**
- Consumes: existing `CandidateGraph`, `LpRow { lower; upper; entries }`, `solveLp`, `Solution`, `StepLine`, `Plan`, `PlanStep`.
- Produces:
  - `round.ts`: `SIGNIFICANT_DIGITS = 9`, `sig9(x: number): number` (−0 → 0, non-finite → 0).
  - `solve.ts`: `Solution.leastRawCost: number` (S1's objective, scaled back); `RESIDUAL_REL`, `RESIDUAL_ABS`; `residualViolations(rows: readonly LpRow[], x: readonly number[]): Array<{ row: number; residual: number; scale: number }>`; `firstBalanced<T extends { x: readonly number[] }>(stages: readonly T[], rows: readonly LpRow[]): T | null`. `solveLine(graph, demand)` keeps its signature (Task 4 adds options).
  - `machines.ts`: `FLOW_DROP_REL`; `StepLine.valueOf?: (key: StuffKey) => number` and `StepLine.empties?: ReadonlySet<StuffKey>`; `stepLine(graph: CandidateGraph, runs: ReadonlyMap<string, number>, value?: Pick<StepLine, 'valueOf' | 'empties'>): StepLine`; `emptyContainers(pack: Pack): ReadonlySet<StuffKey>` (every `empty` of `pack.fluidContainers`, cached per pack); `planSteps` and `makeN` options gain `value?: Pick<StepLine, 'valueOf' | 'empties'>`.
  - `src/shared/format.ts`: `formatNumber(x: number): string`, `formatDuration(seconds: number): string`, `formatRate(perSecond: number, per: 'min' | 'hour', opts?: { fluid?: boolean; noun?: [string, string] }): string`, `formatPercent(f: number): string` (spec §6.1).
  - `src/shared/plan/balance.ts`: `ORPHAN_REL`, `SHORT_INPUT_SHARE`, `PlanIssueCode`, `PlanIssue`, `PortSide`, `PlanIndex`, `indexPlan(plan: Plan): PlanIndex`, `issueText(issue: PlanIssue, plan: Plan): string` (spec R11, §6.4).
  - `src/shared/types/plan.ts`: `PlanWarning.stepIds?: string[]`, `PlanWarning.share?: number[]`, `Plan.target?: StuffKey`, `Plan.targetPerSecond?: number`, `Plan.rawCost?: { perSecond: number; leastPerSecond: number }`.
  - `tests/helpers/pack-spec.ts`: `PackSpec.fluidContainers?: Pack['fluidContainers']` (copied into the pack).
  - `tests/helpers/plan-invariants.ts`: `checkPlanInvariants(pack, settings, plan, opts?)`, `checkPlanInvariantsDeep(pack, settings, plan, opts?: DeepOptions & { stepCharge?: number })`.

- [ ] **Step 1: Commit the spec, this plan and the contracts**

Copy the spec and this plan into `docs/superpowers/`. Append spec §8's entries 31–37 to architecture §11 after entry 30, leaving 26–30 as they are (if another plan took 31 or later meanwhile, renumber consecutively and fix the cross-references in both copies). Apply spec §8's design-spec amendments. Then:

```bash
git add docs/superpowers
git commit -m "docs: plan 09 planner quality — spec, plan and architecture §11.31–§11.37

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 2: Write the failing tests**

`tests/unit/planner/numerics.test.ts` (Mini-GT, `{ ...defaultSettings(), target: 't:circuit@0', tier: 2, per: 'hour' }`):
- `it('plans 1e-6 per hour like 1 and 30 per hour')`: at `amount` 30, 1 and 1e-6 each plan has `status 'ok'`, `steps.map((s) => s.id)` equal to `['circuit-mv', 'extract-iron', 'wire']`, 6 flows with exactly one `to: 'out'`, and every `runsPerSecond` of the 1e-6 plan equals the 1-per-hour plan's × 1e-6 within 1e-9 relative. (On `46067df` the 1e-6 plan has no steps.)
- `it('keeps 9 significant digits everywhere')`: for the three plans every `steps[].runsPerSecond`, `flows[].perSecond`, `rawInputs[].perSecond`, `rawInputs[].cost` and `byproducts[].amount` value `v` satisfies `Number(v.toPrecision(9)) === v`.
- `it('closes the balance of every good')`: per good, `made + bought − taken − sunk − demand` is within 1e-9 × the largest of those terms.
- `it('finds rows a stage does not balance')`: `residualViolations([{ lower: 1, upper: 1, entries: [[0, 1]] }], [1.001])` has one entry with `row 0` and `residual` ≈ 0.001; `[1 + 1e-12]` has none; with `rows` that row, `firstBalanced([{ name: 'S4', x: [1.001] }, { name: 'S2', x: [1] }], rows)?.name === 'S2'`, and `null` when every stage fails.

`tests/unit/shared/format.test.ts`: the equalities of spec §7.1 exactly (`formatRate(0.5 / 3600, 'hour') === '0.5/h'` … `formatPercent(0.999) === '99.9%'`, `formatPercent(0.9996) === '>99.9%'`, `formatPercent(1) === '100%'`, `formatNumber(13_050_000) === '13,050,000'`), and `it('never prints a positive amount as 0')`: for `v` in [1e-12, 3e-9, 2.2e-8, 1e-6, 0.004] and both units, `Number.parseFloat(formatRate(v, per).replaceAll(',', ''))` > 0.

`tests/unit/shared/balance.test.ts` (a synthetic `Plan`, keys `t:…`, `names` filled, no game data):
- a mixer (machine `Mixer`, `mainOutput 't:glue@0'`) whose `fluid:pva` input (0.223 L/h needed) has no flow → issue `{ code: 'orphan-input', key: 'fluid:pva', stepId: 'mixer' }`, and its `issueText` is `'Nothing supplies PVA to Mixer (Glue): it needs 0.223 L/h and the plan neither makes nor buys it.'`;
- a plate made by `solid` (99.9 %) and `saw` (0.1 %), both with the plate as `mainOutput` → `multi-producer` with `stepIds: ['solid', 'saw']`, `share` ≈ `[0.999, 0.001]`, text `'Iron Plate is made 2 ways: Fluid Solidifier (99.9%) and Cutting Saw (0.1%).'`;
- glue supplied at 99.2 % of need → `short-input`, text `'Assembler (Circuit) gets only 99% of the Glue it needs.'`; at 99.6 % → no issue;
- an Empty Cell two steps make, neither as `mainOutput` → no issue;
- a `raw` flow of a good some step has as `mainOutput` → `bought-and-made`;
- the peers of a port and `producers.get(key)` are largest first; `issues` are sorted by code, then key, then stepId.

`tests/unit/planner/machines.test.ts` additions (the file's `planned()` helper; `PackSpec.fluidContainers` for the cell):
- `it('names the most valuable output the line uses as the main output')`: a recipe making 1,000 L `fluid:water` and 1 `t:charcoal@0`, both taken by other steps, with `value.valueOf` 0.001 per litre and 1 per charcoal → `mainOutput 't:charcoal@0'`.
- `it('never names a container it hands back')`: a recipe making `t:product@0` and returning `t:empty_cell@0` (the `empty` of a `fluidContainers` entry) → `mainOutput 't:product@0'`; a recipe making only the target → the target.

`tests/unit/planner/plan.test.ts`: line 281 expects `0.0166666667`; new `it('names the target and the raw-cost trade-off')`: Mini-GT circuits at MV, 30/min → `plan.target === 't:circuit@0'`, `plan.targetPerSecond === 0.5`, `plan.rawCost.leastPerSecond ≤ plan.rawCost.perSecond`; in Make N `target` is set and `targetPerSecond` and `rawCost` are absent.

`tests/helpers/plan-invariants.ts` (copied) edits: replace the absolute `ROUND_QUANTUM` allowance by `1e-8 × |term|` per term; read the derived-source round trip from `RawInput.sources`, not `basis.avail.why`; count `PlanStep.supply` outputs as free in `freeDetours`; in `checkPlanInvariantsDeep`, with `opts.stepCharge > 0` accept `planCost ≤ optimum × (1 + 0.25)` plus rounding, still an `error` below `optimum × (1 − 1e-6)`. `tests/unit/planner/plan-invariants.test.ts` passes unchanged.

`tests/unit/planner/real-rate.test.ts`: as in `docs/local/planner-audit/patches/A-numerics.patch`, importing `src/` directly (no `PLANNER_SRC` switch).

- [ ] **Step 3: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/planner/numerics.test.ts tests/unit/shared/balance.test.ts tests/unit/shared/format.test.ts tests/unit/planner/machines.test.ts tests/unit/planner/plan.test.ts && GTNH_LOCAL=1 npx vitest run tests/unit/planner/real-rate.test.ts`
Expected: FAIL — `round.ts`, `format.ts`, `balance.ts` missing; the 1e-6/h plan has no steps; `plan.target` undefined; `mainOutput` is water; real-rate lists the orphans `fluid:polyvinylacetate` and `gregtech:gt.metaitem.01@30681`.

- [ ] **Step 4: Implement spec D1, D2 (the warning), D3, D13, R11 and §6.1**

- `round.ts`: `sig9`.
- `solve.ts`: `solveLine` divides the demand by its largest entry, runs the existing stages at unit demand and scales `runs`, `buys`, `sinks`, `rawCost`, `leastRawCost` back through `sig9` (audit patch A1 is the reference); `kept()` drops values ≤ `TINY` and rounds with `sig9`; `finish()` keeps each stage's `x` (S4, S2, simplified base, S1) and uses `firstBalanced` over `lp.rows`, adding `PlanWarning { code: 'numerics', key, text: 'The solver could not balance <name> exactly; the plan uses an earlier stage' }` when that is not S4 (none passing: keep S4 and name the worst good); `simplest()` adds `{ code: 'simplify-skipped', text: 'Could not simplify this plan; it may use more machines than it needs' }` when it returns no simplification; `standaloneCosts` rounds `free` with `sig9`.
- `machines.ts`: `buildFlows` drops a flow when `perSecond ≤ FLOW_DROP_REL × produced` and adds the `out` flow when `out > FLOW_DROP_REL × made`, values through `sig9`; `mainOutputOf` per spec D13 using `StepLine.valueOf` and `StepLine.empties` (without `valueOf`, today's rule).
- `plan.ts`: `planLine` adds `value: { valueOf: (key) => { const c = model.costs.cost(key); return Number.isFinite(c) ? c : 0; }, empties: emptyContainers(pack) }` to the `opts` it passes to `planSteps` and `makeN`; `rawInputsOf`/`byproductsOf` via `sig9`; `Plan.target`, `targetPerSecond` (rate mode: `amount / SECONDS_PER[per]`) and `rawCost` (`sol.rawCost`, `sol.leastRawCost`; rate mode only); in `assemble`, after `plan.names`, one `PlanWarning` per `indexPlan(plan).issues` entry with `text: issueText(issue, plan)`.
- `balance.ts`: per spec R11; `need` = Σ `step.inputs[key].amount × runsPerSecond` per key, `got` = the flows into the step of that key.
- `format.ts`: per spec §6.1.

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run && GTNH_LOCAL=1 npx vitest run tests/unit/planner/real-rate.test.ts`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add src tests
git commit -m "fix(planner): solve at unit demand, keep 9 significant digits, flag inputs nothing supplies

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Leaf rules and import provenance

**Files:**
- Modify: `src/server/planner/availability.ts`, `src/server/planner/costs.ts`, `src/server/planner/pricing.ts`, `src/server/planner/solve.ts` (`Standalone`), `src/server/planner/plan.ts`, `src/shared/types/plan.ts`, `src/shared/project/apply-op.ts`
- Test: create `tests/unit/planner/leaves.test.ts`; modify `tests/unit/shared/apply-op.test.ts` (line 57: `routeDerived: true`) and the existing tests that rely on bought derived materials under default settings: `tests/unit/planner/plan.test.ts`, `avoid.test.ts`, `costs.test.ts`, `availability.test.ts`, `candidates.test.ts`, `solve.test.ts`, `bom-steps.test.ts`

**Interfaces:**
- Consumes: Task 1's `sig9`.
- Produces:
  - `availability.ts`: `GATHERED_BLOCKS: Readonly<Record<StuffKey, string>>` (spec R1, verbatim); `Availability.depth(key: StuffKey): number` (spec R6).
  - `costs.ts`: `DERIVED_LEAF_MAX_DEPTH = 4`, `ORE_LINE_PREFIXES = ['dust', 'ingot', 'gem', 'nugget', 'crushed', 'ore', 'rawOre']`; `makeLeafOracle` applies R5, R6 (depth) and R8.
  - `solve.ts`: `interface Standalone { cost: number; steps: number; free: number; recipes: string[]; top?: string }`.
  - `RawInput.pricedVia?: { recipeId: string; mapId: string; inputs: StuffKey[]; steps: number }`, `RawInput.canMake?: boolean`.
  - `defaultSettings().routeDerived === true`.

- [ ] **Step 1: Write the failing tests** (`tests/unit/planner/leaves.test.ts`, inline `packFromSpec` fixtures with LV–HV machines as needed)

- `it('imports sand and makes molten glass from it')`: items `minecraft:sand@0` (oreDict `sand`), `minecraft:cobblestone@0`, `minecraft:gravel@0`, `t:glass_tube@0`; recipes `gravel-hand` (crafting, cobblestone → gravel), `sand-hammer` (`gt.recipe.hammer`, gravel → sand, 16 EU/t), `extract-glass` (`gt.recipe.fluidextractor`, sand → 144 L `fluid:molten.glass`, 48 EU/t, 200 t), `solidify-tube` (`gt.recipe.fluidsolidifier`, 144 L → tube, 8 EU/t); target the tube at MV, 1/min → steps `['extract-glass', 'solidify-tube']`, raw inputs `[['minecraft:sand@0', 'natural']]` (key, leafClass), no cobblestone in any flow.
- `it('gathers End stone only where the End is reachable')`: worldgen with `theend` (`defaultTier: 3`) → `planBasis(...).avail.classOf('minecraft:end_stone@0')` is `'natural'` at HV and not at MV.
- `it('makes a fluid whose only source is out of reach')`: `fluid:ethylene` sourced only on `triton` (`defaultTier: 9`), made by `make-ethylene` (chemical reactor from mined `t:sugar@0`), taken by the target's recipe → with `routeDerived` false and true: no raw input `fluid:ethylene`, step `make-ethylene` present; with an overworld source at `minTier: 0` instead it is a `direct` raw input.
- `it('buys ore blocks only for a material line')`: items `t:cu_ore@0` (gt `ore` Copper), `t:cu_dust@0` (gt `dust` Copper), `t:s_dust@0` (gt `dust` Sulfur, mined), fluid `fluid:acid`; recipes `leach` (ore → 1,000 L acid + 2 copper dust), `burn` (sulfur dust → 500 L acid), `widget` (1,000 L acid → `t:widget@0`), `mace-cu` (ore → 2 copper dust) → target widget: raw inputs `['t:s_dust@0']`; target `t:cu_dust@0`: raw input `t:cu_ore@0` and step `mace-cu`.
- `it('buys only shallow derived materials when supporting lines are off')`: mined `t:d0@0`; mixers `mix-1` … `mix-5` make `t:d1@0` … `t:d5@0` (gt `dust` of materials M1 … M5), each from the one before; `use-u` makes `t:u@0` from d1 and `use-t` makes `t:t@0` from d5 → with `routeDerived: false` plan u buys `t:d1@0` (`derived`) and plan t runs `mix-1` … `mix-5`; with default settings plan u runs `mix-1`.
- `it('never prices a derived leaf below its plain price and names the chain behind it')`: `smelt2` makes 2 `t:cheap@0` (gt `ingot` Cheap) from 1 mined `t:m@0`; the target takes 1 cheap; `routeDerived: false` → the raw input's `cost / perSecond === 1`, `pricedVia` equals `{ recipeId: 'smelt2', mapId: <its map>, inputs: ['t:m@0'], steps: 1 }`, and its source `detail` reads `made by <map name> from <m name> (1 recipe in all)`.
- `it('describes a stopped fluid by its chemistry, not a canner')`: `stopItems: ['fluid:ethylene']` where availability first reached ethylene by a canner emptying an Ethylene Cell made by a dehydrator → the source detail names the dehydrator's map.
- `it('says whether the group can make an import')`: Mini-GT circuits at LV → raw input `t:copper_ingot@0` has `canMake: false` (its only recipe, `lava-copper`, needs an MV centrifuge) and `t:iron_ingot@0` has `canMake: true`.
- `apply-op.test.ts`: `defaultSettings().routeDerived === true` (line 57).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/planner/leaves.test.ts tests/unit/shared/apply-op.test.ts`
Expected: FAIL — the glass plan builds gravel and sand from cobblestone, ethylene is bought, the ore is bought for the widget, d5 is bought, cheap costs 0.5, `pricedVia`/`canMake` are undefined, the default `routeDerived` is false.

- [ ] **Step 3: Implement spec R1, R5, R6 (default and depth), R7, R8**

- `availability.ts`: `GATHERED_BLOCKS` seeds the fixpoint when its dimension is in `env.reachable`; `classOf` → `'natural'`; `sources` → `[{ kind: 'natural', dims: [dim], detail: 'gathered (dig it)' }]`; `depth` per R6, memoized on the state; `derivedSource` skips container round trips (`docs/local/planner-audit/patches/F-source-text.patch`); `isBaseItem`'s doc per R5.
- `costs.ts`: case `'derived'`: a fluid → NOT_A_LEAF; `settings.routeDerived` or `avail.depth(key) > DERIVED_LEAF_MAX_DEPTH` → NOT_A_LEAF; cases `'direct' | 'byproduct'`: R8 (the ore-part set cached per pack in a `WeakMap`).
- `pricing.ts`: in-model results floored at `prices.price(key)` (R7).
- `solve.ts` `standaloneCosts`: `recipes` (step recipes with runs > `TINY`, largest runs first) and `top` (R7, container moves skipped).
- `plan.ts`: `pricedVia` and `canMake` per R7; a derived leaf's source detail from `pricedVia`; the `derived-leaf` warning names every derived leaf and ends "Plan them as supporting lines to include their chains."
- `apply-op.ts`: `routeDerived: true`.
- Existing tests that expect bought derived materials (`'derived'` raw inputs, `derived-leaf` warnings, `madeFrom`) under default settings set `routeDerived: false`: in `plan.test.ts` and `avoid.test.ts` the `S` helper becomes `({ ...defaultSettings(), routeDerived: false, ...p })`; elsewhere per test. Change an expected value only where R5, R6's depth or R8 changes the plan, and say so in that test's name.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(planner): gathered world blocks, fluids only where reachable, shallow derived imports with their chain

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Free-input supply steps

**Files:**
- Create: `src/server/pack/supply.ts`, `tests/unit/pack/supply.test.ts`, `tests/unit/planner/supply.test.ts`
- Modify: `src/server/pack/load.ts` (`deriveSupply` in `addDerivedRecipes`, before `setIndices`: recipes, the `pump` map, machine maps), `tests/helpers/pack-spec.ts` (`packFromSpec` runs `deriveSupply` the same way), `src/server/planner/basis.ts`, `src/server/planner/costs.ts`, `src/server/planner/candidates.ts`, `src/server/planner/solve.ts`, `src/server/planner/machines.ts`, `src/server/planner/steps.ts`, `src/server/planner/bom.ts`, `src/shared/types/plan.ts`, `src/shared/types/pack.ts` (doc of `Recipe.meta.supply`), `src/shared/project/apply-op.ts`
- Test: also `tests/unit/planner/bom-steps.test.ts`, `tests/unit/shared/apply-op.test.ts`

**Interfaces:**
- Consumes: Task 2's leaf oracle; `PackSpec.fluidContainers` (Task 1).
- Produces: `SUPPLY_PUMP_MAP = 'pump'`, `type SupplyKind = 'rock-breaker' | 'pump' | 'compressor'`, `deriveSupply(input: { recipes: readonly Recipe[]; machines: ReadonlyMap<number, Machine>; maps: ReadonlyMap<string, RecipeMapInfo>; fluidContainers: NonNullable<Pack['fluidContainers']> }): { recipes: Recipe[]; pumpMap: RecipeMapInfo | null; pumpMachines: number[]; flagged: string[] }` (spec R2); `PlanBasis.supplied: ReadonlySet<StuffKey>`; `makeLeafOracle(pack, settings, avail, prices, stopCost?, derivedCost?, opts?: { supplied?: ReadonlySet<StuffKey> })`; `LpRecipe.supply?: true`; `PlanStep.supply?: StuffKey`; `PlanSettings.haveSupply?: StuffKey[]` (default `[]`).

- [ ] **Step 1: Write the failing tests**

`tests/unit/pack/supply.test.ts` (`deriveSupply` on hand-built inputs):
- `it('turns the display-only rock breaker recipes into real ones')`: a `flags.fake` recipe of map `gt.recipe.rockbreaker` whose only consumed input is `gregtech:gt.metaitem.02@32765#abcdefabcdef` → one derived recipe with no inputs, output cobblestone, 30 EU/t, 16 t, `meta.supply === 'rock-breaker'`, no `flags.fake`; a fake recipe consuming redstone (obsidian) yields nothing; ids are equal across two calls.
- `it('adds the pump map, pump machines and water and lava recipes')`: a machine with `cls 'gregtech.common.tileentities.machines.basic.MTEPump'` → `pumpMap.id === 'pump'`, `pumpMachines` contains it, two recipes (1,000 L water, 1,000 L lava; 8 EU/t; 80 t; `meta.supply 'pump'`); without an `MTEPump` machine `pumpMap === null` and no pump recipes.
- `it('flags the compressor that fills an empty cell with air')`: an Empty Cell → Compressed Air Cell recipe with a `fluidContainers` entry for air → its id is in `flagged`; the canner that empties the cell is not.

`tests/unit/planner/supply.test.ts` — fixture `packFromSpec({ ...MINI_GT, … })` adding: map `gt.recipe.rockbreaker` with machine 441 `Basic Rock Breaker` (tier 1); machine 1140 `Basic Pump` (tier 1, cls `…MTEPump`); maps `gt.recipe.compressor`, `gt.recipe.canner`, `gt.recipe.chemicalbath` with LV machines; the fake rock-breaker recipe; `mace-cobble` (macerator, cobblestone → `t:stone_dust@0`); `wash` (chemical bath, `t:iron_dust@0` + 1,000 L water → `t:washed@0`, 8 EU/t, 20 t); `make-cell` (tin ingot → Empty Cell); `compress-air` (Empty Cell → Air Cell); `release-air` (canner, Air Cell → Empty Cell + 2,000 L `fluid:air`); `air-n2` (centrifuge, 1,000 L air → 390 L `fluid:nitrogen`); `gravel-hand` (crafting, cobblestone → gravel); a `fluidContainers` entry for the Air Cell:
- `it('adds a rock breaker sized to the rate')`: stone dust 150/min at LV → a step with `supply: 'minecraft:cobblestone@0'` and `count: 2` (1.25/s per LV rock breaker), and build step `configure:<that step id>` reading `Place water and lava next to the Basic Rock Breaker that makes Cobblestone`.
- `it('skips the generator when the group has a supply')`: the same with `haveSupply: ['minecraft:cobblestone@0']` → no supply step; cobblestone is a raw input with `leafClass 'free'`.
- `it('pumps water')`: washed 60/min at LV → a step with `supply: 'fluid:water'` and `count: 4` (250 L/s per LV pump), build step text `Put the Basic Pump over an infinite water source (a 2×2 pool)`.
- `it('plans nitrogen from air with nothing bought')`: nitrogen at LV → steps include `air-n2`, `compress-air`, `release-air`; `status 'ok'`; no raw input is `fluid:air`.
- `it('buys cobblestone free at ULV')`: gravel at tier 0 → steps `['gravel-hand']`; cobblestone a `free` raw input; no step has `supply`.
- `it('plans no supply step in Make N')`: gravel ×64 in Make N at LV → no step has `supply`.

`tests/unit/planner/bom-steps.test.ts` additions: `it('keeps free inputs as leaves of a breakdown')` — a machine whose crafting chain takes water has water as a leaf total; `it('writes litres for fluids in build steps')` — `buildSteps` with a `bom` whose totals are 1,000 L `fluid:water` and 3 iron ingots → the gather text contains `1,000 L Water` and `3× Iron Ingot`.

`tests/unit/shared/apply-op.test.ts`: `defaultSettings().haveSupply` equals `[]`; `validateOp` rejects `{ op: 'settings', patch: { haveSupply: 'x' } }` and `{ op: 'settings', patch: { haveSupply: [1] } }`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/pack/supply.test.ts tests/unit/planner/supply.test.ts tests/unit/planner/bom-steps.test.ts tests/unit/shared/apply-op.test.ts`
Expected: FAIL — `supply.ts` missing; cobblestone and water bought free with no step; the gather text reads `1,000× Water`.

- [ ] **Step 3: Implement spec R2**

`deriveSupply` and its wiring in `load.ts` and `packFromSpec`; `planBasis` computes `supplied` (rate mode, not in `haveSupply`, some accepted `meta.supply` recipe makes the key or a container of it); the leaf oracle (a `free` key in `supplied` → NOT_A_LEAF); `LpRecipe.supply` from `Recipe.meta.supply`, counted as a source by `sourceColumns`; `PlanStep.supply` in the step description (the output key; for `'compressor'` the container's fluid); the `configure` texts of R2 in `steps.ts`, and `amountText` callers writing `<n> L <name>` for fluids; `expandWith` keeps `FREE_KEYS` as leaves; the `haveSupply` default and check.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(planner): free inputs come from a rock breaker, pump or compressor unless the group has a supply

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Steps vs raw material and pruning

**Files:**
- Modify: `src/server/planner/solve.ts`, `src/server/planner/lp.ts`, `src/server/planner/candidates.ts`, `src/server/planner/plan.ts`, `src/shared/types/plan.ts`, `src/shared/project/apply-op.ts`
- Test: create `tests/unit/planner/step-charge.test.ts`; modify `tests/unit/planner/candidates.test.ts`, `tests/unit/planner/lp.test.ts`, `tests/unit/planner/solve.test.ts`, `tests/unit/planner/avoid.test.ts`, `tests/unit/shared/apply-op.test.ts`

**Interfaces:**
- Consumes: Task 1's `Solution.leastRawCost`, `firstBalanced`; Task 3's `LpRecipe.supply`.
- Produces:
  - `src/shared/types/plan.ts`: `DEFAULT_STEP_CHARGE`, `PlanSettings.stepCharge?: number`.
  - `apply-op.ts`: `MAX_STEP_CHARGE`; the `stepCharge` default and check.
  - `solve.ts`: `export interface SolveOptions { stepCharge?: number; handWeight?: number; probe?: boolean }` (spec R3); `solveLine(graph: CandidateGraph, demand: ReadonlyMap<StuffKey, number>, opts?: SolveOptions): Promise<Solution>` (no `stepCharge` = 0 = today's stages); `STEP_CHARGE_CAP`, `HAND_STEP_WEIGHT`, `STEP_BIG_M`, `STEP_MIP_MAX_NODES`, `CANON_RANK_S3`, `CANON_RANK_S4`.
  - `lp.ts`: `LpModel.start?: number[]` (HiGHS `setSolution({ colValue })` after `passModel`).
  - `candidates.ts`: `canonicalRank(key: StuffKey): 0 | 1` (spec R10), `MAX_EXTRA_PRODUCER_STEPS`.
  - `plan.ts`: `solveOptions(settings: PlanSettings): SolveOptions`, `PIN_DOMINATED_SHARE`; warnings `hand-step` and `pin-dominated`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/planner/step-charge.test.ts` — helper `charged(spec, leafCosts, opts)` like `machines.test.ts`'s `planned`: `buildCandidates` with a `LeafOracle` giving `{ buyable: true, cost, leafClass: 'direct' }` for the keys of `leafCosts`, then `solveLine(graph, new Map([['t:t@0', 1]]), opts)`; it returns the sorted recipe ids with runs > 0 and the `Solution`. Fixture (LV assemblers, 16 EU/t): `direct` (1 `t:a@0` → 1 `t:t@0`); chain `b1` (1 `t:c@0` → 1 `t:b1@0`), `b2`, `b3`, `from-b` (1 `t:b3@0` → 1 `t:t@0`); long chain `k1` … `k9`, `from-k` from `t:e@0`; `a` costs 1.
- `it('does not build a chain to save a crumb')`: c at 0.99 → `['direct']` with `{ stepCharge: 0.05 }`; `['b1', 'b2', 'b3', 'from-b']` with `{ stepCharge: 0 }`.
- `it('builds a chain that saves enough')`: c at 0.85 → the chain; at 0.9 → `['direct']` (the chain wins only below 1/1.15 ≈ 0.87).
- `it('never goes above 1.25 times the least raw material')`: with only the long chain and `direct`, e at 0.75 → the long chain (direct would be 33 % above the least) and `sol.rawCost ≤ 1.25 × sol.leastRawCost`; e at 0.85 → `['direct']`.
- `it('prefers a machine to hand-crafting in a running line')`: `p-hand` (crafting) and `p-machine` (bender, 24 EU/t), each 1 a → 1 t → `{ stepCharge: 0.05, handWeight: 3 }` gives `['p-machine']`, `{ stepCharge: 0.05, handWeight: 1 }` gives `['p-hand']`.
- `it('keeps one of two equal producers')`: identical `q1` and `q2` → one recipe.
- `it('maps settings to solve options')`: `solveOptions(defaultSettings())` equals `{ stepCharge: 0.05, handWeight: 3 }`; `mode: 'makeN'` or `automateCrafting: true` → `handWeight: 1`; `stepCharge: 0` → `stepCharge: 0`.
- `it('warns about a step left to hand-crafting')`: Mini-GT `t:hull_lv@0` at LV in rate mode → warnings include `{ code: 'hand-step', stepId: 'hull-lv' }` and `{ code: 'hand-step', stepId: 'cable' }`; with `automateCrafting: true` none.
- `it('flags a dominated pin')`: Mini-GT circuits at LV with `recipeChoice: { 't:iron_plate@0': 'hammer-plate' }` → a warning `{ code: 'pin-dominated', stepId: 'hammer-plate', key: 't:iron_plate@0' }` (raw 2 against 1 for `bend-plate`).

`tests/unit/planner/solve.test.ts`: `it('probes the least raw material only')` — on an existing fixture `solveLine(graph, demand, { probe: true })` has the full solve's `status` and a `rawCost` equal to the full solve's `leastRawCost`; an infeasible fixture probes `infeasible`.

`tests/unit/planner/candidates.test.ts` additions:
- `it('neither charges nor waits for cells a recipe hands on')`: an EBF steel recipe needing 1,000 L oxygen; oxygen from `electrolyze` (2 Empty Cells + 1,000 L water → 1,000 L oxygen + 2 Hydrogen Cells, with a `fluidContainers` entry for the Hydrogen Cell) and from a costly dust electrolysis → the EBF recipe and `electrolyze` are in the graph.
- `it('keeps the simplest producer')`: a 1-step producer whose estimate is 2.5× the cheapest 4-step one is kept.
- `it('drops a producer far longer than the simplest')`: a producer 7 steps longer than the simplest and not the cheapest is dropped; one that is the cheapest is kept.
- `it('prefers the canonical member at a tie')`: `minecraft:log@0` and `BiomesOPlenty:logs1@0` as options of one slot at equal cost → `minecraft:log@0` kept when only one option is kept.
- `it('adds the recipe that empties a filled container a recipe makes')` (D14): a recipe making `t:o2_cell@0` (a `fluidContainers` entry for oxygen) and a canner recipe emptying it → the canner recipe is in the graph.

`tests/unit/planner/lp.test.ts`: `it('accepts a start solution')` — the file's small MIP with `start` set to its known optimum returns the same optimum.

`tests/unit/planner/avoid.test.ts`: `it('plans the plain line when it uses nothing avoided')` — Mini-GT circuits at MV with `avoid: ['Titanium']` → `steps` equal those of the plan without the avoid list, and `avoided` is `[]`.

`tests/unit/shared/apply-op.test.ts`: default `stepCharge: 0.05`; `validateOp` rejects `stepCharge` 0.6, −0.1 and `'x'`; `it('fills the new settings of an old project')` — `normalizeSettings` of stored settings without `stepCharge` and `haveSupply` but with `routeDerived: false` returns `stepCharge: 0.05`, `haveSupply: []` and `routeDerived: false`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/planner/step-charge.test.ts tests/unit/planner/solve.test.ts tests/unit/planner/candidates.test.ts tests/unit/planner/lp.test.ts tests/unit/planner/avoid.test.ts tests/unit/shared/apply-op.test.ts`
Expected: FAIL — `solveOptions` and `SolveOptions` missing, the chain is built at 0.99, hand-crafting wins, no `hand-step`/`pin-dominated`, `start` unknown, the oxygen route is pruned.

- [ ] **Step 3: Implement spec R3, R4, R10, D7, D14, D24**

- `lp.ts`: `LpModel.start`.
- `solve.ts`: when `stepCharge > 0` and S1 > `TINY`, `simplest()` runs the charge MIP of R3 (objective, cap row, links, `start` = S1's `x` with `y = 1` where it runs, `maxNodes: STEP_MIP_MAX_NODES`, a `feasible` result accepted), falls back to today's fewest-recipes S3 with the exact lock, then consolidates, and returns `{ off, locks, base }`; `stepCharge` 0 or absent keeps today's S3; S4 adds `CANON_RANK_S4 × canonicalRank` per purchase and convert column; `probe` returns after S1 (status, runs, buys, sinks, `rawCost`, `leastRawCost`).
- `candidates.ts`: carried containers, `stepsTo`, the simplest producer, step-bounded pruning and canonical ties (R4, R10), keeping plan 08's avoid filters; the emptying recipe of a filled container (`docs/local/planner-audit/patches/E-containers.patch`).
- `plan.ts`: `solveOptions(settings)` = `{ stepCharge: settings.stepCharge ?? DEFAULT_STEP_CHARGE, handWeight: settings.mode === 'rate' && !settings.automateCrafting ? HAND_STEP_WEIGHT : 1 }`, passed to every `solveLine` call; with goods to avoid, the plain solve and `avoidingLine`'s trials are probes and only the graph `avoidingLine` returns is solved fully (spec R3 "Avoid lists", including the tie case); `hand-step` and `pin-dominated` warnings with the spec D7 and D24 texts (the pin check after `addAlternatives`).
- `apply-op.ts`: the `stepCharge` default and check (finite, `0 ≤ v ≤ MAX_STEP_CHARGE`).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run`
Expected: PASS; the existing Mini-GT step expectations in `plan.test.ts` are unchanged.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(planner): a step must save its charge in raw material; pruning keeps the simplest route

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Ingredient options, supporting lines and the build list

**Files:**
- Create: `src/server/planner/lines.ts`, `tests/unit/planner/options.test.ts`, `tests/unit/planner/lines.test.ts`
- Modify: `src/server/planner/machines.ts` (export `stepInputs`; every used option), `src/server/planner/candidates.ts` (`optionChoice`, `stale-option`), `src/server/planner/plan.ts` (`PlanStep.options`, `PlanStep.line`), `src/server/planner/bom.ts`, `src/shared/types/plan.ts`, `src/shared/project/apply-op.ts`
- Test: also `tests/unit/planner/machines.test.ts`, `tests/unit/planner/bom-steps.test.ts`, `tests/unit/shared/apply-op.test.ts`

**Interfaces:**
- Consumes: Task 2's `Standalone.recipes`/`top`; Task 1's flows and `StepLine`; the cost model.
- Produces: `StepOption` and `PlanStep.options?: StepOption[]` (spec R9); `PlanSettings.optionChoice?: Record<string, StuffKey>`; `stepInputs(r: Recipe, line: StepLine): Product[]` (exported); `supportingLines(pack: Pack, plan: Plan, basis: PlanBasis): Map<string, { key: StuffKey; name: string }>` and `PlanStep.line?: { key: StuffKey; name: string }`; `BomLine.neededFor?: Array<{ key: StuffKey; amount: number }>`; warning `stale-option`.

- [ ] **Step 1: Write the failing tests**

`tests/unit/planner/machines.test.ts`: `it('lists every option a slot used')` — `stepInputs` of a recipe with slot `{ any: [['fluid:molten.solder', 72], ['fluid:molten.tin', 144], ['fluid:molten.lead', 288]] }` and a `StepLine` whose `conversions` give that slot's virtual key `{ 'fluid:molten.solder': 0.36, 'fluid:molten.tin': 0.64 }` → `[{ key: 'fluid:molten.solder', amount: 25.92, … }, { key: 'fluid:molten.tin', amount: 92.16, … }]` (no lead).

`tests/unit/planner/options.test.ts` — fixture: target `t:ec@0` by `ca` (circuit assembler map; `t:part@0` plus the solder slot as slot 100); extractors `x-solder`, `x-tin`, `x-lead` (ingot → 144 L); `alloy-solder` (alloy smelter: 9 tin ingots + 1 antimony dust → 10 solder ingots); tin, lead, antimony and part mined:
- `it('explains the option it chose')`: `step.options[0]` has `slot 100` and choices solder `{ rawPerRun: 0.5, steps: 2, share: 1 }` with `via` containing the alloy smelter's map name, tin `{ rawPerRun: 1, steps: 1, share: 0 }`, lead `{ rawPerRun: 2, steps: 1, share: 0 }`.
- `it('pins an option')`: `optionChoice: { 'ca#100': 'fluid:molten.tin' }` → steps include `x-tin` and not `alloy-solder`; `options[0].pinned === 'fluid:molten.tin'`.
- `it('ignores a stale option pin with a warning')`: `optionChoice: { 'ca#100': 'fluid:molten.gold', 'gone#0': 't:x@0' }` → `status 'ok'` and two `stale-option` warnings with keys `'ca#100'` and `'gone#0'`.

`tests/unit/planner/lines.test.ts` — fixture: mined copper and redstone; `alloy-ra` (alloy smelter → `t:redalloy_ingot@0`, gt `ingot` RedAlloy); `x-ra` (extractor → 144 L `fluid:molten.redalloy`); `wire-asm` (assembler: 72 L molten red alloy + 1 copper ingot + 100 L `fluid:glue` → `t:wire@0`); `glue` (centrifuge: mined `t:resin@0` → 100 L glue); after `packFromSpec`, set `pack.materials.get('RedAlloy')!.displayName = 'Red Alloy'`; the target is the wire:
- `it('groups the steps behind a material into its line')`: `alloy-ra` and `x-ra` have `line: { key: 'fluid:molten.redalloy', name: 'Red Alloy' }`; `wire-asm` has none.
- `it('leaves a one-step fluid in the main line')`: the `glue` step has no line.
- `it('drops a line the group already makes')`: `stopItems: ['fluid:molten.redalloy']` → no step has a line and that raw input is `stop`.

`tests/unit/planner/bom-steps.test.ts`: `it('never makes an Empty Cell from a recipe that only hands it back')` (the case of `docs/local/planner-audit/patches/G-bom-containers.patch`); `it('says which build lines need each total')` — the `neededFor` amounts of every total sum to its `amount`, and a line's `why` reads `for <name>, <name>`.

`tests/unit/shared/apply-op.test.ts`: default `optionChoice` `{}`; `validateOp` rejects `optionChoice` keys `'nohash'`, `'r#x'`, `'#1'` and a 301-character value, and accepts `{ 'r1#100': 'fluid:molten.tin' }`; `it('fills the new settings of an old project')` also checks `optionChoice: {}`.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/unit/planner/machines.test.ts tests/unit/planner/options.test.ts tests/unit/planner/lines.test.ts tests/unit/planner/bom-steps.test.ts tests/unit/shared/apply-op.test.ts`
Expected: FAIL — only the busiest option listed, no `options`/`line`/`neededFor`, `optionChoice` unknown.

- [ ] **Step 3: Implement spec R9, R6 (lines), D12, D15**

`stepInputs` per R9 (share = runs of the option's convert recipe / Σ over the slot; `chance` = `expected / nominal` when several options run); `optionChoice` in `addRecipe` (a pinned slot becomes a single-option slot) and `stale-option` for a pin whose recipe or option is gone; `PlanStep.options` in `plan.ts` (`rawPerRun` = amount × `model.costs.cost`, `steps`/`via` from `standaloneCosts(model.graph, [key])`, cached per plan); `lines.ts` per R6, run after the flows; `bom.ts` per `docs/local/planner-audit/patches/G-bom-containers.patch`, plus `neededFor` and the `why` "for Resistor, Vacuum Tube, …"; the `optionChoice` default and check (`/^[^#]{1,100}#\d{1,4}$/`, values 1–300 characters).

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(planner): every option a step uses, pinnable options, supporting lines, traceable build totals

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Client numbers, integrity notes and panels

**Files:**
- Create: `src/client/views/plan-diff.ts`, `src/client/state/flow-focus.ts`, `tests/client/plan-diff.test.ts`, `tests/client/step-panel.test.tsx`, `tests/client/plan-banner.test.tsx`
- Modify: `src/client/format.ts` (re-export `src/shared/format.ts` beside `localTime`), `src/client/views/flow-model.ts` (re-exports, `ocLines`, `LEAF_WORD`, patch builders), `src/client/views/StepPanel.tsx`, `src/client/views/materials-model.ts`, `src/client/views/MaterialsView.tsx`, `src/client/views/ProjectPage.tsx` (export `PlanBanner`), `src/client/views/SettingsPanel.tsx`, `src/client/views/settings-model.ts`, `src/client/state/project-store.ts`, `src/client/components/ItemIcon.tsx`, `src/client/styles.css`
- Test: also `tests/client/flow.test.tsx`, `tests/client/materials.test.tsx`, `tests/client/settings.test.tsx`, `tests/client/project-store.test.tsx`, `tests/client/item-icon.test.tsx`

**Interfaces:**
- Consumes: Task 1's formatter, `indexPlan`, `issueText`, `Plan.target`, `Plan.rawCost`, `PlanWarning.stepIds`/`share`; Task 2's `RawInput.pricedVia`/`canMake`; Task 3's `PlanStep.supply`; Task 5's `PlanStep.options`/`line` and `BomLine.neededFor`.
- Produces: `LEAF_WORD: Record<LeafClass, string>` (spec §6.2 words); `useOnlyPatch(settings, key, recipeId)`, `importInsteadPatch(settings, key)`, `makeHerePatch(settings, key)`, `haveSupplyPatch(settings, key, on)`, `optionPatch(settings, recipeId, slot, key | null)`, each returning `Partial<PlanSettings>` with whole values; `STEP_CHARGE_PRESETS` (spec §3, in `settings-model.ts`); `planChange(prev: Plan, next: Plan): { importsAdded: StuffKey[]; importsRemoved: StuffKey[]; stepsAdded: string[]; stepsRemoved: string[]; issuesNew: PlanIssue[] }`; `ProjectViewState.previousPlan: Plan | null`; in `src/client/state/flow-focus.ts`: `export type Focus = { kind: 'item'; key: StuffKey } | { kind: 'node'; id: string } | { kind: 'edge'; id: string } | null`, `setFlowFocus(focus: Focus): void`, `useFlowFocus(): Focus`.

- [ ] **Step 1: Write the failing tests**

`tests/client/flow.test.tsx`: the `formatRate` expectation becomes `['30/min', '1,800/h', '0.738/min', '2.5/min']`; `ocLines(mv)[3]` stays `'One machine: 0.4 runs/s · needed: 1 runs/s → 3 machines, 83% busy'`; a step needing 3.1e-8 runs per second gives a last line ending `needed: 1 run every 373 days → 1 machine, <0.1% busy`.

`tests/client/step-panel.test.tsx` (SSR with `renderToStaticMarkup`, synthetic plans): Takes/Makes rows with `from Wiremill (1x Copper Wire)` and `to Basic Assembler (Basic Circuit)`; "Also made by" with `Use only this recipe for Iron Plate`; the Options section text `Molten Soldering Alloy chosen: 0.50 raw per circuit vs 1.00 for Molten Tin`; the Supply section `We already have a supply of Cobblestone`; the Line section `Part of the Red Alloy line` and `We already make Red Alloy`; the stop section titled `Supply it from outside` with `Import Sand instead`; the swap list's last radio `Import it (counted at 1 raw/unit)`, whose `raw/unit` has the `title` `raw-material units per unit made (1 base item, 144 L molten metal or 1,000 L other fluid = 1)`; RawPanel `Used by`, `Bought: usually made by Alloy Smelter from Copper Ingot, Redstone (1 recipe)`, `Make it here instead` `disabled` with `Nothing at LV makes Copper Ingot` when `canMake: false`, and `Plan its generator again` for a free input listed in `haveSupply`. The five patch builders return `{ recipeChoice: {…} }`, `{ stopItems: [...] }`, `{ expandItems: [...] }`, `{ haveSupply: [...] }`, `{ optionChoice: {…} }` with the whole new value (`optionPatch` with `null` removes the pin).

`tests/client/plan-banner.test.tsx`: a plan with two `orphan-input` and one `multi-producer` issue renders `This plan does not add up: 2 inputs have no source, 1 good is made two ways`; a `derived-leaf` warning renders one chip per leaf and, with `routeDerived: false`, the button `Plan them as supporting lines`; `rawCost { perSecond: 1.21, leastPerSecond: 1 }` renders `Uses 21% more raw material than the least possible to save machines (Steps vs raw material: Balanced)`.

`tests/client/materials.test.tsx`: `1 L every 12.1 days` for a 0.003438 L/h fluid; no `0.00` anywhere; `usedBy` names the consumers; `missingRows` first with the badge `no source in the plan`; a total opens to its `neededFor` lines; the build-list row of a Programmed Circuit with configuration 3 reads `Programmed Circuit (config 3)`.

`tests/client/item-icon.test.tsx`: `ItemIcon` with `name: 'Copper Wire'` renders `title` and `aria-label` `Copper Wire`, not the key.

`tests/client/plan-diff.test.ts`: from a plan buying Ethylene and running a reactor to one buying a PE Bar → `importsRemoved ['fluid:ethylene']`, `importsAdded [<PE bar key>]`, `stepsRemoved [<reactor recipe id>]`, and a new `orphan-input` in `issuesNew`.

`tests/client/settings.test.tsx`: the `Steps vs raw material` select lists `Least raw material`, `Some steps`, `Balanced`, `Fewest machines` and sends `{ stepCharge: 0.15 }`; a stored 0.07 shows `Custom (7%)`; `it('shows Balanced for a project without stepCharge')`; the `We already have a supply` list removes an entry; the `routeDerived` label reads `Plan supporting lines for alloys, plastics and chemicals (off: buy the shallow ones)`.

`tests/client/project-store.test.tsx`: `previousPlan` is `null` at first and becomes the replaced plan when a plan with another `settingsHash` arrives (not on a refetch with the same hash).

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/client`
Expected: FAIL.

- [ ] **Step 3: Implement spec §6.1 (client side), §6.3 and §6.4**

`src/client/format.ts` re-exports the shared formatter, and `flow-model.ts` re-exports `formatRate`/`formatNumber` from it; the sections and panels of §6.3; `PlanBanner` (integrity summary from `indexPlan(plan).issues`, server texts preferred, `issueText` as fallback; derived chips that focus their import; the cost line); the Materials rows; `plan-diff.ts` and its dismissible "What changed" note (above the Flow canvas and the Materials sections); the settings controls; the `ItemIcon` `name` prop, passed by every view.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests
git commit -m "feat(client): readable rates, integrity notes, takes/makes, options, supply and line actions

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Flow diagram — imports by their step, item ports, focus, supporting lines

**Files:**
- Modify: `src/client/views/flow-model.ts`, `src/client/views/FlowView.tsx`, `src/client/styles.css`, `docs/research/web-stack.md` (§7: the ELK options of spec §6.2)
- Create: `tests/e2e/flow-focus.spec.ts`, `tests/e2e/fixtures/plans.ts` (Mini-GT keys only)
- Test: `tests/client/flow.test.tsx`

**Interfaces:**
- Consumes: Task 6's formatter re-exports, `LEAF_WORD`, `Focus` and the flow-focus store; Task 1's `indexPlan`; Task 5's `PlanStep.line`.
- Produces: `FlowNode.kind` gains `'import' | 'missing' | 'line'`; `FlowNode.rows: FlowRow[]` with `FlowRow` of spec §6.2; `focusSets(graph: { nodes: FlowNode[]; edges: FlowEdge[] }, focus: Focus): { nodes: Set<string>; edges: Set<string>; ports: Set<string>; producers: Set<string>; consumers: Set<string> } | null`; `flowGraph(plan: Plan, per: 'min' | 'hour', opts?: { collapsedLines?: ReadonlySet<StuffKey>; importsInOneColumn?: boolean })`; `centreOn(node: { x: number; y: number; width: number; height: number }, view: { zoom: number; x: number; y: number }, canvas: { width: number; height: number }): { zoom: number; x: number; y: number }`.

- [ ] **Step 1: Write the failing tests**

`tests/client/flow.test.tsx` (synthetic plans like the existing ones):
- rows and titles: the wiremill node has title `Advanced Wiremill`, line `MV · 28 EU/t · 1 machine · 0.1% busy` and rows `[['in', 'Copper Ingot', '1/h'], ['out', '1x Copper Wire', '2/h']]` (side, name, rate); a supply step shows `supplies Cobblestone`; a hand step `by hand`.
- stubs: one `import:<key>@<stepId>` per raw flow, its out row the `LEAF_WORD` of its `leafClass`; a plan whose mixer input `fluid:pva` has no flow gets `missing:fluid:pva@mixer` with row name `no source in the plan`, rate `0.223 L/h`, `issue 'orphan-input'` and an edge into port `mixer|in|fluid:pva`; one `sink:<key>@<stepId>` per left-over with row `left over`.
- labels only on ports with 2+ edges; every edge has a `title`.
- `toElk`: no `layerConstraint` on import stubs (`FIRST` with `importsInOneColumn`), ports with `elk.portConstraints: 'FIXED_POS'`, `LAST` on `out`, root options `elk.hierarchyHandling: 'INCLUDE_CHILDREN'`, `elk.layered.cycleBreaking.strategy: 'DEPTH_FIRST'` and `elk.layered.considerModelOrder.strategy: 'NODES_AND_EDGES'`; a plan with lines has a compound child `line:fluid:molten.redalloy` holding its steps, and with that key in `collapsedLines` a single node of kind `line` instead.
- layout in Node (`new ELK()`): every import stub's right edge is 0–120 px left of its consumer's left edge; every edge's first point lies on its source port's row ±2 px.
- `focusSets`: item focus on a plate made by `solid` and `saw` → `producers` `{solid, saw}`, `consumers` `{asm}`, 2 edges; node focus on `mill` → nodes `{mill, its import stub, asm}`; `null` → `null`.
- SSR: `FlowNodeShape` under a focus renders the classes `hl`, `dim`, `producer`, `consumer` and rows with `data-port` and `aria-label` `makes 1x Copper Wire 2/h: show where it goes`; `FlowIssues` renders the issue texts with `Show` buttons and, for `multi-producer`, `Keep only Fluid Solidifier`; the legend lists import, free, no source, left over and supporting line.

`tests/e2e/flow-focus.spec.ts` — the seven cases of spec §7.1, with fixture plans from `tests/e2e/fixtures/plans.ts` served by `page.route('**/api/projects/*/plan', (r) => r.fulfill({ json }))`; case 7 uses the real Mini-GT server.

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run tests/client/flow.test.tsx && npm run e2e -- tests/e2e/flow-focus.spec.ts`
Expected: FAIL.

- [ ] **Step 3: Implement spec §6.2**

Model (rows, ports, stubs, line groups, `focusSets`, the ELK graph with ports and compound nodes, widths from text clamped to 190–330 px); canvas (focus: hover transient, click pins and opens the panel, Esc or an empty-canvas click clears, Enter/Space on a row pins; `FindItem` centring the first producer; `FlowIssues` with Show and Keep only; line groups with a collapse toggle, collapsed by default above 25 steps; the "Imports in one column" toggle; initial view zoom 0.9 centred on `out`; 10 px transparent hit paths and `<title>`s on edges); styles; the web-stack §7 note.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npm run typecheck && npx vitest run && npm run e2e`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src tests docs/research/web-stack.md
git commit -m "feat(client): flow diagram shows imports by their step, item ports and focus, supporting lines

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Real-data acceptance and the invariant gate

**Files:**
- Create: `tests/unit/planner/real-user-project.test.ts`, `tests/unit/planner/real-corpus.test.ts`
- Modify: `tests/unit/planner/real-acceptance.test.ts`, `tests/unit/planner/real-pack.test.ts`, `README.md` ("Using the planner": steps vs raw material presets, supply steps and "We already have a supply", supporting lines, ingredient options), `docs/superpowers/plans/2026-10-17-02-planner-app.md` ("Real-data amendments": one line pointing to plan 09)

**Interfaces:**
- Consumes: everything above; `checkPlanInvariants`, `checkPlanInvariantsDeep`, `indexPlan`, `flowGraph`, `focusSets`.
- Produces: the acceptance gate of spec §7.2–§7.3.

- [ ] **Step 1: Write the tests**

`real-user-project.test.ts`: the user's settings verbatim from `audit/proj.json` (`target 'IC2:itemPartCircuit@0'`, `amount 1`, `per 'hour'`, `tier 2`, `routeDerived false`, `logistics 'routed'`, `recipeChoice { 'fluid:glue': '98f259e40a64e8b0', 'gregtech:gt.metaitem.01@32716': '0a074f4241a9e0f9' }`, the six default excluded categories, `automateCrafting false`) through `normalizeSettings`; plans `P`, `P1m` (`per: 'min'`) and `PR` (`routeDerived: true`), each < 5 s; one `it` per complaint with exactly the assertions of spec §7.2's table.
`real-corpus.test.ts`: the 16 targets × 3 variants of spec §7.2 with its per-plan assertions and the documented exceptions for kinds c and g, asserted per good; each plan < 5 s.
`real-acceptance.test.ts` and `real-pack.test.ts`: the updates of spec §7.2; plan 08's avoid tests keep their assertions and the 5 s bound, and the Annealed Copper one ("still buy when avoiding Copper") passes `routeDerived: false`.

- [ ] **Step 2: Run them**

Run: `GTNH_LOCAL=1 npx vitest run tests/unit/planner/real-user-project.test.ts tests/unit/planner/real-corpus.test.ts tests/unit/planner/real-acceptance.test.ts tests/unit/planner/real-pack.test.ts tests/unit/planner/real-rate.test.ts`
Expected: PASS. A failure is a defect of Tasks 1–5: fix it in the owning module (not by loosening a bound) and run again.

- [ ] **Step 3: Run the whole suite**

Run: `npm run typecheck && npx vitest run && npm run e2e && GTNH_LOCAL=1 npx vitest run tests/unit/planner`
Expected: PASS (the plain run skips the real-data files).

- [ ] **Step 4: Commit**

```bash
git add tests README.md docs/superpowers/plans/2026-10-17-02-planner-app.md
git commit -m "test(planner): the user's project, the corpus invariant gate and timing on the 2.9 export

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

### Task 9: "Reuse machines we have" switch and the manual "Machines we have" list

Added by the controller at the user's request ("we need to have a way to disable the reuse for the whole recipe"); architecture §11.29 (the switch and the manual list only — counting build cost in the objective, §11.28, and sharing one owned machine across steps stay in the follow-up plan).

**Files:**
- Modify: `src/shared/types/plan.ts` (`PlanSettings.reuseOwned?: boolean`, `PlanSettings.ownedManual?: Array<{ mteId: number; count: number }>`; `PlanStep.reused?: { count: number; where: Array<{ dim: number; pos: [number, number, number] }> }`), `src/shared/project/apply-op.ts` (defaults `reuseOwned: true`, `ownedManual: []`; validation: boolean; at most 200 entries, `mteId` a non-negative integer, `count` an integer 1..10,000, duplicate `mteId`s merged by summing), `src/server/planner/machines.ts` and `src/server/planner/make-n.ts` (owned = `reuseOwned === false` ? none : scan-owned + manual, minus `declineReuse`), `src/server/world/context.ts` only if the owned positions are not yet passed (append-only), `src/client/views/SettingsPanel.tsx` (+ a small `OwnedMachinesEditor` component), `src/client/views/StepPanel.tsx` (say where reused machines stand)
- Test: `tests/unit/planner/reuse.test.ts` (Mini-GT), `tests/unit/shared/apply-op.test.ts`, `tests/client/settings.test.tsx`, one case in `tests/e2e/` (toggle off → no owned boxes)

**Interfaces:**
- Consumes: `PlanContext.ownedMachines` (Plan 4 `contextFromScan`, base machines with positions), `settings.declineReuse`, Plan 2 machine assignment.
- Produces: the two settings, `PlanStep.reused`, `Plan.steps[i].owned` honouring the switch.

- [ ] **Step 1: Write the failing tests** — `reuse.test.ts`: with a context owning 2 assemblers, a step needing 3 assemblers gets `owned: 2` and `reused.count: 2`; with `reuseOwned: false` the same plan has `owned: 0` on every step and no `reused`; `ownedManual: [{ mteId: <assembler>, count: 1 }]` with no world context gives `owned: 1`; `declineReuse` still removes one type while the switch is on; Make N follows the same rules. `apply-op.test.ts`: defaults `reuseOwned: true`, `ownedManual: []`; rejects `reuseOwned: 'x'`, 201 entries, `count: 0`, `mteId: -1`; duplicate `mteId`s summed. `settings.test.tsx`: the Options section shows a "Reuse machines we have" switch (checked by default) whose change sends `{ reuseOwned: false }`, and a "Machines we have" editor listing entries by machine name with add/remove. E2E: turning the switch off removes the owned colouring from every flow box.
- [ ] **Step 2: Run them to verify they fail** — `npx vitest run tests/unit/planner/reuse.test.ts tests/unit/shared/apply-op.test.ts tests/client/settings.test.tsx` → FAIL.
- [ ] **Step 3: Implement** per Files/Interfaces; the step panel says e.g. "2× Assembler (MV) reused — at your base x y z" when positions are known, "2× Assembler (MV) reused — from your list" for manual ones.
- [ ] **Step 4: Verify** — `npm run typecheck && npx vitest run && npm run e2e` → all pass.
- [ ] **Step 5: Commit**

```bash
git add src tests docs/superpowers/plans/2026-10-19-09-planner-quality.md
git commit -m "feat(planner): reuse machines we have switch and a manual machine list

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
