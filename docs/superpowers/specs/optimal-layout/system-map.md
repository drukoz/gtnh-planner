# Optimal layout (RUK-2571): system map

Status: phase 0 draft, 2026-11-16. Read at `origin/main` `92384723a`. Research subtasks fill in the inventories marked
"(R1)" to "(R4)"; this file is updated when they land.

## 1. Purpose and users

The GTNH Line Planner plans an automation line for GregTech: New Horizons 2.9 and lays it out block by block next to a
player's base: machines, cables, pipes, logistics parts, and the hookups to the base's power and logistics. A small
group of players builds those lines by hand in the game from the 3D view, the build steps and the in-game ghost
projector. Every block the layout lays is a block someone crafts and places; every cable block loses volts.

The request: "fix the wiring algorithm; check what would be the most optimal, always including machine placement".
Today the machines are placed first, by one fixed rule, and the wiring is then routed around them; nothing ever
compares one placement against another by what its wiring costs.

## 2. Where it runs

A Node 24 server (`src/server/main.ts`) on one group member's Mac, shared over the network; React 19 + three.js client.
A layout is computed on the server when a project with a scan and base is planned (`src/server/layout/service.ts`),
cached on disk under `data/cache/` by code version (RUK-602). Tests: Vitest. See `CLAUDE.md` for every command.

## 3. The layout pipeline today (`src/server/layout/layout.ts`, `layoutLine`, line 785)

| stage | code | what it does |
|---|---|---|
| units | `arrange.ts` `unitsFromPlan` (838) | one `Unit` per machine: its cells, ports (power, item, fluid), size, tier, multiblock hatches |
| placement | `arrange.ts` `placeUnits` (1136), `placeSide` (1066) | **one fixed geometry**: two rows of machines facing a one-block spine along x, a power head of run columns at the west end (or the middle, RUK-121), a tail column at the east end. Units are taken lowest feed tier first, then flow order; each goes to the shorter row (greedy), then slides east until its item ports keep `PORT_SPACING` from earlier ports and its kept cells are free |
| mode | `modes/mode.ts` `buildMode`; `modes/direct.ts`, `routed.ts`, `ae2.ts`, `enderio.ts` | the logistics blocks on the spine (pipes, chip pipes, ME interfaces, conduits), covers and configs; `PORT_SPACING = { direct: 0, routed: 1, ae2: 2, enderio: 0 }` (mode.ts:75) |
| internal wiring | `internal.ts` `routeInternal` (923): `planHead` (256), `growTrees` (307), `sizePower` (532), `layPower` (664); fluids `pipeFluids` (794) | one run column per fed tier in the head, transformer banks between runs, then per tier a cable tree grown from the run to every power port by `path.ts` `growTree` (209): terminals nearest-first, each joined by A* (`findPath`, 113; vertical cost 2, turn cost 0.25) to the tree so far. Cables sized after the trees give lengths; loss per tier (`TierLoss.worstBlocks/worstVolts`) |
| head choice | `layout.ts` `buildLocal` (284) | lays the line with the head at the west end and at 2–4 middle splits (`headSplits`), keeps a middle head only if it cuts `lineLoss` by ≥ 10 % and leaves no more hand work. **The only place today where two layouts are compared** |
| site | `site.ts` | finds clear flat ground near the base, ≤ 96 blocks from its centre |
| hookups | `layout.ts` `bestPowerHookup` (574), `buildHookups` (611); `hookups.ts`, `path.ts` | power and logistics hookups from the base's taps to the line, routed in the world voxels |
| parts, steps | `parts.ts`, `steps.ts`, `pins.ts` | build list and build steps |

Hard rules the wiring obeys today (each pinned by tests; R2 inventories them all): no cable of one tier touches another
tier's cable or a lower-tier machine (`tests/helpers/power-loss.ts` `tierContacts`; `layout.test.ts` "wires every
machine of random LV, MV and HV lines"); GT6-style cables connect only drawn sides; transformer banks step down one tier
at a time; a hand-run unit is touched by nothing; muffler fronts and steam vents stay air.

