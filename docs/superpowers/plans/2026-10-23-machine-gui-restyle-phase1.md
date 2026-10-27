# Machine GUI Restyle — Phase 1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every page of the web client wears the B "Machine GUI" look, the Flow and Connections diagrams draw
moving pipes that end exactly on their ports, and the Phase 1 motion system is in — with no change in behaviour.

**Architecture:** Most of the work is in the single stylesheet `src/client/styles.css`: a new token set, ink colours
per surface, restyled controls, then each area in turn. TSX changes are small and local: font imports, a brand mark,
a narrow-screen settings drawer, inline styles moved to classes, and one animated overlay per diagram edge driven by a
new pure module `src/client/views/pipe-motion.ts`. New guards: a stylesheet contract test, a contrast test, and e2e
specs for pipes, theme, focus, fonts and the drawer.

**Tech Stack:** React 19, Vite 8, TypeScript 6, vitest 5 (client project = `tests/client/**/*.test.tsx`, node
environment, `renderToStaticMarkup`), Playwright 1.63 (Chromium, 1280×720, real server on port 18787 with the
Mini-GT fixture), new: `@fontsource/pixelify-sans`, `@fontsource/inter`.

**Spec:** `docs/superpowers/specs/2026-10-22-machine-gui-restyle-design.md` — §3 constraints, §4 tokens and ink,
§5 typography, §6 components, §7 pipes, §7a motion, §8 Phase 1. Look reference: mockup B at
`<the design session's scratchpad, not in the repo>/restyle-canvas/project/MachineGui.dc.html`.
Before shots: `<the design session's scratchpad, not in the repo>/shots/*.png`.
Per-area scout notes (exact markup and test constraints, with line numbers):
`<the design session's scratchpad, not in the repo>/recon/`
(`6-chrome.md` chrome and base, `2-flow.md` Flow, `3-connections.md` Connections, `5-panels-forms.md` settings and
lists, `1-chrome.md` Map, `4-chrome.md` 3D/World/projector).

## Global Constraints

- No change to planning logic, server, API, data or the mods; map terrain and 3D WebGL drawing are untouched.
- One theme: no `prefers-color-scheme` rule anywhere; `<meta name="color-scheme" content="dark">`. *Superseded by Phase 2 (2026-10-24 spec §4): two looks, Auto by default.*
- Radius 0 everywhere; the only round shapes are the map's `.pin-dot` (mirrors the canvas markers).
- Pixelify Sans only for headings, tabs, buttons, readouts, chips, stack counts and tooltips; never below 13 px; every
  stack is `'Pixelify Sans', Inter, sans-serif`. Body is Inter 14 px / 1.45. Diagram SVG text keeps
  `system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif` (its metrics are pinned by tests).
  *Superseded by Phase 2 (2026-10-24 spec §25): figures in VT323, words in Pixelify.*
- Motion: animate only `transform`/`opacity` (plus `stroke-dashoffset` for pipes and `background-color` on hover);
  nothing over 300 ms that the user waits for; never a CSS `transform` on an SVG `<g>`; no infinite `transform`
  animation on anything clickable (Playwright waits for stable elements); under `prefers-reduced-motion: reduce`
  nothing moves.
  *Superseded in part by Phase 2 (2026-10-24 spec §16): a WAAPI `transform` animation on an SVG `<g>` whose last keyframe equals its `transform` attribute, with `fill: 'none'`, drives the diagrams' pans and glides.*
- Contrast: every text pair in spec §4 meets WCAG AA; the focus ring is 3 px `#ffff55`, offset 0.
- Decorative `::before`/`::after` use `content: ''` — never glyphs (they join accessible names).
- Native inputs stay native, visible and clickable; nothing is inserted between an input and its label text.
- Tests: every selector, attribute order, test id, label and text listed in spec §3 and the scout notes keeps working.
  Unit tests that match markup change only where a task says so; no assertion is deleted or loosened.
  Every commit has `npm test` green; tasks that say so also run `npm run e2e` green.
- Chrome height budget at 1280×720 (e2e aims at canvas centres): top bar ≤ 53 px, tab strip ≤ 41 px with no margin
  below it, `.tab-panel` padding ≤ 8 px.
- New dependencies are exact pins installed with
  `npm install --save-exact --before="$(date -v-14d +%F)" <pkg>` and get a row in the pin table of
  `docs/research/web-stack.md` (header at line 52).

## Review Focus

1. **The OS is in dark mode (or light mode).** The app must look identical either way, since the dark-mode blocks are
   gone → Task 1 `tests/e2e/theme.spec.ts`. *Superseded by Phase 2 (2026-10-24 spec §4): two looks, Auto by default.*
2. **Web fonts load late or not at all** (LAN, first visit). Control heights must not change when Pixelify/Inter
   arrive, or the e2e coordinate tests and the layout jump → Task 3 `tests/e2e/chrome.spec.ts` "fonts blocked".
3. **Keyboard-only use.** The focus ring must be visible on a light panel and on the dark top bar → Task 2
   `tests/e2e/focus.spec.ts`.
4. **Reduced motion.** With `prefers-reduced-motion: reduce` nothing may keep moving (pipes, live dot, panels) →
   Task 3 `chrome.spec.ts` "reduced motion" and Task 6 `pipes.spec.ts` "reduced motion".
5. **A huge plan** (hundreds of edges). Panning must stay smooth: pipes pause while dragging, and above 200 edges only
   lit edges animate → Task 6 `pipe-motion.test.tsx` (`pipeAnimationMode`) and the `many-edges` / `dragging`
   contract rules.

## File map

| File | Tasks | Responsibility |
|---|---|---|
| `src/client/styles.css` | 1–9 | all tokens, surfaces, controls and area styles |
| `src/client/main.tsx`, `src/client/index.html` | 1 | font imports, color-scheme |
| `package.json`, `package-lock.json`, `docs/research/web-stack.md` | 1 | two font dependencies |
| `src/client/components/TopNav.tsx` | 3 | brand mark |
| `src/client/views/ProjectPage.tsx` | 3, 4 | tab-panel key, settings drawer |
| `src/client/components/SettingsToggle.tsx` (new) | 4 | the drawer's toggle button |
| `src/client/components/ItemIcon.tsx`, `src/client/views/StepsView.tsx` | 5 | radius out, pin-link style to CSS |
| `src/client/views/pipe-motion.ts` (new) | 6, 7 | pipe speed and animation mode |
| `src/client/views/FlowView.tsx`, `src/client/views/flow-model.ts` | 6 | pipes, markers, flanges |
| `src/client/views/ConnectionsView.tsx` | 7 | pipes, marker, casing for dark dyes |
| `src/client/views/MapTab.tsx`, `MapView.tsx`, `src/client/map/LinePanel.tsx`, `FoundPanel.tsx`, `MapTooltip.tsx` | 8 | inline styles → classes |
| `src/client/views/View3D.tsx`, `WorldPage.tsx`, `SmartUploadPanel.tsx`, `ProjectorPanel.tsx` | 9 | inline styles → classes |
| `tests/client/styles-contract.test.tsx` (new) | 1–9 | stylesheet contract, grows per task |
| `tests/client/contrast.test.tsx` (new) | 1 | AA ratios of the token pairs |
| `tests/client/pipe-motion.test.tsx`, `tests/client/flow-pipes.test.tsx`, `tests/client/settings-toggle.test.tsx` (new) | 4, 6 | units |
| `tests/e2e/theme.spec.ts`, `focus.spec.ts`, `chrome.spec.ts`, `drawer.spec.ts`, `pipes.spec.ts` (new) | 1–7 | behaviour in Chromium |

Work on a branch `feat/machine-gui-restyle-p1` in a worktree (superpowers:using-git-worktrees).

---

### Task 1: Foundation — fonts, tokens, ink, motion, page

**Files:**
- Modify: `package.json`, `package-lock.json`, `docs/research/web-stack.md` (pin table rows after line 72)
- Modify: `src/client/main.tsx` (imports before line 4 `import './styles.css';`)
- Modify: `src/client/index.html:6`
- Modify: `src/client/styles.css:1-48` (replace), delete the dark blocks at `:23-39`, `:293-307`, `:479-481`
- Create: `tests/client/styles-contract.test.tsx`, `tests/client/contrast.test.tsx`, `tests/e2e/theme.spec.ts`

**Interfaces:**
- Produces (CSS custom properties on `:root`, used by every later task): the token block below; the ink properties
  `--ink --ink-muted --ink-title --ink-link --ink-error --ink-ok --ink-warn`; keyframes `fade-in`, `rise-in`,
  `scale-in`, `slide-in-right`, `pop`, `breathe`, `blink`, `pipe-flow`, `pipe-pulse`; the **panel surface group**
  rule (a selector list that sets panel ink) which later tasks extend; old-name aliases removed in Task 9.
