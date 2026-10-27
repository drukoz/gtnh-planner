// The diagrams glide (Phase 2 spec §16.1–§16.3, P2-D6; Tasks 13a and 13b): Fit, the zoom buttons and a reveal move a diagram's view in a pan of
// PAN_MS, a WAAPI animation of its pan group's CSS `transform` from absolute keyframes: from the picture on screen to the view the group's
// `transform` attribute already holds (React writes it at once), with no fill, so the pan hands the group back to its attribute where it ends
// (spec §3.3's one exception to "no CSS transform on a <g>"). In SVG a CSS px is a user unit and the origin is 0 0, so the keyframes write the
// attribute's view as it is. An instant move (the wheel, a drag) holds a pan under way where it is and starts from that picture; the view it
// commits then ends the pan. A new layout glides into place the same way (`glideLayout`, Task 13b): each box that moved from where it is drawn
// (where it stood, or part way along the last layout's glide: ledger ruling P2-R117) to where its own `transform` attribute already puts it,
// over GLIDE_MS, while what came fades in; the pan and the boxes' glides are on different groups, so they compose. Where the browser cannot
// move a group so (`canGlide`, ledger ruling P2-D46) or the user asks for less motion, the view and the boxes move at once, as before; there is
// no SMIL fallback. Flow's pan group is `g.flow-pan` and Connections' `g.conn-pan`, each driven by `usePan`.

import { useLayoutEffect, useRef, useState, type Dispatch, type RefObject, type SetStateAction } from 'react';
import { EASE_OUT, GLIDE_MS, PAN_MS, prefersReducedMotion } from '../state/motion.ts';
import { glidable, type LayoutChange } from './flow-model.ts';

/** A diagram's view: its picture's top left at (x, y) in the svg's px, zoomed by `scale` (the group's `translate(x y) scale(scale)`). */
export interface PanView { x: number; y: number; scale: number }

/** The id of a pan's animation, which tells it from any other animation of its group. */
export const PAN_ANIMATION_ID = 'pan';

/** `v` as the CSS transform a pan animates: its offset in px, which are the svg's user units. */
export function panTransform(v: PanView): string {
  return `translate(${v.x}px, ${v.y}px) scale(${v.scale})`;
}

/**
 * The view a computed CSS transform shows, `matrix(a, 0, 0, a, e, f)` (what the browser computes for a pan group while a pan runs): null for
 * `none`, and for anything that is no pan's (turned, skewed, stretched, 3D).
 */
export function matrixView(css: string): PanView | null {
  const values = /^matrix\(([^)]*)\)$/.exec(css.trim())?.[1]?.split(',').map(Number) ?? [];
  if (values.length !== 6 || values.some((n) => !Number.isFinite(n))) return null;
  const [a, b, c, d, e, f] = values as [number, number, number, number, number, number];
  return b === 0 && c === 0 && a === d ? { x: e, y: f, scale: a } : null;
}

const SVG_NS = 'http://www.w3.org/2000/svg';

/** What `canGlide`'s check found: undefined until it has run, once. */
let glides: boolean | undefined;

/**
 * Whether this browser can pan a diagram (ledger ruling P2-D46): a WAAPI `transform` on a `<g transform>` moves the group while it runs and
 * hands it back to its attribute when it ends, as Task 12's spike (b) found in Chromium and WebKit (ledger ruling P2-R92). Checked once, by
 * that spike's probe in an svg of its own out of sight, which takes no pointer and no focus and is gone once checked, with the scale a pan
 * zooms by too (fix round 1): a group at translate(10 20) whose pan from translate(0, 0) scale(1) to translate(40px, 80px) scale(3), held at
 * 500 of 1000 ms, puts its 10 × 10 rect half way and scaled 2 about the group's origin, from (20, 40) to (40, 60), and cancelled, back on the
 * attribute, from (10, 20) to (20, 30). False with no `Element.prototype.animate` (node), or when the probe throws.
 */
export function canGlide(): boolean {
  glides ??= probe();
  return glides;
}

