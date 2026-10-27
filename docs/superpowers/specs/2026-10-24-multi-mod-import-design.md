# Importing other mods — review and design

**Status:** proposal, awaiting approval. Nothing here is implemented.
**Goal (task RUK-7):** one planner that plans automation for *any* mod in the pack, not only GregTech, keeping every
feature main already has.

Read with: `docs/superpowers/plans/2026-10-17-00-architecture.md` (the cross-plan contracts this proposal changes),
`docs/research/gt-mechanics.md`, `docs/research/hatch-rules.md`, `docs/research/export-mod.md`.

## 1. First: the branches and worktrees are already merged

The task asks to keep the features in the other branches and local worktrees. Checked:

| Ref | Head | Ahead of `main` |
|---|---|---|
| `origin/main` | `90e8898` | — |
| `origin/plan/18-projector-aim-screen` | `daeedbc` | **0 commits** (ancestor of `main`) |

`git ls-remote --heads origin` lists those two refs and no others. `git worktree list` shows one worktree, clean, and
`git stash list` is empty. **There is nothing unmerged to salvage** — every feature in the README is on `main`.

One gap: this review ran in a Paperclip clone of `github.com/drukoz/gtnh-planner`, so a worktree that exists only on
your own machine and was never pushed is invisible here. If you have one, give me the path and I will audit it before
Phase 1 starts. Everything below assumes `main` is the whole product.

## 2. What is already mod-agnostic — keep all of it

The project is in better shape for this than its name suggests. These are not aspirations, they are shipped:

- **The export format is a section bundle, not a GT blob.** `Exporter.sections()`
  (`exporter-mod/.../export/Exporter.java:81`) returns a list of `ExportSection`s, each with a `name()`. A section that
  throws is recorded in `failedSections` and the export still completes; `-Dgtnhplanner.skipSections` turns any of them
  off. That is already a plugin SPI — adding a mod means adding a section, not reworking the exporter.
- **Non-GT recipe sources already work end to end.** `RecipeSource` is `'gt' | 'assemblyline' | 'crafting' | 'furnace'
  | 'derived'`. `CraftingSection` and `FurnaceSection` read vanilla registries, produce pseudo process ids (`crafting`,
  `furnace`) and pseudo machines with negative ids (`PSEUDO_MACHINES.CRAFTING_TABLE: -1`, `FURNACE: -2`, `HAND: -3`).
  The planner, the BOM, the build steps and the UI all handle them. The second mod is not the first non-GT thing here.
- **A multi-mod namespace already exists in the format.** `OreMaterialLine.family: 'gt' | 'bw' | 'gtpp'`
  (`src/server/pack/format.ts:73`).
- **Rules-from-the-export already beats rules-in-code.** `hatch-rules.ts` says it plainly: an export of exporter 0.6.0+
  carries GT's own structure rules cell by cell, `hatchRulesOf` narrows a curated row by them, and takes the exported
  rules alone where no curated row fits. The right layering is already chosen and shipped — §5 generalises it.
- **Behaviour can be read off any mod jar without linking it.** `ClassScan` answers "does this class's code mention
  this method name?" by reading class-file constant pools as resources. It uses only `java.*`, never instantiates and
  never links, so it works on any mod's jar, in or out of the game.
- **The solver does not know what GregTech is.** `planner/lp.ts` + `solve.ts` + `highs` are linear algebra over
  `StuffKey` nodes and recipe edges. A Thermal Expansion recipe is the same kind of edge as a GT one.
- **Logistics is already pluggable.** `layout/modes/{direct,routed,ae2,enderio,by-hand}.ts` behind `modes/mode.ts`.

## 3. The five real couplings

Measured over 269 source files / ~64k lines in `src/`:

