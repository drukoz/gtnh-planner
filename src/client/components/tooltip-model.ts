// The shared NEI tooltip's pure parts (Phase 2 spec §6): the trigger contract, where a tip goes, the rest before it shows, which taps act
// and which show a tip, and the one re-placement a frame. TooltipHost (Tooltip.tsx) holds the listeners and draws the box; everything here
// runs without a DOM, so the client tests run it as it is.
//
// The trigger contract: an element opts in with `data-tip`, its lines joined by '\n' (the first is the title), and may add `data-tip-mod`,
// a mod line. From the element under the pointer, the one focused or the one touched, `closest('[data-tip]')` finds the trigger, so the
// innermost trigger wins, on HTML and SVG alike.

import { HOVER_DELAY_MS } from '../map/hover.ts';

/** The attribute that holds a trigger's lines, joined by '\n'. */
export const TIP_ATTR = 'data-tip';
/** The optional attribute that holds a trigger's mod line. */
export const TIP_MOD_ATTR = 'data-tip-mod';
/** How long (ms) the pointer or the focus rests on a trigger before its tip shows: the map's wait. */
export const TIP_DELAY_MS = HOVER_DELAY_MS;
/** The gap (px) between a pointer tip and the pointer: MapTooltip's TOOLTIP_OFFSET. */
export const TIP_OFFSET = 12;
/** The gap (px) between an element tip and the element. */
export const TIP_ELEMENT_GAP = 4;
/** How long (ms) a finger rests within DRAG_THRESHOLD before the press is a long press, which shows the tip. */
export const LONG_PRESS_MS = 500;
/** How long (ms) after a long press ends its click is still the press's own, and is kept from what was pressed. */
export const LONG_PRESS_CLICK_MS = 400;
/** The longest (ms) a closing tip stays drawn: its exit runs 80 ms, and this is the fallback when no animationend comes. */
export const TIP_EXIT_MS = 100;

/** The `data-tip` value of `lines`: the non-empty ones joined by '\n'; undefined when none is left (React then writes no attribute). */
export function tipText(lines: ReadonlyArray<string | undefined>): string | undefined {
  const kept = lines.filter((line): line is string => line !== undefined && line !== '');
  return kept.length === 0 ? undefined : kept.join('\n');
}

/** The lines of a `data-tip` value, each trimmed, the empty ones dropped; none for a missing attribute. */
export function tipLines(text: string | null): string[] {
  if (text === null) return [];
  return text.split('\n').map((line) => line.trim()).filter((line) => line !== '');
}

/**
 * Along one axis, for a box of `size` beside `[start, end]` in `[0, room]`: `gap` past `end` when it fits there, else `gap` before
 * `start` when it fits there (`prefer: 'before'` tries the other way round first), then kept inside the room. MapTooltip's rule, which
 * keeps what the box is beside readable; with `gap` 12 and `'after'` it is MapTooltip's own.
 */
export function alongAxis(start: number, end: number, size: number, room: number, gap: number = TIP_OFFSET, prefer: 'after' | 'before' = 'after'): number {
  const after = end + gap, before = start - gap - size;
  const fitsAfter = after + size <= room, fitsBefore = before >= 0;
  const at = prefer === 'after' ? (fitsAfter || !fitsBefore ? after : before) : (fitsBefore || !fitsAfter ? before : after);
  return Math.max(0, Math.min(at, room - size));
}

/** What a tip is placed beside, in window px: a zero-size box at the pointer, or an element's box. */
export interface TipAnchor { left: number; top: number; right: number; bottom: number }
/** The size of a tip, or of the window that holds it (px). */
export interface Size { width: number; height: number }
/** Beside the pointer, right of and below it (hover); at an element's left edge, below it first (focus) or above it first (touch). */
export type TipPlacement = 'pointer' | 'below' | 'above';

/**
 * What of an element's box `own` is in view, where an element tip is placed: `own` cut to each of `views` (its outermost svg's box and
 * the window), or null when none of it is, and the tip then does not show (spec §6.2; ledger ruling P2-R23 and Task 3b's fix round, M1
 * and M2). A box needs some of its area in view, so one that only touches a view's edge is not; a line (a Flow arrow that runs straight
 * has a box with no height) needs some of its length; a point is never in view.
 */