function probe(): boolean {
  if (typeof Element === 'undefined' || typeof Element.prototype.animate !== 'function') return false;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('width', '100');
  svg.setAttribute('height', '100');
  svg.style.cssText = 'position: fixed; left: -200px; top: -200px; visibility: hidden; pointer-events: none;';
  const g = document.createElementNS(SVG_NS, 'g');
  g.setAttribute('class', 'glide-probe');
  g.setAttribute('transform', 'translate(10 20)');
  const rect = document.createElementNS(SVG_NS, 'rect');
  rect.setAttribute('width', '10');
  rect.setAttribute('height', '10');
  g.append(rect);
  svg.append(g);
  try {
    document.body.append(svg);   // in the try: a probe that cannot run answers false, and never throws out of `canGlide`
    /** The rect's top left and bottom right corners, in the svg's px. */
    const at = (): number[] => {
      const area = svg.getBoundingClientRect();
      const box = rect.getBoundingClientRect();
      return [box.left - area.left, box.top - area.top, box.right - area.left, box.bottom - area.top];
    };
    const pan = g.animate(
      [{ transform: 'translate(0px, 0px) scale(1)' }, { transform: 'translate(40px, 80px) scale(3)' }], { duration: 1000, fill: 'none' },
    );
    pan.pause();
    pan.currentTime = 500;
    const half = at();
    pan.cancel();
    return near(half, [20, 40, 40, 60]) && near(at(), [10, 20, 20, 30]);
  } catch {
    return false;
  } finally {
    svg.remove();
  }
}

/** Whether each number is within half a pixel of the one wanted. */
function near(got: number[], want: number[]): boolean {
  return got.length === want.length && got.every((n, i) => Math.abs(n - (want[i] ?? Number.NaN)) <= 0.5);
}

/**
 * Pans the group `g` from `from` (the picture on screen) to `to` (the view its attribute already holds) over PAN_MS with `--ease-out`: absolute
 * keyframes, never an implicit end (WebKit's underlying transform is `none`), and no fill, so the group is on its attribute once the pan has
 * ended. Null, and the view moves at once, under reduced motion, then between equal views, then where the browser cannot (`canGlide`): in that
 * order, so its probe never runs for a pan that would not be made.
 */
export function glideView(g: SVGGElement, from: PanView, to: PanView): Animation | null {
  if (prefersReducedMotion()) return null;
  if (from.x === to.x && from.y === to.y && from.scale === to.scale) return null;
  if (!canGlide()) return null;
  return g.animate([{ transform: panTransform(from) }, { transform: panTransform(to) }], {
    duration: PAN_MS, easing: EASE_OUT, fill: 'none', id: PAN_ANIMATION_ID,
  });
}

/** The pan under way on `g`, playing or held; undefined when none is. */
function panOn(g: Element): Animation | undefined {
  return g.getAnimations().find((a) => a.id === PAN_ANIMATION_ID);
}

/** The picture a pan under way on `g` shows (playing or held), from the matrix the browser computes; null when no pan runs. */
export function viewOnScreen(g: SVGGElement): PanView | null {
  return panOn(g) === undefined ? null : matrixView(getComputedStyle(g).transform);
}

/** Ends a pan under way on `g`: the group shows the view its attribute holds. */
export function stopPan(g: SVGGElement): void {
  for (const a of g.getAnimations()) if (a.id === PAN_ANIMATION_ID) a.cancel();
}

/**
 * Holds a pan under way on `g` where it is and gives the picture it shows; null when none runs. An instant move starts from that picture, which
 * stays on screen until the view the move commits ends the pan, however late React draws it.
 */
export function holdPan(g: SVGGElement): PanView | null {
  const pan = panOn(g);
  if (pan === undefined) return null;
  const time = pan.currentTime;
  pan.pause();
  pan.currentTime = time;                         // a pause takes hold at the next frame; a time set now holds it here at once
  return matrixView(getComputedStyle(g).transform);
}

/** The matrix of `v`, the group's `translate(x y) scale(scale)`. */
function matrixOf(v: PanView): DOMMatrix {
  return new DOMMatrix([v.scale, 0, 0, v.scale, v.x, v.y]);
}

/**
 * The matrix of `el`'s `transform` attribute. Chromium and WebKit give the SVG DOM's matrices as the old SVGMatrix, whose `multiply` takes no
 * DOMMatrix: each is read as its numbers.
 */
function attributeMatrix(el: SVGGraphicsElement): DOMMatrix {
  const list = el.transform.baseVal;
  let matrix = new DOMMatrix();
  for (let i = 0; i < list.numberOfItems; i++) matrix = matrix.multiply(DOMMatrix.fromMatrix(list.getItem(i).matrix));
  return matrix;
}

