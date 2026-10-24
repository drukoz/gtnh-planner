# Machine GUI Restyle — Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Phase 2 of the Machine GUI restyle: a dark look anyone can choose (Auto by default) and pixel logo C, then the dense text
becomes Minecraft-native visuals (Flow machine readouts, the NEI recipe card, an opt-in inventory grid, the key-numbers strip), a
modern feedback layer (one NEI tooltip, skeletons, toasts with Undo, in-app confirms, keyboard shortcuts), goods riding the Flow
pipes and diagrams that glide — with the light look unchanged but for the figures, which the user chose to read in VT323 (spec §25,
Task 2b), and every e2e assertion kept but spec §3.9's deliberate edits.

**Architecture:** Everything is client-side. The stylesheet gets a token for every themeable colour and one dark declaration list
written twice (chosen Dark, and Auto with a dark OS); every new rule reads tokens. New behaviour lives in small pure modules
unit-tested in node (theme, tooltip, readout, recipe, grid, key-number, toast, shortcut, rider and layout-change models) under
thin React components and document-level hosts (TooltipHost, Toasts, the shortcut handler) that Playwright proves; motion stays
in the stylesheet except bounded WAAPI glides that end on the `transform` attribute, the 400 ms count-up and the theme's View
Transition, each of which checks `prefersReducedMotion()` at every call.

**Tech Stack:** React 19, Vite 8, TypeScript 6, vitest 5 (client project `tests/client/**/*.test.tsx`, node, `renderToStaticMarkup`,
no DOM), Playwright 1.63 (Desktop Chrome 1280×720 against the real server on 18787 with the Mini-GT fixture; WebKit only for the
Task 12 spike). One new dependency, `@fontsource/vt323` 5.3.0: the figures' face (Task 2b, spec §25).

**Spec:** `docs/superpowers/specs/2026-10-24-machine-gui-phase2-design.md` — binding; its closing "§23 Builder-check answers"
(P2-D44, P2-D45, P2-D46) and "§24 Re-check against the new main" (the calls made when this plan was re-checked against
`96e9e99` and then `main` `01da27d`) and "§25 Figures in VT323" (the user's choice of 2026-10-24, which Task 2b builds) override
anything earlier that disagrees.

**Re-checked** on 2026-10-24 against `main` at `01da27d`; every `file:line` cite in this plan is at that commit. Task 2b and the figure
edits of Tasks 3a–14 were added the same day, for spec §25.

## Global Constraints

- Stack unchanged (React 19, Vite 8, TypeScript 6, vitest 5, Playwright 1.63) and **no new dependencies** but `@fontsource/vt323` 5.3.0, exact, the figures' face (Task 2b, spec §25): `createPortal` is `react-dom`'s; WAAPI, View Transitions and `matchMedia` are browser APIs.
- Client only: no change to planning logic, the server, the API, plan data or the mods. New state is two per-browser settings — `gtnh-planner:theme` (`auto` | `dark` | `light`, anything else reads `auto`) and `gtnh-planner:materials-view` (`list` | `grid`, anything but `grid` reads `list`) — a mod-name table and pure view models.
- One stylesheet, `src/client/styles.css`, tokens on `:root`; `publicDir: false` (no game assets in `dist/`); fonts bundled, never a CDN.
- The light look stays exactly as it is today, but for the figures, which Task 2b sets in VT323 on purpose (spec §25; plan ruling `figures-vt323`). Auto (no `data-theme` on `<html>`) follows `@media (prefers-color-scheme: dark)` with no JS; Dark is `data-theme="dark"`, Light `data-theme="light"`; `color-scheme: dark` and `<meta name="color-scheme" content="dark">` in **both** looks; `<meta name="theme-color" content="#1a1a1a">` unchanged; map terrain, the 3D scene and its pale sky unchanged; `.flow-canvas.focusing .dim { opacity: 0.18 }` in both looks.
- Every Phase 2 rule reads tokens; a colour literal only when it is the same in both looks and on the allow-list (`#ffffff`, `#000000`, and the chat, tooltip, tier, pipe and dye literals); the dark blocks redefine existing names only.
- Contrast in **both** looks: text 4.5:1, graphics and component edges 3:1; the accepted exceptions are spec §3.5 and §4.5's (stack counts measured against their 2 px shadow, the dark tick-well edge 4.21:1, the tooltip not hoverable, aria-hidden decorative shapes — skeleton blocks, the recipe arrow's base, the auto icon's dark half; in dark, button faces on panels 1.30:1, box fills on the well 1.32:1 and the flange on a new box 2.59:1; and the base's two, in dark, which the spec's closing §24 (the re-check) adds: add-on 17's mode-in-use edge on the panel 1.46:1 (its yellow ring carries the frame: 13.46:1 on the panel, 19.69:1 on the edge) and its farm fields' 2 px `--panel-lo` line 1.35:1 (decorative: the indent under the tick and the fields' labels group them; 4.36:1 in light) — plan rulings `compare-frame-dark` and `farm-line-dark`).
- Animate only `transform` and `opacity`, plus `stroke-dashoffset` (pipes), `offset-distance` (riders), `background-color` on hover and `block-size` (the settings fold, the Materials disclosures). No CSS transform on an SVG `<g>`, except a WAAPI `transform` animation whose last keyframe equals the element's `transform` attribute, with `fill: 'none'`. No JS frame loop drives a diagram; bounded rAF only for the 400 ms count-up and re-anchoring a visible tooltip.
- Endless animations: only the three pipe-content rules and the rider rule (Pause pipes stops all four; with Task 12's SMIL fallback the rider's `<animateMotion>` is the fourth, the only `repeatCount="indefinite"` in `src/client`). Everything else is finite with duration × count ≤ 5 s; a repeated animation's duration is written in seconds, so the dot helper (`styles-contract.test.tsx:2243-2251`) reads it; the resting state is the element's own style, with no fill mode, except `forwards` on the exit of an element about to be removed (`tip-out`, `toast-out`).
- Nothing the user waits for takes more than 300 ms: the pan is 250 ms, the re-layout 260 ms, the theme fade 260 ms (the 700 ms strip flash is a highlight nobody waits for); no infinite transform animation on anything clickable.
- Reduced motion: the global CSS block (`styles.css:107-112`), and every JS motion (WAAPI glide, pan and ghosts, SMIL, the rAF count-up, View Transitions) checks `prefersReducedMotion()` from `src/client/state/motion.ts` (a live `matchMedia('(prefers-reduced-motion: reduce)')`) at each call and then does the instant thing.
- Forced colours: one `@media (forced-colors: active)` block, last, system colours only, never `forced-color-adjust`; every new graphic drawn with a background or an SVG fill gets a rule there, at the specificity of the rule it repaints (the block's own convention, `styles.css:1409-1410`; the block, `:1412-1430`, now ends with add-on 17's `.compare-toggle[aria-expanded='true']` and `.compare-column.current` at `:1428-1429`: Phase 2's forced rules go after them, and R42's edit is the rule at `:1426`), and an e2e under `forcedColors: 'active'` shows it (spec §20); cues use `:not(:focus-visible)` so they never replace the focus ring (R42).
- Height budget at 1280×720: top bar ≤ 53 px on one row; tab strip ≤ 41 px with no margin below; `.tab-panel` padding ≤ 8 px; everything above `.project-body` adds < 63 px in total (the strip: +27.7 px); the iron-plate line's map canvas centre ≤ 700; at `01da27d` that centre is y 657 of 720 with add-on 17's Compare modes button in the head's row (a `button.small`, 28 px tall: `objectives.spec.ts:50-51`) and the Compare card closed, which draws nothing — never measure with it open; the project head stays one row, 36 px, at 1280 × 720 (`objectives.spec.ts:51`) and, with a target and the badge live, at 800 × 900 (`objectives.spec.ts:91`, measured once the badge is live and the fonts are in, `:86-90`; `drawer.spec.ts:535` and `:544`, short and long target names): below 900 px the Settings button names the target and fills that row (at most 40 % of the head, `styles.css:1371`), so nothing new is drawn in `.project-head` there — add-on 17 moved its button into `.compare-bar` under the banner for this (`:1377-1378`), and Task 11 hides its Shortcuts button there; the open Compare card stays the last child of `.project-banners` (`objectives.spec.ts:59`); the strip, toasts, chips and skeletons have fixed px heights and line heights (a Compare skeleton's frame is the sum of its px blocks, which stack where the tiles stack, Task 8), and so has every VT323 element, a `span.fig` taking a line height of 0 (spec §25).
- Pinned markup (spec §3.2) holds: `[data-node-id] > rect.flow-node-box` a direct child; the node `<g>`'s `class` right before `data-node-id`, an unlit new step exactly `flow-node step new`; no whole word `hl` or `dim` in unlit markup; no `<circle>` in a node; one 4×10 `rect.flow-port` per row, its last child; the Flow edge `<g>` attributes and its child classes exact (`flow-edge item`, `flow-edge-hit`, `flow-edge-line`, `flow-edge-flow`); Connections link tags exact; StepPanel's `<h3>` attribute-less and no `data-port-key` outside PortsSection; RawPanel's `<button type="button">Make it here instead</button>`; `li.mat-row` with `class="mat-row"` first; PlanBanner renders `''` with nothing to warn about and `<p class="plan-cost">` byte for byte; `<div class="map-tab map-tab-status"><p class="muted">Loading the world scan…</p></div>` exact; ItemIcon has no wrapper and no `data-key`; `PortsSection`, `RawPanel`, `RecipeCard`, `BuildGrid` are hook-free. The base's pins hold too: SettingsToggle renders exactly `<button type="button" class="settings-toggle" aria-expanded="false" aria-controls="project-settings">Settings <span class="settings-toggle-target">· Make: nothing yet</span></button>` (`settings-toggle.test.tsx:26-28`), is named by its text alone — no `aria-label`, `-labelledby`, `-hidden` or `-describedby` (`:58`), and so no `data-tip` — and stays the head's first child; CompareToggle renders exactly `<button type="button" class="small compare-toggle" aria-expanded="false" aria-controls="compare-card">Compare modes</button>` (`compare-card.test.tsx:289-290`), and below 900 px its twin is the child of `div.compare-bar` inside `.project-banners` (`objectives.spec.ts:84`); a Compare column holds one button (`objectives.spec.ts:26`, `:31`, `:33`); a card still planning the three modes holds no `[data-objective]` (`objectives.spec.ts:141`, `:203`; `compare-card.test.tsx:157`, `:187`), and an open card with three answers exactly 18 `.compare-row`s, each figure on one line inside its tile, not clipped (`objectives.spec.ts:174-175`); PlanBanner stays a hook-free function and, given `onPickTarget`, draws the server's no-target hint as `<ul class="warnings"><li><button type="button" class="link">Pick something to make</button></li></ul>` (`plan-banner.test.tsx`, describe 'plan banner: the hint to pick something to make'); a byproduct's taken row is an `li` with `class="mat-row mat-taken"`.
- Stylesheet contract: one rule per selector (R1); never add a selector to a pinned selector list — write a new rule; every `KEYFRAMES` name animates only its listed properties; the `FADES` transition is exact; among Flow rules only `.flow-node-box` has `drop-shadow`; no rule styles `.item-icon img`.
- Strings (spec §3.8): no new text (shown tooltips, toasts, the sheet, confirms, visually hidden text, chips, aria-labels) contains a string the e2e specs look for — at `01da27d` that includes "Updating the plan…" (`drawer.spec.ts:441` reads the banner's with `getByText`, page-wide, while the drawer is open: the drawer's own status says it otherwise, Task 8) and "Planning the three modes…" (`objectives.spec.ts:142`, `:204` read the card's with `getByText` in the card: its skeleton, Task 8, holds no text); no new button name containing "Fit", "Create", "Pause pipes", "Play pipes", "Save note", "Use this base", "Keep only", "Remove Copper", "Close the panel", "Make it here instead", "Revoke", "Restore", "Move line", "Log in", "Compare modes" (`objectives.spec.ts:18`; `:81-82` counts exactly one at 800 px), "Use this mode" or "Pick something to make" (`drawer.spec.ts:294`), and none that starts with "Settings" (`drawer.spec.ts:19`, `/^Settings/`) — the one exception is the confirm's "Revoke token"; in the settings aside, no new button containing "Close settings" (`drawer.spec.ts:71`, `:293`) or named "Clear" (`:418`, exact) and no new label containing "Count build cost against" (`objectives.spec.ts:16`); no new label containing "Tier", "Base", "Find item", "Rate", "Focus", "Materials", "Projects" or "Project name" (`drawer.spec.ts:331`, page-wide); no link named with "Projects"; nothing named "Recently deleted", "What changed" or "Confirm delete"; no new landmark named with "Project settings" (`objectives.spec.ts:14`) and no region named with "Compare modes" (`:19` finds the card as that region); no second button in a Compare column (`:26`, `:31`, `:33`); no new `role="option"` outside the item search's list (`drawer.spec.ts:405`, `:440` match `/Basic Circuit/` page-wide, and `objectives.spec.ts:127` `/Iron Plate/`); no `role="alert"` on the project list; no hidden `role="tooltip"`.
- Phase 1 rules: radius 0 but `.pin-dot`; Pixelify Sans only at 13 px or more and never for sentences (R35); figures in VT323 and words in Pixelify (spec §25; plan rulings `figures-vt323`, `digits-mixed`) — a figure readout, count or step number whole in `var(--font-digits)`, any other pixel text that shows a figure through `<Figs>` (`span.fig`, `tspan.fig`; the `%` and `×` around it stay Pixelify), names and fixed words in Pixelify, digits and all — and VT323 only at 14 px or more (`digits-floor`), every rule that sets it with `font-size-adjust: cap-height 0.56` after its `font` (`digits-token`); decorative `::before`/`::after` use `content: ''`; native inputs stay native; SVG diagram text keeps the system UI stack except the two Flow chips; R1, R9–R13, R15–R19, R21–R25, R27–R37a (R31 as R44 changes it), R40 and I1 stay in force (spec §3.7), and so do the Make-picker fix's review rulings F1–F4 (`$SCRATCH/makefix-review/fix-round-1.md`): the Settings button's 40 % cap only above 700 px (`styles.css:1371`, `:1392-1394`), the drawer effect's one `onWidth()` look as it starts to listen (`ProjectPage.tsx:367`), every e2e that measures the head's rows first waits for `.connection.live` (`drawer.spec.ts:512`; `objectives.spec.ts:86`, which also waits for the fonts at `:88`), and the hint's scroll check that bites (`drawer.spec.ts:366`); R26 now holds for MapTooltip only.
- Tests: no assertion removed or loosened; the only changed existing assertions are spec §3.9's, Task 2b's (spec §25's table: the contract's font rows of the figures, and `span.fig` in five markup tests), the §3.5 rewrite of `contrast.test.tsx` into one token table (Task 1a, whose guard case proves every pair measured before Phase 2 — Phase 1's 142, the Make-picker fix's 1, add-on 17's 12 — is still measured) and helpers moved into `tests/client/css-blocks.ts` / `tests/e2e/helpers.ts`; `npm test` and `npm run e2e` green at the end of every task; e2e polls, never sleeps (R40).
- Narrow windows (the base's Make-picker fix): at a width ≤ 900 px a project with no target opens the settings drawer by itself, once per visit, with the focus in the Make section's item search and the page behind inert (`drawer.spec.ts:298-339`). So every Phase 2 e2e at ≤ 900 px opens its project with a target — `createProject(page, name, LV_CIRCUITS)` (`{ target: 't:circuit@0', amount: 30, per: 'min', tier: 1 }`, drawer.spec.ts's `TARGET`) or `openWithPlan` (its default settings are `LV_CIRCUITS`) — unless that self-opening drawer is what it tests; and every e2e that opens the drawer finds the Settings button by `SETTINGS_BUTTON` (`/^Settings/`, `tests/e2e/helpers.ts`, Task 1b), never by `{ name: 'Settings', exact: true }`: its name goes on with what the line makes ("Settings · Make: Basic Circuit", "Settings · Make: nothing yet"). On a wide window the button is not drawn and is found by `.settings-toggle`.

## Review Focus

1. **Dragging or wheeling straight after Fit, a zoom button or a reveal**, while the 250 ms pan still runs — the picture must carry on from where it is on screen, never jump back → Task 13a, `glide.spec.ts` "(6) a drag that starts while Fit pans carries on from the picture on screen".
2. **A tooltip whose trigger vanishes under a still pointer** (a search list empties, a replan drops the hovered box) — the tip must go at once, and the next Escape must still be the drawer's → Task 3a, `tooltips.spec.ts` "(10) a tip whose trigger goes away under a still pointer goes too, and never takes the next Escape".
3. **Leaving within 5 s of deleting a note** (a reload, closing the tab, going back to the list) — the deferred delete must still reach the server, so the note does not come back → Task 9b, `toasts.spec.ts` "(6) a note deleted just before a reload stays deleted".
4. **A replan of a big plan that moves more than 200 boxes** — it must snap to the new layout instead of gliding (no long frames) → Task 13b, `flow.test.tsx` "glides a change of up to 200 moved boxes, and snaps a bigger one".
5. **Keyboard layouts that type digits and `?` with Shift held** (AZERTY, German, Nordic) — `1`–`6` must still switch tabs and `?` open the sheet → Task 11, `shortcuts.test.tsx` "ignores Shift: AZERTY digits and ? still work".
6. **The drawer that opens by itself** (the base's Make-picker fix: below 900 px a project with no target opens the drawer into the item search; a window that has grown past 900 px since closes it again at once, the focus left in the search) — Phase 2 must neither take that focus nor double the banner's words: R46 moves the focus to the aside only when the control that had it is no longer drawn (in practice Close settings), the drawer's status never says "Updating the plan…", and `/` opens the drawer through the page's `pickTarget` → Task 11, `drawer.spec.ts` 'a drawer that opened by itself in a window that has grown past 900 px since it looked closes at once, and the focus stays in the search' and the R46 extension of 'a window that grows past 900 px closes the drawer, and leaves the page live'; Task 8, `drawer.spec.ts` 'the Settings button names a target the moment it is picked, before the plan that names it arrives' (its `getByText('Updating the plan…')` with the drawer open).

## File map

| File | Tasks | Responsibility |
|---|---|---|
| `src/client/styles.css` | all | tokens, the dark look, every new rule, the forced-colours block, the drawer's 900 px block (Task 11's Shortcuts rule) |
| `src/client/index.html` | 1b, 2 | the head script, the favicon |
| `src/client/main.tsx` | 1b, 2b | `startTheme()` before the render; the VT323 import (2b) |
| `package.json`, `package-lock.json`, `docs/research/web-stack.md` | 2b | `@fontsource/vt323` 5.3.0, exact |
| `src/client/components/Figs.tsx` (new) | 2b; 3a, 4, 5a, 11 use it | `figureRuns`, `Figs`: the figures of pixel text in `span.fig` / `tspan.fig` |
| `src/client/map/MapTooltip.tsx`, `map/FoundPanel.tsx`, `map/LinePanel.tsx` (Rotate 90°), `views/View3D.tsx`, `views/StepsView.tsx`, `views/StepPanel.tsx` (the swap list's "more…"), `views/ConnectionsView.tsx` (the details panel's title), `views/MapTab.tsx`, `views/MaterialsView.tsx`, `views/ProjectPage.tsx` (PlanBanner's heading) | 2b | the figures among their words through `<Figs>` (spec §25) |
| `src/client/state/theme.ts` (new) | 1b | the theme store, `applyTheme`, the cross-fade |
| `src/client/state/motion.ts` (new) | 1b, 13a | `prefersReducedMotion()`, then the glide constants |
| `src/client/components/ThemeButton.tsx` (new), `TopNav.tsx` | 1b | the Theme button after `</nav>` |
| `src/client/components/tooltip-model.ts`, `Tooltip.tsx`, `mod-names.ts` (new) | 3a | the shared NEI tooltip |
| `src/client/components/ItemIcon.tsx` | 3a | `tip` prop, `data-tip`, `data-tip-mod`, no `title` |
| `src/client/App.tsx` | 3a, 9a | mounts `TooltipHost` and `Toasts` |
| `src/client/views/flow-model.ts` | 3b, 4, 5a, 13b | `FlowEdge.route`; the machine readout; the recipe helpers; `layoutChange` |
| `src/client/views/FlowView.tsx` | 3a, 3b, 4, 5b, 8, 11, 12, 13a, 13b | tips, readout, `.flow-side`, skeletons, Fit markup, riders, glide, ghosts |
| `src/client/views/ConnectionsView.tsx` | 1a, 2b, 3b, 8, 11, 13a, 13b | dye casing, the details title's figures, tips, skeletons, Fit markup, glide |
| `src/client/views/StepPanel.tsx` | 2b, 5a, 5b | the "more…" button's figures, `RecipeCard`, focusable asides |
| `src/client/components/GtArrow.tsx` (new) | 5a, 8 | the GT progress arrow |
| `src/client/views/materials-model.ts`, `MaterialsGrid.tsx` (new), `MaterialsView.tsx` | 6a, 8 | the inventory grid |
| `src/client/state/materials-view.ts` (new) | 6a | Grid / List per browser |
| `src/client/views/key-numbers.ts`, `KeyNumbers.tsx` (new), `plan-cost.ts` | 7, 8 | the key-numbers strip |
| `src/client/views/ProjectPage.tsx` | 3a, 7, 8, 9a, 9b, 11 | tips off, strip, busy arrow, R43, toasts, shortcuts (the `/` key through the base's `pickTarget`), R46, R47; the base's drawer (`openSettings`, `focusOnOpen`, `focusSearch`, the self-opening effect) and Compare parts (`useCompare`, the forgetting close and the target's layout effect, the two `CompareToggle`s, `CompareCard`) stay as they are |
| `src/client/components/Skeleton.tsx` (new); `map/LinePanel.tsx`, `views/View3D.tsx`, `views/View3DTab.tsx`, `views/MapTab.tsx`, `views/CompareCard.tsx` | 8 | skeletons beside loading lines (the Compare card's two: plan ruling `compare-skeletons`) |
| `src/client/views/ProjectList.tsx`, `components/DeleteProject.tsx`, `views/MapTab.tsx`, `views/WorldPage.tsx` | 8, 9a, 9b | list skeleton; created, note and upload toasts (9a); deleted toasts and restore from a toast (9b) |
| `src/client/views/SettingsPanel.tsx`, `components/AvoidPicker.tsx`, `map/MapTooltip.tsx` | 3a, 11 | `tip={false}` sites, `alongAxis`, the `/` search |
| `src/client/state/toasts.ts`, `components/Toasts.tsx` (new) | 9a | toasts |
| `src/client/state/projects-changed.ts` (new) | 9b | the list reloads after a restore |
| `src/client/state/project-store.ts`, `api/client.ts`, `views/project-tabs.ts` | 9b | `sendLater`, keepalive |
| `src/client/components/InlineConfirm.tsx` (new), `views/ProjectorPanel.tsx`, `views/NotesView.tsx` | 9a, 9b, 10 | the copy and note toasts, the deferred note delete, confirms |
| `src/client/state/shortcuts.ts`, `components/ShortcutsSheet.tsx` (new), `PipesButton.tsx`, `ItemSearch.tsx` | 11 | shortcuts, R44 |
| `src/client/views/pipe-motion.ts` | 12 | rider numbers |
| `src/client/views/glide.ts` (new) | 13a, 13b | WAAPI pan and layout glide |
| `tests/client/css-blocks.ts`, `tests/client/contrast-phase1.json` (new) | 1a | the stylesheet scanner shared by the contract and contrast tests; the 155 pairs measured before Phase 2 |
| `tests/client/*.test.tsx` | all | units, the contract, contrast |
| `tests/e2e/helpers.ts`, `tests/e2e/fixtures/plans.ts` | 1b, 3b, 12, 13a, 13b | shared e2e helpers (Task 1b's `SETTINGS_BUTTON`, `LV_CIRCUITS`, `openWithPlan`), the 201-edge fixture |
| `tests/e2e/*.spec.ts` | all | behaviour in Chromium |
| `src/client/components/SettingsToggle.tsx`, `src/client/views/compare-model.ts` | — | not edited: SettingsToggle's markup is pinned (`settings-toggle.test.tsx:26-28`), and so is CompareToggle's in `CompareCard.tsx` (`compare-card.test.tsx:289-290`), which only Task 8 touches; Task 1b's dark look reaches them through the tokens they read |
| `README.md`, the Phase 1 spec and plan, the Phase 2 spec, this plan | 11, 14 | docs as built |

## Conventions

- Work on branch `feat/machine-gui-phase2` in the worktree `.worktrees/machine-gui-phase2` (superpowers:using-git-worktrees), cut
  from `main` when execution starts, once `main` contains `01da27d` — the merge of add-on 17: `cfaa05b` plus add-on 23
  (resource-pack textures, server only), the Make-picker fix (`29567a7`), add-on 17 (objectives) in the Machine GUI look (`96e9e99`)
  and its three fixes (`0c08dba`, `4bef36c`, `68c06c1`). This plan was re-checked against `01da27d`; if `main` does not contain it,
  stop and ask. No other unmerged plan branch
  (`plan/12-build-cost` included) is planned around.
- Read beside the spec, which cites them: the scout reports `$SCRATCH/recon2/{theme-logo,flow-visuals,step-recipe,materials-grid,tooltips,feedback}.md`
  ([TL] [FV] [SR] [MG] [TT] [FB]), `$SCRATCH/recon2/theme-logo-svg.txt` (the encoded logo and icon data URIs) and `theme-logo-contrast.txt`; the
  mockups `$SCRATCH/phase2-canvas/project/*.dc.html` (the look, not a pixel spec); the Phase 1 plan with rulings R1–R40
  (`docs/superpowers/plans/2026-10-23-machine-gui-restyle-phase1.md`) and its ledger (`.superpowers/sdd/2026-10-23-machine-gui-restyle-phase1/progress.md`:
  `:182` the deferred items, `:189-195` the parked R41–R47). For what the base added since `cfaa05b`: the Make-picker fix's brief
  and review rulings (`$SCRATCH/makefix-review/brief.md`, `fix-round-1.md`, rulings F1–F4) and shots
  (`$SCRATCH/makefix/1-new-project-drawer-auto-opened-800x900.png`, `2-target-picked-drawer-closed-800x900.png`,
  `3-target-picked-drawer-closed-390x844.png`); the add-on 17 integrator's report (`$SCRATCH/addon17-review/report.md`), its shots
  and their script (`$SCRATCH/addon17/*.png`, `final-shots.mjs`); and the restyle spec's as-built notes for both
  (`docs/superpowers/specs/2026-10-22-machine-gui-restyle-design.md:225-239` add-on 17, `:297-303` the Make picker).
- Every `file:line` is at `main` `01da27d` (`cfaa05b` plus add-on 23's pack textures, the Make-picker fix, and add-on 17 in the
  Machine GUI look with its three fixes). A file unchanged since `cfaa05b` reads the same at both; every anchor in a file that changed
  in between was moved and checked against its text. Once an earlier task has edited a file, find the cited code by its text.
- `$SCRATCH` = `/private/tmp/claude-501/-Users-drukoz-gtnh-planner/1fda0de6-6cd6-4a4f-ad51-448ca5885d74/scratchpad`, and
  `$P2` = `$SCRATCH/p2` (scratch scripts, never committed). The screenshot tour starts its own server on 18787: never run it beside
  `npm run e2e`; it serves the client `npm run e2e` last built.
- **Review shots** (every task from 1b on; spec §20: both looks at 1440 × 900 and 800 × 900): `node --disable-warning=ExperimentalWarning $P2/tour.mjs 1440 light <label>`,
  `… 1440 dark <label>`, `… 800 light <label>` and `… 800 dark <label>`, after `npm run e2e`; the task names the shots its reviewer compares with the
  mockups. A task that adds a screen first appends a `shot()` for it to `$P2/tour.mjs`.
- Rulings made while building go into the SDD ledger as `P2-R1`, `P2-R2`, … in the order they are made. This plan names each by its topic
  (the ruling `rider mechanism`), never by a number; Task 14 copies them into "As built".
- **Plan rulings** — where this plan departs from the spec's letter. Record each in the SDD ledger under its topic before Task 1a starts,
  for the controller's sign-off (the first four are the plan's own; the next twelve come from its re-checks against `96e9e99` and
  `01da27d`, each also a builder's call in the spec's §24, "Re-check against the new main"; the last six come from the user's choice of
  VT323 for figures on 2026-10-24 — `figures-vt323` is the controller's, the other five are builder's calls of the spec's §25, "Figures
  in VT323", which also re-measured `strip-figures`):
  - `baseline-shots`: Task 1a diffs the light look against fresh shots of the base taken by `$P2/tour.mjs`, not against the Phase 1
    after-shots of spec §19 and §20. Those were taken on 2026-10-23 between 18:06 and 18:32, before `fb8445c`, `9dbc4c1` (the Pause pipes
    button) and `c8c5736` (the missing pipe's red) changed the base's pixels, so no diff against them can be zero; `tour.mjs` is
    `shoot.mjs`, `shoot2.mjs` and `shoot3.mjs` merged, so it shoots the same screens. What differs between two runs of the base (clocks,
    generated ids) is masked pixel by pixel; no shot is left out.
  - `view-transition-split`: spec §4.9's one `::view-transition-old(root), ::view-transition-new(root)` list is written as two rules: the
    minifier once dropped the pseudo-element half of such a list (R28), and no e2e can read these two.
  - `motion-in-1b`: `src/client/state/motion.ts` is created in Task 1b, whose cross-fade needs `prefersReducedMotion()`, not in Task 13 as
    spec §19's new-files table lists it; Task 13a adds the glide constants.
  - `pseudo-tier-chip`: a crafting-table or furnace step that is not by hand draws no tier chip in Flow either. Spec §7.2 nulls the tier
    by hand only, while §8.1 gives a pseudo machine no chip on the card; such a step has no voltage tier, so both follow one rule.
  - `base-surfaces-dark`: the base's surfaces — add-on 17's Compare card, Plan for, farm fields and `.mat-taken`, the Make-picker
    fix's Settings readout and the drawer that opens by itself — get no dark rule and no name in the dark blocks: they read tokens, so
    Task 1b's blocks reach them. Spec §4 and the mockups predate them, so Tasks 1b and 14 check their light shots against the add-on 17
    and Make-picker shots (`$SCRATCH/addon17/`, `$SCRATCH/makefix/`) and their dark ones against `DarkMode.dc.html`'s palette. Two of
    their graphics fall below 3:1 in dark: `compare-frame-dark` and `farm-line-dark`.
  - `compare-frame-dark`: add-on 17's mode in use keeps its black `--outline` edge and its 2 px `--accent` ring in both looks. In dark
    the edge is 1.46:1 on the `#2a2a2a` panel; the ring, 13.46:1 on the panel and 19.69:1 on the edge, carries the frame, as the green
    carries the grid tick (§4.5). Task 1a measures the edge in light only; Task 1b measures the ring on the dark panel and records the
    dark edge as a reason. No rule or token changes.
  - `farm-line-dark`: add-on 17's farm fields keep their 2 px `var(--panel-lo)` line: 4.36:1 on the light panel, 1.35:1 on the dark one,
    a groove like the dark panel's own bevel shadow. It is decorative (the indent under the tick and the fields' labels group them), so
    Task 1b records the dark ratio as a reason and adds no token (`#7a7a7a` would be 3.34:1, for one decorative rule).
  - `aside-refocus` (R46, Task 11): when the window grows past 900 px with the drawer open, the settings column (the aside,
    `tabIndex={-1}`, through the page's `settingsPanel` ref) takes the focus only when the control that had it is no longer drawn — in
    practice the drawer-only Close settings. A Make search that the auto-open or `/` focused stays drawn and keeps it, as
    `drawer.spec.ts:578-615` requires; spec §17 R46's "when the aside holds `document.activeElement`" would take it off that search.
  - `shortcuts-button-wide` (P2-D29, Task 11): the head's Shortcuts button is drawn above 900 px only
    (`.project-head > .shortcuts-open { display: none; }` in the drawer's query). Below it the head's one row is full: the Settings
    button names the target, add-on 17 moved its Compare modes button under the banner for the same reason, and `objectives.spec.ts:91`,
    `drawer.spec.ts:535` and `:544` hold the head to 36 px at 800 px. `?` opens the sheet at every width, and the Flow and Connections
    hints say so; closing it gives the focus back to its opener while that is drawn, else to the Shortcuts button if drawn, else to the
    selected tab. Spec §3.6's and §14's "already 36 px" rows hold above 900 px (Task 11 measures 1280 × 720 and 901 × 900).
  - `farm-step-readout` (Task 4): add-on 17's farm steps (a Tree Growth Simulator, a Crop Manager) are machine steps in Flow: the farm
    machine's icon (`gregtech:gt.blockmachines@<mteId>`), a tier chip (the simulator's energy hatch tier, the manager's own:
    `pseudo-tier-chip` does not apply), the ×count, the power through `formatNumber` (a Crop Manager draws a fraction of an EU/t,
    `0.107 EU/t`) and the busy band; the slot never shows the sapling or the crop. Their words (`PlanStep.farm.text`, about 100
    characters) stay whole in `FlowNode.lines` (the head's name and its tip), and every line below the band is cut with "…" at the
    box's edge (`clipText`, as the title is).
  - `farm-step-card` (Task 5a): on the recipe card an item slot whose nominal amount is below 1 (a crop farm's expected drop: 0.9 Sticky
    Resin a harvest) is drawn as one at that amount as its chance (90 %), as NEI draws a drop that does not always come; a fluid keeps
    its litres, and GT's whole amounts are unchanged. A tree farm's tool (`PlanStep.farm.tools`), which add-on 17 models as consumed at
    chance 1 / its uses, is drawn as worn: no chance tag, its tip `wears 1 of its 512 uses per run` and its rate in the line. The rest
    is a machine's card; a crop farm's run is one harvest of one crop stick; the sapling the controller holds is left out.
  - `p2-d44-landed` (Task 7): add-on 17 merged before Phase 2, so P2-D44's premise (it merges after) is gone. Its Compare modes button
    stays where it put it — the head above 900 px, `.compare-bar` under the banner at 900 px or less — and Phase 2 builds nothing for
    it; the strip-row button P2-D44 sketched is not built (a sixth item would wrap the five tiles at 752 px). `<KeyNumbers>` is the first
    child of `.project-banners`, so the bar and the opened card sit below the strip and the card stays the box's last child
    (`objectives.spec.ts:59`). The §3.6 budget binds Phase 2 and holds: 657 → ≈ 685 < 700.
  - `strip-figures` (Task 7; re-measured in VT323 for spec §25, whose numbers replace §24's Pixelify ones): `main`'s `4bef36c` lets
    no Compare figure break: it stays on one line and shrinks to fit, down to 14 px since Task 2b (`compare-shrink-vt323`), before it is
    cut, for those figures are written in full (`2,097,152` is 100.8 px in the 28 px VT323). The strip keeps spec §10.2's one line
    (`.key-number dd`: `white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, now pinned), which its fixed 52 px tile
    needs, and does not shrink: its figures are `compactNumber`'s, at most 9 glyphs (`0.0000792`), at 11.2 px a glyph in VT323 28 px
    (`0.000792` 89.6 px, `99,999` 67.2, `0.0000792` 100.8), so every one stays whole inside the narrowest tile's 116 px (the grid's
    140 px less 2 × 2 of edge and 2 × 10 of padding). Only the end of a line can pass the edge — a unit after a long figure
    (`0.000792 /min`, 117.6 px; `99,999 raw/h`, 101.2 px, now fits) or a rare rate in words (`1 every 526 days`, Inter 15 px,
    119.5 px) — and the ellipsis cuts that, the tile's visually hidden copy and the `.plan-cost` sentence keeping it whole. With the
    fonts blocked (the size-adjusted Menlo) `0.0000792` is 116.5 px and can lose its last digit until VT323 arrives. Spec §21 leaves
    the strip's narrow layout to the builder.
  - `drawer-status-words` (Task 8): spec §17 R43's drawer status says `The plan is updating…` while a plan is on its way, not the
    banner's `Updating the plan…`. The Make-picker fix's `drawer.spec.ts:441` finds the banner's line by text with the drawer open, and
    a hidden copy would be its second match (strict mode; §3.8).
  - `drawer-status-count` (Task 8): R43's problem count leaves out the server's `no-target` hint ("Pick something to make"): a window
    of 900 px or less opens the drawer by itself, the focus in its item search, exactly when that hint is all a plan says, and the
    drawer is where it is answered. The plan's source notes (farms, other projects' surplus) are no problem either.
  - `compare-skeletons` (Task 8): D13 reaches add-on 17's Compare card, whose loading lines spec §11.1 predates. `skeleton-compare` sits
    beside "Planning the three modes…", which shows while the card has no answer for its target, each time up to the server's 20 s:
    the first compare once the card opens (a card whose target was cleared, `4bef36c`, or changed while it was closed, `68c06c1`,
    forgets its figures and opens on this line again), and, the card open, at once when another target is picked (`68c06c1`). It is
    three frames in the card's column grid, each framed as a column is and holding six 55 px blocks in the tiles' own grid
    (`.compare-rows`', which at `01da27d` stacks the tiles where a column is too narrow for two 160 px ones), so its blocks fall as the
    tiles will and each frame is as tall as a loaded column at every width. `skeleton-readouts`, six such blocks in that grid, sits under a
    mode's "Still planning…", so a pending column keeps its height. None beside "Updating…" (its columns stay drawn, as Connections'
    busy state) or beside the failed-fetch alert (no loading line).
  - `figures-vt323` (the controller's, binding; Task 2b, spec §25): the user chose VT323 for figures and kept Pixelify Sans for words,
    because Pixelify draws 5 like S, 2 like Z and 0 like O ("2,097,1S2", "S.4M"). A token, `--font-digits`, VT323 first and a fallback
    whose digits are distinct, never Pixelify; every element whose text is a figure or mainly figures (readouts, stack counts, chance
    tags, count chips, step numbers, figure badges, digit caps) uses it, and titles, headings, buttons, tabs, labels, the logo and word
    badges stay Pixelify; mixed text is decided element by element (whole VT323, or Pixelify with its figures in `span.fig`); sizes
    give the Pixelify digit heights, on fixed line heights, above a VT323 floor; the Compare shrink and `strip-figures` re-derived.
  - `digits-token` (Task 2b): `--font-digits: VT323, ui-monospace, Menlo, Consolas, monospace` (Chromium knows no `ui-monospace`, so
    the fallback is Menlo, 0.602 em a glyph), and every rule that sets it also sets `font-size-adjust: cap-height 0.56` after its
    `font`: VT323's own cap height is 0.56 em, so VT323 draws as specified and a fallback as tall (Menlo's 16 px "144L" 38.5 → 29.6
    px). That keeps `CHIP_CHAR_WIDTH` 9 and the 36 px slot right with the fonts blocked.
  - `digits-floor` (Task 2b): VT323 only at 14 px or more (digits 7.84 px): in the legibility shots, 13 px thins a stroke to half a
    pixel at 1×. The contract pins it as `DIGITS_FLOOR`; `span.fig`'s 1.15 em only sits in Pixelify text of 13 px or more (14.95 px).
  - `digits-mixed` (Tasks 2b, 3a, 4, 5a, 11): a readout that is a figure, on a screen or a slot, is set whole in VT323, its unit and few
    words too (the Compare tiles, the strip's values and units, the recipe readouts, stack counts, step numbers, the map's Y, the
    settings count, the 3D layer readout, the smart upload's total); any other pixel text that shows a figure writes it through
    `<Figs>`, in `span.fig` / `tspan.fig`, and keeps Pixelify for its words and for the `%` and `×` around it, which VT323 draws like
    an x (the NEI, map and 3D tooltips, the note badges and "Show all", the missing badge and used-by chips, the pin button, the line
    panel's "Rotate 90°", the swap list's "25 more… (55 not shown)", the note dialog's title, the Connections panel's title ("5× Basic
    Assembler", "Power tap at 12 64 7", "Titanium Dust 60/min · Red"), the banner's "does not add up" heading, the Flow count chip, the
    recipe card's chance tag, tier and overclock chips, the digit key caps); names and fixed words (a step's, item's or block's title,
    the project's name, buttons that name an item, the avoid chips, the tabs, the logo, word badges) stay Pixelify, digits and all.
  - `digits-sizes` (Tasks 2b, 5a, 7): each VT323 size gives digits as tall as the Pixelify ones it replaces (0.56 em against 0.643:
    × 1.148) and keeps the old line box in px — 13 → 15 px, 14 → 16, 18 → 21, 24 → 28; the step numbers' marker too, 16 px on the
    list's 20.3 px line, which its inherited 1.45 would make 23.2 — and `span.fig` is 1.15 em on a line height of 0. Spec §25's table
    lists every element.
  - `compare-shrink-vt323` (Task 2b): `.compare-row > dd` `font: 28px/26.390625px var(--font-digits)` and `font-size: clamp(14px,
    calc(100cqi / (var(--glyphs, 1) * 0.41)), 28px)`: 28 px gives the 24 px Pixelify digit height, 14 px is the floor, 0.41 is VT323's
    0.4 em advance with 2.5 % to spare (at 0.4 a figure measured 213.28 px in a 213.33 px box). The 26.390625 px line is the one 24 px/1.1
    gave as Chromium lays it out (it floors a unitless line height to 1/64 px; `26.4px`, which it rounds, made a tile 1/64 px taller
    and moved what is below the tiles: ruling P2-R13), now fixed, so a tile is 54.7 px at every size (it shrank with its figure
    before) and Task 8's 55 px blocks hold; `objectives.spec.ts:150-178`'s figures fit unshrunk at 860 and 768 px, with the fonts and
    without. With VT323 missing, a long
    figure — 12 glyphs or more in the narrowest, 160 px tile, 15 at 768 px, 17 at 860 px — ends in "…" (the size-adjusted fallback is
    0.46 em a glyph) until VT323 arrives; it still never breaks or spills (measured in the app at 768 and 860 px).
- Every commit message ends with the trailer line `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>` (as a second `-m`).

---

### Task 1a: Every themeable colour becomes a token, the light look unchanged, and the contrast test reads the tokens

**Files:**
- Create: `tests/client/css-blocks.ts`, `tests/client/contrast-phase1.json`
- Modify: `src/client/styles.css` — first `:root` (`:6-36`), panel ink group (`:69-74`; `:70` now also lists `.compare-card`), `:134`, `:138`, `:167`, `:218`, `:267`, `:342`, tabs (`:445-451`), `:611`, Flow `:root` (`:668-680`), `:698`, `:716`, `:722`, `:739`, `:771-772`, `:820`, `:837`, `:872`, `:891`, `:904`, `:1011`, `:1019`, `:1030`, `:1068`, Connections boxes (`:1086-1097`), `:1107`, `:1134`, `:1157`, `:1166`, `:1174`
- Modify: `src/client/views/ConnectionsView.tsx:186`
- Modify: `tests/client/styles-contract.test.tsx` — scanner `:14-86`, `TOKENS` `:104-131`, the pins of Step 3
- Modify: `tests/client/contrast.test.tsx` (rewritten in Step 4)
- Modify: `tests/client/connections-view.test.tsx:183`, `:191`, `:196`
- Scratch: `$P2/tour.mjs`, `$P2/common.mjs`, `$P2/maskdiff.py`

**Interfaces:**
- Consumes: —
- Produces:
  - Light tokens (spec §4.3 light values): first `:root` — `--bar-line`, `--grid`, `--btn-off`, `--btn-off-ink`, `--tab-face`, `--tab-face-hi`, `--tab-ink`, `--tab-face-hover`, `--rule`, `--veil`, `--press`, `--field-edge`, `--bevel-tick`, `--panel-error`, `--panel-ok`, `--panel-warn`, `--panel-focus`; Flow `:root` — `--flow-sink-line`, `--flow-group`, `--casing`, `--flow-focus`, `--flange`, `--dye-casing`, `--conn-box`, `--conn-face`, `--conn-face-link`, `--conn-chest`, `--conn-chest-line`, `--conn-interface`, `--conn-interface-line`, `--conn-source`, `--conn-source-line`, `--conn-hookup`, `--conn-hookup-line`.
  - `tests/client/css-blocks.ts`: `interface Block { prelude: string; inner: string; nested: boolean }`, `scan(src: string, nested: boolean, into: Block[]): Block[]`, `cssBlocks(src: string): Block[]`, `declarations(body: string): [string, string][]`, `type Look = 'light' | 'dark'`, `themeTokens(blocks: readonly Block[], look: Look): Map<string, string>`, `resolveToken(tokens: ReadonlyMap<string, string>, value: string): string`.
  - `contrast.test.tsx`: `type Paint = string | { over: Paint; on: Paint }` (a token `--x`, a `#rrggbb`, or `over` alpha-composited on `on`), `type Pair = [what: string, fg: Paint, bg: Paint, min: number, looks?: readonly Look[]]`, `colour(look: Look, paint: Paint): string` (`#rrggbb`), the one table `PAIRS: Pair[]` every later task appends to, `AA = 4.5`, `GRAPHICS = 3`; `PHASE1_PAIRS`, the 155 `[what, fg, bg]` light pairs measured before Phase 2 (Phase 1's 142, the Make-picker fix's 1, add-on 17's 12), read from `contrast-phase1.json` (the file keeps its name: it holds what was measured before Phase 2).
  - `$P2/tour.mjs <width> <look> <label>` writing `$SCRATCH/shots-p2/<label>/<look>-<width>/*.png`; `python3 -I $P2/maskdiff.py <base-a dir> <base-b dir> <new dir>`.

- [ ] **Step 1: Pre-flight, the tour script and the baseline shots**

In the worktree: `npm ci`; `npm test` → green (the base, `main` `01da27d`, closes at 3300 passed / 188 skipped, 221 test files passed
and 18 skipped: the 3293 the add-on 17 integrator reported at `96e9e99`, and the seven cases its three fixes added in files that were
there; `main` `29567a7` alone was 3139 / 188); `npm run e2e` → green (71 passed: Phase 1's 54, the Make-picker fix's 10 new
`drawer.spec.ts` cases, add-on 17's 7 in `objectives.spec.ts`). Report any other count. Copy `$SCRATCH/t10/tour.mjs` and `$SCRATCH/t10/common.mjs` to `$P2/`; in both set `REPO` to the worktree;
in `tour.mjs` read `process.argv[3]` (`light` | `dark`, default `light`) as the `colorScheme` of the main context (`:175`) and of
the high-DPI one (`:659`), and `process.argv[4]` as the label, writing to `$SCRATCH/shots-p2/<label>/<look>-<width>/`; and delete
its "the OS in dark mode" contexts (`:574-656`: the `dctx` shots `40-dark-login` … `47-dark-world` and their light twins `40L`–`47L`),
which after Task 1b would shoot the dark look in a `light` run (the `dark` runs shoot it now; the high-DPI close-ups after them stay).
Before the baseline runs, adapt the tour to the base's screens (`$SCRATCH/addon17/final-shots.mjs` drives the same ones):
- (a) In `shot()` and `elShot()` (whose page is `locator.page()`): when `await page.locator('.project-head').count()` is non-zero, first
  `await page.locator('.project-head .connection.live').waitFor({ timeout: 15_000 })`. At 800 px the head is one row only while the
  stream is live (ruling F3): a run that catches "reconnecting…" shifts the page by 52 px, and the mask would swallow the shot.
- (b) The 'empty project' step: at 800 px (`NARROW`) its shots `24` and `24b` now show the drawer that opens by itself for a project
  with no target. Before shot `24`, `poll` until `aside.settings-panel` computes `visibility: visible` and
  `p.locator('#project-settings').getByPlaceholder('Search items and fluids')` is `document.activeElement`.
- (c) A new step `'compare card, plan for and farms'`, between 'hull line flow' and 'empty project', on `ids.hull`, that project's
  last use, so the farm tick's replan touches no later shot (a project of its own would make the 'project list' step's four cards five):
  - `` await p.goto(`/p/${ids.hull}#flow`); await waitFlow(p); ``, then click
    `p.locator(NARROW ? '.compare-bar .compare-toggle' : '.project-head > .compare-toggle')`.
  - In `const card = p.getByRole('region', { name: 'Compare modes' })`, wait with `{ timeout: 60_000 }` (a compare may take the
    server's 20 s limit) for `card.locator('[data-objective="' + o + '"]').getByText('Raw per hour')`, for each `o` of `least-raw`,
    `cheapest`, `multi-output`; then `countIs(card.locator('[role="status"]'), 0, 'no Updating…')`.
  - `await p.mouse.move(WIDTH - 5, 895); await sleep(700);`, `shot(p, '51-compare-open')`, then
    `shot(p, '51b-compare-open-fullpage', { fullPage: true })`; close it with `card.getByRole('button', { name: 'Close' })`.
  - If `NARROW`: `elShot(p.locator('.project-head'), '53-head-settings-readout')`.
  - `await openSettings(p)`; in `const aside = p.locator('aside.settings-panel')`, check
    `aside.getByRole('checkbox', { name: 'Tree Growth Simulator', exact: true })`, wait for `aside.locator('.farm-fields').first()`,
    then `sleep(400)`.
  - `elShot(aside.locator('.settings-section', { has: p.locator('legend', { hasText: 'Plan for' }) }), '52-settings-plan-for')` and
    `elShot(aside.locator('.settings-section', { has: p.locator('h3', { hasText: /^Farms$/ }) }), '52b-settings-farms')`.
  - Uncheck the box; `await closeSettings(p); await top(p);`. The masks between `base-a` and `base-b` must stay under 5 % on these
    shots too.

Then run `node --disable-warning=ExperimentalWarning $P2/tour.mjs 1440 light base-a`, `… 800 light base-a`, and the same two as
`base-b` (plan ruling `baseline-shots`). Write `$P2/maskdiff.py` from `$SCRATCH/t10/imgdiff.py`: for each shot of the new directory it
masks the pixels where `base-a` and `base-b` differ (grown by 2 px) and prints `identical` or `<n> px differ outside the mask, bbox …`,
with the mask's size. Run it on `base-a base-b base-b` to see the masks (clocks, generated ids) and report any mask over 5 % of its shot.

- [ ] **Step 2: Move the stylesheet scanner into `tests/client/css-blocks.ts`**

Move `Block`, `closingBrace`, `scan` and `declarations` (`styles-contract.test.tsx:14-86`) verbatim and export them, plus
`cssBlocks(src)` (= `scan(src.replace(/\/\*[\s\S]*?\*\//g, ''), false, [])`); the contract imports them and builds
`const blocks = cssBlocks(css)`. Add `themeTokens(blocks, look)` — every non-nested `:root` block's declarations, later ones
replacing earlier ones, then for `'dark'` those of the non-nested `:root[data-theme='dark']` block (there is none until Task 1b) —
and `resolveToken(tokens, value)`, which replaces each `var(--x)` / `var(--x, fallback)` with the token's value (else the
fallback), recursively, and throws on an unknown token without a fallback.
Run: `npx vitest run tests/client/styles-contract.test.tsx` → PASS (a pure move).

- [ ] **Step 3: Write the failing contract changes**

`TOKENS` gains, at the light values of spec §4.3: `['--bar-line', '#3c3c3c']`, `['--grid', '#404040']`, `['--btn-off', '#4a4a4a']`,
`['--btn-off-ink', '#a0a0a0']`, `['--tab-face', '#8b8b8b']`, `['--tab-face-hi', '#a8a8a8']`, `['--tab-ink', '#1b1b1b']`,
`['--tab-face-hover', '#9a9a9a']`, `['--rule', '#8b8b8b']`, `['--veil', 'rgb(255 255 255 / 0.35)']`, `['--press', 'rgb(0 0 0 / 0.15)']`,
`['--field-edge', '#a0a0a0']`, `['--bevel-tick', 'var(--bevel-slot)']`, `['--panel-error', '#aa0000']`, `['--panel-ok', '#1e5a1e']`,
`['--panel-warn', '#6a4000']`, `['--panel-focus', '#1b1b1b']`, `['--flow-sink-line', 'var(--flow-raw-line)']`, `['--flow-group', '#cbbbe0']`,
`['--casing', '#1b1b1b']`, `['--flow-focus', '#1b1b1b']`, `['--flange', 'var(--slot)']`, `['--dye-casing', '#c6c6c6']`,
`['--conn-box', 'var(--panel)']`, `['--conn-face', '#e0e0e0']`, `['--conn-face-link', '#1d3b9a']`, `['--conn-chest', '#f0d870']`,
`['--conn-chest-line', '#6b5500']`, `['--conn-interface', '#cbbbe0']`, `['--conn-interface-line', '#5a3a8a']`, `['--conn-source', '#d8cfa8']`,
`['--conn-source-line', '#6b5a20']`, `['--conn-hookup', '#a8a8a8']`, `['--conn-hookup-line', 'var(--outline)']`.

These pins change, literal → token (spec §3.9 row 2; [TL] §2.2):

| `styles-contract.test.tsx` | Expected now |
|---|---|
| `:230-231` (panel ink group) | `'--ink: var(--text)', '--ink-muted: var(--text-muted)', '--ink-title: var(--title)', '--ink-link: var(--link)', '--ink-error: var(--panel-error)', '--ink-ok: var(--panel-ok)', '--ink-warn: var(--panel-warn)'` |
| `:470` | `toEqual(['var(--panel-focus)'])` |
| `:317`, `:433` | `background` `var(--btn-off)`; `:317` `color` `var(--btn-off-ink)` |
| `:353`, `:610`, `:1029` | `2px solid var(--field-edge)` / `var(--field-edge)` / `2px solid var(--field-edge)` |
| `:381` | `[TICK, 'box-shadow', 'var(--bevel-tick)']` |
| `:571` | `['.top-nav', 'box-shadow', 'inset 0 -2px 0 var(--bar-line)']` |
| `:676-679` | `var(--tab-face)`, `inset 2px 2px 0 var(--tab-face-hi)`, `var(--tab-ink)`, hover `var(--tab-face-hover)`, selected `inset 2px 2px 0 var(--panel-hi)` and `color` `var(--text)` |
| `:1076`, `:1687`, `:1704` | `1px solid var(--rule)` |
| `:1250` | `['.flow-port', 'fill', 'var(--flange)']` |
| `:1259`, `:1487` | `'linear-gradient(var(--grid) 1px, transparent 1px), linear-gradient(90deg, var(--grid) 1px, transparent 1px)'` |
| `:1319` | `['.flow-group-box', 'stroke', 'var(--flow-group)'], ['.flow-group-title', 'fill', 'var(--flow-group)']` |
| `:1415` | `[CONN_CASING, 'stroke', 'var(--pipe-casing, var(--casing))']` |
| `:1465`, `:1531`, `:1544` | `var(--casing)` |
| `:1503-1508` | `var(--conn-box)`, `var(--conn-face)`, `var(--conn-chest)`, `var(--conn-chest-line)`, `var(--conn-interface)`, `var(--conn-interface-line)`, `var(--conn-source)`, `var(--conn-source-line)`, `var(--conn-hookup)` |
| `:1527` | `['.conn-node .conn-face', 'fill', 'var(--conn-face-link)']` |
| `:1710` | ``[`${ROW}:hover`, 'background', 'var(--veil)']`` |

And new pins for the rules no test read: `['.flow-node-head:focus-visible > .flow-hit, .flow-row:focus-visible > .flow-hit', 'stroke', 'var(--flow-focus)']`,
`['.flow-node.sink > .flow-node-box', 'stroke', 'var(--flow-sink-line)']`, `['.swatch.sink', 'border-color', 'var(--flow-sink-line)']`,
`['.flow-group-box', 'fill', 'var(--flow-group)']`, `['.flow-panel-section', 'border-top', '1px solid var(--rule)']`,
`['.option-slot', 'border', '1px solid var(--rule)']`, `['button.mat-toggle:hover', 'background', 'var(--press)']`,
`[CONN_DASHED, 'stroke', 'var(--conn-hookup-line)']`, `['.mat-taken', 'color', 'var(--ink-muted)']` (add-on 17's taken-by rows under
a left-over byproduct, on the Materials panel: the panel ink's `--text-muted`; it passes at once, as a guard).
`connections-view.test.tsx:183`, `:191`, `:196`: `'--pipe-casing:var(--panel)'` → `'--pipe-casing:var(--dye-casing)'` (spec §3.9 row 4).

- [ ] **Step 4: Rewrite `contrast.test.tsx` to read the tokens (closes Phase 1's F4)**

First capture what the base measured: a temporary case at the end of the base file writes `[what, fg, bg]` for every row of `PAIRS`,
`FLOW_PAIRS`, `CONN_PAIRS`, `CARRIERS`, `MAP_PAIRS`, `SCREEN_PAIRS` and `ADDON17_PAIRS` (`:223-230`), `` [`channel dye ${dye}`, hex, casing] ``
for each of the 16 dyes of `:119-122`, and the eight `toBeGreaterThanOrEqual` lines inside the reason cases (`:136`, `:141`, `:142`,
`:198`, `:199`, and the base's `:212`, `:238`, `:239`) as
`['missing casing on the well', '#ff5555', '#373737']`, `['white head on the missing casing', '#ffffff', '#ff5555']`,
`['white head on the well', '#ffffff', '#373737']`, `['failed scan bar', '#e03c3c', '#1b1b1b']`, `['scan bar', '#55ff55', '#1b1b1b']`,
`['Settings target part on its readout', '#aaaaaa', '#1b1b1b']`, `['mode-in-use edge on the panel', '#000000', '#c6c6c6']`,
`['mode-in-use ring on the edge', '#ffff55', '#000000']`
to `tests/client/contrast-phase1.json` (155 rows: Phase 1's 142, the Make-picker fix's 1, add-on 17's 12; counted at `01da27d`, whose
fixes changed only the comment above `ADDON17_PAIRS`: the six `it.each` tables' 124 rows, 7 carriers, 16 dyes and those 8 lines); run
it once, then delete the case. Keep `channel`, `luminance`, `ratio`, `TIERS`,
`DYE_HEX`, `DARK_DYES`, the calibration case `'measures the way the spec does'` (`:47-52`) verbatim, and the `toBeLessThan` lines of
every reason case as they are, with the constants they read (`DARK_CASING`, `WELL`, `STONE`, and `PANEL`, which add-on 17's frame case
reads at `:241`): they are literal reasons. The base's two reason cases stay in their describes with their `toBeLessThan` lines: the
Make-picker fix's `'reads the muted ink on its dark readout, and needs it: on the button\'s face the ink falls short'` (`:213-214`,
`#aaaaaa` on `#6b6b6b` and on `#4a5499`) and add-on 17's `'frames the mode in use with a black edge the panel shows, and a yellow ring
the edge shows'` (`:241`, `#ffff55` on `PANEL`). Those eight
`toBeGreaterThanOrEqual` lines leave their cases for `PAIRS` (spec §3.5: one pair table, run in both looks); `SCREEN` and
`CHAT_OVER_PANEL` are read only by rows that move, so they go with the other table constants. Parse once:
`const blocks = cssBlocks(readFileSync(new URL('../../src/client/styles.css', import.meta.url), 'utf8'))`;
`colour(look, paint)` resolves a token with `resolveToken(themeTokens(blocks, look), …)`, parses `#rgb`, `#rrggbb`, `rgb(r g b / a)` and
`rgba(r, g, b, a)`, and composites `{ over, on }` channel by channel (`round(over × a + on × (1 − a))`). Every `it.each` table
(`PAIRS`, `FLOW_PAIRS`, `CONN_PAIRS`, `MAP_PAIRS`, `SCREEN_PAIRS`, `ADDON17_PAIRS`), the carriers, the dye case and those eight lines become rows of one
`PAIRS: Pair[]`, each keeping its `what` (the JSON's), with every literal that is a token's light value replaced by that token:

| Literal | Paint |
|---|---|
| `#2b2b2b` (STONE) / page ink `#dddddd #aaaaaa #ffffff #ffff55 #ff5555 #55ff55 #ffaa00` | `--page` / `--ink --ink-muted --ink-title --ink-link --ink-error --ink-ok --ink-warn` |
| `#c6c6c6` (PANEL) / panel ink `#303030 #4a4a4a #404040 #1a3fa0 #aa0000 #1e5a1e #6a4000` | `--panel` / `--text --text-muted --title --link --panel-error --panel-ok --panel-warn` |
| `#1b1b1b` as a screen / as a casing (DARK_CASING) | `--screen` / `--casing` |
| `#373737` (WELL) | `--well` |
| `#6b6b6b`, `#4a5499`, `#aa0000` (face), `#c62828` | `--btn`, `--btn-hover`, `--danger-face`, `--danger-face-hover` |
| `#1b1b1b` on `#8b8b8b` (unselected tab) / `#303030` on `#c6c6c6` (selected) | `--tab-ink` on `--tab-face` / `--text` on `--panel` |
| Flow fills `#c6c6c6 #b9d6b0 #d8cfa8 #e3b0b0 #f0d870 #a8a8a8 #cbbbe0` | `--flow-new --flow-owned --flow-import --flow-missing --flow-out --flow-sink --flow-line` |
| Flow `#990000`, `#6a4000`, open-line title `#cbbbe0` | `--flow-error`, `--flow-warn`, `--flow-group` |
| Connections fills `#c6c6c6 #f0d870 #cbbbe0 #d8cfa8 #a8a8a8`, face `#e0e0e0`, link `#1d3b9a` | `--conn-box --conn-chest --conn-interface --conn-source --conn-hookup`, `--conn-face`, `--conn-face-link` |
| `PANEL_CASING` `#c6c6c6` (the seven dark dyes' casing) | `--dye-casing` |
| `TIP_OVER_WHITE` `#1e0f1e` / `CHAT_OVER_PANEL` `#242424` / `VEILED_PANEL` `#dadada` | `{ over: '--tip-bg', on: '#ffffff' }` / `{ over: '--chat', on: '--panel' }` / `{ over: '--veil', on: '--panel' }` |
| scan chips, readouts, fits badges, picked row, the scan bar `#aaaaaa #55ff55 #ffff55` on a screen | `--screen-muted`, `--screen-text`, `--accent` on `--screen` |
| the missing casing `#ff5555`, the failed scan's `#e03c3c`, a white head `#ffffff` | stay literals: the stylesheet draws them so, the same in both looks |

The base's rows, each `what` exactly the JSON's (three of the table's rules would mis-map them: the Settings readout's `#aaaaaa` is the
page's `--ink-muted`, not `--screen-muted`; the notes' inks are the dark-box group's literals; the mode-in-use edge needs a light-only row):
- `['card and column titles', '--title', '--panel', AA]`
- `['"Updating…" beside the title', '--text-muted', '--panel', AA]`
- `['tile label', '--screen-muted', '--screen', AA]`
- `['tile value', '--screen-text', '--screen', AA]` (also a value shrunk toward 13 px, or cut with its ellipsis, by `4bef36c`'s
  no-break rule: the same ink on the same screen, measured at AA as any small text; that rule adds no colour and no pair)
- `['note', '#ffffff', { over: '--chat', on: '--panel' }, AA]`
- `['note of a mode still planning', '#aaaaaa', { over: '--chat', on: '--panel' }, AA]`
- `['note of a mode that failed', '#ff5555', { over: '--chat', on: '--panel' }, AA]` (the notes' inks are the dark-box group's
  literals, the same in both looks)
- `['Compare modes while the card is open', '--accent', '--btn', AA]`
- `['Compare modes while open, under the pointer', '--accent', '--btn-hover', AA]`
- `['a hint of Plan for', '--text-muted', '--panel', AA]`
- `['Settings target part on its readout', '--ink-muted', '--screen', AA]` (the part reads the page's `--ink-muted`: the readout sits
  in the head on the stone, `styles.css:1374`)
- `['mode-in-use edge on the panel', '--outline', '--panel', GRAPHICS, ['light']]` (12.29:1; the dark edge is Task 1b's,
  plan ruling `compare-frame-dark`)
- `['mode-in-use ring on the edge', '--accent', '--outline', GRAPHICS]` (19.69:1 in both looks)

Add the rows the old tables lacked: page ink on `--page-check`, and `['hovered tab', '--tab-ink', '--tab-face-hover', AA]`. Run the table
for both looks (before Task 1b the dark look reads the light tokens, so it repeats the light results):

```ts
const LOOKS: readonly Look[] = ['light', 'dark'];
describe.each(LOOKS)('contrast in the %s look', (look) => {
  it.each(PAIRS.filter(([, , , , looks]) => looks === undefined || looks.includes(look)))('%s', (_what, fg, bg, min) => {
    expect(ratio(colour(look, fg), colour(look, bg))).toBeGreaterThanOrEqual(min);
  });
});
it('reads the light tokens as the literals Phase 1 measured', () => {
  expect(colour('light', '--panel')).toBe('#c6c6c6');
  expect(colour('light', '--flow-new')).toBe('#c6c6c6');
  expect(colour('light', { over: '--tip-bg', on: '#ffffff' })).toBe('#1e0f1e');
  expect(colour('light', { over: '--chat', on: '--panel' })).toBe('#242424');
  expect(colour('light', { over: '--veil', on: '--panel' })).toBe('#dadada');
});
const PHASE1_PAIRS = JSON.parse(readFileSync(new URL('./contrast-phase1.json', import.meta.url), 'utf8')) as Array<[string, string, string]>;
it('still measures every pair measured before Phase 2, at the same light colours', () => {   // the guard of the rewrite (spec §3.5)
  expect(PHASE1_PAIRS).toHaveLength(155); expect(PAIRS.length).toBeGreaterThanOrEqual(PHASE1_PAIRS.length);
  for (const [what, fg, bg] of PHASE1_PAIRS) {
    expect(PAIRS.some(([w, f, b]) => w === what && colour('light', f) === fg && colour('light', b) === bg), `${what}: ${fg} on ${bg}`).toBe(true);
  }
});
```

- [ ] **Step 5: Run them to see them fail**

Run: `npx vitest run tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx tests/client/connections-view.test.tsx`
Expected: FAIL — `TOKENS` rows undefined (`--bar-line` …), the pins still read literals (`inset 0 -2px 0 #3c3c3c` ≠ `inset 0 -2px 0 var(--bar-line)`),
`resolveToken` throws on `--tab-face`, and the dye casing is `var(--panel)`.

- [ ] **Step 6: Tokenise the stylesheet and the dye casing**

Add the tokens of the Interfaces block: the general ones in the first `:root` after the page-ink line (`:31-32`), the Flow and
Connections ones in the Flow `:root` after `--flow-hover` (`:679`). Each pin of Step 3 changes its rule exactly as the pin says, and
the panel ink group (`:71-72`) becomes `--ink: var(--text); --ink-muted: var(--text-muted); --ink-title: var(--title); --ink-link:
var(--link); --ink-error: var(--panel-error); --ink-ok: var(--panel-ok); --ink-warn: var(--panel-warn); --ink-focus: var(--panel-focus)`.
Also: `:716` gains `stroke: var(--flow-sink-line)`; `:820` gains `border-color: var(--flow-sink-line)`; `:771` takes `fill:
var(--flow-group)` and `stroke: var(--flow-group)`; `:722` `stroke: var(--flow-focus)`; `:837` and `:872` `1px solid var(--rule)`; `:904`
`background: var(--press)`; the dashed hookup rule (`:1097`) gains `stroke: var(--conn-hookup-line)`. The dark-box ink group (`:78-85`)
and every literal spec §4.4 lists as the same in both looks stay. `ConnectionsView.tsx:186`: `'--pipe-casing': 'var(--dye-casing)'`.
The rules the base added need nothing here. These are add-on 17's (`:394-425`: the open Compare button, the bar, the card, its columns
and tiles, the tiles' no-break rule of `4bef36c` among them; `:600-603`: Plan for, the farm fields, `.stat-input`; `:921`: `.mat-taken`),
the Make-picker fix's (`.settings-toggle-target` `:1372-1375` in the 900 px block, and the 700 px block `:1392-1394`) and the two
forced rules at `:1428-1429`. They read tokens or system colours only. Their one literal, `#3f3f15` (the open Compare button's text
shadow, `:394`), is a button-text shadow, which spec §4.4 keeps. The panel ink group's rewrite reaches `.compare-card` (`:70`); the
dark-box group keeps `.compare-card > :where(p), .compare-column > :where(p)` (`:81`) on its literals.

- [ ] **Step 7: Run everything**

Run: `npm test` → PASS; `npm run e2e` → PASS (71; nothing new).

- [ ] **Step 8: Prove the light look did not move**

Run the tour at `1440 light 1a` and `800 light 1a`; `python3 -I $P2/maskdiff.py` on `base-a`, `base-b` and `1a` at each width → every
shot `identical` outside its mask. A differing pixel is a regression to fix before the commit, never a reason to widen a mask.

- [ ] **Step 9: Commit**

```bash
git add src/client/styles.css src/client/views/ConnectionsView.tsx tests/client/css-blocks.ts tests/client/contrast-phase1.json tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx tests/client/connections-view.test.tsx
git commit -m "refactor(client): every themeable colour is a token, and contrast reads the tokens; the light look is unchanged" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 1b: The dark look and the Theme button

**Files:**
- Create: `src/client/state/theme.ts`, `src/client/state/motion.ts`, `src/client/components/ThemeButton.tsx`, `tests/client/theme.test.tsx`
- Modify: `src/client/styles.css` — header comment `:1-5`, first `:root` (new tokens), the dark section (new, between `:36` and `:38`), slider thumbs `:190-197`, after `.top-nav nav a[aria-current='page']` (`:285`)
- Modify: `src/client/components/TopNav.tsx:8-19`, `src/client/index.html:8-9`, `src/client/main.tsx:12-19`
- Modify: `tests/client/scaffold.test.tsx` (after `:36-42`), `tests/client/styles-contract.test.tsx` (`:157-162`, `TOKENS`, new cases), `tests/client/contrast.test.tsx`
- Modify: `tests/e2e/theme.spec.ts` (rewritten), `tests/e2e/helpers.ts`, `tests/e2e/focus.spec.ts`

**Interfaces:**
- Consumes: Task 1a's tokens, `css-blocks.ts`, `PAIRS`/`colour`.
- Produces:
  - `src/client/state/theme.ts` exactly as spec §4.7: `type ThemeChoice = 'auto' | 'dark' | 'light'`, `THEME_KEY = 'gtnh-planner:theme'`, `THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'dark', 'light']`, `getThemeChoice(): ThemeChoice`, `setThemeChoice(choice: ThemeChoice): void`, `nextThemeChoice(choice: ThemeChoice): ThemeChoice`, `applyTheme(choice: ThemeChoice, root?: Pick<Element, 'setAttribute' | 'removeAttribute'>): void`, `subscribeThemeChoice(fn: () => void): () => void`, `useThemeChoice(): ThemeChoice`, `startTheme(): () => void`.
  - `src/client/state/motion.ts`: `prefersReducedMotion(): boolean` (`globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false`, read at each call). Task 13a adds the constants (plan ruling `motion-in-1b`).
  - `src/client/components/ThemeButton.tsx`: `ThemeButton(props: { choice: ThemeChoice }): ReactElement` (hook-free).
  - Feature tokens every later task uses (light and dark values of spec §4.3): `--screen-lo`, `--thumb`, `--flow-chip`, `--flow-busy-track`, `--flow-busy`, `--flow-busy-high`, `--stack-ink`, `--stack-shadow`, `--bevel-inset`, `--bevel-screen`, `--energy`, `--progress-base`, `--skeleton`, `--skeleton-well`, `--sheen`, `--tip-mod`, `--icon-auto`, `--icon-moon`, `--icon-sun`. Later tasks never edit the dark blocks.
  - Contract: `DARK_TOKENS: [string, string][]`, `PHASE2_RULES: string[]` (later tasks append every selector they add), `SAME_IN_BOTH`.
  - e2e `tests/e2e/helpers.ts`: `setTheme(page: Page, choice: 'auto' | 'dark' | 'light'): Promise<void>`, `LV_CIRCUITS: Partial<PlanSettings>` (`{ target: 't:circuit@0', amount: 30, per: 'min', tier: 1 }`), `openWithPlan(page: Page, plan: Plan, settings?: Partial<PlanSettings>): Promise<string>` (flow-focus.spec.ts:13-20's, exported; the existing local copies stay) — its `settings` default to `LV_CIRCUITS`, as flow-focus.spec.ts:13's do (a project with no target opens the drawer by itself below 900 px) — and `SETTINGS_BUTTON = /^Settings/` (the Settings button: its name goes on with what the line makes, "Settings · Make: Basic Circuit"; drawer.spec.ts's own `SETTINGS_BUTTON` and `TARGET` stay, as the local `openWithPlan` copies do).
  - `theme.spec.ts`: `interface DarkRow { what: string; selector: string; property: string; expected: string; pseudo?: string }`, `interface DarkStop { name: string; open(page: Page): Promise<void>; rows: DarkRow[]; close?(page: Page): Promise<void> }`, `DARK_TOUR: DarkStop[]` — later tasks append rows and stops. The spec runs one test per stop (`` for (const stop of DARK_TOUR) test(`the dark tour: ${stop.name}`, …) ``), each in a fresh `colorScheme: 'dark'` context, logged in and named, so no stop's route leaks into the next and no test nears the 30 s timeout as the tour grows; `close` releases what `open` held (a held request) before the context closes.

- [ ] **Step 1: Write the failing unit and contract tests**

`tests/client/theme.test.tsx` (the `keepIn`/`refuse` helpers of `pipes-paused.test.tsx:13-21`;
`afterEach(() => { vi.stubGlobal('localStorage', keepIn(new Map())); setThemeChoice('auto'); vi.unstubAllGlobals(); })`: a choice that storage
keeps sets the module's page value back to null, which `vi.unstubAllGlobals()` alone would not):

```ts
it('reads Auto by default, keeps each choice, and reads junk as Auto', () => {
  expect(THEME_KEY).toBe('gtnh-planner:theme'); expect(THEME_CHOICES).toEqual(['auto', 'dark', 'light']);
  const store = new Map<string, string>(); vi.stubGlobal('localStorage', keepIn(store));
  expect(getThemeChoice()).toBe('auto');
  for (const choice of ['dark', 'light', 'auto'] as const) { setThemeChoice(choice); expect([store.get(THEME_KEY), getThemeChoice()]).toEqual([choice, choice]); }
  store.set(THEME_KEY, 'sepia'); expect(getThemeChoice()).toBe('auto');
});
it('keeps the choice for the page when storage refuses, or can be read but not written', () => {   // pipes-paused.test.tsx:56-72
  vi.stubGlobal('localStorage', { getItem: refuse, setItem: refuse, removeItem: refuse });
  expect(getThemeChoice()).toBe('auto'); expect(() => setThemeChoice('dark')).not.toThrow(); expect(getThemeChoice()).toBe('dark');
  vi.stubGlobal('localStorage', { getItem: () => 'light', setItem: refuse, removeItem: refuse });   // a stale value it can still read
  setThemeChoice('auto'); expect(getThemeChoice()).toBe('auto'); setThemeChoice('dark'); expect(getThemeChoice()).toBe('dark');
});
it('tells subscribers, re-reads on a storage event of its key or of a cleared storage, and stops when left', () => {
  const heard = vi.fn(); const storage: Array<(e: { key: string | null }) => void> = [];
  vi.stubGlobal('addEventListener', (type: string, fn: never) => { if (type === 'storage') storage.push(fn); }); vi.stubGlobal('removeEventListener', () => {});
  const leave = subscribeThemeChoice(heard); setThemeChoice('dark'); expect(heard).toHaveBeenCalledTimes(1);
  storage[0]!({ key: THEME_KEY }); storage[0]!({ key: null }); storage[0]!({ key: 'other' }); expect(heard).toHaveBeenCalledTimes(3);
  leave(); setThemeChoice('light'); expect(heard).toHaveBeenCalledTimes(3);
});
it('cycles Auto → Dark → Light → Auto', () => expect(THEME_CHOICES.map(nextThemeChoice)).toEqual(['dark', 'light', 'auto']));
it('applies Dark and Light as data-theme, and Auto as none', () => {
  const root = { setAttribute: vi.fn(), removeAttribute: vi.fn() };
  applyTheme('dark', root); applyTheme('light', root); applyTheme('auto', root);
  expect(root.setAttribute.mock.calls).toEqual([['data-theme', 'dark'], ['data-theme', 'light']]);
  expect(root.removeAttribute.mock.calls).toEqual([['data-theme']]);
});
it('draws the Theme button for each choice, and its click moves to the next', () => {
  expect(renderToStaticMarkup(<ThemeButton choice="auto" />)).toBe('<button type="button" class="theme-button" data-choice="auto">Theme: Auto</button>');
  expect(renderToStaticMarkup(<ThemeButton choice="dark" />)).toBe('<button type="button" class="theme-button" data-choice="dark">Theme: Dark</button>');
  expect(renderToStaticMarkup(<ThemeButton choice="light" />)).toBe('<button type="button" class="theme-button" data-choice="light">Theme: Light</button>');
  vi.stubGlobal('localStorage', keepIn(new Map())); (ThemeButton({ choice: 'dark' }).props.onClick as () => void)(); expect(getThemeChoice()).toBe('light');
});
it('applies a stored Dark or Light in the head, before the app, and nothing else', () => {
  const html = readFileSync(new URL('../../src/client/index.html', import.meta.url), 'utf8');
  const body = /<script>([\s\S]*?)<\/script>/.exec(html)![1]!;          // an attribute-less <script>: no type, no src
  expect(html.indexOf('<script>')).toBeGreaterThan(html.indexOf('<title>')); expect(html.indexOf('<script>')).toBeLessThan(html.indexOf('</head>'));
  expect(body).toContain(`'${THEME_KEY}'`);
  const run = (stored: string | null | 'throws'): unknown[][] => {
    const root = { setAttribute: vi.fn() };
    new Function('document', 'localStorage', body)({ documentElement: root }, { getItem: () => { if (stored === 'throws') throw new Error('refused'); return stored; } });
    return root.setAttribute.mock.calls;
  };
  expect(run('dark')).toEqual([['data-theme', 'dark']]); expect(run('light')).toEqual([['data-theme', 'light']]);
  for (const stored of ['auto', 'junk', null, 'throws'] as const) expect(run(stored), String(stored)).toEqual([]);
});
```

`scaffold.test.tsx`, beside `:36-42` (kept): `expect(renderToStaticMarkup(<TopNav current="/" />)).toMatch(/<\/nav><button type="button" class="theme-button" data-choice="auto">Theme: Auto<\/button><\/header>$/)`.

Contract: replace "has one theme" (`:157-162`) with
`it('has a light and a dark look; Auto follows the OS', …)` — with `DARK = ":root[data-theme='dark']"`, `AUTO_DARK = '@media (prefers-color-scheme: dark)'`,
`AUTO_ROOT = ":root:not([data-theme='light'])"`: exactly one non-nested `DARK` block and one `AUTO_DARK` block, whose only rule is
`AUTO_ROOT`; `declarations(dark.inner)` equals `inQuery(AUTO_DARK, AUTO_ROOT)`; every name in it is in `rootTokens()` and none matches
`/^--(dur|ease|font|gap|tier|accent|item|fluid|chat|tip)/`; its names sorted equal `DARK_TOKENS`' and each value equals its row (every
dark value of spec §4.3: `--page #141414` … `--stack-shadow #000000`, `--bevel-tick 'inset 2px 2px 0 #000000, inset -2px -2px 0 #8b8b8b'`,
`--veil 'rgb(0 0 0 / 0.3)'`, `--press 'rgb(255 255 255 / 0.08)'`, `--flow-hover 'rgb(0 0 0 / 0.3)'`, `--thumb '#7a7a7a'`); the preludes
mentioning `prefers-color-scheme` or `data-theme` are exactly `[DARK, AUTO_DARK, AUTO_ROOT]`; the two `<meta>` assertions are kept.
`TOKENS` gains each feature token at its light value (`--screen-lo #555555`, `--thumb var(--btn)`, `--flow-chip var(--screen)`,
`--flow-busy-track var(--screen)`, `--flow-busy #55ff55`, `--flow-busy-high #ffaa00`, `--stack-ink #ffffff`, `--stack-shadow #3f3f3f`,
`--bevel-inset inset 2px 2px 0 var(--panel-lo), inset -2px -2px 0 var(--panel-hi)`, `--bevel-screen inset 2px 2px 0 #000000, inset -2px -2px 0 var(--screen-lo)`,
`--energy #e03c3c`, `--progress-base #555555`, `--skeleton #b5b5b5`, `--skeleton-well #4a4a4a`, `--sheen rgb(255 255 255 / 0.1)`,
`--tip-mod #8080ff`, and the three icon data URIs of `theme-logo-svg.txt`).
`it('draws the look switch with its pixel icon, and cross-fades a switch over --dur-slow', …)`: `.theme-button` `margin-left: auto`,
`display: inline-flex`, `align-items: center`, `gap: 8px`, `padding: 0 12px`; `.theme-button::before` `content: ''`, `flex: none`,
`width: 16px`, `height: 16px`, `background: var(--icon-auto) center / contain no-repeat`; `[data-choice='dark']::before`
`background-image: var(--icon-moon)`, `[data-choice='light']::before` `var(--icon-sun)`; each decoded icon holds `viewBox='0 0 8 8'` and
its paths of spec §4.8; `::view-transition-old(root)` and `::view-transition-new(root)` — two rules, not spec §4.9's one list
(plan ruling `view-transition-split`) — each `animation-duration: var(--dur-slow)` and `animation-timing-function: var(--ease-out)`; `.top-nav` keeps
`min-height: 50px` (the bar stays one row); `:where(input[type=range])::-webkit-slider-thumb` and `::-moz-range-thumb` `background: var(--thumb)`.
`it('builds every Phase 2 rule on tokens, and transitions only what may move', …)` over `PHASE2_RULES` (here the `.theme-button` and
view-transition selectors): every `#…`/`rgb(…)` literal in `ruleBody(selector)` is in
`SAME_IN_BOTH = ['#ffffff', '#000000', '#aaaaaa', '#100010', '#ffff55', 'rgb(0 0 0 / 0.4)']`, and every `transition` part names
`transform`, `opacity`, `background-color`, `block-size` or `content-visibility`.

`contrast.test.tsx` appends `['slider thumb', '--thumb', '--panel', GRAPHICS, ['dark']]`, `['sun icon', '#ffd84a', '--btn', GRAPHICS]`,
`['moon icon', '#c8d4ff', '--btn', GRAPHICS]`, `['tick-well edge', '#8b8b8b', '--panel', GRAPHICS, ['dark']]` (4.21, D2: the light edge
of the dark `--bevel-tick`), `['mode-in-use ring on the panel', '--accent', '--panel', GRAPHICS, ['dark']]` (13.46: in dark the yellow
ring carries the frame of the mode in use, plan ruling `compare-frame-dark`), `['farm fields line on the panel', '--panel-lo', '--panel',
GRAPHICS, ['light']]` (4.36: decorative, plan ruling `farm-line-dark`, but the light look keeps it at 3:1), and, under the pointer's veil, `` [`${box} box text under the pointer`, '--text', { over: '--flow-hover', on: fill }, AA] ``
for each of `FLOW_FILLS` and `` [`${box} box lines under the pointer`, '--text-muted', { over: '--flow-hover', on: fill }, AA] `` for each of
`ISSUE_FILLS`; and records spec §4.3 and §4.5's accepted ones: `expect(ratio(colour('dark', '--btn'), colour('dark', '--panel'))).toBeLessThan(GRAPHICS)`
and the same for `--flow-new` on `--well` (comment: labels and text identify them); `--flange` on `--flow-new` below `GRAPHICS` in both
looks (2.59 in dark: a shape detail with a black edge); and
`expect(ratio(colour('dark', '--text-muted'), colour('dark', { over: 'rgb(255 255 255 / 0.08)', on: '--flow-owned' }))).toBeLessThan(AA)`
(3.79: why the dark hover darkens instead); and the base's two (plan rulings `compare-frame-dark`, `farm-line-dark`; no rule or token
changes, `.farm-fields` included):
`expect(ratio(colour('dark', '--outline'), colour('dark', '--panel'))).toBeLessThan(GRAPHICS)` (1.46. Comment: in dark the black edge
all but vanishes on the panel, which is why Task 1a's edge row is light-only; the ring, 13.46:1 on the panel and 19.69:1 on the edge,
carries the frame) and `expect(ratio(colour('dark', '--panel-lo'), colour('dark', '--panel'))).toBeLessThan(GRAPHICS)` (1.35. Comment:
add-on 17's farm fields hang on a 2 px `--panel-lo` line, a decorative connector like the dark panel's own bevel shadow; the indent under
the tick and the fields' own labels carry the grouping; 4.36:1 in light). Every other base row of Task 1a runs in both looks and passes
in dark (light → dark): titles 6.07 → 14.35; "Updating…" and the Plan-for hint 5.19 → 6.04; tile label 7.41 → 8.47, tile value
12.98 → 14.83; notes, chat over the dark panel being `#080808`: white 15.52 → 20.03, grey 6.68 → 8.62, red 4.94 → 6.37; the open
button 5.00 → 10.34, under the pointer 6.52 → 6.52; the Settings readout 7.41 → 8.28.

- [ ] **Step 2: Write the failing e2e**

`tests/e2e/helpers.ts`: `setTheme` = `page.context().addInitScript(([key, value]) => { try { localStorage.setItem(key, value); } catch { /* refused */ } }, ['gtnh-planner:theme', choice])`;
`LV_CIRCUITS`; `openWithPlan` (default settings `LV_CIRCUITS`); `SETTINGS_BUTTON`. `tests/e2e/theme.spec.ts`, rewritten (spec §4.12):
1. `'Auto follows the OS: today's look in a light OS, the dark look in a dark one'` — `newContext({ colorScheme })`: light gives body
   `rgb(43, 43, 43)` and `form.new-project` `rgb(198, 198, 198)`, dark gives `rgb(20, 20, 20)` and `rgb(42, 42, 42)`; both show
   `getByRole('button', { name: 'Theme: Auto' })`.
2. `'the Theme button cycles Auto, Dark and Light, and the choice outranks the OS'` — light context: click → `Theme: Dark` and
   `expect.poll` until body is `rgb(20, 20, 20)`; reload → still `Theme: Dark` and dark; click → `Theme: Light`; then a
   `colorScheme: 'dark'` context with `setTheme(page, 'light')` paints `rgb(43, 43, 43)`.
3. `'a chosen look is on the page before any app code runs'` — `setTheme(page, 'dark')`, `page.route(/\/assets\/.*\.js$/, (r) => r.abort())`,
   `login`, `goto('/')`: `#root` has no children, body `rgb(20, 20, 20)`.
4. `` `the dark tour: ${stop.name}` `` — one test per `DARK_TOUR` stop (Interfaces), polling every row's
   `getComputedStyle(el, row.pseudo ?? null).getPropertyValue(row.property)` of `page.locator(row.selector).first()` until it reads
   `row.expected`: stop `'the project list'` (`goto('/')`): `.top-nav` `background-color` `rgb(11, 11, 11)`; stop `'the Flow tab'`
   (`openWithPlan(page, circuitLv())`): `.tabs [role='tab'][aria-selected='false']` `background-color` `rgb(31, 31, 31)`,
   `[data-node-id="wire"] > rect.flow-node-box` `fill` `rgb(48, 48, 48)` and `.settings-section p.choice-hint` `color`
   `rgb(168, 168, 168)` (a hint of Plan for: dark `--text-muted` through the panel ink group). The base's surfaces (plan ruling
   `base-surfaces-dark`) get three stops of their own, which guard the built CSS through the minifier, the 900 px block's included:
   - `'the Compare card and a farm\'s fields'` — `openWithPlan(page, circuitLv())`, then check
     `page.getByRole('complementary', { name: 'Project settings' }).getByRole('checkbox', { name: 'Tree Growth Simulator', exact: true })`
     and click `page.locator('.project-head').getByRole('button', { name: 'Compare modes' })`; no row waits for the compare itself:
     `.compare-card` `background-color` `rgb(42, 42, 42)`, `.compare-head > h3` `color` `rgb(255, 255, 255)`, `.farm-fields`
     `border-left-color` `rgb(13, 13, 13)`.
   - `'the narrow head and the drawer that opens by itself'` — `await page.setViewportSize({ width: 800, height: 900 })`, then
     `createProject(page, 'Dark drawer')` with no target, then `await expect(page.locator('aside[aria-label="Project settings"]')).toBeVisible()`:
     `.settings-toggle-target` `background-color` `rgb(11, 11, 11)` and `color` `rgb(168, 168, 168)`, `aside.settings-panel`
     `background-color` `rgb(20, 20, 20)` (below 900 px the drawer is `--page`).
   - `'the Compare modes bar on a narrow window'` — 800 × 900, `createProject(page, 'Dark bar', LV_CIRCUITS)` (a target: the bar is
     drawn): `.compare-bar .compare-toggle` `background-color` `rgb(60, 60, 60)`.

   And `'the dark tour: the login card'` — a dark context, logged out, `goto('/login')`: `.login` `background-color` `rgb(42, 42, 42)`.
`focus.spec.ts`: `'in the dark look a link on a panel rings yellow'` — `setTheme(page, 'dark')`, the panel-link part of `:47-55`:
ring `{ color: 'rgb(255, 255, 85)', width: '3px' }`.

- [ ] **Step 3: Run them to see them fail**

Run: `npx vitest run tests/client/theme.test.tsx tests/client/scaffold.test.tsx tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx`
Expected: FAIL — `theme.ts`/`ThemeButton.tsx` do not exist, no dark blocks, no `--thumb`.

- [ ] **Step 4: Implement the look, the store and the button**

- `styles.css`: header comment `:1-5` says two looks (Light, Dark; Auto follows the OS). The feature tokens join the first `:root`.
  Right after it, one "dark look" section: `:root[data-theme='dark'] { …DARK_TOKENS… }` and
  `@media (prefers-color-scheme: dark) { :root:not([data-theme='light']) { …the same list, same order… } }` with spec §4.2's comment.
  The thumbs (`:192`, `:196`) read `var(--thumb)`. After `:285`: the four `.theme-button` rules of spec §4.8 and the two
  view-transition rules. The dark blocks reach the base's surfaces through the tokens those surfaces already read, so nothing in
  them names add-on 17 or the Make-picker fix (plan ruling `base-surfaces-dark`). The Compare card goes to `--panel` `#2a2a2a`, with
  titles `--title` `#ffffff` and tiles on `--screen` `#0b0b0b`. The column frames and the farm line follow `--panel-lo` `#0d0d0d` /
  `--panel-hi` `#474747`. The open Compare button is `--accent` on `--btn` `#3c3c3c`. The Settings readout is `--ink-muted` `#a8a8a8`
  on `--screen` `#0b0b0b`, and `.mat-taken` is `--text-muted` `#a8a8a8`.
- `theme.ts`: the `pipes-paused.ts` pattern (page value, listeners, `storage` events, `useSyncExternalStore(subscribe, get, get)`);
  `setThemeChoice` stores the choice (the page value when storage refuses or is read-only), then, with `const doc = globalThis.document`,
  calls `doc.startViewTransition(() => applyTheme(choice))` when `doc?.startViewTransition` exists and `!prefersReducedMotion()`, else
  `applyTheme(choice)` at once, then notifies (node has no `document`: the unit tests, their `afterEach` and the button's click run this
  path); `applyTheme` defaults `root` to `globalThis.document?.documentElement` and does nothing without one; `startTheme` applies
  `getThemeChoice()` and adds a `storage` listener of its own (key `THEME_KEY` or `null`) that re-applies at once, returning how to
  stop — never through `subscribeThemeChoice`, whose notify on a local click would apply the look before the View Transition captures
  the old one, and the fade would be lost.
- `ThemeButton.tsx`: spec §4.8's markup, `LABELS = { auto: 'Auto', dark: 'Dark', light: 'Light' }`, one template-literal text node, no
  `aria-label`, no `aria-pressed`. `TopNav.tsx`: `const theme = useThemeChoice();` and `<ThemeButton choice={theme} />` right after `</nav>`.
- `index.html`: after `<title>`, the classic script of spec §4.6 verbatim. `main.tsx`: `startTheme();` before `createRoot(…)`.

- [ ] **Step 5: Run everything**

Run: `npm test` → PASS; `npm run e2e` → PASS (theme.spec's (1)–(3), its five tour stops and the login card; focus.spec's dark ring; `focus.spec.ts:40-44` still reaches
Projects first and `drawer.spec.ts:77` the Settings button (`/^Settings/`, which reads "Settings · Make: Basic Circuit") within 10 Tabs
(its project has a target, so the drawer starts closed); `chrome.spec.ts` bar ≤ 53; objectives.spec's 7 cases and drawer.spec's 18
still pass, since the Theme button sits in the top bar, outside the 36 px project head they measure).

- [ ] **Step 6: Review shots** — label `1b`: the projects list, login, Flow, the step panel, Materials, Map, Connections, 3D, and the
  drawer at 800 px. Also the base's screens the tour gained in Task 1a: the Compare card open (`51`, `51b`; at 800 opened from the bar
  under the banner), Plan for and the Tree Growth Simulator's fields (`52`, `52b`), the 800 px head with the Settings button's readout
  (`53`), and the drawer that opened by itself (`24`, `24b` at 800). Check the dark ones against `DarkMode.dc.html`. The base's screens
  have no mockup (plan ruling `base-surfaces-dark`): check their light ones against `$SCRATCH/addon17/*.png` and `$SCRATCH/makefix/*.png`,
  and their dark ones against the palette (panels `#2a2a2a`, screens and tiles `#0b0b0b`) and against their light twins. The mode in use
  must read by its yellow ring and the farm fields' line as a dark groove (plan rulings `compare-frame-dark`, `farm-line-dark`).

- [ ] **Step 7: Commit**

```bash
git add src/client/styles.css src/client/state/theme.ts src/client/state/motion.ts src/client/components/ThemeButton.tsx src/client/components/TopNav.tsx src/client/index.html src/client/main.tsx tests/client/theme.test.tsx tests/client/scaffold.test.tsx tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx tests/e2e/theme.spec.ts tests/e2e/helpers.ts tests/e2e/focus.spec.ts
git commit -m "feat(client): a dark look anyone can choose, Auto by default, and the Theme button" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Logo C in the top bar, on the login card and as the tab icon

**Files:**
- Modify: `src/client/styles.css` — `--brand-mark` and its comment `:28-30`; `.brand-mark` `:273`; keyframes after `:106` (`@keyframes pipe-pulse`)
- Modify: `src/client/index.html:8`
- Modify: `tests/client/styles-contract.test.tsx` (`KEYFRAMES` `:133-144`, `:550-564`, new cases), `tests/e2e/chrome.spec.ts`

**Interfaces:**
- Consumes: `PHASE2_RULES`.
- Produces: tokens `--brand-mark` (logo C's still frame, 566 chars encoded), `--brand-flow-1`, `--brand-flow-2` (243 each) from `theme-logo-svg.txt`; `@keyframes brand-flow`.

- [ ] **Step 1: Write the failing tests**

Contract: `KEYFRAMES` gains `'brand-flow': ['opacity']`. `:550-564` becomes `'draws logo C from one token, on the top bar and above the login title'`:
the decoded `--brand-mark` contains `data:image/svg+xml`, `viewBox='0 0 16 16'`, `shape-rendering='crispEdges'` and the seven pairs
`fill='#141414' d='M1 1h6v6H1zM6 2h7v3H6zM10 5h3v4H10zM9 9h6v6H9z'`, `fill='#d8d8d8' d='M2 2h3v1H2zM2 3h1v2H2zM10 10h3v1H10zM10 11h1v2H10z'`,
`fill='#6e6e6e' d='M5 2h1v3H5zM2 5h4v1H2zM13 10h1v3H13zM10 13h4v1H10z'`, `fill='#ff8a1f' d='M3 3h2v2H3z'`, `fill='#55ff55' d='M11 11h2v2H11z'`,
`fill='#ffd84a' d='M7 3h5v1H7zM11 4h1v6H11z'`, `fill='#7a5a10' d='M9 3h1v1H9zM11 4h1v1H11zM11 7h1v1H11z'`; `--brand-flow-1` and `--brand-flow-2`
each contain the yellow pipe path and `fill='#7a5a10' d='M7 3h1v1H7zM10 3h1v1H10zM11 5h1v1H11zM11 8h1v1H11z'` /
`… d='M8 3h1v1H8zM11 3h1v1H11zM11 6h1v1H11zM11 9h1v1H11z'`; the `.brand-mark` and `.login::before` rows stay, plus
`['.brand-mark', 'position', 'relative']`.

```ts
const OVERLAYS = '.brand-mark::before, .brand-mark::after';
it('flows the brand\'s pipe six turns and rests on the still frame', () => {
  expectDeclared([[OVERLAYS, 'content', "''"], [OVERLAYS, 'position', 'absolute'], [OVERLAYS, 'inset', '0'], [OVERLAYS, 'opacity', '0'],
    [OVERLAYS, 'background', 'var(--brand-flow-1) center / contain no-repeat'], [OVERLAYS, 'animation', 'brand-flow 0.66s step-end 6 -0.44s'],
    ['.brand-mark::after', 'background-image', 'var(--brand-flow-2)'], ['.brand-mark::after', 'animation-delay', '-0.22s']]);
  const [, duration, , count] = (declared(OVERLAYS, 'animation') ?? '').split(' ');
  expect(Number.parseFloat(duration ?? '') * Number(count)).toBeLessThanOrEqual(5);
  expect(declared(OVERLAYS, 'animation')).not.toMatch(/forwards|backwards|both|infinite/);
  expect(ruleBody('@keyframes brand-flow')).toBe('0% { opacity: 1; } 33.333% { opacity: 0; }');
});
it('shows the brand mark as the tab icon', () => {
  const uri = (rootTokens().get('--brand-mark') ?? '').replace(/^url\("/, '').replace(/"\)$/, '');
  const html = read('index.html');
  expect(html).toContain(`<link rel="icon" type="image/svg+xml" href="${uri}" />`); expect(html).not.toContain('href="data:,"');
});
```
`PHASE2_RULES` gains `OVERLAYS` and `.brand-mark::after`.
`chrome.spec.ts`: `'the brand\'s pipe flows six turns, then rests; under reduced motion it holds still'` — `login`, `goto('/')`; on
`.brand-mark`, `['::before', '::after']` both compute `{ animationName: 'brand-flow', animationIterationCount: '6' }`; after
`emulateMedia({ reducedMotion: 'reduce' })` both `'1'` (both pseudo-elements are read, as the minifier merged such lists before, R28).

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/client/styles-contract.test.tsx` → FAIL (the 8 × 8 mark, no overlays, `href="data:,"`).

- [ ] **Step 3: Implement** — the three tokens of `theme-logo-svg.txt` replace `--brand-mark` (`:28-30`, comment updated: logo C,
  16 × 16, frame 0); `.brand-mark` (`:273`) and the overlay rules and `@keyframes brand-flow` exactly as spec §5.3; `index.html:8`
  becomes the `favicon:` line of `theme-logo-svg.txt`. No markup change (`scaffold.test.tsx:36-42` stays green).

- [ ] **Step 4: Run everything** — `npm test` → PASS; `npm run e2e` → PASS (incl. the new chrome.spec case).

- [ ] **Step 5: Review shots** — label `2`, both looks: the top bar, the login card (64 px), the tab icon at 2×; frame order against `Main.dc.html`
  (goods flow from the orange machine to the green one). Tell the user it rests after 6 turns, unlike the mockup's loop.

- [ ] **Step 6: Commit**

```bash
git add src/client/styles.css src/client/index.html tests/client/styles-contract.test.tsx tests/e2e/chrome.spec.ts
git commit -m "feat(client): logo C, six turns of its pipe and then the still frame, also as the tab icon" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2b: Figures in VT323

The user chose VT323 for figures on 2026-10-24 and kept Pixelify Sans for words (spec §25; plan ruling `figures-vt323`): Pixelify
draws 5 like S, 2 like Z and 0 like O. This task adds the face, the token and the `Figs` helper, and moves every figure that Phase 1
and add-on 17 draw; Tasks 3a, 4, 5a, 6a, 7, 8 and 11 build theirs on it. It runs after Tasks 1a, 1b and 2, so Task 1a's
pixel-identity check against `base-a` stands as it was made. From here on the light look differs from Task 2's in the figures and
along the lines they sit on — spec §25 changes their font on purpose — and nowhere else (Step 6 checks it).

**Files:**
- Modify: `package.json` (`dependencies`: `"@fontsource/vt323": "5.3.0"`, exact, after `"@fontsource/pixelify-sans"`), `package-lock.json`, `docs/research/web-stack.md` (a row after `@fontsource/inter`'s, `:74`)
- Modify: `src/client/main.tsx` (after `:10`, `import '@fontsource/inter/700.css';`, and before `import './styles.css';`)
- Modify: `src/client/styles.css` — the first `:root` (`--font-pixel`, `:26`); the Compare comment `:388-392` and `.compare-row > dd` `:422-425`; after `.badge.muted` `:534`; `details.settings-section > summary > .muted` `:575-578`; `.step-list li::marker` `:939`; the map toolbar's comment and `.map-y` `:974-981`; `.view3d-layer-text` `:1254-1258`; `.smart-total` `:1326-1329`
- Create: `src/client/components/Figs.tsx`, `tests/client/figures.test.tsx`
- Modify: `src/client/map/MapTooltip.tsx:48`, `src/client/views/View3D.tsx:243`, `src/client/map/FoundPanel.tsx:209`, `:252`, `src/client/map/LinePanel.tsx:145` (`Rotate 90°`), `src/client/views/MaterialsView.tsx:171`, `:227`, `src/client/views/StepsView.tsx:31`, `src/client/views/StepPanel.tsx:604` (the swap list's "more…" button), `src/client/views/ConnectionsView.tsx:377` (the details panel's title), `src/client/views/MapTab.tsx:268`, `src/client/views/ProjectPage.tsx:160` (PlanBanner's heading)
- Modify: `tests/client/styles-contract.test.tsx` (`FONT_IMPORTS` `:146-149`, `TOKENS`, the cases at `:805-821`, `:1117-1129`, `:1762-1770`, `:1898-1927`, `:2037-2046`, `:2302-2333`, a new case), `tests/e2e/chrome.spec.ts` (a new test)
- Test (deliberate, spec §25's table): `tests/client/map-hover.test.tsx:360-362`, `tests/client/view3d.test.tsx:91`, `:356`, `tests/client/map-summary.test.tsx:93`, `:154-155`, `:172-173`, `:176`, `tests/client/layout-map.test.tsx:182`, `:319`, `tests/client/connections-view.test.tsx:86`, and Step 1's contract rows

**Interfaces:**
- Consumes: `LV_CIRCUITS` (Task 1b's `tests/e2e/helpers.ts`), `PHASE2_RULES`, `$P2/tour.mjs` and `$P2/maskdiff.py` (Task 1a).
- Produces:
  - Token `--font-digits: VT323, ui-monospace, Menlo, Consolas, monospace` (plan ruling `digits-token`); every rule that sets it also sets `font-size-adjust: cap-height 0.56`, after its `font`.
  - CSS `.fig { font: 1.15em/0 var(--font-digits); font-size-adjust: cap-height 0.56; }`: a figure inside Pixelify text, a `span` in HTML or a `tspan` in an svg.
  - `src/client/components/Figs.tsx`: `interface FigureRun { text: string; fig: boolean }`; `figureRuns(text: string): FigureRun[]` (a figure is digits with the `,` `.` `:` that join them and the one space or `–` between digit groups, and a `+`, `−` or `-` right before it that follows no letter or digit; the `%` and `×` around it stay in the words); `Figs(props: { text: string; svg?: boolean }): ReactElement` (hook-free: the words as text, each figure in `<span class="fig">`, with `svg` in `<tspan class="fig">`). Tasks 3a, 4, 5a and 11 write their mixed figures with it.
  - Contract (`styles-contract.test.tsx`): `DIGIT_RULES: string[]` (every rule that names `var(--font-digits)`; Tasks 5a and 7 append theirs) and `DIGITS_FLOOR = 14`.

- [ ] **Step 1: Write the failing unit and contract tests**

`tests/client/figures.test.tsx` (`renderToStaticMarkup`):

```ts
it('cuts a text into its figures and its words, the signs around a figure staying with the words', () => {
  expect(figureRuns('need 80× · have 1,440 (64 reachable)')).toEqual([{ text: 'need ', fig: false }, { text: '80', fig: true },
    { text: '× · have ', fig: false }, { text: '1,440', fig: true }, { text: ' (', fig: false }, { text: '64', fig: true }, { text: ' reachable)', fig: false }]);
  expect(figureRuns('short: gets 45%')).toEqual([{ text: 'short: gets ', fig: false }, { text: '45', fig: true }, { text: '%', fig: false }]);
  expect(figureRuns('×1 shared')).toEqual([{ text: '×', fig: false }, { text: '1', fig: true }, { text: ' shared', fig: false }]);
  expect(figureRuns('1 64 10')).toEqual([{ text: '1 64 10', fig: true }]);                       // a position is one figure
  expect(figureRuns('-30 64 12')).toEqual([{ text: '-30 64 12', fig: true }]);
  expect(figureRuns('+3 more below')).toEqual([{ text: '+3', fig: true }, { text: ' more below', fig: false }]);
  expect(figureRuns('Base: Overworld base (4, 5)').filter((r) => r.fig).map((r) => r.text)).toEqual(['4', '5']);
  expect(figureRuns('✓ Ann, 10:00').at(-1)).toEqual({ text: '10:00', fig: true });
  expect(figureRuns('1–6')).toEqual([{ text: '1–6', fig: true }]); expect(figureRuns('0.0586/min in the line')[0]).toEqual({ text: '0.0586', fig: true });
  expect(figureRuns('Copper Wire')).toEqual([{ text: 'Copper Wire', fig: false }]); expect(figureRuns('')).toEqual([]);
});
it('draws each figure in a span.fig, or a tspan.fig in an svg, and nothing else', () => {
  expect(renderToStaticMarkup(<Figs text="short: gets 45%" />)).toBe('short: gets <span class="fig">45</span>%');
  expect(renderToStaticMarkup(<Figs text="N5" />)).toBe('N<span class="fig">5</span>');
  expect(renderToStaticMarkup(<Figs text="Copper Wire" />)).toBe('Copper Wire');
  expect(renderToStaticMarkup(<svg><text><Figs text="×1 shared" svg /></text></svg>)).toBe('<svg><text>×<tspan class="fig">1</tspan> shared</text></svg>');
});
```

Contract — `FONT_IMPORTS` gains `'@fontsource/vt323/400.css'` (so 'loads the fonts before the stylesheet' asks for it before
`./styles.css`), `TOKENS` gains `['--font-digits', 'VT323, ui-monospace, Menlo, Consolas, monospace']`, `PHASE2_RULES` gains `.fig`, and
these pins change (deliberate, spec §25's table; after Task 1a find them by their text):

| `styles-contract.test.tsx` | Expected now |
|---|---|
| `:805-821` (the settings summary's count) | `` [`${SETTINGS_SUMMARY} > .muted`, 'font', '15px/19.5px var(--font-digits)'] `` |
| `:1117-1129` (the step numbers) | `['.step-list li::marker', 'font-family', 'var(--font-digits)']` and a new row `['.step-list li::marker', 'line-height', '20.3px']` (the list's own line, 14 px × 1.45, in px: a marker takes the list's 1.45, which at 16 px is a 23.2 px line, and that grows every one-line step row from 26.3 to 27.16 px — measured in the app, where a row is a flex `.tick`); `declared('.step-list li::marker', 'font-size')` `toBe('16px')` (was `toBeUndefined()`: VT323 at 16 px is as tall as the list's 14 px Pixelify); the case's name says "the step numbers in VT323" |
| `:1762-1770` (the map toolbar) | `['.map-y', 'font', '15px/1 var(--font-digits)']` (the `min-width: 6em` row stays: 90 px now) |
| `:1898-1927` (the 3D controls) | `['.view3d-layer-text', 'font', '15px/1 var(--font-digits)']` (the em `min-width` checks and the `font-variant-numeric`-after-`font` order stay) |
| `:2037-2046` (the smart upload) | `['.smart-total', 'font', '16px/18.1875px var(--font-digits)']` (ruling P2-R13) |
| `:2302-2312` (the Compare tiles' value) | `['.compare-row > dd', 'font', '28px/26.390625px var(--font-digits)']` (ruling P2-R13); the case's name ends "over a green VT323 value" |
| `:2314-2333` (the shrink, plan ruling `compare-shrink-vt323`) | `['.compare-row > dd', 'font-size', 'clamp(14px, calc(100cqi / (var(--glyphs, 1) * 0.41)), 28px)']`; its comment: "a tile is at least 160px: 12 glyphs of the 28 px VT323 (0.4 em each, 0.41 with the margin) and 16px of padding"; the name ends "to 14px at the least"; the `font-size`-after-`font` order stays |

New case:

```ts
const DIGIT_RULES = ['.fig', '.compare-row > dd', 'details.settings-section > summary > .muted', '.step-list li::marker', '.map-y', '.view3d-layer-text', '.smart-total'];
const DIGITS_FLOOR = 14;
/** The px font sizes a rule gives: its `font`'s size, and every px of its `font-size` (both ends of a clamp). */
const pxSizes = (selector: string): number[] => [
  ...(declared(selector, 'font')?.match(/^(?:\S+ )*?([\d.]+)px/)?.slice(1) ?? []), ...(declared(selector, 'font-size')?.match(/[\d.]+(?=px)/g) ?? []),
].map(Number);
it('sets every figure in VT323, at 14 px or more, its fallback drawn as tall, and leaves the words in Pixelify', () => {
  // spec §25: these rules and no other name the digits' face (Tasks 5a and 7 append theirs), and none of them names Pixelify
  const naming = blocks.filter((b) => !b.prelude.startsWith('@') && b.inner.includes('var(--font-digits)')).map((b) => b.prelude);
  expect(naming.sort()).toEqual([...DIGIT_RULES].sort());
  for (const selector of DIGIT_RULES) {
    expect(ruleBody(selector).includes('--font-pixel'), selector).toBe(false);
    // a fallback (Menlo, Consolas …) drawn as tall as VT323's 0.56 em digits; `font` resets it, so it comes after
    expect(declared(selector, 'font-size-adjust'), selector).toBe('cap-height 0.56');
    const names = declarations(ruleBody(selector)).map(([name]) => name);
    if (names.includes('font')) expect(names.lastIndexOf('font-size-adjust'), selector).toBeGreaterThan(names.lastIndexOf('font'));
    for (const px of pxSizes(selector)) expect(px, selector).toBeGreaterThanOrEqual(DIGITS_FLOOR);
  }
  // a figure inside Pixelify text: 1.15 em, as tall as the digits around it, on a line height of 0, so it moves no line
  expect(declared('.fig', 'font')).toBe('1.15em/0 var(--font-digits)');
  expect(1.15 * 13).toBeGreaterThanOrEqual(DIGITS_FLOOR);   // in the smallest Pixelify there is
  // the words stay in Pixelify: the badges and chips, the map tooltip and the 3D label keep their rules
  expectDeclared([['.badge, .chip', 'font', '13px/1.5 var(--font-pixel)'], [TIP, 'font', '14px/1.35 var(--font-pixel)'], [HOVER, 'font', '14px/1.35 var(--font-pixel)']]);
});
```

Deliberate markup updates (spec §25's table: a figure's text gains `<span class="fig">…</span>`, nothing else): `map-hover.test.tsx:360`
finds each line in `html.replace(/<span class="fig">|<\/span>/g, '')`, and a new line asserts `toContain('<div><span class="fig">3 64 3</span></div>')`;
`view3d.test.tsx:91`'s `'Basic Macerator — programmed circuit 2'` and the `:356` markup read `Basic Macerator — programmed circuit <span class="fig">2</span>`;
`map-summary.test.tsx:93` and `:176` read `Show all <span class="fig">13</span> items`; `:154`, `:155` read `<span class="badge">N<span class="fig">1<\/span><\/span>`
(and `2`; `:156`'s guard against a bare number still holds); `:172-173` reads `<span class="badge">N<span class="fig">1</span></span> Build here`;
`layout-map.test.tsx:319` reads `>pin <span class="fig">1<\/span><\/button>`, and `:182`'s `'Rotate 90°'` reads `'Rotate <span class="fig">90</span>°'`;
`connections-view.test.tsx:86` reads `<h3>Titanium Dust <span class="fig">60</span>/min · Red</h3>` (`:72`'s title has no figure and stays).
`plan-banner.test.tsx:57` and `step-panel.test.tsx:246` ("25 more… (55 not shown)") read the text with its tags taken out, so they pass unchanged.

- [ ] **Step 2: Write the failing e2e** — `chrome.spec.ts` (imports `LV_CIRCUITS` from `./helpers.ts`):

```ts
test('figures in VT323 keep their boxes whether the fonts arrive or not', async ({ browser }) => {
  // spec §25: a VT323 element has its line in px, so a late VT323 moves nothing; measured on the settings column's count of
  // reachable dimensions and on a Compare tile (54.7 px: 6 + 14.3 + 2 + 26.39 + 6, which Task 8's skeleton blocks copy)
  const boxes = async (blockFonts: boolean): Promise<{ count: number; tile: number; loaded: string[] }> => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      if (blockFonts) await page.route(/\.woff2?$/, (route) => route.abort());
      const summary = { rawPerHour: 0.000000123, rawBuild: 131072, newMachines: 12, rawSources: 7, steps: 23, peakEUt: 2097152 };   // objectives.spec.ts:155
      await page.route(/\/api\/projects\/[^/]+\/compare$/, (route) => route.fulfill({ json: { rev: 1, current: 'cheapest',
        modes: ['least-raw', 'cheapest', 'multi-output'].map((objective) => ({ objective, status: 'ok', summary })) } }));
      await login(page); await setName(page, 'Ann');
      await createProject(page, blockFonts ? 'Figures without fonts' : 'Figures with fonts', LV_CIRCUITS);
      const count = page.locator('aside[aria-label="Project settings"] details.settings-section > summary > .muted').first();
      await expect(count).toBeVisible();
      await page.locator('.project-head').getByRole('button', { name: 'Compare modes' }).click();
      const tiles = page.getByRole('region', { name: 'Compare modes' }).locator('.compare-row');
      await expect(tiles).toHaveCount(18);
      await page.evaluate(async () => { await document.fonts.ready; });
      return {
        count: (await count.boundingBox())!.height, tile: (await tiles.first().boundingBox())!.height,
        loaded: await page.evaluate(() => [...document.fonts].filter((face) => face.status === 'loaded').map((face) => face.family)),
      };
    } finally {
      await context.close();
    }
  };
  const without = await boxes(true);
  const withFonts = await boxes(false);
  expect(without.loaded, 'the faces that loaded with the font files refused').toEqual([]);
  expect(withFonts.loaded.some((family) => family.includes('VT323')), 'a VT323 face loaded with the font files served').toBe(true);
  expect(withFonts.count).toBe(without.count);
  expect(withFonts.tile).toBe(without.tile);
  expect(without.tile).toBeCloseTo(54.7, 0);
});
```

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/figures.test.tsx tests/client/styles-contract.test.tsx tests/client/map-hover.test.tsx tests/client/view3d.test.tsx tests/client/map-summary.test.tsx tests/client/layout-map.test.tsx tests/client/connections-view.test.tsx` → FAIL (no `Figs.tsx`, no `--font-digits` or VT323 import, the figures in Pixelify, no `span.fig` in the markup).

- [ ] **Step 4: Implement**

- The face: `npm install --save-exact @fontsource/vt323@5.3.0` (published 2026-07-19, OFL-1.1, no dependencies; the version of
  `@fontsource/pixelify-sans` and `@fontsource/inter`): `package.json` gains `"@fontsource/vt323": "5.3.0"` after
  `@fontsource/pixelify-sans`, the lockfile its one entry. `main.tsx` imports `'@fontsource/vt323/400.css'` after the Inter imports and
  before `./styles.css` (VT323 has weight 400 only; of its three subsets only the latin face is fetched). `docs/research/web-stack.md`
  gains, after the `@fontsource/inter` row, `| @fontsource/vt323 | 5.3.0 | 2026-07-19 | OFL-1.1 | Machine GUI Phase 2 (spec §25): figures — readouts, counts, step numbers and the digits in pixel text; weight 400, bundled by Vite, no CDN; added 2026-10-24 at the version of the two rows above, no transitive dependencies |`.
- `styles.css`:
  - the first `:root`, after `--font-pixel` and `--font-ui`: `--font-digits: VT323, ui-monospace, Menlo, Consolas, monospace;`, with a
    comment: figures in VT323, words in Pixelify (Phase 2 spec §25); a rule that sets it also sets `font-size-adjust: cap-height 0.56`,
    so a fallback is drawn as tall as VT323's digits;
  - after `.badge.muted` (`:534`): `/* A figure inside Pixelify text (Figs.tsx): as tall as the Pixelify digits round it, and a line height of 0, so it never grows or moves a line. */`
    `.fig { font: 1.15em/0 var(--font-digits); font-size-adjust: cap-height 0.56; }`;
  - `.compare-row > dd` (`:422-425`): `font: 28px/26.390625px var(--font-digits); font-size: clamp(14px, calc(100cqi / (var(--glyphs, 1) * 0.41)), 28px); font-size-adjust: cap-height 0.56;`,
    the rest as it is; the comment `:388-392`: a tile is at least 160px wide, room for 12 glyphs of the 28px VT323 (every glyph 0.4em,
    0.41 with a margin); a value too long shrinks to fit, down to 14px, before the ellipsis; its line is 26.390625px at every size, so a
    tile is 54.7px (ruling P2-R13: the line 24px/1.1 gave as Chromium lays it out; a one-line comment at the value says so);
  - `details.settings-section > summary > .muted` (`:575-578`): `font: 15px/19.5px var(--font-digits); font-size-adjust: cap-height 0.56;` in place of `font: 13px/1.5 var(--font-pixel)`;
  - `.step-list li::marker` (`:939`): `font-family: var(--font-digits); font-size: 16px; line-height: 20.3px; font-size-adjust: cap-height 0.56;`
    (the line in px, the list's 20.3: with the 1.45 it inherits, the 16 px marker's line is 23.2 px and each one-line row grows from
    26.3 to 27.16 px);
  - `.map-y` (`:978-981`): `font: 15px/1 var(--font-digits); font-size-adjust: cap-height 0.56;` (its comment `:974-975` says the box keeps its size "when VT323 arrives late");
  - `.view3d-layer-text` (`:1254-1258`): `font: 15px/1 var(--font-digits); font-variant-numeric: tabular-nums; font-size-adjust: cap-height 0.56;`;
  - `.smart-total` (`:1326-1329`): `font: 16px/18.1875px var(--font-digits); font-size-adjust: cap-height 0.56;` (ruling P2-R13: the line
    14px/1.3 gave as Chromium lays it out; a one-line comment at the value says so).
- `Figs.tsx` per the Interfaces: `figureRuns` matches `/(?:(?<![\p{L}\p{N}])[+−-])?\d+(?:(?:[.,:]|[ –])\d+)*/gu` and keeps the text
  between matches as `{ fig: false }` runs (never an empty one); `Figs` maps the runs to text and `<span key={i} className="fig">` (with
  `svg`, `<tspan key={i} className="fig">`).
- The figures that Phase 1 and add-on 17 draw among words, each through `<Figs text={…} />` in place of the bare text:
  `MapTooltip.tsx:48` (each line), `View3D.tsx:243` (the hover label), `FoundPanel.tsx:209` (`` `Show all ${int(storage.items.length)} items` ``)
  and `:252` (`` `N${n}` ``), `MaterialsView.tsx:171` (a used-by chip, `` `${u.label} ${u.rate}` ``) and `:227` (the missing badge),
  `StepsView.tsx:31` (`` `pin ${pin}` ``), `LinePanel.tsx:145` (`Rotate 90°`), `StepPanel.tsx:604` (the swap list's
  `` `${hidden} more…` `` or `` `${SWAP_PAGE} more… (${hidden} not shown)` ``), `ConnectionsView.tsx:377` (the details panel's
  `<h3>`, which stays attribute-less: a box's title "5× Basic Assembler", a hookup's "Power tap at 12 64 7", a link's "Titanium Dust
  60/min · Red"), `MapTab.tsx:268` (`` `Add note at ${where}` ``) and `ProjectPage.tsx:160` (PlanBanner's
  `` `This plan does not add up: ${counted.join(', ')} ` ``). Names and fixed words keep their markup (spec §25, plan ruling
  `digits-mixed`): the panel titles that name a step, an item or a block, the project's name, the avoid chips, buttons that name an
  item, the tabs, the word badges.

- [ ] **Step 5: Run everything** — `npm test` → PASS; `npm run e2e` → PASS. Watch `objectives.spec.ts:150-178` (the Compare figures at
  860 and 768 px: they fit at 28 px and do not shrink), `drawer.spec.ts:225-266` (R37: "Reachable dimensions" still wraps beside the
  96 px count), `world.spec.ts:69-89` (the map tooltip's text, the note dialog's title by `getByText`), `layout.spec.ts:80` and
  `view3d-links.spec.ts:100` (the 3D readout's and hover label's text), and `chrome.spec.ts`'s first test (its blocked context still
  loads no face, VT323 included).

- [ ] **Step 6: Review shots** — label `2b`, both looks, at 1440 and 800: `node --disable-warning=ExperimentalWarning $P2/tour.mjs 1440 light 2b`,
  `… 1440 dark 2b`, `… 800 light 2b`, `… 800 dark 2b`. Then `python3 -I $P2/maskdiff.py` on `2`, `base-b` and `2b` at each width —
  Task 2's light shots are the reference, not `base-a`: Tasks 1b and 2 changed the top bar of every screen (the Theme button, logo C),
  and the mask, where `2` and `base-b` differ, covers that besides the clocks and ids. This task does not keep the light look
  pixel-identical for the figures, so a shot with none of the switched elements must still print `identical`, and a shot with one may
  differ only inside their boxes and along their lines (a figure narrower or wider than in Pixelify moves what follows it, and
  `.map-y` and `.view3d-layer-text` grow by 12 and 20 px) — check every bbox the script prints against the element under it, and list
  them. Look at least at `51-compare-open` (the tiles), `20-settings-panel-all-open` (the dimensions count),
  `35-materials-with-layout` (step numbers, pin buttons), `14-materials` (used-by chips, a missing badge), `31-map-line` and
  `32b-map-tooltip-element` (the Y readout, Rotate 90°, the note badges, the tooltip), `33-map-note-modal` (its title),
  `37-connections-panel` (the panel's title), `34-3d-view` and
  `38c-3d-hover-element` (the layer readout, the hover label), `27-world-smart-upload` (the total), and a shot whose banner says "This
  plan does not add up"; against spec §25's sizes and the comparison the user chose (`$SCRATCH/glyphs/number-fonts.png`, row B). Report
  any figure still drawn in Pixelify outside a name.

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json docs/research/web-stack.md src/client tests/client tests/e2e/chrome.spec.ts
git commit -m "feat(client): figures in VT323, words still in Pixelify" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3a: One shared NEI tooltip, on item icons first

**Files:**
- Create: `src/client/components/tooltip-model.ts`, `src/client/components/Tooltip.tsx`, `src/client/components/mod-names.ts`, `tests/client/tooltip-model.test.tsx`, `tests/e2e/tooltips.spec.ts`
- Modify: `src/client/components/ItemIcon.tsx:41-59`; `src/client/views/FlowView.tsx:165`, `:219` (the box icons); `src/client/components/AvoidPicker.tsx:51`; `src/client/views/SettingsPanel.tsx:267` (the cost row's ItemIcon inside `<span className="cost-name" title={costKey}>` at `:266`); `src/client/views/ProjectPage.tsx:183` (the derived-material chip's ItemIcon inside `button.banner-chip` with `` title={`Show ${nameOf(key)} in the flow`} `` at `:182`); `src/client/map/MapTooltip.tsx:12-17`; `src/client/App.tsx:40-46`; `src/client/styles.css` (after `:996`, `.map-tooltip > :first-child { color: #ffffff; }`; keyframes after `:106`, `@keyframes pipe-pulse`)
- Test (deliberate, spec §3.9): `tests/client/item-icon.test.tsx:18`, `:28`, `:30`; `tests/client/scaffold.test.tsx:71`
- Test (additions): `tests/client/item-icon.test.tsx`, `tests/client/flow-pipes.test.tsx`, `tests/client/styles-contract.test.tsx`, `tests/client/contrast.test.tsx`, `tests/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: `--tip-mod`, `PAIRS`, `PHASE2_RULES`, `DARK_TOUR`, `LV_CIRCUITS`, `SETTINGS_BUTTON`, `Figs` (Task 2b), `HOVER_DELAY_MS` (`map/hover.ts:16`), `DRAG_THRESHOLD` (`views/pan-zoom.ts:17`) (the tip's fades are CSS, so the global reduced-motion rule covers them).
- Produces:
  - `tooltip-model.ts`: `TIP_ATTR = 'data-tip'`, `TIP_MOD_ATTR = 'data-tip-mod'`, `TIP_DELAY_MS = HOVER_DELAY_MS`, `TIP_OFFSET = 12`, `TIP_ELEMENT_GAP = 4`, `LONG_PRESS_MS = 500`, `LONG_PRESS_CLICK_MS = 400`, `TIP_EXIT_MS = 100`; `tipText(lines: ReadonlyArray<string | undefined>): string | undefined` (non-empty lines joined by `'\n'`, `undefined` when none); `tipLines(text: string | null): string[]`; `alongAxis(start: number, end: number, size: number, room: number, gap?: number, prefer?: 'after' | 'before'): number`; `interface TipAnchor { left: number; top: number; right: number; bottom: number }`; `interface Size { width: number; height: number }`; `type TipPlacement = 'pointer' | 'below' | 'above'`; `placeTip(anchor: TipAnchor, size: Size, room: Size, placement: TipPlacement): { left: number; top: number }`; `interface RestTimer<T> { move(target: T): void; now(target: T): void; clear(): void }`; `createRestTimer<T>(show: (target: T | null) => void, delayMs?: number, same?: (a: T, b: T) => boolean): RestTimer<T>`; `describes(tip: string, name: string | null): boolean`; `interface TapNode { tag: string; role: string | null; hasHref: boolean; inSvg: boolean }`; `tapActs(path: readonly TapNode[]): boolean`; `hoverFrom(pointerType: string): boolean` (a mouse or a pen); `interface FrameThrottle<T> { push(value: T): void; cancel(): void }`; `frameThrottle<T>(run: (value: T) => void, frames?: { request(cb: () => void): unknown; cancel(handle: unknown): void }): FrameThrottle<T>` (by default the window's `requestAnimationFrame` and `cancelAnimationFrame`).
  - `mod-names.ts`: `MOD_NAMES: Readonly<Record<string, string>>` (spec §6.5's 13, lower-case keys) and `modName(key: StuffKey): string | null`.
  - `Tooltip.tsx`: `TooltipHost(): ReactElement | null` and `TipLines(props: { lines: readonly string[]; mod: string | null }): ReactElement` (hook-free: what the box holds, each line a `<div>` and the mod line a `div.nei-tooltip-mod`, every text through `<Figs>`: spec §25). Trigger contract for every later task: `data-tip` (lines joined by `\n`, first the title) and optional `data-tip-mod`; the innermost trigger wins.
  - `ItemIcon(props: { itemKey: StuffKey; size?: number; name?: string; tip?: false | readonly string[] })`.
  - CSS `.nei-tooltip`, `.nei-tooltip-mod`, `.nei-tooltip[data-state='closing']`, `@keyframes tip-out`.

- [ ] **Step 1: Write the failing unit tests**

`tests/client/tooltip-model.test.tsx` (`afterEach(() => vi.useRealTimers())`):

```ts
it('places along one axis as MapTooltip does (its six cases)', () => {
  expect(alongAxis(100, 100, 100, 400)).toBe(112); expect(alongAxis(390, 390, 100, 400)).toBe(278); expect(alongAxis(290, 290, 40, 300)).toBe(238);
  expect(alongAxis(200, 232, 100, 400)).toBe(244); expect(alongAxis(360, 392, 100, 400)).toBe(248); expect(alongAxis(40, 40, 100, 80)).toBe(0);
});
it('puts a pointer tip 12 px below and right, flipped and clamped, and an element tip at its left edge 4 px below (above: first above)', () => {
  const room = { width: 1280, height: 720 }; const size = { width: 200, height: 60 }; const at = (x: number, y: number) => ({ left: x, right: x, top: y, bottom: y });
  expect(placeTip(at(100, 80), size, room, 'pointer')).toEqual({ left: 112, top: 92 });
  expect(placeTip(at(1200, 80), size, room, 'pointer')).toEqual({ left: 988, top: 92 });
  expect(placeTip(at(100, 700), size, room, 'pointer')).toEqual({ left: 112, top: 628 });
  const head = { left: 40, top: 100, right: 140, bottom: 120 };
  expect(placeTip(head, size, room, 'below')).toEqual({ left: 40, top: 124 });
  expect(placeTip({ ...head, top: 680, bottom: 700 }, size, room, 'below')).toEqual({ left: 40, top: 616 });
  expect(placeTip(head, size, room, 'above')).toEqual({ left: 40, top: 36 });
  expect(placeTip({ ...head, top: 30, bottom: 50 }, size, room, 'above')).toEqual({ left: 40, top: 54 });
  expect(placeTip({ ...head, left: 1250, right: 1270 }, size, room, 'below').left).toBe(1080);
  expect(placeTip(head, size, { width: 150, height: 40 }, 'below')).toEqual({ left: 0, top: 0 });
});
it('joins and splits the lines, dropping empty ones', () => {
  expect(tipText(['A', undefined, '', 'B'])).toBe('A\nB'); expect(tipText([undefined, ''])).toBeUndefined(); expect(tipLines('A\n\n B \n')).toEqual(['A', 'B']); expect(tipLines(null)).toEqual([]);
});
it('shows only the target the pointer rests on, after 150 ms', () => {   // map-hover.test.tsx:285-310's sequence, on string targets
  vi.useFakeTimers(); const shown: Array<string | null> = []; const timer = createRestTimer<string>((t) => shown.push(t));
  timer.move('A'); vi.advanceTimersByTime(60); timer.move('B'); vi.advanceTimersByTime(60); timer.move('C');
  vi.advanceTimersByTime(TIP_DELAY_MS - 1); timer.move('C'); expect(shown).toEqual([]);                 // A and B never shown, C not yet
  vi.advanceTimersByTime(1); expect(shown).toEqual(['C']);
  timer.move('C'); timer.move('D'); expect(shown).toEqual(['C', null]);                                 // the same keeps it, another hides at once
  timer.clear(); vi.advanceTimersByTime(TIP_DELAY_MS); expect(shown).toEqual(['C', null]);              // clear drops D's wait
  timer.now('X'); expect(shown).toEqual(['C', null, 'X']); timer.clear(); expect(shown).toEqual(['C', null, 'X', null]);
});
it('waits as long as the map', () => expect(TIP_DELAY_MS).toBe(HOVER_DELAY_MS));
it('describes an element only when the tip says more than its name', () => {
  expect(describes('Copper Wire', 'Copper Wire')).toBe(false); expect(describes('Copper  Wire ', 'Copper Wire')).toBe(false);
  expect(describes('Basic Wiremill\ntakes Copper Ingot', 'Basic Wiremill')).toBe(true); expect(describes('Fit · F', null)).toBe(true);
});
it('lets a tap act on what acts, and show the tip on what does not', () => {
  const n = (tag: string, over: Partial<TapNode> = {}): TapNode => ({ tag, role: null, hasHref: false, inSvg: false, ...over });
  expect(tapActs([n('span'), n('li')])).toBe(false);
  for (const path of [[n('span'), n('button')], [n('a', { hasHref: true })], [n('label')], [n('summary')], [n('li', { role: 'checkbox' })], [n('g', { inSvg: true })]]) expect(tapActs(path)).toBe(true);
});
it('hovers with a mouse or a pen, never with a finger', () => {   // spec §6.1: touch's pointerover and pointerout are ignored
  expect(['mouse', 'pen', 'touch', ''].map(hoverFrom)).toEqual([true, true, false, false]);
});
it('re-places a shown tip at most once a frame, at the last pointer position', () => {
  const run = vi.fn(); const frames: Array<() => void> = []; const cancel = vi.fn();
  const throttle = frameThrottle<number>(run, { request: (cb) => frames.push(cb), cancel });
  throttle.push(1); throttle.push(2); throttle.push(3); expect(frames).toHaveLength(1); expect(run).not.toHaveBeenCalled();
  frames[0]!(); expect(run.mock.calls).toEqual([[3]]);
  throttle.push(4); throttle.cancel(); expect(cancel).toHaveBeenCalledTimes(1);
});
it('names the mod of an item key, whatever its case, and nothing for a fluid or an unknown namespace', () => {
  expect(modName('gregtech:gt.metaitem.01@2032')).toBe('GregTech'); expect(modName('IC2:itemCable@0')).toBe('IndustrialCraft 2');
  expect(modName('EnderIO:itemItemConduit@0')).toBe('Ender IO'); expect(modName('fluid:water')).toBeNull(); expect(modName('t:iron_ingot@0')).toBeNull();
  expect(Object.keys(MOD_NAMES).length).toBeLessThanOrEqual(15); for (const key of Object.keys(MOD_NAMES)) expect(key).toBe(key.toLowerCase());
});
```

And, in the same file, for what the box holds (spec §25: a tip's figures in VT323, its words and its `%` and `×` in Pixelify):
`it('writes a tip\'s figures in span.fig', () => expect(renderToStaticMarkup(<TipLines lines={['Copper Wire', 'need 80× · have 1,440', '10% chance']} mod="GregTech" />)).toBe('<div>Copper Wire</div><div>need <span class="fig">80</span>× · have <span class="fig">1,440</span></div><div><span class="fig">10</span>% chance</div><div class="nei-tooltip-mod">GregTech</div>'));`

Deliberate updates (spec §3.9 rows 7–8; [TT] §6.1): `item-icon.test.tsx:18` → `toContain('data-tip="fluid:water"')` and `not.toContain(' title=')`;
`:28` → `toContain('data-tip="Copper Wire"')`; `:30` → `not.toContain('data-tip="t:copper_wire@0"')` and `not.toContain(' title=')`;
`scaffold.test.tsx:71` → `toContain('data-tip="gregtech:gt.metaitem.01@2032"')`.
Additions: `item-icon.test.tsx` — `tip={false}` keeps `aria-label="Copper Wire"` and has no `data-tip`; `tip={['need 3 · have 1']}` gives
`data-tip="Copper Wire\nneed 3 · have 1"`; `gregtech:gt.metaitem.01@2032` gives `data-tip-mod="GregTech"` and a `t:` key none; the order
`/role="img" aria-label="Copper Wire" data-tip="Copper Wire" data-item-key=/`. `flow-pipes.test.tsx`, in the flanges describe,
`'draws no item tip inside a box, whose own title still tells it'` — `renderToStaticMarkup(<svg><FlowNodeShape node={node} /></svg>)`
matches no `/<span class="item-icon[^"]*"[^>]*data-tip=/` and still holds its `<title>` (Task 3b moves the box's words to its `data-tip`).
Contract `'draws the shared tooltip as an NEI tooltip above every layer, and fades it out in 80 ms'`: `.nei-tooltip` declarations of spec §6.3
(`position: fixed`, `top: 0`, `left: 0`, `z-index: 200`, `pointer-events: none`, `width: max-content`, `max-width: 360px`, `padding: 6px 8px`,
`overflow-wrap: anywhere`, `background: var(--tip-bg)`, `border: 2px solid var(--tip-border)`, `box-shadow: 0 0 0 1px #100010, inset 0 0 0 1px var(--tip-inner)`,
`color: #aaaaaa`, `font: 14px/1.35 var(--font-pixel)`, `animation: tip-in 120ms var(--ease-out)`); its `z-index` above `.modal-backdrop`'s;
`.nei-tooltip > :first-child` `#ffffff`; `.nei-tooltip-mod` `var(--tip-mod)` and `italic`; the closing rule `tip-out 80ms var(--ease-in) forwards`;
`KEYFRAMES` gains `'tip-out': ['opacity', 'transform']`; a source guard: `ItemIcon.tsx` does not match `/\btitle=/`. `PHASE2_RULES` gains the
four `.nei-tooltip` selectors.
Contrast: `['tooltip mod line, over a panel', '--tip-mod', { over: '--tip-bg', on: '--panel' }, AA]`, `['tooltip mod line, over white', '--tip-mod', { over: '--tip-bg', on: '#ffffff' }, AA]`,
and `expect(ratio('#5555ff', colour('light', { over: '--tip-bg', on: '--panel' }))).toBeLessThan(AA)` (the mockups' blue, why it changed).

- [ ] **Step 2: Write the failing e2e** — `tests/e2e/tooltips.spec.ts`, auto-waiting `expect` only; (7) and (11) sit in a `test.describe` with `test.use({ hasTouch: true })`:
1. `'an item icon shows its name in the NEI tooltip, which takes no pointer and goes when the pointer leaves'` — `createProject(page, …, LV_CIRCUITS)`,
   Materials tab, `li.mat-row .item-icon` first: no `title`; hover → `getByRole('tooltip')` contains its `aria-label`, `pointer-events` `none`,
   its box inside 1280 × 720; `mouse.move(5, 5)` → count 0.
2. `'one tip at a time: the last icon pointed at'` — hover icon A then icon B: the strict tooltip contains B's name.
7. `'a tap shows an icon\'s tip, a second tap or a tap elsewhere hides it'` — `tap()` the Materials icon → visible; `tap()` again → 0; tap → visible; `tap()` `#to-build-title` → 0.
8. `'under reduced motion a tip appears at once'` — its `animationDuration` `0.001s`.
9. `'in the drawer the first Escape hides a tip, the second closes the drawer'` — 800 × 900, `createProject(page, 'Drawer tip', LV_CIRCUITS)`, open the drawer with `page.getByRole('button', { name: SETTINGS_BUTTON }).click()` (helpers' `/^Settings/`, as `drawer.spec.ts:19`; with `LV_CIRCUITS` the button reads "Settings · Make: Basic Circuit"), hover `aside .settings-target .item-icon`; Escape → tip 0 and the toggle `aria-expanded="true"`; Escape → `"false"`. In (9) and (10) "the toggle" is that same `SETTINGS_BUTTON` locator: getByRole still finds it while the head is inert, as `drawer.spec.ts:306` does.
10. `'a tip whose trigger goes away under a still pointer goes too, and never takes the next Escape'` (Review Focus 2) — 800 × 900, `createProject(page, 'Tip goes', LV_CIRCUITS)` (it has a target, so the drawer does not open by itself into the search: keep that out of this case), the drawer opened by `SETTINGS_BUTTON`, fill `page.locator('aside[aria-label="Project settings"]').getByPlaceholder('Search items and fluids')` with
   `Iron Ingot`, hover the first `[role=option] .item-icon` → tip; `fill('zzqxv')` (no match: the list unmounts) → tip count 0 with the pointer unmoved; one Escape → the toggle `aria-expanded="false"`.
11. `'a long press on an icon shows its tip, and the next tap still acts'` (P2-D21) — CDP `Input.dispatchTouchEvent` `touchStart` at the Materials icon's
   centre; `getByRole('tooltip')` visible while the finger is down (polled); `touchEnd`; then `tap()` the `Flow` tab → its `aria-selected="true"`: the
   long press's click guard has expired and never eats the next tap.
`DARK_TOUR` gains a stop `'an item\'s tip'` (`createProject(page, 'Dark tip', LV_CIRCUITS)`, Materials tab, hover the first `li.mat-row .item-icon`, wait
for the tooltip): `.nei-tooltip` `background-color` `rgba(16, 0, 16, 0.94)`.

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/tooltip-model.test.tsx tests/client/item-icon.test.tsx tests/client/scaffold.test.tsx tests/client/flow-pipes.test.tsx tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx` → FAIL (no `tooltip-model.ts`, `title=` still drawn, no `.nei-tooltip`).

- [ ] **Step 4: Implement the model and the item tips**

`tooltip-model.ts` with the Interfaces' signatures: `alongAxis` is MapTooltip's `along` (`MapTooltip.tsx:13-17`) with the gap a parameter (its six
cases and `placeTip`'s fix the rest); `createRestTimer` generalises `createHoverTimer` (`map/hover.ts:275-306`) with `now` and the `same` test;
`tapActs` is true when any node is `a` with `href`, `button`, `input`, `select`, `textarea`, `summary`, `label`, has a role in
`button|checkbox|radio|tab|option|link`, or the last (the trigger) is in an svg; `frameThrottle` keeps the last value and at most one pending frame.
`MapTooltip.tsx` imports `alongAxis` for `along` and keeps `export const TOOLTIP_OFFSET = 12`. `mod-names.ts`: the 13 rows of spec
§6.5; `modName` lower-cases the part before the first `:` and returns `null` for `fluid` and anything not in the table.
`ItemIcon`: `title` goes; `data-tip={props.tip === false ? undefined : tipText([label, ...(props.tip ?? [])])}` then
`data-tip-mod={props.tip === false ? undefined : modName(itemKey) ?? undefined}` where `title` was; doc comment updated.
`tip={false}` at `AvoidPicker.tsx:51`, `SettingsPanel.tsx:267`, `ProjectPage.tsx:183` (their native titles stay; the base adds no other
ItemIcon inside a titled element: its new farm and surplus rows put the `title` on a sibling `span.key-name`) and on the two Flow box icons
(`FlowView.tsx:165`, `:219`: the box's `<title>` still tells them until Task 3b, so nothing shows two tips).
The native titles added since `cfaa05b` stay native and need no `tip={false}`: none is an ItemIcon or holds one. P2-D11 converts only
ItemIcon's title and the four SVG `<title>`s, and the guard stays `ItemIcon.tsx` without `/\btitle=/` (plus Task 3b's two diagram files).
The four are (still four at `01da27d`: its fixes give a Compare figure an inline `--glyphs` style and no `title`, so a figure cut past
13 px has no native tip either):
- `SettingsToggle.tsx:22` `<span className="settings-toggle-target" title={targetName ?? undefined}>`, the full target behind the
  ellipsis. `settings-toggle.test.tsx:35` (`not.toContain('title=')`) and `:41`
  (`toContain('<span class="settings-toggle-target" title="Basic Circuit">· Make: Basic Circuit</span>')`) stay unchanged.
- `CompareCard.tsx:184` and `:185`, the Avoids and Adds notes.
- `SettingsPanel.tsx:816`, a running farm's `span.key-name` with `title={row.key}`, a sibling of its icon at `:815`.

No SVG `<title>` was added; they are still `FlowView.tsx:134`, `:213`, `:266` and `ConnectionsView.tsx:132`. The new icons take the
default tip: `MaterialsView.tsx:262` (a byproduct another project takes that the line leaves none of), `SettingsPanel.tsx:815` (a running
farm's item) and `:869` (the item picked in Add a farm).
`styles.css`: spec §6.3's rules after `:996` and `@keyframes tip-out` after `:106`.

- [ ] **Step 5: Implement `TooltipHost`**

`Tooltip.tsx`: the behaviour table of spec §6.1, placement §6.2, markup §6.3, ARIA §6.6, with these decisions:
- State: `{ trigger: Element; anchor: Element; mode: 'pointer' | 'focus' | 'touch'; x: number; y: number; lines: string[]; mod: string | null; closing: boolean } | null`;
  `useId()` for the id; rendered (portal on `document.body`) only while not null.
- Listeners on `document`: `pointerover`, `pointermove`, `pointerout`, `pointerdown` and `keydown` and `click` in the capture phase, `pointerup`,
  `focusin`, `focusout`, `contextmenu`; on `window`: `scroll` (capture, passive), `wheel` (passive), `resize`, `blur`; `document` `visibilitychange`.
- Mouse and pen (`hoverFrom(e.pointerType)`; touch's `pointerover` and `pointerout` do nothing) go through one `createRestTimer<Element>`, and a
  shown pointer tip is re-placed on `pointermove` through one `frameThrottle`; touch and focus have their own timers; `quiet: WeakSet<Element>`
  holds a pressed or Escaped trigger until the pointer leaves it or focus moves.
- Touch: `pointerdown` remembers the point and starts a `LONG_PRESS_MS` timer (cancelled past 4 px, `DRAG_THRESHOLD`, or on `pointerup`); on `pointerup`
  a tap whose path (target up to the trigger, as `TapNode`s) does not `tapActs` shows at once, placement `'above'`, and a second tap on it hides it;
  a long press shows the tip and arms one `contextmenu` `preventDefault()` and one `click` `preventDefault()` + `stopPropagation()` in the capture
  phase on `document` (before React's root), so a long press never ticks or picks; a `contextmenu` that arrives while a touch press on a
  trigger is still down, before the timer, counts as the long press (the browser's own long-press threshold may come first); both guards
  are disarmed by the next `pointerdown` or `LONG_PRESS_CLICK_MS` after the `pointerup`, whichever comes first (a browser that sends no
  click after a long press must not lose the next tap).
- Escape (capture): only while a tip shows — hide it, quiet its trigger, `preventDefault()`, never `stopPropagation()`.
- Enter or Space on the element a focus tip is anchored to hides the tip and quiets it until the focus moves.
- While shown, one rAF loop hides when `!trigger.isConnected`, re-reads `data-tip` (hides when it is gone), and re-anchors focus and touch tips; it stops when the tip hides.
- Placement in `useLayoutEffect`: `offsetWidth/Height`, room `document.documentElement.clientWidth/Height`; an element anchor is its rect intersected with
  its outermost svg's (walk `ownerSVGElement`), and an empty intersection hides the tip.
- `aria-describedby`: merged as one token on the focused element (focus) or the trigger, only when `describes(text, el.getAttribute('aria-label'))`; on
  hide or closing only our id is removed.
- Exit: `closing` renders the same box with no `role`, `aria-hidden="true"`, `data-state="closing"`, removed on `animationend` or after `TIP_EXIT_MS`;
  a new tip during the exit replaces it at once.
- The box holds `<TipLines lines={lines} mod={mod} />`: spec §6.3's lines and mod line, each written through `<Figs>` (Task 2b), so a
  tip's figures are VT323 `span.fig` and its words Pixelify (spec §25); `.nei-tooltip`'s own rule stays `14px/1.35 var(--font-pixel)`.
`App.tsx`: `<TooltipHost />` after `<NamePrompt />`.

- [ ] **Step 6: Run everything** — `npm test` → PASS; `npm run e2e` → PASS. Watch `world.spec.ts` (its strict `getByRole('tooltip')`), `drawer.spec.ts`,
  `slots.spec.ts`, and the unit watch list of spec §6.7 (`map-hover`, `avoid-picker`, `map-summary`, `plan-banner`).

- [ ] **Step 7: Review shots** — label `3a`: append shots for a Materials icon's tip and the drawer's target icon's tip; compare with
  `Phase2Feedback.dc.html` (below-right of the pointer, not above, P2-D36).

- [ ] **Step 8: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(client): one shared NEI tooltip, on item icons first" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3b: The diagrams' boxes and arrows show the NEI tooltip

**Files:**
- Modify: `src/client/views/FlowView.tsx` (`:127-139`, `:168`, `:203-213`, `:222`, `:244-251`, `:262-266`); `src/client/views/flow-model.ts` (`:75-82`, `:626-659`); `src/client/views/ConnectionsView.tsx` (`:66-69`, `:103`, `:113-132`)
- Modify: `tests/e2e/helpers.ts`, `tests/e2e/pipes.spec.ts:147-163` (`openConnections` moves to helpers), `tests/e2e/tooltips.spec.ts`
- Test (deliberate, spec §3.9): `tests/client/flow-pipes.test.tsx:14-17`, `:33-35`; `tests/client/connections-view.test.tsx:119-124` (the comment `:119-120`, the case `:122-124`), `:138`, `:259`
- Test (additions): `tests/client/flow-pipes.test.tsx`, `tests/client/flow.test.tsx`, `tests/client/connections-view.test.tsx`, `tests/client/styles-contract.test.tsx`, `tests/client/materials-from.test.tsx`

**Interfaces:**
- Consumes: Task 3a's trigger contract, `tipText` and `TooltipHost` (whose `TipLines` already writes a tip's figures in VT323 `span.fig`, spec §25: a box's or an arrow's rates need nothing here, and the e2e read the tip's text, which the spans leave whole); `openWithPlan`, `circuitLv`.
- Produces:
  - `FlowEdge.route?: string` (optional addition), `title === \`${name} · ${rate} · ${route}\``.
  - e2e `openConnections(page: Page): Promise<Locator>` in `helpers.ts` (pipes.spec.ts:147-163's, moved; helpers imports `uploadSampleWorld` from `./world-upload.ts`).

- [ ] **Step 1: Write the failing unit tests**

Deliberate updates (spec §3.9 rows 9–10; [TT] §6.1): the `flow-pipes.test.tsx` fixture edge gains `route: 'A → B'` and `:35` becomes
`toContain('<g class="flow-edge item" data-edge-id="e1" data-key="t:iron_ingot@0" style="--pipe-dur:1s" aria-label="Iron Ingot · 1/s · A → B" data-tip="Iron Ingot\n1/s\nA → B"><path class="flow-edge-hit"')`
with `not.toContain('<title')` (comment `:33-34` updated); `connections-view.test.tsx:122-124` reads the box's tag and inside
(`const [, tag, box] = /(<g data-node="step:b"[^>]*>)(.*?)<\/g>/s.exec(shell())!`): the tag's ` data-tip="…"` and ` aria-label="…"` both
equal the old `<title>` text, and `box` starts `/^<rect /` (comment `:119-120`: the box's words are its `data-tip`);
`:138` → ``toContain(`data-tip="${text(33)}\n${text(39)}\n${text(39)}"`)``; `:259` → `/^<rect width="260" height="46" rx="0"><\/rect><path d="M 0 46 H 260 V 84 /`.
Additions: `flow-pipes.test.tsx` `'tells a box\'s words in its tooltip and name'` — the mill node: no `<title`; tip =
`'Wiremill\nLV · 32 EU/t · 1 machine\ntakes Copper Ingot 1/s\nmakes Copper Wire 2/s'` and the tag starts
``<g class="flow-node step new" data-node-id="mill" data-step-id="mill" data-kind="step" transform="translate(0 0)" aria-label="${tip}" data-tip="${tip}">``,
its first child `rect.flow-node-box`. `flow.test.tsx` — the collapsed Red Alloy line box of `:369-371`, drawn by `FlowNodeShape` at (0, 0),
contains `data-tip="Open the Red Alloy line"`; every edge of `flowGraph(plan, 'min')` has `title === \`${name} · ${rate} · ${route}\``.
`connections-view.test.tsx` — `shell()` has no `<title`. Contract: the source guard grows — FlowView and ConnectionsView do not contain `<title>`.
`tests/client/materials-from.test.tsx`, inside `describe('farm steps and from imports in the flow')` (`:154`), importing `FlowNodeShape`
from `../../src/client/views/FlowView.tsx`: `it('tells a from import and a farm step\'s words in the diagram\'s tooltips', …)` with
`const graph = flowGraph(farmed, 'min'); expect(graph.edges.find((e) => e.from === 'import:t:latex@0@mixer')?.route).toBe('import (from Rubber line) → Mixer (Glue)'); const box = graph.nodes.find((n) => n.id === 'tgs-rubber')!; const tag = /<g class="flow-node[^"]*" data-node-id="tgs-rubber"[^>]*>/.exec(renderToStaticMarkup(<svg><FlowNodeShape node={{ ...box, x: 0, y: 0 }} /></svg>))![0]; expect(/ data-tip="([^"]*)"/.exec(tag)![1]!.split('\n')).toContain(TGS_FARM.text);`
(`TGS_FARM` is at `:59-62`; its text has no character React escapes).

- [ ] **Step 2: Write the failing e2e** — `tooltips.spec.ts` gains (3)–(6), and (12) in its touch describe:
3. `'a Flow box\'s tip lists its machine and what it takes, and Escape clears it with the highlight'` — `openWithPlan(page, circuitLv())`, hover
   `[data-step-id="wire"] .flow-node-head` (the head: its `rect.flow-hit` lies over the box rect, which a hover could never reach): first line
   `Basic Wiremill`, a line contains `takes Copper Ingot`, and `svg.flow-canvas` `toHaveClass(/\bfocusing\b/)` (the hover lit the box); Escape →
   count 0 and `svg.flow-canvas` `not.toHaveClass(/\bfocusing\b/)`.
4. `'an arrow\'s tip has three lines'` — the mouse at `getScreenCTM()`-mapped `getPointAtLength(length / 2)` of the `[data-edge-id^="wire|out"] path.flow-edge-hit`:
   `getByRole('tooltip').locator(':scope > div')` count 3.
5. `'a step head focused from the keyboard shows its box\'s tip below it, described by it, and tabbing away clears both'` — `.flow-node-head` of
   `[data-step-id="wire"]` focused by `focus()` + Shift+Tab + Tab: the tip's top ≥ the head's bottom; the head's `aria-describedby` is the tip's
   id; Tab (to the box's first row) → the same box's tip again, its top ≥ that row's bottom, and the head has no `aria-describedby`; Escape →
   count 0 and the row has no `aria-describedby`. Then the canvas's first focusable (`svg.flow-canvas [tabindex="0"]`, first), focused the same
   way, shows its box's tip and carries `aria-describedby`; Shift+Tab (out of the canvas, to `Imports in one column`, which has no tip) →
   tooltip count 0 and the element left has no `aria-describedby`.
6. `'a Connections box\'s tip tells its texts in full, and a press hides it'` — `openConnections(page)`, hover the first `.conn-machine > rect`: the tip
   contains `In / Out` (its conduit face's mode, spec §6.7); `mouse.down()` → count 0.
12. `'a tap on a Flow box picks it and shows no tip'` — `tap()` `[data-step-id="wire"] .flow-node-head` → `getByRole('complementary', { name: 'Step: Basic Wiremill' })`
   visible and tooltip count 0 (a tap on an SVG trigger only acts).

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/flow-pipes.test.tsx tests/client/flow.test.tsx tests/client/connections-view.test.tsx tests/client/styles-contract.test.tsx tests/client/materials-from.test.tsx` → FAIL (`<title>` in the diagrams, no `route`).

- [ ] **Step 4: Implement the diagram triggers**

`flow-model.ts` `finishArrows` (`:657-658`) builds ``route = `${endWords(a.from)} → ${endWords(a.to)}` `` and the unchanged title from it
(`endWords`, `:638-654`, names an import through `ctx.imports` — add-on 17's `importWords`, `:331-351`, e.g. `import (from Rubber line)` —
so `route` reuses `endWords` unchanged, and `title` stays `${name} · ${rate} · ${route}`, which the base pins at `materials-from.test.tsx:181`);
`FlowEdge` gains `route?: string`. `FlowView.tsx`: the box `<title>` goes and `const tip = tipText([...described, ...node.rows.map((r) => rowWords(node, r))])`
lands as `aria-label={tip} data-tip={tip}` after `transform`; the arrow's `<title>` goes and `aria-label={edge.title} data-tip={tipText([edge.name, edge.rate, edge.route])}`
follow `style`; LineToggle's `<title>` goes and `data-tip={label}` follows `transform`; comments `:168`, `:222`, `:244-251` say "tooltip and
accessible name". `ConnectionsView.tsx`: the box `<title>` goes, `aria-label={tip} data-tip={tip}` after `transform` with
`tip = tipText([node.title, ...node.lines, ...node.faces.map(faceTip)])`, comments `:66-69`, `:103`, `:113-115`; links untouched.
`helpers.ts` gains `openConnections` (moved from `pipes.spec.ts:147-163`, which imports it).

- [ ] **Step 5: Run everything** — first `npm run e2e -- tests/e2e/flow-focus.spec.ts tests/e2e/connections.spec.ts tests/e2e/pipes.spec.ts`: their
  `toContainText` (`flow-focus.spec.ts:91-93`, `connections.spec.ts:37`, `pipes.spec.ts:161`) now read only the visible text (spec §3.8). Then
  `npm test` → PASS; `npm run e2e` → PASS. Watch `flow-focus.spec.ts` (2) and (6), `reuse`, `plan`.

- [ ] **Step 6: Review shots** — label `3b`: append shots for a Flow box's tip, an arrow's tip and the Connections box's tip; against `Phase2Feedback.dc.html`.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(client): the NEI tooltip on Flow boxes and arrows and on Connections boxes, in place of their SVG titles" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Flow step boxes as machine readouts (with R41)

**Files:**
- Modify: `src/client/views/flow-model.ts` — imports `:11-19`, `FlowNode` `:39-58`, metrics after `:142`, `rowsTop`/`rowCentre` `:251-259`, `sized` `:287-300`, `stepBox` `:479-492` (`stepLines` above it now ends with a farm step's `step.farm.text`, `:320`)
- Modify: `src/client/views/FlowView.tsx` — imports `:26-31`, `FlowNodeShape` `:186-242`, the arrow pick `:260` and doc `:244-251`
- Modify: `src/client/styles.css` — after `.flow-port` rules (`:739-740`), the forced-colours block (`:1412-1430`; it now ends with add-on 17's `.compare-toggle[aria-expanded='true']` and `.compare-column.current` cues at `:1427-1429`: append the new rules after them)
- Create: `tests/e2e/flow-boxes.spec.ts`
- Modify: `tests/client/flow.test.tsx`, `tests/client/flow-pipes.test.tsx` (`:59-60` deliberate, R41), `tests/client/styles-contract.test.tsx`, `tests/client/contrast.test.tsx`, `tests/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: `ItemIcon` `tip={false}` (Task 3a), `Figs` with `svg` (Task 2b), `PSEUDO_IDS` (`src/shared/gt/tiers.ts:34`), the feature tokens, `PHASE2_RULES`, `FLOW_RULES`, `PAIRS`, `DARK_TOUR`, `openWithPlan`.
- Produces (`flow-model.ts`, pure):
  - `interface MachineReadout { iconKey: StuffKey | null; tier: { name: string; slug: string } | null; count: string | null; power: string | null; busy: number; busyText: string; high: boolean }`
  - `machineIconKey(machine: PlanStep['machine'], handCraft: boolean): StuffKey | null`, `machineReadout(step: PlanStep): MachineReadout` (`tier` null by hand or on a pseudo machine, `PSEUDO_IDS.has(mteId)`: plan ruling `pseudo-tier-chip`; `count` null by hand; `power` null by hand or at 0 EU/t), `tierSlug(t: number): string`, `chipWidth(text: string): number` (`text.length × CHIP_CHAR_WIDTH + 2 × CHIP_PADDING`), `busyTrack(node: Pick<FlowNode, 'width'>): number` (`node.width − 2 × TEXT_LEFT − 6 − textWidth('>99.9%', TEXT_CHAR_WIDTH)`, i.e. width − 60)
  - `MACHINE_ICON = 32`, `MACHINE_SLOT = 36`, `STEP_HEAD_HEIGHT = 46`, `BUSY_BAND = 16`, `CHIP_HEIGHT = 16`, `CHIP_PADDING = 5`, `CHIP_CHAR_WIDTH = 9` (the tier's Pixelify 13 px and a count's digits, VT323 at 14.95 px in `tspan.fig`, both fit it with the fonts and without: spec §25)
  - `FlowNode.machine?: MachineReadout` (optional addition, set by `stepBox` on every step); `rowsTop`/`rowCentre` take `Pick<FlowNode, 'lines' | 'avoidBadge' | 'machine'>`
  - CSS classes `.tier-<slug>` (each sets `--tier-ink: var(--tier-<slug>)`; the recipe card's HTML chips reuse them), `.flow-machine`, `.flow-machine-slot`, `.flow-slot-lo`, `.flow-slot-hi`, `.flow-chip`, `.flow-node-power`, `.flow-busy`, `.flow-busy-track`, `.flow-busy-fill`, `.flow-busy-text`

- [ ] **Step 1: Write the failing unit tests**

`flow.test.tsx`, `describe('flow diagram: machine readouts')` (`plan`, `step` and `nodeOf` are the file's; `at0(n)` is `({ ...n, x: 0, y: 0 })`):

```ts
it('keys a machine\'s icon by its MTE id, a pseudo machine as the server does, and a hand step none', () => {
  expect(machineIconKey({ mteId: 121, name: 'Basic Assembler', tier: 1 }, false)).toBe('gregtech:gt.blockmachines@121');
  for (const m of PSEUDO_MACHINE_ENTRIES) expect(machineIconKey({ mteId: m.mteId, name: m.name, tier: 0 }, false), m.name).toBe(m.itemKey);   // src/server/pack/machines.ts:41-44
  expect(machineIconKey({ mteId: -1, name: 'Crafting table (by hand)', tier: 0 }, true)).toBeNull();
});
it('reads a step\'s tier, machines, power and how busy it is', () => {
  expect(machineReadout(step({}))).toEqual({ iconKey: 'gregtech:gt.blockmachines@121', tier: { name: 'LV', slug: 'lv' }, count: '×5', power: '16 EU/t', busy: 1, busyText: '100%', high: true });
  expect(machineReadout(step({ count: 1, pool: { id: 'pool:a', steps: ['a', 'circuit-lv'] } })).count).toBe('×1 shared');
  expect(machineReadout(step({ utilization: 0.625 }))).toMatchObject({ busy: 0.625, busyText: '63%', high: false });
  expect(machineReadout(step({ utilization: 0.9 })).high).toBe(true); expect(machineReadout(step({ utilization: 1.4 })).busy).toBe(1);
  expect(machineReadout(step({ euPerTick: 0 })).power).toBeNull();
  expect(machineReadout(step({ handCraft: true, machine: { mteId: -1, name: 'Crafting table (by hand)', tier: 0 } }))).toMatchObject({ iconKey: null, tier: null, count: null, power: null });
  expect(machineReadout(step({ machine: { mteId: -2, name: 'Furnace', tier: 0 }, euPerTick: 0 })))   // no voltage tier, so no chip (plan ruling pseudo-tier-chip)
    .toMatchObject({ iconKey: 'minecraft:furnace@0', tier: null, count: '×5', power: null });
});
it('slugs a tier for its colour class, and an unknown one as unknown', () => {
  expect([0, 1, 6, 14].map(tierSlug)).toEqual(['ulv', 'lv', 'luv', 'max']); expect(tierSlug(15)).toBe('unknown'); expect(tierSlug(-1)).toBe('unknown');
});
it('starts a readout box\'s rows below its 46 px head and 16 px busy band', () => {
  const box = nodeOf(flowGraph(plan, 'min'), 'circuit-lv');
  expect(box.machine).toBeDefined(); expect(rowsTop(box)).toBe(46 + 16 + 16 * (box.lines.length - 1));
  expect(rowsTop({ ...box, avoidBadge: { text: 'x', warnings: [] } })).toBe(46 + 16 + 16 * box.lines.length);
  expect(rowsTop({ ...box, machine: undefined })).toBe(28 + 16 * box.lines.length);   // a stub, as today
  expect(box.lines).toEqual(['LV · 16 EU/t · 5 machines · 100% busy']);                    // the words stay (:71)
});
it('draws a readout box\'s machine, chips and busy bar in its head', () => {
  const html = renderToStaticMarkup(<svg><FlowNodeShape node={at0(nodeOf(flowGraph(plan, 'min'), 'circuit-lv'))} /></svg>);
  expect(html).toContain('<g class="flow-machine" aria-hidden="true">'); expect(html).toContain('data-item-key="gregtech:gt.blockmachines@121"');
  expect(html).toMatch(/<g class="flow-chip tier-lv" transform="translate\(52 25\)"><rect width="28" height="16"><\/rect><text x="14" y="12.5">LV<\/text><\/g>/);
  expect(html).toContain('>×<tspan class="fig">5</tspan></text>'); expect(html).toContain('>16 EU/t</text>'); expect(html).toContain('<g class="flow-busy high">');   // a count's digits in VT323 (spec §25)
  const node = at0(nodeOf(flowGraph(plan, 'min'), 'circuit-lv'));
  expect(html).toContain(`<rect class="flow-busy-fill" x="8" y="51" width="${busyTrack(node)}" height="6">`);
  expect(html.match(/<g class="([^"]*)" data-node-id/)?.[1]).toBe('flow-node step new'); expect(html).not.toMatch(/\b(hl|dim)\b/); expect(html).not.toContain('<circle');
});
it('draws a pseudo machine\'s count chip first, and a hand step\'s "by hand" with no chip', () => {
  const box = (s: PlanStep): string => renderToStaticMarkup(<svg><FlowNodeShape node={at0(nodeOf(flowGraph({ ...plan, steps: [s] } as Plan, 'min'), 'circuit-lv'))} /></svg>);
  const furnace = box({ ...plan.steps[0]!, machine: { mteId: -2, name: 'Furnace', tier: 0 }, euPerTick: 0 });
  expect(furnace).toContain('<g class="flow-chip" transform="translate(52 25)"><rect width="28" height="16"></rect><text x="14" y="12.5">×<tspan class="fig">5</tspan></text></g>');
  expect(furnace).not.toContain('flow-chip tier-'); expect(furnace).toContain('data-item-key="minecraft:furnace@0"');
  const hand = box({ ...plan.steps[0]!, handCraft: true, machine: { mteId: -1, name: 'Crafting table (by hand)', tier: 0 }, euPerTick: 0 });
  expect(hand).toContain('<text class="flow-node-power" x="52" y="37">by hand</text>'); expect(hand).not.toContain('flow-chip');
  expect(hand).toMatch(/<foreignObject x="10" y="8" width="32" height="32"><span class="item-icon[^>]*data-item-key="t:circuit@0"/);   // its slot shows its main output
});
it('reads a farm step as the farm machine it needs, tier chip and all, and cuts its farm words below the band', () => {
  // add-on 17: a Tree Growth Simulator's tier is its energy hatch's and a Crop Manager's its own, voltage tiers both, so plan ruling pseudo-tier-chip does not apply
  const words = 'Tree Growth Simulator (LV): Rubber Sapling in the controller; Saw and Knife (Steel) in an input bus';
  const tgs: PlanStep = { ...plan.steps[0]!, machine: { mteId: 15541, name: 'Tree Growth Simulator', tier: 1 }, count: 1, euPerTick: 30, utilization: 0.5,
    farm: { kind: 'tgs', tier: 1, footprint: [7, 7, 7], text: words, sapling: 't:rubber_sapling@0', tools: ['gregtech:gt.metatool.01@10'] } };
  expect(machineReadout(tgs)).toEqual({ iconKey: 'gregtech:gt.blockmachines@15541', tier: { name: 'LV', slug: 'lv' }, count: '×1', power: '30 EU/t', busy: 0.5, busyText: '50%', high: false });
  // a Crop Manager draws a fraction of an EU/t: its recipe's EU/t × the 121 crop sticks it tends (farmOc)
  expect(machineReadout({ ...tgs, machine: { mteId: 28001, name: 'Basic Crop Manager', tier: 1 }, euPerTick: (4.5235540375 / 5120) * 121 }))
    .toMatchObject({ iconKey: 'gregtech:gt.blockmachines@28001', tier: { name: 'LV', slug: 'lv' }, count: '×1', power: '0.107 EU/t' });
  const box = nodeOf(flowGraph({ ...plan, steps: [tgs] } as Plan, 'min'), 'circuit-lv');
  expect(box.lines).toEqual(['LV · 30 EU/t · 1 machine · 50% busy', words]);   // the words keep the whole sentence
  expect(box.width).toBe(330); expect(rowsTop(box)).toBe(46 + 16 + 16);
  const html = renderToStaticMarkup(<svg><FlowNodeShape node={at0(box)} /></svg>);
  expect(html).toContain('data-item-key="gregtech:gt.blockmachines@15541"'); expect(html).toContain('<g class="flow-chip tier-lv" transform="translate(52 25)">');
  expect(html).toContain('<text class="flow-node-line" x="8" y="73">Tree Growth Simulator (LV): Rubber Sapling in the…</text>');
});
```
The width bounds (`:242-247`) and the port check (`:392-423`) run unchanged and now cover readout boxes.
`flow-pipes.test.tsx`: `:59-60` (R41, deliberate) → comment `// a lit missing arrow keeps its white head (ruling R41): yellow reads 2.95:1 on its red casing`
and `toContain('marker-end="url(#flow-arrow-missing)"')`; the flange case repeated with `machine: machineReadout(<a step>)` on the node:
`x="198" y="${rowCentre(node, 1) - 5}"` and the two node pins still hold.
Contract `'draws a step\'s machine in a slot, its tier and count on Pixelify chips, and how busy it is'`: spec §7.3's CSS (`.tier-lv`
`--tier-ink: var(--tier-lv)` for each of the 15 slugs, `.flow-node .flow-chip.tier-max text` `font-weight: 700`, `.flow-machine-slot` `fill: var(--slot)`,
`.flow-slot-lo`/`-hi`, `.flow-chip rect` `fill: var(--flow-chip)`, `.flow-node .flow-chip text` `fill: var(--tier-ink, var(--stack-ink))`, `font: 13px/1 var(--font-pixel)` (a count's digits ride in Task 2b's `tspan.fig`, so no chip rule names `var(--font-digits)`),
`text-anchor: middle`, `.flow-node .flow-node-power` `fill: var(--text-muted)` and `font-size: 11px`, the three busy fills, `.flow-node .flow-busy-text`
`font-size: 11px`, `tabular-nums`, `text-anchor: end`); forced colours `inQuery(FORCED, '.flow-busy-fill, .flow-busy.high .flow-busy-fill')`
`[['fill', 'Highlight']]` (the high fill's own rule outranks a bare `.flow-busy-fill`, and the block repaints at the specificity of
what it repaints) and `inQuery(FORCED, '.flow-busy-track, .flow-chip rect')` `[['stroke', 'CanvasText']]`; the new selectors join `FLOW_RULES` and `PHASE2_RULES`
(the `drop-shadow` case at `:1290` keeps holding).
Contrast: `['count chip', '--stack-ink', '--flow-chip', AA]`, each `TIERS` ink on `--flow-chip` (`` `tier chip ${tier}` ``, AA), `['busy fill', '--flow-busy', '--flow-busy-track', GRAPHICS]`,
`['busy fill, high', '--flow-busy-high', '--flow-busy-track', GRAPHICS]`, `['machine power on a new box', '--text-muted', '--flow-new', AA]`,
`['machine power on an owned box', '--text-muted', '--flow-owned', AA]`.

- [ ] **Step 2: Write the failing e2e** — `tests/e2e/flow-boxes.spec.ts` on `openWithPlan(page, circuitLv())` (fixture `wire`: `count: 2`, `utilization: 0.625`):
1. `'a step box shows its machine, its tier and count chips and how busy it is'` — `[data-step-id="wire"] [data-item-key="gregtech:gt.blockmachines@111"]` count 1;
   `[data-step-id="wire"] .flow-chip text` texts `['LV', '×2']`; fill `getBBox().width` / track `getBBox().width` `toBeCloseTo(0.625, 2)`.
2. `'every chip\'s text fits its chip, with the fonts and without them'` — for a context with `page.route(/\.woff2?$/, (r) => r.abort())` and one without,
   each read after `await document.fonts.ready` and with `chrome.spec.ts`'s premise (the blocked context loaded no face, the other a
   Pixelify and a VT323 one, for a count's digits are VT323): every `.flow-chip` has `text.getComputedTextLength() ≤ rect.width − 2 × 5`
   (measured for spec §25: '×2' and '×5' 13.8 px with the fonts, 14.5 px without, against 18).
3. `'in forced colours the busy fill and track differ and the chips stay visible'` — `emulateMedia({ forcedColors: 'active' })`: the computed `fill` of
   `[data-step-id="wire"] .flow-busy-fill` ≠ that of its `.flow-busy-track`, and `[data-step-id="circuit-lv"] .flow-busy-fill` (100 % busy:
   `high`) computes the wire's fill; `.flow-chip rect` computes a `stroke` ≠ `none`.
`DARK_TOUR` `'the Flow tab'` gains `[data-step-id="wire"] .flow-chip rect` `fill` `rgb(11, 11, 11)`.

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/flow.test.tsx tests/client/flow-pipes.test.tsx tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx` → FAIL.

- [ ] **Step 4: Implement** — the model functions with the Interfaces' signatures and spec §7.2's `rowsTop` body; `machineIconKey` repeats
  `minecraft:crafting_table@0` (−1) and `minecraft:furnace@0` (−2), `null` by hand or for −3; `sized()` counts, for a box with `machine`, the head
  `8 + 36 + 8 + textWidth(title, 7.4) + 8`, the chip row as 52, plus `chipWidth + 4` for each chip present (the tier's, then the count's),
  plus `2 + textWidth(power, 6.2)` with power, plus 8 (with all three that is spec §7.2's `52 + chipWidth(tier) + 4 + chipWidth(count) + 6 + textWidth(power, 6.2) + 8`; by hand:
  `52 + textWidth('by hand', 6.2) + 8`), the busy band `8 + 60 + 6 + textWidth('>99.9%', 6.2) + 8` and `lines.slice(1)` instead of `lines`, clamped
  to 190–330. `FlowView.tsx`: a `MachineReadoutShape(props: { node: PlacedNode; machine: MachineReadout }): ReactElement` drawing spec §7.3's
  markup (icon `itemKey={machine.iconKey ?? node.key}` with `tip={false}`, none when both are null; a hand step's chip row is `<text className="flow-node-power" x={52} y={37}>by hand</text>`;
  the chips from x = 52, each 4 px after the one before, each chip's text `<Figs text={…} svg />` (a count's digits in `tspan.fig`,
  its `×` Pixelify: spec §25, plan ruling `digits-mixed`), and the power text 6 px after the last chip, `x = 52 + chipWidth(tier) + 4 + chipWidth(count) + 6`
  with both); in `FlowNodeShape` a box with `machine` draws it inside the head's nested svg in
  place of the 16 px head icon and `lines[0]`, the title at `x = 52`, `lines[1…]` at `62 + 16 i + 11` (`i` = 0 at `lines[1]`), each drawn as
  `clipText(line, node.width − 2 × TEXT_LEFT, TEXT_CHAR_WIDTH)`, so a long one (add-on 17's farm words) ends in "…" as the title does;
  `FlowNode.lines` keep the whole words (the head's aria-label and the box's tip), the badge at `translate(BADGE_LEFT, 62 + 16 (lines.length − 1))`.
  A farm step needs no other code (plan ruling `farm-step-readout`): it is a machine step (icon `gregtech:gt.blockmachines@<mteId>`, its
  tier chip, the ×count of farm machines, power through `formatNumber`, the busy band).
  R41: `const arrow = missing ? 'flow-arrow-missing' : lit === true ? 'flow-arrow-hl' : fluid ? 'flow-arrow-fluid' : 'flow-arrow';` and the doc comment.
  `styles.css`: spec §7.3's rules after `:740` (`.flow-row.hl .flow-port`), the two forced-colours rules of Step 1 (the fill's naming `.flow-busy.high .flow-busy-fill` too) appended to the block.

- [ ] **Step 5: Run everything** — `npm test` → PASS (`materials-from.test.tsx:171-175`, a farm box's `lines` keeping `farm.text` whole, holds); `npm run e2e` → PASS (`slots.spec.ts:96-125` now also measures the 32 px foreignObject; `reuse`, `avoid`, `plan`, `flow-focus` hold).

- [ ] **Step 6: Review shots** — label `4`, both looks: Flow default, Fit, a hand step (`platesTwoWays`), an owned box; against `Phase2Project.dc.html:125-151` (one row per good, stubs ≥ 190 px wide: spec §1's deliberate departures).

- [ ] **Step 7: Commit**

```bash
git add src/client/views/flow-model.ts src/client/views/FlowView.tsx src/client/styles.css tests/client tests/e2e/flow-boxes.spec.ts tests/e2e/theme.spec.ts
git commit -m "feat(flow): step boxes as machine readouts; a lit missing-source arrow keeps its white head (R41)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5a: The step panel's NEI recipe card

**Files:**
- Create: `src/client/components/GtArrow.tsx`, `tests/e2e/recipe-card.spec.ts`
- Modify: `src/client/views/flow-model.ts` (after `ocLines` `:1128-1144`, still the file's last function; imports `:11-19`)
- Modify: `src/client/views/StepPanel.tsx` — imports `:12-28` (the flow-model import, `:24-27`, already takes `importWords`), the card between `:676` (`{shared !== null && <p>{shared}</p>}`) and `:677` (`<PortsSection …/>`); add-on 17's Farm section (`:678-683`) stays right after PortsSection
- Modify: `src/client/styles.css` — dark ink group `:78-81` (append `.readout` after its new last members `.compare-card > :where(p), .compare-column > :where(p)`, which add-on 17's contract case checks with `arrayContaining`, so the append keeps it), after `:878` (`.choice-text`), the 1100 px block `:1198-1201` (one rule), forced colours (after `.compare-column.current`, `:1429`)
- Modify: `tests/client/flow.test.tsx`, `tests/client/step-panel.test.tsx`, `tests/client/styles-contract.test.tsx`, `tests/client/contrast.test.tsx`, `tests/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: `tierSlug` and `machineReadout` (Task 4: the card's head chip shows when `machineReadout(step).tier !== null`, one rule with the Flow readout), the `.tier-<slug>` classes, `Figs` and `DIGIT_RULES` (Task 2b), ItemIcon `tip` lines (Task 3a), `hoverFlowFocus`/`endHoverFlowFocus`, the feature tokens, `PAIRS`, `PHASE2_RULES`, `FLOW_RULES`, `DARK_TOUR`, `openWithPlan`.
- Produces:
  - `flow-model.ts`: `interface RecipeSlot { key: StuffKey; amount: number; chance: number }`, `recipeSlots(products: readonly Product[]): RecipeSlot[]`, `stackText(key: StuffKey, amount: number): string`, `interface RecipeStat { label: string; value: string }`, `recipeStats(step: PlanStep): RecipeStat[]`, `interface OcChip { text: string; tone: 'now' | 'note' }`, `ocChips(step: PlanStep): OcChip[]`, `powerShare(step: PlanStep): number | null`.
  - `StepPanel.tsx`: `export function RecipeCard(props: { step: PlanStep; plan: Plan; index: PlanIndex; per: Per }): ReactElement` (hook-free).
  - `GtArrow(props: { tone: 'panel' | 'chat'; still?: boolean }): ReactElement` → `<span class="gt-arrow[ on-chat][ still]" aria-hidden="true"><span class="gt-arrow-fill"></span></span>`.
  - CSS `.recipe-card`, `.recipe-head`, `.recipe-strip`, `.recipe-slots`, `.recipe-slot`, `.stack-count` (shared with Task 6a's grid), `.slot-chance`, `.recipe-power`, `.energy-bar`, `.energy-fill`, `.recipe-time`, `.recipe-stats`, `.readout`, `.oc-chips`, `.gt-arrow`, `.gt-arrow-fill`, `.gt-arrow.on-chat`; `@keyframes gt-arrow`.

- [ ] **Step 1: Write the failing unit tests**

`flow.test.tsx`, `describe('the recipe card\'s numbers')` (with the file's `step`, and `mvStep` the overclocked step of `:81-82`:
`step({ machine: { mteId: 102, name: 'Advanced Bending Machine', tier: 2 }, durationTicks: 50, overclocks: 1, oc: { recipeEuPerTick: 24, recipeDurationTicks: 100, machineVoltage: 128, machineAmps: 1, perfect: false, heatOverclocks: 0 } })`):

```ts
it('writes stack counts as Minecraft does', () => {
  expect([1, 2, 64, 1500, 12000].map((n) => stackText('t:x@0', n))).toEqual(['', '2', '64', '1.5k', '12k']);
  expect([72, 144, 1000, 2300, 12000, 1_000_000].map((n) => stackText('fluid:water', n))).toEqual(['72L', '144L', '1B', '2.3B', '12B', '1kB']);
  // a value that rounds to 1,000 of its unit is written in the next one, as compactNumber rolls up
  expect([stackText('fluid:water', 999_500), stackText('fluid:water', 9_960), stackText('t:x@0', 999.6), stackText('t:x@0', 9_960)]).toEqual(['1kB', '10B', '1k', '10k']);
});
it('gives a slot its nominal amount and its chance, and drops what a run never makes', () => {
  const [slot] = recipeSlots([{ key: 't:dust@0', amount: 0.1, chance: 0.1 }]);
  expect(slot!.amount).toBeCloseTo(1); expect(slot!.chance).toBe(0.1); expect(recipeSlots([{ key: 't:x@0', amount: 0, chance: 1 }])).toEqual([]);
});
it('draws an item a run makes less than one of as one at that chance, and keeps the litres of a fluid and the chance of a tool', () => {
  expect(recipeSlots([{ key: 't:resin@0', amount: 0.9, chance: 1 }])).toEqual([{ key: 't:resin@0', amount: 1, chance: 0.9 }]);   // a crop harvest's expected drop
  expect(recipeSlots([{ key: 't:rubber_wood@0', amount: 6.18, chance: 1 }])).toEqual([{ key: 't:rubber_wood@0', amount: 6.18, chance: 1 }]); expect(stackText('t:rubber_wood@0', 6.18)).toBe('6');
  expect(recipeSlots([{ key: 'fluid:water', amount: 0.5, chance: 1 }])).toEqual([{ key: 'fluid:water', amount: 0.5, chance: 1 }]);
  expect(recipeSlots([{ key: 'gregtech:gt.metatool.01@10', amount: 1 / 512, chance: 1 / 512 }])).toEqual([{ key: 'gregtech:gt.metatool.01@10', amount: 1, chance: 1 / 512 }]);
});
it('reads the machines, how busy, and the power each and in all', () => {
  expect(recipeStats(step({ count: 1, utilization: 0.5 }))).toEqual([{ label: 'Machines', value: '×1' }, { label: 'Busy', value: '50%' }, { label: 'EU/t each', value: '16' }, { label: 'EU/t total', value: '16' }]);
  expect(recipeStats(step({ count: 2, reused: { count: 0, where: [], others: [{ mteId: 2, name: 'x', tier: 2, count: 1, where: [], euPerTick: 24, runsPerSecondPerMachine: 1 }] } })).at(-1)).toEqual({ label: 'EU/t total', value: '56' });
  expect(recipeStats(step({ pool: { id: 'pool:a', steps: ['a', 'b'] } }))[0]!.label).toBe('Shared machines');
  expect(recipeStats(step({ handCraft: true }))).toEqual([{ label: 'Busy', value: '100%' }]);
});
it('says what overclocking did as chips', () => {
  expect(ocChips(step({}))).toEqual([{ text: 'No overclock at LV', tone: 'now' }]);
  expect(ocChips(mvStep)).toEqual([{ text: '1 overclock at MV', tone: 'now' }, { text: '2× faster', tone: 'note' }]);   // 100 t → 50 t
  expect(ocChips({ ...mvStep, oc: { ...mvStep.oc!, heatOverclocks: 2 } }).at(-1)).toEqual({ text: '2 perfect from heat', tone: 'note' });
  expect(ocChips({ ...mvStep, oc: { ...mvStep.oc!, perfect: true } }).at(-1)).toEqual({ text: 'perfect overclocks', tone: 'note' });
  expect(ocChips(step({ handCraft: true }))).toEqual([]);
});
it('fills the energy bar to the share of what the machine can draw', () => {
  expect(powerShare(step({}))).toBe(0.5); expect(powerShare(step({ oc: undefined }))).toBe(0.5);   // 16 of LV's 32 V × 1 A
  expect(powerShare(step({ handCraft: true }))).toBeNull(); expect(powerShare(step({ euPerTick: 0 }))).toBeNull();
});
```
`step-panel.test.tsx`, `describe('step panel: recipe card')` (with `const circuit = step({ id: 'asm', durationTicks: 100, inputs: [{ key: 't:copper_wire@0', amount: 2, chance: 1 }, { key: 'fluid:molten.tin', amount: 72, chance: 1 }], outputs: [{ key: 't:circuit@0', amount: 1, chance: 1 }] })` on `wires`):
- the card sits after the summary `<p>` and before `class="ports"`; slots `data-recipe-key="t:copper_wire@0"` with `<span class="stack-count" aria-hidden="true">2</span>`,
  the fluid `72L`, the circuit no count; `html.match(/data-port-key=/g)` has the same length as the panel's without the card (render `PortsSection` alone and count);
- a slot's icon is named by its good and carries spec §8.3's tip lines (P2-D39): the wire slot's `aria-label="1x Copper Wire"` and
  `data-tip="1x Copper Wire\n2× 1x Copper Wire per run\n30/min in the line"`; a `chance: 0.1` output draws `<span class="slot-chance" aria-hidden="true"><span class="fig">10</span>%</span>` (spec §25: the digits VT323, the `%` Pixelify)
  and its `data-tip` holds `\n10% chance`; on `wires` without its wire flows (`:89`'s short plan) the wire slot's `li` is `class="recipe-slot slot-short"` and
  its `aria-label` ends `, not supplied in full`;
- `<span class="gt-arrow" aria-hidden="true"><span class="gt-arrow-fill"></span></span>`; the time `5 s` and `16 EU/t`; the chip `<span class="badge tier-chip tier-lv">LV · <span class="fig">32</span> V</span>`;
- a hand step and a furnace step (`machine: { mteId: -2, … }`): no `tier-chip`; a hand step no `energy-bar`; a step with no inputs or outputs: no `recipe-strip`, the `recipe-stats` still there;
- farm steps (add-on 17, plan ruling `farm-step-card`), each drawn with `renderToStaticMarkup(<RecipeCard step={s} plan={p} index={indexPlan(p)} per="min" />)`:
  `tgs = step({ id: 'tgs', mapId: 'gt.recipe.treefarm', machine: { mteId: 15541, name: 'Tree Growth Simulator', tier: 1 }, euPerTick: 30, mainOutput: 't:rubber_wood@0', inputs: [{ key: 'gregtech:gt.metatool.01@10', amount: 1 / 512, chance: 1 / 512 }], outputs: [{ key: 't:rubber_wood@0', amount: 25, chance: 1 }], farm: { kind: 'tgs', tier: 1, footprint: [7, 7, 7], text: 'Tree Growth Simulator (LV): Rubber Sapling in the controller; Saw (Steel) in an input bus', tools: ['gregtech:gt.metatool.01@10'] } })`
  on `planOf({ steps: [tgs], names: { 'gregtech:gt.metatool.01@10': 'Saw', 't:rubber_wood@0': 'Rubber Wood' }, flows: [{ from: 'raw', to: 'tgs', key: 'gregtech:gt.metatool.01@10', perSecond: 0.5 / 512 }, { from: 'tgs', to: 'out', key: 't:rubber_wood@0', perSecond: 12.5 }] })`:
  the saw slot (the `li` with `data-recipe-key="gregtech:gt.metatool.01@10"`) has no `slot-chance` and no `stack-count`, and its `data-tip` is
  `"Saw\nwears 1 of its 512 uses per run\n0.0586/min in the line"`; the wood slot has `<span class="stack-count" aria-hidden="true">25</span>`; the chip
  `<span class="badge tier-chip tier-lv">LV · <span class="fig">32</span> V</span>`. And `cane = step({ id: 'cane', mapId: 'farm:crops', machine: { mteId: 28001, name: 'Basic Crop Manager', tier: 1 }, euPerTick: 0.107, durationTicks: 5120, mainOutput: 't:resin@0', inputs: [{ key: 'fluid:water', amount: 20, chance: 1 }], outputs: [{ key: 't:resin@0', amount: 0.9, chance: 1 }] })`
  on `planOf({ steps: [cane], names: { 't:resin@0': 'Sticky Resin', 'fluid:water': 'Water' }, flows: [{ from: 'raw', to: 'cane', key: 'fluid:water', perSecond: 10 }, { from: 'cane', to: 'out', key: 't:resin@0', perSecond: 0.45 }] })`:
  the resin slot has `<span class="slot-chance" aria-hidden="true"><span class="fig">90</span>%</span>` and no `stack-count`, its `data-tip` holds `\n90% chance`; the water slot
  `<span class="stack-count" aria-hidden="true">20L</span>`; the time reads `4.27 min` and `0.107 EU/t`;
- hover: `findAll(RecipeCard({ step: circuit, plan: wires, index: indexPlan(wires), per: 'min' }), (e) => e.props['data-recipe-key'] === 't:copper_wire@0')` (`indexPlan` from `src/shared/plan/balance.ts`),
  `onMouseEnter` sets `getFlowFocus()` to `{ kind: 'item', key: 't:copper_wire@0' }`, `onMouseLeave` restores `{ kind: 'node', id: 'wire' }` (as `:94-106`);
- the e2e strings stay single: with `step({ id: 'asm', durationTicks: 200, euPerTick: 16, overclocks: 0 })`, `text(panelHtml(…)).split('Swap recipe').length` is 2 and `.split('0 overclocks → 16 EU/t × 200 t').length` is 2;
- `GtArrow`: `tone="chat" still` → `class="gt-arrow on-chat still"`.
Contract `'draws one run as NEI does: slots with stack counts, an arrow that runs three times, readouts'`: `.recipe-strip` `background: var(--panel)` and
`box-shadow: var(--bevel-inset)`; `.recipe-slot` `position: relative` (what the counts sit in); `.stack-count` `position: absolute`, `right: 1px`, `bottom: -2px`,
`z-index: 1`, `pointer-events: none`, `font: 16px/14px var(--font-digits)` and `font-size-adjust: cap-height 0.56` (spec §25: VT323 as tall as
the 14 px Pixelify it replaces, in its 14 px box), `color: var(--stack-ink)`, `text-shadow: 2px 2px 0 var(--stack-shadow)`; `.readout` in
`inkGroup('.banner')` (after its first 7) with `box-shadow: var(--bevel-screen)`; `.readout dd` `font: 21px/21.6px var(--font-digits)` and
`font-size-adjust: cap-height 0.56`; `DIGIT_RULES` gains `.stack-count` and `.readout dd` (`.slot-chance` keeps Step 4's Pixelify: its
digits are `span.fig`); `.gt-arrow-fill` `animation: gt-arrow 1.6s steps(8) 3`, duration × count ≤ 5, no fill
mode; `.energy-bar` `position: relative`, `width: 10px`, `height: 36px`, `overflow: hidden`, `background: var(--screen)`, `box-shadow: inset 1px 1px 0 #000000` ([SR] §4.4);
`.energy-fill` `transform: scaleY(var(--share))`, `transform-origin: bottom`, `background: var(--energy)`; `KEYFRAMES` gains `'gt-arrow': ['transform']`; forced
colours `inQuery(FORCED, '.gt-arrow-fill, .gt-arrow.on-chat .gt-arrow-fill, .energy-fill')` `[['background', 'Highlight']]` (the chat arrow's own fill rule outranks a bare
`.gt-arrow-fill`); the new selectors join `FLOW_RULES` and `PHASE2_RULES`.
Contrast: `['stack count on its shadow', '--stack-ink', '--stack-shadow', AA]`, `['chance tag on its shadow', '#ffff55', '--stack-shadow', AA]`, `['recipe arrow fill on its base', '--stack-ink', '--slot', GRAPHICS]`,
`['energy fill', '--energy', '--screen', GRAPHICS]`, `['readout label', '--screen-muted', '--screen', AA]`, `['readout value', '--screen-text', '--screen', AA]`, and
`expect(ratio('#ffffff', '#8b8b8b')).toBeLessThan(AA)` (the bare slot face, accepted: D8).

- [ ] **Step 2: Write the failing e2e** — `tests/e2e/recipe-card.spec.ts` on `openWithPlan(page, circuitLv())`, the Basic Assembler opened (`[data-step-id="circuit-lv"] .flow-node-head`):
1. `'one run of the assembler as NEI draws it'` — 3 slots in `[aria-label="Takes per run"]`, 1 in `[aria-label="Makes per run"]`; the wire slot's `.stack-count` `2`;
   `getByText('0 overclocks → 16 EU/t × 200 t')` visible (strict).
2. `'hovering a slot lights its good in the Flow'` — hover the wire slot → `svg.flow-canvas` `toHaveClass(/\bfocusing\b/)`.
3. `'the arrow runs three times, and is still under reduced motion'` — `.gt-arrow-fill` `animationIterationCount` `'3'`; reduced motion → `animationDuration` `0.001s`.
6. `'"144L" fits its slot with the fonts and without them'` — `openWithPlan(page, circuitMvPerHour(), { …LV_CIRCUITS, tier: 2 })`, open the Basic Fluid Extractor: its output `.stack-count` reads `144L`,
   and in a context with `/\.woff2?$/` aborted and one without, each read after `await document.fonts.ready` and with `chrome.spec.ts`'s premise (the blocked context loaded
   no face, the other a VT323 one), the count's box stays inside the slot's `.item-icon` box from side to side (±1 px; it sits 2 px
   below the slot by design, `bottom: -2px`). Measured for spec §25: VT323 16 px writes `144L` in 25.6 px, the size-adjusted Menlo of
   the blocked context in 29.6 px (38.5 px without `font-size-adjust`), in the 36 px slot.
7. `'in forced colours the arrow and the energy bar keep their fills'` — `emulateMedia({ forcedColors: 'active' })`: `.gt-arrow-fill` and `.energy-fill` each compute a
   `background-color` that is not `rgba(0, 0, 0, 0)` and not that of their base (`.gt-arrow`, `.energy-bar`).
8. `'a new plan for the same step does not run the arrow again'` (spec §8.7) — mark the arrow: `.gt-arrow-fill` `evaluate((el) => el.setAttribute('data-was-here', ''))`; then serve
   `circuitLv()` with `circuit-lv`'s `utilization: 0.9` (a later `page.route` on `**/api/projects/*/plan` wins) and post `{ ops: [{ op: 'settings', patch: { amount: 31 } }] }`
   (its SSE `plan` event refetches); once the panel's `Busy` readout reads `90%` (polled), `.gt-arrow-fill[data-was-here]` count 1: the same element, so its run went on.
`DARK_TOUR` gains a stop `'a step\'s panel'` (`openWithPlan(page, circuitLv())`, click `[data-step-id="circuit-lv"] .flow-node-head`): `.recipe-strip` `background-color` `rgb(42, 42, 42)`, `.readout` `background-color` `rgb(11, 11, 11)`.

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/flow.test.tsx tests/client/step-panel.test.tsx tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx` → FAIL.

- [ ] **Step 4: Implement**

- `flow-model.ts` (pure, beside `ocLines`, which stays untouched): `recipeSlots` keeps `amount > 0 && chance > 0`, nominal `amount / chance` when `chance < 1`;
  then an item (`!isFluidKey(key)`) whose nominal amount is below 1 (by more than 1e-9) is one at its expected amount as the chance,
  `{ key, amount: 1, chance: amount }` (a crop farm's drops and fertilizer, add-on 17; GT's own nominal amounts are whole, so no GT slot
  changes; plan ruling `farm-step-card`);
  `stackText` — an item `n = round(amount)`: `''` for ≤ 1, the number to 999, then `k` with one decimal below 10 k (`.0` dropped) and whole above; a fluid
  `L = max(1, round(amount))`: `${L}L` to 999, then buckets `B` by the same rule, then `kB`; a value that rounds to 1,000 of its unit takes the next unit;
  `recipeStats` labels `Machines` (`Shared machines` for a pool), `Busy`, `EU/t each`, `EU/t total` (`count × euPerTick + Σ reused.others[].count × euPerTick`),
  values `×${count}`, `formatPercent`, `formatNumber`; a hand step only Busy; `ocChips` per Step 1 (`${formatNumber(recipeDurationTicks / durationTicks)}× faster`);
  `powerShare` = `euPerTick / (oc.machineVoltage × oc.machineAmps)`, else `/ (V[tier] × 1)`, clamped to 0..1, `null` by hand or at 0 EU/t.
- `StepPanel.tsx`: `RecipeCard` as spec §8.3 (no hooks; `data-recipe-key`, `slot-short`, index in keys). Its chance tag, head chip
  and overclock chips write their text through `<Figs>` (Task 2b), so their figures are VT323 and their words, `%` and `×` Pixelify
  (spec §25, plan ruling `digits-mixed`); a stack count and a readout are VT323 whole, by their rules. A slot's ItemIcon takes `name={slotLabel}` — its good's
  name, then `, not supplied in full` when short (`SHORT_INPUT_SHARE`, as `:230-231`) — and `tip` = spec §8.3's lines in order, each left out where it does not
  apply: ``${amountWords(key, amount, nameOf)} per run``, ``${formatPercent(chance)} chance`` when `chance < 1`, ``${rateOf(port.perSecond, per, key)} in the line``
  when `index.inputs` / `index.outputs` holds the port. A tool a tree farm wears (an input whose key `step.farm?.tools` lists) draws no
  `.slot-chance`; its name stays the tool's, and its tip is ``wears 1 of its ${formatNumber(Math.round(1 / chance))} uses per run`` then
  the rate line, in place of the per-run and chance lines. Otherwise a farm step's card is a machine's: the head chip (a TGS's hatch tier,
  a Crop Manager's own), time, power, energy bar, the arrow, the four readouts and "No overclock at LV" (farm recipes are never
  overclocked); a crop farm's run is one harvest of one crop stick, its machine tending `farm.sticks` at once (parallels stay left out,
  §8.5); the sapling the controller holds is a held item, left out. `recipe-time` is `formatDuration(durationTicks / 20)`, `<br />`, ``${formatNumber(euPerTick)} EU/t``, each
  left out at 0. The head chip is ``LV · 32 V`` (`tierText`, `oc.machineVoltage` else `V[tier]`, ` × N A` when `machineAmps > 1`) with the caption `One run`, drawn
  when `machineReadout(step).tier !== null` (none by hand or on a pseudo machine); the card goes between `{shared !== null && …}` and `<PortsSection>`.
- `GtArrow.tsx` per the Interfaces.
- `styles.css`: `.readout` appended to the dark ink group; after `:878` the recipe rules of [SR] §4.4 with spec §8.4's changes (`.recipe-strip` on `--panel` with
  `--bevel-inset`; `.readout { padding: 5px 7px; background: var(--screen); box-shadow: var(--bevel-screen) }`; `.readout dt { font-size: 11px; color: var(--ink-muted) }`;
  `.readout dd { margin: 0; font: 21px/21.6px var(--font-digits); color: var(--screen-text); font-variant-numeric: tabular-nums; font-size-adjust: cap-height 0.56 }`
  (spec §25: VT323 as tall as the 18 px Pixelify, in its 21.6 px line); `.stack-count` as spec §8.2 but `font: 16px/14px var(--font-digits)`
  and `font-size-adjust: cap-height 0.56` after it (spec §25);
  `.slot-chance { position: absolute; left: 2px; top: 2px; z-index: 1; pointer-events: none; font: 14px/1 var(--font-pixel); color: #ffff55; text-shadow: 2px 2px 0 var(--stack-shadow) }`;
  `.energy-bar` per the Step 1 contract; `.energy-fill` as spec §8.4; `.badge.tier-chip { color: var(--tier-ink) }`, `.badge.tier-chip.tier-max { font-weight: 700 }`;
  `.oc-chip.now { color: var(--ink-ok) }`, `.oc-chip.note { color: var(--ink-warn) }`), `.gt-arrow*` and `@keyframes gt-arrow` exactly as spec §11.3; the 1100 px
  block gains `.recipe-stats { grid-template-columns: repeat(4, minmax(0, 1fr)); }`; forced colours `.gt-arrow-fill, .gt-arrow.on-chat .gt-arrow-fill, .energy-fill { background: Highlight; }`.

- [ ] **Step 5: Run everything** — `npm test` → PASS (`materials-from.test.tsx:161-170`: a farm step's panel, which fetches nothing); `npm run e2e` → PASS (`plan.spec.ts:14-15` strict, `reuse.spec.ts:22-30`, `flow-focus.spec.ts:116`).

- [ ] **Step 6: Review shots** — label `5a`: the step panel at 1440 (340 px), at a 1200 px wide window (`$P2/tour.mjs` takes a `1200` width for this shot) and at 800 (full width, 4 readouts per row); against `Phase2Project.dc.html:168-219` (no Swap/3D buttons, no note: spec §1).

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e/recipe-card.spec.ts tests/e2e/theme.spec.ts
git commit -m "feat(flow): the step panel shows one run as an NEI recipe card" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5b: The step panel slides in once, and a pick inside it keeps the focus

**Files:**
- Modify: `src/client/views/FlowView.tsx` — `FlowDiagram` (`:619-700`): its new hooks above the early return `:655`, `selectStep` `:658-661`, `{panel}` `:699`
- Modify: `src/client/views/StepPanel.tsx` — the asides `:668` (StepPanel) and `:765` (RawPanel)
- Modify: `src/client/styles.css` — `.flow-panel` `:829-833`, after `:878`, the 1100 px block `:1198-1201`
- Modify: `tests/client/styles-contract.test.tsx` (`:1355` deliberate, spec §3.9; `:1366-1369`), `tests/client/step-panel.test.tsx`, `tests/e2e/recipe-card.spec.ts`

**Interfaces:**
- Consumes: Task 5a's `recipe-card.spec.ts`, `openWithPlan`, `circuitLv`.
- Produces: CSS `.flow-side` (the side panel's mounted wrapper); both asides `tabIndex={-1}` (P2-D33).

- [ ] **Step 1: Write the failing unit tests** — Contract: `:1355` (deliberate, spec §3.9) → `['.flow-side', 'animation', 'slide-in-right var(--dur-slow) var(--ease-out)']`,
  `['.flow-side', 'position', 'sticky']`, `['.flow-side', 'top', '12px']`, `['.flow-panel', 'animation', 'fade-in var(--dur-base) var(--ease-out)']`,
  `declared('.flow-panel', 'position')` undefined; `:1366-1369` also checks `.flow-side` (no `transition`, no `width`). `step-panel.test.tsx`: `panelHtml(wire, wires)`
  contains `<aside class="flow-panel" aria-label="Step: Wiremill" tabindex="-1">`, and
  `renderToStaticMarkup(<RawPanel itemKey="t:copper_ingot@0" plan={wires} settings={S()} per="min" send={() => {}} onClose={() => {}} onSelect={() => {}} />)`
  contains `<aside class="flow-panel" aria-label="Import: Copper Ingot" tabindex="-1">`.

- [ ] **Step 2: Write the failing e2e** — `recipe-card.spec.ts` gains:
4. `'picking another box swaps the panel without sliding it in again'` — with the Basic Assembler's panel open, `expect.poll` until `.flow-side` `getAnimations().length` is 0;
   Fit; click `[data-step-id="wire"] .flow-node-head`: `.flow-side` has no running animation and `getByRole('complementary', { name: 'Step: Basic Wiremill' })` is visible.
5. `'a peer picked inside the panel takes the focus to the new panel'` — click the `Basic Wiremill …` peer button under Takes → `getByRole('complementary', { name: 'Step: Basic Wiremill' })` is focused.

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/styles-contract.test.tsx tests/client/step-panel.test.tsx` → FAIL (`.flow-panel` still slides, no `tabindex`).

- [ ] **Step 4: Implement** — `FlowView.tsx` (`FlowDiagram`): `{panel !== null && <div className="flow-side" ref={sideRef}>{panel}</div>}`; `selectStep` sets
  `focusPanel.current = true`; a `useLayoutEffect(…, [selected])` focuses `sideRef.current?.querySelector('aside')` while the flag is set and clears it; a canvas pick
  (`open`) leaves the focus. `sideRef`, `focusPanel` and that effect go above `if (graph.nodes.length === 0) return …` (`:655`): no lint checks the rules of hooks here
  (`npm test` is `tsc -b && vitest run`). `StepPanel.tsx`: both asides take `tabIndex={-1}` after `aria-label`. `styles.css`: `.flow-panel` drops `position: sticky;
  top: 12px` and its slide and takes `animation: fade-in var(--dur-base) var(--ease-out)`; after `:878`, `.flow-side { position: sticky; top: 12px; min-width: 0;
  animation: slide-in-right var(--dur-slow) var(--ease-out); }`; in the 1100 px block `.flow-panel { position: static; max-height: none; }` becomes
  `.flow-side { position: static; }` and `.flow-panel { max-height: none; }` (spec §8.6).

- [ ] **Step 5: Run everything** — `npm test` → PASS; `npm run e2e` → PASS (`flow-focus.spec.ts:116`, `plan`, `reuse`; the panel's grid column still changes at once).

- [ ] **Step 6: Review shots** — label `5b`, and a screen recording of three picks in a row at 1440: one slide-in, then 160 ms fades.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e/recipe-card.spec.ts
git commit -m "fix(flow): the step panel slides in only once, and a pick inside it takes the focus to the new panel" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6a: "To build (once)" as an opt-in inventory grid

**Files:**
- Create: `src/client/state/materials-view.ts`, `src/client/views/MaterialsGrid.tsx`, `tests/client/materials-view.test.tsx`, `tests/e2e/materials-grid.spec.ts`
- Modify: `src/client/views/materials-model.ts` (after `groupBuildRows` `:161-167`); `src/client/views/MaterialsView.tsx` (`quantity` `:40-43` moves, and its callers in the file, `LeftOverSection`'s `:275` among them, import it back — add-on 17's taken-by rows, `TakenItem` `:258-267`, call none; `BuildSection` `:114-145`)
- Modify: `src/client/styles.css` — after `button.pin-link` `:944` (the Materials region's last rule, below add-on 17's `.mat-taken` `:921`), the forced-colours block (new rules after add-on 17's `.compare-toggle[aria-expanded='true']` and `.compare-column.current`, `:1428-1429`; the block stays last)
- Modify: `tests/client/materials.test.tsx` (`afterEach` `:25`, new describe), `tests/client/styles-contract.test.tsx` (a new case), `tests/client/contrast.test.tsx`, `tests/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: `.stack-count` (Task 5a: VT323 16 px/14 px, spec §25, also on the `+N` slot), ItemIcon `tip={false}` and the trigger contract (Task 3a), `localTime`, `PAIRS`, `PHASE2_RULES`, `DARK_TOUR`, `LV_CIRCUITS`.
- Produces:
  - `materials-model.ts`: `quantity(key: StuffKey, amount: string, rate?: boolean): string` (moved, exported), `STACK_SIZE = 64`, `stackSplit(amount: number, size?: number): number[]`,
    `interface SlotItem { row: string; key: StuffKey; name: string; group: BuildGroup; amount: string; stacks: number[]; why: string; have?: string; where?: string[]; avoid?: true; fluid: boolean }`,
    `interface SlotGroup { id: BuildGroup; label: string; items: SlotItem[] }`, `groupBuildSlots(lines: BomLine[], names: Record<string, string>, unavoidable?: ReadonlySet<StuffKey>): SlotGroup[]`,
    `gatheredStacks(groups: readonly SlotGroup[], marks: Readonly<Record<string, Mark>>): { done: number; total: number }`, `stillNeeded(items: readonly SlotItem[], marks: Readonly<Record<string, Mark>>): string`,
    `slotTipLines(item: SlotItem, mark: Mark | undefined, when: (iso: string) => string): string[]`, `MAX_STACKS_SHOWN = 9`.
  - `materials-view.ts`: `MATERIALS_VIEW_KEY = 'gtnh-planner:materials-view'`, `type MaterialsViewMode = 'list' | 'grid'`, `getMaterialsView(): MaterialsViewMode`, `setMaterialsView(mode: MaterialsViewMode): void`, `subscribeMaterialsView(fn: () => void): () => void`, `useMaterialsView(): MaterialsViewMode`.
  - `MaterialsGrid.tsx`: `ViewToggle(props: { view: MaterialsViewMode }): ReactElement`, `GatherMeter(props: { done: number; total: number }): ReactElement`, `BuildGrid(props: { groups: readonly SlotGroup[]; marks: Readonly<Record<string, Mark>>; send: Send }): ReactElement` (hook-free; renders the slot buttons itself).

- [ ] **Step 1: Write the failing unit tests**

`materials-view.test.tsx`: `pipes-paused.test.tsx`'s five store cases with `'grid'` (default `'list'`; `'tiles'` reads `'list'`).
`materials.test.tsx` — `afterEach` (`:25`) also resets the store as `theme.test.tsx` does (stub a keeping storage, `setMaterialsView('list')`, unstub);
`describe('the inventory grid')` — below, `slotNames` is `{ ...names, 'p:cable@0': 'Cable', 'fluid:water': 'Water' }`, `groups` the second case's result
(shared by the later cases), `cable` its Power group's first item and `mark` `{ by: 'Ann', at: '2026-10-24T10:00:00.000Z' }`:

```ts
it('splits an amount into stacks of 64', () => {
  expect([80, 128, 1, 0, 0.25, 64.0000000001].map((a) => stackSplit(a))).toEqual([[64, 16], [64, 64], [1], [], [1], [64]]);
});
it('groups the top-level build lines as slots, in the groups\' order, a fluid as one slot', () => {
  const groups = groupBuildSlots([{ key: 'p:cable@0', amount: 80, why: 'power hookup', group: 'power' }, { key: 'machine:111@0', amount: 1, why: '1× Basic Wiremill' },
    { key: 'fluid:water', amount: 1000, why: 'for the boiler', group: 'power' }], slotNames, new Set(['machine:111@0']));
  expect(groups.map((g) => [g.label, g.items.map((i) => [i.row, i.stacks])])).toEqual([['Machines', [['build:machine:111@0', [1]]]], ['Power', [['build:p:cable@0', [64, 16]], ['build:fluid:water', [1]]]]]);
  expect(groups[0]!.items[0]).toMatchObject({ amount: '1×', avoid: true, fluid: false }); expect(groups[1]!.items[1]).toMatchObject({ amount: '1,000 L', fluid: true });
});
it('counts the stacks gathered and the items still needed', () => {
  expect(gatheredStacks(groups, { 'build:p:cable@0': mark })).toEqual({ done: 2, total: 4 });
  expect(stillNeeded(groups[1]!.items, { 'build:p:cable@0': mark })).toBe('1 of 2 still needed'); expect(stillNeeded(groups[0]!.items, { 'build:machine:111@0': mark })).toBe('all in your chests');
});
it('tells a slot\'s need, stock, why, avoid and tick in its tip lines', () => {
  expect(slotTipLines({ ...cable, have: 'have 1,440 (64 reachable)', avoid: true }, { by: 'Ann', at: 'now' }, () => '10:00')).toEqual(
    ['need 80× · have 1,440 (64 reachable)', 'power hookup', 'On the avoid list or made from it, but no recipe at this tier avoids it', '✓ Ann, 10:00']);
});
it('draws one checkbox per item, its other stacks hidden, counts above 1, and a tick on a marked row', () => {
  const html = renderToStaticMarkup(<BuildGrid groups={groups} marks={{ 'build:p:cable@0': mark }} send={() => {}} />);
  expect(html.match(/data-row="build:p:cable@0"/g)).toHaveLength(1);
  expect(html).toMatch(/<button type="button" class="mat-slot marked" role="checkbox" aria-checked="true" aria-label="Cable, 80× in 2 stacks" data-row="build:p:cable@0" data-marked="true" data-tip="/);
  expect(html).toMatch(/<button type="button" class="mat-slot marked" aria-hidden="true" tabindex="-1" data-stack-of="build:p:cable@0"/);
  expect(html.match(/class="stack-count"/g)).toHaveLength(2);           // 64 and 16; the single machine and the fluid draw none
  expect(html.match(/class="mat-slot-tick"/g)).toHaveLength(2);         // both stacks of the marked row
  const ten = renderToStaticMarkup(<BuildGrid groups={groupBuildSlots([{ key: 'p:x@0', amount: 640, why: 'x' }], names)} marks={{}} send={() => {}} />);
  expect(ten.match(/class="mat-slot[ "]/g)).toHaveLength(10); expect(ten).toContain('<span class="stack-count" aria-hidden="true">+1</span>');
});
it('ticks the row from any of its stacks', () => {
  const send = vi.fn(); const stacks = findAll(BuildGrid({ groups, marks: {}, send }), (e) => e.props['data-row'] === 'build:p:cable@0' || e.props['data-stack-of'] === 'build:p:cable@0');
  for (const s of stacks) (s.props.onClick as () => void)();
  expect(send.mock.calls).toEqual([[[{ op: 'mark', row: 'build:p:cable@0', on: true }]], [[{ op: 'mark', row: 'build:p:cable@0', on: true }]]]);
  const [first] = findAll(BuildGrid({ groups, marks: { 'build:p:cable@0': mark }, send }), (e) => e.props['data-row'] === 'build:p:cable@0');
  (first!.props.onClick as () => void)(); expect(send).toHaveBeenLastCalledWith([{ op: 'mark', row: 'build:p:cable@0', on: false }]);
});
it('shows the meter and the toggle', () => {
  expect(renderToStaticMarkup(<GatherMeter done={2} total={4} />)).toMatch(/role="progressbar"[^>]*aria-valuemin="0" aria-valuemax="4" aria-valuenow="2" aria-valuetext="2 of 4 stacks gathered"/);
  expect(renderToStaticMarkup(<ViewToggle view="grid" />)).toBe('<div class="mat-view-toggle" role="group" aria-label="Show the build list as"><button type="button" class="small" aria-pressed="true">Grid</button><button type="button" class="small" aria-pressed="false">List</button></div>');
});
```
The existing `materials.test.tsx` cases (List by default) run unchanged.
Contract — new case `'draws the inventory grid as Minecraft slots'`: `button.mat-slot` resets (`position: relative`, `width: 36px`, `height: 36px`, `min-height: 0`,
`padding: 0`, `border: none`, `background: none`, `box-shadow: none`, `transform: none`, `-webkit-touch-callout: none`, `user-select: none`); `button.mat-slot:focus-visible`
`outline-color: var(--ink-focus)` and `z-index: 1`; `button.mat-slot:focus-visible .item-icon::after` `opacity: 1` (a rule of its own: `LIT_SLOT` stays as it is);
`button.mat-slot.marked::after` `content: ''`, `background: rgb(0 0 0 / 0.4)`; `.mat-slot-tick` `animation: pop var(--dur-fast) var(--ease-pop)` and four `drop-shadow`s of `#000000`;
`.mat-slot-tick::before` `content: ''` and `clip-path` `polygon(…)` (the checkbox's, `:175-177`); `.mat-slots` `grid-template-columns: repeat(auto-fill, 36px)` and `box-shadow: var(--bevel-inset)`;
`.mat-meter-fill` `transform: scaleX(var(--done, 0))` and `transition: transform var(--dur-slow) var(--ease-out)`; `.mat-view-toggle button[aria-pressed='true']` `background: var(--btn-lo)`,
`box-shadow: var(--bevel-btn-down)`, `color: var(--accent)`; `.mat-grid` `animation: fade-in var(--dur-base) var(--ease-out)`; `.mat-grid-group h4` `font: 600 15px/1.3 var(--font-pixel)`
and `color: var(--ink-title)` (`.mat-group h4` untouched); forced colours `button.mat-slot:not(:focus-visible)` `[['outline', '1px solid ButtonText'], ['outline-offset', '-1px']]`,
`.mat-slot-tick::before` and `.mat-meter-fill` each `[['background', 'Highlight']]` (two rules: a pseudo-element never shares a list with a plain selector, R28),
`.mat-view-toggle button[aria-pressed='true']` `[['text-decoration', 'underline']]`, and their base rules join `repainted`. The new selectors join `PHASE2_RULES`.
Contrast: `['grid tick on its edge', '--screen-text', '#000000', GRAPHICS]`, `['grid tick edge on the slot', '#000000', '--slot', GRAPHICS, ['light']]`,
`['grid tick on the slot', '--screen-text', '--slot', GRAPHICS, ['dark']]`, `['meter fill', '--screen-text', '--screen', GRAPHICS]`, `['pressed Grid / List', '--accent', '--btn-lo', AA]`.

- [ ] **Step 2: Write the failing e2e** — `tests/e2e/materials-grid.spec.ts` on `createProject(page, …, LV_CIRCUITS)` (the server's own plan, which has a build list):
1. `'List by default; Grid draws 36 px slots, survives a tab switch and a reload, and a new browser shows List'` — `li.mat-row` visible and no `button.mat-slot`;
   click `Grid` → `aria-pressed="true"`, every `button.mat-slot` box `{ width: 36, height: 36 }`; the `Flow` tab and back to `Materials & steps` (the tab
   panel remounts) → still Grid; reload → Grid; a new context → List.
2. `'a slot ticks its row, which the List shows ticked'` — click the first `[data-row^="build:"][role=checkbox]` → `data-marked="true"`; `List` → the List's `div.tick[data-row="<that row>"]` has `data-marked="true"`.
3. `'a tick in the grid reaches another browser within 2 s'` — two contexts as `sync.spec.ts`; A ticks a slot in Grid; on B (List) that row's `div.tick` `toHaveAttribute('data-marked', 'true', { timeout: 2000 })`.
4. `'Space ticks a focused slot, which rings in the panel\'s focus ink'` — focus the first slot (`focus()`, Shift+Tab, Tab, as `focus.spec.ts:50-53`), Space → `aria-checked="true"`; `outlineColor` `rgb(27, 27, 27)`.
5. `'pointing at or focusing a slot shows its tip with the item\'s name'` — hover → `getByRole('tooltip')` contains the name; focus → the same.
6. `'a long press on a slot shows its tip and does not tick it, and the next tap does'` (in a `describe` with `test.use({ hasTouch: true })`, P2-D21) — CDP `Input.dispatchTouchEvent`
   `touchStart` at the slot's centre; `getByRole('tooltip')` visible while the finger is down (polled, never a sleep); `touchEnd`: the slot's `data-marked` is `"false"`;
   then `tap()` the slot → `data-marked="true"` (the long press's click guard has expired).
7. `'in forced colours the slots, the tick, the meter and the pressed toggle keep a cue'` — `emulateMedia({ forcedColors: 'active' })`, Grid, tick the first slot:
   a `button.mat-slot` computes `outline-style` `solid` and `outline-width` `1px`; the ticked slot's `.mat-slot-tick` `::before` and `.mat-meter-fill` each compute a
   `background-color` that is not `rgba(0, 0, 0, 0)` and not that of what holds them (the slot, `.mat-meter`); the pressed `Grid` computes `text-decoration-line` `underline`.
`DARK_TOUR` gains a stop `'the inventory grid'` (a `createProject(page, 'Dark grid', LV_CIRCUITS)`, Materials tab, `Grid`): `.mat-slots` `background-color` `rgb(42, 42, 42)` (not a slot's icon: an e2e icon is a placeholder painted inline).

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/materials.test.tsx tests/client/materials-view.test.tsx tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx` → FAIL.

- [ ] **Step 4: Implement**

- `materials-model.ts`: `stackSplit` takes `n = Math.ceil(amount − 1e-6)` whole items in stacks of `size`, the last the rest; `groupBuildSlots`
  is `groupBuildRows`'s grouping over depth-0 lines, with `amount` = `quantity(key, amountText(amount))`, `stacks` = `fluid ? [1] : stackSplit(amount)`,
  `name` = `buildName`; `gatheredStacks` counts every stack (capped ones too), done = the stacks of marked rows; `stillNeeded` per Step 1;
  `slotTipLines` = `need ${amount}` (+ ` · ${have}`), `why`, the avoid line (`AvoidMarker`'s title text), `✓ ${by}, ${when(at)}`.
- `materials-view.ts`: the `pipes-paused.ts` pattern; anything but `'grid'` reads `'list'`.
- `MaterialsGrid.tsx`: spec §9.2's markup. A slot's label is ``${name}, ${amount} in ${n} ${n === 1 ? 'stack' : 'stacks'}`` (a fluid: ``${name}, ${amount}``); `data-tip` =
  `tipText([name, ...slotTipLines(item, mark, localTime)])`, `data-tip-mod` = `modName(key)`; the icon `tip={false}`; counts `String(stack)` above 1; at most `MAX_STACKS_SHOWN`
  stacks, then a `button.mat-slot.mat-slot-more` (`aria-hidden`, `tabIndex={-1}`, `data-stack-of`) holding `<span class="stack-count" aria-hidden="true">+N</span>`; keys
  ``${group.id}:${row}#${i}``; the hint `Click a stack to mark it as in your chests. Stacks split at 64, like in game.`; group heads
  `<h4 id="slots-<id>">{label} <span class="mat-grid-left">· {stillNeeded}</span></h4>` over `div.mat-slots[role=group][aria-labelledby]`.
- `MaterialsView.tsx`: `BuildSection` gets `div.mat-head` (the `h3`, then `ViewToggle` and, in Grid, `GatherMeter`, both only with groups); the total `<p>` stays a direct child before any group;
  Grid renders `<BuildGrid>`, List today's groups.
- `styles.css`: after `:944`, the rules of the Step 1 contract and [MG] §4.4 (`.mat-head`, `.mat-view-toggle` and `button + button { border-left: 0 }`, `.mat-meter-box`, `.mat-meter-label`,
  `.mat-meter`, `.mat-grid-hint`, `.mat-grid-left`, `button.mat-slot-more { display: grid; place-items: center; background: var(--slot); box-shadow: var(--bevel-slot) }`,
  `button.mat-slot-more > .stack-count { position: static }`); the grid's four forced-colours rules appended to the block.

- [ ] **Step 5: Run everything** — `npm test` → PASS; `npm run e2e` → PASS (`slots.spec.ts:64-93`, `forced-colors.spec.ts:73-78` keep List; `assets`, `sync`, `plan`, `layout`).

- [ ] **Step 6: Review shots** — label `6a`: Materials in List, and in Grid with a few ticks; against `Phase2Inventory.dc.html` (Grid opt-in; no "To run" column: §18).

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e/materials-grid.spec.ts tests/e2e/theme.spec.ts
git commit -m "feat(materials): an opt-in inventory grid for the build list" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6b: The Materials fixes: R42, R45, the disclosures' height and the tick

**Files:**
- Modify: `src/client/styles.css` — `.mat-row > .tick` `:894`, after the grid's rules (the disclosures), the forced-colours block (`:1426`, R42; add-on 17's two rules after it, `:1427-1429`, stay)
- Modify: `tests/client/styles-contract.test.tsx` (`:2150`, `:2193` R42; `:453-457`, `:471` R45; a new case)

**Interfaces:**
- Consumes: R16's disclosure rules (`styles.css:563-568`), `INLINE_SUMMARY`, `PICKED_CUES`, `PHASE2_RULES`.
- Produces: in `styles-contract.test.tsx`, `RING_RULE` (the R13 ring rule's selector, `:471`'s string moved) and `selectorsDeep(prelude: string): string[]`.

- [ ] **Step 1: Write the failing contract changes** — R42 (deliberate, spec §3.9): `PICKED_CUES = \`${ACTIVE_HIT}, ${PICKED_ROW}:not(:focus-visible)\`` (`:2150`),
  `:2193` unchanged in values; R45 (deliberate): `:453-457` also scans `:where()`/`:is()` argument lists — a `selectorsDeep(prelude)` (paren-depth scan into each
  `:where(…)`/`:is(…)`, its argument split by `selectorList`) — exempting the R13 ring rule (`styles.css:255`, still the only such list: add-on 17's `.compare-card > :where(p), .compare-column > :where(p)` at `:81` name no `summary`) by name: `:471`'s `link`
  string moves to a module-level `RING_RULE` that both cases read, with the self-tests `expect(selectorsDeep(':where(a, summary):focus-visible')).toContain('summary')`
  and `expect(selectorsDeep(':is(.x, summary)')).toContain('summary')`. New case `'opens and closes the Materials disclosures with an animated height'`:
  `details.mat-have, details.mat-needed` `interpolate-size: allow-keywords`; `details.mat-have::details-content` and `details.mat-needed::details-content`, each a rule
  of its own (no pseudo-element list: R28), `display: flow-root`, `block-size: 0`, `overflow-y: clip`, `overflow-clip-margin: 4px`, the transition of `:566`; each
  `[open]` twin `block-size: auto`; `INLINE_SUMMARY`'s pins unchanged; `['.mat-row > .tick', 'align-items', 'flex-start']` (Phase 1's Task 5 minor). The new selectors
  join `PHASE2_RULES`.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/client/styles-contract.test.tsx` → FAIL (the map row's cue has no `:not(:focus-visible)`, no `details.mat-have::details-content`, the tick centred).

- [ ] **Step 3: Implement** — `styles.css`: `:1426`'s map-row half becomes `.map-list > li[aria-current='true'] > .map-row-button:not(:focus-visible)` (the block stays last,
  system colours only); R16's three rules (`:563-568`) copied onto the Materials disclosures as the Step 1 case reads them, after the grid's rules; `.mat-row > .tick`
  gains `align-items: flex-start`.

- [ ] **Step 4: Run everything** — `npm test` → PASS; `npm run e2e` → PASS (`slots.spec.ts:64-93`, `forced-colors.spec.ts`, `materials`, `map`).

- [ ] **Step 5: Review shots** — label `6b`: Materials with a Stock disclosure open (the tick level with its icon), and a screen recording of one opening and closing.

- [ ] **Step 6: Commit**

```bash
git add src/client/styles.css tests/client/styles-contract.test.tsx
git commit -m "fix(client): the picked map row keeps its focus ring in forced colours (R42), the summary guard reads :where() and :is() (R45), and the Materials disclosures open with an animated height" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: The key-numbers strip

**Files:**
- Create: `src/client/views/key-numbers.ts`, `src/client/views/KeyNumbers.tsx`, `tests/client/key-numbers.test.tsx`, `tests/e2e/key-numbers.spec.ts`
- Modify: `src/client/views/plan-cost.ts:18-20` (export `notCounted`, which `keyNumbers` reads), `src/client/views/ProjectPage.tsx:427-438` (`.project-banners`: the error banner `:428`, PlanBanner `:429`, add-on 17's `.compare-bar` `:430-434` and CompareCard `:435-437`, which stays the box's last child, `objectives.spec.ts:59`; KeyNumbers goes first), `src/client/styles.css` (after `.plan-cost` `:379`, before the Compare card's block `:380-425`; keyframes after `@keyframes pipe-pulse` `:106`)
- Modify: `tests/client/styles-contract.test.tsx`, `tests/client/contrast.test.tsx`, `tests/e2e/build-cost.spec.ts`, `tests/e2e/chrome.spec.ts`, `tests/e2e/layout.spec.ts` (after `:52`), `tests/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: `prefersReducedMotion()`, `machineGroups` (`src/shared/plan/pools.ts:26-49`), `PSEUDO_IDS`, `TIER_NAMES`, `horizonText`, `notCounted`, `formatNumber`, `formatRate`, `formatDuration`, the feature tokens, `PAIRS`, `PHASE2_RULES`, `DARK_TOUR`.
- Produces:
  - `key-numbers.ts`: `interface KeyNumber { id: 'output' | 'power' | 'machines' | 'build' | 'run' | 'batch'; label: string; value: number | null; text: string; unit: string; sub: string; words?: true }`;
    `keyNumbers(plan: Plan | null, settings: Pick<PlanSettings, 'mode' | 'per' | 'amount'>): KeyNumber[] | null` (null while the plan is on its way; a plan that is not `ok` gives the five tiles with text `—`);
    `machineCount(plan: Pick<Plan, 'steps' | 'makeN'>): { total: number; new: number }`; `compactNumber(x: number): string`; `countUpAt(from: number, to: number, elapsed: number, duration?: number): number` (duration 400).
  - `KeyNumbers.tsx`: `KeyNumbers(props: { plan: Plan | null; settings: PlanSettings }): ReactElement | null` (null without a target); `useCountUp(target: number | null, unit: string, ms?: number): number | null`.
  - CSS `.key-numbers`, `.key-number`, `.key-number-sub`, `.key-number-unit`, `.key-number-words`, `.key-number.changed`, `.key-number-flash`, `.key-numbers-wait` (Task 8 puts the strip skeleton in it); `@keyframes flash-out`.

- [ ] **Step 1: Write the failing unit tests** — `tests/client/key-numbers.test.tsx` (copies of the `planOf`/`step` helpers of `plan-banner.test.tsx:24-32`):

```ts
const RATE = { mode: 'rate', per: 'min', amount: 30 } as const;
const plan = planOf({ target: 't:plate@0', targetPerSecond: 0.5, names: { 't:plate@0': 'Iron Plate' }, power: { peakEUt: 512, averageEUt: 300, voltageTier: 2, amps: 2 },
  steps: [step({ id: 'a', count: 3, owned: 1 })], cost: { runPerHour: 5400, build: 182, horizonHours: 24 } });
it('reads the five tiles of a running line', () => {
  expect(keyNumbers(plan, RATE)!.map((n) => [n.id, n.label, n.value, n.text, n.unit, n.sub])).toEqual([
    ['output', 'Output', 30, '30', '/min', 'Iron Plate'], ['power', 'Peak power', 512, '512', 'EU/t', 'MV · 2 A'], ['machines', 'Machines', 3, '3', '', '2 new'],
    ['build', 'To build', 182, '182', 'raw', 'over 24 h'], ['run', 'To run', 5400, '5,400', 'raw/h', '']]);
});
it('reads Make N\'s count, time and batch', () => {
  const batch = { ...plan, makeN: { totalSeconds: 600, leftovers: [] }, cost: { runPerHour: 0, build: 182, horizonHours: null, batch: 192 } };
  const tiles = keyNumbers(batch, { mode: 'makeN', per: 'min', amount: 64 })!;
  expect(tiles[0]).toMatchObject({ id: 'output', value: 64, text: '64', unit: '', sub: '10 min' }); expect(tiles[3]!.sub).toBe('for the batch');
  expect(tiles[4]).toMatchObject({ id: 'batch', label: 'Batch', value: 192, text: '192', unit: 'raw', sub: '' });
});
it('reads a fluid in litres, and a rare rate in words that never counts up', () => {
  expect(keyNumbers(planOf({ target: 'fluid:water', targetPerSecond: 2 }), { ...RATE, per: 'hour' })![0]).toMatchObject({ value: 7200, text: '7,200', unit: 'L/h' });
  expect(keyNumbers(planOf({ target: 't:x@0', targetPerSecond: 1 / (526 * 86400) }), RATE)![0]).toMatchObject({ value: null, text: '1 every 526 days', unit: '', words: true });
});
it('qualifies the build cost: not counted, or what it leaves out', () => {
  expect(keyNumbers(planOf({ cost: { runPerHour: 1, build: 2, horizonHours: null } }), RATE)![3]!.sub).toBe('not counted');
  expect(keyNumbers(planOf({ cost: { runPerHour: 1, build: 2, horizonHours: 168, unpriced: 4 } }), RATE)![3]!.sub).toBe('+4 not counted');
  expect(keyNumbers(planOf({ cost: { runPerHour: 1, build: 2, horizonHours: null, unpriced: 4 } }), RATE)![3]!.sub).toBe('not counted');   // none of it is
  expect(keyNumbers(planOf({ makeN: { totalSeconds: 60, leftovers: [] }, cost: { runPerHour: 0, build: 2, horizonHours: null, batch: 9, unpriced: 4 } }),
    { mode: 'makeN', per: 'min', amount: 1 })![3]!.sub).toBe('+4 not counted');                                                               // before "for the batch"
  expect(keyNumbers(planOf({}), RATE)![3]).toMatchObject({ value: null, text: '—' });   // no cost
});
it('counts a pool once and skips hand and pseudo steps', () => {
  expect(machineCount({ steps: [step({ id: 'a', count: 2, pool: { id: 'pool:a', steps: ['a', 'b'] } }), step({ id: 'b', count: 2, pool: { id: 'pool:a', steps: ['a', 'b'] } }),
    step({ id: 'h', count: 1, handCraft: true }), step({ id: 'c', count: 1, machine: { mteId: -1, name: 'Crafting table', tier: 0 } })] })).toEqual({ total: 2, new: 2 });
});
it(`counts a Make N batch's machine type once, as the build list and the Compare card do`, () => {
  const steps = [step({ id: 'a' }), step({ id: 'b' }), step({ id: 'w', machine: { mteId: 111, name: 'Basic Wiremill', tier: 1 }, count: 2, owned: 1 })];
  expect(machineCount({ steps, makeN: { totalSeconds: 60, leftovers: [] } })).toEqual({ total: 3, new: 2 });   // one Basic Assembler shared by a and b
  expect(machineCount({ steps })).toEqual({ total: 4, new: 3 });                                               // a running line: each step its own machines
});
it('shows dashes for a plan that cannot run, and nothing while one is on its way', () => {
  expect(keyNumbers(planOf({ status: 'infeasible' }), RATE)!.map((n) => n.text)).toEqual(['—', '—', '—', '—', '—']); expect(keyNumbers(null, RATE)).toBeNull();
  expect(keyNumbers(planOf({ status: 'empty', warnings: [{ code: 'no-target', text: 'Pick something to make' }] }), RATE)![0]).toMatchObject({ id: 'output', text: '—', sub: '' });   // a plan that names no target: no key, no name
});
it('writes big numbers compactly, three significant digits', () => {
  expect([99_999, 100_000, 540_000, 999_999, 5_400_000, 12_345_678, 2_500_000_000].map(compactNumber)).toEqual(['99,999', '100k', '540k', '1M', '5.4M', '12.3M', '2.5G']);
});
it('counts up easing out, from the last value to the new one, never backwards', () => {
  expect([0, 200, 400, 500].map((t) => countUpAt(0, 100, t))).toEqual([0, 87.5, 100, 100]); expect(countUpAt(100, 0, 200)).toBe(12.5);
  for (let t = 0, last = -1; t <= 400; t += 25) { const v = countUpAt(10, 90, t); expect(v).toBeGreaterThanOrEqual(last); last = v; }
});
it('draws the final values for a screen reader and the page, no live region', () => {
  const html = renderToStaticMarkup(<KeyNumbers plan={plan} settings={{ ...defaultSettings(), target: 't:plate@0', amount: 30, per: 'min' }} />);
  expect(html).toMatch(/^<section class="key-numbers" aria-label="Key numbers"><dl><div class="key-number" data-key-number="output"><dt><span>Output<\/span><span class="key-number-sub">Iron Plate<\/span><\/dt><dd><span aria-hidden="true">30<\/span><span class="visually-hidden">30<\/span><span class="key-number-unit">\/min<\/span><\/dd><\/div>/);
  expect(html).not.toMatch(/aria-live|role="status"/);
  const wait = renderToStaticMarkup(<KeyNumbers plan={null} settings={{ ...defaultSettings(), target: 't:plate@0' }} />);
  expect(wait).toMatch(/^<div class="key-numbers-wait" aria-hidden="true">/); expect(wait.replace(/<[^>]+>/g, '')).toBe('');   // Task 8 fills it
  expect(renderToStaticMarkup(<KeyNumbers plan={plan} settings={defaultSettings()} />)).toBe('');   // no target, no strip
});
```
`plan-banner.test.tsx` passes unchanged. Contract `'shows the key numbers on 52 px readout tiles, and hides the cost sentence beside them'`: `.key-number` `height: 52px`, `padding: 4px 10px`,
`background: var(--screen)`, `border: 2px solid var(--outline)`, `box-shadow: var(--bevel-screen)`; `.key-number dt` `font: 11px/14px var(--font-ui)`; `.key-number dd` `font: 28px/26px var(--font-digits)` and `font-size-adjust: cap-height 0.56` (spec §25: VT323 as tall as the 24 px Pixelify, in the same 26 px line),
`white-space: nowrap`, `overflow: hidden` and `text-overflow: ellipsis` (a figure on one line, as the Compare tiles' since `4bef36c`, with no shrink: plan ruling `strip-figures`);
`.key-number-unit` `font: 15px/26px var(--font-digits)` and `font-size-adjust: cap-height 0.56` (the unit belongs to the readout: plan ruling `digits-mixed`); `DIGIT_RULES` gains `.key-number dd` and `.key-number-unit`;
`.key-numbers` `margin: 0 0 8px`; `.key-numbers-wait` `height: 52px`, `margin: 0 0 8px`; `.key-number-flash` (spec §10.1's 2 px `--accent` frame over the
tile's edge) `position: absolute`, `inset: -2px`, `border: 2px solid var(--accent)`, `pointer-events: none`, `animation: flash-out 700ms var(--ease-out)` and `opacity: 0`; `KEYFRAMES` gains
`'flash-out': ['opacity']`; `.project-banners > .key-numbers ~ .plan-cost` declares `position: absolute`, `width: 1px`, `height: 1px`, `overflow: hidden`, `clip-path: inset(50%)`, `white-space: nowrap`;
`:664-667` untouched; the selectors join `PHASE2_RULES`. Contrast: `['strip changed accent', '--accent', '--screen', AA]` (the readout pairs are Task 5a's).

- [ ] **Step 2: Write the failing e2e**
- `build-cost.spec.ts` (every `.plan-cost` assertion kept): `.key-numbers` contains `To build` and `raw`; `[data-key-number="build"] .key-number-sub` `over 24 h`, then after the horizon select `over 1 h`.
- `chrome.spec.ts`: `'the key-numbers strip keeps its height whether the fonts arrive or not, within 60 px'` — `measure`'s pattern on a project with `LV_CIRCUITS`: `.key-numbers` box height
  equal in both contexts, and height + `margin-bottom` ≤ 60 (the served context loaded a VT323 face, the strip's figures being VT323: spec §25).
- `layout.spec.ts` after `:52`: `expect(box.y + box.height / 2).toBeLessThan(700)`.
- `tests/e2e/key-numbers.spec.ts`: `'under reduced motion a new value shows at once, with nothing in between'` — reduced motion, `LV_CIRCUITS`, a `MutationObserver` on
  `[data-key-number="output"] dd > span[aria-hidden]` recording every text; set Amount to `60` → `expect.poll` the text `60`; the record ⊆ `['30', '60']`.
  `'the strip leads the banners box: closed, the Compare card adds nothing, and it opens below the strip'` (plan ruling `p2-d44-landed`) —
  1280 × 720, `createProject(page, 'Strip and compare', LV_CIRCUITS)`; `.key-numbers` visible;
  `await page.locator('.project-banners').evaluate((box) => box.firstElementChild?.classList.contains('key-numbers') === true)` is `true`;
  `.project-head` box height `36`; keep the strip's box; click `page.locator('.project-head').getByRole('button', { name: 'Compare modes' })`;
  `page.getByRole('region', { name: 'Compare modes' })` visible; the strip's box `y` is unchanged and the card's box `y` ≥ the strip's `y + height`.
  `'the strip reads the mode the project plans in: least raw material counts no build cost'` —
  `createProject(page, 'Strip mode', { target: 't:circuit@0', amount: 1, per: 'min', tier: 1 })` (build-cost.spec's project);
  `const sub = page.locator("[data-key-number='build'] .key-number-sub")` reads `over 24 h` (Cheapest, the default mode);
  `page.getByRole('complementary', { name: 'Project settings' }).getByRole('radio', { name: 'Least raw material', exact: true }).check()`;
  then poll `sub` to `not counted` and `.plan-cost` to contain `(build cost not counted)` (add-on 17's server sets `Plan.cost.horizonHours`
  to null in Least raw material, `src/server/planner/objective.ts:36-39`; `keyNumbers` takes no figure per mode).
  `'keeps each figure of the strip whole and on one line at 800 px'` (plan ruling `strip-figures`) — 800 × 900,
  `openWithPlan(page, { ...circuitLv(), cost: { runPerHour: 99_999, build: 99_999, horizonHours: 24 } })` (a target, so the drawer
  stays shut); after `document.fonts.ready`, each of the five `.key-number`s is 52 px tall, and a Range over its
  `dd > span[aria-hidden='true']` has one client rect, inside the tile's box (in VT323 `99,999 raw/h` is 101.2 px and fits whole; a
  longer unit may still end in "…": plan ruling `strip-figures`).
`DARK_TOUR` `'the Flow tab'` gains `.key-number` `background-color` `rgb(11, 11, 11)`.

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/key-numbers.test.tsx tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx` → FAIL.

- [ ] **Step 4: Implement** — `key-numbers.ts` per the Interfaces and spec §10.1's table (output: rate mode `targetPerSecond × (per === 'min' ? 60 : 3600)` with unit
  `${fluid ? 'L' : ''}/${per === 'min' ? 'min' : 'h'}`, in words when `formatRate` gives words; Make N `settings.amount`, sub `formatDuration(makeN.totalSeconds)`;
  in rate mode the Output sub is `plan.names[plan.target]`, `''` when the plan has no `target` — never `settings.target`'s key: while a
  just-picked target's first plan is on its way the page still holds the no-target plan, and only the Settings button and the panel name
  the pick (`usePickedNames`, `drawer.spec.ts:424-451`); power sub
  ``${TIER_NAMES[voltageTier]} · ${amps} A``; build sub, the first that applies: `not counted` (horizon null and no batch), `+N not counted`
  (`notCounted(cost) !== ''`, N = `formatNumber(cost.unpriced)`), `for the batch` (Make N), else ``over ${horizonText(h)}``); `compactNumber`
  and `countUpAt` (a cubic ease-out) as Step 1's cases fix them. `machineCount`: Σ over `machineGroups(plan.steps)` of the first step's
  `count` and `count − owned`, skipping `handCraft` and `PSEUDO_IDS`; with `plan.makeN` set, each machine type (`machine.mteId`) once, by
  its first group — the rule of `src/server/planner/bom.ts:122-131` (`typesSeen`) and of add-on 17's `src/server/planner/compare.ts:73-84`,
  whose "New machines" the Compare card's in-use column shows under the strip.
  `KeyNumbers.tsx`: one tile component per number holding `useCountUp(n.value, n.unit)` — instant on its first render, under `prefersReducedMotion()`, for `null` and when the unit
  changes; else from the last shown value over 400 ms by rAF, re-rendering from state (P2-D41); intermediates shown as `compactNumber` (rounded when both ends are whole) — and a change
  counter that bumps when `n.text` changes after the first render: the tile class `key-number changed` while the flash runs, `<span key={changes} className="key-number-flash" aria-hidden="true" />`
  only when `changes > 0`, its `onAnimationEnd` ending `changed`; `dd.key-number-words` for words. `ProjectPage.tsx`: `<KeyNumbers plan={plan} settings={project.settings} />` first inside `.project-banners`
  (at `:427`, before the error banner). Add-on 17's `.compare-bar` and CompareCard stay after PlanBanner, so the opened card sits below the
  strip and remains the box's last child (`objectives.spec.ts:59`). The Compare modes button stays where add-on 17 put it — in
  `.project-head` above 900 px, in `.compare-bar` at ≤ 900 px — and nothing moves into the strip row: a sixth item would wrap the five
  tiles at 752 px (plan ruling `p2-d44-landed`). At 1280 × 720 add-on 17 adds no height (the head button takes no row, the closed card
  draws nothing), so the iron-plate map centre goes from 657 to ≈ 684.7 as planned.
  `styles.css`: spec §10.2's rules (its `.key-number dd` keeps `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` and takes
  no `container-type` or `--glyphs` clamp: plan ruling `strip-figures`; its font is `28px/26px var(--font-digits)` with
  `font-size-adjust: cap-height 0.56` after it, spec §25) plus `.key-number-sub { min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; text-transform: none; letter-spacing: 0 }`,
  `.key-number-unit { margin-left: 4px; font: 15px/26px var(--font-digits); color: var(--screen-muted); font-size-adjust: cap-height 0.56 }`, `.key-number dd.key-number-words { font: 15px/26px var(--font-ui) }`,
  `.key-number.changed .key-number-sub { color: var(--accent) }`, the flash and `@keyframes flash-out { from { opacity: 1; } }`, `.key-numbers-wait`, the sibling hide rule.

- [ ] **Step 5: Run everything** — `npm test` → PASS; `npm run e2e` → PASS. Before committing, read the measured centres: `layout.spec.ts` (< 700),
  `connections.spec.ts:49-60` (its exact drag), `view3d-links.spec.ts:92-106`. If any point now falls below 720 and fails, stop: report it as a ruling for the controller, never change those tests.

- [ ] **Step 6: Review shots** — label `7`, both looks: the project head with the strip at 1440 and 800, Make N, an infeasible plan (`—`); against `DarkMode.dc.html`'s two-line tiles.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(client): the key-numbers strip, counting up to what changed" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Skeletons beside every loading line, the progress arrow, and the drawer's own status (R43)

**Files:**
- Create: `src/client/components/Skeleton.tsx`, `tests/client/skeleton.test.tsx`, `tests/e2e/skeletons.spec.ts`
- Modify: `src/client/views/ProjectList.tsx:150`, `src/client/views/ProjectPage.tsx` (`:156`, `:406`, the aside `:440-442`), `src/client/views/KeyNumbers.tsx`, `src/client/views/FlowView.tsx` (`:690-692`, `:721`), `src/client/views/ConnectionsView.tsx` (`:397`, `:400`, `:402`), `src/client/views/MaterialsView.tsx:307`, `src/client/map/LinePanel.tsx:162`, `src/client/views/View3D.tsx:233`, `src/client/views/MapTab.tsx:475-490`, `src/client/views/View3DTab.tsx:30`, `src/client/views/CompareCard.tsx` (`:166-168`, `:173`), `src/client/styles.css` (keyframes after `@keyframes pipe-pulse` `:106`, new block after `.badge.muted` `:534`)
- Modify: `tests/client/plan-banner.test.tsx`, `tests/client/compare-card.test.tsx`, `tests/client/styles-contract.test.tsx`, `tests/e2e/drawer.spec.ts`, `tests/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: `GtArrow` and its forced-colours rule (Task 5a), `.key-numbers-wait`, `--skeleton`, `--skeleton-well`, `--sheen`, `--progress-base`, `PHASE2_RULES`, `DARK_TOUR`, `openWithPlan`, `circuitLv`, `copperUnsourced`.
- Produces: `type SkeletonShape = 'cards' | 'project' | 'strip' | 'diagram' | 'lines' | 'scene' | 'compare' | 'readouts'`, `Skeleton(props: { shape: SkeletonShape; rows?: number }): ReactElement` (`<div class="skeleton skeleton-<shape>" aria-hidden="true">` holding `div.skeleton-block`s: cards `rows ?? 3`, project 3, strip 5, diagram 3, lines `rows ?? 6`, scene 1, readouts 6, and compare three `div.skeleton-readouts` frames of 6 each, 18 in all (a readouts grid framed as a Compare column); no text, no inline style); `ProjectPage.tsx` `export function drawerStatus(plan: Plan | null, planError: string | null, planLoading: boolean): string`; `@keyframes sheen`.

- [ ] **Step 1: Write the failing unit tests**
- `skeleton.test.tsx`: for each of the eight shapes (`readouts` too: 6 blocks; `compare` 18, its markup starting
  `<div class="skeleton skeleton-compare" aria-hidden="true"><div class="skeleton-readouts"><div class="skeleton-block">` and holding three
  `skeleton-readouts`), `renderToStaticMarkup(<Skeleton shape={s} />)` starts `<div class="skeleton skeleton-${s}" aria-hidden="true">`, has the block count of the Interfaces
  (`<Skeleton shape="cards" rows={2} />` 2), no text (`html.replace(/<[^>]+>/g, '')` is `''`) and no `style=`; `key-numbers.test.tsx`'s wait case also
  expects `class="skeleton skeleton-strip"` inside the wait div.
- `compare-card.test.tsx` (importing `Skeleton` from `../../src/client/components/Skeleton.tsx`; plan ruling `compare-skeletons`):
  ```ts
  it('draws a skeleton beside its own loading lines: the three modes while a target\'s compare plans, a mode still planning its six figures', async () => {
    const planning = 'Planning the three modes…</p><div class="skeleton skeleton-compare" aria-hidden="true">';
    expect(markup(open(null, { loading: true }))).toContain(planning);
    const shapes = (objective: string): unknown[] => {
      const [column] = findAll(CompareCardView(props(open(RESULT))), (e) => e.props['data-objective'] === objective);
      return findAll(column!.props.children as ReactNode, (e) => e.type === Skeleton).map((e) => e.props.shape);
    };
    expect([shapes('least-raw'), shapes('cheapest'), shapes('multi-output')]).toEqual([[], [], ['readouts']]);
    expect(markup(open(RESULT, { loading: true }))).not.toContain('skeleton-compare');             // Updating… keeps the columns drawn
    expect(markup(open(null, { error: 'The planner failed' }))).not.toContain('class="skeleton');   // a failed fetch is no loading line
    // another target picked with the card open (68c06c1): the old figures go, and the planning line comes back with its skeleton
    let asked = 0;
    const swap = compareLoader('p1', () => (asked++ === 0 ? Promise.resolve(RESULT) : new Promise<CompareResult>(() => {})));
    swap.target('t:a@0'); swap.open(); await settle();
    swap.target('t:b@0');
    expect(markup(swap.getSnapshot())).toContain(planning);
  });
  ```
- `plan-banner.test.tsx`, `describe('the drawer\'s status (R43)')`: `drawerStatus(null, 'boom', false)` `'boom'`; `drawerStatus(broken, null, true)` `'The plan is updating…'`
  and `expect(drawerStatus(broken, null, true).toLowerCase()).not.toContain('updating the plan')` (plan ruling `drawer-status-words`);
  `drawerStatus(broken, null, false)` `'The plan has 3 problems'` (`:36-49`: two inputs with no source, a good made two ways); one step whose one input nothing supplies
  (`planOf({ steps: [step({ id: 'mixer', mainOutput: 't:glue@0', inputs: [{ key: 't:resin@0', amount: 1, chance: 1 }], outputs: [{ key: 't:glue@0', amount: 1, chance: 1 }] })], flows: [{ from: 'mixer', to: 'out', key: 't:glue@0', perSecond: 0.5 }] })`)
  `'The plan has 1 problem'`; the two server warnings of `:73` `'The plan has 2 problems'`; the no-target hint is no problem (plan ruling
  `drawer-status-count`): `drawerStatus(planOf({ status: 'empty', warnings: [{ code: 'no-target', text: 'Pick something to make' }] }), null, false)`
  `''`, and with `{ code: 'no-recipe', text: 'Nothing at ≤ LV makes Glue' }` beside it `'The plan has 1 problem'`; `drawerStatus(planOf({}), null, false)` and
  `drawerStatus(null, null, true)` (the first plan is on its way: the view says "Planning…") `''`.
  The busy banner: `PlanBanner({ …planLoading: true })` markup contains `<p class="muted"><span class="gt-arrow on-chat" aria-hidden="true"><span class="gt-arrow-fill"></span></span>Updating the plan…</p>`.
- Contract `'draws skeletons whose sheen passes three times and rests off their edge'`: `.skeleton-block` `position: relative`, `overflow: hidden`, `background: var(--skeleton)`;
  `.skeleton-block::after` `content: ''`, `transform: translateX(-100%)`, `animation: sheen 1.4s var(--ease-out) 3` (duration × count ≤ 5, no fill mode); `.skeleton-diagram, .skeleton-scene`
  `background: var(--well)`, `border: 2px solid var(--outline)`, `box-shadow: var(--bevel-well)`; `.skeleton-diagram .skeleton-block` `background: var(--skeleton-well)`; every skeleton rule that sets
  `height` sets it in px; `KEYFRAMES` gains `sheen: ['transform']`; the selectors join `PHASE2_RULES`. It also pins `.skeleton-compare`
  `display: grid`, `grid-template-columns: repeat(auto-fit, minmax(220px, 1fr))` (equal to `declared('.compare-columns', 'grid-template-columns')`),
  `gap: 12px`; `.skeleton-readouts` `display: grid`, `gap: 4px` and
  `grid-template-columns: repeat(auto-fit, minmax(min(160px, 100%), 1fr))`, equal to `declared('.compare-rows', 'grid-template-columns')`
  (the tiles' own grid, which since `4bef36c` stacks them where a column is too narrow for two 160 px tiles); `.skeleton-readouts .skeleton-block`
  `height: 55px`; `.skeleton-compare > .skeleton-readouts` `border: 2px solid`, a `border-color` equal to
  `declared('.compare-column', 'border-color')` and `padding: 35.5px 10px 52px`; no rule whose selector names `.skeleton-compare` declares
  `height` or `grid-template-rows` (a frame is as tall as its blocks, so it grows where they stack, as a loaded column does); all four join `PHASE2_RULES`.

- [ ] **Step 2: Write the failing e2e**
- `tests/e2e/skeletons.spec.ts`: `'a plan on its way shows its loading line and a skeleton, which go when the plan comes'` — hold `**/api/projects/*/plan` behind a promise; `createProject(page, …, LV_CIRCUITS)`:
  `getByText('Planning…')` visible, `.tab-panel .skeleton-diagram[aria-hidden="true"]` visible, a `.skeleton-block`'s `::after` `animationIterationCount` `'3'`; release → `.skeleton` count 0 and `[data-step-id]` drawn.
  `'under reduced motion the sheen runs once, for a millisecond'` → `'1'`.
  `'in forced colours the busy line\'s arrow keeps its fill'` — `openWithPlan(page, circuitLv())`, then hold `**/api/projects/*/plan` behind a
  promise and post `{ ops: [{ op: 'settings', patch: { amount: 31 } }] }` (the refetch its SSE event starts hangs: `Updating the plan…` shows);
  `emulateMedia({ forcedColors: 'active' })`: `.plan-banner .gt-arrow.on-chat .gt-arrow-fill` computes a `background-color` that is not
  `rgba(0, 0, 0, 0)` and not that of its `.gt-arrow`; release.
  `'the Compare card shows a skeleton while it plans the three modes, and a mode still planning keeps its figures place'` (plan ruling
  `compare-skeletons`), at 1280 × 720 and at 860 × 900 (`objectives.spec.ts:150`'s width, where a column stacks its tiles) —
  `createProject(page, \`Compare skeleton at ${width}\`, LV_CIRCUITS)`; hold `**/api/projects/*/compare` behind a promise; click
  `page.getByRole('button', { name: 'Compare modes' })` (the head's, or the bar's at 860) → `page.getByText('Planning the three modes…')`
  and `.compare-card .skeleton-compare[aria-hidden='true']` visible, the six blocks of its first frame
  (`.skeleton-compare > .skeleton-readouts:first-child > .skeleton-block`) in 3 rows at 1280 and 6 at 860 (their distinct rounded
  `getBoundingClientRect().top`s); release with
  `route.fulfill({ json: { rev: 1, current: 'cheapest', modes: [{ objective: 'least-raw', status: 'ok', summary: S }, { objective: 'cheapest', status: 'ok', summary: S }, { objective: 'multi-output', status: 'pending' }] } })`,
  `S = { rawPerHour: 12.5, rawBuild: 40, newMachines: 4, rawSources: 3, steps: 6, peakEUt: 96 }` → `.compare-card .skeleton-compare` count 0,
  `.compare-column[data-objective='multi-output'] .skeleton-readouts` visible, `.compare-column[data-objective='cheapest'] .skeleton` count 0,
  and the six `.compare-row`s of `least-raw` and the six blocks of `multi-output`'s `.skeleton-readouts` sit in as many rows as that frame's
  did. Then, at 1280 × 720 only, another target with the card open (`68c06c1`): hold the route again and pick Iron Plate in the aside's
  item search with no Clear (`objectives.spec.ts:199-200`'s locators) → the card shows no `[data-objective]`, and its planning line and
  `.skeleton-compare` are visible again; release → `.skeleton-compare` count 0.
- `drawer.spec.ts`, after its last test (`:615`), importing `copperUnsourced` from `./fixtures/plans.ts` and `openWithPlan` from `./helpers.ts`:
  `'the drawer has a status line of its own (R43)'` — 800 × 900, `openWithPlan(page, copperUnsourced())` (its default `LV_CIRCUITS` gives a
  target, so the drawer does not open by itself), `page.getByRole('button', { name: SETTINGS_BUTTON }).click()` (`:19`'s `/^Settings/`; the
  button reads `Settings · Make: Basic Circuit`) → `aside[aria-label='Project settings'] [role=status]` has text `The plan has 1 problem`;
  Escape → text `''`. And `'the drawer that opens by itself to pick a target says no problem (R43)'` (plan ruling `drawer-status-count`) —
  800 × 900, `login`, `setName(page, 'Ann')`, `createProject(page, 'Status, nothing yet')` with no target (the drawer opens by itself into
  the item search); `await expect(page.locator('.plan-banner button.link')).toHaveText('Pick something to make')` (the plan is in; the banner
  is inert, so it is found by class); then `aside[aria-label='Project settings'] [role=status]` `toHaveText('')`. The Tab-cycle case
  (`:86-95`) still passes.
`DARK_TOUR` gains a stop `'a plan on its way'` (a page whose plan route never answers): `.skeleton-diagram` `background-color` `rgb(26, 26, 26)`, `.skeleton-diagram .skeleton-block` `background-color` `rgb(42, 42, 42)`.

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/skeleton.test.tsx tests/client/plan-banner.test.tsx tests/client/compare-card.test.tsx tests/client/styles-contract.test.tsx` → FAIL.

- [ ] **Step 4: Implement** — `Skeleton.tsx` per the Interfaces. Sites (spec §11.1, every `<p>` kept as it is): `ProjectList.tsx:150` → the `<p>` then `<Skeleton shape="cards" />`;
  `ProjectPage.tsx:406` → `<Skeleton shape="project" />` after the `<p>`; `KeyNumbers`' wait div holds `<Skeleton shape="strip" />`; `FlowView.tsx:691` and `:721` → `<Skeleton shape="diagram" />`
  after the `<p>` (a fragment); `ConnectionsView.tsx:397`, `:400` (no error), `:402` (no error) → the same, never in the busy state; `MaterialsView.tsx:307` → `<Skeleton shape="lines" />`;
  `LinePanel.tsx:162` → `<Skeleton shape="lines" rows={3} />` when `loading && layout === null`; `View3D.tsx:233` → `<Skeleton shape="scene" />` when `loading && layout === null`
  (add-on 17's farms-only line `:236` is no loading line: no skeleton);
  `MapTab.tsx`: the status div stays exact and `<Skeleton shape="scene" />` follows it as a sibling while there is no error; `View3DTab.tsx:30` fallback
  `<><p className="muted">Loading the 3D view…</p><Skeleton shape="scene" /></>`; `CompareCard.tsx:167` →
  `loading && <><p className="muted">Planning the three modes…</p><Skeleton shape="compare" /></>` (the branch a card with no answer for its
  target draws: the first compare once it opens, which since `4bef36c` and `68c06c1` includes a card whose target was cleared or changed
  while it was closed, and since `68c06c1` another target picked with the card open); after `:173`'s note, for a mode still
  planning (`c.status === 'pending'`), `<Skeleton shape="readouts" />`; never beside `:162`'s `Updating…` (its columns stay drawn, as
  Connections' busy state) or `:165`'s failed-fetch alert (no loading line). `ProjectPage.tsx:156`: `<p className="muted"><GtArrow tone="chat" />Updating the plan…</p>`; the aside, right after
  Close settings (`:442`): `<p className="visually-hidden" role="status">{settingsOpen ? drawerStatus(plan, view.planError, view.planLoading) : ''}</p>` (`drawerStatus`: `planError` when
  set; else `The plan is updating…` when `planLoading && plan !== null` (the banner's `busy`, in other words than the banner's `Updating the plan…`:
  `drawer.spec.ts:441` reads that with `getByText` while the drawer is open, and `getByText` sees visually hidden text; plan ruling
  `drawer-status-words`); else ``The plan has ${N} ${N === 1 ? 'problem' : 'problems'}`` when N > 0, N
  being what PlanBanner lists — its `issues` plus its `others` less the `no-target` hint (`w.code === NO_TARGET`, `ProjectPage.tsx:81`;
  plan ruling `drawer-status-count`), through one helper both call; its source notes (`sourceNotes`, `materials-model.ts:288`) are no
  problem either; else `''`; never a warning's text). `styles.css`: `@keyframes sheen { to { transform: translateX(100%); } }`; after `:534` spec §11.2's
  rules and the geometry: `.skeleton { display: flex; flex-direction: column; gap: 8px; }`, blocks `height: 18px`, cards `58px`, project `36px` (width 40 %) / `52px` / `360px`, strip a grid like
  `.key-numbers > dl` with `52px` blocks, diagram `display: grid; grid-template-columns: repeat(3, 110px); gap: 40px; align-content: center; height: 240px; padding: 20px` with `70px` blocks,
  scene `height: 360px; padding: 20px` with one `100%` block, lines' even blocks `width: 70%`; readouts, the tiles' own grid
  (`display: grid` and the `grid-template-columns` of `.compare-rows`, `repeat(auto-fit, minmax(min(160px, 100%), 1fr))`, so the six blocks
  fall as the six tiles will), gap `4px`, six `55px` blocks: a `.compare-row` is 6 + 14.3 + 2 + 26.39 + 6 px (26.390625 px: the value's line, which Task 2b fixes in px (ruling P2-R13), so a tile
  keeps it at every size: plan ruling `compare-shrink-vt323`); compare, the
  `.compare-columns` grid (`repeat(auto-fit, minmax(220px, 1fr))`, gap `12px`) of three readouts frames, each framed as a column is —
  `.skeleton-compare > .skeleton-readouts { border: 2px solid; border-color: var(--panel-lo) var(--panel-hi) var(--panel-hi) var(--panel-lo); padding: 35.5px 10px 52px; }`:
  the column's 8 px padding, 19.5 px title and 8 px gap above its tiles, its 8 px gap, 36 px button and 8 px padding below, 10 px at
  each side, so a frame's grid is exactly as wide as a loaded column's `.compare-rows` — and no height of its own: its blocks sit two
  a row where the loaded tiles do (a frame 264.5 px tall, a loaded column 263.6) and one a row where they stack (441.5 px against
  439.7), at the same widths. Keep the `skeleton-<shape>` names: `.skeleton-compare` does not match the contract's
  `ADDON17_RULE` (it needs `.compare-`).

- [ ] **Step 5: Run everything** — `npm test` → PASS (every loading text still found: `flow.test.tsx:99`, `connections-view.test.tsx:76-80`, `map-tab.test.tsx:46` exact, `layout-map.test.tsx:240`, `view3d.test.tsx:37`); `npm run e2e` → PASS (`connections.spec.ts:71`'s `elementFromPoint` sees no skeleton; `drawer.spec.ts:441`'s `getByText('Updating the plan…')`, taken with the drawer open and the plan held, still finds one element).

- [ ] **Step 6: Review shots** — label `8`, both looks: append shots of Flow and the project list with the plan route held; against `Phase2Feedback.dc.html`'s loading panel.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(client): skeletons beside the loading lines, the GT arrow while the plan updates, and a status line in the drawer (R43)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9a: Toasts, and Undo for a rename

**Files:**
- Create: `src/client/state/toasts.ts`, `src/client/components/Toasts.tsx`, `tests/client/toasts.test.tsx`, `tests/e2e/toasts.spec.ts`
- Modify: `src/client/App.tsx:40-46`, `src/client/views/ProjectPage.tsx` (the drawer effect `:358-372`, the rename `:419`), `src/client/views/ProjectList.tsx:125-142` (create), `src/client/views/NotesView.tsx:70-76` (add), `src/client/views/MapTab.tsx:396-401`, `src/client/views/ProjectorPanel.tsx:196-207`, `src/client/views/WorldPage.tsx:493`, `:496`, `src/client/styles.css` (dark ink group, keyframes, new block)
- Modify: `tests/client/styles-contract.test.tsx`, `tests/client/contrast.test.tsx`, `tests/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: `validateOp` (`src/shared/project/apply-op.ts:425`), `PAIRS`, `PHASE2_RULES`, `DARK_TOUR`, `LV_CIRCUITS`, `SETTINGS_BUTTON` (the motion is CSS only: no `prefersReducedMotion()` here).
- Produces:
  - `toasts.ts`: `TOAST_MS = 5000`, `TOAST_LIMIT = 3`, `TOAST_EXIT_MS = 180`; `interface ToastAction { label: string; run(): void | Promise<unknown> }`; `interface Toast { id: number; text: string; action?: ToastAction; key?: string; leaving: boolean }`;
    `interface ToastOptions { action?: ToastAction; key?: string; ms?: number; onExpire?(): void }`; `type PauseReason = 'pointer' | 'focus' | 'hidden'`;
    `interface ToastStore { show(text: string, opts?: ToastOptions): number; dismiss(idOrKey: number | string): void; act(id: number): void; pause(id: number, why: PauseReason): void; resume(id: number, why: PauseReason): void; setHidden(hidden: boolean): void; subscribe(fn: () => void): () => void; getSnapshot(): readonly Toast[] }`;
    `createToastStore(clock?: { setTimeout(fn: () => void, ms: number): unknown; clearTimeout(handle: unknown): void; now(): number }): ToastStore`; the App's store `toasts` and `showToast`, `dismissToast`, `actOnToast`, `pauseToast`, `resumeToast`, `useToasts(): readonly Toast[]`.
  - `Toasts.tsx`: `ToastList(props: { toasts: readonly Toast[] }): ReactElement` (hook-free markup) and `Toasts(): ReactElement` (the App region).

- [ ] **Step 1: Write the failing unit tests**

`tests/client/toasts.test.tsx` (`vi.useFakeTimers()`, a fresh `createToastStore()` each case):

```ts
it('keeps a toast 5 s, then lets it leave for 180 ms, telling it once', () => {
  const onExpire = vi.fn(); const id = store.show('Note added', { onExpire });
  vi.advanceTimersByTime(4999); expect(store.getSnapshot()).toEqual([{ id, text: 'Note added', leaving: false }]);
  vi.advanceTimersByTime(1); expect(store.getSnapshot()[0]!.leaving).toBe(true); expect(onExpire).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(180); expect(store.getSnapshot()).toEqual([]);
});
it('pauses while pointed at, focused or hidden, and resumes with the time it had left', () => {
  const id = store.show('x'); vi.advanceTimersByTime(3000); store.pause(id, 'pointer'); store.pause(id, 'focus'); vi.advanceTimersByTime(60_000);
  store.resume(id, 'pointer'); vi.advanceTimersByTime(10_000); expect(store.getSnapshot()[0]!.leaving).toBe(false);
  store.resume(id, 'focus'); vi.advanceTimersByTime(1999); expect(store.getSnapshot()[0]!.leaving).toBe(false); vi.advanceTimersByTime(1); expect(store.getSnapshot()[0]!.leaving).toBe(true);
  store.setHidden(true); const later = store.show('y'); vi.advanceTimersByTime(60_000); expect(store.getSnapshot().find((t) => t.id === later)!.leaving).toBe(false);
});
it('holds three at most, the oldest leaving first', () => {
  const first = vi.fn(); const [oldest] = [store.show('1', { onExpire: first }), store.show('2'), store.show('3'), store.show('4')];
  expect(store.getSnapshot().filter((t) => !t.leaving).map((t) => t.text)).toEqual(['2', '3', '4']);
  expect(store.getSnapshot().find((t) => t.id === oldest)!.leaving).toBe(true); expect(first).toHaveBeenCalledTimes(1);
  vi.advanceTimersByTime(TOAST_EXIT_MS); expect(store.getSnapshot().map((t) => t.text)).toEqual(['2', '3', '4']);
});
it('dismisses by key, and a newer toast of a key replaces the older at once', () => {
  store.show('Renamed to “A”', { key: 'rename:p' }); store.show('Renamed to “B”', { key: 'rename:p' }); expect(store.getSnapshot().map((t) => t.text)).toEqual(['Renamed to “B”']);
  store.dismiss('rename:p'); expect(store.getSnapshot()[0]!.leaving).toBe(true);
});
it('runs an action once and then lets its toast leave without expiring it', () => {
  const run = vi.fn(); const onExpire = vi.fn(); const id = store.show('Deleted “Steel”', { action: { label: 'Undo', run }, onExpire });
  store.act(id); store.act(id); expect(run).toHaveBeenCalledTimes(1); expect(store.getSnapshot()[0]!.leaving).toBe(true);
  vi.advanceTimersByTime(TOAST_MS); expect(onExpire).not.toHaveBeenCalled();
});
it('expires a toast once, even when what it runs on expiry dismisses it again', () => {   // a deferred delete's flush dismisses its own toast (Task 9b)
  const onExpire = vi.fn(() => store.dismiss('note:n1')); store.show('Note deleted', { key: 'note:n1', onExpire });
  vi.advanceTimersByTime(TOAST_MS); expect(onExpire).toHaveBeenCalledTimes(1);
  store.dismiss('note:n1'); expect(onExpire).toHaveBeenCalledTimes(1); vi.advanceTimersByTime(TOAST_EXIT_MS); expect(store.getSnapshot()).toEqual([]);
});
it('draws a polite region that is never an alert, with Undo and Dismiss', () => {
  const html = renderToStaticMarkup(<ToastList toasts={[{ id: 1, text: 'Deleted “Steel line”', action: { label: 'Undo', run() {} }, leaving: false }]} />);
  expect(html).toBe('<section class="toasts" aria-label="Notifications"><ol aria-live="polite" aria-relevant="additions"><li class="toast" data-state="open"><span>Deleted “Steel line”</span><button type="button" class="small primary">Undo</button><button type="button" class="small" aria-label="Dismiss">×</button></li></ol></section>');
  expect(renderToStaticMarkup(<ToastList toasts={[]} />)).toContain('<ol aria-live="polite" aria-relevant="additions"></ol>');
});
```
Contract `'draws toasts as chat boxes in a corner, under every layer'`: `.toasts` `position: fixed`, `right: 16px`, `bottom: 16px`, `z-index: 40` (below `.drawer-backdrop`'s 50), `pointer-events: none`,
`max-width: min(360px, 100vw - 32px)`; `.toast` `pointer-events: auto`, `background: var(--chat)`, `border: 2px solid var(--outline)`, `font: 13px/18px var(--font-ui)`,
`animation: toast-in var(--dur-slow) var(--ease-pop)`, in `inkGroup('.banner')` after its first 7; `.toast[data-state='leaving']` `pointer-events: none` and `animation: toast-out var(--dur-exit) var(--ease-in) forwards`;
`KEYFRAMES` gains `'toast-in'` and `'toast-out'` (`['opacity', 'transform']`); `PHASE2_RULES` gains them. Contrast: `['toast text over a panel', '#ffffff', { over: '--chat', on: '--panel' }, AA]`,
`['toast text over the page', '#ffffff', { over: '--chat', on: '--page' }, AA]`, `['Undo', '--accent', '--btn', AA]`.

- [ ] **Step 2: Write the failing e2e** — `tests/e2e/toasts.spec.ts`:
2. `'renaming offers Undo'` — fill `Project name`, Enter → `Renamed to “<new>”`; `Undo` → the field's value back (poll).
5. `'under reduced motion a toast appears with no entrance'` — the rename toast's `animationDuration` `0.001s`.
7. `'while the drawer is open the toasts are out of reach'` — 800 × 900, `createProject(page, 'Toasts drawer', LV_CIRCUITS)` (a target: without one the drawer opens by itself below 900 px and the head, `Project name` with it, is inert and refuses the rename: `drawer.spec.ts:298-339`), rename (its toast shows Undo), `page.getByRole('button', { name: SETTINGS_BUTTON }).click()` → `section.toasts` has the `inert` attribute; Escape → it has none.
8. `'the toasts are out of reach from the moment the drawer opens by itself'` — 800 × 900, `createProject(page, 'Toasts, nothing yet')` with no target: `aside[aria-label='Project settings']` visible → `section.toasts` `toHaveAttribute('inert', '')`; Escape → `not.toHaveAttribute('inert')`.
`DARK_TOUR` gains a stop `'a toast'` (rename the project): `.toast` `background-color` `rgba(0, 0, 0, 0.82)`.

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/toasts.test.tsx tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx` → FAIL.

- [ ] **Step 4: Implement**

- `toasts.ts` per the Interfaces: `show` with an existing `key` drops the older at once (its `onExpire` runs); a fourth live toast dismisses the oldest; the timer runs only while the
  reason set is empty (remaining time kept); `dismiss` sets `leaving` first, then calls `onExpire` once and removes the toast after `TOAST_EXIT_MS`, and does nothing to a toast
  already leaving (so an `onExpire` that dismisses its own toast re-enters harmlessly); `act` runs the action then leaves without `onExpire`; `setHidden` adds/removes `'hidden'` on every toast and on
  toasts shown while hidden; `getSnapshot` returns a new array only on a change; `useToasts` = `useSyncExternalStore(toasts.subscribe, toasts.getSnapshot, toasts.getSnapshot)`.
- `Toasts.tsx`: `ToastList` is the Step 1 markup (`data-state` `open`/`leaving`; `onPointerMove` → `pauseToast(id, 'pointer')`, `onPointerLeave` → resume; `onFocus` → `'focus'`, `onBlur`
  when `relatedTarget` leaves the li → resume; Undo → `actOnToast(id)`, × → `dismissToast(id)`); `Toasts` renders it from `useToasts()` and wires `visibilitychange` → `toasts.setHidden(document.hidden)`.
  `App.tsx`: `<Toasts />` right after `<RoutePage route={route} />`.
- Call sites (spec §12.1's table, texts exact): `ProjectList` `create` → `showToast(\`Created “${project.name}”\`)` before `navigate`. `ProjectPage`: `onRename` → when
  `validateOp({ op: 'rename', name }) === null`, `showToast(\`Renamed to “${name}”\`, { key: \`rename:${project.id}\`, action: { label: 'Undo', run: () => send([{ op: 'rename', name: before }]) } })`;
  the drawer effect (`:358-372`) also sets `.toasts` `inert` beside `.top-nav` (`:360-361`), before its first `onWidth()` look (`:367`), and
  clears it in the same cleanup (`:370`), which may run at once: that look closes a drawer opened in a window that has grown. `NotesView` add → `showToast('Note added')`; `MapTab` `saveNote` → `showToast('Note added')`; `ProjectorPanel`
  copy → `if (done) showToast('Command copied')`; `WorldPage` `send` → `Upload started` at `:493`, `Upload finished` at `:496`.
  Nothing else shows a toast (P2-D28: exactly D14's set): add-on 17's Use this mode (`CompareCard.tsx:189`, which may also set
  `buildHorizonHours: 24` through `objectivePatch`), the Plan for radios, the farm settings and the surplus choice show none and offer no
  Undo. Their feedback is already on screen: the column turns `In use`, the card says `Updating…` (the same target keeps its figures:
  `68c06c1`), the radio is checked, and the strip
  counts to the new plan. Picking the previous mode again undoes one.
- `styles.css`: `.toast` appended to the dark ink group, at the end of its selector list (after the base's `.compare-column > :where(p)`, `:81`, and 5a's `.readout`); `@keyframes toast-in { from { opacity: 0; transform: translateY(12px) scale(0.96); } }` and `toast-out` (`to` the same);
  the Step 1 rules plus `.toasts > ol { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 8px; }`,
  `.toast { display: flex; align-items: center; gap: 8px; min-height: 44px; padding: 6px 8px 6px 12px; }`, `.toast > span { flex: 1; min-width: 0; overflow-wrap: anywhere; }`.

- [ ] **Step 5: Run everything** — `npm test` → PASS; `npm run e2e` → PASS. Watch `projector.spec.ts` (`Copied` is scoped to its line), `world.spec.ts`, `drawer.spec.ts:86-95` (the Tab cycle) and the Make-picker cases `:298-615`.

- [ ] **Step 6: Review shots** — label `9a`: append a shot with a rename toast and one with three toasts stacked; against `Phase2Feedback.dc.html`.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(client): toasts in a polite corner region, and Undo for a rename" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9b: Undo for a deleted project or note

**Files:**
- Create: `src/client/state/projects-changed.ts`
- Modify: `src/client/api/client.ts:32-55`, `src/client/state/project-store.ts` (`StoreDeps` `:29-37`, `ProjectStore` `:39-46`, `visible` `:91-96`, `close` `:238-245`, `liveDeps` `:252-261`, `useProject` `:271-282`), `src/client/views/project-tabs.ts:15-20`
- Modify: `src/client/views/ProjectPage.tsx` (`:422` delete, `:467` the view's props), `src/client/views/ProjectList.tsx` (the load effect `:79-123`, the row `:171-182`), `src/client/components/DeleteProject.tsx`, `src/client/views/NotesView.tsx:26-37`
- Modify: `tests/client/toasts.test.tsx`, `tests/client/project-store.test.tsx`, `tests/e2e/toasts.spec.ts`

**Interfaces:**
- Consumes: Task 9a's `toasts`, `showToast`, `dismissToast` and `ToastStore`; `restoreProject` (`api/projects.ts:18-20`), `ApiError`, `takeDeletedNotice`.
- Produces:
  - `projects-changed.ts`: `bumpProjectsChanged(): void`, `getProjectsChanged(): number`, `subscribeProjectsChanged(fn: () => void): () => void`, `useProjectsChanged(): number`.
  - `DeleteProject.tsx`: `showDeletedToast(id: string, name: string, deps?: { restore(id: string): Promise<unknown>; toasts: ToastStore }): number`.
  - `project-store.ts`: `interface DeferredSend { cancel(): void; flush(): void }`; `ProjectStore.sendLater(ops: ProjectOp[], opts?: { onFlush?(): void }): DeferredSend`; `StoreDeps.postOps(id, ops, opts?: { keepalive?: boolean })`; `StoreDeps.onPageHide?(fn: () => void): () => void`; `useProject` also returns `sendLater`.
  - `api/client.ts`: `apiPost<T>(path: string, body: unknown, opts?: { keepalive?: boolean }): Promise<T>`.
  - `ProjectViewProps.sendLater?: ProjectStore['sendLater']` (optional addition).

- [ ] **Step 1: Write the failing unit tests**

`toasts.test.tsx` gains:

```ts
it('restores a deleted project from its toast; a 409 counts as done, a 404 says it could not', async () => {
  const before = getProjectsChanged();
  showDeletedToast('p1', 'Steel', { restore: vi.fn(async () => ({})), toasts: store });
  expect(store.getSnapshot()[0]).toMatchObject({ text: 'Deleted “Steel”', key: 'project:p1' }); store.act(store.getSnapshot()[0]!.id);
  await vi.waitFor(() => expect(getProjectsChanged()).toBe(before + 1));
  showDeletedToast('p2', 'Iron', { restore: vi.fn(async () => { throw new ApiError(409, 'not-deleted', 'not deleted'); }), toasts: store });
  store.act(store.getSnapshot().find((t) => t.key === 'project:p2')!.id); await vi.waitFor(() => expect(getProjectsChanged()).toBe(before + 2));
  showDeletedToast('p3', 'Gold', { restore: vi.fn(async () => { throw new ApiError(404, 'not-found', 'gone'); }), toasts: store });
  store.act(store.getSnapshot().find((t) => t.key === 'project:p3')!.id);
  await vi.waitFor(() => expect(store.getSnapshot().map((t) => t.text)).toContain('Could not restore “Gold”')); expect(getProjectsChanged()).toBe(before + 2);
});
```
`project-store.test.tsx` (`harness` gains `onPageHide: (fn) => { hide = fn; return () => {}; }`):
`'applies a deferred batch at once and posts it only when it is flushed, once'` (a project with note n1: after `sendLater([{ op: 'deleteNote', id: 'n1' }])` the snapshot has no n1 and `postOps`
was not called; `flush()` → `postOps.mock.calls` is `[['p1', [op]]]` (a plain flush passes no options); a second `flush()` → still that one call); `'cancel brings it back and posts nothing'`; `'posts what is deferred when the store closes, and on pagehide, with keepalive, and says it flushed'`
(`close()` → `postOps('p1', [op], { keepalive: true })` and `onFlush` called; another store: `hide()` → the same).

- [ ] **Step 2: Write the failing e2e** — `toasts.spec.ts` gains (each note case registers `page.on('dialog', (d) => void d.accept())` while the note delete still confirms; Task 10 takes it out):
1. `'deleting a project from its page offers Undo, which brings it back'` — delete via `Confirm delete`; on `/` the region `Notifications` shows `Deleted “<name>”`; click `Undo` → `getByRole('link', { name, exact: true })` visible, `delete.spec.ts:57`'s `deletedRow(name)` locator count 0, `getByText(\`${name} was deleted by Ann\`)` count 0.
3. `'deleting a note offers Undo, which keeps its author, time and place'` — two notes added through the API (`POST /api/projects/<id>/ops` with `{ ops: [{ op: 'addNote', note: { id, text } }] }`, as `connections.spec.ts:18` posts), the first with `X-Planner-Name: Bob`; on Ann's page click the first `.note`'s `Delete` → `Note deleted`;
   `Undo`; reload → the first `.note` has the text and `.note-by` `Bob`.
4. `'a note deleted without Undo reaches another browser within 7 s'` — B: `toHaveCount(0, { timeout: 7000 })`.
6. `'a note deleted just before a reload stays deleted'` (Review Focus 3) — delete, `page.reload()` at once → the note's `.note-text` count 0 (auto-wait), and `GET /api/projects/<id>` (poll) has no notes.

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/toasts.test.tsx tests/client/project-store.test.tsx` → FAIL.

- [ ] **Step 4: Implement**

- `projects-changed.ts`: the `pin-focus.ts` pattern over a counter. `DeleteProject.tsx` `showDeletedToast`: `Deleted “<name>”`, key `project:<id>`, action `Undo` →
  `restore(id)`, done (also for `ApiError` code `not-deleted`) = `takeDeletedNotice()` then `bumpProjectsChanged()`, any other failure → `toasts.show(\`Could not restore “${name}”\`)`.
- `api/client.ts`: `call(…, opts)` sets `init.keepalive = true` when asked; `apiPost` passes `opts` through.
- `project-store.ts`: deferred batches after `pending` in `visible()`; `flush` moves a batch to `pending` and posts it — `deps.postOps(id, ops)`, or
  `deps.postOps(id, ops, { keepalive: true })` from `close` or pagehide — then `onFlush`; `cancel`
  drops it and updates; `close()` flushes every deferred batch **before** `closed = true`; `deps.onPageHide?.(flushAll)` registered at creation and released on close;
  `liveDeps` passes `opts` to `apiPost` and listens to `pagehide`. `useProject` returns `sendLater`.
- Call sites (spec §12.1's table, texts exact): `ProjectList` — the row's `onDeleted` also `showDeletedToast(p.id, p.name)`; `restore` also `dismissToast(\`project:${p.id}\`)`;
  `const changed = useProjectsChanged()` joins the load effect's deps (`[loads, changed]`) and clears `notice` when it moves. `ProjectPage`: `onDeleted` →
  `showDeletedToast(project.id, project.name)` then `view.markDeleted(me)`; `<View … sendLater={view.sendLater} />`. `NotesView`: `NoteItem` gets `sendLater` and, after
  its `confirm(…)` (still there until Task 10), defers `[{ op: 'deleteNote', id }]` with `onFlush: () => dismissToast(\`note:${id}\`)` and shows `Note deleted` (key
  `note:<id>`, action `Undo` → `cancel`, `onExpire` → `flush`); without `sendLater` it sends as today.

- [ ] **Step 5: Run everything** — `npm test` → PASS; `npm run e2e` → PASS. Watch `delete.spec.ts` (both tests: Restore and Delete may sit near a toast; `getByRole('alert')` stays 0 and
  `was deleted by` stays single), `world.spec.ts`, `drawer.spec.ts:86-95`.

- [ ] **Step 6: Review shots** — label `9b`: append a shot with the delete toast on the project list and one with a note's `Note deleted` toast; against `Phase2Feedback.dc.html`.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(client): Undo for a deleted project or note; a note delete posts 5 s later, or at once on leaving the page" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 10: In-app confirms instead of browser dialogs

**Files:**
- Create: `src/client/components/InlineConfirm.tsx`, `tests/client/inline-confirm.test.tsx`
- Modify: `src/client/views/ProjectorPanel.tsx` (`ProjectorPanelViewProps` `:15-23`, `TokenList` `:43-59`, `ProjectorPanelView` `:61-104`, `revoke` `:187-195`, the container's focus), `src/client/views/NotesView.tsx:35-37`, `src/client/styles.css` (dark ink group `:78-81`: append `.inline-confirm` at the end of its selector list — the base's last member is `.compare-column > :where(p)`, and 5a's `.readout` and 9a's `.toast` follow it — so `slice(0, 7)` at `styles-contract.test.tsx:530` still holds; after `:1351`, the end of `.projector-commands code`)
- Modify: `tests/client/projector-panel.test.tsx`, `tests/client/styles-contract.test.tsx`, `tests/e2e/projector.spec.ts:14-16` (deliberate, spec §3.9), `tests/e2e/toasts.spec.ts`, `tests/e2e/theme.spec.ts`

**Interfaces:**
- Consumes: `revokeQuestion` (`projector-model.ts:39-41`), Task 9b's note-delete Undo, `PHASE2_RULES`, `DARK_TOUR`.
- Produces: `InlineConfirm(props: { question: string; confirmLabel: string; cancelLabel?: string; busy?: boolean; error?: string | null; onConfirm(): void; onCancel(): void }): ReactElement`
  (`<div class="inline-confirm" role="alertdialog" aria-labelledby="<id>"><p id="<id>">…</p>[<p class="error small" role="alert">…</p>]<div class="row"><button type="button" class="small danger">…</button><button type="button" class="small">Keep it</button></div></div>`);
  `ProjectorPanelViewProps` gains optional `asking?: string | null`, `onAskRevoke?(t: TokenInfo): void`, `onCancelRevoke?(): void`, `revokeError?: string | null`.

- [ ] **Step 1: Write the failing tests**
- `inline-confirm.test.tsx`: the markup above for `question: 'Revoke "Steve"? …'`, `confirmLabel: 'Revoke token'` (`cancelLabel` defaults to `Keep it`; `busy` disables the danger button;
  `error` adds the alert); `'leaves no browser dialog anywhere in the client'` — every `.ts`/`.tsx` under `src/client` (a `readdirSync` walk), comments stripped, matches no
  `/\b(?:window|globalThis)\.(?:confirm|alert|prompt)\(/`, and no bare `/(?<![\w.$])(?:confirm|alert|prompt)\(/` unless the file declares a function of that name
  (`project-store.ts`'s own `function confirm(project)` is not a dialog).
- `projector-panel.test.tsx`: `ProjectorPanelView` with `asking: 'T1aaaaaaaa'` and two tokens: the `<li data-token-id="T1aaaaaaaa">` holds `role="alertdialog"` and
  `Revoke &quot;Steve&quot;? Anyone using it loses the ghosts until they get a new token.` and no `>Revoke</button>`; `html.match(/data-token-id/g)` length 2; no `style=`; the other
  row keeps its Revoke button. `revokeQuestion('Steve')` stays pinned (`:104`).
- Contract: `.inline-confirm` in `inkGroup('.banner')` after its first 7, `background: var(--chat)`, `border: 2px solid var(--outline)`, `animation: rise-in var(--dur-base) var(--ease-out)`;
  `PHASE2_RULES` gains it.
- `projector.spec.ts` (spec §13.3): `const dialogs: string[] = []; page.on('dialog', (d) => { dialogs.push(d.message()); void d.dismiss(); });`; `:14-16` become: click Revoke → the alertdialog
  named `/Revoke "Steve"/` with `Keep it` focused; `Keep it` → `getByText(/^Steve · gpt_/)` visible and `getByRole('button', { name: 'Revoke' })` focused; Revoke again →
  `getByRole('alertdialog', { name: /Revoke "Steve"/ }).getByRole('button', { name: 'Revoke token' }).click()` → `No tokens yet.` visible and `getByLabel('Who is it for?')` focused;
  at the end `expect(dialogs).toEqual([])`.
- `toasts.spec.ts`: the `page.on('dialog', … accept)` lines become the same no-dialog guard, `expect(dialogs).toEqual([])` at each test's end.
`DARK_TOUR` gains a stop `'a confirm'` (open the projector panel, create a token, Revoke): `.inline-confirm` `background-color` `rgba(0, 0, 0, 0.82)`.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/client/inline-confirm.test.tsx tests/client/projector-panel.test.tsx` → FAIL (no component; `window.confirm` at `ProjectorPanel.tsx:188`, `confirm(` at `NotesView.tsx:36`).

- [ ] **Step 3: Implement** — `InlineConfirm` per the Interfaces: a `useLayoutEffect` focuses Keep it on mount; `onKeyDown` Escape → `preventDefault()` + `onCancel()`, never
  `stopPropagation()`. `ProjectorPanelView`'s `TokenList` draws the confirm in place of the row's Revoke while `asking === t.tokenId` (`onConfirm` → `onRevoke(t)`, `onCancel` →
  `onCancelRevoke`), and the Revoke button calls `(onAskRevoke ?? onRevoke)(t)`. The container: `asking` and `revokeError` state; `revoke` no longer calls `window.confirm`; Keep it →
  focus back on that row's Revoke and a success → focus the `Who is it for?` field, both in a `useLayoutEffect` on `[asking, tokens]` (the rows re-render first); a failed revoke keeps
  the confirm open with `revokeError` and the focus on Keep it. `NotesView`: `confirm(…)` goes — the note delete is Task 9b's deferred delete and its Undo.
  `styles.css`: `.inline-confirm` appended to the dark ink group, at the end of its selector list, as Task 9a's `.toast`; after `:1351` `.inline-confirm { display: flex; flex-direction: column; gap: 8px; padding: 8px 10px; background: var(--chat); border: 2px solid var(--outline); animation: rise-in var(--dur-base) var(--ease-out); }`,
  `.inline-confirm p { margin: 0; }`, `.key-list > li:has(> .inline-confirm) { flex-wrap: wrap; }`, `.key-list > li > .inline-confirm { flex: 1 1 100%; }`.

- [ ] **Step 4: Run everything** — `npm test` → PASS; `npm run e2e` → PASS (`drawer.spec.ts:206-221`, inside the case at `:189`, whose project now gets drawer.spec's `TARGET`: the confirm's Escape keeps the drawer open the way that case simulates).

- [ ] **Step 5: Review shots** — label `10`, both looks: append the projector panel with the confirm open; against `Phase2Feedback.dc.html`.

- [ ] **Step 6: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(client): revoking a token asks in the panel, and no browser dialog is left" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 11: Keyboard shortcuts and the sheet that lists them (with R44, R46, R47)

**Files:**
- Create: `src/client/state/shortcuts.ts`, `src/client/components/ShortcutsSheet.tsx`, `tests/client/shortcuts.test.tsx`, `tests/e2e/shortcuts.spec.ts`
- Modify: `src/client/components/PipesButton.tsx:1-16`; `src/client/views/FlowView.tsx` (`:562`, `:578`); `src/client/views/ConnectionsView.tsx` (`:46`, `:323`); `src/client/components/ItemSearch.tsx:15-16`, `:86-105`; `src/client/views/SettingsPanel.tsx:189` (the Make section's `<ItemSearch`, `:189-194`); `src/client/views/ProjectPage.tsx` (`:273-280` comment; `:281-372` the drawer's hooks, with new hooks going above the early return, now `:403`, after the Compare hooks `:373-401`; `:414-423` the head; `:440` the aside; `:449-463` the tabs); `src/client/styles.css` (after `.modal h2, .modal p` `:472`; the drawer's 900 px block `:1369-1389`)
- Modify: `tests/client/pipes-paused.test.tsx:88-89`, `tests/client/connections-view.test.tsx:49`, `:265`, `:269`, `tests/e2e/pipes.spec.ts:204`, `:206`, `:213`, `:222` (all deliberate, spec §3.9), `tests/e2e/drawer.spec.ts:141-159` (R46), `tests/e2e/theme.spec.ts`, `tests/client/styles-contract.test.tsx`, `tests/client/contrast.test.tsx`
- Docs: `docs/superpowers/specs/2026-10-22-machine-gui-restyle-design.md:291-296`, `:395-397`; the Phase 1 plan's R31 line (`:905-908`)

**Interfaces:**
- Consumes: the trigger contract (`data-tip`, Task 3a), `Figs` (Task 2b), `PROJECT_TABS`, `openConnections` (Task 3b), `openWithPlan`, `SETTINGS_BUTTON`, `PHASE2_RULES`, `DARK_TOUR`; the Make-picker fix's `NARROW`, `settingsPanel`, `focusOnOpen`, `openSettings`, `focusSearch` and `pickTarget` (`ProjectPage.tsx:76`, `:284-328`).
- Produces:
  - `shortcuts.ts`: `type Shortcut = { kind: 'tab'; index: 0 | 1 | 2 | 3 | 4 | 5 } | { kind: 'search' } | { kind: 'fit' } | { kind: 'pipes' } | { kind: 'sheet' }`;
    `interface KeyLike { key: string; ctrlKey: boolean; metaKey: boolean; altKey: boolean; shiftKey: boolean; defaultPrevented: boolean; isComposing: boolean; repeat: boolean }`;
    `interface TargetLike { tagName: string; type?: string; isContentEditable?: boolean; closest(selector: string): unknown }`; `isTypingTarget(el: TargetLike | null): boolean`;
    `shortcutOf(e: KeyLike, target: TargetLike | null): Shortcut | null`; `SHORTCUT_ROWS: ReadonlyArray<readonly [caps: readonly string[], what: string]>`.
  - `ShortcutsSheet.tsx`: `ShortcutsDialog(props: { onClose(): void; closeRef?: Ref<HTMLButtonElement> }): ReactElement` (the dialog markup, for tests) and `ShortcutsSheet(props: { onClose(): void }): ReactElement` (a portal on `document.body` with `#root` inert).
  - Markup: Fit `<button type="button" class="small" aria-keyshortcuts="F" data-tip="Fit · F">Fit</button>` (both diagrams); PipesButton `<button type="button" class="small" aria-keyshortcuts="P" data-tip="Pause pipes · P">Pause pipes</button>` / `… data-tip="Play pipes · P">Play pipes</button>`.
  - `ItemSearch` optional `shortcut?: string` → `aria-keyshortcuts` on its input.

- [ ] **Step 1: Write the failing unit tests** — `tests/client/shortcuts.test.tsx`:

```ts
const key = (k: string, over: Partial<KeyLike> = {}): KeyLike => ({ key: k, ctrlKey: false, metaKey: false, altKey: false, shiftKey: false, defaultPrevented: false, isComposing: false, repeat: false, ...over });
const el = (tagName: string, over: Partial<TargetLike> = {}): TargetLike => ({ tagName, closest: () => null, ...over });
it('counts a field, a text area, a select, an editable and a list as typing, and a tick or a button not', () => {
  for (const type of [undefined, 'text', 'search', 'number', 'email', 'password', 'url', 'tel']) expect(isTypingTarget(el('INPUT', { type })), String(type)).toBe(true);
  for (const type of ['checkbox', 'radio', 'range', 'button', 'submit', 'reset', 'file', 'color', 'image']) expect(isTypingTarget(el('INPUT', { type })), type).toBe(false);
  // an element inside a combobox or a listbox: `closest` matches a part of the selector list exactly
  const inside = (role: string): TargetLike => el('LI', { closest: (s) => (s.split(',').map((p) => p.trim()).includes(`[role="${role}"]`) ? {} : null) });
  expect([el('TEXTAREA'), el('SELECT'), el('DIV', { isContentEditable: true }), inside('combobox'), inside('listbox')].map(isTypingTarget)).toEqual([true, true, true, true, true]);
  expect(isTypingTarget(inside('menu'))).toBe(false); expect(isTypingTarget(el('BUTTON'))).toBe(false); expect(isTypingTarget(null)).toBe(false);
});
it('maps / 1–6 F P and ?', () => {
  expect(shortcutOf(key('/'), null)).toEqual({ kind: 'search' });
  expect(['1', '2', '3', '4', '5', '6'].map((k) => shortcutOf(key(k), null))).toEqual([0, 1, 2, 3, 4, 5].map((index) => ({ kind: 'tab', index })));
  expect(shortcutOf(key('7'), null)).toBeNull(); expect(shortcutOf(key('Escape'), null)).toBeNull();
  for (const k of ['f', 'F']) expect(shortcutOf(key(k), null)).toEqual({ kind: 'fit' }); for (const k of ['p', 'P']) expect(shortcutOf(key(k), null)).toEqual({ kind: 'pipes' });
  expect(shortcutOf(key('?'), null)).toEqual({ kind: 'sheet' });
});
it('leaves a key alone with Ctrl, Cmd or Alt, while composing, repeating, once handled, or in a field', () => {
  for (const over of [{ ctrlKey: true }, { metaKey: true }, { altKey: true }, { isComposing: true }, { repeat: true }, { defaultPrevented: true }]) expect(shortcutOf(key('1', over), null)).toBeNull();
  expect(shortcutOf(key('1'), el('INPUT', { type: 'text' }))).toBeNull();
});
it('ignores Shift: AZERTY digits and ? still work', () => {   // Review Focus 5
  expect(shortcutOf(key('1', { shiftKey: true }), null)).toEqual({ kind: 'tab', index: 0 }); expect(shortcutOf(key('?', { shiftKey: true }), null)).toEqual({ kind: 'sheet' });
});
it('lists the mockup\'s rows, and draws them in a dialog named by its title', () => {
  expect(SHORTCUT_ROWS).toEqual([[['/'], 'Search items and fluids'], [['1', '–', '6'], 'Switch tabs: Map, 3D, Connections, Flow, Materials, Notes'], [['F'], 'Fit the diagram'],
    [['P'], 'Pause or play the pipes'], [['Esc'], 'Close a panel, clear the highlight, close the drawer'], [['?'], 'Show this sheet']]);
  const html = renderToStaticMarkup(<ShortcutsDialog onClose={() => {}} />);
  expect(html).toMatch(/<div class="modal shortcuts-sheet" role="dialog" aria-modal="true" aria-labelledby="([^"]+)"><h2 id="\1">Keyboard shortcuts<\/h2>/);
  expect(html).toContain('<dt><kbd><span class="fig">1</span></kbd>–<kbd><span class="fig">6</span></kbd></dt>'); expect(html.match(/<dt>/g)).toHaveLength(6); expect(html).toContain('<button type="button">Close</button>');   // a digit cap's digit in VT323 (spec §25)
});
```
Deliberate updates (spec §3.9 rows 12–13, R44): `pipes-paused.test.tsx:88-89` → the two PipesButton strings of the Interfaces; `connections-view.test.tsx:49` →
`/<button type="button" class="small" aria-keyshortcuts="F" data-tip="Fit · F">Fit<\/button>.*<div class="connections" data-testid="connections"/s`; `:265` →
`/<button type="button" class="small" aria-keyshortcuts="F" data-tip="Fit · F">Fit<\/button><button type="button" class="small" aria-keyshortcuts="P" data-tip="Pause pipes · P">Pause pipes<\/button><span class="muted small">/`;
`:269` → the `Play pipes · P` twin. Contract: `kbd` caps `.shortcut-list kbd` `font: 14px/24px var(--font-pixel)` (a digit cap's digit is Task 2b's `span.fig`, 16.1 px on a line of 0, so the cap keeps its 24 px line), `min-height: 28px`, `background: var(--btn)`, `box-shadow: var(--bevel-btn)`, `border: 2px solid var(--outline)`, `color: #ffffff`; `PHASE2_RULES` gains them. Contrast `['shortcut key cap', '#ffffff', '--btn', AA]`.
Contract (plan ruling `shortcuts-button-wide`; `NARROW` is at `styles-contract.test.tsx:734`, and the pattern is the case 'moves the button
into a bar under the banner below 900px', `:2282`): `it('draws no Shortcuts button in the head below 900 px, where its one row is full', () => { expect(inQuery(NARROW, '.project-head > .shortcuts-open')).toEqual([['display', 'none']]); expect(blocks.filter((b) => !b.nested && b.prelude.split(', ').includes('.project-head > .shortcuts-open'))).toEqual([]); })`;
`PHASE2_RULES` gains `.project-head > .shortcuts-open`.

- [ ] **Step 2: Write the failing e2e** — `tests/e2e/shortcuts.spec.ts` on `openWithPlan(page, circuitLv())` (the page opens at `#flow`, the focus on the body):
1. `'5 selects Materials & steps and moves the focus to it'` — `keyboard.press('5')` → the tab `aria-selected="true"` and focused.
2. `'a digit typed in a field types'` — focus `Project name`, press `1`, Escape → the Flow tab still selected; the same in `getByLabel('Amount')` (then `Escape`).
3. `'/ focuses the item search, which stays empty'` — `page.locator('input[aria-keyshortcuts="/"]')` (count 1: the Make search. The avoid box's, the cost form's and the Add a farm form's (`SettingsPanel.tsx:860`, placeholder "Item it gives") have none), focused, in the viewport, value `''`.
4. `'? and the Shortcuts button open the sheet; Escape closes it and gives the focus back'` — focus Fit, press `?` → `getByRole('dialog', { name: 'Keyboard shortcuts' })` visible, its Close focused;
   Escape → count 0, Fit focused; the `Shortcuts` button opens it too; and at 1280 × 720 the `.project-head` box height is `36` with the
   Compare modes and Shortcuts buttons both drawn.
5. `'P pauses and plays the pipes'` — `Play pipes` then `Pause pipes`; `not.toHaveAttribute('aria-pressed')`.
6. `'F fits the Connections picture again'` — `openConnections(page)`, read `g.conn-pan` `transform`, drag it 100 px, press `f` → the attribute equals the first reading.
7. `'with the drawer open at 800 px a digit does nothing'` — `setViewportSize({ width: 800, height: 900 })` before `openWithPlan(page, circuitLv())`
   (its project has a target, so the drawer does not open by itself); open the drawer with
   `page.getByRole('button', { name: SETTINGS_BUTTON }).click()` (the button reads "Settings · Make: Basic Circuit"; `{ name: 'Settings', exact: true }`
   matches nothing, and a bare `'Settings'` also matches "Close settings"). Press `1`: `#tab-flow` is still `aria-selected="true"` and
   `.settings-toggle` still `aria-expanded="true"`.
8. `'at 800 px / opens the drawer with the focus in its search'` — the same setup, the drawer closed. Press `/`: `.settings-toggle` is
   `aria-expanded="true"`; `aside[aria-label="Project settings"] input[aria-keyshortcuts="/"]` is focused, in the viewport, with value `''`;
   `.settings-close` is not focused.
9. `'F and P do nothing off the diagrams'` — `5` (Materials & steps), press `p` and `f`; `4` (Flow): the button still reads `Pause pipes`
   (no setting changed unseen).
10. `'at 800 px the head keeps its one row: no Shortcuts button there, and ? still opens the sheet'` (plan ruling `shortcuts-button-wide`) —
   `setViewportSize({ width: 800, height: 900 })`, then `openWithPlan(page, circuitLv())`; `await expect(page.locator('.connection.live')).toBeVisible()`
   (the badge the head settles on, as at `drawer.spec.ts:512`, ruling F3); `.project-head .shortcuts-open` is `toBeHidden()`, and
   `.project-head`'s height, read after `document.fonts.ready` as `objectives.spec.ts:87-90` reads it since `4bef36c`, is `36`; press `?` → `getByRole('dialog', { name: 'Keyboard shortcuts' })` visible; Escape → its
   count is 0; `setViewportSize({ width: 1280, height: 720 })` → `getByRole('button', { name: 'Shortcuts' })` visible.
11. `'a project with no target opens the drawer into its search at 800 px, and keys typed there are typed'` — `setViewportSize({ width: 800, height: 900 })`,
   `login`, `setName(page, 'Ann')`, then `createProject(page, 'Typed here')` with no settings; the aside's
   `getByPlaceholder('Search items and fluids')` is `toBeFocused()` (the drawer opened by itself); press `5`, `?`, `/`, `f`, `p`: the search's
   value is `'5?/fp'`, `getByRole('dialog', { name: 'Keyboard shortcuts' })` has count 0, `#tab-flow` is `aria-selected="true"` and
   `.settings-toggle` is `aria-expanded="true"`.

`pipes.spec.ts:204`, `:206`, `:213`, `:222` → `not.toHaveAttribute('aria-pressed')` (the name checks carry the state). `drawer.spec.ts:141-159`
(R46, plan ruling `aside-refocus`; its project has `TARGET`, and its toggle's click puts the focus on Close settings): after `:152`
(`.settings-toggle` `aria-expanded` `false`, which waits for the close), `await expect(settings).toBeFocused()` (the column itself: the
Close settings button the click focused is not drawn at 1280) and `expect(await focusIsIn(page)).toBe('the drawer')`;
`drawer.spec.ts:578-615` stays green unchanged. `DARK_TOUR` gains a stop `'the shortcuts sheet'` (press `?`): `.shortcuts-sheet` `background-color` `rgb(42, 42, 42)`, `.shortcut-list kbd` `background-color` `rgb(60, 60, 60)`.

- [ ] **Step 3: Run them to see them fail** — `npx vitest run tests/client/shortcuts.test.tsx tests/client/pipes-paused.test.tsx tests/client/connections-view.test.tsx tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx` → FAIL (no `shortcuts.ts`, the old PipesButton markup, no `.shortcut-list kbd` or `.project-head > .shortcuts-open` rule).

- [ ] **Step 4: Implement**

- `shortcuts.ts` per the Interfaces (Shift is never a reason to skip; `isTypingTarget` checks `closest('[role="combobox"], [role="listbox"]')`). `ShortcutsSheet.tsx`: `.modal-backdrop`
  (backdrop `mousedown` on itself closes) holding `ShortcutsDialog` (`useId` for the title; a `<dl className="shortcut-list">` of `<div><dt>{caps as <kbd><Figs text={cap} /></kbd>, '–' as text}</dt><dd>{what}</dd></div>`;
  a `Close` button); on mount `#root` gets `inert` and the Close button the focus, on unmount `inert` goes; `onKeyDown` Escape → `preventDefault()` + `stopPropagation()` + `onClose()` (P2-D22).
- `PipesButton.tsx`: R44 — no `aria-pressed`, the Interfaces' markup (`type`, `className`, `aria-keyshortcuts`, `data-tip` in that prop order), comment `:1-4` reworded (the label says what a press does).
  Fit in `FlowView.tsx:562` and `ConnectionsView.tsx:323` per the Interfaces; the hints (`FlowView.tsx:578`, `ConnectionsView.tsx:46`) end `? shows the shortcuts.`
- `ItemSearch`: `shortcut` prop → `aria-keyshortcuts={props.shortcut}`; `SettingsPanel.tsx:189` passes `shortcut="/"` (the Make section's `ItemSearch` only; the costs form's at `:351` and the farm form's at `:860` get none).
- `ProjectPage.tsx`: tab buttons `aria-keyshortcuts={String(i + 1)}`; a `Shortcuts` button (`type="button" className="small shortcuts-open" aria-keyshortcuts="?"`) last in `.project-head`, after `DeleteProject` (`ProjectPage.tsx:422`), drawn above 900 px only (plan ruling `shortcuts-button-wide`); `sheetOpen` state
  and the opener element (focused again when the sheet closes if it is still drawn, meaning `isConnected` and `getClientRects().length > 0`, the test `closeCompare` (`:397-401`) uses for the two Compare modes buttons; else the Shortcuts button if drawn; else the selected tab, `.tabs [aria-selected="true"]`); one bubble `keydown` listener on `document`, skipped while `project === null` (still loading: no tabs or search are drawn, and the automatic opening has not decided yet), `settingsOpen` (this also covers a drawer that opened by itself with the focus in its Make search), `sheetOpen` or any `[aria-modal="true"]` exists, acting on
  `shortcutOf(e, e.target instanceof HTMLElement ? e.target : null)` (an SVG target, such as a focused Flow box, is never typing): tab → `location.hash = \`#${PROJECT_TABS[i].id}\`` and a `focusTab` ref focused in a layout effect after the switch; search → `preventDefault()`, then
  `pickTarget()` (`ProjectPage.tsx:325-328`, the banner hint's handler): below 900 px it calls `openSettings('search')` (`:293-296`), whose
  `focusOnOpen` ref (`:288`) the drawer's layout effect (`:305-312`) honours, putting the focus in the Make search through `focusSearch()`
  (`:298-304`) instead of Close settings; wider, `focusSearch()` focuses the search and scrolls it into view. Since the handler is skipped
  while the drawer is open, `pickTarget`'s `!settingsOpen` test always holds here. Add no `focusSearch` ref (that name is the base's
  function, and `focusOnOpen` already does the ref's job) and no second way to find the search: the Make search keeps its default
  placeholder, which `focusSearch()` finds it by, and the `shortcut` prop only adds `aria-keyshortcuts="/"`; fit / pipes → `preventDefault()` and click `.tab-panel [aria-keyshortcuts~="F"]` / `~="P"` when present; sheet → open it.
  Every hook this task adds (`sheetOpen`, the `focusTab` ref, the keydown effect, `refocusAside`) goes with the other hooks above the early
  return (`:403`), as the base's drawer and Compare hooks do. The Compare hooks now end with `main`'s layout effect that tells the card
  the project's target (`:389-392`, `68c06c1`); it moves no focus and needs no order against these: a target picked in the search that
  `/` focused leaves the focus in that search while an open card drops its columns, and a sheet opened from a column's "Use this mode"
  that a target change then removes gives the focus back by the rule above (the Shortcuts button, else the selected tab).
  R46 (plan ruling `aside-refocus`):
  1. The aside (`:440`, which already has `ref={settingsPanel}`) takes `tabIndex={-1}`. Reuse `settingsPanel`; add no second ref.
  2. Add `const refocusAside = useRef<Element | null>(null)`.
  3. In `onWidth` (`:363-365`), in its `!narrow.matches` case and before `setSettingsOpen(false)`: set `refocusAside.current` to
     `document.activeElement` when `settingsPanel.current` contains it, else to null.
  4. In the layout effect (`:305-312`), after the `refocusToggle` branch: if `refocusAside.current` is set and that element is no longer
     drawn (`!el.isConnected || el.getClientRects().length === 0`, which in practice is the drawer-only Close settings button), focus
     `settingsPanel.current`. Then set `refocusAside.current = null`.
  5. A Make search focused by the auto-open or by `/` is still drawn beside the views and keeps the focus (`drawer.spec.ts:578-615`, through
     the base's `onWidth()` look at `:367`).
  6. Comment `:356-357`: replace "and, as for any widening, leaves the focus where it is (on the search, which sits beside the views then),
     not on a Settings button that is not drawn." with "and leaves the focus where it is when that is still drawn (on the search, which sits
     beside the views then), never on a Settings button that is not drawn (R46)."

  R47, with R46: in the drawer comment `ProjectPage.tsx:273-280`, keep the last two lines (the Make-picker fix's "It opens into its Close
  button when the Settings button opens it, and into the item search when the page opens it to pick what to make (below)…"). Lines
  `:275-277`, from "Every way out, Escape, a click on the dimmed page, its Close button or the Settings button, goes through
  `closeSettings`, which gives the focus back to the Settings button. A window that grows past 900 px closes it too, without moving the
  focus: the column is beside the views again and the button is not drawn." become: "Every way out, Escape, a click on the dimmed page or
  its Close settings button (the Settings button sits in the inert head while it is open), goes through `closeSettings`, which gives the
  focus back to the Settings button. A window that grows past 900 px closes it too: the column is beside the views again and the button is
  not drawn, so the focus stays where it is, unless what has it is no longer drawn (the Close settings button, which only the drawer
  draws); then the column itself takes it (R46)."
- `styles.css` after `:472`: `.shortcut-list { display: grid; grid-template-columns: auto 1fr; gap: 8px 12px; margin: 0; }`, `.shortcut-list > div { display: contents; }`,
  `.shortcut-list dt { display: flex; align-items: center; gap: 4px; }`, `.shortcut-list dd { margin: 0; align-self: center; }`, and the `kbd` rule of Step 1 (`display: inline-grid; place-content: center; min-width: 28px; padding: 0 6px`);
  and, inside the drawer's `@media (max-width: 900px)` block (`styles.css:1369-1389`), right after `.project-head > .compare-toggle { display: none; }`
  (`:1377`), a rule of its own: `.project-head > .shortcuts-open { display: none; }` (Step 1's contract).
- Docs (R44, R47): the Phase 1 spec `:395-397` drops `(aria-pressed)` (on `:396`; the label says what a press does), and in `:291-296` the
  words "a click on the dimmed page, Close and the Settings button all close it" (`:294-295`) become "a click on the dimmed page and Close
  all close it"; its Make-picker paragraph `:297-303` stays. The Phase 1 plan's R31 line notes "R44 dropped `aria-pressed`; the label changes".

- [ ] **Step 5: Run everything** — `npm test` → PASS; `npm run e2e` → PASS (no existing spec presses a shortcut key where one could act: they
  press Tab, Shift+Tab, Escape, Enter and ArrowDown, and `drawer.spec.ts:315` types `Iron Ingot` into the Make search of a drawer that
  opened by itself — a typing target in an open drawer, which the handler skips both as typing and while `settingsOpen`, and none of its
  keys is F, P, /, ? or a digit; `objectives.spec.ts:126` and `:199` `fill` the item search, which presses no key). Also watch
  `drawer.spec.ts:503-546` and `objectives.spec.ts:75-106` (the 36 px head at 800 px). Then
  measure the head at 901 × 900 with the Compare modes and Shortcuts buttons, the badge live: one row; if it wraps, report it as a ruling
  before committing.

- [ ] **Step 6: Review shots** — label `11`, both looks: append the sheet open and the project head with its Shortcuts button (a 1440
  shot; the 800 shots show the head without it); against `Phase2Feedback.dc.html:195-202`.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e docs/superpowers/specs/2026-10-22-machine-gui-restyle-design.md docs/superpowers/plans/2026-10-23-machine-gui-restyle-phase1.md
git commit -m "feat(client): keyboard shortcuts and their sheet; Pause pipes drops aria-pressed (R44), the drawer keeps the focus when the window widens (R46)" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 12: Goods ride the Flow pipes (the spike first)

**Files:**
- Scratch (the spike, not committed): `$P2/spike/spike.html`, `$P2/spike/run.mjs`
- Modify: `src/client/views/pipe-motion.ts` (after `:30`), `src/client/views/FlowView.tsx` (imports, a `FlowRiderShape`, the layer between `:599-601` and `:602`), `src/client/styles.css` (keyframes after `:106`, `@keyframes pipe-pulse`; the rider rules after `:794`, `.flow-canvas.many-edges .flow-edge:not(.hl) .flow-edge-flow`)
- Modify: `tests/client/pipe-motion.test.tsx`, `tests/client/flow-pipes.test.tsx`, `tests/client/styles-contract.test.tsx` (`KEYFRAMES`, `:2238-2241` deliberate), `tests/e2e/pipes.spec.ts`, `tests/e2e/fixtures/plans.ts`

**Interfaces:**
- Consumes: `pipeSeconds`, `PIPE_ANIMATION_LIMIT`, `useItemIcon(key, 16)`, `hashColor`, `focusSets`, `prefersReducedMotion()`, `FLOW_RULES`, `PHASE2_RULES`, `openWithPlan`, `expectDashesMove`'s pattern.
- Produces:
  - The rulings `rider mechanism` (CSS `offset-path`, or SMIL) and `WebKit glide` (whether a WAAPI `transform` on `<g transform>` ends on the attribute in Chromium and WebKit; Task 13a's `canGlide()` feature-detects it either way, P2-D46), numbered in the ledger when they are made.
  - `pipe-motion.ts`: `RIDER_LIMIT = 150`, `RIDER_SIZE = 12`, `pathLength(points: ReadonlyArray<readonly [number, number]>): number`, `riderSeconds(length: number, perSecond: number, fluid: boolean): number`, `riderPhase(id: string): number`,
    `riderEdges<E extends { id: string; perSecond: number; points: Array<[number, number]> }>(edges: readonly E[], lit: ReadonlySet<string> | null, missing: ReadonlySet<string>, limit?: number): E[]`.
  - `FlowView.tsx`: `export function FlowRiderShape(props: { edge: PlacedEdge; lit: boolean | null }): ReactElement`; the layer `<g className="flow-riders" aria-hidden="true">`.
  - `fixtures/plans.ts`: `manyEdges(): Plan` (one assembler `big` taking 201 bought goods `t:g0@0` … `t:g200@0`: 202 arrows).

- [ ] **Step 1: The spike, no commit**

`$P2/spike/spike.html`: an `<svg width="400" height="300">` holding `<g transform="translate(40 30) scale(2)">` with `path#p d="M 0 0 L 100 0 L 100 50"` and an `<image id="r" x="-6" y="-6" width="12" height="12" href="data:image/png;base64,…(1 × 1)"
style="offset-path: path('M 0 0 L 100 0 L 100 50'); offset-rotate: 0deg">`, and a second `<g id="g" transform="translate(10 20)"><rect width="1" height="1"/></g>`. `$P2/spike/run.mjs`
(Playwright from the worktree, `chromium` and `webkit`; run `npx playwright install webkit` if `webkit.launch()` reports no revision): (a) at `offset-distance` `0%` and `100%` the image's rect
centre equals `p.getPointAtLength(0)` and the end mapped through `p.getScreenCTM()`, ±0.5 px; (b) `g.animate([{ transform: 'translate(0px, 0px)' }, { transform: 'translate(40px, 80px)' }], { duration: 1000, fill: 'none' })`,
`pause()`, `currentTime = 500`: the rect is at the svg's (20, 40); after `cancel()` at (10, 20). Record the four results as the rulings `rider mechanism` (both engines pass (a) → branch A, CSS; else branch B, SMIL) and `WebKit glide`.

- [ ] **Step 2: Write the failing unit tests**

`pipe-motion.test.tsx`:

```ts
it('measures an orthogonal route', () => expect(pathLength([[0, 0], [30, 0], [30, 40]])).toBe(70));
it('rides four times as fast as the dashes, within 1.2–12 s', () => {
  expect(riderSeconds(640, 1, false)).toBe(10); expect(riderSeconds(320, 100, false)).toBe(2.5);
  expect(riderSeconds(64, 1, false)).toBe(1.2); expect(riderSeconds(0, 1, false)).toBe(1.2); expect(riderSeconds(1280, 1, false)).toBe(12);
});
it('staggers riders by a stable phase of the edge id', () => {
  expect(riderPhase('e1')).toBe(riderPhase('e1')); expect(riderPhase('e1')).not.toBe(riderPhase('e2'));
  for (const id of ['e1', 'a|out|t:x@0->b|in|t:x@0', '']) { expect(riderPhase(id)).toBeGreaterThanOrEqual(0); expect(riderPhase(id)).toBeLessThan(1); }
});
it('rides no pipe from a missing source or of no length, lit ones first, then the biggest, at most 150', () => {
  const e = (id: string, perSecond: number, points: Array<[number, number]> = [[0, 0], [10, 0]]) => ({ id, perSecond, points });
  expect(riderEdges([e('a', 1), e('m', 5), e('z', 9, [[0, 0], [0, 0]]), e('b', 3)], new Set(['a']), new Set(['m'])).map((x) => x.id)).toEqual(['a', 'b']);
  expect(riderEdges(Array.from({ length: 180 }, (_, i) => e(`e${i}`, i)), null, new Set())).toHaveLength(RIDER_LIMIT);
  const many = Array.from({ length: 201 }, (_, i) => e(`e${i}`, 1));
  expect(riderEdges(many, null, new Set())).toEqual([]); expect(riderEdges(many, new Set(['e7']), new Set()).map((x) => x.id)).toEqual(['e7']);
});
```
`flow-pipes.test.tsx`: `'draws a rider as a 12 px image that rides its pipe, and a placeholder until its icon loads'` — `renderToStaticMarkup(<svg><FlowRiderShape edge={edge} lit={null} /></svg>)` (node: no icon URL) is
`<rect class="flow-rider placeholder item" x="-6" y="-6" width="12" height="12" fill="rgb(${hashColor('t:iron_ingot@0').join(', ')})" style="offset-path:path(&#x27;M 0 0 L 40 0&#x27;);--rider-dur:1.2s;animation-delay:-<riderPhase('e1') × 1.2, in hundredths>s">`
(`hashColor` from `src/shared/types/assets.ts:133`)
(branch A; branch B: an `<animateMotion path="M 0 0 L 40 0" dur="1.2s" repeatCount="indefinite" begin="-…s">` child and no style); `lit: true` adds ` hl`, `false` ` dim`; `FlowEdgeShape`'s pins stay.
Contract (branch A): `KEYFRAMES` gains `'pipe-ride': ['offset-distance']` (comment: a deliberate exception, like `pipe-flow`); `.flow-rider` `offset-rotate: 0deg`, `animation: pipe-ride var(--rider-dur, 3s) linear infinite`,
`pointer-events: none`, `image-rendering: pixelated`; `.flow-canvas.dragging .flow-rider, .flow-canvas.pipes-paused .flow-rider, .flow-rider.dim` `[['animation-play-state', 'paused']]`, positioned after `.flow-rider` (whose `animation` shorthand resets the play state);
`inQuery('@media (prefers-reduced-motion: reduce)', '.flow-rider')` `[['display', 'none']]`; `:2238-2241` (deliberate, P2-D45) → `[CONTENTS, LIT_CONTENTS, CONN_CONTENTS, '.flow-rider'].sort()`; no
`drop-shadow` (`:1290` holds); the selectors join `FLOW_RULES` and `PHASE2_RULES`. Branch B: `.flow-rider` `pointer-events: none` and `image-rendering: pixelated`, `.flow-rider.dim` `display: none`,
the same reduced-motion rule, no `pipe-ride`, the CSS endless list stays the three pipe rules, and a source guard takes the fourth's
place: across `src/client` (a `readdirSync` walk as Task 10's guard) `repeatCount="indefinite"` occurs once, in `FlowRiderShape`, so the
riders are the only endless SMIL (spec §3.3).

- [ ] **Step 3: Write the failing e2e** — `pipes.spec.ts` (`openWithPlan(page, circuitLv())`):
- `'goods ride the flow pipes, attached, and never take the pointer'` — branch A: the first `.flow-rider`'s `animationName` `pipe-ride` and its `offsetDistance` changes within 2 s while attached
  (`expectDashesMove`'s poll); branch B: `svg.flow-canvas` `animationsPaused()` false and the rider's rect moves within 2 s. Both: `document.elementFromPoint(<the rider's centre>)` has no `flow-rider`
  class; `.flow-rider` count ≤ `.flow-edge:not(.missing)` count.
- `'reduced motion stills the pipes'` (`:137-145`) also expects `.flow-rider` to compute `display: none` (branch A) or count 0 (branch B).
- `'a drag stops the flow pipes until it ends'` and `'a Pause pipes button stops …'` also read the riders: `animationPlayState` `paused` (A) or `animationsPaused()` true (B).
- `'above 200 arrows only the lit pipes carry goods'` (F8) — `openWithPlan(page, manyEdges())`: `svg.flow-canvas` `toHaveClass(/\bmany-edges\b/)`, `.flow-rider` count 0;
  `getByLabel('Find item').selectOption('t:g0@0')` → `.flow-rider` count 1.

- [ ] **Step 4: Run them to see them fail** — `npx vitest run tests/client/pipe-motion.test.tsx tests/client/flow-pipes.test.tsx tests/client/styles-contract.test.tsx` → FAIL.

- [ ] **Step 5: Implement** — `pipe-motion.ts`: `riderSeconds` = `length / 64 × pipeSeconds(perSecond, fluid)` clamped to 1.2–12, in hundredths; `riderPhase` = FNV-1a 32-bit of the id / 2³²;
  `riderEdges` as spec §15.2's doc comment (Step 2's cases). `FlowView.tsx`: `FlowRiderShape` calls
  `useItemIcon(edge.key, 16)` and draws spec §15.3's `<image>` (or the placeholder `<rect>`, fill `rgb(desc?.fallbackColor ?? hashColor(key))`), classes `flow-rider`, `fluid`/`item`, `hl`/`dim`,
  delay = `riderPhase(id) × seconds` in hundredths; `FlowCanvas` draws the layer between the edges and the nodes from
  `useMemo(() => riderEdges(layout.edges, sets?.edges ?? null, missingIds), [layout, sets])` (`missingIds` = edges from a `missing` box). Branch B also: no riders when `prefersReducedMotion()`, and an
  effect on `[dragging, pipesPaused]` calling `svgRef.current.pauseAnimations()` / `unpauseAnimations()`. `styles.css`: branch A's rules of spec §15.3 after `:794`, its
  `@media (prefers-reduced-motion: reduce) { .flow-rider { display: none; } }` a block of its own right after them (the global block at `:107-112` stays as it
  is: `:164-170` reads it); branch B's per Step 2. `fixtures/plans.ts`: `manyEdges()` with `planOf`, `step`, `flow`, `mined` (`names` fall back to keys).

- [ ] **Step 6: Run everything** — `npm test` → PASS; `npm run e2e` → PASS (`flow-focus.spec.ts:52` counts no `.dim` once the focus clears: riders lose `dim` with it; `connections.spec.ts:71` unaffected: riders are Flow-only).

- [ ] **Step 7: Review shots** — label `12`, both looks; and a 5 s screen recording of Flow (riders move from output to input, under the boxes at the flanges, under the lit tags).

- [ ] **Step 8: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(flow): goods ride the pipes, one per arrow, stopped with the pipes" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13a: The diagrams glide — pan and zoom

**Files:**
- Create: `src/client/views/glide.ts`, `tests/client/glide.test.tsx`, `tests/e2e/glide.spec.ts`
- Modify: `src/client/state/motion.ts`; `src/client/views/FlowView.tsx` (`centre` `:415-420`, the view effects `:423-437`, wheel `:443-448`, `fit`/`zoomCentre` `:466-467`, drag `:506-525`, the pan group `:595`); `src/client/views/ConnectionsView.tsx` (`fit` `:227-235`, wheel `:258-271`, drag `:273-302`, keys `:313-318`, Fit `:323`, the pan `<g>` `:350`)
- Modify: `tests/e2e/helpers.ts`, `tests/e2e/pipes.spec.ts:24-46` (`loosePipeEnds` moves to helpers), `tests/client/styles-contract.test.tsx`

**Interfaces:**
- Consumes: `prefersReducedMotion()`, the `WebKit glide` ruling, `openWithPlan`, `openConnections` (Task 3b), `circuitLv`.
- Produces:
  - `motion.ts`: `GLIDE_MS = 260`, `PAN_MS = 250`, `EXIT_MS = 180`, `EASE_OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)'`, `EASE_IN = 'cubic-bezier(0.4, 0, 1, 1)'`.
  - `glide.ts`: `interface PanView { x: number; y: number; scale: number }`, `PAN_ANIMATION_ID = 'pan'`, `panTransform(v: PanView): string` (`translate(${x}px, ${y}px) scale(${scale})`),
    `matrixView(css: string): PanView | null` (`matrix(a, 0, 0, a, e, f)` → `{ x: e, y: f, scale: a }`, `none` → null), `canGlide(): boolean`, `glideView(g: SVGGElement, from: PanView, to: PanView): Animation | null`,
    `viewOnScreen(g: SVGGElement): PanView | null`, `stopPan(g: SVGGElement): void`.
  - The Flow pan group `<g className="flow-pan" ref={panRef} transform=…>`.
  - e2e `helpers.ts`: `finishMotion(page: Page): Promise<void>`, `loosePipeEnds(page: Page): Promise<{ loose: string[]; pipes: number }>` (moved; calls `finishMotion` first).

- [ ] **Step 1: Write the failing tests**
- `glide.test.tsx`: `panTransform({ x: 16, y: 20.5, scale: 0.9 })` `'translate(16px, 20.5px) scale(0.9)'`; `matrixView('matrix(0.9, 0, 0, 0.9, 16, 20.5)')` `{ x: 16, y: 20.5, scale: 0.9 }`;
  `matrixView('none')` null; in node `canGlide()` false (no `Element`) and `glideView` returns null.
- Contract `'keeps the glide\'s numbers the stylesheet\'s, and adds no transition to the boxes'`: `` `${GLIDE_MS}ms` `` = `--dur-slow`, `` `${EXIT_MS}ms` `` = `--dur-exit`, `EASE_OUT` = `--ease-out`,
  `EASE_IN` = `--ease-in`, `PAN_MS` 250; `declarations(ruleBody(FADES))` exactly `[['transition', 'opacity var(--dur-base) var(--ease-out)']]`; no rule whose
  selector names the class `flow-pan` or `conn-pan` whole (`/\.(?:flow|conn)-pan(?![\w-])/`: `.flow-panel` is not one) declares `transform` (`:1517-1518` holds).
- `tests/e2e/glide.spec.ts` — an `addInitScript` wraps `Element.prototype.animate` to push `{ cls, node, duration, delay, fill, frames }` into `window.__animations`
  (`cls` the element's `class`, `node` its `data-node-id`, `data-edge-id` or `data-node`, else `null`; `delay` 0 when not given),
  and every case skips the records of `canGlide()`'s probe (class `glide-probe`); every Flow case first drags the canvas by (100, 60) (instant) so that Fit has somewhere to go:
1. `'Fit pans over 250 ms, its attribute already final'` — `openWithPlan(page, circuitLv())`, click Fit: one record on `g.flow-pan` (`duration: 250`, `fill: 'none'`, last frame `panTransform` of the attribute);
   the attribute read at once equals the one after `finishMotion`; then `rect.flow-node-box` width on screen / its `width` attribute ≈ the attribute's scale (±0.01).
3. `'under reduced motion Fit and the zoom buttons move at once'` — no record; `document.getAnimations()` holds no finite one.
4. `'a wheel turn during a Fit leaves no pan running'` — click Fit, `mouse.wheel(0, -100)` over the svg → `g.flow-pan` `getAnimations()` length 0.
5. `'Connections\' Fit glides, its attribute final at once'` — `openConnections(page)`, drag, click Fit: a record on `g.conn-pan` of 250 ms; the attribute read at once is the fitted one (as `connections.spec.ts:45-46` parses it).
6. `'a drag that starts while Fit pans carries on from the picture on screen'` (Review Focus 1) — in one `page.evaluate`: click Fit, `await new Promise(requestAnimationFrame)`, pause the pan at `currentTime = 125`,
   return `getComputedStyle(g).transform`, which the spec parses with `matrixView` imported from `../../src/client/views/glide.ts` (the
   page has no such function); then drag from the svg's (`box.x + 6, box.y + 6`) by (40, 20) (a drag may start anywhere, `FlowView.tsx:506-525`): the attribute's translate is the paused one + (40, 20) (±0.5), and no pan runs.
`helpers.ts`: `finishMotion` (spec §16.4: `.finish()` every animation whose `endTime !== Infinity`); `loosePipeEnds` moved, `finishMotion` first.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/client/glide.test.tsx tests/client/styles-contract.test.tsx` → FAIL; `npm run e2e -- tests/e2e/glide.spec.ts` → FAIL.

- [ ] **Step 3: Implement**
- `glide.ts`: `canGlide()` — memoised: false without `Element.prototype.animate`, else the spike's (b) probe on an off-screen svg (a `<g class="glide-probe">` at translate(10 20); a paused WAAPI translate from (0, 0) to (40, 80) at 500 of 1000 ms
  puts the rect at (20, 40), and after `cancel()` at (10, 20)); P2-D46: false means instant moves, no SMIL. `glideView` returns null under `prefersReducedMotion()`, then for equal views, then
  `!canGlide()` — in that order, so the probe never runs under reduced motion or when nothing would move — else
  `g.animate([{ transform: panTransform(from) }, { transform: panTransform(to) }], { duration: PAN_MS, easing: EASE_OUT, fill: 'none', id: PAN_ANIMATION_ID })` — absolute keyframes, never an implicit end;
  `viewOnScreen` reads `matrixView(getComputedStyle(g).transform)` while `g.getAnimations()` holds the `PAN_ANIMATION_ID` one, playing or paused, else null; `stopPan` cancels it.
- `FlowCanvas`: `panRef`, `className="flow-pan"`; `toPan` maps its `{ x, y, zoom }` view to `{ x, y, scale: zoom }`; `glideTo(next: View | ((v: View) => View))` takes `from = viewOnScreen(g) ?? toPan(view)`, stops the pan, keeps `from` in a `pendingGlide` ref and calls
  `setView(next)`; a `useLayoutEffect(…, [view])` starts `glideView(g, from, toPan(view))` and clears the ref; `fit`, `zoomCentre`, `centre` (reveals and `centreNext`) and the `viewKey` reset after the first
  mount use `glideTo` (the first mount stays instant: `flow-focus.spec.ts:33-35`). Wheel and drag first commit `viewOnScreen(g)` into the view and stop the pan; the drag's `ox`/`oy` come from that view.
- `ConnectionsView` `Picture`: `fit(glide = false)`; the Fit button calls `fit(true)` through the same `glideTo` pattern on `g.conn-pan` (`{ x, y, k }` ↔ `{ x, y, scale: k }`); the shape refit, the resize refit,
  the arrow keys, the wheel and the drag stay instant and first commit a running pan.

- [ ] **Step 4: Run everything** — `npm test` → PASS; `npm run e2e` → PASS (`pipes.spec.ts` "every flow pipe…" after Fit and 8 × Zoom in now finishes motion first; `flow-focus.spec.ts` (2), (3), (7), `reuse`, `plan`,
  `connections.spec.ts:44-112` read the final attribute or wait for stable boxes — nothing loosened).

- [ ] **Step 5: Review shots** — label `13a`; a screen recording of Fit, + and − and a Find item reveal in Flow, and Fit in Connections (each 250 ms, wheel and drag instant).

- [ ] **Step 6: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(client): Fit, the zoom buttons and reveals pan in 250 ms; wheel and drag stay instant" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 13b: The diagrams glide — a new layout

**Files:**
- Modify: `src/client/views/flow-model.ts` (after `centreOn` `:909-913`), `src/client/views/glide.ts`, `src/client/views/FlowView.tsx` (`FlowCanvas` `:390-609`), `src/client/views/ConnectionsView.tsx` (`Picture` `:205-357`), `src/client/styles.css` (after `:799`, `.flow-edge-tag text`)
- Modify: `tests/client/flow.test.tsx`, `tests/client/styles-contract.test.tsx`, `tests/e2e/glide.spec.ts`, `tests/e2e/helpers.ts` (F7)

**Interfaces:**
- Consumes: `GLIDE_MS`, `EXIT_MS`, `EASE_OUT`, `EASE_IN`, `canGlide()`, `prefersReducedMotion()`, `panRef`, the rider layer, `finishMotion`, `loosePipeEnds`, `platesTwoWays`.
- Produces:
  - `flow-model.ts`: `interface LayoutChange { moved: Array<{ id: string; from: [number, number]; to: [number, number] }>; entered: string[]; left: string[]; rerouted: string[] }`;
    `interface PlacedPicture { nodes: ReadonlyArray<{ id: string; x: number; y: number }>; edges: ReadonlyArray<{ id: string; points: ReadonlyArray<readonly [number, number]> }>; groups?: ReadonlyArray<{ id: string; x: number; y: number }> }`
    (FlowLayout and ConnLayout both fit); `layoutChange(before: PlacedPicture | null, after: PlacedPicture): LayoutChange`; `GLIDE_LIMIT = 200`; `glidable(change: LayoutChange): boolean` (`change.moved.length <= GLIDE_LIMIT`).
  - `glide.ts`: `interface GlideTargets { boxes: readonly string[]; edges: string; extra?: string }`; `glideLayout(root: SVGGElement, change: LayoutChange, targets: GlideTargets): void`; `FADE_IN: Keyframe[]` (`[{ opacity: 0, offset: 0 }]`).
  - CSS `.flow-ghost`, `.flow-ghost-box` and its kind fills.

- [ ] **Step 1: Write the failing tests**
- `flow.test.tsx`, `describe('what a new layout changed')`:

```ts
const at = (nodes: Array<[string, number, number]>, edges: Array<[string, Array<[number, number]>]> = [], groups: Array<[string, number, number]> = []): PlacedPicture =>
  ({ nodes: nodes.map(([id, x, y]) => ({ id, x, y })), edges: edges.map(([id, points]) => ({ id, points })), groups: groups.map(([id, x, y]) => ({ id, x, y })) });
it('reports the boxes that moved, came and went, and the arrows that changed', () => {
  expect(layoutChange(at([['a', 0, 0], ['b', 10, 0], ['g', 5, 5]], [['e', [[0, 0], [10, 0]]], ['f', [[1, 1], [2, 2]]]]), at([['a', 0, 0], ['b', 20, 0], ['c', 0, 50]], [['e', [[0, 0], [20, 0]]], ['f', [[1, 1], [2, 2]]], ['h', [[0, 0], [0, 50]]]], [['line:x', 0, 0]])))
    .toEqual({ moved: [{ id: 'b', from: [10, 0], to: [20, 0] }], entered: ['c', 'line:x'], left: ['g'], rerouted: ['e', 'h'] });
});
it('animates nothing for the same layout again (every SSE refetch), or for a first one', () => {
  const same = at([['a', 1, 2]], [['e', [[0, 0], [1, 1]]]]);
  expect(layoutChange(same, at([['a', 1, 2]], [['e', [[0, 0], [1, 1]]]]))).toEqual({ moved: [], entered: [], left: [], rerouted: [] });
  expect(layoutChange(null, same)).toEqual({ moved: [], entered: [], left: [], rerouted: [] });
});
it('glides a change of up to 200 moved boxes, and snaps a bigger one', () => {   // Review Focus 4
  const moved = (n: number): LayoutChange => ({ moved: Array.from({ length: n }, (_, i) => ({ id: `n${i}`, from: [0, 0], to: [1, 0] })), entered: [], left: [], rerouted: [] });
  expect(GLIDE_LIMIT).toBe(200); expect(glidable(moved(200))).toBe(true); expect(glidable(moved(201))).toBe(false);
});
```
- Contract `'lets a removed box\'s ghost take no pointer'`: `.flow-ghost` `pointer-events: none`; `.flow-ghost-box` `stroke-width: 2`; the selectors join `FLOW_RULES` and `PHASE2_RULES`; `FADES` unchanged.
- `glide.spec.ts`:
2. `'a replan glides the boxes that moved, and every pipe ends on its flange after'` — `let served = circuitLv()` behind `page.route('**/api/projects/*/plan', (r) => r.fulfill({ json: served }))`; read each
   `[data-node-id]`'s `transform` attribute; `served = platesTwoWays()`; post `{ op: 'settings', patch: { amount: 31 } }` through the API (its SSE `plan` event makes the page refetch); wait for 4 `[data-step-id]`;
   at least one node is in both readings with a changed attribute (the hand step shifts the line, so the case is not vacuous), and every such node has a
   recorded `transform` animation of `duration: 260`, `fill: 'none'`, whose last frame's translate equals its new attribute's; the entered
   `hammer-plate` box has an `opacity` record (`node: 'hammer-plate'`) of `duration: 260` whose frames are exactly `[{ opacity: 0, offset: 0 }]`
   (a fade in: its own opacity is the implicit end), and every record whose `cls` starts `flow-edge` has those frames with `delay: 130`,
   `duration: 130`, `fill: 'backwards'`; `finishMotion`; `(await loosePipeEnds(page)).loose` `[]`.
3. (the replan half) `'under reduced motion a replan moves at once'` — the same replan records no animation, and no `.flow-ghost` appears.
F7: `loosePipeEnds` matches each pipe end against its own ports' flanges, `[data-port="<port>"] > rect.flow-port` with the ports split from its `data-edge-id` (`<fromPort>-><toPort>`).

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/client/flow.test.tsx tests/client/styles-contract.test.tsx` → FAIL.

- [ ] **Step 3: Implement the model and the Flow glide**
- `layoutChange`: boxes are `nodes` and `groups` by id; its lists in the `after` order (`left` in `before`'s); Step 1's cases fix the rest.
- `glideLayout`: nothing under `prefersReducedMotion()`, then `!glidable(change)`, then `!canGlide()` (that order: the probe never runs for nothing); each moved box (found by `[${attr}="${CSS.escape(id)}"]` over `targets.boxes`) gets
  `[{ transform: \`translate(${fx}px, ${fy}px)\` }, { transform: \`translate(${tx}px, ${ty}px)\` }]` over `GLIDE_MS`, `EASE_OUT`, `fill: 'none'`; each entered box `FADE_IN` over `GLIDE_MS`,
  `EASE_OUT`, `fill: 'none'` — its one keyframe at offset 0, so the box's own opacity is the implicit end and a box that enters under a focus ends at its `.dim` 0.18 (a lone keyframe
  without an offset is an end keyframe, which would fade the box out); each rerouted arrow (`targets.edges`), and `targets.extra` when any arrow rerouted, `FADE_IN` with `delay: GLIDE_MS / 2`,
  `duration: GLIDE_MS / 2`, `fill: 'backwards'` (invisible through the first half, then fading in).
- `FlowCanvas`: `placedBefore = useRef<FlowLayout | null>(null)`; a `useLayoutEffect(…, [layout])` (before paint) computes `layoutChange(placedBefore.current, layout)`, calls
  `glideLayout(panRef.current, change, { boxes: ['data-node-id', 'data-group-id'], edges: 'data-edge-id', extra: '.flow-riders' })`, appends ghosts for `change.left` (only when there are any and motion is
  allowed: StrictMode's second run sees zero deltas) from the previous layout's boxes, and stores `layout`. Ghosts: state `Array<{ id: string; kind: FlowNodeKind; owned: FlowNode['owned']; x: number; y: number; width: number; height: number }>`,
  drawn just before the nodes as `<g className="flow-ghost <kind class>" aria-hidden="true" transform={\`translate(${x} ${y})\`}><rect className="flow-ghost-box" width={…} height={…} /></g>` (kind class:
  `owned` for owned and partly owned steps, `new` for new ones, else the stub's kind) — never `data-node-id`, `data-step-id`, `data-kind`, `data-port`, a role, a tabIndex, `hl`, `dim`, `rect.flow-port` or
  `rect.flow-node-box`; each fades with WAAPI `[{ opacity: 1 }, { opacity: 0 }]` over `EXIT_MS`, `EASE_IN`, `fill: 'forwards'`, and leaves the state on `finish`.
- `styles.css` after `:799`: `.flow-ghost { pointer-events: none; }`, `.flow-ghost-box { fill: var(--flow-raw); stroke: var(--flow-raw-line); stroke-width: 2; }`, and `.flow-ghost.owned > .flow-ghost-box`,
  `.new`, `.out`, `.import`, `.missing`, `.sink`, `.line` with their box tokens (`fill` and `stroke` as the matching `.flow-node.<kind> > .flow-node-box`).

- [ ] **Step 4: Glide Connections' new layout too** — `Picture`: the same `placedBefore` pattern on `[picture]` with `glideLayout(g, change, { boxes: ['data-node'], edges: 'data-edge' })`; no ghosts there
  (a commit of its own if the reviewer asks to split, spec §21 "Open decisions left to the builder").

- [ ] **Step 5: Run everything** — `npm test` → PASS; `npm run e2e` → PASS (the `[data-step-id]` counts, the `.dim` count and `loosePipeEnds` cannot see a ghost; the e2e routes serve the same plan on
  every refetch, which glides nothing).

- [ ] **Step 6: Review shots** — label `13b`; a screen recording of a replan (Make it here instead on Iron Ingot, `flow-focus.spec.ts` (7)'s flow): boxes glide 260 ms, new boxes fade in, removed ones fade out, pipes fade in over the second half.

- [ ] **Step 7: Commit**

```bash
git add src/client tests/client tests/e2e
git commit -m "feat(client): a new layout glides into place; removed boxes fade out as ghosts" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 14: Whole-app verification in both looks, and the docs as built

**Files:**
- Scratch: `$SCRATCH/shots-p2/final/`, `$P2/probe-motion.mjs`, `$P2/probe-contrast.mjs`, `$P2/probe-perf.mjs` (adapted from `$SCRATCH/t10/probe-motion.mjs`, `probe-contrast-fonts.mjs`, `probe-perf.mjs`, `REPO` the worktree)
- Modify: `README.md` ("Using the planner", `:36-52`), `docs/superpowers/specs/2026-10-22-machine-gui-restyle-design.md` (`:93-95`, `:152`, `:476`), `docs/superpowers/plans/2026-10-23-machine-gui-restyle-phase1.md` (`:30`, `:31-33`, `:53-54`), `docs/superpowers/specs/2026-10-24-machine-gui-phase2-design.md` (status, as-built notes), this plan ("As built")

**Interfaces:**
- Consumes: everything above; the rulings in the SDD ledger, the plan rulings among them.
- Produces: the report to the user and the docs as built.

- [ ] **Step 1: The suites** — `npm test` → PASS; `npm run e2e` → PASS; paste the summary lines. Read `git diff main -- tests/` (`main` contains `01da27d`, so the base's own deliberate edits — drawer.spec's `SETTINGS_BUTTON` and `TARGET`, compare-card.test's toggle, objectives.spec's head measured once the badge is live — are not in it): every changed or removed existing line is
  one of spec §3.9's rows; or the §3.5 rewrite of `contrast.test.tsx` (Task 1a: its old rows — the 155 of `contrast-phase1.json`: Phase 1's, the Make-picker fix's and add-on 17's —
  all in `PAIRS`, which the guard case against `contrast-phase1.json` proves; the calibration case and every reason case's `toBeLessThan` lines unchanged, the base's two
  cases among them); or R45's ring-rule string moved into `RING_RULE` (Task 6b, its value unchanged); or one of Task 2b's rows (spec §25's
  table: the contract's font rows of the figures, and a figure's text gaining `<span class="fig">` in `map-hover`, `view3d`, `map-summary`,
  `layout-map` and `connections-view`); or a helper moved to `tests/e2e/helpers.ts` /
  `tests/client/css-blocks.ts` (`openConnections`, `loosePipeEnds`, the scanner). Everything else is an addition.
- [ ] **Step 2: The screenshot tour in both looks** — `$P2/tour.mjs` at `1440 light final`, `1440 dark final`, `800 light final`, `800 dark final`; compare every screen with the mockups (`Phase2Project`,
  `Phase2Inventory`, `Phase2Feedback`, `DarkMode`, `Main`) and the light ones with Task 1a's `base-a` shots (`$P2/maskdiff.py`; the figures differ from those on purpose since Task 2b — spec §25,
  plan ruling `figures-vt323` — so they are compared with Task 2b's shots instead, and any figure still drawn in Pixelify outside a name is
  listed); the base's screens with no Phase 2 mockup
  (`51`, `51b`, `52`, `52b`, `53`, and `24`/`24b` at 800: the Compare card, Plan for and Farms, the narrow compare bar, the Settings button's target, the drawer that opens by
  itself; plan ruling `base-surfaces-dark`) go against the add-on 17 restyle's own shots in `$SCRATCH/addon17/` (`compare-open-1440x900.png`,
  `settings-plan-for-1440x900.png`, `settings-farms-1440x900.png`, `narrow-compare-bar-860x900.png`, `narrow-compare-open-860x900.png`) and the Make-picker fix's in
  `$SCRATCH/makefix/` (`1-new-project-drawer-auto-opened-800x900.png`, `2-target-picked-drawer-closed-800x900.png`), and their dark twins against `DarkMode.dc.html`'s
  palette, for legibility and the two accepted exceptions (the mode in use's ring, the farm line); list anything that still reads as old, and spec §1's deliberate departures separately.
- [ ] **Step 3: The motion pass** — `$P2/probe-motion.mjs` in headed Chromium, a video per screen: the logo plays 6 turns then rests; a tooltip enters after its 150 ms rest and leaves in 80 ms; the recipe arrow
  and the skeleton sheen run 3 times; a toast enters and leaves; the strip counts up and flashes; riders move; a replan glides; Fit, zoom and reveal pan; the theme cross-fades in ≤ 260 ms. Nothing the user waits
  for exceeds 300 ms. Again under `reducedMotion: 'reduce'`: nothing moves.
- [ ] **Step 4: Contrast** — the token-driven test passes for both looks; `$P2/probe-contrast.mjs` samples the rendered text/background pairs of every tour screen in a light and a dark context (translucent
  boxes composited over their real backdrop, as Phase 1's 126 pairs), with the base's screens added to the probe's own list (it is adapted from
  `probe-contrast-fonts.mjs`, whose list predates them): the Compare card open — its titles and "Updating…" on the panel, the tiles' label and value on their
  screen, the notes on their chat box composited over the panel, the open button on its face; Plan for's hints and the Tree Growth Simulator's fields; and at
  800 px the Settings button's readout and the drawer that opens by itself. Every text pair ≥ 4.5 and every graphic ≥ 3, or one of spec §4.5's accepted
  exceptions or the re-check's two (spec's closing §24; plan rulings `compare-frame-dark`, `farm-line-dark`);
  `npm run e2e -- tests/e2e/forced-colors.spec.ts tests/e2e/flow-boxes.spec.ts tests/e2e/recipe-card.spec.ts tests/e2e/materials-grid.spec.ts tests/e2e/skeletons.spec.ts`: their
  forced-colours cases cover every new graphic of spec §3.5 (the busy bar and the chips, the recipe arrow and the energy bar, the grid's slots, tick, meter and toggle, the busy line's arrow).
- [ ] **Step 5: Performance** — `$P2/probe-perf.mjs` Chrome traces: panning the 513-edge plan (lit riders only), the 199- and 241-edge plans (up to 150 riders), and a replan glide on the 241-edge plan. No long frame
  caused by the pipes, the riders or the glide; if riders cause one, lower `RIDER_LIMIT` first, then ride lit edges only above a lower edge count, and record the change as a ruling.
- [ ] **Step 6: The height budget** — on the iron-plate line at 1280 × 720 with the strip, the measured map canvas centre (report it) ≤ 700; and, with the badge live, the project head one row (36 px) at 1280 × 720 with the Compare modes and Shortcuts buttons, at 901 × 900, and at 800 × 900 with a long target name (report each).
- [ ] **Step 7: Keyboard only, both looks** — the Theme button; the shortcuts and the sheet; one tab stop per item in the grid; the confirms; the toasts' Undo; the base's ways in — the drawer that opens by itself into the item search on a narrow window, the banner's "Pick something to make", the Compare modes button and its card's Close (the focus back on the button that is shown); visible focus rings everywhere.
- [ ] **Step 8: VoiceOver smoke test** — tooltip descriptions on a focused Flow row; each toast announced once; the strip read as its final values only; the grid checkboxes; the drawer's status (R43): silent when it opens by itself for a project with no target, "The plan is updating…" while a plan is on its way.
- [ ] **Step 9: Docs as built** — README "Using the planner": the Theme button (Auto follows the OS, Dark, Light; this browser remembers it) and logo C (top bar, login, tab icon). The Phase 1 spec `:93-95` and `:476`,
  and the Phase 1 plan `:30` and `:53-54`: a "Superseded by Phase 2 (2026-10-24 spec §4): two looks, Auto by default" note at each; the Phase 1
  spec `:152` and the Phase 1 plan `:31-33` (where the pixel font draws readouts, chips and stack counts): a "Superseded by Phase 2 (2026-10-24
  spec §25): figures in VT323, words in Pixelify" note. The Phase 2 spec: status "approved and built"; an "as built" note where a
  ruling changed the design (the rulings `rider mechanism` and `WebKit glide`, the strip's fallbacks if any). This plan: an "## As built" section with every ruling of the
  ledger and the plan rulings (`baseline-shots`, `view-transition-split`, `motion-in-1b`, `pseudo-tier-chip`, and the re-checks'
  `base-surfaces-dark`, `compare-frame-dark`, `farm-line-dark`, `aside-refocus`, `shortcuts-button-wide`, `farm-step-readout`,
  `farm-step-card`, `p2-d44-landed`, `strip-figures`, `drawer-status-words`, `drawer-status-count`, `compare-skeletons`, and the VT323 ones,
  `figures-vt323`, `digits-token`, `digits-floor`, `digits-mixed`, `digits-sizes`, `compare-shrink-vt323`), one line each, and the decisions this plan made that the
  spec left open (no shared `browser-setting.ts`; the recipe card without the circuit slot or the main-output frame; no tips on the Theme button or the strip tiles; F7 and
  F8 done; Connections' re-layout glide in Task 13b, without ghosts).
- [ ] **Step 10: Commit the docs** — before the commit, replace every local scratch path in the two Phase 2 docs with
  `<the design session's scratchpad, not in the repo>`, as `47e35bc` did for the Phase 1 restyle docs: this plan's `$SCRATCH` definition
  (under Conventions) and the spec's `:14`, `:26` and `:38` (one line lower since its status names §25); `$SCRATCH` and `$P2` stay as names, and the "As built" additions name no new
  local path. Check: `grep -n '/private/[t]mp' docs/superpowers/plans/2026-10-24-machine-gui-phase2.md docs/superpowers/specs/2026-10-24-machine-gui-phase2-design.md`
  prints nothing (the bracket keeps the check from finding its own line in this plan).

```bash
git add README.md docs/superpowers/specs/2026-10-22-machine-gui-restyle-design.md docs/superpowers/plans/2026-10-23-machine-gui-restyle-phase1.md docs/superpowers/specs/2026-10-24-machine-gui-phase2-design.md docs/superpowers/plans/2026-10-24-machine-gui-phase2.md
git commit -m "docs: the Machine GUI restyle, phase 2, as built" -m "Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 11: Report** to the user with the final shots of both looks, the motion and performance findings, and the departures from the mockups (the figures in VT323, the user's choice of 2026-10-24, spec §25; the logo's 6 turns, finite sheen and arrows, one row per good,
  no Swap/3D buttons, two-line tiles, the opacity flash, `scaleX` arrows and meter, tips below the pointer); then superpowers:finishing-a-development-branch.

---

## Pre-flight conflict scan

The critic's scan of this plan against spec §20 (Verification) and §23 (Builder-check answers) and the code at `cfaa05b` (the CSS
scanner, the contract and contrast tests, FlowView, ConnectionsView, the e2e helpers and fixtures, the scratch scripts), re-checked against
`96e9e99` and then `main` `01da27d` (every anchor below is at `01da27d`; rows B1–B13 are the first re-check's, B14 the second's, V1–V10 Task 2b's, for spec §25), with the
task numbers of this plan; the last column says how the plan now settles each row that needed it.

| # | Tasks | Shared file / interface | Produced → consumed | Agree? | Note | Resolution |
|---|---|---|---|---|---|---|
| H1 | all | `styles.css` | each task adds its own region; only 1b writes dark blocks; 4, 5a, 6a append to the forced-colours block, 6b edits R42 | Yes | New rules go before the forced block. Task 12's rider block comes after the global reduced-motion block, which `ruleBody` reads first (`inQuery` scans every block with that prelude). | Forced rules repaint at the specificity of what they repaint (`.flow-busy.high .flow-busy-fill`, `.gt-arrow.on-chat .gt-arrow-fill`); no pseudo-element shares a list with a plain selector (R28: the grid's tick and meter, the disclosures) |
| H2 | 1a–13b | contract test (`css-blocks.ts`, `TOKENS`, `KEYFRAMES`, `FLOW_RULES`, `PHASE2_RULES`, `SAME_IN_BOTH`) | 1a moves the scanner, 1b defines `PHASE2_RULES`, `SAME_IN_BOTH` and `DARK_TOKENS`, the rest append | Yes | Each new keyframe matches its `KEYFRAMES` row. Every later literal is in `SAME_IN_BOTH`. | — |
| H3 | 1a → 1b, 3a, 4, 5a, 6a, 7, 9a, 11 | contrast `Pair`, `colour`, `PAIRS`, `AA`, `GRAPHICS` | 1a defines, the others append rows | Yes | Dark gap (finding 5) | 1a moves the reason cases' eight `>=` lines (Phase 1's five, the Make-picker fix's one, add-on 17's two) into `PAIRS`, run in both looks except the mode-in-use edge (light only); 1b adds the tick-well edge, text under the hover veil, the mode-in-use ring on the dark panel, the farm line in light, and the flange, 8 % white, dark mode-in-use edge and farm-line reasons |
| H4 | 1b → 3a, 4, 5a, 6a, 7, 8, 9a, 10, 11 | `theme.spec` `DarkStop`, `DARK_TOUR` | 3a, 5a, 6a, 8, 9a, 10, 11 add stops; 4 and 7 add rows to "the Flow tab" | Yes | 8 needs `close` (it exists). Timeout (finding 16) | One test per stop, each in a fresh dark context: no shared 30 s budget, no route leaking between stops |
| H5 | 1b, 3b, 13a, 13b | `tests/e2e/helpers.ts` | 1b adds `setTheme`, `openWithPlan` (default `LV_CIRCUITS`), `LV_CIRCUITS`, `SETTINGS_BUTTON`; 3b adds `openConnections`; 13a adds `finishMotion`, `loosePipeEnds`; 13b adds F7 | Yes | The local `openWithPlan` in pipes.spec and flow-focus stays and has a different signature. drawer.spec.ts keeps its own `SETTINGS_BUTTON` and `TARGET`. | — |
| P1 | 1a ↔ 1b | `themeTokens(…,'dark')` | reads `:root[data-theme='dark']`, which 1b adds | Yes | | — |
| P2 | 1a ↔ 3b, 8, 11, 13a, 13b | `ConnectionsView.tsx` | 1a :186; 3b :66-69, :103, :113-132; 8 :397-402; 11 :46, :323; 13a, 13b `Picture` | Yes | Separate regions | — |
| P3 | 1a ↔ 3b ↔ 11 | `connections-view.test.tsx` | 1a :183, :191, :196; 3b :119-124, :138, :259; 11 :49, :265, :269 | Yes | 11's new regex includes 3b's `data-tip` | 3b cites `:119-124` as the comment `:119-120` and the case `:122-124` in both places |
| P4 | 1a ↔ 14 | test-diff audit | 14's audit against 1a's contrast rewrite | Yes (was No) | Finding 4 | 14's audit names the §3.5 rewrite and R45's `RING_RULE` move; 1a's guard case proves all 155 pairs measured before Phase 2 (Phase 1's 142, the Make-picker fix's 1, add-on 17's 12; `contrast-phase1.json`) are still measured at their light colours, and the calibration case stays verbatim |
| P5 | 1b ↔ 2 | `index.html` | head script after `<title>`; favicon at :8 | Yes | Token string equals the favicon href (checked) | — |
| P6 | 1b ↔ 3a | `scaffold.test.tsx` | TopNav-end assertion; edit at :71 | Yes | | — |
| P7 | 1b ↔ 13a | `motion.ts` | `prefersReducedMotion`, then the glide constants | Yes | `EASE_OUT` and `EASE_IN` equal the `:root` values | Plan ruling `motion-in-1b` records the departure from spec §19's table |
| P8 | 1b → 3a–9a | tokens `--tip-mod`, `--flow-chip`, `--stack-*`, `--bevel-inset`, `--bevel-screen`, `--energy`, `--skeleton*`, `--sheen`, `--progress-base`, `--screen-lo` | defined with their dark values in 1b | Yes | Later tasks never edit the dark blocks | — |
| P9 | 2 ↔ 7 | `chrome.spec.ts` | brand case; strip-height case | Yes | | — |
| P10 | 3a, 3b → 4 | ItemIcon `tip={false}` (3a); node tag order, box rect first child (3b) | | Yes | 4 re-checks the class and no-hl/dim pins | — |
| P11 | 3a → 5a | ItemIcon `tip` lines | | Yes (was Partial) | Content contradicted §8.3 (finding 3) | The slots follow spec §8.3 and P2-D39: `name` is the good (`, not supplied in full` when short), `tip` the per-run amount, chance and rate lines |
| P12 | 3a → 6a | `data-tip`, `data-tip-mod`, `tipText`, `modName` | slot button carries the tip, icon has `tip={false}` | Yes | | — |
| P13 | 3a → 11 | trigger contract on Fit and Pause | "Fit · F", "Pause/Play pipes · P" | Yes | Button names unchanged | — |
| P14 | 3a ↔ 9a | `App.tsx` | TooltipHost after NamePrompt; Toasts after RoutePage | Yes | | — |
| P15 | 3a ↔ 11 | `SettingsPanel.tsx` | :267 `tip={false}`; :189 `shortcut` (the Make search only) | Yes | | — |
| P16 | 3b ↔ 12 | `flow-pipes.test`, `FlowView` | edge tag pin; riders in their own layer | Yes | | — |
| P17 | 3b, 4, 5a, 13b | `flow-model.ts`, `flow.test.tsx` | `route`; readout and metrics; recipe helpers; `layoutChange` | Yes | Separate regions | — |
| P18 | 4 → 5a | `tierSlug`, `.tier-<slug>` → `.badge.tier-chip` | | Yes (was No for pseudo machines) | Finding 22 | Plan ruling `pseudo-tier-chip`: `machineReadout` nulls the tier on a pseudo machine, and the card draws its chip only when `machineReadout(step).tier !== null` |
| P19 | 3a, 3b, 4, 5b, 8, 11, 12, 13a, 13b | `FlowView.tsx` | box icons' `tip={false}`; tips; node shape; panel wrapper; loading lines; toolbar; rider layer; pan and glide | Yes | Hook placement (finding 21) | 5b puts `sideRef`, `focusPanel` and their layout effect above `FlowDiagram`'s early return (`:655`) |
| P20 | 5a → 6a | `.stack-count` | | Yes | Parent `position: relative` not pinned | `.recipe-slot` and `button.mat-slot` are pinned `position: relative` |
| P21 | 5a → 8 | `GtArrow`, `.gt-arrow.on-chat` | 8's busy-line markup matches | Yes | | The forced rule names `.gt-arrow.on-chat .gt-arrow-fill`, whose own fill rule outranks a bare `.gt-arrow-fill`; skeletons.spec checks it in forced colours |
| P22 | 6a ↔ 8 | `MaterialsView.tsx` | `BuildSection` (`:114-145`); `:307` skeleton | Yes | add-on 17's `TakenItem` (`:254-267`) and its rows in `LeftOverSection` (`:269-303`, which calls `quantity`, which 6a moves) sit between them | — |
| P23 | 7 → 8 | `KeyNumbers.tsx` `.key-numbers-wait`, `key-numbers.test` | empty 52 px div, then the strip skeleton | Yes | 52 + 8 = 60, same as the strip | — |
| P24 | 3a, 7, 8, 9a, 9b, 11 | `ProjectPage.tsx` | 3a's banner-chip icon (`:183`); `.project-banners` (`:427-438`: KeyNumbers first, the open CompareCard last); the `:156` busy line and the aside's status after Close settings (`:442`); the drawer effect `:358-372` and the rename `:419` (9a); the delete `:422` and `sendLater` at `:467` (9b); the aside's tabIndex (`:440`), the tabs (`:449-463`), the head (`:414-423`) and `/` through `pickTarget` (`:325-328`) (11) | Yes (was Partly) | 8 and 11 both edit the aside, 9a and 11 the drawer effect; the edits fit together. 11's `focusSearch` ref, its head button below 900 px and R46's refocus each collided with the base (B3, B2, B1); every new hook goes above the early return `:403`, as the base's drawer and Compare hooks do | 11 calls `pickTarget`, hides its Shortcuts button ≤ 900 px and refocuses the aside only when the focused control is no longer drawn |
| P25 | 8 ↔ 9a ↔ 9b | `ProjectList.tsx`, `MapTab.tsx` | 8 :150 and :475-490; 9a :125-142 and :396-401; 9b :79-123 and :171-182 | Yes | | — |
| P26 | 8 ↔ 11 | `drawer.spec.ts` | R43 cases (after `:615`, `SETTINGS_BUTTON`); R46 extension of `:141-159` | Yes | both open a project with a target (or the self-opening drawer on purpose) and find the button by `SETTINGS_BUTTON` | — |
| P27 | 9a → 9b → 10 | `NotesView.tsx`, `toasts.spec` | 9a "Note added"; 9b defers after `confirm()`; 10 removes `confirm` and turns the dialog handlers into the no-dialog guard | Yes | | — |
| P28 | 11 → 12 | Pause pipes, `pipes.spec` :204-222 | 12 adds rider checks to the tests 11 edited | Yes | | — |
| P29 | 11 → 13a | Fit markup | 13a changes the handler only | Yes | F shortcut picks up the glide | — |
| P30 | 11 ↔ 14 | Phase 1 spec and plan | separate passages | Yes | Find by text | — |
| P31 | 12 → 13a | the `WebKit glide` ruling → `canGlide()` | | Yes | Numbering (finding 15) | Rulings are named by topic in the plan and numbered in the ledger in the order they are made |
| P32 | 12 → 13b | `.flow-riders` → `extra` | | Yes | | — |
| P33 | 3b, 11, 12, 13a | `pipes.spec.ts` | `openConnections` moved; `aria-pressed`; riders; `loosePipeEnds` moved | Yes | | — |
| P34 | 13a → 13b | `glide.ts`, `motion.ts`, `panRef`, `canGlide`, `finishMotion`, `glide.spec` | | Yes | Case numbers fit together | The probe runs only after the reduced-motion and nothing-to-move checks, and its records carry `glide-probe`, which every case skips |
| P35 | 5a ↔ 14 | "As built" decisions | slot names filed as spec-open | Yes (was No) | Finding 3 | The slot names follow §8.3, so "As built" no longer lists them; the four departures that are rulings are plan rulings |
| B1 | 3a, 8, 9a, 11 | `drawer.spec.ts` at `01da27d` (18 cases: `SETTINGS_BUTTON` `/^Settings/` and `TARGET`, `:18-22`; a no-target project at ≤ 900 px opens the drawer by itself into the search, `:298-339`; `:441` reads `getByText('Updating the plan…')` with the drawer open; `:578-615` keeps the focus in the search when a grown window closes it) | Phase 2's narrow e2e and drawer code | Yes (was No) | 3a (9)/(10), 8's R43 cases, 9a (7)/(8) and 11 (7)/(8)/(11) open the drawer at 800 px; R43's busy words collided with `:441`, R46's refocus with `:613` | narrow e2e open projects with a target and use `SETTINGS_BUTTON` (Global Constraints, narrow windows); 8 says "The plan is updating…" (`drawer-status-words`); R46 refocuses the aside only when the focused control is no longer drawn (`aside-refocus`) |
| B2 | 7, 8, 11 | the head and the banners' box (`ProjectPage.tsx:414-438`; `styles.css` 900 px block `:1369-1389`, 700 px block `:1392-1394`) | head: SettingsToggle (`targetName`; ≤ 40 % of the head at 701–900 px, the whole head ≤ 700 px), the name (`flex: 1 1 160px` ≤ 900 px), CompareToggle (> 900 px; `.compare-bar` ≤ 900 px), the badge, Delete; banners: KeyNumbers (its wait div, then the strip skeleton) first, PlanBanner (`onPickTarget`), `.compare-bar` (≤ 900 px), CompareCard last | Yes (was Partly) | 11's Shortcuts button would wrap the 800 px head (`objectives.spec.ts:91`, `drawer.spec.ts:535`, `:544`); `objectives.spec.ts:59` needs the card last; the head's Compare modes button takes no row above 900 px and the closed card draws nothing, so 1280 × 720 keeps 657 + 27.7 ≈ 685 < 700 | 11 hides its button ≤ 900 px (`shortcuts-button-wide`); 7 puts the strip first and the card stays last (`p2-d44-landed`) |
| B3 | 11 | the base's drawer helpers (`ProjectPage.tsx`: `NARROW` `:76`, `settingsPanel` `:284`, `focusOnOpen` `:288`, `openSettings` `:293-296`, `focusSearch()` `:298-304`, the layout effect `:305-312`, the self-opening effect `:313-323`, `pickTarget` `:325-328`, `onWidth()`'s look `:367`) | 11's `/` key and R46 | Yes (was No) | the plan's `focusSearch` ref redeclared the base's function and duplicated `focusOnOpen`; R46 would have added a second ref to the aside | `/` calls `pickTarget()`; R46 reuses `settingsPanel` and stores the focused control in `onWidth` (`:363-365`); the one new ref is `refocusAside` |
| B4 | 3a, 11 | `SettingsPanel.tsx` at `01da27d` (1049 lines; `names?: PickedNames` from `usePickedNames`; three ItemSearches: Make `:189` with `ITEM_SEARCH_PLACEHOLDER`, costs `:351` "…or pick an item", farms `:860` "Item it gives"; AvoidPicker holds a fourth) | 3a `tip={false}` at `:267`; 11 `shortcut="/"` at `:189` | Yes | anchors moved (P15) | — |
| B5 | 1a, 1b, 14 | `contrast.test.tsx:207-243` (the Settings target part, `ADDON17_PAIRS`, the mode-in-use frame) | 1a's capture and rewrite; 1b's dark rows | Yes (was No) | the plan listed Phase 1's tables only | `contrast-phase1.json` holds 155 rows; the frame's edge is light-only; 1b adds the dark ring row and the dark edge and farm-line reasons (`compare-frame-dark`, `farm-line-dark`) |
| B6 | 1a, 5a, 9a, 10 | the dark-box ink group `styles.css:78-85`, now ending `.view3d-warnings, .compare-card > :where(p), .compare-column > :where(p)` | 5a appends `.readout`, 9a `.toast`, 10 `.inline-confirm` at the end of its selector list | Yes | the contract pins the first 7 entries (`styles-contract.test.tsx:530`) and the compare notes by `arrayContaining` (`:2338`) | — |
| B7 | 1a, 1b, 14 | the base's surfaces in the tour and the dark tour (`.compare-card`, `.compare-row`, `.compare-column.current`, `.compare-bar`, `.farm-fields`, `.mat-taken`, `.settings-toggle-target`) | 1a's baseline shots, 1b's `DARK_TOUR` and review shots, 14's final pass | Yes (was No) | `$SCRATCH/t10/tour.mjs` predates them, and at 800 px its head moves with the connection badge | 1a adds the step 'compare card, plan for and farms' (shots `51`–`53`, ported from `$SCRATCH/addon17/final-shots.mjs`) and the live-badge wait; 1b adds three dark stops and the two dark exceptions (`base-surfaces-dark`) |
| B8 | 4, 5a, 6a, 7, 8, 13b | plan data the base adds (`src/shared/types/plan.ts`): `PlanStep.farm`, `RawInput.from` (a supply row beside the bought row of the same key), `RawInput.upkeep`, `Plan.objective`, `credits`, `drawnBy`; read by `importWords` (`flow-model.ts:331`), `takenRows` (`materials-model.ts:268`), `sourceNotes` (`:288`) | every Phase 2 view model of a plan | Yes (was Partly) | written before add-on 17: a `Map` keyed by a raw input's key keeps one row of two; a farm step's recipe is synthetic | 4 draws a farm step's words (`farm-step-readout`) and 5a its card (`farm-step-card`); 6a reads the build list and 7 the plan's cost, power and steps, so neither keys a `Map` by a raw input; 8 counts what PlanBanner lists; 13b keys boxes by node id |
| B9 | 3b, 4, 5a, 5b ↔ the base (add-on 17) | `flow-model.ts` `stepLines` (`farm.text`, `:320`) and `importWords` (`:331-351`); `StepPanel.tsx`'s Farm section (`:678-683`) and RawPanel's bought and `from` rows (`:751-775`); `tests/client/materials-from.test.tsx` | add-on 17 draws farm steps and from imports; 3b puts their words in the tips, 4 redraws the step box, 5a adds the card above PortsSection (the Farm section stays below it), 5b adds `tabIndex` to both asides | Yes | `materials-from.test.tsx:171-175` pins a farm box's `lines`, `:161-170` a farm step's panel that fetches nothing, `:176-200` the from words in the flow and both panels | 3b adds a case there (the from words in `route`, the farm words in the box's tip); 4 keeps `lines` and draws farm boxes per Step 1's farm-step case; 5a's card stays hook-free and draws farm slots per its Step 4 farm rules; no e2e fixture has a farm step, so the unit cases carry them |
| B10 | 8 ↔ Make-picker fix | the drawer's status (R43) | `drawer.spec.ts:441`'s `getByText('Updating the plan…')` with the drawer open; the auto-open into the search (`ProjectPage.tsx:317-323`) | Yes (was No) | a hidden "Updating the plan…" is a second match; "The plan has 1 problem" on every auto-open | `The plan is updating…`, and the `no-target` hint left out of the count (`drawer-status-words`, `drawer-status-count`) |
| B11 | 8 ↔ add-on 17 | `CompareCard.tsx` | `skeleton-compare` beside `:167` (a card with no answer for its target: the first compare, again after a cleared target or another one picked, `4bef36c`, `68c06c1`), `skeleton-readouts` after `:173` | Yes | a skeleton holds no button, `[data-objective]`, `.compare-row` or text, so `objectives.spec.ts:26-33`'s one button per column, `:141` and `:203`'s planning card with no column, `:174`'s 18 figures and `:142`, `:204`'s `getByText` hold | `compare-skeletons`: both skeletons lay their blocks in `.compare-rows`' grid, so they stack where the tiles stack |
| B12 | 9a ↔ Make-picker fix | the drawer effect (`ProjectPage.tsx:358-372`) | `.toasts` inert on every opening, the auto-open included | Yes | toasts.spec (7) needs a target, or the drawer opens by itself and the head is inert | (8) proves the auto-open |
| B13 | 7 ↔ add-on 17 | the Machines tile vs the Compare card's New machines (`src/server/planner/compare.ts:73-84`) | `machineCount` | Yes (was No) | Make N shares a type's machines across its steps | `machineCount` counts a Make N type once, as `src/server/planner/bom.ts:122-131` |
| B14 | 1a, 7, 8, 11, 14 ↔ `main`'s three fixes | `0c08dba` (server: `wholeMachines` moved to `src/server/planner/round.ts`, crop sticks counted by it); `4bef36c` (the Compare tiles' grid and no-break figures, `styles.css:416-425`; `close({ forget: true })` on a cleared target, `ProjectPage.tsx:383-385`); `68c06c1` (the target's layout effect, `ProjectPage.tsx:389-392`) | 8's Compare skeletons, 7's strip tiles, 11's focus rules, 1a's and 14's counts | Yes (was No) | the first re-check read none of them: three fixed 264 px skeleton blocks disagreed with tiles stacked one a row (about 760–1100 px); "Planning the three modes…" now also follows a cleared or swapped target; the strip's one line had no pin | 8's skeletons lay their blocks in `.compare-rows`' grid, and its tests take the swap (`compare-skeletons`); 7 pins its one line and does not shrink (`strip-figures`); 11's hooks need no order against the layout effect, which moves no focus; 1a counts 3300 / 188 and 71, and 155 contrast pairs still; `0c08dba` is server only (a farm step's `farm.sticks` and words can read one less, drawn as sent) |
| V1 | 1a, 1b, 2 → 2b | `styles.css` (the first `:root`; the Compare comment and value `:388-425`; `:534`; `:575-578`; `:939`; `:974-981`; `:1254-1258`; `:1326-1329`), `$P2/tour.mjs`, `$P2/maskdiff.py` | 1a turns colours into tokens and proves the light look against `base-a`; 1b adds the dark blocks; 2 the logo; 2b changes the figures' fonts only | Yes | 2b runs after the three, so 1a's identity check stands as made; from 2b on the light figures differ on purpose | 2b's maskdiff takes Task 2's light shots as its reference (`2 base-b 2b`: 1b's Theme button and 2's logo are in the mask) and accepts differences inside the switched elements' boxes and along their lines only, and Task 14 compares the figures with 2b's shots; `--font-digits` is a font token, which 1b's `/^--(…\|font\|…)/` keeps out of the dark blocks |
| V2 | 2b → 5a, 7 | `styles-contract.test.tsx`: `FONT_IMPORTS`, `TOKENS`, `DIGIT_RULES`, `DIGITS_FLOOR`, the cases at `:805-821`, `:1117-1129`, `:1762-1770`, `:1898-1927`, `:2037-2046`, `:2302-2333` (find them by text after 1a) | 2b defines `DIGIT_RULES`; 5a appends `.stack-count` and `.readout dd`, 7 `.key-number dd` and `.key-number-unit` | Yes | the case asserts the exact list of rules that name `var(--font-digits)`, so each task appends its own in its commit; `contrast.test.tsx` is not touched: 2b changes no colour, so 1a's `PAIRS`, its guard on `contrast-phase1.json` and every later task's pairs stand | — |
| V3 | 2b → 3a, 4, 5a, 11 | `Figs` (`figureRuns`, `span.fig`, `tspan.fig`) | 3a's `TipLines`; 4's count chip (`svg`); 5a's chance tag, tier and overclock chips; 11's key caps | Yes | their new markup tests are written with `span.fig` from the start | `digits-mixed` |
| V4 | 2b ↔ 8 | a Compare tile's height (6 + 14.3 + 2 + 26.39 + 6) and `skeleton-readouts`' 55 px blocks | 2b fixes the value's line at 26.390625 px (P2-R13) | Yes | the old `24px/1.1` line shrank with its figure; the new one keeps 54.7 px, so 8's frames match at every width | `compare-shrink-vt323` |
| V5 | 2b ↔ 4 | `CHIP_CHAR_WIDTH = 9`, `chipWidth`, the box widths | a count's digits in `tspan.fig` (VT323 14.95 px) | Yes | measured: '×5' 13.8 px with the fonts and 14.5 without, against 18; every width as before | `digits-token` (the fallback's `font-size-adjust`) |
| V6 | 2b → 5a, 6a | `.stack-count` and `144L` in a 36 px slot (5a's e2e 6), the grid's stacks and `+N` slot | 5a sets it VT323 16 px/14 px; 6a draws it | Yes | 25.6 px; 29.6 px with the fonts blocked (38.5 without the adjust) | 5a's e2e checks it side to side, and its premise names a VT323 face |
| V7 | 2 ↔ 2b ↔ 7 | `chrome.spec.ts` | 2's brand case; 2b's 'figures in VT323 keep their boxes…'; 7's strip case | Yes | separate tests; 2b's and 7's premises name a VT323 face, and the first test's blocked context still loads none | — |
| V8 | 1b ↔ 2b | `src/client/main.tsx` | 1b's `startTheme()` (`:12-19`); 2b's import after `:10` | Yes | separate lines | — |
| V9 | 2b ↔ 3a, 3b, 5a, 5b, 6a, 8, 9a, 11 | the Phase 1 files 2b touches: `MapTooltip.tsx:48` (3a: `alongAxis`, `:12-17`), `View3D.tsx:243` (8: `:233`), `MaterialsView.tsx:171`, `:227` (6a: `:40-43`, `:114-145`; 8: `:307`), `MapTab.tsx:268` (8: `:475-490`; 9a: `:396-401`), `ProjectPage.tsx:160` (8: `:156`; 3a: `:183`), `LinePanel.tsx:145` (8: `:162`), `StepPanel.tsx:604` (5a: `:676-677`; 5b: `:668`, `:765`), `ConnectionsView.tsx:377` (3b: `:66-132`; 8: `:397-402`; 11: `:323`), `FoundPanel.tsx`, `StepsView.tsx`; the tests `map-hover`, `view3d`, `map-summary`, `layout-map` (`:182`, `:319`), `connections-view` (`:86`; 3b edits `:119-124`, `:138`, `:259`, 11 `:49`, `:265`, `:269`) | 2b writes a figure's text through `<Figs>` | Yes | separate lines; 3a's watch list (spec §6.7: `map-hover`, `map-summary`) holds 2b's `span.fig` | later tasks find the code by its text |
| V10 | 2b | `package.json`, `package-lock.json`, `docs/research/web-stack.md` | the one new dependency | Yes | `@fontsource/vt323` 5.3.0, exact, OFL-1.1, no transitive dependencies | Global Constraints, stack |

| Task | Does its own text agree with itself? | Resolution |
|---|---|---|
| 1a | Yes: Step 3 pins match Step 6 edits, and the literal-to-token map is consistent. Gaps: findings 4, 5, 14. | The guard case and `contrast-phase1.json`, the calibration case kept (4); the eight `>=` lines in `PAIRS` (5); masked diffs, the OS-dark contexts dropped from the tour, plan ruling `baseline-shots` (14) |
| 1b | Yes: Interfaces repeat spec §4.7, and the tests match Step 4. Hazards: finding 19. | `globalThis.document?.startViewTransition`, and `startTheme` listens to `storage` itself (19); the dark-only pairs (5); one dark-tour test per stop (16); the storage case written out (10) |
| 2 | Yes: the timing works out (−0.44/−0.22 s; 3.96 s total). | — |
| 2b | Partly: its sizes, line boxes and Compare constants are spec §25's measures, its `DIGIT_RULES` list matches Step 4's rules, and its e2e premise needs a VT323 face, which the settings count and the tiles load; but the step numbers' marker had no line in px (measured in the app: each one-line row grew from 26.3 to 27.16 px), three Phase 1 texts with figures were left in Pixelify, and Step 6 diffed against `base-a`, whose top bar Tasks 1b and 2 already changed. | The marker's `line-height: 20.3px`; `Rotate 90°`, the swap list's "more…" and the Connections panel's title through `<Figs>` (two more deliberate markup rows); Step 6 diffs against Task 2's light shots |
| 3a | Yes: the `alongAxis` and `placeTip` cases match `MapTooltip.along` (checked). | The rest-timer case written out (10); the long-press guard expires and (11) proves it (7); `hoverFrom` and `frameThrottle` unit-tested (27) |
| 3b | Partly: e2e (3)'s locator, and `:119-124` against `:122-124`. | (3) hovers the head and asserts `focusing` before the Escape (1); (5) tabs out of the canvas, (6) reads "In / Out" (12); (12) a tap on a box only picks; the cites agree |
| 4 | Yes: `busyTrack = width − 60`; `PSEUDO_MACHINE_ENTRIES` has `mteId`, `name` and `itemKey`; '63%'; the 'LV' chip is 28 px. Gap: finding 13. | The fonts premise (13); the pseudo-machine chip rule and the hand step's "by hand" pinned (22, 23); the high fill in forced colours |
| 5a | Partly: Step 4 departed from §8.3; `.energy-bar` elided. | §8.3's slot name and tip lines (3); `.energy-bar` and `.recipe-slot` pinned, the readout label on `--screen-muted` (23); the arrow does not rerun on a new plan of the same step (27); forced colours (6) |
| 5b | (split from 5) | The hooks sit above the early return (21) |
| 6a | Yes for model and markup; No against the Global Constraints: the sleep (finding 11). Long press: finding 7. | (6) polls for the tip, then a tap ticks (11, 7); forced colours (6); the Grid survives a tab switch (27); the toggle's bevel and the heads' ink pinned (23) |
| 6b | (split from 6) | — |
| 7 | Yes: no flash span on first render, matching Step 4. `notCounted` unused: finding 24. | `keyNumbers` reads `notCounted`; the qualifiers' order is fixed and tested (24); the flash's frame pinned (23) |
| 8 | Yes: `createProject` opens `#flow` (checked). | The busy line's arrow in forced colours (6) |
| 9a | API agrees. Three test bodies were comments; finding 25. | The limit and action bodies written out (10); a toast already leaving is never expired twice (25) |
| 9b | (split from 9) | The restore body written out, 409 and 404 included (10) |
| 10 | Yes: `error?` is an addition to the spec's signature. | — |
| 11 | Yes: e2e presses only Tab, Shift+Tab, Escape, Enter and ArrowDown, plus `drawer.spec.ts:315`'s `keyboard.type('Iron Ingot')` into the auto-focused search of an open drawer (checked at `01da27d`, whose new `objectives.spec.ts` cases `fill` and click and press no key). Gap: finding 26. | A combobox ancestor tested (26); F and P do nothing off the diagrams (27) |
| 12 | Yes for both branches. Gaps: findings 15 and 18. | Rulings by topic (15); branch B guards `repeatCount="indefinite"` in the source (18) |
| 13a | Yes. Wording issues: finding 20. | Reduced motion before `canGlide()`, the whole-class match, `matrixView` parsed in node (20) |
| 13b | No: the `[{ opacity: 0 }]` keyframes against the stated "implicit end" (finding 2). | `FADE_IN = [{ opacity: 0, offset: 0 }]`, and glide.spec (2) reads the recorded frames, delays and fills |
| 14 | No: the audit against 1a, the forced-colours claim, and the slot names filed as spec-open (findings 4, 6, 3). | The audit names the §3.5 rewrite and `RING_RULE` (4, 29); five specs' forced-colours cases (6); the slot names gone from "As built" (3) |
