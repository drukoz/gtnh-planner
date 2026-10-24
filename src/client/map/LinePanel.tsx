// The Map tab's "New line" panel (spec §3.7): the line summary — new and reused machines, footprint W×L×H, peak EU/t
// and whether the base's power fits the line, with the fit's detail and generator suggestions — the buttons that move,
// turn or re-place the line, its numbered pins (a click shows that pin on the map) and its warnings. A line that is not
// placed in the world, or that has nothing new to build, says so in place of the summary.

import { useId, type ReactElement } from 'react';
import { fmtInt } from '../../shared/layout/format.ts';
import type { Layout } from '../../shared/types/layout.ts';
import type { Plan } from '../../shared/types/plan.ts';
import { Figs } from '../components/Figs.tsx';
import { PIN_COLORS } from './layout-overlay.ts';

export interface LineSummary { newMachines: number; reused: number; footprint: string; peak: string; fits: string; fitsClass: 'yes' | 'tight' | 'no' | 'unknown' }

export interface LinePanelProps {
  layout: Layout | null; plan: Plan | null; loading: boolean; error: string | null; moving: boolean;
  onToggleMove(): void; onRotate(): void; onAutoPlace(): void; onPin(n: number): void;
  /** The pin the map was sent to: its row is marked current (ruling R13 f). */
  focusedPin?: number | null;
}

// The badge's colour is the stylesheet's, from its `data-fits` (`.badge[data-fits=…]`).
const FITS_TEXT: Readonly<Record<LineSummary['fitsClass'], string>> = { yes: 'Fits', tight: 'Tight in rain', no: 'Does not fit', unknown: 'Unknown' };
const LOADING_TEXT = 'Laying out the line…';
const NO_WORLD_TEXT = 'Pick a world scan and base to place the line';
const ALL_OWNED_TEXT = 'Nothing new to build — every step runs on machines you own';
/** An `empty` layout of a plan without steps (no target yet, or none it can make): nobody owns steps that do not exist. */
const NO_STEPS_TEXT = 'Nothing to lay out yet — the plan makes nothing';

/**
 * The owned machines the plan's machine steps reuse, each once (plan 12): the distinct (type, unit) pairs of the steps'
 * `reused.units` and of their `reused.others`, so one machine serving three steps is one, plus the `owned` count of each
 * step that does not say which units it runs on (a plan from before plan 12).
 */
function reusedMachines(plan: Plan | null): number {
  const units = new Set<string>();
  let unnamed = 0;
  for (const s of plan?.steps ?? []) {
    if (s.handCraft) continue;
    if (s.reused?.units === undefined) unnamed += s.owned;
    else for (const u of s.reused.units) units.add(`${s.machine.mteId}:${u}`);
    for (const o of s.reused?.others ?? []) {
      if (o.units === undefined) unnamed += o.count;
      else for (const u of o.units) units.add(`${o.mteId}:${u}`);
    }
  }
  return units.size + unnamed;
}

/**
 * Spec §3.7's line summary: machine blocks of the line (a machine shared by several steps is one block) and one new farm
 * machine per area kept for it (add-on 17: a farm has no blocks, `Layout.reserved`), owned machines the plan's machine
 * steps reuse (each once: `reusedMachines`), the line's world size as W×L×H (x, z, y), the plan's peak (the layout's
 * while there is no plan) and the layout's power fit.
 */
export function lineSummary(layout: Layout, plan: Plan | null): LineSummary {
  const newMachines = layout.blocks.filter((b) => b.role === 'machine').length + (layout.reserved?.length ?? 0);
  const reused = reusedMachines(plan);
  const [w, h, l] = layout.size;
  const peakEUt = plan?.power.peakEUt ?? layout.power?.peakEUt;
  const fitsClass = layout.power?.fits ?? 'unknown';
  return {
    newMachines, reused, footprint: `${w}×${l}×${h}`, peak: peakEUt === undefined ? 'Unknown' : `${fmtInt(peakEUt)} EU/t`,
    fits: FITS_TEXT[fitsClass], fitsClass,
  };
}