/**
 * Where `el`, drawn in the pan group `g`, stands on screen once the motion under way there has ended (where it is when none runs): in the view
 * the group's attribute holds, not in the picture on its way there, and, inside a box that glides into a new layout's place (`glideLayout`,
 * Task 13b), where that box's own attribute puts it. What decides where the focus goes reads it, so the focus goes where it will be seen
 * (ledger rulings P2-R35 and P2-R36): a panel's Close pressed while a replan glides the box that opened it judges the box where it lands.
 */
export function restingBox(g: SVGGElement, el: Element): DOMRect {
  const box = el.getBoundingClientRect();
  const ctm = g.ownerSVGElement?.getScreenCTM() ?? null;
  if (ctm === null) return box;
  // how far each box gliding on the way up from `el` to the pan group has yet to go (a glide is a translation), in the diagram's units
  let glide = new DOMMatrix();
  for (let a: Element | null = el; a !== null && a !== g; a = a.parentElement) {
    if (!(a instanceof SVGGraphicsElement) || a.getAnimations().length === 0) continue;
    const drawn = matrixView(getComputedStyle(a).transform);
    if (drawn !== null) glide = glide.multiply(attributeMatrix(a)).multiply(matrixOf(drawn).inverse());
  }
  const on = viewOnScreen(g);
  if (on === null && glide.isIdentity) return box;
  const screen = DOMMatrix.fromMatrix(ctm);
  const rest = attributeMatrix(g);
  // screen px to the svg's units, to the diagram's through the picture on screen, on by what the boxes have yet to glide, back through the
  // attribute's view, and to screen px
  const move = screen.multiply(rest).multiply(glide).multiply((on === null ? rest : matrixOf(on)).inverse()).multiply(screen.inverse());
  const a = new DOMPoint(box.left, box.top).matrixTransform(move);
  const b = new DOMPoint(box.right, box.bottom).matrixTransform(move);
  return new DOMRect(a.x, a.y, b.x - a.x, b.y - a.y);
}

/**
 * Ends the motion that moves `el` in the pan group `g`: a pan under way, and the glide of each box `el` is in, so `el` is drawn where it rests
 * (`restingBox`), as a scroll to it needs.
 */
export function settle(g: SVGGElement, el: Element): void {
  stopPan(g);
  for (let a: Element | null = el; a !== null && a !== g; a = a.parentElement) {
    for (const animation of a.getAnimations()) if (animation.effect?.getComputedTiming().endTime !== Infinity) animation.finish();
  }
}

/**
 * What a new layout's glide moves in a diagram (`glideLayout`): the attributes that name its boxes (by the box's id), the one that names its
 * arrows, the one that names an arrow's tag (by the arrow's id: Flow's lit arrows' `data-edge-tag`, fix round 1), and what fades in with the
 * arrows (`extra`, a selector: Flow's rider layer).
 */
export interface GlideTargets { boxes: readonly string[]; edges: string; tags?: string; extra?: string }

/** A box's glide under way (`glideLayout`): its animation, and from where to where it takes the box, in the diagram's units. */
interface BoxGlide { animation: Animation; from: [number, number]; to: [number, number] }

/** The boxes' glides under way, by pan group, then by box id. */
const boxGlides = new WeakMap<Element, Map<string, BoxGlide>>();
/** The fades in of the boxes that came (`glideLayout`), by pan group, then by box id (fix round 2). */
const boxFades = new WeakMap<Element, Map<string, Animation>>();

/** The map of `root` in `byRoot`, made empty the first time. */
function mapOf<T>(byRoot: WeakMap<Element, Map<string, T>>, root: Element): Map<string, T> {
  let map = byRoot.get(root);
  if (map === undefined) {
    map = new Map();
    byRoot.set(root, map);
  }
  return map;
}

/**
 * Where the box `id` of the pan group `root` is drawn while its glide (`glideLayout`) runs, in the diagram's units: the glide's place at its
 * eased progress, which goes on when the box is taken away, so the ghost of a box dropped while it glides stands where it was drawn (ledger
 * ruling P2-R117). Null when it does not glide: it stands at its attribute.
 */
export function glidingAt(root: Element, id: string): [number, number] | null {
  const glides = boxGlides.get(root);
  const glide = glides?.get(id);
  if (glide === undefined) return null;
  const progress = glide.animation.playState === 'idle' ? null : glide.animation.effect?.getComputedTiming().progress ?? null;
  if (progress === null) {                          // ended, or cancelled: the box is on its attribute
    glides?.delete(id);
    return null;
  }
  const [[fx, fy], [tx, ty]] = [glide.from, glide.to];
  return [fx + (tx - fx) * progress, fy + (ty - fy) * progress];
}

