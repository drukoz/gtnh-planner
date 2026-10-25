// The page's one NEI tooltip (Phase 2 spec §6, D11): TooltipHost, mounted once by the App, listens on the document and draws, in a portal
// on <body>, the tip of the trigger (`data-tip`, tooltip-model.ts) that the mouse or a pen rests on, the keyboard focuses or a finger
// touches; one state, so one tip at a time. It is in the DOM only while it shows (world.spec.ts reads the map's with a strict
// `getByRole('tooltip')`), and while it goes it has no role and is hidden from assistive technology. It never takes the pointer.
//
// - Hover: a mouse's or a pen's `pointerover` finds the trigger; once the pointer has rested on it for TIP_DELAY_MS the tip shows beside
//   the pointer and follows it, re-placed at most once a frame. Another trigger hides it at once and waits again.
// - Focus: an element focused from the keyboard (`:focus-visible`) shows the tip of its trigger after the same wait, at the element (a Flow
//   row shows its box's tip at the row); the focus leaving hides it, and Enter or Space on the element hides it until the focus moves.
// - Touch: a tap shows the tip at once, above the trigger, unless the tap acts (tapActs: a link, a button, a field, a role that acts, on the
//   trigger, in it or round it, as a search option round its icon, or a trigger in an svg: P2-R20), and a second tap hides it. A long press (LONG_PRESS_MS within DRAG_THRESHOLD) shows it whatever the tap would do,
//   and keeps the press's context menu and its click from what was pressed, so a long press never ticks or picks (P2-D21); both guards let
//   go at the next press or LONG_PRESS_CLICK_MS after the finger lifts, so a browser that sends no click after a long press loses no tap.
// - A press with a mouse or a pen hides the tip, and its trigger shows nothing until the pointer leaves it, as a native title. Escape
//   hides a tip that shows, and keeps a hovered or focused trigger quiet the same way (until the focus moves, for a focused one); it then
//   prevents the key's default, so the drawer, the search lists, the fields and the note dialog, which all skip such a key, close one layer
//   per press (R15, P2-R21b), but never stops it, so Flow's own Escape still clears a highlight (P2-D22). A key whose default a layer above
//   the tip has prevented is not the tip's either.
// - A scroll, the wheel or a resize hide it, and the pointer and the focus then wait again on what they are on; the window's blur and a
//   hidden page hide it too. While a tip shows, one loop a frame hides it when its trigger has left the document (a list that empties under
//   a still pointer fires no pointerout, and a finger's tip hears no pointer event at all: Review Focus 2), re-reads its lines (a replan
//   rewrites a box's), and keeps a focus or touch tip at its element.
// - Its box gives the focused element (focus) or the trigger its id as one more `aria-describedby` token, unless the tip says no more than
//   the element's own name (P2-D36); the lines that only repeat the name, whatever the separators its parts are joined with, are hidden
//   from assistive technology, so the description is what the tip adds: an icon's mod line, a step head's rows (P2-R22, P2-R24). Only
//   that token is taken back.
// - An element out of view (its svg's, or the window's) shows no tip, not even for a frame; one never placed is dropped as it is, and only
//   a tip that showed fades out (spec §6.2).

import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import { createPortal } from 'react-dom';
import { DRAG_THRESHOLD } from '../views/pan-zoom.ts';
import { Figs } from './Figs.tsx';
import {
  createRestTimer, describedLines, frameThrottle, hoverFrom, inView, LONG_PRESS_CLICK_MS, LONG_PRESS_MS, placeTip, repeatsName, tapActs,
  TIP_ATTR, TIP_EXIT_MS, TIP_MOD_ATTR, tipLines, type TapNode, type TipAnchor,
} from './tooltip-model.ts';

/** What showed the tip: the mouse or a pen resting on it, the keyboard's focus, or a finger. */
type TipMode = 'pointer' | 'focus' | 'touch';

/**
 * The tip drawn: its trigger, the element it is placed at, how it was shown, the pointer (pointer tips), its lines and mod line, and the
 * name of the element it describes, if it describes one (`TipLines` hides the lines that only repeat it).
 */
interface TipState {
  trigger: Element; anchor: Element; mode: TipMode; x: number; y: number; lines: string[]; mod: string | null; named: string | null;
  closing: boolean;
}

