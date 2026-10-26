# Machine GUI restyle, Phase 2 — design

Date: 2026-10-24 (drafted 2026-10-23). Status: approved and built. Approved by the user on 2026-10-24 (logo C, all Phase 2 mockups, dark mode with Auto as default); builder-check answers in §23. Built on branch `feat/machine-gui-phase2` (2026-10-24 to 2026-10-26): where a ruling of the build changed the design, an **As built** note at the end of the section says what was built and names the ruling (P2-R1 to P2-R142, kept in the SDD ledger, which is not committed), and the plan's "As built" section (`docs/superpowers/plans/2026-10-24-machine-gui-phase2.md`) lists every ruling. The base is `main` at `cfaa05b`, with
Phase 1 merged. Every `file:line` below is at that commit. §24 and the plan were re-checked against `main` at `01da27d` (Phase 1, the
Make-picker fix, add-on 23 and add-on 17 merged), and their cites are at `01da27d`. On 2026-10-24 the user also chose VT323 for
figures, Pixelify Sans kept for words: §25 records it, adds its one dependency and overrides anything above that disagrees.

**Inputs**
- Phase 1 design: `docs/superpowers/specs/2026-10-22-machine-gui-restyle-design.md`, cited as "P1 §n".
- Phase 1 plan, with its "As built" rulings R1–R40: `docs/superpowers/plans/2026-10-23-machine-gui-restyle-phase1.md`.
- Phase 1 ledger, with the deferred minors and the parked rulings R41–R47 (`:182-195`):
  `.superpowers/sdd/2026-10-23-machine-gui-restyle-phase1/progress.md`.
- Six scout reports. They are the factual basis for this design, and their long `file:line` lists are not repeated here. All
  are in `<the design session's scratchpad, not in the repo>/recon2/`:

  | Cited as | Report |
  |---|---|
  | [TL] | `theme-logo.md`, plus `theme-logo-contrast.txt` and `theme-logo-svg.txt` |
  | [FV] | `flow-visuals.md` |
  | [SR] | `step-recipe.md` |
  | [MG] | `materials-grid.md` |
  | [TT] | `tooltips.md` |
  | [FB] | `feedback.md` |

- Approved mockups. They set the look, not a pixel spec. All are in
  `<the design session's scratchpad, not in the repo>/phase2-canvas/project/`:

  | Mockup | Shows |
  |---|---|
  | `Main.dc.html` | the logo picker; C was chosen |
  | `Phase2Project.dc.html` | the strip, the Flow boxes, the riders and the recipe card |
  | `Phase2Inventory.dc.html` | the inventory grid |
  | `Phase2Feedback.dc.html` | skeletons, toasts, the in-app confirm, the shortcuts sheet and the glide |
  | `DarkMode.dc.html` | the dark palette and the Theme button |

- The contrast figures for the new Phase 2 pairs in §4.5 were computed for this spec with the WCAG formula that
  `contrast.test.tsx` uses. The script is
  `<the design session's scratchpad, not in the repo>/p2design/contrast.mjs`.

## 1. Intent and why

Phase 1 put the B "Machine GUI" look on every page and made the pipes move and meet their ports. Shown the logo options and
the Phase 2 mockups, the user said:
- "custom pixel art logo would be great and phase 2 yes make mockups"
- "C looks good and for phase 2 it looks great also a dark mode would be great"
- "yes looks great", which approved the dark-mode mockup, with Auto as the default

The Phase 1 brief still holds: "more like minecraft", "make sure the lines are moving and connected", and "make sure even
tho it is machine UI it is also animated and mordern UX" (P1 §1).

**Phase 2 in one sentence.** The dense text that remains becomes Minecraft-native visuals. Flow boxes get machine readouts,
the step panel shows an NEI recipe card, the build list can be shown as an inventory grid, and the key numbers become
readout tiles. Goods ride the pipes, and the diagrams glide to new layouts and views. A modern feedback layer comes in: one
NEI tooltip, skeletons, toasts with Undo, in-app confirms and keyboard shortcuts. A pixel-art logo is added, and each person
can choose a dark look.

**What "Auto by default" means.** Do not repeat the approval message's wording, "nothing changes for anyone until they
pick". With Auto, anyone whose operating system is set to dark sees the dark look at once, and everyone else sees today's
look. The e2e suite is unaffected, because Playwright contexts default to a light colour scheme ([TL] §0.8).

**Where Phase 2 departs from the mockups on purpose.** Each departure is forced by WCAG or by a pinned test, and §22 records
each one:
- The logo plays 6 turns and then rests. The mockup loops for ever.
- The progress arrow and the skeleton sheen also stop. The mockup loops them for ever.
- Flow boxes keep one row per good and stubs at least 190 px wide. The mockup pairs an input and an output on one line and
  draws 110 px stubs.
- The recipe card has no "Swap recipe…" button, no "Show in 3D" button and no yellow note.
- The strip's tiles have two lines, as in the DarkMode artboard, not three.
- A changed tile flashes an opacity frame, not a box-shadow.
- The recipe arrow and the inventory meter animate with a `scaleX` transform, not `width`.
- A tooltip sits below and right of the pointer. The mockups put it above and right.

## 2. Goals, non-goals, anti-goals

**Goals**
- A dark look anyone can choose, with Auto (follow the OS) as the default.
  - The light look stays exactly as it is today.
  - Every Phase 2 feature is built on tokens and meets AA in both looks.
- Logo C in the top bar, on the login card and as the browser-tab icon. It plays a few turns, then rests on its still frame.
- Text becomes visual where the data already exists:
  - a machine icon, tier chip, ×count chip and busy bar on each Flow step box
  - the NEI recipe card in the step panel
  - an opt-in inventory grid for "To build (once)"
  - the key-numbers strip
- Goods ride the Flow pipes. Both diagrams glide to a new layout and animate Fit, zoom and reveal, while wheel and drag stay
  instant.
- One shared NEI tooltip replaces the native tooltips of items and of the diagram boxes and arrows. No element shows two
  tooltips.
- Modern feedback:
  - skeletons beside every loading line
  - toasts, with Undo where an action can be taken back
  - in-app confirms instead of `window.confirm`
  - keyboard shortcuts and a sheet that lists them
- The parked Phase 1 fixes R41–R47 are done.
- It stays a serious tool: `npm test` and `npm run e2e` stay green with no assertion loosened, reduced motion is honoured,
  everything is reachable from the keyboard, and the forced-colours mode works.

**Non-goals**
- No change to planning logic, the server, the API, plan data or the mods. Everything new is client-side: two per-browser
  settings (theme and materials view), a mod-name table and pure view models.
- No change to how the map terrain and the 3D scene are drawn; their pixels are tested. The 3D viewport keeps its pale sky
  in dark.
- No data the pack lacks:
  - real max stack sizes (64 is used, D9)
  - items a machine holds but does not use up
  - EU/t at other tiers, parallels or heat
  - mod names from the pack (a client table is used instead, D10)
- No tooltip on Connections links. MapTooltip and the 3D hover label are unchanged. The 12 other native `title`s stay
  native ([TT] §1.1 rows 9–18).
- Some P1 Phase 2 items move to Phase 3: the tier picker, inline validation, the "saving" pip and others (§18).

**Anti-goals** (each would be a failure even if it "works")
- A dark mode made by inverting or filtering the page, or one that changes even one pixel of the light look.
- An endless animation other than the pipes and the goods riding them, including a logo that loops for ever.
- Animating `width`, `height`, `top` or `left`, or a `box-shadow` flash, where a transform or opacity would do.
- Tooltips that go wrong:
  - double tooltips (native plus NEI)
  - a tooltip that takes the pointer, swallows Escape or covers the row being read
  - a hidden `role="tooltip"` left in the DOM
- New text that duplicates a string the e2e specs look for, so that a strict locator fails (§3.8).
- A count-up that makes a screen reader read the in-between numbers.
- Confirms for things that can be taken back. Browser dialogs anywhere.
- Riders or a glide that make large plans janky, or that leave a pipe detached from its port once the motion ends.
- Breaking the e2e suite, or weakening its assertions to make it pass.

## 3. Constraints

### 3.1 Stack and build (unchanged from P1 §3)

- React 19, Vite 8, TypeScript 6, vitest 5 and Playwright 1.63.
  - Unit tests run in node with `renderToStaticMarkup`. There is no DOM, so behaviour is unit-tested through pure modules and
    proved in e2e.
  - e2e runs Desktop Chrome at 1280×720 against the real server and the Mini-GT fixture. Each test gets a fresh context with
    empty localStorage and a light colour scheme.
- There is one stylesheet, `src/client/styles.css`, with tokens on `:root`. `publicDir: false` holds, so no game assets go in
  `dist/`. Fonts are bundled, never fetched from a CDN.
- Phase 2 adds **no new dependencies**. `createPortal` comes from `react-dom`, and WAAPI, View Transitions and `matchMedia`
  are browser APIs.

### 3.2 Pinned markup and selectors

Everything P1 §3 lists still holds:
- every class, data attribute, test id, role, label, placeholder and visible string that the e2e specs use
- `[data-node-id] > rect.flow-node-box` as a direct child
- the `g.conn-pan` transform attribute format
- `li.mat-row`, with `class="mat-row"` as its first attribute
- the pixel assertions: map centre alpha, the 3D lit pixels, the icon centre pixel, and `elementFromPoint` on empty
  Connections area hitting the svg
- LinePanel before FoundPanel

The scouts found these further pins. Each feature section repeats the ones it touches.

| Area | Pin |
|---|---|
| Flow node `<g>` | `class` sits right before `data-node-id` (`flow.test.tsx:473`). An unlit new step's class is exactly `flow-node step new` (`flow-pipes.test.tsx:107`). |
| | Unlit markup contains no whole word `hl` or `dim`, so no class like `busy-dim` or `chip-hl` (`flow.test.tsx:487`, `flow-pipes.test.tsx:108`). |
| | A node holds no `<circle>` (`flow-pipes.test.tsx:109`). |
| | The 4×10 `rect.flow-port` is its row's last child, and no other `rect.flow-port` exists (`:105`). |
| Flow edge `<g>` | Its attributes are exact, and its children are exactly `flow-edge item`, `flow-edge-hit`, `flow-edge-line`, `flow-edge-flow` (`flow-pipes.test.tsx:35-36, :58`). |
| Connections link `<g>` | The tags are exact (`connections-view.test.tsx:204, :212, :219, :224`). |
| StepPanel | `<h3>{title}</h3>` has no attributes (`step-panel.test.tsx:75`). No `data-port-key` appears outside PortsSection (`:83`). |
| | These words must stay absent: "Machine tier", "reused", "Shares", "0×", "Reuse your", `r1</span>` ([SR] §2). |
| | RawPanel's button is exactly `<button type="button">Make it here instead</button>` (`:264`). `PortsSection`, `RawPanel` and the new `RecipeCard` are called as plain functions, so they hold no hooks. |
| Materials | BuildSection holds no nested `<section>`. Nothing before the total line contains `Machines`. The `<summary>`s are bare ([MG] §2.1). |
| PlanBanner | It renders `''` when there is nothing to warn about (`plan-banner.test.tsx:77, :129-130`). `<p class="plan-cost">` matches byte for byte (`:136`). |
| Map tab | `<div class="map-tab map-tab-status"><p class="muted">Loading the world scan…</p></div>` is exact (`map-tab.test.tsx:46`). |
| ItemIcon | No wrapper element (`map-summary.test.tsx:169`), and no attribute named `data-key` (`:94`). |
| Stylesheet contract | `ruleBody` finds the **first** rule whose selector list **equals** its argument. So never add a selector to a pinned list ([MG] §2.3 lists them); write a new rule instead. |
| | Every name in `KEYFRAMES` animates only its listed properties (`styles-contract.test.tsx:133-180`). |
| | The `FADES` transition is exact (`:1109, :1186`). |
| | Among the Flow rules, only `.flow-node-box` has `drop-shadow` (`:1250`). |
| | No rule styles an `.item-icon img` (`:957`). |
| | There is one forced-colours block, it comes last, it uses system colours only, and it never uses `forced-color-adjust`. |

### 3.3 Motion rules (D17)

**The endless guard.** `styles-contract.test.tsx:2198-2201` checks that the only `animation: … infinite` rules are the three
pipe-content rules (`CONTENTS`, `LIT_CONTENTS`, `CONN_CONTENTS`).
- Phase 2 adds exactly one more: the Flow riders, which are pipe contents too (P2-D18).
- The Pause pipes button stops all four.
- Everything else new runs a finite number of iterations totalling ≤ 5 s. That covers the logo, the skeleton sheen, both
  arrows, the strip flash, toasts and tooltips.
- The resting state is the element's own style, so there is no fill mode. Durations are written in seconds, so that the dot
  check's "duration × count ≤ 5" helper (`:2203-2211`) reads them.

**What may be animated.** Only `transform` and `opacity`, with these exceptions:
- `stroke-dashoffset` for the pipes
- `offset-distance` for the riders (new)
- `background-color` on hover
- `block-size` for the settings fold (R16), and now for the Materials disclosures by the same mechanism

The mockups' `width` animations and the `box-shadow` flash are rebuilt on transform and opacity.

**No CSS transform on an SVG `<g>`, with one exception.** A WAAPI animation of `transform` is allowed when its last keyframe
equals the element's `transform` attribute and it uses `fill: 'none'` (P2-D6). The attribute always holds the final value.

**Other rules.**
- No JS frame loop drives a diagram.
- Bounded `requestAnimationFrame` work is allowed for the strip's 400 ms count-up and for re-anchoring a visible tooltip.
- Nothing the user waits for takes longer than 300 ms: the pan is 250 ms, the re-layout 260 ms and the theme fade 260 ms.
  The strip flash (700 ms) is a highlight nobody waits for.
- No infinite transform animation runs on anything clickable. Riders take no pointer events, and skeletons and arrows are
  not clickable.

> **As built.** The theme's cross-fade itself runs 260–268 ms, but the first switch of a page measures 297–314 ms from the
> click to its end, as the browser captures the old look first. That is accepted against the 300 ms above (P2-R127).

### 3.4 Reduced motion

- **CSS.** The global block (`styles.css:106-111`) sets every `--dur-*` to 0 ms, and every animation and transition to 1 ms
  and one iteration. It reaches `::before` and `::after`, but not `::view-transition-*`, WAAPI, SMIL or JS.
- **JS.** Every piece of JS motion checks `prefersReducedMotion()` at each call and then does the instant thing. That covers
  WAAPI (glide, pan, ghosts), SMIL (the rider fallback), the rAF count-up and View Transitions (the theme fade).
  `prefersReducedMotion()` lives in `src/client/state/motion.ts` and reads `matchMedia('(prefers-reduced-motion: reduce)')`
  live, so Playwright's `emulateMedia` takes effect at once.
- **What the user sees under `reduce`:**
  - the logo is still
  - tooltips appear and go at once
  - there are no riders, no glide and no count-up
  - the sheen and the arrows show their resting state
  - toasts appear at once
  - the theme switches instantly

### 3.5 Contrast and forced colours

- **The bar.** Text needs 4.5:1, and graphics and component edges need 3:1, in **both** looks.
- **The contrast test.** `tests/client/contrast.test.tsx` becomes token-driven. It parses the light and dark token maps from
  `styles.css` and runs one pair table, by token name, for both looks. That closes Phase 1's deferred F4 ("pairs
  hand-copied"). Every new pair joins this table.
- **Accepted exceptions:**
  - stack counts are measured against their 2 px dark shadow (D8)
  - the dark tick well's edge is 4.21:1 (D2)
  - the tooltip is not hoverable (D11)
  - aria-hidden decorative shapes have no minimum: skeleton blocks, the recipe arrow's base, and the auto icon's dark half
- **Forced colours.** Every new graphic drawn with a background or an SVG fill gets a rule in system colours in the one
  forced-colours block. That covers the busy bar, the chips, the grid tick, the meter, the energy bar and both arrows.
  - Cues use `:not(:focus-visible)`, so they never replace the focus ring. That is the lesson of R42.

> **As built.** Exceptions recorded while building, each identified some other way: in dark, empty bar tracks and readout tiles'
> edges (ledger ruling P2-R30) and every chat box's black edge and 82 % face on the panel, 1.40–1.46:1 (P2-R67); in dark, button
> faces and the unselected tabs on the stone (1.67:1, 1.12:1) and a button on the top bar (1.78:1), named by their labels, and a
> modal's or the sheet's frame on the dimmed page (1.40:1), a container, as P2-R67's chat boxes are (P2-R136); the short ring
> against the light slot face inside it, 2.27:1 (P2-R31); the tick's black edge on a ticked light slot, 2.73:1, where the green
> tick reads 5.80:1 (P2-R38). Three dark pairs that fell short were raised instead, each through a token whose light value is the
> one the light look drew: every scroll bar the page colours takes the slider's thumb, 4.59:1 on the screen and 4.05:1 in the map's
> side column (`--btn` was 1.78:1 and 1.58:1: P2-R128); the selected tab's label takes the accent, 13.46:1, as its face differs
> from the others' by 1.15:1 (`--tab-on-ink`, P2-R129, a departure from the dark mockup); a slider's track takes the tick well's
> light lower edge, 4.21:1 (`--bevel-track`, P2-R130). In forced colours riders (P2-R95) and ghosts (P2-R115) take no rule: they
> are aria-hidden and paint the same with forced colours on and off. Every frame something could paint over is checked as painted
> pixels (P2-R41); the SVG paints, which Chromium leaves unforced, are checked by their computed fill and stroke.

### 3.6 Height budget at 1280×720

- The top bar stays at most 53 px tall and on one row. The Theme button keeps it one row down to a window about 655 px wide.
- The tab strip stays at most 41 px, with no margin below it. `.tab-panel` padding stays at most 8 px.
- **Headroom.** On the iron-plate line, the map canvas centre sits at y ≈ 657, which is where `layout.spec.ts:52-58` aims
  ([FB] X5; ledger `:147`). So everything above `.project-body` may add **less than 63 px** in total.
  - The strip is designed at **+27.7 px**: a 60 px strip replaces the 32.3 px cost line, which puts the centre at about 685.
  - Nothing else adds height above the body. Toasts and tooltips are `position: fixed`, and the Theme and Shortcuts buttons
    sit in rows that are already 36 px tall.
- Fonts that arrive late must not change any height. The strip, toasts, chips and skeletons use fixed px heights and line
  heights.

### 3.7 Phase 1 rulings that stay in force

| Ruling | What stays in force |
|---|---|
| R1 | One rule per selector, because the contract's `ruleBody` reads the first rule. |
| R9, R10 | 14 px on `body`, so 1 rem stays 16 px. |
| R11 | Summary text is white on the button face. |
| R12, R13, R30, R33 | Borderless focusables (links, `button.link`, summaries, ticks, radios, sliders, file inputs) take their ring colour from `--ink-focus`, which is now `var(--panel-focus)` on panels. |
| R15 | Escape closes one layer per press, and a key already `defaultPrevented` is not the drawer's. |
| R16 | The settings fold animates `block-size`. |
| R17, R23 | Diagram areas clip both axes with a 4 px clip margin. |
| R18 | Box text uses the darker reds. |
| R19 | A newly lit pipe's rim blinks once. |
| R21 | `dragging` resets on every press, release and cancel. |
| R22 | The Connections rim is its own polyline. |
| R24a, R28 | The ligature rules for `*` and `::file-selector-button`. |
| R25 | Map rows are flat. |
| R27 | Tooltips enter with `tip-in`. |
| R29 | The canvas has its own class, `.view3d-scene`. No stylesheet rule may name the `canvas` element. |
| R31 | Pause pipes is one per-browser setting. The live dot stops within 5 s. R44 changes the button's attributes. |
| R32a | Arrow heads fall back to yellow outside `@supports (fill: context-stroke)`. |
| R34 | The missing-source casing is `#ff5555` with a white head. |
| R35 | Sentences are never set in Pixelify. |
| R36 | The drawer is a layer of its own: focus moves into it, the page behind is inert, and every way out goes through `closeSettings`. |
| R37, R37a | A summary whose title wraps grows instead of spilling. |
| R40 | The contract splits selector lists at top-level commas, and e2e polls instead of sleeping. |
| I1 | The forced-colours block. |

**Superseded or refined in Phase 2:**
- The single-theme rule (P1 §4 and §10 call 1; plan Global Constraints `:30`, Review Focus 1). P2-D2 replaces it.
- R26, "no mod line", which holds for MapTooltip only from now on; item tooltips get one (D10).
- R31's `aria-pressed`, which R44 drops.
- R3, the selected slot's scale-in, which stays deferred, now to Phase 3.

Phase 1's global rules hold unchanged:
- radius 0 everywhere but the map's `.pin-dot`
- Pixelify Sans only at 13 px or more, never for sentences
- decorative `::before` and `::after` use `content: ''` and never a glyph
- native inputs stay native
- SVG diagram text keeps the system UI stack, except the two chips of D4

### 3.8 Strings and names the e2e specs look for

`getByText`, and the `name` option of `getByRole` and `getByLabel`, match case-insensitive **substrings** and also see hidden
nodes. Strict mode then fails on a second match. So no new text may contain any of the strings below. New text means
tooltips while shown, toasts, the sheet, confirms, visually hidden text, chips and aria-labels.

**Texts:**
- "Swap recipe"
- "0 overclocks → 16 EU/t × 200 t"
- "2× Basic Assembler (LV) reused — from your list"
- "was deleted by", "was already deleted"
- "In-game projector", "No tokens yet."
- any line that starts "Steve · gpt_"
- "Add note at"
- "Make N counts the build cost of new machines…"
- "Basic Wiremill uses Copper Ingot — no recipe at LV avoids it"
- "Titanium Ingot: needs Moon"
- "No scans yet"

**Button names:** no new button whose name contains "Fit", "Create", "Pause pipes", "Play pipes", "Save note", "Use this
base", "Keep only", "Remove Copper", "Close the panel", "Make it here instead", "Revoke", "Restore", "Move line" or "Log in".
The one deliberate exception is the confirm's "Revoke token", which the updated `projector.spec` scopes to its alertdialog
(§13).

**Labels:** no new fixed label or aria-label that contains "Tier", "Base", "Find item", "Rate", "Focus", "Materials" or
"Projects". Item names are data. The only new controls that item names label are the grid's slot checkboxes, and they
exist only when Grid is chosen, which no existing e2e spec does. The Flow machine icons sit in an aria-hidden group.

**Other rules:**
- No new link whose name contains "Projects".
- Nothing new may be named "Recently deleted", "What changed" or "Confirm delete".
- No `role="alert"` on the project list (`delete.spec.ts:77`).
- No hidden `role="tooltip"` (`world.spec.ts:69`).

**After the SVG `<title>`s go.** Three assertions will read only the visible text: `flow-focus.spec.ts:91-93`,
`connections.spec.ts:37` and `pipes.spec.ts:161`. The sizing analysis says they still pass ([TT] §2.3); run them first.

### 3.9 Deliberate test changes in this phase

These are the only existing assertions Phase 2 changes. Each one changes because this design changes that markup or
behaviour. Nothing is deleted or loosened. Additions are not listed here.

| Test | Before → after | Why | Task |
|---|---|---|---|
| `styles-contract.test.tsx:157-162` "has one theme" | Rewritten as "has a light and a dark look; Auto follows the OS" (§4.12). The two `<meta>` checks are kept. | D2 | 1 |
| `styles-contract.test.tsx`, about 30 literal pins | A literal becomes a token, for example `#8b8b8b` → `var(--tab-face)`. Full list: [TL] §2.2. The `TOKENS` table pins every light value. | D2 | 1 |
| `styles-contract.test.tsx:216-233`, `:467-470` | The panel ink group reads tokens (`--ink: var(--text)` …), and `--ink-focus` becomes `var(--panel-focus)`. | D2 | 1 |
| `connections-view.test.tsx:183, :191, :196` | `--pipe-casing:var(--panel)` → `var(--dye-casing)` | D2 | 1 |
| `tests/e2e/theme.spec.ts` | Rewritten (§4.12) | D2 | 1 |
| `styles-contract.test.tsx:550-564` | The brand-mark parts become the 16×16 logo C paths. The `.brand-mark` and `.login::before` rows are kept. | D3 | 2 |
| `item-icon.test.tsx:18, :28, :30` | `title="…"` → `data-tip="…"`, and no `' title='` | D11 | 3 |
| `scaffold.test.tsx:71` | `title="gregtech…"` → `data-tip="gregtech…"` | D11 | 3 |
| `flow-pipes.test.tsx:35` | The edge tag ends `… style="--pipe-dur:1s" aria-label="…" data-tip="…"><path class="flow-edge-hit"`, and contains no `<title`. | D11 | 3 |
| `connections-view.test.tsx:123-124, :138, :259` | The `<title>` text becomes `data-tip` and `aria-label`; the box rect becomes the first child. | D11 | 3 |
| `flow-pipes.test.tsx:59-60` | A lit missing arrow now uses `url(#flow-arrow-missing)` | R41 | 4 |
| `styles-contract.test.tsx:1315` | The `slide-in-right` pin moves to `.flow-side`. `.flow-panel` takes `fade-in var(--dur-base) var(--ease-out)`. "Never animates the grid" stays. | D7 | 5 |
| `styles-contract.test.tsx:2110, :2153` | `PICKED_CUES` takes `:not(:focus-visible)` on the map row | R42 | 6 |
| `styles-contract.test.tsx:453-457` | The summary guard also scans `:where()` and `:is()` arguments. This tightens it. | R45 | 6 |
| `tests/e2e/projector.spec.ts:14-16` | The `page.once('dialog')` accept is replaced by a click on the confirm's "Revoke token". A no-dialog guard is added. | D15 | 10 |
| `pipes-paused.test.tsx:88-89`; `connections-view.test.tsx:49, :265, :269` | `aria-pressed` goes, and `aria-keyshortcuts="P"` / `"F"` are added | D16, R44 | 11 |
| `pipes.spec.ts:204, :206, :213, :222` | `toHaveAttribute('aria-pressed', …)` → `not.toHaveAttribute('aria-pressed')`. The name checks already carry the state. | R44 | 11 |
| `styles-contract.test.tsx:2198-2201` | The allowed endless list grows from 3 rules to 4: the rider rule | P2-D18 | 12 |

> **As built.** Against `main`, every changed or removed test line is one of this table's rows, §25's figure rows, the §3.5
> rewrite of `contrast.test.tsx`, a helper moved to `tests/client/css-blocks.ts`, `tests/client/storage-stub.ts` (P2-R40) or
> `tests/e2e/helpers.ts`, or a change the ledger authorised: the slider thumb's pin `var(--btn)` → `var(--thumb)` (P2-R9); the pins
> of §4.4's list where a pinned token became a feature token with the same light value (`--field-edge`, `--bevel-tick`, `--flange`,
> `--flow-group`, `--conn-box`); the Pause pipes store's storage cases, asserted for every browser choice in
> `browser-choice.test.tsx` (P2-R40); the conduits line's own settings and reload in `connections.spec.ts` (P2-R16); a farm field's
> test event that carries `nativeEvent` (P2-R76); and, in the final fix wave, the scroll bars' two pins `var(--btn)` → `var(--thumb)`
> (P2-R128), the selected tab's ink `var(--text)` → `var(--tab-on-ink)` (P2-R129), the range tracks' `var(--bevel-well)` →
> `var(--bevel-track)` (P2-R130), `.item-icon`'s pin gaining `-webkit-touch-callout: none` (P2-R135), and the project-name case of
> `tooltips.spec.ts`, whose second Escape now leaves the focus in the field (P2-R132), and its two Review Focus 2 cases, which now
> press Escape twice, the emptied search's note's and then the drawer's (P2-R138). Inside tests this phase added, P2-R24a,
> P2-R32, P2-R50, P2-R50b, P2-R60, P2-R74, P2-R86, P2-R89, P2-R96, P2-R97 and P2-R116 changed pins deliberately, and so did the final
> fix wave: P2-R131 (the diagram skeleton's columns and gap, the narrow recipe readouts, the tooltip's `max-width`), P2-R142 (the
> narrow recipe readouts again, and a phone's block of its own), P2-R134 (the sheet's Esc row), the drawer status's signature
> (FW-10), the strip's `planDrawn` record (FW-13), `glide.spec.ts`'s drawn-at check (FW-14) and `map-summary.test.tsx`'s
> plain-number pattern (FW-15); and test set-ups a fix needed (an event passed to Keep only, a stand-in `main` for the
> supporting-lines button, a blur before `?`, an icon named before it is hovered).

## 4. The theme system (dark mode)

### 4.1 Choice and mechanism (D2)

- There are three choices:
  - **Auto** is the default. `<html>` carries no `data-theme`, and the stylesheet follows `@media (prefers-color-scheme:
    dark)` by itself. Auto needs no JS, so it can never flash.
  - **Dark** sets `data-theme="dark"`.
  - **Light** sets `data-theme="light"`.
- The choice is stored per browser in localStorage under `gtnh-planner:theme`, with the values `auto`, `dark` and `light`. A
  missing or unknown value means Auto.
- The Theme button cycles Auto → Dark → Light → Auto.
- Rejected alternatives:
  - A JS-resolved Auto. It would make every OS-dark user depend on the head script, and a future CSP would make them flash.
  - `light-dark()`. It needs `color-scheme: light` for the light look, which would turn today's dark select popups light.
  ([TL] §4.2.1)