export function inView(own: TipAnchor, views: readonly TipAnchor[]): TipAnchor | null {
  let box = own;
  for (const view of views) {
    box = { left: Math.max(box.left, view.left), top: Math.max(box.top, view.top), right: Math.min(box.right, view.right), bottom: Math.min(box.bottom, view.bottom) };
  }
  const across = box.right - box.left, down = box.bottom - box.top;
  const level = own.top === own.bottom, upright = own.left === own.right;
  if (level && upright) return null;
  if (level) return across > 0 && down === 0 ? box : null;
  if (upright) return down > 0 && across === 0 ? box : null;
  return across > 0 && down > 0 ? box : null;
}

/**
 * The top-left corner (window px) of a tip of `size` in a window of `room`: a pointer tip TIP_OFFSET right of and below the pointer,
 * flipped and kept inside the window, so the row under the pointer stays readable (P2-D36); an element tip at the element's left edge
 * (kept inside), TIP_ELEMENT_GAP below it, or above it when there is no room below ('above': above first).
 */
export function placeTip(anchor: TipAnchor, size: Size, room: Size, placement: TipPlacement): { left: number; top: number } {
  if (placement === 'pointer') {
    return { left: alongAxis(anchor.left, anchor.right, size.width, room.width), top: alongAxis(anchor.top, anchor.bottom, size.height, room.height) };
  }
  return {
    left: Math.max(0, Math.min(anchor.left, room.width - size.width)),
    top: alongAxis(anchor.top, anchor.bottom, size.height, room.height, TIP_ELEMENT_GAP, placement === 'below' ? 'after' : 'before'),
  };
}

export interface RestTimer<T> {
  /** On `target`: another target than the last hides its tip at once and waits again; the same one keeps its tip, or its wait. */
  move(target: T): void;
  /** Shows `target` at once (a tap): another target's tip is hidden first; the one shown stays. */
  now(target: T): void;
  /** On nothing (the pointer left, a press, a scroll): hides the tip and drops the wait. */
  clear(): void;
}

/**
 * Calls `show(target)` once the pointer has rested `delayMs` on a target, and `show(null)` as soon as it leaves the target shown: the
 * map's hover timer (`createHoverTimer`, map/hover.ts) on any target, `same` telling two apart. There is one pending wait, restarted only
 * on another target, so however fast the pointer crosses triggers only the one it rests on shows.
 */
export function createRestTimer<T>(show: (target: T | null) => void, delayMs: number = TIP_DELAY_MS, same: (a: T, b: T) => boolean = Object.is): RestTimer<T> {
  let current: { target: T } | null = null;
  let wait: ReturnType<typeof setTimeout> | null = null;
  let shown = false;
  const hide = (): void => {
    if (wait !== null) clearTimeout(wait);
    wait = null;
    if (shown) {
      shown = false;
      show(null);
    }
  };
  return {
    move(target) {
      if (current !== null && same(current.target, target)) return;
      hide();
      current = { target };
      wait = setTimeout(() => {
        wait = null;
        shown = true;
        show(target);
      }, delayMs);
    },
    now(target) {
      if (shown && current !== null && same(current.target, target)) return;
      hide();
      current = { target };
      shown = true;
      show(target);
    },
    clear() {
      hide();
      current = null;
    },
  };
}

/**
 * The parts a text says, in order (ledger ruling P2-R24): split where the views join a name's parts and where a tip starts a line (" · ",
 * ", ", ": ", a new line), each with its runs of white space as one space; a figure's comma ("1,440") splits nothing.
 */
const parts = (text: string): string[] =>
  text.split(/\s+·\s+|[,:]\s+|\n/).map((part) => part.replace(/\s+/g, ' ').trim()).filter((part) => part !== '');

/** Whether two texts' parts are the same, in the same order. */
const same = (a: readonly string[], b: readonly string[]): boolean => a.length === b.length && a.every((part, i) => part === b[i]);

/**
 * Whether a tip says more than `name`, the accessible name of the element it would describe: only then does that element get the tip as
 * its description (`aria-describedby`), so a screen reader never says a name twice (P2-D36). White space and the views' separators do
 * not count (P2-R24).
 */
export function describes(tip: string, name: string | null): boolean {
  return !same(parts(tip), parts(name ?? ''));
}