| # | Coupling | Where | Size |
|---|---|---|---|
| 1 | **Machine identity is a GT MTE id.** `Machine.mteId: number`, `Pack.machines: Map<number, Machine>`. A Thermal Expansion pulverizer has no MTE id. | `mteId` appears in **68 files** | largest, but mechanical |
| 2 | **Energy is GT's.** `euPerTick`, the ladder `V[t] = 8·4^t` in `shared/gt/tiers.ts`, GT's doubling overclock in `shared/gt/overclock.ts` (226 lines). Other mods use RF, MJ, steam, mana, essentia, and most do not overclock. | `euPerTick` in **23 files** | medium |
| 3 | **Recipes are grouped by GT `RecipeMap`.** The process id is GT's `unlocalizedName` after `map-aliases.ts`. Most 1.7.10 mods have no recipe-map registry; they keep recipes in per-machine managers. | `pack/format.ts`, `map-aliases.ts`, `recipes.ts` | small |
| 4 | **Machine rules are hand-curated GT class-name sets.** `multiblock-rules.ts`: `NO_AUTOMATION`, `OWN_HATCH`, and `INPUT_SEPARATION_DEFAULT` — 69 class names read with `javap` over GT's jar. `hatch-rules.ts`: 425 lines, one row per GT controller. | 2 files, high value, zero generality | **the blocker for "all mods"** |
| 5 | **Assets and the world reader are GT-shaped.** `assets/gt-faces.ts`, `world/classify/*`, `client/map/palette.ts`; the world scan finds machines by GT's `mID` tile-entity tag. | ~10 files | defer |

Coupling 4 is the one that decides whether this project can ever claim "all mods". Writing 425 lines of javap-derived
rules per mod does not scale. Couplings 1–3 are just work.

## 4. Honest scoping: there is no universal recipe source

Worth saying before the plan, because it shapes it. In Minecraft 1.7.10 there is **no** cross-mod recipe registry.
`CraftingManager` and `FurnaceRecipes` are universal and already read. Beyond those, every mod keeps its own manager
(`IC2 Recipes.macerator`, Forestry `RecipeManagers`, Railcraft `RailcraftCraftingManager`, AE2 `IGrinderRegistry`, TE's
static `*Manager` maps). NEI *looks* like a shortcut, but NEI's handlers are client-side GUI classes and the export runs
headless against a server clone — which is exactly why `npm run import-nei-icons` exists as a separate hand-taken
client dump. NEI harvesting would need a second, client-side export path; it is a fallback, not the foundation.

So the leverage is **not** a magic universal harvester. It is making each per-mod adapter *cheap and independent*, and
making the long tail *data a user can write without a release*. That is what §5 is built around.

## 5. Proposed architecture: three layers

### Layer A — namespaced identity (makes other mods representable at all)

```ts
export type MachineId = string;   // "<ns>:<local>"  →  "gt:1001", "ic2:macerator", "te:pulverizer", "mc:crafting_table"
export type ProcessId = string;   // "<ns>:<local>"  →  "gt:gt.recipe.macerator", "ic2:macerator", "mc:crafting"
```

- `Pack.machines: Map<MachineId, Machine>`; `Machine.id: MachineId`.
- `Machine.mteId?: number` **stays**, GT-only, and is used by exactly two consumers that genuinely need it: the world
  reader (NBT `mID`) and the projector payload. Do not try to abolish it.
- Export format bumps to `gtnh-planner-export/2`. The loader keeps a `/1` upgrade path that synthesises `gt:<mteId>` and
  `mc:crafting_table` / `mc:furnace`, so **every export already on disk keeps loading**. Non-negotiable: re-exporting a
  pack is a multi-hour job for the user.
- The three `PSEUDO_MACHINES` negative ids become `mc:*` ids. Nothing else in the union changes.

Mechanical, wide, low-risk — a rename plus a `Map` key type. ~68 files, split by layer in Phase 1.

### Layer B — the mod-adapter SPI (how a mod gets in), with explicit tiers

Extend the existing `ExportSection` into a `ModAdapter`:

```java
public interface ModAdapter extends ExportSection {
    String namespace();              // "ic2", "te", "ae2" — the MachineId/ProcessId prefix
    boolean isPresent();             // reflective; the adapter is compileOnly and no-ops when the mod is absent
    // sections contribute: processes(), machines(), recipes(), structures(), blockFaces()
}
```

Each adapter declares the tier it reaches, and the manifest records what it actually achieved per adapter, so the UI
can say *"Thaumcraft: recipes only, no rates"* instead of quietly planning a line that cannot be built.

| Tier | What it gives | Cost | Examples |
|---|---|---|---|
| **1 — universal** | vanilla crafting + furnace | **shipped** | `mc` |
| **2 — recipes** | inputs, outputs, usually duration and energy; no structures, no layout | ~1 small task per mod | IC2, Forestry, Railcraft, TE, Avaritia |
| **3 — full** | + machines, IO slots, structures, hatch/automation rules, power fit, 3D faces | a plan per mod | GT (reference), then whichever mods people actually scale |
| **0 — user data** | hand-written JSON in `data/mod-profiles/`, no code, no release | user-authored | the long tail |

