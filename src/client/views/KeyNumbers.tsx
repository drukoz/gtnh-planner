// The key-numbers strip (Phase 2 spec §10, D12): five readout tiles at the top of the banners' box — what the line makes, its peak power,
// its machines and the raw material to build and to run it (key-numbers.ts) — each a label with its qualifier over a figure in VT323. A
// changed figure counts up from the one shown over 400 ms, re-rendered from state frame by frame (P2-D41, so the server's markup and React
// both hold the final figure), and its tile flashes once; it shows at once on its first render, under reduced motion, as a dash or in words,
// and when its unit changes. A screen reader hears the final figure only: the counting one is aria-hidden beside a visually hidden copy of
// it, and the strip is no live region (the plan banner's status and What changed say what changed). A project with no target has no strip;
// while its plan is on its way an empty box keeps the strip's place, so nothing below moves when the figures come (Task 8 draws its skeleton
// there). It sits in the banners' box, so it goes inert with them behind an open drawer.

import { useEffect, useState, type ReactElement } from 'react';
import type { Plan, PlanSettings } from '../../shared/types/plan.ts';
import { prefersReducedMotion } from '../state/motion.ts';
import { COUNT_UP_MS, compactNumber, countUpAt, keyNumbers, type KeyNumber } from './key-numbers.ts';

/** A figure counting up: the figure it set out `from`, the one it goes `to`, the unit it is in, and the figure `shown` now. */
interface Count { from: number | null; to: number | null; unit: string; shown: number | null }

/**
 * The figure to show for `target`, which counts up to a new target from the figure shown when it came, over `ms` by animation frames, easing
 * out (`countUpAt`); between two whole figures it shows whole ones. It shows the target at once on its first render, under reduced motion
 * (asked at each change), for a null target or from a null one, and when the unit changes, which makes the two figures different things.
 */
export function useCountUp(target: number | null, unit: string, ms = COUNT_UP_MS): number | null {
  const [count, setCount] = useState<Count>(() => ({ from: target, to: target, unit, shown: target }));
  let current = count;
  if (!Object.is(count.to, target) || count.unit !== unit) {
    // a new target, set while rendering (React renders again at once, before anything is drawn), so no frame shows the old figure as final
    const instant = target === null || count.shown === null || count.unit !== unit || prefersReducedMotion();
    current = { from: instant ? target : count.shown, to: target, unit, shown: instant ? target : count.shown };
    setCount(current);
  }
  const { from, to } = current;
  useEffect(() => {
    if (from === null || to === null || Object.is(from, to)) return;
    const whole = Number.isInteger(from) && Number.isInteger(to);
    let start: number | null = null;
    let frame = requestAnimationFrame(function tick(now: number): void {
      start ??= now;
      const elapsed = now - start;
      const value = countUpAt(from, to, elapsed, ms);
      setCount((c) => (Object.is(c.from, from) && Object.is(c.to, to) ? { ...c, shown: whole ? Math.round(value) : value } : c));
      if (elapsed < ms) frame = requestAnimationFrame(tick);
    });
    return () => cancelAnimationFrame(frame);
  }, [from, to, ms]);
  return current.shown;
}

/**
 * A tile's flash: the text it last showed, how many times that changed (which keys the frame, so each change replays it), and whether the
 * frame still runs.
 */
interface Flash { text: string; changes: number; running: boolean }

/**
 * One tile: its label and qualifier, then its figure counting up (aria-hidden), the final figure for a screen reader, and its unit. A change
 * of the text it shows (after its first render) flashes it: the tile is `changed` (its qualifier yellow) until its frame's fade ends.
 */
function KeyNumberTile(props: { n: KeyNumber }): ReactElement {
  const { n } = props;
  const shown = useCountUp(n.value, n.unit);
  const [flash, setFlash] = useState<Flash>({ text: n.text, changes: 0, running: false });
  if (flash.text !== n.text) setFlash({ text: n.text, changes: flash.changes + 1, running: true });
  const counting = shown !== null && n.value !== null && shown !== n.value;
  return (
    <div className={flash.running ? 'key-number changed' : 'key-number'} data-key-number={n.id}>
      <dt><span>{n.label}</span>{n.sub !== '' && <span className="key-number-sub">{n.sub}</span>}</dt>
      <dd className={n.words === true ? 'key-number-words' : undefined}>
        <span aria-hidden="true">{counting ? compactNumber(shown) : n.text}</span>
        <span className="visually-hidden">{n.text}</span>
        {n.unit !== '' && <span className="key-number-unit">{n.unit}</span>}
      </dd>
      {flash.changes > 0 && (
        <span key={flash.changes} className="key-number-flash" aria-hidden="true" onAnimationEnd={() => setFlash((f) => ({ ...f, running: false }))} />
      )}
    </div>
  );
}

/** The strip for a project's plan: nothing without a target, an empty box of its height while the plan is on its way, else the five tiles. */
export function KeyNumbers(props: { plan: Plan | null; settings: PlanSettings }): ReactElement | null {
  const { plan, settings } = props;
  if (settings.target === null) return null;
  const numbers = keyNumbers(plan, settings);
  if (numbers === null) return <div className="key-numbers-wait" aria-hidden="true" />;
  return (
    <section className="key-numbers" aria-label="Key numbers">
      <dl>{numbers.map((n) => <KeyNumberTile key={n.id} n={n} />)}</dl>
    </section>
  );
}