/**
 * How far the fade in of the box `id` of the pan group `root` has come (`glideLayout`), from 0 to 1: its eased progress, so the box is drawn at
 * that much of its own opacity. Its fade goes on when the box is taken away, so the ghost of a box dropped while it still fades in starts from
 * the opacity the box was drawn at, not from whole (fix round 2, ledger ruling P2-R109 widened), as `glidingAt` gives where it was drawn. Null
 * when it does not fade (any more): it is drawn at its own opacity.
 */
export function fadedIn(root: Element, id: string): number | null {
  const fades = boxFades.get(root);
  const fade = fades?.get(id);
  if (fade === undefined) return null;
  const progress = fade.playState === 'idle' ? null : fade.effect?.getComputedTiming().progress ?? null;
  if (progress === null) fades?.delete(id);         // ended, or cancelled: the box is at its own opacity
  return progress;
}

/**
 * A fade in, from nothing to the element's own opacity: one keyframe, at offset 0, so its end is the element's own opacity, an implicit one (a
 * box that comes in under a focus ends at its `.dim` 0.18). A lone keyframe with no offset would be the end one, and fade the element out.
 */
export const FADE_IN: Keyframe[] = [{ opacity: 0, offset: 0 }];

/**
 * Whether a new layout glides into place (Phase 2 spec §16.3): never under reduced motion, nor when it changes more than GLIDE_LIMIT boxes, those
 * it moves, brings and drops (it snaps: review focus 4, ledger ruling P2-R119), nor where the browser cannot move a group so (`canGlide`, ledger
 * ruling P2-D46); asked in that order, so the probe never runs for a layout that would not glide. The boxes a layout drops fade out (FlowView's
 * ghosts) only when it glides.
 */
export function layoutGlides(change: LayoutChange): boolean {
  return !prefersReducedMotion() && glidable(change) && canGlide();
}

/** The elements of `root` that carry one of `attrs`, by its value (the first attribute that names a value wins). */
function named(root: Element, attrs: readonly string[]): Map<string, Element> {
  const found = new Map<string, Element>();
  for (const attr of attrs) {
    for (const el of root.querySelectorAll(`[${attr}]`)) {
      const id = el.getAttribute(attr);
      if (id !== null && !found.has(id)) found.set(id, el);
    }
  }
  return found;
}

/**
 * Glides a diagram's new layout into place in its pan group `root` (Phase 2 spec §16.3), the layout drawn and not yet painted: each box that moved
 * from where it stood to where its `transform` attribute already puts it, absolute keyframes with no fill, so it hands the box back to its
 * attribute, over GLIDE_MS with `--ease-out`; each box that came in fades in (`FADE_IN`) over the same time (`fadedIn` says how far); and each
 * arrow whose points changed or that came, with its tag (`targets.tags`) and `targets.extra` when any did, fades in over the second half (a
 * backwards fill keeps it invisible through the first), so a pipe is never seen hanging off a box on its way. A box the last layout still glides
 * starts from where it is drawn, its old glide ended, as a pan starts from the picture on screen (ledger ruling P2-R117), and one still fading in
 * fades in on as it glides; the boxes this layout moves, brings or drops end any glide they had, so where this layout snaps they stand on their
 * attributes at once, and those it brings or drops end any fade in they had. Each element is found by its id in the attributes `targets` names,
 * all of them in one pass. Nothing moves for the same layout again (every SSE refetch's), and then the browser is not even asked whether it can
 * glide; nor where `layoutGlides` says no, so the new layout is drawn at once. Gives the animations it started.
 */
