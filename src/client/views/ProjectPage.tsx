// One project (spec §3.11): its name (anyone can rename it), whether this tab is live, what the plan warns about or
// needs unlocked and what it uses beyond its line (farms, other projects' surplus), the Compare card of its planning
// modes (add-on 17), the settings panel with the in-game projector panel under it (§3.13) and, beside them, the project
// tabs. The tab follows the URL hash, so links elsewhere
// (a build step's map pin sets `#map`) switch it too. Anyone can delete the project; once it is deleted, here or
// elsewhere, the page goes back to the project list, which says so (§11.24). Below 900 px the settings panel is a drawer
// that the Settings button in the head slides in over a dimmed page (design spec §7a), a layer of its own while it is
// open (ruling R36).

import { useEffect, useLayoutEffect, useRef, useState, type ReactElement } from 'react';
import type { StuffKey } from '../../shared/keys.ts';
import { indexPlan, issueText, type PlanIssue, type PlanIssueCode } from '../../shared/plan/balance.ts';
import type { PackInfo } from '../../shared/types/api.ts';
import type { Plan, PlanSettings, PlanWarning } from '../../shared/types/plan.ts';
import type { Project, ProjectOp } from '../../shared/types/project.ts';
import { apiGet, messageOf } from '../api/client.ts';
import { listenProjectEvents } from '../api/sse.ts';
import { DeleteProject } from '../components/DeleteProject.tsx';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { SettingsToggle } from '../components/SettingsToggle.tsx';
import { formatPercent } from '../format.ts';
import { leaveDeletedProject } from '../state/deleted-notice.ts';
import { setFlowFocus, showInFlow } from '../state/flow-focus.ts';
import { useName } from '../state/name.ts';
import { useProject } from '../state/project-store.ts';
import { CompareCard } from './CompareCard.tsx';
import { ISSUE_ORDER, problemId } from './flow-model.ts';
import { sourceNotes } from './materials-model.ts';
import { costLine } from './plan-cost.ts';
import { PROJECT_TABS, tabFromHash } from './project-tabs.ts';
import { ProjectorPanel } from './ProjectorPanel.tsx';
import { stepChargeLabel, stepChargeOf } from './settings-model.ts';
import { SettingsPanel } from './SettingsPanel.tsx';

function ProjectName(props: { name: string; onRename(name: string): void }): ReactElement {
  const { name, onRename } = props;
  const [draft, setDraft] = useState(name);
  const [editing, setEditing] = useState(false);
  const cancelled = useRef(false);
  useEffect(() => {
    if (!editing) setDraft(name);   // someone else renamed it, or an edit ended
  }, [name, editing]);
  const commit = (value: string): void => {
    setEditing(false);
    if (cancelled.current) {
      cancelled.current = false;
      return;
    }
    const next = value.trim();
    if (next !== name) onRename(next);   // the store checks the name and shows why one is refused
  };
  return (
    <input
      className="project-name"
      aria-label="Project name"
      value={draft}
      onFocus={() => setEditing(true)}
      onChange={(e) => setDraft(e.currentTarget.value)}
      onBlur={(e) => commit(e.currentTarget.value)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') e.currentTarget.blur();
        if (e.key === 'Escape') {
          cancelled.current = true;
          e.currentTarget.blur();
        }
      }}
    />
  );
}

/** The integrity issue codes (fix spec R11), to tell a server's integrity warnings from its other warnings. */
const ISSUE_CODES: ReadonlySet<string> = new Set(ISSUE_ORDER);
/** A plan uses more raw material than the least only when it does by more than this share (not by rounding). */
const COST_GAP_REL = 1e-6;

