// The Materials & steps tab (spec §3.10): what changed with the last settings change, what to build once (grouped as
// architecture §11.13, expandable down to base materials, with its raw material in all: plan 12's `buildTotalLine`),
// the base materials that build needs and which build lines
// need each, what the line runs on (per hour, or for the whole batch in Make N) with where it comes from, what unlocks
// it and which steps use it (spec §3.3b, fix spec §6.4) — the inputs nothing supplies first; what it takes from a farm
// the group runs or another project on rows of their own, and tool wear, said so (add-on 17) — what is left over and
// which of it other projects take (add-on 17), and then the build steps. Every row can be ticked off by anyone, and the
// have-counts from the world scan sit next to each line (spec §3.4, §11.20). A row of a good on the avoid list that
// nothing at the tier avoids carries a small "avoid" marker (spec §3.3).

import { Fragment, useMemo, useState, type ReactElement } from 'react';
import { isFluidKey, type StuffKey } from '../../shared/keys.ts';
import { indexPlan } from '../../shared/plan/balance.ts';
import type { Product } from '../../shared/types/pack.ts';
import type { Plan, PlanSettings } from '../../shared/types/plan.ts';
import type { Mark } from '../../shared/types/project.ts';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { Tick } from '../components/Tick.tsx';
import { formatRate } from '../format.ts';
import { showInFlow } from '../state/flow-focus.ts';
import { makeHerePatch } from './flow-model.ts';
import {
  amountText, buildRows, groupBuildRows, missingRows, runRows, takenRows, unavoidableKeys, type BuildRow, type MissingRow, type RunRow, type TakenRow, type UsedBy,
} from './materials-model.ts';
import { buildTotalLine } from './plan-cost.ts';
import type { ProjectViewProps } from './project-tabs.ts';
import { toggleList } from './settings-model.ts';
import { StepsView } from './StepsView.tsx';
import { WhatChanged } from './WhatChanged.tsx';

type Send = ProjectViewProps['send'];
type Marks = Record<string, Mark>;

const ICON_SIZE = 20;
/** How far each level of the build tree is indented, in em. */
const DEPTH_INDENT = 1.5;
const NOTHING_EXPANDED: ReadonlySet<string> = new Set();

/** A count with its unit: litres for a fluid, `×` for an item. A rate (`rate`) carries its unit already. */
function quantity(key: StuffKey, amount: string, rate = false): string {
  if (rate) return amount;
  return isFluidKey(key) ? `${amount} L` : `${amount}×`;
}

function marker(send: Send, row: string): (on: boolean) => void {
  return (on) => send([{ op: 'mark', row, on }]);
}

/**
 * The marker of a good on the avoid list, or a derived material made from one (`Plan.avoided` `madeFrom`), that the
 * line still uses (`BuildRow.avoid`, `RunRow.avoid`).
 */