- `color-scheme: dark` on `:root` and `<meta name="color-scheme" content="dark">` stay in **both** looks. Both looks have a
  dark page and black fields, so the browser's select popups, autofill and scrollbars stay as they are.
- `<meta name="theme-color" content="#1a1a1a">` stays as it is (P2-D25).

### 4.2 Stylesheet shape

```css
/* The dark look (Phase 2 §4): chosen, or Auto with the OS in dark. The two lists are identical (a contract case checks it). */
:root[data-theme='dark'] { --page: #141414; --page-check: #181818; … }
@media (prefers-color-scheme: dark) {
  :root:not([data-theme='light']) { --page: #141414; --page-check: #181818; … }
}
```

- **Placement.** Put both blocks right after the first `:root` block, as one "dark look" section.
- **Specificity.** Both selectors are (0,2,0), so they beat both `:root` blocks (0,1,0), the Flow-token `:root` at `:615`
  included.
- **What the dark blocks contain.** They redefine existing names only; they add no new names.
- **Derived tokens.** Tokens built from `var()` resolve against the final values: the bevels, `--flow-new: var(--panel)` and
  the like. So they follow without being repeated.
- **Panel ink.** The panel ink group (`styles.css:69-74`) is rewritten to read tokens: `--ink: var(--text); --ink-muted:
  var(--text-muted); --ink-title: var(--title); --ink-link: var(--link); --ink-error: var(--panel-error); --ink-ok:
  var(--panel-ok); --ink-warn: var(--panel-warn); --ink-focus: var(--panel-focus)`. The dark look then only redefines
  `:root` tokens, and no selector list is ever duplicated.
- **What stays literal.** The dark-box ink group (`:77-84`) is the same in both looks and stays literal: chat boxes, screens
  and chips.

### 4.3 Tokens

The light value of every token equals today's literal or token. New tokens are marked "new". "Same" means the value is the
same in both looks. The dark values come from `DarkMode.dc.html:185-191` (DARK). The rows marked "TL" come from the scout's
proposals, which fill what the mockup lacks ([TL] §4.2.3). The rows marked "P2" come from this spec.

| Token | Light | Dark | Source / use |
|---|---|---|---|
| `--page` / `--page-check` / `--bar` | `#2b2b2b` / `#262626` / `#1a1a1a` | `#141414` / `#181818` / `#0b0b0b` | mockup |
| `--bar-line` (new) | `#3c3c3c` | `#2a2a2a` | top-bar inner line (`:266`) |
| `--panel` / `--panel-hi` / `--panel-lo` | `#c6c6c6` / `#ffffff` / `#555555` | `#2a2a2a` / `#474747` / `#0d0d0d` | mockup |
| `--slot` / `--slot-hi` / `--slot-lo` | `#8b8b8b` / `#ffffff` / `#373737` | `#1d1d1d` / `#4a4a4a` / `#070707` | mockup |
| `--well` / `--grid` (new) / `--screen` | `#373737` / `#404040` / `#1b1b1b` | `#1a1a1a` / `#242424` / `#0b0b0b` | mockup; `--grid` = the canvas grid lines (`:645`, `:1012`) |
| `--screen-lo` (new) | `#555555` | `#2f2f2f` | readout tile bevel (mockup screenLo) |
| `--text` / `--text-muted` / `--title` / `--link` | `#303030` / `#4a4a4a` / `#404040` / `#1a3fa0` | `#e6e6e6` / `#a8a8a8` / `#ffffff` / `#8fb4ff` | mockup |
| `--ink` / `--ink-muted` (page ink) | `#dddddd` / `#aaaaaa` | `#e6e6e6` / `#a8a8a8` | mockup. The page's title, link, error, ok, warn and focus inks are the same in both looks. |
| `--btn` / `--btn-hi` / `--btn-lo` | `#6b6b6b` / `#a0a0a0` / `#3c3c3c` | `#3c3c3c` / `#5a5a5a` / `#1e1e1e` | mockup. `--btn-hover #4a5499` is the same in both. |
| `--btn-off` / `--btn-off-ink` (new) | `#4a4a4a` / `#a0a0a0` | `#262626` / `#8a8a8a` | TL: disabled face (`:133`, `:217`) |
| `--tab-face` / `--tab-face-hi` / `--tab-ink` (new) | `#8b8b8b` / `#a8a8a8` / `#1b1b1b` | `#1f1f1f` / `#2f2f2f` / `#c8c8c8` | mockup tabOff |
| `--tab-face-hover` (new) | `#9a9a9a` | `#2a2a2a` | TL |
| `--rule` (new) | `#8b8b8b` | `#474747` | TL: 1 px separators (`:784`, `:819`, `:838`, `:955`, `:963`) |
| `--veil` (new) | `rgb(255 255 255 / 0.35)` | `rgb(0 0 0 / 0.3)` | TL: map-row hover (white would be 1.94:1 in dark) |
| `--press` (new) | `rgb(0 0 0 / 0.15)` | `rgb(255 255 255 / 0.08)` | TL: `.mat-toggle:hover` |
| `--field-edge` (new) | `#a0a0a0` | same | TL: field, project-name and search-list edges. 5.49:1 on the dark panel, where `--btn-hi` would darken to 2.2:1. |
| `--bevel-tick` (new) | `var(--bevel-slot)` | `inset 2px 2px 0 #000000, inset -2px -2px 0 #8b8b8b` | TL: tick and radio wells, 4.21:1 (D2 accepts it) |
| `--thumb` (new) | `var(--btn)` | `#7a7a7a` | P2-D24: slider thumb, 3.34:1 on the dark panel (`--btn` would be 1.30:1) |
| `--panel-error` / `-ok` / `-warn` / `-focus` (new) | `#aa0000` / `#1e5a1e` / `#6a4000` / `#1b1b1b` | `#ff6b6b` / `#55ff55` / `#ffaa00` / `#ffff55` | TL: the panel ink, read by the panel group |
| `--flow-owned` / `--flow-owned-line` | `#b9d6b0` / `#2f6b2f` | `#22402a` / `#55c06a` | mockup |
| `--flow-new` / `--flow-raw` | `var(--panel)` | `#303030` | mockup box. Only these two are redefined, because the mockup box is not the panel. |
| `--flow-out` / `-line` | `#f0d870` / `#6b5500` | `#3b3313` / `#d9b43a` | TL |
| `--flow-import` / `-line` | `#d8cfa8` / `#6b5a20` | `#34301e` / `#a89a5c` | TL |
| `--flow-missing` / `-line` | `#e3b0b0` / `#aa0000` | `#3e1e1e` / `#ff5555` | TL |
| `--flow-sink` / `--flow-sink-line` (new) | `#a8a8a8` / `var(--flow-raw-line)` | `#242424` / `#6e6e6e` | TL: the sink's dashed edge (`:663`, swatch `:767`) |
| `--flow-line` / `-line` | `#cbbbe0` / `#5a3a8a` | `#2d2740` / `#a58bd6` | TL |
| `--flow-group` (new) | `#cbbbe0` | same | TL: the open-line frame and title (`:718-719`), no longer `--flow-line` |
| `--flow-error` / `--flow-warn` | `#990000` / `#6a4000` | `#ff8080` / `#ffb84d` | TL |
| `--flow-edge` / `--casing` (new) | `#1b1b1b` / `#1b1b1b` | `#050505` / `#050505` | mockup casing. `--casing` covers the Connections fallback, hand-lit, label halo and swatch (`:1078`, `:1101`, `:1110`, `:1118`). |
| `--flow-hover` | `rgb(255 255 255 / 0.35)` | `rgb(0 0 0 / 0.3)` | TL. The 8% white alternative fails (3.79:1). |
| `--flow-focus` (new) | `#1b1b1b` | `#ffffff` | TL: box head and row focus ring (`:669`) |
| `--flange` (new) | `var(--slot)` | `#6e6e6e` | TL: `.flow-port` (`:686`) |
| `--dye-casing` (new) | `#c6c6c6` | same | D2: the casing for dark channel dyes (`ConnectionsView.tsx:186`) |
| `--conn-box` / `--conn-face` / `--conn-face-link` (new) | `var(--panel)` / `#e0e0e0` / `#1d3b9a` | `#303030` / `#3a3a3a` / `#8fb4ff` | TL. The contract forbids `var(--flow-` in Connections rules, so these are separate names. |
| `--conn-chest`, `-interface`, `-source` and their `-line` (new) | equal to Flow target, line and import | the matching dark Flow values | TL |
| `--conn-hookup` / `--conn-hookup-line` (new) | `#a8a8a8` / `var(--outline)` | `#242424` / `#6e6e6e` | TL |
| `--flow-chip` / `--flow-busy-track` (new) | `var(--screen)` | (follows) | P2: Flow chips and the busy track |
| `--flow-busy` / `--flow-busy-high` (new) | `#55ff55` / `#ffaa00` | same | P2 / mockup |
| `--stack-ink` / `--stack-shadow` (new) | `#ffffff` / `#3f3f3f` | `#ffffff` / `#000000` | D8. The dark shadow comes from DarkMode.dc.html:111. |
| `--bevel-inset` (new) | `inset 2px 2px 0 var(--panel-lo), inset -2px -2px 0 var(--panel-hi)` | (follows) | P2: recessed slot area |
| `--bevel-screen` (new) | `inset 2px 2px 0 #000000, inset -2px -2px 0 var(--screen-lo)` | (follows) | P2: readout tiles |
| `--energy` (new) | `#e03c3c` | same | P2: energy bar (Phase 1's failed-scan red) |
| `--progress-base` (new) | `#555555` | same | P2: the progress arrow's base on a chat box |
| `--skeleton` / `--skeleton-well` (new) | `#b5b5b5` / `#4a4a4a` | `#383838` / `#2a2a2a` | P2: skeleton blocks on panels or the page, and on wells |
| `--sheen` (new) | `rgb(255 255 255 / 0.1)` | same | P2 |
| `--tip-mod` (new) | `#8080ff` | same | D10: the tooltip's mod line |
| `--brand-mark`, `--brand-flow-1`, `--brand-flow-2` | logo C (§5) | same | D3 |
| `--icon-auto`, `--icon-moon`, `--icon-sun` (new) | the Theme button icons (§4.8) | same | D2 |

**The same in both looks:**
- `--outline`, `--btn-hover`, `--danger-face` and its hover, `--accent`, `--screen-text`, `--screen-muted`, `--chat`, the
  `--tip-*` set, `--item`, `--fluid`
- every `--tier-*`, the motion and font tokens, `--gap`
- `--flow-new-line` and `--flow-raw-line` (`#000`)
- the whole dark-box ink group
- tooltips, chat boxes, tier chips and the pipe contents. The dark look darkens the stone and deepens the screens, and
  nothing else.

The forced-colours block is theme-agnostic and stays last.

> **As built.** The final fix wave adds two tokens, each at the light look's own value: `--tab-on-ink`, the selected tab's label
> (`var(--text)`; dark `var(--accent)`: P2-R129), and `--bevel-track`, a slider's track (`var(--bevel-well)`; dark
> `inset 2px 2px 0 #000000, inset -2px -2px 0 #8b8b8b`: P2-R130); and `--thumb` colours every scroll bar's thumb as well as the
> slider's (P2-R128).

### 4.4 Rules that change from a literal to a token

About 40 rules read a light-only literal today. Each becomes the token from §4.3. [TL] §1.2 lists each one with its line;
the main ones are:
- disabled buttons
- field and search-list edges
- tick and radio wells
- the top-bar inner line
- tabs, including the selected tab's highlight (`var(--panel-hi)`) and ink (`var(--text)`)
- separators
- the `.mat-toggle` and map-row hovers
- the canvas grids
- the Flow focus ring, flanges, open-line frame and sink edge
- every Connections box fill, stroke and face
- the casings

These literals stay, because their colours are the same in both looks ([TL] §1.2):
- button text and its shadow
- the black fields
- brand gold
- the live dot
- banner items
- the modal and drawer backdrops
- icon placeholders and the slot veil over images
- the lamps and chips
- tooltips
- the hovered casing and the missing casing
- `.conn-via-*`
- the 3D sky
- World gold and the scan chips

Do this as a refactor that changes no pixel (task 1a): the light look must screenshot-diff to zero.

### 4.5 Contrast summary

**The dark palette.** The scout checked 203 dark-look pairs, and none is below its minimum ([TL] contrast.txt). These are
the tightest, with the minimum in brackets:

| Pair | Ratio |
|---|---|
| Panel error `#ff6b6b` on `#2a2a2a` | 5.17 (4.5) |
| Owned box muted text `#a8a8a8` on `#22402a` | 4.81 (4.5) |
| Owned box "no source" `#ff8080` on `#22402a` | 4.72 (4.5) |
| Connections face mode `#a8a8a8` on `#3a3a3a` | 4.78 (4.5) |
| ME-network carrier on the casing | 3.91 (3) |
| Missing casing on the well | 5.54 (3) |
| White head on the missing casing | 3.14 (3) |
| The tick-well edge | 4.21 (3, D2) |

**New Phase 2 pairs, light and dark.**

| Pair | Light | Dark | Minimum |
|---|---|---|---|
| Stack count `#ffffff` on its shadow | 10.53 | 21.00 | 4.5 (D8) |
| … on the slot face, for information only | 3.41 | 16.86 | — |
| Grid tick `#55ff55` on its `#000` edge | 15.82 | 15.82 | 3 |
| Grid tick edge on the slot face | 6.16 | — | 3 |
| Grid tick on the slot face (in dark, the green itself carries it) | — | 12.70 | 3 |
| Busy fill `#55ff55` on its track | 12.98 | 14.83 | 3 |
| Busy fill, high (`#ffaa00`) | 9.02 | 10.31 | 3 |
| Count chip text | 17.22 | 19.68 | 4.5 |
| Tier chip inks | ≥ 4.5 (Phase 1 pins) | ≥ 6.04 (UXV) | 4.5 |
| Machine power text on a new box | 5.19 | 5.55 | 4.5 |
| Machine power text on an owned box | 5.62 | 4.81 | 4.5 |
| Energy fill on its track | 4.00 | 4.57 | 3 |
| Recipe arrow fill on its base | 3.41 | 16.86 | 3 |
| Readout label and value | 7.41 / 12.98 | 8.47 / 14.83 | 4.5 |
| Strip "changed" accent | 16.15 | 18.45 | 4.5 |
| Tooltip mod line `#8080ff`, over a panel | 5.78 | 6.16 | 4.5 (`#5555ff` would be 3.70) |
| Toast text on a chat box, over a panel | 15.52 | 20.03 | 4.5 |
| Undo label (yellow) on the button face | 5.00 | 10.34 | 4.5 |
| Shortcut key caps | 5.33 | 11.03 | 4.5 |
| Pressed Grid/List toggle label | 10.34 | 15.63 | 4.5 |
| Meter fill | 12.98 | 14.83 | 3 |
| Sun and moon icons on the button face | 3.85 / 3.63 | 7.97 / 7.52 | 3 |
| Slider thumb `--thumb` on the panel | — | 3.34 | 3 (P2-D24) |

**Accepted below 3:1, each identified some other way:**
- In dark, button faces on panels are 1.30:1; buttons are identified by their labels.
- The new box fill on the well is 1.32:1; boxes are identified by their text.
- In dark, the flange on a new box is 2.59:1, the same as in light; it is a shape detail.
- The auto icon's dark half; the icon's light half and the button label carry it.

> **As built.** The flange on a new box is 1.99:1 in light (`--slot` on `--panel`), not 2.59:1 as in dark; both are accepted, a
> shape detail with a black edge. Every pair added while building is a row of `contrast.test.tsx`'s one table, run for both
> looks. The final fix wave adds the scroll bars' thumb on its track (3.23:1 light, 4.59:1 dark) and in the map's side column
> (4.05:1 dark), the selected tab's label (7.73:1, 13.46:1), a slider track's edge on the dark panel (4.21:1) and a field's edge
> on the dark panel (5.49:1), and reads the tick well's edge and the sun and moon from their tokens' text; its accepted dark
> exceptions are P2-R136's (§3.5).

### 4.6 First paint: the head script

Put this in `src/client/index.html`, in `<head>`, after `<title>`. It is a classic, synchronous ES5 script.

```html
<script>
  try { var t = localStorage.getItem('gtnh-planner:theme'); if (t === 'dark' || t === 'light') document.documentElement.setAttribute('data-theme', t); } catch (e) {}
</script>
```

- It runs before the stylesheet `<link>` and the module script that Vite appends, and Vite keeps classic inline scripts
  verbatim ([TL] §1.1).
- There is no CSP today (`static.ts:61-66`). A future CSP will need this script's `sha256-` hash.
- The login page is drawn by the same document, so it follows the stored choice too. It has no Theme button.

### 4.7 The store, `src/client/state/theme.ts` (pipes-paused.ts pattern)

```ts
export type ThemeChoice = 'auto' | 'dark' | 'light';
export const THEME_KEY = 'gtnh-planner:theme';
export const THEME_CHOICES: readonly ThemeChoice[] = ['auto', 'dark', 'light'];          // the button's cycle
export function getThemeChoice(): ThemeChoice;            // page value ?? valid stored value ?? 'auto'; try/catch; globalThis.localStorage?.
export function setThemeChoice(choice: ThemeChoice): void; // store (page value when refused or read-only), apply with the cross-fade, notify
export function nextThemeChoice(choice: ThemeChoice): ThemeChoice;
export function applyTheme(choice: ThemeChoice, root?: Pick<Element, 'setAttribute' | 'removeAttribute'>): void; // auto removes data-theme
export function subscribeThemeChoice(fn: () => void): () => void;    // listeners + `storage` events for THEME_KEY or null
export function useThemeChoice(): ThemeChoice;            // useSyncExternalStore(subscribe, get, get)
export function startTheme(): () => void;                 // main.tsx: applyTheme(getThemeChoice()); re-apply on another tab's change (instant)
```

- In node, `globalThis.localStorage` is undefined, so the store reads Auto in vitest.
- A module-level page value survives `vi.unstubAllGlobals()`, so tests reset it in `afterEach` ([MG] §2.1 has the same
  trap).

### 4.8 The Theme button

**Component.** `src/client/components/ThemeButton.tsx` is new. It takes its value as a prop and holds no hooks, like
PipesButton, so a test can call it and read `onClick`. TopNav reads `useThemeChoice()` and renders the button right after
`</nav>`.

```tsx
<button type="button" className="theme-button" data-choice={choice} onClick={() => setThemeChoice(nextThemeChoice(choice))}>
  {`Theme: ${LABELS[choice]}`}          {/* one text node: no <!-- --> in the markup */}
</button>
```

**Markup.** It is exactly `<button type="button" class="theme-button" data-choice="auto">Theme: Auto</button>`.
- The visible text is the name, so there is no `aria-label`.
- There is no `aria-pressed`. It is a three-state cycle whose label changes, the pattern R44 settles.

**CSS.**

```css
.theme-button { margin-left: auto; display: inline-flex; align-items: center; gap: 8px; padding: 0 12px; }
.theme-button::before { content: ''; flex: none; width: 16px; height: 16px; background: var(--icon-auto) center / contain no-repeat; }
.theme-button[data-choice='dark']::before { background-image: var(--icon-moon); }
.theme-button[data-choice='light']::before { background-image: var(--icon-sun); }
```

- The `:where(button)` base gives the 36 px face and the `15px/1` pixel font, so the top bar's height does not change.
- The icons are 8×8 SVGs with `crispEdges`, drawn at 2×. Their encoded data URIs are in [TL] svg.txt:
  - sun `#ffd84a`: `M3 0h1v7H3zM0 3h7v1H0zM2 2h3v3H2zM1 1h1v1H1zM5 1h1v1H5zM1 5h1v1H1zM5 5h1v1H5z`
  - moon `#c8d4ff`: `M2 0h3v1H2zM1 1h2v1H1zM0 2h2v3H0zM1 5h2v1H1zM6 5h1v1H6zM2 6h4v1H2z`
  - auto: `#c6c6c6` `M0 0h4v8H0z` and `#2a2a2a` `M4 0h4v8H4z`
- **Width.** The brand (about 238 px), the nav (about 183 px), the button (about 154 px), and the gaps and padding (80 px)
  come to about 655 px. So at 1280 px the bar is one row. Below about 655 px the button wraps to a second row.
- **Tab order.** The button comes after the nav, so `focus.spec.ts:40-44` still reaches Projects first, and
  `drawer.spec.ts:67` reaches Settings within its 10 Tabs. The button is inside `.top-nav`, which goes inert with the
  drawer.

### 4.9 The cross-fade

`setThemeChoice` runs `document.startViewTransition(() => applyTheme(choice))` when the browser has View Transitions and
reduced motion is off. Otherwise it calls `applyTheme` at once.

```css
::view-transition-old(root), ::view-transition-new(root) { animation-duration: var(--dur-slow); animation-timing-function: var(--ease-out); }
```

- The fade lasts 260 ms. Under reduced motion it is 0 ms, and the JS starts no transition anyway.
- Do not use the mockup's permanent `.themed *` transition. It would override every element's own transitions, which the
  contract pins ([TL] §4.2.5).
- During the swap, clicks go to the document. Playwright waits out its actionability checks, but e2e must **poll** for the
  final colours.
- When the OS itself changes from light to dark under Auto, CSS switches the look instantly, with no fade.

### 4.10 What both looks keep

- The 3D viewport's pale sky. Its pixels are tested, and the WebGL clear colour is transparent.
- The map terrain and the 3D scene.
- Item icons and their placeholders.
- Tooltips, chat boxes, tier chips and pipe contents.
- The modal and drawer backdrops.
- `.flow-canvas.focusing .dim { opacity: 0.18 }` (P2-D35).
- A dark browser tab hides the logo's `#141414` outline, while its light face, pipe and green still read (8.5–9.1:1). The
  approved mockup shows exactly this.

### 4.11 Every later feature in both looks (D1)

- **Tokens only.** Phase 2 rules read tokens. A colour literal is allowed only if it is the same in both looks and is on the
  contract's short allow-list: `#ffffff`, `#000000`, and the chat, tooltip, tier, pipe and dye literals.
  - A contract case checks every selector added by Phase 2, kept in a `PHASE2_RULES` list.
- **Contrast.** Each feature adds its pairs to the token-driven contrast test, for both looks.
- **The dark tour.** Task 1 adds a "dark tour" e2e (§4.12) to guard the built CSS against the minifier. Each later feature
  adds one computed-colour row to it, for example `.key-number` background `rgb(11, 11, 11)`.
- **Screenshots.** Each task's review includes screenshots of its screens in both looks. They are taken with
  `setTheme(page, 'dark')` from `tests/e2e/helpers.ts` (an `addInitScript` that stores the key) or with
  `colorScheme: 'dark'`.

### 4.12 Tests

**Unit, `tests/client/theme.test.tsx` (new, modelled on `pipes-paused.test.tsx`):**
- The store's default is Auto. It keeps each value, and reads junk as Auto. It survives storage that refuses or is
  read-only. Subscribe and unsubscribe work, and a `storage` event re-reads.
- `nextThemeChoice` cycles.
- `applyTheme` works against a fake root.
- ThemeButton's markup for each of the three values, and its `onClick` moves to the next value.
- **The head script.** Extract it from `index.html` and run it with `new Function('document', 'localStorage', body)`
  against stubs:
  - `dark` and `light` set the attribute.
  - `auto`, junk, `null` and a storage that throws set nothing.
  - The script names `THEME_KEY`, has no `type` or `src`, and sits inside `<head>`.

**`scaffold.test.tsx`:**
- Keep `:36-42` as it is.
- Add `toMatch(/<\/nav><button type="button" class="theme-button" data-choice="auto">Theme: Auto<\/button><\/header>$/)`.

**Contract (replacing "has one theme"):**
- There is exactly one top-level `:root[data-theme='dark']`, and exactly one `@media (prefers-color-scheme: dark)` holding
  `:root:not([data-theme='light'])`. The two have equal `declarations()`.
- Every name they declare is already in `rootTokens()`. None is a motion, font or gap token, a tier, the accent, a pipe
  content, chat or tip.
- No other rule's prelude mentions `prefers-color-scheme` or `data-theme`.
- The DARK table is pinned row by row, like `TOKENS`, and `TOKENS` gains a row for every new token.
- The two `<meta>` assertions are kept.
- A new "the theme switch" case covers the `.theme-button` rules and the `::view-transition` rule.

**`contrast.test.tsx`:** the token-driven table for both looks (§3.5).

**`tests/e2e/theme.spec.ts`, rewritten:**
1. **Auto follows the OS.** In a light context the page is `rgb(43, 43, 43)` and a panel `rgb(198, 198, 198)`. In a dark
   context they are `rgb(20, 20, 20)` and `rgb(42, 42, 42)`. Both say "Theme: Auto".
2. **The button cycles, and the choice outranks the OS.**
   - In a light context, click: the button says "Theme: Dark". Poll until the page is dark.
   - Reload: it is still Dark.
   - Click again: it says "Theme: Light".
   - In a dark context with `light` stored, the page is light.
3. **A chosen look is on the page before any app code runs.**
   - Set `addInitScript` to store `dark`, and abort `/assets/*.js` with `page.route`.
   - `#root` has no children, and the body is `rgb(20, 20, 20)`.
4. **The dark tour.** In a dark context:
   - the top bar is `rgb(11, 11, 11)`
   - an unselected tab is `rgb(31, 31, 31)`
   - a Flow `rect.flow-node-box` computes `fill: rgb(48, 48, 48)`
   - the login card is `rgb(42, 42, 42)`

**`focus.spec.ts`:** optionally, a dark variant in which a panel link's ring is `rgb(255, 255, 85)`.

### 4.13 Risks

- **Duplicated dark lists.** The equality case guards them.
- **The minifier.** The built CSS might merge or drop dark rules (the R28 lesson). The dark tour on the built page guards
  this.
- **View Transitions.** Clicks are captured during the swap, so tests poll.
- **Snapshot scripts.** The screenshot scripts (`scratchpad/shots/shoot*.mjs`) should set `colorScheme: 'light'` explicitly
  wherever the light look is meant.

## 5. Logo C (D3)

### 5.1 The pixel map

The map comes from `Main.dc.html:138-155` (rows), `:179` (palette) and `:186-196` (frames). `DarkMode.dc.html:168` holds the
same map. The grid is 16 × 16. A `.` is transparent, and `f` marks the pipe's 11 content cells ([TL] §4.1.1).

```
 0 ................
 1 .kkkkkk.........      machine 1: x1-6, y1-6 (orange contents)
 2 .kwwwmkkkkkkk...      pipe casing: rows 2-4 x6-12, rows 5-8 x10 and x12
 3 .kwoomkfffffk...      contents: (7,3) (8,3) (9,3) (10,3) (11,3), then (11,4) … (11,9)
 4 .kwoomkkkkkfk...
 5 .kmmmmk...kfk...
 6 .kkkkkk...kfk...
 7 ..........kfk...
 8 ..........kfk...
 9 .........kkfkkk.      machine 2: x9-14, y9-14 (green contents); the pipe enters its top at x11
10 .........kwwwmk.
11 .........kwggmk.
12 .........kwggmk.
13 .........kmmmmk.
14 .........kkkkkk.
15 ................
```

**Palette:**

| Code | Colour | Use |
|---|---|---|
| `k` | `#141414` | outline and casing |
| `w` | `#d8d8d8` | lit face |
| `m` | `#6e6e6e` | shade |
| `o` | `#ff8a1f` | machine 1's contents |
| `g` | `#55ff55` | machine 2's contents |
| `y` | `#ffd84a` | pipe contents |
| `d` | `#7a5a10` | a dark gold gap in the pipe |

**Frames.** Frame *k* paints content cell *i* as `d` when `(i + 3 − k) % 3 === 2`, and as `y` otherwise. So the gaps are:
- frame 0: cells 2, 5, 8
- frame 1: cells 0, 3, 6, 9
- frame 2: cells 1, 4, 7, 10

**Playback.** Play f0 → f1 → f2, 220 ms each. The gaps then move from machine 1 toward machine 2: forward, the way the
app's pipes run, as in `Main.dc.html:16-18`.
- `DarkMode.dc.html` and `Phase2Project.dc.html` play the frames backwards, so do not copy them.
- The still frame is frame 0.

**Scales:**
- top bar: 2×, 32 px
- login card: 4×, 64 px
- tab icon: 1×, 16 px (2× on HiDPI screens)

### 5.2 The SVG

There are seven paths in painter's order, with `shape-rendering='crispEdges'`. The scout checked this layering against the
mockup grid for all three frames, and they match ([TL] svg.txt).

```svg
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'>
  <path fill='#141414' d='M1 1h6v6H1zM6 2h7v3H6zM10 5h3v4H10zM9 9h6v6H9z'/>
  <path fill='#d8d8d8' d='M2 2h3v1H2zM2 3h1v2H2zM10 10h3v1H10zM10 11h1v2H10z'/>
  <path fill='#6e6e6e' d='M5 2h1v3H5zM2 5h4v1H2zM13 10h1v3H13zM10 13h4v1H10z'/>
  <path fill='#ff8a1f' d='M3 3h2v2H3z'/>
  <path fill='#55ff55' d='M11 11h2v2H11z'/>
  <path fill='#ffd84a' d='M7 3h5v1H7zM11 4h1v6H11z'/>
  <path fill='#7a5a10' d='M9 3h1v1H9zM11 4h1v1H11zM11 7h1v1H11z'/>   <!-- frame 0's gaps -->
</svg>
```

