// The Materials & steps tab (spec §3.10): what to build once (grouped as architecture §11.13, expandable down to base
// materials), the base materials that build needs, what the line runs on (per hour, or for the whole batch in Make N)
// with where it comes from and what unlocks it (spec §3.3b), what is left over, and then the build steps. Every row can
// be ticked off by anyone, and the have-counts from the world scan sit next to each line (spec §3.4, §11.20). A row of
// a good on the avoid list that nothing at the tier avoids carries a small "avoid" marker (spec §3.3).

import { useState, type ReactElement } from 'react';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import type { Product } from '../../shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../shared/types/plan.ts';
import type { Mark } from '../../shared/types/project.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { Tick } from '../components/Tick.tsx';
import { formatRate } from './flow-model.ts';
import { amountText, buildRows, groupBuildRows, runRows, unavoidableKeys, type BuildRow, type RunRow } from './materials-model.ts';
import type { ProjectViewProps } from './project-tabs.ts';
import { toggleList } from './settings-model.ts';
import { StepsView } from './StepsView.tsx';

type Send = ProjectViewProps['send'];
type Marks = Record<string, Mark>;

const ICON_SIZE = 20;
/** How far each level of the build tree is indented, in em. */
const DEPTH_INDENT = 1.5;
const NOTHING_EXPANDED: ReadonlySet<string> = new Set();

/** A row's amount with its unit: litres for a fluid, a count (`×`) for an item; a rate keeps its `/h`. */
function quantity(key: StuffKey, amount: string): string {
  const rate = amount.endsWith('/h');
  const n = rate ? amount.slice(0, -'/h'.length) : amount;
  if (isFluidKey(key)) return rate ? `${n} L/h` : `${n} L`;
  return rate ? amount : `${n}×`;
}

function marker(send: Send, row: string): (on: boolean) => void {
  return (on) => send([{ op: 'mark', row, on }]);
}

/** The marker of a good on the avoid list that the line still uses (`BuildRow.avoid`, `RunRow.avoid`). */
function AvoidMarker(): ReactElement {
  return <span className="badge avoid-badge" title="On the avoid list, but no recipe at this tier avoids it">avoid</span>;
}

/** The have-count; when the scan says where the stock sits, it opens to one line per storage block. */
function Stock(props: { have: string | undefined; where: string[] | undefined }): ReactElement | null {
  const { have, where } = props;
  if (have === undefined) return null;
  if (where === undefined) return <span className="mat-have small">{have}</span>;
  return (
    <details className="mat-have small">
      <summary>{have}</summary>
      <ul className="mat-where">
        {where.map((line, i) => <li key={`${i}:${line}`}>{line}</li>)}
      </ul>
    </details>
  );
}

function BuildItem(props: { row: BuildRow; marks: Marks; send: Send; expanded?: boolean; onExpand?: () => void }): ReactElement {
  const { row, marks, send, expanded, onExpand } = props;
  return (
    <li className="mat-row" data-depth={row.depth} style={{ paddingLeft: `${row.depth * DEPTH_INDENT}em` }}>
      {row.hasChildren && onExpand !== undefined ? (
        <button
          type="button"
          className="mat-toggle"
          aria-expanded={expanded === true}
          aria-label={`${expanded === true ? 'Hide' : 'Show'} what ${row.name} is made of`}
          onClick={onExpand}
        >
          {expanded === true ? '▾' : '▸'}
        </button>
      ) : (
        <span className="mat-toggle" aria-hidden="true" />
      )}
      <ItemIcon itemKey={row.key} size={ICON_SIZE} />
      <Tick row={row.row} mark={marks[row.row]} label={row.name} onToggle={marker(send, row.row)}>
        <span className="mat-amount">{quantity(row.key, row.amount)}</span>
        {row.avoid === true && <AvoidMarker />}
        <span className="muted small">{row.why}</span>
        <Stock have={row.have} where={row.where} />
      </Tick>
    </li>
  );
}

