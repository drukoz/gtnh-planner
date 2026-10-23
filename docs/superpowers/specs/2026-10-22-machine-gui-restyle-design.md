# Machine GUI restyle — design

Date: 2026-10-22. Status: draft for approval.

## 1. Intent

The user asked for the web client to be "more like minecraft", "a bit more visual and interactive like
https://gtnhplanner.com/ but not exactly like this", and "more like industrial and proffesional". Shown three
directions as mockups, they picked **B · Machine GUI** ("do B") and added: "make sure the lines are moving and
connected" and "make sure even tho it is machine UI it is also animated and mordern UX".

Reference mockup (the look to match, not a pixel spec): the "B · Machine GUI" artboard on the design canvas
https://claude.ai/artifact/Vc3ePZTxQJeqqzBFhRF5us (source:
`/private/tmp/claude-501/-Users-drukoz-gtnh-planner/1fda0de6-6cd6-4a4f-ad51-448ca5885d74/scratchpad/restyle-canvas/project/MachineGui.dc.html`).
Screenshots of today's app, one per screen and tab:
`/private/tmp/claude-501/-Users-drukoz-gtnh-planner/1fda0de6-6cd6-4a4f-ad51-448ca5885d74/scratchpad/shots/*.png`
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
  reduce` stops all non-essential animation.

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
| `--ok` | `#55ff55` on dark, `#1e5a1e` on panel | |
| `--danger` | `#ff5555` on dark, `#aa0000` on panel | |
| `--warn` | `#ffaa00` on dark, `#6a4000` on panel | |
| `--chat` | `rgba(0,0,0,0.82)` | notice/alarm boxes (chat-message look) |
| `--tip-bg` / `--tip-border` / `--tip-inner` | `rgba(16,0,16,0.94)` / `#5000ff` / `#28007f` | NEI tooltip |
| `--fluid` | `#55ffff` | fluid pipe contents |
| `--item` | `#ffff55` | item pipe contents |
| `--focus` | 3 px `#ffff55` outline, offset 0 | all focusables; the ring touches the control's own dark border, so it keeps ≥ 3:1 even on light panels |

**Ink per surface.** Text colour depends on what it sits on, so each surface sets its own ink custom properties
(`--ink`, `--ink-muted`, `--ink-title`, `--ink-link`, `--ink-error`, `--ink-ok`, `--ink-warn`) and the generic
classes (`.muted`, `.error`, `a`, `button.link`, headings, `.tick-by`) read them:

| Surface | ink / muted / title / link / error / ok / warn |
|---|---|
| page (stone; `:root`) | `#dddddd` / `#aaaaaa` / `#ffffff` / `#ffff55` / `#ff5555` / `#55ff55` / `#ffaa00` |
| panel (`--panel`) | `#303030` / `#4a4a4a` / `#404040` / `#1a3fa0` / `#aa0000` / `#1e5a1e` / `#6a4000` |
| dark (chat, screen, well) | `#ffffff` / `#aaaaaa` / `#ffff55` / `#ffff55` / `#ff5555` / `#55ff55` / `#ffaa00` |

`section.tab-panel` (today unstyled) becomes a panel surface, so every tab's content sits on `--panel`.
Unselected tabs use `#1b1b1b` text on `#8b8b8b` (5.06:1).

Radii: 0 everywhere. Spacing: 4 px base (4/8/12/16/24). Shadows: only bevels (inset box-shadows) and a 2 px hard
drop `0 2px 0 #000` under raised items; no blur shadows except tooltips.

Voltage tier colours (chips are text on `--screen`; GT's chat colours, lightened where the original fails AA on
dark): ULV `#9a9a9a`, LV `#dddddd`, MV `#55ffff`, HV `#ffaa00`, EV `#ff55ff`, IV `#8c9cff`, LuV `#ff8cff`, ZPM
`#ff5555`, UV `#55dddd`, UHV `#ff6b6b`, UEV `#55ff55`, UIV `#00cc00`, UMV `#ffff55`, UXV `#8080ff`, MAX `#ff5555`
bold. One source of truth used by CSS (custom properties) and TS (the Flow SVG). The map's own
`VOLTAGE_COLORS` (`map/overlays.ts`) stays as is (its tests assert it).

## 5. Typography

- **Pixelify Sans** (SIL OFL 1.1) — headings, tabs, buttons, readout numbers, tier chips, stack counts, tooltips.
  Never below 13 px, never for paragraphs.