function AvoidMarker(): ReactElement {
  return <span className="badge avoid-badge" title="On the avoid list or made from it, but no recipe at this tier avoids it">avoid</span>;
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

/** A total's why ("for Resistor, Vacuum Tube"); it opens to how much each of those build lines needs. */
function NeededFor(props: { row: BuildRow }): ReactElement {
  const { row } = props;
  if (row.neededFor === undefined) return <span className="muted small">{row.why}</span>;
  return (
    <details className="mat-needed muted small">
      <summary>{row.why}</summary>
      <ul className="mat-where">
        {row.neededFor.map((n) => <li key={n.key}>{`${quantity(row.key, n.amount)} for ${n.name}`}</li>)}
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
      <ItemIcon itemKey={row.key} size={ICON_SIZE} name={row.name} />
      <Tick row={row.row} mark={marks[row.row]} label={row.name} onToggle={marker(send, row.row)}>
        <span className="mat-amount">{quantity(row.key, row.amount)}</span>
        {row.avoid === true && <AvoidMarker />}
        <NeededFor row={row} />
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
  // What it all takes in raw material, the layout's power and logistics parts included (plan 12).
  const total = buildTotalLine(plan);
  return (
    <section className="materials-section" aria-labelledby="to-build-title">
      <h3 id="to-build-title">To build (once)</h3>
      {groups.length === 0 && <p className="muted">Nothing new to build: the machines you have cover this line.</p>}
      {groups.length > 0 && total !== null && <p className="muted">{total}</p>}
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

/** The steps that take a good, as chips, and a button that shows the good in the flow diagram (its producers and users lit). */
export function UsedByChips(props: { itemKey: StuffKey; usedBy: readonly UsedBy[] }): ReactElement | null {
  const { itemKey, usedBy } = props;
  if (usedBy.length === 0) return null;
  return (
    <div className="mat-used-by small">
      <span className="muted">Used by</span>
      {usedBy.map((u) => <span key={u.stepId} className="chip">{`${u.label} ${u.rate}`}</span>)}
      <button type="button" className="small" onClick={() => showInFlow({ kind: 'item', key: itemKey })}>Show in flow</button>
    </div>
  );
}

function RunItem(props: { row: RunRow; mode: 'rate' | 'makeN'; marks: Marks; settings: PlanSettings; send: Send }): ReactElement {
  const { row, mode, marks, settings, send } = props;
  const patch = (p: Partial<PlanSettings>): void => send([{ op: 'settings', patch: p }]);
  const canExpand = row.canExpand && !settings.expandItems.includes(row.key);
  const canUnstop = row.isStop && settings.stopItems.includes(row.key);
  return (
    <li className="mat-row">
      <ItemIcon itemKey={row.key} size={ICON_SIZE} name={row.name} />
      <Tick row={row.row} mark={marks[row.row]} label={row.name} onToggle={marker(send, row.row)}>
        <span className="mat-amount">{quantity(row.key, row.amount, mode === 'rate')}</span>
        <span className="badge">{row.badge}</span>
        {row.avoid === true && <AvoidMarker />}
        <span className="muted small">{row.cost}</span>
        <Stock have={row.have} where={row.where} />
        {row.sources.length > 0 && (
          <ul className="mat-sources muted small">
            {row.sources.map((text, i) => <li key={`${i}:${text}`}>{text}</li>)}
          </ul>
        )}
        <UsedByChips itemKey={row.key} usedBy={row.usedBy} />
        {row.unlock !== undefined && <p className="mat-unlock small">{row.unlock}</p>}
        {(canExpand || canUnstop) && (
          <div className="row mat-actions">
            {canExpand && (
              <button type="button" className="small" disabled={row.cannotMake !== undefined} onClick={() => patch(makeHerePatch(settings, row.key))}>
                We'll make it ourselves
              </button>
            )}
            {canExpand && row.cannotMake !== undefined && <span className="muted small">{row.cannotMake}</span>}
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

/** An input nothing in the plan supplies (or supplies short): red, before the base materials; nothing to tick off. */
function MissingItem(props: { row: MissingRow; mode: 'rate' | 'makeN' }): ReactElement {
  const { row, mode } = props;
  return (
    <li className="mat-row mat-missing">
      <ItemIcon itemKey={row.key} size={ICON_SIZE} name={row.name} />
      <div className="tick" data-row={row.row}>
        <span className="tick-label">{row.name}</span>
        <span className="mat-amount">{quantity(row.key, row.amount, mode === 'rate')}</span>
        <span className="badge missing-badge">{row.badge}</span>
        <UsedByChips itemKey={row.key} usedBy={row.usedBy} />
      </div>
    </li>
  );
}

function RunSection(props: { plan: Plan; mode: 'rate' | 'makeN'; marks: Marks; settings: PlanSettings; send: Send }): ReactElement {
  const { plan, mode, marks, settings, send } = props;
  const rows = runRows(plan, mode);
  const missing = useMemo(() => missingRows(plan, indexPlan(plan)), [plan]);
  return (
    <section className="materials-section" aria-labelledby="to-run-title">
      <h3 id="to-run-title">To run</h3>
      <p className="muted small">{mode === 'rate' ? 'Base materials per hour while the line runs' : 'Base materials for the whole batch'}</p>
      {rows.length === 0 && missing.length === 0 ? (
        <p className="muted">The line needs no base materials.</p>
      ) : (
        <ul className="mat-list">
          {missing.map((row) => <MissingItem key={row.row} row={row} mode={mode} />)}
          {rows.map((row) => <RunItem key={row.row} row={row} mode={mode} marks={marks} settings={settings} send={send} />)}
        </ul>
      )}
    </section>
  );
}

/**
 * One of the line's byproducts serving another project (`TakenRow`): under its byproduct, `for <project>` or `taken by
 * <project>` with its rate; without one (`named`), with the good's icon and name in front.
 */
function TakenItem(props: { row: TakenRow; named?: string }): ReactElement {
  const { row, named } = props;
  return (
    <li className={named === undefined ? 'mat-row mat-taken' : 'mat-row'}>
      {named !== undefined && <ItemIcon itemKey={row.key} size={ICON_SIZE} name={named} />}
      <span className="mat-name">{named === undefined ? row.text : `${named} ${row.text}`}</span>
      <span className="mat-amount">{row.amount}</span>
    </li>
  );
}

function LeftOverSection(props: { plan: Plan; names: Record<string, string> }): ReactElement {
  const { plan, names } = props;
  const batch = plan.makeN;
  const goods: Product[] = batch?.leftovers ?? plan.byproducts;
  const amountOf = (p: Product): string => (batch === undefined
    ? formatRate(p.amount, 'hour', { fluid: isFluidKey(p.key) })
    : quantity(p.key, amountText(p.amount)));
  // Whom the byproducts serve in other projects (add-on 17), under each; one the line leaves none of last, by its name.
  const taken = takenRows(plan);
  const left = new Set(goods.map((p) => p.key));
  const unplaced = taken.filter((t) => !left.has(t.key));
  return (
    <section className="materials-section" aria-labelledby="left-over-title">
      <h3 id="left-over-title">Left over</h3>
      {goods.length === 0 && unplaced.length === 0 ? (
        <p className="muted">Nothing is left over.</p>
      ) : (
        <ul className="mat-list">
          {goods.map((p) => (
            <Fragment key={p.key}>
              <li className="mat-row">
                <ItemIcon itemKey={p.key} size={ICON_SIZE} name={names[p.key] ?? p.key} />
                <span className="mat-name">{names[p.key] ?? p.key}</span>
                <span className="mat-amount">{amountOf(p)}</span>
              </li>
              {taken.filter((t) => t.key === p.key).map((t) => <TakenItem key={`${t.key}|${t.text}`} row={t} />)}
            </Fragment>
          ))}
          {unplaced.map((t) => <TakenItem key={`${t.key}|${t.text}`} row={t} named={names[t.key] ?? t.key} />)}
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
      <WhatChanged previous={props.previousPlan} plan={plan} />
      <BuildSection plan={plan} names={names} marks={marks} send={send} unavoidable={unavoidable} />
      <TotalsSection plan={plan} names={names} marks={marks} send={send} unavoidable={unavoidable} />
      <RunSection plan={plan} mode={mode} marks={marks} settings={project.settings} send={send} />
      <LeftOverSection plan={plan} names={names} />
      <StepsView {...props} />
    </div>
  );
}