**Three tokens on `:root`.** The URL-encoded strings are in [TL] svg.txt.
- `--brand-mark` is the still frame above, 566 chars encoded.
- `--brand-flow-1` holds the yellow pipe plus frame 1's gaps: `M7 3h1v1H7zM10 3h1v1H10zM11 5h1v1H11zM11 8h1v1H11z`.
- `--brand-flow-2` holds the yellow pipe plus frame 2's gaps: `M8 3h1v1H8zM11 3h1v1H11zM11 6h1v1H11zM11 9h1v1H11z`.
- Each overlay is 243 chars encoded.
- The old 8×8 mark is retired.

### 5.3 Animation

The markup does not change. The `.brand-mark` span stays empty, so `scaffold.test.tsx:36-42` stays green.

```css
.brand-mark { position: relative; flex: none; width: 32px; height: 32px; background: var(--brand-mark) center / contain no-repeat; }
/* The pipe flows six turns and rests on the still frame (WCAG 2.2.2, ruling R31); reduced motion: never moves. */
.brand-mark::before, .brand-mark::after {
  content: ''; position: absolute; inset: 0; opacity: 0; background: var(--brand-flow-1) center / contain no-repeat;
  animation: brand-flow 0.66s step-end 6 -0.44s;
}
.brand-mark::after { background-image: var(--brand-flow-2); animation-delay: -0.22s; }
@keyframes brand-flow { 0% { opacity: 1; } 33.333% { opacity: 0; } }
```

**Timing:**
- `::before` shows during [220, 440) ms of each turn, which is frame 1.
- `::after` shows during [440, 660) ms, which is frame 2.
- In between, the background shows frame 0.
- 0.66 s × 6 turns = 3.96 s, which is ≤ 5 s. The motion ends at 3.74 s.

**When it plays.**
- There is no fill mode, so the overlays fall back to `opacity: 0`, which shows the still frame.
- Under the global reduced-motion rule, the negative delays mean both animations have already ended at t = 0. So the mark
  is still from the first paint.
- TopNav stays mounted across in-app navigation, so the animation plays once per page load.
- It does not replay on hover (P2-D34).

**The login card.** `.login::before` reads `--brand-mark`, so the card shows logo C's still frame at 64 px. A pseudo-element
cannot hold the overlays, so it stays still.

### 5.4 The favicon

In `index.html:8`, replace `<link rel="icon" href="data:," />` with
`<link rel="icon" type="image/svg+xml" href="data:image/svg+xml,%3Csvg …the --brand-mark still frame…%3E" />`.

- Use the same data URI as the token rather than a bundled file. Vite would emit a file as an un-inlined asset, and then
  the token could not be checked against it as text.
- Safari has historically ignored SVG favicons. A hand-drawn 32×32 PNG fallback is allowed, but the e2e browser does not
  need one.

### 5.5 Tests

**Contract:**
- Update `:550-564`. Decode `--brand-mark` and expect `viewBox='0 0 16 16'`, `crispEdges` and the 7 fill/d pairs.
- Decode `--brand-flow-1` and `--brand-flow-2` and expect the pipe plus their gaps.
- Keep the `.brand-mark` and `.login::before` rows. Add `position: relative`.
- New case: the brand's pipe flows a few turns and stops on the still frame.
  - The declared animation is `brand-flow 0.66s step-end 6 -0.44s`, and the `::after` delay is `-0.22s`.
  - Duration × count is ≤ 5, and there is no `forwards`, `backwards` or `both`.
  - The overlays declare `opacity: 0`.
  - `KEYFRAMES` gains `'brand-flow': ['opacity']`.
- New case: the tab icon is the brand mark. `index.html` contains `<link rel="icon" type="image/svg+xml" href="${uri}" />`,
  where `uri` is the token stripped of `url("` and `")`, and no longer contains `href="data:,"`.

**`chrome.spec.ts` (e2e, on the built page):**
- Normally, both overlays compute `animationName: brand-flow` and `animationIterationCount: '6'`.
- Under `reducedMotion: 'reduce'` the count is `'1'`.
- Both pseudo-elements must be read, because the minifier has merged pseudo-element lists before (R28).

### 5.6 Risks

- The mockups disagree on the frame order; use Main's.
- The logo stops after 6 turns, unlike the mockup's endless loop. Tell the user.
- Safari favicons. See §5.4.

## 6. The shared NEI tooltip (D11, D10)

### 6.1 Behaviour

**One host.** `TooltipHost` is mounted once in `App.tsx`, after `<NamePrompt />` (`App.tsx:40-46`). It draws a portal on
`document.body` and listens on `document`. It holds a single state, so **one tooltip shows at a time**.

**Triggers opt in with attributes:**
- `data-tip` holds the lines, joined by `\n`. The first line is the title, drawn white; the others are details, drawn
  `#aaaaaa`.
- `data-tip-mod` is optional. It adds a mod line, drawn `--tip-mod` (`#8080ff`) and italic.

**Resolution.** From the event target, `closest('[data-tip]')` finds the trigger, so the **innermost trigger wins**. That
works unchanged on SVG `<g>` elements inside the pan and zoom groups, with no state per box ([TT] §0).

| Input | Rule |
|---|---|
| Hover | `pointerover` from a mouse or pen. After the pointer rests **150 ms** (`TIP_DELAY_MS = HOVER_DELAY_MS`, `map/hover.ts:16`), the tip shows. Moving inside the same trigger keeps it and re-places it on `pointermove`, throttled to one rAF. Moving to another trigger hides it at once and starts a new wait. |
| Keyboard focus | `focusin` on an element that matches `:focus-visible`, after the same 150 ms. The tip is the trigger's, but it is **anchored to the focused element**, so a Flow row shows its box's tip at the row. `focusout` hides it. Enter or Space on the focused element hides it, and it stays hidden until the focus moves. |
| Touch | A tap shows the tip at once, placed above the element, **unless the tap acts**, and a second tap on the same trigger hides it. A tap acts when the trigger is interactive, or contains the interactive element that was tapped (`a[href]`, `button`, `input`, `select`, `textarea`, `summary`, `label`, `[role=button\|checkbox\|radio\|tab\|option\|link]`), or is an SVG element (the diagrams pick on a tap). Where a tap acts, it only acts. A **long press** (≥ 500 ms within 4 px) or keyboard focus shows the tip instead. The host prevents the `contextmenu` that follows a long press, and a long press never ticks or picks anything (P2-D21). `pointerover` and `pointerout` from touch are ignored. |
| Press | A mouse or pen `pointerdown`, caught in the capture phase, hides the tip. That trigger then shows nothing until the pointer leaves it, which is native `title` behaviour. During a drag the svg captures the pointer, and the svg has no `data-tip`, so nothing shows. |
| Escape | `keydown` on `document`, in the capture phase. **While a tip is visible:** hide it, keep its trigger quiet until hover or focus leaves it, and call `preventDefault()`, but **never** `stopPropagation()`. **When none is visible:** do nothing. The drawer skips a key whose default was prevented, so this stays one layer per press (R15). Flow's `window` listener (`FlowView.tsx:452-464`) ignores `defaultPrevented` and keeps doing so, so the same press still clears a Flow highlight (P2-D22). |
| Invalidation | `scroll` (capture, passive), `wheel`, `resize`, window `blur` and `visibilitychange` hide the tip. **While a tip shows, an rAF loop does three things:** it hides the tip when `!trigger.isConnected`, which covers a list that closes under a still pointer; it re-reads `data-tip`, because a replan changes a box's text; and it re-anchors focus and touch tips, because diagrams now glide. The loop stops when the tip hides. |

> **As built.** Touch: a tap acts when the trigger *or any ancestor* is an acting element, so an icon inside a button or an
> option only acts (ledger ruling P2-R20); the svg rule stays the trigger's own. Escape: every Escape consumer — the search
> lists, the field drafts, the project name, the pin dialog and the tip's own Escape — skips a key whose default was prevented,
> so one press closes one layer app-wide (P2-R21, P2-R21b); Flow's `window` listener is the one named exemption and still
> ignores it (P2-R21c). The host drops a shown tip whose trigger has come inside `[inert]`, under the sheet or the drawer
> (P2-R87). The project name's Enter renames and its Escape takes a draft back, each leaving the focus in the field (P2-R132,
> which reverses Task 3a's blur); an Escape with no draft goes on to the layers below. A settings draft that Escape takes back takes
> the key, so the drawer stays open (the final fix wave, FW-9), but only while it differs from what its field would show without it:
> one equal to it, as the Amount's draft is after a commit, is dropped and the Escape goes on to the drawer (P2-R141); and so is an
> item search's "No item or fluid matches" note a layer of its own, which the drawer's look reads as an open list (P2-R138; the
> search's error note, which its Escape leaves, is none).

### 6.2 Placement

- **The container.** It is `position: fixed` with `z-index: 200`, above the modal's 100. The host measures it in
  `useLayoutEffect` and writes `left` and `top` itself, as `MapView.tsx:413-420` does. The room is `clientWidth` by
  `clientHeight`.
- **Pointer tips** (hover). The tip goes 12 px right of and below the pointer, then flips and is clamped. This is
  MapTooltip's own rule, so the hovered 18 px row stays readable above the tip.
  - Move `along` from `MapTooltip.tsx:13-17` into `tooltip-model.ts` as `alongAxis(start, end, size, room, gap = 12,
    prefer = 'after')`, and import it back into MapTooltip.
  - `TOOLTIP_OFFSET = 12` stays exported from MapTooltip, because `map-hover.test.tsx:8` imports it from there. The six
    `tooltipPosition` cases are the regression net.
- **Element tips** (focus). The anchor is the element's `getBoundingClientRect()`, intersected with the outermost svg's
  rect. Walk up `ownerSVGElement`, because the boxes contain nested svgs.
  - When the intersection is empty, the element is panned out of view, so do not show the tip.
  - Align the tip with the anchor's left edge, 4 px below it, or 4 px above when there is no room below.
- **Touch tips** are placed like element tips, but above first.

> **As built.** An element tip's anchor must also meet the window, and a zero-area box — a straight Flow arrow — counts as in
> view when its extent meets the view, so a long press shows an arrow's tip (P2-R23).

### 6.3 Markup and CSS

**The host.** The tooltip exists in the DOM **only while it shows**, because `world.spec.ts:69` uses a strict
`getByRole('tooltip')`.

```tsx
// rendered only while a tip shows
createPortal(
  <div id={id} role="tooltip" className="nei-tooltip" data-state="open">   {/* closing: no role, aria-hidden="true" */}
    {lines.map((line, i) => <div key={i}>{line}</div>)}
    {mod !== null && <div className="nei-tooltip-mod">{mod}</div>}
  </div>, document.body)
```

```css
/* The page's one NEI tooltip (Phase 2 §6): the map tooltip's look, placed in the window by TooltipHost. It never takes the
   pointer (hit tests and Playwright's clicks need that) and sits above every layer, the modal included. */
.nei-tooltip {
  position: fixed; top: 0; left: 0; z-index: 200; pointer-events: none;
  width: max-content; max-width: 360px; padding: 6px 8px; overflow-wrap: anywhere;
  background: var(--tip-bg); border: 2px solid var(--tip-border); box-shadow: 0 0 0 1px #100010, inset 0 0 0 1px var(--tip-inner);
  color: #aaaaaa; font: 14px/1.35 var(--font-pixel); animation: tip-in 120ms var(--ease-out);
}
.nei-tooltip > :first-child { color: #ffffff; }
.nei-tooltip-mod { color: var(--tip-mod); font-style: italic; }
.nei-tooltip[data-state='closing'] { animation: tip-out 80ms var(--ease-in) forwards; }
@keyframes tip-out { to { opacity: 0; transform: translateY(2px); } }
```

- The 80 ms exit was moved to Phase 2 by P1 §8, and it is built for the shared tip only.
  - During the exit the tip has no role, it is `aria-hidden`, and `aria-describedby` is removed at once.
  - The tip unmounts on `animationend`, with a fallback timer of about 100 ms. A new tip during the exit replaces the old
    one at once.
  - MapTooltip and the 3D label keep their entrance only, because `styles-contract.test.tsx:1741-1742` forbids animations
    on other `.map-tooltip…` rules.
- `.nei-tooltip` is a rule of its own, never merged into `.map-tooltip`'s selector list (R1, and the pins at
  `:1586-1600`).
- The NEI box is the same in both looks. In forced colours its border survives, so it needs no rule.

> **As built.** `max-width: min(360px, 100%)`: a fixed box's containing block is the window, so a long tip wraps inside a phone's
> window instead of losing its right edge past it (ledger ruling P2-R131; WCAG 1.4.10). `.map-tooltip` keeps its 360px.

### 6.4 Call sites ([TT] §5)

**ItemIcon** (`ItemIcon.tsx:41-59`).
- New prop `tip?: false | readonly string[]`:
  - `undefined` gives `data-tip={label}`
  - an array gives the label followed by those lines
  - `false` gives no tip, for when a parent shows one
- `data-tip-mod={modName(itemKey)}` is written when the tip is on and the key's namespace is known (§6.5).
- `title` goes. `aria-label` stays.
- The attribute order becomes class, role, aria-label, data-tip, data-tip-mod, data-item-key, data-icon-source, style.
- The default tip stays a single line, because `avoid-picker.test.tsx:60` uses a regex without the `s` flag.

**Flow box `<g>`** (`FlowView.tsx:206-213`).
- Delete the `<title>`.
- Set `tip = tipText([...described, ...node.rows.map((r) => rowWords(node, r))])`.
- Append `aria-label={tip} data-tip={tip}` **after** `transform`, so `class` stays right before `data-node-id`.
- `rect.flow-node-box` becomes the first child.

**Flow arrow `<g>`** (`:262-266`).
- Delete the `<title>`.
- Append `aria-label={edge.title} data-tip={tipText([edge.name, edge.rate, edge.route])}` after `style`.
- Add an optional `FlowEdge.route` (`flow-model.ts:79-82, :614-615`), so the tip has three lines. The `title` text does not
  change.

**LineToggle** (`:127-139`). Delete the `<title>`, and add `aria-label={label} data-tip={label}`.

**Connections box `<g data-node>`** (`ConnectionsView.tsx:131-132`).
- Delete the `<title>`.
- Append `aria-label={tip} data-tip={tip}` after `transform`.
- **Links stay exactly as they are** (§3.2), so they get no tooltip.

**`tip={false}`** goes on:
- the icons inside Flow boxes: the 16 px row and head icons, and the new 32 px machine icon
- the icons under the three native-title ancestors: `AvoidPicker.tsx:51`, `SettingsPanel.tsx:255` and `ProjectPage.tsx:155`

Those ancestors keep their native titles. The upgrade path, converting them, is in [TT] §5.4.

**Data.** Every tip text comes from fields the views already hold:
- ItemIcon's `name` prop, or else its key
- the FlowNode's `title`, `lines`, `rows` and `avoidBadge`, through `rowWords`
- the FlowEdge's `name`, `rate` and `title`, plus the new optional `route`
- the ConnNode's `title`, `lines` and `faces`, through `faceTip`
- the mod line, from the item key's namespace

Nothing new comes from the server.

**Later tasks add tips through the same contract:**
- the recipe slots, through ItemIcon `tip` lines
- the grid slots, with `data-tip` on the slot button and `tip={false}` on the icon inside
- the toolbar buttons, with "Fit · F" and "Pause pipes · P" (§14)

### 6.5 Mod names (D10)

`src/client/components/mod-names.ts` holds `MOD_NAMES` (at most 15 entries) and `modName(key: StuffKey): string | null`.
- `modName` takes the registry namespace, which is the part before `:` in an item key, lowercases it, and looks it up.
  The lookup is case-insensitive (P2-D30), because `IC2` and `EnderIO` are upper-case in 1.7.10.
- A fluid key (`fluid:`) gives `null`, and so does an unknown namespace. That includes the e2e fixture's `t:` and `machine:`
  keys, so e2e sees no mod line.

| Namespace | Name |
|---|---|
| These eight are fixed: | |
| `gregtech` | GregTech |
| `minecraft` | Minecraft |
| `ic2` | IndustrialCraft 2 |
| `bartworks` | BartWorks |
| `gtnhlanth` | GTNH Lanthanides |
| `tectech` | TecTech |
| `appliedenergistics2` | Applied Energistics 2 |
| `enderio` | Ender IO |
| Proposed: | |
| `miscutils` | GT++ |
| `dreamcraft` | GT New Horizons |
| `railcraft` | Railcraft |
| `forestry` | Forestry |
| `tconstruct` | Tinkers' Construct |

### 6.6 Accessibility

**`aria-describedby`.**
- While a tip shows, it goes on the focused element when focus opened the tip, and on the trigger otherwise.
- It is merged in as one more token. On hide, only our id is removed, because React manages `aria-describedby` elsewhere
  (`SettingsPanel.tsx:127`).
- It is **skipped** when the tip says the same as that element's `aria-label`. So a screen reader does not say "Copper Wire,
  Copper Wire" (P2-D36).

**Names.**
- Each `<title>` becomes an `aria-label` with the same string on the same `<g>`, which keeps the named group. Nothing is
  lost: every `role=button` group already has its own `aria-label` ([TT] §1.4).
- Visually hidden text does not apply inside SVG.

**WCAG 1.4.13, accepted as MapTooltip already is (D11):**
- **Dismissible:** yes, with Escape.
- **Persistent:** yes.
- **Hoverable:** no. The tip follows the pointer with `pointer-events: none`, which `connections.spec.ts:71` and every
  Playwright click after a hover require.
- **Mitigations:** the same text is in each element's accessible name and in the side panels a click opens. Escape
  dismisses the tip. Focus tips do not depend on the pointer.

**Reduced motion.** The tip appears and disappears at once, with no fade (P1 §7a, "fades included").

> **As built.** The description is the tip's lines less what the element's name already says. A mod name is a name (plain
> Pixelify, not `<Figs>`). Name and lines compare by parts, with " · " and ", " folded: a line whose parts begin the name, or
> whose parts all appear in it, is `aria-hidden` in the tip and left out of the description, so an arrow gets none and a box
> head's is its rows (P2-R22, P2-R24, P2-R24b, P2-R24c). A button's own words and its `aria-keyshortcuts` count as said, so "Fit
> · F" describes nothing (P2-R82).

### 6.7 Tests

- **Deliberate updates:** 7 assertions in 4 files, plus a `route` field on the `flow-pipes` fixture edge (§3.9; [TT] §6.1 has
  each before and after).
  - React's server renderer keeps a literal `\n` inside attribute values, and escapes `& < > " '`.
- **New unit test, `tests/client/tooltip-model.test.tsx`:**
  - `alongAxis` gives MapTooltip's six cases.
  - `placeTip`, in pointer, below and above modes, clamps at all four edges, including in a room smaller than the tip.
  - `tipText` and `tipLines` round-trip and drop empty lines.
  - `createRestTimer` under fake timers: only the last target shows; the same target keeps its tip; another target hides
    at once; `now` shows at once; `clear` drops the wait.
  - `describes()`.
  - `modName`: case-insensitive, `null` for fluids and unknown namespaces.
  - `TIP_DELAY_MS === HOVER_DELAY_MS`.
- **Unit additions:**
  - ItemIcon `tip={false}` and tip lines.
  - A FlowNodeShape has no `<title`, and its box tag carries the rows' words.
  - No `span.item-icon` inside a box has a `data-tip`.
  - The LineToggle tip.
  - Connections markup has no `<title`.
- **Contract:**
  - the `.nei-tooltip` declarations
  - its `z-index` is above `.modal-backdrop`'s
  - the first line is white, and the mod line reads `--tip-mod`
  - the closing rule's animation
  - `KEYFRAMES` gains `'tip-out': ['opacity', 'transform']`
  - a source guard: `ItemIcon.tsx` has no `title=`, and FlowView and ConnectionsView have no `<title>`
- **Contrast:**
  - `#8080ff` on `TIP_OVER_WHITE` is ≥ 4.5
  - `#5555ff` is below AA, recorded as the reason for the change
- **New e2e, `tests/e2e/tooltips.spec.ts`.** Use auto-waiting `expect`, never sleeps ([TT] §6.3):
  1. A Materials icon has no `title`. Hovering it shows the name, the tip has `pointer-events: none` and sits inside the
     viewport, and moving away removes it.
  2. Hover icon A, then icon B: only B's tip shows.
  3. A Flow box's tip lists the machine and "takes Copper Ingot". Escape removes the tip, and the same press removes
     `focusing`.
  4. An arrow's tip has 3 lines.
  5. Keyboard focus on a step head shows the tip below it, with `aria-describedby` set. Tabbing away clears both.
  6. A Connections box's tip says "In / Out". A mouse press hides it.
  7. Touch (`hasTouch`): a tap on a Materials icon shows its tip, a second tap hides it, and a tap elsewhere hides it.
  8. Under reduced motion, `animationDuration` is `0.001s`.
  9. With the drawer open, the first Escape hides a tip in the drawer and leaves the drawer open; the second Escape closes
     the drawer.
- **Watch list:**
  - e2e: `world.spec.ts`, `connections.spec.ts`, `flow-focus.spec.ts` (2) and (6), `drawer.spec.ts`, `slots.spec.ts`
  - unit: `map-hover.test.tsx`, `avoid-picker.test.tsx`, `map-summary.test.tsx`, `plan-banner.test.tsx`

> **As built.** `describes()` had no caller in `src` and was deleted with its tests (P2-R89); `describedLines` carries its
> cases. In `tooltip-model.test.tsx`'s "describes what a tip says beyond the name of the element it describes…", a Flow head's
> case (a name that joins its lines with ", ") expects `[]` (P2-R24a).

### 6.8 Risks ([TT] §7)

| Risk | How to avoid it |
|---|---|
| A stale tip swallows Escape, so the drawer won't close | The `isConnected` check, and `preventDefault` only while a tip really shows |
| A hidden `role="tooltip"` lingers | The tip is mounted only while it shows |
| A missed hit test | `pointer-events: none` is mandatory |
| Newlines in markup break regexes | Keep ItemIcon's default tip on one line |
| Attribute order | Always append new attributes |
| Native-title ancestors cause doubles | `tip={false}` |
| `textContent` shrinks once the `<title>`s go | Run those three specs first (§3.8) |
| `aria-describedby` overwritten | Merge it as a token |
| Performance | About 13 document listeners. `closest()` runs on `pointerover` only, and `pointermove` work happens only while a tip shows. |

## 7. Flow boxes: the machine readout (D4)

### 7.1 Behaviour and look

**Every step box gets a 46 px head** (`Phase2Project.dc.html:125-151`):
- the machine's 32 px icon in a 36 px slot
- the 13 px/600 title
- a chip row holding the **tier chip** (for example `LV`, in the tier's colour), the **×count chip** (`×5`, or `×1 shared`
  for a pool) and the power text (`16 EU/t`)

**Below the head, a 16 px busy band.** A 6 px track is filled to `utilization`. The fill is `--flow-busy`, or
`--flow-busy-high` from 90 % up, and the band ends in the percentage.

**Below the band, as today:** the remaining lines ("supplies X", "N owned"), the avoid badge and the rows.

**What stays the same:**
- **One row per good, as today** (D4). The mockup's paired in-and-out line is not used ([FV] §4.1).
- **Widths stay 190–330 px.** The constants `MIN_NODE_WIDTH` and `MAX_NODE_WIDTH` are unchanged.
- Stubs (imports, missing, out, sink and line boxes) get no readout and look as they do today.

**A hand step's readout.** Its slot shows its main output. It has no tier chip and no count chip, and the chip row says "by
hand" in place of the power text. It keeps its busy band.

**The words stay.** `FlowNode.lines` stays exactly as it is today: the accessible words, the box tooltip, and the five
assertions that pin it (`flow.test.tsx:71, :235, :257-260, :274-275`). The head **draws** the readout in place of
`lines[0]`.

### 7.2 Model (`flow-model.ts`, pure)

```ts
/** A step box's machine readout (Phase 2 §7): what the head draws in place of lines[0], which stays as its words. */
export interface MachineReadout {
  iconKey: StuffKey | null;            // gregtech:gt.blockmachines@<mteId>; crafting table / furnace keys for -1 / -2; null by hand
  tier: { name: string; slug: string } | null;    // "LV", "lv" (tierText / tierSlug); null by hand
  count: string | null;                // "×5", "×1 shared" (pool); null by hand
  power: string | null;                // "16 EU/t" (formatNumber); null by hand or at 0 EU/t
  busy: number; busyText: string; high: boolean;  // clamp(utilization, 0, 1); formatPercent; utilization >= 0.9
}
export function machineIconKey(machine: PlanStep['machine'], handCraft: boolean): StuffKey | null;
export function machineReadout(step: PlanStep): MachineReadout;
export function tierSlug(t: number): string;   // 'ulv' … 'max'; 'unknown' outside 0..14 (shared with the recipe card)
// FlowNode gains `machine?: MachineReadout` (optional addition), set by stepBox (:439-452) for every step
```

**Machine icon keys.**
- The client has no helper for machine keys today. The keys of the pseudo machines live on the server only
  (`PSEUDO_MACHINE_ENTRIES`, `src/server/pack/machines.ts:41-44`).
- `machineIconKey` repeats `minecraft:crafting_table@0` and `minecraft:furnace@0`, and a unit test compares them with
  `PSEUDO_MACHINE_ENTRIES`. The server stays untouched (P2-D32).

**New exported metrics:**

| Constant | Value | Notes |
|---|---|---|
| `MACHINE_ICON` | 32 | |
| `MACHINE_SLOT` | 36 | at (8, 6) |
| `STEP_HEAD_HEIGHT` | 46 | |
| `BUSY_BAND` | 16 | the track is 6 px, at y + 5 |
| `CHIP_HEIGHT` | 16 | |
| `CHIP_PADDING` | 5 | |
| `CHIP_CHAR_WIDTH` | 9 | generous for Pixelify 13 px and for its Inter fallback |

- `NODE_TITLE_HEIGHT`, `NODE_LINE_HEIGHT`, `MAX_NODE_WIDTH`, `MIN_NODE_WIDTH`, the `LABEL_*` constants, `PORT_SIZE` and the
  flange stay as they are. `edgeTag` depends only on `LABEL_*`.

```ts
// rowsTop reads the same fields everywhere (ELK ports, drawn rows, fromElk's fallback), so all three move together
export function rowsTop(node: Pick<FlowNode, 'lines' | 'avoidBadge' | 'machine'>): number {
  const badge = node.avoidBadge === undefined ? 0 : 1;
  if (node.machine === undefined) return NODE_TITLE_HEIGHT + NODE_LINE_HEIGHT * (node.lines.length + badge);   // as today
  return STEP_HEAD_HEIGHT + BUSY_BAND + NODE_LINE_HEIGHT * (node.lines.length - 1 + badge);                   // lines[0] is the readout
}
```

**Width.** `sized()` also counts these for a box with a readout:
- the head: `8 + 36 + 8 + textWidth(title, 7.4) + 8`
- the chip row: `52 + chipWidth(tier) + 4 + chipWidth(count) + 6 + textWidth(power, 6.2) + 8`, where
  `chipWidth(s) = s.length × 9 + 10`
- the busy band: `8 + 60 + 6 + textWidth('>99.9%', 6.2) + 8`
- the remaining lines, the badge and the rows, as today

The result is clamped to 190–330. Each step box grows by 18 px for a one-line step. The canvas height is capped at 75 vh,
and no e2e assertion depends on it.

> **As built.** `CHIP_CHAR_WIDTH` is **10**, not 9: with the fonts blocked, seven tier labels (MV, HV, UV, ZPM, UHV, UMV and a
> bold MAX) spilled their chips at 9 px a character, so four of the chip widths above are 30/15 px, not 28/14 (ledger rulings
> P2-R8, P2-R8a). A crafting-table or furnace step that is not by hand draws no tier chip (plan ruling `pseudo-tier-chip`), and
> a farm step is a machine step with its own tier (`farm-step-readout`).

### 7.3 Markup (`FlowView.tsx`)

`MachineReadoutShape` draws inside the head (the `role=button` `<g className="flow-node-head">`). It sits in the head's
nested svg, so the box edge clips it. The head's hit rect is `rowsTop(node)` tall, so the chips and the bar are clickable
as part of the head.

```tsx
<g className="flow-machine" aria-hidden="true">
  <rect className="flow-machine-slot" x={8} y={6} width={36} height={36} />
  <path className="flow-slot-lo" d="M 8 6 H 44 V 8 H 10 V 42 H 8 Z" />      {/* top and left 2 px, --slot-lo */}
  <path className="flow-slot-hi" d="M 44 6 V 42 H 8 V 40 H 42 V 6 Z" />     {/* bottom and right 2 px, --slot-hi */}
  <foreignObject x={10} y={8} width={32} height={32}><ItemIcon itemKey={iconKey ?? node.key} size={32} name={node.title} tip={false} /></foreignObject>
  <g className={`flow-chip tier-${slug}`} transform="translate(52 25)"><rect width={w} height={16} /><text x={w / 2} y={12.5}>LV</text></g>
  <g className="flow-chip" transform={`translate(${52 + w + 4} 25)`}><rect width={w2} height={16} /><text x={w2 / 2} y={12.5}>×5</text></g>
  <text className="flow-node-power" x={…} y={37}>16 EU/t</text>
  <g className={high ? 'flow-busy high' : 'flow-busy'}>
    <rect className="flow-busy-track" x={8} y={51} width={track} height={6} />
    <rect className="flow-busy-fill" x={8} y={51} width={track * busy} height={6} />
    <text className="flow-busy-text" x={node.width - 8} y={57}>83%</text>
  </g>
</g>
```

