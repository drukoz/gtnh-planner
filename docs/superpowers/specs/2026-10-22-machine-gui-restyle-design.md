# Machine GUI restyle — design

Date: 2026-10-22. Status: approved; Phase 1 built (branch feat/machine-gui-restyle-p1). Where a ruling of the
build changed the design, the text below says what was built and names the ruling; the plan's "As built" section
(`docs/superpowers/plans/2026-10-23-machine-gui-restyle-phase1.md`) lists every ruling, R1–R40.

## 1. Intent

The user asked for the web client to be "more like minecraft", "a bit more visual and interactive like
https://gtnhplanner.com/ but not exactly like this", and "more like industrial and proffesional". Shown three
directions as mockups, they picked **B · Machine GUI** ("do B") and added: "make sure the lines are moving and
connected" and "make sure even tho it is machine UI it is also animated and mordern UX".

Reference mockup (the look to match, not a pixel spec): the "B · Machine GUI" artboard on the design canvas
https://claude.ai/artifact/Vc3ePZTxQJeqqzBFhRF5us (source:
`<the design session's scratchpad, not in the repo>/restyle-canvas/project/MachineGui.dc.html`).
Screenshots of today's app, one per screen and tab:
`<the design session's scratchpad, not in the repo>/shots/*.png`
(scripts `shoot.mjs`, `shoot2.mjs`, `shoot3.mjs` beside them re-take the whole tour against the e2e server).

**B in one sentence:** the planner looks like a refined GregTech machine interface — light-grey bevelled Minecraft
container panels on a dark stone background, items in slots with stack counts, NEI-style purple tooltips, green
"machine screen" readouts, a pixel font for headings and controls only — and its diagrams are pipes with goods
visibly flowing through them.

**But it behaves like a modern app:** the look is retro, the interaction is not. Everything responds immediately
and smoothly — pressed buttons sink, panels slide, tabs and tooltips fade, numbers count to their new values,
diagrams glide to a new layout instead of jumping, loading shows skeletons, and the keyboard reaches everything.
Think "a GregTech machine GUI designed by a modern product team", not "a 2013 game menu".

## 2. Goals, non-goals, anti-goals

Goals
- Every page and tab wears the B look: chrome, panels, controls, tabs, banners, modals, tooltips, icons in slots.
- **Diagram lines move and stay connected** (Flow and Connections): each edge is a pipe whose contents animate from
  producer to consumer; every pipe visibly ends on its port/face with no gap or overshoot, at every zoom level.
- The densest text becomes visual where the data already exists (key numbers as readouts, recipes as slots, build
  list as an inventory grid, machine icons and tier chips in Flow boxes).
- **Animated and modern UX** (§7a): consistent motion system, micro-interactions on every control, smooth
  transitions between states, animated readouts, diagrams that glide between layouts, skeleton loading, in-app
  confirmations and undo toasts instead of browser dialogs, keyboard shortcuts.
- Stays a serious tool: readable body text, WCAG AA contrast, keyboard focus visible, reduced-motion honoured.

Non-goals
- No change to planning logic, server, API, data, or the projector/exporter mods.
- No change to how the map terrain canvas or the 3D WebGL view draw their scene (tests assert their pixels); only the
  chrome around them is restyled.
- No new pages or features beyond those listed in §8 Phase 2.

Anti-goals (would be a failure even if it "works")
- A clone of gtnhplanner.com's look.
- Toy-like: pixel font in paragraphs, novelty everywhere, colour without meaning.
- Dated or static: state changes that snap with no transition, stepped/choppy animation outside deliberate pixel
  details, blocking browser `alert`/`confirm` dialogs, "Loading…" text as the only loading state.
- Animation as decoration that delays the user: no transition longer than 300 ms on anything the user is waiting
  for, nothing that animates layout properties (width/height/top/left) where transform/opacity would do.
- Lines that wiggle but detach from boxes, or animation that makes large plans sluggish.
- Breaking the e2e suite or weakening its assertions to make it pass.

## 3. Constraints

- React 19 + Vite; one global stylesheet `src/client/styles.css` with tokens on `:root`; 141 inline `style={{}}`
  uses across 14 files (largest: `WorldPage.tsx`, `View3D.tsx`, `map/LinePanel.tsx`, `map/FoundPanel.tsx`,
  `MapTab.tsx`). Hard-coded colours that ignore tokens: `.item-icon` text/shadow, modal backdrop, `.conn-via-*`,
  `MapTooltip`, `LinePanel` `FITS_STYLE`/`PIN_COLORS` usage, 3D legend swatches.
- `vite.config.ts`: `publicDir: false`; game assets must never be copied into `dist/`. Fonts are not game assets and
  may be bundled.
- Friends reach the planner over plain LAN HTTP, so no CDN fonts: bundle them.
- Flow and Connections box sizes are computed from text metrics in TS: `src/client/views/flow-model.ts:115-137`
  (7.4 px/char titles at 13 px semibold, 6.2 px/char rows at 11.5 px, row 18, title 28, line 16) and
  `src/client/connections/model.ts:70-73` plus truncation at 32/38/42 chars in `ConnectionsView.tsx:51-67`.
  Any font change inside those SVGs must keep text inside its box (retune the constants if needed).
