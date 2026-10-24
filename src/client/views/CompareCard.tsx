// The Compare card under the plan banner (add-on 17, design spec §3.3, architecture §11.45 (5)): the "Compare modes"
// button in the project head opens and closes it; open, it plans the project's three planning modes side by side
// (`GET /api/projects/:id/compare`) and fetches them again on every `plan` or `compare` event of the project, so a mode
// still planning fills in when it is done; each column has "Use this mode", which sends the project's settings with that
// mode ("In use" on the mode the project plans in). Closed, it fetches nothing and draws nothing: the button is in the
// head, so a closed card takes no room (the Machine GUI's height budget). One compare request is on its way at a time: a
// compare can take the server's time limit (20 s), and a browser keeps only six connections per origin open.

import { useEffect, useMemo, useSyncExternalStore, type ReactElement, type Ref } from 'react';
import type { StuffKey } from '../../shared/keys.ts';
import type { CompareResult } from '../../shared/types/api.ts';
import type { PlanObjective, PlanSettings } from '../../shared/types/plan.ts';
import type { ProjectOp } from '../../shared/types/project.ts';
import { apiGet, messageOf } from '../api/client.ts';
import { useItemNames } from '../map/FoundPanel.tsx';
import { compareColumns, compareKeys } from './compare-model.ts';
import { objectivePatch } from './settings-model.ts';

/** What the card shows: closed, or open with the compare it last got (null until the first), why the last fetch failed, and whether one is on its way. */
export interface CompareState { open: boolean; result: CompareResult | null; error: string | null; loading: boolean }

/** The card's fetching, apart from React: opened and closed by the card, told of the project's `plan` and `compare` events. */
export interface CompareLoader {
  subscribe(fn: () => void): () => void;
  getSnapshot(): CompareState;
  /** Opens the card and fetches the compare. */
  open(): void;
  /** Closes the card; an answer still on its way is dropped. */
  close(): void;
  /** The project's plan may have changed, or a compare finished: fetch again while open (nothing while closed). */
  refresh(): void;
}

/** `GET /api/projects/:id/compare`. */
function fetchCompare(projectId: string): Promise<CompareResult> {
  return apiGet<CompareResult>(`/api/projects/${encodeURIComponent(projectId)}/compare`);
}

/**
 * The fetching of project `projectId`'s card (`get` answers the compare). Open, it fetches once and again on each
 * `refresh`; while a fetch is on its way the refreshes wait for it and then fetch once. Only an answer to the latest
 * fetch of the open card is shown; a failed fetch keeps the last answer and says why.
 */
export function compareLoader(projectId: string, get: (id: string) => Promise<CompareResult> = fetchCompare): CompareLoader {
  let state: CompareState = { open: false, result: null, error: null, loading: false };
  const listeners = new Set<() => void>();
  let request = 0;   // the latest fetch; a close counts too, so an answer for the card before it closed is dropped
  let inFlight = false;
  let again = false;
  const set = (patch: Partial<CompareState>): void => {
    state = { ...state, ...patch };
    for (const fn of [...listeners]) fn();
  };
  const load = (): void => {
    if (!state.loading) set({ loading: true });
    if (inFlight) {
      again = true;
      return;
    }
    inFlight = true;
    again = false;
    const mine = ++request;
    get(projectId)
      .then(
        (result) => {
          if (mine === request) set({ result, error: null });
        },
        (err: unknown) => {
          if (mine === request) set({ error: messageOf(err) });
        },
      )
      .finally(() => {
        inFlight = false;
        if (again && state.open) load();
        else if (state.loading && (mine === request || !state.open)) set({ loading: false });
      });
  };
  return {
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
    getSnapshot: () => state,
    open() {
      if (state.open) return;
      set({ open: true });
      load();
    },
    close() {
      if (!state.open) return;
      request++;
      again = false;
      set({ open: false, loading: false });
    },
    refresh() {
      if (state.open) load();
    },
  };
}

/**
 * The "Compare modes" button of the project head: a small button that opens and closes the card (`onToggle`), names the
 * card it controls and says whether it is open. The page passes a `ref` (React 19 hands it to a function component as a
 * prop) to give the focus back to the button when the card's own Close button closes it.
 */
export function CompareToggle(props: { open: boolean; onToggle: () => void; ref?: Ref<HTMLButtonElement> }): ReactElement {
  const { open, onToggle, ref } = props;
  return (
    <button type="button" className="small compare-toggle" aria-expanded={open} aria-controls="compare-card" onClick={onToggle} ref={ref}>
      Compare modes
    </button>
  );
}