**The rest of the head.**
- The title moves to x = 52, keeping its baseline at 19.
- The lines from `lines[1]` on are drawn at `62 + 16 i + 11`.
- The badge goes to `translate(BADGE_LEFT, 62 + 16 (lines.length − 1))`.
- The out row keeps the main output's 16 px icon, so `flow.test.tsx:122` still matches.

**Markup rules:**
- no new class or attribute on the node `<g>`
- no `<circle>`
- no second `rect.flow-port`
- no class containing the whole word `hl` or `dim`: use `flow-busy high`, never `busy-hl`
- the chip text is centred (`text-anchor: middle`)
- the 32 px icon is a bare ItemIcon that fills its own foreignObject, as `slots.spec.ts:96-125` measures every Flow
  foreignObject; the slot frame is drawn in SVG

**CSS:**

```css
.tier-ulv { --tier-ink: var(--tier-ulv); } /* … one per tier, also used by the recipe card's HTML chips … */ .tier-max { --tier-ink: var(--tier-max); }
.flow-node .flow-chip.tier-max text { font-weight: 700; }   /* the chip's `font` shorthand resets the weight on the text itself */
.flow-machine-slot { fill: var(--slot); } .flow-slot-lo { fill: var(--slot-lo); } .flow-slot-hi { fill: var(--slot-hi); }
.flow-chip rect { fill: var(--flow-chip); }
.flow-node .flow-chip text { fill: var(--tier-ink, var(--stack-ink)); font: 13px/1 var(--font-pixel); text-anchor: middle; }  /* beats .flow-node text */
.flow-node .flow-node-power { fill: var(--text-muted); font-size: 11px; }
.flow-busy-track { fill: var(--flow-busy-track); } .flow-busy-fill { fill: var(--flow-busy); } .flow-busy.high .flow-busy-fill { fill: var(--flow-busy-high); }
.flow-node .flow-busy-text { font-size: 11px; font-variant-numeric: tabular-nums; text-anchor: end; }
```

- No `drop-shadow` on chips or slots (`:1250`).
- Forced colours: `.flow-busy-fill { fill: Highlight }`, `.flow-busy-track, .flow-chip rect { stroke: CanvasText }`.
- **The chips' font.** Inside the diagram SVG the text keeps the system font. The two chips are the one deliberate
  exception: they use Pixelify 13 px and are sized from the character count (D4).

**R41 is folded in here (§17).**

> **As built.** The machine slot and its bevel strips have forced-colours rules (P2-R26); the e2e reads the computed fills.

### 7.4 Data

These fields exist already, and nothing on the server or in the API changes ([FV] §3):
- `PlanStep.machine.mteId`, `.name` and `.tier` (`plan.ts:228`)
- `count`, `owned`, `euPerTick` and `utilization` (`:229`), `handCraft` and `pool` (`:313`)
- `TIER_NAMES` and `PSEUDO_MACHINES` (`src/shared/gt/tiers.ts`), and `formatPercent` (`src/shared/format.ts:57-65`)

Icons go through the existing pipeline: `useItemIcon` with the `gregtech:gt.blockmachines@<meta>` resolver
(`src/server/assets/resolve.ts:26`). Where a machine's icon is missing, it shows its placeholder.

### 7.5 Accessibility, motion, theme

- The readout is `aria-hidden`. Its words are `lines[0]`, which the head's `aria-label` and the box tooltip already carry.
- There is no motion.
- The colours are tokens. In dark, the chips and the busy track are `#0b0b0b`, as in DarkMode.dc.html:89-96.

### 7.6 Tests

**Pure unit tests (`flow.test.tsx`):**
- `machineIconKey`:
  - mte 121 gives `gregtech:gt.blockmachines@121`
  - −1 and −2 give the crafting table and furnace keys, checked against `PSEUDO_MACHINE_ENTRIES`
  - a hand step gives `null`
- `machineReadout(step({}))` gives the tier `LV`/`lv`, `×5`, `16 EU/t`, busy 1, `100%` and `high`. A pool step gives
  `×1 shared`.
- `tierSlug` at its edges.
- `rowsTop` of a readout box is `46 + 16 + 16 (lines − 1 + badge)`.
- The existing check that ports match rows (`:392-423`) runs again over readout boxes.
- The width bounds (`:242-247`) still hold.

**Markup unit tests:**
- a readout box has `data-item-key="gregtech:gt.blockmachines@121"`, the chip texts, and a busy fill width of track × busy
- the flange case repeated **with** a readout, which checks `rowCentre(node, i) - 5` under the new head
- the two node-class pins still hold, and the markup still has no `hl`, `dim` or `<circle`

**Contract and contrast:**
- the new selectors join `FLOW_RULES` and `PHASE2_RULES`
- the tier class rules, the chip font, the busy colours, and no drop-shadow
- the pairs in §4.5

**e2e, `tests/e2e/flow-boxes.spec.ts`, on the fixture `wire` (`count: 2`, `utilization: 0.625`):**
- `[data-step-id="wire"] [data-item-key="gregtech:gt.blockmachines@111"]` has a count of 1
- the chips read `LV` and `×2`
- the fill's `getBBox().width` over the track's is about 0.625
- every chip's `getComputedTextLength()` is at most its rect's width minus 2 × padding, both with fonts loaded and with
  `**/*.woff2` aborted
- the dark tour gains a row: the chip rect's fill
- under `forcedColors: 'active'`, the busy fill and track differ, and the chips stay visible

### 7.7 Risks

| Risk | Handling |
|---|---|
| Paired rows | Rejected (D4) |
| Narrow stubs would break `flow.test.tsx:242-245` | Kept wide (D4) |
| Late Pixelify | Covered by the generous constant and the e2e text check |
| Missing machine icons | Placeholders, which `slots.spec` requires anyway |
| Forced colours | The rules above |
| Taller diagrams | Accepted |

## 8. The StepPanel recipe card (D7, D8)

### 8.1 Behaviour and look

`RecipeCard` sits between the summary lines (`<p className="muted">…</p>` and the shared line) and `PortsSection`
(`StepPanel.tsx:674-675`). It shows one run of the recipe the way NEI draws one.

1. **A head row.**
   - It holds the tier chip, `<span className="badge tier-chip tier-lv">LV · 32 V</span>`, adding `× N A` when amps > 1,
     and the caption "One run".
   - It has no tier chip for hand steps or pseudo machines.
   - The chip leads the card rather than sitting in the panel head. The `<h3>` must stay attribute-less, and the 228 px head
     has no room for it (P2-D23).
2. **The strip.** It sits in a recess (`--bevel-inset`):
   - the consumed input slots
   - an 8-step pixel arrow
   - the output slots
   - at the right: a vertical energy bar, and the time ("10 s") over the power ("16 EU/t")
   - The strip wraps with flexbox. At the 228 px minimum the power readout takes a line of its own; at e2e's 308 px it
     fits on one line.
3. **A 2 × 2 grid of readouts** (Pixelify 18 px `--screen-text` on `--screen`):
   - **Machines** `×5`. A pool step says "Shared machines" instead, which does not contain "Shares".
   - **Busy** `50%`.
   - **EU/t each** `16`.
   - **EU/t total**: `count × euPerTick + Σ reused.others[].count × euPerTick`.
   - A hand step shows Busy only.
   - Below 1100 px, where the panel is full width, the grid has 4 columns.
4. **Overclock chips**, as a `ul.oc-chips`:
   - "No overclock at LV", in the `now` tone, green.
   - Or "1 overclock at MV", then "2× faster" (recipeDurationTicks / durationTicks), then "N perfect from heat" or "perfect
     overclocks" as `note` chips, amber.
   - None for a hand step.

**What stays the same.** `PortsSection`, the fieldsets, the Overclock section with its `ul.oc-lines` (which the e2e reads),
the Swap and Stop sections, and every string. The card adds markup and changes none.

**Left out, all three of them.**
- The mockup's "Swap recipe…" button. Strict mode at `plan.spec.ts:14` would fail.
- "Show in 3D". It is a new cross-tab feature.
- The yellow note. No data is behind it.

**Slots** (D8):
- Each is a 36 px slot: an `ItemIcon` of size 32 is exactly a 36 px slot (§3.2).
- The stack count is bottom-right (§8.2).
- A chance tag is top-left in `#ffff55` Pixelify, for example `10%`, when `chance < 1`.
- A slot the plan does not supply in full gets `slot-short`: an inset ring in `--ink-error`, and ", not supplied in full" in
  its label.
- Hovering a slot lights the good in the Flow (`hoverFlowFocus`) and leaving restores it, the same pattern as the port
  rows.
- Slots are `<li>` elements, **not buttons**, because of role-name collisions (§3.8).

### 8.2 Stack counts (shared with the grid)

**`stackText(key, amount)`:**
- An item:
  - `''` for one, the Minecraft convention
  - the whole number up to 999
  - then `1.5k` with one decimal below 10 k, and whole `12k` above
- A fluid:
  - litres up to 999, as `144L`
  - then buckets: `1B`, `2.3B` (one decimal below 10 B, with `.0` dropped), `12B`, then `1kB`

**The `.stack-count` rule** is shared with §9:

```css
.stack-count { position: absolute; right: 1px; bottom: -2px; z-index: 1; pointer-events: none; font: 14px/1 var(--font-pixel);
  color: var(--stack-ink); text-shadow: 2px 2px 0 var(--stack-shadow); }
```

**Contrast.** Against its shadow the count reads 10.53:1 in light and 21:1 in dark. On the bare light slot face it would be
3.41:1, which is the Minecraft convention, accepted (D8).

**Width.** Check that "144L" fits a 36 px slot with fonts loaded and with them blocked.

### 8.3 Markup

```tsx
export function RecipeCard(props: { step: PlanStep; plan: Plan; index: PlanIndex; per: Per }): ReactElement   // no hooks
<div className="recipe-card" role="group" aria-label={`${mapName(step.mapId, nameOf)} recipe, one run`}>
  <div className="recipe-head">{tierChip}<span className="recipe-caption">One run</span></div>
  {hasSlots && (
    <div className="recipe-strip">
      <ul className="recipe-slots" aria-label="Takes per run">{ins.map(slot)}</ul>
      <GtArrow tone="panel" still={step.durationTicks <= 0} />
      <ul className="recipe-slots" aria-label="Makes per run">{outs.map(slot)}</ul>
      <span className="recipe-power">{share !== null && <span className="energy-bar" aria-hidden="true"><span className="energy-fill" style={{ '--share': share } as CSSProperties} /></span>}
        <span className="recipe-time">10 s<br />16 EU/t</span></span>
    </div>)}
  <dl className="recipe-stats">{stats.map((s) => <div key={s.label} className="readout"><dt>{s.label}</dt><dd>{s.value}</dd></div>)}</dl>
  {chips.length > 0 && <ul className="oc-chips" aria-label="Overclock">{chips.map((c) => <li key={c.text} className={`badge oc-chip ${c.tone}`}>{c.text}</li>)}</ul>}
</div>
// a slot:
<li key={`${side}:${i}:${key}`} className={short ? 'recipe-slot slot-short' : 'recipe-slot'} data-recipe-key={key}
    onMouseEnter={() => hoverFlowFocus({ kind: 'item', key })} onMouseLeave={endHoverFlowFocus}>
  <ItemIcon itemKey={key} size={32} name={slotLabel} tip={[`${amountWords} per run`, chanceLine, rateLine]} />
  {count !== '' && <span className="stack-count" aria-hidden="true">{count}</span>}
  {chance < 1 && <span className="slot-chance" aria-hidden="true">{formatPercent(chance)}</span>}
</li>
```

**Rules for the markup:**
- Use the index in keys, because `step.outputs` can list a good twice.
- Use `data-recipe-key`, **never** `data-port-key`.
- Use `slot-short`, **never** `port-short`.
- Add no fieldset, input, `data-slot`, button or `role="status"`.
- Add no aria-label containing "Tier".
- Never write "reused", "Shares", "Machine tier" or "0×".
- Never put `/min` rates in the visible text. A rate may appear inside a tooltip line.
- With no slots (the `flow.test` default steps), leave the strip out and keep the stats.

### 8.4 CSS

The tokens follow [SR] §4.4, with these changes:
- `.recipe-strip` takes `box-shadow: var(--bevel-inset)` on `--panel`.
- `.readout` (screen well, `--bevel-screen`) joins the dark ink group. Append it after the group's first 7 members, which
  are pinned.
- `.gt-arrow` and `.gt-arrow-fill` belong to the shared `GtArrow` component (§11.3).
- The tier chip reads the shared tier classes of §7.3: `.badge.tier-chip { color: var(--tier-ink) }`, which beats the
  `.badge` white, and `.badge.tier-chip.tier-max { font-weight: 700 }`.
- `.energy-fill { position: absolute; inset: 0; background: var(--energy); transform-origin: bottom; transform:
  scaleY(var(--share)); }`
- The new selectors join `FLOW_RULES` and `PHASE2_RULES`.
- Forced colours: the arrow fill and the energy fill become `Highlight`.