Tier 0 is what actually delivers "support all mods". Tier 3 for everything is not a finishable goal and should not be
promised in the README.

### Layer C — machine rules as data (so coupling 4 stops being code)

A `machine-profiles/` directory, one schema-validated JSON file per namespace, merged at pack-load time:

```json
{ "ns": "te",
  "energy":    { "unit": "RF", "euPerUnit": 0.25 },
  "overclock": "none",
  "machines": {
    "pulverizer": { "kind": "basic",
                    "io": { "itemIn": 1, "itemOut": 2 },
                    "automation": "any_side",
                    "logistics": ["direct", "routed", "ae2", "enderio"] } } }
```

Two rules make this work:

1. **Precedence, same as `hatchRulesOf` today:** exported facts → profile → curated TS rows. GT's existing three rule
   sets move into the `gt` profile unchanged; the curated rows stay as the narrowing layer, because they encode
   javap-verified facts the export cannot see.
2. **EU/t stays the one internal currency.** `energy.euPerUnit` converts at load. `euPerTick`, the LP and the power fit
   do not change — that is how coupling 2 is paid off for ~0 lines. Non-electric machines take
   `energy.unit: "steam" | "mana" | "essentia" | "none"`, are excluded from the power fit, and **say so** in a warning.

Profiles ship in-repo and are overridable from `data/mod-profiles/`, so a user adds a mod without waiting for a release.

## 6. Phased plan — each phase ships working, tested software

| Phase | Ships | Risk |
|---|---|---|
| **0** | This document: merge audit, coupling measurements, decision record. | done |
| **1** | Layer A. `MachineId`/`ProcessId`, `export/2` with a `/1` upgrade path. No new mods. Identical behaviour, `npm test` and `npm run e2e` green. ~6 engineer tasks, split shared-types → pack → planner → layout → world/projector → client. | low, wide |
| **2** | Layer C. Profile schema + loader; GT's `multiblock-rules.ts` and `hatch-rules.ts` sets move into the `gt` profile. Parity tests prove byte-identical plans before/after. | low |
| **3** | `Recipe.euPerTick` and `durationTicks` become optional; planner reports *"machines: unknown, rate unconstrained"* instead of computing `0` or `NaN`; UI surfaces it. **This is the gate for every Tier-2 mod** and the one phase with real correctness risk — audit every division by `durationTicks` in `solve.ts`, `steps.ts`, `make-n.ts`. | **medium-high** |
| **4** | First non-GT Tier-2 adapter: **IC2**. Chosen because GTNH always has it, its recipes carry real EU/t and duration (so it exercises the energy path under a non-GT namespace), and its managers are server-side. | medium |
| **5** | A second adapter of a different shape — **Thermal Expansion** (proves RF conversion) or **AE2** (the layout already knows it as a logistics mode) — plus `docs/` on authoring a Tier-0 profile, so users extend it themselves. | medium |

Phases 1 and 2 are prerequisites for everything; 3 is the real gate. Phases 4–5 are then repeatable per mod.

## 7. What I would not do

- **Do not delete GT's curated rules.** They are javap-verified facts, not legacy. They become the `gt` profile plus a
  narrowing layer.
- **Do not make `euPerTick` polymorphic.** Convert at load; keep one currency.
- **Do not generalise the world reader in Phases 1–5.** The GT `mID` scan stays. Non-GT machines read as not-owned until
  a world adapter exists — stated in the UI, not silently wrong.
- **Do not promise "all mods" in the README.** Promise what is true: *every mod's recipes are plannable where an adapter
  or a profile exists; rates, layout and power need per-mod work; you can add a mod yourself with a profile.*
- **Do not start Phase 4 before Phase 3.** A Tier-2 mod without the unknown-rate path produces plans with `NaN` machine
  counts.

## 8. Open questions

1. **Which mods first?** Default if you have no preference: IC2, Thermal Expansion, AE2, EnderIO, Railcraft, Forestry.
2. **Still GTNH 2.9 only?** The exporter is 1.7.10 Forge. A 1.12 or 1.20 pack is a second exporter, not a section — out
   of scope unless you say otherwise.
3. **Any local worktree I cannot see?** Path, and I will audit it before Phase 1 (§1).
