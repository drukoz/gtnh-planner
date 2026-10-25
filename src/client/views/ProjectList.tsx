// The group's projects, newest change first (spec §3.11: each build is a project with its own link), and a form to
// start a new one. Anyone can delete a project here or on its page; the deleted ones wait under "Recently deleted"
// for 7 days, where anyone can restore them (§11.24). The list has no live channel: it loads on open and after its
// own deletes and restores (ruling C17), and a row someone else deleted meanwhile counts as deleted when its Delete
// finds it gone.

import { useEffect, useState, type FormEvent, type ReactElement } from 'react';
import { MAX_NAME_LENGTH, validateOp } from '../../shared/project/apply-op.ts';
import type { CreateProjectBody, DeletedProjectSummary, ProjectListEntry, StuffInfo } from '../../shared/types/api.ts';
import type { Project } from '../../shared/types/project.ts';
import { apiGet, apiPost, messageOf } from '../api/client.ts';
import { listDeletedProjects, restoreProject } from '../api/projects.ts';
import { DeleteProject } from '../components/DeleteProject.tsx';
import { ItemIcon } from '../components/ItemIcon.tsx';
import { Skeleton } from '../components/Skeleton.tsx';
import { localTime } from '../format.ts';
import { followLink, navigate } from '../router.ts';
import { alreadyDeletedNotice, deletedNotice, takeDeletedNotice } from '../state/deleted-notice.ts';
import { useName } from '../state/name.ts';

/** Display names of the projects' targets; a key the pack cannot name (or no export yet) shows as the key. */
function useTargetNames(projects: ProjectListEntry[] | null): Record<string, string> {
  const [names, setNames] = useState<Record<string, string>>({});
  const keys = [...new Set((projects ?? []).flatMap((p) => (p.target === null ? [] : [p.target])))].sort();
  const wanted = keys.join('\n');
  useEffect(() => {
    let live = true;
    for (const key of wanted === '' ? [] : wanted.split('\n')) {
      apiGet<StuffInfo>(`/api/pack/stuff/${encodeURIComponent(key)}`).then(
        (info) => {
          if (live) setNames((n) => ({ ...n, [key]: info.name }));
        },
        () => {},
      );
    }
    return () => {
      live = false;
    };
  }, [wanted]);
  return names;
}

/** Deleted projects with who deleted them and when, each with Restore; nothing at all while there are none. */
export function RecentlyDeleted(props: {
  projects: DeletedProjectSummary[];
  /** The id being restored right now, whose button waits. */
  restoring: string | null;
  onRestore(project: DeletedProjectSummary): void;
}): ReactElement | null {
  const { projects, restoring, onRestore } = props;
  if (projects.length === 0) return null;
  return (
    <section className="recently-deleted" aria-labelledby="recently-deleted-title">
      <h2 id="recently-deleted-title">Recently deleted</h2>
      <p className="muted small">Deleted projects can be restored for 7 days, then they are removed for good.</p>
      <ul className="cards">
        {projects.map((p) => (
          <li key={p.id} className="card deleted-card">
            <span className="deleted-name">{p.name}</span>
            <span className="muted">
              {`Deleted by ${p.deletedBy} · `}
              <time dateTime={p.deletedAt}>{localTime(p.deletedAt)}</time>
            </span>
            <button type="button" disabled={restoring === p.id} onClick={() => onRestore(p)}>Restore</button>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function ProjectList(): ReactElement {
  const [projects, setProjects] = useState<ProjectListEntry[] | null>(null);
  const [deleted, setDeleted] = useState<DeletedProjectSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<string | null>(null);
  const [loads, setLoads] = useState(0);
  const names = useTargetNames(projects);
  const me = useName();

  useEffect(() => {
    // Taken in an effect, not during render: StrictMode renders twice, and the second render would find it gone.
    const left = takeDeletedNotice();
    if (left !== null) setNotice(left);
  }, []);

  useEffect(() => {
    let live = true;
    apiGet<ProjectListEntry[]>('/api/projects').then(
      (list) => {
        if (live) setProjects(list);
      },
      (err: unknown) => {
        if (live) setError(messageOf(err));
      },
    );
    listDeletedProjects().then(
      (list) => {
        if (live) setDeleted(list);
      },
      (err: unknown) => {
        if (live) setError(messageOf(err));
      },
    );
    return () => {
      live = false;
    };
  }, [loads]);
  const reload = (): void => setLoads((n) => n + 1);

  const restore = (p: DeletedProjectSummary): void => {
    setRestoring(p.id);
    setError(null);
    setNotice(null);
    restoreProject(p.id)
      .catch((err: unknown) => setError(messageOf(err)))   // purged, or someone restored it first: the reload shows which
      .finally(() => {
        setRestoring(null);
        reload();
      });
  };

  const create = async (e: FormEvent<HTMLFormElement>): Promise<void> => {
    e.preventDefault();
    const problem = validateOp({ op: 'rename', name });
    if (problem !== null) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const body: CreateProjectBody = { name: name.trim() };
      const project = await apiPost<Project>('/api/projects', body);
      navigate(`/p/${encodeURIComponent(project.id)}`);
    } catch (err) {
      setError(messageOf(err));
      setBusy(false);
    }
  };

  return (
    <main className="page project-list">
      <h1>Projects</h1>
      {notice !== null && <p className="banner notice" role="status">{notice}</p>}
      {error !== null && <p className="banner error" role="alert">{error}</p>}
      {projects === null ? (
        error === null && <><p className="muted">Loading…</p><Skeleton shape="cards" /></>
      ) : projects.length === 0 ? (
        <p className="muted">No projects yet. Start the first one below.</p>
      ) : (
        <ul className="cards">
          {projects.map((p) => {
            const path = `/p/${encodeURIComponent(p.id)}`;
            return (
              <li key={p.id} className="card project-card">
                <a href={path} onClick={(e) => followLink(e, path)} className="project-link">{p.name}</a>
                <span className="project-target">
                  {p.target === null ? (
                    <span className="muted">Nothing picked yet</span>
                  ) : (
                    <>
                      <ItemIcon itemKey={p.target} size={20} name={names[p.target] ?? p.target} />
                      <span>{names[p.target] ?? p.target}</span>
                    </>
                  )}
                </span>
                <span className="muted project-changed">{`Changed ${localTime(p.updatedAt)}`}</span>
                <DeleteProject
                  id={p.id} name={p.name} label="Delete"
                  onDeleted={() => {
                    setNotice(deletedNotice(p.name, me));
                    reload();
                  }}
                  onGone={() => {
                    // The row was stale (no live channel, ruling C17): someone else deleted it; the reload catches up.
                    setNotice(alreadyDeletedNotice(p.name));
                    reload();
                  }}
                />
              </li>
            );
          })}
        </ul>
      )}
      <form className="card new-project" onSubmit={(e) => void create(e)}>
        <label className="field">
          <span>New project</span>
          <input value={name} maxLength={MAX_NAME_LENGTH} placeholder="e.g. Steel line" onChange={(e) => setName(e.currentTarget.value)} />
        </label>
        <button type="submit" className="primary" disabled={busy || name.trim() === ''}>Create</button>
      </form>
      <RecentlyDeleted projects={deleted} restoring={restoring} onRestore={restore} />
    </main>
  );
}