export function glideLayout(root: SVGGElement, change: LayoutChange, targets: GlideTargets): Animation[] {
  const { moved, entered, left, rerouted } = change;
  const glides = mapOf(boxGlides, root);
  const fades = mapOf(boxFades, root);
  const drawn = new Map(moved.map(({ id }) => [id, glidingAt(root, id)]));
  for (const id of [...moved.map((m) => m.id), ...entered, ...left]) {
    glides.get(id)?.animation.cancel();
    glides.delete(id);
  }
  // a box that moves fades in on as it glides; one that came anew, or went, is another element, or none
  for (const id of [...entered, ...left]) {
    fades.get(id)?.cancel();
    fades.delete(id);
  }
  if (moved.length + entered.length + rerouted.length === 0 || !layoutGlides(change)) return [];
  const started: Animation[] = [];
  const boxes = named(root, targets.boxes);
  for (const { id, from: stood, to } of moved) {
    const box = boxes.get(id);
    if (box === undefined) continue;
    const from = drawn.get(id) ?? stood;
    const animation = box.animate(
      [{ transform: `translate(${from[0]}px, ${from[1]}px)` }, { transform: `translate(${to[0]}px, ${to[1]}px)` }],
      { duration: GLIDE_MS, easing: EASE_OUT, fill: 'none' },
    );
    glides.set(id, { animation, from, to });
    started.push(animation);
  }
  for (const id of entered) {
    const fade = boxes.get(id)?.animate(FADE_IN, { duration: GLIDE_MS, easing: EASE_OUT, fill: 'none' });
    if (fade === undefined) continue;
    fades.set(id, fade);
    started.push(fade);
  }
  if (rerouted.length === 0) return started;
  const secondHalf: KeyframeAnimationOptions = { delay: GLIDE_MS / 2, duration: GLIDE_MS / 2, fill: 'backwards' };
  const arrows = named(root, [targets.edges]);
  const tags = targets.tags === undefined ? new Map<string, Element>() : named(root, [targets.tags]);
  for (const id of rerouted) {
    for (const el of [arrows.get(id), tags.get(id)]) {
      const fade = el?.animate(FADE_IN, secondHalf);
      if (fade !== undefined) started.push(fade);
    }
  }
  const extra = targets.extra === undefined ? undefined : root.querySelector(targets.extra)?.animate(FADE_IN, secondHalf);
  if (extra !== undefined) started.push(extra);
  return started;
}

/**
 * The pan of a diagram whose view is `view`, set by `setView` and drawn by the group `panRef` (its `transform` attribute), `toPan` and `fromPan`
 * translating that view (Phase 2 spec §16.2). Every commit of a new view ends a pan under way; a view `glideTo` made is panned to, from the
 * picture on screen (the pan's, else the view drawn before), started in the commit, before the frame is painted, so the new attribute and the
 * pan come together and nothing flashes. A pan goes with the view object `glideTo` made, never with whatever commit comes next (ledger ruling
 * P2-R108): its update can wait for React's default lane while an instant move's commits first, and an instant move made on top of it gives a
 * view of its own, drawn at once. `holdView` holds a pan under way where it is and gives that picture as a view, for an instant move to start
 * from (the wheel, a drag, the arrow keys: review focus 1); null when none runs, or once it is held, as a move after the first starts from the
 * view the first set.
 */
export function usePan<V extends object>(
  view: V, setView: Dispatch<SetStateAction<V>>, toPan: (v: V) => PanView, fromPan: (p: PanView) => V,
): { panRef: RefObject<SVGGElement | null>; glideTo(next: SetStateAction<V>): void; holdView(): V | null } {
  const panRef = useRef<SVGGElement | null>(null);
  /** The views `glideTo` made: a commit of one of them is panned to; any other view is drawn at once. */
  const [glided] = useState(() => new WeakSet<V>());
  /** The view the attribute held after the last commit: the picture on screen while no pan runs. */
  const drawn = useRef<V | null>(null);
  /** A pan was started since: the next commit looks for it, and ends it. */
  const panning = useRef(false);
  /** That pan is held, and its picture is on its way to the screen as the view: a move after it starts from that view. */
  const held = useRef(false);
  useLayoutEffect(() => {
    const before = drawn.current;
    drawn.current = view;
    const glide = glided.has(view);
    const g = panRef.current;
    if (g === null) return;
    let from = before === null ? null : toPan(before);
    if (panning.current) {
      panning.current = false;
      held.current = false;
      from = viewOnScreen(g) ?? from;
      stopPan(g);
    }
    if (glide && from !== null) panning.current = glideView(g, from, toPan(view)) !== null;
  }, [view]);   // reads the current `toPan`; only a new view moves the picture
  return {
    panRef,
    // the view the update makes is marked as the pan's, each time React applies it (a rebase over an instant move applies it again)
    glideTo: (next) => setView((v) => {
      const to = typeof next === 'function' ? (next as (prev: V) => V)(v) : next;
      glided.add(to);
      return to;
    }),
    holdView: () => {
      const g = panRef.current;
      const on = g === null || !panning.current || held.current ? null : holdPan(g);
      if (on === null) return null;
      held.current = true;
      return fromPan(on);
    },
  };
}