- **Tests.** `npm test` (tsc + vitest) and `npm run e2e` (Playwright) must pass at the end of every phase.
  - Keep every class, data attribute, test id, role, label, placeholder and visible string the e2e specs use
    (list: `tests/e2e/*.spec.ts`; summary: `.plan-cost`, `.conn-machine rect`, `g.conn-pan` transform format,
    `.note-text`, `.connection.live`, `.project-card`, `svg.flow-canvas(.focusing)`,
    `[data-node-id] > rect.flow-node-box` as a direct child, `.flow-edge.hl`, `.dim`, `.producer`, `.consumer`,
    `.plan-banner`, `.flow-issues`, `a.project-link[href]`, `li.mat-row` + `[data-row]`, `.command-line`,
    `.owned/.partly-owned/.new` on `[data-step-id]`, all `data-*` and test ids, tab names, button texts).
  - Pixel assertions that must stay true: map canvas centre alpha > 0; 3D lit-pixel counts (transparent WebGL
    clear, hookup grey 138,146,160, picked-link white); the icon `<img>` centre pixel equals the fixture colour;
    `elementFromPoint` on empty Connections area hits the SVG (no overlay may cover it); LinePanel before FoundPanel
    in the DOM.
  - Unit tests that match rendered markup as strings (flow, connections, settings, step-panel, materials,
    plan-banner, projector-panel, layout-map, view3d, world-page, item-icon …) may be updated **only** where this
    design deliberately changes that markup; never delete an assertion to get green.
- Accessibility: AA contrast for all text (pairs in §4); focus ring on every control; `prefers-reduced-motion:
  reduce` stops all non-essential animation; motion that never ends has a control that stops it (WCAG 2.2.2, §7); in
  forced colours (a Windows contrast theme) every custom control stays visible (§6).

## 4. Design tokens