/**
 * The card as its state shows it: closed, nothing (the head's `CompareToggle` opens it); open, its title with "Close"
 * (`onClose`), "Updating…" while a fetch is on its way, why the last one failed, and one column per mode (`compareColumns`):
 * its name, what its plan comes to or that it is still planning or why it failed, what it avoids, adds and makes for
 * other projects, and "Use this mode", which sends `objectivePatch` of the project's `settings` — disabled and reading
 * "In use" on the mode the project plans in.
 */
export function CompareCardView(props: {
  state: CompareState; settings: PlanSettings; send: (ops: ProjectOp[]) => void; nameOf: (k: StuffKey) => string; onClose(): void;
}): ReactElement | null {
  const { state, settings, send, nameOf, onClose } = props;
  if (!state.open) return null;
  const { result, error, loading } = state;
  const use = (objective: PlanObjective): void => send([{ op: 'settings', patch: objectivePatch(objective, settings) }]);
  return (
    <section className="compare-card" id="compare-card" aria-labelledby="compare-title">
      <div className="compare-head">
        <h3 id="compare-title">Compare modes</h3>
        {loading && result !== null && <span className="muted small" role="status">Updating…</span>}
        <button type="button" className="small" onClick={onClose}>Close</button>
      </div>
      {error !== null && <p className="error small" role="alert">{`Could not compare the modes: ${error}`}</p>}
      {result === null ? (
        loading && <p className="muted">Planning the three modes…</p>
      ) : (
        <div className="compare-columns">
          {compareColumns(result, nameOf).map((c) => (
            <section key={c.objective} className={c.current ? 'compare-column current' : 'compare-column'} data-objective={c.objective}>
              <h4>{c.label}</h4>
              {c.note !== null && <p className={c.status === 'failed' ? 'error small' : 'muted small'}>{c.note}</p>}
              {c.rows.length > 0 && (
                <dl className="compare-rows">
                  {c.rows.map((r) => (
                    <div key={r.label} className="compare-row">
                      <dt>{r.label}</dt>
                      <dd>{r.value}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {c.avoids !== '' && <p className="small" title="Raw materials another mode buys and this one does not">{`Avoids: ${c.avoids}`}</p>}
              {c.adds !== '' && <p className="small" title="Raw materials only this mode buys">{`Adds: ${c.adds}`}</p>}
              {c.credited !== '' && <p className="small">{`Also makes for other projects: ${c.credited}`}</p>}
              {c.current
                ? <button type="button" disabled>In use</button>
                : <button type="button" onClick={() => use(c.objective)}>Use this mode</button>}
            </section>
          ))}
        </div>
      )}
    </section>
  );
}

/**
 * Project `projectId`'s compare, for its page, which draws the head's button and the card apart: what the card shows,
 * and opening and closing it. `rev` changes on every `plan` or `compare` event of the project (ProjectPage counts them):
 * open, the compare is fetched again each time. Leaving the page (or another project) closes it.
 */
export function useCompare(projectId: string, rev: number): { state: CompareState; open(): void; close(): void } {
  const loader = useMemo(() => compareLoader(projectId), [projectId]);
  const state = useSyncExternalStore(loader.subscribe, loader.getSnapshot);
  useEffect(() => () => loader.close(), [loader]);
  useEffect(() => {
    loader.refresh();
  }, [loader, rev]);
  return { state, open: loader.open, close: loader.close };
}

/**
 * The card under the plan banner, as `state` (`useCompare`) shows it. `settings` are the project's, which "Use this mode"
 * sends a mode of; `nameOf` names a good by the plan's names, and a good the plan does not use (one only another mode
 * buys) by the pack's (`useItemNames`).
 */
export function CompareCard(props: {
  state: CompareState; settings: PlanSettings; send: (ops: ProjectOp[]) => void; nameOf: (k: StuffKey) => string; onClose(): void;
}): ReactElement | null {
  const { state, settings, send, nameOf, onClose } = props;
  const packNames = useItemNames(state.result === null ? [] : compareKeys(state.result).filter((key) => nameOf(key) === key));
  const named = (key: StuffKey): string => {
    const name = nameOf(key);
    return name !== key ? name : packNames.get(key) ?? key;
  };
  return <CompareCardView state={state} settings={settings} send={send} nameOf={named} onClose={onClose} />;
}