- **Inter** (SIL OFL 1.1) — everything else, 14 px base, line-height 1.45; tabular numbers for amounts and rates.
- Bundled through Vite, not a CDN: add `@fontsource/pixelify-sans` and `@fontsource/inter` (pinned exact versions,
  like the other dependencies) and import the needed weights (Pixelify 400/600/700, Inter 400/500/600/700) in
  `main.tsx`. Browsers fetch the `.woff2` files (the static server types them); any `.woff` fallbacks fontsource
  also emits are never requested and are harmless.
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
- **Range:** grey track well, thumb = small Minecraft button.
- **`<progress>`:** dark well, fill `#55ff55` (ok) or `#e03c3c` (energy), 2 px bevel.
- **`<details>`:** summary styled as a full-width Minecraft button with a pixel caret; open = caret down.
- **Tabs:** creative-inventory tabs — unselected `#8b8b8b` with dark text, selected joins the panel below
  (`--panel`, no bottom border); Pixelify 15 px.
- **Item slot:** any listed item icon sits in a slot (`--slot`, 2 px inverted bevel, 2 px padding); stack count
  bottom-right in white Pixelify with dark shadow; hover = white 35% veil (Minecraft hover). The icon `<img>` itself
  is untouched (`image-rendering: pixelated`; e2e reads its centre pixel). Placeholder squares keep their letters
  and `background: rgb()` (unit tests) but get the slot frame.
- **Tooltips** (Phase 1: MapTooltip, the Flow edge tag and the 3D hover label — the custom tooltips that exist
  today; slot tooltips arrive with the shared component in Phase 2): NEI style — `--tip-bg`, 2 px
  `--tip-border` with 1 px `--tip-inner` inside, white first line, `#aaaaaa` detail lines, mod name `#5555ff`
  italic where known; Pixelify 14 px. The Flow edge tag is SVG: rect fill/stroke per tokens.
  Native browser tooltips (about 35 `title` attributes and SVG `<title>` elements in 11 files — every ItemIcon,
  Flow box and arrow, Connections box) stay native in Phase 1. Phase 2 replaces the ones on ItemIcon, Flow boxes and
  arrows and Connections boxes with one shared NEI tooltip component (hover delay 150 ms, also on keyboard focus,
  tap-to-show on touch, `role="tooltip"` + `aria-describedby`), keeps an accessible name on each element (aria-label
  or visually hidden text, so screen readers lose nothing), gives ItemIcon a prop to drop its own tooltip where a
  parent shows one (no double tooltips), and updates the unit tests that assert `title="…"`/`<title>` on purpose.
- **Banners:** `.banner.notice` and info = chat box (`--chat`, yellow text); `.banner.error` = chat box with
  `#ff5555` text; `.plan-banner` = chat box listing problems (red) and hints (yellow) — hints and problems no
  longer share one style.
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
| `--ease-out` | `cubic-bezier(0.2, 0.8, 0.2, 1)` | default |
| `--ease-pop` | `cubic-bezier(0.34, 1.56, 0.64, 1)` | small "pop" (tick, badge, toast in) |
| `--ease-in` | `cubic-bezier(0.4, 0, 1, 1)` | exits |

Rules: animate only `transform` and `opacity` for UI (plus `stroke-dashoffset` for pipes, `background-color` for
hover); exits are faster than entrances; under `prefers-reduced-motion: reduce` every duration becomes 0 except
opacity fades (kept ≤ 100 ms) and nothing moves position.

Micro-interactions (Phase 1, [CSS] unless noted)
- Buttons: hover colour 90 ms; `:active` inverts the bevel and moves the face 1 px down (`translateY(1px)`), so a
  press feels physical; disabled has no hover.
- Slots: hover veil fades in 90 ms; selected slot gets a yellow 2 px frame that scales from 0.9 to 1 with
  `--ease-pop`.
- Checkbox/radio: tick/dot pops in (`scale(0.6)` → 1, `--ease-pop`).
- Tabs: the selected tab rises 2 px into the panel; the tab panel content fades in 160 ms on switch.
- Tooltips: appear after the existing 150 ms rest, fade + 2 px rise 120 ms, disappear 80 ms.
- Focus dim in Flow/Connections: `.dim` opacity transitions 160 ms instead of snapping; a newly lit edge's contents
  pulse once (brightness 1.6 → 1, 400 ms).
- `<details>` sections (settings, materials): content height animates open/closed (CSS
  `interpolate-size: allow-keywords` where supported, instant elsewhere); caret rotates.
- Live indicator: the green dot breathes (opacity 0.6 ↔ 1, 2 s) while connected; turns amber and blinks slowly
  while reconnecting.

Transitions (Phase 1 [CSS]: entrances; exits that need an element kept mounted are Phase 2)
- Side panels (StepPanel, RawPanel, Connection details): slide in from the right 260 ms (opacity + translate only;
  the grid column itself changes at once — tests read it). Sliding out 180 ms needs a presence hook: Phase 2.
- Modals: backdrop fades, panel scales 0.96 → 1 and fades.
- Diagrams: no CSS `transform` on SVG `<g>` elements (it would override their `transform` attribute); boxes never
  lift on hover. Pipes pause while the diagram is dragged; above 200 edges only lit edges animate.