/** "2 inputs have no source": the summary's part for `n` issues of one code. */
function issueCount(code: PlanIssueCode, n: number, issues: readonly PlanIssue[]): string {
  const one = n === 1;
  switch (code) {
    case 'orphan-input': return one ? '1 input has no source' : `${n} inputs have no source`;
    case 'short-input': return one ? '1 input is supplied short' : `${n} inputs are supplied short`;
    case 'multi-producer': {
      const ways = new Set(issues.map((i) => i.stepIds?.length ?? 2));
      const how = ways.size === 1 && ways.has(2) ? 'two ways' : 'more than one way';
      return one ? `1 good is made ${how}` : `${n} goods are made ${how}`;
    }
    case 'bought-and-made': return one ? '1 good is both bought and made' : `${n} goods are both bought and made`;
  }
}

/**
 * What the plan warns about (fix spec §6.4), above every project view: a summary of the integrity issues
 * (`indexPlan`: "This plan does not add up: …", with "Show in the flow") and each issue in the server's words, else
 * `issueText`'s (the client re-checks the plan it got); the derived materials the line buys as chips that show their
 * import in the flow, with "Plan them as supporting lines" while those are off; how much more raw material the plan
 * uses than the least to save machines (`Plan.rawCost`, Machines vs raw material); every other server warning (plan
 * 08's avoid list, missing recipes, add-on 17's `surplus-shared`, …); what the plan uses beyond its line — "This plan
 * uses a Tree Growth Simulator (Rubber Sapling)", "This plan draws Latex from Rubber line" (`sourceNotes`, ruling R18:
 * farms and other projects' surplus are on for every project, so their use is said) — and what unlocks the line. Above
 * that box, and on its own when there is nothing to warn about, what the plan costs to run and to build its new
 * machines (`costLine`, plan 12).
 */
export function PlanBanner(props: {
  plan: Plan | null; planError: string | null; planLoading: boolean; settings: PlanSettings; send: (ops: ProjectOp[]) => void;
}): ReactElement | null {
  const { plan, planError, planLoading, settings, send } = props;
  const warnings = plan?.warnings ?? [];
  const unlocks = plan?.unlocks ?? [];
  const names = plan?.names ?? {};
  const nameOf = (key: StuffKey): string => names[key] ?? key;

  const issues = plan === null ? [] : [...indexPlan(plan).issues].sort((a, b) => ISSUE_ORDER.indexOf(a.code) - ISSUE_ORDER.indexOf(b.code));
  const served = new Map<string, PlanWarning>();
  for (const w of warnings) if (ISSUE_CODES.has(w.code)) served.set(problemId(w), w);
  const issueTexts = issues.map((issue) => served.get(problemId(issue))?.text ?? (plan === null ? '' : issueText(issue, plan)));
  const counted = ISSUE_ORDER.flatMap((code) => {
    const ofCode = issues.filter((i) => i.code === code);
    return ofCode.length === 0 ? [] : [issueCount(code, ofCode.length, ofCode)];
  });

  const derivedWarning = warnings.find((w) => w.code === 'derived-leaf');
  const derived = derivedWarning === undefined ? [] : (plan?.rawInputs ?? []).filter((r) => r.leafClass === 'derived').map((r) => r.key);
  const shownIssues = new Set(issues.map(problemId));
  // Every other warning keeps its own text: a server integrity warning the client finds too is shown once (above), and
  // the derived-leaf warning becomes chips when the plan lists its leaves.
  const others = warnings.filter((w) => !(ISSUE_CODES.has(w.code) && shownIssues.has(problemId(w))) && !(w === derivedWarning && derived.length > 0));

  const rawText = rawCostText(plan?.rawCost, stepChargeLabel(stepChargeOf(settings)));
  // What the plan costs to run and to build (plan 12): on every plan that has a cost, outside the warning box.
  const costText = plan === null ? null : costLine(plan);
  const costed = costText === null ? null : <p className="plan-cost">{costText}</p>;
  const notes = plan === null ? [] : sourceNotes(plan);

  const busy = planLoading && plan !== null;
  if (planError === null && !busy && issues.length === 0 && others.length === 0 && derived.length === 0 && rawText === null && notes.length === 0
    && unlocks.length === 0) return costed;
  const firstIssue = issues[0];
  const banner = (
    <div className="plan-banner" role="status">
      {planError !== null && <p className="error">{planError}</p>}
      {busy && <p className="muted">Updating the plan…</p>}
      {firstIssue !== undefined && (
        <div className="banner-integrity">
          <p className="banner-heading error">
            {`This plan does not add up: ${counted.join(', ')} `}
            <button type="button" className="small" onClick={() => showInFlow({ kind: 'item', key: firstIssue.key })}>Show in the flow</button>
          </p>
          <ul className="warnings">
            {issues.map((issue, i) => <li key={problemId(issue)}>{issueTexts[i]}</li>)}
          </ul>
        </div>
      )}
      {others.length > 0 && (
        <ul className="warnings">
          {others.map((w, i) => <li key={`${w.code}:${i}`}>{w.text}</li>)}
        </ul>
      )}
      {derived.length > 0 && (
        <div className="banner-derived">
          <p>The line buys these instead of making them, as they are not mined anywhere you can reach:</p>
          <div className="banner-chips">
            {derived.map((key) => (
              <button key={key} type="button" className="banner-chip" data-key={key} title={`Show ${nameOf(key)} in the flow`} onClick={() => showInFlow({ kind: 'item', key })}>
                <ItemIcon itemKey={key} size={16} name={nameOf(key)} />
                <span>{nameOf(key)}</span>
              </button>
            ))}
          </div>
          {!settings.routeDerived && (
            <div className="row">
              <button type="button" onClick={() => send([{ op: 'settings', patch: { routeDerived: true } }])}>Plan them as supporting lines</button>
            </div>
          )}
        </div>
      )}
      {rawText !== null && <p className="banner-cost">{rawText}</p>}
      {notes.length > 0 && (
        <ul className="banner-sources">
          {notes.map((note) => <li key={note}>{`This plan ${note}`}</li>)}
        </ul>
      )}
      {unlocks.length > 0 && (
        <>
          <p className="banner-heading">To unlock</p>
          <ul className="unlocks">
            {unlocks.map((u) => <li key={u.key}>{u.text}</li>)}
          </ul>
        </>
      )}
    </div>
  );
  return costed === null ? banner : <>{costed}{banner}</>;
}

