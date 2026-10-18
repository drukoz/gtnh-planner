// One project (spec §3.11): its name (anyone can rename it), whether this tab is live, what the plan warns about or
// needs unlocked, and the project tabs. The tab follows the URL hash, so links elsewhere (a build step's map pin sets
// `#map`) switch it too.

import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { Plan } from '../../shared/types/plan.ts';
import { useName } from '../state/name.ts';
import { useProject } from '../state/project-store.ts';
import { PROJECT_TABS, tabFromHash } from './project-tabs.ts';

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

function PlanBanner(props: { plan: Plan | null; planError: string | null; planLoading: boolean }): ReactElement | null {
  const { plan, planError, planLoading } = props;
  const warnings = plan?.warnings ?? [];
  const unlocks = plan?.unlocks ?? [];
  if (planError === null && warnings.length === 0 && unlocks.length === 0 && !(planLoading && plan !== null)) return null;
  return (
    <div className="plan-banner" role="status">
      {planError !== null && <p className="error">{planError}</p>}
      {planLoading && plan !== null && <p className="muted">Updating the plan…</p>}
      {warnings.length > 0 && (
        <ul className="warnings">
          {warnings.map((w, i) => <li key={`${w.code}:${i}`}>{w.text}</li>)}
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
}

export function ProjectPage(props: { id: string }): ReactElement {
  const view = useProject(props.id);
  const me = useName() ?? '';
  const [tab, setTab] = useState(() => tabFromHash(location.hash));
  useEffect(() => {
    const follow = (): void => setTab(tabFromHash(location.hash));
    addEventListener('hashchange', follow);
    follow();
    return () => removeEventListener('hashchange', follow);
  }, []);

  const { project, plan, send } = view;
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
      <div className="project-head">
        <ProjectName name={project.name} onRename={(name) => send([{ op: 'rename', name }])} />
        <span className={view.connected ? 'connection live' : 'connection'}>{view.connected ? 'live' : 'reconnecting…'}</span>
      </div>
      {view.error !== null && <p className="banner error" role="alert">{view.error}</p>}
      <PlanBanner plan={plan} planError={view.planError} planLoading={view.planLoading} />
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
      <section className="tab-panel" role="tabpanel" id={`panel-${active.id}`} aria-labelledby={`tab-${active.id}`}>
        <View project={project} plan={plan} send={send} me={me} />
      </section>
    </main>
  );
}