> **As built.** The overclock chips are `oc-now` and `oc-note`, as Phase 1's `.note` rule framed the amber chip (P2-R27), and
> crafting tables and furnaces get none (P2-R28). A short slot's red ring replaces its bevel; stack counts go on to M and MB;
> empty slot lists are left out (P2-R29). A slot's name is the good, ", N per run" (when not 1), ", P% chance" (below 100 %) and
> ", not supplied in full", and a fluid's always states its litres (P2-R32, P2-R32a); a chance tag is a whole percent, "<1%"
> below 1 % and at most "99%" (P2-R34). The energy track, the short ring and the arrow's base have forced-colours rules
> (P2-R33). Not built: the programmed-circuit slot and the main output's frame (§21). Below 1100 px the readouts stand four in one
> row, as §8.1 has them, and at 600 px or less two a row, where four ran a seven-glyph figure ("131,072") into the next tile
> (P2-R131, P2-R142: a row of as many as were 110 px wide wrapped them three and one beside the settings column, and spread a hand
> step's lone readout over the row). A good a run takes and gives back in full (a cell, a catalyst) leaves its rate in the line out
> of its tips, as its ports carry no flow and no need; an input the line does not supply keeps its true "0/min" (the final fix wave,
> FW-13).

### 8.5 Data

Every field exists already ([SR] §3):
- `step.inputs` and `step.outputs`, each a `Product { key, amount, chance }` with expected amounts. The nominal amount is
  `amount / chance` when `0 < chance < 1`.
- `durationTicks`, `euPerTick`, `overclocks`, `oc` (`recipeEuPerTick`, `recipeDurationTicks`, `machineVoltage`,
  `machineAmps`, `perfect`, `heatOverclocks`), `count`, `utilization`, `pool`, `reused.others[]` (`count`, `euPerTick`),
  `machine.tier`, `handCraft`, `mapId` and `mainOutput`
- `plan.names`, and `indexPlan`'s `inputs` map with `SHORT_INPUT_SHARE` for shortages
- `powerShare = euPerTick / (oc.machineVoltage × oc.machineAmps)`. Without `oc`, fall back to `V[tier] × 1`, as `ocLines`
  does. It is `null` by hand or at 0 EU/t.

Missing and left out: held items, EU at other tiers, parallels, heat.

**New pure helpers, beside `ocLines` in `flow-model.ts`:** `recipeSlots`, `stackText`, `recipeStats`, `ocChips`,
`powerShare` and `tierSlug` (§7.2). `ocLines` stays untouched; it is pinned verbatim.

### 8.6 The re-slide fix (D7)

**The cause.** `<StepPanel key={step.id}>` remounts the aside on every pick, and `.flow-panel`'s `slide-in-right` plays again
each time (`FlowView.tsx:669`, `styles.css:779`).

**The fix.**
- `FlowDiagram` renders `{panel !== null && <div className="flow-side">{panel}</div>}`.
- The wrapper stays mounted, so it slides in once: `.flow-side { position: sticky; top: 12px; min-width: 0; animation:
  slide-in-right var(--dur-slow) var(--ease-out); }`.
- The keyed aside drops `sticky`, `top` and the slide, and takes `animation: fade-in var(--dur-base) var(--ease-out)`. So
  each new step **fades in over 160 ms**.
- The narrow-screen rule (`:1144`) becomes `.flow-side { position: static } .flow-panel { max-height: none }`.

**What the fix keeps.**
- "Never animates the grid" and "no width" stay pinned. `.flow-side` joins that check.
- The key still resets the swap list's "more…" pages, the scroll, the `useId` radio groups and the arrow.
- A switch between RawPanel and StepPanel stops sliding too.

**Focus** (P2-D33).
- The aside gets `tabIndex={-1}`. The `h3` gets nothing.
- When a pick made from **inside** the panel replaces it (a Takes or Makes peer), the focus moves to the new aside, instead
  of dropping to `<body>`.
- A click on the canvas leaves the focus where it is.

> **As built.** A pick focuses the new panel's head with `preventScroll`, then scrolls it into view only when it is wholly
> outside the window (P2-R35, P2-R35a); Close the panel gives the focus back to the box that opened it, else to the canvas,
> never `<body>` (P2-R36). While a pan or a glide runs, both checks read where the head will rest (P2-R106, P2-R113).

### 8.7 Motion

**The arrow:**
- It runs `gt-arrow 1.6s steps(8) 3`, with `transform: scaleX` from 0, in 4.8 s, and then rests full. There is no fill
  mode.
- It runs again on each step picked, because the aside is keyed. A new plan for the same step does not rerun it.
- It does not move at 0 ticks (`still`).
- Under reduced motion it shows full.

**Elsewhere:** no count-up in the panel; the strip owns counting.

### 8.8 Tests

**Pure unit tests (`flow.test.tsx`):**
- `stackText` gives `''`, `'2'`, `'64'`, `'1.5k'`, `'72L'`, `'144L'`, `'1B'` and `'2.3B'`.
- `recipeSlots`: `{ amount: 0.1, chance: 0.1 }` gives an amount of about 1, with chance 0.1.
- `recipeStats` for the `asm` defaults, a hand step and a pool step.
- `ocChips`: none, the MV step, heat, and perfect.
- `powerShare`: 0.5, and `null` cases.
- `tierSlug`.

**`step-panel.test.tsx`, a new describe block:**
- The slots and their counts render: `wire` has an output count of `2`, and a fluid shows `72L`. Each slot has its
  `data-recipe-key`.
- **The number of `data-port-key` matches is unchanged** by the card.
- The arrow is `aria-hidden`. The time reads `5 s` for 100 t.
- A hand step has no `tier-chip` and no `energy-bar`.
- A step with no inputs or outputs renders no strip.
- Hover lights the good and leaving restores the focus. Use `findAll(RecipeCard({…}))`, as at `:94-106`.
- One guard for the e2e strings: `"Swap recipe"` and `"0 overclocks → 16 EU/t × 200 t"` each occur exactly once in the
  panel's text.

**Contract:**
- `.recipe-strip`, `.stack-count`, `.readout` (in the dark group) and `.energy-fill`
- the `.flow-side` and `.flow-panel` animation pins (§3.9)
- the arrow's finite run
- `KEYFRAMES` gains `'gt-arrow': ['transform']`
- the forced-colours rules

**Contrast:**
- the count on its shadow
- the chance tag on its shadow (`#ffff55` on `#3f3f3f`, 9.87:1)
- the 3.41:1 face, recorded with `toBeLessThan(4.5)`
- the energy fill at 3:1

**e2e, `tests/e2e/recipe-card.spec.ts`**, on `circuitLv()`: open the Basic Assembler, which takes 1 plate, 2 wire and 1
redstone and makes 1 circuit in 200 t at 16 EU/t.
- It shows 3 input slots and 1 output slot, and the wire slot's `.stack-count` reads `2`.
- `getByText('0 overclocks → 16 EU/t × 200 t')` still resolves in strict mode.
- Hovering a slot gives the svg `focusing`.
- The arrow's `animationIterationCount` is `'3'`, and `0.001s` under reduced motion.
- **No re-slide:**
  - Open a panel and wait until `.flow-side`'s `getAnimations()` is empty.
  - Fit, then click another box.
  - `.flow-side` has no running animation, and the complementary named `Step: <machine>` is visible.

### 8.9 Risks

- Strict-mode text collisions. The unit guard catches them early.
- Absent-word pins.
- A hook in `RecipeCard`.
- Width at 228 px minus a classic scrollbar. Check in the browser at 260 px and 340 px.
- Machine icon coverage.
- A hover left lit when a replan removes the slot. The port rows already have this weakness, and `selectStep` clears it.

## 9. "To build (once)" as an inventory grid (D9)

### 9.1 Behaviour

**The toggle.** "To build (once)" gains a **Grid / List** toggle in its head. **List is the default and stays the source of
truth for tests.** Grid is opt-in.
- The choice is remembered per browser, in localStorage under `gtnh-planner:materials-view` (`'list' | 'grid'`).
  Anything but `'grid'` reads as List.
- It survives the tab panel's remount on every tab switch.
- It is a display choice, not a project setting, so no op is sent.

**What the grid shows.**
- The top-level build lines (depth 0) as slots, grouped by `BUILD_GROUPS` in their order: Machines, Power, Piping &
  logistics, One-off items. Empty groups are left out.
- The children breakdown stays in the List.
- "Base materials for the build", "To run", "Left over" and "Build steps" are unchanged, and **so is the order of the
  page's sections**.

**Stacks.**
- `STACK_SIZE = 64`, so 80 gives [64, 16]. Amounts are rounded up first. The export has no real stack size, and tools are
  always 1 (`bom.ts:141-143`).
- A count shows only above 1.
- A fluid is one slot with no count; its litres go in the label and the tooltip.
- **Up to 9 stacks are drawn per item.** A tenth slot then reads `+N`: N more stacks, no icon, a centred `+N` in the
  stack-count style. It toggles the same row.

**Ticks.**
- There is one mark per row, `marks['build:<key>']`, with live sync from `project.marks`, so the grid needs no extra code.
- Clicking any stack of an item sends `[{ op: 'mark', row: 'build:<key>', on: !marked }]`, and every stack of the item
  shows the same state.
- Never invent ids per stack ([MG] §4.1.3).
- A ticked slot is dimmed by an overlay (`rgb(0 0 0 / 0.4)` on `::after`; never style `.item-icon img`, `:957`). It carries
  a 10 × 10 pixel tick in `--screen-text` at its top-left, with a 1 px `#000` edge on all four sides from four
  `drop-shadow`s on the tick's parent.

**Meter** (Grid only, P2-D31).
- It reads "Gathered N of M stacks", counting every stack, capped ones included.
- It is a `role="progressbar"` with `aria-valuemin`, `aria-valuemax`, `aria-valuenow` and `aria-valuetext`.
- Its fill is `transform: scaleX(var(--done))`, with a 260 ms transform transition. The mockup's `width` transition is not
  used.

**Group heads.** Each says, for example, "Machines · 3 of 11 still needed", or "all in your chests", counting rows.

**The hint.** "Click a stack to mark it as in your chests. Stacks split at 64, like in game."

**Folded in here:**
- R42 and R45 (§17)
- the Materials disclosures' height animation, moved to Phase 2 (P1 §8). Copy R16's `::details-content` rules onto
  `details.mat-have` and `details.mat-needed`. The `INLINE_SUMMARY` pins stay as they are.
- Optionally, the Task 5 minor "`.tick { align-items: center }` drops the tick below the icon when a disclosure opens".

### 9.2 Markup

All of it sits inside the existing `<section class="materials-section" aria-labelledby="to-build-title">`. Use **no nested
`<section>`**.

```tsx
<div className="mat-head">
  <h3 id="to-build-title">To build (once)</h3>
  {groups.length > 0 && <ViewToggle view={view} />}   {/* div.mat-view-toggle[role=group][aria-label="Show the build list as"]: two button.small, "Grid" / "List", aria-pressed, fixed labels */}
  {view === 'grid' && groups.length > 0 && <GatherMeter done={d} total={t} />}
</div>
{/* the "Nothing new to build…" or total <p className="muted"> exactly as today, a direct child, before any group */}
<BuildGrid groups={slotGroups} marks={marks} send={send} />   {/* or today's list groups */}
// one item's first stack:
<button type="button" className="mat-slot marked" role="checkbox" aria-checked="true" aria-label="Cupronickel Coil Block, 80× in 2 stacks"
        data-row="build:…" data-marked="true" data-tip={tip} data-tip-mod={mod} onClick={toggle}>
  <ItemIcon itemKey={key} size={32} name={name} tip={false} />
  <span className="stack-count" aria-hidden="true">64</span>
  <span className="mat-slot-tick" aria-hidden="true" />
</button>
// its further stacks (and the +N slot): aria-hidden, out of the tab order, same toggle
<button type="button" className="mat-slot marked" aria-hidden="true" tabIndex={-1} data-stack-of="build:…" onClick={toggle}>…</button>
```

**Rules for the markup:**
- **One control per row.** The first stack is a native `<button>` with `role="checkbox"`, `aria-checked`, and a **fixed**
  label that never changes with the state. That gives one tab stop and one checkbox per item, the same as the List.
- `[data-row=…]` stays unique inside the grid, with `data-row` before `data-marked`, as in Tick.
- `BuildGrid` is exported and holds no hooks, so tests can call it and fire `onClick` through `findAll`.
- React keys include the group id: `${group.id}:${row}#${i}`.
- Nothing before the total line contains `Machines`: the toggle says "Grid" and "List", and the meter says "Gathered".

### 9.3 CSS

New selectors only, after `styles.css:888`, using tokens throughout ([MG] §4.4 has the full list).

| Rule | What it does |
|---|---|
| `.mat-slots` | `grid-template-columns: repeat(auto-fill, 36px)` on `--panel`, with `box-shadow: var(--bevel-inset)` |
| `button.mat-slot` | resets the button, so `.item-icon` is the slot. Also `-webkit-touch-callout: none; user-select: none`, for the long press. |
| `button.mat-slot:focus-visible` | `outline-color: var(--ink-focus); z-index: 1`. That is dark on a light panel and yellow in dark; the mockup's yellow ring would be 1.6:1 (R12). |
| `button.mat-slot:focus-visible .item-icon::after { opacity: 1 }` | the keyboard veil. It is a separate rule, because `LIT_SLOT` is pinned. |
| `.mat-grid-group h4` | Pixelify 15 px in `--ink-title`. `.mat-group h4` is pinned and left alone. |
| `.mat-view-toggle button[aria-pressed='true']` | `background: var(--btn-lo); box-shadow: var(--bevel-btn-down); color: var(--accent)` |
| `.mat-grid` | `animation: fade-in var(--dur-base) var(--ease-out)`: the view cross-fade, once |
| `.mat-slot-tick` | `animation: pop var(--dur-fast) var(--ease-pop)` |

Forced colours:
- `button.mat-slot:not(:focus-visible) { outline: 1px solid ButtonText; outline-offset: -1px }`
- `.mat-slot-tick::before`, `.mat-meter-fill { background: Highlight }`
- `.mat-view-toggle button[aria-pressed='true'] { text-decoration: underline }`

### 9.4 Data

- `BomLine.key`, `amount` (a number; `BuildRow.amount` is text only), `why`, `have`, `where` and `group`
  (`plan.ts:319-325`)
- `buildName`, `haveText`, `whereLines`, `unavoidableKeys` and `isFluidKey`
- `project.marks` with `Mark.by` and `Mark.at`, and `localTime`
- `quantity()` moves from `MaterialsView.tsx:37-40` into `materials-model.ts`, exported, so the List and the Grid share its
  text

**New pure helpers in `materials-model.ts`:**
- `STACK_SIZE`
- `stackSplit(amount, size = 64)`
- `groupBuildSlots(lines, names, unavoidable)`, which gives `{ id, label, items: SlotItem[] }[]`
- `gatheredStacks(groups, marks)`
- `stillNeeded(items, marks)`
- `slotTipLines(item, mark, when)`

**The store.** `src/client/state/materials-view.ts` is new and follows the pipes-paused pattern: `MATERIALS_VIEW_KEY`,
`getMaterialsView`, `setMaterialsView`, `subscribeMaterialsView` and `useMaterialsView`.

**Tooltip lines**, through `data-tip` on the slot button:
1. the name, white
2. `need 80×`, plus ` · have 1,440 (64 reachable)` once the world is scanned
3. `row.why` as it is
4. "on the avoid list…" when the line is avoided
5. `✓ Ann, <time>` when ticked

The mod line comes from `data-tip-mod`.

### 9.5 Accessibility and motion

- Space and Enter toggle the slot, which is a native button.
- On touch, a tap ticks. A long press or focus shows the tip (D11).
- **Tick pop on mount.** Switching views remounts every ticked slot, so they all pop at once. That is accepted, as for
  `.tick-by`.
- Reduced motion: the global rule applies, and nothing new is needed.

> **As built.** The Grid/List toggle sits on `margin-block: -4px`, so the List stays pixel-identical (P2-R37); "+N" rolls up
> past 999 (P2-R39); a slot keeps `isolation: isolate` (P2-R42), and its forced-colours frame paints over its own icon, checked
> by a pixel (P2-R41). The view choice is one `createBrowserChoice` store (`state/browser-choice.ts`), shared with the Pause
> pipes setting, the look and the single-key switch (P2-R40). The Materials fixes (§17) move a shut row's shorter items by under
> a pixel, a recorded light-look exception (P2-R43). An item keeps the sizes of the nine stacks the grid draws and counts the
> rest (`stackCount`), so a huge build makes no array of billions; the meter, its spoken words and a slot's name write their
> counts as the List writes figures ("1,563 stacks"); the meter's box is `min(240px, 100%)` wide, so it stays in its head in a
> 320 px window (the final fix wave: FW-5, P2-R131).

### 9.6 Tests

**Unit, `materials.test.tsx`, a new describe block** (reset the store in `afterEach`, `:25`):
- `stackSplit`: 80 gives [64, 16], 128 gives [64, 64], 1 gives [1], 0 gives [], 0.25 gives [1], and 64.0000000001 gives [64].
- `groupBuildSlots`: the order, empty groups dropped, a fluid as one slot, and `avoid` carried over.
- `gatheredStacks` and `stillNeeded`.
- **Grid markup:**
  - a two-stack row has exactly one `data-row`
  - the first stack has `role="checkbox"` and `aria-checked`
  - an extra stack has `aria-hidden="true" tabindex="-1"`
  - `stack-count` appears only for counts above 1
  - `mat-slot-tick` appears only when the row is marked
  - the 9-stack cap and the `+N` slot
  - the meter's values
  - the toggle's `aria-pressed`
- `findAll(BuildGrid(…))`: `onClick` sends `{ op: 'mark', row, on: true }`, and `on: false` when the row is already
  marked.

**Unit, `materials-view.test.tsx` (new):** a copy of `pipes-paused.test.tsx`.

**Contract and contrast:**
- the slot reset
- the `--ink-focus` ring
- `.stack-count`
- the tick: `content: ''`, the clip-path and `pop`
- the meter's transition, on transform only
- the forced-colours rules
- the pairs in §4.5

**e2e, `tests/e2e/materials-grid.spec.ts`:**
1. List by default. Grid shows 36 × 36 slots, survives a reload, and a new context shows List again.
2. A slot click sets `data-marked="true"`, and the List then shows the row ticked.
3. Two contexts, modelled on `sync.spec.ts`: a tick in the Grid reaches the other page within 2 s.
4. Keyboard: Space toggles, and the ring is `rgb(27, 27, 27)`.
5. Hover or focus shows a `role=tooltip` with the name.

### 9.7 Risks ([MG] §4.6)

- **A Grid default would break tests.** It would break `slots.spec.ts:83-93`, `forced-colors.spec.ts:74-78` and
  `materials.test.tsx:156`. So List is the default.
- **Double tooltips.** The tooltip task ships first (D1).
- **Pinned selectors** (§3.2).
- **Store state leaking between tests.**
- **DOM size.** The 9-stack cap bounds it.
- **Stale ticks** when an amount grows. The List behaves the same way.
- **A shared row id.** One `build:<key>` can be both a top-level line and a Totals leaf. The List behaves the same way.

## 10. The key-numbers strip (D12)

### 10.1 Behaviour and look

**Where it goes.** `<KeyNumbers>` renders inside `.project-banners` (`ProjectPage.tsx:310-313`), **before** `<PlanBanner>`.
- It is **outside PlanBanner**, which must still render `''` when there is nothing to warn about.
- It goes inert with the drawer, as the banners do.

**The tiles** are readouts on `--screen` with `--bevel-screen`, **52 px** tall. Each has a label row and a value row. The
label row also carries a short qualifier at its right, in 11 px `--screen-muted` (P2-D27):

| Tile | Value | Qualifier |
|---|---|---|
| Output | in rate mode, `targetPerSecond` × the unit's seconds, unit `/min`, `/h` or `/s` (`L/…` for a fluid); in Make N, N | the target's name; in Make N, the time `formatDuration(makeN.totalSeconds)` |
| Peak power | `power.peakEUt`, unit `EU/t` | `${TIER_NAMES[voltageTier]} · ${amps} A` |
| Machines | Σ over `machineGroups(plan.steps)` of `group[0].count`, skipping `handCraft` and `PSEUDO_IDS` (the `bom.ts` rule; do not copy `lineBox`'s naive sum) | `N new` (Σ count − owned) |
| To build | `cost.build`, unit `raw` | `over 24 h`, or `not counted` when `horizonHours` is null; `+N not counted` when `unpriced > 0` |
| To run | `cost.runPerHour`, unit `raw/h`; in Make N this tile is **Batch** with `cost.batch` | |

**The cost sentence.**
- **`p.plan-cost` stays in the DOM with its text.** `build-cost.spec.ts` and `plan-banner.test.tsx:136` need it.
- It is **visually hidden by a sibling rule**, because the `<p>` cannot take a class:
  `.project-banners > .key-numbers ~ .plan-cost { position: absolute; width: 1px; height: 1px; overflow: hidden;
  clip-path: inset(50%); white-space: nowrap; }`.
- The `.plan-cost` rule itself is pinned and is not touched.
- Its caveats live on in the qualifiers.

**When the strip shows.**
- It renders for **every project with a target**, so its height never changes within a project (P2-D27):
  - while the plan is still `null`, a strip-shaped skeleton of the same height
  - an `ok` plan gives values
  - an empty or infeasible plan gives tiles reading `—`
- A project without a target has no strip. That is the case in `chrome.spec.ts`'s project.

**Numbers.**
- Values use `formatNumber`, compact from 100,000 up with 3 significant digits: `540k`, `5.4M`. The exact figures stay in
  the `.plan-cost` sentence and the visually hidden value.
- A rate written in words, such as "1 every 526 days", takes 15 px and does not count up.
- Overflow is clipped with an ellipsis.

**Count-up.** The value counts from the **last value shown** (a ref) to the new one over **400 ms**, easing out cubically,
in JS with rAF.
- It is instant on the first render, under reduced motion, for a value in words, and when the unit changes.
- SSE refetches of an identical plan change nothing, so nothing animates.

**The flash.** A changed tile flashes once: a 2 px `--accent` frame, `.key-number-flash`, with `animation: flash-out 700ms
var(--ease-out)` and `@keyframes flash-out { from { opacity: 1 } }`. It animates opacity only. The span is keyed by a change
counter, so the flash replays.

> **As built.** A figure that arrives in another unit neither counts up nor flashes: the strip remembers the unit of each
> settings state it drew (P2-R49). While the plan is on its way the strip's place is its own grid of five 52 px blocks, so it is
> as tall as the strip at every width (P2-R48), filled by the strip skeleton in the tiles' dark readout face in both looks
> (P2-R53). A figure's line box may be 30 px beside a unit, the tile staying exactly 52 px (P2-R45), and the tiles wrap to two
> rows below a 780 px window (P2-R47). The busy line sits on the strip's top-right corner (§11.3). In Make N the Output tile is
> the count of the settings its plan was made for, kept beside each state's unit (`planDrawn`), so an amount typed while the old
> plan is still on screen never shows beside that plan's time (the final fix wave, FW-13).

### 10.2 Markup and CSS

```tsx
<section className="key-numbers" aria-label="Key numbers">
  <dl>
    <div className="key-number" data-key-number="output">        {/* + " changed" while its flash runs */}
      <dt><span>Output</span><span className="key-number-sub">Iron Plate</span></dt>
      <dd><span aria-hidden="true">{shown}</span><span className="visually-hidden">{final}</span><span className="key-number-unit">/min</span></dd>
      <span key={changes} className="key-number-flash" aria-hidden="true" />
    </div> …
  </dl>
</section>
```

```css
.key-numbers { margin: 0 0 8px; }
.key-numbers > dl { display: grid; grid-template-columns: repeat(auto-fit, minmax(140px, 1fr)); gap: 8px; margin: 0; }
.key-number { position: relative; height: 52px; padding: 4px 10px; background: var(--screen); border: 2px solid var(--outline); box-shadow: var(--bevel-screen); }
.key-number dt { display: flex; justify-content: space-between; gap: 6px; font: 11px/14px var(--font-ui); text-transform: uppercase; letter-spacing: 0.06em; color: var(--screen-muted); }
.key-number dd { margin: 0; font: 24px/26px var(--font-pixel); color: var(--screen-text); font-variant-numeric: tabular-nums; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
```

- **Height.** 4 + 14 + 26 + 4, plus 2 × 2 of border, is 52 px. With the 8 px margin the strip takes 60 px, against 32.3 px
  today, so it adds **+27.7 px** (§3.6).
- **Layout.** At 1232 px and at 752 px the tiles fit in one row of 5.
- **Theme.** The tokens carry over to dark: the tiles become `#0b0b0b` (DarkMode `DARK.screen`).

### 10.3 Data

These exist already:
- `plan.targetPerSecond`, `target`, `names`, `power`, `steps`, `cost` and `makeN`
- `settings.mode`, `per` and `amount`
- `machineGroups` (`src/shared/plan/pools.ts:26-49`), `TIER_NAMES`, `PSEUDO_IDS`, `horizonText`
- `notCounted`, which must be exported from `plan-cost.ts:18-20`

**New pure module, `src/client/views/key-numbers.ts`:**
- `keyNumbers(plan, settings)` returns `KeyNumber[] | null`, with each item `{ id, label, value: number | null, text, unit,
  sub }`.
- `machineCount(plan)` returns `{ total, new }`.
- `countUpAt(from, to, elapsed, duration = 400)`.

**Component and hook, `src/client/views/KeyNumbers.tsx`:**
- `KeyNumbers(props: { plan; settings })`
- `useCountUp(target, ms)`, which re-renders from state through rAF (P2-D41). It is instant on the first render and under
  reduced motion.

### 10.4 Accessibility

- Screen readers read the **final value only**: the animating number is `aria-hidden`, and a visually hidden copy holds the
  final value.
- The strip is not a live region, so the changes are not announced. The plan banner's status and What changed already do
  that.
- The `.plan-cost` sentence stays readable.

> **As built.** The visually hidden copy holds the exact figure (`formatNumber`), with its unit and every qualifier of the cost
> sentence, and `p.plan-cost` is `aria-hidden`, so each fact reaches assistive technology once; a tile with no value says "not
> available".

### 10.5 Tests

**Unit, `tests/client/key-numbers.test.tsx`:**
- `keyNumbers` for: rate mode, Make N, a fluid, a rare rate, no cost, `unpriced`, a null horizon, a pool counted once, and
  hand and pseudo steps skipped
- `countUpAt` at its ends, and that it never goes backwards
- the static markup shows the final values
- `plan-banner.test.tsx` passes unchanged

**Contract:**
- the `.key-number` heights and line heights in px
- `flash-out` animates opacity only, and `KEYFRAMES` gains it
- the sibling hide rule
- tokens only
- `:664-667` stays untouched

**e2e:**
- `build-cost.spec.ts` gains strip checks: `.key-numbers` shows "To build" and "raw", and the horizon select updates the
  qualifier. Every `.plan-cost` assertion is kept.
- `chrome.spec.ts` gains a project **with** a target: the `.key-numbers` height is equal with fonts blocked and loaded, and
  is ≤ 60 including its margin.
- `layout.spec.ts`, after `:52`: `expect(box.y + box.height / 2).toBeLessThan(700)`. This strengthens the test.
- Under reduced motion, change the amount and poll until the final text shows, with no value in between.
- The dark tour gains a row.

### 10.6 Risks

| Risk | Handling |
|---|---|
| `layout.spec` and `connections.spec` points pushed below 720 | Measure in the browser before committing |
| A strip that appears late would shift the canvas during `connections.spec.ts:49-60`'s exact drag | It reserves its height |
| The sentence's caveats lost for sighted users | They move to the qualifiers |

## 11. Skeletons and the progress arrow (D13)

### 11.1 Behaviour

**Every loading `<p>` stays as it is**, visible, with the same text. Tests and screen readers keep it. An `aria-hidden`
skeleton is drawn **beside** it ([FB] §b1 lists all 16 status strings and their tests).

`src/client/components/Skeleton.tsx` is new: `Skeleton(props: { shape: 'cards' | 'project' | 'strip' | 'diagram' | 'lines'
| 'scene'; rows?: number })`. It renders only `aria-hidden="true"` divs, with no text and no inline style.

| Site | Shape |
|---|---|
| `ProjectList.tsx:150` | `cards`, three of them. They are never `.project-card` or `a.project-link`. |
| `ProjectPage.tsx:295` | `project` |
| KeyNumbers, while the plan is null | `strip` |
| `FlowView.tsx:690-692` and `:721` | `diagram` |
| `ConnectionsShell` at `:397`, `:400`, `:402` | `diagram`. **Never** in its busy state, which keeps the previous picture dimmed. |
| `MaterialsView.tsx:281` | `lines` |
| `LinePanel.tsx:161` and `View3D.tsx:229` | the first layout only (`layout === null`) |
| `MapTab.tsx:476-490` | a **sibling after** the `.map-tab-status` div, which `map-tab.test.tsx:46` pins exactly |
| `View3DTab.tsx:30` | the fallback becomes `<><p className="muted">Loading the 3D view…</p><Skeleton shape="scene" /></>` |

**Where skeletons never go.** A skeleton is never drawn together with the diagram it stands for, because
`connections.spec.ts:71` calls `elementFromPoint`. World page and projector loading lines stay as text only, because they
are short and quick.

### 11.2 CSS and motion

```css
.skeleton-block { position: relative; overflow: hidden; background: var(--skeleton); }
.skeleton-diagram, .skeleton-scene { background: var(--well); border: 2px solid var(--outline); box-shadow: var(--bevel-well); }
.skeleton-diagram .skeleton-block { background: var(--skeleton-well); }
.skeleton-block::after { content: ''; position: absolute; inset: 0; background: linear-gradient(90deg, transparent, var(--sheen), transparent);
  transform: translateX(-100%); animation: sheen 1.4s var(--ease-out) 3; }
@keyframes sheen { to { transform: translateX(100%); } }
```

- The sheen runs 3 × 1.4 s = 4.2 s, which is ≤ 5 s. Without a fill mode it then rests off the block's left edge, so no
  sheen shows.
- Every height is fixed in px, so nothing jumps when the data arrives.

### 11.3 The GT progress arrow

`src/client/components/GtArrow.tsx`: `GtArrow(props: { tone: 'panel' | 'chat'; still?: boolean })`. It is shared with the
recipe card and renders `<span class="gt-arrow [on-chat] [still]" aria-hidden="true"><span class="gt-arrow-fill"></span>
</span>`.

```css
.gt-arrow { position: relative; display: inline-block; flex: none; width: 22px; height: 16px; vertical-align: middle; background: var(--slot);
  clip-path: polygon(0 35%, 60% 35%, 60% 0, 100% 50%, 60% 100%, 60% 65%, 0 65%); }
.gt-arrow-fill { position: absolute; inset: 0; background: var(--stack-ink); transform-origin: left; animation: gt-arrow 1.6s steps(8) 3; }
.gt-arrow.on-chat { background: var(--progress-base); margin-right: 8px; } .gt-arrow.on-chat .gt-arrow-fill { background: var(--accent); }
.gt-arrow.still .gt-arrow-fill { animation: none; }
@keyframes gt-arrow { from { transform: scaleX(0); } }
```

- It runs 3 × 1.6 s = 4.8 s, then rests full.
- "Updating the plan…" gets the arrow **inside** its busy `<p>`:
  `<p className="muted"><GtArrow tone="chat" />Updating the plan…</p>`.
  - That keeps `.plan-banner:has(> p.muted:only-child) { animation: none }` working, and keeps the `role=status` text.
  - A plan that takes longer than 4.8 s shows a full arrow beside the status text. That is accepted (D17).

**R43 is folded in here (§17).**

> **As built.** The busy line no longer moves the page: a plan event changes no height above the tabs (P2-R18). With the strip
> shown, "Updating the plan…" is a 20 px chip on the strip's top-right corner, over a label row, never a figure or a control;
> with no strip it is visually hidden, for assistive technology and `getByText` (P2-R51). The drawer's status (R43, §17) says
> "The plan is updating…" (plan ruling `drawer-status-words`) and "No problems" when an update ends with none (P2-R52). The
> diagram's skeleton's three columns and their gaps shrink with a narrow window (`repeat(3, minmax(0, 110px))`,
> `clamp(12px, 6%, 40px)`), so a phone's window never scrolls sideways while a first plan or layout is on its way (P2-R131).

### 11.4 Tests

**Unit:** Skeleton's markup is `aria-hidden` with no text. Every site still contains its text, which the existing
assertions prove.

**Contract:**
- `KEYFRAMES` gains `sheen: ['transform']`.
- duration × count ≤ 5 for `.skeleton-block::after` and `.gt-arrow-fill`
- tokens only
- forced colours: `.gt-arrow-fill { background: Highlight }`

**e2e** (`tests/e2e/skeletons.spec.ts`), with `/plan` held by `page.route`:
- The Flow tab shows "Planning…" visible, plus an `aria-hidden` skeleton.
- The sheen's `animationIterationCount` is `'3'`, and `'1'` under reduced motion.
- Once the route is released, the skeleton is gone and the diagram is drawn.

### 11.5 Risks

| Risk | Handling |
|---|---|
| The exact pin `map-tab.test.tsx:46` | The map skeleton is a sibling after that div, never inside it |
| `elementFromPoint` | No skeleton covers a drawn diagram: not during Connections' busy state, and not on a re-layout |
| Skeletons that pop in for fast loads | Accepted: they are aria-hidden and show their final sheen state at once |
| The loading text and the skeleton telling different stories | The text stays the source of truth |

## 12. Toasts and Undo (D14)

### 12.1 Behaviour

**Placement.** One App-level region is rendered after `<RoutePage/>`, so it survives in-app navigation. It sits fixed at the
bottom right, 16 px in.
- It holds at most 3 toasts, and the oldest is dropped first.
- Each toast stays **5 s**.

**Pausing.**
- A toast pauses **while the pointer moves over it** and resumes when the pointer leaves. A toast that appears under a
  pointer that does not move still times out (P2-D28).
- It also pauses while focus is inside it.
- It also pauses while the document is hidden.

**Look and motion.**
- It enters with `toast-in` (opacity, plus `translateY(12px) scale(0.96)`), 260 ms with `--ease-pop`, once.
- It leaves in 180 ms (`--dur-exit`). The store keeps it mounted while it leaves.
- Under reduced motion it appears and disappears at once.

**Toasts never handle Escape.** They have no tooltip.

**The toasts.** These are exactly D14's list. Their texts avoid every string in §3.8.

| Action, where | Text | Undo |
|---|---|---|
| Project created: `ProjectList.tsx:125-142`, before it navigates | Created “X” | — |
| Renamed: `ProjectPage.tsx:305` | Renamed to “X” | Sends `rename` back to the previous name. Its key is `rename:<id>`, so a newer rename replaces the toast. |
| Deleted: `DeleteProject` `onDeleted`, from the page or from the list row | Deleted “X” | `restoreProject(id)` (`api/projects.ts:18-20`). A `409 not-deleted` counts as done. A 404 shows "Could not restore “X”". On success it bumps a "projects changed" signal (`state/projects-changed.ts`, the pin-focus pattern) that the list's load effect depends on, and clears the stale "deleted" notice. The key is `project:<id>`, so the list's own Restore dismisses the toast. |
| Note added: `NotesView.tsx:70-76` and the map's NoteDialog | Note added | — |
| Note deleted: `NotesView.tsx:35-37` | Note deleted | Cancels the deferred delete (§12.2) |
| Command copied: a successful copy in `ProjectorPanel.tsx:196-207` | Command copied | — |
| Upload started / finished: `WorldPage.tsx:493`, `:496` | Upload started / Upload finished | — |

- A copy that fails shows no toast; the in-place hint covers it.
- Revoking a token has no toast; the confirm and the row's removal are the feedback.

> **As built.** A toast born while the drawer or the sheet holds the region inert waits, its time stopped, and shows once they
> close; one already drawn stays drawn and paused, and is announced once (P2-R56, P2-R56a, P2-R72); the holders compose
> (P2-R88). A rename's toast goes with its page (P2-R54), and `act()` retires a toast before running its action (P2-R58). A
> toast whose expiry commits a change — the deleted note — is not paused by a hidden page, nor, while the page is hidden, by any
> other hold (`runsHidden`), so the delete still posts about 5 s later (P2-R63, P2-R65).

### 12.2 Deferred note delete (exact Undo with no API change)

**Why.** There is no op that restores a note. Adding it back with `addNote` would make whoever clicks Undo the author, stamp
it "now" and move it to the end of the list ([FB] §c4).

**The store gains a deferred send.** `project-store.ts` adds `sendLater(ops): { cancel(): void; flush(): void }`.
- The batch applies to the visible project at once, as a pending batch layered on `confirmed`.
- It posts when the toast expires or is dismissed (through `onExpire`).
- It also posts on the store's `close()`, **before** `closed = true`, and on `pagehide` through `fetch(…, { keepalive: true
  })`. That needs a `keepalive` option on `api/client.ts:32-49`.
- Undo is `cancel()`.
- A flush also dismisses its toast, because the Undo is then gone.
- `sendLater` reaches the views as an optional `sendLater?` on `ProjectViewProps`.
- Other users see the note go about 5 s later.

**The flush must live in the store.** React runs deletion effects parent first, so a flush in NotesView's cleanup would run
after `useProject` had already closed the store.

> **As built.** A project's op batches post one at a time, in order, so an Undo lands after what it undoes (P2-R59); a post
> aborts after 60 s, counts as failed, and the store resyncs from the server (P2-R64). On `pagehide`, and on `freeze`, whatever
> still waits is sent at once with keepalive, merged and split at the server's 100-op limit (P2-R62, P2-R63, P2-R65); a project
> delete waits for its deferred posts (P2-R65). Cancel in the type-the-name confirm stops a delete still waiting for them, and
> leaves the confirm ready to ask again; Cancel and Escape in it give the focus back to the button that opened it, and the
> keyboard's Delete keeps the focus in the form while it waits (the final fix wave, FW-6). A delete confirmed from a list row hands
> the focus on as the row goes: to the nearest row left's link, the next, else the one before, else the New project field, else
> `<main>` (P2-R140).

### 12.3 Markup and CSS

`src/client/state/toasts.ts` follows the scout's API ([FB] §c3):
- `createToastStore(clock?)`, `showToast(text, { action?, key?, ms?, onExpire? })`, `dismissToast(idOrKey)`, `pauseToast`,
  `resumeToast` and `useToasts()`
- `useToasts()` uses `useSyncExternalStore` and has a server snapshot

`src/client/components/Toasts.tsx`:

```tsx
<section className="toasts" aria-label="Notifications">
  <ol aria-live="polite" aria-relevant="additions">            {/* always mounted, even empty; never role="alert" or role="status" */}
    <li className="toast"><span>Deleted “Steel line”</span>
      <button type="button" className="small primary">Undo</button>
      <button type="button" className="small" aria-label="Dismiss">×</button></li>
  </ol>
</section>
```

- `.toasts` takes `position: fixed; right: 16px; bottom: 16px; z-index: 40; pointer-events: none; max-width: min(360px, 100vw
  - 32px)`. Layer 40 is below the drawer backdrop (50), the drawer (60), the modal (100) and the tooltip (200).
- `.toast` takes `pointer-events: auto`. It is a chat box with a 2 px outline in Inter 13 px, because toasts are sentences
  (R35). It joins the dark ink group, appended after the 7 pinned members.
- **The drawer layer (R36).** While the drawer is open, `.toasts` goes inert along with `.top-nav`, set in
  `ProjectPage.tsx:277-290`. Otherwise Tab would escape the drawer to an Undo button (`drawer.spec.ts:76-85`).

### 12.4 Accessibility

- The region is polite, and only additions are announced.
- It is a labelled region, so screen-reader users can reach it through landmarks.
- **WCAG 2.2.1.** The timed Undo is a shortcut. Every action it undoes stays reversible elsewhere:
  - Restore in Recently deleted
  - renaming again
  - adding the note again

  Focus inside a toast pauses it.

> **As built.** Undo or Dismiss from the keyboard moves the focus before the toast goes: back to where it came from, else to the
> next toast's same button, else to the page's `<main>` (P2-R57); a note's Undo then hands it to the restored note's Delete
> (P2-R74). A deleted project's Undo never gives it back to a control under Recently deleted, whose row it takes away with the
> project it restores (the final fix wave, FW-7).

### 12.5 Tests

**Unit, `tests/client/toasts.test.tsx`:**
- the store under fake timers: expiry, pause and resume, the limit of 3, dismissal by key, and an action that runs and then
  dismisses its toast
- the static markup has `aria-live="polite"`, no `role="alert"`, and an Undo button

**Unit, `project-store` additions:**
- `sendLater` applies the batch at once and posts on expiry, on `close`, and on `pagehide` with keepalive
- `cancel` posts nothing

**e2e, `tests/e2e/toasts.spec.ts`:**
- Delete from the project page, then Undo: the link is back, and the Recently deleted row is gone.
- Rename, then Undo.
- Delete a note, then Undo: the same text, author and position come back after a reload.
- A note delete with no Undo reaches a second context within 7 s.
- Under reduced motion, a toast is present with no entrance.

**Watch list:**
- `delete.spec.ts` both tests (the Restore and Delete clicks may land near the toast)
- `projector.spec.ts`
- `world.spec.ts`

### 12.6 Risks

| Risk | Handling |
|---|---|
| Playwright clicks a target under a toast | Its pre-check sees the toast without moving the mouse, and retries with other scroll alignments, so the hover pause never starts. At worst the click waits out the 5 s. |
| A toast persists into the list page | Its text never says "was deleted by" |
| Two live announcements at once (upload finished, and the in-place status) | Accepted. The toast text is short and distinct. |

## 13. In-app confirms (D15)

### 13.1 Behaviour

`src/client/components/InlineConfirm.tsx` is new.

```tsx
export function InlineConfirm(props: { question: string; confirmLabel: string; cancelLabel?: string /* 'Keep it' */; busy?: boolean;
  onConfirm(): void; onCancel(): void }): ReactElement