/**
 * What a tip's box holds (spec §6.3): a `<div>` a line, the first its title, its figures through `Figs` (VT323, its words, `%` and `×`
 * Pixelify: spec §25); then the mod line, if any, in `div.nei-tooltip-mod`, a mod's name, which stays Pixelify, digits and all (plan ruling
 * digits-mixed). `name` is the accessible name of the element the tip describes: a line that only repeats it is hidden from assistive
 * technology, so the description is what the tip says beyond it (ledger ruling P2-R22). Hook-free.
 */
export function TipLines(props: { lines: readonly string[]; mod: string | null; name?: string | null }): ReactElement {
  const repeats = repeatsName(props.lines, props.name ?? null);
  return (
    <>
      {props.lines.map((line, i) => <div key={i} {...(repeats[i] === true ? { 'aria-hidden': true } : {})}><Figs text={line} /></div>)}
      {props.mod !== null && <div className="nei-tooltip-mod">{props.mod}</div>}
    </>
  );
}

/** The trigger of an event's target: the innermost element with a `data-tip`, itself included. */
function triggerOf(target: EventTarget | null): Element | null {
  return target instanceof Element ? target.closest(`[${TIP_ATTR}]`) : null;
}

/** The outermost svg `el` is drawn in (the diagrams' boxes hold svgs of their own), or null for an element outside any svg. */
function outermostSvg(el: Element): SVGSVGElement | null {
  let svg: SVGSVGElement | null = el instanceof SVGSVGElement ? el : el instanceof SVGElement ? el.ownerSVGElement : el.closest('svg');
  while (svg !== null && svg.ownerSVGElement !== null) svg = svg.ownerSVGElement;
  return svg;
}

/** A box the browser measured, as a tip's anchor. */
const edgesOf = (r: DOMRect): TipAnchor => ({ left: r.left, top: r.top, right: r.right, bottom: r.bottom });

/**
 * Where an element tip is placed beside: what of `el`'s box is in view, in its outermost svg's and in the window (`inView`: a box panned
 * past the diagram's edge, or scrolled out of the window, is not there to see, and a straight arrow's box, a line, is); null when none of
 * it is, and the tip then does not show.
 */
function anchorBox(el: Element): TipAnchor | null {
  const views: TipAnchor[] = [{ left: 0, top: 0, right: document.documentElement.clientWidth, bottom: document.documentElement.clientHeight }];
  const svg = outermostSvg(el);
  if (svg !== null) views.push(edgesOf(svg.getBoundingClientRect()));
  return inView(edgesOf(el.getBoundingClientRect()), views);
}

/** An element as `tapActs` reads it. */
function tapNode(el: Element): TapNode {
  return { tag: el.localName, role: el.getAttribute('role'), hasHref: el.hasAttribute('href'), inSvg: el.closest('svg') !== null };
}

/** The elements from what a tap touched up to its trigger (`path`), and those above the trigger up to the document's root (`above`). */
function tapPath(from: Element, trigger: Element): { path: TapNode[]; above: TapNode[] } {
  const path: TapNode[] = [];
  for (let el: Element | null = from; el !== null; el = el.parentElement) {
    path.push(tapNode(el));
    if (el === trigger) break;
  }
  const above: TapNode[] = [];
  for (let el = trigger.parentElement; el !== null; el = el.parentElement) above.push(tapNode(el));
  return { path, above };
}

/** The tokens of an `aria-describedby` value. */
const tokens = (value: string | null): string[] => (value ?? '').split(/\s+/).filter((token) => token !== '');

/** A finger on the screen: where it went down, on what, and what came of it so far. */
interface Press {
  id: number; x: number; y: number; target: Element | null; trigger: Element | null;
  /** The trigger's tip was showing as it went down: this tap hides it. */
  wasShown: boolean;
  /** It went past DRAG_THRESHOLD: no tap and no long press. */
  moved: boolean;
  /** It became a long press, which showed the tip. */
  long: boolean;
  timer: ReturnType<typeof setTimeout> | null;
}

/** What the component asks of the listeners: place the drawn box, let a closed one go, and stop listening. */
interface Host { place(): void; gone(): void; stop(): void }