function Summary(props: { layout: Layout; plan: Plan | null }): ReactElement {
  const { layout, plan } = props;
  const s = lineSummary(layout, plan);
  const suggestions = layout.power?.suggestions ?? [];
  return (
    <>
      <p>{`Machines: ${fmtInt(s.newMachines)} new, ${fmtInt(s.reused)} reused`}</p>
      <p>{`Footprint: ${s.footprint}`} <span className="muted small">(W×L×H)</span></p>
      <p>{`Peak: ${s.peak}`}</p>
      <p>
        {'Power: '}
        <span className="badge" data-fits={s.fitsClass}>{s.fits}</span>
      </p>
      {layout.power?.detail !== undefined && <p className="muted small">{layout.power.detail}</p>}
      {suggestions.length > 0 && (
        <ul className="small">
          {suggestions.map((text, i) => <li key={`${i}|${text}`}>{text}</li>)}
        </ul>
      )}
    </>
  );
}

function Pins(props: { layout: Layout; focusedPin: number | null; onPin(n: number): void }): ReactElement | null {
  const { layout, focusedPin, onPin } = props;
  if (layout.pins.length === 0) return null;
  const pins = [...layout.pins].sort((a, b) => a.n - b.n);
  return (
    <>
      <h4>Pins</h4>
      <ol className="small map-list">
        {pins.map((p) => {
          const focused = p.n === focusedPin;
          return (
            <li key={p.n} data-testid={`pin-${p.n}`} className={focused ? 'focused' : undefined} aria-current={focused ? 'true' : undefined}>
              <button type="button" className="small map-row-button" onClick={() => onPin(p.n)}>
                <span aria-hidden="true" className="pin-dot" style={{ background: PIN_COLORS[p.kind] }} />
                {`${p.n}. ${p.text}`}
              </button>
            </li>
          );
        })}
      </ol>
    </>
  );
}

function Warnings(props: { layout: Layout }): ReactElement | null {
  const { warnings } = props.layout;
  if (warnings.length === 0) return null;
  return (
    <>
      <h4>Warnings</h4>
      <ul className="small">
        {warnings.map((w, i) => <li key={`${w.code}:${i}`}>{w.text}</li>)}
      </ul>
    </>
  );
}

function Body(props: LinePanelProps & { layout: Layout }): ReactElement {
  const { layout, plan, moving, onToggleMove, onRotate, onAutoPlace, onPin } = props;
  if (layout.status === 'no-world') return <p className="muted">{NO_WORLD_TEXT}</p>;
  const pins = <Pins layout={layout} focusedPin={props.focusedPin ?? null} onPin={onPin} />;
  if (layout.status === 'empty') {
    return (
      <>
        <p className="muted">{plan !== null && plan.steps.length === 0 ? NO_STEPS_TEXT : ALL_OWNED_TEXT}</p>
        {pins}
        <Warnings layout={layout} />
      </>
    );
  }
  return (
    <>
      <Summary layout={layout} plan={plan} />
      <div className="row line-actions">
        <button type="button" className={moving ? 'small primary' : 'small'} aria-pressed={moving} onClick={onToggleMove}>Move line</button>
        <button type="button" className="small" onClick={onRotate}><Figs text="Rotate 90°" /></button>
        <button type="button" className="small" onClick={onAutoPlace}>Auto place</button>
      </div>
      {moving && <p className="muted small">Drag the line on the map to where it should go.</p>}
      {pins}
      <Warnings layout={layout} />
    </>
  );
}

export function LinePanel(props: LinePanelProps): ReactElement {
  const { layout, loading, error } = props;
  const headingId = useId();
  return (
    <section className="line-panel" data-testid="line-panel" aria-labelledby={headingId}>
      <h3 id={headingId}>New line</h3>
      {error !== null && <p className="error small">{error}</p>}
      {loading && <p className="muted small">{LOADING_TEXT}</p>}
      {layout !== null && <Body {...props} layout={layout} />}
    </section>
  );
}