/**
 * Which of a tip's `lines` only repeat `name`, the accessible name of the element the tip describes (ledger rulings P2-R22, P2-R24, P2-R24c):
 * each line whose parts are all parts of the name, wherever it stands. So a Flow box named by its whole tip, an arrow by its three lines run
 * together and a step head by its title and line have those lines left out; so has an icon its own name, a row its words (its name goes on
 * with what a click on it does), and a recipe slot its good and its chance (P2-R32 names the slot by its good, its amount a run and its
 * chance). A line that says a part in other words ("2× Copper Wire per run" beside the name's "2 per run") stays, and a part counts whole
 * ("Iron" is not "Iron Ingot"). White space and the views' separators do not count.
 */
export function repeatsName(lines: readonly string[], name: string | null): boolean[] {
  const said = new Set(parts(name ?? ''));
  return lines.map((line) => {
    const own = parts(line);
    return own.length > 0 && own.every((part) => said.has(part));
  });
}

/**
 * What a tip says beyond `name`, the accessible name of the element it describes: its lines but those that only repeat the name, then its
 * mod line. That is its description (ledger ruling P2-R22, spec §6.6): an item icon's is its mod ("GregTech"), and none when the tip is the
 * name alone, as an icon's with no mod.
 */
export function describedLines(lines: readonly string[], mod: string | null, name: string | null): string[] {
  const repeats = repeatsName(lines, name);
  return [...lines.filter((_, i) => repeats[i] !== true), ...(mod === null ? [] : [mod])];
}

/** An element on the way from what a tap touched up to its trigger, as `tapActs` reads it. */
export interface TapNode { tag: string; role: string | null; hasHref: boolean; inSvg: boolean }

const ACTING_TAGS = new Set(['button', 'input', 'select', 'textarea', 'summary', 'label']);
const ACTING_ROLES = new Set(['button', 'checkbox', 'radio', 'tab', 'option', 'link']);

/** A link, a button, a field, a summary, a label, or an element with a role that acts. */
function acting(node: TapNode): boolean {
  const tag = node.tag.toLowerCase();
  if (ACTING_TAGS.has(tag) || (tag === 'a' && node.hasHref)) return true;
  return (node.role ?? '').split(/\s+/).some((role) => ACTING_ROLES.has(role));
}

/**
 * Whether a tap does something of its own: an element that acts (a link, a button, a field, a summary, a label or a role that acts) from
 * what it touched up to the trigger (`path`, the trigger last) or above the trigger up to the document's root (`above`: an icon in a search
 * option or a summary), or a trigger in an svg (the diagrams pick on a tap). Where a tap acts it only acts, and a long press or the focus
 * shows the tip instead (P2-D21, ledger ruling P2-R20).
 */
export function tapActs(path: readonly TapNode[], above: readonly TapNode[] = []): boolean {
  return path.some(acting) || above.some(acting) || path[path.length - 1]?.inSvg === true;
}

/** Whether a pointer of this `pointerType` hovers: a mouse or a pen. A finger does not, so touch's pointerover and pointerout do nothing. */
export function hoverFrom(pointerType: string): boolean {
  return pointerType === 'mouse' || pointerType === 'pen';
}

export interface FrameThrottle<T> {
  /** The latest value: it runs at the next frame, with whatever value was pushed last by then. */
  push(value: T): void;
  /** Drops the frame waiting, if any. */
  cancel(): void;
}

/** The window's frames: `requestAnimationFrame` and `cancelAnimationFrame`, read when used (the client tests have no window). */
const WINDOW_FRAMES = {
  request: (cb: () => void): unknown => requestAnimationFrame(cb),
  cancel: (handle: unknown): void => cancelAnimationFrame(handle as number),
};

/** Runs `run` at most once a frame, with the last value pushed: a shown pointer tip follows the pointer at the screen's own rate. */
export function frameThrottle<T>(run: (value: T) => void, frames: { request(cb: () => void): unknown; cancel(handle: unknown): void } = WINDOW_FRAMES): FrameThrottle<T> {
  let pending: { handle: unknown } | null = null;
  let last: { value: T } | null = null;
  return {
    push(value) {
      last = { value };
      if (pending !== null) return;
      pending = {
        handle: frames.request(() => {
          pending = null;
          if (last !== null) run(last.value);
        }),
      };
    },
    cancel() {
      if (pending === null) return;
      frames.cancel(pending.handle);
      pending = null;
    },
  };
}