/**
 * How much more raw material the plan uses than the least to save machines (`Plan.rawCost`, Machines vs raw material:
 * `preset`), or null when it uses the least: `Uses <x>% more …`; a line whose least raw material is 0 (a glass line
 * digging sand that rock-breaker cobblestone and forge hammers could make, plan 12) has no percentage: `Uses raw
 * material that free inputs could replace, to save machines (…)`.
 */
function rawCostText(cost: Plan['rawCost'], preset: string): string | null {
  if (cost === undefined) return null;
  if (cost.leastPerSecond === 0 && cost.perSecond > 0) return `Uses raw material that free inputs could replace, to save machines (Machines vs raw material: ${preset})`;
  if (!(cost.leastPerSecond > 0) || !(cost.perSecond > cost.leastPerSecond * (1 + COST_GAP_REL))) return null;
  return `Uses ${formatPercent(cost.perSecond / cost.leastPerSecond - 1)} more raw material than the least possible to save machines (Machines vs raw material: ${preset})`;
}

/** How many `plan` and `compare` events project `id`'s stream has brought since this page opened it. */
function useProjectEventCount(id: string): number {
  const [count, setCount] = useState(0);
  useEffect(() => listenProjectEvents(id, () => setCount((n) => n + 1)), [id]);
  return count;
}

/**
 * The Compare card under the plan banner (add-on 17), once the project makes something: told of every `plan` and
 * `compare` event of the project (its `rev`), so an open card fetches the compare again; goods named by the plan.
 */
function ProjectCompare(props: { project: Project; plan: Plan | null; send: (ops: ProjectOp[]) => void }): ReactElement | null {
  const { project, plan, send } = props;
  const rev = useProjectEventCount(project.id);
  if (project.settings.target === null) return null;
  const names = plan?.names ?? {};
  return <CompareCard projectId={project.id} rev={rev} settings={project.settings} send={send} nameOf={(key) => names[key] ?? key} />;
}