function BuildSection(props: { plan: Plan; names: Record<string, string>; marks: Marks; send: Send; unavoidable: ReadonlySet<StuffKey> }): ReactElement {
  const { plan, names, marks, send, unavoidable } = props;
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(NOTHING_EXPANDED);
  const toggle = (path: string): void => {
    setExpanded((open) => {
      const next = new Set(open);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };
  const groups = groupBuildRows(plan.buildList, names, expanded, unavoidable);
  return (
    <section className="materials-section" aria-labelledby="to-build-title">
      <h3 id="to-build-title">To build (once)</h3>
      {groups.length === 0 && <p className="muted">Nothing new to build: the machines you have cover this line.</p>}
      {groups.map((group) => (
        <div key={group.id} className="mat-group">
          <h4>{group.label}</h4>
          <ul className="mat-list">
            {group.rows.map((row) => (
              <BuildItem key={row.path} row={row} marks={marks} send={send} expanded={expanded.has(row.path)} onExpand={() => toggle(row.path)} />
            ))}
          </ul>
        </div>
      ))}
    </section>
  );
}

function TotalsSection(props: { plan: Plan; names: Record<string, string>; marks: Marks; send: Send; unavoidable: ReadonlySet<StuffKey> }): ReactElement {
  const { plan, names, marks, send, unavoidable } = props;
  const rows = buildRows(plan.buildTotals ?? [], names, NOTHING_EXPANDED, unavoidable);
  return (
    <section className="materials-section" aria-labelledby="build-totals-title">
      <h3 id="build-totals-title">Base materials for the build</h3>
      {rows.length === 0 ? (
        <p className="muted">No base materials to gather for the build.</p>
      ) : (
        <ul className="mat-list">
          {rows.map((row) => <BuildItem key={row.path} row={row} marks={marks} send={send} />)}
        </ul>
      )}
    </section>
  );
}

function RunItem(props: { row: RunRow; marks: Marks; settings: PlanSettings; send: Send }): ReactElement {
  const { row, marks, settings, send } = props;
  const patch = (p: Partial<PlanSettings>): void => send([{ op: 'settings', patch: p }]);
  const canExpand = row.canExpand && !settings.expandItems.includes(row.key);
  const canUnstop = row.isStop && settings.stopItems.includes(row.key);
  return (
    <li className="mat-row">
      <ItemIcon itemKey={row.key} size={ICON_SIZE} />
      <Tick row={row.row} mark={marks[row.row]} label={row.name} onToggle={marker(send, row.row)}>
        <span className="mat-amount">{quantity(row.key, row.amount)}</span>
        <span className="badge">{row.badge}</span>
        {row.avoid === true && <AvoidMarker />}
        <span className="muted small">{row.cost}</span>
        <Stock have={row.have} where={row.where} />
        {row.sources.length > 0 && (
          <ul className="mat-sources muted small">
            {row.sources.map((text, i) => <li key={`${i}:${text}`}>{text}</li>)}
          </ul>
        )}
        {row.unlock !== undefined && <p className="mat-unlock small">{row.unlock}</p>}
        {(canExpand || canUnstop) && (
          <div className="row mat-actions">
            {canExpand && (
              <button type="button" className="small" onClick={() => patch({ expandItems: toggleList(settings.expandItems, row.key, true) })}>
                We'll make it ourselves
              </button>
            )}
            {canUnstop && (
              <button type="button" className="small" onClick={() => patch({ stopItems: toggleList(settings.stopItems, row.key, false) })}>
                Stop treating as made
              </button>
            )}
          </div>
        )}
      </Tick>
    </li>
  );
}

function RunSection(props: { plan: Plan; mode: 'rate' | 'makeN'; marks: Marks; settings: PlanSettings; send: Send }): ReactElement {
  const { plan, mode, marks, settings, send } = props;
  const rows = runRows(plan, mode);
  return (
    <section className="materials-section" aria-labelledby="to-run-title">
      <h3 id="to-run-title">To run</h3>
      <p className="muted small">{mode === 'rate' ? 'Base materials per hour while the line runs' : 'Base materials for the whole batch'}</p>
      {rows.length === 0 ? (
        <p className="muted">The line needs no base materials.</p>
      ) : (
        <ul className="mat-list">
          {rows.map((row) => <RunItem key={row.row} row={row} marks={marks} settings={settings} send={send} />)}
        </ul>
      )}
    </section>
  );
}

function LeftOverSection(props: { plan: Plan; names: Record<string, string> }): ReactElement {
  const { plan, names } = props;
  const batch = plan.makeN;
  const goods: Product[] = batch?.leftovers ?? plan.byproducts;
  const amountOf = (p: Product): string => quantity(p.key, batch === undefined ? formatRate(p.amount, 'hour') : amountText(p.amount));
  return (
    <section className="materials-section" aria-labelledby="left-over-title">
      <h3 id="left-over-title">Left over</h3>
      {goods.length === 0 ? (
        <p className="muted">Nothing is left over.</p>
      ) : (
        <ul className="mat-list">
          {goods.map((p) => (
            <li key={p.key} className="mat-row">
              <ItemIcon itemKey={p.key} size={ICON_SIZE} />
              <span className="mat-name">{names[p.key] ?? p.key}</span>
              <span className="mat-amount">{amountOf(p)}</span>
            </li>
          ))}
        </ul>
      )}
      {batch !== undefined && <p>{`Takes about ${Math.max(1, Math.round(batch.totalSeconds / 60))} min`}</p>}
    </section>
  );
}

export function MaterialsView(props: ProjectViewProps): ReactElement {
  const { project, plan, send } = props;
  if (plan === null) return <p className="muted">Planning…</p>;
  if (plan.status === 'empty') return <p className="muted">Pick something to make in the settings</p>;
  if (plan.status === 'infeasible') return <p className="muted">This line cannot be planned yet, so there is nothing to build or run.</p>;
  const names = plan.names ?? {};
  const marks = project.marks;
  // The plan's own mode, not the settings': while a new plan is on its way, the shown one keeps its own units.
  const mode = plan.makeN === undefined ? 'rate' : 'makeN';
  const unavoidable = unavoidableKeys(plan);
  return (
    <div className="materials">
      <BuildSection plan={plan} names={names} marks={marks} send={send} unavoidable={unavoidable} />
      <TotalsSection plan={plan} names={names} marks={marks} send={send} unavoidable={unavoidable} />
      <RunSection plan={plan} mode={mode} marks={marks} settings={project.settings} send={send} />
      <LeftOverSection plan={plan} names={names} />
      <StepsView {...props} />
    </div>
  );
}