Single theme. B is inherently one look (Minecraft GUIs are always light-grey panels), so the three
`@media (prefers-color-scheme: dark)` blocks go away and `<meta name="color-scheme">` becomes `dark` (page) — the
panels stay light. *(Designer's call; see §10.)*

| Token | Value | Use |
|---|---|---|
| `--page` | `#2b2b2b` + checker `#262626` (16 px, CSS gradients) | page background ("stone") |
| `--bar` | `#1a1a1a` | top bar |
| `--panel` | `#c6c6c6` | containers |
| `--panel-hi` / `--panel-lo` | `#ffffff` / `#555555` | panel bevel (3 px inset) |
| `--outline` | `#000000` | 2 px outline on panels, buttons, nodes |
| `--slot` | `#8b8b8b` | item slot fill |
| `--slot-hi` / `--slot-lo` | `#ffffff` / `#373737` | slot bevel (2 px, inverted) |
| `--well` | `#373737` | diagram canvases, inset wells |
| `--screen` | `#1b1b1b` | readouts, tier chips, text fields |
| `--text` | `#303030` | text on panels (7.7:1 on `--panel`) |
| `--text-muted` | `#4a4a4a` | secondary text on panels (5.2:1) |
| `--title` | `#404040` | panel titles (Minecraft container-title grey) |
| `--btn` | `#6b6b6b` | button face (white text 5.3:1) |
| `--btn-hi` / `--btn-lo` | `#a0a0a0` / `#3c3c3c` | button bevel (2 px) |
| `--btn-hover` | `#4a5499` | Minecraft hover blue, darkened so white text keeps 6.96:1 |
| `--danger-face` | `#aa0000` (hover `#c62828`) | danger buttons: white text 7.75:1 |
| `--link` | `#1a3fa0` | links and link-buttons on panels (5.4:1); on dark surfaces links use `--accent` |
| `--accent` | `#ffff55` | selected/active (yellow, Minecraft `§e`) |
| `--screen-text` | `#55ff55` | readout numbers (12.9:1 on `--screen`) |
| `--screen-muted` | `#aaaaaa` | readout labels (7.4:1) |
| `--ink-ok`, `--ink-error`, `--ink-warn` | `#55ff55`, `#ff5555`, `#ffaa00` on dark; `#1e5a1e`, `#aa0000`, `#6a4000` on panel | set per surface (the ink table below), not as one `:root` token each |
| `--chat` | `rgba(0,0,0,0.82)` | notice/alarm boxes (chat-message look) |
| `--tip-bg` / `--tip-border` / `--tip-inner` | `rgba(16,0,16,0.94)` / `#5000ff` / `#28007f` | NEI tooltip |
| `--fluid` | `#55ffff` | fluid pipe contents |
| `--item` | `#ffff55` | item pipe contents |
| `--focus` | 3 px outline, offset 0 | all focusables. Buttons and tabs keep `#ffff55`, which their black border backs; a field's yellow ring joins its yellow focus border on the black field. Links, `button.link`, summaries, checkboxes, radios, sliders and file inputs have no dark edge for it to touch, and yellow on panel grey is 1.6:1, so their ring takes the surface's `--ink-focus` (R12, R13, R30, R33) |

**Ink per surface.** Text colour depends on what it sits on, so each surface sets its own ink custom properties
(`--ink`, `--ink-muted`, `--ink-title`, `--ink-link`, `--ink-error`, `--ink-ok`, `--ink-warn`, and `--ink-focus` for the
focus ring of the borderless focusables above) and the generic classes (`.muted`, `.error`, `a`, `button.link`,
headings, `.tick-by`) read them:

| Surface | ink / muted / title / link / error / ok / warn / focus |
|---|---|
| page (stone; `:root`) | `#dddddd` / `#aaaaaa` / `#ffffff` / `#ffff55` / `#ff5555` / `#55ff55` / `#ffaa00` / `#ffff55` |
| panel (`--panel`) | `#303030` / `#4a4a4a` / `#404040` / `#1a3fa0` / `#aa0000` / `#1e5a1e` / `#6a4000` / `#1b1b1b` |
| dark (chat, screen, well) | `#ffffff` / `#aaaaaa` / `#ffff55` / `#ffff55` / `#ff5555` / `#55ff55` / `#ffaa00` / `#ffff55` |

`section.tab-panel` (today unstyled) becomes a panel surface, so every tab's content sits on `--panel`.
Unselected tabs use `#1b1b1b` text on `#8b8b8b` (5.06:1).

Radii: 0 everywhere but the map's `.pin-dot`, which mirrors the canvas's round marker. Spacing: 4 px base
(4/8/12/16/24). Shadows: only bevels (inset box-shadows) and a 2 px hard drop `0 2px 0 #000` under raised items; no
blur shadows except tooltips.

Voltage tier colours (chips are text on `--screen`; GT's chat colours, lightened where the original fails AA on
dark): ULV `#9a9a9a`, LV `#dddddd`, MV `#55ffff`, HV `#ffaa00`, EV `#ff55ff`, IV `#8c9cff`, LuV `#ff8cff`, ZPM
`#ff5555`, UV `#55dddd`, UHV `#ff6b6b`, UEV `#55ff55`, UIV `#00cc00`, UMV `#ffff55`, UXV `#8080ff`, MAX `#ff5555`
bold. One source of truth used by CSS (custom properties) and TS (the Flow SVG). The map's own
`VOLTAGE_COLORS` (`map/overlays.ts`) stays as is (its tests assert it).

## 5. Typography

- **Pixelify Sans** (SIL OFL 1.1) — headings, tabs, buttons, readout numbers, tier chips, stack counts, tooltips.
  Never below 13 px, never for paragraphs.
- **Inter** (SIL OFL 1.1) — everything else, 14 px base, line-height 1.45; tabular numbers for amounts and rates. The
  14 px is set on `body`; the root keeps the browser's 16 px, so a `rem` means what it did (R9).
- Bundled through Vite, not a CDN: add `@fontsource/pixelify-sans` and `@fontsource/inter` (pinned exact versions,
  like the other dependencies) and import the needed weights (Pixelify 400/600/700, Inter 400/500/600/700) in
  `main.tsx`. Browsers fetch the `.woff2` files, which the static server types as `font/woff2`. fontsource also
  emits `.woff` fallbacks: a browser asks for one only when its `.woff2` fails, and the server sends it as
  `application/octet-stream`.
- Pixelify Sans draws a lowercase "fi", "fl" or "ff" as a ligature that reads as an A ("Does not fit" read "Does not
  At"), so `liga` and `clig` are off for every element: `* { font-feature-settings: "liga" 0, "clig" 0 !important }`,
  !important because the `font` shorthand resets the feature settings on its own element, and the same declaration in a
  rule of its own for `::file-selector-button` (`*` matches no pseudo-element, and the build's minifier dropped that
  half of a one-rule list) (R24a, R28).
- Inside the Flow/Connections SVGs, text keeps **today's system font stack**
  (`system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`), pinned on `.flow-canvas` and `.connections > svg`:
  the box widths, truncation lengths and label boxes in `flow-model.ts`/`connections/model.ts` are measured for it
  and pinned by tests, so changing that font is out of Phase 1.
- Pixelify is never below 13 px, so `.badge` grows from 12 px to 13 px; sub-13 px labels (`h4` micro headings) stay
  Inter. Every Pixelify stack falls back to Inter for glyphs it lacks (`−`, `≤`, `→`, `▸`).

## 6. Components

- **Top bar:** `--bar` strip, 2 px black bottom + `#3c3c3c` inner line; brand = 32 px pixel mark (CSS/SVG, no image)
  + "GTNH Line Planner" in Pixelify 20 px `#ffd84a` with a 2 px dark shadow; nav links as Minecraft buttons, the
  current one with yellow text.
- **Panel** (`.card`, settings column, flow side panel, modals, Found/Line panels): `--panel`, 2 px outline, 3 px bevel.
  Titles Pixelify 16 px `--title`.
- **Buttons:** `--btn`, 2 px outline, 2 px bevel, white Pixelify text with 2 px `#3f3f3f` shadow, min height 36 px
  (32 px for toolbar icon buttons; `button.small` 28 px, Pixelify 13 px), hover `--btn-hover`, pressed = bevel
  inverted, disabled = `#4a4a4a` face and `#a0a0a0` text. `.primary` = yellow text; `.danger` = `--danger-face`
  with white text; `.link` stays a text link in `--ink-link`.
- **Text fields / selects / number inputs:** black field, 2 px `#a0a0a0` border, white text, yellow focus border.
- **Checkbox / radio:** custom (appearance none): 16 px `--screen` well with inset bevel; checked = pixel tick
  `#55ff55` / pixel dot; keep native inputs for semantics and tests.
- **Range:** dark track well (`--screen` with the inset well bevel), thumb = small Minecraft button.
- **`<progress>`:** dark well with a 2 px black border, fill `#55ff55`, or `#e03c3c` for a failed scan (the energy bar
  is Phase 2).
- **`<details>`** of a settings section or a disclosure: summary styled as a full-width Minecraft button with a pixel
  caret; open = caret down. Its height is a minimum: a title that wraps in a narrow column grows the button instead of
  spilling over its bevel (line-height 1.25, 4 px above and below; R37). The inline disclosures of Materials keep a
  text summary with a small caret.
- **Forced colours** (a Windows contrast theme paints every background in its Canvas colour and drops shadows, final
  review I1): one `@media (forced-colors: active)` block at the end of the stylesheet redraws in system colours what
  was drawn with those alone — ticks and radios get a `ButtonText` edge and a `Highlight` mark, carets
  `ButtonText`/`CanvasText`, slider tracks a `ButtonText` edge, progress fills `Highlight`; selects and search
  fields get the browser's own arrow and cross back; the selected tab is underlined and the active search hit and the
  picked map row outlined. Nothing opts out of the user's palette (`forced-color-adjust` is never used).
- **Tabs:** creative-inventory tabs — unselected `#8b8b8b` with dark text, selected joins the panel below
  (`--panel`, no bottom border); Pixelify 15 px.
- **Item slot:** any listed item icon sits in a slot (`--slot`, 2 px inverted bevel, 2 px padding); stack count
  bottom-right in white Pixelify with dark shadow (Phase 2, with the inventory grid); hover = white 35% veil (Minecraft
  hover). The icon `<img>` itself is untouched (`image-rendering: pixelated`; e2e reads its centre pixel). Placeholder
  squares keep their letters and `background: rgb()` (unit tests) but get the slot frame. The Flow diagram's 16 px
  icons sit in 16 px foreignObjects with no room for a frame: there they stay bare (a placeholder keeps a thin edge).
- **Tooltips** (Phase 1: MapTooltip, the Flow edge tag and the 3D hover label — the custom tooltips that exist
  today; slot tooltips arrive with the shared component in Phase 2): NEI style — `--tip-bg`, 2 px
  `--tip-border` with 1 px `--tip-inner` inside, white first line, `#aaaaaa` detail lines, mod name `#5555ff`
  italic where known (no Phase 1 tooltip knows one: R26); Pixelify 14 px; the two HTML ones fade in and rise 2 px
  (§7a, R27). The Flow edge tag is SVG: rect fill/stroke per tokens.
  Native browser tooltips (about 35 `title` attributes and SVG `<title>` elements in 11 files — every ItemIcon,
  Flow box and arrow, Connections box) stay native in Phase 1. Phase 2 replaces the ones on ItemIcon, Flow boxes and
  arrows and Connections boxes with one shared NEI tooltip component (hover delay 150 ms, also on keyboard focus,
  tap-to-show on touch, `role="tooltip"` + `aria-describedby`), keeps an accessible name on each element (aria-label
  or visually hidden text, so screen readers lose nothing), gives ItemIcon a prop to drop its own tooltip where a
  parent shows one (no double tooltips), and updates the unit tests that assert `title="…"`/`<title>` on purpose.
- **Banners:** `.banner.notice` and info = chat box (`--chat`, yellow text); `.banner.error` = chat box with
  `#ff5555` text; `.plan-banner` = chat box listing problems (red) and hints (yellow) — hints and problems no
  longer share one style. The headings of the problems are Pixelify; the planner's error is a sentence, so it is
  Inter (R35).
- **Badges / chips:** `.badge`, `.chip`, tier chips = `--screen` rectangle with coloured Pixelify text; avoid
  badge = amber text on `--screen`.
- **Readout tile:** `--screen` well, label `--screen-muted` 11 px, value Pixelify 24 px `--screen-text`.
- **Modal:** centred panel over `rgba(0,0,0,0.6)`; title Pixelify.
- **Empty and loading states:** Phase 1 restyles the existing status lines (ink per surface); the pixel progress
  bar and skeletons arrive in Phase 2 (§7a).
- **Scrollbars** (where styled): dark track, `--btn` thumb.
- **Page background:** `--page` checker on `body`; panels float on it with 16 px gutters.

## 7a. Motion and modern interaction system

Motion tokens (CSS custom properties, also exported to TS where SVG/JS needs them):

| Token | Value | Use |
|---|---|---|
| `--dur-fast` | 90 ms | press, hover, checkbox tick |
| `--dur-base` | 160 ms | tabs, tooltips, focus dim, small reveals |
| `--dur-slow` | 260 ms | side panels, modals, drawers, diagram re-layout (max 300 ms) |
| `--dur-exit` | 180 ms | exits (in Phase 1 the settings drawer's slide-out, R36) |
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | default |
| `--ease-pop` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | small "pop" (tick, badge, toast in) |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | exits |

Rules: animate only `transform` and `opacity` for UI (plus `stroke-dashoffset` for pipes, `background-color` for
hover, and the settings sections' height, below: R16); exits are faster than entrances; under
`prefers-reduced-motion: reduce` every `--dur-*` token is 0 ms and every animation and transition runs once, for 1 ms,
so nothing moves (fades included). Nothing but the pipes animates for ever, and a button stops those (§7, R31).

Micro-interactions (Phase 1, [CSS] unless noted)
- Buttons: hover colour 90 ms; `:active` inverts the bevel and moves the face 1 px down (`translateY(1px)`), so a
  press feels physical; disabled has no hover.
- Slots: hover veil fades in 90 ms; selected slot gets a yellow 2 px frame (inset) that scales from 0.9 to 1 with
  `--ease-pop` (the scale-in is Phase 2: R3).
- Checkbox/radio: tick/dot pops in (`scale(0.6)` → 1, `--ease-pop`).
- Tabs: the selected tab rises 2 px into the panel; the tab panel content fades in 160 ms on switch. (Built: every
  tab sits 2 px down over the panel's edge and the selected one joins the panel; the rise is Phase 2.)
- Tooltips: appear after the existing 150 ms rest, fade + 2 px rise 120 ms (`tip-in`, R27), disappear 80 ms (the
  exit needs an element kept mounted: Phase 2).
- Focus dim in Flow/Connections: `.dim` opacity transitions 160 ms instead of snapping; a newly lit edge's rim blinks
  once (opacity 1 → 0.15 → 1, 400 ms: R19, as a brightness pulse cannot show on the lit edge's white contents).
- `<details>` sections of the settings: content height animates open/closed (`block-size` on `::details-content`
  with `interpolate-size: allow-keywords` where supported, instant elsewhere; an allowed exception to "transform and
  opacity only": R16); caret rotates. The Materials disclosures open at once (their height animation is Phase 2).
- Live indicator: the green dot breathes twice (opacity 0.6 ↔ 1, 2 s each) when the page connects; amber, it blinks
  three times (1.6 s each) while reconnecting. Both stop within 5 s, on the dot's full opacity (WCAG 2.2.2, R31); the
  word beside the dot says the state.

Transitions (Phase 1 [CSS]: entrances; exits that need an element kept mounted are Phase 2)
- Side panels (StepPanel, RawPanel, Connection details): slide in from the right 260 ms (opacity + translate only;
  the grid column itself changes at once — tests read it). Sliding out 180 ms needs a presence hook: Phase 2.
- Modals: backdrop fades, panel scales 0.96 → 1 and fades.
- Diagrams: no CSS `transform` on SVG `<g>` elements (it would override their `transform` attribute); boxes never
  lift on hover. Pipes pause while the diagram is dragged; above 200 edges only lit edges animate.
- Banners and Flow issues: slide down + fade when they appear; collapse when dismissed.
- Settings column on narrow screens (< 900 px): becomes a drawer toggled from the project header, sliding in from the
  left over a dimmed page [TSX `ProjectPage.tsx`]. While it is open it is a layer of its own (R36): the focus moves to
  its "Close settings" button (drawn in the drawer only), the page behind is `inert` (the head, the banners, the views
  and the top bar), Escape (one layer per press: an open search list first, R15), a click on the dimmed page, Close
  and the Settings button all close it and give the focus back to the Settings button, and it closes when the window
  grows past 900 px. It slides in with `--dur-slow`/`--ease-out` and out with `--dur-exit`/`--ease-in`.
  What to make is never out of sight behind it (the make-picker fix, after Phase 1): the Settings button reads
  "Settings · Make: <target>" or "Settings · Make: nothing yet" (the target part is Inter 13 px in `--ink-muted` on a
  `--screen` readout, since the muted ink is 2.3:1 on the button's own face; a long name ends in an ellipsis, and above
  700 px the button takes at most 40% of the head, below it the whole head, which wraps there anyway, so that a short
  name is never cut on a phone); a project with no target opens the drawer by itself, once per visit (after the
  name prompt), with the focus in the Make section's item search instead of on Close; and the plan banner's "Pick
  something to make" is a button that opens the drawer into that search (on a wide window it focuses the search).

Modern UX (Phase 2 unless marked)
- **Skeletons instead of "Loading…"** [TSX]: project list, plan, Flow, Connections, Map side panels and 3D show
  panel-shaped skeleton blocks with a slow left-to-right sheen; "Updating the plan…" shows a GT progress arrow
  filling in the header. Text stays available to screen readers (and to tests that look for it).
- **Animated readouts** [TSX]: the key-numbers strip counts from the old to the new value over 400 ms when the plan
  changes, and a changed tile flashes its border yellow once; ties into What changed.
- **Diagrams glide** [TSX `FlowView.tsx`, `ConnectionsView.tsx`]: when a new plan re-lays out the diagram, boxes that
  persist move to their new place (FLIP: transform from old to new position, 260 ms), new boxes fade/scale in,
  removed ones fade out; pipes fade to their new route. Fit, zoom buttons and "Show in the flow" animate the pan/zoom
  over 250 ms instead of jumping (wheel/drag stay immediate). e2e tests that read `g.conn-pan` transforms must see
  the final transform (finish the animation before asserting, or skip animation when `navigator.webdriver` is
  true — builder's choice, but no assertion loosened).
- **Toasts + undo** [NEW, small]: a toast stack (bottom-right, chat-box style, slides in with `--ease-pop`, 5 s,
  pausable on hover) confirms actions — project created/renamed/deleted ("Undo" uses the existing restore), note
  added/deleted, token copied/revoked, upload started/finished.
- **No browser dialogs** [TSX `NotesView.tsx`, `ProjectorPanel.tsx`]: note delete and token revoke use an in-app
  confirmation (inline confirm like DeleteProject, or a small modal) instead of `window.confirm`; update the e2e flows
  that accepted the dialog to click the in-app confirm instead.
- **Keyboard** [TSX]: `/` focuses item search; `1`–`6` switch project tabs (when focus is not in a field); `F` fits
  the diagram; `Esc` closes panels/clears focus (exists in Flow); `?` opens a small shortcuts sheet. Shortcuts are
  listed in tooltips on the buttons they mirror.
- **Inline validation** [CSS + small TSX]: fields show their error in place with a red border and message
  (login, amounts, costs) instead of only a line below the form; the login card shakes once on a wrong password
  (reduced motion: no shake).
- **Optimistic feel**: edits already apply through SSE; show a tiny "saving" pip next to the live dot while an op is
  in flight [TSX `ProjectPage.tsx`].

Phase 3 additions: command palette (Ctrl/Cmd+K) over items, tabs and actions; drag to reorder build steps.

## 7. Diagrams: pipes that move and stay connected

Applies to Flow (`FlowView.tsx`, `flow-model.ts`) and Connections (`ConnectionsView.tsx`).

**Canvas.** `.flow-canvas` / `.connections` background `--well` with a 32 px grid of `#404040` 1 px lines, the
element's own CSS background: on the Flow svg, and on the Connections svg's wrapping div, never an element or
pseudo-element over the svg (its empty space is hit-tested); `cursor: grab` as today. Both areas clip on both axes
with a 4 px clip margin, so a sliding side panel flashes no scroll bar and an edge control keeps its focus ring (R17).

**Boxes.** `rect.flow-node-box` (must stay a direct child of `[data-node-id]`): fill `--panel`, 2 px black stroke,
`filter: drop-shadow(0 2px 0 #000)`. Kinds keep their meaning with tinted fills (text `#303030` on all, ≥ 4.5:1):
owned `#b9d6b0`/stroke `#2f6b2f`; new `--panel`/`#000`; partly owned = existing gradient between those two;
import `#d8cfa8`/`#6b5a20`; free import dashed; unreachable import stroke `#aa0000`; missing `#e3b0b0`/`#aa0000`
dashed; target (out) `#f0d870`/`#6b5500`; sink `#a8a8a8` dashed; supporting line `#cbbbe0`/`#5a3a8a` dashed.
Selected/producer = 3 px `--accent` stroke over the black (`paint-order`), consumer = dashed accent. To keep 4.5:1 on
the tinted fills, a row that does not add up is in `#990000` or `#6a4000` (not the panel's `#aa0000`), and the
quieter lines of a left over (and of a Connections hookup) are `#303030` (R18, R23).

**Pipes.** Each edge is drawn as:
1. the existing hit path (`.flow-edge-hit`, unchanged);
2. the existing `.flow-edge-line` restyled as the pipe casing: stroke `#1b1b1b`, width 6, `stroke-linejoin: miter`,
   `stroke-linecap: butt`;
3. **new** `.flow-edge-flow` path on the same `d`: stroke `--item` (or `--fluid` when `isFluidKey(edge.key)`),
   width 2.5, `stroke-dasharray: 6 10`, animated `stroke-dashoffset` from 0 to −16 so dashes travel **from the
   output port toward the input port** (the `d` already runs source → target);
   `animation-duration` from the edge's `perSecond` (log scale, clamped 0.35 s–1.6 s per 16 px: faster = more
   flow), set as a CSS custom property on the edge `<g>`.
- Missing-source edges: solid casing `#ff5555` (no dash, so it cannot end in a gap at the flange), no moving
  contents (nothing flows). The casing is all there is to see, so its red reads 3.79:1 on the well (`#aa0000` read
  1.54:1), and its arrow head is white, which reads on it (R34, over R20's red head).
- Focus mode: lit (`.hl`) edges — white contents, and a 1.5 px accent rim (the 9 px hit path in `--accent` under
  the 6 px casing) that blinks once as it lights (R19); dimmed edges (`.dim`) pause their animation.
- Same treatment in Connections (`.conn-edge`): casing dark, contents in the carrier's colour (the existing
  `--conn-link` per `.conn-via-*`, or the EnderIO channel's dye as today), same motion rules. Edges that carry
  nothing (`attached`, `hookup`) are thin static lines. Channel dyes that are too dark to read on a dark casing
  (black, brown, blue, gray, green, purple, red) get a `--panel` casing instead. "By hand" edges keep a dash-dot
  pattern whose lengths sum to 16 px so the loop is seamless. A hovered link shows a white rim, a picked one a
  yellow rim that blinks once: a rim polyline under the casing, as recolouring the casing would hide yellow or white
  contents (R22). The arrow head takes its pipe's colour with `fill: context-stroke`; a browser without it (WebKit)
  keeps a yellow fallback, never black (R32). Hovering a box changes only its stroke colour (boxes never move or
  grow on hover; tests measure them).

**Connected — acceptance rules.**
- A pipe's visible end touches its port: Flow ports become a "pipe flange" — a 4 × 10 px rect in `--slot` with a
  1 px black stroke, centred on the box edge (4 px deep = ELK's 2 px port box on each side, 10 px tall so the 6 px
  pipe has no notch); the pipe ends exactly on the flange's outer face. Ports are already painted after edges.
- Arrow markers use `markerUnits="userSpaceOnUse"` (fixed 8 × 8, pixel triangle in the content colour) with `refX`
  set so the tip lands exactly on the port; markers must not scale with the new stroke width.
- Bends stay orthogonal with mitred corners (no round caps showing gaps).
- Checked by screenshot at zoom 0.15, 0.9, 1 and 3, both in the default view and in focus mode: no gap > 0 px and no
  overshoot past the port into the box text.

**Goods riding the pipes (Phase 2).** One small item icon (12 px, the edge's good via the existing icon pipeline)
travels each edge with SVG `<animateMotion>` along the edge's path, on top of the pipe, `pointer-events: none`.
Limits: at most 1 per edge and 150 per diagram; when a diagram has more than 200 edges, only lit edges animate
(contents and riders). Reduced motion: no riders, dashes static.

**Motion budget.** CSS animations only (no JS frame loop); `will-change` not used on SVG; the animation is
`animation-play-state: paused` while the canvas is being dragged/zoomed if profiling shows jank. All animation
stops under `prefers-reduced-motion: reduce`.

**A way to stop the pipes** (WCAG 2.2.2 Pause, Stop, Hide; R31). The pipes move for as long as a diagram is shown,
so the Flow and Connections toolbars have a text button after Fit, "Pause pipes" / "Play pipes" (`aria-pressed`),
that stops them where they are, dashes showing. One setting for the browser, shared by both diagrams and kept in
localStorage (`gtnh-planner:pipes-paused`); paused, the Flow svg has the class `pipes-paused` and the Connections area
`data-pipes="paused"`.

## 8. Per-screen treatment and phases

Tags: **[CSS]** stylesheet only, **[TSX]** small markup change, **[NEW]** new UI.

### Phase 1 — the B look everywhere, moving connected pipes

- Tokens, fonts, base controls, buttons, inputs, checkbox/radio, range, progress, details, tabs, modal, banners,
  badges, scrollbars, page background [CSS]; font packages + imports [TSX].
- Top bar: pixel brand mark [TSX], buttons as nav [CSS].
- Login: centred panel, brand mark above [CSS].
- Project list: cards as panels, target icon in a slot, Delete demoted to a small danger button [CSS].
- Project page header: name in Pixelify, live dot green [CSS]; plan banner as chat box [CSS].
- Settings column: sections as panels with Pixelify titles; native controls restyled [CSS].
- Flow: canvas, boxes, pipes + moving contents + flanges + markers (§7) [CSS + TSX `FlowView.tsx`]; legend
  swatches match new fills [CSS]; StepPanel as panel, its lists in wells [CSS].
- Connections: same as Flow [CSS + TSX `ConnectionsView.tsx`].
- Materials & steps, Notes: panels, rows with slot icons, ticks as custom checkboxes [CSS].
- Map tab: toolbar as buttons, panels around the map, NEI MapTooltip [CSS + inline-style → class/token migration in
  `MapTab.tsx`, `MapView.tsx` chrome, `LinePanel.tsx`, `FoundPanel.tsx`, `MapTooltip.tsx`]. Canvas drawing untouched.
  The pin and note rows are flat Inter rows with a dark picked row, not button faces, on which a note's muted
  coordinates would read 1.7:1 (R25).
- 3D tab: controls row and side column as panels/buttons [CSS + inline-style migration in `View3D.tsx` chrome].
  Canvas untouched; it has a class of its own, `.view3d-scene`, as no stylesheet rule may name the `canvas` element
  (R29).
- World page and Smart upload: panels, GT-style progress bars [CSS + inline-style migration in `WorldPage.tsx`,
  `SmartUploadPanel.tsx`].
- Projector panel: panel + code boxes as `--screen` wells [CSS + `ProjectorPanel.tsx` style constants].
- Inline styles: migrate the colour/border/radius/font ones to classes or tokens; leave layout-only ones (flex,
  widths) where moving them gains nothing. Keep the inline styles unit tests assert (e.g. projector
  `style="margin-top:4px"`, view3d legend `background:rgb(...)`, ItemIcon width/background).

Moved to Phase 2 while Phase 1 was built: the selected slot's scale-in (R3), the selected tab's 2 px rise, the
tooltips' 80 ms exit, the Materials disclosures' height animation, and 32 px toolbar icon buttons (Flow's zoom
buttons are `button.small`, 28 px).

### Phase 2 — the visuals from the mockup

- **Key-numbers strip** [TSX `ProjectPage.tsx`]: output rate, peak EU/t, machine count, build cost, run cost as
  readout tiles (values from the plan and `plan-cost.ts`); `p.plan-cost` keeps existing (visually the tiles' source
  sentence may move to `.visually-hidden` or a tooltip, but the element and its text stay for `build-cost.spec.ts`).
- **Flow boxes** [TSX `FlowView.tsx`, `flow-model.ts`]: GT machine icon (`gregtech:gt.blockmachines@<mteId>`,
  `mteId` is on each plan step) beside the title, tier chip, machine-count badge, utilisation bar (busy %) under the
  title; retune box metrics.
- **Goods riding the pipes** (§7).
- **StepPanel recipe card** [TSX `StepPanel.tsx`]: Takes/Makes shown as an NEI recipe — input slots with stack
  counts → pixel progress arrow → output slots, energy bar (EU/t), tier chip; the existing port lists stay below
  (tests and hover-highlighting depend on them).
- **To build as inventory** [TSX `MaterialsView.tsx`]: a grid/list toggle; grid = 36 px slots, stack splitting at 64
  like Minecraft, green tick overlay for ticked rows, NEI tooltip on hover; the list (today's tree with
  `li.mat-row`) stays the default and the source of truth for tests.
- **Tier picker** [TSX `TierPicker.tsx`, `SettingsPanel.tsx`]: tier buttons (ULV…MAX) as chips **next to** the
  existing `<select>` (unit tests require the select as root) — or keep the select and only colour its options.
  Builder's choice, as long as tests keep passing without weakening.

### Phase 3 — later (not in this work)

Map overlay legend, 3D "Blocks to place" as slot grid (needs item keys on rows), World page mini chunk map, project
list as large tiles, real block textures as panel backgrounds when assets exist.

## 9. Verification

- `npm test` and `npm run e2e` green after each phase, with no assertion removed or loosened (only deliberate markup
  updates per §3).
- Re-run the screenshot tour (`scratchpad/shots/shoot*.mjs`, adapted paths) after each phase; compare with the
  before shots and the mockup; specifically check every §7 "Connected" rule and that dashes move (two screenshots
  0.3 s apart differ along edges; under emulated reduced motion they do not).
- Motion check (§7a): record a short Playwright video or screenshot sequence of a tab switch, side panel open/close,
  modal, toast, a plan change (readouts count, diagram glides) and Fit; confirm no transition exceeds 300 ms and
  that with `reducedMotion: 'reduce'` nothing moves.
- Contrast spot-check of every text/background pair in §4 and the tier chips.
- Performance: Flow with the largest available plan stays responsive while panning (no long frames from the
  animation in a Chrome performance trace).

## 10. Calls the designer made (nobody asked the user)

1. Single theme, no automatic dark mode (B is one look).
2. Pixelify Sans + Inter, bundled via `@fontsource` packages (new dependencies).
3. Diagram box text keeps the system UI stack it had (`system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif`, §5),
   which keeps its measured box metrics valid; the pixel font only outside the SVG text.
4. Pipe contents: yellow for items, cyan for fluids, carrier colour in Connections; speed follows rate.
5. Phases 1 and 2 are this work; Phase 3 is listed but not built.
6. Map terrain and 3D scene rendering unchanged (their pixels are tested).
7. Materials keeps the list as default with an inventory-grid toggle, rather than replacing the list.
8. Tooltips: the three custom ones (MapTooltip, the Flow edge tag, the 3D hover label) become NEI-style in Phase 1;
   native `title` tooltips on items, Flow and Connections become the shared NEI tooltip in Phase 2 (§6).
9. "Modern UX" is read as: motion system + micro-interactions + transitions (Phase 1), and skeletons, animated
   readouts, gliding diagrams, toasts with undo, in-app confirms, keyboard shortcuts, inline validation (Phase 2);
   command palette deferred to Phase 3.

## 11. Left to the builder

- Exact CSS structure (keep one stylesheet or split by area), class names for new pieces, and which layout-only
  inline styles to leave.
- Rate → animation-speed curve within the clamp; flange drawing details; marker geometry.
- Whether the tier picker chips replace or accompany the select (within the tests' constraints).
- Retuned flow/connections metrics values.