/** Starts the listeners of the tip whose box has `id`: `draw` renders a tip (or none), `box` is its element once drawn. */
function startHost(id: string, draw: (tip: TipState | null) => void, box: () => HTMLElement | null): Host {
  /** The tip that shows (not one going), and its `data-tip` as read. */
  let shown: TipState | null = null;
  let shownText = '';
  /** A tip that is going is drawn, until its exit has run. */
  let closing = false;
  let exitTimer: ReturnType<typeof setTimeout> | null = null;
  /** The loop of a frame that watches a tip that shows. */
  let frame: number | null = null;
  /** The element that has our id in its `aria-describedby`. */
  let described: Element | null = null;
  /** The left and top last written, so a still tip writes nothing. */
  let placed = '';
  /** The mouse or the pen as last seen, and the trigger it is over. */
  let pointer = { x: 0, y: 0 };
  let hovered: Element | null = null;
  /** The element that has the focus. */
  let focused: Element | null = null;
  /** Triggers kept from showing: pressed or Escaped, until the pointer leaves them or the focus moves. */
  const quiet = new WeakSet<Element>();
  let press: Press | null = null;
  /** A long press's guards: its context menu and its click are its own, kept from what it was on. */
  const guard: { contextmenu: boolean; click: boolean; timer: ReturnType<typeof setTimeout> | null } = { contextmenu: false, click: false, timer: null };

  /**
   * Gives `el` the tip as one more `aria-describedby` token when the tip says more than its name (P2-D36, ledger ruling P2-R22: an icon's
   * mod line is more), and gives back that name, whose lines `TipLines` hides from assistive technology; null when it describes nothing.
   */
  const describe = (lines: readonly string[], mod: string | null, el: Element): string | null => {
    const name = el.getAttribute('aria-label');
    if (describedLines(lines, mod, name).length === 0) return null;
    const ids = tokens(el.getAttribute('aria-describedby'));
    if (!ids.includes(id)) el.setAttribute('aria-describedby', [...ids, id].join(' '));
    described = el;
    return name;
  };
  const undescribe = (): void => {
    const el = described;
    described = null;
    if (el === null) return;
    const ids = tokens(el.getAttribute('aria-describedby')).filter((token) => token !== id);
    if (ids.length > 0) el.setAttribute('aria-describedby', ids.join(' '));
    else el.removeAttribute('aria-describedby');
  };

  const show = (trigger: Element, anchor: Element, mode: TipMode): void => {
    const text = trigger.getAttribute(TIP_ATTR) ?? '';
    const lines = tipLines(text);
    if (lines.length === 0 || !trigger.isConnected || !anchor.isConnected) return;
    // an element out of its svg's view (panned past the diagram's edge) shows no tip, not even for a frame (spec §6.2)
    if (mode !== 'pointer' && anchorBox(anchor) === null) return;
    if (exitTimer !== null) clearTimeout(exitTimer);
    exitTimer = null;
    closing = false;
    undescribe();
    const mod = trigger.getAttribute(TIP_MOD_ATTR) || null;
    const named = describe(lines, mod, mode === 'focus' ? anchor : trigger);
    shown = { trigger, anchor, mode, x: pointer.x, y: pointer.y, lines, mod, named, closing: false };
    shownText = text;
    placed = '';
    draw(shown);
    if (frame === null) frame = requestAnimationFrame(watch);
  };

  /** The tip that shows stops showing: its description goes, and its loop and its following stop. Gives it back, or null when none showed. */
  const unshow = (): TipState | null => {
    const last = shown;
    if (last === null) return null;
    shown = null;
    undescribe();
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
    follow.cancel();
    return last;
  };
  /** Hides the tip that shows: it goes at once for assistive technology and for the next Escape, and fades out (`tip-out`). */
  const hide = (): void => {
    const last = unshow();
    if (last === null) return;
    closing = true;
    draw({ ...last, closing: true });
    exitTimer = setTimeout(gone, TIP_EXIT_MS);
  };
  /** Takes away, as it is, a tip that was never placed: it was never seen, so it has no exit to run. */
  const drop = (): void => {
    if (unshow() === null) return;
    if (exitTimer !== null) clearTimeout(exitTimer);
    exitTimer = null;
    closing = false;
    draw(null);
  };
  /** The box of a tip that went is taken away: its exit has run, or its fallback time has passed. */
  const gone = (): void => {
    if (exitTimer !== null) clearTimeout(exitTimer);
    exitTimer = null;
    if (shown !== null || !closing) return;   // a new tip took its place
    closing = false;
    draw(null);
  };

  const place = (): void => {
    const t = shown, el = box();
    if (t === null || el === null) return;
    const anchor = t.mode === 'pointer' ? { left: t.x, right: t.x, top: t.y, bottom: t.y } : anchorBox(t.anchor);
    if (anchor === null) {
      // its element has left its svg's view: a tip never placed yet goes as it is, before it is painted; one that showed fades
      if (placed === '') drop();
      else hide();
      return;
    }
    const room = { width: document.documentElement.clientWidth, height: document.documentElement.clientHeight };
    const { left, top } = placeTip(anchor, { width: el.offsetWidth, height: el.offsetHeight }, room, t.mode === 'pointer' ? 'pointer' : t.mode === 'touch' ? 'above' : 'below');
    const at = `${left} ${top}`;
    if (at === placed) return;
    placed = at;
    el.style.left = `${left}px`;
    el.style.top = `${top}px`;
  };

  /** Once a frame while a tip shows: gone with its trigger, its lines read again, a focus or touch tip kept at its element. */
  const watch = (): void => {
    frame = null;
    const t = shown;
    if (t === null) return;
    if (!t.trigger.isConnected || !t.anchor.isConnected) {
      hide();
      return;
    }
    const text = t.trigger.getAttribute(TIP_ATTR) ?? '';
    const mod = t.trigger.getAttribute(TIP_MOD_ATTR) || null;
    if (text !== shownText || mod !== t.mod) {
      const lines = tipLines(text);
      if (lines.length === 0) {
        hide();
        return;
      }
      undescribe();
      const named = describe(lines, mod, t.mode === 'focus' ? t.anchor : t.trigger);
      shown = { ...t, lines, mod, named };
      shownText = text;
      draw(shown);                                 // the layout effect places it again, at its new size
    } else if (t.mode !== 'pointer') {
      place();
      if (shown === null) return;                  // its element has left the svg's view
    }
    frame = requestAnimationFrame(watch);
  };

  /** A shown pointer tip follows the pointer, once a frame. */
  const follow = frameThrottle<{ x: number; y: number }>((at) => {
    if (shown === null || shown.mode !== 'pointer') return;
    shown = { ...shown, x: at.x, y: at.y };
    place();
  });

  // the mouse or a pen resting on a trigger, and the keyboard's focus on an element in one
  const rest = createRestTimer<Element>((trigger) => {
    if (trigger === null) {
      if (shown?.mode === 'pointer') hide();
      return;
    }
    // the pointer is still on it: a scroll or a replan may have moved something else under it since
    if (trigger.contains(document.elementFromPoint(pointer.x, pointer.y))) show(trigger, trigger, 'pointer');
  });
  const focusRest = createRestTimer<Element>((el) => {
    if (el === null) {
      if (shown?.mode === 'focus') hide();
      return;
    }
    const trigger = triggerOf(el);
    if (trigger !== null && !quiet.has(trigger) && el === document.activeElement) show(trigger, el, 'focus');
  });

  /** The pointer waits on what it is over again, as after a move onto it. */
  const restOnHovered = (): void => {
    rest.clear();
    if (hovered !== null && hovered.isConnected && !quiet.has(hovered)) rest.move(hovered);
  };

  const onPointerOver = (e: PointerEvent): void => {
    if (!hoverFrom(e.pointerType)) return;               // a finger hovers nothing
    pointer = { x: e.clientX, y: e.clientY };
    const trigger = triggerOf(e.target);
    if (trigger !== hovered) {
      if (hovered !== null) quiet.delete(hovered);       // the pointer has left it
      hovered = trigger;
    }
    if (trigger === null || quiet.has(trigger)) rest.clear();
    else rest.move(trigger);
  };
  const onPointerOut = (e: PointerEvent): void => {
    if (!hoverFrom(e.pointerType) || e.relatedTarget !== null) return;   // onto another element: its pointerover decides
    if (hovered !== null) quiet.delete(hovered);        // out of the window
    hovered = null;
    rest.clear();
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (hoverFrom(e.pointerType)) {
      pointer = { x: e.clientX, y: e.clientY };
      if (shown?.mode === 'pointer') follow.push(pointer);
      return;
    }
    const p = press;
    if (p === null || e.pointerId !== p.id || p.moved || Math.hypot(e.clientX - p.x, e.clientY - p.y) < DRAG_THRESHOLD) return;
    p.moved = true;                                     // a drag or a scroll: no tap, and no long press
    if (p.timer !== null) clearTimeout(p.timer);
    p.timer = null;
  };

  const disarm = (): void => {
    guard.contextmenu = false;
    guard.click = false;
    if (guard.timer !== null) clearTimeout(guard.timer);
    guard.timer = null;
  };
  const disarmLater = (): void => {
    if (guard.timer !== null) clearTimeout(guard.timer);
    guard.timer = setTimeout(disarm, LONG_PRESS_CLICK_MS);
  };
  const longPress = (): void => {
    const p = press;
    if (p === null || p.trigger === null || p.long || p.moved) return;
    if (p.timer !== null) clearTimeout(p.timer);
    p.timer = null;
    p.long = true;
    guard.contextmenu = true;
    guard.click = true;
    show(p.trigger, p.trigger, 'touch');
  };

  const onPointerDown = (e: PointerEvent): void => {
    disarm();                                           // the next press lets go of a long press's guards
    if (hoverFrom(e.pointerType)) {
      // a press hides the tip, and its trigger stays quiet until the pointer leaves it (a native title's way)
      rest.clear();
      hide();
      const trigger = triggerOf(e.target);
      if (trigger !== null) quiet.add(trigger);
      return;
    }
    if (e.pointerType !== 'touch') return;
    if (press !== null && press.timer !== null) clearTimeout(press.timer);
    const target = e.target instanceof Element ? e.target : null;
    const trigger = triggerOf(target);
    const wasShown = trigger !== null && shown?.trigger === trigger;
    hide();                                             // a tap anywhere hides a tip: a second one on its trigger, or one elsewhere
    press = {
      id: e.pointerId, x: e.clientX, y: e.clientY, target, trigger, wasShown, moved: false, long: false,
      timer: trigger === null ? null : setTimeout(longPress, LONG_PRESS_MS),
    };
  };
  const onPointerUp = (e: PointerEvent): void => {
    const p = press;
    if (e.pointerType !== 'touch' || p === null || e.pointerId !== p.id) return;
    press = null;
    if (p.timer !== null) clearTimeout(p.timer);
    if (p.long) {
      disarmLater();
      return;
    }
    if (p.moved || p.wasShown || p.target === null || p.trigger === null || !p.trigger.isConnected) return;
    const { path, above } = tapPath(p.target, p.trigger);
    if (tapActs(path, above)) return;                   // where a tap acts, it only acts: on the trigger, in it, or round it (P2-R20)
    show(p.trigger, p.trigger, 'touch');
  };
  const onPointerCancel = (e: PointerEvent): void => {
    const p = press;
    if (p === null || e.pointerId !== p.id) return;
    press = null;
    if (p.timer !== null) clearTimeout(p.timer);
    if (p.long) disarmLater();
  };
  const onContextMenu = (e: MouseEvent): void => {
    // the browser's own long press may come before ours: a context menu while a finger rests on a trigger is the long press
    if (press !== null && press.trigger !== null && !press.long && !press.moved) longPress();
    if (!guard.contextmenu) return;
    guard.contextmenu = false;
    e.preventDefault();
  };
  const onClick = (e: MouseEvent): void => {
    if (!guard.click) return;
    guard.click = false;                                // the long press's own click: it neither ticks nor picks
    e.preventDefault();
    e.stopPropagation();
  };

  const onKeyDown = (e: KeyboardEvent): void => {
    if (e.key === 'Escape' && !e.defaultPrevented) {   // a layer above the tip has taken it: not the tip's either (P2-R21b)
      const t = shown;
      if (t === null) return;                           // no tip shows: the key is not the tip's
      // quiet until the pointer leaves it or the focus moves; a finger leaves nothing, and its next tap may show the tip again
      if (t.mode !== 'touch') quiet.add(t.trigger);
      if (t.mode === 'pointer') rest.clear();
      if (t.mode === 'focus') focusRest.clear();
      hide();
      e.preventDefault();                               // one layer per press; never stopPropagation (P2-D22)
      return;
    }
    if ((e.key === 'Enter' || e.key === ' ') && focused !== null && e.target === focused) {
      const trigger = triggerOf(focused);
      if (trigger === null) return;
      quiet.add(trigger);                               // until the focus moves
      focusRest.clear();
      if (shown?.mode === 'focus' && shown.anchor === focused) hide();
    }
  };

  /** The focus waits on the focused element again, if the keyboard put it there (`:focus-visible`) in a trigger that is not quiet. */
  const restOnFocused = (): void => {
    focusRest.clear();
    const el = focused;
    const trigger = triggerOf(el);
    if (el !== null && trigger !== null && !quiet.has(trigger) && el === document.activeElement && el.matches(':focus-visible')) focusRest.move(el);
  };

  const onFocusIn = (e: FocusEvent): void => {
    focused = e.target instanceof Element ? e.target : null;
    restOnFocused();
  };
  const onFocusOut = (e: FocusEvent): void => {
    const trigger = triggerOf(e.target);
    if (trigger !== null && trigger !== hovered) quiet.delete(trigger);   // the focus has moved; a trigger the pointer is on stays quiet
    if (focused === e.target) focused = null;
    focusRest.clear();
  };

  /**
   * The page moved under the tip or the window went away: the tip goes. After a scroll, the wheel or a resize the pointer and the focus
   * wait again on what they are on (a focus the browser scrolls into view still shows its tip), and the tip comes back once they rest.
   */
  const onMoved = (): void => {
    hide();
    restOnHovered();
    restOnFocused();
  };
  const onAway = (): void => {
    rest.clear();
    focusRest.clear();
    hide();
  };
  const onBlur = (e: FocusEvent): void => {
    if (e.target === window) onAway();
  };
  const onVisibility = (): void => onAway();

  // A press, a key and a long press's click are heard in the capture phase, before what they land on (and before React's root) acts on
  // them; a scroll anywhere is heard on the way down too, as scroll events do not bubble.
  const CAPTURE = { capture: true };
  const listeners: Array<[EventTarget, string, EventListener, AddEventListenerOptions?]> = [
    [document, 'pointerover', onPointerOver as EventListener], [document, 'pointerout', onPointerOut as EventListener],
    [document, 'pointermove', onPointerMove as EventListener], [document, 'pointerdown', onPointerDown as EventListener, CAPTURE],
    [document, 'pointerup', onPointerUp as EventListener, CAPTURE], [document, 'pointercancel', onPointerCancel as EventListener, CAPTURE],
    [document, 'contextmenu', onContextMenu as EventListener, CAPTURE], [document, 'click', onClick as EventListener, CAPTURE],
    [document, 'keydown', onKeyDown as EventListener, CAPTURE], [document, 'focusin', onFocusIn as EventListener],
    [document, 'focusout', onFocusOut as EventListener], [document, 'visibilitychange', onVisibility],
    [window, 'scroll', onMoved, { capture: true, passive: true }], [window, 'wheel', onMoved, { passive: true }], [window, 'resize', onMoved],
    [window, 'blur', onBlur as EventListener],
  ];
  for (const [target, type, listener, options] of listeners) target.addEventListener(type, listener, options);

  return {
    place,
    gone,
    stop() {
      for (const [target, type, listener, options] of listeners) target.removeEventListener(type, listener, options);
      rest.clear();
      focusRest.clear();
      follow.cancel();
      if (press !== null && press.timer !== null) clearTimeout(press.timer);
      press = null;
      disarm();
      undescribe();
      if (frame !== null) cancelAnimationFrame(frame);
      frame = null;
      if (exitTimer !== null) clearTimeout(exitTimer);
      exitTimer = null;
      shown = null;
    },
  };
}