## 4. Known problems with the wiring and placement

1. **Fixed geometry.** Every line is two rows around a spine; L, U, single-row and stacked shapes are never tried, and a
   cable block feeds only the one machine whose port it is (design `docs/superpowers/specs/2026-10-23-shorter-layouts-design.md`, goals 1–2).
2. **Greedy placement.** Row choice is "shorter row first", order is "tier then flow"; no ordering is ever scored.
3. **Greedy Steiner trees.** `growTree` joins terminals nearest-first to the tree so far; no rip-up, no reordering.
4. **Far machines unpowered (RUK-351).** On 3 of the 12 standard loss lines the LV worst path is 44–84 blocks of 1 V/block
   cable on a 32 V tier: nothing arrives, but `deliveredVolts` floors at 1 V and the layout says `status: ok`.
5. **AE2 lines twice as long** as needed (RUK-119): `PORT_SPACING.ae2 = 2` because a full-block ME interface pushes into
   every neighbour (`docs/research/machine-feeding.md:207`, rule R12 in `feed-rules.ts`); spacing 1 is safe once each
   interface has a Wrench target (`InterfaceSpec.targets`, `src/shared/types/feed.ts:36`, never set by the layout).
   Estimated 43 → 24 columns and −43 % cable on the 20-machine fixture.

Baseline (RUK-119, 20 macerators, fixture pack): direct 14×1×5 / 30 cable cells; enderio 14×1×5 / 30; routed 24×2×5 / 49;
ae2 43×1×5 / 86. Loss budgets: `tests/unit/layout/power-loss.test.ts` `BUDGET` (may only be lowered).

## 5. External systems

None at layout time. All inputs are local: the pack export (`data/export/`), the world scan (`data/scans`), the project
settings (SQLite under `data/`). No network calls, no credentials.

## 6. Surfaces that show the layout

The project's **Map** tab (`src/client/map/layout-overlay.ts`), **3D** tab (`src/client/three/`), **Connections** tab,
**Materials & steps** (parts and build steps), the in-game projector (`projector-mod/`, reads the layout's blocks and
build steps over HTTP). Any new geometry must still be drawable by all of them: they read `Layout.blocks` with roles,
facings and connection bits, not the placement's shape (R1 confirms).

## 7. Where the weight is

`src/server/layout/` is 10,366 lines; the geometry lives in `arrange.ts` (1,311), `internal.ts` (969), `layout.ts`
(972) and the four modes (2,013). Tests: `tests/unit/layout/` (60 files) pin the geometry heavily (e.g.
`arrange.test.ts:161` pins `x = 1, 3, 5` for AE2 spacing 2). How much of the code assumes the spine geometry is R1's
question; it sets the cost of new shapes.

## 8. What must not change

- Determinism: the same plan, scan and settings give the same layout, block for block (guide, Conventions).
- Every rule in §3's list (tier separation, hand-run units untouched, muffler and vent air, multiblock hatch rules).
- The `Layout` type the client, projector and build steps read (`src/shared/types/layout.ts`); new fields only.
- Loss budgets only go down; no standard line gets longer (design goal 1's "never longer than today", like for like).
- Speed: the user's real line lays out in about a second (design anti-goals); fixture lines in milliseconds.

## 9. Inventories in progress

- (R1) every place that assumes the two-rows/spine/head geometry, outside `placeUnits` itself.
- (R2) every rule the internal wiring enforces, with its test.
- (R3) per logistics mode: what it lays relative to the placement, which spacing it needs and why, what breaks under
  packed or bent shapes.
- (R4) prior art and libraries for joint placement and routing (placement search, Steiner trees, block-game layout optimizers).
- (S1) the measurement harness: total length, loss and dead tiers for a fixed benchmark of lines in all four modes.