- Produces (test helpers, local to `styles-contract.test.tsx`, reused by later tasks' added cases):
  `css: string` (the stylesheet text), `rootTokens(): Map<string, string>` (every declaration inside every `:root`
  block), `ruleBody(selector: string): string` (the declarations of the first rule whose selector list equals
  `selector` exactly; throws if absent).

- [ ] **Step 1: Write the failing contract, contrast and theme tests**

`tests/client/styles-contract.test.tsx` — read `src/client/styles.css`, `src/client/index.html` and
`src/client/main.tsx` with `readFileSync(new URL('../../src/client/…', import.meta.url), 'utf8')`.
Cases:
- `declares the Machine GUI tokens`: every `[name, value]` of the token block below appears in `rootTokens()`
  exactly (iterate a `TOKENS` array copied from the block).
- `has one theme`: `css` does not contain `prefers-color-scheme`; `index.html` contains
  `<meta name="color-scheme" content="dark" />`.
- `stops motion for reduced-motion users`: `css` has an `@media (prefers-reduced-motion: reduce)` block containing
  `animation-duration: 1ms !important`, `animation-iteration-count: 1 !important` and
  `transition-duration: 1ms !important`.
- `defines the keyframes`: each of the nine keyframe names appears as `@keyframes <name>`.
- `loads the fonts before the stylesheet`: in `main.tsx` the seven imports
  `@fontsource/pixelify-sans/{400,600,700}.css` and `@fontsource/inter/{400,500,600,700}.css` all occur before
  `import './styles.css'`.
- `paints the stone page`: `ruleBody('body')` contains `background-color: var(--page)` and `background-size: 16px 16px`.
- `makes the tab panel a panel`: `ruleBody('.tab-panel')` contains `background: var(--panel)`,
  `border: 2px solid var(--outline)` and `box-shadow: var(--bevel-panel)`; `ruleBody('.tabs')` contains `margin: 0`.

`tests/client/contrast.test.tsx` — local pure functions `luminance(hex: string): number` (WCAG relative
luminance) and `ratio(a: string, b: string): number`. One `it.each` over these pairs, each `≥ 4.5`:
page `#2b2b2b` with `#dddddd #aaaaaa #ffffff #ffff55 #ff5555 #55ff55 #ffaa00`; panel `#c6c6c6` with
`#303030 #4a4a4a #404040 #1a3fa0 #aa0000 #1e5a1e #6a4000`; dark `#1b1b1b` with
`#ffffff #aaaaaa #ffff55 #ff5555 #55ff55 #ffaa00` and the 15 tier colours of spec §4; buttons: `#ffffff` on
`#6b6b6b`, `#4a5499`, `#aa0000`, `#c62828`; `#ffff55` on `#6b6b6b`; tabs: `#1b1b1b` on `#8b8b8b`, `#303030` on
`#c6c6c6`. (Expected minimum is `#ff5555` on `#2b2b2b` at 4.50.)

`tests/e2e/theme.spec.ts` — `test('looks the same whatever the OS theme')`: for `colorScheme` of `'light'` and
`'dark'`, open a fresh context with `browser.newContext({ colorScheme })`, `login`, `setName`, go to `/`, and read
`getComputedStyle(document.body).backgroundColor` and the computed background of `form.new-project`; expect both
schemes to give `rgb(43, 43, 43)` and `rgb(198, 198, 198)`.

- [ ] **Step 2: Run them to see them fail**

Run: `npx vitest run tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx`
Expected: contract cases FAIL (tokens missing, `prefers-color-scheme` present); contrast cases PASS (they test the
spec values, which are already right — keep them as the guard for later edits).

- [ ] **Step 3: Add the font packages**

Run: `npm install --save-exact --before="$(date -v-14d +%F)" @fontsource/pixelify-sans @fontsource/inter`
Expected: both in `dependencies` with exact versions; add one row each (licence OFL-1.1) to the pin table in
`docs/research/web-stack.md`.

- [ ] **Step 4: Import the fonts, switch color-scheme**

`main.tsx`: the seven imports listed in Step 1, in that order, before `import './styles.css';`.
`index.html:6`: `<meta name="color-scheme" content="dark" />`, and add `<meta name="theme-color" content="#1a1a1a" />`.

- [ ] **Step 5: Replace the tokens and base rules (`styles.css:1-48`), delete the three dark blocks**

The `:root` block, exactly (values are spec §4):

```css
:root {
  --page: #2b2b2b; --page-check: #262626; --bar: #1a1a1a;
  --panel: #c6c6c6; --panel-hi: #ffffff; --panel-lo: #555555; --outline: #000000;
  --slot: #8b8b8b; --slot-hi: #ffffff; --slot-lo: #373737; --well: #373737; --screen: #1b1b1b;
  --text: #303030; --text-muted: #4a4a4a; --title: #404040;
  --btn: #6b6b6b; --btn-hi: #a0a0a0; --btn-lo: #3c3c3c; --btn-hover: #4a5499;
  --danger-face: #aa0000; --danger-face-hover: #c62828; --link: #1a3fa0;
  --accent: #ffff55; --screen-text: #55ff55; --screen-muted: #aaaaaa; --chat: rgba(0, 0, 0, 0.82);
  --tip-bg: rgba(16, 0, 16, 0.94); --tip-border: #5000ff; --tip-inner: #28007f;
  --item: #ffff55; --fluid: #55ffff;
  --bevel-panel: inset 3px 3px 0 var(--panel-hi), inset -3px -3px 0 var(--panel-lo);
  --bevel-btn: inset 2px 2px 0 var(--btn-hi), inset -2px -2px 0 var(--btn-lo);
  --bevel-btn-down: inset 2px 2px 0 var(--btn-lo), inset -2px -2px 0 var(--btn-hi);
  --bevel-slot: inset 2px 2px 0 var(--slot-lo), inset -2px -2px 0 var(--slot-hi);
  --bevel-well: inset 2px 2px 0 #000000, inset -2px -2px 0 var(--panel-lo);
  --tier-ulv: #9a9a9a; --tier-lv: #dddddd; --tier-mv: #55ffff; --tier-hv: #ffaa00; --tier-ev: #ff55ff;
  --tier-iv: #8c9cff; --tier-luv: #ff8cff; --tier-zpm: #ff5555; --tier-uv: #55dddd; --tier-uhv: #ff6b6b;
  --tier-uev: #55ff55; --tier-uiv: #00cc00; --tier-umv: #ffff55; --tier-uxv: #8080ff; --tier-max: #ff5555;
  --dur-fast: 90ms; --dur-base: 160ms; --dur-slow: 260ms; --dur-exit: 180ms;
  --ease-out: cubic-bezier(0.2, 0.8, 0.2, 1); --ease-pop: cubic-bezier(0.34, 1.56, 0.64, 1); --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --font-pixel: 'Pixelify Sans', Inter, sans-serif; --font-ui: Inter, system-ui, sans-serif;
  --font-diagram: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif;
  --ink: #dddddd; --ink-muted: #aaaaaa; --ink-title: #ffffff; --ink-link: #ffff55;
  --ink-error: #ff5555; --ink-ok: #55ff55; --ink-warn: #ffaa00;
  --gap: 12px;
  /* Old names, still read by inline styles and older rules; Task 9 removes them. */
  --bg: var(--page); --surface: var(--panel); --surface-2: #b5b5b5; --border: #555555; --radius: 0;
  --muted: #4a4a4a; --ok: #1e5a1e; --error: #aa0000; --error-bg: #e3b0b0;
  --warn-bg: #e6d9a8; --warn-border: #6a4000; --accent-text: #1b1b1b;
  color-scheme: dark; scrollbar-color: var(--btn) var(--screen);
  font-family: var(--font-ui); font-size: 14px; line-height: 1.45; color: var(--ink); background: var(--page);
}
```

Then, in the same edit:
- `body`: stone background — `background-color: var(--page)`, two 45° `linear-gradient(… var(--page-check) 25%,
  transparent 25%, transparent 75%, var(--page-check) 75%)` layers, `background-size: 16px 16px`,
  `background-position: 0 0, 8px 8px` (on `background`, never an overlay element: the Connections e2e hit-tests
  empty canvas area).
- `h1, h2, h3 { color: var(--ink-title) }`; `h1` and `h2` in `var(--font-pixel)` 600 (1.6 rem / 1.2 rem).
- `a, button.link { color: var(--ink-link) }`; `.muted { color: var(--ink-muted) }`; `.error { color: var(--ink-error) }`.
- **Panel surface group:** one rule `.card, .modal, .settings-panel, .flow-panel, .conn-panel, .tab-panel,
  .plan-banner, .banner, .what-changed, .flow-issues, .flow-infeasible, .delete-confirm` that sets the panel ink of
  spec §4 (`--ink: #303030; --ink-muted: #4a4a4a; --ink-title: #404040; --ink-link: #1a3fa0; --ink-error: #aa0000;
  --ink-ok: #1e5a1e; --ink-warn: #6a4000; --muted: #4a4a4a; color: var(--ink)`). These all have light backgrounds
  until Task 3/6 turn some into dark boxes (those tasks move them to the dark group).
- `.tab-panel { background: var(--panel); border: 2px solid var(--outline); box-shadow: var(--bevel-panel); padding: 8px }`
  and `.tabs { margin: 0 }` (height budget: the strip loses its 16 px margin as the panel gains 10 px).
- The nine `@keyframes` (opacity/transform only, except `pipe-flow` = `to { stroke-dashoffset: -16 }` and
  `pipe-pulse` = `from { filter: brightness(1.6) }`; `breathe` and `blink` animate opacity only) and the reduced-motion
  block: `:root` sets the four `--dur-*` to `0ms`; `*, *::before, *::after` get the three `!important` declarations
  the test expects.

- [ ] **Step 6: Run everything**

Run: `npm test` → PASS. Run: `npm run e2e` → PASS (including `theme.spec.ts`).

- [ ] **Step 7: Commit**

```bash
git add package.json package-lock.json docs/research/web-stack.md src/client/main.tsx src/client/index.html src/client/styles.css tests/client/styles-contract.test.tsx tests/client/contrast.test.tsx tests/e2e/theme.spec.ts
git commit -m "feat(client): Machine GUI tokens, fonts, ink per surface and motion foundation"
```

---

### Task 2: Controls

**Files:**
- Modify: `src/client/styles.css` — the controls section (old `:50-65`), utilities (old `:192-199`)
- Modify: `tests/client/styles-contract.test.tsx` (add cases)
- Create: `tests/e2e/focus.spec.ts`

**Interfaces:**
- Consumes: Task 1 tokens.
- Produces: classes later tasks rely on — `button.small` (28 px), `button.primary`, `button.danger`, `button.link`;
  `details.settings-section > summary` and `details.disclosure > summary` (Minecraft-button summary; Task 4 and 9 use
  them); `.badge`, `.badge.muted`, `.chip` (dark rectangles).

- [ ] **Step 1: Write the failing tests**

Contract cases (use `ruleBody`):
- `:where(button)` contains `min-height: 36px`, `border: 2px solid var(--outline)`, `box-shadow: var(--bevel-btn)`,
  `font: 15px/1 var(--font-pixel)`; `:where(button:active:not(:disabled))` contains `transform: translateY(1px)` and
  `box-shadow: var(--bevel-btn-down)`.
- `:where(button.small)` contains `min-height: 28px`; `:where(button.danger)` contains `background: var(--danger-face)`.
- `:where(input[type=checkbox], input[type=radio])` contains `appearance: none` and `background: var(--screen)`.
- `:focus-visible` contains `outline: 3px solid var(--accent)` and `outline-offset: 0`.
- `:where(input:not([type=checkbox], [type=radio], [type=range], [type=file]), textarea, select)` exists (text
  fields never box the checkbox/range/file inputs).

`tests/e2e/focus.spec.ts` — `test('the focus ring shows on panels and on the top bar')`: `login`, `setName`, go to
`/`; click the `New project` input, press `Tab`; the focused element is the `Create` button and its computed
`outlineColor` is `rgb(255, 255, 85)` and `outlineWidth` `3px`. Then reload, press `Tab` from the page start until
the `Projects` nav link is focused; same two values.

- [ ] **Step 2: Run them to see them fail** — `npx vitest run tests/client/styles-contract.test.tsx` → the new
  cases FAIL.

- [ ] **Step 3: Rewrite the controls**

All base selectors wrapped in `:where(…)` so any component rule wins (specificity trap: today
`button:hover:not(:disabled)` outranks `.tabs [role='tab']`, `.mat-toggle`, `.flow-toolbar button`). Values from
spec §6 and the mockup (`MachineGui.dc.html:22-24`):
- Button: `min-height: 36px; padding: 0 14px; border: 2px solid var(--outline); border-radius: 0;
  background: var(--btn); box-shadow: var(--bevel-btn); color: #ffffff; font: 15px/1 var(--font-pixel);
  text-shadow: 2px 2px 0 #3f3f3f; cursor: pointer; transition: background-color var(--dur-fast) var(--ease-out),
  transform var(--dur-fast) var(--ease-out)`; hover `background: var(--btn-hover)`; active as in Step 1; disabled
  `background: #4a4a4a; color: #a0a0a0; text-shadow: none; box-shadow: none; cursor: default` (no opacity).
  `.primary`: `color: var(--accent); text-shadow: 2px 2px 0 #3f3f15`. `.danger`: `background: var(--danger-face)`,
  hover `var(--danger-face-hover)`. `.small`: `min-height: 28px; padding: 0 10px; font-size: 13px`. `.link`: every
  button property reset (no background, border, bevel, min-height, padding, text-shadow), `font: inherit`,
  underline, `color: var(--ink-link)`.
- Text fields, textarea, select: `min-height: 36px; padding: 6px 10px; background: #000000;
  border: 2px solid var(--btn-hi); border-radius: 0; color: #ffffff; font: 14px var(--font-ui)`; focus
  `border-color: var(--accent)`; `::placeholder { color: #8b8b8b }`; `select { appearance: none; padding-right: 26px }`
  with a pixel caret as an inline SVG data-URI `background-image` (8 × 5 px, `#ffffff`, `shape-rendering:
  crispEdges`), right 8 px; `input[type=search]` `appearance: none` and a styled `::-webkit-search-cancel-button`.
  Keep the `aria-invalid="true"` border `#ff5555`.
- Checkbox/radio (per spec §6): 16 × 16 `--screen` well, `box-shadow: var(--bevel-slot)`, `display: inline-grid;
  place-content: center; margin: 0; flex: none`; `::before { content: ''; width: 10px; height: 10px; opacity: 0;
  transform: scale(0.6); transition: opacity var(--dur-fast) var(--ease-pop), transform var(--dur-fast) var(--ease-pop) }`;
  checkbox tick = `background: var(--screen-text)` with a pixel-tick `clip-path: polygon(…)`; radio dot = a 6 × 6
  square; `:checked::before { opacity: 1; transform: none }`; disabled dims the well.
- Range: `appearance: none; background: transparent`; track (`::-webkit-slider-runnable-track`,
  `::-moz-range-track`) 6 px `--screen` with `--bevel-well`; thumb 12 × 20 `--btn`, 2 px outline, `--bevel-btn`.
- Progress: `appearance: none; width: 100%; height: 14px; border: 2px solid var(--outline); background: var(--screen)`;
  `::-webkit-progress-bar` `var(--screen)`; `::-webkit-progress-value` and `::-moz-progress-bar`
  `var(--screen-text)` (the bevel is the border: an inset shadow is hidden under the bar pseudo-element).
- File input: no field box; `::file-selector-button` looks like `button.small`.
- `details.settings-section > summary, details.disclosure > summary`: full-width button look, `list-style: none`,
  `::-webkit-details-marker { display: none }`, a `::before` pixel caret (`content: ''`, CSS-drawn) that rotates 90° on
  `[open]` over `var(--dur-fast)`. No global `summary` rule (it would hit Materials and 1,500 storage rows).
- `:focus-visible { outline: 3px solid var(--accent); outline-offset: 0 }`.
- `.badge, .chip`: `background: var(--screen); color: #ffffff; border-radius: 0; padding: 0 6px;
  font: 13px/1.5 var(--font-pixel)`; `.badge.muted { color: var(--screen-muted) }`.

- [ ] **Step 4: Run** — `npm test` → PASS; `npm run e2e` → PASS (including `focus.spec.ts`; `build-cost.spec.ts`
  checks a radio, `sync.spec.ts` clicks a checkbox, `reuse.spec.ts` unchecks one — all must stay green).

- [ ] **Step 5: Commit** — `git commit -m "feat(client): Minecraft controls — buttons, fields, ticks, sliders, bars"`

---

### Task 3: App chrome — top bar, login, modal, project head, banners, tabs, lists, notes

**Files:**
- Modify: `src/client/components/TopNav.tsx:11`, `src/client/views/ProjectPage.tsx:273`
- Modify: `src/client/styles.css` (top nav `:70-77,:574`; containers `:79-109`; login `:111-113`; project head
  `:115-124`; plan banner `:126-141`; what-changed `:143-148`; tabs `:150-155`; modal `:157-165`; notes `:167-175`;
  tick `:177-180`)
- Modify: `tests/client/scaffold.test.tsx`, `tests/client/styles-contract.test.tsx`
- Create: `tests/e2e/chrome.spec.ts`

**Interfaces:**
- Consumes: Task 1 surfaces and keyframes, Task 2 controls.
- Produces: the **dark surface group** rule (dark ink of spec §4: `--ink: #ffffff; --ink-muted: #aaaaaa;
  --ink-title: #ffff55; --ink-link: #ffff55; --ink-error: #ff5555; --ink-ok: #55ff55; --ink-warn: #ffaa00;
  --muted: #aaaaaa`) starting with `.banner, .plan-banner, .what-changed, .delete-confirm, .connection, .badge,
  .chip` (moved out of the panel group); `.brand-mark` (reused by the login card).

- [ ] **Step 1: Write the failing tests**

`scaffold.test.tsx`: the rendered TopNav contains
`<span class="brand"><span class="brand-mark" aria-hidden="true"></span>GTNH Line Planner</span>` (keep the existing
nav assertions at `:28-31` unchanged).
Contract: `ruleBody('.tabs [role=\'tab\']')` contains `min-height: 38px` and `font: 15px/1 var(--font-pixel)`;
`ruleBody('.tab-panel')` contains `animation: fade-in var(--dur-base) var(--ease-out)`;
`ruleBody('.connection.live::before')` contains `animation: breathe 2s` and no `transform`;
`ruleBody('.modal')` contains `animation: scale-in var(--dur-slow) var(--ease-out)`.
`tests/e2e/chrome.spec.ts`:
- `test('fonts arriving late do not move the chrome')`: with `page.route('**/*.woff2', r => r.abort())` open a
  project (`createProject`), measure the boundingBox heights of `.top-nav` and the first `[role=tab]`; then in a new
  context without the route, measure again; expect equal heights, `.top-nav` ≤ 53, tab = 38.
- `test('reduced motion stops the live dot')`: `page.emulateMedia({ reducedMotion: 'reduce' })`, open a project; the
  computed `animationIterationCount` of `.connection.live` `::before` is `'1'`.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: TSX**

- `TopNav.tsx:11`: `<span className="brand"><span className="brand-mark" aria-hidden="true" />GTNH Line Planner</span>`.
- `ProjectPage.tsx:273`: add `key={active.id}` to `<section className="tab-panel" …>` (the view already remounts per
  tab; the key replays the fade).

- [ ] **Step 4: CSS** (values from scout note `6-chrome.md` §7.4 and the mockup; every height fixed so a font swap
  cannot change it)

- Top bar: `background: var(--bar); border-bottom: 2px solid #000; box-shadow: inset 0 -2px 0 #3c3c3c;
  padding: 6px 20px; gap: 20px; min-height: 50px; flex-wrap: wrap`. `.brand`: Pixelify 20 px 700, `#ffd84a`,
  `text-shadow: 2px 2px 0 #3f3300`, `display: inline-flex; gap: 10px; align-items: center`. `.brand-mark`:
  32 × 32, `background: var(--brand-mark) center / contain no-repeat`, where `--brand-mark` (on `:root`) is an
  SVG data URI of the 8 × 8 mark (`viewBox 0 0 8 8`, `shape-rendering: crispEdges`; paths d `#000` / e `#ffd84a` /
  f `#c98a00` / a `#fff` exactly as listed in `6-chrome.md` §7.4). Nav: selector `.top-nav nav a` (not
  `.top-nav a`) with the button look at 36 px, Pixelify 15 px, white; `[aria-current='page'] { color: var(--accent) }`.
  The top bar stays non-sticky and the brand stays a non-link.
- Login: `.login` gets `::before` = the brand mark (64 px) centred above the `h1`; the card is a panel.
- Modal: backdrop `rgba(0, 0, 0, 0.6)` + `animation: fade-in var(--dur-base) var(--ease-out)`; `.modal` =
  panel (`border: 2px solid var(--outline); box-shadow: var(--bevel-panel), 0 2px 0 #000`, radius 0) +
  `animation: scale-in var(--dur-slow) var(--ease-out)`; `.modal h2` Pixelify, `var(--ink-title)`. Entrance only.
- Project head: `.project-name` Pixelify 22 px, page ink, transparent `2px` border (`#a0a0a0` on hover; on focus a
  black field with `var(--accent)` border), `min-height: 36px`. `.connection`: `--screen` chip, Pixelify 14 px,
  `#55ff55`; `::before` an 8 px square; `.live::before { background: #55ff55; animation: breathe 2s ease-in-out
  infinite }`; not live: `#ffaa00` text and dot with `animation: blink 1.6s steps(2) infinite`. No panel around the
  head (height budget).
- `.plan-cost`: page ink, tabular numbers, Inter 14 px (the element and its exact class stay; no class added).
- `.plan-banner`, `.banner`, `.what-changed`: chat boxes (`background: var(--chat); border: 2px solid #000`) moved
  to the **dark group**; problems (`.plan-banner > .error`, `.banner-integrity`, `.banner-heading.error`) Pixelify
  `#ff5555` with `#ffaaaa` items; other warnings and hints yellow; `.banner.notice` yellow; `.banner.error` red;
  `animation: rise-in var(--dur-base) var(--ease-out)`, except a banner holding only the busy line
  (`.plan-banner:has(> p.muted:only-child) { animation: none }`). `button.banner-chip`: `button.small` look with its
  16 px icon. Class strings `plan-cost`, `plan-banner`, `banner-cost` are untouched (plan-banner.test.tsx).
- Tabs (`.tabs [role='tab']`): creative-inventory tabs — `position: relative; top: 2px; min-height: 38px;
  padding: 0 14px; border: 2px solid #000; font: 15px/1 var(--font-pixel)`; unselected `background: #8b8b8b;
  box-shadow: inset 2px 2px 0 #a8a8a8; color: #1b1b1b`; selected `background: var(--panel); box-shadow: inset 2px
  2px 0 #fff; border-bottom-color: var(--panel); color: #303030`; tablist `gap: 2px; padding-left: 6px; border: 0`.
  `.tab-panel` adds `animation: fade-in var(--dur-base) var(--ease-out)`.
- Project list: `.project-card` a panel (already in the panel group via `.card`); `.project-link` Pixelify 16 px in
  `var(--ink)`; `.project-card .delete-open` = `button.small` + danger face; `.delete-confirm` a chat box (dark
  group); `.recently-deleted` heading on the stone in page ink.
- Notes: `.note`, `.note-add` panels (add to the panel group); `.note-actions button` = `button.small`.
- Tick: `.tick.marked .tick-label { color: var(--ink-muted) }`; `.tick-by { color: var(--ink-ok);
  animation: pop var(--dur-fast) var(--ease-pop) }` (the `✓` text stays).

- [ ] **Step 5: Run** — `npm test` → PASS; `npm run e2e` → PASS (incl. `chrome.spec.ts`; `login.spec.ts`,
  `delete.spec.ts`, `build-cost.spec.ts` guard the chrome texts).

- [ ] **Step 6: Commit** — `git commit -m "feat(client): Machine GUI chrome — top bar, tabs, banners, modal, lists"`

---

### Task 4: Settings column and the narrow-screen drawer

**Files:**
- Create: `src/client/components/SettingsToggle.tsx`
- Modify: `src/client/views/ProjectPage.tsx` (head `:242`, aside `:250`, body `:249`)
- Modify: `src/client/styles.css` (settings `:201-272`, media `:566-569`)
- Create: `tests/client/settings-toggle.test.tsx`, `tests/e2e/drawer.spec.ts`; modify the contract test

**Interfaces:**
- Produces: `export function SettingsToggle(props: { open: boolean; onToggle: () => void }): ReactElement` —
  renders exactly `<button type="button" class="settings-toggle" aria-expanded="…" aria-controls="project-settings">Settings</button>`.

- [ ] **Step 1: Write the failing tests**

`settings-toggle.test.tsx`: `renderToStaticMarkup(<SettingsToggle open={false} onToggle={() => {}} />)` equals
`<button type="button" class="settings-toggle" aria-expanded="false" aria-controls="project-settings">Settings</button>`;
with `open` it contains `aria-expanded="true"`.
Contract: inside `@media (max-width: 900px)` the stylesheet has `.settings-panel` with
`transform: translateX(-105%)` and `visibility: hidden`, `.settings-open .settings-panel` with `transform: none`,
and `.settings-toggle` is `display: none` outside the query.
`drawer.spec.ts` — `test('narrow screens open the settings as a drawer')`: viewport 800 × 900, `createProject`;
`aside[aria-label="Project settings"]` is hidden; click `getByRole('button', { name: 'Settings' })` → the aside is
visible and the toggle has `aria-expanded="true"`; press `Escape` → hidden again and focus is back on the toggle;
open again, click `.drawer-backdrop` → hidden.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement `SettingsToggle` and wire `ProjectPage`**

`ProjectPage`: `const [settingsOpen, setSettingsOpen] = useState(false)` declared with the other hooks, above every
early return; the toggle is the first child of `.project-head`; the aside gets `id="project-settings"` (keep
`aria-label="Project settings"`); `.project-body` gets class `settings-open` while open; render
`{settingsOpen && <div className="drawer-backdrop" onClick={close} />}` after `.project-body` (not inside its grid);
while open a `keydown` listener on `document` closes on `Escape` and returns focus to the toggle (via a ref); the
effect cleans up (StrictMode double-invokes effects). The aside stays mounted.

- [ ] **Step 4: CSS**

- `.settings-panel`: transparent sticky column, `display: flex; flex-direction: column; gap: 12px`; keep its
  `max-height`/scroll; remove its old surface (drop it from the panel group — each section is the panel now).
- `.settings-section`: a panel (`background: var(--panel); border: 2px solid var(--outline);
  box-shadow: var(--bevel-panel); padding: 12px`; add to the panel group); remove the old separators.
- Titles `.settings-section h3, .settings-title, .choice > legend.settings-title` and the summary: Pixelify 16 px,
  `var(--ink-title)`; the `<h3>` stays attribute-less (settings.test.tsx). The summary's count `span.muted` is a
  `--screen` readout chip (`color: var(--screen-text)`), since `#aaaaaa` on the button face fails AA.
- `<details>` open/close height: `interpolate-size: allow-keywords` on `details.settings-section` and a
  `::details-content` transition of `block-size` and `content-visibility` over `var(--dur-base)` (instant where
  unsupported).
- `.check`, `.choice`: `align-items: flex-start` for wrapped labels; dims `.dim-name::before` a square LED with a
  1 px black outline, `#55ff55` when `.reachable`; cost table cells on the panel; `.avoid-chip` a `--screen`
  rectangle with amber text (`#ffaa00`), its `×` remove button reset to a square mini button.
- Drawer, inside `@media (max-width: 900px)` replacing `:566-569`: `.settings-toggle { display: inline-flex }`;
  `.settings-panel { position: fixed; inset: 0 auto 0 0; width: min(340px, 88vw); max-height: none; overflow: auto;
  padding: 12px; background: var(--page); z-index: 60; transform: translateX(-105%); visibility: hidden;
  transition: transform var(--dur-slow) var(--ease-out), visibility 0s var(--dur-slow) }`;
  `.settings-open .settings-panel { transform: none; visibility: visible; transition: transform var(--dur-slow)
  var(--ease-out) }`; `.drawer-backdrop { position: fixed; inset: 0; z-index: 50; background: rgba(0, 0, 0, 0.6);
  animation: fade-in var(--dur-base) var(--ease-out) }` (both below the modal's 100). Outside the query
  `.settings-toggle { display: none }`.

- [ ] **Step 5: Run** — `npm test` → PASS; `npm run e2e` → PASS (incl. `drawer.spec.ts`; `settings`-driven specs:
  `plan`, `build-cost`, `reuse`, `avoid`, `connections`).

- [ ] **Step 6: Commit** — `git commit -m "feat(client): settings as Minecraft panels, and a drawer on narrow screens"`

---

### Task 5: Item slots, search list, chips, materials and steps

**Files:**
- Modify: `src/client/components/ItemIcon.tsx:61` (delete `borderRadius`)
- Modify: `src/client/views/StepsView.tsx:9,33` (delete `PIN_LINK_STYLE` and its use)
- Modify: `src/client/styles.css` (item icon `:182-190`, search `:228-237`, avoid `:261-272`, materials `:444-472`)
- Modify: `tests/client/item-icon.test.tsx`, the contract test

**Interfaces:**
- Consumes: Task 2 `.badge`/`.chip`, Task 3 dark group.
- Produces: the slot look on every HTML `.item-icon` (Phase 2 grids build on it); the dark `.search-results` well.

- [ ] **Step 1: Write the failing tests**

`item-icon.test.tsx`: the placeholder render (`:15-21` case) `not.toContain('border-radius')`.
Contract: `ruleBody('.item-icon')` contains `box-sizing: content-box`, `padding: 2px`,
`background-color: var(--slot)` and `box-shadow: var(--bevel-slot)`; a rule `svg .item-icon` resets `padding: 0`,
`box-shadow: none`, `background-color: transparent` (Flow's 16 × 16 `foreignObject` icons must not shrink);
`ruleBody('button.pin-link')` contains `padding: 2px 10px` and `font-size: 0.85rem`.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: TSX** — delete `borderRadius: …` (`ItemIcon.tsx:61`; keep width/height, fontSize, placeholder
  background — all asserted); delete `PIN_LINK_STYLE` and `style={PIN_LINK_STYLE}` (the button stays
  `<button type="button" className="pin-link" data-pin={pin} …>`).

- [ ] **Step 4: CSS**

- `.item-icon`: the four declarations of Step 1 plus `position: relative; border-radius: 0;
  font-family: var(--font-ui)` (letters never Pixelify); placeholder keeps its inline background with
  `box-shadow: var(--bevel-slot), inset 0 0 0 3px rgb(0 0 0 / 0.3)`; hover veil `::after { content: ''; position:
  absolute; inset: 2px; background: rgb(255 255 255 / 0.35); opacity: 0; pointer-events: none; transition: opacity
  var(--dur-fast) var(--ease-out) }` shown on `:hover` and on `.search-hit.active`; the `svg .item-icon` opt-out
  (also `::after { content: none }`). The `<img>` inside is untouched (e2e reads its bitmap).
  Retune `.mat-row > .item-icon { margin-top }` for the +4 px.
- `.search-results`: a `--screen` well, `2px solid #a0a0a0`, white text (add to the dark group); `.search-hit`
  radius 0; `.active` / `[aria-selected='true']` gets `box-shadow: 0 0 0 2px var(--accent)` inset.
- `.badge.avoid-badge { color: #ffaa00 }`, `.missing-badge { color: #ff5555 }` (both dark chips).
- Materials: `.materials-section` a panel (panel group); `.materials-section h3` Pixelify 16 px; `.mat-row` 1 px
  `#8b8b8b` separators; `.mat-toggle` reset of the button look to a 20 × 20 caret button (`font-size: 0`, a
  `::before` CSS triangle rotating on `[aria-expanded='true']`); `.mat-have summary, .mat-needed summary` stay inline
  disclosures with a small caret; `.mat-unlock` a chat box (dark group) with amber text; `.step-list li::marker`
  Pixelify; `button.pin-link { padding: 2px 10px; font-size: 0.85rem }` plus the `button.small` look.

- [ ] **Step 5: Run** — `npm test` → PASS; `npm run e2e` → PASS (`assets.spec.ts` reads the icon bitmap,
  `layout.spec.ts` clicks `pin 1`).

- [ ] **Step 6: Commit** — `git commit -m "feat(client): items sit in Minecraft slots; materials and search restyled"`

---

### Task 6: Flow — pipes that move and stay connected

**Files:**
- Create: `src/client/views/pipe-motion.ts`
- Modify: `src/client/views/flow-model.ts:139` (export `PORT_SIZE`)
- Modify: `src/client/views/FlowView.tsx` — imports (`:10-12`), `FlowEdgeShape` (`:237-254`, now exported),
  markers (`:524-535` → exported `FlowDefs`), port (`:163`), `rx` at `:124,:202,:218,:262,:273`, svg class (`:512`),
  drag state (drag logic around `:452-520`)
- Modify: `src/client/styles.css` — flow tokens (`:274-292`) and the flow section (`:308-442`)
- Create: `tests/client/pipe-motion.test.tsx`, `tests/client/flow-pipes.test.tsx`, `tests/e2e/pipes.spec.ts`;
  modify the contract test

**Interfaces:**
- Produces (`pipe-motion.ts`, also used by Task 7):
  - `export const PIPE_ANIMATION_LIMIT = 200;`
  - `export function pipeSeconds(perSecond: number, fluid: boolean): number` — seconds per 16 px dash cycle.
  - `export function pipeAnimationMode(edgeCount: number): 'all' | 'lit'` — `'lit'` when `edgeCount > PIPE_ANIMATION_LIMIT`.
- Produces (`FlowView.tsx`): `export function FlowEdgeShape(props: { edge: PlacedEdge; lit: boolean | null; missing: boolean }): ReactElement | null`
  and `export function FlowDefs(): ReactElement` (the `<defs>`: four markers + the existing `flow-partly` gradient).
- Produces (CSS): `.flow-edge-flow`, `.flow-canvas.dragging`, `.flow-canvas.many-edges`, the `--pipe-dur` property.

- [ ] **Step 1: Write the failing unit tests**

`pipe-motion.test.tsx`:
- `pipeSeconds(1, false)` → `1`; `(10, false)` → `0.75`; `(100, false)` → `0.5`; `(10_000, false)` → `0.35`;
  `(0.001, false)` → `1.6`; `(0, false)` → `1.6`; `(Number.NaN, false)` → `1.6`; `(1000, true)` → `1`;
  `(100_000, true)` → `0.5`.
- `pipeAnimationMode(200)` → `'all'`; `(201)` → `'lit'`.

`flow-pipes.test.tsx` (`renderToStaticMarkup`), with an edge fixture
`{ id: 'e1', from: 'a', to: 'b', key: 't:iron_ingot@0', fromPort: 'a|out|t:iron_ingot@0', toPort: 'b|in|t:iron_ingot@0', perSecond: 1, name: 'Iron Ingot', rate: '1/s', title: 'Iron Ingot · 1/s · A → B', points: [[0, 0], [40, 0]] }`:
- item edge, `lit: null, missing: false`: contains `class="flow-edge item"`, `style="--pipe-dur:1s"`,
  `<path class="flow-edge-flow" d="M 0 0 L 40 0">` and `marker-end="url(#flow-arrow)"`.
- fluid edge (`key: 'fluid:water'`, `perSecond: 1000`): `class="flow-edge fluid"`, `url(#flow-arrow-fluid)`,
  `--pipe-dur:1s`.
- missing edge: class contains `missing`, `url(#flow-arrow-missing)`, and **no** `flow-edge-flow`.
- lit edge: class contains `hl`, `url(#flow-arrow-hl)`.
- `FlowDefs`: four `<marker` elements with ids `flow-arrow`, `flow-arrow-fluid`, `flow-arrow-hl`,
  `flow-arrow-missing`, each with `markerUnits="userSpaceOnUse"`, `markerWidth="8"`, `markerHeight="8"`, `refX="10"`.
- A `FlowNodeShape` rendered the way `flow.test.tsx:470-480` renders one: its out-row port is
  `<rect class="flow-port" x="<width − 2>" y="<rowCentre − 5>" width="4" height="10"`, its in-row port has `x="-2"`;
  the node markup still matches `flow.test.tsx:473` and `:487` (no `hl`/`dim` word in unlit markup).

Contract: `ruleBody('.flow-edge-flow')` contains `stroke-dasharray: 6 10` and
`animation: pipe-flow var(--pipe-dur, 1s) linear infinite`; rules exist for
`.flow-canvas.dragging .flow-edge-flow` and `.flow-canvas.many-edges .flow-edge:not(.hl) .flow-edge-flow` (each
`animation: none` or `animation-play-state: paused`) and for `.flow-edge.dim .flow-edge-flow`
(`animation-play-state: paused`); `ruleBody('.flow-edge-line')` contains `stroke-width: 6` and no `dasharray`.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: Implement `pipe-motion.ts`**

`pipeSeconds`: `u = fluid ? perSecond / 1000 : perSecond`; non-finite or `u <= 0` → `1.6`; else
`s = 1 - 0.25 * Math.log10(u)`, clamped to `[0.35, 1.6]`, rounded to 2 decimals.

- [ ] **Step 4: Implement the Flow pipes**

- Imports: `type CSSProperties` from react; `isFluidKey` with `type StuffKey`; `pipeSeconds, pipeAnimationMode`.
- `FlowEdgeShape`: `fluid = isFluidKey(edge.key)`; classes `flow-edge`, then `fluid`/`item`, then `missing`, then
  `hl`/`dim` (state classes stay on the `<g>` only); marker id `lit === true ? 'flow-arrow-hl' : missing ?
  'flow-arrow-missing' : fluid ? 'flow-arrow-fluid' : 'flow-arrow'`; the `<g>` gets
  `style={{ '--pipe-dur': `${pipeSeconds(edge.perSecond, fluid)}s` } as CSSProperties}` after `data-key`; children in
  order: `<title>`, `path.flow-edge-hit`, `path.flow-edge-line` (with `markerEnd`, so missing edges keep an arrow),
  `path.flow-edge-flow` (only when `!missing`; no title, no text, `pointer-events: none` via CSS), label.
- `FlowDefs`: four markers `viewBox="0 0 10 10" refX={10} refY={5} markerWidth={8} markerHeight={8}
  markerUnits="userSpaceOnUse" orient="auto"`, each holding `<path className="flow-arrow-head[-fluid|-hl|-missing]"
  d="M 0 0 L 10 5 L 0 10 z" />`, then the unchanged gradient. FlowCanvas renders `<FlowDefs />` in place of its
  inline `<defs>`.
- Flange: `<rect className="flow-port" x={(left ? 0 : node.width) - FLANGE_DEPTH / 2} y={y - FLANGE_HEIGHT / 2}
  width={FLANGE_DEPTH} height={FLANGE_HEIGHT} />` with `const FLANGE_DEPTH = 2 * PORT_SIZE` (4) and
  `const FLANGE_HEIGHT = 10`; it stays the row's last child, with no `data-port`. Its outer face lands exactly on
  ELK's port anchor (2 px outside the box), where every pipe starts and ends.
- `rx`: remove at the five places.
- svg `className`: `'flow-canvas'` first, then `focusing` (as today), `dragging` while a drag that passed
  `DRAG_THRESHOLD` is in progress (new `useState`, cleared on pointer up/cancel), and `many-edges` when
  `pipeAnimationMode(layout.edges.length) === 'lit'`.

- [ ] **Step 5: CSS** (scout note `2-flow.md` §4 has the line-by-line list)

- Flow tokens (spec §7 fills; strokes are the "line" values): owned `#b9d6b0`/`#2f6b2f`, new `--panel`/`#000`,
  import `#d8cfa8`/`#6b5a20`, free import dashed, missing `#e3b0b0`/`#aa0000` dashed, out `#f0d870`/`#6b5500`, sink
  `#a8a8a8` dashed, line `#cbbbe0`/`#5a3a8a` dashed; `--flow-edge: #1b1b1b`. Connections reuses these tokens.
- `.flow-canvas`: `background-color: var(--well)` with a 32 px grid of `#404040` 1 px lines (two `linear-gradient`
  layers), `border: 2px solid var(--outline)`, `border-radius: 0`, `box-shadow: var(--bevel-well)` (symmetric:
  `flow-focus.spec.ts` checks the centre), `font-family: var(--font-diagram)`.
- Boxes: `stroke-width: 2`, `filter: drop-shadow(0 2px 0 #000)` on `.flow-node-box` only (drop it if a Chrome trace
  of the largest plan shows long frames); selected/producer `stroke: var(--accent); stroke-width: 3`, consumer dashed
  accent; box text keeps its sizes (diagram font).
- Pipes: `.flow-edge-line { fill: none; stroke: var(--flow-edge); stroke-width: 6; stroke-linejoin: miter;
  stroke-linecap: butt }`; `.flow-edge-flow { fill: none; stroke: var(--item); stroke-width: 2.5;
  stroke-dasharray: 6 10; animation: pipe-flow var(--pipe-dur, 1s) linear infinite; pointer-events: none }`;
  `.flow-edge.fluid .flow-edge-flow { stroke: var(--fluid) }`; `.flow-edge.missing .flow-edge-line { stroke: #aa0000 }`
  (no dash); hover changes the casing colour only (`#2e2e2e`), never its width (replace the old `:355` rule);
  `.flow-edge.hl .flow-edge-hit { stroke: var(--accent); stroke-width: 9 }` (a 1.5 px rim around the casing);
  `.flow-edge.hl .flow-edge-flow { stroke: #ffffff; animation: pipe-flow var(--pipe-dur, 1s) linear infinite,
  pipe-pulse 400ms var(--ease-out) }`; the three pause/stop rules of Step 1; marker heads filled `var(--item)`,
  `var(--fluid)`, `var(--accent)`, `#aa0000`.
- Flanges: `.flow-port { fill: var(--slot); stroke: var(--outline); stroke-width: 1 }`,
  `.flow-row.hl .flow-port { fill: var(--accent) }`.
- Focus fade: `transition: opacity var(--dur-base) var(--ease-out)` on `.flow-node, .flow-row, .flow-edge,
  .flow-group` (the `.dim` rule stays).
- On the dark canvas: `.flow-edge-label { fill: #ffffff; stroke: var(--well) }` (11 px, diagram font); edge tag
  rect `fill: var(--tip-bg); stroke: var(--tip-border)`, text `#ffffff` 11 px/600 (its geometry is pinned at 6.5
  px/char); group frame light dashed, title light; the `+/−` toggle a mini button.
- `.flow-issues`, `.flow-infeasible`: chat boxes (move to the dark group; class strings untouched); legend swatches
  radius 0, 2 px border, new fills; legend items unchanged.
- `.flow-panel`: panel + `animation: slide-in-right var(--dur-slow) var(--ease-out)`; its lists (`.ports`,
  `.oc-lines`, `.warnings`, `.sources`, `.used-by`, `.also-made`) become `--screen` wells in the dark group;
  `.flow { overflow-x: clip }`; never animate `grid-template-columns`.

- [ ] **Step 6: Write `tests/e2e/pipes.spec.ts` (Flow part)**

Open a project with a fixture plan the way `flow-focus.spec.ts:14-20` does (`circuitLv()` from
`./fixtures/plans.ts`). Tests:
- `flow pipes move`: the first `.flow-edge-flow` has computed `animationName` `pipe-flow`; its computed
  `strokeDashoffset` read twice 250 ms apart differs.
- `every flow pipe starts and ends on a flange`: in `page.evaluate`, for every `path.flow-edge-line`, take
  `getPointAtLength(0)` and `getPointAtLength(getTotalLength())`, map each through `getScreenCTM()`, and check that
  some `rect.flow-port`'s `getBoundingClientRect()` contains it (±1 px horizontally, within its height); collect
  failures; expect `[]`.
- `reduced motion stills the pipes`: `emulateMedia({ reducedMotion: 'reduce' })`; computed
  `animationIterationCount` of `.flow-edge-flow` is `'1'`.

- [ ] **Step 7: Run** — `npm test` → PASS; `npm run e2e` → PASS (`flow-focus`, `reuse`, `avoid`, `plan` guard the
  Flow DOM; `pipes.spec.ts` new).

- [ ] **Step 8: Commit** — `git commit -m "feat(flow): moving pipes that end on their ports, Machine GUI boxes"`

---

### Task 7: Connections — pipes, marker, dark-dye casing

**Files:**
- Modify: `src/client/views/ConnectionsView.tsx` — `EdgeShape` (`:161-175`), marker (`:316-320`), `CORNER` (`:55`),
  the `.connections` div (`:302`)
- Modify: `src/client/styles.css` — connections (`:474-559`)
- Modify: `tests/client/connections-view.test.tsx` (add cases), `tests/e2e/pipes.spec.ts` (add a test), contract test

**Interfaces:**
- Consumes: `pipeSeconds`, `pipeAnimationMode` (Task 6); `DYE_HEX` and `DyeColor` from `src/shared/layout/enderio.ts`.
- Produces: `.conn-edge-line`, `.conn-edge-flow`, `--pipe-casing`, `[data-pipes='lit']`.

- [ ] **Step 1: Write the failing tests**

`connections-view.test.tsx` (fixture pictures already used there):
- the Red-channel item-conduit edge renders `<polyline class="conn-edge-line" points="` **without** a `stroke`
  attribute, followed by `<polyline class="conn-edge-flow" points="…" stroke="#b3312c" marker-end="url(#conn-arrow)"`;
  its `<g>` starts `data-edge="flow:step:a&gt;step:b:t:dust@0" class="conn-edge conn-via-item_conduit" style="--pipe-dur:`
  and, since red is a dark dye, the style also holds `--pipe-casing:var(--panel)`.
- in the ae2 picture: still no `stroke="#` anywhere (existing `:94`), and the edges hold `conn-edge-flow`.
- a `hookup` edge (`Hookup to the base` fixture) has no `conn-edge-flow` inside its `<g>` and its casing carries
  `marker-end="url(#conn-arrow)"`; an `attached` edge has neither flow nor marker.
- `<div class="connections" data-testid="connections" aria-busy="false" data-pipes="all"` (class string unchanged,
  new attribute last).
- All existing assertions stay as they are.

Contract: `ruleBody('.conn-edge-flow')` contains `stroke-dasharray: 6 10` and the `pipe-flow` animation;
`.conn-via-hand .conn-edge-flow` has `stroke-dasharray: 8 3 2 3` (sums to 16); `.conn-node > rect` hover rule
changes `stroke` only (no `stroke-width`, no `transform`).
`pipes.spec.ts`: `connections pipes move` — set up the project the way `connections.spec.ts:20-37` does; the first
`.conn-edge-flow` has computed `animationName` `pipe-flow`.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: TSX**

- `EdgeShape`: `moving = edge.perSecond > 0`; `arrow = edge.via === 'attached' ? {} : { markerEnd: 'url(#conn-arrow)' }`;
  `style={pipeVars}` placed **after** `className` on the `<g>`, holding `'--pipe-dur'` (from
  `pipeSeconds(edge.perSecond, edge.key !== null && isFluidKey(edge.key))`) when moving and
  `'--pipe-casing': 'var(--panel)'` when `edge.color` is one of `black, brown, blue, gray, green, purple, red`
  (a module constant `DARK_DYES: ReadonlySet<DyeColor>`); children in order: casing
  `<polyline className="conn-edge-line" points={pts} {...(moving ? {} : arrow)} />` (never a `stroke` attribute),
  then when moving `<polyline className="conn-edge-flow" points={pts} {...(edge.color === null ? {} : { stroke: DYE_HEX[edge.color] })} {...arrow} />`,
  then the label (unchanged).
- Marker: keep id and `markerUnits="userSpaceOnUse"`; `markerWidth={8} markerHeight={8}`; head path unchanged.
- `CORNER = 0`.
- `.connections` div: add `data-pipes={pipeAnimationMode(picture.edges.length)}` after `aria-busy`.

- [ ] **Step 4: CSS** (scout note `3-connections.md` §6.2)

- Re-scope every bare `polyline` rule (old `:529-537`) to the classes; `.conn-edge polyline { fill: none;
  stroke-linejoin: miter }`; `.conn-edge-line { stroke: var(--pipe-casing, #1b1b1b); stroke-width: 6;
  stroke-linecap: butt }`; `.conn-edge-flow { stroke-width: 2.5; stroke-dasharray: 6 10; animation: pipe-flow
  var(--pipe-dur, 0.8s) linear infinite }`; `.conn-edge-flow:not([stroke]) { stroke: var(--conn-link) }`;
  `.conn-arrow-head { fill: context-stroke }` (check one screenshot in Chromium; fallback one marker per colour).
- Per via: `hand` casing transparent, contents `8 3 2 3`; `attached`/`hookup` casing `#8a92a0`, width 2, dashed
  `2 3` / `6 4` as today; the `.conn-via-*` hues unchanged (3D and map tests pin the same hues).
- `.connections`: `border: 2px solid var(--outline)`, radius 0, `--well` + 32 px `#404040` grid on the div's
  background (never an SVG element or a pseudo-element over the svg), inset bevel; `> svg` `font-family:
  var(--font-diagram)`, `transition: opacity var(--dur-base)`; `:focus-visible` outline inside (`outline-offset: -3px`).
- Boxes: `.conn-node > rect, .conn-node > path { stroke: var(--outline); stroke-width: 2; filter: drop-shadow(0 2px
  0 #000) }`; machine `--panel`, chest `#f0d870`/`#6b5500`, interface (new rule) `#cbbbe0`/`#5a3a8a`,
  hookup/sink `#a8a8a8` dashed, source `#d8cfa8`/`#6b5a20`, faces area `#e0e0e0`; hover `stroke: #ffffff` only;
  selected `stroke: var(--accent); stroke-width: 3`; `.conn-face { fill: #1d3b9a }` (5.7:1), lines and modes
  `#4a4a4a`.
- Lit/selected/hover edge: casing outline via a wider hit-colour rule on `.conn-edge-line` (no width change on the
  contents); `.conn-label { fill: #ffffff; stroke: #1b1b1b }` 11 px.
- `svg.dragging .conn-edge-flow` and `.connections[data-pipes='lit'] .conn-edge:not(.selected) .conn-edge-flow`:
  `animation-play-state: paused` / `animation: none`.
- Legend swatch: a mini pipe drawn with CSS on the single empty `span` (casing + `--conn-link` dashes).
- `.conn-panel`: panel + `animation: slide-in-right var(--dur-slow) var(--ease-out)`; `h3` via `.conn-panel-head h3`
  (attribute-less). Never animate the grid or the panel's width (e2e reads the column at once).
- Delete the old `--conn-halo` dark block if still present.

- [ ] **Step 5: Run** — `npm test` → PASS; `npm run e2e` → PASS (`connections.spec.ts` checks pan, hover, panel
  width and `elementFromPoint`).

- [ ] **Step 6: Commit** — `git commit -m "feat(connections): moving pipes in the carrier's colour, Machine GUI boxes"`

---

### Task 8: Map tab chrome

**Files:**
- Modify: `src/client/views/MapTab.tsx` (`:50-54` constants, `:218-242`, `:410-457`, `:481`, `:510`)
- Modify: `src/client/views/MapView.tsx` (`:505-528`)
- Modify: `src/client/map/MapTooltip.tsx` (`:39-42`, `:49`), `src/client/map/LinePanel.tsx`, `src/client/map/FoundPanel.tsx`
- Modify: `src/client/styles.css` (new map section), `tests/client/map-hover.test.tsx`, contract test

**Interfaces:**
- Produces: classes `.map-tab .map-tab-status .map-picker .map-picker-actions .map-picker-line .map-controls
  .map-layers .map-body .map-main .map-side .map-view .map-toolbar .map-zoom .map-y .map-box .map-tooltip
  .line-panel .found-panel .found-section .map-list .map-row-button .pin-dot .line-actions .found-item-label
  .found-item-name .found-show-all` (exact element ↔ class mapping: scout note `1-chrome.md` §4.1).

- [ ] **Step 1: Write the failing tests**

`map-hover.test.tsx`: the rendered tooltip contains `class="map-tooltip"` (keep `:355` `pointer-events:none`).
Contract: none of the five files contains `var(--surface`, `var(--border`, `var(--radius`, `var(--accent`,
`var(--ok`, `var(--warn-`, `var(--error`; `ruleBody('.map-tooltip')` contains `background: var(--tip-bg)` and
`border: 2px solid var(--tip-border)`.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: TSX** — exactly the moves in `1-chrome.md` §4.1: delete `MAP_STYLE`, `PANEL_STYLE`, `FITS_STYLE`,
  `LIST_STYLE`, `PLAIN_LIST_STYLE`, `SUBHEAD_STYLE`, `DOT_STYLE` and every `style={{ margin: 0 }}`; replace them with
  the classes above. Keep inline: `MapTooltip` `{ position: 'absolute', pointerEvents: 'none' }`; the canvas style
  (`MapView.tsx:535`, its cursor is written from code); the pin dot `background: PIN_COLORS[p.kind]`. Untouched:
  the pin `<li>` (`LinePanel.tsx:110`), the note `<li>` (`FoundPanel.tsx:251`), the note badge
  `<span class="badge">N1</span>`, the World-scan label/select adjacency, the `Move line` text as first child, the
  LinePanel-before-FoundPanel order. The fits badge becomes `<span className="badge" data-fits={…}>`.

- [ ] **Step 4: CSS** — scout note `1-chrome.md` §4.2 as the starting sketch, with: `.map-box` frame on the box
  (border/outline), never on the canvas; `.line-panel` and `.found-panel` panels (panel group);
  `.map-tooltip` NEI (`--tip-bg`, 2 px `--tip-border`, `box-shadow: 0 0 0 1px #100010, inset 0 0 0 1px
  var(--tip-inner)`, Pixelify 14 px, `#aaaaaa` lines, first line `#ffffff`, `animation: rise-in 120ms
  var(--ease-out)`); selected list rows a dark row (`--screen`, yellow text) rather than a yellow frame on the panel;
  `button.small` heights for row buttons; `.badge[data-fits='yes'|'tight'|'no'|'unknown']` text `#55ff55`, `#ffaa00`,
  `#ff5555`, `#aaaaaa`; `.map-side` keeps its scroll with `scrollbar-color: var(--btn) var(--well)`.
  Animations in this tab are opacity-only (a transform on an ancestor would trap NoteDialog's fixed backdrop and
  shift the e2e canvas reads).

- [ ] **Step 5: Run** — `npm test` → PASS; `npm run e2e` → PASS (`world.spec.ts`, `layout.spec.ts`).

- [ ] **Step 6: Commit** — `git commit -m "feat(map): Machine GUI panels and an NEI tooltip around the map"`

---

### Task 9: 3D tab, World page, projector panel — and retire the old token names

**Files:**
- Modify: `src/client/views/View3D.tsx` (`:77-93` constants, `:133-270`, `:467`)
- Modify: `src/client/views/WorldPage.tsx`, `src/client/views/SmartUploadPanel.tsx`, `src/client/views/ProjectorPanel.tsx`
- Modify: `src/client/styles.css` (new sections; delete the old-name aliases from `:root`; replace remaining
  `var(--muted|--error|--ok|--surface…)` uses with the ink/token names)
- Modify: contract test

**Interfaces:**
- Consumes: Task 2 `progress`, range, checkbox, `details.disclosure > summary`, file input; Task 1 surfaces.
- Produces: classes `.view3d .view3d-body .view3d-main .view3d-viewport .view3d-hover .view3d-controls
  .view3d-layer-text .view3d-legend .view3d-box .view3d-details .view3d-warnings .view3d-size .view3d-side
  .world-page .world-section .scan-row .scan-row-head .scan-notes .scan-list .backup-list .upload-status .disclosure
  .disclosure-body .world-pickers .smart-upload .smart-areas .smart-radius .smart-total .projector-panel
  .projector-body .command-row .command-text .projector-commands .projector-form` (element ↔ class mapping: scout
  note `4-chrome.md` §4).

- [ ] **Step 1: Write the failing contract tests**

- No file under `src/client` (`.tsx`, `.ts`, `.css`) contains `var(--surface`, `var(--surface-2`, `var(--border`,
  `var(--radius`, `var(--bg)`, `var(--muted)`, `var(--error-bg`, `var(--warn-bg`, `var(--warn-border`,
  `var(--accent-text`; `rootTokens()` has none of those names.
- Every `border-radius` in `styles.css` is `0` except inside `.pin-dot`.
- `ruleBody('.view3d-hover')` contains `background: var(--tip-bg)` and `pointer-events: none`.

- [ ] **Step 2: Run them to see them fail.**

- [ ] **Step 3: TSX** — exactly the moves in `4-chrome.md` §4. Keep verbatim: `HINT_STYLE` `{ marginTop: 4 }`
  (`projector-panel.test.tsx:65`); the legend swatch's `background: rgb(…)` inline (`view3d.test.tsx:318`); the
  canvas `cursor` inline. Never: a class name containing `view3d-canvas` outside the WebGL branch; any class or title
  containing `Focus` or `view3d-links-legend` while links are off; a class on the `muted small` links note, the
  Layer range, the toggle labels, the scan-row `<strong>`, the projector `summary`, `h4`, `p[role=alert]`, `code`,
  `div.command-line`; a wrapper or reorder around the file inputs; `user-select: none` or `text-transform` on
  `.command-text`/`code`. `window.confirm` in `ProjectorPanel` stays (Phase 2).

- [ ] **Step 4: CSS**

- `.view3d-viewport`: `position: relative; overflow: hidden; height: min(64vh, 680px); min-height: 360px`, frame as
  a 2 px inverted-bevel **border**, light "sky" backdrop `linear-gradient(#cfe3f2, #a9c4d9)` (the scene's dark cables
  vanish on a dark well; the WebGL clear is transparent); `> canvas { display: block; width: 100%; height: 100% }`
  with no border or padding.
- `.view3d-hover`: NEI tooltip, `pointer-events: none`, `rise-in` on mount. `.view3d-controls > .check:has(> input[type=checkbox])`
  as toggle buttons (yellow text when `:has(> input:checked)`); `.view3d-layer-text` a `--screen` readout.
  `.view3d-box` panels (panel group), `.view3d-details` `slide-in-right`; ancestors animate opacity/transform only
  (a size change triggers the renderer's resize).
- World: `.world-page > h1` Pixelify `#ffd84a` with a 2 px dark shadow, footer `var(--ink-muted)`; `.world-section`
  panels; `.scan-row-head > strong` a `--screen` chip coloured by `[data-state]`; `.disclosure` uses the Task 2
  summary; progress bars from Task 2 (red fill for `[data-state='failed']`).
- Projector: `.projector-panel` inherits the `details.settings-section` look (delete `PANEL_STYLE`, keep 14 px gap
  above); `.command-text` a `--screen` well with `--screen-text` monospace (`ui-monospace, Menlo, Consolas,
  monospace`), `user-select: all`.
- Delete the old-name aliases from `:root` and replace their remaining uses in `styles.css` with `--ink-muted`,
  `--ink-error`, `--ink-ok`, `--panel`, `--well` etc.; set the remaining literal radii to 0.

- [ ] **Step 5: Run** — `npm test` → PASS; `npm run e2e` → PASS (`view3d-links`, `layout`, `world`, `projector`).

- [ ] **Step 6: Commit** — `git commit -m "feat(client): Machine GUI 3D, World and projector panels; retire old tokens"`

---

### Task 10: Whole-app verification

**Files:** none in the repo (screenshots go to the scratchpad).

- [ ] **Step 1:** `npm test` → PASS; `npm run e2e` → PASS. Paste the summary lines.
- [ ] **Step 2:** Re-run the screenshot tour (`…/scratchpad/shots/shoot.mjs`, `shoot2.mjs`, `shoot3.mjs`, writing
  to a new `shots-after/` folder) at 1440 × 900 and 800 × 900; compare every screen with its before shot and with
  mockup B; list anything that still looks like the old app.
- [ ] **Step 3:** Motion pass in headed Chromium: tab switch, Flow side panel open, modal, live dot, pipes on Flow and
  Connections, hover focus fade; again with `reducedMotion: 'reduce'` — nothing moves.
- [ ] **Step 4:** Performance: open the largest available plan's Flow, record a Chrome performance trace while
  panning for 5 s; no frame over 50 ms caused by style/paint of the pipes. If there are, drop the box drop-shadow
  filter first, then lower `PIPE_ANIMATION_LIMIT`.
- [ ] **Step 5:** Report results to the user with the after-screenshots; hand off to
  superpowers:finishing-a-development-branch.

---

## As built

The rulings made while this plan was executed (pre-flight, task reviews and the final whole-branch review; all kept
in the SDD ledger, which is not committed) changed or read the steps above. Where a ruling supersedes a step, the code
and the spec follow the ruling; the task text is left as it was planned. `file:line` anchors in the tasks are at
`b762b6f`. One line per ruling, in order:

- **R1** — Task 3 put the tab panel's `fade-in` in Task 1's `.tab-panel` rule: one rule per selector, as the contract
  reads the first rule for a selector.
- **R2** — Task 1's contrast cases pass at their RED step; they stay as guards on the spec's colour values.
- **R3** — The selected slot's 0.9 → 1 scale-in is deferred to Phase 2 (a box-shadow frame does not scale cheaply);
  the yellow frame shows at once.
- **R4** — `.flow-issues` gets the banners' `rise-in` entrance, as spec §7a lists the Flow issues with the banners.
- **R5** — Task 10 (verification, no code) ran as a verification lens whose evidence was checked, not diff-reviewed.
- **R6** — The skill's helper scripts were refused by the isolated session's git guard; briefs and review packages
  were made with equivalent plain commands.
- **R7** — Models: sonnet implementers for Tasks 1–5, 8 and 9, opus for 6 and 7; sonnet task reviews, opus final review.
- **R8** — Task 9 also deleted the surface groups' dead `--muted` declarations once nothing read `var(--muted)`.
- **R9** — The 14 px base is on `body`, not `:root` (which would shrink every rem by 12.5 %); the root stays 16 px.
- **R10** — `h1`/`h2` stay 1.6rem/1.2rem as page headings; panel titles are an explicit 16 px Pixelify.
- **R11** — A summary's text stays white on the button face (5.3:1), not `--ink-title` (1.9:1 there).
- **R12** — Borderless focusables (`a`, `button.link`) take their ring colour from a per-surface `--ink-focus`
  (`#ffff55` on the stone and dark boxes, `#1b1b1b` on panels): yellow on a panel is 1.6:1.
- **R13** — `--ink-focus` also rings summaries, checkboxes and radios, which have no reliably dark edge either.
- **R14** — The contract's "no global summary rule" guard skipped `:focus-visible` rules so R13's ring rule passed
  (replaced by R40).
- **R15** — Escape closes one layer of the drawer per press: an open search list first, and a key something inside
  already handled (`defaultPrevented`) not at all.
- **R16** — The settings `<details>` fold animating `block-size` is an allowed exception to "transform and opacity
  only" (spec §7a asks for an animated height); it is instant where unsupported.
- **R17** — `.flow` clips both axes with `overflow-clip-margin: 4px`: an x-only clip cut the Zoom in button's focus
  ring, and Chromium honours the margin only when both axes clip.
- **R18** — Flow issue rows are `#990000`/`#6a4000` and a left over's text `#303030`, to keep box text at 4.5:1.
- **R19** — A newly lit pipe's pulse is a one-time opacity blink of its accent rim (`pipe-pulse`, 1 → 0.15 → 1,
  400 ms): a brightness pulse cannot show on the white lit contents.
- **R20** — The missing-source arrow head was `#ff5555`, lighter than its `#aa0000` casing (replaced by R34).
- **R21** — `dragging` is reset on every pointer press, release and cancel, so a second pointer cannot leave the
  pipes stopped; the pipes spec's comment states the flange acceptance it checks.
- **R22** — Connections rim: a `polyline.conn-edge-rim` under the casing (none at rest, white on hover, accent with
  one blink when picked), as recolouring the casing would hide yellow or white contents.
- **R23** — Connections hookup and left-over text is `#303030` (`#4a4a4a` is 3.7:1 on their grey); `.conn-view`
  clips both axes as R17.
- **R24** — Pixelify draws lowercase fi/fl/ff ligatures as a wrong glyph ("Does not At"): ligatures off, once
  (first on `:root`; the mechanism is R24a).
- **R24a** — The `font` shorthand resets `font-feature-settings`, so the rule is
  `* { font-feature-settings: "liga" 0, "clig" 0 !important }`.
- **R25** — Map pin and note rows are flat Inter rows with a dark picked row, not button faces (a note's muted
  coordinates would be 1.7:1 on a button's grey).
- **R26** — The NEI tooltip's mod-name line does not apply: MapTooltip's lines carry no mod.
- **R27** — Tooltips fade in and rise 2 px (`tip-in`) instead of `rise-in`, which drops 4 px from above.
- **R28** — The ligature rule is two rules, `*` and `::file-selector-button`: the build's minifier dropped the
  pseudo-element half of the combined list.
- **R29** — The 3D canvas has its own class, `.view3d-scene`: the Map's guard forbids a rule on the `canvas` element.
- **R30** — Sliders join the `--ink-focus` ring selector (a yellow ring on a light panel is 1.6:1).
- **R31** — WCAG 2.2.2: a "Pause pipes" / "Play pipes" button (`aria-pressed`) after Fit in the Flow and Connections
  toolbars, one setting per browser (`gtnh-planner:pipes-paused`), applied as `pipes-paused` on the Flow svg and
  `data-pipes="paused"` on `.connections`; the live dot breathes twice and the reconnect dot blinks three times, so
  both stop within 5 s. R44 dropped `aria-pressed`; the label changes (Phase 2 Task 11).
- **R32** — `.conn-arrow-head` falls back to `var(--item)` before `context-stroke`, which WebKit lacks (it drew black
  heads); as a base rule plus an `@supports (fill: context-stroke)` rule, as the minifier keeps only the last `fill`
  of one rule.
- **R33** — File inputs join the `--ink-focus` ring selector.
- **R34** — The missing-source pipe casing is `#ff5555` (3.79:1 on the well; `#aa0000` was 1.54:1 with nothing moving
  in it) and its arrow head `#ffffff`.
- **R35** — Sentence-length text is never Pixelify: the plan banner's error is Inter; headings stay pixel.
- **R36** — The narrow-screen drawer is a layer of its own: the focus moves to its "Close settings" button on open,
  the page behind is `inert` (head, banners, views and top bar), every way out closes it through one function that
  gives the focus back to the Settings button, it closes when the window grows past 900 px, and it slides out with
  `--dur-exit`/`--ease-in`.
- **R37** — A settings or disclosure summary whose title wraps grows (min-height 36 px, line-height 1.25, 4 px above
  and below) instead of spilling over its face.
- **R38** — `.projector-panel { margin-top: 14px }` is gone: it stacked on the column's 12 px gap (26 px).
- **R39** — Docs as built: the README (placeholders sit in slots, new boxes are grey), the spec amended where a
  ruling changed the design (status approved, Phase 1 built), and this section.
- **R40** — Tests: the summary guard cuts selector lists at top-level commas only (R14's exemption is gone); the
  pipe-motion e2e polls one attached element for a changed dash offset instead of sleeping 250 ms.

Also from the final review (I1, no ruling number): forced colours. A Windows contrast theme drops backgrounds and
shadows, which hid the custom ticks, radios, carets, slider tracks and progress fills; one
`@media (forced-colors: active)` block at the end of the stylesheet redraws them in system colours (spec §6).