/**
 * The page's one NEI tooltip (spec §6): its listeners on the document, and its box in a portal on <body> while a tip shows or goes. The
 * App mounts it once, after the name prompt.
 */
export function TooltipHost(): ReactElement | null {
  const id = useId();
  const [tip, setTip] = useState<TipState | null>(null);
  const box = useRef<HTMLDivElement | null>(null);
  const host = useRef<Host | null>(null);

  useEffect(() => {
    const started = startHost(id, setTip, () => box.current);
    host.current = started;
    return () => {
      host.current = null;
      started.stop();
    };
  }, [id]);

  // placed before it is painted, at its own size (MapView places the map's tooltip the same way)
  useLayoutEffect(() => {
    if (tip !== null && !tip.closing) host.current?.place();
  }, [tip]);

  if (tip === null) return null;
  return createPortal(
    <div
      ref={box}
      id={id}
      {...(tip.closing ? { 'aria-hidden': true } : { role: 'tooltip' })}
      className="nei-tooltip"
      data-state={tip.closing ? 'closing' : 'open'}
      onAnimationEnd={(e) => {
        if (e.animationName === 'tip-out') host.current?.gone();
      }}
    >
      <TipLines lines={tip.lines} mod={tip.mod} name={tip.named} />
    </div>,
    document.body,
  );
}