/** The pack's dimensions, capabilities and recipe groups for the settings panel, fetched once per page. */
function usePackInfo(): { info: PackInfo | null; error: string | null } {
  const [state, setState] = useState<{ info: PackInfo | null; error: string | null }>({ info: null, error: null });
  useEffect(() => {
    let live = true;
    apiGet<PackInfo>('/api/pack').then(
      (info) => {
        if (live) setState({ info, error: null });
      },
      (err: unknown) => {
        if (live) setState({ info: null, error: messageOf(err) });
      },
    );
    return () => {
      live = false;
    };
  }, []);
  return state;
}

export function ProjectPage(props: { id: string }): ReactElement {
  const view = useProject(props.id);
  const pack = usePackInfo();
  const me = useName() ?? '';
  const [tab, setTab] = useState(() => tabFromHash(location.hash));
  useEffect(() => {
    const follow = (): void => setTab(tabFromHash(location.hash));
    addEventListener('hashchange', follow);
    follow();
    return () => removeEventListener('hashchange', follow);
  }, []);
  const { project, plan, send, deleted } = view;
  // The store sets `deleted` once, whether this tab deleted the project or was told, so the list says so once. The name
  // is the one this tab showed when the project went.
  useEffect(() => {
    if (deleted !== null) leaveDeletedProject(project?.name ?? null, deleted.by);
  }, [deleted]);
  // What the flow diagram lights belongs to this project: leaving it (for another project or another page) clears it.
  useEffect(() => () => setFlowFocus(null), [props.id]);
  // The settings column is a drawer below 900 px, and a layer of its own while it is open (ruling R36): opening it moves the focus to
  // its Close settings button, and the page behind it is inert (the head, the banners and the views here, and the App's top bar above
  // this page), so neither the keyboard nor a click reaches what the drawer covers. Every way out, Escape, a click on the dimmed page,
  // its Close button or the Settings button, goes through `closeSettings`, which gives the focus back to the Settings button. A window
  // that grows past 900 px closes it too, without moving the focus: the column is beside the views again and the button is not drawn.
  // The focus moves in a layout effect, after the commit: until then the page behind is still inert, and an inert button takes no focus.
  // These hooks sit above the early return below; the listeners are removed when the drawer closes, and between StrictMode's two runs.
  const [settingsOpen, setSettingsOpen] = useState(false);
  const settingsToggle = useRef<HTMLButtonElement | null>(null);
  const settingsClose = useRef<HTMLButtonElement | null>(null);
  /** The drawer is being closed by a way out of it: the focus goes back to the Settings button. */
  const refocusToggle = useRef(false);
  const closeSettings = (): void => {
    refocusToggle.current = true;
    setSettingsOpen(false);
  };
  useLayoutEffect(() => {
    if (settingsOpen) settingsClose.current?.focus();
    else if (refocusToggle.current) settingsToggle.current?.focus();
    refocusToggle.current = false;
  }, [settingsOpen]);
  // While it is open, Escape closes it, one layer per press: a key that something inside has already handled (`defaultPrevented`) is not
  // the drawer's, and neither is the key that closes a search list open in it (the item search and the avoid box close on Escape without
  // preventing the default). React has drawn such a list closed by the time the key reaches the document, so `look` reads whether one is
  // open on the way down, before the list's own handler runs, and `closeOnEscape` decides on the way up.
  useEffect(() => {
    if (!settingsOpen) return;
    let listOpen = false;
    const look = (e: KeyboardEvent): void => {
      listOpen = e.target instanceof Element && e.target.closest('[role="combobox"][aria-expanded="true"]') !== null;
    };
    const closeOnEscape = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || listOpen) return;
      closeSettings();
    };
    document.addEventListener('keydown', look, true);
    document.addEventListener('keydown', closeOnEscape);
    return () => {
      document.removeEventListener('keydown', look, true);
      document.removeEventListener('keydown', closeOnEscape);
    };
  }, [settingsOpen]);
  // What lies outside this page while the drawer is open: the top bar, which the App draws above it, goes inert with the rest of the
  // page behind the drawer; and the drawer closes when the window grows past the width it is a drawer at (the stylesheet's query).
  useEffect(() => {
    if (!settingsOpen) return;
    const bar = document.querySelector<HTMLElement>('.top-nav');
    if (bar !== null) bar.inert = true;
    const narrow = matchMedia('(max-width: 900px)');
    const onWidth = (): void => {
      if (!narrow.matches) setSettingsOpen(false);
    };
    narrow.addEventListener('change', onWidth);
    return () => {
      narrow.removeEventListener('change', onWidth);
      if (bar !== null) bar.inert = false;
    };
  }, [settingsOpen]);

  if (project === null) {
    return (
      <main className="page">
        {view.error !== null ? <p className="banner error" role="alert">{view.error}</p> : <p className="muted">Loading…</p>}
      </main>
    );
  }
  const active = PROJECT_TABS.find((t) => t.id === tab) ?? PROJECT_TABS[0]!;
  const View = active.component;
  return (
    <main className="page project-page">
      <div className="project-head" inert={settingsOpen}>
        <SettingsToggle open={settingsOpen} onToggle={() => (settingsOpen ? closeSettings() : setSettingsOpen(true))} ref={settingsToggle} />
        <ProjectName name={project.name} onRename={(name) => send([{ op: 'rename', name }])} />
        <span className={view.connected ? 'connection live' : 'connection'}>{view.connected ? 'live' : 'reconnecting…'}</span>
        <DeleteProject id={project.id} name={project.name} label="Delete project" onDeleted={() => view.markDeleted(me)} />
      </div>
      {/* The banners' own box, so the page behind an open drawer can be inert in three pieces (ruling R36); it adds no space.
          The Compare card (add-on 17) sits under the plan banner, in the same box, so it goes inert with them. */}
      <div className="project-banners" inert={settingsOpen}>
        {view.error !== null && <p className="banner error" role="alert">{view.error}</p>}
        <PlanBanner plan={plan} planError={view.planError} planLoading={view.planLoading} settings={project.settings} send={send} />
        {deleted === null && <ProjectCompare project={project} plan={plan} send={send} />}
      </div>
      <div className={settingsOpen ? 'project-body settings-open' : 'project-body'}>
        <aside className="settings-panel" id="project-settings" aria-label="Project settings">
          {/* The drawer's way out, and where the focus goes when it opens; the stylesheet draws it in the drawer only. */}
          <button type="button" className="settings-close" onClick={closeSettings} ref={settingsClose}>Close settings</button>
          {pack.error !== null && <p className="error small">{`Could not load the pack: ${pack.error}`}</p>}
          <SettingsPanel project={project} plan={plan} send={send} me={me} info={pack.info} />
          {deleted === null && <ProjectorPanel projectId={project.id} />}
        </aside>
        <div className="project-views" inert={settingsOpen}>
          <div className="tabs" role="tablist" aria-label="Project views">
            {PROJECT_TABS.map((t) => (
              <button
                key={t.id}
                type="button"
                role="tab"
                id={`tab-${t.id}`}
                aria-selected={t.id === active.id}
                aria-controls={`panel-${t.id}`}
                onClick={() => {
                  location.hash = `#${t.id}`;
                }}
              >
                {t.label}
              </button>
            ))}
          </div>
          {/* The view remounts on a tab switch anyway; the key makes the section new too, so its fade-in plays again. */}
          <section key={active.id} className="tab-panel" role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`}>
            <View project={project} plan={plan} previousPlan={view.previousPlan} send={send} me={me} />
          </section>
        </div>
      </div>
      {/* After the body, not in its grid: the dimmed page behind the drawer is not a cell. It only draws below 900 px. */}
      {settingsOpen && <div className="drawer-backdrop" onClick={closeSettings} />}
    </main>
  );
}
