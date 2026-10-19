// The Map tab's "New line" panel (spec §3.7): the line summary — new and reused machines, footprint W×L×H, peak EU/t
// and whether the base's power fits the line, with the fit's detail and generator suggestions — the buttons that move,
// turn or re-place the line, its numbered pins (a click shows that pin on the map) and its warnings. A line that is not
// placed in the world, or that has nothing new to build, says so in place of the summary.

import { useId, type CSSProperties, type ReactElement } from 'react';
import { fmtInt } from '../../shared/layout/format.ts';
import type { Layout } from '../../shared/types/layout.ts';
import type { Plan } from '../../shared/types/plan.ts';
import { PIN_COLORS } from './layout-overlay.ts';

export interface LineSummary { newMachines: number; reused: number; footprint: string; peak: string; fits: string; fitsClass: 'yes' | 'tight' | 'no' | 'unknown' }

export interface LinePanelProps {
  layout: Layout | null; plan: Plan | null; loading: boolean; error: string | null; moving: boolean;
  onToggleMove(): void; onRotate(): void; onAutoPlace(): void; onPin(n: number): void;
  /** The pin the map was sent to: its row is marked current (ruling R13 f). */
  focusedPin?: number | null;
}

const FITS_TEXT: Readonly<Record<LineSummary['fitsClass'], string>> = { yes: 'Fits', tight: 'Tight in rain', no: 'Does not fit', unknown: 'Unknown' };
const FITS_STYLE: Readonly<Record<LineSummary['fitsClass'], CSSProperties>> = {
  yes: { color: 'var(--ok)', borderColor: 'var(--ok)' },
  tight: { background: 'var(--warn-bg)', borderColor: 'var(--warn-border)' },
  no: { color: 'var(--error)', background: 'var(--error-bg)', borderColor: 'var(--error)' },
  unknown: {},
};
const LOADING_TEXT = 'Laying out the line…';
const NO_WORLD_TEXT = 'Pick a world scan and base to place the line';
const ALL_OWNED_TEXT = 'Nothing new to build — every step runs on machines you own';
/** An `empty` layout of a plan without steps (no target yet, or none it can make): nobody owns steps that do not exist. */
const NO_STEPS_TEXT = 'Nothing to lay out yet — the plan makes nothing';

const LIST_STYLE = { margin: 0, paddingLeft: 18 } as const;
const PLAIN_LIST_STYLE = { margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 2 } as const;
const SUBHEAD_STYLE = { margin: '4px 0 0', fontSize: '0.85rem' } as const;
const DOT_STYLE = { display: 'inline-block', width: 10, height: 10, borderRadius: '50%', marginRight: 6, verticalAlign: 'middle' } as const;

/**
 * Spec §3.7's line summary: machine blocks of the line, owned machines the plan's machine steps reuse, the line's world
 * size as W×L×H (x, z, y), the plan's peak (the layout's while there is no plan) and the layout's power fit.
 */
export function lineSummary(layout: Layout, plan: Plan | null): LineSummary {
  const newMachines = layout.blocks.filter((b) => b.role === 'machine').length;
  const reused = (plan?.steps ?? []).reduce((sum, s) => (s.handCraft ? sum : sum + s.owned), 0);
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
      <p style={{ margin: 0 }}>{`Machines: ${fmtInt(s.newMachines)} new, ${fmtInt(s.reused)} reused`}</p>
      <p style={{ margin: 0 }}>{`Footprint: ${s.footprint}`} <span className="muted small">(W×L×H)</span></p>
      <p style={{ margin: 0 }}>{`Peak: ${s.peak}`}</p>
      <p style={{ margin: 0 }}>
        {'Power: '}
        <span className="badge" data-fits={s.fitsClass} style={FITS_STYLE[s.fitsClass]}>{s.fits}</span>
      </p>
      {layout.power?.detail !== undefined && <p className="muted small" style={{ margin: 0 }}>{layout.power.detail}</p>}
      {suggestions.length > 0 && (
        <ul className="small" style={LIST_STYLE}>
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
      <h4 style={SUBHEAD_STYLE}>Pins</h4>
      <ol className="small" style={PLAIN_LIST_STYLE}>
        {pins.map((p) => {
          const focused = p.n === focusedPin;
          return (
            <li key={p.n} data-testid={`pin-${p.n}`} className={focused ? 'focused' : undefined} aria-current={focused ? 'true' : undefined}>
              <button
                type="button"
                className="small"
                style={{ width: '100%', textAlign: 'left', ...(focused ? { borderColor: 'var(--accent)', background: 'var(--surface-2)' } : {}) }}
                onClick={() => onPin(p.n)}
              >
                <span aria-hidden="true" style={{ ...DOT_STYLE, background: PIN_COLORS[p.kind] }} />
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
      <h4 style={SUBHEAD_STYLE}>Warnings</h4>
      <ul className="small" style={LIST_STYLE}>
        {warnings.map((w, i) => <li key={`${w.code}:${i}`}>{w.text}</li>)}
      </ul>
    </>
  );
}

function Body(props: LinePanelProps & { layout: Layout }): ReactElement {
  const { layout, plan, moving, onToggleMove, onRotate, onAutoPlace, onPin } = props;
  if (layout.status === 'no-world') return <p className="muted" style={{ margin: 0 }}>{NO_WORLD_TEXT}</p>;
  const pins = <Pins layout={layout} focusedPin={props.focusedPin ?? null} onPin={onPin} />;
  if (layout.status === 'empty') {
    return (
      <>
        <p className="muted" style={{ margin: 0 }}>{plan !== null && plan.steps.length === 0 ? NO_STEPS_TEXT : ALL_OWNED_TEXT}</p>
        {pins}
        <Warnings layout={layout} />
      </>
    );
  }
  return (
    <>
      <Summary layout={layout} plan={plan} />
      <div className="row" style={{ gap: 6 }}>
        <button type="button" className={moving ? 'small primary' : 'small'} aria-pressed={moving} onClick={onToggleMove}>Move line</button>
        <button type="button" className="small" onClick={onRotate}>Rotate 90°</button>
        <button type="button" className="small" onClick={onAutoPlace}>Auto place</button>
      </div>
      {moving && <p className="muted small" style={{ margin: 0 }}>Drag the line on the map to where it should go.</p>}
      {pins}
      <Warnings layout={layout} />
    </>
  );
}

export function LinePanel(props: LinePanelProps): ReactElement {
  const { layout, loading, error } = props;
  const headingId = useId();
  return (
    <section
      className="line-panel"
      data-testid="line-panel"
      aria-labelledby={headingId}
      style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 14, paddingTop: 12, borderTop: '1px solid var(--border)' }}
    >
      <h3 id={headingId} style={{ margin: 0, fontSize: '0.95rem' }}>New line</h3>
      {error !== null && <p className="error small" style={{ margin: 0 }}>{error}</p>}
      {loading && <p className="muted small" style={{ margin: 0 }}>{LOADING_TEXT}</p>}
      {layout !== null && <Body {...props} layout={layout} />}
    </section>
  );
}
