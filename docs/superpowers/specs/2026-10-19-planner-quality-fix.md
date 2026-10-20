# Fix specification: planner quality (plan 09)

Date 2026-10-19 · Author: lead engineer (from four audits and a prototype) · Status: ready to implement

Implementation plan: `docs/superpowers/plans/2026-10-19-09-planner-quality.md` (9 tasks; Task 9 was added with the
user's answers in §10). This document is the spec that plan argues from; plan 09 Task 1, Step 1 committed it under this
name, `docs/superpowers/specs/2026-10-19-planner-quality-fix.md`, and recorded the user's answers to §10 in §1, §3, §8,
§9 and §10.

Inputs read for this spec:
- The user's report (the six complaints) and the relayed request: *"the fluid extractor using cobble and 2 different
  machines just to make molten glass when MV can make molten glass straight from sand"*.
- The user's project `audit/proj.json` and the plan the server returned, `audit/plan.json`.
- Audit reports `docs/local/planner-audit/{invariants,rootcause,gtnh,ui}.md` and `docs/local/planner-audit/user-clarification.md`.
- Code at `cd6fcce` (line numbers below are that commit's). Main has since moved to `46067df` (plan 08 "materials to
  avoid" and the world scan merged): `plan.ts`, `candidates.ts`, `basis.ts`, `bom.ts`, `steps.ts`, `machines.ts`,
  `availability.ts` and `pricing.ts` changed, `solve.ts` and `lp.ts` did not. Plan 09 is built on main, so find code by
  function name. The audit patches A and C–G apply cleanly to `46067df` (`git apply --check`), and the audit's invariant
  checker test passes there.
- A prototype I built on a private copy (`scratchpad/lead/proto`, switched by `EXP_*` environment flags; scratch only,
  not to be merged). Every number marked "prototype" comes from it, on the active export
  `2.9.0-RC-1_20261018-210216`, on a host with load average ≈ 11 (other agents running), so times are pessimistic.

Paths below without a prefix are repository paths. `audit/` means
`docs/local/planner-audit/`.

---

## 1. What the user expects (binding) and what this spec does about it

| User expectation | Where it comes from | Decision in this spec |
|---|---|---|
| No input from nowhere ("we are missing the import") | complaint 1 | §4 D1–D3: the solver works at unit demand, rates keep 9 significant digits, a residual check refuses unbalanced plans, and the server and the client both flag any input nothing supplies |
| One process per product unless truly needed | complaint 3 | §4 D2, D6: the simplification stage works again and charges every step, so a second producer stays only when it saves more than a step is worth; any that remains is flagged with its share and a "keep only" action |
| Gathered items like sand are imports, never crafted from free cobblestone | complaint 5, relayed request | §4 D4–D5: sand, gravel and other world blocks are gathered leaves; free inputs need their generator machine, so a free-cobblestone detour costs steps |
| Complex materials (ethylene, PE, alloys…) get a line behind them, shown as supporting lines | complaint 2, clarification §11.27 | §4 D9–D10, §5 R6: derived fluids are always made; `routeDerived` defaults to `true`, and projects stored before plan 09 are switched to `true` once (§10 answer 2); steps are grouped into supporting lines that can be switched to "we already make this" |
| Imports clearly shown | complaints 1–2 | §6: import stubs next to the step that uses them, a leaf word (mined, gathered, free, bought…) and the chain a bought material stands for |
| Where an item comes from can be highlighted | complaint 4 | §6: item ports on every box, hover or click an item to light its producers, edges and consumers, a Find box, and Takes/Makes in the step panel |
| Sensible step counts | complaints 3, 5, 6 | §4 D6–D8: each step must save at least 2 % of the line's least raw material by default (per-project setting; §10 answer 3); hand-crafting in a running line weighs 3 steps; pruning keeps the simplest route |
| Free inputs need a generator ("we need a stone generator") | clarification §11.26 | §4 D5: rock breaker, pump and compressed-air supply steps, unless the project says it already has a supply |
| Choosable solder option with an explanation | clarification | §4 D12, §6: every option a step uses is listed with its raw cost and the steps its chain needs, and can be pinned |
| Build cost of machines in the objective | clarification §11.28 | **Deferred** to plan 10 (§9), together with the rest of reusing owned machines (§11.29: owned machines in the objective, sharing one owned machine across steps). Plan 09 Task 9 ships §11.29's "Reuse machines we have" switch, the manual "Machines we have" list and `PlanStep.reused` for machine assignment and the build list (§10 answer 1). The step charge is the stand-in until the build list is trustworthy |

---

## 2. The user's plan, before and after (real data)

The served plan reproduces byte for byte from `proj.json` on cd6fcce (rootcause, invariants and UI audits each checked
this independently).

| | Served (cd6fcce) | Numerics fix only (audit patch A) | All rules of this spec (prototype) | Same, `routeDerived: true` (prototype) |
|---|---|---|---|---|
| Steps | 26 | 29 | **15** | **27** (16 main + 11 in 7 supporting lines) |
| Inputs from nowhere | Polyvinyl Acetate 0.223 L/h, Methyl Acetate Cell | none | none | none |
| Imbalanced goods | Advanced Glue −0.79 %, Distilled Water −1.34 %, Molten Annealed Copper −1.52 % | none (< 1e-6) | none | none |
| Goods made two ways | Molten PE (97.9 / 2.1 %), Copper Plate (99.9 / 0.1 %) | none | none | none |
| Glass | cobblestone → gravel by hand → sand by forge hammer → fluid extractor | same | Glass Dust bought (forming press, 1 step) | Sand gathered → arc furnace → forge hammer → alloy smelter (the prototype took Red Sand at a tie; R10 makes it Sand) |
| Ethylene | bought from "Canner from Ethylene Cell" | bought | not used (refined-glue boards) | not used |
| Raw material per hour | 8.913 (below the true optimum: material from tolerance) | 8.914 | 12.65 (+21 % on the least, −11 steps) | 10.99 (+23 % on the least) |
| Same recipes at 1/min | no (29 vs 26) | yes | yes | yes |

The prototype columns here and in the corpus below ran the step charge at 5 %, the default this spec first proposed.
The user chose 2 % (§10 answer 3): on this line it keeps the biomass-ethylene PE board line, 22 steps at +1.5 % raw
material.

Corpus (prototype, 1 per minute unless stated; "before" from `docs/local/planner-audit/corpus-table.md`):

| Line | Tier | Before: steps | After: steps | After: raw/min | Time |
|---|---|---|---|---|---|
| Electronic Circuit | MV | 31 | 18 | 10.87 | 3.1 s |
| Electronic Circuit | LV | 19 | 14 | 15.96 | 2.2 s |
| Electronic Circuit, routed | MV | — | 28 | 9.66 | 3.1 s |
| Good Electronic Circuit | MV | 43 | 29 | 29.19 | 4.3 s |
| Good Electronic Circuit (2/min) | HV | 40 | 32 | 46.85 | 4.9 s |
| Integrated Logic Circuit | MV | 34 | 28 | 4.98 | 3.3 s |
| Advanced Circuit | HV | 62 | 54 | 21.86 | 4.8 s |
| Advanced Circuit, routed | HV | 94 | 59 | 16.85 | 4.0 s |
| Microprocessor, routed | HV | 73 | 60 | 2.92 | 4.7 s |
| MV Machine Hull | MV | 8 | 7 | 36.5 | 2.8 s |
| LV Motor | LV | 7 (4 by hand) | 7 (0 by hand) | 8.0 | 1.9 s |
| Vacuum Tube (4/min) | MV | 8 | 5 | 2.19 | 2.6 s |
| Glass Tube | MV | 4 | 1 | 1.0 | 2.6 s |
| Robot Arm (MV) | MV | 45 | 32 | 98.2 | 5.0 s |
| Steel Ingot (10/min) | MV | 2 (oxygen bought) | 4 (EBF, electrolyzer, canner, pump) | 10.0 | 3.5 s |

Every corpus plan in the prototype: 0 errors of the invariant checker's kinds a–g, identical recipe sets at 1/hour and
1/min (17 of 17 lines compared), total raw at most +25 % on the least raw material.

---

## 3. Constants and settings (one table; every task uses these names)

| Name | Value | File | Meaning |
|---|---|---|---|
| `DEFAULT_STEP_CHARGE` | `0.02` (§10 answer 3) | `src/shared/types/plan.ts` | default of `PlanSettings.stepCharge` |
| `STEP_CHARGE_PRESETS` | `[0, 0.02, 0.05, 0.15]` labelled "Least raw material", "Some steps", "Balanced", "Fewest machines" | `src/client/views/settings-model.ts` | settings panel presets |
| `MAX_STEP_CHARGE` | `0.5` | `src/shared/project/apply-op.ts` | `validateOp` upper bound |
| `STEP_CHARGE_CAP` | `0.25` | `src/server/planner/solve.ts` | total raw ≤ (1 + cap) × least raw (S1) |
| `HAND_STEP_WEIGHT` | `3` | `src/server/planner/solve.ts` | a crafting-table step weighs 3 steps in rate mode with `automateCrafting: false`; 1 otherwise |
| `STEP_BIG_M` | `100` | `src/server/planner/solve.ts` | runs ≤ 100 × the largest S1 run × binary |
| `STEP_MIP_MAX_NODES` | `1` | `src/server/planner/solve.ts` | the step-charge MIP stops after its root node (deterministic) |
| `LEAST_RAW_STEP` | `0.01` | `src/server/planner/solve.ts` | at step charge 0 (raw material held at the least, R3), the weight of each step recipe in the step-charge MIP |
| `CANON_RANK_S3` / `CANON_RANK_S4` | `1e-6` / `1e-3` | `src/server/planner/solve.ts` | tie-break weight per unit of a non-canonical purchase or option |
| `SIGNIFICANT_DIGITS` | `9` | `src/server/planner/round.ts` | every per-second value in `Solution` and `Plan` |
| `RESIDUAL_REL`, `RESIDUAL_ABS` | `1e-6`, `1e-9` (unit demand) | `src/server/planner/solve.ts` | residual check |
| `FLOW_DROP_REL` | `1e-9` | `src/server/planner/machines.ts` | a flow below 1e-9 × its producer's output of that good is dropped |
| `DERIVED_LEAF_MAX_DEPTH` | `4` | `src/server/planner/costs.ts` | with `routeDerived: false`, a derived material is bought only within 4 recipe layers |
| `GATHERED_BLOCKS` | table in R1 | `src/server/planner/availability.ts` | world blocks that are gathered leaves |
| `ORE_LINE_PREFIXES` | `['dust','ingot','gem','nugget','crushed','ore','rawOre']` | `src/server/planner/costs.ts` | ore blocks are leaves only for targets with one of these GT prefixes |
| `MAX_EXTRA_PRODUCER_STEPS` | `6` | `src/server/planner/candidates.ts` | pruning drops a kept producer whose estimated chain is 6+ steps longer than the simplest producer's (unless it is the cheapest) |
| Pump supply recipe | 1,000 L per run, 80 ticks, 8 EU/t, pseudo map `pump` | `src/server/pack/supply.ts` | LV pump = 1 bucket / 4 s; each tier above halves the time (GT `MTEPump`: one block per 160/2^tier ticks) |
| `ORPHAN_REL`, `SHORT_INPUT_SHARE` | `1e-6`, `0.995` | `src/shared/plan/balance.ts` | integrity issue thresholds |
| `PIN_DOMINATED_SHARE` | `1.01` | `src/server/planner/plan.ts` | a pinned recipe dearer than 1.01 × the cheapest alternative is flagged |

New `PlanSettings` fields (all optional additions; `defaultSettings()` and `normalizeSettings()` always fill them; each
gets a `SETTING_CHECKS` entry in `apply-op.ts`):

| Field | Type | Default | Check |
|---|---|---|---|
| `stepCharge` | `number` | `0.02` | finite, `0 ≤ v ≤ 0.5` |
| `haveSupply` | `StuffKey[]` | `[]` | list of strings; only `FREE_KEYS` entries have an effect |
| `optionChoice` | `Record<string, StuffKey>` | `{}` | keys match `/^[^#]{1,100}#\d{1,4}$/` (`<recipeId>#<slot>`), values strings of 1–300 chars |
| `settingsVersion` | `number` | `2` (`normalizeSettings()` fills a missing one with `1`) | safe integer `≥ 2` |
| `routeDerived` (existing) | `boolean` | **`true`** (was `false`) | unchanged |

Projects stored before plan 09 are switched to `routeDerived: true` once (§10 answer 2, §8 entry 32): at server start
one recorded settings op `{ routeDerived: true, settingsVersion: 2 }` by `'Planner update'` is applied to every live
project whose `settingsVersion` is below 2; a project at `settingsVersion ≥ 2` is never touched again, so a later
deliberate `false` sticks. `normalizeSettings()` alone keeps a stored `routeDerived`. Changing the defaults changes the
settings hash of every project, so every cached plan is recomputed once; that is intended.

---

## 4. Defects, root causes and decided fixes

Auditor ids: invariants INV-n, rootcause RCn, gtnh Gn, ui UI-n. "Decision" resolves disagreements; the reason follows.

### D1 (critical) Material from solver tolerance at low rates: inputs nothing makes — INV-1, RC1, G8, UI-1 (server part)

- **Root cause.** `solveLine` (`src/server/planner/solve.ts:385`) passes the demand per second (1/hour = 2.8e-4/s).
  `lp.ts:65` scales each row by `1/max(1, max|coef|)`, and HiGHS keeps its absolute primal feasibility tolerance 1e-7
  on the scaled rows. The Polyvinyl Acetate row's largest coefficient is 2,000 L, so the row may be off by
  2,000 × 1e-7 = 2e-4 L/s, more than the 6.2e-5 L/s the mixer needs. S1 comes out 3.3e-5 below the true optimum, and S2
  and S4 then drop the PVA and methyl-acetate chains inside the tolerance. Nothing checks residuals (prior-art §3.4
  step 6 asks for it). The plan is fine at 2/hour and above.
- **Fix.**
  1. `solveLine(graph, demand, opts?)` divides the demand by its largest entry, solves every stage at unit demand and
     multiplies `runs`, `buys`, `sinks`, `rawCost` and the new `leastRawCost` back (audit patch
     `docs/local/planner-audit/patches/A-numerics.patch` A1 is the reference). All absolute thresholds (`TINY`, `ZERO_RAW`, the S3 big-M,
     the `max(1, ·)` tie-break scalings) thereby become per unit of target.
  2. Residual check after the stages (D2), as two exported pure helpers in `solve.ts`:
     `residualViolations(rows: readonly LpRow[], x: readonly number[]): Array<{ row: number; residual: number; scale: number }>`
     and `firstBalanced<T extends { x: readonly number[] }>(stages: readonly T[], rows: readonly LpRow[]): T | null`.
     For a stage solution `x` at unit demand and every good row `g`, `r_g = Σ_j a_gj·x_j − d_g` (purchases and sinks
     included) and `scale_g = max(|d_g|, max_j |a_gj·x_j|)`; the row fails when
     `|r_g| > RESIDUAL_ABS + RESIDUAL_REL × scale_g`. `finish()` passes its stages in the order S4 → S2 → simplified
     base → S1 and uses the first that passes; when that is not S4 it adds
     `PlanWarning { code: 'numerics', key, text: 'The solver could not balance <name> exactly; the plan uses an earlier stage' }`.
     If none passes it keeps S4 and adds the same warning naming the worst good.
- **Decision.** RC suggested "fall back to S1", INV "retry with tighter tolerances". Fall back to the last stage that
  balances (no retry): after the unit-demand solve the worst residual over 204 plans was 1.2e-12, so this is a guard,
  not a code path that runs.

### D2 (critical) The fewest-recipes stage is skipped silently, so one good gets two producers — INV-2, RC2

- **Root cause.** `finish()` locks raw cost at S1's tolerance-deflated objective with no slack
  (`solve.ts:346`, `lockRow` `:268`); the MIP runs at `mip_feasibility_tolerance 1e-10` (`lp.ts:121`) and is
  infeasible; the L1 fallback's support is infeasible too; `simplest()` (`:328`) then returns no S3 and S2/S4 run over
  every recipe within a tolerance-sized lock: molten PE from a reactor and from a bought PE bar, copper plate from a
  solidifier and a cutting saw.
- **Fix.** D1 removes the trigger. The S3 stage is replaced by the step-charge stage (D6), which falls back to today's
  fewest-recipes S3 and, when that fails too, adds
  `PlanWarning { code: 'simplify-skipped', text: 'Could not simplify this plan; it may use more machines than it needs' }`.
  Never skip silently.

### D3 (important) Rates rounded to 9 decimal places: steps, arrows and raw rows disagree — INV-3, RC3, UI-4 (server part)

- **Root cause.** `round9 = Math.round(x·1e9)/1e9` on per-second values: `solve.ts:44/277` (`kept`),
  `machines.ts:43/422` (`buildFlows`, plus an absolute 1e-9/s flow cutoff), `plan.ts:36/345/362` (raw inputs,
  byproducts). A step running 2.2e-8 times per second keeps 2 significant digits; arrows were up to 2 % off their steps
  and real arrows were dropped (65 instead of 70).
- **Fix.** New `src/server/planner/round.ts`: `export function sig9(x: number): number` (9 significant digits, `−0` → 0,
  non-finite → 0). Use it in `kept()` (values ≤ 1e-9 at unit demand are still dropped), again on every value `solveLine`
  scales back (so `runs`, `buys`, `sinks`, `rawCost` keep 9 significant digits at any rate), in `buildFlows` (drop a flow
  when `perSecond ≤ FLOW_DROP_REL × produced`; the target's `out` flow is added when `out > FLOW_DROP_REL × made`, not
  `> 1e-9`), `rawInputsOf` (`perSecond`, `cost`), `byproductsOf` and the `free` of `standaloneCosts`. Counts, EU/t and
  build-list amounts keep their current rounding. `plan.test.ts:281` changes from `0.016666667` to `0.0166666667`.
- Evidence of scale dependence that a unit test can pin: on cd6fcce, Mini-GT circuits at MV planned at `amount: 1e-6,
  per: 'hour'` come back `ok` with **no steps and no raw inputs** (every value fell under the absolute 1e-9 cut-offs);
  1 per hour and 30 per hour plan the same three steps.

### D4 (important) Sand and gravel are no leaves, so glass lines build cobblestone → gravel (by hand) → sand (hammer) — INV-5, RC4, G2, UI-11; relayed request

- **Root cause.** `minecraft:sand@0` and `minecraft:gravel@0` have no GT association, no gathered ore-dictionary name
  (`availability.ts:120` `GATHERED_ORE_PREFIXES`, `:130` `GATHERED_KEYS`) and are not base items, so
  `makeLeafOracle` returns NOT_A_LEAF (`costs.ts:120`); cobblestone is free (`shared/types/plan.ts:24`), so the detour
  costs 0 and wins. The repository's own acceptance test asserts the detour (`real-acceptance.test.ts:37,130`).
- **Decision.** RC4 wanted sand in `FREE_KEYS` (cost 0), INV-5 "leaves no costlier than cobblestone", G2 a gathered
  class at 0.25. **World blocks become gathered (natural) leaves at their normal price, 1 per block (editable by cost
  override).** Reasons: (a) in the prototype, sand at price 0 created new zero-cost chains (Electronic Circuit LV
  19 → 49 steps; PE Bar planned at raw cost 0), at price 1 it did not; (b) a leaf is never expanded by the candidate
  walk, so the cobblestone chain cannot appear once sand is a leaf; (c) the user says cobblestone itself needs a stone
  generator (D5), so cobblestone is no longer free to obtain either. Rule R1.

### D5 (important) Free inputs have no generator, so free detours look free — G5, UI-11; clarification §11.26

- **Root cause.** `FREE_KEYS` are buyable leaves at cost 0 (`costs.ts:119`) with no machine. The rock breaker's export
  recipes are fake (display-only), and air reaches a singleblock only as compressed-air cells.
- **Decision.** Generators are ordinary LP recipes ("supply recipes"), not post-solve decorations, so the step charge
  weighs them and the loop guard, machine counts, power, build list and build steps work unchanged. Rule R2. Make N
  keeps buying free inputs (no generators for a one-off batch).

### D6 (critical) Every step is free: chains grow to save a crumb — G1, INV-6

- **Root cause.** S1 minimizes raw material only; S3 (fewest recipes) only breaks ties within 1e-6 of S1
  (`solve.ts:321`, `:346`). The user's line at 1/min built a 7-recipe vinyl-acetate → PVA → Advanced Glue chain to save
  0.10 % raw material.
- **Decision.** INV proposed a 0.5–1 % relative slack on the S3 lock; G1 a per-step fixed charge of 5 % of the least
  raw material, hand steps ×3, capped at +25 %. **Per-step charge (G1).** Reasons from the prototype: the slack at 1 %
  still left Electronic Circuit LV at 27 steps and took 7.3 s; the charge gave 14 steps in 2.2 s; a charge is
  rate-invariant, weighs hand-crafting, and becomes the build-cost term of plan 10 later. A charge per *machine*
  (machines needed × charge) was also tried and **rejected**: it broke rate invariance on 13 of 17 lines and made the MIP
  unstable; machine counts belong to the build-cost objective of plan 10. Rule R3. The default charge is 2 %, not G1's
  5 % (§10 answer 3: least raw material comes first for the user).

### D7 (important) Hand-crafting wins the power tie-break in rate mode — G6

- **Root cause.** Crafting recipes have 0 EU/t, so S2 (least power) prefers them (gravel by hand instead of the forge
  hammer; 4 hand steps in the LV motor).
- **Fix.** `HAND_STEP_WEIGHT = 3` in the step-charge stage (rate mode, `automateCrafting: false`); any hand step that
  remains gets `PlanWarning { code: 'hand-step', stepId, text: '<product> is crafted by hand: <rate>; mark crafting as automated or pin a machine recipe' }`.
  Make N may hand-craft (weight 1, no warning).

### D8 (important) Pruning removes the simplest route; cell-carrying recipes look expensive — G7 and a new finding

- **Root cause.** `buildCandidates` keeps at most 3 producers within 2× of the cheapest *estimated* raw cost
  (`candidates.ts:77-78`, `:625`). Two defects found while prototyping:
  - `recipeInputCost` (`:348`) charges the Empty Cells an electrolyzer hands on inside the Oxygen Cells it makes, and
    the Dijkstra in `estimateCosts` (`:365`) only runs a recipe once that slot "settles". Oxygen therefore settled at
    12.5 per 1,000 L through a dust electrolysis before the free water route was even looked at, and the MV steel line
    lost its Electric Blast Furnace recipe (20 Bricked Blast Furnaces for 10 steel/min instead).
  - Ranking by raw estimate only drops short routes (sand → molten glass → tube was not in the graph once sand is a
    leaf).
- **Fix.** Rule R4 (carried containers, the simplest producer, step-bounded pruning).

### D9 (important) Molten metals and chemicals are "base" through unreachable underground pockets — RC5, G3, INV-7

- **Root cause.** `isBaseItem(fluid) = sourcedFluids.has(key)` (`availability.ts:211`) ignores reach, contradicting its
  own doc (`:206`, "Molten metals are not base"). Molten copper (Centauri Bb), ethylene (Triton), distilled water
  (Europa) and oxygen are therefore derived *base* items and bought (`costs.ts:126`), while chlorine, ethanol and glue
  are made.
- **Decision.** RC5 Fix D excluded only molten metals; G3 says a fluid is base only where reachable. **G3: a derived
  fluid (molten or not) is never a leaf; a fluid is bought only when a source is reachable (`direct`) or it is free.**
  Consistent with chlorine/ethanol today, and it is what puts a line behind ethylene (the user's request). Rule R5.

### D10 (important) Bought derived materials: circular sources, prices below the mined material, exotic imports — INV-7, RC5 (Fix F), G4, UI-9; clarification §11.27

- **Root cause.** `RawInput.sources` of a derived leaf come from availability's first-found recipe (`availability.ts:537`,
  `why`), often a canner emptying a cell of the same fluid ("Ethylene: made by Canner from Ethylene Cell"); the price is
  the standalone chain behind `GoodInfo.cost` (`pricing.ts:67`), which is never shown and can undercut the mined
  material (molten copper 0.826 per ingot, glass dust 0.00) because only chains the cost model never walked get the
  plain-price floor (`pricing.ts:73`). Any derived material available at the tier is buyable, so an MV line bought
  Epoxid Bars (41 recipes deep).
- **Decision.** Supporting lines by default (`routeDerived: true`, the clarification); with `routeDerived: false`, a
  derived material is bought only when it is shallow (`DERIVED_LEAF_MAX_DEPTH = 4` recipe layers in the availability
  closure), at `max(standalone cost, plain price)`, and every bought one names the chain it stands for. G3's curated
  per-tier stock list is **not** adopted: the depth rule is data-driven and separates stock alloys (red alloy 1,
  soldering alloy 2, annealed copper 2, redstone alloy 3, GaAs 3, aluminium at MV 4) from plastics and petrochemicals
  (PE 6, PVC 6, PTFE 7, epoxid 8, SBR 8) on this export. Rules R6, R7.

### D11 (important) Ore blocks are imports, so lines run ore processing for yield arbitrage — G4

- **Root cause.** Ore blocks and raw ores of reachable materials are `direct` base items at price 1 (`costs.ts:122-124`);
  with derived materials routed, the user's routed line bought Chalcopyrite Ore and ran a washer, chemical reactor and
  electrolyzer to make sulfuric acid and copper.
- **Fix.** Rule R8: ore blocks are leaves only when the target itself is a GT material form.

### D12 (important) An ore-dictionary slot filled from two options is shown as one — INV-4/F7; solder choice (clarification)

- **Root cause.** `stepInputs` keeps only `busiestOption` per multi-option slot (`machines.ts:201,228`), while
  `buildFlows` apportions every option. Robot Arm (LV) routed: the step lists "Molten Tin ×144" while 36 % of the slot is
  soldering alloy; Good Electronic Circuit HV: two coal dust items.
- **Fix.** Rule R9: every option a step uses is listed with its share; `PlanStep.options` explains each multi-option slot
  (raw cost per run, steps its chain needs); `PlanSettings.optionChoice` pins an option.

### D13 (minor) The bold "makes" label and the swap/pin key come from raw amounts — RC8, UI-8

- **Root cause.** `mainOutputOf` (`machines.ts:252`) picks the output other steps consume most by raw amount, so litres
  beat items and returned cells count ("makes Empty Cell", "Pyrolyse Oven makes Water"). It is also the
  `recipeChoice` key.
- **Fix.** `mainOutput` = the target if the recipe makes it, else the output with the largest
  `value = valueOf(key) × (amount the other steps take)`, ignoring an empty container the recipe hands back (a key
  that is the `empty` of some `pack.fluidContainers` entry) unless the recipe makes nothing else, and ignoring a good
  the line buys while the recipe makes another output that the other steps take, that the line does not buy, and that
  is neither a free input (`FREE_KEYS`) nor an empty container the recipe hands back; equal values go to the output the
  other steps take most of, then by key. At an LP optimum a step whose output the line also buys runs for another output
  (making more of the bought good would cost more than buying it, and `withoutTiedPurchases` shuts a tied purchase), so
  naming it after the bought good counted the purchase as the step's use: plan 09 Task 8 found a Bricked Blast Furnace
  run for its Ferrosilite named Copper Ingot beside bought copper (the user's routed line, the EC MV lines), cutting
  machines making Wafers named Poly-Si Dust, reactors making Epichlorohydrin and Epoxid named Salt Water, and R11 said
  those balanced plans did not add up. `StepLine` gets `valueOf?(key): number`, `empties?: ReadonlySet<StuffKey>`
  (those empty containers) and `bought?: ReadonlySet<StuffKey>` (the goods the solution buys, or the Make N batch buys;
  without it no output is passed over for being bought), passed by `planSteps` and `makeN`. `planLine`'s
  `valueOf(key)` = `max(costModel.cost(key) when finite else 0, basis.prices.price(key))`: never below the good's plain
  price, as R7 floors bought derived materials. The cost model splits a recipe's cost between its co-products
  arbitrarily and prices many intermediates 0 (Sulfuric Acid beside Water) or not at all (a Methyl Acetate Cell it never
  walked); at 0 against free Water the litres won, so the user's Electronic Circuit MV step "made Water" and the plan
  warned "Water is both bought and made".

### D14 (minor) A thrown-away filled container makes the line extrude new cells — RC7

- **Fix.** Audit patch `docs/local/planner-audit/patches/E-containers.patch`: when a recipe makes a filled container, the candidate walk
  also adds the pack's recipe that empties it (only consumed input = that container, outputs include its empty
  container, accepted here).

### D15 (important) The build list's totals are absurd and cannot be traced — RC6, UI-7, G9

- **Root cause.** `bom.ts:249` ranks producers by `recipeCost`, which credits co-products (the Advanced Glue mixer is the
  "cheapest" Empty Cell), and `bom.ts:330` rounds whole runs per occurrence: 13,050,000 L hydrogen for 26 MV machines.
- **Fix.** Audit patch `docs/local/planner-audit/patches/G-bom-containers.patch` (rank by gross input cost; never make an empty container
  from a filled one), free inputs are always leaves of the breakdown, and every total carries
  `BomLine.neededFor?: Array<{ key: StuffKey; amount: number }>` (the top-level build lines that need it). Pooling demand
  before rounding and stopping at stocked components (G9) are deferred to plan 10 (§9).

### D16–D22 UI defects — UI-1 … UI-12, RC8 (UI part)

| Id | Defect (code) | Fix (§6) |
|---|---|---|
| D16 | Inputs nothing supplies are invisible: `flowGraph` never compares a step's inputs with its incoming flows (`flow-model.ts:110-140`); `PlanBanner` shows only server warnings (`ProjectPage.tsx:53`) | `indexPlan` (shared), red "no source" stubs, `FlowIssues`, Materials rows, banner summary |
| D17 | Imports are pinned to the first ELK layer (`flow-model.ts:146`), one node per good (`:121-123`), all labelled "raw" | one import stub per (good, consumer) with a leaf word, no layer pin |
| D18 | No way to follow an item (the "wire" question): no ports, no edge hover, only box clicks (`FlowView.tsx:99-111,187-202`), view opens at 0.6 from the top left (`:24,50-58`), step panel lists no inputs/outputs | item ports, focus mode, Find, Takes/Makes, initial view on the target |
| D19 | Tiny rates print as 0, fluids lose "L" (`flow-model.ts:73-83`, `materials-model.ts:43-48,146`, `MaterialsView.tsx:28-33`) | one formatter in `src/shared/format.ts` |
| D20 | A good made by two steps is never flagged | `multi-producer` issue, badges, "Keep only …" |
| D21 | "Make it here instead" gives no feedback and can break the plan (`StepPanel.tsx:259-266`) | `plan-diff.ts` "What changed" note; `RawInput.canMake` disables the button |
| D22 | Titles "1× …" clash with GT names and clip (`flow-model.ts:24,119`); "0% busy"; derived banner names only 5 (`plan.ts:301`); `ItemIcon` tooltips show keys | titles = machine name, widths from text, `formatPercent`, banner chips, `ItemIcon name` |

### D23 (important) Tests encode the bugs and never plan per hour — INV-8, RC9, G12

- `real-acceptance.test.ts` accepts molten copper, cobblestone, ethylene and a non-existent `fluid:molten.polyethylene` in
  `ORDINARY`, asserts cobblestone > 0 (`:130`), and nothing plans per hour. Fix: §7.

### D24 (minor) Tie-breaks pick odd variants; dominated pins are silent — G10

- **Fix.** Canonical rank (R10) and a `pin-dominated` warning: when `recipeChoice` pins the step's recipe and the step's
  cheapest alternative's `rawCost` is below the pinned one's divided by `PIN_DOMINATED_SHARE`, add
  `PlanWarning { code: 'pin-dominated', stepId, key, text: '<name>: the pinned recipe uses <a> raw per unit; <machine> makes it for <b>' }`
  (the user's resistor pin `0a074f4241a9e0f9`: 0.783 vs 0.533 for `18e6aa1b52bd8b5c`).

### Not code defects

- INV-9 / UI-13 (shared worktree edited during the audit) and timing noise: run before/after comparisons from private
  copies. G11 (machine tier choice at <0.3 % utilization) and UI-10's machine sharing (`PlanStep.shareGroup`) are build-cost
  questions → plan 10.

---

## 5. Planner rules (new or changed)

### R1 Gathered world blocks are natural leaves (D4)

`availability.ts` exports
```ts
export const GATHERED_BLOCKS: Readonly<Record<StuffKey, string /* DimensionInfo.key */>> = {
  'minecraft:sand@0': 'overworld', 'minecraft:sand@1': 'overworld', 'minecraft:gravel@0': 'overworld',
  'minecraft:dirt@0': 'overworld', 'minecraft:clay@0': 'overworld', 'minecraft:flint@0': 'overworld',
  'minecraft:sandstone@0': 'overworld', 'minecraft:snowball@0': 'overworld', 'minecraft:snow@0': 'overworld',
  'minecraft:ice@0': 'overworld', 'minecraft:packed_ice@0': 'overworld',
  'minecraft:netherrack@0': 'nether', 'minecraft:soul_sand@0': 'nether', 'minecraft:end_stone@0': 'theend',
};
```
A key of this table whose dimension is in `env.reachable` is a seed of the availability fixpoint and
`classOf` → `'natural'`; `sources` → `[{ kind: 'natural', dims: [dim], detail: 'gathered (dig it)' }]`. Price: the normal
`makePrices` price (1 for these non-GT items), cost overrides apply. Out of reach (End stone below HV): the block is
classified as today. Stone (`minecraft:stone@0`) is **not** gathered: the rock breaker supply recipe makes it (R2).
Mob drops (ender pearl, blaze rod, ghast tear) are deferred (§9).

### R2 Free inputs are made by supply recipes unless the group has a supply (D5) — architecture §11.26, §11.31

New `src/server/pack/supply.ts`, called by the loader (`load.ts` `addDerivedRecipes`, before `setIndices`) and by
`tests/helpers/pack-spec.ts` `packFromSpec`:
```ts
export const SUPPLY_PUMP_MAP = 'pump';
export type SupplyKind = 'rock-breaker' | 'pump' | 'compressor';
/** Derived supply recipes and the pseudo map/machine changes they need; pure, deterministic, ids from recipeId(). */
export function deriveSupply(input: {
  recipes: readonly Recipe[]; machines: ReadonlyMap<number, Machine>; maps: ReadonlyMap<string, RecipeMapInfo>;
  fluidContainers: ReadonlyArray<{ container: ItemKey; empty: ItemKey | null; fluid: FluidKey; amount: number }>;
}): { recipes: Recipe[]; pumpMap: RecipeMapInfo | null; pumpMachines: number[]; flagged: string[] /* ids given meta.supply */ };
```
1. **Rock breaker.** Every recipe with `flags.fake`, map `gt.recipe.rockbreaker`, one output with chance 1 and whose
   consumed inputs are only GT display items (item id `gregtech:gt.metaitem.02`, meta 32765, any NBT) becomes a derived
   recipe: same output, EU/t, duration, amps and map; those inputs removed (other inputs kept); `source: 'derived'`;
   `flags: {}`; `meta: { ...meta, supply: 'rock-breaker' }`. On the 2.9 export: cobblestone (`a14f274af9828b6f`, 30 EU/t,
   16 t) and stone (`0949e06c46365321`).
2. **Pump.** When some machine's class simple name is `MTEPump` (2.9: Basic/Good/Advanced Pump, mteIds 1140–1142), add the
   pseudo map `{ id: 'pump', name: 'Pump', amps: 1, specialValue: 'none', aliases: [] }`, add `'pump'` to those machines'
   `maps`, and two recipes: no input → 1,000 L `fluid:water` (resp. `fluid:lava`), 8 EU/t, 80 ticks,
   `meta.supply: 'pump'`, `source: 'derived'`. (Normal singleblock overclocking then gives 40 ticks at MV, 20 at HV.)
3. **Compressed air.** A non-fake recipe whose only consumed input is an empty container `E` and whose only output is a
   container `C` with a `fluidContainers` entry `{ container: C, empty: E, fluid: f }`, `f ∈ FREE_KEYS`, gets
   `meta.supply: 'compressor'` (2.9: compressor `3d9ddb7951ccf2ae`, Empty Cell → Compressed Air Cell). The canner that
   empties it (`744cddf12c4742fa`) stays a normal recipe.

Planner:
- `PlanSettings.haveSupply?: StuffKey[]` (default `[]`).
- `planBasis` computes `supplied: ReadonlySet<StuffKey>` = the free keys `k` with `settings.mode === 'rate'`,
  `k ∉ haveSupply`, and at least one `meta.supply` recipe that makes `k` (or makes a container whose `fluid` is `k`) and
  `acceptRecipe(…, env).ok`. `makeLeafOracle(pack, settings, avail, prices, stopCost?, derivedCost?, opts?: { supplied?: ReadonlySet<StuffKey> })`
  returns NOT_A_LEAF for `leafClass === 'free' && supplied.has(key)`. A free key with no supply machine at the tier
  (ULV) or in Make N stays a free leaf. `classOf` stays `'free'`.
- `LpRecipe.supply?: true` (from `Recipe.meta.supply`); `sourceColumns` (`solve.ts:284`) counts supply recipes as
  sources, so the loop guard never bans them (a zero-raw line such as Nitrogen from air stays `ok`).
- `PlanStep.supply?: StuffKey` = the free good the step's supply recipe makes (for the compressor: the container's
  fluid).
- Build steps (`steps.ts`, `configure` kind, id `configure:<stepId>`): rock breaker "Place water and lava next to the
  <machine> that makes <good>"; pump "Put the <machine> over an infinite water source (a 2×2 pool)" (lava: "over a lava
  pool"). Compressor needs none.
- Breakdowns (`bom.ts` `expandWith`): `FREE_KEYS` are always leaves (no generator for one-off build materials).

### R3 Steps vs raw material: the step charge (D6, D7, D2) — architecture §11.34

`PlanSettings.stepCharge?: number` (default `DEFAULT_STEP_CHARGE` = 0.02, §10 answer 3). `solveLine(graph, demand, opts: SolveOptions = {})` with
```ts
export interface SolveOptions {
  /** Share of the least raw material (S1) one recipe step must save to be built; 0 = least raw material, fewest recipes as tie-break. */
  stepCharge?: number;
  /** Weight of a crafting-table step: HAND_STEP_WEIGHT in rate mode with automateCrafting off, else 1. */
  handWeight?: number;
  /** S1 only: whether the line plans and its least-raw solution (avoid trials, below). */
  probe?: boolean;
}
```
`planLine` passes `{ stepCharge: settings.stepCharge ?? DEFAULT_STEP_CHARGE, handWeight }`.

Stages at unit demand (replacing `simplest()` when `stepCharge > 0` and `S1 > 1e-9`):
1. **S1** as today → `x¹`, `S1* = objective`.
2. **Charge MIP.** Columns: the main LP's + one binary `y_r` per step recipe (`kind === 'recipe'`) + one binary per
   bought derived leaf (as today's `fewestRecipesMip`). Objective:
   `Σ_j (rawCost_j / S1* + tb_j + CANON_RANK_S3 × rank(j) × u_j / S1*) · x_j + stepCharge × Σ_r w_r · y_r + Σ_d S3_DERIVED_STEP × n_d · y_d`,
   where `tb` = `tieBreaks(lp, x¹)` (free input, power), `w_r` = `handWeight` for `mapId === 'crafting'` else 1,
   `rank` per R10, and `u_j` = `rawCost_j` for a purchase and 1 for an ore-dictionary conversion (one slot filled counts
   as one unit of raw material: a conversion costs no raw material, and R10 weighs a rank-1 convert option; S4 also
   weighs a conversion per run). Rows: main rows; `Σ rawCost·x ≤ (1 + STEP_CHARGE_CAP) × S1*`; `x_r ≤ STEP_BIG_M × max_j x¹_j × y_r`;
   derived purchase links as today. `integer` on the binaries, `maxNodes: STEP_MIP_MAX_NODES`, MIP start (`LpModel.start`,
   passed to HiGHS `setSolution`) = the better, by this objective, of `x¹` and a sparse plan within the cap (today's
   reweighted-L1 `fewestRecipes` under `Σ rawCost·x ≤ (1 + STEP_CHARGE_CAP) × S1*`, then S1 over its support), with
   `y = 1` where the start runs a column above `TINY`, else 0 (plan 09 Task 8: from `x¹`, the most steps a plan of the
   line has, the root node stopped on the user's line at 19 steps and +11 % raw material where 24 steps at +0.05 %
   charge less; from the sparse start it finds them). A `feasible` (node-limited) result is accepted.
3. **Fallback.** No MIP solution → today's fewest-recipes S3 with the exact lock; nothing → `simplify-skipped` (D2).
4. **Consolidation.** For each good that is the `main` of 2+ recipes left in the support, try each minority producer:
   re-solve S1 over the support without it; keep the removal when
   `raw/S1* + stepCharge·Σw` improves. (Cheap: one LP per minority producer.) Then each priced purchase of a good a step
   recipe of the support makes is shut when the line does without it at no more raw material (within `S3_TOLERANCE`;
   one the base does not use, at once), so S2 and S4 never buy a good beside the step that makes it at a tie (R11
   `bought-and-made`; plan 09 Task 8: an Electric Blast Furnace run for its carbon dioxide made a share of the copper
   ingots an HV circuit line bought).
5. **Base and later stages.** `off` = every step recipe not in the support; base = S1 over the support; lock raw ≤ base;
   S2 (power) and S4 (canonical, R10) within the support, as `finish()` does now.

`stepCharge === 0` ("Least raw material") keeps S3's aim, fewest recipes among the least-raw plans and its free-input
and power tie-breaks, but solves it with steps 2–5 held at the least raw material (Task 4 review): cap 0
(`Σ rawCost·x ≤ S1*`, so the base and consolidation stay within `S3_TOLERANCE` of S1), every step recipe weighing
`LEAST_RAW_STEP` (0.01) whether crafted by hand or not, and today's fewest-recipes S3 as the fallback. A recipe then
weighs ten times the least-raw plan's free-input tie-break (`S3_FREE_SHARE`): one more recipe wins only where the fewer
would take over ten times that free input. A line whose S1 needs no raw material keeps today's S3. The reason is
time: over the larger graphs of R4's pruning, S3's two fewest-recipes MIPs (5,000 nodes each) took up to 14 s on the
§7.2 corpus at 0 % and 181 s on the user's settings at Advanced Circuit HV, where the root-node MIP from S1 plans every
one in under 3 s within 2 steps of S3's count (34 corpus lines: 32 the same, 2 one or two fewer); a weight of 0.05–1
made HiGHS's root node take 5–14 s on one of those lines. `solveLine` without `opts.stepCharge` behaves as 0;
`planLine` passes the setting to every `solveLine` call it makes.

**Avoid lists (§11.25, plan 08, merged after this audit).** The charge MIP makes one full solve cost ≈ 1.4 s on an HV
circuit line (prototype, Good Electronic Circuit HV 2/min, warm pack, load ≈ 6: 1.85 s per plan of which 1.37 s MIP; the
old rules took 0.66 s), and plan 08's `avoidingLine` solves the line again for every trial. So
`SolveOptions.probe?: boolean` solves S1 only (status, runs, buys, sinks, `rawCost`; no later stage, no MIP), and:
- when the settings avoid any good, `planLine`'s plain solve is a probe; `avoidingLine` runs every trial as a probe and
  fully solves only the graph it returns (the open graph when the probe used no avoided good);
- whenever the graph it returns is the open graph (the probe used no avoided good, or nothing at the tier does without
  what the probe used) and that full plain line uses an avoided good, or buys a derived leaf made from one, that the
  search did not count (a tie the probe broke the other way, or the charge buying a derived leaf made from a good whose
  own chain the probe ran), `avoidingLine` continues from the full line as if the plain line had used it, so every use
  is listed in `Plan.avoided` and flagged (§11.25). A trial's graph holds only what it allowed back, so only the open
  graph needs this check.
A plan with an avoid list then costs one full solve plus cheap probes, like a plan without one (two full solves when
the search goes on from the full line).
`Solution.leastRawCost` (S1*, scaled back) and `Plan.rawCost?: { perSecond: number; leastPerSecond: number }` report the
trade-off.

### R4 Pruning keeps the simplest route (D8)

In `candidates.ts`:
- A consumed slot whose every option is **carried** (an empty container `E` such that the recipe outputs a filled
  container `F` whose `fluidContainers.empty` is `E`, and the line can empty `F` back into `E`: D14's emptier of `F` is
  accepted here and uses no avoided good) costs 0 in `recipeInputCost`, is not counted in `estimateCosts`' `open` slots
  (it never blocks the recipe) and does not count against the recipe in `grounded`. A filled container nothing here
  empties leaves the line with its container, so its slot is charged like any other (Task 4 ruling: priced at 0, the
  estimate pruned every priced producer of the good that was not the simplest, and a steel line made new cells from tin
  at 31 raw where 13.5 was possible).
- A second settle pass over the same reached recipes computes `stepsTo(good)` (leaves 0; a recipe = 1 + Σ of `stepsTo`
  over the goods its consumed non-carried slots take at their cheapest option, each good once: a crafting recipe lists
  each grid slot on its own, and 8 plate slots would count the plate's chain 8 times; minimum over producers; integers,
  same heap order rules; a recipe with a slot that has no priced option never runs in this pass).
- `expand(key)`: after `cheapest(...)`, also keep the accepted producer with the fewest steps (ties: estimate, then
  canonical rank of its inputs, then id); then drop any kept producer whose steps exceed the simplest producer's by more
  than `MAX_EXTRA_PRODUCER_STEPS`, unless it is the cheapest by estimate. A producer whose steps are unknown (the steps
  pass never settles its chain, as where the cheapest options of a loop wait on each other) is never the simplest and is
  not dropped for its steps: they are not known to be longer.
- `cheapest()` breaks equal costs by canonical rank (R10) before id (also for ore-dictionary options in `addVirtual`), so
  `minecraft:log@0` is not pruned in favour of a modded log that sorts first.

### R5 Fluids are bought only where a source is reachable (D9)

`makeLeafOracle` case `'derived'`: `if (isFluidKey(key)) return NOT_A_LEAF;` — in both `routeDerived` modes. Update
`isBaseItem`'s doc: a sourced fluid counts as base only where a source is reachable (`direct`); derived fluids are made.

### R6 Supporting lines and the derived-material modes (D10) — architecture §11.27, §11.32

- `defaultSettings().routeDerived = true`. Label in the settings panel: "Plan supporting lines for alloys, plastics and
  chemicals (off: buy the shallow ones)". Projects stored before plan 09 are switched to `true` once by the recorded
  `'Planner update'` op of §3 (keyed on `PlanSettings.settingsVersion`, §10 answer 2).
- `routeDerived: false`: a derived base item is a leaf only when `avail.depth(key) ≤ DERIVED_LEAF_MAX_DEPTH`. New
  `Availability.depth(key): number` = recipe layers from the seeds along availability's first-found recipes (`why`): a
  seed has depth 0; a good first made by recipe `r` has depth `1 + max over r's consumed slots of the smallest depth
  among that slot's available options`; memoized per state; a cycle counts 0.
- `PlanStep.line?: { key: StuffKey; name: string }`, computed by new `src/server/planner/lines.ts`
  `supportingLines(pack, plan, basis): Map<string /* stepId */, { key: StuffKey; name: string }>`:
  1. `material(g)` := `g ≠ target` ∧ `avail.classOf(g) === 'derived'` ∧ (`g` is an item with GT prefix in
     `BASE_PREFIXES`/a material base part, or `g` is a fluid).
  2. Candidate roots: goods `g` with `material(g)` that some step has as `mainOutput` and that flow to `out` or to a step
     whose `mainOutput` is not a material.
  3. `lineOf(step)`: its `mainOutput` if that is a root; else the common line of all the steps its outputs flow to (flows
     to `sink` ignored; `out` or two different lines → main line, `undefined`); memoized, cycles → main line.
  4. Drop roots that are fluids whose line has one step (molten glass, refined glue, glue stay in the main line);
     recompute 3.
  5. `name`: the root's GT material display name (`pack.materials.get(m)?.displayName ?? m`) for GT items and
     `fluid:molten.*`, else `pack.nameOf(root)`.
  Prototype (an earlier variant of this rule that counted only solid base forms as roots) on the user's routed line:
  main line 16 steps; 7 supporting lines of 1–3 steps (Redstone Alloy 3, Annealed Copper 2, Charcoal 2, Steel, Red
  Alloy, Soldering Alloy, Wood Pulp 1 each). With fluids as roots the molten-alloy extractors join their alloy's line.
- "We already make this" on a line puts its root key in `stopItems` (existing mechanism).

### R7 Bought derived materials: price floor and provenance (D10) — architecture §11.36

- `pricing.ts` `derivedCosts`: the in-model results are floored too: `cost = max(standalone.cost, prices.price(key))`.
- `Standalone` (solve.ts) gains `recipes: string[]` (step recipes of the standalone solution, largest runs first) and
  `top?: string` (the recipe that makes most of the key, skipping container moves: a recipe whose only consumed input is
  a filled container of the key's fluid, or that only fills one).
- `RawInput.pricedVia?: { recipeId: string; mapId: string; inputs: StuffKey[]; steps: number }` for derived and stop
  leaves (from `top`; `inputs` = first option of each consumed slot; `steps = Standalone.steps`).
- A derived raw input's source detail is `made by <map name> from <input names> (<n> recipe(s) in all)` from `pricedVia`;
  without it, availability's `why` with container round trips skipped (audit patch `F-source-text.patch`).
- `RawInput.canMake?: boolean` = some accepted recipe of the pack makes the key at this tier (`pack.producers` ∩
  `acceptRecipe(…, env).ok`); false for free and gathered goods.
- The `derived-leaf` warning lists every derived leaf (drop `MAX_NAMED_DERIVED`'s cut-off from the text; the client
  shows chips) and says "Plan them as supporting lines" instead of "Turn on 'plan derived materials'".

### R8 Ore blocks are imports only for material lines (D11)

In `makeLeafOracle` cases `direct`/`byproduct`: a key whose GT prefix satisfies `isOrePrefix` or that is a material's
`ore`/`rawOre` part is NOT_A_LEAF unless the target is an item whose GT prefix starts with one of `ORE_LINE_PREFIXES`.
(Precompute the ore-part set once per pack.)

### R9 Ingredient options (D12) — architecture §11.35

- `stepInputs` lists, for a multi-option consumed slot, every option whose convert recipe ran, with
  `amount = option.amount × slot.chance × share`, `share = runs(option) / Σ runs(options of that slot)`; the slot's
  `chance` field is the slot's chance when one option is used, else `expected / nominal`.
- `PlanSettings.optionChoice?: Record<string, StuffKey>`, key `${recipeId}#${slot}` (`Ingredient.slot`). In
  `addRecipe`, a pinned slot whose value is one of its options becomes a single-option slot (no virtual good); a pin whose
  recipe or option no longer exists adds `PlanWarning { code: 'stale-option', key: <pin key>, text }` and is ignored.
- `PlanStep.options?: StepOption[]`:
```ts
export interface StepOption {
  slot: number; pinned?: StuffKey;
  choices: Array<{ key: StuffKey; amount: number /* per run */; share: number /* 0..1 in this plan */;
    rawPerRun: number /* amount × cost-model cost */; steps: number /* its standalone chain's recipes; 0 for a leaf */;
    via?: string[] /* map names of that chain, at most 3 */ }>;
}
```
  The step charge applies to options automatically (the chain behind an option is steps in the LP).

### R10 Canonical members win ties (D24)

`canonicalRank(key)` (exported from `candidates.ts`; `rank` below) = 0 when the key has no `#` and its mod id is `minecraft` with meta 0, or `gregtech` or `IC2` (any meta), or it
is a fluid; else 1. Used by `cheapest()` (R4), by the charge MIP (`CANON_RANK_S3` per unit of a rank-1 purchase or
convert option, relative to raw cost: a purchase's raw cost, one unit per run of a conversion, R3) and by S4 (`canonical[j] += CANON_RANK_S4 × rank`). Effect: Oak Wood over "Sacred
Oak Log"/"Bloodwood", Sand over Red Sand.

### R11 Integrity warnings from one shared index (D16, D20) — architecture §11.33

New pure `src/shared/plan/balance.ts` (no `node:*`):
```ts
export type PlanIssueCode = 'orphan-input' | 'short-input' | 'multi-producer' | 'bought-and-made';
export interface PlanIssue { code: PlanIssueCode; key: StuffKey; stepId?: string; stepIds?: string[]; share?: number[]; needPerSecond?: number; gotPerSecond?: number }
export interface PortSide { perSecond: number; peers: Array<{ node: string /* step id | 'raw' | 'out' | 'sink' */; perSecond: number }> }
export interface PlanIndex {
  inputs: Map<string, Map<StuffKey, PortSide & { needPerSecond: number }>>;   // step → good → what flows in
  outputs: Map<string, Map<StuffKey, PortSide>>;                              // step → good → what flows out
  producers: Map<StuffKey, Array<{ stepId: string; perSecond: number; share: number; main: boolean }>>;   // largest first
  issues: PlanIssue[];                                                        // sorted by code, then key, then stepId
}
export function indexPlan(plan: Plan): PlanIndex;
/** The §6.4 text of an issue: names from `plan.names`, machines and products from `plan.steps`, rates per hour (§6.1). */
export function issueText(issue: PlanIssue, plan: Plan): string;
```
- `orphan-input`: a step input with `need > 0` and `got ≤ ORPHAN_REL × need`; `short-input`: `got < SHORT_INPUT_SHARE × need`;
  `multi-producer`: a good that is the `mainOutput` of 2+ steps (shares by produced amount); `bought-and-made`: a good with
  a `raw` flow that is some step's `mainOutput`. A good several steps make only as a by-product is not an issue.
- `planLine` runs `indexPlan` on the finished plan (in `assemble`, after `plan.names`) and adds one `PlanWarning` per
  issue (`code` as above, `key`, `stepId` of the consumer or the largest producer, optional `stepIds`, `share`;
  `text = issueText(issue, plan)`). `PlanWarning` gains optional `stepIds?: string[]` and `share?: number[]`. The client
  runs the same functions as a guard and prefers server texts.
- `Plan.target?: StuffKey` and `Plan.targetPerSecond?: number` (the client stops inferring the target from flows).

---

## 6. UI changes (files and behaviour)

Reference prototype (non-normative, scratch): `audit/uirun/iso/src/client/views/{quantity.ts,plan-index.ts,flow-graph.ts,FlowView2.tsx}`,
patch `audit/uirun/ui-prototype.patch`, screenshots `audit/uirun/shots/proto-*.png`.

### 6.1 Numbers: `src/shared/format.ts`

One pure formatter (no DOM, no `node:*`), so the server's warning texts (§6.4, `issueText`) and the client print numbers
the same way. `src/client/format.ts` (today only `localTime`) re-exports it.
```ts
export function formatNumber(x: number): string;     // 0 → '0'; |x| ≥ 1000 → en-US whole ('13,050,000'); else ≤ 3 significant digits; never exponent or '-0'
export function formatDuration(seconds: number): string;   // s < 60 s; min < 3600 s; h < 48 h; days < 730 days; else years; 3 significant digits
export function formatRate(perSecond: number, per: 'min' | 'hour', opts?: { fluid?: boolean; noun?: [string, string] }): string;
export function formatPercent(f: number): string;    // 0 → '0%'; < 0.001 → '<0.1%'; < 0.01 → one decimal; > 0.999 and < 1 → '>99.9%'; > 0.99 and < 1 → one decimal; else whole (a share below 1 never reads '100%')
```
`formatRate`: `amount = perSecond × (60 | 3600)`; `amount ≥ 0.01` → `${formatNumber(amount)}${fluid ? ' L' : ''}${noun ? ' ' + noun[1] : ''}/${per === 'min' ? 'min' : 'h'}`;
`0 < amount < 0.01` → `1${fluid ? ' L' : ''}${noun ? ' ' + noun[0] : ''} every ${formatDuration(1 / perSecond)}`; `≤ 0` →
`0/h` (`0/min`). `flow-model.ts` re-exports `formatRate` and `formatNumber`. Used by the flow rows and labels, `StepPanel`,
`RawPanel`, `ocLines` ("needed: 1 run every 373 days → 1 machine, <0.1% busy"), Materials (`runRows`, `LeftOverSection`) and
issue texts. `MaterialsView.quantity()` loses its rate branch; counts of things to build keep `amountText` but fluids get
" L", never "×". `steps.ts` `amountText` writes "L" for fluids.

### 6.2 Flow diagram (`src/client/views/flow-model.ts`, `FlowView.tsx`, `styles.css`)

- **Nodes.** `FlowNode.kind` ∈ `'step' | 'import' | 'missing' | 'sink' | 'out' | 'line'`; `FlowNode.rows: FlowRow[]`;
  `FlowRow = { side: 'in' | 'out'; key: StuffKey; port: string /* `${nodeId}|${side}|${key}` */; name: string; rate: string; main?: boolean; issue?: PlanIssueCode; share?: string }`.
  - Step box: title = machine name (no count prefix); line `<tier> · <EU/t> EU/t · <n> machine(s) · <formatPercent busy>`;
    then input rows (port on the left edge) and output rows (port on the right, main output first and bold);
    `data-port`, `data-key`, `tabIndex=0`, `role=button`, `aria-label` "makes <name> <rate>: show where it goes"
    (inputs: "takes … : show where it comes from"); width from text clamped to 190–330 px, ellipsis, full text in
    `<title>`; supply steps show "supplies <good>"; hand steps "by hand".
  - Import stub per raw flow: id `import:<key>@<stepId>`, title = name, one out row with `LEAF_WORD[leafClass]`
    (`free` "free", `direct` "mined", `byproduct` "ore byproduct", `derived` "bought (made elsewhere)", `natural`
    "gathered", `stop` "supplied (we make it)", `unavailable` "not reachable"), CSS class `leaf-<class>`.
  - Missing stub per `orphan-input`/`short-input` issue: id `missing:<key>@<stepId>`, row "no source in the plan" or
    "short", red dashed, edge into the step's input port.
  - Sink stub per producer: `sink:<key>@<stepId>`, row "left over".
  - Supporting lines: an ELK compound node `line:<rootKey>` titled "<name> line" holding its steps; collapsible into a
    single node of kind `line` whose rows are its root output and its inputs from outside; default collapsed when the
    plan has more than 25 steps. Root option `'elk.hierarchyHandling': 'INCLUDE_CHILDREN'`.
- **Edges.** port to port (`sources:[fromPort]`, `targets:[toPort]`); ports `elk.portConstraints: FIXED_POS`. Label: none
  when both ends have one edge; rate-only when a port has 2+ edges; `name · rate` while highlighted. Every edge has a
  10 px transparent hit path and a `<title>` "name · rate · From → To".
- **ELK options.** No layer constraint for imports (an optional toolbar toggle "Imports in one column" restores
  `FIRST`); `out` keeps `LAST`; add `elk.layered.cycleBreaking.strategy: DEPTH_FIRST` and
  `elk.layered.considerModelOrder.strategy: NODES_AND_EDGES` (nodes and edges sorted by id). Amend web-stack §7.
- **Focus mode.** `type Focus = { kind: 'item'; key } | { kind: 'node'; id } | { kind: 'edge'; id } | null` in
  `FlowCanvas`; pure `focusSets(graph, focus): { nodes; edges; ports; producers; consumers } | null` in `flow-model.ts`.
  Item: every edge and row of that key, the boxes that make it (`producers`) and take it (`consumers`); node: its edges and
  their other ends; edge: the edge, its ports and boxes. Hover = transient focus, click pins (a box click also opens its
  panel), Esc or an empty-canvas click clears, Enter/Space on a focused row pins. Classes: canvas `focusing`, others `dim`
  (opacity .18), producers solid accent outline, consumers dashed, lit edges 3 px accent.
- **Find item.** Toolbar `<select aria-label="Find item">` of every good in the plan by name; choosing pins item focus and
  centres its first producer (`centreOn(node, view)`); shared with "Show" buttons.
- **Issues.** A `FlowIssues` box above the canvas (red with any `orphan-input`, else amber), one line per issue with
  **Show**; multi-producer lines also **Keep only <bigger producer>** (sends `recipeChoice[key] = recipeId`).
- **Initial view.** Zoom 0.9 centred on `out`; Fit unchanged. Legend: owned / partly owned / new, import (mined,
  gathered, bought, free), no source, left over, supporting line.

### 6.3 Panels (`src/client/views/StepPanel.tsx`)

- Header = machine name; `PortsSection` "Takes"/"Makes": per row icon, name, rate (shortfall in red) and its peers
  ("from Wiremill (1x Annealed Copper Wire) 1/h", "to Assembler (Resistor) 1/h · Assembler (Vacuum Tube) 0.5/h");
  hovering focuses the item, clicking a peer selects that step.
- `AlsoMadeBySection` (multi-producer): "Advanced Fluid Extractor makes 2.1 % of Molten PE (from a bought PE Bar)" +
  **Use only this recipe for <good>** (recipeChoice).
- `OptionsSection` (step has `options`): per slot the choices with "<rawPerRun> raw per run, <steps> extra steps (via …)",
  the chosen one marked, radio **Pin this option** (writes `optionChoice`), **Let the planner choose**; explanation line
  "Molten Soldering Alloy chosen: 0.50 raw per circuit vs 1.00 for Molten Tin; needs Alloy Smelter + Fluid Extractor".
- `SupplySection` (`step.supply`): "Supplies <good> for this line" + **We already have a supply of <good>** (adds to
  `haveSupply`).
- `LineSection` (`step.line`): "Part of the <name> line" + **We already make <name>** (adds the root to `stopItems`).
- `StopSection` renamed "Supply it from outside": **Import <name> instead** (`stopItems`); `SwapSection` gains a last
  radio "Import it (counted at N raw/unit)" with the same patch, and a tooltip on "raw/unit": "raw-material units per unit
  made (1 base item, 144 L molten metal or 1,000 L other fluid = 1)".
- `RawPanel`: header "Import · <leaf word> · <total rate>" with fluid units; **Used by** list (machine + product + rate;
  hover focuses the edge, click selects); priced-via text "Bought: usually made by <machine> from <inputs> (<n> recipes)";
  **Make it here instead** (`expandItems`) for direct/byproduct/derived, disabled with "Nothing at <tier> makes <name>"
  when `canMake === false`; for free inputs bought because of `haveSupply`: **Plan its generator again** (removes it).
- Pure patch builders (testable without DOM) in `flow-model.ts`: `useOnlyPatch(settings, key, recipeId)`,
  `importInsteadPatch(settings, key)`, `makeHerePatch(settings, key)`, `haveSupplyPatch(settings, key, on)`,
  `optionPatch(settings, recipeId, slot, key | null)`.

### 6.4 Banner, Materials, What changed, Settings

- `PlanBanner` (`ProjectPage.tsx`): one summary line from the integrity issues ("This plan does not add up: 2 inputs have
  no source, 1 good is made two ways — Show in the flow"); the derived-leaf warning as chips (each focuses its import)
  plus, when `routeDerived` is false, **Plan them as supporting lines** (sends `routeDerived: true`); a cost line from
  `Plan.rawCost`: "Uses <x>% more raw material than the least possible to save machines (Steps vs raw material: <preset>)".
  Warning texts (`issueText`, shared; `<machine>` = the step's machine name, `<product>` = its `mainOutput`'s name,
  `<rate>` = `formatRate(…, 'hour')`, `<pct>`/`<share>` = `formatPercent`): orphan "Nothing supplies <good> to <machine>
  (<product>): it needs <rate> and the plan neither makes nor buys it."; short "<machine> (<product>) gets only <pct> of
  the <good> it needs."; multi "<good> is made <n> ways: <A> (<share>) and <B> (<share>)." (more than two: "<A> (<share>),
  <B> (<share>) and <C> (<share>)"); bought-and-made "<good> is both bought (<share>) and made by <machine>."
- Materials (`materials-model.ts`, `MaterialsView.tsx`): `runRows` amounts per hour via `formatRate` (fluids "L", never
  "0.00"), cost likewise; `RunRow.usedBy: Array<{ stepId; label; rate }>` rendered as chips with **Show in flow** (sets item
  focus through new `src/client/state/flow-focus.ts` and switches to `#flow`); `missingRows(plan, index)` listed first
  with badge "no source in the plan"; totals expand to their `neededFor` lines.
- `src/client/views/plan-diff.ts`: `planChange(prev, next): { importsAdded; importsRemoved; stepsAdded; stepsRemoved; issuesNew }`
  (steps by `recipeId`, imports by `key`); `project-store.ts` keeps `previousPlan` when a plan with another
  `settingsHash` replaces it; a dismissible "What changed" note above the canvas and in Materials.
- Settings panel: **Steps vs raw material** select (presets of §3; a custom stored value shows as "Custom (x%)");
  **We already have a supply** list (`haveSupply`, remove buttons); **Pinned ingredient options** list (`optionChoice`,
  remove); `routeDerived` label per R6.
- `ItemIcon` gets an optional `name` prop (tooltip and `aria-label`), passed by every view. Build-list rows read "for
  Resistor, Vacuum Tube, …" (server `BomLine.why`) and Programmed Circuit rows "Programmed Circuit (config N)".

---

## 7. Acceptance criteria (tests)

All commands from the repository root. Real-data tests: `GTNH_LOCAL=1`, skipped elsewhere.

### 7.1 Unit tests (Mini-GT and inline `packFromSpec` fixtures; run everywhere)

| File | What it proves |
|---|---|
| `tests/unit/planner/numerics.test.ts` | Mini-GT circuits at MV planned at `amount` 30, 1 and 1e-6 per hour give the same step ids `['circuit-mv','extract-iron','wire']`, the same 6 flows (one into `out`) and rates in exact proportion (1e-9 relative) — fails on cd6fcce, where 1e-6/h comes back with no steps; every `runsPerSecond`, flow, raw input and byproduct value `v` satisfies `Number(v.toPrecision(9)) === v`; per good, made + bought − taken − sunk − demand is within 1e-8 of the sum of those terms (each keeps 9 significant digits, rounded at unit demand and again when scaled back); the exported pure helpers `residualViolations(rows, x)` and `firstBalanced(stages, rows)` reject an off-by-1e-3 row and pick the earlier stage |
| `tests/unit/shared/balance.test.ts` | `indexPlan` on a synthetic plan: orphan PVA→mixer, multi-producer plate [solid 99.9 %, saw 0.1 %], short glue→assembler 99.2 % flagged; 99.6 % not flagged; a by-product Empty Cell from two steps not flagged; peers largest first; `issueText` gives the §6.4 texts for each code |
| `tests/unit/planner/leaves.test.ts` | R1: sand gathered → glass tube at MV is `[extract-glass, solidify-tube]` with Sand `natural`, no cobblestone, no gravel step; End stone not natural at MV, natural at HV. R5: ethylene sourced only on an unreachable dim is made, never a raw input, with `routeDerived` false and true; a reachable sourced fluid is `direct`. R8: ore block not bought for a circuit, bought for a dust target. R6: derived at depth 5 not a leaf with `routeDerived: false`, depth 1 a leaf; default settings route both. R7: a derived leaf whose chain costs 0.5 is priced 1; `pricedVia` names the alloy smelter, never a canner; `canMake` false for a mined ingot nothing makes |
| `tests/unit/pack/supply.test.ts` | `deriveSupply` un-fakes the display-item rock breaker recipe (cobblestone), leaves the redstone→obsidian one fake, adds pump map/machines/recipes for an `MTEPump` machine, flags the empty-cell→air-cell compressor; ids are stable across two calls |
| `tests/unit/planner/supply.test.ts` | A line consuming 2.5 cobblestone/s at LV has a rock-breaker step with `supply: 'minecraft:cobblestone@0'`, `count = 2` (1.25/s per LV machine) and a configure build step; with `haveSupply: ['minecraft:cobblestone@0']` the step is gone and cobblestone is a `free` raw input; water via pump (count from 12.5 L/tick at LV); air via compressor + canner; tier 0 → free raw input, no supply step; Make N → no supply step; target nitrogen from air is `ok` (loop guard) |
| `tests/unit/planner/step-charge.test.ts` | A marginal chain (target via leaf A at cost 1 in 1 step, or via a 3-step chain costing 0.99) uses A at `stepCharge` 0.05 and the chain at 0; a 4-recipe chain at 0.85 is built (threshold 1/1.15); total raw never above 1.25 × least (a 10-recipe chain at 0.75 stays although its steps cost more than the saving, as the direct route would be 33 % above the least); a hand recipe and a machine recipe at equal raw → machine in rate mode, hand in Make N; a remaining hand step warns `hand-step`; two equal-cost producers of one good → one; Mini-GT plans keep their existing steps (`plan.test.ts` unchanged except :281) |
| `tests/unit/planner/candidates.test.ts` (additions) | carried cells do not block or cost: oxygen from water electrolysis (cells handed on, a canner empties them again) is kept for an EBF steel line; cells nothing here empties are charged, so the dust-oxygen route stays and the line plans 13.5 raw, not 31; the simplest producer is kept even when 2.5× the cheapest estimate; a producer 7 steps longer than the simplest is dropped unless cheapest; `minecraft:log@0` kept over a modded log at equal estimate |
| `tests/unit/planner/options.test.ts` | A circuit-assembler-like slot (72 L solder | 144 L tin | 288 L lead) split 64/36 lists both options with shares and the right amounts; `options` gives `rawPerRun` 0.5/1/2 and `steps`; `optionChoice['<id>#100'] = 'fluid:molten.tin'` forces tin; a stale pin warns `stale-option` and plans |
| `tests/unit/planner/lines.test.ts` | Red alloy (alloy smelter from copper + redstone) → molten red alloy (extractor) → wire: the smelter and extractor are in line `{ key: 'fluid:molten.redalloy', name: 'Red Alloy' }`, the wiremill in the main line; a 1-step molten fluid stays in the main line; `stopItems: [root]` removes the line |
| `tests/unit/planner/bom-steps.test.ts` (additions) | Empty Cell is never broken down through a recipe that only hands it back; totals carry `neededFor`; free inputs are leaves of the breakdown |
| `tests/unit/planner/plan-invariants.test.ts` (committed from the audit) | the checker on Mini-GT: five real plans clean; six injected faults reported under their kinds; REDUNDANT producer detection |
| `tests/unit/shared/format.test.ts` | `formatRate(0.5/3600,'hour') === '0.5/h'`, `formatRate(71.9/3600,'hour',{fluid:true}) === '71.9 L/h'`, `formatRate(1440/3600,'hour') === '1,440/h'`, `formatRate(0.0625/3600,'hour') === '0.0625/h'`, `formatRate(7.92e-5/3600,'hour') === '1 every 526 days'`, `formatRate(0.003438/3600,'hour',{fluid:true}) === '1 L every 12.1 days'`, `formatRate(3.1e-8,'hour',{noun:['run','runs']}) === '1 run every 373 days'`, `formatRate(0.3/3600,'min') === '1 every 3.33 h'`, `formatPercent(4.4e-7) === '<0.1%'`, `formatPercent(0.0069) === '0.7%'`, `formatPercent(0.999) === '99.9%'`, `formatPercent(0.9996) === '>99.9%'`, `formatPercent(1) === '100%'`, `formatNumber(13_050_000) === '13,050,000'`; no positive input in {1e-12, 3e-9, 2.2e-8, 1e-6, 0.004} formats as "0…" |
| `tests/client/flow.test.tsx` (updated) | rows and titles (no "1×", "1 machine · <0.1% busy"); one import stub per (good, consumer) with its leaf word; missing stub into `mixer|in|fluid:pva`; rate-only labels only on 2+-edge ports; `toElk` has no `layerConstraint` on imports, `FIXED_POS` ports, `LAST` on out, compound line nodes; ELK in Node: every import stub's right edge 0–120 px left of its consumer, edges start on their port row ±2 px; `focusSets` item/node/edge/null; SSR classes `hl dim producer consumer`, `FlowIssues` texts with Show |
| `tests/client/step-panel.test.tsx` | Takes/Makes peers, Also made by + use-only patch, Options section text and pin patch, Supply and Line sections, renamed Supply-it-from-outside, RawPanel Used by, priced-via text, Make-it-here disabled when `canMake` false; patch builders' outputs |
| `tests/client/materials.test.tsx` (updated) | "1 L every 12.1 days" for 0.003438 L/h; never "0.00"; `usedBy`; `missingRows` first with the badge; totals' needed-for |
| `tests/client/plan-diff.test.ts` | added/removed imports and steps, new issues |
| `tests/unit/shared/apply-op.test.ts` (updated) | defaults (`routeDerived: true`, `stepCharge: 0.02`, `haveSupply: []`, `optionChoice: {}`, `settingsVersion: 2`; `normalizeSettings` fills a missing `settingsVersion` with 1), checks reject `stepCharge: 0.6`, `-0.1`, `'x'`, bad option keys and a `settingsVersion` below 2 |
| `tests/e2e/flow-focus.spec.ts` (Playwright, Mini-GT; fixture plans via `page.route('**/api/projects/*/plan', …)` from `tests/e2e/fixtures/plans.ts`) | (1) import stub's right edge ≤ the Wiremill's left edge and < 160 px away at zoom 1; (2) hovering `[data-port$="|out|t:copper_wire@0"]` lights one edge, the assembler `consumer`, the wiremill `producer`, dims the rest, Esc clears; (3) Find item centres the producer; (4) a fixture without the raw→wiremill flow shows `missing:t:copper_ingot@0@…` and the banner text "Nothing supplies Copper Ingot"; (5) a two-producer fixture shows "made 2 ways", and "Keep only …" POSTs a `recipeChoice` patch; (6) a 1/hour fixture shows no `0/h` text and fluids with " L"; (7) "Make it here instead" on Iron Ingot then "What changed" names the new furnace step |

### 7.2 Real-data acceptance (`GTNH_LOCAL=1`)

**`tests/unit/planner/real-rate.test.ts`** (from `docs/local/planner-audit/patches/A-numerics.patch`, without its `PLANNER_SRC` switch):
default settings, Electronic Circuit at MV, 1 per hour vs 1 per minute — no orphan input, worst imbalance < 1e-6, the
same step recipe ids, at most one producer of `fluid:molten.plastic` and of `gregtech:gt.metaitem.01@17035`. It fails on
cd6fcce (orphans `fluid:polyvinylacetate` and the Methyl Acetate Cell) and is the reproduction of complaint 1.

**`tests/unit/planner/real-user-project.test.ts`** — the user's exact settings (copied verbatim from `audit/proj.json`,
passed through `normalizeSettings`), plan `P`, plus `P1m` (same at `per: 'min'`) and `PR` (same with `routeDerived: true`).
Each `planLine` < 5 s.

| Complaint | Assertions |
|---|---|
| 1 "missing the import" | `indexPlan(P).issues` has no `orphan-input`/`short-input`; every key a step takes is made by a step or is a raw input; worst `|made + bought − taken − sunk − demand| / taken` < 1e-6; no step takes `fluid:polyvinylacetate`, `gregtech:gt.metaitem.01@30681` (Methyl Acetate Cell) or `fluid:advancedglue` |
| 2 "PE and ethylene" | no raw input is a fluid with `leafClass` `derived`; `fluid:ethylene` is no raw input of `P` or `PR`; every `derived` raw input has `pricedVia` whose map is not `gt.recipe.canner` and whose source text does not start "made by Canner"; in `PR` no raw input is `derived` and every step that makes a derived material has `line` |
| 3 "two places, two processes" | no good is the `mainOutput` of two steps in `P` and `PR`; at most one step makes `fluid:molten.plastic` and at most one makes `gregtech:gt.metaitem.01@17035` (Copper Plate) |
| 4 "where the wire is coming out" | `focusSets(flowGraph(P,'hour'), { kind: 'item', key: 'gregtech:gt.blockmachines@2000' })` (1x Red Alloy Wire) has exactly one producer (the wiremill step) and the circuit assembler `c0106c4cb6b4b041` among its consumers; every `PortSide` of `indexPlan(P)` has its peers |
| 5 "cobble … molten glass from sand" | no raw input and no step input is `minecraft:cobblestone@0`; no step makes `minecraft:gravel@0` or `minecraft:sand@0`; no step `handCraft`; the glass tube comes from sand or glass dust within 2 steps of an import (`P`: Glass Dust → forming press/alloy smelter; `PR`: Sand gathered) |
| 6 "recheck the planning step" | `P.steps.length ≤ 20` (prototype 15), `PR.steps.length ≤ 32` (27); `P.rawCost.perSecond ≤ 1.25 × P.rawCost.leastPerSecond`; sorted recipe ids of `P` equal `P1m`'s and every rate is 60× (1e-8 relative: P and P1m each round their rates to 9 significant digits, D3); `checkPlanInvariants(pack, settings, P)` has no violation of kinds a, b, d, e, f; warnings include `pin-dominated` for step `0a074f4241a9e0f9`; no `numerics`, `simplify-skipped`, `free-loop`, `graph-too-big` |

The step caps above and the real-acceptance "step caps from §2" come from the 5 % prototype. At the 2 % default (§10
answer 3) plan 09 Task 8 measures them again and sets each cap to the measured count + 5 (the same headroom; `P ≤ 27`
from the 22 steps §10 reports at 2 %), and `P` also asserts `P.rawCost.perSecond ≤ 1.10 × P.rawCost.leastPerSecond`.
Every other assertion stands as written.

**`tests/unit/planner/real-corpus.test.ts`** — 16 targets (Electronic, Good Electronic, Integrated Logic and Advanced
Circuits, Vacuum Tube, Resistor, Glass Tube, Circuit Board, LV and MV Machine Hull, Electric Motor (LV), Electric Pump
(LV), Robot Arm (LV) and (MV), Polyethylene Bar, Steel Ingot at 10/min) at their natural tier in three variants: 1/min
`routeDerived: false`, 1/hour `routeDerived: false`, 1/min `routeDerived: true` (48 plans). For every plan:
- `status: 'ok'`, plan time < 5 s, no `numerics`/`simplify-skipped`/`free-loop`/`graph-too-big` warning;
- `checkPlanInvariantsDeep(…, { marginal: false, stepCharge })`: **no violation of severity `error` or `warn` of kinds
  `balance`, `orphan-input`, `flow`, `machines`, `raw-source`, `byproduct`** (a, b, d, e, f);
- kind `multi-producer` (c): no `error`; a `warn`/`info` is allowed only under the documented exceptions below, asserted
  per good;
- kind `free-detour` (g): none (documented exception: a chain that starts at a supply step and ends in a good that is
  neither gathered nor a base material is not a detour, and the checker does not report it);
- kind `cost`: plan raw ≥ optimum × (1 − 1e-6) (nothing from tolerance) and ≤ optimum × 1.25;
- 1/min and 1/hour plans have the same sorted recipe ids.

Documented exceptions for (c): (i) co-products — a good several steps make where at most one has it as `mainOutput`
(Empty Cell, Hydrogen, Water); (ii) justified pairs — two main producers where removing either raises raw material by
more than `stepCharge` × the least raw material (the deep check's ban test says so; e.g. Good Circuit Board from two
reactor recipes); (iii) bought-and-made where the producing step is in the plan for another main output.

**`tests/unit/planner/real-acceptance.test.ts`** (updated): `ORDINARY` drops `fluid:molten.copper`,
`minecraft:cobblestone@0`, `fluid:ethylene`, `fluid:molten.polyethylene` and the derived fluids; adds
`minecraft:sand@0`, `minecraft:sand@1`, `minecraft:iron_ingot@0`, `minecraft:coal@0`, the cast iron ingot
`gregtech:gt.metaitem.01@11304`, `fluid:helium` (HV aluminium) and `fluid:sulfuricacid` where a reachable source exists,
plus (plan 09 Task 8: the list came from the 5 % prototype without supporting lines) the base materials the supporting
lines start from — antimony, chalcopyrite, malachite, sodalite, realgar, sulfur and tin dust, raw oil and sugar beet —
and the logs canonicalRank ranks 0 (oak, acacia, rubber wood; R10), any of which fills Wood Pulp's `logWood` slot;
the pinned-EC test asserts Sand or Glass Dust > 0 and cobblestone = 0; the MV steel test allows the supply steps
(`maxSteps` 5) and asserts the Electric Blast Furnace; step caps from §2. Plan 08's avoid tests in this file keep their
assertions and the 5 s bound; the one about Annealed Copper "still bought when avoiding Copper" tests a bought derived
material, so it passes `routeDerived: false`. Plan 09 Task 8 turns supporting lines off in four more cases, for the
same kind of reason. The MV steel tests of both files buy Cast Iron Dust: their "no Steel Dust" check is R7's rule for
bought derived materials, and the 5-step cap holds only then (at default settings the line also makes its cast iron
from ore, 9 steps, so real-acceptance plans it at default settings too and asserts `ok`, < 5 s, an Electric Blast
Furnace step and ≤ 14 steps). `real-pack.test.ts`'s 10 LV hulls a minute and 64-hull Make N cases keep the limits set
for lines that buy their steel: at LV supporting lines make steel only in Bricked Blast Furnaces, whose count the
objective ignores until plan 10's build cost (§9); the corpus still plans the LV hull and LV steel lines at default
settings for soundness and time. `real-pack.test.ts` keeps its limits except the MV steel machine count, which drops
to ≤ 20 (16 measured: oxygen from compressed air, 7 compressors, 7 centrifuges and a canner beside the EBF; the
prototype's 12 electrolysed water).

### 7.3 Timing

Every real-data plan < 5 s (`PLAN_SECONDS`), measured with a warm pack on a host not running other planners, one test
file at a time (`--no-file-parallelism`: the bound is wall-clock). Prototype worst case under load average ≈ 11: 5.04 s
(Robot Arm MV); median ≈ 3.3 s. The 0 % preset ("Least raw material") is timed as well (R3, Task 4 review):
`real-acceptance.test.ts` plans Advanced Circuit at HV 1/min with default settings and `stepCharge: 0` (13 s before the
review fix), and `real-user-project.test.ts` the user's settings with target Advanced Circuit at HV (`tier 3`) and
`stepCharge: 0` (181 s before it); each < 5 s with `rawCost.perSecond` within 1e-6 of `leastPerSecond` and no
`simplify-skipped` or `numerics` warning.

---

## 8. Architecture §11 entries and spec amendments

Main's architecture already has §11.26 (free inputs need their generator), §11.27 (supporting lines), §11.28 (build cost
in the objective), §11.29 (reusing owned machines) and §11.30 (EnderIO conduits), written from the user's
clarifications on 2026-10-18. §11.26 leaves "details of machine choice and rates" and §11.27 "how old projects migrate"
to this plan; §11.29 names this plan as its implementer (plan 09 Task 9 implements its switch, manual list and
`PlanStep.reused`; the rest moves to plan 10, §9 and §10 answer 1). Plan 09
leaves 26–30 as they are and appends the entries below (if another plan has taken a number meanwhile, renumber
consecutively and update the cross-references in this spec and plan 09):

31. **Free-input supply, details** (amends 26; spec §3.3; plan 09 Task 3): loader-derived supply recipes
    (`Recipe.meta.supply`: `rock-breaker`, `pump`, `compressor`) per R2; pseudo map `pump` on the `MTEPump` machines; air
    comes from a compressor filling Empty Cells and the canner that empties them (a singleblock gets air only as
    compressed-air cells; the multiblock air intake hatch is later work); `PlanStep.supply?`; free inputs are bought free
    only in Make N, at a tier with no supply machine, or when listed in `haveSupply`; supply recipes are sources for the
    loop guard; build-material breakdowns keep free inputs as leaves.
32. **Supporting lines, details** (amends 27; plan 09 Tasks 2 and 5): with `routeDerived` off a derived material is
    bought only within `DERIVED_LEAF_MAX_DEPTH = 4` layers (`Availability.depth`), derived fluids never; `PlanStep.line?`
    per R6; projects stored before plan 09 are switched once (§10 answer 2; plan 09 Task 2):
    `PlanSettings.settingsVersion?: number` (optional addition; `defaultSettings()` sets 2, `normalizeSettings()` fills a
    missing one with 1, `SETTING_CHECKS.settingsVersion` accepts safe integers ≥ 2), and at server start (`createApp`) one
    recorded settings op `{ routeDerived: true, settingsVersion: 2 }` by `'Planner update'` is applied to every live
    project with `settingsVersion` < 2; a project at `settingsVersion` ≥ 2 is never touched again, so a later deliberate
    `false` sticks; `normalizeSettings()` alone keeps a stored `routeDerived`; the plan banner offers "Plan them as
    supporting lines" to projects set to `false`.
33. **Numerics and plan integrity** (plan 09 Task 1): unit-demand solve, 9 significant digits, relative flow drop,
    residual check with `numerics`/`simplify-skipped` warnings, `src/shared/plan/balance.ts` (`indexPlan`, `issueText`),
    `src/shared/format.ts`, integrity `PlanWarning` codes with `stepIds?`/`share?`, `mainOutput` by value,
    `Plan.target?`, `Plan.targetPerSecond?`, `Plan.rawCost?`.
34. **Steps vs raw material** (plan 09 Task 4; the stand-in for 28 until plan 10): `PlanSettings.stepCharge?` (default
    0.02 per §10 answer 3, 0–0.5; presets 0, 0.02, 0.05, 0.15), hand steps ×3 in rate mode, cap +25 %, `hand-step` and
    `pin-dominated` warnings; `LpModel.start?` (MIP start); avoid trials (25) solve as S1-only probes and only the
    returned line fully. Plan 09 Task 9 implements 29's `reuseOwned` switch, `ownedManual` list and `PlanStep.reused`
    for machine assignment and the build list (§10 answer 1); plan 10 keeps 28 and the rest of 29 (owned machines in the
    objective, sharing one owned machine across steps) and then decides whether the step charge stays.
35. **Ingredient options** (plan 09 Task 5): `PlanSettings.optionChoice?`, every used option in `PlanStep.inputs`,
    `PlanStep.options?: StepOption[]`, `stale-option` warning.
36. **Leaf rules and provenance** (plan 09 Tasks 2 and 5): `GATHERED_BLOCKS`, derived fluids never leaves, ore blocks only
    for material lines, derived price floor, `RawInput.pricedVia?`, `RawInput.canMake?`, `BomLine.neededFor?`.
37. **Flow view** (spec §3.9; plan 09 Tasks 6–7): ports, import stubs per consumer, focus/Find, supporting-line groups,
    shared formatter; web-stack §7 ELK options amended.

Spec amendments (`docs/superpowers/specs/2026-10-17-gtnh-planner-design.md`; main already carries the user's 2026-10-18
bullets on build cost, generators, supporting lines and reuse — plan 09 adds to them and replaces none of their
decisions):
- §3.3 Objective bullet, appended: "Until the build cost is implemented (plan 10), each recipe step must save at least
  the project's step charge (default 2 % of the line's least raw material) to be built; a step crafted by hand in a
  running line counts as 3; never more than 25 % above the least raw material."
- §3.3 "How materials are counted": "air: a gas collector or air intake" becomes "air: a compressor filling cells and a
  canner emptying them"; appended: "A Make N batch, and a tier with no supply machine, take them free."
- §3.3 after the supporting-lines bullet: "With supporting lines switched off, a derived material is bought when the pack
  makes it within four recipe layers; derived fluids are always made. Gathered world blocks (sand, gravel, clay, …) are
  bought like logs and crops. Projects made before supporting lines were the default are switched to them once (a
  recorded 'Planner update' change); after that a project's own choice stays."
- §3.3 "Base material" bullet becomes: "'Base material' by default = mined ingots, dusts and gems, gathered items, and
  fluids pumpable where the group can reach; ore blocks only for lines that make a material."
- §3.9: "Each import sits next to the step that uses it and says what kind of import it is; boxes list what they take and
  make; hovering or picking an item shows where it comes from and goes; supporting lines are groups that collapse."
- §3.10: amounts never print as 0 (tiny rates read "1 every N days"); base-material totals say what needs them.
- §4 Non-goals: "Not optimizing for fewest machines." becomes "Not minimizing machines for their own sake: a step must
  pay for itself in raw material (the step charge, until the build cost does that in plan 10)."

---

## 9. Deferred (not in plan 09)

| Item | Why deferred | Where |
|---|---|---|
| Build cost of unowned machines in the objective, `buildHorizonHours`, integer machine counts, `Plan.cost` (clarification §11.28) | needs a trustworthy build list first (D15 only partly fixes it); a machine-count term broke rate invariance in the prototype; gtnh §5: at 1/hour a 24 h horizon makes each MV machine ≈ 29 % of the line's raw | plan 10 |
| The rest of reusing owned machines (§11.29): owned machines in the objective (no build cost for what the group owns) and sharing one owned machine across steps. Plan 09 Task 9 ships `reuseOwned`, `ownedManual` and `PlanStep.reused` for machine assignment and the build list (§10 answer 1) | "owned machines cost nothing to build" steers the plan only once the build cost is in the objective, and sharing is the same trade-off as `shareGroup`; none of the six complaints needs it | plan 10 |
| Pooling build-list demand before rounding; stopping breakdowns at stocked components (G9) | design change of `expandWith` | plan 10 |
| The machine-count and Make N limits of the LV hull lines at default settings (plan 09 Task 8: 10 LV hulls a minute plan 646 machines, 360 of them Bricked Blast Furnaces; 64 hulls in Make N take 38.5 h), checked only with bought steel until then (§7.2) | at LV supporting lines make steel only in Bricked Blast Furnaces, and machine counts enter the objective only with the build cost | plan 10 |
| Machine tier choice (lowest tier that meets the rate, G11) and machine sharing (`PlanStep.shareGroup`, UI-10) | build-cost trade-offs | plan 10 |
| Mob drops as gathered items (ender pearl, blaze rod, ghast tear, G2) | changes availability broadly; not needed for the reported lines | later |
| Stock list from the world scan (G3: "what the group already has in storage is importable") | needs Plan 4 data in the leaf oracle | later |
| Generators in Make N | a batch uses buckets | — |

---

## 10. Decisions that needed the user (answered)

The questions as asked:

1. **Build cost in the objective (§11.28) and reusing owned machines (§11.29) move to plan 10**; plan 09 ships the
   relative step charge (default 5 %) as their stand-in. Main's architecture says plan 09 implements §11.29; this spec
   moves it because "owned machines cost nothing to build" steers the plan only once the build cost is in the
   objective. Confirm, or plan 09 gains the `reuseOwned` switch and the manual "Machines we have" list now, for machine
   assignment and the build list only (one more task).
2. **Existing projects keep `routeDerived: false`** (it was the old default; their stored value cannot tell a choice
   from a default). Plan 09 changes the default for new projects and adds a one-click "Plan them as supporting lines" in
   the banner. Should plan 09 instead switch every existing project to `true` once (a recorded settings op)?
3. **Default step charge 5 %.** On the user's line at 1/hour it gives 15 steps at +21 % raw (refined-glue boards, no PE);
   2 % keeps the biomass-ethylene PE board line (22 steps, +1.5 %). Presets let each project choose; keep 5 % as the
   default?

The user's answers (2026-10-18; priorities: least raw material first, ethylene/PE supporting lines, and a whole-project
switch for reusing machines). The sections above follow them:

1. **Plan 09 gains the switch and the list.** Task 9 (after Task 8) adds `PlanSettings.reuseOwned?` (default `true`),
   `PlanSettings.ownedManual?` (default `[]`) and `PlanStep.reused?`, for machine assignment and the build list. Build cost
   in the objective (§11.28) and sharing one owned machine across steps (the rest of §11.29) stay in plan 10.
2. **Every existing project is switched to `routeDerived: true` once**, by a recorded settings op
   `{ routeDerived: true, settingsVersion: 2 }` by `'Planner update'` at server start, for every stored project whose
   `settingsVersion` is below 2 (`PlanSettings.settingsVersion?`: `defaultSettings()` sets 2, `normalizeSettings()` fills
   a missing one with 1). A project at `settingsVersion` ≥ 2 is never touched again, so a later deliberate `false`
   sticks; the banner's "Plan them as supporting lines" serves projects set to `false` later.
3. **The default step charge is 2 %** (`DEFAULT_STEP_CHARGE = 0.02`): at 5 % the user's Electronic Circuit line uses 21 %
   more raw material and loses the PE board line; at 2 % it uses 1.5 % more with the biomass-ethylene PE line. The
   presets stay 0, 2, 5 and 15 % ("Least raw material", "Some steps", "Balanced", "Fewest machines"); a project without
   a stored `stepCharge` shows "Some steps (2%)".
