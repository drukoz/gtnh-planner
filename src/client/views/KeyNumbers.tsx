// The key-numbers strip (Phase 2 spec §10, D12): five readout tiles at the top of the banners' box — what the line makes, its peak power,
// its machines and the raw material to build and to run it (key-numbers.ts) — each a label with its qualifier over a figure in VT323. A
// changed figure counts up from the one shown over 400 ms, re-rendered from state frame by frame (P2-D41, so the server's markup and React
// both hold the final figure), and its tile flashes once; it shows at once on its first render, under reduced motion, as a dash or in
// words, and when its unit changes (a figure in another unit is another figure: it neither counts nor flashes). The rate is shown in the
// unit its plan was made in, which the strip knows from the settings it drew (ledger ruling P2-R49). A screen reader hears the final figure
// only, exact: the counting one is aria-hidden beside a visually hidden copy, with every qualifier of the plan's cost sentence, which is
// then hidden from a screen reader (fix round 1, I2 and M2); the strip is no live region (the plan banner's status and What changed say
// what changed). A project with no target has no strip; while its plan is on its way the strip's own grid of five empty blocks keeps its
// place at every width, so nothing below moves when the figures come (ledger ruling P2-R48): the strip's skeleton, whose blocks are that
// grid's (Phase 2 spec §11.1), in the tiles' own dark face (ledger ruling P2-R53). It sits in the banners' box, so it goes inert with them
// behind an open drawer, and the plan's busy line sits on its top-right corner (ledger ruling P2-R51).

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Plan, PlanSettings } from '../../shared/types/plan.ts';
import { Skeleton } from '../components/Skeleton.tsx';
import { prefersReducedMotion } from '../state/motion.ts';
import {
  COUNT_UP_MS, compactNumber, countUpAt, keyNumbers, nextCount, nextFlash, planUnit, type Count, type Flash, type KeyNumber,
} from './key-numbers.ts';

/**
 * The figure to show for `target`, which counts up to a new target from the figure shown when it came, over `ms` by animation frames, easing
 * out (`countUpAt`); between two whole figures it shows whole ones. It shows the target at once on its first render, under reduced motion
 * (asked at each change), for a null target or from a null one, and when the unit changes, which makes the two figures different things
 * (`nextCount`, the step it takes).
 */
export function useCountUp(target: number | null, unit: string, ms = COUNT_UP_MS): number | null {
  const [count, setCount] = useState<Count>(() => ({ from: target, to: target, unit, shown: target }));
  const current = nextCount(count, target, unit, prefersReducedMotion);
  // a new target, set while rendering (React renders again at once, before anything is drawn), so no frame shows the old figure as final
  if (current !== count) setCount(current);
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
 * One tile: its label, its qualifier and what else qualifies it (visually hidden), then its figure counting up (aria-hidden), the exact
 * final figure for a screen reader, and its unit. A change of the text it shows (after its first render) flashes it, but for a figure in
 * another unit (`nextFlash`): the tile is `changed` (its qualifier yellow) until its frame's fade ends. The frame is the label row's last
 * child, as a dl's group holds only its dt and dd (fix round 1, M1); it is drawn against the tile, over its edge.
 */
function KeyNumberTile(props: { n: KeyNumber }): ReactElement {
  const { n } = props;
  const shown = useCountUp(n.value, n.unit);
  const [last, setFlash] = useState<Flash>(() => ({ text: n.text, unit: n.unit, figure: n.value !== null, changes: 0, running: false }));
  const flash = nextFlash(last, n);
  if (flash !== last) setFlash(flash);   // set while rendering, as useCountUp's step is
  const counting = shown !== null && n.value !== null && shown !== n.value;
  return (
    <div className={flash.running ? 'key-number changed' : 'key-number'} data-key-number={n.id}>
      <dt>
        <span>{n.label}</span>
        {n.sub !== '' && <span className="key-number-sub">{n.sub}</span>}
        {n.more !== undefined && <span className="visually-hidden">{n.more}</span>}
        {flash.changes > 0 && (
          <span key={flash.changes} className="key-number-flash" aria-hidden="true" onAnimationEnd={() => setFlash((f) => ({ ...f, running: false }))} />
        )}
      </dt>
      <dd className={n.words === true ? 'key-number-words' : undefined}>
        <span aria-hidden="true">{counting ? compactNumber(shown) : n.text}</span>
        <span className="visually-hidden">{n.spoken}</span>
        {n.unit !== '' && <span className="key-number-unit">{n.unit}</span>}
      </dd>
    </div>
  );
}

/**
 * The strip for a project's plan: nothing without a target; while the plan is on its way, its own grid of five empty blocks as tall as a
 * tile, so it takes the strip's height at every width (ledger ruling P2-R48), the strip's skeleton, which draws no box of its own; else the
 * five tiles, the rate in the unit of the settings the plan was made for, which it remembers of every settings state it draws (`planUnit`,
 * ledger ruling P2-R49).
 */
export function KeyNumbers(props: { plan: Plan | null; settings: PlanSettings }): ReactElement | null {
  const { plan, settings } = props;
  const units = useRef<Map<string, PlanSettings['per']> | null>(null);
  units.current ??= new Map();   // made once, on the first render
  const planned = planUnit(units.current, settings, plan);
  if (settings.target === null) return null;
  const numbers = keyNumbers(plan, settings, planned);
  if (numbers === null) {
    return (
      <div className="key-numbers-wait" aria-hidden="true">
        <Skeleton shape="strip" />
      </div>
    );
  }
  return (
    <section className="key-numbers" aria-label="Key numbers">
      <dl>{numbers.map((n) => <KeyNumberTile key={n.id} n={n} />)}</dl>
    </section>
  );
}