// <div className="inline-confirm" role="alertdialog" aria-labelledby={qid}><p id={qid}>{question}</p>
//   <div className="row"><button type="button" className="small danger">{confirmLabel}</button><button type="button" className="small">Keep it</button></div></div>
```

**Token revoke** (`ProjectorPanel.tsx:187-195`).
- **Revoke** no longer calls `window.confirm`. It sets `asking: tokenId`, and the confirm appears **inside the same
  `<li data-token-id>`**, in place of the row's Revoke button.
- The question is `revokeQuestion(label)`, unchanged and pinned: `Revoke "Steve"? Anyone using it loses the ghosts until
  they get a new token.`
- The buttons are **Revoke token** (danger) and **Keep it**.

**Focus.**
- On open, the focus goes to Keep it, the safe button.
- **Keep it** gives the focus back to the row's Revoke button.
- A successful revoke moves the focus to the "Who is it for?" field, because the row is gone.

**Escape.**
- Escape calls `preventDefault()` and cancels. So inside the drawer the drawer stays open, one layer per press
  (`drawer.spec.ts:196-211`).
- It never calls `stopPropagation`.

**Naming.**
- The confirm is named by its question, **never** "Confirm delete" (`delete.spec.ts:18`).
- It has no `data-token-id` of its own and no inline style (`projector-panel.test.tsx:35, :130-133, :145-149`).
- New view props are optional: `asking?`, `onAskRevoke?` and `onCancelRevoke?`.

**Note delete uses Undo, not a confirm** (§12.2). NotesView's `confirm()` goes.

**After this task** there is no `window.confirm`, `alert` or `prompt` anywhere in `src/client`. A source guard checks it.

> **As built.** Tab stays in the confirm while it asks; a revoke on its way moves the focus to Keep it; the focus is given back
> only when lost, never to `<body>`; a row revoked elsewhere takes its question with it (P2-R66). A revoke that went through is
> said on the panel's polite line, and a failure in the same words alerts once (P2-R68, P2-R70, P2-R70a). One document-level
> guard keeps a held Enter from acting twice wherever the focus goes (P2-R69, P2-R69a), and every Enter handler skips a
> prevented key (P2-R76). No shortcut acts inside a confirm (P2-R73). The Connections panel's Close and the Make section's Clear
> hand the focus on (P2-R77, P2-R78).

### 13.2 CSS

- `.inline-confirm` joins the dark ink group as a chat box, appended.
- It enters with `rise-in` once.

### 13.3 Tests

**Unit:**
- the InlineConfirm markup
- `ProjectorPanelView` with `asking` set: the question is inside the token's `<li>`, the `data-token-id` count is still 2,
  and there is no `style=`
- the source guard against `confirm(`, `alert(` and `prompt(`

**e2e, `projector.spec.ts` (§3.9):**
- Click Revoke, then `getByRole('alertdialog', { name: /Revoke "Steve"/ }).getByRole('button', { name: 'Revoke token' })`.
  "No tokens yet." then shows.
- A Keep it path: the token stays listed, and the focus is back on Revoke.
- A guard: `page.on('dialog', …)` collects nothing.

### 13.4 Risks

| Risk | Handling |
|---|---|
| `getByRole('button', { name: 'Revoke' })` also matches "Revoke token" | The confirm replaces the row's button while it asks, and the updated spec scopes its click to the alertdialog |
| A revoke that fails leaves the confirm open | Show the error in the row, keep the confirm, and keep the focus on Keep it |
| An Escape inside the drawer | Handled by `preventDefault` (§13.1) |

## 14. Keyboard shortcuts (D16)

### 14.1 Behaviour

**One handler.** `ProjectPage` adds a **bubble** listener on `document`. React's root listener runs first, so
`e.defaultPrevented` already reflects what elements did with the key. A pure function decides what each key does.

**The handler skips:**
- a typing target, decided by `isTypingTarget`:
  - an `input`, unless it is a checkbox, radio, range, button, submit, reset, file, color or image input
  - a `textarea`, a `select`, or anything contenteditable
  - anything inside `[role=combobox]` or `[role=listbox]`
- a key with Ctrl, Meta or Alt held
- a repeating key or a key during composition
- a key whose default was already prevented
- every key while the drawer is open, the sheet is open, or any `[aria-modal="true"]` exists (NamePrompt, the map's
  NoteDialog)

| Key | Action |
|---|---|
| `/` | Focuses the Make section's item search (`SettingsPanel.tsx:177-182`), with `preventDefault`, so the `/` is not typed and Firefox's quick find does not open. Below 900 px it opens the drawer and focuses the search instead of Close settings. ItemSearch gains an optional `shortcut` prop that writes `aria-keyshortcuts="/"`; the cost form's ItemSearch gets none. |
| `1`–`6` | `location.hash = '#' + PROJECT_TABS[i].id`: Map, 3D, Connections, Flow, Materials & steps, Notes (`project-tabs.ts:23-30`). The tab's button then takes the focus. Use `e.key`, not `e.code`, for AZERTY keyboards. The tab buttons gain `aria-keyshortcuts="1"` … `"6"`; nothing pins their markup. |
| `F` / `f` | Clicks the active panel's `[aria-keyshortcuts~="F"]` button, the Flow or Connections Fit. That picks up the animated Fit of §16. On any other tab it does nothing. |
| `P` / `p` | Clicks `[aria-keyshortcuts~="P"]`, the Pause pipes button, on Flow and Connections only. It never silently changes a setting that is not on screen. |
| `Esc` | Uses the existing layers, top first: a tooltip, then the sheet, then open search lists, then an inline confirm, then the drawer, then the Flow highlight. The shortcut handler adds nothing here. |
| `?` | Opens the shortcuts sheet (`e.key === '?'`, so it works on any layout). |

**One deliberate markup change** (together with R44):
- Fit becomes `<button type="button" class="small" aria-keyshortcuts="F">Fit</button>`, in both diagrams.
- PipesButton becomes `<button type="button" class="small" aria-keyshortcuts="P">Pause pipes</button>`.
  - `aria-pressed` goes, and the label still changes between Pause pipes and Play pipes.
  - React writes attributes in prop order, so keep `type`, then `className`, then `aria-keyshortcuts`.
- Both buttons gain tooltips through the shared host: `data-tip="Fit · F"` and `data-tip="Pause pipes · P"` (or
  `"Play pipes · P"`). Their names do not change.

**The sheet.** `src/client/components/ShortcutsSheet.tsx`:
- It is a portal on `body`, holding `.modal-backdrop > div.modal[role=dialog][aria-modal=true][aria-labelledby]`, with the
  `h2` "Keyboard shortcuts".
- It holds a `<dl>` of `<kbd>` caps: Pixelify 14 px with the button look, 28 px tall. The rows are the mockup's, from
  `Phase2Feedback.dc.html:195-202`.
- **While it is open**, `#root` is inert, so Tab cannot leave the sheet. The focus moves to its Close button.
- **Escape, Close or a click on the backdrop** closes it, and the focus goes back to whatever had it before.
- **Escape stops there.** The sheet calls `preventDefault()` and `stopPropagation()` on Escape. It is the modal top layer,
  so nothing below it should react to the key (P2-D22).

**Discoverability** (P2-D29).
- A `button.small` "Shortcuts" with `aria-keyshortcuts="?"` goes last in `.project-head`. The head row is already 36 px, so
  it adds no height.
- The Settings toggle stays the head's first child.
- The Flow and Connections hints gain "? shows the shortcuts".

**Folded in here:** R44, R46 and R47 (§17).

> **As built.** WCAG 2.1.4: the sheet has a "Use single-key shortcuts" switch, kept per browser; off, no key acts, `?` included,
> `aria-keyshortcuts` and the Fit/Pipes tips are left off and the hints drop "? shows the shortcuts"; the sheet stays reachable
> by the head's Shortcuts button above 900 px and by a Keyboard shortcuts button at the end of the settings column at 900 px or
> less (P2-R85; plan ruling `shortcuts-button-wide`). The Shortcuts button sits before Delete project (P2-R83). `/`, `?` and the
> range's en dash are spoken as words (P2-R86). In the sheet Tab goes round the switch and Close, and its words can be selected
> (P2-R81, P2-R81a). Closing it gives the focus back to its opener while that is drawn — not `<body>`, not a control in a closed
> drawer — else the head's Shortcuts button, else the drawer's Keyboard shortcuts button (at 900 px or less, the drawer open), the
> selected tab, then `<main>` (P2-R71, P2-R90). The hints were shortened so they grow no taller (P2-R84). The Esc row says what
> Escape does, "Hide a tip, close a list, a question or the drawer, clear the highlight", in place of the mockup's words, which
> named a panel no Escape closes (P2-R134). R46: the column takes the focus when the window outgrows the drawer only if the
> control that had it is no longer drawn, or the focus was already lost (plan ruling `aside-refocus`; P2-R80); and a window that
> narrows to the drawer's width moves a focus in the column, or on the head's Shortcuts button, to the Settings button, and one on
> the head's Compare modes to its twin in the bar under the banner (P2-R133); one that widens past it moves a focus on the Settings
> button to the project's name, and one on the bar's Compare modes to the head's (P2-R139). Escape layers in the drawer: a draft
> taken back, one that differs from what its field shows without it (FW-9, P2-R141), and an item search's no-match note (P2-R138)
> each take a press before the drawer closes.

### 14.2 Tests

**Unit, `tests/client/shortcuts.test.tsx`:**
- `isTypingTarget` for each input type, `select`, `textarea`, contenteditable, and a combobox ancestor
- `shortcutOf` with modifiers, `defaultPrevented`, composition, repeat, the digits 1–6 and 7, `/` and `?`

**Unit, deliberate updates:** see §3.9.

**e2e, `tests/e2e/shortcuts.spec.ts`**, on the LV circuits plan at `#flow`:
- `5` selects "Materials & steps".
- Typing `1` into the project name or Amount field does not switch tabs.
- `/` focuses the search, and its value stays empty.
- `?` opens the dialog "Keyboard shortcuts". Escape closes it and gives the focus back.
- `P` toggles the label between Pause pipes and Play pipes.
- `F` refits. On Connections, the `g.conn-pan` transform then equals the fitted one.
- At 800 × 900 with the drawer open, `1` does nothing.
- At 800 × 900, `/` opens the drawer with the focus in the search.

### 14.3 Risks

| Risk | Handling |
|---|---|
| The `/` typed into the newly focused field, or Firefox's quick find opening | `preventDefault` |
| Digits typed into fields switching tabs | `isTypingTarget` |
| AZERTY layouts | Decide on `e.key` |
| A shortcut acting on a hidden setting | F and P act only on the diagram tabs |
| The e2e suite | It presses only Tab, Shift+Tab, Escape and Enter, so no existing spec triggers a shortcut |
| A strict-locator collision | "Shortcuts" collides with no e2e name |

## 15. Goods riding the pipes (D5)

### 15.1 Behaviour

**What rides.**
- One small icon of each edge's good rides its Flow pipe, from the output port to the input port. Each rider is 12 px in
  diagram units, drawn from the row icons' 16 px cache entry.
- **At most 1 per edge and 150 per diagram.**
- **Above `PIPE_ANIMATION_LIMIT` (200) edges, only lit edges** get riders.
- Missing-source edges, and edges of zero length, get none.

**What stops them.**
- **Pause pipes**, a drag in progress and a dimmed edge stop them.
- **Reduced motion draws none.**
- Riders are Flow-only in Phase 2 (P2-D19).

**Speed.** A rider moves four times as fast as its pipe's dashes: 64 px per `pipeSeconds` cycle. That is about the mockup's
70 px/s. Each ride is clamped to 1.2–12 s.

**Stagger.** Each rider's `animation-delay` is `−phase × dur`, where `phase` comes from a hash of the edge id. It is
deterministic, so riders do not all leave their ports together, and server and client markup agree.

### 15.2 Model (`pipe-motion.ts`, pure)

```ts
export const RIDER_LIMIT = 150;
export const RIDER_SIZE = 12;
export function pathLength(points: ReadonlyArray<readonly [number, number]>): number;
export function riderSeconds(length: number, perSecond: number, fluid: boolean): number;   // length / 64 × pipeSeconds, clamped 1.2–12, hundredths
export function riderPhase(id: string): number;                                            // 0 ≤ phase < 1
/** None from a missing source or of no length; above PIPE_ANIMATION_LIMIT edges only the lit ones; lit first, then the largest rate, then id; at most `limit`. */
export function riderEdges<E extends { id: string; perSecond: number; points: Array<[number, number]> }>(
  edges: readonly E[], lit: ReadonlySet<string> | null, missing: ReadonlySet<string>, limit?: number): E[];
```

### 15.3 Markup and CSS

**The layer.** Riders go in a layer of their own, `<g className="flow-riders" aria-hidden="true">`, **between the edges and
the nodes** in the pan group.
- A rider paints over its pipe, slips under the box at each flange, and stays under the lit tags.
- It never goes inside `FlowEdgeShape`, whose child list is pinned.

**One rider.** `FlowRiderShape` is one per rider, because of the icon hook. It calls `useItemIcon(edge.key, 16)`.

```tsx
<image className="flow-rider item|fluid [hl|dim]" href={url} x={-6} y={-6} width={12} height={12}
       style={{ offsetPath: `path('${d}')`, '--rider-dur': `${s}s`, animationDelay: `-${delay}s` } as CSSProperties} />
// url === null: <rect className="flow-rider placeholder …" x={-6} y={-6} width={12} height={12} fill={rgb(desc?.fallbackColor ?? hashColor(key))} />
```

```css
@keyframes pipe-ride { from { offset-distance: 0%; } to { offset-distance: 100%; } }
/* goods riding the pipes (Phase 2 §15): pipe contents, so they may move for ever, and Pause pipes stops them with the pipes */
.flow-rider { offset-rotate: 0deg; animation: pipe-ride var(--rider-dur, 3s) linear infinite; pointer-events: none; image-rendering: pixelated; }
.flow-canvas.dragging .flow-rider, .flow-canvas.pipes-paused .flow-rider, .flow-rider.dim { animation-play-state: paused; }
@media (prefers-reduced-motion: reduce) { .flow-rider { display: none; } }
```

- `offset-rotate: 0deg` stops icons turning sideways on vertical runs. `offset-anchor` is `auto`, which is the origin
  `0 0`, hence `x = y = −6`.
- **Rider classes.** A rider carries `hl` or `dim` from the focus sets. So `.flow-canvas.focusing .dim` fades it with its
  pipe, and `flow-focus.spec.ts:52` counts no `.dim` once the focus clears.
- **What riders never carry:** `flow-edge`, `data-step-id` or `rect.flow-port`.
- **No `drop-shadow`** (`:1250`).
- **`pointer-events: none` is essential.** An SVG `<image>` is hit-tested by default, so without it a rider would steal
  Playwright's clicks and `hitOf()`.
- **`many-edges`.** No rule is needed: `riderEdges` already limits the riders.

**The endless guard** grows by this one rule, deliberately (§3.9, P2-D18).

### 15.4 The spike, first and with no commit

The spike checks two things. Its results are recorded as rulings, and they decide D5's mechanism.

**(a) `offset-path` on an SVG `<image>`** inside `<g transform="translate(40 30) scale(2)">`. At `offset-distance` 0 % and
100 %, the image's `getBoundingClientRect()` centre must equal the path's start and end, mapped through `getScreenCTM()`.
Check this in Chromium and WebKit.

**(b) The glide spike for §16.** A WAAPI `transform` on a `<g transform=…>` must end exactly on the attribute, in both
engines.

**If (a) fails in WebKit, use SMIL `<animateMotion path dur repeatCount="indefinite" begin="-Xs">`:**
- **Pause and drag:** `svg.pauseAnimations()`, which pauses the whole svg.
- **Dimmed riders:** hidden with `display: none`, rather than paused.
- **Reduced motion:** the CSS `display: none` plus the JS check, so no riders are rendered.
- **Tests:** they read `animationsPaused()` and poll positions.

> **As built.** The spike chose branch A (`rider mechanism`, P2-R91): CSS `offset-path` on an `<image>`, centred exactly on the
> path's ends in Chromium 153 and WebKit 26.6; no SMIL. WebKit glides as Chromium does (`WebKit glide`, P2-R92), and
> `canGlide()` still feature-detects. A rider is one `<image>` from its mount, its placeholder a data URI of the fallback colour
> swapped in place (P2-R96); its path runs `RIDE_OVERHANG` (9 px) into each box, so a ride starts and ends out of sight
> (P2-R97); riders take the FADES opacity transition (P2-R94) and come in the edges' order, so a hover restarts no ride
> (P2-R93); over the limit, pipes rank by the units their dashes use (P2-R98). Riders take no forced-colours rule (P2-R95).

### 15.5 Tests

**Pure unit tests:**
- `pathLength`
- `riderSeconds` at its clamps
- `riderPhase` is stable
- `riderEdges` drops missing edges, caps at 150, ranks lit edges first, and above 200 edges returns lit edges only (none
  without a focus)

**Markup unit tests:**
- `FlowRiderShape` renders `class="flow-rider item"` and the offset-path style, and falls back to the placeholder rect
- the edge markup is unchanged, which the existing pins prove

**Contract:**
- `KEYFRAMES` gains `'pipe-ride': ['offset-distance']`, commented as a deliberate exception, like `pipe-flow`
- the `.flow-rider` declarations
- the three pause selectors
- the reduced-motion `display: none`
- the endless list of 4

**`pipes.spec.ts`:**
- **Goods ride:** the first `.flow-rider` has `animationName` `pipe-ride`, and its `offsetDistance` changes within 2 s while
  it stays attached. Poll, as R40 does.
- `elementFromPoint(riderCentre)` is not a rider.
- There are no more `.flow-rider`s than `.flow-edge:not(.missing)`s.
- The reduced-motion test also checks that riders compute `display: none`.
- The drag and Pause pipes tests also check that the riders' `animationPlayState` is `paused`.

**Deferred F8, recommended here.** A 201-edge fixture: `.many-edges` is set, and riders appear only on lit edges.

### 15.6 Risks

- **Performance.** 150 image draws come on top of the dashes. Take a Chrome trace of the 513-edge plan with lit riders, and
  of the 199- and 241-edge plans with all of them.
- **Engine support.** The spike covers it.
- **WCAG 2.2.2.** Riders stop with Pause pipes.

## 16. Diagrams glide (D6)

### 16.1 The mechanism

**The animation.** Use WAAPI on the CSS `transform`, with **absolute** keyframes, for example
`[{ transform: 'translate(OXpx, OYpx)' }, { transform: 'translate(NXpx, NYpx)' }]`, and `fill: 'none'`.
- The `transform` attribute already holds the final value, committed by React, so the last frame equals it and the hand-off
  is seamless.
- In SVG, CSS px are user units and the origin is `0 0`.
- **Never use an implicit end keyframe for `transform`.** In WebKit the underlying CSS transform is `none`.
- These animations show in `document.getAnimations()`, so tests can finish them.

**What this replaces.**
- This is the recorded exception to "no CSS transform on `<g>`" (§3.3).
- CSS `translate` transitions are rejected. They would sit outside the pinned `FADES` rule, and WebKit's composition with
  the attribute is unverified ([FV] §4.3).

**Motion tokens in TS.** `src/client/state/motion.ts` exports:
- `GLIDE_MS = 260`, equal to `--dur-slow`
- `PAN_MS = 250` (P1 §7a)
- `EXIT_MS = 180`, equal to `--dur-exit`
- `EASE_OUT`, equal to `--ease-out`
- `prefersReducedMotion()`

A contract case checks the numbers against `:root`.

### 16.2 Pan and zoom first

**The pan group.** It gets `ref={panRef}` and `className="flow-pan"` (`FlowView.tsx:595`). Nothing selects it today, and
the class lets e2e read it the way `connections.spec` reads `g.conn-pan`.

**`glideTo(next)`.**
- `from` is `viewOnScreen(g)` while a pan runs, which reads the running matrix; otherwise it is the committed view.
- It cancels the running pan, records `pendingGlide`, and calls `setView(next)`.
- A `useLayoutEffect` on `[view]` then starts `glideView(g, from, next)`, which runs 250 ms with `--ease-out`.
- The new attribute and the animation start in the same frame, so nothing flashes.

**What glides:**
- `fit`, `zoomCentre` (the + and − buttons) and `centre`, which covers Find item, the issue Show buttons and "Show in the
  flow" while the Flow is shown
- `centreNext`, when a line opens or closes
- the `viewKey` reset, when a previous layout was on screen

**What stays instant:**
- The first mount and a reveal on a fresh mount. `flow-focus.spec.ts:33-35` measures the initial view.
- **Wheel and drag.** While a pan runs, they first commit `viewOnScreen(g)` into the view, then cancel the pan. A drag takes
  its origin `ox`, `oy` from that committed view.

**Connections** (P2-D20). Its Fit glides on `g.conn-pan` with the same `glideView`. It has no zoom buttons. Arrow-key pans,
drag and wheel stay instant. `connections.spec.ts:45-46` reads the attribute, which is final at once.

> **As built.** One `usePan` hook drives both diagrams' pans (P2-R102). A pan's start is read at the commit, from the picture on
> screen (P2-R103), and a pan belongs to the view object `glideTo` made, tagged in a WeakSet in place of `pendingGlide`
> (P2-R108). The wheel, a drag past `DRAG_THRESHOLD` and the arrow keys hold a running pan where it is and go on from that
> picture; a click lets it run (P2-R104). Connections' resize refit ends a Fit in flight (P2-R105). A new plan's view and a line's
> box centred are panned to only when the new layout glides; one that snaps takes its view at once (P2-R126, Task F4). A press
> let go outside the Flow canvas before it became a drag ends at the next move with no button held, as Connections' does, so
> the view never follows the bare mouse (the final fix wave, FW-11), and its release anywhere, heard on the window while the press
> is pending, ends it, so a later press elsewhere dragged onto the canvas carries nothing on (the final fix wave's residuals).

### 16.3 Then the re-layout

**The pure model, in `flow-model.ts`:**

```ts
export interface LayoutChange {
  moved: Array<{ id: string; from: [number, number]; to: [number, number] }>;   // boxes and open-line frames on both, at a new place
  entered: string[]; left: string[];                                           // only on the new / only on the old layout
  rerouted: string[];                                                          // arrows whose points changed, and new arrows
}
export function layoutChange(before: FlowLayout | null, after: FlowLayout): LayoutChange   // before null: nothing moves
```

- **Zero-delta boxes are never in `moved`, and identical point lists are never in `rerouted`.** Every SSE `plan` event
  refetches `/plan`, which gives a new layout with **identical** positions, and that must animate nothing. The e2e routes
  depend on it.

**`src/client/views/glide.ts`**, shared with Connections:
- `glideLayout(root, change, select)` animates the `moved` groups with absolute transform keyframes, `GLIDE_MS`, `EASE_OUT`.
  `select` gives the attribute selector: `[data-node-id]` and `[data-group-id]` for Flow, `[data-node]` for Connections.
- It fades the `entered` boxes in, opacity only, with an **implicit end**. A box that enters under a focus then ends at its
  `.dim` 0.18 rather than snapping. The mockup's `scale(0.9)` would be a transform on the node `<g>`, so it is not used.
- It fades the `rerouted` arrows and the rider layer in **over the second half**: delay `GLIDE_MS / 2`, duration
  `GLIDE_MS / 2`, `fill: 'backwards'`. So a pipe is never visibly detached from a moving box for long.
- It does nothing under reduced motion, or when `moved.length > GLIDE_LIMIT` (200).
- `glideView(g, from, to)` returns an `Animation`, or `null` under reduced motion.
- `viewOnScreen(g)` reads a running pan's matrix.

**FlowCanvas.**
- It keeps `placedBefore = useRef<FlowLayout | null>(null)`.
- A `useLayoutEffect(…, [layout])` runs before paint: it computes `layoutChange`, calls `glideLayout`, and stores the
  layout.
- `FlowCanvas` is not remounted between layouts (`FlowView.tsx:636-653, :690-697`). That is the precondition for this
  technique.
- StrictMode's second run sees zero deltas.

**Removed boxes fade out** (D6), as ghosts (P2-D42).
- The layout effect puts the `left` boxes' geometry, taken from the previous layout, into `ghosts` state.
- Each ghost renders as `<g className="flow-ghost" aria-hidden="true" transform=…><rect className="flow-ghost-box" …/></g>`,
  filled with its kind's token.
- **What ghosts never carry:** `data-node-id`, `data-step-id`, `data-kind`, `data-port`, a role, a `tabIndex`, `hl`, `dim`,
  `rect.flow-port` or `rect.flow-node-box`. So the `[data-step-id]` counts, the `.dim` count and `loosePipeEnds` cannot see
  them.
- Ghosts have `pointer-events: none`, fade out over `EXIT_MS` with `--ease-in` through WAAPI, and are removed when the fade
  finishes.
- Under reduced motion there are no ghosts.

> **As built.** A re-layout glides when its moved, entered and left boxes number 200 or fewer — not its moved boxes only
> (P2-R119) — so a whole-plan swap snaps. A layout that does not glide (past that limit, under reduced motion, or where the
> browser cannot glide) takes the view it brings at once, a new plan's or a line's box centred: no pan runs over a picture
> drawn anew, and one that glides keeps its 250 ms pan (P2-R126). A layout that lands mid-glide starts each box from where it
> is drawn (P2-R117).
> `glideLayout` returns at once when nothing moved, entered or rerouted (P2-R110). Ghosts appear only when the layout glides,
> only for boxes (P2-R111), fade from the opacity their box was drawn at (P2-R109) and copy its edge (P2-R118); a lit arrow's
> tag fades in with it (P2-R120). The Flow canvas keeps the taller of the old and new heights while a glide runs (P2-R121). The
> focus: a re-layout that removes it hands it to the same line's button if redrawn, else to the canvas; across a window blur it
> survives; a removed panel control hands it to its panel, a removed panel to the canvas; "N more…" to the first item it reveals
> (P2-R112, P2-R122, P2-R123, P2-R124); Keep only hands it to its own issue line's Show, and an issue line a replan drops to the
> first Show left, else the canvas (the final fix wave, FW-7); a replan that takes the whole diagram away (a plan that cannot be
> planned, Planning…, Pick something…) with the focus in it hands it to `<main>` (P2-R57; the final fix wave's residuals).
> Connections refits a new picture at once, then its boxes glide, with no ghosts (P2-R114). A second run of the layout effect for
> the layout it placed (StrictMode's, Fast Refresh's, an Activity shown again) glides, ghosts and holds nothing again (FW-14).

### 16.4 Keeping e2e deterministic

- **Do not skip motion under `navigator.webdriver`.** That would leave the suite blind to the motion code. The existing
  assertions survive animated Fit, zoom and reveal without being loosened ([FV] §4.3):
  - (3) polls
  - (2), (7), `reuse` and `plan` hover or click, which waits for a stable box
  - `loosePipeEnds` compares pipes and flanges inside one pan group
  - `connections.spec` reads the attribute
- **The helper.** `tests/e2e/helpers.ts` gains `finishMotion(page)`. It calls `.finish()` on every animation whose
  `endTime !== Infinity`, so the pipes and riders keep running. `loosePipeEnds` calls it first. That is a guard, not a
  loosening.
- **Deferred F7, optional here.** Tighten `loosePipeEnds` to each edge's own flanges, `[data-port="${port}"] >
  rect.flow-port`.

> **As built.** F7 is done: `loosePipeEnds` holds each pipe to its own two flanges, after `finishMotion`. The reduced-motion e2e
> accepts the global block's 1 ms transitions, and the `canGlide()` probe never runs (P2-R107).

### 16.5 Tests

**Pure unit tests:** `layoutChange` against fixtures. Moved boxes, entered, left and rerouted are reported. Zero-delta boxes
and identical points are excluded. `null` before gives nothing.

**Contract:**
- the motion constants equal `:root`
- the `FADES` rule is unchanged, with no transition on `.flow-node`
- `.flow-ghost` has `pointer-events: none`

**e2e, `tests/e2e/glide.spec.ts`:**
1. Click Fit. `g.flow-pan` has one animation, 250 ms long, and its `transform` **attribute** already reads the fitted view.
   After `finishMotion`, the measured box equals the attribute's geometry.
2. A replan: serve fixture B through `page.route` after a settings op, and let the SSE `plan` event trigger the refetch.
   `[data-node-id="wire"]` then has a running `transform` animation of 260 ms. After `finishMotion`, no pipe end is loose.
3. Under reduced motion, Fit and a replan leave no finite animation in `document.getAnimations()`.
4. A wheel turn during a Fit leaves no pan running.
5. Connections: Fit glides, and the attribute is final at once.

### 16.6 Risks

| Risk | Handling |
|---|---|
| The exception to the Phase 1 rule | Recorded, and the spike checks it in both engines |
| WAAPI ignores the CSS reduced-motion rule | The live check, plus the e2e |
| Pipes look detached while boxes glide | The second-half fade, and `finishMotion` before any geometry check |
| Long frames | `GLIDE_LIMIT`, plus a trace of a replan on the 241-edge plan |

## 17. The parked fixes R41–R47

Each fix goes in the task that touches its code (D1, P2-D40).

**R41: the arrow head of a lit missing-source pipe** (task 4, Flow boxes).
- Today a lit missing-source pipe takes the yellow highlight head, which reads 2.95:1 on its `#ff5555` casing.
- Fix: in `FlowView.tsx:260` check `missing` first:
  `missing ? 'flow-arrow-missing' : lit === true ? 'flow-arrow-hl' : fluid ? 'flow-arrow-fluid' : 'flow-arrow'`.
- Update `flow-pipes.test.tsx:59-60` deliberately, to `url(#flow-arrow-missing)`, with the comment "keeps its white head
  (R41)".
- Touch up the doc comment at `:244-251`.

**R42: the picked map row in forced colours** (task 6).
- Its outline cue replaces the focus ring.
- Fix: add `:not(:focus-visible)` to the map-row half of the picked-cue rule at `styles.css:1348`, or split it into a rule
  of its own.
- Update `styles-contract.test.tsx:2110, :2153` deliberately. The block stays last and in system colours only.

**R43: a live region in the drawer** (task 8, skeletons and status).
- The banners are inert while the drawer is open, so their status is not announced.
- Fix: in the aside, after Close settings, add an always-mounted `<p className="visually-hidden" role="status">{settingsOpen
  ? drawerStatus : ''}</p>`.
  - `drawerStatus` is `planError`, else "Updating the plan…" while busy, else a short problem count.
  - **Never** copy the full warning texts, because `getByText` sees hidden nodes (`avoid.spec.ts:28`, `reuse.spec.ts:30`).
- A `<p>` is not focusable, so the Tab cycle of `drawer.spec.ts:76-85` holds.

**R44: the Pause pipes button** (task 11, shortcuts).
- Fix: drop `aria-pressed` from `PipesButton.tsx:12` and keep the changing label, in the same change as
  `aria-keyshortcuts="P"`.
- The tests are listed in §3.9.
- Update the wording of the button's comment, of P1 §7 "A way to stop the pipes", and of the plan's R31.

**R45: the summary guard** (task 6).
- Make `styles-contract.test.tsx:453-457` also scan `:where()` and `:is()` argument lists for a bare `summary`.
- Exempt the R13 ring rule by name.
- Add a self-test line, as at `:457`.

**R46: widening the window with the drawer open** (task 11).
- The aside gets `tabIndex={-1}` and a ref.
- In `onWidth` (`ProjectPage.tsx:281-284`): when the aside holds `document.activeElement`, set `refocusAside` and focus the
  aside in the layout effect (`:249-253`).
- Extend `drawer.spec.ts:131-149`: after `setViewportSize(1280×720)`, `focusIsIn(page)` is `'the drawer'`.

**R47: wording only** (task 11).
- The comment at `ProjectPage.tsx:235-236` and P1 §7a's drawer text should list only "Escape, the dimmed page, the Close
  settings button". The Settings toggle sits in the inert head.

> **As built.** R43's status says "The plan is updating…", not the banner's words, and its problem count leaves out the "Pick
> something to make" hint (plan rulings `drawer-status-words`, `drawer-status-count`); it says "No problems" when an update ends
> with none (P2-R52). It says first why a change the page sent failed or was refused (the store's error, which the inert
> banner's alert says), as the changed field in the drawer snaps back (the final fix wave, FW-10). R46 is built as plan ruling
> `aside-refocus`, with P2-R80; its twin for a window that narrows is P2-R133, and a widening with the drawer closed is P2-R139
> (§14.1).

## 18. Moved to Phase 3 (not in this work)

These were listed for Phase 2 in P1 §7a and §8, or deferred during Phase 1. The approved Phase 2 scope and its mockups do
not include them (P2-D37):

| Item | Why it moves |
|---|---|
| Tier-picker chips | `settings.test.tsx` requires the select as the root |
| Inline validation, and the login shake | |
| The "saving" pip | |
| The selected slot's scale-in (R3) | Its contract pins stay |
| The selected tab's 2 px rise | |
| 32 px toolbar icon buttons | |
| Side panels sliding out | The grid column changes at once, so the panel would need a ghost |
| An exit animation for MapTooltip and the 3D label | It needs the `:1742` edit |
| The 12 remaining native `title`s, and the map canvas title | |
| The mockups' "Swap recipe…" and "Show in 3D" buttons, and the note | |
| The inventory mockup's "To run" readout column | |
| A logo that replays when the plan updates | It needs planner state in TopNav |

Phase 3 also has P1 §8's own list: the command palette, dragging build steps into order, the map overlay legend, the 3D
"Blocks to place" grid, the World mini map, and large tiles on the project list.

## 19. Delivery order (D1)

Every task is test-first. Each ends with `npm test` and `npm run e2e` green and a review in both looks (from task 1 on).

| # | Task | Contents | Folded in | Depends on |
|---|---|---|---|---|
| 1a | Theme tokens | Every themeable literal becomes a token whose light value equals today's. The panel ink group reads tokens, and `--dye-casing` arrives. The contract wording changes (§3.9). **The light look screenshot-diffs to zero against the Phase 1 after-shots.** | Phase 1's F4 (the token-driven contrast test) | — |
| 1b | Dark look and switch | The dark blocks; `theme.ts`, ThemeButton, the head script and the cross-fade; `--thumb`; the dark contrast pairs; `theme.spec` rewritten, plus the dark tour; `setTheme()` in the e2e helpers | — | 1a |
| 2 | Logo C | The three tokens, the overlays, the favicon, and the contract and e2e cases | — | 1 |
| 3 | Shared tooltip | `tooltip-model.ts`, `TooltipHost`, `mod-names.ts`; the ItemIcon `tip` prop; the four `<title>`s replaced; `tip={false}` sites; the 7 deliberate assertions; `tooltips.spec` | — | 1 |
| 4 | Flow boxes | `MachineReadout`, the metrics, `rowsTop`/`sized`, `MachineReadoutShape`, the tier classes, CSS and tokens, `flow-boxes.spec` | R41 | 3 |
| 5 | Recipe card | The helpers, `RecipeCard`, `GtArrow`, `.stack-count`, `.readout`, the re-slide fix with focus on the aside, `recipe-card.spec` | the deferred re-slide minor | 3, 4 (`machineIconKey`, `tierSlug`) |
| 6 | Inventory grid | `materials-model` additions, `materials-view.ts`, `BuildGrid`/`ViewToggle`/`GatherMeter`, CSS and forced colours, `materials-grid.spec` | R42, R45, the Materials disclosures' height animation, the Task 5 tick minor (optional) | 3, 5 (`.stack-count`) |
| 7 | Key-numbers strip | `key-numbers.ts`, `KeyNumbers`, the hide rule, the budget guards | — | 1 |
| 8 | Skeletons and the progress arrow | `Skeleton`, the sites, `GtArrow` in the busy line, `skeletons.spec` | R43 | 5 (`GtArrow`), 7 (the strip skeleton) |
| 9 | Toasts and Undo | `toasts.ts`, `Toasts`, `sendLater` with keepalive, `projects-changed.ts`, the call sites, `.toasts` inert with the drawer, `toasts.spec` | — | — |
| 10 | In-app confirms | `InlineConfirm`, the projector revoke, NotesView's `confirm()` removed (note delete uses task 9's Undo), the `projector.spec` change, the no-dialog guard | — | 9 |
| 11 | Keyboard shortcuts | `shortcuts.ts`, the handler, `ShortcutsSheet`, the Shortcuts button, `aria-keyshortcuts`, tips on Fit and Pause, `shortcuts.spec` | R44, R46, R47 | 3 |
| 12 | Riders | **The spike (§15.4) first, with no commit, recorded as rulings**; then the `pipe-motion` additions, `FlowRiderShape` and its layer, the CSS, the endless list of 4, and the `pipes.spec` additions | F8 (recommended) | 4, 11 (Pause pipes semantics) |
| 13a | Glide: pan and zoom | `motion.ts`, `glide.ts`'s `glideView` and `viewOnScreen`, `glideTo`, `g.flow-pan`, Connections Fit, `finishMotion`, glide cases 1, 3, 4 and 5 | — | 12 (the spike) |
| 13b | Glide: re-layout | `layoutChange`, `glideLayout`, the ghosts, the second-half fade of arrows and riders, glide case 2 | F7 (optional) | 13a |
| 14 | Docs and whole-app verification | §20; the README (the theme switch and the logo); the P1 spec's superseded passages marked; this spec's "as built" notes; the plan's "As built" list of rulings | — | all |

**New files by task:**

| Task | New files |
|---|---|
| 1 | `state/theme.ts`, `components/ThemeButton.tsx` |
| 3 | `components/tooltip-model.ts`, `components/Tooltip.tsx`, `components/mod-names.ts` |
| 5 | `components/GtArrow.tsx` |
| 6 | `state/materials-view.ts`, `views/MaterialsGrid.tsx` |
| 7 | `views/key-numbers.ts`, `views/KeyNumbers.tsx` |
| 8 | `components/Skeleton.tsx` |
| 9 | `state/toasts.ts`, `components/Toasts.tsx`, `state/projects-changed.ts` |
| 10 | `components/InlineConfirm.tsx` |
| 11 | `state/shortcuts.ts`, `components/ShortcutsSheet.tsx` |
| 13 | `state/motion.ts`, `views/glide.ts` |

All of these are under `src/client`. The test files are named in each section.

## 20. Verification

- **The suites.** `npm test` and `npm run e2e` are green after every task. No assertion is removed or loosened; the only
  changes are the deliberate ones in §3.9.
- **Task 1a.** The light screenshot tour (`scratchpad/shots/shoot*.mjs`) is pixel-identical to the Phase 1 after-shots.
- **Screenshots.** After each later task and at the end, take the screenshot tour in **both looks** at 1440 × 900 and
  800 × 900. Compare it with the mockups, and list anything that still reads as old.
- **A motion pass in headed Chromium.** Check each of these:
  - the logo plays 6 turns, then rests
  - a tooltip enters after its 150 ms rest and leaves in 80 ms
  - the recipe arrow runs 3 times, and the skeleton sheen runs 3 times
  - a toast enters and leaves
  - the strip counts up and flashes
  - riders move
  - a replan glides, and Fit, zoom and reveal pan
  - the theme cross-fades in 260 ms or less

  No transition the user waits for exceeds 300 ms. Then repeat with `reducedMotion: 'reduce'`: nothing moves.
- **Contrast.**
  - The token-driven test covers both looks.
  - A spot-check of rendered pairs on the built page in both looks, as Phase 1's Task 10 did with its 126 pairs.
  - Forced colours: an e2e run under `forcedColors: 'active'` covers every new graphic.
- **Performance.** Take Chrome traces of:
  - panning the 513-edge plan, with lit riders only
  - panning the 199- and 241-edge plans, with up to 150 riders
  - a replan glide on the 241-edge plan

  There should be no long frames caused by the pipes, the riders or the glide. If riders cause them, first lower
  `RIDER_LIMIT`, then draw riders on lit edges only at a lower edge count. Record either change as a ruling.
- **The height budget.** On the iron-plate line at 1280 × 720 with the strip, the measured map canvas centre is at most
  700.
- **Keyboard only.** Check, in both looks:
  - the Theme button
  - the shortcuts and the sheet
  - one tab stop per item in the grid
  - the confirms
  - the toasts' Undo
  - visible focus rings
- **A screen-reader smoke test with VoiceOver.** Check:
  - tooltip descriptions
  - each toast announced once
  - the strip read as its final values only
  - the grid checkboxes
  - the drawer's status (R43)

> **As built.** Traced headless in Chromium: the pipes and the glides cause no long frame. The riders' first pan after a page
> load, on a plan of about 200 arrows, costs a one-time 3–4 frames of 33 ms, none over 50 ms, while later pans and idle are
> clean. That is accepted, as the remedies would take the riders off big plans (P2-R125). The 250 ms view pan that followed a
> whole-plan swap, over a picture drawn anew, is gone: a layout that snaps takes its view at once (P2-R126). The first theme switch
> of a page measures 297–314 ms from the click, the View Transition itself 260–268 ms, accepted against §3.3's 300 ms (P2-R127).
> "The light look is unchanged" is proved by swapping the base's and the new stylesheet into one page state, with a
> base-against-base control (P2-R6), against fresh shots of the base (plan ruling `baseline-shots`). The probes ran headless with
> `recordVideo` (P2-R100), and the VoiceOver smoke test ran as accessibility-tree checks, with a list for the user to confirm by
> ear (P2-R99).

## 21. Open decisions left to the builder

- Exact class names for new pieces this spec does not name. The rules of §3.2 and §3.3 still apply.
- Whether one `state/browser-setting.ts` factory serves pipes-paused, theme and materials-view. If pipes-paused moves onto
  it, its exports and tests must stay the same.
- The rider speed curve within 1.2–12 s, and the phase hash.
- Skeleton geometry, and the toast visuals within the chat-box look.
- The mod-name table beyond its 8 fixed entries, within 15 in total.
- The compact-number details within 3 significant digits, and how a value in words is laid out in a narrow tile.
- Whether the strip's cost tiles carry a hover-only `data-tip` with the full cost sentence. They are not focusable, so it
  would be extra.
- Whether the Theme button gets a `data-tip` explaining Auto. If it does, update the `scaffold.test.tsx` assertion
  deliberately.
- Optional recipe extras: a slot for the programmed circuit (`gregtech:gt.integrated_circuit@n`, tag "NC"), and a yellow
  frame on the main output.
- F7 and F8 (recommended).
- If View Transitions misbehave in a browser: fall back to a temporary `.theme-fade` colour transition inside
  `@media (prefers-reduced-motion: no-preference)`, removed after 300 ms.
- How the deferred note delete is layered inside `project-store`, as long as the §12.2 contract holds.
- Whether Connections' re-layout glide ships with Flow's or later within task 13b.

The spike decides the rider mechanism (D5). It is not a free choice.

## 22. Calls the designer made

### The controller's calls (binding)

| Call | Decision | Reason |
|---|---|---|
| **P2-D1** | The order: theme first, then logo, tooltip, Flow boxes, recipe card, grid, strip, skeletons, toasts, confirms, shortcuts, riders after a spike, and the glide with pan and zoom first. R41–R47 are folded into the tasks that touch their code. | Every later rule is then a token, and every review sees both looks. The tooltip comes before the grid, so the grid never shows double tooltips. The geometry-sensitive motion comes last. |
| **P2-D2** | The theme: Auto, Dark and Light. Auto is the default and needs no attribute or JS. The choice is stored per browser, and a head script applies it before the first paint. The Theme button cycles. The cross-fade is at most 260 ms. The dark palette is the mockup's DARK plus the scout's proposals, all AA, with the tick at 4.21:1 accepted. Light is unchanged, and literals become tokens. `--dye-casing` is `#c6c6c6` in both looks. | Auto cannot flash. The light look staying identical lets the light-default e2e suite prove nothing moved. |
| **P2-D3** | Logo C plays its frames forward. One crispEdges SVG data URI serves the top bar, the login card and the favicon, checked by the contract. It plays 6 turns, about 4 s, then rests. It is still under reduced motion. | Forward matches the app's pipes. One string can be checked as text. WCAG 2.2.2 and the endless guard forbid a loop. |
| **P2-D4** | Flow boxes keep one row per good and widths of 190–330 px. `lines` stays. The readout adds a 32 px icon in a 36 px SVG slot, Pixelify chips sized from their character count and tested, and a 16 px busy band. | `rowCentre` and the port tests keep their meaning, and the width tests hold. `lines` is the accessible words, pinned five times. |
| **P2-D5** | Riders: at most 1 per edge and 150 per diagram, lit edges only above 200. They are SVG `<image>`s in a layer of their own with no pointer events. They use CSS `offset-path` if the spike passes in both engines, SMIL otherwise. Pause, drag, dimming and reduced motion stop them. | Large plans stay smooth. The edge markup pins hold. The stylesheet still does the moving. |
| **P2-D6** | The glide uses WAAPI with absolute keyframes that end on the attribute. `layoutChange` skips zero deltas. New boxes fade in and removed ones fade out. Fit, the zoom buttons and reveals pan over 250 ms on `g.flow-pan`, and wheel and drag stay instant. Reduced motion is checked live. `finishMotion` is added, and nothing is loosened. | The attribute stays final, which `connections.spec` reads. The animations can be finished in tests. Identical SSE refetches stay still. |
| **P2-D7** | The recipe card goes between the summary and the ports: slots, an 8-step arrow running 3 × 1.6 s, an energy bar, readouts and OC chips. It has no Swap or 3D buttons and no note. The re-slide is fixed with a mounted wrapper and a keyed panel that fades. | It is NEI's look. The left-out pieces collide with strict e2e text or need new features. The re-slide is an anti-goal. |
| **P2-D8** | Stack counts are white Pixelify over a 2 px dark shadow, measured against the shadow. | The Minecraft convention: 10.5:1 on the shadow, 3.41:1 on the bare face. |
| **P2-D9** | The grid is opt-in and remembered, with List the default. Stacks are 64. The first stack is a `role=checkbox` with a fixed label, and the others are hidden duplicates. Ticks come from the marks. The tick has a dark edge. The meter is a progressbar using `scaleX`. 9 stacks are drawn, then `+N`. The groups are `BUILD_GROUPS`, and the page order is kept. | Every existing test holds. One control per row matches the List and the marks model. The DOM size is bounded. |
| **P2-D10** | A namespace table of at most 15 entries, with no line for an unknown namespace, drawn in `#8080ff`. | NEI shows the mod, but the pack has no names. `#5555ff` fails AA. |
| **P2-D11** | One `TooltipHost`: a portal, document listeners, a `data-tip` opt-in, the innermost trigger wins, one at a time, a 150 ms rest, focus, touch, the listed ways to hide it, `preventDefault` but never `stopPropagation`. It replaces the native titles on ItemIcon and the four SVG `<title>`s with aria-labels. Links get none. It is mounted only while it shows. It keeps `pointer-events: none`, accepted under 1.4.13. It is instant under reduced motion. | No state per box. The constraints of `world.spec`, `connections.spec` and `drawer.spec`. |
| **P2-D12** | The strip sits outside PlanBanner, with 52 px tiles. The sentence stays in the DOM, hidden by a sibling rule. It counts up over 400 ms in JS, instant under reduced motion. A changed tile flashes once. | PlanBanner's `''` pins. The 63 px headroom. `build-cost.spec` and screen readers. |
| **P2-D13** | Every loading `<p>` stays, with an aria-hidden skeleton beside it. The sheen and the arrow are finite, ≤ 5 s. | Tests and screen readers keep their text. The endless guard. |
| **P2-D14** | Toasts: a store and an App-level polite region, never `role=alert`, inert with the drawer. The listed actions, 5 s, pausing. The note delete is deferred. The texts avoid the e2e strings. | `delete.spec.ts:77`. An Undo that is exact, with no API change. |
| **P2-D15** | A shared inline confirm for irreversible actions (revoking a token). Escape cancels with `preventDefault`. The `revokeQuestion` text is kept. It is not named "Confirm delete". Note delete uses Undo. The `projector.spec` change is deliberate. | No browser dialogs. The Escape layering of R15 and `drawer.spec`. |
| **P2-D16** | One shortcut handler that skips typing targets, the drawer and modals: `/`, 1–6, F, P, Esc and `?`. `aria-keyshortcuts` on Fit and Pause pipes, as one markup change together with R44. | A single place for the rules. One deliberate markup change instead of two. |
| **P2-D17** | Nothing new animates for ever, apart from the pipe rules. Everything else is finite and ≤ 5 s. | WCAG 2.2.2, and the contract guard. |

### Further calls made while writing this spec

**P2-D18. How D17 applies to riders.**
- Decision: riders **are pipe contents**. So the allowed endless list is the 3 pipe rules plus the rider rule, and Pause
  pipes, drag, dimming, `many-edges` and reduced motion stop all four.
- Reason: D5 describes riders that run until stopped, as the pipes do. The mockups show them always moving, and they share
  the pipes' WCAG 2.2.2 control.
- If the controller reads D17 literally instead, the alternative is a rider that rides 3 times after the diagram appears, a
  focus change or a replan, and then hides.

**P2-D19. Riders are Flow-only in Phase 2.**
- Reason: the mockups show them on Flow only. Connections pipes already carry meaning in their carrier colours. Two of its
  edge kinds carry nothing, and its edge child lists are pinned.

**P2-D20. The glide also runs in Connections.**
- Decision: its Fit pans, and its re-layout glides, through the same `glide.ts`. It has no zoom buttons.
- Reason: P1 §7a names both diagrams, and the module is generic. `connections.spec` reads only the final attribute.

**P2-D21. The touch rule, generalised.**
- Decision: a tap shows a tip unless the trigger is interactive, contains the tapped interactive element, or is an SVG
  element. In those cases a 500 ms long press or keyboard focus shows it, and the following `contextmenu` is prevented.
- Reason: D11 names ticking slots as the example. Diagram boxes also act on a tap, but their `<g>` has no role, so they need
  a rule rather than a list of attributes.

**P2-D22. Escape, layer by layer.**
- Decision: Flow's `window` Escape listener keeps ignoring `defaultPrevented`. The shortcuts sheet, as the modal top layer,
  calls `stopPropagation` on its Escape. The tooltip never does.
- Reason: `flow-focus.spec.ts` (2) presses Escape while a box tip is likely showing and expects the highlight cleared.

**P2-D23. The tier chip leads the recipe card.**
- Reason: the chip cannot go beside the `h3`, which must stay attribute-less, and the panel head has no room at 228 px. It
  cannot go inside the summary `<p>` either: "32 V1 machine" would run together for screen readers and for `text()`.

**P2-D24. Slider thumbs in dark get their own token.**
- Decision: `--thumb` is `#7a7a7a` in dark, at 3.34:1. In dark, button faces on panels (1.30:1) and box fills on the well
  (1.32:1) are accepted.
- Reason: the scout flagged these 1.4.11 gaps for sign-off. A thumb's position is its value, so it must be seen. Buttons and
  boxes are identified by their text.

**P2-D25. Some page settings stay the same in both looks.**
- Decision: `theme-color` stays `#1a1a1a`, and `color-scheme: dark` holds in both looks.
- Reason: both bars are near-black, and both looks have dark pages and black fields. The meta tags are pinned.

**P2-D26. The cross-fade uses View Transitions.**
- Decision: View Transitions, with an instant fallback. No global colour transition.
- Reason: a permanent `.themed *` transition would override pinned element transitions.

**P2-D27. Strip details.**
- Decision: a short qualifier sits at the right of the label row and carries the sentence's caveats. The strip stays
  mounted for any project with a target, as a skeleton or as `—` tiles. Values are compact from 100,000 up.
- Reason: D12's two-line tile has no third line. The height must never change within a project, because `connections.spec`
  drags exactly. Narrow tiles need short numbers.

**P2-D28. Toast details.**
- Decision: the hover pause needs a pointer that moves. The set is exactly D14's, so revoking a token has no toast. Toasts
  never take Escape. A newer rename replaces an older rename's toast. A flush dismisses its own toast.
- Reason: a toast that appears under a resting pointer must still time out, both for users and for Playwright's retries.
  Escape already has six layers.

**P2-D29. Shortcut extras.**
- Decision: a visible "Shortcuts" button in the project head. `aria-keyshortcuts` on the tabs and on the Make search. A tab
  shortcut moves the focus to its tab. The sheet is a portal with `#root` inert.
- Reason: discoverability, and the visible name "Shortcuts" satisfies 2.5.3. The sheet is a true modal, so focus cannot
  leave it.

**P2-D30. The mod-name lookup is case-insensitive, with the table in §6.5.**
- Reason: 1.7.10 namespaces such as `IC2` and `EnderIO` are upper-case.

**P2-D31. Grid details.**
- Decision: the meter shows only in Grid. The `+N` slot has no icon. A tick is shown by an overlay, never by styling the
  image.
- Reason: ticks on child rows in the List would not move the meter. `+N` must not read as a stack of N. `:957` forbids
  styling `.item-icon img`.

**P2-D32. Pseudo-machine icon keys are repeated on the client.**
- Decision: the client repeats the keys, and a unit test compares them with `PSEUDO_MACHINE_ENTRIES`.
- Reason: the server stays untouched (a non-goal), and drift is caught.

**P2-D33. The StepPanel aside takes focus.**
- Decision: it gets `tabIndex={-1}` and takes the focus when a pick from inside the panel replaces it.
- Reason: today the remount drops the focus to `<body>`.

**P2-D34. Logo timing details.**
- Decision: durations are written in seconds, and there is no hover replay.
- Reason: the contract's "duration × count" helper reads seconds. A replay that restarts when the pointer leaves would look
  odd.

**P2-D35. The dim opacity stays 0.18 in dark.**
- Reason: in both looks a dimmed box reads at about 1.5–1.7:1, which is how "dimmed" is meant to look. The value is pinned.

**P2-D36. Tooltip details.**
- Decision: an arrow's tip has three lines, `[name, rate, route]`, through an optional `FlowEdge.route`.
  `aria-describedby` is skipped when the tip equals the element's own name. The 80 ms exit is built for the shared tip only.
  Pointer tips sit below and right of the pointer, by MapTooltip's rule, not above and right as in the mockups.
- Reason: three lines read better than one long one. A screen reader should not say a name twice. MapTooltip's exit is
  blocked by `:1742`. A tip above the pointer would cover the 18 px row being read.

**P2-D37. Some items move to Phase 3 (§18).**
- Reason: they are outside the approved Phase 2 scope and its mockups, and each touches pinned markup or needs new work.

**P2-D38. No new dependencies.**
- Reason: everything needed is in React or in the browser.

**P2-D39. The recipe and grid slots carry the tooltip lines of §8.3 and §9.4. The Flow readout is aria-hidden.**
- Reason: the readout's words are already `lines[0]`.

**P2-D40. Where the parked fixes go.**
- Decision: R41 goes with the Flow boxes, R42 and R45 with the grid, R43 with the skeletons, and R44, R46 and R47 with the
  shortcuts.
- Reason: each goes in the task that edits the same code. The grid adds forced-colours rules with R42's pattern, and the
  shortcuts task edits the drawer's focus code.

**P2-D41. The count-up re-renders from state.**
- Decision: a state-driven `useCountUp`, at most 400 ms with rAF, rather than writing to the DOM directly.
- Reason: with direct writes, React could keep stale text, and the server-rendered markup must show the final value.

**P2-D42. Removed boxes fade out as ghosts.**
- Decision: a ghost is a plain rect copy in React state, with no ids, fading over 180 ms through WAAPI.
- Reason: the removed node is already gone when the layout effect runs, and no ghost may join the e2e counts or the flange
  check.

**P2-D43. The theme task is two commits.**
- Decision: 1a tokenises the literals with no pixel change, and 1b adds the dark look and the switch.
- Reason: 1a can be proved by a zero screenshot diff, which keeps 1b's review focused.

## 23. Builder-check answers (binding)

A fresh builder read this document and raised four questions. The answers below are binding and override anything above
that disagrees.

**Q1. Four unmerged branches touch Phase 2's screens (plan/12-build-cost, plan/14-build-howto, plan/17-objectives,
plan/19-logistics-cost). Which lands first?**
- The user's answer (2026-10-24): **Phase 2 first.** Phase 2 is built on today's `main` (`cfaa05b` plus later commits on
  `main` at the time the branch is cut) and plans around none of those branches.
- They already predate Phase 1 and must be restyled when they merge; each adapts to Phase 2's tokens, theme rules,
  components and layout at its own merge. Phase 2 does not reserve hooks or space for them, except the note in Q2.

**Q2. When add-on 17 lands, how does its CompareCard share the height budget with the key-numbers strip?**
- Ruling P2-D44: the height budget of §3.6 binds whichever change lands second. When add-on 17 merges after Phase 2, its
  "Compare modes" control moves into the key-numbers strip row (as a strip-height button at the row's end), and the
  opened card stays below the strip, so the closed state adds no height. Phase 2 itself builds nothing for this.
- Cost if wrong: add-on 17's merge needs a small layout change.

**Q3. Do riders loop for ever (P2-D18), or run a few rides and hide (literal D17)?**
- Ruling P2-D45: **P2-D18 is ratified.** Riders are pipe contents: they loop like the pipe dashes, and the
  endless-animation guard grows from three rules to four, all of them stopped by Pause pipes (R31) and by reduced motion.
  The finite-rider alternative is not built.
- Reason: WCAG 2.2.2 is met by the Pause control, which already governs the pipes; riders that vanish after three rides
  would read as broken.
- Cost if wrong: one more endless rule, still user-stoppable.

**Q4. What if spike (b) fails in WebKit (a WAAPI transform on `<g transform>` does not end exactly on the attribute)?**
- Ruling P2-D46: the re-layout glide and the pan/zoom glide are switched off in WebKit only (feature-detected by the
  spike's own check, not by user-agent sniffing where avoidable); Safari users get today's instant moves. No SMIL
  fallback for the glide. Chromium keeps the glide, and the e2e suite (Chromium) still covers it.
- Cost if wrong: Safari users miss the glide.

## 24. Re-check against the new main (2026-10-24)

The plan was re-checked on 2026-10-24 against `merge/addon-17` at `96e9e99`: `cfaa05b` plus add-on 23's pack textures, the
Make-picker fix and add-on 17 (objectives) in the Machine GUI look, all merged before Phase 2. It was then re-checked against
`main` at `01da27d`, which took that merge with three fixes: `0c08dba` (server only: a farm's crop sticks count whole as machines
do), `4bef36c` (a cleared target makes the Compare card forget its figures; its tiles are at least 160 px and stack one a row in a
narrow column, and a figure never breaks: it stays on one line and shrinks to fit, to 13 px, before it is cut) and `68c06c1`
(another target picked with the card open drops the old figures, and the card says it is planning the three modes until the new
compare comes). The `file:line` cites in the sections above are at `cfaa05b`; this section's and the plan's are at `01da27d`, so
where they differ the code is found by its text (§4.8's `drawer.spec.ts:67`, for one, is `:77` now). The calls below were made in
those re-checks. Each is a builder's call and a plan ruling of the same name, for the controller's sign-off; with §23 they override
anything above that disagrees.

**Builder's call: the base's surfaces in the dark look** (Task 1b; plan ruling `base-surfaces-dark`). Add-on 17's Compare card,
"Plan for", farm fields and taken-by rows, and the Make-picker fix's target readout in the Settings button and its drawer that
opens by itself, read tokens. They follow the dark look with no rule of their own, and the dark blocks gain no name for them. Two
of their graphics fall below 3:1 in dark; each is accepted because another cue carries it (the next two calls). The tour, the dark
tour and the review shots cover the Compare card, Plan for and Farms, the narrow Compare bar, the Settings readout and the drawer
that opens by itself. No mockup has these screens, so their light shots are compared with the add-on 17 and Make-picker shots, and
their dark ones with `DarkMode.dc.html`'s palette.

**Builder's call: add-on 17's mode in use in the dark look** (Task 1b; plan ruling `compare-frame-dark`). The Compare card's mode
in use keeps its black `--outline` edge and its 2 px `--accent` ring inside in both looks, and the dark blocks name nothing of it.
In dark the edge is 1.46:1 on the `#2a2a2a` panel, but the ring is 13.46:1 on the panel and 19.69:1 on the edge, so the frame still
reads at 3:1. This works the way the grid tick does in dark (§4.5, where the green itself carries it). The contrast table measures
the edge in light only (12.29:1) and the ring on the panel in dark only, and records the dark edge as a reason. Reason: `--outline`
and `--accent` are the same in both looks (§4.3), and a lighter dark edge would add a token for one rule. Cost if wrong: one token
for the current column's edge, with a dark value.

**Builder's call: add-on 17's farm fields in the dark look** (Task 1b; plan ruling `farm-line-dark`). The 2 px line that the Tree
Growth Simulator's and the Crop Manager's fields hang on keeps `var(--panel-lo)`. That is `#555555` on the light panel (4.36:1,
which the contrast table keeps at 3:1) and `#0d0d0d` on the dark one (1.35:1): a dark groove like the dark panel's own bevel
shadow. The line is decorative, so WCAG 1.4.11 asks nothing of it: the fields' 24 px indent under their tick and their own labels
carry the grouping, and the fields show only while their kind is ticked. The contrast test records the dark ratio as a reason, as
it does the dark button faces. Rejected: a new token with a lighter dark value (`#7a7a7a` would be 3.34:1), which adds a name for
one decorative rule. Cost if wrong: one token and its dark value.

**Builder's call: R46 on the drawer that opens by itself** (Task 11; plan ruling `aside-refocus`). When the window grows past
900 px with the drawer open, the settings column (the aside, `tabIndex` −1, through the page's existing `settingsPanel` ref) takes
the focus only if the element that had it is no longer drawn beside the views. In practice that is Close settings, the one control
of the drawer a wide window does not draw. A control the column still draws keeps the focus: the Make-picker fix's drawer opens by
itself into the item search and, in a window that has grown past 900 px, closes again at once, and the focus stays in that search
(`drawer.spec.ts:578-615`); a search that `/` focused stays too. This replaces §17 R46's "when the aside holds
`document.activeElement` … focus the aside", which would move it to the aside.

**Builder's call: the Shortcuts button on a narrow window** (Task 11; plan ruling `shortcuts-button-wide`; P2-D29 on the add-on 17
base). Below 900 px the project head's one row is full: the Settings button there names the target, add-on 17 moved its Compare
modes button to a bar under the banner for the same reason, and `drawer.spec.ts` and `objectives.spec.ts` hold the head to 36 px
at 800 × 900. So the head's Shortcuts button is drawn above 900 px only (`.project-head > .shortcuts-open { display: none; }` in
the drawer's query). `?` opens the sheet at every width, and the Flow and Connections hints say so, so the sheet stays discoverable
with a keyboard. Closing the sheet gives the focus back to its opener while the opener is still drawn, else to the shown Shortcuts
button, else to the selected tab: the rule `closeCompare` uses for its two buttons. §14's "adds no height" (and §3.6's rows "already
36 px tall") hold above 900 px, as at 1280 × 720.

**Builder's call: farm steps in Flow** (Task 4; plan ruling `farm-step-readout`). Add-on 17, merged before Phase 2, brings farm
steps into Flow: a Tree Growth Simulator or Crop Manager step is a machine step. Its readout shows the farm machine's icon
(`gregtech:gt.blockmachines@15541`, `@28001` …), a tier chip (the simulator's energy hatch tier, the manager's own; plan ruling
`pseudo-tier-chip` covers the crafting table and the furnace only), the ×count of farm machines, the power through `formatNumber`
(a Crop Manager draws a fraction of an EU/t: "0.107 EU/t") and the busy band; the slot never shows the sapling or the crop, which
the farm words and the step panel's Farm section name. The farm words (`PlanStep.farm.text`, about 100 characters) stay in
`FlowNode.lines` and are drawn below the band like any later line; every line below the band is cut with "…" at the box's edge
(`clipText`, as the title is), the whole words staying in the head's name and tip.

**Builder's call: farm steps on the recipe card** (Task 5a; plan ruling `farm-step-card`). A crop farm's run is one harvest of one
crop stick (its machine tends `farm.sticks` at once; parallels stay left out, §8.5), and its drops are expected amounts at chance
1, so an item slot whose nominal amount is below 1 is drawn as one at that expected amount as its chance (0.9 Sticky Resin a
harvest is one at 90 %), as NEI draws a drop that does not always come; a fluid keeps its litres, and GT's own whole amounts are
unchanged. A tree farm's tool (`PlanStep.farm.tools`), which add-on 17 models as consumed at chance 1 / its uses, is drawn as worn,
not chanced: no chance tag, and its tip reads "wears 1 of its 512 uses per run" and the rate in the line. The rest of the card is a
machine's (tier chip, time, power, energy bar, arrow, readouts, "No overclock at LV"); the sapling the controller holds is a held
item, left out.

**Builder's call: P2-D44 as landed** (Task 7; plan ruling `p2-d44-landed`). Add-on 17 merged before Phase 2. Its restyle put the
Compare modes button in the project head above 900 px, where it takes no row of its own and the closed card draws nothing. At
900 px or less it sits in a 40 px `.compare-bar` under the plan banner, because the head's one row is full there. Phase 2 lands
second, so the §3.6 budget binds Phase 2, and it holds: the strip's +27.7 px moves the iron-plate map centre from 657 to about 685,
under 700. Phase 2 keeps the button where it is and builds nothing for it. `<KeyNumbers>` is the first child of
`.project-banners`, so the bar and the opened card sit below the strip, and the card stays the box's last child. The strip-row
button P2-D44 sketched is not built: a sixth item would wrap the five tiles at 752 px.

**Builder's call: the strip's figures beside the Compare tiles'** (Task 7; plan ruling `strip-figures`; §25 measured it again in VT323,
and its numbers replace the Pixelify ones here). `main`'s `4bef36c` lets no
Compare figure break: it stays on one line and shrinks to fit, down to 13 px, before it is cut, because those figures are written in
full (`2,097,152` is 106.9 px in the 24 px pixel font). The strip needs only half of that. Its figures already stay on one line
(§10.2's `white-space: nowrap; overflow: hidden; text-overflow: ellipsis` on `.key-number dd`, which the plan now pins), as its fixed
52 px tile requires. It does not shrink them: they are compact, at most 8 glyphs from 0.0001 up (`0.000792` is 103.8 px and `99,999`
76.7 px, measured in the bundled Pixelify Sans), and the narrowest tile, the grid's 140 px minimum, has 116 px inside. What can pass
the edge is the end of the line: a unit after a long figure (`99,999 raw/h`, 120.8 px) or a rare rate in words (`1 every 526 days`,
119.5 px in Inter 15 px). The ellipsis cuts that end, and the tile's label still names what it counts. Only a To run or Peak power
figure under 0.0001 (`0.0000792`, 117.8 px) can lose its last digit in the narrowest tiles; the tile's visually hidden copy and the
`.plan-cost` sentence keep it whole. §21 leaves the strip's narrow layout to the builder. Cost if wrong: the Compare tiles' rule on
`.key-number dd` (the tile a size container, and a `--glyphs` that counts the unit too).

**Builder's call: R43's busy words** (Task 8; plan ruling `drawer-status-words`). The drawer's status says "The plan is
updating…" while a plan is on its way, not §17's "Updating the plan…", the banner's words. The Make-picker fix's
`drawer.spec.ts:441` finds the banner's busy line by text while the drawer is open, and `getByText` also sees the visually hidden
status: the same words there would be a second match and fail strict mode. §3.8 keeps new hidden text clear of strings the e2e
specs look for.

**Builder's call: R43's count on the drawer that opens by itself** (Task 8; plan ruling `drawer-status-count`). The drawer's
problem count leaves out the server's no-target hint ("Pick something to make", code `no-target`). Since the Make-picker fix, a
window of 900 px or less opens the drawer by itself, the focus in the item search, exactly when that hint is all a plan says. The
drawer is where the target is picked, so its status stays empty there instead of announcing "The plan has 1 problem" over the
focused search. The plan's source notes (farms, other projects' surplus) are no problems either.

**Builder's call: the Compare card's loading lines** (Task 8; plan ruling `compare-skeletons`). Add-on 17's Compare card has two
loading lines of its own: "Planning the three modes…" and a mode's "Still planning…" note. D13 gives each an aria-hidden skeleton
beside it. "Planning the three modes…" shows while the card has no answer for its project's target, each time up to the server's
20 s: for the first compare once the card opens (a card whose target was cleared, since `4bef36c`, or changed while it was closed,
since `68c06c1`, forgets its figures, so it opens on this line again), and, with the card open, as soon as another target is picked
(`68c06c1`). `skeleton-compare` is three frames in the card's column grid. Each is framed as a column is (its 2 px inset edge, and
the room of its title above the tiles and of its button below) and holds six 55 px blocks in the tiles' own grid: the
`grid-template-columns` of `.compare-rows`, which at `01da27d` keeps each tile at least 160 px and stacks the tiles one a row in a
column too narrow for two. So its blocks fall as the tiles will, and each frame is as tall as a loaded column at every width:
about 264 px where the tiles sit two a row, about 441 px where they stack. `skeleton-readouts` is six such blocks in that grid alone, the
figures the mode will show, so a pending column keeps its height when they arrive. The card's "Updating…" keeps its columns drawn, as
Connections' busy state does, and its failed-fetch alert is no loading line, so neither gets a skeleton.

## 25. Figures in VT323 (2026-10-24)

On 2026-10-24 the user found the figures hard to read: Pixelify Sans draws 5 almost like S, 2 like Z and 0 like O, so "2,097,152"
reads "2,097,1S2" and "5.4M" reads "S.4M". Shown the same Compare tiles in six faces (`$SCRATCH/glyphs/number-fonts.png`; `$SCRATCH`
is the design session's scratchpad, the folder of the reports and mockups under Inputs, as the plan names it), the user
chose the recommended one: **VT323** (Google Fonts, OFL 1.1; npm `@fontsource/vt323` at exactly 5.3.0, published 2026-07-19, the
version of the two @fontsource packages already bundled, with no dependencies of its own) for figures, and kept **Pixelify Sans for
words**. This section records that choice, the controller's scope ruling and the builder's calls that size it. It adds that one
dependency, against §3.1's and P2-D38's "no new dependencies", and it overrides anything above that disagrees: §7.3's chip,
§8.1's readout, §8.2's stack count and §10.2's `.key-number dd` fonts, §6.3's bare tooltip lines, and §24's `strip-figures`
measures. Task 2b builds it on what Phase 1 and add-on 17 draw; in §19's order it comes after the logo and before the shared
tooltip, so Tasks 3a, 4, 5a, 6a, 7, 8, 11 and 14 carry it.

Every measure below was taken in Chromium 153 (Playwright 1.63, the e2e browser) with the package's own
`vt323-latin-400-normal.woff2` and the repo's Pixelify Sans and Inter files, at device scales 1 and 2; the pages, scripts and shots are
in `$SCRATCH/vt323/` (`page/`, `scripts/`, `shots/`). The review measured the Compare tiles, the step rows, the settings count and
`span.fig` again in the app itself (the built client of `01da27d` with these rules injected; `$SCRATCH/critic/`).

**The scope** (plan ruling `figures-vt323`, the controller's, binding):
1. A token, `--font-digits`: VT323 first, then a fallback whose digits are distinct, never Pixelify.
2. Every element whose text is a figure or mainly figures uses `var(--font-digits)`: the readout values (add-on 17's Compare tiles,
   the strip's values, the recipe card's readouts), stack counts, chance tags, count chips, the step list's numbers, Phase 1's figure
   readouts and badges (the map's Y, any `--screen` readout that shows a number) and key caps that show digits. Words stay in
   Pixelify: titles, headings, buttons, tabs, labels, the logo and the badges that are words ("live").
3. Mixed text in a pixel font is decided element by element: the whole element in VT323, or Pixelify with its figures in a
   `span.fig`, whichever reads best and costs least, measured, each a builder's call. Sentences stay out of the pixel fonts (R35).
4. Each VT323 size gives digits as tall as the Pixelify ones it replaces (or the size this spec meant), on fixed line heights, so a
   late font changes no height (§3.6). A floor, VT323's twin of "Pixelify only at 13 px or more", set from legibility shots and
   pinned by the contract.
5. The Compare tiles' shrink rule (`4bef36c`) re-derived for VT323 — its maximum, its floor and its em a glyph — keeping its
   guarantee that a figure never breaks or spills (`objectives.spec.ts:150-178`, at 860 and 768 px).
6. The strip's `strip-figures` measures (§24) taken again in VT323.

**The two faces, measured.** VT323 has 1000 units an em, ascent 800, descent 200 and no line gap (its normal line height is 1.0 em),
one weight (400), and one advance for every glyph, 400 units (0.4 em): digits, `,` `.` `%` `×`, letters and the space alike. Its
digits are 560 units tall and sit on the baseline (0.56 em; its OS/2 cap height is 560 too). Pixelify Sans 400 draws a digit from −12
to 631 units (0.643 em) on an advance of 586 (`1` 404, `,` 267, `.` 222). So a VT323 digit is as tall as a Pixelify one at 1.148 × the
size:

| Pixelify size → digit height | VT323 size → digit height |
|---|---|
| 13 px → 8.36 px | 15 px → 8.40 px |
| 13.6 px (`0.85rem`) → 8.74 px | 15.6 px (`span.fig`, 1.15 em) → 8.75 px |
| 14 px → 9.00 px | 16 px → 8.96 px |
| 18 px → 11.57 px | 21 px → 11.76 px |
| 24 px → 15.43 px | 28 px → 15.68 px |

Neither face has `≤` (`Y ≤ 255` takes it from the fallback, as it did). VT323 draws `%` as a slanted cross with two small dots, which
at 16 px or less on a 1× screen reads as an x, and `×` as tall as a capital, so "×5" reads "X5" and "10%" can read "10X" (shots
`pct-dpr1.png`, `chance-dpr1-x5.png`, `pct2-dpr1-x4.png`). At 21 px its `%` reads as one.

**Builder's call: the token and its fallback** (Task 2b; plan ruling `digits-token`). `--font-digits: VT323, ui-monospace, Menlo,
Consolas, monospace` on the first `:root`, beside `--font-pixel`: the projector's monospace stack (`styles.css:1345`) behind VT323,
every face of it with distinct digits. Chromium knows no `ui-monospace` (measured: alone it fell to Times), so on macOS the fallback is
Menlo, 0.602 em a glyph. Every rule that sets `var(--font-digits)` also sets `font-size-adjust: cap-height 0.56`, after its `font`
shorthand (which resets it). VT323's own cap height is 0.56 em, so VT323 is drawn exactly as specified (measured: the same widths with
and without), while a fallback is scaled until its capitals and digits are as tall as VT323's: Menlo's 16 px "144L" goes from 38.5 to
29.6 px, its 28 px "2,097,152" from 151.7 to 116.5 px (VT323: 100.8). So a late or missing VT323 keeps its figures the same size, and
the Flow chips and the slots' counts fit with the fonts blocked (below). The token is a font token, so the dark blocks never name it
(Task 1b's `/^--(…|font|…)/`). `main.tsx` imports `@fontsource/vt323/400.css` with the other faces, before the stylesheet; of its three
subsets only the latin face is ever fetched for these texts. Rejected: an `@font-face` with `local()` sources and `size-adjust` for the
fallback, which needs no property in every rule but loads a face where `chrome.spec.ts:61` wants none.

**Builder's call: the floor** (Task 2b; plan ruling `digits-floor`). VT323 only at 14 px or more (digits 7.84 px tall). From the
legibility sheets (`legibility-dpr1.png`, `legibility-dpr2.png`: 11–20 px, on a screen and on a panel): at 2× every size from 12 px
reads; at 1× a VT323 stroke is one font pixel wide, so at 13 px it thins to about half a pixel and blurs, and from 14 px every digit
stays distinct. The contract pins it as `DIGITS_FLOOR`: every px size a `var(--font-digits)` rule gives, the Compare clamp's lower end
included, is 14 or more, and `span.fig`'s 1.15 em only ever sits in Pixelify text, which is 13 px or more (14.95 px). Pixelify's own
13 px floor stays for words.

**Builder's call: whole element or `span.fig`, element by element** (Tasks 2b, 3a, 4, 5a, 11; plan ruling `digits-mixed`). One rule
decides them all:
- **Whole VT323** for a readout that is a figure, on a screen or a slot, its unit and its few words with it, as in the comparison the
  user chose ("0.35 /s"): the Compare tiles, the strip's values and units, the recipe card's readouts, stack counts, the step list's
  numbers, the map's Y readout, the settings summary's count ("3 of 5 reachable"), the 3D layer readout ("Layers 1–12 of 20") and the
  smart upload's total ("To send: 5 chunks, 12 KB"). For the Phase 1 ones that is a CSS change only, and their markup is pinned
  (`map-view.test.tsx:36`, `view3d.test.tsx:358`, `world-smart.test.tsx:221`). Accepted there: VT323's `×` ("×5" in the recipe card's
  Machines tile reads "X5") and its `%` in the Busy tile, which reads as one at 21 px.
- **Pixelify with its figures in `span.fig`** (`tspan.fig` in an svg) for every other pixel text that shows a figure among words or
  signs: the NEI tooltip (Task 3a), the map tooltip and the 3D hover label, the map's note badges ("N5") and "Show all 13 items", the
  Materials missing badge ("short: gets 45%") and used-by chips ("Assembler (Circuit Board) 259 L/h"), the step panel's option badge
  ("in use (45%)"), the step list's pin button ("pin 5"), the line panel's "Rotate 90°" and the swap list's "25 more… (55 not shown)"
  (two buttons whose figures are no name), the note dialog's title ("Add note at 4, 63, 5"), the Connections panel's title (a box's
  "5× Basic Assembler", a hookup's "Power tap at 12 64 7", a link's "Titanium Dust 60/min · Red"), the 3D details box's title (a
  picked link's, the same "Titanium Dust 60/min · Red"; ruling P2-R15), the plan banner's heading ("This plan does not add up: 2
  inputs have no source, …"), the Flow count chip ("×5", "×1 shared"; Task 4), the recipe card's chance tag ("10%"), tier chip ("LV ·
  32 V") and overclock chips (Task 5a), and the shortcuts sheet's digit caps (`1`, `6`; Task 11). One hook-free component writes them,
  `Figs` (`src/client/components/Figs.tsx`): a figure is a run of digits with what joins them (`1,440`, `0.0586`, `10:00`, a position
  `1 64 10`, a range `1–6`) and a sign before it (`+3`, `-30`). `Figs` cannot tell a name's digit from a figure, so in a text it
  writes every digit run is a figure, a name's too ("1x Copper Wire" in a tooltip); a name stays Pixelify, digits and all, where it
  stands alone (the next point). The `%` and `×` around a figure stay in the words' Pixelify, whose `%` and `×` read where VT323's
  read as an x: "10%" is a VT323 `10` and a Pixelify `%`, "×5" a Pixelify `×` and a VT323 `5`. The span is `font: 1.15em/0
  var(--font-digits)`: 1.15 em of its Pixelify parent gives its digits the parent's digit height (14.95 px in 13 px text, 16.1 px in
  the 14 px tooltip), and a line height of 0 lets it never grow or move a line. Measured, every tooltip, badge, button, title and
  chance tag keeps its height with the fonts and without (`lh0.png`, `figspan.png`); with a line height of 1 the chance tag grew from
  14 to 16.1 px and dropped its digits.
- **Pixelify, digits and all**, for names and fixed words: titles and headings that show a name (a step's, an item's, a block's:
  `.flow-panel-head h3`, the 3D side boxes' `.view3d-box > h3`; ruling P2-R15: a title or heading that can carry a figure writes it
  through `<Figs>`, as the 3D details box's does), the project's name (an `<input>` holds no span, and the project list's link shows the
  same name), buttons that name an item ("Import X instead"), the avoid chips (an item's name), the tabs ("3D"), the logo and the word
  badges. A digit there belongs to a name, and rule 2 keeps names in Pixelify. The World page's scan rows change nothing: their state
  chip shows words only (Queued, Running, Done, Failed).

Rejected: the tooltips and badges set whole in VT323 — CSS only, but their words would leave Pixelify, against the user's choice
(`el-tips.png`, `el-badges-l.png`); and a composite face whose `unicode-range` sends every digit of the Pixelify text to VT323, which
would reach the names and the project's input too, where rule 2 keeps Pixelify.

**Builder's call: sizes and line boxes** (Tasks 2b, 4, 5a, 6a, 7, 11; plan ruling `digits-sizes`). Each element takes the VT323 size
whose digits match the Pixelify ones it had, and keeps the line box it had, in px:

| Element | Before | After | Line box | Why |
|---|---|---|---|---|
| Compare tile value `.compare-row > dd` (add-on 17) | Pixelify 24 px/1.1, shrinking to 13 px at 0.6 em a glyph | VT323 28 px, shrinking to 14 px at 0.41 em a glyph | 26.390625 px | 15.68 against 15.43 px digits; 26.390625 px is the line 24 px/1.1 gave as Chromium lays it out (it floors a unitless line height to 1/64 px, and `26.4px`, which it rounds, made a tile 1/64 px taller and moved what is below it: ruling P2-R13), now fixed, so a tile is 6 + 14.3 + 2 + 26.39 + 6 = 54.7 px at every size (54.6875 px, as before; the old line shrank with its figure, the tile to 42.6 px) and Task 8's 55 px blocks hold |
| Step number `.step-list li::marker` | Pixelify, the list's 14 px | VT323 16 px/20.3 px | 20.3 px, the list's (14 px × 1.45) in px | 8.96 against 9.00 px. The marker inherits the list's 1.45, a 23.2 px line at 16 px, and in the app (a row is a flex `.tick`) that grew every one-line row from 26.3 to 27.16 px; on the list's 20.3 px every row keeps its height (26.3 px, the longer ones 46.59, 87.19, 127.78) in VT323, its fallback or Pixelify |
| Map Y readout `.map-y` | Pixelify 13 px/1 | VT323 15 px/1 | 15 px, in its 32 px box | "Y ≤ 255" 44.2 px, "surface" 42.0; its pinned `min-width: 6em` is 90 px now (78 before) |
| Settings summary count `details.settings-section > summary > .muted` | Pixelify 13 px/1.5 | VT323 15 px/19.5 px | 19.5 px | "3 of 5 reachable" 96.0 px (101.8 before): "Reachable dimensions" (165.4 px) still wraps beside it, with 141 px at 1280 × 720 and 127 px in the drawer, as R37's `drawer.spec.ts:225-266` needs |
| 3D layer readout `.view3d-layer-text` | Pixelify 13 px/1 | VT323 15 px/1 | 15 px, in its 28 px box | "Layers 1–120 of 255" 114 px; its `min-width: 10em` (the contract asks for em) is 150 px now (130 before) |
| Smart upload total `.smart-total` | Pixelify 14 px/1.3 | VT323 16 px/18.1875 px | 18.1875 px | the line 14 px/1.3 gave as Chromium lays it out (ruling P2-R13: `18.2px` moved what is below by 1/64 px); "To send: 5 chunks, 12 KB" 153.6 px (154.3 before) |
| `span.fig` / `tspan.fig` (`Figs`) | the parent's Pixelify, 13–19.2 px | VT323 1.15 em of the parent | 0 | the parent's digit height; it moves no line (previous call) |
| Flow count chip (Task 4) | Pixelify 13 px | Pixelify 13 px, its digits `tspan.fig` at 14.95 px | — | `CHIP_CHAR_WIDTH` 9 still holds and every box keeps §7.2's width: "×5" 13.8 px with the fonts and 14.5 without, in 28 px less 2 × 5; "×1 shared" 62.6 / 57.9 px in 91; "×128" 25.8 / 28.3 px in 46 |
| Stack count `.stack-count` (Tasks 5a, 6a) | Pixelify 14 px/1 | VT323 16 px/14 px | 14 px | 8.96 against 9.00 px, in the box Pixelify's 14 px/1 had, its digits 0.75 px lower (measured at 4×); "144L" is 25.6 px, and 29.6 px with the fonts blocked (38.5 without the adjust), in the 36 px slot |
| Chance tag `.slot-chance` (Task 5a) | Pixelify 14 px/1 | Pixelify 14 px/1, its digits `span.fig` at 16.1 px | 14 px | "10%" keeps Pixelify's `%` (previous call), and the tag its 14 px box |
| Recipe readout `.readout dd` (Task 5a) | Pixelify 18 px/1.2 | VT323 21 px/21.6 px | 21.6 px | 11.76 against 11.57 px; "1,920" 42 px |
| Recipe tier and overclock chips (Task 5a) | Pixelify 13 px (`.badge`) | the same, figures `span.fig` at 14.95 px | 19.5 px | |
| Strip value `.key-number dd` (Task 7) | Pixelify 24 px/26 px | VT323 28 px/26 px | 26 px | the 52 px tile unchanged |
| Strip unit `.key-number-unit` (Task 7) | Pixelify 13 px/26 px | VT323 15 px/26 px | 26 px | part of the readout, and narrower ("raw/h" 30 px, 40.1 before) |
| Key caps `.shortcut-list kbd` (Task 11) | Pixelify 14 px/24 px | the same, a digit cap's digit `span.fig` at 16.1 px | 24 px | letter caps unchanged |
| NEI tooltip (Task 3a), map tooltip, 3D hover label | Pixelify 14 px/1.35 | the same, figures `span.fig` at 16.1 px | 18.9 px | measured: no line grows |

**Builder's call: the Compare tiles' shrink, re-derived** (Task 2b; plan ruling `compare-shrink-vt323`). `.compare-row > dd` takes
`font: 28px/26.390625px var(--font-digits); font-size: clamp(14px, calc(100cqi / (var(--glyphs, 1) * 0.41)), 28px); font-size-adjust:
cap-height 0.56` (the 26.390625 px line: ruling P2-R13), the rest of the rule (`white-space: nowrap`, `overflow: hidden`, `text-overflow: ellipsis`, `overflow-wrap: normal`)
and the tile's `container-type: inline-size` as they are. The maximum, 28 px, matches the 24 px Pixelify digits; the floor, 14 px, is
VT323's; the em a glyph is VT323's advance, 0.4, plus 2.5 % so that a figure that just fits is never cut at a subpixel (with 0.4,
"1,000,000,000,000,000" measured 213.28 px in a 213.33 px box). The old 0.6 was Pixelify's 0.586 rounded up. A 160 px tile (144 px
inside) holds 12 glyphs at 28 px and 25 at the floor (the old rule: 10 at 24 px, 18 at 13 px). Measured in the card's own grid, at
tile widths of 160, 198.7 and 229.3 px: every figure the rule can shrink above its floor stays on one line, inside its tile and not
clipped, and the tile stays 54.7 px. `objectives.spec.ts`'s figures do not shrink at 860 and 768 px (their tiles are 213.3 and
182.7 px inside; "0.000000123" is 123.2 px, "2,097,152" 100.8) and fit with the fonts blocked too (142.4 and 116.5 px). With the fonts
blocked a long figure — every one that shrinks, and from 12 glyphs in the narrowest tile, 15 at 768 px and 17 at 860 px — ends in "…"
(the size-adjusted Menlo is 0.46 em a glyph) until VT323 arrives; it still never breaks or spills (seen in the app at 768 and 860 px: a
17-glyph "1,234,567,890,123" is whole on one line with VT323, at 26.2 px at 768, and ends in "…" without it).

**Builder's call: the strip's figures, re-measured** (Task 7; plan ruling `strip-figures`, which this updates). In the narrowest tile,
the grid's 140 px (116 px inside), VT323 28 px takes 11.2 px a glyph: `0.000792` is 89.6 px, `99,999` 67.2, `0.0000792` 100.8. So
every figure `compactNumber` writes now stays whole, the one under 0.0001 included (it lost its last digit in Pixelify, at 117.8 px),
and `99,999 raw/h` fits whole with its VT323 unit (101.2 px; 120.8 in Pixelify). Only a unit can still pass the edge (`0.000792 /min`
117.6 px, `0.0000792 raw/h` 134.8), and the rare rate in words (`1 every 526 days`, Inter 15 px, 119.5 px), and the ellipsis cuts it
as before. With the fonts blocked, `0.000792` is 103.6 px and `0.0000792` 116.5 px, which can lose its last digit until VT323 arrives.
The strip still does not shrink, and its tiles stay 52 px.

**Deliberate test changes** (added to §3.9's list; nothing is removed or loosened, and the plan's new tests for Tasks 3a–11 are written
with `span.fig` from the start):

| Test | Before → after | Task |
|---|---|---|
| `styles-contract.test.tsx:2302-2333` (the Compare tiles) | `.compare-row > dd` `font` `24px/1.1 var(--font-pixel)` → `28px/26.390625px var(--font-digits)` (ruling P2-R13); `font-size` → `clamp(14px, calc(100cqi / (var(--glyphs, 1) * 0.41)), 28px)`; its comment's "11 glyphs of the 24px pixel font, at most 0.6em each" → "12 glyphs of the 28 px VT323, 0.41 em each"; "to 13px at the least" → "to 14px" | 2b |
| `styles-contract.test.tsx:1117-1129` (the step numbers) | `font-family` `var(--font-pixel)` → `var(--font-digits)`; `declared('.step-list li::marker', 'font-size')` `toBeUndefined()` → `toBe('16px')`; a row added, `line-height` `20.3px` | 2b |
| `styles-contract.test.tsx:805-821`, `:1762-1770`, `:1898-1927`, `:2037-2046` | the `font` rows of the summary count, `.map-y`, `.view3d-layer-text` and `.smart-total` → `15px/19.5px`, `15px/1`, `15px/1` and `16px/18.1875px var(--font-digits)` (ruling P2-R13) | 2b |
| `map-hover.test.tsx:360-362` | MapTooltip's lines are found in its markup with the `span.fig` tags taken out | 2b |
| `view3d.test.tsx:91`, `:356` | the hover label reads `Basic Macerator — programmed circuit <span class="fig">2</span>` | 2b |
| `map-summary.test.tsx:93`, `:154-155`, `:172-173`, `:176` | `N<span class="fig">1</span>`, `Show all <span class="fig">13</span> items` | 2b |
| `layout-map.test.tsx:319` | `>pin <span class="fig">1<\/span><\/button>` | 2b |
| `layout-map.test.tsx:182` | `'Rotate 90°'` → `'Rotate <span class="fig">90</span>°'` | 2b |
| `connections-view.test.tsx:86` | `<h3>Titanium Dust <span class="fig">60</span>/min · Red</h3>` | 2b |

**Costs and risks.**
- The light look changes on purpose, in the figures only. Task 2b's shots differ from Task 2's there, and along the lines the figures
  sit on, and nowhere else (Task 2's, not `base-a`: Tasks 1b and 2 changed the top bar); Task 1a, which runs before it, keeps its
  pixel-identical check as it was made.
- One dependency more: 73 kB packed, of which the browser fetches the 17.5 kB latin face, and only where a figure is drawn.
- VT323's strokes are thinner than Pixelify's, so less of a stack count sits on its 2 px shadow (D8's measure). Task 5a's review shots
  judge it on the light slot; cost if wrong: a 1 px shadow for the counts.
- A browser without `font-size-adjust` drops the declaration, and only the fallback, while VT323 loads, comes out wider.

> **As built.** `CHIP_CHAR_WIDTH` became 10 in Task 4 (P2-R8a): each chip in the count chip's row above has a pixel more room a
> character ("×5" in 30 px, not 28). A title or heading that can carry a figure writes it through `<Figs>` (P2-R15, in the scope
> above).