- Banners and Flow issues: slide down + fade when they appear; collapse when dismissed.
- Settings column on narrow screens (< 900 px): becomes a drawer toggled from the project header, sliding in from the
  left over a dimmed page [TSX `ProjectPage.tsx`].

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

**Canvas.** `.flow-canvas` / `.connections` background `--well` with a 32 px grid of `#404040` 1 px lines (CSS
background on the SVG element); `cursor: grab` as today.

**Boxes.** `rect.flow-node-box` (must stay a direct child of `[data-node-id]`): fill `--panel`, 2 px black stroke,
`filter: drop-shadow(0 2px 0 #000)`. Kinds keep their meaning with tinted fills (text `#303030` on all, ≥ 4.5:1):
owned `#b9d6b0`/stroke `#2f6b2f`; new `--panel`/`#000`; partly owned = existing gradient between those two;
import `#d8cfa8`/`#6b5a20`; free import dashed; unreachable import stroke `#aa0000`; missing `#e3b0b0`/`#aa0000`
dashed; target (out) `#f0d870`/`#6b5500`; sink `#a8a8a8` dashed; supporting line `#cbbbe0`/`#5a3a8a` dashed.
Selected/producer = 3 px `--accent` stroke over the black (`paint-order`), consumer = dashed accent.

**Pipes.** Each edge is drawn as:
1. the existing hit path (`.flow-edge-hit`, unchanged);
2. the existing `.flow-edge-line` restyled as the pipe casing: stroke `#1b1b1b`, width 6, `stroke-linejoin: miter`,
   `stroke-linecap: butt`;
3. **new** `.flow-edge-flow` path on the same `d`: stroke `--item` (or `--fluid` when `isFluidKey(edge.key)`),
   width 2.5, `stroke-dasharray: 6 10`, animated `stroke-dashoffset` from 0 to −16 so dashes travel **from the
   output port toward the input port** (the `d` already runs source → target);
   `animation-duration` from the edge's `perSecond` (log scale, clamped 0.35 s–1.6 s per 16 px: faster = more
   flow), set as a CSS custom property on the edge `<g>`.
- Missing-source edges: solid casing `#aa0000` (no dash, so it cannot end in a gap at the flange), no moving
  contents (nothing flows).
- Focus mode: lit (`.hl`) edges — contents brighter (`#ffffff` dashes on accent) and the casing gets a 1 px accent
  outline; dimmed edges (`.dim`) pause their animation.
- Same treatment in Connections (`.conn-edge`): casing dark, contents in the carrier's colour (the existing
  `--conn-link` per `.conn-via-*`, or the EnderIO channel's dye as today), same motion rules. Edges that carry
  nothing (`attached`, `hookup`) are thin static lines. Channel dyes that are too dark to read on a dark casing
  (black, brown, blue, gray, green, purple, red) get a `--panel` casing instead. "By hand" edges keep a dash-dot
  pattern whose lengths sum to 16 px so the loop is seamless. Hovering a box changes only its stroke colour (boxes
  never move or grow on hover; tests measure them).

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
- 3D tab: controls row and side column as panels/buttons [CSS + inline-style migration in `View3D.tsx` chrome].
  Canvas untouched.
- World page and Smart upload: panels, GT-style progress bars [CSS + inline-style migration in `WorldPage.tsx`,
  `SmartUploadPanel.tsx`].
- Projector panel: panel + code boxes as `--screen` wells [CSS + `ProjectorPanel.tsx` style constants].
- Inline styles: migrate the colour/border/radius/font ones to classes or tokens; leave layout-only ones (flex,
  widths) where moving them gains nothing. Keep the inline styles unit tests assert (e.g. projector
  `style="margin-top:4px"`, view3d legend `background:rgb(...)`, ItemIcon width/background).

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
3. Diagram box text stays Inter (keeps layout metrics valid); pixel font only outside the SVG text.
4. Pipe contents: yellow for items, cyan for fluids, carrier colour in Connections; speed follows rate.
5. Phases 1 and 2 are this work; Phase 3 is listed but not built.
6. Map terrain and 3D scene rendering unchanged (their pixels are tested).
7. Materials keeps the list as default with an inventory-grid toggle, rather than replacing the list.
8. Tooltips: the four custom ones become NEI-style in Phase 1; native `title` tooltips on items, Flow and
   Connections become the shared NEI tooltip in Phase 2 (§6).
9. "Modern UX" is read as: motion system + micro-interactions + transitions (Phase 1), and skeletons, animated
   readouts, gliding diagrams, toasts with undo, in-app confirms, keyboard shortcuts, inline validation (Phase 2);
   command palette deferred to Phase 3.

## 11. Left to the builder

- Exact CSS structure (keep one stylesheet or split by area), class names for new pieces, and which layout-only
  inline styles to leave.
- Rate → animation-speed curve within the clamp; flange drawing details; marker geometry.
- Whether the tier picker chips replace or accompany the select (within the tests' constraints).
- Retuned flow/connections metrics values.
