# Materials To Avoid Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A per-project "Avoid" list of materials or items that the planner keeps out of the whole chain, with a visible fallback when nothing at the tier avoids one.

**Architecture:** One new `PlanSettings.avoid` field (shared types, defaults, op validation), resolved in the planner's basis to a set of avoided goods; candidate selection and the main solve treat avoided goods as forbidden (not buyable, recipes consuming them dropped); if the solve is infeasible, a second pass re-allows the smallest set of avoided goods needed and flags every use. Client: an "Avoid" picker in the settings panel and markers in the flow and materials views.

**Tech Stack:** TypeScript (Node 24 type stripping), HiGHS via the existing `src/server/planner/lp.ts`, React 19, vitest, Playwright.

**Spec:** `docs/superpowers/specs/2026-10-17-gtnh-planner-design.md` §3.3 ("Materials to avoid"); architecture `docs/superpowers/plans/2026-10-17-00-architecture.md` §11.25.

## Global Constraints

- `PlanSettings.avoid: string[]`, default `[]` in `defaultSettings()`; `normalizeSettings` fills `[]` for old projects; `validateOp` accepts at most 50 entries, each a string of 1..300 characters; duplicates removed, order kept.
- An entry is a **material name** when some `Item.gt.material` (or `GtMaterial.name`) equals it exactly (case-sensitive, as exported) — it then matches every item with that `gt.material` and every fluid whose name is `molten.<lowercased material>` or `plasma.<lowercased material>` and every fluid the pack links to that material — otherwise it is a **StuffKey** (item or fluid) matched exactly. Unknown entries match nothing and produce one `PlanWarning { code: 'avoid-unknown', text }` each.
- Planner rule: avoided goods are never buyable and recipes that consume an avoided good (any consumed ingredient option that is only avoided goods; an ingredient with at least one non-avoided option keeps only its non-avoided options) are not candidates — unless the plan is infeasible without them. Then the planner re-allows avoided goods one at a time in order of least raw-cost impact until feasible (at most the number of avoided goods), and every step consuming a re-allowed good gets `PlanWarning { code: 'avoid-unavoidable', key, stepId, text: '<Step machine> uses <Name> — no recipe at <TierName> avoids it' }`.
- `Plan.avoided?: Array<{ key: StuffKey; name: string; unavoidable: boolean }>` lists every good the setting matched that the unrestricted plan would have used, plus every re-allowed one (unavoidable = true). A target that is itself avoided is planned normally, with one warning `avoid-target`.
- The settings hash (plan cache key) includes `avoid`, so changing it re-plans.
- UI: Settings panel section "Avoid materials" with a search box accepting material names (matching GT materials by name) and items/fluids (existing item search), chips with remove buttons; the flow view marks unavoidable uses with a warning badge; the materials view shows a small "avoid" marker on raw/build rows of unavoidable goods.
- Commit messages end with `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`. No new dependencies.

## Review Focus

1. Avoiding a material whose only route is through it (e.g. avoid Tin for a tin cable at LV) still returns a plan, with `avoid-unavoidable` on the right steps, never an empty plan.
2. Avoiding a material keeps it out of deep sub-chains (an avoided material used three steps down is replaced when an alternative exists).
3. Ore-dictionary inputs with mixed options keep the non-avoided ones instead of dropping the recipe.
4. Old projects without `avoid` load and plan exactly as before.
5. Real data: avoiding Silver for Good Electronic Circuit at HV either removes Silver from raw inputs or flags each use — and planning still takes under 5 s.

---

### Task 1: Avoid list in settings, planner and UI

**Files:**
- Modify: `src/shared/types/plan.ts` (`avoid` on PlanSettings; `avoided` on Plan), `src/shared/project/apply-op.ts` (defaults, normalize, validate)
- Modify: `src/server/planner/basis.ts` (resolve `avoid` → `avoidedGoods: Set<StuffKey>` and unknown entries), `src/server/planner/candidates.ts` (drop/trim per the rule), `src/server/planner/plan.ts` (infeasible → re-allow pass, warnings, `avoided`, settings hash includes `avoid`)
- Modify: client `src/client/views/SettingsPanel.tsx` (+ a small `AvoidPicker` component), `FlowView`/`MaterialsView` markers
- Test: `tests/unit/planner/avoid.test.ts` (Mini-GT fixture via `tests/helpers/pack-spec.ts` / `mini-gt.ts`), `tests/unit/project/apply-op.test.ts` (validation cases), `tests/client/avoid-picker.test.tsx`, a GTNH_LOCAL case appended to `tests/unit/planner/real-acceptance.test.ts`, `tests/e2e/avoid.spec.ts`

**Interfaces:**
- Consumes: Plan 2's `planLine`, `planBasis`, candidate walk, solve stages, `PlanWarning`, settings ops, `ItemSearch`.
- Produces: `PlanSettings.avoid`, `Plan.avoided`, warning codes `avoid-unknown`, `avoid-unavoidable`, `avoid-target`, `resolveAvoid(pack, avoid): { goods: Set<StuffKey>; unknown: string[] }` exported from `basis.ts`.

- [ ] **Step 1: Write the failing tests** — in `avoid.test.ts` on the Mini-GT fixture: (a) avoiding a material that has an alternative route removes every good of that material from `rawInputs` and every step that consumes it; (b) an ore-dictionary ingredient with one avoided and one allowed option keeps the allowed option; (c) avoiding the only route's material yields a non-empty plan, `avoided` lists it with `unavoidable: true`, and each step consuming it has an `avoid-unavoidable` warning with the step id; (d) an unknown entry gives exactly one `avoid-unknown`; (e) avoiding the target itself plans normally with `avoid-target`; (f) settings hashes differ when `avoid` differs; (g) a project without `avoid` plans identically to `avoid: []`. In `apply-op.test.ts`: 51 entries rejected, a 301-character entry rejected, duplicates collapsed. In `avoid-picker.test.tsx`: chips render for each entry and removal sends a `settings` op without it. Real data (GTNH_LOCAL=1): Good Electronic Circuit at HV with `avoid: ['Silver']` → no Silver forms in raw inputs, or each use flagged; under 5 s. E2E: add "Silver" in the settings panel, the chip appears, the plan refreshes, removing the chip refreshes again.
- [ ] **Step 2: Run them to verify they fail** — `npx vitest run tests/unit/planner/avoid.test.ts tests/unit/project/apply-op.test.ts tests/client/avoid-picker.test.tsx` → FAIL.
- [ ] **Step 3: Implement** per Global Constraints.
- [ ] **Step 4: Verify** — `npm run typecheck && npx vitest run && npm run e2e`, and `GTNH_LOCAL=1 npx vitest run tests/unit/planner/real-acceptance.test.ts tests/unit/planner/real-pack.test.ts` (data/ in this worktree links to the real export) → all pass.
- [ ] **Step 5: Commit**

```bash
git add -A src tests docs/superpowers/plans/2026-10-18-08-avoid-materials.md
git commit -m "feat: materials to avoid, with a flagged fallback when nothing avoids one

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```
